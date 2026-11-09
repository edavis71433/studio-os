import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES, answerAsks, setAsksAnswer, askedSoFar } from './helpers/app';
import { ABOUT_BLOCKS, ABOUT_SECTION, aboutField, aboutIn, aboutSaveOut, addGallery, ANSWER_HEADERS, API, backToCanvas, BLOCKS, blocksIn, canvasReplaced, canvasScrollY, CONTACT, draftReads, draftVersion, duplicate, editAndWaitOut, editHome, FAR_DOWN, Field, FORM, FormBlocks, formSaveOut, Frame, GALLERY, hasTheirs, hideOut, holdPuts, holdReads, homeLine, lastPut, lastTwo, markCanvas, menuRows, META, mountCanvas, Mounted, mountPages, moveThenWrite, NORM_BLOCKS, NORM_META, NORM_SECTIONS, nudge, onPill, openAbout, openBusiness, OWN_MENU, OWN_PAGES, PAGE_HTML, Paged, PAGED, pageIn, pageMenu, panelEdit, pill, pillNames, previewHtml, redo, refusal, renameContact, SECTIONS, selectInBody, SETTINGS, slugs, stored, STORY, storyIn, STRIP, THEIRS, theirSection, typeDetail, typeOver, undo, WITH_CONTACT, WITH_FORM, writeOnAboutAndLeave } from './helpers/editor';

// ── G13 in-place canvas text editor — writes to /settings that overlap, and reads landing out of order ──
// Split from g13-editor.spec.ts (builder list item 109, Nov 2026): the fixtures and
// helpers live in helpers/editor.ts; the tests here are as they were.

