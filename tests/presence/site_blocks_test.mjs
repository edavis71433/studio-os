// ── Phase T-BLOCKS · structured content block library — validation + render ──
//   deno run --allow-read --allow-env tests/presence/site_blocks_test.mjs
// Proves the configurable block library is production-safe: validation caps +
// coerces + dedupes; rendering is deterministic, escaped, JS-free, emits correct
// schema.org + a11y; the engine only realizes blocks the catalog declares; and the
// business-classic template surfaces them (and stays byte-stable with none).
import { validateBlocks, resolveBlockMedia, renderSiteBlocks, styleContrastWarnings, REALIZED_BLOCK_TYPES, BLOCK_CSS, BLOCK_VARIANTS } from '../../supabase/functions/presence/lib/site_blocks.ts';
import { COMPONENTS, BLOCK_STYLE_FIELDS } from '../../supabase/functions/presence/lib/site_components.ts';
import { resolveLinkedBlocks } from '../../supabase/functions/presence/lib/linked_sections.ts';
import { esc, attr, safeHref } from '../../supabase/functions/presence/lib/markdown.ts';
import { brandTint } from '../../supabase/functions/presence/lib/palettes.ts';
import { contrastRatio, darken } from '../../supabase/functions/presence/lib/brand_kit.ts';
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

// ═══ 10. per-block STYLE VARIANTS (Wave-1 G4) — enumerated curated looks ═══
{
  const G = '11111111-1111-1111-1111-111111111111';
  const REF = () => ({ alt: 'Our work', variants: { w800: '/img/a-800.webp' }, width: 800, height: 600 });
  const RW = { reviewsWall: { items: [{ author: 'Dana K.', rating: 5, body: 'Spotless work.' }], aggregate: { count: 1, average: 5 } } };

  // — validation: enumerated per type; unknown / off-type / default-name → dropped —
  ok('variant: allowed values survive validation; the default stores NO variant key', validateBlocks([{ type: 'cta', text: 'Go', variant: 'card' }])[0].variant === 'card' && !('variant' in validateBlocks([{ type: 'cta', text: 'Go' }])[0]));
  ok('variant: unknown / default-name / off-type values are dropped (→ default look)', validateBlocks([
    { type: 'cta', text: 'Go', variant: 'sparkly' }, { type: 'gallery', image_ids: [G], variant: 'grid' }, { type: 'stats', items: [{ value: '1', label: 'x' }], variant: 'quotes' },
  ]).every((b) => !('variant' in b)));
  ok('variant: rides resolveBlockMedia rebuilds (stored → resolved)', resolveBlockMedia(validateBlocks([{ type: 'gallery', variant: 'masonry', image_ids: [G] }]), REF)[0].variant === 'masonry');
  ok('variant: BLOCK_VARIANTS lists only realized, catalog-declared types with enum options', Object.keys(BLOCK_VARIANTS).every((t) => {
    const f = COMPONENTS.find((c) => c.key === t)?.fields.find((f) => f.key === 'variant');
    return REALIZED_BLOCK_TYPES.includes(t) && f && f.type === 'enum' && Array.isArray(f.options) && BLOCK_VARIANTS[t].every((v) => f.options.includes(v));
  }));

  // — render: each variant emits its v-<variant> class; the default emits none —
  ok('cta card / pricing list / accordion two-column render their variant markup', (() => {
    const r = renderSiteBlocks(validateBlocks([
      { type: 'cta', text: 'Go', variant: 'card' },
      { type: 'pricing', variant: 'list', tiers: [{ name: 'Cut', price_text: '$85', features: ['Wash'] }] },
      { type: 'accordion', variant: 'two-column', items: [{ summary: 'Q?', body: 'A.' }] },
    ]), ctx);
    return r[0].html.includes('block-cta v-card') && r[1].html.includes('block-pricing v-list') && r[1].html.includes('pl-price">$85')
      && r[2].html.includes('qa-grid') && r[2].html.includes('<h3 class="qa-q">Q?</h3>') && !r[2].html.includes('<details');
  })());
  ok('gallery masonry/filmstrip + reviews_wall quotes/strip render their variant containers', (() => {
    const g = renderSiteBlocks(resolveBlockMedia(validateBlocks([{ type: 'gallery', variant: 'masonry', image_ids: [G] }, { type: 'gallery', variant: 'filmstrip', image_ids: [G] }]), REF), ctx);
    const q = renderSiteBlocks(resolveBlockMedia(validateBlocks([{ type: 'reviews_wall', variant: 'quotes' }]), () => null, RW), ctx)[0].html;
    const s = renderSiteBlocks(resolveBlockMedia(validateBlocks([{ type: 'reviews_wall', variant: 'strip' }]), () => null, RW), ctx)[0].html;
    return g[0].html.includes('v-masonry') && g[1].html.includes('v-filmstrip') && q.includes('rw-quotes') && q.includes('rw-quote-body') && s.includes('rw-strip') && !s.includes('rw-grid');
  })());
  ok('no variant → no v- class anywhere (default look byte-identical)', renderSiteBlocks(resolveBlockMedia(validateBlocks([
    { type: 'cta', text: 'Go' }, { type: 'pricing', tiers: [{ name: 'A' }] }, { type: 'accordion', items: [{ summary: 'Q', body: 'A' }] }, { type: 'gallery', image_ids: [G] }, { type: 'reviews_wall' },
  ]), REF, RW), ctx).every((b) => !/\bv-[a-z-]+/.test(b.html)));
  ok('variant is presentation only — pricing list keeps the same Offer schema', renderSiteBlocks(validateBlocks([{ type: 'pricing', variant: 'list', tiers: [{ name: 'Cut', price_text: '$85', features: [] }] }]), ctx)[0].ld.itemListElement[0].item.price === '85');
  ok('hostile content in variant branches stays escaped', (() => {
    const r = renderSiteBlocks(validateBlocks([
      { type: 'accordion', variant: 'two-column', items: [{ summary: '<script>alert(1)</script>', body: '<img src=x onerror=alert(1)>' }] },
      { type: 'pricing', variant: 'list', tiers: [{ name: '<script>alert(1)</script>', price_text: '" onmouseover="alert(1)', features: [] }] },
      { type: 'cta', text: '<script>alert(1)</script>', variant: 'card', url: 'javascript:alert(1)' },
    ]), ctx);
    return r.every((b) => !/<script>alert|<img\s+src=x|onmouseover="alert|href="javascript:/i.test(b.html) && b.html.includes('&lt;'));
  })());
  ok('variant CSS shipped, namespaced .v-<variant>', ['.block-cta.v-card', '.block-gallery.v-masonry', '.block-gallery.v-filmstrip', '.block-accordion.v-two-column', '.block-pricing.v-list', '.block-reviews-wall.v-quotes', '.block-reviews-wall.v-strip'].every((sel) => BLOCK_CSS.includes(sel)));
}

