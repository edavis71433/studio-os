import { test, expect, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp } from './helpers/app';

// Sales item 90 and builder item 75 (Nov 2026).
//   filters   Pipeline and Contacts filter by a field: not contacted in 30, 60 or 90 days, owes
//             you money, no deal yet, closing or added this month, how they found you; a saved
//             view keeps them. Pipeline filters the deals it holds; Contacts asks the server.
//   bulk      picked deals move a stage, get a close date or a to-do; picked people get how they
//             found you, a tag, or are deleted. Each says what it did and offers Undo.
//   item 75   bulk "Not a fit" takes the reason first, and Undo puts each deal back; bulk "Mark
//             as" on Customers takes an optional private reason and can be undone too.
//   in place  a deal's value, close date and next step change right in the table.

const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();
const ymd = (t: Date) => t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
const now = new Date();
const thisMonth = (d: number) => new Date(now.getFullYear(), now.getMonth(), d, 12);
const pin = (page: Page, key: string) => page.addInitScript((k) => { try { localStorage.setItem(k, 'table'); } catch { /* denied */ } }, key);
const did = (n: number) => `dddddddd-0000-4000-8000-00000000000${n}`;
const DEALS = [
  { id: did(1), title: 'Harbor Dental site', stage: 'lead', source: 'manual', expected_value_cents: 320000, expected_close: null, contact_id: null, converted_client_id: null, found_via: 'Google', owes_cents: 0, last_contacted_at: ago(70), created_at: thisMonth(1).toISOString(), updated_at: ago(1) },
  { id: did(2), title: 'Juniper Floral shop', stage: 'proposal', source: 'manual', expected_value_cents: 250000, expected_close: ymd(thisMonth(20)), contact_id: null, converted_client_id: null, found_via: 'Referral', owes_cents: 250000, last_contacted_at: ago(3), created_at: ago(45), updated_at: ago(2), next_step: 'Send the quote', next_step_at: ymd(thisMonth(25)) },
  { id: did(3), title: 'Blue Finch orders', stage: 'contract', source: 'manual', expected_value_cents: 185000, expected_close: null, contact_id: null, converted_client_id: null, found_via: '', owes_cents: 0, last_contacted_at: null, created_at: ago(90), updated_at: ago(3) },
  { id: did(4), title: 'Copper Kettle menu', stage: 'won', source: 'manual', expected_value_cents: 480000, expected_close: null, contact_id: null, converted_client_id: 'k1', found_via: 'Google', owes_cents: 90000, last_contacted_at: ago(100), created_at: ago(120), updated_at: ago(4) },
];
const PIPE = {
  '/sales/deals': { data: DEALS },
  '/sales/contacts': { data: [] },
  '/sales/summary': { data: { total: 4, open: { count: 3, value_cents: 755000 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 1, lost: 0 }, by_stage: [], ar: { outstanding_cents: 0, count: 0 } } },
  '/sales/receivables': { data: { items: [], total_cents: 0 } },
  '/settings': { data: { stage_stale_days: {} } },
  '/sales/views': { data: { customers: [], contacts: [], pipeline: [] } },
};
const titles = (page: Page) => page.locator('#table tbody tr .dn').allTextContents();
type Sent = { method: string; path: string; body: Record<string, unknown> | null };
// every write the page sends, answered the way the server would
async function spyWrites(page: Page, sent: Sent[]) {
  await page.route((u) => u.pathname.includes('/functions/v1/presence/') && /\/sales\/(deals|deal-tasks|contacts)\/|\/projects\//.test(u.pathname), (route: Route) => {
    const r = route.request(); const method = r.method();
    if (method === 'GET') return route.fallback();
    const path = new URL(r.url()).pathname.replace(/^.*\/functions\/v1\/presence/, '') + new URL(r.url()).search;
    const body = r.postDataJSON?.() ?? null;
    sent.push({ method, path, body });
    if (/\/tasks$/.test(path)) return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: 'tttttttt-0000-4000-8000-00000000000' + sent.length, title: body?.title } }) });
    if (method === 'PATCH' && /\/sales\/deals\//.test(path)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { id: path.split('/')[3], ...body } }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ok: true } }) });
  });
}
// the message that says what was done, and its Undo (named by its words: a toast just pressed lingers a moment)
const undo = (page: Page, words: string) => page.locator('.dds-toast', { hasText: words }).filter({ has: page.getByRole('button', { name: 'Undo' }) });

