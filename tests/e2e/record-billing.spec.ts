import { test, expect, type Page } from '@playwright/test';
import { installApp } from './helpers/app';

// Sales items 107 and 108 (the Nov 10 bug hunt's J findings): the record's Billing tab
// tells the truth and shows all the money.
//   J1  a void whose payment link may still be live says so
//   J2  "+ Invoice" left blank bills what's left of the accepted proposal, never re-sends an old one
//   J3  a declined or expired proposal reads as declined or expired, with the right next step
//   J5  sending an agreement that adds a deposit request says so
//   J4  retainer payments count in Paid and are named on the record
//   J6  estimates and the recurring invoice are on the record, with their actions
// Every name below is made up.

const CLIENT = 'cccccccc-3333-4333-8333-cccccccccccc';
const DEAL = 'dddddddd-4444-4444-8444-dddddddddddd';
const CID = 'ffffffff-6666-4666-8666-ffffffffffff';
const INV_OPEN = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const INV_PAID = 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa';
const PROP = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb';
const CON = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const EST = 'bbbbbbbb-3333-4333-8333-bbbbbbbbbbbb';
const REC = 'bbbbbbbb-4444-4444-8444-bbbbbbbbbbbb';

const HEADER = { name: 'Juniper Floral Co.', person: 'Ivy Chen', company: 'Juniper Floral Co.', email: 'ivy@juniper.example', phone: '', status: 'customer' };
const record = () => ({ data: {
  identity: { contact_id: CID, deal_id: DEAL, client_id: 'cl-1', customer_site_id: CLIENT, project_id: null },
  header: HEADER, highlights: {},
  sections: { overview: true, messages: true, deal: true, delivery: false, details: true },
  default_tab: 'deal', canonical: { key: 'client', value: CLIENT },
} });
const DEAL_ROW = { id: DEAL, title: 'Website refresh', stage: 'proposal', expected_value_cents: 500000, contact_id: CID, converted_client_id: null, next_step: null, next_step_at: null, expected_close: null, source: 'manual', retainer: null };
const dealRead = (over: Record<string, unknown> = {}) => ({ data: {
  deal: DEAL_ROW, contact: { id: CID, name: 'Ivy Chen', email: 'ivy@juniper.example' },
  proposals: [], contracts: [], events: [], timeline: [], invoices: [], estimates: [], recurring: [], last_contacted_at: null, retainer_paid: { cents: 0, count: 0, last_at: null }, ...over,
} });
const API = (deal: Record<string, unknown> = {}) => ({
  '/crm/record': record(),
  [`/sales/deals/${DEAL}`]: dealRead(deal),
  '/crm/activity': { data: { items: [], upcoming: [], reply_to: null, reply_support_to: null } },
  '/sales/stages': { data: { chances: { lead: 10, qualified: 25, proposal: 50, contract: 75 } } },
  [`/sales/contacts/${CID}`]: { data: { contact: { id: CID, name: 'Ivy Chen', company: 'Juniper Floral Co.', email: 'ivy@juniper.example', phone: '' }, custom_fields: [], deals: [] } },
});
const ACCEPTED = { id: PROP, title: 'Website refresh', status: 'accepted', version: 1, total_cents: 500000, subtotal_cents: 500000, line_items: [], decided_at: '2026-10-20T17:00:00Z', expires_at: '2099-01-01T00:00:00Z' };
const PAID_DEPOSIT = { id: INV_PAID, title: 'Deposit', amount_cents: 200000, purpose: 'deposit', status: 'paid', stripe_url: 'https://pay.example/d', due_date: null, paid_at: '2026-10-28T18:00:00Z', created_at: '2026-10-21T12:00:00Z' };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const toastWith = (page: Page, text: string) => page.locator('.dds-toast').filter({ hasText: text });
const tile = (page: Page, k: string) => page.locator('#hlpanel .hl').filter({ has: page.locator('.hl-k', { hasText: new RegExp('^' + k + '$') }) });
const billing = (page: Page) => page.locator('#tabbody');
const noSideScroll = (page: Page) => page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth + 1);

