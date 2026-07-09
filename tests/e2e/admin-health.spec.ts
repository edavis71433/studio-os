import { test, expect } from '@playwright/test';
import { installApp } from './helpers/app';

// PT-2C — Admin Health Center: one operational read from /admin/health-center.
test.describe('Admin Health Center', () => {
  const HC = { data: { overall: 'attention', areas: [
    { key: 'platform', label: 'Platform', state: 'ok', detail: 'All required configuration is present.' },
    { key: 'cron', label: 'Scheduled operations', state: 'ok', detail: 'Running on schedule.' },
    { key: 'billing', label: 'Billing', state: 'attention', detail: '1 with payment trouble, 0 lapsed.' },
    { key: 'backups', label: 'Backups & recovery', state: 'attention', detail: 'Backups on, but a restore drill hasn’t been confirmed yet.' },
    { key: 'ai', label: 'AI', state: 'off', detail: 'Not configured (AI features degrade gracefully).' },
  ] } };

  test('renders one card per area with honest states', async ({ page }) => {
    await installApp(page, { api: { '/admin/health-center': HC } });
    await page.goto('/admin-health.html');
    await expect(page.getByText('Some areas need a look.')).toBeVisible();
    await expect(page.getByText('Billing')).toBeVisible();
    await expect(page.getByText('a restore drill hasn’t been confirmed yet.')).toBeVisible();
    await expect(page.locator('.area')).toHaveCount(5);
    await expect(page.locator('.area.off')).toContainText('AI'); // unconfigured reads "off", not broken
  });

  test('a non-operator is told this is operators-only', async ({ page }) => {
    await installApp(page);
    await page.route('**/functions/v1/presence/admin/health-center', (r) => r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'forbidden' }) }));
    await page.goto('/admin-health.html');
    await expect(page.getByText('Operators only.')).toBeVisible();
  });
});
