// ── /book/* (public) · /bookings/* (owner) — native booking / appointments ───
// The MVP native booking loop. A visitor on the customer's published site picks a
// service, a day, an open slot, and their details; that PUBLIC self-serve submission
// (honeypot + rate-limit + validation + escaping — the SAME safety as a form submit,
// mirroring routes/commercial.handleFormSubmit) creates a pending/confirmed
// appointment the owner sees. Reuse-first, no parallel systems:
//   • confirmation email  → commerce/account.ts sendEmail (suppression + one-click
//                            unsubscribe inherited at the ONE send point) + email_brand
//   • owner alert         → lib/notice.raiseNotice (the ONE notice model → bell + push)
//                            + a best-effort owner email (mirrors notifyOwnerOfLead)
//   • CRM                 → find-or-create presence_contacts (site+email), like a lead
//   • slot logic          → lib/booking.ts (pure, tested)
//
// Deploy-order-tolerant (mirrors 0094–0098): before migration 0099 is applied every
// query returns not-ok and we answer calmly ("booking needs a database update" /
// "not available") rather than erroring — the routes are dormant until owner-apply.
//
// TIME MODEL: lib/booking.ts does all slot math in the business's LOCAL wall-clock
// (deterministic, unit-tested). This route is the impure boundary that bridges local
// ↔ UTC using the site's configured IANA timezone (Intl), purely for the "now / lead-
// time" boundary and for storing slot_start/slot_end as a real timestamptz.
//
// DEFERRED (clean, not half-built): pay-at-booking (Stripe) · writing bookings into
// Google/Calendly · complex recurrence · group/class bookings · per-staff calendars.
// Reminders + no-show live in commerce/lifecycle.ts (task #164). DST-exact conversion
// across a spring-forward gap uses a single refinement pass (lib/zoned_time.ts).
//
// Builder list item 149: the customer adds the booking to their calendar and changes or
// cancels it themselves from a private link (lib/booking_links.ts; the /book/manage
// routes below, which booking.html calls), and the owner's own calendar's busy times are
// kept off the booking page (lib/busy_calendar.ts; readCalendar and busyFor below).

