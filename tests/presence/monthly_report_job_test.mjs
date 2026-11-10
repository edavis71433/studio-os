// ── Nov 2026 review: the monthly report job, run against a stubbed database ──
//   deno run --allow-read --allow-env tests/presence/monthly_report_job_test.mjs
// One send per client per month even when two runs overlap; the month is claimed
// before the send and only the month mark is written, so a switch flipped during
// the send stays flipped; a client who can't be emailed is skipped once, with the
// reason, and is not a failure; a send that fails is tried again, three times at
// most; replies go to the studio's site; the busy-day check runs once a day and
// says nothing when its read fails or is cut off. No Supabase, no email leaves.
for (const [k, v] of Object.entries({ SUPABASE_URL: 'http://stub.local', SERVICE_ROLE_KEY: 'SERVICE-KEY', SUPABASE_ANON_KEY: 'ANON-KEY', SITE_URL: 'https://app.example', RESEND_KEY: 're_test_unused', RESEND_INBOUND_DOMAIN: 'reply.example.com' })) Deno.env.set(k, v);

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}${note ? ' — ' + note : ''}`); };

const CLIENT_SITE = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const STUDIO_SITE = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const CLIENT_ID = 'cccccccc-3333-4333-8333-cccccccccccc';
const NAME = '__monthly_report__';

// ── the world ──
let row, clientEmail, suppressed, resendOk, sends, onSend, visitsPages, visitsFail;
let clock = 0;
const stamp = () => new Date(Date.UTC(2026, 10, 1, 0, 0, 0, ++clock)).toISOString();
function reset(setting) {
  row = { id: 'row-1', site_id: CLIENT_SITE, body: JSON.stringify(setting), updated_at: stamp() };
  clientEmail = 'owner@client.example'; suppressed = null; resendOk = true; sends = []; onSend = null; visitsPages = []; visitsFail = false;
}
const stored = () => JSON.parse(row.body);
const reply = (body, status = 200, headers = {}) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url), 'http://stub.local');
  const method = (init.method || 'GET').toUpperCase();
  if (u.hostname === 'api.resend.com') {
    const body = JSON.parse(init.body);
    sends.push(body);
    if (onSend) onSend();
    return resendOk ? reply({ id: 'em_1' }) : reply({ message: 'down' }, 500);
  }
  if (u.hostname !== 'stub.local') return reply({}, 404);
  const table = u.pathname.replace('/rest/v1/', '');
  const q = decodeURIComponent(u.search);
  if (method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-range': '*/0' } });
  if (table === 'presence_sales_templates') {
    if (method === 'GET') return reply(q.includes(`name=eq.${NAME}`) ? [row] : []);
    if (method === 'PATCH') {
      const want = u.searchParams.get('updated_at');   // the compare-and-swap reserved_store uses
      if (want && want !== `eq.${row.updated_at}`) return reply([]);
      const b = JSON.parse(init.body); row = { ...row, body: b.body, updated_at: stamp() };
      return reply([{ id: row.id }]);
    }
    return reply([]);
  }
  if (table === 'presence_sites') return reply([{ id: CLIENT_SITE, client_id: CLIENT_ID, status: 'live', edition: 'presence', custom_domain: 'client.example' }]);
  if (table === 'clients') return reply([{ email: clientEmail, name: 'A client' }]);
  if (table === 'suppressed_emails') return reply(suppressed ? [{ reason: suppressed }] : []);
  if (table === 'presence_service_links') return reply([{ agency_site_id: STUDIO_SITE }]);
  if (table === 'presence_identity') return reply([{ business_name: 'The Studio' }]);
  if (table === 'presence_visits') {
    if (visitsFail) return reply({ message: 'boom' }, 500);
    const off = Number(u.searchParams.get('offset') || 0), lim = Number(u.searchParams.get('limit') || 1000);
    return reply(visitsPages.slice(off, off + lim));
  }
  return reply([]);
};

const P = '../../supabase/functions/presence';
const { runMonthlyReports } = await import(`${P}/ops/monthly_report.ts`);
const { runTrafficSpikes } = await import(`${P}/ops/traffic_spikes.ts`);
const { svcPages } = await import(`${P}/lib/db.ts`);
const quiet = async (fn) => { const e = console.error, w = console.warn; console.error = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.error = e; console.warn = w; } };
const DEC2 = '2026-12-02T09:00:00.000Z';   // November's report is due

// one send, replies to the studio
reset({ enabled: true, note: 'Thanks', last_month: '2026-10' });
{
  const r = await quiet(() => runMonthlyReports(20, DEC2));
  const s = stored();
  ok('a due report is sent once', r.sent === 1 && sends.length === 1, JSON.stringify(r));
  ok('…and recorded as sent for November, the gate set', s.last_month === '2026-11' && s.last_result?.status === 'sent' && s.last_result?.month === '2026-11');
  ok('replies go to the studio’s site, not the client’s', sends[0].reply_to === `${STUDIO_SITE}@reply.example.com`, String(sends[0].reply_to));
  ok('the next run sends nothing', (await quiet(() => runMonthlyReports(20, DEC2))).sent === 0 && sends.length === 1);
}

// two runs at once
reset({ enabled: true, note: '', last_month: '2026-10' });
{
  const [a, b] = await quiet(() => Promise.all([runMonthlyReports(20, DEC2), runMonthlyReports(20, DEC2)]));
  ok('two overlapping runs send one email', sends.length === 1 && a.sent + b.sent === 1, `${sends.length} ${a.sent} ${b.sent}`);
}

// the studio switches it off while the email is going
reset({ enabled: true, note: 'Old line', last_month: '2026-10' });
onSend = () => { const s = stored(); row = { ...row, body: JSON.stringify({ ...s, enabled: false, note: 'New line' }), updated_at: stamp() }; };
await quiet(() => runMonthlyReports(20, DEC2));
{
  const s = stored();
  ok('a switch flipped during the send stays flipped, and the new line stays', s.enabled === false && s.note === 'New line', JSON.stringify(s));
  ok('…and the send is still recorded', s.last_result?.status === 'sent' && s.last_month === '2026-11');
}

// switched off before the run: claimed nothing, sent nothing
reset({ enabled: true, note: '', last_month: '2026-10' });
{
  // the list read sees "on", but by the claim the studio has switched it off
  const listed = row;
  row = { ...row, body: JSON.stringify({ enabled: false, note: '', last_month: '2026-10' }), updated_at: stamp() };
  const realRow = row; row = listed;
  const origFetch = globalThis.fetch; let first = true;
  globalThis.fetch = async (url, init) => { const r = await origFetch(url, init); if (first && String(url).includes(`name=eq.${NAME}`) && String(url).includes('select=site_id,body')) { first = false; row = realRow; } return r; };
  const r = await quiet(() => runMonthlyReports(20, DEC2));
  globalThis.fetch = origFetch;
  ok('a report switched off before the claim is not sent', r.sent === 0 && sends.length === 0 && stored().enabled === false, JSON.stringify(r));
}

// no email on their record
reset({ enabled: true, note: '', last_month: '2026-10' });
clientEmail = null;
{
  const r = await quiet(() => runMonthlyReports(20, DEC2));
  const s = stored();
  ok('a client with no email is skipped, not a failure', r.failures === 0 && r.unreachable === 1 && sends.length === 0, JSON.stringify(r));
  ok('…with the reason saved for the card', s.last_result?.status === 'skipped' && s.last_result?.reason === 'no_email' && s.last_month === '2026-11');
  ok('…and not tried again every tick', (await quiet(() => runMonthlyReports(20, DEC2))).unreachable === 0);
}

// unsubscribed, bounced
for (const [reason, word] of [['opt_out', 'unsubscribed'], ['bounce', 'bounced']]) {
  reset({ enabled: true, note: '', last_month: '2026-10' });
  suppressed = reason;
  const r = await quiet(() => runMonthlyReports(20, DEC2));
  ok(`a client on the do-not-send list (${reason}) is skipped as "${word}"`, r.failures === 0 && sends.length === 0 && stored().last_result?.reason === word, JSON.stringify(r));
}

// a send that fails
reset({ enabled: true, note: '', last_month: '2026-10' });
resendOk = false;
{
  const r1 = await quiet(() => runMonthlyReports(20, DEC2));
  ok('a failed send counts as a failure and lets the month go again', r1.failures === 1 && stored().last_month === '2026-10' && stored().tries?.count === 1, JSON.stringify(stored()));
  await quiet(() => runMonthlyReports(20, DEC2));
  const r3 = await quiet(() => runMonthlyReports(20, DEC2));
  const s = stored();
  ok('after three tries the month is given up, said so', r3.failures === 1 && s.last_month === '2026-11' && s.last_result?.status === 'failed' && sends.length === 3, JSON.stringify(s));
  ok('…and the fourth run does nothing', (await quiet(() => runMonthlyReports(20, DEC2))).failures === 0 && sends.length === 3);
}
reset({ enabled: true, note: '', last_month: '2026-10' });
resendOk = false;
await quiet(() => runMonthlyReports(20, DEC2));
resendOk = true;
await quiet(() => runMonthlyReports(20, DEC2));
ok('a send that works on the second try is recorded as sent, the tries cleared', stored().last_result?.status === 'sent' && stored().tries === null && sends.length === 2);

// not the first days of the month
reset({ enabled: true, note: '', last_month: '2026-10' });
ok('after the 3rd nothing is read or sent', (await quiet(() => runMonthlyReports(20, '2026-12-04T00:00:00.000Z'))).not_due === true && sends.length === 0);

// the paged read
visitsPages = Array.from({ length: 2500 }, (_, i) => ({ i }));
{
  const all = await svcPages('presence_visits?site_id=eq.x', 'ts', 1000, 50);
  ok('a paged read gets every row across pages', all && all.rows.length === 2500 && all.truncated === false);
  const cut = await svcPages('presence_visits?site_id=eq.x', 'ts', 1000, 2);
  ok('…and says when it reached its bound', cut && cut.truncated === true && cut.rows.length === 2000);
  visitsFail = true;
  ok('…and answers nothing when a page fails, never a part', (await quiet(() => svcPages('presence_visits?site_id=eq.x', 'ts', 1000, 50))) === null);
  visitsFail = false;
}

// the busy-day check
ok('the busy-day check runs only in the first hour of the UTC day', (await quiet(() => runTrafficSpikes(200, '2026-11-10T05:00:00.000Z'))).not_due === true);
visitsFail = true;
ok('…and says nothing when its read fails', (await quiet(() => runTrafficSpikes(200, '2026-11-10T00:15:00.000Z'))).read_failed === true);
visitsFail = false;

const passed = results.filter((r) => r.p).length;
console.log(`${passed}/${results.length} passed`);
if (passed !== results.length) Deno.exit(1);
