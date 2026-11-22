import { test, expect, Page, Route } from '@playwright/test';
import { installApp, settled } from './helpers/app';
import { API, BLOCKS, blocksIn, editHome, homeLine, mountCanvas, Mounted, SETTINGS, META } from './helpers/editor';

// ── Saving and lost work (builder list items 249, 250, 252, 254, 271 and 278, full review of
// Nov 22 2026) ──
// A save that fails is never the end of it: the status line becomes "Not saved · Try again",
// what failed is sent when the connection returns (item 250), a stalled save is failed after a
// limit instead of holding every save behind it (252), a sign-in that lapsed asks over the
// page instead of replacing it (271), Load the latest keeps the unsaved section on the
// clipboard (278), a restore that stopped part-way offers to put the draft back (254), and a
// publish that goes live over a waiting one asks whether to update or cancel it (249).
// Hermetic: the pretend server answers every save; a computer only (the page is the same on
// a tablet; typing on the canvas is the computer's path).

test.beforeEach(({ browserName }, testInfo) => { test.skip(!!testInfo.project.use.hasTouch, 'the computer’s path'); void browserName; });

const whisper = (page: Page) => page.locator('#dcWhisper');
const words = (puts: Mounted['puts']) => puts.map((p) => blocksIn(p)?.[0]?.subtitle);

test('250: a save that finds no connection is sent when it returns, and the toast is honest', async ({ page }) => {
  const { frame, puts } = await mountCanvas(page);
  await page.context().setOffline(true);
  await editHome(page, frame, 'Typed with no connection');
  await expect(page.locator('.dds-toast').last()).toContainText('This change isn’t saved yet. We’ll send it when you’re back online.');
  await expect(whisper(page)).toHaveText('Not saved · Try again');
  await expect(whisper(page)).toHaveAttribute('role', 'button');
  expect(puts.length).toBe(0);
  await page.context().setOffline(false);
  await expect.poll(() => words(puts), { timeout: 8000 }).toContain('Typed with no connection');
  await expect(whisper(page)).not.toHaveText(/Not saved/);
});

test('250: "Not saved · Try again" is a button that sends the failed save again', async ({ page }) => {
  let fail = true;
  const { frame, puts } = await mountCanvas(page, { beforeGoto: (p) => p.route('**/functions/v1/presence/settings**', (route: Route) => {
    if (route.request().method() === 'PUT' && fail) { fail = false; return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom', message: 'The database blinked.' }) }); }
    return route.fallback();
  }) });
  await editHome(page, frame, 'Once refused');
  await expect(whisper(page)).toHaveText('Not saved · Try again');
  expect(puts.length).toBe(0);   // the refused one never reached the echo
  await whisper(page).click();
  await expect.poll(() => words(puts), { timeout: 8000 }).toContain('Once refused');
  await expect(whisper(page)).not.toHaveText(/Not saved/);
});

test('250: a Business details save that failed stays in the close-tab check and goes on Try again', async ({ page }) => {
  let fail = true;
  const sent: Array<Record<string, unknown>> = [];
  await installApp(page, { api: { ...API, '/settings': { data: SETTINGS } } });
  await page.route('**/functions/v1/presence/identity**', (route: Route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    if (fail) { fail = false; return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom', message: 'The database blinked.' }) }); }
    sent.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: route.request().postDataJSON() }) });
  });
  await page.goto('/presence.html#business');
  await expect(page.locator('#f-tagline')).toBeVisible();
  await page.locator('#f-tagline').fill('Wine and pasta');
  await settled(page, { requests: false });
  await expect(page.locator('#topWhisper')).toHaveText('Not saved · Try again');
  // the close-tab warning asks: the failed save is still waiting
  expect(await page.evaluate(() => (0, eval)('detailsPending()'))).toBe(true);
  expect(await page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; })).toBe(true);
  await page.locator('#topWhisper').click();
  await expect.poll(() => sent.map((b) => b.tagline), { timeout: 8000 }).toContain('Wine and pasta');
  expect(await page.evaluate(() => (0, eval)('detailsPending()'))).toBe(false);
});

