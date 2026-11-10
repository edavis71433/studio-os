import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES, answerAsks, setAsksAnswer, askedSoFar } from './helpers/app';
import { ABOUT_BLOCKS, ABOUT_SECTION, aboutField, aboutIn, aboutSaveOut, addGallery, ANSWER_HEADERS, API, backToCanvas, BLOCKS, blocksIn, canvasReplaced, canvasScrollY, CONTACT, draftReads, draftVersion, duplicate, editAndWaitOut, editHome, FAR_DOWN, Field, FORM, FormBlocks, formSaveOut, Frame, GALLERY, hasTheirs, hideOut, holdPuts, holdReads, homeLine, lastPut, lastTwo, markCanvas, menuRows, META, mountCanvas, Mounted, mountPages, moveThenWrite, NORM_BLOCKS, NORM_META, NORM_SECTIONS, nudge, onPill, openAbout, openBusiness, OWN_MENU, OWN_PAGES, PAGE_HTML, Paged, PAGED, pageIn, pageMenu, panelEdit, pill, pillNames, previewHtml, redo, refusal, renameContact, SECTIONS, selectInBody, SETTINGS, slugs, stored, STORY, storyIn, STRIP, THEIRS, theirSection, typeDetail, typeOver, undo, WITH_CONTACT, WITH_FORM, writeOnAboutAndLeave } from './helpers/editor';

// ── G13 in-place canvas text editor — repaints and saves that overlap an open edit ──
// Split from g13-editor.spec.ts (builder list item 109, Nov 2026): the fixtures and
// helpers live in helpers/editor.ts; the tests here are as they were.

test.describe('G13 in-place canvas text editor — repaints and saves that overlap an open edit', () => {
  test('a repaint on its way never lands under an open session: the caret stays and later typing is kept', async ({ page }) => {
    const { frame, puts } = await mountCanvas(page);
    let reads = 0;
    let releaseRead = () => {};
    const heldRead = new Promise<void>((r) => { releaseRead = r; });
    await page.route('**/functions/v1/presence/preview**', async (route: Route) => { reads++; await heldRead; await route.fulfill(previewHtml); });
    const h2 = frame.locator('section.block-titleonly [data-dds-field="title"]');
    await h2.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText('Edited first');
    await page.keyboard.press('Enter');
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(1);
    await expect.poll(() => reads, { timeout: 6000 }).toBe(1);     // that save's repaint is in flight…
    const sub = frame.locator('[data-dds-field="subtitle"]');
    await sub.focus();
    await page.keyboard.press('Enter');
    await expect(sub).toHaveAttribute('contenteditable', /.+/);
    await markCanvas(frame);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText('typed before');
    releaseRead();                                                 // …and comes back now
    await page.waitForTimeout(500);
    await expect(sub).toHaveAttribute('contenteditable', /.+/);
    await page.keyboard.insertText(' and after');
    await expect(sub).toHaveText('typed before and after');
    await page.keyboard.press('Enter');
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(2);
    expect((puts[1].blocks as typeof BLOCKS)[0].subtitle).toBe('typed before and after');
    await canvasReplaced(frame);                                   // the save's repaint still lands, after the session
  });

  test('a repaint a session held off still runs when that session ends with nothing to save', async ({ page }) => {
    const { frame, puts } = await mountCanvas(page);
    let reads = 0;
    let releaseRead = () => {};
    const heldRead = new Promise<void>((r) => { releaseRead = r; });
    await page.route('**/functions/v1/presence/preview**', async (route: Route) => { reads++; await heldRead; await route.fulfill(previewHtml); });
    const h2 = frame.locator('section.block-titleonly [data-dds-field="title"]');
    await h2.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText('Edited first');
    await page.keyboard.press('Enter');
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(1);
    await expect.poll(() => reads, { timeout: 6000 }).toBe(1);
    const sub = frame.locator('[data-dds-field="subtitle"]');
    await sub.focus();
    await page.keyboard.press('Enter');
    await expect(sub).toHaveAttribute('contenteditable', /.+/);
    await markCanvas(frame);
    releaseRead();
    await page.waitForTimeout(500);
    await expect(frame.locator('body[data-e2e-old]')).toHaveCount(1);   // held
    await page.keyboard.press('Escape');
    await canvasReplaced(frame);                                         // the canvas still catches up
    expect(puts.length).toBe(1);
  });

  test('one in-place edit is one PUT, even when the section list\'s own save timer fires inside the debounce', async ({ page }) => {
    const { frame, puts } = await mountCanvas(page);
    const h2 = frame.locator('section.block-titleonly [data-dds-field="title"]');
    await h2.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText('Once');
    await page.keyboard.press('Enter');
    // every render of the list arms that 700ms timer, so a commit soon after one meets it
    await page.evaluate(() => (window as unknown as { blocksSaveSoon: (ms: number) => void }).blocksSaveSoon(0));
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(1);
    await page.waitForTimeout(1800);                                     // past the 1.2s debounce
    expect(puts.length).toBe(1);
    expect((puts[0].blocks as typeof BLOCKS)[0].title).toBe('Once');
  });

  test('a slow read at boot does not paint the canvas a second time', async ({ page }) => {
    let reads = 0;
    const { frame } = await mountCanvas(page, { beforeGoto: async (p) => {
      await p.route('**/functions/v1/presence/dev/customization**', async (route: Route) => { await new Promise((r) => setTimeout(r, 900)); await route.fallback(); });
      await p.route('**/functions/v1/presence/preview**', async (route: Route) => { reads++; await route.fallback(); });
    } });
    await markCanvas(frame);
    await expect(page.locator('#sectionsCard')).toBeAttached();          // the mount that used to ask for a second paint
    await page.waitForTimeout(800);                                      // past the 350ms debounce and the read
    expect(reads).toBe(1);
    await expect(frame.locator('body[data-e2e-old]')).toHaveCount(1);
  });

  test('an edit committed before the section panel has mounted is the edit that gets saved', async ({ page }) => {
    let releaseCard = () => {};
    const heldCard = new Promise<void>((r) => { releaseCard = r; });
    const { frame, puts } = await mountCanvas(page, { beforeGoto: (p) =>
      p.route('**/functions/v1/presence/dev/customization**', async (route: Route) => { await heldCard; await route.fallback(); }) });
    const sub = frame.locator('[data-dds-field="subtitle"]');
    await sub.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText('Committed early');
    await page.keyboard.press('Enter');
    await expect(sub).not.toHaveAttribute('contenteditable', /.+/);
    releaseCard();                                                       // the card mounts inside the 1.2s debounce
    await expect(page.locator('#blocksCard')).toBeAttached();
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(1);
    expect((puts[0].blocks as typeof BLOCKS)[0].subtitle).toBe('Committed early');
  });

});
