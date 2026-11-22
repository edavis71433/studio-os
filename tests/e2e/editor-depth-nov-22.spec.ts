import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES, answerAsks, pressButton, touchScreen, settled } from './helpers/app';
import { mountCanvas, mountPages, openAbout, onPill, lastPut, SECTIONS, undo, Frame, Mounted } from './helpers/editor';

// ── The editor's depth (builder list items 314 to 320, full review of Nov 22 2026), with the
// editor-side causes of items 261 and 277 ──
// 318 a section added, moved, copied or deleted moves on the page at once; the server's refusal
//     puts it back. 320 a section step is kept per page for the visit, and one Undo works after
//     a failed save. 319 nothing sits on the words being typed: the text bar and the block bar
//     go above or below, a section's name tag sits above it, the top bar keeps its width, the
//     publish card closes on a move, and a menu link opens its page. 316 one bar on every field.
//     314 every page on the canvas. 315 the list sections as item cards, with a row added on the
//     page. 317 photos by the batch, described after, shrunk here, galleries reorderable.
//     261 the server's one live rule. 277 the site's own colours.

const CSS = '<style>:root{--accent:#8c3b2e;--ink:#222222}body{margin:0}.block{padding:24px}.hero{padding:32px}h2{margin:0 0 56px}.prose p{margin:0 0 12px}.svc{margin-top:8px}</style>';
const PAGE = (sections: string, nav = '') =>
  '<!doctype html><html><head><meta charset="utf-8">' + CSS + '</head><body>' + nav +
  '<main id="main"><section class="hero" data-dds-core="hero"><h1>Marlow’s Kitchen</h1><p>Fresh, local, yours.</p></section>' + sections + '</main></body></html>';
const NAV = '<header class="site"><nav class="primary" aria-label="Main"><a href="/">Home</a> <a href="/about/">About</a> <a href="/faq/">FAQ</a></nav></header>';
const ABOUT = '<section class="block wrap"><h1>About Marlow’s Kitchen</h1><p data-pr="identity.description">A neighbourhood bakery.</p></section>';
const FAQ = '<section class="block wrap"><h1>Frequently asked questions</h1><dl class="faq"><dt data-pr="faq" data-pr-id="f1">Do you deliver?</dt><dd class="prose"><p>Yes, nearby.</p></dd></dl></section>';
const FEATURES2 = '<section id="why-choose-us" data-dds-sid="features" data-dds-key="block_features" data-dds-src="3" class="block wrap block-features"><h2 data-dds-field="title">Why choose us</h2><div class="svc-grid"><div class="svc"><div class="nm" data-dds-field="items.0.title">Fast</div><div class="ds" data-dds-field="items.0.text">Very fast</div></div><div class="svc"><div class="nm" data-dds-field="items.1.title">A new feature</div><div class="ds" data-dds-field="items.1.text">Say what it is.</div></div></div></section>';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

type Win = Window & Record<string, (...a: unknown[]) => unknown>;
const run = (page: Page, code: string) => page.evaluate((c) => (0, eval)(c), code);
const order = (frame: Frame) => frame.locator('#main > section').evaluateAll((ns) => ns.map((n) => n.id || n.className.split(' ')[0])).catch(() => null);   // null while a redraw replaces the document
// the page's sections, with the menu, and FAQ/About drawn for their addresses (item 314)
async function mountDepth(page: Page, opts: { settings?: Record<string, unknown>; api?: Record<string, unknown>; missing?: string[] } = {}): Promise<Mounted & { pages: string[] }> {
  const pages: string[] = [];
  const m = await mountCanvas(page, { settings: opts.settings, beforeGoto: async (p) => {
    await p.route('**/functions/v1/presence/preview**', (route: Route) => {
      const pg = new URL(route.request().url()).searchParams.get('page') || '/'; pages.push(pg);
      if ((opts.missing || []).includes(pg)) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'page_not_found', message: 'No page at ' + pg + '.' }) });   // item 297: not drawn until it has something
      const body = pg === '/about/' ? PAGE(ABOUT, NAV) : pg === '/faq/' ? PAGE(FAQ, NAV) : PAGE(SECTIONS, NAV);
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
    });
    if (opts.api) for (const [path, body] of Object.entries(opts.api)) await p.route('**/functions/v1/presence' + path + '**', (route: Route) => route.request().method() === 'GET' ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }) : route.fallback());
  } });
  return { ...m, pages };
}

