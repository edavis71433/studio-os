// ── Sales item 110: Contacts and Customers (bug hunt K, Nov 10 2026) ─────────
//   deno run --allow-read --allow-env --allow-net tests/presence/contacts_customers_110_test.mjs
// Drives the real handlers on the in-memory PostgREST (fake_pgrst.mjs):
//   K1  an email matches whatever its capitals, the way the database's one-contact-
//       per-email rule matches (lower(email)); "_" in an address is not a wildcard
//   K4  the contacts read takes the page's sort, "Recently updated" and People's
//       Customers / Not yet, so page one is the real top past 100 people
//   K6  two adds of one new person at once are the same person, not a failure;
//       "Owes you" reads every open invoice, not the first 300; a convert rolled
//       back leaves no contact pointing at the customer it removed
import { installFakePostgrest } from './fake_pgrst.mjs';
const SITE = '11111111-1111-4111-8111-111111111111', CLIENT = '22222222-2222-4222-8222-222222222222', U = '33333333-3333-4333-8333-333333333333';
const JANE = 'aaaaaaaa-0000-4000-8000-000000000001', BO = 'aaaaaaaa-0000-4000-8000-000000000002';
// presence_contacts_site_email_uq (0074): one live contact per site and LOWER-CASED email
const db = installFakePostgrest({ unique: { presence_contacts: [{ cols: ['site_id', 'email'], where: (r) => r.deleted_at == null && String(r.email || '') !== '', key: (r) => r.site_id + '|' + String(r.email || '').toLowerCase() }] } });
const S = await import('../../supabase/functions/presence/routes/sales.ts');
const E = await import('../../supabase/functions/presence/lib/contact_email.ts');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n, note); } };
const site = { id: SITE, client_id: CLIENT, status: 'live', edition: 'presence' };
const owner = { kind: 'client', userId: U, email: 'owner@studio.test', jwt: 'jwt-owner', requestId: 't' };
const cors = {};
const req = (method, path, b) => new Request(`https://fn.test/functions/v1/presence${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
const res = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const contact = (id, email, extra = {}) => ({ id, site_id: SITE, name: '', email, phone: '', company: '', notes: '', custom: {}, client_id: null, deleted_at: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...extra });

// ═══ the helpers ═══
ok('helper: normEmail trims and lower-cases', E.normEmail('  Jane@Example.COM ') === 'jane@example.com');
ok('helper: emailMatch is a case-blind ilike on the lower-cased address', E.emailMatch('Jane@Example.com') === 'email=ilike.jane%40example.com');
ok('helper: emailMatch escapes _ and % so they are themselves', decodeURIComponent(E.emailMatch('jo_e%x@y.com')) === 'email=ilike.jo\\_e\\%x@y.com');
ok('helper: an address with * (no escape in PostgREST) falls back to an exact match', E.emailMatch('a*b@y.com') === 'email=eq.a*b%40y.com');
ok('helper: another column can be named', E.emailMatch('A@b.co', 'contact_email').startsWith('contact_email=ilike.'));
ok('helper: isUniqueViolation reads the Postgres code', E.isUniqueViolation({ status: 409, json: { code: '23505' } }) && !E.isUniqueViolation({ status: 409, json: { code: '23503' } }) && !E.isUniqueViolation({ status: 500, json: null, text: '' }));

// ═══ K1: one person, whatever the capitals ═══
{
  db.reset({ presence_contacts: [contact(JANE, 'Jane@Example.com', { name: 'Jane' })] });
  const r = await res(await S.handleSalesContacts(req('POST', '/sales/contacts', { name: 'Jane', email: 'jane@example.com' }), site, owner, cors));
  ok('K1: adding jane@example.com finds Jane@Example.com (was "That contact didn’t save")', r.status === 200 && r.body?.deduped === true && r.body?.data?.id === JANE, JSON.stringify(r));
  ok('K1: …and writes nothing', db.writes('presence_contacts').length === 0);
  const imp = await res(await S.handleSalesContacts(req('POST', '/sales/contacts', { name: 'Jane', email: 'JANE@EXAMPLE.COM' }), site, owner, cors));
  ok('K1: an import row in capitals is "already existed", not "couldn’t be imported"', imp.status === 200 && imp.body?.deduped === true);
}
{
  db.reset({ presence_contacts: [contact(JANE, 'jane_doe@example.com', { name: 'Jane' })] });
  const r = await res(await S.handleSalesContacts(req('POST', '/sales/contacts', { name: 'Janet', email: 'janeXdoe@example.com' }), site, owner, cors));
  ok('K1: "_" is not a wildcard — janeXdoe@ is a new person, not jane_doe@', r.status === 201 && r.body?.data?.email === 'janexdoe@example.com', JSON.stringify(r));
}
{
  db.reset({ presence_contacts: [contact(JANE, 'Jane@Example.com', { name: 'Jane' }), contact(BO, 'bo@example.com', { name: 'Bo' })] });
  const r = await res(await S.handleSalesContact(req('PATCH', `/sales/contacts/${BO}`, { email: 'jane@example.com' }), site, owner, BO, cors));
  ok('K1: changing Bo’s email to Jane’s (other capitals) is the plain 409, not a failed save', r.status === 409 && r.body?.error === 'email_taken', JSON.stringify(r));
}
{
  db.reset({ presence_contacts: [contact(JANE, 'Jane@Example.com', { name: 'Jane', notes: '' })] });
  const c = await S.ensureConnectContact(SITE, 'jane@example.com', 'Jane', false);
  ok('K1: "Make customer" / "Add a customer" finds Jane whatever the capitals (so her contact gets linked)', c?.id === JANE && db.writes('presence_contacts').length === 0, JSON.stringify(c));
  db.reset({ presence_contacts: [] });
  const n = await S.ensureConnectContact(SITE, 'New@Person.com', 'New', false);
  ok('K1: a new connect contact is stored lower-cased', n?.email === 'new@person.com', JSON.stringify(n));
}

// ═══ K6: two adds of one new person at once ═══
{
  db.reset({ presence_contacts: [] });
  // the other add lands between this request's check and its insert
  const real = globalThis.fetch;
  let injected = false;
  globalThis.fetch = async (url, init = {}) => {
    if (!injected && (init.method || 'GET').toUpperCase() === 'POST' && String(url).includes('/rest/v1/presence_contacts')) {
      injected = true; db.tables.presence_contacts.push(contact(JANE, 'jane@example.com', { name: 'Jane' }));
    }
    return real(url, init);
  };
  const r = await res(await S.handleSalesContacts(req('POST', '/sales/contacts', { name: 'Jane', email: 'jane@example.com' }), site, owner, cors));
  globalThis.fetch = real;
  ok('K6: the second of two simultaneous adds answers "already existed" with the first’s row', injected && r.status === 200 && r.body?.deduped === true && r.body?.data?.id === JANE, JSON.stringify(r));
}
{
  db.reset({ presence_contacts: [] });
  db.failMethod.set('presence_contacts', 'POST');
  const r = await res(await S.handleSalesContacts(req('POST', '/sales/contacts', { name: 'Jane', email: 'jane@example.com' }), site, owner, cors));
  ok('K6: a real write failure is still a failure (only the duplicate-key refusal reads as "existed")', r.status === 502 && r.body?.error === 'write_failed');
}

// ═══ K4: the server reads the page's order and views ═══
{
  const people = [];
  for (let i = 0; i < 130; i++) people.push(contact(`bbbbbbbb-0000-4000-8000-${String(i).padStart(12, '0')}`, `p${i}@example.com`, { name: `Person ${String(129 - i).padStart(3, '0')}`, updated_at: `2026-${i < 65 ? '09' : '11'}-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`, client_id: i % 3 === 0 ? CLIENT : null }));
  people.push(contact('bbbbbbbb-0000-4000-8000-0000000000aa', 'aaron@example.com', { name: 'Aaron Able', updated_at: '2026-01-01T00:00:00Z' }));
  db.reset({ presence_contacts: people });
  const r = await res(await S.handleSalesContacts(req('GET', '/sales/contacts?limit=100&offset=0&total=1&sort=name&dir=asc'), site, owner, cors));
  ok('K4: sorted by name, page one starts at the real top (Aaron, edited months ago)', r.status === 200 && r.body?.data?.[0]?.name === 'Aaron Able' && r.body?.total === 131, JSON.stringify(r.body?.data?.[0]));
  ok('K4: …ordered by the column, then id (pages never repeat or skip)', db.reads('order=name.asc,id.desc').length === 1);
  db.log.length = 0;
  await S.handleSalesContacts(req('GET', '/sales/contacts?sort=updated_at&dir=desc'), site, owner, cors);
  await S.handleSalesContacts(req('GET', '/sales/contacts?sort=deleted_at;drop&dir=asc'), site, owner, cors);
  await S.handleSalesContacts(req('GET', '/sales/contacts'), site, owner, cors);
  ok('K4: only the roster’s columns sort; anything else, or nothing, is newest edits first', db.reads('order=updated_at.desc,id.desc').length === 3, db.log.map((c) => c.url).join(' | '));
  const since = '2026-11-01T00:00:00.000Z';
  const rec = await res(await S.handleSalesContacts(req('GET', `/sales/contacts?total=1&sort=name&dir=asc&since=${encodeURIComponent(since)}`), site, owner, cors));
  ok('K4: "Recently updated" is a server filter, with its own count', rec.body?.data?.every((c) => c.updated_at >= since) && rec.body?.total === 65, `total=${rec.body?.total}`);
  const bad = await res(await S.handleSalesContacts(req('GET', '/sales/contacts?total=1&since=yesterday'), site, owner, cors));
  ok('K4: a since= that isn’t a date is ignored', bad.body?.total === 131);
  const yes = await res(await S.handleSalesContacts(req('GET', '/sales/contacts?total=1&customer=yes'), site, owner, cors));
  const no = await res(await S.handleSalesContacts(req('GET', '/sales/contacts?total=1&customer=no'), site, owner, cors));
  ok('K4: People’s Customers / Not yet are server filters that add up to everyone', yes.body?.total === 44 && no.body?.total === 87 && yes.body.data.every((c) => c.client_id) && no.body.data.every((c) => !c.client_id), `${yes.body?.total} + ${no.body?.total}`);
  ok('helper: contactsOrder', S.contactsOrder('email', 'desc') === 'email.desc,id.desc' && S.contactsOrder('', '') === 'updated_at.desc,id.desc');
}

// ═══ K6: "Owes you" reads every open invoice ═══
{
  const invs = [];
  for (let i = 0; i < 1100; i++) invs.push({ id: `cccccccc-0000-4000-8000-${String(i).padStart(12, '0')}`, site_id: SITE, title: `Invoice ${i}`, amount_cents: 1000, status: 'open', due_date: '2026-12-01', deal_id: null, created_at: '2026-10-01T00:00:00Z', deleted_at: null });
  db.reset({ presence_invoices: invs });
  const out = await S.loadReceivables(site, '2026-11-11');
  ok('K6: 1,100 open invoices are all counted (was the first 300)', out.items.length === 1100 && out.total_cents === 1100 * 1000, `items=${out.items.length}`);
  ok('K6: …read 500 at a time, id breaking ties', db.reads('presence_invoices?').filter((c) => c.url.includes('status=eq.open')).length === 3 && db.reads('created_at.asc,id.asc&limit=500').length === 3);
  db.reset({ presence_invoices: invs });
  let n = 0; const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => { if (String(url).includes('status=eq.open') && ++n === 2) return new Response(JSON.stringify({ message: 'boom' }), { status: 500 }); return real(url, init); };
  let threw = false; try { await S.loadReceivables(site, '2026-11-11'); } catch { threw = true; }
  globalThis.fetch = real;
  ok('K6: a second page that fails is a failure, never a smaller book', threw);
}

// ═══ K1 + K6 in the source: every contact email lookup goes through the one rule ═══
{
  const read = (p) => Deno.readTextFileSync(new URL(`../../supabase/functions/presence/${p}`, import.meta.url));
  const files = ['routes/sales.ts', 'routes/commercial.ts', 'routes/booking.ts', 'routes/reviews.ts', 'routes/prospects.ts', 'routes/connect_requests.ts', 'routes/commerce.ts'];
  const exact = files.filter((f) => /presence_contacts\?[^`]*email=eq\.\$\{encodeURIComponent/.test(read(f)));
  ok('K1: no "is there one already?" contact lookup compares the email exactly', exact.length === 0, exact.join(', '));
  ok('K1: booking and review contacts are stored lower-cased', /email: normEmail\(v\.booking\.email\)/.test(read('routes/booking.ts')) && /email: normEmail\(v\.review\.email\)/.test(read('routes/reviews.ts')));
  ok('K1: the enquiry form keeps its email lower-cased', /const email = clip\(body\?\.email, 200\)\.toLowerCase\(\)/.test(read('lib/commercial.ts')));
  ok('K1: the enquiry reply’s contact is lower-cased and matched case-blind', /const email = normEmail\(emailIn\);\n\s*const hit = await svc\(`presence_contacts\?site_id=eq\.\$\{siteId\}&\$\{emailMatch\(email\)\}/.test(read('routes/commercial.ts')));
  const sales = read('routes/sales.ts');
  ok('K6: a convert rolled back unlinks the contact from the customer it removed', /if \(createdClient\) \{ await svc\(`clients\?id=eq\.\$\{clientId\}`, \{ method: 'DELETE' \}\)[\s\S]{0,400}presence_contacts\?site_id=eq\.\$\{site\.id\}&client_id=eq\.\$\{clientId\}`, \{ method: 'PATCH', body: JSON\.stringify\(\{ client_id: null \}\)/.test(sales));
}

console.log(`\n════ CONTACTS + CUSTOMERS (item 110): ${pass}/${pass + fail} PASSED ════`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
