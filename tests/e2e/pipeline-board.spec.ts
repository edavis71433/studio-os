import { test, expect, type Page } from '@playwright/test';
import { installApp } from './helpers/app';

// Bold redesign — Pipeline (Nov 2026): the board first. It's the default view;
// each column says its stage's chance (Settings › The chance each stage closes)
// beside its count; a deal can be added right in its column (a name and a
// value, Enter adds it, Esc puts the button back); cards show the person; and
// chips over the board answer the real questions: who needs a nudge, what
// should close this month, what came in from your website.

const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();
const thisMonth = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-28'; };
const D1 = '11111111-1111-4111-8111-1111111111d1';   // Jane · from the website · quiet for 30 days (needs a nudge)
const D2 = '22222222-2222-4222-8222-2222222222d2';   // Dana · closing this month
const D3 = '33333333-3333-4333-8333-3333333333d3';   // no one on it yet
const DEALS = [
  { id: D1, title: 'Blue Finch — site', stage: 'lead', contact_id: 'c1', expected_value_cents: 250000, source: 'form', created_at: ago(40), updated_at: ago(30), last_contacted_at: ago(30) },
  { id: D2, title: 'Harbor Lane — logo', stage: 'qualified', contact_id: 'c2', expected_value_cents: 90000, source: 'manual', expected_close: thisMonth(), created_at: ago(3), updated_at: ago(1) },
  { id: D3, title: 'Larkspur — booking', stage: 'proposal', contact_id: null, expected_value_cents: 0, source: 'manual', created_at: ago(2), updated_at: ago(0) },
];
const byStage = (stage: string, label: string, chance: number) => ({ stage, label, count: DEALS.filter((d) => d.stage === stage).length, value_cents: DEALS.filter((d) => d.stage === stage).reduce((a, d) => a + d.expected_value_cents, 0), chance, expected_cents: 0 });
const API = {
  '/sales/deals': { data: DEALS },
  '/sales/contacts': { data: [
    { id: 'c1', name: 'Jane Doe', email: 'jane@example.com', company: 'Blue Finch' },
    { id: 'c2', name: 'Dana Cole', email: 'dana@example.com', company: 'Harbor Lane' },
  ] },
  '/sales/summary': { data: { total: 3, open: { count: 3, value_cents: 340000 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 },
    by_stage: [byStage('lead', 'New lead', 10), byStage('qualified', 'Qualified', 25), byStage('proposal', 'Proposal sent', 50), byStage('contract', 'Agreement out', 75)],
    expected: { value_cents: 47500 }, ar: { outstanding_cents: 0, count: 0 } } },
  '/settings': { data: { stage_stale_days: {} } },
};
const col = (page: Page, stage: string) => page.locator('#board .col').filter({ has: page.locator(`[data-drop="${stage}"]`) });

