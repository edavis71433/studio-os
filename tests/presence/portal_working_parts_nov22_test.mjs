// ── The client portal's working parts (builder items 336, 341, 343, 344, 346, 348, 351 to 355,
//    the full review of Nov 22 2026) ──
//   deno run --allow-read --allow-env --allow-net tests/presence/portal_working_parts_nov22_test.mjs
//
// PART A — item 336, the pure rule (lib/client_reminders.ts): a to-do, a questionnaire or an
//          undated approval is reminded after 3 days and again after 7, never twice in a
//          window, never when answered, hidden or dated; the copy; the per-client switch.
// PART B — item 336, the sweep through a fetch fake: the claim goes BEFORE the send with the
//          previous stamp in the WHERE; an answered questionnaire is skipped; a client whose
//          studio turned reminders off is skipped; a table without the column is a no-op.
// PART C — item 353, the reply words: a known reply time, short hours, nothing by default.
// PART D — items 344 and 348, the emails: the reply opens the conversation and says when it
//          was cut, the plain-text copy keeps a link's address, the preview line is lifted
//          into a hidden span, the footer never says "on Studio OS" to a client, the logo's
//          address for mail is the lasting public one.
// PART E — the wiring (read in the code): the first email on a to-do and a questionnaire, the
//          daily step, the public routes, migration 0252 and its APPLY pack.
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');
Deno.env.set('RESEND_KEY', 'test-resend-key');
Deno.env.set('SITE_URL', 'https://app.example.com');

const R = await import('../../supabase/functions/presence/lib/client_reminders.ts');
const P = await import('../../supabase/functions/presence/lib/portal_settings.ts');
const B = await import('../../supabase/functions/presence/lib/email_brand.ts');
const account = await import('../../supabase/functions/presence/commerce/account.ts');

// ═══ PART A — the pure rule ═══
{
  const NOW = '2026-11-22T15:00:00.000Z';
  const at = (daysAgo, h = 0) => new Date(Date.parse(NOW) - daysAgo * 86400000 - h * 3600000).toISOString();
  const base = { open: true, client_visible: true, last_reminded_at: null };
  ok('A1: two days old → nothing yet', R.clientReminderDue({ ...base, created_at: at(2) }, NOW) === null);
  ok('A2: three days old, never reminded → the first reminder', R.clientReminderDue({ ...base, created_at: at(3) }, NOW) === 'day3');
  ok('A3: five days old, reminded on day 3 → nothing (one per window)', R.clientReminderDue({ ...base, created_at: at(5), last_reminded_at: at(2) }, NOW) === null);
  ok('A4: a week old, reminded on day 3 → the second reminder', R.clientReminderDue({ ...base, created_at: at(7), last_reminded_at: at(4) }, NOW) === 'day7');
  ok('A5: a week old, never reminded (the first was missed) → the second one, not both', R.clientReminderDue({ ...base, created_at: at(8) }, NOW) === 'day7');
  ok('A6: nine days old, reminded on day 7 → never a third', R.clientReminderDue({ ...base, created_at: at(9), last_reminded_at: at(2) }, NOW) === null);
  ok('A7: closed, hidden, or dated → never', R.clientReminderDue({ ...base, created_at: at(5), open: false }, NOW) === null && R.clientReminderDue({ ...base, created_at: at(5), client_visible: false }, NOW) === null && R.clientReminderDue({ ...base, created_at: at(5), due_date: '2026-11-30' }, NOW) === null);
  ok('A8: a garbage date → nothing (no NaN days)', R.clientReminderDue({ ...base, created_at: 'soon' }, NOW) === null && R.daysSince('soon', NOW) === null && R.daysSince(at(3, 2), NOW) === 3);
  const c1 = R.clientAskCopy('todo', 'Send your logo and photos', 'Marlow & Co');
  ok('A9: the first email names the studio and the to-do, and opens with a preview line', /^<!--pre:/.test(c1.html) && c1.subject === 'Marlow & Co needs something from you: Send your logo and photos' && /Marlow &amp; Co has a to-do for you: <strong>Send your logo and photos<\/strong>/.test(c1.html));
  ok('A10: a questionnaire asks for answers; an approval asks for an OK', /a few questions for you/.test(R.clientAskCopy('questionnaire', 'About your business', 'Marlow & Co').html) && /would like your OK on/.test(R.clientAskCopy('approval', 'Homepage draft', 'Marlow & Co').html));
  ok('A11: a title with markup is escaped', /&lt;b&gt;/.test(R.clientAskCopy('todo', '<b>x</b>', 'Marlow & Co').html) && /&lt;b&gt;/.test(R.clientReminderCopy('todo', '<b>x</b>', 'day3', 'Marlow & Co').html));
  const r3 = R.clientReminderCopy('questionnaire', 'About your business', 'day3', 'Marlow & Co'), r7 = R.clientReminderCopy('todo', 'Send your logo', 'day7', 'Marlow & Co');
  ok('A12: the reminders are gentle: "a few days ago", then "about a week ago" and "the last reminder"', r3.subject === 'A reminder — About your business is waiting for you' && /a few days ago/.test(r3.html) && /waiting for your answers/.test(r3.html) && /about a week ago/.test(r7.html) && /the last reminder/.test(r7.html));
  ok('A13: no studio name still reads as a sentence', /Your studio has a to-do for you/.test(R.clientAskCopy('todo', 'x').html));
  // the per-client switch lives in the portal settings
  const S1 = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
  const cur = P.normalizePortal(null);
  const off = P.applyClientChange(cur, S1.toUpperCase(), P.pickClientChange({ reminders: false }));
  ok('A14: Settings can turn reminders off for one client (kept lower-case, parts_at untouched)', JSON.stringify(off.reminders_off) === JSON.stringify([S1]) && off.parts_at === null);
  ok('A15: …and back on', P.applyClientChange(off, S1, P.pickClientChange({ reminders: true })).reminders_off.length === 0);
  ok('A16: a stored list keeps only real site ids, each once', JSON.stringify(P.normalizePortal({ reminders_off: [S1, 'nope', S1.toUpperCase()] }).reminders_off) === JSON.stringify([S1]));
}

