import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp } from './helpers/app';

// Projects as a Lightning surface (redesign slice 9): the roster is a list view
// on the shared .lhead anatomy (📁 icon + #pagehead + refresh + meta) with the
// existing status filter chips and a sortable table (Project / Customer /
// Status / Progress / Target / Open approvals) — Progress + approvals fed by
// the EXISTING per-project /report route, customer names by /studio/customers,
// "—" until known (no fake numbers). The record page: breadcrumb → highlights
// panel → milestones-as-Path (single aria-current step; NO Path when the
// project has no milestones) → two-column related-list body. Every pre-slice
// capability (status ladder, rename, tasks, milestones, files, approvals,
// surveys, support) survives the reorganization.

const LIST = { data: [
  { id: 'p1', name: 'Acme website build', status: 'active', client_visible: true, client_id: 'c-acme', deal_id: null, start_date: null, target_date: '2026-08-01', updated_at: '2026-07-10T00:00:00Z' },
  { id: 'p2', name: 'Beta brand refresh', status: 'complete', client_visible: true, client_id: 'c-beta', deal_id: null, start_date: null, target_date: null, updated_at: '2026-07-01T00:00:00Z' },
  { id: 'p3', name: 'Internal ops', status: 'active', client_visible: false, client_id: null, deal_id: null, start_date: null, target_date: null, updated_at: '2026-06-20T00:00:00Z' },
], is_studio_view: true };

const CUSTOMERS = { data: [
  { client_id: 'c-acme', name: 'Acme Bakery', email: 'a@acme.com', status: 'active', customer_site_id: 'site-acme', open_support: 0, project_count: 1 },
  { client_id: 'c-beta', name: 'Beta Salon', email: 'b@beta.com', status: 'active', customer_site_id: 'site-beta', open_support: 0, project_count: 1 },
] };

const P1_REPORT = { data: { summary: {
  progress: { pct: 50, done: 3, total: 6 },
  milestones: { complete: 1, total: 3 },
  open_client_actions: 1, pending_approvals: 2, shared_files: 4,
} } };
const P2_REPORT = { data: { summary: {
  progress: { pct: 100, done: 2, total: 2 },
  milestones: { complete: 2, total: 2 },
  open_client_actions: 0, pending_approvals: 0, shared_files: 1,
} } };

const P1_DETAIL = { data: {
  project: { id: 'p1', name: 'Acme website build', status: 'active', client_visible: true, client_id: 'c-acme', target_date: '2026-08-01' },
  milestones: [
    { id: 'm1', title: 'Kickoff', status: 'complete', client_visible: true, due_date: '2026-07-01' },
    { id: 'm2', title: 'Design', status: 'open', client_visible: true, due_date: '2026-07-20' },
    { id: 'm3', title: 'Build', status: 'open', client_visible: true, due_date: null },
  ],
  tasks: [
    { id: 't1', title: 'Collect content', status: 'todo', client_visible: true, client_action_required: true, due_date: '2026-07-25', derived: { overdue: false } },
    { id: 't2', title: 'Wireframes', status: 'done', client_visible: false, client_action_required: false, derived: {} },
  ],
  deliverables: [{ id: 'd1', title: 'Homepage mock', status: 'shared', client_visible: true }],
  approvals: [{ id: 'a1', title: 'Homepage design', status: 'pending', content_hash: 'h1', client_visible: true }],
  progress: { pct: 50, done: 3, total: 6 },
  is_studio_view: true,
} };

// a bare project — NO milestones (the Path must not render), nothing else yet
const P9_DETAIL = { data: {
  project: { id: 'p9', name: 'Bare project', status: 'active', client_visible: true, client_id: null, target_date: null },
  milestones: [], tasks: [], deliverables: [], approvals: [],
  progress: { pct: 0, done: 0, total: 0 },
  is_studio_view: true,
} };
const P9_REPORT = { data: { summary: { progress: { pct: 0, done: 0, total: 0 }, milestones: { complete: 0, total: 0 }, open_client_actions: 0, pending_approvals: 0, shared_files: 0 } } };

// a COMPLETE project — every milestone done: terminal chip, no current step
const P2_DETAIL = { data: {
  project: { id: 'p2', name: 'Beta brand refresh', status: 'complete', client_visible: true, client_id: 'c-beta', target_date: null },
  milestones: [
    { id: 'bm1', title: 'Discovery', status: 'complete', client_visible: true, due_date: null },
    { id: 'bm2', title: 'Delivery', status: 'complete', client_visible: true, due_date: null },
  ],
  tasks: [], deliverables: [], approvals: [],
  progress: { pct: 100, done: 2, total: 2 },
  is_studio_view: true,
} };

// a project-less client support request for the ?support= deep-link surface
const SR1 = { data: {
  request: { id: 'sr1', subject: 'Update our opening hours', status: 'open', body: 'Can you change Saturday to 9–5?', requester_kind: 'client', created_at: '2026-07-10T00:00:00Z' },
  messages: [{ id: 'sm1', body: 'On it — draft coming today.', author_kind: 'staff', created_at: '2026-07-11T00:00:00Z' }],
} };

const API = {
  '/projects': LIST,
  '/studio/customers': CUSTOMERS,
  '/projects/p1': P1_DETAIL,
  '/projects/p1/report': P1_REPORT,
  '/projects/p1/messages': { data: [] },
  '/projects/p1/surveys': { data: [] },
  '/projects/p1/client-messages': { data: [], customer: { name: 'Acme Bakery' } },
  '/projects/p2': P2_DETAIL,
  '/projects/p2/report': P2_REPORT,
  '/projects/p2/messages': { data: [] },
  '/projects/p2/surveys': { data: [] },
  '/projects/p2/client-messages': { data: [], customer: { name: 'Beta Salon' } },
  // NOTE: p3 has NO /report fixture on purpose — its Progress/Open approvals
  // cells must degrade to "—" (no fake numbers). Tests that pin the degradation
  // route p3's report to a REAL 404 (see route404 below) so the shipped .catch
  // path runs — installApp's longest-prefix match would otherwise serve the
  // '/projects' LIST payload (HTTP 200, wrong shape) for it.
  '/projects/p9': P9_DETAIL,
  '/projects/p9/report': P9_REPORT,
  '/projects/p9/messages': { data: [] },
  '/projects/p9/surveys': { data: [] },
  '/projects/p9/client-messages': { data: [], customer: null },
  '/support': { data: [] },
};

