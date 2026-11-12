// ── Items 160 and 176: the monthly report job with the studio's choices, against a stubbed database ──
//   deno run --allow-read --allow-env tests/presence/report_choices_job_test.mjs
// The client's report goes first; then each extra person gets their own, and the studio
// person who asked gets "[Your copy]"; a part switched off is out of every one; the month's
// suggestion is in each and logged; a quiet month under the studio's number sends nothing
// and says so; an extra person on the do-not-send list is left out. The stub is the one
// monthly_report_job_test.mjs uses. No Supabase, no email leaves.
for (const [k, v] of Object.entries({ SUPABASE_URL: 'http://stub.local', SERVICE_ROLE_KEY: 'SERVICE-KEY', SUPABASE_ANON_KEY: 'ANON-KEY', SITE_URL: 'https://app.example', RESEND_KEY: 're_test_unused', RESEND_INBOUND_DOMAIN: 'reply.example.com' })) Deno.env.set(k, v);

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}${note ? ' — ' + note : ''}`); };

const CLIENT_SITE = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const STUDIO_SITE = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const CLIENT_ID = 'cccccccc-3333-4333-8333-cccccccccccc';
const NAME = '__monthly_report__';

// ── the world ──
let row, clientEmail, suppressed, resendOk, sends, onSend, visitsPages, visitsFail;
let zone = null; const visitReads = [];   // D7: the client site's own clock (null: no row, the default), and the visit windows read
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
  if (table === 'presence_locations') return reply(zone ? [{ site_id: CLIENT_SITE, timezone: zone }] : []);
  if (table === 'presence_visits') {
    visitReads.push(q);
    if (visitsFail) return reply({ message: 'boom' }, 500);
    const off = Number(u.searchParams.get('offset') || 0), lim = Number(u.searchParams.get('limit') || 1000);
    return reply(visitsPages.slice(off, off + lim));
  }
  return reply([]);
};

const P = '../../supabase/functions/presence';
const { runMonthlyReports } = await import(`${P}/ops/monthly_report.ts`);
const quiet = async (fn) => { const e = console.error, w = console.warn; console.error = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.error = e; console.warn = w; } };
const DEC2 = '2026-12-02T09:00:00.000Z';   // November's report is due
const visit = (i) => ({ ts: '2026-11-10T12:00:00Z', kind: 'pageview', path: '/', ref_host: '', utm_source: '', device: 'mobile', country: 'US', visitor_hash: 'v' + i });

// everyone gets one: the client, two more people, the studio's copy
reset({ enabled: true, note: 'Thanks', last_month: '2026-10', cc: ['office@client.example', 'boss@client.example'], copy_to: 'eric@studio.example', parts_off: ['health'], propose: { mode: 'own', text: 'A page for open houses.' } });
visitsPages = [visit(1), visit(2), visit(3)];
{
  const r = await quiet(() => runMonthlyReports(20, DEC2));
  const s = stored();
  const to = sends.map((m) => (Array.isArray(m.to) ? m.to[0] : m.to));
  ok('the client first, then each extra person, then the studio’s copy', JSON.stringify(to) === JSON.stringify(['owner@client.example', 'office@client.example', 'boss@client.example', 'eric@studio.example']), JSON.stringify(to));
  ok('one month sent, counted once', r.sent === 1 && s.last_result?.status === 'sent' && s.last_month === '2026-11', JSON.stringify(r));
  ok('the card can say how many more people got it', s.last_result?.cc === 2, JSON.stringify(s.last_result));
  ok('the studio’s copy says so, in its subject and on top', /^\[Your copy\] /.test(sends[3].subject) && /Your copy of the report/.test(sends[3].html) && !/^\[/.test(sends[0].subject));
  ok('the suggestion is in every one', sends.every((m) => /What we suggest next/.test(m.html) && /A page for open houses\./.test(m.html)));
  ok('a part switched off is out of every one', sends.every((m) => !/Website health/.test(m.html)));
  ok('the suggestion that went out is logged for November', s.propose?.log?.[0]?.month === '2026-11' && s.propose.log[0].key === 'own');
  ok('nothing goes twice', (await quiet(() => runMonthlyReports(20, DEC2))).sent === 0 && sends.length === 4);
}

// an extra person on the do-not-send list is left out; the client still gets theirs
reset({ enabled: true, note: '', last_month: '2026-10', cc: ['gone@client.example'] });
visitsPages = [visit(1)];
{
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url), 'http://stub.local');
    if (u.pathname.endsWith('/suppressed_emails')) return new Response(JSON.stringify(decodeURIComponent(u.search).includes('gone@client.example') ? [{ reason: 'opt_out' }] : []), { status: 200, headers: { 'Content-Type': 'application/json' } });
    return origFetch(url, init);
  };
  const r = await quiet(() => runMonthlyReports(20, DEC2));
  globalThis.fetch = origFetch;
  const s = stored();
  ok('an unsubscribed extra person gets nothing, the client does', sends.length === 1 && (Array.isArray(sends[0].to) ? sends[0].to[0] : sends[0].to) === 'owner@client.example' && r.sent === 1, JSON.stringify(sends.map((m) => m.to)));
  ok('…and the month counts nobody more', s.last_result?.status === 'sent' && !s.last_result?.cc);
}

// a quiet month under the studio's number
reset({ enabled: true, note: '', last_month: '2026-10', quiet_min: 30 });
visitsPages = [visit(1), visit(2)];
{
  const r = await quiet(() => runMonthlyReports(20, DEC2));
  const s = stored();
  ok('a quiet month sends nothing', sends.length === 0 && r.sent === 0 && r.quiet === 1, JSON.stringify(r));
  ok('…and is handled, with the reason for the card', s.last_month === '2026-11' && s.last_result?.status === 'skipped' && s.last_result?.reason === 'quiet');
  ok('…once', (await quiet(() => runMonthlyReports(20, DEC2))).quiet === undefined && sends.length === 0);
}

// a visit count that can't be read never skips a report
reset({ enabled: true, note: '', last_month: '2026-10', quiet_min: 30 });
visitsFail = true;
{
  const r = await quiet(() => runMonthlyReports(20, DEC2));
  ok('visits that couldn’t be read never count as quiet', r.sent === 1 && sends.length === 1, JSON.stringify(r));
}

// a busy month over the number goes as usual
reset({ enabled: true, note: '', last_month: '2026-10', quiet_min: 2 });
visitsPages = [visit(1), visit(2), visit(3)];
{
  const r = await quiet(() => runMonthlyReports(20, DEC2));
  ok('a month at or over the number goes', r.sent === 1 && sends.length === 1, JSON.stringify(r));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ REPORT CHOICES JOB (items 160 and 176): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
