import { test, expect } from '@playwright/test';

// Sales item 92 (Nov 2026): the pages a payer lands on after Stripe stop speaking as Eric
// ("On my side…", "just message Eric") to every studio's payer. The thank-you names the
// studio when this browser knows it (a client who signed in before left its name, the same
// one the sign-in page reads), and otherwise names no one. Every name is made up.

test.describe('After paying: the thank-you speaks for the studio, not for Eric (item 92)', () => {
  test('a returning client is thanked in their studio’s name', async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('dds-studio-brand', JSON.stringify({ name: 'Brightline Studio', logo_url: null, accent: '#5b3fa0' })); } catch (e) {} });
    await page.goto('/payment-success.html?paid=inv-123');
    await expect(page).toHaveTitle('Payment received | Brightline Studio');
    await expect(page.locator('#sub')).toHaveText(/^Brightline Studio is told right away, and your invoice shows as paid as soon as Stripe confirms it/);
    await expect(page.getByText('On my side')).toHaveCount(0);
    await expect(page.locator('#plain')).toBeHidden();
    await expect(page.getByRole('link', { name: 'Sign in to see your invoice →' })).toBeVisible();
  });
  test('a first-time payer: no one is named, and nothing speaks as Eric', async ({ page }) => {
    await page.goto('/payment-success.html?paid=inv-123');
    await expect(page).toHaveTitle('Payment received');
    await expect(page.locator('#sub')).toHaveText(/^Your invoice shows as paid as soon as Stripe confirms it/);
    await expect(page.getByText(/Eric|On my side/)).toHaveCount(0);
  });
  test('the plain thank-you has no "On my side" either', async ({ page }) => {
    await page.goto('/payment-success.html');
    await expect(page.locator('#sub')).toHaveText(/^Everything updates on its own: your invoice is marked paid/);
    await expect(page.getByText(/On my side/)).toHaveCount(0);
  });
  test('the audit thank-you still says Eric reviews the site (it is his own audit)', async ({ page }) => {
    await page.goto('/payment-success.html?kind=audit');
    await expect(page.locator('#sub')).toContainText('Eric personally reviews your site');
  });
  test('a checkout left early says to reply to the email, not to message Eric', async ({ page }) => {
    await page.goto('/payment-canceled.html');
    await expect(page).toHaveTitle('Payment not completed');
    await expect(page.locator('#detail')).toContainText('just reply to that email and it\'ll get sorted quickly');
    await expect(page.getByText(/message Eric/)).toHaveCount(0);
  });
});