// ── The studio's ten standard delivery steps ────────────────────────────────
// Mirrors supabase/functions/presence/lib/project_checklist.ts — [key, title,
// client_action, auto]. The REAL list is pinned by the pure suite
// (tests/presence/project_checklist_picker_test.mjs, which also fails if any of
// these titles is ever pasted into projects.html); this is the fixture the page
// is served, exactly as the server would send it.
const CHECKLIST_STEPS = [
  ['agreement_signed', 'Agreement signed', false, 'contract_signed'],
  ['deposit_paid', 'Deposit paid', false, 'deposit_paid'],
  ['questionnaire_returned', 'Send back your project questionnaire', true, null],
  ['content_received', 'Send your content and photos', true, null],
  ['draft_shared', 'Design draft shared', false, null],
  ['client_review', 'Review the design draft', true, null],
  ['revisions', 'Revisions', false, null],
  ['domain_connected', 'Domain connected', false, null],
  ['site_live', 'Site live', false, 'site_live'],
  ['handover', 'Handover', false, null],
] as Array<[string, string, boolean, string | null]>;

// register AFTER installApp (later routes match first): serve a genuine 404 for
// p3's report so the degradation path under test is the real error path
const routeP3Report404 = (page: import('@playwright/test').Page) =>
  page.route('**/functions/v1/presence/projects/p3/report', (route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Report not found.' }) }));

// Pin the display so every project (desktop/tablet/mobile) exercises the table —
// small screens default to Cards otherwise, which is its own test below.
const pinTable = (page: import('@playwright/test').Page) =>
  page.addInitScript(() => { try { if (!localStorage.getItem('dds-display:projects')) localStorage.setItem('dds-display:projects', 'table'); } catch { /* denied */ } });

test.describe('Projects list view', () => {
  test('renders the shared .lhead header + sortable table; report/customer enrichment fills in, unknown stays "—"', async ({ page }) => {
    await pinTable(page);
    await installApp(page, { api: API });
    await routeP3Report404(page);
    await page.goto('/projects.html');
    // header: 📁 object icon + H1 focus target + refresh + meta
    await expect(page.locator('.lhead .obj-ic')).toHaveText('📁');
    await expect(page.locator('#pagehead')).toHaveText('Projects');
    await expect(page.locator('.lmeta')).toContainText('3 projects');
    await expect(page.locator('.lmeta')).toContainText('2 active');
    await expect(page.locator('.lmeta')).toContainText('Updated just now');
    // the status filter chips survive (SS6: an honest role=group, All pressed)
    await expect(page.locator('#filters [aria-pressed="true"]')).toHaveText('All');
    await expect(page.locator('#filters .chip')).toHaveCount(5);
    // + New project survives for the studio view
    await expect(page.locator('#newProject')).toBeVisible();
    // table: default Project-ascending sort with aria-sort
    await expect(page.locator('th[aria-sort="ascending"]')).toContainText('Project');
    const firstCells = page.locator('tbody tr td:first-child');
    await expect(firstCells.first()).toContainText('Acme website build');
    // enrichment: customer names from /studio/customers, progress + approvals
    // from the per-project /report route
    await expect(page.locator('tbody tr').first()).toContainText('Acme Bakery');
    await expect(page.locator('tbody tr').first()).toContainText('3/6 tasks');
    await expect(page.locator('tbody tr').first().locator('.badge.wait')).toHaveText('2 waiting');
    await expect(page.locator('tbody tr').first()).toContainText('2026-08-01');
    // p3 = internal project with NO report fixture → honest degradation
    const p3row = page.locator('tbody tr[data-id="p3"]');
    await expect(p3row).toContainText('Internal');
    await expect(p3row.locator('.mutcell').nth(1)).toHaveText('—');   // progress unknown
    // status pills keep the existing classes
    await expect(page.locator('tbody .pill.complete')).toHaveText('complete');
  });

  test('column headers sort asc/desc with aria-sort; refresh returns focus to the control', async ({ page }) => {
    await pinTable(page);
    await installApp(page, { api: API });
    await page.goto('/projects.html');
    await expect(page.locator('tbody tr')).toHaveCount(3);
    await page.locator('[data-sort="name"]').click();
    await expect(page.locator('th[aria-sort="descending"]')).toContainText('Project');
    await expect(page.locator('tbody tr td:first-child').first()).toContainText('Internal ops');
    await expect(page.locator('.lmeta')).toContainText('Sorted by Project — descending');
    // a different column starts ascending
    await page.locator('[data-sort="status"]').click();
    await expect(page.locator('th[aria-sort="ascending"]')).toContainText('Status');
    // refresh with focus-return (the .lhead contract)
    await page.locator('#refreshBtn').click();
    await expect(page.locator('#refreshBtn')).toBeFocused();
    await expect(page.locator('tbody tr')).toHaveCount(3);
  });

  test('enrichment sort: unknown report values and undated targets cluster LAST in BOTH directions', async ({ page }) => {
    await pinTable(page);
    await installApp(page, { api: API });
    await routeP3Report404(page);   // p3's report is a REAL 404 → its cells stay "—"
    await page.goto('/projects.html');
    // wait for the report enrichment to land (p1's progress cell fills in)
    await expect(page.locator('tbody tr[data-id="p1"]')).toContainText('3/6 tasks');
    const ids = () => page.locator('tbody tr').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-id')));
    // Progress ascending: 50% → 100% → unknown LAST (never first)
    await page.locator('[data-sort="progress"]').click();
    await expect(page.locator('th[aria-sort="ascending"]')).toContainText('Progress');
    expect(await ids()).toEqual(['p1', 'p2', 'p3']);
    // Progress descending: 100% → 50% → unknown STILL last
    await page.locator('[data-sort="progress"]').click();
    await expect(page.locator('th[aria-sort="descending"]')).toContainText('Progress');
    expect(await ids()).toEqual(['p2', 'p1', 'p3']);
    // Target descending: the one dated project leads; undated rows never jump
    // ahead of it (the old '9999-99-99' sentinel put them FIRST descending)
    await page.locator('[data-sort="target_date"]').click();
    await page.locator('[data-sort="target_date"]').click();
    await expect(page.locator('th[aria-sort="descending"]')).toContainText('Target');
    expect(await ids()).toEqual(['p1', 'p2', 'p3']);
  });

  test('the status filter chips re-query the server and select honestly', async ({ page }) => {
    await pinTable(page);
    await installApp(page, { api: API });
    // the chips filter SERVER-side (?status=) — installApp ignores query strings,
    // so layer a query-aware route on top (registered later → matched first)
    await page.route('**/functions/v1/presence/projects?status=complete*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: LIST.data.filter((p) => p.status === 'complete'), is_studio_view: true }) }));
    await page.goto('/projects.html');
    await expect(page.locator('tbody tr')).toHaveCount(3);
    await page.locator('#filters [data-status="complete"]').click();
    await expect(page.locator('#filters [data-status="complete"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody tr').first()).toContainText('Beta brand refresh');
    await expect(page.locator('.lmeta')).toContainText('1 project · complete');
  });

  // ── SS6: C2 roster search · honest filter group · PROJ_SEQ · visible-rows fan-out ──
  test('C2 — roster search filters by project AND customer without rebuilding the input', async ({ page }) => {
    await pinTable(page);
    await installApp(page, { api: API });
    await routeP3Report404(page);
    await page.goto('/projects.html');
    await expect(page.locator('tbody tr')).toHaveCount(3);
    // wait for the customer enrichment so the customer-name search is real
    await expect(page.locator('tbody tr[data-id="p2"]')).toContainText('Beta Salon');
    const q = page.locator('#q');
    await q.evaluate((el) => { (el as HTMLElement).dataset.marker = 'kept'; });
    await q.pressSequentially('acme website');
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody tr').first()).toContainText('Acme website build');
    expect(await q.evaluate((el) => (el as HTMLElement).dataset.marker)).toBe('kept');
    await expect(page.locator('.lmeta')).toContainText('1 project');
    // customer-name search reaches the enriched column
    await q.fill('salon');
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody tr').first()).toContainText('Beta brand refresh');
    // no-match stays honest
    await q.fill('zzz-nobody');
    await expect(page.locator('#list')).toContainText('No projects match');
    await q.fill('');
    await expect(page.locator('tbody tr')).toHaveCount(3);
  });

  test('C5 — the status filters are an honest role=group with aria-pressed (no fake tablist)', async ({ page }) => {
    await pinTable(page);
    await installApp(page, { api: API });
    await page.goto('/projects.html');
    await expect(page.locator('#filters')).toHaveAttribute('role', 'group');
    await expect(page.locator('#filters [role=tab]')).toHaveCount(0);
    await expect(page.locator('#filters [data-status=""]')).toHaveAttribute('aria-pressed', 'true');
  });

  test('PROJ_SEQ — a stale section load can never paint into a newer record', async ({ page }) => {
    await pinTable(page);
    await installApp(page, { api: API });
    // p1's messages arrive LATE (non-blocking delay) — after the user has moved on to p2
    await page.route(/\/functions\/v1\/presence\/projects\/p1\/messages/, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      setTimeout(() => {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [
          { id: 'm1', body: 'STALE P1 MESSAGE', author_kind: 'client', audience: 'client', created_at: '2026-07-01T00:00:00Z' },
        ] }) }).catch(() => {});
      }, 800);
    });
    await page.goto('/projects.html');
    await page.locator('[data-open="p1"]').click();
    await expect(page.locator('#dtitle')).toContainText('Acme website build');
    await page.locator('#closeDetail').click();               // back to the roster
    await page.locator('[data-open="p2"]').click();           // open a DIFFERENT record
    await expect(page.locator('#dtitle')).toContainText('Beta brand refresh');
    await expect(page.locator('#msgList')).toContainText('No messages yet');
    await page.waitForTimeout(1100);                          // p1's stale response lands
    await expect(page.locator('#detailInner')).not.toContainText('STALE P1 MESSAGE');
    await expect(page.locator('#dtitle')).toContainText('Beta brand refresh');
  });

  test('ensureReports fans out only to VISIBLE rows when a searched roster reloads', async ({ page }) => {
    await pinTable(page);
    await installApp(page, { api: API });
    const reportCalls: string[] = [];
    // every report 404s so nothing caches — the fan-out size is what's under test
    await page.route(/\/functions\/v1\/presence\/projects\/(p1|p2|p3)\/report/, (route) => {
      reportCalls.push(route.request().url());
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Report not found.' }) });
    });
    await page.goto('/projects.html');
    await expect(page.locator('tbody tr')).toHaveCount(3);
    await expect.poll(() => reportCalls.length).toBe(3);      // boot: every row is visible
    await page.locator('#q').fill('acme website');
    await expect(page.locator('tbody tr')).toHaveCount(1);
    const before = reportCalls.length;
    await page.locator('#refreshBtn').click();                // reload with the search active
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect.poll(() => reportCalls.length).toBeGreaterThan(before);
    await page.waitForTimeout(300);                           // let any extra fan-out land
    const delta = reportCalls.slice(before);
    expect(delta.length).toBe(1);                             // ONLY the visible row re-asked
    expect(delta[0]).toContain('/projects/p1/report');
  });

  test('boots quiet: one h1, zero console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await pinTable(page);
    await installApp(page, { api: API });   // no 404 route here — a 404 logs a browser network error by design
    await page.goto('/projects.html');
    await expect(page.locator('tbody tr')).toHaveCount(3);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('#q')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('a row opens the record in-page and keeps the ?client= scope; breadcrumb returns', async ({ page }) => {
    await pinTable(page);
    await installApp(page, { api: API });
    await page.goto('/projects.html?client=site-op');
    await page.locator('tbody tr[data-id="p1"] td').first().click();
    await expect(page).toHaveURL(/project=p1/);
    await expect(page).toHaveURL(/client=site-op/);
    await expect(page.locator('#dtitle')).toHaveText('Acme website build');
    // breadcrumb: Projects › name — back to the roster, scope intact
    await page.locator('.crumbs .crumb').click();
    await expect(page.locator('#listWrap')).toBeVisible();
    await expect(page).toHaveURL(/client=site-op/);
    await expect(page).not.toHaveURL(/project=/);
  });

  test('cards open the record on click; the table row activates from the keyboard via its name button', async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('dds-display:projects', 'cards'); } catch { /* denied */ } });
    await installApp(page, { api: API });
    await page.goto('/projects.html');
    await expect(page.locator('#list .card')).toHaveCount(3);
    await page.locator('#list .card[data-id="p1"]').click();
    await expect(page.locator('#dtitle')).toHaveText('Acme website build');
    // back to the roster, switch to Table: the row's REAL control is the
    // project-name button — Enter opens the record (no tr tabindex hack)
    await page.locator('.crumbs .crumb').click();
    await expect(page.locator('#listWrap')).toBeVisible();
    await page.locator('#dispTable').click();
    const rowBtn = page.locator('tbody tr[data-id="p1"] .rowlink');
    await expect(rowBtn).toHaveText('Acme website build');
    await rowBtn.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#dtitle')).toHaveText('Acme website build');
    // the tr itself carries no bogus focus/label semantics anymore
    await expect(page.locator('tbody tr[tabindex]')).toHaveCount(0);
  });

  test('mobile defaults to the Cards display (the customers.html pattern); toggle persists', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'phone-width default under test');
    await installApp(page, { api: API });
    await page.goto('/projects.html');
    await expect(page.locator('#list .card')).toHaveCount(3);
    await expect(page.locator('.tscroll')).toHaveCount(0);
    await expect(page.locator('#dispCards')).toHaveAttribute('aria-pressed', 'true');
    // switching to Table sticks across a reload
    await page.locator('#dispTable').click();
    await expect(page.locator('tbody tr')).toHaveCount(3);
    await page.goto('/projects.html');
    await expect(page.locator('tbody tr')).toHaveCount(3);
    expect(await page.evaluate(() => localStorage.getItem('dds-display:projects'))).toBe('table');
  });
});

