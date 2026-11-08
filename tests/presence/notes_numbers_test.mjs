// ── List item 30: the assistant's notes name real numbers and one action ──
//   deno run --allow-read --allow-env --allow-net tests/presence/notes_numbers_test.mjs
// A note whose evidence carries a count says it ("3 changes have waited 16 days
// to go live"), and says where to act. Without evidence it keeps its fixed words.
// The numbers come only from the evidence rows; the engine loads them by id.
Deno.env.set('SUPABASE_URL', 'https://stub.supabase.test');
Deno.env.set('SERVICE_ROLE_KEY', 'stub-service-key');
const { momentize, TEMPLATES } = await import('../../supabase/functions/presence/moments/rules.ts');
const { withEvidence } = await import('../../supabase/functions/presence/moments/engine.ts');

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const NOW = '2026-11-08T12:00:00.000Z';
const CTX = () => ({ siteId: '00000000-0000-4000-8000-000000000001', now: NOW, previous: {}, dismissals: {} });
let n = 0;
const rec = (rule, evidence, priority = 'high', over = {}) => ({
  recommendation_hash: `r_${rule}_${++n}`, rule: `rec_${rule}`, priority, audience: 'customer', status: 'active',
  value_dimensions: ['business_accuracy'], timing: 'soon', expires_at: '2026-12-01T00:00:00.000Z',
  ...(evidence ? { evidence } : {}), ...over,
});
const ev = (type, resource = '', facts = {}) => ({ type, resource, facts });
const one = (r) => momentize([r], CTX()).moments.find((m) => m.status === 'active');
const tpl = (key) => TEMPLATES.find((t) => t.key === key);

// ═══ 1. each counted note says its number and where to act ═══
{
  const m = one(rec('draft_waiting', [ev('freshness.draft_idle', '', { count: 3, days: 16, oldest: '2026-10-23' })]));
  ok('waiting changes: the count and the days', m.headline === '3 changes have waited 16 days to go live.', m.headline);
  ok('waiting changes: the action is to publish', /then publish/.test(m.summary), m.summary);
  ok('one waiting change reads in the singular', one(rec('draft_waiting', [ev('freshness.draft_idle', '', { count: 1, days: 14 })])).headline === '1 change has waited 14 days to go live.');
}
{
  const m = one(rec('business_facts_incomplete', [
    ev('business_info.address_incomplete', 'city', { field: 'city' }),
    ev('business_info.address_incomplete', 'postal_code', { field: 'postal code' }),
    ev('business_info.hours_incomplete', 'hours', { days: 'sat, sun' }),
  ], 'critical'));
  ok('missing basics: how many, and which', m.headline === '3 basics are missing.' && m.summary.startsWith('Add your city, your ZIP code and your opening hours in Business details.'), `${m.headline} ${m.summary}`);
  const m1 = one(rec('business_facts_incomplete', [ev('trust.contact_missing', 'contact')], 'critical'));
  ok('one missing basic reads in the singular, in plain words', m1.headline === '1 basic is missing.' && m1.summary.startsWith('Add a phone number or email'), `${m1.headline} ${m1.summary}`);
}
{
  const m = one(rec('closed_flag_stale', [ev('business_info.closed_longstanding', 'temporarily_closed', { days: 45, since: '2026-09-24' })]));
  ok('closed notice: for how long', m.headline === 'Your site has said temporarily closed for 45 days.', m.headline);
  ok('closed notice: keeps its one switch', /one switch in Business/.test(m.summary));
}
{
  const m = one(rec('public_freshness', [ev('freshness.publish_stale', '', { days: 94 }), ev('freshness.updates_quiet', '', { days: 200 })], 'low'));
  ok('freshness: days since the site last changed, first', m.headline === 'Nothing on your site has changed in 94 days.', m.headline);
  const u = one(rec('public_freshness', [ev('freshness.updates_quiet', '', { days: 130 })], 'low'));
  ok('freshness: else the days since the last update', u.headline === 'Your last update was 130 days ago.', u.headline);
}
{
  const m = one(rec('search_snippets', [
    ev('seo.title_missing', '/about/', { page: '/about/' }),
    ev('seo.description_length', '/about/', { page: '/about/', length: 20 }),
    ev('seo.title_duplicate', '/,/menu/', { title: 'Home', pages: '/, /menu/' }),
  ]));
  ok('search listing: distinct pages, once each', m.headline === '3 pages could look better in search results.', m.headline);
  ok('search listing: the action is in Search', /In Search, give each one a sentence/.test(m.summary), m.summary);
}
{
  const m = one(rec('accessibility_content', [
    ev('accessibility.img_alt_missing', '/', { page: '/', count: 4 }),
    ev('accessibility.img_alt_missing', '/menu/', { page: '/menu/', count: 2 }),
    ev('media.alt_short', 'm1', { id: 'm1', alt: 'img', length: 3, floor: 8 }),
  ]));
  ok('photo descriptions: pages with none', m.headline === 'Photos on 2 pages have no description.', m.headline);
  ok('photo descriptions: the short ones too, and Edit description in Files', m.summary.startsWith('1 more photo has a description too short to help. In Files, choose Edit description'), m.summary);
  const s = one(rec('accessibility_content', [ev('media.alt_short', 'm1', {}), ev('media.alt_short', 'm2', {})]));
  ok('photo descriptions: only short ones', s.headline === '2 photo descriptions are too short to help.', s.headline);
}
{
  const m = one(rec('media_quality', [ev('performance.image_oversized', 'm1', { kb: 900 }), ev('performance.image_oversized', 'm2', { kb: 700 }), ev('media.offering_photo_missing', '', { count: 5 })]));
  ok('heavy photos: how many, and the items without one', m.headline === '2 photos are slowing your pages down.' && /And 5 items have no picture yet\./.test(m.summary), `${m.headline} ${m.summary}`);
  const b = one(rec('media_quality', [ev('media.offering_photo_missing', '', { count: 1 })]));
  ok('items without a picture, alone', b.headline === '1 item has no picture yet.', b.headline);
  const odd = one(rec('media_quality', [ev('media.unused', '', { count: 3 })]));
  ok('evidence with nothing to count keeps the fixed words', odd.headline === tpl('photographs').headline, odd.headline);
}
{
  const m = one(rec('connected_reputation', [ev('reviews.connected_unreplied', 'Google', { label: 'Google', count: 2 }), ev('reviews.connected_unreplied', 'Yelp', { label: 'Yelp', count: 1 })], 'medium'));
  ok('reviews: unanswered across accounts', m.headline === '3 reviews are waiting for a reply.', m.headline);
}

