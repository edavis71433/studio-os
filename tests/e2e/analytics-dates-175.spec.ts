import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp } from './helpers/app';

// Builder list item 175 (Nov 2026), borrowed from Squarespace. Analytics keeps its four
// quick windows and gains More dates beside them: Today, Yesterday, This week, Last week,
// Last month, This year, Last year, and two dates picked by hand. The window's own dates
// show under the title. Every number's name gets a "?" that opens one plain line saying
// what it counts; a press anywhere else, or Escape, closes it.
// The suite's browsers run on UTC (playwright.config.ts), and the page's clock is fixed at
// Friday Jul 17 2026, 15:30, so "today" is the same everywhere.

const NOW = '2026-07-17T15:30:00Z';
const dash = (period: string, window: Record<string, unknown>, visitors = 214) => ({ data: {
  period, window, generated_at: NOW,
  sales: {
    pipeline: { open: { count: 7, value_cents: 1240000 }, stages: [{ stage: 'lead', label: 'New lead', count: 7, value_cents: 1240000 }] },
    won: { this_month: { count: 2, value_cents: 385000 }, last_month: { count: 1, value_cents: 145000 } },
    enquiries: { count: 9, unanswered: 3, weekly: [2, 1, 3, 2, 4, 3, 5, 4, 6, 5, 7, 6] },
    support: { open: 4, oldest_age_days: 2 },
    invoices: null, recent_wins: [],
  },
  website: {
    traffic: { visitors, pageviews: 512, actions: 11, top_pages: [{ path: '/', views: 231 }], top_sources: [{ source: 'Google', visits: 88, share: 41 }], weekly: [10, 12, 11, 14, 13, 16, 15, 18, 17, 20, 19, 22], has_data: true },
    search: { clicks: 38, impressions: 4100, period: '2026-06', top_terms: [] },
  },
} });
const MONTH = dash('this_month', { start: '2026-07-01T00:00:00.000Z', end: NOW, closed: false });
const LAST_MONTH = dash('last_month', { start: '2026-06-01T00:00:00.000Z', end: '2026-07-01T00:00:00.000Z', closed: true }, 999);

async function open(page: Page, seen: URL[] = []) {
  await page.clock.setFixedTime(new Date(NOW));
  await installApp(page, { api: { '/analytics/dashboard': MONTH } });
  await page.route('**/functions/v1/presence/analytics/dashboard**', (route) => {
    const u = new URL(route.request().url());
    seen.push(u);
    const p = u.searchParams.get('period');
    if (p === 'last_month') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LAST_MONTH) });
    if (p === 'custom') {
      const from = u.searchParams.get('from')!, to = u.searchParams.get('to')!;
      const end = new Date(Date.parse(to + 'T00:00:00Z') + 86_400_000).toISOString();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dash('custom', { start: from + 'T00:00:00.000Z', end, closed: true, from, to }, 321)) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MONTH) });
  });
  await page.goto('/analytics.html');
  await expect(page.locator('#salesStats')).toContainText('$12,400');
}
const datesBtn = (page: Page) => page.locator('#datesBtn');
const panel = (page: Page) => page.locator('#datesPanel');

