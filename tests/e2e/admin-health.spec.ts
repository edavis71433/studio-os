import { test, expect } from '@playwright/test';
import { installApp, pressButton } from './helpers/app';

// ── SS12 — Admin-health ops chrome ───────────────────────────────────────────
// The operator's ONE operational read (/admin/health-center). SS12 gives it the
// SS8 cms-family chrome (as-of freshness · ↻ soft refresh keep-last-good · REQ_SEQ
// · distinct 401/403/404 · honest trouble/Try-again) and the analytics dashboard
// standard (KPI band + banded sections + real drill footers to fixing surfaces).
//
// Payload truth (supabase/functions/presence/lib/health_center.ts, verified —
// NOT invented): { data: { overall:'ok'|'attention', areas:[{key,label,state,
// detail}] } }. Ten fixed area keys, state ∈ ok|attention|off. There is NO
// server timestamp — the "as of" reflects the client read time, honestly.
const HC = { data: { overall: 'attention', areas: [
  { key: 'platform', label: 'Platform', state: 'ok', detail: 'All required configuration is present.' },
  { key: 'cron', label: 'Scheduled operations', state: 'ok', detail: 'Running on schedule.' },
  { key: 'domains', label: 'Domains', state: 'attention', detail: '2 expiring within 30 days.' },
  { key: 'billing', label: 'Billing', state: 'attention', detail: '1 with payment trouble, 0 lapsed.' },
  { key: 'ai', label: 'AI', state: 'off', detail: 'Not configured (AI features degrade gracefully).' },
  { key: 'email', label: 'Email delivery', state: 'ok', detail: 'Configured — notices and receipts can send.' },
  { key: 'usage', label: 'Usage', state: 'ok', detail: '12 sites live.' },
  { key: 'errors', label: 'Errors', state: 'ok', detail: 'No recent failures.' },
  { key: 'alerts', label: 'Alerts', state: 'ok', detail: 'Nothing outstanding.' },
  { key: 'backups', label: 'Backups & recovery', state: 'attention', detail: 'Backups on, but a restore drill hasn’t been confirmed yet.' },
] } };
const HC_OK = { data: { overall: 'ok', areas: [
  { key: 'platform', label: 'Platform', state: 'ok', detail: 'All required configuration is present.' },
  { key: 'usage', label: 'Usage', state: 'ok', detail: '1 site live.' },
] } };

const HEALTH_GLOB = '**/functions/v1/presence/admin/health-center';

// ── Item 3 · Banded dashboard layout + KPI band (analytics standard) ──────────
test.describe('Admin Health Center — banded dashboard', () => {
  test('one area card per area, honest states, banded into sections', async ({ page }) => {
    await installApp(page, { api: { '/admin/health-center': HC } });
    await page.goto('/admin-health.html');
    await expect(page.getByText('Some areas need a look.')).toBeVisible();
    await expect(page.locator('.card.area')).toHaveCount(10);
    await expect(page.getByText('Billing', { exact: true })).toBeVisible();
    await expect(page.getByText('a restore drill hasn’t been confirmed yet.')).toBeVisible();
    await expect(page.locator('.area.off')).toContainText('AI'); // unconfigured reads "off", not broken
    // the flat grid is replaced by analytics-style bands
    for (const band of ['Jobs & delivery', 'Reach', 'Money & usage', 'Notices']) {
      await expect(page.getByRole('heading', { name: band })).toBeVisible();
    }
  });

  test('KPI band shows only honest counts derived from the payload states', async ({ page }) => {
    await installApp(page, { api: { '/admin/health-center': HC } });
    await page.goto('/admin-health.html');
    // 3 attention (domains, billing, backups) · 6 ok · 1 off — real, not invented
    await expect(page.locator('.kpi', { hasText: 'Needs a look' })).toContainText('3');
    await expect(page.locator('.kpi', { hasText: 'Running clean' })).toContainText('6');
    await expect(page.locator('.kpi', { hasText: /Off|not set up/ })).toContainText('1');
  });

  test('an all-clear payload reads calmly, not alarming', async ({ page }) => {
    await installApp(page, { api: { '/admin/health-center': HC_OK } });
    await page.goto('/admin-health.html');
    await expect(page.getByText('Everything is running normally.')).toBeVisible();
    await expect(page.locator('.card.area')).toHaveCount(2);
  });
});

