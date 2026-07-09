// ── Phase T · Launches (FD-T7) — the pure state machine ──────────────────────
//   deno run --allow-read --allow-env tests/presence/launches_test.mjs
// The named-release workflow's transitions, guards, and copy — the I/O layer
// (routes/launches.ts) reuses runPipeline + presence_scheduled_publishes and is
// covered by the deploy smoke; this proves the rules that gate every step.
import { LAUNCH_STATUSES, canApprove, canSchedule, canPromote, canRollback, canCancel, canRecapture, isTerminal, statusAfterRecapture, cleanLaunchName, isValidSchedule, launchStatusLabel } from '../../supabase/functions/presence/lib/launches.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}`); };

ok('six named statuses', LAUNCH_STATUSES.length === 6 && LAUNCH_STATUSES.includes('draft') && LAUNCH_STATUSES.includes('rolled_back'));
ok('approve only from draft', canApprove('draft') && !canApprove('approved') && !canApprove('published'));
ok('schedule + promote only from approved', canSchedule('approved') && canPromote('approved') && !canSchedule('draft') && !canPromote('scheduled'));
ok('rollback only from published', canRollback('published') && !canRollback('approved') && !canRollback('scheduled'));
ok('cancel from draft/approved/scheduled, not published', canCancel('draft') && canCancel('approved') && canCancel('scheduled') && !canCancel('published') && !canCancel('rolled_back'));
ok('recapture from draft/approved only', canRecapture('draft') && canRecapture('approved') && !canRecapture('scheduled') && !canRecapture('published'));
ok('recapture reverts approved → draft (re-approval needed)', statusAfterRecapture('approved') === 'draft' && statusAfterRecapture('draft') === 'draft');
ok('terminal = rolled_back / canceled', isTerminal('rolled_back') && isTerminal('canceled') && !isTerminal('published') && !isTerminal('draft'));

ok('clean name trims + caps + defaults', cleanLaunchName('  Spring   refresh  ') === 'Spring refresh' && cleanLaunchName('') === 'Untitled launch' && cleanLaunchName('x'.repeat(200)).length === 80);
ok('schedule must be a future, parseable time', isValidSchedule('2999-01-01T00:00:00.000Z', '2026-07-09T00:00:00.000Z') && !isValidSchedule('2000-01-01T00:00:00.000Z', '2026-07-09T00:00:00.000Z') && !isValidSchedule('nope', '2026-07-09T00:00:00.000Z'));
ok('every status has a plain-English label', LAUNCH_STATUSES.every((s) => launchStatusLabel(s).length > 3));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ LAUNCHES: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
