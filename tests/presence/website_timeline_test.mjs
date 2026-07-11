// CMS-UX-2 — Website Timeline: pure adapter tests.
//   deno run -A tests/presence/website_timeline_test.mjs
// Covers day-grouping, reuse of the crm/contract + notifications mappers,
// publish/restore de-duplication, project-event categorisation, actor
// normalisation, the client-safe response shape, and empty state.
// (Tenant isolation + bridge scoping are enforced at the route/DB layer — the
// route inherits site resolution and reuses linksForCustomer; see the live
// tenant_isolation tests. This file proves the pure projection.)
import { buildWebsiteTimeline } from '../../supabase/functions/presence/lib/website_timeline.ts';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('FAIL ', name); } };
const eq = (name, a, b) => ok(name + ` (got ${JSON.stringify(a)})`, a === b);

const NOW = '2026-07-08T12:00:00Z';
const empty = { now: NOW, publishes: [], changes: [], connections: [], moments: [], enquiries: [], scheduled: [], launches: [], domainActions: [], projectEvents: [] };
const build = (over) => buildWebsiteTimeline({ ...empty, ...over });
const allEvents = (t) => t.groups.flatMap((g) => g.events);
const group = (t, key) => t.groups.find((g) => g.key === key);

// 1. Empty → no groups, calm zero-state
{
  const t = build({});
  eq('1 no groups when nothing happened', t.groups.length, 0);
  eq('1 total 0', t.total, 0);
  eq('1 last_activity null', t.last_activity_at, null);
  eq('1 upcoming 0', t.upcoming_count, 0);
}

// 2. Publish → reuses mapPublish, Publishing category, grouped Today
{
  const t = build({ publishes: [{ id: 'p1', kind: 'publish', status: 'live', change_summary: 'New hours', actor_kind: 'client', created_at: '2026-07-08T09:00:00Z', completed_at: '2026-07-08T09:01:00Z' }] });
  const e = allEvents(t)[0];
  eq('2 publish title from mapPublish', e.title, 'Published the site');
  eq('2 category Publishing', e.category, 'Publishing');
  eq('2 actor You (client)', e.actor, 'You');
  eq('2 grouped today', group(t, 'today')?.events.length, 1);
  eq('2 icon set', e.icon, '📤');
  ok('2 deep link to history', e.href === '/presence.html#history');
}

// 3. Day bucketing across the ladder
{
  const t = build({ publishes: [
    { id: 'a', status: 'live', created_at: '2026-07-08T01:00:00Z' },   // today
    { id: 'b', status: 'live', created_at: '2026-07-07T09:00:00Z' },   // yesterday
    { id: 'c', status: 'live', created_at: '2026-07-04T09:00:00Z' },   // this week (4d)
    { id: 'd', status: 'live', created_at: '2026-06-20T09:00:00Z' },   // earlier
  ] });
  eq('3 today bucket', group(t, 'today')?.events.length, 1);
  eq('3 yesterday bucket', group(t, 'yesterday')?.events.length, 1);
  eq('3 this_week bucket', group(t, 'this_week')?.events.length, 1);
  eq('3 earlier bucket', group(t, 'earlier')?.events.length, 1);
  eq('3 group order upcoming→earlier', t.groups.map((g) => g.key).join(','), 'today,yesterday,this_week,earlier');
}

// 4. Scheduled publish → future → "Coming up" first
{
  const t = build({ scheduled: [{ id: 's1', scheduled_for: '2026-07-10T09:00:00Z', summary: 'Menu refresh', kind: 'publish', created_at: '2026-07-08T08:00:00Z' }] });
  eq('4 upcoming group present', group(t, 'upcoming')?.events.length, 1);
  eq('4 upcoming_count', t.upcoming_count, 1);
  eq('4 upcoming is first group', t.groups[0].key, 'upcoming');
  ok('4 scheduled not counted as past', t.last_activity_at === null);
}

