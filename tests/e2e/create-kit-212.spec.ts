import { test, expect, type Page, type Route } from '@playwright/test';
import { installApp, ALL_FEATURES, STUDIO_LEVEL_NAV } from './helpers/app';

// "+ Create" (sales list item 70), the page halves of tests/presence/create_kit_test.mjs
// that tests/e2e/create.spec.ts didn't already drive (builder item 212: behaviour, not text).
// create.js checks a person's deals before it starts one, never starts a second, reads
// lists defensively and says "copied" only when it was; shell.js loads it on idle, says
// so when it can't, keeps "c" and "n" in their lanes and lists its jobs last in ⌘K;
// shell.css keeps touch screens and reduced motion right; Pipeline opens a proposal from
// ?compose=proposal; and Contacts names a new deal the way Create does.
//
// Every write the pages send is answered by a route this file registers on purpose and
// recorded; anything else is refused with a 599 so a stray write fails the test.

const D1 = '11111111-1111-4111-8111-111111111111';   // Jane · Blue Finch, proposal, $2,500
const D4 = '44444444-4444-4444-8444-444444444444';   // Dana · Harbor Lane, a lead with no value
const NEW_DEAL = 'abababab-abab-4bab-8bab-abababababab';
const DEALS = [
  { id: D1, title: 'Blue Finch — site', stage: 'proposal', contact_id: 'c1', expected_value_cents: 250000, next_step: null, next_step_at: null, updated_at: '2026-11-01T10:00:00Z' },
  { id: D4, title: 'Harbor Lane — logo', stage: 'lead', contact_id: 'c2', expected_value_cents: 0, updated_at: '2026-11-08T10:00:00Z' },
];
const PEOPLE = [
  { id: 'c1', name: 'Jane Doe', company: 'Blue Finch', email: 'jane@example.com', updated_at: '2026-11-01T10:00:00Z' },
  { id: 'c2', name: 'Dana Cole', company: 'Harbor Lane', email: 'dana@example.com', updated_at: '2026-11-08T10:00:00Z' },
  { id: 'c3', name: 'Sam Lee', company: '', email: 'sam@example.com', updated_at: '2026-11-05T10:00:00Z' },
  { id: 'c5', name: '', company: 'Oak & Iron', email: 'hi@oak.example.com', updated_at: '2026-11-04T10:00:00Z' },
];
const FAR = [{ id: 'c9', name: 'Zed Far', company: 'Far & Wide', email: 'zed@example.com', updated_at: '2025-01-01T10:00:00Z' }];

const STUDIO_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'],
  landing: '/agency.html', attention_count: 0, nav: STUDIO_LEVEL_NAV, plan_key: 'presence', upsell: null, scope: null,
} };
const dealDetail = (id: string, title: string) => ({ data: {
  deal: { id, title, stage: 'proposal', expected_value_cents: 250000, expected_close: null, next_step: null, next_step_at: null, notes: '', contact_id: 'c1', converted_client_id: null, retainer: null },
  contact: { id: 'c1', name: 'Jane Doe', email: 'jane@example.com', phone: '', company: 'Blue Finch', notes: '' },
  proposals: [], contracts: [], events: [], timeline: [], invoices: [], last_contacted_at: null,
} });
const FIXTURES = {
  '/portal/context': STUDIO_CTX,
  '/agency/needs-you': { data: { rows: [], more: 0, rest: [], total: 0, empty_line: 'All quiet.', partial: false, own_site: true, next_by_site: {}, next_by_client: {} } },
  '/agency/me': { data: { agency: 'Bright Studio', role: 'owner', plan: 'agency', branding: {}, email: 'owner@example.com', member_id: 'm1' } },
  '/agency/portfolio': { data: [] },
  '/agency/kits': { data: [] },
  '/studio/customers': { data: [] },
  '/sales/summary': { data: { total: 2, open: { count: 2, value_cents: 250000 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 }, by_stage: [], ar: { outstanding_cents: 0, count: 0, overdue_count: 0 } } },
  '/sales/receivables': { data: { items: [], total_cents: 0 } },
  '/sales/my-tasks': { data: { partial: false, total: 0, items: [] } },
  [`/sales/deals/${D1}`]: dealDetail(D1, 'Blue Finch — site'),
  [`/sales/deals/${D1}/tasks`]: { data: [] },
  '/sales/templates': { data: [] },
  '/sales/services': { data: [] },
  '/identity': { data: { business_name: 'Bright Studio' } },
};