test.describe('318: a section moves on the page the moment it is moved, copied, added or deleted', () => {
  test('a move and a delete show before the save answers; the save’s redraw agrees', async ({ page }) => {
    const { frame, puts } = await mountDepth(page);
    let release = () => {};
    const held = new Promise<void>((r) => { release = r; });
    await page.route('**/functions/v1/presence/settings**', async (route: Route) => { if (route.request().method() === 'PUT') await held; await route.fallback(); });
    expect(await order(frame)).toEqual(['hero', 'your-heading', 'our-story', 'cta', 'why-choose-us']);
    await run(page, 'dcMove(0, 2)');
    expect(await order(frame)).toEqual(['hero', 'our-story', 'your-heading', 'cta', 'why-choose-us']);   // at once, the save still held
    expect(puts.length).toBe(0);
    await answerAsks(page);
    await run(page, 'dcDelete(1)');   // the heading, now second
    await expect(frame.locator('#your-heading')).toHaveCount(0);
    release();
    // the move's save, then the delete's: the last one carries both
    await expect.poll(() => (lastPut(puts) as { blocks?: unknown[] } | undefined)?.blocks?.length).toBe(3);
    const last = lastPut(puts) as { blocks?: Array<{ type: string }> };
    expect(last.blocks?.map((b) => b.type)).toEqual(['richtext', 'cta', 'features']);
  });

  test('a duplicate draws from the original at once; an added section shows as a named placeholder, then as drawn', async ({ page }) => {
    const { frame, puts } = await mountDepth(page);
    // each save is held at the door while the page is checked, so no redraw can land first
    let release = () => {};
    const hold = async () => { const held = new Promise<void>((r) => { release = r; }); await page.unroute('**/functions/v1/presence/settings**', gate).catch(() => {}); gateHeld = held; await page.route('**/functions/v1/presence/settings**', gate); };
    let gateHeld: Promise<void> = Promise.resolve();
    const gate = async (route: Route) => { if (route.request().method() === 'PUT') await gateHeld; await route.fallback(); };
    await hold();
    await run(page, 'dcDuplicate(0)');
    await expect(frame.locator('#main > section[data-dc-fresh]')).toHaveCount(1);
    expect(await frame.locator('#main > section').evaluateAll((ns) => ns.filter((n) => /Your heading/.test(n.textContent || '')).length)).toBe(2);
    release();
    await expect.poll(() => puts.length).toBe(1);
    await expect(frame.locator('#main > section[data-dc-fresh]')).toHaveCount(0);   // the save's redraw drew it for real
    await hold();
    await run(page, 'dcAddAt("cta", 1)');
    await expect(frame.locator('.dc-ghost')).toContainText('Adding call-to-action banner…');
    const ghostAt = await frame.locator('#main > section').evaluateAll((ns) => ns.findIndex((n) => n.classList.contains('dc-ghost')));
    expect(ghostAt).toBe(2);   // after the hero and the first section
    release();
    await expect.poll(() => puts.length).toBe(2);
    await expect(frame.locator('.dc-ghost')).toHaveCount(0);   // the save's redraw replaced it
  });

  test('a save the server refuses puts the page back and says so; no step is left to undo', async ({ page }) => {
    const { frame } = await mountDepth(page);
    let refuse = () => {};
    const refused = new Promise<void>((r) => { refuse = r; });   // the refusal waits until the moved page has been looked at
    await page.route('**/functions/v1/presence/settings**', async (route: Route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      await refused;
      return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'nope', message: 'The server said no.' }) });
    });
    await run(page, 'dcMove(0, 2)');
    expect(await order(frame)).toEqual(['hero', 'our-story', 'your-heading', 'cta', 'why-choose-us']);
    refuse();
    await expect(page.locator('.dds-toast, #toast').filter({ hasText: 'The server said no. The page is back the way it was saved.' }).first()).toBeVisible();
    await expect.poll(() => order(frame)).toEqual(['hero', 'your-heading', 'our-story', 'cta', 'why-choose-us']);
    await expect(page.locator('#btnUndo')).toBeDisabled();
  });
});

