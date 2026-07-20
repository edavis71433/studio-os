import { test, expect, Page } from '@playwright/test';
import { installApp } from './helpers/app';

// SS8 (standards sweep) — content-tree.html wears the shared cms-family chrome:
// .lhead-lite roster header ("N pages · M sections · X to look at" · "Updated
// just now" · ↻ soft refresh under REQ_SEQ), live search with caret
// preservation, "Last published" on the shared rel-time vocabulary (never a raw
// ISO date), a section-row flex that never clips Edit at 360px, trouble() with
// Try again, and distinct 401/403/404 copy.
//
// Fixtures match the REAL GET /content-tree payload — buildContentTree() in
// supabase/functions/presence/lib/content_tree.ts returns { site_status,
// has_unpublished_changes, last_published_at, attention_count, pages:[{ key,
// label, path, status, status_label, issue_count, editor_link, auto,
// sections:[{ key, label, status, status_label, required, issue_count,
// editor_link }] }] }, wrapped as { data: ... } by routes/room.ts.
const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();

const TREE = { data: {
  site_status: 'live', has_unpublished_changes: false,
  last_published_at: daysAgo(3), attention_count: 0,
  pages: [
    { key: 'home', label: 'Home', path: '/', status: 'published', status_label: 'Published', issue_count: 0, editor_link: '/presence.html#content', auto: false, sections: [
      { key: 'hero', label: 'Welcome area', status: 'published', status_label: 'Published', required: true, issue_count: 0, editor_link: '/presence.html#content' },
      { key: 'specials', label: 'Weekly specials and seasonal highlights from the kitchen', status: 'needs_review', status_label: 'Worth a look', required: false, issue_count: 1, editor_link: '/presence.html#content' },
    ] },
    { key: 'menu', label: 'Menu', path: '/menu', status: 'draft_changes', status_label: 'Unpublished changes', issue_count: 0, editor_link: '/presence.html#menu', auto: false, sections: [
      { key: 'dishes', label: 'Dishes', status: 'draft_changes', status_label: 'Unpublished changes', required: true, issue_count: 0, editor_link: '/presence.html#menu' },
    ] },
    { key: 'privacy', label: 'Privacy', path: '/privacy', status: 'published', status_label: 'Published', issue_count: 0, editor_link: '', auto: true, sections: [] },
  ],
} };
const ATTN_TREE = { data: { ...TREE.data, attention_count: 2, last_published_at: daysAgo(3) } };

const CT_RE = /\/functions\/v1\/presence\/content-tree/;
const ok = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const boom = (status: number) => ({ status, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) });

const trackErrors = (page: Page, errors: string[]) => {
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
};

