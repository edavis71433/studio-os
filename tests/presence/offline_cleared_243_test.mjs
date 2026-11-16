// ── Builder list item 243 (Nov 2026): a site never stays marked Offline for good ─
//   deno run --allow-read --allow-env --allow-net tests/presence/offline_cleared_243_test.mjs
//
// A site is marked Offline (presence_sites.offline_at) when Take offline puts its holding
// page up. Any publish or restore that goes live takes the mark off. Two doors to "live"
// didn't: the "nothing changed" answer (item 208: the host already shows these files, so
// nothing is sent) and the reconciler that finishes a slow deploy later. When the offline
// page never went up, or a deploy was put back by hand, Bring back online and Publish both
// answered "live" and left the site marked Offline, with nothing that could ever clear it.
//
//   1  Bring back online when the host already shows the last live version: live, unchanged,
//      and the mark is gone; pressing it again says the site is already online
//   2  Publish in the same state: the same
//   3  that answer also lets the timed-section sweep work out this version's next instant
//   4  the holding page really up: Bring back online deploys over it, and the mark is gone
//   5  a slow deploy the reconciler finishes takes the mark off (and asks for the site's health
//      check, as item 206 wants of every door to live); one the host failed leaves it
//
// The routes run for real: the database is fake_pgrst, the host (Netlify) and the photo
// store are stubbed here, as in publish_sends_what_changed_208_test.mjs.
import { installFakePostgrest } from './fake_pgrst.mjs';

Deno.env.set('NETLIFY_AUTH_TOKEN', 'nf-test');
Deno.env.delete('RESEND_API_KEY');
Deno.env.delete('OPS_ALERT_EMAIL');
const db = installFakePostgrest();
const pg = globalThis.fetch;

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const quiet = async (fn) => { const e = console.error, w = console.warn, l = console.log; console.error = () => {}; console.warn = () => {}; console.log = () => {}; try { return await fn(); } finally { console.error = e; console.warn = w; console.log = l; } };

const hex = (k, i) => `${k}${i.toString(16).padStart(7, '0')}-0000-4000-8000-000000000000`;
const SITE = hex('a', 1), MEDIA = hex('b', 1), OFFER = hex('c', 1), LOC = hex('f', 1);

// ── the host and the photo store, stubbed ──
const sha1 = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-1', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
const enc = new TextEncoder();
let nf;
const resetHost = () => { nf = { has: new Set(), deploys: [], live: null, nextId: 1, states: {} }; };
resetHost();
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const method = (init.method || 'GET').toUpperCase();
  if (u.hostname === 'api.netlify.com') {
    const p = u.pathname.replace('/api/v1', '');
    if (method === 'GET' && /^\/sites\/[^/]+$/.test(p)) return json({ id: 'nf1', name: 'presence-a', default_domain: 'presence-a.netlify.app', custom_domain: null, state: 'current', published_deploy: nf.live ? { id: nf.live } : null });
    if (method === 'POST' && /^\/sites\/[^/]+\/deploys$/.test(p)) {
      const b = JSON.parse(init.body);
      const id = `dep${nf.nextId++}`;
      const required = [...new Set(Object.values(b.files))].filter((d) => !nf.has.has(d));
      nf.deploys.push({ id, files: b.files, title: b.title });
      return json({ id, required });
    }
    if (method === 'PUT' && /^\/deploys\/[^/]+\/files\//.test(p)) { nf.has.add(await sha1(new Uint8Array(await new Response(init.body).arrayBuffer()))); return json({}); }
    if (method === 'GET' && /^\/deploys\/[^/]+$/.test(p)) {
      const id = p.split('/').pop();
      const state = nf.states[id] || 'ready';
      if (state === 'ready') nf.live = id;
      return json({ id, state });
    }
    return json({}, 404);
  }
  if (u.pathname.startsWith('/storage/v1/render/image/') || u.pathname.startsWith('/storage/v1/object/authenticated/')) {
    return new Response(enc.encode(`img:${u.pathname}:${u.searchParams.get('width')}:${u.searchParams.get('format')}`), { status: 200 });
  }
  return pg(url, init);
};