test.describe('320: Undo keeps a page’s section steps for the visit', () => {
  test('a section deleted on Home comes back with Undo pressed from About, which goes back to Home for it', async ({ page }) => {
    const { frame, puts } = await mountPages(page);
    await answerAsks(page);
    await run(page, 'dcDelete(0)');
    await expect.poll(() => puts.length).toBe(1);
    expect((lastPut(puts) as { blocks?: unknown[] }).blocks?.length).toBe(3);
    await openAbout(page, frame);
    await undo(page);
    await expect(page.locator('.dds-toast, #toast').filter({ hasText: 'That change was on Home. Opening it to undo it there.' }).first()).toBeVisible();
    await expect(onPill(page)).toHaveText('Home');
    await expect.poll(() => puts.length).toBe(2);
    expect((lastPut(puts) as { blocks?: Array<{ title?: string }> }).blocks?.[0].title).toBe('Your heading');
  });

  test('after a failed save, one Undo press puts the section back', async ({ page }) => {
    const { puts } = await mountDepth(page);
    let fail = true;
    await page.route('**/functions/v1/presence/settings**', (route: Route) => {
      if (route.request().method() === 'PUT' && fail) { fail = false; return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'down', message: 'Nothing was lost.' }) }); }
      return route.fallback();
    });
    await answerAsks(page);
    await run(page, 'dcDelete(0)');
    await expect(page.locator('#dcWhisper')).toHaveText('Not saved · Try again');
    expect(puts.length).toBe(0);
    await undo(page);
    await expect.poll(() => puts.length).toBe(1);
    expect((lastPut(puts) as { blocks?: Array<{ title?: string }> }).blocks?.map((b) => b.title)).toEqual(['Your heading', 'Our story', undefined, undefined]);
  });
});

test.describe('319: nothing sits on top of what is being edited', () => {
  test('the text bar sits in the gap above the words, clear of the heading; the name tag sits above its section', async ({ page }) => {
    const { frame } = await mountDepth(page);
    const body = frame.locator('#our-story .prose');
    await body.dblclick();
    const bar = frame.locator('#dds-ipe-bar.on');
    await expect(bar).toBeVisible();
    const b = (await bar.boundingBox())!, h2 = (await frame.locator('#our-story h2').boundingBox())!, p = (await body.boundingBox())!;
    if ((page.viewportSize()?.width ?? 0) <= 760) {   // a phone: the bar takes the foot of the page, over the dock
      await expect(bar).toHaveClass(/ipe-foot/);
      expect(b.y).toBeGreaterThanOrEqual(p.y + p.height - 1);
    } else {
      expect(b.y + b.height).toBeLessThanOrEqual(p.y + 1);
      expect(b.y).toBeGreaterThanOrEqual(h2.y + h2.height - 1);
    }
    await page.keyboard.press('Escape');
    if (touchScreen()) return;   // a finger has no hover; the tag's place is the same code
    await frame.locator('#cta').hover();
    const chip = frame.locator('#dds-dc-chip.on');
    await expect(chip).toBeVisible();
    const c = (await chip.boundingBox())!, s = (await frame.locator('#cta').boundingBox())!;
    expect(c.y + c.height).toBeLessThanOrEqual(s.y + 1);
  });

  test('the top bar keeps its width while its status words change, so Publish stays put', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 1100, 'the wide bar');
    await mountDepth(page);
    const pub = page.locator('#dcBtnPublish');
    const before = (await pub.boundingBox())!.x;
    await run(page, 'whisper("topWhisper", "saving")');
    await expect(page.locator('#dcWhisper')).toHaveText('Saving…');
    expect((await pub.boundingBox())!.x).toBe(before);
    await run(page, 'whisper("topWhisper", "failed")');
    expect((await pub.boundingBox())!.x).toBe(before);
  });

  test('the publish card closes when another page opens from the sidebar', async ({ page }) => {
    await mountDepth(page);
    await run(page, 'openRitual()');
    await expect(page.locator('#ritualWrap')).toHaveClass(/\bon\b/);
    await run(page, 'go("pages")');
    await expect(page.locator('#ritualWrap')).not.toHaveClass(/\bon\b/);
  });
});

