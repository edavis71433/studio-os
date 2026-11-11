// ── Builder list item 149: a customer changes or cancels their own booking ────
//   deno run --allow-read --allow-env --allow-net tests/presence/booking_manage_test.mjs
// Part A: the customer's links (lib/booking_links.ts): the signed link, when it still works,
// the calendar file, Google and Outlook, the email lines. Part B drives the /book/manage
// routes booking.html calls, on a fake database: reading changes nothing; moving checks
// the time is open (its own time aside) and follows the owner's confirm rule; cancelling
// frees the time; the customer and the owner hear at once; too close to the time, or with
// changes off, it says how to reach the business. Part C: a new booking answers with the
// links and its confirmation carries them and the file. Part D: the owner's own calendar:
// read before it's kept, never shown back, busy times off the booking page, a stale copy
// refreshed, a broken one failing open, private addresses refused unread. Part E: the
// reminder carries the links too, and the change link only while it still works.
import { installFakePostgrest } from './fake_pgrst.mjs';

const results = [];
const ok = (n, p, note = '') => { results.push(!!p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const KEY = 'test-approval-secret';
Deno.env.set('APPROVAL_SECRET', KEY);
Deno.env.set('RESEND_KEY', 'test-resend-key');
Deno.env.set('APP_URL', 'https://app.example');
const db = installFakePostgrest({ unique: {
  presence_appointments: [{ cols: ['site_id', 'slot_start_local'], where: (r) => ['pending', 'confirmed'].includes(r.status) }],
  presence_plan_notices: [['client_id', 'kind', 'period']],
} });
const fake = globalThis.fetch;
const emails = [], outbound = [];
const CAL = new Map();   // a calendar's address → what it answers
let busyLimit = true;    // false: the once-a-minute calendar read is refused, as if another visitor's had just started
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes('/rest/v1/rpc/rate_hit')) {
    const allow = busyLimit || !String(JSON.parse(String(init.body || '{}')).p_bucket || '').startsWith('book:busy:');
    return new Response(String(allow), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (u.startsWith('https://api.resend.com/')) { emails.push(JSON.parse(String(init.body || '{}'))); return new Response(JSON.stringify({ id: 'e1' }), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
  if (!u.startsWith('https://db.test/')) {
    outbound.push(u);
    const c = CAL.get(u);
    if (c?.delay) { await new Promise((r) => setTimeout(r, c.delay)); c.landed = (c.landed || 0) + 1; }
    return c ? new Response(c.body ?? '', { status: c.status || 200, headers: { 'Content-Type': c.type || 'text/calendar', ...(c.headers || {}) } }) : new Response('nope', { status: 404 });
  }
  return fake(url, init);
};
// the address check looks names up; here every name is public but one
Object.defineProperty(Deno, 'resolveDns', { configurable: true, value: async (host) => (host === 'intranet.example' ? ['10.0.0.5'] : ['93.184.216.34']) });

const P = '../../supabase/functions/presence';
const BL = await import(`${P}/lib/booking_links.ts`);
const R = await import(`${P}/routes/booking.ts`);
const { runBookingReminders } = await import(`${P}/commerce/lifecycle.ts`);
const { humanSlot } = await import(`${P}/lib/booking.ts`);
const { wallToUtc, utcToWall, wallString } = await import(`${P}/lib/zoned_time.ts`);
const { RESERVED_NAMES } = await import(`${P}/lib/reserved_store.ts`);

const SID = '5e000000-0000-4000-8000-000000000149';
const CLIENT = 'c1000000-0000-4000-8000-000000000149';
const TYPE = 'a1000000-0000-4000-8000-000000000149';
const APPT = 'b1000000-0000-4000-8000-000000000001';
const KIM = 'b1000000-0000-4000-8000-000000000002';
const LA = 'America/Los_Angeles';
const FN = 'https://db.test/functions/v1/presence';
const localAt = (ms) => wallString(utcToWall(ms, LA));
const day = (n) => localAt(Date.now() + n * 86400_000).slice(0, 10);
const instant = (local) => new Date(wallToUtc(Date.parse(local + ':00Z'), LA)).toISOString();
const D3 = day(3), D4 = day(4);
const appt = (over = {}) => {
  const local = over.slot_start_local || `${D3}T10:00`;
  return { id: APPT, site_id: SID, type_id: TYPE, type_name: 'Haircut', contact_id: null, slot_start: instant(local), slot_end: new Date(Date.parse(instant(local)) + 3600_000).toISOString(), slot_start_local: local, duration_min: 60, timezone: LA, price_cents: 4000, customer_name: 'Sam Rivera', customer_email: 'sam@customer.example', customer_phone: '', note: '', status: 'confirmed', source: 'website', created_at: '2026-11-08T12:00:00.000Z', updated_at: '2026-11-08T12:00:00.000Z', canceled_at: null, ...over };
};
const HOURS = Array.from({ length: 7 }, () => [{ start: '09:00', end: '17:00' }]);
const seed = (o = {}) => {
  db.reset({
    presence_sites: [{ id: SID, client_id: CLIENT, status: 'ready', custom_domain: 'salon.example', netlify_site_id: 'nf-1', last_published_at: '2026-11-01T00:00:00Z' }],
    presence_identity: [{ site_id: SID, business_name: 'Marlow Salon', email: 'hello@salon.example', phone: '(555) 123-4567' }],
    presence_locations: [{ site_id: SID, address_line1: '12 Main St', address_line2: '', city: 'Burbank', region: 'CA', postal_code: '91502', phone: '' }],
    presence_booking_settings: [{ site_id: SID, enabled: o.enabled ?? true, intro: '', weekly: HOURS, closed_dates: [], slot_interval_min: 30, buffer_min: 0, lead_time_hours: 2, max_days_ahead: 60, timezone: LA, auto_confirm: o.autoConfirm ?? true }],
    presence_appointment_types: [{ id: TYPE, site_id: SID, name: 'Haircut', duration_min: 60, price_cents: 4000, description: '', active: true, sort_order: 0, deleted_at: null }],
    presence_appointments: o.appts || [appt(), appt({ id: KIM, slot_start_local: `${D3}T14:00`, customer_name: 'Kim Ito', customer_email: 'kim@customer.example' })],
    presence_plan_notices: [
      { id: 'n-appt', site_id: SID, client_id: CLIENT, kind: 'new_booking', period: `appt:${APPT}`, status: 'active', headline: 'New booking', body: '' },
      { id: 'n-rem', site_id: SID, client_id: CLIENT, kind: 'booking_reminder', period: `remind:${APPT}:day_before`, status: 'dismissed', headline: 'Reminder sent', body: '' },
      { id: 'n-kim', site_id: SID, client_id: CLIENT, kind: 'booking_reminder', period: `remind:${KIM}:day_before`, status: 'dismissed', headline: 'Reminder sent', body: '' },
    ],
    presence_sales_templates: o.reserved || [],
  });
  emails.length = 0; outbound.length = 0;
};
const reserved = (name, value) => ({ id: crypto.randomUUID(), site_id: SID, kind: 'proposal', name, title: '', body: JSON.stringify(value), deleted_at: null, created_at: '2026-11-08T12:00:00.000Z', updated_at: '2026-11-08T12:00:00.000Z' });
const readReserved = (name) => { const r = (db.tables.presence_sales_templates || []).find((x) => x.name === name && x.site_id === SID); return r ? JSON.parse(r.body) : null; };
const row = (id = APPT) => (db.tables.presence_appointments || []).find((a) => a.id === id);
const notice = (period) => (db.tables.presence_plan_notices || []).find((n) => n.period === period);
const ip = { 'x-forwarded-for': '203.0.113.7' };
const get = (path) => new Request(`${FN}${path}`, { headers: ip });
const post = (path, b) => new Request(`${FN}${path}`, { method: 'POST', headers: { ...ip, 'content-type': 'application/json' }, body: JSON.stringify(b) });
const put = (b) => new Request(`${FN}/bookings/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const out = async (r) => { try { return await r.json(); } catch { return null; } };
// the emails and notes go out after the answer; a busy machine can take seconds, so the cap is generous
const settle = async (check, ms = 10_000) => { const end = Date.now() + ms; while (Date.now() < end) { if (check()) return true; await new Promise((r) => setTimeout(r, 15)); } return check(); };
const sentTo = (addr) => emails.filter((e) => e.to === addr || (Array.isArray(e.to) && e.to.includes(addr)));
const unb64 = (s) => new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
const SITE = { id: SID, client_id: CLIENT };
const OWNER = { kind: 'client', userId: 'u-owner', email: 'owner@salon.example', jwt: 'x' };
const T = await BL.manageToken(APPT);

// ═══ A · the customer's links ═══
ok('link: a booking’s link reads back as that booking', T.startsWith(`${APPT}.`) && (await BL.readManageToken(T)) === APPT);
ok('link: changed by one character, made with another key, or for no booking: not a link', (await BL.readManageToken(T.slice(0, -1) + (T.endsWith('0') ? '1' : '0'))) === null && (await BL.readManageToken(await BL.manageToken(APPT, 'another-key'))) === null && (await BL.readManageToken('junk')) === null && (await BL.manageToken('not-an-id')) === '');
ok('link: with no key set, no link is offered', (await BL.manageToken(APPT, '')) === '' && (await BL.readManageToken(T, '')) === null);
{
  const now = Date.now(), at = (h) => new Date(now + h * 3600_000).toISOString(), o = { selfManage: true, leadHours: 2 };
  ok('until: open while further off than the notice a new booking needs', BL.manageState({ status: 'confirmed', slot_start: at(3) }, o, now) === 'open' && BL.manageState({ status: 'pending', slot_start: at(3) }, o, now) === 'open');
  ok('until: inside that notice, too late; with no notice set, until the time itself', BL.manageState({ status: 'confirmed', slot_start: at(1) }, o, now) === 'too_late' && BL.manageState({ status: 'confirmed', slot_start: at(0.1) }, { selfManage: true, leadHours: 0 }, now) === 'open');
  ok('until: changes switched off; passed; canceled; finished', BL.manageState({ status: 'confirmed', slot_start: at(30) }, { selfManage: false, leadHours: 2 }, now) === 'off' && BL.manageState({ status: 'confirmed', slot_start: at(-1) }, o, now) === 'past' && BL.manageState({ status: 'canceled', slot_start: at(30) }, o, now) === 'canceled' && BL.manageState({ status: 'no_show', slot_start: at(-30) }, o, now) === 'done');
}
{
  const e = { id: APPT, title: 'Cut, color; style with Marlow Salon', startMs: Date.parse('2026-11-17T18:00:00Z'), endMs: Date.parse('2026-11-17T19:00:00Z'), location: '12 Main St, Burbank, CA 91502', details: `Booked online with Marlow Salon.\nTo change or cancel: https://app.example/booking.html?t=${T}`, url: `https://app.example/booking.html?t=${T}`, pending: true, sequence: 29_000_000 };
  const ics = BL.bookingIcs(e, '2026-11-11T08:00:00Z');
  const lines = ics.split('\r\n');
  ok('file: one event, our id, its instants, words escaped, waiting shown as tentative', ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n') && ics.includes(`UID:appt-${APPT}@studio-os`) && ics.includes('DTSTART:20261117T180000Z') && ics.includes('DTEND:20261117T190000Z') && ics.includes('SUMMARY:Cut\\, color\\; style with Marlow Salon') && ics.includes('LOCATION:12 Main St\\, Burbank\\, CA 91502') && ics.includes('STATUS:TENTATIVE') && ics.includes('SEQUENCE:29000000') && ics.includes('METHOD:PUBLISH'));
  ok('file: no line longer than 75 bytes (calendars refuse longer ones)', lines.every((l) => new TextEncoder().encode(l).length <= 75));
  const g = new URL(BL.googleCalendarLink(e)), o = new URL(BL.outlookCalendarLink(e));
  ok('Google: the event filled in', g.origin === 'https://calendar.google.com' && g.searchParams.get('action') === 'TEMPLATE' && g.searchParams.get('text') === e.title && g.searchParams.get('dates') === '20261117T180000Z/20261117T190000Z' && g.searchParams.get('location') === e.location && g.searchParams.get('details') === e.details);
  ok('Outlook: the event filled in', o.origin === 'https://outlook.live.com' && o.searchParams.get('rru') === 'addevent' && o.searchParams.get('subject') === e.title && o.searchParams.get('startdt') === '2026-11-17T18:00:00Z' && o.searchParams.get('enddt') === '2026-11-17T19:00:00Z');
  const links = { google: 'https://g.example/?a=1&b=2', outlook: 'https://o.example/', ics: 'https://f.example/x.ics', manage: 'https://app.example/booking.html?t=x' };
  const yes = BL.bookingLinksHtml(links, true), no = BL.bookingLinksHtml(links, false);
  ok('email: the calendar line, and the change link while it works', yes.includes('Add it to your calendar:') && yes.includes('>Google</a> · <a') && yes.includes('>Apple and others</a>') && yes.includes('href="https://g.example/?a=1&amp;b=2"') && yes.includes('>Pick another time or cancel</a>, or just reply to this email.'));
  ok('email: once it doesn’t, "just reply" as before', !no.includes('Pick another time') && no.includes('Need to change or cancel? Just reply to this email.') && no.includes('Add it to your calendar:'));
  const att = BL.icsAttachment('SUMMARY:Café\r\n');
  ok('email: the file attached as booking.ics, accents intact', att.filename === 'booking.ics' && new TextDecoder().decode(att.content) === 'SUMMARY:Café\r\n');
}

// ═══ B · the customer's page ═══
seed();
{
  const r = await R.handleManageGet(get(`/book/manage?t=${encodeURIComponent(T)}`), {});
  const d = (await out(r))?.data || {};
  ok('read: the booking as the page shows it', r.status === 200 && d.business === 'Marlow Salon' && d.service === 'Haircut' && d.when === humanSlot(`${D3}T10:00`) && d.status === 'confirmed' && d.state === 'open' && d.can_move === true && d.date === D3 && d.max_days_ahead === 60 && d.price === '$40', JSON.stringify(d));
  ok('read: the business’s phone and email, its site, and the calendar links', d.reach?.tel === '(555) 123-4567' && d.reach?.mail === 'hello@salon.example' && d.site_url === 'https://salon.example' && d.calendar?.google?.startsWith('https://calendar.google.com/') && d.calendar?.ics === `${FN}/book/manage/calendar.ics?t=${encodeURIComponent(T)}`);
  ok('read: reading changed nothing', row().status === 'confirmed' && row().slot_start_local === `${D3}T10:00` && db.writes('presence_appointments').length === 0);
  for (const bad of ['', 'junk', T.slice(0, -2) + 'ff', await BL.manageToken('b1000000-0000-4000-8000-0000000000ff')]) {
    const x = await R.handleManageGet(get(`/book/manage?t=${encodeURIComponent(bad)}`), {});
    ok(`read: a link that isn’t one (${bad ? bad.slice(-6) : 'empty'}) says so`, x.status === 404 && (await out(x))?.message === 'That link didn’t work.');
  }
}
{
  const r = await R.handleManageSlots(get(`/book/manage/slots?t=${encodeURIComponent(T)}&date=${D3}`), {});
  const s = ((await out(r))?.data?.slots || []).map((x) => x.slice(11));
  ok('times: its own time doesn’t block the times beside it, and isn’t offered', s.includes('09:30') && s.includes('10:30') && !s.includes('10:00'), s.join(' '));
  ok('times: someone else’s booking still does', !s.includes('13:30') && !s.includes('14:00') && !s.includes('14:30') && s.includes('13:00') && s.includes('15:00'), s.join(' '));
}
{
  const r = await R.handleManagePost(post('/book/manage', { t: T, action: 'move', slot: `${D3}T14:00` }), {});
  ok('move: onto someone else’s time is refused, and nothing changes', r.status === 409 && (await out(r))?.error === 'slot_taken' && row().slot_start_local === `${D3}T10:00`);
  const bad = await R.handleManagePost(post('/book/manage', { t: T, action: 'move', slot: 'tomorrow' }), {});
  const same = await R.handleManagePost(post('/book/manage', { t: T, action: 'move', slot: `${D3}T10:00` }), {});
  const what = await R.handleManagePost(post('/book/manage', { t: T, action: 'explode' }), {});
  ok('move: a time that isn’t one, the time it has, or no action: said plainly', bad.status === 400 && same.status === 400 && (await out(same))?.message === 'That’s the time you have already.' && what.status === 400);
}
{
  const r = await R.handleManagePost(post('/book/manage', { t: T, action: 'move', slot: `${D4}T11:00` }), {});
  const d = (await out(r))?.data || {};
  const a = row();
  ok('move: to an open time — moved, still confirmed (the owner confirms automatically)', r.status === 200 && d.ok && d.status === 'confirmed' && d.message === `Your booking has moved to ${humanSlot(`${D4}T11:00`)}. A new confirmation is on its way.`, JSON.stringify(d));
  ok('move: the stored times follow, in the business’s zone', a.slot_start_local === `${D4}T11:00` && a.slot_start === instant(`${D4}T11:00`) && a.slot_end === instant(`${D4}T12:00`) && a.status === 'confirmed');
  await settle(() => emails.length >= 2 && !notice(`remind:${APPT}:day_before`));
  ok('move: the reminders follow the new time (the old one’s are forgotten, nobody else’s)', !notice(`remind:${APPT}:day_before`) && !!notice(`remind:${KIM}:day_before`));
  const c = sentTo('sam@customer.example')[0];
  ok('move: the customer gets the new time, the old one, the links and the file', c && c.subject === 'Your booking has moved — Haircut' && c.html.includes(humanSlot(`${D4}T11:00`)) && c.html.includes(`>Was</td><td>${humanSlot(`${D3}T10:00`)}`) && c.html.includes('Pick another time or cancel') && c.attachments?.[0]?.filename === 'booking.ics' && unb64(c.attachments[0].content).includes(`DTSTART:${instant(`${D4}T11:00`).replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`) && c.reply_to === 'hello@salon.example', JSON.stringify(c && { s: c.subject, r: c.reply_to }));
  const n = (db.tables.presence_plan_notices || []).find((x) => x.period.startsWith(`moved:${APPT}:`));
  const own = sentTo('hello@salon.example')[0];
  ok('move: the owner is told at once, on the bell and by email', n && n.kind === 'new_booking' && n.status === 'active' && n.headline === `Booking moved: Haircut — now ${humanSlot(`${D4}T11:00`)}` && n.body === `Sam Rivera moved it from ${humanSlot(`${D3}T10:00`)}.` && own && own.subject === 'Booking moved — Haircut' && own.html.includes('sam@customer.example'), JSON.stringify(n));
}
{
  seed({ autoConfirm: false });
  const r = await R.handleManagePost(post('/book/manage', { t: T, action: 'move', slot: `${D4}T09:00` }), {});
  const d = (await out(r))?.data || {};
  ok('move: when the owner confirms each booking, a moved one waits for their OK again', r.status === 200 && d.status === 'pending' && row().status === 'pending' && d.message.endsWith('Marlow Salon will confirm the new time shortly.'));
  await settle(() => (db.tables.presence_plan_notices || []).some((x) => x.period.startsWith(`moved:${APPT}:`)));
  ok('move: …and the owner’s note says so', (db.tables.presence_plan_notices || []).find((x) => x.period.startsWith(`moved:${APPT}:`))?.body.endsWith('The new time waits for your OK.'));
  const again = await R.handleManagePost(post('/book/manage', { t: T, action: 'move', slot: `${D4}T13:00` }), {});
  await settle(() => (db.tables.presence_plan_notices || []).filter((x) => x.period.startsWith(`moved:${APPT}:`)).length === 2);
  ok('move: moving again tells the owner again', again.status === 200 && (db.tables.presence_plan_notices || []).filter((x) => x.period.startsWith(`moved:${APPT}:`)).length === 2);
}
{
  seed();
  const r = await R.handleManagePost(post('/book/manage', { t: T, action: 'cancel' }), {});
  const d = (await out(r))?.data || {};
  ok('cancel: canceled, and the customer is told the business knows', r.status === 200 && d.status === 'canceled' && d.message === 'Your booking is canceled. Marlow Salon has been told.' && row().status === 'canceled' && !!row().canceled_at);
  await settle(() => emails.length >= 2 && notice(`appt:${APPT}`)?.status === 'dismissed' && !!notice(`canceled:${APPT}`));
  const c = sentTo('sam@customer.example')[0], own = sentTo('hello@salon.example')[0];
  ok('cancel: the customer’s note says they canceled it', c && c.subject === 'Booking canceled — Haircut' && c.html.includes('You canceled your booking with Marlow Salon, and they’ve been told.') && c.html.includes('If it’s in your calendar, you can delete it there.'));
  ok('cancel: the owner is told at once; the "new booking" card is put away', notice(`canceled:${APPT}`)?.headline === `Booking canceled: Haircut — ${humanSlot(`${D3}T10:00`)}` && notice(`canceled:${APPT}`)?.status === 'active' && notice(`appt:${APPT}`)?.status === 'dismissed' && own?.subject === 'Booking canceled — Haircut');
  const view = (await out(await R.handleManageGet(get(`/book/manage?t=${encodeURIComponent(T)}`), {})))?.data || {};
  const twice = await R.handleManagePost(post('/book/manage', { t: T, action: 'cancel' }), {});
  ok('cancel: afterwards the page shows it canceled, with no calendar links, and a second cancel says so', view.state === 'canceled' && view.calendar === null && twice.status === 409 && (await out(twice))?.message === 'This booking was canceled.');
  const ics = await R.handleManageIcs(get(`/book/manage/calendar.ics?t=${encodeURIComponent(T)}`));
  ok('cancel: its calendar file is gone too', ics.status === 410);
  const free = ((await out(await R.handleBookingSlots(get(`/book/${SID}/slots?type=${TYPE}&date=${D3}`), SID, {})))?.data?.slots || []).map((x) => x.slice(11));
  ok('cancel: the time is free for others again', free.includes('10:00'), free.join(' '));
}
{
  const soon = Date.now() + 60 * 60_000;
  seed({ appts: [appt({ slot_start_local: localAt(soon), slot_start: new Date(soon).toISOString(), slot_end: new Date(soon + 3600_000).toISOString() })] });
  const v = (await out(await R.handleManageGet(get(`/book/manage?t=${encodeURIComponent(T)}`), {})))?.data || {};
  const r = await R.handleManagePost(post('/book/manage', { t: T, action: 'cancel' }), {});
  const b = await out(r);
  const s = (await out(await R.handleManageSlots(get(`/book/manage/slots?t=${encodeURIComponent(T)}&date=${D4}`), {})))?.data?.slots;
  ok('too late: inside the notice a booking needs, the page says so, with the calendar links still', v.state === 'too_late' && v.can_move === false && !!v.calendar?.google);
  ok('too late: and a cancel is refused with the reason and the booking as it is', r.status === 409 && b?.error === 'too_late' && b?.message.startsWith('It’s too close to the time') && b?.data?.state === 'too_late' && row().status === 'confirmed' && Array.isArray(s) && s.length === 0);
}
{
  seed({ reserved: [reserved(RESERVED_NAMES.bookingOptions, { self_manage: false, calendar_url: '', calendar_host: '' })] });
  const v = (await out(await R.handleManageGet(get(`/book/manage?t=${encodeURIComponent(T)}`), {})))?.data || {};
  const r = await R.handleManagePost(post('/book/manage', { t: T, action: 'cancel' }), {});
  ok('switched off: the page says to get in touch, and nothing can change', v.state === 'off' && r.status === 409 && (await out(r))?.error === 'off' && row().status === 'confirmed');
}
{
  seed({ enabled: false });
  const v = (await out(await R.handleManageGet(get(`/book/manage?t=${encodeURIComponent(T)}`), {})))?.data || {};
  const mv = await R.handleManagePost(post('/book/manage', { t: T, action: 'move', slot: `${D4}T11:00` }), {});
  const cx = await R.handleManagePost(post('/book/manage', { t: T, action: 'cancel' }), {});
  ok('booking off: no moving, but a customer can still cancel', v.state === 'open' && v.can_move === false && mv.status === 409 && (await out(mv))?.error === 'disabled' && cx.status === 200 && row().status === 'canceled');
}
{
  seed({ appts: [appt({ slot_start: new Date(Date.now() - 7200_000).toISOString(), slot_start_local: localAt(Date.now() - 7200_000) })] });
  ok('passed: a booking whose time has gone says so', ((await out(await R.handleManageGet(get(`/book/manage?t=${encodeURIComponent(T)}`), {})))?.data || {}).state === 'past');
}
{
  seed();
  const r = await R.handleManageIcs(get(`/book/manage/calendar.ics?t=${encodeURIComponent(T)}`));
  const text = await r.text();
  ok('file: "Apple and others" opens the booking as a calendar file', r.status === 200 && r.headers.get('content-type')?.startsWith('text/calendar') && r.headers.get('content-disposition') === 'attachment; filename="booking.ics"' && text.includes('SUMMARY:Haircut with Marlow Salon') && text.includes('LOCATION:12 Main St\\, Burbank\\, CA 91502') && text.replace(/\r\n /g, '').includes(`URL:https://app.example/booking.html?t=${T}`));
  ok('file: a link that isn’t one gets no file', (await R.handleManageIcs(get('/book/manage/calendar.ics?t=junk'))).status === 404);
}

// ═══ C · a new booking answers with the links ═══
{
  seed();
  const r = await R.handleBookingCreate(post(`/book/${SID}`, { type_id: TYPE, slot_start: `${D4}T15:00`, name: 'Lee Park', email: 'lee@customer.example', phone: '', note: '', _hp: '' }), SID, {});
  const d = (await out(r))?.data || {};
  const made = (db.tables.presence_appointments || []).find((a) => a.slot_start_local === `${D4}T15:00`);
  const t = new URL(d.links?.manage || 'https://x.example/').searchParams.get('t');
  ok('book: the answer carries the calendar links and the change link, for this booking', r.status === 200 && d.links?.google?.startsWith('https://calendar.google.com/') && d.links?.outlook?.startsWith('https://outlook.live.com/') && d.links?.ics?.startsWith(`${FN}/book/manage/calendar.ics?t=`) && d.links?.manage?.startsWith('https://app.example/booking.html?t=') && (await BL.readManageToken(t)) === made?.id, JSON.stringify(d.links));
  await settle(() => sentTo('lee@customer.example').length === 1);
  const c = sentTo('lee@customer.example')[0];
  ok('book: the confirmation ends with them and carries the file, not "just reply" alone', c?.subject === 'Your booking is confirmed — Haircut' && c.html.includes('Add it to your calendar:') && c.html.includes('Pick another time or cancel') && c.attachments?.[0]?.filename === 'booking.ics');
  const p = await R.handleBookingCreate(post(`/book/${SID}`, { type_id: TYPE, slot_start: `${D4}T16:00`, name: 'Ray', email: '', phone: '555 222 3333', note: '', _hp: '' }), SID, {});
  ok('book: someone who left only a phone number gets the links on the page', p.status === 200 && !!(await out(p))?.data?.links?.manage);
  // the same time sent again with Lee's email (a slow first try, or someone who knows it): it reads as Lee's
  // booking, but nothing that opens it is handed out, so knowing an email and a time can't cancel anybody
  const lee = (db.tables.presence_appointments || []).find((a) => a.slot_start_local === `${D4}T15:00`);
  lee.created_at = new Date().toISOString();   // the fake's own clock is days behind; the match looks back ten minutes
  const again = await R.handleBookingCreate(post(`/book/${SID}`, { type_id: TYPE, slot_start: `${D4}T15:00`, name: 'Somebody', email: 'LEE@customer.example', phone: '', note: '', _hp: '' }), SID, {});
  const text = JSON.stringify(await out(again));
  ok('book: a second send for the same time and email says booked, without the private link or the file', again.status === 200 && text.includes('You’re booked') && !text.includes(`${lee.id}.`) && !text.includes('booking.html') && !text.includes('calendar.ics') && JSON.parse(text).data.links?.google?.startsWith('https://calendar.google.com/'), text);
}

// ═══ D · the owner's own calendar ═══
const ADDR = 'https://calendar.example/private-abc123/basic.ics';
const vcal = (...ev) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...ev.flat(), 'END:VCALENDAR'].join('\r\n');
const busyNoon = (d) => ['BEGIN:VEVENT', 'UID:dentist', 'SUMMARY:Dentist', `DTSTART;TZID=America/Los_Angeles:${d.replace(/-/g, '')}T120000`, `DTEND;TZID=America/Los_Angeles:${d.replace(/-/g, '')}T130000`, 'END:VEVENT'];
const publicTimes = async (d = D3) => ((await out(await R.handleBookingSlots(get(`/book/${SID}/slots?type=${TYPE}&date=${d}`), SID, {})))?.data?.slots || []).map((x) => x.slice(11));
{
  seed();
  CAL.set(ADDR, { body: vcal(busyNoon(D3)) });
  const r = await R.handleBookingSettingsPut(put({ calendar_url: 'webcal://calendar.example/private-abc123/basic.ics' }), SITE, OWNER, {});
  const text = JSON.stringify(await out(r));
  const d = JSON.parse(text).data || {};
  ok('connect: read before it’s kept; the owner sees where, how many busy times, and when', r.status === 200 && d.calendar?.on === true && d.calendar?.host === 'calendar.example' && d.calendar?.ok === true && d.calendar?.busy === 1 && !!d.calendar?.read_at, text);
  ok('connect: the private address never comes back to a page', !text.includes('private-abc123') && !JSON.stringify(await out(await R.handleBookingSettingsGet(SITE, {}))).includes('private-abc123'));
  ok('connect: kept in its own private row, with only times read from it', readReserved(RESERVED_NAMES.bookingOptions)?.calendar_url === ADDR && Array.isArray(readReserved(RESERVED_NAMES.bookingBusy)?.ranges) && !JSON.stringify(readReserved(RESERVED_NAMES.bookingBusy)).includes('Dentist'));
  ok('connect: the hours weren’t touched', JSON.stringify(db.tables.presence_booking_settings[0].weekly) === JSON.stringify(HOURS));
  const hits = outbound.length;
  const s = await publicTimes();
  ok('busy: the dentist keeps 11:30 to 12:30 off the booking page; 11:00 and 13:00 stay', !s.includes('11:30') && !s.includes('12:00') && !s.includes('12:30') && s.includes('11:00') && s.includes('13:00'), s.join(' '));
  ok('busy: within ten minutes the kept copy is used, not read again', outbound.length === hits);
  const mv = await R.handleManagePost(post('/book/manage', { t: T, action: 'move', slot: `${D3}T12:00` }), {});
  ok('busy: a customer can’t move onto one', mv.status === 409 && row().slot_start_local === `${D3}T10:00`);
  const b = await R.handleBookingCreate(post(`/book/${SID}`, { type_id: TYPE, slot_start: `${D3}T12:00`, name: 'Pat', email: 'pat@customer.example', phone: '', note: '', _hp: '' }), SID, {});
  ok('busy: nor can a booking sent for one anyway', b.status === 409 && (await out(b))?.error === 'slot_taken' && !(db.tables.presence_appointments || []).some((a) => a.slot_start_local === `${D3}T12:00`));
}
{
  // twenty minutes on: the kept copy answers at once, and a fresh read follows
  const c = readReserved(RESERVED_NAMES.bookingBusy);
  const old = new Date(Date.now() - 20 * 60_000).toISOString();
  db.tables.presence_sales_templates.find((x) => x.name === RESERVED_NAMES.bookingBusy).body = JSON.stringify({ ...c, at: old, tried: old });
  CAL.set(ADDR, { body: vcal(busyNoon(D3), busyNoon(D4)) });
  const hits = outbound.length;
  const s = await publicTimes();
  ok('stale: the kept copy answers at once', !s.includes('12:00'));
  await settle(() => outbound.length > hits && readReserved(RESERVED_NAMES.bookingBusy)?.tried !== old);
  ok('stale: …and the calendar is read again behind it', outbound.length === hits + 1 && readReserved(RESERVED_NAMES.bookingBusy)?.at !== old && !(await publicTimes(D4)).includes('12:00'));
}
{
  // seven hours on, and the calendar has stopped answering: bookings still come in
  const c = readReserved(RESERVED_NAMES.bookingBusy);
  const old = new Date(Date.now() - 7 * 3600_000).toISOString();
  db.tables.presence_sales_templates.find((x) => x.name === RESERVED_NAMES.bookingBusy).body = JSON.stringify({ ...c, at: old, tried: old });
  CAL.set(ADDR, { status: 500, body: 'down' });
  const s = await publicTimes();
  const st = ((await out(await R.handleBookingSettingsGet(SITE, {})))?.data || {}).calendar || {};
  ok('broken: a calendar that can’t be read keeps nothing off (bookings still come in)', s.includes('12:00'), s.join(' '));
  ok('broken: and the owner’s Bookings view says it couldn’t be read', st.on === true && st.ok === false && st.error === 'unreachable');
}
{
  // the owner swaps calendars while a visitor's read of the old one is still on its way
  const A = 'https://calendar.example/a.ics', B = 'https://calendar.example/b.ics';
  seed();
  CAL.set(A, { body: vcal(busyNoon(D3)) });
  await R.handleBookingSettingsPut(put({ calendar_url: A }), SITE, OWNER, {});
  const c = readReserved(RESERVED_NAMES.bookingBusy), old = new Date(Date.now() - 20 * 60_000).toISOString();
  db.tables.presence_sales_templates.find((x) => x.name === RESERVED_NAMES.bookingBusy).body = JSON.stringify({ ...c, at: old, tried: old });
  CAL.set(A, { body: vcal(busyNoon(D3)), delay: 400 });
  const three = (d) => ['BEGIN:VEVENT', 'UID:class', `DTSTART;TZID=America/Los_Angeles:${d.replace(/-/g, '')}T150000`, `DTEND;TZID=America/Los_Angeles:${d.replace(/-/g, '')}T160000`, 'END:VEVENT'];
  CAL.set(B, { body: vcal(three(D3)) });
  await publicTimes();                                                   // starts A's slow read behind the answer
  const swapped = await R.handleBookingSettingsPut(put({ calendar_url: B }), SITE, OWNER, {});
  await settle(() => (CAL.get(A).landed || 0) >= 1, 2000);               // A's read lands…
  await new Promise((r) => setTimeout(r, 200));                          // …and has had its chance to write
  busyLimit = false;                                                     // it used up this minute's read
  const s = await publicTimes();
  busyLimit = true;
  ok('swap: a late read of the old calendar doesn’t replace the new one', swapped.status === 200 && CAL.get(A).landed === 1 && !s.includes('15:00') && !s.includes('14:30') && s.includes('12:00'), s.join(' '));
}
{
  // the kept copy is seven hours old and another visitor's read has just started: keep what's known
  seed({ reserved: [reserved(RESERVED_NAMES.bookingOptions, { self_manage: true, calendar_url: ADDR, calendar_host: 'calendar.example' })] });
  CAL.set(ADDR, { body: vcal(busyNoon(D3)) });
  await R.handleBookingSettingsPut(put({ calendar_url: ADDR }), SITE, OWNER, {});
  const c = readReserved(RESERVED_NAMES.bookingBusy), old = new Date(Date.now() - 7 * 3600_000).toISOString();
  db.tables.presence_sales_templates.find((x) => x.name === RESERVED_NAMES.bookingBusy).body = JSON.stringify({ ...c, at: old, tried: old });
  busyLimit = false;
  const s = await publicTimes();
  busyLimit = true;
  ok('limit: while another read is under way, even an old copy keeps the busy times off', !s.includes('12:00') && s.includes('13:00'), s.join(' '));
}
for (const [name, addr, answer, error] of [
  ['an address that isn’t https', 'http://calendar.example/x.ics', null, 'calendar_bad'],
  ['a link that was reset', 'https://calendar.example/old.ics', { status: 404, body: 'gone' }, 'calendar_gone'],
  ['a web page', 'https://calendar.example/page', { body: '<!doctype html><title>Calendar</title>', type: 'text/html' }, 'calendar_not_calendar'],
  ['an address inside a private network', 'https://127.0.0.1/cal.ics', null, 'calendar_bad'],
  ['a name that points inside one', 'https://intranet.example/cal.ics', null, 'calendar_unreachable'],
  ['a redirect onto an address inside one', 'https://calendar.example/moved.ics', { status: 302, headers: { Location: 'https://[::ffff:7f00:1]/cal.ics' } }, 'calendar_unreachable'],
]) {
  seed();
  if (answer) CAL.set(addr, answer);
  const r = await R.handleBookingSettingsPut(put({ calendar_url: addr }), SITE, OWNER, {});
  const b = await out(r);
  ok(`refused: ${name} — said plainly, and nothing kept`, r.status === 422 && b?.error === error && b?.message === R.CALENDAR_SAY[error.replace('calendar_', '')] && !readReserved(RESERVED_NAMES.bookingOptions), JSON.stringify(b));
  if (error !== 'calendar_gone' && error !== 'calendar_not_calendar' && !addr.startsWith('http:')) ok(`refused: ${name} — never even asked`, !outbound.some((u) => /127\.0\.0\.1|intranet\.example|::ffff/.test(u)), outbound.join(' '));
}
{
  seed({ reserved: [reserved(RESERVED_NAMES.bookingOptions, { self_manage: true, calendar_url: ADDR, calendar_host: 'calendar.example' }), reserved(RESERVED_NAMES.bookingBusy, { for: 'k', at: new Date().toISOString(), tried: new Date().toISOString(), ok: true, ranges: [[Date.now() + 3600_000, Date.now() + 7200_000]] })] });
  const r = await R.handleBookingSettingsPut(put({ self_manage: false }), SITE, OWNER, {});
  ok('switch: turning changes off keeps the calendar and the hours', r.status === 200 && (await out(r))?.data?.self_manage === false && readReserved(RESERVED_NAMES.bookingOptions)?.calendar_url === ADDR && JSON.stringify(db.tables.presence_booking_settings[0].weekly) === JSON.stringify(HOURS));
  const off = await R.handleBookingSettingsPut(put({ calendar_url: '' }), SITE, OWNER, {});
  const g = (await out(await R.handleBookingSettingsGet(SITE, {})))?.data || {};
  ok('disconnect: the address is forgotten, and the busy times read from it; the switch stays as set', off.status === 200 && g.calendar?.on === false && g.self_manage === false && readReserved(RESERVED_NAMES.bookingOptions)?.calendar_url === '' && readReserved(RESERVED_NAMES.bookingBusy)?.ranges.length === 0);
  const full = await R.handleBookingSettingsPut(put({ enabled: true, weekly: HOURS, slot_interval_min: 30, timezone: LA }), SITE, OWNER, {});
  ok('the full hours save still saves the hours (unchanged)', full.status === 200 && (await out(full))?.data?.enabled === true);
}

// ═══ E · the reminder ═══
{
  const tomorrow = Date.now() + 20 * 3600_000, soon = Date.now() + 90 * 60_000;
  const R1 = 'b1000000-0000-4000-8000-000000000011', R2 = 'b1000000-0000-4000-8000-000000000012';
  seed({ appts: [
    appt({ id: R1, slot_start: new Date(tomorrow).toISOString(), slot_end: new Date(tomorrow + 3600_000).toISOString(), slot_start_local: localAt(tomorrow), customer_email: 'sam@customer.example' }),
    appt({ id: R2, slot_start: new Date(soon).toISOString(), slot_end: new Date(soon + 3600_000).toISOString(), slot_start_local: localAt(soon), customer_email: 'kim@customer.example' }),
  ] });
  const r = await runBookingReminders(10);
  const a = sentTo('sam@customer.example')[0], b = sentTo('kim@customer.example')[0];
  ok('reminder: both go out', r.reminded === 2 && !!a && !!b, JSON.stringify(r));
  ok('reminder: tomorrow’s carries the calendar links, the change link and the file', a?.html.includes('Add it to your calendar:') && a.html.includes('Pick another time or cancel') && a.attachments?.[0]?.filename === 'booking.ics');
  ok('reminder: inside the notice a booking needs, "just reply" instead of the change link', b?.html.includes('Add it to your calendar:') && !b.html.includes('Pick another time') && b.html.includes('Just reply to this email.'));
}

// ═══ F · the page and the editor's cards ═══
{
  const ROOT = new URL('../../', import.meta.url);
  const page = Deno.readTextFileSync(new URL('booking.html', ROOT));
  ok('booking.html: hidden from search, sends no address on, and only acts on a press', page.includes('<meta name="robots" content="noindex,nofollow">') && page.includes('<meta name="referrer" content="no-referrer">') && (page.match(/call\('POST'/g) || []).length === 2 && !/load\(\);[\s\S]*call\('POST'/.test(page.split("if(!/^[0-9a-f-]{36}")[1] || ''));
  const cards = Deno.readTextFileSync(new URL('booking-extras.js', ROOT));
  const builder = Deno.readTextFileSync(new URL('presence.html', ROOT));
  ok('editor: the cards save through the Bookings view’s own settings call, marked for those who may configure', builder.includes('loadBookingExtras().then((m) => m.mount(c2, { settings: s, save: (body) => api("PUT", "/bookings/settings", body)') && builder.includes('.forEach((c) => { c.dataset.needs = "configure"; })') && builder.includes('"/booking-extras.js?v=1"') && !/data-needs|dataset\.needs/.test(cards));
}

const passed = results.filter(Boolean).length;
console.log(`\n════ BOOKING CHANGES (item 149): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
Deno.exit(0);
