// ── Phase T-BLOCKS · structured content block library — validation + render ──
//   deno run --allow-read --allow-env tests/presence/site_blocks_test.mjs
// Proves the configurable block library is production-safe: validation caps +
// coerces + dedupes; rendering is deterministic, escaped, JS-free, emits correct
// schema.org + a11y; the engine only realizes blocks the catalog declares; and the
// business-classic template surfaces them (and stays byte-stable with none).
import { validateBlocks, resolveBlockMedia, renderSiteBlocks, REALIZED_BLOCK_TYPES, BLOCK_CSS } from '../../supabase/functions/presence/lib/site_blocks.ts';
import { COMPONENTS } from '../../supabase/functions/presence/lib/site_components.ts';
import { esc, attr, safeHref } from '../../supabase/functions/presence/lib/markdown.ts';
import { brandTint } from '../../supabase/functions/presence/lib/palettes.ts';
import { contrastRatio } from '../../supabase/functions/presence/lib/brand_kit.ts';
import { render as businessClassic } from '../../supabase/functions/presence/templates/business-classic/1.0.0/render.ts';
import manifest from '../../supabase/functions/presence/templates/business-classic/1.0.0/manifest.json' with { type: 'json' };
import fixture from '../../supabase/functions/presence/templates/business-classic/1.0.0/fixture.json' with { type: 'json' };

