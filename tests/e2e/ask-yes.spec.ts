import { test, expect, Page } from '@playwright/test';
import { installApp } from './helpers/app';

// List item 33: the builder's 22 questions are its own styled dialog now, not the browser's
// confirm(). The browser's box can't be styled, reads like a system warning, and on a phone
// shows the site's address over the question.
const ask = (page: Page, message: string, opts: Record<string, unknown>) =>
  page.evaluate(([m, o]) => { (window as unknown as { __answer: Promise<boolean> }).__answer = (window as unknown as { askYes: (m: string, o: unknown) => Promise<boolean> }).askYes(m as string, o); }, [message, opts] as const);
const answer = (page: Page) => page.evaluate(() => (window as unknown as { __answer: Promise<boolean> }).__answer);

test.describe('the builder asks in its own dialog', () => {
  const popups: string[] = [];
  test.beforeEach(async ({ page }) => {
    popups.length = 0;
    page.on('dialog', (d) => { popups.push(d.message()); void d.dismiss(); });
    await installApp(page);
    await page.goto('/presence.html');
    await page.waitForFunction(() => typeof (window as unknown as { askYes?: unknown }).askYes === 'function' && document.readyState === 'complete');
  });
  test.afterEach(() => { expect(popups).toEqual([]); });   // no browser pop-up ever opened

  test('a risky question starts on Cancel, and Escape answers no', async ({ page }) => {
    await ask(page, 'Delete this section?\n\nYour live site is unchanged until you publish.', { ok: 'Delete', danger: true });
    const dlg = page.locator('dialog.ask-yes');
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('.ask-msg')).toHaveText(/^Delete this section\?\s+Your live site is unchanged until you publish\.$/);
    await expect(dlg).toHaveAccessibleName(/Delete this section\?/);
    await expect(dlg.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Enter');                       // on Cancel, Enter doesn't take the risky path
    await expect(dlg).toHaveCount(0);
    expect(await answer(page)).toBe(false);
    await ask(page, 'Delete this section?', { ok: 'Delete', danger: true });
    await expect(dlg).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    expect(await answer(page)).toBe(false);
  });

  test('its main button answers yes, and an everyday question starts on it', async ({ page }) => {
    await ask(page, 'Launch “Spring”? This replaces your live site with the staged version.', { ok: 'Launch' });
    const dlg = page.locator('dialog.ask-yes');
    await expect(dlg.getByRole('button', { name: 'Launch' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dlg).toHaveCount(0);
    expect(await answer(page)).toBe(true);
    await ask(page, 'Remove this form?', { ok: 'Remove form', danger: true });
    await dlg.getByRole('button', { name: 'Remove form' }).click();
    expect(await answer(page)).toBe(true);
  });

  test('it fits the screen and keeps the rest of the page out of reach while it is up', async ({ page }) => {
    await ask(page, 'Show 2 columns? The extra column’s content will be removed.', { ok: 'Remove the extra content', danger: true });
    const box = (await page.locator('dialog.ask-yes').boundingBox())!;
    const vw = page.viewportSize()!.width;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vw);
    expect(await page.evaluate(() => (document.querySelector('dialog.ask-yes') as HTMLDialogElement).matches(':modal'))).toBe(true);
    await page.locator('dialog.ask-yes').getByRole('button', { name: 'Cancel' }).click();
    expect(await answer(page)).toBe(false);
  });
});
