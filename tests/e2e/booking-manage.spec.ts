import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';
import { bookingScript } from '../../supabase/functions/presence/lib/site_send';

// Builder list item 149: a customer who books can add it to their calendar and change or cancel it
// themselves (booking.html, opened from the private link in their emails, and the widget's "you're
// booked"); the owner connects their own calendar so its busy times stay off the booking page, and
// chooses whether customers may make changes (two cards in the Bookings view).
const PROD = 'https://qksstlqzbhesadrrofgn.supabase.co/functions/v1/presence/book/manage';
const T = 'b1000000-0000-4000-8000-000000000001.' + 'a'.repeat(32);
const answer = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
const CAL = { google: 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=Haircut', outlook: 'https://outlook.live.com/calendar/0/deeplink/compose?subject=Haircut', ics: `https://qksstlqzbhesadrrofgn.supabase.co/functions/v1/presence/book/manage/calendar.ics?t=${T}` };
const BOOKING = { business: 'Marlow Salon', service: 'Haircut', when: 'Tuesday, Nov 17 at 10:00 AM', status: 'confirmed', state: 'open', can_move: true, date: '2026-11-17', today: '2026-11-11', max_days_ahead: 60, duration_min: 60, price: '$40', reach: { tel: '(555) 123-4567', mail: 'hello@salon.example' }, calendar: CAL, site_url: 'https://salon.example' };

async function openManage(page: Page, views: unknown[], onPost: (b: any) => [number, unknown] = () => [200, { data: { ok: true } }]) {
  const posts: any[] = [];
  let n = 0;
  await page.route(`${PROD}?**`, (route) => answer(route, 200, { data: views[Math.min(n++, views.length - 1)] }));
  await page.route(`${PROD}/slots?**`, (route) => answer(route, 200, { data: { date: new URL(route.request().url()).searchParams.get('date'), slots: ['2026-11-18T09:00', '2026-11-18T15:30'] } }));
  await page.route(PROD, (route) => { const b = route.request().postDataJSON(); posts.push(b); const [s, body] = onPost(b); return answer(route, s, body); });
  await page.goto(`/booking.html?t=${T}`);
  return posts;
}

test.describe('the customer’s own booking page', () => {
  test('it shows the booking and the calendar links, and opening it changes nothing', async ({ page }) => {
    const posts = await openManage(page, [BOOKING]);
    await expect(page.getByRole('heading', { name: 'Your booking' })).toBeVisible();
    await expect(page.locator('.msg')).toContainText('Haircut');
    await expect(page.locator('.msg')).toContainText('Tuesday, Nov 17 at 10:00 AM');
    await expect(page.locator('.msg')).toContainText('With Marlow Salon · $40');
    await expect(page.locator('.msg')).toContainText('Confirmed.');
    await expect(page.getByRole('link', { name: 'Google' })).toHaveAttribute('href', CAL.google);
    await expect(page.getByRole('link', { name: 'Outlook' })).toHaveAttribute('href', CAL.outlook);
    await expect(page.getByRole('link', { name: 'Apple and others' })).toHaveAttribute('href', CAL.ics);
    await expect(page.getByRole('button', { name: 'Pick another time' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel booking' })).toBeVisible();
    expect(posts).toHaveLength(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);   // fits a phone
  });

  test('picking another time: a day, a time, a yes, and the page shows the new time', async ({ page }) => {
    const moved = { ...BOOKING, when: 'Wednesday, Nov 18 at 3:30 PM', date: '2026-11-18' };
    const posts = await openManage(page, [BOOKING, moved], () => [200, { data: { ok: true, status: 'confirmed', when: moved.when, message: 'Your booking has moved to Wednesday, Nov 18 at 3:30 PM. A new confirmation is on its way.' } }]);
    await page.getByRole('button', { name: 'Pick another time' }).click();
    await expect(page.getByRole('heading', { name: 'Pick another time' })).toBeVisible();
    await expect(page.locator('main')).toContainText('You have Tuesday, Nov 17 at 10:00 AM now.');
    await page.getByLabel('Day').fill('2026-11-18');
    await page.getByRole('button', { name: '3:30 PM' }).click();
    await expect(page.getByRole('heading', { name: 'Move your booking?' })).toBeVisible();
    await expect(page.locator('main')).toContainText('From Tuesday, Nov 17 at 10:00 AM to Wednesday, Nov 18 at 3:30 PM.');
    expect(posts).toHaveLength(0);
    await page.getByRole('button', { name: 'Move my booking' }).click();
    await expect(page.getByRole('heading', { name: 'Your booking' })).toBeVisible();
    await expect(page.locator('.note')).toHaveText('Your booking has moved to Wednesday, Nov 18 at 3:30 PM. A new confirmation is on its way.');
    await expect(page.locator('.msg')).toContainText('Wednesday, Nov 18 at 3:30 PM');
    expect(posts).toEqual([{ t: T, action: 'move', slot: '2026-11-18T15:30' }]);
  });

  test('a time someone just took: it says so and keeps the page as it was', async ({ page }) => {
    await openManage(page, [BOOKING], () => [409, { error: 'slot_taken', message: 'Sorry — that time was just taken. Please pick another.' }]);
    await page.getByRole('button', { name: 'Pick another time' }).click();
    await page.getByLabel('Day').fill('2026-11-18');
    await page.getByRole('button', { name: '9:00 AM' }).click();
    await page.getByRole('button', { name: 'Move my booking' }).click();
    await expect(page.locator('.err')).toHaveText('Sorry — that time was just taken. Please pick another.');
    await expect(page.getByRole('button', { name: 'Move my booking' })).toBeEnabled();
    await page.getByRole('button', { name: 'Pick a different time' }).click();
    await expect(page.getByRole('heading', { name: 'Pick another time' })).toBeVisible();
  });

  test('canceling asks first, then says the business has been told', async ({ page }) => {
    const canceled = { ...BOOKING, state: 'canceled', status: 'canceled', calendar: null };
    const posts = await openManage(page, [BOOKING, canceled], () => [200, { data: { ok: true, status: 'canceled', message: 'Your booking is canceled. Marlow Salon has been told.' } }]);
    await page.getByRole('button', { name: 'Cancel booking' }).click();
    await expect(page.getByRole('heading', { name: 'Cancel this booking?' })).toBeVisible();
    await page.getByRole('button', { name: 'Keep my booking' }).click();
    await expect(page.getByRole('heading', { name: 'Your booking' })).toBeVisible();
    expect(posts).toHaveLength(0);
    await page.getByRole('button', { name: 'Cancel booking' }).click();
    await page.getByRole('button', { name: 'Yes, cancel it' }).click();
    await expect(page.getByRole('heading', { name: 'This booking was canceled' })).toBeVisible();
    await expect(page.locator('.note')).toHaveText('Your booking is canceled. Marlow Salon has been told.');
    await expect(page.getByRole('link', { name: 'Book another time' })).toHaveAttribute('href', 'https://salon.example');
    await expect(page.getByRole('link', { name: 'Google' })).toHaveCount(0);
    expect(posts).toEqual([{ t: T, action: 'cancel' }]);
  });

  test('too close to the time: no buttons, just how to reach the business', async ({ page }) => {
    await openManage(page, [{ ...BOOKING, state: 'too_late', can_move: false }]);
    await expect(page.locator('main')).toContainText('It’s too close to the time to change this booking online. To change or cancel, call (555) 123-4567 or email hello@salon.example.');
    await expect(page.getByRole('link', { name: '(555) 123-4567' })).toHaveAttribute('href', 'tel:5551234567');
    await expect(page.getByRole('link', { name: 'hello@salon.example' })).toHaveAttribute('href', 'mailto:hello@salon.example');
    await expect(page.getByRole('button', { name: 'Cancel booking' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Google' })).toBeVisible();   // still worth having in a calendar
  });

  test('a link that isn’t one says so, and an incomplete one asks the server nothing', async ({ page }) => {
    let asked = 0;
    await page.route(`${PROD}?**`, (route) => { asked++; return answer(route, 404, { error: 'not_found', message: 'That link didn’t work.' }); });
    await page.goto(`/booking.html?t=${T}`);
    await expect(page.getByRole('heading', { name: 'That link didn’t work' })).toBeVisible();
    await page.goto('/booking.html?t=junk');
    await expect(page.getByRole('heading', { name: 'That link didn’t work' })).toBeVisible();
    expect(asked).toBe(1);
  });
});

// The widget, as a publish draws it (lib/site_blocks.ts) with its script
const SITE = 'https://salon.example';
const BK = 'https://db.example.supabase.co/functions/v1/presence/book/5e000000-0000-4000-8000-000000000149';
const widgetPage = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Book</title></head>
<body><main id="main"><h1>Book</h1><section class="block wrap block-booking"><div class="booking-widget" data-book="${BK}"><div class="bk-stage" aria-live="polite"><p class="bk-msg">Loading available times…</p></div></div></section>${bookingScript()}</main></body></html>`;
test('the widget’s “you’re booked” offers the calendar and the change-or-cancel link', async ({ page }) => {
  await page.route(`${SITE}/**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: widgetPage }));
  await page.route(`${BK}/ticket`, (route) => answer(route, 200, { data: { ticket: '', wait_s: 0 } }));
  await page.route(`${BK}/types`, (route) => answer(route, 200, { data: { enabled: true, intro: '', timezone: 'America/Los_Angeles', max_days_ahead: 60, types: [{ id: 'a1000000-0000-4000-8000-000000000149', name: 'Haircut', duration_min: 60, price_text: '$40', description: '' }] } }));
  await page.route(`${BK}/slots?**`, (route) => answer(route, 200, { data: { slots: ['2026-11-18T09:00'] } }));
  const links = { ...CAL, manage: `https://app.davisdigitalstudio.com/booking.html?t=${T}` };
  await page.route(BK, (route) => answer(route, 200, { data: { ok: true, message: 'You’re booked for Haircut. A confirmation is on its way.', status: 'confirmed', links } }));
  await page.goto(`${SITE}/book/`);
  await page.getByRole('button', { name: /Haircut/ }).click();
  await page.locator('.bk-date').fill('2026-11-18');
  await page.getByRole('button', { name: '9:00 AM' }).click();
  await page.getByLabel('Your name').fill('Sam Rivera');
  await page.getByLabel('Email').fill('sam@customer.example');
  await page.getByRole('button', { name: 'Confirm booking' }).click();
  await expect(page.locator('.bk-done-msg')).toHaveText('You’re booked for Haircut. A confirmation is on its way.', { timeout: 15_000 });
  const done = page.locator('.bk-done');
  await expect(done).toContainText('Add it to your calendar: Google · Outlook · Apple and others');
  await expect(done.getByRole('link', { name: 'Google' })).toHaveAttribute('href', CAL.google);
  await expect(done.getByRole('link', { name: 'Apple and others' })).toHaveAttribute('href', CAL.ics);
  await expect(done.getByRole('link', { name: 'Change or cancel this booking' })).toHaveAttribute('href', links.manage);
  await expect(done.getByRole('link', { name: 'Change or cancel this booking' })).toHaveAttribute('target', '_blank');
});

// The editor: two cards under "Your hours"
const API = {
  '/site': { data: { site: { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1 }, identity: { business_name: 'Marlow Salon', description: 'Hello' }, location: { city: 'Burbank' } } },
  '/settings': { data: { blocks: [], section_meta: { blocks: [], pages: {} }, pages: [] } },
  '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] }, '/media': { data: [] }, '/health': { data: {} }, '/notes': { data: [] }, '/moments': { data: [] },
  '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'h' } },
  '/dev/customization': { data: { theme_tokens: { accent: '#111111' }, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false } },
  '/schedule': { data: { scheduled: [] } }, '/content-library': { data: [] },
  '/bookings/types': { data: { types: [] } }, '/bookings/appointments': { data: { appointments: [], scope: 'upcoming', pending: 0 } },
  '/portal/context': { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES, is_agency: false, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'], landing: '/presence.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null } },
};
test.describe('the Bookings view’s own-calendar and changes cards', () => {
  test('connect a calendar: it’s read first; a bad one is said plainly; changes can be switched off', async ({ page }) => {
    const settings = { enabled: true, intro: '', weekly: [[], [], [], [], [], [], []], closed_dates: [], slot_interval_min: 30, buffer_min: 0, lead_time_hours: 2, max_days_ahead: 60, timezone: 'America/Los_Angeles', auto_confirm: true, self_manage: true, calendar: { on: false } };
    await installApp(page, { api: { ...API, '/bookings/settings': { data: settings } } });
    const puts: any[] = [];
    await page.route('**/functions/v1/presence/bookings/settings', (route: Route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      const b = route.request().postDataJSON(); puts.push(b);
      if (b.calendar_url === 'https://calendar.example/page') return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: 'calendar_not_calendar', message: 'That address opened a web page, not a calendar. Copy the private address in iCal format instead.' }) });
      if ('calendar_url' in b) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ok: true, self_manage: true, calendar: b.calendar_url ? { on: true, host: 'calendar.example', ok: true, busy: 2, read_at: new Date().toISOString() } : { on: false } } }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ok: true, self_manage: b.self_manage, calendar: { on: false } } }) });
    });
    await page.goto('/presence.html#bookings');
    const cal = page.locator('#bkCalendar');
    await expect(cal).toBeVisible();
    await expect(cal.getByRole('status')).toHaveText('Not connected. Bookings only avoid each other and your hours.');
    await expect(cal.getByRole('button', { name: 'Disconnect' })).toBeHidden();
    await cal.getByLabel('Your calendar’s private address').fill('https://calendar.example/page');
    await cal.getByRole('button', { name: 'Connect' }).click();
    await expect(cal.getByRole('status')).toHaveText('That address opened a web page, not a calendar. Copy the private address in iCal format instead.');
    await cal.getByLabel('Your calendar’s private address').fill('webcal://calendar.example/private/basic.ics');
    await cal.getByRole('button', { name: 'Connect' }).click();
    await expect(cal.getByRole('status')).toHaveText('Connected to calendar.example. 2 busy times ahead are kept off your booking page. Checked just now.');
    await expect(cal.getByLabel('Your calendar’s private address')).toHaveValue('');
    await expect(cal.getByRole('button', { name: 'Disconnect' })).toBeVisible();
    const changes = page.locator('#bkChanges');
    await expect(changes).toContainText('Up to 2 hours before, the same notice a new booking needs');
    const box = changes.getByLabel('Let customers pick another time or cancel from their booking emails');
    await expect(box).toBeChecked();
    await box.uncheck();
    await expect.poll(() => puts.length).toBe(3);
    expect(puts).toEqual([{ calendar_url: 'https://calendar.example/page' }, { calendar_url: 'webcal://calendar.example/private/basic.ics' }, { self_manage: false }]);
    await cal.getByRole('button', { name: 'Disconnect' }).click();
    await expect(cal.getByRole('status')).toHaveText('Not connected. Bookings only avoid each other and your hours.');
    expect(puts[3]).toEqual({ calendar_url: '' });
  });
});
