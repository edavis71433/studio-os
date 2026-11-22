import { test, expect, type Page } from '@playwright/test';
import { installApp } from './helpers/app';
import { headerAction } from './helpers/page-header';

// Sales fixes of Nov 22 2026 (full review): the page halves.
//   150  Add a customer takes a phone; a name with a phone saves, nothing with neither
//   151  Home sends its own day and clock on the reads the server dates
//   153  "+ New deal" opens centred, asks for value, stage, expected close and how they found
//        you, and sends them; the email hint reads "so they can sign in later"
//   154  the record's More menu hangs from the button's right edge and stays on screen; the page
//        gets no sideways scroll bar
//   155  "Last talked" counts a message the client sent, not only the deal's logged contact
//   156  People calls a person a customer when a customer's own email is theirs
//   158  Home's "N customers you look after" is the Customers page's count
// Every name below is made up.

const CLIENT = 'cccccccc-3333-4333-8333-cccccccccccc';
const DEAL = 'dddddddd-4444-4444-8444-dddddddddddd';
const CID = 'ffffffff-6666-4666-8666-ffffffffffff';
const CUST = 'aaaaaaaa-7777-4777-8777-aaaaaaaaaaaa';
const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();
const tile = (page: Page, k: string) => page.locator('#hlpanel .hl').filter({ has: page.locator('.hl-k', { hasText: new RegExp('^' + k + '$') }) });
const toastWith = (page: Page, text: string) => page.locator('.dds-toast').filter({ hasText: text });

// ── a customer's record with a deal ──
const record = () => ({ data: {
  identity: { contact_id: CID, deal_id: DEAL, client_id: CUST, customer_site_id: CLIENT, project_id: null },
  header: { name: 'Harbor Lane Bakery', person: 'Ana Ruiz', company: 'Harbor Lane Bakery', email: 'ana@harbor.example', phone: '', status: 'customer' }, highlights: {},
  sections: { overview: true, messages: true, deal: true, delivery: false, details: true },
  default_tab: 'deal', canonical: { key: 'client', value: CLIENT },
} });
const dealRead = (over: Record<string, unknown> = {}) => ({ data: {
  deal: { id: DEAL, title: 'Website rebuild', stage: 'won', expected_value_cents: 300000, contact_id: CID, converted_client_id: CUST, next_step: null, next_step_at: null, expected_close: null, source: 'manual', retainer: null },
  contact: { id: CID, name: 'Ana Ruiz', email: 'ana@harbor.example' },
  proposals: [], contracts: [], events: [], timeline: [], invoices: [], estimates: [], recurring: [], last_contacted_at: null, ...over,
} });
const activity = (items: unknown[]) => ({ data: { items, upcoming: [], reply_to: null, reply_support_to: null } });
const RECORD_API = (over: Record<string, unknown> = {}) => ({
  '/crm/record': record(),
  [`/sales/deals/${DEAL}`]: dealRead({ last_contacted_at: daysAgo(120) }),
  '/crm/activity': activity([]),
  '/sales/stages': { data: { chances: {} } },
  [`/sales/customers/${CUST}`]: { data: { website: { state: 'ours', site_id: CLIENT, address: 'https://harbor.example', live: true, last_published_at: daysAgo(10), in_trash: false }, portal: { state: 'joined' }, offers: [] } },
  [`/sales/contacts/${CID}`]: { data: { contact: { id: CID, name: 'Ana Ruiz', company: 'Harbor Lane Bakery', email: 'ana@harbor.example', phone: '' }, custom_fields: [], deals: [] } },
  ...over,
});
const onScreen = async (page: Page, sel: string) => page.locator(sel).evaluate((el) => {
  const r = el.getBoundingClientRect(); const d = document.documentElement;
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, vw: window.innerWidth, vh: window.innerHeight, sideways: d.scrollWidth > d.clientWidth };
});

