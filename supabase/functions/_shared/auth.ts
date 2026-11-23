// ── AUTH: staff verification, revocation, roles, principal resolution ──
// Extracted verbatim from clever-api/index.ts (M1 _shared extraction).
// Env reads are local to this module (config-only duplication; same injected
// values in every function of the project). Route tables (ROUTE_MIN_ROLE),
// the gate itself, opsLog and auditWrite stay in the owning function — this
// module is identity/roles only.

import { timingSafeEqual } from './hmac.ts';

const SB_URL = Deno.env.get('SUPABASE_URL') || '';
const SB_SERVICE = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const SCHEDULER_SECRET = Deno.env.get('SCHEDULER_SECRET') || '';
// P5: the first-class OPERATOR credential for the marketplace/enterprise
// management surfaces. A dedicated server-to-server shared secret (same shape as
// SCHEDULER_SECRET and the stripe-webhook x-commerce-secret) — NEVER the
// service-role key, never sent to a browser. This is the clean privileged caller
// the operator lifecycle was missing; the service-role deliberately still
// resolves to `public` (defense-in-depth: a leaked service key is not an operator).
const OPERATOR_SECRET = Deno.env.get('OPERATOR_SECRET') || '';

export const TENANT_ID = '00000000-0000-0000-0000-000000000001'; // DDS = tenant #1

// ── ONE JWT→user resolution per request ──────────────────────────────────────
// The same JWT was validated against /auth/v1/user up to 4× per request
// (verifyStaff → resolvePrincipal's client path → callerOf / resolveAgencyMember)
// — pure latency stacking on every request. This micro-memo collapses them to
// one hop. The 5s TTL is a REQUEST lifetime, not a session cache: within one
// request the JWT's identity cannot meaningfully change (bearer tokens are
// hour-lived; GoTrue /user only checks signature + fetches the profile), and
// nothing survives past the request window — so the frozen "no cross-request
// auth caches" property holds in every way that matters (revocation latency
// bounded at 5s vs. the token's own 3600s validity). Failure is NOT cached.
const AUTH_MEMO_TTL_MS = 5_000;
const authMemo = new Map<string, { user: any; at: number }>();
/** Builder item 401: no call out of here waits longer than this. A stalled database or
 *  GoTrue used to hang every request for as long as the platform allowed. */
export const AUTH_TIMEOUT_MS = 10_000;
const limited = () => AbortSignal.timeout(AUTH_TIMEOUT_MS);

// ── Who is asking, remembered for a minute (builder item 401) ────────────────
// The staff-or-client chain below (GoTrue, memberships, contacts, clients, seats) ran on
// every signed-in request: 4 to 6 trips before the request's own work, and a page that
// opens with seven calls ran it seven times. Now one worker remembers a token's answer
// for WHO_ASKS_TTL_MS, keyed by the token, and calls that arrive while it is being looked
// up share the one lookup. Only a staff or client answer is kept: a refusal is looked up
// again every time, as before. Any write in this worker to a table the answer rests on
// (authChanged, called by presence/lib/db.ts) forgets everything at once; a change made
// elsewhere bites within the minute, where it used to bite at once.
export const WHO_ASKS_TTL_MS = 60_000;
let AUTH_EPOCH = 0;
/** The count of writes this worker made to the tables a sign-in rests on. */
export function authEpoch(): number { return AUTH_EPOCH; }
/** This worker wrote to such a table: every remembered answer is forgotten. */
export function authChanged(): void { AUTH_EPOCH++; whoMemo.clear(); }
/** Forget every remembered answer (tests). */
export function forgetWhoAsks(): void { whoMemo.clear(); }
type Identity = Omit<Principal, 'requestId'>;
const whoMemo = new Map<string, { at: number; epoch: number; p: Promise<Identity> }>();

/** The claims of a token GoTrue has already accepted (read only, never trusted on their own). */
export function jwtClaims(jwt: string): Record<string, unknown> | null {
  try {
    const part = jwt.split('.')[1] || '';
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
    return payload && typeof payload === 'object' ? payload : null;
  } catch (_) { return null; }
}
/** Builder list item 191: someone who turned two-step sign-in on (a verified second factor,
 *  an authenticator app) is signed in only once they typed its code, when their token says
 *  aal2. Their password or an emailed link alone (aal1) is not a sign-in here, so a stolen
 *  password gets nowhere. Everyone else signs in as before. Pure. */
export function secondStepMissing(user: { factors?: unknown } | null | undefined, jwt: string): boolean {
  const verified = (Array.isArray(user?.factors) ? user!.factors as Array<{ status?: unknown }> : []).some((f) => f?.status === 'verified');
  return verified && jwtClaims(jwt)?.aal !== 'aal2';
}

