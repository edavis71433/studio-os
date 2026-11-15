import { test, expect, Page } from '@playwright/test';
import { installApp, OWNER_SESSION } from './helpers/app';

// ── Builder item 213: Growth uses the studio's sign-in ──────────────────────
// admin-growth.html kept its own email-and-password form and its own stored
// sign-in, so Eric typed his password again and signing out of the studio left
// Growth signed in. Now the page reads the studio's sign-in ('dds-portal-auth',
// the key studio.html and every studio page use), sends a signed-out visit to the
// studio's sign-in page with this address left behind for the way back
// ('dds-studio-return', builder item 192), and its Sign out is the studio's.

const FN_GLOB = '**/functions/v1/clever-api';

/** Record the options the page hands createClient (the harness's stub ignores them),
 *  and mark a sign-out in sessionStorage, which outlives the page it happened on. */
async function recordClientOptions(page: Page) {
  await page.addInitScript(() => {
    type Client = { auth: { signOut: () => Promise<unknown> } };
    let real: unknown;
    Object.defineProperty(window, 'supabase', {
      configurable: true,
      get() { return real; },
      set(v: { createClient: (...a: unknown[]) => Client }) {
        real = { ...v, createClient: (...a: unknown[]) => {
          (window as unknown as { __E2E_CLIENT_OPTS: unknown }).__E2E_CLIENT_OPTS = a[2];
          const c = v.createClient(...a);
          const out = c.auth.signOut.bind(c.auth);
          c.auth.signOut = () => { sessionStorage.setItem('e2e-signed-out', '1'); return out(); };
          return c;
        } };
      },
    });
  });
}

/** The old server's answers for the requests Growth sends; records each kind asked. */
async function oldServer(page: Page, who: Record<string, unknown>) {
  const asked: string[] = [];
  await page.route(FN_GLOB, (route) => {
    const body = route.request().postDataJSON() || {};
    asked.push(String(body.type));
    const answers: Record<string, unknown> = {
      whoami: who,
      partnership_dashboard: { data: { counts: { activeClients: 2, mrr: 800 }, bySegment: {}, needsReview: [], renewals: [], atRisk: [] } },
    };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answers[body.type] ?? { data: [] }) });
  });
  return asked;
}

test.describe('Growth: one sign-in with the studio', () => {
  test('signed out: no password form, a way to the studio sign-in, and the way back left behind', async ({ page }) => {
    await recordClientOptions(page);
    await installApp(page, { session: null });
    const asked = await oldServer(page, { role: null, isTeam: false });
    await page.goto('/admin-growth.html');
    await expect(page.locator('#gate')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sign in to your studio' })).toBeVisible();
    await expect(page.locator('#gate input[type="password"]')).toHaveCount(0);
    await expect(page.locator('#gateSignIn')).toHaveAttribute('href', '/studio.html');
    const back = await page.evaluate(() => JSON.parse(localStorage.getItem('dds-studio-return') || 'null'));
    expect(back && back.path).toBe('/admin-growth.html');
    expect(asked).toEqual([]);   // nothing is asked of the server without a sign-in
    const opts = await page.evaluate(() => (window as unknown as { __E2E_CLIENT_OPTS: { auth: Record<string, unknown> } }).__E2E_CLIENT_OPTS);
    expect(opts.auth.storageKey).toBe('dds-portal-auth');
  });

  test('signed in to the studio: Growth opens without asking again', async ({ page }) => {
    await recordClientOptions(page);
    await installApp(page, { session: OWNER_SESSION });
    const asked = await oldServer(page, { role: 'owner', isTeam: true, email: 'owner@example.com' });
    await page.goto('/admin-growth.html');
    await expect(page.locator('#app')).toBeVisible();
    await expect(page.locator('#gate')).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Growth dashboard' })).toBeVisible();
    await expect(page.locator('#whoEmail')).toHaveText('owner@example.com');
    expect(asked.slice(0, 2)).toEqual(['whoami', 'partnership_dashboard']);
    const opts = await page.evaluate(() => (window as unknown as { __E2E_CLIENT_OPTS: { auth: Record<string, unknown> } }).__E2E_CLIENT_OPTS);
    expect(opts.auth.storageKey).toBe('dds-portal-auth');
  });

  test('Sign out is the studio’s: the shared sign-in ends and the studio sign-in page opens', async ({ page }) => {
    await recordClientOptions(page);
    await installApp(page, { session: OWNER_SESSION });
    await oldServer(page, { role: 'owner', isTeam: true, email: 'owner@example.com' });
    await page.route('**/studio.html', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Studio sign-in</title><p>studio sign-in</p>' }));
    await page.goto('/admin-growth.html');
    await expect(page.locator('#app')).toBeVisible();
    const signOut = page.locator(await page.locator('#signOut').isVisible() ? '#signOut' : '#signOutM');
    await signOut.click();
    await expect(page).toHaveURL(/\/studio\.html$/);
    expect(await page.evaluate(() => sessionStorage.getItem('e2e-signed-out'))).toBe('1');
  });

  test('signed in, but not on the studio team: says so and leaves no way back to loop on', async ({ page }) => {
    await installApp(page, { session: OWNER_SESSION });
    await oldServer(page, { role: null, isTeam: false });
    await page.goto('/admin-growth.html');
    await expect(page.locator('#gateMsg')).toHaveText('This page is for the studio team, and this account isn’t on it.');
    await expect(page.locator('#gateSignIn')).toHaveText('Go to your workspace');
    expect(await page.evaluate(() => localStorage.getItem('dds-studio-return'))).toBeNull();
  });
});
