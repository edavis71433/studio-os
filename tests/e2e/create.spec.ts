import { test, expect, type Page } from '@playwright/test';
import { installApp, ALL_FEATURES, STUDIO_LEVEL_NAV, CLIENT_NAV } from './helpers/app';

// "+ Create" (sales list item 70, the bold redesign, Nov 2026). Timed against
// Salesforce, every everyday job began by finding the customer and opening
// their page. One button on every page now logs a call, adds a deal, sends an
// invoice, opens a proposal or adds a to-do; you pick WHO inside the form.
// The sidebar carries it on a computer and an iPad; a studio's phone bar is
// Home · Inbox · + · Pipeline · Customers. Runs at all three sizes.

const day = (n: number, from = new Date()) => { const d = new Date(from); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const friday = () => { const d = new Date(); const f = (5 - d.getDay() + 7) % 7; return day(f === 0 ? 7 : f); };
const nextMonday = () => { const d = new Date(); const m = (1 - d.getDay() + 7) % 7; return day(m === 0 ? 7 : m); };

const D1 = '11111111-1111-4111-8111-111111111111';   // Jane · Blue Finch, proposal, $2,500, next step overdue
const D2 = '22222222-2222-4222-8222-222222222222';   // won
const D3 = '33333333-3333-4333-8333-333333333333';   // lost
const D4 = '44444444-4444-4444-8444-444444444444';   // Dana · Harbor Lane, new lead, no value
const D5 = '55555555-5555-4555-8555-555555555555';   // a deal with a draft proposal
const D9 = '99999999-9999-4999-8999-999999999999';   // Zed's deal, past the first 100
const NEW_DEAL = 'abababab-abab-4bab-8bab-abababababab';

const DEALS = [
  { id: D1, title: 'Blue Finch — site', stage: 'proposal', contact_id: 'c1', expected_value_cents: 250000, next_step: 'Call back', next_step_at: day(-1), updated_at: '2026-11-01T10:00:00Z' },
  { id: D2, title: 'Old job', stage: 'won', contact_id: 'c2', expected_value_cents: 90000, updated_at: '2026-10-01T10:00:00Z' },
  { id: D3, title: 'Lost one', stage: 'lost', contact_id: 'c4', expected_value_cents: 0, updated_at: '2026-11-07T10:00:00Z' },
  { id: D4, title: 'Harbor Lane — logo', stage: 'lead', contact_id: 'c2', expected_value_cents: 0, updated_at: '2026-11-08T10:00:00Z' },
];
const PEOPLE = [
  { id: 'c1', name: 'Jane Doe', company: 'Blue Finch', email: 'jane@example.com', updated_at: '2026-11-01T10:00:00Z' },
  { id: 'c2', name: 'Dana Cole', company: 'Harbor Lane', email: 'dana@example.com', updated_at: '2026-11-08T10:00:00Z' },
  { id: 'c3', name: 'Sam Lee', company: '', email: 'sam@example.com', updated_at: '2026-11-05T10:00:00Z' },
  { id: 'c4', name: 'Lou Park', company: '', email: 'lou@example.com', updated_at: '2026-11-07T10:00:00Z' },
];
const FAR = [{ id: 'c9', name: 'Zed Far', company: 'Far & Wide', email: 'zed@example.com', updated_at: '2025-01-01T10:00:00Z' }];
const THEIR_DEALS: Record<string, unknown[]> = { c3: [], c9: [{ id: D9, title: 'Zed — retainer', stage: 'qualified' }] };

const STUDIO_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'],
  landing: '/agency.html', attention_count: 0, nav: STUDIO_LEVEL_NAV, plan_key: 'presence', upsell: null, scope: null,
} };
const dealDetail = (id: string, title: string, proposals: unknown[] = []) => ({ data: {
  deal: { id, title, stage: 'proposal', expected_value_cents: 250000, expected_close: null, next_step: null, next_step_at: null, notes: '', contact_id: 'c1', converted_client_id: null, retainer: null },
  contact: { id: 'c1', name: 'Jane Doe', email: 'jane@example.com', phone: '', company: 'Blue Finch', notes: '' },
  proposals, contracts: [], events: [], timeline: [], invoices: [], last_contacted_at: null,
} });
const FIXTURES = {
  '/portal/context': STUDIO_CTX,
  '/agency/needs-you': { data: { rows: [], more: 0, rest: [], total: 0, empty_line: 'All quiet.', partial: false, own_site: true, next_by_site: {}, next_by_client: {} } },
  '/agency/me': { data: { agency: 'Bright Studio', role: 'owner', plan: 'agency', branding: {}, email: 'owner@example.com', member_id: 'm1' } },
  '/agency/portfolio': { data: [] },
  '/agency/kits': { data: [] },
  '/studio/customers': { data: [] },
  '/sales/summary': { data: { total: 4, open: { count: 2, value_cents: 250000 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 }, by_stage: [], ar: { outstanding_cents: 0, count: 0, overdue_count: 0 } } },
  '/sales/receivables': { data: { items: [], total_cents: 0 } },
  '/sales/my-tasks': { data: { partial: false, total: 0, items: [] } },
  [`/sales/deals/${D1}`]: dealDetail(D1, 'Blue Finch — site'),
  [`/sales/deals/${D1}/tasks`]: { data: [] },
  [`/sales/deals/${D5}`]: dealDetail(D5, 'Larkspur', [{ id: 'p-d', title: 'Website build', status: 'draft', version: 1, line_items: [{ label: 'Build', qty: 1, unit_cents: 250000 }], first_viewed_at: null, expires_at: null }]),
  [`/sales/deals/${D5}/tasks`]: { data: [] },
  '/sales/templates': { data: [] },
  '/sales/services': { data: [] },
  '/identity': { data: { business_name: 'Bright Studio' } },
};

