import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';
import { applyMotion } from '../../supabase/functions/presence/lib/site_motion';

// Builder list item 158 (Nov 2026), the parts that needed no drawing: a star on the versions
// that matter, and the list showing All, Published or Starred; a gentle "appear on scroll" in
// Styles › Looks, and what a visitor sees with it; the site's own small icon (Styles › Looks,
// the photo picker, Files); and everything that sits on every page, in one place on the
// Pages card. tests/presence/editor_comforts_158_test.mjs covers the server.
const PHOTO = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="#c9a77c"/></svg>');
const BLOCKS = [{ type: 'title', title: 'Fresh bread, every morning', subtitle: 'Baked in Burbank' }];
const META = { blocks: [{ sid: 'title', key: 'block_title', src_index: 0 }], pages: {} };
const HTML = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}header.site{background:#fff;padding:18px 24px}section{padding:48px 24px;min-height:420px}footer.site{background:#201b17;color:#fff;padding:40px 24px}</style></head><body>'
  + '<header class="site"><a class="brand" href="/">Marlow’s Kitchen</a></header>'
  + '<main id="main"><section class="hero" data-dds-core="hero"><h1>Marlow’s Kitchen</h1></section>'
  + '<section id="a" data-dds-sid="title" data-dds-key="block_title" data-dds-src="0" class="block"><h2 data-dds-field="title">Fresh bread, every morning</h2></section></main>'
  + '<footer class="site"><p>12 Olive Ave, Burbank</p></footer></body></html>';
const SITE = { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1, netlify_site_id: 'n1' };
const CTX = { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES, is_agency: false, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish', 'invite', 'configure', 'delete', 'use_developer_mode', 'view_all'], landing: '/presence.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null } };
const pub = (i: number, day: number) => ({ id: 'p' + i, kind: 'publish', status: 'live', summary: 'Version ' + i, label: '', at: new Date(Date.UTC(2026, 10, day, 15)).toISOString(), restorable: true });
const API = {
  '/site': { data: { site: SITE, identity: { business_name: 'Marlow’s Kitchen' }, location: {} } },
  '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] }, '/health': { data: {} }, '/notes': { data: [] }, '/moments': { data: [] },
  '/media': { data: [{ id: 'm1', thumb: PHOTO, alt_text: 'A round loaf on the counter', created_at: '2026-11-01T00:00:00Z', used_by: [] }] },
  '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/schedule': { data: { scheduled: [] } }, '/content-library': { data: [] }, '/redirects': { data: [] },
  '/publishes/checkpoints': { data: [{ id: 'cp1', name: 'Before the spring menu', at: new Date(Date.UTC(2026, 10, 9, 15)).toISOString() }] },
  '/launches': { data: [] },
  '/preview/status': { data: { draft: { unpublished_changes: 0 }, preview: { exists: false }, live: { published: true, last_published_at: '2026-11-10T15:00:00Z' } } },
  '/portal/context': CTX,
};
type Write = { method: string; path: string; body: any };
type Opts = { settings?: Record<string, unknown>; tokens?: Record<string, string>; stars?: string[] };
const json = (route: Route, data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
// The app on `url`, with these settings, styles and stars to start with; each write lands, and
// the stars, styles and settings answer as the server does.
async function mount(page: Page, url: string, opts: Opts = {}) {
  let settings: Record<string, unknown> = { blocks: BLOCKS, section_meta: META, ...(opts.settings || {}) };
  let tokens: Record<string, string> = { ...(opts.tokens || {}) };
  let stars = [...(opts.stars || [])];
  await installApp(page, { api: { ...API,
    '/settings': { data: settings },
    '/dev/customization': { data: { theme_tokens: tokens, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false } },
    '/publishes': { data: [pub(0, 10), pub(1, 8)], stars },
  } });
  const writes: Write[] = [];
  await page.route('**/functions/v1/presence/**', (route: Route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fallback();
    const path = new URL(req.url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
    const body = req.postData() ? req.postDataJSON() : null;
    writes.push({ method: req.method(), path, body });
    if (path === '/publishes/stars') {
      stars = body.starred ? [body.id, ...stars.filter((x) => x !== body.id)] : stars.filter((x) => x !== body.id);
      return json(route, { id: body.id, starred: body.starred, stars });
    }
    if (path === '/dev/customization') { tokens = body.theme_tokens || {}; return json(route, { ...body, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false }); }
    if (path === '/settings') { settings = { ...settings, ...body }; return json(route, settings); }
    return json(route, body || {});
  });
  await page.route('**/functions/v1/presence/preview**', (route: Route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML }));
  await page.addInitScript(() => { try { localStorage.setItem('dds-hints', JSON.stringify({ 'edit-tap': 1, 'edit-doubleclick': 1 })); } catch { /* storage may be denied */ } });
  await page.goto(url);
  return { writes };
}
async function editor(page: Page, opts: Opts = {}) {
  const m = await mount(page, '/presence.html#design', opts);
  await expect(page.locator('html')).toHaveClass(/dc-edit/);
  await expect(page.frameLocator('#designPreview').locator('#dds-dc-bar')).toBeAttached();
  return m;
}
const lastTokens = (m: { writes: Write[] }) => m.writes.filter((w) => w.path === '/dev/customization').at(-1)?.body?.theme_tokens;

test.describe('Versions: a star on the ones that matter (builder item 158)', () => {
  const rows = (page: Page) => page.locator('#pubList .hentry');
  const show = (page: Page) => page.getByRole('group', { name: 'Show versions' });

  test('any kept version can be starred, and Starred shows only those', async ({ page }) => {
    const m = await mount(page, '/presence.html#history', { stars: ['cp1'] });
    await expect(rows(page)).toHaveCount(3);
    await expect(show(page).getByRole('button')).toHaveText(['All', 'Published', 'Starred (1)']);
    await expect(show(page).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    // the saved checkpoint is starred already; the newest publish isn't
    await expect(rows(page).nth(1).locator('.ver-star')).toHaveText('★ Starred');
    await expect(rows(page).nth(1).locator('.ver-star')).toHaveAttribute('aria-pressed', 'true');
    await expect(rows(page).nth(0).locator('.ver-star')).toHaveText('☆ Star');
    await rows(page).nth(0).locator('.ver-star').click();
    await expect.poll(() => m.writes.find((w) => w.path === '/publishes/stars')?.body).toEqual({ id: 'p0', starred: true });
    await expect(rows(page).nth(0).locator('.ver-star')).toHaveAttribute('aria-pressed', 'true');
    await expect(rows(page).nth(0).locator('.ver-star')).toBeFocused();   // the list redraws; the press keeps its place
    await show(page).getByRole('button', { name: 'Starred (2)' }).click();
    await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).nth(0)).toContainText('Version 0');
    await expect(rows(page).nth(1)).toContainText('“Before the spring menu”');
    await expect(show(page).getByRole('button', { name: 'Starred (2)' })).toBeFocused();
    await show(page).getByRole('button', { name: 'Published' }).click();
    await expect(rows(page)).toHaveCount(2);
    await expect(page.locator('#pubList .ver-saved')).toHaveCount(0);
    await show(page).getByRole('button', { name: 'All' }).click();
    await expect(rows(page)).toHaveCount(3);
    // every press stays on the screen, a phone's too
    const w = page.viewportSize()!.width;
    for (const b of await page.locator('#pubList .hacts button, #pubList .ver-show button').all()) { const r = (await b.boundingBox())!; expect(r.x + r.width).toBeLessThanOrEqual(w + 0.5); }
  });

  test('a star taken off; with none starred, Starred says what it’s for', async ({ page }) => {
    const m = await mount(page, '/presence.html#history', { stars: ['p1'] });
    await show(page).getByRole('button', { name: 'Starred (1)' }).click();
    await expect(rows(page)).toHaveCount(1);
    await rows(page).first().locator('.ver-star').click();
    await expect.poll(() => m.writes.find((w) => w.path === '/publishes/stars')?.body).toEqual({ id: 'p1', starred: false });
    await expect(rows(page)).toHaveCount(0);
    await expect(page.locator('#pubList')).toContainText('No starred versions yet. Star the ones you’ll want again');
    const starred = show(page).getByRole('button', { name: 'Starred (0)' });
    await expect(starred).toHaveAttribute('aria-pressed', 'true');
    await expect(starred).toBeFocused();   // the row it was on is gone, so the filter keeps it
  });
});

