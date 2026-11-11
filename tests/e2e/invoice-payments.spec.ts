import { test, expect, type Page } from '@playwright/test';
import { installApp } from './helpers/app';

// Sales items 77, 81 and 82 (Nov 10 review): a payment made by check, cash, bank transfer
// or Zelle is recorded on the invoice (all of it, or a part), and undone if it was a
// mistake; every invoice carries its running number and says how it was paid; the
// client's address is kept on their contact; and every invoice downloads as a real PDF.
// On the record (crm.html), the deal (pipeline.html) and Who owes you. Every name is made up.

const CLIENT = 'cccccccc-3333-4333-8333-cccccccccccc';
const DEAL = 'dddddddd-4444-4444-8444-dddddddddddd';
const CID = 'ffffffff-6666-4666-8666-ffffffffffff';
const OPEN = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const PAID = 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa';
const PART = 'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa';

const ymd = (d: Date) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const TODAY = ymd(new Date());
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const toastWith = (page: Page, text: string) => page.locator('.dds-toast').filter({ hasText: text });

const OPEN_INV = { id: OPEN, number: 13, title: 'Balance at launch', description: 'Balance — Website refresh', amount_cents: 200000, purpose: 'service', status: 'open', stripe_url: 'https://pay.example/b', due_date: '2099-12-01', created_at: '2026-11-04T18:00:00Z', paid_method: '', paid_note: '', payment_for: null };
const PAID_INV = { id: PAID, number: 12, title: 'Deposit', description: 'Deposit', amount_cents: 120000, purpose: 'deposit', status: 'paid', stripe_url: null, due_date: null, paid_at: '2026-10-28T19:00:00Z', created_at: '2026-10-21T12:00:00Z', paid_method: 'check', paid_note: 'Check #1042', payment_for: null };
const HEADER = { name: 'Juniper Floral Co.', person: 'Ivy Chen', company: 'Juniper Floral Co.', email: 'ivy@juniper.example', phone: '', status: 'customer' };
const record = { data: {
  identity: { contact_id: CID, deal_id: DEAL, client_id: 'cl-1', customer_site_id: CLIENT, project_id: null },
  header: HEADER, highlights: {}, sections: { overview: true, messages: true, deal: true, delivery: false, details: true },
  default_tab: 'deal', canonical: { key: 'client', value: CLIENT },
} };
const DEAL_ROW = { id: DEAL, title: 'Website refresh', stage: 'won', expected_value_cents: 320000, contact_id: CID, converted_client_id: null, next_step: null, next_step_at: null, expected_close: null, source: 'manual', retainer: null };
// the contact's address in sales item 89's shape (its own migration and PR)
const CONTACT = { id: CID, name: 'Ivy Chen', email: 'ivy@juniper.example', phone: '', company: 'Juniper Floral Co.', address: { street: '48 Elm Ave', city: 'Pasadena', state: 'CA', zip: '91101', country: '' } };
const dealRead = (over: Record<string, unknown> = {}) => ({ data: { deal: DEAL_ROW, contact: CONTACT, proposals: [], contracts: [], events: [], timeline: [], invoices: [OPEN_INV, PAID_INV], estimates: [], recurring: [], last_contacted_at: null, retainer_paid: { cents: 0, count: 0, last_at: null }, ...over } });
const API = (deal = dealRead()) => ({
  '/crm/record': record,
  [`/sales/deals/${DEAL}`]: deal,
  '/crm/activity': { data: { items: [], upcoming: [], reply_to: null, reply_support_to: null } },
  '/sales/stages': { data: { chances: { lead: 10, qualified: 25, proposal: 50, contract: 75 } } },
  [`/sales/contacts/${CID}`]: { data: { contact: { ...CONTACT, notes: '', custom: {} }, custom_fields: [], deals: [] } },
});
const recordBilling = (page: Page) => page.goto(`/crm.html?client=${CLIENT}&tab=billing`);
const invRow = (page: Page, id: string) => page.locator(`#tabbody tr[data-inv-row="${id}"]`);

