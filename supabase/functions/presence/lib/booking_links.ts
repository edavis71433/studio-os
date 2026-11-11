// ── Builder list item 149: a booking's own links, for the customer ───────────
// Acuity's confirmation carries the booking as a calendar file, Google, Apple and
// Outlook buttons, and a Change/Cancel link; ours ended "just reply to this email".
// Now the confirmation, the reminder and a moved booking's note carry:
//   • the booking as a calendar file, attached, and the same file one tap away
//     ("Apple and others": the function serves it, so a phone's calendar opens it),
//   • Google Calendar and Outlook links that open the event ready to save,
//   • a private link to booking.html (on the app's address: a function's own address
//     can't show a page), where the customer picks another time or cancels, and the
//     owner is told at once (routes/booking.ts handleManage*).
// The private link is signed with the key the time tickets use (lib/form_check.ts) and
// kept nowhere. It works while the booking is upcoming, the owner lets customers change
// bookings, and the time is further off than the notice a new booking needs.
import { hmacHex, timingSafeEqual } from '../../_shared/hmac.ts';
import { icsEscape, foldLine } from './calendar_feed.ts';
import { svc } from './db.ts';
import { readReservedJson, RESERVED_NAMES } from './reserved_store.ts';

const signingKey = () => Deno.env.get('APPROVAL_SECRET') || Deno.env.get('SCHEDULER_SECRET') || '';
const APP = () => (Deno.env.get('APP_URL') || 'https://app.davisdigitalstudio.com').replace(/\/$/, '');
const FN = () => `${(Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '')}/functions/v1/presence`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const rows = (r: unknown) => (Array.isArray((r as { json?: unknown } | null)?.json) ? (r as { json: any[] }).json : []);

// ── the private link ──
/** "<booking id>.<signature>"; empty when no signing key is set (then no link is offered). */
export async function manageToken(apptId: string, key = signingKey()): Promise<string> {
  if (!key || !UUID.test(apptId)) return '';
  return `${apptId}.${(await hmacHex(key, `booking-manage|${apptId}`)).slice(0, 32)}`;
}
/** The booking a link is for, or null when it isn't one of ours. */
export async function readManageToken(token: unknown, key = signingKey()): Promise<string | null> {
  const m = /^([0-9a-f-]{36})\.([0-9a-f]{32})$/.exec(String(token ?? '').trim());
  if (!m || !key || !UUID.test(m[1])) return null;
  return timingSafeEqual(m[2], (await hmacHex(key, `booking-manage|${m[1]}`)).slice(0, 32)) ? m[1] : null;
}

// ── what the owner allows ──
/** Whether customers may change or cancel from their emails (on unless the owner turns it
 *  off), and the private address of the owner's own calendar. A reserved row (deny-all,
 *  function-mediated), because that address reads their whole calendar. */
export interface BookingOptions { self_manage: boolean; calendar_url: string; calendar_host: string }
export async function bookingOptions(siteId: string): Promise<BookingOptions> {
  const r = (await readReservedJson(siteId, RESERVED_NAMES.bookingOptions)) as Partial<BookingOptions> | null;
  return {
    self_manage: r?.self_manage !== false,
    calendar_url: typeof r?.calendar_url === 'string' ? r.calendar_url : '',
    calendar_host: typeof r?.calendar_host === 'string' ? r.calendar_host : '',
  };
}

export type ManageState = 'open' | 'off' | 'too_late' | 'past' | 'canceled' | 'done';
/** May the customer still change or cancel this booking themselves? Until the notice a new
 *  booking needs (the owner's "least notice"), and only while it's upcoming. */
export function manageState(a: { status?: string; slot_start?: string }, o: { selfManage: boolean; leadHours: number }, nowMs: number): ManageState {
  if (a.status === 'canceled') return 'canceled';
  if (a.status !== 'pending' && a.status !== 'confirmed') return 'done';
  const start = Date.parse(String(a.slot_start || ''));
  if (!Number.isFinite(start) || start <= nowMs) return 'past';
  if (!o.selfManage) return 'off';
  if (start - Math.max(0, Number(o.leadHours) || 0) * 3600_000 <= nowMs) return 'too_late';
  return 'open';
}

