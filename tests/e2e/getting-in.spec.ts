import { test, expect, type Page } from '@playwright/test';
import { installApp, OWNER_SESSION } from './helpers/app';

// Builder item 192 (Nov 12 2026 review, file 06, findings 6, 41, 45 and 103): getting in.
//   · after a new password the page asks the server who the person is and signs them in
//     at the right door, client or studio;
//   · the portal says "code", which is what the reset email holds, not "link";
//   · the studio's sign-in page takes you on to the page you came for;
//   · after Sign out from the "not set up" panel the Sign in button works again;
//   · the new-password page's help line points at the person's own studio.
// The sign-in service is a stand-in: no mailbox, no real account.

const STUDIO_REALM = 'dds-portal-auth', CLIENT_REALM = 'dds-client-auth';
const BASE = { site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ['website'], capabilities: ['view_all'], attention_count: 0, nav: [] };
const CLIENT_CTX = { data: { ...BASE, is_agency: false, is_operator: false, sees_full_workspace: true, is_managed_client: true, landing: '/client.html' } };
const OWNER_CTX = { data: { ...BASE, is_agency: false, is_operator: false, sees_full_workspace: true, is_managed_client: false, landing: '/today.html' } };

/** A stand-in for the sign-in library that keeps what the real one keeps: the session,
 *  saved in localStorage under the name the page asked for. */
async function fakeSignIn(page: Page) {
  await page.route(/\/vendor\/supabase-js/, (route) => route.fulfill({ contentType: 'application/javascript', body: `
    window.supabase = { createClient: function (_u, _k, o) {
      var key = (o && o.auth && o.auth.storageKey) || 'none';
      var SESSION = ${JSON.stringify(OWNER_SESSION)};
      var read = function () { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } };
      var signIn = function () { localStorage.setItem(key, JSON.stringify(SESSION)); return { data: { session: SESSION, user: SESSION.user }, error: null }; };
      return { auth: {
        getSession: async function () { return { data: { session: read() } }; },
        onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
        verifyOtp: async function () { return signIn(); },
        signInWithPassword: async function () { return signIn(); },
        updateUser: async function () { return { data: { user: SESSION.user }, error: null }; },
        resetPasswordForEmail: async function () { return { data: {}, error: null }; },
        signOut: async function () { localStorage.removeItem(key); return { error: null }; },
      } };
    } };` }));
}
const whoami = (page: Page, isTeam: boolean) => page.route('**/functions/v1/clever-api', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ role: isTeam ? 'admin' : null, isTeam }) }));
const saved = (page: Page) => page.evaluate(([a, b]) => ({ studio: !!localStorage.getItem(a), client: !!localStorage.getItem(b) }), [STUDIO_REALM, CLIENT_REALM]);
async function setPassword(page: Page) {
  await page.locator('#em').fill('pat@example.com');
  await page.locator('#code').fill('123456');
  await page.locator('#pw').fill('a long enough password');
  await page.locator('#pw2').fill('a long enough password');
  await page.locator('#saveBtn').click();
}
/** Stop at the door the page sends the person to, and say which it was. */
async function doorReached(page: Page): Promise<string> {
  let went = '';
  await page.route(/\/(portal|studio|client|today|agency|get-started)\.html(\?.*)?$/, (route) => {
    went = new URL(route.request().url()).pathname;
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>door</title><p id="door">door</p>' });
  });
  await expect.poll(() => went, { timeout: 10_000 }).not.toBe('');
  await expect(page.locator('#door')).toBeVisible();
  return went;
}

