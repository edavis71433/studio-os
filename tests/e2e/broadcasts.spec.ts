import { test, expect, Page } from '@playwright/test';
import { installApp } from './helpers/app';

// ── SS4 — Broadcasts console polish ──────────────────────────────────────────
// Pins the slice's contract:
//   1. the L bug — a SAVED DRAFT REOPENS into the composer after a reload
//      (Edit draft → composer filled, next preview PATCHes instead of POSTing
//      a duplicate draft)
//   2. history is a real list: .lhead meta + rows drill in to status · audience ·
//      counts · the delivered body in a sandboxed iframe
//   3. ↻ soft refresh NEVER reloads the document; failure keeps the list + toast
//   4. boot reads run in PARALLEL (D6) with per-read failure honesty — one read
//      failing degrades its section with a notice, the rest survives
//   5. stale-response guard (REQ_SEQ) — a slow earlier read never paints over a
//      newer one
//   6. styled dialogs — no native confirm()/prompt() on cancel/send/assist
//
// Fixture shapes mirror supabase/functions/presence/routes/broadcasts.ts:
//   GET /broadcasts            → { data: { broadcasts: [row…] } }  (list rows carry NO body)
//   GET /broadcasts/segments   → { data: { segments: [{key,label,description,count}] } }
//   GET /broadcasts/:id        → { data: { broadcast, audience_label, recipient_count,
//                                          suppressed_count, preview_subject, preview_html } }

const D_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'; // draft
const S_ID = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'; // scheduled
const T_ID = 'cccccccc-3333-4333-8333-cccccccccccc'; // sent

const SEGS = { data: { segments: [
  { key: 'contacts', label: 'All contacts', description: 'Everyone saved in your contacts.', count: 12 },
  { key: 'enquiries', label: 'All website enquiries', description: 'Everyone who has messaged you through your website.', count: 8 },
  { key: 'enquiries_30d', label: 'Recent enquiries (30 days)', description: 'People who enquired through your website in the last month.', count: 3 },
] } };

const ROW_DRAFT = { id: D_ID, subject: 'July opening hours', audience: 'contacts', status: 'draft', scheduled_at: null, sent_at: null, recipient_count: null, sent_count: null, skipped_count: null, failed_count: null, created_at: '2026-07-18T09:00:00Z' };
const ROW_SCHED = { id: S_ID, subject: 'Weekend tasting event', audience: 'enquiries', status: 'scheduled', scheduled_at: '2026-08-01T09:00:00Z', sent_at: null, recipient_count: 8, sent_count: null, skipped_count: null, failed_count: null, created_at: '2026-07-15T09:00:00Z' };
const ROW_SENT = { id: T_ID, subject: 'June recap', audience: 'contacts', status: 'sent', scheduled_at: null, sent_at: '2026-06-30T10:00:00Z', recipient_count: 46, sent_count: 42, skipped_count: 3, failed_count: 1, created_at: '2026-06-30T09:00:00Z' };
const LIST = { data: { broadcasts: [ROW_DRAFT, ROW_SCHED, ROW_SENT] } };

const DRAFT_DETAIL = { data: {
  broadcast: { ...ROW_DRAFT, site_id: 'site-1', body: 'Hi {{first_name}},\n\nWe are open late all of July.', updated_at: '2026-07-18T09:00:00Z', created_by: 'owner@example.com' },
  audience_label: 'All contacts', recipient_count: 11, suppressed_count: 1,
  preview_subject: 'July opening hours', preview_html: '<html><body><p>Hi there,</p><p>We are open late all of July.</p></body></html>',
} };
const SCHED_DETAIL = { data: {
  broadcast: { ...ROW_SCHED, site_id: 'site-1', body: 'Join us Saturday.', updated_at: '2026-07-15T09:00:00Z', created_by: 'owner@example.com' },
  audience_label: 'All website enquiries', recipient_count: 8, suppressed_count: 0,
  preview_subject: 'Weekend tasting event', preview_html: '<html><body><p>Join us Saturday.</p></body></html>',
} };
const SENT_DETAIL = { data: {
  broadcast: { ...ROW_SENT, site_id: 'site-1', body: 'June was busy.', updated_at: '2026-06-30T10:00:00Z', created_by: 'owner@example.com' },
  audience_label: 'All contacts', recipient_count: 46, suppressed_count: 3,
  preview_subject: 'June recap', preview_html: '<html><body><p>June was busy.</p></body></html>',
} };

