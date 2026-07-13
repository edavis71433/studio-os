// ── Deal activity (per-deal timeline + quick-log) pure suite ─────────────────
// Proves the pure core of the CRM's highest-value gap: manual activities
// (call/email/meeting/dated note) validate + escape correctly; a back-dated
// activity merges with system events into ONE reverse-chronological timeline by
// EFFECTIVE time; "last contacted" derives from the latest manual activity only;
// and the empty state is calm (no throw, sensible defaults).
//
//   deno run --allow-read --allow-env tests/presence/deal_activity_test.mjs
import {
  DEAL_ACTIVITY_KINDS, isDealActivityKind, activityNeedsBody, cleanActivityBody,
  normalizeOccurredAt, buildActivityDetail, isActivityRow, describeSystemEvent,
  mapDealTimelineItem, mergeDealTimeline, lastContactedAt, lastContactedLabel,
} from '../../supabase/functions/presence/crm/deal_activity.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const NOW = '2026-07-13T12:00:00.000Z';
const NUL = String.fromCharCode(0), BEL = String.fromCharCode(7), DEL = String.fromCharCode(127);

// ═══ 1. kind validation ═══
{
  ok('the four kinds', JSON.stringify([...DEAL_ACTIVITY_KINDS]) === JSON.stringify(['call', 'email', 'meeting', 'note']));
  ok('isDealActivityKind accepts the four', ['call', 'email', 'meeting', 'note'].every(isDealActivityKind));
  ok('isDealActivityKind rejects junk', !isDealActivityKind('phone') && !isDealActivityKind('') && !isDealActivityKind(null) && !isDealActivityKind(3));
  ok('only a note requires a body', activityNeedsBody('note') === true && ['call', 'email', 'meeting'].every((k) => activityNeedsBody(k) === false));
}

// ═══ 2. body validation + escaping ═══
{
  ok('cleanActivityBody trims', cleanActivityBody('  called them back  ') === 'called them back');
  ok('cleanActivityBody strips control chars', cleanActivityBody('a' + NUL + 'b' + BEL + 'c' + DEL + 'd') === 'abcd');
  ok('cleanActivityBody keeps a real newline + tab', cleanActivityBody('line1\nline2\tcol') === 'line1\nline2\tcol');
  ok('cleanActivityBody caps length', cleanActivityBody('x'.repeat(5000)).length === 2000);
  ok('cleanActivityBody handles null/undefined', cleanActivityBody(null) === '' && cleanActivityBody(undefined) === '');
  // Storage-safe raw text; the UI escapes at render. Prove angle brackets survive
  // as data (not stripped, not unescaped) so the render layer owns escaping.
  ok('cleanActivityBody preserves angle brackets as data', cleanActivityBody('<b>hi</b>') === '<b>hi</b>');
}

// ═══ 3. occurred_at normalization ═══
{
  ok('date-only → noon UTC that day', normalizeOccurredAt('2026-07-10', NOW) === '2026-07-10T12:00:00.000Z');
  ok('full ISO passes through (past)', normalizeOccurredAt('2026-07-01T09:30:00.000Z', NOW) === '2026-07-01T09:30:00.000Z');
  ok('empty → now', normalizeOccurredAt('', NOW) === NOW && normalizeOccurredAt(null, NOW) === NOW);
  ok('garbage → now', normalizeOccurredAt('not-a-date', NOW) === NOW);
  ok('future date clamps to now', normalizeOccurredAt('2027-01-01', NOW) === NOW);
  ok('a past day is preserved (not clamped)', normalizeOccurredAt('2026-07-04', NOW) === '2026-07-04T12:00:00.000Z');
}

// ═══ 4. storage detail shape ═══
{
  const d = buildActivityDetail('call', 'left a voicemail', '2026-07-10T12:00:00.000Z');
  ok('detail carries activity_kind/body/occurred_at', d.activity_kind === 'call' && d.body === 'left a voicemail' && d.occurred_at === '2026-07-10T12:00:00.000Z');
  ok('isActivityRow true for a note-row with activity_kind', isActivityRow({ kind: 'note', detail: d }));
  ok('isActivityRow false for a system stage_change', !isActivityRow({ kind: 'stage_change', detail: { to_stage: 'proposal' } }));
  ok('isActivityRow false for a bare legacy note (no activity_kind)', !isActivityRow({ kind: 'note', detail: {} }));
}

// ═══ 5. system-event labels (mirrors the drawer) ═══
{
  ok('stage_change label', describeSystemEvent({ kind: 'stage_change', to_stage: 'proposal' }) === 'Moved to Proposal sent');
  ok('proposal accepted', describeSystemEvent({ kind: 'proposal_decided', detail: { decision: 'accepted' } }) === 'Proposal accepted');
  ok('invoice sent with amount', describeSystemEvent({ kind: 'invoice_sent', detail: { amount_cents: 50000, purpose: 'deposit' } }) === 'Deposit requested — $500');
  ok('created fallback label', describeSystemEvent({ kind: 'created' }) === 'Deal created');
}

