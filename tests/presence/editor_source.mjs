// ── The website editor's source as one text (builder item 38) ─────────────────
// Not a test itself (the sweep runs *_test.mjs only). presence.html was one file: its styles,
// its markup and one script. Item 38 split it into presence.html (the markup), presence.css,
// presence-core.js (loaded with the page) and presence-edit.js (Edit mode, loaded when it's
// wanted). A suite that reads the editor's code reads it from here, put back together the way
// the page loads it: the styles where presence.css is linked, and the two scripts, core first,
// where presence-core.js is loaded. So a check written against the one file still finds its
// code, and a check that found code in the page still finds it where the page runs it. The core's
// stand-ins for Edit mode's functions are left out, so each function is found once: its own.
//
//   import { editorSource } from './editor_source.mjs';
//   const src = editorSource();
export const EDITOR_FILES = ['presence.html', 'presence.css', 'presence-core.js', 'presence-edit.js'];

export function editorSource(root = new URL('../../', import.meta.url)) {
  const read = (p) => Deno.readTextFileSync(new URL(p, root));
  let html = read('presence.html');
  const css = /<link rel="stylesheet" href="\/presence\.css(?:\?v=\d+)?"(?: data-inline)?>/;
  const js = /<script src="\/presence-core\.js(?:\?v=\d+)?"><\/script>/;
  if (!css.test(html) || !js.test(html)) throw new Error('editor_source: presence.html no longer loads presence.css and presence-core.js the way this helper expects');
  html = html.replace(css, () => '<style>\n' + read('presence.css') + '</style>');
  // the core's stand-ins for Edit mode's functions stay out: a suite finds each function once, its own
  const core = read('presence-core.js').replace(/\/\/ ┌ the stand-ins[\s\S]*?\/\/ └ the stand-ins\n/, '');
  html = html.replace(js, () => '<script>\n' + core + '\n' + read('presence-edit.js') + '</script>');
  return html;
}
