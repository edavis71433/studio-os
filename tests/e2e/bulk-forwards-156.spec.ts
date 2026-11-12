import { test, expect, type Page, type Route } from '@playwright/test';
import { installApp } from './helpers/app';

// Builder list item 156 (Nov 2026): bring in a whole list of old page addresses at once
// when a client moves from another website. In the forwards (Search › Old addresses, and
// the Pages card's Not found page): paste the lines or choose a CSV, or read the old
// site's own page list; Check the list says what each line will do; nothing is saved
// until Bring them in. tests/presence/redirect_import_test.mjs covers the server.

const PAGE_API = {
  '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/health': { data: { state: 'healthy', sentence: 'Your website is live and up to date.', detail: '', first_run: false, facts: { website: { state: 'live', label: 'Live', detail: '' }, draft: { state: 'clean', label: 'Up to date', detail: '' }, last_publish: { label: 'Sun, Oct 5', detail: 'published by you' }, domain: { label: 'maple.example', state: 'ok', detail: '' } } } },
  '/settings': { data: { blocks: [], section_meta: {}, pages: [], search_hidden: false, llms_txt: null } },
  '/media': { data: [] }, '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] },
  '/site': { data: { site: { id: '00000000-0000-4000-8000-000000000001', status: 'live', edition: 'presence', custom_domain: 'maple.example', template_slug: 'bistro', last_published_at: '2026-07-01T00:00:00Z', netlify_site_id: 'n1' }, identity: { business_name: 'Maple & Main Realty', seo_title: 'Maple & Main Realty, Burbank', seo_description: '' }, location: {}, voice: {}, offerings: [], faqs: [], testimonials: [], posts: [] } },
  '/foundations/domain': { data: { custom_domain: 'maple.example', health: 'ok' } },
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
const PLAN = (dry: boolean) => ({ data: { dry_run: dry, add: 2, replace: 1, same: 0, skipped: 1, repoint: [], total_after: 3, rows: [
  { line: 1, from: '/about-us/', to: '/about/', verdict: 'add' },
  { line: 2, from: '/old-listings/', to: '/homes/', verdict: 'replace', note: 'Replaces the forward to /listings/.' },
  { line: 3, from: '/gift-cards/', to: '/gifts/', verdict: 'add', note: 'Not a page on this site yet.' },
  { line: 4, from: '/page?id=4', to: '/x/', verdict: 'skip', reason: 'An address with a ? part can’t be forwarded; leave the ? part off.' },
] } });

async function openForwards(page: Page, forwards: unknown[] = [{ id: 'r1', from_path: '/old-listings/', to_path: '/listings/' }]) {
  const posts: Array<Record<string, unknown>> = [];
  let list = forwards;
  await installApp(page, { api: { ...PAGE_API, '/visibility': VIS() as never } });
  await page.route(/\/functions\/v1\/presence\/redirects(\?.*)?$/, async (route: Route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON(); posts.push(body);
      if (!body.dry_run) list = [...(list as unknown[]), { id: 'r2', from_path: '/about-us/', to_path: '/about/' }, { id: 'r3', from_path: '/gift-cards/', to_path: '/gifts/' }];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PLAN(!!body.dry_run)) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: list, cap: 500 }) });
  });
  await page.route(/\/functions\/v1\/presence\/redirects\/suggest/, (route: Route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: {
    host: 'oldsite.example', found: 5, sure: 2, lines: [{ from: '/about-us/', to: '/about/', sure: true }, { from: '/our-team/', to: '/team/', sure: true }, { from: '/careers/', to: '/', sure: false }],
  } }) }));
  await page.goto('/presence.html#search');
  await expect(page.locator('#svTools')).toBeVisible();
  const got = page.getByRole('button', { name: 'Got it' }); if (await got.count()) await got.first().click().catch(() => {});
  await page.locator('#svTools [data-tool="redirects"]').click();
  const dlg = page.locator('dialog.sv-dlg');
  await expect(dlg.getByRole('heading', { name: 'Old page addresses' })).toBeVisible();
  return { dlg, posts };
}

