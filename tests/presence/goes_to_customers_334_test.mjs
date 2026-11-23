// ── "We go to our customers": a business with no shopfront (builder list item 334) ──
//   deno run --allow-read --allow-env --allow-net tests/presence/goes_to_customers_334_test.mjs
// A plumber, a mobile groomer or a cleaner could publish only by typing a street address,
// which then showed in the footer with "Get directions". With the switch on, the places it
// serves show where the address was and publishing asks for those instead. Part A: the
// publish rules. Part B: the snapshot (unchanged for everyone else). Part C: the routes save
// it and step down before APPLY-0255; /site says when the switch can show. Part D: the live
// site in all eight templates. Part E: the phone bar, the privacy page, the health checks
// and the writer. Part F: the migration, the pack and the editor's switch.
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');

const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day, i) => ({ day, closed: i === 6, intervals: i === 6 ? [] : [{ open: '07:00', close: '19:00' }] }));
const MAIN = { address_line1: '12 Main St', address_line2: '', city: 'Burbank', region: 'CA', postal_code: '91502', country: 'US', phone: '', timezone: 'America/Los_Angeles', hours: WEEK, holiday_exceptions: [], temporarily_closed: false, temporarily_closed_note: '' };
const AREA = 'Serving Burbank, Glendale and Pasadena';

// ═══ A. the publish rules ═══
const { validateSnapshot } = await import('../../supabase/functions/presence/lib/manifest_validate.ts');
const manifest = JSON.parse(read('supabase/functions/presence/templates/harbor/1.0.0/manifest.json'));
const snap = (content) => ({ content, content_contract_version: manifest.content_contract_version, template_slug: 'harbor', template_version: '1.0.0', created_at: '2026-11-22T00:00:00.000Z' });
const base = (ident, loc) => ({ identity: { business_name: 'Copper Line Plumbing', description: 'Plumbers.', phone: '(818) 555-0199', email: '', ...ident }, locations: [{ ...MAIN, ...loc }], settings: {}, offerings: [], testimonials: [], faqs: [], posts: [], redirects: [] });
const fields = (content) => validateSnapshot(snap(content), manifest).blockers.map((b) => b.field);
{
  const noStreet = { address_line1: '', city: '', region: '', postal_code: '' };
  const before = fields(base({}, noStreet));
  ok('A1: with the switch off nothing changes: no street, city, state or ZIP still blocks', ['location.address_line1', 'location.city', 'location.region', 'location.postal_code'].every((f) => before.includes(f)));
  const on = fields(base({ service_area: AREA }, { ...noStreet, goes_to_customers: true }));
  ok('A2: with it on, no street, city, state or ZIP is asked for', !on.some((f) => /^location\.(address_line1|city|region|postal_code)$/.test(f)), on.join(', '));
  ok('A3: …and a site with its places named can publish', validateSnapshot(snap(base({ service_area: AREA }, { ...noStreet, goes_to_customers: true })), manifest).ok);
  const r = validateSnapshot(snap(base({ service_area: '  ' }, { ...noStreet, goes_to_customers: true })), manifest);
  const b = r.blockers.find((x) => x.field === 'identity.service_area');
  ok('A4: with it on, the places it serves are asked for instead, in plain words', !r.ok && !!b && /Say where you work/.test(b.message) && !/—/.test(b.message));
  ok('A5: the time zone and all seven days are still asked for', fields(base({ service_area: AREA }, { ...noStreet, goes_to_customers: true, timezone: '', hours: WEEK.slice(0, 5) })).filter((f) => f === 'location.timezone' || f === 'location.hours').length === 2);
  ok('A6: an address already typed is no problem with the switch on', validateSnapshot(snap(base({ service_area: AREA }, { goes_to_customers: true })), manifest).ok);
}

