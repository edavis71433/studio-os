// CMS-UX-4 — Website Health: pure adapter tests.
//   deno run -A tests/presence/website_health_test.mjs
// Covers the customer-safe categories, the honesty rule (unverifiable → omit),
// the what/why/action + colour-independent status word, and overall state.
import { buildWebsiteHealth } from '../../supabase/functions/presence/lib/website_health.ts';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('FAIL ', name); } };
const eq = (name, a, b) => ok(name + ` (got ${JSON.stringify(a)})`, a === b);

const L = (step, state) => ({ step, state });
const HEALTHY_LAUNCH = [
  L('Domain connected', 'done'), L('DNS answering', 'done'), L('Security certificate active', 'done'),
  L('Website published', 'done'), L('Search indexing requested', 'done'),
  L('Business profile connected', 'done'), L('Analytics connected', 'done'),
  L('Email authenticated', 'done'), L('Accessibility reviewed', 'done'),
];
const base = {
  now: '2026-07-08T12:00:00Z', site_status: 'live', has_unpublished_changes: false, publish_failed: false,
  last_published_at: '2026-07-06T09:00:00Z', missing_count: 0, missing_href: null, scheduled: false,
  launch: HEALTHY_LAUNCH, connections: [], contact_form_working: false, versions_saved: true,
  domain: 'yourshop.com',
};
const build = (over) => buildWebsiteHealth({ ...base, ...over });
const cat = (h, key) => h.categories.find((c) => c.key === key);
const checks = (h) => h.categories.flatMap((c) => c.checks);
const titled = (h, t) => checks(h).find((c) => c.title === t);

// 1. A fully healthy site
{
  const h = build({});
  eq('1 overall healthy', h.overall, 'healthy');
  eq('1 headline', h.headline, 'Your website is healthy.');
  eq('1 attention_count 0', h.attention_count, 0);
  ok('1 online check ok', titled(h, 'Your website is online')?.state === 'ok');
  ok('1 secure check ok', titled(h, 'Your connection is secure')?.state === 'ok');
}

// 2. Every check answers what/why and carries a colour-independent word
{
  const h = build({ has_unpublished_changes: true });
  for (const c of checks(h)) {
    ok('2 has what (title)', !!c.title);
    ok('2 has why', !!c.why);
    ok('2 has a status word', !!c.status_label);
  }
  const c = titled(h, 'You have unpublished changes');
  ok('2 attention has one action', !!c.action_label && !!c.action_href);
}

// 3. Honesty — no custom domain → no SSL claim, and a neutral (off) domain card
{
  const h = build({ domain: null, launch: HEALTHY_LAUNCH.map((x) => x.step === 'Security certificate active' ? L(x.step, 'todo') : x) });
  ok('3 secure connection omitted (unverifiable)', !titled(h, 'Your connection is secure') && !titled(h, 'Your secure certificate isn’t active yet'));
  const dom = titled(h, 'No custom domain yet');
  ok('3 domain shown as off, not attention', dom?.state === 'off');
  eq('3 off never counts as attention', h.attention_count, 0);
}

// 4. Honesty — n/a launch items are omitted (not shown as todo/attention)
{
  const launch = HEALTHY_LAUNCH.map((x) => x.step === 'Email authenticated' ? L(x.step, 'n/a') : (x.step === 'Search indexing requested' ? L(x.step, 'n/a') : x));
  const h = build({ launch });
  ok('4 n/a email omitted', !titled(h, 'Your email is protected') && !titled(h, 'Your email isn’t fully protected'));
  ok('4 n/a search omitted', !checks(h).some((c) => /search/i.test(c.title)));
}

// 5. Missing content → attention in Content, with a fix action
{
  const h = build({ missing_count: 2, missing_href: '/presence.html#business' });
  const c = cat(h, 'content').checks[0];
  eq('5 content needs completing', c.title, 'Some content still needs completing');
  eq('5 attention', c.state, 'attention');
  eq('5 action goes to the editor', c.action_href, '/presence.html#business');
  eq('5 overall attention', h.overall, 'attention');
}

// 6. Publish failed takes priority over unpublished changes
{
  const h = build({ publish_failed: true, site_status: 'publish_failed', has_unpublished_changes: true });
  ok('6 failed shown', titled(h, 'A recent publish didn’t finish')?.state === 'attention');
  ok('6 not double-counted as unpublished', !titled(h, 'You have unpublished changes'));
}

// 7. Scheduled update → a calm "coming" (not attention)
{
  const h = build({ scheduled: true });
  const c = titled(h, 'An update is scheduled');
  eq('7 coming state', c?.state, 'coming');
  eq('7 not attention', h.attention_count, 0);
}

// 8. Connections — healthy vs needs-reconnect
{
  const h = build({ connections: [{ label: 'Google Business', state: 'ok' }, { label: 'Instagram', state: 'attention' }] });
  ok('8 healthy connection', titled(h, 'Google Business is connected')?.state === 'ok');
  const rc = titled(h, 'Instagram needs a quick reconnect');
  ok('8 reconnect card', rc?.state === 'attention' && rc.action_href === '/connections.html');
}

// 9. No connections → the Connections category is omitted (nothing invented)
{
  const h = build({ connections: [] });
  ok('9 no empty Connections category', !cat(h, 'connections'));
  ok('9 no Performance category (no evidence)', !cat(h, 'performance'));
}

// 10. Contact form only when there's real evidence
{
  ok('10 hidden without evidence', !titled(build({}), 'Your contact form is working'));
  ok('10 shown with a received message', titled(build({ contact_form_working: true }), 'Your contact form is working')?.state === 'ok');
}

// 11. Saved versions surfaced as reassurance (real: a snapshot exists)
{
  ok('11 versions saved shown', titled(build({}), 'Every version of your site is saved')?.state === 'ok');
  ok('11 hidden when none', !titled(build({ versions_saved: false }), 'Every version of your site is saved'));
}

// 12. New site (never published) → overall 'new', gentle headline
{
  const h = build({ site_status: 'never_published', last_published_at: null, launch: HEALTHY_LAUNCH.map((x) => x.step === 'Website published' ? L(x.step, 'todo') : x) });
  eq('12 overall new', h.overall, 'new');
  eq('12 headline', h.headline, 'Your website is almost ready.');
  ok('12 content-complete suppressed pre-publish', !titled(h, 'Your content is complete'));
}

// 13. Category set is only the ones with evidence, in a calm order
{
  const h = build({ connections: [{ label: 'Google Business', state: 'ok' }] });
  const keys = h.categories.map((c) => c.key);
  ok('13 no performance', !keys.includes('performance'));
  eq('13 calm order', keys.join(','), 'website_status,content,visibility,security,connections,publishing');
}

// 14. Client-safe: no launch 'how' text, internal steps, states, or hrefs-as-jargon leak
{
  const h = build({ launch: HEALTHY_LAUNCH.map((x) => ({ ...x, how: 'connect via the room / observer / plan' })) });
  const s = JSON.stringify(h);
  ok('14 no launch how text', !s.includes('observer') && !s.includes('the room'));
  ok('14 no raw step states', !s.includes('"n/a"') && !s.includes('"todo"'));
  ok('14 no evidence type keys', !s.includes('local_presence') && !s.includes('analytics.not_connected'));
  ok('14 checks carry only safe fields', checks(h).every((c) => 'title' in c && 'why' in c && 'state' in c && 'status_label' in c));
}

console.log(fail === 0
  ? `\n════ WEBSITE HEALTH: ${pass}/${pass} PASS ════`
  : `\n${fail} FAILURE(S), ${pass} passed`);
if (fail) Deno.exit(1);