test.describe('G13 in-place canvas text editor — writes to /settings that overlap, and reads landing out of order', () => {
  test('an edit saved while Hide from menu is out keeps the hide', async ({ page }) => {
    const { frame, draft } = await mountPages(page);
    const { sent, release } = await hideOut(page, frame);
    await editAndWaitOut(page, frame, 'Edit while hiding');
    release();
    await expect.poll(() => sent.length, { timeout: 6000 }).toBe(2);
    expect(aboutIn(sent[1])?.hideNav).toBe(true);
    expect(aboutIn(sent[1])?.blocks[0].subtitle).toBe('Edit while hiding');
    await expect.poll(() => aboutIn(stored(draft))?.hideNav, { timeout: 6000 }).toBe(true);
    await expect(pill(page, 'About')).toContainText('(hidden)');
  });

  test('a Hide slow to land can\'t undo an edit saved after it', async ({ page }) => {
    const { frame, draft } = await mountPages(page);
    await openAbout(page, frame);
    let release = () => {};
    const held = new Promise<void>((r) => { release = r; });
    let first = true;
    await page.route('**/functions/v1/presence/settings**', async (route: Route) => {
      if (route.request().method() === 'PUT' && first) { first = false; await held; }
      await route.fallback();
    });
    await pageMenu(page, 'About', 'Hide from menu');
    await editAndWaitOut(page, frame, 'Saved after the hide');
    release();
    await expect(pill(page, 'About')).toContainText('(hidden)');   // the hide has landed
    await expect.poll(() => aboutIn(stored(draft))?.blocks[0].subtitle, { timeout: 6000 }).toBe('Saved after the hide');
    expect(aboutIn(stored(draft))?.hideNav).toBe(true);
  });

  test('an edit saved while a move on the Pages tab is out keeps the new order', async ({ page }) => {
    const { frame } = await mountPages(page, '', OWN_PAGES);
    await openAbout(page, frame, 'Story');
    const { sent, release } = await holdPuts(page);
    await nudge(page, 'Story', 'ArrowDown');
    await expect.poll(() => sent.length, { timeout: 6000 }).toBe(1);
    await backToCanvas(page, frame);
    await editAndWaitOut(page, frame, 'Edit while moving');
    release();
    await expect.poll(() => sent.length, { timeout: 6000 }).toBe(2);
    expect(slugs(sent[1])).toEqual(['gallery', 'story']);
    expect(storyIn(sent[1])?.blocks[0].subtitle).toBe('Edit while moving');
  });

  test('an edit saved while Rename is out stays on the renamed page, and so do later edits', async ({ page }) => {
    const { frame, draft } = await mountPages(page);
    await page.route('**/functions/v1/presence/preview**', (route: Route) =>
      new URL(route.request().url()).searchParams.get('page') === '/our-story/'
        ? route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE_HTML(ABOUT_SECTION) }) : route.fallback());
    await page.route('**/functions/v1/presence/settings**', (route: Route) => {   // the server strips the marker before storing
      if (route.request().method() !== 'PUT') return route.fallback();
      const body = route.request().postDataJSON() as { pages?: Array<{ prev_slug?: string }> };
      body.pages?.forEach((p) => { delete p.prev_slug; });
      return route.fallback({ postData: JSON.stringify(body) });
    });
    await openAbout(page, frame);
    const { sent, release } = await holdPuts(page);
    await pageMenu(page, 'About', 'Rename');
    await page.locator('dialog input').fill('Our story');
    await page.getByRole('button', { name: 'Next' }).click();
    await page.locator('dialog input').fill('our-story');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => sent.length, { timeout: 6000 }).toBe(1);
    await editAndWaitOut(page, frame, 'Edit while renaming');
    release();
    await expect.poll(() => sent.length, { timeout: 6000 }).toBe(2);
    const renamed = (put: Paged) => put.pages?.find((p) => p.slug === 'our-story');
    expect(sent[1].pages?.map((p) => p.slug)).toEqual(['our-story']);
    expect(renamed(sent[1])?.title).toBe('Our story');
    expect(renamed(sent[1])?.blocks[0].subtitle).toBe('Edit while renaming');
    await expect(onPill(page)).toHaveText('Our story');
    await page.evaluate(() => (window as unknown as { dcDuplicate: (bi: number) => void }).dcDuplicate(0));
    await expect.poll(() => renamed(stored(draft))?.blocks.length, { timeout: 6000 }).toBe(2);
  });

  test('a section change made outside the in-place editor while Hide is out keeps the hide, and two of them are one write', async ({ page }) => {
    const { frame } = await mountPages(page);
    const { sent, release } = await hideOut(page, frame);
    await page.evaluate(() => {
      const w = window as unknown as { dcDuplicate: (bi: number) => void };
      w.dcDuplicate(0);
      w.dcDuplicate(0);
    });
    await page.waitForTimeout(300);
    release();
    await expect.poll(() => sent.length, { timeout: 6000 }).toBeGreaterThanOrEqual(2);
    expect(aboutIn(sent[1])?.hideNav).toBe(true);
    expect(aboutIn(sent[1])?.blocks.length).toBe(3);
    await page.waitForTimeout(1800);                               // and nothing is left to save
    expect(sent.length).toBe(2);
  });

  test('a page deleted while Hide is out keeps the hide', async ({ page }) => {
    const { frame } = await mountPages(page, '', [...PAGED.pages, CONTACT]);
    await answerAsks(page);
    const { sent, release } = await hideOut(page, frame);
    await pageMenu(page, 'Contact', 'Delete page');
    await page.waitForTimeout(300);
    release();
    await expect.poll(() => sent.length, { timeout: 6000 }).toBe(2);
    expect(sent[1].pages?.map((p) => p.slug)).toEqual(['about']);
    expect(aboutIn(sent[1])?.hideNav).toBe(true);
  });

  test('Undo of a page delete while Hide is out keeps the hide', async ({ page }) => {
    const { frame } = await mountPages(page, '', [...PAGED.pages, CONTACT]);
    await answerAsks(page);
    await openAbout(page, frame);
    await pageMenu(page, 'Contact', 'Delete page');
    const undo = page.locator('.toast').getByRole('button', { name: 'Undo' });
    await expect(undo).toBeVisible();
    const { sent, release } = await holdPuts(page);
    await pageMenu(page, 'About', 'Hide from menu');
    await expect.poll(() => sent.length, { timeout: 6000 }).toBe(1);
    await undo.click();
    await page.waitForTimeout(300);
    release();
    await expect.poll(() => sent.length, { timeout: 6000 }).toBe(2);
    expect(sent[1].pages?.map((p) => p.slug)).toEqual(['about', 'contact']);
    expect(aboutIn(sent[1])?.hideNav).toBe(true);
  });

  test('＋ Page while Hide is out keeps the hide', async ({ page }) => {
    const { frame } = await mountPages(page);
    const { sent, release } = await hideOut(page, frame);
    await page.locator('#pagesBar .page-add').click();
    await page.getByPlaceholder('e.g. Services, Gallery, Pricing').fill('Gallery');
    await page.getByRole('button', { name: 'Next: pick a layout' }).click();
    await page.locator('.dc-layout-card', { hasText: 'Blank page' }).click();
    await page.waitForTimeout(300);
    release();
    await expect.poll(() => sent.length, { timeout: 6000 }).toBe(2);
    expect(sent[1].pages?.map((p) => p.slug)).toEqual(['about', 'gallery']);
    expect(aboutIn(sent[1])?.hideNav).toBe(true);
  });

  test('Duplicate page while Hide is out copies the list with the hide in it', async ({ page }) => {
    const { frame, draft } = await mountPages(page);
    await page.route('**/functions/v1/presence/pages/duplicate**', (route: Route) => {
      const pages = [...(stored(draft).pages ?? []), { slug: 'about-copy', title: 'About copy', blocks: ABOUT_BLOCKS }];
      draft.pages = pages;      // the server rewrites the column from what it has stored right now
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { slug: 'about-copy', title: 'About copy', pages } }) });
    });
    const { release } = await hideOut(page, frame);
    await pageMenu(page, 'About', 'Duplicate page');
    await page.waitForTimeout(300);
    release();
    await expect(onPill(page)).toHaveText('About copy');
    expect(stored(draft).pages?.map((p) => p.slug)).toEqual(['about', 'about-copy']);
    expect(aboutIn(stored(draft))?.hideNav).toBe(true);
  });

  test('an edit saved while Hide is out isn\'t refused as someone else\'s change', async ({ page }) => {
    const { frame, draft } = await mountPages(page);
    let hash = 'e2e-draft-hash', refused = 0;           // the real guard: a write naming a version the draft has left is a 409
    await page.route('**/functions/v1/presence/changes**', (route: Route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: hash } }) }));
    await page.route('**/functions/v1/presence/settings**', (route: Route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      const named = route.request().headers()['if-match'];
      if (named && named !== hash) {
        refused++;
        return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'stale_draft', current_hash: hash, last_change: null }) });
      }
      hash = hash + '+';
      return route.fallback();
    });
    const { sent, release } = await hideOut(page, frame);
    await editAndWaitOut(page, frame, 'Mine, not theirs');
    release();
    await expect.poll(() => sent.length, { timeout: 6000 }).toBe(2);
    await expect.poll(() => ({ refused, line: aboutIn(stored(draft))?.blocks[0].subtitle }), { timeout: 6000 }).toEqual({ refused: 0, line: 'Mine, not theirs' });
    expect(aboutIn(stored(draft))?.hideNav).toBe(true);
  });

  test('a menu edit\'s slow answer can\'t put back the page list from before a later write', async ({ page }) => {
    const { frame, draft } = await mountPages(page);
    await openAbout(page, frame);
    let release = () => {};
    const held = new Promise<void>((r) => { release = r; });
    await page.route('**/functions/v1/presence/settings**', async (route: Route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      const body = route.request().postDataJSON() as Record<string, unknown>;
      if (!('nav' in body)) return route.fallback();
      Object.assign(draft, body);    // stored straight away, with the row as it stands now in the answer
      const answer = JSON.stringify({ data: { ...draft, section_meta: META } });
      await held;
      return route.fulfill({ status: 200, contentType: 'application/json', body: answer });
    });
    await page.evaluate(() => { (window as unknown as { dcSaveNav: (n: unknown[]) => void }).dcSaveNav([{ label: 'Home', href: '/' }]); });
    await page.waitForTimeout(200);
    await pageMenu(page, 'About', 'Hide from menu');
    await page.waitForTimeout(300);
    release();
    await page.waitForTimeout(300);                                // the slow answer has landed
    await expect(pill(page, 'About')).toContainText('(hidden)');
    await page.evaluate(() => (window as unknown as { dcDuplicate: (bi: number) => void }).dcDuplicate(0));
    await expect.poll(() => aboutIn(stored(draft))?.blocks.length, { timeout: 6000 }).toBe(2);
    expect(aboutIn(stored(draft))?.hideNav).toBe(true);
    expect(draft.nav).toEqual([{ label: 'Home', href: '/' }]);
  });

  test('Hide from menu while a form save is out keeps the form change', async ({ page }) => {
    const { frame, draft } = await mountPages(page, '', WITH_FORM);
    const { sent, release } = await formSaveOut(page, frame);
    await pageMenu(page, 'About', 'Hide from menu');
    await page.waitForTimeout(300);
    release();
    await expect.poll(() => sent.length, { timeout: 6000 }).toBe(2);
    expect(aboutIn(sent[1])?.hideNav).toBe(true);
    expect((aboutIn(sent[1])?.blocks as unknown as FormBlocks)[1].title).toBe('Write to us');
    await expect.poll(() => (aboutIn(stored(draft))?.blocks as unknown as FormBlocks)[1].title, { timeout: 6000 }).toBe('Write to us');
  });

  test('a section edit committed while a form save is out is kept, and so is the form change', async ({ page }) => {
    const { frame, draft } = await mountPages(page, '', WITH_FORM);
    const { sent, release } = await formSaveOut(page, frame);
    await typeOver(page, aboutField(frame), 'Edit while the form saves');
    await page.keyboard.press('Enter');
    release();                                                     // the form lands inside the edit's debounce
    await expect.poll(() => sent.length, { timeout: 6000 }).toBe(2);
    const saved = aboutIn(sent[1])?.blocks as unknown as FormBlocks;
    expect(saved[0].subtitle).toBe('Edit while the form saves');
    expect(saved[1].title).toBe('Write to us');
    await page.waitForTimeout(1000);                               // the list is rebuilt from what came back
    expect(await page.evaluate(() => (0, eval)('BLOCKS_WORK[0].subtitle'))).toBe('Edit while the form saves');
    expect((aboutIn(stored(draft))?.blocks as unknown as FormBlocks)[0].subtitle).toBe('Edit while the form saves');
    expect(sent.length).toBe(2);
  });

  test('two reads landing out of order leave the newer text on the canvas', async ({ page }) => {
    const { frame, puts, draft } = await mountPages(page);
    const { reads, releases } = await draftReads(page, draft, (read) => read === 1);
    await typeOver(page, homeLine(frame), 'First edit');
    await page.keyboard.press('Enter');
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(1);
    await expect.poll(() => reads(), { timeout: 6000 }).toBe(1);
    await typeOver(page, homeLine(frame), 'Second edit');
    await page.keyboard.press('Enter');
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(2);
    await expect(homeLine(frame)).toHaveText('Second edit');
    await expect(frame.locator('#dds-dc-bar')).toBeAttached();
    await markCanvas(frame);
    releases[0]();                                                 // the older read, last
    await page.waitForTimeout(800);
    await expect(homeLine(frame)).toHaveText('Second edit');
    await expect(frame.locator('body[data-e2e-old]')).toHaveCount(1);
  });

  test('a stream of edits with slow reads still paints each read that moves the canvas forward', async ({ page }) => {
    const { frame, puts, draft } = await mountPages(page);
    const { reads, releases } = await draftReads(page, draft, () => true);
    await typeOver(page, homeLine(frame), 'First edit');
    await page.keyboard.press('Enter');
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(1);
    await expect.poll(() => reads(), { timeout: 6000 }).toBe(1);
    await typeOver(page, homeLine(frame), 'Second edit');
    await page.keyboard.press('Enter');
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(2);
    await expect.poll(() => reads(), { timeout: 6000 }).toBe(2);
    releases[0]();                                                 // older than the newest read out, newer than the canvas
    await expect(homeLine(frame)).toHaveText('First edit');
    releases[1]();
    await expect(homeLine(frame)).toHaveText('Second edit');
  });

});