test.describe('316: one small bar on every piece of text', () => {
  test('a heading gets Left, Centre, Size and Colour; Centre shows on the section at once and saves with it', async ({ page }) => {
    const { frame, puts } = await mountDepth(page);
    await frame.locator('#your-heading h2').dblclick();
    const bar = frame.locator('#dds-ipe-bar.on');
    await expect(bar).toBeVisible();
    await expect(bar.locator('button')).toHaveText(['Left', 'Centre', 'Size', 'Colour']);
    await bar.locator('button', { hasText: 'Centre' }).dispatchEvent('mousedown');
    await expect(frame.locator('#your-heading')).toHaveClass(/ov-align-center/);
    await expect(bar.locator('button', { hasText: 'Centre' })).toHaveClass(/ipe-on/);
    await bar.locator('button', { hasText: 'Colour' }).dispatchEvent('mousedown');
    await expect(bar.locator('.ipe-sw').first()).toBeVisible();
    await bar.locator('.ipe-sw[title="Words in #8c3b2e"]').dispatchEvent('mousedown');   // the site's own accent (item 277)
    await expect(frame.locator('#your-heading')).toHaveClass(/ov-ink/);
    await page.keyboard.press('Escape');
    await expect.poll(() => puts.length).toBeGreaterThanOrEqual(1);
    const st = (lastPut(puts) as { blocks?: Array<{ style?: { align?: string; text_color?: string } }> }).blocks?.[0].style;
    expect(st).toEqual({ align: 'center', text_color: '#8c3b2e' });
  });

  test('words with formatting get bold, italic, a link, heading, list and quote; Heading turns the paragraph into one', async ({ page }) => {
    const { frame, puts } = await mountDepth(page);
    const body = frame.locator('#our-story .prose');
    await body.locator('p').first().dblclick();
    const bar = frame.locator('#dds-ipe-bar.on');
    await expect(bar.locator('button')).toHaveText(['B', 'I', 'Link', 'H', 'List', 'Quote', 'Left', 'Centre', 'Size', 'Colour']);
    await bar.locator('button', { hasText: /^H$/ }).dispatchEvent('mousedown');
    await expect(body.locator('h2').first()).toContainText('Hello');
    await bar.locator('button', { hasText: /^H$/ }).dispatchEvent('mousedown');
    await expect(body.locator('h3').first()).toContainText('Hello');
    await bar.locator('button', { hasText: /^Quote$/ }).dispatchEvent('mousedown');
    await expect(body.locator('blockquote h3')).toHaveCount(1);
    await bar.locator('button', { hasText: /^Quote$/ }).dispatchEvent('mousedown');
    await expect(body.locator('blockquote')).toHaveCount(0);
    await bar.locator('button', { hasText: /^List$/ }).dispatchEvent('mousedown');
    await expect(body.locator(':scope > *').first()).toHaveJSProperty('tagName', 'UL');   // the fixture's own list stays second
    await expect(body.locator('ul > li').first()).toContainText('Hello');
    await bar.locator('button', { hasText: /^List$/ }).dispatchEvent('mousedown');
    await expect(body.locator(':scope > *').first()).toHaveJSProperty('tagName', 'P');   // a list item is a list item: out of the list it is a paragraph again
    await bar.locator('button', { hasText: /^H$/ }).dispatchEvent('mousedown');
    await expect(body.locator(':scope > *').first()).toHaveJSProperty('tagName', 'H2');
    await body.press('Control+Enter');
    await expect.poll(() => puts.length).toBeGreaterThanOrEqual(1);
    expect((lastPut(puts) as { blocks?: Array<{ body?: string }> }).blocks?.[1].body?.split('\n')[0]).toBe('## Hello **world**');
  });

  test('@touch the bar’s buttons are 44px taps', async ({ page }) => {
    test.skip(!touchScreen(), 'a touch screen');
    const { frame } = await mountDepth(page);
    const h2 = frame.locator('#your-heading h2');
    await h2.tap();   // the first tap picks the section
    await expect(frame.locator('#your-heading')).toHaveClass(/dc-hot/);
    await h2.tap();   // the second opens its words
    const bar = frame.locator('#dds-ipe-bar.on');
    await expect(bar).toBeVisible();
    const b = (await bar.locator('button', { hasText: 'Centre' }).boundingBox())!;
    expect(b.height).toBeGreaterThanOrEqual(44);
    expect(b.width).toBeGreaterThanOrEqual(44);
  });
});

