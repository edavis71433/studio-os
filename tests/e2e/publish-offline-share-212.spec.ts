import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES, answerAsks, askedSoFar } from './helpers/app';

// Builder item 212: the page half of tests/presence/publish_offline_share_test.mjs, for what no other
// spec drove (that suite lists the ones that do). Share a draft link… in the Page menu copies a fresh
// seven-day link to the draft as it is now; the publish page's "Also take the site offline later" sends
// a kind offline row after the publish, and refuses an offline time before it; a scheduled offline row
// is listed with its own Cancel; the Page menu takes the site offline after asking, and brings it back.
// Every write the page sends is answered here on purpose; anything else fails the test.
type Write = { method: string; path: string; body: any };
type Answer = (body: any) => { status?: number; json: unknown };
async function planWrites(page: Page, plan: Record<string, Answer>) {
  const writes: Write[] = [], unplanned: Write[] = [];
  await page.route('**/functions/v1/presence/**', (route: Route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fallback();
    const path = new URL(req.url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
    const w = { method: req.method(), path, body: req.postData() ? req.postDataJSON() : null };
    const answer = plan[`${w.method} ${path}`];
    if (!answer) { unplanned.push(w); return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'unplanned', message: `Not planned: ${w.method} ${path}` }) }); }
    writes.push(w);
    const a = answer(w.body);
    return route.fulfill({ status: a.status ?? 200, contentType: 'application/json', body: JSON.stringify(a.json) });
  });
  return { writes, unplanned };
}
const toast = (page: Page, text: string) => page.locator('.dds-toast, #toasts .toast').filter({ hasText: text });

