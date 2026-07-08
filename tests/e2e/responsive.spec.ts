import { test, expect } from '@playwright/test';
import { installApp } from './helpers/app';

// Runs in all three projects (desktop / tablet / mobile). The body must never
// scroll sideways, and the core content must render at every width.
test.describe('Responsive layout', () => {
  for (const path of ['/today.html', '/leads.html']) {
    test(`${path} has no horizontal overflow`, async ({ page }) => {
      await installApp(page);
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1); // sub-pixel rounding tolerance
    });
  }

  test('Today renders its heading and content at this viewport', async ({ page }) => {
    await installApp(page);
    await page.goto('/today.html');
    await expect(page.locator('header h1')).toBeVisible();
    await expect(page.locator('.moment.todo').first()).toBeVisible();
  });
});
