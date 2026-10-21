import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// Today — the home surface. It must tell ONE story with the bell (Phase OS): the
// same notices + approvals appear here as "needs you" cards, plus Moments.
test.describe('Today', () => {
  test('renders needs-you cards (notices + approvals) above moments', async ({ page }) => {
    await installApp(page);
    await page.goto('/today.html');
    const todo = page.locator('.moment.todo');
    await expect(todo).toHaveCount(2); // 1 notice + 1 approval
    await expect(page.locator('.moment.todo').first()).toContainText('A quote request is waiting for a reply');
    // a notice row is a CONTAINER (link + a sibling Done button); the link is inside it
    await expect(page.locator('.moment.todo').first().locator('a.frow')).toHaveAttribute('href', '/inbox.html#enquiries?sel=lead:l1');   // the notice deep-links its row (audit gap 2)
    await expect(page.getByText('Protect your email')).toBeVisible();
    // the moment card + its dismiss affordance
    await expect(page.getByRole('heading', { name: 'Add your holiday hours' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Not now' })).toBeVisible();
  });

  test('the ONE health experience is the Business Health Coach (PT-2C)', async ({ page }) => {
    await installApp(page);
    await page.goto('/today.html');
    // the coach line is secondary context now — it lives inside the collapsed
    // "More about your business" disclosure; open it first. At phone widths the
    // one-time page hint floats over it and auto-scroll parks it under the fixed
    // bottom bar — dismiss the hint and center it before clicking.
    await page.locator('.dds-hint').getByRole('button', { name: 'Got it' }).click();
    const summary = page.locator('details.more > summary');
    await summary.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await summary.click();
    await expect(page.getByText('One thing could help.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Take a look →' })).toHaveAttribute('href', '/inbox.html#enquiries');
  });

  test('the Customer Journey celebrates milestones, never a score', async ({ page }) => {
    await installApp(page);
    await page.goto('/today.html');
    // the journey strip lives inside the collapsed "More about your business"
    // disclosure; open it first (same phone-width hint + fixed-bar dance as PT-2C).
    await page.locator('.dds-hint').getByRole('button', { name: 'Got it' }).click();
    const summary = page.locator('details.more > summary');
    await summary.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await summary.click();
    await expect(page.getByText('Your journey')).toBeVisible();
    // appears twice by design: the celebration line + the milestone row
    await expect(page.getByText('Your website went live for the first time.').first()).toBeVisible();
    await expect(page.getByText('Your presence began')).toBeVisible();
    // no numeric score anywhere in the journey card
    const journeyText = await page.locator('div', { hasText: 'Your journey' }).last().innerText();
    expect(journeyText).not.toMatch(/\b\d+\s*(\/|%|points|score|out of)/i);
  });

  test('attention is consistent — Today card count equals the bell badge', async ({ page }) => {
    await installApp(page);
    await page.goto('/today.html');
    await expect(page.locator('.moment.todo')).toHaveCount(2);
    await expect(page.locator('#dds-bell .dot')).toHaveText('2');
  });

  test('dismissing a moment removes its card', async ({ page }) => {
    await installApp(page);
    await page.goto('/today.html');
    const card = page.locator('article.moment', { hasText: 'Add your holiday hours' });
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Not now' }).click();
    await expect(card).toHaveCount(0);
  });

  test('all-clear empty state (website edition) speaks website language', async ({ page }) => {
    await installApp(page, { api: {
      // attention_count must be 0 too — the page trusts the bell count and
      // renders a "things need you → Inbox" card instead of "all clear" otherwise.
      '/portal/context': { data: {
        site_role: 'business_owner', edition: 'presence',
        edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
        is_agency: false, is_operator: false, sees_full_workspace: true, is_client_portal: false,
        capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'],
        landing: '/today.html', attention_count: 0, nav: STUDIO_NAV,
        plan_key: 'presence', upsell: null,
      } },
      '/portal/feed': { data: { role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null } },
      '/moments': { data: [] },
    } });
    await page.goto('/today.html');
    await expect(page.getByText('All clear')).toBeVisible();
    await expect(page.getByText('Everything we watch looks good.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open your website' })).toBeVisible();
  });

  test('CRM edition empty state speaks relationship language (PP-5)', async ({ page }) => {
    await installApp(page, { api: {
      '/portal/context': { data: {
        site_role: 'business_owner', edition: 'monitor', edition_key: 'business_os_only', edition_name: 'Business OS',
        edition_features: ['business_moments', 'connected', 'ai', 'relationship', 'reports', 'client_portal'],
        is_agency: false, is_operator: false, sees_full_workspace: true, capabilities: ['view_all'],
        landing: '/today.html', attention_count: 0,
        nav: [{ key: 'today', label: 'Today', items: [{ key: 'today', label: 'Today', href: '/today.html' }] }],
      } },
      '/portal/feed': { data: { role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null } },
      '/moments': { data: [] },
    } });
    await page.goto('/today.html');
    await expect(page.getByText('Everything’s quiet across your business.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open Customers' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open your website' })).toHaveCount(0);
  });

  test('upgrade orientation card appears once, then dismisses (PP-6)', async ({ page }) => {
    // seed a PRIOR edition so studio_os reads as an upgrade. Guarded: init
    // scripts re-run on reload, and an unguarded seed would overwrite the
    // advanced marker and re-trigger the card — falsifying the reload assertion.
    await page.addInitScript(() => {
      if (!localStorage.getItem('dds-oriented')) localStorage.setItem('dds-oriented', JSON.stringify({ key: 'cms_only', feats: ['website', 'developer', 'forms', 'client_portal', 'reports'] }));
    });
    await installApp(page, { api: { '/portal/feed': { data: { role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null } }, '/moments': { data: [] } } });
    await page.goto('/today.html');
    await expect(page.getByText('Welcome to Studio OS')).toBeVisible();
    await expect(page.getByText(/daily updates/)).toBeVisible(); // a gained feature, named (v1.0 outcome language)
    // #orientDone, not a bare name query: the page hint's dismiss button is
    // also accessibly named "Got it" (its visible text — WCAG 2.5.3).
    await page.locator('#orientDone').click();
    await expect(page.getByText('Welcome to Studio OS')).toHaveCount(0);
    // and it does not return on reload (localStorage was advanced)
    await page.reload();
    await expect(page.getByText('Welcome to Studio OS')).toHaveCount(0);
  });

  test('first sight of an edition orients silently (no false upgrade)', async ({ page }) => {
    await installApp(page, { api: { '/portal/feed': { data: { role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null } }, '/moments': { data: [] } } });
    await page.goto('/today.html');
    await expect(page.getByText(/^Welcome to/)).toHaveCount(0);
  });
});

// ── Slice 10: the Lightning Home treatment — greeting header, the Needs-you
// action feed (rows with one explicit CTA), Today's schedule, and the rail
// (This month · Recent records · Waiting on clients). Every card degrades to
// hidden/honest on missing data — deploy-order tolerance, never fake zeros.
const DASH = { data: {
  period: 'this_month', generated_at: '2026-07-17T14:14:00Z',
  sales: {
    pipeline: { open: { count: 7, value_cents: 1240000 }, stages: [] },
    won: { this_month: { count: 2, value_cents: 385000 }, last_month: { count: 1, value_cents: 145000 } },
    enquiries: { count: 9, unanswered: 3 },
  },
  website: { traffic: { visitors: 214, has_data: true } },
} };
// The schedule judges each row against "today" in the ROW's own site timezone
// (rows without one fall back to the browser-local date). Fixture days are
// computed INSIDE each test, at run time, with the same Intl frame the page
// uses — a module-load capture can go stale across midnight (X4).
const ymdIn = (tz?: string) => new Intl.DateTimeFormat('en-CA', tz ? { timeZone: tz } : {}).format(new Date());
const apptsFixture = () => {
  const ymd = ymdIn();
  return { data: { appointments: [
    { id: 'b1', type_name: 'Strategy call', slot_start_local: `${ymd}T14:30`, customer_name: 'Sam Rivera', status: 'confirmed' },
    { id: 'b2', type_name: 'Intro chat', slot_start_local: `${ymd}T09:00`, customer_name: 'Dana Lee', status: 'pending' },
    { id: 'b3', type_name: 'Next week', slot_start_local: '2099-01-05T10:00', customer_name: 'Future', status: 'confirmed' },
  ], scope: 'upcoming', pending: 1 } };
};
const PROJECTS_API = {
  '/projects': { data: [
    { id: 'p1', name: 'Acme website build', status: 'active' },
    { id: 'p2', name: 'Done deal', status: 'complete' },
  ], is_studio_view: true },
  '/projects/p1/report': { data: { summary: { pending_approvals: 2, open_client_actions: 1 } } },
};

test.describe('Today — Lightning Home (slice 10)', () => {
  test('greeting header: time-of-day headline + date and needs count in the sub line', async ({ page }) => {
    await installApp(page);
    await page.goto('/today.html');
    await expect(page.locator('#greeting')).toHaveText(/^Good (morning|afternoon|evening)\.$/);
    // "Friday, July 18 · 2 things need you" — the date leads, the count follows
    await expect(page.locator('#sub')).toContainText(/^[A-Z][a-z]+, [A-Z][a-z]+ \d{1,2} · /);
    await expect(page.locator('#sub')).toContainText('2 things need you');
  });

  test('the Needs-you feed: rows carry an icon, meta line, and ONE explicit CTA', async ({ page }) => {
    await installApp(page);
    await page.goto('/today.html');
    const feed = page.locator('.feedcard');
    await expect(feed).toBeVisible();
    const rows = feed.locator('.moment.todo');
    await expect(rows).toHaveCount(2);
    await expect(rows.first().locator('.fico')).toHaveAttribute('aria-hidden', 'true');
    await expect(rows.first().locator('.fmeta')).toContainText('Sam reached out about a day ago.');
    await expect(rows.first().locator('.fcta')).toHaveText('Take care of it →');
    await expect(rows.nth(1).locator('.fcta')).toHaveText('Review & approve →');
    await expect(rows.nth(1).locator('.fmeta')).toContainText('Waiting for your approval');
  });

  test('feed CTAs carry the ?client= scope (a drilled-in operator never loses context)', async ({ page }) => {
    const CLIENT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    await installApp(page);
    await page.goto(`/today.html?client=${CLIENT}`);
    const rows = page.locator('.feedcard .moment.todo');
    await expect(rows.first().locator('a.frow')).toHaveAttribute('href', `/inbox.html?client=${CLIENT}#enquiries?sel=lead:l1`);   // scope before the hash; the row deep link rides in the hash
    await expect(rows.nth(1)).toHaveAttribute('href', `/presence.html?client=${CLIENT}#foundations`);
  });

  test('the This-month rail card renders real dashboard numbers with a Dashboard → footer', async ({ page }) => {
    await installApp(page, { api: { '/analytics/dashboard': DASH } });
    await page.goto('/today.html');
    const card = page.locator('#rail-month');
    await expect(card).toBeVisible();
    await expect(card.getByText('$3,850')).toBeVisible();
    // D3 sibling: the number is summed EXPECTED deal value — the label says so
    await expect(card.getByText('expected value won')).toBeVisible();
    await expect(card.getByText('won this month')).toHaveCount(0);
    await expect(card.getByText('$12,400')).toBeVisible();
    await expect(card.getByText('open pipeline')).toBeVisible();
    await expect(card.getByText('9', { exact: true })).toBeVisible();
    await expect(card.getByText('new enquiries')).toBeVisible();
    await expect(card.getByText('214', { exact: true })).toBeVisible();
    await expect(card.getByText('site visitors')).toBeVisible();
    await expect(card.getByText('Ahead of last month on won work.')).toBeVisible();
    await expect(card.getByRole('link', { name: 'Dashboard →' })).toHaveAttribute('href', '/analytics.html');
  });

  test('This-month hides on a 404 (older function build) — the page still stands', async ({ page }) => {
    await installApp(page);
    await page.route('**/functions/v1/presence/analytics/dashboard**', (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not_found' }) }));
    await page.goto('/today.html');
    await expect(page.locator('.feedcard .moment.todo')).toHaveCount(2); // the feed is unharmed
    await expect(page.locator('#rail-month')).toHaveCount(0);
  });

  test('This-month hides when every section is null — no fake zeros', async ({ page }) => {
    await installApp(page, { api: { '/analytics/dashboard': { data: {
      period: 'this_month', generated_at: '2026-07-17T14:14:00Z',
      sales: { pipeline: null, won: null, enquiries: null, recent_wins: [] },
      website: { traffic: null, search: null },
    } } } });
    await page.goto('/today.html');
    await expect(page.locator('.feedcard')).toBeVisible();
    await expect(page.locator('#rail-month')).toHaveCount(0);
    await expect(page.getByText('$0', { exact: true })).toHaveCount(0);
  });

  test('Today’s schedule lists today’s bookings only, with a to-confirm chip', async ({ page }) => {
    await installApp(page, { api: { '/bookings/appointments': apptsFixture() } });
    await page.goto('/today.html');
    const sched = page.locator('#today-schedule');
    await expect(sched.getByText('Today’s schedule')).toBeVisible();
    const rows = sched.locator('.schedrow');
    await expect(rows).toHaveCount(2); // the 2099 booking is not today
    await expect(rows.nth(0)).toContainText('9:00 am');
    await expect(rows.nth(0)).toContainText('Intro chat');
    await expect(rows.nth(0)).toContainText('Dana Lee');
    await expect(rows.nth(0).locator('.schip')).toHaveText('to confirm');
    await expect(rows.nth(1)).toContainText('2:30 pm');
    await expect(rows.nth(1)).toContainText('Strategy call');
    await expect(rows.nth(1).locator('.schip')).toHaveCount(0);
  });

  test('schedule: confirmed-empty is friendly; a dormant 404 hides the card; a 500 stays honest', async ({ page }) => {
    await installApp(page, { api: { '/bookings/appointments': { data: { appointments: [], scope: 'upcoming', pending: 0 } } } });
    await page.goto('/today.html');
    await expect(page.locator('#today-schedule')).toContainText('Nothing booked for today — the day is yours.');
    // 404/403 = bookings aren't in play on this site (edition without them /
    // older build) — the card disappears entirely; a dormant feature is not a hiccup
    let status = 404;
    await page.route('**/functions/v1/presence/bookings/appointments**', (route) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: 'nope' }) }));
    await page.reload();
    await expect(page.locator('.feedcard')).toBeVisible();               // the page rendered…
    await expect(page.locator('#today-schedule')).toHaveCount(0);        // …with no schedule card at all
    // a 5xx is a transient hiccup — say we couldn't check, never a fake clear day
    status = 500;
    await page.reload();
    await expect(page.locator('#today-schedule')).toContainText('We couldn’t check your bookings just now');
  });

  test('schedule honours each row’s SITE timezone — inclusion by the site’s date, never the viewer’s', async ({ page }) => {
    // Kiritimati (UTC+14) and Etc/GMT+12 (UTC-12) sit 26 hours apart, so NO
    // viewer timezone can share a calendar date with both; expectations are
    // computed here with the same Intl call the page itself uses (T1).
    const plusDay = (ymd: string) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
    const KIRI = ymdIn('Pacific/Kiritimati'), WEST = ymdIn('Etc/GMT+12');
    await installApp(page, { api: { '/bookings/appointments': { data: { appointments: [
      { id: 'k1', type_name: 'Kiritimati today', slot_start_local: `${KIRI}T10:00`, timezone: 'Pacific/Kiritimati', status: 'confirmed' },
      { id: 'k2', type_name: 'Kiritimati tomorrow', slot_start_local: `${plusDay(KIRI)}T10:00`, timezone: 'Pacific/Kiritimati', status: 'confirmed' },
      { id: 'w1', type_name: 'West today', slot_start_local: `${WEST}T11:00`, timezone: 'Etc/GMT+12', status: 'confirmed' },
      { id: 'x1', type_name: 'Bad zone', slot_start_local: `${ymdIn()}T12:00`, timezone: 'Not/A_Zone', status: 'confirmed' },
    ], scope: 'upcoming', pending: 0 } } } });
    await page.goto('/today.html');
    const sched = page.locator('#today-schedule');
    await expect(sched.getByText('Kiritimati today')).toBeVisible();     // today on ITS calendar → shown
    await expect(sched.getByText('West today')).toBeVisible();           // ditto for the far-west site
    await expect(sched.getByText('Kiritimati tomorrow')).toHaveCount(0); // tomorrow there → not today
    await expect(sched.getByText('Bad zone')).toBeVisible();             // invalid zone → viewer-local fallback
  });

  // ── SS7/C6: the Key Deals rail card — GET /sales/deals, top open by value ──
  const SALES_DEALS = { data: [
    { id: 'd1', title: 'Patio rebuild', stage: 'proposal', expected_value_cents: 240000 },
    { id: 'd2', title: 'Small job', stage: 'lead', expected_value_cents: 50000 },
    { id: 'd3', title: 'Won already', stage: 'won', expected_value_cents: 999900 },   // won → never a "key deal"
    { id: 'd4', title: 'Mid job', stage: 'qualified', expected_value_cents: 120000 },
    { id: 'd5', title: 'Fifth', stage: 'lead', expected_value_cents: 40000 },
    { id: 'd6', title: 'Sixth', stage: 'lead', expected_value_cents: 30000 },
    { id: 'd7', title: 'Seventh — beyond the cap', stage: 'lead', expected_value_cents: 20000 },
    { id: 'd8', title: 'Lost cause', stage: 'lost', expected_value_cents: 888800 },          // lost → never a "key deal"
    { id: 'd9', title: 'Legacy converted', stage: 'converted', expected_value_cents: 777700 }, // legacy converted → closed, not open
  ] };

  test('Key deals: top 5 OPEN deals by expected value, deep-linking to the deal drawer', async ({ page }) => {
    await installApp(page, { api: { '/sales/deals': SALES_DEALS } });
    // the read must widen its window to 100 rows — the route's default page is
    // the 25 most-recently-updated, which could hide a big-but-idle open deal
    const dealReads: string[] = [];
    page.on('request', (req) => {
      if (/\/functions\/v1\/presence\/sales\/deals/.test(req.url())) dealReads.push(req.url());
    });
    await page.goto('/today.html');
    const card = page.locator('#rail-deals');
    await expect(card).toBeVisible();
    await expect(card.getByText('Key deals')).toBeVisible();
    const rows = card.locator('.rrows a');
    await expect(rows).toHaveCount(5);                                     // capped, 6 open in the fixture
    await expect(rows.nth(0)).toContainText('Patio rebuild');              // sorted by value, not payload order
    await expect(rows.nth(0)).toContainText('$2,400');
    await expect(rows.nth(0)).toHaveAttribute('href', '/pipeline.html?deal=d1');
    await expect(rows.nth(1)).toContainText('Mid job');
    await expect(card.getByText('Won already')).toHaveCount(0);            // won is not open
    // the open-stage ALLOWLIST: lost and legacy 'converted' deals are closed —
    // their (high) values must never outrank a genuinely open deal
    await expect(card.getByText('Lost cause')).toHaveCount(0);
    await expect(card.getByText('Legacy converted')).toHaveCount(0);
    await expect(card.getByText('Seventh — beyond the cap')).toHaveCount(0);
    await expect(card.getByRole('link', { name: 'Pipeline →' })).toHaveAttribute('href', '/pipeline.html');
    expect(dealReads.length).toBeGreaterThan(0);
    expect(dealReads.every((u) => new URL(u).searchParams.get('limit') === '100')).toBe(true);
  });

  test('Key deals rows carry the ?client= scope for a drilled-in operator', async ({ page }) => {
    const CLIENT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    await installApp(page, { api: { '/sales/deals': SALES_DEALS } });
    await page.goto(`/today.html?client=${CLIENT}`);
    await expect(page.locator('#rail-deals .rrows a').first())
      .toHaveAttribute('href', `/pipeline.html?deal=d1&client=${CLIENT}`);
  });

  test('Key deals hides ENTIRELY on a 403 and on an empty list — never an empty card', async ({ page }) => {
    await installApp(page, { api: { '/sales/deals': { data: [] } } });
    await page.goto('/today.html');
    await expect(page.locator('.feedcard')).toBeVisible();
    await expect(page.locator('#rail-deals')).toHaveCount(0);              // [] → no card
    await page.route('**/functions/v1/presence/sales/deals**', (route) =>
      route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'forbidden' }) }));
    await page.reload();
    await expect(page.locator('.feedcard')).toBeVisible();                 // the page stands…
    await expect(page.locator('#rail-deals')).toHaveCount(0);              // …with no Key-deals card at all
  });

  test('Recent wins renders from the dash payload already in hand; hidden when empty', async ({ page }) => {
    const D = JSON.parse(JSON.stringify(DASH));
    D.data.sales.recent_wins = [
      { title: 'Patio rebuild — Sam R.', value_cents: 240000, closed_at: '2026-07-12T00:00:00Z' },
      { title: 'Site refresh — Marlow’s', value_cents: 145000, closed_at: '2026-07-03T00:00:00Z' },
    ];
    await installApp(page, { api: { '/analytics/dashboard': D } });
    await page.goto('/today.html');
    const wins = page.locator('#rail-wins');
    await expect(wins).toBeVisible();
    await expect(wins.getByText('Recent wins')).toBeVisible();
    await expect(wins.getByText('Patio rebuild — Sam R.')).toBeVisible();
    await expect(wins.getByText('$2,400')).toBeVisible();
    // no per-deal id in this payload → honest non-links, never a fake drill
    await expect(wins.locator('.rrows a')).toHaveCount(0);
    // and without wins in the payload there is no card at all
    await installApp(page, { api: { '/analytics/dashboard': DASH } });
    await page.goto('/today.html');
    await expect(page.locator('#rail-month')).toBeVisible();
    await expect(page.locator('#rail-wins')).toHaveCount(0);
  });

  test('Recent records renders the slice-7 cache as-is (data-noscope), hidden when empty', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('dds-recent-records', JSON.stringify([
        { label: 'Marlow’s Kitchen', href: '/crm.html?client=abc-123', at: 1 },
        { label: 'Evil', href: '//evil.example/x', at: 2 },
      ]));
    });
    await installApp(page);
    await page.goto('/today.html');
    const card = page.locator('#rail-recents');
    await expect(card).toBeVisible();
    const links = card.locator('.rrows a');
    await expect(links).toHaveCount(1); // the protocol-relative href was dropped by the guard
    await expect(links.first()).toHaveText('Marlow’s Kitchen');
    await expect(links.first()).toHaveAttribute('href', '/crm.html?client=abc-123'); // EXACTLY as cached
    await expect(links.first()).toHaveAttribute('data-noscope', '1');
  });

  test('Recent records is absent when nothing is cached', async ({ page }) => {
    await installApp(page);
    await page.goto('/today.html');
    await expect(page.locator('.feedcard')).toBeVisible();
    await expect(page.locator('#rail-recents')).toHaveCount(0);
  });

  test('Waiting on clients: pending approvals per project, from the roster’s own source', async ({ page }) => {
    await installApp(page, { api: PROJECTS_API });
    // X1: the complete project's report is a hard 404 — if the page ever asked
    // for it, the row would silently drop and the spy below would catch the ask.
    await page.route('**/functions/v1/presence/projects/p2/report**', (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not_found' }) }));
    const reportsFetched: string[] = [];
    page.on('request', (req) => {
      const m = req.url().match(/\/functions\/v1\/presence\/projects\/([^/?]+)\/report/);
      if (m) reportsFetched.push(m[1]);
    });
    await page.goto('/today.html');
    const card = page.locator('#rail-waiting');
    await expect(card).toBeVisible();
    await expect(card.getByText('Waiting on clients')).toBeVisible();
    const row = card.locator('.rrows a');
    await expect(row).toHaveCount(1); // only p1 has pending approvals
    await expect(row).toContainText('Acme website build');
    await expect(row).toContainText('2 approvals');
    await expect(row).toHaveAttribute('href', '/projects.html?project=p1');
    // the scoping property itself: NO report fetch is ever issued for a
    // complete/archived project — only the active p1 was asked
    expect(reportsFetched).toEqual(['p1']);
  });

  test('Waiting on clients stays hidden when nothing is pending', async ({ page }) => {
    await installApp(page, { api: { ...PROJECTS_API, '/projects/p1/report': { data: { summary: { pending_approvals: 0 } } } } });
    await page.goto('/today.html');
    await expect(page.locator('.feedcard')).toBeVisible();
    await expect(page.locator('#rail-waiting')).toBeHidden();
  });

  test('nothing renderable inline but the bell rings → ONE fallback row routes to the Inbox', async ({ page }) => {
    // default context keeps attention_count: 2 (client messages / support live
    // only in the bell) while the feed itself has nothing to render inline
    await installApp(page, { api: {
      '/portal/feed': { data: { role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null } },
      '/moments': { data: [] },
    } });
    await page.goto('/today.html');
    const rows = page.locator('.feedcard a.moment.todo');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute('href', '/inbox.html');
    await expect(rows.first()).toContainText('2 things need you');
    await expect(rows.first().locator('.fcta')).toHaveText('Open your Inbox →');
  });

  test('approval feed rows route by precedence: explicit href → connected → foundations', async ({ page }) => {
    await installApp(page, { api: {
      '/portal/feed': { data: { role: 'business_owner', moments: [], notices: [], pending_approvals: [
        { id: 'p1', kind: 'infrastructure', title: 'Custom target', summary: '', href: '/sharing.html', decide_path: '/x/p1/decide' },
        { id: 'p2', kind: 'connected', title: 'A connected change', summary: '', decide_path: '/x/p2/decide' },
        { id: 'p3', kind: 'infrastructure', title: 'Default target', summary: '', decide_path: '/x/p3/decide' },
      ], last_published: null } },
      '/moments': { data: [] },
    } });
    await page.goto('/today.html');
    const rows = page.locator('.feedcard a.moment.todo');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toHaveAttribute('href', '/sharing.html');            // an explicit p.href wins
    await expect(rows.nth(1)).toHaveAttribute('href', '/connections.html');        // kind==='connected'
    await expect(rows.nth(2)).toHaveAttribute('href', '/presence.html#foundations'); // the default
  });

  test('an all-degraded rail collapses — no dead 30% column, no phantom "At a glance" region', async ({ page }) => {
    await installApp(page); // no dashboard/recents/projects fixtures → every rail card degrades away
    await page.route('**/functions/v1/presence/analytics/dashboard**', (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not_found' }) }));
    await page.goto('/today.html');
    await expect(page.locator('.feedcard')).toBeVisible();
    await expect(page.locator('#col-rail')).toBeHidden();
    // main owns the full row: the grid is single-column while the rail is empty
    const cols = await page.locator('.cols').evaluate((el) => getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length);
    expect(cols).toBe(1);
  });

  test('a calm "Everything else looks good" line when needs exist but nothing more is worth a look', async ({ page }) => {
    await installApp(page, { api: { '/moments': { data: [] } } });
    await page.goto('/today.html');
    await expect(page.locator('.feedcard .moment.todo')).toHaveCount(2);
    await expect(page.getByText('Everything else looks good.')).toBeVisible();
  });

  test('mobile: the full home (feed + rail cards) stacks without horizontal overflow', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'the stacked-columns check is the <980px contract');
    await installApp(page, { api: { '/analytics/dashboard': DASH, '/bookings/appointments': apptsFixture(), ...PROJECTS_API } });
    await page.goto('/today.html');
    await expect(page.locator('.feedcard')).toBeVisible();
    await expect(page.locator('#rail-month')).toBeVisible();
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  // ── "Needs you" teardown: ONE Done for the genuine residue ────────────────
  // Most rows now clear themselves when the work is done. What's left gets a
  // single manual Done — but a manual dismiss is a statement about the ROW, and
  // for money and legal obligations the row IS the obligation. Those are refused
  // here AND at the route; they clear when the thing is genuinely resolved.
  const feedOf = (notices: unknown[]) => ({ '/portal/feed': { data: {
    role: 'business_owner', moments: [], pending_approvals: [], last_published: null, notices,
  } } });
  const NOTICE = {
    id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', kind: 'lead_followup', period: 'lead:l1', dismissible: true,
    headline: 'A quote request is waiting for a reply', body: 'Sam reached out about a day ago.', href: '/inbox.html#enquiries',
  };
  const UNPAID = {
    id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', kind: 'deal_followup', period: 'invremind:inv-1', dismissible: false,
    headline: 'Still unpaid — Deposit ($500.00)', body: 'We nudged the client once with the same secure link.', href: '/pipeline.html',
  };
  const SYNTHETIC = {
    id: 'new-enquiries', kind: 'website_enquiry', period: null, dismissible: false,
    headline: '2 new enquiries came in', body: 'Someone reached out through your website.', href: '/inbox.html#enquiries',
  };

  test('a dismissable row offers Done — an unpaid invoice never does', async ({ page }) => {
    await installApp(page, { api: feedOf([NOTICE, UNPAID]) });
    await page.goto('/today.html');
    const rows = page.locator('.feedcard .moment.todo');
    await expect(rows).toHaveCount(2);
    const ordinary = rows.filter({ hasText: 'A quote request is waiting' });
    const unpaid = rows.filter({ hasText: 'Still unpaid' });
    await expect(ordinary.locator('button[data-dismiss-notice]')).toHaveCount(1);
    // the whole point: money can't be hidden by a click
    await expect(unpaid.locator('button[data-dismiss-notice]')).toHaveCount(0);
    await expect(unpaid.locator('.fcta')).toHaveText('Take care of it →');
  });

  test('a synthetic row (computed live, no server row) offers no Done', async ({ page }) => {
    await installApp(page, { api: feedOf([SYNTHETIC]) });
    await page.goto('/today.html');
    const row = page.locator('.feedcard .moment.todo');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('2 new enquiries came in');
    // dismissing it would 200 with no effect and be back on the next refresh
    await expect(row.locator('button[data-dismiss-notice]')).toHaveCount(0);
  });

  test('clicking Done removes the row', async ({ page }) => {
    const posted: string[] = [];
    await installApp(page, { api: feedOf([NOTICE, UNPAID]) });
    await page.route('**/functions/v1/presence/commerce/notices/dismiss', async (route) => {
      posted.push(route.request().postData() || '');
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { dismissed: true } }) });
    });
    await page.goto('/today.html');
    const ordinary = page.locator('.feedcard .moment.todo').filter({ hasText: 'A quote request is waiting' });
    await expect(ordinary).toHaveCount(1);
    await ordinary.getByRole('button', { name: /^Done/ }).click();
    await expect(ordinary).toHaveCount(0);
    // the EXISTING ownership-scoped route, carrying the row's id — no new endpoint
    expect(posted).toEqual([JSON.stringify({ id: NOTICE.id })]);
    // the unpaid row is untouched
    await expect(page.locator('.feedcard .moment.todo')).toHaveCount(1);
  });

  test('the row never nests a button inside an anchor', async ({ page }) => {
    await installApp(page, { api: feedOf([NOTICE]) });
    await page.goto('/today.html');
    await expect(page.locator('.feedcard .moment.todo button[data-dismiss-notice]')).toHaveCount(1);
    // invalid HTML + unreachable for assistive tech — the button must be a SIBLING
    await expect(page.locator('.feedcard a button')).toHaveCount(0);
    await expect(page.locator('.feedcard a a')).toHaveCount(0);
    const row = page.locator('.feedcard .moment.todo').first();
    expect(await row.evaluate((el) => el.tagName)).toBe('DIV');
    expect(await row.evaluate((el) => Array.from(el.children).map((c) => c.tagName).join(','))).toBe('A,BUTTON');
  });

  test('invoice_paid is good news — "Got it", never "Take care of it"', async ({ page }) => {
    const PAID = {
      id: 'cccccccc-3333-4333-8333-cccccccccccc', kind: 'invoice_paid', period: 'paid:inv-1', dismissible: true,
      headline: 'Paid — Deposit ($500.00)', body: 'The deposit landed. You can start the work.', href: '/pipeline.html',
    };
    await installApp(page, { api: feedOf([PAID]) });
    await page.goto('/today.html');
    const row = page.locator('.feedcard .moment.todo');
    await expect(row.getByRole('button', { name: /^Got it/ })).toHaveCount(1);
    await expect(row.locator('.fcta')).toHaveCount(0);
    await expect(page.getByText('Take care of it →')).toHaveCount(0);
  });

  test('no serious/critical axe violations on the full Lightning Home', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'axe once, on desktop');
    await page.addInitScript(() => {
      localStorage.setItem('dds-recent-records', JSON.stringify([{ label: 'Marlow’s Kitchen', href: '/crm.html?client=abc-123', at: 1 }]));
    });
    await installApp(page, { api: { '/analytics/dashboard': DASH, '/bookings/appointments': apptsFixture(), ...PROJECTS_API } });
    await page.goto('/today.html');
    await expect(page.locator('#rail-month')).toBeVisible();
    await expect(page.locator('#rail-waiting')).toBeVisible();
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(serious.map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);
  });
});

