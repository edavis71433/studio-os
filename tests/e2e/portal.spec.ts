import { test, expect } from '@playwright/test';
import { installApp } from './helpers/app';

// The client portal (client.html) — a reviewer's calm world: mirror of "needs
// you" (Phase PP Section 4), then approve what's theirs to approve.
const REVIEWER_CTX = { data: {
  site_role: 'client_reviewer', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS',
  edition_features: ['website', 'client_portal'], is_agency: false, is_operator: false,
  sees_full_workspace: false, is_client_portal: true, capabilities: ['view_shared'],
  landing: '/client.html', attention_count: 1, nav: [{ key: 'client', label: 'Your updates', items: [{ key: 'feed', label: 'Updates', href: '/client.html' }] }],
} };

test.describe('Client portal', () => {
  test('mirrors "needs you": attention-aware heading + approvals section', async ({ page }) => {
    await installApp(page, { api: {
      '/portal/context': REVIEWER_CTX,
      '/portal/feed': { data: { role: 'client_reviewer',
        moments: [{ id: 'm1', headline: 'Your new hours are live', summary: 'Published last week.' }],
        pending_approvals: [{ id: 'p1', kind: 'infrastructure', title: 'Protect your email', summary: 'Add email authentication.', decide_path: '/foundations/plans/p1/decide' }],
        last_published: { created_at: '2026-07-05T00:00:00Z', completed_at: '2026-07-05T00:00:00Z' } } },
    } });
    await page.goto('/client.html');
    await expect(page.getByText('One thing needs your OK — no rush.')).toBeVisible();
    await expect(page.getByText('Waiting for your OK')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Protect your email' })).toBeVisible();
    await expect(page.getByText('Your new hours are live')).toBeVisible();
  });

  test('approving a change confirms and reloads', async ({ page }) => {
    await installApp(page, { api: {
      '/portal/context': REVIEWER_CTX,
      '/portal/feed': { data: { role: 'client_reviewer', moments: [],
        pending_approvals: [{ id: 'p1', kind: 'infrastructure', title: 'Protect your email', summary: '', decide_path: '/foundations/plans/p1/decide' }],
        last_published: null } },
    } });
    await page.goto('/client.html');
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.locator('#toast')).toContainText('Approved — thank you.');
  });

  test('caught-up state when nothing is pending', async ({ page }) => {
    await installApp(page, { api: {
      '/portal/context': REVIEWER_CTX,
      '/portal/feed': { data: { role: 'client_reviewer', moments: [], pending_approvals: [], last_published: null } },
    } });
    await page.goto('/client.html');
    await expect(page.getByText('You’re all caught up — nothing needs you right now.')).toBeVisible();
  });

  test('an owner landing here is pointed back to the full workspace', async ({ page }) => {
    await installApp(page); // default context: sees_full_workspace = true
    await page.goto('/client.html');
    await expect(page.getByText('This is the client view.')).toBeVisible();
    await expect(page.getByRole('link', { name: /Open your workspace/ })).toBeVisible();
  });
});
