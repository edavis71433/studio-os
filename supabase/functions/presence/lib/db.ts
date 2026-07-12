// Presence data access. Two identities, deliberately:
//   svc()  — service role, bypasses RLS. For system tables (entitlements,
//            change events) and counts the client may not read directly.
//   asUser() — anon key + the caller's JWT, so PostgREST runs UNDER the
//            client's identity and RLS scopes every row. This is the ratified
//            "caller-JWT" pattern (defense in depth): ownership is proven by
//            the database on every read/write, not re-implemented in code.
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
