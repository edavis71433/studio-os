// ── Phase SC-1: Secure Client Scope (Studio → Client drill-in) ───────────────
// An agency operator may re-scope the whole shell to a CLIENT's business — but
// ONLY to clients they are explicitly authorized for. This is the tenant chokepoint:
// scope is a request (a header/URL the client controls), never an authority. The
// server re-validates it every request and FAILS CLOSED — it never falls back to a
// different tenant. Reuses the existing agency authorization (resolveAgencyMember +
// agencySiteIds + role capability); it invents no second auth system and never
// bypasses RLS for the un-scoped (own-site) path. RLS can't see a per-request scope
// (my_presence_site_ids admits only the owner), so a scope that passes here reads
// and writes site content through siteDb (lib/db.ts): service role, pinned to this site.
import { svc } from './db.ts';
import { resolveAgencyMember, agencySiteIds, isActiveClient, can } from '../agency/auth.ts';
import { afterResponseOrNow } from './after_response.ts';
import { sendEmail } from '../commerce/account.ts';
import { SITE_COLS, type SiteRow } from './site.ts';
import { UUID_RE } from './uuid.ts';
import type { SiteRole } from './site_roles.ts';

export function isScopeId(s: unknown): boolean { return typeof s === 'string' && UUID_RE.test(s); }

export interface ScopeInputs {
  requestedSiteId: string;
  isAgencyMember: boolean;      // resolveAgencyMember(jwt) !== null (fail-closed already)
  roleCanManage: boolean;       // can(member.role, 'bulk_publish') — only manage-capable roles drill in
  authorizedSiteIds: string[];  // agencySiteIds(agency_id) — ACTIVE clients only
  siteExists: boolean;          // the target site row exists (not deleted)
}
export interface ScopeDecision { ok: boolean; status: number; reason: string }

/** THE security decision — pure, so every attack scenario is a unit test. Order
 *  matters: cheapest + most-denying checks first, and any failure denies. */
export function scopeDecision(i: ScopeInputs): ScopeDecision {
  if (!isScopeId(i.requestedSiteId)) return { ok: false, status: 400, reason: 'bad_scope' };       // forged / malformed id
  if (!i.isAgencyMember) return { ok: false, status: 403, reason: 'not_agency' };                  // non-agency caller may never scope
  if (!i.roleCanManage) return { ok: false, status: 403, reason: 'role' };                         // read-only agency roles: no drill-in
  if (!i.authorizedSiteIds.includes(i.requestedSiteId)) return { ok: false, status: 403, reason: 'unauthorized' }; // not their client / archived / removed
  if (!i.siteExists) return { ok: false, status: 404, reason: 'deleted' };                          // client deleted
  return { ok: true, status: 200, reason: 'ok' };
}

// ── SC-2: audit ledger ────────────────────────────────────────────────────────
export type AuditReason = '' | 'unauthorized' | 'forbidden' | 'missing_membership' | 'removed_client' | 'malformed_scope' | 'archived_client' | 'read_only_role';

/** Map the internal scope-decision reason to the audit vocabulary. Pure. */
export function auditReason(scopeReason: string): AuditReason {
  switch (scopeReason) {
    case 'ok': return '';
    case 'bad_scope': return 'malformed_scope';
    case 'not_agency': return 'missing_membership';
    case 'role': return 'read_only_role';
    case 'unauthorized': return 'unauthorized';   // caller may refine to 'archived_client'
    case 'deleted': return 'removed_client';
    default: return 'forbidden';
  }
}

export interface AuditCtx {
  operatorUserId?: string | null;
  operatorEmail?: string | null;
  route?: string;
  method?: string;
  requestId?: string;
  ip?: string;
  userAgent?: string;
}
export interface ScopeAuditRow {
  operator_user_id: string | null; operator_email: string; agency_id: string | null;
  client_site_id: string; client_name: string; route: string; method: string;
  outcome: 'allowed' | 'denied'; reason: AuditReason; request_id: string; ip: string; user_agent: string;
}

