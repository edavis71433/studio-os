import { test, expect, type Page } from '@playwright/test';
import { installApp } from './helpers/app';

// Builder list item 183 (Nov 2026): Website health with a memory, on the Search tab.
// The Health check's own problems and the daily check's share one count, one list and
// seven plain headings; the weekly line and "since last week" come from the days kept
// since migration 0170 (GET /website-health's `memory`, lib/health_memory.ts); a PDF
// downloads. A client reads it, so it never shows a score. Fake names only.

const PAGE_API = {
  '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/health': { data: { state: 'healthy', sentence: 'Your website is live and up to date.', detail: '', first_run: false, facts: { website: { state: 'live', label: 'Live', detail: '' }, draft: { state: 'clean', label: 'Up to date', detail: '' }, last_publish: { label: 'Sun, Oct 5', detail: 'published by you' }, domain: { label: 'maple.example', state: 'ok', detail: '' } } } },
  '/settings': { data: { blocks: [], section_meta: {}, pages: [] } },
  '/media': { data: [] }, '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] },
  '/site': { data: { site: { id: '00000000-0000-4000-8000-000000000001', status: 'live', edition: 'presence', custom_domain: 'maple.example', template_slug: 'bistro', last_published_at: '2026-07-01T00:00:00Z', netlify_site_id: 'n1' }, identity: { business_name: 'Maple & Main Realty' }, location: {}, voice: {}, offerings: [], faqs: [], testimonials: [], posts: [] } },
  '/foundations/domain': { data: { custom_domain: 'maple.example', health: 'ok' } },
};
const day = (back: number) => new Date(Date.UTC(2026, 10, 11) - back * 86_400_000).toISOString().slice(0, 10);
const MEMORY = {
  kept: true, since_day: day(56),
  points: [6, 6, 5, 5, 4, 3, 3, 2].map((n, i) => ({ day: day((7 - i) * 7), n })),
  now: { day: day(0), n: 2, critical: 0, warning: 2 },
  then: { day: day(28), n: 5 },
  since: { day: day(7),
    fixed: [{ type: 'links.internal_broken', title: 'Links to pages that aren’t there', n: 1, resources: ['/team/'] }, { type: 'seo.description_missing', title: 'Pages without a search description', n: 1, resources: ['/about/'] }],
    added: [{ type: 'performance.image_oversized', title: 'Photos bigger than they need to be', n: 1, resources: ['hero.jpg'] }] },
  headings: [],
  issues: [
    { type: 'performance.image_oversized', title: 'Photos bigger than they need to be', severity: 'warning', heading: 'speed', n: 1, resources: ['hero.jpg'], human: 'A photo is 4 MB.', next_action: 'Replace with a smaller photograph.' },
    { type: 'seo.description_missing', title: 'Pages without a search description', severity: 'warning', heading: 'google', n: 3, resources: ['/', '/listings/', '/sell/'], human: 'No description.', next_action: 'Write a one-sentence description for this page.' },
  ],
};
const HEALTH = (over: Record<string, unknown> = {}) => ({ data: {
  overall: 'attention', headline: '', summary: 'Mostly good. A few things deserve a look.', ok_count: 6, attention_count: 1,
  categories: [
    { key: 'website_status', label: 'Website status', checks: [{ title: 'Online 100% of the last 30 days', why: '', state: 'ok', status_label: 'Working' }] },
    { key: 'speed', label: 'Speed', checks: [{ title: 'Slow on phones: the home page takes 3.1 s for most visitors', why: 'For three visitors in four.', state: 'attention', status_label: 'Needs a look', action_label: 'Find what slows it', action_href: 'https://tools.example/site-review?url=x' }] },
  ],
  content_performance: null, memory: MEMORY, memory_ready: true, ...over,
} });

async function openSearch(page: Page, health: unknown) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await installApp(page, { api: { ...PAGE_API, '/website-health': health as never } as never });
  await page.route('**/functions/v1/presence/website-health/pdf', (route) => route.fulfill({ status: 200, contentType: 'application/pdf', headers: { 'Content-Disposition': 'attachment; filename="Maple-and-Main-Realty-health-2026-11-11.pdf"' }, body: '%PDF-1.4\n%%EOF\n' }));
  await page.goto('/presence.html#search');
  await expect(page.locator('#healthCard')).toBeVisible();
  return errors;
}
const noSideScroll = async (page: Page) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, 'the page must not scroll sideways').toBeLessThanOrEqual(1);
};

