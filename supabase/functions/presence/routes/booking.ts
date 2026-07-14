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
// DEFERRED (clean, not half-built): pay-at-booking (Stripe) · Google/Calendly two-way
// sync · complex recurrence · group/class bookings · per-staff calendars · reminders
// + no-show (task #164 — the data is ready; the sweep is a separate task). DST-exact
// conversion across a spring-forward gap uses a single refinement pass (good enough
// for MVP; a full tz-rules pass is future work).

import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { rateAllow, clientIp, tooMany } from '../lib/ratelimit.ts';
import { raiseNotice } from '../lib/notice.ts';
import { sendEmail } from '../commerce/account.ts';
import { loadEmailBrand } from '../lib/email_brand.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';
import {
  normalizeAppointmentType, normalizeBookingConfig, generateSlots, validateBookingInput,
  slotEndLocal, humanSlot, priceText, type BookingConfig, type AppointmentType,
} from '../lib/booking.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const rows = (r: { json?: unknown }) => (Array.isArray((r as any).json) ? (r as any).json : []) as any[];
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const APPROVAL_SECRET = Deno.env.get('APPROVAL_SECRET') || Deno.env.get('SCHEDULER_SECRET') || '';
const siteBase = () => (Deno.env.get('SITE_URL') || 'https://presence.davisdigitalstudio.com').replace(/\/$/, '');

// ═════════ timezone bridge (impure — the ONE place local↔UTC happens) ═════════
/** Offset in minutes to ADD to a UTC instant to get local wall-clock in `tz`
 *  (e.g. -420 for PDT). Falls back to 0 (UTC) on an unknown tz. */