test.describe('item 107 — Billing tells the truth', () => {
  test('J1: a void whose payment link may still be live says so, in the warning style', async ({ page }) => {
    const open = { id: INV_OPEN, title: 'Logo add-on', amount_cents: 30000, purpose: 'service', status: 'open', stripe_url: 'https://pay.example/o', due_date: '2099-12-01', created_at: '2026-11-01T12:00:00Z' };
    await installApp(page, { api: API({ invoices: [open] }) });
    await page.route(`**/functions/v1/presence/sales/invoices/${INV_OPEN}/void`, (route) => route.fulfill(json({ data: { ok: true, id: INV_OPEN, status: 'void', link_deactivated: false } })));
    page.on('dialog', (d) => d.accept());
    await page.goto(`/crm.html?client=${CLIENT}&tab=billing`);
    await billing(page).getByRole('button', { name: 'Void' }).click();
    const t = toastWith(page, 'may still be live');
    await expect(t).toBeVisible();
    await expect(t).toHaveClass(/err/);
  });

  test('J2: "+ Invoice" says what blank bills, and an open one already sent is re-sent only on purpose', async ({ page }) => {
    const balance = { id: INV_OPEN, title: 'Balance', amount_cents: 300000, purpose: 'service', status: 'open', stripe_url: 'https://pay.example/b', due_date: '2099-12-01', created_at: '2026-11-01T12:00:00Z' };
    await installApp(page, { api: API({ proposals: [ACCEPTED], invoices: [PAID_DEPOSIT] }) });
    const posted: unknown[] = []; const resent: string[] = [];
    await page.route(`**/functions/v1/presence/sales/deals/${DEAL}/invoice`, (route) => {
      posted.push(route.request().postDataJSON());
      return route.fulfill(json({ error: 'already_open', open_invoice: balance, amount_cents: 300000, message: 'There\'s already an open invoice for $3,000.00 on this deal, and it was sent. Resend that one, or send another.' }, 409));
    });
    await page.route(`**/functions/v1/presence/sales/invoices/${INV_OPEN}/send`, (route) => { resent.push(route.request().method()); return route.fulfill(json({ data: { ...balance }, url: balance.stripe_url, emailed: true, resent: true, double_tap: false })); });
    await page.goto(`/crm.html?client=${CLIENT}&tab=billing`);
    await billing(page).getByRole('button', { name: '+ Invoice' }).click();
    await expect(page.locator('#bf-hint')).toHaveText('Leave the amount blank to bill what’s left of the accepted proposal: $3,000 of $5,000.');
    await page.locator('#bf-go').click();
    await expect.poll(() => posted.length).toBe(1);
    expect((posted[0] as Record<string, unknown>).amount_cents).toBeUndefined();   // blank: the server works out what's left
    await expect(page.locator('#bform')).toContainText('already an open invoice for $3,000.00');
    await expect(page.locator('#bf-force')).toHaveText('Send another');
    await page.locator('#bf-resend').click();
    await expect.poll(() => resent.length).toBe(1);   // its own send route: never a new invoice
    expect(posted.length).toBe(1);
    await expect(toastWith(page, 'Invoice re-sent — emailed to the client')).toBeVisible();
  });

  test('J2: a proposal billed in full says so before anything is sent', async ({ page }) => {
    await installApp(page, { api: API({ proposals: [ACCEPTED], invoices: [{ ...PAID_DEPOSIT, amount_cents: 500000 }] }) });
    await page.goto(`/crm.html?client=${CLIENT}&tab=billing`);
    await billing(page).getByRole('button', { name: '+ Invoice' }).click();
    await expect(page.locator('#bf-hint')).toHaveText('The accepted proposal ($5,000) is billed in full. Enter an amount to bill something else.');
  });

  test('J3: a declined proposal is not "with them" — the path, Deal and Billing say declined', async ({ page }) => {
    const declined = { ...ACCEPTED, status: 'declined', decided_at: '2026-11-06T18:00:00Z' };
    await installApp(page, { api: API({ proposals: [declined] }) });
    await page.goto(`/crm.html?client=${CLIENT}&tab=billing`);
    await expect(page.locator('#pathwrap')).toContainText('They declined your proposal.');
    await expect(page.locator('#pathwrap')).not.toContainText('a gentle nudge');
    await expect(page.locator('#pathwrap').getByRole('link', { name: 'Revise the proposal →' })).toBeVisible();
    await expect(page.locator('#pathwrap').getByRole('button', { name: /Move to/ })).toHaveCount(0);
    const row = billing(page).locator('.rrow').filter({ hasText: 'Website refresh' });
    await expect(row.locator('.schip')).toHaveText('Declined');
    await expect(row).toContainText('They declined on Nov 6');
    await expect(row.getByRole('link', { name: 'Revise in pipeline' })).toBeVisible();
    await page.getByRole('tab', { name: 'Deal' }).click();
    await expect(billing(page)).toContainText('They declined your proposal on Nov 6.');
    await expect(billing(page)).not.toContainText('Your proposal is with them');
  });

  test('J3: an expired proposal shows Expired and offers no Copy link', async ({ page }) => {
    const expired = { ...ACCEPTED, status: 'sent', decided_at: null, sent_at: '2026-09-01T12:00:00Z', expires_at: '2026-10-01T12:00:00Z' };
    await installApp(page, { api: API({ proposals: [expired] }) });
    await page.goto(`/crm.html?client=${CLIENT}&tab=billing`);
    const row = billing(page).locator('.rrow').filter({ hasText: 'Website refresh' });
    await expect(row.locator('.schip')).toHaveText('Expired');
    await expect(row.getByRole('button', { name: 'Copy link' })).toHaveCount(0);
    await expect(row).toContainText('so the link no longer opens');
    await expect(page.locator('#pathwrap')).toContainText('Your proposal expired before they answered.');
  });

  test('J5: sending the agreement says when it added the deposit request', async ({ page }) => {
    const draft = { id: CON, title: 'Service agreement', status: 'draft', body: 'Deposit of 50% on signing.', version: 1 };
    await installApp(page, { api: API({ contracts: [draft] }) });
    await page.route(`**/functions/v1/presence/sales/contracts/${CON}/send`, (route) => route.fulfill(json({ data: { ...draft, status: 'sent' }, url: 'https://app.example/sign', emailed: true, deposit: { minted: true, amount_cents: 250000, invoice_id: INV_OPEN } })));
    await page.goto(`/crm.html?client=${CLIENT}&tab=billing`);
    await billing(page).getByRole('button', { name: 'Send for signature' }).click();
    await expect(toastWith(page, 'A $2,500 deposit request is ready')).toBeVisible();
  });
});

