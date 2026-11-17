// Builder item 98's tap-target walk borrows this spec's made-up fixtures, copied as they are from tests/e2e/pipeline-phone-numbers.spec.ts.
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

export const PIPELINE_98 = api(1085000);
