import { test, expect, type Page, type Route } from '@playwright/test';
import { installApp } from './helpers/app';

// Builder list items 124 and 181 (Nov 2026): the Search tab as a working page. A row of
// tools (old addresses, verification, sitemap, llms.txt, hide from search), this month's
// numbers, a to-do list ranked Critical, High and Medium with a done dot, the pages that
// moved most on Google, and up to ten searches to follow, month by month. The fixtures
// are GET /visibility's new parts (routes/search_tab.ts) and GET/PUT /visibility/follow;
// tests/presence/search_tools_test.mjs covers the server. A server without them keeps
// the old checklist (builder-backoffice.spec.ts, cms.spec.ts). Fake names only.

const PAGE_API = {
  '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/health': { data: { state: 'healthy', sentence: 'Your website is live and up to date.', detail: '', first_run: false, facts: { website: { state: 'live', label: 'Live', detail: '' }, draft: { state: 'clean', label: 'Up to date', detail: '' }, last_publish: { label: 'Sun, Oct 5', detail: 'published by you' }, domain: { label: 'maple.example', state: 'ok', detail: '' } } } },
  '/settings': { data: { blocks: [], section_meta: {}, pages: [], search_hidden: false, llms_txt: null } },
  '/media': { data: [] }, '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] },
  '/site': { data: { site: { id: '00000000-0000-4000-8000-000000000001', status: 'live', edition: 'presence', custom_domain: 'maple.example', template_slug: 'bistro', last_published_at: '2026-07-01T00:00:00Z', netlify_site_id: 'n1' }, identity: { business_name: 'Maple & Main Realty', seo_title: 'Maple & Main Realty, Burbank', seo_description: '' }, location: {}, voice: {}, offerings: [], faqs: [], testimonials: [], posts: [] } },
  '/foundations/domain': { data: { custom_domain: 'maple.example', health: 'ok' } },
  '/redirects': { data: [{ id: 'r1', from_path: '/old-listings/', to_path: '/listings/' }] },
  '/search/health': { data: { verification: { google: true, bing: false }, seo_fields: { title: true, description: false }, schema: { type: 'LocalBusiness', industry: 'generic' }, sitemap: true, robots: true, internal_links: 'correct_by_construction', hidden_pages: [], links: [] } },
};
const CONSOLE = { status: 'connected', health: 'ok', reason: '', last_sync_at: null, connect_href: '/connections.html', readiness: 'measuring', unavailable: false, has_data: true,
  clicks: 64, impressions: 2140, prior_clicks: 59, prior_impressions: 2400, period: '2026-10',
  monthly: [{ period: '2026-09', clicks: 59, impressions: 2400 }, { period: '2026-10', clicks: 64, impressions: 2140 }],
  top_terms: [{ term: 'burbank realtor', clicks: 18, impressions: 300 }], top_pages: [{ path: '/listings/', clicks: 28, impressions: 400 }] };
const TASKS = [
  { key: 'health:links.internal_broken', priority: 'critical', done: false, title: 'Links to pages that aren’t there', sub: 'On 2 pages or parts.', go: 'health' },
  { key: 'description', priority: 'high', done: false, title: 'Add a search description', sub: 'The line under the headline.', go: 'wording' },
  { key: 'listing', priority: 'medium', done: false, title: 'Connect your Google listing', sub: 'Your reviews, calls and directions, here.', go: 'connect:listing' },
  { key: 'llms', priority: 'medium', done: false, title: 'Write your llms.txt for AI tools', sub: 'A short file that tells ChatGPT and Claude what you do.', go: 'tool:llms' },
  { key: 'publish', priority: 'critical', done: true, title: 'Your site is published', sub: '', go: null },
  { key: 'console', priority: 'high', done: true, title: 'Connect Google Search Console', sub: '', go: null },
  { key: 'title', priority: 'high', done: true, title: 'Add a search headline', sub: '', go: null },
];
const VIS = (over: Record<string, unknown> = {}) => ({ data: {
  state: 'ready', address: { url: 'https://maple.example/', domain: 'maple.example', hosted: true }, score: null, ai: null, ai_check_url: 'https://tools.example.com/ai-visibility',
  console: CONSOLE, listing: { status: 'disconnected', health: 'unknown', reason: '', last_sync_at: null, connect_href: '/connections.html', property: null, data: null },
  tools: { ready: true, redirects: 1, verification: { google: true, bing: false }, sitemap: 'https://maple.example/sitemap.xml', llms: { set: false, chars: 0, url: 'https://maple.example/llms.txt', max: 4000 }, hidden: false },
  tasks: TASKS,
  movers: { period: '2026-10', prior_period: '2026-09', up: [{ path: '/listings/', clicks: 28, prior: 16, delta: 12 }, { path: '/sell/', clicks: 14, prior: 7, delta: 7 }], down: [{ path: '/about/', clicks: 3, prior: 8, delta: -5 }] },
  follow: { count: 2, max: 10 },
  ...over,
} });
const FOLLOW = { data: {
  terms: [
    { term: 'burbank realtor', added_at: '2026-06-01T00:00:00Z', months: [{ period: '2026-08', clicks: 8, impressions: 200, position: 9 }, { period: '2026-09', clicks: 12, impressions: 280, position: 6.2 }, { period: '2026-10', clicks: 18, impressions: 300, position: 4 }], now: { period: '2026-10', clicks: 18, impressions: 300, position: 4 }, prior: { period: '2026-09', clicks: 12, impressions: 280, position: 6.2 } },
    { term: 'homes for sale burbank', added_at: '2026-06-01T00:00:00Z', months: [{ period: '2026-09', clicks: 8, impressions: 400, position: 8 }, { period: '2026-10', clicks: 6, impressions: 380, position: 11 }], now: { period: '2026-10', clicks: 6, impressions: 380, position: 11 }, prior: { period: '2026-09', clicks: 8, impressions: 400, position: 8 } },
  ],
  suggestions: [{ term: 'realtor near me', clicks: 3, impressions: 42 }, { term: 'burbank homes', clicks: 2, impressions: 31 }],
  max: 10, month: '2026-10', prior: '2026-09', connected: true,
} };

