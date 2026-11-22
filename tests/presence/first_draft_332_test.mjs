// ── + New site's first draft (builder list item 332) ─────────────────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/first_draft_332_test.mjs
// One optional step in + New site (three services, the town, a tone) runs the starter draft
// into the new site's private draft: Home, About, Services and Contact with real words, then
// a photo to open with (stock when the library is on, a stand-in for the kind until then).
// Part A: the answers and what the writer is asked. Part B: what the sheet is sent. Part C:
// the route, driven through the real handleAgency() against an in-memory PostgREST with a
// stand-in model reply: the refusals, "not switched on", and a whole draft with a stand-in
// picture and with stock photos. Part D: the stand-in pictures and the publish check.
import { installFakePostgrest } from './fake_pgrst.mjs';
const db = installFakePostgrest();
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);

const F = await import('../../supabase/functions/presence/agency/first_draft.ts');
const G = await import('../../supabase/functions/presence/lib/design_gallery.ts');
const SI = await import('../../supabase/functions/presence/lib/stand_in.ts');

// ═══ A. the answers, and what the writer is asked ═══
{
  eq('A1: up to three services, trimmed and capped; the town; a known tone',
    F.cleanAsk({ services: ['  Drain   cleaning ', '', 'Water heaters', 'Leaks', 'Fourth'], town: ' Burbank, CA ', tone: 'calm' }),
    { services: ['Drain cleaning', 'Water heaters', 'Leaks'], town: 'Burbank, CA', tone: 'calm' });
  ok('A2: an unknown tone is friendly; control characters go', F.cleanAsk({ services: ['A\u0007B'], tone: 'shouty' }).tone === 'friendly' && F.cleanAsk({ services: ['A\u0007B'] }).services[0] === 'A B');
  const none = F.cleanAsk({ services: ['  '], town: '' });
  ok('A3: with no service and no town there is nothing to write from, said plainly', none.error === 'nothing_to_draft' && /Add one thing they offer, or the town/.test(none.message) && !/—/.test(none.message));
  ok('A4: a town alone is enough, and so is one service', !('error' in F.cleanAsk({ town: 'Glendale' })) && !('error' in F.cleanAsk({ services: ['Color'] })));
  ok('A5: anything that isn’t an object asks for something to write from', 'error' in F.cleanAsk(null) && 'error' in F.cleanAsk('x') && 'error' in F.cleanAsk([1]));
  eq('A6: the kind in words, from the closer kind, the family or nothing', ['salon', 'plumber', 'restaurant', 'generic', 'nonsense', ''].map(F.kindWords), ['hair salon', 'plumber', 'restaurant', 'local business', 'local business', 'local business']);
  const req = F.starterRequest({ services: ['Drain cleaning', 'Water heaters'], town: 'Burbank, CA', tone: 'bold' }, 'plumber', 'Copper Line');
  ok('A7: the writer gets the services and the town as the owner’s facts, said verbatim', req.kind === 'starter_site' && JSON.stringify(req.starter) === JSON.stringify({ services: [{ name: 'Drain cleaning' }, { name: 'Water heaters' }], goals: 'Based in Burbank, CA.' }));
  ok('A8: one direction, in the tone’s words; Home, About, Services and Contact named; nothing beyond the facts', JSON.stringify(req.tones) === '["bold and confident"]' && /A plumber called Copper Line in Burbank, CA\./.test(req.instructions) && /Home, About, Services and Contact/.test(req.instructions) && /Say only what the facts say\./.test(req.instructions) && req.instructions.length <= 600);
  ok('A9: no town, no "in"', !/ in /.test(F.starterRequest({ services: ['Color'], town: '', tone: 'warm' }, 'hair salon', 'Linden').instructions.split('.')[0]));
}

// ═══ B. what the sheet is sent ═══
{
  const p = G.galleryPayload([{ slug: 'atelier', name: 'Atelier' }]);
  ok('B1: every kind but “Something else” brings three services to start from', p.kinds.every((k) => (k.family === 'other' ? k.services.length === 0 : k.services.length === 3)));
  eq('B2: a salon’s three', p.kinds.find((k) => k.key === 'salon').services, ['Haircuts and styling', 'Color', 'Treatments']);
  eq('B3: five tones, by name', p.tones, [{ key: 'friendly', label: 'Friendly' }, { key: 'professional', label: 'Professional' }, { key: 'warm', label: 'Warm' }, { key: 'bold', label: 'Bold' }, { key: 'calm', label: 'Calm' }]);
  ok('B4: no service name has an em-dash or a code word', p.kinds.flatMap((k) => k.services).every((s) => !/—|_/.test(s)));
}