test.describe('item 154 — the record’s More menu stays on screen', () => {
  test('the menu hangs from the button and stays on screen, every row reads in full, and the page gets no sideways scroll bar', async ({ page }) => {
    await installApp(page, { api: RECORD_API() });
    await page.goto(`/crm.html?client=${CLIENT}`);
    const more = page.locator('#act-more');
    await expect(more).toBeVisible();
    await more.click();
    const menu = page.locator('#act-menu');
    await expect(menu).toBeVisible();
    const m = await onScreen(page, '#act-menu'), b = await onScreen(page, '#act-more');
    expect(m.right).toBeLessThanOrEqual(m.vw + 0.5);
    expect(m.left).toBeGreaterThanOrEqual(-0.5);
    // hung from the button's right edge; on a phone the button wraps to the left of its row, so the menu hangs from its left edge instead
    const fromRight = Math.abs(m.right - b.right) <= 1, fromLeft = Math.abs(m.left - b.left) <= 1;
    expect(fromRight || fromLeft, `menu ${m.left}–${m.right}, button ${b.left}–${b.right}`).toBe(true);
    if (!fromRight) expect(b.right - (m.right - m.left)).toBeLessThan(8);   // it only switches edges when the right-hung menu would run off the left
    expect(m.sideways).toBe(false);
    // no row is cut: each button's text fits inside its own box
    const cut = await menu.locator('.abtn').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
    expect(cut).toEqual([]);
  });
});

test.describe('item 155 — "Last talked" counts what the client wrote', () => {
  test('a client message newer than the deal’s logged contact wins, and the tile says they wrote last', async ({ page }) => {
    await installApp(page, { api: RECORD_API({ '/crm/activity': activity([
      { id: 'm1', kind: 'message', type: 'message', title: 'The client sent a message', body: 'Can we add a menu page?', at: daysAgo(5), meta: null, href: null },
      { id: 'n1', kind: 'activity', type: 'note', title: 'You added a note', body: 'Remember the logo', at: daysAgo(1), meta: 'Note', href: null },   // a note isn't talking
    ]) }) });
    await page.goto(`/crm.html?client=${CLIENT}`);
    await expect(tile(page, 'Last talked')).toContainText('5 days ago');
    await expect(tile(page, 'Last talked')).toContainText('They wrote last');
    await expect(tile(page, 'Last talked')).not.toContainText('4 months');
  });

  test('a logged contact newer than their last message still wins, and a bare deal still says nothing was logged', async ({ page }) => {
    await installApp(page, { api: RECORD_API({ [`/sales/deals/${DEAL}`]: dealRead({ last_contacted_at: daysAgo(2) }), '/crm/activity': activity([
      { id: 'm1', kind: 'message', type: 'message', title: 'The client sent a message', body: 'Hi', at: daysAgo(9), meta: null, href: null },
    ]) }) });
    await page.goto(`/crm.html?client=${CLIENT}`);
    await expect(tile(page, 'Last talked')).toContainText('2 days ago');
    await expect(tile(page, 'Last talked')).not.toContainText('They wrote last');
    await installApp(page, { api: RECORD_API({ [`/sales/deals/${DEAL}`]: dealRead() }) });
    await page.goto(`/crm.html?client=${CLIENT}`);
    await expect(tile(page, 'Last talked')).toContainText('Nothing logged yet');
  });
});

