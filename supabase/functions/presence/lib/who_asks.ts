// ── The caller's seat, remembered for a minute (builder item 401) ─────────────
// Nov 22 review, file 14, finding 5: after "who is this" (_shared/auth.ts, remembered the
// same way), every signed-in request still made 3 to 5 trips in a row to learn which site,
// whether the studio may open it, the caller's role there and the site's plan. A page that
// opens with seven calls made the chain seven times. This keeps the answer per worker for
// WHO_ASKS_TTL_MS, keyed by the token and the client asked for, and lets calls that arrive
// while it is being worked out share the one lookup.
//
// What is kept is only a seat that was granted. A refusal (no site, a scope denied) is
// never kept: it is worked out again on every request, as before. The gates that refuse
// from the seat (entitlement paused, the reviewer and Designer boundaries, the member write
// gate, the edition) still run on every request in index.ts, so a remembered seat refuses
// exactly what a fresh one would. A write in this worker to any table a seat rests on
// forgets every seat at once (lib/db.ts, _shared/auth.ts authChanged); a change made by
// another worker bites within the minute, where it used to bite on the next request.
//
// The studio's visit inside a client is still recorded for every request, allowed or not
// (SC-2): the first lookup records its own, and every request that shares it records one
// of its own with its own route and request id.
import type { Principal } from '../../_shared/auth.ts';
import { authEpoch, WHO_ASKS_TTL_MS } from '../../_shared/auth.ts';
import { resolveSite, type SiteRow } from './site.ts';
import { resolveScopedSite, recordScopedVisit, type AuditCtx } from './scope.ts';
import { resolveMemberSite, resolveHeldBusiness, resolveSiteRole } from './workspace.ts';
import type { SiteRole } from './site_roles.ts';
import { entitlementFor, type EntRow } from '../middleware/entitlement.ts';

export interface Seat {
  site: SiteRow;
  scopedName: string | null;
  scope: { site_id: string; name: string } | null;
  agencyId: string | null;
  member: { site_id: string; role: SiteRole; can_publish?: boolean } | null;
  siteRole: SiteRole;
  ent: EntRow;
}
export type SeatAnswer =
  | { ok: true; seat: Seat }
  | { ok: false; status: number; error: string; message: string; scoped: boolean; reason: string };

const kept = new Map<string, { at: number; epoch: number; p: Promise<SeatAnswer> }>();
const MAX_KEPT = 500;

/** Forget every remembered seat (tests). */
export function forgetSeats(): void { kept.clear(); }

async function lookupSeat(jwt: string, principal: Principal, scopeReq: string | null, audit: AuditCtx): Promise<SeatAnswer> {
  let site: SiteRow | null = null;
  let scopedName: string | null = null;
  let scope: Seat['scope'] = null;
  let agencyId: string | null = null;
  // a seat that admits the caller: their oldest when nothing was picked, or (builder
  // item 83) the business they picked with ?client=
  let seated: { site: SiteRow; member: Seat['member'] } | null = null;
  if (scopeReq) {
    // SC-2: the operator identity + request metadata, so the drill-in is recorded
    // (allowed AND denied). No token, no body — resolveScopedSite logs only the
    // fields it is handed, best-effort, without gating this decision.
    const sc = await resolveScopedSite(jwt, scopeReq, audit, (id) => resolveHeldBusiness(jwt, principal, id));
    if (!sc.ok) return { ok: false, status: sc.status, error: 'scope_denied', message: 'You don’t have access to that client.', scoped: true, reason: sc.reason };
    if ('held' in sc) {
      // builder item 83: one of the caller's own businesses, opened as themself, never as a studio
      seated = sc.held;
    } else {
      site = sc.site; scopedName = sc.scoped.name; agencyId = sc.agency_id ?? null;
      // Studio audit change 2: the principal then KNOWS it is acting for a client, so every
      // attribution downstream (lib/actor_kind.ts) says "the studio" without a second
      // membership query. Stamped by index.ts, only after the scope was authorised here.
      scope = { site_id: sc.scoped.site_id, name: sc.scoped.name };
    }
  } else {
    site = await resolveSite(jwt);
    // MEMBERSHIP fallback: an invited member (client_reviewer / staff seat) owns no site
    // of their own — RLS returns nothing. Resolve via their active membership instead;
    // every in-site power still flows through the role + the reviewer boundary
    // (fail-closed). Only a client caller carries the seat onto the data path:
    // platform staff operate as the owner already.
    if (!site && (principal.userId || principal.email)) {
      try { seated = await resolveMemberSite(principal); } catch { /* fail closed to no_site */ }
    }
  }
  let member: Seat['member'] = null;
  if (seated) {
    site = seated.site;
    if (principal.kind === 'client') member = seated.member;
  }
  if (!site) return { ok: false, status: 404, error: 'no_site', message: 'No Presence site is set up for this account yet.', scoped: false, reason: 'no_site' };
  // the plan and the role, read once here and handed to the request's own memos
  const ent = await entitlementFor(principal, site.client_id);
  // Always resolved, because this also learns a member's user_id on first sight. But the
  // seat that admitted them outranks the answer: resolveSiteRole says business_owner after
  // a failed read, a default meant for the site's owner.
  const resolved = await resolveSiteRole(jwt, site.id, principal.kind);
  const siteRole = member?.site_id === site.id ? member.role : resolved;
  return { ok: true, seat: { site, scopedName, scope, agencyId, member, siteRole, ent } };
}

/** The seat for this request: worked out, or remembered. `shared` says it was remembered
 *  or shared with a request already looking it up, in which case the studio's visit inside
 *  a client has not yet been recorded for THIS request. */
export async function resolveSeat(jwt: string, principal: Principal, scopeReq: string | null, audit: AuditCtx): Promise<SeatAnswer> {
  const key = `${jwt}|${scopeReq || ''}|${principal.kind}`;
  const now = Date.now();
  const epoch = authEpoch();
  const hit = kept.get(key);
  if (hit && hit.epoch === epoch && now - hit.at < WHO_ASKS_TTL_MS) {
    const answer = await hit.p;
    if (scopeReq) recordScopedVisit(audit, answer.ok ? answer.seat.agencyId : null, scopeReq, answer.ok ? answer.seat.scopedName || '' : '', answer.ok ? 'ok' : answer.reason);
    return answer;
  }
  const p = lookupSeat(jwt, principal, scopeReq, audit);
  kept.set(key, { at: now, epoch, p });
  const answer = await p;
  if (!answer.ok) { if (kept.get(key)?.p === p) kept.delete(key); return answer; }
  if (kept.size > MAX_KEPT) {
    for (const [k, v] of kept) { if (now - v.at >= WHO_ASKS_TTL_MS) kept.delete(k); }
    if (kept.size > MAX_KEPT) kept.delete(kept.keys().next().value as string);
  }
  return answer;
}
