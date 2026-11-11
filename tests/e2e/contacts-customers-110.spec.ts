import { test, expect, Page, Request } from '@playwright/test';
import { installApp, ALL_FEATURES, STUDIO_LEVEL_NAV } from './helpers/app';

// Sales item 110 (bug hunt K, Nov 10 2026): Contacts and Customers.
//   K2  the customer preview reads again after Refresh, open or not
//   K3  inside a client, Contacts offers no add, import or fields: those landed on the client's site
//   K4  past 100 people the sort, "Recently updated" and a saved search ask the server;
//       People's Customers / Not yet too
//   K5  bulk actions always end with a message
//   K6  on People, a reload repaints the list and leaves the search box alone

const id = (n: number) => `eeeeeeee-0000-4000-8000-${String(n).padStart(12, '0')}`;
// 240 people; "Aaron Able" was edited months ago, so the newest-first server page never held him
const PEOPLE = Array.from({ length: 240 }, (_, i) => ({
  id: id(i + 1), name: i === 239 ? 'Aaron Able' : `Person ${String(i + 1).padStart(3, '0')}`, email: `p${i + 1}@example.com`, phone: '', company: '',
  client_id: i % 4 === 0 ? 'c-acme' : null, updated_at: new Date(Date.now() - i * 86_400_000 - 3_600_000).toISOString(),
}));
type Seen = { offset: number; q: string; sort: string | null; dir: string | null; since: string | null; customer: string | null };
// a contacts route that answers like the server: sort + dir, since, customer, q, 100 a page, total
async function serveContacts(page: Page, people = PEOPLE) {
  const seen: Seen[] = [];
  await page.route(/\/functions\/v1\/presence\/sales\/contacts(\?|$)/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const u = new URL(route.request().url()), p = (k: string) => u.searchParams.get(k);
    const offset = Number(p('offset')) || 0, q = (p('q') || '').toLowerCase();
    seen.push({ offset, q, sort: p('sort'), dir: p('dir'), since: p('since'), customer: p('customer') });
    let rows = people.filter((c) => !q || `${c.name} ${c.email}`.toLowerCase().includes(q));
    if (p('since')) rows = rows.filter((c) => c.updated_at >= String(p('since')));
    if (p('customer') === 'yes') rows = rows.filter((c) => c.client_id); else if (p('customer') === 'no') rows = rows.filter((c) => !c.client_id);
    const key = p('sort') as keyof typeof people[number] | null, dir = p('dir') === 'desc' ? -1 : 1;
    rows = key ? [...rows].sort((a, b) => (String(a[key]) < String(b[key]) ? -dir : String(a[key]) > String(b[key]) ? dir : 0)) : [...rows].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
    const body: Record<string, unknown> = { data: rows.slice(offset, offset + 100), limit: 100, offset };
    if (p('total') === '1') body.total = rows.length;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return seen;
}
const firstName = (page: Page) => page.locator('#listZone [data-open]').first();

test.describe('Contacts past 100 people (item 110, K4)', () => {
  test('page one is the real top of the sort: Aaron Able first, though he was edited months ago', async ({ page }) => {
    await installApp(page);
    const seen = await serveContacts(page);
    await page.goto('/contacts.html');
    await expect(page.locator('#listZone [data-open]')).toHaveCount(100);
    await expect(firstName(page)).toContainText('Aaron Able');
    expect(seen[0]).toMatchObject({ offset: 0, sort: 'name', dir: 'asc' });
  });

  test('a new sort asks the server for its own first page; the header keeps the focus', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chromium', 'the sortable table is the wide-screen display (phones get cards)');
    await installApp(page);
    const seen = await serveContacts(page);
    await page.goto('/contacts.html');
    await expect(firstName(page)).toContainText('Aaron Able');
    await page.locator('[data-sort="name"]').click();          // Name, descending
    await expect(firstName(page)).toContainText('Person 239');
    expect(seen.at(-1)).toMatchObject({ offset: 0, sort: 'name', dir: 'desc' });
    await expect(page.locator('[data-sort="name"]')).toBeFocused();
    await page.locator('[data-sort="updated_at"]').click();    // Updated: newest first
    await expect(firstName(page)).toContainText('Person 001');
    expect(seen.at(-1)).toMatchObject({ sort: 'updated_at', dir: 'desc' });
    await expect(page.locator('#lmeta')).toContainText('100 of 240 contacts');
  });

  test('a small roster sorts on the page: no read', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chromium', 'the sortable table is the wide-screen display');
    await installApp(page);
    const seen = await serveContacts(page, PEOPLE.slice(0, 12));
    await page.goto('/contacts.html');
    await expect(page.locator('#listZone [data-open]')).toHaveCount(12);
    const n = seen.length;
    await page.locator('[data-sort="name"]').click();
    await expect(firstName(page)).toContainText('Person 012');
    expect(seen.length).toBe(n);
  });

  test('"Recently updated" is the server’s own list, with its own count', async ({ page }) => {
    await installApp(page);
    const seen = await serveContacts(page);
    await page.goto('/contacts.html');
    await expect(page.locator('#listZone [data-open]')).toHaveCount(100);
    await page.locator('#viewBtn').click();
    await page.locator('#viewMenu [data-view="recent"]').click();
    await expect(page.locator('#viewBtn')).toContainText('Recently updated');
    await expect.poll(() => seen.at(-1)?.since).toBeTruthy();
    await expect(page.locator('#listZone [data-open]')).toHaveCount(30);   // one edit a day: the last 30 days
    await expect(page.locator('#lmeta')).toContainText('30 contacts');
    await expect(page.locator('#viewBtn')).toBeFocused();
  });

  test('a saved view with a search in it looks through everyone, not the hundred loaded', async ({ page }) => {
    // newest edits first: Aaron, edited longest ago, is nowhere in the hundred loaded
    await installApp(page, { api: { '/sales/views': { data: { contacts: [{ id: 'v-aaron', name: 'Aaron', base: 'all', q: 'aaron', cols: [], sort: { key: 'updated_at', dir: -1 } }] } } } });
    const seen = await serveContacts(page);
    await page.goto('/contacts.html');
    await expect(page.locator('#listZone [data-open]')).toHaveCount(100);
    await page.locator('#viewBtn').click();
    await page.locator('#viewMenu [data-saved="v-aaron"]').click();
    await expect(page.locator('#listZone [data-open]')).toHaveCount(1);
    await expect(page.locator('#listZone')).toContainText('Aaron Able');
    expect(seen.some((s) => s.q === 'aaron')).toBe(true);
  });
});

