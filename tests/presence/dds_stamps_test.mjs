// ── G13 slice 1 · server-stamped section keys — the cross-template gate ──────
//   deno run --allow-read --allow-env tests/presence/dds_stamps_test.mjs
// Pins the stamp CONTRACT (docs/design/G13-INPLACE-EDITING.md §1.2) across all
// 8 template families: every home page carries data-dds-core on its five core
// sections; block sections carry data-dds-sid/-key/-field/-md, plus data-dds-src
// (the block's TRUE stored-list index, carried through the real resolve
// composition — the canvas' primary index join); stamps are ATTRIBUTES ONLY
// (stripping them restores the unstamped render byte-for-byte); and the
// /settings handler ships the section_meta sidecar. Pure local run.
import { renderSnapshot } from '../../supabase/functions/presence/lib/render.ts';
import { validateBlocks, renderSiteBlocks, validateBlocksWithMap } from '../../supabase/functions/presence/lib/site_blocks.ts';
import { composeBlocks } from '../../supabase/functions/presence/lib/serializer.ts';
import { esc, attr, safeHref } from '../../supabase/functions/presence/lib/markdown.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const SITE = { baseUrl: 'https://vermilionandvine.example', brand: { credit: 'Site by Davis Digital Studio' } };
const TEMPLATES = ['restaurant-classic', 'business-classic', 'editorial', 'aurora', 'slate', 'meadow', 'atelier', 'harbor'];
const CORE = ['hero', 'about', 'offerings', 'testimonials', 'faqs'];
const STRIP = / data-dds-(?:sid|key|field|md|core|src)="[^"]*"/g;

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

// ═══ 6. G13 fix: data-dds-src through the REAL composition ═══
// §2 above renders the SAME list the sidecar validated (the reviewed blind spot:
// on that shortcut the sid join can't miss). These cases drive the serializer's
// real EXPORTED composeBlocks — resolveLinkedBlocksTracked → validateBlocksWithMap
// → resolveBlockMediaTracked — where a resolve step CHANGES the list, and pin that
// every rendered section's data-dds-src equals its TRUE raw (stored-list) index,
// while the sid join provably lands on the wrong same-type sibling (the bug the
// stamp kills). Review follow-up: this used to re-implement the composition, so
// reverting the real src mapping stayed green — now the import IS the pin.
// `sidecar` below is exactly settingsSectionMeta's computation.
const composeTracked = (raw, lookup, ref, extras) =>
  ({ ...composeBlocks(raw, lookup, ref, extras), sidecar: validateBlocksWithMap(raw).map });
