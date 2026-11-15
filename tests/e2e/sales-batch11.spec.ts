import { test, expect } from '@playwright/test';
import { installApp } from './helpers/app';

// Sales review, Nov 8 2026 — fixes from the second walk of the live sales side
// (reports/salesforce-review/SALES-WALK-2-2026-11-08.md). Fictional names.
//   49 the record asks for the business name; its details Edit opens the editor
//   50 a won deal's old next step is not the next step
//   51 a site hosted elsewhere says so   52 the won tip reads the project
//   53 My tasks shows each project's next step   54 one-word Inbox badges
//   55 won deals never "close"   57–59 phones

const CLIENT = '44444444-4444-4444-8444-444444444444';
const DEAL = '55555555-5555-4555-8555-555555555555';
const PROJECT = '66666666-6666-4666-8666-666666666666';
const RECORD = { data: {
  identity: { contact_id: 'ct-1', deal_id: DEAL, client_id: 'cl-1', customer_site_id: CLIENT, project_id: PROJECT },
  header: { name: 'Sam Rivera', company: '', person: '', email: 'sam@example.com', phone: '', status: 'customer' },
  highlights: { value_cents: 320000, stage: 'won', owed_cents: 0 },
  sections: { overview: true, messages: true, deal: true, delivery: true, details: true },
  default_tab: 'delivery', canonical: { key: 'client', value: CLIENT },
} };
const RECORD_API = {
  '/crm/record': RECORD,
  '/sales/stages': { data: { labels: { lead: 'New lead', qualified: 'Qualified', proposal: 'Proposal sent', contract: 'Agreement out', won: 'Won', lost: 'Not a fit' }, custom: {}, chances: {}, notes: { won: 'Send the welcome and the kickoff details.' }, notes_custom: {} } },   // item 124
  '/crm/activity': { data: { items: [], upcoming: [] } },
  '/crm/profile': { data: { profile: { business_name: 'Sam Rivera', edition: 'monitor', status: 'draft', live: false, last_published_at: null, members: 0, connected: 0, connected_needing_attention: 0, active_moments: 0, pending_approvals: 0, health: 'healthy' }, summary: 'Sam Rivera’s website is hosted elsewhere.', context: {} } },
  [`/sales/deals/${DEAL}`]: { data: { deal: { id: DEAL, title: 'Harbor Lane Bakery', stage: 'won', expected_value_cents: 320000, next_step: 'Sign Contract', next_step_at: '2026-08-06', converted_client_id: 'cl-1' }, proposals: [], contracts: [], invoices: [] } },
  [`/projects/${PROJECT}`]: { data: { project: { id: PROJECT, name: 'Harbor Lane Bakery', status: 'active' }, milestones: [], tasks: [], deliverables: [], progress: { pct: 70 } } },
  '/sales/contacts/ct-1': { data: { contact: { id: 'ct-1', name: 'Sam Rivera', email: 'sam@example.com', company: '' }, custom_fields: [], deals: [] } },
};

test.describe('the record after a win (items 49–52)', () => {
  test('no stale next step; the tip and tile read the project; the site is hosted elsewhere', async ({ page }) => {
    // final pass, batch D: one real upcoming row, so the band below is checked where it lives (#upband)
    await installApp(page, { api: { ...RECORD_API, '/crm/activity': { data: { items: [], upcoming: [{ kind: 'invoice', title: 'Deposit invoice', due: '2030-12-01', overdue: false }] } } } });
    await page.goto(`/crm.html?client=${CLIENT}`);
    const tile = page.locator('#hlpanel .hl').filter({ hasText: 'Next step' });
    await expect(tile).toContainText('Open their project to see what’s left');
    await expect(tile).not.toContainText('Sign Contract');
    await expect(page.locator('.stage-note .sn-fact')).toContainText('Their project is 70% along.');   // item 124: the fact rides above the studio's note
    await expect(page.locator('#dcard')).toContainText('Website: hosted elsewhere');
    await expect(page.locator('#dcard')).not.toContainText('not yet');
    // the record's Upcoming & overdue band shows what the server sends, never the won deal's old step
    // (the rule that drops it is buildUpcoming's, pinned in tests/presence/sales_batch11_test.mjs)
    await expect(page.locator('#upband')).toContainText('Deposit invoice');
    await expect(page.locator('#upband')).not.toContainText('Sign Contract');
  });

  test('"Add their business name" opens the editor on that box; the card\'s Edit opens it too', async ({ page }) => {
    await installApp(page, { api: RECORD_API });
    await page.goto(`/crm.html?client=${CLIENT}`);
    await page.locator('#dcard').getByRole('button', { name: 'Add their business name' }).click();
    await expect(page.getByLabel('Business name')).toBeFocused();
    await page.locator('#ec-cancel').click();
    await expect(page.getByLabel('Business name')).toHaveCount(0);
    await page.locator('#dcard').getByRole('button', { name: 'Edit' }).click();
    await expect(page.locator('#ec-name')).toBeFocused();
  });

  test('a customer whose business is known: no ask, the business in the card', async ({ page }) => {
    await installApp(page, { api: { ...RECORD_API, '/crm/record': { data: { ...RECORD.data, header: { ...RECORD.data.header, name: 'Harbor Lane Bakery', company: 'Harbor Lane Bakery', person: 'Sam Rivera' } } } } });
    await page.goto(`/crm.html?client=${CLIENT}`);
    await expect(page.locator('#dcard')).toContainText('Harbor Lane Bakery');
    await expect(page.locator('#dcard').getByRole('button', { name: 'Add their business name' })).toHaveCount(0);
  });
});