test.describe('Pipeline — the board first (bold redesign)', () => {
  test('the board is the default; List and Table stay one click away and the choice is remembered', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/pipeline.html');
    await expect(page.locator('#viewBoard')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#board .bcard')).toHaveCount(3);
    await page.locator('#viewList').click();
    await expect(page.locator('#list .card').first()).toBeVisible();
    await page.reload();
    await expect(page.locator('#viewList')).toHaveAttribute('aria-pressed', 'true');
  });

  test('each column says its chance beside its count, from the studio’s own settings', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/pipeline.html');
    await expect(col(page, 'lead').locator('.col-ch')).toHaveText('10%');
    await expect(col(page, 'qualified').locator('.col-ch')).toHaveText('25%');
    await expect(col(page, 'proposal').locator('.col-ch')).toHaveText('50%');
    await expect(col(page, 'contract').locator('.col-ch')).toHaveText('75%');
  });

  test('cards show the person on the deal; a deal with no one on it just leaves that out', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/pipeline.html');
    const jane = page.locator(`#board .bcard[data-id="${D1}"]`);
    await expect(jane.locator('.bc-who')).toHaveText('JDJane Doe');
    await expect(jane.locator('.bc-av')).toHaveText('JD');
    await expect(jane.locator('.bc-src')).toHaveText('From your website');
    await expect(page.locator(`#board .bcard[data-id="${D3}"] .bc-who`)).toHaveCount(0);
  });

  test('chips with counts: needs a nudge, closing this month, from your website — each narrows the board', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/pipeline.html');
    const chips = page.locator('#board [data-bchip]');
    await expect(chips).toHaveText(['All open 3', 'Needs a nudge 1', 'Closing this month 1', 'From your website 1']);
    await page.locator('[data-bchip="nudge"]').click();
    await expect(page.locator('[data-bchip="nudge"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-bchip="nudge"]')).toBeFocused();
    await expect(page.locator('#board .bcard')).toHaveCount(1);
    await expect(page.locator(`#board .bcard[data-id="${D1}"]`)).toBeVisible();
    await page.locator('[data-bchip="closing"]').click();
    await expect(page.locator('#board .bcard')).toHaveCount(1);
    await expect(page.locator(`#board .bcard[data-id="${D2}"]`)).toBeVisible();
    await page.locator('[data-bchip="all"]').click();
    await expect(page.locator('#board .bcard')).toHaveCount(3);
  });

  test('+ Add a deal in a column: a name and a value, Enter adds it to that stage; Esc puts the button back', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/pipeline.html');
    if ((page.viewportSize()?.width || 0) <= 760) await page.locator('[data-stab="qualified"]').click();   // a phone shows one stage at a time
    const add = col(page, 'qualified').locator('[data-addbtn]');
    await add.click();
    const form = col(page, 'qualified').locator('form.qadd');
    await expect(form.getByLabel('New deal in Qualified: name')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(form).toHaveCount(0);
    await expect(col(page, 'qualified').locator('[data-addbtn]')).toBeFocused();
    // a name is needed
    await col(page, 'qualified').locator('[data-addbtn]').click();
    await form.locator('.qa-go').click();
    await expect(form.locator('.qa-err')).toHaveText('Give the deal a name.');
    // name + value, Enter
    await form.getByLabel('New deal in Qualified: name').fill('Maple — menu boards');
    await form.getByLabel('Value (optional)').fill('1,200');
    const posted = page.waitForRequest((r) => r.method() === 'POST' && new URL(r.url()).pathname.endsWith('/sales/deals'));
    await form.getByLabel('Value (optional)').press('Enter');
    expect(JSON.parse((await posted).postData() || '{}')).toEqual({ title: 'Maple — menu boards', stage: 'qualified', expected_value_cents: 120000 });
    await expect(page.locator('.dds-toast').last()).toContainText('Added to Qualified');
    await expect(col(page, 'qualified').locator('[data-addbtn]')).toBeFocused();
  });

  test('a value that isn’t an amount is caught before anything is sent', async ({ page }) => {
    await installApp(page, { api: API });
    let posted = 0;
    page.on('request', (r) => { if (r.method() === 'POST' && new URL(r.url()).pathname.endsWith('/sales/deals')) posted++; });
    await page.goto('/pipeline.html');
    await col(page, 'lead').locator('[data-addbtn]').click();
    const form = col(page, 'lead').locator('form.qadd');
    await form.getByLabel('New deal in New lead: name').fill('Sunrise Yoga');
    await form.getByLabel('Value (optional)').fill('lots');
    await form.locator('.qa-go').click();
    await expect(form.locator('.qa-err')).toHaveText('That value doesn’t look like an amount.');
    await expect(form.getByLabel('Value (optional)')).toBeFocused();
    expect(posted).toBe(0);
  });
});

// Pipeline B: a card opens the deal beside the board (a sheet on a phone)
const D4 = '44444444-4444-4444-8444-4444444444d4';   // agreement out: its next step is Won, on the deal itself
const B_DEALS = [...DEALS, { id: D4, title: 'Kestrel Yoga — classes', stage: 'contract', contact_id: 'c2', expected_value_cents: 140000, source: 'manual', created_at: ago(9), updated_at: ago(1) }];
// a board whose deals move when the stage route says so
async function liveDeals(page: Page) {
  const deals = JSON.parse(JSON.stringify(B_DEALS));
  const moved: Array<{ id: string; to: string }> = [];
  await page.route(/\/functions\/v1\/presence\/sales\/deals(\?.*)?$/, (route) => route.request().method() === 'GET'
    ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: deals }) }) : route.fallback());
  await page.route(/\/functions\/v1\/presence\/sales\/deals\/[^/]+\/stage$/, (route) => {
    const id = new URL(route.request().url()).pathname.split('/').slice(-2)[0], to = (route.request().postDataJSON() || {}).to;
    moved.push({ id, to }); const d = deals.find((x: { id: string }) => x.id === id); if (d) d.stage = to;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { id, stage: to } }) });
  });
  return moved;
}
const ACTIVITY = { data: { items: [
  { id: 'a1', kind: 'deal_activity', type: 'call', title: 'You called Dana', at: ago(2) },
  { id: 'a2', kind: 'deal_event', type: 'system', title: 'Moved to Qualified', at: ago(3) },
  { id: 'a3', kind: 'deal_event', type: 'system', title: 'Deal added', at: ago(4) },
  { id: 'a4', kind: 'deal_event', type: 'system', title: 'Older', at: ago(9) },
], upcoming: [] } };
const pv = (page: Page) => page.locator('#dprev');

