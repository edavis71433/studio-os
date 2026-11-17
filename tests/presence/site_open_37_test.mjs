// ── The editor's start-up reads in one answer (builder list item 37) ──────────
// GET /site?with=… answers GET /site plus each read the editor makes at start-up. Real handlers
// against the shared in-memory PostgREST: every part must be what that read alone answers, and a
// part the caller may not read on its own (a client reviewer's, a plan without the website) is
// refused, not answered. All names made up.
//   deno run --allow-read --allow-env --allow-net tests/presence/site_open_37_test.mjs
import { installFakePostgrest } from './fake_pgrst.mjs';
const uuid = (c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const SITE = uuid('1'), CLIENT = uuid('2'), U = uuid('3');
const db = installFakePostgrest({ users: { 'jwt-owner': { id: U, email: 'owner@example.com' } }, ownSite: { 'jwt-owner': SITE } });
const pg = globalThis.fetch;
globalThis.fetch = (url, init) => (new URL(String(url)).hostname === 'db.test' ? pg(url, init) : Promise.resolve(new Response('{}', { status: 404 })));

const { handleSiteOpen, OPEN_PARTS } = await import('../../supabase/functions/presence/routes/site_open.ts');
const { handleGetSite } = await import('../../supabase/functions/presence/routes/site.ts');
const { handleCollection, handleSettings } = await import('../../supabase/functions/presence/routes/content.ts');
const { handleMediaList } = await import('../../supabase/functions/presence/routes/room.ts');
const { handlePublishLockGet } = await import('../../supabase/functions/presence/routes/publish_lock.ts');
const { siteDb } = await import('../../supabase/functions/presence/lib/db.ts');

let pass = 0, fail = 0;
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; console.log('FAIL ', n, note); } };
const cors = {};
const site = { id: SITE, client_id: CLIENT, status: 'live', edition: 'presence', template_slug: 'business-classic', template_version: 1 };
// the studio, drilled into its client's site: its reads go by the service key (the fake answers a
// user's own key with nothing but its site row)
const owner = () => ({ kind: 'client', userId: U, email: 'owner@example.com', jwt: 'jwt-owner', requestId: 't', scope: { site_id: SITE, name: 'Marlow Kitchen' } });
const req = (path) => new Request(`https://fn.test/functions/v1/presence${path}`, { method: 'GET', headers: { Authorization: 'Bearer jwt-owner' } });
const body = async (r) => (r ? { status: r.status, body: await r.json().catch(() => null) } : null);
const ALL = Object.keys(OPEN_PARTS).join(',');
const world = (plan = 'presence') => db.reset({
  presence_sites: [{ id: SITE, client_id: CLIENT, status: 'live', edition: 'presence' }],
  presence_entitlements: [{ client_id: CLIENT, product: 'presence', status: 'active', plan }],
  presence_identity: [{ site_id: SITE, business_name: 'Marlow Kitchen', tagline: 'Fresh, local' }],
  presence_offerings: [
    { id: uuid('a'), site_id: SITE, name: 'Breakfast', is_visible: true, sort_order: 1 },
    { id: uuid('b'), site_id: SITE, name: 'Hidden lunch', is_visible: false, sort_order: 2 },
  ],
  presence_faqs: [{ id: uuid('c'), site_id: SITE, question: 'Parking?', answer: 'Out back.', is_visible: true, sort_order: 1 }],
  presence_testimonials: [{ id: uuid('d'), site_id: SITE, quote: 'Lovely.', author: 'Pat', is_visible: true, sort_order: 1 }],
  presence_posts: [{ id: uuid('e'), site_id: SITE, title: 'Open on Sundays', status: 'published', published_at: '2026-11-01T00:00:00Z' }],
  presence_media: [{ id: uuid('f'), site_id: SITE, storage_path: `${SITE}/a.jpg`, alt_text: 'The room', created_at: '2026-11-01T00:00:00Z' }],
  presence_settings: [{ site_id: SITE, blocks: [{ type: 'title', title: 'Hello' }], announcement: null }],
});

