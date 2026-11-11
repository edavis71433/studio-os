import { test, expect, Route } from '@playwright/test';
import { installApp } from './helpers/app';

// Builder list item 154 (Nov 10 review, file 03 finding 7): restoring a version or a
// checkpoint never brought a deleted page back, so a page deleted more than 20 seconds
// ago was gone. The server now keeps every deleted page 30 days (migration 0154,
// routes/deleted_pages.ts), and the editor's Versions lists them with Put back. The
// fixtures are the route's real shape: GET /pages/deleted → { data: [{ id, slug, title,
// deleted_at, sections, days_left }], ready, keep_days }.
const API = {
  '/site': { data: { site: { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1 }, identity: { business_name: 'Marlow’s Kitchen' }, location: {} } },
  '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] },
  '/media': { data: [] }, '/settings': { data: {} }, '/health': { data: {} }, '/notes': { data: [] },
  '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'e2e-draft-hash' } },
  '/moments': { data: [] }, '/schedule': { data: { scheduled: [] } }, '/content-library': { data: [] },
  '/dev/customization': { data: { theme_tokens: {}, custom_css: '', custom_html: '', allowed_tokens: ['accent'], can_edit_css: false, updated_at: null, updated_by: null } },
  '/publishes': { data: [] },
};
const DELETED = [
  { id: 'dddddddd-0000-4000-8000-000000000001', slug: 'gallery', title: 'Gallery', deleted_at: '2026-11-09T15:00:00Z', sections: 6, days_left: 29 },
  { id: 'dddddddd-0000-4000-8000-000000000002', slug: 'spring', title: 'Spring specials', deleted_at: '2026-10-20T15:00:00Z', sections: 1, days_left: 1 },
];
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

test.describe('Versions: recently deleted pages (item 154)', () => {
  test('lists the pages deleted in the last 30 days, and Put back brings one back alone', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    let list = DELETED;
    await installApp(page, { api: API });
    await page.route(/\/functions\/v1\/presence\/pages\/deleted$/, (route: Route) => route.fulfill(json({ data: list, ready: true, keep_days: 30 })));
    const restores: string[] = [];
    await page.route(/\/functions\/v1\/presence\/pages\/deleted\/[^/]+\/restore$/, (route: Route) => {
      restores.push(route.request().method() + ' ' + new URL(route.request().url()).pathname.replace(/^.*\/presence/, ''));
      list = DELETED.slice(1);
      return route.fulfill(json({ data: { slug: 'gallery-2', title: 'Gallery', moved: true, pages: [] } }));
    });
    await page.goto('/presence.html#history');
    const box = page.locator('#deletedPagesBox');
    await expect(box.locator('label')).toHaveText('Recently deleted pages');
    await expect(box).toContainText('Kept for 30 days.');
    await expect(box).toContainText('Gallery');
    await expect(box).toContainText('Deleted Nov 9 · 6 sections · 29 days left');
    await expect(box).toContainText('Deleted Oct 20 · 1 section · 1 day left');
    await box.getByRole('button', { name: 'Put back the page Gallery' }).click();
    await expect(page.getByText('“Gallery” is back in your pages as /gallery-2/')).toBeVisible();
    expect(restores).toEqual(['POST /pages/deleted/dddddddd-0000-4000-8000-000000000001/restore']);
    await expect(box.getByRole('button', { name: 'Put back the page Gallery' })).toHaveCount(0);   // the list is read again
    await expect(box.getByRole('button', { name: 'Put back the page Spring specials' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('nothing deleted, or no database step yet: no card at all', async ({ page }) => {
    await installApp(page, { api: API });
    await page.route(/\/functions\/v1\/presence\/pages\/deleted$/, (route: Route) => route.fulfill(json({ data: [], ready: false, message: 'Deleted pages are kept once one database step is done.' })));
    await page.goto('/presence.html#history');
    await expect(page.locator('#pubList')).not.toBeEmpty();
    await expect(page.locator('#deletedPagesBox')).toBeEmpty();
  });
});