import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { rateAllow, clientIp, tooMany } from '../lib/ratelimit.ts';
import { raiseNotice } from '../lib/notice.ts';
import { sendEmail } from '../commerce/account.ts';
import { autoReplyVerdict } from '../lib/auto_reply.ts';   // item 203
import { loadEmailBrand } from '../lib/email_brand.ts';
import { ownerReplyTo } from '../lib/service_bridge.ts';
import { siteOrigin, SITE_COLS, type SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';
import {
  normalizeAppointmentType, normalizeBookingConfig, generateSlots, validateBookingInput,
  slotEndLocal, humanSlot, priceText, type BookingConfig, type AppointmentType,
} from '../lib/booking.ts';
import { UUID_RE } from '../lib/uuid.ts';
import { normEmail, emailMatch } from '../lib/contact_email.ts';
import { ticketsOn, siteChecksSends, readTicket } from '../lib/form_check.ts';
import { utcToWall, wallToUtc, wallString } from '../lib/zoned_time.ts';
import { readManageToken, manageState, bookingOptions, bookingBits, bookingLinks, bookingMail, bookingIcs, type BookingOptions, type BookingLinks, type ManageState } from '../lib/booking_links.ts';
import { calendarUrl, readBusyTimes, busyOnDate, type BusyRange } from '../lib/busy_calendar.ts';
import { readReservedJson, writeReservedJson, updateReservedJson, RESERVED_NAMES } from '../lib/reserved_store.ts';
import { runAfterResponse } from '../lib/after_response.ts';
import { fetchPublic, type FetchLike } from '../../_shared/site_discovery.ts';
import { assertPublicHttpUrl } from '../../_shared/tools/url_guard.ts';
import { hmacHex } from '../../_shared/hmac.ts';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DT_RE = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;
const rows = (r: { json?: unknown }) => (Array.isArray((r as any).json) ? (r as any).json : []) as any[];
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const APPROVAL_SECRET = Deno.env.get('APPROVAL_SECRET') || Deno.env.get('SCHEDULER_SECRET') || '';
const siteBase = () => (Deno.env.get('SITE_URL') || 'https://presence.davisdigitalstudio.com').replace(/\/$/, '');
const DAY = 86_400_000;

// ═════════ timezone bridge (lib/zoned_time.ts does the zone rules) ═════════
/** Business-local "YYYY-MM-DDTHH:MM" now in `tz`. */
function nowLocal(tz: string): string {
  return wallString(utcToWall(Date.now(), tz));
}
/** A local "YYYY-MM-DDTHH:MM" wall-clock in `tz` → the UTC ISO instant. */
function localToUtcIso(local: string, tz: string): string {
  const guess = Date.parse(local + ':00Z');                 // treat wall-clock as if UTC
  if (!Number.isFinite(guess)) return new Date().toISOString();
  return new Date(wallToUtc(guess, tz)).toISOString();
}

// ═════════ shared loaders / degradation ═════════
async function loadSettings(siteId: string): Promise<{ enabled: boolean; config: BookingConfig; intro: string } | null> {
  const r = await svc(`presence_booking_settings?site_id=eq.${siteId}&select=*&limit=1`);
  if (!r.ok) return null;                                    // pre-0099 → dormant
  const row = rows(r)[0];
  const config = normalizeBookingConfig(row || {});
  return { enabled: !!(row && row.enabled), config, intro: String(row?.intro || '') };
}
async function loadActiveTypes(siteId: string): Promise<AppointmentType[] | null> {
  const r = await svc(`presence_appointment_types?site_id=eq.${siteId}&deleted_at=is.null&active=is.true&select=id,name,duration_min,price_cents,description,sort_order&order=sort_order.asc,name.asc&limit=60`);
  if (!r.ok) return null;
  return rows(r).map((t) => { const n = normalizeAppointmentType(t); return n.ok ? n.type : null; }).filter(Boolean) as AppointmentType[];
}
/** Booked local ranges on ONE local date (to subtract from open slots). `except` leaves
 *  out the booking a customer is moving, so its own time doesn't block the times beside it. */
async function bookedOnDate(siteId: string, date: string, except = ''): Promise<Array<{ start: string; end: string }>> {
  const r = await svc(`presence_appointments?site_id=eq.${siteId}&status=in.(pending,confirmed)&slot_start_local=like.${date}T*&select=id,slot_start_local,duration_min&limit=200`);
  const out: Array<{ start: string; end: string }> = [];
  for (const a of rows(r)) {
    const start = String(a.slot_start_local || '');
    if (start && a.id !== except) out.push({ start, end: slotEndLocal(start, Number(a.duration_min) || 30) });
  }
  return out;
}

// ═════════ builder list item 149: the owner's own calendar's busy times ═════════
// The private address lives in the options row (lib/booking_links.ts bookingOptions);
// what was last read from it lives in its own reserved row, so a read that lands late
// can never undo the owner's change to the address. Only times are kept.
export const BUSY_FRESH_MS = 10 * 60_000;        // read again after ten minutes
export const BUSY_KEEP_MS = 6 * 3600_000;        // a copy this old still counts while a new read is tried
export const BUSY_WAIT_MS = 5000;
const BUSY_MAX_BYTES = 15 * 1024 * 1024;
export type CalendarError = 'unreachable' | 'gone' | 'not_calendar' | 'too_big';
/** What the owner is told when their calendar's address can't be used. */
export const CALENDAR_SAY: Record<CalendarError | 'bad', string> = {
  bad: 'That doesn’t look like a calendar’s private address. It starts with https:// or webcal:// and usually ends in .ics.',
  unreachable: 'We couldn’t reach that calendar. Check the address and try again.',
  gone: 'That address didn’t open a calendar. It may have been reset: copy it again from your calendar’s settings.',
  not_calendar: 'That address opened a web page, not a calendar. Copy the private address in iCal format instead.',
  too_big: 'That calendar took too long to read. A calendar with just your appointments works best.',
};
interface BusyCache { for: string; at: string; tried: string; ok: boolean | null; error?: CalendarError; ranges: BusyRange[] }
const urlKey = async (url: string) => (await hmacHex('booking-calendar', url)).slice(0, 16);
/** Only https, and never our own network: every hop of a redirect is checked too. A
 *  calendar lives at a name, never a bare address (the shared check misses some IPv6
 *  spellings of private ones, such as [::ffff:7f00:1]). */
const calendarGuard = async (raw: string) => {
  const u = await assertPublicHttpUrl(raw);
  if (u.protocol !== 'https:') throw new Error('blocked_scheme');
  if (u.hostname.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(u.hostname)) throw new Error('blocked_ip');
  return u;
};

/** Read the owner's calendar now: its busy times over the booking window, or why not. */
export async function readCalendar(url: string, cfg: BookingConfig, nowMs: number, deps: { fetchImpl?: FetchLike; guard?: (raw: string) => Promise<URL> } = {}): Promise<{ ok: true; ranges: BusyRange[] } | { ok: false; error: CalendarError }> {
  const r = await fetchPublic(url, deps.guard || calendarGuard, {
    ua: 'StudioOS-Calendar/1.0 (+https://davisdigitalstudio.com)', accept: 'text/calendar, text/plain;q=0.8, */*;q=0.5',
    timeoutMs: BUSY_WAIT_MS, maxBytes: BUSY_MAX_BYTES, maxHops: 3, fetchImpl: deps.fetchImpl,
  }).catch(() => null);
  if (!r) return { ok: false, error: 'unreachable' };
  if ([401, 403, 404, 410].includes(r.status)) return { ok: false, error: 'gone' };
  if (r.status < 200 || r.status >= 300) return { ok: false, error: 'unreachable' };
  if (r.truncated) return { ok: false, error: 'too_big' };
  if (!/BEGIN:VCALENDAR/i.test(r.text.slice(0, 4096))) return { ok: false, error: 'not_calendar' };
  const { ranges } = readBusyTimes(r.text, { fromMs: nowMs - DAY, toMs: nowMs + (cfg.max_days_ahead + 2) * DAY, tz: cfg.timezone });
  return { ok: true, ranges };
}

async function refreshBusy(siteId: string, url: string, key: string, cfg: BookingConfig, nowMs: number, prev: BusyCache | null): Promise<BusyCache> {
  const r = await readCalendar(url, cfg, nowMs);
  const now = new Date(nowMs).toISOString();
  const next: BusyCache = r.ok
    ? { for: key, at: now, tried: now, ok: true, ranges: r.ranges }
    : { for: key, at: prev?.at || '', tried: now, ok: false, error: r.error, ranges: prev?.ranges || [] };
  // a read that lands after the owner changed the address must not replace the new one's copy
  if ((await bookingOptions(siteId)).calendar_url === url) await writeReservedJson(siteId, RESERVED_NAMES.bookingBusy, next, 'booking-calendar');
  return next;
}

/** The owner's busy times for the booking page: the kept copy while it's fresh; a copy
 *  under six hours old at once, with a new read after the answer goes; no usable copy, a
 *  read now. A calendar that hasn't been read for six hours keeps nothing off the page, so
 *  bookings still come in, and the owner's Bookings view says it couldn't be read. */
async function busyFor(siteId: string, opts: BookingOptions, cfg: BookingConfig, nowMs = Date.now()): Promise<BusyRange[]> {
  if (!opts.calendar_url) return [];
  const key = await urlKey(opts.calendar_url);
  const kept = (await readReservedJson(siteId, RESERVED_NAMES.bookingBusy)) as BusyCache | null;
  const cache = kept && kept.for === key ? kept : null;
  const ranges = (c: BusyCache | null) => (c && Array.isArray(c.ranges) ? c.ranges : []);
  const recent = (c: BusyCache | null) => !!c?.at && nowMs - Date.parse(c.at) < BUSY_KEEP_MS;
  if (cache?.tried && nowMs - Date.parse(cache.tried) < BUSY_FRESH_MS) return recent(cache) ? ranges(cache) : [];
  // one read a minute per site, however many visitors are looking at once; while another
  // visitor's read is still under way, the kept copy, however old, beats keeping nothing off
  const refresh = async () => {
    if (!(await rateAllow(`book:busy:${siteId}`, 1, 60))) return ranges(cache);
    const next = await refreshBusy(siteId, opts.calendar_url, key, cfg, nowMs, cache);
    return recent(next) ? ranges(next) : [];
  };
  if (recent(cache)) {
    runAfterResponse(refresh().catch(() => []));
    return ranges(cache);
  }
  return await refresh().catch(() => ranges(cache));
}

/** How the owner's calendar stands, for their Bookings view: never the address itself. */
async function calendarStatus(siteId: string, opts: BookingOptions): Promise<Record<string, unknown>> {
  if (!opts.calendar_url) return { on: false };
  const [key, kept] = await Promise.all([urlKey(opts.calendar_url), readReservedJson(siteId, RESERVED_NAMES.bookingBusy)]);
  const c = kept && (kept as BusyCache).for === key ? kept as BusyCache : null;
  const now = Date.now();
  return {
    on: true, host: opts.calendar_host, ok: c ? c.ok : null, error: c?.error || null, read_at: c?.at || null, tried_at: c?.tried || null,
    busy: c && Array.isArray(c.ranges) ? c.ranges.filter((r) => r[1] > now).length : 0,
  };
}

/** Booked and busy times on one day, for the slot engine. */
async function takenOn(siteId: string, date: string, cfg: BookingConfig, except = ''): Promise<Array<{ start: string; end: string }>> {
  const [booked, busy] = await Promise.all([
    bookedOnDate(siteId, date, except),
    bookingOptions(siteId).then((o) => busyFor(siteId, o, cfg)).catch(() => [] as BusyRange[]),
  ]);
  return [...booked, ...busyOnDate(busy, date, cfg.timezone)];
}

async function hashIp(req: Request): Promise<string> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '';
  if (!ip) return '';
  const salt = APPROVAL_SECRET || Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || 'salt';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip + '|' + salt));
  return Array.from(new Uint8Array(buf)).slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ═══════════════════════════ PUBLIC endpoints ═══════════════════════════════
// Handled before the auth gate; authorized by the site id itself (like the form
// submit + analytics collector). Always answer calmly — never leak internals.

