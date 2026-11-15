import { test, expect, type Page } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// Builder list item 230 (Nov 2026), drawn in Figma first (page "Client portal — from the
// Agiled check"): clients sign in with a 6-digit code we email them, always on so nobody is
// locked out. Google and a password are the studio's to add. Five wrong codes and the page
// asks for a new one; a new code can go out once a minute.

const STUDIO_SITE = 'cccccccc-3333-4333-8333-cccccccccccc';
const json = (status: number, body: unknown) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
// the sign-in service: a code of 123456 is right; every call is noted in sessionStorage
const AUTH_STUB = `
window.supabase = { createClient: function () {
  var st = function () { return JSON.parse(sessionStorage.getItem('e2e-auth') || '{"calls":[]}'); };
  var put = function (s) { sessionStorage.setItem('e2e-auth', JSON.stringify(s)); };
  var note = function (c) { var s = st(); s.calls.push(c); put(s); };
  return { auth: {
    getSession: async function () { return { data: { session: st().session || null } }; },
    getUser: async function () { var s = st().session; return { data: { user: s ? s.user : null } }; },
    onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
    signOut: async function () { var s = st(); s.session = null; put(s); return { error: null }; },
    signInWithOtp: async function (o) { note(['otp', o.email, String(!!(o.options && o.options.shouldCreateUser))]); return { data: {}, error: null }; },
    verifyOtp: async function (o) {
      note(['verify', o.token]);
      if (o.token !== '123456') return { data: {}, error: { message: 'Token has expired or is invalid' } };
      var s = st(); s.session = { access_token: 'e2e-token', user: { id: 'e2e-owner', email: o.email } }; put(s);
      return { data: { session: s.session }, error: null };
    },
    signInWithOAuth: async function (o) { note(['oauth', o.provider, (o.options && o.options.redirectTo) || '']); return { data: {}, error: null }; },
  } };
} };`;
const calls = (page: Page) => page.evaluate(() => (JSON.parse(sessionStorage.getItem('e2e-auth') || '{"calls":[]}').calls as string[][]).map((c) => c.join(' ')));

async function door(page: Page, opts: { signin?: Record<string, boolean> | null; google?: boolean } = {}) {
  await installApp(page, { session: null, api: {
    '/public/studio': { data: { name: 'Marlow & Co', logo_url: null, accent: '#8c3b2e', is_default: false, signin: opts.signin === undefined ? { google: false, password: true } : opts.signin } },
    '/portal/context': { data: { landing: '/client.html', site_role: 'business_owner', is_managed_client: true } },
  } });
  await page.route(/@supabase\/supabase-js|\/vendor\/supabase-js/, (r) => r.fulfill({ contentType: 'application/javascript', body: AUTH_STUB }));
  await page.route('**/auth/v1/settings', (r) => r.fulfill(json(200, { external: { email: true, google: !!opts.google } })));
}

