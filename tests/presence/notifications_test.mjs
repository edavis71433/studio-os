// ── Notifications — pure derivation (P2-D-3) ─────────────────────────────────
//   deno run --allow-read tests/presence/notifications_test.mjs
import { isAudience, notifHref, notifLabel, isRead } from '../../supabase/functions/presence/lib/notifications.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };

ok('isAudience guards internal|client', isAudience('internal') && isAudience('client') && !isAudience('public') && !isAudience(''));

// deep links point at the source
const P = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
ok('href: message → project messages anchor', notifHref('message', P, {}) === `/projects/${P}#messages`);
ok('href: approval → the exact approval anchor', notifHref('approval_requested', P, { approval_id: 'x' }) === `/projects/${P}#approval-x`);
ok('href: deliverable → files anchor', notifHref('deliverable_added', P, {}) === `/projects/${P}#files`);
ok('href: task → the exact task anchor', notifHref('task_status_change', P, { task_id: 't' }) === `/projects/${P}#task-t`);
ok('href: milestone → milestones anchor', notifHref('milestone_completed', P, {}) === `/projects/${P}#milestones`);
ok('href: support → project-anchored support request (the surface that renders it)', notifHref('support_message', P, { request_id: 'r' }) === `/projects/${P}#support-r`);
ok('href: support without a project falls back to the support anchor', notifHref('support_message', null, {}) === '#support');
ok('href: unknown kind → project base', notifHref('mystery', P, {}) === `/projects/${P}`);

ok('label: every known kind has a human label', ['message', 'approval_requested', 'deliverable_added', 'milestone_completed', 'survey_requested', 'support_opened'].every((k) => notifLabel(k) && notifLabel(k) !== 'Activity'));
ok('label: unknown kind falls back to Activity', notifLabel('zzz') === 'Activity');

// read/unread against a last-seen mark
ok('read: created before last-seen is read', isRead('2026-07-10T10:00:00Z', '2026-07-10T12:00:00Z') === true);
ok('read: created after last-seen is unread', isRead('2026-07-10T13:00:00Z', '2026-07-10T12:00:00Z') === false);
ok('read: no last-seen → everything unread', isRead('2026-07-10T10:00:00Z', null) === false);
ok('read: created exactly at last-seen counts as read', isRead('2026-07-10T12:00:00Z', '2026-07-10T12:00:00Z') === true);

const passed = results.filter((r) => r.p).length;
console.log(`\n════ NOTIFICATIONS (P2-D-3 pure): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
