import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp, ALL_FEATURES } from './helpers/app';

// ── The builder's back office: the Search tab, the analytics page, and the two
// Google connections. Every project runs these, so each is proven at desktop,
// tablet and phone. Hermetic like the rest of the suite: the API is fixtures, so
// nothing here reaches Google. tests/presence/gbp_test.mjs covers the server half.

// What presence.html reads while it starts, beyond the helper's defaults.
const PAGE_API = {
  '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/health': { data: { state: 'healthy', sentence: 'Your website is live and up to date.', detail: '', first_run: false, facts: { website: { state: 'live', label: 'Live', detail: '' }, draft: { state: 'clean', label: 'Up to date', detail: '' }, last_publish: { label: 'Sun, Oct 5', detail: 'published by you' }, domain: { label: 'marlows.example', state: 'ok', detail: '' } } } },
  '/settings': { data: { blocks: [], section_meta: {}, pages: [] } },
  '/media': { data: [] }, '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] },
};

const SITE = (over: Record<string, unknown> = {}) => ({ data: {
  site: { id: '00000000-0000-4000-8000-000000000001', client_id: '00000000-0000-4000-8000-000000000002', status: 'live', edition: 'presence', custom_domain: 'marlows.example', template_slug: 'bistro', last_published_at: '2026-07-01T00:00:00Z', netlify_site_id: 'n1', ...over },
  identity: { business_name: 'Marlow’s Kitchen', seo_title: 'Marlow’s Kitchen — Burbank', seo_description: 'Seasonal plates in Burbank, CA. Book a table or see tonight’s menu online.' },
  location: {}, voice: {}, offerings: [], faqs: [], testimonials: [], posts: [],
} });

const SCORE = {
  overall: 82, label: 'Strong', summary: 'Your site is in good shape. A couple of things would help Google read it.',
  pillars: [{ name: 'Search', score: 90, note: '' }, { name: 'Speed', score: null, note: 'Not measured' }, { name: 'Trust', score: 76, note: '' }, { name: 'Local', score: 64, note: '' }],
  notes: [], issue_count: 8, report_url: 'https://tools.example.com/report/r1', checked_at: '2026-11-01T10:00:00Z',
  issues: [
    { title: 'Your photos have no descriptions', what: '12 of 20 photos are missing alt text.', why: 'Google can’t see pictures.', fix: 'Describe each photo in Files.', priority: 'Fix now', pillar: 'Search' },
    { title: 'Your phone number isn’t tappable', what: 'It’s plain text.', why: 'Most visitors are on phones.', fix: 'Add it in Business.', priority: 'Later', pillar: 'Local' },
  ],
};
const CONSOLE_OFF = { status: 'disconnected', health: 'unknown', reason: '', last_sync_at: null, connect_href: '/connections.html', readiness: 'connect', unavailable: false, has_data: false };
const LISTING_OFF = { status: 'disconnected', health: 'unknown', reason: '', last_sync_at: null, connect_href: '/connections.html', property: null, data: null };
const VISIBILITY = (over: Record<string, unknown> = {}) => ({ data: {
  state: 'ready', address: { url: 'https://marlows.example/', domain: 'marlows.example', hosted: true },
  score: null, ai: null, ai_check_url: 'https://tools.example.com/ai-visibility', console: CONSOLE_OFF, listing: LISTING_OFF, ...over,
} });
const CONSOLE_ON = { ...CONSOLE_OFF, status: 'connected', health: 'ok', readiness: 'measuring', has_data: true,
  clicks: 40, impressions: 400, prior_clicks: 30, prior_impressions: 300, period: '2026-10',
  monthly: [{ period: '2026-09', clicks: 30, impressions: 300 }, { period: '2026-10', clicks: 40, impressions: 400 }],
  top_terms: [{ term: 'wine bar burbank', clicks: 9, impressions: 90 }], top_pages: [{ path: '/menu/', clicks: 5, impressions: 50 }] };
const LISTING_ON = { ...LISTING_OFF, status: 'connected', health: 'ok', property: { id: 'locations/1', name: 'Marlow’s Kitchen', auto_selected: true },
  data: { label: 'your Google listing', rating: 4.6, review_count: 128, new_reviews: 2, unreplied_reviews: 3, calls: 5, direction_requests: 7, website_clicks: 12, listing_name: 'Marlow’s Kitchen', listing_address: '12 Main St, Burbank, CA', listing_maps_uri: 'https://maps.google.com/?cid=1', hours_set: false, as_of: '2026-11-04T00:00:00Z' } };

