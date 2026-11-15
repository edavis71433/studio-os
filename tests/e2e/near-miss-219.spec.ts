import { test, expect, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp, STUDIO_LEVEL_NAV, ALL_FEATURES } from './helpers/app';

// Builder list item 219 (Nov 2026; review file 02, findings 1 and 9), as drawn in Figma (page
// 410:2) and approved: the Search tab lists the searches almost on page one (places 8 to 20)
// with the page Google shows and one thing to fix there, and says why last month's visits
// fell; the Sites table's red drop gets a line saying why, and pressing it opens the reason
// in full. The fixtures are routes/search_tab.ts's near_miss and drop, and
// /agency/site-numbers' drops (near_miss_219_test.mjs covers the server). Fake names only.

const PAGE_API = {
  '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/health': { data: { state: 'healthy', sentence: 'Your website is live and up to date.', detail: '', first_run: false, facts: { website: { state: 'live', label: 'Live', detail: '' }, draft: { state: 'clean', label: 'Up to date', detail: '' }, last_publish: { label: 'Sun, Oct 5', detail: 'published by you' }, domain: { label: 'maple.example', state: 'ok', detail: '' } } } },
  '/settings': { data: { blocks: [], section_meta: {}, pages: [], search_hidden: false, llms_txt: null } },
  '/media': { data: [] }, '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] },
  '/site': { data: { site: { id: '00000000-0000-4000-8000-000000000001', status: 'live', edition: 'presence', custom_domain: 'maple.example', template_slug: 'bistro', last_published_at: '2026-07-01T00:00:00Z', netlify_site_id: 'n1' }, identity: { business_name: 'Maple & Main Realty', seo_title: 'Maple & Main Realty, Burbank', seo_description: '' }, location: {}, voice: {}, offerings: [], faqs: [], testimonials: [], posts: [] } },
  '/foundations/domain': { data: { custom_domain: 'maple.example', health: 'ok' } },
  '/redirects': { data: [] },
  '/search/health': { data: { verification: { google: true, bing: false }, seo_fields: { title: true, description: false }, schema: { type: 'LocalBusiness', industry: 'generic' }, sitemap: true, robots: true, internal_links: 'correct_by_construction', hidden_pages: [], links: [] } },
};
const CONSOLE = { status: 'connected', health: 'ok', reason: '', last_sync_at: null, connect_href: '/connections.html', readiness: 'measuring', unavailable: false, has_data: true,
  clicks: 64, impressions: 2140, prior_clicks: 140, prior_impressions: 2400, period: '2026-10',
  monthly: [{ period: '2026-09', clicks: 140, impressions: 2400 }, { period: '2026-10', clicks: 64, impressions: 2140 }],
  top_terms: [{ term: 'maple and main realty', clicks: 64, impressions: 300 }], top_pages: [{ path: '/listings/', clicks: 28, impressions: 400 }] };
const near = (over: Record<string, unknown>) => ({ term: '', place: 12, prior_place: null, seen: 100, clicks: 1, path: '/', page: 'Home', key: 'home', fix: 'title', words: '', ...over });
const NEAR = { period: '2026-10', from: 8, to: 20, list: [
  near({ term: 'homes for sale burbank', place: 11.4, prior_place: 13, seen: 1240, clicks: 18, path: '/listings/', page: 'Listings', key: 'page:listings', fix: 'title', words: 'The page’s title on Google doesn’t say “burbank”.' }),
  near({ term: 'realtor near me', place: 14, prior_place: 11, seen: 2100, clicks: 9, path: '/', page: 'Home', key: 'home', fix: 'title', words: 'The page’s title on Google doesn’t say “realtor”.' }),
  near({ term: 'maple and main reviews', place: 19.4, seen: 140, clicks: 0, path: '/reviews/', page: 'Reviews', key: 'page:reviews', fix: 'already', words: 'Its title and description already say it. Links from other websites and more reviews help most.' }),
  near({ term: 'spring market report', place: 12, seen: 60, clicks: 2, path: '/updates/spring-market/', page: '/updates/spring-market/', key: null, fix: 'check', words: 'Check the page’s title on Google says “spring market report”.' }),
] };
const DROP = { pct: 41, now: 389, was: 660, short: 'Mostly fewer Google searches for your name', sentence: '389 visits, against 660 in September. Most of the drop came from Google searches: 180 fewer visits. Fewer people looked you up by name: “maple and main realty” brought 64 clicks from Google, against 140.',
  parts: [{ channel: 'google', name: 'Google searches', now: 214, was: 394, change: -180 }, { channel: 'direct', name: 'Straight to the site', now: 101, was: 163, change: -62 }, { channel: 'social', name: 'Social media', now: 33, was: 28, change: 5 }],
  search: { term: 'maple and main realty', now: 64, was: 140, own_name: true }, month: '2026-10', prior: '2026-09', month_label: 'October', prior_label: 'September' };