const SCOPED_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'],
  landing: '/agency.html', attention_count: 0, nav: STUDIO_LEVEL_NAV, plan_key: 'presence', upsell: null,
  scope: { site_id: 'site-acme', label: 'Acme Bakery' },
} };

test.describe('Contacts inside a client (item 110, K3)', () => {
  test('no add, import or fields buttons: they filed people under the client, out of your list', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': SCOPED_CTX, '/sales/contacts': { data: [] } } });
    await page.goto('/contacts.html?client=site-acme');
    await expect(page.getByRole('heading', { name: 'Contacts live at the studio level.' })).toBeVisible();
    for (const sel of ['#new', '#addCust', '#importCsv', '#manageFields']) await expect(page.locator(sel)).toHaveCount(0);
    await expect(page.locator('#q')).toBeVisible();
  });

  test('at the studio level they are all there', async ({ page }) => {
    await installApp(page);
    await serveContacts(page, PEOPLE.slice(0, 3));
    await page.goto('/contacts.html');
    for (const sel of ['#new', '#addCust', '#importCsv', '#manageFields']) await expect(page.locator(sel)).toBeVisible();
  });
});

test.describe('Contacts: Send an update always ends with a message (item 110, K5)', () => {
  test('a dropped connection says nothing was sent and gives the button back', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chromium', 'picking rows is the table display');
    await installApp(page);
    await serveContacts(page, PEOPLE.slice(0, 3));
    await page.route('**/functions/v1/presence/broadcasts/lists', (r) => r.abort('internetdisconnected'));
    await page.goto('/contacts.html');
    await page.locator('#pickAll').check();
    await page.locator('#bulkSend').click();
    await expect(page.getByText('nothing was sent', { exact: false })).toBeVisible();
    await expect(page.locator('#bulkSend')).toBeEnabled();
  });
});

// ── Customers ──
const CUSTOMERS = { data: [
  { client_id: 'c-acme', name: 'Acme Bakery', person_name: 'Ada Park', email: 'ada@acme.example', project_id: 'p1', project_name: 'Website rebuild', status: 'active', customer_site_id: 'site-acme', open_support: 0, project_count: 1 },
  { client_id: 'c-beta', name: 'Beta Salon', person_name: 'Bo Reyes', email: 'bo@beta.example', project_id: 'p2', project_name: 'Booking page', status: 'active', customer_site_id: null, open_support: 0, project_count: 1 },
] };
const RECORD = { data: {
  identity: { client_id: 'c-acme', customer_site_id: 'site-acme', project_id: 'p1', deal_id: null, contact_id: null },
  header: { name: 'Acme Bakery', company: 'Acme Bakery', email: 'ada@acme.example', phone: '', status: 'customer' },
  highlights: { value_cents: 0, stage: 'won', owed_cents: 0 }, sections: { overview: true, details: true, deal: true, delivery: true }, default_tab: 'details', canonical: { key: 'client', value: 'site-acme' },
} };
const STUDIO_CTX = { data: { ...SCOPED_CTX.data, scope: null } };
const CUST_API = { '/portal/context': STUDIO_CTX, '/studio/customers': CUSTOMERS, '/sales/receivables': { data: { items: [], paid: [], total_cents: 0, overdue_cents: 0 } }, '/crm/record': RECORD };
const reads = (page: Page, path: string) => { const seen: Request[] = []; page.on('request', (r) => { if (r.method() === 'GET' && new URL(r.url()).pathname.endsWith(path)) seen.push(r); }); return seen; };