test.describe('Analytics: More dates (item 175)', () => {
  test('a preset loads its window: the button names it, the four quick ones let go, the dates show under the title', async ({ page }) => {
    const seen: URL[] = [];
    await open(page, seen);
    await expect(page.locator('#winDates')).toHaveText('Jul 1 to today');
    await expect(datesBtn(page)).toHaveText(/^More dates/);
    await expect(datesBtn(page)).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(panel(page)).toBeHidden();
    await datesBtn(page).click();
    await expect(datesBtn(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).locator('[data-more]')).toHaveText(['Today', 'Yesterday', 'This week', 'Last week', 'Last month', 'This year', 'Last year']);
    await expect(panel(page).locator('[data-more="today"]')).toBeFocused();   // nothing picked yet: the first one
    await panel(page).locator('[data-more="last_month"]').click();
    await expect(page.locator('#siteStats')).toContainText('999');   // re-read for that window
    const asked = seen[seen.length - 1];
    expect(asked.searchParams.get('period')).toBe('last_month');
    expect(asked.searchParams.get('tzo')).not.toBeNull();   // its midnights are this browser's
    await expect(datesBtn(page)).toHaveText(/^Last month/);
    await expect(datesBtn(page)).toHaveClass(/\bon\b/);
    await expect(datesBtn(page)).toBeFocused();
    await expect(page.locator('#period [aria-pressed="true"]')).toHaveCount(0);
    await expect(page.locator('#winDates')).toHaveText('Jun 1 to Jun 30');
    await expect(page.locator('#salesStats .stat', { has: page.locator('.kt', { hasText: /^New enquiries$/ }) }).locator('.w')).toHaveText(' · Last month');
    // back to a quick window
    await page.locator('#period [data-period="this_month"]').click();
    await expect(datesBtn(page)).toHaveText(/^More dates/);
    await expect(page.locator('#period [data-period="this_month"]')).toHaveAttribute('aria-pressed', 'true');
  });

  test('picked dates: wrong ones are said so and nothing is asked; good ones load and stay through Refresh', async ({ page }) => {
    const seen: URL[] = [];
    await open(page, seen);
    const before = seen.length;
    await datesBtn(page).click();
    await page.locator('#dFrom').fill('2026-06-17');
    await page.locator('#dTo').fill('2026-06-03');
    await page.getByRole('button', { name: 'Show these dates' }).click();
    await expect(page.locator('#dMsg')).toHaveText('The end date comes before the start date.');
    await page.locator('#dTo').fill('2026-07-18');
    await page.getByRole('button', { name: 'Show these dates' }).click();
    await expect(page.locator('#dMsg')).toHaveText('The end date can’t be after today.');
    expect(seen.length).toBe(before);   // nothing was asked for
    await page.locator('#dFrom').fill('2026-06-03');
    await page.locator('#dTo').fill('2026-06-17');
    await page.getByRole('button', { name: 'Show these dates' }).click();
    await expect(page.locator('#siteStats')).toContainText('321');
    const asked = seen[seen.length - 1];
    expect([asked.searchParams.get('period'), asked.searchParams.get('from'), asked.searchParams.get('to')]).toEqual(['custom', '2026-06-03', '2026-06-17']);
    await expect(datesBtn(page)).toHaveText(/^Jun 3 to Jun 17/);
    await expect(page.locator('#winDates')).toHaveText('Jun 3 to Jun 17');
    await expect(panel(page)).toBeHidden();
    // Refresh asks for the same dates again
    await page.locator('#refreshBtn').click();
    await expect.poll(() => seen.length).toBeGreaterThan(before + 1);
    const again = seen[seen.length - 1];
    expect([again.searchParams.get('period'), again.searchParams.get('from'), again.searchParams.get('to')]).toEqual(['custom', '2026-06-03', '2026-06-17']);
    // reopening shows the dates that are on
    await datesBtn(page).click();
    await expect(page.locator('#dFrom')).toHaveValue('2026-06-03');
    await expect(page.locator('#dTo')).toHaveValue('2026-06-17');
  });

  test('Escape closes the panel and hands focus back; a press elsewhere closes it too', async ({ page }) => {
    await open(page);
    await datesBtn(page).click();
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toBeHidden();
    await expect(datesBtn(page)).toBeFocused();
    await expect(datesBtn(page)).toHaveAttribute('aria-expanded', 'false');
    await datesBtn(page).click();
    await expect(panel(page)).toBeVisible();
    await page.getByRole('heading', { level: 1, name: 'Analytics' }).click();
    await expect(panel(page)).toBeHidden();
  });

  test('accessibility: the open panel, then an open "?" line, pass axe', async ({ page }) => {
    await open(page);
    const check = async () => {
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const serious = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
      expect(serious.map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);
    };
    await datesBtn(page).click();
    await expect(panel(page)).toBeVisible();
    await check();
    await page.keyboard.press('Escape');   // on a phone the panel sits over the tiles
    await page.locator('#siteStats .qx').first().click();
    await expect(page.locator('#siteStats .qpop').first()).toBeVisible();
    await check();
  });
});

test.describe('Analytics: "?" on every number (item 175)', () => {
  test('each tile has one; it opens one line saying what the number counts, one at a time', async ({ page }) => {
    await open(page);
    await expect(page.locator('#salesStats .qx')).toHaveCount(4);
    await expect(page.locator('#siteStats .qx')).toHaveCount(4);
    const pipe = page.getByRole('button', { name: 'What is “Open pipeline”?' });
    const visits = page.getByRole('button', { name: 'What is “Visits”?' });
    await pipe.click();
    await expect(pipe).toHaveAttribute('aria-expanded', 'true');
    const pipeNote = page.locator('#' + (await pipe.getAttribute('aria-controls')));
    await expect(pipeNote).toBeVisible();
    await expect(pipeNote).toHaveText(/^Every open deal added up/);
    await expect(pipeNote).toHaveAttribute('role', 'note');
    await visits.click();
    await expect(pipeNote).toBeHidden();
    await expect(pipe).toHaveAttribute('aria-expanded', 'false');
    const visitsNote = page.locator('#' + (await visits.getAttribute('aria-controls')));
    await expect(visitsNote).toContainText('A person counts once a day');
    // the name itself is unchanged, hover words and all (bug hunt H5)
    await expect(page.locator('#siteStats .kt', { hasText: /^Visits$/ })).toHaveAttribute('title', 'A person counts once a day: someone who comes back on three days is three visits.');
    await page.keyboard.press('Escape');
    await expect(visitsNote).toBeHidden();
    await expect(visits).toBeFocused();
    await visits.click();
    await expect(visitsNote).toBeVisible();
    await page.getByRole('heading', { level: 1, name: 'Analytics' }).click();
    await expect(visitsNote).toBeHidden();
  });

  test('touch: a tap opens the line, and the "?" is a full finger wide on a phone', { tag: '@touch' }, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'desktop-chromium', 'touch-only behaviour');
    await open(page);
    const q = page.getByRole('button', { name: 'What is “New enquiries”?' });
    await q.tap();
    await expect(page.locator('#' + (await q.getAttribute('aria-controls')))).toBeVisible();
    const box = await q.boundingBox();
    expect(box && box.width >= 44 && box.height >= 44).toBe(true);
  });
});
