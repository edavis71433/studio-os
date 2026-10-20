import { test } from '@playwright/test';
import { installApp } from '../../../../tests/e2e/helpers/app';
import { PRESENCE_API } from './fixtures';
import { quiet } from './walk';
test('⌘K reach', async ({ page }) => {
  await quiet(page); await installApp(page, { api: { ...PRESENCE_API, '/crm/search': { data: { results: [] } }, '/assets': { data: { assets: [] } } } });
  await page.goto('/today.html'); await page.waitForLoadState('networkidle');
  for (const q of ['publish', 'schedule', 'domain', 'page', 'add page', 'enquir', 'reply', 'history', 'version', 'approv', 'health', 'invoice', 'settings', 'billing']) {
    await page.locator('#dds-search').click();
    await page.locator('.dds-palette input').fill(q); await page.waitForTimeout(500);
    const hits = await page.locator('.dds-palette .res').allInnerTexts();
    console.log(`PAL "${q}" → ${hits.length}: ${hits.map((h) => h.replace(/\n/g, ' / ')).join(' | ')}`);
    await page.keyboard.press('Escape');
  }
  await page.locator('#dds-search').click(); await page.waitForTimeout(300);
  console.log('PAL (empty) →', (await page.locator('.dds-palette .res').count()), 'destinations');
});
