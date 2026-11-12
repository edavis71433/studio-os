import { test, expect, type Page } from '@playwright/test';
import { installApp } from './helpers/app';

// ── What people type to find you (builder list item 160, part two, Nov 2026) ──
// The Search tab asks for the two or three phrases the business wants to be found for, says
// which page's search headline has each one, and offers ideas from its services and area.
// A missing phrase is a High task on the checklist; Add it to a page writes a headline with
// it into the page picked. The three-question setup keeps its words as the phrases.
// Hermetic: the phrases live in this file's own store, every write is recorded.

const PAGE_API = {
  '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/health': { data: {} }, '/media': { data: [] }, '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] },
  '/settings': { data: { blocks: [], section_meta: {}, pages: [], page_seo: {} } },
};
const SITE = { data: {
  site: { id: '00000000-0000-4000-8000-000000000001', client_id: '00000000-0000-4000-8000-000000000002', status: 'live', edition: 'presence', custom_domain: 'marlows.example', template_slug: 'restaurant-classic', last_published_at: '2026-07-01T00:00:00Z', netlify_site_id: 'n1' },
  identity: { business_name: 'Marlow’s Kitchen', seo_title: 'Italian restaurant in Burbank — Marlow’s Kitchen', seo_description: 'Seasonal plates in Burbank, CA.', service_area: 'Serving Burbank and Glendale' },
  location: { city: 'Burbank' }, voice: {}, offerings: [], faqs: [], testimonials: [], posts: [],
} };
const OFF = { status: 'disconnected', health: 'unknown', reason: '', last_sync_at: null, connect_href: '/connections.html', readiness: 'connect', unavailable: false, has_data: false, property: null, data: null };
const PAGES = [
  { key: 'home', label: 'Home', title: 'Italian restaurant in Burbank — Marlow’s Kitchen' },
  { key: 'offerings', label: 'Menu', title: 'Menu — Marlow’s Kitchen' },
  { key: 'page:private-events', label: 'Private events', title: 'Private events — Marlow’s Kitchen' },
  { key: 'contact', label: 'Contact', title: 'Contact & Hours — Marlow’s Kitchen' },
];
// The server's rules, small: a phrase is found when every word is in a page's headline.
const foundIn = (phrase: string, pages: typeof PAGES) => pages.find((p) => phrase.split(' ').every((w) => p.title.toLowerCase().includes(w))) || null;
function view(list: string[], pages = PAGES) {
  const rows = list.map((phrase) => { const h = foundIn(phrase, pages); return { phrase, found: h ? { key: h.key, label: h.label, title: h.title } : null }; });
  return {
    max: 3, list: rows, pages,
    ideas: ['catering burbank', 'wine dinners burbank', 'brunch glendale'].filter((i) => !list.includes(i)),
    tasks: rows.map((r) => ({ key: `phrase:${r.phrase}`, priority: 'high', done: !!r.found, title: `Put “${r.phrase}” in a page’s search headline`, sub: r.found ? '' : 'Google reads the headline first. Pick the page that is about it.', go: r.found ? null : 'phrases' })),
  };
}

type Call = { method: string; path: string; body: Record<string, unknown> | null };
async function open(page: Page, phrases: string[] = ['italian restaurant burbank', 'private dining glendale']): Promise<Call[]> {
  const calls: Call[] = [];
  let list = [...phrases], pages = PAGES.map((p) => ({ ...p }));
  const v0 = view(list, pages);
  const tasks = [{ key: 'console', priority: 'high', done: false, title: 'Connect Google Search Console', sub: '', go: 'connect:console' }, ...v0.tasks];
  await installApp(page, { api: { ...PAGE_API, '/site': SITE,
    '/visibility': { data: { state: 'ready', address: { url: 'https://marlows.example/', domain: 'marlows.example', hosted: true }, score: null, ai: null, ai_check_url: 'https://tools.example.com/ai', console: OFF, listing: OFF, tasks, phrases: v0 } } } as never });
  await page.route('**/functions/v1/presence/**', async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname.replace(/^.*\/functions\/v1\/presence/, ''), m = req.method();
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: body }) });
    if (path === '/visibility/phrases') {
      const body = m === 'PUT' ? req.postDataJSON() as Record<string, unknown> : null;
      calls.push({ method: m, path, body });
      if (m === 'PUT') list = (body!.phrases as string[]).map((x) => x.toLowerCase().trim());
      return json(view(list, pages));
    }
    if ((path === '/identity' || path === '/settings') && m === 'PUT') {
      const body = req.postDataJSON() as Record<string, unknown>;
      calls.push({ method: m, path, body });
      if (path === '/identity' && body.seo_title) pages = pages.map((p) => (p.key === 'home' ? { ...p, title: String(body.seo_title) } : p));
      const seo = body.page_seo as Record<string, { title?: string }> | undefined;
      if (seo) pages = pages.map((p) => (seo[p.key]?.title ? { ...p, title: String(seo[p.key].title) } : p));
      return json(path === '/settings' ? { blocks: [], section_meta: {}, pages: [], ...body } : body);
    }
    return route.fallback();
  });
  await page.goto('/presence.html#search');
  await expect(page.locator('#svPhrasesCard')).toBeVisible();
  return calls;
}
const row = (page: Page, phrase: string) => page.locator(`.sv-ph-row[data-phrase="${phrase}"]`);
const noSideScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  (page as unknown as { __errors: string[] }).__errors = errors;
  await page.addInitScript(() => {
    const w = window as unknown as { __errToasts: string[] }; w.__errToasts = [];
    let real: ((...a: unknown[]) => unknown) | undefined;
    Object.defineProperty(window, 'ddsToast', { configurable: true, get: () => real,
      set(fn) { real = function (this: unknown, ...a: unknown[]) { if (a[1] === 'err') w.__errToasts.push(String(a[0])); return fn.apply(this, a); }; } });
  });
});
test.afterEach(async ({ page }) => {
  expect((page as unknown as { __errors: string[] }).__errors).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as { __errToasts?: string[] }).__errToasts ?? [])).toEqual([]);
});

