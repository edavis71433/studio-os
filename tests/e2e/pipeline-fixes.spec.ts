import { test, expect, type Page, type Locator } from '@playwright/test';
import { installApp } from './helpers/app';
import { installIosFocusSemantics } from './helpers/ios-focus';

// Nov 10 bug hunt, Pipeline (B7 · B8 · B13 · B14 · B19 · B20 and the small ones):
//   B20 "5k" is $5,000 (it was saved as $5)
//   B19 a half-typed "+ Add a deal" survives a redraw (search, a chip, a move)
//   B13 a move on the board repaints the open preview of the same deal
//   B21 a double click on a Move option sends one stage change; the New deal dialog
//       reuses the contact it made when the deal then failed
//   B8  the first service chip takes the place of the deal's own pre-filled line
//   B7  a proposal whose email failed is left as ONE draft on the deal
//   B14 "Won this month" is the local month (and the summary is asked for it)
// Every name below is made up.

const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();
const D1 = '11111111-1111-4111-8111-1111111111d1';
const D2 = '22222222-2222-4222-8222-2222222222d2';
const D3 = '33333333-3333-4333-8333-3333333333d3';
const DEALS = [
  { id: D1, title: 'Blue Finch — site', stage: 'lead', contact_id: 'c1', expected_value_cents: 250000, source: 'manual', created_at: ago(4), updated_at: ago(1) },
  { id: D2, title: 'Harbor Lane — logo', stage: 'qualified', contact_id: 'c2', expected_value_cents: 90000, source: 'manual', created_at: ago(3), updated_at: ago(1) },
  { id: D3, title: 'Larkspur — booking', stage: 'proposal', contact_id: null, expected_value_cents: 0, source: 'manual', created_at: ago(2), updated_at: ago(0) },
];
const API = {
  '/sales/deals': { data: DEALS },
  '/sales/contacts': { data: [{ id: 'c1', name: 'Jane Doe', email: 'jane@example.com' }, { id: 'c2', name: 'Dana Cole', email: 'dana@example.com' }] },
  '/sales/summary': { data: { total: 3, open: { count: 3, value_cents: 340000 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 }, by_stage: [], expected: { value_cents: 0 }, ar: { outstanding_cents: 0, count: 0 } } },
  '/settings': { data: { stage_stale_days: {} } },
  '/crm/activity': { data: { items: [], upcoming: [] } },
};
const col = (page: Page, stage: string) => page.locator('#board .col').filter({ has: page.locator(`[data-drop="${stage}"]`) });
const narrow = (page: Page) => (page.viewportSize()?.width || 0) <= 760;
const showStage = async (page: Page, stage: string) => { if (narrow(page)) await page.locator(`[data-stab="${stage}"]`).click(); };
const toastWith = (page: Page, text: string) => page.locator('.dds-toast').filter({ hasText: text });
// the board's Move menu on a touch screen is tapped, with iOS's focus on a tap (pipeline.spec's
// touch test, helpers/ios-focus.ts): a plain click there closes the menu before the option lands
const touch = () => test.info().project.name !== 'desktop-chromium';
const press = (loc: Locator) => (touch() ? loc.tap() : loc.click());
const touchReady = async (page: Page) => { if (touch()) await installIosFocusSemantics(page); };
// a board whose deals move when the stage route says so (each move answers after a moment, or —
// given a gate — only once the gate opens, so a second press lands while the first is on its way)
async function liveDeals(page: Page, gate?: Promise<void>) {
  const deals = JSON.parse(JSON.stringify(DEALS));
  const moved: Array<{ id: string; to: string }> = [];
  await page.route(/\/functions\/v1\/presence\/sales\/deals(\?.*)?$/, (route) => route.request().method() === 'GET'
    ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: deals }) }) : route.fallback());
  await page.route(/\/functions\/v1\/presence\/sales\/deals\/[^/]+\/stage$/, async (route) => {
    const id = new URL(route.request().url()).pathname.split('/').slice(-2)[0], to = (route.request().postDataJSON() || {}).to;
    moved.push({ id, to });
    await (gate || new Promise((r) => setTimeout(r, 300)));
    const d = deals.find((x: { id: string }) => x.id === id);
    if (!d || d.stage === to) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'bad_transition', message: 'That deal has already moved.' }) });
    d.stage = to;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { id, stage: to } }) });
  });
  return moved;
}