const stampedSrcs = (r) => r.map((b) => { const m = b.html.match(/ data-dds-src="(\d+)"/); return m ? Number(m[1]) : null; });
const stampedSids = (r) => r.map((b) => (b.html.match(/ data-dds-sid="([^"]+)"/) || [])[1]);
{
  // (a) a linked section that resolves IN + a same-type stored sibling
  const LIB = '11111111-2222-4333-8444-555555555555';
  const raw = [
    { type: 'linked', ref: LIB },                 // stored raw 0 — resolves to a library richtext
    { type: 'richtext', body: 'my own prose' },   // stored raw 1 — same-type sibling
  ];
  const { blocks, src, sidecar } = composeTracked(raw, (id) => (id === LIB ? { type: 'richtext', body: 'library prose' } : null), () => null, undefined);
  const r = renderSiteBlocks(blocks, { ...ctx, src });
  ok('linked-resolve: every rendered section stamps its TRUE raw index (0, 1)', JSON.stringify(stampedSrcs(r)) === JSON.stringify([0, 1]));
  const sids = stampedSids(r);
  const sideJoin = Object.fromEntries(sidecar.map((e) => [e.sid, e.src_index]));
  ok('linked-resolve: the sid join is provably WRONG here — sidecar "richtext" → raw 1, the render\'s "richtext" IS raw 0; src disagrees and is right',
    sids[0] === 'richtext' && sideJoin['richtext'] === 1 && src[0] === 0);
  ok('linked-resolve: the sibling renumbered to "richtext#2" — absent from the sidecar entirely (the dead-click half of the bug)',
    sids[1] === 'richtext#2' && !(sids[1] in sideJoin));
  const bare = renderSiteBlocks(blocks, { ...ctx, noDds: true });
  ok('src stamps are attributes-only too (strip(data-dds-*) === unstamped render)',
    r.length === bare.length && r.every((b, i) => b.html.replace(STRIP, '') === bare[i].html));
}
{
  // (b) a deleted-media image + a same-type sibling
  const DEAD = '99999999-9999-4999-8999-999999999999';
  const LIVE = '88888888-8888-4888-8888-888888888888';
  const raw = [
    { type: 'image', image_id: DEAD, title: 'Gone' },   // stored raw 0 — media deleted → drops at resolve
    { type: 'image', image_id: LIVE, title: 'Here' },   // stored raw 1 — survives
  ];
  const ref = (id) => (id === LIVE ? { alt: 'photo', variants: { w400: '/img/x-400.webp', w800: '/img/x-800.webp', w1600: '/img/x-1600.webp' }, width: 1600, height: 900 } : null);
  const { blocks, src, sidecar } = composeTracked(raw, () => null, ref, undefined);
  const r = renderSiteBlocks(blocks, { ...ctx, src });
  ok('media-drop: the surviving image stamps raw index 1 (never the validate-only 0)',
    r.length === 1 && stampedSrcs(r)[0] === 1 && src[0] === 1);
  const sideJoin = Object.fromEntries(sidecar.map((e) => [e.sid, e.src_index]));
  ok('media-drop: the sid join points at the DELETED-media sibling (sidecar "image" → raw 0) — src does not',
    stampedSids(r)[0] === 'image' && sideJoin['image'] === 0);
}
{
  // (c) a reviews_wall with zero approved reviews drops → later indices stay true
  const raw = [
    { type: 'reviews_wall', title: 'Reviews' },     // stored raw 0 — no approved reviews → drops
    { type: 'richtext', body: 'after the wall' },   // stored raw 1
    { type: 'cta', text: 'Call us' },               // stored raw 2
  ];
  const { blocks, src } = composeTracked(raw, () => null, () => null, undefined);   // no reviewsWall extras = zero approved
  const r = renderSiteBlocks(blocks, { ...ctx, src });
  ok('reviews_wall-drop: survivors stamp raw 1 and 2 (render positions shifted, stored indices true)',
    r.length === 2 && JSON.stringify(stampedSrcs(r)) === JSON.stringify([1, 2]));
}
{
  // (e) ALL THREE steps shift at once: a junk entry validate drops, a dead-media
  // image the media step drops, a linked section resolving in place, a plain
  // tail. Only the full r1.src ∘ vm.map ∘ m.src composition lands on the true
  // stored indices — any single step's src (e.g. a regression to `m.src`) is
  // off. THE non-vacuity case for the real composeBlocks: scenarios a-c keep
  // the validate step lossless, so this one is what reddens a src regression.
  const LIB = '11111111-2222-4333-8444-555555555555';
  const DEAD = '99999999-9999-4999-8999-999999999999';
  const raw = [
    { type: 'not-a-block' },                          // stored raw 0 — validate drops
    { type: 'image', image_id: DEAD, title: 'Gone' }, // stored raw 1 — media deleted → drops at resolve
    { type: 'linked', ref: LIB },                     // stored raw 2 — resolves to a library richtext
    { type: 'richtext', body: 'tail prose' },         // stored raw 3
  ];
  const { blocks, src } = composeTracked(raw, (id) => (id === LIB ? { type: 'richtext', body: 'library prose' } : null), () => null, undefined);
  const r = renderSiteBlocks(blocks, { ...ctx, src });
  ok('validate-drop + media-drop + linked-resolve: survivors stamp their TRUE stored indices (2, 3) through the full composition',
    r.length === 2 && JSON.stringify(stampedSrcs(r)) === JSON.stringify([2, 3]) && JSON.stringify(src) === JSON.stringify([2, 3]));
}
{
  // (d) identity page (no resolve step changes the list): both joins agree —
  // stamped src equals the sidecar's src_index for every section.
  const { blocks, map } = validateBlocksWithMap(RAW);
  const r = renderSiteBlocks(blocks, { ...ctx, src: map.map((e) => e.src_index) });
  ok('identity page: stamped src ≡ sidecar src_index, sid-for-sid (the two joins agree when nothing drops)',
    r.every((b) => {
      const ms = b.html.match(/ data-dds-src="(\d+)"/), mi = b.html.match(/ data-dds-sid="([^"]+)"/);
      const e = mi && map.find((x) => x.sid === mi[1]);
      return ms && e && Number(ms[1]) === e.src_index;
    }));
}

// ═══ 7. serializer → template threading is wired (source pin — the path is impure) ═══
{
  const ser = read('supabase/functions/presence/lib/serializer.ts');
  ok('the serializer composes tracked provenance into settings.blocks_src (home + per-page)',
    /blocks_src/.test(ser) && /resolveLinkedBlocksTracked/.test(ser) && /validateBlocksWithMap/.test(ser) && /resolveBlockMediaTracked/.test(ser));
  ok('composeBlocks is EXPORTED and serializeDraft delegates to it (no inline copy left for §6\'s pins to miss)',
    /export function composeBlocks\(/.test(ser) && /const compose = \(raw: unknown\[\]\) => composeBlocks\(/.test(ser)
    && /const homeBlocks = compose\(/.test(ser) && /const pc = compose\(/.test(ser));
  const tmpls = TEMPLATES.map((t) => read(`supabase/functions/presence/templates/${t}/1.0.0/render.ts`));
  ok('all 8 templates thread src into renderSiteBlocks (home blocks + custom pages)',
    tmpls.every((s) => s.includes('src: c.settings?.blocks_src') && s.includes('src: cp.blocks_src')));
}

const failed = results.filter((r) => !r.p);
console.log(`\n════ G13 STAMPS: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAILED' : 'PASSED'} ════`);
if (failed.length) Deno.exit(1);