const results = [];
const ok = (n, p) => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}`); };
const ctx = { esc, attr, safeHref };

// ═══ 1. validation — caps, coercion, dedupe, drops the malformed ═══
{
  ok('unknown block types are dropped', validateBlocks([{ type: 'evil_iframe' }, { type: 'features', items: [{ title: 'A' }] }]).length === 1);
  ok('empty blocks (no items) are dropped', validateBlocks([{ type: 'features', items: [] }, { type: 'stats', items: [{ value: '', label: '' }] }]).length === 0);
  ok('content blocks repeat (a real builder — several stats/features/etc. allowed)', validateBlocks([{ type: 'stats', items: [{ value: '10', label: 'Years' }] }, { type: 'stats', items: [{ value: '99', label: 'Other' }] }]).length === 2);
  ok('genuine singletons still dedupe (toc / reviews_wall — first kept)', validateBlocks([{ type: 'toc' }, { type: 'toc' }]).length === 1);
  const capped = validateBlocks([{ type: 'features', items: Array.from({ length: 40 }, (_, i) => ({ title: `f${i}` })) }])[0];
  ok('per-block item cap enforced (features ≤ 8)', capped.items.length === 8);
  const strs = validateBlocks([{ type: 'cta', text: '  hi   there  ', button: 'x'.repeat(200) }])[0];
  ok('strings trimmed + length-capped', strs.text === 'hi there' && strs.button.length <= 40);
  ok('total blocks capped at MAX_BLOCKS (32) even when repeating', validateBlocks(Array.from({ length: 50 }, () => ({ type: 'features', items: [{ title: 'a' }] }))).length === 32);
  ok('non-array / junk input → empty', validateBlocks(null).length === 0 && validateBlocks('nope').length === 0 && validateBlocks(undefined).length === 0);
  ok('owner order preserved', JSON.stringify(validateBlocks([{ type: 'team', members: [{ name: 'A' }] }, { type: 'stats', items: [{ value: '1', label: 'x' }] }]).map((b) => b.type)) === '["team","stats"]');
}

// ═══ 2. render — deterministic, escaped, JS-free, a11y, schema ═══
{
  const all = validateBlocks([
    { type: 'features', items: [{ title: 'Fast', text: 'We show up' }] },
    { type: 'stats', items: [{ value: '15', label: 'Years' }] },
    { type: 'team', members: [{ name: 'Sam Rivera', role: 'Owner' }] },
    { type: 'process', steps: [{ step: 'Call', detail: 'We answer' }, { step: 'Quote' }] },
    { type: 'pricing', tiers: [{ name: 'Basic', price_text: '$99', features: ['A', 'B'] }] },
    { type: 'certifications', items: [{ name: 'Licensed', issuer: 'State' }] },
    { type: 'service_areas', areas: ['Springfield', 'Shelbyville'] },
    { type: 'cta', text: 'Ready?', button: 'Book', url: 'https://ex.com/book' },
  ]);
  const r = renderSiteBlocks(all, ctx);
  ok('every enabled block renders a <section>; every non-CTA carries an <h2>', r.length === 8 && r.every((b) => b.html.includes('<section')) && r.filter((b) => b.type !== 'cta').every((b) => b.html.includes('<h2>')));
  ok('stable block_<type> keys', r.map((b) => b.key).join(',') === 'block_features,block_stats,block_team,block_process,block_pricing,block_certifications,block_service_areas,block_cta');
  ok('duplicate content blocks get UNIQUE render keys (no silent overwrite)', (() => {
    const dup = renderSiteBlocks(validateBlocks([{ type: 'features', items: [{ title: 'A' }] }, { type: 'features', items: [{ title: 'B' }] }]), ctx);
    return dup.length === 2 && dup[0].key === 'block_features' && dup[1].key === 'block_features_2' && dup[0].html.includes('A') && dup[1].html.includes('B');
  })());
  ok('two tabs blocks get distinct radio-group names (no cross-wiring)', (() => {
    const two = renderSiteBlocks(validateBlocks([{ type: 'tabs', tabs: [{ label: 'X', body: 'x' }, { label: 'Y', body: 'y' }] }, { type: 'tabs', tabs: [{ label: 'P', body: 'p' }, { label: 'Q', body: 'q' }] }]), ctx);
    return two.length === 2 && two[0].html.includes('name="site-tabs"') && two[1].html.includes('name="site-tabs-1"');
  })());
  ok('team → Person/ItemList schema; process → HowTo; pricing → Offer', (() => {
    const team = r.find((b) => b.type === 'team').ld; const proc = r.find((b) => b.type === 'process').ld; const price = r.find((b) => b.type === 'pricing').ld;
    return team?.itemListElement?.[0]?.item?.['@type'] === 'Person' && proc?.['@type'] === 'HowTo' && price?.itemListElement?.[0]?.item?.['@type'] === 'Offer';
  })());
  ok('pricing Offer carries numeric price parsed from "$99"', r.find((b) => b.type === 'pricing').ld.itemListElement[0].item.price === '99');
  ok('presentational blocks emit no schema', ['features', 'stats', 'certifications', 'service_areas', 'cta'].every((t) => !r.find((b) => b.type === t).ld));
  ok('process uses an ordered list; areas use an unordered list', r.find((b) => b.type === 'process').html.includes('<ol') && r.find((b) => b.type === 'service_areas').html.includes('<ul'));
  ok('no JavaScript emitted (no <script>/on*=)', r.every((b) => !/<script|onclick=|onerror=/i.test(b.html)));
  ok('deterministic — same input, identical output', JSON.stringify(renderSiteBlocks(all, ctx)) === JSON.stringify(r));
  // XSS / injection: a hostile field must be escaped, never live markup
  const eviltitle = renderSiteBlocks(validateBlocks([{ type: 'features', title: '<script>alert(1)</script>', items: [{ title: '<img src=x onerror=alert(1)>' }] }]), ctx)[0].html;
  ok('hostile content is escaped, not rendered', !eviltitle.includes('<script>alert') && !eviltitle.includes('<img src=x') && eviltitle.includes('&lt;'));
  // unsafe URL on a CTA must not become an href
  const badcta = renderSiteBlocks(validateBlocks([{ type: 'cta', text: 'x', url: 'javascript:alert(1)' }]), ctx)[0].html;
  ok('javascript: CTA url is refused (no href)', !/href=/.test(badcta) || !/javascript:/i.test(badcta));
}

// ═══ 3. catalog agreement — the engine only realizes catalog-declared blocks ═══
{
  const catalogKeys = new Set(COMPONENTS.map((c) => c.key));
  ok('every realized block type exists in the site_components catalog', REALIZED_BLOCK_TYPES.every((t) => catalogKeys.has(t)));
  ok('a solid realized set (≥ 8 blocks)', REALIZED_BLOCK_TYPES.length >= 8);
}

// ═══ 4. template integration — business-classic surfaces blocks + stays stable ═══
{
  const site = { baseUrl: 'https://example.com' };
  const baseContent = JSON.parse(JSON.stringify(fixture.content || fixture));
  const snapNo = { content: baseContent, content_contract_version: 1, template_slug: 'business-classic', template_version: '1.0.0', created_at: '2026-07-09T00:00:00.000Z' };
  const homeNo = businessClassic(snapNo, manifest, site)['index.html'];
  ok('no blocks → no block markup (byte-stable behavior)', !homeNo.includes('block-team') && !homeNo.includes('block-process'));

  const withContent = JSON.parse(JSON.stringify(fixture.content || fixture));
  withContent.settings = { ...(withContent.settings || {}), blocks: validateBlocks([
    { type: 'team', title: 'Our crew', members: [{ name: 'Sam Rivera', role: 'Owner' }] },
    { type: 'process', steps: [{ step: 'Call', detail: 'We answer fast' }] },
  ]) };
  const out = businessClassic({ ...snapNo, content: withContent }, manifest, site);
  const home = out['index.html'];
  ok('blocks appear on the home page', home.includes('block-team') && home.includes('Sam Rivera') && home.includes('block-process'));
  ok('block JSON-LD is injected (HowTo + Person)', home.includes('"@type":"HowTo"') && home.includes('"@type":"Person"'));
  ok('block CSS shipped in the stylesheet', out[Object.keys(out).find((k) => k.endsWith('.css'))].includes('ol.process'));
}

// ═══ 5. media blocks (FD-T17) — validation, resolution, render, zero-iframe ═══
{
  const G = "11111111-1111-1111-1111-111111111111", H = "22222222-2222-2222-2222-222222222222", MISS = "99999999-9999-9999-9999-999999999999";
  const REF = (id) => id === MISS ? null : { alt: "Our work", variants: { w400: "/img/a-400.webp", w800: "/img/a-800.webp", w1600: "/img/a-1600.webp" }, width: 800, height: 600 };

  ok("gallery keeps only valid UUID image ids", (() => { const g = validateBlocks([{ type: "gallery", image_ids: [G, "not-a-uuid", H] }])[0]; return g.image_ids.length === 2 && g.image_ids[0] === G; })());
  ok("video requires http(s); rejects javascript:", validateBlocks([{ type: "video", url: "javascript:alert(1)" }]).length === 0 && validateBlocks([{ type: "video", url: "https://youtu.be/x" }]).length === 1);
  ok("before_after requires both ids per pair", validateBlocks([{ type: "before_after", items: [{ before_id: G, after_id: H }, { before_id: G }] }])[0].items.length === 1);
  ok("team keeps a valid media_id", validateBlocks([{ type: "team", members: [{ name: "Sam", media_id: G }] }])[0].members[0].media_id === G);

  const resolved = resolveBlockMedia(validateBlocks([
    { type: "gallery", title: "Work", image_ids: [G, MISS, H] },
    { type: "before_after", items: [{ before_id: G, after_id: H, caption: "Deck rebuild" }, { before_id: G, after_id: MISS }] },
    { type: "video", title: "Tour", url: "https://youtu.be/x", poster_id: G, caption: "A quick tour" },
    { type: "team", members: [{ name: "Sam", role: "Owner", media_id: G }, { name: "Val" }] },
  ]), REF);
  const gal = resolved.find((b) => b.type === "gallery"), ba = resolved.find((b) => b.type === "before_after"), vid = resolved.find((b) => b.type === "video"), tm = resolved.find((b) => b.type === "team");
  ok("gallery resolves ids→MediaRef, drops unresolved", gal.images.length === 2 && !!gal.images[0].variants.w800);
  ok("before_after drops a pair with an unresolvable image", ba.items.length === 1 && !!ba.items[0].before.variants && ba.items[0].caption === "Deck rebuild");
  ok("video resolves its poster; keeps the url", !!vid.poster && !!vid.poster.variants.w800 && vid.url === "https://youtu.be/x");
  ok("team resolves a member photo; a member without one keeps text (media null)", !!tm.members[0].media && tm.members[1].media === null);

  const r = renderSiteBlocks(resolved, ctx);
  const gh = r.find((b) => b.type === "gallery").html, bh = r.find((b) => b.type === "before_after").html, vh = r.find((b) => b.type === "video").html, th = r.find((b) => b.type === "team").html;
  ok("gallery renders figures with images + alt", gh.includes("<figure") && gh.includes("/img/a-800.webp") && gh.includes('alt="Our work"'));
  ok("before_after labels Before + After", bh.includes("Before") && bh.includes("After") && bh.includes("Deck rebuild"));
  ok("video renders poster + link-out, NEVER an iframe (zero external origins)", vh.includes("/img/a-800.webp") && vh.includes('href="https://youtu.be/x"') && !vh.includes("<iframe"));
  ok("team photo renders inside the card", th.includes("team-photo") && th.includes("/img/a-800.webp"));
  ok("media blocks stay presentational (no extra page-level schema)", !r.find((b) => b.type === "gallery").ld && !r.find((b) => b.type === "before_after").ld && !r.find((b) => b.type === "video").ld);
  ok("every media block type is catalog-declared", ["gallery", "before_after", "video"].every((t) => COMPONENTS.some((c) => c.key === t)));
}

// ═══ 6. growth blocks (r2) — newsletter, social, events, map ═══
{
  // newsletter — same link-out posture as appointment
  ok('newsletter requires an http(s) url', validateBlocks([{ type: 'newsletter', text: 'hi' }]).length === 0
    && validateBlocks([{ type: 'newsletter', url: 'javascript:alert(1)' }]).length === 0
    && validateBlocks([{ type: 'newsletter', url: 'https://esp.example/signup' }]).length === 1);
  const nl = renderSiteBlocks(validateBlocks([{ type: 'newsletter', url: 'https://esp.example/signup', text: 'Monthly news, no spam.' }]), ctx)[0];
  ok('newsletter renders calm default copy + a link-out button', nl.html.includes('Get updates from us') && nl.html.includes('href="https://esp.example/signup"') && nl.html.includes('rel="noopener"') && nl.html.includes('Sign up') && nl.html.includes('Monthly news, no spam.'));
  ok('newsletter emits no schema + never a form/iframe', !nl.ld && !/<form|<iframe|<input/i.test(nl.html));

  // social — icon strip, link-out only
  const manyLinks = Array.from({ length: 15 }, (_, i) => ({ network: 'instagram', url: `https://instagram.com/a${i}` }));
  ok('social caps at 8 links', validateBlocks([{ type: 'social', links: manyLinks }])[0].links.length === 8);
  ok('social drops non-http(s) links; all-bad → block skipped', validateBlocks([{ type: 'social', links: [{ network: 'x', url: 'javascript:alert(1)' }] }]).length === 0);
  const so = renderSiteBlocks(validateBlocks([{ type: 'social', links: [
    { network: 'Instagram', url: 'https://instagram.com/b' },   // case-normalized → brand icon
    { network: 'twitter', url: 'https://x.com/b' },             // alias → the X icon + label
    { network: 'myspace', url: 'https://myspace.com/b' },       // unknown → generic link icon
  ] }]), ctx)[0];
  ok('social renders one inline SVG per link, labelled, noopener + new tab', (so.html.match(/<svg /g) || []).length === 3 && so.html.includes('aria-label="Instagram"') && so.html.includes('aria-label="X"') && so.html.includes('rel="noopener" target="_blank"'));
  ok('unknown network falls back to a generic icon with its own label', so.html.includes('aria-label="Myspace"'));
  ok('social emits no schema + loads nothing external (no src/iframe)', !so.ld && !/src=|<iframe|url\(/i.test(so.html));

  // events — clean list, human dates, honest per-item Event schema
  ok('events require name + date per item; cap 12', (() => {
    const e = validateBlocks([{ type: 'events', items: Array.from({ length: 20 }, (_, i) => ({ name: `E${i}`, date: '2026-08-01' })).concat([{ name: 'NoDate' }, { date: '2026-08-02' }]) }])[0];
    return e.items.length === 12 && e.items.every((it) => it.name && it.date);
  })());
  ok('events with no valid items are skipped entirely (calm empty-skip)', validateBlocks([{ type: 'events', items: [{ name: '', date: '' }] }]).length === 0 && validateBlocks([{ type: 'events', items: [] }]).length === 0);
  const evR = renderSiteBlocks(validateBlocks([{ type: 'events', items: [
    { name: 'Live jazz night', date: '2026-07-26', time: '19:00', detail: 'On the patio', url: 'https://tickets.example/jazz' },
    { name: 'Open mic', date: 'every Friday' },
  ] }]), ctx)[0];
  ok('ISO date shows human ("Jul 26") inside a machine-readable <time>', evR.html.includes('>Jul 26</time>') && evR.html.includes('datetime="2026-07-26"'));
  ok('a non-ISO date shows exactly as the owner wrote it', evR.html.includes('every Friday'));
  ok('honest Event JSON-LD: only ISO-dated items, only the fields present', (() => {
    const items = evR.ld && evR.ld.itemListElement;
    return items && items.length === 1 && items[0].item['@type'] === 'Event' && items[0].item.name === 'Live jazz night'
      && items[0].item.startDate === '2026-07-26T19:00' && items[0].item.description === 'On the patio' && items[0].item.url === 'https://tickets.example/jazz';
  })());
  ok('events with no machine-readable date emit NO schema at all', !renderSiteBlocks(validateBlocks([{ type: 'events', items: [{ name: 'Open mic', date: 'Fridays' }] }]), ctx)[0].ld);
  ok('fields absent stay absent in schema (no fabricated description/url)', (() => {
    const one = renderSiteBlocks(validateBlocks([{ type: 'events', items: [{ name: 'Tasting', date: '2026-09-03' }] }]), ctx)[0].ld.itemListElement[0].item;
    return one.startDate === '2026-09-03' && !('description' in one) && !('url' in one);
  })());

  // map — privacy-safe static only
  const MID = '33333333-3333-3333-3333-333333333333';
  const MREF = () => ({ alt: 'Map to our shop', variants: { w800: '/img/map-800.webp' }, width: 800, height: 600 });
  ok('map requires an address or an image (directions alone is not a block)', validateBlocks([{ type: 'map', directions_url: 'https://maps.example/x' }]).length === 0 && validateBlocks([{ type: 'map', address: '12 Oak St, Burbank' }]).length === 1 && validateBlocks([{ type: 'map', image_media_id: MID }]).length === 1);
  const mapR = renderSiteBlocks(resolveBlockMedia(validateBlocks([{ type: 'map', address: '12 Oak St, Burbank', image_media_id: MID }]), MREF), ctx)[0];
  ok('map renders the self-hosted image + the address as text', mapR.html.includes('/img/map-800.webp') && mapR.html.includes('12 Oak St, Burbank'));
  ok('default directions link is built from the address (URL-encoded)', mapR.html.includes('https://www.google.com/maps/search/?api=1&amp;query=12%20Oak%20St%2C%20Burbank') && mapR.html.includes('Get directions'));
  ok('map NEVER embeds a third-party map (no iframe, no tile/script origins)', !/<iframe|<script|maps\.googleapis|gstatic|openstreetmap|tile/i.test(mapR.html));
  const mapCustom = renderSiteBlocks(resolveBlockMedia(validateBlocks([{ type: 'map', address: '12 Oak St', directions_url: 'https://maps.apple.com/?q=me' }]), () => null), ctx)[0];
  ok('an owner-supplied directions link wins; address-only still renders', mapCustom.html.includes('maps.apple.com') && mapCustom.html.includes('12 Oak St') && !mapCustom.html.includes('map-img'));
  ok('map with an unresolvable image but an address keeps the block', renderSiteBlocks(resolveBlockMedia(validateBlocks([{ type: 'map', address: '9 Elm', image_media_id: MID }]), () => null), ctx).length === 1);
  ok('map emits no schema (a free-text address is not decomposed)', !mapR.ld);

  // escaping + zero-external-origins across all four
  const hostile = renderSiteBlocks(resolveBlockMedia(validateBlocks([
    { type: 'newsletter', url: 'https://x.example', text: '<script>alert(1)</script>' },
    { type: 'social', links: [{ network: '"><script>', url: 'https://x.example/p' }] },
    { type: 'events', items: [{ name: '<img src=x onerror=alert(1)>', date: '<b>now</b>' }] },
    { type: 'map', address: '<script>alert(1)</script> St' },
  ]), () => null), ctx);
  ok('hostile strings in all four blocks are escaped, never live markup', hostile.length === 4 && hostile.every((r) => !/<script>|<img\s|<b>/.test(r.html)) && hostile.filter((r) => r.html.includes('&lt;')).length === 4);
  ok('all four are catalog-declared + realized', ['newsletter', 'social', 'events', 'map'].every((t) => COMPONENTS.some((c) => c.key === t) && REALIZED_BLOCK_TYPES.includes(t)));
}

