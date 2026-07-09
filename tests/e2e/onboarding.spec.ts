import { test, expect } from '@playwright/test';
import { installApp } from './helpers/app';

// PT-5 — contextual onboarding: teach in context, show ONCE, disappear forever.
test.describe('Contextual onboarding hint', () => {
  test('appears once, dismisses, and never returns', async ({ page }) => {
    await installApp(page);
    await page.goto('/today.html');
    const hint = page.locator('.dds-hint[data-hint="today-bell"]');
    await expect(hint).toBeVisible();
    await hint.getByRole('button', { name: 'Got it' }).click();
    await expect(hint).toHaveCount(0);
    // reload: it's remembered as seen, so it does not reappear
    await page.reload();
    await expect(page.locator('.dds-hint[data-hint="today-bell"]')).toHaveCount(0);
  });

  test('a fresh visitor on a different page sees that page\'s hint', async ({ page }) => {
    await installApp(page);
    await page.goto('/leads.html');
    await expect(page.locator('.dds-hint[data-hint="leads-reply"]')).toBeVisible();
  });
});
