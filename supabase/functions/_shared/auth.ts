// ── AUTH: staff verification, revocation, roles, principal resolution ──
// Extracted verbatim from clever-api/index.ts (M1 _shared extraction).
// Env reads are local to this module (config-only duplication; same injected
// values in every function of the project). Route tables (ROUTE_MIN_ROLE),
// the gate itself, opsLog and auditWrite stay in the owning function — this
// module is identity/roles only.

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

export async function verifyStaff(req: Request): Promise<
  { userId: string; email: string; tenantId: string; role: string } | null
> {
  const jwt = req.headers.get('x-dds-user-jwt') || '';
  if (!jwt) return null;

  // 1) Validate the session and resolve the user. Bad/expired JWT => deny.
  let user: any;
  try {
    const uRes = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: { apikey: SB_SERVICE, Authorization: `Bearer ${jwt}` },
    });
    if (!uRes.ok) return null;
    user = await uRes.json();
  } catch (_) {
    return null; // network error talking to auth => deny, never guess
  }
  if (!user || !user.id) return null;

  // 2) Confirm membership. NO row, query error, or anything unexpected => deny.
  //    This closes the old hole: a validated session is NOT sufficient.
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/memberships?user_id=eq.${encodeURIComponent(String(user.id))}` +
        `&select=tenant_id,role&limit=1`,
      { headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` } },
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
      { headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` } },
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

export async function resolvePrincipal(req: Request, body: any): Promise<Principal> {
  const requestId = (crypto as any).randomUUID ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(16).slice(2);
  const pub: Principal = { kind: 'public', userId: null, tenantId: null, role: null, email: null, jwt: null, requestId };
  try {
    // system: a valid scheduler/webhook shared secret in the body (run_scheduled_jobs, gsc_ingest, pi_weekly)
    if (body && typeof body.secret === 'string' && body.secret && SCHEDULER_SECRET && body.secret === SCHEDULER_SECRET) {
      return { ...pub, kind: 'system' };
    }
    // operator (P5): a dedicated programmatic operator credential via header —
    // server-to-server only, works on GETs, not carried in a loggable body.
    // Resolves to a system-kind principal (which the operator routes already
    // accept) but tagged role 'operator' so the audit actor is honest. Distinct
    // from the cron secret; fail-closed — with no OPERATOR_SECRET set, no bypass.
    const opSecret = req.headers.get('x-operator-secret') || '';
    if (opSecret && OPERATOR_SECRET && opSecret === OPERATOR_SECRET) {
      return { ...pub, kind: 'system', role: 'operator' };
    }
    const jwt = req.headers.get('x-dds-user-jwt') || '';
    if (!jwt) return pub; // no token => public, zero I/O

    // staff first — reuse the existing fail-closed membership check
    const staff = await verifyStaff(req);
    if (staff) return { kind: 'staff', userId: staff.userId, tenantId: staff.tenantId, role: staff.role, email: staff.email || null, jwt, requestId };

    // otherwise validate the token and see if it belongs to a client (portal user)
    let user: any = null;
    try {
      const uRes = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_SERVICE, Authorization: `Bearer ${jwt}` } });
      if (uRes.ok) user = await uRes.json();
    } catch (_) { /* fall through to public */ }
    if (!user || !user.id) return { ...pub, jwt };

    const uid = String(user.id);
    const email = (user.email ? String(user.email) : '').toLowerCase();
    const svc = { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` };
    try {
      // client linkage: a contact carrying this auth_user_id, or a client row by email.
      // tenantId comes from the owning client record (falls back to DDS #1).
      let tenantId: string | null = null;
      const cr = await fetch(`${SB_URL}/rest/v1/contacts?auth_user_id=eq.${encodeURIComponent(uid)}&select=id&limit=1`, { headers: svc });
      const contacts = cr.ok ? await cr.json() : [];
      if (Array.isArray(contacts) && contacts.length) {
        const clr = await fetch(`${SB_URL}/rest/v1/clients?contact_id=eq.${encodeURIComponent(contacts[0].id)}&select=tenant_id&limit=1`, { headers: svc });
        const cls = clr.ok ? await clr.json() : [];
        if (Array.isArray(cls) && cls.length) tenantId = cls[0].tenant_id ? String(cls[0].tenant_id) : null;
      }
      if (tenantId === null && email) {
        const clr = await fetch(`${SB_URL}/rest/v1/clients?or=(email.eq.${encodeURIComponent(email)},contact_email.eq.${encodeURIComponent(email)})&select=tenant_id&limit=1`, { headers: svc });
        const cls = clr.ok ? await clr.json() : [];
        if (Array.isArray(cls) && cls.length) { tenantId = cls[0].tenant_id ? String(cls[0].tenant_id) : TENANT_ID; }
      }
      if (tenantId !== null) {
        return { kind: 'client', userId: uid, tenantId, role: 'client', email: email || null, jwt, requestId };
      }
      // MEMBERSHIP fallback: an invited workspace member (e.g. a client_reviewer
      // added via sharing) has no contacts/clients row of their own — their only
      // linkage is presence_site_members. Without this they 401 at the door and
      // the whole share-with-a-reviewer feature is unreachable. Their in-site
      // powers stay fail-closed (resolveSiteRole + the reviewer boundary).
      const mm = await fetch(`${SB_URL}/rest/v1/presence_site_members?status=eq.active&or=(user_id.eq.${encodeURIComponent(uid)},email.eq.${encodeURIComponent(email)})&select=id&limit=1`, { headers: svc });
      const members = mm.ok ? await mm.json() : [];
      if (Array.isArray(members) && members.length) {
        return { kind: 'client', userId: uid, tenantId: TENANT_ID, role: 'client', email: email || null, jwt, requestId };
      }
    } catch (_) { /* fall through */ }

    // valid token but neither staff nor a known client — authenticated but unscoped
    return { ...pub, userId: uid, email: email || null, jwt };
  } catch (_) {
    return pub; // NEVER throw from the resolver
  }
}