test.describe('Pipeline: field filters, more bulk actions and edit in place (item 90, builder 75)', () => {
  test('filters narrow the table, each chip says how many it keeps, and a saved view keeps them', async ({ page }) => {
    const puts: Array<Record<string, unknown>> = [];
    await pin(page, 'dds-display:pipeline');
    await installApp(page, { api: PIPE });
    await page.route((u) => u.pathname.endsWith('/sales/views'), (route) => {
      if (route.request().method() !== 'PUT') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PIPE['/sales/views']) });
      const b = route.request().postDataJSON(); puts.push(b);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { customers: [], contacts: [], pipeline: b.views.map((v: Record<string, unknown>, i: number) => ({ id: 'view-new' + i, ...v })) } }) });
    });
    await page.goto('/pipeline.html');
    await expect(page.locator('#table tbody tr')).toHaveCount(4);
    const chips = page.locator('#fchips');
    await expect(chips.getByRole('button', { name: /Owes you money\s*2/ })).toBeVisible();
    await expect(chips.getByRole('button', { name: /Closing this month\s*1/ })).toBeVisible();
    await expect(chips.getByRole('button', { name: /Added this month\s*1/ })).toBeVisible();
    await chips.getByRole('button', { name: /Owes you money/ }).click();
    expect(await titles(page)).toEqual(expect.arrayContaining(['Juniper Floral shop', 'Copper Kettle menu']));
    await expect(page.locator('#table tbody tr')).toHaveCount(2);
    await expect(chips.getByRole('button', { name: /Owes you money/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(chips.getByRole('button', { name: /Owes you money/ })).toBeFocused();
    await chips.getByLabel('Not contacted in').selectOption('60');
    expect(await titles(page)).toEqual(['Copper Kettle menu']);
    await chips.getByRole('button', { name: /Owes you money/ }).click();   // off again: never contacted counts as not contacted
    expect((await titles(page)).sort()).toEqual(['Blue Finch orders', 'Copper Kettle menu', 'Harbor Dental site']);
    await chips.getByLabel('How they found you').selectOption('Google');
    expect((await titles(page)).sort()).toEqual(['Copper Kettle menu', 'Harbor Dental site']);
    // saved with a view
    const views = page.locator('#pvBtn');
    if (await page.locator('#moreBtn').isVisible() && !(await views.isVisible())) test.skip(true, 'the phone keeps Views off the toolbar');
    await views.click();
    await page.locator('#pvSave').click();
    const dlg = page.getByRole('dialog', { name: 'Save this view' });
    await dlg.getByLabel('Name').fill('Quiet Google leads');
    await dlg.getByRole('button', { name: 'Save view' }).click();
    await expect.poll(() => puts.length).toBe(1);
    const saved = (puts[0].views as Array<Record<string, unknown>>).find((v) => v.name === 'Quiet Google leads')!;
    expect(saved.filters).toEqual({ quiet: 60, via: 'Google' });
    await chips.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.locator('#table tbody tr')).toHaveCount(4);
  });

  test('bulk Not a fit asks for the reason first, says it, and Undo puts each deal back where it was', async ({ page }) => {
    const sent: Sent[] = [];
    await pin(page, 'dds-display:pipeline');
    await installApp(page, { api: PIPE });
    await spyWrites(page, sent);
    await page.goto('/pipeline.html');
    await page.getByLabel('Select Harbor Dental site').check();
    await page.getByLabel('Select Juniper Floral shop').check();
    const bar = page.getByRole('region', { name: 'Selected deals' });
    await bar.getByRole('button', { name: 'Mark as not a fit' }).click();
    const ask = bar.getByRole('group', { name: 'Mark 2 deals as not a fit?' });
    await ask.getByRole('button', { name: 'Mark them not a fit' }).click();
    await expect(ask).toContainText('Pick the reason first.');
    expect(sent).toEqual([]);
    await ask.getByLabel('Why they weren’t a fit').selectOption('Price');
    await ask.getByRole('button', { name: 'Mark them not a fit' }).click();
    await expect.poll(() => sent.length).toBe(2);
    expect(sent.map((s) => s.body)).toEqual([{ to: 'lost', reason: 'Price' }, { to: 'lost', reason: 'Price' }]);
    await undo(page, '2 marked not a fit (Price).').getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => sent.length).toBe(4);
    expect(sent.slice(2).map((s) => [s.path, s.body])).toEqual([
      [`/sales/deals/${did(1)}/stage`, { to: 'lead', undo: true }],
      [`/sales/deals/${did(2)}/stage`, { to: 'proposal', undo: true }],
    ]);
  });

  test('picked deals move a stage, get a close date or a to-do, and each can be undone', async ({ page }) => {
    const sent: Sent[] = [];
    await pin(page, 'dds-display:pipeline');
    await installApp(page, { api: PIPE });
    await spyWrites(page, sent);
    await page.goto('/pipeline.html');
    const bar = page.getByRole('region', { name: 'Selected deals' });
    // move: a lead steps forward; an agreement can't jump back two stages, and says so
    await page.getByLabel('Select Harbor Dental site').check();
    await page.getByLabel('Select Blue Finch orders').check();
    await bar.getByLabel('Move the selected deals to').selectOption('qualified');
    await bar.getByRole('group', { name: 'Move 2 deals to Qualified?' }).getByRole('button', { name: 'Yes, move them' }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toEqual({ method: 'POST', path: `/sales/deals/${did(1)}/stage`, body: { to: 'qualified' } });
    await undo(page, '1 moved to Qualified · 1 left where it is (a deal moves one stage at a time').getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => sent.length).toBe(2);
    expect(sent[1].body).toEqual({ to: 'lead' });
    // close date
    await page.getByLabel('Select Juniper Floral shop').check();
    await page.getByLabel('Select Blue Finch orders').check();
    await bar.getByRole('button', { name: 'Set close date' }).click();
    await bar.getByLabel('Close date', { exact: true }).fill('2030-03-15');
    await bar.getByRole('button', { name: 'Set it' }).click();
    await expect.poll(() => sent.length).toBe(4);
    expect(sent.slice(2).map((s) => [s.method, s.body])).toEqual([['PATCH', { expected_close: '2030-03-15' }], ['PATCH', { expected_close: '2030-03-15' }]]);
    await undo(page, '2 deals now close Mar 15, 2030.').getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => sent.length).toBe(6);
    expect(sent.slice(4).map((s) => s.body)).toEqual([{ expected_close: ymd(thisMonth(20)) }, { expected_close: null }]);
    // a to-do on each
    await page.getByLabel('Select Harbor Dental site').check();
    await page.getByLabel('Select Juniper Floral shop').check();
    await bar.getByRole('button', { name: 'Add a to-do' }).click();
    await bar.getByLabel('What needs doing?').fill('Call about the launch');
    await bar.getByLabel('Due (optional)').fill('2030-04-01');
    await bar.getByRole('button', { name: 'Add it' }).click();
    await expect.poll(() => sent.length).toBe(8);
    expect(sent.slice(6).map((s) => [s.path, s.body])).toEqual([
      [`/sales/deals/${did(1)}/tasks`, { title: 'Call about the launch', due_date: '2030-04-01' }],
      [`/sales/deals/${did(2)}/tasks`, { title: 'Call about the launch', due_date: '2030-04-01' }],
    ]);
    await undo(page, 'To-do added to 2 deals, due Apr 1, 2030.').getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => sent.length).toBe(10);
    expect(sent.slice(8).every((s) => s.method === 'PATCH' && /\/sales\/deal-tasks\//.test(s.path) && JSON.stringify(s.body) === '{"delete":true}')).toBe(true);
  });

  test('a deal\'s value, close date and next step change right in the table, without opening the deal', async ({ page }) => {
    const sent: Sent[] = [];
    await pin(page, 'dds-display:pipeline');
    await installApp(page, { api: PIPE });
    await spyWrites(page, sent);
    await page.goto('/pipeline.html');
    await page.getByRole('button', { name: 'Change the value of Harbor Dental site' }).click();
    const box = page.getByLabel('Value of Harbor Dental site');
    await expect(box).toBeFocused();
    await box.fill('5k');
    await box.press('Enter');
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toEqual({ method: 'PATCH', path: `/sales/deals/${did(1)}`, body: { expected_value_cents: 500000 } });
    await expect(page.locator('#table tr', { hasText: 'Harbor Dental site' })).toContainText('$5,000');
    await expect(page.getByRole('button', { name: 'Change the value of Harbor Dental site' })).toBeFocused();
    await expect(page.locator('#detailWrap')).toBeHidden();   // the deal never opened
    // Escape leaves it as it was
    await page.getByRole('button', { name: 'Change the close date of Blue Finch orders' }).click();
    await page.getByLabel('Close date of Blue Finch orders', { exact: true }).press('Escape');
    await expect(page.getByLabel('Close date of Blue Finch orders', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Change the close date of Blue Finch orders' })).toBeFocused();
    expect(sent.length).toBe(1);
    // the next step, with its day
    await page.getByRole('button', { name: 'Change the next step of Juniper Floral shop' }).click();
    await page.getByLabel('Next step for Juniper Floral shop').fill('Call Thursday');
    await page.getByLabel('When, for Juniper Floral shop').fill('2030-02-07');
    await page.locator('#table form.ced').getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => sent.length).toBe(2);
    expect(sent[1].body).toEqual({ next_step: 'Call Thursday', next_step_at: '2030-02-07' });
    await expect(page.locator('#table tr', { hasText: 'Juniper Floral shop' })).toContainText('Call Thursday');
  });
});

