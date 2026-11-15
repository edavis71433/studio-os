import { test, expect, type Page, type Route } from '@playwright/test';
import { installApp } from './helpers/app';

// "The price is typed once and flows to the end", the page halves of
// tests/presence/sales_price_flow_test.mjs that pipeline.spec.ts and sign.spec.ts didn't
// already drive (builder item 212: behaviour, not text). The money-blank warning guards
// every way an agreement leaves the drawer; a signed deal's to-do presets fill the box and
// post nothing by themselves; the renewal hint says nothing is set until Save; and the
// client's page names its reload button and the signed copy's fingerprint.
//
// Every write the pages send is answered by a route this file registers on purpose and
// recorded; anything else is refused with a 599 so a stray write fails the test.

const DEAL = '77777777-7777-4777-8777-777777777777';
const past = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
const STAGES = { data: {
  labels: { lead: 'New lead', qualified: 'Qualified', proposal: 'Proposal sent', contract: 'Agreement out', won: 'Won', lost: 'Not a fit' }, custom: {},
  chances: { lead: 10, qualified: 25, proposal: 50, contract: 75, won: 100, lost: 0 },
} };
const CONTACT = { id: 'ct-1', name: 'Sam Rivera', email: 'sam@example.com', phone: '', company: 'Acme', notes: '' };
const dealWith = (deal: Record<string, unknown>, more: Record<string, unknown> = {}) => ({ data: {
  deal: { id: DEAL, title: 'Marlow rebuild', stage: 'contract', expected_value_cents: 500000, expected_close: null, next_step: null, next_step_at: null, notes: '', contact_id: 'ct-1', converted_client_id: null, retainer: null, ...deal },
  contact: CONTACT, proposals: [], contracts: [], events: [], timeline: [], invoices: [], last_contacted_at: null, ...more,
} });
const api = (detail: unknown) => ({
  '/sales/deals': { data: [{ id: DEAL, title: 'Marlow rebuild', stage: 'contract', expected_value_cents: 500000, contact_id: 'ct-1', updated_at: past(1), agreement_signed: false }] },
  [`/sales/deals/${DEAL}`]: detail,
  [`/sales/deals/${DEAL}/tasks`]: { data: [] },
  '/sales/stages': STAGES,
  '/sales/summary': { data: { total: 1, open: { count: 1, value_cents: 500000 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 }, by_stage: [], ar: {} } },
  '/sales/contacts': { data: [{ ...CONTACT, updated_at: past(1) }] },
  '/sales/templates': { data: [] },
  '/sales/services': { data: [] },
  '/sales/receivables': { data: { items: [], total_cents: 0 } },
  '/identity': { data: { business_name: 'Test Studio' } },
});
const SIGNED = { id: 'k-sg', title: 'Service agreement', status: 'signed', signer_name: 'Sam Rivera', signed_at: '2026-07-15T10:00:00.000Z', version: 1, terms_snapshot: null, body: 'A non-refundable deposit of 50% of the total project fee is due before work begins.' };
const MONEY_BLANKS = 'Project fee: [project fee]. A deposit of [50% deposit] is due at signing; [50% balance] before launch.';

type Write = { method: string; path: string; body: unknown };
/** Answers the writes this test plans ("METHOD /path" → reply) and records every write; GETs fall through to the fixtures. */
async function writesTo(page: Page, plan: Record<string, () => { status: number; json: unknown }> = {}) {
  const seen: Write[] = [];
  await page.route('**/functions/v1/presence/**', async (route: Route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fallback();
    const path = new URL(req.url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
    let body: unknown = null; try { body = req.postDataJSON(); } catch { body = null; }
    seen.push({ method: req.method(), path, body });
    const answer = plan[`${req.method()} ${path}`];
    const r = answer ? answer() : { status: 599, json: { error: 'unplanned_write', message: `This test did not plan ${req.method()} ${path}` } };
    return route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.json) });
  });
  return seen;
}
const conBody = (page: Page) => page.locator('#conForm textarea');

