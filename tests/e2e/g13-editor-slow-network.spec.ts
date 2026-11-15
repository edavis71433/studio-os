import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES, answerAsks, setAsksAnswer, askedSoFar } from './helpers/app';
import { ABOUT_BLOCKS, ABOUT_SECTION, aboutField, aboutIn, aboutSaveOut, addGallery, ANSWER_HEADERS, API, backToCanvas, BLOCKS, blocksIn, canvasReplaced, canvasScrollY, CONTACT, draftReads, draftVersion, duplicate, editAndWaitOut, editHome, FAR_DOWN, Field, FORM, FormBlocks, formSaveOut, Frame, GALLERY, hasTheirs, hideOut, holdPuts, holdReads, homeLine, lastPut, lastTwo, markCanvas, menuRows, META, mountCanvas, Mounted, mountPages, moveThenWrite, NORM_BLOCKS, NORM_META, NORM_SECTIONS, nudge, onPill, openAbout, openBusiness, OWN_MENU, OWN_PAGES, PAGE_HTML, Paged, PAGED, pageIn, pageMenu, panelEdit, pill, pillNames, previewHtml, redo, refusal, renameContact, SECTIONS, selectInBody, SETTINGS, slugs, stored, STORY, storyIn, STRIP, THEIRS, theirSection, typeDetail, typeOver, undo, WITH_CONTACT, WITH_FORM, writeOnAboutAndLeave, openPages, addBlankPage } from './helpers/editor';

// ── G13 in-place canvas text editor — the same page changes on a slow connection ──
// Split from g13-editor.spec.ts (builder list item 109, Nov 2026): the fixtures and
// helpers live in helpers/editor.ts; the tests here are as they were.

