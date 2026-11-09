import { test, expect } from '@playwright/test';
import { installApp } from './helpers/app';

// Item 65 (Nov 2026): the record and the pipeline judge "today" on the studio's
// LOCAL day. They used the UTC date, so from 4pm in Los Angeles a to-do due today
// read red "overdue", the quick-log refused today's date, and the server counted
// today's invoices overdue. These run with a fixed clock near midnight in two
// zones either side of UTC (the suite's default zone is UTC, which hides it).

type Page = import('@playwright/test').Page;
const DEAL = '11111111-1111-4111-8111-111111111111';
const DEAL2 = '22222222-2222-4222-8222-222222222222';
const DEAL3 = '33333333-3333-4333-8333-333333333333';
// 11:30pm on Monday Nov 9 in Los Angeles: the UTC day is already Nov 10
const LA_LATE = new Date('2026-11-10T07:30:00Z');
// 12:10am on Tuesday Nov 10 in Los Angeles: Nov 9 has now passed
const LA_AFTER_MIDNIGHT = new Date('2026-11-10T08:10:00Z');
// 12:30am on Tuesday Nov 10 in Auckland: the UTC day is still Nov 9
const AKL_EARLY = new Date('2026-11-09T11:30:00Z');

const deal = (id: string, title: string, step: string, at: string) => ({ id, title, stage: 'proposal', source: 'manual', expected_value_cents: 100000, expected_close: null, contact_id: null, converted_client_id: null, updated_at: '2026-11-01T00:00:00Z', next_step: step, next_step_at: at, last_contacted_at: null, agreement_signed: false });
const DEALS = { data: [
  deal(DEAL, 'Acme website', 'Call Sam', '2026-11-09'),
  deal(DEAL2, 'Beta rebrand', 'Send the quote', '2026-11-08'),
  deal(DEAL3, 'Gamma launch', 'Book the shoot', '2026-11-10'),
] };
const TASKS = { data: [
  { id: 't1', title: 'Ring the printer', due_date: '2026-11-09', status: 'open' },
  { id: 't2', title: 'Chase the deposit', due_date: '2026-11-08', status: 'open' },
  { id: 't3', title: 'Order the sign', due_date: '2026-11-10', status: 'open' },
] };
const API = {
  '/sales/deals': DEALS,
  [`/sales/deals/${DEAL}`]: { data: { deal: { ...DEALS.data[0], notes: '', retainer: null }, contact: { id: 'ct-1', name: 'Sam Rivera', email: 'sam@example.com', phone: '', company: 'Acme', notes: '' }, proposals: [], contracts: [], events: [], timeline: [], invoices: [], last_contacted_at: null } },
  [`/sales/deals/${DEAL}/tasks`]: TASKS,
  '/sales/summary': { data: { total: 3, open: { count: 3, value_cents: 300000 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 }, by_stage: [], ar: {} } },
  '/sales/contacts': { data: [] },
  '/sales/receivables': { data: { items: [], total_cents: 0 } },
  '/sales/templates': { data: [] },
  '/sales/services': { data: [] },
  '/identity': { data: { business_name: 'Test Studio' } },
};
const display = (page: Page, v: 'list' | 'table' | 'board') =>
  page.addInitScript((val) => { try { localStorage.setItem('dds-display:pipeline', val); } catch { /* denied */ } }, v);

