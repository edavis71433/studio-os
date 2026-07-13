// ── Media library: bulk actions + focal-aware social crops — pure cores ───────
// Bulk: request validation (whitelist, bounds, id hygiene), tag merge, and the
// site-scoping partition (a cross-site id is refused, never touched). Social: the
// ratios reuse the EXACT Visual Studio specs (visual/contract.ts), focal clamping,
// deterministic transform URLs, and focal-aware crop geometry. All pure — no I/O.
//   deno run --allow-read tests/presence/media_bulk_test.mjs
import {
  MAX_BULK_IDS, BULK_ACTIONS, isBulkAction, normalizeBulkRequest, mergeTag, partitionOwned,
} from '../../supabase/functions/presence/lib/dam.ts';
import {
  SOCIAL_CROPS, SOCIAL_CROP_KEYS, isSocialCropKey, clampFocal, objectPosition,
  socialTransform, socialTransformQuery, focalCropRect, socialCropList,
} from '../../supabase/functions/presence/lib/social_crops.ts';
import { ASSET_SPECS } from '../../supabase/functions/presence/visual/contract.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };

const U = (i) => `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`;   // valid v4-shaped uuids

// ═══ bulk: request validation ═══
{
  ok('actions are exactly the four batchable moves', BULK_ACTIONS.join() === 'tag,collection,archive,approve');
  ok('isBulkAction whitelists', isBulkAction('archive') && !isBulkAction('delete') && !isBulkAction('publish'));

  ok('unknown action refused', !normalizeBulkRequest({ action: 'nuke', ids: [U(1)] }).ok);
  ok('empty id list refused', !normalizeBulkRequest({ action: 'archive', ids: [] }).ok);
  ok('non-uuid ids dropped; empty result refused', !normalizeBulkRequest({ action: 'archive', ids: ['x', '../etc', '1'] }).ok);

  const dup = normalizeBulkRequest({ action: 'archive', ids: [U(1), U(1), U(2)] });
  ok('valid uuids kept + de-duplicated', dup.ok && dup.ids.length === 2);

  const over = normalizeBulkRequest({ action: 'archive', ids: Array.from({ length: MAX_BULK_IDS + 5 }, (_, i) => U(i)) });
  ok(`bounded at ${MAX_BULK_IDS} ids (too many refused)`, !over.ok && over.error === 'too_many');
  const atCap = normalizeBulkRequest({ action: 'archive', ids: Array.from({ length: MAX_BULK_IDS }, (_, i) => U(i)) });
  ok('exactly the cap is allowed', atCap.ok && atCap.ids.length === MAX_BULK_IDS);

  // tag action: parameter required + normalized (lowercased, trimmed, bounded)
  ok('tag action needs a tag', !normalizeBulkRequest({ action: 'tag', ids: [U(1)] }).ok);
  const tg = normalizeBulkRequest({ action: 'tag', ids: [U(1)], tag: '  Summer Sale  ' });
  ok('tag normalized: trimmed + lowercased', tg.ok && tg.tag === 'summer sale');
  const longTag = normalizeBulkRequest({ action: 'tag', ids: [U(1)], tag: 'z'.repeat(80) });
  ok('tag bounded to 40 chars (escaping/DoS guard)', longTag.ok && longTag.tag.length === 40);

  // collection action
  ok('collection action needs a collection', !normalizeBulkRequest({ action: 'collection', ids: [U(1)] }).ok);
  const col = normalizeBulkRequest({ action: 'collection', ids: [U(1)], collection: '  Brand assets  ' });
  ok('collection trimmed', col.ok && col.collection === 'Brand assets');
  const longCol = normalizeBulkRequest({ action: 'collection', ids: [U(1)], collection: 'c'.repeat(200) });
  ok('collection bounded to 80 chars', longCol.ok && longCol.collection.length === 80);

  // archive/approve take no parameter
  ok('archive needs no parameter', normalizeBulkRequest({ action: 'archive', ids: [U(1)] }).ok);
  ok('approve needs no parameter', normalizeBulkRequest({ action: 'approve', ids: [U(1)] }).ok);
}

// ═══ bulk: tag merge (same rules as the per-asset PATCH) ═══
{
  ok('adds a new tag', JSON.stringify(mergeTag(['a'], 'b')) === JSON.stringify(['a', 'b']));
  ok('already-present tag → null (no write)', mergeTag(['b'], 'b') === null && mergeTag(['B'], 'b') === null);
  ok('lowercases + de-dupes existing', JSON.stringify(mergeTag(['A', 'a'], 'c')) === JSON.stringify(['a', 'c']));
  ok('null/empty existing handled', JSON.stringify(mergeTag(null, 'x')) === JSON.stringify(['x']));
  const capped = mergeTag(Array.from({ length: 40 }, (_, i) => 't' + i), 'new');
  ok('capped at 40 tags', capped && capped.length === 40);
}

// ═══ bulk: site-scoping partition (cross-site ids refused) ═══
{
  const requested = [U(1), U(2), U(3)];
  const owned = [U(1), U(3)];                       // U(2) belongs to another site (not returned by the site-scoped load)
  const { present, missing } = partitionOwned(requested, owned);
  ok('owned ids kept for apply', present.join() === [U(1), U(3)].join());
  ok('foreign/cross-site id refused → missing (never touched)', missing.join() === U(2));
  const none = partitionOwned([U(9)], []);
  ok('no owned rows → everything missing', none.present.length === 0 && none.missing.length === 1);
}

