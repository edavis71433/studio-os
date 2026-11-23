import { test, expect, type Page } from '@playwright/test';
import { installApp, CLIENT_NAV, ALL_FEATURES, touchScreen } from './helpers/app';
import { pinClock } from './helpers/clock';

// Builder items 370 and 384 (Nov 2026, review files 08 and 11):
//   370  Inside a client, Analytics and Connections keep the Website menu in the sidebar with
//        their own item lit (shell-kit.js draws the same list the website page does), and Styles
//        is a tab of its own, the menu kept, instead of jumping into Edit mode.
//   384  The Search tab lists the pages Google showed a lot that few people picked
//        (routes/search_tab.ts seen_little; seen_holiday_384_385_test.mjs covers the server),
//        each with a plain hint, and Change its title where the page is one of the site's own.
// The page fixtures are the ones near-miss-219.spec.ts uses; the names are made up.

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
  clicks: 64, impressions: 2140, prior_clicks: 70, prior_impressions: 2000, period: '2026-10', monthly: [],
  top_terms: [{ term: 'maple and main realty', clicks: 64, impressions: 300 }], top_pages: [{ path: '/listings/', clicks: 28, impressions: 400 }] };
const SEEN = { period: '2026-10', list: [
  { path: '/', seen: 900, clicks: 3, hint: 'Google showed it 900 times and people picked it 3 times. Make its title on Google say what you do and where, and its description give one reason to pick you.' },
  { path: '/updates/spring-market/', seen: 240, clicks: 0, hint: 'Google showed it 240 times and no one picked it. Make its title on Google say what this page offers, and its description say why it’s the one to pick.' },
] };
const VIS = (over: Record<string, unknown> = {}) => ({ data: {
  state: 'ready', address: { url: 'https://maple.example/', domain: 'maple.example', hosted: true }, score: null, ai: null, ai_check_url: 'https://tools.example.com/ai-visibility',
  console: CONSOLE, listing: { status: 'disconnected', health: 'unknown', reason: '', last_sync_at: null, connect_href: '/connections.html', property: null, data: null },
  tools: { ready: true, redirects: 0, verification: { google: true, bing: false }, sitemap: 'https://maple.example/sitemap.xml', llms: { set: false, chars: 0, url: 'https://maple.example/llms.txt', max: 4000 }, hidden: false },
  tasks: [], movers: null, follow: { count: 0, max: 10 }, near_miss: null, drop: null, seen_little: SEEN, ...over,
} });

async function openWebsite(page: Page, hash: string, extra: Record<string, unknown> = {}, before?: (p: Page) => Promise<unknown>) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => { try { localStorage.setItem('dds-hints', JSON.stringify({ 'search-plain': 1 })); } catch { /* storage may be denied */ } });
  await installApp(page, { api: { ...PAGE_API, '/visibility': VIS() as never, '/visibility/follow': { data: { terms: [], suggestions: [], max: 10, month: '2026-10', prior: '2026-09', connected: true } }, ...extra } as never });
  if (before) await before(page);   // registered after the harness, so it wins
  await pinClock(page);   // the fixtures hold dates
  await page.goto('/presence.html' + hash);
  return errors;
}

test.describe('Search tab: seen a lot, clicked little (builder item 384)', () => {
  test('the pages Google showed often and few picked, each with its hint; Change its title where the page is the site’s own', async ({ page }) => {
    const errors = await openWebsite(page, '#search');
    const box = page.locator('#svConsole .sv-seen');
    await expect(box.getByRole('heading', { name: 'Seen a lot, clicked little' })).toBeVisible();
    await expect(box.locator('.hint')).toContainText('at least 100 times in October');
    await expect(box.locator('li')).toHaveCount(2);
    await expect(box.locator('li').nth(0)).toContainText('Seen 900 · picked 3');
    await expect(box.locator('li').nth(0)).toContainText('say what you do and where');
    await expect(box.locator('li').nth(1).getByRole('button')).toHaveCount(0);   // a blog post: the hint alone
    await box.locator('li').nth(0).getByRole('button', { name: 'Change its title' }).click();
    await expect(page.locator('#f-seo_title')).toBeFocused();                    // the home page's title on Google, on this tab
    expect(errors).toEqual([]);
  });
  test('nothing seen a lot and clicked little, or not read: no list', async ({ page }) => {
    await openWebsite(page, '#search', { '/visibility': VIS({ seen_little: null }) });
    await expect(page.locator('#svConsole')).toContainText('clicks to your site');
    await expect(page.locator('#svConsole .sv-seen')).toHaveCount(0);
  });
});

test.describe('Styles is a tab, not Edit mode (builder item 370)', () => {
  test('Styles shows the look as it is now, the menu kept and lit; Change the look opens the editor', async ({ page }) => {
    const errors = await openWebsite(page, '#styles', { '/dev/customization': { data: { theme_tokens: { accent: '#1f6f5c', ink: '#222222', bg: '#fafafa', font_display: 'Georgia, serif', font_body: 'Helvetica, sans-serif' } } } });
    await expect(page.locator('#view-styles')).toBeVisible();
    await expect(page.locator('#view-design')).not.toHaveClass(/\bon\b/);
    await expect(page.locator('html')).not.toHaveClass(/dc-edit/);
    await expect(page.locator('#nav .navitem[data-view="styles"]')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#stLook')).toContainText('#1F6F5C');
    await expect(page.locator('#stLook')).toContainText('Georgia');
    await page.locator('#btnStylesEdit').click();
    await expect(page.locator('#view-design')).toHaveClass(/\bon\b/);
    expect(errors).toEqual([]);
  });
  test('a role that can’t change the look sees the template’s, is told who can, and gets no editor button', async ({ page }) => {
    await openWebsite(page, '#styles', {}, (p) => p.route('**/functions/v1/presence/dev/customization', (r) => r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'forbidden', message: 'No.' }) })));
    await expect(page.locator('#stLook')).toContainText('the owner or the studio can');
    await expect(page.locator('#stLook')).toContainText('Accent');
    await expect(page.locator('#btnStylesEdit')).toBeHidden();
  });
});

