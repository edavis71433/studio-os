import { test, expect, Page, Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Builder list item 57: a Blocks section on a client's published page. The pages are what the
// renderer draws today for three templates (tests/presence/blocks_57_test.mjs writes them, with
// the site's stylesheet inlined, and fails when they go stale). On a phone, a tablet and a
// desktop: the blocks stack in one column in reading order, stay inside the screen, keep a
// readable width, a block marked for it hides on phones only, nothing from another company
// loads, and the form inside the section sends from the page like any form.
const SITE = 'https://shop.example';
const EP = 'https://db.example.supabase.co/functions/v1/presence/forms/5e000000-0000-4000-8000-000000000057/submit';
const TEMPLATES = ['business-classic', 'aurora', 'atelier'];
// a 16 by 10 grey picture for every photo the page asks for
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAKCAIAAAAy3EnLAAAAFElEQVR42mPYsmoBSYhhVMPQ1AAALgk+0OxUxMMAAAAASUVORK5CYII=', 'base64');
const html = (slug: string) => readFileSync(join(__dirname, 'fixtures', 'blocks-57', `${slug}.html`), 'utf8');
const answer = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });

async function openPage(page: Page, slug: string): Promise<string[]> {
  const asked: string[] = [];
  page.on('request', (r) => asked.push(r.url()));
  // the last route registered answers first: anything else on the site, then pictures, then the page
  await page.route('**/*', (route) => route.fulfill({ status: 404, body: '' }));
  await page.route(EP.replace(/\/submit$/, '/ticket'), (route) => answer(route, 200, { data: { ticket: '1800000000.' + 'a'.repeat(32), wait_s: 3 } }));
  await page.route(`${SITE}/img/**`, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.route(`${SITE}/blocks/`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: html(slug) }));
  await page.goto(`${SITE}/blocks/`);
  await expect(page.locator('section.block-stack')).toBeVisible();
  return asked;
}
const phone = (page: Page) => (page.viewportSize()?.width || 0) <= 620;
type Box = { item: number; top: number; bottom: number; left: number; right: number };
const blockBoxes = (page: Page) => page.locator('section.block-stack .stk > .stk-b').evaluateAll((els) => els
  .filter((e) => getComputedStyle(e).display !== 'none')
  .map((e) => { const r = e.getBoundingClientRect(); return { item: Number(e.getAttribute('data-dds-item')), top: r.top + scrollY, bottom: r.bottom + scrollY, left: r.left, right: r.right }; })) as Promise<Box[]>;

