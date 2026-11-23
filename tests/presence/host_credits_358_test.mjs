// ── Builder item 358: the host is out of credits, and Publish and Home say so ──────────
//   deno run --allow-read --allow-env --allow-net tests/presence/host_credits_358_test.mjs
//
// The host bills every deploy in credits. With none left it refuses new deploys, so every
// Publish stops. The editor used to say only "we hit a snag", and Home's Needs you row showed
// the host's raw error. Now:
//   1  the refusal is told apart from other failures by the host's own answer (402, or words
//      about credits or a usage limit), never by a file's name
//   2  Publish answers host_out_of_credits: the studio is told what to do, a client only that
//      it waits on the studio; any other failure keeps the calm "we hit a snag"
//   3  Home's row says so in plain words with what to do, and every other failed publish gives
//      a plain reason instead of the host's words
// The publish route runs for real: the database is fake_pgrst, the host is stubbed here, as in
// offline_cleared_243_test.mjs. No dates are read: Home's rows take their day as an input.
import { installFakePostgrest } from './fake_pgrst.mjs';

Deno.env.set('NETLIFY_AUTH_TOKEN', 'nf-test');
Deno.env.delete('RESEND_API_KEY');
Deno.env.delete('OPS_ALERT_EMAIL');
const db = installFakePostgrest();
const pg = globalThis.fetch;

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const quiet = async (fn) => { const e = console.error, w = console.warn, l = console.log; console.error = () => {}; console.warn = () => {}; console.log = () => {}; try { return await fn(); } finally { console.error = e; console.warn = w; console.log = l; } };

const { hostOutOfCredits, OUT_OF_CREDITS_STUDIO, OUT_OF_CREDITS_CLIENT, OUT_OF_CREDITS_ROW } = await import('../../supabase/functions/presence/lib/host_credits.ts');
const { buildNeedsYou, publishFailWords } = await import('../../supabase/functions/presence/agency/needs_you.ts');

// ═══ 1. the host's refusal, told apart ═══
{
  const yes = [
    'deploy create failed: 402 {"code":402,"message":"Payment Required"}',
    'deploy: deploy create failed: 402 {"message":"Payment Required"}',   // as the publish row keeps it
    'deploy create failed: 422 {"message":"This team has used all of its credits for the billing period"}',
    'deploy create failed: 403 {"message":"Usage limit reached"}',
    'upload failed for /index.html: 402 (after retry)',
    'deploy state=error: Credit limit exceeded for this team',
  ];
  const no = [
    'deploy create failed: 500 {"message":"Internal Server Error"}',
    'deploy create failed: 422 {"message":"Invalid files"}',
    'upload failed for /images/402-dish.webp: 500 (after retry)',   // 402 in a file's name isn't the host's answer
    'upload failed for /credits.html: 500 (after retry)',           // nor is a page called credits
    'deploy state=error: build failed',
    'render: unknown template restaurant-classic@9.9.9',
    'interrupted before deploy (reconciled)',
    '', null, undefined,
  ];
  ok('1: the host refusing for want of credits is seen in every shape it comes in', yes.every((e) => hostOutOfCredits(e) === true), yes.filter((e) => !hostOutOfCredits(e)).join(' | '));
  ok('1: other failures, file names and nothing at all are not taken for it', no.every((e) => hostOutOfCredits(e) === false), no.filter((e) => hostOutOfCredits(e)).join(' | '));
  // the editor shows the server's message only when it reads as a sentence (presence-core.js nice())
  const reads = (m) => /^[A-Z]/.test(m) && m.length < 160 && !/[{}<>_]/.test(m);
  ok('1: both Publish messages read as plain sentences the editor will show', reads(OUT_OF_CREDITS_STUDIO) && reads(OUT_OF_CREDITS_CLIENT), `${OUT_OF_CREDITS_STUDIO.length} ${OUT_OF_CREDITS_CLIENT.length}`);
  ok('1: the studio is told what to do; a client is never told about the studio’s billing', /add credits/i.test(OUT_OF_CREDITS_STUDIO) && /publish again/i.test(OUT_OF_CREDITS_STUDIO) && !/credit|host|recharge/i.test(OUT_OF_CREDITS_CLIENT));
}

