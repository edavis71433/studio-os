// ── G13 slice 1 · server-stamped section keys — the cross-template gate ──────
//   deno run --allow-read --allow-env tests/presence/dds_stamps_test.mjs
// Pins the stamp CONTRACT (docs/design/G13-INPLACE-EDITING.md §1.2) across all
// 8 template families: every home page carries data-dds-core on its five core
// sections; block sections carry data-dds-sid/-key/-field/-md; stamps are
// ATTRIBUTES ONLY (stripping them restores the unstamped render byte-for-byte);
// and the /settings handler ships the section_meta sidecar. Pure local run.
import { renderSnapshot } from '../../supabase/functions/presence/lib/render.ts';
import { validateBlocks, renderSiteBlocks, validateBlocksWithMap } from '../../supabase/functions/presence/lib/site_blocks.ts';
import { esc, attr, safeHref } from '../../supabase/functions/presence/lib/markdown.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const SITE = { baseUrl: 'https://vermilionandvine.example', brand: { credit: 'Site by Davis Digital Studio' } };
const TEMPLATES = ['restaurant-classic', 'business-classic', 'editorial', 'aurora', 'slate', 'meadow', 'atelier', 'harbor'];
const CORE = ['hero', 'about', 'offerings', 'testimonials', 'faqs'];
const STRIP = / data-dds-(?:sid|key|field|md|core)="[^"]*"/g;

// ═══ 1. data-dds-core on every template's home page (fixtures carry all 5 sections) ═══
for (const slug of TEMPLATES) {
  const fx = JSON.parse(read(`supabase/functions/presence/templates/${slug}/1.0.0/fixture.json`));
  const out = renderSnapshot(fx, SITE);
  const home = String(out['index.html']);
  const missing = CORE.filter((k) => !home.includes(` data-dds-core="${k}"`));
  ok(`[${slug}] home page stamps all five core sections (data-dds-core)`, missing.length === 0, missing.join(','));
  ok(`[${slug}] each core key is stamped exactly once on the home page`, CORE.every((k) => (home.match(new RegExp(` data-dds-core="${k}"`, 'g')) || []).length === 1));
  // Stamps are the SECTION identity — subsidiary pages reuse the same partials
  // without core stamps (the canvas edits the home/custom pages, not /about/).
  ok(`[${slug}] the About PAGE carries no core stamps (home-only identity)`, !String(out['about/index.html']).includes('data-dds-core'));
}

