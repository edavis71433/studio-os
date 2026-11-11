// ── Item 71 (Nov 2026): the rough edges found when the first real emailed reply landed ─
//   deno run --allow-read --allow-env --allow-net tests/presence/inbound_rough_edges_test.mjs
// (a) the studio alert named an emailed-in contact "A client"; (b) the Inbox and Home
// showed them as a bare email; (c) every emailed reply carried the whole quoted
// thread under it; (d) the reply box promised a portal a contact doesn't have;
// (e) proposals, agreements, invoices, retainer links, signed copies, the portal
// invite and two reminders sent customers' answers to the studio's own mailbox
// instead of the Inbox. All names and addresses below are made up.
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');
Deno.env.set('RESEND_KEY', 'test-resend-key');
Deno.env.set('RESEND_INBOUND_DOMAIN', 'reply.example.com');

const read = (rel) => Deno.readTextFile(new URL(rel, import.meta.url));
const shell = await read('../../shell.js');
const inbox = await read('../../inbox.html');
const crm = await read('../../crm.html');
const projects = await read('../../projects.html');
const sales = await read('../../supabase/functions/presence/routes/sales.ts');
const lifecycle = await read('../../supabase/functions/presence/commerce/lifecycle.ts');
const bridge = await read('../../supabase/functions/presence/lib/service_bridge.ts');
const workspace = await read('../../supabase/functions/presence/routes/workspace.ts');
const needs = await read('../../supabase/functions/presence/agency/needs_you.ts');
const agency = await read('../../supabase/functions/presence/agency/routes.ts');
const inbound = await read('../../supabase/functions/presence/routes/inbound_email.ts');

// ═══ (c) the quote fold — the EXACT text shell.js ships, run here ═══
const block = /\/\* quote-fold:start[^*]*\*\/([\s\S]*?)\/\* quote-fold:end \*\//.exec(shell);
ok('shell.js carries one marked, pure quote-fold block', !!block);
const split = new Function(`${block ? block[1] : ''}\nreturn ddsSplitQuote;`)();

