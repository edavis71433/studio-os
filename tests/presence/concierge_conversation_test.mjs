// ── L3.3 Concierge conversation intelligence suite ──────────────────────────
// The concierge must field the natural follow-up questions a business owner
// asks — can I wait, will anything break, how long, do I need to be technical,
// will this touch my email, can you do this, what should I do first, how
// important vs everything — deterministically, grounded, plain, no repetition.
//
//   deno run --allow-read tests/presence/concierge_conversation_test.mjs
import { answer, classifyIntent } from '../../supabase/functions/presence/concierge/answer.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const rec = (rule, dims, benefit) => ({
  hash: `h_${rule}`, rule: `rec_${rule}`, title: 't', description: 'd', reason: 'r',
  expected_benefit: benefit, estimated_effort: 'minutes', estimated_risk: 'none',
  undoability: 'versioned', action: 'update', timing: 'whenever', requires_ai: false,
  value_dimensions: dims, supporting_judgment_ids: [`j_${rule}`],
});
const moment = (id, rule, headline, type = 'opportunity') => ({ id, key: id, moment_type: type, headline, summary: `${headline} summary.`, tone: 'encouraging', supporting_recommendation_ids: [`h_${rule}`] });
const G = {
  businessName: 'Marlow’s Kitchen',
  moments: [
    moment('m_found', 'opt_foundations', 'Worth a look at your website’s foundations.', 'needs_attention'),
    moment('m_photos', 'opt_photos', 'Your site could use some photographs.'),
    moment('m_speed', 'opt_speed', 'Your current website could load faster.'),
  ],
  recommendations: [
    rec('opt_foundations', ['customer_trust', 'business_accuracy'], 'foundations stay sound so a site and its email are never quietly lost'),
    rec('opt_photos', ['customer_experience', 'conversion'], 'customers can picture the business before they decide'),
    rec('opt_speed', ['performance'], 'faster pages that keep impatient visitors'),
  ],
  judgments: [
    { hash: 'j_opt_foundations', rule: 'opt_foundations', reasoning: 'x', category: 'operations', confidence: 0.9, evidence_ids: ['e1'] },
    { hash: 'j_opt_photos', rule: 'opt_photos', reasoning: 'x', category: 'media', confidence: 1, evidence_ids: ['e2'] },
    { hash: 'j_opt_speed', rule: 'opt_speed', reasoning: 'x', category: 'operations', confidence: 0.8, evidence_ids: ['e3'] },
  ],
  evidence: [
    { id: 'e1', type: 'infrastructure.dmarc_missing', human: 'Email is easier to forge without protection.', confidence: 0.9 },
    { id: 'e2', type: 'media.imagery_none', human: 'No photographs at all.', confidence: 1 },
    { id: 'e3', type: 'performance.slow_response', human: 'The site took a while to answer.', confidence: 0.8 },
  ],
};
const ask = (q, topicId) => answer({ question: q, topicId }, G);
const JARGON = /\b(SEO|schema|metadata|canonical|HTML|CSS|API|URL|DNS|CDN|DMARC|SPF|CAA|robots|sitemap|WCAG|ARIA|LCP|TTFB|score|grade|percent|audit)\b/i;

// ═══ 1. classification: the owner's real phrasings land on the right intent ═══
{
  const cases = [
    ['can I wait on this?', 'can_wait'], ['is this urgent?', 'can_wait'],
    ['will anything break?', 'will_break'], ['is it safe?', 'will_break'],
    ['how long does this take?', 'how_long'],
    ['do I need to know anything technical?', 'need_technical'], ['is this over my head?', 'need_technical'],
    ['will this affect my email?', 'affects_email'],
    ['will this affect my website?', 'affects_site'],
    ['can Studio OS do this?', 'can_you_do'], ['can you handle this for me?', 'can_you_do'],
    ['what should I do first?', 'what_first'], ['where do I start?', 'what_first'],
    ['how important is this compared to everything?', 'how_important_relative'],
  ];
  const wrong = cases.filter(([q, want]) => classifyIntent(q) !== want);
  ok('classification: every follow-up phrasing lands on its intent', wrong.length === 0, wrong.map(([q, w]) => `"${q}"→${classifyIntent(q)}≠${w}`).join(', '));
  // and the existing intents still classify as before
  ok('classification: existing intents unchanged (matter/mean/ignore/changes/recommend)',
    classifyIntent('why does this matter?') === 'why_important' && classifyIntent('what does this mean?') === 'what_means' &&
    classifyIntent('what if I ignore it?') === 'if_ignored' && classifyIntent('what changes when I publish?') === 'what_changes' &&
    classifyIntent('why do you recommend this?') === 'why_recommend' && classifyIntent('how do I handle this?') === 'how_fix');
}

