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

// What /commerce does on the page while a studio works on a client's site. The server
// side of this (who gets what, and what is refused) is tests/presence/scoped_commerce_test.mjs.
test.describe('Commerce in a client drill-in', () => {
  const NOTICE_ID = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb';
  const scoped = (extra: Record<string, unknown> = {}) => ({ api: { '/portal/context': scopedCtx('Joe’s Plumbing'), ...extra } });

  test('the builder asks /commerce for nothing, so it has no account cards to show', async ({ page }) => {
    const asked: string[] = [];
    page.on('request', (r) => { if (r.url().includes('/functions/v1/presence/commerce/')) asked.push(r.url()); });
    await installApp(page, scoped({
      // what the builder reads on boot (the same shapes as cms.spec's PRESENCE_API)
      '/site': { data: { site: { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1 }, identity: { business_name: 'Joe’s Plumbing' }, location: {} } },
      '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] },
      '/media': { data: [] }, '/settings': { data: {} }, '/health': { data: {} }, '/notes': { data: [] }, '/moments': { data: [] },
      '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'e2e-draft-hash' } },
      '/schedule': { data: { scheduled: [] } }, '/content-library': { data: [] },
    }));
    await page.goto(`/presence.html?client=${CLIENT}`);
    await expect(page.locator('h1#siteTitle')).toHaveText('Joe’s Plumbing');
    // the client's own setup list, from the client's site: the owner's hide is theirs alone
    await expect(page.locator('#ssTodo')).toContainText('Set up your site · 0 of 8');
    await page.locator('#ssTodo').click();
    await expect(page.locator('#setupCard')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Hide this list' })).toHaveCount(0);
    await expect(page.locator('#billingCard')).toHaveCount(0);
    await expect(page.locator('#deleteCard')).toHaveCount(0);
    expect(asked).toEqual([]);
  });

  test('Today offers Done only where the feed says so, and it reaches the client’s row', async ({ page }) => {
    const feedRow = (id: string, headline: string, dismissible: boolean) => ({ id, kind: 'domain_expiry', period: '2026-11', headline, body: 'Worth a look.', href: '/presence.html#business', dismissible, tier: 'needs_you', priority: false });
    await installApp(page, scoped({
      '/moments': { data: [] },
      '/portal/feed': { data: { role: 'business_owner', moments: [], pending_approvals: [], last_published: null, notices: [
        feedRow(NOTICE_ID, 'The domain expires soon', true),
        feedRow('cccccccc-1111-4111-8111-cccccccccccc', 'Their card failed', false),
      ] } },
    }));
    await page.goto(`/today.html?client=${CLIENT}`);
    const cleared = page.locator('.moment', { hasText: 'The domain expires soon' });
    await expect(cleared).toBeVisible();
    await expect(page.locator('.moment', { hasText: 'Their card failed' }).getByRole('button', { name: /^Done/ })).toHaveCount(0);
    const [dismiss] = await Promise.all([
      page.waitForRequest((r) => r.url().includes('/commerce/notices/dismiss')),
      cleared.getByRole('button', { name: /^Done/ }).click(),
    ]);
    expect(dismiss.headers()['x-dds-scope-site']).toBe(CLIENT);
    expect(dismiss.postDataJSON()).toEqual({ id: NOTICE_ID });
  });

  test('the bell’s Clear sends only what the feed lets a hand clear, under the client’s scope', async ({ page }) => {
    const feedRow = (id: string, headline: string, dismissible: boolean) => ({ id, kind: 'domain_expiry', period: '2026-11', headline, body: 'Worth a look.', href: '/presence.html#business', dismissible, tier: 'needs_you', priority: false });
    const sent: Array<[string, string]> = [];
    await installApp(page, scoped({
      '/moments': { data: [] },
      '/portal/feed': { data: { role: 'business_owner', moments: [], pending_approvals: [], last_published: null, notices: [
        feedRow(NOTICE_ID, 'The domain expires soon', true),
        feedRow('cccccccc-1111-4111-8111-cccccccccccc', 'Their card failed', false),
      ] } },
    }));
    await page.route('**/functions/v1/presence/commerce/notices/dismiss', (route) => {
      sent.push([route.request().headers()['x-dds-scope-site'] || '', route.request().postDataJSON().id]);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { dismissed: true } }) });
    });
    await page.goto(`/today.html?client=${CLIENT}`);
    await page.locator('#dds-bell').click();
    const pop = page.locator('.dds-bell-pop');
    await expect(pop.locator('.body .row')).toHaveCount(2);
    await pop.getByRole('button', { name: 'Clear' }).click();
    await expect.poll(() => sent).toEqual([[CLIENT, NOTICE_ID]]);
    await expect(pop.locator('.body .row')).toHaveCount(1);
    await expect(pop.locator('.body .row')).toContainText('Their card failed');
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

  test('Inbox enquiry pane: the + Make it a deal redirect keeps ?client=', async ({ page }) => {
    await installApp(page, { api: { ...scopedApi, '/sales/deals': { data: { id: 'd-9' } } } });
    await page.goto(`/inbox.html?client=${CLIENT}#enquiries`);
    await page.locator('#rows [role=option]').filter({ hasText: 'Sam Rivera' }).click();
    await page.locator('#rpane').getByRole('button', { name: '+ Make it a deal' }).click();
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
