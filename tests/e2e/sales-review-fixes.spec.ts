import { test, expect } from '@playwright/test';
import { installApp } from './helpers/app';

// Sales review, Nov 2026 — the page half of "fix what is wrong today":
//   B4  a Won deal read "Due: Sign Contract" in red at the top of Pipeline. A
//       closed deal's step is never "Due", a finished one (next_step_done from
//       the server) is not shown, and closed deals sort below open ones.
//   B5  one draft proposal read its price before discount on the record and $0 on the deal page;
//       the record now shows the server's after-discount total_cents.
//   B13 the deal page's Call / Email / Meeting / Note buttons printed their
//       icon's code as text (and so had that code as their name).
//   B12 Settings' Domain & email card says where it goes for platform staff.

const OPEN = '11111111-1111-4111-8111-111111111111';
const WON_DONE = '22222222-2222-4222-8222-222222222222';
const WON_STEP = '33333333-3333-4333-8333-333333333333';
const past = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
const pastDay = (d: number) => past(d).slice(0, 10);

const DEALS = { data: [
  // listed first by the API on purpose: the page must still put the open deal on top
  { id: WON_DONE, title: 'Harbor Lane Bakery', stage: 'won', source: 'manual', expected_value_cents: 240000, expected_close: null, contact_id: 'ct-1', converted_client_id: 'cl-1', updated_at: past(1), next_step: 'Sign Contract', next_step_at: pastDay(90), next_step_done: true, last_contacted_at: null, agreement_signed: true },
  { id: WON_STEP, title: 'Northside Dental site', stage: 'won', source: 'manual', expected_value_cents: 50000, expected_close: null, contact_id: 'ct-1', converted_client_id: 'cl-2', updated_at: past(2), next_step: 'Send the welcome pack', next_step_at: pastDay(5), next_step_done: false, last_contacted_at: null, agreement_signed: true },
  { id: OPEN, title: 'Acme website', stage: 'proposal', source: 'manual', expected_value_cents: 500000, expected_close: null, contact_id: 'ct-1', converted_client_id: null, updated_at: past(3), next_step: 'Follow up call', next_step_at: pastDay(2), last_contacted_at: null, agreement_signed: false },
] };
const API = {
  '/sales/deals': DEALS,
  [`/sales/deals/${OPEN}`]: { data: {
    deal: { id: OPEN, title: 'Acme website', stage: 'proposal', expected_value_cents: 500000, expected_close: null, next_step: 'Follow up call', next_step_at: pastDay(2), notes: '', contact_id: 'ct-1', converted_client_id: null, retainer: null },
    contact: { id: 'ct-1', name: 'Sam Rivera', email: 'sam@example.com', phone: '', company: 'Acme', notes: '' },
    proposals: [], contracts: [], events: [], timeline: [], invoices: [], last_contacted_at: null,
  } },
  [`/sales/deals/${OPEN}/tasks`]: { data: [] },
  '/sales/summary': { data: { total: 3, open: { count: 1, value_cents: 500000 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 2, lost: 0 }, by_stage: [], ar: {} } },
  '/sales/contacts': { data: [{ id: 'ct-1', name: 'Sam Rivera', email: 'sam@example.com', phone: '', company: 'Acme', updated_at: past(1) }] },
  '/sales/templates': { data: [] },
  '/sales/services': { data: [] },
  '/sales/receivables': { data: { items: [], total_cents: 0 } },
  '/identity': { data: { business_name: 'Test Studio' } },
};
const display = (page: import('@playwright/test').Page, v: 'list' | 'table') =>
  page.addInitScript((val) => { try { localStorage.setItem('dds-display:pipeline', val); } catch { /* denied */ } }, v);

test.describe('B4 — a closed deal never reads as overdue', () => {
  test('List: the open deal leads; a finished step on a Won deal is gone; another step is plain, never Due', async ({ page }) => {
    await display(page, 'list');
    await installApp(page, { api: API });
    await page.goto('/pipeline.html');
    const cards = page.locator('#list .card');
    await expect(cards).toHaveCount(3);
    await expect(cards.first()).toContainText('Acme website');
    await expect(cards.first()).toContainText('Overdue: Follow up call');    // an open deal still says it is late (item 65: "Overdue" once its day has passed)
    const closedDone = cards.filter({ hasText: 'Harbor Lane Bakery' });
    await expect(closedDone).not.toContainText('Sign Contract');
    await expect(closedDone).not.toContainText(/Due( today)?:|Overdue:/);
    const closedNext = cards.filter({ hasText: 'Northside Dental site' });
    await expect(closedNext).toContainText('Next: Send the welcome pack');
    await expect(closedNext).not.toContainText(/Due( today)?:|Overdue:/);
  });

  test('Table: closed rows sort after open ones under the default sort, with no red step', async ({ page }) => {
    await display(page, 'table');
    await installApp(page, { api: API });
    await page.goto('/pipeline.html');
    const rows = page.locator('#table tbody tr');
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toContainText('Acme website');
    await expect(rows.first().locator('.over')).toContainText('Overdue: Follow up call');
    const closedDone = rows.filter({ hasText: 'Harbor Lane Bakery' });
    await expect(closedDone).not.toContainText('Sign Contract');
    await expect(closedDone.locator('.over')).toHaveCount(0);
    await expect(rows.filter({ hasText: 'Northside Dental site' }).locator('.over')).toHaveCount(0);
  });

  test('an older server without next_step_done still never paints a closed deal red', async ({ page }) => {
    await display(page, 'list');
    const legacy = { data: DEALS.data.map(({ next_step_done: _d, ...d }) => d) };
    await installApp(page, { api: { ...API, '/sales/deals': legacy } });
    await page.goto('/pipeline.html');
    const closedDone = page.locator('#list .card').filter({ hasText: 'Harbor Lane Bakery' });
    await expect(closedDone).toContainText('Next: Sign Contract');
    await expect(closedDone).not.toContainText(/Due( today)?:|Overdue:/);
  });
});

