import { test, expect, Page } from '@playwright/test';
import { installApp, settled } from './helpers/app';
import { API } from './helpers/editor';

// ── Builder item 37: the editor opens with one read where it made seven ──────
// GET /site?with=… brings the site, the six lists and whether publishing is locked in one
// answer (routes/site_open.ts). A part the answer holds is not read again; a part it refused
// counts as empty, as that read refused alone always did; and a server from before, which
// answers the site alone, still gets every read the old way.
const LISTS = ['/offerings', '/faqs', '/testimonials', '/posts', '/media', '/settings', '/site/publish-lock'];
const SITE = (API['/site'] as { data: Record<string, unknown> }).data;
const PARTS = {
  offerings: { data: [{ id: 'o1', name: 'Sunday roast', category: 'Mains', is_visible: true, sort_order: 1 }] },
  faqs: { data: [{ id: 'f1', question: 'Is there parking?', answer: 'Out back.', is_visible: true, sort_order: 1 }] },
  testimonials: { status: 403, error: 'feature_not_in_plan' },
  posts: { data: [] },
  media: { data: [] },
  settings: { data: { blocks: [{ type: 'title', title: 'Welcome in' }] } },
  publish_lock: { data: { on: true, at: '2026-11-14T09:00:00Z', by_kind: 'operator', words: 'Launch freeze', can_change: false } },
};

/** The presence reads the page made, by path (a "may I?" check isn't one). */
function readsOf(page: Page) {
  const reads: string[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET' || !r.url().includes('/functions/v1/presence')) return;
    const u = new URL(r.url());
    reads.push(u.pathname.replace(/^.*\/functions\/v1\/presence/, '') + (u.searchParams.has('with') ? '?with' : ''));
  });
  return reads;
}

test.describe('the editor opens with one read (item 37)', () => {
  test('the site, its lists and the publishing lock come in one answer, and none is read again', async ({ page }) => {
    await installApp(page, { api: { ...API, '/site': { data: SITE, parts: PARTS } } });
    const reads = readsOf(page);
    await page.goto('/presence.html');
    await expect(page.locator('#ssStatus')).not.toBeEmpty();
    await settled(page);
    expect(reads.filter((p) => p === '/site?with'), 'one start-up read').toHaveLength(1);
    expect(reads.filter((p) => p === '/site'), 'and the site not read again on its own').toHaveLength(0);
    for (const p of LISTS) expect(reads, `${p} came with it`).not.toContain(p);
    // what came in the one answer is what the page shows
    await expect(page.locator('#btnPublish')).toHaveText('Locked');
    await page.evaluate(() => (window as unknown as { go: (v: string) => void }).go('offerings'));
    await expect(page.locator('#offeringsWrap')).toContainText('Sunday roast');
    // the refused part reads as empty, as the read refused alone always did, and isn't asked for again
    expect(await page.evaluate(() => (0, eval)('S.testimonials.length'))).toBe(0);
    expect(await page.evaluate(() => (0, eval)('S.faqs[0].question'))).toBe('Is there parking?');
  });

  test('a part the answer leaves out is read on its own', async ({ page }) => {
    const { settings: _left, ...rest } = PARTS;
    await installApp(page, { api: { ...API, '/site': { data: SITE, parts: rest } } });
    const reads = readsOf(page);
    await page.goto('/presence.html');
    await expect(page.locator('#ssStatus')).not.toBeEmpty();
    await settled(page);
    expect(reads.filter((p) => p === '/settings')).toHaveLength(1);
    for (const p of LISTS.filter((x) => x !== '/settings')) expect(reads, `${p} came with it`).not.toContain(p);
  });

  test('a server from before, answering the site alone, gets each read the old way', async ({ page }) => {
    await installApp(page, { api: API });
    // as the server before item 37 answered: the site, and no parts whatever was asked
    await page.route(/\/functions\/v1\/presence\/site(\?|$)/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: SITE }) }));
    const reads = readsOf(page);
    await page.goto('/presence.html');
    await expect(page.locator('#ssStatus')).not.toBeEmpty();
    await settled(page);
    expect(reads.filter((p) => p === '/site?with')).toHaveLength(1);
    expect(reads.filter((p) => p === '/site'), 'the site read again, alone').toHaveLength(1);
    for (const p of LISTS) expect(reads.filter((x) => x === p), `${p} read once`).toHaveLength(1);
    await expect(page.locator('#btnPublish')).not.toHaveText('Locked');
  });
});
