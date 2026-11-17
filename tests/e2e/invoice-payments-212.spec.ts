import { test, expect, type Page, type Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES, onAsk } from './helpers/app';
import { capabilitiesOf, type SiteRole } from '../../supabase/functions/presence/lib/site_roles';

// Builder item 212: what tests/presence/invoice_payments_test.mjs used to check by reading
// crm.html and pipeline.html as text, checked here in the page itself. Sales items 77, 81, 82:
// the Record payment form offers the five ways and a receipt box that names the person; a
// payment Stripe took reads "Paid online" and has no Undo; Undo is a delete-level action, so a
// staff seat never sees it; Edit on the billed-to line opens the contact's own address box;
// and "Who owes you" records a payment from its own row. tests/e2e/invoice-payments.spec.ts
// covers the rest of these pages. Every write a test makes the page send is answered by a
// route the test registered on purpose, and any other write fails the test. Names are made up.

const CLIENT = 'cccccccc-3333-4333-8333-cccccccccccc';
const DEAL = 'dddddddd-4444-4444-8444-dddddddddddd';
const CID = 'ffffffff-6666-4666-8666-ffffffffffff';
const OPEN = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const PAID = 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa';
const ONLINE = 'aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa';

const ymd = (d: Date) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const TODAY = ymd(new Date());
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const toastWith = (page: Page, text: string) => page.locator('.dds-toast').filter({ hasText: text });

const OPEN_INV = { id: OPEN, number: 13, title: 'Balance at launch', description: 'Balance — Website refresh', amount_cents: 200000, purpose: 'service', status: 'open', stripe_url: 'https://pay.example/b', due_date: '2099-12-01', created_at: '2026-11-04T18:00:00Z', paid_method: '', paid_note: '', payment_for: null };
const PAID_INV = { id: PAID, number: 12, title: 'Deposit', description: 'Deposit', amount_cents: 120000, purpose: 'deposit', status: 'paid', stripe_url: null, due_date: null, paid_at: '2026-10-28T19:00:00Z', created_at: '2026-10-21T12:00:00Z', paid_method: 'check', paid_note: 'Check #1042', payment_for: null };
const ONLINE_INV = { id: ONLINE, number: 11, title: 'Discovery session', description: 'Discovery', amount_cents: 45000, purpose: 'service', status: 'paid', stripe_url: null, due_date: null, paid_at: '2026-10-20T19:00:00Z', created_at: '2026-10-18T12:00:00Z', paid_method: '', paid_note: '', payment_for: null };
const CONTACT = { id: CID, name: 'Ivy Chen', email: 'ivy@juniper.example', phone: '', company: 'Juniper Floral Co.', address: { street: '48 Elm Ave', city: 'Pasadena', state: 'CA', zip: '91101', country: '' } };
const DEAL_ROW = { id: DEAL, title: 'Website refresh', stage: 'won', expected_value_cents: 320000, contact_id: CID, converted_client_id: null, next_step: null, next_step_at: null, expected_close: null, source: 'manual', retainer: null };
const dealRead = (over: Record<string, unknown> = {}) => ({ data: { deal: DEAL_ROW, contact: CONTACT, proposals: [], contracts: [], events: [], timeline: [], invoices: [OPEN_INV, PAID_INV], estimates: [], recurring: [], last_contacted_at: null, retainer_paid: { cents: 0, count: 0, last_at: null }, ...over } });
const record = { data: {
  identity: { contact_id: CID, deal_id: DEAL, client_id: 'cl-1', customer_site_id: CLIENT, project_id: null },
  header: { name: 'Juniper Floral Co.', person: 'Ivy Chen', company: 'Juniper Floral Co.', email: 'ivy@juniper.example', phone: '', status: 'customer' },
  highlights: {}, sections: { overview: true, messages: true, deal: true, delivery: false, details: true }, default_tab: 'deal', canonical: { key: 'client', value: CLIENT },
} };
const RECORD_API = (deal = dealRead()) => ({
  '/crm/record': record,
  [`/sales/deals/${DEAL}`]: deal,
  '/crm/activity': { data: { items: [], upcoming: [], reply_to: null, reply_support_to: null } },
  '/sales/stages': { data: { chances: { lead: 10, qualified: 25, proposal: 50, contract: 75 } } },
  [`/sales/contacts/${CID}`]: { data: { contact: { ...CONTACT, notes: '', custom: {}, tags: [] }, custom_fields: [], deals: [] } },
});
const PIPELINE_API = (deal = dealRead()) => ({
  '/sales/deals': { data: [{ id: DEAL, title: 'Website refresh', stage: 'won', source: 'manual', expected_value_cents: 320000, contact_id: CID, converted_client_id: null, updated_at: '2026-11-01T00:00:00Z' }] },
  [`/sales/deals/${DEAL}`]: deal,
  [`/sales/deals/${DEAL}/tasks`]: { data: [] },
  '/sales/summary': { data: { total: 1, open: { count: 0, value_cents: 0 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 }, by_stage: [], ar: { outstanding_cents: 200000, count: 1, overdue_cents: 0, overdue_count: 0 } } },
  '/sales/contacts': { data: [] }, '/sales/templates': { data: [] }, '/sales/services': { data: [] },
  '/sales/receivables': { data: { items: [{ ...OPEN_INV, state: 'upcoming', deal_id: DEAL, deal: 'Website refresh' }], paid: [], total_cents: 200000, overdue_cents: 0, processing_cents: 0 } },
  '/identity': { data: { business_name: 'Example Studio' } },
});
const contextOf = (role: SiteRole) => ({ data: {
  site_role: role, edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: false, is_operator: false, is_managed_client: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: capabilitiesOf(role), landing: '/today.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null, scope: null,
} });