const gmailWrapped = 'hi\n\nOn Sun, Nov 8, 2026 at 3:17 PM Studio <hello@example.com>\nwrote:\n\n>\n>\n> Studio\n>\n> Hi Jordan,\n>\n> This is the test email. Please\n> hit Reply and send back a short note.\n>\n';
{
  const p = split(gmailWrapped);
  ok('Gmail, attribution wrapped onto two lines: the reply is just their words', p.text === 'hi');
  ok('Gmail, wrapped: the quote starts at "On …" and keeps every quoted line', p.quoted.startsWith('On Sun, Nov 8, 2026 at 3:17 PM') && p.quoted.includes('> Hi Jordan,') && p.quoted.includes('> hit Reply'));
}
{
  const nested = 'hi\n\nOn Sun, Nov 8, 2026 at 4:13 PM Jordan Ellis <jordan@example.com> wrote:\n\n> hi\n>\n> On Sun, Nov 8, 2026 at 3:17 PM Studio <hello@example.com>\n> wrote:\n>\n>> Hi Jordan,\n>>\n';
  const p = split(nested);
  ok('Gmail, one-line attribution over a nested quote: folds from "On …"', p.text === 'hi' && p.quoted.startsWith('On Sun, Nov 8, 2026 at 4:13 PM') && p.quoted.includes('>> Hi Jordan,'));
}
{
  const p = split('Sounds good!\n\nOn Nov 8, 2026, at 3:17 PM, Studio <hello@example.com> wrote:\n\n> Hi Jordan,\n> The draft is ready.\n');
  ok('Apple Mail attribution folds the same way', p.text === 'Sounds good!' && p.quoted.startsWith('On Nov 8, 2026, at 3:17 PM'));
}
{
  const p = split('Gracias\n\nEl dom, 8 nov 2026 a las 15:17, Studio (<hello@example.com>) escribió:\n> Hola Jordan\n');
  ok('a Spanish Gmail attribution ("escribió:") folds too', p.text === 'Gracias' && p.quoted.startsWith('El dom, 8 nov 2026'));
}
{
  const p = split('Thanks!\n\n-----Original Message-----\nFrom: Studio <hello@example.com>\nSent: Sunday, November 8, 2026 3:17 PM\nTo: jordan@example.com\nSubject: Your proposal\n\nHi Jordan, the proposal is ready.\n');
  ok('Outlook "-----Original Message-----" folds everything under it', p.text === 'Thanks!' && p.quoted.startsWith('-----Original Message-----') && p.quoted.includes('the proposal is ready'));
}
{
  const p = split('Thanks!\n\n________________________________\nFrom: Studio <hello@example.com>\nSent: Sunday, November 8, 2026 3:17 PM\nTo: jordan@example.com\nSubject: Your proposal\n\nHi Jordan.\n');
  ok('Outlook on the web (a rule of underscores, then From:/Sent:) folds from the rule', p.text === 'Thanks!' && p.quoted.startsWith('________________________________'));
}
{
  const p = split('Sounds good\n\n> the earlier line\n> and another\n');
  ok('a bare trailing ">" block with no attribution folds', p.text === 'Sounds good' && p.quoted === '> the earlier line\n> and another');
}
{
  const inline = 'See my answers below.\n\nOn Sun, Nov 8, 2026 at 3:17 PM Studio <hello@example.com> wrote:\n> Which day works?\nTuesday works.\n> Which colour?\nBlue, please.\n';
  const p = split(inline);
  ok('answers written INSIDE the quote are never folded away (the whole message stays)', p.quoted === '' && p.text.includes('Tuesday works.') && p.text.includes('Blue, please.'));
}
{
  const p = split('On Sun, Nov 8, 2026 at 3:17 PM Studio <hello@example.com> wrote:\n> Hi Jordan\n');
  ok('a message that is ONLY a quote is never folded to nothing', p.quoted === '' && p.text.startsWith('On Sun'));
}
{
  const p = split('From: the front desk\nSent: this morning\nCan you call me back?');
  ok('From:/Sent: at the very top is the message itself, not a quote', p.quoted === '' && p.text.includes('Can you call me back?'));
}
{
  const plain = 'Hi! Can we move the call to Thursday?\nThanks, Jordan';
  ok('a plain message is left exactly as written', split(plain).quoted === '' && split(plain).text === plain);
  ok('Windows line endings fold the same', split(gmailWrapped.replace(/\n/g, '\r\n')).text === 'hi');
  ok('empty and missing bodies are safe', split('').text === '' && split(null).quoted === '' && split(undefined).text === '');
}

// the alert (server) and the pages (shell.js) must agree on what is the quote
{
  const L = await import('../../supabase/functions/presence/lib/inbound_email.ts');
  const samples = [
    gmailWrapped, gmailWrapped.replace(/\n/g, '\r\n'),
    'hi\n\nOn Sun, Nov 8, 2026 at 4:13 PM Jordan Ellis <jordan@example.com> wrote:\n\n> hi\n>\n>> older\n',
    'Sounds good!\n\nOn Nov 8, 2026, at 3:17 PM, Studio <hello@example.com> wrote:\n\n> Hi\n',
    'Gracias\n\nEl dom, 8 nov 2026, Studio escribió:\n> Hola\n',
    'Thanks!\n\n-----Original Message-----\nFrom: Studio\nSent: today\n\nHi\n',
    'Thanks!\n\n________________________________\nFrom: Studio\nSent: today\n\nHi\n',
    'Sounds good\n\n> a\n> b\n',
    'See below.\n\nOn Sun wrote:\n> Which day?\nTuesday.\n',
    'On Sun, Nov 8 wrote:\n> only a quote\n',
    'From: the desk\nSent: today\nCall me?',
    'Just a plain note.', '', '   ', null, undefined,
  ];
  const same = samples.every((t) => JSON.stringify(split(t)) === JSON.stringify(L.splitQuotedReply(t)));
  ok('the alert and the pages find the SAME quote in every sample (shell.js ddsSplitQuote ≡ lib splitQuotedReply)', same);
}

