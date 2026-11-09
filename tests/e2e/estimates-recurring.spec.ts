import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp } from './helpers/app';

// Sales review item 47 (Nov 2026): estimates and recurring invoices, as Eric chose
// them on Nov 8. On the deal's Billing tab: an Estimates section (a price before
// anything is agreed; Turn into a proposal / Bill it as an invoice once they
// approve) and a Recurring invoice section under the retainer (Start, then Skip
// this one · Change · Pause · Resume · Stop). On sign.html: the client's estimate
// page — the lines, the total, "Nothing is charged", Approve or Not now with a note.
// Hermetic; every name, address and amount is made up.

const DEAL = '22222222-2222-4222-8222-222222222222';
const EST = '33333333-3333-4333-8333-333333333333';
const REC = '44444444-4444-4444-8444-444444444444';
const past = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
const ahead = (d: number) => new Date(Date.now() + d * 86400000).toISOString();
const LINES = [{ label: 'Homepage refresh', qty: 1, unit_cents: 90000 }, { label: 'Menu page', qty: 2, unit_cents: 20000 }, { __meta__: { discount: { mode: 'percent', value: 10 } } }];
const ESTIMATE = { id: EST, title: 'Spring refresh', line_items: LINES, subtotal_cents: 130000, currency: 'usd', terms: '', status: 'approved', sent_at: past(3), expires_at: ahead(27), first_viewed_at: past(2), decided_at: past(1), decided_note: 'Can we start in May?', proposal_id: null, invoice_id: null, total_cents: 117000 };
const SCHEDULE = { id: REC, title: 'Website care', amount_cents: 50000, currency: 'usd', every: 'month', anchor_day: 1, next_on: '2026-12-01', due_days: 14, times: null, sent_count: 2, status: 'active', paused_reason: '', created_at: past(60), updated_at: past(1) };

function dealApi(over: { estimates?: unknown[]; recurring?: unknown[]; proposals?: unknown[]; olderServer?: boolean } = {}) {
  return {
    '/sales/deals': { data: [{ id: DEAL, title: 'Blue Finch Café website', stage: 'won', source: 'manual', expected_value_cents: 117000, expected_close: null, contact_id: 'ct-1', converted_client_id: null, updated_at: past(1), next_step: null, next_step_at: null, last_contacted_at: null, agreement_signed: false }] },
    [`/sales/deals/${DEAL}`]: { data: {
      deal: { id: DEAL, title: 'Blue Finch Café website', stage: 'qualified', expected_value_cents: 117000, expected_close: null, next_step: null, next_step_at: null, notes: '', contact_id: 'ct-1', converted_client_id: null, retainer: null },
      contact: { id: 'ct-1', name: 'Riley Park', email: 'riley@example.org', phone: '', company: 'Blue Finch Café', notes: '' },
      proposals: over.proposals || [], contracts: [], events: [], invoices: [], last_contacted_at: null, timeline: [],
      ...(over.olderServer ? {} : { estimates: over.estimates ?? [ESTIMATE], recurring: over.recurring ?? [] }),
    } },
    [`/sales/deals/${DEAL}/tasks`]: { data: [] },
    '/sales/summary': { data: { total: 1, open: { count: 1, value_cents: 117000 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 }, by_stage: [] } },
    '/sales/contacts': { data: [{ id: 'ct-1', name: 'Riley Park', email: 'riley@example.org', phone: '', company: 'Blue Finch Café', updated_at: past(1) }] },
    '/sales/templates': { data: [] },
    '/sales/services': { data: [] },
    '/sales/receivables': { data: { items: [], total_cents: 0 } },
    '/identity': { data: { business_name: 'Example Studio' } },
  };
}
/** Record every write the page sends under /sales/estimates, /sales/recurring and the deal's two new routes. */
async function recordWrites(page: Page) {
  const writes: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
  await page.route(/\/functions\/v1\/presence\/sales\/(estimates|recurring|deals\/[0-9a-f-]{36}\/(estimates|recurring))/, async (route) => {
    const r = route.request();
    if (r.method() === 'GET') return route.fallback();
    const path = new URL(r.url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
    writes.push({ method: r.method(), path, body: JSON.parse(r.postData() || '{}') });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { id: EST, next_on: '2027-01-01' }, url: 'https://app.example.com/sign.html?t=abc' }) });
  });
  return writes;
}
const billing = (page: Page) => page.goto(`/pipeline.html?deal=${DEAL}&dtab=billing`);

