// CMS-UX-8 — Snapshot History: pure adapter tests.
//   deno run -A tests/presence/snapshot_history_test.mjs
// Covers the Current / Previous / Restored grouping, the name fallback
// (label → summary → date, never invented), preview/restore capability,
// live-only filtering, the empty state, and client-safety.
import { buildSnapshotHistory } from '../../supabase/functions/presence/lib/snapshot_history.ts';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('FAIL ', name); } };
const eq = (name, a, b) => ok(name + ` (got ${JSON.stringify(a)})`, a === b);

const NOW = '2026-07-08T12:00:00Z';
const v = (over = {}) => ({ kind: 'publish', status: 'live', summary: 'Published your site', label: '', at: '2026-07-01T09:00:00Z', completed_at: '2026-07-01T09:01:00Z', restorable: true, ...over });
const build = (versions) => buildSnapshotHistory({ now: NOW, versions });
const grp = (h, key) => h.groups.find((g) => g.key === key);
const all = (h) => h.groups.flatMap((g) => g.versions);

// 1. Empty
{
  const h = build([]);
  eq('1 no groups', h.groups.length, 0);
  eq('1 total 0', h.total, 0);
  eq('1 headline', h.headline, 'No saved versions yet.');
}

// 2. Newest live publish → Current website (only one current)
{
  const h = build([
    v({ completed_at: '2026-07-07T09:00:00Z' }),
    v({ completed_at: '2026-07-01T09:00:00Z' }),
  ]);
  eq('2 one current', grp(h, 'current')?.versions.length, 1);
  eq('2 current is newest', grp(h, 'current').versions[0].at, '2026-07-07T09:00:00Z');
  ok('2 current is flagged', grp(h, 'current').versions[0].is_current === true);
  eq('2 the rest are previous', grp(h, 'previous')?.versions.length, 1);
}

// 3. Current cannot be restored (already live); previous can
{
  const h = build([v({ completed_at: '2026-07-07T09:00:00Z' }), v({ completed_at: '2026-07-01T09:00:00Z' })]);
  eq('3 current not restorable', grp(h, 'current').versions[0].can_restore, false);
  ok('3 current still previewable', grp(h, 'current').versions[0].can_preview === true);
  eq('3 previous restorable', grp(h, 'previous').versions[0].can_restore, true);
  eq('3 restore links to history', grp(h, 'previous').versions[0].restore_href, '/presence.html#history');
}

// 4. Restore-kind versions land in Restored versions
{
  const h = build([
    v({ completed_at: '2026-07-07T09:00:00Z' }),
    v({ kind: 'restore', summary: 'Restored an earlier version', completed_at: '2026-07-05T09:00:00Z' }),
  ]);
  eq('4 restored group', grp(h, 'restored')?.versions.length, 1);
  ok('4 restore why', /restored an earlier version/i.test(grp(h, 'restored').versions[0].why));
  eq('4 restore icon', grp(h, 'restored').versions[0].icon, '↩️');
}

// 5. Name: the customer's version label wins
{
  const h = build([v({ label: 'Spring Update', summary: 'New menu and hours' })]);
  const c = all(h)[0];
  eq('5 name is the label', c.name, 'Spring Update');
  eq('5 summary shown as what changed', c.what_changed, 'New menu and hours');
}

// 6. Name fallback: no label → existing summary (never invented)
{
  const h = build([v({ label: '', summary: 'Published your site' })]);
  const c = all(h)[0];
  eq('6 name falls back to summary', c.name, 'Published your site');
  ok('6 no duplicate what_changed', c.what_changed === undefined);
}

// 7. Name fallback: no label and no real summary → the date (honest)
{
  const h = build([v({ label: '', summary: '' })]);
  ok('7 name uses a date', /^Version from /.test(all(h)[0].name));
  ok('7 has a friendly published date', !!all(h)[0].published_on);
}

// 8. Only LIVE versions are shown (failed / in-flight are not "versions")
{
  const h = build([
    v({ completed_at: '2026-07-07T09:00:00Z' }),
    v({ status: 'failed', completed_at: '2026-07-06T09:00:00Z' }),
    v({ status: 'publishing', completed_at: null }),
  ]);
  eq('8 only the live one', h.total, 1);
}

// 9. Group order: current → previous → restored
{
  const h = build([
    v({ completed_at: '2026-07-07T09:00:00Z' }),
    v({ completed_at: '2026-07-03T09:00:00Z' }),
    v({ kind: 'restore', completed_at: '2026-07-05T09:00:00Z' }),
  ]);
  eq('9 order', h.groups.map((g) => g.key).join(','), 'current,previous,restored');
  ok('9 headline counts all', /3 saved versions/.test(h.headline));
}

// 10. Relative + absolute dates present; each version has a preview link
{
  const h = build([v({ completed_at: '2026-07-01T09:00:00Z' })]);
  const c = all(h)[0];
  ok('10 relative when', !!c.when);
  ok('10 absolute date', /2026/.test(c.published_on));
  eq('10 preview link', c.preview_href, '/presence.html#history');
}

// 11. Client-safe: no ids / snapshot ids / table names / raw status
{
  const h = build([v({ label: 'Spring Update' }), v({ kind: 'restore', completed_at: '2026-06-01T09:00:00Z' })]);
  const s = JSON.stringify(h);
  ok('11 no ids', !s.includes('snapshot_id') && !s.includes('"id"'));
  ok('11 no table names', !s.includes('presence_'));
  ok('11 no raw status word', !s.includes('publishing') && !s.includes('"status"'));
  ok('11 versions carry only safe fields', all(h).every((c) => 'name' in c && 'when' in c && 'why' in c && 'can_restore' in c));
}

console.log(fail === 0
  ? `\n════ SNAPSHOT HISTORY: ${pass}/${pass} PASS ════`
  : `\n${fail} FAILURE(S), ${pass} passed`);
if (fail) Deno.exit(1);
