import { test, expect } from '@playwright/test';
import { installApp } from './helpers/app';

// Sales extras, batch 2 (item 69, Nov 2026): "How did they find you?" on Log an
// enquiry, the deal page and the record, and Settings' "Download my data".
// Hermetic; names and addresses are made up.

test.describe('"How did they find you?" (item 69)', () => {
  test('Log an enquiry asks, and sends the answer with the person and the deal', async ({ page }) => {
    await installApp(page, { api: { '/sales/contacts': { data: { id: 'ct-9' } }, '/sales/deals': { data: { id: 'd-9' } } } });
    await page.goto('/inbox.html#enquiries');
    const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
    page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/presence/sales/')) posts.push({ path: new URL(r.url()).pathname.replace(/^.*\/presence/, ''), body: r.postDataJSON() }); });
    await page.getByRole('button', { name: 'New enquiry' }).click();
    const dlg = page.locator('dialog#newDlg[open]');
    await dlg.locator('#ne-name').fill('Avery Stone');
    await expect(dlg.getByLabel('How did they find you?')).toHaveValue('');
    await dlg.getByLabel('How did they find you?').selectOption('Referral');
    await dlg.getByRole('button', { name: 'Log enquiry' }).click();
    await page.waitForURL(/crm\.html\?deal=d-9/);
    expect(posts[0].body).toMatchObject({ name: 'Avery Stone', found_via: 'Referral' });
    expect(posts[1].body).toMatchObject({ contact_id: 'ct-9', found_via: 'Referral' });
  });

  test('the record\'s details card says how they found you', async ({ page }) => {
    const CLIENT = 'cccccccc-3333-4333-8333-cccccccccccc';
    await installApp(page, { api: {
      '/crm/record': { data: {
        identity: { contact_id: null, deal_id: null, client_id: null, customer_site_id: CLIENT, project_id: null },
        header: { name: 'Larkspur Studio', company: 'Larkspur Studio', email: 'jordan@example.com', phone: '', status: 'customer', found_via: 'Google' },
        highlights: {}, sections: { overview: true, messages: true, deal: false, delivery: false, details: false }, default_tab: 'overview',
        canonical: { key: 'client', value: CLIENT },
      } },
      '/crm/activity': { data: { items: [], upcoming: [], project_id: null, deal_id: null, reply_to: null, reply_support_to: null } },
    } });
    await page.goto(`/crm.html?client=${CLIENT}`);
    await expect(page.locator('#dcard')).toContainText('Found you through Google');
  });
});

test.describe('Download my data (item 69)', () => {
  const API = {
    '/identity': { data: { business_name: 'Example Studio', email: 'hello@example.com' } },
    '/settings': { data: { industry_key: 'generic' } },
    '/connections': { data: { groups: {} } },
    '/commerce/subscription': { data: { plan: 'studio', plan_name: 'Studio', status: 'active', can_manage_billing: true, current_period_end: '2026-12-03T00:00:00Z', in_grace: false, has_service_billing: false } },
  };
  test('one press downloads the zip as a file', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'a file download is checked once, on the desktop browser');
    await installApp(page, { api: API });
    await page.route('**/functions/v1/presence/sales/export', (route) => route.fulfill({ status: 200, contentType: 'application/zip', body: Buffer.from('PK\u0005\u0006' + '\u0000'.repeat(18), 'binary') }));
    await page.goto('/settings.html#billing');
    const btn = page.getByRole('button', { name: 'Download my data' });
    await expect(btn).toBeVisible();
    const [dl] = await Promise.all([page.waitForEvent('download'), btn.click()]);
    expect(dl.suggestedFilename()).toMatch(/^studio-data-\d{4}-\d{2}-\d{2}\.zip$/);
    await expect(page.locator('.dds-toast')).toContainText('Downloaded');
  });

  test('a refused download says why, in the server\'s words', async ({ page }) => {
    await installApp(page, { api: API });
    await page.route('**/functions/v1/presence/sales/export', (route) => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'forbidden', message: 'Downloading everything is for the studio’s owner.' }) }));
    await page.goto('/settings.html#billing');
    await page.getByRole('button', { name: 'Download my data' }).click();
    await expect(page.locator('.dds-toast')).toContainText('Downloading everything is for the studio’s owner.');
  });
});
