import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES, answerAsks, setAsksAnswer, askedSoFar } from './helpers/app';
import { ABOUT_BLOCKS, ABOUT_SECTION, aboutField, aboutIn, aboutSaveOut, addGallery, ANSWER_HEADERS, API, backToCanvas, BLOCKS, blocksIn, canvasReplaced, canvasScrollY, CONTACT, draftReads, draftVersion, duplicate, editAndWaitOut, editHome, FAR_DOWN, Field, FORM, FormBlocks, formSaveOut, Frame, GALLERY, hasTheirs, hideOut, holdPuts, holdReads, homeLine, lastPut, lastTwo, markCanvas, menuRows, META, mountCanvas, Mounted, mountPages, moveThenWrite, NORM_BLOCKS, NORM_META, NORM_SECTIONS, nudge, onPill, openAbout, openBusiness, OWN_MENU, OWN_PAGES, PAGE_HTML, Paged, PAGED, pageIn, pageMenu, panelEdit, pill, pillNames, previewHtml, redo, refusal, renameContact, SECTIONS, selectInBody, SETTINGS, slugs, stored, STORY, storyIn, STRIP, THEIRS, theirSection, typeDetail, typeOver, undo, WITH_CONTACT, WITH_FORM, writeOnAboutAndLeave } from './helpers/editor';

// ── G13 in-place canvas text editor — the draft version a write names, and another person’s change ──
// Split from g13-editor.spec.ts (builder list item 109, Nov 2026): the fixtures and
// helpers live in helpers/editor.ts; the tests here are as they were.

