// ── Builder items 248, 259, 260, 262, 263, 270, 275, 276 and 279 (full review of Nov 22 2026) ──
//   deno run --allow-read --allow-env tests/presence/sites_fixes_nov22_test.mjs
// Pure: no network, no database. Each part names the item it pins.
import { validateBlocks, resolveBlockMedia, renderSiteBlocks, BLOCK_CSS } from '../../supabase/functions/presence/lib/site_blocks.ts';
import { composeBlocks } from '../../supabase/functions/presence/lib/serializer.ts';
import { renderForm } from '../../supabase/functions/presence/lib/forms.ts';
import { esc, attr, safeHref } from '../../supabase/functions/presence/lib/markdown.ts';
import { renderSnapshot, getTemplate } from '../../supabase/functions/presence/lib/render.ts';
import { validateSnapshot } from '../../supabase/functions/presence/lib/manifest_validate.ts';
import { describeChanges } from '../../supabase/functions/presence/lib/diff.ts';
import { isSampleText, hasSampleWords, sampleSections, sampleWordWarnings } from '../../supabase/functions/presence/lib/sample_words_check.ts';
import { scrambleIpBucket } from '../../supabase/functions/presence/lib/ratelimit.ts';
import { trackerScript } from '../../supabase/functions/presence/lib/visits.ts';
import { handleCollect } from '../../supabase/functions/presence/routes/collect.ts';
import { stockHealth, stockHealthWords, forgetStockHealth } from '../../supabase/functions/presence/lib/stock/health.ts';
import { StockProviderError } from '../../supabase/functions/presence/lib/stock/contract.ts';
import { summarizeHealthCenter } from '../../supabase/functions/presence/lib/health_center.ts';
import { render as restaurantClassic } from '../../supabase/functions/presence/templates/restaurant-classic/1.0.0/render.ts';
import { TEMPLATES, fixture } from './full_fixture.mjs';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const SITE = { baseUrl: 'https://x.test', formEndpoint: 'https://x.test/forms/submit', bookEndpoint: 'https://x.test/book' };
const ctx = { esc, attr, safeHref };
const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;   // nine valid media ids
// a phone photo, 4000 by 3000, as the editor records one at upload
const PHOTO = (id) => ({ alt: 'A real photo', variants: { w400: `/img/${id}-400.webp`, w800: `/img/${id}-800.webp`, w1600: `/img/${id}-1600.webp` }, width: 4000, height: 3000 });
const ref = (id) => (/^0000000[1-9]-/.test(id) ? PHOTO(id) : null);
/** The declarations of the first BLOCK_CSS rule whose selector list is exactly `sel`. */
const ruleOf = (css, sel) => { const i = css.indexOf(sel + '{'); return i < 0 ? null : css.slice(i + sel.length + 1, css.indexOf('}', i)); };