// ═══ 7. text & layout staples (r3) — richtext, image, image_text, accordion, buttons, divider ═══
{
  const IMG = '44444444-4444-4444-4444-444444444444';
  const IREF = () => ({ alt: 'Our storefront', variants: { w400: '/img/s-400.webp', w800: '/img/s-800.webp', w1600: '/img/s-1600.webp' }, width: 1200, height: 800 });

  // — richtext: markdown body, prose section, empty-skip, markdown safety —
  ok('richtext requires a body (empty → skipped)', validateBlocks([{ type: 'richtext', body: '   ' }]).length === 0 && validateBlocks([{ type: 'richtext', body: 'Hello' }]).length === 1);
  ok('richtext preserves newlines (not whitespace-collapsed like short fields)', validateBlocks([{ type: 'richtext', body: 'Line one\n\nLine two' }])[0].body === 'Line one\n\nLine two');
  const rt = renderSiteBlocks(validateBlocks([{ type: 'richtext', title: 'Our story', body: '## We started small\n\nWith **grit** and a [plan](https://ex.com).\n\n- one\n- two' }]), ctx)[0];
  ok('richtext renders a prose section with semantic markdown (h2/strong/list/link)', rt.html.includes('block-richtext') && rt.html.includes('<div class="prose">') && rt.html.includes('<h2>We started small</h2>') && rt.html.includes('<strong>grit</strong>') && rt.html.includes('<ul>') && rt.html.includes('href="https://ex.com"'));
  ok('richtext emits no schema', !rt.ld);
  const rtx = renderSiteBlocks(validateBlocks([{ type: 'richtext', body: '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[x](javascript:alert(1))' }]), ctx)[0].html;
  ok('richtext markdown is escape-first (no live script/img, javascript: link dropped)', !/<script>alert|<img\s+src=x/.test(rtx) && rtx.includes('&lt;script&gt;') && !/href="javascript:/i.test(rtx));

  // — image: figure via blockImg, caption/alt, optional safe link; drops when media missing —
  ok('image needs a resolvable media id (no image → dropped)', resolveBlockMedia(validateBlocks([{ type: 'image', image_id: IMG }]), () => null).length === 0);
  ok('image keeps a valid uuid; junk id dropped at validation', validateBlocks([{ type: 'image', image_id: IMG }])[0].image_id === IMG && validateBlocks([{ type: 'image', image_id: 'nope' }]).length === 0);
  const im = renderSiteBlocks(resolveBlockMedia(validateBlocks([{ type: 'image', image_id: IMG, caption: 'Out front', alt: 'The shop', link: 'https://ex.com' }]), IREF), ctx)[0];
  ok('image renders a <figure> with srcset image + <figcaption>, wrapped in a safe link', im.html.includes('block-image') && im.html.includes('<figure') && im.html.includes('srcset=') && im.html.includes('<figcaption>Out front</figcaption>') && im.html.includes('<a class="img-link" href="https://ex.com"'));
  const imBad = renderSiteBlocks(resolveBlockMedia(validateBlocks([{ type: 'image', image_id: IMG, link: 'javascript:alert(1)' }]), IREF), ctx)[0].html;
  ok('image with an unsafe link renders the figure but NO anchor', imBad.includes('<figure') && !imBad.includes('<a '));

  // — image_text: image + markdown prose, responsive stacking, side, optional button —
  ok('image_text keeps text even if the image is unresolvable; both empty → dropped', resolveBlockMedia(validateBlocks([{ type: 'image_text', body: 'Words', side: 'right' }]), () => null).length === 1 && validateBlocks([{ type: 'image_text', body: '', side: 'left' }]).length === 0);
  ok('image_text side coerces to left|right (default left)', validateBlocks([{ type: 'image_text', body: 'x', side: 'sideways' }])[0].side === 'left' && validateBlocks([{ type: 'image_text', body: 'x', side: 'right' }])[0].side === 'right');
  const itB = renderSiteBlocks(resolveBlockMedia(validateBlocks([{ type: 'image_text', image_id: IMG, body: 'Real **words** here', side: 'right', button: { label: 'Learn more', url: 'https://ex.com/x' } }]), IREF), ctx)[0];
  ok('image_text renders a flex row (it-row) + markdown prose + a safe button', itB.html.includes('block-imgtext') && itB.html.includes('it-row it-right') && itB.html.includes('<div class="it-media">') && itB.html.includes('<strong>words</strong>') && itB.html.includes('<a class="btn" href="https://ex.com/x"'));
  ok('image_text stacking is defined in BLOCK_CSS (@media min-width:620 → row; default column)', /\.it-row\{[^}]*flex-direction:column/.test(BLOCK_CSS) && /@media\(min-width:620px\)\{\.it-row\{flex-direction:row/.test(BLOCK_CSS));
  ok('image_text drops the button when its url is unsafe', !renderSiteBlocks(resolveBlockMedia(validateBlocks([{ type: 'image_text', body: 'x', side: 'left', button: { label: 'Go', url: 'javascript:alert(1)' } }]), () => null), ctx)[0].html.includes('<a class="btn"'));

  // — accordion: native <details>, cap 10, markdown body, escaped summary, no JS —
  ok('accordion caps items at 10 + requires a summary per item', (() => { const a = validateBlocks([{ type: 'accordion', items: Array.from({ length: 14 }, (_, i) => ({ summary: `S${i}`, body: 'b' })).concat([{ summary: '', body: 'x' }]) }])[0]; return a.items.length === 10 && a.items.every((it) => it.summary); })());
  ok('accordion with no valid items is skipped', validateBlocks([{ type: 'accordion', items: [{ summary: '', body: 'x' }] }]).length === 0 && validateBlocks([{ type: 'accordion', items: [] }]).length === 0);
  const ac = renderSiteBlocks(validateBlocks([{ type: 'accordion', items: [{ summary: 'Shipping', body: 'We ship **fast**.' }, { summary: '<b>Returns</b>', body: 'Within 30 days' }] }]), ctx)[0];
  ok('accordion uses native <details>/<summary> (keyboard + a11y, zero JS)', ac.html.includes('<details class="acc-item">') && ac.html.includes('<summary>Shipping</summary>') && !/<script|onclick=/i.test(ac.html));
  ok('accordion summary is escaped; body renders markdown', ac.html.includes('<summary>&lt;b&gt;Returns&lt;/b&gt;</summary>') && ac.html.includes('<strong>fast</strong>'));
  ok('accordion emits no schema (distinct from FAQ)', !ac.ld);

  // — buttons: real <a> via safeHref, cap 3, styles, empty-skip —
  ok('buttons cap at 3 + require label AND url', (() => { const b = validateBlocks([{ type: 'buttons', buttons: Array.from({ length: 5 }, (_, i) => ({ label: `B${i}`, url: 'https://e.com' })).concat([{ label: 'NoUrl' }, { url: 'https://e.com' }]) }])[0]; return b.buttons.length === 3; })());
  ok('buttons with no valid entries are skipped', validateBlocks([{ type: 'buttons', buttons: [{ label: 'x' }] }]).length === 0 && validateBlocks([{ type: 'buttons', buttons: [] }]).length === 0);
  const bt = renderSiteBlocks(validateBlocks([{ type: 'buttons', buttons: [{ label: 'Call us', url: 'tel:+15551234567', style: 'primary' }, { label: 'Email', url: 'mailto:a@b.com', style: 'outline' }, { label: 'Bad', url: 'javascript:alert(1)', style: 'primary' }] }]), ctx)[0];
  ok('buttons render real anchors via safeHref (tel/mailto ok), outline style, drop unsafe', bt.html.includes('<a class="btn" href="tel:+15551234567"') && bt.html.includes('<a class="btn btn-outline" href="mailto:a@b.com"') && !bt.html.includes('javascript:') && (bt.html.match(/<a /g) || []).length === 2);
  ok('buttons label is escaped', renderSiteBlocks(validateBlocks([{ type: 'buttons', buttons: [{ label: '<script>x</script>', url: 'https://e.com' }] }]), ctx)[0].html.includes('&lt;script&gt;'));

  // — divider: presentational, always valid, tokenized, no content —
  ok('divider is always valid; style/size coerce to enums', (() => { const d = validateBlocks([{ type: 'divider', style: 'weird', size: 'huge' }])[0]; return d && d.style === 'line' && d.size === 'medium'; })());
  const dvLine = renderSiteBlocks(validateBlocks([{ type: 'divider', style: 'line', size: 'large' }]), ctx)[0];
  const dvSpace = renderSiteBlocks(validateBlocks([{ type: 'divider', style: 'space', size: 'small' }]), ctx)[0];
  ok('divider line → <hr>; space → aria-hidden spacer; both sized', dvLine.html.includes('<hr>') && dvLine.html.includes('div-large') && dvSpace.html.includes('div-space') && dvSpace.html.includes('aria-hidden="true"') && dvSpace.html.includes('div-small'));
  ok('divider emits no schema + no text/script', !dvLine.ld && !/<script|onclick=/i.test(dvLine.html) && !/<script|onclick=/i.test(dvSpace.html));

  // — catalog agreement + zero external origins across all six —
  ok('all six staples are catalog-declared AND realized', ['richtext', 'image', 'image_text', 'accordion', 'buttons', 'divider'].every((t) => COMPONENTS.some((c) => c.key === t) && REALIZED_BLOCK_TYPES.includes(t)));
  const hostile6 = renderSiteBlocks(resolveBlockMedia(validateBlocks([
    { type: 'richtext', body: '<iframe src="https://evil.example"></iframe>' },
    { type: 'accordion', items: [{ summary: '"><script>', body: '<img src=x onerror=alert(1)>' }] },
    { type: 'buttons', buttons: [{ label: '"><script>', url: 'https://ok.example' }] },
  ]), () => null), ctx);
  ok('no staple ever loads an external origin (no live iframe/img/script/url())', hostile6.every((r) => !/<iframe|<img\b|<script|url\(/i.test(r.html)) && hostile6.every((r) => r.html.includes('&lt;')));
}

// ═══ 8. layout & utility blocks (r4) — columns, cards, download, toc, anchors, decorative ═══
{
  const G = '11111111-1111-1111-1111-111111111111', H = '22222222-2222-2222-2222-222222222222';
  const REF = () => ({ alt: 'A photo', variants: { w800: '/img/a-800.webp', w1600: '/img/a-1600.webp' }, width: 800, height: 600 });

  // — columns: MULTI-INSTANCE, 2–3 columns, markdown + safe image + safe button, stacks —
  const twoCols = validateBlocks([
    { type: 'columns', columns: [{ body: 'A' }, { body: 'B' }] },
    { type: 'columns', columns: [{ body: 'C' }, { body: 'D' }] },
  ]);
  ok('columns is multi-instance (two kept, unique ids)', twoCols.length === 2 && twoCols[0].id !== twoCols[1].id);
  const colKeys = renderSiteBlocks(resolveBlockMedia(twoCols, () => null), ctx).map((b) => b.key);
  ok('columns render keys are per-instance (block_columns_<id>, no collision)', colKeys.length === 2 && colKeys[0] !== colKeys[1] && colKeys.every((k) => k.startsWith('block_columns_')));
  ok('columns cap 6; a single column IS a valid layout container now (min 1)',
    validateBlocks([{ type: 'columns', columns: Array.from({ length: 8 }, (_, i) => ({ body: 'c' + i })) }])[0].columns.length === 6
    && validateBlocks([{ type: 'columns', columns: [{ body: 'only' }] }])[0].columns.length === 1);
  // spans → the 12-unit grid layout container (equal 2/3-col blocks keep data-cols)
  const spanR = renderSiteBlocks(resolveBlockMedia(validateBlocks([{ type: 'columns', columns: [
    { body: 'wide', span: 8 }, { body: 'narrow', span: 4 },
  ] }]), REF), ctx)[0];
  ok('columns WITH spans render the 12-grid layout container (cols-grid + data-span)',
    spanR.html.includes('cols-grid') && spanR.html.includes('data-span="8"') && spanR.html.includes('data-span="4"') && !spanR.html.includes('data-cols'));
  ok('12-grid span widths are defined in BLOCK_CSS', /\.block-columns \.cols-grid>\.col\[data-span="8"\]\{grid-column:span 8\}/.test(BLOCK_CSS));
  const oneColR = renderSiteBlocks(resolveBlockMedia(validateBlocks([{ type: 'columns', columns: [{ body: 'solo' }] }]), REF), ctx)[0];
  ok('a 1-column container renders as a grid (not the equal data-cols path)', oneColR.html.includes('cols-grid') && !oneColR.html.includes('data-cols'));

  // — tabs: zero-JS tabbed panels (CSS radio pattern), keyboard-operable, no script —
  const tabR = renderSiteBlocks(resolveBlockMedia(validateBlocks([{ type: 'tabs', title: 'Plans', tabs: [
    { label: 'Basic', body: 'Cheap **plan**' }, { label: 'Pro', body: 'Better' },
    { label: '<script>x</script>', body: 'safe' },
  ] }]), REF), ctx)[0];
  ok('tabs render the zero-JS radio pattern (radios + labels + panels) with a tablist', tabR.html.includes('block-tabs') && tabR.html.includes('type="radio"') && (tabR.html.match(/class="tab-panel"/g) || []).length === 3 && tabR.html.includes('role="tablist"') && tabR.html.includes('<strong>plan</strong>'));
  ok('tabs are zero-JS (no <script>) and exactly the first tab is pre-selected', !/<script/i.test(tabR.html) && tabR.html.includes('id="site-tabs-0" class="tab-radio" checked') && (tabR.html.match(/checked/g) || []).length === 1);
  ok('tabs escape a hostile label (no executable markup survives)', tabR.html.includes('&lt;script&gt;x&lt;/script&gt;') && !tabR.html.includes('<script>x'));
  ok('tabs CSS (hidden radios + hidden panels + checked-reveal) is defined in BLOCK_CSS', /\.block-tabs \.tab-panel\{display:none/.test(BLOCK_CSS) && /\.tab-radio:nth-of-type\(1\):checked~\.tab-panels \.tab-panel:nth-of-type\(1\)/.test(BLOCK_CSS) && /display:block\}/.test(BLOCK_CSS));

  // — carousel: zero-JS scroll-snap slideshow; a slide with no image is dropped —
  const carR = renderSiteBlocks(resolveBlockMedia(validateBlocks([{ type: 'carousel', title: 'Our work', slides: [
    { image_id: G, caption: 'Kitchen **remodel**' }, { image_id: '', caption: 'orphan' }, { image_id: G },
  ] }]), REF), ctx)[0];
  ok('carousel renders a scroll-snap track; slides without an image are dropped', carR.html.includes('block-carousel') && carR.html.includes('cr-track') && (carR.html.match(/cr-slide/g) || []).length === 2 && carR.html.includes('/img/a-800.webp'));
  ok('carousel caption is escaped/rendered + track is keyboard-focusable, zero JS', carR.html.includes('Kitchen') && carR.html.includes('tabindex="0"') && !/<script/i.test(carR.html));
  ok('carousel CSS (scroll-snap) is in BLOCK_CSS', /scroll-snap-type:x mandatory/.test(BLOCK_CSS));
  ok('a carousel with zero resolvable images renders nothing', renderSiteBlocks(resolveBlockMedia(validateBlocks([{ type: 'carousel', slides: [{ image_id: '' }] }]), REF), ctx).length === 0);

  // — progress: labeled bars, percent clamped 0..100, ARIA progressbar —
  const pgR = renderSiteBlocks(resolveBlockMedia(validateBlocks([{ type: 'progress', title: 'Skills', items: [
    { label: 'Design', percent: 80 }, { label: 'Speed', percent: 150 }, { label: '', percent: 50 },
  ] }]), REF), ctx)[0];
  ok('progress renders labeled bars; empty-label rows dropped; percent clamped to 100', pgR.html.includes('block-progress') && (pgR.html.match(/class="pgb"/g) || []).length === 2 && pgR.html.includes('width:80%') && pgR.html.includes('width:100%') && !pgR.html.includes('width:150%'));
  ok('progress bars are real ARIA progressbars', pgR.html.includes('role="progressbar"') && pgR.html.includes('aria-valuenow="80"'));
  const colR = renderSiteBlocks(resolveBlockMedia(validateBlocks([{ type: 'columns', title: 'Our pillars', columns: [
    { body: 'Fast **service**', image_id: G, button: { label: 'Book', url: 'https://ex.com/b' } },
    { body: '<script>alert(1)</script>', button: { label: 'Bad', url: 'javascript:alert(1)' } },
  ] }]), REF), ctx)[0];
  ok('columns render a responsive grid (data-cols) + prose + safe image + safe button', colR.html.includes('block-columns') && colR.html.includes('data-cols="2"') && colR.html.includes('<strong>service</strong>') && colR.html.includes('/img/a-800.webp') && colR.html.includes('<a class="btn" href="https://ex.com/b"'));
  ok('columns escape hostile markdown + drop an unsafe (javascript:) button', !/<script>alert|href="javascript:/i.test(colR.html) && colR.html.includes('&lt;script&gt;'));
  ok('columns stacking is defined in BLOCK_CSS (1fr default → 2/3 cols ≥620px)', /\.block-columns \.cols\{[^}]*grid-template-columns:1fr/.test(BLOCK_CSS) && /@media\(min-width:620px\)\{\.block-columns \.cols\[data-cols="2"\]/.test(BLOCK_CSS));

  // — cards: MULTI-INSTANCE teaser grid, cap 8, whole-card safe link, escaped —
  ok('cards is multi-instance + caps at 8', (() => { const c = validateBlocks([{ type: 'cards', cards: Array.from({ length: 12 }, (_, i) => ({ heading: `C${i}` })) }, { type: 'cards', cards: [{ heading: 'x' }] }]); return c.length === 2 && c[0].cards.length === 8; })());
  const cardR = renderSiteBlocks(resolveBlockMedia(validateBlocks([{ type: 'cards', title: 'Services', cards: [
    { heading: 'Roofing', text: 'We fix leaks', image_id: G, link: 'https://ex.com/roof' },
    { heading: '<script>alert(1)</script>', link: 'javascript:alert(1)' },
  ] }]), REF), ctx)[0];
  ok('cards render a grid; a linked card is ONE safe anchor; an unsafe link → plain card', cardR.html.includes('card-grid') && cardR.html.includes('<a class="teaser-card" href="https://ex.com/roof"') && (cardR.html.match(/teaser-card/g) || []).length >= 2 && !cardR.html.includes('javascript:'));
  ok('cards escape a hostile heading; the grid stacks (auto-fill minmax)', cardR.html.includes('&lt;script&gt;') && !/<script>alert/.test(cardR.html) && /\.card-grid\{[^}]*repeat\(auto-fill/.test(BLOCK_CSS));

  // — download: media-plumbing reuse → an accessible first-party download link —
  const DLREF = () => ({ alt: 'Menu 2026', variants: { w1600: '/img/menu-1600.webp', w800: '/img/menu-800.webp' }, width: 1600, height: 2000 });
  ok('download needs a resolvable file (unresolvable → dropped) + a valid uuid', resolveBlockMedia(validateBlocks([{ type: 'download', file_id: G }]), () => null).length === 0 && validateBlocks([{ type: 'download', file_id: 'nope' }]).length === 0);
  const dl = renderSiteBlocks(resolveBlockMedia(validateBlocks([{ type: 'download', file_id: G, label: '2026 Menu' }]), DLREF), ctx)[0];
  ok('download renders a first-party "Download <name>" link with a download attr + zero external origins', dl.html.includes('block-download') && dl.html.includes('href="/img/menu-1600.webp"') && dl.html.includes(' download ') && dl.html.includes('Download 2026 Menu') && !/https?:\/\//.test(dl.html));
  ok('download label is escaped (hostile → inert)', renderSiteBlocks(resolveBlockMedia(validateBlocks([{ type: 'download', file_id: G, label: '<script>alert(1)</script>' }]), DLREF), ctx)[0].html.includes('&lt;script&gt;'));
  // DL-FILES: a DOCUMENT (PDF) has no image variants — it links its deployed ORIGINAL
  // (/files/<hash>.pdf), which is the file that actually serves on the published site.
  const DOCREF = () => ({ alt: 'Spring menu', variants: {}, original: '/files/abc123.pdf' });
  const dlDoc = renderSiteBlocks(resolveBlockMedia(validateBlocks([{ type: 'download', file_id: G, label: 'Spring menu (PDF)' }]), DOCREF), ctx)[0];
  ok('download of a document links its served ORIGINAL file, not an image variant', dlDoc.html.includes('href="/files/abc123.pdf"') && !dlDoc.html.includes('/img/') && dlDoc.html.includes(' download ') && dlDoc.html.includes('Download Spring menu (PDF)') && !/https?:\/\//.test(dlDoc.html));

  // — anchors + toc: stable ids on every section; a nav jump-list linking them —
  const tocBlocks = validateBlocks([
    { type: 'toc' },
    { type: 'features', title: 'Why us', items: [{ title: 'Fast' }] },
    { type: 'process', steps: [{ step: 'Call' }] },   // fallback heading "How it works"
    { type: 'divider' },
  ]);
  const tocR = renderSiteBlocks(resolveBlockMedia(tocBlocks, () => null), ctx);
  const toc = tocR.find((b) => b.type === 'toc'), feat = tocR.find((b) => b.type === 'features'), proc = tocR.find((b) => b.type === 'process');
  ok('every rendered section carries a stable, human-ish anchor id (slug of its heading)', feat.html.includes('<section id="why-us"') && proc.html.includes('<section id="how-it-works"'));
  ok('toc builds a labelled <nav> jump-list whose links match the section anchor ids', toc.html.includes('<nav') && toc.html.includes('block-toc') && toc.html.includes('aria-label=') && toc.html.includes('href="#why-us"') && toc.html.includes('href="#how-it-works"') && toc.html.includes('>Why us</a>') && toc.html.includes('>How it works</a>'));
  ok('toc lists neither itself nor headingless sections (divider, cta)', !toc.html.includes('href="#on-this-page"') && !toc.html.includes('href="#divider"'));
  ok('toc renders nothing when the page has no headings to list', renderSiteBlocks(resolveBlockMedia(validateBlocks([{ type: 'toc' }, { type: 'divider' }]), () => null), ctx).every((b) => b.type !== 'toc'));
  ok('anchor ids de-dupe deterministically when two sections share a heading', (() => {
    const r = renderSiteBlocks(resolveBlockMedia(validateBlocks([{ type: 'columns', title: 'More', columns: [{ body: 'a' }, { body: 'b' }] }, { type: 'cards', title: 'More', cards: [{ heading: 'x' }] }]), () => null), ctx);
    return r[0].html.includes('<section id="more"') && r[1].html.includes('<section id="more-2"');
  })());
  ok('block anchors + toc are deterministic (same input → identical output)', JSON.stringify(renderSiteBlocks(resolveBlockMedia(tocBlocks, () => null), ctx)) === JSON.stringify(tocR));

  // — decorative-image toggle (a11y): alt="" + role="presentation" —
  const decOn = renderSiteBlocks(resolveBlockMedia(validateBlocks([{ type: 'image', image_id: G, decorative: true }]), REF), ctx)[0].html;
  const decOff = renderSiteBlocks(resolveBlockMedia(validateBlocks([{ type: 'image', image_id: G }]), REF), ctx)[0].html;
  ok('decorative image → empty alt + role="presentation" (announced by nothing)', decOn.includes('alt=""') && decOn.includes('role="presentation"') && !decOn.includes('alt="A photo"'));
  ok('a non-decorative image keeps its descriptive alt (no presentation role)', decOff.includes('alt="A photo"') && !decOff.includes('role="presentation"'));
  ok('decorative flag validates to boolean true, and is absent when unset', validateBlocks([{ type: 'image', image_id: G, decorative: true }])[0].decorative === true && !('decorative' in validateBlocks([{ type: 'image', image_id: G }])[0]));

  // — dedupe posture: content blocks (incl. download) repeat; only toc/reviews_wall stay one-per-page —
  ok('download now repeats (several files); toc stays single-instance (first kept)', validateBlocks([{ type: 'download', file_id: G }, { type: 'download', file_id: H }]).length === 2 && validateBlocks([{ type: 'toc' }, { type: 'toc' }]).length === 1);
  ok('all four r4 blocks are catalog-declared AND realized', ['columns', 'cards', 'download', 'toc'].every((t) => COMPONENTS.some((c) => c.key === t) && REALIZED_BLOCK_TYPES.includes(t)));
}

// ═══ 9. per-section style options (Phase T-STYLE) — validate/coerce → classes ═══
{
  // — validation: enumerated only; unknown → default (dropped); empty → no `look` —
  const full = validateBlocks([{ type: 'features', items: [{ title: 'A' }], look: { background: 'tinted', width: 'full', spacing: 'roomy', align: 'center' } }])[0];
  ok('look: valid options validate + store on the block', JSON.stringify(full.look) === JSON.stringify({ background: 'tinted', width: 'full', spacing: 'roomy', align: 'center' }));
  const junk = validateBlocks([{ type: 'features', items: [{ title: 'A' }], look: { background: 'rainbow', width: 'huge', spacing: 'xxl', align: 'left' } }])[0];
  ok('look: unknown values drop to default (no look key at all)', !('look' in junk) || junk.look === undefined);
  const partial = validateBlocks([{ type: 'features', items: [{ title: 'A' }], look: { background: 'plain', width: 'nope' } }])[0];
  ok('look: partial — only the valid keys survive', JSON.stringify(partial.look) === JSON.stringify({ background: 'plain' }));
  ok('look: a non-object / missing look leaves the block untouched', !('look' in validateBlocks([{ type: 'features', items: [{ title: 'A' }], look: 'tinted' }])[0]) && !('look' in validateBlocks([{ type: 'features', items: [{ title: 'A' }] }])[0]));

  // — render: each option → exactly one class on the section; default → NONE —
  const styled = renderSiteBlocks(validateBlocks([{ type: 'features', title: 'Why', items: [{ title: 'Fast' }], look: { background: 'tinted', width: 'full', spacing: 'roomy', align: 'center' } }]), ctx)[0].html;
  ok('look: classes emitted onto the section (bg-tint/full/space-roomy/align-center)',
    styled.includes('block--bg-tint') && styled.includes('block--full') && styled.includes('block--space-roomy') && styled.includes('block--align-center') && /class="block block--/.test(styled));
  const plainR = renderSiteBlocks(validateBlocks([{ type: 'stats', items: [{ value: '9', label: 'Yrs' }], look: { background: 'plain', spacing: 'tight' } }]), ctx)[0].html;
  ok('look: plain background + tight spacing → their classes (on an auto-alternate block)', plainR.includes('block--bg-plain') && plainR.includes('block--space-tight'));
  const accentR = renderSiteBlocks(validateBlocks([{ type: 'features', title: 'Why', items: [{ title: 'Fast' }], look: { background: 'accent' } }]), ctx)[0].html;
  ok('look: bold "accent" band validates + emits block--bg-accent', accentR.includes('block--bg-accent'));
  const darkR = renderSiteBlocks(validateBlocks([{ type: 'features', title: 'Why', items: [{ title: 'Fast' }], look: { background: 'dark' } }]), ctx)[0].html;
  ok('look: "dark" band validates + emits block--bg-dark', darkR.includes('block--bg-dark'));
  ok('look: bold bands force light text + define their CSS (contrast holds)', /\.block\.block--bg-accent\{background:var\(--accent-dark/.test(BLOCK_CSS) && /\.block\.block--bg-dark\{background:#1a1622;color:#f2eef8\}/.test(BLOCK_CSS));
  // — features: optional per-item icon (decorative, escaped) —
  const featIconR = renderSiteBlocks(validateBlocks([{ type: 'features', items: [{ title: 'Fast', text: 'quick', icon: '🚚' }, { title: 'Plain' }] }]), ctx)[0].html;
  ok('features: an item icon renders (decorative, aria-hidden); an item without one omits it', featIconR.includes('<div class="svc-ic" aria-hidden="true">🚚</div>') && (featIconR.match(/svc-ic/g) || []).length === 1);
  ok('features icon CSS is defined in BLOCK_CSS', /\.svc-ic\{font-size/.test(BLOCK_CSS));

  const hideR = renderSiteBlocks(validateBlocks([{ type: 'features', title: 'Why', items: [{ title: 'Fast' }], look: { hideOn: 'mobile' } }]), ctx)[0].html;
  ok('look: responsive visibility "hide on phones" validates + emits block--hide-mobile + media CSS', hideR.includes('block--hide-mobile') && /@media\(max-width:620px\)\{\.block--hide-mobile\{display:none/.test(BLOCK_CSS) && /@media\(min-width:621px\)\{\.block--hide-desktop\{display:none/.test(BLOCK_CSS));
  const def = renderSiteBlocks(validateBlocks([{ type: 'features', title: 'Why', items: [{ title: 'Fast' }] }]), ctx)[0].html;
  ok('look: a DEFAULT block emits NO block-- classes (page structure unchanged)', !def.includes('block--') && def.includes('class="block wrap block-features"'));

  // — look rides through resolveBlockMedia on a media-bearing block —
  const IMG = '55555555-5555-5555-5555-555555555555';
  const IREF = () => ({ alt: 'Shop', variants: { w800: '/img/x-800.webp' }, width: 800, height: 600 });
  const resolvedLook = resolveBlockMedia(validateBlocks([{ type: 'image', image_id: IMG, look: { background: 'tinted', align: 'center' } }]), IREF)[0].look;
  ok('look: survives resolveBlockMedia (media block rebuild carries it)', JSON.stringify(resolvedLook) === JSON.stringify({ background: 'tinted', align: 'center' }));

  // — BLOCK_CSS carries the matching rules (one CSS-hash cascade, no per-block markup) —
  ok('look CSS: tint (with color-mix upgrade), plain, spacing, full-bleed + align rules present', (() => {
    return /\.block\.block--bg-tint\{background:#[0-9a-f]{6}\}/.test(BLOCK_CSS)
      && /@supports \(background:color-mix/.test(BLOCK_CSS) && BLOCK_CSS.includes('color-mix(in srgb,var(--accent) 8%,var(--paper')
      && BLOCK_CSS.includes('.block.block--bg-plain{background:none')
      && BLOCK_CSS.includes('.block--space-tight{') && BLOCK_CSS.includes('.block--space-roomy{')
      && BLOCK_CSS.includes('.block--full{max-width:none') && BLOCK_CSS.includes('.block--full>*{') && BLOCK_CSS.includes('.block--align-center{text-align:center}');
  })());

  // — palettes.ts is the SOURCE of the tint + it's contrast-safe with a neutral fallback —
  const tint = brandTint('#5b3fa0');
  ok('palettes.brandTint: a light, brand-derived tint that keeps dark body text ≥ 4.5:1', /^#[0-9a-f]{6}$/.test(tint) && contrastRatio('#1c2430', tint) >= 4.5);
  ok('palettes.brandTint: wired as the BLOCK_CSS fallback (color-mix-less browsers)', BLOCK_CSS.includes(`.block.block--bg-tint{background:${tint}}`));
  const tooLight = brandTint('#ffffff');   // a pathological, ultra-light accent
  ok('palettes.brandTint: a too-light accent falls back to a neutral (not white) contrast-safe wash', tooLight !== '#ffffff' && contrastRatio('#1c2430', tooLight) >= 4.5);
  ok('palettes.brandTint: deterministic (same accent → same tint)', brandTint('#23635a') === brandTint('#23635a'));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ SITE BLOCKS: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