test.describe('item 156 — a whole list of old addresses at once', () => {
  test('paste, check, see what each line does, then bring them in', async ({ page }) => {
    const { dlg, posts } = await openForwards(page);
    const open = dlg.getByRole('button', { name: 'Bring in a whole list…' });
    await expect(open).toHaveAttribute('aria-expanded', 'false');
    await open.click();
    await expect(open).toHaveAttribute('aria-expanded', 'true');
    const box = dlg.getByRole('textbox', { name: 'Addresses to bring in, one per line' });
    await expect(box).toBeFocused();
    const text = '/about-us  /about/\n/old-listings  /homes/\n/gift-cards,/gifts/\n/page?id=4 /x/';
    await box.fill(text);
    await dlg.getByRole('button', { name: 'Check the list' }).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toEqual({ list: text, dry_run: true });
    await expect(dlg.locator('.rdx-sum')).toContainText('4 lines: 2 new forwards, 1 replaces one you had, 1 skipped. Nothing is saved until you bring them in.');
    const rows = dlg.locator('.rdx-table tbody tr');
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(1)).toContainText('Replaces the forward to /listings/.');
    await expect(rows.nth(2)).toContainText('New. Not a page on this site yet.');
    await expect(rows.nth(3)).toHaveClass(/skip/);
    await expect(rows.nth(3)).toContainText('Skipped: An address with a ? part');
    const go = dlg.getByRole('button', { name: 'Bring in 3 forwards' });
    await expect(go).toBeVisible();
    // a change to the list asks for a new check before anything is saved
    await box.press('End'); await box.type(' ');
    await expect(go).toBeHidden();
    await box.fill(text);
    await dlg.getByRole('button', { name: 'Check the list' }).click();
    await expect.poll(() => posts.length).toBe(2);
    await go.click();
    await expect.poll(() => posts.length).toBe(3);
    expect(posts[2]).toEqual({ list: text });
    await expect(page.getByText('2 forwards brought in, 1 replaced — publish to apply')).toBeVisible();
    await expect(dlg.getByText('/about-us/ → /about/')).toBeVisible();   // the list reads again
    await expect(open).toHaveAttribute('aria-expanded', 'false');
  });

  test('read the old site’s pages: the matches fill the list to check', async ({ page }) => {
    const { dlg } = await openForwards(page);
    await dlg.getByRole('button', { name: 'Bring in a whole list…' }).click();
    await dlg.getByRole('textbox', { name: 'The old website’s address' }).fill('oldsite.example');
    await dlg.getByRole('button', { name: 'Read its pages' }).click();
    const box = dlg.getByRole('textbox', { name: 'Addresses to bring in, one per line' });
    await expect(box).toHaveValue('/about-us/  /about/\n/our-team/  /team/\n/careers/  /');
    await expect(dlg.locator('.rdx-sum')).toContainText('Found 5 pages on oldsite.example. 3 need a forward; 1 has no close match here and go to your home page, so check it.');
  });

  test('a spreadsheet saved as CSV fills the list', async ({ page }) => {
    const { dlg } = await openForwards(page);
    await dlg.getByRole('button', { name: 'Bring in a whole list…' }).click();
    await dlg.locator('.rdx-file input[type=file]').setInputFiles({ name: 'old-addresses.csv', mimeType: 'text/csv', buffer: Buffer.from('Old URL,New URL\n/about-us,/about/\n/menus,/menu/\n') });
    await expect(dlg.getByRole('textbox', { name: 'Addresses to bring in, one per line' })).toHaveValue('Old URL,New URL\n/about-us,/about/\n/menus,/menu/\n');
  });

  test('a long list of forwards shows twenty, then Show all', async ({ page }) => {
    const many = Array.from({ length: 26 }, (_, i) => ({ id: 'f' + i, from_path: `/old-${String(i).padStart(2, '0')}/`, to_path: '/' }));
    const { dlg } = await openForwards(page, many);
    await expect(dlg.getByText(/^\/old-\d\d\/ → \/$/)).toHaveCount(20);
    await dlg.getByRole('button', { name: 'Show all 26 forwards' }).click();
    await expect(dlg.getByText(/^\/old-\d\d\/ → \/$/)).toHaveCount(26);
  });
});
