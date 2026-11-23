// ── Leftovers from the Nov 22 rounds (Nov 23 2026) ───────────────────────────────────────
//   builder 358  the Health Center's Hosting card says the credits left, the pace and whether
//                publishing is on; at 75% used, or paused, the studio's Home asks (platform staff)
//   sales 215    Home's "Money in" is Analytics' figure: payments received this month, by the
//                same rule (routes/sales_analytics.ts), against last month
// The browser specs cover the pages: admin-health.spec.ts (358), website-styles-search-370-384
// (431), and the sales specs named in each section below.
//
//   deno run --allow-read --allow-env tests/presence/leftovers_nov23_test.mjs
import { pinClock } from './clock.mjs';
import { hostPace, hostPaceWords, hostingNeed, HOST_CREDITS_WARN } from '../../supabase/functions/presence/lib/host_credits.ts';
import { hostingArea } from '../../supabase/functions/presence/lib/health_center.ts';
import { buildNeedsYou } from '../../supabase/functions/presence/agency/needs_you.ts';
import { revenueByMonth, moneyInMonths } from '../../supabase/functions/presence/lib/sales_reports.ts';

const restoreClock = pinClock('2026-11-23T00:00:00Z');   // the suite holds dates; the Needs you list reads the clock
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); };
const eq = (name, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); ok(name + (g === w ? '' : `  (got ${g}, want ${w})`), g === w); };

// ═══ builder 358: the Hosting card and the 75% row ═══
{
  // a Pro plan, 5,000 credits, the period began Nov 11; read 12 days in
  const plan = (used, over = {}) => ({ ok: true, team: 'Studio', plan: 'Pro', credits_included: 5000, credits_used: used, period_start: '2026-11-11T00:00:00Z', next_period_start: '2026-12-11T00:00:00Z', exceeded: false, read_at: '2026-11-23T00:00:00Z', why: null, ...over });
  const p = hostPace(plan(3900));
  eq('358: credits left, the share used, and the pace (325 a day: 3 more days, to Nov 26, before Dec 11)', [p.left, Math.round(p.pct * 100), p.daysLeft, p.runsOut.slice(0, 10), p.beforeRenewal], [1100, 78, 3, '2026-11-26', true]);
  eq('358: the pace in words', hostPaceWords(p), 'At this pace that’s about 3 more days (to Nov 26), before it renews Dec 11.');
  const hot = hostingArea(plan(3900));
  ok('358: the Hosting card at 78% asks for a look and says what is left, the pace and that publishing is on', hot.state === 'attention'
    && hot.detail === 'Pro, 5,000 credits a period; 1,100 of 5,000 credits left (78% used). At this pace that’s about 3 more days (to Nov 26), before it renews Dec 11. Publishing is on.');
  const calm = hostingArea(plan(1000));
  ok('358: under 75% and lasting past the renewal it is calm and says so', calm.state === 'ok' && /4,000 of 5,000 credits left \(20% used\)\. At this pace they last until it renews Dec 11\. Publishing is on\./.test(calm.detail));
  ok('358: nothing used yet (the host can be believed): all left, no pace, the renewal day', hostingArea(plan(0)).state === 'ok' && /5,000 of 5,000 credits left \(0% used\)\. It renews Dec 11\. Publishing is on\./.test(hostingArea(plan(0)).detail));
  ok('358: "used" not known (the host says 0 after publishes): no number, no pace, no row', hostPace(plan(null)) === null && /not known/.test(hostingArea(plan(null)).detail) && /Publishing is on/.test(hostingArea(plan(null)).detail) && hostingNeed(plan(null)) === null);
  ok('358: paused still says so first', /publishes are paused until Dec 11/.test(hostingArea(plan(5000, { exceeded: true })).detail));
  ok('358: the line is 75%', HOST_CREDITS_WARN === 0.75 && hostingNeed(plan(3740)) === null && hostingNeed(plan(3750)) !== null);
  eq('358: the 75% row says how much is used, what is left, the pace and the renewal', hostingNeed(plan(3900)),
    { key: 'hosting:2026-11-11:75', what: 'has used 78% of this period’s credits', when: '1,100 left · about 3 days at this pace · renews Dec 11' });
  eq('358: paused is its own row (a snoozed 75% row doesn’t hide it)', hostingNeed(plan(5000, { exceeded: true })),
    { key: 'hosting:2026-11-11:paused', what: 'is out of credits: publishing is paused', when: 'Add credits at the host or wait until it renews Dec 11' });
  ok('358: an unread plan or none asks nothing', hostingNeed(null) === null && hostingNeed({ ...plan(4900), ok: false }) === null);

  // the studio's Home: paused leads the list; 75% joins the account rows at the end
  const own = { site_id: 's0', notices: [{ id: 'n1', kind: 'capacity', period: '2026-11', headline: 'Your business is getting a lot from Studio OS this month', body: 'Plenty of room.' }] };
  const base = { nowIso: '2026-11-23T00:00:00Z', today: '2026-11-23', own };
  const keys = (hosting) => buildNeedsYou({ ...base, hosting }).map((r) => r.key);
  eq('358: without a hosting read there is no hosting row (a studio that isn’t the platform)', keys(undefined), ['account:n1']);
  eq('358: 75% used joins the account rows', keys(plan(3900)), ['account:n1', 'hosting:2026-11-11:75']);
  eq('358: paused comes first: nothing publishes', keys(plan(5000, { exceeded: true })), ['hosting:2026-11-11:paused', 'account:n1']);
  const row = buildNeedsYou({ ...base, hosting: plan(3900) }).find((r) => r.key.startsWith('hosting:'));
  ok('358: the row names the hosting account and opens the Health Center', row.name === 'The hosting account' && row.verb === 'Open' && row.href === '/admin-health.html' && row.kind === 'account');
}

// ═══ sales 215: Home's Money in is Analytics' figure ═══
{
  // two paid invoices this month, one last month, a retainer payment, and a refund this month;
  // one paid at 11pm on Oct 31 in Los Angeles (Nov 1 in UTC) belongs to October there
  const paid = [{ amount_cents: 150000, paid_at: '2026-11-05T18:00:00Z' }, { amount_cents: 50000, paid_at: '2026-11-20T18:00:00Z' }, { amount_cents: 300000, paid_at: '2026-10-10T18:00:00Z' }, { amount_cents: 20000, paid_at: '2026-11-01T06:00:00Z' }];
  const retainer = [{ amount_cents: 60000, paid_at: '2026-11-02T18:00:00Z' }];
  const back = [{ amount_cents: 30000, paid_at: '2026-11-12T18:00:00Z', retainer: false }];
  const rev = revenueByMonth(paid, '2026-11-23T00:00:00Z', retainer, back, 'America/Los_Angeles');
  const mi = moneyInMonths(rev);
  eq('215: this month and last, as Analytics’ months say (paid + retainer − money back, on the studio’s day)', mi,
    { month: '2026-11', label: 'Nov 2026', cents: 230000, last_month: '2026-10', last_label: 'Oct 2026', last_cents: 320000 });
  ok('215: the same numbers Analytics draws from (its last two months)', mi.cents === rev.months[11].this_year && mi.last_cents === rev.months[10].this_year);
}

restoreClock();
console.log(`\nleftovers_nov23: ${pass} passed, ${fail} failed`);
if (fail) Deno.exit(1);