// ═══ 2. no evidence, odd evidence: the fixed words, unchanged ═══
{
  const bare = one(rec('draft_waiting', null));
  ok('no evidence: the fixed headline', bare.headline === tpl('draft_waiting').headline && bare.summary === tpl('draft_waiting').summary);
  const zero = one(rec('draft_waiting', [ev('freshness.draft_idle', '', { count: 0, days: 'soon' })]));
  ok('a zero or a non-number never becomes a sentence', zero.headline === tpl('draft_waiting').headline, zero.headline);
}

// ═══ 3. dismissal memory reads the same note, numbers or not ═══
{
  const a = momentize([rec('draft_waiting', null, 'high', { recommendation_hash: 'same' })], CTX()).moments[0];
  const b = momentize([rec('draft_waiting', [ev('freshness.draft_idle', '', { count: 2, days: 20 })], 'high', { recommendation_hash: 'same' })], CTX()).moments[0];
  ok('the note’s identity is the evidence behind it, not its words', a.moment_id === b.moment_id);
}

// ═══ 4. the bundle counts what it carries, and names their numbers ═══
{
  const out = momentize([
    rec('search_snippets', [ev('seo.title_missing', '/a/', { page: '/a/' }), ev('seo.title_missing', '/b/', { page: '/b/' })], 'medium'),
    rec('accessibility_content', [ev('accessibility.img_alt_missing', '/', { page: '/', count: 3 })], 'low'),
    rec('content_depth', null, 'low'),
  ], CTX());
  const b = out.moments.find((m) => m.deduplication_key === 'improvements_bundle');
  ok('bundle headline: the real number of concerns', b && b.headline === '3 small improvements are ready when you are.', b && b.headline);
  ok('bundle summary: each concern with its own number', b && /the search listing on 2 pages/.test(b.summary) && /descriptions for photos on 1 page/.test(b.summary) && /a first answer or update/.test(b.summary), b && b.summary);
}