/** Every write the page sends must match one of `planned` (method + path after /presence);
 *  a planned write is answered by its handler and kept; anything else is answered 500 and
 *  listed in `unplanned`, which each test expects to stay empty. GETs go on to the fixtures. */
type Planned = { method: string; path: RegExp; answer: (route: Route) => Promise<void> | void };
async function guardWrites(page: Page, planned: Planned[]) {
  const sent: Array<{ method: string; path: string; url: string; body: unknown }> = [];
  const unplanned: string[] = [];
  await page.route('**/functions/v1/presence/**', async (route) => {
    const r = route.request();
    if (r.method() === 'GET' || r.method() === 'HEAD') return route.fallback();
    const url = new URL(r.url());
    const path = url.pathname.replace(/^.*\/functions\/v1\/presence/, '');
    const plan = planned.find((p) => p.method === r.method() && p.path.test(path));
    if (!plan) { unplanned.push(`${r.method()} ${path}`); return route.fulfill(json({ error: 'unplanned' }, 500)); }
    let body: unknown = null; try { body = r.postDataJSON(); } catch { body = r.postData(); }
    sent.push({ method: r.method(), path, url: r.url(), body });
    return plan.answer(route);
  });
  return { sent, unplanned };
}
const recordBilling = (page: Page) => page.goto(`/crm.html?client=${CLIENT}&tab=billing`);
const invRow = (page: Page, id: string) => page.locator(`#tabbody tr[data-inv-row="${id}"]`);

