import { test, expect } from '@playwright/test';
import { installApp } from './helpers/app';

// Rosters as Salesforce list views (redesign slice 3): customers.html and
// contacts.html get a list-view header (object icon + fixed-view dropdown +
// "N items · Updated just now" meta + refresh), sortable table columns with
// aria-sort, and a Table ⇄ Cards display toggle persisted in localStorage
// (cards = the original look, kept). D3: fixed views only — no saved views,
// no bulk actions, no inline edit.

const CUSTOMERS = { data: [
  { client_id: 'c-acme', name: 'Acme Bakery', email: 'a@acme.com', project_id: 'p1', project_name: 'Site', status: 'active', customer_site_id: 'site-acme', open_support: 2, project_count: 1 },
  { client_id: 'c-beta', name: 'Beta Salon', email: 'b@beta.com', project_id: 'p2', project_name: 'Brand', status: 'complete', customer_site_id: 'site-beta', open_support: 0, project_count: 3 },
  { client_id: 'c-zeta', name: 'Zeta Gym', email: 'z@zeta.com', project_id: 'p3', project_name: 'Site', status: 'active', customer_site_id: null, open_support: 0, project_count: 1 },
] };

const CONTACTS = { data: [
  // relative to the runtime clock so the "Recently updated" (30-day) view is deterministic
  { id: 'ct-1', name: 'Sam Rivera', email: 'sam@example.com', phone: '(555) 111-2222', company: 'Acme', updated_at: new Date(Date.now() - 2 * 86400000).toISOString() },
  { id: 'ct-2', name: 'Dana Lee', email: 'dana@example.com', phone: '', company: 'Beta', updated_at: new Date(Date.now() - 90 * 86400000).toISOString() },
] };

// Pin the display so every project (desktop/tablet/mobile) exercises the table —
// small screens default to Cards otherwise, which is its own test below.
// Set-if-absent: an explicit in-test choice (the persistence test) must survive
// the reload — addInitScript reruns on every navigation.
const pinTable = (key: string) => (page: import('@playwright/test').Page) =>
  page.addInitScript((k) => { try { if (!localStorage.getItem(k)) localStorage.setItem(k, 'table'); } catch { /* denied */ } }, key);