/** Builder list item 389 (Nov 22 2026 review, file 07 finding 6): has this person proved
 *  they own their email address? Supabase stamps email_confirmed_at when they use an
 *  emailed link or code: an invite, a sign-in code, a sign-up confirmation, a reset.
 *  Studio OS matches people to a client, a site seat or a studio seat by email address, so
 *  an address nobody proved is never matched to anything (their own user id still is).
 *  Pure. */
export function emailConfirmed(user: { email_confirmed_at?: unknown } | null | undefined): boolean {
  const at = user?.email_confirmed_at;
  return typeof at === 'string' && at.trim() !== '' && !Number.isNaN(Date.parse(at));
}

/** The address a person may be matched by: lower-case, and only once they've proved it. Pure. */
export function provenEmail(user: { email?: unknown; email_confirmed_at?: unknown } | null | undefined): string {
  return user && emailConfirmed(user) && user.email ? String(user.email).trim().toLowerCase() : '';
}

/** A value for a PostgREST or=() list, double-quoted so a comma, a dot or a bracket in it
 *  can't end the filter early, then made safe for the address (builder item 397). Pure. */
export function orValue(v: string): string {
  return encodeURIComponent('"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"');
}

export async function authUser(jwt: string): Promise<any | null> {
  if (!jwt) return null;
  const hit = authMemo.get(jwt);
  if (hit && Date.now() - hit.at < AUTH_MEMO_TTL_MS) return hit.user;
  try {
    const uRes = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_SERVICE, Authorization: `Bearer ${jwt}` }, signal: limited() });
    if (!uRes.ok) return null;
    const user = await uRes.json();
    if (!user || !user.id) return null;
    if (secondStepMissing(user, jwt)) return null;   // item 191: half signed in is not signed in
    // bounded: evict expired/oldest before insert
    if (authMemo.size >= 200) {
      const now = Date.now();
      for (const [k, v] of authMemo) { if (now - v.at >= AUTH_MEMO_TTL_MS) authMemo.delete(k); }
      if (authMemo.size >= 200) authMemo.delete(authMemo.keys().next().value as string);
    }
    authMemo.set(jwt, { user, at: Date.now() });
    return user;
  } catch (_) {
    return null; // network error talking to auth => deny, never guess
  }
}

export async function verifyStaff(req: Request): Promise<
  { userId: string; email: string; tenantId: string; role: string } | null
> {
  const jwt = req.headers.get('x-dds-user-jwt') || '';
  if (!jwt) return null;

  // 1) Validate the session and resolve the user. Bad/expired JWT => deny.
  const user: any = await authUser(jwt);
  if (!user || !user.id) return null;

  // 2) Confirm membership. NO row, query error, or anything unexpected => deny.
  //    This closes the old hole: a validated session is NOT sufficient.
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/memberships?user_id=eq.${encodeURIComponent(String(user.id))}` +
        `&select=tenant_id,role&limit=1`,
      { headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` }, signal: limited() },
    );
    if (!r.ok) return null;                                       // lookup failed => deny
    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;   // not staff => deny
    return {
      userId: String(user.id),
      email: (user.email ? String(user.email) : '').toLowerCase(),
      tenantId: String(rows[0].tenant_id),
      role: String(rows[0].role),
    };
  } catch (_) {
    return null; // any exception => deny
  }
}

// Compatibility shim so existing inline `const admin = await verifyAdminJwt(req)`
// checks keep compiling and behaving (now fail-closed). Returns email or null.
export async function verifyAdminJwt(req: Request): Promise<string | null> {
  const staff = await verifyStaff(req);
  return staff ? (staff.email || staff.userId) : null;
}

// ── REVOCATION (pipeline stage; Brief §12, decided 2026-07-05: immediate, no grace) ──
// For an authenticated STAFF request, decide whether it must be rejected despite
// a valid session, because either:
//   (a) the tenant's lifecycle state is suspended/closed/purge_scheduled, or
//   (b) the membership row was modified AFTER the token was issued
//       (updated_at > JWT iat) — a role change or removal that must bite within
//       minutes, not at token expiry.
// Returns null when the request may proceed, or an error code string to reject
// with. Fails CLOSED: any lookup error or unreadable iat => reject. One combined
// query (membership + embedded tenant state via the FK).
const REVOKED_STATES = new Set(['suspended', 'closed', 'purge_scheduled']);
export async function staffRevocation(userId: string, jwt: string): Promise<null | { code: string; status: number }> {
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/memberships?user_id=eq.${encodeURIComponent(userId)}` +
        `&select=updated_at,tenant_id,tenants(state)&limit=1`,
      { headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` }, signal: limited() },
    );
    if (!r.ok) return { code: 'revocation_check_failed', status: 401 };
    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) return { code: 'membership_revoked', status: 401 }; // row gone since resolve
    const row = rows[0];
    const state = row.tenants && (Array.isArray(row.tenants) ? row.tenants[0]?.state : row.tenants.state);
    if (state && REVOKED_STATES.has(String(state))) {
      return { code: state === 'closed' ? 'tenant_closed' : state === 'purge_scheduled' ? 'tenant_purge_scheduled' : 'tenant_suspended', status: 403 };
    }
    // membership-changed-after-issued check
    const iat = jwtIatMs(jwt);
    if (iat === null) return { code: 'membership_revoked', status: 401 }; // can't compare => fail closed
    const upd = row.updated_at ? new Date(row.updated_at).getTime() : 0;
    if (upd > iat) return { code: 'membership_revoked', status: 401 };
    return null;
  } catch (_) {
    return { code: 'revocation_check_failed', status: 401 }; // fail closed
  }
}

