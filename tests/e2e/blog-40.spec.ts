import { test, expect, type Page } from '@playwright/test';
import { installApp } from './helpers/app';

// ── The deeper blog in the website builder (builder list item 40, Nov 2026) ──
// Blog lists every post as a card that says where it stands; a card opens the writing
// screen (blog-studio.js), which saves as you type and publishes one post on its own or
// at a day and time. Hermetic: the posts live in this file's own store, every write is
// recorded, nothing reaches a server. Every project runs it: computer, tablet, phone.

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PHOTO = id(501), COVER = id(502);
const MEDIA = [
  { id: PHOTO, alt_text: 'The room on a quiet night', mime: 'image/png', width: 800, height: 600, thumb: `/__e2e_photo__/${PHOTO}.png`, used_by: [] },
  { id: COVER, alt_text: 'The patio with its heaters on', mime: 'image/png', width: 800, height: 600, thumb: `/__e2e_photo__/${COVER}.png`, used_by: [] },
];
const LISTS = { post_categories: [{ id: 'news', name: 'News' }, { id: 'events', name: 'Events' }], post_authors: [{ id: 'maria-lopez', name: 'Maria Lopez', bio: 'Owner and head chef' }, { id: 'sam-ortiz', name: 'Sam Ortiz' }] };
const DAY = 86_400_000;
const PAGE_API = {
  '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/health': { data: {} },
  '/media': { data: MEDIA }, '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] },
  '/dev/customization': { data: { theme_tokens: {}, font_library: [] } },
};
const SITE = { data: {
  site: { id: id(1), client_id: id(2), status: 'live', edition: 'presence', custom_domain: 'marlows.example', template_slug: 'restaurant-classic', last_published_at: '2026-07-01T00:00:00Z', netlify_site_id: 'n1' },
  identity: { business_name: 'Marlow’s Kitchen' },
  location: { timezone: 'America/Los_Angeles', city: 'Burbank' }, voice: {}, offerings: [], faqs: [], testimonials: [], posts: [],
} };