test.describe('314: every page on the canvas', () => {
  test('About opens on the canvas from the Pages card, its toolbar says so and offers its settings; the pencil opens the form in a card', async ({ page }) => {
    const { frame, pages } = await mountDepth(page);
    await page.locator('#dcPageSwitch').click();
    const row = page.locator('#pagesCard .pc-row').filter({ has: page.locator('.pp-name', { hasText: /^About$/ }) });
    await expect(row).toHaveClass(/page-pill/);
    await row.locator('.pc-open').click();
    await expect(page.locator('#dcPageName')).toHaveText('About');
    await expect.poll(() => pages.at(-1)).toBe('/about/');
    await expect(frame.locator('#main h1', { hasText: 'About' })).toHaveText('About Marlow’s Kitchen');
    await expect(frame.locator('.dc-ins, .dc-emptyzone')).toHaveCount(0);   // nothing to add here
    const sec = frame.locator('#main > section.block');
    if (touchScreen()) await sec.tap(); else await sec.hover();
    const bar = frame.locator('#dds-dc-bar.on');
    await expect(bar).toBeVisible();
    await expect(frame.locator('#dds-dc-chip')).toContainText('Built-in page');
    await expect(bar.locator('button[aria-label="This page’s settings: its name in the menu and how it shows on Google"]')).toBeVisible();
    await pressButton(bar.locator('button[aria-label="Edit this section"]'));
    await expect(page.locator('html')).toHaveClass(/dc-edit/);   // never left the editor
    await expect(page.locator('#settingsPanel')).toHaveAttribute('data-mode', 'core');
    await expect(page.locator('#settingsPanel #view-business #f-business_name')).toBeVisible();
    await page.locator('#btnSettingsClose').click();
    await expect(page.locator('#settingsPanel #view-business')).toHaveCount(0);   // back on its tab
    await expect(page.locator('#view-business')).toHaveCount(1);
  });

  test('a question on the FAQ page is typed where it stands and saved to the Questions list', async ({ page }) => {
    const patches: Array<Record<string, unknown>> = [];
    const { frame } = await mountDepth(page, { api: { '/faqs': { data: [{ id: 'f1', question: 'Do you deliver?', answer: 'Yes, nearby.', is_visible: true, sort_order: 0 }] } } });
    await page.route('**/functions/v1/presence/faqs/f1', (route: Route) => { patches.push(route.request().postDataJSON()); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { id: 'f1', question: 'Do you deliver?', answer: 'Yes, nearby.', ...route.request().postDataJSON() } }) }); });
    await run(page, 'dcSwitchPage("~faq")');
    await expect(page.locator('#dcPageName')).toHaveText('FAQ');
    const dt = frame.locator('dt[data-pr="faq"]');
    await expect(dt).toHaveText('Do you deliver?');
    await dt.dblclick();
    await expect(dt).toHaveAttribute('contenteditable', /true|plaintext-only/);
    await page.keyboard.press('End');
    await page.keyboard.type(' Where?');
    await page.keyboard.press('Enter');
    await expect.poll(() => patches.length).toBe(1);
    expect(patches[0]).toEqual({ question: 'Do you deliver? Where?' });
    await expect(page.locator('#faqList')).toContainText('Do you deliver? Where?');   // the Questions tab agrees
    await expect(page.locator('#btnUndo')).toBeEnabled();                              // and it is a step
  });

  test('an FAQ page with no questions yet (not drawn, item 297) says so on the canvas, and its button opens the Questions card', async ({ page }) => {
    await mountDepth(page, { missing: ['/faq/'] });
    await run(page, 'dcSwitchPage("~faq")');
    await expect(page.locator('#dcPageName')).toHaveText('FAQ');
    const note = page.locator('#designPreviewEmpty');
    await expect(note).toBeVisible();
    await expect(note.locator('#dpEmptyTitle')).toHaveText('Your FAQ page isn’t on your site yet.');
    await expect(note).not.toContainText('couldn’t load');
    await pressButton(note.getByRole('button', { name: 'Add a question →' }));
    await expect(page.locator('#settingsPanel')).toHaveAttribute('data-mode', 'core');
    await expect(page.locator('#settingsPanel #view-faqs')).toBeVisible();
    await expect(page.locator('html')).toHaveClass(/dc-edit/);
    await page.locator('#btnSettingsClose').click();
    await run(page, 'dcSwitchPage("")');   // back on Home the note goes and the page is drawn
    await expect(note).toBeHidden();
  });

  test('a built-in page takes no sections; the dock’s Add says why', async ({ page }) => {
    const { puts } = await mountDepth(page);
    await run(page, 'dcSwitchPage("~about")');
    await expect(page.locator('#dcPageName')).toHaveText('About');
    await run(page, 'dcAddAt("cta", 0)');
    await expect(page.locator('.dds-toast, #toast').filter({ hasText: 'This page is built from your business details. Add sections on Home or on a page of your own.' }).first()).toBeVisible();
    await settled(page);
    expect(puts.length).toBe(0);
  });
});