/** Build the audit row — PURE, and by construction it can only ever contain the
 *  fields below: no token, no Authorization header, no request body, no secret. */
export function buildScopeAuditRow(i: {
  audit?: AuditCtx; agencyId: string | null; clientSiteId: string; clientName: string;
  outcome: 'allowed' | 'denied'; reason: AuditReason;
}): ScopeAuditRow {
  const a = i.audit || {};
  const cap = (s: unknown, n: number) => String(s ?? '').slice(0, n);
  return {
    operator_user_id: a.operatorUserId || null,
    operator_email: cap(a.operatorEmail, 254),
    agency_id: i.agencyId || null,
    client_site_id: i.clientSiteId,
    client_name: cap(i.clientName, 200),
    route: cap((a.route || '').split('?')[0], 300),   // path only — never the query string
    method: cap(a.method, 10),
    outcome: i.outcome,
    reason: i.reason,
    request_id: cap(a.requestId, 80),
    ip: cap((a.ip || '').split(',')[0].trim(), 45),    // first forwarded hop only
    user_agent: cap(a.userAgent, 300),
  };
}

/** Write the audit row. Best-effort and ORTHOGONAL to the access decision — a
 *  failure here never gates access (auth already decided) and never exposes data;
 *  it only alerts ops so the gap is visible. */