test.describe('Project record page', () => {
  test('breadcrumb + highlights panel + milestones-as-Path (single current step)', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/projects.html?project=p1');
    // breadcrumb: Projects › name
    await expect(page.locator('.crumbs [aria-current="page"]')).toHaveText('Acme website build');
    await expect(page.locator('#dtitle')).toHaveText('Acme website build');
    await expect(page.locator('.rec-sub .pill')).toHaveText('active');
    // highlights: Customer · Target date · Progress · Waiting on client · Files
    const hl = page.locator('.hl-panel');
    await expect(hl).toContainText('Acme Bakery');
    await expect(hl).toContainText('2026-08-01');
    await expect(hl).toContainText('50%');
    await expect(hl).toContainText('3/6 tasks');
    await expect(hl).toContainText('2 approvals');
    await expect(hl).toContainText('4 shared');
    // the Path IS the milestones, in order: done ✓ → current (ONE aria-current) → future
    const steps = page.locator('ol.path .pstep');
    await expect(steps).toHaveCount(3);
    await expect(steps.nth(0)).toHaveClass(/done/);
    await expect(steps.nth(0)).toContainText('✓ Kickoff');
    await expect(steps.nth(1)).toHaveClass(/current/);
    await expect(steps.nth(1)).toHaveText('Design');
    await expect(steps.nth(2)).toHaveClass(/todo/);
    await expect(page.locator('[aria-current="step"]')).toHaveCount(1);
    await expect(page.locator('[aria-current="step"]')).toHaveText('Design');
    // the Path action targets the CURRENT milestone via the existing PATCH
    await expect(page.locator('#msComplete')).toHaveAttribute('data-ms', 'm2');
    const [req] = await Promise.all([
      page.waitForRequest((r) => r.method() === 'PATCH' && r.url().includes('/projects/p1/milestones/m2')),
      page.locator('#msComplete').click(),
    ]);
    expect(req.postData()).toContain('"status":"complete"');
  });

  test('tasks render as a checkbox list with tags; the toggle round-trips (PATCH done → refetch → focus restored)', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/projects.html?project=p1');
    await expect(page.locator('#tsList .titem')).toHaveCount(2);
    // visibility tags survive the redesign
    await expect(page.locator('#tsList .tag.client')).toHaveText('shared');
    await expect(page.locator('#tsList .tag.action')).toHaveText('your action');
    // done task: checked + struck; open task: unchecked
    await expect(page.locator('[data-tdone="t2"]')).toBeChecked();
    await expect(page.locator('[data-tdone="t1"]')).not.toBeChecked();
    // the other ladder moves stay reachable (todo → in progress / blocked)
    await expect(page.locator('[data-task="t1"][data-to="in_progress"]')).toBeVisible();
    await expect(page.locator('[data-task="t1"][data-to="blocked"]')).toBeVisible();
    // the round-trip is REAL: the PATCH flips the fixture, the refetch serves
    // the flipped detail, and the row renders done (checked + struck)
    const detail = JSON.parse(JSON.stringify(P1_DETAIL));
    await page.route('**/functions/v1/presence/projects/p1', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail) }));
    await page.route('**/functions/v1/presence/projects/p1/tasks/t1', (route) => {
      detail.data.tasks[0].status = JSON.parse(route.request().postData() || '{}').status;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ok: true } }) });
    });
    // checking the box PATCHes status:done and re-opens the record (focus → title)
    const [req] = await Promise.all([
      page.waitForRequest((r) => r.method() === 'PATCH' && r.url().includes('/projects/p1/tasks/t1')),
      page.locator('[data-tdone="t1"]').check(),
    ]);
    expect(req.postData()).toContain('"status":"done"');
    await expect(page.locator('#dtitle')).toBeFocused();
    await expect(page.locator('[data-tdone="t1"]')).toBeChecked();
    await expect(page.locator('#tsList .titem').filter({ hasText: 'Collect content' }).locator('.t')).toHaveClass(/donetext/);
  });

  // ── the operator's side of "the client can't tick their own steps" ──────────
  // The client lost the Mark done button on the three checklist steps addressed
  // to them (client.html) and a crafted POST is refused at the client door
  // (routes/client_delivery.ts). NONE of that reaches this door: Eric ticks all
  // ten from here, including the three he now owns, or the rule would have taken
  // away the only tick that remained.
  test('the studio can tick every one of the ten checklist steps — including the three the client can’t', async ({ page }) => {
    const STEPS = CHECKLIST_STEPS;
    const detail = { data: { ...P1_DETAIL.data, tasks: STEPS.map(([key, title, act], i) => ({
      id: `ck${i}`, title, status: 'todo', client_visible: act, client_action_required: act,
      source: `checklist:${key}`, sort_order: i * 10, derived: { overdue: false },
    })) } };
    await installApp(page, { api: { ...API, '/projects/p1': detail } });
    await page.goto('/projects.html?project=p1');
    await expect(page.locator('#tsList .titem')).toHaveCount(10);
    // every step is tickable from here — no source ever gates the studio's own door
    await expect(page.locator('#tsList [data-tdone]')).toHaveCount(10);
    for (const box of await page.locator('#tsList [data-tdone]').all()) {
      await expect(box).toBeEnabled();
      await expect(box).not.toBeChecked();
    }
    // and the tick on a CLIENT-facing step (ck3 = "Send your content and photos")
    // is the ordinary studio PATCH, unchanged
    await page.route('**/functions/v1/presence/projects/p1/tasks/ck3', (route) => {
      detail.data.tasks[3].status = JSON.parse(route.request().postData() || '{}').status;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ok: true } }) });
    });
    const [req] = await Promise.all([
      page.waitForRequest((r) => r.method() === 'PATCH' && r.url().includes('/projects/p1/tasks/ck3')),
      page.locator('[data-tdone="ck3"]').check(),
    ]);
    expect(req.postData()).toContain('"status":"done"');
    await expect(page.locator('[data-tdone="ck3"]')).toBeChecked();
  });

  test('the Status ▾ popup honors the slice-2 contract (aria-expanded, Escape→focus, outside click, ladder-only items)', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/projects.html?project=p1');
    const btn = page.locator('#statusBtn');
    const menu = page.locator('#statusMenu');
    await expect(btn).toHaveAttribute('aria-haspopup', 'menu');
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await btn.click();
    await expect(menu).toBeVisible();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    // only the bounded P_NEXT ladder renders (active → on hold / complete / archived)
    const items = menu.locator('[role="menuitem"]');
    await expect(items).toHaveCount(3);
    await expect(items.first()).toBeFocused();
    // roving focus: ArrowDown/ArrowUp move (clamped at the ends), Home/End jump
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(2)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(2)).toBeFocused();   // clamped — no wrap past the end
    await page.keyboard.press('ArrowUp');
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press('Home');
    await expect(items.nth(0)).toBeFocused();
    await page.keyboard.press('End');
    await expect(items.nth(2)).toBeFocused();
    // Escape closes and hands focus back to the trigger
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await expect(btn).toBeFocused();
    // Escape while focus is on the TRIGGER (menu open) also closes, focus stays put
    await btn.click();
    await expect(menu).toBeVisible();
    await btn.focus();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(btn).toBeFocused();
    // focus leaving button+menu closes the popup without stealing focus back
    await btn.click();
    await expect(menu).toBeVisible();
    await page.locator('#renameProj').focus();
    await expect(menu).toBeHidden();
    await expect(page.locator('#renameProj')).toBeFocused();
    // outside click closes via the ONE delegated document closer (click the
    // object icon — top-left, never covered by the right-aligned open menu at
    // phone widths, the rosters.spec pattern)
    await btn.click();
    await expect(menu).toBeVisible();
    await page.locator('.rhead .obj-ic').click();
    await expect(menu).toBeHidden();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    // ONE TRUE MUTATION ROUND-TRIP: the POST flips the fixture and the refetch
    // serves it, so the pill VISIBLY reads on hold (not just a request assert)
    const detail = JSON.parse(JSON.stringify(P1_DETAIL));
    await page.route('**/functions/v1/presence/projects/p1', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail) }));
    await page.route('**/functions/v1/presence/projects/p1/status', (route) => {
      detail.data.project.status = JSON.parse(route.request().postData() || '{}').to;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ok: true } }) });
    });
    await btn.click();
    const [req] = await Promise.all([
      page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/projects/p1/status')),
      menu.locator('[data-pstatus="on_hold"]').click(),
    ]);
    expect(req.postData()).toContain('"to":"on_hold"');
    await expect(page.locator('.rec-sub .pill')).toHaveText('on hold');
    await expect(page.locator('.rec-sub .pill')).toHaveClass(/on_hold/);
  });

  test('no milestones → NO Path; friendly empty states throughout', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/projects.html?project=p9');
    await expect(page.locator('#dtitle')).toHaveText('Bare project');
    // the Path never renders for a project without milestones (no false chevrons)
    await expect(page.locator('.pathcard')).toHaveCount(0);
    await expect(page.locator('[aria-current="step"]')).toHaveCount(0);
    // friendly empty states
    await expect(page.locator('#msList')).toContainText('No milestones yet — map the journey');
    await expect(page.locator('#tsList')).toContainText('No tasks yet — add the first one');
    await expect(page.locator('#apList')).toContainText('Nothing waiting on an approval');
    await expect(page.locator('#svList')).toContainText('No surveys yet —');
    await expect(page.locator('#svList .linkbtn')).toContainText('send a check-in →');
    await expect(page.locator('#dlList')).toContainText('No files yet');
    await expect(page.locator('#supList')).toContainText('No support requests for this project.');
    // internal project (no customer) reads honestly in the highlights
    await expect(page.locator('.hl-panel')).toContainText('Internal');
  });

  test('a COMPLETE project: terminal chip, no false current step, complete-status ladder actions', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/projects.html?project=p2');
    await expect(page.locator('#dtitle')).toHaveText('Beta brand refresh');
    await expect(page.locator('.rec-sub .pill')).toHaveText('complete');
    // every milestone done → the terminal chip, and NO step claims to be current
    await expect(page.locator('.terminal-chip.won')).toHaveText('All milestones complete ✓');
    await expect(page.locator('[aria-current="step"]')).toHaveCount(0);
    await expect(page.locator('.pstep.current')).toHaveCount(0);
    await expect(page.locator('#msComplete')).toHaveCount(0);
    await expect(page.locator('ol.path .pstep.done')).toHaveCount(2);
    // the complete-status ladder: only active / archived remain reachable
    await page.locator('#statusBtn').click();
    const items = page.locator('#statusMenu [role="menuitem"]');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toHaveText('Mark active');
    await expect(items.nth(1)).toHaveText('Mark archived');
  });

  test('client persona: Approve/Request-changes present, studio controls hidden', async ({ page }) => {
    const P1_CLIENT = JSON.parse(JSON.stringify(P1_DETAIL));
    P1_CLIENT.data.is_studio_view = false;
    await installApp(page, { api: { ...API, '/projects': { ...LIST, is_studio_view: false }, '/projects/p1': P1_CLIENT } });
    await page.goto('/projects.html?project=p1');
    await expect(page.locator('#dtitle')).toHaveText('Acme website build');
    // the client CAN decide the pending approval
    await expect(page.locator('[data-approve="a1"][data-dec="approved"]')).toBeVisible();
    await expect(page.locator('[data-approve="a1"][data-dec="changes_requested"]')).toBeVisible();
    // …and sees NONE of the studio's write controls
    await expect(page.locator('#statusBtn')).toHaveCount(0);
    await expect(page.locator('#renameProj')).toHaveCount(0);
    await expect(page.locator('#quickTask')).toHaveCount(0);
    await expect(page.locator('#addTask')).toHaveCount(0);
    await expect(page.locator('#addMs')).toHaveCount(0);
    await expect(page.locator('#addFile')).toHaveCount(0);
    await expect(page.locator('#addAppr')).toHaveCount(0);
    await expect(page.locator('#addSurvey')).toHaveCount(0);
    await expect(page.locator('#msComplete')).toHaveCount(0);
    // the approval decision POSTs the existing decide route with the shown hash
    const [req] = await Promise.all([
      page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/approvals/a1/decide')),
      page.locator('[data-approve="a1"][data-dec="approved"]').click(),
    ]);
    expect(req.postData()).toContain('"presented_hash":"h1"');
  });

  test('?support= deep-link boots straight into the full conversation surface with the reply wired', async ({ page }) => {
    await installApp(page, { api: { ...API, '/support/sr1': SR1 } });
    await page.goto('/projects.html?support=sr1');
    // the full-screen record treatment: breadcrumb + 💬 header + thread
    await expect(page.locator('#dtitle')).toHaveText('Update our opening hours');
    await expect(page.locator('.rec-sub')).toContainText('a general request (not tied to a project)');
    await expect(page.locator('#detailInner')).toContainText('Can you change Saturday to 9–5?');
    await expect(page.locator('#detailInner')).toContainText('On it — draft coming today.');
    await expect(page.locator('#listWrap')).toBeHidden();
    // the reply form POSTs the existing /support/:id/messages route
    await page.locator('#srf-body-sr1').fill('Done — hours updated.');
    const [req] = await Promise.all([
      page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/support/sr1/messages')),
      page.locator('#srf-reply button[type="submit"]').click(),
    ]);
    expect(req.postData()).toContain('Done — hours updated.');
  });

  test('rename survives: the header action swaps in the inline editor and PATCHes the name', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/projects.html?project=p1');
    await page.locator('#renameProj').click();
    const inp = page.locator('#renInput');
    await expect(inp).toBeFocused();
    await inp.fill('Acme site v2');
    const [req] = await Promise.all([
      page.waitForRequest((r) => r.method() === 'PATCH' && /\/projects\/p1$/.test(new URL(r.url()).pathname)),
      page.locator('#renSave').click(),
    ]);
    expect(req.postData()).toContain('Acme site v2');
  });
});

