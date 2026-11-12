// ── Business details: a short description and a second location (builder list item 127) ──
//   deno run --allow-read --allow-env --allow-net tests/presence/business_details_127_test.mjs
// The 150-character line AI tools and directories quote, and a second place with its own
// address, phone and hours. Part A: the pure rules. Part B: the snapshot (unchanged for a
// business with neither). Part C: the routes save and step down before APPLY-0182. Part D:
// the publish checks, the changes list, a restore, the migration and its pack. Part E: the
// live site in all eight templates: the footer, the Contact page, what Google and a link
// preview read, and hostile words.
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);

Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');

const L = await import('../../supabase/functions/presence/lib/second_location.ts');
const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day, i) => ({ day, closed: i === 0, intervals: i === 0 ? [] : [{ open: '17:00', close: '22:00' }] }));
const MAIN = { address_line1: '12 Main St', address_line2: '', city: 'Burbank', region: 'CA', postal_code: '91502', country: 'US', phone: '', timezone: 'America/Los_Angeles', hours: WEEK, holiday_exceptions: [], temporarily_closed: false, temporarily_closed_note: '' };

// ═══ A. the pure rules ═══
{
  ok('A1: a second location needs a street and a town', L.normalizeSecondLocation({ label: 'Glendale', city: 'Glendale' }) === null && L.normalizeSecondLocation({ address_line1: '410 Brand Blvd' }) === null && L.normalizeSecondLocation(null) === null && L.normalizeSecondLocation([1]) === null);
  const s = L.normalizeSecondLocation({ label: '  Glendale  kitchen ', address_line1: '410 Brand Blvd', city: 'Glendale', region: 'CA', postal_code: '91203', phone: '(818) 555-0199', extra: 'dropped' });
  eq('A2: its fields, trimmed; the same hours as the main location unless asked otherwise', s, { label: 'Glendale kitchen', address_line1: '410 Brand Blvd', address_line2: '', city: 'Glendale', region: 'CA', postal_code: '91203', phone: '(818) 555-0199', same_hours: true, hours: [] });
  const own = L.normalizeSecondLocation({ address_line1: '1 A St', city: 'Pasadena', same_hours: false, hours: [{ day: 'mon', closed: false, intervals: [{ open: '09:00', close: '17:00' }, { open: 'nope', close: '1' }] }, { day: 'xyz' }, { day: 'sat', closed: true, intervals: [{ open: '09:00', close: '12:00' }] }] });
  ok('A3: its own week is always seven days; a bad range and a closed day’s ranges are dropped', own.hours.length === 7 && own.hours[0].intervals.length === 1 && own.hours[5].closed === true && own.hours[5].intervals.length === 0 && own.hours[1].closed === true);
  ok('A4: names and lines are capped and lose control characters', L.normalizeSecondLocation({ label: 'x'.repeat(200) + '\u0000', address_line1: 'A\u0007 St', city: 'B' }).label.length === 60 && L.normalizeSecondLocation({ address_line1: 'A\u0007 St', city: 'B' }).address_line1 === 'A St');
  const c = L.secondLocationContent({ label: 'Glendale', address_line1: '410 Brand Blvd', city: 'Glendale', region: 'CA', postal_code: '91203' }, MAIN);
  ok('A5: in the snapshot it takes the main location’s clock and country, and with the same hours, its week', c.timezone === 'America/Los_Angeles' && c.country === 'US' && c.hours === WEEK && c.same_hours === true && c.label === 'Glendale');
  ok('A6: no main location, no second one', L.secondLocationContent({ address_line1: 'x', city: 'y' }, null) === null);
  eq('A7: one line for an address', [L.addressLine(MAIN), L.addressLine({ address_line1: '1 A St', city: 'Glendale' }), L.addressLine(null)], ['12 Main St, Burbank, CA 91502', '1 A St, Glendale', '']);
  const { validateIdentity } = await import('../../supabase/functions/presence/lib/validate.ts');
  ok('A8: a short description of 150 characters saves; 151 is refused', validateIdentity({ short_description: 'x'.repeat(150) }).ok && !validateIdentity({ short_description: 'x'.repeat(151) }).ok);
}

