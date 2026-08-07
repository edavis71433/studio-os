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

// ═══ 5. Stage to-do presets — the deal page's to-do dropdown ═══
// The to-do box was a bare "what do I write here?" input. Each stage now offers
// a short list of the obvious next to-dos, still fully editable before Add. The
// server caps a task title at 200 chars (clean(b.title, 200)), so a preset that
// exceeds it would be silently truncated — pinned here.
{
  let allPresent = true, countOk = true, allBounded = true, allTrimmed = true, allPlain = true, noDupes = true;
  for (const s of STAGES) {
    const todos = PIPELINE_GUIDANCE[s].todos;
    if (!Array.isArray(todos) || todos.length === 0) { allPresent = false; continue; }
    if (todos.length < 2 || todos.length > 5) countOk = false;
    if (new Set(todos).size !== todos.length) noDupes = false;
    for (const t of todos) {
      if (typeof t !== 'string' || !t) { allPresent = false; continue; }
      if (t.length > 200) allBounded = false;                  // clean(b.title, 200) in routes/sales.ts
      if (t !== t.trim()) allTrimmed = false;
      if (/[<>]/.test(t)) allPlain = false;
    }
  }
  ok('every ladder stage offers to-do presets', allPresent);
  ok('to-do presets are a short, scannable 2–5 per stage', countOk);
  ok('every to-do preset fits the server’s 200-char title cap', allBounded);
  ok('to-do presets have no stray leading/trailing whitespace', allTrimmed);
  ok('to-do presets carry no raw HTML markup', allPlain);
  ok('no stage repeats the same to-do twice', noDupes);
  // `todos` is OPTIONAL on the interface, so nothing that reads PIPELINE_GUIDANCE
  // breaks — but the shipped data must actually carry it for every stage.
  ok('guidanceFor() carries the to-dos through the fallback path too', Array.isArray(guidanceFor('not-a-real-stage').todos));

  // pipeline.html mirrors this table by hand (the existing convention) — a drift
  // between the source of truth and the mirror is what the deal page would show.
  const pipe = Deno.readTextFileSync(new URL('pipeline.html', import.meta.resolve('../../')));
  let mirrored = true, missing = '';
  for (const s of STAGES) for (const t of (PIPELINE_GUIDANCE[s].todos || [])) if (!pipe.includes(t)) { mirrored = false; missing = missing || `${s}: ${t}`; }
  ok('pipeline.html mirrors every to-do preset (no hand-mirror drift)', mirrored, missing);
  ok('the deal page offers the presets as a <select> beside the free-text input', /id="dt-preset"/.test(pipe) && /id="dt-title"/.test(pipe) && /__custom__/.test(pipe));
  // crm.html is deliberately left alone — to-dos are read-only there.
  const crm = Deno.readTextFileSync(new URL('crm.html', import.meta.resolve('../../')));
  ok('crm.html is NOT given the preset picker (to-dos are read-only there)', !/id="dt-preset"/.test(crm));
}

const passed = results.filter((r) => r.p).length;
const failed = results.length - passed;
console.log(`\n════ PIPELINE GUIDANCE: ${passed}/${results.length} passed${failed ? `, ${failed} FAILED` : ''} ════`);
if (failed) Deno.exit(1);