// ── the publish page (as tests/e2e/schedule.spec.ts mounts it) ──
const CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: false, is_operator: false, sees_full_workspace: true,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'view_all'],
  landing: '/today.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null,
} };
const PUBLISH_API = {
  '/portal/context': CTX,
  '/site': { data: { site: { id: 's1', edition: 'presence', status: 'live', template_slug: 'business-classic', template_version: 1, last_published_at: '2026-11-08T12:00:00Z' }, identity: { business_name: 'Marlow’s Kitchen' }, location: {} } },
  '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] }, '/media': { data: [] }, '/settings': { data: {} }, '/notes': { data: [] },
  '/health': { data: { state: 'healthy', sentence: 'Your website is live and up to date.' } },
  '/changes': { data: { count: 2, first_publish: false, changes: [{ section: 'business', sentence: 'Saturday hours change.' }, { section: 'about', sentence: 'A new tagline.' }], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/dev/customization': { data: { theme_tokens: {}, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false, updated_at: null, updated_by: null } },
  '/schedule': { data: { scheduled: [] } }, '/content-library': { data: [] }, '/moments': { data: [] },
  '/commerce/first-run': { data: { dismissed: true } },
};
const scheduled = (body: any) => ({ json: { data: { ok: true, id: `sc-${body.kind}`, scheduled_for: body.scheduled_for, kind: body.kind, message: 'Scheduled.' } } });

test.describe('the optional "take the site offline later" leg of Publish later', () => {
  test('ticked, it schedules the publish, then a kind offline row a week after it', async ({ page }) => {
    await installApp(page, { api: PUBLISH_API });
    const { writes, unplanned } = await planWrites(page, { 'POST /schedule': scheduled });
    await page.goto('/presence.html#publish');
    const rit = page.locator('#ritualWrap');
    await expect(rit.getByLabel('Publish these changes at')).toBeVisible();
    await expect(rit.getByLabel('Take the site offline at')).toHaveCount(0);   // only once asked for
    await rit.getByLabel('Also take the site offline later (optional)').check();
    await expect(rit.getByLabel('Take the site offline at')).toBeVisible();
    await expect(rit).toContainText('Visitors will see a simple “temporarily offline” page from then on. Nothing is deleted — publishing brings everything back.');
    await rit.getByRole('button', { name: 'Schedule it' }).click();
    await expect(toast(page, 'Scheduled — it publishes, then comes down, on its own.')).toBeVisible();
    expect(writes.map((w) => [w.method, w.path, w.body.kind])).toEqual([['POST', '/schedule', 'publish'], ['POST', '/schedule', 'offline']]);
    expect(Object.keys(writes[1].body).sort()).toEqual(['kind', 'scheduled_for']);   // an offline row carries no note and no version
    const pub = Date.parse(writes[0].body.scheduled_for), off = Date.parse(writes[1].body.scheduled_for);
    expect(pub).toBeGreaterThan(Date.now());
    // the fields start a day ahead and eight days ahead, on the hour (an hour more if the clock struck between the two)
    expect(off - pub).toBeGreaterThanOrEqual(7 * 24 * 3600_000);
    expect(off - pub).toBeLessThanOrEqual(7 * 24 * 3600_000 + 3600_000);
    expect(unplanned).toEqual([]);
  });

  test('an offline time before the publish time is refused and nothing is sent; corrected, both go at the times picked', async ({ page }) => {
    await installApp(page, { api: PUBLISH_API });
    const { writes, unplanned } = await planWrites(page, { 'POST /schedule': scheduled });
    await page.goto('/presence.html#publish');
    const rit = page.locator('#ritualWrap');
    await rit.getByLabel('Also take the site offline later (optional)').check();
    await rit.getByLabel('Publish these changes at').fill('2030-05-10T09:00');
    await rit.getByLabel('Take the site offline at').fill('2030-05-09T09:00');
    await rit.getByRole('button', { name: 'Schedule it' }).click();
    await expect(toast(page, 'The offline time needs to be after the publish time.')).toBeVisible();
    await page.waitForTimeout(300);
    expect(writes).toEqual([]);
    await rit.getByLabel('Take the site offline at').fill('2030-05-12T18:00');
    await rit.getByRole('button', { name: 'Schedule it' }).click();
    await expect.poll(() => writes.length).toBe(2);
    expect(writes.map((w) => [w.body.kind, w.body.scheduled_for])).toEqual([['publish', '2030-05-10T09:00:00.000Z'], ['offline', '2030-05-12T18:00:00.000Z']]);
    expect(unplanned).toEqual([]);
  });

  test('ticked and then unticked, only the publish is scheduled', async ({ page }) => {
    await installApp(page, { api: PUBLISH_API });
    const { writes, unplanned } = await planWrites(page, { 'POST /schedule': scheduled });
    await page.goto('/presence.html#publish');
    const rit = page.locator('#ritualWrap');
    const leg = rit.getByLabel('Also take the site offline later (optional)');
    await leg.check();
    await leg.uncheck();
    await expect(rit.getByLabel('Take the site offline at')).toBeHidden();
    await rit.getByRole('button', { name: 'Schedule it' }).click();
    await expect(toast(page, 'Scheduled — it publishes on its own.')).toBeVisible();
    expect(writes.map((w) => w.body.kind)).toEqual(['publish']);
    expect(unplanned).toEqual([]);
  });

  test('a scheduled offline row is listed as taking the site offline, and its Cancel cancels that row', async ({ page }) => {
    const ROW = { id: 'sc-off-1', kind: 'offline', scheduled_for: '2026-12-24T18:00:00Z', summary: 'Scheduled to take the site offline' };
    await installApp(page, { api: { ...PUBLISH_API, '/schedule': { data: { scheduled: [ROW] } } } });
    const { writes, unplanned } = await planWrites(page, { 'POST /schedule/sc-off-1/cancel': () => ({ json: { data: { ok: true, message: 'Canceled.' } } }) });
    await page.goto('/presence.html#publish');
    const rit = page.locator('#ritualWrap');
    const row = rit.locator('div', { has: page.getByRole('button', { name: 'Cancel' }) }).filter({ hasText: 'Take the site offline' }).last();
    await expect(row).toContainText('Take the site offline · Dec 24, 2026');
    await expect(row).toContainText('Scheduled to take the site offline');
    await row.getByRole('button', { name: 'Cancel' }).click();
    await expect(toast(page, 'Canceled — nothing will happen at that time.')).toBeVisible();
    expect(writes.map((w) => [w.method, w.path])).toEqual([['POST', '/schedule/sc-off-1/cancel']]);
    expect(unplanned).toEqual([]);
  });
});

// ── the editor's Page menu (as tests/e2e/editor-comforts-158-two.spec.ts mounts it) ──
const BLOCKS = [{ type: 'title', title: 'Fresh bread', subtitle: 'Baked daily' }, { type: 'richtext', title: 'Our story', body: 'Hello' }];
const META = { blocks: [{ sid: 'title', key: 'block_title', src_index: 0 }, { sid: 'richtext', key: 'block_richtext', src_index: 1 }], pages: {} };
const HTML = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Draft</title><style>body{margin:0}section{padding:56px 24px;min-height:300px}</style></head><body>'
  + '<main id="main"><section class="hero" data-dds-core="hero"><h1>Marlow’s Kitchen</h1></section>'
  + '<section id="a" class="block block-title" data-dds-sid="title" data-dds-key="block_title" data-dds-src="0"><h2 data-dds-field="title">Fresh bread</h2><p data-dds-field="subtitle">Baked daily</p></section>'
  + '<section id="b" class="block block-richtext" data-dds-sid="richtext" data-dds-key="block_richtext" data-dds-src="1"><h2 data-dds-field="title">Our story</h2><p>Hello</p></section></main></body></html>';
const EDITOR_API = {
  '/portal/context': { data: { ...CTX.data, capabilities: ['edit', 'publish', 'invite', 'configure', 'delete', 'use_developer_mode', 'view_all'], landing: '/presence.html' } },
  '/site': { data: { site: { id: 's1', edition: 'presence', status: 'live', template_slug: 'business-classic', template_version: 1, last_published_at: '2026-11-08T12:00:00Z' }, identity: { business_name: 'Marlow’s Kitchen' }, location: {} } },
  '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] }, '/media': { data: [] }, '/health': { data: {} }, '/notes': { data: [] }, '/moments': { data: [] },
  '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/dev/customization': { data: { theme_tokens: {}, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false } },
  '/schedule': { data: { scheduled: [] } }, '/content-library': { data: [] }, '/redirects': { data: [] },
  '/settings': { data: { blocks: BLOCKS, section_meta: META } },
};
const LINK = 'https://app.example.com/draft.html?s=eyJzaXRlX2lkIjoiczEifQ.0123456789abcdef';
const STATUS = (offline: string | null) => ({ data: { draft: { unpublished_changes: 0 }, preview: { exists: false, url: null, updated_at: null, has_password: false }, live: { published: true, last_published_at: '2026-11-08T12:00:00Z', summary: null, offline_since: offline, password_since: null, coming_soon_since: null } } });
async function openEditor(page: Page, plan: Record<string, Answer>, status?: () => unknown) {
  await installApp(page, { api: EDITOR_API });
  const planned = await planWrites(page, plan);
  // the canvas draws the draft; Page menu reads the site's status (both GET)
  await page.route('**/functions/v1/presence/preview**', (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
    if (route.request().method() === 'GET' && path === '/preview') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML });
    if (route.request().method() === 'GET' && path === '/preview/status') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(status ? status() : STATUS(null)) });
    return route.fallback();
  });
  await page.addInitScript(() => {
    try { localStorage.setItem('dds-hints', JSON.stringify({ 'edit-tap': 1, 'edit-doubleclick': 1 })); } catch { /* storage may be denied */ }
    // the copy the page makes, kept where the test can read it (no clipboard permission needed)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => { (window as unknown as { __copied: string }).__copied = t; } } });
  });
  await page.goto('/presence.html#design');
  await expect(page.locator('html')).toHaveClass(/dc-edit/);
  await page.waitForLoadState('networkidle');
  return planned;
}
// the Page menu lives in the pages card; a second visit finds the card still open
async function pageMenu(page: Page) {
  if (!(await page.locator('#btnPageInfo').isVisible())) await page.locator('#dcPageSwitch').click();
  await page.locator('#btnPageInfo').click();
  await expect(page.locator('#piShareDraft')).toBeVisible();
}