interface World { posts: Array<Record<string, unknown>>; calls: Array<{ method: string; path: string; body: Record<string, unknown> | null }>; settings: Record<string, unknown> }
async function open(page: Page, hash = '#updates'): Promise<World> {
  const w: World = {
    posts: [
      { id: id(11), title: 'Summer patio is open', slug: 'summer-patio', body_md: 'Our patio opens Friday.', excerpt: '', hero_media_id: COVER, status: 'published', published_at: '2026-06-01T17:00:00Z', tags: [], noindex: false, category: 'news', author: 'maria-lopez', updated_at: '2026-06-01T17:00:00Z' },
      { id: id(12), title: 'Wine dinner on November 20', slug: 'wine-dinner', body_md: 'Five courses.', excerpt: '', hero_media_id: null, status: 'scheduled', published_at: new Date(Date.now() + 6 * DAY).toISOString(), tags: [], noindex: false, category: 'events', author: 'sam-ortiz', updated_at: '2026-11-10T17:00:00Z' },
      { id: id(13), title: 'Our autumn squash soup', slug: 'squash-soup', body_md: 'Roast the squash first.', excerpt: '', hero_media_id: null, status: 'draft', published_at: null, tags: [], noindex: false, category: '', author: 'maria-lopez', updated_at: '2026-11-10T17:00:00Z' },
    ],
    calls: [],
    settings: { blocks: [], section_meta: {}, pages: [], ...LISTS },
  };
  await installApp(page, { api: { ...PAGE_API, '/site': SITE } as never });
  await page.route(/\/__e2e_photo__\//, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.route('**/functions/v1/presence/**', async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname.replace(/^.*\/functions\/v1\/presence/, ''), m = req.method();
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const body = m === 'GET' ? null : (req.postDataJSON() as Record<string, unknown> | null);
    if (path === '/settings') {
      if (m === 'PUT') { w.calls.push({ method: m, path, body }); Object.assign(w.settings, body || {}); }
      // the server makes a new category's id from its name
      const cats = (w.settings.post_categories as Array<{ id?: string; name: string }> || []).map((c) => ({ id: c.id || c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: c.name }));
      const aus = (w.settings.post_authors as Array<{ id?: string; name: string }> || []).map((a) => ({ ...a, id: a.id || a.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') }));
      w.settings.post_categories = cats; w.settings.post_authors = aus;
      return json(200, { data: w.settings });
    }
    if (!path.startsWith('/posts')) return route.fallback();
    w.calls.push({ method: m, path, body });
    const pm = path.match(/^\/posts\/([0-9a-f-]{36})(?:\/(publish|unpublish|email-draft))?$/);
    if (path === '/posts' && m === 'GET') return json(200, { data: w.posts });
    if (path === '/posts' && m === 'POST') { const row = { id: id(99), excerpt: '', hero_media_id: null, published_at: null, tags: [], noindex: false, category: '', author: '', body_md: '', ...body, updated_at: new Date().toISOString() }; w.posts.unshift(row); return json(201, { data: row }); }
    if (pm && !pm[2] && m === 'PATCH') { const row = w.posts.find((p) => p.id === pm[1]); Object.assign(row || {}, body); return json(200, { data: row }); }
    if (pm && pm[2] === 'publish') { const row = w.posts.find((p) => p.id === pm[1])!; row.status = 'published'; row.published_at = row.published_at && row.status !== 'scheduled' ? row.published_at : new Date().toISOString(); return json(200, { data: { status: 'live', live: true, url: `https://marlows.example/updates/${row.slug}/` } }); }
    if (pm && pm[2] === 'unpublish') { const row = w.posts.find((p) => p.id === pm[1])!; row.status = 'draft'; return json(200, { data: { status: 'draft', live: false, message: 'It’s off your site and back in your drafts.' } }); }
    if (pm && m === 'DELETE') { w.posts = w.posts.filter((p) => p.id !== pm[1]); return json(200, { data: { ok: true } }); }
    return json(200, { data: {} });
  });
  await page.goto('/presence.html' + hash);
  await expect(page.locator('#view-updates')).toBeVisible();
  await expect(page.locator('.bl-card')).toHaveCount(3);
  return w;
}
const lastPatch = (w: World, postId: string) => [...w.calls].reverse().find((c) => c.method === 'PATCH' && c.path === `/posts/${postId}`);
const studio = (page: Page) => page.locator('.bs[role="dialog"]');
const isPhone = (page: Page) => page.viewportSize()!.width <= 900;
// A computer shows Post settings beside the post; a phone keeps it behind Settings.
async function settingsCard(page: Page) {
  await expect(page.locator('.bs-body')).toBeVisible();
  const card = page.locator('.bs-card');
  if (isPhone(page)) await page.locator('.bs-tools .bs-set').click();
  await expect(card).toBeVisible();
  return card;
}

// No page error, and no error message at any point (a message goes after five seconds, so
// each one is caught as it is shown).
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
  expect(await page.evaluate(() => (window as unknown as { __errToasts?: string[] }).__errToasts ?? [])).toEqual([]);   // [] on a test skipped before the page opened
});