test.describe('item 97 — "5k" is $5,000 (B20)', () => {
  test('quick add reads a trailing k as thousands', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/pipeline.html');
    await showStage(page, 'qualified');
    await col(page, 'qualified').locator('[data-addbtn]').click();
    const form = col(page, 'qualified').locator('form.qadd');
    await form.getByLabel('New deal in Qualified: name').fill('Maple — menu boards');
    await form.getByLabel('Value (optional)').fill('5k');
    const posted = page.waitForRequest((r) => r.method() === 'POST' && new URL(r.url()).pathname.endsWith('/sales/deals'));
    await form.getByLabel('Value (optional)').press('Enter');
    expect(JSON.parse((await posted).postData() || '{}')).toEqual({ title: 'Maple — menu boards', stage: 'qualified', expected_value_cents: 500000 });
  });

  test('the amount reader: k, decimals and spreadsheet money', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/pipeline.html');
    const got = await page.evaluate(() => { const f = (window as unknown as { amountCents: (s: string) => number }).amountCents; return ['5k', '1.5K', '2,5k', '$2,400', '1.200,50', '€ 950', '5 k', 'lots'].map(f); });
    expect(got).toEqual([500000, 150000, 250000, 240000, 120050, 95000, 500000, 0]);
  });
});

test.describe('the board redraws without losing what you typed (B19)', () => {
  test('a half-typed "+ Add a deal" survives a search keystroke, a chip and a move', async ({ page }) => {
    await installApp(page, { api: API });
    await liveDeals(page);
    await touchReady(page);
    await page.goto('/pipeline.html');
    await showStage(page, 'lead');
    await col(page, 'lead').locator('[data-addbtn]').click();
    const form = col(page, 'lead').locator('form.qadd');
    await form.getByLabel('New deal in New lead: name').fill('Sunrise Yoga');
    await form.getByLabel('Value (optional)').fill('900');
    await page.locator('#dealSearch').fill('a');                                  // every keystroke redraws the board
    await expect(form.getByLabel('New deal in New lead: name')).toHaveValue('Sunrise Yoga');
    await expect(form.getByLabel('Value (optional)')).toHaveValue('900');
    await expect(page.locator('#dealSearch')).toBeFocused();                       // and the search keeps the caret
    await page.locator('#dealSearch').fill('');
    await page.locator('[data-bchip="all"]').click();                              // a chip redraws it too
    await expect(form.getByLabel('New deal in New lead: name')).toHaveValue('Sunrise Yoga');
    if (narrow(page)) return;                                                      // a phone shows one column: no other card to move
    await press(col(page, 'qualified').locator(`.bcard[data-id="${D2}"] .bc-move`));
    await press(page.locator('#board .bc-menu').getByRole('menuitem', { name: 'Move to Proposal sent' }));
    await expect(toastWith(page, 'Moved to Proposal sent')).toBeVisible();
    await expect(col(page, 'proposal').locator(`.bcard[data-id="${D2}"]`)).toBeVisible();
    await expect(form.getByLabel('New deal in New lead: name')).toHaveValue('Sunrise Yoga');
  });

  test('once it goes in, the form closes — the reload never brings the sent name back', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/pipeline.html');
    await showStage(page, 'lead');
    await col(page, 'lead').locator('[data-addbtn]').click();
    await col(page, 'lead').getByLabel('New deal in New lead: name').fill('Sunrise Yoga');
    await col(page, 'lead').getByLabel('New deal in New lead: name').press('Enter');
    await expect(toastWith(page, 'Added to New lead')).toBeVisible();
    await expect(col(page, 'lead').locator('form.qadd')).toHaveCount(0);
    await expect(col(page, 'lead').locator('[data-addbtn]')).toBeFocused();
  });
});

