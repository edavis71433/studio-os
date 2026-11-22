import { test, expect, Page, Route } from '@playwright/test';
import { showTips } from './helpers/app';
import { mountCanvas } from './helpers/editor';

// ── Small editor polish (builder list items 284, 285 and 286, full review of Nov 22 2026) ──
// The Notes button opens a Notes card and Escape puts Notes away (284); a page's name comes
// first in the Pages card and the top bar, with its status pill cut to a dot and two words
// (285); the hints and the Looks note start to the right of the dock (286).

const TREE = { data: { pages: [
  { key: 'home', label: 'Home', path: '/', status: 'missing_required', status_label: 'Needs something before publishing', issue_count: 1, editor_link: '/presence.html#business', auto: false, sections: [] },
] } };
const withTree = (p: Page) => p.route('**/functions/v1/presence/content-tree**', (route: Route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TREE) }));
const dockRight = async (page: Page) => { const d = (await page.locator('#dcDock').boundingBox())!; return d.x + d.width; };

test.describe('284: the Notes button', () => {
  test.beforeEach(({}, testInfo) => { test.skip(!!testInfo.project.use.hasTouch, 'the computer’s dock'); });

  test('opens a Notes card that lists the page and its sections, and Escape puts Notes away', async ({ page }) => {
    const { frame } = await mountCanvas(page);
    await page.locator('#btnTrayOpen').click();                       // another card is open
    await expect(page.locator('#trayPanel')).toBeVisible();
    await page.locator('#btnComments').click();
    const card = page.locator('#commentsPanel');
    await expect(card).toBeVisible();
    await expect(card.locator('#cmPanelTitle')).toHaveText('Notes');
    await expect(card).toContainText('No notes yet. Click a section to leave one.');
    await expect(card.locator('.cm-row-n')).toHaveText(['Whole page — Home', 'Title / heading', 'Text box', 'Call-to-action banner', 'Features / highlights']);
    await expect(page.locator('#trayPanel')).toBeHidden();            // the other card closed
    await expect(page.locator('#btnComments')).toHaveAttribute('aria-pressed', 'true');
    // a section on the page opens its notes; the thread's Close comes back to the list
    await frame.locator('section.block-cta').click();
    await expect(card.locator('#cmPanelTitle')).toHaveText('Call-to-action banner');
    await expect(card).toContainText('Notes on this section');
    await page.locator('#btnCommentsClose').click();
    await expect(card.locator('#cmPanelTitle')).toHaveText('Notes');
    // Escape: the card goes, and the button isn't left lit
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();
    await expect(page.locator('#btnComments')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#btnComments')).toHaveText('Notes');
  });

  test('a row in the card opens that section’s notes; pressing Notes again puts it all away', async ({ page }) => {
    await mountCanvas(page);
    await page.locator('#btnComments').click();
    const card = page.locator('#commentsPanel');
    await card.locator('.cm-row-n', { hasText: 'Text box' }).click();
    await expect(card.locator('#cmPanelTitle')).toHaveText('Text box');
    await page.locator('#btnComments').click();
    await expect(card).toBeHidden();
    await expect(page.locator('#btnComments')).toHaveAttribute('aria-pressed', 'false');
  });
});

test.describe('285: the page’s name comes first', () => {
  test('in the Pages card the name shows and the pill is two words; the top bar says the name', async ({ page }) => {
    await mountCanvas(page, { beforeGoto: withTree });
    await expect(page.locator('#dcPageName')).toHaveText('Home');
    await page.locator('#dcPageSwitch').click();   // the page statuses are read when the card first opens
    await expect(page.locator('#dcPageCount')).toHaveText('Needs something');
    await expect(page.locator('#dcPageCount')).toHaveAttribute('title', 'Needs something before publishing');
    const name = page.locator('#dcPageName');
    expect((await name.boundingBox())!.width).toBeGreaterThan(30);   // not "H…"
    const row = page.locator('#pagesCard .pc-row', { hasText: 'Home' }).first();
    await expect(row.locator('.pp-name')).toHaveText('Home');
    await expect(row.locator('.hb-chip')).toHaveText('Needs something');
    await expect(row.locator('.hb-chip')).toHaveAttribute('title', 'Needs something before publishing');
    const nb = (await row.locator('.pc-open').boundingBox())!;
    expect(nb.width).toBeGreaterThanOrEqual(96);
    expect(await row.locator('.pp-name').evaluate((n) => n.scrollWidth <= n.clientWidth + 1)).toBe(true);   // the whole word shows
  });
});

test.describe('286: hints start to the right of the dock', () => {
  test.beforeEach(({}, testInfo) => { test.skip(!!testInfo.project.use.hasTouch || (testInfo.project.use.viewport?.width ?? 0) <= 760, 'the computer’s dock'); });

  test('the Looks note and the editor’s tip both clear the dock', async ({ page }) => {
    await showTips(page);
    await mountCanvas(page);
    const hint = page.locator('.dds-hint.dds-live');
    await expect(hint).toBeVisible();
    const right = await dockRight(page);
    expect((await hint.boundingBox())!.x).toBeGreaterThanOrEqual(right);
    await page.evaluate(() => (window as unknown as { openSettingsPanel: (m: string) => void }).openSettingsPanel('styles'));
    await expect(page.locator('html')).toHaveClass(/dc-zoomout/);
    const note = page.locator('#dcZoomNote');
    await expect(note).toBeVisible();
    await expect(note).toHaveText('The whole page · back to full size when you leave Looks');
    expect((await note.boundingBox())!.x).toBeGreaterThanOrEqual(right);
  });
});