test.describe('deal drawer: the money-blank warning on every way out', () => {
  test('Save & send for signature with money blanks asks first; declining saves and sends nothing', async ({ page }) => {
    await installApp(page, { api: api(dealWith({ expected_value_cents: 0 })) });
    const seen = await writesTo(page, {
      [`POST /sales/deals/${DEAL}/contracts`]: () => ({ status: 201, json: { data: { id: 'k-new', status: 'draft' } } }),
      'POST /sales/contracts/k-new/send': () => ({ status: 200, json: { data: { id: 'k-new', status: 'sent' }, url: 'https://example.test/sign.html?t=x', emailed: true, deposit: { minted: false, warning: 'no_value' } } }),
    });
    await page.goto(`/pipeline.html?deal=${DEAL}&dtab=billing`);
    await page.locator('#addCon').click();
    await expect.poll(async () => (await conBody(page).inputValue()).length, { timeout: 7000 }).toBeGreaterThan(1000);   // the package seeds itself first
    await conBody(page).fill(MONEY_BLANKS);
    let msg = '';
    page.once('dialog', (d) => { msg = d.message(); d.dismiss(); });
    await page.locator('#conForm .row2 .btn:not(.ghost)').click();                      // Save & send for signature →
    await expect(page.locator('.dds-toast')).toContainText('Not sent — set the deal value in Details first.');
    expect(msg).toContain('the deal has no value set');
    expect(msg).toContain('the deposit request will make itself when you send');
    expect(seen).toEqual([]);                                                           // not even saved as a draft
    await expect(conBody(page)).toHaveValue(MONEY_BLANKS);                               // the form is as he left it
    // it warns, it never blocks: yes saves the draft, then sends it
    page.once('dialog', (d) => d.accept());
    await page.locator('#conForm .row2 .btn:not(.ghost)').click();
    await expect.poll(() => seen.map((w) => `${w.method} ${w.path}`)).toEqual([`POST /sales/deals/${DEAL}/contracts`, 'POST /sales/contracts/k-new/send']);
    expect(seen[0].body).toMatchObject({ body: MONEY_BLANKS });
  });

  test('the one "Send proposal & agreement" asks about money blanks too; declining sends nothing', async ({ page }) => {
    await installApp(page, { api: api(dealWith({ stage: 'qualified', expected_value_cents: 0 }, {
      proposals: [{ id: 'p-b', title: 'Website build', status: 'draft', version: 1, line_items: [{ label: 'Build', qty: 1, unit_cents: 500000 }], first_viewed_at: null, expires_at: null }],
      contracts: [{ id: 'k-b', title: 'Service agreement', status: 'draft', signer_name: null, signed_at: null, version: 1, terms_snapshot: null, body: MONEY_BLANKS }],
    })) });
    const seen = await writesTo(page);
    await page.goto(`/pipeline.html?deal=${DEAL}&dtab=billing`);
    let msg = '';
    page.once('dialog', (d) => { msg = d.message(); d.dismiss(); });
    await page.locator('#sendBothBtn').click();
    await expect(page.locator('.dds-toast')).toContainText('Not sent — set the deal value in Details first.');
    expect(msg).toContain('the deal has no value set');
    expect(seen).toEqual([]);
  });
});

test.describe('deal drawer: a signed deal and its renewal', () => {
  test('a signed deal’s to-do presets fill the to-do box, and nothing is added until Add', async ({ page }) => {
    await installApp(page, { api: api(dealWith({}, { contracts: [SIGNED] })) });
    const seen = await writesTo(page, { [`POST /sales/deals/${DEAL}/tasks`]: () => ({ status: 201, json: { data: { id: 't-1' } } }) });
    await page.goto(`/pipeline.html?deal=${DEAL}`);
    const preset = page.locator('#dt-preset');
    await expect(preset.locator('option')).toHaveText(['Pick a to-do for this stage…', 'Convert them to a customer', 'Request the deposit', 'Book the kickoff call', 'Something else…']);
    await preset.selectOption({ label: 'Convert them to a customer' });
    await expect(page.locator('#dt-title')).toHaveValue('Convert them to a customer');
    await expect(page.locator('#dt-title')).toBeFocused();
    expect(seen).toEqual([]);                                                           // a preset only fills the box
    await page.locator('#dt-add').click();
    await expect.poll(() => seen).toEqual([{ method: 'POST', path: `/sales/deals/${DEAL}/tasks`, body: { title: 'Convert them to a customer' } }]);
  });

  test('the renewal hint says the date is only filled in, and nothing is set until Save', async ({ page }) => {
    await installApp(page, { api: api(dealWith({}, { contracts: [{ ...SIGNED, body: 'This engagement is a 12-month term beginning at signing. A 50% deposit is due.' }] })) });
    const seen = await writesTo(page);
    await page.goto(`/pipeline.html?deal=${DEAL}&dtab=billing`);
    await expect(page.locator('#detailInner')).toContainText('No renewal date — the renewal reminder can’t arm. This agreement reads as a 12-month term, so 2027-07-15 is filled in below — press Save to confirm it (nothing is set until you do).');
    await expect(page.locator('#con-term-k-sg')).toHaveValue('2027-07-15');
    expect(seen).toEqual([]);
  });
});

