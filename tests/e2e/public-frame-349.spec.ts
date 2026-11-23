import { test, expect, type Page } from '@playwright/test';
import { installApp } from './helpers/app';

// Builder item 349 (Nov 2026): the pages a client lands on without signing in share one frame
// (public-frame.js): the studio's band with its name or logo, a card, and a footer line with the
// studio's name and the contact it shows on its own website. The frame learns the studio from
// ?studio=<site id> on the address (one public, cached read), else from the memory a sign-in
// left, else it names no one and never the product. The thank-you page after paying asks the
// server what to say: the studio, the amount, a masked receipt address, and whether this payer
// has a sign-in. Every name here is made up.

const SITE = '11111111-1111-4111-8111-111111111111';
const INV = '44444444-4444-4444-8444-444444444444';
const BRAND = { name: 'Juniper Floral', logo_url: null, accent: '#b4532a', is_default: false, signin: { google: false, password: true }, contact: { email: 'hello@juniperfloral.com', phone: '(818) 555-0142' } };
const THANKS = { studio: { name: 'Juniper Floral', logo_url: null, accent: '#b4532a', contact: { email: 'hello@juniperfloral.com', phone: null } }, amount: '$1,200.00', invoice_title: 'Website refresh', receipt_to: 'm•••@juniperfloral.com', signin: false };

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const bandColour = (page: Page) => page.locator('.pf-band').evaluate((el) => getComputedStyle(el).backgroundImage);
const remember = (page: Page, brand: Record<string, unknown>) => page.addInitScript((b) => { try { localStorage.setItem('dds-studio-brand', JSON.stringify(b)); } catch (e) { /* private window */ } }, brand);

test.describe('The one public frame (builder item 349)', () => {
  test('a page not found, reached from a studio’s link: the studio’s name fades in, the band takes its colour, the footer its contact', async ({ page }) => {
    await installApp(page, { session: null, api: { [`/public/studio/${SITE}/brand`]: { data: BRAND } } });
    await page.goto(`/404.html?studio=${SITE}`);
    const studio = page.locator('#pf-studio');
    await expect(studio).toHaveText('JJuniper Floral');   // the mark's letter, then the name
    await expect(studio).toHaveClass(/pf-shown/);
    await expect(studio).toHaveCSS('opacity', '1');
    expect(await bandColour(page)).toContain('rgb(180, 83, 42)');
    await expect(page).toHaveTitle('Page not found | Juniper Floral');
    const foot = page.locator('[data-pf-foot]');
    await expect(foot).toContainText('Juniper Floral');
    await expect(foot.getByRole('link', { name: 'hello@juniperfloral.com' })).toHaveAttribute('href', 'mailto:hello@juniperfloral.com');
    await expect(foot.getByRole('link', { name: '(818) 555-0142' })).toHaveAttribute('href', 'tel:8185550142');
    await expect(page.getByRole('link', { name: 'Client sign in' })).toHaveAttribute('href', `/portal.html?studio=${SITE}`);
    await expect(page.getByText(/Studio OS|Davis Digital/)).toHaveCount(0);
    expect(await noSideScroll(page)).toBe(true);
    // the answer is remembered for the next page this person opens
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dds-studio-brand') || 'null'))).toMatchObject({ name: 'Juniper Floral', accent: '#b4532a', contact: { email: 'hello@juniperfloral.com' } });
  });

  test('nothing is known: the band keeps the product’s plum, names no one, and never says the product’s name', async ({ page }) => {
    await installApp(page, { session: null });
    await page.goto('/404.html');
    await expect(page.locator('#pf-studio')).toBeEmpty();
    await expect(page.locator('[data-pf-foot]')).toBeEmpty();
    expect(await bandColour(page)).toContain('rgb(91, 63, 160)');
    await expect(page).toHaveTitle('Page not found');
    await expect(page.getByText(/Studio OS|Davis Digital/)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'That page isn’t here.' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Client sign in' })).toHaveAttribute('href', '/portal.html');
  });

  test('a studio this browser remembers from a sign-in is drawn with no read at all', async ({ page }) => {
    const asked: string[] = [];
    page.on('request', (r) => { if (/\/public\/studio\//.test(r.url())) asked.push(r.url()); });
    await installApp(page, { session: null });
    await remember(page, { name: 'Brightline Studio', logo_url: null, accent: '#5b3fa0' });
    await page.goto('/terms.html');
    await expect(page.locator('#pf-studio')).toHaveText('BBrightline Studio');
    await expect(page).toHaveTitle(/\| Brightline Studio$/);
    expect(asked).toEqual([]);
  });

  test('the words below never move while the studio’s name is on its way', async ({ page }) => {
    await installApp(page, { session: null });
    let release: () => void = () => {};
    const held = new Promise<void>((r) => { release = r; });
    await page.route(`**/functions/v1/presence/public/studio/${SITE}/brand`, async (route) => {
      await held;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: BRAND }) });
    });
    await page.goto(`/privacy.html?studio=${SITE}`);
    await expect(page.getByRole('heading', { name: 'Privacy policy' })).toBeVisible();
    const before = await page.locator('.pf-card').boundingBox();
    release();
    await expect(page.locator('#pf-studio')).toHaveText('JJuniper Floral');
    const after = await page.locator('.pf-card').boundingBox();
    expect(after?.y).toBe(before?.y);
    expect(after?.x).toBe(before?.x);
  });

  test('a saved name is only ever text, and a colour only when it is a plain hex', async ({ page }) => {
    await installApp(page, { session: null });
    await remember(page, { name: '<img src=x onerror=window.__x=1>', accent: 'red;background:url(//evil.example)', contact: { email: 'javascript:alert(1)', phone: 'call <b>us</b>' } });
    await page.goto('/unsubscribe.html');
    await expect(page.locator('#pf-studio img')).toHaveCount(0);
    await expect(page.locator('[data-pf-foot] a')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __x?: number }).__x)).toBeUndefined();
    expect(await bandColour(page)).toContain('rgb(91, 63, 160)');
  });
});