/** PUBLIC — the bookable services the widget offers (active only). */
export async function handleBookingTypes(req: Request, siteId: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(siteId)) return json({ error: 'not_found' }, 404, cors);
  if (!(await rateAllow(`book:types:${clientIp(req)}`, 30, 60))) return tooMany(cors);
  const settings = await loadSettings(siteId);
  const types = await loadActiveTypes(siteId);
  if (!settings || types === null) return json({ data: { enabled: false, types: [], intro: '' } }, 200, cors);
  if (!settings.enabled) return json({ data: { enabled: false, types: [], intro: '' } }, 200, cors);
  return json({ data: {
    enabled: true, intro: settings.intro,
    timezone: settings.config.timezone,
    max_days_ahead: settings.config.max_days_ahead,
    types: types.map((t) => ({ id: t.id, name: t.name, duration_min: t.duration_min, price_text: priceText(t.price_cents), description: t.description || '' })),
  } }, 200, cors);
}

/** PUBLIC — open slots for a chosen service + local date. */
export async function handleBookingSlots(req: Request, siteId: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(siteId)) return json({ error: 'not_found' }, 404, cors);
  if (!(await rateAllow(`book:slots:ip:${clientIp(req)}`, 60, 60)) || !(await rateAllow(`book:slots:site:${siteId}`, 240, 60))) return tooMany(cors);
  const u = new URL(req.url);
  const typeId = String(u.searchParams.get('type') || '').trim();
  const date = String(u.searchParams.get('date') || '').trim();
  if (!UUID_RE.test(typeId) || !DATE_RE.test(date)) return json({ data: { slots: [] } }, 200, cors);

  const settings = await loadSettings(siteId);
  if (!settings || !settings.enabled) return json({ data: { slots: [] } }, 200, cors);
  const tRow = rows(await svc(`presence_appointment_types?id=eq.${typeId}&site_id=eq.${siteId}&deleted_at=is.null&active=is.true&select=id,name,duration_min,price_cents,description,sort_order&limit=1`))[0];
  const tn = tRow ? normalizeAppointmentType(tRow) : null;
  if (!tn || !tn.ok) return json({ data: { slots: [] } }, 200, cors);

  const booked = await takenOn(siteId, date, settings.config);   // item 149: the owner's own busy times too
  const slots = generateSlots({
    date, config: settings.config, duration_min: tn.type.duration_min,
    now_local: nowLocal(settings.config.timezone), booked,
  });
  return json({ data: { date, duration_min: tn.type.duration_min, slots } }, 200, cors);
}

/** PUBLIC — create a booking. Honeypot + rate-limit + validation, mirroring the
 *  form submit. Guards against double-booking atomically (unique slot index). */
export async function handleBookingCreate(req: Request, siteId: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(siteId)) return json({ error: 'not_found' }, 404, cors);
  // throttle the public submit — per-IP and per-site fixed windows (like forms)
  if (!(await rateAllow(`book:submit:ip:${clientIp(req)}`, 8, 60)) || !(await rateAllow(`book:submit:site:${siteId}`, 40, 60))) return tooMany(cors);

  let b: any = {};
  const ctype = (req.headers.get('content-type') || '').toLowerCase();
  if (ctype.includes('application/x-www-form-urlencoded') || ctype.includes('multipart/form-data')) {
    try { const fd = await req.formData(); for (const k of new Set(fd.keys())) b[k] = String(fd.get(k) ?? ''); } catch { /* */ }
  } else {
    try { b = await req.json(); } catch { /* */ }
  }

  // Honeypot: a filled `_hp` is a bot — answer success without writing (bots think
  // they succeeded), exactly like the form submit.
  const spam = !!String(b?._hp ?? '').slice(0, 100).trim();
  const calmOk = (msg: string, extra: Record<string, unknown> = {}) => json({ data: { ok: true, message: msg, ...extra } }, 200, cors);
  if (spam) return calmOk('Thanks — your booking request was received.');
  // Item 140: once the site's pages ask for a time ticket, a booking without a good one
  // didn't come from a person on the page, and no robot may hold a time. Refused out
  // loud: the widget asks for a fresh ticket and tries once more on its own.
  if (ticketsOn() && await siteChecksSends(siteId).catch(() => false)) {
    const t = await readTicket(b?._tk, siteId, Math.floor(Date.now() / 1000));
    if (t !== 'ok') return json({ error: 'check', message: 'That didn’t go through. Please try again.' }, 400, cors);
  }

  const v = validateBookingInput(b);
  if (!v.ok) {
    const message = v.error === 'need_name' ? 'Please add your name.'
      : v.error === 'need_contact' ? 'Leave an email or phone so they can confirm.'
      : v.error === 'bad_email' ? 'That email doesn’t look right.'
      : v.error === 'choose_service' ? 'Please choose a service.'
      : 'Please pick an available time.';
    return json({ error: v.error, message }, 400, cors);
  }

  const settings = await loadSettings(siteId);
  if (!settings) return json({ error: 'unavailable', message: 'Online booking needs a database update before it can take bookings.' }, 503, cors);
  if (!settings.enabled) return json({ error: 'disabled', message: 'Online booking isn’t available right now.' }, 409, cors);

  const tRow = rows(await svc(`presence_appointment_types?id=eq.${v.booking.type_id}&site_id=eq.${siteId}&deleted_at=is.null&active=is.true&select=id,name,duration_min,price_cents,description,sort_order&limit=1`))[0];
  const tn = tRow ? normalizeAppointmentType(tRow) : null;
  if (!tn || !tn.ok) return json({ error: 'choose_service', message: 'That service is no longer available.' }, 400, cors);
  const type = tn.type;

  // Re-verify the slot is ACTUALLY open right now (recompute — never trust the
  // client). This closes the window between the slots call and the booking.
  const dateOfSlot = v.booking.slot_start.split('T')[0];
  const booked = await takenOn(siteId, dateOfSlot, settings.config);
  const open = generateSlots({ date: dateOfSlot, config: settings.config, duration_min: type.duration_min, now_local: nowLocal(settings.config.timezone), booked });
  if (!open.includes(v.booking.slot_start)) {
    const mine = await sameBookingAgain(siteId, v.booking);
    if (mine) return calmOk(bookedMessage(mine.status, type.name, v.booking.slot_start), { status: mine.status, when: humanSlot(v.booking.slot_start) || v.booking.slot_start, service: type.name, links: await linksForPage(mine, false) });
    return json({ error: 'slot_taken', message: 'Sorry — that time was just taken. Please pick another.' }, 409, cors);
  }

  const tz = settings.config.timezone;
  const slotEnd = slotEndLocal(v.booking.slot_start, type.duration_min);
  const startIso = localToUtcIso(v.booking.slot_start, tz);
  const endIso = localToUtcIso(slotEnd, tz);

  // Attach/create a CRM contact (find-or-create by site+email), like a lead. Phone-
  // only bookings still record the appointment; the contact is best-effort.
  let contactId: string | null = null;
  try {
    if (v.booking.email) {
      // item 110 (K1): found whatever the capitals, kept lower-cased like every contact
      const existing = rows(await svc(`presence_contacts?site_id=eq.${siteId}&${emailMatch(v.booking.email)}&deleted_at=is.null&select=id&limit=1`))[0];
      if (existing) contactId = existing.id;
      else {
        const ins = await svc('presence_contacts', { method: 'POST', headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ site_id: siteId, name: v.booking.name, email: normEmail(v.booking.email), phone: v.booking.phone }) });
        contactId = rows(ins)[0]?.id || null;
      }
    }
  } catch { /* contact is best-effort — never block a booking on it */ }

  const status = settings.config.auto_confirm ? 'confirmed' : 'pending';
  const ipHash = await hashIp(req);
  const ins = await svc('presence_appointments', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      site_id: siteId, type_id: type.id, type_name: type.name, contact_id: contactId,
      slot_start: startIso, slot_end: endIso, slot_start_local: v.booking.slot_start,
      duration_min: type.duration_min, timezone: tz, price_cents: type.price_cents ?? null,
      customer_name: v.booking.name, customer_email: v.booking.email, customer_phone: v.booking.phone,
      note: v.booking.note, status, source: 'website', ip_hash: ipHash,
    }),
  });
  // The atomic no-double-book guard: a concurrent identical slot hits the unique
  // index (presence_appointments_slot_uq) → 409, turned into a calm message.
  if (ins.status === 409) {
    const mine = await sameBookingAgain(siteId, v.booking);
    if (mine) return calmOk(bookedMessage(mine.status, type.name, v.booking.slot_start), { status: mine.status, when: humanSlot(v.booking.slot_start) || v.booking.slot_start, service: type.name, links: await linksForPage(mine, false) });
    return json({ error: 'slot_taken', message: 'Sorry — that time was just taken. Please pick another.' }, 409, cors);
  }
  if (!ins.ok || !rows(ins)[0]) return json({ error: 'write_failed', message: 'That didn’t go through — please try again.' }, 502, cors);
  const appt = rows(ins)[0];

  // Fan-out (all best-effort, non-blocking): customer confirmation email + owner
  // notice (bell + push) + owner email. Reuse the ONE of each — no new systems.
  // Item 203: the confirmation is a site's automatic reply, so one a day to an address and
  // none to the do-not-send list; the page shows the booking's links either way. It is the
  // customer's own appointment, so it still goes when the day's count can't be read.
  const mailed = !!appt.customer_email && await autoReplyVerdict('booking', siteId, String(appt.customer_email), { failOpen: true }) === 'send';
  if (mailed) notifyCustomer(siteId, appt, status).catch(() => {});
  notifyOwnerOfBooking(siteId, appt, status).catch(() => {});

  const when = humanSlot(v.booking.slot_start) || v.booking.slot_start;
  return calmOk(bookedMessage(status, type.name, v.booking.slot_start, mailed), { status, when, service: type.name, links: await linksForPage(appt) });
}

