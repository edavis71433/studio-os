// ── L3.2 Concierge × Optimization suite ─────────────────────────────────────
// The concierge must explain optimization moments like a trusted advisor: plain
// business language, the customer's part clear, guided fixes offered ("we
// prepare, you approve"), platform-owned work owned by us — and never a word of
// jargon or audit-speak.
//
//   deno run --allow-read tests/presence/concierge_optimization_test.mjs
import { answer } from '../../supabase/functions/presence/concierge/answer.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

// ── synthetic grounding: one optimization moment per kind ──
const rec = (rule, dims, benefit, over = {}) => ({
  hash: `h_${rule}`, rule: `rec_${rule}`, title: 't', description: 'd', reason: 'r',
  expected_benefit: benefit, estimated_effort: 'minutes', estimated_risk: 'none',
  undoability: 'versioned', action: 'update', timing: 'whenever', requires_ai: false,
  value_dimensions: dims, supporting_judgment_ids: [`j_${rule}`], ...over,
});
const moment = (id, rule, headline, summary, type = 'opportunity') => ({
  id, key: id, moment_type: type, headline, summary, tone: 'encouraging', supporting_recommendation_ids: [`h_${rule}`],
});
const G = {
  businessName: 'Marlow’s Kitchen',
  moments: [
    moment('m_photos', 'opt_photos', 'Your site could use some photographs.', 'A few real pictures help customers picture the place.'),
    moment('m_found', 'opt_foundations', 'Worth a look at your website’s foundations.', 'The behind-the-scenes pieces that keep your site and email working could be steadier.', 'needs_attention'),
    moment('m_speed', 'opt_speed', 'Your current website could load faster.', 'Your existing site takes longer than it needs to.'),
  ],
  recommendations: [
    rec('opt_photos', ['customer_experience', 'conversion'], 'customers can picture the business before they decide'),
    rec('opt_foundations', ['customer_trust', 'business_accuracy'], 'foundations stay sound so a site and its email are never quietly lost'),
    rec('opt_speed', ['performance'], 'faster pages that keep impatient visitors'),
  ],
  judgments: [
    { hash: 'j_opt_photos', rule: 'opt_photos', reasoning: 'no photographs', category: 'media', confidence: 1, evidence_ids: ['e1'] },
    { hash: 'j_opt_foundations', rule: 'opt_foundations', reasoning: 'foundations', category: 'operations', confidence: 0.9, evidence_ids: ['e2'] },
    { hash: 'j_opt_speed', rule: 'opt_speed', reasoning: 'slow', category: 'operations', confidence: 0.8, evidence_ids: ['e3'] },
  ],
  evidence: [
    { id: 'e1', type: 'media.imagery_none', human: 'The site has no photographs at all.', confidence: 1 },
    { id: 'e2', type: 'infrastructure.dmarc_missing', human: 'Email is easier to forge without protection.', confidence: 0.9 },
    { id: 'e3', type: 'performance.slow_response', human: 'The site took a while to start answering.', confidence: 0.8 },
  ],
};

const ask = (question, topicId) => answer({ question, topicId }, G);
const JARGON = /\b(SEO|schema|metadata|canonical|HTML|CSS|API|URL|DNS|CDN|DMARC|SPF|CAA|robots|sitemap|WCAG|ARIA|LCP|TTFB|score|grade|percent|audit)\b/i;

// ═══ 1. customer-owned task: clear, plain, points to the right place ═══
{
  const a = ask('how do I do this?', 'm_photos');
  ok('photos/how: points to the Photographs page in plain words', /photograph/i.test(a.text) && a.actions.some((x) => x.section === 'media'));
  const w = ask('what does this mean?', 'm_photos');
  ok('photos/what: explains in business terms', /customer/i.test(w.text) && !JARGON.test(w.text));
  const imp = ask('why does this matter?', 'm_photos');
  ok('photos/why: value in business language, no urgency', /customer|picture|visit/i.test(imp.text) && !JARGON.test(imp.text));
}

// ═══ 2. guided fix: "we prepare, you approve — nothing until you say yes" ═══
{
  const d = ask('can you just do it?', 'm_found');
  ok('foundations/do_it: offered as a guided fix (we prepare, you approve)', /prepare|approve|say yes/i.test(d.text) && !JARGON.test(d.text), d.text.slice(0, 90));
  const h = ask('how do I fix this?', 'm_found');
  ok('foundations/how: still guided, still plain (no DNS/DMARC talk)', /prepare|approve|say yes/i.test(h.text) && !JARGON.test(h.text));
  ok('foundations: an action points at Foundations', h.actions.some((x) => x.section === 'foundations'));
}

// ═══ 3. platform-owned: Studio OS handles it, not customer work ═══
{
  const h = ask('how do I fix this?', 'm_speed');
  ok('speed/how: framed as ours to handle, not the customer’s job', /handle|taken care/i.test(h.text) && !JARGON.test(h.text), h.text.slice(0, 90));
  const d = ask('can you do it?', 'm_speed');
  ok('speed/do_it: reassures it’s handled for them', /handle|taken care/i.test(d.text));
}

// ═══ 4. if-ignored is calm across all optimization moments ═══
{
  for (const id of ['m_photos', 'm_found', 'm_speed']) {
    const a = ask('what if I ignore it?', id);
    ok(`if-ignored (${id}): calm, no alarm, no jargon`, /nothing breaks|no rush|without nagging|hear about it/i.test(a.text) && !JARGON.test(a.text));
  }
}

// ═══ 5. blanket no-jargon sweep across every intent × moment ═══
{
  const intents = ['what does this mean', 'why do you recommend this', 'why does it matter', 'what if I ignore it', 'how do I fix it', 'what changes', 'please do it'];
  let dirty = [];
  for (const m of G.moments) for (const q of intents) {
    const t = ask(q, m.id).text;
    if (JARGON.test(t) || /!/.test(t)) dirty.push(`${m.id}/${q}`);
  }
  ok('no jargon, no audit words, no exclamation across every intent × optimization moment', dirty.length === 0, dirty.join(', '));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.log('FAILURES:'); for (const r of results) if (!r.p) console.log('  ✗ ' + r.n); }
