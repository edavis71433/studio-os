// ── Pipeline "Path" guidance + Kanban board-move suite ───────────────────────
// Proves the per-stage guidance covers EVERY stage in the sales ladder (no deal
// can ever be left without a "what do I do next"), that the wording is real and
// escape-safe, and that the board's allowed-move helper matches canTransition
// exactly (so the Kanban board can never offer a move the server would reject).
//
//   deno run --allow-read tests/presence/pipeline_guidance_test.mjs
import { PIPELINE_GUIDANCE, guidanceFor, boardMoveTargets } from '../../supabase/functions/presence/lib/pipeline_guidance.ts';
import { STAGES, canTransition } from '../../supabase/functions/presence/lib/sales_lifecycle.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

// ═══ 1. Coverage — every stage has guidance ═══
{
  const missing = STAGES.filter((s) => !PIPELINE_GUIDANCE[s]);
  ok('every ladder stage has guidance', missing.length === 0, missing.length ? 'missing: ' + missing.join(',') : '');
  const extra = Object.keys(PIPELINE_GUIDANCE).filter((k) => !STAGES.includes(k));
  ok('no guidance for a non-existent stage', extra.length === 0, extra.length ? 'extra: ' + extra.join(',') : '');
}

// ═══ 2. Wording — non-empty, present, and safe to drop into HTML ═══
{
  let allNonEmpty = true, allTrimmed = true, allBounded = true, noMarkup = true;
  for (const s of STAGES) {
    const g = PIPELINE_GUIDANCE[s];
    const tip = g.tip, act = g.suggested_action;
    if (!tip || !act) allNonEmpty = false;
    if (tip !== tip.trim() || act !== act.trim()) allTrimmed = false;
    if (tip.length > 160 || act.length > 120) allBounded = false;
    // No raw HTML angle brackets or ampersand-entities smuggled into the copy —
    // the UI escapes on render, and the source itself must stay plain text.
    if (/[<>]/.test(tip) || /[<>]/.test(act)) noMarkup = false;
  }
  ok('tip + action are non-empty for every stage', allNonEmpty);
  ok('tip + action have no stray leading/trailing whitespace', allTrimmed);
  ok('tip + action are within calm length bounds', allBounded);
  ok('tip + action carry no raw HTML markup', noMarkup);
}

// ═══ 3. guidanceFor — resolves known stages, falls back safely ═══
{
  ok('guidanceFor returns the exact entry for a real stage', guidanceFor('proposal') === PIPELINE_GUIDANCE.proposal);
  const f = guidanceFor('not-a-real-stage');
  ok('guidanceFor falls back to real guidance (never null)', !!f && !!f.tip && !!f.suggested_action);
}

// ═══ 4. Board moves match canTransition exactly ═══
{
  let matches = true, neverWon = true, hasForward = true;
  for (const from of STAGES) {
    const targets = boardMoveTargets(from);
    // Must equal, as a set, exactly the canTransition-allowed targets.
    const expected = STAGES.filter((to) => canTransition(from, to));
    const same = targets.length === expected.length && expected.every((t) => targets.includes(t));
    if (!same) matches = false;
    // 'won' is convert-only — the board must never offer it as a move target.
    if (targets.includes('won')) neverWon = false;
    // Every allowed target must itself be a real ladder stage.
    if (!targets.every((t) => STAGES.includes(t))) hasForward = false;
  }
  ok('boardMoveTargets equals canTransition for every stage', matches);
  ok('boardMoveTargets never offers "won" (convert-only)', neverWon);
  ok('boardMoveTargets only yields real ladder stages', hasForward);
  // Spot-check the shape a board reader depends on.
  ok('lead can move forward to qualified', boardMoveTargets('lead').includes('qualified'));
  ok('won is terminal — no board moves out of it', boardMoveTargets('won').length === 0);
}

const passed = results.filter((r) => r.p).length;
const failed = results.length - passed;
console.log(`\n════ PIPELINE GUIDANCE: ${passed}/${results.length} passed${failed ? `, ${failed} FAILED` : ''} ════`);
if (failed) Deno.exit(1);
