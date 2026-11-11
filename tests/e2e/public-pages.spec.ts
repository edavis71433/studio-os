import { test, expect, Page, Route } from '@playwright/test';

// Pages that come from the server open on the app (Supabase serves HTML from its own
// address as plain text): the shared draft viewer, the review page viewer, and the
// unsubscribe page. The server is faked here; the pages only ever ask it.
const FN = 'https://qksstlqzbhesadrrofgn.supabase.co/functions/v1/presence';
const TOKEN = 'ab'.repeat(16);
const SITE = '11111111-1111-4111-8111-111111111111';
const DRAFT = (title: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><main><h1>${title}</h1><a id="menu" href="/draft.html?t=${TOKEN}&page=%2Fmenu%2F">Menu</a></main></body></html>`;
const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });

test.describe('a shared draft opens on the app', () => {
  test('a protected link asks for the password, sends it in the body, and keeps a pass', async ({ page }) => {
    const asks: any[] = [];
    await page.route(`${FN}/p/${TOKEN}`, (route) => {
      const body = route.request().postDataJSON() || {};
      asks.push(body);
      if (body.pass === '1900000000.' + 'c'.repeat(64)) return json(route, 200, { data: { html: DRAFT('Our menu') } });
      if (!body.pw) return json(route, 401, { error: 'password_required', message: 'This preview is password-protected.' });
      if (body.pw !== 'open sesame') return json(route, 401, { error: 'wrong_password', message: 'That password didn’t match. Try again.' });
      return json(route, 200, { data: { html: DRAFT('Marlow’s Kitchen'), pass: '1900000000.' + 'c'.repeat(64) } });
    });
    await page.goto(`/draft.html?t=${TOKEN}`);
    await expect(page.getByRole('heading', { name: 'This preview is password-protected' })).toBeVisible();
    await page.getByLabel('Password').fill('nope');
    await page.getByRole('button', { name: 'View' }).click();
    await expect(page.getByRole('alert')).toHaveText('That password didn’t match. Try again.');
    await page.getByLabel('Password').fill('open sesame');
    await page.getByRole('button', { name: 'View' }).click();
    await expect(page.locator('h1')).toHaveText('Marlow’s Kitchen');
    expect(page.url()).not.toContain('sesame');
    expect(asks.some((a) => a.pw === 'open sesame')).toBe(true);
    // the draft's own link stays on the viewer, and the pass opens the next page without asking
    await page.locator('#menu').click();
    await expect(page.locator('h1')).toHaveText('Our menu');
    expect(asks[asks.length - 1]).toEqual({ page: '/menu/', pass: '1900000000.' + 'c'.repeat(64) });
  });
  test('the timed link opens the page it names', async ({ page }) => {
    await page.route(`${FN}/p/s/abc.def?embed=1&page=%2Fabout%2F`, (route) => route.fulfill({ status: 200, contentType: 'text/plain', headers: { 'Access-Control-Allow-Origin': '*' }, body: DRAFT('About us') }));
    await page.goto('/draft.html?s=abc.def&page=/about/');
    await expect(page.locator('h1')).toHaveText('About us');
  });
  test('a broken link says so in a sentence', async ({ page }) => {
    await page.goto('/draft.html?t=nope');
    await expect(page.getByRole('heading', { name: 'This preview link isn’t valid' })).toBeVisible();
  });
});

test.describe('the review page opens on the app', () => {
  test('it shows the page the server draws, plain text and all', async ({ page }) => {
    await page.route(`${FN}/reviews/${SITE}?embed=1`, (route) => route.fulfill({ status: 200, contentType: 'text/plain', headers: { 'Access-Control-Allow-Origin': '*' }, body: '<!doctype html><html><body><h1>How was your visit to Marlow’s Kitchen?</h1><form id="rv"><button>Send</button></form></body></html>' }));
    await page.goto(`/review.html?site=${SITE}`);
    await expect(page.locator('h1')).toHaveText('How was your visit to Marlow’s Kitchen?');
    await expect(page.locator('#rv button')).toBeVisible();
  });
});

test.describe('unsubscribe works from the link a person clicks', () => {
  async function stub(page: Page, valid: boolean) {
    const calls: string[] = [];
    await page.route(`${FN}/unsubscribe?**`, (route) => {
      calls.push(route.request().method());
      if (!valid) return json(route, 400, { error: 'bad_link', message: 'This unsubscribe link looks incomplete or expired. Email support@davisdigitalstudio.com and we’ll take care of it.' });
      return json(route, 200, route.request().method() === 'POST' ? { data: { unsubscribed: true } } : { data: { valid: true } });
    });
    return calls;
  }
  test('a good link asks, then unsubscribes', async ({ page }) => {
    const calls = await stub(page, true);
    await page.goto('/unsubscribe.html?e=pat%40client.example&t=tok');
    await expect(page.getByRole('heading', { name: 'Stop these emails?' })).toBeVisible();
    await expect(page.getByText('pat@client.example')).toBeVisible();
    await page.getByRole('button', { name: 'Yes, unsubscribe' }).click();
    await expect(page.getByRole('heading', { name: 'You’re unsubscribed' })).toBeVisible();
    expect(calls).toEqual(['GET', 'POST']);
  });
  test('a bad link says so, and nothing is sent', async ({ page }) => {
    const calls = await stub(page, false);
    await page.goto('/unsubscribe.html?e=pat%40client.example&t=nope');
    await expect(page.getByRole('heading', { name: 'That link didn’t work' })).toBeVisible();
    await expect(page.getByRole('button')).toHaveCount(0);
    expect(calls).toEqual(['GET']);
  });
});

// Sales item 74: unsubscribing says what still arrives, and can be taken back from the same page.
test.describe('unsubscribe can be taken back', () => {
  // a small server: where the address stands, and what the page asked for
  async function world(page: Page, start: { unsubscribed?: boolean; since?: string; stopped?: string } = {}) {
    const w = { unsubscribed: !!start.unsubscribed, calls: [] as string[] };
    await page.route(`${FN}/unsubscribe?**`, (route) => {
      const u = new URL(route.request().url()), m = route.request().method();
      const resume = u.searchParams.get('resume') === '1';
      w.calls.push(m + (resume ? ' resume' : ''));
      if (m === 'GET') return json(route, 200, { data: { valid: true, unsubscribed: w.unsubscribed, since: w.unsubscribed ? (start.since || null) : null, stopped: start.stopped || null } });
      w.unsubscribed = !resume;
      return json(route, 200, { data: { unsubscribed: w.unsubscribed } });
    });
    return w;
  }
  test('Start emails again turns them back on, and Unsubscribe stops them again', async ({ page }) => {
    const w = await world(page);
    await page.goto('/unsubscribe.html?e=pat%40client.example&t=tok');
    await expect(page.getByText('Receipts, documents, sign-in links, bookings, payment reminders and alerts about your own business still arrive.')).toBeVisible();
    await page.getByRole('button', { name: 'Yes, unsubscribe' }).click();
    await expect(page.getByRole('heading', { name: 'You’re unsubscribed' })).toBeVisible();
    await page.getByRole('button', { name: 'Start emails again' }).click();
    await expect(page.getByRole('heading', { name: 'Emails are back on' })).toBeVisible();
    await expect(page.getByText('will get these emails again.')).toBeVisible();
    await page.getByRole('button', { name: 'Unsubscribe', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'You’re unsubscribed' })).toBeVisible();
    expect(w.calls).toEqual(['GET', 'POST', 'POST resume', 'POST']);
  });
  test('someone already unsubscribed is told since when, and offered Start emails again', async ({ page }) => {
    const w = await world(page, { unsubscribed: true, since: '2026-11-03T18:00:00Z' });
    await page.goto('/unsubscribe.html?e=pat%40client.example&t=tok');
    await expect(page.getByRole('heading', { name: 'You’re already unsubscribed' })).toBeVisible();
    await expect(page.getByText('has been unsubscribed since Nov 3, 2026.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Yes, unsubscribe' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Start emails again' }).click();
    await expect(page.getByRole('heading', { name: 'Emails are back on' })).toBeVisible();
    expect(w.calls).toEqual(['GET', 'POST resume']);
  });
  test('an address that bounced is not started again from here', async ({ page }) => {
    const w = await world(page, { stopped: 'bounce' });
    await page.goto('/unsubscribe.html?e=pat%40client.example&t=tok');
    await expect(page.getByRole('heading', { name: 'Emails to this address are stopped' })).toBeVisible();
    await expect(page.getByText('stopped because they couldn’t be delivered.')).toBeVisible();
    await expect(page.getByRole('button')).toHaveCount(0);
    expect(w.calls).toEqual(['GET']);
  });
  test('a failed Start emails again keeps the button and says so', async ({ page }) => {
    await page.route(`${FN}/unsubscribe?**`, (route) => {
      if (route.request().method() === 'GET') return json(route, 200, { data: { valid: true, unsubscribed: true, since: null } });
      return json(route, 502, { error: 'not_saved', message: 'That didn’t go through. Try again in a moment.' });
    });
    await page.goto('/unsubscribe.html?e=pat%40client.example&t=tok');
    await expect(page.getByRole('heading', { name: 'You’re already unsubscribed' })).toBeVisible();
    await expect(page.getByText('has been unsubscribed.')).toBeVisible();
    await page.getByRole('button', { name: 'Start emails again' }).click();
    await expect(page.getByRole('alert')).toHaveText('That didn’t go through. Try again in a moment.');
    await expect(page.getByRole('button', { name: 'Start emails again' })).toBeEnabled();
  });
});
