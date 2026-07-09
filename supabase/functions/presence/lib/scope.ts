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

export type ScopeResult =
  | { ok: true; site: SiteRow; scoped: { site_id: string; name: string } }
  | { ok: false; status: number; reason: string };

/** Resolve a requested client scope to a SiteRow — authorized by agency membership,
 *  fail-closed. Returns the tenant ONLY if every check passes. Never returns another
 *  tenant on failure. I/O wrapper around the pure decision above. */
export async function resolveScopedSite(jwt: string, requestedSiteId: string): Promise<ScopeResult> {
  if (!isScopeId(requestedSiteId)) return { ok: false, status: 400, reason: 'bad_scope' };
  const member = await resolveAgencyMember(jwt);                 // fail-closed: bad token / paused agency / no row → null
  const roleCanManage = !!member && can(member.role, 'bulk_publish');
  const authorized = member ? await agencySiteIds(member.agency_id) : [];   // ACTIVE clients only
  // load the site ONLY after the authorization checks would pass, to avoid a
  // read on an unauthorized/forged id (defense in depth + no info leak on timing)
  const pre = scopeDecision({ requestedSiteId, isAgencyMember: !!member, roleCanManage, authorizedSiteIds: authorized, siteExists: true });
  if (!pre.ok) return { ok: false, status: pre.status, reason: pre.reason };
  const r = await svc(`presence_sites?id=eq.${requestedSiteId}&select=id,client_id,status,last_published_at,template_slug,template_version,custom_domain,netlify_site_id,edition&limit=1`);
  const site = (r.json && r.json[0]) as SiteRow | undefined;
  if (!site) return { ok: false, status: 404, reason: 'deleted' };
  const ident = await svc(`presence_identity?site_id=eq.${requestedSiteId}&select=business_name&limit=1`);
  const name = (ident.json && ident.json[0]?.business_name) || 'Client';
  return { ok: true, site, scoped: { site_id: requestedSiteId, name } };
}