test.describe('Projects accessibility', () => {
  test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'desktop-chromium', 'axe once, on desktop'); });

  test('no serious/critical axe violations on the roster (table view)', async ({ page }) => {
    await pinTable(page);
    await installApp(page, { api: API });
    await page.goto('/projects.html');
    await expect(page.locator('tbody tr')).toHaveCount(3);
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(serious.map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);
  });

  test('no serious/critical axe violations on the record page (Status menu open)', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/projects.html?project=p1');
    await expect(page.locator('ol.path .pstep')).toHaveCount(3);
    await page.waitForLoadState('networkidle');
    // scan with the popup OPEN — a closed popup is display:none and invisible to axe
    await page.locator('#statusBtn').click();
    await expect(page.locator('#statusMenu')).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(serious.map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);
  });
});

// ── Batch A (post-redesign audit) — A10: origin honesty in the Files list ────
test.describe('Project record — client-upload origin (A10)', () => {
  test('a client upload carries the "From client" chip + meta line; studio shares do not', async ({ page }) => {
    const detail = JSON.parse(JSON.stringify(P1_DETAIL));
    detail.data.deliverables = [
      { id: 'd1', title: 'Homepage mock', status: 'shared', client_visible: true },
      // the server-stamped note (client_delivery.ts) — PREFIX matched, so a
      // studio appending to the note keeps the origin visible
      { id: 'd2', title: 'logo-original.png', status: 'shared', client_visible: true, note: 'Uploaded by the client. Resized + filed.' },
    ];
    await installApp(page, { api: { ...API, '/projects/p1': detail } });
    await page.goto('/projects.html?project=p1');
    const files = page.locator('#dlList');
    const clientRow = files.locator('.item').filter({ hasText: 'logo-original.png' });
    await expect(clientRow.locator('.tag.fromclient')).toHaveText('From client');
    await expect(clientRow).toContainText('Uploaded by the client');
    const studioRow = files.locator('.item').filter({ hasText: 'Homepage mock' });
    await expect(studioRow.locator('.tag.fromclient')).toHaveCount(0);
  });
});