test.describe('Customers: the preview reads again after Refresh (item 110, K2)', () => {
  test('closed, refreshed, reopened: the latest is read again, not remembered', async ({ page }) => {
    let latest = 'Nothing logged yet';
    await installApp(page, { api: CUST_API });
    await page.route('**/functions/v1/presence/crm/activity**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { upcoming: [], items: latest === 'Nothing logged yet' ? [] : [{ id: 'a1', kind: 'deal_activity', type: 'call', title: latest, body: null, at: new Date().toISOString(), meta: 'Deal', href: null }] } }) }));
    const activity = reads(page, '/crm/activity');
    await page.goto('/customers.html');
    const open = () => page.locator('.cust').filter({ hasText: 'Acme Bakery' }).getByRole('button', { name: 'Preview Acme Bakery' }).click();
    await open();
    await expect(page.locator('#cprev').getByRole('heading', { level: 2 })).toHaveText('Acme Bakery');
    await expect.poll(() => activity.length).toBe(1);
    await page.locator('#cprev').getByRole('button', { name: 'Close preview' }).click();
    latest = 'You called Ada';
    await page.locator('#refreshBtn').click();
    await expect.poll(() => activity.length).toBe(1);   // closed: nothing read yet
    await open();
    await expect(page.locator('#cprev')).toContainText('You called Ada');
    expect(activity.length).toBe(2);
  });
});

test.describe('Customers › People past 100 (item 110, K4 and K6)', () => {
  test('Not yet asks the server for its people and their count', async ({ page }) => {
    await installApp(page, { api: CUST_API });
    const seen = await serveContacts(page);
    await page.goto('/customers.html?tab=people');
    await expect(page.locator('tr[data-person]')).toHaveCount(100);
    await page.locator('[data-pchip="not"]').click();
    await expect.poll(() => seen.at(-1)?.customer).toBe('no');
    await expect(page.locator('[data-pchip="not"]')).toContainText('180');
    await expect(page.locator('tr[data-person]')).toHaveCount(100);
    await expect(page.locator('[data-pchip="not"]')).toBeFocused();
    await page.locator('[data-pchip="all"]').click();
    await expect.poll(() => seen.at(-1)?.customer).toBeNull();
    await expect(page.locator('[data-pchip="all"]')).toContainText('240');
  });

  test('everyone loaded: the chips filter on the page with no read', async ({ page }) => {
    await installApp(page, { api: CUST_API });
    const seen = await serveContacts(page, PEOPLE.slice(0, 8));
    await page.goto('/customers.html?tab=people');
    await expect(page.locator('tr[data-person]')).toHaveCount(8);
    const n = seen.length;
    await page.locator('[data-pchip="not"]').click();
    await expect(page.locator('tr[data-person]')).toHaveCount(6);
    expect(seen.length).toBe(n);
  });

  test('a reload while you type keeps the search box, its words and the focus', async ({ page }) => {
    await installApp(page, { api: CUST_API });
    await serveContacts(page, PEOPLE.slice(0, 8));
    await page.goto('/customers.html?tab=people');
    await expect(page.locator('tr[data-person]')).toHaveCount(8);
    const box = page.locator('#search');
    await box.click();
    await box.pressSequentially('Person 00');
    await page.evaluate(() => { (window as unknown as { __box: Element | null }).__box = document.getElementById('search'); window.dispatchEvent(new Event('dds:created')); });
    await expect(page.locator('tr[data-person]')).toHaveCount(8);
    expect(await page.evaluate(() => (window as unknown as { __box: Element | null }).__box === document.getElementById('search'))).toBe(true);
    await expect(box).toBeFocused();
    await expect(box).toHaveValue('Person 00');
  });
});

test.describe('Customers: Mark as always ends with a message (item 110, K5)', () => {
  test('a list that can’t refresh after marking says so', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chromium', 'picking rows is the table display');
    await installApp(page, { api: CUST_API });
    let customersReads = 0;
    await page.route('**/functions/v1/presence/studio/customers', (r) => (++customersReads > 1 ? r.abort('internetdisconnected') : r.fallback()));
    await page.goto('/customers.html');
    await page.locator('#dispTable').click().catch(() => { /* already a table */ });
    await page.locator('#pickAll').check();
    await page.locator('#bulkMark').selectOption('on_hold');
    await page.getByRole('button', { name: 'Yes, mark them' }).click();
    await expect(page.getByText('couldn’t refresh the list', { exact: false })).toBeVisible();
  });
});