test('252: a save that stalls is failed after the limit, and the next save isn’t held behind it', async ({ page }) => {
  let stalled: Route | null = null;
  const { frame, puts } = await mountCanvas(page, { beforeGoto: async (p) => {
    await p.addInitScript(() => { (window as unknown as { DDS_SAVE_LIMIT_MS: number }).DDS_SAVE_LIMIT_MS = 1500; });
    await p.route('**/functions/v1/presence/settings**', (route: Route) => {
      if (route.request().method() === 'PUT' && !stalled) { stalled = route; return; }   // never answered
      return route.fallback();
    });
  } });
  await editHome(page, frame, 'Stuck on the way');
  await expect(whisper(page)).toHaveText('Saving…');
  await expect(whisper(page)).toHaveText('Not saved · Try again', { timeout: 6000 });   // ~1.5 s, not minutes
  await expect(page.locator('.dds-toast').last()).toContainText('That save took too long');
  expect(puts.length).toBe(0);
  await whisper(page).click();   // the retry isn't behind the stalled one
  await expect.poll(() => words(puts), { timeout: 8000 }).toContain('Stuck on the way');
  try { await (stalled as unknown as Route).abort(); } catch { /* already gone */ }
});

test('271: a sign-in that lapsed mid-edit asks over the page, which stays as it is; signed in again, the save goes', async ({ page }) => {
  const { frame, puts } = await mountCanvas(page);
  await page.evaluate(() => { (window as unknown as { __E2E_SESSION: unknown }).__E2E_SESSION = null; });
  await editHome(page, frame, 'Typed after the sign-in ran out');
  const dlg = page.locator('#lapseDlg');
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText('Your sign-in ran out');
  await expect(dlg.getByRole('link', { name: 'Sign in' })).toHaveAttribute('target', '_blank');
  await expect(page.locator('#app')).toBeVisible();                 // the editor isn't swapped for a gate
  await expect(page.locator('#gate')).toBeHidden();
  await expect(homeLine(frame)).toHaveText('Typed after the sign-in ran out');   // the words are still on the page
  expect(puts.length).toBe(0);
  await dlg.getByRole('button', { name: 'I’m signed in again' }).click();
  await expect(page.locator('.dds-toast').last()).toContainText('Not signed in yet');
  await expect(dlg).toBeVisible();
  await page.evaluate(() => { (window as unknown as { __E2E_SESSION: unknown }).__E2E_SESSION = { access_token: 'e2e-token', user: { id: 'e2e-owner' } }; });
  await dlg.getByRole('button', { name: 'I’m signed in again' }).click();
  await expect(dlg).toHaveCount(0);
  await expect.poll(() => words(puts), { timeout: 8000 }).toContain('Typed after the sign-in ran out');
});

test('278: Load the latest keeps the unsaved section on the clipboard', async ({ page }) => {
  let stale = true;
  const { frame, puts } = await mountCanvas(page, { beforeGoto: (p) => p.route('**/functions/v1/presence/settings**', (route: Route) => {
    if (route.request().method() === 'PUT' && stale) { stale = false; return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'stale_draft', current_hash: 'theirs', last_change: null }) }); }
    return route.fallback();
  }) });
  await editHome(page, frame, 'Words someone else beat');
  const load = page.locator('.dds-toast').getByRole('button', { name: 'Load the latest' });
  await expect(load).toBeVisible();
  await load.click();
  await expect(page.locator('.dds-toast').last()).toContainText('Your unsaved section is on the clipboard — paste it back from the Add button.');
  const clip = await page.evaluate(() => JSON.parse(sessionStorage.getItem('dds-section-clip') || 'null'));
  expect(clip).toEqual({ ...BLOCKS[0], subtitle: 'Words someone else beat' });
  expect(puts.length).toBe(0);
  await expect(homeLine(frame)).toHaveText(BLOCKS[0].subtitle);   // the page shows the latest
});

