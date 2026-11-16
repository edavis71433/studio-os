import { test, expect, type Page, type Route } from '@playwright/test';
import { installApp } from './helpers/app';

// Builder item 212 (review finding 108): the operator's customer-management surfaces that
// tests/presence/operator_delivery_test.mjs used to "check" by reading customers.html,
// projects.html and inbox.html as text, checked here by what the pages do. The rest is
// already in rosters.spec.ts, agency.spec.ts, projects.spec.ts and inbox.spec.ts (the deno
// suite lists them).
//   FIX 6  the roster's own empty state, in plain words
//   FIX 7  Open record opens the customer's record (by their site, else by their id); Their
//          website opens their site in the editor
//   FIX D  a project opens as a full-screen view on the page (never a dialog) with every
//          section, and a record that fails to load offers ← Back to projects
//   BY-CLIENT  a customer's general messages are read and answered inside their record;
//          Projects keeps no studio-wide list of client messages; the Inbox counts client
//          conversations, one row per client with its avatar, unread dot and message count
// Hermetic, and every write a page sends here is answered on purpose and checked.

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const pathOf = (url: string) => new URL(url).pathname.replace(/^.*\/functions\/v1\/presence/, '');
type Sent = { method: string; path: string; body: unknown };
// Every write the page sends must be one this test planned: each planned path (after
// /presence, `*` standing for one segment) is answered by its handler and kept; any other
// write is answered 418 and kept as unplanned, so `done()` fails the test.
async function planWrites(page: Page, plan: Record<string, (body: unknown) => { status: number; body: unknown }>) {
  const sent: Sent[] = [], unplanned: string[] = [];
  const rules = Object.entries(plan).map(([p, h]) => [new RegExp('^' + p.replace(/[.?+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]+') + '$'), h] as const);
  await page.route('**/functions/v1/presence/**', async (route: Route) => {
    const r = route.request();
    if (r.method() === 'GET' || r.method() === 'HEAD') return route.fallback();
    const path = pathOf(r.url()).split('?')[0];
    let body: unknown = null; try { body = r.postDataJSON(); } catch { body = r.postData(); }
    const rule = rules.find(([re]) => re.test(path));
    if (!rule) { unplanned.push(`${r.method()} ${path}`); return route.fulfill(json({ error: 'unplanned_write' }, 418)); }
    sent.push({ method: r.method(), path, body });
    const out = rule[1](body);
    return route.fulfill(json(out.body, out.status)).catch(() => {});
  });
  return { sent, done: () => expect(unplanned, 'writes the test did not plan').toEqual([]) };
}
const reads = (page: Page) => {
  const got: string[] = [];
  page.on('request', (r) => { if (r.method() === 'GET' && r.url().includes('/functions/v1/presence/')) got.push(pathOf(r.url()) + (new URL(r.url()).search || '')); });
  return got;
};
const pinTable = (key: string) => (page: Page) =>
  page.addInitScript((k) => { try { if (!localStorage.getItem(k)) localStorage.setItem(k, 'table'); } catch { /* denied */ } }, key);

// ── customers.html ──
const CUSTOMERS = { data: [
  { client_id: 'c-acme', name: 'Acme Bakery', email: 'a@acme.example.com', project_id: 'p1', project_name: 'Site', status: 'active', customer_site_id: 'site-acme', open_support: 1, project_count: 1 },
  { client_id: 'c-zeta', name: 'Zeta Gym', email: 'z@zeta.example.com', project_id: 'p3', project_name: 'Site', status: 'active', customer_site_id: null, open_support: 0, project_count: 1 },
] };

test.describe('Customers roster, item 212', () => {
  test('FIX6: a studio with no customers yet is told so in plain words, with the way to the pipeline', async ({ page }) => {
    await installApp(page, { api: { '/studio/customers': { data: [] } } });
    const w = await planWrites(page, {});
    await page.goto('/customers.html');
    await expect(page.getByRole('heading', { name: 'You haven’t added a customer yet.' })).toBeVisible();
    await expect(page.getByText('When you convert an enquiry or add a customer, they’ll appear here')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to your sales pipeline →' })).toHaveAttribute('href', '/pipeline.html');
    w.done();
  });

  test('FIX7: Open record opens the customer’s record, by their site when they have one, else by their id; Their website opens their site in the editor', async ({ page }) => {
    await pinTable('dds-display:customers')(page);
    await installApp(page, { api: { '/studio/customers': CUSTOMERS } });
    const w = await planWrites(page, {});
    await page.goto('/customers.html');
    const acme = page.locator('tbody tr', { hasText: 'Acme Bakery' });
    const zeta = page.locator('tbody tr', { hasText: 'Zeta Gym' });
    await expect(acme.getByRole('button', { name: 'Open record' })).toBeVisible();
    await expect(zeta.getByRole('button', { name: 'Their website' })).toHaveCount(0);   // no site of their own, no Their website
    await acme.getByRole('button', { name: 'Open record' }).click();
    await page.waitForURL(/\/crm\.html\?client=site-acme$/);
    await page.goBack();
    await page.locator('tbody tr', { hasText: 'Zeta Gym' }).getByRole('button', { name: 'Open record' }).click();
    await page.waitForURL(/\/crm\.html\?client_id=c-zeta$/);
    await page.goBack();
    await page.locator('tbody tr', { hasText: 'Acme Bakery' }).getByRole('button', { name: 'Their website' }).click();
    await page.waitForURL(/\/presence\.html\?client=site-acme$/);
    w.done();
  });
});

// ── projects.html ──
const LIST = { data: [
  { id: 'p1', name: 'Acme website build', status: 'active', client_visible: true, client_id: 'c-acme', deal_id: null, start_date: null, target_date: '2026-08-01', updated_at: '2026-07-10T00:00:00Z' },
], is_studio_view: true };
const P1_DETAIL = { data: {
  project: { id: 'p1', name: 'Acme website build', status: 'active', client_visible: true, client_id: 'c-acme', target_date: '2026-08-01' },
  milestones: [{ id: 'm1', title: 'Kickoff', status: 'complete', client_visible: true, due_date: '2026-07-01' }, { id: 'm2', title: 'Design', status: 'open', client_visible: true, due_date: '2026-07-20' }],
  tasks: [{ id: 't1', title: 'Collect content', status: 'todo', client_visible: true, client_action_required: true, due_date: '2026-07-25', derived: { overdue: false } }],
  deliverables: [{ id: 'd1', title: 'Homepage mock', status: 'shared', client_visible: true }],
  approvals: [{ id: 'a1', title: 'Homepage design', status: 'pending', content_hash: 'h1', client_visible: true }],
  progress: { pct: 50, done: 1, total: 2 },
  is_studio_view: true,
} };
const GENERAL = { data: [{ id: 'g1', subject: 'Can you add our new menu?', status: 'open' }], customer: { name: 'Acme Bakery' } };
const PROJECTS_API = {
  '/projects': LIST,
  '/studio/customers': CUSTOMERS,
  '/projects/p1': P1_DETAIL,
  '/projects/p1/report': { data: { summary: { progress: { pct: 50, done: 1, total: 2 }, milestones: { complete: 1, total: 2 }, open_client_actions: 1, pending_approvals: 1, shared_files: 1 } } },
  '/projects/p1/messages': { data: [] },
  '/projects/p1/surveys': { data: [] },
  '/projects/p1/client-messages': GENERAL,
  '/support': { data: [] },
  '/support/g1': { data: {
    request: { id: 'g1', subject: 'Can you add our new menu?', status: 'open', body: 'The spring menu is attached.', requester_kind: 'client', created_at: '2026-07-10T00:00:00Z' },
    messages: [{ id: 'gm1', body: 'And the prices changed too.', author_kind: 'client', created_at: '2026-07-11T00:00:00Z' }],
  } },
  '/service/saved-replies': { data: { replies: [] } },
};

test.describe('Projects, item 212', () => {
  test('FIXD: a project opens as a full-screen view on the page, never a dialog, with every section; the breadcrumb puts the list back', async ({ page }) => {
    await pinTable('dds-display:projects')(page);
    await installApp(page, { api: PROJECTS_API });
    const w = await planWrites(page, {});
    const got = reads(page);
    await page.goto('/projects.html');
    await expect(page.locator('tbody tr[data-id="p1"]')).toBeVisible();
    await expect(page.locator('#clientMsgs')).toHaveCount(0);                       // no studio-wide list of client messages here
    await page.locator('tbody tr[data-id="p1"] td').first().click();
    await expect(page.locator('#dtitle')).toHaveText('Acme website build');
    await expect(page.locator('#detailWrap')).toBeVisible();
    await expect(page.locator('#listWrap')).toBeHidden();
    await expect(page.locator('dialog#detail')).toHaveCount(0);
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    const heads = page.locator('#detailInner .rsec h3');
    for (const name of ['Milestones', 'Tasks', 'Files', 'Approvals', 'Surveys', 'Messages', 'Support requests']) await expect(heads.filter({ hasText: name }).first()).toBeVisible();
    await expect(page.locator('#genHead')).toHaveText('General messages from Acme Bakery');
    await page.locator('.crumbs .crumb').click();
    await expect(page.locator('#listWrap')).toBeVisible();
    await expect(page.locator('#detailWrap')).toBeHidden();
    expect(got.filter((p) => p === '/support' || p.startsWith('/support?') && !p.includes('project_id='))).toEqual([]);   // the studio-wide support list is never read here
    w.done();
  });

  test('FIXD: a record that won’t load says so, and ← Back to projects returns to the list', async ({ page }) => {
    await pinTable('dds-display:projects')(page);
    await installApp(page, { api: PROJECTS_API });
    await page.route((u) => u.pathname.endsWith('/presence/projects/p1'), (route) => route.request().method() === 'GET' ? route.fulfill(json({ message: 'Something went wrong on our side.' }, 500)) : route.fallback());
    const w = await planWrites(page, {});
    await page.goto('/projects.html?project=p1');
    const back = page.getByRole('button', { name: '← Back to projects' });
    await expect(back).toBeVisible();
    await expect(page.locator('#listWrap')).toBeHidden();
    await back.click();
    await expect(page.locator('#listWrap')).toBeVisible();
    await expect(page.locator('#detailWrap')).toBeHidden();
    await expect(page).not.toHaveURL(/project=/);
    w.done();
  });

  test('BYCLIENT: a customer’s general messages are listed, opened and answered inside their record', async ({ page }) => {
    await installApp(page, { api: PROJECTS_API });
    const w = await planWrites(page, { '/support/g1/messages': () => ({ status: 200, body: { data: { ok: true } } }) });
    await page.goto('/projects.html?project=p1');
    const gen = page.locator('#genList');
    await expect(gen).toContainText('Can you add our new menu?');
    await expect(gen.getByRole('button', { name: 'Resolve' })).toBeVisible();
    await gen.getByRole('button', { name: 'View & reply' }).click();
    await expect(gen).toContainText('The spring menu is attached.');
    await expect(gen).toContainText('And the prices changed too.');
    await expect(page.locator('#detailWrap')).toBeVisible();                           // still inside the record
    await gen.locator('textarea').fill('Done, the spring menu is up.');
    await gen.getByRole('button', { name: 'Send reply' }).click();
    await expect.poll(() => w.sent.map((s) => [s.method, s.path, (s.body as { body?: string })?.body])).toEqual([['POST', '/support/g1/messages', 'Done, the spring menu is up.']]);
    await gen.getByRole('button', { name: '← All requests' }).click();
    await expect(gen.getByRole('button', { name: 'View & reply' })).toBeVisible();
    w.done();
  });
});

// ── inbox.html ──
const P_SITE = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', P_MENU = 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa', P_BEACON = 'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa';
const CLIENT_ONLY_FEED = { data: {
  role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null, enquiries: [],
  client_messages: [
    // Marlow wrote on two projects: one row, the counts added up
    { type: 'message', project: 'Site build', project_id: P_SITE, client_id: 'c-1', client: 'Marlow’s Kitchen', created_at: '2026-07-15T00:00:00Z', needs_reply: true, count: 2, thread_key: 'client:c-1', unread: true, href: `/crm.html?project=${P_SITE}&tab=messages`, tier: 'needs_you', priority: false },
    { type: 'message', project: 'Menu refresh', project_id: P_MENU, client_id: 'c-1', client: 'Marlow’s Kitchen', created_at: '2026-07-12T00:00:00Z', needs_reply: false, count: 1, thread_key: 'client:c-1', unread: false, href: `/crm.html?project=${P_MENU}&tab=messages`, tier: 'update', priority: false },
    // Beacon was answered and has read it all
    { type: 'message', project: 'Rebrand', project_id: P_BEACON, client_id: 'c-2', client: 'Beacon Bakery', created_at: '2026-07-14T00:00:00Z', needs_reply: false, count: 1, thread_key: 'client:c-2', unread: false, href: `/crm.html?project=${P_BEACON}&tab=messages`, tier: 'update', priority: false },
  ],
} };

test.describe('Inbox, item 212', () => {
  test('FIX5 + BYCLIENT: client conversations count in the Inbox, one row per client with their initials, an unread dot and the message count', async ({ page }) => {
    await installApp(page, { api: {
      '/portal/feed': CLIENT_ONLY_FEED,
      '/forms/inbox': { data: { submissions: [], unread: 0 } },
      '/notifications': { data: [], unread_count: 0 },
    } });
    const w = await planWrites(page, { '/notifications/read': () => ({ status: 200, body: { data: { ok: true } } }) });
    await page.goto('/inbox.html');
    const rows = page.locator('#rows [role=option]');
    await expect(rows).toHaveCount(2);
    await expect(page.locator('#lmeta')).toContainText('2 conversations · 1 waiting for a reply');
    await expect(page.locator('#rows')).not.toContainText('all caught up');
    const marlow = rows.filter({ hasText: 'Marlow’s Kitchen' });
    const beacon = rows.filter({ hasText: 'Beacon Bakery' });
    await expect(marlow.locator('.avatar')).toHaveText('MK');
    await expect(marlow.locator('.unread-dot')).toHaveCount(1);
    await expect(marlow.locator('.cmbadge')).toHaveText('3');                       // two projects’ messages, one count
    await expect(beacon.locator('.avatar')).toHaveText('BB');
    await expect(beacon.locator('.unread-dot')).toHaveCount(0);
    await expect(beacon.locator('.cmbadge')).toHaveCount(0);                         // a single message needs no count
    w.done();
  });
});
