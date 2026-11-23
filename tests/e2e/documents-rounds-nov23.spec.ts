import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp } from './helpers/app';
import { pinClock, PINNED_NOW, daysFrom } from './helpers/clock';

// Sales items 180 and 179 (Nov 22 2026 review), the page halves (the server halves are in
// tests/presence/documents_rounds_nov23_test.mjs):
//   180  the Documents page: every proposal, estimate and agreement, chips, a search, Remind once
//   179  the deal's Details take the rounds of changes included, and say how many are used
// Every name and amount is made up.

const DEAL = '22222222-2222-4222-8222-222222222222';
const at = (d: number) => daysFrom(PINNED_NOW, d);
const doc = (id: string, over: Record<string, unknown>) => ({ kind: 'proposal', id, deal_id: DEAL, deal_title: 'Blue Finch Café website', deal_gone: false, title: 'Website', version: 1, business: 'Blue Finch Café', person: 'Riley Park', amount_cents: 240000, state: 'out', sent_at: at(-2), opened_at: null, expires_at: at(28), decided_at: null, created_at: at(-3), reminded_at: null, can_remind: true, ...over });
const ITEMS = [
  doc('a1111111-1111-4111-8111-111111111111', {}),
  doc('a2222222-2222-4222-8222-222222222222', { kind: 'contract', title: 'Service agreement', state: 'opened', opened_at: at(-1) }),
  doc('a3333333-3333-4333-8333-333333333333', { kind: 'estimate', title: 'Logo', business: 'Juniper Floral', person: 'Sam Lee', amount_cents: 50000, state: 'expired', expires_at: at(-1), can_remind: false }),
  doc('a4444444-4444-4444-8444-444444444444', { title: 'Old website', state: 'accepted', decided_at: at(-9), can_remind: false }),
  doc('a5555555-5555-4555-8555-555555555555', { kind: 'contract', title: 'Care plan', state: 'signed', decided_at: at(-20), can_remind: false, reminded_at: null }),
];
async function serveDocs(page: Page, items = ITEMS) {
  await installApp(page, { api: { '/sales/documents': { data: { items, today: PINNED_NOW.slice(0, 10), partial: false } } } });
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  await page.route((u) => u.pathname.endsWith('/functions/v1/presence/sales/documents/remind'), async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    posts.push({ path: '/sales/documents/remind', body });
    const second = posts.filter((p) => p.body.id === body.id).length > 1;
    return route.fulfill({ status: second ? 409 : 200, contentType: 'application/json', body: JSON.stringify(second ? { error: 'already_reminded', message: 'You reminded them already. One reminder per document, so it never nags.' } : { data: { ok: true, reminded_at: PINNED_NOW } }) });
  });
  return posts;
}
const PATIENT = { timeout: 20_000 };

