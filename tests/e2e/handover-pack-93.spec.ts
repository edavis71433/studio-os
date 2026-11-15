import { test, expect, type Route } from '@playwright/test';
import { installApp, ALL_FEATURES, STUDIO_LEVEL_NAV } from './helpers/app';

// Sales item 93: a hand-over pack for a client who leaves. On a customer's record, More
// → Hand-over pack downloads one zip (asked on the customer's own site) or emails the
// owner that it waits in their portal; the portal's Help tab lets the owner download
// it themselves. Drawn in Figma first (page "Sales 94 · 105 · 93 · 120", part 5).
const STUDIO_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'view_all', 'export'], landing: '/agency.html', attention_count: 0, nav: STUDIO_LEVEL_NAV, plan_key: 'presence', upsell: null, scope: null,
} };
const RECORD = { data: {
  identity: { client_id: 'c-juniper', customer_site_id: 'site-juniper', project_id: null, deal_id: null, contact_id: null },
  header: { name: 'Juniper Floral Co.', person: 'Ivy Chen', email: 'ivy@juniper.example', status: 'customer' },
  highlights: {}, sections: { overview: true, details: true }, default_tab: 'details', canonical: { key: 'client', value: 'site-juniper' },
} };
const ZIP = { status: 200, headers: { 'Content-Type': 'application/zip', 'Access-Control-Expose-Headers': 'Content-Disposition', 'Content-Disposition': 'attachment; filename="hand-over-pack-juniper-floral-co-2026-11-12.zip"' }, body: 'PK' };

test.describe('sales item 93 — the hand-over pack', () => {
  test('the record: More → Hand-over pack says what is in it and downloads it on the customer\'s site', async ({ page }) => {
    const asked: Array<{ method: string; path: string; scope: string | null }> = [];
    await installApp(page, { api: { '/portal/context': STUDIO_CTX, '/crm/record': RECORD, '/crm/activity': { data: { items: [], upcoming: [] } } } });
    await page.route(/\/functions\/v1\/presence\/handover\/(pack|notify)$/, (route: Route) => {
      const r = route.request(); const path = new URL(r.url()).pathname.replace(/^.*\/presence/, '');
      asked.push({ method: r.method(), path, scope: r.headers()['x-dds-scope-site'] || null });
      return path === '/handover/pack' ? route.fulfill(ZIP) : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { sent: true, to: 'ivy@juniper.example' } }) });
    });
    await page.goto('/crm.html?client=site-juniper');
    await page.locator('#act-more').click();
    await page.locator('#act-handover').click();
    const dlg = page.getByRole('dialog', { name: 'Hand-over pack for Juniper Floral Co.' });
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole('listitem')).toHaveCount(6);
    await expect(dlg).toContainText('Making it changes nothing');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    const dl = page.waitForEvent('download');
    await dlg.getByRole('button', { name: 'Download the pack' }).click();
    expect((await dl).suggestedFilename()).toBe('hand-over-pack-juniper-floral-co-2026-11-12.zip');
    await expect(dlg).toBeHidden();
    // asked on the customer's own site, never the studio's
    expect(asked).toEqual([{ method: 'GET', path: '/handover/pack', scope: 'site-juniper' }]);
  });

  test('the record: Email them a link asks the server once, on the customer\'s site, and says who it went to', async ({ page }) => {
    const asked: Array<{ method: string; scope: string | null }> = [];
    await installApp(page, { api: { '/portal/context': STUDIO_CTX, '/crm/record': RECORD, '/crm/activity': { data: { items: [], upcoming: [] } } } });
    await page.route(/\/functions\/v1\/presence\/handover\/notify$/, (route: Route) => {
      asked.push({ method: route.request().method(), scope: route.request().headers()['x-dds-scope-site'] || null });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { sent: true, to: 'ivy@juniper.example' } }) });
    });
    await page.goto('/crm.html?client=site-juniper');
    await page.locator('#act-more').click();
    await page.locator('#act-handover').click();
    await page.getByRole('dialog', { name: 'Hand-over pack for Juniper Floral Co.' }).getByRole('button', { name: 'Email them a link' }).click();
    await expect(page.getByText('Sent to ivy@juniper.example. They download it from Help in their portal.')).toBeVisible();
    expect(asked).toEqual([{ method: 'POST', scope: 'site-juniper' }]);
  });

  test('the record: a pack that couldn\'t be made says why and stays open', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': STUDIO_CTX, '/crm/record': RECORD, '/crm/activity': { data: { items: [], upcoming: [] } } } });
    await page.route(/\/functions\/v1\/presence\/handover\/pack$/, (route: Route) => route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'read_failed', message: 'We couldn’t gather everything for the pack just now, so nothing was downloaded. Try again in a moment.' }) }));
    await page.goto('/crm.html?client=site-juniper');
    await page.locator('#act-more').click();
    await page.locator('#act-handover').click();
    const dlg = page.getByRole('dialog', { name: 'Hand-over pack for Juniper Floral Co.' });
    await dlg.getByRole('button', { name: 'Download the pack' }).click();
    await expect(dlg.getByRole('alert')).toHaveText('We couldn’t gather everything for the pack just now, so nothing was downloaded. Try again in a moment.');
    await expect(dlg.getByRole('button', { name: 'Download the pack' })).toBeEnabled();
  });

  test('the portal: Help lets the owner download their hand-over pack', async ({ page }) => {
    const PID = '11111111-1111-4111-8111-111111111111';
    const CTX = { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ['website', 'client_portal'], is_agency: false, is_operator: false, sees_full_workspace: true,
      is_client_portal: false, is_managed_client: true, capabilities: ['view_all'], landing: '/client.html', attention_count: 0, nav: [], studio: { name: 'Marlow & Co', logo_url: null, accent: '#8c3b2e', is_default: false }, client_first_name: 'Ivy' } };
    await installApp(page, { api: {
      '/portal/context': CTX, '/portal/feed': { data: { role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null } },
      '/client/notifications': { data: [], unread_count: 0 }, '/client/projects': { data: [{ id: PID, name: 'Website build', status: 'active' }] },
      [`/client/projects/${PID}`]: { data: { project: { id: PID, name: 'Website build', status: 'active' }, milestones: [], tasks: [], events: [], surveys: [], progress: { total: 0, done: 0, pct: 0 }, deliverables: [], approvals: [] } },
      '/client/billing': { data: { invoices: [] } }, '/client/faq': { data: { html: '', faq: { items: [] } } }, '/client/kit': { data: null }, '/client/support': { data: [] },
    } });
    await page.route(/\/functions\/v1\/presence\/handover\/pack$/, (route: Route) => route.fulfill(ZIP));
    await page.goto('/client.html');
    await page.locator('#tabnav [data-tab="help"]').click();
    const card = page.locator('#packCard');
    await expect(card.getByRole('heading', { name: 'Take everything with you' })).toBeVisible();
    const dl = page.waitForEvent('download');
    await card.getByRole('button', { name: 'Download your hand-over pack' }).click();
    expect((await dl).suggestedFilename()).toBe('hand-over-pack-juniper-floral-co-2026-11-12.zip');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
});