const HOME = {
  '/sales/summary': { data: { total: 0, open: { count: 0, value_cents: 0 }, won_month: { count: 0, value_cents: 0 }, win_rate: {}, by_stage: [], ar: {} } },
  '/sales/deals': { data: [] },
};
const P1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const step = (id: string, title: string, order: number, later: boolean) => ({ kind: 'project_task', id, parent_id: P1, title, due: null, context: 'Harbor Lane Bakery', href: `/projects.html?project=${P1}`, blocked: false, later, order });

test.describe('item 53 — My tasks shows each project\'s next step', () => {
  test('later steps wait for Show all; Done moves the next one up', async ({ page }) => {
    await installApp(page, { api: { ...HOME, '/sales/my-tasks': { data: { items: [step('t1', 'Domain connected', 1, false), step('t3', 'Site live', 3, true), step('t2', 'Handover', 2, true)], total: 3, partial: false } } } });
    await page.route(`**/functions/v1/presence/projects/${P1}/tasks/t1`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":{}}' }));
    await page.goto('/agency.html');
    const tab = page.locator('#qt-tasks');   // item 70: My tasks is a tab of Home's list, and the tab carries the count
    await expect(tab).toHaveText('My to-dos 1');
    await tab.click();
    const card = page.locator('#my-tasks');
    await expect(card.locator('.trow')).toHaveCount(1);
    await card.getByRole('button', { name: 'Done: Domain connected' }).click();
    await expect(card.locator('.trow')).toHaveText([/Handover/]);                       // the lowest place on the checklist, not the first in the list
    await card.getByRole('button', { name: 'Show all 2' }).click();
    await expect(card.locator('.trow')).toHaveCount(2);
    await expect(tab).toHaveText('My to-dos 2');
  });
});

test('item 54 — a one-word name gets its first letter in the Inbox badge', async ({ page }) => {
  const at = new Date().toISOString();
  await installApp(page, { api: { '/portal/feed': { data: { role: 'business_owner', moments: [], pending_approvals: [], client_messages: [], notices: [], enquiries: [
    { id: 'aaaaaaaa-2222-4222-8222-000000000001', name: 'Marco', email: 'marco@example.com', message: 'Hello', status: 'new', form_kind: 'contact', created_at: at },
    { id: 'aaaaaaaa-2222-4222-8222-000000000002', name: 'Marco', email: 'marco@example.com', message: 'Hello again', status: 'new', form_kind: 'contact', created_at: at },
  ] } } } });
  await page.goto('/inbox.html');
  const row = page.locator('#rows .row').filter({ hasText: 'Marco · 2 messages' });
  await expect(row.locator('.avatar')).toHaveText('M');
});

test('item 55 — a won deal on the Pipeline doesn\'t "close"', async ({ page }) => {
  await page.addInitScript(() => { try { if (!localStorage.getItem('dds-display:pipeline')) localStorage.setItem('dds-display:pipeline', 'list'); } catch { /* denied */ } });   // the List (the board is the default since Nov 2026)
  const at = new Date().toISOString();
  await installApp(page, { api: {
    '/sales/deals': { data: [
      { id: 'aaaaaaaa-3333-4333-8333-000000000001', title: 'Harbor Lane Bakery', stage: 'won', expected_value_cents: 320000, expected_close: '2026-09-07', updated_at: at },
      { id: 'aaaaaaaa-3333-4333-8333-000000000002', title: 'Willow Day Spa', stage: 'proposal', expected_value_cents: 90000, expected_close: '2026-12-01', updated_at: at },
    ] },
    '/sales/summary': { data: { total: 2, open: { count: 1, value_cents: 90000 }, won_month: { count: 0, value_cents: 0 }, win_rate: {}, by_stage: [], ar: {} } },
  } });
  await page.goto('/pipeline.html');
  await expect(page.locator('#list .card').filter({ hasText: 'Harbor Lane Bakery' })).not.toContainText('closes');
  await expect(page.locator('#list .card').filter({ hasText: 'Willow Day Spa' })).toContainText('closes');
});

test.describe('phones (items 57–59)', () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 600, 'phone layout only');

  test('the record\'s stage strip opens on the current stage', async ({ page }) => {
    await installApp(page, { api: RECORD_API });
    await page.goto(`/crm.html?client=${CLIENT}`);
    const cur = page.locator('.path .pstep.current');
    await expect(cur).toHaveText('Project');
    await expect.poll(async () => cur.evaluate((el) => { const p = el.closest('.path')!.getBoundingClientRect(), r = el.getBoundingClientRect(); return r.left >= p.left - 1 && r.right <= p.right + 1; })).toBe(true);
  });

  test('Pipeline: the numbers sit in one row and the stage chips in one line', async ({ page }) => {
    await installApp(page, { api: {
      '/sales/deals': { data: [{ id: 'aaaaaaaa-3333-4333-8333-000000000002', title: 'Willow Day Spa', stage: 'proposal', expected_value_cents: 90000, updated_at: new Date().toISOString() }] },
      '/sales/summary': { data: { total: 1, open: { count: 1, value_cents: 90000 }, won_month: { count: 1, value_cents: 195000 }, win_rate: { won: 5, closed: 5 }, by_stage: [], ar: {} } },
    } });
    await page.goto('/pipeline.html');
    const tops = await page.locator('.stats .st').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(tops.length).toBeGreaterThan(1);
    expect(new Set(tops).size).toBe(1);
    const chipTops = await page.locator('#filters .chip').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(chipTops).size).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);   // the row scrolls, not the page
  });

  test('Customers: the view name stays on one line', async ({ page }) => {
    await installApp(page, { api: { '/studio/customers': { data: [] } } });
    await page.goto('/customers.html');
    const h = await page.locator('#viewBtn .vl').evaluate((el) => el.getBoundingClientRect().height);
    expect(h).toBeLessThan(30);
  });
});