// ═══ B. the snapshot ═══
{
  const { buildSnapshot } = await import('../../supabase/functions/presence/lib/serializer.ts');
  const manifest = JSON.parse(read('supabase/functions/presence/templates/aurora/1.0.0/manifest.json'));
  const rows = (ident, loc) => ({ presence_identity: [{ business_name: 'Marlow’s Kitchen', description: 'A kitchen.', ...ident }], presence_locations: [{ ...MAIN, ...loc }], presence_offerings: [], presence_testimonials: [], presence_faqs: [], presence_posts: [], presence_media: [], presence_redirects: [], presence_settings: [{}], presence_dev_customizations: [], presence_reviews: [], presence_content_library: [] });
  const opts = { templateSlug: 'aurora', templateVersion: '1.0.0', now: '2026-11-12T00:00:00.000Z' };
  const plain = buildSnapshot(rows({}, {}), manifest, opts).snapshot.content;
  ok('B1: a business with neither is unchanged: no new key, one location', !('short_description' in plain.identity) && plain.locations.length === 1);
  const both = buildSnapshot(rows({ short_description: '  A neighbourhood Italian kitchen in Burbank.  ' }, { second_location: { label: 'Glendale', address_line1: '410 Brand Blvd', city: 'Glendale', region: 'CA', postal_code: '91203', phone: '(818) 555-0199' } }), manifest, opts).snapshot.content;
  ok('B2: the short description arrives trimmed, after the fields that were there', both.identity.short_description === 'A neighbourhood Italian kitchen in Burbank.' && Object.keys(both.identity).at(-1) === 'short_description');
  ok('B3: the second location is locations[1]; locations[0] is the main one, untouched', both.locations.length === 2 && both.locations[0].city === 'Burbank' && both.locations[1].city === 'Glendale' && both.locations[1].label === 'Glendale' && both.locations[1].phone === '(818) 555-0199');
  const junk = buildSnapshot(rows({}, { second_location: { label: 'Nowhere' } }), manifest, opts).snapshot.content;
  ok('B4: a second location with no street stays off', junk.locations.length === 1);
  const { validateSnapshot } = await import('../../supabase/functions/presence/lib/manifest_validate.ts');
  const snap = (content) => ({ content, content_contract_version: 1, template_slug: 'aurora', template_version: '1.0.0', created_at: opts.now });
  const blockers = (content) => validateSnapshot(snap(content), manifest).blockers.map((b) => b.field);
  ok('B5: every template takes two locations', ['atelier', 'aurora', 'business-classic', 'editorial', 'harbor', 'meadow', 'restaurant-classic', 'slate'].every((t) => JSON.parse(read(`supabase/functions/presence/templates/${t}/1.0.0/manifest.json`)).entities.locations.max === 2));
  ok('B6: a site with two locations can publish; three can’t', !blockers(both).includes('locations') && blockers({ ...both, locations: [...both.locations, both.locations[1]] }).includes('locations'));
}