test.describe('Customers list view', () => {
  test('renders the list-view header + sortable table from /studio/customers', async ({ page }) => {
    await pinTable('dds-display:customers')(page);
    await installApp(page, { api: { '/studio/customers': CUSTOMERS } });
    await page.goto('/customers.html');
    // header: object icon + view-name dropdown + meta + refresh
    await expect(page.locator('#viewBtn')).toContainText('All customers');
    await expect(page.locator('.lmeta')).toContainText('3 customers');
    await expect(page.locator('.lmeta')).toContainText('Updated just now');
    await expect(page.locator('#refreshBtn')).toBeVisible();
    // table: th scope=col + default Name-ascending sort (aria-sort)
    await expect(page.locator('th[scope="col"]').first()).toBeVisible();
    await expect(page.locator('th[aria-sort="ascending"]')).toContainText('Name');
    const names = page.locator('tbody tr td:first-child');
    await expect(names.first()).toContainText('Acme Bakery');
    // status renders as the existing pill; waiting count as the badge
    await expect(page.locator('tbody .pill.complete')).toContainText('complete');
    await expect(page.locator('tbody .badge.wait')).toContainText('2 waiting');
  });

  test('clicking a column header sorts asc/desc with aria-sort', async ({ page }) => {
    await pinTable('dds-display:customers')(page);
    await installApp(page, { api: { '/studio/customers': CUSTOMERS } });
    await page.goto('/customers.html');
    // Name starts ascending — clicking it flips to descending
    await page.locator('[data-sort="name"]').click();
    await expect(page.locator('th[aria-sort="descending"]')).toContainText('Name');
    await expect(page.locator('tbody tr td:first-child').first()).toContainText('Zeta Gym');
    // meta mirrors the sort header
    await expect(page.locator('.lmeta')).toContainText('Sorted by Name — descending');
    // a different column starts ascending
    await page.locator('[data-sort="open_support"]').click();
    await expect(page.locator('th[aria-sort="ascending"]')).toContainText('Waiting');
    await expect(page.locator('tbody tr td:first-child').last()).toContainText('Acme Bakery');
  });

  test('the fixed-view dropdown filters client-side (Needs attention)', async ({ page }) => {
    await pinTable('dds-display:customers')(page);
    await installApp(page, { api: { '/studio/customers': CUSTOMERS } });
    await page.goto('/customers.html');
    await page.locator('#viewBtn').click();
    await page.locator('#viewMenu [data-view="attention"]').click();
    await expect(page.locator('#viewBtn')).toContainText('Needs attention');
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody tr').first()).toContainText('Acme Bakery');
    await expect(page.locator('.lmeta')).toContainText('1 customer');
    // Complete / Archived view
    await page.locator('#viewBtn').click();
    await page.locator('#viewMenu [data-view="done"]').click();
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody tr').first()).toContainText('Beta Salon');
  });

  test('the Table ⇄ Cards toggle persists in localStorage across reloads', async ({ page }) => {
    await pinTable('dds-display:customers')(page);
    await installApp(page, { api: { '/studio/customers': CUSTOMERS } });
    await page.goto('/customers.html');
    await expect(page.locator('tbody tr')).toHaveCount(3);
    await page.locator('#dispCards').click();
    await expect(page.locator('.cust')).toHaveCount(3);        // cards = today's look, kept
    await expect(page.locator('tbody tr')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('dds-display:customers'))).toBe('cards');
    await page.goto('/customers.html');                        // reload — the choice sticks
    await expect(page.locator('.cust')).toHaveCount(3);
    // toggle buttons carry state as aria-pressed (aria-selected is invalid on a
    // plain button in role="group" — screen readers would announce no state)
    await expect(page.locator('#dispCards')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#dispTable')).toHaveAttribute('aria-pressed', 'false');
  });

  test('the view dropdown closes on outside click and on Escape (aria-expanded synced)', async ({ page }) => {
    await pinTable('dds-display:customers')(page);
    await installApp(page, { api: { '/studio/customers': CUSTOMERS } });
    await page.goto('/customers.html');
    await page.locator('#viewBtn').click();
    await expect(page.locator('#viewMenu')).toBeVisible();
    await expect(page.locator('#viewBtn')).toHaveAttribute('aria-expanded', 'true');
    // outside click → the ONE document-level delegated closer (ported from
    // inbox.html). Click the object icon: it sits LEFT of the dropdown, so the
    // open menu never covers it (at phone widths the menu overlaps .lmeta).
    await page.locator('.obj-ic').click();
    await expect(page.locator('#viewMenu')).toBeHidden();
    await expect(page.locator('#viewBtn')).toHaveAttribute('aria-expanded', 'false');
    // Escape closes and hands focus back to the trigger
    await page.locator('#viewBtn').click();
    await expect(page.locator('#viewMenu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#viewMenu')).toBeHidden();
    await expect(page.locator('#viewBtn')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#viewBtn')).toBeFocused();
  });

  test('the On hold view shows paused customers (they never vanish from every named view)', async ({ page }) => {
    const withHold = { data: [...CUSTOMERS.data,
      { client_id: 'c-hold', name: 'Held Co', email: 'h@held.com', project_id: 'p4', project_name: 'Site', status: 'on_hold', customer_site_id: null, open_support: 0, project_count: 1 },
    ] };
    await pinTable('dds-display:customers')(page);
    await installApp(page, { api: { '/studio/customers': withHold } });
    await page.goto('/customers.html');
    await expect(page.locator('tbody tr')).toHaveCount(4);
    await page.locator('#viewBtn').click();
    await page.locator('#viewMenu [data-view="on_hold"]').click();
    await expect(page.locator('#viewBtn')).toContainText('On hold');
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody tr').first()).toContainText('Held Co');
    await expect(page.locator('tbody .pill.on_hold')).toContainText('on hold');
  });

  test('table rows open the client record; row action stays separate', async ({ page }) => {
    await pinTable('dds-display:customers')(page);
    await installApp(page, { api: { '/studio/customers': CUSTOMERS } });
    await page.goto('/customers.html');
    // "Manage their website" is a row action (only with a customer site)
    await expect(page.locator('tbody [data-web]')).toHaveCount(2);
    await page.locator('tbody tr').first().locator('td').first().click();
    await expect(page).toHaveURL(/crm\.html\?client=site-acme&tab=delivery/);
  });
});

test.describe('Contacts list view', () => {
  test('renders the table with the fields the route returns; rows open the record', async ({ page }) => {
    await pinTable('dds-display:contacts')(page);
    await installApp(page, { api: { '/sales/contacts': CONTACTS } });
    await page.goto('/contacts.html');
    await expect(page.locator('#viewBtn')).toContainText('All contacts');
    await expect(page.locator('.lmeta')).toContainText('2 contacts');
    // columns: Name · Company · Email · Phone · Updated (sortable, aria-sort)
    await expect(page.locator('th[aria-sort="ascending"]')).toContainText('Name');
    await expect(page.locator('tbody tr').first()).toContainText('Dana Lee');
    await page.locator('[data-sort="name"]').click();
    await expect(page.locator('tbody tr').first()).toContainText('Sam Rivera');
    // the toolbar survives: + Add a customer · + Contact · Import CSV
    await expect(page.locator('#addCust')).toBeVisible();
    await expect(page.locator('#new')).toBeVisible();
    await expect(page.locator('#importCsv')).toBeVisible();
    // a row opens the unified record's Details tab (click the name cell — the
    // row's center can land on the mailto link at narrow widths, which the
    // row-open handler deliberately ignores)
    await page.locator('tbody tr').first().locator('td').first().click();
    await expect(page).toHaveURL(/crm\.html\?contact=ct-1&tab=details/);
  });

  test('the Recently updated view filters by updated_at; cards keep the old look', async ({ page }) => {
    await pinTable('dds-display:contacts')(page);
    await installApp(page, { api: { '/sales/contacts': CONTACTS } });
    await page.goto('/contacts.html');
    await page.locator('#viewBtn').click();
    await page.locator('#viewMenu [data-view="recent"]').click();
    await expect(page.locator('tbody tr')).toHaveCount(1);     // Dana's Jan update is > 30 days old
    await expect(page.locator('tbody tr').first()).toContainText('Sam Rivera');
    // Table ⇄ Cards toggle persists here too
    await page.locator('#dispCards').click();
    await expect(page.locator('.c[data-open]')).toHaveCount(1);
    expect(await page.evaluate(() => localStorage.getItem('dds-display:contacts'))).toBe('cards');
  });

  test('a timestamp column sorts newest-first on the first click; the dropdown closes on outside click', async ({ page }) => {
    await pinTable('dds-display:contacts')(page);
    await installApp(page, { api: { '/sales/contacts': CONTACTS } });
    await page.goto('/contacts.html');
    // pinned contract: the FIRST click on a timestamp column reads newest-first
    // (descending) — text columns keep starting ascending.
    await page.locator('[data-sort="updated_at"]').click();
    await expect(page.locator('th[aria-sort="descending"]')).toContainText('Updated');
    await expect(page.locator('tbody tr').first()).toContainText('Sam Rivera');   // 2 days ago outranks 90
    await expect(page.locator('.lmeta')).toContainText('Sorted by Updated — descending');
    // the second click flips to oldest-first
    await page.locator('[data-sort="updated_at"]').click();
    await expect(page.locator('th[aria-sort="ascending"]')).toContainText('Updated');
    await expect(page.locator('tbody tr').first()).toContainText('Dana Lee');
    // the same delegated closer guards this page's dropdown too (click the
    // object icon — left of the dropdown, never covered by the open menu)
    await page.locator('#viewBtn').click();
    await expect(page.locator('#viewMenu')).toBeVisible();
    await page.locator('.obj-ic').click();
    await expect(page.locator('#viewMenu')).toBeHidden();
    await expect(page.locator('#viewBtn')).toHaveAttribute('aria-expanded', 'false');
  });
});

// ── SS6 (C4/C5/D7): customers gets Add-a-customer + unscoped read + search ───
test.describe('Customers — SS6 quick wins', () => {
  test('C4 — "+ Add a customer" (contacts’ dialog, ported): provision POSTs /sales/customers and shows the invite outcome', async ({ page }) => {
    await pinTable('dds-display:customers')(page);
    await installApp(page, { api: {
      '/studio/customers': CUSTOMERS,
      '/sales/customers': { data: { created: true, invited: true, portal_url: 'https://x.example/portal.html' } },
    } });
    await page.goto('/customers.html');
    await page.locator('#addCust').click();
    await expect(page.locator('#custDlg')).toBeVisible();
    await page.locator('#cu-name').fill('Jane Doe');
    await page.locator('#cu-biz').fill('Acme Bakery');
    await page.locator('#cu-email').fill('jane@acmebakery.com');
    const post = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/sales/customers'));
    await page.locator('#cu-submit').click();
    // exactly what handleSalesAddCustomer reads: mode/name/business_name/email/edition
    expect((await post).postDataJSON()).toEqual({ mode: 'provision', name: 'Jane Doe', business_name: 'Acme Bakery', email: 'jane@acmebakery.com', edition: 'presence' });
    await expect(page.locator('#cust-done')).toContainText('Invitation sent');
    await expect(page.locator('#cust-done')).toContainText('jane@acmebakery.com');
  });

  test('C4 — the connect-by-email mode saves without provisioning', async ({ page }) => {
    await pinTable('dds-display:customers')(page);
    await installApp(page, { api: {
      '/studio/customers': CUSTOMERS,
      '/sales/customers': { data: { mode: 'connect', pending: true, connected: false } },
    } });
    await page.goto('/customers.html');
    await page.locator('#addCust').click();
    await page.locator('input[name="cumode"][value="connect"]').check();
    // provision-only fields hide; the submit relabels honestly
    await expect(page.locator('#cu-provision-only')).toBeHidden();
    await expect(page.locator('#cu-submit')).toHaveText('Save');
    await page.locator('#cu-email').fill('jane@acmebakery.com');
    const post = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/sales/customers'));
    await page.locator('#cu-submit').click();
    expect((await post).postDataJSON()).toEqual({ mode: 'connect', email: 'jane@acmebakery.com' });
    await expect(page.locator('#cust-done')).toContainText('Saved');
  });

  test('D7 — a stray ?client= cannot blank the roster: /studio/customers is asked UNSCOPED', async ({ page }) => {
    await pinTable('dds-display:customers')(page);
    await installApp(page, { api: { '/studio/customers': CUSTOMERS } });
    let scopeHeader: string | undefined = 'unset';
    page.on('request', (r) => { if (r.url().includes('/studio/customers')) scopeHeader = r.headers()['x-dds-scope-site']; });
    await page.goto('/customers.html?client=site-acme');
    await expect(page.locator('tbody tr')).toHaveCount(3);
    // the roster is keyed on the AGENCY site — a drilled leaf scope would
    // resolve it to an empty list, so the read must not carry the header
    expect(scopeHeader === undefined || scopeHeader === '').toBe(true);
  });

  test('C5 — debounced search re-renders only the list: the input node survives typing', async ({ page }) => {
    await pinTable('dds-display:customers')(page);
    await installApp(page, { api: { '/studio/customers': CUSTOMERS } });
    await page.goto('/customers.html');
    await expect(page.locator('tbody tr')).toHaveCount(3);
    const q = page.locator('#search');
    await q.evaluate((el) => { (el as HTMLElement).dataset.marker = 'kept'; });
    await q.pressSequentially('acme');
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody tr').first()).toContainText('Acme Bakery');
    expect(await q.evaluate((el) => (el as HTMLElement).dataset.marker)).toBe('kept');
    await expect(q).toBeFocused();
    await expect(page.locator('.lmeta')).toContainText('1 customer');
  });

  test('REQ_SEQ — a slow superseded /studio/customers load never paints over the newest one', async ({ page }) => {
    await pinTable('dds-display:customers')(page);
    await installApp(page, { api: { '/studio/customers': CUSTOMERS } });
    const row = (id: string, name: string) => ({ client_id: id, name, email: 'x@example.com', project_id: 'p1', project_name: 'Site', status: 'active', customer_site_id: null, open_support: 0, project_count: 1 });
    let call = 0;
    await page.route(/\/functions\/v1\/presence\/studio\/customers(\?|$)/, (route) => {
      call++;
      const fulfill = (rows: unknown[]) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: rows }) });
      if (call === 2) { setTimeout(() => { fulfill([row('c2', 'Stale Customer')]).catch(() => {}); }, 700); return; }
      return fulfill(call === 1 ? [row('c1', 'Boot Customer')] : [row('c3', 'Fresh Customer')]);
    });
    await page.goto('/customers.html');
    await expect(page.locator('tbody tr')).toContainText(['Boot Customer']);
    await page.locator('#refreshBtn').click();
    await page.locator('#refreshBtn').click();
    await expect(page.locator('tbody tr')).toContainText(['Fresh Customer']);
    await page.waitForTimeout(900);
    await expect(page.locator('tbody tr')).toContainText(['Fresh Customer']);
    await expect(page.locator('#main')).not.toContainText('Stale Customer');
  });

  test('boots quiet: one h1, the toolbar, zero console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await pinTable('dds-display:customers')(page);
    await installApp(page, { api: { '/studio/customers': CUSTOMERS } });
    await page.goto('/customers.html');
    await expect(page.locator('tbody tr')).toHaveCount(3);
    await expect(page.locator('#addCust')).toBeVisible();
    await expect(page.locator('h1')).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('a failed boot offers Try again and recovers in place', async ({ page }) => {
    await pinTable('dds-display:customers')(page);
    await installApp(page, { api: { '/studio/customers': CUSTOMERS } });
    let call = 0;
    await page.route(/\/functions\/v1\/presence\/studio\/customers(\?|$)/, (route) => {
      call++;
      if (call === 1) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CUSTOMERS) });
    });
    await page.goto('/customers.html');
    // honest trouble state with a real retry control (the shipped standard)
    await expect(page.locator('#main')).toContainText('We couldn’t load your customers just now.');
    await page.locator('#retry').click();
    await expect(page.locator('tbody tr')).toHaveCount(3);
  });
});

