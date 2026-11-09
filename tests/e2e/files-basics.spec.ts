import { test, expect, Page, Route } from '@playwright/test';
import { createHash } from 'crypto';
import { installApp } from './helpers/app';

// Items 56 + 115 (Nov 2026): Files basics — the owner's own folders, a storage
// meter, where a file is used (every section and page, not four columns), its
// alt text, and a photo already in Files flagged when it is uploaded again.
// Its own spec file so open pull requests that add to files.spec.ts don't collide.
const NOW = new Date().toISOString();
const id = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const file = (n: number, extra: Record<string, unknown> = {}) => ({
  id: id(n), name: `Photo ${n}`, kind: 'image', mime: 'image/jpeg', in_use: false, favorite: false, alt_text: `A clear description ${n}`,
  tags: [], collection: '', metadata: { title: `Photo ${n}` }, asset_status: 'approved', state: 'approved', bytes: 120000 + n, width: 800, height: 600, created_at: NOW, ...extra,
});
const STOREFRONT = file(1, { name: 'Storefront', metadata: { title: 'Storefront' }, alt_text: 'The shop front at dusk', collection: 'Outside', in_use: true, state: 'live' });
const PATIO = file(2, { name: 'Patio', metadata: { title: 'Patio' }, alt_text: 'Patio', collection: 'Outside' });
const SIGNED = file(3, { name: 'Signed plan', metadata: { title: 'Signed plan' }, alt_text: 'IMG_4032' });
const STORAGE = { used_bytes: 125 * 1048576, files: 42, max_bytes: 1073741824, max_files: 100, level: 'ok' };
const api = (extra: Record<string, unknown> = {}) => ({
  '/assets/collections': { data: [{ name: 'Outside', count: 2 }, { name: 'Templates', count: 1 }, { name: 'stock', count: 3 }] },
  '/assets/health': { data: { findings: [] } },
  '/assets': { data: { assets: [STOREFRONT, PATIO, SIGNED], total: 3, shown: 3, live_count: 1, policy: 'immediate', storage: STORAGE } },
  ...extra,
});
const ok = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const pinTable = (page: Page) =>
  page.addInitScript(() => { try { localStorage.setItem('dds-display:files', 'table'); } catch { /* denied */ } });
