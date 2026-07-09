import { test, expect } from '@playwright/test';
import { installApp } from './helpers/app';

// CRM surfaces: the leads inbox (leads.html) and the relationship view (crm.html).
test.describe('Leads inbox', () => {
  test('renders leads with kind + a one-tap prefilled reply', async ({ page }) => {
    await installApp(page);
    await page.goto('/leads.html');
    const leads = page.locator('.lead');
    await expect(leads).toHaveCount(2);                       // Open filter: both non-archived
    await expect(page.getByText('Sam Rivera')).toBeVisible();
    await expect(page.getByText('Quote request')).toBeVisible();
    const reply = page.locator('a.reply').first();
    await expect(reply).toHaveAttribute('href', /^mailto:sam@example\.com/);
    await expect(reply).toHaveAttribute('href', /subject=/);  // prefilled subject
  });

  test('the new-lead filter shows only unread', async ({ page }) => {
    await installApp(page);
    await page.goto('/leads.html');
    await page.locator('[data-f="new"]').click();
    await expect(page.locator('.lead')).toHaveCount(1);
    await expect(page.getByText('Sam Rivera')).toBeVisible();
  });

  test('marking a lead read confirms with a toast', async ({ page }) => {
    await installApp(page);
    await page.goto('/leads.html');
    await page.locator('[data-read]').first().click();
    await expect(page.locator('#toast')).toContainText('Marked read.');
  });

  test('signed-out shows a sign-in prompt, not leads', async ({ page }) => {
    await installApp(page, { session: null });
    await page.goto('/leads.html');
    await expect(page.getByRole('link', { name: /Sign in/ })).toBeVisible();
    await expect(page.locator('.lead')).toHaveCount(0);
  });
});

test.describe('Relationship view', () => {
  test('renders the business, notes section, and the activity timeline', async ({ page }) => {
    await installApp(page);
    await page.goto('/crm.html');
    await expect(page.getByRole('heading', { name: 'Marlow’s Kitchen' })).toBeVisible();
    await expect(page.getByText('Notes')).toBeVisible();
    await expect(page.getByText('Quote request from Sam Rivera')).toBeVisible();
    await expect(page.getByText('Published the site')).toBeVisible();
  });
});
