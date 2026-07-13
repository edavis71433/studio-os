// ── CL-LINK + HELP-1 · Linked sections & the "how do I…?" helper ─────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/linked_help_test.mjs
// Two Tier-3 features, both pure:
//   • Linked sections resolve a placement to its library item's CURRENT content
//     (single source, update-once). Deleted item → graceful drop. Copies unaffected.
//     A resolved link validates BYTE-IDENTICALLY to the same block copy-inserted.
//   • The help matcher maps a question to the right curated answer + deep link,
//     and falls back honestly (no invented feature) when nothing matches.
import { isLinkedBlock, linkedRefIds, resolveLinkedBlocks, LINKED_BLOCK_TYPE } from '../../supabase/functions/presence/lib/linked_sections.ts';
import { validateBlocks } from '../../supabase/functions/presence/lib/site_blocks.ts';
import { matchHelp, HELP_TOPICS, helpCorpus } from '../../supabase/functions/presence/lib/help_assistant.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}`); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const UUID_A = '11111111-1111-1111-1111-111111111111';
const UUID_B = '22222222-2222-2222-2222-222222222222';

// ═══ Linked sections ═════════════════════════════════════════════════════════

ok('isLinkedBlock: true for {type:linked, ref:UUID}; false otherwise', (() => {
  return isLinkedBlock({ type: LINKED_BLOCK_TYPE, ref: UUID_A })
    && !isLinkedBlock({ type: 'linked', ref: 'not-a-uuid' })
    && !isLinkedBlock({ type: 'features', items: [] })
    && !isLinkedBlock(null) && !isLinkedBlock('linked');
})());

ok('linkedRefIds: de-duped, UUID-only, empty when no links', (() => {
  const ids = linkedRefIds([{ type: 'linked', ref: UUID_A }, { type: 'linked', ref: UUID_A }, { type: 'linked', ref: 'bad' }, { type: 'cta', text: 'x' }]);
  return eq(ids, [UUID_A]) && eq(linkedRefIds([{ type: 'cta', text: 'x' }]), []) && eq(linkedRefIds(null), []);
})());

// The library payload (one stored block) — what the saved section holds today.
const libPricing = { type: 'pricing', title: 'Our plans', tiers: [{ name: 'Basic', price_text: '$9', features: ['A', 'B'] }] };

ok('resolve: a link → the library item’s CURRENT content (single source)', (() => {
  const raw = [{ type: 'linked', ref: UUID_A }];
  const resolved = resolveLinkedBlocks(raw, (id) => (id === UUID_A ? libPricing : null));
  // resolved link, once validated, is identical to the payload validated directly
  return eq(validateBlocks(resolved), validateBlocks([libPricing]));
})());

ok('resolve: editing the library item updates EVERY linked placement at once', (() => {
  // columns is a MULTI (repeatable) type, so two placements genuinely coexist
  // (single-instance types like pricing intentionally collapse to one per site).
  const raw = [{ type: 'linked', ref: UUID_A }, { type: 'cta', text: 'hi' }, { type: 'linked', ref: UUID_A }];
  const edited = { type: 'columns', id: 'c', title: 'New cols', columns: [{ body: 'Pro' }, { body: 'Two' }] };
  const out = validateBlocks(resolveLinkedBlocks(raw, (id) => (id === UUID_A ? edited : null)));
  const cols = out.filter((b) => b.type === 'columns');
  return cols.length === 2 && cols.every((c) => c.title === 'New cols' && c.columns[0].body === 'Pro');
})());

ok('deleted/missing linked item degrades gracefully (dropped, never errors)', (() => {
  const raw = [{ type: 'linked', ref: UUID_A }, { type: 'cta', text: 'still here' }];
  const out = resolveLinkedBlocks(raw, () => null);   // lookup finds nothing
  return out.length === 1 && out[0].type === 'cta';   // link dropped, sibling kept
})());