test.describe('Styles › Looks: gentle motion and the site icon (builder item 158)', () => {
  async function looks(page: Page, opts: Opts = {}) {
    const m = await editor(page, opts);
    await page.locator('#btnSettingsOpen').click();
    await page.locator('#stylesSeg [data-stab="looks"]').click();
    await expect(page.locator('#siteIconRow')).toBeVisible();
    return m;
  }

  test('Still or Gentle motion, saying what it does; Still takes the setting away', async ({ page }) => {
    const m = await looks(page);
    const card = page.locator('#designCard');
    await expect(card.getByRole('button', { name: 'Still ✓' })).toBeVisible();
    await expect(card).toContainText('Gentle motion fades each section up as visitors scroll to it. Anyone whose device asks for less motion sees it still, and nothing waits to show.');
    await card.getByRole('button', { name: 'Gentle motion', exact: true }).click();
    await expect.poll(() => lastTokens(m)).toEqual({ motion: 'gentle' });
    await expect(page.locator('#designCard').getByRole('button', { name: 'Gentle motion ✓' })).toBeVisible();
    await page.locator('#designCard').getByRole('button', { name: 'Still', exact: true }).click();
    await expect.poll(() => lastTokens(m)).toEqual({});
  });

  test('the site icon: the letter until a picture is picked, then the picture, and the letter one press away', async ({ page }) => {
    const m = await looks(page);
    const row = page.locator('#siteIconRow');
    const tab = row.getByRole('img', { name: /^How your site shows in a browser tab/ });
    await expect(tab).toHaveAttribute('aria-label', 'How your site shows in a browser tab: the letter M and Marlow’s Kitchen');
    await expect(row.locator('.si-letter')).toHaveText('M');
    await row.getByRole('button', { name: 'Choose a picture' }).click();
    await expect(page.locator('#pickerScrim')).toHaveClass(/\bon\b/);
    await page.locator('#pickerGrid .mcell').first().click();
    await expect.poll(() => m.writes.find((w) => w.path === '/settings' && w.body && 'icon_media_id' in w.body)?.body.icon_media_id).toBe('m1');
    await expect(row.locator('.si-tab img')).toHaveAttribute('src', PHOTO);
    await expect(tab).toHaveAttribute('aria-label', 'How your site shows in a browser tab: your picture and Marlow’s Kitchen');
    await expect(row.getByRole('button', { name: 'Choose another picture' })).toBeVisible();
    await row.getByRole('button', { name: 'Use the letter' }).click();
    await expect.poll(() => m.writes.filter((w) => w.path === '/settings').at(-1)?.body.icon_media_id).toBe(null);
    await expect(row.locator('.si-letter')).toHaveText('M');
    await expect(row.getByRole('button', { name: 'Use the letter' })).toHaveCount(0);
  });
});