// ═══ Item 248: every photo-carrying section draws a real-sized photo at its own shape ═══
{
  const stored = [
    { type: 'image', image_id: U(1) },
    { type: 'image_text', image_id: U(2), body: 'Beside the photo', side: 'left' },
    { type: 'before_after', items: [{ before_id: U(3), after_id: U(4) }] },
    { type: 'video', url: 'https://www.youtube.com/watch?v=abc', poster_id: U(5) },
    { type: 'map', image_media_id: U(6), address: '1 Main St' },
    { type: 'columns', columns: [{ body: 'One', image_id: U(7) }, { body: 'Two' }] },
    { type: 'tabs', tabs: [{ label: 'First', body: 'Words', image_id: U(8) }, { label: 'Second', body: 'More' }] },
    { type: 'gallery', image_ids: [U(1), U(2), U(3)] },
    { type: 'team', members: [{ name: 'Sam', media_id: U(9) }] },
    { type: 'cards', cards: [{ heading: 'A card', text: 'Short', image_id: U(1) }] },
  ];
  const SELECTOR = {
    image: '.block-image .img-fig img', image_text: '.it-row .it-media img', before_after: '.ba-pair .ba-fig img', video: '.v-poster img',
    map: '.block-map .map-img img', columns: '.block-columns .col-media img', tabs: '.block-tabs .tab-panel .col-media img',
    gallery: '.gallery .ga img', team: '.team-card .team-photo img', cards: '.teaser-card .tc-media img',
  };
  const blocks = resolveBlockMedia(validateBlocks(stored), ref);
  ok('248: all ten section types survive validation and photo resolution', blocks.length === 10, `${blocks.length}`);
  const drawn = renderSiteBlocks(blocks, ctx);
  for (const r of drawn) {
    const type = r.type;
    const sel = SELECTOR[type];
    ok(`248 ${type}: the photo is written with its real size`, r.html.includes('width="4000" height="3000"'));
    const rule = ruleOf(BLOCK_CSS, sel);
    ok(`248 ${type}: the rule ${sel} lets the height follow the width (height:auto)`, !!rule && /(^|;)height:auto(;|$)/.test(rule), rule || 'no rule');
  }
  for (const t of ['gallery', 'team', 'cards']) ok(`248 ${t}: keeps its shape (aspect-ratio with object-fit:cover)`, /aspect-ratio:[^;]+;object-fit:cover/.test(ruleOf(BLOCK_CSS, SELECTOR[t]) || ''));
  // Restaurant Classic: the cover and a dish photo
  const rc = restaurantClassic(fixture('restaurant-classic'), getTemplate('restaurant-classic', '1.0.0').manifest, SITE);
  const css = String(rc['assets/site.css'] || Object.entries(rc).find(([k]) => k.endsWith('.css'))?.[1] || '');
  ok('248 Restaurant Classic: the cover photo follows its width', /\.hero-img img\{[^}]*height:auto/.test(css));
  ok('248 Restaurant Classic: a dish photo on the Menu page has a rule of its own', /\.item img\{[^}]*max-width:400px[^}]*height:auto/.test(css));
}

// ═══ Item 276: a colour theme paints the full band, with the width limit on an inner box ═══
{
  const base = [{ type: 'features', items: [{ title: 'Fast', text: 'We show up' }] }];
  const draw = (list) => renderSiteBlocks(resolveBlockMedia(validateBlocks(list), ref), ctx)[0].html;
  const rootClass = (html) => (/^<[a-z]+[^>]*? class="([^"]*)"/.exec(html) || [])[1] || '';
  const innerWrap = (html) => html.slice(html.indexOf('>') + 1).startsWith('<div class="wrap">') && html.endsWith('</div></section>');
  const plain = draw(base);
  ok('276: a section with no colour of its own keeps class="block wrap …"', rootClass(plain) === 'block wrap block-features' && !innerWrap(plain));
  for (const background of ['tinted', 'accent', 'dark']) {
    const html = draw([{ ...base[0], look: { background } }]);
    const cls = { tinted: 'block--bg-tint', accent: 'block--bg-accent', dark: 'block--bg-dark' }[background];
    ok(`276 ${background}: the colour class is on the root and wrap is not`, rootClass(html) === `block ${cls} block-features`, rootClass(html));
    ok(`276 ${background}: the width limit is an inner box that closes before the section`, innerWrap(html));
  }
  const plainBg = draw([{ ...base[0], look: { background: 'plain' } }]);
  ok('276: "plain" (no band) is left as it was', rootClass(plainBg) === 'block block--bg-plain wrap block-features' && !innerWrap(plainBg));
  const custom = draw([{ ...base[0], style: { bg_color: '#ffeedd' } }]);
  ok('276: a custom background colour moves to the band too', custom.includes('style="--ov-bg:#ffeedd"') && rootClass(custom) === 'block ov-bg block-features' && innerWrap(custom), rootClass(custom));
  const alt = draw([{ type: 'stats', items: [{ value: '1', label: 'x' }], look: { background: 'dark' } }]);
  ok('276: a section already built as a band with an inner box is unchanged', rootClass(alt) === 'block block--bg-dark alt block-stats' && innerWrap(alt), rootClass(alt));
}