test.describe('board moves (B13, B21)', () => {
  test('a double click (or a double tap) on a Move option sends one stage change', async ({ page }) => {
    await installApp(page, { api: API });
    let land!: () => void;
    const moved = await liveDeals(page, new Promise<void>((r) => { land = r; }));   // the first move waits for both presses
    await touchReady(page);
    await page.goto('/pipeline.html');
    await showStage(page, 'qualified');
    await press(col(page, 'qualified').locator(`.bcard[data-id="${D2}"] .bc-move`));
    const option = page.locator('#board .bc-menu').getByRole('menuitem', { name: 'Move to Proposal sent' });
    if (touch()) { await option.tap(); await option.tap(); } else await option.dblclick();
    await expect.poll(() => moved.length).toBeGreaterThan(0);
    land();
    await expect(toastWith(page, 'Moved to Proposal sent')).toBeVisible();
    await page.waitForTimeout(700);
    expect(moved).toEqual([{ id: D2, to: 'proposal' }]);
    await expect(toastWith(page, 'already moved')).toHaveCount(0);
  });

  test('moving the deal whose preview is open repaints the preview', async ({ page }) => {
    await installApp(page, { api: API });
    await liveDeals(page);
    await page.goto('/pipeline.html');
    test.skip((page.viewportSize()?.width || 0) < 1180, 'the preview sits beside the board only on a wide screen; narrower, it covers the board');
    await page.locator(`#board .bcard[data-id="${D2}"]`).click();
    const pv = page.locator('#dprev');
    await expect(pv.locator('.dp-stage')).toHaveText('Qualified · step 2 of 5');
    await col(page, 'qualified').locator(`.bcard[data-id="${D2}"] .bc-move`).click();
    await page.locator('#board .bc-menu').getByRole('menuitem', { name: 'Move to Proposal sent' }).click();
    await expect(pv.locator('.dp-stage')).toHaveText('Proposal sent · step 3 of 5');
    await expect(pv.getByRole('button', { name: 'Move to Agreement out →' })).toBeVisible();
  });
});

test.describe('the New deal dialog (B21)', () => {
  test('when the deal fails, Create deal again reuses the contact it already made', async ({ page }) => {
    await installApp(page, { api: API });
    const contacts: unknown[] = [], deals: Array<Record<string, unknown>> = [];
    await page.route('**/functions/v1/presence/sales/contacts', (route) => { if (route.request().method() !== 'POST') return route.fallback(); contacts.push(route.request().postDataJSON()); return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: 'ct-9', name: 'Rae Kim' } }) }); });
    await page.route(/\/functions\/v1\/presence\/sales\/deals(\?.*)?$/, (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      deals.push(route.request().postDataJSON());
      return deals.length === 1
        ? route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'write_failed', message: 'That didn’t save — please try again.' }) })
        : route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: D3 } }) });
    });
    await page.goto('/pipeline.html');
    await page.locator('#newDeal').click();
    await page.locator('#f-title').fill('Sunrise Yoga — site');
    await page.locator('#f-name').fill('Rae Kim');
    await page.locator('#formDlg').getByRole('button', { name: 'Create deal' }).click();
    await expect(toastWith(page, 'That didn’t save')).toBeVisible();
    await page.locator('#formDlg').getByRole('button', { name: 'Create deal' }).click();
    await expect.poll(() => deals.length).toBe(2);
    expect(contacts).toEqual([{ name: 'Rae Kim' }]);                 // one contact, not a spare name-only one per try
    expect(deals[1]).toEqual({ title: 'Sunrise Yoga — site', contact_id: 'ct-9' });
  });
});

const DEAL = 'dddddddd-1111-4111-8111-dddddddddddd';
const detail = (value: number) => ({ data: {
  deal: { id: DEAL, title: 'Blue Finch — site', stage: 'qualified', expected_value_cents: value, contact_id: 'c1', converted_client_id: null, next_step: null, next_step_at: null, notes: '', retainer: null },
  contact: { id: 'c1', name: 'Jane Doe', email: 'jane@example.com', phone: '', company: 'Blue Finch', notes: '' },
  proposals: [], contracts: [], events: [], timeline: [], invoices: [], last_contacted_at: null,
} });
const PROP_API = (value: number) => ({
  [`/sales/deals/${DEAL}`]: detail(value),
  [`/sales/deals/${DEAL}/tasks`]: { data: [] },
  '/sales/services': { data: [{ id: 's1', name: 'Website build', price_cents: 320000 }, { id: 's2', name: 'Logo refresh', price_cents: 60000 }] },
  '/sales/templates': { data: [] },
  '/identity': { data: { business_name: 'Bright Studio' } },
});
const openEditor = async (page: Page) => {
  await page.goto(`/pipeline.html?deal=${DEAL}&dtab=billing`);
  await page.locator('#addProp').click();
  await expect(page.locator('#propForm .pb-chips')).toBeVisible();
};
const labels = (page: Page) => page.locator('#propForm .pl-label').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));

