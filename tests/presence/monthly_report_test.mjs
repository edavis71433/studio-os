// ── Builder list item 58 (Nov 2026): the monthly report email to clients ──
//   deno run --allow-read --allow-env tests/presence/monthly_report_test.mjs
// The setting is one reserved row; last month is found in UTC; the report is due
// only in the first days of a month, once; the fold uses the same visit counting
// as Analytics; the words say a part that couldn't be read rather than a zero.
import {
  normalizeReportSetting, lastMonth, reportDueNow, foldReport, reportHtml, REPORT_NOTE_MAX, REPORT_SEND_DAYS,
  applyReportChange, blockedReason, afterFailure, REPORT_MAX_TRIES, BLOCK_WORDS,
} from '../../supabase/functions/presence/ops/monthly_report.ts';
import { RESERVED_NAMES } from '../../supabase/functions/presence/lib/reserved_store.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}`); };
const read = (p) => Deno.readTextFileSync(new URL('../../' + p, import.meta.url));

// the setting
ok('the reserved row has a name', RESERVED_NAMES.monthlyReport === '__monthly_report__');
ok('an empty row reads as off with no line', JSON.stringify(normalizeReportSetting(null)) === JSON.stringify({ enabled: false, note: '', last_month: null, last_result: null, tries: null, updated_by: null, updated_at: null }));
ok('what happened last is kept when well formed, dropped when not', normalizeReportSetting({ last_result: { month: '2026-10', status: 'skipped', reason: 'no_email', at: 'x' } }).last_result?.reason === 'no_email' && normalizeReportSetting({ last_result: { month: '2026-10', status: 'lost' } }).last_result === null && normalizeReportSetting({ last_result: { month: 'Oct', status: 'sent' } }).last_result === null);
ok('only true turns it on', normalizeReportSetting({ enabled: 'yes' }).enabled === false && normalizeReportSetting({ enabled: true }).enabled === true);
ok('the line is capped', normalizeReportSetting({ note: 'x'.repeat(REPORT_NOTE_MAX + 50) }).note.length === REPORT_NOTE_MAX);
ok('a malformed last month is dropped', normalizeReportSetting({ last_month: 'October' }).last_month === null && normalizeReportSetting({ last_month: '2026-10' }).last_month === '2026-10');

// last month, in UTC
const nov = lastMonth('2026-11-02T03:00:00.000Z');
ok('last month from early November is October', nov.month === '2026-10' && nov.label === 'October 2026');
ok('its bounds are the first of October to the first of November', nov.startIso === '2026-10-01T00:00:00.000Z' && nov.endIso === '2026-11-01T00:00:00.000Z');
ok('January looks back to December of the year before', lastMonth('2027-01-01T00:00:00.000Z').month === '2026-12');

// due
const on = normalizeReportSetting({ enabled: true });
ok('due on the 1st when nothing was sent', reportDueNow(on, '2026-11-01T06:00:00.000Z'));
ok(`due up to the ${REPORT_SEND_DAYS}rd`, reportDueNow(on, `2026-11-0${REPORT_SEND_DAYS}T23:00:00.000Z`));
ok('not due later in the month', !reportDueNow(on, `2026-11-0${REPORT_SEND_DAYS + 1}T00:00:00.000Z`) && !reportDueNow(on, '2026-11-20T00:00:00.000Z'));
ok('not due when last month was already sent', !reportDueNow({ ...on, last_month: '2026-10' }, '2026-11-02T00:00:00.000Z'));
ok('due again the next month', reportDueNow({ ...on, last_month: '2026-10' }, '2026-12-02T00:00:00.000Z'));
ok('never due while off', !reportDueNow(normalizeReportSetting({ enabled: false }), '2026-11-01T00:00:00.000Z'));

// switching on (Nov 10 review, finding 4): the first report is next month's, as the card says
{
  const off = normalizeReportSetting({ enabled: false });
  const onDec2 = applyReportChange(off, { enabled: true }, 'eric@example.com', '2026-12-02T10:00:00.000Z');
  ok('switched on during the first days, last month counts as handled', onDec2.enabled && onDec2.last_month === '2026-11' && !reportDueNow(onDec2, '2026-12-02T11:00:00.000Z'));
  ok('…and the report goes out the next month', reportDueNow(onDec2, '2027-01-01T06:00:00.000Z'));
  const onMid = applyReportChange(off, { enabled: true }, null, '2026-11-10T10:00:00.000Z');
  ok('switched on mid-month, the first report is the one for this month', onMid.last_month === '2026-10' && reportDueNow(onMid, '2026-12-01T06:00:00.000Z'));
  const sentAlready = applyReportChange(normalizeReportSetting({ enabled: false, last_month: '2026-11' }), { enabled: true }, null, '2026-12-02T10:00:00.000Z');
  ok('switching on never moves the mark backwards', sentAlready.last_month === '2026-11');
  const noteOnly = applyReportChange(normalizeReportSetting({ enabled: true, last_month: '2026-09' }), { note: 'Hi' }, null, '2026-11-02T10:00:00.000Z');
  ok('editing the line leaves the switch and the mark alone', noteOnly.enabled && noteOnly.last_month === '2026-09' && noteOnly.note === 'Hi');
  ok('switching off keeps the mark', applyReportChange(onDec2, { enabled: false }, null, '2026-12-03T00:00:00.000Z').last_month === '2026-11');
}

