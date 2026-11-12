import { test, expect, Page } from '@playwright/test';
import { installApp } from './helpers/app';

// Builder list item 188 (Nov 11 2026): the sign-in pages in the new look, drawn in Figma first
// (file HSP7ScFSz2mg1xGzHRrEZi, page "Sign-in pages — new look"), matching the client portal's
// direction A. On a phone the studio's band sits on top of a cream sheet holding the form; from
// 900px wide the band is the left half of a split screen. Every form, field and sign-in step is
// the one that was there before; these tests pin the layout and the small additions.

const wide = (page: Page) => (page.viewportSize()?.width || 0) >= 900;
const box = async (page: Page, sel: string) => (await page.locator(sel).first().boundingBox())!;
async function noSidewaysScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}
async function bandThenSheet(page: Page) {
  const side = await box(page, '.side'), sheet = await box(page, '.sheet');
  if (wide(page)) {
    expect(side.x + side.width).toBeLessThanOrEqual(sheet.x + 1);       // band on the left, form on the right
    expect(Math.abs(side.y - sheet.y)).toBeLessThan(2);
  } else {
    expect(side.y + side.height).toBeLessThanOrEqual(sheet.y + 1);      // band on top, sheet below
  }
}

test.describe('Sign-in pages in the new look (builder list item 188)', () => {
  test('the studio sign-in: the band says whose door this is, the form fits the first screen, Show works', async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', (e) => errors.push(String(e)));
    await installApp(page, { session: null, api: {} });
    await page.goto('/studio.html');
    await expect(page.locator('.side .word')).toHaveText('Studio OS');
    await expect(page.locator('.side .s1 .lede')).toHaveText('Run your studio.');   // .s2 holds the second step's words (item 191)
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome back.' })).toBeVisible();
    await expect(page.locator('h1')).toHaveCount(1);                     // the band's line is not a second heading
    await bandThenSheet(page);
    await expect(page.locator('.glimpse')).toBeVisible({ visible: wide(page) });   // a glimpse of the studio only where there's room
    const go = await box(page, '#go');
    expect(go.y + go.height).toBeLessThanOrEqual(page.viewportSize()!.height);    // email, password and Sign in on the first screen
    await page.locator('#pw').fill('hunter2');
    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(page.locator('#pw')).toHaveAttribute('type', 'text');
    await expect(page.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Hide password' }).click();
    await expect(page.locator('#pw')).toHaveAttribute('type', 'password');
    await page.evaluate(() => (window as unknown as { show: (id: string) => void }).show('resetSent'));
    await expect(page.locator('#resetSent .qbtn')).toHaveText(['Open Gmail', 'Open Outlook']);
    await expect(page.locator('#resetSent .qbtn').first()).toHaveAttribute('href', /^https:\/\/mail\.google\.com\//);
    await noSidewaysScroll(page);
    expect(errors).toEqual([]);
  });

  test('the client sign-in: the portal’s look, the studio’s colour on the band, the inbox screen and Show', async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', (e) => errors.push(String(e)));
    await installApp(page, { session: null, api: {} });
    await page.goto('/portal.html');
    await expect(page.locator('#brand .word')).toHaveText('Studio OS');
    await expect(page.locator('.side .lede')).toHaveText('Your website, your project, one place.');
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    await bandThenSheet(page);
    const send = await box(page, '#sendGo');
    expect(send.y + send.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    const plain = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(plain).toBe('rgb(36, 29, 56)');
    // a remembered studio with a colour of its own tints the band
    await page.evaluate(() => localStorage.setItem('dds-studio-brand', JSON.stringify({ name: 'Harbor Dental', logo_url: null, accent: '#2f5d8a' })));
    await page.goto('/portal.html');
    await expect(page.locator('#brand .word')).toHaveText('Harbor Dental');
    const tinted = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(tinted).not.toBe(plain);
    await expect(page.locator('#brand .word')).toHaveCSS('color', 'rgb(255, 255, 255)');   // the name reads on the band
    // the inbox screen gets the two mail buttons
    await page.evaluate(() => (window as unknown as { show: (id: string) => void }).show('codePanel'));
    await expect(page.getByRole('heading', { level: 1, name: 'Check your inbox' })).toBeVisible();
    await expect(page.locator('#codePanel .qbtn')).toHaveText(['Open Gmail', 'Open Outlook']);
    // the password door has Show
    await page.evaluate(() => (window as unknown as { show: (id: string) => void }).show('pwPanel'));
    await page.locator('#pw').fill('hunter2');
    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(page.locator('#pw')).toHaveAttribute('type', 'text');
    await noSidewaysScroll(page);
    expect(errors).toEqual([]);
  });

  test('setting a password: whose account it is, a strength bar in words, and Show', async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', (e) => errors.push(String(e)));
    await installApp(page, { session: null, api: {} });
    await page.goto('/set-password.html');
    await expect(page.locator('#formState')).toBeVisible();
    await expect(page.locator('#brand .word')).toHaveText('Studio OS');            // no more one studio's name on every studio's page
    await expect(page.locator('.side .lede')).toHaveText('Choose your password.');
    await bandThenSheet(page);
    const pw = page.locator('#pw'), word = page.locator('#strengthWord');
    await pw.fill('abc'); await expect(word).toHaveText('Too short');
    await pw.fill('abcdefgh'); await expect(word).toHaveText('Okay');
    await pw.fill('abcdefgh1234'); await expect(word).toHaveText('Strong');
    await pw.fill('Abcdefgh1234!'); await expect(word).toHaveText('Very strong');
    await pw.fill(''); await expect(word).toHaveText('');
    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(pw).toHaveAttribute('type', 'text');
    await noSidewaysScroll(page);
    // a client from their studio's email sees that studio; the studio's own staff never do
    await page.evaluate(() => localStorage.setItem('dds-studio-brand', JSON.stringify({ name: 'Marlow & Co', logo_url: null, accent: '#8c3b2e' })));
    await page.goto('/set-password.html?next=/portal.html');
    await expect(page.locator('#brand .word')).toHaveText('Marlow & Co');
    await expect(page).toHaveTitle('Marlow & Co — Set your password');
    await page.goto('/set-password.html');
    await expect(page.locator('#brand .word')).toHaveText('Studio OS');
    expect(errors).toEqual([]);
  });
});
