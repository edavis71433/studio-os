// Presence data access. Two identities, deliberately:
//   svc()  — service role, bypasses RLS. For system tables (entitlements,
//            change events) and counts the client may not read directly.
//   asUser() — anon key + the caller's JWT, so PostgREST runs UNDER the
//            client's identity and RLS scopes every row. This is the ratified
//            "caller-JWT" pattern (defense in depth): ownership is proven by
//            the database on every read/write, not re-implemented in code.
// siteDb() picks between them for site content. See below.
import { seesFullWorkspace, type SiteRole } from './site_roles.ts';

const SB_URL = Deno.env.get('SUPABASE_URL') || '';
const SB_SERVICE = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const SB_ANON = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('ANON_KEY') || '';

export const REST = `${SB_URL}/rest/v1`;

export async function svc(path: string, init: RequestInit = {}) {
  const r = await fetch(`${REST}/${path}`, {
    ...init,
    headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const text = await r.text();
  let json: any = null; try { json = text ? JSON.parse(text) : null; } catch { /* */ }
  return { ok: r.ok, status: r.status, json, text };
}

/** Exact row count without fetching rows (HEAD + Prefer: count=exact →
 *  Content-Range). Flat cost at any table size — the count-by-fetch pattern
 *  this replaces silently saturated at PostgREST's max-rows cap, so counts
 *  went WRONG at scale, not just slow. Returns null on any failure. */
export async function svcCount(path: string): Promise<number | null> {
  try {
    const r = await fetch(`${REST}/${path}${path.includes('?') ? '&' : '?'}select=id`, {
      method: 'HEAD',
      headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, Prefer: 'count=exact' },
    });
    if (!r.ok) return null;
    const range = r.headers.get('content-range') || '';   // e.g. "0-24/117" or "*/0"
    const total = Number(range.split('/')[1]);
    return Number.isFinite(total) ? total : null;
  } catch { return null; }
}

/** Fetch ALL rows of a query, paged — PostgREST's max-rows cap silently
 *  truncates large unbounded selects (a NONDETERMINISTIC subset without an
 *  order), which is a correctness cliff, not a perf issue. Deterministic order
 *  required. Hard-bounded by maxPages; logs if the bound is hit so saturation
 *  is never silent. */
export async function svcAll(path: string, orderCol: string, pageSize = 1000, maxPages = 10): Promise<any[]> {
  const out: any[] = [];
  for (let p = 0; p < maxPages; p++) {
    const sep = path.includes('?') ? '&' : '?';
    const r = await svc(`${path}${sep}order=${orderCol}.asc&limit=${pageSize}&offset=${p * pageSize}`);
    if (!r.ok) { console.error(`[db] svcAll page ${p} failed for ${path.split('?')[0]} — returning PARTIAL result (${out.length} rows)`); return out; }
    const rows = Array.isArray(r.json) ? r.json : [];
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }
  console.error(`[db] svcAll hit its ${maxPages * pageSize}-row bound for ${path.split('?')[0]} — results are TRUNCATED`);
  return out;
}

export async function asUser(jwt: string, path: string, init: RequestInit = {}) {
  const r = await fetch(`${REST}/${path}`, {
    ...init,
    headers: { apikey: SB_ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const text = await r.text();
  let json: any = null; try { json = text ? JSON.parse(text) : null; } catch { /* */ }
  return { ok: r.ok, status: r.status, json, text };
}

// ── siteDb: the ONE data path for a site's content ───────────────────────────
// Un-scoped, it is asUser: RLS proves ownership exactly as before. For an agency
// operator drilled into a client, RLS can only refuse: my_presence_site_ids()
// admits the owner, and the database cannot see which client this request was
// authorised for. Widening that policy would hand every client in the portfolio
// to the operator's JWT on every direct PostgREST call, past the role, reviewer,
// entitlement and edition gates that only exist in index.ts. So an authorised
// scope uses the service role, and pinViolation stands in for the RLS predicate:
// a query it can't prove is confined to the authorised site never leaves here.
//
// An invited member hits the same wall for the same reason: no policy mentions
// presence_site_members, and adding them to my_presence_site_ids() would let their
// JWT hard-delete rows directly, past the role table in lib/site_roles.ts. So a
// member's seat uses this path too, unless the role is limited to what's shared
// (client_reviewer), which stays under RLS.
export type SiteDb = (path: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json: any; text: string }>;

/** Why a service-role query is NOT provably confined to `siteId`, else null. Pure.
 *  PostgREST ANDs top-level filters, so one `site_id=eq.<site>` pins a read or
 *  update whatever else the query says. An insert has no filter: the row itself
 *  must name the site, and an upsert may only merge on site_id, because merging
 *  on any other key could overwrite another tenant's row. */
export function pinViolation(siteId: string, path: string, init: RequestInit = {}): string | null {
  const [table, query = ''] = path.split('?');
  if (!/^presence_[a-z0-9_]+$/.test(table)) return 'not_a_content_table';
  const q = new URLSearchParams(query);
  const method = (init.method || 'GET').toUpperCase();
  let body: any = null;
  if (init.body !== undefined && init.body !== null) {
    try { body = JSON.parse(String(init.body)); } catch { return 'unreadable_body'; }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return 'unreadable_body';
  }
  if (method === 'POST') {
    if (body?.site_id !== siteId) return 'insert_outside_site';
    const conflict = q.get('on_conflict');
    const merges = (new Headers(init.headers).get('Prefer') || '').includes('resolution=');
    if ((conflict || merges) && conflict !== 'site_id') return 'upsert_not_on_site_id';
    return null;
  }
  if (method !== 'GET' && method !== 'PATCH') return 'method_not_allowed';
  const filter = q.getAll('site_id');
  if (filter.length !== 1 || filter[0] !== `eq.${siteId}`) return 'not_filtered_to_site';
  if (body && 'site_id' in body && body.site_id !== siteId) return 'moves_row_out_of_site';
  return null;
}

/** Build the request's data path. `principal.scope` is stamped only by index.ts,
 *  only after resolveScopedSite authorised this exact site, and `principal.member`
 *  only from the caller's own active seat on it; anything short of that stays under
 *  the caller's JWT, where RLS refuses it. Checks scope rather than actsForClient:
 *  platform staff can hold an agency seat, and their scope is just as authorised,
 *  they are only attributed differently. A member's write also needs memberWriteGate
 *  to have cleared it, so a write that gate doesn't know about fails closed. */
export function siteDb(jwt: string, site: { id: string }, principal: { scope?: { site_id: string } | null; member?: { site_id: string; role: string; cleared?: boolean } | null }): SiteDb {
  const scoped = !!principal.scope?.site_id && principal.scope.site_id === site.id;
  const member = principal.member?.site_id === site.id && seesFullWorkspace(principal.member.role as SiteRole) ? principal.member : null;
  if (!scoped && !member) return (path, init = {}) => asUser(jwt, path, init);
  return (path, init = {}) => {
    const uncleared = member && !member.cleared && (init.method || 'GET').toUpperCase() !== 'GET';
    const why = pinViolation(site.id, path, init) ?? (uncleared ? 'write_not_cleared' : null);
    if (!why) return svc(path, init);
    console.error(`[db] refused a ${member ? 'member' : 'scoped'} query on ${path.split('?')[0]}: ${why}`);
    return Promise.resolve({ ok: false, status: 403, json: null, text: why });
  };
}