// who can't be emailed (findings 2 and F4)
ok('no address, or not an address, is no_email', blockedReason(null, null) === 'no_email' && blockedReason('not-an-address', null) === 'no_email');
ok('an unsubscribe reads as unsubscribed; a bounce or complaint as bounced', blockedReason('a@b.co', 'opt_out') === 'unsubscribed' && blockedReason('a@b.co', 'bounce') === 'bounced' && blockedReason('a@b.co', 'complaint') === 'bounced');
ok('a good address on no list is fine', blockedReason('a@b.co', null) === null);
ok('every reason has words for the card', ['no_email', 'unsubscribed', 'bounced'].every((k) => typeof BLOCK_WORDS[k] === 'string' && BLOCK_WORDS[k].length > 5));

// a send that fails (finding F4): tried again, a few times at most
{
  const claimed = normalizeReportSetting({ enabled: true, last_month: '2026-11' });
  const once = afterFailure(claimed, '2026-11', '2026-10', '2026-12-02T00:00:00.000Z');
  ok('a first failure lets the month go again', once.last_month === '2026-10' && once.tries?.count === 1 && once.last_result === null);
  let s = once; for (let i = 1; i < REPORT_MAX_TRIES; i++) s = afterFailure({ ...s, last_month: '2026-11' }, '2026-11', '2026-10', '2026-12-02T00:00:00.000Z');
  ok(`after ${REPORT_MAX_TRIES} it is handled, as failed`, s.last_month === '2026-11' && s.last_result?.status === 'failed' && s.tries?.count === REPORT_MAX_TRIES);
  ok('a failure never moves someone else’s newer mark', afterFailure(normalizeReportSetting({ last_month: '2026-12' }), '2026-11', '2026-10', 'x').last_month === '2026-12');
}

// the fold
const startMs = Date.parse(nov.startIso), endMs = Date.parse(nov.endIso);
const pv = (day, path, who) => ({ ts: `2026-10-${day}T12:00:00.000Z`, kind: 'pageview', path, visitor_hash: who });
const visits = [pv('03', '/', 'a'), pv('03', '/services', 'a'), pv('10', '/', 'b'), pv('12', '/services', 'c'), pv('12', '/services', 'c'), { ts: '2026-09-30T23:00:00.000Z', kind: 'pageview', path: '/old', visitor_hash: 'z' }, { ts: '2026-10-15T12:00:00.000Z', kind: 'event', path: '/', visitor_hash: 'a' }];
const d = foldReport({ month: nov.month, label: nov.label, startMs, endMs, visits, enquiries: 2, publishes: [{ created_at: '2026-10-05T10:00:00.000Z' }, { created_at: '2026-10-20T10:00:00.000Z' }, { created_at: '2026-09-01T10:00:00.000Z' }], address: 'https://marlows.example', visitsCap: 5000 });
ok('visitors are distinct people in the month', d.visitors === 3);
ok('page views count pageviews in the month only', d.pageviews === 5);
ok('the top pages are the most read first', d.topPages[0].path === '/services' && d.topPages[0].views === 3 && d.topPages[1].path === '/');
ok('publishes outside the month are left out, the last one named', d.publishes === 2 && d.lastPublishedAt === '2026-10-20T10:00:00.000Z');
ok('enquiries pass through', d.enquiries === 2 && d.address === 'https://marlows.example');
ok('a capped read is marked', foldReport({ month: nov.month, label: nov.label, startMs, endMs, visits, enquiries: 0, publishes: [], address: '', visitsCap: visits.length }).truncated === true && d.truncated === false);
const missing = foldReport({ month: nov.month, label: nov.label, startMs, endMs, visits: null, enquiries: null, publishes: null, address: '', visitsCap: 5000 });
ok('a read that failed is null, not zero', missing.visitors === null && missing.pageviews === null && missing.enquiries === null && missing.publishes === null && missing.topPages.length === 0);