// ── SS6 regression pin: the New-project dialog must SUBMIT on phones ─────────
// Same failure family as the rosters' Add-a-customer pin: `margin:auto` on the
// top-layer dialog + the mobile layout-viewport widening (courting the wide
// roster table) put the Create button beyond the visible viewport, so taps
// never reached it. Pinned with the table view behind the dialog on purpose.
test.describe('Projects — the New-project dialog on phones (SS6 pin)', () => {
  test('create submits over the pinned roster table: POST /projects lands and the new record opens', async ({ page }) => {
    await pinTable(page);
    await installApp(page, { api: API });
    await routeP3Report404(page);
    // POST /projects is a write — serve the created id; reads fall through
    await page.route(/\/functions\/v1\/presence\/projects(\?|$)/, (route) => {
      if (route.request().method() === 'POST') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { id: 'p9' } }) });
      return route.fallback();
    });
    await page.goto('/projects.html');
    await page.locator('#newProject').click();
    await expect(page.locator('#newDlg')).toBeVisible();
    // the open dialog must fit the DEVICE viewport — the broken geometry sized
    // it against the widened layout viewport, pushing Create out of reach
    const vp = page.viewportSize()!;
    const box = (await page.locator('#newDlg').boundingBox())!;
    expect(box.x, 'dialog left edge on-screen').toBeGreaterThanOrEqual(0);
    expect(box.y, 'dialog top edge on-screen').toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, 'dialog right edge within the device viewport').toBeLessThanOrEqual(vp.width + 1);
    expect(box.y + box.height, 'dialog bottom edge within the device viewport').toBeLessThanOrEqual(vp.height + 1);
    await page.locator('#np-name').fill('Zeta rebuild');
    await page.locator('#np-desc').fill('Scope: a full site refresh with a new booking flow.');
    const post = page.waitForRequest((r) => r.method() === 'POST' && /\/presence\/projects(\?|$)/.test(r.url()));
    await page.locator('#newForm button[type="submit"]').click();
    // exactly what the handler sends: empty optional fields are omitted
    expect((await post).postDataJSON()).toEqual({ name: 'Zeta rebuild', description: 'Scope: a full site refresh with a new booking flow.' });
    await expect(page.locator('#newDlg')).toBeHidden();
    await expect(page.locator('#dtitle')).toContainText('Bare project');   // openProject(created id)
  });
});

