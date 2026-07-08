import { test, expect } from '@playwright/test';
import { installApp } from './helpers/app';

// The merged Agency Portfolio Status (Phase PP Section 3): one row per client
// with the at-a-glance signals — attention, leads, domain, billing.
test.describe('Agency portfolio', () => {
  const soon = new Date(Date.now() + 12 * 86400_000).toISOString(); // ~12 days out → "expires in Nd"

  test('each client row shows attention badge + status line', async ({ page }) => {
    await installApp(page, { api: {
      '/agency/me': { data: { agency: 'Bright Studio', role: 'owner', plan: 'agency', branding: {} } },
      '/agency/portfolio': { data: [
        { site_id: 'a1', name: 'Marlow’s Kitchen', edition: 'presence', status: 'ready',
          attention: 4, leads_waiting: 2, domain_expires_at: soon, domain_registrar: 'GoDaddy.com, LLC',
          search_issues: 0, billing_issue: true, plans_waiting: 1 },
        { site_id: 'a2', name: 'Bright Dental', edition: 'presence', status: 'ready',
          attention: 0, leads_waiting: 0, domain_expires_at: null, domain_registrar: null,
          search_issues: 0, billing_issue: false, plans_waiting: 0 },
      ] },
    } });
    await page.goto('/agency.html');
    await expect(page.getByRole('heading', { name: 'Your clients' })).toBeVisible();

    const marlow = page.locator('.client', { hasText: 'Marlow’s Kitchen' });
    await expect(marlow.locator('.badge')).toContainText('4 waiting');
    await expect(marlow).toContainText('2 leads waiting');
    await expect(marlow).toContainText('domain expires in');
    await expect(marlow).toContainText('GoDaddy');
    await expect(marlow).toContainText('billing needs a look');

    const bright = page.locator('.client', { hasText: 'Bright Dental' });
    await expect(bright.locator('.badge')).toContainText('all clear');
  });

  test('non-agency accounts are turned away, not shown an empty portfolio', async ({ page }) => {
    await installApp(page);
    // registered AFTER installApp so it takes precedence (Playwright matches last-added first)
    await page.route('**/functions/v1/presence/agency/me', (r) => r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'forbidden' }) }));
    await page.goto('/agency.html');
    await expect(page.locator('.client')).toHaveCount(0);
  });
});
