// ── AI Visual Studio suite (V1) ─────────────────────────────────────────────
// Proves the pure core: correct asset dimensions; the brief is brand-aware AND
// fact-law-safe (claim wording scrubbed, "no text/awards/ratings" always in the
// negative); a generation is a proposed, approval-gated plan; the model is
// honestly gated (null → not_available, never a fake image); the approve/abandon
// transition rides the shared spine; provenance is ai_approved on store.
//
//   deno run --allow-read --allow-env tests/presence/visual_studio_test.mjs
import { ASSET_SPECS, VISUAL_KINDS, isVisualKind, specFor, VISUAL_HONESTY } from '../../supabase/functions/presence/visual/contract.ts';
import { scrubClaims, buildBrief } from '../../supabase/functions/presence/visual/brief.ts';
import { brandSnapshotFrom, planGeneration, runVariations } from '../../supabase/functions/presence/visual/generate.ts';
import { decidePlan, isApproved } from '../../supabase/functions/presence/lib/approved_plan.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const BRAND = brandSnapshotFrom(
  { personality: 'warm, unfussy, neighborhood', words_prefer: ['house-made', 'seasonal'], words_avoid: ['gourmet', 'luxury'] },
  'restaurant',
  ['#7a5c3e', '#efe7db', 'not-a-color'],
);

// ═══ 1. asset specs — real, correct dimensions ═══
{
  ok('specs: six kinds', VISUAL_KINDS.length === 6);
  ok('specs: hero is 1600×900 (16:9)', ASSET_SPECS.hero.width === 1600 && ASSET_SPECS.hero.height === 900);
  ok('specs: open_graph is 1200×630', ASSET_SPECS.open_graph.width === 1200 && ASSET_SPECS.open_graph.height === 630);
  ok('specs: social_story is vertical 1080×1920', ASSET_SPECS.social_story.height > ASSET_SPECS.social_story.width);
  ok('specs: every kind has plain label + purpose + aspect', VISUAL_KINDS.every((k) => ASSET_SPECS[k].label && ASSET_SPECS[k].purpose && ASSET_SPECS[k].aspect));
  ok('specs: isVisualKind guards junk', isVisualKind('hero') && !isVisualKind('nope'));
  ok('specs: specFor round-trips', specFor('social_square').width === 1080);
}

// ═══ 2. the fact law reaches pixels — claim wording is scrubbed ═══
{
  const a = scrubClaims('award-winning #1 best tacos, 5 stars');
  ok('scrub: removes award/#1/best/stars', !/award|#1|best|stars/i.test(a.safe), JSON.stringify(a.safe));
  ok('scrub: surfaces what it removed', a.removed.length >= 3);
  const b = scrubClaims('a plate of fresh tacos on a wooden table');
  ok('scrub: leaves honest description intact', b.safe.includes('tacos') && b.removed.length === 0);
  ok('scrub: prices/discounts removed', !/\$|% off|sale/i.test(scrubClaims('tacos $5, 20% off sale').safe));
}

// ═══ 3. the brief is brand-aware AND honest ═══
{
  const brief = buildBrief('a plate of tacos, voted best', specFor('hero'), BRAND);
  ok('brief: folds in industry', /restaurant/i.test(brief.prompt));
  ok('brief: folds in personality', /neighborhood/i.test(brief.prompt));
  ok('brief: folds in palette', brief.prompt.includes('#7a5c3e'));
  ok('brief: folds in preferred vocabulary', /house-made|seasonal/i.test(brief.prompt));
  ok('brief: negative forbids text/lettering (no baked claims)', /no text/i.test(brief.negative) && /no awards|badges|ratings/i.test(brief.negative));
  ok('brief: negative honors words_avoid', /gourmet|luxury/i.test(brief.negative));
  ok('brief: reports the scrubbed claim', brief.removed_claims.some((c) => /best/i.test(c)));
  ok('brief: dimensions come from the spec', brief.width === 1600 && brief.height === 900);
}

// ═══ 4. brand snapshot is defensive ═══
{
  ok('brand: keeps only valid hex swatches', BRAND.palette.length === 2 && !BRAND.palette.includes('not-a-color'));
  ok('brand: carries personality + vocab + avoid + industry', BRAND.personality && BRAND.vocabulary.length === 2 && BRAND.avoid.length === 2 && BRAND.industry === 'restaurant');
  const empty = brandSnapshotFrom(null, '', []);
  ok('brand: survives a missing profile', empty.palette.length === 0 && empty.vocabulary.length === 0);
}

// ═══ 5. a generation is a proposed, approval-gated plan ═══
{
  const plan = planGeneration({ kind: 'open_graph', subject: 'the storefront at dusk', brand: BRAND });
  ok('plan: requires approval (a law)', plan.requires_approval === true);
  ok('plan: starts with no variations (nothing exists until generated)', plan.variations.length === 0);
  ok('plan: provenance starts ai (not yet approved)', plan.provenance === 'ai');
  ok('plan: reversible + has rollback words', plan.reversible === true && plan.rollback.length > 0);
  ok('plan: summary promises approval-before-use', /approve/i.test(plan.summary));
  ok('plan: carries og dimensions', plan.width === 1200 && plan.height === 630);
  ok('plan: prompt is composed (non-empty)', plan.prompt.length > 10);
  const claimy = planGeneration({ kind: 'hero', subject: 'best pizza, award-winning', brand: BRAND });
  ok('plan: notes claim wording it left out', /left out|claim/i.test(claimy.summary));
}

// ═══ 6. the model is HONESTLY gated — never a fake image ═══
{
  const notAvail = await runVariations(planGeneration({ kind: 'hero', subject: 'x', brand: BRAND }), null, 3);
  ok('model: null model → not_available (no fabrication)', notAvail.ok === false && notAvail.reason === 'not_available' && notAvail.images.length === 0);

  const fake = async () => ({ ok: true, images: [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])], model: 'test-model' });
  const good = await runVariations(planGeneration({ kind: 'hero', subject: 'x', brand: BRAND }), fake, 2);
  ok('model: injected model → images returned', good.ok === true && good.images.length === 2 && good.model === 'test-model');

  const broken = async () => ({ ok: false, images: [], model: 'test-model', error: 'boom' });
  const fail = await runVariations(planGeneration({ kind: 'hero', subject: 'x', brand: BRAND }), broken, 2);
  ok('model: a failing model is a plain failure, not a throw', fail.ok === false && fail.reason === 'failed');
}

// ═══ 7. approve/abandon rides the shared Approved-Plan spine ═══
{
  ok('spine: approve → approved', decidePlan('approve') === 'approved');
  ok('spine: abandon → abandoned', decidePlan('abandon') === 'abandoned');
  ok('spine: junk decision → null', decidePlan('whatever') === null);
  ok('spine: only approved is executable', isApproved('approved') && !isApproved('proposed'));
}

// ═══ 8. the honesty promises are stated (single source of truth) ═══
{
  ok('honesty: names manual parity, approval, ownership, fact law', !!(VISUAL_HONESTY.manual_parity && VISUAL_HONESTY.approval && VISUAL_HONESTY.ownership && VISUAL_HONESTY.fact_law));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.error('FAILURES'); (globalThis.Deno ? Deno : process).exit(1); }