// ── The studio home (2026-10 mockup): under the greeting, a money band when
// something is due, a four-tile stat strip, then This week · Coming up in the
// main column and a Customers card in the rail. Every piece keeps the
// "failure ≠ empty" rule: a failed read hides its piece, never a fake zero.
// One navigation per test: at phone widths a reload/second goto lands on the
// signed-out view (the stub session doesn't survive it — see the slice-10
// reload tests), and a click needs the one-time page hint out of the way.
const ymdOffset = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return new Intl.DateTimeFormat('en-CA').format(d); };
const SUMMARY = { data: {
  total: 3, open: { count: 2, value_cents: 650000 }, won_month: { count: 1, value_cents: 320000 },
  win_rate: { pct: 100, won: 1, lost: 0 }, by_stage: [], ar: { outstanding_cents: 160000, count: 1, overdue_cents: 0, overdue_count: 0 },
} };
const RECEIVABLES = { data: { items: [
  { id: 'inv-1', title: 'Deposit', amount_cents: 160000, due_date: '2099-01-10', overdue: false, deal_id: 'd1', deal: 'Claud Beltran', stripe_url: 'https://pay.example/x' },
], total_cents: 160000, overdue_cents: 0 } };
const FEED_WITH_ENQUIRIES = { data: {
  role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null,
  enquiries: [{ id: 'l1', name: 'Sam Rivera' }, { id: 'l2', name: 'Dana Lee' }],
} };
const NEXT_STEPS = () => ({ data: [
  { id: 'd1', title: 'Claud Beltran — website build', stage: 'contract', expected_value_cents: 320000, next_step: 'Send Claud the kickoff details', next_step_at: ymdOffset(0) },
  { id: 'd2', title: 'Bacchus Kitchen — menu refresh', stage: 'proposal', expected_value_cents: 450000, next_step: 'Collect content from Bacchus', next_step_at: ymdOffset(2) },
  { id: 'd3', title: 'Hettie Orange Designs — gallery', stage: 'qualified', expected_value_cents: 200000, next_step: 'Chase the gallery photos', next_step_at: ymdOffset(10) },
  { id: 'd4', title: 'Won already', stage: 'won', expected_value_cents: 999900, next_step: 'Open their project', next_step_at: ymdOffset(0) },
] });
const STUDIO_CUSTOMERS = { data: [
  { client_id: 'c1', name: 'Bacchus Kitchen', email: 'hi@bacchus.example', project_id: 'p1', project_name: 'Menu refresh', status: 'active', customer_site_id: 's1', open_support: 0, project_count: 1 },
  { client_id: 'c2', name: 'Hettie Orange Designs', email: 'hettie@example.com', project_id: 'p2', project_name: 'Gallery', status: 'on_hold', customer_site_id: null, open_support: 1, project_count: 1 },
] };
const BOOKINGS_AHEAD = () => ({ data: { appointments: [
  { id: 'b1', type_name: 'Kickoff call', slot_start_local: `${ymdOffset(0)}T14:30`, customer_name: 'Claud Beltran', status: 'confirmed' },   // today → the schedule, not Coming up
  { id: 'b2', type_name: 'Menu page review', slot_start_local: `${ymdOffset(3)}T10:00`, customer_name: 'Bacchus Kitchen', status: 'pending' },
  { id: 'b3', type_name: 'Gone', slot_start_local: `${ymdOffset(1)}T10:00`, status: 'canceled' },
], scope: 'upcoming', pending: 1 } });
const FULL_HOME = () => ({
  '/sales/summary': SUMMARY, '/sales/receivables': RECEIVABLES, '/sales/deals': NEXT_STEPS(), '/studio/customers': STUDIO_CUSTOMERS,
  '/portal/feed': FEED_WITH_ENQUIRIES, '/moments': { data: [] }, '/analytics/dashboard': DASH, '/bookings/appointments': BOOKINGS_AHEAD(),
});
// the one-time page hint floats over the main column at phone widths and the
// fixed bottom bar can park a target under itself — same dance as PT-2C
const clearTheWay = async (page: import('@playwright/test').Page, target: import('@playwright/test').Locator) => {
  await page.locator('.dds-hint').getByRole('button', { name: 'Got it' }).click();
  await target.evaluate((el) => el.scrollIntoView({ block: 'center' }));
};