test.describe('the Pages card: everything on every page, in one place (builder item 158)', () => {
  const card = (page: Page) => page.locator('#pagesCard');
  async function openCard(page: Page, opts: Opts = {}) {
    const m = await editor(page, opts);
    await page.locator('#dcPageSwitch').click();
    await expect(card(page)).toHaveClass(/\bon\b/);
    return m;
  }

  test('the row says what is on; its pane gives each one On or Off, and the phone bar’s choice right there', async ({ page }) => {
    const m = await openCard(page, { settings: { announcement_text: 'Closed Monday for the holiday', popup: { on: true, heading: 'Ten percent off on Tuesdays' } }, tokens: { phone_bar: 'light' } });
    await expect(card(page).locator('#pcEverySub')).toHaveText('On now: announcement bar, pop-up, phone bar');
    await card(page).locator('#pcEvery').click();
    const pane = card(page).locator('#pcEveryPane');
    await expect(pane.getByRole('heading', { name: 'On every page' })).toBeVisible();
    await expect(pane.locator('#pcEveryAnn .pc-every-st')).toHaveText('On');
    await expect(pane.locator('#pcEveryAnn')).toContainText('“Closed Monday for the holiday”');
    await expect(pane.locator('#pcEveryPop .pc-every-st')).toHaveText('On');
    await expect(pane.locator('#pcEveryPb .pc-every-st')).toHaveText('On');
    await expect(pane.locator('#pbSeg button[aria-pressed="true"]')).toHaveText('Light');
    await expect(pane.locator('#pcEveryCookie')).toHaveCount(0);   // no ad tags, so no cookie notice
    await pane.locator('#pbSeg').getByRole('button', { name: 'Off' }).click();
    await expect.poll(() => lastTokens(m)).toEqual({});
    await expect(pane.locator('#pcEveryPb .pc-every-st')).toHaveText('Off');
    await card(page).locator('#pcBack').click();
    await expect(card(page).locator('#pcEverySub')).toHaveText('On now: announcement bar, pop-up');
  });

  test('with nothing on, the row says so; each line says how to start, and Header and footer opens its own pane', async ({ page }) => {
    await openCard(page);
    await expect(card(page).locator('#pcEverySub')).toHaveText('Announcement bar, pop-up, phone bar: all off');
    await card(page).locator('#pcEvery').click();
    const pane = card(page).locator('#pcEveryPane');
    await expect(pane.locator('#pcEveryAnn .pc-every-st')).toHaveText('Off');
    await expect(pane.locator('#pcEveryAnn').getByRole('button', { name: 'Add one' })).toBeVisible();
    await expect(pane.locator('#pcEveryPop').getByRole('button', { name: 'Set one up' })).toBeVisible();
    await expect(pane.locator('#pcEveryPb .pc-every-st')).toHaveText('Off');
    await pane.locator('#pcEveryHF').getByRole('button', { name: 'Open' }).click();
    await expect(card(page).locator('#pcHeadFootPane').getByRole('heading', { name: 'Header and footer' })).toBeVisible();
  });

  test('ad tags on: the cookie notice is listed; the announcement leads to its own card in Updates', async ({ page }) => {
    await openCard(page, { settings: { google_tag_id: 'G-TEST1234', announcement_text: 'Closed Monday for the holiday' } });
    await expect(card(page).locator('#pcEverySub')).toHaveText('On now: announcement bar, cookie notice');
    await card(page).locator('#pcEvery').click();
    const pane = card(page).locator('#pcEveryPane');
    await expect(pane.locator('#pcEveryCookie .pc-every-st')).toHaveText('On');
    await expect(pane.locator('#pcEveryCookie').getByRole('button', { name: 'Open ad tags' })).toBeVisible();
    await pane.locator('#pcEveryAnn').getByRole('button', { name: 'Change it' }).click();
    await expect(page.locator('html')).not.toHaveClass(/dc-edit/);
    await expect(page.locator('#annCard')).toBeVisible();
    await expect(page.locator('#annCard')).toBeInViewport();
  });
});