test.describe('item 98 — the proposal editor (B8, B7)', () => {
  test('a $3,000 deal: the first chip takes the deal’s own line, so the total is the services, not double', async ({ page }) => {
    await installApp(page, { api: PROP_API(300000) });
    await openEditor(page);
    expect(await labels(page)).toEqual(['Blue Finch — site']);           // still pre-filled, to save typing
    await page.locator('#propForm [data-svc="0"]').click();
    expect(await labels(page)).toEqual(['Website build']);
    await expect(page.locator('#plPreview .pb-total')).toContainText('$3,200');
    await page.locator('#propForm [data-svc="1"]').click();
    await expect(page.locator('#plPreview .pb-total')).toContainText('$3,800');
  });

  test('a pre-filled line you’ve changed is yours: a chip goes below it', async ({ page }) => {
    await installApp(page, { api: PROP_API(300000) });
    await openEditor(page);
    await page.locator('#propForm .pl-price').first().fill('2800');
    await page.locator('#propForm [data-svc="1"]').click();
    expect(await labels(page)).toEqual(['Blue Finch — site', 'Logo refresh']);
    await expect(page.locator('#plPreview .pb-total')).toContainText('$3,400');
  });

  test('a service picked into the pre-filled line from its own list is yours too', async ({ page }) => {
    await installApp(page, { api: PROP_API(300000) });
    await openEditor(page);
    await page.locator('#propForm .pl-pick').first().selectOption('1');   // Logo refresh
    await page.locator('#propForm [data-svc="0"]').click();
    expect(await labels(page)).toEqual(['Logo refresh', 'Website build']);
  });

  test('the email failed after the save: one draft, and the deal opens on it — no second copy on the next press', async ({ page }) => {
    await installApp(page, { api: PROP_API(300000) });
    let saves = 0;
    await page.route(`**/functions/v1/presence/sales/deals/${DEAL}/proposals`, (route) => { if (route.request().method() !== 'POST') return route.fallback(); saves++; return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: 'p-1' } }) }); });
    await page.route('**/functions/v1/presence/sales/proposals/p-1/send', (route) => route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'daily_limit', message: 'You’ve reached today’s sending limit.' }) }));
    await openEditor(page);
    await page.locator('#propForm [data-svc="0"]').click();
    await page.locator('#plSaveSend').click();
    await expect(toastWith(page, 'Proposal saved as a draft, but it wasn’t sent: You’ve reached today’s sending limit.')).toBeVisible();
    await expect(page.locator('#plSaveSend')).toHaveCount(0);           // the editor closed; the deal shows the draft with its own Send
    await page.waitForTimeout(400);
    expect(saves).toBe(1);
  });
});

test.describe('item 104 — "Won this month" is your month (B14)', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });
  test('5:30pm on Oct 31 in Los Angeles: October’s wins still count, and the summary is asked with your clock', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-01T00:30:00Z') });   // 5:30pm Oct 31, Pacific
    const won = (id: string, at: string) => ({ id, title: 'Won ' + at, stage: 'won', contact_id: null, expected_value_cents: 120000, converted_client_id: 'cl-' + id, converted_at: at, updated_at: at, created_at: '2026-10-01T00:00:00Z' });
    // mid-October, and 5:10pm Oct 31 (already Nov 1 in UTC): both October's here
    await installApp(page, { api: { ...API, '/sales/deals': { data: [DEALS[0], DEALS[1], won(D3, '2026-10-15T18:00:00Z'), won('44444444-4444-4444-8444-4444444444d4', '2026-11-01T00:10:00Z')] } } });
    const asked: string[] = [];
    await page.route('**/functions/v1/presence/sales/summary**', (route) => { asked.push(new URL(route.request().url()).search); return route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"read_failed"}' }); });
    await page.goto('/pipeline.html');
    await expect.poll(() => asked.length).toBeGreaterThan(0);
    const q = new URLSearchParams(asked[0]);
    expect(q.get('today')).toBe('2026-10-31');
    expect(q.get('tzo')).toBe('420');
    await expect(page.locator('#wonN')).toHaveText('2');                   // the board's own count (the summary failed): both October wins — the UTC month said 1
  });
});