// ── SS6 (C5): shared debounce + list-only re-render + REQ_SEQ on contacts ────
test.describe('Contacts — SS6 quick wins', () => {
  test('C5 — search re-renders only the list: the input node survives typing', async ({ page }) => {
    await pinTable('dds-display:contacts')(page);
    await installApp(page, { api: { '/sales/contacts': CONTACTS } });
    await page.goto('/contacts.html');
    await expect(page.locator('tbody tr')).toHaveCount(2);
    const q = page.locator('#q');
    await q.evaluate((el) => { (el as HTMLElement).dataset.marker = 'kept'; });
    await q.pressSequentially('sam');
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody tr').first()).toContainText('Sam Rivera');
    // the C5 contract: keystrokes re-render the LIST, never the input itself
    expect(await q.evaluate((el) => (el as HTMLElement).dataset.marker)).toBe('kept');
    await expect(q).toBeFocused();
    // the meta count follows the filter
    await expect(page.locator('.lmeta')).toContainText('1 contact');
    await q.fill('');
    await expect(page.locator('tbody tr')).toHaveCount(2);
  });

  test('REQ_SEQ — a slow superseded /sales/contacts load never paints over the newest one', async ({ page }) => {
    await pinTable('dds-display:contacts')(page);
    await installApp(page, { api: { '/sales/contacts': CONTACTS } });
    const row = (id: string, name: string) => ({ id, name, email: 'x@example.com', phone: '', company: 'Acme', updated_at: new Date().toISOString() });
    let call = 0;
    await page.route(/\/functions\/v1\/presence\/sales\/contacts(\?|$)/, (route) => {
      call++;
      const fulfill = (rows: unknown[]) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: rows }) });
      // call 2 delays WITHOUT blocking the handler — the race is real
      if (call === 2) { setTimeout(() => { fulfill([row('c2', 'Stale Contact')]).catch(() => {}); }, 700); return; }
      return fulfill(call === 1 ? [row('c1', 'Boot Contact')] : [row('c3', 'Fresh Contact')]);
    });
    await page.goto('/contacts.html');
    await expect(page.locator('tbody tr')).toContainText(['Boot Contact']);
    await page.locator('#refreshBtn').click();
    await page.locator('#refreshBtn').click();
    await expect(page.locator('tbody tr')).toContainText(['Fresh Contact']);
    await page.waitForTimeout(900);   // the stale response lands — and must be ignored
    await expect(page.locator('tbody tr')).toContainText(['Fresh Contact']);
    await expect(page.locator('#main')).not.toContainText('Stale Contact');
  });

  test('boots quiet: one h1, zero console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await pinTable('dds-display:contacts')(page);
    await installApp(page, { api: { '/sales/contacts': CONTACTS } });
    await page.goto('/contacts.html');
    await expect(page.locator('tbody tr')).toHaveCount(2);
    await expect(page.locator('h1')).toHaveCount(1);
    expect(errors).toEqual([]);
  });
});