/** Item 149: the widget's "you're booked" shows the calendar links and the private
 *  change-or-cancel link, so someone who left only a phone number has them too. A retry
 *  that matched an earlier booking only by its email or phone (sameBookingAgain) proves
 *  nothing about who sent it, so it gets the Google and Outlook links and nothing that
 *  carries the private link (the calendar file's address does too). */
async function linksForPage(appt: any, madeNow = true): Promise<BookingLinks | undefined> {
  try {
    const bits = await bookingBits(String(appt.site_id));
    const open = madeNow && manageState(appt, { selfManage: bits.opts.self_manage, leadHours: bits.leadHours }, Date.now()) === 'open';
    const { links } = await bookingLinks(appt, bits.biz, open);
    return madeNow ? links : { ...links, ics: '', manage: '' };
  } catch { return undefined; }
}

function bookedMessage(status: string, service: string, slotLocal: string, mailed = true): string {
  const when = humanSlot(slotLocal) || slotLocal;
  return status === 'confirmed'
    ? `You’re booked for ${service} — ${when}.${mailed ? ' A confirmation is on its way.' : ''}`
    : `Thanks — your ${service} request for ${when} was received. You’ll get a note once it’s confirmed.`;
}

/** Item 131: the widget gives up after 15 seconds with no answer and invites another try,
 *  and a slow answer may still have booked the first. The same person (email or phone) on
 *  the same service and time in the last ten minutes is that booking, so they hear it went
 *  through, not that their own time "was just taken". Nothing is sent twice. */
export const REBOOK_WINDOW_MIN = 10;
async function sameBookingAgain(siteId: string, b: { type_id: string; slot_start: string; email: string; phone: string }): Promise<{ status: string; [k: string]: unknown } | null> {
  const since = new Date(Date.now() - REBOOK_WINDOW_MIN * 60_000).toISOString();
  const digits = (x: unknown) => String(x ?? '').replace(/\D/g, '');
  const found = rows(await svc(`presence_appointments?site_id=eq.${siteId}&slot_start_local=eq.${encodeURIComponent(b.slot_start)}&type_id=eq.${b.type_id}&status=in.(pending,confirmed)&created_at=gte.${since}&select=id,site_id,type_name,slot_start,slot_end,duration_min,status,updated_at,customer_email,customer_phone&limit=5`));
  const hit = found.find((a) => (b.email && String(a.customer_email || '').toLowerCase() === b.email) || (b.phone && digits(b.phone).length >= 7 && digits(a.customer_phone) === digits(b.phone)));
  return hit ? { ...hit, status: String(hit.status) } : null;
}

async function notifyCustomer(siteId: string, appt: any, status: string, moved = ''): Promise<void> {
  const to = String(appt.customer_email || '');
  if (!to) return;                                            // phone-only booking → no email to send
  // One wave: the business (name, address, what the owner allows), its brand, and where
  // "just reply" goes — the business owner's own email (item 72), never the platform's.
  // Item 149: it ends with the calendar links and the private change-or-cancel link, and
  // carries the booking as a calendar file. `moved` is the time it had, when it moved.
  const [mail, brand, replyTo] = await Promise.all([
    bookingMail({ ...appt, site_id: siteId }),
    loadEmailBrand(siteId),
    ownerReplyTo(siteId),
  ]);
  const biz = mail.biz.name || 'the team';
  const when = humanSlot(String(appt.slot_start_local || '')) || String(appt.slot_start_local || '');
  const price = priceText(appt.price_cents);
  const head = moved ? 'Your booking has moved' : status === 'confirmed' ? 'Your booking is confirmed' : 'We got your booking request';
  const lead = moved
    ? `Your booking with ${esc(biz)} is at its new time.${status === 'confirmed' ? '' : ' They’ll confirm it shortly.'}`
    : status === 'confirmed'
      ? `You’re booked with ${esc(biz)}.`
      : `Thanks for booking with ${esc(biz)} — we’ll confirm shortly.`;
  const body =
    `<p>${lead}</p>` +
    `<table style="margin:8px 0;border-collapse:collapse"><tr><td style="padding:2px 12px 2px 0;color:#666">Service</td><td><b>${esc(appt.type_name)}</b></td></tr>` +
    `<tr><td style="padding:2px 12px 2px 0;color:#666">When</td><td><b>${esc(when)}</b></td></tr>` +
    (moved ? `<tr><td style="padding:2px 12px 2px 0;color:#666">Was</td><td>${esc(moved)}</td></tr>` : '') +
    (price ? `<tr><td style="padding:2px 12px 2px 0;color:#666">Price</td><td>${esc(price)}</td></tr>` : '') +
    `</table>` +
    (status === 'confirmed' ? '' : `<p style="color:#666">This time is being held for you — you’ll get a confirmation once it’s approved.</p>`) +
    mail.html;
  // A booking confirmation is transactional (a direct response to the customer's own
  // action) → critical:true survives an opt-out but still respects bounces. Sales item 78:
  // it comes from the business (asBusiness: its name as the sender, its footer).
  await sendEmail(to, `${head} — ${appt.type_name}`, body, brand, { critical: true, asBusiness: true, replyTo, attachments: mail.attachments });
}

