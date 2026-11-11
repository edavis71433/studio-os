import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES, answerAsks, setAsksAnswer, askedSoFar } from './helpers/app';
import { ABOUT_BLOCKS, ABOUT_SECTION, aboutField, aboutIn, aboutSaveOut, addGallery, ANSWER_HEADERS, API, backToCanvas, BLOCKS, blocksIn, canvasReplaced, canvasScrollY, CONTACT, draftReads, draftVersion, duplicate, editAndWaitOut, editHome, FAR_DOWN, Field, FORM, FormBlocks, formSaveOut, Frame, GALLERY, hasTheirs, hideOut, holdPuts, holdReads, homeLine, lastPut, lastTwo, markCanvas, menuRows, META, mountCanvas, Mounted, mountPages, moveThenWrite, NORM_BLOCKS, NORM_META, NORM_SECTIONS, nudge, onPill, openAbout, openBusiness, OWN_MENU, OWN_PAGES, PAGE_HTML, Paged, PAGED, pageIn, pageMenu, panelEdit, pill, pillNames, previewHtml, redo, refusal, renameContact, SECTIONS, selectInBody, SETTINGS, slugs, stored, STORY, storyIn, STRIP, THEIRS, theirSection, typeDetail, typeOver, undo, WITH_CONTACT, WITH_FORM, writeOnAboutAndLeave, openPages } from './helpers/editor';

// ── G13 in-place canvas text editor — changing page with an edit open or on its way ──
// Split from g13-editor.spec.ts (builder list item 109, Nov 2026): the fixtures and
// helpers live in helpers/editor.ts; the tests here are as they were.

