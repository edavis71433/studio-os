// ── Prospects — the lead list (Semrush review, sales item 112): the real routes ──
// Find businesses (Google Places faked), score each with a quick look at their
// website (fetch faked), tick-to-save with dedupe, "→ Deal" once, a first-email
// draft that is only ever WORDS (this surface sends nothing), and the CSV export.
// Real handlers against the shared in-memory PostgREST; all names made up.
//   deno run --allow-read --allow-env --allow-net tests/presence/prospects_routes_test.mjs
import { installFakePostgrest } from './fake_pgrst.mjs';
const uuid = (c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const SITE = uuid('1'), OWNER = uuid('2'), U = uuid('3');
const db = installFakePostgrest({ users: { 'jwt-owner': { id: U, email: 'owner@example.com' } }, ownSite: { 'jwt-owner': SITE } });

// the outside world: Google Places answers; anything else outside is recorded
const pg = globalThis.fetch;
let placesCalls = [], placesAnswer = null, outside = [];
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (u.hostname === 'places.googleapis.com') {
    placesCalls.push(JSON.parse(String(init.body || '{}')));
    return new Response(JSON.stringify(placesAnswer || { places: [] }), { status: placesAnswer?.error ? 500 : 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (u.hostname !== 'db.test') { outside.push(`${(init.method || 'GET').toUpperCase()} ${u.hostname}`); return new Response('{}', { status: 404 }); }
  return pg(url, init);
};
const PX = await import('../../supabase/functions/presence/routes/prospects.ts');

let pass = 0, fail = 0;
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; console.log('FAIL ', n, note); } };
const cors = {};
const site = { id: SITE, client_id: OWNER, status: 'live', edition: 'presence' };
const owner = { kind: 'client', userId: U, email: 'owner@example.com', jwt: 'jwt-owner', requestId: 't' };
const req = (method, path, body) => new Request(`https://fn.test/functions/v1/presence${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-owner' } });
const res = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const kept = () => (db.tables.presence_prospects || []).filter((p) => !p.deleted_at);
const world = () => { db.reset({ presence_sites: [{ id: SITE, client_id: OWNER }], presence_identity: [{ site_id: SITE, business_name: 'Davis Digital Studio' }] }); placesCalls = []; outside = []; placesAnswer = null; };

// the quick look is faked per-URL: what each prospect's site looks like
PX.quickDeps.fetchPage = async (url) => {
  if (url.includes('down.example')) return null;
  if (url.includes('old-diner.example')) return { ok: true, status: 200, html: '<html><body>Welcome to our diner</body></html>' };
  return { ok: true, status: 200, html: '<html><head><title>Hi</title><meta name="viewport" content="width=device-width"></head></html>' };
};

// ═══ without a key, it says so plainly ═══
{
  world(); Deno.env.delete('PLACES_KEY');
  const r = await res(await PX.handleProspectDiscover(req('POST', '/sales/prospects/discover', { trade: 'plumbers', town: 'Burbank' }), site, owner, cors));
  ok('no key: places_not_configured, a plain sentence, nothing saved', r.status === 200 && r.body.error === 'places_not_configured' && /isn’t switched on/.test(r.body.message) && kept().length === 0);
  ok('no key: Google was never called', placesCalls.length === 0);
}

Deno.env.set('PLACES_KEY', 'places-key-for-tests');

// ═══ discover: search, quick-score, sort warmest first ═══
{
  world();
  placesAnswer = { places: [
    { displayName: { text: 'Old Diner' }, websiteUri: 'https://old-diner.example', nationalPhoneNumber: '(818) 555-0101', formattedAddress: '1 Main St, Burbank, CA 91501', primaryTypeDisplayName: { text: 'Diner' } },
    { displayName: { text: 'Fresh Fades Barbershop' }, nationalPhoneNumber: '(818) 555-0102', formattedAddress: '2 Main St, Burbank, CA 91501', primaryTypeDisplayName: { text: 'Barber shop' } },
    { displayName: { text: 'Shiny Dental' }, websiteUri: 'https://shiny-dental.example', formattedAddress: '3 Main St, Burbank, CA 91501' },
    { displayName: { text: 'Broken Site Plumbing' }, websiteUri: 'https://down.example' },
  ] };
  const r = await res(await PX.handleProspectDiscover(req('POST', '/sales/prospects/discover', { trade: 'plumbers', town: 'Burbank' }), site, owner, cors));
  const f = r.body.data.finds;
  ok('discover answers every find with the words the page shows', r.status === 200 && r.body.data.found === 4 && f.every((x) => x.business_name && x.health_word));
  ok('the search Google ran is "<trade> in <town>"', placesCalls[0]?.textQuery === 'plumbers in Burbank');
  ok('no website scores highest, then a dead site, then a dated one, then a decent one',
    f[0].business_name === 'Fresh Fades Barbershop' && f[0].site_health === 'no_website' && f[0].score === 95
    && f[1].business_name === 'Broken Site Plumbing' && f[1].site_health === 'unreachable'
    && f[2].business_name === 'Old Diner' && f[2].site_health === 'dated'
    && f[3].business_name === 'Shiny Dental' && f[3].site_health === 'decent', JSON.stringify(f.map((x) => [x.business_name, x.site_health])));
  ok('discover saves nothing by itself', kept().length === 0);
  const short = await res(await PX.handleProspectDiscover(req('POST', '/sales/prospects/discover', { trade: 'p', town: '' }), site, owner, cors));
  ok('a one-letter search is refused with an example', short.status === 422 && /plumbers/.test(short.body.message));
}

// ═══ save the ticked ones; the same business never lands twice ═══
{
  const r = await res(await PX.handleProspects(req('POST', '/sales/prospects', { query: 'plumbers in Burbank', prospects: [
    { business_name: 'Fresh Fades Barbershop', phone: '(818) 555-0102', address: '2 Main St, Burbank, CA 91501', industry: 'Barber shop', site_health: 'no_website', score: 95 },
    { business_name: 'Old Diner', website: 'https://old-diner.example', site_health: 'dated', score: 65 },
  ] }), site, owner, cors));
  ok('two ticked finds are saved with the search that found them', r.status === 201 && r.body.data.saved.length === 2 && kept().length === 2 && kept()[0].search_query === 'plumbers in Burbank');
  const again = await res(await PX.handleProspects(req('POST', '/sales/prospects', { prospects: [
    { business_name: 'FRESH FADES barbershop!' },
    { business_name: 'The Old Diner Co', website: 'https://www.old-diner.example/menu' },
    { business_name: 'Brand New Bakery', site_health: 'nonsense', score: 400 },
  ] }), site, owner, cors));
  ok('the same name and the same website host are skipped; a new one lands', again.body.data.saved.length === 1 && again.body.data.skipped === 2 && kept().length === 3);
  const bakery = kept().find((p) => p.business_name === 'Brand New Bakery');
  ok('nonsense health and score are not stored as sent', bakery.site_health === 'unknown' && bakery.score === 100);   // 400 clamps to the scale's top
  const empty = await res(await PX.handleProspects(req('POST', '/sales/prospects', { prospects: [] }), site, owner, cors));
  ok('saving nothing says to tick something', empty.status === 422 && /Tick at least one/.test(empty.body.message));
  const list = await res(await PX.handleProspects(req('GET', '/sales/prospects'), site, owner, cors));
  ok('the list reads back warmest first with plain words', list.status === 200 && list.body.data.length === 3 && list.body.data[0].health_word === 'No website');
}

// ═══ status, notes, and off the list ═══
{
  const id = kept().find((p) => p.business_name === 'Old Diner').id;
  const r = await res(await PX.handleProspect(req('PATCH', `/sales/prospects/${id}`, { status: 'Contacted', notes: 'Called, spoke to the owner.' }), site, owner, id, cors));
  ok('a prospect can be marked Contacted with a note', r.status === 200 && r.body.data.status === 'Contacted' && r.body.data.notes === 'Called, spoke to the owner.');
  const bad = await res(await PX.handleProspect(req('PATCH', `/sales/prospects/${id}`, { status: 'Lost' }), site, owner, id, cors));
  ok('a made-up status is refused', bad.status === 422);
  const gone = await res(await PX.handleProspect(req('DELETE', `/sales/prospects/${id}`), site, owner, id, cors));
  ok('off the list is soft: the row keeps its history, the list forgets it', gone.status === 200 && kept().length === 2 && (db.tables.presence_prospects || []).length === 3);
  const missing = await res(await PX.handleProspect(req('PATCH', `/sales/prospects/${id}`, { status: 'New' }), site, owner, id, cors));
  ok('a removed prospect is not found again', missing.status === 404);
}

// ═══ "→ Deal": once, with the facts along ═══
{
  const p = kept().find((x) => x.business_name === 'Fresh Fades Barbershop');
  const r = await res(await PX.handleProspectConvert(req('POST', `/sales/prospects/${p.id}/convert`), site, owner, p.id, cors));
  const deal = (db.tables.presence_deals || [])[0];
  ok('the deal starts at lead, named for the business, with the facts in its notes', r.status === 201 && deal && deal.stage === 'lead' && deal.title === 'Fresh Fades Barbershop' && /No website/.test(deal.notes) && /\(818\) 555-0102/.test(deal.notes) && deal.source === 'prospecting');
  ok('the prospect remembers its deal and reads In pipeline', kept().find((x) => x.id === p.id).deal_id === deal.id && kept().find((x) => x.id === p.id).status === 'In pipeline');
  const again = await res(await PX.handleProspectConvert(req('POST', `/sales/prospects/${p.id}/convert`), site, owner, p.id, cors));
  ok('a second “→ Deal” returns the same deal, never a twin', again.status === 200 && again.body.already_converted === true && (db.tables.presence_deals || []).length === 1);
  // sales item 119: the deal is WITH someone — the business as a contact, with its phone and address
  const contacts = (db.tables.presence_contacts || []).filter((c) => !c.deleted_at);
  const c = contacts[0];
  ok('item 119: “→ Deal” makes the contact too, and the deal is with them', contacts.length === 1 && deal.contact_id === c.id && r.body.contact && r.body.contact.id === c.id && r.body.contact.reused === false, JSON.stringify({ contacts, deal }));
  ok('item 119: the contact carries the business’s name, phone and address in parts', c.name === 'Fresh Fades Barbershop' && c.phone === '(818) 555-0102' && c.address && c.address.city === 'Burbank' && c.address.state === 'CA' && c.address.zip === '91501' && c.address.street === '2 Main St', JSON.stringify(c));
  ok('item 119: and says where it came from, and that there’s no website', /Found on Prospects by searching “plumbers in Burbank”/.test(c.notes) && /No website found/.test(c.notes) && c.email === '');
  ok('item 119: a second “→ Deal” makes no second contact', (db.tables.presence_contacts || []).length === 1);
}

// ═══ item 119: a contact already holding the phone number is used, not doubled ═══
{
  const before = (db.tables.presence_contacts || []).length;
  db.tables.presence_contacts.push({ id: uuid('9'), site_id: SITE, name: 'Bakery front desk', email: 'desk@bakery.example', phone: '+1 818-555-0177', company: 'Brand New Bakery', notes: '', deleted_at: null });
  const sd = kept().find((x) => x.business_name === 'Brand New Bakery');
  db.tables.presence_prospects.find((x) => x.id === sd.id).phone = '(818) 555-0177';
  const r = await res(await PX.handleProspectConvert(req('POST', `/sales/prospects/${sd.id}/convert`), site, owner, sd.id, cors));
  const deal = (db.tables.presence_deals || []).find((d) => d.title === 'Brand New Bakery');
  ok('item 119: the same number (written another way) links the contact already there', r.status === 201 && deal && deal.contact_id === uuid('9') && r.body.contact.reused === true && (db.tables.presence_contacts || []).length === before + 1, JSON.stringify(r.body));
}

// ═══ item 119: a contact that won't save starts no deal ═══
{
  const p2 = { id: uuid('a'), site_id: SITE, business_name: 'Quiet Cafe', phone: null, website: null, address: null, industry: null, site_health: 'no_website', score: 95, status: 'New', search_query: null, deleted_at: null, deal_id: null };
  db.tables.presence_prospects.push(p2);
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.pathname.endsWith('/presence_contacts') && (init.method || 'GET') === 'POST') return new Response(JSON.stringify({ message: 'boom' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    return real(url, init);
  };
  const dealsBefore = (db.tables.presence_deals || []).length;
  const r = await res(await PX.handleProspectConvert(req('POST', `/sales/prospects/${p2.id}/convert`), site, owner, p2.id, cors));
  globalThis.fetch = real;
  ok('item 119: no contact, no deal — and the page is told plainly', r.status === 502 && /contact didn’t save/.test(r.body.message) && (db.tables.presence_deals || []).length === dealsBefore);
}

// ═══ the draft is words, never a send ═══
{
  const p = kept().find((x) => x.business_name === 'Fresh Fades Barbershop');
  outside = [];
  const r = await res(await PX.handleProspectDraft(req('POST', `/sales/prospects/${p.id}/draft`), site, owner, p.id, cors));
  ok('the draft names the business, the studio, and the gap', r.status === 200 && /Fresh Fades Barbershop/.test(r.body.data.body) && /Davis Digital Studio/.test(r.body.data.body) && /couldn’t find a website/.test(r.body.data.body));
  ok('the draft says it was not sent, and nothing left the building', r.body.data.sent === false && outside.length === 0);
  // item 119: Google's addresses end with the country; the draft's town is the town all the same
  db.tables.presence_prospects.find((x) => x.id === p.id).address = '2 Main St, Burbank, CA 91501, USA';
  const g = await res(await PX.handleProspectDraft(req('POST', `/sales/prospects/${p.id}/draft`), site, owner, p.id, cors));
  ok('item 119: the draft reads “here in Burbank” from Google’s address', /here in Burbank\./.test(g.body.data.body), g.body.data.body);
  const src = Deno.readTextFileSync(new URL('../../supabase/functions/presence/routes/prospects.ts', import.meta.url));
  ok('tripwire: the prospects routes import no email sender at all', !/sendEmail|resend|broadcast/i.test(src.replace(/\/\/[^\n]*/g, '')));
}

// ═══ export: one CSV, warmest first ═══
{
  const r = await PX.handleProspectsExport(site, owner, cors);
  const text = await r.text();
  ok('the export is a CSV named prospects.csv', r.status === 200 && /text\/csv/.test(r.headers.get('Content-Type')) && /prospects\.csv/.test(r.headers.get('Content-Disposition')));
  ok('it carries the header and the kept rows, with plain words for their site', /Business,Phone,Website/.test(text) && /Fresh Fades Barbershop/.test(text) && /No website/.test(text) && !/Old Diner/.test(text));
}

// ═══ before APPLY-0148 the page says so, plainly ═══
{
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.pathname.includes('presence_prospects')) return new Response(JSON.stringify({ code: 'PGRST205', message: 'Could not find the table' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    return real(url, init);
  };
  const r = await res(await PX.handleProspects(req('GET', '/sales/prospects'), site, owner, cors));
  ok('before the database update, the list answers 503 with a plain sentence', r.status === 503 && /one-time database update/.test(r.body.message));
  globalThis.fetch = real;
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) Deno.exit(1);