async function openSearch(page: Page, visibility: unknown, extra: Record<string, unknown> = {}) {
  await installApp(page, { api: { ...PAGE_API, '/site': SITE(), '/visibility': visibility as never, ...extra } as never });
  await page.goto('/presence.html#search');
  await expect(page.locator('#view-search')).toBeVisible();
  await expect(page.locator('.sv-ring')).toBeVisible();   // the board has drawn
}
const noSideScroll = async (page: Page) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, 'the page must not scroll sideways').toBeLessThanOrEqual(1);
};

// A page error is a failure wherever it lands: the app reports them as a red toast,
// which no assertion on the cards would notice.
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  (page as unknown as { __errors: string[] }).__errors = errors;
});
test.afterEach(async ({ page }) => {
  expect((page as unknown as { __errors: string[] }).__errors).toEqual([]);
  await expect(page.locator('.dds-toast.err')).toHaveCount(0);
});

test.describe('Tabs', () => {
  test('above phone size the menu sits in the sidebar, and nothing runs past it', async ({ page }) => {
    await openSearch(page, VISIBILITY());
    test.skip(page.viewportSize()!.width <= 760, 'a phone has the Sections sheet');
    const rights = await page.locator('#nav .navitem:visible').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right));
    expect(rights.length).toBeGreaterThanOrEqual(5);
    const side = (await page.locator('#dds-shell').boundingBox())!;
    for (const right of rights) expect(right).toBeLessThanOrEqual(side.x + side.width);
    await expect(page.locator('#nav .navitem[data-view="search"]')).toBeVisible();
  });

  test('on a phone the sheet opens Analytics too', async ({ page }) => {
    await installApp(page, { api: { ...PAGE_API, '/site': SITE(), '/visibility': VISIBILITY() } as never });
    await page.goto('/presence.html#business');
    test.skip(page.viewportSize()!.width > 760, 'the sheet is the phone’s');
    await page.locator('#dock button[data-tab="sections"]').click();
    await page.locator('#sectionsNav .navitem[data-link="analytics"]').click();
    await page.waitForURL(/analytics\.html\?view=website/);
  });
});

