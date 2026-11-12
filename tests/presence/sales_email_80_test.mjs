// ── Sales item 80 (Nov 2026): email a person from their record or deal ──────────
//   deno run --allow-read --allow-env --allow-net tests/presence/sales_email_80_test.mjs
//
//   1  who it goes to: the address on file for the deal's person, the person, or the customer;
//      never one typed in, never another studio's
//   2  what goes out: the studio is the sender, a reply comes back to the studio's inbound
//      address (so it lands in the Inbox), no unsubscribe line (one person, words you wrote)
//   3  it is on the timeline: on the deal when there is one, else on the person or customer
//   4  a bounced or spam-reported address is refused first; an unsubscribe doesn't stop it;
//      a send that fails says nothing went out and logs nothing
//   5  the route and its role
//   6  what the Email box reads before it draws (GET /sales/email), and where the box lives
import { installFakePostgrest } from './fake_pgrst.mjs';
Deno.env.set('RESEND_KEY', 'test-resend-key');
Deno.env.set('RESEND_INBOUND_DOMAIN', 'reply.example.test');
Deno.env.set('EMAIL_FROM', 'Studio OS <hello@example.test>');
Deno.env.set('PLATFORM_REPLY_TO', 'platform@example.test');
Deno.env.set('SITE_URL', 'https://app.example.test');
const db = installFakePostgrest({});
const fakeFetch = globalThis.fetch;
const sent = [];
let resendStatus = 200;
globalThis.fetch = async (url, init = {}) => {
  if (String(url).startsWith('https://api.resend.com/emails')) {
    sent.push(JSON.parse(String(init.body || '{}')));
    return new Response(JSON.stringify(resendStatus === 200 ? { id: 'em_' + sent.length } : { message: 'boom' }), { status: resendStatus, headers: { 'Content-Type': 'application/json' } });
  }
  return fakeFetch(url, init);
};
const E = await import('../../supabase/functions/presence/routes/record_email.ts');
const R = await import('../../supabase/functions/presence/lib/site_roles.ts');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n, note); } };
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));

const SITE = '11111111-1111-4111-8111-111111111111', OWNER = '22222222-2222-4222-8222-222222222222', OTHER = '99999999-9999-4999-8999-999999999999';
const CUST = '66666666-6666-4666-8666-666666666666', DEAL = 'dddddddd-0000-4000-8000-000000000001';
const cid = (n) => `cccccccc-0000-4000-8000-00000000000${n}`;
const site = { id: SITE, client_id: OWNER, status: 'live', edition: 'presence' };
const owner = { kind: 'client', userId: '33333333-3333-4333-8333-333333333333', email: 'owner@studio.test', jwt: 'jwt', requestId: 't' };
const cors = {};
const req = (b) => new Request('https://fn.test/functions/v1/presence/sales/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const res = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const world = () => ({
  presence_sites: [{ id: SITE, client_id: OWNER }],
  presence_identity: [{ site_id: SITE, business_name: 'Bright Pixel Studio', email: 'hello@brightpixel.test' }],
  presence_contacts: [
    { id: cid(1), site_id: SITE, name: 'Avery Stone', email: 'avery@example.com', deleted_at: null },
    { id: cid(2), site_id: SITE, name: 'No Email', email: '', deleted_at: null },
    { id: cid(3), site_id: OTHER, name: 'Someone Else', email: 'else@example.com', deleted_at: null },
    { id: cid(4), site_id: SITE, name: 'Bounced Ben', email: 'ben@example.com', deleted_at: null },
    { id: cid(5), site_id: SITE, name: 'Opted Olive', email: 'olive@example.com', deleted_at: null },
    { id: cid(6), site_id: SITE, name: 'Spammy Sam', email: 'sam@example.com', deleted_at: null },
  ],
  clients: [{ id: OWNER, name: 'Studio owner', email: 'owner@studio.test' }, { id: CUST, name: 'Larkspur Studio', email: 'login@larkspur.example', contact_email: 'jordan@larkspur.example', deleted_at: null }],
  presence_service_links: [{ agency_site_id: SITE, customer_client_id: CUST, status: 'active', created_at: '2026-10-01T00:00:00Z' }],
  presence_deals: [{ id: DEAL, site_id: SITE, title: 'Harbor Dental site', stage: 'proposal', contact_id: cid(1), converted_client_id: null, deleted_at: null, updated_at: '2026-11-01T00:00:00Z' }],
  presence_deal_events: [], presence_person_events: [],
  suppressed_emails: [{ email: 'ben@example.com', reason: 'bounce', created_at: '2026-11-01T00:00:00Z' }, { email: 'olive@example.com', reason: 'opt_out', created_at: '2026-11-01T00:00:00Z' }, { email: 'sam@example.com', reason: 'complaint', created_at: '2026-11-01T00:00:00Z' }],
});
const send = async (b) => res(await E.handleRecordEmail(req(b), site, owner, cors));
const letter = { subject: 'Your quote', body: 'Hi Avery,\n\nHere is the quote we talked about.\n\nThanks!' };