const VIS = (over: Record<string, unknown> = {}) => ({ data: {
  state: 'ready', address: { url: 'https://maple.example/', domain: 'maple.example', hosted: true }, score: null, ai: null, ai_check_url: 'https://tools.example.com/ai-visibility',
  console: CONSOLE, listing: { status: 'disconnected', health: 'unknown', reason: '', last_sync_at: null, connect_href: '/connections.html', property: null, data: null },
  tools: { ready: true, redirects: 0, verification: { google: true, bing: false }, sitemap: 'https://maple.example/sitemap.xml', llms: { set: false, chars: 0, url: 'https://maple.example/llms.txt', max: 4000 }, hidden: false },
  tasks: [], movers: null, follow: { count: 0, max: 10 }, near_miss: NEAR, drop: DROP, ...over,
} });

async function openSearch(page: Page, vis: unknown = VIS()) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // the Search tab's tip comes up 400 ms after the tab opens, over the cards; seen already, so a check
  // (axe above all) never reads the cards through a tip that is still fading in
  await page.addInitScript(() => { try { localStorage.setItem('dds-hints', JSON.stringify({ 'search-plain': 1 })); } catch { /* storage may be denied */ } });
  await installApp(page, { api: { ...PAGE_API, '/visibility': vis as never, '/visibility/follow': { data: { terms: [], suggestions: [], max: 10, month: '2026-10', prior: '2026-09', connected: true } } } as never });
  await page.goto('/presence.html#search');
  await expect(page.locator('#view-search')).toBeVisible();
  await expect(page.locator('#svTools')).toBeVisible();
  return errors;
}