test.describe('315: the list sections are item cards', () => {
  const FEATURES = { type: 'features', items: [{ title: 'Fast', text: 'Very fast' }] };
  test('one card per item with named fields; add, move and remove save the same shape', async ({ page }) => {
    const { puts } = await mountDepth(page);
    await page.route('**/functions/v1/presence/preview/section', (route: Route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { html: FEATURES2 } }) }));
    await run(page, 'eeEditBlock(3)');
    const card = page.locator('#blocksCard');
    await expect(card.locator('.rw-card')).toHaveCount(1);
    await expect(card.locator('.rw-card input').first()).toHaveValue('Fast');
    await expect(card.locator('.rw-card input[aria-label="Short description, feature 1"]')).toHaveValue('Very fast');
    await expect(card.locator('textarea[aria-label="The features, one per line"]')).toHaveValue('Fast | Very fast');   // the lines are still there, folded
    await card.getByRole('button', { name: '+ Add a feature' }).click();
    await expect(card.locator('.rw-card')).toHaveCount(2);
    await expect(card.locator('.rw-card').nth(1).locator('input').first()).toBeFocused();
    await expect.poll(() => puts.length).toBeGreaterThanOrEqual(1);
    let items = (lastPut(puts) as { blocks?: Array<typeof FEATURES> }).blocks?.[3].items;
    expect(items).toEqual([{ title: 'Fast', text: 'Very fast' }, { title: 'A new feature', text: 'Say what it is.' }]);
    const n = puts.length;
    await card.getByRole('button', { name: 'Move feature 2 up' }).click();
    await expect.poll(() => puts.length).toBe(n + 1);
    items = (lastPut(puts) as { blocks?: Array<typeof FEATURES> }).blocks?.[3].items;
    expect(items?.map((i) => i.title)).toEqual(['A new feature', 'Fast']);
    await card.getByRole('button', { name: 'Remove feature 1' }).click();
    await expect.poll(() => puts.length).toBe(n + 2);
    expect((lastPut(puts) as { blocks?: Array<typeof FEATURES> }).blocks?.[3].items).toEqual([{ title: 'Fast', text: 'Very fast' }]);
  });

  test('a feature card picks one of the line icons (or None, or a typed emoji); the folded lines keep the icon grid', async ({ page }) => {
    const { puts } = await mountDepth(page);
    await page.route('**/functions/v1/presence/preview/section', (route: Route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { html: FEATURES2 } }) }));
    await run(page, 'eeEditBlock(3)');
    const card = page.locator('#blocksCard .rw-card').first();
    const now = card.locator('.rw-icon-now');
    await expect(now).toHaveText('Add an icon');
    if (touchScreen()) expect((await now.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await pressButton(now);
    const star = page.locator('#blocksCard .rw-card').first().getByRole('button', { name: 'Star', exact: true });
    await expect(star).toBeVisible();
    if (touchScreen()) expect((await star.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await pressButton(star);
    await expect(page.locator('#blocksCard .rw-card').first().locator('.rw-icon-now')).toHaveText('Star');
    await expect.poll(() => puts.length).toBeGreaterThanOrEqual(1);
    expect((lastPut(puts) as { blocks?: Array<{ items: Array<{ icon?: string }> }> }).blocks?.[3].items[0].icon).toBe('icon:star');
    const n = puts.length;
    await pressButton(page.locator('#blocksCard .rw-card').first().locator('.rw-icon-now'));
    await pressButton(page.locator('#blocksCard .rw-card').first().getByRole('button', { name: 'None', exact: true }));
    await expect.poll(() => puts.length).toBe(n + 1);
    expect((lastPut(puts) as { blocks?: Array<{ items: Array<{ icon?: string }> }> }).blocks?.[3].items[0].icon).toBeUndefined();
    await page.locator('#blocksCard .rw-fold summary').click();
    await expect(page.locator('#blocksCard .rw-fold .ins-icons .ins-icon')).toHaveCount(24);   // the lines box keeps item 304's grid
  });

  test('a Table is a grid of cells with a row and a column to add', async ({ page }) => {
    const { puts } = await mountDepth(page, { settings: { blocks: [{ type: 'table', title: 'Prices', headers: ['Name', 'Price'], rows: [['Basic', '$10']] }], section_meta: { blocks: [{ sid: 'table', key: 'block_table', src_index: 0 }], pages: {} } } });
    await run(page, 'eeEditBlock(0)');
    const card = page.locator('#blocksCard');
    await expect(card.locator('.rw-table input')).toHaveCount(4);
    await expect(card.locator('.rw-table input[aria-label="Row 1, Price"]')).toHaveValue('$10');
    await card.getByRole('button', { name: '+ Add a column' }).click();
    await expect(card.locator('.rw-table input')).toHaveCount(6);
    await card.getByRole('button', { name: '+ Add a row' }).click();
    await expect(card.locator('.rw-table input')).toHaveCount(9);
    await expect.poll(() => puts.length).toBeGreaterThanOrEqual(1);
    const t = (lastPut(puts) as { blocks?: Array<{ headers: string[]; rows: string[][] }> }).blocks?.[0];
    expect(t?.headers).toEqual(['Name', 'Price', '']);
    expect(t?.rows).toEqual([['Basic', '$10', ''], ['', '', '']]);
  });

  test('@touch “Add a feature” on the section’s toolbar adds a row on the page and opens its words', async ({ page }) => {
    const { frame, puts } = await mountDepth(page);
    const posts: number[] = [];
    await page.route('**/functions/v1/presence/preview/section', (route: Route) => { posts.push(route.request().postDataJSON().index); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { html: FEATURES2 } }) }); });
    const sec = frame.locator('#why-choose-us');
    if (touchScreen()) await sec.tap(); else await sec.hover();
    const btn = frame.locator('#dds-dc-bar.on button[aria-label="Add a feature to this section"]');
    await expect(btn).toBeVisible();
    if (touchScreen()) expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await pressButton(btn);
    await expect.poll(() => posts).toEqual([3]);
    await expect(frame.locator('[data-dds-field="items.1.title"]')).toHaveText('A new feature');
    await expect(frame.locator('[data-dds-field="items.1.title"]')).toHaveAttribute('contenteditable', /true|plaintext-only/);   // ready to type over
    await expect.poll(() => puts.length).toBeGreaterThanOrEqual(1);
    expect((lastPut(puts) as { blocks?: Array<typeof FEATURES> }).blocks?.[3].items?.length).toBe(2);
  });
});