test.describe('Pipeline — the deal beside the board (bold redesign)', () => {
  test('a card opens the deal: value, chance, close date, where it is, and the next stage as one button', async ({ page }) => {
    await installApp(page, { api: { ...API, '/crm/activity': ACTIVITY } });
    const moved = await liveDeals(page);
    await page.goto('/pipeline.html');
    if ((page.viewportSize()?.width || 0) <= 760) await page.locator('[data-stab="qualified"]').click();   // a phone shows one stage at a time
    await page.locator(`#board .bcard[data-id="${D2}"]`).click();
    await expect(pv(page).getByRole('heading', { level: 2 })).toHaveText('Harbor Lane — logo');
    await expect(pv(page).locator('.dp-tiles')).toContainText('Value$900');
    await expect(pv(page).locator('.dp-tiles')).toContainText('Chance25%');
    await expect(pv(page).locator('.dp-stage')).toHaveText('Qualified · step 2 of 5');
    await expect(pv(page).locator('.dp-latest li')).toHaveCount(3);
    await expect(page.locator(`#board .bcard[data-id="${D2}"]`)).toHaveClass(/dp-on/);
    await pv(page).getByRole('button', { name: 'Move to Proposal sent →' }).click();
    await expect(page.locator('.dds-toast').last()).toContainText('Moved to Proposal sent');
    expect(moved).toEqual([{ id: D2, to: 'proposal' }]);
    await expect(pv(page).locator('.dp-stage')).toHaveText('Proposal sent · step 3 of 5');   // the same preview, one stage on
    await expect(pv(page).getByRole('button', { name: 'Move to Agreement out →' })).toBeFocused();
  });

  test('Agreement out: the next step is Won, which happens on the deal (where it becomes a customer)', async ({ page }) => {
    await installApp(page, { api: { ...API, '/crm/activity': ACTIVITY } });
    await liveDeals(page);
    await page.goto('/pipeline.html');
    if ((page.viewportSize()?.width || 0) <= 760) await page.locator('[data-stab="contract"]').click();
    await page.locator(`#board .bcard[data-id="${D4}"]`).click();
    await pv(page).getByRole('button', { name: /Mark it won/ }).click();
    await expect(pv(page)).toBeHidden();
    await expect(page.locator('#detailWrap')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`deal=${D4}`));
  });

  test('quick actions: Log a call and Invoice ask + Create for this deal; Proposal and Open full deal go to the deal', async ({ page }) => {
    await installApp(page, { api: { ...API, '/crm/activity': ACTIVITY } });
    await liveDeals(page);
    await page.goto('/pipeline.html');
    await page.evaluate(() => {
      const w = window as unknown as { ddsOpenCreate: (...a: unknown[]) => boolean; __asked: unknown[] };
      w.__asked = []; w.ddsOpenCreate = function (...a: unknown[]) { w.__asked.push([a[0], a[3]]); return true; };
    });
    await page.locator(`#board .bcard[data-id="${D1}"]`).click();
    await pv(page).getByRole('button', { name: 'Log a call' }).click();
    await pv(page).getByRole('button', { name: 'Invoice' }).click();
    expect(await page.evaluate(() => (window as unknown as { __asked: unknown[] }).__asked)).toEqual([['call', { deal_id: D1 }], ['invoice', { deal_id: D1 }]]);
    await pv(page).getByRole('button', { name: /Open full deal/ }).click();
    await expect(pv(page)).toBeHidden();
    await expect(page.locator('#detailWrap')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`deal=${D1}`));
  });

  test('Proposal goes straight to the deal’s proposal', async ({ page }) => {
    await installApp(page, { api: { ...API, '/crm/activity': ACTIVITY } });
    await liveDeals(page);
    await page.goto('/pipeline.html');
    await page.locator(`#board .bcard[data-id="${D1}"]`).click();
    const nav = page.waitForRequest((r) => r.isNavigationRequest() && r.url().includes('compose=proposal'));
    await pv(page).getByRole('button', { name: 'Proposal' }).click();
    expect((await nav).url()).toContain(`deal=${D1}&dtab=billing&compose=proposal`);
    await expect(page).toHaveURL(new RegExp(`deal=${D1}&dtab=billing`));   // the page takes the compose flag and tidies the address
  });

  test('Escape closes it and goes back to the card', async ({ page }) => {
    await installApp(page, { api: { ...API, '/crm/activity': ACTIVITY } });
    await liveDeals(page);
    await page.goto('/pipeline.html');
    await page.locator(`#board .bcard[data-id="${D1}"]`).focus();
    await page.keyboard.press('Enter');
    await expect(pv(page).getByRole('heading', { level: 2 })).toHaveText('Blue Finch — site');
    await page.keyboard.press('Escape');
    await expect(pv(page)).toBeHidden();
    await expect(page.locator(`#board .bcard[data-id="${D1}"]`)).toBeFocused();
  });

  test('a phone shows one stage at a time, picked from tabs with their counts', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'phone width');
    await installApp(page, { api: API });
    await page.goto('/pipeline.html');
    const tabs = page.locator('[data-stab]');
    await expect(tabs).toHaveText(['New lead 1', 'Qualified 1', 'Proposal sent 1', 'Agreement out 0', 'Won 0']);   // Won is a tab on a phone (this month's count)
    await expect(page.locator('#board .col[data-col]:visible')).toHaveCount(1);
    await expect(page.locator(`#board .bcard[data-id="${D1}"]`)).toBeVisible();
    await page.locator('[data-stab="proposal"]').click();
    await expect(page.locator('[data-stab="proposal"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(`#board .bcard[data-id="${D3}"]`)).toBeVisible();
    await expect(page.locator(`#board .bcard[data-id="${D1}"]`)).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});
