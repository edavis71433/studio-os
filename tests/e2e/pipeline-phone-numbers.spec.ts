import { test, expect } from '@playwright/test';
import { installApp } from './helpers/app';

// Bold redesign leftovers (Nov 2026): on a phone, Pipeline's four numbers share one short row
// (item 58) at the phone size, as in the design's phone frame. The look refresh made them 24px,
// which cut "$10,850" to "$10,85" in a quarter of an iPhone. Each card is a subgrid of the row,
// so a label that wraps ("Won this month") can't push its number below the others, and Open's
// line says just what's expected (the header already counts the deals). A computer, a tablet
// and a 360px phone (two by two) keep the big numbers.

const D = (n: number) => `aaaaaaaa-0000-4000-8000-00000000000${n}`;
const ago = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const api = (openCents: number) => ({
  '/sales/deals': { data: [
    { id: D(1), title: 'Juniper Floral — new site', stage: 'qualified', expected_value_cents: 320000, created_at: ago(20), updated_at: ago(2) },
    { id: D(2), title: 'Kestrel Yoga — class booking', stage: 'lead', expected_value_cents: 110000, created_at: ago(4), updated_at: ago(3) },
  ] },
  '/sales/summary': { data: {
    total: 7, open: { count: 6, value_cents: openCents }, won_month: { count: 1, value_cents: 195000 },
    win_rate: { pct: 83, won: 5, lost: 1 }, by_stage: [], expected: { value_cents: 338000 },
    ar: { outstanding_cents: 65000, count: 1, overdue_count: 0 },
  } },
});

type Fact = { top: number; vTop: number; cut: boolean; kOut: boolean; font: number };
const facts = (page: import('@playwright/test').Page) => page.locator('.stats .st:visible').evaluateAll((els) => els.map((el) => {
  const card = el.getBoundingClientRect(), k = el.querySelector('.k') as HTMLElement, v = el.querySelector('.v') as HTMLElement;
  return { top: Math.round(card.top), vTop: Math.round(v.getBoundingClientRect().top), cut: v.scrollWidth > v.clientWidth + 1,
    kOut: k.getBoundingClientRect().right > card.right + 0.5, font: parseFloat(getComputedStyle(v).fontSize) };
}) as Fact[]);

test.describe('Pipeline — the numbers fit every screen (bold redesign)', { tag: '@layout' }, () => {
  test('a phone: one short row at the phone size, the numbers lined up, none cut off', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'phone widths under test');
    await installApp(page, { api: api(1085000) });
    for (const width of [375, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/pipeline.html');
      await expect(page.locator('.stats .st:visible')).toHaveCount(4);
      await expect(page.locator('.stats .v').first()).toHaveText('$10,850');
      const f = await facts(page);
      expect(new Set(f.map((x) => x.top)).size, `one row at ${width}px`).toBe(1);
      expect(new Set(f.map((x) => x.vTop)).size, `numbers lined up at ${width}px`).toBe(1);
      expect(f.filter((x) => x.cut), `no number cut off at ${width}px`).toEqual([]);
      expect(f.filter((x) => x.kOut), `labels inside their cards at ${width}px`).toEqual([]);
      expect(Math.max(...f.map((x) => x.font))).toBeLessThanOrEqual(15);
      expect(await page.locator('.stats .st').first().locator('.s').evaluate((e) => (e as HTMLElement).innerText.trim())).toBe('$3,380 expected');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  });

  test('a phone: a long number shrinks to fit its card instead of being cut', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'phone widths under test');
    await installApp(page, { api: api(1245050) });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/pipeline.html');
    await expect(page.locator('.stats .v').first()).toHaveText('$12,450.50');
    const [open] = await facts(page);
    expect(open.cut).toBe(false);
    expect(open.font).toBeGreaterThanOrEqual(11);
    expect(open.font).toBeLessThan(15);
  });

  test('a 360px phone keeps its two-by-two cards with the big numbers', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'phone widths under test');
    await installApp(page, { api: api(1085000) });
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto('/pipeline.html');
    await expect(page.locator('.stats .st:visible')).toHaveCount(4);
    const f = await facts(page);
    expect(new Set(f.map((x) => x.top)).size).toBe(2);
    expect(f.filter((x) => x.cut)).toEqual([]);
    expect(f.every((x) => x.font === 24)).toBe(true);
  });

  test('a computer or tablet keeps the big numbers, the Expected card and the deal count', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'a phone has its own row');
    await installApp(page, { api: api(1085000) });
    await page.goto('/pipeline.html');
    await expect(page.locator('.stats .st:visible')).toHaveCount(5);   // Open · Expected · Won this month · Win rate · Outstanding
    const f = await facts(page);
    expect(f.filter((x) => x.cut)).toEqual([]);
    expect(f.every((x) => x.font === 24)).toBe(true);
    expect(await page.locator('.stats .st').first().locator('.s').evaluate((e) => (e as HTMLElement).innerText.trim())).toBe('across 6 deals');
  });
});