type Call = { method: string; path: string; search: string; body: Record<string, unknown> | null };
type Reply = { status: number; json: unknown };
interface ServerOpts {
  deals?: (q: string | null) => Reply;
  contacts?: (q: string | null) => Reply;
  contactDeals?: (id: string, n: number) => Reply;
  writes?: Record<string, (body: Record<string, unknown>, n: number) => Reply>;   // "METHOD /path" → answer
}
/** The presence function, for the sales routes Create reads and the writes this file plans.
 *  Registered after installApp, so it answers first; other GETs fall back to the fixtures. */
async function server(page: Page, opts: ServerOpts = {}) {
  const calls: Call[] = [];
  const seen: Record<string, number> = {};
  await page.route('**/functions/v1/presence/**', async (route: Route) => {
    const req = route.request(); const url = new URL(req.url());
    const path = url.pathname.replace(/^.*\/functions\/v1\/presence/, '') || '/'; const method = req.method();
    let body: Record<string, unknown> | null = null; try { body = req.postDataJSON(); } catch { body = null; }
    const reply = (r: Reply) => { calls.push({ method, path, search: url.search, body }); return route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.json) }); };
    if (method === 'GET') {
      const q = url.searchParams.get('q');
      if (path === '/sales/deals') return reply(opts.deals ? opts.deals(q) : { status: 200, json: { data: q ? [] : DEALS } });
      if (path === '/sales/contacts') return reply(opts.contacts ? opts.contacts(q) : { status: 200, json: { data: q === 'zed' ? FAR : q ? [] : PEOPLE } });
      if (path === '/sales/stages') return reply({ status: 200, json: { data: { labels: {} } } });
      const ct = path.match(/^\/sales\/contacts\/([^/]+)$/);
      if (ct) { const k = `GET ${path}`; seen[k] = (seen[k] || 0) + 1; return reply(opts.contactDeals ? opts.contactDeals(ct[1], seen[k]) : { status: 200, json: { data: { contact: { id: ct[1] }, deals: [] } } }); }
      return route.fallback();
    }
    const key = `${method} ${path}`;
    seen[key] = (seen[key] || 0) + 1;
    const planned = opts.writes && opts.writes[key];
    return reply(planned ? planned(body || {}, seen[key]) : { status: 599, json: { error: 'unplanned_write', message: `This test did not plan ${key}` } });
  });
  return calls;
}
const writes = (calls: Call[]) => calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`);

const isPhone = (page: Page) => (page.viewportSize()?.width || 0) < 761;
const dlg = (page: Page) => page.locator('dialog#dds-cr');
const opener = (page: Page) => page.locator(isPhone(page) ? '#dds-mbar-create' : '#dds-create');
async function openForm(page: Page, label: string) {
  await opener(page).click();
  await expect(dlg(page).locator('.cr-item')).toHaveCount(9);
  await dlg(page).locator('.cr-item', { hasText: label }).click();
  await expect(dlg(page).locator('#dds-cr-title')).toHaveText(label);
}
const option = (page: Page, text: string) => dlg(page).locator('#cr-who-list [role=option]', { hasText: text });
const lastToast = (page: Page) => page.locator('.dds-toast').last();

test.describe('+ Create: who it acts on', () => {
  test('a failed check of their deals stops and says so, and starts no deal', async ({ page }) => {
    await installApp(page, { api: FIXTURES });
    const calls = await server(page, { contactDeals: () => ({ status: 500, json: { error: 'read_failed' } }) });
    await page.goto('/agency.html');
    await openForm(page, 'Send an invoice');
    await dlg(page).locator('#cr-who').fill('sam');
    await option(page, 'Sam Lee').click();
    await dlg(page).locator('#cr-amt').fill('700');
    await dlg(page).locator('.cr-go').click();
    await expect(dlg(page).locator('.cr-err')).toHaveText('Couldn’t check their deals just now — please try again.');
    await expect(dlg(page)).toBeVisible();
    await expect(dlg(page).locator('.cr-go')).toBeEnabled();
    expect(writes(calls)).toEqual([]);                                                   // no deal started, no invoice
    expect(calls.filter((c) => c.path === '/sales/contacts/c3').length).toBeGreaterThanOrEqual(2);   // asked again on the press, not taken from a failed answer
  });

  test('the deal started for a person is the one used when pressing again', async ({ page }) => {
    await installApp(page, { api: FIXTURES });
    const calls = await server(page, { writes: {
      'POST /sales/deals': (b) => ({ status: 201, json: { data: { id: NEW_DEAL, title: b.title, stage: 'lead' } } }),
      [`POST /sales/deals/${NEW_DEAL}/invoice`]: (b, n) => n === 1
        ? { status: 500, json: { error: 'write_failed', message: 'That invoice didn’t send — please try again.' } }
        : { status: 201, json: { data: { id: 'inv-1' }, url: 'https://pay.example.test/inv-1', emailed: true, reused: false, amount_cents: b.amount_cents } },
    } });
    await page.goto('/agency.html');
    await openForm(page, 'Send an invoice');
    await dlg(page).locator('#cr-who').fill('sam');
    await option(page, 'Sam Lee').click();
    await expect(dlg(page).locator('.cr-go')).toHaveText('Start a deal and send');
    await dlg(page).locator('#cr-amt').fill('700');
    await dlg(page).locator('.cr-go').click();
    await expect(dlg(page).locator('.cr-err')).toHaveText('That invoice didn’t send — please try again.');
    await expect(dlg(page).locator('#cr-picked')).toContainText('Sam Lee — project');     // the pick is that deal now
    await dlg(page).locator('.cr-go').click();
    await expect(lastToast(page)).toContainText('Invoice sent — emailed to Sam Lee');
    expect(writes(calls)).toEqual(['POST /sales/deals', `POST /sales/deals/${NEW_DEAL}/invoice`, `POST /sales/deals/${NEW_DEAL}/invoice`]);   // one deal, never a second
    expect(calls.find((c) => c.path === '/sales/deals' && c.method === 'POST')!.body).toEqual({ title: 'Sam Lee — project', contact_id: 'c3' });
  });

  test('a reply that isn’t a list counts as empty: the rest still lists, nothing breaks', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await installApp(page, { api: FIXTURES });
    await server(page, { deals: () => ({ status: 200, json: { data: { rows: DEALS } } }) });
    await page.goto('/agency.html');
    await openForm(page, 'Log a call');
    await dlg(page).locator('#cr-who').fill('sam');
    await expect(option(page, 'Sam Lee')).toBeVisible();
    await expect(dlg(page).locator('#cr-who-hint')).not.toContainText('couldn’t load');
    await page.keyboard.press('Escape');
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await installApp(page, { api: FIXTURES });
    await server(page, { contacts: () => ({ status: 200, json: { data: null } }) });
    await page.goto('/agency.html');
    await openForm(page, 'Log a call');
    await dlg(page).locator('#cr-who').fill('finch');
    await expect(option(page, 'Blue Finch')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('the first read asks for 100 people and 100 deals; typing asks the server for 20 of each', async ({ page }) => {
    await installApp(page, { api: FIXTURES });
    const calls = await server(page);
    await page.goto('/agency.html');
    await expect(opener(page)).toBeVisible();
    await page.waitForLoadState('networkidle');
    calls.length = 0;                                                                   // Home reads its own deals; only Create's reads count from here
    await openForm(page, 'Log a call');
    const reads = () => calls.filter((c) => c.method === 'GET').map((c) => c.path + c.search);
    await expect.poll(reads).toEqual(expect.arrayContaining(['/sales/deals?limit=100', '/sales/contacts?limit=100']));
    await dlg(page).locator('#cr-who').fill('zed');
    await expect(option(page, 'Zed Far')).toBeVisible();                                 // past the first 100: found by the server
    await expect.poll(reads).toEqual(expect.arrayContaining(['/sales/contacts?limit=20&q=zed', '/sales/deals?limit=20&q=zed']));
  });
});

test.describe('+ Create: an invoice that isn’t emailed', () => {
  test('an invoice answered with no pay link keeps the form open and says so', async ({ page }) => {
    await installApp(page, { api: FIXTURES });
    const calls = await server(page, { writes: { [`POST /sales/deals/${D1}/invoice`]: () => ({ status: 201, json: { data: { id: 'inv-9' }, emailed: false, reused: false } }) } });
    await page.goto('/agency.html');
    await openForm(page, 'Send an invoice');
    await option(page, 'Jane Doe').click();
    await dlg(page).locator('#cr-amt').fill('500');
    await dlg(page).locator('.cr-go').click();
    await expect(dlg(page).locator('.cr-err')).toHaveText('The invoice saved, but its payment link didn’t generate — press Send invoice again to finish it.');
    await expect(dlg(page)).toBeVisible();
    await expect(dlg(page).locator('.cr-go')).toBeEnabled();
    expect(writes(calls)).toEqual([`POST /sales/deals/${D1}/invoice`]);
  });

  for (const works of [true, false]) {
    test(`nothing emailed: "copied" only when the copy worked (${works ? 'it did' : 'it didn’t'})`, async ({ page }) => {
      await page.addInitScript((ok) => {
        const w = window as unknown as { __copied: string[] };
        w.__copied = [];
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t: string) => { if (!ok) return Promise.reject(new Error('denied')); w.__copied.push(t); return Promise.resolve(); } } });
      }, works);
      await installApp(page, { api: FIXTURES });
      await server(page, { writes: { [`POST /sales/deals/${D1}/invoice`]: () => ({ status: 201, json: { data: { id: 'inv-9' }, url: 'https://pay.example.test/inv-9', emailed: false, reused: false } }) } });
      await page.goto('/agency.html');
      await openForm(page, 'Send an invoice');
      await option(page, 'Jane Doe').click();
      await dlg(page).locator('#cr-amt').fill('500');
      await dlg(page).locator('.cr-go').click();
      if (works) {
        await expect(lastToast(page)).toContainText('Invoice ready — nothing was emailed, so its payment link is copied for you to send.');
        expect(await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied)).toEqual(['https://pay.example.test/inv-9']);
      } else {
        await expect(lastToast(page)).toContainText('Invoice ready — nothing was emailed. Open the deal to copy its payment link.');
        await expect(lastToast(page)).not.toContainText('copied');
      }
    });
  }
});

test.describe('+ Create: who gets it, and how it loads', () => {
  test('a studio without Pipeline, or a reviewer, gets no Create', async ({ page }) => {
    const noPipeline = STUDIO_LEVEL_NAV.filter((s) => s.key !== 'pipeline').map((s) => ({ ...s, items: s.items.filter((i) => i.key !== 'pipeline') }));
    for (const ctx of [{ ...STUDIO_CTX.data, nav: noPipeline }, { ...STUDIO_CTX.data, site_role: 'client_reviewer' }]) {
      await installApp(page, { api: { ...FIXTURES, '/portal/context': { data: ctx } } });
      await server(page);
      await page.goto('/agency.html');
      await expect(page.locator('#dds-shell')).toBeAttached();
      await expect(page.locator('#dds-shell .dds-nav, #dds-mbar').first()).toBeAttached();
      await expect(page.locator('#dds-create')).toHaveCount(0);
      await expect(page.locator('#dds-mbar-create')).toHaveCount(0);
      if (!isPhone(page)) { await page.locator('body').press('c'); await expect(dlg(page)).toHaveCount(0); }
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
  });

  test('create.js loads on its own from this site; a failed load says so, and the next press retries', async ({ page }) => {
    await installApp(page, { api: FIXTURES });
    await server(page);
    const idle = page.waitForRequest((r) => new URL(r.url()).pathname === '/create.js');
    await page.goto('/agency.html');
    const req = await idle;                                                             // nobody pressed anything
    expect(new URL(req.url()).origin).toBe(new URL(page.url()).origin);
    await expect.poll(() => page.evaluate(() => typeof (window as unknown as { ddsCreate?: unknown }).ddsCreate)).toBe('object');

    await page.route('**/create.js', (route) => route.abort());
    await page.goto('/agency.html');
    await opener(page).click();
    await expect(lastToast(page)).toContainText('Create didn’t load — check your connection and try again.');
    await expect(dlg(page)).toHaveCount(0);
    await page.unroute('**/create.js');
    await opener(page).click();
    await expect(dlg(page).locator('.cr-item')).toHaveCount(9);
  });

  test('every #create:<kind> link opens its own form once and clears the address', async ({ page }) => {
    await installApp(page, { api: FIXTURES });
    await server(page);
    const forms: Array<[string, string]> = [['call', 'Log a call'], ['deal', 'New deal'], ['invoice', 'Send an invoice'], ['proposal', 'Send a proposal'], ['todo', 'Add a to-do'], ['project', 'New project']];
    for (const [kind, title] of forms) {
      await page.goto(`/agency.html#create:${kind}`);
      await expect(dlg(page).locator('#dds-cr-title')).toHaveText(title);
      expect(new URL(page.url()).hash, kind).toBe('');
    }
    await page.reload();                                                                // the address no longer asks for it
    await expect(opener(page)).toBeVisible();
    await expect(dlg(page)).toHaveCount(0);
    // three jobs live on pages of their own: Sites (New site), Broadcasts (Send an update), Home's Add a customer
    await page.goto('/agency.html#create:site');
    await expect(page).toHaveURL(/\/sites\.html/);
    await page.goto('/agency.html#create:update');
    await expect(page).toHaveURL(/\/broadcasts\.html/);
    await page.addInitScript(() => { const w = window as unknown as { __went: string[] }; w.__went = []; addEventListener('hashchange', (e) => w.__went.push(new URL(e.newURL).pathname + new URL(e.newURL).hash)); });
    await page.goto('/agency.html#create:customer');
    await expect.poll(() => page.evaluate(() => (window as unknown as { __went: string[] }).__went)).toContain('/agency.html#add');
  });
});

