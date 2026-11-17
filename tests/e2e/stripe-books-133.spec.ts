import { test, expect } from '@playwright/test';
import { installApp, ALL_FEATURES, STUDIO_LEVEL_NAV } from './helpers/app';
import { headerAction } from './helpers/page-header';

// Sales item 133: the export for a bookkeeper shows what reached the bank. For the
// platform's own studio, whose Stripe takes the payments, the zip carries payouts.csv
// too, and the dialog says so; anyone else's dialog lists only what their zip holds.
const ctx = (operator: boolean, scope: unknown = null) => ({ data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: operator, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all', 'delete', 'export'],
  landing: '/agency.html', attention_count: 0, nav: STUDIO_LEVEL_NAV, plan_key: 'presence', upsell: null, scope,
} });
const INVOICES = { data: { items: [], today: '2026-11-16', partial: false } };

async function openDialog(page: import('@playwright/test').Page) {
  await page.goto('/invoices.html');
  await headerAction(page, '#expBtn');   // on a phone it waits behind the header's ⋯, which this opens
  await page.getByRole('button', { name: 'For your bookkeeper' }).click();
  const dlg = page.getByRole('dialog', { name: 'Export for your bookkeeper' });
  await expect(dlg).toBeVisible();
  return dlg;
}

test.describe('sales item 133 — what reached the bank', () => {
  test('the platform\'s own studio: the dialog lists payouts.csv and what payments.csv adds', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': ctx(true), '/sales/invoices': INVOICES } });
    const dlg = await openDialog(page);
    const item = dlg.locator('#expPayouts');
    await expect(item).toBeVisible();
    await expect(item).toContainText('payouts.csv');
    await expect(item).toContainText('Stripe’s fee on each payment, what you kept and the day it was paid out');
    await expect(dlg.locator('.efiles li:visible')).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });

  test('a studio owner who isn\'t the platform: no payouts line, since their zip has none', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': ctx(false), '/sales/invoices': INVOICES } });
    const dlg = await openDialog(page);
    await expect(dlg.locator('.efiles li:visible')).toHaveCount(2);
    await expect(dlg.locator('#expPayouts')).toBeHidden();
  });

  test('the platform\'s staff drilled into a client: no payouts line either', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': ctx(true, { site_id: 'c1', name: 'A client' }), '/sales/invoices': INVOICES } });
    const dlg = await openDialog(page);
    await expect(dlg.locator('#expPayouts')).toBeHidden();
  });
});
