// ── Builder list item 97 (Nov 2026): every server error reply is a sentence ──
//   deno run --allow-read --allow-env tests/presence/error_sentences_test.mjs
// The shared reply helper adds a plain sentence to an error reply that names a
// code and nothing else; a route's own words win; success replies are untouched.
import { json, withSentence, ERROR_SENTENCES } from '../../supabase/functions/_shared/http.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}`); };
const body = async (r) => JSON.parse(await r.text());

ok('a bare not_found gets its sentence', withSentence({ error: 'not_found' }, 404).message === ERROR_SENTENCES.not_found);
ok('a bare bad_request gets its sentence', withSentence({ error: 'bad_request' }, 400).message === ERROR_SENTENCES.bad_request);
ok('a bare write_failed gets its sentence', withSentence({ error: 'write_failed' }, 502).message === ERROR_SENTENCES.write_failed);
ok('an unknown code still gets a sentence', /try again/.test(withSentence({ error: 'something_odd' }, 500).message));
ok('a route’s own message wins', withSentence({ error: 'not_found', message: 'That file isn’t here.' }, 404).message === 'That file isn’t here.');
ok('other fields stay', withSentence({ error: 'conflict', last_change: { a: 1 } }, 409).last_change.a === 1);
ok('a success payload is untouched', JSON.stringify(withSentence({ data: { ok: true } }, 200)) === '{"data":{"ok":true}}');
ok('a payload with no error code is untouched', JSON.stringify(withSentence({ data: null }, 500)) === '{"data":null}');
ok('an array or a string is untouched', Array.isArray(withSentence([1], 400)) && withSentence('x', 400) === 'x');
ok('every sentence starts with a capital and ends with a full stop', Object.values(ERROR_SENTENCES).every((s) => /^[A-Z]/.test(s) && /\.$/.test(s)));
ok('no sentence carries a code or a dash', Object.values(ERROR_SENTENCES).every((s) => !/[_—]/.test(s)));
const r = await body(json({ error: 'bad_json' }, 400, {}));
ok('json() applies it on the way out', r.error === 'bad_json' && r.message === ERROR_SENTENCES.bad_json);
const r2 = await body(json({ data: 1 }, 200, {}));
ok('json() leaves a success reply alone', r2.data === 1 && r2.message === undefined);

const passed = results.filter((x) => x.p).length;
console.log(`\n════ ERROR SENTENCES (item 97): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