test.describe('Website health with a memory (builder list item 183)', () => {
  test('one count for both kinds of problem, the change, the weekly line, and since last week', async ({ page }) => {
    const errors = await openSearch(page, HEALTH());
    const card = page.locator('#healthCard');
    await expect(card.getByRole('heading', { name: 'Website health' })).toBeVisible();
    await expect(card.locator('.hb-chip')).toHaveText('3 to look at');            // the slow phones + the two the daily check found
    await expect(card.locator('.hm-count b')).toHaveText('3');
    await expect(card.locator('.hm-count .hm-chg')).toHaveText('3 fewer than Oct 14');
    await expect(card.locator('.hm-count .hm-chg')).toHaveClass(/up/);
    await expect(card.locator('svg.hm-line')).toHaveAttribute('aria-label', /^Things to look at, by week: Sep 23 6, .* Nov 11 2$/);
    await expect(card.locator('svg.hm-line circle.pt')).toHaveCount(8);
    await expect(card.locator('.hm-cap')).toHaveText('Found by the daily check, one point a week');
    const since = card.locator('.hm-since');
    await expect(since.locator('h3')).toHaveText('Since Nov 4');
    await expect(since.locator('.k.fixed')).toHaveText('2 FIXED');
    await expect(since.locator('.k.new')).toHaveText('1 NEW');
    await expect(since).toContainText('✓ Links to pages that aren’t there · /team/');
    await expect(since).toContainText('! Photos bigger than they need to be · hero.jpg');
    expect(errors).toEqual([]);
  });

  test('seven plain headings with their counts and the two facts an owner asks first', async ({ page }) => {
    await openSearch(page, HEALTH());
    const tiles = page.locator('#healthCard .hm-tile');
    await expect(tiles.locator('b')).toHaveText(['Can people reach it', 'Speed', 'Google can read it', 'Everyone can use it', 'Words and pictures', 'Links', 'Business details']);
    await expect(tiles.nth(0).locator('.s')).toHaveText('✓ All good');
    await expect(tiles.nth(0).locator('.f')).toHaveText('Online 100% of the last 30 days');
    await expect(tiles.nth(1).locator('.s')).toHaveText('2 to look at');           // slow phones (right now) + big photos (daily check)
    await expect(tiles.nth(1)).toHaveClass(/look/);
    await expect(tiles.nth(2).locator('.s')).toHaveText('1 to look at');
  });

  test('the list: what is wrong now first, then each problem under its heading, with how many places and where to fix it', async ({ page }) => {
    await openSearch(page, HEALTH());
    const items = page.locator('#healthCard .hm-list li');
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toContainText('Slow on phones');
    await expect(items.nth(0).getByRole('link', { name: 'Find what slows it' })).toBeVisible();
    await expect(items.nth(1).locator('.hm-tag')).toHaveText('Speed');
    await expect(items.nth(2)).toContainText('Pages without a search description · 3 places');
    await expect(items.nth(2)).toContainText('/, /listings/, /sell/.');
    await expect(items.nth(2).getByRole('link', { name: 'Open Pages' })).toHaveAttribute('href', '#pages');
    await expect(items.nth(1).getByRole('link', { name: 'Open Files' })).toHaveAttribute('href', '#media');
  });

  test('Download PDF saves the check as a file', async ({ page }) => {
    await openSearch(page, HEALTH());
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#healthCard').getByRole('button', { name: 'Download PDF' }).click()]);
    expect(dl.suggestedFilename()).toMatch(/\.pdf$/);
  });

  test('a client reads this: words and counts, never a score', async ({ page }) => {
    await openSearch(page, HEALTH());
    await expect(page.locator('#healthCard')).not.toContainText(/score|out of 100/i);
  });

  test('nothing kept yet: the card says the line fills in, and invents nothing', async ({ page }) => {
    await openSearch(page, HEALTH({ memory: { ...MEMORY, kept: false, points: [], now: null, then: null, since: null, issues: [] } }));
    const card = page.locator('#healthCard');
    await expect(card).toContainText('Each day’s check is kept from today, so the line fills in week by week.');
    await expect(card.locator('.hm-row')).toHaveCount(0);
    await expect(card.locator('.hb-chip')).toHaveText('1 to look at');
  });

  test('before the database step: the card as it was, with no headings and no PDF', async ({ page }) => {
    await openSearch(page, HEALTH({ memory: null, memory_ready: false }));
    const card = page.locator('#healthCard');
    await expect(card.locator('.hb-chip')).toHaveText('1 to look at');
    await expect(card.locator('.hm-tile')).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Download PDF' })).toHaveCount(0);
    await expect(card.getByRole('link', { name: 'Find what slows it' })).toHaveCount(1);
  });

  test('phone width: the count, line and since-last-week stack, nothing wider than the screen', async ({ page }) => {
    await openSearch(page, HEALTH());
    const card = page.locator('#healthCard');
    await expect(card.locator('.hm-row')).toBeVisible();
    const isMobile = (page.viewportSize()?.width || 1280) < 761;
    const cols = await card.locator('.hm-row').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(cols).toBe(isMobile ? 1 : 3);
    await noSideScroll(page);
  });
});
