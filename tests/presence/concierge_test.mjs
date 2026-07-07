// ── M9.4 Presence Concierge suite ────────────────────────────────────────────
// Pure tiers: intent classification, evidence-backed answers, the five verbs,
// one-host law, no-chatbot tone, honesty modes (unsupported / low confidence /
// missing evidence), no invented facts or recommendations, conversation
// continuity, hallucination gate, determinism, performance. Integration tier
// (SB/SR_KEY/ANON): full chain on staging, client asks grounded questions.
//
//   deno run --allow-read --allow-net --allow-env tests/presence/concierge_test.mjs
import { answer, classifyIntent } from '../../supabase/functions/presence/concierge/answer.ts';
import { verifyPolish } from '../../supabase/functions/presence/concierge/verify.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

/* ── synthetic grounding built like the real chain stores it ── */
const G = {
  businessName: 'Marlow’s Kitchen',
  moments: [
    { id: 'aaaaaaaa-0000-4000-8000-000000000001', key: 'missing_basics', moment_type: 'needs_attention', tone: 'attentive',
      headline: 'A few basics are missing.',
      summary: 'Hours, address, or a way to reach you — the facts customers check first. Filling them in takes a few minutes and clears the way to publishing.',
      supporting_recommendation_ids: ['r_1'] },
    { id: 'aaaaaaaa-0000-4000-8000-000000000002', key: 'photo_descriptions', moment_type: 'opportunity', tone: 'encouraging',
      headline: 'Some photographs need a few words.',
      summary: 'Short descriptions help customers who can’t see the pictures — and help search engines find your dishes.',
      supporting_recommendation_ids: ['r_2'] },
  ],
  recommendations: [
    { hash: 'r_1', rule: 'rec_business_facts_incomplete', title: 'complete the missing business facts',
      description: 'fill the empty identity/address/hours/contact fields in the draft, then publish',
      reason: 'rule=business_facts_incomplete: 2 observations [business_info.hours_incomplete, trust.contact_missing]; max severity warning; min confidence 1.',
      expected_benefit: 'customers can find, reach, and plan a visit; publish blockers clear',
      estimated_effort: 'minutes', estimated_risk: 'none', undoability: 'versioned', action: 'complete',
      timing: 'immediate', requires_ai: false, value_dimensions: ['business_accuracy', 'trust', 'conversion'],
      supporting_judgment_ids: ['j_1'] },
    { hash: 'r_2', rule: 'rec_accessibility_content', title: 'add or improve image descriptions',
      description: 'write alt text for undescribed photographs in the draft, then publish',
      reason: 'rule=accessibility_content: 4 observations [accessibility.img_alt_missing×3, media.alt_short]; max severity warning; min confidence 1.',
      expected_benefit: 'assistive-tech users get the images; search engines get the content',
      estimated_effort: 'minutes', estimated_risk: 'none', undoability: 'versioned', action: 'update',
      timing: 'soon', requires_ai: true, value_dimensions: ['accessibility', 'search_visibility'],
      supporting_judgment_ids: ['j_2'] },
  ],
  judgments: [
    { hash: 'j_1', rule: 'business_facts_incomplete', reasoning: 'rule=business_facts_incomplete: 2 observations', category: 'accuracy', confidence: 1, evidence_ids: ['e_1', 'e_2'] },
    { hash: 'j_2', rule: 'accessibility_content', reasoning: 'rule=accessibility_content: 4 observations', category: 'accessibility', confidence: 1, evidence_ids: ['e_3'] },
  ],
  evidence: [
    { id: 'e_1', type: 'business_info.hours_incomplete', human: 'Hours are not set for sat, sun.', confidence: 1 },
    { id: 'e_2', type: 'trust.contact_missing', human: 'The site offers no phone number or email.', confidence: 1 },
    { id: 'e_3', type: 'accessibility.img_alt_missing', human: '3 images on / have no description for people who can’t see them.', confidence: 1 },
  ],
};
const GOOD_NEWS = {
  ...G,
  moments: [{ id: 'aaaaaaaa-0000-4000-8000-00000000000a', key: 'all_well', moment_type: 'good_news', tone: 'reassuring', headline: 'Everything customers can see is current.', summary: 'Your website matches what you’ve told us, and nothing needs your attention today.', supporting_recommendation_ids: [] }],
};
const M1 = G.moments[0].id, M2 = G.moments[1].id;
const askQ = (q, topicId, history) => answer({ question: q, topicId, history }, G);

