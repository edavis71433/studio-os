// CMS-UX-3 — Website Attention Center: pure adapter tests.
//   deno run -A tests/presence/attention_center_test.mjs
// Covers the calm prioritisation buckets, the what/why/action card shape,
// notice routing, the all-clear state, and client-safety.
// (Tenant isolation + bridge scoping are enforced at the route/DB layer — the
// route inherits site resolution, reuses siteContentTree + linksForCustomer.)
import { buildAttentionCenter } from '../../supabase/functions/presence/lib/attention_center.ts';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('FAIL ', name); } };
const eq = (name, a, b) => ok(name + ` (got ${JSON.stringify(a)})`, a === b);

const NOW = '2026-07-08T12:00:00Z';
const base = {
  now: NOW, site_status: 'live', has_unpublished_changes: false, publish_failed: false,
  last_published_at: null, missing: [], notices: [], scheduled: [], new_enquiries: 0,
  connections_attention: [], approvals_waiting: 0, project_approvals_waiting: 0, project_actions: [],
};
const build = (over) => buildAttentionCenter({ ...base, ...over });
const cards = (t) => t.groups.flatMap((g) => g.cards);
const grp = (t, key) => t.groups.find((g) => g.key === key);

// 1. All clear when nothing needs attention
{
  const t = build({});
  eq('1 status all_clear', t.status, 'all_clear');
  eq('1 needs_count 0', t.needs_count, 0);
  eq('1 headline calm', t.headline, 'Everything looks good.');
  ok('1 no needs group', !grp(t, 'needs_attention'));
}

// 2. Every card answers what/why/action
{
  const t = build({ new_enquiries: 1 });
  const c = cards(t)[0];
  ok('2 has what (title)', !!c.title);
  ok('2 has why', !!c.why);
  ok('2 has one action', !!c.action_label && !!c.action_href);
  eq('2 tone needs_attention', c.tone, 'needs_attention');
}

// 3. Publish failed is surfaced first
{
  const t = build({ publish_failed: true, site_status: 'publish_failed', new_enquiries: 5 });
  eq('3 first card is the failed publish', cards(t)[0].title, 'A recent publish didn’t finish');
  ok('3 action retries publishing', cards(t)[0].action_href === '/presence.html#history');
}

// 4. Missing-required sections → per-section cards (capped) + a roll-up
{
  const missing = Array.from({ length: 5 }, (_, i) => ({ section: `Section ${i}`, page: 'About', href: '/presence.html#business' }));
  const t = build({ missing });
  const needs = grp(t, 'needs_attention').cards;
  eq('4 three section cards + one roll-up', needs.length, 4);
  ok('4 roll-up counts the remainder', needs[3].title.includes('2 more'));
  ok('4 section card explains why', /can’t go live/.test(needs[0].why));
}

// 5. Unpublished-ready only when nothing blocks it
{
  const ready = build({ has_unpublished_changes: true });
  ok('5 ready-to-publish card shown', cards(ready).some((c) => c.title === 'Your changes are ready to publish'));
  const blocked = build({ has_unpublished_changes: true, missing: [{ section: 'Hours', page: 'Contact', href: '/x' }] });
  ok('5 suppressed while blocked', !cards(blocked).some((c) => c.title === 'Your changes are ready to publish'));
}

// 6. Approvals (own + bridged) roll into one clear card
{
  const t = build({ approvals_waiting: 2, project_approvals_waiting: 1 });
  const c = cards(t).find((x) => /waiting for your approval/.test(x.title));
  ok('6 approvals card present', !!c);
  ok('6 counts combined (3)', c.title.includes('3'));
}

// 7. Connections needing a reconnect (capped at 2)
{
  const t = build({ connections_attention: [{ label: 'Google Business' }, { label: 'Instagram' }, { label: 'Stripe' }] });
  const conn = cards(t).filter((c) => /reconnect/.test(c.title));
  eq('7 capped at two', conn.length, 2);
  ok('7 names the service', conn[0].title.includes('Google Business'));
  ok('7 action → connections', conn[0].action_href === '/connections.html');
}