test.describe('item 230 — signing in with an emailed code', () => {
  test('the code leads: six boxes, a minute between codes, and never a new account', async ({ page }) => {
    await page.clock.install();
    await door(page);
    await page.goto('/portal.html');
    await expect(page.locator('#emailPanel .sub')).toHaveText('We’ll email you a code. No password to remember.');
    await page.locator('#em').fill('maria@harbor.example');
    await page.getByRole('button', { name: 'Email me a code' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Check your email' })).toBeVisible();
    await expect(page.locator('#codeSub')).toContainText('maria@harbor.example');
    await expect(page.locator('#codePanel .ddsf-boxes span')).toHaveCount(6);
    await expect(page.locator('#code')).toHaveAttribute('autocomplete', 'one-time-code');
    await expect(page.locator('#resend')).toHaveText('Send a new code in 1:00');
    await expect(page.locator('#resend')).toBeDisabled();
    await page.clock.runFor(61_000);
    await expect(page.locator('#resend')).toHaveText('Send a new code');
    await page.locator('#resend').click();
    await expect(page.locator('#resend')).toHaveText(/^Send a new code in 1:00|^Send a new code in 0:5\d$/);
    expect(await calls(page)).toEqual(['otp maria@harbor.example false', 'otp maria@harbor.example false']);
  });

  test('five wrong codes and the page asks for a new one; a new code lets them try again', async ({ page }) => {
    await page.clock.install();
    await door(page);
    await page.goto('/portal.html');
    await page.locator('#em').fill('maria@harbor.example');
    await page.getByRole('button', { name: 'Email me a code' }).click();
    const go = page.locator('#codeGo');
    for (let i = 1; i <= 5; i++) {
      await page.locator('#code').fill('000000');
      await go.click();
      if (i < 5) await expect(page.locator('#errCode')).toContainText('That code didn’t work.');
    }
    await expect(page.locator('#errCode')).toHaveText('That’s five wrong tries. Send a new code to keep going.');
    await expect(go).toBeDisabled();
    await page.clock.runFor(61_000);
    await page.locator('#resend').click();
    await expect(go).toBeEnabled();
    await page.locator('#code').fill('123456');
    await go.click();
    await page.waitForURL(/\/client\.html$/);
  });

  test('Google shows only when the studio turned it on and the sign-in service offers it; the password way follows the studio', async ({ page }) => {
    await door(page, { signin: { google: true, password: false }, google: true });
    await page.goto(`/portal.html?studio=${STUDIO_SITE}`);
    const g = page.getByRole('button', { name: 'Continue with Google' });
    await expect(g).toBeVisible();
    await expect(page.locator('#orRule')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Use a password instead' })).toBeHidden();
    await g.click();
    await expect.poll(() => calls(page)).toEqual([`oauth google http://127.0.0.1:4694/portal.html?studio=${STUDIO_SITE}`]);

    await page.goto('about:blank');
    await door(page, { signin: { google: true, password: true }, google: false });
    await page.goto(`/portal.html?studio=${STUDIO_SITE}`);
    await expect(page.getByRole('button', { name: 'Use a password instead' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeHidden();   // the service doesn't offer it yet
  });

  test('with no studio named, the code and a password, and no Google', async ({ page }) => {
    await door(page, { signin: null });
    await page.goto('/portal.html');
    await expect(page.getByRole('button', { name: 'Email me a code' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Use a password instead' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeHidden();
  });
});

// ── Settings › Client portal › How clients sign in ──
const AGENCY_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, attention_stale: false, scope: null,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'], landing: '/agency.html', attention_count: 4, nav: STUDIO_NAV,
} };
const SETTINGS_API = {
  '/identity': { data: { site_id: 'own', business_name: 'Brightline Studio', email: 'hello@brightline.example' } },
  '/settings': { data: { industry_key: 'salon' } },
  '/agency/nav': { data: { hidden: [], choices: [], can_edit: true } },
};
const PORTALSET = { data: { off: [], welcome: '', home_off: [], signin: { google: false, password: true }, parts: [], cards: [], welcome_max: 500, can_edit: true, clients: [] } };
async function settings(page: Page, google: boolean) {
  await installApp(page, { api: { ...SETTINGS_API, '/portal/context': AGENCY_CTX, '/agency/portal': PORTALSET } });
  await page.route('**/auth/v1/settings', (r) => r.fulfill(json(200, { external: { email: true, google } })));
  const puts: unknown[] = [];
  await page.route(/\/functions\/v1\/presence\/agency\/portal$/, (r) => {
    if (r.request().method() !== 'PUT') return r.fallback();
    const b = r.request().postDataJSON(); puts.push(b);
    return r.fulfill(json(200, { data: { off: [], welcome: '', home_off: [], signin: { google: false, password: true, ...(b.signin ? { [b.signin.key]: b.signin.on } : {}) } } }));
  });
  await page.goto('/settings.html#portalParts');
  await expect(page.locator('#portalSignIn')).toBeVisible();
  return puts;
}

test.describe('item 230 — Settings › How clients sign in', () => {
  test('the emailed code is always on; Google waits for the service; a password switches off', async ({ page }) => {
    const puts = await settings(page, false);
    const card = page.locator('#portalSignIn');
    await expect(card.getByRole('heading', { name: 'How clients sign in' })).toBeVisible();
    const code = card.getByRole('switch', { name: /^Emailed code/ });
    await expect(code).toHaveAttribute('aria-checked', 'true');
    await expect(code).toHaveAttribute('aria-disabled', 'true');
    await expect(card.locator('[data-signin="code"] .pchip')).toHaveText('Always on');
    await expect(card.locator('[data-signin="google"]')).toContainText('Not available yet');
    await expect(card.getByRole('switch', { name: /^Google/ })).toHaveAttribute('aria-disabled', 'true');
    const pw = card.getByRole('switch', { name: /^Password/ });
    await expect(pw).toHaveAttribute('aria-checked', 'true');
    await pw.click();
    await expect.poll(() => puts.length).toBe(1);
    expect(puts[0]).toEqual({ signin: { key: 'password', on: false } });
    await expect(pw).toHaveAttribute('aria-checked', 'false');
  });

  test('once the service offers Google, the studio can turn it on', async ({ page }) => {
    const puts = await settings(page, true);
    const g = page.locator('#portalSignIn').getByRole('switch', { name: /^Google/ });
    await expect(g).not.toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('[data-signin="google"]')).toContainText('Shows “Continue with Google” on your clients’ sign-in page.');
    await g.click();
    await expect.poll(() => puts.length).toBe(1);
    expect(puts[0]).toEqual({ signin: { key: 'google', on: true } });
  });
});
