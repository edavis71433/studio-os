// ── Item 72: saved site data has a size and a shape ──
//   deno run --allow-read --allow-env --allow-net tests/presence/settings_limits_test.mjs
// Without limits a 40 MB pages list was stored, then re-read on every load, preview, publish,
// hash and sweep; a staff seat could do it to a client's site. The shape check is only what
// every reader assumes, so a half-filled section still saves.
import { jsonFieldProblem } from '../../supabase/functions/presence/routes/content.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}${note ? ' — ' + note : ''}`); };
const KB = 1024;
const BLOCKS = { bytes: 1024 * KB, shape: 'blocks', items: 64 };
const PAGES = { bytes: 2048 * KB, shape: 'pages', items: 40 };
const LIST = { bytes: 16 * KB, shape: 'list', items: 200 };
const OBJ = { bytes: 256 * KB, shape: 'object' };

ok('blocks: an ordinary list saves', jsonFieldProblem([{ type: 'title', title: 'Hi' }, { type: 'richtext', body: 'x' }], BLOCKS) === null);
ok('blocks: a section still being filled in saves (the editor stores it while the owner types)', jsonFieldProblem([{ type: 'features', items: [] }], BLOCKS) === null);
ok('blocks: clearing saves', jsonFieldProblem([], BLOCKS) === null && jsonFieldProblem(null, BLOCKS) === null);
ok('blocks: 40 MB is refused, in a sentence', /more than one save can hold/.test(jsonFieldProblem([{ type: 'richtext', body: 'x'.repeat(40 * 1024 * KB) }], BLOCKS) || ''));
ok('blocks: more than 64 is refused', /more than 64/.test(jsonFieldProblem(Array.from({ length: 65 }, () => ({ type: 'divider' })), BLOCKS) || ''));
ok('blocks: something that isn’t a section is refused', !!jsonFieldProblem([{ type: 'title' }, 'junk'], BLOCKS) && !!jsonFieldProblem([{ title: 'no type' }], BLOCKS) && !!jsonFieldProblem({ type: 'title' }, BLOCKS));
ok('pages: an ordinary list saves, a page with no sections yet too', jsonFieldProblem([{ slug: 'menu', title: 'Menu', blocks: [{ type: 'title' }] }, { slug: 'new', title: 'New' }], PAGES) === null);
ok('pages: a page whose sections aren’t a list, or a null page, is refused', !!jsonFieldProblem([{ slug: 'x', blocks: 'nope' }], PAGES) && !!jsonFieldProblem([null], PAGES));
ok('lists: a string where a list belongs is refused; an object where an object belongs saves', !!jsonFieldProblem('hero', LIST) && jsonFieldProblem({ home: { title: 'x' } }, OBJ) === null && !!jsonFieldProblem(['x'], OBJ));

// every JSON field the builder saves carries a limit
const src = Deno.readTextFileSync(new URL('../../supabase/functions/presence/routes/content.ts', import.meta.url));
const settings = src.slice(src.indexOf('const SETTINGS_FIELDS'), src.indexOf('\n};', src.indexOf('const SETTINGS_FIELDS')));
const location = src.slice(src.indexOf('const LOCATION_FIELDS'), src.indexOf('\n};', src.indexOf('const LOCATION_FIELDS')));
const bare = [...(settings + location).matchAll(/\b([a-z_]+): \{ kind: 'json'( \})?/g)].filter((m) => m[2]).map((m) => m[1]);
ok('every JSON setting and location field has a limit', bare.length === 0, bare.join(','));
ok('the reply carries the sentence', /message: v\.errors\.find\(\(e\) => e\.plain\)\?\.message \|\| 'Some fields need a second look\.'/.test(src));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ SETTINGS LIMITS: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