test.describe('Share a draft link… in the Page menu', () => {
  test('it captures the draft as it is now into a seven-day link, and copies it', async ({ page }) => {
    const { writes, unplanned } = await openEditor(page, {
      'POST /preview/share-link': () => ({ json: { data: { ok: true, url: LINK, expires_at: '2026-11-22T12:00:00Z', ttl_seconds: 604800 } } }),
    });
    await pageMenu(page);
    await page.locator('#piShareDraft').click();
    await expect(toast(page, 'Draft link copied — read-only, works until Nov 22. Text it to anyone.')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __copied?: string }).__copied)).toBe(LINK);
    expect(writes).toEqual([{ method: 'POST', path: '/preview/share-link', body: { capture: true, ttl_seconds: 604800 } }]);
    expect(unplanned).toEqual([]);
  });

  test('a link that can’t be made says why, and nothing is copied', async ({ page }) => {
    const { writes, unplanned } = await openEditor(page, {
      'POST /preview/share-link': () => ({ status: 503, json: { error: 'unavailable', message: 'Shareable preview links aren’t configured yet.' } }),
    });
    await pageMenu(page);
    await page.locator('#piShareDraft').click();
    await expect(toast(page, 'Shareable preview links aren’t configured yet.')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __copied?: string }).__copied ?? null)).toBeNull();
    expect(writes.map((w) => w.path)).toEqual(['/preview/share-link']);
    expect(unplanned).toEqual([]);
  });
});