test.describe('Search tab: almost on page one, and why visits fell (builder list item 219)', () => {
  test('why visits fell: the fall, where the visits came from, and the search that lost the most', async ({ page }) => {
    const errors = await openSearch(page);
    const card = page.locator('#svDropCard');
    await expect(card).toBeVisible();
    await expect(card.getByRole('heading', { name: 'Visits fell 41% in October' })).toBeVisible();
    await expect(card.locator('p').first()).toHaveText(DROP.sentence);
    await expect(card.locator('.sv-drop-k')).toHaveText('Where the visits came from, October against September');
    await expect(card.locator('li > span:first-child')).toHaveText(['Google searches', 'Straight to the site', 'Social media']);
    await expect(card.locator('li .c')).toHaveText(['−180', '−62', '+5']);
    await expect(card.locator('li .c.down')).toHaveCount(2);
    await card.getByRole('button', { name: 'See the searches ›' }).click();
    await expect(page.locator('#svConsoleCard')).toBeInViewport();
    expect(errors).toEqual([]);
  });

  test('almost on page one: each search with its place, the page Google shows and one thing to fix', async ({ page }) => {
    const errors = await openSearch(page);
    const card = page.locator('#svNearCard');
    await expect(card).toBeVisible();
    await expect(card.locator('#svNearN')).toHaveText('4 searches');
    await expect(card.locator('#svNearSrc')).toHaveText('From Search Console · October');
    const rows = card.locator('tbody tr');
    await expect(rows.locator('td.q')).toHaveText(['homes for sale burbank', 'realtor near me', 'maple and main reviews', 'spring market report']);
    await expect(rows.nth(0).locator('td.pl')).toContainText('#11');
    await expect(rows.nth(0).locator('td.pl .sv-chg.up')).toContainText('up 2 places');
    await expect(rows.nth(1).locator('td.pl .sv-chg.down')).toContainText('down 3 places');
    await expect(rows.nth(2).locator('td.pl .sv-chg')).toHaveText('New');
    await expect(rows.nth(0).locator('td.fx')).toHaveText('The page’s title on Google doesn’t say “burbank”.');
    await expect(rows.locator('.sv-near-go')).toHaveText(['Improve the page', 'Improve the page', 'Ask for reviews', 'Open the page']);
    // the home page's fix is the Search tab's own title on Google
    await rows.nth(1).getByRole('button', { name: 'Improve the page: realtor near me' }).click();
    await expect(page.locator('#f-seo_title')).toBeFocused();
    // a page we can't read opens on the live site
    await page.context().route('https://maple.example/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>live</p>' }));
    const [popup] = await Promise.all([page.waitForEvent('popup'), rows.nth(3).getByRole('button', { name: /Open the page/ }).click()]);
    expect(popup.url()).toBe('https://maple.example/updates/spring-market/');
    await popup.close();
    expect(errors).toEqual([]);
  });

  test('nothing to say: no drop and no pairs kept yet, both cards stay away', async ({ page }) => {
    await openSearch(page, VIS({ near_miss: null, drop: null }));
    await expect(page.locator('#svNums')).toBeVisible();
    await expect(page.locator('#svDropCard')).toBeHidden();
    await expect(page.locator('#svNearCard')).toBeHidden();
  });

  test('a phone: the searches stack as cards, the button a full-size tap, no sideways scroll', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 1280) > 760, 'phone only');
    await openSearch(page);
    const row = page.locator('#svNearCard tbody tr').first();
    await expect(row.locator('.sv-near-ph')).toBeVisible();
    await expect(row.locator('td.pg')).toHaveText('Google shows /listings/');
    const h = await row.locator('.sv-near-go').evaluate((n) => (n as HTMLElement).getBoundingClientRect().height);
    expect(h).toBeGreaterThanOrEqual(44);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(1);
  });

  test('no serious accessibility problems on the two cards', async ({ page }) => {
    await openSearch(page);
    await expect(page.locator('#svNearCard tbody tr')).toHaveCount(4);
    const r = await new AxeBuilder({ page }).include('#svDropCard').include('#svNearCard').withTags(['wcag2a', 'wcag2aa']).analyze();
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
    expect(bad).toEqual([]);
  });
});

