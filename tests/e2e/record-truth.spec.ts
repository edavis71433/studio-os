import { test, expect, type Page } from '@playwright/test';
import { installApp } from './helpers/app';

// List items 98 and 99 (Nov 10 bug hunt, B4 · B10–B12 · B15 · B17 · B18 and the small
// record ones): the record page tells the truth.
//   B4  "Last talked" reads the date the deal read sends beside the deal
//   B10 an older deal's link keeps that deal through the address tidy-up (and ?act=)
//   B11 the Money card leaves voided invoices out and shows the newest first
//   B12 the Deal and Money cards catch up after a stage move or an invoice
//   B15 a payment or signature shows on the local day it happened
//   B17 no connection: the button comes back and the page says why
//   B18 after a contact edit the header shows the new name
//   B21 the Project card's percent is the Project tab's; removing a note asks first;
//       "link copied" only when it was; the composer keeps its drafts across tabs;
//       Escape gives focus back to More; the close date reads "Nov 30"; on a phone
//       the name stays beside the avatar
// Every name below is made up.

const CLIENT = 'cccccccc-3333-4333-8333-cccccccccccc';   // the customer's site
const DEAL = 'dddddddd-4444-4444-8444-dddddddddddd';
const OLD_DEAL = 'dddddddd-5555-4555-8555-dddddddddddd';
const PROJECT = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee';
const OLD_PROJECT = 'eeeeeeee-6666-4666-8666-eeeeeeeeeeee';
const CID = 'ffffffff-6666-4666-8666-ffffffffffff';

const HEADER = { name: 'Harbor Lane Bakery', person: 'Ana Ruiz', company: 'Harbor Lane Bakery', email: 'ana@harbor.example', phone: '', status: 'customer' };
const record = (over: Record<string, unknown> = {}) => ({ data: {
  identity: { contact_id: CID, deal_id: DEAL, client_id: 'cl-1', customer_site_id: CLIENT, project_id: null },
  header: HEADER, highlights: {},
  sections: { overview: true, messages: true, deal: true, delivery: false, details: true },
  default_tab: 'deal', canonical: { key: 'client', value: CLIENT }, ...over,
} });
const DEAL_ROW = { id: DEAL, title: 'Website rebuild', stage: 'proposal', expected_value_cents: 300000, contact_id: CID, converted_client_id: null, next_step: null, next_step_at: null, expected_close: '2026-11-30', source: 'manual', retainer: null };
const dealRead = (over: Record<string, unknown> = {}) => ({ data: {
  deal: DEAL_ROW, contact: { id: CID, name: 'Ana Ruiz', email: 'ana@harbor.example' },
  proposals: [], contracts: [], events: [], timeline: [], invoices: [], estimates: [], recurring: [], last_contacted_at: null, ...over,
} });
const API = (over: Record<string, Record<string, unknown>> = {}) => ({
  '/crm/record': record(),
  [`/sales/deals/${DEAL}`]: dealRead(),
  '/crm/activity': { data: { items: [], upcoming: [], reply_to: null, reply_support_to: null } },
  '/sales/stages': { data: { chances: { lead: 10, qualified: 25, proposal: 50, contract: 75 } } },
  [`/sales/contacts/${CID}`]: { data: { contact: { id: CID, name: 'Ana Ruiz', company: 'Harbor Lane Bakery', email: 'ana@harbor.example', phone: '' }, custom_fields: [], deals: [] } },
  ...over,
});
const tile = (page: Page, k: string) => page.locator('#hlpanel .hl').filter({ has: page.locator('.hl-k', { hasText: new RegExp('^' + k + '$') }) });
const toastWith = (page: Page, text: string) => page.locator('.dds-toast').filter({ hasText: text });
const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();