test.describe('a visitor’s page with Gentle motion (builder item 158)', () => {
  const PAGE = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Marlow’s Kitchen</title><style>body{margin:0}section{min-height:700px;padding:40px}</style></head><body>'
    + '<main><section id="s1"><h1>Marlow’s Kitchen</h1></section><section id="s2"><h2>Our bread</h2></section><section id="s3"><h2>Visit us</h2></section><section id="s4"><h2>Hours</h2></section></main></body></html>';
  const drawn = () => applyMotion({ 'index.html': PAGE }, 'gentle')['index.html'] as string;
  const opacity = (page: Page, id: string) => page.locator('#' + id).evaluate((n) => getComputedStyle(n).opacity);

  test('what’s on screen shows at once; a section below fades up as it scrolls in', async ({ page }) => {
    await page.setContent(drawn());
    // the first section never waits, and nothing already on screen is hidden
    const marks = await page.locator('main > section').evaluateAll((ns) => ns.map((n) => ({ rise: n.classList.contains('dds-rise'), top: n.getBoundingClientRect().top, h: innerHeight })));
    expect(marks[0].rise).toBe(false);
    for (const x of marks) expect(x.rise).toBe(x.top >= x.h);
    await expect(page.locator('#s3')).toHaveClass(/dds-rise/);
    expect(await opacity(page, 's3')).toBe('0');
    await page.locator('#s3').scrollIntoViewIfNeeded();
    await expect(page.locator('#s3')).toHaveClass(/dds-up/);
    await expect.poll(() => opacity(page, 's3')).toBe('1');
  });

  test('a visitor whose device asks for less motion sees every section, still', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setContent(drawn());
    await expect(page.locator('main > section.dds-rise')).toHaveCount(0);
    expect(await opacity(page, 's4')).toBe('1');
  });
});

