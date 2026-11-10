import { test, expect } from '@playwright/test';
import { installApp } from './helpers/app';

// Found Nov 9 2026 testing the photo cut-out live: the Stock Library found nothing even for
// its own suggestion "coffee". Pexels was refusing the key, and every refusal became an empty
// list, so Files said "No photos match that search". The server now says why, and Files shows it.
const API = {
  '/assets/collections': { data: [] },
  '/assets/health': { data: { findings: [] } },
  '/assets': { data: { assets: [], total: 0, shown: 0, live_count: 0, policy: 'immediate', storage: { used_bytes: 0, files: 0, max_bytes: 1073741824, max_files: 100, level: 'ok' } } },
};

test('a refused stock search says why, never "No photos match"', async ({ page }) => {
  await installApp(page, { api: API });
  const said = 'The stock library’s key for Pexels isn’t being accepted, so no photos came back. Your studio can renew it.';
  await page.route('**/functions/v1/presence/stock/search**', (route) => route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'provider_failed', provider: 'Pexels', message: said }) }));
  await page.goto('/files.html');
  await page.getByRole('button', { name: 'More filters' }).click();   // bold redesign: Stock Library waits behind More filters
  await page.getByRole('button', { name: 'Stock Library' }).click();
  await expect(page.getByRole('status').filter({ hasText: said })).toBeVisible();
  await expect(page.getByText('No photos match that search.')).toHaveCount(0);
});

test('…and a search that finds nothing still says so', async ({ page }) => {
  await installApp(page, { api: { ...API, '/stock/search': { data: { provider: 'Pexels', license: { name: 'Pexels License' }, images: [] } } } });
  await page.goto('/files.html');
  await page.getByRole('button', { name: 'More filters' }).click();   // bold redesign: Stock Library waits behind More filters
  await page.getByRole('button', { name: 'Stock Library' }).click();
  await page.getByRole('searchbox', { name: 'Search stock photos' }).fill('zzzz');
  await page.keyboard.press('Enter');
  await expect(page.getByText('No photos match that search.')).toBeVisible();
});
