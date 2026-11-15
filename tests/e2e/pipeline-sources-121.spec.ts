import { test, expect } from '@playwright/test';
import { installApp } from './helpers/app';

// Sales item 121: where a deal came from reads as words, never a code ("website_form",
// "prospecting", "free_tools"), and "From your website" on the board counts the deals the
// Inbox made. Hermetic; every name is made up.

const now = new Date().toISOString();
const deal = (id: string, title: string, source: string, extra: Record<string, unknown> = {}) => ({ id, title, stage: 'lead', source, expected_value_cents: 100000, expected_close: null, contact_id: null, converted_client_id: null, updated_at: now, created_at: now, next_step: null, next_step_at: null, ...extra });
const DEALS = [
  deal('11111111-1111-4111-8111-111111111111', 'Maple Bakery', 'website_form'),
  deal('22222222-2222-4222-8222-222222222222', 'Fresh Fades', 'prospecting'),
  deal('33333333-3333-4333-8333-333333333333', 'Harbor Dental', 'free_tools', { expected_close: '2030-01-15' }),
  deal('44444444-4444-4444-8444-444444444444', 'Odd One', 'some_future_code'),
];
const API = {
  '/sales/deals': { data: DEALS },
  '/sales/summary': { data: { total: 4, open: { count: 4, value_cents: 400000 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 }, by_stage: [], ar: {} } },
  '/sales/contacts': { data: [] }, '/sales/templates': { data: [] }, '/sales/services': { data: [] }, '/sales/receivables': { data: { items: [], total_cents: 0 } },
  '/identity': { data: { business_name: 'Test Studio' } },
};

test.describe('item 121 — deal sources in words', () => {
  test('the list says where each deal came from, and a code it doesn’t know says nothing', async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('dds-display:pipeline', 'list'); } catch { /* denied */ } });
    await installApp(page, { api: API });
    await page.goto('/pipeline.html');
    const card = (t: string) => page.locator('#list .card').filter({ hasText: t }).locator('.m');
    await expect(card('Maple Bakery')).toHaveText('From your website');
    await expect(card('Fresh Fades')).toHaveText('From Prospects');
    await expect(card('Harbor Dental')).toHaveText(/^From a free tool · closes /);
    await expect(card('Odd One')).toHaveText('');
    await expect(page.locator('#list')).not.toContainText(/website_form|prospecting|free_tools|some_future_code/);
  });

  test('the board’s “From your website” counts the deals the Inbox made', async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('dds-display:pipeline', 'board'); } catch { /* denied */ } });
    await installApp(page, { api: API });
    await page.goto('/pipeline.html');
    await expect(page.locator('[data-bchip="web"] .n')).toHaveText('1');
  });
});

// Eric's pick (Nov 12): people who ran the free Site Review or AI Visibility check stay on
// Prospects, and the Inbox's Enquiries view says so. GET /sales/tool-leads answers staff only.
const INBOX = {
  '/portal/feed': { data: { role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null, enquiries: [], client_messages: [] } },
  '/forms/inbox': { data: { submissions: [], unread: 0 } },
  '/notifications': { data: [], unread_count: 0 },
};
const toolLead = (id: string, status: string) => ({ id, created_at: now, tool: 'site_review', business_name: 'Made-up Business ' + id.slice(0, 2), client_email: `lead-${id.slice(0, 2)}@example.com`, url: 'https://example.com', city: '', business_type: '', score: 40, status, notes: '', contact_id: null, deal_id: null });

test.describe('item 121 — free-tool leads stay on Prospects; Enquiries says so', () => {
  test('Enquiries says how many are new on Prospects, with a link', async ({ page }) => {
    await installApp(page, { api: { ...INBOX, '/sales/tool-leads': { data: [toolLead('a1aaaaaa-0000-4000-8000-000000000001', 'new'), toolLead('a2aaaaaa-0000-4000-8000-000000000002', 'new'), toolLead('a3aaaaaa-0000-4000-8000-000000000003', 'contacted')] } } });
    await page.goto('/inbox.html#enquiries');
    const note = page.locator('#enqTool');
    await expect(note).toHaveText('2 people who ran your free Site Review or AI Visibility check are waiting on Prospects. Open Prospects →');
    await expect(note.getByRole('link', { name: 'Open Prospects →' })).toHaveAttribute('href', '/prospects.html');
  });

  test('with none new it still says where they go', async ({ page }) => {
    await installApp(page, { api: { ...INBOX, '/sales/tool-leads': { data: [toolLead('a3aaaaaa-0000-4000-8000-000000000003', 'contacted')] } } });
    await page.goto('/inbox.html#enquiries');
    await expect(page.locator('#enqTool')).toHaveText('People who run your free Site Review or AI Visibility check show up on Prospects, not here. Open Prospects →');
  });

  test('anyone the read refuses sees no line', async ({ page }) => {
    await installApp(page, { api: INBOX });
    await page.route('**/functions/v1/presence/sales/tool-leads', (route) => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'forbidden', message: 'Staff only.' }) }));
    await page.goto('/inbox.html#enquiries');
    await expect(page.locator('#efilt')).toBeVisible();
    await expect(page.locator('#enqTool')).toBeHidden();
  });
});
