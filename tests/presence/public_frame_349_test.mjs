// ── The one public frame, and what the thank-you page is told (builder item 349, Nov 2026) ──
// The pages a client lands on without signing in (a page not found, terms, privacy, a document
// link that isn't working, unsubscribe, the two pages after paying) share one frame drawn by
// public-frame.js: the studio's band, a card, its contact line. This proves:
//   · every one of those pages loads the frame and carries its three hooks, and none of them,
//     nor the frame's own words, ever says the product's name to a client
//   · the brand answer's contact details are only an email that is one and a phone that is one
//   · GET /public/pay/thanks refuses a bad or missing id and an invoice that isn't there, was
//     deleted or voided; answers the studio, the amount and a MASKED receipt address, never the
//     raw one; and says a sign-in exists only when the customer's contact has an auth user
//
//   deno run --allow-read --allow-env --allow-net tests/presence/public_frame_349_test.mjs
import { installFakePostgrest } from './fake_pgrst.mjs';

const db = installFakePostgrest();
const { handlePayThanks, maskEmail, moneyWords } = await import('../../supabase/functions/presence/routes/pay_thanks.ts');
const { handlePublicStudioBrand, publicContactFrom } = await import('../../supabase/functions/presence/routes/studio_brand.ts');

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) pass++; else { fail++; console.log('FAIL  ' + n + (d ? `\n      ${d}` : '')); } };

