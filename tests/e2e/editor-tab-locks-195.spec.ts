import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// Builder item 195 (Nov 12 review, file 06, findings 27 to 29): the editor answers the Tab key;
// Clear the page and a starter layout stop at a section the studio locked, and a save the server
// refuses for a locked section puts the page back as it was saved; the studio is offered Lock only
// where the server takes it from them (inside a client, or platform staff), and "Locked" is said
// once the save has landed.
const LOCK = { id: 'lk-0123456789', words: true };
const BLOCKS = (lock: unknown = null) => [
  { type: 'title', title: 'Fresh bread', subtitle: 'Baked daily', ...(lock ? { lock } : {}) },
  { type: 'richtext', title: 'Our story', body: 'Hello' },
];
const META = { blocks: [{ sid: 'title', key: 'block_title', src_index: 0 }, { sid: 'richtext', key: 'block_richtext', src_index: 1 }], pages: {} };
const HTML = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}section{padding:56px 24px;min-height:360px}</style></head><body>'
  + '<main id="main"><section class="hero" data-dds-core="hero"><h1>Marlow’s Kitchen</h1></section>'
  + '<section id="a" class="block block-title" data-dds-sid="title" data-dds-key="block_title" data-dds-src="0"><h2 data-dds-field="title">Fresh bread</h2><p data-dds-field="subtitle">Baked daily</p></section>'
  + '<section id="b" class="block block-richtext" data-dds-sid="richtext" data-dds-key="block_richtext" data-dds-src="1"><h2 data-dds-field="title">Our story</h2><p>Hello</p></section></main></body></html>';
const SITE = { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1 };
type Who = 'client' | 'studio-in-client' | 'studio-own-site';
const ctx = (who: Who) => ({ data: {
  site_role: who === 'client' ? 'business_owner' : 'agency_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: who !== 'client', is_operator: false, scope: who === 'studio-in-client' ? { site_id: 's1', name: 'Marlow’s Kitchen' } : null,
  sees_full_workspace: true, capabilities: ['edit', 'publish', 'invite', 'configure', 'delete', 'use_developer_mode', 'view_all'], landing: '/presence.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null,
} });
const API = {
  '/site': { data: { site: SITE, identity: { business_name: 'Marlow’s Kitchen' }, location: {} } },
  '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] }, '/media': { data: [] }, '/health': { data: {} }, '/notes': { data: [] }, '/moments': { data: [] },
  '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/dev/customization': { data: { theme_tokens: {}, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false } },
  '/schedule': { data: { scheduled: [] } }, '/content-library': { data: [] }, '/redirects': { data: [] },
};
type Put = { blocks?: Array<Record<string, any>> };
const REFUSED = (message: string) => ({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'section_locked', message, sections: [] }) });
// `refuse` answers a save the way the server's lock rule does, or lets it through (null)
async function mount(page: Page, { who, lock, refuse }: { who: Who; lock?: unknown; refuse?: (body: Put) => string | null }) {
  let settings: Record<string, unknown> = { blocks: BLOCKS(lock), section_meta: META };
  await installApp(page, { api: { ...API, '/portal/context': ctx(who), '/settings': { data: settings } } });
  const puts: Put[] = [], refused: Put[] = [];
  await page.route('**/functions/v1/presence/**', (route: Route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fallback();
    const path = new URL(req.url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
    const body = req.postData() ? req.postDataJSON() : null;
    if (path === '/settings') {
      const no = refuse ? refuse(body) : null;
      if (no) { refused.push(body); return route.fulfill(REFUSED(no)); }
      puts.push(body); settings = { ...settings, ...body };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: settings }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: body || {} }) });
  });
  let draws = 0;
  await page.route('**/functions/v1/presence/preview**', (route: Route) => { draws++; return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML }); });
  await page.addInitScript(() => { try { localStorage.setItem('dds-hints', JSON.stringify({ 'edit-tap': 1, 'edit-doubleclick': 1 })); } catch { /* storage may be denied */ } });
  await page.goto(who === 'studio-in-client' ? '/presence.html?client=s1#design' : '/presence.html#design');
  await expect(page.locator('html')).toHaveClass(/dc-edit/);
  const frame = page.frameLocator('#designPreview');
  await expect(frame.locator('#dds-dc-bar')).toBeAttached();
  await page.waitForLoadState('networkidle');   // Edit's own redraw (item 85) has landed
  await expect(frame.locator('#dds-dc-bar')).toBeAttached();
  const redrawn = async (before: number) => {
    await expect.poll(() => draws).toBeGreaterThan(before);
    await expect(frame.locator('#dds-dc-bar')).toBeAttached();
    await page.waitForTimeout(300);
  };
  return { frame, puts, refused, draws: () => draws, redrawn, lastBlocks: () => (puts.filter((p) => p && Array.isArray(p.blocks)).at(-1) || {}).blocks };
}
async function pick(page: Page, frame: ReturnType<Page['frameLocator']>, sel: string) {
  const phone = (page.viewportSize()?.width || 1200) < 768;
  const sec = frame.locator(sel);
  if (phone) await sec.tap({ position: { x: 40, y: 20 } }); else await sec.locator('h2').hover();
  await expect(frame.locator('#dds-dc-bar')).toHaveClass(/\bon\b/);
}
const working = (page: Page) => page.evaluate(() => (0, eval)('JSON.stringify(BLOCKS_WORK.map((b) => b.title))') as string).then((s) => JSON.parse(s));
// what has the keyboard, in words, and whether a person could see it
const focused = (page: Page) => page.evaluate(() => {
  const a = document.activeElement as HTMLElement | null;
  if (!a || a === document.body || a === document.documentElement) return { name: 'body', seen: false };
  const shown = a.getClientRects().length > 0 && getComputedStyle(a).visibility !== 'hidden' && !a.closest('[aria-hidden="true"]:not(iframe)');
  return { name: (a.id || a.getAttribute('aria-label') || a.textContent || a.tagName).trim().replace(/\s+/g, ' ').slice(0, 40), seen: shown };
});

