import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES, answerAsks, setAsksAnswer, askedSoFar } from './helpers/app';
import { ABOUT_BLOCKS, ABOUT_SECTION, aboutField, aboutIn, aboutSaveOut, addGallery, ANSWER_HEADERS, API, backToCanvas, BLOCKS, blocksIn, canvasReplaced, canvasScrollY, CONTACT, draftReads, draftVersion, duplicate, editAndWaitOut, editHome, FAR_DOWN, Field, FORM, FormBlocks, formSaveOut, Frame, GALLERY, hasTheirs, hideOut, holdPuts, holdReads, homeLine, lastPut, lastTwo, markCanvas, menuRows, META, mountCanvas, Mounted, mountPages, moveThenWrite, NORM_BLOCKS, NORM_META, NORM_SECTIONS, nudge, onPill, openAbout, openBusiness, OWN_MENU, OWN_PAGES, PAGE_HTML, Paged, PAGED, pageIn, pageMenu, panelEdit, pill, pillNames, previewHtml, redo, refusal, renameContact, SECTIONS, selectInBody, SETTINGS, slugs, stored, STORY, storyIn, STRIP, THEIRS, theirSection, typeDetail, typeOver, undo, WITH_CONTACT, WITH_FORM, writeOnAboutAndLeave, openPages } from './helpers/editor';

// ── G13 in-place canvas text editor — Undo and Redo of page-menu steps keep the words typed since ──
// Split from g13-editor.spec.ts (builder list item 109, Nov 2026): the fixtures and
// helpers live in helpers/editor.ts; the tests here are as they were.