test.describe('317: photos by the batch', () => {
  test('a big photo is made smaller here; a file’s name gives its first description', async ({ page }) => {
    await mountDepth(page);
    const out = await page.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 3000; c.height = 1500;
      c.getContext('2d')!.fillRect(0, 0, 3000, 1500);
      const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/png'));
      const f = new File([blob], 'big.png', { type: 'image/png' });
      const w = window as unknown as Win;
      const r = (await w.dcShrinkPhoto(f)) as { width: number; height: number; mime: string; shrunk: boolean };
      return { width: r.width, height: r.height, mime: r.mime, shrunk: r.shrunk, words: [w.photoWords('fresh-pasta_basil.jpg'), w.photoWords('IMG_1234.HEIC'), w.photoWords('Screenshot 2026-11-22.png')] };
    });
    expect(out).toEqual({ width: 2400, height: 1200, mime: 'image/png', shrunk: true, words: ['Fresh pasta basil', 'Photo', 'Photo'] });
  });

  test('several photos go up from the chooser, each with its first words; the descriptions are asked for after, and a gallery takes them all', async ({ page }) => {
    const { puts } = await mountDepth(page, { settings: { blocks: [{ type: 'gallery', title: 'Our work', image_ids: ['m0'] }], section_meta: { blocks: [{ sid: 'gallery', key: 'block_gallery', src_index: 0 }], pages: {} } } });
    const ups: Array<Record<string, unknown>> = [], alts: Array<[string, Record<string, unknown>]> = [];
    let media: Array<Record<string, unknown>> = [{ id: 'm0', alt_text: 'The first', thumb: 'data:image/png;base64,' + PNG.toString('base64'), mime: 'image/png' }];
    await page.route('**/functions/v1/presence/media/upload-url', (route: Route) => {
      const b = route.request().postDataJSON(); ups.push(b);
      const id = 'm' + ups.length; media = media.concat([{ id, alt_text: b.alt_text, thumb: 'data:image/png;base64,' + PNG.toString('base64'), mime: b.mime }]);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { upload_url: new URL('/e2e-up/' + id, page.url()).toString(), media_id: id } }) });
    });
    await page.route('**/e2e-up/**', (route: Route) => route.fulfill({ status: 200, body: '' }));
    await page.route('**/functions/v1/presence/media**', (route: Route) => {
      const req = route.request(), path = new URL(req.url()).pathname;
      if (req.method() === 'GET' && /\/media$/.test(path)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: media }) });
      if (req.method() === 'PUT') { alts.push([path.split('/').pop()!, req.postDataJSON()]); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: {} }) }); }
      return route.fallback();
    });
    await run(page, 'eeEditBlock(0)');
    await page.locator('#blocksCard').getByRole('button', { name: '+ Add photos' }).click();
    await expect(page.locator('#pickTitle')).toHaveText('Choose photographs');
    await expect(page.locator('#btnPickMany')).toBeVisible();
    await page.locator('#pickUploadIn').setInputFiles([
      { name: 'fresh-pasta_basil.jpg', mimeType: 'image/jpeg', buffer: PNG },
      { name: 'IMG_1234.png', mimeType: 'image/png', buffer: PNG },
    ]);
    await expect.poll(() => ups.map((u) => u.alt_text)).toEqual(['Fresh pasta basil', 'Photo']);
    const sheet = page.locator('dialog.sv-dlg').filter({ hasText: 'Describe these photos' });
    await expect(sheet).toBeVisible();
    const inputs = sheet.locator('.ph-desc-row input');
    await expect(inputs).toHaveCount(2);
    await expect(inputs.first()).toHaveValue('Fresh pasta basil');
    await inputs.nth(1).fill('A red door');
    await sheet.getByRole('button', { name: 'Save descriptions' }).click();
    await expect.poll(() => alts).toEqual([['m2', { alt_text: 'A red door' }]]);
    await expect(page.locator('#btnPickMany')).toHaveText('Add 2 photos');   // both picked for the gallery
    await page.locator('#btnPickMany').click();
    await expect.poll(() => puts.length).toBeGreaterThanOrEqual(1);
    expect((lastPut(puts) as { blocks?: Array<{ image_ids: string[] }> }).blocks?.[0].image_ids).toEqual(['m0', 'm1', 'm2']);
  });

  test('a gallery’s photos reorder with the arrows under each; a library with nothing in it opens the chooser on Stock, searched for the kind of business', async ({ page }) => {
    const { puts } = await mountDepth(page, { settings: { industry_key: 'restaurant', blocks: [{ type: 'gallery', title: 'Our work', image_ids: ['a', 'b', 'c'], captions: ['one', 'two', 'three'] }], section_meta: { blocks: [{ sid: 'gallery', key: 'block_gallery', src_index: 0 }], pages: {} } } });
    const searched: string[] = [];
    await page.route('**/functions/v1/presence/stock/search**', (route: Route) => { searched.push(new URL(route.request().url()).searchParams.get('q') || ''); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { images: [], provider: 'Pexels', license: { name: 'Pexels License' } } }) }); });
    await page.route('**/functions/v1/presence/preview/section', (route: Route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { html: '' } }) }));
    await run(page, 'eeEditBlock(0)');
    const card = page.locator('#blocksCard');
    const b = card.getByRole('button', { name: 'Move photo 2 earlier' });
    if (touchScreen()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await b.click();
    await expect.poll(() => puts.length).toBeGreaterThanOrEqual(1);
    const g = (lastPut(puts) as { blocks?: Array<{ image_ids: string[]; captions: string[] }> }).blocks?.[0];
    expect(g?.image_ids).toEqual(['b', 'a', 'c']);
    expect(g?.captions).toEqual(['two', 'one', 'three']);
    await card.getByRole('button', { name: '+ Add photos' }).click();
    await expect(page.locator('#pickTabStock')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#pickStockQ')).toHaveValue('restaurant food');
    await expect.poll(() => searched).toEqual(['restaurant food']);
    await page.locator('#pickTabMine').click();
    await expect(page.locator('#pickUploadBtn')).toBeVisible();   // the upload is in the chooser too
  });
});

