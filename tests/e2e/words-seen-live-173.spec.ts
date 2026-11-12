import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_LEVEL_NAV, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// Builder item 173, words seen live (Nov 10 walk):
//  - a site hosted elsewhere never says "Changes waiting to be published" (Sites cards,
//    the band's count, the client's Overview): nothing there can be published from here;
//  - Pipeline's Open tile, with deals but none open, says "nothing open right now",
//    not "no open deals yet" above a list of six deals;
//  - Domains' empty page has a button that leads to the sites.
// (The studio's own Overview no longer saying "An update from your studio" is the
//  feed's change, pinned in tests/presence/feed_client_self_test.mjs.)

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const plan = { key: 'presence', words: 'Website + tools', status: 'active', term: 'monthly', renews: { kind: 'renews', at: '2026-12-01T00:00:00Z' } };
const site = (over: Record<string, unknown>) => ({
  site_id: '', name: '', edition: 'presence', state: 'live', state_words: 'Live', address: '', domain: null, domain_registrar: null, domain_expires_at: null, plan,
  team: [], tags: [], published_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-05T00:00:00Z',
  unpublished_changes: false, billing_issue: false, opened_at: null, pinned: false, thumb: null, copied: null, no_owner: false, ...over,
});
// the live walk: a hosted site with real changes, and two we only watch whose drafts differ
const BISTRO = site({ site_id: 's1', name: 'Bistro Nine', address: 'https://bistro.example', domain: 'bistro.example', unpublished_changes: true });
const GARAGE = site({ site_id: 's2', name: 'Garage Ten', edition: 'monitor', state: 'elsewhere', state_words: 'Hosted elsewhere', address: 'https://garage.example', domain: 'garage.example', unpublished_changes: true, published_at: null });
const FLORIST = site({ site_id: 's3', name: 'Florist Twelve', edition: 'monitor', state: 'elsewhere', state_words: 'Hosted elsewhere', address: 'https://florist.example', domain: 'florist.example', unpublished_changes: true, published_at: null });
const SITES_NAV = [STUDIO_LEVEL_NAV[0], { key: 'sites', label: 'Sites', items: [
  { key: 'sites', label: 'Sites', href: '/sites.html' }, { key: 'domains', label: 'Domains', href: '/domains.html', hidden: true },
] }, ...STUDIO_LEVEL_NAV.slice(1)];
const studioContext = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'agency', edition_name: 'Agency', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'view_all'], landing: '/agency.html', attention_count: 0, nav: SITES_NAV, plan_key: 'agency', upsell: null,
} };

async function studio(page: Page, extra: Record<string, unknown> = {}) {
  await installApp(page, { api: {
    '/portal/context': studioContext,
    '/agency/sites': { data: [BISTRO, GARAGE, FLORIST], partial: false, can_open: true, can_pin: true, can_duplicate: true, can_create: true, can_trash: true, trash: [], trash_days: 90 },
    '/agency/needs-you': { data: { rows: [], more: 0, rest: [], total: 0, empty_line: '', partial: false, own_site: true, next_by_site: {}, next_by_client: {} } },
    ...extra,
  } });
  await page.route(/\/functions\/v1\/presence\/agency\/sites\/[^/]+\/thumb/, (route: Route) => route.fulfill(json({ data: { html: '<!doctype html><p>home</p>', version: 'live' } })));
}

test.describe('Words seen live (item 173)', () => {
  test('Sites: only the hosted site says changes are waiting, and the band counts one', async ({ page }) => {
    await studio(page);
    await page.goto('/sites.html');
    await expect(page.locator('.scard')).toHaveCount(3);
    const card = (name: string) => page.locator('.scard').filter({ hasText: name });
    await expect(card('Bistro Nine')).toContainText('Changes waiting to be published');
    await expect(card('Garage Ten')).not.toContainText('Changes waiting');
    await expect(card('Florist Twelve')).not.toContainText('Changes waiting');
    const kpi = page.locator('.sband [data-filter="changes"]');
    await expect(kpi.locator('.v')).toHaveText('1');
    await kpi.click();
    await expect(page.locator('.scard:visible')).toHaveCount(1);
    await expect(page.locator('.scard:visible')).toContainText('Bistro Nine');
  });

  test('a client’s Overview: a site hosted elsewhere never says changes are waiting', async ({ page }) => {
    const CLIENT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    await installApp(page, { api: {
      '/portal/context': { data: { ...studioContext.data, edition: 'monitor', landing: '/today.html', nav: STUDIO_NAV, scope: { site_id: CLIENT, name: 'Garage Ten' }, site_live: false } },
      '/sales/summary': { data: { total: 0, open: { count: 0, value_cents: 0 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 }, by_stage: [], ar: { outstanding_cents: 0, count: 0, overdue_count: 0 } } },
    } });
    await page.route(/\/functions\/v1\/presence\/agency\/sites(\/|$|\?)/, (route: Route) => /\/thumb$/.test(new URL(route.request().url()).pathname)
      ? route.fulfill(json({ data: { html: '<!doctype html><p>home</p>', version: 'live' } }))
      : route.fulfill(json({ data: [{ ...GARAGE, site_id: CLIENT }], partial: false, can_open: true })));
    await page.goto(`/today.html?client=${CLIENT}`);
    const deck = page.locator('#client-site');
    await expect(deck.locator('#wstate')).toHaveText('Hosted elsewhere');
    await expect(deck).not.toContainText('Changes waiting');
    await expect(deck.locator('.wacts a')).toHaveText(['Open their site', 'Settings']);
  });

  test('Domains: the empty page has a button that leads to the sites', async ({ page }) => {
    await studio(page, { '/agency/domains': { data: { domains: [], builtin: [] } } });
    await page.goto('/domains.html');
    await expect(page.getByText('No domains yet.', { exact: false })).toBeVisible();
    const go = page.getByRole('link', { name: 'Choose a site' });
    await expect(go).toHaveAttribute('href', '/sites.html');
    const box = (await go.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(36);   // a real button, not a word in a sentence
  });

  test('Pipeline: deals but none open reads “nothing open right now”', async ({ page }) => {
    const won = (n: number) => ({ id: `d${n}`, title: `Won deal ${n}`, stage: 'won', source: 'manual', expected_value_cents: 100000, contact_id: null, converted_client_id: `c${n}`, converted_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' });
    await installApp(page, { api: {
      '/sales/deals': { data: [won(1), won(2), { ...won(3), id: 'd3', stage: 'lost', converted_client_id: null, converted_at: null }] },
      '/sales/summary': { data: { total: 3, open: { count: 0, value_cents: 0 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: 67, won: 2, lost: 1, window_days: 3650 }, by_stage: [], ar: { outstanding_cents: 0, count: 0, overdue_count: 0 } } },
      '/sales/contacts': { data: [] }, '/sales/templates': { data: [] }, '/sales/services': { data: [] },
      '/sales/receivables': { data: { items: [], total_cents: 0 } }, '/identity': { data: { business_name: 'Test Studio' } },
    } });
    await page.goto('/pipeline.html');
    const open = page.locator('#summary .st').first();
    await expect(open.locator('.k')).toHaveText('Open');
    await expect(open.locator('.s')).toHaveText('nothing open right now');
  });
});