test.describe('Deals — estimates (item 47)', () => {
  test('an approved estimate: its total, their note, and Turn into a proposal as the main button', async ({ page }) => {
    await installApp(page, { api: dealApi() });
    const writes = await recordWrites(page);
    await billing(page);
    const sec = page.locator('#estSec');
    await expect(sec.getByRole('heading', { name: 'Estimates' })).toBeVisible();
    const row = sec.locator(`[data-est="${EST}"]`);
    await expect(row).toContainText('Spring refresh — $1,170');
    await expect(row).toContainText('Approved ✓');
    await expect(row).toContainText('Their note: “Can we start in May?”');
    const turn = row.getByRole('button', { name: 'Turn into a proposal' });
    await expect(turn).toHaveClass(/^btn$/);   // the one main money step on the tab: no proposal yet
    await expect(row.getByRole('button', { name: 'Bill it as an invoice' })).toHaveClass(/ghost/);
    await turn.click();
    await expect.poll(() => writes.map((w) => `${w.method} ${w.path}`)).toEqual([`POST /sales/estimates/${EST}/proposal`]);
    await expect(page.getByText('Proposal drafted from the estimate')).toBeVisible();
  });

  test('Bill it as an invoice makes a draft invoice (nothing is sent)', async ({ page }) => {
    await installApp(page, { api: dealApi() });
    const writes = await recordWrites(page);
    await billing(page);
    await page.locator(`[data-est="${EST}"]`).getByRole('button', { name: 'Bill it as an invoice' }).click();
    await expect.poll(() => writes.map((w) => `${w.method} ${w.path}`)).toEqual([`POST /sales/estimates/${EST}/invoice`]);
    await expect(page.getByText('press Send on it when you’re ready')).toBeVisible();
  });

  test('+ Estimate opens the line editor and saves a draft to the estimates route', async ({ page }) => {
    await installApp(page, { api: dealApi({ estimates: [] }) });
    const writes = await recordWrites(page);
    await billing(page);
    const sec = page.locator('#estSec');
    await expect(sec).toContainText('A price before anything is agreed. They can approve it or say not now — nothing is charged.');
    await sec.getByRole('button', { name: '+ Estimate' }).click();
    const form = page.locator('#estForm');
    await expect(form).toContainText('They’ll see each line and the total, with Approve or Not now.');
    await form.getByLabel('Line item').first().fill('Logo touch-up');
    await form.getByLabel('Price each in dollars').first().fill('350');
    await form.getByRole('button', { name: 'Save draft' }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].method + ' ' + writes[0].path).toBe(`POST /sales/deals/${DEAL}/estimates`);
    expect(writes[0].body.line_items).toEqual([{ label: 'Logo touch-up', qty: 1, unit_cents: 35000 }]);
    await expect(page.getByText('Estimate saved as a draft')).toBeVisible();
    await expect(page.locator('#propForm')).toBeEmpty();   // one editor at a time
  });

  test('a draft: Send it, or remove it (after a confirm)', async ({ page }) => {
    await installApp(page, { api: dealApi({ estimates: [{ ...ESTIMATE, status: 'draft', sent_at: null, expires_at: null, first_viewed_at: null, decided_at: null, decided_note: '' }] }) });
    const writes = await recordWrites(page);
    page.on('dialog', (d) => d.accept());
    await billing(page);
    const row = page.locator(`[data-est="${EST}"]`);
    await expect(row).toContainText('Draft — not sent yet');
    await expect(row.getByRole('button', { name: 'Turn into a proposal' })).toHaveCount(0);
    await row.getByRole('button', { name: /^Send to Riley Park/ }).click();
    await expect.poll(() => writes.map((w) => `${w.method} ${w.path}`)).toEqual([`POST /sales/estimates/${EST}/send`]);
    await row.getByRole('button', { name: 'Delete draft estimate Spring refresh' }).click();
    await expect.poll(() => writes.map((w) => `${w.method} ${w.path}`)).toEqual([`POST /sales/estimates/${EST}/send`, `DELETE /sales/estimates/${EST}`]);
  });

  test('a sent one: opened, good until, and Copy link', async ({ page }) => {
    await installApp(page, { api: dealApi({ estimates: [{ ...ESTIMATE, status: 'sent', decided_at: null, decided_note: '' }] }) });
    await billing(page);
    const row = page.locator(`[data-est="${EST}"]`);
    await expect(row).toContainText('Sent — waiting for their answer');
    await expect(row).toContainText('Opened');
    await expect(row).toContainText('Good until');
    await expect(row.getByRole('button', { name: 'Copy link' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Turn into a proposal' })).toBeVisible();   // works before they answer too
  });
});

test('an older server (no estimates or recurring invoices in the deal read): neither section shows', async ({ page }) => {
  // the page goes live on merge, the server on its own deploy — no dead buttons in between
  await installApp(page, { api: dealApi({ olderServer: true }) });
  await billing(page);
  await expect(page.locator('.sec h3', { hasText: 'Proposals' })).toBeVisible();
  await expect(page.locator('#estSec')).toHaveCount(0);
  await expect(page.locator('#recSec')).toHaveCount(0);
});

test.describe('Deals — recurring invoices (item 47)', () => {
  test('set one up: what it\'s for, amount, how often, first date, how many times → Start', async ({ page }) => {
    await installApp(page, { api: dealApi({ estimates: [] }) });
    const writes = await recordWrites(page);
    await billing(page);
    const sec = page.locator('#recSec');
    await expect(sec).toContainText('Send them a fresh invoice on a schedule — they pay each one themselves');
    await sec.getByRole('button', { name: 'Set up a recurring invoice' }).click();
    await sec.getByLabel('What it’s for').fill('Website care');
    await sec.getByLabel('Amount (USD)').fill('500');
    await sec.getByLabel('How often').selectOption('quarter');
    await sec.getByLabel('First invoice goes out on').fill('2026-12-15');
    await sec.getByLabel('How many times').fill('4');
    await expect(sec).toContainText('If the first date is today, it goes out right away.');
    await sec.getByRole('button', { name: 'Start' }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].method + ' ' + writes[0].path).toBe(`POST /sales/deals/${DEAL}/recurring`);
    expect(writes[0].body).toEqual({ title: 'Website care', amount_cents: 50000, every: 'quarter', first_on: '2026-12-15', times: 4 });
  });

  test('a running one says when the next goes; Skip this one, Pause and Stop call their routes', async ({ page }) => {
    await installApp(page, { api: dealApi({ estimates: [], recurring: [SCHEDULE] }) });
    const writes = await recordWrites(page);
    const asked: string[] = [];
    page.on('dialog', (d) => { asked.push(d.message()); d.accept(); });
    await billing(page);
    const row = page.locator(`[data-rec="${REC}"]`);
    await expect(row).toContainText('Website care — $500 every month · Next invoice: Dec 1, 2026 · 2 sent');
    await row.getByRole('button', { name: 'Skip this one' }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(asked[0]).toContain('Skip the Dec 1, 2026 invoice?');
    await row.getByRole('button', { name: 'Pause' }).click();
    await expect.poll(() => writes.length).toBe(2);
    await row.getByRole('button', { name: 'Stop the recurring invoice Website care' }).click();
    await expect.poll(() => writes.length).toBe(3);
    expect(asked[asked.length - 1]).toContain('No more invoices go out');
    expect(writes.map((w) => `${w.method} ${w.path}`)).toEqual([`POST /sales/recurring/${REC}/skip`, `POST /sales/recurring/${REC}/pause`, `POST /sales/recurring/${REC}/stop`]);
    // the Money card on Overview says it too
    await page.goto(`/pipeline.html?deal=${DEAL}`);
    await expect(page.getByText('Recurring invoice $500 every month · next Dec 1, 2026')).toBeVisible();
  });

  test('Change sends only what changed', async ({ page }) => {
    await installApp(page, { api: dealApi({ estimates: [], recurring: [SCHEDULE] }) });
    const writes = await recordWrites(page);
    await billing(page);
    await page.locator(`[data-rec="${REC}"]`).getByRole('button', { name: 'Change' }).click();
    const sec = page.locator('#recSec');
    await sec.getByLabel('Amount (USD)').fill('600');
    await sec.getByRole('button', { name: 'Save changes' }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toEqual({ method: 'PATCH', path: `/sales/recurring/${REC}`, body: { amount_cents: 60000 } });
  });

  test('a paused one says why, and offers Resume (which says when the next one goes)', async ({ page }) => {
    await installApp(page, { api: dealApi({ estimates: [], recurring: [{ ...SCHEDULE, status: 'paused', paused_reason: 'unpaid', next_on: '2026-01-01' }] }) });
    const writes = await recordWrites(page);
    const asked: string[] = [];
    page.on('dialog', (d) => { asked.push(d.message()); d.accept(); });
    await billing(page);
    const row = page.locator(`[data-rec="${REC}"]`);
    await expect(row).toContainText('Paused — the last two invoices are still unpaid');
    await expect(row.getByRole('button', { name: 'Skip this one' })).toHaveCount(0);
    await row.getByRole('button', { name: 'Resume' }).click();
    await expect.poll(() => writes.map((w) => w.path)).toEqual([`/sales/recurring/${REC}/resume`]);
    expect(asked[0]).toContain('The next one goes out today.');
  });
});

// ── the client's estimate page (sign.html) ───────────────────────────────────
const TOKEN = 'ZXN0aW1hdGU.def456';
const PAGE_EST = { kind: 'estimate', brand: { name: 'Example Studio', accent: '#5b3fa0' }, id: EST, title: 'Spring refresh', line_items: LINES, subtotal_cents: 130000, currency: 'usd', terms: 'Photos supplied by you.', status: 'sent', expires_at: '2026-12-31T00:00:00.000Z', decided_at: null, decided_note: '', expired: false };
async function serveEstimate(page: Page, data: Record<string, unknown>) {
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

test.describe('The client\'s estimate page (item 47)', () => {
  test('the lines, the total, nothing is charged, and Approve with a note', async ({ page }) => {
    const posts = await serveEstimate(page, PAGE_EST);
    await page.goto(`/sign.html?t=${TOKEN}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Spring refresh' })).toBeVisible();
    await expect(page.getByText('Prepared by Example Studio')).toBeVisible();
    await expect(page.getByText('This is an estimate — a price before anything is agreed. Nothing is charged.')).toBeVisible();
    await expect(page.locator('tr.total')).toContainText('$1,170.00');
    await expect(page.getByText('Discount (10%)')).toBeVisible();
    await expect(page.getByText('Good until December 31, 2026.', { exact: false })).toBeVisible();
    await expect(page).toHaveTitle('Your estimate — Example Studio');
    await page.getByLabel('Anything you’d like to add? (optional)').fill('Can we start in May?');
    await page.getByRole('button', { name: 'Approve this estimate' }).click();
    await expect(page.getByRole('heading', { name: 'Approved — thank you!' })).toBeVisible();
    expect(posts).toEqual([{ path: `/sales/estimates/${EST}/decide`, body: { token: TOKEN, decision: 'approved', note: 'Can we start in May?' } }]);
  });

  test('Not now takes two taps', async ({ page }) => {
    const posts = await serveEstimate(page, PAGE_EST);
    await page.goto(`/sign.html?t=${TOKEN}`);
    const nn = page.getByRole('button', { name: 'Not now' });
    await nn.click();
    await expect(page.getByRole('button', { name: 'Tap again to say not now' })).toBeVisible();
    expect(posts).toEqual([]);
    await page.getByRole('button', { name: 'Tap again to say not now' }).click();
    await expect(page.getByRole('heading', { name: 'Thanks for letting us know.' })).toBeVisible();
    expect(posts.map((p) => p.body.decision)).toEqual(['declined']);
  });

  test('an answered or expired estimate offers no buttons', async ({ page }) => {
    await serveEstimate(page, { ...PAGE_EST, status: 'approved' });
    await page.goto(`/sign.html?t=${TOKEN}`);
    await expect(page.getByText('You approved this estimate — your studio has been told.')).toBeVisible();
    await expect(page.getByRole('button')).toHaveCount(0);
    await page.unroute('**/functions/v1/presence/**');
    await serveEstimate(page, { ...PAGE_EST, expired: true });
    await page.goto(`/sign.html?t=${TOKEN}`);
    await expect(page.getByText('This estimate has expired — ask your studio for an updated one.')).toBeVisible();
    await expect(page.getByRole('button')).toHaveCount(0);
  });

  test('no serious or critical accessibility problems', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'axe once, on desktop');
    await serveEstimate(page, PAGE_EST);
    await page.goto(`/sign.html?t=${TOKEN}`);
    await expect(page.getByRole('button', { name: 'Approve this estimate' })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(serious.map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);
  });
});
