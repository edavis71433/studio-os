import { test, expect } from '@playwright/test';
import { installApp } from './helpers/app';

// Sales extras, batch 3 (item 69, Nov 2026): the private "log this email" address
// on Connections, and "did they open it?" — "Opened by N of M" under a sent update,
// and "They opened your proposal", with its time, on the deal. Hermetic; names and
// addresses are made up.

// ── the log address (Connections) ────────────────────────────────────────────
const SURFACE = { data: { edition: 'presence', note: '', groups: { 'Being found': [{
  key: 'google_search_console', label: 'how you show up in Google Search', purpose: '', reads: [], approval: '', availability: 'Read-only',
  connection: { status: 'disconnected', health: 'unknown', last_sync_at: null, connected_at: null, reason: '' }, data: null,
}] } } };
const ADDR1 = 'log-' + 'a1'.repeat(12) + '@reply.example.com';
const ADDR2 = 'log-' + 'b2'.repeat(12) + '@reply.example.com';

async function withLog(page, first: Record<string, unknown>) {
  const calls: string[] = [];
  let state = first, n = 0;
  await page.route('**/functions/v1/presence/email/log-address', async (route) => {
    const m = route.request().method(); calls.push(m);
    if (m === 'POST') state = { on: true, address: n++ ? ADDR2 : ADDR1, created_at: '2026-11-08T12:00:00Z', can_manage: true, available: true };
    if (m === 'DELETE') state = { on: false, address: null, created_at: null, can_manage: true, available: true };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: state }) });
  });
  return calls;
}