test.describe('the new pieces read clearly (item 90, builder 75)', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`filter chips, the bulk bar and its question pass the contrast check (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await pin(page, 'dds-display:pipeline');
      await installApp(page, { api: PIPE });
      await page.goto('/pipeline.html');
      await page.locator('#fchips').getByRole('button', { name: /Owes you money/ }).click();
      expect((await new AxeBuilder({ page }).include('#fchips').withRules(['color-contrast']).analyze()).violations).toEqual([]);
      await page.getByLabel('Select Juniper Floral shop').check();
      await page.getByRole('region', { name: 'Selected deals' }).getByRole('button', { name: 'Mark as not a fit' }).click();
      expect((await new AxeBuilder({ page }).include('.dds-bulk').withRules(['color-contrast']).analyze()).violations).toEqual([]);
    });
  }
});

const cid = (n: number) => `cccccccc-0000-4000-8000-00000000000${n}`;
const PEOPLE = [
  { id: cid(1), name: 'Avery Stone', email: 'avery@example.com', phone: '', company: 'Stone Bakery', found_via: '', tags: ['bakery'], updated_at: ago(1) },
  { id: cid(2), name: 'Blake Rowe', email: 'blake@example.com', phone: '', company: '', found_via: 'Google', tags: [], updated_at: ago(2) },
];
test.describe('Contacts: field filters asked of the server, and more for the people picked (item 90)', () => {
  test('each filter goes to the server with the page read; Clear takes them all off', async ({ page }) => {
    const reads: URL[] = [];
    await pin(page, 'dds-display:contacts');
    await installApp(page, { api: { '/sales/contacts': { data: PEOPLE, total: 2 } } });
    await page.route((u) => u.pathname.endsWith('/sales/contacts'), (route) => { reads.push(new URL(route.request().url())); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: PEOPLE, total: 2 }) }); });
    await page.goto('/contacts.html');
    await expect(page.locator('tbody tr')).toHaveCount(2);
    const chips = page.locator('#fchips');
    const last = () => reads[reads.length - 1].searchParams;
    await chips.getByRole('button', { name: 'No deal yet' }).click();
    await expect.poll(() => last().get('nodeal')).toBe('1');
    await expect(chips.getByRole('button', { name: 'No deal yet' })).toHaveAttribute('aria-pressed', 'true');
    await chips.getByLabel('Not contacted in').selectOption('90');
    await expect.poll(() => last().get('quiet')).toBe('90');
    expect(last().get('nodeal')).toBe('1');
    await chips.getByRole('button', { name: 'Owes you money' }).click();
    await expect.poll(() => last().get('owes')).toBe('1');
    await chips.getByLabel('How they found you').selectOption('Referral');
    await expect.poll(() => last().get('via')).toBe('Referral');
    await chips.getByRole('button', { name: 'Added this month' }).click();
    await expect.poll(() => last().get('created_since')).toBe(new Date(now.getFullYear(), now.getMonth(), 1).toISOString());
    await chips.getByRole('button', { name: 'Clear filters' }).click();
    await expect.poll(() => ['quiet', 'owes', 'nodeal', 'via', 'created_since'].some((k) => last().has(k))).toBe(false);
  });

  test('picked people get how they found you, a tag, or are deleted, each with Undo', async ({ page }) => {
    const sent: Sent[] = [];
    await pin(page, 'dds-display:contacts');
    await installApp(page, { api: { '/sales/contacts': { data: PEOPLE, total: 2 } } });
    await spyWrites(page, sent);
    await page.goto('/contacts.html');
    const bar = () => page.getByRole('region', { name: 'Selected contacts' });
    await page.getByLabel('Select Avery Stone').check();
    await page.getByLabel('Select Blake Rowe').check();
    await bar().getByLabel('How the selected people found you').selectOption('Referral');
    await bar().getByRole('button', { name: 'Yes, set it' }).click();
    await expect.poll(() => sent.length).toBe(2);
    expect(sent.map((s) => s.body)).toEqual([{ found_via: 'Referral' }, { found_via: 'Referral' }]);
    await undo(page, '2 people now found you via Referral.').getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => sent.length).toBe(4);
    expect(sent.slice(2).map((s) => s.body)).toEqual([{ found_via: '' }, { found_via: 'Google' }]);
    // a tag: added beside the ones they have; Undo puts the old list back
    await page.getByLabel('Select Avery Stone').check();
    await page.getByLabel('Select Blake Rowe').check();
    await bar().getByRole('button', { name: 'Add a tag' }).click();
    await bar().getByLabel('The tag').fill('Spring 2026');
    await bar().getByLabel('The tag').press('Enter');
    await expect.poll(() => sent.length).toBe(6);
    expect(sent.slice(4).map((s) => s.body)).toEqual([{ tags: ['bakery', 'spring 2026'] }, { tags: ['spring 2026'] }]);
    await undo(page, 'Tagged 2 people “spring 2026”.').getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => sent.length).toBe(8);
    expect(sent.slice(6).map((s) => s.body)).toEqual([{ tags: ['bakery'] }, { tags: [] }]);
    // delete asks first, then Undo brings them back
    await page.getByLabel('Select Avery Stone').check();
    await bar().getByRole('button', { name: 'Delete' }).click();
    await bar().getByRole('group', { name: 'Delete 1 person? Their deals, invoices and history stay.' }).getByRole('button', { name: 'Yes, delete them' }).click();
    await expect.poll(() => sent.length).toBe(9);
    expect(sent[8]).toEqual({ method: 'DELETE', path: `/sales/contacts/${cid(1)}?confirm=1`, body: null });
    await undo(page, 'Deleted 1 person.').getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => sent.length).toBe(10);
    expect(sent[9]).toEqual({ method: 'POST', path: `/sales/contacts/${cid(1)}/restore`, body: null });
  });
});

test.describe('Customers: bulk Mark as takes a reason and can be undone (builder item 75)', () => {
  test('the reason goes with the change, and Undo puts each one back to what it was', async ({ page }) => {
    const sent: Sent[] = [];
    await pin(page, 'dds-display:customers');
    await installApp(page, { api: { '/studio/customers': { data: [
      { client_id: 'c-acme', name: 'Acme Bakery', email: 'a@acme.example', project_id: 'p1', status: 'active', customer_site_id: 'site-acme', open_support: 0, project_count: 1 },
      { client_id: 'c-beta', name: 'Beta Salon', email: 'b@beta.example', project_id: 'p2', status: 'on_hold', customer_site_id: 'site-beta', open_support: 0, project_count: 1 },
    ] } } });
    await spyWrites(page, sent);
    await page.goto('/customers.html');
    await page.getByLabel('Select Acme Bakery').check();
    await page.getByLabel('Select Beta Salon').check();
    const bar = page.getByRole('region', { name: 'Selected customers' });
    await bar.getByLabel('Mark the selected customers as').selectOption('on_hold');
    const ask = bar.getByRole('group', { name: 'Mark 2 customers on hold?' });
    await ask.getByLabel('Why (optional, only your team sees it)').fill('Waiting on their photos');
    await ask.getByRole('button', { name: 'Yes, mark them' }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toEqual({ method: 'POST', path: '/projects/p1/status', body: { to: 'on_hold', reason: 'Waiting on their photos' } });
    await undo(page, '1 marked on hold · 1 already on hold.').getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => sent.length).toBe(2);
    expect(sent[1]).toEqual({ method: 'POST', path: '/projects/p1/status', body: { to: 'active' } });
  });
});
