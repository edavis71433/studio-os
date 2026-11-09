import { test, expect } from '@playwright/test';
import { installApp } from './helpers/app';

// Found Nov 8 while building item 46: a restaurant site whose business type was never set called
// its offerings "Services". The words follow the template first, then the business type. The page
// looked for the template under `template`, which the site read only began sending with item 63;
// it reads `template_slug` first now, the field the site read has always carried.
const site = (slug: string, also: Record<string, unknown> = {}) => ({
  '/site': { data: { site: { id: 's1', edition: 'presence', status: 'ready', template_slug: slug, template_version: 1, ...also }, identity: { business_name: 'Test Kitchen' } } },
  '/settings': { data: {} },
});

test('a Restaurant Classic site with no business type calls its offerings the Menu', async ({ page }) => {
  await installApp(page, { api: site('restaurant-classic') });
  await page.goto('/presence.html#offerings');
  await expect(page.locator('#view-offerings h1.doc')).toHaveText('Menu');
});

test('…as it does from the site read’s "slug version" name alone', async ({ page }) => {
  await installApp(page, { api: site('', { template_slug: undefined, template: 'restaurant-classic 1' }) });
  await page.goto('/presence.html#offerings');
  await expect(page.locator('#view-offerings h1.doc')).toHaveText('Menu');
});

test('a Business Classic site with no business type calls them Services', async ({ page }) => {
  await installApp(page, { api: site('business-classic') });
  await page.goto('/presence.html#offerings');
  await expect(page.locator('#view-offerings h1.doc')).toHaveText('Services');
});