test.describe('Blog: your posts', () => {
  test('every post is a card that says where it stands, its category and who wrote it', async ({ page }) => {
    await open(page);
    await expect(page.locator('#view-updates > h1.doc')).toHaveText('Blog');
    const [live, sched, draft] = [0, 1, 2].map((i) => page.locator('.bl-card').nth(i));
    await expect(live.locator('.bl-chip')).toHaveText('Live');
    await expect(live.locator('.bl-cat')).toHaveText('News');
    await expect(live.locator('.bl-meta')).toContainText('By Maria Lopez');
    await expect(sched.locator('.bl-chip')).toContainText('Goes out');
    await expect(sched.locator('.bl-act')).toHaveText('Change the time');
    await expect(draft.locator('.bl-chip')).toHaveText('Draft');
    await expect(draft.locator('.bl-act')).toHaveText('Keep writing');
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, 'the page must not scroll sideways').toBeLessThanOrEqual(1);
  });

  test('a live post’s card sends it to Send an update', async ({ page }) => {
    await open(page);
    await expect(page.locator('.bl-card').first().locator('a.bl-act')).toHaveAttribute('href', `/broadcasts.html?post=${id(11)}`);
  });

  test('the filters show only the posts asked for', async ({ page }) => {
    await open(page);
    await page.locator('.bl-pill', { hasText: 'Scheduled 1' }).click();
    await expect(page.locator('.bl-card')).toHaveCount(1);
    await expect(page.locator('.bl-card .bl-title')).toHaveText('Wine dinner on November 20');
    await page.locator('.bl-pill', { hasText: 'All 3' }).click();
    await page.locator('#blCat').selectOption('news');
    await expect(page.locator('.bl-card')).toHaveCount(1);
  });

  test('categories and authors are kept in one card, and a new category saves', async ({ page }) => {
    const w = await open(page);
    await page.locator('#btnBlogLists').click();
    const sheet = page.locator('#blogListsScrim');
    await expect(sheet).toHaveClass(/\bon\b/);
    await expect(sheet.locator('.bl-row')).toHaveCount(4);
    await expect(sheet).toContainText('Owner and head chef');
    await sheet.getByRole('button', { name: '+ New category' }).click();
    const ask = page.locator('dialog[open]');
    await ask.locator('input').fill('Recipes');
    await ask.getByRole('button', { name: 'Add it' }).click();
    await expect.poll(() => w.calls.filter((c) => c.path === '/settings' && c.method === 'PUT').length).toBe(1);
    const put = w.calls.find((c) => c.path === '/settings')!;
    expect((put.body!.post_categories as Array<{ name: string }>).map((c) => c.name)).toEqual(['News', 'Events', 'Recipes']);
    await expect(sheet.locator('.bl-row')).toHaveCount(5);
  });
});