// ── The standard-step picker (P2-D · Eric's ask) ─────────────────────────────
// "there also should be a drop down for tasks that we know need to be completed
// that we add and once completed the percentage goes up."
//
// The ten steps already were the studio's spine, but only the deal→project
// handoff could put them on a project. A project that missed that door — every
// project made before the checklist, Bacchus among them — reads "0% · 0/0 tasks"
// and has no way out except a SQL backfill. These tests drive the way out from
// the page: pick known steps (several at once), or take the whole spine in one
// press, and watch the COMPUTED percentage move.
//
// The mock is a small STATE MACHINE, not a fixture: the writes actually apply,
// so the percentage each assertion reads is one the server computed from rows —
// the way the real /report route computes it (progressOf: done ÷ total).
type Held = Map<string, 'todo' | 'done'>;
function installChecklistProject(page: import('@playwright/test').Page, opts: { held?: string[]; signedAndPaid?: boolean } = {}) {
  const held: Held = new Map();
  for (const k of opts.held || []) held.set(k, 'todo');
  const step = (key: string) => CHECKLIST_STEPS.find((s) => s[0] === key)!;
  const idxOf = (key: string) => CHECKLIST_STEPS.findIndex((s) => s[0] === key);
  const tasks = () => [...held.entries()]
    .sort((a, b) => idxOf(a[0]) - idxOf(b[0]))
    .map(([key, status]) => ({
      id: 'ck-' + key, title: step(key)[1], status, detail: '', priority: 'normal',
      client_visible: step(key)[2], client_action_required: step(key)[2],
      source: 'checklist:' + key, sort_order: idxOf(key) * 10, derived: { overdue: false },
    }));
  // exactly what routes/projects.ts checklistState() returns
  const checklist = () => CHECKLIST_STEPS.map(([key, title, act, auto]) => ({
    key, title, client_action: act, auto, present: held.has(key), status: held.get(key) ?? null,
  }));
  const progress = () => {
    const total = held.size, done = [...held.values()].filter((s) => s === 'done').length;
    return { pct: total ? Math.round((done / total) * 100) : 0, done, total };
  };
  const posts: Array<Record<string, unknown>> = [];
  const jsonOf = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

  page.route(/\/functions\/v1\/presence\/projects\/p7/, (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^.*\/presence\/projects\/p7/, '') || '';
    const method = route.request().method();
    if (path === '/checklist' && method === 'POST') {
      const b = route.request().postDataJSON() || {};
      posts.push(b);
      const asked: string[] = b.all === true ? CHECKLIST_STEPS.map((s) => s[0]) : (b.keys || []);
      const missing = asked.filter((k) => !held.has(k));
      for (const k of missing) held.set(k, 'todo');
      // reconcileChecklistFacts: the two evidence steps are ticked from facts the
      // system already owns, so a signed + paid project never lands on 0%
      let reconciled = false;
      if (opts.signedAndPaid && missing.some((k) => k === 'agreement_signed' || k === 'deposit_paid')) {
        reconciled = true;
        for (const k of ['agreement_signed', 'deposit_paid']) if (held.has(k)) held.set(k, 'done');
      }
      return route.fulfill(jsonOf({ data: { added: missing.length, added_keys: missing, skipped_keys: asked.filter((k) => !missing.includes(k)), reconciled, checklist: checklist() } }, missing.length ? 201 : 200));
    }
    if (/^\/tasks\/ck-/.test(path) && method === 'PATCH') {
      const key = path.replace('/tasks/ck-', '');
      held.set(key, (route.request().postDataJSON() || {}).status);
      return route.fulfill(jsonOf({ data: { ok: true } }));
    }
    if (path === '/tasks' && method === 'POST') { posts.push(route.request().postDataJSON() || {}); return route.fulfill(jsonOf({ data: { id: 'free1' } }, 201)); }
    if (path === '/report') return route.fulfill(jsonOf({ data: { summary: { progress: progress(), milestones: { complete: 0, total: 0 }, open_client_actions: 0, pending_approvals: 0, shared_files: 0 } } }));
    if (path === '/messages' || path === '/surveys') return route.fulfill(jsonOf({ data: [] }));
    if (path === '/client-messages') return route.fulfill(jsonOf({ data: [], customer: null }));
    if (path === '') return route.fulfill(jsonOf({ data: {
      project: { id: 'p7', name: 'Bacchus website', status: 'active', client_visible: true, client_id: null, target_date: null },
      milestones: [], tasks: tasks(), deliverables: [], approvals: [],
      progress: progress(), checklist: checklist(), is_studio_view: true,
    } }));
    return route.fulfill(jsonOf({ data: {} }));
  });
  return { posts, held };
}