// ═══ Item 260: one shared rule for real buttons and fields ═══
{
  ok('260: real buttons and fields take the page’s font', /(^|\n)button,input,select,textarea\{font:inherit/.test(BLOCK_CSS));
  ok('260: a bare button loses the browser’s border (a template’s own .btn rule still wins)', /(^|\n)button\{border:0;background:none;cursor:pointer\}/.test(BLOCK_CSS));
  ok('260: text fields are never under 16px', /input:not\(\[type=checkbox\]\):not\(\[type=radio\]\):not\(\[type=file\]\),select,textarea\{font-size:max\(16px,1em\)\}/.test(BLOCK_CSS));
  ok('260: the newsletter box, the form block and the booking date box share one field look', /\.nl-form \.nl-row input,\.presence-form input[^{]*,\.presence-form select,\.presence-form textarea,\.bk-date\{padding:12px;border:1px solid/.test(BLOCK_CSS));
  const form = renderForm({ id: 'f1', title: 'Ask us', fields: [{ key: 'name', type: 'text', label: 'Your name', required: true }, { key: 'msg', type: 'textarea', label: 'Message' }] }, ctx);
  ok('260: the form block ships label-above, full-width field styles with it', form.includes('.presence-form label{display:block') && form.includes('.presence-form textarea{display:block;width:100%') || /\.presence-form input[^{]*,\.presence-form select,\.presence-form textarea\{display:block;width:100%/.test(form));
}

// ═══ Item 270: a renamed page’s old address forwards with a forced 301, no refresh page ═══
{
  for (const slug of TEMPLATES) {
    const t = getTemplate(slug, '1.0.0');
    const snap = fixture(slug);
    snap.content.redirects = [...(snap.content.redirects || []), { from_path: '/old-page', to_path: '/about/' }];
    const files = await renderSnapshot(snap, SITE);
    const lines = String(files['_redirects'] || '').split('\n').filter(Boolean);
    ok(`270 ${slug}: every forward is written forced (301!)`, lines.length > 0 && lines.every((l) => / 301!$/.test(l)), lines.join(' | '));
    ok(`270 ${slug}: no refresh page is written at the old address`, !('old-page/index.html' in files) && !Object.keys(files).some((k) => String(files[k]).includes('http-equiv="refresh"')));
    ok(`270 ${slug}: the template is a real one`, !!t);
  }
}

// ═══ Item 275: sample words are named at publish and kept out of what Google reads ═══
{
  ok('275: "Your heading" is a sample line', isSampleText('Your heading') && isSampleText('  your heading '));
  ok('275: a price that is only a dash is a sample', isSampleText('$—') && isSampleText('$ -') && isSampleText('—'));
  ok('275: a link to example.com or to "yourbusiness" is a sample', isSampleText('https://example.com') && isSampleText('https://instagram.com/yourbusiness') && !isSampleText('https://instagram.com/sweetcrumbbakery'));
  ok('275: real words are not samples', !isSampleText('Cinnamon knots are back') && !isSampleText('$12') && !isSampleText(''));
  const content = {
    identity: { business_name: 'Bakery' }, locations: [], offerings: [], testimonials: [], faqs: [], posts: [], media: [], redirects: [],
    settings: {
      blocks: [
        { type: 'features', title: 'Why us', items: [{ title: 'What makes you great', text: 'Say it in a clear line.' }] },
        { type: 'stats', items: [{ value: '12', label: 'Years baking' }] },
        { type: 'pricing', tiers: [{ name: 'Starter', price_text: '$—', features: ["What's included"] }] },
      ],
      pages: [{ slug: 'order', title: 'Order a cake', blocks: [{ type: 'buttons', buttons: [{ label: 'Learn more', url: 'https://example.com', style: 'primary' }] }, { type: 'title', title: 'Our cakes' }] }],
    },
  };
  const found = sampleSections(content);
  ok('275: three sections still carry sample words, with their page and index', JSON.stringify(found.map((f) => [f.page, f.index])) === '[["",0],["",2],["order",0]]', JSON.stringify(found));
  const warns = sampleWordWarnings(content);
  ok('275: one counting line, then one line per section the editor can open', warns.length === 4 && warns[0].field === 'sample_words' && warns[0].message.startsWith('3 sections still have sample words') && warns[1].field === 'blocks.0' && warns[3].field === 'page:order.blocks.0' && warns[3].at.page === 'order' && warns[3].at.index === 0, JSON.stringify(warns));
  ok('275: a clean site gets no line', sampleWordWarnings({ ...content, settings: { blocks: [content.settings.blocks[1]] } }).length === 0);
  const snap = fixture('aurora');
  snap.content.settings = { ...(snap.content.settings || {}), blocks: [...((snap.content.settings || {}).blocks || []), { type: 'process', steps: [{ step: 'Get in touch', detail: 'The easy first step.' }] }] };
  const v = validateSnapshot(snap, getTemplate('aurora', '1.0.0').manifest);
  ok('275: the publish check warns, and never blocks, over sample words', v.ok && v.warnings.some((w) => w.field === 'sample_words') && !v.blockers.some((b) => b.field === 'sample_words'));
  const sampleSteps = renderSiteBlocks(resolveBlockMedia(validateBlocks([{ type: 'process', steps: [{ step: 'Get in touch', detail: 'The easy first step.' }] }]), ref), ctx)[0];
  const realSteps = renderSiteBlocks(resolveBlockMedia(validateBlocks([{ type: 'process', steps: [{ step: 'Call us', detail: 'We book a tasting.' }] }]), ref), ctx)[0];
  ok('275: a steps section on its sample words sends Google no HowTo; a real one does', !sampleSteps.ld && realSteps.ld && realSteps.ld['@type'] === 'HowTo');
  const samplePrice = renderSiteBlocks(resolveBlockMedia(validateBlocks([{ type: 'pricing', tiers: [{ name: 'Starter', price_text: '$—', features: ['A second line'] }] }]), ref), ctx)[0];
  ok('275: a price list of dashes sends Google no offers', !samplePrice.ld && samplePrice.html.includes('$—'));
  ok('275: hasSampleWords looks inside lists and rows but not at a block’s type', hasSampleWords({ type: 'title', title: 'Your heading' }) && !hasSampleWords({ type: 'title', title: 'Welcome' }));
}

// ═══ Item 279: the limiter keeps no address, and both privacy signals stop the count ═══
{
  const a = scrambleIpBucket('forms:ip:203.0.113.9', 'salt', '2026-11-22');
  ok('279: an address in a bucket is replaced by a 16-character code', /^forms:ip:[0-9a-f]{16}$/.test(a) && !a.includes('203.0.113.9'), a);
  ok('279: the same address on the same day lands in the same bucket', a === scrambleIpBucket('forms:ip:203.0.113.9', 'salt', '2026-11-22'));
  ok('279: a new day or a new salt gives a new code', a !== scrambleIpBucket('forms:ip:203.0.113.9', 'salt', '2026-11-23') && a !== scrambleIpBucket('forms:ip:203.0.113.9', 'other', '2026-11-22'));
  ok('279: a bucket with no address is left as it is', scrambleIpBucket('px:site:abc', 'salt') === 'px:site:abc' && scrambleIpBucket('book:slots:site:x', 'salt') === 'book:slots:site:x');
  ok('279: the collector’s own bucket is covered (px:ip:…)', /^px:ip:[0-9a-f]{16}$/.test(scrambleIpBucket('px:ip:2001:db8::1', 'salt', '2026-11-22')));
  ok('279: a code is not scrambled twice', scrambleIpBucket(a, 'salt', '2026-11-22') === a);
  ok('279: the counter script reads Global Privacy Control as well as Do Not Track', trackerScript('site', 'https://fn.test').includes("navigator.globalPrivacyControl===true"));
  const gpc = await handleCollect(new Request('https://fn.test/px/x', { method: 'POST', headers: { 'sec-gpc': '1' }, body: '{}' }), '11111111-1111-4111-8111-111111111111', {});
  ok('279: a Sec-GPC: 1 request is answered 204 and nothing is counted', gpc.status === 204);
}

// ═══ Item 263: the Health Center says whether stock photos answer ═══
{
  const fake = (fail) => ({ key: 'pexels', name: 'Pexels', license: {}, available: () => true, search: async () => { if (fail) throw new StockProviderError(fail); return []; }, download: async () => null });
  forgetStockHealth();
  const refused = await stockHealth(fake(401), 1_000);
  ok('263: a refused key reads as not answering, with its status', refused.configured && refused.answered === false && refused.status === 401);
  const w = stockHealthWords(refused);
  ok('263: the Health Center line says the key is refused and what to do', w.state === 'attention' && /refusing the stock photo key/.test(w.detail) && /PEXELS_API_KEY/.test(w.detail), w.detail);
  const again = await stockHealth(fake(0), 1_000 + 60_000);
  ok('263: the answer is remembered for ten minutes (no second call)', again.status === 401);
  const later = await stockHealth(fake(0), 1_000 + 11 * 60_000);
  ok('263: after ten minutes it asks again', later.answered === true && stockHealthWords(later).state === 'ok');
  forgetStockHealth();
  ok('263: no key reads as off, not as broken', stockHealthWords({ configured: false, answered: null, status: 0, provider: 'Pexels' }).state === 'off');
  ok('263: a limited provider is named as limiting', /limiting/.test(stockHealthWords({ configured: true, answered: false, status: 429, provider: 'Pexels' }).detail));
  const base = { nowIso: '2026-11-22T00:00:00Z', cronLastRunAt: '2026-11-22T00:00:00Z', secretsMissingRequired: [], domainsWatched: 0, domainsExpiringSoon: 0, billing: { active: 1, paused: 0, lapsed: 0 }, aiConfigured: true, aiOpsThisMonth: 0, emailConfigured: true, sitesLive: 1, failedPublishes: 0, failedRuns: 0, activeNotices: 0, backupsVerified: true };
  const hc = summarizeHealthCenter({ ...base, stock: refused });
  const area = hc.areas.find((x) => x.key === 'stock');
  ok('263: the Health Center carries a "Stock photos" area that needs a look when the key is refused', !!area && area.label === 'Stock photos' && area.state === 'attention' && hc.overall === 'attention');
  ok('263: without the probe the area is left out, as before', !summarizeHealthCenter(base).areas.some((x) => x.key === 'stock'));
}

// ═══ Item 262: a page whose address changed reads as a rename, once ═══
{
  const blocks = [{ type: 'title', title: 'Catering' }];
  const page = (slug, title) => ({ slug, title, blocks });
  const mk = (pages, redirects = []) => ({ identity: { business_name: 'Bakery' }, locations: [], offerings: [], testimonials: [], faqs: [], posts: [], media: [], redirects, settings: { pages } });
  const live = mk([page('catering', 'Catering')]);
  const draft = mk([page('catering-and-events', 'Catering and events')], [{ from_path: '/catering/', to_path: '/catering-and-events/' }]);
  const cs = describeChanges(draft, live);
  ok('262: a rename with its forward is one sentence', cs.count === 1 && /^Renamed “Catering” to “Catering and events”/.test(cs.changes[0].sentence), JSON.stringify(cs.changes));
  const twin = describeChanges(mk([page('cakes', 'Cakes')]), mk([page('cake', 'Cakes')]));
  ok('262: a new page with the same sections as a gone page is the same page at a new address', twin.count === 1 && /moves to a new address/.test(twin.changes[0].sentence), JSON.stringify(twin.changes));
  const really = describeChanges(mk([page('new', 'New')]), mk([{ slug: 'old', title: 'Old', blocks: [{ type: 'title', title: 'Old words' }] }]));
  ok('262: a different new page and a removed page still read as two changes', really.count === 2 && really.changes.some((c) => /^New page/.test(c.sentence)) && really.changes.some((c) => /is removed/.test(c.sentence)));
  // the live version comes back from the database with its keys in another order (seen live
  // Nov 22: "6 changes" seconds after a publish of 6, with the two snapshots identical)
  const reordered = (v) => Array.isArray(v) ? v.map(reordered) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort((x, y) => y.length - x.length || y.localeCompare(x)).map((k) => [k, reordered(v[k])])) : v;
  const rich = mk([{ slug: 'order', title: 'Order', blocks: [{ type: 'stack', id: 'stack_1', items: [{ kind: 'heading', text: 'Hi' }, { kind: 'button', buttons: [{ label: 'Go', url: '/contact/', style: 'primary' }] }], look: { background: 'tinted' } }] }], [{ from_path: '/a/', to_path: '/b/' }]);
  rich.settings.nav = [{ label: 'Home', href: '/' }, { label: 'Order', href: '/order/', children: [{ label: 'Cakes', href: '/order/#cakes' }] }];
  rich.settings.blocks = [{ type: 'features', title: 'Why', items: [{ title: 'Fresh', text: 'Daily' }] }];
  const same = describeChanges(rich, reordered(rich));
  ok('262: a live version whose keys came back in another order is no change at all', same.count === 0, JSON.stringify(same.changes));
  const plus = describeChanges(mk([page('catering-and-events', 'Catering and events')], [{ from_path: '/catering/', to_path: '/catering-and-events/' }, { from_path: '/x', to_path: '/y' }]), live);
  ok('262: another forward beside the rename is still a change of its own', plus.count === 2 && plus.changes.some((c) => c.sentence === 'Link redirects are updated.'));
}

// ═══ Item 259: an empty section is a placeholder on the canvas, nothing on a live site ═══
{
  const raw = [
    { type: 'title', title: 'Welcome' },
    { type: 'gallery', image_ids: [] },
    { type: 'video', url: '' },
    { type: 'map', address: '' },
    { type: 'team', members: [] },
    { type: 'reviews_wall', max: 12 },
    { type: 'image' },
    { type: 'gallery', title: 'Our cakes', image_ids: [U(1)] },
  ];
  const live = composeBlocks(raw, () => null, ref);
  ok('259: a publish still drops the six empty sections', live.blocks.length === 2 && JSON.stringify(live.src) === '[0,7]', JSON.stringify(live.src));
  const canvas = composeBlocks(raw, () => null, ref, undefined, true);
  ok('259: the canvas keeps every section, in order, with its stored index', canvas.blocks.length === 8 && JSON.stringify(canvas.src) === '[0,1,2,3,4,5,6,7]', JSON.stringify(canvas.src));
  ok('259: the empty ones are placeholders that remember their kind', canvas.blocks.slice(1, 7).every((b) => b.type === 'empty') && canvas.blocks.slice(1, 7).map((b) => b.of).join(',') === 'gallery,video,map,team,reviews_wall,image');
  const drawn = renderSiteBlocks(canvas.blocks, { ...ctx, src: canvas.src });
  const g = drawn[1].html;
  ok('259: a placeholder is a real section with its stored index and plain words', g.includes('class="block wrap block-empty block-empty-gallery"') && g.includes('data-dds-src="1"') && g.includes('Photo gallery') && g.includes('Add photos to this gallery'), g.slice(0, 200));
  ok('259: a video placeholder asks for the link; a reviews wall explains itself', drawn[2].html.includes('Paste a link to your video') && drawn[5].html.includes('approved reviews'));
  ok('259: a placeholder sends Google nothing', drawn.slice(1, 7).every((r) => !r.ld));
  ok('259: the placeholder has a style of its own', BLOCK_CSS.includes('.block-empty .empty-box{border:2px dashed'));
  const liveDrawn = renderSiteBlocks(live.blocks, { ...ctx, src: live.src });
  ok('259: nothing empty reaches a live page', !liveDrawn.some((r) => r.html.includes('block-empty')));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) Deno.exit(1);
