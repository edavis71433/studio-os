import { test } from '@playwright/test';
import { installApp } from '../../../../tests/e2e/helpers/app';
import { CLIENT_API, PID, SIGNUP_API, PRESENCE_API } from './fixtures';
import { Walk, quiet } from './walk';

const SESSION = { access_token: 'e2e-token', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, refresh_token: 'r', user: { id: 'e2e-client', email: 'claud@example.com', aud: 'authenticated', role: 'authenticated' } };

test('C1 client signs in', async ({ page }) => {
  await quiet(page);
  await installApp(page, { session: null, api: CLIENT_API });
  // an auth stub that can send a code and verify it; the session survives the redirect via sessionStorage
  await page.route(/@supabase\/supabase-js|\/vendor\/supabase-js/, (route) => route.fulfill({ contentType: 'application/javascript', body: `
    window.supabase = { createClient: function () { return { auth: {
      getSession: async function () { return { data: { session: window.__E2E_SESSION || null } }; },
      getUser: async function () { return { data: { user: (window.__E2E_SESSION || {}).user || null } }; },
      onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
      signOut: async function () { window.__E2E_SESSION = null; return { error: null }; },
      signInWithOtp: async function () { return { data: {}, error: null }; },
      verifyOtp: async function () { var s = ${JSON.stringify(SESSION)}; sessionStorage.setItem('e2e-in', '1'); window.__E2E_SESSION = s; return { data: { session: s, user: s.user }, error: null }; },
    } }; } };` }));
  await page.addInitScript((s) => { if (sessionStorage.getItem('e2e-in')) (window as any).__E2E_SESSION = s; }, SESSION);
  const w = new Walk(page, 'c1-sign-in');
  w.note('arrives from the "Client login" link on the marketing site or an email');
  await w.start('/portal.html');
  await w.shot('1-door');
  await w.type(page.locator('#em'), 'claud@example.com', 'email');
  await w.click(page.locator('#sendGo'), 'Email me a sign-in link');
  await w.shot('2-code');
  w.note('— switches to the mail app; either taps the magic link (1 click, lands signed in) or copies the 6-digit code back —');
  const code = page.locator('input[autocomplete="one-time-code"], #code').first();
  await w.type(code, '123456', '6-digit code');
  await w.click(page.locator('#codeGo'), 'Sign in →');
  await page.waitForURL(/client\.html/, { timeout: 10000 }).catch(() => {});
  await page.waitForLoadState('networkidle');
  w.pages.push(new URL(page.url()).pathname);
  await w.shot('3-home');
  w.finish();
});

test('C2 client reads an update', async ({ page }) => {
  await quiet(page); await installApp(page, { session: SESSION, api: CLIENT_API });
  const w = new Walk(page, 'c2-read-update');
  await w.start('/client.html');
  const recentTop = await page.getByRole('heading', { name: 'Recent updates' }).boundingBox().catch(() => null);
  w.note(`"Recent updates" heading at y=${recentTop ? Math.round(recentTop.y) : 'not found'} (fold = 800)`);
  await w.shot('1-home');
  await w.click(page.locator('button[aria-label*="otification" i], #bell, .bell').first(), 'the bell');
  await w.shot('2-bell');
  await w.click(page.getByText('Your approval is requested').first(), 'the notification');
  await w.shot('3-landed');
  w.finish();
});

test('C3 client approves a change', async ({ page }) => {
  await quiet(page); await installApp(page, { session: SESSION, api: CLIENT_API });
  page.on('dialog', (d) => d.accept());
  const w = new Walk(page, 'c3-approve');
  await w.start('/client.html');
  await w.click(page.getByRole('button', { name: /Review & approve/ }).or(page.getByRole('link', { name: /Review & approve/ })), 'Review & approve (Home, Needs you)');
  await w.shot('1-record');
  await w.click(page.getByRole('button', { name: 'Approve', exact: true }), 'Approve');
  await w.shot('2-approved');
  w.finish();
});