test.describe('+ Create: keys', () => {
  test.beforeEach(async ({ page }) => { test.skip(isPhone(page), 'keyboard shortcuts are for a keyboard'); });

  test('c does nothing while typing, or over a form that is open', async ({ page }) => {
    await installApp(page, { api: FIXTURES });
    await server(page);
    await page.goto('/agency.html');
    await expect(page.locator('#dds-create')).toBeVisible();
    await page.evaluate(() => { const i = document.createElement('input'); i.id = 'probe'; i.setAttribute('aria-label', 'Probe'); document.body.appendChild(i); });
    await page.locator('#probe').press('c');
    await expect(page.locator('#probe')).toHaveValue('c');
    await expect(dlg(page)).toHaveCount(0);
    await openForm(page, 'Log a call');
    await dlg(page).locator('#cr-notes').fill('Asked about the logo');
    await dlg(page).locator('[data-chips=outcome] .cr-chip').first().focus();
    await page.keyboard.press('c');
    await expect(dlg(page).locator('#dds-cr-title')).toHaveText('Log a call');           // the form stays; nothing reopens over it
    await expect(dlg(page).locator('#cr-notes')).toHaveValue('Asked about the logo');
  });

  test('⌘K lists the Create jobs after the pages and opens one in place, with no #hash', async ({ page }) => {
    await installApp(page, { api: FIXTURES });
    await server(page);
    await page.goto('/agency.html');
    await expect(page.locator('#dds-create')).toBeVisible();
    await page.evaluate(() => { (window as unknown as { __hashes: number }).__hashes = 0; window.addEventListener('hashchange', () => { (window as unknown as { __hashes: number }).__hashes++; }); });
    const before = page.url();
    await page.keyboard.press('Control+k');
    const rows = page.locator('.dds-palette .res');
    await expect(rows.first()).toBeVisible();
    const listed = await rows.evaluateAll((els) => els.map((e) => ({ job: e.getAttribute('data-create') || '', href: e.getAttribute('href') || '' })));
    const menuHrefs = new Set(STUDIO_LEVEL_NAV.flatMap((s) => s.items.map((i) => i.href)));
    const jobs = listed.filter((r) => r.job).map((r) => r.job);
    const firstJob = listed.findIndex((r) => r.job), lastMenuPage = listed.map((r) => menuHrefs.has(r.href)).lastIndexOf(true);
    expect(jobs).toEqual(['call', 'deal', 'invoice', 'proposal', 'todo', 'project']);
    expect(lastMenuPage).toBeGreaterThanOrEqual(0);
    expect(firstJob).toBeGreaterThan(lastMenuPage);                                     // a page's own name still comes first
    await page.locator('.dds-palette input').fill('invoice');
    await page.locator('.dds-palette .res[data-create="invoice"]').click();
    await expect(dlg(page).locator('#dds-cr-title')).toHaveText('Send an invoice');
    expect(page.url()).toBe(before);
    expect(await page.evaluate(() => (window as unknown as { __hashes: number }).__hashes)).toBe(0);
  });

  test('n presses the page’s own New button, never the shell’s Create', async ({ page }) => {
    await installApp(page, { api: { ...FIXTURES, '/sales/deals': { data: DEALS } } });
    await server(page);
    await page.goto('/pipeline.html');
    await expect(page.locator('#dds-create')).toBeVisible();
    await expect(page.locator('#newDeal')).toBeVisible();
    const pick = await page.evaluate(() => { const n = (window as unknown as { ddsNewAction: () => Element | null }).ddsNewAction(); return n ? { id: n.id, inShell: !!n.closest('#dds-shell, .dds-pop, .dds-palette, .dds-drawer, #dds-mbar') } : null; });
    expect(pick).toEqual({ id: 'newDeal', inShell: false });
    await page.locator('body').press('n');
    await expect(page.locator('dialog#formDlg')).toBeVisible();                         // the page's own new-deal form
    await expect(page.locator('#f-title')).toBeFocused();
    await expect(dlg(page)).toHaveCount(0);
  });
});

