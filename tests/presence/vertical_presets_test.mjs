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
ok('booking-led verticals recommend the appointment block', has('salon', 'appointment') && has('dental', 'appointment') && has('gym', 'appointment') && has('law', 'appointment'));
ok('review-led verticals recommend the reviews badge', has('plumber', 'reviews') && has('restaurant', 'reviews') && has('retail', 'reviews') && has('generic', 'reviews'));
ok('beauty shows transformations (before_after)', has('salon', 'before_after') && has('spa', 'before_after'));
ok('retail + community recommend the partners strip', has('boutique', 'partners') && has('nonprofit', 'partners'));
ok('generic / unknown → a safe baseline (features)', has('generic', 'features') && has('zzz-unknown', 'features') && has(null, 'features'));

// r2 growth blocks — newsletter / social / events / map woven where they earn a place
ok('newsletter reaches most families', has('salon', 'newsletter') && has('gym', 'newsletter') && has('law', 'newsletter') && has('boutique', 'newsletter') && has('restaurant', 'newsletter') && has('nonprofit', 'newsletter') && has('generic', 'newsletter'));
ok('social links reach every family', ['plumber', 'salon', 'gym', 'law', 'dental', 'retail', 'restaurant', 'nonprofit', 'generic', 'photography'].every((k) => has(k, 'social')));
ok('events → food / fitness / community / creative, not trades or law', has('restaurant', 'events') && has('gym', 'events') && has('church', 'events') && has('photography', 'events') && !has('plumber', 'events') && !has('law', 'events'));
ok('map → storefront families people travel to, not mobile trades', has('salon', 'map') && has('restaurant', 'map') && has('dental', 'map') && has('boutique', 'map') && !has('plumber', 'map'));
ok('creative studios lead with their work (gallery first)', suggestedBlocksFor('photography')[0] === 'gallery' && has('event_planning', 'gallery'));
ok('community leads with events', suggestedBlocksFor('nonprofit')[0] === 'events');

ok('every suggested block is a REALIZED block type', allIndustryKeys().concat(['zzz']).every((k) => suggestedBlocksFor(k).every((b) => REALIZED_BLOCK_TYPES.includes(b))));
ok('every suggested block exists in the site_components catalog', allIndustryKeys().every((k) => suggestedBlocksFor(k).every((b) => COMPONENTS.some((c) => c.key === b))));
ok('suggestions are deduped', allIndustryKeys().every((k) => { const s = suggestedBlocksFor(k); return new Set(s).size === s.length; }));
ok('every industry gets at least two suggestions', allIndustryKeys().every((k) => suggestedBlocksFor(k).length >= 2));
ok('every industry has a plain-English note', allIndustryKeys().every((k) => suggestionNoteFor(k).length > 10));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ VERTICAL PRESETS: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