test.describe('G13 in-place canvas text editor — changing page with an edit open or on its way', () => {
  test('clicking another page without pressing Enter writes the edit to its own page, then switches', async ({ page }) => {
    const { frame, puts } = await mountPages(page);
    const { sent, release } = await holdPuts(page);
    await typeOver(page, frame.locator('[data-dds-field="subtitle"]'), 'Kept across pages');
    await openPages(page); await pill(page, 'About').locator('.pp-name').click();         // the click blurs the field, which commits
    await expect.poll(() => sent.length, { timeout: 6000 }).toBe(1);
    expect(sent[0].blocks?.[0].subtitle).toBe('Kept across pages');
    await expect(onPill(page)).toHaveText('Home');                 // the list is not replaced while the write is out
    release();
    await expect(onPill(page)).toHaveText('About');
    await expect(frame.locator('#about-us')).toBeAttached();
    await page.waitForTimeout(1800);                               // past the 1.2s debounce
    expect(puts.length).toBe(1);                                   // and nothing else was written
  });

  test('switching inside the debounce after Enter, from a custom page: the words land on that page', async ({ page }) => {
    const { frame, puts } = await mountPages(page);
    await openAbout(page, frame);
    await typeOver(page, frame.locator('#about-us [data-dds-field="subtitle"]'), 'About, edited');
    await page.keyboard.press('Enter');
    await openPages(page); await pill(page, 'Home').locator('.pp-name').click();
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(1);
    const saved = puts[0] as Paged;
    expect(saved.blocks).toBeUndefined();
    expect(saved.pages?.[0].blocks[0].subtitle).toBe('About, edited');
    await expect(onPill(page)).toHaveText('Home');
    await expect(frame.locator('#our-story')).toBeAttached();
    await page.waitForTimeout(1800);
    expect(puts.length).toBe(1);
  });

  test('a save already on its way when the page is clicked is waited out', async ({ page }) => {
    const { frame, puts } = await mountPages(page);
    const { sent, release } = await holdPuts(page);
    await typeOver(page, frame.locator('[data-dds-field="subtitle"]'), 'Already leaving');
    await page.keyboard.press('Enter');
    await expect.poll(() => sent.length, { timeout: 6000 }).toBe(1);   // the debounce fired on its own
    await openPages(page); await pill(page, 'About').locator('.pp-name').click();
    await page.waitForTimeout(300);
    await expect(onPill(page)).toHaveText('Home');                     // its write isn't in the saved draft yet
    release();
    await expect(onPill(page)).toHaveText('About');
    await page.waitForTimeout(1800);
    expect(puts.length).toBe(1);
  });

  test('a session still open when the switch arrives is committed first, not carried to the next page', async ({ page }) => {
    const { frame, puts } = await mountPages(page);
    await typeOver(page, frame.locator('[data-dds-field="subtitle"]'), 'Still typing');
    await page.evaluate(() => (window as unknown as { dcSwitchPage: (s: string) => void }).dcSwitchPage('about'));   // no click, so no blur
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(1);
    expect((puts[0] as Paged).blocks?.[0].subtitle).toBe('Still typing');
    await expect(onPill(page)).toHaveText('About');
    await expect(frame.locator('#about-us')).toBeAttached();
    await expect(frame.locator('[contenteditable]')).toHaveCount(0);
  });

  test('a panel edit still in its timer is written before the page changes', async ({ page }) => {
    const { puts } = await mountPages(page);
    await page.evaluate(() => (window as unknown as { eeEditBlock: (bi: number) => void }).eeEditBlock(0));
    const title = page.locator('#blocksCard input[type="text"], #blocksCard input:not([type])').first();
    await title.fill('Typed in the panel');
    await title.blur();                                            // panel inputs commit on change, then wait 700ms
    await page.evaluate(() => (window as unknown as { dcSwitchPage: (s: string) => void }).dcSwitchPage('about'));
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(1);
    expect((puts[0] as Paged).blocks?.[0].title).toBe('Typed in the panel');
    await expect(onPill(page)).toHaveText('About');
  });

  test('a save that fails keeps the person on the page with their words, and the next click writes them', async ({ page }) => {
    const { frame, puts } = await mountPages(page);
    let refusing = true;
    await page.route('**/functions/v1/presence/settings**', async (route: Route) => {
      if (refusing && route.request().method() === 'PUT') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'That save was refused.' }) });
      return route.fallback();
    });
    await typeOver(page, frame.locator('[data-dds-field="subtitle"]'), 'Not lost');
    await openPages(page); await pill(page, 'About').locator('.pp-name').click();
    await expect(page.locator('.dds-toast, #toast').filter({ hasText: 'That save was refused.' }).first()).toBeVisible();
    await expect(onPill(page)).toHaveText('Home');
    expect(puts.length).toBe(0);
    refusing = false;
    await openPages(page); await pill(page, 'About').locator('.pp-name').click();
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(1);
    expect((puts[0] as Paged).blocks?.[0].subtitle).toBe('Not lost');
    await expect(onPill(page)).toHaveText('About');
  });

  test('the last page asked for wins while the save is out, and the edit is written once', async ({ page }) => {
    const { frame, puts } = await mountPages(page);
    const { sent, release } = await holdPuts(page);
    await typeOver(page, frame.locator('[data-dds-field="subtitle"]'), 'Changed my mind');
    await openPages(page); await pill(page, 'About').locator('.pp-name').click();
    await expect.poll(() => sent.length, { timeout: 6000 }).toBe(1);
    await openPages(page); await pill(page, 'Home').locator('.pp-name').click();          // back to where they are, before the save lands
    release();
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(1);
    await page.waitForTimeout(600);                                // past the repaint a switch would ask for
    await expect(onPill(page)).toHaveText('Home');
    await expect(frame.locator('#about-us')).toHaveCount(0);
    expect((puts[0] as Paged).blocks?.[0].subtitle).toBe('Changed my mind');
    expect(puts.length).toBe(1);
  });

  test('Duplicate page copies the words just typed, not the stored page from before them', async ({ page }) => {
    const { frame, puts } = await mountPages(page);
    let putsAtCopy = -1;
    await page.route('**/functions/v1/presence/pages/duplicate**', (route: Route) => {
      putsAtCopy = puts.length;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { slug: 'home-copy', title: 'Home copy', pages: [...PAGED.pages, { slug: 'home-copy', title: 'Home copy', blocks: BLOCKS }] } }) });
    });
    await typeOver(page, frame.locator('[data-dds-field="subtitle"]'), 'In the copy');
    await openPages(page); await pill(page, 'Home').locator('.pp-menu').click();
    await page.locator('.pp-pop-item', { hasText: 'Duplicate page' }).click();
    await expect(onPill(page)).toHaveText('Home copy');
    expect(putsAtCopy).toBe(1);
    expect((puts[0] as Paged).blocks?.[0].subtitle).toBe('In the copy');
  });

  test('＋ Page keeps the edit on the page it was made on', async ({ page }) => {
    const { frame, puts } = await mountPages(page);
    await openAbout(page, frame);
    await typeOver(page, frame.locator('#about-us [data-dds-field="subtitle"]'), 'Before the new page');
    await openPages(page); await page.locator('#pagesCard .page-add').click();
    await page.getByPlaceholder('e.g. Services, Gallery, Pricing').fill('Gallery');
    await page.getByRole('button', { name: 'Next: pick a layout' }).click();
    await page.locator('.dc-layout-card', { hasText: 'Blank page' }).click();
    await expect(onPill(page)).toHaveText('Gallery');
    const created = puts[puts.length - 1] as Paged;
    expect(created.pages?.map((p) => p.slug)).toEqual(['about', 'gallery']);
    expect(created.pages?.[0].blocks[0].subtitle).toBe('Before the new page');
  });

  test('Undo after deleting a page brings it back with the words typed just before', async ({ page }) => {
    const { frame, puts } = await mountPages(page);
    await answerAsks(page);
    await openAbout(page, frame);
    await typeOver(page, frame.locator('#about-us [data-dds-field="subtitle"]'), 'Worth keeping');
    await openPages(page); await pill(page, 'About').locator('.pp-menu').click();
    await page.locator('.pp-pop-item', { hasText: 'Delete page' }).click();
    await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('.dds-toast, #toast').filter({ hasText: 'restored' }).first()).toBeVisible();
    const restored = puts[puts.length - 1] as Paged;
    expect(restored.pages?.[0].blocks[0].subtitle).toBe('Worth keeping');
  });

  test('an in-place edit far down the page leaves the canvas where it was', async ({ page }) => {
    const { frame, puts } = await mountPages(page, FAR_DOWN);
    await typeOver(page, frame.locator('[data-dds-field="subtitle"]'), 'Far down');
    const before = await canvasScrollY(frame);
    expect(before).toBeGreaterThan(1000);
    await markCanvas(frame);
    await page.keyboard.press('Enter');
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(1);
    await canvasReplaced(frame);
    await expect.poll(() => canvasScrollY(frame)).toBeGreaterThan(before - 50);
    await page.waitForTimeout(800);                                // a second repaint would show here
    await expect.poll(() => canvasScrollY(frame)).toBeGreaterThan(before - 50);   // once it settles, as below
  });

  test('a session that held a repaint off and ends with nothing to save keeps the place too', async ({ page }) => {
    const { frame, puts } = await mountPages(page, FAR_DOWN);
    let reads = 0;
    let releaseRead = () => {};
    const heldRead = new Promise<void>((r) => { releaseRead = r; });
    await page.route('**/functions/v1/presence/preview**', async (route: Route) => { reads++; await heldRead; await route.fallback(); });
    await typeOver(page, frame.locator('[data-dds-field="title"]').first(), 'Saved first');
    await page.keyboard.press('Enter');
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(1);
    await expect.poll(() => reads, { timeout: 6000 }).toBe(1);
    const sub = frame.locator('[data-dds-field="subtitle"]');
    await sub.focus();
    await page.keyboard.press('Enter');
    await expect(sub).toHaveAttribute('contenteditable', /.+/);
    await markCanvas(frame);
    await frame.locator('body').evaluate((b) => b.ownerDocument.defaultView!.scrollBy(0, -600));   // moved on since that save
    const before = await canvasScrollY(frame);
    expect(before).toBeGreaterThan(1000);
    releaseRead();
    await page.waitForTimeout(500);
    await expect(frame.locator('body[data-e2e-old]')).toHaveCount(1);   // held
    await page.keyboard.press('Escape');
    await canvasReplaced(frame);
    await expect.poll(async () => Math.abs(await canvasScrollY(frame) - before)).toBeLessThan(50);
  });

  test('a page switch still starts at the top, even from far down with an edit on its way', async ({ page }) => {
    const { frame, puts } = await mountPages(page, FAR_DOWN);
    await typeOver(page, frame.locator('[data-dds-field="subtitle"]'), 'Far down, then away');
    expect(await canvasScrollY(frame)).toBeGreaterThan(1000);
    await openPages(page); await pill(page, 'About').locator('.pp-name').click();
    await expect(frame.locator('#about-us')).toBeAttached();
    await expect(frame.locator('#dds-dc-bar')).toBeAttached();
    await page.waitForTimeout(600);                                // a restored scroll lands at load
    expect(await canvasScrollY(frame)).toBe(0);
    expect((puts[0] as Paged).blocks?.[0].subtitle).toBe('Far down, then away');
  });

});