// ── Item 2 · Area cards become real navigations (not dead ends) ───────────────
test.describe('Admin Health Center — drill footers to fixing surfaces', () => {
  test('areas with a fixing surface link to it; areas without stay non-interactive', async ({ page }) => {
    await installApp(page, { api: { '/admin/health-center': HC } });
    await page.goto('/admin-health.html');
    // domains → connections, email → broadcasts, billing/usage → admin-growth
    await expect(page.locator('.card.area', { hasText: 'Domains' }).locator('a[href="/presence.html#foundations"]')).toBeVisible();
    await expect(page.locator('.card.area', { hasText: 'Email delivery' }).locator('a[href="/broadcasts.html"]')).toBeVisible();
    await expect(page.locator('.card.area', { hasText: 'Billing' }).locator('a[href="/admin-growth.html"]')).toBeVisible();
    await expect(page.locator('.card.area', { hasText: 'Usage' }).locator('a[href="/admin-growth.html"]')).toBeVisible();
    // backups has no in-app fixing surface — it is honestly non-interactive, NOT a dead link
    await expect(page.locator('.card.area', { hasText: 'Backups & recovery' }).locator('a')).toHaveCount(0);
  });
});

// ── Sales item 131 · the Stripe key: which kind is held, and a check of each permission ──
// The card comes from the payload like any area; its check asks GET /admin/stripe-key
// (commerce/stripe_key.ts keyReport's shape) only when pressed, since it asks Stripe.
const keyLine = (id: string, resource: string, level: string, why: string, verdict: string, ok: boolean) => ({ id, resource, level, why, verdict, ok });
const HC_KEY = { data: { overall: 'attention', areas: [
  { key: 'billing', label: 'Billing', state: 'ok', detail: '1 active, all current.' },
  { key: 'stripe_key', label: 'Stripe key', state: 'attention', detail: 'Studio OS holds a full-power Stripe key. Swap it for a restricted key that can do only what Studio OS needs.' },
] } };
const FULL_KEY = { data: { kind: 'secret', live: true, ok: false, checked_at: '2026-11-16T20:00:00Z',
  summary: 'This key can do 2 things Studio OS never needs, such as refund a payment.',
  needs: [keyLine('plan_write', 'Prices', 'Write', 'make the price behind each invoice and retainer link', 'allowed', true),
    keyLine('balance_read', 'Balance', 'Read', 'Stripe’s fee on each payment, for the bookkeeper file', 'allowed', true)],
  must_not: [keyLine('charge_write', 'Charges', 'Write', 'refund a payment', 'allowed', false),
    keyLine('payout_write', 'Payouts', 'Write', 'send money out of Stripe', 'allowed', false)] } };
const GOOD_KEY = { data: { ...FULL_KEY.data, kind: 'restricted', ok: true, summary: 'A restricted key that can do everything Studio OS needs and nothing it was refused.',
  must_not: FULL_KEY.data.must_not.map((x) => ({ ...x, verdict: 'refused', ok: true })) } };

