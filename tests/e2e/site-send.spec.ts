import { test, expect, Page, Route } from '@playwright/test';
import { senderTag, bookingScript, SEND_WAIT_MS } from '../../supabase/functions/presence/lib/site_send';

// Builder list item 131: a client's site sends its forms and bookings from the page. The page here is
// a client's contact page on its own address (faked), carrying the very script a publish
// puts on it, and the server is faked at its real kind of address. The visitor never
// leaves the site: Sending…, the thank-you where the form was, and when the server says
// no or nothing at all, a plain sentence with the business's phone and email, and every
// word they typed still in the boxes.
const SITE = 'https://shop.example';
const EP = 'https://db.example.supabase.co/functions/v1/presence/forms/5e000000-0000-4000-8000-000000000001/submit';
const CONTACT_FORM = `<form method="post" action="${EP}" class="card">
<h2>Send us a message</h2>
<input type="hidden" name="form_kind" value="contact">
<input type="hidden" name="source_page" value="/contact/">
<p class="hp" aria-hidden="true"><label for="f-hp">Leave this field empty</label><input id="f-hp" name="_hp" tabindex="-1" autocomplete="off"></p>
<p><label for="f-name">Your name</label><input id="f-name" name="name" required maxlength="120"></p>
<p><label for="f-email">Email or phone</label><input id="f-email" name="contact" required maxlength="254"></p>
<p><label for="f-msg">Message</label><textarea id="f-msg" name="message" required maxlength="2000" rows="5"></textarea></p>
<button class="btn" type="submit">Send</button></form>`;
// the owner's own form, as lib/forms.ts draws it: novalidate, so the sender checks it
const OWN_FORM = `<form id="presence-form-quote" class="card presence-form" method="post" action="${EP}" novalidate>
<input type="hidden" name="form_id" value="quote"><input type="hidden" name="form_kind" value="quote"><input type="hidden" name="source_page" value="/">
<div class="ff" data-field="name"><p><label for="f-quote-name">Your name</label><input type="text" id="f-quote-name" name="name" required></p></div>
<div class="ff" data-field="details"><p><label for="f-quote-details">Tell us more</label><textarea id="f-quote-details" name="details" required></textarea></p></div>
<button class="btn" type="submit">Request a quote</button></form>`;
const pageWith = (form: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Contact</title></head>
<body data-reach-tel="(555) 123-4567" data-reach-mail="hello@shop.example"><main id="main"><h1>Contact &amp; hours</h1>${form}</main>${senderTag(EP)}</body></html>`;

async function openSite(page: Page, form = CONTACT_FORM, path = '/contact/') {
  await page.route(`${SITE}/**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: pageWith(form) }));
  await page.goto(`${SITE}${path}`);
}
const answer = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
async function fillContact(page: Page) {
  await page.getByLabel('Your name').fill('Sam Rivera');
  await page.getByLabel('Email or phone').fill('sam@customer.example');
  await page.getByLabel('Message').fill('Do you fix gutters?');
}

test.describe('a client’s form sends from the page', () => {
  test('a message goes through: Sending…, then the thank-you where the form was, on the same page', async ({ page }) => {
    const sent: { accept: string | null; type: string | null; body: string }[] = [];
    let release: () => void = () => {};
    const held = new Promise<void>((r) => { release = r; });
    await page.route(EP, async (route) => {
      const req = route.request();
      sent.push({ accept: await req.headerValue('accept'), type: await req.headerValue('content-type'), body: req.postData() || '' });
      await held;
      await answer(route, 200, { data: { ok: true, message: 'Thank you, your message was sent. We’ll get back to you soon.' } });
    });
    await openSite(page);
    await fillContact(page);
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByRole('button', { name: 'Sending…' })).toBeDisabled();
    release();
    const thanks = page.getByRole('status').filter({ hasText: 'your message was sent' });
    await expect(thanks).toBeVisible();
    await expect(thanks).toBeFocused();
    await expect(page.locator('form')).toBeHidden();
    expect(page.url()).toBe(`${SITE}/contact/`);
    expect(sent).toHaveLength(1);
    expect(sent[0].accept).toBe('application/json');
    expect(sent[0].type).toContain('multipart/form-data');
    expect(sent[0].body).toContain('Do you fix gutters?');
    expect(sent[0].body).toContain('sam@customer.example');
  });

  test('the server says nothing: after 15 seconds it says the message didn’t send, offers the phone and email, and keeps the words', async ({ page }) => {
    await page.clock.install();
    await page.route(EP, () => { /* never answers */ });
    await openSite(page);
    await fillContact(page);
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByRole('button', { name: 'Sending…' })).toBeVisible();
    await page.clock.runFor(6500);
    await expect(page.locator('.ps-note')).toHaveText('Still sending…');
    await page.clock.runFor(SEND_WAIT_MS);
    const note = page.locator('.ps-note');
    await expect(note).toContainText('Your message didn’t send. What you wrote is still here, so you can try again in a minute.');
    await expect(note.getByRole('link', { name: '(555) 123-4567' })).toHaveAttribute('href', 'tel:5551234567');
    await expect(note.getByRole('link', { name: 'hello@shop.example' })).toHaveAttribute('href', 'mailto:hello@shop.example');
    await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled();
    await expect(page.getByLabel('Message')).toHaveValue('Do you fix gutters?');
    await expect(page.getByLabel('Your name')).toHaveValue('Sam Rivera');
    expect(page.url()).toBe(`${SITE}/contact/`);
  });

  test('the connection drops, or the server fails: the same plain sentence, and a second try sends', async ({ page }) => {
    let n = 0;
    await page.route(EP, (route) => (++n === 1 ? route.abort('internetdisconnected') : n === 2 ? answer(route, 502, { error: 'write_failed' }) : answer(route, 200, { data: { ok: true, message: 'Thanks!' } })));
    await openSite(page);
    await fillContact(page);
    const send = page.getByRole('button', { name: 'Send' });
    await send.click();
    await expect(page.locator('.ps-note')).toContainText('Your message didn’t send.');
    await expect(page.getByLabel('Email or phone')).toHaveValue('sam@customer.example');
    await send.click();
    await expect(page.locator('.ps-note')).toContainText('Your message didn’t send.');
    await expect(page.locator('.ps-note')).toContainText('You can also call (555) 123-4567 or email hello@shop.example.');
    await send.click();
    await expect(page.getByRole('status').filter({ hasText: 'Thanks!' })).toBeVisible();
    expect(n).toBe(3);
  });

  test('too many from here: it says to wait a minute', async ({ page }) => {
    await page.route(EP, (route) => answer(route, 429, { error: 'rate_limited', message: 'That’s a lot of requests in a short time — please wait a minute and try again.' }));
    await openSite(page);
    await fillContact(page);
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.locator('.ps-note')).toContainText('A lot of messages were sent from here just now. Wait a minute, then send it again.');
  });

  test('the owner’s own form: an empty answer is caught before sending, the server’s sentence shows and its field takes focus', async ({ page }) => {
    let asked = 0;
    await page.route(EP, (route) => { asked++; return answer(route, 400, { error: 'Tell us more is required.', field: 'details', message: 'Tell us more is required.' }); });
    await openSite(page, OWN_FORM, '/our-work/');
    await page.getByLabel('Your name').fill('Ana');
    await page.getByRole('button', { name: 'Request a quote' }).click();
    await expect(page.getByLabel('Tell us more')).toBeFocused();
    expect(asked).toBe(0);
    await page.getByLabel('Tell us more').fill(' ');
    await page.getByLabel('Your name').focus();
    await page.getByRole('button', { name: 'Request a quote' }).click();
    await expect(page.locator('.ps-note')).toHaveText('Tell us more is required.');
    await expect(page.getByLabel('Tell us more')).toBeFocused();
    expect(asked).toBe(1);
  });

  test('the owner’s own form with its own thank-you address goes there, and the page it came from rides along', async ({ page }) => {
    let body = '';
    await page.route(EP, (route) => { body = route.request().postData() || ''; return answer(route, 200, { data: { ok: true, message: 'Got it.', redirect: `${SITE}/thank-you-for-asking/` } }); });
    await openSite(page, OWN_FORM, '/our-work/');
    await page.getByLabel('Your name').fill('Ana');
    await page.getByLabel('Tell us more').fill('A new roof');
    await page.getByRole('button', { name: 'Request a quote' }).click();
    await page.waitForURL(`${SITE}/thank-you-for-asking/`);
    expect(body).toMatch(/name="source_page"\r\n\r\n\/our-work\/\r\n/);
  });
});