test.describe('G13 in-place canvas text editor — Undo and Redo of page-menu steps keep the words typed since', () => {
  test('Undo and Redo of Hide from menu keep the words written since', async ({ page }) => {
    const { frame, puts } = await mountPages(page, '', WITH_CONTACT);
    await openAbout(page, frame);
    await pageMenu(page, 'Contact', 'Hide from menu');
    await expect(pill(page, 'Contact')).toHaveAttribute('data-nav', 'hidden');
    await writeOnAboutAndLeave(page, frame, puts);
    await undo(page);
    await expect(pill(page, 'Contact')).not.toHaveAttribute('data-nav', 'hidden');
    expect(aboutIn(lastPut(puts))?.blocks[0].subtitle).toBe('Written since');
    expect(pageIn(lastPut(puts), 'contact')?.hideNav).toBeUndefined();
    await redo(page);
    await expect(pill(page, 'Contact')).toHaveAttribute('data-nav', 'hidden');
    expect(aboutIn(lastPut(puts))?.blocks[0].subtitle).toBe('Written since');
    expect(pageIn(lastPut(puts), 'contact')?.hideNav).toBe(true);
  });

  test('Undo and Redo of a move on the Pages tab keep the words, and put back the order and the menu', async ({ page }) => {
    const { frame, puts, draft } = await mountPages(page, '', OWN_PAGES);
    const { moved, count } = await moveThenWrite(page, frame, puts, 'Story', 'ArrowDown');
    expect(slugs(moved)).toEqual(['gallery', 'story']);
    await expect.poll(() => lastTwo(page)).toEqual(['Gallery', 'Story']);
    await expect(page.locator('#btnNavAuto')).toBeVisible();
    await page.locator('#btnUndoTop').click();
    await expect.poll(() => puts.length).toBe(count + 1);
    expect(slugs(lastPut(puts))).toEqual(['story', 'gallery']);
    expect(lastPut(puts).nav).toEqual([]);                         // automatic again; the stored menu can't be null
    expect(storyIn(lastPut(puts))?.blocks[0].subtitle).toBe('Written since');
    await expect.poll(() => lastTwo(page)).toEqual(['Story', 'Gallery']);
    await expect(page.locator('#btnNavAuto')).toBeHidden();
    expect(await pillNames(page)).toEqual(['Home', 'Story', 'Gallery']);
    await page.locator('#btnRedoTop').click();
    await expect.poll(() => puts.length).toBe(count + 2);
    expect(slugs(lastPut(puts))).toEqual(['gallery', 'story']);
    expect(lastPut(puts).nav).toEqual(moved.nav);
    expect(storyIn(lastPut(puts))?.blocks[0].subtitle).toBe('Written since');
    await expect.poll(() => lastTwo(page)).toEqual(['Gallery', 'Story']);
    await expect(page.locator('#btnNavAuto')).toBeVisible();
    expect(await pillNames(page)).toEqual(['Home', 'Gallery', 'Story']);
    expect(storyIn(draft as Paged)?.blocks[0].subtitle).toBe('Written since');
  });

  test('Undo of a move puts a custom menu back as it was', async ({ page }) => {
    const { frame, puts } = await mountPages(page, '', OWN_PAGES);
    await page.evaluate((nav) => { (0, eval)('S.settings.nav = ' + JSON.stringify(nav)); }, OWN_MENU);
    const { moved, count } = await moveThenWrite(page, frame, puts, 'Story', 'ArrowDown');
    expect(moved.nav?.map((n) => n.href)).toEqual(['/', '/gallery/', '/story/']);
    await undo(page);
    await expect.poll(() => puts.length).toBe(count + 1);
    expect(lastPut(puts).nav).toEqual(OWN_MENU);
    expect(slugs(lastPut(puts))).toEqual(['story', 'gallery']);
    expect(storyIn(lastPut(puts))?.blocks[0].subtitle).toBe('Written since');
    await expect.poll(() => menuRows(page)).toEqual(['Home', 'Story', 'Gallery']);
    await redo(page);
    await expect.poll(() => puts.length).toBe(count + 2);
    expect(lastPut(puts).nav).toEqual(moved.nav);
    expect(slugs(lastPut(puts))).toEqual(['gallery', 'story']);
    expect(storyIn(lastPut(puts))?.blocks[0].subtitle).toBe('Written since');
    await expect.poll(() => menuRows(page)).toEqual(['Home', 'Gallery', 'Story']);
  });

  test('Undo and Redo of taking a page off the menu keep the words', async ({ page }) => {
    const { frame, puts } = await mountPages(page, '', OWN_PAGES);
    const { moved, count } = await moveThenWrite(page, frame, puts, 'Gallery', 'ArrowDown');
    expect(moved.pages?.find((p) => p.slug === 'gallery')?.hideNav).toBe(true);
    await expect(page.locator('#pagesUnlinked .pg-row .t b', { hasText: 'Gallery' })).toBeVisible();
    await undo(page);
    await expect.poll(() => puts.length).toBe(count + 1);
    expect(lastPut(puts).pages?.find((p) => p.slug === 'gallery')?.hideNav).toBeUndefined();
    expect(lastPut(puts).nav).toEqual([]);
    expect(storyIn(lastPut(puts))?.blocks[0].subtitle).toBe('Written since');
    await expect.poll(() => lastTwo(page)).toEqual(['Story', 'Gallery']);
    await redo(page);
    await expect.poll(() => puts.length).toBe(count + 2);
    expect(lastPut(puts).pages?.find((p) => p.slug === 'gallery')?.hideNav).toBe(true);
    expect(lastPut(puts).nav).toEqual(moved.nav);
    expect(storyIn(lastPut(puts))?.blocks[0].subtitle).toBe('Written since');
    await expect(page.locator('#pagesUnlinked .pg-row .t b', { hasText: 'Gallery' })).toBeVisible();
  });

  test('Undo and Redo of moving a built-in page, a write with no pages in it, leave the words alone', async ({ page }) => {
    const { frame, puts, draft } = await mountPages(page, '', OWN_PAGES);
    const { moved, count } = await moveThenWrite(page, frame, puts, 'Contact', 'ArrowUp');
    expect(moved.pages).toBeUndefined();
    await undo(page);
    await expect.poll(() => puts.length).toBe(count + 1);
    expect(lastPut(puts)).toEqual({ nav: [] });
    expect(storyIn(draft as Paged)?.blocks[0].subtitle).toBe('Written since');
    await expect(page.locator('#btnNavAuto')).toBeHidden();
    await redo(page);
    await expect.poll(() => puts.length).toBe(count + 2);
    expect(lastPut(puts)).toEqual({ nav: moved.nav });
    expect(storyIn(draft as Paged)?.blocks[0].subtitle).toBe('Written since');
    await expect(page.locator('#btnNavAuto')).toBeVisible();
  });

  test('Undo and Redo of Show in the menu, a write with no menu in it, keep the words and write no menu', async ({ page }) => {
    const { frame, puts } = await mountPages(page, '', OWN_PAGES);
    await openAbout(page, frame, 'Story');
    await page.evaluate(() => (window as unknown as { go: (v: string) => void }).go('pages'));
    await page.getByRole('button', { name: 'Settings for Gallery' }).click();
    await page.locator('#pageSettings').getByLabel('Show in the menu').uncheck();
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(1);
    expect(lastPut(puts).pages?.find((p) => p.slug === 'gallery')?.hideNav).toBe(true);
    await page.locator('#pageSettings').getByRole('button', { name: 'Done' }).click();
    await backToCanvas(page, frame);
    await writeOnAboutAndLeave(page, frame, puts, 'story');
    const count = puts.length;
    await undo(page);
    await expect.poll(() => puts.length).toBe(count + 1);
    expect(lastPut(puts).pages?.find((p) => p.slug === 'gallery')?.hideNav).toBeUndefined();
    expect(lastPut(puts)).not.toHaveProperty('nav');
    expect(storyIn(lastPut(puts))?.blocks[0].subtitle).toBe('Written since');
    await expect(pill(page, 'Gallery')).not.toHaveAttribute('data-nav', 'hidden');
    await redo(page);
    await expect.poll(() => puts.length).toBe(count + 2);
    expect(lastPut(puts).pages?.find((p) => p.slug === 'gallery')?.hideNav).toBe(true);
    expect(lastPut(puts)).not.toHaveProperty('nav');
    expect(storyIn(lastPut(puts))?.blocks[0].subtitle).toBe('Written since');
    await expect(pill(page, 'Gallery')).toHaveAttribute('data-nav', 'hidden');
  });

  test('Undo walks back through the words and then the move, and Redo walks forward again', async ({ page }) => {
    const { frame, puts } = await mountPages(page, '', OWN_PAGES);
    await openAbout(page, frame, 'Story');
    await nudge(page, 'Story', 'ArrowDown');
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(1);
    const moved = lastPut(puts);
    await backToCanvas(page, frame);
    await typeOver(page, aboutField(frame), 'Written since');
    await page.keyboard.press('Enter');
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(2);
    await undo(page);                                              // the words
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(3);
    expect(slugs(lastPut(puts))).toEqual(['gallery', 'story']);
    expect(storyIn(lastPut(puts))?.blocks[0].subtitle).toBe('The about line');
    await undo(page);                                              // the move
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(4);
    expect(slugs(lastPut(puts))).toEqual(['story', 'gallery']);
    expect(lastPut(puts).nav).toEqual([]);
    await redo(page);                                              // the move
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(5);
    expect(slugs(lastPut(puts))).toEqual(['gallery', 'story']);
    expect(lastPut(puts).nav).toEqual(moved.nav);
    await redo(page);                                              // the words
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(6);
    expect(slugs(lastPut(puts))).toEqual(['gallery', 'story']);
    expect(storyIn(lastPut(puts))?.blocks[0].subtitle).toBe('Written since');
  });

  test('the page menu has no Move: a page moves on the Pages tab', async ({ page }) => {
    await mountPages(page, '', WITH_CONTACT);
    await openPages(page); await pill(page, 'About').locator('.pp-menu').click();
    await expect(page.locator('.pp-pop-item')).toHaveText(['Page settings…', 'Rename', 'Hide from menu', 'Duplicate page', 'Clear page (start blank)', 'Delete page']);
  });

  test('Undo and Redo of Rename keep the words, and each is a rename the server can forward', async ({ page }) => {
    const { frame, puts } = await mountPages(page, '', WITH_CONTACT);
    await openAbout(page, frame);
    await page.evaluate(() => (0, eval)('S.settings.nav = [{ label: "Contact", href: "/contact/" }]'));
    await renameContact(page);
    await writeOnAboutAndLeave(page, frame, puts);
    await undo(page);
    await openPages(page); await expect(pill(page, 'Contact')).toBeVisible();
    const undone = lastPut(puts) as Paged & { nav?: Array<{ href: string }> };
    expect(pageIn(undone, 'contact')).toMatchObject({ title: 'Contact', prev_slug: 'help', blocks: CONTACT.blocks });
    expect(undone.nav?.[0].href).toBe('/contact/');
    expect(aboutIn(undone)?.blocks[0].subtitle).toBe('Written since');
    await redo(page);
    await openPages(page); await expect(pill(page, 'Help')).toBeVisible();
    const redone = lastPut(puts) as Paged & { nav?: Array<{ href: string }> };
    expect(pageIn(redone, 'help')).toMatchObject({ title: 'Help', prev_slug: 'contact', blocks: CONTACT.blocks });
    expect(redone.nav?.[0].href).toBe('/help/');
    expect(aboutIn(redone)?.blocks[0].subtitle).toBe('Written since');
  });

  test('Undo of a Rename on the page being edited stays on that page, and the next edit lands on it', async ({ page }) => {
    const { frame, puts } = await mountPages(page);
    await openAbout(page, frame);
    await pageMenu(page, 'About', 'Rename');
    await page.locator('dialog input').fill('Our story');
    await page.getByRole('button', { name: 'Next' }).click();
    await page.locator('dialog input').fill('our-story');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(onPill(page)).toHaveText('Our story');
    await expect(frame.locator('#about-us')).toHaveCount(0);   // the renamed page is drawn (here it has no About section)
    await markCanvas(frame);
    await undo(page);
    await expect(onPill(page)).toHaveText('About');
    // Undo draws the page again; an Enter pressed on the page about to go is lost with it
    // (once in 60 on a phone)
    await canvasReplaced(frame);
    await expect(frame.locator('#about-us')).toBeAttached();
    const count = puts.length;
    await typeOver(page, frame.locator('#about-us [data-dds-field="subtitle"]'), 'Back on about');
    await page.keyboard.press('Enter');
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(count + 1);
    expect(lastPut(puts).pages?.map((p) => p.slug)).toEqual(['about']);
    expect(aboutIn(lastPut(puts))?.blocks[0].subtitle).toBe('Back on about');
  });

  test('Undo of Delete puts the page back where it was, as it was, and leaves other pages\' words alone', async ({ page }) => {
    const { frame, puts } = await mountPages(page, '', [CONTACT, ...PAGED.pages]);
    await answerAsks(page);
    await openAbout(page, frame);
    await pageMenu(page, 'Contact', 'Delete page');
    await expect(pill(page, 'Contact')).toHaveCount(0);
    await writeOnAboutAndLeave(page, frame, puts);
    await undo(page);
    await openPages(page); await expect(pill(page, 'Contact')).toBeVisible();
    expect(lastPut(puts).pages?.map((p) => p.slug)).toEqual(['contact', 'about']);
    expect(pageIn(lastPut(puts), 'contact')?.blocks).toEqual(CONTACT.blocks);
    expect(aboutIn(lastPut(puts))?.blocks[0].subtitle).toBe('Written since');
    await redo(page);
    await expect(pill(page, 'Contact')).toHaveCount(0);
    expect(lastPut(puts).pages?.map((p) => p.slug)).toEqual(['about']);
    expect(aboutIn(lastPut(puts))?.blocks[0].subtitle).toBe('Written since');
  });

  test('Undo of ＋ Page with nothing on it takes the page away without asking, and moves off it', async ({ page }) => {
    const { puts } = await mountPages(page);
    await answerAsks(page);
    await addGallery(page);
    await undo(page);
    await expect(pill(page, 'Gallery')).toHaveCount(0);
    await expect(onPill(page)).toHaveText('Home');
    expect(lastPut(puts).pages?.map((p) => p.slug)).toEqual(['about']);
    expect(await askedSoFar(page)).toEqual([]);
    await redo(page);
    await openPages(page); await expect(pill(page, 'Gallery')).toBeVisible();
    expect(lastPut(puts).pages?.map((p) => p.slug)).toEqual(['about', 'gallery']);
  });

  test('Undo of ＋ Page asks first once the page has words on it; no keeps them, yes keeps a way back', async ({ page }) => {
    const { puts } = await mountPages(page);
    const checkpoints: string[] = [];
    await page.route('**/functions/v1/presence/publishes/checkpoints**', (route: Route) => {
      checkpoints.push((route.request().postDataJSON() as { name: string }).name);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: {} }) });
    });
    await answerAsks(page, false);
    await addGallery(page);
    await page.evaluate(() => (0, eval)('BLOCKS_WORK = [{ type: "title", title: "Gallery", subtitle: "Written on the new page" }]; saveBlocks()'));
    await expect.poll(() => pageIn(lastPut(puts), 'gallery')?.blocks.length).toBe(1);
    await openPages(page); await pill(page, 'Home').locator('.pp-name').click();
    await expect(onPill(page)).toHaveText('Home');
    const count = puts.length;
    await undo(page);
    await expect.poll(async () => (await askedSoFar(page)).length).toBe(1);
    expect((await askedSoFar(page))[0]).toContain('Gallery');
    await page.waitForTimeout(300);
    expect(puts.length).toBe(count);                               // no: nothing was written
    await openPages(page); await expect(pill(page, 'Gallery')).toBeVisible();
    await setAsksAnswer(page, true);
    await undo(page);                                              // and the step is still there to take
    await expect(pill(page, 'Gallery')).toHaveCount(0);
    expect((await askedSoFar(page)).length).toBe(2);
    expect(checkpoints).toEqual(['Before removing “Gallery”']);
    await redo(page);
    await openPages(page); await expect(pill(page, 'Gallery')).toBeVisible();
    expect(pageIn(lastPut(puts), 'gallery')?.blocks[0].subtitle).toBe('Written on the new page');
    expect((await askedSoFar(page)).length).toBe(2);
  });

  test('Undo of a step leaves a page made since by Duplicate on the list', async ({ page }) => {
    const { frame, puts, draft } = await mountPages(page, '', WITH_CONTACT);
    await page.route('**/functions/v1/presence/pages/duplicate**', (route: Route) => {
      draft.pages = [...WITH_CONTACT.slice(0, 1), { slug: 'about-copy', title: 'About copy', blocks: ABOUT_BLOCKS }, ...(draft.pages as unknown[]).slice(1)];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { slug: 'about-copy', title: 'About copy', pages: draft.pages } }) });
    });
    await openAbout(page, frame);
    await pageMenu(page, 'Contact', 'Hide from menu');
    await expect(pill(page, 'Contact')).toHaveAttribute('data-nav', 'hidden');
    await pageMenu(page, 'About', 'Duplicate page');
    await expect(onPill(page)).toHaveText('About copy');
    await undo(page);
    await expect(pill(page, 'Contact')).not.toHaveAttribute('data-nav', 'hidden');
    expect(lastPut(puts).pages?.map((p) => p.slug)).toEqual(['about', 'about-copy', 'contact']);
    await expect(onPill(page)).toHaveText('About copy');
  });

  test('Undo that would give a page an address now in use says so and writes nothing', async ({ page }) => {
    const { frame, puts, draft } = await mountPages(page, '', WITH_CONTACT);
    await page.route('**/functions/v1/presence/pages/duplicate**', (route: Route) => {
      draft.pages = [...(draft.pages as unknown[]), { ...CONTACT, title: 'Contact copy' }];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { slug: 'contact', title: 'Contact copy', pages: draft.pages } }) });
    });
    await openAbout(page, frame);
    await renameContact(page);
    await pageMenu(page, 'About', 'Duplicate page');
    await expect(onPill(page)).toHaveText('Contact copy');
    const count = puts.length;
    await undo(page);
    await expect(page.locator('.dds-toast, #toast').filter({ hasText: 'Another page uses that address' }).first()).toBeVisible();
    expect(puts.length).toBe(count);
    await openPages(page); await expect(pill(page, 'Help')).toBeVisible();
  });

  test('words typed while an Undo is on its way are kept, and saved after it', async ({ page }) => {
    const { frame } = await mountPages(page, '', WITH_CONTACT);
    await openAbout(page, frame);
    await pageMenu(page, 'Contact', 'Hide from menu');
    await expect(pill(page, 'Contact')).toHaveAttribute('data-nav', 'hidden');
    const { sent, release } = await holdPuts(page);
    await undo(page);
    await expect.poll(() => sent.length).toBe(1);
    await typeOver(page, frame.locator('#about-us [data-dds-field="subtitle"]'), 'Typed during the undo');
    await page.keyboard.press('Enter');                            // the commit's debounce runs past the release
    release();
    await expect.poll(() => sent.length, { timeout: 6000 }).toBe(2);
    expect(aboutIn(sent[1])?.blocks[0].subtitle).toBe('Typed during the undo');
    expect(pageIn(sent[1], 'contact')?.hideNav).toBeUndefined();
  });

  test('Undo while a section save is out waits for it, and its list carries those words', async ({ page }) => {
    const { frame } = await mountPages(page, '', WITH_CONTACT);
    await openAbout(page, frame);
    await pageMenu(page, 'Contact', 'Hide from menu');
    await expect(pill(page, 'Contact')).toHaveAttribute('data-nav', 'hidden');
    const { sent, release } = await holdPuts(page);
    await typeOver(page, frame.locator('#about-us [data-dds-field="subtitle"]'), 'On its way');
    await page.keyboard.press('Enter');
    await expect.poll(() => sent.length, { timeout: 6000 }).toBe(1);
    await openPages(page); await pill(page, 'Home').locator('.pp-name').click();          // the page change waits on that save, and takes the snapshots with it
    await page.waitForTimeout(200);
    release();
    await expect(onPill(page)).toHaveText('Home');
    await undo(page);
    await expect.poll(() => sent.length, { timeout: 6000 }).toBe(2);
    expect(aboutIn(sent[1])?.blocks[0].subtitle).toBe('On its way');
    expect(pageIn(sent[1], 'contact')?.hideNav).toBeUndefined();
  });

  test('Undo while another page write is out keeps that write: its list is built when its turn comes', async ({ page }) => {
    const { frame } = await mountPages(page, '', WITH_CONTACT);
    await openAbout(page, frame);
    await pageMenu(page, 'Contact', 'Hide from menu');
    await expect(pill(page, 'Contact')).toHaveAttribute('data-nav', 'hidden');
    const { sent, release } = await holdPuts(page);
    await pageMenu(page, 'About', 'Hide from menu');
    await expect.poll(() => sent.length, { timeout: 6000 }).toBe(1);
    await undo(page);                                              // takes back the Contact hide, the last step to land
    await page.waitForTimeout(300);
    expect(sent.length).toBe(1);                                   // it waits its turn
    release();
    await expect.poll(() => sent.length, { timeout: 6000 }).toBe(2);
    expect(aboutIn(sent[1])?.hideNav).toBe(true);
    expect(pageIn(sent[1], 'contact')?.hideNav).toBeUndefined();
    await expect(pill(page, 'About')).toHaveAttribute('data-nav', 'hidden');
    await expect(pill(page, 'Contact')).not.toHaveAttribute('data-nav', 'hidden');
  });

  test('a form save is a section edit: its Undo takes back the form, and leaving the page leaves later words safe', async ({ page }) => {
    const { frame, puts } = await mountPages(page, '', [{ ...PAGED.pages[0], blocks: [...ABOUT_BLOCKS, FORM] }]);
    type Saved = Array<{ title: string; subtitle?: string }>;
    await openAbout(page, frame);
    await page.evaluate(() => (window as unknown as { openSettingsPanel: (m: string) => void }).openSettingsPanel('forms'));
    await expect(page.locator('#btnSettingsClose')).toBeFocused();     // the panel takes the focus 40ms after it opens
    const title = page.locator('#formsCard input[placeholder="Form title"]').first();
    await title.fill('Write to us');
    await title.blur();
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(1);
    expect((aboutIn(lastPut(puts))?.blocks as unknown as Saved)[1].title).toBe('Write to us');
    await undo(page);                                              // right away, it takes back the form
    await expect.poll(() => puts.length).toBe(2);
    expect((aboutIn(lastPut(puts))?.blocks as unknown as Saved)[1].title).toBe('Say hello');
    await expect(title).toHaveValue('Say hello');                  // and the card shows what's saved now
    await redo(page);
    await expect.poll(() => puts.length).toBe(3);
    expect((aboutIn(lastPut(puts))?.blocks as unknown as Saved)[1].title).toBe('Write to us');
    await page.keyboard.press('Escape');
    await writeOnAboutAndLeave(page, frame, puts);
    const count = puts.length;
    await undo(page);                                              // off the page, it's gone with the page's snapshots
    await page.waitForTimeout(300);
    expect(puts.length).toBe(count);
    expect((aboutIn(lastPut(puts))?.blocks as unknown as Saved)[0].subtitle).toBe('Written since');
  });
});