async function notifyOwnerOfBooking(siteId: string, appt: any, status: string): Promise<void> {
  const site = rows(await svc(`presence_sites?id=eq.${siteId}&select=client_id&limit=1`))[0];
  const clientId = site?.client_id || '';
  const when = humanSlot(String(appt.slot_start_local || '')) || String(appt.slot_start_local || '');
  const who = [appt.customer_name, appt.customer_email, appt.customer_phone].filter(Boolean).join(' · ');
  // Owner notice on the ONE model (→ bell + push), once per appointment (period = its id).
  if (clientId) {
    await raiseNotice({
      siteId, clientId, kind: 'new_booking', period: `appt:${appt.id}`,
      headline: `New booking: ${String(appt.type_name).slice(0, 60)} — ${when}`,
      body: `${who || 'Someone'} booked online${status === 'confirmed' ? '' : ' — waiting for your confirmation'}.`,
    }).catch(() => {});
  }
  // Owner email (best-effort; mirrors notifyOwnerOfLead).
  const ident = rows(await svc(`presence_identity?site_id=eq.${siteId}&select=business_name,email&limit=1`))[0];
  const to = ident?.email;
  if (!to) return;
  const brand = await loadEmailBrand(siteId);
  const price = priceText(appt.price_cents);
  // Sales item 74: the owner hears about every booking, unsubscribed or not (critical)
  await sendEmail(String(to), `New booking — ${appt.type_name}`,
    `<p>You have a new booking${status === 'confirmed' ? '' : ' request'} from your website.</p>` +
    `<p><b>${esc(appt.type_name)}</b> — ${esc(when)}${price ? ` · ${esc(price)}` : ''}</p>` +
    `<p>${esc(who)}</p>${appt.note ? `<p style="color:#666">“${esc(String(appt.note).slice(0, 400))}”</p>` : ''}` +
    `<p class="cta"><a href="${siteBase()}/presence.html#bookings" style="display:inline-block;margin-top:6px;background:${brand.accent};color:#fff;padding:9px 16px;border-radius:999px;text-decoration:none">See it in your workspace →</a></p>`, brand, { critical: true });
}

// ═══════════════════════════ OWNER (authed) endpoints ════════════════════════
// Site-scoped via the boundary gate in index.ts (a client_reviewer never reaches
// these). The owner defines services + availability and manages appointments.

const unavailable = (cors: Record<string, string>) =>
  json({ error: 'unavailable', message: 'Online booking needs a one-time database update before it can be switched on.' }, 503, cors);

export async function handleBookingSettingsGet(site: SiteRow, cors: Record<string, string>): Promise<Response> {
  const [r, opts] = await Promise.all([svc(`presence_booking_settings?site_id=eq.${site.id}&select=*&limit=1`), bookingOptions(site.id)]);
  if (!r.ok) return unavailable(cors);
  const row = rows(r)[0];
  const config = normalizeBookingConfig(row || {});
  // item 149: whether customers change or cancel themselves, and how the owner's own calendar stands
  return json({ data: { enabled: !!(row && row.enabled), intro: String(row?.intro || ''), ...config, self_manage: opts.self_manage, calendar: await calendarStatus(site.id, opts) } }, 200, cors);
}

export async function handleBookingSettingsPut(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  // item 149: a save without the hours is the change-or-cancel switch or the calendar address
  if (b && typeof b === 'object' && !Array.isArray(b) && !('weekly' in b) && ('self_manage' in b || 'calendar_url' in b)) return saveBookingOptions(b, site, principal, cors);
  const config = normalizeBookingConfig(b);
  const intro = String(b?.intro ?? '').replace(/\s+/g, ' ').trim().slice(0, 400);
  const enabled = b?.enabled === true;
  const payload = {
    site_id: site.id, enabled, intro,
    weekly: config.weekly, closed_dates: config.closed_dates,
    slot_interval_min: config.slot_interval_min, buffer_min: config.buffer_min,
    lead_time_hours: config.lead_time_hours, max_days_ahead: config.max_days_ahead,
    timezone: config.timezone, auto_confirm: config.auto_confirm, updated_at: new Date().toISOString(),
  };
  const up = await svc('presence_booking_settings?on_conflict=site_id', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(payload),
  });
  if (!up.ok) return unavailable(cors);
  return json({ data: { ok: true, enabled, intro, ...config } }, 200, cors);
}

/** Item 149: let customers change or cancel (on or off), and the owner's own calendar:
 *  a new address is read before it's kept, so the owner hears at once if it can't be. */
async function saveBookingOptions(b: any, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  const change: Partial<BookingOptions> = {};
  let first: BusyCache | null = null;
  if ('self_manage' in b) change.self_manage = b.self_manage !== false;
  if ('calendar_url' in b) {
    const raw = String(b.calendar_url ?? '').trim();
    if (!raw) { change.calendar_url = ''; change.calendar_host = ''; }
    else {
      const u = calendarUrl(raw);
      if (!u.ok) return json({ error: 'calendar_bad', message: CALENDAR_SAY.bad }, 422, cors);
      const cfg = (await loadSettings(site.id))?.config || normalizeBookingConfig({});
      const now = Date.now();
      const r = await readCalendar(u.url, cfg, now);
      if (!r.ok) return json({ error: `calendar_${r.error}`, message: CALENDAR_SAY[r.error] }, 422, cors);
      change.calendar_url = u.url; change.calendar_host = u.host;
      const at = new Date(now).toISOString();
      first = { for: await urlKey(u.url), at, tried: at, ok: true, ranges: r.ranges };
    }
  }
  const by = principal.email || principal.userId || 'system';
  const opts = await updateReservedJson<BookingOptions>(site.id, RESERVED_NAMES.bookingOptions, (cur) => ({ self_manage: true, calendar_url: '', calendar_host: '', ...(cur && typeof cur === 'object' ? cur as object : {}), ...change }), by);
  if (!opts) return json({ error: 'write_failed', message: 'That didn’t save — please try again.' }, 502, cors);
  if (first) await writeReservedJson(site.id, RESERVED_NAMES.bookingBusy, first, by);
  // disconnected: the busy times read from it go too
  else if (change.calendar_url === '') await writeReservedJson(site.id, RESERVED_NAMES.bookingBusy, { for: '', at: '', tried: '', ok: null, ranges: [] }, by);
  return json({ data: { ok: true, self_manage: opts.self_manage !== false, calendar: await calendarStatus(site.id, opts) } }, 200, cors);
}

export async function handleBookingTypesList(site: SiteRow, cors: Record<string, string>): Promise<Response> {
  const r = await svc(`presence_appointment_types?site_id=eq.${site.id}&deleted_at=is.null&select=id,name,duration_min,price_cents,description,active,sort_order&order=sort_order.asc,name.asc&limit=60`);
  if (!r.ok) return unavailable(cors);
  return json({ data: { types: rows(r).map((t) => ({ ...t, price_text: priceText(t.price_cents) })) } }, 200, cors);
}

