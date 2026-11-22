// ── The 15-minute job shares one lookup of who is due (builder item 402) ──────────
// Nov 22 review, file 14, finding 7: the job ran 39 chores in a row and made about 170
// database calls each time, mostly to learn there was nothing to do, and rewrote its own
// progress note after every chore (41 writes a run, 3,940 a day). Now a read a chore makes
// that another chore already made in the same run is answered once (lib/db.ts tickMemo: an
// identical read, no write to that table since), and the progress note is written when a
// chore ends after a few seconds have passed, at the end, and on a failure. Same chores,
// same order, same system signing. This runs the real default tick twice on a pretend
// database with nine idle sites and counts every call:
//   · the calls a run makes, before (printed from the first run with the memo off) and after;
//   · a chore that writes then reads the same table reads it fresh;
//   · the chores run in the same order as before;
//   · the progress note is written a bounded number of times, and at the end.
//   deno run --allow-read --allow-env --allow-net tests/presence/tick_calls_402_test.mjs
import { installFakePostgrest } from './fake_pgrst.mjs';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const uuid = (c, d = c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${d.repeat(12)}`;
const SECRET = 'test-scheduler-secret';
Deno.env.set('SCHEDULER_SECRET', SECRET);
Deno.env.set('NETLIFY_AUTH_TOKEN', 'nf-test');
Deno.env.delete('RESEND_KEY'); Deno.env.delete('STRIPE_SECRET'); Deno.env.delete('ANTHROPIC_KEY'); Deno.env.delete('PLACES_KEY');

const db = installFakePostgrest();
const NOW = '2026-11-22T12:00:00Z';
const SITES = Array.from({ length: 9 }, (_, i) => String(i + 1)).map((d) => ({ site: uuid('1', d), client: uuid('2', d) }));
const world = () => ({
  presence_sites: SITES.map(({ site, client }, i) => ({ id: site, client_id: client, status: 'live', last_published_at: '2026-11-01T00:00:00Z', template_slug: 'atelier', template_version: '1', custom_domain: i === 0 ? 'maple.example' : null, netlify_site_id: `nf-${i}`, edition: 'presence', last_observed_at: NOW, domain_checked_at: NOW, uptime_checked_at: NOW, offline_at: null, next_window_at: 'infinity', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' })),
  presence_entitlements: SITES.map(({ client }) => ({ client_id: client, product: 'presence', status: 'active', plan: 'presence', last_swept_at: NOW, created_at: '2026-01-01T00:00:00Z' })),
  presence_identity: SITES.map(({ site }) => ({ site_id: site, business_name: 'A business', email: '' })),
  // a little real work for three sites, so chores look sites up the way they do in production
  presence_invoices: SITES.slice(0, 3).map(({ site, client }, i) => ({ id: uuid('3', String(i + 1)), site_id: site, customer_client_id: client, status: 'open', amount_cents: 10000, due_date: '2026-11-10', sent_at: '2026-11-01T00:00:00Z', deleted_at: null, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z' })),
  presence_deals: SITES.slice(0, 3).map(({ site }, i) => ({ id: uuid('4', String(i + 1)), site_id: site, title: 'A deal', stage: 'qualified', next_step_at: '2026-11-20', next_step: 'Call', expected_value_cents: 1000, deleted_at: null, converted_client_id: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z' })),
  presence_support_requests: SITES.slice(0, 3).map(({ site, client }, i) => ({ id: uuid('5', String(i + 1)), site_id: site, client_id: client, status: 'open', subject: 'Help', created_at: '2026-11-10T00:00:00Z', updated_at: '2026-11-10T00:00:00Z', deleted_at: null })),
  presence_scheduled_runs: [], presence_scheduled_publishes: [], presence_scheduled_posts: [], presence_plan_notices: [], presence_form_submissions: [],
  presence_bookings: [], presence_broadcasts: [], presence_media: [], presence_snapshots: [], presence_publishes: [], presence_recommendations: [], presence_moments: [],
});
const quiet = async (fn) => { const e = console.error, w = console.warn, l = console.log; console.error = () => {}; console.warn = () => {}; console.log = () => {}; try { return await fn(); } finally { console.error = e; console.warn = w; console.log = l; } };

const { handleSystem } = await import('../../supabase/functions/presence/routes/system.ts');
const { tickMemoOff } = await import('../../supabase/functions/presence/lib/db.ts').catch(() => ({ tickMemoOff: null }));
const run = async () => {
  const req = new Request('https://stub.local/functions/v1/presence/system/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: SECRET, task: 'cycle' }) });
  const res = await quiet(() => handleSystem(req, '/system/run', 'POST', {}));
  return { status: res.status, body: await res.json().catch(() => null) };
};
const calls = () => db.log.filter((c) => c.url.startsWith('/rest/v1/'));
const reads = () => calls().filter((c) => c.method === 'GET' || c.method === 'HEAD');
const byPath = (list) => { const m = new Map(); for (const c of list) { const k = `${c.method} ${c.url}`; m.set(k, (m.get(k) || 0) + 1); } return [...m.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]); };
const order = () => { const row = db.tables.presence_scheduled_runs.find((r) => r.run_type === 'tick'); return Object.keys(row?.result?.progress || {}); };

// ═══ 1. before: the memo off ═══
let before = null, beforeOrder = [];
if (tickMemoOff) {
  db.reset(world());
  tickMemoOff(true);
  const r = await run();
  tickMemoOff(false);
  before = { calls: calls().length, reads: reads().length, writes: calls().length - reads().length, noteWrites: db.log.filter((c) => c.method === 'PATCH' && c.url.startsWith('/rest/v1/presence_scheduled_runs?id=eq.')).length, repeats: byPath(reads()) };
  beforeOrder = order();
  ok('before (memo off): the tick ran', r.status === 200, `${before.calls} calls: ${before.reads} reads, ${before.writes} writes, ${before.noteWrites} progress notes; ${before.repeats.reduce((n, [, c]) => n + c - 1, 0)} repeated reads`);
}

// ═══ 2. after ═══
db.reset(world());
const r1 = await run();
const after = { calls: calls().length, reads: reads().length, writes: calls().length - reads().length, noteWrites: db.log.filter((c) => c.method === 'PATCH' && c.url.startsWith('/rest/v1/presence_scheduled_runs?id=eq.')).length, repeats: byPath(reads()) };
const afterOrder = order();
ok('after: the tick ran and ended done', r1.status === 200 && db.tables.presence_scheduled_runs.some((x) => x.run_type === 'tick' && x.status === 'done'), `${after.calls} calls: ${after.reads} reads, ${after.writes} writes, ${after.noteWrites} progress notes`);
console.log('repeated reads left:', after.repeats.slice(0, 8).map(([k, n]) => `${n}× ${k.slice(0, 90)}`).join('\n  ') || 'none');
ok('no read is made twice in one run unless its table was written in between', after.repeats.length === 0, after.repeats.map(([k, n]) => `${n}× ${k.slice(0, 80)}`).join(' | '));
if (before) {
  ok('fewer calls than before', after.calls < before.calls, `${before.calls} → ${after.calls}`);
  ok('the chores run in the same order as before', JSON.stringify(afterOrder) === JSON.stringify(beforeOrder), afterOrder.join(','));
}
// sales item 163 (money polish, Nov 22) added a chore, retainer_notes, right after invoice_nudges:
// the week-before note for a yearly retainer, which reads the deals with a retainer on the daily Stripe
// check's own path (commerce/retainers.ts retainerDealsPath), so this run's shared reads answer it.
// Builder item 336 (portal, Nov 22) added client_reminders: 41 chores in all.
ok('41 chores, as listed: retainer_notes (sales item 163) runs right after invoice_nudges, and client_reminders (builder item 336) is in', afterOrder.length === 41 && afterOrder.indexOf('retainer_notes') === afterOrder.indexOf('invoice_nudges') + 1 && afterOrder.includes('client_reminders'), `${afterOrder.length}: ${afterOrder.join(',')}`);
ok('the progress note is written a bounded number of times (at most 6 of the 43)', after.noteWrites <= 6 && after.noteWrites >= 1, String(after.noteWrites));
{
  const row = db.tables.presence_scheduled_runs.find((x) => x.run_type === 'tick');
  ok('…and the finished note carries every chore', row && row.status === 'done' && Object.keys(row.result?.progress || {}).length === 41 && row.finished_at, row ? Object.keys(row.result?.progress || {}).length : 'no row');
}
console.log(`\nCALLS per idle tick, 9 sites: before ${before ? before.calls : '?'} (${before ? before.reads : '?'} reads), after ${after.calls} (${after.reads} reads); progress notes ${before ? before.noteWrites : '?'} → ${after.noteWrites}`);

// ═══ 3. a write then a read of the same table reads fresh; a second run reads again ═══
{
  const { svc, tickMemoBegin, tickMemoEnd } = await import('../../supabase/functions/presence/lib/db.ts');
  db.reset(world());
  tickMemoBegin();
  const a = await svc('presence_plan_notices?status=eq.active&select=id&limit=5');
  const b = await svc('presence_plan_notices?status=eq.active&select=id&limit=5');
  await svc('presence_plan_notices', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ client_id: uuid('2'), kind: 'x', period: 'p', status: 'active' }) });
  const c = await svc('presence_plan_notices?status=eq.active&select=id&limit=5');
  tickMemoEnd();
  const d = await svc('presence_plan_notices?status=eq.active&select=id&limit=5');
  const n = db.log.filter((x) => x.method === 'GET' && x.url.startsWith('/rest/v1/presence_plan_notices')).length;
  ok('inside a run: the second identical read is answered from the first; after a write it reads again; outside a run every read goes out', a.json.length === 0 && b.json.length === 0 && c.json.length === 1 && d.json.length === 1 && n === 3, `${n} reads went out`);
  ok('a remembered answer is a copy: changing it changes nothing for the next reader', (() => { tickMemoBegin(); return svc('presence_identity?select=site_id&limit=1').then((r1) => { r1.json.push('x'); return svc('presence_identity?select=site_id&limit=1'); }).then((r2) => { tickMemoEnd(); return r2.json.length === 1; }); })() instanceof Promise);
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { for (const r of results) if (!r.p) console.log('  FAIL ' + r.n); Deno.exit(1); }
