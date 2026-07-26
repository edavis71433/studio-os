import { test, expect, Page } from '@playwright/test';
import { installApp } from './helpers/app';

// SS10 (standards sweep) — snapshot-history.html honesty.
//
// THE HEADLINE (security): the compare/snapshot iframes render CLIENT-authored
// HTML. Without a sandbox they run same-origin in the operator's auth context —
// client script could reach the operator session. Every compare iframe must
// carry sandbox="" (no allow-* tokens; the SS4 broadcasts precedent), with the
// content assigned via the srcdoc *property*, never an escaped attribute.
//
// Plus the SS8 cms-family chrome: .lhead-lite (count meta · "As of {time}" · ↻
// soft refresh keeping last good), REQ_SEQ, honest trouble/Try-again, distinct
// 401/403/404 — and the compare tool never fails silently.
//
// Fixtures match the REAL payloads:
//   GET /snapshot-history  → routes/history_page.ts + lib/snapshot_history.ts:
//     { data: { headline, total, groups:[{ key, label, versions:[{ name,
//       what_changed?, when, published_on, at, why, is_current, can_preview,
//       can_restore, preview_href?, restore_href?, icon }] }] } }
//   GET /publishes         → routes/publish.ts handlePublishHistory:
//     { data: [{ id, kind, status:'live'|'failed'|'publishing', summary, label,
//       at, completed_at, restorable }] }
//   GET /publishes/compare → routes/publish.ts handleCompareVersions:
//     { data: { from:{ ref, label, at, blocks }, to:{…}, count, identical,
//       changes:[{ section, sentence }] } }
//   GET /preview           → routes/preview.ts: text/html body.

const SNAP = { data: {
  headline: 'Your website has 3 saved versions.',
  total: 3,
  groups: [
    { key: 'current', label: 'Current website', versions: [
      { name: 'Summer refresh', when: '2 days ago', published_on: 'July 24, 2026', at: '2026-07-24T00:05:00Z',
        why: 'This is your live website right now.', is_current: true, can_preview: true, can_restore: false,
        preview_href: '/presence.html#history', icon: '🌐' },
    ] },
    { key: 'previous', label: 'Previous versions', versions: [
      { name: 'Spring menu', what_changed: 'Updated the menu and hours.', when: '3 weeks ago', published_on: 'July 2, 2026',
        at: '2026-07-02T00:05:00Z', why: 'A published update to your website.', is_current: false, can_preview: true,
        can_restore: true, preview_href: '/presence.html#history', restore_href: '/presence.html#history', icon: '📄' },
      { name: 'Version from June 1, 2026', when: '8 weeks ago', published_on: 'June 1, 2026', at: '2026-06-01T00:05:00Z',
        why: 'A published update to your website.', is_current: false, can_preview: true, can_restore: true,
        preview_href: '/presence.html#history', restore_href: '/presence.html#history', icon: '📄' },
    ] },
  ],
} };

const PUBLISHES = { data: [
  { id: '11111111-1111-1111-1111-111111111111', kind: 'publish', status: 'live', summary: 'Summer refresh', label: 'Summer refresh', at: '2026-07-24T00:00:00Z', completed_at: '2026-07-24T00:05:00Z', restorable: true },
  { id: '22222222-2222-2222-2222-222222222222', kind: 'publish', status: 'live', summary: 'Spring menu', label: 'Spring menu', at: '2026-07-02T00:00:00Z', completed_at: '2026-07-02T00:05:00Z', restorable: true },
] };