// ═══ 2. answers reinforce ownership, plainly ═══
{
  ok('can_wait: reassures waiting costs nothing', /you can|no rush|waiting costs/i.test(ask('can I wait?', 'm_photos').text));
  ok('will_break (customer): draft-safe, versioned, nothing breaks', /nothing.*break|draft|kept|come back/i.test(ask('will anything break?', 'm_photos').text));
  ok('will_break (guided): prepare/approve/undone, nothing until yes', /nothing breaks|approve|say yes|undone/i.test(ask('will anything break?', 'm_found').text));
  ok('how_long (customer): the customer’s small part', /minute|your part/i.test(ask('how long?', 'm_photos').text));
  ok('how_long (platform): no time from the customer', /no time from you|our side/i.test(ask('how long does this take?', 'm_speed').text));
  ok('need_technical: reassuring no, plain words', /not at all|plain words/i.test(ask('do I need to know anything technical?', 'm_found').text));
  ok('affects_email (foundations): honest yes, but approval-gated', /email settings|until you say yes/i.test(ask('will this affect my email?', 'm_found').text));
  ok('affects_email (photos): honest no', /email is completely untouched|only about your website/i.test(ask('will this affect my email?', 'm_photos').text));
  ok('affects_site (customer): only what you publish', /only what you choose|once you publish|stays exactly/i.test(ask('will this affect my website?', 'm_photos').text));
  ok('can_you_do (platform): ours to handle', /handle|taken care/i.test(ask('can Studio OS do this?', 'm_speed').text));
  ok('can_you_do (guided): yes, we prepare, you approve', /prepare|approve|say yes/i.test(ask('can Studio OS do this?', 'm_found').text));
  ok('can_you_do (customer): yours, but pointed to the spot', /yours|point|spot|Photographs/i.test(ask('can you do this?', 'm_photos').text));
}

// ═══ 3. cross-moment prioritization ═══
{
  const first = ask('what should I do first?');   // no topic — reasons across all moments
  ok('what_first: names a concrete starting point (the top moment)', /start with .*foundations/i.test(first.text) && first.topic?.id === 'm_found');
  ok('what_first: says the rest can follow in any order (no pressure)', /any order|none is waiting/i.test(first.text));
  const relTop = ask('how important is this compared to everything?', 'm_found');
  ok('how_important_relative (top): "look at first", but no emergency', /look at first/i.test(relTop.text) && /not an emergency|steady/i.test(relTop.text));
  const relLow = ask('how important is this compared to everything?', 'm_speed');
  ok('how_important_relative (lower): honestly a touch behind, still not urgent', /ahead of this|not.*urgent|steady/i.test(relLow.text));
}

// ═══ 4. a real multi-turn conversation: no repetition, no contradiction, no jargon ═══
{
  const turns = ['what does this mean?', 'why does it matter?', 'why now?', 'can I wait?', 'what happens if I ignore it?', 'can Studio OS do this?', 'will anything break?', 'will this affect my email?', 'how long does it take?', 'do I need to know anything technical?'];
  const answers = turns.map((q) => ask(q, 'm_found').text);
  ok('conversation: ten follow-ups on one moment give ten DISTINCT answers (no repetition)', new Set(answers).size === answers.length, `${new Set(answers).size}/${answers.length} distinct`);
  ok('conversation: no jargon or audit words anywhere in the thread', answers.every((t) => !JARGON.test(t)));
  ok('conversation: no exclamation, no “AI/chatbot” persona, one calm host', answers.every((t) => !/!|as an ai|i am an ai|chatbot|language model/i.test(t)));
  // no contradiction: the guided moment never tells the owner to paste a record AND that it's hands-off
  const guidedText = answers.join(' ');
  ok('conversation: guided fix stays consistent (we prepare + you approve; never “go edit DNS”)', /prepare/i.test(guidedText) && /approve|say yes/i.test(guidedText) && !JARGON.test(guidedText));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.log('FAILURES:'); for (const r of results) if (!r.p) console.log('  ✗ ' + r.n); }