// what each read answers on its own, through the handler its route uses
async function alone(name, principal) {
  const db_ = siteDb(principal.jwt, site, principal);
  const route = OPEN_PARTS[name];
  const r = name === 'media' ? await handleMediaList(site, cors)
    : name === 'settings' ? await handleSettings(req(route), db_, site, principal, cors)
    : name === 'publish_lock' ? await handlePublishLockGet(principal.jwt, site, principal, cors)
    : await handleCollection(req(route), db_, site, principal, name, null, cors);
  return body(r);
}
const together = async (principal, role = 'business_owner', wanted = ALL) =>
  body(await handleSiteOpen(req('/site?with=' + wanted), siteDb(principal.jwt, site, principal), site, principal, role, wanted, cors));

// ═══ one answer holds the site and every part, each the same as its own read ═══
{
  world();
  const t = await together(owner());
  const s = await body(await handleGetSite(siteDb('jwt-owner', site, owner()), site, cors));
  ok('answers 200', t.status === 200, JSON.stringify(t));
  ok('its data is GET /site’s, unchanged', JSON.stringify(t.body.data) === JSON.stringify(s.body.data), JSON.stringify(t.body.data).slice(0, 200));
  ok('every part asked for is there', Object.keys(t.body.parts).sort().join() === Object.keys(OPEN_PARTS).sort().join(), Object.keys(t.body.parts).join());
  for (const name of Object.keys(OPEN_PARTS)) {
    const a = await alone(name, owner());
    ok(`${name}: the same as its own read`, a.status === 200 && JSON.stringify(t.body.parts[name]) === JSON.stringify({ data: a.body.data ?? null }), `${JSON.stringify(t.body.parts[name]).slice(0, 160)} vs ${JSON.stringify(a.body).slice(0, 160)}`);
  }
  ok('the lists carry what was seeded', t.body.parts.offerings.data.length === 2 && t.body.parts.faqs.data.length === 1 && t.body.parts.posts.data.length === 1, JSON.stringify(t.body.parts.offerings));
}

// ═══ only what was asked for; a name it doesn't know is left out, for the page to read alone ═══
{
  world();
  const t = await together(owner(), 'business_owner', 'faqs,nonsense,faqs');
  ok('one part asked for twice comes once, and nothing else', Object.keys(t.body.parts).join() === 'faqs', JSON.stringify(Object.keys(t.body.parts)));
}

// ═══ a client reviewer may read none of these on their own, so none comes back ═══
{
  world();
  const t = await together(owner(), 'client_reviewer');
  ok('every part refused for a client reviewer', Object.values(t.body.parts).every((p) => p.status === 403 && !('data' in p)), JSON.stringify(t.body.parts));
}

// ═══ a plan without the website: its parts are refused as the reads alone are ═══
{
  world('business_os_only');
  const t = await together(owner());
  const website = ['offerings', 'faqs', 'testimonials', 'posts', 'media'];
  ok('the website’s lists are refused on a plan without it', website.every((n) => t.body.parts[n].status === 403 && t.body.parts[n].error === 'feature_not_in_plan'), JSON.stringify(t.body.parts));
  ok('…and none of their rows is in the answer', !JSON.stringify(t.body).includes('Breakfast') && !JSON.stringify(t.body).includes('Parking?'));
}

// ═══ a part that fails says so, and the rest still come back ═══
{
  world();
  db.fail.add('presence_faqs');
  const t = await together(owner());
  db.fail.delete('presence_faqs');
  ok('the failed part carries its status, not data', t.body.parts.faqs && !('data' in t.body.parts.faqs) && t.body.parts.faqs.status >= 400, JSON.stringify(t.body.parts.faqs));
  ok('the others are answered', Array.isArray(t.body.parts.offerings.data) && t.body.parts.offerings.data.length === 2);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) Deno.exit(1);
