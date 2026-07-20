// G13 · provenance-tracked resolve variants — the groundwork that lets the
// render stamp each block's TRUE stored (BLOCKS_WORK) index, so the canvas never
// re-derives an index from a post-resolve sid (the divergence the sidecar had:
// its sids were numbered over the validate-only list, the render's over the
// fully-resolved list, so a linked-resolve or a media-drop shifted the #N and the
// toolbar could act on the WRONG same-type block). These variants are provably
// behavior-neutral — `.blocks` is byte-identical to the untracked functions (the
// render golden + site_blocks suites prove the output is unchanged); the only
// addition is `src`, the input-index each surviving output came from.
import { resolveLinkedBlocks, resolveLinkedBlocksTracked } from '../../supabase/functions/presence/lib/linked_sections.ts';
import { resolveBlockMedia, resolveBlockMediaTracked } from '../../supabase/functions/presence/lib/site_blocks.ts';

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log('FAIL ', n); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const ref = (id) => id === 'good' ? { id: 'good', src: '/m/good.jpg', alt: '' } : null;   // 'gone' → null (deleted)

// ── resolveLinkedBlocksTracked: blocks byte-identical + src = raw index ──
{
  const lookup = (id) => id.startsWith('1111') ? { type: 'richtext', body: 'from-lib' } : null;
  const raw = [
    { type: 'linked', ref: '11111111-1111-4111-8111-111111111111' },  // 0 → resolves in place
    { type: 'richtext', body: 'sibling' },                            // 1 → passthrough
  ];
  ok('linked: blocks byte-identical to untracked', eq(resolveLinkedBlocks(raw, lookup), resolveLinkedBlocksTracked(raw, lookup).blocks));
  const t = resolveLinkedBlocksTracked(raw, lookup);
  ok('linked: both survive; src = [0,1]', t.blocks.length === 2 && eq(t.src, [0, 1]));
  ok('linked: output 0 is the resolved library content', t.blocks[0].body === 'from-lib');
}

// ── a DROPPED linked ref (missing/deleted library item) shifts src ──
{
  const lookup = () => null;   // every ref misses → the linked placeholder drops
  const raw = [
    { type: 'linked', ref: '11111111-1111-4111-8111-111111111111' },  // 0 → DROPS
    { type: 'richtext', body: 'sibling' },                            // 1 → survives
  ];
  const t = resolveLinkedBlocksTracked(raw, lookup);
  ok('linked-drop: only the sibling survives', t.blocks.length === 1);
  ok('linked-drop: its src points at RAW index 1 (not 0)', eq(t.src, [1]));
}

// ── resolveBlockMediaTracked: media-drop is THE bug case ──
{
  const validated = [
    { type: 'image', image_id: 'gone' },   // 0 → ref → null → DROPS
    { type: 'image', image_id: 'good' },   // 1 → survives, would be stamped sid 'image'
  ];
  ok('media: blocks byte-identical to untracked', eq(resolveBlockMedia(validated, ref), resolveBlockMediaTracked(validated, ref).blocks));
  const t = resolveBlockMediaTracked(validated, ref);
  ok('media: only the good image survives', t.blocks.length === 1);
  ok('media: src points the survivor at input index 1 (NOT 0)', eq(t.src, [1]));
}

// ── full composition: a surviving block maps back to its true RAW index ──
{
  const lookup = () => null;
  const raw = [
    { type: 'image', image_id: 'gone' },   // raw 0 → dropped by media
    { type: 'image', image_id: 'good' },   // raw 1 → survives
  ];
  const r1 = resolveLinkedBlocksTracked(raw, lookup);        // no links → passthrough
  const m = resolveBlockMediaTracked(r1.blocks, ref);        // → [good], src=[1] into r1.blocks
  const rawIdx = m.src.map((vi) => r1.src[vi]);              // compose r1→raw
  ok('composition: the survivor maps back to RAW index 1', eq(rawIdx, [1]));
}

console.log(`\n════ DDS PROVENANCE: ${pass}/${pass + fail} ${fail ? 'FAILED' : 'PASSED'} ════`);
if (fail) Deno.exit(1);