test.describe('Search tab', () => {
  test('it is a tab, on the strip and the phone sheet alike, and the tab shows the score', async ({ page }) => {
    await openSearch(page, VISIBILITY({ score: SCORE }));
    await expect(page.locator('#nav .navitem[data-view="search"]')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#sectionsNav .navitem[data-view="search"]')).toHaveCount(1);
    await expect(page.locator('.sv-ring')).toHaveAttribute('aria-label', 'Search score: 82 out of 100');
    await expect(page.locator('#svScore')).toContainText('Strong');
    await expect(page.locator('#svScore')).toContainText('A couple of things would help Google');
    await expect(page.locator('#svScore')).toContainText('Checked Nov 1, 2026 · marlows.example');
    await expect(page.locator('#svScore').getByRole('link', { name: 'See the full report' })).toHaveAttribute('href', 'https://tools.example.com/report/r1');
    await noSideScroll(page);
  });

  test('a pillar that wasn’t measured says so, and never shows as a zero', async ({ page }) => {
    await openSearch(page, VISIBILITY({ score: SCORE }));
    await expect(page.locator('.sv-pillars').first()).toContainText('Not measured');
    await expect(page.locator('.sv-pillars').first()).toContainText('90');
  });

  test('what to fix: the findings are the owner’s to read, each opening to the fix', async ({ page }) => {
    await openSearch(page, VISIBILITY({ score: SCORE }));
    const card = page.locator('#svFixCard');
    await expect(card).toBeVisible();
    await expect(card.locator('.sv-pri').first()).toHaveText('Fix now');
    await card.getByText('Your photos have no descriptions').click();
    await expect(card).toContainText('Describe each photo in Files.');
    await expect(card.getByRole('link', { name: 'See all 8 in the full report' })).toBeVisible();
  });

  test('no check yet: the button runs one, says how long, and the score appears', async ({ page }) => {
    let calls = 0;
    await openSearch(page, VISIBILITY());
    await page.route('**/functions/v1/presence/visibility/check', async (route) => {
      calls++;
      await new Promise((r) => setTimeout(r, 1500));   // long enough to read the status line under a busy test run
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { score: SCORE } }) });
    });
    await expect(page.locator('.sv-ring')).toHaveAttribute('aria-label', 'No score yet');
    await expect(page.locator('#svFixCard')).toBeHidden();
    await page.locator('#btnSvCheck').click();
    await expect(page.locator('#svCheckStatus')).toContainText('about a minute');
    await expect(page.locator('.sv-ring')).toHaveAttribute('aria-label', 'Search score: 82 out of 100');
    await expect(page.locator('#svFixCard')).toBeVisible();
    expect(calls).toBe(1);
  });

  test('a check that’s refused keeps the score and says why', async ({ page }) => {
    await openSearch(page, VISIBILITY({ score: SCORE }));
    await page.route('**/functions/v1/presence/visibility/check', (route) => route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'too_many', message: 'That’s plenty of checks for today, and your latest result is still here. Try again tomorrow.' }) }));
    await page.locator('#btnSvCheck').click();
    await expect(page.locator('#svCheckStatus')).toContainText('plenty of checks');
    await expect(page.locator('.sv-ring')).toHaveAttribute('aria-label', 'Search score: 82 out of 100');
    await expect(page.locator('#btnSvCheck')).toBeEnabled();
  });

  test('a draft gets no score and no zero: it’s told to publish, with the other way out', async ({ page }) => {
    await openSearch(page, VISIBILITY({ state: 'draft', address: null, console: { ...CONSOLE_OFF, readiness: 'draft' } }));
    await expect(page.locator('.sv-ring .n')).toHaveText('—');
    await expect(page.locator('#svScore')).toContainText('Publish first');
    await expect(page.locator('#svScore').getByRole('link', { name: 'Publish your site' })).toHaveAttribute('href', '#publish');
    await expect(page.locator('#svScore').getByRole('link', { name: 'Already live somewhere else?' })).toHaveAttribute('href', '#monitor');
    await expect(page.locator('#btnSvCheck')).toHaveCount(0);
    await expect(page.locator('#svConsole')).toContainText('Publish first');
    await expect(page.locator('#svConsole button')).toHaveCount(0);
  });

  test('a watch plan is asked for an address, never to publish, and isn’t shown wording it can’t change', async ({ page }) => {
    await installApp(page, { api: { ...PAGE_API,
      '/site': SITE({ edition: 'monitor', custom_domain: null, last_published_at: null }),
      '/visibility': VISIBILITY({ state: 'no_domain', address: null, console: { ...CONSOLE_OFF, readiness: 'no_domain' } }),
      '/portal/context': { data: { site_role: 'business_owner', edition: 'monitor', edition_key: 'monitor', edition_features: ['connected', 'reports', 'business_moments'], capabilities: [], nav: [], landing: '/today.html', attention_count: 0, plan_key: 'presence_monitor' } },
    } as never });
    await page.goto('/presence.html#search');
    await expect(page.locator('#svScore')).toContainText('Where is your website?');
    await expect(page.locator('#svScore').getByRole('link', { name: 'Add your website’s address' })).toHaveAttribute('href', '#monitor');
    await expect(page.locator('#svScore')).not.toContainText('Publish');
    await expect(page.locator('#svWords')).toBeHidden();
    await expect(page.locator('#seoTasks')).toContainText('Tell us your website’s address');
    await expect(page.locator('#seoTasks')).not.toContainText('Publish');
  });

  test('the function not deployed yet: a calm “still arriving”, and the checklist and wording still work', async ({ page }) => {
    await installApp(page, { api: { ...PAGE_API, '/site': SITE() } as never });
    await page.route('**/functions/v1/presence/visibility', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not_found' }) }));
    await page.goto('/presence.html#search');
    await expect(page.locator('#svScore')).toContainText('Still arriving');
    await expect(page.locator('#seoTasks')).toContainText('Connect Google Search Console');
    await expect(page.locator('#f-seo_title')).toBeVisible();
  });

  test('Search Console, connected: the month, the change on the month before, searches and pages', async ({ page }) => {
    await openSearch(page, VISIBILITY({ console: CONSOLE_ON }));
    const c = page.locator('#svConsole');
    const nameCol = await c.locator('.sv-table td:first-child').first().evaluate((td) => td.getBoundingClientRect().width);
    expect(nameCol, 'room for the search itself').toBeGreaterThanOrEqual(120);
    await expect(c).toContainText('40');
    await expect(c).toContainText('clicks to your site');
    await expect(c).toContainText('In October');
    await expect(c).toContainText('up 33%');
    await expect(c.getByRole('table', { name: 'What people searched' })).toContainText('wine bar burbank');
    await expect(c.getByRole('table', { name: 'Your pages on Google' })).toContainText('/menu/');
    await expect(c.locator('button')).toHaveCount(0);
    await noSideScroll(page);
  });

  test('Search Console, connected with nothing yet: the honest lag, nothing to do', async ({ page }) => {
    await openSearch(page, VISIBILITY({ console: { ...CONSOLE_OFF, status: 'connected', readiness: 'waiting' } }));
    await expect(page.locator('#svConsole')).toContainText('whole past months');
    await expect(page.locator('#svConsole button')).toHaveCount(0);
  });

  test('Search Console, wrong account: the reason, in plain words, and no fake numbers', async ({ page }) => {
    await openSearch(page, VISIBILITY({ console: { ...CONSOLE_OFF, status: 'connected', health: 'attention', readiness: 'waiting', reason: 'That Google account can’t see marlows.example in Search Console. It can see other.com. Connect the account that owns it.' } }));
    await expect(page.locator('#svConsole')).toContainText('It can see other.com');
  });

  test('connecting from this tab: starts Google’s screen and comes back here', async ({ page }) => {
    await openSearch(page, VISIBILITY());
    await page.route('**/functions/v1/presence/connections/google_search_console/connect', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { mode: 'oauth', authorize_url: '/connections-callback.html?code=abc&state=xyz', state: 'xyz' } }) }));
    await page.route('**/functions/v1/presence/connections/google_search_console/callback', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { connected: true } }) }));
    await page.locator('#svConsole').getByRole('button', { name: 'Connect Search Console' }).click();
    await page.waitForURL(/connections-callback\.html/);
    await expect(page.getByRole('link', { name: 'Back to Search' })).toHaveAttribute('href', '/presence.html#search');
  });

  test('connecting for a client keeps the client, both ways', async ({ page }) => {
    await installApp(page, { api: { ...PAGE_API, '/site': SITE(), '/visibility': VISIBILITY() } as never });
    let scope: string | undefined;
    await page.route('**/functions/v1/presence/connections/google_business_profile/connect', (route) => { scope = route.request().headers()['x-dds-scope-site']; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { mode: 'oauth', authorize_url: '/connections-callback.html?code=abc&state=xyz' } }) }); });
    await page.route('**/functions/v1/presence/connections/google_business_profile/callback', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { connected: true } }) }));
    await page.goto('/presence.html?client=c-123#search');
    await page.locator('#svListing').getByRole('button', { name: 'Connect your listing' }).click();
    await page.waitForURL(/connections-callback\.html/);
    expect(scope).toBe('c-123');
    await expect(page.getByRole('link', { name: 'Back to Search' })).toHaveAttribute('href', '/presence.html?client=c-123#search');
  });

  test('not switched on yet: the setup message stays on screen, button recovers', async ({ page }) => {
    await openSearch(page, VISIBILITY());
    await page.route('**/functions/v1/presence/connections/google_search_console/connect', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'not_available', message: 'Google Search Console isn’t switched on yet — it needs CONNECTED_GOOGLE_SEARCH_CONSOLE_CLIENT_ID.' }) }));
    const b = page.locator('#svConsole').getByRole('button', { name: 'Connect Search Console' });
    await b.click();
    await expect(page.locator('#svConsole [role="alert"]')).toContainText('CONNECTED_GOOGLE_SEARCH_CONSOLE_CLIENT_ID');
    await expect(b).toBeEnabled();
    await noSideScroll(page);
  });

  test('the listing, connected: rating, numbers, gaps worth acting on, and Maps', async ({ page }) => {
    await openSearch(page, VISIBILITY({ listing: LISTING_ON }));
    const l = page.locator('#svListing');
    await expect(l).toContainText('Marlow’s Kitchen · 12 Main St, Burbank, CA');
    await expect(l).toContainText('4.6★');
    await expect(l).toContainText('128 reviews');
    await expect(l).toContainText('direction requests');
    await expect(l).toContainText('last 30 days');
    await expect(l).toContainText('3 of your latest reviews have no reply yet');
    await expect(l).toContainText('no opening hours');
    await expect(l.getByRole('link', { name: 'Open on Google Maps' })).toHaveAttribute('href', 'https://maps.google.com/?cid=1');
    await expect(l.locator('button')).toHaveCount(0);
  });

  test('the listing, not connected: says plainly what Google’s screen will say', async ({ page }) => {
    await openSearch(page, VISIBILITY());
    await expect(page.locator('#svListing')).toContainText('manage your business listings');
    await expect(page.locator('#svListing')).toContainText('only reads');
  });

  test('the listing, several on the account: a door to choosing', async ({ page }) => {
    await openSearch(page, VISIBILITY({ listing: { ...LISTING_OFF, status: 'connected', health: 'attention', reason: 'Choose which Google listing is this business. That account manages 3.' } }));
    await expect(page.locator('#svListing')).toContainText('That account manages 3');
    await expect(page.locator('#svListing').getByRole('link', { name: 'Choose your listing' })).toHaveAttribute('href', '/connections.html');
  });

  test('the listing, waiting on Google’s approval: not an error, not a retry', async ({ page }) => {
    await openSearch(page, VISIBILITY({ listing: { ...LISTING_OFF, status: 'connected', health: 'attention', reason: 'Google hasn’t approved the studio’s access to listings yet. It’s a one-time request to Google, and nothing is wrong with your account.' } }));
    await expect(page.locator('#svListing')).toContainText('nothing is wrong with your account');
    await expect(page.locator('#svListing button')).toHaveCount(0);
  });

  test('a plan without connections has no doors to them, and the checklist doesn’t ask', async ({ page }) => {
    await installApp(page, { api: { ...PAGE_API, '/site': SITE(), '/visibility': VISIBILITY(),
      '/portal/context': { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'cms', edition_features: ['website', 'developer', 'forms'], capabilities: ['edit', 'publish'], nav: [], landing: '/today.html', attention_count: 0, plan_key: 'presence' } } } as never });
    await page.goto('/presence.html#search');
    await expect(page.locator('#svConsoleCard')).toBeHidden();
    await expect(page.locator('#svListingCard')).toBeHidden();
    await expect(page.locator('#seoTasks')).not.toContainText('Connect Google');
    await expect(page.locator('#nav .navitem[data-link="analytics"]')).toBeHidden();
  });

  test('AI answers: the studio’s own result, with the date and the name it ran under', async ({ page }) => {
    await openSearch(page, VISIBILITY({ ai: { overall: 46, label: 'Fix now', pillars: [{ name: 'Awareness', score: 10 }, { name: 'Accuracy', score: null }], business_name: 'Marlow’s Kitchen', city: 'Burbank', checked_at: '2026-10-26T00:00:00Z', report_url: 'https://tools.example.com/report/a1' } }));
    const a = page.locator('#svAi');
    await expect(a).toContainText('46');
    await expect(a).toContainText('Fix now');
    await expect(a).toContainText('Checked Oct 26, 2026 for Marlow’s Kitchen in Burbank.');
    await expect(a.getByRole('link', { name: 'See the result' })).toHaveAttribute('href', 'https://tools.example.com/report/a1');
    await expect(a.getByRole('link', { name: 'Run it again' })).toHaveAttribute('href', 'https://tools.example.com/ai-visibility');
  });

  // list item 153: who the assistants named instead, and the websites their answers drew on
  test('AI answers: who was named instead, and the websites the answers drew on', async ({ page }) => {
    await openSearch(page, VISIBILITY({ ai: { overall: 40, label: 'Fix now', pillars: [], business_name: 'Marlow’s Kitchen', city: 'Burbank', checked_at: '2026-10-26T00:00:00Z', report_url: 'https://tools.example.com/report/a1',
      competitors: [{ name: 'Rival Bistro', times: 4 }, { name: 'Corner Cafe', times: 1 }], sources: [{ name: 'Yelp', cited: 4, own: false }, { name: 'marlows.example', cited: 2, own: true }] } }));
    const a = page.locator('#svAi');
    await expect(a).toContainText('Named instead of you: Rival Bistro (4 times), Corner Cafe (1 time)');
    await expect(a).toContainText('Websites the answers drew on: Yelp (4), your website (2)');
  });

  test('AI answers, never run: a door to the free check, and how to make it show up here', async ({ page }) => {
    await openSearch(page, VISIBILITY());
    await expect(page.locator('#svAi').getByRole('link', { name: 'Run the free check' })).toHaveAttribute('target', '_blank');
    await expect(page.locator('#svAi')).toContainText('Enter marlows.example as your website');
  });

  test('the wording moved here from Business: preview, fields and page visibility', async ({ page }) => {
    await openSearch(page, VISIBILITY());
    await expect(page.locator('#view-search #searchPreviewWrap')).toBeVisible();
    await expect(page.locator('#view-search #f-seo_title')).toHaveValue('Marlow’s Kitchen — Burbank');
    await expect(page.locator('#view-search #searchCard')).toContainText('use its settings button on the Pages tab');
    await page.evaluate(() => (window as any).go('business'));
    await expect(page.locator('#view-business #f-seo_title')).toHaveCount(0);
    await expect(page.locator('#f-industry')).toBeVisible();
  });

  test('a finding’s text is text: nothing from a report can become markup', async ({ page }) => {
    const hostile = '<img src=x onerror="window.__xss=1">';
    await openSearch(page, VISIBILITY({
      score: { ...SCORE, summary: hostile, issues: [{ title: hostile, what: hostile, why: hostile, fix: hostile, priority: 'Fix now', pillar: hostile }] },
      ai: { overall: 10, label: hostile, pillars: [{ name: hostile, score: 1 }], business_name: hostile, city: hostile, checked_at: '2026-10-26T00:00:00Z', report_url: null },
      console: { ...CONSOLE_ON, top_terms: [{ term: hostile, clicks: 1, impressions: 1 }], top_pages: [{ path: hostile, clicks: 1, impressions: 1 }] },
      listing: { ...LISTING_ON, reason: hostile, data: { ...LISTING_ON.data, listing_name: hostile, listing_address: hostile } },
    }));
    await expect(page.locator('#svListing')).toContainText('onerror');
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
    await expect(page.locator('#view-search img[src="x"]')).toHaveCount(0);
  });

  test('no serious/critical axe violations, with everything showing', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'axe once, on desktop');
    await openSearch(page, VISIBILITY({ score: SCORE, console: CONSOLE_ON, listing: LISTING_ON, ai: { overall: 46, label: 'Fix now', pillars: [{ name: 'Awareness', score: 10 }], business_name: 'Marlow’s', city: 'Burbank', checked_at: '2026-10-26T00:00:00Z', report_url: 'https://tools.example.com/r' } }));
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).include('#view-search').withTags(['wcag2a', 'wcag2aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => `${n.target.join(' ')} — ${(n.any[0]?.message || '').slice(0, 140)}`).join(' | ')}`)).toEqual([]);
  });
});