// ═══ 11. gallery media sets + zoom (Wave-2 G18) — captions + :target lightbox ═══
{
  const G = '11111111-1111-1111-1111-111111111111', H = '22222222-2222-2222-2222-222222222222', MISS = '99999999-9999-9999-9999-999999999999';
  const REF = (id) => id === MISS ? null : { alt: 'Our work', variants: { w400: '/img/a-400.webp', w800: '/img/a-800.webp', w1600: '/img/a-1600.webp' }, width: 800, height: 600 };

  // — validation: zoom is strict boolean true; captions index-aligned + capped —
  ok('zoom: only literal true survives validation (allowlist posture)', (() => {
    const on = validateBlocks([{ type: 'gallery', image_ids: [G], zoom: true }])[0];
    const junk = validateBlocks([{ type: 'gallery', image_ids: [G], zoom: 'yes' }, { type: 'gallery', image_ids: [G], zoom: 1 }, { type: 'gallery', image_ids: [G] }]);
    return on.zoom === true && junk.every((b) => !('zoom' in b));
  })());
  ok('captions: stored index-aligned with image_ids; junk ids drop their caption too', (() => {
    const g = validateBlocks([{ type: 'gallery', image_ids: [G, 'not-a-uuid', H], captions: ['first', 'orphaned', 'third'] }])[0];
    return g.image_ids.length === 2 && JSON.stringify(g.captions) === JSON.stringify(['first', 'third']);
  })());
  ok('captions: length-capped at 160; all-empty captions store NO captions key', (() => {
    const long = validateBlocks([{ type: 'gallery', image_ids: [G], captions: ['x'.repeat(500)] }])[0];
    const none = validateBlocks([{ type: 'gallery', image_ids: [G, H], captions: ['', '  '] }])[0];
    return long.captions[0].length === 160 && !('captions' in none);
  })());

  // — resolution: zoom + captions ride the rebuild; captions realign on drops —
  ok('zoom + captions survive resolveBlockMedia; captions realign when an image drops', (() => {
    const r = resolveBlockMedia(validateBlocks([{ type: 'gallery', image_ids: [G, MISS, H], captions: ['one', 'gone', 'three'], zoom: true }]), REF)[0];
    return r.zoom === true && r.images.length === 2 && JSON.stringify(r.captions) === JSON.stringify(['one', 'three']);
  })());
  ok('a gallery without zoom/captions resolves with NEITHER key (absent, not false/[])', (() => {
    const r = resolveBlockMedia(validateBlocks([{ type: 'gallery', image_ids: [G] }]), REF)[0];
    return !('zoom' in r) && !('captions' in r);
  })());

  // — render: absent zoom → ZERO output change (golden-provable) —
  ok('no zoom → no lightbox markup at all; junk zoom renders identical to absent', (() => {
    const plain = renderSiteBlocks(resolveBlockMedia(validateBlocks([{ type: 'gallery', title: 'Work', image_ids: [G, H] }]), REF), ctx)[0].html;
    const junk = renderSiteBlocks(resolveBlockMedia(validateBlocks([{ type: 'gallery', title: 'Work', image_ids: [G, H], zoom: 'yes' }]), REF), ctx)[0].html;
    return plain === junk && !plain.includes('v-zoom') && !plain.includes('class="lb') && !plain.includes('ga-zoom') && !plain.includes('#lb-')
      && plain.includes('<figure class="ga"><picture>') && plain.includes('<figcaption>Our work</figcaption>');
  })());
  ok('captions without zoom show in the grid figcaption (alt stays the fallback)', (() => {
    const r = renderSiteBlocks(resolveBlockMedia(validateBlocks([{ type: 'gallery', image_ids: [G, H], captions: ['Front porch', ''] }]), REF), ctx)[0].html;
    return r.includes('<figcaption>Front porch</figcaption>') && r.includes('<figcaption>Our work</figcaption>') && !r.includes('v-zoom');
  })());

  // — render: zoom markup — thumbs are anchors, overlays are :target figures —
  const zr = renderSiteBlocks(resolveBlockMedia(validateBlocks([{ type: 'gallery', title: 'Sets', image_ids: [G, H, G], captions: ['View A', '', 'View C'], zoom: true }]), REF), ctx)[0].html;
  ok('zoom: section gains v-zoom; each thumb is an anchor to its overlay id', zr.includes('block-gallery v-zoom') && zr.includes('<a class="ga-zoom" href="#lb-0-1"') && zr.includes('href="#lb-0-2"') && zr.includes('href="#lb-0-3"') && (zr.match(/class="ga-zoom"/g) || []).length === 3);
  ok('zoom: overlays carry stable ids lb-0-<i> + the gallery container id lb-0', zr.includes('<div class="gallery" id="lb-0">') && zr.includes('id="lb-0-1"') && zr.includes('id="lb-0-2"') && zr.includes('id="lb-0-3"'));
  ok('zoom: close pill + backdrop both link back to the gallery (#lb-0); close is first focusable', (() => {
    const overlay = zr.slice(zr.indexOf('id="lb-0-1"'));
    const bg = overlay.indexOf('class="lb-bg" href="#lb-0"'), close = overlay.indexOf('class="lb-close" href="#lb-0"'), frame = overlay.indexOf('lb-frame');
    return bg > -1 && close > -1 && overlay.includes('tabindex="-1"') && close < frame;   // backdrop is tabindex=-1, close precedes content
  })());
  ok('zoom: prev/next wrap around (first prev → last, last next → first)', (() => {
    const first = zr.slice(zr.indexOf('id="lb-0-1"'), zr.indexOf('id="lb-0-2"'));
    const last = zr.slice(zr.indexOf('id="lb-0-3"'));
    return first.includes('class="lb-prev" href="#lb-0-3"') && first.includes('class="lb-next" href="#lb-0-2"')
      && last.includes('class="lb-prev" href="#lb-0-2"') && last.includes('class="lb-next" href="#lb-0-1"');
  })());
  ok('zoom: overlay shows the full-res rendition (w1600 in srcset, sizes 100vw) + counter + caption', (() => {
    const overlay = zr.slice(zr.indexOf('id="lb-0-1"'), zr.indexOf('id="lb-0-2"'));
    return overlay.includes('/img/a-1600.webp 1600w') && overlay.includes('sizes="100vw"') && overlay.includes('<span class="lb-count">1 / 3</span>') && overlay.includes('<figcaption class="lb-cap">View A</figcaption>');
  })());
  ok('zoom: a single-image gallery renders NO prev/next/counter', (() => {
    const one = renderSiteBlocks(resolveBlockMedia(validateBlocks([{ type: 'gallery', image_ids: [G], zoom: true }]), REF), ctx)[0].html;
    return one.includes('v-zoom') && one.includes('id="lb-0-1"') && !one.includes('lb-prev') && !one.includes('lb-next') && !one.includes('lb-count');
  })());
  ok('zoom: focal point rides into the overlay image (object-position from blockImg)', (() => {
    const FREF = () => ({ alt: 'Focal', variants: { w400: '/i/f-400.webp', w800: '/i/f-800.webp', w1600: '/i/f-1600.webp' }, width: 800, height: 600, focal: { x: 30, y: 70 } });
    const r = renderSiteBlocks(resolveBlockMedia(validateBlocks([{ type: 'gallery', image_ids: [G], zoom: true }]), FREF), ctx)[0].html;
    return r.slice(r.indexOf('lb-frame')).includes('object-position:30% 70%');
  })());

  // — determinism + id stability —
  ok('zoom: ids are stable + deterministic (same input → identical output, twice)', (() => {
    const mk = () => JSON.stringify(renderSiteBlocks(resolveBlockMedia(validateBlocks([{ type: 'gallery', image_ids: [G, H], zoom: true }, { type: 'gallery', image_ids: [H], zoom: true }]), REF), ctx));
    return mk() === mk();
  })());
  ok('zoom: two zoom galleries on one page get distinct id namespaces (lb-0 / lb-1)', (() => {
    const two = renderSiteBlocks(resolveBlockMedia(validateBlocks([{ type: 'gallery', image_ids: [G], zoom: true }, { type: 'gallery', image_ids: [H], zoom: true }]), REF), ctx);
    return two[0].html.includes('id="lb-0"') && two[1].html.includes('id="lb-1"') && two[1].html.includes('href="#lb-1-1"') && !two[1].html.includes('id="lb-0-1"');
  })());
  ok('zoom composes with layout variants (masonry keeps v-masonry AND v-zoom)', (() => {
    const r = renderSiteBlocks(resolveBlockMedia(validateBlocks([{ type: 'gallery', variant: 'masonry', image_ids: [G], zoom: true }]), REF), ctx)[0].html;
    return r.includes('block-gallery v-masonry v-zoom');
  })());

  // — hostile: alt/caption escaped everywhere; every lightbox anchor is a #fragment —
  ok('zoom: hostile alt + caption are escaped in thumbs, aria-labels and overlays', (() => {
    const EVIL = () => ({ alt: '"><script>alert(1)</script>', variants: { w800: '/i/e-800.webp' }, width: 8, height: 6 });
    const r = renderSiteBlocks(resolveBlockMedia(validateBlocks([{ type: 'gallery', image_ids: [G, H], captions: ['<img src=x onerror=alert(1)>', '" onmouseover="alert(1)'], zoom: true }]), EVIL), ctx)[0].html;
    return !/<script>alert|<img\s+src=x|" onmouseover="alert\(1\)"/.test(r) && r.includes('&lt;img') && r.includes('&quot;&gt;&lt;script&gt;');
  })());
  ok('zoom: all lightbox anchors are same-page fragments (no scheme smuggling)', (() => {
    const hrefs = [...zr.matchAll(/class="(?:ga-zoom|lb-bg|lb-close|lb-prev|lb-next)" href="([^"]*)"/g)].map((m) => m[1]);
    return hrefs.length === 3 + 3 * 4 && hrefs.every((h) => /^#lb-0(-\d+)?$/.test(h));
  })());
  ok('zoom emits ZERO JavaScript (platform law: no <script>, no handlers)', !/<script|onclick=|onerror=/i.test(zr));

  // — CSS + catalog contract —
  ok('zoom CSS shipped: :target reveal, 48px close, focus styles, reduced-motion guard', BLOCK_CSS.includes('.lb:target{display:flex}') && BLOCK_CSS.includes('.block-gallery.v-zoom .ga-zoom') && /\.lb-close\{[^}]*min-height:48px/.test(BLOCK_CSS) && BLOCK_CSS.includes('.lb a:focus-visible{outline:3px solid var(--accent)') && /@media\(prefers-reduced-motion:no-preference\)\{\.lb:target \.lb-frame\{animation/.test(BLOCK_CSS));
  ok('catalog: gallery declares the caption (repeatable text) + zoom (boolean) fields', (() => {
    const g = COMPONENTS.find((c) => c.key === 'gallery');
    const cap = g.fields.find((f) => f.key === 'caption'), z = g.fields.find((f) => f.key === 'zoom');
    return cap && cap.type === 'text' && cap.repeatable === true && z && z.type === 'boolean';
  })());
}

// ═══ 12. per-element style overrides (G27 reversal) — allowlist, hybrid render, exclusion ═══
{
  const G = '11111111-1111-1111-1111-111111111111';
  const REF = () => ({ alt: 'A photo', variants: { w800: '/img/a-800.webp' }, width: 800, height: 600 });
  const F = (style) => ({ type: 'features', title: 'Why', items: [{ title: 'Fast' }], ...(style !== undefined ? { style } : {}) });

  // — validation: deny-by-default allowlist (the validateThemeTokens posture on a block) —
  const full = validateBlocks([F({ text_color: '#332211', bg_color: '#FAF6EE', accent: '#0a5a4a', font: 'display', size: 'xl', align: 'right', contrast_ack: true })])[0];
  ok('style: all seven allowlisted keys validate + store (hex normalized lowercase)',
    JSON.stringify(full.style) === JSON.stringify({ text_color: '#332211', bg_color: '#faf6ee', accent: '#0a5a4a', font: 'display', size: 'xl', align: 'right', contrast_ack: true }));
  ok('style: 3-hex and missing-# normalize via the normHex idiom', (() => {
    const st = validateBlocks([F({ text_color: '#ABC', bg_color: 'aabbcc' })])[0].style;
    return st.text_color === '#aabbcc' && st.bg_color === '#aabbcc';
  })());
  ok('style: junk keys + junk values are ALL dropped (no style key survives)', (() => {
    const b = validateBlocks([F({ text_color: '#gggggg', bg_color: 'red', accent: 'url(https://evil.example)', font: 'comic-sans', size: 'xxl', align: 'justify', margin: '40px', custom_css: '*{display:none}', contrast_ack: 'true' })])[0];
    return !('style' in b);
  })());
  ok('style: partial — only the valid keys survive (enum typo dropped beside a good hex)',
    JSON.stringify(validateBlocks([F({ text_color: '#123456', font: 'wingdings', size: 'l' })])[0].style) === JSON.stringify({ text_color: '#123456', size: 'l' }));
  ok('style: contrast_ack is strict-true only (the G18 zoom posture)', (() => {
    const kept = validateBlocks([F({ contrast_ack: true })])[0];
    const dropped = validateBlocks([F({ contrast_ack: 'true' }), F({ contrast_ack: 1 })]);
    return kept.style.contrast_ack === true && dropped.every((b) => !('style' in b));
  })());
  ok('style: a non-object / absent style leaves the block untouched', !('style' in validateBlocks([F('loud')])[0]) && !('style' in validateBlocks([F(undefined)])[0]));

  // — precedence: style.bg_color and look.background are mutually exclusive (validated) —
  ok('style: bg_color wins — look.background dropped at validation, the rest of the look kept', (() => {
    const b = validateBlocks([{ ...F({ bg_color: '#111111' }), look: { background: 'accent', spacing: 'roomy' } }])[0];
    return b.style.bg_color === '#111111' && b.look && !('background' in b.look) && b.look.spacing === 'roomy';
  })());
  ok('style: bg_color vs an all-background look — the whole look key disappears (never an empty object)', (() => {
    const b = validateBlocks([{ ...F({ bg_color: '#111111' }), look: { background: 'dark' } }])[0];
    return !('look' in b) && b.style.bg_color === '#111111';
  })());
  ok('style: without bg_color the look band is untouched (colors compose with looks)', (() => {
    const b = validateBlocks([{ ...F({ text_color: '#ffffff' }), look: { background: 'dark' } }])[0];
    return b.look.background === 'dark' && b.style.text_color === '#ffffff';
  })());

  // — render: HYBRID — colors as scoped --ov-* custom properties, enumerations as classes —
  const styled = renderSiteBlocks(validateBlocks([F({ text_color: '#332211', bg_color: '#faf6ee', accent: '#0a5a4a', font: 'body', size: 's', align: 'center' })]), ctx)[0].html;
  ok('style: the section carries every ov-* class', styled.includes('ov-ink') && styled.includes('ov-bg') && styled.includes('ov-accent') && styled.includes('ov-font-body') && styled.includes('ov-size-s') && styled.includes('ov-align-center'));
  ok('style: colors ride ONE style attribute in fixed key order (ink, bg, accent, accent-dark)',
    styled.includes('style="--ov-ink:#332211;--ov-bg:#faf6ee;--ov-accent:#0a5a4a;--ov-accent-dark:'));
  ok('style: --ov-accent-dark is DERIVED deterministically (darken(accent,.16), the deriveBrandTokens step — never stored, never accepted from input)', (() => {
    const stored = validateBlocks([F({ accent: '#0a5a4a', accent_dark: '#ff0000' })])[0].style;   // forged input key is dropped
    return styled.includes(`--ov-accent-dark:${darken('#0a5a4a', 0.16)}`) && !('accent_dark' in stored);
  })());
  ok('style: contrast_ack renders NOTHING (byte-identical with or without the ack)', (() => {
    const withAck = renderSiteBlocks(validateBlocks([F({ text_color: '#111111', contrast_ack: true })]), ctx)[0].html;
    const noAck = renderSiteBlocks(validateBlocks([F({ text_color: '#111111' })]), ctx)[0].html;
    return withAck === noAck && !withAck.includes('ack');
  })());
  ok('style: color-only → no enum class; enum-only → classes but NO style attribute', (() => {
    const colorOnly = renderSiteBlocks(validateBlocks([F({ accent: '#0a5a4a' })]), ctx)[0].html;
    const enumOnly = renderSiteBlocks(validateBlocks([F({ size: 'l', align: 'left' })]), ctx)[0].html;
    return colorOnly.includes('ov-accent') && !colorOnly.includes('ov-size') && !colorOnly.includes('ov-font') && !colorOnly.includes('ov-align')
      && enumOnly.includes('ov-size-l') && enumOnly.includes('ov-align-left') && !enumOnly.includes('--ov-') && !enumOnly.includes('style="');
  })());

  // — absent-identity: no style ⇒ byte-identical output (golden-provable) —
  const defHtml = renderSiteBlocks(validateBlocks([F(undefined)]), ctx)[0].html;
  ok('style: absent → byte-identical (no ov- class, no --ov- var, no style attr, page structure unchanged)',
    !defHtml.includes('ov-') && !defHtml.includes('--ov-') && !defHtml.includes('style="') && defHtml.includes('class="block wrap block-features"'));
  ok('style: an all-junk style renders byte-identical to no style at all',
    renderSiteBlocks(validateBlocks([F({ background: 'tinted', color: 'red', padding: '4px' })]), ctx)[0].html === defHtml);
  ok('style: render-twice determinism (same input → identical output)', (() => {
    const mk = () => JSON.stringify(renderSiteBlocks(validateBlocks([F({ text_color: '#101010', accent: '#0a5a4a', size: 'xl' })]), ctx));
    return mk() === mk();
  })());

  // — hostile: values can't escape the style attribute (validated-shape-only printer) —
  ok('style: hostile values are dropped, never printed (the attr stays hex-only)', (() => {
    const r = renderSiteBlocks(validateBlocks([F({ text_color: '#111111"><script>alert(1)</script>', bg_color: 'expression(alert(1))', accent: '#123456;background:url(//evil.example)' })]), ctx)[0].html;
    return !r.includes('--ov-') && !/<script>alert|url\(|expression\(/.test(r);
  })());

  // — carries: resolveBlockMedia rebuild + linked-section per-placement override —
  ok('style: survives resolveBlockMedia (media-block rebuild carries it, like look/variant)', (() => {
    const r = resolveBlockMedia(validateBlocks([{ type: 'image', image_id: G, style: { text_color: '#222222', size: 'l' } }]), REF)[0];
    return JSON.stringify(r.style) === JSON.stringify({ text_color: '#222222', size: 'l' });
  })());
  ok('style: a linked placement rides the payload style through — and can override it per-placement', (() => {
    const payload = { type: 'features', items: [{ title: 'A' }], style: { accent: '#0a5a4a' } };
    const lookup = () => payload;
    const ridden = resolveLinkedBlocks([{ type: 'linked', ref: G }], lookup)[0];
    const overridden = resolveLinkedBlocks([{ type: 'linked', ref: G, style: { accent: '#aa1100' } }], lookup)[0];
    return ridden.style.accent === '#0a5a4a' && overridden.style.accent === '#aa1100';
  })());

  // — server-side contrast recomputation: warn + record, NEVER hard-block —
  ok('style: a failing un-acked pair still VALIDATES + STORES, and emits a warning', (() => {
    const blocks = validateBlocks([F({ text_color: '#cccccc', bg_color: '#ffffff' })]);
    const w = styleContrastWarnings(blocks);
    return blocks.length === 1 && !!blocks[0].style && w.length === 1 && w[0].ratio < 4.5 && w[0].acknowledged === false && w[0].type === 'features' && w[0].index === 0;
  })());
  ok('style: an acked failing pair still reports, flagged acknowledged (the "kept" wording)', (() => {
    const w = styleContrastWarnings(validateBlocks([F({ text_color: '#cccccc', bg_color: '#ffffff', contrast_ack: true })]));
    return w.length === 1 && w[0].acknowledged === true;
  })());
  ok('style: a passing pair / a single color emits no warning',
    styleContrastWarnings(validateBlocks([F({ text_color: '#111111', bg_color: '#ffffff' }), F({ text_color: '#cccccc' })])).length === 0);
  ok('style: warning math IS brand_kit.contrastRatio (server + editor client port can never disagree)',
    styleContrastWarnings(validateBlocks([F({ text_color: '#777777', bg_color: '#888888' })]))[0].ratio === Math.round(contrastRatio('#777777', '#888888') * 10) / 10);

  // — BLOCK_CSS: every rule is static (one CSS churn); classes/vars are the only per-block surface —
  ok('style CSS: static ov-* rules shipped once in BLOCK_CSS', BLOCK_CSS.includes('.block.ov-ink{color:var(--ov-ink)}')
    && BLOCK_CSS.includes('.block.ov-bg{background:var(--ov-bg)') && BLOCK_CSS.includes('.block.ov-accent{--accent:var(--ov-accent);--accent-dark:var(--ov-accent-dark,var(--ov-accent))}')
    && BLOCK_CSS.includes('.block.ov-font-display') && BLOCK_CSS.includes('.block.ov-font-body') && BLOCK_CSS.includes('.block.ov-size-xl{font-size:1.35em}') && BLOCK_CSS.includes('.block.ov-align-right{text-align:right}'));
  ok('style CSS: ink forces the same child-inheritance list the accent/dark bands use',
    /\.block\.ov-ink :is\(h1,h2,h3,h4,h5,p,li,dt,dd,figcaption,blockquote,strong,em,\.nm,\.pr,\.ds,\.stat-v,\.stat-l,summary\)\{color:inherit\}/.test(BLOCK_CSS));
  ok('style CSS: the size down-step is floored (body copy can never go unreadable)', BLOCK_CSS.includes('.block.ov-size-s{font-size:max(.92em,.95rem)}'));
  ok('style CSS: align keeps the guarded child-reset so structured content never turns ragged',
    BLOCK_CSS.includes('.block.ov-align-center .svc-grid') && BLOCK_CSS.includes('.block.ov-align-right .prose') && BLOCK_CSS.includes('.block.ov-align-right .btn-row,.block.ov-align-right .cta-inner{justify-content:flex-end}'));

  // — catalog: the shared field metadata agrees with the validator —
  ok('style: catalog BLOCK_STYLE_FIELDS matches the parseStyle allowlist (keys + enum options)', (() => {
    const keys = BLOCK_STYLE_FIELDS.map((f) => f.key);
    const enumOf = (k) => BLOCK_STYLE_FIELDS.find((f) => f.key === k).options.slice(1);   // first option = default, stored as absent
    return JSON.stringify(keys) === JSON.stringify(['text_color', 'bg_color', 'accent', 'font', 'size', 'align', 'contrast_ack'])
      && JSON.stringify(enumOf('font')) === JSON.stringify(['display', 'body'])
      && JSON.stringify(enumOf('size')) === JSON.stringify(['s', 'l', 'xl'])
      && JSON.stringify(enumOf('align')) === JSON.stringify(['left', 'center', 'right'])
      && BLOCK_STYLE_FIELDS.every((f) => f.type === 'color' || f.type === 'enum' || f.type === 'boolean');
  })());
}

// ═══ 13. freeform canvas (G25 reversal, slice 1) — fenced x/y, quantized/clamped, stack-ordered ═══
{
  const G = '11111111-1111-1111-1111-111111111111', H = '22222222-2222-2222-2222-222222222222', MISS = '99999999-9999-9999-9999-999999999999';
  const REF = (id) => id === MISS ? null : { alt: 'A photo', variants: { w400: '/img/a-400.webp', w800: '/img/a-800.webp', w1600: '/img/a-1600.webp' }, width: 800, height: 600 };
  const FF = (elements, extra = {}) => ({ type: 'freeform', elements, ...extra });
  const TXT = (body, xtra = {}) => ({ kind: 'text', x: 10, y: 10, w: 20, h: 10, text: { body }, ...xtra });

  // — validation: coordinates are quantized (0.5%), clamped, containment-clamped; junk drops the element —
  ok('freeform: coordinates quantize to 0.5% (12.34 → 12.5, 12.24 → 12) and clamp (x -5 → 0, y 1e9 → 100)', (() => {
    const b = validateBlocks([FF([
      { kind: 'text', x: 12.34, y: 12.24, w: 20, h: 10, text: { body: 'a' } },
      { kind: 'text', x: -5, y: '1e9', w: 20, h: 10, text: { body: 'b' } },
    ])])[0];
    const a = b.elements.find((e) => e.text.body === 'a'), c = b.elements.find((e) => e.text.body === 'b');
    return a.x === 12.5 && a.y === 12 && c.x === 0 && c.y === 100;
  })());
  ok('freeform: w/h floor at 4%, then the containment clamp wins (x=90,w=40 → w=10; y=95,h=30 → h=5)', (() => {
    const b = validateBlocks([FF([
      { kind: 'text', x: 90, y: 95, w: 40, h: 30, text: { body: 'a' } },
      { kind: 'text', x: 10, y: 10, w: 1, h: 2, text: { body: 'b' } },
    ])])[0];
    const a = b.elements.find((e) => e.text.body === 'a'), c = b.elements.find((e) => e.text.body === 'b');
    return a.w === 10 && a.h === 5 && c.w === 4 && c.h === 4;
  })());
  ok('freeform: a non-finite coordinate drops the WHOLE element (NaN, strings, objects — position is its substance)', (() => {
    const b = validateBlocks([FF([
      TXT('keep'),
      { kind: 'text', x: 'abc', y: 10, w: 20, h: 10, text: { body: 'dropX' } },
      { kind: 'text', x: 10, y: NaN, w: 20, h: 10, text: { body: 'dropY' } },
      { kind: 'text', x: 10, y: 10, w: {}, h: 10, text: { body: 'dropW' } },
      { kind: 'text', x: 10, y: 10, w: 20, text: { body: 'dropH' } },
    ])])[0];
    return b.elements.length === 1 && b.elements[0].text.body === 'keep';
  })());
  ok('freeform: unknown kinds drop — including "shape" (slice 2, not realized in slice 1)', (() => {
    const v = validateBlocks([FF([
      { kind: 'shape', x: 1, y: 1, w: 10, h: 10, shape: { shape: 'rect', fill: 'accent' } },
      { kind: 'columns', x: 1, y: 1, w: 10, h: 10 },
      TXT('only me'),
    ])]);
    return v.length === 1 && v[0].elements.length === 1 && v[0].elements[0].kind === 'text';
  })());
  ok('freeform: empty payloads drop (text w/o body, image w/o valid uuid, button missing label or url)', (() => {
    const v = validateBlocks([FF([
      { kind: 'text', x: 1, y: 1, w: 10, h: 10, text: { body: '   ' } },
      { kind: 'image', x: 1, y: 1, w: 10, h: 10, image: { image_id: 'not-a-uuid' } },
      { kind: 'button', x: 1, y: 1, w: 10, h: 10, button: { label: 'Go' } },
      { kind: 'button', x: 1, y: 1, w: 10, h: 10, button: { url: 'https://ex.com' } },
    ])]);
    return v.length === 0;   // nothing valid → the whole block drops (empty-item posture)
  })());
  ok('freeform: aspect is enumerated (banner/standard/tall); unknown or absent → standard', (() => {
    const v = validateBlocks([FF([TXT('a')], { aspect: 'banner' }), FF([TXT('b')], { aspect: 'cinema' }), FF([TXT('c')])]);
    return v[0].aspect === 'banner' && v[1].aspect === 'standard' && v[2].aspect === 'standard';
  })());
  ok('freeform: text size/align are enumerated steps; defaults store NO key; body capped at 800', (() => {
    const b = validateBlocks([FF([
      { kind: 'text', x: 1, y: 1, w: 10, h: 10, text: { body: 'x'.repeat(2000), size: 'xl', align: 'center' } },
      { kind: 'text', x: 1, y: 20, w: 10, h: 10, text: { body: 'plain', size: 'jumbo', align: 'left' } },
    ])])[0];
    const a = b.elements[0], c = b.elements[1];
    return a.text.body.length === 800 && a.text.size === 'xl' && a.text.align === 'center'
      && !('size' in c.text) && !('align' in c.text);
  })());
  ok('freeform: hide_on_phone is strict === true only (the G18 zoom posture)', (() => {
    const b = validateBlocks([FF([
      TXT('on', { hide_on_phone: true }), TXT('str', { hide_on_phone: 'yes' }), TXT('num', { hide_on_phone: 1 }),
    ])])[0];
    return b.elements.find((e) => e.text.body === 'on').hide_on_phone === true
      && b.elements.filter((e) => e.text.body !== 'on').every((e) => !('hide_on_phone' in e));
  })());

  // — caps: 12 elements per canvas, 4 canvases per page (Eric 2026-07-16) —
  ok('freeform: the 13th element is dropped (12 per canvas)', (() => {
    const b = validateBlocks([FF(Array.from({ length: 20 }, (_, i) => TXT(`t${i}`, { y: i })))])[0];
    return b.elements.length === 12;
  })());
  ok('freeform: the 5th canvas on a page is dropped (4 per page); other block types still validate after it', (() => {
    const v = validateBlocks([
      ...Array.from({ length: 6 }, (_, i) => FF([TXT(`c${i}`)], { id: `c${i}` })),
      { type: 'features', items: [{ title: 'still here' }] },
    ]);
    return v.filter((b) => b.type === 'freeform').length === 4 && v.some((b) => b.type === 'features');
  })());
  ok('freeform: an all-invalid canvas is dropped and does NOT consume a page slot', (() => {
    const v = validateBlocks([FF([{ kind: 'shape', x: 1, y: 1, w: 5, h: 5 }]), ...Array.from({ length: 4 }, (_, i) => FF([TXT(`k${i}`)], { id: `k${i}` }))]);
    return v.length === 4 && v.every((b) => b.type === 'freeform');
  })());

  // — z normalization + the reading-order invariant —
  ok('freeform: z normalizes to dense 1..N (gaps/dupes collapse; ties keep input order)', (() => {
    const b = validateBlocks([FF([
      TXT('first-tie', { y: 30, z: 7 }), TXT('second-tie', { y: 20, z: 7 }), TXT('top', { y: 10, z: 40 }), TXT('bottom', { y: 40 }),   // no z → 0 → lowest
    ])])[0];
    const zOf = (t) => b.elements.find((e) => e.text.body === t).z;
    return zOf('bottom') === 1 && zOf('first-tie') === 2 && zOf('second-tie') === 3 && zOf('top') === 4
      && JSON.stringify(b.elements.map((e) => e.z).sort((a, c) => a - c)) === '[1,2,3,4]';
  })());
  ok('freeform: elements are STORED sorted by (y, x) — DOM order = reading order, independent of z and authoring order', (() => {
    const els = [TXT('C', { y: 30, x: 10, z: 3 }), TXT('B', { y: 10, x: 50, z: 1 }), TXT('A', { y: 10, x: 20, z: 2 })];
    const b = validateBlocks([FF(els)])[0];
    return JSON.stringify(b.elements.map((e) => e.text.body)) === '["A","B","C"]';
  })());
  ok('freeform: shuffled input → byte-identical storage AND render (the reading-order invariant, end to end)', (() => {
    const els = [TXT('C', { id: 'c', y: 30, x: 10, z: 3 }), TXT('B', { id: 'b', y: 10, x: 50, z: 1 }), TXT('A', { id: 'a', y: 10, x: 20, z: 2 })];
    const one = validateBlocks([FF(els, { id: 'p' })]);
    const two = validateBlocks([FF([els[2], els[0], els[1]], { id: 'p' })]);
    return JSON.stringify(one) === JSON.stringify(two)
      && JSON.stringify(renderSiteBlocks(one, ctx)) === JSON.stringify(renderSiteBlocks(two, ctx));
  })());

  // — multi-instance + fences (NOT_IN_CELL both directions) —
  ok('freeform: multi-instance with de-collided slugId ids → per-instance render keys block_freeform_<id>', (() => {
    const v = validateBlocks([FF([TXT('a')], { id: 'Hero Promo!' }), FF([TXT('b')], { id: 'hero_promo' })]);
    const keys = renderSiteBlocks(v, ctx).map((r) => r.key);
    return v[0].id === 'hero_promo' && v[1].id !== v[0].id && keys[0] === 'block_freeform_hero_promo' && keys[1] !== keys[0] && keys.every((k) => k.startsWith('block_freeform_'));
  })());
  ok('freeform: never nests in a columns cell (NOT_IN_CELL) — and no block nests inside a canvas (curated kinds only)', (() => {
    const col = validateBlocks([{ type: 'columns', columns: [{ body: 'keep', block: FF([TXT('smuggled')]) }] }])[0];
    return col && !('block' in col.columns[0]) && col.columns[0].body === 'keep';
  })());

  // — resolution: the one media pipeline; unresolvable image → element dropped —
  ok('freeform: image elements resolve ids→MediaRef; an unresolvable image drops its element, others survive', (() => {
    const r = resolveBlockMedia(validateBlocks([FF([
      { kind: 'image', x: 1, y: 1, w: 20, h: 20, image: { image_id: G } },
      { kind: 'image', x: 1, y: 30, w: 20, h: 20, image: { image_id: MISS } },
      TXT('words', { y: 60 }),
    ])]), REF)[0];
    return r.elements.length === 2 && r.elements[0].image.image.variants.w800 === '/img/a-800.webp' && r.elements[1].text.body === 'words';
  })());
  ok('freeform: a canvas whose every element resolves to nothing is dropped (never an empty section)', resolveBlockMedia(validateBlocks([FF([{ kind: 'image', x: 1, y: 1, w: 20, h: 20, image: { image_id: MISS } }])]), REF).length === 0);
  ok('freeform: an element alt override folds into the resolved MediaRef; decorative renders alt="" + role="presentation"', (() => {
    const r = resolveBlockMedia(validateBlocks([FF([
      { kind: 'image', x: 1, y: 1, w: 20, h: 20, image: { image_id: G, alt: 'Storefront at dusk' } },
      { kind: 'image', x: 1, y: 50, w: 20, h: 20, image: { image_id: H, decorative: true } },
    ])]), REF);
    const html = renderSiteBlocks(r, ctx)[0].html;
    return r[0].elements[0].image.image.alt === 'Storefront at dusk' && html.includes('alt="Storefront at dusk"') && html.includes('alt="" role="presentation"');
  })());
  ok('freeform: the per-section look rides the resolve rebuild (tinted canvas section)', (() => {
    const r = resolveBlockMedia(validateBlocks([FF([{ kind: 'image', x: 1, y: 1, w: 20, h: 20, image: { image_id: G } }], { look: { background: 'tinted' } })]), REF);
    return r[0].look.background === 'tinted' && renderSiteBlocks(r, ctx)[0].html.includes('block--bg-tint');
  })());
  ok('freeform: a linked placement rides through resolveLinkedBlocks + validateBlocks untouched (no special-casing)', (() => {
    const payload = FF([TXT('Linked copy')], { id: 'promo' });
    const v = validateBlocks(resolveLinkedBlocks([{ type: 'linked', ref: G }], () => payload));
    return v.length === 1 && v[0].type === 'freeform' && v[0].elements[0].text.body === 'Linked copy';
  })());

  // — render: numbers-only inline styles through attr(); enumerated classes; zero JS —
  const rich = validateBlocks([FF([
    { id: 'headline', kind: 'text', x: 12.5, y: 10, w: 40, h: 22, z: 2, text: { body: 'Summer sale', size: 'xl', align: 'center' } },
    { id: 'pic', kind: 'image', x: 60, y: 5, w: 35, h: 80, z: 1, image: { image_id: G }, hide_on_phone: true },
    { id: 'cta', kind: 'button', x: 10, y: 70, w: 24, h: 12, z: 3, button: { label: 'Book now', url: 'https://ex.com/book', style: 'outline' } },
  ], { id: 'promo', title: 'Promo', aspect: 'banner' })]);
  const richHtml = renderSiteBlocks(resolveBlockMedia(rich, REF), ctx)[0].html;
  ok('freeform: section + canvas markup (block-freeform, ff-canvas ff-aspect-banner, h2 + anchor from the title)', richHtml.includes('<section id="promo" class="block wrap block-freeform"><h2>Promo</h2>') && richHtml.includes('<div class="ff-canvas ff-aspect-banner">'));
  ok('freeform: every element positions via a numbers-only style attr (fixed printer: 12.5 prints "12.5", integers bare)', richHtml.includes('style="left:12.5%;top:10%;width:40%;height:22%;z-index:2"') && richHtml.includes('style="left:60%;top:5%;width:35%;height:80%;z-index:1"') && richHtml.includes('style="left:10%;top:70%;width:24%;height:12%;z-index:3"'));
  ok('freeform: text renders enumerated classes (ff-size-xl, ff-align-center) with the body escaped via esc()', richHtml.includes('class="ff-el ff-text ff-size-xl ff-align-center"') && richHtml.includes('>Summer sale</div>'));
  ok('freeform: the image goes through blockImg (AVIF+WebP picture, lazy) with sizes derived from its clamped w', richHtml.includes('<div class="ff-el ff-image ff-hide-phone"') && richHtml.includes('<picture><source type="image/avif"') && richHtml.includes('sizes="(max-width:620px) 100vw, 35vw"') && richHtml.includes('loading="lazy"'));
  ok('freeform: the button is a real template .btn anchor via safeHref (+ btn-outline), rel=noopener', richHtml.includes('<a class="ff-el btn btn-outline" href="https://ex.com/book" rel="noopener"') && richHtml.includes('>Book now</a>'));
  ok('freeform: DOM order in the markup is the (y,x) reading order (image y5 → headline y10 → button y70), not z-order', (() => {
    const i1 = richHtml.indexOf('ff-image'), i2 = richHtml.indexOf('Summer sale'), i3 = richHtml.indexOf('Book now');
    return i1 > -1 && i1 < i2 && i2 < i3;
  })());
  ok('freeform: hide_on_phone marks ONLY its element (one ff-hide-phone class in the canvas)', (richHtml.match(/ff-hide-phone/g) || []).length === 1);
  ok('freeform: focal point rides into the canvas image (object-position via blockImg)', (() => {
    const FREF = () => ({ alt: 'F', variants: { w800: '/i/f-800.webp' }, width: 8, height: 6, focal: { x: 30, y: 70 } });
    const r = renderSiteBlocks(resolveBlockMedia(validateBlocks([FF([{ kind: 'image', x: 1, y: 1, w: 20, h: 20, image: { image_id: G } }])]), FREF), ctx)[0].html;
    return r.includes('object-position:30% 70%');
  })());
  ok('freeform: title is optional — untitled canvas renders no <h2> (title-optional anchor contract)', (() => {
    const r = renderSiteBlocks(validateBlocks([FF([TXT('no heading here')])]), ctx)[0].html;
    return !r.includes('<h2>') && r.includes('block-freeform');
  })());
  ok('freeform: zero JavaScript emitted (no <script>, no handlers)', !/<script|onclick=|onerror=/i.test(richHtml));
  ok('freeform: render-twice determinism (same input → identical output)', (() => {
    const mk = () => JSON.stringify(renderSiteBlocks(resolveBlockMedia(validateBlocks([FF([
      { id: 'a', kind: 'text', x: 12.5, y: 10, w: 40.5, h: 22, z: 2, text: { body: 'det' } },
      { id: 'b', kind: 'image', x: 60, y: 5, w: 35, h: 80, z: 1, image: { image_id: G } },
    ], { id: 'd' })]), REF), ctx));
    return mk() === mk();
  })());

  // — hostile: escaped text/labels; unsafe URLs dropped; numbers can't break the style attr —
  ok('freeform: hostile text/alt/label are escaped, never live markup', (() => {
    const r = renderSiteBlocks(resolveBlockMedia(validateBlocks([FF([
      { kind: 'text', x: 1, y: 1, w: 20, h: 10, text: { body: '<script>alert(1)</script>' } },
      { kind: 'image', x: 1, y: 20, w: 20, h: 20, image: { image_id: G, alt: '"><img src=x onerror=alert(1)>' } },
      { kind: 'button', x: 1, y: 50, w: 20, h: 10, button: { label: '<script>x</script>', url: 'https://ok.example' } },
    ])]), REF), ctx)[0].html;
    // no live injected tag; the alt payload survives ONLY in its fully-escaped form
    // (quote + angles neutralized, so the onerror can never leave the quoted attr)
    return !/<script>alert|<img\s+src=x/.test(r) && r.includes('&lt;script&gt;')
      && r.includes('alt="&quot;&gt;&lt;img src=x onerror=alert(1)&gt;"');
  })());
  ok('freeform: a javascript: button URL is refused by safeHref — the element simply does not render', (() => {
    const r = renderSiteBlocks(validateBlocks([FF([
      { kind: 'button', x: 1, y: 1, w: 20, h: 10, button: { label: 'Evil', url: 'javascript:alert(1)' } },
      TXT('survivor', { y: 50 }),
    ])]), ctx)[0].html;
    return !r.includes('javascript:') && !r.includes('Evil') && r.includes('survivor');
  })());
  ok('freeform: hostile "numbers" cannot reach the style attribute (injection strings are non-finite → element dropped)', (() => {
    const v = validateBlocks([FF([
      { kind: 'text', x: '12;background:url(//evil.example)', y: 1, w: 20, h: 10, text: { body: 'inj' } },
      { kind: 'text', x: { toString: () => '1;url(//evil.example)' }, y: 1, w: 20, h: 10, text: { body: 'obj' } },
      TXT('clean'),
    ])]);
    const r = renderSiteBlocks(v, ctx)[0].html;
    return v[0].elements.length === 1 && !/url\(|evil\.example/.test(r) && [...r.matchAll(/style="([^"]*)"/g)].every((m) => /^left:[\d.]+%;top:[\d.]+%;width:[\d.]+%;height:[\d.]+%;z-index:\d+$/.test(m[1]));
  })());

  // — absent-block identity: a page without a canvas carries NO freeform markup (line-466 posture) —
  ok('freeform: absent → no ff- class / block-freeform anywhere; default sections byte-identical', (() => {
    const r = renderSiteBlocks(resolveBlockMedia(validateBlocks([
      { type: 'features', items: [{ title: 'A' }] }, { type: 'cta', text: 'Go' }, { type: 'gallery', image_ids: [G] },
    ]), REF), ctx);
    return r.every((b) => !/\bff-|block-freeform/.test(b.html)) && r[0].html.includes('class="block wrap block-features"');
  })());

  // — CSS + catalog contract —
  ok('freeform CSS: the 3 enumerated aspect presets + the fenced relative canvas', BLOCK_CSS.includes('.ff-canvas{position:relative') && BLOCK_CSS.includes('.ff-aspect-banner{aspect-ratio:3/1}') && BLOCK_CSS.includes('.ff-aspect-standard{aspect-ratio:2/1}') && BLOCK_CSS.includes('.ff-aspect-tall{aspect-ratio:4/3}'));
  ok('freeform CSS: text size steps are clamp()ed with hard floors (~15px minimum body copy)', BLOCK_CSS.includes('.ff-text{font-size:clamp(1rem,2vw,1.2rem)') && BLOCK_CSS.includes('.ff-text.ff-size-s{font-size:clamp(.95rem,1.6vw,1.05rem)}') && BLOCK_CSS.includes('.ff-text.ff-size-l{font-size:clamp(1.2rem,3vw,1.7rem)}') && BLOCK_CSS.includes('.ff-text.ff-size-xl{font-size:clamp(1.5rem,4.2vw,2.4rem)}'));
  ok('freeform CSS: ONE static rule flips the canvas to flow below 620px (stack in DOM order; !important beats inline w/h)', BLOCK_CSS.includes('@media(max-width:620px){.ff-canvas{aspect-ratio:auto}.ff-canvas .ff-el{position:static;width:auto!important;height:auto!important;margin:12px 0}'));
  ok('freeform CSS: hide-on-phone rule lives ONLY under the 620px query (the block--hide-mobile pattern)', (() => {
    const occurrences = BLOCK_CSS.split('.ff-hide-phone').length - 1;
    return occurrences === 1 && /@media\(max-width:620px\)\{[^\n]*\.ff-canvas \.ff-hide-phone\{display:none!important\}/.test(BLOCK_CSS);
  })());
  ok('freeform: catalog-declared AND realized; the catalog enums agree with the validator (aspects, kinds, 12-element cap)', (() => {
    const c = COMPONENTS.find((x) => x.key === 'freeform');
    const aspect = c && c.fields.find((f) => f.key === 'aspect'), kind = c && c.fields.find((f) => f.key === 'kind'), els = c && c.fields.find((f) => f.key === 'elements');
    return !!c && REALIZED_BLOCK_TYPES.includes('freeform')
      && aspect && JSON.stringify(aspect.options) === JSON.stringify(['standard', 'banner', 'tall'])   // first = default, stored as 'standard'
      && kind && JSON.stringify(kind.options) === JSON.stringify(['text', 'image', 'button'])          // slice 1: no 'shape'
      && els && els.max === 12;
  })());
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ SITE BLOCKS: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