test.describe('item 180: the Documents page', () => {
  test('every document in one list, with chips that narrow it and a search', async ({ page }) => {
    await pinClock(page);
    await serveDocs(page);
    await page.goto('/documents.html');
    await expect(page.getByRole('heading', { name: 'Documents', level: 1 })).toBeVisible();
    await expect(page.locator('#phLine')).toHaveText('5 documents · 2 still out · 1 expired');
    const rows = page.locator('table[aria-label="Documents"] tbody tr, .cards .card').filter({ visible: true });
    await expect(rows).toHaveCount(5);
    await page.getByRole('button', { name: /^Out 2$/ }).click();
    await expect(rows).toHaveCount(2);
    await page.getByRole('button', { name: /^Expired 1$/ }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Logo');
    await expect(rows.first()).toContainText('Expired');
    await page.getByRole('button', { name: /^All 5$/ }).click();
    await page.getByLabel('Find a document or a customer').fill('juniper');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Juniper Floral');
  });

  test('Remind re-sends once, then reads Reminded; answered or expired ones offer none', async ({ page }) => {
    await pinClock(page);
    const posts = await serveDocs(page);
    await page.goto('/documents.html');
    const first = page.locator('[data-doc="a1111111-1111-4111-8111-111111111111"]').filter({ visible: true });
    await first.getByRole('button', { name: 'Remind them about Website' }).click();
    await expect.poll(() => posts.map((p) => p.body), PATIENT).toEqual([{ kind: 'proposal', id: 'a1111111-1111-4111-8111-111111111111' }]);
    await expect(page.locator('.dds-toast').filter({ hasText: 'Reminder sent to Riley Park' })).toBeVisible();
    await expect(page.locator('[data-doc="a1111111-1111-4111-8111-111111111111"]').filter({ visible: true })).toContainText('Reminded');
    await expect(page.locator('[data-doc="a1111111-1111-4111-8111-111111111111"]').filter({ visible: true }).getByRole('button', { name: /Remind/ })).toHaveCount(0);
    // the expired estimate and the answered ones offer no Remind
    for (const id of ['a3333333-3333-4333-8333-333333333333', 'a4444444-4444-4444-8444-444444444444', 'a5555555-5555-4555-8555-555555555555']) await expect(page.locator(`[data-doc="${id}"]`).filter({ visible: true }).getByRole('button', { name: /Remind/ })).toHaveCount(0);
  });

  test('no serious or critical accessibility problems; 44px taps on a phone', async ({ page }, testInfo) => {
    await pinClock(page);
    await serveDocs(page);
    await page.goto('/documents.html');
    await expect(page.locator('#phLine')).toBeVisible();
    if (testInfo.project.name === 'desktop-chromium') {
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => v.id)).toEqual([]);
    }
    if (testInfo.project.name === 'mobile') {
      for (const b of await page.locator('.chip, .cards .pill').all()) { const box = await b.boundingBox(); expect(box && box.height).toBeGreaterThanOrEqual(44); }
    }
  });
});

test.describe('item 179: rounds of changes on the deal', () => {
  test('Details take the rounds included and say how many are used', async ({ page }) => {
    await pinClock(page);
    await installApp(page, { api: {
      '/sales/deals': { data: [{ id: DEAL, title: 'Blue Finch Café website', stage: 'won', source: 'manual', expected_value_cents: 250000, expected_close: null, contact_id: 'ct-1', converted_client_id: null, updated_at: at(-1), next_step: null, next_step_at: null }] },
      [`/sales/deals/${DEAL}`]: { data: { deal: { id: DEAL, title: 'Blue Finch Café website', stage: 'won', expected_value_cents: 250000, expected_close: null, next_step: null, next_step_at: null, notes: '', contact_id: 'ct-1', converted_client_id: null, retainer: null, revision_rounds: 2 },
        contact: { id: 'ct-1', name: 'Riley Park', email: 'riley@example.org', phone: '', company: 'Blue Finch Café', notes: '' }, proposals: [], contracts: [], events: [], invoices: [], last_contacted_at: null, timeline: [], estimates: [], recurring: [],
        rounds: { included: 2, used: 3, line: '2 of 2 rounds of changes used, and 1 more asked for as extra work' } } },
      [`/sales/deals/${DEAL}/tasks`]: { data: [] }, '/sales/templates': { data: [] }, '/sales/services': { data: [] }, '/sales/contacts': { data: [] },
      '/sales/summary': { data: { total: 1, open: { count: 0, value_cents: 0 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 }, by_stage: [] } }, '/sales/receivables': { data: { items: [], total_cents: 0 } },
    } });
    const saves: Array<Record<string, unknown>> = [];
    await page.route((u) => u.pathname.endsWith(`/functions/v1/presence/sales/deals/${DEAL}`), (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      saves.push(JSON.parse(route.request().postData() || '{}'));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { id: DEAL } }) });
    });
    await page.goto(`/pipeline.html?deal=${DEAL}`);
    const box = page.getByLabel('Rounds of changes included');
    await expect(box).toHaveValue('2');
    await expect(page.locator('#ed-rounds-line')).toContainText('2 of 2 rounds of changes used, and 1 more asked for as extra work');
    await box.fill('3');
    await page.getByRole('button', { name: 'Save details' }).click();
    await expect.poll(() => saves.length, PATIENT).toBe(1);
    expect(saves[0].revision_rounds).toBe(3);
  });
});
