import { test, expect } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// SC-1 — Studio → Client drill-in. The scope rides ?client=<id>; the shell shows
// the breadcrumb and sends x-dds-scope-site; the server is the authority.
const CLIENT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

const scopedCtx = (name: string) => ({ data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS',
  edition_features: ALL_FEATURES, is_agency: true, is_operator: false, sees_full_workspace: true,
  capabilities: ['edit', 'publish', 'view_all'], landing: '/today.html', attention_count: 0, nav: STUDIO_NAV,
  scope: { site_id: CLIENT, name },
} });

test.describe('Secure client drill-in', () => {
  test('scoped operator sees the "Studio › {client}" breadcrumb', async ({ page }) => {
    await installApp(page, { api: {
      '/portal/context': scopedCtx('Joe’s Plumbing'),
      '/portal/feed': { data: { role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null } },
      '/moments': { data: [] },
    } });
    await page.goto(`/today.html?client=${CLIENT}`);
    const shell = page.locator('#dds-shell');
    await expect(shell).toContainText('Studio');
    await expect(shell).toContainText('Joe’s Plumbing');
    await expect(shell.locator('#dds-scope-exit')).toBeVisible(); // the way back to Studio
  });

  test('the shell forwards the scope header on its calls', async ({ page }) => {
    let sentScope = '';
    await installApp(page, { api: {
      '/portal/feed': { data: { role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null } },
      '/moments': { data: [] },
    } });
    await page.route('**/functions/v1/presence/portal/context', (route) => {
      sentScope = route.request().headers()['x-dds-scope-site'] || '';
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(scopedCtx('Joe’s Plumbing')) });
    });
    await page.goto(`/today.html?client=${CLIENT}`);
    await expect(page.locator('#dds-shell')).toContainText('Joe’s Plumbing');
    expect(sentScope).toBe(CLIENT); // the exact scope id was sent for the server to validate
  });

  test('fail-closed: a denied scope never renders another tenant (403 → minimal shell, no nav)', async ({ page }) => {
    await installApp(page);
    // the server rejects the scope (unauthorized/forged); the shell must NOT show a client workspace
    await page.route('**/functions/v1/presence/portal/context', (route) =>
      route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'scope_denied', message: 'You don’t have access to that client.' }) }));
    await page.goto(`/today.html?client=${CLIENT}`);
    await expect(page.locator('#dds-shell .dds-brand')).toBeVisible(); // shell degrades safely
    await expect(page.locator('.dds-nav')).toHaveCount(0);             // no workspace nav on a denied scope
  });

  test('a normal owner (no ?client) shows no breadcrumb', async ({ page }) => {
    await installApp(page);
    await page.goto('/today.html');
    await expect(page.locator('#dds-scope-exit')).toHaveCount(0);
    await expect(page.locator('#dds-shell .dds-brand')).toContainText('Studio OS');
  });
});