// ═══ 5. tone: every counted sentence passes the same word rules as the fixed ones ═══
{
  const denylist = /\b(SEO|schema|metadata|canonical|HTML|CSS|API|URL|error|failure|failed|broken|invalid|critical|urgent|immediately|ASAP|click here|buy now|upgrade)\b|!|✦|⚠/i;
  const samples = {
    draft_waiting: [ev('freshness.draft_idle', '', { count: 4, days: 30 })],
    missing_basics: [ev('business_info.identity_incomplete', 'description'), ev('business_info.address_incomplete', 'address_line1')],
    closed_notice: [ev('business_info.closed_longstanding', '', { days: 60 })],
    freshness: [ev('freshness.menu_unchanged', '', { days: 200 })],
    search_listing: [ev('seo.thin_content', '/x/', { page: '/x/', words: 12 })],
    photo_descriptions: [ev('accessibility.img_alt_missing', '/', { page: '/', count: 1 })],
    photographs: [ev('performance.image_oversized', 'm1', {})],
    reviews_reply: [ev('reviews.connected_unreplied', 'G', { count: 1 })],
  };
  const texts = [];
  for (const t of TEMPLATES.filter((x) => x.counted)) {
    const w = t.counted(samples[t.key] || []);
    ok(`tone sample exists for ${t.key}`, !!w);
    if (w) texts.push(w.headline, w.summary || '', w.bundleWord || '');
  }
  const bad = texts.filter((x) => denylist.test(x) || /\bNaN\b|undefined|\b0 /.test(x));
  ok('tone: no engineering words, alarm, or empty numbers in any counted sentence', bad.length === 0, bad.join(' | '));
}

// ═══ 6. the engine loads each recommendation's evidence, carefully ═══
{
  const id = (k) => `00000000-0000-4000-8000-${String(k).padStart(12, '0')}`;
  const store = new Map([
    [id(1), { id: id(1), type: 'freshness.draft_idle', resource: '', facts: { count: 3, days: 16 } }],
    [id(2), { id: id(2), type: 'seo.title_missing', resource: '/a/', facts: { page: '/a/' } }],
  ]);
  const asked = [];
  let down = false;
  globalThis.fetch = (url) => {
    const u = decodeURIComponent(String(url)); asked.push(u);
    if (down) return Promise.resolve(new Response('{}', { status: 503 }));
    const ids = (u.match(/id=in\.\(([^)]*)\)/) || [])[1]?.split(',') || [];
    return Promise.resolve(new Response(JSON.stringify(ids.map((x) => store.get(x)).filter(Boolean)), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  };
  const rows = [
    rec('draft_waiting', null, 'high', { affected_resources: [id(1)] }),
    rec('search_snippets', null, 'medium', { affected_resources: [id(2), id(9)] }),                 // one row gone: no half-count
    rec('accessibility_content', null, 'low', { affected_resources: Array.from({ length: 50 }, (_, k) => id(100 + k)) }),   // at the cap
    rec('draft_waiting', null, 'high', { audience: 'operator', affected_resources: [id(3)] }),       // nobody's note
  ];
  const got = await withEvidence(rows);
  ok('evidence attached by id', got[0].evidence?.length === 1 && got[0].evidence[0].facts.count === 3);
  ok('the note then names the number', one(got[0]).headline === '3 changes have waited 16 days to go live.');
  ok('part of the evidence missing: the fixed words, never a short count', got[1].evidence === undefined);
  ok('at the 50-row cap: the fixed words, never asked for', got[2].evidence === undefined && !asked.some((u) => u.includes(id(100))));
  ok('an operator’s recommendation is not looked up', !asked.some((u) => u.includes(id(3))));
  ok('nothing else rides along to the notes', got.every((r) => !('affected_resources' in r)));
  down = true;
  const failed = await withEvidence([rec('draft_waiting', null, 'high', { affected_resources: [id(1)] })]);
  ok('a failed read costs the numbers, not the note', failed[0].evidence === undefined && one(failed[0]).headline === tpl('draft_waiting').headline);
}

const fails = results.filter((r) => !r.p);
console.log(`\n════ NOTES WITH NUMBERS: ${results.length - fails.length}/${results.length} PASSED ════`);
if (fails.length) Deno.exit(1);