// 8. New enquiries card
{
  const one = build({ new_enquiries: 1 });
  ok('8 singular wording', cards(one).some((c) => c.title === 'A new enquiry came in'));
  const many = build({ new_enquiries: 3 });
  ok('8 plural wording', cards(many).some((c) => c.title === '3 new enquiries came in'));
}

// 9. Studio actions (client-visible) surface as needs
{
  const t = build({ project_actions: [{ title: 'Your studio replied to your support request' }] });
  const c = cards(t).find((x) => x.title === 'Your studio replied to your support request');
  ok('9 studio reply surfaced', !!c);
  ok('9 action opens the project', c.action_href === '/client.html');
}

// 10. Notices split by kind — action-now vs approaching
{
  const t = build({ notices: [
    { kind: 'lead_followup', headline: 'A lead is waiting', body: 'Follow up soon', href: '/leads.html' },
    { kind: 'domain_expiry', headline: 'Your domain renewal is approaching', body: 'Renews next month', href: '/presence.html#foundations' },
  ] });
  ok('10 lead → needs attention', grp(t, 'needs_attention').cards.some((c) => c.title === 'A lead is waiting'));
  ok('10 domain → coming soon', grp(t, 'coming_soon').cards.some((c) => c.title.includes('domain renewal')));
}

// 11. Scheduled publish → Coming soon with a friendly day
{
  const t = build({ scheduled: [{ at: '2026-07-10T09:00:00Z', summary: 'Menu refresh', kind: 'publish' }] });
  const c = grp(t, 'coming_soon').cards[0];
  ok('11 mentions Friday', /Friday/.test(c.title));         // 2026-07-10 is a Friday
  eq('11 tone coming_soon', c.tone, 'coming_soon');
}

// 12. Completed reassurance when live + clean
{
  const t = build({ last_published_at: '2026-07-06T09:00:00Z', has_unpublished_changes: false });
  const c = grp(t, 'completed')?.cards[0];
  ok('12 up-to-date card', c?.title === 'Your website is up to date');
  ok('12 not shown while dirty', !grp(build({ last_published_at: '2026-07-06T09:00:00Z', has_unpublished_changes: true }), 'completed'));
}

// 13. Group ordering: needs → coming soon → completed
{
  const t = build({ new_enquiries: 1, scheduled: [{ at: '2026-07-10T09:00:00Z' }], last_published_at: '2026-07-06T09:00:00Z' });
  eq('13 ordered buckets', t.groups.map((g) => g.key).join(','), 'needs_attention,coming_soon,completed');
  eq('13 status reflects needs', t.status, 'needs_attention');
  eq('13 headline counts needs only', t.headline, 'One thing needs your attention.');
}

// 14. Client-safe: no ids / table names / raw notice kinds / field paths
{
  const t = build({
    missing: [{ section: 'Business basics', page: 'Home', href: '/presence.html#business' }],
    notices: [{ kind: 'payment_trouble', headline: 'A payment needs attention', body: 'Update your card', href: '/portal.html' }],
    approvals_waiting: 1,
  });
  const s = JSON.stringify(t);
  ok('14 no raw notice kinds', !s.includes('payment_trouble') && !s.includes('"kind"'));
  ok('14 no table names', !s.includes('presence_'));
  ok('14 no field paths', !s.includes('identity.') && !s.includes('"field"'));
  ok('14 cards carry only safe fields', cards(t).every((c) => 'title' in c && 'why' in c && 'tone' in c));
}

console.log(fail === 0
  ? `\n════ ATTENTION CENTER: ${pass}/${pass} PASS ════`
  : `\n${fail} FAILURE(S), ${pass} passed`);
if (fail) Deno.exit(1);
