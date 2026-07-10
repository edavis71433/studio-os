// ── Surveys & Support — pure logic (P2-D-4) ──────────────────────────────────
//   deno run --allow-read tests/presence/intake_test.mjs
import {
  isSurveyStatus, normalizeQuestions, normalizeAnswers,
  isSupportStatus, canSupportTransition, isSupportPriority,
} from '../../supabase/functions/presence/lib/intake.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };

// surveys
ok('isSurveyStatus guards the enum', isSurveyStatus('active') && !isSurveyStatus('paused'));
const q = normalizeQuestions([{ label: 'How did we do?', type: 'rating' }, { label: 'Any comments?' }]);
ok('questions: normalized with slugged unique keys + default text type', q.ok && q.questions.length === 2 && q.questions[0].type === 'rating' && q.questions[1].type === 'text' && /^[a-z0-9_]+$/.test(q.questions[0].key));
ok('questions: empty set refused', !normalizeQuestions([]).ok && !normalizeQuestions('x').ok);
ok('questions: a labelless question is refused', !normalizeQuestions([{ type: 'text' }]).ok);
ok('questions: a choice question requires choices', !normalizeQuestions([{ label: 'Pick', type: 'choice' }]).ok && normalizeQuestions([{ label: 'Pick', type: 'choice', choices: ['a', 'b'] }]).ok);
ok('questions: duplicate keys are de-collided', (() => { const r = normalizeQuestions([{ key: 'x', label: 'A' }, { key: 'x', label: 'B' }]); return r.ok && r.questions[0].key !== r.questions[1].key; })());
ok('questions: capped at 30', !normalizeQuestions(Array.from({ length: 31 }, (_, i) => ({ label: `q${i}` }))).ok);
const ans = normalizeAnswers({ how_did_we_do: '5', stray: 'ignored' }, q.questions.length ? [{ key: 'how_did_we_do' }] : []);
ok('answers: restricted to known keys (stray dropped)', ans.ok && ans.answers.how_did_we_do === '5' && !('stray' in ans.answers));
ok('answers: empty answers refused', !normalizeAnswers({}, [{ key: 'a' }]).ok && !normalizeAnswers(null, [{ key: 'a' }]).ok);

// support
ok('isSupportStatus guards the enum', isSupportStatus('open') && isSupportStatus('resolved') && !isSupportStatus('spam'));
ok('support: open→in_progress→resolved allowed', canSupportTransition('open', 'in_progress') && canSupportTransition('in_progress', 'resolved'));
ok('support: resolved→open (reopen) allowed', canSupportTransition('resolved', 'open'));
ok('support: closed→open (reopen) allowed', canSupportTransition('closed', 'open'));
ok('support: closed→resolved refused (must reopen first)', !canSupportTransition('closed', 'resolved'));
ok('support: same→same refused', !canSupportTransition('open', 'open'));
ok('isSupportPriority guards the enum', isSupportPriority('urgent') && isSupportPriority('low') && !isSupportPriority('critical'));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ INTAKE (P2-D-4 pure): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