test.describe('Blog: writing a post', () => {
  test('New post opens the writing screen, and the words save as you type', async ({ page }) => {
    const w = await open(page);
    await page.locator('#btnAddPost').click();
    await expect(studio(page)).toBeVisible();
    const made = w.calls.find((c) => c.method === 'POST' && c.path === '/posts')!;
    expect(made.body!.status).toBe('draft');
    await page.locator('.bs-title').fill('Holiday hours');
    await page.locator('.bs-body').click();
    await page.keyboard.type('We close early on the 24th.');
    await expect.poll(() => lastPatch(w, id(99))?.body?.body_md).toBe('We close early on the 24th.');
    expect(w.calls.some((c) => c.method === 'PATCH' && c.body?.title === 'Holiday hours')).toBe(true);
    await expect(page.locator('.bs-state')).toContainText('Draft');
    await page.keyboard.press('Escape');
    await expect(studio(page)).toHaveCount(0);
    await expect(page.locator('.bl-card').first().locator('.bl-title')).toHaveText('Holiday hours');
  });

  test('a heading and bold are kept as the post’s own markdown', async ({ page }) => {
    const w = await open(page);
    await page.locator('.bl-card').nth(2).locator('.bl-title button').click();
    await expect(studio(page)).toBeVisible();
    const tool = (name: string) => page.locator(isPhone(page) ? `.bs-tools button[aria-label="${name}"]` : `.bs-bar button[aria-label="${name}"]`);
    await page.locator('.bs-body').click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Method');
    await tool('Heading').click();
    await expect.poll(() => lastPatch(w, id(13))?.body?.body_md).toBe('Roast the squash first.\n\n## Method');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Serves four');
    for (let i = 0; i < 'Serves four'.length; i++) await page.keyboard.press('Shift+ArrowLeft');
    await tool('Bold').click();
    await expect.poll(() => lastPatch(w, id(13))?.body?.body_md).toBe('Roast the squash first.\n\n## Method\n\n**Serves four**');
  });

  test('a photo from Files goes into the text, with its description', async ({ page }) => {
    const w = await open(page);
    await page.locator('.bl-card').nth(2).locator('.bl-title button').click();
    await page.locator('.bs-body').click();
    await page.locator(isPhone(page) ? '.bs-tools button[aria-label="Add a photo from Files"]' : '.bs-bar .bs-photo').click();
    await expect(page.locator('#pickerScrim')).toHaveClass(/\bon\b/);
    await page.locator('#pickerGrid .mcell').first().click();
    await expect(page.locator('.bs-body .bs-fig')).toHaveCount(1);
    await expect.poll(() => lastPatch(w, id(13))?.body?.body_md).toContain(`![The room on a quiet night](media:${PHOTO})`);
    await page.locator('.bs-body .bs-fig img').click();
    await page.locator('.bs-figtools').getByRole('button', { name: 'Caption' }).click();
    const ask = page.locator('dialog[open]');
    await ask.locator('input').fill('Before the doors open');
    await ask.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => lastPatch(w, id(13))?.body?.body_md).toContain(`(media:${PHOTO} "Before the doors open")`);
  });

  test('Publish now puts this one post live and offers to email it', async ({ page }) => {
    const w = await open(page);
    await page.locator('.bl-card').nth(2).locator('.bl-title button').click();
    await page.locator('.bs-pub').click();
    await page.locator('.bs-menu').getByRole('menuitem', { name: /Publish now/ }).click();
    await expect.poll(() => w.calls.some((c) => c.method === 'POST' && c.path === `/posts/${id(13)}/publish`)).toBe(true);
    const done = page.locator('.bs-done');
    await expect(done).toContainText('Your post is live');
    await expect(done.getByRole('link', { name: 'Email it to your list' })).toHaveAttribute('href', `/broadcasts.html?post=${id(13)}`);
    await expect(page.locator('.bs-state')).toContainText('Live');
  });

  test('picking a day and time schedules it on the site’s clock', async ({ page }) => {
    const w = await open(page);
    await page.locator('.bl-card').nth(2).locator('.bl-title button').click();
    const card = await settingsCard(page);
    await card.getByRole('button', { name: 'Pick a day and time' }).click();
    const day = new Date(Date.now() + 3 * DAY).toISOString().slice(0, 10);
    await card.locator('#bsDay').fill(day);
    await card.locator('#bsTime').fill('09:00');
    if (isPhone(page)) await card.getByRole('button', { name: 'Done' }).click();
    await page.locator('.bs-pub').click();
    await page.locator('.bs-menu').getByRole('menuitem', { name: /Schedule for/ }).click();
    await expect.poll(() => lastPatch(w, id(13))?.body?.status).toBe('scheduled');
    const when = String(lastPatch(w, id(13))!.body!.published_at);
    const shown = new Date(when).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    expect(shown).toBe('09:00');   // 9:00 on the business's own clock, whatever the browser's
    await expect(page.locator('.bs-done')).toContainText('Scheduled');
    await expect(page.locator('.bs-state')).toContainText('Scheduled');
  });

  test('the category and author picked show on the post as it will look', async ({ page }) => {
    const w = await open(page);
    await page.locator('.bl-card').nth(2).locator('.bl-title button').click();
    const card = await settingsCard(page);
    await card.locator('#bsCat').selectOption('events');
    await expect(page.locator('.bs-kicker')).toHaveText('Events');
    await expect(page.locator('.bs-byline')).toContainText('By Maria Lopez');
    await expect.poll(() => lastPatch(w, id(13))?.body?.category).toBe('events');
  });

  test('on a phone the settings wait behind one button and the tools sit at the bottom', async ({ page }) => {
    test.skip(!isPhone(page), 'a computer shows the card beside the post');
    await open(page);
    await page.locator('.bl-card').nth(2).locator('.bl-title button').click();
    await expect(page.locator('.bs-card')).toBeHidden();
    await expect(page.locator('.bs-tools')).toBeVisible();
    await page.locator('.bs-tools .bs-set').click();
    await expect(page.locator('.bs-card')).toBeVisible();
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(1);
  });

  test('Preview shows the post alone, and one button brings the tools back', async ({ page }) => {
    await open(page);
    await page.locator('.bl-card').first().locator('.bl-title button').click();
    test.skip(isPhone(page), 'a phone hides Preview in the bar; the post already fills the screen');
    await page.locator('.bs-preview').click();
    await expect(page.locator('.bs-card')).toBeHidden();
    await expect(page.locator('.bs-body')).toHaveAttribute('contenteditable', 'false');
    await page.getByRole('button', { name: 'Back to writing' }).click();
    await expect(page.locator('.bs-body')).toHaveAttribute('contenteditable', 'true');
  });
});