test.describe('item 77 — record a payment on the record', () => {
  test('all of it: the form opens under the invoice, then marks it paid by check', async ({ page }) => {
    await installApp(page, { api: API() });
    const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
    await page.route(`**/functions/v1/presence/sales/invoices/${OPEN}/payment**`, (route) => {
      sent.push({ url: route.request().url(), body: route.request().postDataJSON() });
      return route.fulfill(json({ data: { invoice: { ...OPEN_INV, status: 'paid' }, payment: null, part: false, left_cents: 0, link_deactivated: true, receipt_emailed: true } }));
    });
    await recordBilling(page);
    await expect(invRow(page, OPEN)).toContainText('#0013 · Balance at launch');
    await invRow(page, OPEN).getByRole('button', { name: 'Record payment' }).click();
    const form = page.locator('#payhost .payform');
    await expect(form).toBeVisible();
    await expect(page.locator('#pf-h')).toHaveText('Record a payment for #0013');
    await expect(page.locator('#pf-amt')).toHaveValue('2000.00');
    await expect(page.locator('#pf-on')).toHaveValue(TODAY);
    await expect(form.getByRole('radio', { name: 'Check' })).toBeChecked();
    await expect(page.locator('#pf-rcpt')).toBeChecked();
    await expect(page.locator('#pf-go')).toHaveText('Mark #0013 paid');
    await expect(page.locator('#pf-what')).toContainText('switches its card link off');
    await page.locator('#pf-note').fill('Check #2207');
    await page.locator('#pf-go').click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0].url).toContain('/payment?today=' + TODAY);
    expect(sent[0].body).toEqual({ amount_cents: 200000, paid_on: TODAY, method: 'check', note: 'Check #2207', email_receipt: true });
    await expect(toastWith(page, 'Marked #0013 paid, by check. Receipt emailed to Ivy.')).toBeVisible();
  });

  test('part of it: the button and the line say what stays due, and the way is picked', async ({ page }) => {
    await installApp(page, { api: API() });
    const sent: Array<Record<string, unknown>> = [];
    await page.route(`**/functions/v1/presence/sales/invoices/${OPEN}/payment**`, (route) => {
      sent.push(route.request().postDataJSON());
      return route.fulfill(json({ data: { invoice: { ...OPEN_INV, amount_cents: 150000 }, payment: { id: PART }, part: true, left_cents: 150000, link_deactivated: false, receipt_emailed: false } }));
    });
    await recordBilling(page);
    await invRow(page, OPEN).getByRole('button', { name: 'Record payment' }).click();
    await page.locator('#pf-amt').fill('500');
    await expect(page.locator('#pf-go')).toHaveText('Record $500 part payment');
    await expect(page.locator('#pf-what')).toContainText('$1,500 stays due on #0013');
    await page.locator('#payhost .payform').getByText('Zelle', { exact: true }).click();
    await page.locator('#pf-rcpt').uncheck();
    await page.locator('#pf-go').click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toMatchObject({ amount_cents: 50000, method: 'zelle', email_receipt: false });
    const t = toastWith(page, 'Recorded a $500 part payment. $1,500 is still due on #0013.');
    await expect(t).toBeVisible();
    await expect(t).toContainText('may still be live');   // Stripe didn't switch the old link off
  });

  test('more than due is caught before anything is sent', async ({ page }) => {
    await installApp(page, { api: API() });
    let posts = 0;
    await page.route(`**/functions/v1/presence/sales/invoices/${OPEN}/payment**`, (route) => { posts++; return route.fulfill(json({ data: {} })); });
    await recordBilling(page);
    await invRow(page, OPEN).getByRole('button', { name: 'Record payment' }).click();
    await page.locator('#pf-amt').fill('2500');
    await page.locator('#pf-go').click();
    await expect(toastWith(page, 'That’s more than the $2,000 due.')).toBeVisible();
    expect(posts).toBe(0);
  });

  test('a paid one says how, and Undo asks first then takes it back', async ({ page }) => {
    await installApp(page, { api: API() });
    const undone: string[] = [];
    await page.route(`**/functions/v1/presence/sales/invoices/${PAID}/payment/undo`, (route) => { undone.push(route.request().method()); return route.fulfill(json({ data: { undone: true, part: false } })); });
    let asked = '';
    page.on('dialog', (d) => { asked = d.message(); d.accept(); });
    await recordBilling(page);
    const row = invRow(page, PAID);
    await expect(row).toContainText('#0012 · Deposit');
    await expect(row).toContainText('Paid by check · Check #1042');
    await expect(row.getByRole('button', { name: 'Record payment' })).toHaveCount(0);
    await row.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => undone.length).toBe(1);
    expect(asked).toContain('goes back to unpaid');
    await expect(toastWith(page, 'Payment undone. #0012 is open again')).toBeVisible();
  });

  test('a part payment is its own paid row, under the invoice it went toward', async ({ page }) => {
    const part = { id: PART, number: null, title: 'Part payment — Balance at launch', description: 'Part payment toward invoice #0013', amount_cents: 50000, purpose: 'service', status: 'paid', paid_at: '2026-11-08T20:00:00Z', created_at: '2026-11-08T20:00:00Z', paid_method: 'zelle', paid_note: '', payment_for: OPEN };
    await installApp(page, { api: API(dealRead({ invoices: [{ ...OPEN_INV, amount_cents: 150000 }, part] })) });
    await recordBilling(page);
    await expect(invRow(page, PART)).toContainText('Part payment · #0013');
    await expect(invRow(page, PART)).toContainText('Paid by Zelle');
    await expect(invRow(page, OPEN)).toContainText('$500 paid so far');
  });
});