// 5. Content edit reuses mapChange; publish/restore/internal_note de-duplicated
{
  const t = build({ changes: [
    { id: 'c1', entity_type: 'faq', action: 'update', summary: 'Added a question', actor_kind: 'client', created_at: '2026-07-08T09:00:00Z' },
    { id: 'c2', entity_type: 'publish', action: 'publish', created_at: '2026-07-08T09:00:00Z' },        // dup of publishes → dropped
    { id: 'c3', entity_type: 'restore', action: 'restore', created_at: '2026-07-08T09:00:00Z' },        // dup → dropped
    { id: 'c4', entity_type: 'internal_note', action: 'update', created_at: '2026-07-08T09:00:00Z' },   // internal → dropped
  ] });
  eq('5 only the content edit survives', t.total, 1);
  const e = allEvents(t)[0];
  eq('5 faq title from mapChange', e.title, 'FAQs updated');
  eq('5 category Content', e.category, 'Content');
  eq('5 deep-links to faqs tab', e.href, '/presence.html#faqs');
}

// 6. Domain-type change routes to Website + foundations
{
  const t = build({ changes: [{ id: 'd1', entity_type: 'domain', action: 'update', created_at: '2026-07-08T09:00:00Z' }] });
  const e = allEvents(t)[0];
  eq('6 domain change → Website', e.category, 'Website');
  eq('6 domain deep-link', e.href, '/presence.html#foundations');
}

// 7. Connections reuse mapConnected + provider label
{
  const t = build({ connections: [{ id: 'x', provider_key: 'google_business', action: 'connect', actor_kind: 'customer', created_at: '2026-07-08T09:00:00Z', provider_label: 'Google Business' }] });
  const e = allEvents(t)[0];
  eq('7 connected title', e.title, 'Google Business connected');
  eq('7 category Website', e.category, 'Website');
  eq('7 actor You (customer)', e.actor, 'You');
}

// 8. Enquiry reuses mapLead; actor = A visitor; Communication
{
  const t = build({ enquiries: [{ id: 'l1', form_kind: 'quote', name: 'Sam', email: 's@x.com', message: 'Need a quote', created_at: '2026-07-08T09:00:00Z' }] });
  const e = allEvents(t)[0];
  ok('8 lead title from mapLead', /Quote request from/.test(e.title));
  eq('8 category Communication', e.category, 'Communication');
  eq('8 actor A visitor', e.actor, 'A visitor');
  eq('8 to messages', e.href, '/leads.html');
}

// 9. Moment reuses mapMoment; System + Automatic
{
  const t = build({ moments: [{ id: 'm1', headline: 'Reviews are up', summary: 'Nice week', created_at: '2026-07-08T09:00:00Z' }] });
  const e = allEvents(t)[0];
  eq('9 moment headline', e.title, 'Reviews are up');
  eq('9 category System', e.category, 'System');
  eq('9 actor Automatic', e.actor, 'Automatic');
}

// 10. Launch published → Milestones "went live"; rolled_back → Publishing; draft skipped
{
  const t = build({ launches: [
    { id: 'L1', name: 'Spring', status: 'published', approved_at: '2026-07-08T09:00:00Z', created_at: '2026-07-01T09:00:00Z' },
    { id: 'L2', name: 'Oops', status: 'rolled_back', updated_at: '2026-07-07T09:00:00Z', created_at: '2026-07-06T09:00:00Z' },
    { id: 'L3', name: 'WIP', status: 'draft', created_at: '2026-07-08T09:00:00Z' },
  ] });
  eq('10 draft launch skipped', t.total, 2);
  const live = allEvents(t).find((e) => e.title.includes('went live'));
  eq('10 published → Milestones', live?.category, 'Milestones');
  const rb = allEvents(t).find((e) => e.title.includes('rolled back'));
  eq('10 rolled_back → Publishing', rb?.category, 'Publishing');
}

// 11. Domain connected → Milestones
{
  const t = build({ domainActions: [{ id: 'd1', title: 'yourshop.com', applied_at: '2026-07-08T09:00:00Z', created_at: '2026-07-08T08:00:00Z' }] });
  const e = allEvents(t)[0];
  eq('11 domain milestone title', e.title, 'Your domain was connected');
  eq('11 category Milestones', e.category, 'Milestones');
}