// ═══ 2. block stamps: sid/key/field/md — and the attributes-only property ═══
const ctx = { esc, attr, safeHref };
const RAW = [
  { type: 'not-a-block' },
  { type: 'richtext', title: 'Story', body: 'Hello **world**\n\n- a\n- b' },
  { type: 'features', items: [] },                                        // empty → dropped
  { type: 'features', items: [{ title: 'Fast', text: 'We show up' }] },
  { type: 'richtext', body: 'Second prose' },
  { type: 'columns', id: 'cols_a', columns: [{ body: 'cell **md**', button: { label: 'Go', url: 'https://x.example' } }, { block: { type: 'title', title: 'Nested' } }] },
  { type: 'divider', style: 'space' },
  { type: 'cta', text: 'Ready?', button: 'Book', url: 'https://ex.com' },
  { type: 'toc' },
];
{
  const { blocks, map } = validateBlocksWithMap(RAW);
  const r = renderSiteBlocks(blocks, ctx);
  ok('every rendered block root carries data-dds-sid + data-dds-key', r.every((b) => / data-dds-sid="[^"]+" data-dds-key="[^"]+"/.test(b.html)));
  ok('the stamped key IS the render key (byte-equal)', r.every((b) => b.html.includes(` data-dds-key="${b.key}"`)));
  ok('the stamped sid IS the sidecar sid for the same list (the canvas↔meta join)',
    r.every((b) => { const m = b.html.match(/ data-dds-sid="([^"]+)"/); return m && map.some((e) => e.sid === m[1] && e.key === b.key); }));
  ok('exactly ONE sid per block (nested cell renders are suppressed)', r.every((b) => (b.html.match(/data-dds-sid/g) || []).length === 1));
  ok('markdown containers carry data-dds-md="1"; plain fields do not', (() => {
    const rt = r.find((b) => b.key === 'block_richtext').html;
    const cta = r.find((b) => b.key === 'block_cta').html;
    return rt.includes('<div class="prose" data-dds-field="body" data-dds-md="1">')
      && cta.includes('data-dds-field="text"') && !cta.includes('data-dds-md');
  })());
  ok('field paths are dot-paths into the STORED block (items.N.*, columns.N.*)', (() => {
    const f = r.find((b) => b.key === 'block_features').html;
    const co = r.find((b) => b.key === 'block_columns_cols_a').html;
    return f.includes('data-dds-field="items.0.title"') && f.includes('data-dds-field="items.0.text"')
      && co.includes('data-dds-field="columns.0.body" data-dds-md="1"') && co.includes('data-dds-field="columns.0.button.label"');
  })());
  ok('divider (space) root <div class="block-divider …"> is stamped too', r.find((b) => b.key === 'block_divider').html.startsWith('<div data-dds-sid="divider"'));
  ok('toc <nav> root is stamped', (r.find((b) => b.key === 'block_toc') || { html: '' }).html.includes('data-dds-sid="toc"'));
  // THE property: stamps are attributes only — stripping them reproduces the
  // unstamped render (ctx.noDds) byte-for-byte, i.e. exactly the pre-G13 bytes.
  const bare = renderSiteBlocks(blocks, { ...ctx, noDds: true });
  ok('attributes-only: strip(data-dds-*) === unstamped render, key-for-key',
    r.length === bare.length && r.every((b, i) => b.key === bare[i].key && b.html.replace(STRIP, '') === bare[i].html));
  ok('stamp determinism: render twice → identical bytes', JSON.stringify(renderSiteBlocks(blocks, ctx)) === JSON.stringify(renderSiteBlocks(blocks, ctx)));
}

// ═══ 3. canonical ids: validateBlocksWithMap ═══
{
  const { blocks, map } = validateBlocksWithMap(RAW);
  ok('map is index-aligned with the validated blocks', map.length === blocks.length);
  ok('src_index points at the RAW entry each kept block came from (junk + empty skipped)',
    JSON.stringify(map.map((e) => e.src_index)) === JSON.stringify([1, 3, 4, 5, 6, 7, 8]));
  ok('sids follow the G11 scheme over the VALIDATED list (type | type#N | type:id)',
    JSON.stringify(map.map((e) => e.sid)) === JSON.stringify(['richtext', 'features', 'richtext#2', 'columns:cols_a', 'divider', 'cta', 'toc']));
  ok('keys follow the render-key rule (bare first, _N de-dupe, MULTI by id)',
    JSON.stringify(map.map((e) => e.key)) === JSON.stringify(['block_richtext', 'block_features', 'block_richtext_2', 'block_columns_cols_a', 'block_divider', 'block_cta', 'block_toc']));
  ok('blocks are byte-identical to validateBlocks(raw) — zero drift', JSON.stringify(blocks) === JSON.stringify(validateBlocks(RAW)));
  // windowed-out blocks stay IN the map (validation keeps them; only render omits)
  const win = validateBlocksWithMap([
    { type: 'richtext', body: 'gone', show_until: '2000-01-01T00:00:00Z' },
    { type: 'richtext', body: 'here' },
  ]);
  ok('a windowed-out block keeps its map slot (sid counting never renumbers)',
    win.map.length === 2 && win.map[0].sid === 'richtext' && win.map[1].sid === 'richtext#2');
}

// ═══ 4. one implementation: sectionIdsFor ≡ validateBlocksWithMap sids ═══
{
  const { sectionIdsFor } = await import('../../supabase/functions/presence/lib/section_comments.ts');
  const { blocks, map } = validateBlocksWithMap(RAW);
  ok('sectionIdsFor(validated) ids ≡ map sids (ONE id computation, zero copies)',
    JSON.stringify(sectionIdsFor(blocks).map((x) => x.id)) === JSON.stringify(map.map((e) => e.sid)));
}

// ═══ 5. the /settings sidecar is wired (source pin — the handler is impure) ═══
{
  const src = read('supabase/functions/presence/routes/content.ts');
  ok('/settings responses are decorated with section_meta on GET and PUT',
    src.includes('section_meta = settingsSectionMeta') && (src.match(/withSectionMeta\(/g) || []).length >= 3
    && src.includes('validateBlocksWithMap(row.blocks).map'));
}

const failed = results.filter((r) => !r.p);
console.log(`\n════ G13 STAMPS: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAILED' : 'PASSED'} ════`);
if (failed.length) Deno.exit(1);