// structured compare (both from.blocks + to.blocks present) → the full
// added/removed/changed/moved chip vocabulary via diffPublishBlocks.
const COMPARE_STRUCTURED = { data: {
  from: { ref: '22222222-2222-2222-2222-222222222222', label: 'Spring menu', at: '2026-07-02T00:05:00Z', blocks: [
    { id: 'b1', type: 'hero', v: 1 }, { id: 'b2', type: 'gallery' }, { id: 'b3', type: 'cta' }, { id: 'b5', type: 'team' },
  ] },
  to: { ref: 'live', label: 'Summer refresh', at: '2026-07-24T00:05:00Z', blocks: [
    { id: 'b2', type: 'gallery' }, { id: 'b1', type: 'hero', v: 2 }, { id: 'b3', type: 'cta' }, { id: 'b4', type: 'reviews' },
  ] },
  count: 3, identical: false, changes: [{ section: 'site', sentence: 'The layout was rearranged.' }],
} };

// sentence-only compare (no block arrays) → grouped amber "changed" chips.
const COMPARE_SENTENCES = { data: {
  from: { ref: '22222222-2222-2222-2222-222222222222', label: 'Spring menu', at: '2026-07-02T00:05:00Z' },
  to: { ref: 'live', label: 'Summer refresh', at: '2026-07-24T00:05:00Z' },
  count: 2, identical: false,
  changes: [{ section: 'business', sentence: 'Your hours change.' }, { section: 'offerings', sentence: '2 menu items appear.' }],
} };

const COMPARE_RE = /\/functions\/v1\/presence\/publishes\/compare/;
const PUBLISHES_RE = /\/functions\/v1\/presence\/publishes(\?|$)/;
const SNAP_RE = /\/functions\/v1\/presence\/snapshot-history/;
const PREVIEW_RE = /\/functions\/v1\/presence\/preview/;
const ok = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const boom = (status: number) => ({ status, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) });
const html = (body: string) => ({ status: 200, contentType: 'text/html; charset=utf-8', body });

const trackErrors = (page: Page, errors: string[]) => {
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
};

// full-suite fixtures: history + compare pickers + a structured diff + a preview
const full = { '/snapshot-history': SNAP, '/publishes': PUBLISHES, '/publishes/compare': COMPARE_STRUCTURED };