const API = {
  '/broadcasts': LIST,
  '/broadcasts/segments': SEGS,
  ['/broadcasts/' + D_ID]: DRAFT_DETAIL,
  ['/broadcasts/' + S_ID]: SCHED_DETAIL,
  ['/broadcasts/' + T_ID]: SENT_DETAIL,
  '/broadcasts/draft-assist': { data: { subject: 'Summer menu is here', body: 'Hi {{first_name}}, come try the new dishes.', note: 'A starting point.' } },
};

const isListGet = (u: string, m: string) => m === 'GET' && /\/presence\/broadcasts$/.test(new URL(u).pathname);

/** Track any use of the NATIVE dialogs — the page must never call them. */
async function trapNativeDialogs(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __nativeDialogs: string[] };
    w.__nativeDialogs = [];
    window.confirm = () => { w.__nativeDialogs.push('confirm'); return true; };
    window.prompt = () => { w.__nativeDialogs.push('prompt'); return 'x'; };
  });
}
const nativeDialogs = (page: Page) => page.evaluate(() => (window as unknown as { __nativeDialogs?: string[] }).__nativeDialogs || []);

test.describe('SS4 — broadcasts console', () => {

  test('the L bug — a saved draft reopens into the composer after a reload, and previews PATCH it (no duplicate POST)', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/broadcasts.html');
    // a duplicate draft-create would be a POST to the bare /broadcasts path
    const creates: string[] = [];
    page.on('request', (r) => { if (r.method() === 'POST' && /\/presence\/broadcasts$/.test(new URL(r.url()).pathname)) creates.push(r.url()); });
    // the saved draft (as after any reload: DRAFT is gone, only the list row remains)
    const row = page.locator('.bc').filter({ hasText: 'July opening hours' });
    await row.getByRole('button', { name: 'Edit draft' }).click();
    // the composer is the draft again — subject, body, audience
    await expect(page.locator('#subj')).toHaveValue('July opening hours');
    await expect(page.locator('#bodytx')).toHaveValue(/open late all of July/);
    await expect(page.locator('[data-seg="contacts"]')).toHaveAttribute('aria-pressed', 'true');
    // and previewing UPDATES the same draft (ensureDraft must PATCH, not POST)
    const patched = page.waitForRequest((r) => r.method() === 'PATCH' && r.url().includes('/broadcasts/' + D_ID));
    await page.getByRole('button', { name: /Preview/ }).click();
    await patched;
    await expect(page.locator('#stage')).toContainText('Preview & send');
    expect(creates).toHaveLength(0);
  });

  test('a successful send clears the composer — the next Preview cannot POST a twin draft of a SENT broadcast', async ({ page }) => {
    await installApp(page, { api: { ...API, ['/broadcasts/' + D_ID + '/send']: { data: { status: 'sent', sent_count: 5, skipped_count: 0, failed_count: 0, recipient_count: 5 } } } });
    await page.goto('/broadcasts.html');
    // a resurrected draft-create would be a POST to the bare /broadcasts path
    const creates: string[] = [];
    page.on('request', (r) => { if (r.method() === 'POST' && /\/presence\/broadcasts$/.test(new URL(r.url()).pathname)) creates.push(r.url()); });
    // open the saved draft into the composer and take it to the send stage
    await page.locator('.bc').filter({ hasText: 'July opening hours' }).getByRole('button', { name: 'Edit draft' }).click();
    await expect(page.locator('#subj')).toHaveValue('July opening hours');
    await page.getByRole('button', { name: /Preview/ }).click();
    await expect(page.locator('#stage')).toContainText('Preview & send');
    await page.locator('#send').click();
    const dlg = page.locator('dialog[open]');
    await expect(dlg).toContainText(/Send this to your list now/);
    const sent = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/broadcasts/' + D_ID + '/send'));
    await dlg.getByRole('button', { name: 'Send now' }).click();
    await sent;
    // the composer is genuinely empty again — the send CONSUMED the draft; the
    // regression re-created it from the still-populated form during load()
    await expect(page.locator('#subj')).toHaveValue('');
    await expect(page.locator('#bodytx')).toHaveValue('');
    // and a fresh Preview on the empty composer creates NOTHING on the server
    await page.getByRole('button', { name: /Preview/ }).click();
    await expect(page.getByText('Add a subject line first.')).toBeVisible();
    expect(creates).toHaveLength(0);
  });

  test('history header carries honest .lhead meta and rows render the production list shape', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/broadcasts.html');
    // count · last sent · updated — the meta line of a real list
    const meta = page.locator('#bcMeta');
    await expect(meta).toContainText('3 broadcasts');
    await expect(meta).toContainText('last sent');
    await expect(meta).toContainText('Updated just now');
    // rows show honest per-status facts from the list shape
    await expect(page.locator('.bc').filter({ hasText: 'June recap' })).toContainText('42 sent · 3 skipped · 1 failed');
    await expect(page.locator('.bc').filter({ hasText: 'Weekend tasting event' })).toContainText('Scheduled for');
    await expect(page.locator('.bc').filter({ hasText: 'July opening hours' }).locator('.st')).toHaveText('draft');
  });

  test('a sent row drills in: audience · counts · failed note · the delivered body in a sandboxed iframe', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/broadcasts.html');
    const row = page.locator('.bc').filter({ hasText: 'June recap' });
    await row.getByRole('button', { name: /June recap/ }).click();
    const detail = row.locator('.bcdetail');
    await expect(detail).toBeVisible();
    await expect(detail).toContainText('All contacts');
    await expect(detail).toContainText('42 sent');
    // failed_count > 0 → the honest failed line
    await expect(detail).toContainText(/1 address couldn.t be reached/);
    // the delivered body renders in a SANDBOXED srcdoc iframe (no scripts run)
    const frame = detail.locator('iframe');
    await expect(frame).toHaveAttribute('sandbox', '');
    await expect(frame).toHaveAttribute('srcdoc', /June was busy/);
    // toggling closed works and the toggle is an aria-expanded disclosure
    await expect(row.getByRole('button', { name: /June recap/ })).toHaveAttribute('aria-expanded', 'true');
  });

  test('a scheduled row keeps Cancel and gains Reschedule', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto('/broadcasts.html');
    const row = page.locator('.bc').filter({ hasText: 'Weekend tasting event' });
    await expect(row.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
    await row.getByRole('button', { name: 'Reschedule' }).click();
    // the send stage opens in schedule mode with the datetime visible
    await expect(page.locator('#stage')).toContainText('Preview & send');
    await expect(page.locator('#when')).toBeVisible();
    await expect(page.locator('#send')).toHaveText('Reschedule');
  });

  test('↻ refresh soft-fails: the list survives + a toast — the document NEVER reloads', async ({ page }) => {
    await installApp(page, { api: API });
    let calls = 0;
    await page.route((u) => isListGet(u.href, 'GET'), (route) => {
      calls++;
      if (calls === 1) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LIST) });
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) });
    });
    await page.goto('/broadcasts.html');
    await expect(page.locator('.bc').filter({ hasText: 'June recap' })).toBeVisible();
    // a marker that only survives if the document is never reloaded
    await page.evaluate(() => { (window as unknown as { __noReload?: boolean }).__noReload = true; });
    await page.getByRole('button', { name: /Refresh/ }).click();
    await expect(page.getByText(/Couldn.t refresh just now/).first()).toBeVisible();
    // the last good list is still on screen and the document never navigated
    await expect(page.locator('.bc').filter({ hasText: 'June recap' })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
  });

  test('D6 — boot reads run in PARALLEL: the list read is issued while segments is still in flight', async ({ page }) => {
    await installApp(page, { api: API });
    let releaseSegs!: () => void;
    const segsHeld = new Promise<void>((r) => { releaseSegs = r; });
    await page.route((u) => /\/broadcasts\/segments$/.test(u.pathname), async (route) => {
      await segsHeld;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SEGS) });
    });
    // sequential boot (the old page) awaits segments first — the list request
    // would never be issued while segments hangs, and this wait times out
    const listSeen = page.waitForRequest((r) => isListGet(r.url(), r.method()), { timeout: 5000 });
    await page.goto('/broadcasts.html');
    await listSeen;
    releaseSegs();
    await expect(page.locator('.bc').filter({ hasText: 'June recap' })).toBeVisible();
  });

  test('per-read honesty — segments failing degrades the audience card with a notice; history still renders', async ({ page }) => {
    await installApp(page, { api: API });
    await page.route((u) => /\/broadcasts\/segments$/.test(u.pathname), (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) }));
    await page.goto('/broadcasts.html');
    // NOT the full-screen trouble: the composer + history survive
    await expect(page.locator('#subj')).toBeVisible();
    await expect(page.locator('.bc').filter({ hasText: 'June recap' })).toBeVisible();
    const notice = page.locator('#segNotice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(/lists couldn.t load/);
    await expect(notice.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('per-read honesty — the history read failing keeps the composer and shows an in-card notice with Try again', async ({ page }) => {
    await installApp(page, { api: API });
    let listCalls = 0;
    await page.route((u) => isListGet(u.href, 'GET'), (route) => {
      listCalls++;
      if (listCalls === 1) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LIST) });
    });
    await page.goto('/broadcasts.html');
    // composer + segments survive the list failure
    await expect(page.locator('#subj')).toBeVisible();
    await expect(page.locator('[data-seg="contacts"]')).toBeVisible();
    const notice = page.locator('#bcNotice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(/couldn.t load/);
    // and Try again recovers in place — no navigation
    await page.evaluate(() => { (window as unknown as { __noReload?: boolean }).__noReload = true; });
    await notice.getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('.bc').filter({ hasText: 'June recap' })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
  });

  test('REQ_SEQ — a slow earlier refresh never paints over a newer one', async ({ page }) => {
    await installApp(page, { api: API });
    const stale = { data: { broadcasts: [{ ...ROW_SENT, id: T_ID, subject: 'STALE list' }] } };
    const fresh = { data: { broadcasts: [{ ...ROW_SENT, id: T_ID, subject: 'FRESH list' }] } };
    let calls = 0;
    let staleDone!: () => void;
    const staleLanded = new Promise<void>((r) => { staleDone = r; });
    await page.route((u) => isListGet(u.href, 'GET'), async (route) => {
      calls++;
      if (calls === 1) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LIST) });
      if (calls === 2) {
        await new Promise((r) => setTimeout(r, 700));
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stale) });
        staleDone();
        return;
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fresh) });
    });
    await page.goto('/broadcasts.html');
    await expect(page.locator('.bc').filter({ hasText: 'June recap' })).toBeVisible();
    const refresh = page.getByRole('button', { name: /Refresh/ });
    await refresh.click();   // slow request (goes stale)
    await refresh.click();   // newer request (must win)
    await expect(page.locator('.bc').filter({ hasText: 'FRESH list' })).toBeVisible();
    await staleLanded;       // the slow response has now resolved…
    await expect(page.locator('.bc').filter({ hasText: 'STALE list' })).toHaveCount(0);   // …and was discarded
    await expect(page.locator('.bc').filter({ hasText: 'FRESH list' })).toBeVisible();
  });

  test('styled dialog on Cancel — a <dialog>, never native confirm()', async ({ page }) => {
    await trapNativeDialogs(page);
    await installApp(page, { api: API });
    await page.goto('/broadcasts.html');
    const row = page.locator('.bc').filter({ hasText: 'Weekend tasting event' });
    await row.getByRole('button', { name: 'Cancel', exact: true }).click();
    const dlg = page.locator('dialog[open]');
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText(/Cancel this scheduled/);
    const posted = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/broadcasts/' + S_ID + '/cancel'));
    await dlg.getByRole('button', { name: 'Cancel it' }).click();
    await posted;
    expect(await nativeDialogs(page)).toHaveLength(0);
  });

  test('styled dialog on ✨ assist — a <dialog> with an input, never native prompt()', async ({ page }) => {
    await trapNativeDialogs(page);
    await installApp(page, { api: API });
    await page.goto('/broadcasts.html');
    await page.getByRole('button', { name: /Help me write it/ }).click();
    const dlg = page.locator('dialog[open]');
    await expect(dlg).toBeVisible();
    await dlg.locator('input').fill('The summer menu is live');
    const asked = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/broadcasts/draft-assist'));
    await dlg.getByRole('button', { name: 'Draft it' }).click();
    await asked;
    await expect(page.locator('#subj')).toHaveValue('Summer menu is here');
    expect(await nativeDialogs(page)).toHaveLength(0);
  });

  test('boot is quiet: one h1, aria-pressed segments, zero console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    await installApp(page, { api: API });
    await page.goto('/broadcasts.html');
    await expect(page.locator('.bc').filter({ hasText: 'June recap' })).toBeVisible();
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('[data-seg]')).toHaveCount(3);
    for (const seg of await page.locator('[data-seg]').all()) {
      expect(await seg.getAttribute('aria-pressed')).toMatch(/^(true|false)$/);
    }
    expect(errors).toEqual([]);
  });
});