async function logScopedAccess(row: ScopeAuditRow): Promise<void> {
  try {
    const r = await svc('presence_scoped_access_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(row) });
    if (!r.ok) throw new Error('audit_insert_' + r.status);
  } catch (_) {
    const ops = Deno.env.get('OPS_ALERT_EMAIL') || '';
    if (ops) sendEmail(ops, '[Studio OS ops] Scoped-access audit write failed', `<p>A scoped-access event could not be recorded (${row.outcome}/${row.reason || 'allowed'}) for client ${row.client_site_id}. Access was decided by authorization as normal; only the audit log failed.</p>`, undefined, { critical: true }).catch(() => {});   // operator-directed ops mail: an unsubscribe must not silence a failing audit log
  }
}

// Item 87: the client's name labels the scope and its audit row; it isn't authorization, so
// it is kept a minute per site instead of read on each of a page's thirty-odd requests.
// Who may act inside the client is still decided afresh every request.
const CLIENT_NAMES = new Map<string, { at: number; name: string }>();
async function clientName(siteId: string): Promise<string> {
  const kept = CLIENT_NAMES.get(siteId);
  if (kept && Date.now() - kept.at < 60_000) return kept.name;
  const ident = await svc(`presence_identity?site_id=eq.${siteId}&select=business_name&limit=1`);
  const name = (ident.json && ident.json[0]?.business_name) || 'Client';
  CLIENT_NAMES.set(siteId, { at: Date.now(), name });
  return name;
}

/** Builder item 83: one of the caller's own businesses, picked with the same ?client=
 *  a studio uses (lib/workspace.ts resolveHeldBusiness). Never a studio scope. */
export interface HeldBusiness { site: SiteRow; member: { site_id: string; role: SiteRole } | null }
export type ScopeResult =
  | { ok: true; site: SiteRow; scoped: { site_id: string; name: string } }
  | { ok: true; site: SiteRow; held: HeldBusiness }
  | { ok: false; status: number; reason: string };

/** Resolve a requested client scope to a SiteRow — authorized by agency membership,
 *  fail-closed. Returns the tenant ONLY if every check passes. Never returns another
 *  tenant on failure. I/O wrapper around the pure decision above.
 *
 *  SC-2: every call records an audit event (allowed or denied). The audit is
 *  best-effort — it is written AFTER the decision and never changes it, so a logging
 *  failure can neither expose data nor block an authorized request. `resolveScopedSite`
 *  is invoked ONLY when a scope was requested, so un-scoped (own-site) access is never
 *  logged here.
 *
 *  Builder item 83: when the studio's own check says no (not a studio, a role that
 *  can't open clients, or not one of its clients), `held` is asked whether the site
 *  is one of the caller's own businesses: one they own, or hold a seat on. If it is,
 *  that is the answer, as the person themself, never as a studio, and no studio
 *  visit is recorded. If not, the refusal stands and is recorded as before. */
export async function resolveScopedSite(jwt: string, requestedSiteId: string, audit?: AuditCtx, held?: (siteId: string) => Promise<HeldBusiness | null>): Promise<ScopeResult> {
  // helper: compute the decision + agency + client name, then log once, then return.
  // Builder item 209 (review file 06, finding 83): the record is written after the response
  // (EdgeRuntime.waitUntil), not before it, so no request inside a client waits on the ledger.
  // It is still written for every request, allowed and denied; its own refinement read
  // (archived or never authorised) goes along with it.
  const finish = async (dec: ScopeDecision, agencyId: string | null, clientName: string, refine?: (r: AuditReason) => Promise<AuditReason> | AuditReason): Promise<void> => {
    await afterResponseOrNow((async () => {
      let reason = auditReason(dec.reason);
      if (refine) reason = await refine(reason);
      await logScopedAccess(buildScopeAuditRow({ audit, agencyId, clientSiteId: isScopeId(requestedSiteId) ? requestedSiteId : '00000000-0000-0000-0000-000000000000', clientName, outcome: dec.ok ? 'allowed' : 'denied', reason }));
    })());
  };

  if (!isScopeId(requestedSiteId)) {
    const dec = scopeDecision({ requestedSiteId, isAgencyMember: false, roleCanManage: false, authorizedSiteIds: [], siteExists: true });
    await finish(dec, null, '');
    return { ok: false, status: dec.status, reason: dec.reason };
  }
  const member = await resolveAgencyMember(jwt);                 // fail-closed: bad token / paused agency / no row → null
  const agencyId = member ? member.agency_id : null;
  const roleCanManage = !!member && can(member.role, 'bulk_publish');
  // Builder item 209 (finding 83): ask about this one client (an ACTIVE one), not for the list of
  // every client; a role that can't open clients is refused below without asking at all.
  const authorized = member && roleCanManage && await isActiveClient(member.agency_id, requestedSiteId) ? [requestedSiteId] : [];
  // load the site ONLY after the authorization checks would pass, to avoid a
  // read on an unauthorized/forged id (defense in depth + no info leak on timing)
  const pre = scopeDecision({ requestedSiteId, isAgencyMember: !!member, roleCanManage, authorizedSiteIds: authorized, siteExists: true });
  if (!pre.ok && held && (pre.reason === 'not_agency' || pre.reason === 'role' || pre.reason === 'unauthorized')) {
    const own = await held(requestedSiteId).catch(() => null);
    if (own && own.site.id === requestedSiteId) return { ok: true, site: own.site, held: own };
  }
  if (!pre.ok) {
    // audit-only refinement: distinguish an ARCHIVED client from a never-authorized
    // one. This never affects the security decision (still denied either way) — it
    // only sharpens the ledger. Active-only set already excludes archived.
    await finish(pre, agencyId, '', async (r) => {
      if (r !== 'unauthorized' || !member) return r;
      const all = await agencySiteIds(member.agency_id, true);   // include archived
      return all.includes(requestedSiteId) ? 'archived_client' : r;
    });
    return { ok: false, status: pre.status, reason: pre.reason };
  }
  const r = await svc(`presence_sites?id=eq.${requestedSiteId}&select=${SITE_COLS}&limit=1`);
  const site = (r.json && r.json[0]) as SiteRow | undefined;
  if (!site) { await finish({ ok: false, status: 404, reason: 'deleted' }, agencyId, ''); return { ok: false, status: 404, reason: 'deleted' }; }
  const name = await clientName(requestedSiteId);
  await finish({ ok: true, status: 200, reason: 'ok' }, agencyId, name);
  return { ok: true, site, scoped: { site_id: requestedSiteId, name } };
}