// the kit + the pages that show emailed messages
ok('shell.js exposes window.ddsQuote { split, html } and folds behind "Show earlier email"',
  /window\.ddsQuote = \{\s*split: ddsSplitQuote,\s*html: function \(text, esc\)/.test(shell) && /<details class="dds-quoted"><summary>Show earlier email<\/summary>/.test(shell));
ok('ddsQuote.html escapes BOTH parts (the reply and the folded quote)', /return esc\(p\.text\) \+ '<details[^']*' \+ esc\(p\.quoted\)/.test(shell));
ok('ddsQuote.html returns the untouched escaped body when there is nothing to fold', /if \(!p\.quoted\) return esc\(raw\);/.test(shell));
for (const [name, src] of [['inbox.html', inbox], ['crm.html', crm], ['projects.html', projects]]) {
  ok(`${name}: qh() folds through ddsQuote, falling back to plain esc() when the shell is late`, /const qh=\(s\)=>\(window\.ddsQuote\?window\.ddsQuote\.html\(s,esc\):esc\(s\)\);/.test(src));
}
ok('Inbox: the support request body, each reply bubble and the timeline body fold the quote',
  /<div class="body">\$\{qh\(req\.body\)\}<\/div>/.test(inbox) && /\$\{qh\(m\.body\|\|''\)\}<span class="bwhen">/.test(inbox) && /<div class="ti-body">\$\{qh\(it\.body\)\}<\/div>/.test(inbox) && !/esc\(m\.body\|\|''\)\}<span class="bwhen">/.test(inbox));