test.describe('item 98 — "Last talked" (B4)', () => {
  test('shows the deal’s last contact, and moves the moment a call is logged', async ({ page }) => {
    await installApp(page, { api: API({ [`/sales/deals/${DEAL}`]: dealRead({ last_contacted_at: daysAgo(3) }) }) });
    const logged: unknown[] = [];
    await page.route(`**/functions/v1/presence/sales/deals/${DEAL}/activity`, (route) => {
      logged.push(route.request().postDataJSON());
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { item: { id: 'ev-1' }, last_contacted_at: new Date().toISOString() } }) });
    });
    await page.goto(`/crm.html?client=${CLIENT}`);
    await expect(tile(page, 'Last talked')).toContainText('3 days ago');
    await expect(tile(page, 'Last talked')).not.toContainText('Nothing logged yet');
    await page.getByRole('tab', { name: 'Log a call' }).click();
    await page.locator('#logGo').click();
    await expect.poll(() => logged.length).toBe(1);
    await expect(tile(page, 'Last talked')).toContainText('today');
  });

  test('a deal with nothing logged still says so', async ({ page }) => {
    await installApp(page, { api: API() });
    await page.goto(`/crm.html?client=${CLIENT}`);
    await expect(tile(page, 'Last talked')).toContainText('Nothing logged yet');
  });
});

test.describe('item 98 — an older deal’s link opens that deal (B10)', () => {
  test('?deal= of an older deal keeps the deal (and its project) through the tidy-up to ?client=', async ({ page }) => {
    const asked: string[] = [];
    await installApp(page, { api: API({ [`/sales/deals/${OLD_DEAL}`]: dealRead({ deal: { ...DEAL_ROW, id: OLD_DEAL, title: 'Logo refresh (2025)' } }) }) });
    await page.route('**/functions/v1/presence/crm/record**', (route) => {
      asked.push(new URL(route.request().url()).search);
      // whatever the address, the server resolves the OLD deal it was asked for, on the customer's site
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(record({ identity: { contact_id: CID, deal_id: OLD_DEAL, client_id: 'cl-1', customer_site_id: CLIENT, project_id: OLD_PROJECT } })) });
    });
    await page.goto(`/crm.html?deal=${OLD_DEAL}&client=`);
    await page.waitForURL((u) => u.searchParams.get('client') === CLIENT);
    const u = new URL(page.url());
    expect(u.searchParams.get('deal')).toBe(OLD_DEAL);
    expect(u.searchParams.get('project')).toBe(OLD_PROJECT);
    await expect.poll(() => asked.length).toBe(2);
    expect(asked[1]).toContain('deal=' + OLD_DEAL);                                // the second read asks for THAT deal, not the newest
    await page.getByRole('tab', { name: 'Deal' }).click();
    await expect(page.locator('#tabbody')).toContainText('Logo refresh (2025)');
  });

  test('?act=invoice rides along and opens the invoice form once', async ({ page }) => {
    await installApp(page, { api: API({ '/crm/record': record({ canonical: { key: 'client', value: CLIENT } }) }) });
    await page.goto(`/crm.html?deal=${DEAL}&act=invoice&client=`);
    await page.waitForURL((u) => u.searchParams.get('client') === CLIENT);
    await expect(page.locator('#bf-amt')).toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.get('act')).toBeNull();   // a reload doesn't open it again
  });
});

