import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// Feeling safe (builder list item 125, Nov 2026; Figma "A · Versions and what is live"): the page
// being edited says where it stands beside its name (Live, 2 changes, Not live yet); Versions puts
// publishes and saved checkpoints in one list, newest first, marked apart; one sentence under the
// list and in the restore sheet says what a restore leaves alone; tooltips name their keys. And the
// check the item asks for: browsing a card, a tab or a list sends nothing to be saved, and the
// Preview screen has no Publish.
const BLOCKS = [{ type: 'title', title: 'Fresh bread, every morning', subtitle: 'Baked in Burbank' }];
const META = { blocks: [{ sid: 'title', key: 'block_title', src_index: 0 }], pages: {} };
const HTML = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}header.site{background:#fff;padding:18px 24px}section{padding:48px 24px;min-height:420px}footer.site{background:#201b17;color:#fff;padding:40px 24px}</style></head><body>'
  + '<header class="site"><a class="brand" href="/">Marlow’s Kitchen</a></header>'
  + '<main id="main"><section class="hero" data-dds-core="hero"><h1>Marlow’s Kitchen</h1></section>'
  + '<section id="a" data-dds-sid="title" data-dds-key="block_title" data-dds-src="0" class="block"><h2 data-dds-field="title">Fresh bread, every morning</h2></section></main>'
  + '<footer class="site"><p>12 Olive Ave, Burbank</p></footer></body></html>';
const SITE = { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1 };
const LIVE = { ...SITE, netlify_site_id: 'n1' };
const ctx = (studio = false) => ({ data: { site_role: studio ? 'agency_owner' : 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES, is_agency: studio, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish', 'invite', 'configure', 'delete', 'use_developer_mode', 'view_all'], landing: '/presence.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null } });
const changes = (list: Array<{ section: string; sentence: string }>, first = false) => ({ data: { count: list.length, first_publish: first, changes: list, blockers: 0, warnings: 0, draft_hash: 'h' } });
const pub = (i: number, day: number) => ({ id: 'p' + i, kind: 'publish', status: 'live', summary: 'Version ' + i, label: '', at: new Date(Date.UTC(2026, 10, day, 15)).toISOString(), restorable: true });
const API = {
  '/site': { data: { site: LIVE, identity: { business_name: 'Marlow’s Kitchen' }, location: {} } },
  '/settings': { data: { blocks: BLOCKS, section_meta: META } },
  '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] }, '/media': { data: [] }, '/health': { data: {} }, '/notes': { data: [] }, '/moments': { data: [] },
  '/changes': changes([]),
  '/dev/customization': { data: { theme_tokens: {}, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false } },
  '/schedule': { data: { scheduled: [] } }, '/content-library': { data: [] }, '/redirects': { data: [] },
  '/publishes': { data: [pub(0, 10), pub(1, 8)] },
  '/publishes/checkpoints': { data: [{ id: 'cp1', name: 'Before the spring menu', at: new Date(Date.UTC(2026, 10, 9, 15)).toISOString() }] },
  '/launches': { data: [] },
  '/preview/status': { data: { draft: { unpublished_changes: 0 }, preview: { exists: false }, live: { published: true, last_published_at: '2026-11-10T15:00:00Z' } } },
  '/portal/context': ctx(),
};
type Write = { method: string; path: string; body: any };
async function mount(page: Page, url: string, api: Record<string, unknown> = {}, before?: () => Promise<void>) {
  await installApp(page, { api: { ...API, ...api } });
  const writes: Write[] = [];
  await page.route('**/functions/v1/presence/**', (route: Route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fallback();
    const path = new URL(req.url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
    const body = req.postData() ? req.postDataJSON() : null;
    writes.push({ method: req.method(), path, body });
    const data = /restore/.test(path) ? { ok: true, message: 'It’s in your draft.' } : (body || {});
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
  });
  await page.route('**/functions/v1/presence/preview**', (route: Route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML }));
  await page.addInitScript(() => { try { localStorage.setItem('dds-hints', JSON.stringify({ 'edit-tap': 1, 'edit-doubleclick': 1 })); } catch { /* storage may be denied */ } });
  if (before) await before();
  await page.goto(url);
  return { writes };
}
const chip = (page: Page) => page.locator('#dcPageCount');
async function editor(page: Page, api: Record<string, unknown> = {}) {
  const m = await mount(page, '/presence.html#design', api);
  await expect(page.locator('html')).toHaveClass(/dc-edit/);
  await expect(page.frameLocator('#designPreview').locator('#dds-dc-bar')).toBeAttached();
  return m;
}

test.describe('the page’s status beside its name (builder item 125)', () => {
  test('Live when nothing on it is waiting', async ({ page }) => {
    await editor(page);
    await expect(chip(page)).toHaveText('Live');
    await expect(chip(page)).toHaveClass(/\bgood\b/);
    await expect(chip(page)).toHaveAttribute('title', /Nothing on this page is waiting/);
  });

  test('how many changes are waiting on this page, and only this page', async ({ page }) => {
    await editor(page, { '/changes': changes([
      { section: 'blocks', sentence: 'Added a Gallery section on your home page.' },
      { section: 'blocks', sentence: 'Changed the words in a section on your home page.' },
      { section: 'blocks', sentence: 'Added a Team section on “Lessons”.' },
    ]) });
    await expect(chip(page)).toHaveText('2 changes');
    await expect(chip(page)).toHaveClass(/\bwarn\b/);
    await expect(chip(page)).toHaveAttribute('title', '2 changes on this page are waiting to go live');
  });

  test('Not live yet before the first publish', async ({ page }) => {
    await editor(page, { '/site': { data: { site: SITE, identity: { business_name: 'Marlow’s Kitchen' }, location: {} } }, '/changes': changes([], true) });
    await expect(chip(page)).toHaveText('Not live yet');
    await expect(chip(page)).not.toHaveClass(/\b(good|warn|bad)\b/);
  });

  test('on a phone it’s the dot alone, its words kept for screen readers', async ({ page }) => {
    test.skip(page.viewportSize()!.width > 760, 'a phone’s bar');
    await editor(page);
    await expect(chip(page)).toHaveText('Live');
    expect(await chip(page).evaluate((n) => getComputedStyle(n).fontSize)).toBe('0px');
    const dot = await chip(page).evaluate((n) => { const b = getComputedStyle(n, '::before'); return [b.width, b.backgroundColor]; });
    expect(dot[0]).toBe('8px');
    expect(dot[1]).not.toBe('rgba(0, 0, 0, 0)');
  });
});

test.describe('Versions: saves and publishes marked apart (builder item 125)', () => {
  const rows = (page: Page) => page.locator('#pubList .hentry');
  test('one list, newest first: a publish has a filled dot, a saved checkpoint a hollow one', async ({ page }) => {
    await mount(page, '/presence.html#history');
    await expect(rows(page)).toHaveCount(3);
    await expect(rows(page).nth(0).locator('.ver-kind')).toHaveText('Published');
    await expect(rows(page).nth(0)).toContainText('Version 0');
    await expect(rows(page).nth(1).locator('.ver-kind')).toHaveText('Saved');
    await expect(rows(page).nth(1)).toContainText('“Before the spring menu”');
    await expect(rows(page).nth(1)).toContainText('It was never on your live site.');
    await expect(rows(page).nth(2)).toContainText('Version 1');
    const fills = await page.locator('#pubList .ver-kind').evaluateAll((ns) => ns.map((n) => getComputedStyle(n, '::before').backgroundColor));
    expect(fills[0]).not.toBe('rgba(0, 0, 0, 0)');   // filled
    expect(fills[1]).toBe('rgba(0, 0, 0, 0)');       // hollow
    await expect(page.locator('.ver-legend')).toContainText('Published');
    await expect(page.locator('.ver-legend')).toContainText('Saved, never live');
    await expect(page.locator('#verNote')).toContainText('Restoring a version brings back its business details, services, reviews, questions, updates, sections, pages, menu, header and footer, colours and fonts, and leaves your bookings, enquiries, contacts and files as they are now.');
    await expect(page.locator('#versionMore summary')).toHaveText('More tools: private preview, compare, launches');
    // every action stays on the screen, a phone's too
    const w = page.viewportSize()!.width;
    for (const r of await page.locator('#pubList .hacts button').all()) { const b = (await r.boundingBox())!; expect(b.x + b.width).toBeLessThanOrEqual(w + 0.5); }
  });

  test('when the publishes can’t be read, the saved checkpoints still show under the message', async ({ page }) => {
    await mount(page, '/presence.html#history', {}, () => page.route('**/functions/v1/presence/publishes', (route: Route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'down', message: 'Down for a moment.' }) })));
    await expect(page.locator('#pubList .estate')).toContainText('Your versions couldn’t load just now.');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('“Before the spring menu”');
  });

  test('a saved checkpoint comes back through the same sheet, which says what it leaves alone', async ({ page }) => {
    const m = await mount(page, '/presence.html#history');
    await rows(page).nth(1).getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(page.locator('#resSheetTitle')).toHaveText('Restore this version?');
    await expect(page.locator('#resSheetSub')).toContainText('“Before the spring menu”, saved Nov 9');
    await expect(page.locator('#resSheetKeeps')).toHaveText('It brings back business details, services, reviews, questions, updates, sections, pages, menu, header and footer, colours and fonts, and leaves your bookings, enquiries, contacts and files as they are now. A page it doesn’t have is kept 30 days in Recently deleted pages.');
    await page.locator('#btnRestoreGo').click();
    await expect.poll(() => m.writes.map((w) => w.method + ' ' + w.path)).toContain('POST /publishes/checkpoints/cp1/restore');
    expect(m.writes.some((w) => w.path === '/restore-to-draft')).toBe(false);
  });

  test('a publish still comes back from its own version', async ({ page }) => {
    const m = await mount(page, '/presence.html#history');
    await rows(page).nth(0).getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(page.locator('#resSheetKeeps')).toBeVisible();
    await page.locator('#btnRestoreGo').click();
    await expect.poll(() => m.writes.find((w) => w.path === '/restore-to-draft')?.body).toEqual({ publish_id: 'p0' });
  });

  test('the studio saves a checkpoint from the top of the list; a client’s list just shows them', async ({ page }) => {
    const m = await mount(page, '/presence.html?client=s1#history', { '/portal/context': ctx(true) });
    const save = page.getByRole('button', { name: 'Save a checkpoint' });
    await expect(save).toBeVisible();
    await save.click();
    await page.getByPlaceholder('e.g. Before spring redesign').fill('Before the new photos');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => m.writes.find((w) => w.path === '/publishes/checkpoints')?.body).toEqual({ name: 'Before the new photos' });
  });
});

