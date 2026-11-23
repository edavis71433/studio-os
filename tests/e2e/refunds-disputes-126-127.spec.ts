import { test, expect, type Page } from '@playwright/test';
import { installApp, ALL_FEATURES, STUDIO_NAV, STUDIO_LEVEL_NAV, settled } from './helpers/app';
import { pinClock } from './helpers/clock';

// Sales items 126, 127 (Stripe review, Nov 15 2026): a refund made in Stripe, full or part,
// and a dispute a client opens, show wherever the invoice does. On the deal and the record
// an invoice reads Refunded, Paid with what was refunded, Disputed (with Stripe's deadline,
// a way to answer it and one download of the proof) or Dispute lost; Paid counts only what
// was kept; nothing offers to send, record or void a payment that came back. The client's
// portal says the same in the client's words, and Today and the Invoices page count only
// what was kept. The server half is tests/presence/stripe_refunds_disputes_126_127_test.mjs.
// No test here writes anything: installApp's pretend server refuses any save. Names are made up.

const PINNED = Date.parse('2026-11-16T18:00:00Z');
test.beforeEach(async ({ page }) => { await pinClock(page, PINNED); });

const CLIENT = 'cccccccc-3333-4333-8333-cccccccccccc';
const DEAL = 'dddddddd-4444-4444-8444-dddddddddddd';
const CID = 'ffffffff-6666-4666-8666-ffffffffffff';
const REFUNDED = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa1';
const PART = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa2';
const DISPUTED = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa3';
const DSP_ROW = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbb3';
const ANSWER = 'https://dashboard.stripe.com/test/disputes/du_test1aaaa';

const inv = (id: string, number: number, title: string, amount: number, paidDay: string, over: Record<string, unknown> = {}) => ({
  id, number, title, description: title, amount_cents: amount, purpose: 'service', status: 'paid', stripe_url: null, due_date: null,
  paid_at: `2026-11-${paidDay}T17:00:00Z`, created_at: '2026-10-20T12:00:00Z', paid_method: '', paid_note: '', payment_for: null, refunded_cents: 0, dispute_status: null, ...over,
});
const INVOICES = [
  inv(REFUNDED, 13, 'Website build', 100000, '02', { refunded_cents: 100000 }),
  inv(PART, 14, 'Logo set', 50000, '03', { refunded_cents: 20000 }),
  inv(DISPUTED, 15, 'Hosting year', 30000, '04', { dispute_status: 'open' }),
];
const RETURNS = [
  { id: 'r1', kind: 'refund', invoice_id: REFUNDED, applies_to: 'invoice', amount_cents: 100000, counted_cents: 100000, fee_cents: 0, status: 'succeeded', inquiry: false, bank: false, due_by: null, happened_at: '2026-11-10T16:00:00Z', closed_at: null, client_emailed: true, answer_url: null },
  { id: 'r2', kind: 'refund', invoice_id: PART, applies_to: 'invoice', amount_cents: 20000, counted_cents: 20000, fee_cents: 0, status: 'succeeded', inquiry: false, bank: false, due_by: null, happened_at: '2026-11-12T16:00:00Z', closed_at: null, client_emailed: true, answer_url: null },
  { id: DSP_ROW, kind: 'dispute', invoice_id: DISPUTED, applies_to: 'invoice', amount_cents: 30000, counted_cents: 0, fee_cents: 1500, status: 'open', inquiry: false, bank: false, due_by: '2026-11-30T18:00:00Z', happened_at: '2026-11-15T16:00:00Z', closed_at: null, client_emailed: false, answer_url: ANSWER },
];
const CONTACT = { id: CID, name: 'Ivy Chen', email: 'ivy@juniper.example', phone: '', company: 'Juniper Floral Co.' };
const DEAL_ROW = { id: DEAL, title: 'Harbor website', stage: 'won', expected_value_cents: 180000, contact_id: CID, converted_client_id: null, next_step: null, next_step_at: null, expected_close: null, source: 'manual', retainer: null };
const dealRead = (over: Record<string, unknown> = {}) => ({ data: { deal: DEAL_ROW, contact: CONTACT, proposals: [], contracts: [], events: [], timeline: [], invoices: INVOICES, estimates: [], recurring: [], last_contacted_at: null, retainer_paid: { cents: 0, count: 0, last_at: null }, returns: RETURNS, ...over } });
const STUDIO_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: false, is_operator: false, is_managed_client: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'view_all', 'export', 'delete'], landing: '/today.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null, scope: null,
} };
const PIPELINE_API = (deal = dealRead()) => ({
  '/portal/context': STUDIO_CTX,
  '/sales/deals': { data: [{ id: DEAL, title: 'Harbor website', stage: 'won', source: 'manual', expected_value_cents: 180000, contact_id: CID, converted_client_id: null, updated_at: '2026-11-01T00:00:00Z' }] },
  [`/sales/deals/${DEAL}`]: deal,
  [`/sales/deals/${DEAL}/tasks`]: { data: [] },
  '/sales/summary': { data: { total: 1, open: { count: 0, value_cents: 0 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 }, by_stage: [], ar: { outstanding_cents: 0, count: 0, overdue_cents: 0, overdue_count: 0 } } },
  '/sales/contacts': { data: [] }, '/sales/templates': { data: [] }, '/sales/services': { data: [] },
  '/sales/receivables': { data: { items: [], paid: [], total_cents: 0, overdue_cents: 0, processing_cents: 0 } },
  '/identity': { data: { business_name: 'Example Studio' } },
});
const billingRow = (page: Page, title: string) => page.locator('#detailInner .lr', { hasText: title });

