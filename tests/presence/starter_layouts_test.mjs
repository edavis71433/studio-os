// ── Phase T-STARTER · pre-arranged, pre-filled starter layouts ────────────────
//   deno run --allow-read --allow-env tests/presence/starter_layouts_test.mjs
// Proves every starter layout is a REAL, valid blocks array (re-validated through
// the actual validateBlocks() the save path uses — nothing dropped, capped or
// coerced), that its placeholder copy is non-empty + within the block caps, that
// every industry family has a starter, and that the recommended-blocks ordering
// (site_components industries[] + vertical presets) picks the right set per industry.
import {
  STARTER_LAYOUTS, listStarterLayouts, starterLayoutFor, starterKeyFor,
} from '../../supabase/functions/presence/lib/starter_layouts.ts';
import { validateBlocks, REALIZED_BLOCK_TYPES } from '../../supabase/functions/presence/lib/site_blocks.ts';
import { suggestedBlocksFor } from '../../supabase/functions/presence/lib/vertical_presets.ts';
import { componentsForIndustry } from '../../supabase/functions/presence/lib/site_components.ts';
import { allIndustryKeys } from '../../supabase/functions/presence/lib/industry_vocab.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}`); };
const realized = new Set(REALIZED_BLOCK_TYPES);

// The per-field length caps enforced by lib/site_blocks.ts, mirrored here so the
// copy walk asserts placeholder text is non-empty AND within the real bounds.
const CAP = { title: 80 };
function stringFieldsOf(b) {   // → [{ v, cap }] every human-authored string in a starter block
  const out = [];
  if (b.title !== undefined) out.push({ v: b.title, cap: CAP.title });
  switch (b.type) {
    case 'richtext': out.push({ v: b.body, cap: 4000 }); break;
    case 'features': b.items.forEach((it) => { out.push({ v: it.title, cap: 80 }); if (it.text !== undefined) out.push({ v: it.text, cap: 240 }); }); break;
    case 'cards': b.cards.forEach((c) => { out.push({ v: c.heading, cap: 80 }); if (c.text !== undefined) out.push({ v: c.text, cap: 240 }); }); break;
    case 'stats': b.items.forEach((it) => { out.push({ v: it.value, cap: 24 }, { v: it.label, cap: 60 }); }); break;
    case 'process': b.steps.forEach((st) => { out.push({ v: st.step, cap: 80 }); if (st.detail !== undefined) out.push({ v: st.detail, cap: 300 }); }); break;
    case 'accordion': b.items.forEach((it) => { out.push({ v: it.summary, cap: 120 }); if (it.body !== undefined) out.push({ v: it.body, cap: 1500 }); }); break;
    case 'pricing': b.tiers.forEach((tr) => { out.push({ v: tr.name, cap: 60 }); if (tr.price_text !== undefined) out.push({ v: tr.price_text, cap: 40 }); (tr.features || []).forEach((f) => out.push({ v: f, cap: 100 })); }); break;
    case 'cta': out.push({ v: b.text, cap: 160 }); break;
  }
  return out;
}

// ═══ 1. structure ═══
{
  ok('there are starter layouts', STARTER_LAYOUTS.length >= 5 && listStarterLayouts() === STARTER_LAYOUTS);
  ok('every layout has a unique key', new Set(STARTER_LAYOUTS.map((l) => l.key)).size === STARTER_LAYOUTS.length);
  ok('every layout has a name + a description', STARTER_LAYOUTS.every((l) => l.name.trim().length > 2 && l.description.trim().length > 10));
  ok('every layout is a real sequence (>= 4 sections)', STARTER_LAYOUTS.every((l) => Array.isArray(l.blocks) && l.blocks.length >= 4));
  ok('every starter block is a REALIZED block type', STARTER_LAYOUTS.every((l) => l.blocks.every((b) => realized.has(b.type))));
}

// ═══ 2. VALIDITY — re-validate through the real save-path validator ═══
// If validateBlocks drops, caps, trims, coerces or reorders anything, this fails —
// so it simultaneously proves: nothing malformed, copy within caps, order preserved.
{
  for (const l of STARTER_LAYOUTS) {
    const validated = validateBlocks(l.blocks);
    ok(`"${l.key}" survives validateBlocks unchanged (byte-for-byte)`, JSON.stringify(validated) === JSON.stringify(l.blocks));
    ok(`"${l.key}" loses no sections in validation`, validated.length === l.blocks.length);
  }
  // A one-per-type collision would silently drop a section — assert none repeat
  // (columns/cards are the only MULTI types; starters use at most one each).
  for (const l of STARTER_LAYOUTS) {
    const nonMulti = l.blocks.map((b) => b.type).filter((t) => t !== 'columns' && t !== 'cards' && t !== 'form');
    ok(`"${l.key}" has no duplicate one-per-type section`, new Set(nonMulti).size === nonMulti.length);
    const ids = l.blocks.filter((b) => b.id).map((b) => b.id);
    ok(`"${l.key}" MULTI ids are unique`, new Set(ids).size === ids.length);
  }
}

