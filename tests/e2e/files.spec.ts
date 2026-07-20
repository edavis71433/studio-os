import { test, expect, Page } from '@playwright/test';
import { installApp } from './helpers/app';

// DAM-1 / Architecture v1.0 + SS1 (standards sweep) — the DAM presents as
// "Files" and wears the roster anatomy: shared .lhead with ↻ refresh, a
// persisted Table ⇄ Grid toggle (customers.html .tscroll table), server ?q=
// search behind a REQ_SEQ stale-response guard, and honest per-read states.
const NOW = new Date().toISOString();
const LOGO = { id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', name: 'Logo', kind: 'image', mime: 'image/png', in_use: true, favorite: false, alt_text: 'Company logo', tags: [], collection: 'Brand', brand: true, asset_status: 'approved', state: 'live', bytes: 40000, created_at: NOW };
const CONTRACT = { id: 'cccccccc-3333-4333-8333-cccccccccccc', name: 'Contract', kind: 'document', mime: 'application/pdf', in_use: false, favorite: false, alt_text: 'Contract', tags: [], collection: '', asset_status: 'approved', state: 'approved', bytes: 120000, created_at: '2026-06-01T00:00:00Z',
  // the REAL production shape: client_delivery.ts stamps the media row's metadata
  // (client_upload + the human note) and /assets' present() surfaces the explicit
  // top-level boolean (isClientUpload) — this mock certifies that true contract
  client_upload: true, metadata: { client_upload: true, note: 'Uploaded by the client.' } };

const filesApi = {
  '/assets/collections': { data: [{ name: 'Brand', count: 1 }] },
  '/assets/health': { data: { findings: [] } },
  '/assets': { data: { assets: [LOGO, CONTRACT], total: 3, shown: 2, live_count: 1, policy: 'immediate' } },
  // the detail read (longest-prefix beats '/assets') — the slide-over's shape
  ['/assets/' + LOGO.id]: { data: { asset: LOGO, usage: [], versions: { has_history: false }, summary: { headline: 'Used as your logo.' } } },
};

// The display default is viewport-driven (small → grid); pin the table BEFORE
// page scripts run so table tests behave the same across all three projects.
// (set only when absent — addInitScript reruns on every navigation, and the
// persistence test needs the user's own toggle choice to survive the reload)
const pinTable = (page: Page) =>
  page.addInitScript(() => { try { if (!localStorage.getItem('dds-display:files')) localStorage.setItem('dds-display:files', 'table'); } catch { /* denied */ } });

const LIST_RE = /\/functions\/v1\/presence\/assets(\?|$)/;   // the list read ONLY (not /collections, /health, /:id)
const ok = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

test.describe('Files (the DAM, customer-facing)', () => {
  test('mounts under the shell with the .lhead roster header — zero console errors on boot', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await installApp(page, { api: filesApi });
    await page.goto('/files.html');
    await expect(page.locator('#dds-shell .dds-nav')).toContainText('Files');
    await expect(page.getByRole('heading', { level: 1, name: 'Files' })).toBeVisible();
    await expect(page.locator('.lhead .lmeta')).toContainText('2 files · Updated just now');
    await expect(page.locator('#refreshBtn')).toBeVisible();
    await expect(page.locator('.rail')).toContainText('All files');
    await expect(page.locator('.rail')).toContainText('Documents');
    await expect(page.locator('#root')).toContainText('Logo');
    expect(errors).toEqual([]);
  });

  test('speaks Files language — no DAM/asset/media jargon on the page', async ({ page }) => {
    await installApp(page, { api: filesApi });
    await page.goto('/files.html');
    await expect(page.locator('#root')).toContainText('Logo');
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/\bDAM\b/);
    expect(body).not.toMatch(/asset library/i);
  });

  test('forwards the scope header (SC-1) on its data calls', async ({ page }) => {
    const CLIENT = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
    let sentScope = '';
    await installApp(page, { api: filesApi });
    await page.route(LIST_RE, (route) => {
      sentScope = route.request().headers()['x-dds-scope-site'] || '';
      return route.fulfill(ok(filesApi['/assets']));
    });
    await page.goto(`/files.html?client=${CLIENT}`);
    await expect(page.locator('#root')).toContainText('Logo');
    expect(sentScope).toBe(CLIENT);
  });

  test('rail: counts for the derivable collections + aria-current on the active one', async ({ page }) => {
    await installApp(page, { api: filesApi });
    await page.goto('/files.html');
    await expect(page.locator('[data-col="all"]')).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('[data-col="all"] .n')).toHaveText('2');
    await expect(page.locator('[data-col="photos"] .n')).toHaveText('1');
    await expect(page.locator('[data-col="documents"] .n')).toHaveText('1');
    await expect(page.locator('[data-col="archive"] .n')).toHaveText('1');   // total 3 − 2 listed
    await expect(page.locator('[data-col="stock"] .n')).toHaveCount(0);      // a browse surface — no count
    await page.locator('[data-col="documents"]').click();
    await expect(page.locator('[data-col="documents"]')).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('[data-col="all"]')).not.toHaveAttribute('aria-current', 'true');
  });

  test('table view renders name/kind/size/added/where-used/status columns', async ({ page }) => {
    await pinTable(page);
    await installApp(page, { api: filesApi });
    await page.goto('/files.html');
    const table = page.locator('.tscroll table');
    for (const th of ['Name', 'Kind', 'Size', 'Added', 'Where used', 'Status']) {
      await expect(table.locator('thead')).toContainText(th);
    }
    const logoRow = table.locator('tbody tr', { hasText: 'Logo' });
    await expect(logoRow).toContainText('Photo');
    await expect(logoRow).toContainText('39 KB');
    await expect(logoRow).toContainText('today');
    await expect(logoRow).toContainText('On your site');
    await expect(logoRow).toContainText('Live');
    const docRow = table.locator('tbody tr', { hasText: 'Contract' });
    await expect(docRow).toContainText('PDF');
    await expect(docRow).toContainText('117 KB');
    await expect(docRow).toContainText('Not used');
  });

  test('client-upload provenance: the "by client" chip renders from the server-stamped media marker (A10 sibling)', async ({ page }) => {
    await pinTable(page);
    await installApp(page, { api: filesApi });
    await page.goto('/files.html');
    const docRow = page.locator('tbody tr', { hasText: 'Contract' });
    await expect(docRow.locator('.fromclient')).toHaveText('by client');
    const logoRow = page.locator('tbody tr', { hasText: 'Logo' });
    await expect(logoRow.locator('.fromclient')).toHaveCount(0);   // studio uploads carry no chip
  });

  test('sorting: header clicks toggle order with aria-sort; the lmeta names the sort', async ({ page }) => {
    await pinTable(page);
    await installApp(page, { api: filesApi });
    await page.goto('/files.html');
    // default: Added, newest first (Logo is newer than Contract)
    await expect(page.locator('th[aria-sort="descending"]')).toContainText('Added');
    await expect(page.locator('tbody tr').first()).toContainText('Logo');
    await expect(page.locator('.lmeta')).toContainText('Sorted by Added — descending');
    await page.locator('.thb', { hasText: 'Name' }).click();
    await expect(page.locator('th[aria-sort="ascending"]')).toContainText('Name');
    await expect(page.locator('tbody tr').first()).toContainText('Contract');   // C before L
    await page.locator('.thb', { hasText: 'Name' }).click();
    await expect(page.locator('th[aria-sort="descending"]')).toContainText('Name');
    await expect(page.locator('tbody tr').first()).toContainText('Logo');
  });

  test('Size sorts NUMERICALLY — 700 B < 9 KB < 80 KB (the lexical-regression trap)', async ({ page }) => {
    await pinTable(page);
    // chosen so ANY lexical compare (raw bytes '9216'>'81920'>'700', or the
    // formatted '9 KB'>'80 KB'>'700 B') orders them wrongly — only numeric passes
    const TINY = { ...LOGO, id: 'ffffffff-6666-4666-8666-ffffffffffff', name: 'Tiny', bytes: 700 };
    const NINE = { ...LOGO, id: '99999999-7777-4777-8777-999999999999', name: 'Nine', bytes: 9 * 1024 };
    const EIGHTY = { ...LOGO, id: '88888888-8888-4888-8888-888888888888', name: 'Eighty', bytes: 80 * 1024 };
    await installApp(page, { api: { ...filesApi, '/assets': { data: { assets: [NINE, TINY, EIGHTY], total: 3, shown: 3, policy: 'immediate' } } } });
    await page.goto('/files.html');
    await page.locator('.thb', { hasText: 'Size' }).click();   // first click: largest first
    await expect(page.locator('th[aria-sort="descending"]')).toContainText('Size');
    await expect(page.locator('tbody tr .nm2')).toHaveText(['Eighty', 'Nine', 'Tiny']);
    await page.locator('.thb', { hasText: 'Size' }).click();   // toggle: smallest first
    await expect(page.locator('tbody tr .nm2')).toHaveText(['Tiny', 'Nine', 'Eighty']);
  });

  test('display toggle: persists to localStorage and restores on reload (aria-pressed)', async ({ page }) => {
    await pinTable(page);
    await installApp(page, { api: filesApi });
    await page.goto('/files.html');
    await expect(page.locator('.tscroll')).toBeVisible();
    await expect(page.locator('#dispTable')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#dispGrid').click();
    await expect(page.locator('.grid')).toBeVisible();
    await expect(page.locator('.tscroll')).toHaveCount(0);
    await expect(page.locator('#dispGrid')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => localStorage.getItem('dds-display:files'))).toBe('grid');
    await page.reload();
    await expect(page.locator('.grid')).toBeVisible();   // the choice survived the reload
    await expect(page.locator('#dispGrid')).toHaveAttribute('aria-pressed', 'true');
  });

  test('small screens default to Grid; large screens to Table', async ({ page }) => {
    await installApp(page, { api: filesApi });
    await page.goto('/files.html');
    const small = (page.viewportSize()?.width || 1280) < 760;
    await expect(page.locator(small ? '.grid' : '.tscroll')).toBeVisible();
  });

  test('search is a server ?q= read and a STALE slower response never paints (REQ_SEQ)', async ({ page }) => {
    await installApp(page, { api: filesApi });
    const stale = { data: { assets: [{ ...LOGO, id: 'dddddddd-4444-4444-8444-dddddddddddd', name: 'StaleResult' }], total: 1, shown: 1, policy: 'immediate' } };
    const fresh = { data: { assets: [{ ...LOGO, id: 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee', name: 'FreshResult' }], total: 1, shown: 1, policy: 'immediate' } };
    const qs: string[] = [];
    await page.route(LIST_RE, async (route) => {
      const q = new URL(route.request().url()).searchParams.get('q') || '';
      qs.push(q);
      if (q === 'slow') { await new Promise((r) => setTimeout(r, 1200)); return route.fulfill(ok(stale)); }
      if (q === 'slowly') return route.fulfill(ok(fresh));
      return route.fulfill(ok(filesApi['/assets']));
    });
    await page.goto('/files.html');
    await expect(page.locator('#root')).toContainText('Logo');
    await page.locator('#q').fill('slow');           // debounced load #1 — the server answers SLOWLY
    await page.waitForTimeout(450);                  // let request #1 depart
    await page.locator('#q').fill('slowly');         // load #2 — answers fast
    await expect(page.locator('#root')).toContainText('FreshResult');
    await page.waitForTimeout(1400);                 // request #1 resolves late — it must be DROPPED
    await expect(page.locator('#root')).toContainText('FreshResult');
    await expect(page.locator('#root')).not.toContainText('StaleResult');
    expect(qs).toContain('slow');                    // the search really went to the server as ?q=
    expect(qs).toContain('slowly');
  });

  test('stock: a SLOW stock response never paints over the roster after switching away (REQ_SEQ)', async ({ page }) => {
    await installApp(page, { api: filesApi });
    await page.route(/\/functions\/v1\/presence\/stock\/search/, async (route) => {
      await new Promise((r) => setTimeout(r, 1200));
      return route.fulfill(ok({ data: { images: [{ id: 's1', thumb: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', alt: 'A stock photo', credit: 'Someone' }], provider: 'Prov', license: { name: 'CC0' } } }));
    });
    await page.goto('/files.html');
    await expect(page.locator('#root')).toContainText('Logo');
    await page.locator('[data-col="stock"]').click();     // the stock read departs (slow)
    await page.locator('[data-col="all"]').click();       // the user changes their mind
    await expect(page.locator('#root')).toContainText('Logo');
    await page.waitForTimeout(1600);                      // the stock response lands late — it must be DROPPED
    await expect(page.locator('#root')).toContainText('Logo');
    await expect(page.locator('#root')).not.toContainText('Add to my files');
  });

  test('failed assets read: couldn’t-load + Try-again refetches in place — never an empty state', async ({ page }) => {
    await installApp(page, { api: filesApi });
    let listCalls = 0;
    await page.route(LIST_RE, (route) => {
      listCalls++;
      if (listCalls === 1) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) });
      return route.fulfill(ok(filesApi['/assets']));
    });
    await page.goto('/files.html');
    await expect(page.locator('#root')).toContainText('We couldn’t load your files just now.');
    await expect(page.locator('#root')).not.toContainText('Nothing here yet');   // failure ≠ empty
    await expect(page.locator('.rail')).toContainText('All files');              // the rail stays
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('#root')).toContainText('Logo');
    expect(listCalls).toBe(2);   // Try-again really refetched
  });

  test('trouble screen: a SUCCESSFUL collections read still shows real rail counts', async ({ page }) => {
    await installApp(page, { api: { ...filesApi, '/assets/collections': { data: [{ name: 'Brand', count: 1 }, { name: 'Templates', count: 4 }] } } });
    await page.route(LIST_RE, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) }));
    await page.goto('/files.html');
    await expect(page.locator('#root')).toContainText('We couldn’t load your files just now.');
    await expect(page.locator('[data-col="templates"] .n')).toHaveText('4');   // truth that WAS readable renders
    await expect(page.locator('[data-col="downloads"] .n')).toHaveText('0');   // a successful read saying "none" is honest
  });

  test('boot failure with collections ALSO down: the rail shows NO counts at all (no fake zeros)', async ({ page }) => {
    // Pins 68a952f's hardening — reverting the countsOk gate must redden this:
    // an unknown count on the trouble screen is a guess wearing a number's clothes.
    await installApp(page, { api: filesApi });
    await page.route(LIST_RE, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) }));
    await page.route(/\/functions\/v1\/presence\/assets\/collections/, (route) =>
      route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'down' }) }));
    await page.goto('/files.html');
    await expect(page.locator('#root')).toContainText('We couldn’t load your files just now.');
    await expect(page.locator('.rail')).toContainText('Templates');   // the rail itself stays
    await expect(page.locator('#rail .n')).toHaveCount(0);            // but not a single count — zero would be a lie
  });

  test('↻ refresh soft-fails: a failed refresh keeps the list (leads.html contract)', async ({ page }) => {
    await installApp(page, { api: filesApi });
    let listCalls = 0;
    await page.route(LIST_RE, (route) => {
      listCalls++;
      if (listCalls > 1) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'down' }) });
      return route.fulfill(ok(filesApi['/assets']));
    });
    await page.goto('/files.html');
    await expect(page.locator('#root')).toContainText('Logo');
    await page.locator('#refreshBtn').click();
    await page.waitForTimeout(300);   // give a wrong implementation time to wipe the page
    await expect(page.locator('#root')).toContainText('Logo');   // list kept
    await expect(page.locator('#root')).not.toContainText('We couldn’t load your files just now.');
    expect(listCalls).toBeGreaterThanOrEqual(2);
  });

  test('collections failure degrades count-less with a notice — assets still render', async ({ page }) => {
    await installApp(page, { api: filesApi });
    await page.route(/\/functions\/v1\/presence\/assets\/collections/, (route) =>
      route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'down' }) }));
    await page.goto('/files.html');
    await expect(page.locator('#root')).toContainText('Logo');   // the roster is not held hostage
    await expect(page.locator('.notice')).toContainText('Collection counts aren’t available just now');
    await expect(page.locator('[data-col="templates"] .n')).toHaveCount(0);   // no fake zeros
    await expect(page.locator('[data-col="downloads"] .n')).toHaveCount(0);
  });

  test('403 keeps its distinct not-in-plan message (no generic trouble)', async ({ page }) => {
    await installApp(page, { api: filesApi });
    await page.route(LIST_RE, (route) =>
      route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'Files aren’t included in your plan.' }) }));
    await page.goto('/files.html');
    await expect(page.locator('#root')).toContainText('Not part of your plan yet.');
    await expect(page.locator('#root')).not.toContainText('We couldn’t load your files just now.');
  });

  test('table rows open the slide-over on click and on Enter', async ({ page }) => {
    await pinTable(page);
    await installApp(page, { api: filesApi });
    await page.goto('/files.html');
    const row = page.locator('tbody tr', { hasText: 'Logo' });
    await row.click();
    await expect(page.locator('#panel')).toHaveClass(/on/);
    await expect(page.locator('#f-name')).toHaveValue('Logo');
    await page.keyboard.press('Escape');
    await expect(page.locator('#panel')).not.toHaveClass(/on/);
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#panel')).toHaveClass(/on/);
    await expect(page.locator('#f-name')).toHaveValue('Logo');
  });

  test('the checkbox column feeds the bulkbar (with bulk Download)', async ({ page }) => {
    await pinTable(page);
    await installApp(page, { api: filesApi });
    await page.goto('/files.html');
    await expect(page.locator('.bulkbar')).toHaveCount(0);   // quiet until something is selected
    await page.locator('input[data-pick]').first().check();
    await expect(page.locator('.bulkbar .cnt')).toHaveText('1 selected');
    await expect(page.locator('[data-bulk="download"]')).toBeEnabled();
    await expect(page.locator('[data-bulk="archive"]')).toBeEnabled();
    await page.locator('#ckAll').check();
    await expect(page.locator('.bulkbar .cnt')).toHaveText('2 selected');
    // selecting a row must NOT have opened the slide-over
    await expect(page.locator('#panel')).not.toHaveClass(/on/);
  });

  test('upload partial failure tells the truth — "Uploaded 1 · 1 failed", never a blanket "Uploaded"', async ({ page }) => {
    await installApp(page, { api: filesApi });
    let uploadCalls = 0;
    await page.route(/\/functions\/v1\/presence\/media\/upload-url/, (route) => {
      uploadCalls++;
      if (uploadCalls === 1) return route.fulfill(ok({ data: { media_id: '11111111-1111-4111-8111-111111111111', upload_url: 'http://127.0.0.1:4173/__e2e_put__', storage_path: 'presence-media/x.png' } }));
      return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: 'too_large', message: 'Images must be under 10MB.' }) });
    });
    await page.route(/__e2e_put__/, (route) => route.fulfill({ status: 200, body: '' }));   // the storage PUT for the good file
    await page.goto('/files.html');
    await expect(page.locator('#root')).toContainText('Logo');
    await page.setInputFiles('#picker', [
      { name: 'one.png', mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
      { name: 'two.png', mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
    ]);
    await expect(page.locator('.dds-toast')).toContainText('Uploaded 1 · 1 failed');
    expect(uploadCalls).toBe(2);
  });

  test('a read that removes a selected row PRUNES the selection — bulk never acts on hidden rows', async ({ page }) => {
    await pinTable(page);
    await installApp(page, { api: filesApi });
    await page.route(LIST_RE, (route) => {
      const q = new URL(route.request().url()).searchParams.get('q') || '';
      if (q) return route.fulfill(ok({ data: { assets: [CONTRACT], total: 3, shown: 1, policy: 'immediate' } }));
      return route.fulfill(ok(filesApi['/assets']));
    });
    await page.goto('/files.html');
    await page.locator(`input[data-pick="${LOGO.id}"]`).check();
    await expect(page.locator('.bulkbar .cnt')).toHaveText('1 selected');
    await page.locator('#q').fill('contract');               // the search removes the selected Logo row
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('.bulkbar')).toHaveCount(0);   // pruned to nothing → the bulkbar goes quiet
    await page.locator('#q').fill('');                       // back to the full roster
    await expect(page.locator('tbody tr')).toHaveCount(2);
    await page.locator('#ckAll').check();
    await expect(page.locator('.bulkbar .cnt')).toHaveText('2 selected');
    await page.locator('#q').fill('contract');
    await expect(page.locator('.bulkbar .cnt')).toHaveText('1 selected');   // the surviving row keeps its selection
  });

  test('search re-renders never destroy the input, its caret POSITION, or focus', async ({ page }) => {
    await installApp(page, { api: filesApi });
    await page.goto('/files.html');
    const q = page.locator('#q');
    await q.click();
    await q.pressSequentially('logo', { delay: 30 });
    await page.keyboard.press('ArrowLeft');   // park the caret INSIDE the value…
    await page.keyboard.press('ArrowLeft');   // …at index 2 (a collapsed selection)
    await page.waitForTimeout(600);   // debounce + reload + re-render behind it
    await expect(q).toBeFocused();    // the SAME control still holds focus…
    await expect(q).toHaveValue('logo');   // …the typed value survived the swap…
    // …and so did the caret POSITION — a naive focus()+value restore leaves the
    // caret at the end (index 4) and reddens this
    const caret = await q.evaluate((el) => ({ s: (el as HTMLInputElement).selectionStart, e: (el as HTMLInputElement).selectionEnd }));
    expect(caret).toEqual({ s: 2, e: 2 });
  });
});