// Role ranking (per-route minimums stay with the owning function's route table).
export const ROLE_RANK: Record<string, number> = { owner: 4, admin: 3, staff: 2, readonly: 1 };
export function atLeast(role: string, min: keyof typeof ROLE_RANK): boolean {
  return (ROLE_RANK[role] || 0) >= ROLE_RANK[min];
}

// ════════════════════════════════════════════════════════════════════════════
//  TENANT RESOLVER (pipeline stage 1; additive seam — see clever-api history)
//  Contract: NEVER throws (any error resolves to a public principal). Public
//  requests (no JWT, no secret) cost zero I/O.
// ════════════════════════════════════════════════════════════════════════════
export type PrincipalKind = 'staff' | 'client' | 'public' | 'system';
export interface Principal {
  kind: PrincipalKind;
  userId: string | null;
  tenantId: string | null;
  role: string | null;      // owner|admin|staff|readonly for staff; 'client'; else null
  email: string | null;     // for the audit actor label
  jwt: string | null;       // the caller's token, for future RLS-scoped reads
  requestId: string;        // minted here; threads into logs + audit_log
  /** SC-1 drill-in, stamped by presence/index.ts ONLY after lib/scope.ts has
   *  authorised the x-dds-scope-site request: an agency member acting inside a
   *  CLIENT's business. Attribution reads this (lib/actor_kind.ts) so a scoped
   *  publish or connection is recorded as the studio's, never the client's.
   *  Absent/undefined on every un-scoped call. */
  scope?: { site_id: string; name: string } | null;
  /** An invited member's own active seat, stamped by presence/index.ts ONLY from
   *  their presence_site_members row, when they own no site. Unlike `scope` this is
   *  the business's side, not the studio's, so attribution stays 'client'. `cleared`
   *  is set by memberWriteGate for a write their role allows on this request.
   *  `can_publish` is the seat's own publish switch (builder item 220: a Designer's). */
  member?: { site_id: string; role: string; cleared?: boolean; can_publish?: boolean } | null;
}

// Decode the iat (issued-at) claim from a JWT payload WITHOUT signature
// verification — the token was already validated against the auth server by the
// resolver; this only reads the timestamp for the revocation comparison.
// Returns milliseconds, or null if unreadable (callers fail closed on null).
export function jwtIatMs(jwt: string): number | null {
  try {
    const part = jwt.split('.')[1] || '';
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
    return typeof payload.iat === 'number' ? payload.iat * 1000 : null;
  } catch (_) {
    return null;
  }
}


