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
    await expect(page.getByText('Billing', { exact: true })).toBeVisible();
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

// ── Batch A (post-redesign audit) — A11: the shell theme toggle can flip this
// page (the [data-theme] blocks mirror the @media dark values, --ok/--attn/--off
// families included).
test.describe('Admin Health Center — theme blocks (A11)', () => {
  const HC1 = { data: { overall: 'ok', areas: [{ key: 'platform', label: 'Platform', state: 'ok', detail: 'All good.' }] } };
  test('data-theme=dark flips the page tokens; light flips them back', async ({ page }) => {
    await installApp(page, { api: { '/admin/health-center': HC1 } });
    await page.goto('/admin-health.html');
    const read = (name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    expect(await read('--bg')).toBe('#171320');
    expect(await read('--ok')).toBe('#8bbf9f');
    expect(await read('--attn')).toBe('#d3ac6e');
    expect(await read('--off')).toBe('#9a92a6');
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    expect(await read('--bg')).toBe('#faf8f5');
    expect(await read('--ok')).toBe('#3f7a5a');
    expect(await read('--attn')).toBe('#8a6d3b');
    expect(await read('--off')).toBe('#7a7280');
  });
});
