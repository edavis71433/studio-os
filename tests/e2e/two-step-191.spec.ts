import { test, expect, Page } from '@playwright/test';
import { installApp } from './helpers/app';

// ── Two-step sign-in and fresh codes (builder list item 191) ─────────────────
// Drawn in Figma first (page "Two-step sign-in and fresh codes — item 191"): A the
// sign-in's second step, B turning it on (Settings, the set-up sheet, Home's nudge),
// C a fresh code before the risky things. Two-step sign-in is Supabase's own app codes,
// so these tests swap supabase-js for a stand-in that keeps the person's factors and
// the sign-in's level (aal1, or aal2 once the app's code was typed) in sessionStorage,
// so they last from page to page. The one good app code is 482913.

const GOOD = '482913';
const ON_FACTOR = { id: 'f-1', factor_type: 'totp', status: 'verified', friendly_name: '', created_at: '2026-11-12T15:00:00Z', updated_at: '2026-11-12T15:00:00Z' };
interface TwoStepState { signedIn: boolean; aal: string; factors: Array<Record<string, unknown>>; calls?: unknown[][] }

const MFA_STUB = `
(function () {
  var KEY = 'e2e-2step';
  function load() { try { var v = JSON.parse(sessionStorage.getItem(KEY) || 'null'); if (v) return v; } catch (e) {} return JSON.parse(JSON.stringify(window.__E2E_2STEP_INIT || { signedIn: true, aal: 'aal1', factors: [] })); }
  function save(st) { try { sessionStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }
  function note(st, c) { st.calls = (st.calls || []).concat([c]); }
  // the token says how far the sign-in went (aal) and when the app's code was last typed (amr)
  function jwt(st) { return 'e30.' + btoa(JSON.stringify({ sub: 'e2e-owner', aal: st.aal, amr: st.codedAt ? [{ method: 'totp', timestamp: st.codedAt }] : [{ method: 'password', timestamp: 1 }] })) + '.sig'; }
  function sess(st) { var base = window.__E2E_SESSION; if (!base || !st.signedIn) return null; return Object.assign({}, base, { access_token: jwt(st), user: Object.assign({}, base.user, { factors: st.factors }) }); }
  function verified(st) { return st.factors.some(function (f) { return f.status === 'verified'; }); }
  var NOW = '2026-11-12T15:00:00Z';
  window.supabase = { createClient: function () {
    var heard = [];
    function tell(ev) { var s = sess(load()); heard.forEach(function (f) { try { f(ev, s); } catch (e) {} }); }
    return { auth: {
      getSession: async function () { return { data: { session: sess(load()) } }; },
      getUser: async function () { var s = sess(load()); return { data: { user: s ? s.user : null }, error: null }; },
      onAuthStateChange: function (f) { heard.push(f); return { data: { subscription: { unsubscribe: function () {} } } }; },
      signOut: async function () { var st = load(); st.signedIn = false; st.aal = 'aal1'; save(st); return { error: null }; },
      refreshSession: async function () { return { data: { session: sess(load()) }, error: null }; },
      signInWithPassword: async function (p) { var st = load(); st.signedIn = true; st.aal = 'aal1'; note(st, ['password', p.email]); save(st); return { data: { session: sess(st) }, error: null }; },
      signInWithOtp: async function () { return { data: {}, error: null }; },
      verifyOtp: async function (p) { var st = load(); st.signedIn = true; st.aal = 'aal1'; note(st, ['otp', p.type]); save(st); return { data: { session: sess(st) }, error: null }; },
      resetPasswordForEmail: async function () { return { data: {}, error: null }; },
      updateUser: async function () {
        var st = load();
        if (verified(st) && st.aal !== 'aal2') return { data: null, error: { status: 403, code: 'insufficient_aal', message: 'AAL2 session is required to update email or password when MFA is enabled.' } };
        note(st, ['password-set']); save(st); return { data: {}, error: null };
      },
      mfa: {
        getAuthenticatorAssuranceLevel: async function () { var st = load(); return { data: { currentLevel: st.aal, nextLevel: verified(st) ? 'aal2' : st.aal, currentAuthenticationMethods: [] }, error: null }; },
        listFactors: async function () { var st = load(); return { data: { all: st.factors, totp: st.factors.filter(function (f) { return f.factor_type === 'totp' && f.status === 'verified'; }), phone: [] }, error: null }; },
        enroll: async function (p) {
          var st = load(); var id = 'f-new-' + (st.calls || []).length;
          st.factors.push({ id: id, factor_type: 'totp', status: 'unverified', friendly_name: '', created_at: NOW, updated_at: NOW }); note(st, ['enroll', p.factorType, p.issuer || '']); save(st);
          return { data: { id: id, type: 'totp', totp: { qr_code: 'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="29" height="29"><rect width="29" height="29"/></svg>', secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/Studio%20OS:owner@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Studio%20OS' } }, error: null };
        },
        challengeAndVerify: async function (p) {
          var st = load(); note(st, ['verify', p.factorId, p.code]);
          var f = st.factors.filter(function (x) { return x.id === p.factorId; })[0];
          if (!f) { save(st); return { data: null, error: { status: 404, code: 'mfa_factor_not_found', message: 'Factor not found' } }; }
          if (p.code !== '${GOOD}') { save(st); return { data: null, error: { status: 422, code: 'mfa_verification_failed', message: 'Invalid TOTP code entered' } }; }
          f.status = 'verified'; st.aal = 'aal2'; st.codedAt = Math.floor(Date.now() / 1000); save(st); tell('MFA_CHALLENGE_VERIFIED'); return { data: {}, error: null };
        },
        unenroll: async function (p) { var st = load(); st.factors = st.factors.filter(function (x) { return x.id !== p.factorId; }); note(st, ['unenroll', p.factorId]); save(st); return { data: { id: p.factorId }, error: null }; },
      },
    } };
  } };
})();
`;