test.describe('261 and 277: the one live rule, and the site’s own colours', () => {
  const SITE = { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1, netlify_site_id: 'abc' };
  const site = (live: Record<string, unknown>) => ({ '/site': { data: { site: SITE, identity: { business_name: 'Marlow’s Kitchen' }, location: {}, live, parts: {} } } });
  test('an address alone never says Live: the server’s word is read', async ({ page }) => {
    await mountDepth(page, { api: site({ key: 'not_live', words: 'Not live yet', is_live: false, published: false }) });
    await expect(page.locator('#dcLiveChip')).toHaveJSProperty('hidden', true);
    expect(await run(page, 'siteLiveUrl()')).toBeNull();
    await run(page, 'go("today")');
    await expect(page.locator('#ssStatus')).toHaveText('Not live yet');
  });
  test('…and a site the server calls live shows the chip', async ({ page }) => {
    await mountDepth(page, { api: site({ key: 'live', words: 'Live', is_live: true, published: true }) });
    await expect(page.locator('#dcLiveChip')).toHaveJSProperty('hidden', false);   // on a phone the chip lives in the cards (display none), so its flag is read
    expect(await run(page, 'siteLiveUrl()')).toBe('https://presence-s1.netlify.app');
  });
  test('a new site’s palette is its template’s accent, not the studio’s purple', async ({ page }) => {
    await mountDepth(page);
    expect(await run(page, 'ovShades("accent")[0]')).toBe('#8c3b2e');
    expect(await run(page, 'ovShades("text_color")')).not.toContain('#5b3fa0');
  });
});