test.describe('Los Angeles, 11:30pm: the local day is still Nov 9', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });

  test('List, Table and Board: a step due today says "Due today", never overdue; yesterday’s says Overdue', async ({ page }) => {
    await page.clock.setFixedTime(LA_LATE);
    await display(page, 'list');
    await installApp(page, { api: API });
    await page.goto('/pipeline.html');
    const card = (t: string) => page.locator('#list .card').filter({ hasText: t });
    await expect(card('Acme website')).toContainText('Due today: Call Sam');
    await expect(card('Acme website')).not.toContainText('Overdue');
    await expect(card('Beta rebrand')).toContainText('Overdue: Send the quote');
    await expect(card('Gamma launch')).toContainText('Next: Book the shoot');
    await expect(card('Gamma launch')).not.toContainText(/Due|Overdue/);

    await page.locator('#viewTable').click();
    const row = (t: string) => page.locator('#table tbody tr').filter({ hasText: t });
    await expect(row('Acme website').locator('.due-today')).toHaveText('Due today: Call Sam');
    await expect(row('Acme website').locator('.over')).toHaveCount(0);
    await expect(row('Beta rebrand').locator('.over')).toContainText('Overdue: Send the quote');
    await expect(row('Gamma launch').locator('.over, .due-today')).toHaveCount(0);

    await page.locator('#viewBoard').click();
    const bcard = (t: string) => page.locator('#board .bcard').filter({ hasText: t });
    await expect(bcard('Acme website').locator('.bc-due')).toHaveText('Due today: Call Sam');
    await expect(bcard('Acme website').locator('.bc-due')).not.toHaveClass(/late/);
    await expect(bcard('Beta rebrand').locator('.bc-due.late')).toHaveText('Overdue: Send the quote');
    await expect(bcard('Gamma launch').locator('.bc-due')).toHaveCount(0);
  });

  test('the deal’s to-dos, the quick log and the server reads all use Nov 9', async ({ page }) => {
    await page.clock.setFixedTime(LA_LATE);
    await display(page, 'list');
    await installApp(page, { api: API });
    const days: string[] = [];
    page.on('request', (r) => { const u = new URL(r.url()); if (/\/sales\/(summary|receivables)$/.test(u.pathname)) days.push(u.pathname.split('/').pop() + '=' + u.searchParams.get('today')); });
    await page.goto(`/pipeline.html?deal=${DEAL}`);
    const todo = (t: string) => page.locator('#dealTasks .row2').filter({ hasText: t });
    await expect(todo('Ring the printer').locator('.tk-due')).toHaveText('· due today');
    await expect(todo('Ring the printer').locator('.tk-due')).toHaveClass(/today/);
    await expect(todo('Chase the deposit').locator('.tk-due')).toHaveText('· overdue · Nov 8, 2026');
    await expect(todo('Order the sign').locator('.tk-due')).toHaveText('· Nov 10, 2026');
    await expect(todo('Order the sign').locator('.tk-due')).not.toHaveClass(/today|overdue/);
    // the quick log (the Activity tab) offers today, and today is allowed
    await page.locator('#detailInner .tabs [data-dtab="activity"]').click();
    await expect(page.locator('#qlDate')).toHaveValue('2026-11-09');
    await expect(page.locator('#qlDate')).toHaveAttribute('max', '2026-11-09');
    const posted = page.waitForRequest((r) => r.method() === 'POST' && /\/sales\/deals\/[^/]+\/activity$/.test(new URL(r.url()).pathname));
    await page.locator('#qlSave').click();
    // the picked day goes as local noon, so the server files it under Nov 9 in any zone
    expect((await posted).postDataJSON().occurred_at).toBe('2026-11-09T20:00:00.000Z');
    // the Outstanding tile's and Who owes you's overdue are asked for on the local day
    await expect.poll(() => days.find((d) => d.startsWith('summary='))).toBe('summary=2026-11-09');
  });

  test('the record’s Upcoming & overdue band: due today is "due today" even when the server (UTC) said overdue', async ({ page }) => {
    await page.clock.setFixedTime(LA_LATE);
    const CLIENT = 'cccccccc-3333-4333-8333-cccccccccccc';
    const PROJECT = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee';
    let activityDay: string | null = null;
    await installApp(page, { api: {
      '/crm/record': { data: {
        identity: { contact_id: null, deal_id: DEAL, client_id: null, customer_site_id: CLIENT, project_id: PROJECT },
        header: { name: 'Marlow’s Kitchen', company: '', email: '', phone: '', status: 'customer' },
        highlights: {}, sections: { overview: true, messages: true, deal: false, delivery: false, details: false },
        default_tab: 'overview', canonical: { key: 'client', value: CLIENT },
      } },
      // what a server before this change sends at 11:30pm in Los Angeles: judged on Nov 10
      '/crm/activity': { data: { items: [], project_id: PROJECT, deal_id: DEAL, reply_to: null, reply_support_to: null, upcoming: [
        { kind: 'task', id: 't2', title: 'Chase the deposit', due: '2026-11-08', overdue: true, href: null },
        { kind: 'task', id: 't1', title: 'Ring the printer', due: '2026-11-09', overdue: true, href: null },
        { kind: 'task', id: 't3', title: 'Order the sign', due: '2026-11-10', overdue: false, href: null },
      ] } },
    } });
    page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.endsWith('/crm/activity')) activityDay = u.searchParams.get('today'); });
    await page.goto(`/crm.html?client=${CLIENT}`);
    const up = (t: string) => page.locator('.uprow').filter({ hasText: t });
    await expect(up('Ring the printer')).toHaveClass(/today/);
    await expect(up('Ring the printer')).not.toHaveClass(/overdue/);
    await expect(up('Ring the printer').locator('.due')).toHaveText('due today');
    await expect(up('Chase the deposit')).toHaveClass(/overdue/);
    await expect(up('Chase the deposit').locator('.due')).toHaveText('overdue · Nov 8');
    await expect(up('Order the sign').locator('.due')).toHaveText('Nov 10');
    expect(activityDay).toBe('2026-11-09');
  });

  test('the record’s log offers today and sends it as local noon', async ({ page }) => {
    await page.clock.setFixedTime(LA_LATE);
    const CLIENT = 'cccccccc-3333-4333-8333-cccccccccccc';
    const PROJECT = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee';
    await installApp(page, { api: {
      '/crm/record': { data: {
        identity: { contact_id: null, deal_id: DEAL, client_id: null, customer_site_id: CLIENT, project_id: PROJECT },
        header: { name: 'Marlow’s Kitchen', company: '', email: '', phone: '', status: 'customer' },
        highlights: {}, sections: { overview: true, messages: true, deal: true, delivery: false, details: false },
        default_tab: 'overview', canonical: { key: 'client', value: CLIENT },
      } },
      '/crm/activity': { data: { items: [], upcoming: [], project_id: PROJECT, deal_id: DEAL, reply_to: null, reply_support_to: null } },
      [`/sales/deals/${DEAL}`]: { data: { deal: { ...DEALS.data[0], notes: '', retainer: null }, contact: null, proposals: [], contracts: [], events: [], timeline: [], invoices: [], last_contacted_at: null } },
      [`/sales/deals/${DEAL}/tasks`]: { data: [] },
    } });
    await page.goto(`/crm.html?client=${CLIENT}`);
    await page.locator('[data-ct="logcall"]').click();
    await expect(page.locator('#logDate')).toHaveValue('2026-11-09');
    await expect(page.locator('#logDate')).toHaveAttribute('max', '2026-11-09');
    const posted = page.waitForRequest((r) => r.method() === 'POST' && /\/sales\/deals\/[^/]+\/activity$/.test(new URL(r.url()).pathname));
    await page.locator('#logGo').click();
    expect((await posted).postDataJSON().occurred_at).toBe('2026-11-09T20:00:00.000Z');
  });
});

