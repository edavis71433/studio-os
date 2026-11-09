// ── Sales extras, batch 2 (item 69, Nov 2026): "How did they find you?" and
// "Download my data". Real handlers against the shared in-memory PostgREST;
// all names and addresses are made up.
//   deno run --allow-read --allow-env --allow-net tests/presence/sales_extras_2_test.mjs
import { installFakePostgrest } from './fake_pgrst.mjs';
const SITE = '11111111-1111-4111-8111-111111111111', CLIENT = '22222222-2222-4222-8222-222222222222', U = '33333333-3333-4333-8333-333333333333';
const CUST = '44444444-4444-4444-8444-444444444444', PROJ = '55555555-5555-4555-8555-555555555555';
const C1 = 'c0000000-0000-4000-8000-000000000001', C2 = 'c0000000-0000-4000-8000-000000000002';
const D1 = 'd0000000-0000-4000-8000-000000000001', D2 = 'd0000000-0000-4000-8000-000000000002';
const SUB = 'e0000000-0000-4000-8000-000000000001';
const db = installFakePostgrest({ unique: { presence_sales_templates: [{ cols: ['site_id', 'kind', 'name'], where: (r) => r.deleted_at == null && /^__.*__$/.test(String(r.name)) }] } });
const FV = await import('../../supabase/functions/presence/lib/found_via.ts');
const Z = await import('../../supabase/functions/presence/lib/zip_csv.ts');
const R = await import('../../supabase/functions/presence/lib/sales_reports.ts');
const S = await import('../../supabase/functions/presence/routes/sales.ts');
const X = await import('../../supabase/functions/presence/routes/sales_export.ts');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n, note); } };
const site = { id: SITE, client_id: CLIENT, status: 'live', edition: 'presence' };
const owner = { kind: 'client', userId: U, email: 'owner@studio.test', jwt: 'jwt-owner', requestId: 't' };
const cors = {};
const req = (method, path, b) => new Request(`https://fn.test/functions/v1/presence${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
const res = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const day = (n) => new Date(Date.now() + n * 86400_000).toISOString();
const world = () => ({
  presence_contacts: [
    { id: C1, site_id: SITE, name: 'Jordan Ellis', email: 'jordan@example.com', phone: '', company: 'Larkspur Studio', found_via: 'Referral', deleted_at: null, created_at: day(-30), updated_at: day(-1) },
    { id: C2, site_id: SITE, name: 'Riley Park', email: 'riley@example.com', phone: '', company: '', found_via: '', deleted_at: null, created_at: day(-20), updated_at: day(-1) },
  ],
  presence_deals: [
    { id: D1, site_id: SITE, contact_id: C1, title: 'Website rebuild', stage: 'won', converted_client_id: CUST, converted_at: day(-5), expected_value_cents: 250000, source: 'manual', found_via: 'Google', deleted_at: null, created_at: day(-30), updated_at: day(-5) },
    { id: D2, site_id: SITE, contact_id: C2, title: 'Logo refresh', stage: 'proposal', expected_value_cents: 90000, source: 'manual', found_via: '', deleted_at: null, created_at: day(-10), updated_at: day(-1) },
  ],
  presence_form_submissions: [{ id: SUB, site_id: SITE, name: 'Sam', email: 'sam@example.com', phone: '', message: '=HYPERLINK("x")', source_page: '/contact', status: 'new', spam: false, created_at: day(-2) }],
  presence_sales_templates: [], presence_deal_events: [],
});
// Before APPLY-0143 the columns don't exist: PostgREST answers PGRST204 for a write naming found_via
// and 42703 for a read selecting it. This wraps the fake to behave that way.
const realFetch = globalThis.fetch;
const withoutColumn = (fn) => async (...a) => {
  const fake = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url));
    const body = init.body ? String(init.body) : '';
    if (/\/rest\/v1\/presence_(contacts|deals)/.test(u) && (/"found_via"/.test(body))) return new Response(JSON.stringify({ code: 'PGRST204', message: "Could not find the 'found_via' column of 'presence_deals' in the schema cache" }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    if (/\/rest\/v1\/presence_(contacts|deals)/.test(u) && /select=[^&]*found_via/.test(u)) return new Response(JSON.stringify({ code: '42703', message: 'column presence_contacts.found_via does not exist' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    return fake(url, init);
  };
  try { return await fn(...a); } finally { globalThis.fetch = fake; }
};

// ═══ "How did they find you?" ═══
{
  ok('the list: Google, Referral, Word of mouth, Social, Repeat client, Website, Other', FV.FOUND_VIA.join('|') === 'Google|Referral|Word of mouth|Social|Repeat client|Website|Other');
  ok('a pick matches whatever the case; anything else is not recorded', FV.normalizeFoundVia('word OF mouth') === 'Word of mouth' && FV.normalizeFoundVia('TikTok') === '' && FV.normalizeFoundVia(null) === '');
  ok('a report says "Not recorded" for nothing', FV.foundViaLabel('') === 'Not recorded' && FV.foundViaLabel('google') === 'Google');

  db.reset(world());
  const c = await res(await S.handleSalesContacts(req('POST', '/sales/contacts', { name: 'Avery Stone', email: 'avery@example.com', found_via: 'social' }), site, owner, cors));
  ok('Log an enquiry: the person is saved with the answer', c.status === 201 && db.tables.presence_contacts.find((x) => x.email === 'avery@example.com')?.found_via === 'Social', JSON.stringify(c.body));
  const d = await res(await S.handleSalesDeals(req('POST', '/sales/deals', { title: 'Avery', contact_id: c.body.data.id, source: 'manual' }), site, owner, cors));
  ok('a deal for that person takes their answer when none is given', d.status === 201 && db.tables.presence_deals.find((x) => x.title === 'Avery')?.found_via === 'Social', JSON.stringify(d.body));
  const d2 = await res(await S.handleSalesDeals(req('POST', '/sales/deals', { title: 'Avery 2', contact_id: c.body.data.id, found_via: 'Repeat client' }), site, owner, cors));
  ok('…but an answer given on the deal wins', d2.status === 201 && db.tables.presence_deals.find((x) => x.title === 'Avery 2')?.found_via === 'Repeat client');
  const w = await res(await S.handleSalesDeals(req('POST', '/sales/deals', { title: 'From the website', source_submission_id: SUB }), site, owner, cors));
  ok('a deal made from a website enquiry is "Website"', w.status === 201 && db.tables.presence_deals.find((x) => x.title === 'From the website')?.found_via === 'Website', JSON.stringify(w.body));
  const none = await res(await S.handleSalesContacts(req('POST', '/sales/contacts', { name: 'Blake', email: 'blake@example.com' }), site, owner, cors));
  ok('no answer writes nothing extra (the column is left at its default)', none.status === 201 && !('found_via' in db.writes('presence_contacts').find((x) => x.body?.email === 'blake@example.com').body));

  // the deal page sets it; the person gets it when theirs is blank, and keeps their own otherwise
  db.reset(world());
  const p = await res(await S.handleSalesDeal(req('PATCH', `/sales/deals/${D2}`, { found_via: 'Word of mouth' }), site, owner, D2, cors));
  ok('deal page: saved on the deal', p.status === 200 && db.tables.presence_deals.find((x) => x.id === D2).found_via === 'Word of mouth');
  ok('deal page: the deal\'s person had none, so they get the same answer', db.tables.presence_contacts.find((x) => x.id === C2).found_via === 'Word of mouth');
  await S.handleSalesDeal(req('PATCH', `/sales/deals/${D1}`, { found_via: 'Social' }), site, owner, D1, cors);
  ok('deal page: a person who already has an answer keeps it', db.tables.presence_contacts.find((x) => x.id === C1).found_via === 'Referral');
  const cp = await res(await S.handleSalesContact(req('PATCH', `/sales/contacts/${C2}`, { found_via: 'Google' }), site, owner, C2, cors));
  ok('record: the person\'s answer saves from their details', cp.status === 200 && cp.body?.data?.found_via === 'Google' && db.tables.presence_contacts.find((x) => x.id === C2).found_via === 'Google', JSON.stringify(cp.body));

  // before APPLY-0143: everything still saves; only the answer waits
  db.reset(world());
  const pre = await res(await withoutColumn(() => S.handleSalesContacts(req('POST', '/sales/contacts', { name: 'Casey', email: 'casey@example.com', found_via: 'Google' }), site, owner, cors))());
  ok('before the database step: Log an enquiry still saves the person (without the answer)', pre.status === 201 && db.tables.presence_contacts.some((x) => x.email === 'casey@example.com'), JSON.stringify(pre.body));
  const preDeal = await res(await withoutColumn(() => S.handleSalesDeals(req('POST', '/sales/deals', { title: 'Casey deal', found_via: 'Google' }), site, owner, cors))());
  ok('before the database step: a deal still saves', preDeal.status === 201 && db.tables.presence_deals.some((x) => x.title === 'Casey deal'), JSON.stringify(preDeal.body));
  const prePatch = await res(await withoutColumn(() => S.handleSalesDeal(req('PATCH', `/sales/deals/${D2}`, { notes: 'Call Friday', found_via: 'Google' }), site, owner, D2, cors))());
  ok('before the database step: the rest of a deal save goes through', prePatch.status === 200 && db.tables.presence_deals.find((x) => x.id === D2).notes === 'Call Friday', JSON.stringify(prePatch.body));
  const preOnly = await res(await withoutColumn(() => S.handleSalesContact(req('PATCH', `/sales/contacts/${C2}`, { found_via: 'Google' }), site, owner, C2, cors))());
  ok('before the database step: saving only the answer says it needs the update (409), nothing else changes', preOnly.status === 409 && preOnly.body?.error === 'found_via_unavailable');
  const preMixed = await res(await withoutColumn(() => S.handleSalesContact(req('PATCH', `/sales/contacts/${C2}`, { phone: '555 0100', found_via: 'Google' }), site, owner, C2, cors))());
  ok('before the database step: a details save goes through and says the answer didn\'t stick', preMixed.status === 200 && preMixed.body?.warning === 'found_via_unavailable' && db.tables.presence_contacts.find((x) => x.id === C2).phone === '555 0100', JSON.stringify(preMixed.body));
  const preRead = await res(await withoutColumn(() => S.handleSalesContact(req('GET', `/sales/contacts/${C1}`), site, owner, C1, cors))());
  ok('before the database step: a contact still opens', preRead.status === 200, JSON.stringify(preRead.body)?.slice(0, 200));

  const wl = R.wonAndLost([
    { id: 'a', stage: 'won', converted_client_id: 'x', converted_at: day(-3), expected_value_cents: 1000, found_via: 'Google' },
    { id: 'b', stage: 'won', converted_client_id: 'y', converted_at: day(-4), expected_value_cents: 2000, found_via: 'Google' },
    { id: 'c', stage: 'won', converted_client_id: 'z', converted_at: day(-5), expected_value_cents: 500 },
  ], new Date().toISOString());
  const g = wl.won_by_found_via.find((x) => x.label === 'Google');
  ok('the Won report groups by how they found you, next to where the deal came from', g && g.count === 2 && g.value_cents === 3000 && wl.won_by_found_via.some((x) => x.label === 'Not recorded' && x.count === 1) && Array.isArray(wl.won_by_source), JSON.stringify(wl.won_by_found_via));
}

// ═══ the zip and the CSVs ═══
const unzip = (bytes) => {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let e = bytes.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  const n = dv.getUint16(e + 10, true), cdOff = dv.getUint32(e + 16, true);
  const out = {}; let p = cdOff;
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('bad central header');
    const crc = dv.getUint32(p + 16, true), size = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), lo = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nl));
    if (dv.getUint32(lo, true) !== 0x04034b50) throw new Error('bad local header');
    const lnl = dv.getUint16(lo + 26, true), lel = dv.getUint16(lo + 28, true);
    const data = bytes.subarray(lo + 30 + lnl + lel, lo + 30 + lnl + lel + size);
    if (Z.crc32(data) !== crc) throw new Error('crc mismatch ' + name);
    out[name] = new TextDecoder().decode(data);
    p += 46 + nl + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
  }
  return out;
};
{
  ok('crc32: the standard check value ("123456789" → CBF43926)', Z.crc32(new TextEncoder().encode('123456789')) === 0xCBF43926);
  ok('csv: commas, quotes and line breaks are quoted', Z.csvCell('a,b') === '"a,b"' && Z.csvCell('say "hi"') === '"say ""hi"""' && Z.csvCell('two\nlines') === '"two\nlines"' && Z.csvCell(null) === '');
  ok('csv: a cell that starts like a formula is kept as text', Z.csvCell('=SUM(A1)') === "'=SUM(A1)" && Z.csvCell('+1') === "'+1" && Z.csvCell('@x') === "'@x" && Z.csvCell('-2') === "'-2");
  ok('csv: a byte-order mark for Excel, CRLF line ends', Z.toCsv(['A', 'B'], [[1, 'x']]) === '﻿A,B\r\n1,x\r\n');
  const zipped = Z.zipStore([{ name: 'a.csv', data: new TextEncoder().encode('one') }, { name: 'café.txt', data: new TextEncoder().encode('two ✓') }]);
  const files = unzip(zipped);
  ok('zip: every file comes back exactly, checksums match, UTF-8 names kept', files['a.csv'] === 'one' && files['café.txt'] === 'two ✓');
}

// ═══ Download my data ═══
{
  db.reset({ ...world(),
    presence_proposals: [{ id: 'p1', site_id: SITE, deal_id: D2, title: 'Logo refresh', version: 1, status: 'sent', subtotal_cents: 90000, sent_at: day(-3), deleted_at: null, created_at: day(-3) }],
    presence_contracts: [{ id: 'k1', site_id: SITE, deal_id: D1, title: 'Service agreement', status: 'signed', signed_at: day(-6), signer_name: 'Jordan Ellis', created_at: day(-7) }],
    presence_invoices: [{ id: 'i1', site_id: SITE, deal_id: D1, title: 'Deposit', amount_cents: 125000, status: 'paid', paid_at: day(-5), due_date: day(-6), deleted_at: null, created_at: day(-7) }],
    presence_support_requests: [{ id: 's1', site_id: SITE, subject: 'Logo tweak', status: 'open', priority: 'normal', requester: 'jordan@example.com', client_id: CUST, body: 'Bigger, please', deleted_at: null, created_at: day(-1) }],
    presence_deal_tasks: [{ id: 't1', site_id: SITE, deal_id: D2, title: 'Send the quote', due_date: day(1), status: 'open', deleted_at: null, created_at: day(-1) }],
    presence_tasks: [{ id: 't2', site_id: SITE, project_id: PROJ, title: 'Build the pages', due_date: day(3), status: 'todo', deleted_at: null, created_at: day(-1) }],
    presence_projects: [{ id: PROJ, site_id: SITE, name: 'Larkspur site' }],
    presence_service_links: [{ project_id: PROJ, agency_site_id: SITE, customer_client_id: CUST, status: 'active', created_at: day(-5) }],
    clients: [{ id: CUST, name: 'Larkspur Studio', email: 'jordan@example.com', contact_email: null, created_at: day(-5) }],
  });
  const r = await X.handleSalesExport(site, owner, cors);
  ok('the owner gets one zip, as a download', r.status === 200 && r.headers.get('Content-Type') === 'application/zip' && /attachment; filename="studio-data-\d{4}-\d{2}-\d{2}\.zip"/.test(r.headers.get('Content-Disposition') || ''));
  const files = unzip(new Uint8Array(await r.arrayBuffer()));
  const names = Object.keys(files).sort().join(',');
  ok('every list is in it, plus a READ-ME', names === 'READ-ME.txt,agreements.csv,contacts.csv,customers.csv,deals.csv,enquiries.csv,invoices-and-payments.csv,proposals.csv,support-requests.csv,tasks.csv', names);
  ok('deals: stage names, dollars, how they found you, the contact', /Website rebuild,Won,2500\.00,,manual,Google,jordan@example\.com/.test(files['deals.csv']) && /Logo refresh,Proposal sent,900\.00/.test(files['deals.csv']), files['deals.csv']);
  ok('contacts carry their answer; customers name the business', /Jordan Ellis,jordan@example\.com,,Larkspur Studio,Referral/.test(files['contacts.csv']) && /Larkspur Studio,jordan@example\.com,active/.test(files['customers.csv']));
  ok('invoices, agreements, proposals, support and tasks name their deal or project', /Website rebuild,Deposit,1250\.00,paid/.test(files['invoices-and-payments.csv']) && /Website rebuild,Service agreement,signed/.test(files['agreements.csv']) && /Logo refresh,Logo refresh,1,sent,900\.00/.test(files['proposals.csv']) && /Logo tweak,Larkspur Studio,open,normal/.test(files['support-requests.csv']) && /Deal: Logo refresh,Send the quote/.test(files['tasks.csv']) && /Project: Larkspur site,Build the pages/.test(files['tasks.csv']));
  ok('an enquiry that looks like a formula is kept as text', files['enquiries.csv'].includes(`"'=HYPERLINK(""x"")"`), files['enquiries.csv']);
  ok('every read is this studio\'s own', db.log.filter((c) => c.method === 'GET' && /\/rest\/v1\/presence_/.test(c.url)).every((c) => c.url.includes(`site_id=eq.${SITE}`)), JSON.stringify(db.log.filter((c) => c.method === 'GET' && !c.url.includes(SITE)).map((c) => c.url)));

  db.fail.add('presence_invoices');
  const part = unzip(new Uint8Array(await (await X.handleSalesExport(site, owner, cors)).arrayBuffer()));
  ok('a list that can\'t be read is left out and named in the READ-ME, never shipped empty', !('invoices-and-payments.csv' in part) && /couldn't be read just now.*invoices-and-payments\.csv/.test(part['READ-ME.txt']));
  db.fail.delete('presence_invoices');

  const staff = { ...owner, userId: '77777777-7777-4777-8777-777777777777', member: { site_id: SITE, role: 'business_staff' } };
  ok('a team seat whose role may export gets it too', (await X.handleSalesExport(site, staff, cors)).status === 200);
  const odd = await X.handleSalesExport(site, { ...staff, member: { site_id: SITE, role: 'not_a_role' } }, cors);
  ok('a seat with no export right is refused', odd.status === 403);
}

// ═══ the pages ═══
{
  const read = (rel) => Deno.readTextFileSync(new URL(rel, import.meta.url));
  const inbox = read('../../inbox.html'), pipe = read('../../pipeline.html'), crm = read('../../crm.html'), an = read('../../analytics.html'), st = read('../../settings.html'), css = read('../../shell.css'), idx = read('../../supabase/functions/presence/index.ts'), crmTs = read('../../supabase/functions/presence/routes/crm.ts');
  ok('Log an enquiry asks, and sends the answer with the person and the deal', /<select id="ne-found" class="dds-pick">/.test(inbox) && /api\('\/sales\/contacts','POST',\{name,email,phone,notes:msg\?\('Enquiry: '\+msg\):'',found_via\}\)/.test(inbox) && /contact_id:contactId,source:'manual',notes:msg\?\('Enquiry: '\+msg\):'',found_via\}\)/.test(inbox));
  ok('the deal page shows and saves it', /<select id="ed-found" class="dds-pick">\$\{foundOpts\(d\.found_via\)\}<\/select>/.test(pipe) && /found_via:\$\('ed-found'\)\?\$\('ed-found'\)\.value:undefined/.test(pipe));
  ok('the record shows it on the details card and edits it with the person', /'Found you through '\+esc\(hd\.found_via\)/.test(crm) && /<select id="ec-found" class="dds-pick">/.test(crm) && /found_via:\$\('ec-found'\)\.value\}/.test(crm) && /select=name,company,email,phone,found_via&limit=1/.test(crmTs));
  ok('Analytics: Won, by how they found you', /<h4>Won, by how they found you<\/h4>'\+grp\(d\.won_by_found_via,'Found you through'\)/.test(an));
  ok('one picker style that sizes properly on an iPhone', /\.dds-pick\{-webkit-appearance:none;appearance:none;/.test(css) && /@media \(max-width:767px\)\{\.dds-pick\{min-height:44px\}\}/.test(css));
  ok('Settings › Plan & billing: Download my data fetches the zip as a file', /id="dlData">Download my data</.test(st) && /fetch\(FN \+ '\/sales\/export', \{ headers: H\(\) \}\)/.test(st) && /a\.download = 'studio-data-'/.test(st));
  ok('the route is wired: GET /sales/export', /route === '\/sales\/export' && method === 'GET'\) return handleSalesExport\(site, principal, cors\)/.test(idx));
  ok('the database step ships with an apply pack and a check', /add column if not exists found_via text not null default ''/.test(read('../../docs/presence/APPLY-0143-prod.sql')) && /information_schema\.columns/.test(read('../../docs/presence/APPLY-0143-prod.sql')));
}

globalThis.fetch = globalThis.fetch || realFetch;
console.log(`\n════ SALES EXTRAS 2 (item 69): ${pass}/${pass + fail} ${fail ? 'FAILED' : 'PASSED'} ════`);
if (fail) { console.log('failed:', failed.join(' | ')); Deno.exit(1); }