// 12. Project events: categorise + reuse notifLabel; internal churn omitted
{
  const t = build({ projectEvents: [
    { id: 'e1', kind: 'milestone_completed', actor_kind: 'staff', created_at: '2026-07-08T09:00:00Z' },
    { id: 'e2', kind: 'message', actor_kind: 'staff', created_at: '2026-07-08T08:00:00Z' },
    { id: 'e3', kind: 'support_resolved', actor_kind: 'staff', created_at: '2026-07-08T07:00:00Z' },
    { id: 'e4', kind: 'task_status_change', actor_kind: 'staff', created_at: '2026-07-08T06:00:00Z' },  // internal → omit
    { id: 'e5', kind: 'status_change', actor_kind: 'staff', created_at: '2026-07-08T05:00:00Z' },       // internal → omit
  ] });
  eq('12 internal project churn omitted', t.total, 3);
  const byCat = Object.fromEntries(allEvents(t).map((e) => [e.title, e.category]));
  eq('12 milestone → Milestones', byCat['A milestone was completed'], 'Milestones');
  eq('12 message → Communication', byCat['New message'], 'Communication');
  eq('12 support → Support', byCat['A support request was resolved'], 'Support');
  eq('12 project actor staff → Your studio', allEvents(t)[0].actor, 'Your studio');
  ok('12 project href is a customer page', allEvents(t).every((e) => e.href === '/client.html'));
}

// 13. Actor normalisation across vocabularies
{
  const t = build({ publishes: [
    { id: 'a', status: 'live', actor_kind: 'system', created_at: '2026-07-08T09:00:00Z' },
    { id: 'b', status: 'live', actor_kind: 'staff', created_at: '2026-07-08T08:00:00Z' },
  ] });
  const acts = allEvents(t).map((e) => e.actor);
  ok('13 system → Automatic', acts.includes('Automatic'));
  ok('13 staff → Your studio', acts.includes('Your studio'));
}

// 14. Client-safe shape: no ids, table names, raw kinds, or field paths leak
{
  const t = build({
    publishes: [{ id: 'p-uuid', status: 'live', actor_kind: 'client', created_at: '2026-07-08T09:00:00Z' }],
    projectEvents: [{ id: 'ev-uuid', kind: 'support_opened', actor_kind: 'staff', detail: { request_id: 'r-uuid' }, created_at: '2026-07-08T08:00:00Z' }],
    connections: [{ id: 'c-uuid', provider_key: 'google_business', action: 'connect', created_at: '2026-07-08T07:00:00Z', provider_label: 'Google Business' }],
  });
  const s = JSON.stringify(t);
  ok('14 no source ids leak', !s.includes('p-uuid') && !s.includes('ev-uuid') && !s.includes('r-uuid') && !s.includes('c-uuid'));
  ok('14 no table names leak', !s.includes('presence_') && !s.includes('_events'));
  ok('14 no raw event kinds leak', !s.includes('support_opened') && !s.includes('"kind"'));
  ok('14 no raw provider key leak', !s.includes('google_business'));
  ok('14 events carry only safe fields', allEvents(t).every((e) => 'title' in e && 'category' in e && 'when' in e && 'icon' in e));
}

// 15. last_activity + relative time (past only; upcoming excluded)
{
  const t = build({
    publishes: [{ id: 'a', status: 'live', created_at: '2026-07-07T09:00:00Z' }],   // yesterday
    scheduled: [{ id: 's', scheduled_for: '2026-07-10T09:00:00Z', created_at: '2026-07-08T08:00:00Z' }],
  });
  eq('15 last_activity = latest PAST event', t.last_activity_at, '2026-07-07T09:00:00Z');
  eq('15 last_activity_when human', t.last_activity_when, 'yesterday');
}

// 16. One unified, ordered timeline across all sources (the merge)
{
  const t = build({
    publishes: [{ id: 'p', status: 'live', created_at: '2026-07-08T10:00:00Z' }],
    changes: [{ id: 'c', entity_type: 'offering', action: 'update', created_at: '2026-07-08T11:00:00Z' }],
    enquiries: [{ id: 'l', form_kind: 'contact', name: 'Jo', created_at: '2026-07-08T09:00:00Z' }],
    projectEvents: [{ id: 'e', kind: 'milestone_created', actor_kind: 'staff', created_at: '2026-07-08T08:00:00Z' }],
  });
  const today = group(t, 'today').events;
  eq('16 all four sources merged into one day', today.length, 4);
  eq('16 newest first within the day', today[0].category, 'Content');       // 11:00 offering edit
  ok('16 spans categories', new Set(today.map((e) => e.category)).size >= 3);
}

console.log(fail === 0
  ? `\n════ WEBSITE TIMELINE: ${pass}/${pass} PASS ════`
  : `\n${fail} FAILURE(S), ${pass} passed`);
if (fail) Deno.exit(1);
