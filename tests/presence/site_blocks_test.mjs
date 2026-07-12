// ── Phase T-BLOCKS · structured content block library — validation + render ──
//   deno run --allow-read --allow-env tests/presence/site_blocks_test.mjs
// Proves the configurable block library is production-safe: validation caps +
// coerces + dedupes; rendering is deterministic, escaped, JS-free, emits correct
// schema.org + a11y; the engine only realizes blocks the catalog declares; and the
// business-classic template surfaces them (and stays byte-stable with none).
import { validateBlocks, resolveBlockMedia, renderSiteBlocks, REALIZED_BLOCK_TYPES } from '../../supabase/functions/presence/lib/site_blocks.ts';
import { COMPONENTS } from '../../supabase/functions/presence/lib/site_components.ts';
import { esc, attr, safeHref } from '../../supabase/functions/presence/lib/markdown.ts';
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
  ok('one instance per type (first kept)', validateBlocks([{ type: 'stats', items: [{ value: '10', label: 'Years' }] }, { type: 'stats', items: [{ value: '99', label: 'Other' }] }]).length === 1);
  const capped = validateBlocks([{ type: 'features', items: Array.from({ length: 40 }, (_, i) => ({ title: `f${i}` })) }])[0];
  ok('per-block item cap enforced (features ≤ 8)', capped.items.length === 8);
  const strs = validateBlocks([{ type: 'cta', text: '  hi   there  ', button: 'x'.repeat(200) }])[0];
  ok('strings trimmed + length-capped', strs.text === 'hi there' && strs.button.length <= 40);
  ok('total blocks capped at 12', validateBlocks(Array.from({ length: 30 }, (_, i) => ({ type: REALIZED_BLOCK_TYPES[i % REALIZED_BLOCK_TYPES.length], items: [{ title: 'a', value: '1', label: 'x', name: 'n' }], members: [{ name: 'n' }], steps: [{ step: 's' }], tiers: [{ name: 't' }], areas: ['a'], text: 't' }))).length <= 12);
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

const passed = results.filter((r) => r.p).length;
console.log(`\n════ SITE BLOCKS: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
