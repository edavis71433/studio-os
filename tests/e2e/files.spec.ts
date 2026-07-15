import { test, expect } from '@playwright/test';
import { installApp } from './helpers/app';

// DAM-1 / Architecture v1.0 — the DAM presents as "Files". This locks the
// customer-facing surface: it mounts under the shell, shows collections, and
// speaks Files language (no "DAM"/"Media"/"asset" jargon).
const ASSET = { id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', name: 'Logo', kind: 'image', mime: 'image/png', in_use: true, favorite: false, alt_text: 'Company logo', tags: [], collection: 'Brand', asset_status: 'approved', bytes: 40000 };

const filesApi = {
  '/assets/collections': { data: [{ name: 'Brand', count: 1 }] },
  '/assets/health': { data: { findings: [] } },
  '/assets': { data: { assets: [ASSET], total: 1, shown: 1, live_count: 1, policy: 'immediate' } },
};

test.describe('Files (the DAM, customer-facing)', () => {
  test('mounts under the shell and shows collections + a file', async ({ page }) => {
    await installApp(page, { api: filesApi });
    await page.goto('/files.html');
    await expect(page.locator('#dds-shell .dds-nav')).toContainText('Files');
    await expect(page.getByRole('heading', { name: 'Files' })).toBeVisible();
    await expect(page.locator('.rail')).toContainText('All files');
    await expect(page.locator('.rail')).toContainText('Documents');
    await expect(page.locator('.grid')).toContainText('Logo');
  });

  test('speaks Files language — no DAM/asset/media jargon on the page', async ({ page }) => {
    await installApp(page, { api: filesApi });
    await page.goto('/files.html');
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/\bDAM\b/);
    expect(body).not.toMatch(/asset library/i);
  });

  test('forwards the scope header (SC-1) on its data calls', async ({ page }) => {
    const CLIENT = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
    let sentScope = '';
    await installApp(page, { api: filesApi });
    // match ONLY the /assets list call (never /assets/collections or /assets/health,
    // which need their own response shapes and stay on the installApp fixtures)
    await page.route(/\/functions\/v1\/presence\/assets(\?|$)/, (route) => {
      sentScope = route.request().headers()['x-dds-scope-site'] || '';
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(filesApi['/assets']) });
    });
    await page.goto(`/files.html?client=${CLIENT}`);
    await expect(page.locator('.grid')).toContainText('Logo');
    expect(sentScope).toBe(CLIENT);
  });
});
