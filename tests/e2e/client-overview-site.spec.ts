import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// Builder list item 129 (Nov 9 2026): like Squarespace, a site opens into its own
// home. A client's Overview now leads with their website: the picture of the home
// page (the Sites page's own picture, scripts off), its status, when it was
// published and edited, and Edit site. The row is the one GET /agency/sites gives
// the Sites page, so the two never disagree. Without that row the Overview is as
// it was.
const CLIENT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const ctx = (extra: Record<string, unknown> = {}) => ({ data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS',
  edition_features: ALL_FEATURES, is_agency: true, is_operator: false, sees_full_workspace: true,
  capabilities: ['edit', 'publish', 'view_all'], landing: '/today.html', attention_count: 0, nav: STUDIO_NAV,
  scope: { site_id: CLIENT, name: 'Maple Street Studio' }, site_live: true, ...extra,
} });
const RECORD = { data: {
  identity: { contact_id: null, deal_id: null, client_id: 'cl-1', customer_site_id: CLIENT, project_id: null },
  header: { name: 'Maple Street Studio', company: '', email: 'hello@example.com', phone: '', status: 'customer' },
  highlights: { value_cents: 0, stage: 'won', owed_cents: 0 },
  sections: { overview: true, messages: true, deal: false, delivery: false, details: false }, default_tab: 'overview', canonical: { key: 'client', value: CLIENT },
} };
const QUIET = { data: { total: 0, open: { count: 0, value_cents: 0 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 }, by_stage: [], ar: { outstanding_cents: 0, count: 0, overdue_count: 0 } } };
const site = (over: Record<string, unknown> = {}) => ({
  site_id: CLIENT, name: 'Maple Street Studio', edition: 'presence', state: 'live', state_words: 'Live', address: 'https://maplestreet.example', domain: 'maplestreet.example',
  domain_registrar: null, domain_expires_at: null, plan: { key: 'presence', words: 'Website + tools', status: 'active', term: 'monthly', renews: { kind: 'renews', at: '2026-12-01T00:00:00Z' } },
  team: [], tags: [], published_at: '2026-11-04T00:00:00Z', updated_at: '2026-11-07T00:00:00Z', unpublished_changes: true, billing_issue: false, opened_at: null, pinned: false, thumb: 'live', ...over,
});
const OTHER = site({ site_id: 'other-site', name: 'Someone Else', address: 'https://else.example' });
const THUMB = '<!doctype html><html><body style="margin:0;background:#f4efe6"><h1 id="thumb-mark" style="font:48px Georgia;margin:40px">Maple Street home page</h1></body></html>';
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function open(page: Page, row: Record<string, unknown> | null, extraCtx: Record<string, unknown> = {}) {
  const scopes: string[] = [];
  await installApp(page, { api: { '/portal/context': ctx(extraCtx), '/crm/record': RECORD, '/sales/summary': QUIET } });
  await page.route(/\/functions\/v1\/presence\/agency\/sites(\/|$|\?)/, async (route: Route) => {
    const u = new URL(route.request().url());
    scopes.push(route.request().headers()['x-dds-scope-site'] ?? 'none');
    if (/\/thumb$/.test(u.pathname)) return route.fulfill(json({ data: { html: THUMB, version: 'live' } }));
    if (row === null) return route.fulfill(json({ error: 'forbidden' }, 403));
    return route.fulfill(json({ data: [OTHER, row], partial: false, can_open: true, can_pin: true, can_duplicate: true }));
  });
  await page.goto(`/today.html?client=${CLIENT}`);
  return scopes;
}