export async function handleBookingTypeCreate(req: Request, site: SiteRow, _principal: Principal, cors: Record<string, string>): Promise<Response> {
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const n = normalizeAppointmentType(b);
  if (!n.ok) return json({ error: 'validation', message: n.error }, 422, cors);
  const t = n.type;
  const ins = await svc('presence_appointment_types', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: site.id, name: t.name, duration_min: t.duration_min, price_cents: t.price_cents ?? null, description: t.description || '', active: t.active, sort_order: t.sort_order }) });
  if (!ins.ok || !rows(ins)[0]) return unavailable(cors);
  return json({ data: rows(ins)[0] }, 201, cors);
}

export async function handleBookingTypeUpdate(req: Request, site: SiteRow, id: string, _principal: Principal, cors: Record<string, string>): Promise<Response> {
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const n = normalizeAppointmentType({ ...b, id });
  if (!n.ok) return json({ error: 'validation', message: n.error }, 422, cors);
  const t = n.type;
  const up = await svc(`presence_appointment_types?id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=id,name,duration_min,price_cents,description,active,sort_order`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ name: t.name, duration_min: t.duration_min, price_cents: t.price_cents ?? null, description: t.description || '', active: t.active, sort_order: t.sort_order, updated_at: new Date().toISOString() }) });
  if (!up.ok) return unavailable(cors);
  if (!rows(up)[0]) return json({ error: 'not_found', message: 'That service no longer exists.' }, 404, cors);
  return json({ data: rows(up)[0] }, 200, cors);
}

export async function handleBookingTypeDelete(site: SiteRow, id: string, _principal: Principal, cors: Record<string, string>): Promise<Response> {
  const up = await svc(`presence_appointment_types?id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=id`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ deleted_at: new Date().toISOString(), active: false }) });
  if (!up.ok) return unavailable(cors);
  if (!rows(up)[0]) return json({ error: 'not_found', message: 'Nothing to remove.' }, 404, cors);
  return json({ data: { ok: true } }, 200, cors);
}

/** Upcoming appointments (default) or ?scope=past for history. */
export async function handleBookingAppointments(req: Request, site: SiteRow, cors: Record<string, string>): Promise<Response> {
  const u = new URL(req.url);
  const scope = u.searchParams.get('scope') === 'past' ? 'past' : 'upcoming';
  const nowIso = new Date().toISOString();
  const base = `presence_appointments?site_id=eq.${site.id}&select=id,type_name,slot_start,slot_start_local,duration_min,timezone,price_cents,customer_name,customer_email,customer_phone,note,status,source,created_at`;
  const q = scope === 'past'
    ? `${base}&slot_start=lt.${nowIso}&order=slot_start.desc&limit=100`
    : `${base}&status=in.(pending,confirmed)&slot_start=gte.${nowIso}&order=slot_start.asc&limit=100`;
  const r = await svc(q);
  if (!r.ok) return unavailable(cors);
  const appts = rows(r).map((a) => ({ ...a, price_text: priceText(a.price_cents), when: humanSlot(String(a.slot_start_local || '')) }));
  const pending = scope === 'upcoming' ? appts.filter((a) => a.status === 'pending').length : 0;
  return json({ data: { appointments: appts, scope, pending } }, 200, cors);
}

/** Confirm a pending appointment → notifies the customer. */
export async function handleBookingConfirm(site: SiteRow, id: string, _principal: Principal, cors: Record<string, string>): Promise<Response> {
  const up = await svc(`presence_appointments?id=eq.${id}&site_id=eq.${site.id}&status=eq.pending&select=*`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'confirmed', updated_at: new Date().toISOString() }) });
  if (!up.ok) return unavailable(cors);
  const appt = rows(up)[0];
  if (!appt) return json({ error: 'not_found', message: 'That booking can’t be confirmed (it may already be handled).' }, 404, cors);
  notifyCustomer(site.id, appt, 'confirmed').catch(() => {});
  // clear the "new booking" nudge for this appointment (owner acted on it)
  svc(`presence_plan_notices?site_id=eq.${site.id}&kind=eq.new_booking&period=eq.${encodeURIComponent(`appt:${id}`)}&status=eq.active`, { method: 'PATCH', body: JSON.stringify({ status: 'dismissed' }) }).catch(() => {});
  return json({ data: { ok: true, status: 'confirmed' } }, 200, cors);
}

/** Cancel an appointment → frees the slot (excluded from the unique index) and
 *  notifies the customer. */
export async function handleBookingCancel(req: Request, site: SiteRow, id: string, _principal: Principal, cors: Record<string, string>): Promise<Response> {
  let b: any = {}; try { b = await req.json(); } catch { /* optional reason */ }
  const up = await svc(`presence_appointments?id=eq.${id}&site_id=eq.${site.id}&status=in.(pending,confirmed)&select=*`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'canceled', canceled_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
  if (!up.ok) return unavailable(cors);
  const appt = rows(up)[0];
  if (!appt) return json({ error: 'not_found', message: 'That booking is no longer active.' }, 404, cors);
  notifyCustomerCanceled(site.id, appt, String(b?.reason || '')).catch(() => {});
  clearBookingNotices(site.id, id).catch(() => {});
  return json({ data: { ok: true, status: 'canceled' } }, 200, cors);
}

/** Dismiss any active bell nudges tied to ONE appointment (the "new booking" alert
 *  and the post-slot "mark it done / no-show" follow-up) once the owner has acted. */
async function clearBookingNotices(siteId: string, apptId: string): Promise<void> {
  await svc(`presence_plan_notices?site_id=eq.${siteId}&kind=in.(new_booking,booking_followup)&period=in.(${`"appt:${apptId}","noshow:${apptId}"`})&status=eq.active`, {
    method: 'PATCH', body: JSON.stringify({ status: 'dismissed' }),
  }).catch(() => {});
}

/** Mark a past appointment 'completed' or 'no_show' — the OWNER action the
 *  booking_followup nudge (commerce/lifecycle.runBookingFollowups) asks for. Never
 *  auto-invoked and never messages the customer. Transitions from pending/confirmed
 *  (an owner may reconcile either). 'no_show' requires migration 0100's widened
 *  status CHECK: pre-apply the PATCH fails the CHECK and returns no row → a calm
 *  "can't be updated" 404, never a throw.
 *
 *  WIRED: dispatched from index.ts in the booking action block — the route regex
 *  includes complete|no_show and routes them here:
 *    const m = route.match(/^\/bookings\/appointments\/([0-9a-f-]{36})\/(confirm|cancel|complete|no_show)$/);
 *    if (m && method === 'POST') { …; return handleBookingMark(site, m[1], m[2], principal, cors); }
 */
export async function handleBookingMark(site: SiteRow, id: string, action: 'complete' | 'no_show', _principal: Principal, cors: Record<string, string>): Promise<Response> {
  const status = action === 'complete' ? 'completed' : 'no_show';
  const up = await svc(`presence_appointments?id=eq.${id}&site_id=eq.${site.id}&status=in.(pending,confirmed)&select=id`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status, updated_at: new Date().toISOString() }),
  });
  if (!up.ok) return json({ error: 'unavailable', message: 'That status needs a one-time database update (0100) before it can be set.' }, 503, cors);
  if (!rows(up)[0]) return json({ error: 'not_found', message: 'That booking can’t be updated (it may already be handled).' }, 404, cors);
  // The owner acted → dismiss the "mark it done / no-show" nudge (and any stale new-booking alert).
  clearBookingNotices(site.id, id).catch(() => {});
  return json({ data: { ok: true, status } }, 200, cors);
}

