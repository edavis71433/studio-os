import { test, expect } from '@playwright/test';
import { installApp } from './helpers/app';

// Sales review item 22, second half (Nov 2026): a customer leads with the
// business and names the person — the deal said "Bacchus Kitchen" while the
// customer said "Claud Beltran", and the two never met. (Fictional names here.)
const CLIENT = '44444444-4444-4444-8444-444444444444';

test('Customers: the business leads, the person sits under it, and search finds either', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('dds-display:customers', 'table'); } catch { /* denied */ } });
  await installApp(page, { api: { '/studio/customers': { data: [
    { client_id: 'c-1', name: 'Harbor Lane Bakery', business_name: 'Harbor Lane Bakery', person_name: 'Sam Rivera', email: 'sam@harbor.example', project_id: 'p1', status: 'active', customer_site_id: 'site-1', open_support: 0, project_count: 1 },
    { client_id: 'c-2', name: 'Northside Dental', business_name: '', person_name: '', email: 'hi@northside.example', project_id: 'p2', status: 'active', customer_site_id: null, open_support: 0, project_count: 1 },
  ] } } });
  await page.goto('/customers.html');
  const row = page.locator('tbody tr').filter({ hasText: 'Harbor Lane Bakery' });
  await expect(row.locator('.n')).toHaveText('Harbor Lane Bakery');
  await expect(row.locator('.pn')).toHaveText('Sam Rivera');
  await expect(page.locator('tbody tr').filter({ hasText: 'Northside Dental' }).locator('.pn')).toHaveCount(0);
  await page.getByLabel('Search customers').fill('sam');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody tr')).toContainText('Harbor Lane Bakery');
});

test('the record: the business is the heading, the person beside it', async ({ page }) => {
  await installApp(page, { api: {
    '/crm/record': { data: {
      identity: { contact_id: null, deal_id: null, client_id: 'cl-1', customer_site_id: CLIENT, project_id: null },
      header: { name: 'Harbor Lane Bakery', company: 'Harbor Lane Bakery', person: 'Sam Rivera', email: 'sam@harbor.example', phone: '', status: 'customer' },
      highlights: {}, sections: { overview: true, messages: true }, default_tab: 'overview', canonical: { key: 'client', value: CLIENT },
    } },
    '/crm/activity': { data: { items: [], upcoming: [] } },
  } });
  await page.goto(`/crm.html?client=${CLIENT}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Harbor Lane Bakery' })).toBeVisible();
  await expect(page.locator('.rec-sub')).toContainText('Sam Rivera');
  await expect(page.locator('.rec-sub')).not.toContainText('Harbor Lane Bakery');   // the business isn't said twice
});
