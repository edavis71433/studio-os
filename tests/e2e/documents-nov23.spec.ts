import { test, expect, type Page } from '@playwright/test';
import { installApp, onAsk } from './helpers/app';
import { pinClock, PINNED_NOW, daysFrom } from './helpers/clock';

// Sales items 181 to 185 (Nov 22 2026 review), the page halves (the server halves are in
// tests/presence/documents_nov23_test.mjs):
//   181  Take it back on a sent agreement; its unpaid deposit is voided only after asking
//   182  a deal closed as Not a fit folds its makers under "Reopen this deal"; Withdrawn reads so
//   183  estimates get Edit and Revise; Not now can become a yes; Approve takes a typed name
//   184  the client's yes takes a typed name
//   185  halves and quarters: 2.5 stays 2.5, and 1.3 is refused out loud
// Every name, address and amount is made up.

const DEAL = '22222222-2222-4222-8222-222222222222';
const EST = '33333333-3333-4333-8333-333333333333';
const CON = '55555555-5555-4555-8555-555555555555';
const PROP = '66666666-6666-4666-8666-666666666666';
const DEP = '77777777-7777-4777-8777-777777777777';
const TOKEN = 'tok.abc';
const at = (d: number) => daysFrom(PINNED_NOW, d);
const LINES = [{ label: 'Design hours', qty: 2.5, unit_cents: 10000 }];
const est = (over: Record<string, unknown> = {}) => ({ id: EST, title: 'Spring refresh', line_items: LINES, subtotal_cents: 25000, total_cents: 25000, currency: 'usd', terms: '', status: 'draft', version: 1, sent_at: null, expires_at: null, first_viewed_at: null, decided_at: null, decided_note: '', decided_name: '', proposal_id: null, invoice_id: null, ...over });

function dealApi(over: { stage?: string; estimates?: unknown[]; proposals?: unknown[]; contracts?: unknown[]; invoices?: unknown[] } = {}) {
  const stage = over.stage || 'contract';
  return {
    '/sales/deals': { data: [{ id: DEAL, title: 'Blue Finch Café website', stage, source: 'manual', expected_value_cents: 250000, expected_close: null, contact_id: 'ct-1', converted_client_id: null, updated_at: at(-1), next_step: null, next_step_at: null }] },
    [`/sales/deals/${DEAL}`]: { data: {
      deal: { id: DEAL, title: 'Blue Finch Café website', stage, expected_value_cents: 250000, expected_close: null, next_step: null, next_step_at: null, notes: '', contact_id: 'ct-1', converted_client_id: null, retainer: null, lost_reason: stage === 'lost' ? 'Price' : '' },
      contact: { id: 'ct-1', name: 'Riley Park', email: 'riley@example.org', phone: '', company: 'Blue Finch Café', notes: '' },
      proposals: over.proposals || [], contracts: over.contracts || [], events: [], invoices: over.invoices || [], last_contacted_at: null, timeline: [],
      estimates: over.estimates ?? [], recurring: [],
    } },
    [`/sales/deals/${DEAL}/tasks`]: { data: [] },
    '/sales/summary': { data: { total: 1, open: { count: 1, value_cents: 250000 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 }, by_stage: [] } },
    '/sales/contacts': { data: [{ id: 'ct-1', name: 'Riley Park', email: 'riley@example.org', phone: '', company: 'Blue Finch Café', updated_at: at(-1) }] },
    '/sales/templates': { data: [] },
    '/sales/services': { data: [] },
    '/sales/receivables': { data: { items: [], total_cents: 0 } },
    '/identity': { data: { business_name: 'Example Studio' } },
  };
}
type Write = { method: string; path: string; body: Record<string, unknown> };
/** Record (and answer) the writes under the given paths; reads go on to the fixtures. */
async function recordWrites(page: Page, match: RegExp, answer: (w: Write) => unknown = () => ({ data: { id: EST } })) {
  const writes: Write[] = [];
  await page.route((u) => u.pathname.includes('/functions/v1/presence/') && match.test(u.pathname), async (route) => {
    const r = route.request();
    if (r.method() === 'GET') return route.fallback();
    const w = { method: r.method(), path: new URL(r.url()).pathname.replace(/^.*\/functions\/v1\/presence/, ''), body: JSON.parse(r.postData() || '{}') };
    writes.push(w);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer(w)) });
  });
  return writes;
}
const billing = (page: Page) => page.goto(`/pipeline.html?deal=${DEAL}&dtab=billing`);
const PATIENT = { timeout: 20_000 };