// ═══ 1 + 2 + 3: from a deal ═══
{
  db.reset(world()); sent.length = 0;
  const r = await send({ deal_id: DEAL, ...letter });
  ok('a deal\'s person gets it', r.status === 200 && r.body.data.sent === true && r.body.data.to === 'avery@example.com' && sent.length === 1 && JSON.stringify(sent[0].to).includes('avery@example.com'), JSON.stringify(r));
  const m = sent[0] || {};
  ok('the studio is the sender, by name', /Bright Pixel Studio/.test(String(m.from)), String(m.from));
  ok('a reply comes back to the studio\'s inbound address, so it lands in the Inbox', m.reply_to === `${SITE}@reply.example.test`, String(m.reply_to));
  ok('one person, words the studio wrote: no unsubscribe header and no unsubscribe line', !(m.headers && m.headers['List-Unsubscribe']) && !/Unsubscribe/i.test(String(m.html)), JSON.stringify(m.headers || {}));
  ok('the subject and every paragraph go as written', m.subject === 'Your quote' && /Here is the quote we talked about\./.test(String(m.html)) && /Thanks!/.test(String(m.html)));
  const ev = db.tables.presence_deal_events[0];
  ok('it is on the deal\'s timeline: an email sent from Studio OS, with its subject', ev && ev.deal_id === DEAL && ev.kind === 'note' && ev.detail.activity_kind === 'email' && ev.detail.via === 'app' && ev.detail.subject === 'Your quote' && /^Your quote\n\nHi Avery/.test(ev.detail.body), JSON.stringify(ev));
  ok('…and nothing on the person by itself', db.tables.presence_person_events.length === 0 && r.body.data.logged === true);
}
// ═══ from a person with no deal, and a customer ═══
{
  db.reset(world()); sent.length = 0;
  db.tables.presence_deals = [];
  let r = await send({ contact_id: cid(1), ...letter });
  const pe = db.tables.presence_person_events[0];
  ok('a person with no deal: sent, and kept on the person', r.status === 200 && pe && pe.contact_id === cid(1) && pe.kind === 'email' && pe.via === 'app' && pe.subject === 'Your quote', JSON.stringify(pe));
  r = await send({ client_id: CUST, subject: 'Checking in', body: 'How is the new site going?' });
  ok('a customer: their contact address first, kept on the customer', r.status === 200 && r.body.data.to === 'jordan@larkspur.example' && db.tables.presence_person_events.some((e) => e.client_id === CUST && e.subject === 'Checking in'), JSON.stringify(r));
}
// ═══ 1 + 4: who it can't go to ═══
{
  db.reset(world()); sent.length = 0;
  const cases = [
    ['another studio\'s person', { contact_id: cid(3), ...letter }, 404],
    ['a customer that isn\'t this studio\'s', { client_id: '77777777-7777-4777-8777-777777777777', ...letter }, 404],
    ['someone with no address on file', { contact_id: cid(2), ...letter }, 422],
    ['nobody at all', { ...letter, to: 'stranger@elsewhere.test' }, 422],
    ['an address that bounced', { contact_id: cid(4), ...letter }, 409],
    ['someone who reported an email as spam', { contact_id: cid(6), ...letter }, 409],
    ['no subject', { contact_id: cid(1), subject: ' ', body: 'x' }, 422],
    ['no message', { contact_id: cid(1), subject: 'Hi', body: '  ' }, 422],
    ['a message past 8,000 characters', { contact_id: cid(1), subject: 'Hi', body: 'x'.repeat(8001) }, 422],
  ];
  for (const [label, b, status] of cases) {
    const r = await send(b);
    ok(`refused: ${label} (${status}), nothing sent`, r.status === status && sent.length === 0, JSON.stringify(r));
  }
  const bounced = await send({ contact_id: cid(4), ...letter });
  ok('a bounce says to check the address', /bounced/.test(bounced.body.message) && /Check the address/.test(bounced.body.message));
  const spam = await send({ contact_id: cid(6), ...letter });
  ok('a spam report says no more email goes to them', /marked an earlier email as spam/.test(spam.body.message));
  const olive = await send({ contact_id: cid(5), ...letter });
  ok('an unsubscribe from updates doesn\'t stop one email you wrote to them', olive.status === 200 && sent.length === 1, JSON.stringify(olive));
}
{
  db.reset(world()); sent.length = 0; resendStatus = 500;
  const r = await send({ deal_id: DEAL, ...letter });
  resendStatus = 200;
  ok('a send that fails says nothing went out (503), and logs nothing', r.status === 503 && /Nothing went out/.test(r.body.message) && db.tables.presence_deal_events.length === 0, JSON.stringify(r));
}
{
  // before APPLY-0173 there is no person events table: the email still goes, and the answer says so
  db.reset(world()); sent.length = 0; db.tables.presence_deals = []; db.fail.add('presence_person_events');
  const r = await send({ contact_id: cid(1), ...letter });
  ok('before APPLY-0173: sent, and says it couldn\'t be kept on the timeline', r.status === 200 && sent.length === 1 && r.body.data.logged === false && /couldn.t be kept on their timeline/.test(r.body.data.message), JSON.stringify(r));
}