// ── Pipeline ──
const PIPE_API = {
  '/sales/deals': { data: [] },
  '/sales/contacts': { data: [] },
  '/sales/summary': { data: { total: 0, open: { count: 0, value_cents: 0 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 }, by_stage: [], expected: { value_cents: 0 } } },
  '/settings': { data: { stage_stale_days: {} } },
  '/crm/activity': { data: { items: [], upcoming: [] } },
};
test.describe('item 153 — the New deal box', () => {
  test('opens centred in the window, with Value, Stage, Expected close and How they found you, and a plain email hint', async ({ page }) => {
    await installApp(page, { api: PIPE_API });
    await page.goto('/pipeline.html');
    await page.locator('#newDeal').click();
    const dlg = page.locator('#formDlg');
    await expect(dlg).toBeVisible();
    const d = await onScreen(page, '#formDlg');
    expect(Math.abs((d.left + d.right) / 2 - d.vw / 2)).toBeLessThanOrEqual(2);   // centred side to side
    expect(Math.abs((d.top + d.bottom) / 2 - d.vh / 2)).toBeLessThanOrEqual(2);   // and top to bottom
    expect(d.left).toBeGreaterThan(0);
    for (const l of ['Deal title', 'Value', 'Stage', 'Expected close', 'How they found you', 'Client email', 'Client name', 'Phone']) await expect(dlg.getByLabel(new RegExp('^' + l))).toBeVisible();
    await expect(dlg).toContainText('so they can sign in later');
    await expect(dlg).not.toContainText('login on convert');
    await expect(dlg.locator('#f-stage option')).toHaveText(['New lead', 'Qualified', 'Proposal sent', 'Agreement out']);
    await expect(dlg.locator('#f-stage')).toHaveValue('lead');
  });

  test('sends the value in cents, the stage, the close date and the source with the deal; defaults send none', async ({ page }) => {
    const deals: Array<Record<string, unknown>> = [];
    await installApp(page, { api: PIPE_API });
    // the plain '/sales/deals' fixture (the list) would answer the POST too; the save is routed here
    await page.route(/\/functions\/v1\/presence\/sales\/deals(\?.*)?$/, (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      deals.push(route.request().postDataJSON());
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: 'dddddddd-9999-4999-8999-dddddddddddd' } }) });
    });
    await page.goto('/pipeline.html');
    await page.locator('#newDeal').click();
    await page.locator('#f-title').fill('Sunrise Yoga — site');
    await page.locator('#f-value').fill('$ 2,500');
    await page.locator('#f-stage').selectOption('qualified');
    await page.locator('#f-close').fill('2026-12-15');
    await page.locator('#f-via').selectOption('Referral');
    await page.locator('#formDlg').getByRole('button', { name: 'Save & New' }).click();
    await expect.poll(() => deals.length).toBe(1);
    expect(deals[0]).toEqual({ title: 'Sunrise Yoga — site', contact_id: null, expected_value_cents: 250000, stage: 'qualified', expected_close: '2026-12-15', found_via: 'Referral' });
    // Save & New cleared the new fields too
    await expect(page.locator('#f-value')).toHaveValue('');
    await expect(page.locator('#f-stage')).toHaveValue('lead');
    await page.locator('#f-title').fill('Plain one');
    await page.locator('#formDlg').getByRole('button', { name: 'Save & New' }).click();
    await expect.poll(() => deals.length).toBe(2);
    expect(deals[1]).toEqual({ title: 'Plain one', contact_id: null });
  });
});

// ── Customers › People ──
const PEOPLE_API = {
  '/studio/customers': { data: [
    { client_id: CUST, customer_site_id: CLIENT, project_id: 'p1', name: 'Harbor Lane Bakery', email: 'ana@harbor.example', status: 'active', open_support: 0, project_count: 1 },
  ] },
  '/sales/receivables': { data: { items: [], paid: [], total_cents: 0, overdue_cents: 0 } },
  '/sales/contacts': { data: [
    { id: 'c-1', name: 'Ana Ruiz', email: 'Ana@Harbor.example', phone: '', company: '', client_id: null, updated_at: daysAgo(1) },   // no link, but the customer's own email (any capitals)
    { id: 'c-2', name: 'Sam Rivera', email: 'sam@example.com', phone: '', company: '', client_id: null, updated_at: daysAgo(2) },
  ], total: 2 },
};
test.describe('item 156 — People knows a customer by the customer’s own email', () => {
  test('Ana is a customer (her email is Harbor Lane’s), Sam is not; the chips and the line count the same way', async ({ page }) => {
    await installApp(page, { api: PEOPLE_API });
    await page.goto('/customers.html?tab=people');
    const ana = page.locator('tr[data-person="c-1"]'), sam = page.locator('tr[data-person="c-2"]');
    await expect(ana.locator('[data-col="customer"]')).toContainText('Harbor Lane Bakery');
    await expect(ana.locator('[data-col="customer"] a')).toHaveAttribute('href', `/crm.html?client=${CLIENT}`);
    await expect(sam.locator('[data-col="customer"]')).toContainText('Not yet');
    await expect(page.locator('[data-pchip="customers"]')).toContainText('1');
    await expect(page.locator('[data-pchip="not"]')).toContainText('1');
    await expect(page.locator('#lmeta')).toContainText('2 people · 1 not a customer yet');
    await page.locator('[data-pchip="customers"]').click();
    await expect(page.locator('tr[data-person]')).toHaveCount(1);
    await expect(page.locator('tr[data-person="c-1"]')).toBeVisible();
  });
});

