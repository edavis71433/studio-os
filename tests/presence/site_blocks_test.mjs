// ── Phase T-BLOCKS · structured content block library — validation + render ──
//   deno run --allow-read --allow-env tests/presence/site_blocks_test.mjs
// Proves the configurable block library is production-safe: validation caps +
// coerces + dedupes; rendering is deterministic, escaped, JS-free, emits correct
// schema.org + a11y; the engine only realizes blocks the catalog declares; and the
// business-classic template surfaces them (and stays byte-stable with none).
import { validateBlocks, renderSiteBlocks, REALIZED_BLOCK_TYPES } from '../../supabase/functions/presence/lib/site_blocks.ts';
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

const passed = results.filter((r) => r.p).length;
console.log(`\n════ SITE BLOCKS: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