// ── Sites: the reason under a red drop ──
const site = (over: Record<string, unknown>) => ({
  site_id: '', name: '', edition: 'presence', state: 'live', state_words: 'Live', address: '', domain: null, domain_registrar: null, domain_expires_at: null,
  plan: { key: 'presence', words: 'Website + tools', status: 'active', term: 'monthly', renews: { kind: 'renews', at: '2026-12-01T00:00:00Z' } },
  team: [{ who: 'owner@studio.example', email: 'owner@studio.example', side: 'studio', role: 'Owner', me: true, invited: false }],
  tags: [], published_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-05T00:00:00Z', unpublished_changes: false, billing_issue: false, opened_at: null, pinned: false, thumb: 'live', copied: null, no_owner: false, ...over });
const SITES = [site({ site_id: 's1', name: 'Maple & Main Realty', address: 'https://maple.example' }), site({ site_id: 's2', name: 'Bluebird Bakery', address: 'https://bluebird.example' })];
const NUMBERS = {
  data: {
    s1: { visitors: { value: 812, prior: 688 }, visitors_why: null, search: { value: 64, prior: 59 }, search_why: null, health: null, health_why: 'not_checked' },
    s2: { visitors: { value: 389, prior: 660 }, visitors_why: null, search: { value: 12, prior: 24 }, search_why: null, health: null, health_why: 'not_checked' },
  },
  month: '2026-10', prior_month: '2026-09', month_label: 'October', prior_label: 'September', partial: false,
  drops: { s2: { ...DROP, short: 'Mostly fewer Google searches', search: { term: 'bluebird bakery', now: 64, was: 140, own_name: true } } },
};
const SITES_NAV = [STUDIO_LEVEL_NAV[0], { key: 'sites', label: 'Sites', items: [{ key: 'sites', label: 'Sites', href: '/sites.html' }] }, ...STUDIO_LEVEL_NAV.slice(1)];
const studioContext = { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'agency', edition_name: 'Agency', edition_features: ALL_FEATURES, is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false, capabilities: ['edit', 'publish', 'invite', 'configure', 'view_all'], landing: '/agency.html', attention_count: 0, nav: SITES_NAV, plan_key: 'agency', upsell: null } };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function openSites(page: Page, display: 'cards' | 'table') {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await installApp(page, { api: {
    '/portal/context': studioContext,
    '/agency/sites': { data: SITES, partial: false, can_open: true, can_pin: true, can_duplicate: true, can_create: true, can_trash: true, trash: [], trash_days: 90 },
    '/agency/needs-you': { data: { rows: [], more: 0, rest: [], total: 0, empty_line: '', partial: false, own_site: true, next_by_site: {}, next_by_client: {} } },
  } as never });
  await page.route(/\/functions\/v1\/presence\/agency\/sites\/[^/]+\/thumb/, (route: Route) => route.fulfill(json({ data: { html: '<h1>Home</h1>', version: 'live' } })));
  await page.route(/\/functions\/v1\/presence\/agency\/site-numbers$/, (route: Route) => route.fulfill(json(NUMBERS)));
  await page.addInitScript((v) => { try { localStorage.setItem('dds-display:sites', v); } catch { /* */ } }, display);
  await page.goto('/sites.html');
  await expect(page.locator('.scard').first()).toBeAttached();
  return errors;
}

test.describe('Sites: a red drop says why (builder list item 219)', () => {
  test('cards: the line under the drop, and the reason in full when pressed', async ({ page }) => {
    const errors = await openSites(page, 'cards');
    const blue = page.locator('.scard[data-site="s2"] .snum').first();
    const line = blue.getByRole('button', { name: 'Mostly fewer Google searches' });
    await expect(line).toBeVisible();
    await expect(page.locator('.scard[data-site="s1"] .dropwhy')).toHaveCount(0);
    await line.click();
    const pop = page.getByRole('dialog', { name: 'Visits fell 41% in October' });
    await expect(pop).toBeVisible();
    await expect(pop.locator('p').first()).toHaveText('389, against 660 in September.');
    await expect(pop.locator('li')).toHaveText(['Google searches−180', 'Straight to the site−62', 'Social media+5']);
    await expect(pop.locator('p.soft')).toHaveText('Fewer people looked them up by name: “bluebird bakery”, 64 clicks from Google, against 140.');
    await expect(pop.getByRole('link', { name: 'Open the Search tab for Bluebird Bakery ›' })).toHaveAttribute('href', '/presence.html?client=s2#search');
    await expect(line).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
    await expect(line).toBeFocused();
    expect(errors).toEqual([]);
  });

  test('table: the same line under the visits, and a press there doesn’t open the site', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the table on a computer and a tablet');
    await openSites(page, 'table');
    const row = page.locator('tr', { hasText: 'Bluebird Bakery' });
    const line = row.getByRole('button', { name: 'Mostly fewer Google searches' });
    await expect(line).toBeVisible();
    await line.click();
    await expect(page.getByRole('dialog', { name: 'Visits fell 41% in October' })).toBeVisible();
    await expect(page).toHaveURL(/\/sites(\.html)?$/);
    await page.locator('h1').first().click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