test.describe('Getting in (builder item 192)', () => {
  test('a client who typed the address from the reset email: signed in on the client’s side, at the client door', async ({ page }) => {
    await installApp(page, { session: null, api: { '/portal/context': CLIENT_CTX } });
    await fakeSignIn(page); await whoami(page, false);
    await page.goto('/set-password.html');
    await setPassword(page);
    await expect(page.locator('#okBox')).toContainText('Taking you into your portal');
    expect(await doorReached(page)).toBe('/portal.html');
    expect(await saved(page)).toEqual({ studio: false, client: true });
  });

  test('another studio’s owner who reset a password: the studio door, signed in on the studio’s side', async ({ page }) => {
    await installApp(page, { session: null, api: { '/portal/context': OWNER_CTX } });
    await fakeSignIn(page); await whoami(page, false);   // not one of the platform's own staff
    await page.goto('/set-password.html');
    await setPassword(page);
    await expect(page.locator('#okBox')).toContainText('Taking you into Studio OS');
    expect(await doorReached(page)).toBe('/studio.html');
    expect(await saved(page)).toEqual({ studio: true, client: false });
  });

  test('an invite link that names its page still decides, and the server could not be asked: nothing moves', async ({ page }) => {
    await installApp(page, { session: null, api: {} });
    await page.route('**/functions/v1/presence/portal/context', (r) => r.abort());
    await page.route('**/functions/v1/presence/agency/me', (r) => r.abort());
    await page.route('**/functions/v1/clever-api', (r) => r.abort());
    await fakeSignIn(page);
    await page.goto('/set-password.html?next=/client.html');
    await setPassword(page);
    expect(await doorReached(page)).toBe('/client.html');
    expect(await saved(page)).toEqual({ studio: false, client: true });
  });

  test('the help line: never one studio’s own address; a client is pointed at their studio by name', async ({ page }) => {
    await installApp(page, { session: null, api: {} });
    await fakeSignIn(page);
    await page.goto('/set-password.html');
    await expect(page.locator('.login-note')).toHaveText('Need a hand? Ask whoever invited you, or start again from the sign-in page.');
    await expect(page.locator('.login-note a')).toHaveAttribute('href', '/studio.html');
    expect(await page.locator('a[href^="mailto:"]').count()).toBe(0);
    // this browser has been in a studio's client portal
    await page.evaluate(() => localStorage.setItem('dds-studio-brand', JSON.stringify({ name: 'Juniper Web Co.', logo_url: null, accent: '#23635a' })));
    await page.goto('/set-password.html');
    await expect(page.locator('.login-note')).toHaveText('Need a hand? Ask Juniper Web Co., or start again from the sign-in page.');
    await expect(page.locator('.login-note a')).toHaveAttribute('href', '/portal.html');
    await page.goto('/set-password.html?next=/portal.html');
    await expect(page.locator('.login-note')).toContainText('Ask Juniper Web Co.');
  });

  test('the client door says "code": the reset panel, its way on to the code page, and the sign-in email', async ({ page }) => {
    await installApp(page, { session: null, api: {} });
    await fakeSignIn(page);
    await page.goto('/portal.html');
    await expect(page.locator('#codeSub')).toContainText('Enter its 6-digit code below');
    await page.locator('#toPw').click();
    await page.locator('#empw').fill('pat@example.com');
    await page.locator('#forgot').click();
    await expect(page.locator('#resetSent')).toBeVisible();
    await expect(page.locator('#resetSent')).toContainText('a code is on its way');
    await expect(page.locator('#resetSent')).not.toContainText('link');
    await expect(page.locator('#haveCode')).toHaveAttribute('href', '/set-password.html?next=/portal.html');
    await page.locator('#haveCode').click();
    await expect(page).toHaveURL(/\/set-password(\.html)?\?next=\/portal\.html$/);
    await expect(page.locator('#em')).toHaveValue('pat@example.com');   // the address typed a moment ago
  });

  test('the studio door says "code" too, and Sign in works again after Sign out from the "not set up" panel', async ({ page }) => {
    // signed in, but this account runs no workspace and is no one's team
    await installApp(page, { session: null, api: {} });
    await page.route('**/functions/v1/presence/portal/context', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'no_site' }) }));
    await page.route('**/functions/v1/presence/agency/me', (r) => r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'forbidden' }) }));
    await fakeSignIn(page); await whoami(page, false);
    await page.goto('/studio.html');
    await page.evaluate(() => (window as unknown as { show: (id: string) => void }).show('resetSent'));
    await expect(page.locator('#resetSent')).toContainText('a code is on its way');
    await expect(page.locator('#resetSent')).not.toContainText('link');
    await expect(page.locator('#haveCode')).toHaveAttribute('href', '/set-password.html');
    await page.locator('#backToLogin').click();
    await page.locator('#em').fill('pat@example.com');
    await page.locator('#pw').fill('a long enough password');
    await page.locator('#go').click();
    await expect(page.locator('#noWorkspace')).toBeVisible();
    await page.locator('#signout1').click();
    await expect(page.locator('#loginPanel')).toBeVisible();
    await expect(page.locator('#go')).toBeEnabled();
    await expect(page.locator('#go')).toHaveText('Sign in');
  });

  test('signing in at the studio door takes you on to the page you came for, once', async ({ page }) => {
    await installApp(page, { session: null, api: { '/portal/context': OWNER_CTX } });
    await fakeSignIn(page); await whoami(page, false);
    // a studio page finds nobody signed in and leaves its address behind
    await page.goto('/crm.html?client=abc#notes');
    await expect(page.getByRole('link', { name: 'Sign in →' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('dds-studio-return') || 'null')?.path)).toBe('/crm.html?client=abc#notes');
    let went = '';
    await page.route(/\/(crm|today|client)\.html/, (route) => { const u = new URL(route.request().url()); went = u.pathname + u.search; return route.fulfill({ contentType: 'text/html', body: '<!doctype html><p id="door">door</p>' }); });
    await page.goto('/studio.html');
    await page.locator('#em').fill('pat@example.com');
    await page.locator('#pw').fill('a long enough password');
    await page.locator('#go').click();
    await expect(page.locator('#door')).toBeVisible();
    expect(went).toBe('/crm.html?client=abc');
    expect(new URL(page.url()).hash).toBe('#notes');
    expect(await page.evaluate(() => localStorage.getItem('dds-studio-return'))).toBeNull();
  });

  test('an old breadcrumb, another site’s address or a sign-in page is ignored; a client keeps their own landing', async ({ page }) => {
    test.slow();   // six sign-ins in a row
    await installApp(page, { session: null, api: { '/portal/context': OWNER_CTX } });
    await fakeSignIn(page); await whoami(page, false);
    let went = '';
    await page.route(/\/(crm|today|client|pipeline)\.html/, (route) => { went = new URL(route.request().url()).pathname; return route.fulfill({ contentType: 'text/html', body: '<!doctype html><p id="door">door</p>' }); });
    await page.goto('/studio.html');
    const signInWith = async (crumb: unknown) => {
      went = '';
      await page.evaluate(([c, k]) => { localStorage.removeItem(k as string); localStorage.setItem('dds-studio-return', JSON.stringify(c)); }, [crumb, STUDIO_REALM]);
      await page.goto('/studio.html');
      await page.locator('#em').fill('pat@example.com');
      await page.locator('#pw').fill('a long enough password');
      await page.locator('#go').click();
      await expect(page.locator('#door')).toBeVisible();
      return went;
    };
    expect(await signInWith({ path: '/pipeline.html?deal=1', at: Date.now() - 31 * 60000 })).toBe('/today.html');      // over half an hour old
    expect(await signInWith({ path: 'https://elsewhere.example/pipeline.html', at: Date.now() })).toBe('/today.html');  // not this app
    expect(await signInWith({ path: '//elsewhere.example/pipeline.html', at: Date.now() })).toBe('/today.html');
    expect(await signInWith({ path: '/portal.html', at: Date.now() })).toBe('/today.html');                             // a door, not a page
    expect(await signInWith({ path: '/pipeline.html?deal=1', at: Date.now() })).toBe('/pipeline.html');                 // a fresh one of ours
    // a client who signs in at the studio door follows their own landing, never a studio page
    await page.unroute('**/functions/v1/presence/**');
    await installApp(page, { session: null, api: { '/portal/context': { data: { ...CLIENT_CTX.data, is_managed_client: true, sees_full_workspace: false } } } });
    await fakeSignIn(page);
    expect(await signInWith({ path: '/pipeline.html?deal=1', at: Date.now() })).toBe('/client.html');
  });
});