const { handlePublish, handleBackOnline, unchangedMessage } = await import('../../supabase/functions/presence/routes/publish.ts');
const { reconcileOnePublish } = await import('../../supabase/functions/presence/lib/deploy_reconcile.ts');

const site = { id: SITE, client_id: 'client-a', status: 'ready', last_published_at: null, template_slug: 'restaurant-classic', template_version: '1.0.0', custom_domain: null, netlify_site_id: 'nf1', edition: 'presence' };
const hours = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => ({ day, closed: day === 'sun', intervals: day === 'sun' ? [] : [{ open: '09:00', close: '17:00' }] }));
function seed() {
  db.reset({
    presence_sites: [{ ...site, offline_at: null, next_window_at: null }],
    presence_identity: [{ site_id: SITE, business_name: 'Sample Cafe', tagline: 'Good food', description: 'A neighbourhood cafe.', phone: '555-0100', email: '', story: '', service_area: '', booking_url: '', ordering_url: '', social: {}, seo_title: '', seo_description: '' }],
    presence_locations: [{ id: LOC, site_id: SITE, address_line1: '1 Main St', city: 'Town', region: 'CA', postal_code: '90000', country: 'US', timezone: 'America/Los_Angeles', hours, holiday_exceptions: [], temporarily_closed: false, created_at: '2026-01-01T00:00:00Z' }],
    presence_offerings: [{ id: OFFER, site_id: SITE, name: 'Dish', category: 'Mains', description: '', price_text: '$9', media_id: MEDIA, is_visible: true, sort_order: 0, deleted_at: null, created_at: '2026-01-01T00:00:00Z' }],
    presence_testimonials: [], presence_faqs: [], presence_redirects: [], presence_dev_customizations: [], presence_reviews: [], presence_posts: [],
    presence_media: [{ id: MEDIA, site_id: SITE, storage_path: `presence-media/${SITE}/photo.jpg`, alt_text: 'A plate', mime: 'image/jpeg', width: 1600, height: 1000, focal_x: null, focal_y: null, deleted_at: null }],
    presence_settings: [{ site_id: SITE, category_order: [], nav: null, blocks: [], pages: [] }],
    presence_content_library: [],
    presence_publishes: [], presence_snapshots: [], presence_change_events: [], presence_page_locks: [], presence_plan_notices: [],
  });
}
const OWNER = { kind: 'client', userId: 'u1', email: 'owner@example.com' };
const answer = async (res) => ({ status: res.status, body: await res.json() });
const siteRow = () => db.tables.presence_sites[0];
const publish = () => quiet(async () => answer(await handlePublish(null, { ...siteRow() }, OWNER, {})));
const backOnline = () => quiet(async () => answer(await handleBackOnline({ ...siteRow() }, OWNER, {})));
// the database stamps a kept version when it's written, the same day the publish drew it (the
// privacy page prints that day); the fake's own clock starts on another day
const stampSnapshots = () => { for (const s of db.tables.presence_snapshots) s.created_at = new Date().toISOString(); };
// a first publish that went live, then the site marked Offline while the host still shows that
// publish: the holding page never went up (or a deploy was put back by hand)
async function liveThenMarkedOffline() {
  seed(); resetHost();
  const first = await publish();
  stampSnapshots();
  siteRow().offline_at = '2026-11-15T10:00:00Z';
  nf.deploys = [];
  return first;
}

// ═══ 1. Bring back online when the host already shows the last live version ═══
{
  const first = await liveThenMarkedOffline();
  ok('set-up: the first publish went live on the host', first.status === 200 && first.body.data.status === 'live' && nf.live === 'dep1', `${first.status} ${nf.live}`);
  const back = await backOnline();
  ok('Bring back online answers live, and that nothing needed sending', back.status === 200 && back.body.data.status === 'live' && back.body.data.unchanged === true && back.body.data.message === unchangedMessage('restore'), `${back.status} ${JSON.stringify(back.body).slice(0, 200)}`);
  ok('nothing was deployed', nf.deploys.length === 0, String(nf.deploys.length));
  ok('the site is no longer marked Offline', siteRow().offline_at === null, String(siteRow().offline_at));
  ok('and it is live', siteRow().status === 'live' && !!siteRow().last_published_at);
  const again = await backOnline();
  ok('pressing it again says the site is already online', again.status === 409 && again.body.error === 'not_offline', `${again.status} ${JSON.stringify(again.body)}`);
}