async function openSearch(page: Page, o: { vis?: unknown; follow?: unknown; settings?: Record<string, unknown> } = {}) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const puts: Array<{ path: string; body: any }> = [];
  await installApp(page, { api: { ...PAGE_API, ...(o.settings ? { '/settings': { data: { ...PAGE_API['/settings'].data, ...o.settings } } } : {}), '/visibility': (o.vis ?? VIS()) as never, '/visibility/llms-draft': { data: { text: '# Maple & Main Realty\n\n> A Burbank real estate office.', max: 4000 } } } as never });
  let follow = (o.follow ?? FOLLOW) as any;
  await page.route(/\/functions\/v1\/presence\/visibility\/follow$/, async (route: Route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON(); puts.push({ path: '/visibility/follow', body });
      const terms = body.terms.map((t: string) => follow.data.terms.find((x: any) => x.term === t.toLowerCase()) || { term: t.toLowerCase(), added_at: '2026-11-11T00:00:00Z', months: [], now: null, prior: null });
      follow = { data: { ...follow.data, terms, added: terms.filter((t: any) => !follow.data.terms.some((x: any) => x.term === t.term)).map((t: any) => t.term) } };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(follow) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(follow) });
  });
  await page.route(/\/functions\/v1\/presence\/settings$/, async (route: Route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    const body = route.request().postDataJSON(); puts.push({ path: '/settings', body });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ...PAGE_API['/settings'].data, ...(o.settings || {}), ...body } }) });
  });
  await page.goto('/presence.html#search');
  await expect(page.locator('#view-search')).toBeVisible();
  await expect(page.locator('#svTools')).toBeVisible();
  return { errors, puts };
}
const noSideScroll = async (page: Page) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, 'the page must not scroll sideways').toBeLessThanOrEqual(1);
};
const closeTip = async (page: Page) => { const got = page.getByRole('button', { name: 'Got it' }); if (await got.count()) await got.first().click().catch(() => {}); };