// ═══ PART B — the sweep through a fetch fake ═══
{
  const NOW = '2026-11-22T15:00:00.000Z';
  const at = (daysAgo) => new Date(Date.parse(NOW) - daysAgo * 86400000).toISOString();
  const STUDIO = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', PROJ = '11111111-1111-4111-8111-111111111111', PROJ_OFF = '22222222-2222-4222-8222-222222222222';
  const CLIENT = '33333333-3333-4333-8333-333333333333', CSITE = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', CSITE_OFF = 'cccccccc-3333-4333-8333-cccccccccccc';
  const T1 = '44444444-4444-4444-8444-444444444444', T2 = '55555555-5555-4555-8555-555555555555', S_ANS = '66666666-6666-4666-8666-666666666666', S_NEW = '77777777-7777-4777-8777-777777777777';
  const calls = [];
  const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url), m = (init.method || 'GET').toUpperCase();
    calls.push([m, u, init.body ? String(init.body) : '']);
    if (/\/rest\/v1\/presence_tasks\?/.test(u) && m === 'GET') return jsonRes([
      { id: T1, site_id: STUDIO, project_id: PROJ, title: 'Send your logo', created_at: at(4), last_reminded_at: null, status: 'todo', client_visible: true },
      { id: T2, site_id: STUDIO, project_id: PROJ_OFF, title: 'Pick a colour', created_at: at(4), last_reminded_at: null, status: 'todo', client_visible: true },
    ]);
    if (/\/rest\/v1\/presence_tasks\?id=eq\./.test(u) && m === 'PATCH') return jsonRes(/last_reminded_at=is\.null/.test(u) ? [{ id: T1 }] : []);
    if (/\/rest\/v1\/presence_surveys\?/.test(u) && m === 'GET') return jsonRes([
      { id: S_ANS, site_id: STUDIO, project_id: PROJ, title: 'Answered already', created_at: at(5), last_reminded_at: null, status: 'active', client_visible: true },
      { id: S_NEW, site_id: STUDIO, project_id: PROJ, title: 'About your business', created_at: at(8), last_reminded_at: at(5), status: 'active', client_visible: true },
    ]);
    if (/\/rest\/v1\/presence_survey_responses\?/.test(u)) return jsonRes([{ survey_id: S_ANS }]);
    if (/\/rest\/v1\/presence_surveys\?id=eq\./.test(u) && m === 'PATCH') return jsonRes([{ id: S_NEW }]);
    if (/\/rest\/v1\/presence_approvals\?/.test(u) && m === 'GET') return jsonRes({ message: 'column presence_approvals.nope does not exist' }, 400);   // pre-migration shape for this kind: a no-op
    if (/\/rest\/v1\/presence_service_links\?project_id=eq\./.test(u)) return jsonRes([{ customer_client_id: CLIENT, customer_site_id: /PROJ_OFF|22222222/.test(u) ? CSITE_OFF : CSITE }]);
    if (/__portal_settings__/.test(u)) return jsonRes([{ body: JSON.stringify({ reminders_off: [CSITE_OFF] }) }]);
    if (/\/rest\/v1\/presence_settings\?/.test(u)) return jsonRes([{ brand_kit: { primary: '#8c3b2e' }, logo_media_id: null }]);
    if (/\/rest\/v1\/presence_identity\?/.test(u)) return jsonRes([{ business_name: 'Marlow & Co' }]);
    if (/\/rest\/v1\/presence_locations\?/.test(u)) return jsonRes([]);
    if (/\/rest\/v1\/clients\?/.test(u)) return jsonRes([{ email: 'owner@example.com' }]);
    if (/api\.resend\.com/.test(u)) return jsonRes({ id: 'email_1' });
    if (/\/rest\/v1\//.test(u)) return jsonRes([]);
    return jsonRes({}, 404);
  };
  const out = await R.runClientReminders(50, NOW);
  const sends = calls.filter((c) => /api\.resend\.com/.test(c[1])).map((c) => JSON.parse(c[2]));
  const claims = calls.filter((c) => c[0] === 'PATCH');
  const firstClaim = calls.findIndex((c) => c[0] === 'PATCH'), firstSend = calls.findIndex((c) => /api\.resend\.com/.test(c[1]));
  ok('B1: the open to-do and the week-old questionnaire were reminded; the answered one and the switched-off client were not', out.reminded === 2 && sends.length === 2 && out.skipped_off === 1 && !sends.some((s) => /Answered already|Pick a colour/.test(s.subject)));
  ok('B2: the claim is stamped BEFORE the send, with the previous value in the WHERE', firstClaim >= 0 && firstClaim < firstSend && claims.some((c) => /last_reminded_at=is\.null/.test(c[1])) && claims.some((c) => /last_reminded_at=eq\./.test(c[1])));
  ok('B3: the questionnaire reminded on day 5 gets the second reminder now (about a week ago)', sends.some((s) => /About your business/.test(s.subject) && /about a week ago/.test(s.html)));
  ok('B4: a kind whose table has no column yet is a clean no-op (approvals here)', !calls.some((c) => /presence_approvals\?id=eq\./.test(c[1])));
  ok('B5: the reads skip rows reminded in the last three days (no starving the rest)', calls.some((c) => c[0] === 'GET' && /presence_tasks\?/.test(c[1]) && /last_reminded_at\.lt\./.test(c[1])));
  ok('B6: the emails come from the studio, as transactional mail, with a preview line', sends.every((s) => /Marlow/.test(s.from || '') || /Marlow/.test(s.html)) && sends.every((s) => /display:none;max-height:0/.test(s.html)));
}