test.describe('the deal page', () => {
  test('a refunded invoice, a part refund and a dispute each read as what they are, and Paid counts what was kept', async ({ page }) => {
    await installApp(page, { api: PIPELINE_API() });
    await page.goto(`/pipeline.html?deal=${DEAL}&dtab=billing`);
    const refunded = billingRow(page, '#0013');
    await expect(refunded.locator('[data-money]')).toHaveText('Refunded');
    await expect(refunded).toContainText('refunded in full');
    // money that came back can't be sent, recorded, voided or undone
    for (const name of ['Record payment', 'Send', 'Resend', 'Void', 'Undo']) await expect(refunded.getByRole('button', { name, exact: true })).toHaveCount(0);
    const part = billingRow(page, '#0014');
    await expect(part.locator('[data-money]')).toHaveText('Paid');
    await expect(part).toContainText('$200 refunded');
    const disputed = billingRow(page, '#0015');
    await expect(disputed.locator('[data-money]')).toHaveText('Disputed');
    await expect(disputed).toContainText('answer in Stripe by Nov 30');
    await expect(disputed.getByRole('link', { name: 'Answer in Stripe' })).toHaveAttribute('href', ANSWER);
    await expect(disputed.getByRole('link', { name: 'Answer in Stripe' })).toHaveAttribute('target', '_blank');
    await expect(disputed.getByRole('button', { name: 'Download proof' })).toBeVisible();
    // the Overview's Money card: only the kept $300 is Paid, and the dispute has its own line
    await page.locator('#dtab-overview').click();
    const money = page.locator('#dpanel-overview');
    await expect(money).toContainText('Paid $300');
    await expect(money).toContainText('Disputed $300 · answer in Stripe by Nov 30');
  });

  test('Download proof gets the one zip for the answer in Stripe', async ({ page }) => {
    await installApp(page, { api: PIPELINE_API() });
    let asked = '';
    await page.route(`**/functions/v1/presence/sales/disputes/${DSP_ROW}/proof`, (route) => {
      asked = route.request().method();
      return route.fulfill({ status: 200, headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="dispute-proof-harbor-website.zip"', 'Access-Control-Expose-Headers': 'Content-Disposition' }, body: Buffer.from('PK\u0005\u0006' + '\u0000'.repeat(18), 'binary') });
    });
    await page.goto(`/pipeline.html?deal=${DEAL}&dtab=billing`);
    const btn = billingRow(page, '#0015').getByRole('button', { name: 'Download proof' });
    const download = page.waitForEvent('download');
    await btn.click();
    expect((await download).suggestedFilename()).toBe('dispute-proof-harbor-website.zip');
    expect(asked).toBe('GET');
    await expect(page.locator('.dds-toast').filter({ hasText: 'Downloaded dispute-proof-harbor-website.zip. Add its files to your answer in Stripe.' })).toBeVisible();
    await expect(btn).toBeEnabled();
  });

  test('a bank payment disputed says it is final, and offers nothing to answer', async ({ page }) => {
    const bank = RETURNS.map((r) => (r.id === DSP_ROW ? { ...r, bank: true, due_by: null, answer_url: null } : r));
    await installApp(page, { api: PIPELINE_API(dealRead({ returns: bank })) });
    await page.goto(`/pipeline.html?deal=${DEAL}&dtab=billing`);
    const row = billingRow(page, '#0015');
    await expect(row.locator('[data-money]')).toHaveText('Disputed');
    await expect(row).toContainText('their bank took it back, and bank disputes are final');
    await expect(row.getByRole('link', { name: 'Answer in Stripe' })).toHaveCount(0);
    await expect(row.getByRole('button', { name: 'Download proof' })).toHaveCount(0);
  });

  test('a lost dispute reads Dispute lost, with Stripe’s fee', async ({ page }) => {
    const lostInv = INVOICES.map((v) => (v.id === DISPUTED ? { ...v, dispute_status: 'lost' } : v));
    const lostRet = RETURNS.map((r) => (r.id === DSP_ROW ? { ...r, status: 'lost', counted_cents: 30000, answer_url: null, closed_at: '2026-11-16T12:00:00Z' } : r));
    await installApp(page, { api: PIPELINE_API(dealRead({ invoices: lostInv, returns: lostRet })) });
    await page.goto(`/pipeline.html?deal=${DEAL}&dtab=billing`);
    const row = billingRow(page, '#0015');
    await expect(row.locator('[data-money]')).toHaveText('Dispute lost');
    await expect(row).toContainText('went back to them, plus Stripe’s $15 fee');
    await expect(row.getByRole('button', { name: 'Download proof' })).toHaveCount(0);
  });
});

// ── the record's Billing tab ──
const record = { data: {
  identity: { contact_id: CID, deal_id: DEAL, client_id: 'cl-1', customer_site_id: CLIENT, project_id: null },
  header: { name: 'Juniper Floral Co.', person: 'Ivy Chen', company: 'Juniper Floral Co.', email: 'ivy@juniper.example', phone: '', status: 'customer' },
  highlights: {}, sections: { overview: true, messages: true, deal: true, delivery: false, details: true }, default_tab: 'deal', canonical: { key: 'client', value: CLIENT },
} };
const RECORD_API = {
  '/portal/context': STUDIO_CTX,
  '/crm/record': record,
  [`/sales/deals/${DEAL}`]: dealRead(),
  '/crm/activity': { data: { items: [], upcoming: [], reply_to: null, reply_support_to: null } },
  '/sales/stages': { data: { chances: { lead: 10, qualified: 25, proposal: 50, contract: 75 } } },
  [`/sales/contacts/${CID}`]: { data: { contact: { ...CONTACT, notes: '', custom: {}, tags: [] }, custom_fields: [], deals: [] } },
};
test.describe('the record', () => {
  test('the Billing tab reads the same, and offers nothing to send, record or void on money that came back', async ({ page }) => {
    await installApp(page, { api: RECORD_API });
    await page.goto(`/crm.html?client=${CLIENT}&tab=billing`);
    const row = (id: string) => page.locator(`#tabbody tr[data-inv-row="${id}"]`);
    await expect(row(REFUNDED).locator('.schip')).toHaveText('Refunded');
    await expect(row(REFUNDED)).toContainText('Refunded in full through Stripe');
    for (const name of ['Record payment', 'Send', 'Resend', 'Void', 'Undo', 'Copy link']) await expect(row(REFUNDED).getByRole('button', { name, exact: true })).toHaveCount(0);
    await expect(row(PART).locator('.schip')).toHaveText('Paid');
    await expect(row(PART)).toContainText('$200 refunded');
    await expect(row(DISPUTED).locator('.schip')).toHaveText('Disputed');
    await expect(row(DISPUTED)).toContainText('Answer in Stripe by Nov 30');
    await expect(row(DISPUTED).getByRole('link', { name: 'Answer in Stripe' })).toHaveAttribute('href', ANSWER);
    for (const name of ['Record payment', 'Send', 'Void']) await expect(row(DISPUTED).getByRole('button', { name, exact: true })).toHaveCount(0);
  });
});

// ── the client's portal ──
const PID = '11111111-1111-4111-8111-111111111111';
const PORTAL_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS',
  edition_features: ['website', 'client_portal'], is_agency: false, is_operator: false, sees_full_workspace: true,
  is_client_portal: false, is_managed_client: true, capabilities: ['view_all'], landing: '/client.html', attention_count: 0,
  nav: [], studio: { name: 'Marlow & Co', logo_url: null, accent: '#8c3b2e', is_default: false }, client_first_name: 'Ivy',
} };
const pinv = (id: string, number: string, name: string, amount: number, paidDay: string, over: Record<string, unknown> = {}) => ({ id, number, name, amount, status: 'paid', paid_at: `2026-11-${paidDay}T17:00:00Z`, due_date: null, created_at: `2026-11-${paidDay}T10:00:00Z`, view_url: `https://docs.example/${id}`, refunded_cents: 0, dispute_status: null, ...over });
const PORTAL_API = {
  '/portal/context': PORTAL_CTX,
  '/portal/feed': { data: { role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null } },
  '/client/notifications': { data: [], unread_count: 0 },
  '/client/projects': { data: [{ id: PID, name: 'Website build', status: 'active' }] },
  [`/client/projects/${PID}`]: { data: { project: { id: PID, name: 'Website build', status: 'active' }, milestones: [], tasks: [], events: [], surveys: [], progress: { total: 0, done: 0, pct: 0 }, deliverables: [], approvals: [] } },
  [`/client/projects/${PID}/report`]: { data: { summary: null } },
  [`/client/projects/${PID}/messages`]: { data: [] },
  '/client/documents': { data: { documents: [] } },
  '/client/billing': { data: { invoices: [
    pinv('i13', '#0013', 'Website build', 1000, '02', { refunded_cents: 100000 }),
    pinv('i14', '#0014', 'Logo set', 500, '03', { refunded_cents: 20000 }),
    pinv('i15', '#0015', 'Hosting year', 300, '04', { dispute_status: 'lost' }),
    pinv('i16', '#0016', 'Photo shoot', 400, '05', { dispute_status: 'open' }),
  ], summary: { open_count: 0, paid_count: 4 } } },
  '/client/reports': { data: { reports: [] } },
  '/client/support': { data: [] },
  '/client/faq': { data: { html: '', faq: { items: [] } } },
  '/client/kit': { data: null },
};
const shelfRow = (page: Page, title: string) => page.locator('#shelf .srow', { has: page.getByRole('heading', { name: title, exact: true }) });
test.describe('the client’s portal', () => {
  test('their invoices say Refunded, Paid with what came back, Disputed, and Returned when the card company sided with them', async ({ page }) => {
    await installApp(page, { api: PORTAL_API });
    await page.goto('/client.html');
    await page.locator('#tabnav [data-tab="documents"]').click();
    await expect(shelfRow(page, 'Website build').locator('.fst')).toHaveText('Refunded');
    await expect(shelfRow(page, 'Logo set').locator('.fst')).toHaveText('Paid');
    await expect(shelfRow(page, 'Hosting year').locator('.fst')).toHaveText('Returned');
    await expect(shelfRow(page, 'Photo shoot').locator('.fst')).toHaveText('Disputed');
    const sz = page.viewportSize();
    const info = (title: string) => ((sz && sz.width >= 1000) ? shelfRow(page, title).locator('.sinfo') : shelfRow(page, title).locator('.sline'));
    await expect(info('Logo set')).toContainText('paid Nov 3 · $200 refunded');
    await expect(info('Website build')).toContainText('paid Nov 2');
    // nothing that came back asks to be paid
    await expect(page.locator('#shelf').getByRole('link', { name: /^Pay/ })).toHaveCount(0);
  });
});

