import { test, expect } from '@playwright/test';
import { installApp } from './helpers/app';

// Visual regression — screenshots per viewport (desktop / tablet / mobile) vs
// committed baselines. OPT-IN: set VISUAL=1 once baselines exist, so the gate is
// never red merely because a baseline hasn't been generated yet.
//   1) generate:  VISUAL=1 npm run test:e2e:update-snapshots
//   2) commit tests/e2e/__screenshots__/**
//   3) enforce:   VISUAL=1 npm run test:e2e
test.describe('Visual baselines', () => {
  test.skip(process.env.VISUAL !== '1', 'set VISUAL=1 after baselines are committed');

  test('Today — full page', async ({ page }) => {
    await installApp(page);
    await page.goto('/today.html');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('today.png', { fullPage: true, animations: 'disabled' });
  });

  test('Leads inbox — full page', async ({ page }) => {
    await installApp(page);
    await page.goto('/leads.html');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('leads.png', { fullPage: true, animations: 'disabled' });
  });

  test('Client portal — full page', async ({ page }) => {
    await installApp(page, { api: {
      '/portal/context': { data: { site_role: 'client_reviewer', sees_full_workspace: false, is_client_portal: true, edition_key: 'studio_os', edition_features: ['website', 'client_portal'], attention_count: 1, nav: [{ key: 'client', label: 'Your updates', items: [{ key: 'feed', label: 'Updates', href: '/client.html' }] }] } },
      '/portal/feed': { data: { role: 'client_reviewer', moments: [{ id: 'm', headline: 'Your new hours are live', summary: 'Published last week.' }], pending_approvals: [{ id: 'p1', kind: 'infrastructure', title: 'Protect your email', summary: '', decide_path: '/x' }], last_published: null } },
    } });
    await page.goto('/client.html');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('client-portal.png', { fullPage: true, animations: 'disabled' });
  });
});