// ═══ C. the route ═══
const { handleAgency } = await import('../../supabase/functions/presence/agency/routes.ts');
const AG = 'aaaaaaaa-0000-4000-8000-000000000001', ME = '11111111-1111-4111-8111-111111111111';
const SITE = 'd4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4', CL = 'c4000000-0000-4000-8000-000000000004', OTHER = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';
const APP = 'https://app.test';
Deno.env.set('APP_URL', APP);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
let modelAsked = null, standInAsked = 0, stockAsked = [], modelFails = false;
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const MODEL_OUT = {
  options: [{ label: 'Bold', tone: 'bold and confident', payload: {
    identity: { tagline: 'Plumbers who come to you', description: 'Copper Line fixes drains, water heaters and leaks in Burbank, CA.', story: 'We started Copper Line to give Burbank plumbing done right the first time.', seo_title: 'Copper Line Plumbing in Burbank, CA', seo_description: 'Drain cleaning, water heaters and leak repair in Burbank, CA.' },
    faqs: [{ question: 'Do you come to my home?', answer: 'Yes. We come to homes and businesses across Burbank, CA.' }, { question: 'What do you fix?', answer: 'Drains, water heaters and leaks.' }, { question: 'How do I book?', answer: 'Call us or send a message from the Contact page.' }],
    post: { title: 'Welcome to Copper Line', body_md: 'Our new website is here. Tell us what needs fixing.' },
    offerings_new: [{ name: 'Drain cleaning', category: 'Services', description: 'Clogged drains cleared.' }, { name: 'Water heaters', category: 'Services', description: 'Water heaters fixed and fitted.' }, { name: 'Leaks', category: 'Services', description: 'Leaks found and stopped.' }],
  } }],
  missing_facts: [], assumptions: [],
};
const pg = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u === 'https://api.anthropic.com/v1/messages') { modelAsked = JSON.parse(String(init.body)); if (modelFails) return reply({ error: { message: 'Overloaded' } }); return reply({ model: 'test-model', content: [{ type: 'text', text: JSON.stringify(MODEL_OUT) }], usage: { input_tokens: 10, output_tokens: 20 } }); }
  if (u.startsWith(APP + '/thumbs/stand-ins/')) { standInAsked++; return new Response(JPEG, { status: 200, headers: { 'Content-Type': 'image/jpeg' } }); }
  if (u.startsWith('https://api.pexels.com/v1/search')) { stockAsked.push(new URL(u).searchParams.get('query')); return reply({ photos: [{ id: 100 + stockAsked.length, width: 1600, height: 1000, alt: 'A plumber at work', photographer: 'Sam P', src: { large2x: 'https://images.pexels.com/x.jpg', medium: 'https://images.pexels.com/x-m.jpg', original: 'https://images.pexels.com/x-o.jpg' } }] }); }
  if (u.startsWith('https://api.pexels.com/v1/photos/')) return reply({ id: 1, width: 1600, height: 1000, alt: 'A plumber at work', src: { large2x: 'https://images.pexels.com/x.jpg', original: 'https://images.pexels.com/x-o.jpg' } });
  if (u.startsWith('https://images.pexels.com/')) return new Response(JPEG, { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
  if (u.includes('/storage/v1/object/upload/sign/')) return reply({ url: '/object/upload/sign/presence-media/x?token=t' });
  if (u.includes('/storage/v1/object/upload/')) return reply({ Key: 'ok' });
  // the database's own defaults the in-memory one doesn't know: a new proposal is "proposed"
  if (u.includes('/rest/v1/presence_ai_drafts') && String(init.method || '').toUpperCase() === 'POST') init = { ...init, body: JSON.stringify({ status: 'proposed', ...JSON.parse(String(init.body)) }) };
  return pg(url, init);
};
function seed() {
  db.tables.presence_agency_members = [{ id: ME, agency_id: AG, email: 'eric@studio.example', role: 'owner', status: 'active' }];
  db.tables.presence_agency_clients = [{ site_id: SITE, agency_id: AG, status: 'active' }];
  db.tables.presence_sites = [
    { id: SITE, client_id: CL, edition: 'presence', status: 'ready', last_published_at: null, custom_domain: null, netlify_site_id: null, template_slug: 'harbor', template_version: '1.0.0', created_at: '2026-11-22T00:00:00Z', updated_at: '2026-11-22T00:00:00Z' },
    { id: OTHER, client_id: 'c-x', edition: 'presence', status: 'live', template_slug: 'harbor', template_version: '1.0.0' },
  ];
  db.tables.presence_identity = [{ site_id: SITE, business_name: 'Copper Line', description: '', phone: '', email: '', tagline: '', story: '', service_area: '', booking_url: '', ordering_url: '', social: {}, seo_title: '', seo_description: '' }];
  db.tables.presence_locations = [];
  db.tables.presence_settings = [{ site_id: SITE, industry_key: 'plumber', category_order: [] }];
  for (const t of ['presence_offerings', 'presence_faqs', 'presence_posts', 'presence_testimonials', 'presence_media', 'presence_redirects', 'presence_dev_customizations', 'presence_reviews', 'presence_content_library', 'presence_ai_drafts', 'presence_change_events', 'presence_ai_usage', 'presence_entitlements', 'presence_brand_profile']) db.tables[t] = [];
  modelAsked = null; standInAsked = 0; stockAsked = [];
}
const member = (over = {}) => ({ agency_id: AG, member_id: ME, email: 'eric@studio.example', role: 'owner', agency_name: 'Bright Studio', seat_limit: 5, client_limit: 25, plan: 'agency', branding: {}, ...over });
const PRINCIPAL = { kind: 'client', userId: '99999999-0000-4000-8000-000000000009', email: 'eric@studio.example' };
async function call(body, { site = SITE, as = member() } = {}) {
  const route = `/agency/sites/${site}/first-draft`;
  const req = new Request('http://stub.local/functions/v1/presence' + route, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
  const res = await handleAgency(req, route, 'POST', as, PRINCIPAL, {});
  return { status: res.status, body: await res.json() };
}
const ASK = { services: ['Drain cleaning', 'Water heaters', 'Leaks'], town: 'Burbank, CA', tone: 'bold' };
{
  seed();
  Deno.env.delete('ANTHROPIC_KEY'); Deno.env.delete('PEXELS_API_KEY');
  let r = await call(ASK, { as: member({ role: 'readonly' }) });
  ok('C1: a role that can’t make sites can’t draft one', r.status === 403);
  r = await call(ASK, { site: OTHER });
  ok('C2: a site that isn’t the studio’s is refused, and nothing is read from it', r.status === 404 && modelAsked === null);
  r = await call({ services: [], town: '' });
  ok('C3: nothing to write from is said plainly, before any model is asked', r.status === 400 && r.body.error === 'nothing_to_draft' && modelAsked === null);
  r = await call(ASK);
  ok('C4: with drafting switched off it says so honestly, and nothing is written', r.status === 503 && /isn’t switched on right now\. The site is ready, with sample words/.test(r.body.message) && db.tables.presence_ai_drafts.length === 0 && db.tables.presence_identity[0].service_area === '');

  Deno.env.set('ANTHROPIC_KEY', 'test-key');
  r = await call(ASK);
  ok('C5: the whole draft: written, with three services, three questions and a stand-in picture', r.status === 200 && JSON.stringify(r.body.data) === JSON.stringify({ written: true, services: 3, questions: 3, photos: 'stand_in' }), JSON.stringify(r.body).slice(0, 300));
  const user = modelAsked && modelAsked.messages[0].content;
  ok('C6: the model was told the services verbatim, the town, the kind and the tone', !!user && user.includes('"name":"Drain cleaning"') && user.includes('GOALS: Based in Burbank, CA.') && user.includes('A plumber called Copper Line in Burbank, CA.') && user.includes('bold and confident'));
  const ident = db.tables.presence_identity[0];
  ok('C7: Home and About get the words, and the town is where the site works', ident.tagline === 'Plumbers who come to you' && /fixes drains/.test(ident.description) && /done right/.test(ident.story) && ident.service_area === 'Serving Burbank, CA');
  const offs = db.tables.presence_offerings.filter((o) => !o.deleted_at);
  ok('C8: the services are the studio’s three, named as typed', offs.map((o) => o.name).sort().join() === 'Drain cleaning,Leaks,Water heaters');
  ok('C9: three questions answered', db.tables.presence_faqs.filter((f) => !f.deleted_at).length === 3);
  const cover = db.tables.presence_settings[0].cover_media_id;
  const media = db.tables.presence_media.find((m) => m.id === cover);
  ok('C10: the opening photo is the plumber’s stand-in, fetched from the app, marked as one', standInAsked === 1 && !!media && media.alt_text === SI.STAND_IN_ALT && media.collection === 'stand-in' && media.metadata?.family === 'home');
  ok('C11: nothing is published: no publish row, the site still unpublished', !(db.tables.presence_publishes || []).length && db.tables.presence_sites[0].last_published_at === null);
  ok('C12: the change list says a draft was accepted and a photo added', db.tables.presence_change_events.some((e) => /Added a photo to open the home page with/.test(e.summary)));
  const draft = db.tables.presence_ai_drafts[0];
  ok('C13: the proposal is kept, marked accepted', draft && draft.status === 'accepted' && draft.kind === 'starter_site');

  // a town already written stays as written
  seed(); db.tables.presence_identity[0].service_area = 'Serving the east Valley';
  await call(ASK);
  ok('C14: a place the site already names is kept', db.tables.presence_identity[0].service_area === 'Serving the east Valley');

  // the stock library on: real photos for the opening and each service
  seed(); Deno.env.set('PEXELS_API_KEY', 'px-key');
  r = await call(ASK);
  const stockCover = db.tables.presence_media.find((m) => m.id === db.tables.presence_settings[0].cover_media_id);
  const withPhotos = db.tables.presence_offerings.filter((o) => o.media_id).length;
  ok('C15: with the stock library on, stock photos open the site and sit on each service', r.status === 200 && r.body.data.photos === 'stock' && standInAsked === 0 && stockCover?.collection === 'stock' && withPhotos === 3 && stockAsked[0] === 'plumber' && stockAsked.slice(1).every((q) => / plumber$/.test(q)), JSON.stringify({ body: r.body, stockAsked, withPhotos }));
  Deno.env.delete('PEXELS_API_KEY');

  // the model refuses or fails: the site keeps its sample words
  seed(); modelFails = true;
  r = await call(ASK);
  ok('C16: a draft that doesn’t come through says so; nothing changes and Try again is fair', r.status === 502 && /didn’t come through/.test(r.body.message) && db.tables.presence_identity[0].tagline === '' && db.tables.presence_offerings.length === 0);
  modelFails = false;
  Deno.env.delete('ANTHROPIC_KEY');
}

// ═══ D. the stand-in pictures and the publish check ═══
{
  ok('D1: a stand-in is known by its alt text', SI.isStandIn(SI.STAND_IN_ALT) && !SI.isStandIn('A plumber at work') && !SI.isStandIn(null));
  const families = Object.keys(G.STARTER_SERVICES);
  const missing = families.filter((f) => { try { const b = Deno.readFileSync(new URL(`../../${SI.standInPath(f)}`, import.meta.url)); return !(b[0] === 0xff && b[1] === 0xd8 && b.length < 200_000); } catch { return true; } });
  ok('D2: every kind of business has its stand-in picture in the app, a JPEG under 200 KB', families.length === 10 && missing.length === 0, missing.join(', '));
  const { validateSnapshot } = await import('../../supabase/functions/presence/lib/manifest_validate.ts');
  const manifest = JSON.parse(Deno.readTextFileSync(new URL('../../supabase/functions/presence/templates/harbor/1.0.0/manifest.json', import.meta.url)));
  const content = (alt) => ({ identity: { business_name: 'Copper Line', description: 'Plumbers.', phone: '1', email: '' }, locations: [], settings: { cover: { alt, variants: { w800: '/img/x-800.webp' } } }, offerings: [], testimonials: [], faqs: [], posts: [], redirects: [] });
  const warns = (alt) => validateSnapshot({ content: content(alt), content_contract_version: manifest.content_contract_version, template_slug: 'harbor', template_version: '1.0.0', created_at: '2026-11-22T00:00:00Z' }, manifest).warnings.filter((w) => w.field === 'settings.cover');
  ok('D3: publishing warns while a stand-in opens the home page, never blocks, and is quiet for a real photo', warns(SI.STAND_IN_ALT).length === 1 && /stand-in picture/.test(warns(SI.STAND_IN_ALT)[0].message) && warns('A plumber at work').length === 0);
}

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed) Deno.exit(1);
