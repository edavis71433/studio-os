// ── Phase SC-1: Secure Client Scope (Studio → Client drill-in) ───────────────
// An agency operator may re-scope the whole shell to a CLIENT's business — but
// ONLY to clients they are explicitly authorized for. This is the tenant chokepoint:
// scope is a request (a header/URL the client controls), never an authority. The
// server re-validates it every request and FAILS CLOSED — it never falls back to a
// different tenant. Reuses the existing agency authorization (resolveAgencyMember +
// agencySiteIds + role capability); it invents no second auth system and never
// bypasses RLS for the un-scoped (own-site) path.
import { svc } from './db.ts';
import { resolveAgencyMember, agencySiteIds, can } from '../agency/auth.ts';
import { sendEmail } from '../commerce/account.ts';
import type { SiteRow } from './site.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
    if (ops) sendEmail(ops, '[Studio OS ops] Scoped-access audit write failed', `<p>A scoped-access event could not be recorded (${row.outcome}/${row.reason || 'allowed'}) for client ${row.client_site_id}. Access was decided by authorization as normal; only the audit log failed.</p>`).catch(() => {});
  }
}

export type ScopeResult =
  | { ok: true; site: SiteRow; scoped: { site_id: string; name: string } }
  | { ok: false; status: number; reason: string };

/** Resolve a requested client scope to a SiteRow — authorized by agency membership,
 *  fail-closed. Returns the tenant ONLY if every check passes. Never returns another
 *  tenant on failure. I/O wrapper around the pure decision above.
 *
 *  SC-2: every call records an audit event (allowed or denied). The audit is
 *  best-effort — it is written AFTER the decision and never changes it, so a logging
 *  failure can neither expose data nor block an authorized request. `resolveScopedSite`
 *  is invoked ONLY when a scope was requested, so un-scoped (own-site) access is never
 *  logged here. */
export async function resolveScopedSite(jwt: string, requestedSiteId: string, audit?: AuditCtx): Promise<ScopeResult> {
  // helper: compute the decision + agency + client name, then log once, then return.
  const finish = async (dec: ScopeDecision, agencyId: string | null, clientName: string, refine?: (r: AuditReason) => Promise<AuditReason> | AuditReason): Promise<void> => {
    let reason = auditReason(dec.reason);
    if (refine) reason = await refine(reason);
    await logScopedAccess(buildScopeAuditRow({ audit, agencyId, clientSiteId: isScopeId(requestedSiteId) ? requestedSiteId : '00000000-0000-0000-0000-000000000000', clientName, outcome: dec.ok ? 'allowed' : 'denied', reason }));
  };

  if (!isScopeId(requestedSiteId)) {
    const dec = scopeDecision({ requestedSiteId, isAgencyMember: false, roleCanManage: false, authorizedSiteIds: [], siteExists: true });
    await finish(dec, null, '');
    return { ok: false, status: dec.status, reason: dec.reason };
  }
  const member = await resolveAgencyMember(jwt);                 // fail-closed: bad token / paused agency / no row → null
  const agencyId = member ? member.agency_id : null;
  const roleCanManage = !!member && can(member.role, 'bulk_publish');
  const authorized = member ? await agencySiteIds(member.agency_id) : [];   // ACTIVE clients only
  // load the site ONLY after the authorization checks would pass, to avoid a
  // read on an unauthorized/forged id (defense in depth + no info leak on timing)
  const pre = scopeDecision({ requestedSiteId, isAgencyMember: !!member, roleCanManage, authorizedSiteIds: authorized, siteExists: true });
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
  const r = await svc(`presence_sites?id=eq.${requestedSiteId}&select=id,client_id,status,last_published_at,template_slug,template_version,custom_domain,netlify_site_id,edition&limit=1`);
  const site = (r.json && r.json[0]) as SiteRow | undefined;
  if (!site) { await finish({ ok: false, status: 404, reason: 'deleted' }, agencyId, ''); return { ok: false, status: 404, reason: 'deleted' }; }
  const ident = await svc(`presence_identity?site_id=eq.${requestedSiteId}&select=business_name&limit=1`);
  const name = (ident.json && ident.json[0]?.business_name) || 'Client';
  await finish({ ok: true, status: 200, reason: 'ok' }, agencyId, name);
  return { ok: true, site, scoped: { site_id: requestedSiteId, name } };
}
