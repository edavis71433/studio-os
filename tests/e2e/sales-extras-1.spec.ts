import { test, expect } from '@playwright/test';
import { installApp } from './helpers/app';

// Sales extras, batch 1 (item 69, Nov 2026): the chance each stage closes, with
// Pipeline's Expected total, and the sending-domain line on Settings' Domain &
// email card. Hermetic; names and addresses are made up.

const SETTINGS_API = {
  '/identity': { data: { business_name: 'Example Studio', email: 'hello@example.com' } },
  '/settings': { data: { industry_key: 'generic' } },
  '/connections': { data: { groups: {} } },
  '/commerce/subscription': { data: { plan: 'studio', plan_name: 'Studio', status: 'active', can_manage_billing: true, current_period_end: '2026-12-03T00:00:00Z', in_grace: false, has_service_billing: false } },
  '/sales/stages': { data: { labels: { lead: 'Enquiry', qualified: 'Qualified', proposal: 'Proposal sent', contract: 'Agreement out', won: 'Won', lost: 'Not a fit' }, custom: { lead: 'Enquiry' }, defaults: {}, chances: { lead: 10, qualified: 30, proposal: 50, contract: 75, won: 100, lost: 0 }, chance_defaults: { lead: 10, qualified: 25, proposal: 50, contract: 75, won: 100, lost: 0 } } },
  '/email/sending': { data: { from: 'hello@example.com', domain: 'example.com', sending: 'verified', replies: 'inbox', reply_domain: 'reply.example.com', receiving: 'verified' } },
};

test.describe('Settings — the chance each stage closes (item 69)', () => {
  test('the four percents show the saved values under the studio\'s names, and Save sends only the percents', async ({ page }) => {
    let sent: unknown = null;
    await installApp(page, { api: SETTINGS_API });
    await page.route('**/functions/v1/presence/sales/stages', (route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      sent = route.request().postDataJSON();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ...SETTINGS_API['/sales/stages'].data, chances: { lead: 10, qualified: 30, proposal: 60, contract: 75, won: 100, lost: 0 } } }) });
    });
    await page.goto('/settings.html#automations');
    const box = page.locator('#stageChances');
    await expect(box).toBeVisible();
    await expect(box.locator('input')).toHaveCount(4);
    await expect(box.locator('[data-stage-label="lead"]')).toHaveText('Enquiry');            // the studio's own stage name
    await expect(page.getByLabel('Chance a deal at Qualified closes, in percent')).toHaveValue('30');
    await expect(page.locator('#stageNames input')).toHaveCount(4);                          // the names card is unchanged
    await page.getByLabel('Chance a deal at Proposal sent closes, in percent').fill('60');
    await page.getByRole('button', { name: 'Save percents' }).click();
    await expect.poll(() => sent).toEqual({ chances: { lead: 10, qualified: 30, proposal: 60, contract: 75 } });
    await expect(page.locator('#scMsg')).toContainText('Pipeline’s Expected total uses these.');
  });

  test('a percent outside 0–100 is caught on the page, nothing is sent', async ({ page }) => {
    let puts = 0;
    await installApp(page, { api: SETTINGS_API });
    await page.route('**/functions/v1/presence/sales/stages', (route) => { if (route.request().method() === 'PUT') puts++; return route.fallback(); });
    await page.goto('/settings.html#automations');
    await page.getByLabel('Chance a deal at New lead closes, in percent').fill('120');
    await page.getByRole('button', { name: 'Save percents' }).click();
    await expect(page.getByText('Each chance is a percent from 0 to 100.')).toBeVisible();
    expect(puts).toBe(0);
  });

  test('the Domain & email card says where your emails go out from, and that it is verified', async ({ page }) => {
    await installApp(page, { api: SETTINGS_API });
    await page.goto('/settings.html');
    await expect(page.locator('[data-card="domains"] .st')).toHaveText('Emails go out from hello@example.com · verified');
  });

  test('…and warns when it isn\'t verified', async ({ page }) => {
    await installApp(page, { api: { ...SETTINGS_API, '/email/sending': { data: { from: 'hello@example.com', domain: 'example.com', sending: 'not_verified', replies: 'mailbox', reply_domain: null, receiving: null } } } });
    await page.goto('/settings.html');
    await expect(page.locator('[data-card="domains"] .st.warn')).toHaveText('Emails go out from hello@example.com · not verified, so they may land in spam');
  });
});

const past = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
const PIPE_API = {
  '/sales/deals': { data: [
    { id: '11111111-1111-4111-8111-111111111111', title: 'Website rebuild', stage: 'proposal', source: 'manual', expected_value_cents: 300000, contact_id: null, converted_client_id: null, updated_at: past(1) },
    { id: '22222222-2222-4222-8222-222222222222', title: 'Logo refresh', stage: 'lead', source: 'manual', expected_value_cents: 100000, contact_id: null, converted_client_id: null, updated_at: past(2) },
  ] },
  '/sales/summary': { data: { total: 2, open: { count: 2, value_cents: 400000 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 },
    by_stage: [{ stage: 'lead', label: 'New lead', count: 1, value_cents: 100000, chance: 10, expected_cents: 10000 }, { stage: 'proposal', label: 'Proposal sent', count: 1, value_cents: 300000, chance: 50, expected_cents: 150000 }],
    ar: {}, expected: { value_cents: 160000 } } },
  '/sales/contacts': { data: [] }, '/sales/templates': { data: [] }, '/sales/services': { data: [] },
  '/sales/receivables': { data: { items: [], total_cents: 0 } }, '/identity': { data: { business_name: 'Example Studio' } },
};

test.describe('Pipeline — the Expected total (item 69)', () => {
  test('Expected is its own tile on a computer or tablet, and rides under Open on a phone', async ({ page }, testInfo) => {
    await installApp(page, { api: PIPE_API });
    await page.goto('/pipeline.html');
    const stats = page.locator('#summary .stats');
    await expect(stats).toBeVisible();
    if (testInfo.project.name === 'mobile') {
      await expect(stats.locator('.st-exp')).toBeHidden();
      await expect(stats.locator('.st').first().locator('.exp-sub')).toHaveText(' · $1,600 expected');
      await expect(stats.locator('.st:visible')).toHaveCount(3);   // Open · Won this month · Win rate (no Outstanding in this world)
    } else {
      const ex = stats.locator('.st-exp');
      await expect(ex).toBeVisible();
      await expect(ex.locator('.k')).toHaveText('Expected');
      await expect(ex.locator('.v')).toHaveText('$1,600');
      await expect(stats.locator('.exp-sub')).toBeHidden();
    }
    await expect(page.locator('#summary .sum-stages')).toContainText('Proposal sent · 50%');
  });

  test('no Expected tile when the server sends none (an older server, or nothing open)', async ({ page }) => {
    const { expected: _e, ...rest } = PIPE_API['/sales/summary'].data;
    await installApp(page, { api: { ...PIPE_API, '/sales/summary': { data: rest } } });
    await page.goto('/pipeline.html');
    await expect(page.locator('#summary .stats')).toBeVisible();
    await expect(page.locator('#summary .st-exp')).toHaveCount(0);
  });
});