test.describe('The thank-you page after paying (builder item 349)', () => {
  test('a first-time payer sees the studio, the amount and where the receipt went, and no sign-in button', async ({ page }) => {
    await installApp(page, { session: null, api: { '/public/pay/thanks': { data: THANKS } } });
    await page.goto(`/payment-success.html?paid=${INV}`);
    await expect(page.locator('#pf-studio')).toHaveText('JJuniper Floral');
    await expect(page.locator('#pf-studio')).toHaveCSS('opacity', '1');
    expect(await bandColour(page)).toContain('rgb(180, 83, 42)');
    await expect(page).toHaveTitle('Payment received | Juniper Floral');
    await expect(page.locator('#amount')).toHaveText('$1,200.00');
    await expect(page.locator('#invoiceTitle')).toHaveText('Website refresh');
    await expect(page.locator('#receipt')).toHaveText('Receipt sent to m•••@juniperfloral.com.');
    await expect(page.locator('#sub')).toHaveText('Juniper Floral is told right away, and your invoice shows as paid as soon as Stripe confirms it, usually within a minute. There’s nothing else to do.');
    await expect(page.locator('#cta')).toBeHidden();
    await expect(page.getByRole('link', { name: /Sign in/ })).toHaveCount(0);
    await expect(page.locator('#plain')).toBeHidden();
    await expect(page.locator('[data-pf-foot]').getByRole('link', { name: 'hello@juniperfloral.com' })).toBeVisible();
    await expect(page.getByText(/Studio OS|Davis Digital|Eric/)).toHaveCount(0);
  });

  test('a payer with a portal sign-in gets the button', async ({ page }) => {
    await installApp(page, { session: null, api: { '/public/pay/thanks': { data: { ...THANKS, signin: true } } } });
    await page.goto(`/payment-success.html?paid=${INV}`);
    await expect(page.locator('#amount')).toHaveText('$1,200.00');
    const cta = page.getByRole('link', { name: 'Sign in to see your invoice →' });
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute('href', '/portal.html');
    await expect(page.locator('#sub')).toContainText('Your Invoices tab will show it too.');
  });

  test('the server’s word beats the browser’s memory: a remembered studio, but no sign-in on this invoice', async ({ page }) => {
    await installApp(page, { session: null, api: { '/public/pay/thanks': { data: THANKS } } });
    await remember(page, { name: 'Brightline Studio', logo_url: null, accent: '#5b3fa0' });
    await page.goto(`/payment-success.html?paid=${INV}`);
    await expect(page.locator('#pf-studio')).toHaveText('JJuniper Floral');
    await expect(page.locator('#cta')).toBeHidden();
    await expect(page.locator('#receipt')).toHaveText('Receipt sent to m•••@juniperfloral.com.');
  });

  test('no receipt address known: the page promises one by email, and the amount still shows', async ({ page }) => {
    await installApp(page, { session: null, api: { '/public/pay/thanks': { data: { ...THANKS, receipt_to: null, invoice_title: '' } } } });
    await page.goto(`/payment-success.html?paid=${INV}`);
    await expect(page.locator('#receipt')).toHaveText('You’ll get a receipt by email.');
    await expect(page.locator('#amount')).toHaveText('$1,200.00');
    await expect(page.locator('#factTitle')).toBeHidden();
  });

  test('the server refuses the id: the page still reads well, names no one, and offers no sign-in', async ({ page }) => {
    await installApp(page, { session: null });
    await page.route('**/functions/v1/presence/public/pay/thanks**', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not_found', message: 'That invoice isn’t here.' }) }));
    await page.goto('/payment-success.html?paid=inv-123');
    await expect(page.getByRole('heading', { name: 'Payment received. Thank you.' })).toBeVisible();
    await expect(page.locator('#facts')).toBeHidden();
    await expect(page.locator('#cta')).toBeHidden();
    await expect(page.locator('#sub')).toHaveText(/^Your invoice shows as paid as soon as Stripe confirms it/);
    await expect(page.locator('#pf-studio')).toBeEmpty();
  });
});

test.describe('On a phone, every control is a finger’s size (builder item 349)', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  const CASES: Array<[string, Record<string, unknown>]> = [
    [`/404.html?studio=${SITE}`, { [`/public/studio/${SITE}/brand`]: { data: BRAND } }],
    [`/payment-success.html?paid=${INV}`, { '/public/pay/thanks': { data: { ...THANKS, signin: true } }, [`/public/studio/${SITE}/brand`]: { data: BRAND } }],
    ['/payment-canceled.html', {}],
  ];
  for (const [path, api] of CASES) {
    test(`${path}: 44px controls, no side scroll`, async ({ page }) => {
      await installApp(page, { session: null, api });
      await remember(page, { name: 'Juniper Floral', logo_url: null, accent: '#b4532a', contact: { email: 'hello@juniperfloral.com', phone: '(818) 555-0142' } });
      await page.goto(path);
      await expect(page.locator('#pf-studio')).toHaveText('JJuniper Floral');
      await expect(page.locator('[data-pf-foot]')).toHaveClass(/pf-shown/);
      const controls = page.locator('.pf-card a, .pf-card button, [data-pf-foot] a');
      const n = await controls.count();
      expect(n).toBeGreaterThan(0);
      let seen = 0;
      for (let i = 0; i < n; i++) {
        const c = controls.nth(i);
        if (!(await c.isVisible())) continue;
        const box = await c.boundingBox();
        expect(box, `${path}: control ${i} has a box`).toBeTruthy();
        expect(box!.height, `${path}: ${await c.innerText()} is 44px tall`).toBeGreaterThanOrEqual(44);
        expect(box!.width, `${path}: ${await c.innerText()} is 44px wide`).toBeGreaterThanOrEqual(44);
        seen++;
      }
      expect(seen).toBeGreaterThan(0);
      expect(await noSideScroll(page)).toBe(true);
      const body = await page.locator('.pf-card p').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(body).toBeGreaterThanOrEqual(15);
    });
  }
  test('the unsubscribe page’s buttons are the frame’s buttons', async ({ page }) => {
    await installApp(page, { session: null });
    await page.route('**/functions/v1/presence/unsubscribe?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { valid: true } }) }));
    await page.goto('/unsubscribe.html?e=pat%40client.example&t=tok');
    const b = page.getByRole('button', { name: 'Yes, unsubscribe' });
    await expect(b).toBeVisible();
    const box = await b.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(await noSideScroll(page)).toBe(true);
  });
});