// ═══ social: ratios reuse the EXACT Visual Studio specs ═══
{
  ok('four social crop keys', SOCIAL_CROP_KEYS.join() === 'square,portrait,story,og');
  ok('isSocialCropKey whitelists', isSocialCropKey('og') && !isSocialCropKey('hero'));
  ok('square = social_square (1080×1080, 1:1)', SOCIAL_CROPS.square.spec === ASSET_SPECS.social_square && ASSET_SPECS.social_square.width === 1080 && ASSET_SPECS.social_square.height === 1080);
  ok('portrait = social_portrait (1080×1350, 4:5)', SOCIAL_CROPS.portrait.spec === ASSET_SPECS.social_portrait && ASSET_SPECS.social_portrait.height === 1350);
  ok('story = social_story (1080×1920, 9:16)', SOCIAL_CROPS.story.spec === ASSET_SPECS.social_story && ASSET_SPECS.social_story.height === 1920);
  ok('og = open_graph (1200×630, 1.91:1)', SOCIAL_CROPS.og.spec === ASSET_SPECS.open_graph && ASSET_SPECS.open_graph.width === 1200 && ASSET_SPECS.open_graph.height === 630);
}

// ═══ social: focal clamping ═══
{
  ok('clamps below 0 and above 100', JSON.stringify(clampFocal(-10, 250)) === JSON.stringify({ x: 0, y: 100 }));
  ok('rounds fractional focal', JSON.stringify(clampFocal(33.6, 66.4)) === JSON.stringify({ x: 34, y: 66 }));
  ok('defaults to centre when absent/NaN', JSON.stringify(clampFocal(undefined, 'x')) === JSON.stringify({ x: 50, y: 50 }));
  ok('object-position is a css percentage pair', objectPosition({ x: 25, y: 75 }) === '25% 75%');
}

// ═══ social: deterministic, self-hosted transform URLs ═══
{
  const t = socialTransform(ASSET_SPECS.open_graph);
  ok('transform is a real cover crop (width + height)', t.width === 1200 && t.height === 630 && t.resize === 'cover' && t.format === 'webp');
  const q = socialTransformQuery(ASSET_SPECS.social_story);
  ok('query carries width, height, resize=cover', /width=1080/.test(q) && /height=1920/.test(q) && /resize=cover/.test(q));
  ok('query is url-safe + deterministic (no spaces, stable order)', !/\s/.test(q) && q === socialTransformQuery(ASSET_SPECS.social_story));
  ok('query begins with width then height (stable key order)', q.indexOf('width=') < q.indexOf('height=') && q.indexOf('height=') < q.indexOf('resize='));
}

// ═══ social: focal-aware crop geometry ═══
{
  // wide source (2000×1000), square target → crop the sides, full height kept
  const centre = focalCropRect(2000, 1000, 1080, 1080, { x: 50, y: 50 });
  ok('wide→square keeps full height, crops sides', centre.h === 1000 && centre.w === 1000);
  ok('square crop has 1:1 ratio', Math.abs(centre.w / centre.h - 1) < 0.01);
  ok('centre focal centres the crop', centre.x === 500);

  const left = focalCropRect(2000, 1000, 1080, 1080, { x: 0, y: 50 });
  ok('focal at left edge clamps crop to x=0', left.x === 0);
  const right = focalCropRect(2000, 1000, 1080, 1080, { x: 100, y: 50 });
  ok('focal at right edge clamps crop within source', right.x === 2000 - right.w && right.x + right.w <= 2000);

  // tall source (1000×2000), og target (1.91:1) → crop top/bottom, full width kept
  const og = focalCropRect(1000, 2000, 1200, 630, { x: 50, y: 20 });
  const ogCentre = focalCropRect(1000, 2000, 1200, 630, { x: 50, y: 50 });
  ok('tall→wide keeps full width, crops vertically', og.w === 1000 && og.h < 2000);
  ok('og crop matches ~1.91:1 ratio', Math.abs(og.w / og.h - (1200 / 630)) < 0.02);
  ok('high focal biases crop upward vs centre, stays within source', og.y < ogCentre.y && og.y >= 0);
  const low = focalCropRect(1000, 2000, 1200, 630, { x: 50, y: 100 });
  ok('low focal clamps crop to bottom edge', low.y === 2000 - low.h && low.y + low.h <= 2000);
}

// ═══ social: the per-asset crop list ═══
{
  const withDims = socialCropList({ x: 30, y: 40 }, { width: 2000, height: 1000 });
  ok('list has all four ratios', withDims.length === 4 && withDims.map((c) => c.key).join() === 'square,portrait,story,og');
  ok('each carries object_position + transform_query', withDims.every((c) => c.object_position === '30% 40%' && /resize=cover/.test(c.transform_query)));
  ok('crop geometry present when source dims known', withDims.every((c) => c.crop_rect && c.crop_rect.w > 0 && c.crop_rect.h > 0));
  const noDims = socialCropList({ x: 50, y: 50 });
  ok('crop geometry omitted when source dims unknown (honest)', noDims.every((c) => c.crop_rect === undefined));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ MEDIA BULK + SOCIAL CROPS: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
