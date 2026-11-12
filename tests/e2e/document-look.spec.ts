import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Sales item 125 (Nov 2026): the papers a studio's customers see wear the new look. A band in
// the studio's own colour with its mark and name, the title and the number that matters; white
// cards below; a pay bar at the bottom of a phone; clean paper. The three documents here are
// the renderer's own output for made-up data (tests/presence/document_look_test.mjs keeps the
// files in step), shown through doc.html exactly as a customer opens them. Every name is made up.

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', 'document-look', `${name}.html`), 'utf8');
async function open(page: Page, name: string): Promise<void> {
  // text/plain on purpose: what the function's own host serves (see doc.spec.ts)
  await page.route('**/functions/v1/presence/sales/doc/**', (route) => route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: fixture(name) }));
  await page.goto('/doc.html?t=fixture-token');
  await expect(page.locator('header.band h1')).toBeVisible();
}
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const isPhone = (page: Page) => (page.viewportSize()?.width || 0) <= 640;

test.describe('Customer documents in the new look (Sales item 125)', () => {
  test('an invoice: the band, the cards, and one clear way to pay', async ({ page }) => {
    await open(page, 'invoice');
    const band = page.locator('header.band');
    await expect(band.locator('.wordmark')).toHaveText('Brightline Studio');
    await expect(band.locator('.doclabel')).toHaveText('Invoice #0013');
    await expect(band.locator('h1')).toHaveText('Website refresh, part 2 of 3');
    await expect(band.locator('.figure .n')).toHaveText('$975.00');
    // the band is the studio's colour, not the product's
    expect(await band.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('rgb(180, 83, 42)');
    // the product's own typeface drew the title
    expect(await page.evaluate(() => document.fonts.ready.then(() => document.fonts.check('42px Fraunces')))).toBe(true);
    expect(await noSideScroll(page)).toBe(true);
    if (isPhone(page)) {
      // a phone keeps Pay within reach at the bottom, and the side card steps aside
      await expect(page.locator('.paybar .paylink')).toBeVisible();
      await expect(page.locator('.paybar .paylink')).toHaveAttribute('href', 'https://pay.example/inv13');
      await expect(page.locator('aside.aside')).toBeHidden();
      const box = await page.locator('.paybar .paylink').boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      // the last line of the page can scroll clear of the bar
      const clear = await page.evaluate(() => {
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
        return document.querySelector('footer')!.getBoundingClientRect().bottom <= document.querySelector('.paybar')!.getBoundingClientRect().top + 1;
      });
      expect(clear).toBe(true);
    } else {
      await expect(page.locator('.paybar')).toBeHidden();
      await expect(page.locator('aside.aside .paylink')).toBeVisible();
      await expect(page.locator('aside.aside .paylink')).toHaveText('Pay $975.00 securely →');
    }
  });

  test('a receipt: paid in full, how it was paid, and no way to pay again', async ({ page }) => {
    await open(page, 'receipt');
    await expect(page.locator('header.band .pill.paid')).toHaveText('✓ Paid in full');
    await expect(page.locator('header.band .figure .n')).toHaveText('$1,476.00');
    await expect(page.locator('.banner b')).toHaveText('Paid in full. Thank you.');
    await expect(page.locator('.paylink')).toHaveCount(0);
    await expect(page.locator('aside.aside')).toContainText('How it was paid');
    await expect(page.locator('footer')).toContainText('this link keeps working');
    expect(await noSideScroll(page)).toBe(true);
  });

  test('a signed agreement: the contents jump to a section, both signatures, the certificate', async ({ page }) => {
    await open(page, 'agreement-signed');
    await expect(page.locator('header.band .pill.paid')).toHaveText('✓ Signed by both');
    await expect(page.locator('.sig')).toHaveCount(2);
    await expect(page.locator('.cert h2')).toHaveText('Certificate of record');
    // white words on the certificate's dark card
    expect(await page.locator('.cert').evaluate((el) => getComputedStyle(el).color)).toBe('rgb(255, 255, 255)');
    expect(await noSideScroll(page)).toBe(true);
    const rail = page.locator('nav.rail');
    if ((page.viewportSize()?.width || 0) > 980) {
      await expect(rail).toBeVisible();
      await rail.getByRole('link', { name: 'Certificate of record' }).click();
      await expect(page.locator('#certificate')).toBeInViewport();
    } else {
      await expect(rail).toBeHidden();
    }
  });

  test('on paper: the band keeps its colour, the buttons and the pay card stay off the page', async ({ page }) => {
    await open(page, 'invoice');
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.toolbar')).toBeHidden();
    await expect(page.locator('aside.aside')).toBeHidden();
    await expect(page.locator('.paybar')).toBeHidden();
    await expect(page.locator('.paylink').first()).toBeHidden();
    await expect(page.locator('header.band h1')).toBeVisible();
    await expect(page.locator('tr.total')).toBeVisible();
    expect(await page.locator('header.band').evaluate((el) => getComputedStyle(el).getPropertyValue('print-color-adjust') || getComputedStyle(el).getPropertyValue('-webkit-print-color-adjust'))).toBe('exact');
  });

  test('Download PDF works from every button', async ({ page }) => {
    await open(page, 'invoice');
    let asked = 0;
    await page.route('**/x?format=pdf', (route) => { asked++; return route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4\n%%EOF\n' }); });
    const buttons = page.locator('[data-dlpdf]:visible');
    const n = await buttons.count();
    expect(n).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < n; i++) {
      const label = await buttons.nth(i).textContent();
      const [download] = await Promise.all([page.waitForEvent('download'), buttons.nth(i).click()]);
      expect(download.suggestedFilename()).toBe('x.pdf');
      await expect(buttons.nth(i)).toHaveText(label || '');   // the button's own words come back
    }
    expect(asked).toBe(n);
  });

  for (const name of ['invoice', 'receipt', 'agreement-signed']) {
    test(`${name}: no serious accessibility problems`, async ({ page }) => {
      await open(page, name);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const serious = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(' ')).slice(0, 4).join(' | ')}`)).toEqual([]);
    });
  }
});

test.describe('The pay pages in the new look (Sales item 125)', () => {
  test('a returning client sees their studio’s name and colour on the band', async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('dds-studio-brand', JSON.stringify({ name: 'Brightline Studio', logo_url: null, accent: '#b4532a' })); } catch (e) { /* private window */ } });
    for (const path of ['/payment-success.html?paid=inv-123', '/payment-canceled.html']) {
      await page.goto(path);
      await expect(page.locator('#studio')).toHaveText('BBrightline Studio');   // the mark's letter, then the name
      expect(await page.locator('.band').evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('rgb(180, 83, 42)');
      await expect(page.locator('.card h1')).toBeVisible();
      expect(await noSideScroll(page)).toBe(true);
    }
  });
  test('a first-time payer: the band names no one and keeps the product’s plum', async ({ page }) => {
    await page.goto('/payment-success.html?paid=inv-123');
    await expect(page.locator('#studio')).toBeEmpty();
    expect(await page.locator('.band').evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('rgb(91, 63, 160)');
  });
  test('a saved colour that is not a plain hex is ignored, and a name is only ever text', async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('dds-studio-brand', JSON.stringify({ name: '<img src=x onerror=window.__x=1>', accent: 'red;background:url(//evil.example)' })); } catch (e) { /* private window */ } });
    await page.goto('/payment-canceled.html');
    await expect(page.locator('#studio img')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __x?: number }).__x)).toBeUndefined();
    expect(await page.locator('.band').evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('rgb(91, 63, 160)');
  });
  for (const path of ['/payment-success.html?paid=inv-123', '/payment-canceled.html']) {
    test(`${path}: no serious accessibility problems`, async ({ page }) => {
      await page.addInitScript(() => { try { localStorage.setItem('dds-studio-brand', JSON.stringify({ name: 'Brightline Studio', accent: '#b4532a' })); } catch (e) { /* private window */ } });
      await page.goto(path);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const serious = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(' ')).slice(0, 4).join(' | ')}`)).toEqual([]);
    });
  }
});