// ── Today's money band ──
test.describe('Today', () => {
  test('the Paid bucket counts what was kept, never a refunded or disputed payment', async ({ page }) => {
    await installApp(page, { api: { '/sales/receivables': { data: { items: [
      { id: 'inv-1', title: 'Balance', amount_cents: 90000, due_date: '2099-01-10', status: 'open', state: 'upcoming', overdue: false, deal_id: 'd2', deal: 'Larkspur Kitchen', stripe_url: 'https://pay.example/1' },
    ], paid: [
      { id: 'inv-0', title: 'Kickoff', amount_cents: 120000, status: 'paid', state: 'paid', refunded_cents: 20000, dispute_status: null, paid_at: '2026-11-05T00:00:00Z', deal_id: 'd1', deal: 'Jordan Ellis' },
      { id: 'inv-9', title: 'Photos', amount_cents: 40000, status: 'paid', state: 'refunded', refunded_cents: 40000, dispute_status: null, paid_at: '2026-11-06T00:00:00Z', deal_id: 'd3', deal: 'Marigold Orange' },
      { id: 'inv-8', title: 'Hosting', amount_cents: 30000, status: 'paid', state: 'disputed', refunded_cents: 0, dispute_status: 'open', paid_at: '2026-11-07T00:00:00Z', deal_id: 'd4', deal: 'Harbor Dental' },
    ], paid_window_days: 30, total_cents: 90000, overdue_cents: 0, processing_cents: 0 } } } });
    await page.goto('/today.html');
    const band = page.locator('#money-due');
    await expect(band.locator('[data-bucket="paid"]')).toHaveText('$1,000 Paid (30 days)');
    await expect(band.locator('[data-bucket="upcoming"]')).toHaveText('$900 Upcoming');
  });
});