test.describe('Project record — the standard-step picker', () => {
  test('Bacchus before the backfill: 0/0 with one press to the whole spine, and the evidence already ticked', async ({ page }) => {
    await installApp(page, { api: API });
    installChecklistProject(page, { signedAndPaid: true });   // registered AFTER installApp, so it wins
    await page.goto('/projects.html?project=p7');
    await expect(page.locator('#dtitle')).toContainText('Bacchus');
    // the honest, useless number this whole feature exists to move
    await expect(page.locator('.hl-panel')).toContainText('0%');
    await expect(page.locator('#tsList')).toContainText('No tasks yet');
    // the affordance is unmissable, and only offered because NONE are present
    const nudge = page.locator('.stepnudge');
    await expect(nudge).toBeVisible();
    await expect(nudge).toContainText('None of the 10 standard delivery steps');
    const [req] = await Promise.all([
      page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/projects/p7/checklist')),
      page.locator('#addAllSteps').click(),
    ]);
    expect(req.postDataJSON()).toEqual({ all: true });
    // the record repaints from the server — no manual reload
    await expect(page.locator('#tsList .titem')).toHaveCount(10);
    // 2 of 10 done, because the signed contract and the paid deposit were ALREADY
    // true: 20%, not a fresh zero
    await expect(page.locator('.hl-panel')).toContainText('20%');
    await expect(page.locator('.hl-panel')).toContainText('2/10 tasks');
    await expect(page.locator('#tsList [data-tdone]:checked')).toHaveCount(2);
    // …and now there is nothing left to add: no nudge, no picker button
    await expect(page.locator('.stepnudge')).toHaveCount(0);
    await expect(page.locator('#addStep')).toHaveCount(0);
  });

  test('the picker lists all ten, disables the ones already here, and adds several at once', async ({ page }) => {
    await installApp(page, { api: API });
    installChecklistProject(page, { held: ['deposit_paid'] });
    await page.goto('/projects.html?project=p7');
    await expect(page.locator('#dtitle')).toContainText('Bacchus');
    // one step present → no "add all" nudge, but the picker is offered
    await expect(page.locator('.stepnudge')).toHaveCount(0);
    await page.locator('#addStep').click();
    const rows = page.locator('.steppick .sp-row');
    await expect(rows).toHaveCount(10);
    // the step the project already holds is SHOWN, disabled, with the reason —
    // never silently missing, and never submittable
    const has = page.locator('.steppick .sp-row.has');
    await expect(has).toHaveCount(1);
    await expect(has).toContainText('Deposit paid');
    await expect(has).toContainText('already on this project');
    await expect(has.locator('input')).toBeDisabled();
    await expect(page.locator('.steppick input[data-step]:not([disabled])')).toHaveCount(9);
    // the three the client sees are marked, quietly; the self-ticking ones too
    await expect(page.locator('.steppick .tag.client')).toHaveCount(3);
    await expect(page.locator('.steppick .sp-row', { hasText: 'Site live' }).locator('.tag')).toContainText('ticks itself');
    // several at once — the reason this is a checkbox list and not a dropdown
    await page.locator('.steppick input[data-step="draft_shared"]').check();
    await page.locator('.steppick input[data-step="site_live"]').check();
    const [req] = await Promise.all([
      page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/projects/p7/checklist')),
      page.locator('#spAdd').click(),
    ]);
    // KEYS, never titles: the server builds the row from lib/project_checklist.ts
    expect(req.postDataJSON()).toEqual({ keys: ['draft_shared', 'site_live'] });
    await expect(page.locator('#tsList .titem')).toHaveCount(3);
    await expect(page.locator('.hl-panel')).toContainText('0/3 tasks');
    // re-opening the picker no longer offers what we just added
    await page.locator('#addStep').click();
    await expect(page.locator('.steppick .sp-row.has')).toHaveCount(3);
    await expect(page.locator('.steppick input[data-step="site_live"]')).toBeDisabled();
    // select-all-remaining takes the rest in one go
    await page.locator('#spAll').click();
    await expect(page.locator('.steppick input[data-step]:checked')).toHaveCount(7);
    const [req2] = await Promise.all([
      page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/projects/p7/checklist')),
      page.locator('#spAdd').click(),
    ]);
    expect((req2.postDataJSON() as { keys: string[] }).keys).toHaveLength(7);
    await expect(page.locator('#tsList .titem')).toHaveCount(10);
    await expect(page.locator('#addStep')).toHaveCount(0);   // nothing left to offer
  });

  test('ticking a picked step moves the computed percentage — no reload', async ({ page }) => {
    await installApp(page, { api: API });
    installChecklistProject(page, { held: ['draft_shared', 'revisions', 'handover', 'client_review'] });
    await page.goto('/projects.html?project=p7');
    await expect(page.locator('.hl-panel')).toContainText('0%');
    await expect(page.locator('.hl-panel')).toContainText('0/4 tasks');
    await page.locator('[data-tdone="ck-draft_shared"]').check();
    await expect(page.locator('.hl-panel')).toContainText('25%');
    await expect(page.locator('.hl-panel')).toContainText('1/4 tasks');
    // the Tasks card's own counter moves with it
    await expect(page.locator('.rsec h3', { hasText: 'Tasks' }).locator('.n')).toHaveText('1/4');
    // a CLIENT-facing step is Eric's to tick too (operator-verified, never theirs)
    await page.locator('[data-tdone="ck-client_review"]').check();
    await expect(page.locator('.hl-panel')).toContainText('50%');
    // and it reopens: untick returns the number honestly
    await page.locator('[data-tdone="ck-client_review"]').uncheck();
    await expect(page.locator('.hl-panel')).toContainText('25%');
  });

  test('free-text tasks are untouched — no source, no keys, still the plain form', async ({ page }) => {
    await installApp(page, { api: API });
    installChecklistProject(page, { held: ['handover'] });
    await page.goto('/projects.html?project=p7');
    await page.locator('#addTask').click();
    await page.locator('#mf-title').fill('Call the printer');
    await page.locator('#mf-client_action_required').check();
    const [req] = await Promise.all([
      page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/projects/p7/tasks')),
      page.locator('#tsForm form button[type="submit"]').click(),
    ]);
    // the EXACT free-text shape — no `source`, no keys, nothing checklist-shaped
    expect(req.postDataJSON()).toEqual({ title: 'Call the printer', client_action_required: true });
    // the picker and the free-text form share ONE host, so only one is ever open
    await page.locator('#addStep').click();
    await expect(page.locator('#tsForm form.steppick')).toHaveCount(1);
    await expect(page.locator('#tsForm #mf-title')).toHaveCount(0);
    await page.locator('#addTask').click();
    await expect(page.locator('#tsForm form.steppick')).toHaveCount(0);
    await expect(page.locator('#tsForm #mf-title')).toHaveCount(1);
  });

  test('a race is answered honestly: a 409 refreshes the card instead of claiming a save', async ({ page }) => {
    await installApp(page, { api: API });
    installChecklistProject(page, {});
    // the other tab won: the unique index refuses, and the step is already there
    await page.route(/\/functions\/v1\/presence\/projects\/p7\/checklist/, (route) => route.fulfill({
      status: 409, contentType: 'application/json',
      body: JSON.stringify({ error: 'conflict', message: 'Those steps were just added somewhere else — refresh to see where the project stands.' }),
    }));
    await page.goto('/projects.html?project=p7');
    await page.locator('#addAllSteps').click();
    await expect(page.locator('.dds-toast, #toast, [role="status"]').filter({ hasText: 'just added somewhere else' }).first()).toBeVisible();
    // and the card is re-read rather than left showing an invented success
    await expect(page.locator('#tsList')).toContainText('No tasks yet');
  });

  test('the picker fits a phone and stays keyboard-reachable (no horizontal overflow)', async ({ page }) => {
    await installApp(page, { api: API });
    installChecklistProject(page, { held: ['deposit_paid'] });
    await page.goto('/projects.html?project=p7');
    await page.locator('#addStep').click();
    await expect(page.locator('.steppick')).toBeVisible();
    // the page must never scroll sideways because of the picker
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    const vp = page.viewportSize()!;
    const box = (await page.locator('.steppick').boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1);
    // focus lands on the first pickable step, so a keyboard can drive it
    await expect(page.locator('.steppick input[data-step="agreement_signed"]')).toBeFocused();
    await expect(page.locator('#spAdd')).toBeVisible();
  });

  test('no serious/critical axe violations with the picker open', async ({ page }) => {
    await installApp(page, { api: API });
    installChecklistProject(page, { held: ['deposit_paid'] });
    await page.goto('/projects.html?project=p7');
    await page.locator('#addStep').click();
    await expect(page.locator('.steppick')).toBeVisible();
    const r = await new AxeBuilder({ page }).analyze();
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);
  });
});