ok('Record activity folds the quote', /bodyHtml=`<div class="ti-body">\$\{qh\(it\.body\)\}/.test(crm));
ok('Project messages and support threads fold the quote (all three lists)', (projects.match(/<div class="t">\$\{qh\(m\.body\)\}<\/div>/g) || []).length === 3 && !/<div class="t">\$\{esc\(m\.body\)\}<\/div>/.test(projects));

// ═══ (d) the reply box tells the truth about how the reply reaches them ═══
{
  const fn = /function replyReach\(it\)\{[\s\S]*?\n\}/.exec(inbox);
  ok('Inbox has one replyReach() and the composer uses it', !!fn && /\$\{replyReach\(it\)\}/.test(inbox) && !/sees it in their portal':'They get an email and see it in their portal'\}/.test(inbox));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const replyReach = new Function('esc', `${fn ? fn[0] : ''}\nreturn replyReach;`)(esc);
  ok('a customer (has a portal) still reads "… sees it in their portal"', replyReach({ name: 'Larkspur Studio', client_id: 'c1' }) === 'Larkspur Studio gets an email and sees it in their portal');
  ok('a contact who wrote in by email reads "… can answer it there", not a portal they lack', replyReach({ name: 'Jordan Ellis', client_id: '' }) === 'Jordan Ellis gets your reply by email and can answer it there');
  ok('no name: the generic sentences, still telling the two apart', replyReach({ name: 'Support request', client_id: '' }) === 'They get your reply by email and can answer it there' && replyReach({ client_id: 'c1' }) === 'They get an email and see it in their portal');
  ok('the name is escaped', replyReach({ name: '<b>x</b>', client_id: '' }).startsWith('&lt;b&gt;x&lt;/b&gt;'));
}

// ═══ (e) customers' answers to studio emails land in the Inbox ═══
{
  const withSite = (sales.match(/brand, \{ critical: true, siteId(: tok\.site_id)?(?: \}\)|, \.\.\.\()/g) || []).length;   // sales item 82: the invoice and signed-copy emails add their PDF after the site
  ok('sales: all six studio→customer emails (proposal, the one-link send, invoice, retainer, signed copy, portal invite) carry the studio site', withSite === 6, `found ${withSite}`);
  ok('sales: no studio→customer send is left on the human reply-to', !/brand, \{ critical: true \}\)/.test(sales));
  // sales item 74: the invoice reminder always arrives now (critical), and still carries the site
  ok('lifecycle: the invoice reminder and the proposal/agreement reminder carry the site', /brand, \{ critical: true, siteId: inv\.site_id \}\)\.catch/.test(lifecycle) && /brand, \{ siteId: doc\.site_id \}\)\.catch/.test(lifecycle));
  ok('operator alerts still never carry siteId (Eric replying to his own alert must not post into a client thread)',
    /return await sendEmail\(to, `\$\{headline\}`\.slice\(0, 180\), html, brand, \{ critical: true \}\);/.test(bridge));
}

// ═══ (a) + (b) pins: who wrote is named ═══
ok('the inbound door matches clients and contacts WITH their names', /select=id,name,email,contact_email,contact_id,created_at/.test(inbound) && /select=id,name,email,created_at&order=created_at\.asc,id\.asc&limit=25/.test(inbound));
ok('every studio alert from the email door names the sender (contact name, else their From name, else the address)', (inbound.match(/actorName: match\.name \|\| from_name \|\| from_email/g) || []).length === 4);
ok('the email door hands the alert only what they wrote (the stored body keeps everything)', /const said = splitQuotedReply\(text\)\.text;/.test(inbound) && (inbound.match(/excerpt: said \|\| subject, viaEmail: true,/g) || []).length === 4 && !/excerpt: text \|\| subject/.test(inbound));
ok('the stored body is still the WHOLE text (body: text || subject …)', /body: text \|\| subject \|\| '\(no content\)'/.test(inbound));
ok('the alert falls back to actorName before "A client"', /whoRow\?\.name \|\| whoRow\?\.email \|\| String\(n\.actorName \|\| ''\)\.trim\(\) \|\| 'A client'/.test(bridge));
ok('the Inbox names a contact before showing their email', /client: c\.client \|\| owners\.nameOf\[String\(r\.id\)\] \|\| owners\.emailOf\[String\(r\.id\)\] \|\| ''/.test(workspace));
ok('Home names a contact before showing their email', /if \(owners\.nameOf\[r\.id\]\) r\.requester_name = owners\.nameOf\[r\.id\];/.test(agency) && /String\(s\.requester_name \|\| s\.requester_email \|\| ''\)\.trim\(\) \|\| 'A customer'/.test(needs));

// ═══ badge letters: now that a contact is named ("Eric (test)"), a bracket must not become a letter ═══
{
  const today = await read('../../today.html');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const inboxFn = /const initialsOf=\(name\)=>([^\n]+);/.exec(inbox);
  const crmFn = /const initials=(String\(nm\)[^\n]+?\|\|'\?');/.exec(crm);
  const todayFn = /function initials\(n\)\{([^\n]+?)\}   \/\//.exec(today);
  ok('the three badge-letter rules are found (Inbox, record, Home)', !!inboxFn && !!crmFn && !!todayFn);
  const fns = {
    inbox: new Function('esc', `return (name)=>${inboxFn ? inboxFn[1] : "''"};`)(esc),
    record: new Function(`return (nm)=>${crmFn ? crmFn[1] : "''"};`)(),
    home: new Function(`return function(n){${todayFn ? todayFn[1] : "return ''"}};`)(),
  };
  const cases = [['Eric (test)', 'ET'], ['Jordan Ellis', 'JE'], ['(Acme) Jordan', 'AJ'], ['🌸 Flowers', '🌸F'], ['ßeta Studio', 'ßS'], ['- dash', 'D'], ['', '?'], ['Larkspur', 'L']];
  for (const [where, fn] of Object.entries(fns)) {
    const got = cases.map(([n]) => fn(n));
    ok(`${where}: a word's first letter, digit or emoji (never a bracket); emoji and ß stay whole`, cases.every(([, want], i) => got[i] === want), JSON.stringify(got));
  }
}

