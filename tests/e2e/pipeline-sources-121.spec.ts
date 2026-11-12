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