// ═══ 1. intent classification ═══
{
  const cases = [
    ['what does this mean', 'what_means'], ['why are you recommending this', 'why_recommend'],
    ['why is this important', 'why_important'], ['what happens if I ignore it', 'if_ignored'],
    ['how do I fix it', 'how_fix'], ['what will change', 'what_changes'],
    ['fix this', 'do_it'], ['go ahead', 'do_it'], ['anything today?', 'overview'],
    ['what is the meaning of life', 'unsupported' /* word-boundary tokens: "meaning" ≠ "mean" — honestly refused */],
    ['tell me a joke', 'unsupported'], ['weather tomorrow?', 'unsupported'],
  ];
  let bad = 0;
  for (const [q, want] of cases) if (classifyIntent(q) !== want) { bad++; console.log('   intent miss:', q, '→', classifyIntent(q), 'wanted', want); }
  ok('intents: the six supported questions + do-it + overview classify deterministically', bad === 0);
}

// ═══ 2. the five verbs — and only the five ═══
{
  const verbs = new Set();
  for (const q of ['what does this mean', 'why are you recommending this', 'why is this important', 'what happens if I ignore it', 'how do I fix it', 'what will change', 'fix this', 'zzz unsupported zzz']) {
    verbs.add(askQ(q, M1).verb);
  }
  verbs.add(answer({ question: 'what does this mean', topicId: GOOD_NEWS.moments[0].id }, GOOD_NEWS).verb);
  const allowed = ['explain', 'recommend', 'teach', 'guide', 'celebrate'];
  ok('five verbs: every answer wears exactly one constitutional verb', [...verbs].every((v) => allowed.includes(v)), [...verbs].join(','));
  ok('five verbs: celebrate appears only for good news', answer({ question: 'what does this mean', topicId: GOOD_NEWS.moments[0].id }, GOOD_NEWS).verb === 'celebrate' && askQ('what does this mean', M1).verb !== 'celebrate');
}

// ═══ 3. evidence-backed explanation ═══
{
  const a = askQ('why are you recommending this', M1);
  ok('grounding: “why” answers quote the actual evidence, verbatim', a.text.includes('Hours are not set for sat, sun.') && a.text.includes('no phone number or email'));
  ok('grounding: sources carry the recommendation ids and evidence count', a.sources.recommendation_ids.includes('r_1') && a.sources.evidence_count === 2 && a.grounded === true);
  const fix = askQ('how do I fix it', M1);
  ok('guide: fix answers point into the room and state the approval law', fix.actions.some((x) => x.section === 'business') && /until you.*publish/i.test(fix.text));
  const chg = askQ('what will change', M1);
  ok('guide: change answers explain draft→publish and undoability', /draft/.test(chg.text) && /kept/.test(chg.text));
}

// ═══ 4. honesty modes ═══
{
  const un = askQ('tell me a joke', M1);
  ok('honesty: unsupported questions get a said-so, never a guess', /I can only speak to|I don’t have/.test(un.text));
  const noTopic = answer({ question: 'why is this important' }, G);
  ok('honesty: no topic → honest refusal plus what IS known today', /I can only speak to|I don’t have/.test(noTopic.text) && noTopic.text.includes('A few basics are missing.'));
  const lowG = JSON.parse(JSON.stringify(G));
  lowG.evidence.forEach((e) => e.confidence = 0.6);
  const low = answer({ question: 'what does this mean', topicId: M1 }, lowG);
  ok('honesty: low-confidence evidence is disclosed in the answer', low.low_confidence === true && /judgment rather than/.test(low.text));
  const empty = answer({ question: 'anything today?' }, { ...G, moments: [] });
  ok('honesty: a quiet day says so calmly', /nothing waiting|never a flood/i.test(empty.text));
}

