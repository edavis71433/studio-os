// ── List item 144: counts are counted by the database, not by fetching rows ──
// File 06 of the Nov 10 review, finding 12. The photo storage limit added up file
// sizes by fetching every photo row, the health coach counted unread messages and
// waiting approvals by fetching their ids, and the stock import counted photos the
// same way. PostgREST hands rows back in pages of 1,000, so each of those stopped
// short past 1,000, and each download grew with the site. The site home's five counts
// and the Files page's storage meter had the same shape. Now: HEAD + count=exact
// (svcCount) for counts, and presence_media_usage (0165) for the storage total.
//   deno run --allow-read --allow-env tests/presence/exact_counts_test.mjs
Deno.env.set('SUPABASE_URL', 'https://stub.local');
Deno.env.set('SERVICE_ROLE_KEY', 'service');

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));

// a database that holds 1,500 live photos for one site, answers counts the way
// PostgREST does, and never hands back more than 1,000 rows from a plain read
const SITE = '11111111-2222-4333-8444-555555555555';
const PHOTOS = Array.from({ length: 1500 }, (_, i) => ({ id: `p${i}`, site_id: SITE, bytes: 1000, deleted_at: null }));
let CALLS = [];
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const method = (init.method || 'GET').toUpperCase();
  CALLS.push({ path: u.pathname, method, query: decodeURIComponent(u.search), body: init.body ? String(init.body) : '' });
  if (u.pathname === '/rest/v1/rpc/presence_media_usage') {
    const { p_site } = JSON.parse(String(init.body || '{}'));
    const live = PHOTOS.filter((p) => p.site_id === p_site && !p.deleted_at);
    return new Response(JSON.stringify([{ files: live.length, bytes: live.reduce((n, p) => n + p.bytes, 0) }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (method === 'HEAD') {
    const n = u.pathname.endsWith('/presence_media') ? PHOTOS.length : u.pathname.endsWith('/presence_form_submissions') ? 1234 : 0;
    return new Response(null, { status: 200, headers: { 'content-range': n ? `0-0/${n}` : '*/0' } });
  }
  if (u.pathname.startsWith('/storage/')) return new Response(JSON.stringify({ url: '/object/upload/sign/x?token=t' }), { status: 200 });
  if (u.pathname.endsWith('/presence_media') && method === 'GET') return new Response(JSON.stringify(PHOTOS.slice(0, 1000)), { status: 200 });
  if (method === 'POST') return new Response(JSON.stringify([{ id: 'new' }]), { status: 201 });
  return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const { createUpload, mediaUsage } = await import('../../supabase/functions/presence/lib/media.ts');
const { storageSummary } = await import('../../supabase/functions/presence/lib/dam.ts');

// ═══ 1. the storage total ═══
{
  CALLS = [];
  const u = await mediaUsage(SITE);
  ok('the database counts and sums: 1,500 files, not the first 1,000', u?.files === 1500 && u?.bytes === 1_500_000, JSON.stringify(u));
  ok('one call, no rows fetched', CALLS.length === 1 && CALLS[0].method === 'POST' && CALLS[0].path === '/rest/v1/rpc/presence_media_usage' && JSON.parse(CALLS[0].body).p_site === SITE);
  Deno.env.set('MAX_MEDIA_FILES', '1200');
  CALLS = [];
  const r = await createUpload(SITE, { mime: 'image/jpeg', bytes: 100, alt_text: 'A photo' });
  ok('past 1,000 files the upload door still sees the site is full', r.error === 'quota_exceeded' && /1200 files/.test(r.message), JSON.stringify(r));
  ok('and asked only for the totals, before any upload address or row', CALLS.length === 1 && CALLS[0].path.endsWith('/rpc/presence_media_usage'));
  Deno.env.delete('MAX_MEDIA_FILES');
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => (String(url).includes('/rpc/presence_media_usage') ? new Response('{"code":"PGRST202"}', { status: 404 }) : real(url, init));
  ok('before the database step runs, the totals are unknown (the check is skipped, as on any failed read)', (await mediaUsage(SITE)) === null);
  globalThis.fetch = real;
}
{
  const page = Array.from({ length: 1000 }, () => ({ bytes: 1000 }));
  ok('the Files meter takes the database\'s totals when given them', storageSummary(page, { maxBytes: 10_000_000, maxFiles: 2000 }, { files: 1500, bytes: 1_500_000 }).files === 1500);
  ok('and counts its rows as before otherwise', storageSummary(page, { maxBytes: 10_000_000, maxFiles: 2000 }).files === 1000);
}

// ═══ 2. the wiring of every count the review named, and the two like them ═══
{
  const media = read('supabase/functions/presence/lib/media.ts');
  ok('upload door: no read of every photo row is left', !/presence_media\?site_id=eq\.\$\{siteId\}&deleted_at=is\.null&select=bytes/.test(media) && /const usage = await mediaUsage\(siteId\);/.test(media));
  const coach = read('supabase/functions/presence/routes/coach.ts');
  const health = coach.slice(coach.indexOf('export async function handleCoachHealth'), coach.indexOf('export async function handleCoachJourney'));
  ok('health coach: approvals and new messages are counted by the database', /svcCount\(`presence_infra_plans\?/.test(health) && /svcCount\(`presence_connection_writes\?/.test(health) && /svcCount\(`presence_form_submissions\?site_id=eq\.\$\{site\.id\}&status=eq\.new&spam=is\.false`\)/.test(health) && !/select=id`\)/.test(health));
  ok('health coach: the read is given numbers', /pendingApprovals: \(infra \?\? 0\) \+ \(writes \?\? 0\)/.test(health) && /leadsWaiting: leads \?\? 0/.test(health));
  const stock = read('supabase/functions/presence/routes/stock.ts');
  ok('stock import: the photo cap is a count', /const cnt = await svcCount\(`presence_media\?site_id=eq\.\$\{site\.id\}&deleted_at=is\.null`\);/.test(stock) && /cnt !== null && cnt >= cap/.test(stock) && !/select=id`\)/.test(stock));
  const site = read('supabase/functions/presence/routes/site.ts');
  ok('site home: its five counts are counts', /return \(await svcCount\(`\$\{table\}\?site_id=eq\.\$\{siteId\}\$\{extra\}`\)\) \?\? 0;/.test(site));
  const assets = read('supabase/functions/presence/routes/assets.ts');
  ok('Files meter: asks the database only when the list is a full page', /const totals = assets\.length >= ASSET_PAGE \? await mediaUsage\(site\.id\) : null;/.test(assets) && /storage: await storageFor\(site, assets\)/.test(assets) && /limit=\$\{ASSET_PAGE\}/.test(assets));
}

// ═══ 3. the database step ═══
{
  const mig = read('supabase/migrations/0165_media_usage.sql');
  const pack = read('docs/presence/APPLY-0165-prod.sql');
  const body = (s) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').trim();
  ok('0165 counts and sums one site\'s live photos', /count\(\*\)::bigint, coalesce\(sum\(m\.bytes\), 0\)::bigint/.test(mig) && /where m\.site_id = p_site and m\.deleted_at is null/.test(mig));
  ok('0165: read-only, a fixed search path, the server\'s key only', /language sql stable/.test(mig) && /set search_path = public/.test(mig) && /revoke all on function public\.presence_media_usage\(uuid\) from public, anon, authenticated;/.test(mig) && /grant execute on function public\.presence_media_usage\(uuid\) to service_role;/.test(mig));
  ok('0165: a rollback note', /^-- rollback: drop function if exists public\.presence_media_usage\(uuid\);/m.test(mig));
  ok('the apply pack runs the same statements, then says how to check', body(pack) === body(mig) && /-- check: select has_function_privilege\('service_role'/.test(pack));
  ok('0165 is the only migration with that number', [...Deno.readDirSync(new URL('supabase/migrations/', ROOT))].filter((e) => e.name.startsWith('0165_')).length === 1);
}

const failed = results.filter((r) => !r.p);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) Deno.exit(1);