// ═══ 6. what the Email box reads before it draws ═══
{
  db.reset(world()); sent.length = 0;
  const info = async (q) => res(await E.handleRecordEmailInfo(new Request('https://fn.test/functions/v1/presence/sales/email?' + q), site, cors));
  let r = await info('deal_id=' + DEAL);
  ok('a deal: its person, the studio as the sender, the sending address, replies to the Inbox', r.status === 200 && r.body.data.to.email === 'avery@example.com' && r.body.data.to.name === 'Avery Stone' && r.body.data.as === 'Bright Pixel Studio' && r.body.data.from === 'hello@example.test' && r.body.data.replies === 'inbox' && r.body.data.reply_to === `${SITE}@reply.example.test` && r.body.data.stopped === null && r.body.data.unsubscribed === false, JSON.stringify(r));
  r = await info('contact_id=' + cid(2));
  ok('no address on file: said before anything is written', r.status === 200 && r.body.data.to.email === '' && r.body.data.to.name === 'No Email', JSON.stringify(r));
  r = await info('contact_id=' + cid(4));
  ok('a bounced address: stopped up front', r.body.data.stopped === 'bounce' && r.body.data.to.email === 'ben@example.com');
  r = await info('contact_id=' + cid(6));
  ok('a spam report: stopped up front', r.body.data.stopped === 'complaint');
  r = await info('contact_id=' + cid(5));
  ok('an unsubscribe: still writable, and said', r.body.data.stopped === null && r.body.data.unsubscribed === true);
  r = await info('contact_id=' + cid(3));
  ok('another studio\'s person: 404, and nothing about them', r.status === 404 && !JSON.stringify(r.body).includes('else@example.com'));
  r = await info('client_id=' + CUST);
  ok('a customer: their contact address', r.status === 200 && r.body.data.to.email === 'jordan@larkspur.example');
  r = await info('');
  ok('nobody named: 422', r.status === 422);
  ok('reading it sends nothing and logs nothing', sent.length === 0 && db.tables.presence_deal_events.length === 0 && db.tables.presence_person_events.length === 0);
  ok('the Settings card and the box read one sending address', read('supabase/functions/presence/routes/email_sending.ts').includes('const from = sendingFrom();'));
}
{
  const shell = read('shell.js'), crm = read('crm.html'), pipe = read('pipeline.html'), help = read('help.html');
  ok('one Email box (shell.js): it reads who and how first, then sends', shell.includes('window.ddsEmailBox = (function () {') && shell.includes("req('/sales/email?' + k)") && shell.includes("req('/sales/email', 'POST', payload)"));
  ok('…an older server, a stopped address and no address are each said, not a form', shell.includes('Email from here arrives with an update that’s on its way.') && shell.includes('marked an earlier email as spam') && shell.includes('There’s no email address on file for '));
  ok('…dark text on its filled button in the dark theme, 16px type on a phone', shell.includes(':root[data-theme="dark"] .dm-go,:root[data-theme="dark"] .dm-av{color:#171320}') && shell.includes('@media (max-width:767px){.dm-s,.dm-b{font-size:16px}'));
  ok('the record: an Email tab first when there is an address, on the studio\'s own site', crm.includes("const tabs=canEmail()?[['email','Email'],['message','Message']]:[['message','Message']];") && crm.includes("emailBoxInto(eb,{req:apiAg,ids:mailIds(),idp:'em'"));
  ok('…Email stands in front in the header; ?act=email opens it; what is typed survives a redraw', crm.includes("const FRONT=['act-log',canEmail()&&!ids.project?'act-email':'act-message',both?'act-send-both':'act-invoice'];") && crm.includes("act==='email')setTimeout(()=>focusComposer(act),300)") && crm.includes("'noteBody','emSubject','emBody']"));
  ok('…with no project or support thread the record opens on Email', crm.includes("if(!COMPOSER_PICKED&&COMPOSER==='message'&&!(ACT&&(ACT.reply_to||ACT.reply_support_to))&&tabs.some(t=>t[0]==='email'))COMPOSER='email';"));
  ok('Pipeline\'s deal card: Email beside Log a call, its box keeps its node through a repaint', pipe.includes('data-dp="email" data-k="email"') && pipe.includes("window.ddsEmailBox.open(slot,{req:apiR,ids:{deal_id:pid},idp:'dpm'") && pipe.includes('slot.replaceWith(mail.el)'));
  ok('Help says how', help.includes('id="a-email"') && help.includes('the reply comes back to your Inbox'));
}

// ═══ 5. route and role ═══
{
  const idx = read('supabase/functions/presence/index.ts');
  ok('routed under the /sales gate', idx.includes("if (route === '/sales/email' && method === 'POST') return (await import('./routes/record_email.ts')).handleRecordEmail(req, site, principal, cors);"));
  ok('…and its read beside it', idx.includes("if (route === '/sales/email' && method === 'GET') return (await import('./routes/record_email.ts')).handleRecordEmailInfo(req, site, cors);"));
  ok('an edit, like the Inbox\'s reply to an enquiry', R.memberWriteNeeds('/sales/email', 'POST') === 'edit' && R.memberWriteNeeds('/forms/inbox/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/reply', 'POST') === 'edit');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