// ── the Invoices page ──
const LEVEL_CTX = { data: { ...STUDIO_CTX.data, is_agency: true, landing: '/agency.html', nav: STUDIO_LEVEL_NAV } };
const I = (n: number) => `eeeeeeee-1111-4000-8000-00000000000${n}`;
const book = (n: number, label: string, title: string, amount: number, over: Record<string, unknown> = {}) => ({ id: I(n), number_label: label, title, amount_cents: amount, status: 'paid', state: 'paid', due_date: null, issued_at: '2026-11-01T12:00:00Z', paid_at: '2026-11-08T17:00:00Z', paid_method: '', processing: false, payment_for: null, deal_id: null, business: 'Harbor Dental', person: 'Ivy Chen', refunded_cents: 0, dispute_status: null, ...over });
test.describe('the Invoices page', () => {
  test('each reads as what it is, and Paid this month counts what was kept', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': LEVEL_CTX, '/sales/invoices': { data: { today: '2026-11-16', partial: false, items: [
      book(1, '#0013', 'Website build', 100000, { refunded_cents: 100000, state: 'refunded' }),
      book(2, '#0014', 'Logo set', 50000, { refunded_cents: 20000 }),
      book(3, '#0015', 'Hosting year', 30000, { dispute_status: 'open', state: 'disputed' }),
      book(4, '#0016', 'Photo shoot', 40000, { dispute_status: 'lost', state: 'lost' }),
    ] } } } });
    await page.goto('/invoices.html');
    await expect(page.locator('.tot').nth(2).locator('.v')).toHaveText('$300');   // Paid this month: only the $300 kept of the Logo set
    await expect(page.locator('.tot').nth(2).locator('.s')).toContainText('1 payment');
    const phone = (page.viewportSize()?.width || 1200) < 768;
    const item = (label: string) => page.locator(phone ? '.card' : 'tbody tr:not(.part)', { hasText: label });
    await expect(item('#0013').locator('.st')).toHaveText('Refunded');
    await expect(item('#0014').locator('.st')).toHaveText(['Paid Nov 8', '$200 refunded']);
    await expect(item('#0015').locator('.st')).toHaveText('Disputed');
    await expect(item('#0016').locator('.st')).toHaveText('Dispute lost');
    await settled(page);
  });
});