for (const slug of TEMPLATES) {
  // @layout: on a pull request the tablet runs these too (e2e.yml runs only @touch and @layout there)
  test.describe(`a Blocks section on a client’s page [${slug}]`, { tag: '@layout' }, () => {
    test('its blocks stack in one column, in reading order, inside the screen', async ({ page }) => {
      await openPage(page, slug);
      const boxes = await blockBoxes(page);
      expect(boxes.length).toBeGreaterThanOrEqual(9);
      for (let i = 1; i < boxes.length; i++) {
        expect(boxes[i].item, 'blocks in their stored order').toBeGreaterThan(boxes[i - 1].item);
        expect(boxes[i].top, `block ${boxes[i].item} sits under block ${boxes[i - 1].item}`).toBeGreaterThanOrEqual(boxes[i - 1].bottom - 1);
      }
      const width = await page.evaluate(() => innerWidth);
      for (const b of boxes) expect(b.left >= 0 && b.right <= width + 0.5, `block ${b.item} inside the screen`).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scrolling').toBe(true);
      // between the two Text sections, as placed
      const top = (sel: string) => page.locator(sel).first().evaluate((e) => e.getBoundingClientRect().top + scrollY);
      const [before, stack, after] = [await top('section:has(> h2:text-is("Before the blocks"))'), await top('section.block-stack'), await top('section:has(> h2:text-is("After the blocks"))')];
      expect(before < stack && stack < after).toBe(true);
      // real headings, in order: the section's Big heading then its Medium one
      await expect(page.locator('section.block-stack h2').first()).toHaveText('Built from blocks');
      await expect(page.locator('section.block-stack h3').first()).toHaveText('A smaller heading');
    });

    test('the column keeps a readable width; a photo fills it, a small one is centred', async ({ page }) => {
      await openPage(page, slug);
      const col = await page.locator('section.block-stack .stk').evaluate((e) => { const r = e.getBoundingClientRect(); return { left: r.left, width: r.width }; });
      const width = await page.evaluate(() => innerWidth);
      expect(col.width).toBeLessThanOrEqual(phone(page) ? width : 820.5);
      if (phone(page)) expect(col.width, 'the column uses the phone’s width').toBeGreaterThan(width * 0.75);
      const full = await page.locator('section.block-stack figure.stk-img:not(.stk-ws)').evaluate((e) => e.getBoundingClientRect().width);
      expect(Math.abs(full - col.width), 'a Full photo fills the column').toBeLessThanOrEqual(1);
      const small = await page.locator('section.block-stack figure.stk-ws').evaluate((e) => { const r = e.getBoundingClientRect(); return { centre: r.left + r.width / 2, width: r.width }; });
      expect(small.width, 'a Small photo').toBeLessThanOrEqual(320.5);
      expect(Math.abs(small.centre - (col.left + col.width / 2)), 'lined up in the centre').toBeLessThanOrEqual(1.5);
    });

    test('a block hidden on phones shows on bigger screens only', async ({ page }) => {
      await openPage(page, slug);
      const line = page.locator('section.block-stack hr.stk-hr');
      if (phone(page)) await expect(line).toBeHidden();
      else await expect(line).toBeVisible();
    });

    test('buttons are real links, side by side where there’s room, inside the screen', async ({ page }) => {
      await openPage(page, slug);
      const row = page.locator('section.block-stack .stk-btns');
      await expect(row.getByRole('link', { name: 'Book a visit' })).toHaveAttribute('href', 'https://example.com/book');
      await expect(row.getByRole('link', { name: 'Our hours' })).toHaveAttribute('href', '/contact/#hours');
      await expect(row.getByRole('link', { name: 'Call us' })).toHaveAttribute('href', 'tel:+15550100100');
      const boxes = await row.getByRole('link').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top), right: r.right }; }));
      const width = await page.evaluate(() => innerWidth);
      for (const b of boxes) expect(b.right).toBeLessThanOrEqual(width + 0.5);
      if (!phone(page)) expect(boxes[0].top, 'side by side').toBe(boxes[1].top);
    });

    test('the video and the map link out; nothing from another company loads', async ({ page }) => {
      const asked = await openPage(page, slug);
      await page.locator('section.block-stack .stk-map').scrollIntoViewIfNeeded();
      const video = page.getByRole('link', { name: 'Watch: A minute in the shop' });
      await expect(video).toHaveAttribute('href', 'https://www.youtube.com/watch?v=aqz-KE-bpKQ');
      await expect(video.locator('img')).toBeVisible();
      await expect(page.locator('section.block-stack iframe, section.block-stack script')).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Get directions →' })).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=12%20Olive%20Ave%2C%20Burbank');
      expect(asked.filter((u) => !u.startsWith(SITE) && !u.startsWith(EP.replace(/\/submit$/, '')) && !u.startsWith('data:'))).toEqual([]);
    });
  });
}

test('the form inside a Blocks section sends from the page, like any form', async ({ page }) => {
  const sent: string[] = [];
  await openPage(page, 'business-classic');
  await page.route(EP, async (route) => { sent.push(route.request().postData() || ''); await answer(route, 200, { data: { ok: true, message: 'Thank you, your message was sent. We’ll get back to you soon.' } }); });
  const form = page.locator('section.block-stack form#presence-form-blocks_form');
  await form.getByLabel('Your name').fill('Sam Rivera');
  await form.getByLabel('Email').fill('sam@customer.example');
  await form.getByLabel('How can we help?').fill('Do you bake rye on Sundays?');
  await form.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'your message was sent' })).toBeVisible();
  expect(sent).toHaveLength(1);
  expect(sent[0]).toContain('blocks_form');
  expect(sent[0]).toContain('Do you bake rye on Sundays?');
  expect(page.url()).toBe(`${SITE}/blocks/`);
});