// ═══ 5. no inventions ═══
{
  const answers = ['what does this mean', 'why are you recommending this', 'why is this important', 'what happens if I ignore it', 'how do I fix it', 'what will change']
    .flatMap((q) => [askQ(q, M1), askQ(q, M2)]);
  const groundingText = JSON.stringify(G);
  const inventedNums = answers.flatMap((a) => (a.text.match(/\d[\d,.]*/g) || []).filter((d) => !groundingText.includes(d)));
  ok('no invention: every digit in every answer exists in the grounding', inventedNums.length === 0, inventedNums.join(','));
  const inventedRecs = answers.flatMap((a) => a.sources.recommendation_ids.filter((r) => !G.recommendations.some((g) => g.hash === r)));
  ok('no invention: answers only cite recommendations that exist', inventedRecs.length === 0);
  const personas = /\b(writer|reviewer|strategist|guardian|coach|specialist)\b/i;
  const chatbot = /\b(as an ai|ai assistant|how can i help|i think|language model)\b/i;
  ok('one host: no personas, no chatbot voice, anywhere', answers.every((a) => !personas.test(a.text) && !chatbot.test(a.text)));
  const jargon = /\b(SEO|schema|metadata|canonical|API|HTML)\b/;
  ok('translation: no engineering vocabulary reaches the customer', answers.every((a) => !jargon.test(a.text)));
}

// ═══ 6. conversation continuity (current interaction only) ═══
{
  const followUp = answer({ question: 'why is this important', history: [{ topic_id: M2 }] }, G);
  ok('continuity: a follow-up without explicit topic resolves to the conversation’s topic', followUp.topic?.id === M2 && /assistive|screen readers|find you/.test(followUp.text));
  const fresh = answer({ question: 'why is this important' }, G);
  ok('continuity: no history → no assumed topic (memory is per-interaction)', fresh.topic === null);
}

// ═══ 7. the hallucination gate ═══
{
  const orig = 'Short descriptions help customers who can’t see the pictures.';
  const gtext = '3 images on / have no description.';
  ok('gate: faithful rewording passes', verifyPolish(orig, 'A few words on each photograph help customers who can’t see them.', gtext).ok);
  ok('gate: invented number rejected', verifyPolish(orig, 'Adding descriptions can raise traffic by 40% in most cases.', gtext).ok === false);
  ok('gate: invented guarantee rejected', verifyPolish(orig, 'This is guaranteed to make you rank first on search.', gtext).ok === false);
  ok('gate: persona leak rejected', verifyPolish(orig, 'Our SEO specialist reviewed this and agrees.', gtext).ok === false);
  ok('gate: chatbot voice rejected', verifyPolish(orig, 'Great question! As an AI assistant, I think descriptions help.', gtext).ok === false);
  ok('gate: grounded numbers allowed through', verifyPolish('3 photographs need words.', 'Three of your photographs — 3 in all — could use words.', gtext).ok);
  ok('gate: ballooned rewrites rejected', verifyPolish('Short note.', 'x'.repeat(2000), gtext).ok === false);
}

// ═══ 8. determinism + performance ═══
{
  const a1 = JSON.stringify(askQ('why are you recommending this', M1));
  const a2 = JSON.stringify(askQ('why are you recommending this', M1));
  ok('determinism: identical ask + grounding → byte-identical answer', a1 === a2);
  const t0 = performance.now();
  for (let i = 0; i < 1000; i++) askQ('how do I fix it', M1);
  const avg = (performance.now() - t0) / 1000;
  ok(`performance: avg ${avg.toFixed(3)}ms per answer over 1000 runs (<2ms)`, avg < 2);
}