// ═══ B. the snapshot ═══
{
  const { buildSnapshot } = await import('../../supabase/functions/presence/lib/serializer.ts');
  const m = JSON.parse(read('supabase/functions/presence/templates/aurora/1.0.0/manifest.json'));
  const rows = (loc) => ({ presence_identity: [{ business_name: 'Copper Line', description: 'Plumbers.', service_area: AREA }], presence_locations: [{ ...MAIN, ...loc }], presence_offerings: [], presence_testimonials: [], presence_faqs: [], presence_posts: [], presence_media: [], presence_redirects: [], presence_settings: [{}], presence_dev_customizations: [], presence_reviews: [], presence_content_library: [] });
  const opts = { templateSlug: 'aurora', templateVersion: '1.0.0', now: '2026-11-22T00:00:00.000Z' };
  const plain = buildSnapshot(rows({}), m, opts).snapshot.content.locations[0];
  const off = buildSnapshot(rows({ goes_to_customers: false }), m, opts).snapshot.content.locations[0];
  const on = buildSnapshot(rows({ goes_to_customers: true }), m, opts).snapshot.content.locations[0];
  ok('B1: a business with a shopfront is unchanged: before 0255 and with the switch off, no new key', !('goes_to_customers' in plain) && !('goes_to_customers' in off) && JSON.stringify(plain) === JSON.stringify(off));
  ok('B2: with it on, the main location says so, last, and keeps its address unshown', on.goes_to_customers === true && Object.keys(on).at(-1) === 'goes_to_customers' && on.address_line1 === '12 Main St');
  ok('B3: anything but true counts as off', !('goes_to_customers' in buildSnapshot(rows({ goes_to_customers: 'yes' }), m, opts).snapshot.content.locations[0]));
}