// ═══ 3. COPY — guiding placeholder text, non-empty + within caps ═══
{
  let allNonEmpty = true, allWithinCap = true, sawGuiding = false;
  for (const l of STARTER_LAYOUTS) {
    for (const b of l.blocks) {
      for (const { v, cap } of stringFieldsOf(b)) {
        if (typeof v !== 'string' || v.trim().length === 0) allNonEmpty = false;
        if (typeof v === 'string' && v.length > cap) allWithinCap = false;
        if (typeof v === 'string' && /add|tell|describe|list|name a|your|write|pick/i.test(v)) sawGuiding = true;
      }
    }
  }
  ok('all placeholder copy is non-empty', allNonEmpty);
  ok('all placeholder copy is within its block cap', allWithinCap);
  ok('placeholder copy actually guides the owner (edit prompts, not lorem ipsum)', sawGuiding);
}

// ═══ 4. COVERAGE — every industry family has a starter ═══
{
  const keys = new Set(STARTER_LAYOUTS.map((l) => l.key));
  ok('the five families exist', ['generic', 'services_business', 'restaurant', 'retail', 'wellness'].every((k) => keys.has(k)));
  // Every real industry key resolves to an actual layout (never a dangling key).
  ok('every industry key resolves to a real starter layout', allIndustryKeys().concat(['zzz-unknown']).every((k) => {
    const l = starterLayoutFor(k); return l && keys.has(l.key) && keys.has(starterKeyFor(k));
  }));
  ok('unknown / null industry falls back to generic', starterKeyFor('nope') === 'generic' && starterKeyFor(null) === 'generic' && starterKeyFor(undefined) === 'generic');
  // The families are actually USED — each starter is the recommendation for some industry.
  const used = new Set(allIndustryKeys().map((k) => starterKeyFor(k)));
  ok('services_business is recommended for trades + pros', starterKeyFor('plumber') === 'services_business' && starterKeyFor('law') === 'services_business');
  ok('restaurant → food, retail → shops, wellness → salon/clinic/gym', starterKeyFor('restaurant') === 'restaurant' && starterKeyFor('boutique') === 'retail' && starterKeyFor('salon') === 'wellness' && starterKeyFor('dental') === 'wellness' && starterKeyFor('gym') === 'wellness');
  ok('at least four distinct families are actually recommended in practice', used.size >= 4);
}

// ═══ 5. RECOMMENDED-BLOCKS ORDERING — the right set, recommended-first ═══
// Mirrors the server order build (routes/content.ts): vertical-preset suggestions
// lead, then site_components industries[] relevance — realized-only, deduped.
function orderFor(industry) {
  const order = [];
  const push = (t) => { if (realized.has(t) && !order.includes(t)) order.push(t); };
  suggestedBlocksFor(industry).forEach(push);
  componentsForIndustry(industry).forEach((c) => push(c.key));
  return order;
}
{
  ok('order is realized-only + deduped for every industry', allIndustryKeys().every((k) => { const o = orderFor(k); return new Set(o).size === o.length && o.every((t) => realized.has(t)); }));
  ok('order leads with the vertical-preset recommendation', ['plumber', 'restaurant', 'salon', 'law', 'generic'].every((k) => orderFor(k)[0] === suggestedBlocksFor(k)[0]));
  ok('site_components industries[] genuinely widens the order (more than presets alone)', orderFor('plumber').length > suggestedBlocksFor('plumber').length);
  // The set is INDUSTRY-RIGHT: trades lead with proof-of-work, food leads with gallery,
  // beauty leads with booking + team — the "fewer, righter choices first" promise.
  ok('trades recommend proof of work first', orderFor('plumber')[0] === 'before_after');
  ok('food leads with gallery, beauty leads with appointment', orderFor('restaurant')[0] === 'gallery' && orderFor('salon')[0] === 'appointment');
  ok('nothing is hidden — order never exceeds the realized library', allIndustryKeys().every((k) => orderFor(k).length <= REALIZED_BLOCK_TYPES.length));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ STARTER LAYOUTS: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