// ── 1. the pages wear the frame ──────────────────────────────────────────────
const PAGES = ['404.html', 'terms.html', 'privacy.html', 'doc.html', 'unsubscribe.html', 'payment-canceled.html', 'payment-success.html'];
const HOOKS = ['data-pf-band', 'data-pf-studio', 'data-pf-card', 'data-pf-foot'];
for (const f of PAGES) {
  const html = read(f);
  ok(`${f} loads the frame: its sheet first, its script deferred`, html.includes('<link rel="stylesheet" href="/public-frame.css">') && html.includes('<script src="/public-frame.js" defer></script>'));
  ok(`${f} carries the frame's hooks`, HOOKS.every((h) => html.includes(h)), HOOKS.filter((h) => !html.includes(h)).join(', '));
  ok(`${f} never says the product's name to a client`, !/Studio OS/.test(html));
  ok(`${f} carries no marketing chrome`, !html.includes('dds-marketing-nav') && !html.includes('nav.js'));
}
const frame = read('public-frame.js'), look = read('public-frame.css');
ok('the frame\'s own words name no product and no one', !/Studio OS|Davis Digital|Eric/.test(frame));
ok('the frame reads the studio from the address, then the memory the sign-in page writes', frame.includes("q.get('studio')") && frame.includes("localStorage.getItem('dds-studio-brand')") && frame.includes('/public/studio/'));
ok('the frame reserves the band\'s height and fades the name in', /\.pf-band\{[^}]*min-height:170px/.test(look) && /\.pf-studio\{[^}]*opacity:0;transition:opacity/.test(look) && look.includes('.pf-studio.pf-shown{opacity:1}'));
ok('the frame\'s words are 15px or larger', [...look.matchAll(/font-size:(\d+(?:\.\d+)?)px/g)].every((m) => Number(m[1]) >= 15));
ok('404.html links only absolute addresses (it answers every missing path)', [...read('404.html').matchAll(/(?:href|src)="([^"]+)"/g)].every((m) => /^(https?:|\/|#|mailto:)/.test(m[1])));

// ── 2. pure pieces ────────────────────────────────────────────────────────────
ok('an email is masked to its first letter and its domain', maskEmail('Maria@JuniperFloral.com') === 'm•••@juniperfloral.com' && maskEmail(' m@x.io ') === 'm•••@x.io');
ok('what isn\'t an email masks to nothing', ['', 'maria', '@x.com', 'm@', 'a b@x.com', 'a@b@c.com', null, 42].every((v) => maskEmail(v) === ''));
ok('money reads as dollars and cents', moneyWords(120000, 'usd') === '$1,200.00' && moneyWords(5, 'usd') === '$0.05' && moneyWords(-3, 'usd') === '$0.00');
ok('another currency shows its own sign or code', /1,200\.00/.test(moneyWords(120000, 'eur')) && moneyWords(100, 'xyz').startsWith('XYZ'));
ok('a contact is only an email that is one and a phone that is one', JSON.stringify(publicContactFrom(' hello@juniperfloral.com ', '(818) 555-0142')) === JSON.stringify({ email: 'hello@juniperfloral.com', phone: '(818) 555-0142' })
  && JSON.stringify(publicContactFrom('not an email', 'call us')) === JSON.stringify({ email: null, phone: null })
  && JSON.stringify(publicContactFrom(null, undefined)) === JSON.stringify({ email: null, phone: null }));

// ── 3. the thanks route ───────────────────────────────────────────────────────
const SITE = '11111111-1111-4111-8111-111111111111';
const CLIENT = '22222222-2222-4222-8222-222222222222', CONTACT = '33333333-3333-4333-8333-333333333333';
const INV = '44444444-4444-4444-8444-444444444444', INV_NO_LOGIN = '55555555-5555-4555-8555-555555555555';
const INV_VOID = '66666666-6666-4666-8666-666666666666', INV_GONE = '77777777-7777-4777-8777-777777777777', INV_QUIET = '88888888-8888-4888-8888-888888888888';
const DEAL = '99999999-9999-4999-8999-999999999999', DEAL_CONTACT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CLIENT2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', CONTACT2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
db.tables.presence_sites = [{ id: SITE, client_id: CLIENT }];
db.tables.presence_identity = [{ site_id: SITE, business_name: 'Juniper Floral', email: 'hello@juniperfloral.com', phone: '(818) 555-0142' }];
db.tables.presence_settings = [{ site_id: SITE, brand_kit: { primary: '#b4532a' }, logo_media_id: null }];
db.tables.clients = [
  { id: CLIENT, name: 'Juniper Floral', email: 'owner@juniperfloral.com', contact_email: null, contact_id: CONTACT },
  { id: CLIENT2, name: 'Pat Example', email: 'pat@client.example', contact_email: null, contact_id: CONTACT2 },
];
db.tables.contacts = [{ id: CONTACT, auth_user_id: 'user-1' }, { id: CONTACT2, auth_user_id: null }];
db.tables.presence_deals = [{ id: DEAL, site_id: SITE, contact_id: DEAL_CONTACT }];
db.tables.presence_contacts = [{ id: DEAL_CONTACT, site_id: SITE, email: 'maria@juniperfloral.com' }];
db.tables.presence_invoices = [
  { id: INV, site_id: SITE, deal_id: DEAL, customer_client_id: CLIENT, title: 'Website refresh', amount_cents: 120000, currency: 'usd', status: 'paid', paid_ref: 'pi_1', deleted_at: null },
  { id: INV_NO_LOGIN, site_id: SITE, deal_id: null, customer_client_id: CLIENT2, title: 'Deposit', amount_cents: 50000, currency: 'usd', status: 'open', paid_ref: 'pi_2', deleted_at: null },
  { id: INV_VOID, site_id: SITE, deal_id: null, customer_client_id: CLIENT, title: 'Old', amount_cents: 100, currency: 'usd', status: 'void', paid_ref: null, deleted_at: null },
  { id: INV_GONE, site_id: SITE, deal_id: null, customer_client_id: CLIENT, title: 'Gone', amount_cents: 100, currency: 'usd', status: 'paid', paid_ref: null, deleted_at: '2026-11-01T00:00:00Z' },
  { id: INV_QUIET, site_id: SITE, deal_id: null, customer_client_id: null, title: 'Pay by link', amount_cents: 7500, currency: 'usd', status: 'open', paid_ref: null, deleted_at: null },
];
db.tables.stripe_payments = [{ invoice_id: INV_NO_LOGIN, stripe_payment_intent: 'pi_2', email: 'pat@client.example', created_at: '2026-11-20T00:00:00Z' }];

const cors = { 'Access-Control-Allow-Origin': '*' };
const ask = async (q) => {
  const r = await handlePayThanks(new Request(`https://db.test/functions/v1/presence/public/pay/thanks${q}`), cors);
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, text, json, cache: r.headers.get('Cache-Control') };
};
{
  const none = await ask(''), bad = await ask('?paid=inv-123'), evil = await ask('?paid=' + encodeURIComponent(INV + "' or 1=1"));
  ok('no id, a made-up id, or an id with extras: refused with a sentence', [none, bad, evil].every((r) => r.status === 400 && r.json.error === 'bad_request' && typeof r.json.message === 'string'));
  const unknown = await ask('?paid=dddddddd-dddd-4ddd-8ddd-dddddddddddd'), voided = await ask('?paid=' + INV_VOID), gone = await ask('?paid=' + INV_GONE);
  ok('an invoice that isn\'t there, was voided, or was deleted: not found', [unknown, voided, gone].every((r) => r.status === 404 && r.json.error === 'not_found'));
  ok('a refusal is never cached', [none, bad, unknown].every((r) => r.cache === 'private, no-store'));
}
{
  const r = await ask('?paid=' + INV);
  const d = r.json?.data || {};
  ok('a paid invoice: the studio by name, in its colour', r.status === 200 && d.studio?.name === 'Juniper Floral' && /^#[0-9a-f]{6}$/i.test(d.studio?.accent || '') && d.studio.logo_url === null, r.text);
  ok('…the amount and what it was for', d.amount === '$1,200.00' && d.invoice_title === 'Website refresh');
  ok('…the receipt address masked (the deal\'s contact), and the raw address nowhere in the answer', d.receipt_to === 'm•••@juniperfloral.com' && !r.text.includes('maria@') && !r.text.includes('owner@'));
  ok('…and a sign-in, because the customer\'s contact has an auth user', d.signin === true);
  ok('the answer is never cached', r.cache === 'private, no-store');
  ok('the answer carries nothing else (no ids, no status, no site)', Object.keys(d).sort().join(',') === 'amount,invoice_title,receipt_to,signin,studio' && Object.keys(d.studio).sort().join(',') === 'accent,contact,logo_url,name');
  ok('…and the studio\'s own contact for the footer line', d.studio.contact?.email === 'hello@juniperfloral.com' && d.studio.contact?.phone === '(818) 555-0142');
}
{
  const r = await ask('?paid=' + INV_NO_LOGIN);
  const d = r.json?.data || {};
  ok('no deal contact: the address Stripe collected, masked', r.status === 200 && d.receipt_to === 'p•••@client.example' && !r.text.includes('pat@'));
  ok('the customer\'s contact has no auth user: no sign-in', d.signin === false);
  ok('a still-open invoice (the webhook hasn\'t caught up) is answered too', d.amount === '$500.00' && d.invoice_title === 'Deposit');
}
{
  const r = await ask('?paid=' + INV_QUIET);
  const d = r.json?.data || {};
  ok('pay-by-link with no customer and no email anywhere: no address, no sign-in, still the studio and the amount', r.status === 200 && d.receipt_to === null && d.signin === false && d.amount === '$75.00' && d.studio?.name === 'Juniper Floral');
}
// the route only ever reads
ok('the thanks route writes nothing', db.log.every((l) => !l.method || l.method === 'GET'), JSON.stringify(db.log.filter((l) => l.method && l.method !== 'GET').slice(0, 3)));

// ── 4. the brand answer's contact line ───────────────────────────────────────
{
  const r = await handlePublicStudioBrand(SITE, cors);
  const d = (await r.json()).data || {};
  ok('the public brand answer carries the contact its website shows', d.name === 'Juniper Floral' && d.contact?.email === 'hello@juniperfloral.com' && d.contact?.phone === '(818) 555-0142', JSON.stringify(d));
  ok('…and is still cached for the sign-in page', (r.headers.get('Cache-Control') || '').includes('max-age=900'));
  db.tables.presence_identity = [{ site_id: SITE, business_name: 'Juniper Floral', email: 'owner at home', phone: null }];
  db.tables.presence_locations = [{ site_id: SITE, phone: '818 555 0199' }];
  const r2 = await handlePublicStudioBrand(SITE, cors);
  const d2 = (await r2.json()).data || {};
  ok('an email that isn\'t one is left out; the location\'s phone stands in for a missing one', d2.contact?.email === null && d2.contact?.phone === '818 555 0199', JSON.stringify(d2.contact));
}

console.log(`\n════ PUBLIC FRAME + THANKS ROUTE (item 349): ${pass}/${pass + fail} ${fail ? 'FAILED' : 'PASSED'} ════`);
if (fail) Deno.exit(1);
