// ── Sales extras, batch 3 (item 69, Nov 2026): the "log this email" address.
// BCC a studio's private log-<token>@ address and the email lands on the client's
// deal as "You logged an email". Real handlers (the address route, the logging
// handler and the whole inbound door) against the shared in-memory PostgREST;
// all names and addresses are made up.
//   deno run --allow-read --allow-env --allow-net tests/presence/sales_extras_3_test.mjs
const SECRET = 'whsec_' + btoa('log-test-secret-32-bytes-long!!!!');
Deno.env.set('RESEND_INBOUND_SECRET', SECRET);
Deno.env.set('RESEND_INBOUND_DOMAIN', 'reply.example.com');
Deno.env.set('RESEND_KEY', 'test-resend-key');
Deno.env.set('EMAIL_FROM', 'Example Studio <hello@example.com>');
Deno.env.set('PLATFORM_REPLY_TO', 'owner@example.com');
import { installFakePostgrest } from './fake_pgrst.mjs';
const SITE = '11111111-1111-4111-8111-111111111111', OWNER = '22222222-2222-4222-8222-222222222222', U = '33333333-3333-4333-8333-333333333333';
const CUST = '44444444-4444-4444-8444-444444444444', CT = 'c0000000-0000-4000-8000-000000000001', CT2 = 'c0000000-0000-4000-8000-000000000002';
const OPEN_DEAL = 'd0000000-0000-4000-8000-000000000001', OLD_DEAL = 'd0000000-0000-4000-8000-000000000002', WON_DEAL = 'd0000000-0000-4000-8000-000000000003';
const TOKEN = 'ab12cd34ef56ab12cd34ef56';
const db = installFakePostgrest({ unique: { presence_sales_templates: [{ cols: ['site_id', 'kind', 'name'], where: (r) => r.deleted_at == null && /^__.*__$/.test(String(r.name)) }] } });
const LG = await import('../../supabase/functions/presence/lib/email_log.ts');
const ER = await import('../../supabase/functions/presence/routes/email_log.ts');
const { handleInboundEmail } = await import('../../supabase/functions/presence/routes/inbound_email.ts');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n, note); } };
const site = { id: SITE, client_id: OWNER, status: 'live', edition: 'presence' };
const owner = { kind: 'client', userId: U, email: 'owner@example.com', jwt: 'jwt-owner', requestId: 't' };
const cors = {};
const req = (method, path, b) => new Request(`https://fn.test/functions/v1/presence${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
const res = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const day = (n) => new Date(Date.now() + n * 86400_000).toISOString();
const world = (over = {}) => ({
  presence_sites: [{ id: SITE, client_id: OWNER }],
  presence_identity: [{ site_id: SITE, email: 'hello@example.com', business_name: 'Example Studio' }],
  presence_site_members: [{ site_id: SITE, email: 'Seat@Example.com', status: 'active' }],
  clients: [{ id: OWNER, email: 'owner@example.com', contact_email: null, deleted_at: null }, { id: CUST, name: 'Larkspur Studio', email: 'jordan@larkspur.example', contact_email: null, deleted_at: null }],
  presence_service_links: [{ agency_site_id: SITE, customer_client_id: CUST, status: 'active' }],
  presence_contacts: [{ id: CT, site_id: SITE, name: 'Riley Park', email: 'Riley@Example.org', deleted_at: null }, { id: CT2, site_id: SITE, name: 'No Deal', email: 'nodeal@example.org', deleted_at: null }],
  presence_deals: [
    { id: OPEN_DEAL, site_id: SITE, contact_id: CT, stage: 'proposal', converted_client_id: null, updated_at: day(-1), deleted_at: null },
    { id: OLD_DEAL, site_id: SITE, contact_id: CT, stage: 'lost', converted_client_id: null, updated_at: day(-90), deleted_at: null },
    { id: WON_DEAL, site_id: SITE, contact_id: null, stage: 'won', converted_client_id: CUST, updated_at: day(-30), deleted_at: null },
  ],
  presence_deal_events: [],
  presence_sales_templates: [{ id: 'tpl-log', site_id: SITE, kind: 'proposal', name: '__email_log__', body: JSON.stringify({ token: TOKEN, created_at: day(-1) }), deleted_at: null, updated_at: day(-1) }],
  ...over,
});
const logged = () => db.writes('presence_deal_events').filter((w) => w.method === 'POST').map((w) => w.body);
const msg = (over = {}) => ({
  from: 'Owner <owner@example.com>', to: ['Riley <riley@example.org>'], cc: [], subject: 'Your quote',
  text: 'Here is the quote we talked about.\n\nOn Sun, Nov 8, 2026 at 3:17 PM Riley <riley@example.org> wrote:\n> Can you send it?\n',
  message_id: '<quote-1@example.com>', created_at: day(0), authentication: { spf: 'pass', dkim: 'pass', dmarc: 'pass' }, ...over,
});

// ═══ the address rules ═══
{
  const t = LG.newLogToken();
  ok('a token is 24 hex characters, and fresh each time', LG.LOG_TOKEN_RE.test(t) && t !== LG.newLogToken());
  ok('the address lives on the reply domain', LG.logAddress(TOKEN, 'reply.example.com') === `log-${TOKEN}@reply.example.com` && LG.logAddress('nope', 'reply.example.com') === '' && LG.logAddress(TOKEN, '') === '');
  ok('found among recipients, with a display name, any case', LG.logTokenIn(['Riley <riley@example.org>', `Log <LOG-${TOKEN.toUpperCase()}@Reply.Example.com>`], 'reply.example.com') === TOKEN);
  ok('only on OUR reply domain, and only the log- form', LG.logTokenIn([`log-${TOKEN}@elsewhere.test`, `${TOKEN}@reply.example.com`], 'reply.example.com') === '');
  ok('the activity reads: subject, then what was written', LG.loggedEmailBody('Your quote', 'Here it is') === 'Your quote\n\nHere it is' && LG.loggedEmailBody('', 'Just text') === 'Just text');
}

// ═══ making, renewing and turning off the address ═══
{
  db.reset(world({ presence_sales_templates: [] }));
  const g0 = await res(await ER.handleEmailLogAddress(req('GET', '/email/log-address'), site, owner, cors));
  ok('no address yet: off, and the owner may make one', g0.body.data.on === false && g0.body.data.address === null && g0.body.data.can_manage === true && g0.body.data.available === true);
  const p = await res(await ER.handleEmailLogAddress(req('POST', '/email/log-address'), site, owner, cors));
  const addr = p.body?.data?.address || '';
  ok('making one gives log-<24 hex>@reply…', p.status === 200 && /^log-[0-9a-f]{24}@reply\.example\.com$/.test(addr), JSON.stringify(p.body));
  const p2 = await res(await ER.handleEmailLogAddress(req('POST', '/email/log-address'), site, owner, cors));
  ok('a new address replaces the old one', p2.body.data.address !== addr && JSON.parse(db.tables.presence_sales_templates[0].body).token === p2.body.data.address.slice(4, 28));
  const seat = { ...owner, userId: '77777777-7777-4777-8777-777777777777', member: { site_id: SITE, role: 'business_staff' } };
  const gs = await res(await ER.handleEmailLogAddress(req('GET', '/email/log-address'), site, seat, cors));
  ok('a seat without configure sees that it is on, never the address', gs.body.data.on === true && gs.body.data.address === null && gs.body.data.can_manage === false);
  ok('…and can\'t make or turn it off', (await ER.handleEmailLogAddress(req('POST', '/email/log-address'), site, seat, cors)).status === 403);
  const d = await res(await ER.handleEmailLogAddress(req('DELETE', '/email/log-address'), site, owner, cors));
  ok('turning it off', d.status === 200 && d.body.data.on === false && JSON.parse(db.tables.presence_sales_templates[0].body).token === null);
  Deno.env.delete('RESEND_INBOUND_DOMAIN');
  const nd = await res(await ER.handleEmailLogAddress(req('POST', '/email/log-address'), site, owner, cors));
  ok('no reply domain on the account: nothing to give (409), said plainly', nd.status === 409 && /aren’t set up/.test(nd.body?.message || ''));
  Deno.env.set('RESEND_INBOUND_DOMAIN', 'reply.example.com');
}

// ═══ logging a BCC'd email ═══
{
  db.reset(world());
  const r = await ER.handleLoggedEmail(msg(), TOKEN);
  const ev = logged();
  ok('lands once, on the person\'s OPEN deal (not their old lost one)', r.status === 200 && ev.length === 1 && ev[0].deal_id === OPEN_DEAL, JSON.stringify(ev));
  ok('as "You logged an email": a note with activity_kind email, via bcc', ev[0]?.kind === 'note' && ev[0]?.detail?.activity_kind === 'email' && ev[0]?.detail?.via === 'bcc' && ev[0]?.actor === 'owner@example.com');
  ok('it reads subject, then only what was written (the quoted thread folded away)', ev[0]?.detail?.body === 'Your quote\n\nHere is the quote we talked about.', JSON.stringify(ev[0]?.detail?.body));
  ok('the deal moves up the list', db.writes('presence_deals').some((w) => w.method === 'PATCH' && w.url.includes(`id=eq.${OPEN_DEAL}`)));
  await ER.handleLoggedEmail(msg(), TOKEN);
  ok('a redelivery of the same message never logs it twice', logged().length === 1);

  db.reset(world());
  await ER.handleLoggedEmail(msg({ to: ['jordan@larkspur.example'], message_id: '<c-1@example.com>' }), TOKEN);
  ok('a customer\'s email lands on the deal that won them', logged().length === 1 && logged()[0].deal_id === WON_DEAL);

  db.reset(world());
  await ER.handleLoggedEmail(msg({ from: 'seat@example.com', message_id: '<s-1@example.com>' }), TOKEN);
  ok('a team seat\'s email counts too', logged().length === 1);

  for (const [label, over, tok] of [
    ['from someone who isn\'t the studio', { from: 'stranger@elsewhere.test' }, TOKEN],
    ['failing the sender check (DMARC fail)', { authentication: { spf: 'pass', dkim: 'pass', dmarc: 'fail' } }, TOKEN],
    ['with no sender check at all', { authentication: null }, TOKEN],
    ['to nobody the studio knows', { to: ['unknown@elsewhere.test'] }, TOKEN],
    ['to an address that was turned off', {}, 'ffffffffffffffffffffffff'],
  ]) {
    db.reset(world());
    const rr = await ER.handleLoggedEmail(msg(over), tok);
    ok(`nothing is logged for an email ${label} (acknowledged, so Resend stops)`, rr.status === 200 && logged().length === 0);
  }
  // sales item 85: an email to someone with no deal lands on their own record, once
  {
    db.reset(world({ presence_person_events: [] }));
    const rr = await ER.handleLoggedEmail(msg({ to: ['nodeal@example.org'], message_id: '<nd-1@example.com>' }), TOKEN);
    const person = () => db.writes('presence_person_events').filter((w) => w.method === 'POST').map((w) => w.body);
    ok('an email to a contact with no deal is kept on their record, not on a deal', rr.status === 200 && logged().length === 0 && person().length === 1 && person()[0].contact_id === CT2 && person()[0].kind === 'email' && person()[0].via === 'bcc', JSON.stringify(person()));
    await ER.handleLoggedEmail(msg({ to: ['nodeal@example.org'], message_id: '<nd-1@example.com>' }), TOKEN);
    ok('…and a redelivery never doubles it', person().length === 1);
  }
  db.reset(world()); db.fail.add('presence_contacts');
  ok('a read that fails asks Resend to try again (502), nothing half-logged', (await ER.handleLoggedEmail(msg(), TOKEN)).status === 502 && logged().length === 0);
  db.reset(world()); db.fail.add('presence_sales_templates');
  ok('…including the address lookup', (await ER.handleLoggedEmail(msg(), TOKEN)).status === 502);
}

// ═══ through the whole inbound door: a signed Resend notice, the log address only in received_for ═══
async function sign(payloadObj) {
  const payload = JSON.stringify(payloadObj);
  const id = 'msg_evt_log', ts = String(Math.floor(Date.now() / 1000));
  const keyRaw = Uint8Array.from(atob(SECRET.replace(/^whsec_/, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', keyRaw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${payload}`)))));
  return new Request('https://x/functions/v1/presence/email/inbound', { method: 'POST', body: payload, headers: { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': `v1,${sig}`, 'content-type': 'application/json' } });
}
{
  const EMAIL_ID = '4ef9a417-02e9-4d39-ad75-9611e0fcc33c';
  const fake = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes('api.resend.com/emails/receiving/')) return new Response(JSON.stringify({ object: 'email', id: EMAIL_ID, ...msg() }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    return fake(url, init);
  };
  try {
    db.reset(world());
    const r = await handleInboundEmail(await sign({ type: 'email.received', data: {
      email_id: EMAIL_ID, from: 'Owner <owner@example.com>', to: ['Riley <riley@example.org>'], cc: [], bcc: [],
      received_for: [`log-${TOKEN}@reply.example.com`], subject: 'Your quote', message_id: '<quote-1@example.com>',
    } }));
    ok('the door sends a BCC\'d email to the log path even though the sender is the studio itself', r.status === 200 && logged().length === 1 && logged()[0].deal_id === OPEN_DEAL, JSON.stringify(logged()));
    ok('…and never opens a support request for it', !db.writes('presence_support_requests').length);
    db.reset(world());
    await handleInboundEmail(await sign({ type: 'email.received', data: { email_id: EMAIL_ID, from: 'Owner <owner@example.com>', to: ['riley@example.org'], subject: 'Your quote', message_id: '<quote-2@example.com>' } }));
    ok('without the log address the studio\'s own email is still dropped as before (no loop)', logged().length === 0 && !db.writes('presence_support_requests').length);
  } finally { globalThis.fetch = fake; }
}

// ═══ the page and the rules around it ═══
{
  const read = (rel) => Deno.readTextFileSync(new URL(rel, import.meta.url));
  const cn = read('../../connections.html'), roles = read('../../supabase/functions/presence/lib/site_roles.ts'), idx = read('../../supabase/functions/presence/index.ts');
  ok('Connections: a "Log emails you send" card with make / copy / new / off, each a configure control', /<div class="calt">Log emails you send<\/div>/.test(cn) && /id="logMake" data-needs="configure"/.test(cn) && /id="logNew" data-needs="configure"/.test(cn) && /id="logOff" data-needs="configure"/.test(cn) && /id="logCopy"/.test(cn));
  ok('making or turning off the address needs configure (team seats)', /'\(POST\|DELETE\) \/email\/log-address'/.test(roles));
  ok('the route is wired', /route === '\/email\/log-address' && \(method === 'GET' \|\| method === 'POST' \|\| method === 'DELETE'\)\) return handleEmailLogAddress/.test(idx));
}

console.log(`\n════ SALES EXTRAS 3a (item 69, the log address): ${pass}/${pass + fail} ${fail ? 'FAILED' : 'PASSED'} ════`);
if (fail) { console.log('failed:', failed.join(' | ')); Deno.exit(1); }
