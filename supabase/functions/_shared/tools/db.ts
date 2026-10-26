// ── Free Tools: service-role REST access to the tool_* tables ────────────────
// Same self-contained pattern as _shared/email_infra.ts: plain PostgREST calls
// with the service key. The tool_* tables grant nothing to anon (0136), so this
// is the only way in.

const SB_URL = () => (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '');
const SB_SERVICE = () => Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

export const dbReady = () => !!(SB_URL() && SB_SERVICE());

const headers = (extra: Record<string, string> = {}) => ({
  apikey: SB_SERVICE(),
  Authorization: `Bearer ${SB_SERVICE()}`,
  'Content-Type': 'application/json',
  ...extra,
});

async function call(path: string, init: RequestInit): Promise<Response> {
  return await fetch(`${SB_URL()}/rest/v1/${path}`, { ...init, signal: AbortSignal.timeout(10_000) });
}

export async function select<T = Record<string, unknown>>(path: string): Promise<T[]> {
  const r = await call(path, { headers: headers() });
  if (!r.ok) throw new Error(`select ${path.split('?')[0]} ${r.status}`);
  const rows = await r.json();
  return Array.isArray(rows) ? rows : [];
}

export async function insert<T = Record<string, unknown>>(table: string, row: Record<string, unknown>): Promise<T> {
  const r = await call(table, { method: 'POST', headers: headers({ Prefer: 'return=representation' }), body: JSON.stringify(row) });
  if (!r.ok) throw new Error(`insert ${table} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const rows = await r.json();
  return (Array.isArray(rows) ? rows[0] : rows) as T;
}

export async function patch(path: string, fields: Record<string, unknown>): Promise<void> {
  const r = await call(path, { method: 'PATCH', headers: headers({ Prefer: 'return=minimal' }), body: JSON.stringify(fields) });
  if (!r.ok) throw new Error(`patch ${path.split('?')[0]} ${r.status}`);
}

export async function upsert(table: string, onConflict: string, row: Record<string, unknown>): Promise<void> {
  const r = await call(`${table}?on_conflict=${onConflict}`, {
    method: 'POST', headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }), body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`upsert ${table} ${r.status}`);
}

export async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await call(`rpc/${fn}`, { method: 'POST', headers: headers(), body: JSON.stringify(args) });
  if (!r.ok) throw new Error(`rpc ${fn} ${r.status}`);
  return await r.json() as T;
}

export const enc = encodeURIComponent;

export async function getReport(id: string): Promise<Record<string, unknown> | null> {
  const rows = await select(`tool_reports?id=eq.${enc(id)}&select=*&limit=1`);
  return rows[0] || null;
}
