// ── The builder asks in its own dialog, not the browser's confirm() (list item 33) ──
//   deno run --allow-read tests/presence/ask_yes_test.mjs
// The browser's box can't be styled, reads like a system warning, shows the site's address over
// the question on a phone, and stops the whole page while it's up. 22 questions in the builder
// used it. They ask through askYes now; the page keeps running while one is up, so the places
// that picked something out before asking look it up again after.
import { editorSource } from './editor_source.mjs';   // builder item 38: the editor is four files now
const ROOT = new URL('../../', import.meta.url);
const html = editorSource();
// builder item 101: the question itself is the shell's one (shell-kit.js ddsConfirm, styled in shell.css);
// the editor's askYes and askText hand their words to it
const kit = Deno.readTextFileSync(new URL('shell-kit.js', ROOT));
const shellCss = Deno.readTextFileSync(new URL('shell.css', ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const code = html.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
ok('no question uses the browser’s confirm()', !/(?<![\w.])confirm\(/.test(code));
ok('…nor alert() or prompt()', !/(?<![\w.])(alert|prompt)\(/.test(code));
ok('…not even as window.prompt() for a link the clipboard refused', !/window\.(alert|prompt|confirm)\(/.test(code));
{
  // askYes and askText, run: they hand their words to the shell's question and prompt
  const fn = (name) => { const m = new RegExp('function ' + name + '\\((?:message|title), opts\\) \\{[\\s\\S]*?\\n\\}').exec(html); return m ? new Function('window', m[0] + '; return ' + name + ';') : null; };
  const seen = [], win = { ddsConfirm: (o) => { seen.push(o); return o; }, ddsAsk: (o) => { seen.push(o); return o; } };
  const askYes = fn('askYes') && fn('askYes')(win), askText = fn('askText') && fn('askText')(win);
  const a = askYes && askYes('Delete the page “About”?\n\nIts sections go too.', { ok: 'Delete page', danger: true });
  ok('askYes asks with the shell’s question: the question as its title, what it means under it, line breaks kept', !!a && a.title === 'Delete the page “About”?' && a.text === 'Its sections go too.' && a.yes === 'Delete page' && a.no === 'Cancel' && a.danger === true);
  const b = askYes && askYes('Your draft has changes.\n\nReplace it?\nIt can’t be undone.', {});
  ok('…a first paragraph and the rest the same way; OK and not risky unless it says so', !!b && b.title === 'Your draft has changes.' && b.text === 'Replace it?\nIt can’t be undone.' && b.yes === 'OK' && b.danger === false);
  const c = askText && askText('Change preview password', { password: true, ok: 'Update', hint: 'Leave blank to remove the password.' });
  ok('askText asks with the shell’s prompt: empty is an answer, a password stays masked, a long link fits', !!c && c.title === 'Change preview password' && c.text === 'Leave blank to remove the password.' && c.password === true && c.yes === 'Update' && c.required === false && c.max >= 2048);
}
const asks = (code.match(/(?<![\w.])askYes\(/g) || []).length;
ok('the 20 questions ask through askYes', asks >= 21, String(asks));   // 20 questions and its definition (since item 125 a saved checkpoint comes back through the restore sheet; item 163 made removing a domain a typed question, askText)
ok('Escape answers no, and the main button yes', /d\.addEventListener\('cancel', function \(e\) \{ e\.preventDefault\(\); finish\(field \? null : false\); \}\)/.test(kit) && /if \(!field\) \{ finish\(true\); return; \}/.test(kit));
ok('a risky question starts on Cancel', /\(o\.danger \? no : go\)\.focus\(\)/.test(kit) && /danger: !!opts\.danger/.test(html));
ok('the question keeps its line breaks and is the dialog’s name', /\.dds-dlg \.dlg-d\{[^}]*white-space:pre-line/.test(shellCss) && /\.dds-dlg \.dlg-q\{[^}]*white-space:pre-line/.test(shellCss) && /d\.setAttribute\('aria-labelledby', h\.id\)/.test(kit));
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
