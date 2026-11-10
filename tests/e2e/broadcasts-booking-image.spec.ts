import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp } from './helpers/app';

// Bold redesign — Send an update's last two chips (Figma section 10, Nov 2026):
// + First name · + Business · + Booking link · + Image. The booking link becomes a
// "Book a time" button on a line of its own (its address is Business details'
// booking link; without one the chip says where it's set). + Image picks a photo
// from Files and puts it on a line of its own. What they see shows both, as the
// email renders them (lib/update_media.ts).

const SEGS = { data: { segments: [{ key: 'contacts', label: 'All contacts', description: 'Everyone saved in your contacts.', count: 3 }] } };
const P1 = '11111111-2222-4333-8444-555555555555';
const thumb = (c: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="${c}"/></svg>`)}`;
const ASSETS = { data: { assets: [
  { id: P1, kind: 'image', mime: 'image/jpeg', alt_text: 'The shopfront at dusk', name: 'shopfront.jpg', asset_status: 'active', thumb: thumb('#c9b6f0') },
  { id: '22222222-3333-4444-8555-666666666666', kind: 'image', mime: 'image/png', alt_text: 'An old logo', asset_status: 'archived', thumb: thumb('#ddd') },
  { id: '33333333-4444-4555-8666-777777777777', kind: 'image', mime: 'image/png', alt_text: 'A client’s own photo', client_private: true, thumb: thumb('#eee') },
  { id: '44444444-5555-4666-8777-888888888888', kind: 'document', mime: 'application/pdf', name: 'Price list.pdf' },
] } };
const api = (identity: Record<string, unknown>, assets: unknown = ASSETS) => ({ '/broadcasts/segments': SEGS, '/broadcasts': { data: { broadcasts: [] } }, '/identity': { data: { business_name: 'Brightline Studio', ...identity } }, '/assets': assets });
const BOOK = 'https://cal.example/brightline';

test.describe('Send an update — + Booking link and + Image (bold redesign)', () => {
  test('the four chips, as the design has them', async ({ page }) => {
    await installApp(page, { api: api({ booking_url: BOOK }) });
    await page.goto('/broadcasts.html');
    await expect(page.getByRole('group', { name: 'Add to your message' }).getByRole('button')).toHaveText(['+ First name', '+ Business', '+ Booking link', '+ Image']);
  });

  test('+ Booking link goes in on a line of its own, and what they see shows “Book a time”', async ({ page }) => {
    await installApp(page, { api: api({ booking_url: BOOK }) });
    await page.goto('/broadcasts.html');
    const body = page.locator('#bodytx'), pv = page.locator('#livePv');
    await expect(pv).toContainText('Brightline Studio');   // Business details have been read
    await body.fill('Spring is here.');
    await page.getByRole('button', { name: '+ Booking link' }).click();
    await expect(body).toHaveValue('Spring is here.\n{{booking_link}}\n');
    await expect(body).toBeFocused();
    await expect(pv.locator('.mail-cta')).toHaveText('Book a time');
    await expect(page.locator('#varNote')).toBeHidden();
    // inside a sentence it reads as a link, as in the email
    await body.fill('You can {{booking_link}} any day.');
    await expect(pv.locator('.mail-cta')).toHaveCount(0);
    await expect(pv.locator('.mail-body u')).toHaveText('book a time');
  });

  for (const [what, identity] of [['no booking link', {}], ['an http booking link', { booking_url: 'http://cal.example/x' }]] as const) {
    test(`with ${what}, the chip says where it’s set and adds nothing`, async ({ page }) => {
      await installApp(page, { api: api(identity) });
      await page.goto('/broadcasts.html');
      await expect(page.locator('#livePv')).toContainText('Brightline Studio');
      await page.locator('#bodytx').fill('Spring is here.');
      await page.getByRole('button', { name: '+ Booking link' }).click();
      const note = page.locator('#varNote');
      await expect(note).toBeVisible();
      await expect(note).toContainText('Reservation link');
      await expect(note.getByRole('link', { name: 'Your website › Business' })).toHaveAttribute('href', '/presence.html#business');
      await expect(page.locator('#bodytx')).toHaveValue('Spring is here.');
    });
  }

  test('+ Image opens your photos: only shared, live images; a pick goes in on its own line and shows', async ({ page }) => {
    await installApp(page, { api: api({}) });
    await page.goto('/broadcasts.html');
    const body = page.locator('#bodytx'), pv = page.locator('#livePv');
    await body.fill('Our new studio:');
    await page.getByRole('button', { name: '+ Image' }).click();
    const dlg = page.getByRole('dialog', { name: 'Add a photo' });
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('[data-pick]')).toHaveCount(1);   // not archived, not a client's private file, not a document
    await expect(dlg.getByRole('button', { name: 'Add The shopfront at dusk' })).toBeFocused();
    await dlg.getByRole('button', { name: 'Add The shopfront at dusk' }).click();
    await expect(dlg).toBeHidden();
    await expect(body).toHaveValue(`Our new studio:\n![The shopfront at dusk](media:${P1})\n`);
    await expect(body).toBeFocused();
    await expect(pv.locator('.mail-img img')).toHaveAttribute('alt', 'The shopfront at dusk');
  });

  test('the photo sheet closes with Escape and gives the message its focus back', async ({ page }) => {
    await installApp(page, { api: api({}) });
    await page.goto('/broadcasts.html');
    await page.locator('#bodytx').fill('Hi');
    await page.getByRole('button', { name: '+ Image' }).click();
    await expect(page.getByRole('dialog', { name: 'Add a photo' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Add a photo' })).toBeHidden();
    await expect(page.locator('#bodytx')).toBeFocused();
    await expect(page.locator('#bodytx')).toHaveValue('Hi');
  });

  test('no photos yet: the sheet points at Files; a failed read can try again', async ({ page }) => {
    await installApp(page, { api: api({}, { data: { assets: [] } }) });
    await page.goto('/broadcasts.html');
    await page.getByRole('button', { name: '+ Image' }).click();
    const dlg = page.getByRole('dialog', { name: 'Add a photo' });
    await expect(dlg).toContainText('No photos yet');
    await expect(dlg.getByRole('link', { name: 'Open Files →' })).toHaveAttribute('href', '/files.html');
    await page.keyboard.press('Escape');
    let fail = true;
    await page.route((u) => /\/presence\/assets$/.test(u.pathname), (route) => fail
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'down' }) })
      : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ASSETS) }));
    await page.getByRole('button', { name: '+ Image' }).click();
    await expect(dlg).toContainText('Your photos couldn’t load just now.');
    fail = false;
    await dlg.getByRole('button', { name: 'Try again' }).click();
    await expect(dlg.locator('[data-pick]')).toHaveCount(1);
  });

  test('a message that already names a photo shows it once your photos are read; one that isn’t yours shows nothing', async ({ page }) => {
    await installApp(page, { api: api({}) });
    await page.goto('/broadcasts.html');
    await page.locator('#bodytx').fill(`Look:\n![Our studio](media:${P1})\n![Gone](media:99999999-8888-4777-8666-555555555555)`);
    const pv = page.locator('#livePv');
    await expect(pv.locator('.mail-img img')).toHaveCount(1);
    await expect(pv.locator('.mail-img img')).toHaveAttribute('alt', 'Our studio');
    await expect(pv.locator('.mail-img .ph')).toHaveCount(0);
  });

  test('a phone: the four chips fit, and the photos come up as a sheet from the bottom, two across', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'phone layout under test');
    await installApp(page, { api: api({ booking_url: BOOK }) });
    await page.goto('/broadcasts.html');
    const chips = page.getByRole('group', { name: 'Add to your message' }).getByRole('button');
    await expect(chips).toHaveCount(4);
    for (const box of await chips.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { right: r.right, h: r.height }; })))
      expect(box.right).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('button', { name: '+ Image' }).click();
    const dlg = page.getByRole('dialog', { name: 'Add a photo' });
    await expect(dlg.locator('[data-pick]')).toHaveCount(1);
    const r = (await dlg.boundingBox())!;
    expect(Math.abs(r.y + r.height - page.viewportSize()!.height)).toBeLessThan(2);   // a sheet from the bottom
    expect(r.width).toBeGreaterThanOrEqual(page.viewportSize()!.width - 1);
  });

  test('no serious/critical axe violations with the photo sheet open', async ({ page }) => {
    await installApp(page, { api: api({ booking_url: BOOK }) });
    await page.goto('/broadcasts.html');
    await page.getByRole('button', { name: '+ Image' }).click();
    await expect(page.getByRole('dialog', { name: 'Add a photo' }).locator('[data-pick]')).toHaveCount(1);
    const r = await new AxeBuilder({ page }).include('#imgDlg').analyze();
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => v.id + ': ' + v.nodes.map((n) => n.target.join(' ')).join(', '))).toEqual([]);
  });
});