test.describe('G13 in-place canvas text editor — the draft version a write names, and another person’s change', () => {
  test('a business detail typed while a section save\'s answer is on its way isn\'t refused', async ({ page }) => {
    const { frame, draft } = await mountPages(page);
    const held = await holdPuts(page);
    const v = await draftVersion(page);                            // the save lands, and only its answer is slow
    await editHome(page, frame, 'My section words');
    await expect.poll(() => held.sent.length, { timeout: 6000 }).toBe(1);
    await openBusiness(page);
    await typeDetail(page, '#f-tagline', 'My tagline');
    held.release();
    await expect.poll(() => v.business.tagline, { timeout: 6000 }).toBe('My tagline');
    expect(v.refused).toEqual([]);
    await expect(refusal(page)).toHaveCount(0);
    expect(blocksIn(draft)[0].subtitle).toBe('My section words');
  });

  test('a section save slow to arrive isn\'t refused for a business detail that got there first', async ({ page }) => {
    const { frame, draft } = await mountPages(page);
    const v = await draftVersion(page);
    const held = await holdPuts(page);                             // the save is still on its way to the server
    await editHome(page, frame, 'My section words');
    await expect.poll(() => held.sent.length, { timeout: 6000 }).toBe(1);
    await openBusiness(page);
    await typeDetail(page, '#f-tagline', 'My tagline');
    held.release();
    await expect.poll(() => blocksIn(draft)[0].subtitle, { timeout: 6000 }).toBe('My section words');
    await expect.poll(() => v.business.tagline, { timeout: 6000 }).toBe('My tagline');
    expect(v.refused).toEqual([]);
    await expect(refusal(page)).toHaveCount(0);
  });

  test('two business details typed one after the other on a slow connection are both saved', async ({ page }) => {
    await mountPages(page);
    const v = await draftVersion(page);
    let release = () => {};
    v.slowAnswer = new Promise<void>((r) => { release = r; });
    await openBusiness(page);
    await typeDetail(page, '#f-business_name', 'Marlow and Sons');
    await typeDetail(page, '#f-tagline', 'Wine and pasta');
    release();
    await expect.poll(() => v.business.tagline, { timeout: 6000 }).toBe('Wine and pasta');
    expect(v.business.business_name).toBe('Marlow and Sons');
    expect(v.refused).toEqual([]);
    await expect(refusal(page)).toHaveCount(0);
  });

  test('a /changes answer landing after a later write doesn\'t bring back the version from before it', async ({ page }) => {
    const { draft } = await mountPages(page);
    const v = await draftVersion(page, { versions: false });     // the page finds the version by reading, as before answers named it
    let release = () => {};
    v.slowRead = new Promise<void>((r) => { release = r; });
    const reads = v.reads;
    await duplicate(page);
    await expect.poll(() => v.landed.length, { timeout: 6000 }).toBe(1);
    await expect.poll(() => v.reads, { timeout: 6000 }).toBe(reads + 1);   // the read is out, and has read this version
    await duplicate(page);
    await expect.poll(() => v.landed.length, { timeout: 6000 }).toBe(2);
    await expect.poll(() => v.reads, { timeout: 6000 }).toBe(reads + 2);   // that write's own read has come and gone
    await page.waitForTimeout(200);
    release();                                                     // the older read, last
    await page.waitForTimeout(300);
    await duplicate(page);
    await expect.poll(() => v.landed.length + v.refused.length, { timeout: 6000 }).toBe(3);
    expect(v.refused).toEqual([]);
    await expect(refusal(page)).toHaveCount(0);
    await expect.poll(() => blocksIn(draft).length, { timeout: 6000 }).toBe(BLOCKS.length + 3);
  });

  test('Publish opened as a save lands doesn\'t refuse the next field\'s save', async ({ page }) => {
    await mountPages(page);
    const v = await draftVersion(page);
    await openBusiness(page);
    let release = () => {};
    v.slowRead = new Promise<void>((r) => { release = r; });
    const reads = v.reads;
    const landedAtRead: number[] = [];
    await page.route('**/functions/v1/presence/changes**', (route: Route) => { landedAtRead.push(v.landed.length); return route.fallback(); });
    await page.locator('#f-tagline').fill('My tagline');
    await page.evaluate(() => (window as unknown as { openRitual: () => void }).openRitual());   // opened while that field's timer runs
    await expect.poll(() => v.reads, { timeout: 6000 }).toBe(reads + 1);
    await expect.poll(() => v.landed, { timeout: 6000 }).toEqual(['/identity']);
    await page.locator('#f-phone').fill('555 0100');               // its timer runs out after the review's answer is in
    release();
    await expect.poll(() => v.business.phone, { timeout: 6000 }).toBe('555 0100');
    expect(v.refused).toEqual([]);
    await expect(refusal(page)).toHaveCount(0);
    expect(landedAtRead[0]).toBe(1);                               // what's reviewed includes that save: Publish sends it and waits before it reads
  });

  test('a read dropped for being late is read again, so another person\'s change is still caught', async ({ page }) => {
    const { draft } = await mountPages(page);
    const v = await draftVersion(page, { versions: false });     // the page finds the version by reading, as before answers named it
    let release = () => {};
    v.slowRead = new Promise<void>((r) => { release = r; });
    const reads = v.reads;
    await duplicate(page);
    await expect.poll(() => v.reads, { timeout: 6000 }).toBe(reads + 1);
    await pageMenu(page, 'About', 'Hide from menu');               // a write that doesn't ask for a read of its own
    await expect.poll(() => v.landed.length, { timeout: 6000 }).toBe(2);
    await page.waitForTimeout(1500);                               // nothing else is coming to read the draft
    expect(v.reads).toBe(reads + 1);
    release();
    await expect.poll(() => v.reads, { timeout: 6000 }).toBe(reads + 2);
    await page.waitForTimeout(200);
    v.someoneElse();
    const before = blocksIn(draft).length;
    await duplicate(page);
    await expect.poll(() => v.refused, { timeout: 6000 }).toEqual(['/settings']);
    await expect(refusal(page)).toBeVisible();
    expect(blocksIn(draft).length).toBe(before);
  });

  test('another person\'s change is still refused, and Load the latest lets the person carry on', async ({ page }) => {
    const { frame, draft } = await mountPages(page);
    const v = await draftVersion(page);
    v.someoneElse();
    await editHome(page, frame, 'Over their change');
    await expect.poll(() => v.refused, { timeout: 6000 }).toEqual(['/settings']);
    expect(v.landed).toEqual([]);
    expect(blocksIn(draft)[0].subtitle).toBe('A quiet sub line');
    await expect(refusal(page)).toBeVisible();
    await page.getByRole('button', { name: 'Load the latest' }).click();
    await expect(page.getByText('Loaded the latest version')).toBeVisible();
    await duplicate(page);                                         // having loaded it, the next edit goes through
    await expect.poll(() => v.landed, { timeout: 6000 }).toEqual(['/settings']);
    expect(v.refused).toEqual(['/settings']);
  });

  test('a refused business detail offers Load the latest too, once, and after it the next save goes through', async ({ page }) => {
    await mountPages(page);
    const v = await draftVersion(page);
    v.someoneElse();
    await openBusiness(page);
    await typeDetail(page, '#f-tagline', 'Over their tagline');
    await expect.poll(() => v.refused, { timeout: 6000 }).toEqual(['/identity']);
    await typeDetail(page, '#f-tagline', 'Over their tagline again');   // refused again, the same way out still up
    await expect.poll(() => v.refused, { timeout: 6000 }).toEqual(['/identity', '/identity']);
    await expect(page.getByRole('button', { name: 'Load the latest' })).toHaveCount(1);
    await expect(refusal(page)).toHaveCount(1);                       // no second copy of the sentence beside it
    await page.getByRole('button', { name: 'Load the latest' }).click();
    await expect(page.getByText('Loaded the latest version')).toBeVisible();
    await expect.poll(() => v.reads, { timeout: 6000 }).toBeGreaterThan(0);
    await page.waitForTimeout(300);
    await typeDetail(page, '#f-tagline', 'After loading');
    await expect.poll(() => v.landed, { timeout: 6000 }).toEqual(['/identity']);
    expect(v.business).toEqual({ tagline: 'After loading' });
  });

  test('another person\'s change refuses a business detail waiting behind a section save too', async ({ page }) => {
    const { frame, draft } = await mountPages(page);
    const v = await draftVersion(page);
    const held = await holdPuts(page);
    v.someoneElse();
    await editHome(page, frame, 'Over their change');
    await expect.poll(() => held.sent.length, { timeout: 6000 }).toBe(1);
    await openBusiness(page);
    await typeDetail(page, '#f-tagline', 'Over their tagline');
    held.release();
    await expect.poll(() => [...v.refused].sort(), { timeout: 6000 }).toEqual(['/identity', '/settings']);
    expect(v.landed).toEqual([]);
    expect(v.business).toEqual({});
    expect(blocksIn(draft)[0].subtitle).toBe('A quiet sub line');
  });

  test('a read answered while a write is out doesn\'t let the write behind it through', async ({ page }) => {
    const { frame, draft } = await mountPages(page);
    const v = await draftVersion(page);
    const held = await holdPuts(page);
    v.someoneElse();
    await editHome(page, frame, 'Over their change');
    await expect.poll(() => held.sent.length, { timeout: 6000 }).toBe(1);
    await openBusiness(page);
    await typeDetail(page, '#f-tagline', 'Over their tagline');
    const reads = v.reads;
    await page.evaluate(() => (window as unknown as { go: (v: string) => void }).go('today'));   // reads the draft as it stands, their change and all
    await expect.poll(() => v.reads, { timeout: 6000 }).toBeGreaterThan(reads);
    await page.waitForTimeout(200);
    held.release();
    await expect.poll(() => [...v.refused].sort(), { timeout: 6000 }).toEqual(['/identity', '/settings']);
    expect(v.business).toEqual({});
    expect(blocksIn(draft)[0].subtitle).toBe('A quiet sub line');
  });

  test('a menu edit waiting behind a refused save is refused too, not let through on the new version', async ({ page }) => {
    const { frame, draft } = await mountPages(page);
    const v = await draftVersion(page);
    const held = await holdPuts(page);
    v.someoneElse();
    await editHome(page, frame, 'Over their change');
    await expect.poll(() => held.sent.length, { timeout: 6000 }).toBe(1);
    await page.evaluate(() => { (window as unknown as { dcSaveNav: (n: unknown[]) => void }).dcSaveNav([{ label: 'Home', href: '/' }]); });
    await page.waitForTimeout(200);
    held.release();
    await expect.poll(() => v.refused, { timeout: 6000 }).toEqual(['/settings', '/settings']);
    expect(v.landed).toEqual([]);
    expect(draft.nav).toBeUndefined();
  });

  test('another person\'s change just after a save is caught by the next save, not taken in by the refresh', async ({ page }) => {
    const { draft } = await mountPages(page);
    const v = await draftVersion(page);
    const reads = v.reads;
    await duplicate(page);
    await expect.poll(() => v.landed.length, { timeout: 6000 }).toBe(1);
    theirSection(v, draft);                                        // theirs lands just after mine
    await expect.poll(() => v.reads, { timeout: 6000 }).toBe(reads + 1);   // the read after my save sees it
    await page.waitForTimeout(300);
    await duplicate(page);
    await expect.poll(() => v.refused, { timeout: 6000 }).toEqual(['/settings']);
    await expect(refusal(page)).toBeVisible();
    expect(v.landed).toEqual(['/settings']);
    expect(hasTheirs(draft)).toBe(true);
  });

  test('a save right after another names the version the first one left', async ({ page }) => {
    const { draft } = await mountPages(page);
    const v = await draftVersion(page);
    const named: Array<string | undefined> = [];
    page.on('request', (r) => { if (r.method() === 'PUT' && r.url().includes('/presence/settings')) named.push(r.headers()['if-match']); });
    await duplicate(page);
    await expect.poll(() => v.landed.length, { timeout: 6000 }).toBe(1);
    theirSection(v, draft);
    await duplicate(page);                                         // before any read of the draft
    await expect.poll(() => v.refused, { timeout: 6000 }).toEqual(['/settings']);
    expect(named).toEqual(['e2e-draft-hash', 'e2e-draft-hash+']);
    expect(hasTheirs(draft)).toBe(true);
  });

  test('a business detail saved just after a section save is checked against the version it left', async ({ page }) => {
    const { frame } = await mountPages(page);
    const v = await draftVersion(page);
    await editHome(page, frame, 'My section words');
    await expect.poll(() => v.landed.length, { timeout: 6000 }).toBe(1);
    v.someoneElse(); v.business.business_name = 'Their name';
    await openBusiness(page);
    await page.locator('#f-business_name').fill('My name');
    await expect.poll(() => v.refused, { timeout: 6000 }).toEqual(['/identity']);
    expect(v.business.business_name).toBe('Their name');
  });

  test('Publish\'s review doesn\'t hand the next save another person\'s change, and Publish names what was reviewed', async ({ page }) => {
    const { draft } = await mountPages(page);
    const v = await draftVersion(page);
    const published: Array<string | undefined> = [];
    await page.route('**/functions/v1/presence/publish', (route: Route) => {
      published.push(route.request().headers()['if-match']);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { status: 'live' } }) });
    });
    theirSection(v, draft);
    const reads = v.reads;
    await page.evaluate(() => (window as unknown as { openRitual: () => void }).openRitual());   // reads the draft, their section and all
    await expect.poll(() => v.reads, { timeout: 6000 }).toBe(reads + 1);
    await page.evaluate(() => (window as unknown as { runPublish: (b: HTMLButtonElement, f: boolean) => Promise<void> }).runPublish(document.createElement('button'), false));
    expect(published).toEqual([v.hash]);
    await page.evaluate(() => (window as unknown as { closeRitual: () => void }).closeRitual());   // back to the overview, which reads it again
    await expect.poll(() => v.reads, { timeout: 6000 }).toBe(reads + 2);
    await page.waitForTimeout(200);
    await duplicate(page);
    await expect.poll(() => v.refused, { timeout: 6000 }).toEqual(['/settings']);
    expect(v.landed).toEqual([]);
    expect(hasTheirs(draft)).toBe(true);
  });

  test('with a server that doesn\'t say which version a save left, a run of saves still isn\'t refused', async ({ page }) => {
    const { draft } = await mountPages(page);
    const v = await draftVersion(page, { versions: false });
    await duplicate(page);
    await expect.poll(() => v.landed.length, { timeout: 6000 }).toBe(1);
    await duplicate(page);
    await expect.poll(() => v.landed.length, { timeout: 6000 }).toBe(2);
    await page.waitForTimeout(1500);                               // the read after them finds the version
    await duplicate(page);
    await expect.poll(() => v.landed.length + v.refused.length, { timeout: 6000 }).toBe(3);
    expect(v.refused).toEqual([]);
    await expect(refusal(page)).toHaveCount(0);
    expect(blocksIn(draft).length).toBe(BLOCKS.length + 3);
  });

});