const LIST_RE = /\/functions\/v1\/presence\/assets(\?|$)/;
const pathOf = (route: Route) => new URL(route.request().url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');

test.describe('Files basics — the storage meter', () => {
  test('the header says how much space is used, of both limits', async ({ page }) => {
    await installApp(page, { api: api() });
    await page.goto('/files.html');
    const meter = page.locator('#storage');
    await expect(meter).toContainText('125 MB of 1 GB used · 42 of 100 files');
    // the bar follows the nearer limit: 42 of 100 files is further along than 125 MB of 1 GB
    await expect(meter.locator('[role="meter"]')).toHaveAttribute('aria-valuenow', '42');
    await expect(meter).not.toContainText('Nearly full');
  });

  test('nearly full says what frees space — deleting, not archiving', async ({ page }) => {
    await installApp(page, { api: api({ '/assets': { data: { assets: [STOREFRONT], total: 1, shown: 1, policy: 'immediate', storage: { ...STORAGE, files: 93, level: 'low' } } } }) });
    await page.goto('/files.html');
    await expect(page.locator('#storage')).toHaveClass(/low/);
    await expect(page.locator('#storage')).toContainText('deleting files you no longer need frees space; archiving doesn’t');
  });

  test('a server from before the meter shows no meter, never a guess', async ({ page }) => {
    await installApp(page, { api: api({ '/assets': { data: { assets: [STOREFRONT], total: 1, shown: 1, policy: 'immediate' } } }) });
    await page.goto('/files.html');
    await expect(page.locator('#root')).toContainText('Storefront');
    await expect(page.locator('#storage')).toHaveCount(0);
  });
});

test.describe('Files basics — folders', () => {
  test('the side list shows the owner’s folders with counts; Templates keeps its own row', async ({ page }) => {
    await installApp(page, { api: api() });
    await page.goto('/files.html');
    const folders = page.locator('#rail [role="group"][aria-label="Folders"]');
    await expect(folders.locator('[data-folder="Outside"] .n')).toHaveText('2');
    await expect(folders.locator('[data-folder="stock"]')).toContainText('Stock photos');   // the stock door's own folder, in words
    await expect(folders.locator('[data-folder="Templates"]')).toHaveCount(0);
    await expect(page.locator('[data-col="templates"] .n')).toHaveText('1');
  });

  test('opening a folder reads only its files, and names the folder', async ({ page }) => {
    await pinTable(page);
    await installApp(page, { api: api() });
    const reads: string[] = [];
    await page.route(LIST_RE, (route) => { reads.push(new URL(route.request().url()).searchParams.get('collection') || ''); return route.fallback(); });
    await page.goto('/files.html');
    await page.locator('[data-folder="Outside"]').click();
    await expect(page.locator('[data-folder="Outside"]')).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('[data-col="all"]')).not.toHaveAttribute('aria-current', 'true');
    await expect(page.locator('.fbar')).toContainText('Folder Outside');
    expect(reads).toContain('Outside');
    await expect(page.locator('#q')).toHaveAttribute('placeholder', 'Search this folder');
    // back to All files clears the folder
    await page.locator('[data-col="all"]').click();
    await expect(page.locator('.fbar')).toHaveCount(0);
  });

  test('a new folder opens empty, then files added there land in it', async ({ page }) => {
    await installApp(page, { api: api() });
    const MID = '11111111-1111-4111-8111-111111111111';
    const patched: unknown[] = [];
    await page.route(LIST_RE, (route) => {
      const c = new URL(route.request().url()).searchParams.get('collection');
      return route.fulfill(ok({ data: { assets: c ? [] : [STOREFRONT, PATIO], total: 2, shown: c ? 0 : 2, policy: 'immediate', storage: STORAGE } }));
    });
    await page.route(/\/functions\/v1\/presence\/media\/upload-url/, (route) =>
      route.fulfill(ok({ data: { media_id: MID, upload_url: 'http://127.0.0.1:4173/__e2e_put__', storage_path: 'presence-media/x.png' } })));
    await page.route(/__e2e_put__/, (route) => route.fulfill({ status: 200, body: '' }));
    await page.route(new RegExp('/functions/v1/presence/assets/' + MID + '$'), (route) => { patched.push(route.request().postDataJSON()); return route.fulfill(ok({ data: { ok: true } })); });
    await page.goto('/files.html');
    await expect(page.locator('#root')).toContainText('Storefront');
    await page.locator('#newFolder').click();
    await page.locator('dialog input').fill('  Menu   photos ');
    await page.locator('dialog').getByRole('button', { name: 'Create' }).click();
    await expect(page.locator('.fbar')).toContainText('Folder Menu photos');
    await expect(page.locator('#root .empty')).toContainText('This folder is empty.');
    await expect(page.locator('[data-folder="Menu photos"] .n')).toHaveText('0');
    await page.setInputFiles('#picker', [{ name: 'lunch-special.png', mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]) }]);
    await expect(page.locator('.dds-toast')).toContainText('Uploaded 1 file');
    expect(patched).toEqual([{ name: 'lunch-special', collection: 'Menu photos' }]);
  });

  test('Move to folder offers the folders you have — or out of folders', async ({ page }) => {
    await pinTable(page);
    await installApp(page, { api: api() });
    const sent: Array<Record<string, unknown>> = [];
    await page.route(/\/functions\/v1\/presence\/assets\/bulk/, (route) => { sent.push(route.request().postDataJSON()); return route.fulfill(ok({ data: { ok: true, applied: 1, missing: [] } })); });
    await page.goto('/files.html');
    await page.locator(`input[data-pick="${SIGNED.id}"]`).check();
    await page.locator('[data-bulk="collection"]').click();
    await expect(page.locator('dialog')).toContainText('Move to a folder');
    await expect(page.locator('dialog')).not.toContainText('Take out of folders');   // nothing selected is in one
    await page.locator('dialog .fopt', { hasText: 'Outside' }).click();
    await expect(page.locator('.dds-toast')).toContainText('Moved 1 file to “Outside”');
    expect(sent[0]).toEqual({ action: 'collection', ids: [SIGNED.id], collection: 'Outside' });

    await page.locator(`input[data-pick="${PATIO.id}"]`).check();
    await page.locator('[data-bulk="collection"]').click();
    await page.locator('dialog').getByRole('button', { name: 'Take out of folders' }).click();
    await expect(page.locator('.dds-toast', { hasText: 'Moved 1 file out of folders' })).toBeVisible();   // toasts stack: match by words
    expect(sent[1]).toEqual({ action: 'collection', ids: [PATIO.id], clear: true });
  });

  test('rename and remove a folder — the files stay', async ({ page }) => {
    await installApp(page, { api: api() });
    const moves: unknown[] = [];
    await page.route(/\/functions\/v1\/presence\/assets\/folders\/move/, (route) => { moves.push(route.request().postDataJSON()); return route.fulfill(ok({ data: { ok: true, moved: 2 } })); });
    await page.goto('/files.html');
    await page.locator('[data-folder="Outside"]').click();
    await page.locator('#fRename').click();
    await expect(page.locator('dialog input')).toHaveValue('Outside');
    await page.locator('dialog input').fill('Out front');
    await page.locator('dialog').getByRole('button', { name: 'Rename' }).click();
    await expect(page.locator('.dds-toast')).toContainText('Renamed to “Out front”');
    await expect(page.locator('.fbar')).toContainText('Folder Out front');
    await page.locator('#fRemove').click();
    await expect(page.locator('dialog')).toContainText('only the folder goes');
    await page.locator('dialog').getByRole('button', { name: 'Remove folder' }).click();
    await expect(page.locator('.dds-toast', { hasText: 'Folder removed — its files are in All files' })).toBeVisible();   // toasts stack
    await expect(page.locator('[data-col="all"]')).toHaveAttribute('aria-current', 'true');
    expect(moves).toEqual([{ from: 'Outside', to: 'Out front' }, { from: 'Out front', to: '' }]);
  });

  test('the details panel’s Folder field offers the folders by name', async ({ page }) => {
    await pinTable(page);
    await installApp(page, { api: api({ ['/assets/' + PATIO.id]: { data: { asset: PATIO, usage: [], usage_complete: true, versions: { has_history: false }, summary: { headline: 'Not used anywhere yet.' } } } }) });
    await page.goto('/files.html');
    await page.locator(`tr[data-open="${PATIO.id}"]`).click();
    await expect(page.locator('#panel label[for="f-col"]')).toHaveText('Folder');
    await expect(page.locator('#f-col')).toHaveValue('Outside');
    const options = await page.locator('#f-col-list option').evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
    expect(options).toEqual(expect.arrayContaining(['Outside', 'stock', 'Templates', 'Downloads']));
  });
});