async function notifyCustomerCanceled(siteId: string, appt: any, reason: string, byCustomer = false): Promise<void> {
  const to = String(appt.customer_email || '');
  if (!to) return;
  const [identR, brand, replyTo] = await Promise.all([   // a reply reaches the business (item 72)
    svc(`presence_identity?site_id=eq.${siteId}&select=business_name&limit=1`),
    loadEmailBrand(siteId),
    ownerReplyTo(siteId),
  ]);
  const biz = rows(identR)[0]?.business_name || 'the team';
  const when = humanSlot(String(appt.slot_start_local || '')) || String(appt.slot_start_local || '');
  const body =
    `<p>${byCustomer ? `You canceled your booking with ${esc(biz)}, and they’ve been told.` : `Your booking with ${esc(biz)} has been canceled.`}</p>` +
    `<p><b>${esc(appt.type_name)}</b> — ${esc(when)}</p>` +
    (reason ? `<p style="color:#666">${esc(reason.slice(0, 300))}</p>` : '') +
    `<p style="color:#666;font-size:.9rem">You’re welcome to book another time whenever it suits you. If it’s in your calendar, you can delete it there.</p>`;
  // sales item 78: from the business, like the confirmation
  await sendEmail(to, `Booking canceled — ${appt.type_name}`, body, brand, { critical: true, asBusiness: true, replyTo });
}

// ═════════ PUBLIC: the customer's own change-or-cancel link (builder list item 149) ═════════
// booking.html (on the app's address) reads the booking with GET and acts only with POST,
// so a mail scanner opening the link changes nothing. The signed link is the key
// (lib/booking_links.ts); manageState says what the customer may still do.
const MANAGE_SAY: Record<Exclude<ManageState, 'open'>, string> = {
  off: 'This booking can’t be changed online. Please get in touch with the business.',
  too_late: 'It’s too close to the time to change this booking online. Please get in touch with the business.',
  past: 'This booking’s time has passed.',
  canceled: 'This booking was canceled.',
  done: 'This booking is finished.',
};
interface Managed { appt: any; settings: { enabled: boolean; config: BookingConfig; intro: string } | null; bits: Awaited<ReturnType<typeof bookingBits>>; state: ManageState }
async function managed(token: unknown): Promise<Managed | null> {
  const id = await readManageToken(token);
  if (!id) return null;
  const appt = rows(await svc(`presence_appointments?id=eq.${id}&select=*&limit=1`))[0];
  if (!appt) return null;
  const [settings, bits] = await Promise.all([loadSettings(String(appt.site_id)), bookingBits(String(appt.site_id))]);
  const leadHours = settings ? settings.config.lead_time_hours : bits.leadHours;
  return { appt, settings, bits, state: manageState(appt, { selfManage: bits.opts.self_manage, leadHours }, Date.now()) };
}
const noLink = (cors: Record<string, string>) => json({ error: 'not_found', message: 'That link didn’t work.' }, 404, cors);

/** What the customer's page shows: the booking, what they may do, the calendar links. */
async function manageView(m: Managed): Promise<Record<string, unknown>> {
  const { appt, settings, bits, state } = m;
  const cfg = settings?.config || normalizeBookingConfig({});
  const upcoming = state === 'open' || state === 'off' || state === 'too_late';
  const [{ links }, site] = await Promise.all([
    bookingLinks(appt, bits.biz, bits.opts.self_manage),
    svc(`presence_sites?id=eq.${appt.site_id}&select=${SITE_COLS}&limit=1`).then((r) => rows(r)[0]).catch(() => null),
  ]);
  return {
    business: bits.biz.name, service: String(appt.type_name || ''), when: humanSlot(String(appt.slot_start_local || '')) || '',
    status: String(appt.status), state, can_move: state === 'open' && !!settings?.enabled,
    date: String(appt.slot_start_local || '').slice(0, 10), today: nowLocal(cfg.timezone).slice(0, 10), max_days_ahead: cfg.max_days_ahead,
    duration_min: Number(appt.duration_min) || 30, price: priceText(appt.price_cents),
    reach: { tel: bits.biz.tel, mail: bits.biz.mail },
    calendar: upcoming ? { google: links.google, outlook: links.outlook, ics: links.ics } : null,
    site_url: site && site.last_published_at ? siteOrigin(site) : '',
  };
}

/** PUBLIC — GET /book/manage?t=<link>: the booking, as the customer's page shows it. */
export async function handleManageGet(req: Request, cors: Record<string, string>): Promise<Response> {
  if (!(await rateAllow(`book:manage:${clientIp(req)}`, 40, 60))) return tooMany(cors);
  const m = await managed(new URL(req.url).searchParams.get('t'));
  return m ? json({ data: await manageView(m) }, 200, cors) : noLink(cors);
}

/** PUBLIC — GET /book/manage/slots?t=&date=: the open times to move to on a day, its own
 *  time left out of what's taken (so the times beside it are offered) and out of the list. */
export async function handleManageSlots(req: Request, cors: Record<string, string>): Promise<Response> {
  if (!(await rateAllow(`book:manage:slots:${clientIp(req)}`, 60, 60))) return tooMany(cors);
  const u = new URL(req.url);
  const m = await managed(u.searchParams.get('t'));
  if (!m) return noLink(cors);
  const date = String(u.searchParams.get('date') || '').trim();
  if (m.state !== 'open' || !m.settings?.enabled || !DATE_RE.test(date)) return json({ data: { date, slots: [] } }, 200, cors);
  const cfg = m.settings.config;
  const slots = generateSlots({ date, config: cfg, duration_min: Number(m.appt.duration_min) || 30, now_local: nowLocal(cfg.timezone), booked: await takenOn(String(m.appt.site_id), date, cfg, String(m.appt.id)) });
  return json({ data: { date, slots: slots.filter((x) => x !== m.appt.slot_start_local) } }, 200, cors);
}