// A restore brings back the sections, pages and menu too (builder item 187), so the editor
// mustn't keep working from the copy it held: an edit waiting to save goes first, and after
// the restore the next save sends what came back, with no Undo step from before it.
test.describe('a restore brings back sections, pages and the menu (builder item 187)', () => {
  const rows = (page: Page) => page.locator('#pubList .hentry');
  const js = (page: Page, code: string) => page.evaluate((c) => (0, eval)(c), code);
  const puts = (m: { writes: Write[] }) => m.writes.filter((w) => w.method === 'PUT' && w.path === '/settings');
  const RESTORED = [{ type: 'title', title: 'Back from the checkpoint', subtitle: 'As it was' }, { type: 'richtext', title: 'Hours', body: 'Open every day.' }];
  async function restoreCheckpoint(page: Page, m: { writes: Write[] }) {
    await js(page, 'go("history")');
    await rows(page).nth(1).getByRole('button', { name: 'Restore', exact: true }).click();
    await page.locator('#btnRestoreGo').click();
    await expect.poll(() => m.writes.map((w) => w.method + ' ' + w.path)).toContain('POST /publishes/checkpoints/cp1/restore');
  }

  test('after a restore the editor works from what came back: the next save sends it, and Undo has nothing from before', async ({ page }) => {
    const m = await editor(page);
    await js(page, 'BLOCKS_WORK = [{ type: "title", title: "Changed before the restore" }]; saveBlocks()');
    await expect.poll(() => puts(m).length).toBe(1);
    await expect.poll(() => js(page, 'DC_UNDO.length')).toBeGreaterThan(0);
    // from here the server holds the checkpoint's sections
    await page.route('**/functions/v1/presence/settings', (route: Route) => (route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { blocks: RESTORED, section_meta: META } }) })
      : route.fallback()));
    await restoreCheckpoint(page, m);
    await expect.poll(() => js(page, 'JSON.stringify(BLOCKS_WORK)')).toBe(JSON.stringify(RESTORED));
    expect(await js(page, 'DC_UNDO.length + DC_REDO.length')).toBe(0);
    await js(page, 'BLOCKS_WORK[1].body = "Open every day, and late on Fridays."; saveBlocks()');
    await expect.poll(() => puts(m).length).toBe(2);
    expect(puts(m)[1].body.blocks.map((b: { title: string }) => b.title)).toEqual(['Back from the checkpoint', 'Hours']);
  });

  test('an edit still waiting to save goes before the restore, never after it', async ({ page }) => {
    const m = await editor(page);
    await js(page, 'BLOCKS_WORK = [{ type: "title", title: "Typed just before" }]');   // not saved yet
    await restoreCheckpoint(page, m);
    const order = m.writes.map((w) => w.method + ' ' + w.path);
    expect(order.indexOf('PUT /settings')).toBeGreaterThan(-1);
    expect(order.indexOf('PUT /settings')).toBeLessThan(order.indexOf('POST /publishes/checkpoints/cp1/restore'));
    expect(puts(m)[0].body.blocks[0].title).toBe('Typed just before');
    await page.waitForTimeout(400);
    expect(puts(m)).toHaveLength(1);   // and nothing of it is saved again after
  });

  // The client's restore that would remove or change a section their studio locked is refused
  // by the server (item 155): the sentence shows as it is, the sheet stays, nothing reloads.
  test('a restore the studio’s locks refuse says why, and the editor stays as it was', async ({ page }) => {
    const SAYS = 'Your studio locked “Fresh bread, every morning”, and that checkpoint changes it. Ask them to restore it. Nothing was changed.';
    await editor(page);
    await page.route('**/functions/v1/presence/publishes/checkpoints/cp1/restore', (route: Route) => route.fulfill({ status: 403, contentType: 'application/json',
      body: JSON.stringify({ error: 'section_locked', message: SAYS, sections: [{ name: 'Fresh bread, every morning', what: 'changed' }] }) }));
    const before = await js(page, 'JSON.stringify(BLOCKS_WORK)');
    await js(page, 'go("history")');
    await rows(page).nth(1).getByRole('button', { name: 'Restore', exact: true }).click();
    await page.locator('#btnRestoreGo').click();
    await expect(page.locator('.dds-toast, .toast').filter({ hasText: 'Your studio locked' })).toContainText(SAYS);
    await expect(page.locator('#restoreScrim')).toHaveClass(/\bon\b/);
    await expect(page.locator('#btnRestoreGo')).toBeEnabled();
    await expect(page.locator('#btnRestoreGo')).toHaveText('Restore to my draft');
    expect(await js(page, 'JSON.stringify(BLOCKS_WORK)')).toBe(before);
  });
});