test.describe('item 108 — the record shows all the money', () => {
  test('J4: retainer payments count in Paid and are named on Billing', async ({ page }) => {
    const deal = { ...DEAL_ROW, stage: 'won', retainer: { status: 'active', amount_cents: 50000, interval: 'month' } };
    await installApp(page, { api: API({ deal, invoices: [PAID_DEPOSIT], retainer_paid: { cents: 150000, count: 3, last_at: '2026-11-01T17:00:00Z' } }) });
    await page.goto(`/crm.html?client=${CLIENT}&tab=billing`);
    await expect(tile(page, 'Paid').locator('.hl-v')).toHaveText('$3,500');
    await expect(tile(page, 'Paid')).toContainText('Incl. $1,500 retainer');
    await expect(billing(page)).toContainText('Paid so far: $1,500 · 3 payments, the last on Nov 1');
    const money = page.locator('section.sc').filter({ has: page.locator('#sc-money') });
    await expect(money).toContainText('Retainer · 3 payments');
    await page.getByRole('tab', { name: 'Deal' }).click();
    await expect(billing(page)).toContainText('All $3,500 paid so far, $1,500 of it from the retainer.');
  });

  test('J6: an approved estimate can become a proposal or be billed from the record', async ({ page }) => {
    const est = { id: EST, deal_id: DEAL, title: 'Website refresh estimate', status: 'approved', line_items: [], subtotal_cents: 320000, total_cents: 320000, decided_at: '2026-10-20T17:00:00Z', expires_at: '2026-11-19T17:00:00Z', proposal_id: null, invoice_id: null };
    await installApp(page, { api: API({ estimates: [est] }) });
    const asked: string[] = [];
    await page.route(`**/functions/v1/presence/sales/estimates/${EST}/**`, (route) => { asked.push(new URL(route.request().url()).pathname.split('/').pop() || ''); return route.fulfill(json({ data: { ok: true } }, 201)); });
    await page.goto(`/crm.html?client=${CLIENT}&tab=billing`);
    const row = page.locator('#bEstimates .rrow').filter({ hasText: 'Website refresh estimate' });
    await expect(row.locator('.schip')).toHaveText('Approved');
    await expect(row).toContainText('$3,200 · Approved Oct 20');
    await row.getByRole('button', { name: 'Bill it' }).click();
    await expect.poll(() => asked).toEqual(['invoice']);
    await expect(toastWith(page, 'Invoice ready under Invoices')).toBeVisible();
    await page.getByRole('tab', { name: 'Deal' }).click();
    await expect(billing(page)).toContainText('Website refresh estimate · approved');
    await page.getByRole('tab', { name: 'Files' }).click();
    await expect(billing(page)).toContainText('Website refresh estimate · estimate');
  });

  test('J6: the recurring invoice is on the record — Skip asks first, then skips', async ({ page }) => {
    const rec = { id: REC, deal_id: DEAL, title: 'Website care', amount_cents: 15000, every: 'month', next_on: '2099-12-01', times: null, sent_count: 2, status: 'active', paused_reason: null };
    await installApp(page, { api: API({ recurring: [rec] }) });
    const asked: string[] = [];
    await page.route(`**/functions/v1/presence/sales/recurring/${REC}/skip`, (route) => { asked.push('skip'); return route.fulfill(json({ data: { next_on: '2100-01-01' } })); });
    let confirmText = '';
    page.on('dialog', (d) => { confirmText = d.message(); d.accept(); });
    await page.goto(`/crm.html?client=${CLIENT}&tab=billing`);
    const row = page.locator('#bRecurring .rrow');
    await expect(row).toContainText('Website care · $150 every month');
    await expect(row).toContainText('2 sent');
    await row.getByRole('button', { name: 'Skip this one' }).click();
    await expect.poll(() => asked.length).toBe(1);
    expect(confirmText).toContain('Skip the Dec 1 invoice?');
    await expect(toastWith(page, 'Skipped — the next one goes out Jan 1')).toBeVisible();
  });

  test('the Billing tab fits the screen with every new section open', async ({ page }) => {
    const est = { id: EST, deal_id: DEAL, title: 'Website refresh estimate', status: 'sent', line_items: [], subtotal_cents: 320000, total_cents: 320000, expires_at: '2099-01-01T00:00:00Z', proposal_id: null, invoice_id: null };
    const rec = { id: REC, deal_id: DEAL, title: 'Website care', amount_cents: 15000, every: 'month', next_on: '2099-12-01', sent_count: 0, status: 'paused', paused_reason: 'unpaid' };
    const deal = { ...DEAL_ROW, retainer: { status: 'active', amount_cents: 50000, interval: 'month' } };
    await installApp(page, { api: API({ deal, proposals: [{ ...ACCEPTED, status: 'declined' }], invoices: [PAID_DEPOSIT], estimates: [est], recurring: [rec], retainer_paid: { cents: 50000, count: 1, last_at: '2026-11-01T17:00:00Z' } }) });
    await page.goto(`/crm.html?client=${CLIENT}&tab=billing`);
    await expect(page.locator('#bRecurring')).toContainText('Paused: the last two invoices are still unpaid');
    await expect(page.locator('#bEstimates')).toBeVisible();
    expect(await noSideScroll(page)).toBe(true);
  });
});
