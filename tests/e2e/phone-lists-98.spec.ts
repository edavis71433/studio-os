import { test, expect } from '@playwright/test';
import { installApp, settled } from './helpers/app';
import { CONTACTS_API, AGENCY_API, BROADCASTS_API, CUSTOMERS_API } from './tap-targets-98.fixtures';

// ── Builder item 98: the lists on a phone and a touch tablet ─────────────────────────
// A row that scrolls sideways shows it (a fade at the edge that has more, and a round arrow at
// the end of a row of chips); Customers' cards keep every name readable on a phone; a touch
// tablet opens Contacts and Home on the cards; Send an update's buttons stay clear of the
// phone's tab bar. The made-up businesses in the fixtures are invented.

const phone = () => test.info().project.name === 'mobile';
const touch = () => !!test.info().project.use.hasTouch;

test.describe('lists on a phone and a touch tablet (builder item 98)', () => {
  test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(new Date('2026-11-16T18:00:00Z')); });

  test('a row of chips that runs off a phone fades out and has an arrow that moves it along; at its end both go', async ({ page }) => {
    test.skip(!phone(), 'the chips only run off a phone');
    await installApp(page, { api: CUSTOMERS_API as never });
    await page.goto('/customers.html');
    const row = page.locator('.chips').first();
    await expect(row.getByRole('button').first()).toBeVisible();
    await settled(page);
    await expect(row).toHaveClass(/dds-cue-r/);
    const arrow = row.locator('.dds-cue-more');
    await expect(arrow).toBeVisible();
    const box = await arrow.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44); expect(box!.height).toBeGreaterThanOrEqual(44);
    const before = await row.evaluate((el) => el.scrollLeft);
    await arrow.click();
    await expect.poll(() => row.evaluate((el) => el.scrollLeft)).toBeGreaterThan(before);
    await expect(row).toHaveClass(/dds-cue-l/);   // now there's more back the other way too
    await row.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
    await expect(row).not.toHaveClass(/dds-cue-r/);
    await expect(arrow).toBeHidden();
    // the arrow is a pointer's way along: no chip took it for one of its own
    await expect(row.getByRole('button')).toHaveCount(await row.locator('button').count());
    expect(await arrow.getAttribute('aria-hidden')).toBe('true');
  });

  test('a table someone picked on a phone fades at the edge that has more', async ({ page }) => {
    test.skip(!phone(), 'a phone');
    await page.addInitScript(() => { try { localStorage.setItem('dds-display:contacts', 'table'); } catch { /* denied */ } });
    await installApp(page, { api: CONTACTS_API as never });
    await page.goto('/contacts.html');
    const wrap = page.locator('.tscroll').first();
    await expect(wrap.locator('table')).toBeVisible();
    await settled(page);
    await expect(wrap).toHaveClass(/dds-cue-r/);
    await expect(wrap).not.toHaveClass(/dds-cue-l/);
    await wrap.evaluate((el) => { el.scrollLeft = 120; });
    await expect(wrap).toHaveClass(/dds-cue-l/);
  });

  test('Customers on a phone: a card with two facts never squeezes the names; the facts go under the name', async ({ page }) => {
    test.skip(!phone(), 'a phone');
    await installApp(page, { api: CUSTOMERS_API as never });
    await page.goto('/customers.html');
    const cards = page.locator('.clist .cust');
    await expect(cards.first()).toBeVisible();
    const widths = await page.locator('.clist .cust .who').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
    expect(widths.length).toBeGreaterThan(3);
    for (const w of widths) expect(w, 'every name has room to read').toBeGreaterThan(150);
    // a card that owes and has a request waiting shows both, under the name
    const two = cards.filter({ has: page.locator('.facts .fact:nth-child(2)') }).first();
    await expect(two).toBeVisible();
    const name = await two.locator('.who').boundingBox(), facts = await two.locator('.facts').boundingBox();
    expect(facts!.y).toBeGreaterThanOrEqual(name!.y + name!.height - 1);
  });

  test('a touch tablet opens Contacts and Home on the cards; a computer keeps the table', async ({ page }) => {
    test.skip(test.info().project.name === 'mobile', 'a phone always opened on the cards');
    await installApp(page, { api: CONTACTS_API as never });
    await page.goto('/contacts.html');
    await expect(page.locator('#dispCards')).toBeVisible();
    await expect(page.locator(touch() ? '#dispCards' : '#dispTable')).toHaveAttribute('aria-pressed', 'true');
    await installApp(page, { api: AGENCY_API as never });
    await page.goto('/agency.html');
    await expect(page.locator('#dispCards')).toBeVisible();
    await expect(page.locator(touch() ? '#dispCards' : '#dispTable')).toHaveAttribute('aria-pressed', 'true');
  });

  test('Send an update on a phone: the send bar’s buttons sit clear of the tab bar', async ({ page }) => {
    test.skip(!phone(), 'a phone');
    await installApp(page, { api: BROADCASTS_API as never });
    await page.goto('/broadcasts.html');
    await expect(page.locator('#preview')).toBeVisible();
    await settled(page);
    for (const id of ['#preview', '#schedule', '#sendUpdate']) {
      const el = page.locator(id);
      if (!(await el.isVisible())) continue;
      await el.scrollIntoViewIfNeeded();
      const hits = await el.evaluate((b) => {
        const r = b.getBoundingClientRect();
        return [r.top + 4, r.top + r.height / 2, r.bottom - 4].map((y) => { const h = document.elementFromPoint(r.left + r.width / 2, y); return !!h && (h === b || b.contains(h)); });
      });
      expect(hits, `${id} is pressable top to bottom`).toEqual([true, true, true]);
    }
  });
});