test.describe('Deals: the documents job (items 181, 182, 183, 185)', () => {
  test('181: Take it back on a sent agreement, then the deposit only if they say so', async ({ page }) => {
    await pinClock(page);
    await installApp(page, { api: dealApi({ contracts: [{ id: CON, title: 'Service agreement', body: 'We build the site.', status: 'sent', signer_name: '', signed_at: null, version: 1, terms_snapshot: {} }], invoices: [{ id: DEP, title: 'Deposit', amount_cents: 125000, purpose: 'deposit', status: 'open', stripe_url: 'https://pay.example/x', due_date: null, paid_at: null, created_at: at(-1), state: 'open' }] }) });
    const writes = await recordWrites(page, /\/sales\/(contracts\/[0-9a-f-]{36}\/withdraw|invoices\/[0-9a-f-]{36}\/void)$/, (w) => (w.path.endsWith('/withdraw') ? { data: { id: CON, status: 'voided' }, open_deposit: { id: DEP, amount_cents: 125000 } } : { data: { ok: true } }));
    const asked: string[] = [];
    await onAsk(page, (q) => { asked.push(q); return true; });
    await billing(page);
    const take = page.getByRole('button', { name: 'Take it back' });
    await expect(take).toBeVisible();
    await take.click();
    await expect.poll(() => writes.map((w) => `${w.method} ${w.path}`), PATIENT).toEqual([`POST /sales/contracts/${CON}/withdraw`, `POST /sales/invoices/${DEP}/void`]);
    expect(asked[0]).toContain('Take this agreement back?');
    expect(asked[1]).toContain('unpaid $1,250 deposit request is still open. Void it too?');
  });

  test('181: keeping the deposit sends no void', async ({ page }) => {
    await pinClock(page);
    await installApp(page, { api: dealApi({ contracts: [{ id: CON, title: 'Service agreement', body: 'x', status: 'sent', signer_name: '', signed_at: null, version: 1, terms_snapshot: {} }] }) });
    const writes = await recordWrites(page, /\/sales\/(contracts\/[0-9a-f-]{36}\/withdraw|invoices\/[0-9a-f-]{36}\/void)$/, (w) => (w.path.endsWith('/withdraw') ? { data: { id: CON, status: 'voided' }, open_deposit: { id: DEP, amount_cents: 125000 } } : { data: { ok: true } }));
    let n = 0;
    await onAsk(page, () => (n++ === 0));   // yes to taking it back, no to the deposit
    await billing(page);
    await page.getByRole('button', { name: 'Take it back' }).click();
    await expect.poll(() => n, PATIENT).toBe(2);
    expect(writes.map((w) => w.path)).toEqual([`/sales/contracts/${CON}/withdraw`]);
  });

  test('182: a Not a fit deal folds its makers under Reopen this deal; withdrawn documents say so', async ({ page }) => {
    await pinClock(page);
    await installApp(page, { api: dealApi({ stage: 'lost',
      proposals: [{ id: PROP, title: 'Website', line_items: LINES, subtotal_cents: 25000, total_cents: 25000, status: 'withdrawn', version: 1, sent_at: at(-5), withdrawn_at: at(-1), withdrawn_why: 'not_a_fit' }],
      contracts: [{ id: CON, title: 'Service agreement', body: 'x', status: 'voided', signer_name: '', signed_at: null, version: 1, terms_snapshot: {}, withdrawn_at: at(-1), withdrawn_why: 'not_a_fit' }] }) });
    await billing(page);
    const fold = page.locator('#lostFold');
    await expect(fold).toContainText('Closed as Not a fit');
    await expect(fold.getByRole('button', { name: 'Reopen this deal' })).toBeVisible();
    for (const name of ['+ Estimate', '+ Proposal', '+ Agreement', 'Send an invoice', 'Set up a retainer']) await expect(page.getByRole('button', { name, exact: true })).toBeHidden();
    await expect(page.locator('#dpanel-billing')).toContainText('Withdrawn');
    await expect(page.getByRole('button', { name: 'Revise →' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Copy link' })).toHaveCount(0);
  });

  test('183, 185: Edit a draft estimate keeps 2.5 and saves in place; a sent one offers Revise', async ({ page }) => {
    await pinClock(page);
    await installApp(page, { api: dealApi({ stage: 'proposal', estimates: [est(), est({ id: '44444444-4444-4444-8444-444444444444', title: 'Logo', status: 'sent', sent_at: at(-1), expires_at: at(29) })] }) });
    const writes = await recordWrites(page, /\/sales\/estimates\/[0-9a-f-]{36}(\/revise)?$/);
    await billing(page);
    await page.locator(`[data-est="${EST}"]`).getByRole('button', { name: 'Edit' }).click();
    const form = page.locator('#estForm');
    await expect(form).toContainText('Changing the draft. Nothing has gone to them yet.');
    await expect(form.getByLabel('Quantity').first()).toHaveValue('2.5');
    await form.getByLabel('Quantity').first().fill('1.3');
    await form.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.locator('.dds-toast').filter({ hasText: 'a half or a quarter' })).toBeVisible();
    expect(writes).toEqual([]);
    await form.getByLabel('Quantity').first().fill('3.75');
    await form.getByRole('button', { name: 'Save changes' }).click();
    await expect.poll(() => writes.map((w) => `${w.method} ${w.path}`), PATIENT).toEqual([`PATCH /sales/estimates/${EST}`]);
    expect(writes[0].body.line_items).toEqual([{ label: 'Design hours', qty: 3.75, unit_cents: 10000 }]);
    await expect(page.locator('[data-est="44444444-4444-4444-8444-444444444444"]').getByRole('button', { name: 'Revise →' })).toBeVisible();
  });
});

async function serveSign(page: Page, data: Record<string, unknown>) {
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  await page.route('**/functions/v1/presence/**', (route) => {
    const r = route.request();
    const path = new URL(r.url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
    if (r.method() === 'GET' && path.startsWith('/sales/p/')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
    if (r.method() === 'POST') { posts.push({ path, body: JSON.parse(r.postData() || '{}') }); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { status: 'approved' } }) }); }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
  return posts;
}
const BRAND = { name: 'Example Studio', accent: '#5b3fa0' };

test.describe('The client\'s page (items 181, 182, 183)', () => {
  test('183: a Not now can become a yes, with the name they type', async ({ page }) => {
    await pinClock(page);
    const posts = await serveSign(page, { kind: 'estimate', brand: BRAND, ...est({ status: 'declined', sent_at: at(-3), expires_at: at(27), decided_at: at(-1) }), expired: false, superseded: false });
    await page.goto(`/sign.html?t=${TOKEN}`);
    await expect(page.getByText('You said not now. Changed your mind? You can still approve it.')).toBeVisible();
    await page.getByRole('button', { name: 'Approve this estimate' }).click();
    await expect(page.locator('#softErr')).toHaveText('Type your full name first. That’s how you say yes.');
    expect(posts).toEqual([]);
    await page.getByLabel('Type your full name to approve').fill('Riley Park');
    await page.getByRole('button', { name: 'Approve this estimate' }).click();
    await expect.poll(() => posts, PATIENT).toEqual([{ path: `/sales/estimates/${EST}/decide`, body: { token: TOKEN, decision: 'approved', note: '', name: 'Riley Park' } }]);
  });

  test('181, 182, 183: a taken-back agreement, a closed deal and a replaced estimate offer nothing to answer', async ({ page }) => {
    await pinClock(page);
    await serveSign(page, { kind: 'contract', brand: BRAND, id: CON, title: 'Service agreement', body: 'x', content_hash: 'h', status: 'voided' });
    await page.goto(`/sign.html?t=${TOKEN}`);
    await expect(page.getByRole('heading', { name: 'Your studio is updating this agreement' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign the agreement' })).toHaveCount(0);
    await page.unroute('**/functions/v1/presence/**');
    await serveSign(page, { kind: 'flow', brand: BRAND, closed: true, deal: { id: DEAL, title: 'Blue Finch Café website' }, proposal: null, contract: null, deposit: null });
    await page.goto(`/sign.html?t=${TOKEN}`);
    await expect(page.getByRole('heading', { name: 'This is closed' })).toBeVisible();
    await expect(page.locator('#accept')).toHaveCount(0);
    await page.unroute('**/functions/v1/presence/**');
    await serveSign(page, { kind: 'estimate', brand: BRAND, ...est({ status: 'sent', sent_at: at(-3), expires_at: at(27) }), expired: false, superseded: true });
    await page.goto(`/sign.html?t=${TOKEN}`);
    await expect(page.getByText('Your studio sent a newer version of this estimate.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve this estimate' })).toHaveCount(0);
  });
});