// Builder item 431 (the Nov 23 live check of PR 507): Styles names a font the browser picks in
// words, as the editor does (item 327), and the holiday line's "#hours-thu" puts focus on that
// day's row in the Hours card: its Closed tick when the day is closed (its times are switched off).
const SITE_DATA = (PAGE_API['/site'] as { data: Record<string, unknown> }).data;
const open9 = [{ open: '09:00', close: '17:00' }];
const WEEK = [
  { day: 'mon', closed: true, intervals: [] }, { day: 'tue', closed: false, intervals: open9 }, { day: 'wed', closed: false, intervals: open9 },
  { day: 'thu', closed: true, intervals: [] }, { day: 'fri', closed: false, intervals: open9 }, { day: 'sat', closed: true, intervals: [] }, { day: 'sun', closed: true, intervals: [] },
];
test.describe('Styles words and the holiday line’s Hours link (builder item 431)', () => {
  test('a font the browser picks is named in words, never “system-ui”', async ({ page }) => {
    const errors = await openWebsite(page, '#styles', { '/dev/customization': { data: { theme_tokens: { accent: '#1f6f5c', ink: '#222222', bg: '#fafafa', font_display: 'system-ui, -apple-system, sans-serif', font_body: "'Georgia', serif" } } } });
    await expect(page.locator('#stLook .st-font').first()).toContainText('Your device’s own font');
    await expect(page.locator('#stLook .st-font').nth(1)).toContainText('Georgia');
    await expect(page.locator('#stLook')).not.toContainText('system-ui');
    expect(errors).toEqual([]);
  });
  const withWeek = { '/site': { data: { ...SITE_DATA, location: { timezone: 'America/Los_Angeles', hours: WEEK } } } };
  test('#hours-thu with Thursday closed: focus on Thursday’s Closed tick, the card in view', async ({ page }) => {
    const errors = await openWebsite(page, '#hours-thu', withWeek);
    await expect(page.locator('#view-business')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Thursday closed' })).toBeFocused();
    await expect(page.locator('#bizHoursH')).toBeInViewport();
    expect(errors).toEqual([]);
  });
  test('an open day gets its opening time; plain #hours is the first row, Monday, closed here', async ({ page }) => {
    await openWebsite(page, '#hours-fri', withWeek);
    await expect(page.getByLabel('Friday opens')).toBeFocused();
    await page.evaluate(() => { location.hash = 'today'; });
    await page.evaluate(() => { location.hash = 'hours'; });
    await expect(page.getByRole('checkbox', { name: 'Monday closed' })).toBeFocused();
  });
});

const CLIENT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const scoped = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'agency', edition_name: 'Agency', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'view_all'], landing: '/agency.html', attention_count: 0, nav: CLIENT_NAV, plan_key: 'agency', upsell: null,
} };
test.describe('Inside a client, Analytics and Connections keep the Website menu (builder item 370)', () => {
  test.beforeEach(() => { test.skip(touchScreen(), 'the sidebar is the desktop’s; a phone has the Sections sheet'); });
  test('Analytics: the menu under Website, Analytics lit, every item a link back into the website', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': scoped } });
    await page.goto(`/analytics.html?view=website&client=${CLIENT}`);
    const menu = page.locator('#dds-shell #siteMenu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('.navitem.on')).toHaveText('Analytics');
    await expect(menu.locator('.navitem.on')).toHaveAttribute('aria-current', 'page');
    await expect(menu.getByRole('link', { name: 'Pages' })).toHaveAttribute('href', `/presence.html?client=${CLIENT}#pages`);
    await expect(menu.getByRole('link', { name: 'Styles' })).toHaveAttribute('href', `/presence.html?client=${CLIENT}#styles`);
    await expect(menu.getByRole('link', { name: 'Connections', includeHidden: true })).toHaveAttribute('href', `/connections.html?client=${CLIENT}`);
  });
  test('Connections: Site settings opens on its own, Connections lit', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': scoped } });
    await page.goto(`/connections.html?client=${CLIENT}`);
    const menu = page.locator('#dds-shell #siteMenu');
    await expect(menu.locator('.navitem.on')).toHaveText('Connections');
    await expect(menu.locator('.nav-fold.open > .grp')).toHaveText('Site settings');
    await expect(menu.locator('.nav-fold.open > .grp')).toHaveAttribute('aria-expanded', 'true');
  });
  test('at studio level there is no client, so no website menu', async ({ page }) => {
    await installApp(page);
    await page.goto('/connections.html');
    await expect(page.locator('#dds-shell .dds-nav')).toBeVisible();
    await expect(page.locator('#siteMenu')).toHaveCount(0);
  });
});
