import { test, expect, Page } from '@playwright/test';
import { installApp } from './helpers/app';

// SS8 (standards sweep) — website-health.html wears the shared cms-family
// chrome: .lhead-lite with an "As of {time}" freshness meta + ↻ soft refresh
// that keeps the last good render, trouble() with Try again, and THREE honest
// auth states — above all, a 403 must render its own workspace copy and never
// "nothing's wrong" (the permanent lie: refreshing never fixes a 403).
//
// Fixtures match the REAL GET /website-health payload — buildWebsiteHealth()
// in supabase/functions/presence/lib/website_health.ts returns { overall,
// headline, summary, ok_count, attention_count, categories:[{ key, label,
// checks:[{ title, why, state, status_label, action_label?, action_href? }] }] },
// and routes/health_page.ts spreads in content_performance
// (buildContentPerformance) before wrapping it all as { data: ... }.
const HEALTH = { data: {
  overall: 'attention', headline: 'A few things could use a look.', summary: '5 of 6 checks are working.',
  ok_count: 5, attention_count: 1,
  categories: [
    { key: 'content', label: 'Your content', checks: [
      { title: 'Your pages are filled in', why: 'Everything required is in place.', state: 'ok', status_label: 'Working' },
      { title: 'Your contact form', why: 'A message arrived recently — it works.', state: 'ok', status_label: 'Working' },
    ] },
    { key: 'reach', label: 'Being found', checks: [
      { title: 'Search engines', why: 'Your site isn’t verified with search yet.', state: 'attention', status_label: 'Needs a look', action_label: 'Set it up', action_href: '/presence.html#settings' },
    ] },
  ],
  content_performance: { enough: false, suggestions: [], note: 'We’ll show suggestions here once your site has had a few more visits.' },
} };

const WH_RE = /\/functions\/v1\/presence\/website-health/;
const ok = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const boom = (status: number) => ({ status, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) });

const trackErrors = (page: Page, errors: string[]) => {
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
};

test.describe('Website health — family chrome', () => {
  test('boots under the family chrome: one h1, "As of" freshness meta + refresh — zero console errors', async ({ page }) => {
    const errors: string[] = [];
    trackErrors(page, errors);
    await installApp(page, { api: { '/website-health': HEALTH } });
    await page.goto('/website-health.html');
    await expect(page.getByRole('heading', { level: 1, name: 'Website health' })).toBeVisible();
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('.lhead .lmeta')).toContainText('5 working · 1 worth a look');
    await expect(page.locator('.lhead .lmeta')).toContainText('As of');
    await expect(page.locator('#refreshBtn')).toBeVisible();
    await expect(page.locator('.verdict h2')).toHaveText('A few things could use a look.');
    expect(errors).toEqual([]);
  });

  test('403 renders its own workspace copy — NEVER "nothing\'s wrong", never the all-clear', async ({ page }) => {
    await installApp(page, { api: {} });
    await page.route(WH_RE, (route) => route.fulfill(boom(403)));
    await page.goto('/website-health.html');
    await expect(page.getByText(/this account can.t see this website.s health/i)).toBeVisible();
    // the old lie, pinned dead: a 403 must not claim "Nothing's wrong" or render healthy/setting-up
    await expect(page.getByText(/nothing.s wrong/i)).toBeHidden();
    await expect(page.getByText(/your website is being set up/i)).toBeHidden();
    await expect(page.locator('.verdict')).toBeHidden();
    // no empty chrome over a failure state (hidden must beat the .lhead display rule)
    await expect(page.locator('.lhead')).toBeHidden();
  });

  test('404 renders its own not-found copy, distinct from trouble', async ({ page }) => {
    await installApp(page, { api: {} });
    await page.route(WH_RE, (route) => route.fulfill(boom(404)));
    await page.goto('/website-health.html');
    await expect(page.getByText(/couldn.t find this website/i)).toBeVisible();
    await expect(page.getByText(/couldn.t run the check just now/i)).toBeHidden();
  });

  test('a failed check renders trouble with Try again wired to load() in place', async ({ page }) => {
    await installApp(page, { api: {} });
    let calls = 0;
    await page.route(WH_RE, (route) => route.fulfill(++calls === 1 ? boom(500) : ok(HEALTH)));
    await page.goto('/website-health.html');
    const retry = page.getByRole('button', { name: /try again/i });
    await expect(retry).toBeVisible();
    await retry.click();
    await expect(page.locator('.verdict h2')).toHaveText('A few things could use a look.');
    expect(calls).toBe(2);
  });

  test('↻ soft refresh keeps the last good render when the re-check fails', async ({ page }) => {
    await installApp(page, { api: {} });
    let calls = 0;
    await page.route(WH_RE, (route) => route.fulfill(++calls === 1 ? ok(HEALTH) : boom(500)));
    await page.goto('/website-health.html');
    await expect(page.locator('.verdict h2')).toHaveText('A few things could use a look.');
    await page.locator('#refreshBtn').click();
    await expect(page.locator('.verdict h2')).toHaveText('A few things could use a look.');
    await expect(page.getByText(/Couldn.t refresh just now/)).toBeVisible();
  });

  test('a slow check shows the stencil only after ~300ms, then the real render', async ({ page }) => {
    await installApp(page, { api: {} });
    await page.route(WH_RE, async (route) => {
      await new Promise((r) => setTimeout(r, 1200));
      await route.fulfill(ok(HEALTH));
    });
    await page.goto('/website-health.html');
    await expect(page.locator('.stencil')).toBeVisible();
    await expect(page.locator('.verdict h2')).toHaveText('A few things could use a look.');
    await expect(page.locator('.stencil')).toBeHidden();
  });

  test('signed out renders the sign-in invitation', async ({ page }) => {
    await installApp(page, { session: null, api: {} });
    await page.goto('/website-health.html');
    await expect(page.getByText('Sign in to check your website’s health.')).toBeVisible();
  });

  test('the empty/new site state still renders honestly (no categories yet)', async ({ page }) => {
    await installApp(page, { api: { '/website-health': { data: { overall: 'new', headline: '', summary: '', ok_count: 0, attention_count: 0, categories: [] } } } });
    await page.goto('/website-health.html');
    await expect(page.getByText('Your website is being set up.')).toBeVisible();
  });
});
