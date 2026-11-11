import { test, expect } from '@playwright/test';
import { installApp, ALL_FEATURES, STUDIO_LEVEL_NAV } from './helpers/app';

// Sales item 74 (Nov 2026): a person's record says when they unsubscribed from emails,
// or that their address stopped taking email, right under the address. Every name is made up.

const STUDIO_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'],
  landing: '/agency.html', attention_count: 0, nav: STUDIO_LEVEL_NAV, plan_key: 'presence', upsell: null, scope: null,
} };
const record = (emailStatus: unknown) => ({ data: {
  identity: { client_id: 'c-harbor', customer_site_id: 'site-harbor', project_id: null, deal_id: 'd-1', contact_id: 'ct-1' },
  header: { name: 'Harbor Dental', person: 'Marcus Bell', company: 'Harbor Dental', email: 'marcus@harbordental.example', phone: '(555) 010-4410', status: 'customer', ...(emailStatus ? { email_status: emailStatus } : {}) },
  highlights: {}, sections: { overview: true, details: true, deal: true }, default_tab: 'details', canonical: { key: 'client', value: 'site-harbor' },
} });
const open = async (page: import('@playwright/test').Page, emailStatus: unknown) => {
  await installApp(page, { api: { '/portal/context': STUDIO_CTX, '/crm/record': record(emailStatus), '/crm/activity': { data: { items: [], upcoming: [] } } } });
  await page.goto('/crm.html?client=site-harbor');
  return page.locator('.dcard');
};

test.describe('The record says when someone unsubscribed (item 74)', () => {
  test('an unsubscribe shows its date under the address, and what still reaches them', async ({ page }) => {
    const card = await open(page, { reason: 'opt_out', since: '2026-11-03T18:00:00Z' });
    await expect(card).toContainText('marcus@harbordental.example');
    await expect(card.locator('[data-email-status]')).toHaveText('Unsubscribed from emails on Nov 3, 2026. Invoices, receipts and documents still reach them.');
  });
  test('a bounced address says no emails go to them', async ({ page }) => {
    const card = await open(page, { reason: 'bounce', since: '2026-10-30T09:00:00Z' });
    await expect(card.locator('[data-email-status]')).toHaveText('Emails to this address bounce (since Oct 30, 2026), so no emails go to them.');
  });
  test('a spam mark says so', async ({ page }) => {
    const card = await open(page, { reason: 'complaint', since: '2026-10-30T09:00:00Z' });
    await expect(card.locator('[data-email-status]')).toHaveText('Marked an email as spam on Oct 30, 2026, so no emails go to them.');
  });
  test('someone who gets emails has no line', async ({ page }) => {
    const card = await open(page, null);
    await expect(card).toContainText('marcus@harbordental.example');
    await expect(card.locator('[data-email-status]')).toHaveCount(0);
  });
});
