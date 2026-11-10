// ── Item 104 (Nov 2026 bug hunt B14): "Won this month" is the caller's month ──
// The month was cut from the UTC time: at 4pm in Los Angeles on the last day of the
// month the UTC month had already turned, so "Won this month" dropped to zero, and a
// deal won that evening was counted in the next month. Pipeline now sends its day
// (?today=, item 65) and its clock (?tzo=, minutes behind UTC); the summary takes the
// month from the day and puts each won deal in the month of the caller's clock.
// Without them, the UTC month, as before. Real handler against the shared in-memory
// PostgREST; every name is made up.
//   deno run --allow-read --allow-env --allow-net tests/presence/won_month_local_test.mjs
import { installFakePostgrest } from './fake_pgrst.mjs';
const SITE = '11111111-1111-4111-8111-111111111111', CLIENT = '22222222-2222-4222-8222-222222222222';
const db = installFakePostgrest();
const L = await import('../../supabase/functions/presence/lib/sales_lifecycle.ts');
const S = await import('../../supabase/functions/presence/routes/sales.ts');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n, note); } };

// ── callerOffsetMinutes: only a whole number some time zone uses ──
ok('Los Angeles in winter: 480', L.callerOffsetMinutes('480') === 480);
ok('Paris: -60', L.callerOffsetMinutes('-60') === -60);
ok('UTC: 0', L.callerOffsetMinutes('0') === 0);
ok('the far edges: UTC-12 (720) and UTC+14 (-840)', L.callerOffsetMinutes('720') === 720 && L.callerOffsetMinutes('-840') === -840);
ok('past the edges → null', L.callerOffsetMinutes('721') === null && L.callerOffsetMinutes('-841') === null);
ok('junk → null', ['', ' ', '4.5', '480;drop', 'abc', '1e3', '0x1E0', null, undefined, 480].every((v) => L.callerOffsetMinutes(v) === null));

// ── summarizePipeline: the month of the caller's day, each win on the caller's clock ──
// 5:30pm Oct 31 in Los Angeles (PDT, 420 minutes behind) = 00:30 Nov 1 UTC
const NOW = '2026-11-01T00:30:00.000Z';
const DEALS = [
  { stage: 'won', converted_client_id: 'c1', converted_at: '2026-10-12T18:00:00Z', expected_value_cents: 300000 },   // mid-October: October anywhere
  { stage: 'won', converted_client_id: 'c2', converted_at: '2026-11-01T00:10:00Z', expected_value_cents: 200000 },   // 5:10pm Oct 31 in LA, 00:10 Nov 1 UTC
  { stage: 'won', converted_client_id: 'c3', converted_at: '2026-09-30T23:30:00Z', expected_value_cents: 999900 },   // September in LA and in UTC
  { stage: 'lead', expected_value_cents: 50000 },
];
{
  const utc = L.summarizePipeline(DEALS, NOW);
  ok('no caller day (an older page): the UTC month — November, one deal', utc.won_month.count === 1 && utc.won_month.value_cents === 200000, JSON.stringify(utc.won_month));
  const dayOnly = L.summarizePipeline(DEALS, NOW, L.WIN_RATE_WINDOW_DAYS, { today: '2026-10-31' });
  ok('the caller’s day alone: October, but the 5:10pm win is still filed by UTC', dayOnly.won_month.count === 1 && dayOnly.won_month.value_cents === 300000, JSON.stringify(dayOnly.won_month));
  const local = L.summarizePipeline(DEALS, NOW, L.WIN_RATE_WINDOW_DAYS, { today: '2026-10-31', offsetMinutes: 420 });
  ok('Los Angeles at 5:30pm on Oct 31: both October wins count — the tile no longer drops to zero', local.won_month.count === 2 && local.won_month.value_cents === 500000, JSON.stringify(local.won_month));
  const nextMorning = L.summarizePipeline(DEALS, '2026-11-01T16:00:00.000Z', L.WIN_RATE_WINDOW_DAYS, { today: '2026-11-01', offsetMinutes: 420 });
  ok('the next morning in Los Angeles: November, and the Oct 31 evening win stays in October', nextMorning.won_month.count === 0, JSON.stringify(nextMorning.won_month));
  const paris = L.summarizePipeline([{ stage: 'won', converted_client_id: 'c9', converted_at: '2026-10-31T23:30:00Z', expected_value_cents: 100 }], '2026-10-31T23:40:00.000Z', L.WIN_RATE_WINDOW_DAYS, { today: '2026-11-01', offsetMinutes: -60 });
  ok('Paris just after midnight on Nov 1: a win at 00:30 local is November’s', paris.won_month.count === 1, JSON.stringify(paris.won_month));
  ok('open pipeline and the win rate are unchanged by the caller’s clock', local.open.count === utc.open.count && local.win_rate.won === utc.win_rate.won && local.total === utc.total);
  const clockOnly = L.summarizePipeline(DEALS, NOW, L.WIN_RATE_WINDOW_DAYS, { offsetMinutes: 420 });
  ok('the caller’s clock alone gives the same month (now on that clock)', clockOnly.won_month.count === 2 && clockOnly.won_month.value_cents === 500000, JSON.stringify(clockOnly.won_month));
  const junkDay = L.summarizePipeline(DEALS, NOW, L.WIN_RATE_WINDOW_DAYS, { today: 'Oct 31' });
  ok('a malformed day and no clock: the UTC month', junkDay.won_month.count === 1 && junkDay.won_month.value_cents === 200000, JSON.stringify(junkDay.won_month));
}