test.describe('Files basics — where a file is used, and its alt text', () => {
  const detail = (asset: Record<string, unknown>, extra: Record<string, unknown>) =>
    ({ data: { asset, versions: { has_history: false }, usage_complete: true, summary: { headline: '' }, ...extra } });

  test('every place is listed, in two groups, each opening where it is edited', async ({ page }) => {
    await pinTable(page);
    const usage = [
      { surface: 'section', label: 'the Photo gallery section “Our work” on your Home page', live: true },
      { surface: 'section', label: 'the Before & after section on your “About us” page', live: true },
      { surface: 'page_share', label: 'the share image for your “About us” page', live: true },
      { surface: 'project', label: 'the project file “Signed plan”', live: false, site: false },
    ];
    await installApp(page, { api: api({ ['/assets/' + STOREFRONT.id]: detail({ ...STOREFRONT }, { usage, summary: { headline: 'Used in 4 places — 3 live on your site.' } }) }) });
    await page.goto('/files.html');
    await page.locator(`tr[data-open="${STOREFRONT.id}"]`).click();
    const where = page.locator('#whereUsed');
    await expect(where.locator('.sub').first()).toHaveText('On your website');
    await expect(where).toContainText('Live — The Photo gallery section “Our work” on your Home page');
    await expect(where).toContainText('The Before & after section on your “About us” page');
    await expect(where.locator('.sub').nth(1)).toHaveText('Elsewhere');
    await expect(where.getByRole('link', { name: /Photo gallery/ })).toHaveAttribute('href', '/presence.html#design');
    await expect(where.getByRole('link', { name: /share image/ })).toHaveAttribute('href', '/presence.html#search');
    await expect(where.getByRole('link', { name: /project file/ })).toHaveAttribute('href', '/projects.html');
    // a project file stays the version that was delivered: no Replace here
    await expect(where).toContainText('Delivered in a project');
    await expect(page.locator('#panel').getByRole('button', { name: 'Replace…' })).toHaveCount(0);
    // and Delete says which place holds it
    await page.locator('#panel').getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('.dds-toast')).toContainText('the Photo gallery section “Our work” on your Home page');
  });

  test('a read that could not check every place says so — never “not used”', async ({ page }) => {
    await pinTable(page);
    await installApp(page, { api: api({ ['/assets/' + PATIO.id]: detail(PATIO, { usage: [], usage_complete: false }) }) });
    await page.goto('/files.html');
    await page.locator(`tr[data-open="${PATIO.id}"]`).click();
    await expect(page.locator('#whereUsed')).toContainText('We couldn’t check every place just now');
    await expect(page.locator('#whereUsed')).not.toContainText('Not used on your site yet');
  });

  test('a description that is still the file name is flagged; a real one is not', async ({ page }) => {
    await pinTable(page);
    await installApp(page, { api: api({
      ['/assets/' + PATIO.id]: detail(PATIO, { usage: [] }),
      ['/assets/' + SIGNED.id]: detail(SIGNED, { usage: [] }),
      ['/assets/' + STOREFRONT.id]: detail(STOREFRONT, { usage: [] }),
    }) });
    await page.goto('/files.html');
    await page.locator(`tr[data-open="${PATIO.id}"]`).click();   // alt "Patio" = its file name
    await expect(page.locator('#f-alt-hint')).toContainText('This is still the file name');
    await expect(page.locator('#f-alt')).toHaveAttribute('aria-describedby', 'f-alt-hint');
    await page.keyboard.press('Escape');
    await page.locator(`tr[data-open="${SIGNED.id}"]`).click();   // a camera's "IMG_4032"
    await expect(page.locator('#f-alt-hint')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.locator(`tr[data-open="${STOREFRONT.id}"]`).click();
    await expect(page.locator('#f-alt')).toHaveValue('The shop front at dusk');
    await expect(page.locator('#f-alt-hint')).toHaveCount(0);
  });

  test('another copy of the same photo is named, and opens', async ({ page }) => {
    await pinTable(page);
    await installApp(page, { api: api({
      ['/assets/' + PATIO.id]: detail(PATIO, { usage: [], repeats: [{ id: STOREFRONT.id, name: 'Storefront', exact: true, archived: false }] }),
      ['/assets/' + STOREFRONT.id]: detail(STOREFRONT, { usage: [] }),
    }) });
    await page.goto('/files.html');
    await page.locator(`tr[data-open="${PATIO.id}"]`).click();
    await expect(page.locator('#repeatRow')).toContainText('The same file is also in Files as “Storefront”.');
    await page.locator('#repeatRow').getByRole('button', { name: 'Open it' }).click();
    await expect(page.locator('#f-name')).toHaveValue('Storefront');
  });
});