test.describe('Files: Use as site icon (builder item 158)', () => {
  const ASSET = { id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', name: 'Round loaf', kind: 'image', mime: 'image/png', in_use: false, favorite: false, alt_text: 'A round loaf', tags: [], collection: '', asset_status: 'approved', state: 'approved', bytes: 17000, created_at: '2026-08-10T00:00:00Z', thumb: PHOTO };
  const filesApi = (isIcon: boolean) => ({
    '/assets/collections': { data: [] }, '/assets/health': { data: { findings: [] } },
    '/assets': { data: { assets: [ASSET], total: 1, shown: 1, live_count: 0, policy: 'immediate' } },
    ['/assets/' + ASSET.id]: { data: { asset: ASSET, usage: [], versions: { has_history: false }, summary: { headline: '' }, thumb_fallback: PHOTO, download_url: PHOTO } },
    ['/assets/' + ASSET.id + '/social']: { data: { crops: [], fallback_url: PHOTO, focal: '50% 50%', is_share_image: false, is_site_icon: isIcon } },
    ['/assets/' + ASSET.id + '/cards']: { data: { cards: [] } },
  });
  async function openPhoto(page: Page, isIcon: boolean) {
    await installApp(page, { api: filesApi(isIcon) });
    const puts: unknown[] = [];
    await page.route('**/functions/v1/presence/settings', (route: Route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      puts.push(route.request().postDataJSON());
      return json(route, {});
    });
    await page.goto('/files.html');
    await page.getByText('Round loaf').first().click();
    const slot = page.locator('#social-slot');
    await expect(slot.locator('.tabpv')).toBeVisible();
    return { slot, puts };
  }

  test('a photo’s details show it in a browser tab, and one press makes it the site icon', async ({ page }) => {
    const { slot, puts } = await openPhoto(page, false);
    expect(await slot.locator('.tabpv .tabic').evaluate((n) => (n as HTMLElement).style.backgroundImage)).toContain(PHOTO.slice(0, 40));
    await expect(slot.locator('img')).toHaveCount(0);   // a background, so a picture that can't load leaves no broken glyph
    await expect(slot.locator('.tabpv')).toContainText('Your website');
    await slot.getByRole('button', { name: 'Use as site icon' }).click();
    await expect.poll(() => puts).toEqual([{ icon_media_id: ASSET.id }]);
    await expect(slot.getByRole('button', { name: '✓ This is your site icon' })).toBeVisible();
    await expect(page.getByText('Set as your site icon — publish to apply')).toBeVisible();
  });

  test('the site icon already: it says so, and a press saves nothing', async ({ page }) => {
    const { slot, puts } = await openPhoto(page, true);
    await slot.getByRole('button', { name: '✓ This is your site icon' }).click();
    await expect(page.getByText('Already your site icon')).toBeVisible();
    expect(puts).toEqual([]);
  });
});