// ═══ 2. Publish in the same state ═══
{
  await liveThenMarkedOffline();
  const pub = await publish();
  ok('Publish answers live, unchanged', pub.status === 200 && pub.body.data.status === 'live' && pub.body.data.unchanged === true, `${pub.status} ${JSON.stringify(pub.body).slice(0, 200)}`);
  ok('Publish takes the Offline mark off too', siteRow().offline_at === null && nf.deploys.length === 0, `${siteRow().offline_at} ${nf.deploys.length}`);
}

// ═══ 3. the timed-section sweep works this version out again ═══
{
  await liveThenMarkedOffline();
  siteRow().next_window_at = 'infinity';   // the sweep found no timed section in the last version
  siteRow().offline_at = null;
  const pub = await publish();
  ok('an unchanged publish forgets the last version’s next instant, so the sweep works it out', pub.body.data.unchanged === true && siteRow().next_window_at === null, `${pub.body.data.unchanged} ${siteRow().next_window_at}`);
}

// ═══ 4. the holding page really up ═══
{
  await liveThenMarkedOffline();
  nf.live = 'dep-offline';   // the holding page is what the host shows
  const back = await backOnline();
  ok('Bring back online deploys the last version over the holding page', back.status === 200 && back.body.data.status === 'live' && !back.body.data.unchanged && nf.deploys.length === 1, `${back.status} ${JSON.stringify(back.body).slice(0, 160)} deploys=${nf.deploys.length}`);
  ok('and the site is no longer marked Offline', siteRow().offline_at === null, String(siteRow().offline_at));
}

// ═══ 5. a slow deploy, finished later by the reconciler ═══
{
  seed(); resetHost();
  const at = '2026-11-15T10:00:00Z';
  siteRow().offline_at = at;
  siteRow().last_observed_at = '2026-11-15T09:00:00Z';   // its last health check (item 206)
  db.tables.presence_publishes.push({ id: hex('d', 1), site_id: SITE, status: 'deploying', netlify_deploy_id: 'dep-slow', kind: 'restore', created_at: at });
  const done = await quiet(() => reconcileOnePublish({ id: hex('d', 1), site_id: SITE, netlify_deploy_id: 'dep-slow', created_at: at }, Date.now()));
  ok('the reconciler finds the deploy ready and marks the publish live', done === 'live' && db.tables.presence_publishes[0].status === 'live', `${done} ${db.tables.presence_publishes[0].status}`);
  ok('and takes the Offline mark off the site', siteRow().offline_at === null && siteRow().status === 'live', `${siteRow().offline_at} ${siteRow().status}`);
  ok('and asks for the site’s health check at the next tick, as a publish that goes live does (item 206)', siteRow().last_observed_at === null, String(siteRow().last_observed_at));

  seed(); resetHost();
  siteRow().offline_at = at;
  nf.states['dep-broken'] = 'error';
  db.tables.presence_publishes.push({ id: hex('d', 2), site_id: SITE, status: 'deploying', netlify_deploy_id: 'dep-broken', kind: 'restore', created_at: at });
  const failed = await quiet(() => reconcileOnePublish({ id: hex('d', 2), site_id: SITE, netlify_deploy_id: 'dep-broken', created_at: at }, Date.now()));
  ok('a deploy the host failed is marked failed', failed === 'failed' && db.tables.presence_publishes[0].status === 'failed', `${failed} ${db.tables.presence_publishes[0].status}`);
  ok('and the site stays marked Offline: the holding page is still what visitors see', siteRow().offline_at === at, String(siteRow().offline_at));
}

const failedN = results.filter((r) => !r.p);
console.log(`\n${results.length - failedN.length} passed, ${failedN.length} failed`);
if (failedN.length) { console.log('Failed:\n  ' + failedN.map((r) => r.n).join('\n  ')); Deno.exit(1); }