// Safari's Tab visits only form fields unless Option is held (or its setting is on), so on WebKit
// the key pressed is Option+Tab, which is how a Safari user moves through buttons.
const tab = (page: Page, browser: string, back = false) => page.keyboard.press((browser === 'webkit' ? 'Alt+' : '') + (back ? 'Shift+' : '') + 'Tab');

test.describe('the Tab key (item 195, finding 27)', () => {
  test('Tab moves through the editor, every stop one a person can see, and Shift+Tab goes back', async ({ page, browserName }) => {
    await mount(page, { who: 'client' });
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const stops: Array<{ name: string; seen: boolean }> = [];
    for (let i = 0; i < 6; i++) { await tab(page, browserName); stops.push(await focused(page)); }
    expect(stops.map((s) => s.name)).not.toContain('body');
    for (const s of stops) expect(s.seen, `"${s.name}" can be seen`).toBe(true);
    expect(new Set(stops.map((s) => s.name)).size).toBeGreaterThanOrEqual(4);   // it moves, not stuck on one
    await tab(page, browserName, true);
    expect((await focused(page)).name).toBe(stops[4].name);
  });

  test('a card that really holds the keyboard keeps Tab inside it until it closes', async ({ page, browserName }) => {
    await mount(page, { who: 'client' });
    await page.evaluate(() => (0, eval)('openSettingsPanel("styles")'));
    await expect(page.locator('#settingsPanel')).toHaveClass(/\bon\b/);
    await expect(page.locator('#btnSettingsClose')).toBeFocused();   // the panel moves the cursor in after 40ms
    for (let i = 0; i < 12; i++) {
      await tab(page, browserName);
      expect(await page.evaluate(() => !!document.activeElement?.closest('#settingsPanel'))).toBe(true);
    }
  });
});

