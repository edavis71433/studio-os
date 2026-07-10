// ── Sales lifecycle pure logic (Presence CMS Phase 2, P2-C) ──────────────────
//   deno run --allow-read tests/presence/sales_lifecycle_test.mjs
const M = await import('../../supabase/functions/presence/lib/sales_lifecycle.ts');
const { STAGES, canTransition, normalizeLineItems, subtotalOf, canDecideProposal,
  contractHash, canSignContract, convertOutcome, clampLimit } = M;

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

// ── stage ladder (bounded) ──
ok('stages: the six bounded stages', JSON.stringify(STAGES) === JSON.stringify(['lead', 'qualified', 'proposal', 'contract', 'won', 'lost']));
ok('stage: lead→qualified allowed', canTransition('lead', 'qualified') === true);
ok('stage: proposal→contract allowed', canTransition('proposal', 'contract') === true);
ok('stage: back one allowed (contract→proposal)', canTransition('contract', 'proposal') === true);
ok('stage: →lost from any active', canTransition('qualified', 'lost') && canTransition('contract', 'lost'));
ok('stage: reopen lost→lead', canTransition('lost', 'lead') === true);
ok('stage: NO arbitrary jump (lead→contract)', canTransition('lead', 'contract') === false);
ok('stage: won is NOT a manual target (convert only)', canTransition('contract', 'won') === false);
ok('stage: won is terminal (no transitions out)', canTransition('won', 'lost') === false);
ok('stage: no self-transition', canTransition('lead', 'lead') === false);

// ── proposal line items + subtotal ──
{
  const r = normalizeLineItems([{ label: 'Design', qty: 2, unit_cents: 50000 }, { label: 'Hosting', qty: 12, unit_cents: 2500 }]);
  ok('proposal: valid items normalize', r.ok === true && r.items.length === 2);
  ok('proposal: deterministic subtotal (2×500 + 12×25 = $1300)', r.ok && r.subtotal_cents === 100000 + 30000);
  ok('proposal: subtotalOf matches', subtotalOf(r.items) === 130000);
  ok('proposal: rejects a non-list', normalizeLineItems('nope').ok === false);
  ok('proposal: rejects a missing label', normalizeLineItems([{ qty: 1, unit_cents: 100 }]).ok === false);
  ok('proposal: rejects a negative price', normalizeLineItems([{ label: 'x', qty: 1, unit_cents: -5 }]).ok === false);
  ok('proposal: rejects >100 items (unbounded guard)', normalizeLineItems(Array(101).fill({ label: 'x', qty: 1, unit_cents: 1 })).ok === false);
}
ok('proposal: decide only from sent', canDecideProposal('sent', 'accepted') === true && canDecideProposal('draft', 'accepted') === false && canDecideProposal('accepted', 'declined') === false);

// ── contract version integrity ──
{
  const h1 = await contractHash('Agreement body', { total: 1300 });
  const h2 = await contractHash('Agreement body', { total: 1300 });
  const h3 = await contractHash('Agreement body EDITED', { total: 1300 });
  ok('contract: hash is deterministic', h1 === h2 && /^[0-9a-f]{64}$/.test(h1));
  ok('contract: hash changes when the body changes (version integrity)', h1 !== h3);
  ok('contract: sign OK when sent + hash matches', canSignContract('sent', h1, h1).ok === true);
  ok('contract: CANNOT sign a mismatched (stale/edited) version', canSignContract('sent', h1, h3).ok === false && canSignContract('sent', h1, h3).reason === 'version_mismatch');
  ok('contract: cannot sign a draft (not sent)', canSignContract('draft', h1, h1).reason === 'not_sent');
  ok('contract: cannot re-sign (idempotent-safe)', canSignContract('signed', h1, h1).reason === 'already_signed');
}

// ── convert (idempotent decision) ──
ok('convert: a contract-stage deal is ready', convertOutcome({ stage: 'contract' }) === 'ready');
ok('convert: an already-converted deal → already_converted (idempotent, no dup)', convertOutcome({ stage: 'won', converted_client_id: 'c1' }) === 'already_converted');
ok('convert: too-early stage blocked', convertOutcome({ stage: 'lead' }) === 'blocked_stage' && convertOutcome({ stage: 'qualified' }) === 'blocked_stage');
ok('convert: a lost deal is blocked', convertOutcome({ stage: 'lost' }) === 'blocked_lost');
ok('convert: a won deal (no client yet) is ready (retry path)', convertOutcome({ stage: 'won' }) === 'ready');

// ── pagination clamp (no unbounded queries) ──
ok('page: default 25', clampLimit(undefined) === 25 && clampLimit(0) === 25 && clampLimit('x') === 25);
ok('page: clamped to 100 max', clampLimit(9999) === 100);
ok('page: honored in range', clampLimit(50) === 50);

// ── end-to-end chain simulation (pure) — proves the ladder supports the workflow ──
{
  let stage = 'lead';
  const walk = [['lead', 'qualified'], ['qualified', 'proposal'], ['proposal', 'contract']];
  let okWalk = true;
  for (const [from, to] of walk) { if (!canTransition(from, to)) okWalk = false; stage = to; }
  const conv = convertOutcome({ stage });
  ok('e2e(pure): lead→qualified→proposal→contract then convert is ready', okWalk && stage === 'contract' && conv === 'ready');
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ SALES LIFECYCLE (P2-C pure): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