test('254: a restore that stopped part-way says so and offers to put the draft back', async ({ page }) => {
  const writes: Array<{ path: string; body: unknown }> = [];
  await mountCanvas(page, { beforeGoto: (p) => p.route('**/functions/v1/presence/**', (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
    if (route.request().method() !== 'POST') return route.fallback();
    if (path === '/publishes/checkpoints/cp1/restore') return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'restore_partial', message: 'That stopped part-way: some of that version is in your draft and some isn’t. “Put my draft back” brings back the copy we set aside first.', safety_snapshot_id: 'snap-safe', put_back: 'Put my draft back' }) });
    if (path === '/restore-to-draft') { writes.push({ path, body: route.request().postDataJSON() }); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ok: true, message: 'Your draft is back as it was before the restore.' } }) }); }
    return route.fallback();
  }) });
  await page.evaluate(() => { (0, eval)('S.restoreTarget = { id: "cp1", saved: true, name: "Before the spring menu" }'); (document.getElementById('btnRestoreGo') as HTMLButtonElement).click(); });
  const put = page.locator('.dds-toast').getByRole('button', { name: 'Put my draft back' });
  await expect(put).toBeVisible();
  await expect(page.locator('.dds-toast').last()).toContainText('That stopped part-way');
  await put.click();
  await expect.poll(() => writes).toEqual([{ path: '/restore-to-draft', body: { snapshot_id: 'snap-safe' } }]);
  await expect(page.locator('.dds-toast').last()).toContainText('Your draft is back as it was before the restore.');
});

test('249: a publish that goes live over a waiting one asks: update it, or cancel it', async ({ page }) => {
  const writes: Array<{ path: string; body: unknown }> = [];
  await mountCanvas(page, { beforeGoto: (p) => p.route('**/functions/v1/presence/**', (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
    const m = route.request().method();
    if (m === 'GET' && path === '/schedule') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { scheduled: writes.some((w) => w.path.endsWith('/cancel')) ? [] : [{ id: 'sc-1', kind: 'publish', scheduled_for: '2026-12-24T18:00:00Z', summary: 'Holiday hours', created_at: '2026-11-20T10:00:00Z' }] } }) });
    if (m !== 'POST') return route.fallback();
    writes.push({ path, body: route.request().postDataJSON() });
    if (path === '/publish') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { status: 'live', message: 'Your site is live.' } }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ok: true } }) });
  }) });
  await page.evaluate(() => (0, eval)('runPublish(document.createElement("button"), false)'));
  const ask = page.locator('dialog.ask-yes[open]');
  await expect(ask).toContainText('A publish is still waiting for Dec 24, 2026');
  await expect(ask).toContainText('older than what just went live');
  await ask.getByRole('button', { name: 'Update it' }).click();
  await expect.poll(() => writes.map((w) => w.path)).toEqual(['/publish', '/schedule/sc-1/cancel', '/schedule']);
  expect(writes[2].body).toEqual({ scheduled_for: '2026-12-24T18:00:00Z', kind: 'publish', note: 'Holiday hours' });
  await expect(page.locator('.dds-toast').last()).toContainText('Updated — today’s version publishes at');
});

test('249: …or cancel it, and nothing is scheduled in its place', async ({ page }) => {
  const writes: string[] = [];
  await mountCanvas(page, { beforeGoto: (p) => p.route('**/functions/v1/presence/**', (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
    const m = route.request().method();
    if (m === 'GET' && path === '/schedule') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { scheduled: [{ id: 'sc-1', kind: 'publish', scheduled_for: '2026-12-24T18:00:00Z', summary: '' }] } }) });
    if (m !== 'POST') return route.fallback();
    writes.push(path);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: path === '/publish' ? { status: 'live' } : { ok: true } }) });
  }) });
  await page.evaluate(() => (0, eval)('runPublish(document.createElement("button"), false)'));
  const ask = page.locator('dialog.ask-yes[open]');
  await ask.getByRole('button', { name: 'Cancel it' }).click();
  await expect.poll(() => writes).toEqual(['/publish', '/schedule/sc-1/cancel']);
  await expect(page.locator('.dds-toast').last()).toContainText('Canceled — nothing will happen at that time.');
  void META;
});