test.describe('Take site offline… and Bring back online in the Page menu', () => {
  test('it asks first and says nothing is deleted, sends POST /site/offline, and then offers Bring back online, which sends POST /site/online', async ({ page }) => {
    let offline: string | null = null;
    const { writes, unplanned } = await openEditor(page, {
      'POST /site/offline': () => { offline = '2026-11-15T12:00:00Z'; return { json: { data: { ok: true, offline: true } } }; },
      'POST /site/online': () => { offline = null; return { json: { data: { status: 'live' } } }; },
    }, () => STATUS(offline));
    await answerAsks(page);
    await pageMenu(page);
    const off = page.locator('#piOffline');
    await expect(off).toHaveText('Take site offline…');
    await off.click();
    await expect(toast(page, 'Your site is offline. Publish, or use “Bring back online”, to return.')).toBeVisible();
    const asked = (await askedSoFar(page)).join('\n');
    expect(asked).toContain('Take Marlow’s Kitchen OFFLINE now?');
    expect(asked).toContain('Nothing is deleted');
    await pageMenu(page);
    await expect(page.locator('#piOffline')).toHaveText('Bring back online');
    await page.locator('#piOffline').click();
    await expect(toast(page, 'Bringing your site back — this usually takes under a minute')).toBeVisible();
    expect(writes.map((w) => [w.method, w.path])).toEqual([['POST', '/site/offline'], ['POST', '/site/online']]);
    expect((await askedSoFar(page)).length).toBe(1);   // bringing it back asks nothing
    expect(unplanned).toEqual([]);
  });

  test('saying no sends nothing, and the site stays online', async ({ page }) => {
    const { writes, unplanned } = await openEditor(page, {});
    await answerAsks(page, false);
    await pageMenu(page);
    await page.locator('#piOffline').click();
    await expect.poll(async () => (await askedSoFar(page)).length).toBe(1);
    await page.waitForTimeout(300);
    expect(writes).toEqual([]);
    expect(unplanned).toEqual([]);
  });
});