// ═══ behaviour: the healer names a contact; the alert says who ═══
const realFetch = globalThis.fetch;
const jr = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const AGENCY = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const REQ = '33333333-3333-4333-8333-333333333333';
const { healSupportOwners, deliverStudioNotification } = await import('../../supabase/functions/presence/lib/service_bridge.ts');
try {
  {
    const calls = [];
    globalThis.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      calls.push(url);
      if (url.includes('presence_contacts')) return jr([{ email: 'Jordan@Example.com', name: 'Jordan Ellis', created_at: '2026-11-01T00:00:00Z' }]);
      return jr([]);   // no customer behind the address
    };
    const out = await healSupportOwners(AGENCY, [{ id: REQ, client_id: null, project_id: null, requester: 'jordan@example.com' }]);
    ok('healer: a contact who emailed in comes back NAMED (and still with their email)', out.nameOf[REQ] === 'Jordan Ellis' && out.emailOf[REQ] === 'jordan@example.com' && !out.clientOf[REQ]);
    ok('healer: the contact read is scoped to THIS studio\'s site, case-insensitively', calls.some((u) => u.includes(`presence_contacts?site_id=eq.${AGENCY}&email=ilike.jordan%40example.com`)));
  }
  {
    globalThis.fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('presence_contacts')) return jr([{ email: 'someone-else@example.com', name: 'Not Them' }]);   // ilike over-matched
      return jr([]);
    };
    const out = await healSupportOwners('44444444-4444-4444-8444-444444444444', [{ id: REQ, client_id: null, project_id: null, requester: 'jordan@example.com' }]);
    ok('healer: an over-matched contact row is NOT taken (exact recheck) — the email still shows', !out.nameOf[REQ] && out.emailOf[REQ] === 'jordan@example.com');
  }
  {
    const sent = [];
    globalThis.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('api.resend.com/emails')) { sent.push(JSON.parse(init.body)); return jr({ id: 're_1' }); }
      if (url.includes('presence_sites')) return jr([{ client_id: OWNER }]);
      if (url.includes('presence_identity')) return jr([{ email: 'owner@example.com', business_name: 'Example Studio' }]);
      if (url.includes('presence_plan_notices') && (init.method || 'GET') === 'POST') return jr([{ id: 'n1' }], 201);
      return jr([]);
    };
    const went = await deliverStudioNotification({ agencySiteId: AGENCY, kind: 'client_request', threadKey: `req:${REQ}`, customerClientId: null, actorName: 'Jordan Ellis', subject: 'Re: Your proposal', excerpt: 'Looks good', href: '/inbox.html' });
    ok('alert: an emailed-in contact is named in the subject ("New request from Jordan Ellis")', went === true && sent.length === 1 && sent[0].subject === 'New request from Jordan Ellis', JSON.stringify(sent[0]?.subject));
    ok('alert: and in the body', sent.length === 1 && /<b>Jordan Ellis<\/b>/.test(sent[0].html));
    ok('alert: it keeps the human reply-to (never the inbound address)', sent.length === 1 && !/reply\.example\.com/.test(String(sent[0].reply_to)));
    sent.length = 0;
    const long = 'First line of the answer\nsecond line ' + 'word '.repeat(200);
    const went2 = await deliverStudioNotification({ agencySiteId: AGENCY, kind: 'client_request', threadKey: 'req:email-2', customerClientId: null, actorName: 'Jordan Ellis', viaEmail: true, subject: 'Re: Your proposal', excerpt: long, href: '/inbox.html' });
    const h = sent[0]?.html || '';
    ok('alert by email: "New email from Jordan Ellis" and "emailed you." (not "has a request for you")', went2 === true && sent[0]?.subject === 'New email from Jordan Ellis' && /<b>Jordan Ellis<\/b> emailed you\./.test(h) && !/has a request for you/.test(h));
    ok('alert by email: the excerpt keeps its line breaks', /First line of the answer<br>second line/.test(h));
    ok('alert by email: a long excerpt ends on a whole word with "…", never mid-word', /word…<\/blockquote>/.test(h) && !/wor…|wo…|w…/.test(h));
  }
} finally {
  globalThis.fetch = realFetch;
}

const passed = results.filter(Boolean).length;
console.log(`\n════ INBOUND ROUGH EDGES (item 71): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