test.describe('Snapshot history — SS10 security + family chrome', () => {
  test('SECURITY: every compare iframe carries sandbox="" — no allow-scripts, no allow-same-origin', async ({ page }) => {
    const errors: string[] = [];
    trackErrors(page, errors);
    await installApp(page, { api: full });
    await page.route(PREVIEW_RE, (route) => route.fulfill(html('<h1>preview</h1>')));
    await page.goto('/snapshot-history.html');
    const frames = page.locator('.pane iframe');
    await expect(frames).toHaveCount(2);
    for (const id of ['frameA', 'frameB']) {
      const sb = await page.locator('#' + id).getAttribute('sandbox');
      expect(sb, `#${id} must declare a sandbox attribute`).not.toBeNull();
      expect(sb, `#${id} sandbox must be the empty token set`).toBe('');
      expect(sb || '').not.toContain('allow-scripts');
      expect(sb || '').not.toContain('allow-same-origin');
    }
    expect(errors).toEqual([]);
  });

  test('SECURITY: iframe content arrives via the srcdoc property (not an escaped attribute)', async ({ page }) => {
    await installApp(page, { api: full });
    await page.route(PREVIEW_RE, (route) => route.fulfill(html('<h1 id="pv">from preview</h1>')));
    await page.goto('/snapshot-history.html');
    // the property carries the html; the parser attribute is never populated
    await expect.poll(async () => page.locator('#frameA').evaluate((f: HTMLIFrameElement) => f.srcdoc)).toContain('from preview');
    const attr = await page.locator('#frameA').evaluate((f) => f.getAttribute('srcdoc'));
    expect(attr === null || attr === '').toBeTruthy();
  });

  test('boots under the family chrome: one h1, count meta + "As of" freshness + ↻ — zero console errors', async ({ page }) => {
    const errors: string[] = [];
    trackErrors(page, errors);
    await installApp(page, { api: full });
    await page.route(PREVIEW_RE, (route) => route.fulfill(html('<h1>preview</h1>')));
    await page.goto('/snapshot-history.html');
    await expect(page.getByRole('heading', { level: 1, name: 'Your website versions' })).toBeVisible();
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('.lhead .lmeta')).toContainText('3 saved versions');
    await expect(page.locator('.lhead .lmeta')).toContainText('As of');
    await expect(page.locator('#refreshBtn')).toBeVisible();
    await expect(page.getByText('Summer refresh').first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('403 renders its own workspace copy — distinct from trouble, no empty chrome', async ({ page }) => {
    await installApp(page, { api: {} });
    await page.route(SNAP_RE, (route) => route.fulfill(boom(403)));
    await page.goto('/snapshot-history.html');
    await expect(page.getByText(/isn.t in your workspace|this account can.t see/i)).toBeVisible();
    await expect(page.getByText(/couldn.t load your versions just now/i)).toBeHidden();
    await expect(page.locator('.lhead')).toBeHidden();
  });

  test('404 renders its own not-found copy, distinct from trouble', async ({ page }) => {
    await installApp(page, { api: {} });
    await page.route(SNAP_RE, (route) => route.fulfill(boom(404)));
    await page.goto('/snapshot-history.html');
    await expect(page.getByText(/couldn.t find this website/i)).toBeVisible();
    await expect(page.getByText(/couldn.t load your versions just now/i)).toBeHidden();
  });

  test('a failed history read renders trouble with Try again wired to load() in place', async ({ page }) => {
    await installApp(page, { api: full });
    let calls = 0;
    await page.route(SNAP_RE, (route) => route.fulfill(++calls === 1 ? boom(500) : ok(SNAP)));
    await page.route(PREVIEW_RE, (route) => route.fulfill(html('<h1>preview</h1>')));
    await page.goto('/snapshot-history.html');
    const retry = page.getByRole('button', { name: /try again/i });
    await expect(retry).toBeVisible();
    await retry.click();
    await expect(page.getByText('Summer refresh').first()).toBeVisible();
    expect(calls).toBe(2);
  });

  test('↻ soft refresh keeps the last good render when the re-read fails', async ({ page }) => {
    await installApp(page, { api: full });
    let calls = 0;
    await page.route(SNAP_RE, (route) => route.fulfill(++calls === 1 ? ok(SNAP) : boom(500)));
    await page.route(PREVIEW_RE, (route) => route.fulfill(html('<h1>preview</h1>')));
    await page.goto('/snapshot-history.html');
    await expect(page.getByText('Summer refresh').first()).toBeVisible();
    await page.locator('#refreshBtn').click();
    await expect(page.getByText('Summer refresh').first()).toBeVisible();
    await expect(page.getByText(/couldn.t refresh just now/i)).toBeVisible();
  });

  test('signed out renders the sign-in invitation', async ({ page }) => {
    await installApp(page, { session: null, api: {} });
    await page.goto('/snapshot-history.html');
    await expect(page.getByText(/sign in to see your website versions/i)).toBeVisible();
  });

  test('empty state renders honestly when there are no saved versions', async ({ page }) => {
    await installApp(page, { api: { '/snapshot-history': { data: { headline: 'No saved versions yet.', total: 0, groups: [] } }, '/publishes': { data: [] } } });
    await page.goto('/snapshot-history.html');
    await expect(page.getByText(/no saved versions yet/i)).toBeVisible();
    await expect(page.locator('.lhead')).toBeHidden();
  });
});

test.describe('Snapshot history — SS10 compare honesty', () => {
  test('the compare tool never fails silently: a failed /publishes shows an honest line + Try again', async ({ page }) => {
    await installApp(page, { api: { '/snapshot-history': SNAP } });
    let calls = 0;
    await page.route(PUBLISHES_RE, (route) => {
      if (COMPARE_RE.test(route.request().url())) return route.fulfill(ok(COMPARE_STRUCTURED));
      return route.fulfill(++calls === 1 ? boom(500) : ok(PUBLISHES));
    });
    await page.route(PREVIEW_RE, (route) => route.fulfill(html('<h1>preview</h1>')));
    await page.goto('/snapshot-history.html');
    // the history list above stands complete
    await expect(page.getByText('Summer refresh').first()).toBeVisible();
    // and the compare tool says so honestly instead of vanishing
    await expect(page.getByText(/compare tool couldn.t load|versions above are complete/i)).toBeVisible();
    const retry = page.locator('#compare').getByRole('button', { name: /try again/i });
    await expect(retry).toBeVisible();
    await retry.click();
    // second /publishes call succeeds → pickers appear
    await expect(page.locator('#cmpA')).toBeVisible();
    expect(calls).toBe(2);
  });

  test('compare renders the diff chips + fills both sandboxed panes', async ({ page }) => {
    await installApp(page, { api: full });
    await page.route(PREVIEW_RE, (route) => route.fulfill(html('<h1 id="pv">rendered version</h1>')));
    await page.goto('/snapshot-history.html');
    await expect(page.locator('#compare')).toBeVisible();
    await expect(page.locator('.chips .chip')).not.toHaveCount(0);
    // structured diff → all four kinds present
    await expect(page.locator('.chip.added')).toBeVisible();
    await expect(page.locator('.chip.removed')).toBeVisible();
    await expect(page.locator('.chip.changed')).toBeVisible();
    await expect(page.locator('.chip.moved')).toBeVisible();
    await expect.poll(async () => page.locator('#frameA').evaluate((f: HTMLIFrameElement) => f.srcdoc)).toContain('rendered version');
  });

  test('a transient compare failure and a too-old (410) failure read differently', async ({ page }) => {
    // transient: 500 → "try again in a moment"
    await installApp(page, { api: { '/snapshot-history': SNAP, '/publishes': PUBLISHES } });
    await page.route(COMPARE_RE, (route) => route.fulfill(boom(500)));
    await page.route(PREVIEW_RE, (route) => route.fulfill(html('<h1>preview</h1>')));
    await page.goto('/snapshot-history.html');
    await expect(page.getByText(/try again in a moment/i)).toBeVisible();
    await expect(page.getByText(/too old to compare/i)).toBeHidden();
  });

  test('a too-old (410) compare reads as permanent, not transient', async ({ page }) => {
    await installApp(page, { api: { '/snapshot-history': SNAP, '/publishes': PUBLISHES } });
    await page.route(COMPARE_RE, (route) => route.fulfill(boom(410)));
    await page.route(PREVIEW_RE, (route) => route.fulfill(html('<h1>preview</h1>')));
    await page.goto('/snapshot-history.html');
    await expect(page.getByText(/too old to compare/i)).toBeVisible();
  });

  test('sentence-only compare payloads still render honest section chips', async ({ page }) => {
    await installApp(page, { api: { '/snapshot-history': SNAP, '/publishes': PUBLISHES, '/publishes/compare': COMPARE_SENTENCES } });
    await page.route(PREVIEW_RE, (route) => route.fulfill(html('<h1>preview</h1>')));
    await page.goto('/snapshot-history.html');
    await expect(page.locator('.chip.changed').first()).toBeVisible();
    await expect(page.getByText(/by section/i)).toBeVisible();
  });

  test('the diff chips follow the theme (retokened, not hardcoded light hex)', async ({ page }) => {
    await installApp(page, { api: full });
    await page.route(PREVIEW_RE, (route) => route.fulfill(html('<h1>preview</h1>')));
    await page.goto('/snapshot-history.html');
    await expect(page.locator('.chip.added')).toBeVisible();
    const bg = (sel: string) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).backgroundColor);
    const lightAdded = await bg('.chip.added');
    await page.emulateMedia({ colorScheme: 'dark' });
    const darkAdded = await bg('.chip.added');
    // a hardcoded #e7f5ec would be identical in both themes; a token follows the theme
    expect(darkAdded).not.toBe(lightAdded);
  });
});