// ═══ C. the routes ═══
{
  const { handleLocation } = await import('../../supabase/functions/presence/routes/content.ts');
  const { handleGetIdentity, handlePutIdentity } = await import('../../supabase/functions/presence/routes/identity.ts');
  const site = { id: '00000000-0000-4000-8000-000000000001', client_id: '00000000-0000-4000-8000-000000000002', status: 'live' };
  const principal = { kind: 'owner', userId: 'u1', tenantId: null, role: null, email: 'o@example.com', jwt: 'j', requestId: 'r' };
  let dbCalls = [], before0182 = false;
  const db = async (path, init = {}) => {
    dbCalls.push({ path, method: (init.method || 'GET').toUpperCase(), body: init.body ? JSON.parse(init.body) : null });
    if (before0182 && (path.includes('short_description') || path.includes('second_location'))) return { ok: false, status: 400, json: { code: '42703', message: 'column does not exist' } };
    return { ok: true, status: 200, json: [{ site_id: site.id, ...(init.body ? JSON.parse(init.body) : {}) }] };
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  const put = async (handler, body) => { dbCalls = []; const r = await handler(new Request('https://x.example/l', { method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }), db, site, principal, {}); return { status: r.status, body: await r.json() }; };
  let r = await put(handleLocation, { second_location: { label: 'Glendale', address_line1: '410 Brand Blvd', city: 'Glendale', same_hours: false, hours: [{ day: 'tue', closed: false, intervals: [{ open: '08:00', close: '15:00' }] }], junk: true } });
  const saved = dbCalls.find((c) => c.method === 'POST')?.body?.second_location;
  ok('C1: a second location is saved made safe, its own week of seven days', r.status === 200 && saved.label === 'Glendale' && saved.hours.length === 7 && !('junk' in saved), JSON.stringify(r.body).slice(0, 200));
  r = await put(handleLocation, { second_location: null });
  ok('C2: null takes it off', r.status === 200 && dbCalls.find((c) => c.method === 'POST')?.body?.second_location === null);
  r = await put(handleLocation, { second_location: { label: 'Only a name' } });
  ok('C3: one with no street or town is no second location', r.status === 200 && dbCalls.find((c) => c.method === 'POST')?.body?.second_location === null);
  before0182 = true;
  dbCalls = [];
  const g = await handleGetIdentity(db, site, {});
  ok('C4: before APPLY-0182 Business details is read again without the short description', g.status === 200 && dbCalls.length === 2 && !dbCalls[1].path.includes('short_description'));
  r = await put(handlePutIdentity, { tagline: 'Seasonal plates' });
  ok('C5: and a save that doesn’t set it still lands', r.status === 200 && dbCalls.length === 2);
  r = await put(handleLocation, { phone: '(818) 555-0100' });
  ok('C6: the location reads and saves without the second location before the pack', r.status === 200 && dbCalls.some((c) => c.method === 'POST' && !c.path.includes('second_location')));
  before0182 = false;
  globalThis.fetch = realFetch;
}

// ═══ D. the changes list, a restore, the migration ═══
{
  const { describeChanges } = await import('../../supabase/functions/presence/lib/diff.ts');
  const base = { identity: { business_name: 'M', description: 'D', phone: '', email: '' }, locations: [MAIN], settings: {}, offerings: [], testimonials: [], faqs: [], posts: [], redirects: [] };
  const second = { ...MAIN, address_line1: '410 Brand Blvd', city: 'Glendale', label: 'Glendale', same_hours: true };
  const said = (d, l) => describeChanges(d, l).changes.map((c) => c.sentence);
  ok('D1: a new short description is named', said({ ...base, identity: { ...base.identity, short_description: 'One line.' } }, base).some((s) => /short description/.test(s)));
  ok('D2: a second location going up, changing and coming off are each named',
    said({ ...base, locations: [MAIN, second] }, base).some((s) => /second location in Glendale goes up/.test(s))
    && said({ ...base, locations: [MAIN, { ...second, phone: '1' }] }, { ...base, locations: [MAIN, second] }).some((s) => /second location is updated/.test(s))
    && said(base, { ...base, locations: [MAIN, second] }).some((s) => /second location comes off/.test(s)));
  ok('D3: nothing changed, nothing said', said({ ...base, locations: [MAIN, second] }, { ...base, locations: [MAIN, second] }).length === 0);
  const dw = read('supabase/functions/presence/lib/draft_writer.ts');
  ok('D4: a restore brings the short description back, and steps down before 0182', /short_description: i\.short_description \|\| ''/.test(dw) && /const \{ short_description: _s, \.\.\.old \} = identBody;/.test(dw));
  ok('D5: …and the second location, or takes it off when the version had none', /const l2 = c\.locations\?\.\[1\];/.test(dw) && /second_location: l2 \? \{/.test(dw) && /const \{ second_location: _s, \.\.\.old \} = fields;/.test(dw));
  ok('D6: the llms.txt draft leads with the short description', /description: ident\.short_description \|\| ident\.seo_description/.test(read('supabase/functions/presence/routes/search_tab.ts')));
  for (const [name, sql] of [['migration', read('supabase/migrations/0182_short_description_second_location.sql')], ['pack', read('docs/presence/APPLY-0182-prod.sql')]]) {
    ok(`D7 ${name}: an empty short description capped at 150, re-runnable`, /add column if not exists short_description text not null default ''/.test(sql) && /drop constraint if exists presence_identity_short_description_len;/.test(sql) && /check \(char_length\(short_description\) <= 150\)/.test(sql));
    ok(`D8 ${name}: a second location, none by default`, /alter table public\.presence_locations\s+add column if not exists second_location jsonb;/.test(sql));
  }
}

// ═══ E. the live site, all eight templates ═══
{
  const { renderSnapshot } = await import('../../supabase/functions/presence/lib/render.ts');
  const { TEMPLATES, fullFixture } = await import('./full_fixture.mjs');
  const SITE = { baseUrl: 'https://marlows.example', brand: { credit: 'Site by Davis Digital Studio' } };
  const SHORT = 'What we do, where we do it, and what we are known for, in one line.';
  const lds = (html) => [...String(html).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const meta = (html, attr, name) => (String(html).match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`)) || [])[1];
  for (const slug of TEMPLATES) {
    const fx = fullFixture(slug);
    const files = await renderSnapshot(fx, SITE);
    const pages = Object.entries(files).filter(([k, v]) => k.endsWith('.html') && /<footer/.test(String(v)) && !k.startsWith('_plain'));
    const noPlace = pages.filter(([, v]) => !String(v).includes('<address class="place2"><strong>Glendale</strong><br>410 Brand Blvd<br>Glendale, ')).map(([k]) => k);
    ok(`E1 [${slug}]: every page's footer names the second place under the main address`, pages.length > 3 && noPlace.length === 0, noPlace.slice(0, 3).join(', '));
    const contact = String(files['contact/index.html']);
    ok(`E2 [${slug}]: the Contact page gives it a card with its own Get directions link and its own week`,
      /<div class="card place2"><h2>Glendale<\/h2><address>410 Brand Blvd<br>Glendale, /.test(contact) && /maps\/search\/\?api=1&amp;query=[^"]*410%20Brand%20Blvd/.test(contact)
      && /<div class="card place2">[\s\S]*?<table class="hours"/.test(contact));
    const home = String(files['index.html']);
    const placeLd = (html) => lds(html).find((j) => j.parentOrganization && j.address?.streetAddress === '410 Brand Blvd');
    const p2 = placeLd(home);
    ok(`E3 [${slug}]: Google reads the second place on the home and Contact pages: its name, address, phone and hours, part of the business`,
      !!p2 && !!placeLd(contact) && p2.name.endsWith('(Glendale)') && p2.telephone === '(555) 010-0199' && p2.address.addressLocality === 'Glendale'
      && Array.isArray(p2.openingHoursSpecification) && !p2.openingHoursSpecification.some((h) => h.dayOfWeek === 'Monday') && p2['@type'] === lds(home)[0]['@type']);
    const seo = fx.content.identity.seo_description;
    ok(`E4 [${slug}]: a link preview carries the short description, and Google does when there's no search description`,
      meta(home, 'property', 'og:description') === SHORT && meta(home, 'name', 'description') === (seo || SHORT) && lds(home)[0].description === SHORT);
    const same = fullFixture(slug); same.content.locations[1] = { ...same.content.locations[1], same_hours: true, hours: same.content.locations[0].hours };
    const sameContact = String((await renderSnapshot(same, SITE))['contact/index.html']);
    ok(`E5 [${slug}]: with the same hours it says so instead of drawing the week twice`,
      /<div class="card place2">[\s\S]*?<p class="place2-same">Open the same hours as our [^<]+ location\.<\/p><\/div>/.test(sameContact) && !/<div class="card place2">(?:(?!<\/div>)[\s\S])*<table/.test(sameContact));
    const none = fullFixture(slug); none.content.locations = none.content.locations.slice(0, 1); delete none.content.identity.short_description;
    const plain = await renderSnapshot(none, SITE);
    const leaks = Object.entries(plain).filter(([k, v]) => k.endsWith('.html') && /class="(?:card )?place2"|parentOrganization/.test(String(v))).map(([k]) => k);
    ok(`E6 [${slug}]: a business with one place and no short description draws neither`, leaks.length === 0, leaks.slice(0, 3).join(', '));
    const HOSTILE = ['<script>alert(1)</script>', '" onmouseover="alert(1)" x="', 'javascript:alert(1)', '<img src=x onerror=alert(1)>'];
    const bad = fullFixture(slug);
    bad.content.identity.short_description = HOSTILE[1];
    bad.content.locations[1] = { ...bad.content.locations[1], label: HOSTILE[0], address_line1: HOSTILE[2], city: HOSTILE[3], region: HOSTILE[1], postal_code: HOSTILE[0], phone: HOSTILE[2] };
    const hr = await renderSnapshot(bad, SITE);
    const live = Object.entries(hr).filter(([k, v]) => k.endsWith('.html') && (/<script>alert\(1\)|<img src=x onerror| onmouseover="alert\(1\)"/.test(String(v)) || /(?:href|src)\s*=\s*"(?:javascript|data):/i.test(String(v)))).map(([k]) => k);
    ok(`E7 [${slug}]: hostile words in the second place and the short description stay words`, live.length === 0 && String(hr['contact/index.html']).includes('&lt;script&gt;alert(1)&lt;/script&gt;'), live.slice(0, 3).join(', '));
  }
}

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
if (failed) Deno.exit(1);