// The booking widget, as a publish draws it (lib/site_blocks.ts) with its script. Before item
// 131 the server let only the studio's own addresses read its answers, so on a client's
// site the browser refused every booking call and the widget said it couldn't load.
const BK = 'https://db.example.supabase.co/functions/v1/presence/book/5e000000-0000-4000-8000-000000000001';
const BOOKING = `<section class="block wrap block-booking"><h2>Book online</h2><div class="booking-widget" data-book="${BK}"><div class="bk-stage" aria-live="polite"><p class="bk-msg">Loading available times…</p></div></div></section>`;
const bookingPage = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Book</title></head>
<body data-reach-tel="(555) 123-4567" data-reach-mail="hello@shop.example"><main id="main"><h1>Book</h1>${BOOKING}${bookingScript()}</main></body></html>`;
const TYPES = { data: { enabled: true, timezone: 'UTC', max_days_ahead: 60, types: [{ id: '7e000000-0000-4000-8000-000000000001', name: 'Haircut', duration_min: 30, price_text: '$40', description: '' }] } };

test.describe('booking on a client’s site', () => {
  async function openBooking(page: Page) {
    await page.route(`${SITE}/**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: bookingPage }));
    await page.goto(`${SITE}/book/`);
  }

  test('booking can’t load: it says so, with the phone and email to book instead', async ({ page }) => {
    await page.route(`${BK}/types`, (route) => route.abort('connectionrefused'));
    await openBooking(page);
    const stage = page.locator('.bk-stage');
    await expect(stage).toContainText('Online booking isn’t loading right now. To book, call (555) 123-4567 or email hello@shop.example.');
    await expect(stage.getByRole('link', { name: '(555) 123-4567' })).toHaveAttribute('href', 'tel:5551234567');
  });

  test('a booking that gets no answer says nothing is booked and keeps the details; a second try books it', async ({ page }) => {
    await page.clock.install();
    const day = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);
    let posts = 0;
    await page.route(`${BK}/types`, (route) => answer(route, 200, TYPES));
    await page.route(`${BK}/slots?**`, (route) => answer(route, 200, { data: { date: day, duration_min: 30, slots: [`${day}T10:00`, `${day}T10:30`] } }));
    await page.route(BK, (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, accept', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' } });
      if (++posts === 1) return;   // the first try never answers
      return answer(route, 200, { data: { ok: true, message: 'You’re booked for Haircut. A confirmation is on its way.' } });
    });
    await openBooking(page);
    await page.getByRole('button', { name: /Haircut/ }).click();
    await page.locator('.bk-date').fill(day);
    await page.getByRole('button', { name: '10:00 AM' }).click();
    await page.getByLabel('Your name').fill('Sam Rivera');
    await page.getByLabel('Email').fill('sam@customer.example');
    await page.getByRole('button', { name: 'Confirm booking' }).click();
    await expect(page.getByRole('button', { name: 'Booking…' })).toBeDisabled();
    await page.clock.runFor(SEND_WAIT_MS + 500);
    const err = page.locator('.bk-err');
    await expect(err).toContainText('Your booking didn’t go through, so nothing is booked yet. Please try again. You can also call (555) 123-4567 or email hello@shop.example.');
    await expect(page.getByLabel('Your name')).toHaveValue('Sam Rivera');
    await page.getByRole('button', { name: 'Confirm booking' }).click();
    await expect(page.locator('.bk-done-msg')).toHaveText('You’re booked for Haircut. A confirmation is on its way.');
    expect(posts).toBe(2);
  });
});
