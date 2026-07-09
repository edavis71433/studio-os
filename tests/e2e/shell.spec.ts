import { test, expect } from '@playwright/test';
import { installApp } from './helpers/app';

// The one application shell (shell.js) — on every signed-in page. It draws nav,
// the ⌘K palette, the unified notification bell + attention badge, and profile.
test.describe('App shell', () => {
  test('signed-in: brand, nav sections, search, attention badge, profile', async ({ page }) => {
    await installApp(page);
    await page.goto('/today.html');
    const shell = page.locator('#dds-shell');
    await expect(shell.locator('.dds-brand')).toContainText('Presence');
    await expect(shell.locator('.dds-nav')).toContainText('Website');
    await expect(shell.locator('.dds-nav')).toContainText('Customers');
    await expect(shell.locator('.dds-nav')).toContainText('Inbox');
    await expect(page.locator('#dds-search')).toContainText('Search');
    // the attention badge reflects context.attention_count (2)
    await expect(page.locator('#dds-bell .dot')).toHaveText('2');
    await expect(page.locator('#dds-profile')).toBeVisible();
  });

  test('bell opens the unified feed — notices first, then approvals (Phase FLOW/OS)', async ({ page }) => {
    await installApp(page);
    await page.goto('/today.html');
    await page.locator('#dds-bell').click();
    const pop = page.locator('.dds-pop');
    await expect(pop).toContainText('Needs a look');
    await expect(pop).toContainText('A quote request is waiting for a reply'); // the notice
    await expect(pop).toContainText('Waiting for approval');                    // the pending approval
  });

  test('⌘K command palette opens, filters, and targets the right destination', async ({ page }) => {
    await installApp(page);
    await page.goto('/today.html');
    await page.keyboard.press('Control+k');
    const pal = page.locator('.dds-palette');
    await expect(pal).toBeVisible();
    await pal.locator('input').fill('Design');
    await expect(pal.locator('.res.sel')).toHaveAttribute('href', '/presence.html#design');
  });

  test('profile menu exposes sign out', async ({ page }) => {
    await installApp(page);
    await page.goto('/today.html');
    await page.locator('#dds-profile').click();
    await expect(page.locator('.dds-pop')).toContainText('Sign out');
  });

  test('no attention → no badge', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': { data: {
      site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS',
      edition_features: ['website', 'business_moments', 'connected', 'ai', 'relationship', 'client_portal', 'reports'],
      is_agency: false, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish', 'view_all'],
      landing: '/today.html', attention_count: 0,
      nav: [{ key: 'today', label: 'Today', items: [{ key: 'today', label: 'Today', href: '/today.html' }] }],
    } } } });
    await page.goto('/today.html');
    await expect(page.locator('#dds-bell')).toBeVisible();
    await expect(page.locator('#dds-bell .dot')).toHaveCount(0);
  });

  test('signed-out: shell degrades to brand + sign-in, no nav or search', async ({ page }) => {
    await installApp(page, { session: null });
    await page.goto('/today.html');
    await expect(page.locator('#dds-shell .dds-brand')).toContainText('Presence');
    await expect(page.locator('.dds-nav')).toHaveCount(0);
    await expect(page.locator('#dds-search')).toHaveCount(0);
  });
});