// ═══ 6. mapping one row ═══
{
  const act = mapDealTimelineItem({ id: 'a1', kind: 'note', actor: 'me@studio.co', created_at: '2026-07-13T15:00:00.000Z', detail: { activity_kind: 'call', body: 'talked pricing', occurred_at: '2026-07-13T15:00:00.000Z' } });
  ok('activity maps to icon + body + who', act.source === 'activity' && act.kind === 'call' && act.icon === '📞' && act.text === 'talked pricing' && act.who === 'me@studio.co' && act.backdated === false);
  const bare = mapDealTimelineItem({ id: 'a2', kind: 'note', actor: 'me', created_at: '2026-07-13T15:00:00.000Z', detail: { activity_kind: 'meeting', body: '', occurred_at: '2026-07-13T15:00:00.000Z' } });
  ok('empty-body activity gets a verb label', bare.text === 'Logged a meeting');
  const back = mapDealTimelineItem({ id: 'a3', kind: 'note', actor: 'me', created_at: '2026-07-13T15:00:00.000Z', detail: { activity_kind: 'call', body: 'x', occurred_at: '2026-07-01T12:00:00.000Z' } });
  ok('back-dated flag set when day differs', back.backdated === true && back.at === '2026-07-01T12:00:00.000Z' && back.logged_at === '2026-07-13T15:00:00.000Z');
  const sys = mapDealTimelineItem({ id: 'e1', kind: 'created', actor: 'system', created_at: '2026-07-01T10:00:00.000Z', detail: {} });
  ok('system event maps text + no icon', sys.source === 'system' && sys.icon === '' && sys.text === 'Deal created' && sys.at === '2026-07-01T10:00:00.000Z');
}

// ═══ 7. merge ordering (activities + system events, reverse-chron by EFFECTIVE time) ═══
{
  const rows = [
    { id: 'e2', kind: 'stage_change', to_stage: 'proposal', created_at: '2026-07-12T10:00:00.000Z', detail: {} },
    // logged today, but it HAPPENED on the 5th → must sort by occurred_at (5th)
    { id: 'a4', kind: 'note', actor: 'me', created_at: '2026-07-13T09:00:00.000Z', detail: { activity_kind: 'call', body: 'kickoff call', occurred_at: '2026-07-05T14:00:00.000Z' } },
    { id: 'e3', kind: 'created', created_at: '2026-07-01T08:00:00.000Z', detail: {} },
    { id: 'a5', kind: 'note', actor: 'me', created_at: '2026-07-13T11:00:00.000Z', detail: { activity_kind: 'email', body: 'sent recap', occurred_at: '2026-07-13T11:00:00.000Z' } },
  ];
  const tl = mergeDealTimeline(rows);
  ok('merge returns every row', tl.length === 4);
  ok('newest first by effective time', tl.map((i) => i.id).join(',') === 'act:a5,evt:e2,act:a4,evt:e3',
    tl.map((i) => `${i.id}@${i.at}`).join(' | '));
  ok('the back-dated call lands before the stage change it predates', tl.findIndex((i) => i.id === 'act:a4') > tl.findIndex((i) => i.id === 'evt:e2'));
}

// ═══ 8. "last contacted" derivation ═══
{
  const rows = [
    { kind: 'created', created_at: '2026-07-01T08:00:00.000Z', detail: {} },        // system — ignored
    { kind: 'note', created_at: '2026-07-10T08:00:00.000Z', detail: { activity_kind: 'call', body: 'a', occurred_at: '2026-07-04T08:00:00.000Z' } },
    { kind: 'note', created_at: '2026-07-11T08:00:00.000Z', detail: { activity_kind: 'note', body: 'b', occurred_at: '2026-07-09T08:00:00.000Z' } },
    { kind: 'invoice_sent', created_at: '2026-07-12T08:00:00.000Z', detail: { amount_cents: 100 } }, // system — ignored
  ];
  ok('last contacted = latest activity occurred_at (not the invoice)', lastContactedAt(rows) === '2026-07-09T08:00:00.000Z');
  ok('label is calm + relative', lastContactedLabel('2026-07-12T12:00:00.000Z', NOW) === 'Last contacted yesterday');
  ok('label for today', lastContactedLabel(NOW, NOW) === 'Last contacted today');
  ok('ignores system-only history', lastContactedAt([{ kind: 'created', created_at: NOW, detail: {} }]) === null);
}

// ═══ 9. empty state ═══
{
  ok('mergeDealTimeline([]) === []', Array.isArray(mergeDealTimeline([])) && mergeDealTimeline([]).length === 0);
  ok('mergeDealTimeline(undefined) is safe', mergeDealTimeline(undefined).length === 0);
  ok('lastContactedAt([]) === null', lastContactedAt([]) === null && lastContactedAt(undefined) === null);
  ok('lastContactedLabel(null) === empty', lastContactedLabel(null, NOW) === '');
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.error('FAILURES'); Deno.exit(1); }