// ── the host, stubbed: deploys are refused with the status set here ──
const hex = (k, i) => `${k}${i.toString(16).padStart(7, '0')}-0000-4000-8000-000000000000`;
const SITE = hex('a', 1), MEDIA = hex('b', 1), OFFER = hex('c', 1), LOC = hex('f', 1);
const enc = new TextEncoder();
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let refuse = null;   // { status, body } for the deploy create
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const method = (init.method || 'GET').toUpperCase();
  if (u.hostname === 'api.netlify.com') {
    const p = u.pathname.replace('/api/v1', '');
    if (method === 'GET' && /^\/sites\/[^/]+$/.test(p)) return json({ id: 'nf1', name: 'presence-a', default_domain: 'presence-a.netlify.app', custom_domain: null, state: 'current', published_deploy: null });
    if (method === 'POST' && /^\/sites\/[^/]+\/deploys$/.test(p)) return json(refuse.body, refuse.status);
    return json({}, 404);
  }
  if (u.pathname.startsWith('/storage/v1/render/image/') || u.pathname.startsWith('/storage/v1/object/authenticated/')) {
    return new Response(enc.encode(`img:${u.pathname}:${u.searchParams.get('width')}:${u.searchParams.get('format')}`), { status: 200 });
  }
  return pg(url, init);
};
const { handlePublish, CALM } = await import('../../supabase/functions/presence/routes/publish.ts');

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
const STUDIO = { kind: 'client', userId: 'u2', email: 'studio@example.com', scope: { site_id: SITE } };   // the studio, inside the client
const publish = async (who) => { seed(); return quiet(async () => { const res = await handlePublish(null, { ...db.tables.presence_sites[0] }, who, {}); return { status: res.status, body: await res.json() }; }); };
const lastRow = () => db.tables.presence_publishes[db.tables.presence_publishes.length - 1] || {};

// ═══ 2. Publish says so ═══
{
  refuse = { status: 402, body: { code: 402, message: 'Payment Required' } };
  const s = await publish(STUDIO);
  ok('2: the studio’s Publish is refused as out of credits, with what to do', s.status === 502 && s.body.error === 'host_out_of_credits' && s.body.message === OUT_OF_CREDITS_STUDIO, `${s.status} ${JSON.stringify(s.body)}`);
  ok('2: the publish row keeps the host’s own answer for whoever looks into it', lastRow().status === 'failed' && hostOutOfCredits(lastRow().error_text) && /^deploy: deploy create failed: 402/.test(lastRow().error_text), String(lastRow().error_text));
  const c = await publish(OWNER);
  ok('2: a client’s Publish says it waits on the studio, nothing about billing', c.status === 502 && c.body.error === 'host_out_of_credits' && c.body.message === OUT_OF_CREDITS_CLIENT, `${c.status} ${JSON.stringify(c.body)}`);
  refuse = { status: 500, body: { message: 'Internal Server Error' } };
  const other = await publish(STUDIO);
  ok('2: any other host failure keeps the calm answer', other.status === 502 && other.body.error === 'publish_failed' && other.body.message === CALM, `${other.status} ${JSON.stringify(other.body)}`);
}

// ═══ 3. Home's Needs you row ═══
{
  const NOW = '2026-10-21T15:00:00Z';
  const rowFor = (error_text) => buildNeedsYou({
    nowIso: NOW, links: [{ site_id: 's2', status: 'active' }], clientNames: { s2: 'Sample Cafe' }, namesByClient: {},
    sites: [{ id: 's2', status: 'ready' }],
    publishes: [{ site_id: 's2', status: 'failed', created_at: '2026-10-20T12:00:00Z', error_text }],
  }).find((r) => r.key === 'broken:publish:s2');
  const credits = rowFor('deploy: deploy create failed: 402 {"code":402,"message":"Payment Required"}');
  ok('3: out of credits: the row says so and what to do', credits && credits.what === OUT_OF_CREDITS_ROW.what && credits.when.startsWith('Failed') && credits.when.endsWith(' · ' + OUT_OF_CREDITS_ROW.when) && credits.verb === 'Fix', JSON.stringify(credits));
  ok('3: never the host’s raw words', credits && !/402|Payment|\{|deploy create/.test(credits.what + credits.when));
  const other = rowFor('deploy: deploy create failed: 500 {"message":"Internal Server Error"}');
  ok('3: another failed publish gives a plain reason, not the host’s words', other && other.what === 'the last publish failed' && other.when.endsWith(' · The host didn’t take it') && !/500|Internal|\{/.test(other.when), JSON.stringify(other));
  ok('3: each stage has its plain reason; an unknown one adds nothing', publishFailWords('config: site has no netlify_site_id (admin has not connected hosting)') === 'Hosting isn’t set up for this site'
    && publishFailWords('render: unknown template x@1') === 'Its pages couldn’t be built' && publishFailWords('images: variant generation failed for: a.jpg') === 'A photo couldn’t be prepared'
    && publishFailWords('interrupted before deploy (reconciled)') === 'It stopped before reaching the host' && publishFailWords('canceled by operator') === '' && publishFailWords(null) === '');
}

const failedN = results.filter((r) => !r.p);
console.log(`\n${results.length - failedN.length} passed, ${failedN.length} failed`);
if (failedN.length) { console.log('Failed:\n  ' + failedN.map((r) => r.n).join('\n  ')); Deno.exit(1); }