// ── the calendar event ──
export interface BookingEvent {
  id: string; title: string; startMs: number; endMs: number;
  location?: string; details?: string; url?: string; pending?: boolean; sequence?: number;
}
const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** The booking as a calendar file of its own: one event, the same id each time, so a moved
 *  booking's new file updates the event it replaces in most calendars. */
export function bookingIcs(e: BookingEvent, nowIso: string): string {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Studio OS//Booking//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:appt-${e.id}@studio-os`, `DTSTAMP:${stamp(Date.parse(nowIso) || Date.now())}`, `SEQUENCE:${Math.max(0, Math.trunc(e.sequence || 0))}`,
    `DTSTART:${stamp(e.startMs)}`, `DTEND:${stamp(e.endMs)}`, `SUMMARY:${icsEscape(e.title)}`];
  if (e.details) L.push(`DESCRIPTION:${icsEscape(e.details)}`);
  if (e.location) L.push(`LOCATION:${icsEscape(e.location)}`);
  if (e.url) L.push(`URL:${e.url.replace(/[\r\n]/g, '')}`);
  L.push(`STATUS:${e.pending ? 'TENTATIVE' : 'CONFIRMED'}`, 'TRANSP:OPAQUE', 'END:VEVENT', 'END:VCALENDAR');
  return L.map(foldLine).join('\r\n') + '\r\n';
}

const query = (o: Record<string, string>) => Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
/** Opens Google Calendar with the event filled in, ready to save. */
export function googleCalendarLink(e: BookingEvent): string {
  return `https://calendar.google.com/calendar/render?${query({ action: 'TEMPLATE', text: e.title, dates: `${stamp(e.startMs)}/${stamp(e.endMs)}`, details: e.details || '', location: e.location || '' })}`;
}
/** The same for Outlook on the web. */
export function outlookCalendarLink(e: BookingEvent): string {
  return `https://outlook.live.com/calendar/0/deeplink/compose?${query({ path: '/calendar/action/compose', rru: 'addevent', subject: e.title, startdt: iso(e.startMs), enddt: iso(e.endMs), body: e.details || '', location: e.location || '' })}`;
}

// ── the business, as the customer's links need it ──
export interface BookingBits { name: string; location: string; tel: string; mail: string }
/** The business's name, address and ways to reach it, what the owner allows, and the
 *  notice a booking needs: read once for an email or the customer's page. */
export async function bookingBits(siteId: string): Promise<{ biz: BookingBits; opts: BookingOptions; leadHours: number }> {
  const [ident, loc, set, opts] = await Promise.all([
    svc(`presence_identity?site_id=eq.${siteId}&select=business_name,email,phone&limit=1`).catch(() => null),
    svc(`presence_locations?site_id=eq.${siteId}&select=address_line1,address_line2,city,region,postal_code,phone&limit=1`).catch(() => null),
    svc(`presence_booking_settings?site_id=eq.${siteId}&select=lead_time_hours&limit=1`).catch(() => null),
    bookingOptions(siteId),
  ]);
  const i = rows(ident)[0] || {}, l = rows(loc)[0] || {};
  const line = (...xs: unknown[]) => xs.map((x) => String(x ?? '').trim()).filter(Boolean);
  const location = l.address_line1 ? [line(l.address_line1, l.address_line2).join(' '), line(l.city, line(l.region, l.postal_code).join(' ')).join(', ')].filter(Boolean).join(', ') : '';
  const tel = String(l.phone || i.phone || '').trim().slice(0, 40), mail = String(i.email || '').trim().slice(0, 254);
  const lead = Number(rows(set)[0]?.lead_time_hours);
  return {
    biz: { name: String(i.business_name || '').trim(), location, tel: /\d/.test(tel) ? tel : '', mail: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail) ? mail : '' },
    opts, leadHours: Number.isFinite(lead) ? lead : 2,
  };
}

// ── the links ──
export interface BookingLinks { google: string; outlook: string; ics: string; manage: string }
interface ApptLike { id: string; type_name?: string; slot_start: string; slot_end?: string; duration_min?: number; status?: string; updated_at?: string }
/** The customer's links for a booking, and the calendar event they carry. The private
 *  link rides in the event while the owner lets customers change bookings at all. */