// ── Home ──
const row = (o: Record<string, unknown>) => ({ site_id: 's', name: 'x', status: 'active', edition: 'presence', health: 'healthy', leads_waiting: 0, archived: false, notes: '', tags: [], ...o });
const HOME_API = {
  '/agency/me': { data: { agency: 'Bright Studio', role: 'owner', plan: 'agency', branding: {} } },
  '/agency/portfolio': { data: [row({ site_id: 'a1', name: 'Fern Street Bakery' }), row({ site_id: 'a2', name: 'Lumen Dental' }), row({ site_id: 'a3', name: 'Ridge Garage' })] },
  '/agency/needs-you': { data: { rows: [], more: 0, rest: [], total: 0, empty_line: 'Everything is paid and published.', partial: false, own_site: true, next_by_site: {}, next_by_client: {} } },
  '/agency/kits': { data: [] },
  '/studio/customers': { data: [
    { client_id: 'c1', customer_site_id: 'a1', project_id: 'p1', name: 'Fern Street Bakery' },
    { client_id: 'c2', customer_site_id: 'a2', project_id: null, name: 'Lumen Dental' },
  ] },
  '/sales/summary': { data: { total: 0, open: { count: 0, value_cents: 0 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 }, by_stage: [], ar: {} } },
  '/sales/receivables': { data: { items: [], paid: [], total_cents: 0, overdue_cents: 0 } },
  '/sales/deals': { data: [] },
  '/sales/my-tasks': { data: { items: [], total: 0 } },
};
test.describe('items 151 and 158 — Home', () => {
  test('counts the Customers page’s customers, and sends its own day and clock on the reads the server dates', async ({ page }) => {
    const seen: Record<string, string> = {};
    page.on('request', (r) => { const u = new URL(r.url()); const p = u.pathname.replace(/^.*\/functions\/v1\/presence/, ''); if (['/sales/summary', '/sales/receivables', '/agency/needs-you'].includes(p) && !(p in seen)) seen[p] = u.search; });
    await installApp(page, { api: HOME_API });
    await page.goto('/agency.html');
    await expect(page.locator('.dds-ph-line')).toContainText('2 customers you look after');   // three sites, two customers: the Customers page's number
    const today = await page.evaluate(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); });
    const tzo = await page.evaluate(() => new Date().getTimezoneOffset());
    await expect.poll(() => Object.keys(seen).length).toBe(3);
    for (const p of ['/sales/summary', '/sales/receivables', '/agency/needs-you']) {
      const q = new URLSearchParams(seen[p]);
      expect(q.get('today'), p).toBe(today);
      expect(q.get('tzo'), p).toBe(String(tzo));
    }
  });
});

// ── Add a customer ──
test.describe('item 150 — Add a customer takes a phone', () => {
  test('a name with a phone and no email saves them; neither is refused on the page', async ({ page }) => {
    let sent: Record<string, unknown> | null = null;
    await installApp(page, { api: { ...HOME_API, 'POST /sales/customers': (b: Record<string, unknown>) => { sent = b; return { data: { mode: 'save', saved: true, created: true, client_id: CUST, contact_id: 'c-7', email: '' } }; } } });
    await page.goto('/agency.html');
    await (await headerAction(page, '#top button:has-text("+ Add a customer")')).first().click();
    const dlg = page.locator('#custDlg');
    await expect(dlg).toBeVisible();
    await expect(dlg.getByLabel(/^Phone/)).toBeVisible();
    await page.locator('#cu-submit').click();
    await expect(toastWith(page, 'Enter their email or phone number to save them.')).toBeVisible();
    expect(sent).toBeNull();
    await page.locator('#cu-phone').fill('(818) 555-0100');
    await page.locator('#cu-submit').click();
    await expect(toastWith(page, 'Enter their name too')).toBeVisible();
    expect(sent).toBeNull();
    await page.locator('#cu-name').fill('Ray Plumb');
    await page.locator('#cu-submit').click();
    await expect.poll(() => sent).not.toBeNull();
    expect(sent).toEqual({ mode: 'connect', save: true, name: 'Ray Plumb', phone: '(818) 555-0100' });
    await expect(dlg).toContainText('Ray Plumb');
  });
});