/** PUBLIC — POST /book/manage { t, action: 'cancel' | 'move', slot }: the customer acts. */
export async function handleManagePost(req: Request, cors: Record<string, string>): Promise<Response> {
  if (!(await rateAllow(`book:manage:act:${clientIp(req)}`, 10, 60))) return tooMany(cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const m = await managed(b?.t);
  if (!m) return noLink(cors);
  if (m.state !== 'open') return json({ error: m.state, message: MANAGE_SAY[m.state], data: await manageView(m) }, 409, cors);
  if (b.action === 'cancel') return cancelByCustomer(m, cors);
  if (b.action === 'move') return moveByCustomer(m, String(b.slot || '').trim(), cors);
  return json({ error: 'bad_action', message: 'Choose a new time, or cancel.' }, 400, cors);
}

// Both change only the booking as it was read (its time and an active status), so two
// tabs, or the customer and the owner at once, can't both act on it.
const asRead = (a: any) => `presence_appointments?id=eq.${a.id}&site_id=eq.${a.site_id}&status=in.(pending,confirmed)&slot_start_local=eq.${encodeURIComponent(String(a.slot_start_local))}&select=*`;
const changedMeanwhile = (cors: Record<string, string>) => json({ error: 'changed', message: 'This booking was just changed. Reload the page to see it as it is now.' }, 409, cors);

async function cancelByCustomer(m: Managed, cors: Record<string, string>): Promise<Response> {
  const a = m.appt, siteId = String(a.site_id), now = new Date().toISOString();
  const up = await svc(asRead(a), { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'canceled', canceled_at: now, updated_at: now }) });
  if (!up.ok) return json({ error: 'write_failed', message: 'That didn’t go through — please try again.' }, 502, cors);
  const row = rows(up)[0];
  if (!row) return changedMeanwhile(cors);
  runAfterResponse(Promise.all([
    notifyCustomerCanceled(siteId, row, '', true),
    clearBookingNotices(siteId, String(a.id)).then(() => notifyOwnerOfChange(siteId, row, '')),
  ]).catch(() => {}));
  const biz = m.bits.biz.name;
  return json({ data: { ok: true, status: 'canceled', message: `Your booking is canceled.${biz ? ` ${biz} has been told.` : ''}` } }, 200, cors);
}

async function moveByCustomer(m: Managed, slot: string, cors: Record<string, string>): Promise<Response> {
  const a = m.appt, siteId = String(a.site_id);
  if (!m.settings?.enabled) return json({ error: 'disabled', message: 'Online booking is off just now, so the time can’t be changed here. You can still cancel, or get in touch with the business.' }, 409, cors);
  if (!LOCAL_DT_RE.test(slot)) return json({ error: 'bad_slot', message: 'Please pick one of the open times.' }, 400, cors);
  if (slot === a.slot_start_local) return json({ error: 'same_slot', message: 'That’s the time you have already.' }, 400, cors);
  const cfg = m.settings.config, dur = Number(a.duration_min) || 30, date = slot.slice(0, 10);
  // never trust the page: the time must be open right now, this booking's own time aside
  const open = generateSlots({ date, config: cfg, duration_min: dur, now_local: nowLocal(cfg.timezone), booked: await takenOn(siteId, date, cfg, String(a.id)) });
  const taken = () => json({ error: 'slot_taken', message: 'Sorry — that time was just taken. Please pick another.' }, 409, cors);
  if (!open.includes(slot)) return taken();
  // a moved booking follows the owner's rule for new ones: confirmed at once, or waiting for their OK
  const status = cfg.auto_confirm ? 'confirmed' : 'pending';
  const up = await svc(asRead(a), {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ slot_start: localToUtcIso(slot, cfg.timezone), slot_end: localToUtcIso(slotEndLocal(slot, dur), cfg.timezone), slot_start_local: slot, timezone: cfg.timezone, status, updated_at: new Date().toISOString() }),
  });
  if (up.status === 409) return taken();                    // the no-double-book index: someone took it a moment ago
  if (!up.ok) return json({ error: 'write_failed', message: 'That didn’t go through — please try again.' }, 502, cors);
  const row = rows(up)[0];
  if (!row) return changedMeanwhile(cors);
  const was = humanSlot(String(a.slot_start_local)) || String(a.slot_start_local);
  runAfterResponse(Promise.all([
    // the reminders follow the new time: the ones the old time had sent are forgotten
    svc(`presence_plan_notices?kind=eq.booking_reminder&period=like.${encodeURIComponent(`remind:${a.id}:`)}*`, { method: 'DELETE' }),
    notifyCustomer(siteId, row, status, was),
    notifyOwnerOfChange(siteId, row, String(a.slot_start_local)),
  ]).catch(() => {}));
  const when = humanSlot(slot) || slot;
  return json({ data: { ok: true, status, when, message: status === 'confirmed'
    ? `Your booking has moved to ${when}. A new confirmation is on its way.`
    : `Your booking has moved to ${when}. ${m.bits.biz.name || 'The business'} will confirm the new time shortly.` } }, 200, cors);
}

/** PUBLIC — GET /book/manage/calendar.ics?t=: the booking as a calendar file, the
 *  "Apple and others" link (a phone's calendar opens it). */
export async function handleManageIcs(req: Request): Promise<Response> {
  const plain = (status: number, body: string) => new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
  if (!(await rateAllow(`book:manage:ics:${clientIp(req)}`, 30, 60))) return plain(429, 'Too many tries — please wait a minute.');
  const m = await managed(new URL(req.url).searchParams.get('t'));
  if (!m) return plain(404, 'That link didn’t work.');
  if (m.state === 'canceled') return plain(410, 'This booking was canceled.');
  const { event } = await bookingLinks(m.appt, m.bits.biz, m.bits.opts.self_manage);
  if (!event) return plain(404, 'That link didn’t work.');
  return new Response(bookingIcs(event, new Date().toISOString()), { status: 200, headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="booking.ics"', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}

/** The owner hears at once when a customer moves or cancels: on the bell (the same kind as
 *  a new booking, so it opens the Bookings view) and by email. `from` is the old time of a
 *  move; empty for a cancel. */
async function notifyOwnerOfChange(siteId: string, appt: any, from: string): Promise<void> {
  const site = rows(await svc(`presence_sites?id=eq.${siteId}&select=client_id&limit=1`))[0];
  const clientId = site?.client_id || '';
  const when = humanSlot(String(appt.slot_start_local || '')) || String(appt.slot_start_local || '');
  const service = String(appt.type_name || '').slice(0, 60) || 'Booking';
  const who = String(appt.customer_name || '').trim() || 'A customer';
  const line = from
    ? `${who} moved it from ${humanSlot(from) || from}.${appt.status === 'pending' ? ' The new time waits for your OK.' : ''}`
    : `${who} canceled it from their confirmation email. The time is free again.`;
  if (clientId) {
    await raiseNotice({
      siteId, clientId, kind: 'new_booking', period: from ? `moved:${appt.id}:${appt.updated_at}` : `canceled:${appt.id}`,
      headline: from ? `Booking moved: ${service} — now ${when}` : `Booking canceled: ${service} — ${when}`, body: line,
    }).catch(() => {});
  }
  const ident = rows(await svc(`presence_identity?site_id=eq.${siteId}&select=email&limit=1`))[0];
  const to = ident?.email;
  if (!to) return;
  const brand = await loadEmailBrand(siteId);
  const contact = [appt.customer_email, appt.customer_phone].filter(Boolean).join(' · ');
  // Sales item 74: like a new booking, a moved or canceled one always reaches the owner (critical)
  await sendEmail(String(to), `${from ? 'Booking moved' : 'Booking canceled'} — ${appt.type_name}`,
    `<p>${esc(line)}</p>` +
    `<p><b>${esc(appt.type_name)}</b> — ${esc(when)}${from ? '' : ' (canceled)'}</p>${contact ? `<p>${esc(contact)}</p>` : ''}` +
    `<p class="cta"><a href="${siteBase()}/presence.html#bookings" style="display:inline-block;margin-top:6px;background:${brand.accent};color:#fff;padding:9px 16px;border-radius:999px;text-decoration:none">See your bookings →</a></p>`, brand, { critical: true });
}
