// ── Sales item 93: a hand-over pack for a client who leaves (Nov 2026) ─────────
//   deno run --allow-read --allow-env --allow-net tests/presence/handover_pack_93_test.mjs
// One zip with everything a business needs to run without its studio: the website as
// plain files, photos and files (a very large one as a 30-day link), the domain and its
// live records, their customers' enquiries, bookings and reviews, their invoices from
// the studio, and who owns what. The studio downloads it from the record, or emails the
// owner that it waits in their portal. Pure shaping first, then the real route.
import { installFakePostgrest } from './fake_pgrst.mjs';
Deno.env.set('RESEND_KEY', 're_test');   // read when the mail module loads: the email below is captured, never sent
const SITE = '11111111-1111-4111-8111-111111111111', CLIENT = '22222222-2222-4222-8222-222222222222', STUDIO = '33333333-3333-4333-8333-333333333333';
const db = installFakePostgrest();
const L = await import('../../supabase/functions/presence/lib/handover_pack.ts');
const R = await import('../../supabase/functions/presence/routes/handover_pack.ts');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n, note); } };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}`);

// ═══ 1. pure ═══
eq('a safe file name keeps its extension', [L.safeName('Spring bouquet / hero.jpg', 'x'), L.safeName('', 'file-1'), L.safeName('../../etc', 'f')], ['Spring-bouquet-hero.jpg', 'file-1', 'etc']);
eq('the same name twice gets -2', L.uniqueNames(['a.jpg', 'A.jpg', 'b', 'b']), ['a.jpg', 'A-2.jpg', 'b', 'b-2']);
const big = L.PACK_MAX_FILE + 1;
const plan = L.planFiles([{ id: '1', name: 'small', bytes: 1000 }, { id: '2', name: 'huge', bytes: big }, ...Array.from({ length: 5 }, (_, i) => ({ id: 'm' + i, name: 'm' + i, bytes: 10 * 1024 * 1024 }))]);
ok('a file too big for the pack comes as a link, and so does what would make the pack too big', plan.linked.some((f) => f.id === '2') && plan.inside.some((f) => f.id === '1') && plan.inside.reduce((a, f) => a + f.bytes, 0) <= L.PACK_MAX_FILES_TOTAL && plan.linked.filter((f) => f.bytes <= L.PACK_MAX_FILE).every((f) => plan.inside.reduce((a, x) => a + x.bytes, 0) + f.bytes > L.PACK_MAX_FILES_TOTAL), JSON.stringify([plan.inside.map((f) => f.id), plan.linked.map((f) => f.id)]));
const csvs = L.customerCsvs({
  submissions: [{ created_at: '2026-10-02T10:00:00Z', form_kind: 'contact', name: 'Lena', email: 'lena@example.com', message: 'Hi', source_page: '/contact', status: 'new' }, { created_at: '2026-10-03T10:00:00Z', form_kind: 'newsletter', email: 'sam@example.com' }],
  appointments: [{ slot_start_local: '2026-10-05 10:00', type_name: 'Fitting', customer_name: 'Ana', customer_email: 'ana@example.com', duration_min: 30, price_cents: 4500, status: 'confirmed' }],
  reviews: [{ created_at: '2026-10-06T10:00:00Z', reviewer_name: 'Bo', rating: 5, body: 'Great', status: 'approved' }],
});
eq('customers: three spreadsheets with their counts', csvs.map((c) => [c.name, c.count]), [['customers/enquiries-and-sign-ups.csv', 2], ['customers/bookings.csv', 1], ['customers/reviews.csv', 1]]);
ok('customers: a sign-up says so, a price reads in dollars, a shown review says Yes', csvs[0].text.includes(',Sign-up,') && csvs[1].text.includes(',45.00,') && csvs[2].text.includes(',Yes,'));
const inv = L.invoicesCsv([
  { id: 'a', title: 'Website build', amount_cents: 100000, status: 'open', number: 13, created_at: '2026-10-01', due_date: '2026-10-31' },
  { id: 'p', title: 'Part payment — Website build', amount_cents: 50000, status: 'paid', payment_for: 'a', paid_method: 'check', created_at: '2026-10-10', paid_at: '2026-10-10T12:00:00Z' },
  { id: 'v', title: 'Voided', amount_cents: 1, status: 'void', number: 14, created_at: '2026-10-11' },
], (n) => (n ? '#' + String(n).padStart(4, '0') : ''));
ok('invoices: a part payment sits under its invoice\'s number, a void is left out', inv.count === 1 && inv.text.includes('#0013,Part payment toward Website build,500.00,Paid') && !inv.text.includes('Voided'), inv.text);
const dom = L.domainText({ domain: 'juniper.example', registrar: 'Namecheap', expires_at: '2027-03-01T00:00:00Z', dns_host: '', whose: 'the studio’s', auto_renew: true, note: '', records: [
  { name: 'juniper.example', type: 'A', value: '75.2.60.5' }, { name: 'juniper.example', type: 'MX', value: '1 aspmx.l.google.com.' }, { name: 'juniper.example', type: 'TXT', value: 'v=spf1 include:_spf.google.com ~all' }, { name: 'juniper.example', type: 'TXT', value: 'google-site-verification=abc' },
] }, 'Bright Studio');
ok('domain: where it is, when it renews, and which records are the website\'s and which keep email working', dom.includes('Registered at: Namecheap (in the studio’s account)') && dom.includes('Renews by: 2027-03-01, and it renews by itself') && /website[\s\S]*A\s+juniper\.example\s+->\s+75\.2\.60\.5[\s\S]*email work[\s\S]*MX\s+juniper\.example/.test(dom) && !dom.includes('google-site-verification'), dom);
ok('domain: none yet says so', L.domainText({ domain: null, registrar: '', expires_at: null, dns_host: '', whose: '', auto_renew: null, note: '', records: [] }, 'S').includes('no domain of its own'));
const owns = L.ownsText({ studio: 'Bright Studio', business: 'Juniper Floral', domain: 'juniper.example', registrar: 'Namecheap', whose: 'the studio’s', google_listing: true, search_console: false, mail_host: 'Google Workspace' });
ok('who owns what: a step for each account that exists', owns.includes('1. Your domain, juniper.example') && owns.includes('Ask for it to be moved to an account of your own') && owns.includes('Google Business Profile') && !owns.includes('Search Console') && owns.includes('Google Workspace'));
const start = L.startHereHtml({ business: 'Juniper <Floral>', studio: 'Bright Studio', made_at: '2026-11-12T10:00:00Z', pages: 4, files_inside: 3, files_linked: 1, counts: { enquiries: 2, bookings: 1, reviews: 1 }, invoices: 1, domain: 'juniper.example' });
ok('START-HERE: every part linked, names escaped, the linked file said', start.includes('href="website/index.html"') && start.includes('href="who-owns-what.txt"') && start.includes('Juniper &lt;Floral&gt;') && start.includes('photos-and-files/LINKS.txt'));
eq('the mail host by its records', [R.mailHostOf(['1 aspmx.l.google.com.']), R.mailHostOf(['0 juniper-example.mail.protection.outlook.com.']), R.mailHostOf([])], ['Google Workspace', 'Microsoft 365', '']);

// ═══ 2. the route ═══
const unzip = (buf) => { const u = new Uint8Array(buf), dv = new DataView(u.buffer), out = {}; let o = 0; while (o + 30 <= u.length && dv.getUint32(o, true) === 0x04034b50) { const size = dv.getUint32(o + 18, true), nl = dv.getUint16(o + 26, true), xl = dv.getUint16(o + 28, true); const name = new TextDecoder().decode(u.slice(o + 30, o + 30 + nl)); out[name] = u.slice(o + 30 + nl + xl, o + 30 + nl + xl + size); o += 30 + nl + xl + size; } return out; };
const site = { id: SITE, client_id: CLIENT, status: 'live', edition: 'presence', template_slug: 'harbor', template_version: '1.0.0', custom_domain: null };
const studio = { kind: 'client', userId: 'u-studio', email: 'owner@studio.test', jwt: 'jwt', requestId: 't', scope: { site_id: SITE, name: 'Juniper Floral' } };
const owner = { kind: 'client', userId: 'u-owner', email: 'ivy@juniper.example', jwt: 'jwt', requestId: 't', member: { site_id: SITE, role: 'business_owner' } };
const staff = { ...owner, member: { site_id: SITE, role: 'business_staff' } };
const cors = {};
const world = () => ({
  presence_identity: [{ site_id: SITE, business_name: 'Juniper Floral' }],
  presence_media: [{ id: 'aaaaaaaa-0000-4000-8000-000000000001', site_id: SITE, storage_path: 'presence-media/s/hero.jpg', alt_text: 'Spring bouquet', mime: 'image/jpeg', bytes: 2048, created_at: '2026-10-01', deleted_at: null }],
  presence_form_submissions: [{ site_id: SITE, spam: false, created_at: '2026-10-02T10:00:00Z', form_kind: 'contact', name: 'Lena', email: 'lena@example.com', message: 'Hi', status: 'new' }, { site_id: SITE, spam: true, created_at: '2026-10-02T10:00:00Z', name: 'Spammer' }],
  presence_appointments: [], presence_reviews: [],
  presence_invoices: [{ id: 'iiiiiiii-0000-4000-8000-000000000001', site_id: STUDIO, customer_client_id: CLIENT, title: 'Website build', amount_cents: 150000, status: 'paid', number: 21, paid_at: '2026-10-20', created_at: '2026-10-01', deleted_at: null }],
  presence_sites: [{ id: SITE, custom_domain: null }],
  presence_service_links: [{ customer_site_id: SITE, agency_site_id: STUDIO, status: 'active', created_at: '2026-01-01' }],
  presence_connections: [{ site_id: SITE, provider_key: 'google_business_profile', status: 'connected' }],
  clients: [{ id: CLIENT, name: 'Ivy Chen', email: 'ivy@juniper.example', contact_email: null }],
});
// the photo's bytes come from storage; the fake answers that one path
const realFetch = globalThis.fetch;
globalThis.fetch = (url, init) => String(url).includes('/storage/v1/object/authenticated/presence-media/s/hero.jpg') ? Promise.resolve(new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 })) : realFetch(url, init);
const get = (who) => R.handleHandoverPack(new Request('https://fn.test/functions/v1/presence/handover/pack'), site, who, cors);
db.reset(world());
let r = await get(studio);
ok('route: a zip, named for the business, never cached', r.status === 200 && r.headers.get('Content-Type') === 'application/zip' && /hand-over-pack-juniper-floral-\d{4}-\d{2}-\d{2}\.zip/.test(r.headers.get('Content-Disposition') || '') && r.headers.get('Cache-Control') === 'no-store' && r.headers.get('Access-Control-Expose-Headers') === 'Content-Disposition', `${r.status} ${r.headers.get('Content-Disposition')}`);   // the page, on another address, may read the name
const z = unzip(await r.arrayBuffer());
const names = Object.keys(z);
ok('route: the website\'s pages are in it', names.some((n) => n === 'website/index.html'), names.filter((n) => n.startsWith('website/')).slice(0, 5).join(', '));
ok('route: its pages call nothing of ours (no visit counter, no form or booking address): they run on any host', Object.keys(z).filter((n) => n.startsWith('website/') && n.endsWith('.html')).every((n) => !new TextDecoder().decode(z[n]).includes('/functions/v1/presence')));
ok('route: the photo is in it, under its own name', names.includes('photos-and-files/Spring-bouquet.jpg') && z['photos-and-files/Spring-bouquet.jpg'].length === 4);
const txt = (n) => new TextDecoder().decode(z[n] || new Uint8Array());
ok('route: the customers, spam left out', txt('customers/enquiries-and-sign-ups.csv').includes('Lena') && !txt('customers/enquiries-and-sign-ups.csv').includes('Spammer'));
ok('route: their invoices from the studio', txt('invoices-from-us.csv').includes('#0021,Website build,1500.00,Paid'));
ok('route: who owns what names the Google listing, and START-HERE opens it all', txt('who-owns-what.txt').includes('Google Business Profile') && txt('START-HERE.html').includes('Juniper Floral: everything to take with you') && txt('their-domain.txt').includes('no domain of its own'));
r = await get(owner);
ok('route: the business\'s owner can take it too', r.status === 200);
r = await get(staff);
ok('route: a staff seat can\'t', r.status === 403);
db.reset(world()); db.fail.add('presence_form_submissions');
r = await get(studio);
ok('route: a read that fails builds nothing and says so', r.status === 502 && /nothing was downloaded/.test((await r.json()).message));

// ═══ 3. the email ═══
const post = (who) => R.handleHandoverPack(new Request('https://fn.test/functions/v1/presence/handover/notify', { method: 'POST', body: '{}' }), site, who, cors);
const mail = () => db.log.filter((c) => c.method === 'POST' && c.url.startsWith('/emails'));
db.reset(world());
r = await post(studio);
let b = await r.json();
// the fake answers the mail service with a 404, so the send reads as failed: what matters is what was asked
ok('email: it goes to the business\'s owner, from the studio, pointing at their portal', mail().length === 1 && mail()[0].body.to === 'ivy@juniper.example' && /Download your hand-over pack/.test(mail()[0].body.html) && new RegExp(`portal\\.html\\?studio=${STUDIO}`).test(mail()[0].body.html), JSON.stringify(mail()[0]?.body?.to));
ok('email: a send that didn\'t leave says so, and the next press may try again', r.status === 502 && b.error === 'send_failed' && JSON.parse((db.tables.presence_sales_templates || []).find((t) => t.name === '__handover_pack__')?.body || '{}').sent_at === null);
db.reset({ ...world(), presence_sales_templates: [{ id: 'hp', site_id: SITE, kind: 'proposal', name: '__handover_pack__', body: JSON.stringify({ sent_at: new Date().toISOString() }), deleted_at: null, updated_at: new Date().toISOString() }] });
r = await post(studio);
ok('email: a second press in two minutes is never a second email', r.status === 409 && mail().length === 0);
r = await post(owner);
ok('email: only the studio sends it', r.status === 403);
db.reset({ ...world(), clients: [{ id: CLIENT, name: 'Ivy', email: '', contact_email: null }] });
r = await post(studio);
ok('email: nobody on file is a sentence, not a send', r.status === 422 && mail().length === 0);

// ═══ 4. the pages ═══
const crm = Deno.readTextFileSync(new URL('../../crm.html', import.meta.url));
const portal = Deno.readTextFileSync(new URL('../../client.html', import.meta.url));
ok('crm.html: Hand-over pack sits under More for a customer with a website', /if\(ids\.client&&REC&&REC\.header&&REC\.header\.status==='customer'\)btns\.push\(\{id:'act-handover',label:'Hand-over pack'/.test(crm));
ok('client.html: Help offers the owner the download', portal.includes("html+=packCardHtml();") && portal.includes('Download your hand-over pack') && /role&&role!=='business_owner'/.test(portal));

globalThis.fetch = realFetch;
console.log(`\n════ SALES ITEM 93 (hand-over pack): ${pass}/${pass + fail} PASSED ════`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