// ═══ PART C — item 353, the reply words ═══
{
  ok('C1: nothing is said by default', JSON.stringify(P.cleanReply(undefined)) === JSON.stringify({ within: '', hours: '' }) && P.normalizePortal(null).reply.within === '');
  ok('C2: only a known reply time is kept', P.cleanReply({ within: 'within one business day' }).within === 'within one business day' && P.cleanReply({ within: 'whenever' }).within === '' && P.cleanReply({ within: 42 }).within === '');
  ok('C3: hours are one short plain line', P.cleanReply({ hours: '  Mon to Fri,\n 9 to 5\u0007 ' }).hours === 'Mon to Fri, 9 to 5' && P.cleanReply({ hours: 'x'.repeat(100) }).hours.length === P.REPLY_HOURS_MAX);
  const ch = P.pickStudioChange({ reply: { within: 'within a week', hours: 'Weekdays' } });
  const applied = P.applyStudioChange(P.normalizePortal(null), ch);
  ok('C4: Settings saves it with the portal’s other choices, and it is not a parts change', applied.reply.within === 'within a week' && applied.reply.hours === 'Weekdays' && applied.parts_at === null);
  const ws = read('supabase/functions/presence/routes/workspace.ts');
  ok('C5: the portal’s context carries the words to the page', /signin: s\.signin, reply: s\.reply/.test(ws) && /signin: ps\.signin, reply: ps\.reply/.test(ws));
  const client = read('client.html').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');   // the code, not its comments
  ok('C6: the portal says the studio’s words, or nothing: the fixed promise is gone', !/usually repl(y|ies) within a day/.test(client) && /function replyWords\(\)/.test(client) && /replyLine\('No replies yet'\)/.test(client));
}