// ── GET /sales/summary reads ?today= and ?tzo= ──
const site = { id: SITE, client_id: CLIENT, status: 'live', edition: 'presence' };
const owner = { kind: 'client', userId: 'u1', email: 'owner@studio.test', jwt: 'jwt-owner', requestId: 't' };
const req = (path) => new Request(`https://fn.test/functions/v1/presence${path}`);
const body = async (r) => (await r.json().catch(() => null)) || {};
{
  // "now" is the real clock in the handler, so the win sits one minute into this UTC month:
  // this month's in UTC, and the evening before — last month's — in Los Angeles (8 hours behind)
  const nowMs = Date.now(), n = new Date(nowMs);
  const wonMs = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1, 0, 1), wonAt = new Date(wonMs).toISOString();
  db.reset({ presence_deals: [{ id: 'dddddddd-0000-4000-8000-000000000001', site_id: SITE, title: 'Acme website', stage: 'won', converted_client_id: CLIENT, converted_at: wonAt, updated_at: wonAt, expected_value_cents: 250000, deleted_at: null }], presence_invoices: [] });
  const plain = await body(await S.handleSalesSummary(req('/sales/summary'), site, owner, {}));
  ok('summary without ?today/?tzo: a win one minute into the UTC month is this month’s', nowMs < wonMs || plain.data?.won_month?.count === 1, JSON.stringify(plain.data?.won_month));
  const la = (ms) => new Date(ms - 480 * 60_000).toISOString().slice(0, 7);
  const want = la(wonMs) === la(nowMs) ? 1 : 0;   // 0 except in the first 8 hours of a UTC month
  const local = await body(await S.handleSalesSummary(req('/sales/summary?today=' + new Date(nowMs - 480 * 60_000).toISOString().slice(0, 10) + '&tzo=480'), site, owner, {}));
  ok('summary with ?today and ?tzo=480: the same win is Los Angeles’s LAST month — not counted now', local.data?.won_month?.count === want, JSON.stringify({ got: local.data?.won_month, want }));
  const junk = await body(await S.handleSalesSummary(req('/sales/summary?tzo=lots'), site, owner, {}));
  ok('summary with a junk ?tzo: the UTC clock', nowMs < wonMs || junk.data?.won_month?.count === 1, JSON.stringify(junk.data?.won_month));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
