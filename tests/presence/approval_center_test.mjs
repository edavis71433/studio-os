// CMS-UX-6 — Approval Center: pure adapter tests.
//   deno run -A tests/presence/approval_center_test.mjs
// Covers the four groups, the what/why/if-approved/if-wait card shape, the
// kind→copy mapping, scheduled = already-approved, recently-approved cap, the
// all-clear state, and client-safety.
import { buildApprovalCenter } from '../../supabase/functions/presence/lib/approval_center.ts';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('FAIL ', name); } };
const eq = (name, a, b) => ok(name + ` (got ${JSON.stringify(a)})`, a === b);

const NOW = '2026-07-08T12:00:00Z';
const base = { now: NOW, update_ready: false, waiting: [], scheduled: [], recently_approved: [] };
const build = (over) => buildApprovalCenter({ ...base, ...over });
const cards = (a) => a.groups.flatMap((g) => g.cards);
const grp = (a, key) => a.groups.find((g) => g.key === key);

// 1. All clear
{
  const a = build({});
  eq('1 status clear', a.status, 'clear');
  eq('1 no groups', a.groups.length, 0);
  eq('1 pending 0', a.pending_count, 0);
  eq('1 headline', a.headline, 'You’re all caught up — nothing to approve.');
}

// 2. Ready now — the customer's own update (a self-approval)
{
  const a = build({ update_ready: true });
  const c = grp(a, 'ready_now').cards[0];
  eq('2 title', c.title, 'Website update ready');
  ok('2 answers if_approved', /go live/.test(c.if_approved));
  ok('2 answers if_wait', /current version/.test(c.if_wait));
  eq('2 one action to publish', c.action_href, '/presence.html#history');
  eq('2 counts as pending', a.pending_count, 1);
}

// 3. Every waiting card answers what/why/if-approved/if-wait + one action
{
  const a = build({ waiting: [{ kind: 'delivery', href: '/client.html' }] });
  const c = cards(a)[0];
  ok('3 what', !!c.title); ok('3 why', !!c.why);
  ok('3 if_approved', !!c.if_approved); ok('3 if_wait', !!c.if_wait);
  ok('3 one action', !!c.action_label && !!c.action_href);
  ok('3 has a status word', !!c.status_label);
}

// 4. kind → copy + icon mapping, studio title overrides default
{
  const a = build({ waiting: [
    { kind: 'connected', href: '/connections.html' },
    { kind: 'file', href: '/files.html?focus=x' },
    { kind: 'agreement', title: 'Your 2026 agreement', href: '/client.html' },
    { kind: 'proposal', href: '/client.html' },
  ] });
  const byTitle = Object.fromEntries(cards(a).map((c) => [c.title, c]));
  ok('4 connected default title + icon', byTitle['A connected update is ready']?.icon === '🔌');
  ok('4 file default title', !!byTitle['A file replacement is ready']);
  ok('4 agreement uses studio title', byTitle['Your 2026 agreement']?.icon === '📄');
  ok('4 proposal default title', byTitle['Project proposal ready']?.icon === '📄');
}

// 5. Waiting summary (studio wording) overrides the default "why"
{
  const a = build({ waiting: [{ kind: 'delivery', title: 'Homepage copy', summary: 'New headline and intro paragraph.', href: '/client.html' }] });
  const c = cards(a)[0];
  eq('5 studio title', c.title, 'Homepage copy');
  eq('5 studio summary as why', c.why, 'New headline and intro paragraph.');
}

// 6. Scheduled — already approved, not counted as pending
{
  const a = build({ scheduled: [{ at: '2026-07-10T09:00:00Z', kind: 'publish' }] });  // Friday
  const c = grp(a, 'scheduled').cards[0];
  eq('6 scheduled title', c.title, 'Your website update is scheduled');
  ok('6 says already approved', /already approved/.test(c.why));
  ok('6 has a when', /Friday/.test(c.when));
  eq('6 not pending', a.pending_count, 0);
  eq('6 scheduled_count', a.scheduled_count, 1);
  eq('6 headline reflects scheduled', a.headline, 'Nothing to approve — your updates are scheduled.');
}

// 7. Recently approved — reassurance, capped at 5, newest first
{
  const many = Array.from({ length: 7 }, (_, k) => ({ title: `Item ${k}`, at: `2026-07-0${(k % 7) + 1}T09:00:00Z` }));
  const a = build({ recently_approved: many });
  const done = grp(a, 'recently_approved').cards;
  eq('7 capped at 5', done.length, 5);
  ok('7 approved word', done[0].status_label === 'Approved');
  ok('7 no action (already done)', !done[0].action_label);
}

// 8. Group ordering: ready → waiting → scheduled → recently approved
{
  const a = build({ update_ready: true, waiting: [{ kind: 'delivery', href: '/client.html' }], scheduled: [{ at: '2026-07-10T09:00:00Z' }], recently_approved: [{ title: 'X', at: '2026-07-06T09:00:00Z' }] });
  eq('8 order', a.groups.map((g) => g.key).join(','), 'ready_now,waiting,scheduled,recently_approved');
  eq('8 pending counts ready + waiting', a.pending_count, 2);
  eq('8 headline', a.headline, '2 things are waiting for your approval.');
}

// 9. Client-safe: no ids / table names / internal subject types / raw kinds
{
  const a = build({ waiting: [{ kind: 'proposal', href: '/client.html' }], recently_approved: [{ title: 'Deal', at: '2026-07-06T09:00:00Z' }] });
  const s = JSON.stringify(a);
  ok('9 no table names', !s.includes('presence_'));
  ok('9 no internal kind field', !s.includes('"kind"') && !s.includes('subject_type'));
  ok('9 cards carry only safe fields', cards(a).every((c) => 'title' in c && 'why' in c && 'icon' in c));
}

console.log(fail === 0
  ? `\n════ APPROVAL CENTER: ${pass}/${pass} PASS ════`
  : `\n${fail} FAILURE(S), ${pass} passed`);
if (fail) Deno.exit(1);