test.describe('Search: what people type to find you', () => {
  test('each phrase says which page’s headline has it, and a missing one is a High task', async ({ page }) => {
    await open(page);
    await expect(page.locator('#svPhrasesN')).toHaveText('2 of 3');
    await expect(row(page, 'italian restaurant burbank').locator('.sv-ph-st')).toHaveText('In your Home page’s search headline');
    await expect(row(page, 'private dining glendale').locator('.sv-ph-st')).toHaveText('Not in any page’s search headline yet');
    await expect(row(page, 'private dining glendale').getByRole('button', { name: 'Add it to a page' })).toBeVisible();
    const task = page.locator('#seoTasks li[data-task="phrase:private dining glendale"]');
    await expect(task).toContainText('Put “private dining glendale” in a page’s search headline');
    await expect(task.locator('.sv-pri')).toHaveText('High');
    await noSideScroll(page);
  });

  test('a third phrase from the ideas saves, and the card is full at three', async ({ page }) => {
    const calls = await open(page);
    await page.getByRole('button', { name: 'Add “catering burbank”' }).click();
    await expect.poll(() => calls.filter((c) => c.method === 'PUT').at(-1)?.body?.phrases).toEqual(['italian restaurant burbank', 'private dining glendale', 'catering burbank']);
    await expect(page.locator('#svPhrasesN')).toHaveText('3 of 3');
    await expect(page.locator('#svPhraseNew')).toHaveCount(0);
    await expect(page.locator('#seoTasks li[data-task="phrase:catering burbank"]')).toBeVisible();   // the checklist follows
  });

  test('a phrase typed in saves, and × takes one off', async ({ page }) => {
    const calls = await open(page, ['italian restaurant burbank']);
    await page.locator('#svPhraseNew').fill('Wine bar Burbank');
    await page.locator('#svPhraseNew').press('Enter');
    await expect(row(page, 'wine bar burbank')).toBeVisible();
    await page.getByRole('button', { name: 'Take “italian restaurant burbank” off' }).click();
    await expect.poll(() => calls.filter((c) => c.method === 'PUT').at(-1)?.body?.phrases).toEqual(['wine bar burbank']);
    await expect(row(page, 'italian restaurant burbank')).toHaveCount(0);
  });

  test('Add it to a page writes a headline with the phrase into the page picked', async ({ page }) => {
    const calls = await open(page);
    await row(page, 'private dining glendale').getByRole('button', { name: 'Add it to a page' }).click();
    const pick = page.locator('.sv-ph-pick');
    await expect(pick.locator('h4')).toHaveText('Which page is about “private dining glendale”?');
    await pick.getByRole('button', { name: /Private events/ }).click();
    await expect(page.locator('#svPhraseTitle')).toHaveValue('Private dining glendale — Marlow’s Kitchen');
    await page.locator('#svPhraseTitle').fill('Private dining in Glendale — Marlow’s Kitchen');
    await pick.getByRole('button', { name: 'Use this headline' }).click();
    await expect.poll(() => (calls.find((c) => c.path === '/settings')?.body?.page_seo as Record<string, { title?: string }> | undefined)?.['page:private-events']?.title)
      .toBe('Private dining in Glendale — Marlow’s Kitchen');
    await expect(row(page, 'private dining glendale').locator('.sv-ph-st')).toHaveText('In your Private events page’s search headline');
    await expect(page.locator('.sv-ph-pick')).toHaveCount(0);
    await expect(page.locator('#seoTasks li[data-task="phrase:private dining glendale"]')).toHaveCount(0);   // done: it goes under Show done
  });

  test('the home page’s headline saves as the site’s search headline', async ({ page }) => {
    const calls = await open(page, ['catering glendale']);
    await row(page, 'catering glendale').getByRole('button', { name: 'Add it to a page' }).click();
    await page.locator('.sv-ph-pick').getByRole('button', { name: /^Home/ }).click();
    await page.locator('.sv-ph-pick').getByRole('button', { name: 'Use this headline' }).click();
    await expect.poll(() => calls.find((c) => c.path === '/identity')?.body?.seo_title).toBe('Catering glendale — Marlow’s Kitchen');
    await expect(page.locator('#f-seo_title')).toHaveValue('Catering glendale — Marlow’s Kitchen');
  });

  test('the checklist’s task opens the card on that phrase', async ({ page }) => {
    await open(page);
    await page.locator('#seoTasks li[data-task="phrase:private dining glendale"] .sv-go').click();
    await expect(page.locator('.sv-ph-pick h4')).toHaveText('Which page is about “private dining glendale”?');
  });

  test('the three questions start from the phrases and keep their answer', async ({ page }) => {
    const calls = await open(page);
    await page.locator('#btnSeoSetup').click();
    await expect(page.locator('#sw-words')).toHaveValue('italian restaurant burbank, private dining glendale');
    await page.locator('#sw-words').fill('italian restaurant burbank, catering glendale');
    await page.locator('#swSave').click();
    await expect.poll(() => calls.filter((c) => c.path === '/visibility/phrases' && c.method === 'PUT').at(-1)?.body?.phrases).toEqual(['italian restaurant burbank', 'catering glendale']);
    await expect(row(page, 'catering glendale')).toBeVisible();
  });
});