test.describe('item 98 — the Money and Deal cards (B11, B12)', () => {
  const INVOICES = [
    { id: 'i1', title: 'Deposit', amount_cents: 50000, purpose: 'deposit', status: 'paid', paid_at: '2026-09-02T12:00:00Z', due_date: '2026-09-01', created_at: '2026-09-01T12:00:00Z' },
    { id: 'i2', title: 'Old balance', amount_cents: 90000, purpose: 'service', status: 'void', due_date: '2026-10-15', created_at: '2026-10-01T12:00:00Z' },
    { id: 'i3', title: 'Launch balance', amount_cents: 250000, purpose: 'service', status: 'open', due_date: '2099-12-01', created_at: '2026-11-01T12:00:00Z' },
  ];
  test('a voided invoice is left out, and the newest comes first', async ({ page }) => {
    await installApp(page, { api: API({ [`/sales/deals/${DEAL}`]: dealRead({ invoices: INVOICES }) }) });
    await page.goto(`/crm.html?client=${CLIENT}`);
    const money = page.locator('section.sc').filter({ has: page.locator('#sc-money') });
    await expect(money.locator('.sc-list li')).toHaveCount(2);
    await expect(money.locator('.sc-list li').nth(0)).toContainText('Launch balance');
    await expect(money.locator('.sc-list li').nth(1)).toContainText('Deposit');
    await expect(money).not.toContainText('Old balance');
    await expect(money.getByRole('button', { name: 'All 3 on Billing →' })).toBeVisible();   // Billing still has all three
  });

  test('moving the stage on the path updates the Deal card beside it', async ({ page }) => {
    await installApp(page, { api: API() });
    await page.route(`**/functions/v1/presence/sales/deals/${DEAL}/stage`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ...DEAL_ROW, stage: 'contract' } }) }));
    await page.goto(`/crm.html?client=${CLIENT}`);
    const card = page.locator('section.sc').filter({ has: page.locator('#sc-deal') });
    await expect(card).toContainText('Proposal sent');
    await expect(card).toContainText('50%');
    await page.locator('#markComplete').click();
    await expect(card).toContainText('Agreement out');
    await expect(card).toContainText('75%');
  });

  test('an invoice sent from the record shows in the Money card at once', async ({ page }) => {
    let reads = 0;
    await installApp(page, { api: API() });
    await page.route(`**/functions/v1/presence/sales/deals/${DEAL}`, (route) => { reads++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dealRead(reads > 1 ? { invoices: [INVOICES[2]] } : {})) }); });
    await page.route(`**/functions/v1/presence/sales/deals/${DEAL}/invoice`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ emailed: true, url: 'https://pay.example/x' }) }));
    await page.goto(`/crm.html?client=${CLIENT}`);
    const money = page.locator('section.sc').filter({ has: page.locator('#sc-money') });
    await expect(money).toContainText('No invoices yet.');
    await page.locator('#act-invoice').click();
    await page.locator('#bf-amt').fill('2500');
    await page.locator('#bf-go').click();
    await expect(money).toContainText('Launch balance');
  });
});

test.describe('item 98 — moments on the local day (B15)', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });
  test('paid at 5:30pm Nov 3 in Los Angeles reads Nov 3; signed at 7pm Nov 1 reads Nov 1; an Oct 31 evening call sits under October', async ({ page }) => {
    await installApp(page, { api: API({
      [`/sales/deals/${DEAL}`]: dealRead({
        invoices: [{ id: 'i1', title: 'Deposit', amount_cents: 50000, purpose: 'deposit', status: 'paid', paid_at: '2026-11-04T01:30:00Z', due_date: '2026-11-03', created_at: '2026-10-20T12:00:00Z' }],
        contracts: [{ id: 'k1', title: 'Service agreement', status: 'signed', signer_name: 'Ana Ruiz', signed_at: '2026-11-02T03:00:00Z' }],
      }),
      '/crm/activity': { data: { items: [
        { id: 'a1', kind: 'activity', type: 'call', title: 'You logged a call', body: null, at: '2026-11-01T02:00:00Z', meta: 'Logged call', href: null },
      ], upcoming: [], reply_to: null, reply_support_to: null } },
    }) });
    await page.goto(`/crm.html?client=${CLIENT}&tab=billing`);
    await expect(tile(page, 'Paid')).toContainText('Deposit · Nov 3');
    const billing = page.locator('#tabbody');
    await expect(billing.locator('tr.brow').filter({ hasText: 'Deposit' })).toContainText('Nov 3');
    await expect(billing.locator('tr.brow').filter({ hasText: 'Deposit' })).not.toContainText('Nov 4');
    await expect(billing).toContainText('Signed by Ana Ruiz on Nov 1');
    await page.getByRole('tab', { name: 'Activity' }).click();
    await expect(page.locator('.tl-month').first()).toHaveText('October 2026');
  });
});