function tzOffsetMin(tz: string, at: Date): number {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const p: Record<string, number> = {};
    for (const part of dtf.formatToParts(at)) if (part.type !== 'literal') p[part.type] = Number(part.value);
    const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return Math.round((asUTC - at.getTime()) / 60000);
  } catch { return 0; }
}
/** Business-local "YYYY-MM-DDTHH:MM" now in `tz`. */
function nowLocal(tz: string): string {
  const off = tzOffsetMin(tz, new Date());
  const local = new Date(Date.now() + off * 60000);   // shift so UTC fields read as local
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}-${String(local.getUTCDate()).padStart(2, '0')}T${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`;
}
/** A local "YYYY-MM-DDTHH:MM" wall-clock in `tz` → the UTC ISO instant. One
 *  refinement pass handles the common DST case honestly. */
function localToUtcIso(local: string, tz: string): string {
  const guess = Date.parse(local + ':00Z');                 // treat wall-clock as if UTC
  if (!Number.isFinite(guess)) return new Date().toISOString();
  let off = tzOffsetMin(tz, new Date(guess));
  let utc = guess - off * 60000;
  const off2 = tzOffsetMin(tz, new Date(utc));
  if (off2 !== off) utc = guess - off2 * 60000;             // refine across a DST edge
  return new Date(utc).toISOString();
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
/** Booked local ranges on ONE local date (to subtract from open slots). */
async function bookedOnDate(siteId: string, date: string): Promise<Array<{ start: string; end: string }>> {
  const r = await svc(`presence_appointments?site_id=eq.${siteId}&status=in.(pending,confirmed)&slot_start_local=like.${date}T*&select=slot_start_local,duration_min&limit=200`);
  const out: Array<{ start: string; end: string }> = [];
  for (const a of rows(r)) {
    const start = String(a.slot_start_local || '');
    if (start) out.push({ start, end: slotEndLocal(start, Number(a.duration_min) || 30) });
  }
  return out;
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

  const booked = await bookedOnDate(siteId, date);
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
  const booked = await bookedOnDate(siteId, dateOfSlot);
  const open = generateSlots({ date: dateOfSlot, config: settings.config, duration_min: type.duration_min, now_local: nowLocal(settings.config.timezone), booked });
  if (!open.includes(v.booking.slot_start)) {
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
      const existing = rows(await svc(`presence_contacts?site_id=eq.${siteId}&email=eq.${encodeURIComponent(v.booking.email)}&deleted_at=is.null&select=id&limit=1`))[0];
      if (existing) contactId = existing.id;
      else {
        const ins = await svc('presence_contacts', { method: 'POST', headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ site_id: siteId, name: v.booking.name, email: v.booking.email, phone: v.booking.phone }) });
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
  if (ins.status === 409) return json({ error: 'slot_taken', message: 'Sorry — that time was just taken. Please pick another.' }, 409, cors);
  if (!ins.ok || !rows(ins)[0]) return json({ error: 'write_failed', message: 'That didn’t go through — please try again.' }, 502, cors);
  const appt = rows(ins)[0];

  // Fan-out (all best-effort, non-blocking): customer confirmation email + owner
  // notice (bell + push) + owner email. Reuse the ONE of each — no new systems.
  notifyCustomer(siteId, appt, status).catch(() => {});
  notifyOwnerOfBooking(siteId, appt, status).catch(() => {});

  const when = humanSlot(v.booking.slot_start) || v.booking.slot_start;
  const msg = status === 'confirmed'
    ? `You’re booked for ${type.name} — ${when}. A confirmation is on its way.`
    : `Thanks — your ${type.name} request for ${when} was received. You’ll get a note once it’s confirmed.`;
  return calmOk(msg, { status, when, service: type.name });
}

async function notifyCustomer(siteId: string, appt: any, status: string): Promise<void> {
  const to = String(appt.customer_email || '');
  if (!to) return;                                            // phone-only booking → no email to send
  const ident = rows(await svc(`presence_identity?site_id=eq.${siteId}&select=business_name&limit=1`))[0];
  const biz = ident?.business_name || 'the team';
  const brand = await loadEmailBrand(siteId);
  const when = humanSlot(String(appt.slot_start_local || '')) || String(appt.slot_start_local || '');
  const price = priceText(appt.price_cents);
  const head = status === 'confirmed' ? 'Your booking is confirmed' : 'We got your booking request';
  const lead = status === 'confirmed'
    ? `You’re booked with ${esc(biz)}.`
    : `Thanks for booking with ${esc(biz)} — we’ll confirm shortly.`;
  const body =
    `<p>${lead}</p>` +
    `<table style="margin:8px 0;border-collapse:collapse"><tr><td style="padding:2px 12px 2px 0;color:#666">Service</td><td><b>${esc(appt.type_name)}</b></td></tr>` +
    `<tr><td style="padding:2px 12px 2px 0;color:#666">When</td><td><b>${esc(when)}</b></td></tr>` +
    (price ? `<tr><td style="padding:2px 12px 2px 0;color:#666">Price</td><td>${esc(price)}</td></tr>` : '') +
    `</table>` +
    (status === 'confirmed' ? '' : `<p style="color:#666">This time is being held for you — you’ll get a confirmation once it’s approved.</p>`) +
    `<p style="color:#666;font-size:.9rem">Need to change or cancel? Just reply to this email.</p>`;
  // A booking confirmation is transactional (a direct response to the customer's own
  // action) → critical:true survives an opt-out but still respects bounces.
  await sendEmail(to, `${head} — ${appt.type_name}`, body, brand, { critical: true });
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
  await sendEmail(String(to), `New booking — ${appt.type_name}`,
    `<p>You have a new booking${status === 'confirmed' ? '' : ' request'} from your website.</p>` +
    `<p><b>${esc(appt.type_name)}</b> — ${esc(when)}${price ? ` · ${esc(price)}` : ''}</p>` +
    `<p>${esc(who)}</p>${appt.note ? `<p style="color:#666">“${esc(String(appt.note).slice(0, 400))}”</p>` : ''}` +
    `<p class="cta"><a href="${siteBase()}/presence.html#bookings" style="display:inline-block;margin-top:6px;background:${brand.accent};color:#fff;padding:9px 16px;border-radius:999px;text-decoration:none">See it in your workspace →</a></p>`, brand);
}

// ═══════════════════════════ OWNER (authed) endpoints ════════════════════════
// Site-scoped via the boundary gate in index.ts (a client_reviewer never reaches
// these). The owner defines services + availability and manages appointments.

const unavailable = (cors: Record<string, string>) =>
  json({ error: 'unavailable', message: 'Online booking needs a one-time database update before it can be switched on.' }, 503, cors);

export async function handleBookingSettingsGet(site: SiteRow, cors: Record<string, string>): Promise<Response> {
  const r = await svc(`presence_booking_settings?site_id=eq.${site.id}&select=*&limit=1`);
  if (!r.ok) return unavailable(cors);
  const row = rows(r)[0];
  const config = normalizeBookingConfig(row || {});
  return json({ data: { enabled: !!(row && row.enabled), intro: String(row?.intro || ''), ...config } }, 200, cors);
}

export async function handleBookingSettingsPut(req: Request, site: SiteRow, _principal: Principal, cors: Record<string, string>): Promise<Response> {
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
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

async function notifyCustomerCanceled(siteId: string, appt: any, reason: string): Promise<void> {
  const to = String(appt.customer_email || '');
  if (!to) return;
  const ident = rows(await svc(`presence_identity?site_id=eq.${siteId}&select=business_name&limit=1`))[0];
  const biz = ident?.business_name || 'the team';
  const brand = await loadEmailBrand(siteId);
  const when = humanSlot(String(appt.slot_start_local || '')) || String(appt.slot_start_local || '');
  const body =
    `<p>Your booking with ${esc(biz)} has been canceled.</p>` +
    `<p><b>${esc(appt.type_name)}</b> — ${esc(when)}</p>` +
    (reason ? `<p style="color:#666">${esc(reason.slice(0, 300))}</p>` : '') +
    `<p style="color:#666;font-size:.9rem">You’re welcome to book another time whenever it suits you.</p>`;
  await sendEmail(to, `Booking canceled — ${appt.type_name}`, body, brand, { critical: true });
}
