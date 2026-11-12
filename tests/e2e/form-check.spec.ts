import { test, expect, Page, Route } from '@playwright/test';
import { installApp } from './helpers/app';
import { senderTag, bookingScript, TICKET_SETTLE_MS } from '../../supabase/functions/presence/lib/site_send';

// Builder list item 140: stronger spam protection. A client's page asks our server for a
// time ticket when a visitor starts on a form and sends it with the form, waiting until
// it is a few seconds old; booking does the same and, refused, asks again once. The
// owner's alert email links to spam.html, which asks before it marks; the Inbox's
// enquiries gain a Spam filter with the reason and Not spam.
const SITE = 'https://shop.example';
const FN = 'https://db.example.supabase.co/functions/v1/presence';
const SID = '5e000000-0000-4000-8000-000000000001';
const EP = `${FN}/forms/${SID}/submit`;
const BK = `${FN}/book/${SID}`;
const TK = (n: number) => `18000000${String(n).padStart(2, '0')}.${'a'.repeat(32)}`;
const answer = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
const FORM = `<form method="post" action="${EP}" class="card">
<input type="hidden" name="form_kind" value="contact"><input type="hidden" name="source_page" value="/contact/">
<p><label for="f-name">Your name</label><input id="f-name" name="name" required></p>
<p><label for="f-email">Email or phone</label><input id="f-email" name="contact" required></p>
<p><label for="f-msg">Message</label><textarea id="f-msg" name="message" required></textarea></p>
<button class="btn" type="submit">Send</button></form>`;
const page_ = (inner: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Contact</title></head>
<body data-reach-tel="(555) 123-4567" data-reach-mail="hello@shop.example"><main id="main"><h1>Contact</h1>${inner}</main></body></html>`;

test.describe('the time ticket', () => {
  test('a form asks for a ticket when the visitor starts, and sends it once it is a few seconds old', async ({ page }) => {
    await page.clock.install();
    let tickets = 0;
    const sends: string[] = [];
    await page.route(`${FN}/forms/${SID}/ticket`, (route) => { tickets++; return answer(route, 200, { data: { ticket: TK(tickets), wait_s: 3 } }); });
    await page.route(EP, (route) => { sends.push(route.request().postData() || ''); return answer(route, 200, { data: { ok: true, message: 'Thanks!' } }); });
    await page.route(`${SITE}/**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: page_(FORM + senderTag(EP)) }));
    await page.goto(`${SITE}/contact/`);
    expect(tickets).toBe(0);   // nothing is asked for until someone starts on the form
    await page.getByLabel('Your name').fill('Sam Rivera');
    await expect.poll(() => tickets).toBe(1);
    await page.getByLabel('Email or phone').fill('sam@customer.example');
    await page.getByLabel('Message').fill('Do you fix gutters?');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.clock.runFor(1000);
    expect(sends).toHaveLength(0);   // still too soon after the ticket came
    await page.clock.runFor(TICKET_SETTLE_MS);
    await expect(page.getByRole('status').filter({ hasText: 'Thanks!' })).toBeVisible();
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatch(new RegExp(`name="_tk"\\r\\n\\r\\n${TK(1).replace('.', '\\.')}\\r\\n`));
    expect(tickets).toBe(1);   // one ticket for the visit
  });

  test('no ticket to be had: the message didn’t send, and says so', async ({ page }) => {
    let sent = 0;
    await page.route(`${FN}/forms/${SID}/ticket`, (route) => answer(route, 503, { error: 'unavailable' }));
    await page.route(EP, (route) => { sent++; return answer(route, 200, { data: { ok: true } }); });
    await page.route(`${SITE}/**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: page_(FORM + senderTag(EP)) }));
    await page.goto(`${SITE}/contact/`);
    await page.getByLabel('Your name').fill('Sam Rivera');
    await page.getByLabel('Email or phone').fill('sam@customer.example');
    await page.getByLabel('Message').fill('Do you fix gutters?');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.locator('.ps-note')).toContainText('Your message didn’t send.');
    await expect(page.getByLabel('Message')).toHaveValue('Do you fix gutters?');
    expect(sent).toBe(0);
  });

  test('booking sends its ticket; refused, it asks for a fresh one and tries once more on its own', async ({ page }) => {
    const day = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);
    let tickets = 0;
    const posted: Array<{ _tk?: string }> = [];
    await page.route(`${BK}/ticket`, (route) => { tickets++; return answer(route, 200, { data: { ticket: TK(tickets), wait_s: 3 } }); });
    await page.route(`${BK}/types`, (route) => answer(route, 200, { data: { enabled: true, max_days_ahead: 60, types: [{ id: '7e000000-0000-4000-8000-000000000001', name: 'Haircut', duration_min: 30, price_text: '$40', description: '' }] } }));
    await page.route(`${BK}/slots?**`, (route) => answer(route, 200, { data: { slots: [`${day}T10:00`] } }));
    await page.route(BK, (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, accept', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' } });
      posted.push(route.request().postDataJSON() || {});
      return posted.length === 1 ? answer(route, 400, { error: 'check', message: 'That didn’t go through. Please try again.' }) : answer(route, 200, { data: { ok: true, message: 'You’re booked for Haircut.' } });
    });
    const widget = `<div class="booking-widget" data-book="${BK}"><div class="bk-stage" aria-live="polite"><p class="bk-msg">Loading…</p></div></div>`;
    await page.route(`${SITE}/**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: page_(widget + bookingScript()) }));
    await page.goto(`${SITE}/book/`);
    await page.getByRole('button', { name: /Haircut/ }).click();
    await page.locator('.bk-date').fill(day);
    await page.getByRole('button', { name: '10:00 AM' }).click();
    await page.getByLabel('Your name').fill('Sam Rivera');
    await page.getByLabel('Email').fill('sam@customer.example');
    await page.getByRole('button', { name: 'Confirm booking' }).click();
    await expect(page.locator('.bk-done-msg')).toHaveText('You’re booked for Haircut.', { timeout: 15_000 });
    expect(posted.map((p) => p._tk)).toEqual([TK(1), TK(2)]);
  });
});

test.describe('“This was spam” from the owner’s email', () => {
  const PROD = 'https://qksstlqzbhesadrrofgn.supabase.co/functions/v1/presence/forms/spam';
  test('the page shows the message and asks first; Yes moves it to Spam, and Undo brings it back', async ({ page }) => {
    let spam = false;
    const posts: unknown[] = [];
    await page.route(`${PROD}?**`, (route) => answer(route, 200, { data: { who: 'Sam Rivera', preview: 'Cheap backlinks for your site!', spam, at: '2026-11-10T00:00:00Z' } }));
    await page.route(PROD, (route) => { const b = route.request().postDataJSON(); posts.push(b); spam = !b.undo; return answer(route, 200, { data: { ok: true, spam } }); });
    await page.goto('/spam.html?t=abc.def');
    await expect(page.getByRole('heading', { name: 'Is this message spam?' })).toBeVisible();
    await expect(page.locator('.msg')).toContainText('Sam Rivera');
    await expect(page.locator('.msg')).toContainText('Cheap backlinks for your site!');
    expect(posts).toHaveLength(0);   // opening the link changes nothing
    await page.getByRole('button', { name: 'Yes, it’s spam' }).click();
    await expect(page.getByRole('heading', { name: 'It’s in Spam' })).toBeVisible();
    await expect(page.getByRole('status')).toHaveText('Done: moved to Spam.');
    await page.getByRole('button', { name: 'It’s not spam' }).click();
    await expect(page.getByRole('heading', { name: 'Is this message spam?' })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('back in your Inbox');
    expect(posts).toEqual([{ t: 'abc.def' }, { t: 'abc.def', undo: true }]);
  });

  test('a broken link says so', async ({ page }) => {
    await page.route(`${PROD}?**`, (route) => answer(route, 400, { error: 'bad_link', message: 'This link isn’t complete. Open your Inbox to mark the message as spam there.' }));
    await page.goto('/spam.html?t=junk');
    await expect(page.getByRole('heading', { name: 'That link didn’t work' })).toBeVisible();
    await expect(page.locator('main')).toContainText('Open your Inbox to mark the message as spam there.');
  });
});

test.describe('the Inbox’s Spam filter', () => {
  const LEAD = { id: 'l-9', form_kind: 'quote', name: 'Sam Rivera', email: 'sam@example.com', phone: '', message: 'Can I get a quote for a patio?', source_page: '/contact/', status: 'new', created_at: '2026-07-13T00:00:00Z' };
  const HELD = { id: 'l-7', form_kind: 'contact', name: 'Rank Booster', email: 'seo@example.net', phone: '', message: 'Cheap backlinks https://a.example https://b.example https://c.example', source_page: '/contact/', status: 'new', created_at: '2026-07-12T00:00:00Z', spam: true, spam_reason: 'It was full of web links.' };
  async function openSpam(page: Page, notSpam: unknown[]) {
    await installApp(page, { api: {
      '/portal/feed': { data: { role: 'business_owner', notices: [], pending_approvals: [], client_messages: [], enquiries: [] } },
      '/forms/inbox': { data: { submissions: [LEAD], unread: 1 } },
    } });
    await page.route((url) => url.pathname.endsWith('/functions/v1/presence/forms/inbox') && url.searchParams.get('spam') === '1', (route) => answer(route, 200, { data: { spam: [HELD], days: 30, more: false } }));
    await page.route('**/functions/v1/presence/forms/inbox/l-7', (route) => { notSpam.push(route.request().postDataJSON()); return answer(route, 200, { data: { ok: true } }); });
    await page.goto('/inbox.html#enquiries');
  }

  test('Spam lists what the checks held back, says why, and Not spam brings one back', async ({ page }) => {
    const notSpam: unknown[] = [];
    await openSpam(page, notSpam);
    const rows = page.locator('#rows');
    await expect(rows.getByRole('option').filter({ hasText: 'Sam Rivera' })).toBeVisible();
    await expect(rows.getByRole('option').filter({ hasText: 'Rank Booster' })).toHaveCount(0);   // never in the ordinary list
    await page.locator('#efilt [data-ef="spam"]').click();
    const held = rows.getByRole('option').filter({ hasText: 'Rank Booster' });
    await expect(held).toBeVisible();
    await expect(rows.getByRole('option').filter({ hasText: 'Sam Rivera' })).toHaveCount(0);
    await expect(page.locator('#lmeta')).toHaveText('1 in Spam, from the last 30 days. After that it goes for good, with any files.');   // item 203
    await held.click();
    await expect(page.locator('#rpane')).toContainText('It was full of web links.');
    await page.getByRole('button', { name: 'Not spam' }).click();
    await expect.poll(() => notSpam).toEqual([{ spam: false }]);
    await expect(rows.getByRole('option').filter({ hasText: 'Rank Booster' })).toHaveCount(0);
  });
});
