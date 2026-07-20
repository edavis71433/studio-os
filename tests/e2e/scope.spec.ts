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

// ── Batch A (post-redesign audit) — scope-carry regressions (A6) ─────────────
// The drill-in scope must ride EVERY exit that stays WITHIN the drilled tenant:
// the two convert redirects are JS navigations (shell.js only rewrites anchors),
// and APP_PAGES must cover per-site app pages (e.g. broadcasts) so page-authored
// anchors get ?client= too. customers.html is the deliberate EXCEPTION — it is
// the agency-portfolio roster (/studio/customers keyed on agency_site_id), so
// carrying a drilled LEAF's scope would resolve it to an empty list. Those
// "← Customers" / "Open Customers" anchors are the escape hatch UP to the full
// roster and must stay UNSCOPED.
test.describe('Scope carry — convert redirects + APP_PAGES coverage', () => {
  const scopedApi = { '/portal/context': scopedCtx('Joe’s Plumbing'),
    '/portal/feed': { data: { role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null } },
    '/moments': { data: [] } };

  test('leads.html: the → Deal convert redirect keeps ?client=', async ({ page }) => {
    await installApp(page, { api: { ...scopedApi, '/sales/deals': { data: { id: 'd-9' } } } });
    await page.goto(`/leads.html?client=${CLIENT}`);
    await page.locator('[data-deal="l1"]').click();
    await page.waitForURL(new RegExp(`crm\\.html\\?deal=d-9&tab=deal&client=${CLIENT}`));
  });

  test('contacts.html: the row → New deal redirect keeps ?client=', async ({ page }) => {
    await installApp(page, { api: { ...scopedApi,
      '/sales/contacts': { data: [{ id: 'ct-1', name: 'Sam Rivera', email: 'sam@example.com', phone: '', company: 'Acme', updated_at: '2026-07-01T00:00:00Z' }] },
      '/sales/deals': { data: { id: 'd-9' } } } });
    await page.goto(`/contacts.html?client=${CLIENT}`);
    await page.locator('[data-deal="ct-1"]').first().click();
    await page.waitForURL(new RegExp(`crm\\.html\\?deal=d-9&tab=deal&client=${CLIENT}`));
  });

  test('APP_PAGES scopes per-site anchors (broadcasts) but NOT the customers escape hatch', async ({ page }) => {
    await installApp(page, { api: scopedApi });
    await page.goto(`/today.html?client=${CLIENT}`);
    await expect(page.locator('#dds-shell')).toContainText('Joe’s Plumbing');
    // inject page-authored anchors — the MutationObserver re-applies the carry
    await page.evaluate(() => {
      for (const [id, href] of [['x-cust', '/customers.html'], ['x-bc', '/broadcasts.html']]) {
        const a = document.createElement('a'); a.id = id; a.href = href; a.textContent = id;
        document.body.appendChild(a);
      }
    });
    // broadcasts is per-site → carries the drilled scope
    await expect(page.locator('#x-bc')).toHaveAttribute('href', `/broadcasts.html?client=${CLIENT}`);
    // customers is the agency-portfolio roster → the anchor stays UNSCOPED so
    // "← Customers" / "Open Customers" reach the full list, not an empty leaf view
    await expect(page.locator('#x-cust')).toHaveAttribute('href', '/customers.html');
  });
});
