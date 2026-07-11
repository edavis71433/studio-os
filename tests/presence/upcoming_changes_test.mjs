// CMS-UX-5 — Upcoming Changes: pure adapter tests.
//   deno run -A tests/presence/upcoming_changes_test.mjs
// Covers future-date bucketing (Today/This week/Coming soon/Later), the
// undated "Waiting on you" group, the what/when/why/action card shape, the
// renewal windows, the Honesty Rule (no date → omit), and client-safety.
import { buildUpcomingChanges } from '../../supabase/functions/presence/lib/upcoming_changes.ts';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('FAIL ', name); } };
const eq = (name, a, b) => ok(name + ` (got ${JSON.stringify(a)})`, a === b);

const NOW = '2026-07-08T12:00:00Z';  // a Wednesday
const base = { now: NOW, scheduled: [], domain_expires_at: null, trial_ends_at: null, project_due: [], approvals_waiting: 0, almost_ready: false };
const build = (over) => buildUpcomingChanges({ ...base, ...over });
const items = (u) => u.groups.flatMap((g) => g.items);
const grp = (u, key) => u.groups.find((g) => g.key === key);

// 1. Empty → nothing invented
{
  const u = build({});
  eq('1 no groups', u.groups.length, 0);
  eq('1 total 0', u.total, 0);
  eq('1 next null', u.next_at, null);
}

// 2. Scheduled publish → future bucket, what/when/why/action
{
  const u = build({ scheduled: [{ at: '2026-07-10T09:00:00Z', summary: 'Menu refresh', kind: 'publish' }] });  // Friday
  const it = items(u)[0];
  eq('2 title', it.title, 'Your next update is scheduled');
  ok('2 when mentions Friday', /Friday/.test(it.when));
  ok('2 why present', !!it.why);
  ok('2 one action', !!it.action_label && it.action_href === '/presence.html#history');
  eq('2 bucketed this week', grp(u, 'this_week')?.items.length, 1);
  eq('2 next_when', u.next_when, 'on Friday');
}

// 3. Full bucketing ladder
{
  const u = build({ scheduled: [
    { at: '2026-07-08T18:00:00Z' },   // today
    { at: '2026-07-11T09:00:00Z' },   // +3 → this week
    { at: '2026-07-25T09:00:00Z' },   // +17 → coming soon
    { at: '2026-09-01T09:00:00Z' },   // +55 → later
  ] });
  eq('3 today', grp(u, 'today')?.items.length, 1);
  eq('3 this week', grp(u, 'this_week')?.items.length, 1);
  eq('3 coming soon', grp(u, 'coming_soon')?.items.length, 1);
  eq('3 later', grp(u, 'later')?.items.length, 1);
  eq('3 order', u.groups.map((g) => g.key).join(','), 'today,this_week,coming_soon,later');
}

// 4. Past scheduled date is excluded (nothing in the past on a "next" view)
{
  const u = build({ scheduled: [{ at: '2026-07-01T09:00:00Z' }] });
  eq('4 past dropped', u.total, 0);
}

// 5. Domain renewal — shown only within the 90-day window
{
  const near = build({ domain_expires_at: '2026-08-01T00:00:00Z' });  // ~24 days
  ok('5 near renewal shown', items(near).some((i) => i.title === 'Your domain renewal is approaching'));
  const far = build({ domain_expires_at: '2027-06-01T00:00:00Z' });   // ~330 days
  ok('5 far renewal omitted', !items(far).some((i) => i.title === 'Your domain renewal is approaching'));
}

// 6. Trial ending — real date, within window
{
  const u = build({ trial_ends_at: '2026-07-20T00:00:00Z' });  // +12 days
  const it = items(u).find((i) => i.title === 'Your free trial ends soon');
  ok('6 trial shown', !!it && it.action_href === '/portal.html');
}

// 7. Honesty — no renewal/trial date → nothing shown (never estimated)
{
  const u = build({ domain_expires_at: null, trial_ends_at: null });
  ok('7 no fabricated renewal', !items(u).some((i) => /renewal|trial/.test(i.title)));
}

// 8. Project milestone due date (date-only, "due today" counts as today)
{
  const u = build({ project_due: [
    { title: 'Homepage draft', at: '2026-07-08', kind: 'milestone' },   // today (date-only)
    { title: '', at: '2026-07-31', kind: 'project' },                   // +23 → coming soon
  ] });
  ok('8 milestone due today shown as today', grp(u, 'today')?.items.some((i) => i.title === '“Homepage draft” is due'));
  ok('8 project wrap-up card', items(u).some((i) => i.title === 'Your project is expected to wrap up'));
  ok('8 project action → client', items(u).find((i) => /wrap up/.test(i.title))?.action_href === '/client.html');
}

// 9. Waiting on you — undated pending items in their own group
{
  const u = build({ approvals_waiting: 2, almost_ready: true });
  const w = grp(u, 'waiting');
  eq('9 waiting group present', w?.items.length, 2);
  ok('9 approvals card counts', w.items.some((i) => i.title.includes('2 changes are waiting')));
  ok('9 almost-ready card', w.items.some((i) => i.title === 'A website update is almost ready'));
  ok('9 waiting items have no date', w.items.every((i) => i.at === undefined && i.when === undefined));
  eq('9 waiting_count', u.waiting_count, 2);
}

// 10. Waiting group always sorts last, after dated buckets
{
  const u = build({ scheduled: [{ at: '2026-07-10T09:00:00Z' }], approvals_waiting: 1 });
  eq('10 order', u.groups.map((g) => g.key).join(','), 'this_week,waiting');
}

// 11. next_at is the soonest DATED item (waiting never counts as "next")
{
  const u = build({ scheduled: [{ at: '2026-07-20T09:00:00Z' }, { at: '2026-07-09T09:00:00Z' }], approvals_waiting: 1 });
  eq('11 next is soonest', u.next_at, '2026-07-09T09:00:00Z');
}

// 12. Client-safe: no ids / table names / internal kinds / raw field names
{
  const u = build({
    scheduled: [{ at: '2026-07-10T09:00:00Z', kind: 'publish' }],
    project_due: [{ title: 'Draft', at: '2026-07-11', kind: 'milestone' }],
    approvals_waiting: 1,
  });
  const s = JSON.stringify(u);
  ok('12 no table names', !s.includes('presence_'));
  ok('12 no internal kind field', !s.includes('"kind"') && !s.includes('scheduled_for') && !s.includes('due_date'));
  ok('12 items carry only safe fields', items(u).every((i) => 'title' in i && 'why' in i && 'icon' in i));
}

console.log(fail === 0
  ? `\n════ UPCOMING CHANGES: ${pass}/${pass} PASS ════`
  : `\n${fail} FAILURE(S), ${pass} passed`);
if (fail) Deno.exit(1);