test.describe('a locked section on the page (item 195, finding 28)', () => {
  test('Clear the page stops at it and says why; nothing is saved', async ({ page }) => {
    const { puts } = await mount(page, { who: 'client', lock: LOCK });
    await page.evaluate(() => { (0, eval)('dcClearPage("")'); });   // not waited on: the old page asked first, and that question would hold the test
    await expect(page.getByText('Your studio locked a section on this page so it can’t be cleared. Ask them if it needs to change.')).toBeVisible();
    await expect(page.locator('dialog[open]')).toHaveCount(0);   // never asked: there's nothing to say yes to
    await page.waitForTimeout(900);
    expect(puts).toEqual([]);
    expect(await working(page)).toEqual(['Fresh bread', 'Our story']);
  });

  test('a starter layout stops at it too', async ({ page }) => {
    const { puts } = await mount(page, { who: 'client', lock: LOCK });
    await page.evaluate(() => { (0, eval)('applyStarterLayout({ name: "Bakery", blocks: [{ type: "title", title: "A new start" }] })'); });
    await expect(page.getByText('Your studio locked a section on this page so a layout can’t replace its sections. Ask them if it needs to change.')).toBeVisible();
    await page.waitForTimeout(900);
    expect(puts).toEqual([]);
    expect(await working(page)).toEqual(['Fresh bread', 'Our story']);
  });

  test('a save the server refuses for a locked section puts the page back, so the next edit saves', async ({ page }) => {
    // the studio locked “Our story” in another window a moment ago: deleting it is refused once
    let once = true;
    const { frame, puts, refused, redrawn, draws, lastBlocks } = await mount(page, { who: 'client', refuse: (b) => {
      if (!once || !Array.isArray(b?.blocks) || b.blocks.some((x) => x.title === 'Our story')) return null;
      once = false; return 'Your studio locked “Our story” so it stays as designed. Ask them if it needs to change. Nothing was changed.';
    } });
    await pick(page, frame, '#b');
    await frame.locator('#dds-dc-bar .dc-b', { hasText: 'Delete' }).click();
    const before = draws();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect.poll(() => refused.length).toBe(1);
    await expect(page.getByText('Your studio locked “Our story” so it stays as designed.')).toBeVisible();
    await expect.poll(() => working(page)).toEqual(['Fresh bread', 'Our story']);   // back as it was saved
    await redrawn(before);
    await expect(frame.locator('#b h2')).toHaveText('Our story');
    // the next edit carries the page as saved, and lands
    await pick(page, frame, '#a');
    await frame.locator('#dds-dc-bar .dc-b', { hasText: 'Duplicate' }).click();
    await expect.poll(() => (lastBlocks() || []).map((b) => b.title)).toEqual(['Fresh bread', 'Fresh bread', 'Our story']);
    expect(puts.length).toBe(1);
  });
});

test.describe('who may lock a section (item 195, finding 29)', () => {
  test('the studio on its own site isn’t offered Lock: there it is the owner, and the save would be refused', async ({ page }) => {
    const { frame } = await mount(page, { who: 'studio-own-site' });
    await pick(page, frame, '#a');
    await frame.locator('#dds-dc-bar .dc-b', { hasText: 'More' }).click();
    await expect(frame.locator('#dds-dc-more .dc-mi', { hasText: 'Copy' })).toBeVisible();
    await expect(frame.locator('#dds-dc-more .dc-mi', { hasText: /Lock this section|Unlock/ })).toHaveCount(0);
  });

  test('inside a client the studio locks it, and “Locked” is said only once the save lands', async ({ page }) => {
    const { frame, lastBlocks } = await mount(page, { who: 'studio-in-client' });
    await pick(page, frame, '#a');
    await frame.locator('#dds-dc-bar .dc-b', { hasText: 'More' }).click();
    await frame.locator('#dds-dc-more .dc-mi', { hasText: 'Lock this section' }).click();
    await expect.poll(() => lastBlocks()?.[0]?.lock?.words).toBe(true);
    await expect(page.getByText('Locked: your client can change its words, nothing else')).toBeVisible();
  });

  test('a lock the server refuses isn’t kept or announced, and the next save doesn’t carry it', async ({ page }) => {
    let once = true;
    const { frame, refused, lastBlocks, draws, redrawn } = await mount(page, { who: 'studio-in-client', refuse: (b) => {
      if (!once || !Array.isArray(b?.blocks) || !b.blocks.some((x) => x.lock)) return null;
      once = false; return 'Only your studio can lock a section. Nothing was changed.';
    } });
    await pick(page, frame, '#a');
    await frame.locator('#dds-dc-bar .dc-b', { hasText: 'More' }).click();
    const before = draws();
    await frame.locator('#dds-dc-more .dc-mi', { hasText: 'Lock this section' }).click();
    await expect.poll(() => refused.length).toBe(1);
    await redrawn(before);   // the page as saved is drawn again
    await expect(page.getByText('Only your studio can lock a section. Nothing was changed.')).toBeVisible();
    await expect(page.getByText('Locked: your client can change its words, nothing else')).toHaveCount(0);
    expect(await page.evaluate(() => (0, eval)('BLOCKS_WORK.some((b) => b.lock)'))).toBe(false);
    await pick(page, frame, '#b');
    await frame.locator('#dds-dc-bar .dc-b', { hasText: 'Duplicate' }).click();
    await expect.poll(() => (lastBlocks() || []).length).toBe(3);
    expect((lastBlocks() || []).some((b) => b.lock)).toBe(false);
  });
});
