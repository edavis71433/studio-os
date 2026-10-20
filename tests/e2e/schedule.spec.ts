import { test, expect } from '@playwright/test';
import { installApp } from './helpers/app';

// ── Scheduled changes (schedule.html) ────────────────────────────────────────
// Visual refresh (2026-10): the page follows the approved board — breadcrumb,
// title + explainer, the Schedule-this-draft card (a date field, a time field,
// a note, Schedule publish) beside a Preview panel, and an Upcoming card with a
// calm empty state. The contract underneath is unchanged:
//   GET  /schedule               → { data: { scheduled: [row…] } }
//   POST /schedule               ← { scheduled_for: ISO, note }
//   POST /schedule/:id/cancel
// The date + time fields compose into ONE local moment; the ISO the route gets
// is that moment in UTC (asserted zone-independently below).

const EMPTY = { data: { scheduled: [] } };
const ONE = { data: { scheduled: [{ id: 'sc-1', kind: 'publish', scheduled_for: '2026-12-24T18:00:00Z', summary: 'Holiday hours' }] } };

test.describe('Scheduled changes', () => {
  test('renders the board: breadcrumb · title · date + time · note · Schedule publish · Preview · an empty Upcoming', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await installApp(page, { api: { '/schedule': EMPTY } });
    await page.goto('/schedule.html');
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(crumbs.getByRole('link', { name: 'Website' })).toHaveAttribute('href', '/presence.html');
    await expect(crumbs.locator('[aria-current="page"]')).toHaveText('Scheduled changes');
    await expect(page.getByRole('heading', { level: 1, name: 'Scheduled changes' })).toBeVisible();
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'View current draft →' })).toHaveAttribute('href', '/presence.html');
    // the schedule card
    await expect(page.getByRole('heading', { name: 'Schedule this draft' })).toBeVisible();
    await expect(page.locator('#when-date')).toHaveAttribute('type', 'date');
    await expect(page.locator('#when-time')).toHaveAttribute('type', 'time');
    await expect(page.locator('#when-time')).toHaveValue('10:00');
    await expect(page.locator('#note')).toHaveAttribute('placeholder', 'e.g. Holiday hours');
    await expect(page.locator('#add')).toHaveText(/Schedule publish/);
    // the preview panel beside it
    const pv = page.getByRole('complementary', { name: 'Preview' });
    await expect(pv.getByRole('link', { name: 'See exactly what will publish →' })).toHaveAttribute('href', '/presence.html?view=preview');
    await expect(pv.getByRole('link', { name: 'Open draft →' })).toHaveAttribute('href', '/presence.html');
    await expect(pv.locator('#pvWhen')).toContainText('Pick a date and time');
    // upcoming: calm, honest empty state
    await expect(page.getByRole('heading', { name: 'Upcoming' })).toBeVisible();
    await expect(page.locator('.empty')).toContainText('Nothing scheduled.');
    await expect(page.locator('.sch')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('the preview line follows the picked moment; Schedule publish POSTs the composed local moment as ISO + the note, then re-reads the list', async ({ page }) => {
    await installApp(page, { api: { '/schedule': EMPTY } });
    let reads = 0;
    await page.route((u) => /\/presence\/schedule$/.test(u.pathname), (route) => {
      if (route.request().method() === 'POST') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { message: 'Scheduled for Dec 24.' } }) });
      reads++;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reads === 1 ? EMPTY : ONE) });
    });
    await page.goto('/schedule.html');
    await page.locator('#when-date').fill('2026-12-24');
    await page.locator('#when-time').fill('10:30');
    await expect(page.locator('#pvWhen')).toContainText('Your changes will go live on');
    await expect(page.locator('#pvWhen')).toContainText('Dec 24, 2026');
    await expect(page.locator('#pvWhen')).toContainText('10:30 AM');
    await page.locator('#note').fill('Holiday hours');
    // the ISO the route must receive: the browser's own reading of that local moment
    const expectedIso = await page.evaluate(() => new Date('2026-12-24T10:30').toISOString());
    const posted = page.waitForRequest((r) => r.method() === 'POST' && /\/presence\/schedule$/.test(new URL(r.url()).pathname));
    await page.locator('#add').click();
    const req = await posted;
    expect(req.postDataJSON()).toEqual({ scheduled_for: expectedIso, note: 'Holiday hours' });
    await expect(page.locator('.dds-toast')).toContainText('Scheduled for Dec 24.');
    // the list re-read painted the row (and the empty state left)
    const row = page.locator('.sch');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Holiday hours');
    await expect(row.locator('.k')).toHaveText('Publish');
    await expect(page.locator('.empty')).toHaveCount(0);
    await expect(page.locator('#add')).toBeFocused();      // focus returns to the recreated control
  });

  test('an incomplete moment never posts: a missing date asks for one', async ({ page }) => {
    await installApp(page, { api: { '/schedule': EMPTY } });
    await page.goto('/schedule.html');
    let posts = 0;
    page.on('request', (r) => { if (r.method() === 'POST') posts++; });
    await page.locator('#when-date').fill('');
    await page.locator('#add').click();
    await expect(page.locator('.dds-toast')).toContainText('Pick a date and time.');
    expect(posts).toBe(0);
  });

  test('Cancel on an upcoming row POSTs /schedule/:id/cancel and the list re-reads', async ({ page }) => {
    await installApp(page, { api: { '/schedule': ONE } });
    let reads = 0;
    await page.route((u) => /\/presence\/schedule$/.test(u.pathname) && true, (route) => {
      reads++;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reads === 1 ? ONE : EMPTY) });
    });
    await page.goto('/schedule.html');
    const row = page.locator('.sch').filter({ hasText: 'Holiday hours' });
    await expect(row).toBeVisible();
    const canceled = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/schedule/sc-1/cancel'));
    await row.getByRole('button', { name: 'Cancel' }).click();
    await canceled;
    await expect(page.locator('.dds-toast')).toContainText('Canceled.');
    await expect(page.locator('.sch')).toHaveCount(0);
    await expect(page.locator('.empty')).toContainText('Nothing scheduled.');
  });

  test('signed-out shows a sign-in prompt, not the form', async ({ page }) => {
    await installApp(page, { session: null });
    await page.goto('/schedule.html');
    await expect(page.locator('#main').getByRole('link', { name: /Sign in/ })).toBeVisible();
    await expect(page.locator('#add')).toHaveCount(0);
  });

  test('a 403 says scheduling lives in the studio workspace (a client context has no draft to schedule)', async ({ page }) => {
    await installApp(page);
    await page.route((u) => /\/presence\/schedule$/.test(u.pathname), (route) =>
      route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'forbidden' }) }));
    await page.goto('/schedule.html');
    await expect(page.locator('#main')).toContainText('Scheduling lives in your studio workspace.');
    await expect(page.locator('#add')).toHaveCount(0);
  });
});