// ═══ PART D — items 344 and 348, the emails ═══
{
  const pre = B.emailPreheader('  Press the button   to come in. ');
  const shell = B.brandEmailShell(`${pre}<p>Hello</p>`, { ...B.brandFromKit({ primary: '#8c3b2e' }, 'Marlow & Co') }, { asBusiness: true });
  ok('D1: the preview line is lifted into a hidden span at the top, and is gone from the body', /<body[^>]*><div style="display:none;max-height:0[^>]*>Press the button to come in\.&nbsp;/.test(shell) && !/<!--pre:/.test(shell) && /<p>Hello<\/p>/.test(shell));
  ok('D2: a preview line is capped and escaped', B.emailPreheader('x'.repeat(200)).length < 200 + 20 && /&lt;b&gt;/.test(B.emailPreheader('<b>')) && B.emailPreheader('') === '');
  ok('D3: the footer never says "on Studio OS" to a client', !/on Studio OS/.test(B.emailFooterHtml(B.brandFromKit({ primary: '#8c3b2e' }, 'Marlow & Co'))) && /Sent by Marlow &amp; Co\./.test(B.emailFooterHtml(B.brandFromKit({ primary: '#8c3b2e' }, 'Marlow & Co'))) && /Sent by Studio OS\./.test(B.emailFooterHtml(B.EMAIL_BRAND_DEFAULT)));
  const plain = account.htmlToPlainText('<p>Reply here:</p><p class="cta"><a href="https://app.example.com/client.html?support=abc&amp;x=1" style="x">Read and reply →</a></p><p><a href="https://a.example/">https://a.example/</a></p>');
  ok('D4: the plain-text copy keeps each link’s address, once', plain === 'Reply here:\nRead and reply: https://app.example.com/client.html?support=abc&x=1\nhttps://a.example/', plain);
  const sb = read('supabase/functions/presence/lib/service_bridge.ts');
  ok('D5: a reply email opens the conversation and the button says Read and reply', /open\?: \{ support\?: string \}/.test(sb) && /\?support=\$\{encodeURIComponent\(support\)\}/.test(sb) && /'Read and reply →'/.test(sb));
  const si = read('supabase/functions/presence/routes/service_intake.ts');
  ok('D6: a long reply is cut at 500 and the email says to read the rest in the portal', /const REPLY_CUT = 500/.test(si) && /Read the rest in your client portal\./.test(si) && /emailCustomerByClient\(site\.id, clientId, subject, replyHtml, \{ support: String\(reqRow\.id\) \}\)/.test(si));
  const eb = read('supabase/functions/presence/lib/email_brand.ts');
  ok('D7: mail gets the logo’s lasting public address; a page keeps a signed one', /export async function stableLogoUrl/.test(eb) && /\/functions\/v1\/presence\/public\/studio\/\$\{siteId\}\/logo/.test(eb) && /opts\.logoTtl == null \? await stableLogoUrl/.test(eb));
  const sales = read('supabase/functions/presence/routes/sales.ts');
  ok('D8: the invitation greets by first name, has a title in its band and a preview line', /opts: \{ firstName\?: string \}/.test(sales) && /Hi \$\{first/.test(sales) && /emailBand\(studioName \? 'Your client portal' : ''/.test(sales) && /emailPreheader\('One place for your website/.test(sales));
  const cust = read('supabase/functions/presence/routes/customers.ts');
  ok('D9: the invite route passes the person’s name', (cust.match(/sendCustomerInvite\([^)]*firstName/g) || []).length === 2);
}

// ═══ PART E — the wiring ═══
{
  const pj = read('supabase/functions/presence/routes/projects.ts');
  const si = read('supabase/functions/presence/routes/service_intake.ts');
  const sys = read('supabase/functions/presence/routes/system.ts');
  const idx = read('supabase/functions/presence/index.ts');
  const mig = read('supabase/migrations/0252_client_reminders.sql');
  const pack = read('docs/presence/APPLY-0252-prod.sql');
  ok('E1: a to-do put to the client is emailed on create and on the flag', /emailClientAsk\(site\.id, projectId, 'todo', title\)/.test(pj) && /emailClientAsk\(site\.id, projectId, 'todo', String\(rows\(up\)\[0\]\.title/.test(pj));
  ok('E2: a questionnaire posted to the client is emailed', /emailClientAsk\(site\.id, projectId, 'questionnaire', title\)/.test(si));
  ok('E3: the daily tick has the step, after the approval reminders', /\['client_reminders', \(\) => runClientReminders\(50\)\]/.test(sys) && sys.indexOf("['client_reminders'") > sys.indexOf("['approval_reminders'"));
  ok('E4: migration 0252 adds the column to both tables, with the APPLY pack to match', /presence_tasks add column if not exists last_reminded_at timestamptz/.test(mig) && /presence_surveys add column if not exists last_reminded_at timestamptz/.test(mig) && /presence_tasks add column if not exists last_reminded_at/.test(pack) && /presence_surveys add column if not exists last_reminded_at/.test(pack));
  ok('E5: the public routes: the logo’s lasting address and the default studio for a bare /portal', idx.includes('([0-9a-f-]{36})\\/logo$/') && idx.includes("'/public/studio/default/brand'"));
  const sbr = read('supabase/functions/presence/routes/studio_brand.ts');
  ok('E6: the logo route forwards to a fresh signed address; the default studio is AGENCY_SITE_ID or the first studio with a client', /status: 302/.test(sbr) && /AGENCY_SITE_ID/.test(sbr) && /presence_service_links\?select=agency_site_id/.test(sbr));
  const portal = read('portal.html');
  ok('E7: the sign-in page never says the product’s name to a client: no fixed brand, no studio line, a fade-in and "Client sign in" as the fallback', !/<span class="word">Studio OS<\/span>/.test(portal) && !/Run a studio on Studio OS/.test(portal) && /<title>Client sign in<\/title>/.test(portal) && /function paintNoStudio/.test(portal) && /\/presence\/public\/studio\/default\/brand/.test(portal));
  const client = read('client.html');
  ok('E8: item 343: the portal reads again when the tab comes back and a conversation every minute, never in a preview', /visibilitychange/.test(client) && /LIVE_EVERY_MS=60000/.test(client) && /if\(PREVIEW\|\|!PORTAL\.ready\|\|document\.hidden/.test(client) && /liveStart\(\);/.test(client));
  ok('E9: item 351: one name, and a plain project name', /'Your client portal':'Client view'/.test(client) && /function projectTitle\(p\)/.test(client) && !/'Your workspace'/.test(client));
  ok('E10: item 352: no "hasn’t added" line, no product news for a client, an account menu on the initial', !/hasn’t added its own help articles/.test(client) && /function whatsNewDoorHtml\(\)\{return '';\}/.test(client) && /id="navacctp" class="acctpanel" role="menu"/.test(client));
  ok('E11: item 354: one box when the studio lists no services', /class="card selse one"/.test(client) && /if\(!services\|\|services\.length\)html\+=`<div class="card selse">/.test(client));
  ok('E12: item 355: a reviewer gets Home and their account only', /t\[0\]==='home'\|\|t\[0\]==='help'/.test(client) && /portalHeader\('Your account','Your sign-in, and how this portal looks\.'\)/.test(client) && !/Help articles will appear here once your studio has set up your account/.test(client));
  const cp = read('client-portal.html');
  ok('E13: item 346: the Client portal page lists clients with their state and Send again on a waiting or run-out row', /data-again=/.test(cp) && /\/sign-in-link','POST'/.test(cp) && /c\.state==='waiting'\|\|c\.state==='expired'/.test(cp));
  const st = read('settings.html');
  ok('E14: item 353 in Settings: the reply time and hours save with the portal’s choices; item 336: the per-client switch', /id="portalReplyWithin"/.test(st) && /'PUT', \{ reply: want \}/.test(st) && /\{ reminders: want \}/.test(st));
}

const passed = results.filter(Boolean).length, failed = results.length - passed;
console.log(`\n════ PORTAL WORKING PARTS (Nov 22 review): ${passed}/${results.length} ${failed ? 'FAILED' : 'PASSED'} ════`);
if (failed) Deno.exit(1);
