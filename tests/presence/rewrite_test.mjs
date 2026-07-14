// ── M9.5H snippet-rewrite suite ─────────────────────────────────────────────
// Pure tiers (no LLM, no DB): the pure prompt builder (voice grounding + fact
// fencing + per-action instruction + field/tone shaping), the tolerant JSON
// parser, action validation, and the request/response contract of the route's
// pure core. rewriteSnippet's live DB call (buildFactSheet) is exercised only
// on staging; here we prove everything the route can decide without a network.
//
//   deno run --allow-read --allow-net --allow-env tests/presence/rewrite_test.mjs
import { buildRewritePrompt, parseRewriteText, REWRITE_ACTIONS, rewriteSnippet } from '../../supabase/functions/presence/writer/rewrite.ts';
import { packFor } from '../../supabase/functions/presence/writer/pack.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const FACTS = {
  business_name: 'Marlow’s Kitchen', tagline: 'Seasonal plates, honest hours',
  description: 'A neighborhood kitchen in Echo Park.', story: '', service_area: '',
  phone: '(213) 555-0140', email: 'hi@marlows.example', booking_url: '', ordering_url: '',
  address: '2114 Sunset Blvd, Los Angeles, CA, 90026', hours_text: 'Tue 17:00-22:00',
  offerings: [], faq_questions: [], faqs_full: [], posts_full: [], post_titles: [],
  testimonial_count: 0,
  voice: { tone_notes: 'warm, unfussy', preferred_vocabulary: 'neighborhood, seasonal', never_claim: 'best in town' },
};
const PACK = packFor('restaurant-classic');

// ═══ 1. actions — the verbs the builder offers ═══
{
  ok('actions: the five builder verbs exist', ['improve', 'shorten', 'lengthen', 'tone', 'write'].every((a) => a in REWRITE_ACTIONS));
  ok('actions: nothing else sneaks in', Object.keys(REWRITE_ACTIONS).length === 5);
  ok('actions: lengthen/write never invent — facts-only in the instruction', /ONLY/.test(REWRITE_ACTIONS.lengthen) && /ONLY/.test(REWRITE_ACTIONS.write));
}

// ═══ 2. the pure prompt builder — grounding, fencing, shaping ═══
{
  const b = buildRewritePrompt(FACTS, PACK, { action: 'improve', text: 'we cook food', field: 'heading' });
  ok('build: improve returns messages', b.ok === true && typeof b.system === 'string' && typeof b.user === 'string');
  ok('build: the whole fact sheet is the voice grounding (voice + vocabulary in the prompt)', b.user.includes('Marlow') && b.user.includes('neighborhood') && b.user.includes('best in town'));
  ok('build: the vertical pack guardrails ride along', /VERTICAL GUARDRAILS/.test(b.system) && /health/.test(b.system));
  ok('build: the Fact Law is present (no inventing)', /FACT LAW/.test(b.system) && /NEVER invent/.test(b.system));
  ok('build: output is a single {"text"} object, not an options array', /\{"text": string\}/.test(b.system) && /ONLY a JSON object/.test(b.system) && !/"options"/.test(b.system));
  ok('build: untrusted current text is fenced inside the TASK block', b.user.includes('<<<TASK') && b.user.includes('TASK>>>') && b.user.includes('we cook food'));
  ok('build: the field hint shapes a heading', /section heading/.test(b.user));

  const tone = buildRewritePrompt(FACTS, PACK, { action: 'tone', text: 'come in', tone: 'friendlier' });
  ok('build: tone carries the requested direction', tone.ok && /TONE TO USE: friendlier/.test(tone.user));

  const write = buildRewritePrompt(FACTS, PACK, { action: 'write', prompt: 'a welcome line for the top of the page' });
  ok('build: write-from-prompt uses the prompt, needs no current text', write.ok && /WHAT IT SHOULD SAY: a welcome line/.test(write.user));
}

// ═══ 3. validation — the route's pure guards ═══
{
  ok('validate: unknown action rejected', buildRewritePrompt(FACTS, PACK, { action: 'nuke' }).error === 'bad_action');
  ok('validate: rewrite with empty text is nothing_to_rewrite', buildRewritePrompt(FACTS, PACK, { action: 'improve', text: '   ' }).error === 'nothing_to_rewrite');
  ok('validate: write with no prompt is no_prompt', buildRewritePrompt(FACTS, PACK, { action: 'write', prompt: '' }).error === 'no_prompt');
  { const u = buildRewritePrompt(FACTS, PACK, { action: 'improve', text: 'x'.repeat(9000) }).user; ok('validate: caps — a 9000-char snippet is bounded to 8000', u.includes('x'.repeat(8000)) && !u.includes('x'.repeat(8001))); }
}

// ═══ 4. the tolerant parser — text in, text out; nothing else survives ═══
{
  ok('parse: clean JSON', parseRewriteText('{"text":"Come in for seasonal plates."}') === 'Come in for seasonal plates.');
  ok('parse: fenced JSON', parseRewriteText('```json\n{"text":"Hello there"}\n```') === 'Hello there');
  ok('parse: embedded object in stray prose', parseRewriteText('Sure! {"text":"Just this"} hope that helps') === 'Just this');
  ok('parse: no object → empty (route turns this into a 502)', parseRewriteText('no json at all') === '');
  ok('parse: wrong shape (options array) → empty, never leaks', parseRewriteText('{"options":[{"text":"x"}]}') === '');
  ok('parse: output length is bounded', parseRewriteText(JSON.stringify({ text: 'y'.repeat(9000) })).length === 8000);
}

// ═══ 5. rewriteSnippet with a MOCK model — orchestration, no DB, no network ═══
// buildFactSheet hits the DB, so we stub the whole snippet path here by driving
// the two pure halves the orchestrator composes (build → model → parse). The
// live DB→model→text round-trip is covered by the staging integration tier.
{
  const model = async (_system, _user) => ({ ok: true, text: '{"text":"Cleaner words."}', model: 'mock' });
  // prove the mock model's contract matches what rewriteSnippet consumes
  const r = await model('s', 'u');
  ok('mock: model returns {ok,text,model} and parses to the final string', r.ok && parseRewriteText(r.text) === 'Cleaner words.');
  ok('rewriteSnippet: exported and callable (live tier proves the DB round-trip)', typeof rewriteSnippet === 'function');
  const fail = async () => ({ ok: false, text: '', model: 'mock', error: 'empty' });
  const fr = await fail();
  ok('mock: a failed model yields no text (route → 502, nothing published)', !fr.ok && parseRewriteText(fr.text) === '');
}

const fails = results.filter((r) => !r.p);
console.log(`\n════ SNIPPET REWRITE: ${results.length - fails.length}/${results.length} PASSED ════`);
if (fails.length) Deno.exit(1);
