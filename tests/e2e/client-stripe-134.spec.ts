import { test, expect } from '@playwright/test';
import { installApp } from './helpers/app';

// Sales item 134: a business's own Stripe reads the right numbers, and its card says them:
// what came in over the last 30 days less refunds, how many payments, and what reached the
// bank. The provider is still 'planned' (no Stripe Connect app yet), so this is the card as
// it will read the day it can be connected.
const SURFACE = (data: Record<string, unknown>) => ({ data: {
  edition: 'presence',
  note: 'Connect the services you already use — read-only, always with your approval, and yours to disconnect any time.',
  groups: {
    'Getting paid': [{
      key: 'stripe_connect', label: 'your payments', purpose: 'See your own sales and, later, send a payment link from your site.',
      reads: ['what you took in the last 30 days, less refunds', 'what Stripe paid out to your bank'], approval: 'You approve access on the provider’s sign-in screen.',
      availability: 'Read-only',
      connection: { status: 'connected', health: 'ok', last_sync_at: '2026-11-16T09:00:00Z', connected_at: '2026-11-01T00:00:00Z', reason: '' },
      data,
    }],
  },
} });

test.describe('sales item 134 — a business’s own Stripe', () => {
  test('the card says what came in, less refunds, and what reached the bank', async ({ page }) => {
    await installApp(page, { api: { '/connections': SURFACE({ payments: 3, revenue: 300, refunded: 90, paid_out: 200, payouts: 1, currency: 'usd', window_days: 30, as_of: '2026-11-16T09:00:00Z' }) } });
    await page.goto('/connections.html');
    const row = page.locator('#svc-stripe_connect');
    await expect(row.locator('.data')).toContainText('$300.00 taken in 30 days · 3 payments · $90.00 refunded · $200.00 paid out');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });

  test('nothing refunded says nothing about refunds; a quiet month says its zeros', async ({ page }) => {
    await installApp(page, { api: { '/connections': SURFACE({ payments: 0, revenue: 0, refunded: 0, paid_out: 0, payouts: 0, currency: 'usd', window_days: 30 }) } });
    await page.goto('/connections.html');
    const line = page.locator('#svc-stripe_connect .data');
    await expect(line).toContainText('$0.00 taken in 30 days · 0 payments · $0.00 paid out');
    await expect(line).not.toContainText('refunded');
  });
});