ok('a COPY is unaffected by the library — passes through unchanged', (() => {
  // A copy is a concrete block, not a link. Changing the library item must not touch it.
  const copy = { type: 'features', title: 'Why us', items: [{ title: 'Fast' }] };
  const raw = [copy, { type: 'linked', ref: UUID_A }];
  const out = resolveLinkedBlocks(raw, () => ({ type: 'features', title: 'DIFFERENT', items: [{ title: 'x' }] }));
  return eq(out[0], copy);   // the copy is byte-identical; only the link resolved
})());

ok('no-links list is byte-identical after resolve (goldens safe)', (() => {
  const raw = [{ type: 'cta', text: 'a' }, { type: 'features', title: 't', items: [{ title: 'i' }] }];
  return eq(validateBlocks(resolveLinkedBlocks(raw, () => null)), validateBlocks(raw));
})());

ok('a per-placement look/window on the LINK overrides while content stays single-source', (() => {
  const raw = [{ type: 'linked', ref: UUID_A, look: { background: 'tinted' }, show_until: '2030-01-01' }];
  const out = validateBlocks(resolveLinkedBlocks(raw, () => libPricing));
  return out.length === 1 && out[0].type === 'pricing' && out[0].look && out[0].look.background === 'tinted' && String(out[0].show_until).startsWith('2030-01-01');
})());

ok('two links to different items each resolve to their own source', (() => {
  const libFaqish = { type: 'features', title: 'B', items: [{ title: 'b' }] };
  const raw = [{ type: 'linked', ref: UUID_A }, { type: 'linked', ref: UUID_B }];
  const out = validateBlocks(resolveLinkedBlocks(raw, (id) => (id === UUID_A ? libPricing : id === UUID_B ? libFaqish : null)));
  return out.length === 2 && out[0].type === 'pricing' && out[1].type === 'features';
})());

// ═══ Help helper ═════════════════════════════════════════════════════════════

const matched = (q, id, hrefIncludes) => {
  const m = matchHelp(q);
  const good = m.matched && m.id === id && m.answer.length > 0 && m.links.some((l) => l.href.includes(hrefIncludes));
  if (!good) console.log(`   help "${q}" → ${JSON.stringify({ matched: m.matched, id: m.id })}`);
  return good;
};

ok('help: "how do I change my hours" → hours + Business info link', matched('How do I change my hours?', 'hours', '#business'));
ok('help: "send a broadcast" → broadcast + broadcasts link', matched('How do I send a broadcast to everyone?', 'broadcast', '/broadcasts.html'));
ok('help: "set up booking" → booking + bookings link', matched('I want to set up online booking', 'booking', '#bookings'));
ok('help: "how do I publish" → publish + publish link', matched('how do I publish my changes and go live', 'publish', '#publish'));
ok('help: "connect a service" → connect + connections link', matched('how do I connect a service like google', 'connect', '/connections.html'));
ok('help: "export my data" → data + export link', matched('how do I export my data', 'data', '#export'));
ok('help: "add a section" → add_section + design link', matched('how do I add a section to my home page', 'add_section', '#design'));

ok('help: no-match returns an HONEST fallback (no invented feature, real person)', (() => {
  const m = matchHelp('asdkfj zxcvbn qwerty');
  return m.matched === false && m.id === null
    && m.links.some((l) => l.href === '/help.html')
    && m.links.some((l) => l.href.startsWith('mailto:'));
})());

ok('help: empty question → an honest prompt to ask, not a guess', (() => {
  const m = matchHelp('');
  return m.matched === false && m.links.some((l) => l.href === '/help.html');
})());

ok('help: every matched answer carries at least one deep link + the full-Help door', (() => {
  return HELP_TOPICS.every((t) => {
    const m = matchHelp(t.q);
    return m.matched && m.links.length >= 2 && m.links.some((l) => l.href === '/help.html');
  });
})());

ok('help: a matched answer is grounded — its text lives in the help corpus', (() => {
  const corpus = helpCorpus();
  return HELP_TOPICS.every((t) => corpus.includes(t.a));
})());

ok('help: a single incidental word is a low-confidence (honest-hedge) match', (() => {
  // "review" alone is a weak signal → matched but flagged low_confidence
  const m = matchHelp('review');
  return m.matched && m.low_confidence === true;
})());

const passed = results.filter((r) => r.p).length;
console.log(`\n════ LINKED SECTIONS + HELP: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