test.describe('Admin Health Center — the Stripe key (sales item 131)', () => {
  test('the card sits under Money & usage and checks the key only when asked', async ({ page }) => {
    let asked = 0;
    await installApp(page, { api: { '/admin/health-center': HC_KEY, '/admin/stripe-key': () => { asked++; return FULL_KEY; } } });
    await page.goto('/admin-health.html');
    const card = page.locator('#stripeKeyCard');
    await expect(card).toContainText('Studio OS holds a full-power Stripe key');
    await expect(card.locator('.pill')).toHaveText('Needs a look');
    expect(asked).toBe(0);   // opening the page asks Stripe nothing
    await pressButton(card.getByRole('button', { name: 'Check its permissions' }));
    await expect(card.locator('#keyRes')).toContainText('can do 2 things Studio OS never needs');
    await expect(card.locator('li.bad')).toHaveCount(2);
    await expect(card.locator('li.bad').first()).toContainText('Refund a payment. This key can do it.');
    await expect(card.locator('li.ok').first()).toContainText('Prices Write: make the price behind each invoice');
    await expect(card).toContainText('Nothing in Stripe was made or changed.');
    await expect(card.getByRole('button', { name: 'Check again' })).toBeVisible();
    expect(asked).toBe(1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);   // the list wraps on a phone instead of pushing the page sideways
  });

  test('a restricted key that passes reads as all clear, every line ticked', async ({ page }) => {
    await installApp(page, { api: { '/admin/health-center': { data: { overall: 'ok', areas: [{ key: 'stripe_key', label: 'Stripe key', state: 'ok', detail: 'A restricted key that can do only what Studio OS needs. Check its permissions to see each one.' }] } }, '/admin/stripe-key': GOOD_KEY } });
    await page.goto('/admin-health.html');
    await pressButton(page.getByRole('button', { name: 'Check its permissions' }));
    await expect(page.locator('#keyRes .ks')).toHaveText('A restricted key that can do everything Studio OS needs and nothing it was refused.');
    await expect(page.locator('#keyRes li.ok')).toHaveCount(4);
    await expect(page.locator('#keyRes li.bad')).toHaveCount(0);
  });

  test('a check pressed too often says so and keeps the card as it was', async ({ page }) => {
    await installApp(page, { api: { '/admin/health-center': HC_KEY } });
    await page.route('**/functions/v1/presence/admin/stripe-key', (r) => r.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'rate_limited', message: 'That was checked a moment ago. Try again in a few minutes.' }) }));
    await page.goto('/admin-health.html');
    await pressButton(page.getByRole('button', { name: 'Check its permissions' }));
    await expect(page.locator('.toast')).toContainText('checked a moment ago');
    await expect(page.locator('#keyRes')).toBeEmpty();
  });

  test('no key set is Off, with nothing to check', async ({ page }) => {
    await installApp(page, { api: { '/admin/health-center': { data: { overall: 'ok', areas: [{ key: 'stripe_key', label: 'Stripe key', state: 'off', detail: 'No Stripe key is set, so invoices can’t be paid online.' }] } } } });
    await page.goto('/admin-health.html');
    await expect(page.locator('#stripeKeyCard')).toContainText('No Stripe key is set');
    await expect(page.getByRole('button', { name: 'Check its permissions' })).toHaveCount(0);
  });
});

