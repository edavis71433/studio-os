// ── Phase T · vertical realization (FD-T4) — per-industry block presets ───────
//   deno run --allow-read --allow-env tests/presence/vertical_presets_test.mjs
// Proves each industry recommends the blocks that make it feel intentionally
// designed — over ONE engine + its vocabulary, no bespoke templates (Part 4).
import { suggestedBlocksFor, suggestionNoteFor } from '../../supabase/functions/presence/lib/vertical_presets.ts';
import { REALIZED_BLOCK_TYPES } from '../../supabase/functions/presence/lib/site_blocks.ts';
import { COMPONENTS } from '../../supabase/functions/presence/lib/site_components.ts';
import { allIndustryKeys } from '../../supabase/functions/presence/lib/industry_vocab.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}`); };
const has = (k, t) => suggestedBlocksFor(k).includes(t);

ok('home trades → proof of work + service areas (before_after, service_areas)', has('plumber', 'before_after') && has('plumber', 'service_areas') && has('hvac', 'process'));
ok('beauty → team + gallery + pricing', has('salon', 'team') && has('salon', 'gallery') && has('spa', 'pricing'));
ok('professional → team + process + certifications', has('law', 'team') && has('law', 'certifications') && has('accounting', 'process'));
ok('medical → team + certifications', has('dental', 'team') && has('dental', 'certifications'));
ok('retail → gallery', has('retail', 'gallery') && has('florist', 'gallery'));
ok('food → gallery (menu is already the core page)', has('restaurant', 'gallery') && has('coffee_shop', 'gallery'));
ok('fitness → pricing + team', has('fitness', 'pricing') && has('yoga', 'team'));
ok('community → stats + cta', has('nonprofit', 'stats') && has('church', 'cta'));
ok('generic / unknown → a safe baseline (features)', has('generic', 'features') && has('zzz-unknown', 'features') && has(null, 'features'));

ok('every suggested block is a REALIZED block type', allIndustryKeys().concat(['zzz']).every((k) => suggestedBlocksFor(k).every((b) => REALIZED_BLOCK_TYPES.includes(b))));
ok('every suggested block exists in the site_components catalog', allIndustryKeys().every((k) => suggestedBlocksFor(k).every((b) => COMPONENTS.some((c) => c.key === b))));
ok('suggestions are deduped', allIndustryKeys().every((k) => { const s = suggestedBlocksFor(k); return new Set(s).size === s.length; }));
ok('every industry gets at least two suggestions', allIndustryKeys().every((k) => suggestedBlocksFor(k).length >= 2));
ok('every industry has a plain-English note', allIndustryKeys().every((k) => suggestionNoteFor(k).length > 10));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ VERTICAL PRESETS: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