test.describe('B13 — the deal page\'s activity buttons read as words', () => {
  test('Call · Email · Meeting · Note, no icon code as text, one pressed at a time', async ({ page }) => {
    await display(page, 'list');
    await installApp(page, { api: API });
    await page.goto(`/pipeline.html?deal=${OPEN}`);
    await page.getByRole('tab', { name: /Activity/ }).click();
    const kinds = page.locator('#qlKinds .kb');
    await expect(kinds).toHaveCount(4);
    await expect(kinds).toHaveText([/Call/, /Email/, /Meeting/, /Note/]);
    for (const t of await kinds.allTextContents()) expect(t).not.toContain('<svg');
    await expect(page.locator('#qlKinds').getByRole('button', { name: 'Email' })).toHaveAttribute('aria-pressed', 'false');
    await page.locator('#qlKinds').getByRole('button', { name: 'Email' }).click();
    await expect(page.locator('#qlKinds').getByRole('button', { name: 'Email' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#qlKinds').getByRole('button', { name: 'Call' })).toHaveAttribute('aria-pressed', 'false');
    // bold redesign, one word per action: the button names what it logs ("Log call" as in + Create, never "Log it")
    await expect(page.locator('#qlSave')).toHaveText('Log email');
    await page.locator('#qlKinds').getByRole('button', { name: 'Note' }).click();
    await expect(page.locator('#qlSave')).toHaveText('Add note');
    await page.locator('#qlKinds').getByRole('button', { name: 'Call' }).click();
    await expect(page.locator('#qlSave')).toHaveText('Log call');
  });
});

test.describe('B5 — the record shows the proposal\'s real total', () => {
  const CLIENT = '44444444-4444-4444-8444-444444444444';
  const DEAL = '55555555-5555-4555-8555-555555555555';
  const PROJECT = '66666666-6666-4666-8666-666666666666';
  const RECORD = { data: {
    identity: { contact_id: null, deal_id: DEAL, client_id: 'cl-1', customer_site_id: CLIENT, project_id: PROJECT },
    header: { name: 'Maple Street Studio', company: '', email: 'h@example.com', phone: '', status: 'customer' },
    highlights: { value_cents: 0, stage: 'won', owed_cents: 0 },
    sections: { overview: true, details: true, deal: true, delivery: true },
    default_tab: 'billing',
    canonical: { key: 'client', value: CLIENT },
  } };
  const deal = (p: Record<string, unknown>) => ({ data: {
    deal: { id: DEAL, title: 'Maple Street Studio', stage: 'won', expected_value_cents: 0, converted_client_id: 'cl-1' },
    proposals: [{ id: 'p-1', title: 'Proposal', status: 'draft', ...p }],
    contracts: [], invoices: [],
  } });
  const common = { '/crm/record': RECORD, '/crm/activity': { data: { items: [] } }, [`/projects/${PROJECT}`]: { data: { project: { id: PROJECT, name: 'Maple Street Studio', status: 'active' }, milestones: [], tasks: [], deliverables: [] } } };

  test('a fully discounted draft reads $0, the same as the deal page — not the price before discount', async ({ page }) => {
    await installApp(page, { api: { ...common, [`/sales/deals/${DEAL}`]: deal({ subtotal_cents: 240000, total_cents: 0 }) } });
    await page.goto(`/crm.html?client=${CLIENT}&tab=billing`);
    const row = page.locator('.rrow.brow').filter({ hasText: 'Proposal' }).first();
    await expect(row).toContainText('$0');
    await expect(row).not.toContainText('$2,400');
  });

  test('an older server without total_cents still shows the stored subtotal', async ({ page }) => {
    await installApp(page, { api: { ...common, [`/sales/deals/${DEAL}`]: deal({ subtotal_cents: 240000 }) } });
    await page.goto(`/crm.html?client=${CLIENT}&tab=billing`);
    await expect(page.locator('.rrow.brow').filter({ hasText: 'Proposal' }).first()).toContainText('$2,400');
  });
});