test.describe('Analytics page, from the Analytics tab', () => {
  const DASH = (website: Record<string, unknown>) => ({ data: {
    period: 'this_month', generated_at: '2026-11-05T14:14:00Z',
    sales: { pipeline: { open: { count: 2, value_cents: 500000 }, stages: [] }, won: null, enquiries: null, support: null, invoices: null, recent_wins: [] },
    website,
  } });
  const TRAFFIC = { visitors: 214, prior_visitors: 180, pageviews: 512, actions: 11,
    top_pages: [{ path: '/', views: 231 }],
    pages: [{ path: '/', views: 231, visitors: 150 }, { path: '/menu/', views: 104, visitors: 88 }, { path: '/a-very-long-page-address-that-will-not-fit-on-a-phone-screen/', views: 12, visitors: 9 }],
    top_sources: [{ source: 'Google', visits: 88, share: 41 }, { source: 'Direct', visits: 64, share: 30 }],
    weekly: [10, 12, 11, 14, 13, 16, 15, 18, 17, 20, 19, 22], has_data: true };
  const HOSTED = { traffic: TRAFFIC, search: { clicks: 38, impressions: 4100, period: '2026-10', top_terms: [], monthly: [], top_pages: [{ path: '/menu/', clicks: 21, impressions: 300 }] }, hosting: { hosted: true, external: false } };

  test('the tab opens the website view: no sales band, one trend, one sources list, one per-page table', async ({ page }) => {
    await installApp(page, { api: { ...PAGE_API, '/site': SITE(), '/visibility': VISIBILITY(), '/analytics/dashboard': DASH(HOSTED) } as never });
    await page.goto('/presence.html#business');
    await expect(page.locator('#view-business')).toBeVisible();
    await page.waitForLoadState('networkidle');   // leaving mid-request is its own console noise on WebKit
    await page.evaluate(() => (window as any).openSiteTab('analytics'));
    await page.waitForURL(/analytics\.html\?view=website/);
    await expect(page.getByRole('heading', { name: 'Website analytics' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sales', exact: true })).toHaveCount(0);
    await expect(page.locator('#insights')).toHaveCount(0);
    await expect(page.locator('svg.chart')).toHaveCount(1);
    await expect(page.getByRole('heading', { name: 'Where visitors come from' })).toBeVisible();
    await expect(page.locator('.srcs')).toContainText('Google');
    await expect(page.locator('#pageTable')).toBeVisible();
    await noSideScroll(page);
  });

  test('a table has room for its page names at every size', async ({ page }) => {
    await installApp(page, { api: { '/analytics/dashboard': DASH(HOSTED) } as never });
    await page.goto('/analytics.html?view=website');
    const width = await page.locator('#pageTable tbody tr:nth-child(2) td:first-child').evaluate((td) => td.getBoundingClientRect().width);
    expect(width, 'the name column').toBeGreaterThanOrEqual(120);
    await expect(page.locator('#pageTable tbody tr').nth(1).locator('td b')).toHaveJSProperty('scrollWidth', await page.locator('#pageTable tbody tr').nth(1).locator('td b').evaluate((b) => b.clientWidth));
  });

  test('the visitors tile compares with the period before', async ({ page }) => {
    await installApp(page, { api: { '/analytics/dashboard': DASH(HOSTED) } as never });
    await page.goto('/analytics.html?view=website');
    await expect(page.locator('#siteStats .stat').first()).toContainText('↑ 19%');
    await expect(page.locator('#siteStats .stat').first()).toContainText('vs the period before');
  });

  test('no comparison exists → no comparison is claimed', async ({ page }) => {
    await installApp(page, { api: { '/analytics/dashboard': DASH({ ...HOSTED, traffic: { ...TRAFFIC, prior_visitors: null } }) } as never });
    await page.goto('/analytics.html?view=website');
    await expect(page.locator('#siteStats .stat').first()).toContainText('512 page views');
    await expect(page.locator('#siteStats .stat').first()).not.toContainText('period before');
  });

  test('the per-page table: every page, views, people, and clicks from Google where known', async ({ page }) => {
    await installApp(page, { api: { '/analytics/dashboard': DASH(HOSTED) } as never });
    await page.goto('/analytics.html?view=website');
    const t = page.locator('#pageTable');
    await expect(t.locator('th')).toHaveText(['Page', 'Views', 'People', 'Google']);
    await expect(t.locator('tbody tr')).toHaveCount(3);
    await expect(t.locator('tbody tr').nth(1).locator('td')).toHaveText([/Menu/, '104', '88', '21']);
    await expect(t.locator('tbody tr').nth(0).locator('td').nth(3)).toHaveText('—');   // unknown, not zero
    await noSideScroll(page);
  });

  test('an older function build (no people per page): the table just has fewer columns', async ({ page }) => {
    const { pages: _p, prior_visitors: _v, ...old } = TRAFFIC;
    await installApp(page, { api: { '/analytics/dashboard': DASH({ traffic: old, search: null, hosting: { hosted: true, external: false } }) } as never });
    await page.goto('/analytics.html?view=website');
    await expect(page.locator('#pageTable th')).toHaveText(['Page', 'Views']);
    await expect(page.locator('#pageTable tbody tr')).toHaveCount(1);
  });

  test('a site the studio doesn’t host: Google’s trend and pages, labeled, instead of empty boxes', async ({ page }) => {
    await installApp(page, { api: { '/analytics/dashboard': DASH({
      traffic: { visitors: 0, pageviews: 0, actions: 0, top_pages: [], pages: [], top_sources: [], weekly: new Array(12).fill(0), has_data: false },
      search: { clicks: 40, impressions: 400, period: '2026-10', top_terms: [], monthly: [{ period: '2026-08', clicks: 20, impressions: 200 }, { period: '2026-09', clicks: 30, impressions: 300 }, { period: '2026-10', clicks: 40, impressions: 400 }], top_pages: [{ path: '/services/', clicks: 12, impressions: 90 }] },
      hosting: { hosted: false, external: true, domain: 'theirs.example', visitors_reason: 'No counter on its pages.', search_reason: 'Google reports on the domain.' },
    }) } as never });
    await page.goto('/analytics.html?view=website');
    await expect(page.getByRole('heading', { name: 'Clicks from Google over time' })).toBeVisible();
    await expect(page.locator('svg.chart')).toHaveAttribute('aria-label', /monthly clicks from Google, Aug to Oct: 20, 30, 40/);
    await expect(page.locator('.chartnote').first()).toContainText('40 clicks in Oct');
    await expect(page.locator('#pageTable th')).toHaveText(['Page', 'Clicks', 'Seen']);
    await expect(page.locator('#pageTable')).toContainText('/services/');
    // and the sources list stays honest: Google can't say where visitors came from
    await expect(page.getByRole('heading', { name: 'Where visitors come from' }).locator('..').locator('..')).toContainText('Not measured here');
  });

  test('a site the studio doesn’t host, one month only: no line drawn from a single point', async ({ page }) => {
    await installApp(page, { api: { '/analytics/dashboard': DASH({
      traffic: { visitors: 0, pageviews: 0, actions: 0, top_pages: [], pages: [], top_sources: [], weekly: new Array(12).fill(0), has_data: false },
      search: { clicks: 40, impressions: 400, period: '2026-10', top_terms: [], monthly: [{ period: '2026-10', clicks: 40, impressions: 400 }], top_pages: [] },
      hosting: { hosted: false, external: true, domain: 'theirs.example' },
    }) } as never });
    await page.goto('/analytics.html?view=website');
    await expect(page.locator('svg.chart')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Visitors over time' })).toBeVisible();
  });

  test('scope: the view keeps the client on its calls and its way back', async ({ page }) => {
    await installApp(page, { api: { '/analytics/dashboard': DASH(HOSTED) } as never });
    let scope: string | undefined;
    page.on('request', (r) => { if (r.url().includes('/analytics/dashboard')) scope = r.headers()['x-dds-scope-site']; });
    await page.goto('/analytics.html?view=website&client=c-123');
    await expect(page.getByRole('link', { name: 'Sales and enquiries' })).toHaveAttribute('href', '/analytics.html?client=c-123');
    expect(scope).toBe('c-123');
  });

  test('the full page is unchanged: both bands and Insights', async ({ page }) => {
    await installApp(page, { api: { '/analytics/dashboard': DASH(HOSTED) } as never });
    await page.goto('/analytics.html');
    await expect(page.getByRole('heading', { name: 'Sales', exact: true })).toBeVisible();
    await expect(page.locator('#insights')).toBeVisible();
    await expect(page.locator('#pageTable')).toBeVisible();
  });
});

test.describe('Connections page: the Google listing', () => {
  const LISTING_ROW = (over: Record<string, unknown> = {}) => ({ data: { edition: 'presence', note: '', groups: { 'Your listings': [{
    key: 'google_business_profile', label: 'your Google listing', purpose: 'Keep your Google listing correct.',
    reads: ['your listing details and hours'], approval: 'You approve access on the provider’s sign-in screen.', availability: 'Read-only',
    connection: { status: 'disconnected', health: 'unknown', last_sync_at: null, connected_at: null, reason: '' }, data: null, ...over,
  }] } } });

  test('it has a Connect button now', async ({ page }) => {
    await installApp(page, { api: { '/connections': LISTING_ROW() } as never });
    await page.goto('/connections.html');
    await expect(page.locator('#svc-google_business_profile').getByRole('button', { name: /Connect/ })).toBeVisible();
    await expect(page.locator('#svc-google_business_profile')).not.toContainText('Not available yet');
  });

  test('several listings: asks which, with an address to tell them apart, and records the pick', async ({ page }) => {
    await installApp(page, { api: {
      '/connections': LISTING_ROW({ connection: { status: 'connected', health: 'attention', last_sync_at: null, connected_at: '2026-11-01', reason: 'Choose which Google listing is this business. That account manages 2.' } }),
      '/connections/google_business_profile/properties': { data: { properties: [{ id: 'locations/1', name: 'Marlow’s Burbank', address: '12 Main St, Burbank, CA' }, { id: 'locations/2', name: 'Marlow’s Glendale', address: '9 Oak Ave, Glendale, CA' }], selected: null, note: '' } },
    } as never });
    let picked: unknown;
    await page.route('**/functions/v1/presence/connections/google_business_profile/property', (route) => { picked = route.request().postDataJSON(); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { selected: { id: 'locations/2', name: 'Marlow’s Glendale' } } }) }); });
    await page.goto('/connections.html');
    const row = page.locator('#svc-google_business_profile');
    await expect(row).toContainText('Which listing is this business?');
    await row.getByRole('button', { name: /Marlow’s Glendale · 9 Oak Ave/ }).click();
    await expect.poll(() => picked).toEqual({ property_id: 'locations/2' });
  });

  test('a chosen listing says which, and its numbers show on the row', async ({ page }) => {
    await installApp(page, { api: { '/connections': LISTING_ROW({
      connection: { status: 'connected', health: 'ok', last_sync_at: '2026-11-04', connected_at: '2026-11-01', reason: '' },
      property: { id: 'locations/1', name: 'Marlow’s Kitchen', auto_selected: true },
      data: { rating: 4.6, review_count: 128, calls: 5, direction_requests: 7, as_of: '2026-11-04' },
    }) } as never });
    await page.goto('/connections.html');
    const row = page.locator('#svc-google_business_profile');
    await expect(row).toContainText('Reading the Marlow’s Kitchen listing — picked automatically.');
    await expect(row).toContainText('4.6★');
    await expect(row).toContainText('7 direction requests');
  });

  test('Analytics’ own picker still works through the shared code', async ({ page }) => {
    await installApp(page, { api: {
      '/connections': { data: { edition: 'presence', note: '', groups: { 'Your numbers': [{ key: 'google_analytics', label: 'your visitor numbers', purpose: 'p', reads: [], approval: '', availability: 'Read-only', connection: { status: 'connected', health: 'ok', last_sync_at: null, connected_at: '2026-11-01', reason: '' }, property: null, data: null }] } } },
      '/connections/google_analytics/properties': { data: { properties: [{ id: '1', name: 'Marlow', account: 'Acct' }], selected: null, note: '' } },
    } as never });
    await page.goto('/connections.html');
    await expect(page.locator('#svc-google_analytics')).toContainText('Which property is this website?');
    await expect(page.locator('#svc-google_analytics').getByRole('button', { name: 'Marlow · Acct' })).toBeVisible();
  });
});