test.describe('Los Angeles, ten past midnight: Nov 9 has passed', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });
  test('the step and the to-do due Nov 9 are overdue now', async ({ page }) => {
    await page.clock.setFixedTime(LA_AFTER_MIDNIGHT);
    await display(page, 'list');
    await installApp(page, { api: API });
    await page.goto(`/pipeline.html?deal=${DEAL}`);
    await expect(page.locator('#dealTasks .row2').filter({ hasText: 'Ring the printer' }).locator('.tk-due')).toHaveText('· overdue · Nov 9, 2026');
    await expect(page.locator('#dealTasks .row2').filter({ hasText: 'Order the sign' }).locator('.tk-due')).toHaveText('· due today');
  });
});

test.describe('Auckland, 12:30am: a day ahead of UTC', () => {
  test.use({ timezoneId: 'Pacific/Auckland' });
  test('a step due Nov 9 is overdue (the UTC day would still call it today); Nov 10’s is due today', async ({ page }) => {
    await page.clock.setFixedTime(AKL_EARLY);
    await display(page, 'list');
    await installApp(page, { api: API });
    await page.goto('/pipeline.html');
    const card = (t: string) => page.locator('#list .card').filter({ hasText: t });
    await expect(card('Acme website')).toContainText('Overdue: Call Sam');
    await expect(card('Gamma launch')).toContainText('Due today: Book the shoot');
  });
});
