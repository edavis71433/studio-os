// ── Phase CP-1: starter kits suite ───────────────────────────────────────────
// Locks the two laws of reuse: (1) a kit carries STRUCTURE + HOUSE STYLE, never
// another business's facts (no identity, no testimonials, no posts, no media,
// no announcements/verification); (2) applying is FILL-ONLY-EMPTY — it can never
// overwrite or delete existing work.
//   deno run --allow-read --allow-env tests/presence/kits_test.mjs
import { buildKitPayload, applyPlan } from '../../supabase/functions/presence/lib/kits.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };

// ═══ 1. building: what a kit contains — and pointedly does NOT ═══
{
  const kit = buildKitPayload({
    industry_key: 'plumber', template_slug: 'business-classic',
    category_order: ['Emergency', 'Repairs'],
    offerings: [{ name: 'Drain cleaning', category: 'Repairs', description: 'Fast and tidy.', price_text: 'from $99', sort_order: 1 }],
    faqs: [{ question: 'Are you licensed?', answer: 'Fully licensed and insured.', sort_order: 0 }],
    voice: { tone_notes: 'Plain, friendly.', preferred_vocabulary: 'tidy, honest', never_claim: 'cheapest' },
    theme_tokens: { accent: '#2f5d8a', accent_dark: '#224566' },
  });
  ok('carries structure: offerings/faqs/voice/tokens/industry/template/order', kit.offerings.length === 1 && kit.faqs.length === 1 && kit.voice.tone_notes.length > 0 && kit.theme_tokens.accent === '#2f5d8a' && kit.industry_key === 'plumber' && kit.template_slug === 'business-classic' && kit.category_order.length === 2);
  const keys = JSON.stringify(kit);
  ok('carries NO business facts by construction (no name/email/phone/story/social keys exist in the shape)', !keys.includes('business_name') && !keys.includes('"email"') && !keys.includes('"phone"') && !keys.includes('"story"') && !keys.includes('social'));
  ok('carries NO testimonials/posts/media (the shape has no place for them)', !('testimonials' in kit) && !('posts' in kit) && !('media' in kit));
}

// ═══ 2. sanitization + caps ═══
{
  const big = buildKitPayload({
    offerings: Array.from({ length: 100 }, (_, i) => ({ name: `S${i}`, category: 'X' })),
    faqs: Array.from({ length: 50 }, (_, i) => ({ question: `Q${i}`, answer: 'A' })),
  });
  ok('caps: ≤60 offerings, ≤30 faqs', big.offerings.length === 60 && big.faqs.length === 30);
  const dirty = buildKitPayload({ offerings: [{ name: 'okname', category: '' }] });
  ok('control chars stripped, empty category defaulted', dirty.offerings[0].name === 'okname' && dirty.offerings[0].category === 'General');
  ok('nameless offerings dropped', buildKitPayload({ offerings: [{ name: '', category: 'X' }] }).offerings.length === 0);
}

// ═══ 3. applying: FILL-ONLY-EMPTY (the no-data-loss law) ═══
{
  const kit = buildKitPayload({
    industry_key: 'salon', offerings: [{ name: 'Cut', category: 'Hair' }], faqs: [{ question: 'Q', answer: 'A' }],
    voice: { tone_notes: 'Warm.' }, theme_tokens: { accent: '#5b3fa0' }, category_order: ['Hair'],
  });
  const fresh = applyPlan(kit, { offerings_count: 0, faqs_count: 0, has_voice: false, has_tokens: false, industry_key: 'generic', category_order_count: 0 });
  ok('fresh site: everything applies', fresh.insert_offerings.length === 1 && fresh.insert_faqs.length === 1 && !!fresh.set_voice && !!fresh.set_tokens && fresh.set_industry === 'salon' && fresh.set_category_order?.length === 1 && fresh.skipped.length === 0);
  const busy = applyPlan(kit, { offerings_count: 5, faqs_count: 3, has_voice: true, has_tokens: true, industry_key: 'plumber', category_order_count: 2 });
  ok('busy site: NOTHING applies — never overwrites', busy.insert_offerings.length === 0 && busy.insert_faqs.length === 0 && busy.set_voice === null && busy.set_tokens === null && busy.set_industry === null && busy.set_category_order === null);
  ok('busy site: every skip is REPORTED honestly', busy.skipped.length === 4 && busy.skipped.some((s) => s.includes('never overwritten')));
  const partial = applyPlan(kit, { offerings_count: 0, faqs_count: 3, has_voice: false, has_tokens: true, industry_key: 'generic', category_order_count: 0 });
  ok('partial site: fills only the empty sections', partial.insert_offerings.length === 1 && partial.insert_faqs.length === 0 && !!partial.set_voice && partial.set_tokens === null && partial.set_industry === 'salon');
  ok('existing industry never replaced (plumber stays plumber)', applyPlan(kit, { offerings_count: 0, faqs_count: 0, has_voice: false, has_tokens: false, industry_key: 'plumber', category_order_count: 0 }).set_industry === null);
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.error('FAILURES'); Deno.exit(1); }