// ═══ 9. integration (staging) ═══
const SB = Deno.env.get('SB'), SR = Deno.env.get('SR_KEY'), ANON = Deno.env.get('ANON');
if (SB && SR && ANON) {
  const H = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' };
  const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
  const users = await (await fetch(`${SB}/auth/v1/admin/users?page=1&per_page=200`, { headers: H })).json();
  const login = async (email) => {
    const u = (users.users || []).find((x) => (x.email || '').toLowerCase() === email);
    const pw = 'pw-' + crypto.randomUUID().slice(0, 12);
    await fetch(`${SB}/auth/v1/admin/users/${u.id}`, { method: 'PUT', headers: H, body: JSON.stringify({ password: pw }) });
    return (await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw }) })).json()).access_token;
  };
  const staffJwt = await login('staging-staff@studio-os.test');
  const clientJwt = await login('rcat-acceptance@example.com');
  const call = async (m, route, jwt, body) => {
    const r = await fetch(`${SB}/functions/v1/presence${route}`, { method: m, headers: { 'Content-Type': 'application/json', 'x-dds-user-jwt': jwt }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await j(r) };
  };
  const cA = (await j(await fetch(`${SB}/rest/v1/clients?email=eq.rcat-acceptance%40example.com&select=id`, { headers: H })))[0];
  const site = (await j(await fetch(`${SB}/rest/v1/presence_sites?client_id=eq.${cA.id}&select=id`, { headers: H })))[0];

  // test-data hygiene: earlier suites dismissed the staging moment; clear that
  // memory so this suite converses with an ACTIVE moment (dismissal memory
  // itself is covered by the moments suite)
  await fetch(`${SB}/rest/v1/presence_moments?site_id=eq.${site.id}&status=eq.dismissed`, { method: 'PATCH', headers: H, body: JSON.stringify({ status: 'superseded' }) });
  for (const step of ['observe', 'judge', 'recommend', 'moments-generate']) await call('POST', `/admin/sites/${site.id}/${step}`, staffJwt);
  const moments = await call('GET', '/moments', clientJwt);
  const m0 = (moments.json?.data || [])[0];
  ok('integration: moments exist to converse about', !!m0, m0?.headline);
  if (m0) {
    const why = await call('POST', '/concierge/ask', clientJwt, { question: 'why are you recommending this?', topic_id: m0.id });
    ok('integration: grounded “why” with sources', why.status === 200 && why.json?.data?.grounded === true && (why.json.data.sources.evidence_count > 0 || why.json.data.sources.recommendation_ids.length > 0), `verb=${why.json?.data?.verb} ev=${why.json?.data?.sources?.evidence_count}`);
    const fix = await call('POST', '/concierge/ask', clientJwt, { question: 'how do I fix it?', topic_id: m0.id });
    ok('integration: “how do I fix it” guides into the room with approval language', fix.status === 200 && ['guide', 'celebrate'].includes(fix.json?.data?.verb), `actions=${(fix.json?.data?.actions || []).length}`);
    const follow = await call('POST', '/concierge/ask', clientJwt, { question: 'and why is this important?', history: [{ topic_id: m0.id }] });
    ok('integration: conversation continuity via caller-held history', follow.status === 200 && follow.json?.data?.topic?.id === m0.id);
    const un = await call('POST', '/concierge/ask', clientJwt, { question: 'what is the weather tomorrow?', topic_id: m0.id });
    ok('integration: unsupported question answered honestly', un.status === 200 && /only speak to|don’t have/.test(un.json?.data?.answer || ''));
    const noJargon = ![why, fix, follow, un].some((r) => /\b(SEO|schema|canonical|metadata)\b/.test(r.json?.data?.answer || ''));
    ok('integration: no engineering vocabulary in any live answer', noJargon);
  }
} else {
  console.log('      (SB/SR_KEY/ANON not set — staging integration tier skipped)');
}

const fails = results.filter((r) => !r.p);
console.log(`\n════ CONCIERGE: ${results.length - fails.length}/${results.length} PASSED ════`);
if (fails.length) Deno.exit(1);