// ═══ C. the routes ═══
{
  const { handleLocation } = await import('../../supabase/functions/presence/routes/content.ts');
  const { handleGetSite } = await import('../../supabase/functions/presence/routes/site.ts');
  const site = { id: '00000000-0000-4000-8000-000000000001', client_id: '00000000-0000-4000-8000-000000000002', status: 'draft', template_slug: 'harbor', template_version: '1.0.0', edition: 'presence' };
  const principal = { kind: 'owner', userId: 'u1', tenantId: null, role: null, email: 'o@example.com', jwt: 'j', requestId: 'r' };
  let calls = [], lacking = [];
  const db = async (path, init = {}) => {
    calls.push({ path, method: (init.method || 'GET').toUpperCase(), body: init.body ? JSON.parse(init.body) : null });
    if (lacking.some((col) => path.includes(col) || (init.body && init.body.includes(`"${col}"`)))) return { ok: false, status: 400, json: { code: '42703', message: 'column does not exist' }, text: '' };
    if (path.startsWith('presence_locations')) return { ok: true, status: 200, json: [{ site_id: site.id, ...MAIN, ...(init.body ? JSON.parse(init.body) : {}) }], text: '' };
    if (path.startsWith('presence_identity')) return { ok: true, status: 200, json: [{ business_name: 'Copper Line' }], text: '' };
    return { ok: true, status: 200, json: [], text: '' };
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json', 'Content-Range': '0-0/0' } });
  const put = async (body) => { calls = []; const r = await handleLocation(new Request('https://x.example/location', { method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }), db, site, principal, {}); return { status: r.status, body: await r.json() }; };
  let r = await put({ goes_to_customers: true });
  ok('C1: the switch saves as a yes or no on the location row', r.status === 200 && calls.find((c) => c.method === 'POST')?.body?.goes_to_customers === true, JSON.stringify(r.body).slice(0, 160));
  r = await put({ goes_to_customers: false });
  ok('C2: and switching it off saves false, the address back in view', r.status === 200 && calls.find((c) => c.method === 'POST')?.body?.goes_to_customers === false);
  calls = [];
  let g = await handleLocation(new Request('https://x.example/location'), db, site, principal, {});
  ok('C3: the location is read with it', g.status === 200 && calls[0].path.includes('goes_to_customers'));
  lacking = ['goes_to_customers'];
  calls = [];
  g = await handleLocation(new Request('https://x.example/location'), db, site, principal, {});
  ok('C4: before APPLY-0255 the location is read again without it, and still with the second location', g.status === 200 && calls.length === 2 && !calls[1].path.includes('goes_to_customers') && calls[1].path.includes('second_location'));
  r = await put({ city: 'Glendale' });
  ok('C5: …and a save that doesn’t touch it still lands', r.status === 200);
  const siteRead = async () => { calls = []; const res = await handleGetSite(db, site, {}); return (await res.json()).data; };
  lacking = [];
  let d = await siteRead();
  ok('C6: /site reads the location with its second place and the switch, and says it can save both', d.location_fields.join() === 'second_location,goes_to_customers' && calls.some((c) => c.path.startsWith('presence_locations') && c.path.includes('second_location,goes_to_customers')));
  lacking = ['goes_to_customers'];
  d = await siteRead();
  ok('C7: before APPLY-0255 /site steps down and says only the second place can save (the switch stays hidden)', d.location_fields.join() === 'second_location' && d.location?.city === 'Burbank');
  lacking = ['goes_to_customers', 'second_location'];
  d = await siteRead();
  ok('C8: before 0182 too, it reads the first columns as it always did', d.location_fields.length === 0 && d.location?.address_line1 === '12 Main St');
  lacking = [];
  globalThis.fetch = realFetch;
}

// ═══ D. the live site, all eight templates ═══
{
  const { renderSnapshot } = await import('../../supabase/functions/presence/lib/render.ts');
  const { TEMPLATES, fullFixture } = await import('./full_fixture.mjs');
  const SITE = { baseUrl: 'https://copperline.example', brand: { credit: 'Site by Davis Digital Studio' } };
  const lds = (html) => [...String(html).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  for (const slug of TEMPLATES) {
    const plainFx = fullFixture(slug);
    const street = plainFx.content.locations[0].address_line1;
    const fx = fullFixture(slug);
    fx.content.identity = { ...fx.content.identity, service_area: AREA };
    fx.content.locations[0] = { ...fx.content.locations[0], goes_to_customers: true };
    const files = await renderSnapshot(fx, SITE);
    const pages = Object.entries(files).filter(([k, v]) => k.endsWith('.html') && /<footer/.test(String(v)) && !k.startsWith('_plain'));
    const withStreet = pages.filter(([, v]) => String(v).includes(street)).map(([k]) => k);
    ok(`D1 [${slug}]: the main street address is on no page`, pages.length > 3 && withStreet.length === 0, withStreet.slice(0, 3).join(', '));
    const mapsToMain = pages.filter(([, v]) => String(v).includes(encodeURIComponent(street))).map(([k]) => k);
    ok(`D2 [${slug}]: no page offers directions to it (the second place keeps its own)`, mapsToMain.length === 0 && String(files['contact/index.html']).includes('410%20Brand%20Blvd'), mapsToMain.join(', '));
    const noArea = pages.filter(([, v]) => !/<footer[\s\S]*<p class="area" data-pr="identity\.service_area"><strong>We come to you<\/strong><br>Serving Burbank, Glendale and Pasadena<\/p>/.test(String(v))).map(([k]) => k);
    ok(`D3 [${slug}]: every footer says “We come to you” and the places served`, noArea.length === 0, noArea.slice(0, 3).join(', '));
    const contact = String(files['contact/index.html']);
    const where = slug === 'restaurant-classic' ? 'Where to find us' : 'Where we work';
    ok(`D4 [${slug}]: the Contact page names the places under “${where}”, and its description says so`, contact.includes(`<p class="area" data-pr="identity.service_area"><strong>${where}</strong><br>${AREA}</p>`) && /<meta name="description" content="Phone, hours and the places [^"]+ serves\.">/.test(contact));
    const home = String(files['index.html']);
    const strip = (home.match(/<div class="strip">[\s\S]*?<\/div><\/div>/) || [''])[0];
    ok(`D5 [${slug}]: the strip under the opening keeps the phone, without an address or Get directions`, !!strip && !/Get directions/.test(strip) && !strip.includes(street) && /tel:/.test(strip));
    const biz = lds(home).find((j) => j.openingHoursSpecification && !j.parentOrganization);
    ok(`D6 [${slug}]: Google reads no street or ZIP, just the town and state`, !!biz && !biz.address?.streetAddress && !biz.address?.postalCode && biz.address?.addressLocality === fx.content.locations[0].city);
    if (slug !== 'restaurant-classic') ok(`D7 [${slug}]: …and the places served`, biz.areaServed === AREA);
    const plain = await renderSnapshot(plainFx, SITE);
    ok(`D8 [${slug}]: with the switch off the site is drawn exactly as before`, JSON.stringify(Object.keys(plain)) === JSON.stringify(Object.keys(await renderSnapshot(fullFixture(slug), SITE))) && String(plain['index.html']).includes(street) && !String(plain['index.html']).includes('class="area"'));
  }
  // hostile places: the area is escaped wherever it's drawn
  const fx = fullFixture('harbor');
  fx.content.identity = { ...fx.content.identity, service_area: '<img src=x onerror=alert(1)> & "Burbank"' };
  fx.content.locations[0] = { ...fx.content.locations[0], goes_to_customers: true };
  const files = await renderSnapshot(fx, SITE);
  ok('D9: hostile words in the area are drawn as words', !Object.values(files).some((v) => typeof v === 'string' && v.includes('<img src=x')) && String(files['index.html']).includes('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;Burbank&quot;'));
}

// ═══ E. the phone bar, the privacy page, the health checks, the writer ═══
{
  const { phoneBarButtons } = await import('../../supabase/functions/presence/lib/phone_bar.ts');
  const keys = (loc) => phoneBarButtons({ identity: { phone: '(818) 555-0199', email: 'hi@example.com' }, locations: [{ ...MAIN, ...loc }] }).map((b) => b.key).join();
  ok('E1: the phone bar offers Directions to a shopfront, and none to a business that comes to you', keys({}) === 'call,directions,hours,email' && keys({ goes_to_customers: true }) === 'call,hours,email');
  const { privacyBody } = await import('../../supabase/functions/presence/lib/legal_pages.ts');
  const priv = (loc) => privacyBody(base({ email: 'hi@example.com' }, loc), 'November 22, 2026', { formEndpoint: '', bookEndpoint: '' });
  ok('E2: the privacy page names the street only for a shopfront', priv({}).includes('12 Main St') && !priv({ goes_to_customers: true }).includes('12 Main St'));
  // the health checks, run on the real providers: a business that comes to you is asked for its
  // places, never a street, and a home page that rightly shows no street isn't marked down for it
  const { PROVIDERS, runProviders } = await import('../../supabase/functions/presence/evidence/providers.ts');
  const { OPTIMIZATION_PROVIDERS } = await import('../../supabase/functions/presence/optimization/providers.ts');
  const draftOf = (ident, loc) => ({ ...base(ident, loc), faqs: [] });
  const input = (draft, html) => ({ site: { id: '00000000-0000-4000-8000-000000000001', status: 'live', template_slug: 'harbor', template_version: '1.0.0', client_id: 'c1' }, now: '2026-11-22T12:00:00.000Z', draft, live: draft,
    lastLiveAt: null, everPublished: true, fileMap: {}, fileMapFrom: 'draft', pages: [{ path: '/', html }], mediaRows: [], usedMediaIds: [], lastOfferingChangeAt: null, lastLocationChangeAt: null,
    oldestUnpublishedChangeAt: null, unpublishedChangeEvents: 0, liveFetch: null, opt: null, connected: [], connectedPrior: [], industry: 'plumber', external: false });
  const run = (providers, names, draft, html) => runProviders(input(draft, html), providers.filter((p) => names.includes(p.name))).items;
  const noStreet = { address_line1: '', city: '', postal_code: '' };
  const asked = (items) => items.filter((x) => x.type === 'business_info.address_incomplete').map((x) => x.resource).join();
  ok('E3: the details check asks a shopfront for its street, town and ZIP, and a business that comes to you for its places instead',
    asked(run(PROVIDERS, ['business_info'], draftOf({}, noStreet), '<p>hi</p>')) === 'address_line1,city,postal_code'
    && asked(run(PROVIDERS, ['business_info'], draftOf({ service_area: '' }, { ...noStreet, goes_to_customers: true }), '<p>hi</p>')) === 'service_area'
    && asked(run(PROVIDERS, ['business_info'], draftOf({ service_area: AREA }, { ...noStreet, goes_to_customers: true }), '<p>hi</p>')) === '');
  const home = '<a href="tel:+18185550199">(818) 555-0199</a> Copper Line Plumbing 7am';
  const facts = (items, type) => items.filter((x) => x.type === type).map((x) => String(x.facts?.missing || '')).join();
  ok('E4: a home page that rightly shows no street isn’t marked down for it, on the map signal or the facts AI tools quote',
    /street address/.test(facts(run(PROVIDERS, ['local_presence'], draftOf({}, {}), home), 'local_presence.map_signal_missing'))
    && !/street address/.test(facts(run(PROVIDERS, ['local_presence'], draftOf({}, { goes_to_customers: true }), home), 'local_presence.map_signal_missing'))
    && /address/.test(facts(run(OPTIMIZATION_PROVIDERS, ['aeo'], draftOf({}, {}), home), 'aeo.citation_facts_incomplete'))
    && !/address/.test(facts(run(OPTIMIZATION_PROVIDERS, ['aeo'], draftOf({}, { goes_to_customers: true }), home), 'aeo.citation_facts_incomplete')));
  const { TEMPLATES } = await import('../../supabase/functions/presence/moments/rules.ts');
  const missing = TEMPLATES.find((t) => t.key === 'missing_basics').counted([{ type: 'business_info.address_incomplete', resource: 'service_area', facts: {} }]);
  ok('E5: the nudge says “Add the places you serve”', /Add the places you serve in Business details/.test(missing.summary));
  // the writer's facts and a booking email, read through a stand-in database
  const { buildFactSheet } = await import('../../supabase/functions/presence/writer/facts.ts');
  const { bookingBits } = await import('../../supabase/functions/presence/lib/booking_links.ts');
  const realFetch = globalThis.fetch;
  const withDb = async (loc, fn) => {
    globalThis.fetch = async (u) => {
      const url = String(u);
      const rows = url.includes('/presence_locations?') ? [{ ...MAIN, ...loc }] : url.includes('/presence_identity?') ? [{ business_name: 'Copper Line', phone: '(818) 555-0199', email: 'hi@example.com', service_area: AREA }] : [];
      return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json', 'Content-Range': '0-0/0' } });
    };
    try { return await fn(); } finally { globalThis.fetch = realFetch; }
  };
  const SID = '00000000-0000-4000-8000-000000000001';
  const sheet = (loc) => withDb(loc, () => buildFactSheet({ id: SID, client_id: 'c1', template_slug: 'harbor', template_version: '1.0.0' }));
  const [shop, mobile] = [await sheet({}), await sheet({ goes_to_customers: true })];
  ok('E6: the writer never writes the street of a business that comes to you', shop.address.startsWith('12 Main St') && mobile.address === '' && mobile.service_area === AREA && mobile.hours_text.length > 0);
  const [shopBits, mobileBits] = [await withDb({}, () => bookingBits(SID)), await withDb({ goes_to_customers: true }, () => bookingBits(SID))];
  ok('E7: nor does a booking email give one', shopBits.biz.location.startsWith('12 Main St') && mobileBits.biz.location === '' && mobileBits.biz.tel === '(818) 555-0199');
}

// ═══ F. the migration and its pack (their SQL is the contract) ═══
{
  for (const [name, sql] of [['migration', read('supabase/migrations/0255_goes_to_customers.sql')], ['pack', read('docs/presence/APPLY-0255-prod.sql')]]) {
    ok(`F1 ${name}: one yes-or-no column, off for every site that exists, re-runnable`, /alter table public\.presence_locations\s+add column if not exists goes_to_customers boolean not null default false;/.test(sql) && /drop column if exists goes_to_customers/.test(sql));
  }
}
// the editor's switch is driven in a browser: tests/e2e/goes-to-customers-334.spec.ts

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed) Deno.exit(1);