test.describe('item 99 — no connection (B17)', () => {
  test('a stage move with the connection gone: the button comes back and the page says why', async ({ page }) => {
    await installApp(page, { api: API() });
    await page.route(`**/functions/v1/presence/sales/deals/${DEAL}/stage`, (route) => route.abort('internetdisconnected'));
    await page.goto(`/crm.html?client=${CLIENT}`);
    await page.locator('#markComplete').click();
    await expect(toastWith(page, 'We couldn’t reach the server')).toBeVisible();
    await expect(page.locator('#markComplete')).toBeEnabled();
  });
});

test.describe('item 98 — the header after a contact edit (B18)', () => {
  test('saving a new name redraws the name at the top and the details card', async ({ page }) => {
    let saved = false;
    await installApp(page, { api: API() });
    await page.route('**/functions/v1/presence/crm/record**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(record(saved ? { header: { ...HEADER, name: 'Harbor Lane Bakehouse', company: 'Harbor Lane Bakehouse', phone: '555 0100' } } : {})) }));
    await page.route(`**/functions/v1/presence/sales/contacts/${CID}`, (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      saved = true;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { id: CID } }) });
    });
    await page.goto(`/crm.html?client=${CLIENT}&tab=details`);
    await expect(page.locator('#pagehead')).toHaveText('Harbor Lane Bakery');
    await page.locator('#editContact').click();
    await page.locator('#ec-company').fill('Harbor Lane Bakehouse');
    await page.locator('#ec-save').click();
    await expect(page.locator('#pagehead')).toHaveText('Harbor Lane Bakehouse');
    await expect(page.locator('#dcard')).toContainText('555 0100');
    await expect(page.locator('#actbar #act-invoice')).toBeVisible();   // the action bar stayed
  });
});

