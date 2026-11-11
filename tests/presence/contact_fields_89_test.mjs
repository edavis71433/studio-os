// ── Sales item 89: a contact holds an address, a job title, a second phone and tags ─
//   deno run --allow-read --allow-env --allow-net tests/presence/contact_fields_89_test.mjs
// The pure rules (lib/contact_fields.ts) and the real contact routes on the in-memory
// PostgREST (fake_pgrst.mjs): what is stored, the tag filter, and a database that
// hasn't had APPLY-0166 yet (the save goes through and says what didn't stick).
import { installFakePostgrest } from './fake_pgrst.mjs';
const SITE = '11111111-1111-4111-8111-111111111111', CLIENT = '22222222-2222-4222-8222-222222222222', U = '33333333-3333-4333-8333-333333333333';
const C1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const db = installFakePostgrest();
const S = await import('../../supabase/functions/presence/routes/sales.ts');
const F = await import('../../supabase/functions/presence/lib/contact_fields.ts');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n, note); } };
const site = { id: SITE, client_id: CLIENT, status: 'live', edition: 'presence' };
const owner = { kind: 'client', userId: U, email: 'owner@studio.test', jwt: 'jwt-owner', requestId: 't' };
const cors = {};
const req = (method, path, b) => new Request(`https://fn.test/functions/v1/presence${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
const res = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const contact = (id, extra = {}) => ({ id, site_id: SITE, name: '', email: '', phone: '', company: '', notes: '', custom: {}, client_id: null, found_via: '', job_title: '', phone2: '', address: {}, tags: [], deleted_at: null, updated_at: '2026-10-01T00:00:00Z', ...extra });

// ═══ the pure rules ═══
ok('tags: lower-case, each once, commas split, at most twelve', JSON.stringify(F.normalizeTags('Restaurant, past  client;REFERRAL,restaurant')) === JSON.stringify(['restaurant', 'past client', 'referral']) && F.normalizeTags(Array.from({ length: 20 }, (_, i) => 't' + i)).length === 12);
ok('tags: a list works as well as text, and # or blank ones go', JSON.stringify(F.normalizeTags(['#vip', '', '  '])) === JSON.stringify(['vip']));
ok('address: only its five parts, trimmed and capped', JSON.stringify(F.normalizeAddress({ street: ' 12 Elm St ', city: 'Glendale', state: 'CA', zip: '91203', evil: '<x>' })) === JSON.stringify({ street: '12 Elm St', city: 'Glendale', state: 'CA', zip: '91203' }));
ok('address: a plain line (an import) is kept as the street', JSON.stringify(F.normalizeAddress('12 Elm St, Glendale, CA 91203')) === JSON.stringify({ street: '12 Elm St, Glendale, CA 91203' }));
ok('address: on one line, state and ZIP together', F.addressLine({ street: '12 Elm St', city: 'Glendale', state: 'CA', zip: '91203' }) === '12 Elm St, Glendale, CA 91203' && F.addressLine({}) === '');
ok('tel: digits and a leading +', F.telHref('(555) 010-4410') === 'tel:5550104410' && F.telHref('+1 555 010 4410') === 'tel:+15550104410' && F.telHref('call me') === '');
ok('contactMoreFrom: a field left out stays out', JSON.stringify(Object.keys(F.contactMoreFrom({ job_title: 'Owner' }))) === JSON.stringify(['job_title']));

// ═══ saved, read, filtered ═══
{
  db.reset({ presence_contacts: [], presence_sales_templates: [] });
  const r = await res(await S.handleSalesContacts(req('POST', '/sales/contacts', { name: 'Ana Ruiz', email: 'ana@example.com', job_title: ' Owner ', phone2: '(555) 010-3300', address: { street: '12 Elm St', city: 'Glendale', state: 'CA', zip: '91203' }, tags: 'Restaurant, referral' }), site, owner, cors));
  const row = db.tables.presence_contacts[0];
  ok('add: the new fields are stored cleaned', r.status === 201 && row.job_title === 'Owner' && row.phone2 === '(555) 010-3300' && row.address.city === 'Glendale' && JSON.stringify(row.tags) === JSON.stringify(['restaurant', 'referral']), JSON.stringify(row));
  const up = await res(await S.handleSalesContact(req('PATCH', `/sales/contacts/${row.id}`, { tags: ['vip'], address: { street: '9 Oak Ave' } }), site, owner, row.id, cors));
  ok('edit: tags and the address change, the rest stays', up.status === 200 && JSON.stringify(row.tags) === JSON.stringify(['vip']) && row.address.street === '9 Oak Ave' && row.job_title === 'Owner');
  const one = await res(await S.handleSalesContact(req('GET', `/sales/contacts/${row.id}`), site, owner, row.id, cors));
  ok('detail: the contact answers its new fields', one.body?.data?.contact?.job_title === 'Owner' && one.body.data.contact.phone2 === '(555) 010-3300' && one.body.data.contact.tags[0] === 'vip' && one.body.data.contact.address.street === '9 Oak Ave');
}
{
  db.reset({ presence_contacts: [contact(C1, { name: 'Ana', tags: ['restaurant', 'past client'] }), contact('aaaaaaaa-0000-4000-8000-000000000002', { name: 'Bo', tags: ['referral'] }), contact('aaaaaaaa-0000-4000-8000-000000000003', { name: 'Cy', tags: [] })] });
  const r = await res(await S.handleSalesContacts(req('GET', '/sales/contacts?total=1&tag=Past%20Client'), site, owner, cors));
  ok('list: tag= lists everyone with that tag (whatever its capitals), with its count', r.body?.data?.length === 1 && r.body.data[0].name === 'Ana' && r.body.total === 1, JSON.stringify(r.body));
  ok('list: the filter is asked of the database as "contains"', db.reads('tags=cs.{"past client"}').length >= 1);
  const all = await res(await S.handleSalesContacts(req('GET', '/sales/contacts'), site, owner, cors));
  ok('list: rows carry the tags and job title for the page', all.body?.data?.every((c) => Array.isArray(c.tags)) && 'job_title' in all.body.data[0]);
}

// ═══ before APPLY-0166 ═══
{
  db.reset({ presence_contacts: [], presence_sales_templates: [] });
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const body = init.body ? String(init.body) : '';
    if (String(url).includes('/rest/v1/presence_contacts') && /"(job_title|tags|phone2|address)"/.test(body)) return new Response(JSON.stringify({ code: 'PGRST204', message: "Could not find the 'job_title' column of 'presence_contacts' in the schema cache" }), { status: 400 });
    return real(url, init);
  };
  const r = await res(await S.handleSalesContacts(req('POST', '/sales/contacts', { name: 'Ana', email: 'ana@example.com', job_title: 'Owner', tags: ['vip'] }), site, owner, cors));
  globalThis.fetch = real;
  ok('before APPLY-0166: the contact still saves, and says the new fields wait for the update', r.status === 201 && r.body?.warning === 'fields_unavailable' && db.tables.presence_contacts.length === 1 && !('job_title' in db.tables.presence_contacts[0]));
}

// ═══ the record shows them ═══
{
  const crm = Deno.readTextFileSync(new URL('../../supabase/functions/presence/routes/crm.ts', import.meta.url));
  ok('record: the header reads the new fields, falling back before APPLY-0166', /select=name,company,email,phone,found_via,\$\{CONTACT_MORE_COLS\.join\(','\)\}/.test(crm) && /more\.address = line/.test(crm) && /more\.tags = ct\.tags\.map\(String\)/.test(crm));
  const page = Deno.readTextFileSync(new URL('../../crm.html', import.meta.url));
  ok('record page: both phones are a tap to call that can offer to log it, and the editor has an ec-address box', /data-call-deal=/.test(page) && /field\('ec-phone2','Second phone'/.test(page) && /inp\('ec-address'/.test(page));
}

console.log(`\n════ CONTACT FIELDS (item 89): ${pass}/${pass + fail} PASSED ════`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