test.describe('settings that wait for publish say so (builder item 125)', () => {
  test('a page’s settings in the Pages card say it once, under the pane', async ({ page }) => {
    await editor(page);
    await page.evaluate(() => (window as any).openPagesCard('dcPageSwitch'));
    await page.locator('#pagesCard .pg-gear').first().click();
    await expect(page.locator('#pcPaneWhen')).toBeVisible();
    await expect(page.locator('#pcPaneWhen')).toHaveText('Changes here save as you go and reach your live site when you publish.');
    await page.locator('#pcBack').click();
    await expect(page.locator('#pcPaneWhen')).toBeHidden();
  });
});

test.describe('tooltips name their keys (builder item 125)', () => {
  test('Undo, Redo and the cards’ Done', async ({ page }) => {
    await editor(page);
    const mac = await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || ''));
    await expect(page.locator('#btnUndo')).toHaveAttribute('title', mac ? 'Undo (⌘Z)' : 'Undo (Ctrl+Z)');
    await expect(page.locator('#btnRedo')).toHaveAttribute('title', mac ? 'Redo (⇧⌘Z)' : 'Redo (Ctrl+Shift+Z)');
    await expect(page.locator('#btnPagesClose')).toHaveAttribute('title', 'Done (Esc)');
    await page.evaluate(() => (window as any).openSettingsPanel('styles'));
    await expect(page.locator('#btnSettingsClose')).toHaveAttribute('title', 'Done (Esc)');
  });
});

