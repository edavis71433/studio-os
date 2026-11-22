import { test, expect, type Page } from '@playwright/test';
import { installApp } from './helpers/app';

// Builder list item 338 (Nov 22 2026): a team member invited by link (a Staff, Designer or
// Developer seat) has no password, and the studio door took only email + password, so on
// their second visit they had to go through "Forgot your password?". Now the door has a
// second way in beside the password, the client door's way (item 230): "Email me a code"
// sends a 6-digit code, "Check the code" checks it, and the sign-in lands where a password
// sign-in lands. A new code can go out once a minute; five wrong codes ask for a new one.
// The password path is untouched.

const json = (status: number, body: unknown) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const BASE = { site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ['website'], capabilities: ['view_all'], attention_count: 0, nav: [] };
const OWNER_CTX = { data: { ...BASE, is_agency: false, is_operator: false, sees_full_workspace: true, is_managed_client: false, landing: '/today.html' } };

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
    signInWithPassword: async function (o) { note(['password', o.email]); return { data: {}, error: { message: 'Invalid login credentials' } }; },
    signInWithOtp: async function (o) { note(['otp', o.email, String(!!(o.options && o.options.shouldCreateUser)), (o.options && o.options.emailRedirectTo) || '']); return { data: {}, error: null }; },
    verifyOtp: async function (o) {
      note(['verify', o.email, o.token, o.type]);
      if (o.token !== '123456') return { data: {}, error: { message: 'Token has expired or is invalid' } };
      var s = st(); s.session = { access_token: 'e2e-token', user: { id: 'e2e-staff', email: o.email } }; put(s);
      return { data: { session: s.session }, error: null };
    },
  } };
} };`;
const calls = (page: Page) => page.evaluate(() => (JSON.parse(sessionStorage.getItem('e2e-auth') || '{"calls":[]}').calls as string[][]).map((c) => c.join(' ')));

/** The studio door, signed out, with the sign-in service stood in for. Says where the
 *  page went after signing in (the landing is a stub page, not the real one). */
async function door(page: Page) {
  await installApp(page, { session: null, api: { '/portal/context': OWNER_CTX } });
  await page.route(/@supabase\/supabase-js|\/vendor\/supabase-js/, (r) => r.fulfill({ contentType: 'application/javascript', body: AUTH_STUB }));
  await page.route('**/auth/v1/settings', (r) => r.fulfill(json(200, { external: { email: true, google: false } })));
  const went: string[] = [];
  await page.route(/\/(today|agency|client)\.html(\?.*)?$/, (r) => { const u = new URL(r.request().url()); went.push(u.pathname + u.search); return r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>door</title><p id="door">door</p>' }); });
  return went;
}

test.describe('item 338 — the studio door emails a code', () => {
  test('the code button sits beside the password; pressing it with an email asks for a code and shows the six boxes', async ({ page }) => {
    await page.clock.install();
    const errors: string[] = []; page.on('pageerror', (e) => errors.push(String(e)));
    await door(page);
    await page.goto('/studio.html');
    const send = page.getByRole('button', { name: 'Email me a code' });
    await expect(send).toBeVisible();
    await expect(page.locator('#go')).toHaveText('Sign in');                               // the password way is still the first
    await expect(page.locator('#forgot')).toBeVisible();

    // no email yet: a plain message, no request
    await send.click();
    await expect(page.locator('#err')).toHaveText('Type your email above first, then tap “Email me a code” again.');
    expect(await calls(page)).toEqual([]);

    await page.locator('#em').fill('sam@marlow.example');
    await send.click();
    await expect(page.locator('#codePanel')).toBeVisible();
    await expect(page.locator('#loginPanel')).toBeHidden();
    await expect(page.locator('h1')).toHaveCount(1);                                     // the page keeps its one heading
    await expect(page.locator('#codeHead')).toHaveText('Check your email');
    await expect(page.locator('#codeSub')).toContainText('sam@marlow.example');
    await expect(page.locator('#codePanel .ddsf-boxes span')).toHaveCount(6);
    await expect(page.locator('#code')).toHaveAttribute('autocomplete', 'one-time-code');
    await expect(page.locator('#codeGo')).toHaveText('Check the code');
    const origin = new URL(page.url()).origin;
    expect(await calls(page)).toEqual([`otp sam@marlow.example false ${origin}/studio.html`]);   // never makes an account

    // a new code waits a minute
    await expect(page.locator('#resend')).toHaveText('Send a new code in 1:00');
    await expect(page.locator('#resend')).toBeDisabled();
    await page.clock.runFor(61_000);
    await expect(page.locator('#resend')).toHaveText('Send a new code');
    await expect(page.locator('#resend')).toBeEnabled();
    await page.locator('#resend').click();
    await expect(page.locator('#resend')).toHaveText(/^Send a new code in 1:00|^Send a new code in 0:5\d$/);
    expect((await calls(page)).length).toBe(2);
    expect(errors).toEqual([]);
  });

  test('a wrong code says so plainly; the right one signs in and lands where a password sign-in lands', async ({ page }) => {
    const went = await door(page);
    await page.goto('/studio.html');
    await page.locator('#em').fill('sam@marlow.example');
    await page.getByRole('button', { name: 'Email me a code' }).click();
    await expect(page.locator('#codePanel')).toBeVisible();

    // too short
    await page.locator('#code').fill('123');
    await page.locator('#codeGo').click();
    await expect(page.locator('#errCode')).toHaveText('Type all six digits from your email.');

    // wrong
    await page.locator('#code').fill('000000');
    await page.locator('#codeGo').click();
    await expect(page.locator('#errCode')).toHaveText('That code didn’t work. It may have expired: check the latest email, or send a new code.');
    await expect(page.locator('#codeGo')).toBeEnabled();
    await expect(page.locator('#codeGo')).toHaveText('Check the code');
    await expect(page.locator('#code')).toHaveValue('');                                  // the boxes are cleared for another go

    // right: the same landing a password sign-in gets (/portal/context says /today.html)
    await page.locator('#code').fill('123456');
    await page.locator('#codeGo').click();
    await expect(page.locator('#door')).toBeVisible();
    expect(went).toEqual(['/today.html']);
    expect((await calls(page)).filter((c) => c.startsWith('verify'))).toEqual(['verify sam@marlow.example 000000 email', 'verify sam@marlow.example 123456 email']);
  });

  test('five wrong codes and the page asks for a new one; a new code lets them try again', async ({ page }) => {
    await page.clock.install();
    await door(page);
    await page.goto('/studio.html');
    await page.locator('#em').fill('sam@marlow.example');
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
    await expect(page.locator('#errCode')).toBeHidden();
  });

  test('"Use a password instead" goes back to the password form, which still works as before', async ({ page }) => {
    await door(page);
    await page.goto('/studio.html');
    await page.locator('#em').fill('sam@marlow.example');
    await page.getByRole('button', { name: 'Email me a code' }).click();
    await expect(page.locator('#codePanel')).toBeVisible();
    await page.getByRole('button', { name: 'Use a password instead' }).click();
    await expect(page.locator('#loginPanel')).toBeVisible();
    await expect(page.locator('#em')).toHaveValue('sam@marlow.example');                   // the address typed a moment ago
    await page.locator('#pw').fill('not the password');
    await page.locator('#go').click();
    await expect(page.locator('#err')).toContainText('That email or password isn’t right.');
    expect((await calls(page)).filter((c) => c.startsWith('password'))).toEqual(['password sam@marlow.example']);
  });

  test('at phone width every control is at least 44px tall', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await door(page);
    await page.goto('/studio.html');
    const tall = async (sel: string) => {
      const b = await page.locator(sel).boundingBox();
      expect(b, sel).not.toBeNull();
      expect(b!.height, `${sel} is ${b!.height}px tall`).toBeGreaterThanOrEqual(44);
    };
    for (const sel of ['#em', '#pw', '#go', '#forgot', '#codeSend']) await tall(sel);
    await page.locator('#em').fill('sam@marlow.example');
    await page.getByRole('button', { name: 'Email me a code' }).click();
    await expect(page.locator('#codePanel')).toBeVisible();
    for (const sel of ['#codePanel .ddsf-code', '#codeGo', '#resend', '#toLogin', '#codePanel .qbtn >> nth=0']) await tall(sel);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});