test.describe('sign.html: the words a client acts on', () => {
  const TOKEN = 'Zmxvdw.abc123';
  const HASH = 'ab'.repeat(32);
  const PROPOSAL = { id: 'p-1', title: 'Website build', line_items: [{ label: 'Build', qty: 1, unit_cents: 500000 }], subtotal_cents: 500000, currency: 'usd', terms: '', status: 'accepted', expired: false };
  const AGREEMENT = { id: 'k-1', title: 'Service agreement', body: 'A deposit of 50% of the project fee is due at signing.', content_hash: HASH, status: 'sent', signed_at: null, signer_name: null };
  const flow = (contract: Record<string, unknown>, deposit: unknown) => ({ data: { kind: 'flow', brand: { name: 'Test Studio', accent: '#5b3fa0' }, deal: { id: 'd-1', title: 'Acme website' }, proposal: PROPOSAL, contract, contract_pending: false, deposit } });
  async function page_(page: Page, view: unknown, sign?: { status: number; json: unknown }) {
    const posts: Write[] = [];
    await page.route('**/functions/v1/presence/**', (route) => {
      const req = route.request(); const path = new URL(req.url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
      if (req.method() === 'GET' && path.startsWith('/sales/p/')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(view) });
      posts.push({ method: req.method(), path, body: req.postDataJSON() });
      if (sign && req.method() === 'POST' && path === '/sales/contracts/k-1/sign') return route.fulfill({ status: sign.status, contentType: 'application/json', body: JSON.stringify(sign.json) });
      return route.fulfill({ status: 599, contentType: 'application/json', body: JSON.stringify({ error: 'unplanned_write' }) });
    });
    await page.goto(`/sign.html?t=${TOKEN}`);
    return posts;
  }

  test('the stale-version button says "Load the latest version", and the signed copy names its fingerprint', async ({ page }) => {
    const posts = await page_(page, flow(AGREEMENT, { amount_cents: 250000, status: 'open', paid_at: null, url: null }),
      { status: 409, json: { error: 'version_mismatch', message: 'This agreement was updated — please reload the latest version before signing.' } });
    await page.locator('#nm').fill('Sam Rivera');
    await page.locator('#em').fill('sam@example.com');
    await page.locator('#sign').click();
    await expect(page.locator('#reloadBtn')).toHaveText('Load the latest version');
    expect(posts).toEqual([{ method: 'POST', path: '/sales/contracts/k-1/sign', body: { token: TOKEN, signer_name: 'Sam Rivera', signer_email: 'sam@example.com', presented_hash: HASH } }]);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page_(page, flow({ ...AGREEMENT, status: 'signed', signed_at: '2026-07-15T10:00:00.000Z', signer_name: 'Sam Rivera' }, { amount_cents: 250000, status: 'paid', paid_at: '2026-07-16T10:00:00.000Z', url: null }));
    await page.locator('details#step-sign summary').click();
    const print = page.locator('details#step-sign .kv').filter({ hasText: 'Document fingerprint' });
    await expect(print).toHaveCount(1);
    await expect(print.locator('.mono')).toHaveText(HASH);
  });
});