// ── Batch A (post-redesign audit) — A1: the custom-fields manager is reachable ─
test.describe('Contacts — Manage fields (A1)', () => {
  test('the toolbar affordance opens the fields editor seeded from /sales/contacts/fields', async ({ page }) => {
    await installApp(page, { api: {
      '/sales/contacts': CONTACTS,
      '/sales/contacts/fields': { data: [{ key: 'referred_by', label: 'Referred by', type: 'text' }] },
    } });
    await page.goto('/contacts.html');
    await page.locator('#manageFields').click();
    await expect(page.locator('#fieldsDlg')).toBeVisible();
    await expect(page.locator('#fieldsRows .field-row .fr-label')).toHaveValue('Referred by');
    // saving PUTs the definitions to /sales/contacts/fields
    const put = page.waitForRequest((r) => r.method() === 'PUT' && r.url().includes('/sales/contacts/fields'));
    await page.getByRole('button', { name: 'Save fields' }).click();
    expect((await put).postDataJSON()).toEqual({ fields: [{ label: 'Referred by', type: 'text' }] });
    // the page toasts through the shell's ddsToast when present
    await expect(page.locator('.dds-toast, #toast').filter({ hasText: 'Fields saved.' }).first()).toBeVisible();
    await expect(page.locator('#fieldsDlg')).toBeHidden();
  });
});

