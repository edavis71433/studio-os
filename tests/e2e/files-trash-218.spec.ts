import { test, expect, Page, Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp } from './helpers/app';

// Builder list item 218 (Nov 12 review, file 01, finding 8), drawn in Figma ("Files Trash and
// Ask for access", section A) and approved: Delete moves a file to a Trash for 30 days. The
// Trash is a chip beside Archive with a dark band that says what happens; each file says how
// many days it has left, with Put back and Delete for good. A file the live site still shows
// waits (Delete for good explains instead), and the toast after a delete offers Put back.

const NOW = Date.now();
const iso = (days: number) => new Date(NOW + days * 86400000).toISOString();
const id = (n: number) => `cccccccc-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const base = { tags: [], asset_status: 'approved', state: 'approved', created_at: iso(-60), favorite: false, in_use: false, kind: 'image', mime: 'image/jpeg', bytes: 620000, width: 1600, height: 1100 };
const TEAM = { ...base, id: id(1), name: 'Team photo', alt_text: 'The team' };
const SHOP = { ...base, id: id(2), name: 'Shopfront at dusk', alt_text: 'The shopfront' };
const WAIT = { id: id(11), name: 'Waiting room', kind: 'image', bytes: 605000, folder: 'Spring promo', trashed_at: iso(0), goes_at: iso(30), days_left: 30, by: 'Eric', live: false, kept_live: false, thumb: null };
const SPRING = { id: id(12), name: 'Spring flowers', kind: 'image', bytes: 412000, folder: '', trashed_at: iso(-3), goes_at: iso(27), days_left: 27, by: 'Maya', live: true, kept_live: false, thumb: null };
const PRICE = { id: id(13), name: 'Price list', kind: 'document', bytes: 160000, folder: '', trashed_at: iso(-29), goes_at: iso(1), days_left: 1, by: 'Eric', live: false, kept_live: false, thumb: null };
const detail = (a: Record<string, unknown>, onLive = false) => ({ data: { asset: a, usage: [], usage_complete: true, on_live: onLive, versions: { has_history: false }, summary: { headline: '' } } });
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function openFiles(page: Page, opts: { trash?: unknown; trashCount?: number | null; forever?: { status: number; body: unknown } } = {}) {
  const writes: Array<{ method: string; path: string }> = [];
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => { try { localStorage.setItem('dds-display:files', 'grid'); } catch { /* */ } });
  await installApp(page, { api: {
    '/assets/collections': { data: [] },
    '/assets/health': { data: { findings: [] } },
    '/assets': { data: { assets: [TEAM, SHOP], total: 2, shown: 2, policy: 'immediate', trash: opts.trashCount === undefined ? 3 : opts.trashCount } },
    '/assets/trash': opts.trash ?? { data: { files: [WAIT, SPRING, PRICE], days: 30, available: true } },
    [`/assets/${TEAM.id}`]: detail(TEAM, true),
    [`/assets/${SHOP.id}`]: detail(SHOP),
  } });
  await page.route(/\/functions\/v1\/presence\/assets\/[0-9a-f-]{36}(\/(put-back|forever))?$/, async (route: Route) => {
    const method = route.request().method();
    const path = new URL(route.request().url()).pathname.replace(/^.*\/presence/, '');
    if (method === 'GET') return route.fallback();
    writes.push({ method, path });
    if (path.endsWith('/forever')) return route.fulfill(json(opts.forever?.body ?? { data: { ok: true } }, opts.forever?.status ?? 200));
    if (path.endsWith('/put-back')) return route.fulfill(json({ data: { ok: true, asset: { id: path.split('/')[2] } } }));
    return route.fulfill(json({ data: { ok: true, trashed: true, goes_at: iso(30), days: 30, on_live: true } }));   // DELETE /assets/:id
  });
  await page.goto('/files.html');
  await expect(page.locator(`.tile[data-open="${TEAM.id}"]`)).toBeVisible();
  return { writes, errors };
}
const openTrash = async (page: Page) => {
  await page.locator('#filters [data-col="trash"]').click();
  await expect(page.locator('.tband h2')).toHaveText('Trash');
};
const row = (page: Page, f: { id: string }) => page.locator(`.trow[data-trash="${f.id}"]`);

test.describe('Files: the Trash (item 218)', () => {
  test('the Trash chip sits beside Archive with its count, and opens the Trash: the band, each file\'s days, the live one kept', async ({ page }) => {
    const t = await openFiles(page);
    const chip = page.locator('#filters [data-col="trash"]');
    await expect(chip).toContainText('Trash');
    await expect(chip.locator('.n')).toHaveText('3');
    // beside Archive, before More filters
    const order = await page.locator('#filters .kinds > .fchip').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.col || e.id));
    expect(order.indexOf('trash')).toBe(order.indexOf('archive') + 1);
    await openTrash(page);
    await expect(chip).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('.tband p')).toContainText('3 files · 1.1 MB. Files you delete wait here for 30 days, then they’re deleted for good. They don’t count toward your space.');
    await expect(page.locator('.tband .tnext')).toHaveText('Next to goPrice list, tomorrow');
    await expect(page.locator('.tlist[role="list"] .trow')).toHaveCount(3);
    await expect(row(page, WAIT).locator('.ts')).toHaveText('Photo · 591 KB · Deleted today by Eric · was in Spring promo');
    await expect(row(page, WAIT).locator('.tdays')).toHaveText('30 days left');
    await expect(row(page, WAIT).locator('.tgo')).toHaveText(/^Goes for good [A-Z][a-z]{2} \d{1,2}$/);
    await expect(row(page, PRICE).locator('.tdays')).toHaveText('1 day left');
    await expect(row(page, PRICE).locator('.tdays')).toHaveClass(/\bsoon\b/);
    await expect(row(page, PRICE).locator('.tgo')).toHaveText('Goes for good tomorrow');
    await expect(row(page, SPRING).locator('.tlive')).toHaveText('Still on your live site');
    await expect(row(page, SPRING).locator('.tnote')).toContainText('Your live site shows it until you next publish');
    await expect(row(page, SPRING).locator('[data-forever]')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('.thow b')).toHaveText(['A published page keeps it until you publish', 'Not deleted for good while it’s live', 'A version that needs it brings it back']);
    // a search narrows the list, and the caret stays in the box
    await page.locator('#tq').fill('price');
    await expect(page.locator('.tlist .trow')).toHaveCount(1);
    await expect(page.locator('#tq')).toBeFocused();
    await page.locator('#tq').fill('');
    await expect(page.locator('.tlist .trow')).toHaveCount(3);
    // back to all files
    await page.locator('#filters [data-col="all"]').click();
    await expect(page.locator(`.tile[data-open="${SHOP.id}"]`)).toBeVisible();
    expect(t.writes).toEqual([]);
    expect(t.errors).toEqual([]);
  });

  test('Put back: the file goes home, it says so, and focus moves to the next file', async ({ page }) => {
    const t = await openFiles(page);
    await openTrash(page);
    await row(page, WAIT).getByRole('button', { name: 'Put back Waiting room' }).click();
    await expect(row(page, WAIT)).toHaveCount(0);
    expect(t.writes).toEqual([{ method: 'POST', path: `/assets/${WAIT.id}/put-back` }]);
    await expect(page.locator('#filters [data-col="trash"] .n')).toHaveText('2');
    await expect(row(page, SPRING).getByRole('button', { name: 'Put back Spring flowers' })).toBeFocused();
  });

  test('Delete for good asks in red, starting on Cancel; yes deletes, and the row goes', async ({ page }) => {
    const t = await openFiles(page);
    await openTrash(page);
    await row(page, PRICE).getByRole('button', { name: 'Delete Price list for good' }).click();
    const q = page.locator('dialog.tq.bad[open]');
    await expect(q.locator('h3')).toHaveText('Delete “Price list” for good?');
    await expect(q.locator('li')).toHaveText(['It can’t be put back.', 'An older version of your site that used it can’t bring it back.']);
    await expect(q.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog')).toHaveCount(0);
    expect(t.writes).toEqual([]);
    await row(page, PRICE).getByRole('button', { name: 'Delete Price list for good' }).click();
    await page.locator('dialog.tq.bad[open]').getByRole('button', { name: 'Delete for good' }).click();
    await expect(row(page, PRICE)).toHaveCount(0);
    expect(t.writes).toEqual([{ method: 'DELETE', path: `/assets/${PRICE.id}/forever` }]);
  });

  test('a file the live site still shows: Delete for good explains, sends nothing, and offers Publish', async ({ page }) => {
    const t = await openFiles(page);
    await openTrash(page);
    // aria-disabled, not disabled: it stays reachable, and pressing it explains (Playwright treats it as disabled for a click)
    const dfg = row(page, SPRING).getByRole('button', { name: 'Delete Spring flowers for good' });
    await dfg.focus();
    await page.keyboard.press('Enter');
    const q = page.locator('dialog.tq.live[open]');
    await expect(q.locator('h3')).toHaveText('“Spring flowers” is still on your live site');
    await expect(q.locator('li').first()).toHaveText('Publish your site first. Your draft doesn’t use it, so the next publish takes it off.');
    await q.getByRole('button', { name: 'Close' }).click();
    await expect(page.locator('dialog')).toHaveCount(0);
    expect(t.writes).toEqual([]);
  });

  test('the server says it is still live after all: the same explanation, and the row is marked', async ({ page }) => {
    const t = await openFiles(page, { forever: { status: 409, body: { error: 'still_live', message: 'still live' } } });
    await openTrash(page);
    await row(page, WAIT).getByRole('button', { name: 'Delete Waiting room for good' }).click();
    await page.locator('dialog.tq.bad[open]').getByRole('button', { name: 'Delete for good' }).click();
    await expect(page.locator('dialog.tq.live[open] h3')).toHaveText('“Waiting room” is still on your live site');
    await expect(row(page, WAIT).locator('.tlive')).toBeVisible();
    expect(t.writes).toEqual([{ method: 'DELETE', path: `/assets/${WAIT.id}/forever` }]);
  });

  test('Delete on a file: moves it to the Trash, says the live site keeps it, and the toast offers Put back', async ({ page }) => {
    const t = await openFiles(page);
    await page.locator(`.tile[data-open="${TEAM.id}"]`).click();
    await expect(page.locator('#panel .ptitle')).toHaveText('Team photo');
    await page.locator('#panel .acts').getByRole('button', { name: 'Delete' }).click();
    const q = page.locator('dialog.tq[open]');
    await expect(q.locator('h3')).toHaveText('Move “Team photo” to the Trash?');
    await expect(q.locator('li')).toHaveCount(3);
    await expect(q.locator('li').nth(1)).toHaveText(/^You can put it back until [A-Z][a-z]+ \d{1,2}, 30 days from now\.$/);
    await expect(q.locator('li.warn')).toHaveText('Your live site still shows it until you next publish.');
    await q.getByRole('button', { name: 'Move to the Trash' }).click();
    await expect(page.locator('#panel')).not.toHaveClass(/\bon\b/);
    const toast = page.locator('#utoast');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('“Team photo” is in the Trash.');
    await toast.getByRole('button', { name: 'Put back' }).click();
    await expect(toast).toBeHidden();
    expect(t.writes).toEqual([{ method: 'DELETE', path: `/assets/${TEAM.id}` }, { method: 'POST', path: `/assets/${TEAM.id}/put-back` }]);
  });

  test('an empty Trash says so', async ({ page }) => {
    await openFiles(page, { trash: { data: { files: [], days: 30, available: true } } });
    await openTrash(page);
    await expect(page.locator('.tempty')).toHaveText('The Trash is empty. Files you delete wait here for 30 days, so you can put them back.');
    await expect(page.locator('.thow')).toHaveCount(0);
  });

  test('a server without a Trash shows no chip', async ({ page }) => {
    await openFiles(page, { trashCount: null });
    await expect(page.locator('#filters [data-col="archive"]')).toBeVisible();
    await expect(page.locator('#filters [data-col="trash"]')).toHaveCount(0);
  });

  test('a phone: each file stacks, its two buttons are full width and easy to press, and nothing scrolls sideways', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'a phone-width layout');
    await openFiles(page);
    await openTrash(page);
    const pb = row(page, WAIT).getByRole('button', { name: 'Put back Waiting room' });
    const box = await pb.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    const [a, b] = await Promise.all([pb.boundingBox(), row(page, WAIT).locator('[data-forever]').boundingBox()]);
    expect(Math.abs(a!.y - b!.y)).toBeLessThan(4);   // side by side under the file
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    // the Trash chip stays in sight in the sideways row of kinds
    const [kinds, chip] = await Promise.all([page.locator('#filters .kinds').boundingBox(), page.locator('#filters [data-col="trash"]').boundingBox()]);
    expect(chip!.x + chip!.width).toBeLessThanOrEqual(kinds!.x + kinds!.width + 1);
  });

  test('a tablet: the rows and the band fit beside the sidebar, nothing scrolls sideways', async ({ page }, info) => {
    test.skip(info.project.name !== 'tablet', 'a tablet-width layout');
    await openFiles(page);
    await openTrash(page);
    await expect(page.locator('.tlist .trow')).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    const band = await page.locator('.tband').boundingBox();
    expect(band!.x).toBeGreaterThanOrEqual(0);
  });

  test('the Trash and its questions pass an accessibility check, light and dark', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chromium', 'one scan is enough');
    test.slow();   // three scans
    await openFiles(page);
    await openTrash(page);
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      const r = await new AxeBuilder({ page }).include('#root').withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${scheme}: ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    }
    await page.emulateMedia({ colorScheme: 'light' });
    await row(page, PRICE).getByRole('button', { name: 'Delete Price list for good' }).click();
    const r = await new AxeBuilder({ page }).include('dialog.tq').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
  });
});
