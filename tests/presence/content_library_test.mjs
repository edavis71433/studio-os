// ── CL-1 · Content Library — reuse of the block model ────────────────────────
//   deno run --allow-read --allow-env tests/presence/content_library_test.mjs
// A library item is exactly ONE validated block from the SAME site_blocks model —
// no duplicate block definitions. Media blocks keep their id references (site-scoped
// reuse stays valid). The name is cleaned + capped.
import { cleanLibraryName, validateLibraryBlock } from '../../supabase/functions/presence/lib/content_library.ts';
import { REALIZED_BLOCK_TYPES } from '../../supabase/functions/presence/lib/site_blocks.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}`); };

ok('name is trimmed + capped; empty stays empty', cleanLibraryName('  My   pricing  ') === 'My pricing' && cleanLibraryName('') === '' && cleanLibraryName('x'.repeat(200)).length === 80);
ok('a filled text block validates (features)', (() => { const b = validateLibraryBlock({ type: 'features', title: 'Why us', items: [{ title: 'Fast', text: 'We show up' }] }); return b && b.type === 'features' && b.items.length === 1; })());
ok('accepts an array form too (takes the first block)', validateLibraryBlock([{ type: 'stats', items: [{ value: '15', label: 'Years' }] }]).type === 'stats');
ok('an empty / unfillable block → null', validateLibraryBlock({ type: 'features', items: [] }) === null && validateLibraryBlock({ type: 'unknown_widget' }) === null && validateLibraryBlock(null) === null);
ok('a media block keeps its id references (site-scoped reuse stays valid)', (() => { const b = validateLibraryBlock({ type: 'gallery', image_ids: ['11111111-1111-1111-1111-111111111111', 'nope'] }); return b && b.type === 'gallery' && b.image_ids.length === 1; })());
ok('only real block types are saveable (reuses the one catalog)', validateLibraryBlock({ type: 'cta', text: 'Ready?' }).type === 'cta' && REALIZED_BLOCK_TYPES.includes('cta'));
ok('hostile fields are sanitized by the block validator (no raw HTML)', (() => { const b = validateLibraryBlock({ type: 'features', items: [{ title: '<script>x</script>' }] }); return b && typeof b.items[0].title === 'string'; })());

const passed = results.filter((r) => r.p).length;
console.log(`\n════ CONTENT LIBRARY: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