test.describe('item 98 — the small ones on the record (B21)', () => {
  test('the Project card says the Project tab’s percent, not a count of milestones', async ({ page }) => {
    await installApp(page, { api: API({
      '/crm/record': record({ identity: { contact_id: CID, deal_id: DEAL, client_id: 'cl-1', customer_site_id: CLIENT, project_id: PROJECT }, sections: { overview: true, messages: true, deal: true, delivery: true, details: true } }),
      [`/projects/${PROJECT}`]: { data: { project: { id: PROJECT, name: 'Bakery website', status: 'active' }, progress: { pct: 40 }, milestones: [{ title: 'Design', status: 'complete' }, { title: 'Build', status: 'active' }, { title: 'Content', status: 'planned' }, { title: 'Launch', status: 'planned' }], tasks: [], deliverables: [] } },
    }) });
    await page.goto(`/crm.html?client=${CLIENT}`);
    const card = page.locator('section.sc').filter({ has: page.locator('#sc-proj') });
    await expect(card.locator('.sc-pct')).toHaveText('40%');
    await page.getByRole('tab', { name: 'Project' }).click();
    await expect(page.locator('#tabbody')).toContainText('40% along');
  });

  test('removing a note asks first, in place; Cancel keeps it', async ({ page }) => {
    const deletes: string[] = [];
    await installApp(page, { api: API({ '/crm/notes': { data: { notes: [{ id: 'aaaaaaaa-0000-4000-8000-00000000000a', body: 'Prefers calls after 3pm', audience: 'internal', pinned: false, created_at: daysAgo(1) }], can_write_internal: true } } }) });
    await page.route('**/functions/v1/presence/crm/notes/*', (route) => { if (route.request().method() !== 'DELETE') return route.fallback(); deletes.push(route.request().url()); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":{"ok":true}}' }); });
    await page.goto(`/crm.html?client=${CLIENT}`);
    await page.locator('#fchips').getByRole('button', { name: 'Notes' }).click();
    await page.locator('#timeline').getByRole('button', { name: 'Remove' }).click();
    await expect(page.locator('#timeline')).toContainText('Remove this note? It can’t be undone.');
    await page.locator('#timeline').getByRole('button', { name: 'Cancel' }).click();
    expect(deletes).toEqual([]);
    await page.locator('#timeline').getByRole('button', { name: 'Remove' }).click();
    await page.locator('#timeline').getByRole('button', { name: 'Yes, remove it' }).click();
    await expect.poll(() => deletes.length).toBe(1);
  });

  test('a retainer says "link copied" only when the copy worked', async ({ page }) => {
    await installApp(page, { api: API() });
    await page.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } }); });
    await page.route(`**/functions/v1/presence/sales/deals/${DEAL}/retainer`, (route) => route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { retainer: { status: 'pending' }, url: 'https://pay.example/r', emailed: false } }) }));
    await page.goto(`/crm.html?client=${CLIENT}&tab=billing`);
    await page.locator('#tabbody').getByRole('button', { name: 'Set up a retainer' }).click();
    await page.locator('#bf-amt').fill('500');
    await page.locator('#bf-go').click();
    await expect(toastWith(page, 'Retainer set up — copy its authorization link from Billing.')).toBeVisible();
    await expect(toastWith(page, 'link copied')).toHaveCount(0);
  });

  test('the composer keeps what was typed across its tabs and the record’s', async ({ page }) => {
    await installApp(page, { api: API({ '/crm/activity': { data: { items: [], upcoming: [], reply_to: `/projects/${PROJECT}/messages`, reply_support_to: null } } }) });
    await page.goto(`/crm.html?client=${CLIENT}`);
    await page.locator('#msgBody').fill('Draft for Ana');
    await page.getByRole('tab', { name: 'Note' }).click();
    await page.locator('#noteBody').fill('A private thought');
    await page.getByRole('tab', { name: 'Message' }).click();
    await expect(page.locator('#msgBody')).toHaveValue('Draft for Ana');
    await page.getByRole('tab', { name: 'Details' }).click();
    await page.getByRole('tab', { name: 'Activity' }).click();
    await expect(page.locator('#msgBody')).toHaveValue('Draft for Ana');
    await page.getByRole('tab', { name: 'Note' }).click();
    await expect(page.locator('#noteBody')).toHaveValue('A private thought');
  });

  test('Escape on the More menu gives focus back to More', async ({ page }) => {
    await installApp(page, { api: API() });
    await page.goto(`/crm.html?client=${CLIENT}`);
    await page.locator('#act-more').click();
    await expect(page.locator('#act-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#act-menu')).toBeHidden();
    await expect(page.locator('#act-more')).toBeFocused();
  });

  test('the Deal tab says the close date as a date', async ({ page }) => {
    await installApp(page, { api: API() });
    await page.goto(`/crm.html?client=${CLIENT}&tab=deal`);
    await expect(page.locator('#tabbody .kv')).toContainText('Nov 30');
    await expect(page.locator('#tabbody .kv')).not.toContainText('2026-11-30');
  });

  test('the name stays beside the avatar at every width', async ({ page }) => {
    await installApp(page, { api: API({ '/crm/record': record({ header: { ...HEADER, name: 'Harbor Lane Bakery and Café' } }) }) });
    await page.goto(`/crm.html?client=${CLIENT}`);
    const ic = (await page.locator('.rec-head .obj-ic').boundingBox())!;
    const who = (await page.locator('.rec-head .rec-who').boundingBox())!;
    expect(who.x).toBeGreaterThan(ic.x + ic.width - 1);       // to its right…
    expect(who.y).toBeLessThan(ic.y + ic.height);             // …on the same line, not under it
  });
});
