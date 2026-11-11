import { test, expect, type Page } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// ── Sales list item 111: Projects and Analytics (bug hunt H1 to H11, I8, K7) ──
// H2 + New project offers every customer on the studio's books. H3 a project's Support card
// asks for its own requests. H4 "+ Share" can't send twice. H6 Refresh refreshes Insights.
// H5 our counter's numbers are visits. H8 an action re-reads the record, not the side lists.
// H9 one roster read when scoped. H11 small ones: status presses, Enter on the report card,
// the old "What's coming next" link for a studio. K7 the add-a-customer dialog's reads.
const P = (n: number) => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`;
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const C = (n: number) => `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`;
const roster = (n: number) => Array.from({ length: n }, (_, i) => ({ client_id: C(i + 1), name: `Customer ${String(i + 1).padStart(2, '0')}`, person_name: `Person ${i + 1}`, customer_site_id: null, project_count: 1, open_support: 0 }));

/** one studio project with a task, a request and a message; every read is counted */
async function studio(page: Page, opts: { customers?: unknown[]; ctx?: unknown } = {}) {
  const proj = { id: P(1), name: 'Website build', status: 'active', client_visible: true, client_id: C(1), target_date: null };
  const tasks = [{ id: 't1', title: 'Write the copy', status: 'todo', client_visible: false, derived: {} }];
  const reads: string[] = [];
  const posts: Array<{ path: string; body: unknown }> = [];
  let customers = opts.customers || roster(3);
  await installApp(page, { api: { ...(opts.ctx ? { '/portal/context': opts.ctx } : {}) } });
  await page.route((u) => /\/presence\/(projects|support|studio\/customers|service\/saved-replies|surveys)(\/|\?|$)/.test(u.pathname + u.search), (route) => {
    const req = route.request(), u = new URL(req.url()), path = u.pathname.replace(/^.*\/presence/, '');
    if (req.method() === 'GET') reads.push(path + u.search); else posts.push({ path, body: req.postDataJSON() });
    if (path === '/studio/customers') return route.fulfill(json({ data: customers }));
    if (path === '/support') return route.fulfill(json({ data: [{ id: 'r1', subject: 'Logo tweak', status: 'open', project_id: proj.id }] }));
    if (path === '/projects' && req.method() === 'GET') return route.fulfill(json({ data: [proj], is_studio_view: true }));
    if (path === '/projects/progress') return route.fulfill(json({ data: { [proj.id]: { progress: { done: 0, total: 1, pct: 0 }, pending_approvals: 0, stage: 'build' } } }));
    if (path === `/projects/${proj.id}`) return route.fulfill(json({ data: { project: { ...proj, description: '' }, milestones: [], tasks, deliverables: [], approvals: [], is_studio_view: true } }));
    if (path === `/projects/${proj.id}/report`) return route.fulfill(json({ data: { summary: { progress: { done: tasks.filter((t) => t.status === 'done').length, total: 1, pct: 0 }, pending_approvals: 0 } } }));
    if (path === `/projects/${proj.id}/messages` && req.method() === 'GET') return route.fulfill(json({ data: [{ body: 'Hello from the client', author_kind: 'client', audience: 'client' }] }));
    if (path === `/projects/${proj.id}/client-messages`) return route.fulfill(json({ data: [], customer: { name: 'Customer 01' } }));
    if (/^\/projects\/[^/]+\/tasks\/t1$/.test(path)) { tasks[0].status = (req.postDataJSON() as { status: string }).status; return route.fulfill(json({ data: tasks[0] })); }
    if (/\/status$/.test(path)) return new Promise(() => {});   // H11: a status press that never answers
    return route.fulfill(json({ data: [] }));
  });
  return { reads, posts, setCustomers: (c: unknown[]) => { customers = c; } };
}

test.describe('Projects (item 111)', () => {
  test('H8 — ticking a task re-reads the record and its report only; the side lists stay, and what you typed', async ({ page }) => {
    const s = await studio(page);
    await page.goto('/projects.html?project=' + P(1));
    await expect(page.locator('#supList')).toContainText('Logo tweak');
    await expect(page.locator('#msgList')).toContainText('Hello from the client');
    const box = page.locator('#msgForm textarea');
    await box.fill('Half a thought');
    await page.locator('#mm-internal').check();
    s.reads.length = 0;
    await page.locator('[data-tdone="t1"]').check();
    await expect(page.locator('[data-tdone="t1"]')).toBeChecked();
    await expect.poll(() => s.reads.filter((r) => r.startsWith('/projects/' + P(1))).length).toBeGreaterThanOrEqual(2);
    await page.waitForTimeout(300);
    const after = s.reads.map((r) => r.split('?')[0]);
    expect(after.sort()).toEqual([`/projects/${P(1)}`, `/projects/${P(1)}/report`].sort());   // nothing else
    await expect(page.locator('#supList')).toContainText('Logo tweak');                       // kept
    await expect(page.locator('#msgList')).toContainText('Hello from the client');
    await expect(page.locator('#msgForm textarea')).toHaveValue('Half a thought');              // what you typed
    // the kept form still knows it is an internal note
    await page.locator('#msgForm button[type="submit"]').click();
    await expect.poll(() => s.posts.filter((p) => p.path.endsWith('/messages')).map((p) => p.body)).toEqual([{ body: 'Half a thought', audience: 'internal' }]);
  });

  test('H3 — the Support card asks for this project’s requests, not the studio’s newest 25', async ({ page }) => {
    const s = await studio(page);
    await page.goto('/projects.html?project=' + P(1));
    await expect(page.locator('#supList')).toContainText('Logo tweak');
    expect(s.reads).toContain(`/support?project_id=${P(1)}&limit=100`);
    expect(s.reads).not.toContain('/support');
  });

  test('H4 — "+ Share": a second Save while the file goes up sends nothing', async ({ page }) => {
    await studio(page);
    let uploads = 0;
    await page.route('**/presence/projects/*/deliverables/upload-url', (route) => { uploads++; return new Promise(() => {}); });   // hangs: a slow upload
    await page.goto('/projects.html?project=' + P(1));
    await page.locator('#addFile').click();
    await page.locator('#mf-file').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from([137, 80, 78, 71]) });
    const save = page.locator('#dlForm button[type="submit"]');
    await save.click();
    await expect(save).toBeDisabled();
    await save.click({ force: true });
    await page.waitForTimeout(300);
    expect(uploads).toBe(1);
  });

  test('H2 + H9 — + New project lists every customer on the books; Refresh brings in a new one', async ({ page }) => {
    const s = await studio(page, { customers: roster(30) });
    let dealsAsked = 0;
    await page.route('**/presence/sales/deals**', (route) => { dealsAsked++; return route.fulfill(json({ data: [] })); });
    await page.goto('/projects.html');
    await expect(page.locator('#list [data-id]')).toHaveCount(1);
    await page.locator('#newProj, [data-new-project], button:has-text("New project")').first().click();
    const opts = page.locator('#np-customer option');
    await expect(opts).toHaveCount(31);                                  // every customer, plus "Just my studio"
    await expect(opts.nth(1)).toHaveText('Customer 01');                 // named as the roster names them
    await expect(opts.nth(30)).toHaveText('Customer 30');
    expect(dealsAsked).toBe(0);
    await page.locator('#np-cancel').click();
    s.setCustomers([...roster(30), { client_id: C(99), name: 'Zed’s new shop', person_name: 'Zed', customer_site_id: null }]);
    await page.locator('#refreshBtn').click();
    await expect.poll(() => s.reads.filter((r) => r === '/studio/customers').length).toBe(2);
    await page.locator('#newProj, [data-new-project], button:has-text("New project")').first().click();
    await expect(opts).toHaveCount(32);
    await expect(opts.last()).toHaveText('Zed’s new shop');
  });

  test('H9 — scoped into a client, the customer roster is read once', async ({ page }) => {
    const SITE = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    const s = await studio(page, { customers: [{ ...roster(1)[0], customer_site_id: SITE }] });
    await page.goto('/projects.html?client=' + SITE);
    await expect(page.locator('#dtitle')).toHaveText('Website build');   // this client's one project opens by itself
    await page.waitForTimeout(400);
    expect(s.reads.filter((r) => r === '/studio/customers').length).toBe(1);
  });

  test('H11 — a status press is sent once, however many times it is pressed', async ({ page }) => {
    const s = await studio(page);
    await page.goto('/projects.html?project=' + P(1));
    await page.locator('#statusBtn').click();
    const item = page.locator('[data-pstatus="complete"]');
    await item.click();
    await item.click({ force: true }).catch(() => {});
    await page.waitForTimeout(300);
    expect(s.posts.filter((p) => p.path.endsWith('/status'))).toHaveLength(1);
  });
});

test.describe('Analytics (item 111)', () => {
  const DASH = { data: {
    period: 'this_month', generated_at: '2026-07-17T14:14:00Z',
    sales: { pipeline: { open: { count: 1, value_cents: 10000 }, stages: [] }, won: { this_month: { count: 0, value_cents: 0 }, last_month: { count: 0, value_cents: 0 } }, enquiries: { count: 0, unanswered: 0, weekly: [] }, support: { open: 500, open_capped: true, oldest_age_days: 3 }, invoices: null, recent_wins: [] },
    website: { traffic: { visitors: 214, pageviews: 512, actions: 0, top_pages: [{ path: '/', views: 231 }], pages: [{ path: '/', views: 231, visitors: 120 }], top_sources: [{ source: 'Google', visits: 88, share: 41 }], weekly: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], has_data: true }, search: null },
  } };

  test('H1 — the dashboard read carries the browser’s clock', async ({ page }) => {
    await installApp(page, { api: { '/analytics/dashboard': DASH } });
    const asked = page.waitForRequest((r) => r.url().includes('/analytics/dashboard'));
    await page.goto('/analytics.html');
    const url = new URL((await asked).url());
    expect(url.searchParams.get('tzo')).toBe(String(await page.evaluate(() => new Date().getTimezoneOffset())));
  });

  test('H5 — our counter’s numbers are visits, with what that means one hover away; "500+" open requests', async ({ page }) => {
    await installApp(page, { api: { '/analytics/dashboard': DASH } });
    await page.goto('/analytics.html');
    const kt = page.locator('#siteStats .stat .kt', { hasText: /^Visits$/ });
    await expect(kt).toBeVisible();
    await expect(kt).toHaveAttribute('title', 'A person counts once a day: someone who comes back on three days is three visits.');
    await expect(page.getByRole('heading', { name: 'Visits over time' })).toBeVisible();
    await expect(page.getByText('214 visits · This month')).toBeVisible();
    await expect(page.locator('#salesStats .stat', { hasText: 'Open support' }).locator('.v')).toHaveText('500+');
  });

  test('H6 — Refresh reads Insights again; a failed re-read keeps what was there', async ({ page }) => {
    let n = 0;
    await installApp(page, { api: { '/analytics/dashboard': DASH } });
    await page.route('**/presence/business-insights', (route) => {
      n++;
      if (n === 3) return route.fulfill(json({ error: 'boom' }, 502));
      return route.fulfill(json({ data: { groups: [{ key: 'Visitors', label: 'Visitors', observations: [{ observation: n === 1 ? 'The first reading.' : 'A newer reading.', why: 'w', should_i: 's' }] }] } }));
    });
    await page.goto('/analytics.html');
    await expect(page.locator('#insightsBody')).toContainText('The first reading.');
    await page.locator('#refreshBtn').click();
    await expect(page.locator('#insightsBody')).toContainText('A newer reading.');
    await page.locator('#refreshBtn').click();
    await expect.poll(() => n).toBe(3);
    await expect(page.locator('#insightsBody')).toContainText('A newer reading.');   // kept, not "couldn't read"
  });
});

test.describe('Small ones (H11) and the add-a-customer dialog (K7)', () => {
  const AGENCY_CTX = { data: {
    site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS',
    edition_features: ALL_FEATURES, is_agency: true, is_operator: false, sees_full_workspace: true,
    capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'], landing: '/agency.html', attention_count: 0, nav: STUDIO_NAV,
  } };

  test('H11 — the old "What’s coming next" link takes a studio to Your week', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': AGENCY_CTX } });
    await page.goto('/upcoming.html');
    await page.waitForURL(/\/week(\.html)?$/);
    expect(new URL(page.url()).pathname).toMatch(/\/week(\.html)?$/);
  });

  test('H11 — on the report card, Enter in a field sends the request, and the record is tried again when it fails', async ({ page }) => {
    let formspree = 0, crm = 0;
    await page.route('https://formspree.io/**', (route) => { formspree++; return route.fulfill(json({ ok: true })); });
    await page.route('**/functions/v1/clever-api', (route) => { crm++; return route.fulfill(crm === 1 ? json({ error: 'down' }, 503) : json({ ok: true })); });
    await page.goto('/report-card.html');
    await page.locator('#rcName').fill('Bright Bakes');
    await page.locator('#rcType').selectOption({ index: 1 });
    await page.locator('#rcCity').fill('Burbank');
    await page.locator('#rcEmail').fill('owner@brightbakes.example');
    await page.locator('#rcEmail').press('Enter');
    await expect(page.locator('#rcSuccess')).toBeVisible();
    expect(formspree).toBe(1);
    await expect.poll(() => crm, { timeout: 6000 }).toBe(2);
  });

  for (const pagePath of ['/customers.html', '/contacts.html']) {
    test(`K7 — on ${pagePath}, opening "+ Add a customer" twice asks for the kits once`, async ({ page }) => {
      let kits = 0;
      await installApp(page, { api: { '/portal/context': AGENCY_CTX, '/sales/contacts': { data: [], total: 0 } } });
      await page.route('**/presence/agency/kits', (route) => { kits++; return route.fulfill(json({ data: [{ id: 'k1', name: 'Restaurant kit' }] })); });
      await page.goto(pagePath);
      const add = page.locator('#addCust').first();
      await add.click();
      await expect(page.locator('#cu-kit option')).toHaveCount(2);
      await page.keyboard.press('Escape');
      await add.click();
      await expect(page.locator('#cu-kit option')).toHaveCount(2);
      expect(kits).toBe(1);
    });
  }
});