// List item 99 (Nov 8 2026): Comments mode is for notes. Its canvas toolbar used to offer Move,
// Duplicate, Cut, Hide and Delete (and Delete worked), and the Contents list kept its move and
// remove buttons, its drag handles and Add a page beside the comment badges. On a phone a
// toolbar a tap had left up carried into Comments mode.
test.describe('Comments mode offers no editing (item 99)', () => {
  test('the section toolbar and the Contents list edit only in Edit mode', async ({ page }) => {
    const { frame, puts } = await mountCanvas(page);
    const first = frame.locator('section.block-richtext');
    // a phone brings the toolbar with a tap, a mouse with a hover
    const phone = (page.viewportSize()?.width || 1200) < 768;
    const point = (loc: ReturnType<typeof frame.locator>) => (phone ? loc.tap() : loc.hover({ position: { x: 600, y: 56 } }));   // right of the floating Contents card, under the section pill
    await point(first);
    await expect(frame.locator('#dds-dc-bar button', { hasText: 'Delete' })).toBeVisible();   // Edit mode: the toolbar is there
    if (phone) await page.locator('#dkMore').click();                                         // Notes waits behind More on a phone
    await page.locator('#dcModeSeg [data-dcmode="comments"]').click();
    await expect(page.locator('#dcModeSeg [data-dcmode="comments"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(frame.locator('#dds-dc-bar.on')).toHaveCount(0);                              // the toolbar went away with Edit mode
    if (!phone) {   // on a phone the Contents sheet covers the canvas in Comments mode
      await point(frame.locator('section.block-cta'));
      await point(first);
      await page.waitForTimeout(300);
      await expect(frame.locator('#dds-dc-bar.on')).toHaveCount(0);                            // and doesn't come back on a section
    }
    await expect(page.locator('#designTreeList .dc-tree-row').first()).toBeAttached();
    await expect(page.locator('#designTreeList .dc-tree-acts')).toHaveCount(0);                // no move, settings or remove buttons
    await expect(page.locator('#designTreeList .dc-tree-grab')).toHaveCount(0);                // no drag handles
    await expect(page.locator('#designTreeList .dc-tree-addpage')).toHaveCount(0);             // no Add a page
    expect(puts.length).toBe(0);
    // back in Edit mode, all of it returns
    if (phone) { await page.getByRole('button', { name: /Collapse/ }).click(); await page.locator('#dkMore').click(); }
    await page.locator('#dcModeSeg [data-dcmode="comments"]').click();                        // Notes again is the way back to Edit
    await expect(page.locator('#dcModeSeg [data-dcmode="comments"]')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#designTreeList .dc-tree-acts').first()).toBeAttached();
    await expect(page.locator('#designTreeList .dc-tree-grab').first()).toBeAttached();
    await expect(page.locator('#designTreeList .dc-tree-addpage')).toBeAttached();
    await point(frame.locator('section.block-cta'));
    await point(first);
    await expect(frame.locator('#dds-dc-bar button', { hasText: 'Delete' })).toBeVisible();
  });
});
