// ── The builder asks in its own dialog, not the browser's confirm() (list item 33) ──
//   deno run --allow-read tests/presence/ask_yes_test.mjs
// The browser's box can't be styled, reads like a system warning, shows the site's address over
// the question on a phone, and stops the whole page while it's up. 22 questions in the builder
// used it. They ask through askYes now; the page keeps running while one is up, so the places
// that picked something out before asking look it up again after.
const ROOT = new URL('../../', import.meta.url);
const html = Deno.readTextFileSync(new URL('presence.html', ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const code = html.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
ok('no question uses the browser’s confirm()', !/(?<![\w.])confirm\(/.test(code));
ok('…nor alert() or prompt()', !/(?<![\w.])(alert|prompt)\(/.test(code));
const asks = (code.match(/(?<![\w.])askYes\(/g) || []).length;
ok('the 22 questions ask through askYes', asks >= 23, String(asks));   // 22 questions and its definition
ok('Escape answers no, and the main button yes', /dlg\.addEventListener\("cancel", \(e\) => \{ e\.preventDefault\(\); finish\(false\); \}\)/.test(html) && /form\.addEventListener\("submit", \(e\) => \{ e\.preventDefault\(\); finish\(true\); \}\)/.test(html));
ok('a risky question starts on Cancel', /\(opts\.danger \? cancel : ok\)\.focus\(\)/.test(html));
ok('the question keeps its line breaks and is the dialog’s name', /white-space:pre-line/.test(html) && /dlg\.setAttribute\("aria-labelledby", msg\.id\)/.test(html));
ok('every delete, remove, replace or take-offline question is marked danger', ['"Delete page"', '"Delete"', '"Remove"', '"Remove form"', '"Replace it"', '"Take it offline"', '"Clear the page"'].every((label) => new RegExp('ok: ' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ', danger: true').test(html)));
{
  // the page runs on while a question is up
  ok('a save that comes along during the contrast question shares its answer', /if \(!OV_ACK_ASKING\) OV_ACK_ASKING = askYes\(/.test(html) && /if \(BLOCKS_SAVING\) \{ blocksSaveSoon\(\); return true; \}   \/\/ a save that shared the question went first/.test(html));
  ok('…and reads the list again before marking it', /ovContrastFailing\(\)\.failing\.forEach\(/.test(html));
  ok('a section delete finds its section again after the question', /bi = BLOCKS_WORK\.indexOf\(b\); if \(bi < 0\) return;/.test(html));
  ok('a column change checks its section is still there', /if \(BLOCKS_WORK\.indexOf\(b\) < 0\) return;   \/\/ gone while the question was up/.test(html));
  ok('a saved section replaces the one there now, not the one there before', /const now = BLOCKS_WORK\.findIndex\(\(b\) => b\.type === block\.type\);/.test(html));
  ok('a form is removed by itself, not by its old place in the list', /const f = FORMS_WORK\[fi\]; if \(await askYes\("Remove this form\?"/.test(html) && /const at = FORMS_WORK\.indexOf\(f\); if \(at >= 0\) FORMS_WORK\.splice\(at, 1\);/.test(html));
}
ok('the offline question names the button the panels show (item 111’s finding)', !html.includes('Bring my site back online') && html.includes('(or “Bring back online”) restores everything'));

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) Deno.exit(1);