/** Builder item 165: the header's other actions sit in its row on a computer, behind ⋯ on a phone. */
async function openMore(page: import('@playwright/test').Page) {
  const dots = page.locator('header.dds-ph .dds-ph-dots');
  await expect(page.locator('#refreshBtn')).toBeAttached();
  if (await dots.isVisible() && !(await page.locator('#refreshBtn').isVisible())) await dots.click();
}
// ── Item 1 · Family chrome: as-of freshness · ↻ soft refresh keep-last-good ────
test.describe('Admin Health Center — family chrome', () => {
  test('renders an as-of freshness stamp and a refresh control', async ({ page }) => {
    await installApp(page, { api: { '/admin/health-center': HC } });
    await page.goto('/admin-health.html');
    await expect(page.locator('#asof')).toContainText('As of');
    await openMore(page);   // builder item 165: on a phone they wait behind the header's ⋯
    await expect(page.locator('#asof')).toBeVisible();
    await expect(page.locator('#refreshBtn')).toBeVisible();
  });

  test('a failed ↻ soft refresh keeps the last good board and toasts — never wipes it', async ({ page }) => {
    await installApp(page, { api: { '/admin/health-center': HC } });
    await page.goto('/admin-health.html');
    await expect(page.locator('.card.area')).toHaveCount(10);
    // the next read fails — the soft refresh must NOT destroy the good render
    await page.route(HEALTH_GLOB, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
    await openMore(page);
    await page.locator('#refreshBtn').click();
    await expect(page.locator('.toast')).toContainText('Couldn’t refresh');
    await expect(page.locator('.card.area')).toHaveCount(10); // kept, not wiped
  });
});

// ── Item 1 · Distinct, honest failure states (401/403/404/trouble/empty) ──────
test.describe('Admin Health Center — honest states', () => {
  test('401 tells the operator to sign in', async ({ page }) => {
    await installApp(page);
    await page.route(HEALTH_GLOB, (r) => r.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'unauthorized' }) }));
    await page.goto('/admin-health.html');
    await expect(page.getByText('Sign in as an operator.')).toBeVisible();
  });

  test('403 is distinct and honest — operators only, never a blank or a fake all-good', async ({ page }) => {
    await installApp(page);
    await page.route(HEALTH_GLOB, (r) => r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'forbidden' }) }));
    await page.goto('/admin-health.html');
    await expect(page.getByText('Operators only.')).toBeVisible();
    await expect(page.getByText('running normally')).toHaveCount(0); // no fake all-good
    await expect(page.locator('.card.area')).toHaveCount(0);          // not a blank grid of cards either
  });

  test('404 is distinct from a generic hiccup', async ({ page }) => {
    await installApp(page);
    await page.route(HEALTH_GLOB, (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
    await page.goto('/admin-health.html');
    await expect(page.getByText('operations read isn’t available', { exact: false })).toBeVisible();
  });

  test('a generic failure offers Try again, and it recovers in place', async ({ page }) => {
    await installApp(page, { api: { '/admin/health-center': HC } });
    let fail = true;
    await page.route(HEALTH_GLOB, (r) => fail
      ? r.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
      : r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(HC) }));
    await page.goto('/admin-health.html');
    await expect(page.getByText('Couldn’t load the Health Center.')).toBeVisible();
    fail = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('.card.area')).toHaveCount(10);
  });

  test('a 200 with no areas is an honest empty, not a crash', async ({ page }) => {
    await installApp(page, { api: { '/admin/health-center': { data: {} } } });
    await page.goto('/admin-health.html');
    await expect(page.getByText('No health data.')).toBeVisible();
  });
});

// ── Item 5 · Standards: exactly one h1; no horizontal overflow at any width ────
test.describe('Admin Health Center — standards', () => {
  test('there is exactly one h1, and it names the page', async ({ page }) => {
    await installApp(page, { api: { '/admin/health-center': HC } });
    await page.goto('/admin-health.html');
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveText('Health Center');
  });

  test('no horizontal overflow at this viewport', async ({ page }) => {
    await installApp(page, { api: { '/admin/health-center': HC } });
    await page.goto('/admin-health.html');
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('a normal load logs zero console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    await installApp(page, { api: { '/admin/health-center': HC } });
    await page.goto('/admin-health.html');
    await expect(page.locator('.card.area').first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
  });
});

// ── Item 4 · Batch A A11 preserved: the shell theme toggle still flips the page,
//    now re-skinned onto shell.css's canonical --dds-* palette (the hand-copied
//    light values move to the shell's; --off stays the one page-local neutral). ─
test.describe('Admin Health Center — theme blocks (A11, re-skinned onto --dds-*)', () => {
  test('data-theme=dark flips the page tokens; light flips them back', async ({ page }) => {
    await installApp(page, { api: { '/admin/health-center': HC_OK } });
    await page.goto('/admin-health.html');
    const read = (name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    expect(await read('--bg')).toBe('#131120');   // look refresh E (Nov 2026)
    expect(await read('--ok')).toBe('#7fd3a5');   // = shell --dds-good (dark)
    expect(await read('--attn')).toBe('#e3b06b'); // = shell --dds-warn (dark)
    expect(await read('--off')).toBe('#9a92a6');  // page-local neutral (kept)
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    expect(await read('--bg')).toBe('#f3f3f8');
    expect(await read('--ok')).toBe('#11744a');   // = shell --dds-good (light)
    expect(await read('--attn')).toBe('#94530a'); // = shell --dds-warn (light)
    expect(await read('--off')).toBe('#7a7280');  // page-local neutral (kept)
  });
});