test.describe('Files basics — a photo already in Files, uploaded again', () => {
  const MID = '22222222-2222-4222-8222-222222222222';
  const wire = async (page: Page, match: (q: URLSearchParams) => unknown) => {
    const uploads: Array<Record<string, unknown>> = [];
    await page.route(/\/functions\/v1\/presence\/assets\/match/, (route) =>
      route.fulfill(ok({ data: { match: match(new URL(route.request().url()).searchParams) } })));
    await page.route(/\/functions\/v1\/presence\/media\/upload-url/, (route) => {
      uploads.push(route.request().postDataJSON());
      return route.fulfill(ok({ data: { media_id: MID, upload_url: 'http://127.0.0.1:4173/__e2e_put__', storage_path: 'presence-media/x.png' } }));
    });
    await page.route(/__e2e_put__/, (route) => route.fulfill({ status: 200, body: '' }));
    return uploads;
  };
  const AGAIN = { name: 'storefront.png', mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 7, 7]) };
  const FRESH = { name: 'new-sign.png', mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 9]) };
  const hit = { id: STOREFRONT.id, name: 'Storefront', exact: true, folder: 'Outside', archived: false };

  test('the page asks before storing it twice — Skip keeps one copy', async ({ page }) => {
    await installApp(page, { api: api() });
    const uploads = await wire(page, () => hit);
    await page.goto('/files.html');
    await expect(page.locator('#root')).toContainText('Storefront');
    await page.setInputFiles('#picker', [AGAIN]);
    const dlg = page.locator('#repeatDlg');
    await expect(dlg).toContainText('This is already in Files');
    await expect(dlg).toContainText('“storefront.png” is the same file as “Storefront” (in the folder “Outside”).');
    await dlg.getByRole('button', { name: 'Skip it' }).click();
    await expect(page.locator('.dds-toast')).toContainText('Nothing new — that file is already in Files');
    expect(uploads).toHaveLength(0);
  });

  test('the hash it sent is the file’s SHA-256, and Upload anyway keeps both', async ({ page }) => {
    await installApp(page, { api: api() });
    const asked: URLSearchParams[] = [];
    const uploads = await wire(page, (q) => { asked.push(q); return hit; });
    await page.goto('/files.html');
    await expect(page.locator('#root')).toContainText('Storefront');
    await page.setInputFiles('#picker', [AGAIN]);
    await page.locator('#repeatDlg').getByRole('button', { name: 'Upload anyway' }).click();
    await expect(page.locator('.dds-toast')).toContainText('Uploaded 1 file');
    const sha = createHash('sha256').update(AGAIN.buffer).digest('hex');
    expect(asked[0].get('hash')).toBe(sha);
    expect(asked[0].get('bytes')).toBe(String(AGAIN.buffer.length));
    expect(uploads).toHaveLength(1);
    expect(uploads[0].content_hash).toBe(sha);   // stored, so the next repeat is caught exactly
  });

  test('in a batch only the repeat is skipped, and the toast says so', async ({ page }) => {
    await installApp(page, { api: api() });
    const uploads = await wire(page, (q) => (q.get('bytes') === String(AGAIN.buffer.length) ? { ...hit, exact: false, folder: '' } : null));
    await page.goto('/files.html');
    await expect(page.locator('#root')).toContainText('Storefront');
    await page.setInputFiles('#picker', [AGAIN, FRESH]);
    const dlg = page.locator('#repeatDlg');
    await expect(dlg).toContainText('“storefront.png” looks the same as “Storefront”.');
    await expect(dlg).not.toContainText('new-sign.png');
    await page.keyboard.press('Escape');   // the safe answer: nothing stored twice
    await expect(page.locator('.dds-toast')).toContainText('Uploaded 1 file · skipped 1 already in Files');
    expect(uploads.map((u) => u.bytes)).toEqual([FRESH.buffer.length]);
  });

  test('“Open the one in Files” skips the upload and shows the file you have', async ({ page }) => {
    await pinTable(page);
    await installApp(page, { api: api({ ['/assets/' + STOREFRONT.id]: { data: { asset: STOREFRONT, usage: [], usage_complete: true, versions: { has_history: false }, summary: { headline: '' } } } }) });
    const uploads = await wire(page, () => hit);
    await page.goto('/files.html');
    await expect(page.locator('#root')).toContainText('Storefront');
    await page.setInputFiles('#picker', [AGAIN]);
    await page.locator('#repeatDlg').getByRole('button', { name: 'Open the one in Files' }).click();
    await expect(page.locator('#f-name')).toHaveValue('Storefront');
    expect(uploads).toHaveLength(0);
  });

  test('a server from before the check uploads as it always did', async ({ page }) => {
    await installApp(page, { api: api() });
    const uploads: unknown[] = [];
    await page.route(/\/functions\/v1\/presence\/assets\/match/, (route) => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not_found' }) }));
    await page.route(/\/functions\/v1\/presence\/media\/upload-url/, (route) => { uploads.push(1); return route.fulfill(ok({ data: { media_id: MID, upload_url: 'http://127.0.0.1:4173/__e2e_put__', storage_path: 'x' } })); });
    await page.route(/__e2e_put__/, (route) => route.fulfill({ status: 200, body: '' }));
    await page.goto('/files.html');
    await expect(page.locator('#root')).toContainText('Storefront');
    await page.setInputFiles('#picker', [AGAIN]);
    await expect(page.locator('.dds-toast')).toContainText('Uploaded 1 file');
    await expect(page.locator('#repeatDlg')).toHaveCount(0);
    expect(uploads).toHaveLength(1);
  });
});