type Call = { method: string; path: string; search: string; body: Record<string, unknown> | null };
type InvoiceReply = (body: Record<string, unknown>, n: number) => { status: number; json: unknown };

/** The sales routes Create calls, answered by method (installApp answers by path only), and recorded. */
async function salesServer(page: Page, opts: { failActivityOnce?: boolean; invoice?: InvoiceReply } = {}) {
  const calls: Call[] = [];
  let activityFails = opts.failActivityOnce ? 1 : 0, invoices = 0;
  await page.route(/\/functions\/v1\/presence\/sales\//, async (route) => {
    const req = route.request(); const url = new URL(req.url());
    const path = url.pathname.replace(/^.*\/functions\/v1\/presence/, ''); const method = req.method();
    let body: Record<string, unknown> | null = null; try { body = req.postDataJSON(); } catch { body = null; }
    const reply = (status: number, b: unknown) => { calls.push({ method, path, search: url.search, body }); return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) }); };
    if (method === 'GET' && path === '/sales/deals') return reply(200, { data: url.searchParams.get('q') ? [] : DEALS });
    if (method === 'GET' && path === '/sales/contacts') return reply(200, { data: url.searchParams.get('q') === 'zed' ? FAR : url.searchParams.get('q') ? [] : PEOPLE });
    if (method === 'GET' && path === '/sales/stages') return reply(200, { data: { labels: {} } });
    const ct = path.match(/^\/sales\/contacts\/([^/]+)$/);
    if (method === 'GET' && ct) return reply(200, { data: { contact: { id: ct[1] }, deals: THEIR_DEALS[ct[1]] || [] } });
    if (method === 'POST' && path === '/sales/contacts') return reply(201, { data: { id: 'c-new', name: body?.name, email: body?.email } });
    if (method === 'POST' && path === '/sales/deals') return reply(201, { data: { id: NEW_DEAL, title: body?.title, stage: 'lead' } });
    if (method === 'POST' && /\/activity$/.test(path)) {
      if (activityFails > 0) { activityFails--; return reply(500, { error: 'write_failed', message: 'That didn’t save just now — please try again.' }); }
      return reply(201, { data: { id: 'ev-1' } });
    }
    if (method === 'PATCH' && /^\/sales\/deals\/[0-9a-f-]{36}$/.test(path)) return reply(200, { data: { ok: true } });
    if (method === 'POST' && /\/tasks$/.test(path)) return reply(201, { data: { id: 't-1' } });
    if (method === 'POST' && /\/invoice$/.test(path)) {
      invoices++;
      const r = opts.invoice ? opts.invoice(body || {}, invoices) : { status: 201, json: { data: { id: 'inv-1' }, url: 'https://pay.example/inv-1', emailed: true, reused: false, amount_cents: body?.amount_cents } };
      return reply(r.status, r.json);
    }
    return route.fallback();
  });
  return calls;
}
const writes = (calls: Call[]) => calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`);

const isPhone = (page: Page) => (page.viewportSize()?.width || 0) < 761;
const dlg = (page: Page) => page.locator('dialog#dds-cr');
// the sheet slides up and a form slides in: measure once it has landed
const settled = (page: Page) => dlg(page).evaluate((e) => Promise.all(e.getAnimations().map((a) => a.finished)).then(() => true));
async function openMenu(page: Page) {
  await page.locator(isPhone(page) ? '#dds-mbar-create' : '#dds-create').click();
  await expect(dlg(page).locator('.cr-item')).toHaveCount(7);
}
async function openForm(page: Page, label: string) {
  await openMenu(page);
  await dlg(page).locator('.cr-item', { hasText: label }).click();
  await expect(dlg(page).locator('#dds-cr-title')).toHaveText(label);
}
const option = (page: Page, text: string) => dlg(page).locator('#cr-who-list [role=option]', { hasText: text });

test.describe('+ Create', () => {
  test('a studio gets one button for the everyday jobs: the sidebar on a computer or iPad, the + on a phone', async ({ page }) => {
    await installApp(page, { api: FIXTURES });
    await salesServer(page);
    await page.goto('/agency.html');
    if (isPhone(page)) {
      await expect(page.locator('#dds-create')).toBeHidden();
      const bar = page.locator('#dds-mbar');
      await expect(bar.locator('> a, > button')).toHaveCount(5);
      expect(await bar.locator('> a, > button').evaluateAll((els) => els.map((e) => e.id || (e.textContent || '').trim()))).toEqual(['Home', 'Inbox', 'dds-mbar-create', 'Pipeline', 'Customers']);
      await expect(bar.locator('#dds-mbar-create')).toHaveAttribute('aria-label', 'Create');
      await expect(bar.locator('#dds-mbar-menu')).toHaveCount(0);   // the rest of the menu is the top bar's App Launcher
      await expect(page.locator('#dds-waffle')).toBeVisible();
    } else {
      const btn = page.locator('#dds-create');
      await expect(btn).toBeVisible();
      await expect(btn).toHaveText(/Create/);
      // between the brand and the search, inside the sidebar
      const b = (await btn.boundingBox())!, s = (await page.locator('#dds-search').boundingBox())!, brand = (await page.locator('.dds-brand').boundingBox())!;
      expect(b.y).toBeGreaterThan(brand.y);
      expect(b.y + b.height).toBeLessThanOrEqual(s.y + 1);
      expect(b.height).toBeGreaterThanOrEqual(page.viewportSize()!.width < 1024 ? 44 : 40);   // the iPad is a touch screen
    }
    await openMenu(page);
    await expect(dlg(page).locator('.cr-item b')).toHaveText(['Log a call', 'New deal', 'Send an invoice', 'Send a proposal', 'Add a customer', 'Add a to-do', 'Send an update']);
    const opener = page.locator(isPhone(page) ? '#dds-mbar-create' : '#dds-create');
    await expect(opener).toHaveAttribute('aria-expanded', 'true');
    if (isPhone(page)) {
      await expect(dlg(page)).toHaveClass(/sheet/);
      await expect(dlg(page).locator('.cr-menu.tiles')).toBeVisible();
    } else {
      // a menu beside the sidebar, not a screen-wide dialog
      await settled(page);
      const m = (await dlg(page).boundingBox())!, side = (await page.locator('#dds-shell').boundingBox())!;
      expect(m.x).toBeGreaterThanOrEqual(side.x + side.width);
      expect(m.width).toBeLessThanOrEqual(400);
    }
    await page.keyboard.press('Escape');
    await expect(dlg(page)).toBeHidden();
    await expect(opener).toBeFocused();
    await expect(opener).toHaveAttribute('aria-expanded', 'false');
  });

  test('log a call from any page: pick who, how it went, the next step — saved on their deal', async ({ page }) => {
    await installApp(page, { api: FIXTURES });
    const calls = await salesServer(page);
    await page.goto('/agency.html');
    await openForm(page, 'Log a call');
    // with nothing typed: open deals, the overdue next step first
    await expect(dlg(page).locator('#cr-who-hint')).toHaveText('Due a call, and recent');
    await expect(dlg(page).locator('#cr-who-list [role=option]').first()).toContainText('Jane Doe · Blue Finch');
    await expect(dlg(page).locator('#cr-who-list')).not.toContainText('Lost one');
    await dlg(page).locator('#cr-who').fill('finch');
    await expect(dlg(page).locator('#cr-who-list [role=option]')).toHaveCount(1);
    await dlg(page).locator('#cr-who').press('Enter');
    await expect(dlg(page).locator('#cr-picked')).toContainText('Blue Finch — site · Proposal sent');
    await expect(dlg(page).locator('.cr-go')).toHaveText('Log call');
    await dlg(page).locator('[data-chips=outcome] .cr-chip', { hasText: 'Left a voicemail' }).click();
    await expect(dlg(page).locator('[data-chips=outcome] .cr-chip.on')).toHaveAttribute('aria-pressed', 'true');
    await dlg(page).locator('#cr-notes').fill('Asked about the logo');
    await dlg(page).locator('#cr-next').fill('Send the logo');
    await dlg(page).locator('[data-chips=nextDue] .cr-chip', { hasText: 'Friday' }).click();
    await dlg(page).locator('.cr-go').click();
    await expect(page.locator('.dds-toast').last()).toContainText('Call logged — Blue Finch — site');
    await expect(dlg(page)).toBeHidden();
    expect(writes(calls)).toEqual([`POST /sales/deals/${D1}/activity`, `PATCH /sales/deals/${D1}`]);
    expect(calls.find((c) => c.path.endsWith('/activity'))!.body).toEqual({ kind: 'call', body: 'Left a voicemail. Asked about the logo' });
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ next_step: 'Send the logo', next_step_at: friday() });
  });

  test('a person with no deal: the button says one starts, and pressing again after a failure never starts a second', async ({ page }) => {
    await installApp(page, { api: FIXTURES });
    const calls = await salesServer(page, { failActivityOnce: true });
    await page.goto('/agency.html');
    await openForm(page, 'Log a call');
    await dlg(page).locator('#cr-who').fill('sam');
    await option(page, 'Sam Lee').click();
    await expect(dlg(page).locator('#cr-picked')).toContainText('No deal yet — one starts for them');
    await expect(dlg(page).locator('.cr-go')).toHaveText('Start a deal and log the call');
    await dlg(page).locator('.cr-go').click();
    // the deal started, the call didn't save: said in the form, which stays open
    await expect(dlg(page).locator('.cr-err')).toHaveText('That didn’t save just now — please try again.');
    await expect(dlg(page)).toBeVisible();
    await expect(dlg(page).locator('.cr-go')).toBeEnabled();
    await expect(dlg(page).locator('.cr-go')).toHaveText('Log call');                     // the pick is that deal now
    await expect(dlg(page).locator('#cr-picked')).toContainText('Sam Lee — project · New lead');
    await dlg(page).locator('.cr-go').click();
    await expect(page.locator('.dds-toast').last()).toContainText('Call logged — Sam Lee — project');
    expect(writes(calls)).toEqual(['POST /sales/deals', `POST /sales/deals/${NEW_DEAL}/activity`, `POST /sales/deals/${NEW_DEAL}/activity`]);
    expect(calls.find((c) => c.method === 'POST' && c.path === '/sales/deals')!.body).toEqual({ title: 'Sam Lee — project', contact_id: 'c3' });
    expect(calls.filter((c) => c.path === '/sales/contacts/c3')).toHaveLength(1);       // their deals were checked once
  });

  test('someone past the first 100: typing asks the server, and their own deal is used — none is started', async ({ page }) => {
    await installApp(page, { api: FIXTURES });
    const calls = await salesServer(page);
    await page.goto('/agency.html');
    await openForm(page, 'Log a call');
    await dlg(page).locator('#cr-who').fill('zed');
    await option(page, 'Zed Far').click();
    await expect(dlg(page).locator('#cr-picked')).toContainText('Zed — retainer · Qualified');   // checked as soon as picked
    await expect(dlg(page).locator('.cr-go')).toHaveText('Log call');
    await dlg(page).locator('.cr-go').click();
    await expect(page.locator('.dds-toast').last()).toContainText('Call logged — Zed — retainer');
    expect(writes(calls)).toEqual([`POST /sales/deals/${D9}/activity`]);
    expect(calls.some((c) => c.path === '/sales/contacts' && c.search.includes('q=zed'))).toBe(true);
  });

  test('send an invoice: quick fill from the deal, a due date, and a picture of what they get', async ({ page }) => {
    await installApp(page, { api: FIXTURES });
    const calls = await salesServer(page);
    await page.goto('/agency.html');
    await openForm(page, 'Send an invoice');
    await option(page, 'Jane Doe').click();
    const fill = dlg(page).locator('#cr-fill');
    await expect(fill.locator('.cr-chip')).toHaveText(['50% of the deal · $1,250', 'Full · $2,500']);
    await fill.locator('.cr-chip').first().click();
    await expect(dlg(page).locator('#cr-amt')).toHaveValue('$1,250');
    await expect(dlg(page).locator('#cr-what')).toHaveValue('50% deposit');               // the email already names the project
    await dlg(page).locator('[data-chips=due] .cr-chip', { hasText: '7 days' }).click();
    const pv = dlg(page).locator('#cr-preview');
    await expect(pv).toContainText('What Jane Doe gets');
    await expect(pv).toContainText('50% deposit — $1,250 due');
    await expect(pv.locator('.cr-paybtn')).toHaveText('Pay $1,250');
    await dlg(page).locator('.cr-go').click();
    await expect(page.locator('.dds-toast').last()).toContainText('Invoice sent — emailed to Jane Doe');
    expect(writes(calls)).toEqual([`POST /sales/deals/${D1}/invoice`]);
    expect(calls.find((c) => c.path.endsWith('/invoice'))!.body).toEqual({ purpose: 'service', amount_cents: 125000, due_date: day(7), title: '50% deposit' });
  });

  test('an invoice whose payment link didn’t generate stays open; Send again finishes the same one and says nothing was emailed', async ({ page }) => {
    await installApp(page, { api: FIXTURES });
    const calls = await salesServer(page, { invoice: (body, n) => n === 1
      ? { status: 200, json: { data: { id: 'inv-2', stripe_url: null }, warning: 'link_failed', message: 'Invoice saved, but the payment link didn’t generate — tap Send again (it will finish this same invoice, not make another).' } }
      : { status: 200, json: { data: { id: 'inv-2' }, url: 'https://pay.example/inv-2', emailed: false, reused: true, amount_cents: body.amount_cents } } });
    await page.goto('/agency.html');
    await openForm(page, 'Send an invoice');
    await dlg(page).locator('#cr-who').fill('harbor');
    await option(page, 'Harbor Lane — logo').click();
    await expect(dlg(page).locator('#cr-fill')).toBeHidden();                              // no value on the deal, nothing to quick-fill
    await dlg(page).locator('.cr-go').click();
    await expect(dlg(page).locator('.cr-err')).toHaveText('Enter the amount.');
    await expect(dlg(page).locator('#cr-amt')).toBeFocused();
    await dlg(page).locator('#cr-amt').fill('700');
    await dlg(page).locator('.cr-go').click();
    await expect(dlg(page).locator('.cr-err')).toContainText('the payment link didn’t generate');
    await expect(dlg(page)).toBeVisible();
    await dlg(page).locator('.cr-go').click();
    await expect(page.locator('.dds-toast').last()).toContainText('That invoice was already open on this deal — nothing new was emailed');
    expect(writes(calls)).toEqual([`POST /sales/deals/${D4}/invoice`, `POST /sales/deals/${D4}/invoice`]);
    expect(calls.filter((c) => c.path.endsWith('/invoice')).map((c) => c.body!.amount_cents)).toEqual([70000, 70000]);
  });

  test('a new deal with someone new: the person, then the deal with its value', async ({ page }) => {
    await installApp(page, { api: FIXTURES });
    const calls = await salesServer(page);
    await page.goto('/agency.html');
    await openForm(page, 'New deal');
    await expect(dlg(page).locator('#cr-title')).toBeFocused();
    await dlg(page).locator('.cr-go').click();
    await expect(dlg(page).locator('.cr-err')).toHaveText('Give the deal a name.');
    await dlg(page).locator('#cr-title').fill('Oak & Iron — website');
    await dlg(page).locator('#cr-value').fill('2500');
    await dlg(page).locator('#cr-value').blur();
    await expect(dlg(page).locator('#cr-value')).toHaveValue('$2,500');
    await dlg(page).locator('[data-chips=dealWho] .cr-chip', { hasText: 'Someone new' }).click();
    await expect(dlg(page).locator('#cr-existing')).toBeHidden();
    await dlg(page).locator('#cr-pname').fill('Ola Smith');
    await dlg(page).locator('#cr-pemail').fill('ola@example.com');
    await expect(dlg(page).locator('.cr-go')).toHaveText('Add deal');
    await dlg(page).locator('.cr-go').click();
    const t = page.locator('.dds-toast').last();
    await expect(t).toContainText('Deal added — Oak & Iron — website');
    await expect(t.locator('.act')).toHaveText('Open');
    expect(writes(calls)).toEqual(['POST /sales/contacts', 'POST /sales/deals']);
    expect(calls.find((c) => c.path === '/sales/contacts' && c.method === 'POST')!.body).toEqual({ name: 'Ola Smith', email: 'ola@example.com' });
    expect(calls.find((c) => c.path === '/sales/deals' && c.method === 'POST')!.body).toEqual({ title: 'Oak & Iron — website', contact_id: 'c-new', expected_value_cents: 250000 });
  });

  test('a new deal with someone you know: picked from your people', async ({ page }) => {
    await installApp(page, { api: FIXTURES });
    const calls = await salesServer(page);
    await page.goto('/agency.html');
    await openForm(page, 'New deal');
    await dlg(page).locator('#cr-title').fill('Blue Finch — menus');
    await dlg(page).locator('#cr-who').fill('jane');
    await option(page, 'Jane Doe').click();
    await dlg(page).locator('.cr-go').click();
    await expect(page.locator('.dds-toast').last()).toContainText('Deal added — Blue Finch — menus');
    expect(calls.find((c) => c.path === '/sales/deals' && c.method === 'POST')!.body).toEqual({ title: 'Blue Finch — menus', contact_id: 'c1' });
  });

  test('a to-do on a deal, with a date', async ({ page }) => {
    await installApp(page, { api: FIXTURES });
    const calls = await salesServer(page);
    await page.goto('/agency.html');
    await openForm(page, 'Add a to-do');
    await dlg(page).locator('#cr-what').fill('Price the add-ons');
    await expect(dlg(page).locator('[data-chips=due] .cr-chip.on')).toHaveText('Tomorrow');
    await dlg(page).locator('[data-chips=due] .cr-chip', { hasText: 'Next week' }).click();
    await dlg(page).locator('#cr-who').fill('harbor');
    await option(page, 'Harbor Lane — logo').click();
    await expect(dlg(page).locator('.cr-go')).toHaveText('Add to-do');
    await dlg(page).locator('.cr-go').click();
    await expect(page.locator('.dds-toast').last()).toContainText('To-do added — Harbor Lane — logo');
    expect(writes(calls)).toEqual([`POST /sales/deals/${D4}/tasks`]);
    expect(calls.find((c) => c.path.endsWith('/tasks'))!.body).toEqual({ title: 'Price the add-ons', due_date: nextMonday() });
  });

  test('a proposal: only open deals, and it lands on the deal with a new proposal open', async ({ page }) => {
    await installApp(page, { api: FIXTURES });
    await salesServer(page);
    await page.goto('/agency.html');
    await openForm(page, 'Send a proposal');
    await expect(dlg(page).locator('#cr-who-hint')).toHaveText('Your open deals');
    const list = dlg(page).locator('#cr-who-list');
    await expect(list.locator('[role=option]')).toHaveCount(2);
    await expect(list).not.toContainText('Old job');                                       // won
    await expect(list).not.toContainText('Lost one');
    await dlg(page).locator('#cr-who').fill('old');
    await expect(dlg(page).locator('#cr-who-hint')).toHaveText('No one matches “old”. A proposal needs an open deal.');
    await dlg(page).locator('#cr-who').fill('finch');
    await option(page, 'Blue Finch').click();
    await expect(dlg(page).locator('.cr-go')).toHaveText('Open the proposal');
    await dlg(page).locator('.cr-go').click();
    await page.waitForURL(/\/pipeline\.html\?deal=/);
    await expect(page.locator('#propForm .pl-label').first()).toBeVisible();
    await expect(page.locator('#detailInner .tabs [data-dtab="billing"]')).toHaveAttribute('aria-selected', 'true');
    expect(new URL(page.url()).search).toBe(`?deal=${D1}&dtab=billing`);                   // a reload won't open another
  });

  test('a deal with a draft proposal already: that draft is the one to send, never a second', async ({ page }) => {
    await installApp(page, { api: FIXTURES });
    await salesServer(page);
    await page.goto(`/pipeline.html?deal=${D5}&dtab=billing&compose=proposal`);
    await expect(page.locator('[data-send-proposal="p-d"]')).toBeFocused();
    await expect(page.locator('.dds-toast').last()).toContainText('This deal already has a draft proposal');
    await expect(page.locator('#propForm .pl-label')).toHaveCount(0);
  });

  test('keys: c opens it, ⌘K finds "log a call", and a #create link opens its form once', async ({ page }) => {
    test.skip(isPhone(page), 'keyboard shortcuts are for a keyboard');
    await installApp(page, { api: FIXTURES });
    await salesServer(page);
    await page.goto('/agency.html');
    await expect(page.locator('#dds-create')).toBeVisible();
    await page.locator('body').press('c');
    await expect(dlg(page).locator('.cr-item')).toHaveCount(7);
    await expect(dlg(page).locator('.cr-item').first()).toBeFocused();
    await page.keyboard.press('i');                                                        // a letter in the menu picks its job
    await expect(dlg(page).locator('#dds-cr-title')).toHaveText('Send an invoice');
    await page.keyboard.press('Escape');
    await expect(dlg(page)).toBeHidden();
    await page.keyboard.press('Control+k');
    await page.locator('.dds-palette input').fill('log a call');
    await expect(page.locator('.dds-palette .res.sel')).toHaveAttribute('data-create', 'call');
    await page.locator('.dds-palette input').press('Enter');
    await expect(dlg(page).locator('#dds-cr-title')).toHaveText('Log a call');
    await expect(page.locator('.dds-palette')).not.toHaveClass(/open/);
    await page.keyboard.press('Escape');
    // the shortcuts list says so
    await page.locator('body').press('?');
    await expect(page.locator('.dds-keys')).toContainText('Create — log a call, a deal, an invoice…');
    await page.keyboard.press('Escape');
    // a link from anywhere: #create:invoice
    await page.goto('/agency.html#create:invoice');
    await expect(dlg(page).locator('#dds-cr-title')).toHaveText('Send an invoice');
    expect(new URL(page.url()).hash).toBe('');
  });

  test('only a studio at studio level: an owner and a studio inside a client get no Create', async ({ page }) => {
    await installApp(page);   // a business owner
    await page.goto('/today.html');
    await expect(page.locator('#dds-shell .dds-nav')).toBeAttached();
    await expect(page.locator('#dds-create')).toHaveCount(0);
    await expect(page.locator('#dds-mbar-create')).toHaveCount(0);
    if (isPhone(page)) await expect(page.locator('#dds-mbar-menu')).toBeVisible();
    if (!isPhone(page)) { await page.locator('body').press('c'); await expect(page.locator('dialog#dds-cr')).toHaveCount(0); }
    const CLIENT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    await installApp(page, { api: { ...FIXTURES, '/portal/context': { data: { ...STUDIO_CTX.data, nav: CLIENT_NAV, scope: { site_id: CLIENT, name: 'Joe’s Plumbing' } } } } });
    await page.goto(`/today.html?client=${CLIENT}`);
    await expect(page.locator('#dds-ctxbar')).toBeVisible();
    await expect(page.locator('#dds-create')).toHaveCount(0);
    await expect(page.locator('#dds-mbar-create')).toHaveCount(0);
  });

  test('a phone gets a sheet: tiles to pick from, the form’s button above the home bar, nothing wider than the screen', async ({ page }) => {
    test.skip(!isPhone(page), 'phone layout');
    await installApp(page, { api: FIXTURES });
    await salesServer(page);
    await page.goto('/agency.html');
    await openMenu(page);
    await settled(page);
    const vw = page.viewportSize()!.width, vh = page.viewportSize()!.height;
    expect(await dlg(page).locator('.cr-items').evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(' ').length)).toBe(3);
    const box = (await dlg(page).boundingBox())!;
    expect(Math.round(box.width)).toBe(vw);
    expect(Math.round(box.y + box.height)).toBe(vh);                                       // pinned to the bottom
    for (const tile of await dlg(page).locator('.cr-item').all()) expect((await tile.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await dlg(page).locator('.cr-item', { hasText: 'Log a call' }).click();
    await expect(dlg(page)).toHaveClass(/form/);
    await settled(page);
    const go = (await dlg(page).locator('.cr-go').boundingBox())!;
    expect(go.y + go.height).toBeLessThanOrEqual(vh);
    expect(go.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    for (const chip of await dlg(page).locator('.cr-chip').all()) expect((await chip.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

  // a page that already knows the deal (the Customers preview) passes it along
  test('a page that knows the deal starts the form on it: from the first read, or that one deal read by id', async ({ page }) => {
    await installApp(page, { api: { ...FIXTURES, [`/sales/deals/${D9}`]: { data: {
      deal: { id: D9, title: 'Zed — retainer', stage: 'qualified', contact_id: 'c9', expected_value_cents: 0 },
      contact: { id: 'c9', name: 'Zed Far', email: 'zed@example.com', company: 'Far & Wide' } } } } });
    await salesServer(page);
    await page.goto('/agency.html');
    const open = (kind: string, id: string) => page.evaluate(([k, d]) => (window as unknown as { ddsOpenCreate: (...a: unknown[]) => boolean }).ddsOpenCreate(k, null, false, { deal_id: d }), [kind, id]);
    await expect(page.locator(isPhone(page) ? '#dds-mbar-create' : '#dds-create')).toBeVisible();   // the shell knows who's here
    expect(await open('call', D1)).toBe(true);
    await expect(dlg(page).locator('#dds-cr-title')).toHaveText('Log a call');
    await expect(dlg(page).locator('#cr-picked')).toContainText('Jane Doe');
    await expect(dlg(page).locator('#cr-whobox')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(dlg(page)).toBeHidden();
    expect(await open('invoice', D9)).toBe(true);                                           // past the first read: asked for by id
    await expect(dlg(page).locator('#dds-cr-title')).toHaveText('Send an invoice');
    await expect(dlg(page).locator('#cr-picked')).toContainText('Zed Far');
  });

  test('an open invoice for a different amount: it says so, and offers to send a second one beside it', async ({ page }) => {
    await installApp(page, { api: FIXTURES });
    const calls = await salesServer(page, { invoice: (body, n) => n === 1
      ? { status: 409, json: { error: 'amount_mismatch', message: 'There’s an open $2,500 invoice on this deal.' } }
      : { status: 201, json: { data: { id: 'inv-3' }, url: 'https://pay.example/inv-3', emailed: true, reused: false, amount_cents: body.amount_cents } } });
    await page.goto('/agency.html');
    await openForm(page, 'Send an invoice');
    await option(page, 'Jane Doe').click();
    await dlg(page).locator('#cr-amt').fill('500');
    await dlg(page).locator('.cr-go').click();
    const err = dlg(page).locator('.cr-err');
    await expect(err).toContainText('There’s an open $2,500 invoice on this deal.');
    await err.getByRole('button', { name: 'Send a second invoice' }).click();
    await expect(page.locator('.dds-toast').last()).toContainText('Invoice sent — emailed to Jane Doe');
    const sent = calls.filter((c) => c.path.endsWith('/invoice')).map((c) => c.body || {});
    expect(sent.map((b) => b.force)).toEqual([undefined, true]);                           // only the yes sends one beside it
    expect(sent.map((b) => b.amount_cents)).toEqual([50000, 50000]);
  });

  test('Pipeline catches up after a create, quietly', async ({ page }) => {
    await installApp(page, { api: FIXTURES });
    const calls = await salesServer(page);
    await page.goto('/pipeline.html');
    const deal = page.locator(`#board .bcard[data-id="${D1}"], #list .card[data-id="${D1}"]`).first();   // on a phone's board it may sit behind another stage's tab
    await expect(deal).toBeAttached();
    const reads = () => calls.filter((c) => c.method === 'GET' && c.path === '/sales/deals').length;
    const before = reads();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('dds:created', { detail: { kind: 'deal' } })));   // what create.js sends after a save
    await expect.poll(reads).toBeGreaterThan(before);
    await expect(deal).toBeAttached();
  });
});
