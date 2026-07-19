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
    await expect(page.locator('.moment.todo').first()).toHaveAttribute('href', '/leads.html');
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
    await expect(page.getByRole('link', { name: 'Take a look →' })).toHaveAttribute('href', '/leads.html');
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
// the schedule filters on the page's own local date — build today's ymd the same way
const _d = new Date();
const TODAY_YMD = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, '0')}-${String(_d.getDate()).padStart(2, '0')}`;
const APPTS = { data: { appointments: [
  { id: 'b1', type_name: 'Strategy call', slot_start_local: `${TODAY_YMD}T14:30`, customer_name: 'Sam Rivera', status: 'confirmed' },
  { id: 'b2', type_name: 'Intro chat', slot_start_local: `${TODAY_YMD}T09:00`, customer_name: 'Dana Lee', status: 'pending' },
  { id: 'b3', type_name: 'Next week', slot_start_local: '2099-01-05T10:00', customer_name: 'Future', status: 'confirmed' },
], scope: 'upcoming', pending: 1 } };
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
    const rows = feed.locator('a.moment.todo');
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
    const rows = page.locator('.feedcard a.moment.todo');
    await expect(rows.first()).toHaveAttribute('href', `/leads.html?client=${CLIENT}`);
    await expect(rows.nth(1)).toHaveAttribute('href', `/presence.html?client=${CLIENT}#foundations`);
  });

  test('the This-month rail card renders real dashboard numbers with a Dashboard → footer', async ({ page }) => {
    await installApp(page, { api: { '/analytics/dashboard': DASH } });
    await page.goto('/today.html');
    const card = page.locator('#rail-month');
    await expect(card).toBeVisible();
    await expect(card.getByText('$3,850')).toBeVisible();
    await expect(card.getByText('won this month')).toBeVisible();
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
    await expect(page.locator('.feedcard a.moment.todo')).toHaveCount(2); // the feed is unharmed
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
    await installApp(page, { api: { '/bookings/appointments': APPTS } });
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

  test('schedule: a confirmed-empty day is friendly; an unreachable read is honest', async ({ page }) => {
    await installApp(page, { api: { '/bookings/appointments': { data: { appointments: [], scope: 'upcoming', pending: 0 } } } });
    await page.goto('/today.html');
    await expect(page.locator('#today-schedule')).toContainText('Nothing booked for today — the day is yours.');
    // now the route 404s (an edition without bookings / older build) — say we couldn't check
    await page.route('**/functions/v1/presence/bookings/appointments**', (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not_found' }) }));
    await page.reload();
    await expect(page.locator('#today-schedule')).toContainText('We couldn’t check your bookings just now');
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
    await page.goto('/today.html');
    const card = page.locator('#rail-waiting');
    await expect(card).toBeVisible();
    await expect(card.getByText('Waiting on clients')).toBeVisible();
    const row = card.locator('.rrows a');
    await expect(row).toHaveCount(1); // only p1 has pending approvals; complete p2 is never fetched
    await expect(row).toContainText('Acme website build');
    await expect(row).toContainText('2 approvals');
    await expect(row).toHaveAttribute('href', '/projects.html?project=p1');
  });

  test('Waiting on clients stays hidden when nothing is pending', async ({ page }) => {
    await installApp(page, { api: { ...PROJECTS_API, '/projects/p1/report': { data: { summary: { pending_approvals: 0 } } } } });
    await page.goto('/today.html');
    await expect(page.locator('.feedcard')).toBeVisible();
    await expect(page.locator('#rail-waiting')).toBeHidden();
  });

  test('a calm "Everything else looks good" line when needs exist but nothing more is worth a look', async ({ page }) => {
    await installApp(page, { api: { '/moments': { data: [] } } });
    await page.goto('/today.html');
    await expect(page.locator('.feedcard a.moment.todo')).toHaveCount(2);
    await expect(page.getByText('Everything else looks good.')).toBeVisible();
  });

  test('mobile: the full home (feed + rail cards) stacks without horizontal overflow', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'the stacked-columns check is the <980px contract');
    await installApp(page, { api: { '/analytics/dashboard': DASH, '/bookings/appointments': APPTS, ...PROJECTS_API } });
    await page.goto('/today.html');
    await expect(page.locator('.feedcard')).toBeVisible();
    await expect(page.locator('#rail-month')).toBeVisible();
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('no serious/critical axe violations on the full Lightning Home', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'axe once, on desktop');
    await page.addInitScript(() => {
      localStorage.setItem('dds-recent-records', JSON.stringify([{ label: 'Marlow’s Kitchen', href: '/crm.html?client=abc-123', at: 1 }]));
    });
    await installApp(page, { api: { '/analytics/dashboard': DASH, '/bookings/appointments': APPTS, ...PROJECTS_API } });
    await page.goto('/today.html');
    await expect(page.locator('#rail-month')).toBeVisible();
    await expect(page.locator('#rail-waiting')).toBeVisible();
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(serious.map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);
  });
});