/** Swap in the two-step stand-in (after installApp, so its route wins) with this starting state. */
async function twoStep(page: Page, init: TwoStepState) {
  await page.addInitScript((i) => { (window as unknown as { __E2E_2STEP_INIT: unknown }).__E2E_2STEP_INIT = i; }, init);
  await page.route(/@supabase\/supabase-js|\/vendor\/supabase-js/, (route) => route.fulfill({ contentType: 'application/javascript', body: MFA_STUB }));
}
const state = (page: Page) => page.evaluate(() => JSON.parse(sessionStorage.getItem('e2e-2step') || 'null') as TwoStepState | null);
const calls = async (page: Page) => ((await state(page))?.calls || []).map((c) => c.join(' '));
async function noSidewaysScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}
/** Type into the six boxes the way a person does: one digit at a time. */
async function typeCode(page: Page, scope: string, code: string) {
  const input = page.locator(`${scope} .ddsf-code input`);
  await input.click();
  await input.pressSequentially(code, { delay: 20 });
}

test.describe('Two-step sign-in (builder item 191)', () => {
  test('Settings: Sign-in and security is off, the set-up sheet turns it on with the first code, Turn off asks the app first', async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', (e) => errors.push(String(e)));
    await installApp(page, {});
    await twoStep(page, { signedIn: true, aal: 'aal1', factors: [] });
    await page.goto('/settings.html');
    const sec = page.locator('#security');
    await expect(sec.getByRole('heading', { name: 'Sign-in and security' })).toBeVisible();
    await expect(sec.locator('#tsPill')).toHaveText('Off');
    await expect(sec.locator('#tsLine')).toHaveText('Signing in asks for a 6-digit code from an app on your phone, as well as your password. Someone with only your password can’t get in.');
    await expect(sec.locator('.tsalerts')).toContainText('These can’t be switched off.');
    await expect(page.locator('[data-card="security"]')).toContainText('Two-step sign-in is off');

    // B2: the sheet, its square and key; Cancel takes the half-made set-up off again
    await sec.getByRole('button', { name: 'Turn on two-step sign-in' }).click();
    let sheet = page.getByRole('dialog', { name: 'Turn on two-step sign-in' });
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('.ddss-qr img')).toHaveAttribute('src', /^data:image\/svg\+xml/);
    await expect(sheet.locator('#dds-2step-key')).toHaveText('JBSW Y3DP EHPK 3PXP');
    await expect(sheet.locator('.ddss-steps > li')).toHaveCount(3);
    await noSidewaysScroll(page);
    await sheet.getByRole('button', { name: 'Cancel' }).click();
    await expect(sheet).toBeHidden();
    await expect.poll(async () => (await state(page))?.factors.length).toBe(0);

    // again, a wrong code says so and keeps the sheet; the right one turns it on
    await sec.getByRole('button', { name: 'Turn on two-step sign-in' }).click();
    sheet = page.getByRole('dialog', { name: 'Turn on two-step sign-in' });
    await expect(sheet.locator('#dds-2step-key')).toHaveText('JBSW Y3DP EHPK 3PXP');
    await typeCode(page, '#dds-2step', '111111');
    await expect(sheet.locator('.ddsf-err')).toHaveText('That code isn’t right. The app shows a new one every 30 seconds, so type the one showing now.');
    await typeCode(page, '#dds-2step', GOOD);
    await expect(sheet).toBeHidden();
    await expect(sec.locator('#tsPill')).toHaveText(/^On since /);
    await expect(sec.locator('#tsLine')).toContainText('Codes come from the authenticator app you set up on ');
    await expect(sec.getByRole('button', { name: 'Turn off' })).toBeVisible();
    await expect(sec.locator('#tsOffNote')).toHaveText('Asks for a code from the app first.');
    expect(await calls(page)).toContain('enroll totp Studio OS');
    expect((await state(page))?.aal).toBe('aal2');

    // B3's Turn off: a code from the app first
    await sec.getByRole('button', { name: 'Turn off' }).click();
    const off = page.getByRole('dialog', { name: 'Confirm it’s you.' });
    await expect(off.locator('.ddsf-eye')).toHaveText('Before two-step sign-in goes off');
    await typeCode(page, '#dds-2step-off', '000000');
    await expect(off.locator('.ddsf-err')).toContainText('That code isn’t right.');
    expect((await state(page))?.factors.length).toBe(1);              // a wrong code takes nothing off
    await typeCode(page, '#dds-2step-off', GOOD);
    await expect(off).toBeHidden();
    await expect(sec.locator('#tsPill')).toHaveText('Off');
    expect((await state(page))?.factors.length).toBe(0);
    expect(errors).toEqual([]);
  });

  test('studio sign-in: the password is step one, the app’s code step two; a wrong code says so, the right one opens the workspace', async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', (e) => errors.push(String(e)));
    await installApp(page, {});
    await twoStep(page, { signedIn: false, aal: 'aal1', factors: [ON_FACTOR] });
    await page.goto('/studio.html');
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome back.' })).toBeVisible();
    await page.locator('#em').fill('owner@example.com');
    await page.locator('#pw').fill('a long password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    // A1: the step, who is signing in, and the band's words for it
    await expect(page.getByRole('heading', { level: 1, name: 'One more step.' })).toBeVisible();
    await expect(page.locator('#stepPill')).toHaveText('Step 2 of 2 · Signed in as owner@example.com');
    await expect(page.locator('.side .s2 .lede')).toHaveText('Keep your studio yours.');
    await expect(page.locator('.side .s1')).toBeHidden();
    await expect(page.locator('#stepCode')).toBeFocused();
    await noSidewaysScroll(page);
    // Can't get a code? opens the way back without the phone
    await expect(page.locator('#stepLost')).toBeHidden();
    await page.getByRole('button', { name: 'Can’t get a code?' }).click();
    await expect(page.locator('#stepLost')).toContainText('support@davisdigitalstudio.com');
    await expect(page.getByRole('button', { name: 'Can’t get a code?' })).toHaveAttribute('aria-expanded', 'true');
    // nothing opens until the code is right
    const asked: string[] = [];
    page.on('request', (r) => { if (/\/presence\/portal\/context/.test(r.url())) asked.push(r.url()); });
    await typeCode(page, '#stepPanel', '123456');
    await expect(page.locator('#stepPanel .ddsf-err')).toContainText('That code isn’t right.');
    expect(asked).toEqual([]);
    await typeCode(page, '#stepPanel', GOOD);
    await page.waitForURL(/\/today\.html$/);
    expect((await state(page))?.aal).toBe('aal2');
    expect(errors).toEqual([]);
  });

  test('studio sign-in: Sign in as someone else leaves the step and signs out', async ({ page }) => {
    await installApp(page, {});
    await twoStep(page, { signedIn: true, aal: 'aal1', factors: [ON_FACTOR] });
    await page.goto('/studio.html');                                        // already signed in, code still owed
    await expect(page.getByRole('heading', { level: 1, name: 'One more step.' })).toBeVisible();
    await page.getByRole('button', { name: 'Sign in as someone else →' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome back.' })).toBeVisible();
    await expect(page.locator('#em')).toBeFocused();
    expect((await state(page))?.signedIn).toBe(false);
  });

  test('a page that owes the code goes to the sign-in page, which asks for it and brings them back', async ({ page }) => {
    await installApp(page, {});
    await twoStep(page, { signedIn: true, aal: 'aal1', factors: [ON_FACTOR] });
    await page.goto('/settings.html');
    await page.waitForURL(/\/studio\.html$/);
    await expect(page.getByRole('heading', { level: 1, name: 'One more step.' })).toBeVisible();
    await typeCode(page, '#stepPanel', GOOD);
    await page.waitForURL(/\/settings\.html$/);
    await expect(page.locator('#security #tsPill')).toHaveText(/^On since /);
  });

  test('client sign-in: the emailed code is step one, the app’s code step two, and the way back names their studio', async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', (e) => errors.push(String(e)));
    await installApp(page, { api: { '/portal/context': { data: { site_role: 'client_reviewer', landing: '/client.html', is_client_portal: true, capabilities: [], edition_features: [] } } } });
    await twoStep(page, { signedIn: false, aal: 'aal1', factors: [ON_FACTOR] });
    await page.addInitScript(() => { try { localStorage.setItem('dds-studio-brand', JSON.stringify({ name: 'Harbor Studio', logo_url: null, accent: '' })); } catch { /* denied */ } });
    await page.goto('/portal.html');
    await page.locator('#em').fill('client@example.com');
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Check your inbox' })).toBeVisible();
    await page.locator('#code').fill('246810');
    await page.locator('#codeGo').click();
    // A2
    await expect(page.getByRole('heading', { level: 1, name: 'One more step.' })).toBeVisible();
    await expect(page.locator('#stepHow')).toHaveText('Type the 6-digit code from your authenticator app.');
    await page.getByRole('button', { name: 'Can’t get a code?' }).click();
    await expect(page.locator('#stepLost')).toHaveText('Ask Harbor Studio. They check it’s you, then have the second step turned off so you can sign in and set it up again.');
    await noSidewaysScroll(page);
    await typeCode(page, '#stepPanel', GOOD);
    await page.waitForURL(/\/client\.html$/);
    expect(await calls(page)).toEqual(['otp email', `verify f-1 ${GOOD}`]);
    expect(errors).toEqual([]);
  });

  test('a new password: an account with two-step on types the app’s code before the password is saved', async ({ page }) => {
    await installApp(page, {});
    await twoStep(page, { signedIn: false, aal: 'aal1', factors: [ON_FACTOR] });
    await page.goto('/set-password.html?email=owner%40example.com');
    await page.locator('#code').fill('135790');
    await page.locator('#pw').fill('a much longer password');
    await page.locator('#pw2').fill('a much longer password');
    await page.locator('#saveBtn').click();
    await expect(page.getByRole('heading', { name: 'One more step.' })).toBeVisible();
    expect(await calls(page)).toEqual(['otp recovery']);                  // nothing saved yet
    // the way back without the phone: the studio's sign-in page, never one studio's own address (item 192)
    await expect(page.locator('#spLost')).toHaveText('Lost or changed your phone? Start again from the sign-in page and press “Can’t get a code?”.');
    expect(await page.locator('a[href^="mailto:"]').count()).toBe(0);
    await typeCode(page, '#stepState', '999999');
    await expect(page.locator('#stepState .ddsf-err')).toContainText('That code isn’t right.');
    await typeCode(page, '#stepState', GOOD);
    await expect(page.locator('#okBox')).toContainText('all set.');
    expect(await calls(page)).toEqual(['otp recovery', 'verify f-1 999999', `verify f-1 ${GOOD}`, 'password-set']);
  });

  test('closing the account asks for a fresh code by email: a wrong code says so, Send a new code, Cancel puts the button back', async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', (e) => errors.push(String(e)));
    await installApp(page, {});
    await twoStep(page, { signedIn: true, aal: 'aal1', factors: [] });
    const sent: unknown[] = [];
    await page.route('**/functions/v1/presence/commerce/delete-request', async (route) => {
      const body = route.request().postDataJSON() || {};
      sent.push(body);
      const json = (status: number, b: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
      if (!body.fresh_code) return json(403, { error: 'fresh_code_needed', way: 'email', action: 'close_account', what: 'Closing your account and everything in it.', go: 'Close my account', message: 'We emailed a 6-digit code to o***@example.com. It works for 10 minutes.' });
      if (body.fresh_code !== '135790') return json(403, { error: 'fresh_code_wrong', message: 'That code isn’t right. 4 tries left.', tries_left: 4 });
      return json(200, { data: { scheduled_for: '2026-11-26T00:00:00Z', completes_within_days: 14 } });
    });
    await page.goto('/settings.html');
    await page.locator('#deleteCard summary').click();
    const ask = page.locator('#deleteAsk');
    await ask.click();
    await expect(ask).toHaveText('Are you sure? Press again to confirm');
    await ask.click();
    // C: the sheet, in the server's words
    const sheet = page.getByRole('dialog', { name: 'Confirm it’s you.' });
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('.ddsf-eye')).toHaveText('Before your account closes');
    await expect(sheet.locator('.ddsf-what')).toHaveText('Closing your account and everything in it.');
    await expect(sheet.locator('.ddsf-how')).toHaveText('We emailed a 6-digit code to o***@example.com. It works for 10 minutes.');
    await expect(sheet.getByRole('button', { name: 'Close my account' })).toBeVisible();
    await noSidewaysScroll(page);
    // Cancel: nothing was sent with a code, and the button is itself again
    await sheet.getByRole('button', { name: 'Cancel' }).click();
    await expect(sheet).toBeHidden();
    await expect(ask).toHaveText('Request deletion');
    expect(sent).toEqual([{}]);
    // again: a wrong code, then Send a new code, then the right one
    await ask.click(); await ask.click();
    await expect(sheet).toBeVisible();
    await typeCode(page, '#dds-fresh', '000000');
    await expect(sheet.locator('.ddsf-err')).toHaveText('That code isn’t right. 4 tries left.');
    await sheet.getByRole('button', { name: 'Send a new code' }).click();
    await expect(sheet.locator('.ddsf-how')).toHaveText('We emailed a new 6-digit code to o***@example.com. It works for 10 minutes.');
    await typeCode(page, '#dds-fresh', '135790');
    await expect(sheet).toBeHidden();
    await expect(page.locator('#planClosing')).toContainText('Your account is set to close on');
    expect(sent).toEqual([{}, {}, { fresh_code: '000000' }, {}, { fresh_code: '135790' }]);
    expect(errors).toEqual([]);
  });

  test('closing the account with two-step on: the app’s code is checked in the page, then the request goes with the fresh sign-in', async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', (e) => errors.push(String(e)));
    await installApp(page, {});
    await twoStep(page, { signedIn: true, aal: 'aal2', factors: [ON_FACTOR] });
    const sent: Array<Record<string, unknown>> = [];
    await page.route('**/functions/v1/presence/commerce/delete-request', async (route) => {
      const body = route.request().postDataJSON() || {};
      sent.push(body);
      const json = (status: number, b: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
      // the server's rule: the fresh sign-in must say an app code was typed a moment ago
      const claims = typeof body.fresh_jwt === 'string' ? JSON.parse(atob(body.fresh_jwt.split('.')[1])) : null;
      const at = claims && Array.isArray(claims.amr) ? Math.max(0, ...claims.amr.filter((a: { method: string }) => a.method === 'totp').map((a: { timestamp: number }) => a.timestamp)) : 0;
      if (!at || Date.now() / 1000 - at > 300) return json(403, { error: 'fresh_code_needed', way: 'app', factor_id: 'f-1', action: 'close_account', what: '', go: 'Confirm and close the account', message: 'Type the 6-digit code from your authenticator app.' });
      return json(200, { data: { scheduled_for: '2026-11-26T00:00:00Z', completes_within_days: 14 } });
    });
    await page.goto('/settings.html');
    await page.locator('#deleteCard summary').click();
    await page.locator('#deleteAsk').click(); await page.locator('#deleteAsk').click();
    const sheet = page.getByRole('dialog', { name: 'Confirm it’s you.' });
    await expect(sheet.locator('.ddsf-how')).toHaveText('Type the 6-digit code from your authenticator app.');
    await expect(sheet.getByRole('button', { name: 'Send a new code' })).toBeHidden();   // nothing is emailed
    await expect(sheet.locator('.ddsf-foot')).toHaveText('You have two-step sign-in on, so the code comes from your phone, not your email.');
    await typeCode(page, '#dds-fresh', '000000');
    await expect(sheet.locator('.ddsf-err')).toContainText('That code isn’t right.');
    expect(sent.length).toBe(1);                                            // a wrong code never left the page
    await typeCode(page, '#dds-fresh', GOOD);
    await expect(sheet).toBeHidden();
    await expect(page.locator('#planClosing')).toContainText('Your account is set to close on');
    expect(sent.length).toBe(2);
    expect(sent[1].fresh_code).toBeUndefined();                             // the code itself goes to Supabase only
    expect(await calls(page)).toEqual([`verify f-1 000000`, `verify f-1 ${GOOD}`]);
    expect(errors).toEqual([]);
  });

  test('Home: a studio member without two-step sign-in sees the nudge; Not now hides it for 14 days; on, it never shows', async ({ page }) => {
    const api = {
      '/agency/me': { data: { agency: 'Bright Studio', role: 'owner', plan: 'agency', branding: {} } },
      '/agency/portfolio': { data: [] }, '/agency/kits': { data: [] }, '/studio/customers': { data: [] },
      '/agency/needs-you': { data: { rows: [], more: 0, rest: [], total: 0, empty_line: 'Everything is paid and published.', partial: false, own_site: true, next_by_site: {}, next_by_client: {} } },
    };
    await installApp(page, { api });
    await twoStep(page, { signedIn: true, aal: 'aal1', factors: [] });
    await page.goto('/agency.html');
    const nudge = page.locator('#tsNudge');
    await expect(nudge.getByRole('heading', { name: 'Turn on two-step sign-in.' })).toBeVisible();
    await expect(nudge.getByRole('link', { name: 'Turn it on' })).toHaveAttribute('href', '/settings.html#security');
    await noSidewaysScroll(page);
    await nudge.getByRole('button', { name: 'Not now' }).click();
    await expect(nudge).toHaveCount(0);
    await page.reload();
    await expect(page.locator('#askSec')).toBeVisible();                   // the page finished its start-up
    await expect(page.locator('#tsNudge')).toHaveCount(0);
    // on: never, whatever "Not now" said
    await page.evaluate(() => { localStorage.removeItem('dds-2step-nudge'); });
    await page.evaluate((f) => { sessionStorage.setItem('e2e-2step', JSON.stringify({ signedIn: true, aal: 'aal2', factors: [f] })); }, ON_FACTOR);
    await page.reload();
    await expect(page.locator('#askSec')).toBeVisible();
    await expect(page.locator('#tsNudge')).toHaveCount(0);
  });
});