// the reply address (full review Nov 10, D1): the STUDIO's site, so the reply door lets the client in
ok('a reply to the report reaches the studio, not the client’s own site', /siteId: studio \|\| site\.id/.test(read('supabase/functions/presence/ops/monthly_report.ts')) && !/siteId: site\.id \}\);/.test(read('supabase/functions/presence/ops/monthly_report.ts')));

// the words
const full = reportHtml(d, { studioName: 'Davis Digital Studio', note: 'Thanks for a great month.\nThe new photos are working.', clientName: 'Marlow’s Kitchen' });
ok('the subject names the month', full.subject === 'Your website in October 2026');
ok('the heading names the client and the site', /Marlow’s Kitchen, here’s how your website did at <a href="https:\/\/marlows\.example"[^>]*>marlows\.example<\/a>/.test(full.html));
ok('the studio’s line sits at the top, line breaks kept, signed', /<blockquote[^>]*>Thanks for a great month\.<br>The new photos are working\.<br>.*Davis Digital Studio/.test(full.html));
ok('the numbers read as words', /Visits.*>3<.*5 pages viewed/.test(full.html) && /Enquiries.*>2<.*People wrote in/.test(full.html));
ok('the top pages are named plainly', /What people read most.*<li>services <span[^>]*>· 3 views<\/span><\/li><li>Home page <span[^>]*>· 2 views/.test(full.html));
ok('what changed counts the publishes and dates the last', /2 updates went live, the last on October 20\./.test(full.html));
ok('every line is escaped', !/<script/.test(reportHtml(d, { studioName: '<script>', note: '<b>hi</b>', clientName: null }).html.replace(/&lt;script&gt;/g, '')) && /&lt;b&gt;hi&lt;\/b&gt;/.test(reportHtml(d, { studioName: 'S', note: '<b>hi</b>' }).html));
const quiet = reportHtml(missing, { studioName: 'S', note: '' });
ok('a part that couldn’t be read says so', /couldn’t read the visit counts/.test(quiet.html) && /couldn’t read the enquiries/.test(quiet.html) && /couldn’t read the publish history/.test(quiet.html));
ok('without a line there is no quote block', !/<blockquote/.test(quiet.html));
const zero = reportHtml(foldReport({ month: nov.month, label: nov.label, startMs, endMs, visits: [], enquiries: 0, publishes: [], address: '', visitsCap: 5000 }), { studioName: 'S', note: '' });
ok('a quiet month is said kindly, with nothing published', /A quiet month for visitors/.test(zero.html) && /No one wrote in/.test(zero.html) && /nothing was published this month/.test(zero.html));
ok('one of each reads singular', (() => { const one = reportHtml(foldReport({ month: nov.month, label: nov.label, startMs, endMs, visits: [pv('03', '/', 'a')], enquiries: 1, publishes: [{ created_at: '2026-10-05T10:00:00.000Z' }], address: '', visitsCap: 5000 }), { studioName: 'S', note: '' }).html; return /1 page viewed/.test(one) && /Someone wrote in/.test(one) && /one update went live/.test(one) && /· 1 view</.test(one); })());

// wiring
const system = read('supabase/functions/presence/routes/system.ts');
ok('the job runs in the hygiene group and the default chain', (system.match(/runMonthlyReports\(20\)/g) || []).length === 2);
const index = read('supabase/functions/presence/index.ts');
ok('the three site routes are registered', /'\/report\/monthly' && method === 'GET'/.test(index) && /'\/report\/monthly' && method === 'PUT'/.test(index) && /'\/report\/monthly\/preview' && method === 'POST'/.test(index));
const settings = read('settings.html');
ok('the Settings card is inside a client only and needs configure', /key: 'report'[^\n]*scopedOnly: true[^\n]*cap: 'configure'/.test(settings) && /c\.scopedOnly && !SCOPE/.test(settings));
ok('the card reads what happened last, not the bare month mark', /function reportStatusLine\(d\)/.test(settings) && !/d\.last_month \? 'Last sent/.test(settings));
const mr = read('supabase/functions/presence/ops/monthly_report.ts');
ok('the job claims the month before it sends', mr.indexOf('const claimed = await SAVE(') > 0 && mr.indexOf('const claimed = await SAVE(') < mr.indexOf('await sendReport(site, win, claimedSetting'));
ok('the visits are read in full pages, not one capped read', /svcPages\(`presence_visits\?site_id=eq\./.test(mr) && !/limit=\$\{VISITS_CAP\}/.test(mr));
ok('switching on for a client who can’t be emailed is refused with the reason', /error: 'cannot_send', blocked: reach\.blocked/.test(mr));

const passed = results.filter((r) => r.p).length;
console.log(`${passed}/${results.length} passed`);
if (passed !== results.length) Deno.exit(1);