test.describe('The Search tab (builder list items 124 and 181)', () => {
  test('a row of five tools, each saying where it stands', async ({ page }) => {
    const { errors } = await openSearch(page);
    const tools = page.locator('#svTools .sv-tool');
    await expect(tools.locator('b')).toHaveText(['Old addresses', 'Verification', 'Sitemap', 'llms.txt', 'Hide from search']);
    await expect(tools.locator('small')).toHaveText(['1 forwarded', 'Google code saved', 'Made for you', 'Not written yet', 'Off: Google can list it']);
    expect(errors).toEqual([]);
  });

  test('Old addresses opens the forwards in a sheet', async ({ page }) => {
    await openSearch(page); await closeTip(page);
    await page.locator('#svTools [data-tool="redirects"]').click();
    const dlg = page.locator('dialog.sv-dlg');
    await expect(dlg.getByRole('heading', { name: 'Old page addresses' })).toBeVisible();
    await expect(dlg).toContainText('/old-listings/ → /listings/');
    await dlg.getByRole('button', { name: 'Close' }).click();
    await expect(dlg).toHaveCount(0);
  });

  test('Verification moves the codes into its sheet, and puts them back', async ({ page }) => {
    await openSearch(page); await closeTip(page);
    await page.locator('#svTools [data-tool="verification"]').click();
    const dlg = page.locator('dialog.sv-dlg');
    await expect(dlg.locator('#f-gsv')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    await expect(page.locator('#view-search details:has(#f-gsv)')).toHaveCount(1);
  });

  test('llms.txt: a first draft from the details, a count, and Save writes it to the settings', async ({ page }) => {
    const { puts } = await openSearch(page); await closeTip(page);
    await page.locator('#svTools [data-tool="llms"]').click();
    const ta = page.locator('#svLlms');
    await expect(ta).toHaveValue('# Maple & Main Realty\n\n> A Burbank real estate office.');
    await expect(page.locator('dialog.sv-dlg .hint').first()).toContainText('Live at maple.example/llms.txt after you publish · 54 of 4,000 characters');
    await ta.fill('# Maple & Main Realty\n\n> Homes in Burbank.');
    await page.locator('dialog.sv-dlg').getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('dialog.sv-dlg')).toHaveCount(0);
    expect(puts.find((p) => p.path === '/settings')?.body).toEqual({ llms_txt: '# Maple & Main Realty\n\n> Homes in Burbank.' });
  });

  test('Hide from search: one switch, saved to the settings, said to take effect at publish', async ({ page }) => {
    const { puts } = await openSearch(page); await closeTip(page);
    await page.locator('#svTools [data-tool="hide"]').click();
    const sw = page.locator('#svHideSwitch');
    await expect(sw).not.toBeChecked();
    await sw.check();
    await expect.poll(() => puts.find((p) => p.path === '/settings')?.body).toEqual({ search_hidden: true });
    await expect(page.locator('dialog.sv-dlg')).toContainText('It takes effect when you publish.');
  });

  test('before the database step, llms.txt and Hide from search wait', async ({ page }) => {
    await openSearch(page, { vis: VIS({ tools: { ready: false, redirects: 0, verification: { google: false, bing: false }, sitemap: null, llms: { set: false, chars: 0, url: null, max: 4000 }, hidden: false } }) });
    await expect(page.locator('#svTools [data-tool="llms"]')).toBeDisabled();
    await expect(page.locator('#svTools [data-tool="hide"] small')).toHaveText('Coming soon');
    await expect(page.locator('#svTools [data-tool="sitemap"] small')).toHaveText('After you publish');
  });

  test('this month’s numbers, against the month before', async ({ page }) => {
    await openSearch(page);
    const stats = page.locator('#svNums .sv-stat');
    await expect(stats.locator('.l')).toHaveText(['Google clicks · Oct', 'Times seen on Google', 'Searches you follow']);
    await expect(stats.nth(0).locator('.sv-chg.up')).toContainText('8%');
    await expect(stats.nth(1).locator('.sv-chg.down')).toContainText('11%');
    await expect(stats.nth(2)).toContainText('best: #4 for “burbank realtor”');
  });

  test('to do: ranked Critical, High, Medium, a done dot, filters, and each task a door', async ({ page }) => {
    await openSearch(page); await closeTip(page);
    const card = page.locator('#seoTasks');
    await expect(page.locator('#svChecklistH')).toHaveText('To do');
    await expect(card.locator('.sv-todo-n')).toHaveText('4 open · 3 done');
    await expect(card.locator('.sv-todo li .sv-pri')).toHaveText(['Critical', 'High', 'Medium', 'Medium']);
    await expect(card.locator('.sv-todo li').first().locator('.sv-dot')).toHaveClass(/crit/);
    await card.getByRole('button', { name: 'Medium · 2' }).click();
    await expect(card.locator('.sv-todo li')).toHaveCount(2);
    await card.getByRole('button', { name: 'All · 4' }).click();
    await card.getByRole('button', { name: 'Show done' }).click();
    await expect(card.locator('.sv-todo li.done')).toHaveCount(3);
    await expect(card.locator('.sv-todo li.done .sv-dot.done')).toHaveCount(3);
    await card.getByRole('button', { name: 'Write: Add a search description' }).click();
    await expect(page.locator('#f-seo_description')).toBeFocused();
    await card.getByRole('button', { name: 'Write: Write your llms.txt for AI tools' }).click();
    await expect(page.locator('dialog.sv-dlg').getByRole('heading', { name: 'llms.txt' })).toBeVisible();
  });

  test('to do: typing the headline ticks its task without a reload', async ({ page }) => {
    await openSearch(page); await closeTip(page);
    await page.locator('#f-seo_description').fill('Homes for sale and sold in Burbank, from a local office that answers the phone.');
    await page.locator('#f-seo_description').dispatchEvent('input');
    await page.evaluate(() => (window as any).renderSeoTasks());
    await expect(page.locator('#seoTasks .sv-todo-n')).toHaveText('3 open · 4 done');
    await expect(page.locator('#svFixCard')).toBeHidden();   // the Site Review's findings are in the list now
  });

  test('the pages that moved most, with a red fall', async ({ page }) => {
    await openSearch(page);
    const card = page.locator('#svMoversCard');
    await expect(card).toContainText('Clicks from Google, October against September');
    await expect(card.locator('.sv-mv li .p')).toHaveText(['/listings/', '/sell/', '/about/']);
    await expect(card.locator('.sv-mv li').nth(2).locator('.sv-chg.down')).toContainText('5');
    await expect(card.locator('.sv-mv li').nth(2).locator('rect.down')).toHaveCount(1);
  });

  test('searches you follow: place and clicks with their change, a line a month, and the chart follows the pick', async ({ page }) => {
    await openSearch(page); await closeTip(page);
    const card = page.locator('#svFollowCard');
    await expect(card.locator('#svFollowN')).toHaveText('2 of 10');
    const rows = card.locator('tbody tr');
    await expect(rows.nth(0)).toContainText('#4');
    await expect(rows.nth(0).locator('.sv-chg.up').first()).toContainText('2');        // 6 → 4 is two places up
    await expect(rows.nth(1).locator('.sv-chg.down').first()).toContainText('3');
    await expect(card.locator('svg.sv-fchart')).toHaveAttribute('aria-label', /burbank realtor.*Oct #4, 18 clicks$/);
    await card.getByRole('button', { name: 'homes for sale burbank', exact: true }).click();
    await expect(card.locator('svg.sv-fchart')).toHaveAttribute('aria-label', /homes for sale burbank/);
    await expect(card.locator('tbody tr.on')).toContainText('homes for sale burbank');
  });

  test('follow: from a suggestion, from the sheet, and stop following', async ({ page }) => {
    const { puts } = await openSearch(page); await closeTip(page);
    const card = page.locator('#svFollowCard');
    await card.getByRole('button', { name: '+ realtor near me' }).click();
    await expect.poll(() => puts.filter((p) => p.path === '/visibility/follow').length).toBe(1);
    expect(puts[0].body).toEqual({ terms: ['burbank realtor', 'homes for sale burbank', 'realtor near me'] });
    await expect(card.locator('#svFollowN')).toHaveText('3 of 10');
    await card.getByRole('button', { name: '+ Follow a search' }).click();
    await page.locator('dialog.sv-dlg input[type=text]').fill('Sell My House Burbank');
    await page.keyboard.press('Enter');
    await expect(card.locator('#svFollowN')).toHaveText('4 of 10');
    await card.getByRole('button', { name: 'Stop following homes for sale burbank' }).click();
    await expect(card.locator('#svFollowN')).toHaveText('3 of 10');
    expect(puts[puts.length - 1].body.terms).toEqual(['burbank realtor', 'realtor near me', 'sell my house burbank']);   // the server keeps Google’s spelling
  });

  test('ten followed: the button rests', async ({ page }) => {
    const ten = { data: { ...FOLLOW.data, terms: Array.from({ length: 10 }, (_, i) => ({ term: `search ${i}`, added_at: '2026-06-01T00:00:00Z', months: [], now: null, prior: null })) } };
    await openSearch(page, { follow: ten });
    await expect(page.locator('#btnSvFollow')).toBeDisabled();
    await expect(page.locator('#svFollowCard .sv-sugs')).toHaveCount(0);
  });

  test('Search Console not connected: no followed searches card, no numbers that can’t be known', async ({ page }) => {
    await openSearch(page, { vis: VIS({ console: { ...CONSOLE, status: 'disconnected', has_data: false }, follow: { count: 0, max: 10 } }) });
    await expect(page.locator('#svFollowCard')).toBeHidden();
    await expect(page.locator('#svNums')).toBeHidden();
  });

  test('phone width: the tools slide within their row, the page doesn’t; the follow table drops its sparkline', async ({ page }) => {
    await openSearch(page);
    const isMobile = (page.viewportSize()?.width || 1280) < 761;
    if (isMobile) {
      const overflow = await page.locator('#svTools').evaluate((el) => getComputedStyle(el).overflowX);
      expect(overflow).toBe('auto');
      await expect(page.locator('#svFollowCard th.mo')).toBeHidden();
    }
    await expect(page.locator('#svFollowCard')).toBeVisible();
    await noSideScroll(page);
  });
});