test.describe('Content tree — family chrome', () => {
  test('boots under the family chrome: one h1, roster count meta + refresh — zero console errors', async ({ page }) => {
    const errors: string[] = [];
    trackErrors(page, errors);
    await installApp(page, { api: { '/content-tree': TREE } });
    await page.goto('/content-tree.html');
    await expect(page.getByRole('heading', { level: 1, name: 'Your website map' })).toBeVisible();
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('.lhead .lmeta')).toContainText('3 pages · 3 sections · Updated just now');
    await expect(page.locator('#refreshBtn')).toBeVisible();
    await expect(page.locator('.summary .state')).toHaveText('Your site is live');
    expect(errors).toEqual([]);
  });

  test('the meta counts what needs a look', async ({ page }) => {
    await installApp(page, { api: { '/content-tree': ATTN_TREE } });
    await page.goto('/content-tree.html');
    await expect(page.locator('.lhead .lmeta')).toContainText('3 pages · 3 sections · 2 to look at');
  });

  test('"Last published" speaks the shared rel-time vocabulary, not a raw ISO date', async ({ page }) => {
    await installApp(page, { api: { '/content-tree': TREE } });
    await page.goto('/content-tree.html');
    await expect(page.locator('.summary .meta')).toHaveText('Last published 3 days ago');
  });

  test('live search filters the map and preserves focus + caret', async ({ page }) => {
    await installApp(page, { api: { '/content-tree': TREE } });
    await page.goto('/content-tree.html');
    const q = page.locator('.search');
    await q.click();
    await q.pressSequentially('menu');
    await expect(page.getByRole('heading', { level: 2, name: /Menu/ })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: /Home/ })).toBeHidden();
    // the input node is never rebuilt by a search re-render — focus and caret survive
    await expect(q).toBeFocused();
    expect(await q.evaluate((el: HTMLInputElement) => el.selectionStart)).toBe(4);
    // honest empty state
    await q.fill('zzzz');
    await expect(page.getByText(/No pages match/)).toBeVisible();
    await q.fill('');
    await expect(page.getByRole('heading', { level: 2, name: /Home/ })).toBeVisible();
  });

  test('search also finds pages by what their sections contain', async ({ page }) => {
    await installApp(page, { api: { '/content-tree': TREE } });
    await page.goto('/content-tree.html');
    await page.locator('.search').fill('specials');
    await expect(page.getByRole('heading', { level: 2, name: /Home/ })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: /Menu/ })).toBeHidden();
  });

  test('Edit never clips at 360px — long section labels wrap instead of pushing it offscreen', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await installApp(page, { api: { '/content-tree': TREE } });
    await page.goto('/content-tree.html');
    await expect(page.locator('a.edit').first()).toBeVisible();
    // the page itself must not scroll horizontally
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // and every Edit link sits fully inside the viewport
    for (const box of await page.locator('a.edit').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right))) {
      expect(box).toBeLessThanOrEqual(360);
    }
  });

  test('a failed load renders trouble with Try again wired to load() in place', async ({ page }) => {
    await installApp(page, { api: {} });
    let calls = 0;
    await page.route(CT_RE, (route) => route.fulfill(++calls === 1 ? boom(500) : ok(TREE)));
    await page.goto('/content-tree.html');
    const retry = page.getByRole('button', { name: /try again/i });
    await expect(retry).toBeVisible();
    await retry.click();
    await expect(page.locator('.summary .state')).toHaveText('Your site is live');
    expect(calls).toBe(2);
  });

  test('↻ soft refresh keeps the last good render when the re-read fails', async ({ page }) => {
    await installApp(page, { api: {} });
    let calls = 0;
    await page.route(CT_RE, (route) => route.fulfill(++calls === 1 ? ok(TREE) : boom(500)));
    await page.goto('/content-tree.html');
    await expect(page.locator('.summary .state')).toHaveText('Your site is live');
    await page.locator('#refreshBtn').click();
    await expect(page.locator('.summary .state')).toHaveText('Your site is live');
    await expect(page.getByText(/Couldn.t refresh just now/)).toBeVisible();
  });

  test('403 renders its own workspace copy — never the generic hiccup', async ({ page }) => {
    await installApp(page, { api: {} });
    await page.route(CT_RE, (route) => route.fulfill(boom(403)));
    await page.goto('/content-tree.html');
    await expect(page.getByText(/this account can.t see this website.s map/i)).toBeVisible();
    await expect(page.getByText(/couldn.t load your map just now/i)).toBeHidden();
  });

  test('404 renders its own not-found copy, distinct from trouble', async ({ page }) => {
    await installApp(page, { api: {} });
    await page.route(CT_RE, (route) => route.fulfill(boom(404)));
    await page.goto('/content-tree.html');
    await expect(page.getByText(/couldn.t find this website/i)).toBeVisible();
    await expect(page.getByText(/couldn.t load your map just now/i)).toBeHidden();
  });

  test('signed out renders the sign-in invitation; ?client= scope carries onto Edit links', async ({ page }) => {
    await installApp(page, { session: null, api: {} });
    await page.goto('/content-tree.html');
    await expect(page.getByText('Sign in to see your website map.')).toBeVisible();

    await installApp(page, { api: { '/content-tree': TREE } });
    await page.goto('/content-tree.html?client=marlows');
    await expect(page.locator('a.edit').first()).toHaveAttribute('href', /client=marlows/);
  });
});