test.describe('the record', () => {
  test('the form offers the five ways, and a receipt box that names the person', async ({ page }) => {
    await installApp(page, { api: RECORD_API() });
    const w = await guardWrites(page, [{ method: 'POST', path: new RegExp(`^/sales/invoices/${OPEN}/payment$`), answer: (r) => r.fulfill(json({ data: { invoice: { ...OPEN_INV, status: 'paid' }, payment: null, part: false, left_cents: 0, link_deactivated: true, receipt_emailed: false } })) }]);
    await recordBilling(page);
    await invRow(page, OPEN).getByRole('button', { name: 'Record payment' }).click();
    const form = page.locator('#payhost .payform');
    await expect(form).toBeVisible();
    await expect(form.getByRole('group', { name: 'How they paid' })).toBeVisible();
    await expect(form.locator('.pf-chip span')).toHaveText(['Check', 'Cash', 'Bank transfer', 'Zelle', 'Other']);
    expect(await form.locator('input[name="pf-how"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).toEqual(['check', 'cash', 'bank_transfer', 'zelle', 'other']);
    await expect(form.getByRole('radio', { name: 'Check' })).toBeChecked();
    await expect(form.locator('.pf-rcpt')).toHaveText('Email Ivy a receipt (the PDF is attached)');
    await expect(form.getByRole('checkbox', { name: 'Email Ivy a receipt (the PDF is attached)' })).toBeChecked();
    // the way picked and the box unticked are what goes to the server
    await form.getByText('Bank transfer', { exact: true }).click();
    await form.getByRole('checkbox', { name: 'Email Ivy a receipt (the PDF is attached)' }).uncheck();
    await page.locator('#pf-go').click();
    await expect.poll(() => w.sent.length).toBe(1);
    expect(w.sent[0].url).toContain(`/sales/invoices/${OPEN}/payment?today=${TODAY}`);
    expect(w.sent[0].body).toMatchObject({ amount_cents: 200000, paid_on: TODAY, method: 'bank_transfer', email_receipt: false });
    await expect(toastWith(page, 'Marked #0013 paid, by bank transfer.')).toBeVisible();
    expect(w.unplanned).toEqual([]);
  });

  test('a person with no email on file gets no receipt box', async ({ page }) => {
    const noEmail = { ...CONTACT, email: '' };
    await installApp(page, { api: RECORD_API(dealRead({ contact: noEmail })) });
    const w = await guardWrites(page, []);
    await recordBilling(page);
    await invRow(page, OPEN).getByRole('button', { name: 'Record payment' }).click();
    await expect(page.locator('#payhost .payform')).toBeVisible();
    await expect(page.locator('#pf-rcpt')).toHaveCount(0);
    expect(w.unplanned).toEqual([]);
  });

  test('a payment Stripe took reads Paid online, and offers no Undo', async ({ page }) => {
    await installApp(page, { api: RECORD_API(dealRead({ invoices: [OPEN_INV, PAID_INV, ONLINE_INV] })) });
    const w = await guardWrites(page, []);
    await recordBilling(page);
    await expect(invRow(page, ONLINE)).toContainText('#0011 · Discovery session');
    await expect(invRow(page, ONLINE)).toContainText('Paid online');
    await expect(invRow(page, ONLINE).getByRole('button', { name: 'Undo' })).toHaveCount(0);
    await expect(invRow(page, ONLINE).getByRole('button', { name: 'Record payment' })).toHaveCount(0);
    // the one recorded by hand keeps its Undo, and says how
    await expect(invRow(page, PAID)).toContainText('Paid by check · Check #1042');
    await expect(invRow(page, PAID).getByRole('button', { name: 'Undo' })).toBeVisible();
    expect(w.unplanned).toEqual([]);
  });

  test('a staff seat records payments but is offered no Undo', async ({ page }) => {
    await installApp(page, { api: { ...RECORD_API(), '/portal/context': contextOf('business_staff') } });
    const w = await guardWrites(page, []);
    await recordBilling(page);
    await expect(invRow(page, PAID)).toContainText('Paid by check · Check #1042');
    await page.waitForFunction(() => (window as unknown as { __ddsContext?: unknown }).__ddsContext);
    await expect(invRow(page, PAID).getByRole('button', { name: 'Undo' })).toBeHidden();
    await expect(invRow(page, OPEN).getByRole('button', { name: 'Record payment' })).toBeVisible();
    expect(w.unplanned).toEqual([]);
    // the owner, on the same record, is offered it
    await installApp(page, { api: { ...RECORD_API(), '/portal/context': contextOf('business_owner') } });
    const w2 = await guardWrites(page, []);   // installApp's own route was added again: the guard goes back in front of it
    await recordBilling(page);
    await expect(invRow(page, PAID).getByRole('button', { name: 'Undo' })).toBeVisible();
    expect(w2.unplanned).toEqual([]);
  });

  test('Edit on the billed-to line opens their contact on Details, in its one address box', async ({ page }) => {
    await installApp(page, { api: RECORD_API() });
    const w = await guardWrites(page, [{ method: 'PATCH', path: new RegExp(`^/sales/contacts/${CID}$`), answer: (r) => r.fulfill(json({ data: { ...CONTACT, address: { street: '50 Elm Ave', city: 'Pasadena', state: 'CA', zip: '91101' } } })) }]);
    await recordBilling(page);
    await expect(page.locator('#billedTo')).toContainText('Invoices are billed to Ivy Chen, Juniper Floral Co., 48 Elm Ave, Pasadena, CA 91101.');
    await page.locator('#billedTo').getByRole('button', { name: 'Edit' }).click();
    await expect(page.locator('#ec-address')).toBeFocused();
    await expect(page.locator('#ec-address')).toHaveValue('48 Elm Ave');
    await expect(page.locator('[id="ec-address"]')).toHaveCount(1);   // the contact's own box, never a second one for invoices
    await expect(page.locator('#ec-city')).toHaveValue('Pasadena');
    await page.locator('#ec-address').fill('50 Elm Ave');
    await page.locator('#ec-save').click();
    await expect.poll(() => w.sent.length).toBe(1);
    expect((w.sent[0].body as { address: unknown }).address).toMatchObject({ street: '50 Elm Ave', city: 'Pasadena', state: 'CA', zip: '91101' });
    expect(w.unplanned).toEqual([]);
  });
});

test.describe('the deal page', () => {
  test('Who owes you: Record payment opens under the row and records it', async ({ page }) => {
    await installApp(page, { api: PIPELINE_API() });
    const w = await guardWrites(page, [{ method: 'POST', path: new RegExp(`^/sales/invoices/${OPEN}/payment$`), answer: (r) => r.fulfill(json({ data: { part: true, left_cents: 150000, link_deactivated: true, fresh_link: true, receipt_emailed: true } })) }]);
    await page.goto('/pipeline.html#outstanding');
    await expect(page.locator('#detailInner')).toContainText('Who owes you');
    const row = page.locator('#detailInner .rcv-row', { hasText: '#0013 · Balance at launch' });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Record payment' }).click();
    const form = page.locator('#detailInner form.payform');
    await expect(form).toBeVisible();
    expect(await row.evaluate((el) => el.nextElementSibling?.matches('form.payform'))).toBe(true);   // it opens right under its own row
    await expect(form).toHaveAttribute('aria-label', 'Record a payment for #0013');
    await expect(form.locator('.pf-chip span')).toHaveText(['Check', 'Cash', 'Bank transfer', 'Zelle', 'Other']);
    await expect(form.locator('.pf-rcpt')).toHaveText('Email them a receipt (the PDF is attached)');
    await form.getByLabel('Amount received (USD)').fill('500');
    await expect(form.getByRole('button', { name: 'Record $500 part payment' })).toBeVisible();
    await expect(form).toContainText('$1,500 stays due on #0013');
    await form.getByText('Zelle', { exact: true }).click();
    await form.getByRole('button', { name: 'Record $500 part payment' }).click();
    await expect.poll(() => w.sent.length).toBe(1);
    expect(w.sent[0].url).toContain(`/sales/invoices/${OPEN}/payment?today=${TODAY}`);
    expect(w.sent[0].body).toMatchObject({ amount_cents: 50000, paid_on: TODAY, method: 'zelle', email_receipt: true });
    await expect(page.getByText('Recorded a $500 part payment. $1,500 is still due on #0013. Receipt emailed.', { exact: false })).toBeVisible();
    expect(w.unplanned).toEqual([]);
  });

  test('Undo on the deal asks first, then takes the payment back', async ({ page }) => {
    await installApp(page, { api: PIPELINE_API() });
    const w = await guardWrites(page, [{ method: 'POST', path: new RegExp(`^/sales/invoices/${PAID}/payment/undo$`), answer: (r) => r.fulfill(json({ data: { undone: true, part: false, fresh_link: true, moved_back: 'contract' } })) }]);
    const asked: string[] = [];
    let answer = false;
    await onAsk(page, (q) => { asked.push(q); return answer; });
    await page.goto(`/pipeline.html?deal=${DEAL}&dtab=billing`);
    const undo = page.locator('#detailInner').getByRole('button', { name: /Undo the payment on/ });
    await expect(undo).toBeVisible();
    await undo.click();                                     // "Cancel" first: nothing is sent
    await expect.poll(() => asked.length).toBe(1);
    expect(asked[0]).toContain('The invoice goes back to unpaid');
    expect(w.sent).toEqual([]);
    answer = true;
    await undo.click();
    await expect.poll(() => w.sent.length).toBe(1);
    await expect(page.getByText('Payment undone. The invoice is open again. It has a fresh payment link, so its reminders carry on. The deal is back where it was.', { exact: false })).toBeVisible();
    expect(w.unplanned).toEqual([]);
  });

  test('a staff seat is offered no Undo on the deal', async ({ page }) => {
    await installApp(page, { api: { ...PIPELINE_API(), '/portal/context': contextOf('business_staff') } });
    const w = await guardWrites(page, []);
    await page.goto(`/pipeline.html?deal=${DEAL}&dtab=billing`);
    const detail = page.locator('#detailInner');
    await expect(detail).toContainText('#0012 · Deposit');
    await page.waitForFunction(() => (window as unknown as { __ddsContext?: unknown }).__ddsContext);
    await expect(detail.getByRole('button', { name: 'Record payment' })).toBeVisible();
    await expect(detail.locator(`[data-undo-pay="${PAID}"]`)).toBeAttached();
    await expect(detail.locator(`[data-undo-pay="${PAID}"]`)).toBeHidden();
    expect(w.unplanned).toEqual([]);
  });
});
