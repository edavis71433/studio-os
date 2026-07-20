import { test, expect, Page } from '@playwright/test';
import { installApp } from './helpers/app';

// SS8 (standards sweep) — attention.html wears the shared cms-family chrome:
// .lhead-lite (icon · count meta · "Updated just now" · ↻ soft refresh) under
// REQ_SEQ, group labels as real <h2> headings, trouble() with Try again wired
// to load() in place, distinct 401/403/404 copy, and the scope-carry +
// all-clear anatomy untouched.
//
// Fixtures match the REAL GET /attention payload — buildAttentionCenter() in
// supabase/functions/presence/lib/attention_center.ts returns
// { status, headline, needs_count, groups:[{ key, label, cards:[{ tone, icon,
// title, why, action_label, action_href }] }] } and routes/attention.ts wraps
// it as { data: ... }.
const ATTENTION = { data: {
  status: 'needs_attention', headline: '2 things need your attention.', needs_count: 2,
  groups: [
    { key: 'needs_attention', label: 'Needs attention', cards: [
      { tone: 'needs_attention', icon: '✉️', title: 'A new enquiry came in', why: 'Someone reached out through your website and is waiting to hear back.', action_label: 'Read it', action_href: '/leads.html' },
      { tone: 'needs_attention', icon: '📤', title: 'Your changes are ready to publish', why: 'You’ve made edits that aren’t live yet — publish when you’re happy with them.', action_label: 'Review & publish', action_href: '/presence.html#history' },
    ] },
    { key: 'coming_soon', label: 'Coming soon', cards: [
      { tone: 'coming_soon', icon: '🗓️', title: 'A publish is scheduled tomorrow', why: 'Your changes will go live automatically — nothing to do.', action_label: 'View', action_href: '/presence.html#history' },
    ] },
  ],
} };
const ALL_CLEAR = { data: { status: 'all_clear', headline: 'Everything looks good.', needs_count: 0, groups: [] } };

const ATT_RE = /\/functions\/v1\/presence\/attention/;
const ok = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const boom = (status: number) => ({ status, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) });

const trackErrors = (page: Page, errors: string[]) => {
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
};

test.describe('Attention center — family chrome', () => {
  test('boots under the family chrome: one h1, .lhead count meta + refresh — zero console errors', async ({ page }) => {
    const errors: string[] = [];
    trackErrors(page, errors);
    await installApp(page, { api: { '/attention': ATTENTION } });
    await page.goto('/attention.html');
    await expect(page.getByRole('heading', { level: 1, name: 'What needs you' })).toBeVisible();
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('.lhead .lmeta')).toContainText('2 need you · Updated just now');
    await expect(page.locator('#refreshBtn')).toBeVisible();
    await expect(page.locator('.card .ctitle').first()).toHaveText('A new enquiry came in');
    expect(errors).toEqual([]);
  });

  test('group labels are real headings (h2), not styled paragraphs', async ({ page }) => {
    await installApp(page, { api: { '/attention': ATTENTION } });
    await page.goto('/attention.html');
    await expect(page.getByRole('heading', { level: 2, name: 'Needs attention' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Coming soon' })).toBeVisible();
  });

  test('all clear keeps its anatomy and the meta says so', async ({ page }) => {
    await installApp(page, { api: { '/attention': ALL_CLEAR } });
    await page.goto('/attention.html');
    await expect(page.getByText('Everything looks good.')).toBeVisible();
    await expect(page.locator('.lhead .lmeta')).toContainText('All clear');
    await expect(page.locator('h1')).toHaveCount(1);
  });

  test('a failed load renders trouble with Try again wired to load() in place', async ({ page }) => {
    await installApp(page, { api: {} });
    let calls = 0;
    await page.route(ATT_RE, (route) => route.fulfill(++calls === 1 ? boom(500) : ok(ATTENTION)));
    await page.goto('/attention.html');
    const retry = page.getByRole('button', { name: /try again/i });
    await expect(retry).toBeVisible();
    await retry.click();   // no reload — load() runs in place
    await expect(page.locator('.card .ctitle').first()).toHaveText('A new enquiry came in');
    expect(calls).toBe(2);
  });

  test('↻ soft refresh keeps the last good render when the re-read fails', async ({ page }) => {
    await installApp(page, { api: {} });
    let calls = 0;
    await page.route(ATT_RE, (route) => route.fulfill(++calls === 1 ? ok(ATTENTION) : boom(500)));
    await page.goto('/attention.html');
    await expect(page.locator('.card .ctitle').first()).toHaveText('A new enquiry came in');
    await page.locator('#refreshBtn').click();
    // the failed refresh must NOT destroy the list into a full-page error
    await expect(page.locator('.card .ctitle').first()).toHaveText('A new enquiry came in');
    await expect(page.getByText(/Couldn.t refresh just now/)).toBeVisible();
  });

  test('403 renders its own workspace copy — never the generic hiccup, never the all-clear', async ({ page }) => {
    await installApp(page, { api: {} });
    await page.route(ATT_RE, (route) => route.fulfill(boom(403)));
    await page.goto('/attention.html');
    await expect(page.getByText(/this account can.t see this website/i)).toBeVisible();
    await expect(page.getByText('Everything looks good.')).toBeHidden();
    await expect(page.getByText(/couldn.t check just now/i)).toBeHidden();
    // no empty chrome over a failure state (hidden must beat the .lhead display rule)
    await expect(page.locator('.lhead')).toBeHidden();
  });

  test('404 renders its own not-found copy, distinct from trouble', async ({ page }) => {
    await installApp(page, { api: {} });
    await page.route(ATT_RE, (route) => route.fulfill(boom(404)));
    await page.goto('/attention.html');
    await expect(page.getByText(/couldn.t find this website/i)).toBeVisible();
    await expect(page.getByText(/couldn.t check just now/i)).toBeHidden();
  });

  test('signed out renders the sign-in invitation', async ({ page }) => {
    await installApp(page, { session: null, api: {} });
    await page.goto('/attention.html');
    await expect(page.getByText('Sign in to see what needs you.')).toBeVisible();
  });

  test('?client= scope is carried onto card actions (SC-1)', async ({ page }) => {
    await installApp(page, { api: { '/attention': ATTENTION } });
    await page.goto('/attention.html?client=marlows');
    const act = page.locator('.card a.act').first();
    await expect(act).toHaveAttribute('href', /client=marlows/);
  });
});