test.describe('Connections — log emails you send (item 69)', () => {
  test('make the address, read the steps, make a new one, turn it off', async ({ page }) => {
    await installApp(page, { api: { '/connections': SURFACE } });
    const calls = await withLog(page, { on: false, address: null, created_at: null, can_manage: true, available: true });
    await page.goto('/connections.html');
    const card = page.locator('#logSec');
    await expect(card).toContainText('Log emails you send');
    await expect(card).toContainText('add a private address in Bcc');
    await card.getByRole('button', { name: 'Make my log address' }).click();
    await expect(card.getByLabel('Your private log address')).toHaveValue(ADDR1);
    await expect(card).toContainText('your client won’t see it');
    await expect(card).toContainText('Only email sent from your studio’s own addresses is logged');
    await card.getByRole('button', { name: 'Make a new address' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Make a new address' }).click();
    await expect(card.getByLabel('Your private log address')).toHaveValue(ADDR2);
    await card.getByRole('button', { name: 'Turn it off' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Turn it off' }).click();
    await expect(card.getByRole('button', { name: 'Make my log address' })).toBeVisible();
    expect(calls).toEqual(['GET', 'POST', 'POST', 'DELETE']);
  });

  test('Cancel on "Make a new address" changes nothing', async ({ page }) => {
    await installApp(page, { api: { '/connections': SURFACE } });
    const calls = await withLog(page, { on: true, address: ADDR1, created_at: '2026-11-08T12:00:00Z', can_manage: true, available: true });
    await page.goto('/connections.html');
    await page.locator('#logSec').getByRole('button', { name: 'Make a new address' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('#logSec').getByLabel('Your private log address')).toHaveValue(ADDR1);
    expect(calls).toEqual(['GET']);
  });

  test('a seat that can\'t manage it sees whether it is on, and no address', async ({ page }) => {
    await installApp(page, { api: { '/connections': SURFACE } });
    await withLog(page, { on: true, address: null, created_at: null, can_manage: false, available: true });
    await page.goto('/connections.html');
    const card = page.locator('#logSec');
    await expect(card).toContainText('Your studio’s log address is on.');
    await expect(card.getByRole('button')).toHaveCount(0);
  });

  test('without email replies set up, it says so and offers nothing', async ({ page }) => {
    await installApp(page, { api: { '/connections': SURFACE } });
    await withLog(page, { on: false, address: null, created_at: null, can_manage: true, available: false });
    await page.goto('/connections.html');
    const card = page.locator('#logSec');
    await expect(card).toContainText('Email replies aren’t set up on this account yet');
    await expect(card.getByRole('button')).toHaveCount(0);
  });
});

// ── "Opened by N of M" under a sent update ───────────────────────────────────
const T_ID = 'cccccccc-3333-4333-8333-cccccccccccc';
const ROW_SENT = { id: T_ID, subject: 'June recap', audience: 'contacts', status: 'sent', scheduled_at: null, sent_at: '2026-06-30T10:00:00Z', recipient_count: 46, sent_count: 42, skipped_count: 3, failed_count: 0, created_at: '2026-06-30T09:00:00Z' };
const SEGS = { data: { segments: [{ key: 'contacts', label: 'All contacts', description: 'Everyone saved in your contacts.', count: 12 }] } };
const sentDetail = (engagement: unknown) => ({ data: {
  broadcast: { ...ROW_SENT, site_id: 'site-1', body: 'June was busy.', updated_at: '2026-06-30T10:00:00Z', created_by: 'owner@example.com' },
  audience_label: 'All contacts', recipient_count: 46, suppressed_count: 3,
  preview_subject: 'June recap', preview_html: '<html><body><p>June was busy.</p></body></html>', engagement,
} });
const updatesApi = (engagement: unknown) => ({
  '/broadcasts': { data: { broadcasts: [ROW_SENT] } },
  '/broadcasts/segments': SEGS,
  ['/broadcasts/' + T_ID]: sentDetail(engagement),
});
async function openSent(page) {
  await page.goto('/broadcasts.html');
  const row = page.locator('.bc').filter({ hasText: 'June recap' });
  await row.getByRole('button', { name: /June recap/ }).click();
  const detail = row.locator('.bcdetail');
  await expect(detail).toContainText('42 sent');
  return detail;
}

test.describe('Updates — who opened it (item 69)', () => {
  test('a sent update says how many opened it, and who', async ({ page }) => {
    await installApp(page, { api: updatesApi({ sent: 42, opened: 3, opened_by: ['kai@example.org', 'riley@example.org'] }) });
    const detail = await openSent(page);
    await expect(detail.locator('[data-opens]')).toHaveText('Opened by 3 of 42: kai@example.org, riley@example.org and 1 more');
    await expect(detail).toContainText('A rough count: some email apps open every message by themselves');
  });

  test('nothing opened yet, or an update from before the counter: no line at all', async ({ page }) => {
    await installApp(page, { api: updatesApi({ sent: 42, opened: 0, opened_by: [] }) });
    let detail = await openSent(page);
    await expect(detail.locator('[data-opens]')).toHaveCount(0);
    await expect(detail).not.toContainText('A rough count');
    await installApp(page, { api: updatesApi(null) });
    detail = await openSent(page);
    await expect(detail.locator('[data-opens]')).toHaveCount(0);
  });

  test('an address in the list is shown as text, never as markup', async ({ page }) => {
    await installApp(page, { api: updatesApi({ sent: 2, opened: 1, opened_by: ['<b>x</b>@example.org'] }) });
    const detail = await openSent(page);
    await expect(detail.locator('[data-opens]')).toHaveText('Opened by 1 of 2: <b>x</b>@example.org');
    await expect(detail.locator('[data-opens] b')).toHaveCount(1);   // only the "Opened by" label is bold
  });
});

// ── "They opened your proposal", with its time, on the deal ──────────────────
const DEAL = '11111111-1111-4111-8111-111111111111';
const past = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
const OPENED_AT = new Date(Date.now() - 2 * 86400000).toISOString();
const DEAL_API = {
  '/sales/deals': { data: [{ id: DEAL, title: 'Acme website', stage: 'proposal', source: 'manual', expected_value_cents: 500000, expected_close: null, contact_id: 'ct-1', converted_client_id: null, updated_at: past(1), next_step: null, next_step_at: null, last_contacted_at: null, agreement_signed: false }] },
  [`/sales/deals/${DEAL}`]: { data: {
    deal: { id: DEAL, title: 'Acme website', stage: 'proposal', expected_value_cents: 500000, expected_close: null, next_step: null, next_step_at: null, notes: '', contact_id: 'ct-1', converted_client_id: null, retainer: null },
    contact: { id: 'ct-1', name: 'Sam Rivera', email: 'sam@example.com', phone: '', company: 'Acme', notes: '' },
    proposals: [], contracts: [], events: [], invoices: [], last_contacted_at: null,
    timeline: [
      { id: 'evt:2', at: OPENED_AT, logged_at: OPENED_AT, source: 'system', kind: 'doc_opened', icon: '', who: 'client-link', text: 'They opened your proposal', backdated: false },
      { id: 'evt:1', at: past(3), logged_at: past(3), source: 'system', kind: 'proposal_sent', icon: '', who: 'owner@example.com', text: 'Proposal sent', backdated: false },
    ],
  } },
  [`/sales/deals/${DEAL}/tasks`]: { data: [] },
  '/sales/summary': { data: { total: 1, open: { count: 1, value_cents: 500000 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 }, by_stage: [] } },
  '/sales/contacts': { data: [{ id: 'ct-1', name: 'Sam Rivera', email: 'sam@example.com', phone: '', company: 'Acme', updated_at: past(1) }] },
  '/sales/templates': { data: [] },
  '/sales/services': { data: [] },
  '/sales/receivables': { data: { items: [], total_cents: 0 } },
  '/identity': { data: { business_name: 'Test Studio' } },
};

test.describe('Deals — "They opened your proposal" (item 69)', () => {
  test('the open shows on the deal with its time of day; other lines keep just the date', async ({ page }) => {
    await installApp(page, { api: DEAL_API });
    await page.goto(`/pipeline.html?deal=${DEAL}`);
    const opened = page.locator('.tl-i').filter({ hasText: 'They opened your proposal' }).first();
    await expect(opened).toBeVisible();
    const when = await page.evaluate((iso) => {
      const t = new Date(iso); const o: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
      if (t.getFullYear() !== new Date().getFullYear()) o.year = 'numeric';
      return t.toLocaleDateString('en-US', o) + ', ' + t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }, OPENED_AT);
    await expect(opened.locator('.tl-mt')).toHaveText(when);
    await expect(page.locator('.tl-i').filter({ hasText: 'Proposal sent' }).first().locator('.tl-mt')).not.toContainText(':');
  });
});