test.describe('+ Create: a touch screen', () => {
  test.use({ hasTouch: true });
  test('the Create button is 44px tall and shows no key hint', { tag: '@touch' }, async ({ page }) => {
    test.skip(isPhone(page), 'a phone has the + in its bar, not the sidebar button');
    await installApp(page, { api: FIXTURES });
    await server(page);
    await page.goto('/agency.html');
    expect(await page.evaluate(() => matchMedia('(pointer:coarse)').matches)).toBe(true);
    const btn = page.locator('#dds-create');
    await expect(btn).toBeVisible();
    expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(btn.locator('kbd')).toBeHidden();
  });
});

test.describe('+ Create: the screen it lands on', () => {
  test('a mouse and keyboard screen keeps the C hint beside Create', async ({ page }, testInfo) => {
    test.skip(isPhone(page) || testInfo.project.name === 'tablet', 'a fine pointer');
    await installApp(page, { api: FIXTURES });
    await server(page);
    await page.goto('/agency.html');
    await expect(page.locator('#dds-create kbd')).toBeVisible();
    await expect(page.locator('#dds-create kbd')).toHaveText('C');
  });

  test('no motion for people who ask for none', async ({ page }) => {
    await installApp(page, { api: FIXTURES });
    await server(page);
    // it moves when an animation with a duration runs on the dialog
    const moves = () => dlg(page).evaluate((e) => { const cs = getComputedStyle(e); return cs.animationName !== 'none' && parseFloat(cs.animationDuration) > 0; });
    await page.goto('/agency.html');
    await openForm(page, 'Log a call');
    expect(await moves()).toBe(true);                                                   // it slides in by default
    await page.keyboard.press('Escape');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    await opener(page).click();
    await expect(dlg(page).locator('.cr-item')).toHaveCount(9);
    expect(await moves()).toBe(false);                                                  // the menu or sheet doesn't move
    await dlg(page).locator('.cr-item', { hasText: 'Log a call' }).click();
    await expect(dlg(page).locator('#dds-cr-title')).toHaveText('Log a call');
    expect(await moves()).toBe(false);                                                  // nor the form
  });

  test('compose=proposal alone lands on Billing with a new proposal open, and the address drops it', async ({ page }) => {
    await installApp(page, { api: FIXTURES });
    await server(page);
    await page.goto(`/pipeline.html?deal=${D1}&compose=proposal`);
    await expect(page.locator('#detailInner .tabs [data-dtab="billing"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#propForm .pl-label').first()).toBeVisible();
    await expect.poll(() => new URL(page.url()).search).toBe(`?deal=${D1}&dtab=billing`);   // a reload won't open another
  });

  test('Contacts and Create give a person’s new deal the same name', async ({ page }) => {
    await installApp(page, { api: { ...FIXTURES, '/sales/contacts': { data: PEOPLE } } });
    const titles: string[] = [];
    const calls = await server(page, { writes: {
      'POST /sales/deals': (b) => { titles.push(String(b.title)); return { status: 201, json: { data: { id: NEW_DEAL, title: b.title, stage: 'lead' } } }; },
      [`POST /sales/deals/${NEW_DEAL}/invoice`]: (b) => ({ status: 201, json: { data: { id: 'inv-1' }, url: 'https://pay.example.test/inv-1', emailed: true, reused: false, amount_cents: b.amount_cents } }),
    } });
    await page.route('**/crm.html**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Record</title>' }));
    await page.goto('/contacts.html');
    await page.locator('[data-deal="c5"]').first().click();                             // Oak & Iron: no name, a business
    await expect.poll(() => titles.length).toBe(1);
    await page.waitForURL(new RegExp(`/crm\\.html\\?deal=${NEW_DEAL}`));                  // Contacts goes on to the new deal by itself
    await page.goto('/agency.html');
    await openForm(page, 'Send an invoice');
    await dlg(page).locator('#cr-who').fill('oak');
    await option(page, 'Oak & Iron').click();
    await dlg(page).locator('#cr-amt').fill('400');
    await dlg(page).locator('.cr-go').click();
    await expect(lastToast(page)).toContainText('Invoice sent');
    expect(titles).toEqual(['Oak & Iron — project', 'Oak & Iron — project']);
    expect(writes(calls)).toEqual(['POST /sales/deals', 'POST /sales/deals', `POST /sales/deals/${NEW_DEAL}/invoice`]);
  });
});