/** The token's identity: staff, a client, or signed in but unscoped (never a throw). */
async function identityOf(req: Request, jwt: string): Promise<Identity> {
  const now = Date.now();
  const hit = whoMemo.get(jwt);
  if (hit && hit.epoch === AUTH_EPOCH && now - hit.at < WHO_ASKS_TTL_MS) return hit.p;
  const p = lookupIdentity(req, jwt);
  whoMemo.set(jwt, { at: now, epoch: AUTH_EPOCH, p });
  const who = await p;
  if (who.kind !== 'staff' && who.kind !== 'client') { if (whoMemo.get(jwt)?.p === p) whoMemo.delete(jwt); }
  else if (whoMemo.size > 500) { for (const [k, v] of whoMemo) { if (now - v.at >= WHO_ASKS_TTL_MS) whoMemo.delete(k); } if (whoMemo.size > 500) whoMemo.delete(whoMemo.keys().next().value as string); }
  return who;
}
async function lookupIdentity(req: Request, jwt: string): Promise<Identity> {
  const pub: Identity = { kind: 'public', userId: null, tenantId: null, role: null, email: null, jwt: null };
  try {

    // staff first — reuse the existing fail-closed membership check
    const staff = await verifyStaff(req);
    if (staff) return { kind: 'staff', userId: staff.userId, tenantId: staff.tenantId, role: staff.role, email: staff.email || null, jwt };

    // otherwise validate the token and see if it belongs to a client (portal user)
    const user: any = await authUser(jwt);   // memoized — verifyStaff above already resolved it
    if (!user || !user.id) return { ...pub, jwt };

    const uid = String(user.id);
    // item 389: matched by email only once they've proved the address is theirs
    const email = provenEmail(user);
    const svc = { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` };
    try {
      // client linkage: a contact carrying this auth_user_id, or a client row by email.
      // tenantId comes from the owning client record (falls back to DDS #1).
      let tenantId: string | null = null;
      const cr = await fetch(`${SB_URL}/rest/v1/contacts?auth_user_id=eq.${encodeURIComponent(uid)}&select=id&limit=1`, { headers: svc, signal: limited() });
      const contacts = cr.ok ? await cr.json() : [];
      if (Array.isArray(contacts) && contacts.length) {
        const clr = await fetch(`${SB_URL}/rest/v1/clients?contact_id=eq.${encodeURIComponent(contacts[0].id)}&select=tenant_id&limit=1`, { headers: svc, signal: limited() });
        const cls = clr.ok ? await clr.json() : [];
        if (Array.isArray(cls) && cls.length) tenantId = cls[0].tenant_id ? String(cls[0].tenant_id) : null;
      }
      if (tenantId === null && email) {
        const clr = await fetch(`${SB_URL}/rest/v1/clients?or=(email.eq.${orValue(email)},contact_email.eq.${orValue(email)})&select=tenant_id&limit=1`, { headers: svc, signal: limited() });
        const cls = clr.ok ? await clr.json() : [];
        if (Array.isArray(cls) && cls.length) { tenantId = cls[0].tenant_id ? String(cls[0].tenant_id) : TENANT_ID; }
      }
      if (tenantId !== null) {
        return { kind: 'client', userId: uid, tenantId, role: 'client', email: email || null, jwt };
      }
      // MEMBERSHIP fallback: an invited workspace member (e.g. a client_reviewer
      // added via sharing) has no contacts/clients row of their own — their only
      // linkage is presence_site_members. Without this they 401 at the door and
      // the whole share-with-a-reviewer feature is unreachable. Their in-site
      // powers stay fail-closed (resolveSiteRole + the reviewer boundary).
      const seatBy = email ? `or=(user_id.eq.${encodeURIComponent(uid)},email.eq.${orValue(email)})` : `user_id=eq.${encodeURIComponent(uid)}`;
      const mm = await fetch(`${SB_URL}/rest/v1/presence_site_members?status=eq.active&${seatBy}&select=id&limit=1`, { headers: svc, signal: limited() });
      const members = mm.ok ? await mm.json() : [];
      if (Array.isArray(members) && members.length) {
        return { kind: 'client', userId: uid, tenantId: TENANT_ID, role: 'client', email: email || null, jwt };
      }
    } catch (_) { /* fall through */ }

    // valid token but neither staff nor a known client — authenticated but unscoped
    return { ...pub, userId: uid, email: email || null, jwt };
  } catch (_) {
    return pub;
  }
}

export async function resolvePrincipal(req: Request, body: any): Promise<Principal> {
  const requestId = (crypto as any).randomUUID ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(16).slice(2);
  const pub: Principal = { kind: 'public', userId: null, tenantId: null, role: null, email: null, jwt: null, requestId };
  try {
    // system: a valid scheduler/webhook shared secret in the body (run_scheduled_jobs, gsc_ingest, pi_weekly)
    if (body && typeof body.secret === 'string' && body.secret && SCHEDULER_SECRET && timingSafeEqual(body.secret, SCHEDULER_SECRET)) {   // item 397: the careful compare
      return { ...pub, kind: 'system' };
    }
    // operator (P5): a dedicated programmatic operator credential via header —
    // server-to-server only, works on GETs, not carried in a loggable body.
    // Resolves to a system-kind principal (which the operator routes already
    // accept) but tagged role 'operator' so the audit actor is honest. Distinct
    // from the cron secret; fail-closed — with no OPERATOR_SECRET set, no bypass.
    const opSecret = req.headers.get('x-operator-secret') || '';
    if (opSecret && OPERATOR_SECRET && timingSafeEqual(opSecret, OPERATOR_SECRET)) {   // item 397: the careful compare
      return { ...pub, kind: 'system', role: 'operator' };
    }
    const jwt = req.headers.get('x-dds-user-jwt') || '';
    if (!jwt) return pub; // no token => public, zero I/O
    return { ...(await identityOf(req, jwt)), requestId };
  } catch (_) {
    return pub; // NEVER throw from the resolver
  }
}