test.describe('item 129 — a client’s Overview leads with their website', () => {
  test('the picture, the status, when it was published and edited, and the doors; read at studio level', async ({ page }) => {
    const scopes = await open(page, site());
    const deck = page.locator('#client-site');
    await expect(deck).toBeVisible();
    await expect(deck.locator('.wname a')).toHaveText('maplestreet.example');
    await expect(deck.locator('.wname a')).toHaveAttribute('target', '_blank');
    await expect(deck.locator('#wstate')).toHaveText('Live');
    await expect(deck).toContainText('Published Nov 4 · Edited Nov 7');
    await expect(deck).toContainText('Changes waiting to be published');
    await expect(deck.locator('.wacts a')).toHaveText(['Edit site', 'View live', 'Publish changes', 'Analytics']);
    await expect(deck.locator('.wacts a').nth(0)).toHaveAttribute('href', `/presence.html?client=${CLIENT}`);
    await expect(deck.locator('.wacts a').nth(2)).toHaveAttribute('href', `/presence.html?client=${CLIENT}#publish`);
    await expect(deck.locator('.wpic a.wlink')).toHaveAttribute('href', `/presence.html?client=${CLIENT}`);
    // the picture: the Sites page's own, in a frame with scripts off
    const frame = deck.locator('.wpic iframe');
    await expect(frame).toHaveAttribute('sandbox', 'allow-same-origin');
    await expect(frame.contentFrame().locator('#thumb-mark')).toHaveText('Maple Street home page');
    // above the client's facts, and the facts are still there
    const [deckTop, factsTop] = await Promise.all([deck.evaluate((n) => n.getBoundingClientRect().top), page.locator('#client-facts').evaluate((n) => n.getBoundingClientRect().top)]);
    expect(deckTop).toBeLessThan(factsTop);
    await expect(page.locator('#cf-site .hl-v')).toHaveText('Live');
    // both reads went out at studio level, never under the client's scope
    expect(new Set(scopes)).toEqual(new Set(['']));
  });

  test('a site we only watch: their own host, Open their site, no editor door; one that was never published says so', async ({ page }) => {
    await open(page, site({ edition: 'monitor', state: 'elsewhere', state_words: 'Hosted elsewhere', thumb: null, published_at: null, updated_at: null, unpublished_changes: false }), { edition: 'monitor', site_live: false });
    const deck = page.locator('#client-site');
    await expect(deck.locator('.wfall')).toContainText('Lives on their own host');
    await expect(deck.locator('#wstate')).toHaveText('Hosted elsewhere');
    await expect(deck.locator('.wacts a')).toHaveText(['Open their site', 'Settings']);
    await expect(deck.locator('.wpic iframe')).toHaveCount(0);
    await expect(deck.locator('.wpic a.wlink')).toHaveCount(0);
  });

  test('never published: no live address, the editor is the door, and the line says nothing is public', async ({ page }) => {
    await open(page, site({ state: 'not_live', state_words: 'Not live yet', address: '', published_at: null, thumb: 'draft', unpublished_changes: true }), { site_live: false });
    const deck = page.locator('#client-site');
    await expect(deck.locator('#wstate')).toHaveText('Not live yet');
    await expect(deck).toContainText('Nothing is public yet');
    await expect(deck.locator('.wacts a')).toHaveText(['Edit site', 'Analytics']);   // no View live, no Publish changes: nothing to view, and publishing is the editor's job here
    await expect(deck).toContainText('Not published yet · Edited Nov 7');
  });

  test('without the row (a seat that can’t see Sites) the Overview is as it was; a plain owner never gets one', async ({ page }) => {
    await open(page, null);
    await expect(page.locator('#client-facts')).toBeVisible();
    await expect(page.locator('#client-site')).toHaveCount(0);
    await installApp(page, { api: { '/portal/context': ctx({ is_agency: false, scope: null }), '/agency/sites': { data: [site()], partial: false } } });
    await page.goto('/today.html');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('#client-site')).toHaveCount(0);
  });

  test('phone: the picture above the words, nothing wider than the screen', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page, site());
    const deck = page.locator('#client-site');
    await expect(deck).toBeVisible();
    const [pic, tx] = await Promise.all([deck.locator('.wpic').evaluate((n) => n.getBoundingClientRect().top), deck.locator('.wtx').evaluate((n) => n.getBoundingClientRect().top)]);
    expect(pic).toBeLessThan(tx);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
});
