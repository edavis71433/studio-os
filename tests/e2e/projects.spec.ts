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
    // the status filter chips survive (role=tablist, All selected)
    await expect(page.locator('#filters [role="tab"][aria-selected="true"]')).toHaveText('All');
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
    await expect(page.locator('#filters [data-status="complete"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody tr').first()).toContainText('Beta brand refresh');
    await expect(page.locator('.lmeta')).toContainText('1 project · complete');
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