test.describe('items 81 and 82 — the proper invoice, the PDF, the address', () => {
  test('PDF downloads the invoice’s own PDF under its number', async ({ page }) => {
    await installApp(page, { api: API() });
    const PDF_URL = 'https://example.supabase.co/functions/v1/presence/sales/doc/abc.def?format=pdf';
    await page.route(`**/functions/v1/presence/sales/invoices/${OPEN}/document`, (route) => route.fulfill(json({ url: 'https://app.example/doc.html?t=abc.def', pdf_url: PDF_URL })));
    await page.route(/\/sales\/doc\/abc\.def\?format=pdf$/, (route) => route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4\n%%EOF\n' }));
    await recordBilling(page);
    const [download] = await Promise.all([page.waitForEvent('download'), invRow(page, OPEN).getByRole('button', { name: 'PDF' }).click()]);
    expect(download.suggestedFilename()).toBe('Invoice-0013.pdf');
  });

  test('Billing says who invoices go to and where; Edit opens their contact', async ({ page }) => {
    await installApp(page, { api: API() });
    await recordBilling(page);
    await expect(page.locator('#billedTo')).toContainText('Invoices are billed to Ivy Chen, Juniper Floral Co., 48 Elm Ave, Pasadena, CA 91101.');
    await page.locator('#billedTo').getByRole('button', { name: 'Edit' }).click();
    await expect(page.locator('#ec-name')).toBeVisible();   // the contact editor, where the address lives (item 89)
  });

  test('before contacts hold an address: Billing names who, and offers nothing it can’t keep', async ({ page }) => {
    const { address: _a, ...older } = CONTACT;
    await installApp(page, { api: API(dealRead({ contact: older })) });
    await recordBilling(page);
    await expect(page.locator('#billedTo')).toHaveText('Invoices are billed to Ivy Chen, Juniper Floral Co.');
  });

  test('no address yet: Billing says so and offers to add one', async ({ page }) => {
    await installApp(page, { api: API(dealRead({ contact: { ...CONTACT, address: {} } })) });
    await recordBilling(page);
    await expect(page.locator('#billedTo')).toContainText('No postal address yet, so none prints on them.');
    await expect(page.locator('#billedTo').getByRole('button', { name: 'Add their address' })).toBeVisible();
  });

  test('the form fits the screen (phone, tablet, computer): no sideways scroll, chips big enough to tap', async ({ page }) => {
    await installApp(page, { api: API() });
    await recordBilling(page);
    await invRow(page, OPEN).getByRole('button', { name: 'Record payment' }).click();
    await expect(page.locator('#payhost .payform')).toBeVisible();
    const fits = await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth + 1);
    expect(fits).toBe(true);
    const chip = await page.locator('#payhost .payform .pf-chip span').first().boundingBox();
    expect(chip && chip.height >= 40).toBe(true);
  });
});

test.describe('item 77 — on the deal and in Who owes you', () => {
  const pipelineApi = () => ({
    '/sales/deals': { data: [{ id: DEAL, title: 'Website refresh', stage: 'won', source: 'manual', expected_value_cents: 320000, contact_id: CID, converted_client_id: null, updated_at: '2026-11-01T00:00:00Z' }] },
    [`/sales/deals/${DEAL}`]: dealRead(),
    [`/sales/deals/${DEAL}/tasks`]: { data: [] },
    '/sales/summary': { data: { total: 1, open: { count: 0, value_cents: 0 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 }, by_stage: [], ar: { outstanding_cents: 200000, count: 1, overdue_cents: 0, overdue_count: 0 } } },
    '/sales/contacts': { data: [] }, '/sales/templates': { data: [] }, '/sales/services': { data: [] },
    '/sales/receivables': { data: { items: [{ ...OPEN_INV, state: 'upcoming', deal_id: DEAL, deal: 'Website refresh' }], paid: [], total_cents: 200000, overdue_cents: 0, processing_cents: 0 } },
    '/identity': { data: { business_name: 'Example Studio' } },
  });
  test('the deal’s invoice rows: numbers, how it was paid, Record payment and Undo', async ({ page }) => {
    await installApp(page, { api: pipelineApi() });
    const sent: Array<Record<string, unknown>> = [];
    await page.route(`**/functions/v1/presence/sales/invoices/${OPEN}/payment**`, (route) => { sent.push(route.request().postDataJSON()); return route.fulfill(json({ data: { part: false, left_cents: 0, link_deactivated: true, receipt_emailed: true } })); });
    await page.goto(`/pipeline.html?deal=${DEAL}&dtab=billing`);
    const detail = page.locator('#detailInner');
    await expect(detail).toContainText('#0013 · Balance at launch');
    await expect(detail).toContainText('#0012 · Deposit');
    await expect(detail).toContainText('paid by check');
    await expect(detail.getByRole('button', { name: /Undo the payment on/ })).toBeVisible();
    await detail.getByRole('button', { name: 'Record payment' }).click();
    const form = detail.locator('form.payform');
    await expect(form).toBeVisible();
    await expect(form.getByRole('button', { name: 'Mark #0013 paid' })).toBeVisible();
    await form.getByText('Cash', { exact: true }).click();
    await form.getByRole('button', { name: 'Mark #0013 paid' }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toMatchObject({ amount_cents: 200000, method: 'cash', email_receipt: true });
    await expect(page.getByText('Marked #0013 paid in cash.', { exact: false })).toBeVisible();
  });
});