export async function bookingLinks(a: ApptLike, biz: BookingBits, withManage: boolean, key = signingKey()): Promise<{ links: BookingLinks; event: BookingEvent | null }> {
  const token = await manageToken(String(a.id), key);
  const manage = token && withManage ? `${APP()}/booking.html?t=${encodeURIComponent(token)}` : '';
  const service = String(a.type_name || '').trim() || 'Appointment';
  const startMs = Date.parse(String(a.slot_start || ''));
  const endMs = Date.parse(String(a.slot_end || '')) || startMs + (Number(a.duration_min) || 30) * 60_000;
  const timed = Number.isFinite(startMs) && Number.isFinite(endMs);   // no time, no calendar links (never so for a stored booking)
  const pending = a.status === 'pending';
  const event: BookingEvent = {
    id: String(a.id), title: biz.name ? `${service} with ${biz.name}` : service, startMs, endMs, location: biz.location || undefined,
    details: [`Booked online${biz.name ? ` with ${biz.name}` : ''}.`, pending ? 'Waiting for them to confirm.' : '', manage ? `To change or cancel: ${manage}` : ''].filter(Boolean).join('\n'),
    url: manage || undefined, pending, sequence: Math.floor((Date.parse(String(a.updated_at || '')) || 0) / 60_000),
  };
  return {
    links: timed ? { google: googleCalendarLink(event), outlook: outlookCalendarLink(event), ics: token ? `${FN()}/book/manage/calendar.ics?t=${encodeURIComponent(token)}` : '', manage } : { ...NO_LINKS, manage },
    event: timed ? event : null,
  };
}
const NO_LINKS: BookingLinks = { google: '', outlook: '', ics: '', manage: '' };

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
/** The lines a booking email ends with: add it to a calendar, and change or cancel it. */
export function bookingLinksHtml(l: BookingLinks, canManage: boolean): string {
  const cal = ([['Google', l.google], ['Outlook', l.outlook], ['Apple and others', l.ics]] as const).filter(([, u]) => u)
    .map(([t, u]) => `<a href="${attr(u)}" style="color:inherit">${t}</a>`).join(' · ');
  return (cal ? `<p style="margin:14px 0 0;color:#666;font-size:.9rem">Add it to your calendar: ${cal}</p>` : '') +
    (canManage && l.manage
      ? `<p style="color:#666;font-size:.9rem">Need to change or cancel? <a href="${attr(l.manage)}" style="color:inherit">Pick another time or cancel</a>, or just reply to this email.</p>`
      : `<p style="color:#666;font-size:.9rem">Need to change or cancel? Just reply to this email.</p>`);
}

/** The calendar file as an email attachment (sendEmail sends it on as base64). */
export function icsAttachment(ics: string): { filename: string; content: Uint8Array } {
  return { filename: 'booking.ics', content: new TextEncoder().encode(ics) };
}

type Bits = Awaited<ReturnType<typeof bookingBits>>;
/** Everything one booking email adds: the closing lines and the calendar file. `known` is
 *  the business, read once by a sweep that sends many. Never throws: without the business's
 *  details the email still ends "just reply to this email". */
export async function bookingMail(a: ApptLike & { site_id: string }, nowMs = Date.now(), known?: Bits | Promise<Bits>): Promise<{ html: string; attachments: Array<{ filename: string; content: Uint8Array }>; links: BookingLinks; canManage: boolean; biz: BookingBits }> {
  try {
    const bits = await (known || bookingBits(String(a.site_id)));
    const canManage = manageState(a, { selfManage: bits.opts.self_manage, leadHours: bits.leadHours }, nowMs) === 'open';
    const { links, event } = await bookingLinks(a, bits.biz, bits.opts.self_manage);
    return { html: bookingLinksHtml(links, canManage), attachments: event ? [icsAttachment(bookingIcs(event, new Date(nowMs).toISOString()))] : [], links, canManage, biz: bits.biz };
  } catch {
    return { html: bookingLinksHtml(NO_LINKS, false), attachments: [], links: NO_LINKS, canManage: false, biz: { name: '', location: '', tel: '', mail: '' } };
  }
}