test.describe('Today — the studio home (mockup)', () => {
  test('the money band: one open invoice → the amount, whose, Resend → the deal’s billing tab, Open record → the deal', async ({ page }) => {
    await installApp(page, { api: { '/sales/receivables': RECEIVABLES } });
    await page.goto('/today.html');
    const band = page.locator('#money-due');
    await expect(band).toBeVisible();
    await expect(band).toContainText('$1,600 is due now');
    await expect(band).toContainText('Claud Beltran’s invoice “Deposit” hasn’t been paid yet.');
    await expect(band.getByRole('link', { name: 'Resend invoice' })).toHaveAttribute('href', '/crm.html?deal=d1&tab=billing');
    await expect(band.getByRole('link', { name: 'Open record' })).toHaveAttribute('href', '/crm.html?deal=d1');
    // the band sits above the columns, under the greeting — not inside the feed
    expect(await band.evaluate((el) => el.nextElementSibling?.id)).toBe('home-cols');
    await expect(page.locator('.feedcard .moment.todo')).toHaveCount(2);   // the feed is untouched
  });

  test('the money band: several invoices total up and route to Who owes you', async ({ page }) => {
    await installApp(page, { api: { '/sales/receivables': { data: { items: [
      { id: 'inv-1', title: 'Deposit', amount_cents: 160000, due_date: '2026-10-01', overdue: true, deal_id: 'd1', deal: 'Claud Beltran', stripe_url: null },
      { id: 'inv-2', title: 'Balance', amount_cents: 90000, due_date: null, overdue: false, deal_id: 'd2', deal: 'Bacchus Kitchen', stripe_url: null },
    ], total_cents: 250000, overdue_cents: 160000 } } } });
    await page.goto('/today.html');
    const band = page.locator('#money-due');
    await expect(band).toContainText('$2,500 is due now');
    await expect(band).toContainText('2 invoices are waiting on payment, 1 of them overdue.');
    await expect(band.getByRole('link', { name: 'Who owes you' })).toHaveAttribute('href', '/pipeline.html');
    await expect(band.getByRole('link', { name: 'Resend invoice' })).toHaveCount(0);
  });

  test('the money band: a lone overdue invoice says so and names the date it was due', async ({ page }) => {
    await installApp(page, { api: { '/sales/receivables': { data: { items: [
      { id: 'inv-1', title: 'Deposit', amount_cents: 160000, due_date: '2026-10-01', overdue: true, deal_id: 'd1', deal: 'Claud Beltran', stripe_url: null },
    ], total_cents: 160000, overdue_cents: 160000 } } } });
    await page.goto('/today.html');
    await expect(page.locator('#money-due')).toContainText('$1,600 is overdue — Claud Beltran’s invoice “Deposit” was due Oct 1 and hasn’t been paid yet.');
  });

  // Oct 2026 benchmark (item 2): the four money buckets under the band's line,
  // from ONE list through the one formula (moneyState, mirrored from
  // lib/money_state.ts) — Paid (the last 30 days, shipped as `paid`) ·
  // Processing · Upcoming · Overdue. A processing payment is "on its way",
  // never "due now"; a payload without `paid` (an older function build)
  // shows no Paid bucket rather than a fake $0.
  test('the money band: four buckets from one list — Paid (30 days) · Processing · Upcoming · Overdue — in four colours; processing money is on its way, not due', async ({ page }) => {
    await installApp(page, { api: { '/sales/receivables': { data: { items: [
      { id: 'inv-1', title: 'Deposit', amount_cents: 160000, due_date: '2026-10-01', status: 'open', state: 'overdue', overdue: true, deal_id: 'd1', deal: 'Claud Beltran', stripe_url: null },
      { id: 'inv-2', title: 'Balance', amount_cents: 90000, due_date: '2099-01-10', status: 'open', state: 'upcoming', overdue: false, deal_id: 'd2', deal: 'Bacchus Kitchen', stripe_url: null },
      { id: 'inv-3', title: 'Photos', amount_cents: 40000, due_date: null, status: 'open', state: 'processing', processing_since: '2026-10-19T00:00:00Z', overdue: false, deal_id: 'd3', deal: 'Hettie Orange', stripe_url: 'https://pay.example/3' },
    ], paid: [
      { id: 'inv-0', title: 'Kickoff', amount_cents: 120000, status: 'paid', state: 'paid', paid_at: '2026-10-15T00:00:00Z', deal_id: 'd1', deal: 'Claud Beltran' },
    ], paid_window_days: 30, total_cents: 250000, overdue_cents: 160000, processing_cents: 40000 } } } });
    await page.goto('/today.html');
    const band = page.locator('#money-due');
    await expect(band).toContainText('$2,500 is due now — 2 invoices are waiting on payment, 1 of them overdue. $400 more is processing.');
    await expect(band.locator('[data-bucket="paid"]')).toHaveText('$1,200 Paid (30 days)');
    await expect(band.locator('[data-bucket="processing"]')).toHaveText('$400 Processing');
    await expect(band.locator('[data-bucket="upcoming"]')).toHaveText('$900 Upcoming');
    await expect(band.locator('[data-bucket="overdue"]')).toHaveText('$1,600 Overdue');
    const colours = await Promise.all(['paid', 'processing', 'upcoming', 'overdue'].map((k) => band.locator(`[data-bucket="${k}"] b`).evaluate((el) => getComputedStyle(el).color)));
    expect(new Set(colours).size).toBe(4);   // one colour per state
    await expect(band.getByRole('link', { name: 'Who owes you' })).toHaveAttribute('href', '/pipeline.html');
  });

  test('the money band: only processing money says "on its way" and chases nothing; an older payload without `paid` shows no Paid bucket (never a fake $0)', async ({ page }) => {
    await installApp(page, { api: { '/sales/receivables': { data: { items: [
      { id: 'inv-3', title: 'Photos', amount_cents: 40000, due_date: null, overdue: false, processing_since: '2026-10-19T00:00:00Z', deal_id: 'd3', deal: 'Hettie Orange', stripe_url: null },
    ], total_cents: 0, overdue_cents: 0 } } } });
    await page.goto('/today.html');
    const band = page.locator('#money-due');
    await expect(band).toContainText('$400 is on its way — a payment is processing; nothing to chase.');
    await expect(band.getByRole('link', { name: 'Resend invoice' })).toHaveCount(0);
    await expect(band.locator('[data-bucket="paid"]')).toHaveCount(0);
    await expect(band.locator('[data-bucket="processing"]')).toHaveText('$400 Processing');
    await expect(band.locator('[data-bucket="upcoming"]')).toHaveText('$0 Upcoming');
    await expect(band.locator('[data-bucket="overdue"]')).toHaveText('$0 Overdue');
  });

  test('the money band hides on an empty list', async ({ page }) => {
    await installApp(page, { api: { '/sales/receivables': { data: { items: [], total_cents: 0, overdue_cents: 0 } } } });
    await page.goto('/today.html');
    await expect(page.locator('.feedcard')).toBeVisible();
    await expect(page.locator('#money-due')).toHaveCount(0);
  });

  test('the money band hides on a failed read — a 5xx never paints "nothing is due" (failure ≠ empty)', async ({ page }) => {
    await installApp(page);
    await page.route('**/functions/v1/presence/sales/receivables**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) }));
    await page.goto('/today.html');
    await expect(page.locator('.feedcard')).toBeVisible();   // the page stands…
    await expect(page.locator('#money-due')).toHaveCount(0); // …and says nothing about money either way
    await expect(page.getByText('$0', { exact: true })).toHaveCount(0);
  });

  test('the stat strip: four icon tiles from /sales/summary + the feed’s enquiries, each linking where it drills', async ({ page }) => {
    await installApp(page, { api: { '/sales/summary': SUMMARY, '/portal/feed': FEED_WITH_ENQUIRIES, '/moments': { data: [] } } });
    await page.goto('/today.html');
    const strip = page.locator('#stat-strip');
    await expect(strip).toBeVisible();
    await expect(strip.locator('.hl')).toHaveCount(4);
    const owed = strip.locator('#stat-owed');
    await expect(owed).toContainText('Outstanding');
    await expect(owed.locator('.hl-v')).toHaveText('$1,600');
    await expect(owed.locator('.hl-s')).toHaveText('1 invoice');
    await expect(owed.locator('.ico')).toHaveClass(/warn/);
    await expect(owed).toHaveAttribute('href', '/pipeline.html');
    const won = strip.locator('#stat-won');
    await expect(won).toContainText('Won this month');
    await expect(won.locator('.hl-v')).toHaveText('$3,200');
    await expect(won.locator('.hl-s')).toHaveText('1 deal');
    const open = strip.locator('#stat-open');
    await expect(open.locator('.hl-v')).toHaveText('2');
    await expect(open.locator('.hl-s')).toHaveText('$6,500 in play');
    const enq = strip.locator('#stat-enq');
    await expect(enq).toContainText('New enquiries');
    await expect(enq.locator('.hl-v')).toHaveText('2');
    await expect(enq.locator('.hl-s')).toHaveText('Waiting for a reply');
    await expect(enq).toHaveAttribute('href', '/inbox.html#enquiries');
    // the strip sits under the greeting, above the two columns
    expect(await strip.evaluate((el) => el.nextElementSibling?.id)).toBe('home-cols');
  });

  test('the stat strip: a successful read’s zeros are REAL and read calmly', async ({ page }) => {
    await installApp(page, { api: {
      '/sales/summary': { data: { total: 0, open: { count: 0, value_cents: 0 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 }, by_stage: [], ar: { outstanding_cents: 0, count: 0, overdue_cents: 0, overdue_count: 0 } } },
      '/portal/feed': { data: { ...FEED_WITH_ENQUIRIES.data, enquiries: [] } }, '/moments': { data: [] },
    } });
    await page.goto('/today.html');
    const strip = page.locator('#stat-strip');
    await expect(strip.locator('.hl')).toHaveCount(4);
    await expect(strip.locator('#stat-owed .hl-s')).toHaveText('All paid up');
    await expect(strip.locator('#stat-won .hl-s')).toHaveText('Nothing closed yet');
    await expect(strip.locator('#stat-open .hl-v')).toHaveText('0');
    await expect(strip.locator('#stat-open .hl-s')).toHaveText('Pipeline is clear');
    await expect(strip.locator('#stat-enq .hl-s')).toHaveText('Nothing new');
  });

  test('the stat strip: a 403 summary (sales-less edition) keeps only the enquiries tile — never three $0s', async ({ page }) => {
    await installApp(page, { api: { '/portal/feed': FEED_WITH_ENQUIRIES, '/moments': { data: [] } } });
    await page.route('**/functions/v1/presence/sales/summary**', (route) =>
      route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'forbidden' }) }));
    await page.goto('/today.html');
    await expect(page.locator('#stat-strip .hl')).toHaveCount(1);
    await expect(page.locator('#stat-enq')).toBeVisible();
    await expect(page.getByText('$0', { exact: true })).toHaveCount(0);
  });

  test('the stat strip: nothing honest to show → no strip at all', async ({ page }) => {
    // the default feed carries no enquiries array (older build / failed read) and the summary read fails
    await installApp(page);
    await page.route('**/functions/v1/presence/sales/summary**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) }));
    await page.goto('/today.html');
    await expect(page.locator('.feedcard')).toBeVisible();
    await expect(page.locator('#stat-strip')).toHaveCount(0);
  });

  test('This week: the next step on each OPEN deal due inside the week, soonest first, each with ONE Done', async ({ page }) => {
    await installApp(page, { api: { '/sales/deals': NEXT_STEPS() } });
    await page.goto('/today.html');
    const week = page.locator('#this-week');
    await expect(week).toBeVisible();
    await expect(week.getByRole('heading', { name: 'This week' })).toBeVisible();
    const rows = week.locator('.trow');
    await expect(rows).toHaveCount(2);                                     // d3 is 10 days out → Coming up; d4 is won → never a to-do
    await expect(rows.nth(0)).toContainText('Send Claud the kickoff details');
    await expect(rows.nth(0).locator('.fmeta')).toHaveText('Claud Beltran — website build');
    // Oct 2026 Today board: the one "Due today" chip sits only on the row due today; the right-hand column carries the time or the day word
    await expect(rows.nth(0).locator('.tdue')).toHaveText('Due today');
    await expect(rows.nth(1).locator('.tdue')).toHaveCount(0);
    await expect(rows.nth(1).locator('.tat')).toHaveText(/^(Tomorrow|[A-Z][a-z]{2})$/);   // d2 is two days out → a day word, tabular, at the right
    await expect(week.locator('.tdue')).toHaveCount(1);
    await expect(rows.nth(0).locator('a.frow')).toHaveAttribute('href', '/crm.html?deal=d1');
    await expect(rows.nth(1)).toContainText('Collect content from Bacchus');
    await expect(week.getByText('Nothing overdue.')).toBeVisible();
    await expect(week.getByText('Open their project')).toHaveCount(0);
    await expect(rows.locator('button[data-todo-done]')).toHaveCount(2);
    // the row is a CONTAINER: the link and its Done button are siblings (never a button inside an anchor)
    await expect(week.locator('a button')).toHaveCount(0);
    expect(await rows.first().evaluate((el) => Array.from(el.children).map((c) => c.tagName).join(','))).toBe('A,BUTTON');
  });

  test('This week: Done clears the step on the deal (the existing per-deal PATCH) and removes the row; the last one takes the section', async ({ page }) => {
    const patched: Array<{ url: string; body: string }> = [];
    await installApp(page, { api: { '/sales/deals': NEXT_STEPS() } });
    await page.route('**/functions/v1/presence/sales/deals/*', async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      patched.push({ url: route.request().url(), body: route.request().postData() || '' });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { id: 'd1', next_step: null } }) });
    });
    await page.goto('/today.html');
    const rows = page.locator('#this-week .trow');
    await expect(rows).toHaveCount(2);
    const done = rows.nth(0).getByRole('button', { name: /^Done/ });
    await clearTheWay(page, done);
    await done.click();
    await expect(rows).toHaveCount(1);
    expect(patched.length).toBe(1);
    expect(patched[0].url).toMatch(/\/sales\/deals\/d1$/);
    expect(JSON.parse(patched[0].body)).toEqual({ next_step: '', next_step_at: '' });
    // the last Done takes the (now empty) section with it
    const last = rows.nth(0).getByRole('button', { name: /^Done/ });
    await last.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await last.click();
    await expect(page.locator('#this-week')).toHaveCount(0);
  });

  test('This week: an overdue step is named (and sorts first), an undated one sorts last, and the calm line goes', async ({ page }) => {
    await installApp(page, { api: { '/sales/deals': { data: [
      { id: 'd8', title: 'No date', stage: 'lead', expected_value_cents: 1000, next_step: 'Write the proposal', next_step_at: null },
      { id: 'd9', title: 'Late one', stage: 'lead', expected_value_cents: 1000, next_step: 'Call them back', next_step_at: '2026-01-05' },
    ] } } });
    await page.goto('/today.html');
    const week = page.locator('#this-week');
    const rows = week.locator('.trow');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveClass(/late/);
    await expect(rows.nth(0)).toContainText('Overdue · Jan 5');
    await expect(rows.nth(1)).toContainText('No date set');          // undated sorts last
    await expect(week.getByText('Nothing overdue.')).toHaveCount(0);
  });

  test('This week: a failed Done keeps the row and brings the button back', async ({ page }) => {
    await installApp(page, { api: { '/sales/deals': { data: [
      { id: 'd9', title: 'Late one', stage: 'lead', expected_value_cents: 1000, next_step: 'Call them back', next_step_at: '2026-01-05' },
    ] } } });
    await page.route('**/functions/v1/presence/sales/deals/*', (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) })
        : route.fallback());
    await page.goto('/today.html');
    const rows = page.locator('#this-week .trow');
    await expect(rows).toHaveCount(1);
    const done = rows.nth(0).getByRole('button', { name: /^Done/ });
    await clearTheWay(page, done);
    await done.click();
    await expect(rows).toHaveCount(1);                                 // the write failed → the row stays…
    await expect(done).toBeEnabled();                                  // …and the button comes back
  });

  test('Coming up: a booking after today and a next step dated beyond the week, soonest first', async ({ page }) => {
    await installApp(page, { api: { '/sales/deals': NEXT_STEPS(), '/bookings/appointments': BOOKINGS_AHEAD() } });
    await page.goto('/today.html');
    const up = page.locator('#coming-up');
    await expect(up).toBeVisible();
    await expect(up.getByRole('heading', { name: 'Coming up' })).toBeVisible();
    const rows = up.locator('.mrow');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('Menu page review · Bacchus Kitchen');
    await expect(rows.nth(0)).toContainText('10:00 am · to confirm');
    await expect(rows.nth(0)).toHaveAttribute('href', '/presence.html#bookings');
    await expect(rows.nth(0).locator('.md b')).toHaveText(String(Number(ymdOffset(3).slice(8, 10))));
    await expect(rows.nth(1)).toContainText('Chase the gallery photos');
    await expect(rows.nth(1)).toContainText('Hettie Orange Designs — gallery · next step on the deal');
    await expect(rows.nth(1)).toHaveAttribute('href', '/crm.html?deal=d3');
    await expect(up.getByText('Kickoff call')).toHaveCount(0);
    await expect(up.getByText('Gone')).toHaveCount(0);
    await expect(page.locator('#today-schedule')).toContainText('Kickoff call');   // today's booking still lives in the schedule
  });

  test('This week and Coming up hide entirely when nothing is in play — no empty cards', async ({ page }) => {
    await installApp(page);   // default fixtures: no deals list, no bookings
    await page.goto('/today.html');
    await expect(page.locator('.feedcard')).toBeVisible();
    await expect(page.locator('#coming-up')).toHaveCount(0);
    await expect(page.locator('#this-week')).toHaveCount(0);
  });

  test('the Customers card: the studio roster in the rail, addressed by site or client id', async ({ page }) => {
    await installApp(page, { api: { '/studio/customers': STUDIO_CUSTOMERS } });
    await page.goto('/today.html');
    const card = page.locator('#rail-customers');
    await expect(card).toBeVisible();
    await expect(card.getByRole('heading', { name: 'Customers' })).toBeVisible();
    const rows = card.locator('.crows a');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('Bacchus Kitchen');
    await expect(rows.nth(0)).toContainText('Active · All clear');
    await expect(rows.nth(0)).toHaveAttribute('href', '/crm.html?client=s1');       // a customer with a site → by site
    await expect(rows.nth(0).locator('.cav')).toHaveText('BK');
    await expect(rows.nth(1)).toContainText('Hettie Orange Designs');
    await expect(rows.nth(1)).toContainText('On hold · 1 waiting');
    await expect(rows.nth(1)).toHaveAttribute('href', '/crm.html?client_id=c2');    // no site yet → by client id
    await expect(card.getByRole('link', { name: 'All customers →' })).toHaveAttribute('href', '/customers.html');
    // the rail is the card's home — it comes first, before This month
    expect(await card.evaluate((el) => el.parentElement?.id)).toBe('col-rail');
  });

  test('the Customers card hides on an empty roster (and, with nothing else in the rail, so does the rail)', async ({ page }) => {
    await installApp(page, { api: { '/studio/customers': { data: [] } } });
    await page.route('**/functions/v1/presence/analytics/dashboard**', (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not_found' }) }));
    await page.goto('/today.html');
    await expect(page.locator('.feedcard')).toBeVisible();
    await expect(page.locator('#rail-customers')).toHaveCount(0);
    await expect(page.locator('#col-rail')).toBeHidden();
  });

  test('a drilled-in operator (?client=) never reads the studio roster, and the band/strip/week links carry the scope', async ({ page }) => {
    const CLIENT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    const reads: string[] = [];
    page.on('request', (req) => { if (/\/functions\/v1\/presence\/studio\/customers/.test(req.url())) reads.push(req.url()); });
    await installApp(page, { api: { '/studio/customers': STUDIO_CUSTOMERS, '/sales/receivables': RECEIVABLES, '/sales/summary': SUMMARY, '/sales/deals': NEXT_STEPS() } });
    await page.goto(`/today.html?client=${CLIENT}`);
    await expect(page.locator('#stat-strip')).toBeVisible();
    await expect(page.locator('#rail-customers')).toHaveCount(0);
    expect(reads).toEqual([]);   // D7: the scope header would resolve the roster against the leaf site and blank it
    await expect(page.locator('#money-due').getByRole('link', { name: 'Resend invoice' })).toHaveAttribute('href', `/crm.html?deal=d1&tab=billing&client=${CLIENT}`);
    await expect(page.locator('#stat-owed')).toHaveAttribute('href', `/pipeline.html?client=${CLIENT}`);
    await expect(page.locator('#this-week .trow').first().locator('a.frow')).toHaveAttribute('href', `/crm.html?deal=d1&client=${CLIENT}`);
  });

  test('no serious/critical axe violations with the mockup sections in play', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'axe once, on desktop');
    await installApp(page, { api: FULL_HOME() });
    await page.goto('/today.html');
    await expect(page.locator('#money-due')).toBeVisible();
    await expect(page.locator('#stat-strip')).toBeVisible();
    await expect(page.locator('#this-week')).toBeVisible();
    await expect(page.locator('#coming-up')).toBeVisible();
    await expect(page.locator('#rail-customers')).toBeVisible();
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(serious.map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);
  });

  test('mobile: band, strip, This week and Coming up stack without horizontal overflow', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'the stacked check is the <980px contract');
    await installApp(page, { api: FULL_HOME() });
    await page.goto('/today.html');
    await expect(page.locator('#money-due')).toBeVisible();
    await expect(page.locator('#stat-strip')).toBeVisible();
    await expect(page.locator('#coming-up')).toBeVisible();
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