test.describe('browsing changes nothing, and Preview has no Publish (builder item 125)', () => {
  test('Styles and its tabs, the Pages, Add and Photos cards and a section’s tabs, looked through: nothing is saved', async ({ page }) => {
    const m = await editor(page);
    const open = (fn: string, ...args: string[]) => page.evaluate(([f, a]) => (window as any)[f as string](...(a as string[])), [fn, args] as const);
    await open('openSettingsPanel', 'styles');
    const tabs = await page.locator('#stylesSeg [data-stab]').evaluateAll((ns) => ns.map((n) => n.getAttribute('data-stab')!));
    expect(tabs.length).toBeGreaterThanOrEqual(3);   // Looks, Colours, Fonts and the rest
    for (const tab of tabs) {
      await page.locator(`#stylesSeg [data-stab="${tab}"]`).click();
      await expect(page.locator(`#stylesSeg [data-stab="${tab}"]`)).toHaveAttribute('aria-selected', 'true');
    }
    await page.locator('#btnSettingsClose').click();
    await open('openTrayPanel', 'add');
    await expect(page.locator('#trayPanel')).toHaveClass(/\bon\b/);
    await page.keyboard.press('Escape');
    await open('openPagesCard', 'dcPageSwitch');
    await expect(page.locator('#pagesCard')).toHaveClass(/\bon\b/);
    await page.keyboard.press('Escape');
    await open('openSettingsPanel', 'header');
    await open('openSettingsPanel', 'footer');
    await page.locator('#btnSettingsClose').click();
    // a section's card: every tab
    await open('eeEditBlock', 0 as unknown as string);
    await expect(page.locator('#settingsPanel')).toHaveAttribute('data-mode', 'section');
    const segs = page.locator('#inspectorSeg button');
    expect(await segs.count()).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < await segs.count(); i++) await segs.nth(i).click();
    await page.waitForTimeout(300);
    expect(m.writes.map((w) => w.method + ' ' + w.path)).toEqual([]);
  });

  test('the Preview screen has no Publish, and covers the bar’s', async ({ page }) => {
    await editor(page);
    await page.evaluate(() => (window as any).dcOpenPreview());
    await expect(page.locator('#stage')).toHaveClass(/\bon\b/);
    await expect(page.locator('#stage').getByRole('button', { name: /publish/i })).toHaveCount(0);
    await expect(page.locator('#stage').getByRole('link', { name: /publish/i })).toHaveCount(0);
    const pub = (await page.locator('#dcBtnPublish').boundingBox());
    if (pub) {
      const inStage = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('#stage'), [pub.x + pub.width / 2, pub.y + pub.height / 2]);
      expect(inStage).toBe(true);
    }
  });
});