test.describe('G13 in-place canvas text editor — the same page changes on a slow connection', () => {
  test('a second in-place edit committed while the first save is out is saved too', async ({ page }) => {
    const { frame } = await mountPages(page);
    const { sent, release } = await holdPuts(page);
    await typeOver(page, frame.locator('[data-dds-field="subtitle"]'), 'First edit');
    await page.keyboard.press('Enter');
    await expect.poll(() => sent.length, { timeout: 6000 }).toBe(1);
    await typeOver(page, frame.locator('section.block-titleonly [data-dds-field="title"]'), 'Second edit');
    await page.keyboard.press('Enter');
    release();
    await expect.poll(() => sent.length, { timeout: 6000 }).toBe(2);
    expect(sent[1].blocks?.[0]).toMatchObject({ title: 'Second edit', subtitle: 'First edit' });
    await page.waitForTimeout(1800);                               // and nothing is left to save
    expect(sent.length).toBe(2);
  });

  test('Hide from menu while that page\'s save is out keeps the edit', async ({ page }) => {
    const { frame } = await mountPages(page);
    const { sent, release } = await aboutSaveOut(page, frame);
    await pageMenu(page, 'About', 'Hide from menu');
    await page.waitForTimeout(300);
    release();
    await expect.poll(() => sent.length, { timeout: 6000 }).toBe(2);
    expect(aboutIn(sent[1])?.hideNav).toBe(true);
    expect(aboutIn(sent[1])?.blocks[0].subtitle).toBe('Edit on about');
    await expect(pill(page, 'About')).toHaveAttribute('data-nav', 'hidden');
  });

  test('Moving it on the Pages tab while that page\'s save is out keeps the edit', async ({ page }) => {
    const { frame } = await mountPages(page, '', OWN_PAGES);
    const { sent, release } = await aboutSaveOut(page, frame, 'Story');
    await nudge(page, 'Story', 'ArrowDown');
    await page.waitForTimeout(300);
    release();
    await expect.poll(() => sent.length, { timeout: 6000 }).toBe(2);
    expect(slugs(sent[1])).toEqual(['gallery', 'story']);
    expect(sent[1].nav?.map((n) => n.href).slice(-2)).toEqual(['/gallery/', '/story/']);
    expect(storyIn(sent[1])?.blocks[0].subtitle).toBe('Edit on about');
  });

  test('Rename while that page\'s save is out keeps the edit', async ({ page }) => {
    const { frame } = await mountPages(page);
    const { sent, release } = await aboutSaveOut(page, frame);
    await pageMenu(page, 'About', 'Rename');
    await page.locator('dialog input').fill('Our story');
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForTimeout(300);
    release();
    await expect.poll(() => sent.length, { timeout: 6000 }).toBe(2);
    expect(aboutIn(sent[1])?.title).toBe('Our story');
    expect(aboutIn(sent[1])?.blocks[0].subtitle).toBe('Edit on about');
  });

  test('Undo of a page delete while another page\'s save is out keeps that edit', async ({ page }) => {
    const { frame } = await mountPages(page, '', [...PAGED.pages, CONTACT]);
    await answerAsks(page);
    await openAbout(page, frame);
    await pageMenu(page, 'Contact', 'Delete page');
    const undo = page.locator('.toast').getByRole('button', { name: 'Undo' });
    await expect(undo).toBeVisible();
    await expect(pill(page, 'Contact')).toHaveCount(0);
    const { sent, release } = await holdPuts(page);
    await typeOver(page, frame.locator('#about-us [data-dds-field="subtitle"]'), 'Edit on about');
    await page.keyboard.press('Enter');
    await expect.poll(() => sent.length, { timeout: 6000 }).toBe(1);
    await undo.click();
    await page.waitForTimeout(300);
    release();
    await expect.poll(() => sent.length, { timeout: 6000 }).toBe(2);
    expect(sent[1].pages?.map((p) => p.slug)).toEqual(['about', 'contact']);
    expect(aboutIn(sent[1])?.blocks[0].subtitle).toBe('Edit on about');
  });

  test('a form saved while that page\'s save is out keeps the edit, and it stays in the list', async ({ page }) => {
    const { frame } = await mountPages(page, '', [{ ...PAGED.pages[0], blocks: [...ABOUT_BLOCKS, FORM] }]);
    const { sent, release } = await aboutSaveOut(page, frame);
    await page.evaluate(() => (window as unknown as { openSettingsPanel: (m: string) => void }).openSettingsPanel('forms'));
    await expect(page.locator('#btnSettingsClose')).toBeFocused();     // the panel takes the focus 40ms after it opens
    const title = page.locator('#formsCard input[placeholder="Form title"]').first();
    await title.fill('Write to us');
    await title.blur();
    await page.waitForTimeout(1000);                               // past the form's 700ms timer
    release();
    await expect.poll(() => sent.length, { timeout: 6000 }).toBe(2);
    const saved = aboutIn(sent[1])?.blocks as unknown as Array<{ subtitle?: string; title?: string }>;
    expect(saved[0].subtitle).toBe('Edit on about');
    expect(saved[1].title).toBe('Write to us');
    await page.waitForTimeout(1000);                               // the list is rebuilt from what came back
    expect(await page.evaluate(() => (0, eval)('BLOCKS_WORK[0].subtitle'))).toBe('Edit on about');
    expect(sent.length).toBe(2);
  });

  test('a form save waiting on a section save leaves a session opened meanwhile open', async ({ page }) => {
    const { frame } = await mountPages(page, '', [{ ...PAGED.pages[0], blocks: [...ABOUT_BLOCKS, FORM] }]);
    const { sent, release } = await aboutSaveOut(page, frame);
    await page.evaluate(() => (window as unknown as { openSettingsPanel: (m: string) => void }).openSettingsPanel('forms'));
    await expect(page.locator('#btnSettingsClose')).toBeFocused();     // the panel takes the focus 40ms after it opens
    const title = page.locator('#formsCard input[placeholder="Form title"]').first();
    await title.fill('Write to us');
    await title.blur();                                                // the form's 700ms timer starts
    await page.evaluate(() => (window as unknown as { closeSettingsPanel: () => void }).closeSettingsPanel());
    const sub = frame.locator('#about-us [data-dds-field="title"]');
    await typeOver(page, sub, 'Still typing');
    release();
    await expect.poll(() => sent.length, { timeout: 6000 }).toBe(2);   // the form's save, with the session open
    await page.waitForTimeout(300);
    await expect(sub).toHaveAttribute('contenteditable', /.+/);
    await page.keyboard.insertText(', and more');
    await page.keyboard.press('Enter');
    await expect.poll(() => sent.length, { timeout: 6000 }).toBe(3);
    const saved = aboutIn(sent[2])?.blocks as unknown as Array<{ title: string; subtitle?: string }>;
    expect(saved[0].title).toBe('Still typing, and more');
    expect(saved[0].subtitle).toBe('Edit on about');
    expect(saved[1].title).toBe('Write to us');
  });

  test('a read for the old page that lands after the new page painted is dropped', async ({ page }) => {
    const { frame, puts } = await mountPages(page);
    const read = await holdReads(page, (about) => !about);
    await typeOver(page, frame.locator('[data-dds-field="subtitle"]'), 'Saved, then away');
    await page.keyboard.press('Enter');
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(1);
    await expect.poll(() => read.reads(), { timeout: 6000 }).toBe(1);
    await openAbout(page, frame);
    await markCanvas(frame);
    read.release();
    await page.waitForTimeout(800);
    await expect(onPill(page)).toHaveText('About');
    await expect(frame.locator('#about-us')).toBeAttached();
    await expect(frame.locator('#our-story')).toHaveCount(0);
    await expect(frame.locator('body[data-e2e-old]')).toHaveCount(1);
  });

  test('a read that fails for the new page says so, and the next change brings the page back', async ({ page }) => {
    const { frame, puts } = await mountPages(page);
    let failing = true;
    await page.route('**/functions/v1/presence/preview**', (route: Route) =>
      failing && new URL(route.request().url()).searchParams.get('page') === '/about/' ? route.abort() : route.fallback());
    await openPages(page); await pill(page, 'About').locator('.pp-name').click();
    await expect(onPill(page)).toHaveText('About');
    await expect(page.locator('#designPreviewEmpty')).toBeVisible();
    await expect(page.locator('#dpEmptyTitle')).toContainText('couldn’t load');
    failing = false;
    await panelEdit(page, 0, 'Typed on About');
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(1);
    await expect(page.locator('#designPreviewEmpty')).toBeHidden();
    await expect(frame.locator('#about-us')).toBeAttached();
    await expect(frame.locator('#dds-dc-bar')).toBeAttached();
    await expect(page.locator('#designPreview')).not.toHaveAttribute('inert', /.*/);
  });

  test('typing into the old document after a switch reaches no page, and the new page opens for editing', async ({ page }) => {
    const { frame, puts } = await mountPages(page);
    const read = await holdReads(page, (about) => about);
    await openPages(page); await pill(page, 'About').locator('.pp-name').click();
    await expect(onPill(page)).toHaveText('About');
    const old = frame.locator('section.block-titleonly [data-dds-field="subtitle"]');
    await old.focus();                                             // by keyboard
    await page.keyboard.press('Enter');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText('Typed on the old document');
    await page.keyboard.press('Enter');
    await old.dblclick({ force: true });                           // and by pointer
    await page.keyboard.insertText('Typed on the old document');
    await page.keyboard.press('Enter');
    await expect(frame.locator('[contenteditable]')).toHaveCount(0);
    await page.waitForTimeout(1800);                               // past the 1.2s debounce
    expect(puts).toEqual([]);
    read.release();
    await expect(frame.locator('#about-us')).toBeAttached();
    await expect(frame.locator('#dds-dc-bar')).toBeAttached();
    await typeOver(page, frame.locator('#about-us [data-dds-field="subtitle"]'), 'Typed on About');
    await page.keyboard.press('Enter');
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(1);
    expect(aboutIn(puts[0] as Paged)?.blocks[0].subtitle).toBe('Typed on About');
  });

  test('the old document offers no toolbar, and the section tree no old rows, until the new page loads', async ({ page }) => {
    const { frame } = await mountPages(page);
    const rows = page.locator('#designTreeList .dc-tree-row.block');
    await expect(rows).toHaveCount(4);
    const read = await holdReads(page, (about) => about);
    await openPages(page); await pill(page, 'About').locator('.pp-name').click();
    await expect(onPill(page)).toHaveText('About');
    await expect(rows).toHaveCount(0);                             // their buttons act by index on the open page's list
    await frame.locator('section.block-richtext').hover({ force: true });
    await page.waitForTimeout(100);
    await expect(frame.locator('#dds-dc-bar')).not.toHaveClass(/\bon\b/);
    read.release();
    await expect(frame.locator('#about-us')).toBeAttached();
    await expect(rows).toHaveCount(1);
  });

  test('a document that finishes loading after the page changed gets no editing chrome', async ({ page }) => {
    const { frame } = await mountPages(page);
    await holdReads(page, (about) => about);
    await markCanvas(frame);
    // Load waits for a document's images, so a page change can land between the write and the load.
    await page.evaluate(() => {
      const f = document.getElementById('designPreview') as HTMLIFrameElement;
      const w = window as unknown as { dcSwitchPage: (s: string) => void; refreshDesignPreview: () => void };
      const native = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'srcdoc')!;
      Object.defineProperty(f, 'srcdoc', { configurable: true, get() { return native.get!.call(f); }, set(v) {
        native.set!.call(f, v);
        delete (f as unknown as { srcdoc?: string }).srcdoc;
        w.dcSwitchPage('about');
      } });
      w.refreshDesignPreview();
    });
    await expect(onPill(page)).toHaveText('About');
    await expect(frame.locator('body[data-e2e-old]')).toHaveCount(0);
    await expect(frame.locator('#our-story')).toBeAttached();
    await page.waitForTimeout(400);
    await expect(frame.locator('#dds-dc-bar')).toHaveCount(0);
    await expect(frame.locator('[data-ipe]')).toHaveCount(0);
  });

  test('a session opened while Duplicate is on its way saves to its own page, not the copy', async ({ page }) => {
    const { frame, puts, draft } = await mountPages(page);
    let release = () => {};
    let reached = false;
    const held = new Promise<void>((r) => { release = r; });
    await page.route('**/functions/v1/presence/pages/duplicate**', async (route: Route) => {
      reached = true;
      await held;
      draft.pages = [...PAGED.pages, { slug: 'home-copy', title: 'Home copy', blocks: BLOCKS }];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { slug: 'home-copy', title: 'Home copy', pages: draft.pages } }) });
    });
    await pageMenu(page, 'Home', 'Duplicate page');
    await expect.poll(() => reached).toBe(true);
    await typeOver(page, frame.locator('section.block-titleonly [data-dds-field="subtitle"]'), 'Typed during the copy');
    release();
    await expect(onPill(page)).toHaveText('Home copy');
    await page.keyboard.press('Enter');                            // a session carried across would commit here
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(1);
    expect((puts[0] as Paged).blocks?.[0].subtitle).toBe('Typed during the copy');
    await page.waitForTimeout(1800);
    expect(puts.length).toBe(1);
  });

  test('a session opened while ＋ Page is on its way saves to its own page, not the new one', async ({ page }) => {
    const { frame, puts } = await mountPages(page);
    const { sent, release } = await holdPuts(page);
    await addBlankPage(page, 'Gallery');
    await expect.poll(() => sent.length, { timeout: 6000 }).toBe(1);
    await typeOver(page, frame.locator('section.block-titleonly [data-dds-field="subtitle"]'), 'Typed during the add');
    release();
    await expect(onPill(page)).toHaveText('Gallery');
    await page.keyboard.press('Enter');                            // a session carried across would commit here
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(2);
    expect((puts[1] as Paged).blocks?.[0].subtitle).toBe('Typed during the add');
    await page.waitForTimeout(1800);
    expect(puts.length).toBe(2);
  });

  test('a session opened while its page is being deleted writes nothing onto Home', async ({ page }) => {
    const { frame, puts } = await mountPages(page);
    await answerAsks(page);
    await openAbout(page, frame);
    const { sent, release } = await holdPuts(page);
    await pageMenu(page, 'About', 'Delete page');
    await expect.poll(() => sent.length, { timeout: 6000 }).toBe(1);
    await typeOver(page, frame.locator('#about-us [data-dds-field="subtitle"]'), 'Typed during the delete');
    release();
    await expect(onPill(page)).toHaveText('Home');
    await page.keyboard.press('Enter');                            // a session carried across would commit here
    await page.waitForTimeout(1800);
    expect(puts.filter((p) => (p as Paged).blocks)).toEqual([]);
  });

  test('a panel edit far down the page leaves the canvas where it was', async ({ page }) => {
    const { frame, puts } = await mountPages(page, FAR_DOWN);
    await frame.locator('section.block-richtext').scrollIntoViewIfNeeded();
    const before = await canvasScrollY(frame);
    expect(before).toBeGreaterThan(1000);
    await markCanvas(frame);
    await panelEdit(page, 1, 'Typed in the panel');
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(1);
    await canvasReplaced(frame);
    await expect.poll(() => canvasScrollY(frame)).toBeGreaterThan(before - 50);
    await page.waitForTimeout(800);                                // a second repaint would show here
    // read it once it settles: a read during a redraw sees the new page before its scroll is put back
    await expect.poll(() => canvasScrollY(frame)).toBeGreaterThan(before - 50);
  });

  test('a panel edit written by a page switch still starts the new page at the top', async ({ page }) => {
    const { frame, puts } = await mountPages(page, FAR_DOWN);
    await frame.locator('section.block-richtext').scrollIntoViewIfNeeded();
    expect(await canvasScrollY(frame)).toBeGreaterThan(1000);
    await panelEdit(page, 1, 'Typed in the panel');
    await page.evaluate(() => (window as unknown as { dcSwitchPage: (s: string) => void }).dcSwitchPage('about'));
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(1);
    await expect(frame.locator('#about-us')).toBeAttached();
    await expect(frame.locator('#dds-dc-bar')).toBeAttached();
    await page.waitForTimeout(600);                                // a restored scroll lands at load
    expect(await canvasScrollY(frame)).toBe(0);
  });

  test('a panel edit on the new page before it paints doesn\'t take the old page\'s scroll', async ({ page }) => {
    const { frame, puts } = await mountPages(page, FAR_DOWN);
    await frame.locator('section.block-richtext').scrollIntoViewIfNeeded();
    expect(await canvasScrollY(frame)).toBeGreaterThan(1000);
    const read = await holdReads(page, (about) => about);
    await page.evaluate(() => (window as unknown as { dcSwitchPage: (s: string) => void }).dcSwitchPage('about'));
    await expect(onPill(page)).toHaveText('About');
    await panelEdit(page, 0, 'Typed on About');
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(1);
    expect(aboutIn(puts[0] as Paged)?.blocks[0].title).toBe('Typed on About');
    read.release();
    await expect(frame.locator('#about-us')).toBeAttached();
    await expect(frame.locator('#dds-dc-bar')).toBeAttached();
    await page.waitForTimeout(600);
    expect(await canvasScrollY(frame)).toBe(0);
  });

  test('a section drag under way when the page changes is dropped, not landed on the new page', async ({ page }) => {
    const { frame, puts } = await mountPages(page, '', [{ ...PAGED.pages[0], blocks: [...ABOUT_BLOCKS, { type: 'title', title: 'Second', subtitle: 'Second line' }] }]);
    await frame.locator('section.block-richtext').hover();
    const grip = await frame.locator('#dds-dc-bar .dc-grip').boundingBox();
    const top = await frame.locator('section.block-titleonly').boundingBox();
    await page.mouse.move(grip!.x + grip!.width / 2, grip!.y + grip!.height / 2);
    await page.mouse.down();
    await page.mouse.move(top!.x + 40, top!.y + 2, { steps: 4 });
    await page.evaluate(() => (window as unknown as { dcSwitchPage: (s: string) => void }).dcSwitchPage('about'));
    await expect(onPill(page)).toHaveText('About');
    await page.mouse.up();
    await page.waitForTimeout(1200);
    expect(puts).toEqual([]);
  });

  test('a section just duplicated doesn\'t send the next page to the bottom', async ({ page }) => {
    const { frame } = await mountPages(page, FAR_DOWN);
    await page.evaluate(() => (window as unknown as { dcDuplicate: (bi: number) => void }).dcDuplicate(1));
    await page.evaluate(() => (window as unknown as { dcSwitchPage: (s: string) => void }).dcSwitchPage('about'));
    await expect(frame.locator('#about-us')).toBeAttached();
    await expect(frame.locator('#dds-dc-bar')).toBeAttached();
    await page.waitForTimeout(800);                                // a smooth scroll to the section would be under way
    expect(await canvasScrollY(frame)).toBe(0);
  });

});