test('C4 client replies to the studio', async ({ page }) => {
  await quiet(page); await installApp(page, { session: SESSION, api: CLIENT_API });
  await page.route(`**/functions/v1/presence/client/projects/${PID}/messages`, (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: 'mg2', body: 'Love it — go ahead.', author_kind: 'client', created_at: '2026-10-19T00:00:00Z' } }) })
      : route.fallback());
  const w = new Walk(page, 'c4-reply');
  await w.start('/client.html');
  await w.click(page.locator('#tabnav [data-tab="messages"], .cb-tabs [data-tab="messages"]').first(), 'Messages tab');
  await w.click(page.locator(`[data-mrow="proj:${PID}"]`), 'the project conversation');
  await w.type(page.locator('#mpane').getByLabel('Message your studio'), 'Love it — go ahead.', 'message');
  await w.click(page.locator('#mpane').getByRole('button', { name: 'Send' }), 'Send');
  await w.shot('1-sent');
  w.finish();
});

test('C5 client pays an invoice', async ({ page }) => {
  await quiet(page); await installApp(page, { session: SESSION, api: CLIENT_API });
  const w = new Walk(page, 'c5-pay');
  await w.start('/client.html');
  const homePay = await page.getByRole('link', { name: /Pay/ }).count();
  w.note(`Pay links on Home: ${homePay}`);
  await w.click(page.locator('#tabnav [data-tab="invoices"], .cb-tabs [data-tab="invoices"]').first(), 'Invoices tab');
  await w.shot('1-invoices');
  const pay = page.getByRole('link', { name: /Pay — Design phase/ });
  w.note(`Pay → ${await pay.getAttribute('href')} target=${await pay.getAttribute('target')} — Stripe in a new tab; nothing in Studio OS confirms payment until the webhook lands`);
  w.clicks++; w.steps.push(`${w.clicks}. click "Pay — Design phase" → new tab (Stripe)`);
  w.finish();
});

test('N onboarding: sign up to first publish', async ({ page }) => {
  await quiet(page);
  await installApp(page, { api: { ...PRESENCE_API, ...SIGNUP_API,
    '/changes': { data: { count: 6, first_publish: true, changes: [{ section: 'identity', sentence: 'Your business name and description' }, { section: 'offerings', sentence: 'Three services' }], blockers: 0, warnings: 0, draft_hash: 'h' } } } });
  const w = new Walk(page, 'n-onboarding');
  w.note('arrives from pricing.html → "Start free trial" (signup.html?plan=presence&trial=1)');
  await w.start('/signup.html?plan=presence&trial=1');
  await w.shot('1-signup');
  await w.type(page.locator('#business'), 'Marlow’s Kitchen', 'business');
  await w.type(page.locator('#email'), 'marlow@example.com', 'email');
  await w.type(page.locator('#password'), 'correct-horse-9', 'password');
  await w.click(page.locator('#submitBtn'), 'Start my free trial');
  await page.waitForURL(/get-started/, { timeout: 10000 }).catch(() => {});
  await page.waitForLoadState('networkidle'); await page.waitForTimeout(600);
  w.pages.push(new URL(page.url()).pathname);
  await w.shot('2-get-started');
  await w.click(page.locator('[data-ind]').first(), 'an industry chip');
  await w.click(page.locator('#build'), 'Build my website →');
  await page.waitForTimeout(1500);
  await w.shot('3-built');
  await w.click(page.locator('#review, #go').first(), 'Review & preview your website → / Open my workspace →');
  await w.shot('4-preview');
  const cover = await page.evaluate(() => { const b = document.getElementById('btnStageClose')!; const r = b.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], topmost: top ? (top.id || top.className || top.tagName) : null, isSelf: top === b || b.contains(top) }; });
  w.note(`preview stage "← Back": ${JSON.stringify(cover)}`); console.log('COVER', JSON.stringify(cover));
  w.clicks++; w.steps.push(`${w.clicks}. "← Back" is under the shell's top bar (z 95 vs 2147483000) and Escape does not close the preview — the walk scripts the click; a real user must use a nav link instead`);
  await page.evaluate(() => (document.getElementById('btnStageClose') as HTMLButtonElement).click()); await page.waitForTimeout(500);
  await w.click(page.locator('#btnPublish'), 'Publish');
  await w.shot('5-ritual');
  w.note(`ritual buttons: ${JSON.stringify(await page.locator('#ritActions button').allInnerTexts())}`);
  await w.click(page.locator('#ritActions button').first(), 'the filled button in the ritual');
  await w.shot('6-live');
  w.finish();
});
