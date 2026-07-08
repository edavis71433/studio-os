import { test, expect } from '@playwright/test';
import { installApp } from './helpers/app';

// Today — the home surface. It must tell ONE story with the bell (Phase OS): the
// same notices + approvals appear here as "needs you" cards, plus Moments.
test.describe('Today', () => {
  test('renders needs-you cards (notices + approvals) above moments', async ({ page }) => {
    await installApp(page);
    await page.goto('/today.html');
    const todo = page.locator('.moment.todo');
    await expect(todo).toHaveCount(2); // 1 notice + 1 approval
    await expect(page.locator('.moment.todo').first()).toContainText('A quote request is waiting for a reply');
    await expect(page.locator('.moment.todo').first()).toHaveAttribute('href', '/leads.html');
    await expect(page.getByText('Protect your email')).toBeVisible();
    // the moment card + its dismiss affordance
    await expect(page.getByRole('heading', { name: 'Add your holiday hours' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Not now' })).toBeVisible();
  });

  test('attention is consistent — Today card count equals the bell badge', async ({ page }) => {
    await installApp(page);
    await page.goto('/today.html');
    await expect(page.locator('.moment.todo')).toHaveCount(2);
    await expect(page.locator('#dds-bell .dot')).toHaveText('2');
  });

  test('dismissing a moment removes its card', async ({ page }) => {
    await installApp(page);
    await page.goto('/today.html');
    const card = page.locator('article.moment', { hasText: 'Add your holiday hours' });
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Not now' }).click();
    await expect(card).toHaveCount(0);
  });

  test('all-clear empty state (website edition) speaks website language', async ({ page }) => {
    await installApp(page, { api: {
      '/portal/feed': { data: { role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null } },
      '/moments': { data: [] },
    } });
    await page.goto('/today.html');
    await expect(page.getByText('All clear')).toBeVisible();
    await expect(page.getByText('Everything customers can see is current.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open your website' })).toBeVisible();
  });

  test('CRM edition empty state speaks relationship language (PP-5)', async ({ page }) => {
    await installApp(page, { api: {
      '/portal/context': { data: {
        site_role: 'business_owner', edition: 'monitor', edition_key: 'business_os_only', edition_name: 'Business OS',
        edition_features: ['business_moments', 'connected', 'ai', 'relationship', 'reports', 'client_portal'],
        is_agency: false, is_operator: false, sees_full_workspace: true, capabilities: ['view_all'],
        landing: '/today.html', attention_count: 0,
        nav: [{ key: 'today', label: 'Today', items: [{ key: 'today', label: 'Today', href: '/today.html' }] }],
      } },
      '/portal/feed': { data: { role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null } },
      '/moments': { data: [] },
    } });
    await page.goto('/today.html');
    await expect(page.getByText('Everything’s quiet across your business.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open your relationships' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open your website' })).toHaveCount(0);
  });

  test('upgrade orientation card appears once, then dismisses (PP-6)', async ({ page }) => {
    // seed a PRIOR edition so studio_os reads as an upgrade
    await page.addInitScript(() => {
      localStorage.setItem('dds-oriented', JSON.stringify({ key: 'cms_only', feats: ['website', 'developer', 'forms', 'client_portal', 'reports'] }));
    });
    await installApp(page, { api: { '/portal/feed': { data: { role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null } }, '/moments': { data: [] } } });
    await page.goto('/today.html');
    await expect(page.getByText('Welcome to Studio OS')).toBeVisible();
    await expect(page.getByText(/Business Moments/)).toBeVisible(); // a gained feature, named
    await page.getByRole('button', { name: 'Got it' }).click();
    await expect(page.getByText('Welcome to Studio OS')).toHaveCount(0);
    // and it does not return on reload (localStorage was advanced)
    await page.reload();
    await expect(page.getByText('Welcome to Studio OS')).toHaveCount(0);
  });

  test('first sight of an edition orients silently (no false upgrade)', async ({ page }) => {
    await installApp(page, { api: { '/portal/feed': { data: { role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null } }, '/moments': { data: [] } } });
    await page.goto('/today.html');
    await expect(page.getByText(/^Welcome to/)).toHaveCount(0);
  });
});
