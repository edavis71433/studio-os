import { test, expect, Page, Route } from '@playwright/test';
import { installApp, settled } from './helpers/app';
import { API, PAGE_HTML, SECTIONS, SETTINGS } from './helpers/editor';

// ── Builder item 38: the editor in parts ─────────────────────────────────────
// presence-core.js loads with the page; presence-edit.js (Edit mode) loads the first time Edit
// mode is wanted, or once the page has settled. These hold the part back, or refuse it, to show
// the page doesn't depend on it before then, and that Edit mode waits for it.
const PART = /\/presence-edit\.js(\?|$)/;

/** Hold Edit mode's part until release(); `refuse` answers it with a failure instead. */
async function holdPart(page: Page, how: { refuse?: boolean } = {}) {
  let release = () => {};
  const held = new Promise<void>((r) => { release = r; });
  let asked = 0;
  const state = { refuse: !!how.refuse, hold: !how.refuse };
  await page.route(PART, async (route: Route) => {
    asked++;
    if (state.refuse) return route.abort('failed');
    if (state.hold) await held;
    return route.fallback();
  });
  return { release, asked: () => asked, allow: () => { state.refuse = false; } };
}
const partIn = (page: Page) => page.evaluate(() => !!((window as unknown as { __ddsParts?: Record<string, boolean> }).__ddsParts || {}).edit);

async function openEditor(page: Page, hash = '') {
  await installApp(page, { api: { ...API, '/settings': { data: SETTINGS }, 'PUT /identity': (sent: Record<string, unknown>) => ({ data: sent }) } });
  await page.route('**/functions/v1/presence/preview**', (route: Route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE_HTML(SECTIONS) }));
  await page.goto('/presence.html' + hash);
}

test.describe('the editor in parts (item 38)', () => {
  test('the Overview opens and works while Edit mode’s part is still on its way', async ({ page }) => {
    const part = await holdPart(page);
    const asked: string[] = [];
    page.on('request', (r) => { if (r.url().startsWith(new URL(page.url() === 'about:blank' ? 'http://x' : page.url()).origin) || /\/presence[.-]/.test(r.url())) asked.push(new URL(r.url()).pathname); });
    try {
      await openEditor(page);
      await expect(page.locator('#ssStatus')).not.toBeEmpty();
      // the page brings its styles and its core, and nothing else of the editor's, with it
      expect(asked).toEqual(expect.arrayContaining(['/presence.html', '/presence.css', '/presence-core.js']));
      await expect(page.frameLocator('#siteFrame').locator('section').first()).toBeVisible();
      await expect.poll(() => part.asked(), { message: 'the part is asked for once the page has settled' }).toBeGreaterThan(0);
      expect(await partIn(page)).toBe(false);
      // the tabs work without it
      await page.evaluate(() => (window as unknown as { go: (v: string) => void }).go('business'));
      await expect(page.locator('#f-business_name')).toBeVisible();
    } finally { part.release(); }
    await expect.poll(() => partIn(page)).toBe(true);
  });

  test('Edit site waits for its part, then draws the canvas', async ({ page }) => {
    const part = await holdPart(page);
    try {
      await openEditor(page);
      await expect(page.locator('#ssStatus')).not.toBeEmpty();
      await page.locator('#btnEditSite').click();
      await expect(page.locator('html')).toHaveClass(/dc-edit/);
      expect(await partIn(page)).toBe(false);
      await expect(page.frameLocator('#designPreview').locator('#dds-dc-bar')).toHaveCount(0);
    } finally { part.release(); }
    await expect(page.frameLocator('#designPreview').locator('#main > section').first()).toBeVisible();
    await expect(page.frameLocator('#designPreview').locator('#dds-dc-bar')).toBeAttached();
    await expect(page.locator('#btnPublish')).toHaveText(/Publish/);
  });

  test('a part that doesn’t load says so, and the next try loads it', async ({ page }) => {
    const part = await holdPart(page, { refuse: true });
    await openEditor(page);
    await expect(page.locator('#ssStatus')).not.toBeEmpty();
    await page.locator('#btnEditSite').click();
    await expect(page.locator('.dds-toast, [role="status"], [role="alert"]').filter({ hasText: 'didn’t load' }).first()).toBeVisible();
    expect(await partIn(page)).toBe(false);
    part.allow();
    await page.evaluate(() => (window as unknown as { go: (v: string) => void }).go('design'));
    await expect(page.frameLocator('#designPreview').locator('#dds-dc-bar')).toBeAttached();
    expect(await partIn(page)).toBe(true);
  });

  test('closing the tab during an unsaved hours change warns before Edit mode’s part is in', async ({ page }) => {
    // the warning covers the whole editor's unsaved changes, not only Edit mode's (found on the phone in CI)
    const part = await holdPart(page);
    try {
      await openEditor(page, '#business');
      await page.locator('#hoursGrid input[type=checkbox]').first().click();
      const warned = await page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
      expect(warned).toBe(true);
      expect(await partIn(page)).toBe(false);
    } finally { part.release(); }
  });

  test('Undo works on the Business tab before Edit mode’s part is in', async ({ page }) => {
    const part = await holdPart(page);
    const saves: Array<Record<string, unknown>> = [];
    page.on('request', (r) => { if (r.method() === 'PUT' && /\/functions\/v1\/presence\/identity$/.test(r.url())) saves.push(r.postDataJSON()); });
    try {
      await openEditor(page, '#business');
      const name = page.locator('#f-business_name');
      await expect(name).toHaveValue('Marlow’s Kitchen');
      await name.fill('Marlow’s Kitchen and Bar');
      await name.blur();
      await expect.poll(() => saves.length, { timeout: 6000 }).toBe(1);
      expect(saves[0].business_name).toBe('Marlow’s Kitchen and Bar');
      await settled(page, { requests: false });
      await page.keyboard.press('ControlOrMeta+z');   // the bar's keys: one undo history for the whole editor
      await expect(name).toHaveValue('Marlow’s Kitchen');
      await expect.poll(() => saves.length, { timeout: 6000 }).toBe(2);
      expect(saves[1].business_name).toBe('Marlow’s Kitchen');
      expect(await partIn(page)).toBe(false);
    } finally { part.release(); }
  });
});