// ── SS6 regression pin: dialogs must SUBMIT on phones ────────────────────────
// The f6176a4 centering (`margin:auto` on the top-layer dialog) broke phone
// submission two ways: mobile browsers widen the layout viewport to court the
// wide roster table (even scroll-contained), and they resolve the dialog's
// containing block against the DOCUMENT box — together the Save button landed
// beyond the visible viewport and taps could never reach it. The customers C4
// tests above pin that page; this pins contacts' own copy of the dialog with
// the roster table behind it, so the regression can't sneak back per-page.
test.describe('Contacts — the Add-a-customer dialog on phones (SS6 pin)', () => {
  test('provision submits over the pinned roster table: POST /sales/customers lands and the done panel renders', async ({ page }) => {
    await pinTable('dds-display:contacts')(page);
    await installApp(page, { api: {
      '/sales/contacts': CONTACTS,
      '/sales/customers': { data: { created: true, invited: true, portal_url: 'https://x.example/portal.html' } },
    } });
    await page.goto('/contacts.html');
    await page.locator('#addCust').click();
    await expect(page.locator('#custDlg')).toBeVisible();
    // the open dialog must fit the DEVICE viewport — the broken geometry sized
    // it against the widened layout viewport, pushing Save out of reach
    const vp = page.viewportSize()!;
    const box = (await page.locator('#custDlg').boundingBox())!;
    expect(box.x, 'dialog left edge on-screen').toBeGreaterThanOrEqual(0);
    expect(box.y, 'dialog top edge on-screen').toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, 'dialog right edge within the device viewport').toBeLessThanOrEqual(vp.width + 1);
    expect(box.y + box.height, 'dialog bottom edge within the device viewport').toBeLessThanOrEqual(vp.height + 1);
    await page.locator('#cu-name').fill('Jane Doe');
    await page.locator('#cu-biz').fill('Acme Bakery');
    await page.locator('#cu-email').fill('jane@acmebakery.com');
    const post = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/sales/customers'));
    await page.locator('#cu-submit').click();
    expect((await post).postDataJSON()).toEqual({ mode: 'provision', name: 'Jane Doe', business_name: 'Acme Bakery', email: 'jane@acmebakery.com', edition: 'presence' });
    await expect(page.locator('#cust-done')).toContainText('jane@acmebakery.com');
    await expect(page.locator('#custDlg')).toBeVisible();   // the done panel replaces the form in-dialog
  });
});
