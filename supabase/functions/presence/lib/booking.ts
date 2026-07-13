// ── Native booking / appointments — pure cores (Phase BK / MVP) ──────────────
// THE MOAT: a small business's customers book a real appointment online, calm and
// structured — no external calendar, no code. The owner defines bookable
// appointment TYPES + a weekly AVAILABILITY window; a visitor picks a service, a
// day, an open slot, and their details. A booking is a self-serve public
// submission (exactly like a form submit — honeypot + rate-limit + validation +
// escaping live in the route) that creates a pending/confirmed appointment the
// owner sees, is emailed about, and gets a bell notice for.
//
// This module is PURE (no I/O, no clock, no randomness): the availability model,
// the slot-generation engine, and the request validator. The route (routes/
// booking.ts) adds the DB, the honeypot/rate-limit, the emails, the CRM contact,
// and the owner notice — reusing the ONE of each (no parallel systems).
//
// TIME MODEL (MVP, honest + testable): all slot math is done in the business's
// LOCAL wall-clock, as strings "YYYY-MM-DD" + "HH:MM". generateSlots never touches
// a real timezone database, so it is deterministic and unit-testable. The route
// converts local ↔ UTC once (using the site's configured IANA timezone) purely for
// storage (timestamptz) and the "now / lead-time" boundary. DST-exact conversion
// and multi-timezone staff are DEFERRED (see routes/booking.ts TODOs).
//
// DEFERRED (reserved, NOT half-built): pay-at-booking (Stripe), Google/Calendly
// two-way sync, complex recurrence, group/class bookings, per-staff calendars,
// reminders + no-show handling (separate task #164 — this module only makes the
// data ready). None are stubbed here; each is a clean future addition.

// ── appointment types ────────────────────────────────────────────────────────
export interface AppointmentType {
  id?: string;
  name: string;
  duration_min: number;         // how long the appointment runs
  price_cents?: number | null;  // optional; null = "no set price"
  description?: string;
  active: boolean;
  sort_order: number;
}

// ── weekly availability + booking window config ──────────────────────────────
export interface TimeRange { start: string; end: string }   // "HH:MM"–"HH:MM", local
/** index 0 = Sunday … 6 = Saturday; each day holds 0+ open ranges. */
export type WeeklyHours = TimeRange[][];

export interface BookingConfig {
  weekly: WeeklyHours;
  closed_dates: string[];       // YYYY-MM-DD exceptions (holidays / one-off closures)
  slot_interval_min: number;    // step between offered slot starts (e.g. 15/30/60)
  buffer_min: number;           // gap kept before+after each booked appointment
  lead_time_hours: number;      // earliest bookable = now + this many hours
  max_days_ahead: number;       // latest bookable = today + this many days
  timezone: string;             // IANA name (display + the route's local↔UTC bridge)
  auto_confirm: boolean;        // true → new bookings land 'confirmed'; false → 'pending'
}

// ── caps (bounded, never unbounded) ──────────────────────────────────────────
const MAX_TYPES = 30;
const MAX_RANGES_PER_DAY = 6;
const MAX_CLOSED_DATES = 120;
const CAP = { name: 80, desc: 400, note: 1000, person: 120, email: 200, phone: 40 };
const DUR_MIN = 5, DUR_MAX = 8 * 60;               // 5 min … 8 hours
const INTERVAL_CHOICES = [5, 10, 15, 20, 30, 45, 60, 90, 120];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const LOCAL_DT_RE = /^\d{4}-\d{2}-\d{2}T([01]?\d|2[0-3]):([0-5]\d)$/;

const s = (x: unknown, n: number): string => {
  let o = ''; for (const ch of String(x ?? '')) { const c = ch.codePointAt(0)!; o += (c < 0x20 || c === 0x7f) ? ' ' : ch; }
  return o.replace(/\s+/g, ' ').trim().slice(0, n);
};
const intIn = (x: unknown, lo: number, hi: number, dflt: number): number => {
  const n = Math.trunc(Number(x));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

// ═════════ pure date/time helpers ═════════
// All arithmetic uses Date.UTC on LOCAL wall-clock components — deterministic and
// timezone-free (no getTimezoneOffset, no Date.parse ambiguity). "local" strings
// are treated as UTC purely for internal comparison; consistency holds because the
// pure module never emits a real UTC instant.
function hhmmToMin(t: string): number | null {
  const m = HHMM_RE.exec(t); if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
function minToHHMM(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
/** Absolute minutes for a local "YYYY-MM-DD" + minute-of-day, via Date.UTC. */
function dateMin(dateStr: string, minOfDay: number): number | null {
  const m = DATE_RE.exec(dateStr); if (!m) return null;
  const [y, mo, d] = dateStr.split('-').map(Number);
  const ms = Date.UTC(y, mo - 1, d);
  if (!Number.isFinite(ms)) return null;
  // guard against JS rollover (e.g. month 13) — round-trip must match
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return Math.floor(ms / 60000) + minOfDay;
}
/** Absolute minutes for a local "YYYY-MM-DDTHH:MM". */
export function localToMin(local: string): number | null {
  if (!LOCAL_DT_RE.test(local)) return null;
  const [date, time] = local.split('T');
  const mo = hhmmToMin(time); if (mo == null) return null;
  return dateMin(date, mo);
}
/** 0 = Sunday … 6 = Saturday for a local "YYYY-MM-DD" (deterministic via Date.UTC). */
export function dayOfWeek(dateStr: string): number | null {
  const m = DATE_RE.exec(dateStr); if (!m) return null;
  const [y, mo, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}
/** Add whole days to a local "YYYY-MM-DD" → a new "YYYY-MM-DD" (pure). */
export function addDays(dateStr: string, days: number): string {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d) + days * 86400_000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
/** end of a slot as a local "YYYY-MM-DDTHH:MM", duration minutes after start. */
export function slotEndLocal(startLocal: string, durationMin: number): string {
  const [date, time] = startLocal.split('T');
  const mo = hhmmToMin(time) ?? 0;
  const total = mo + Math.max(0, Math.trunc(durationMin));
  if (total < 1440) return `${date}T${minToHHMM(total)}`;
  // crosses midnight (long appointment) — roll the date forward
  return `${addDays(date, Math.floor(total / 1440))}T${minToHHMM(total % 1440)}`;
}

// ═════════ normalizeAppointmentType — the safety gate for a bookable service ═════
export function normalizeAppointmentType(raw: unknown):
  { ok: true; type: AppointmentType } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'An appointment type needs a name.' };
  const r = raw as any;
  const name = s(r.name, CAP.name);
  if (!name) return { ok: false, error: 'Give this appointment a name (e.g. “Haircut”).' };
  const duration_min = intIn(r.duration_min ?? r.duration, DUR_MIN, DUR_MAX, 30);
  const type: AppointmentType = {
    name, duration_min, active: r.active === false ? false : true,
    sort_order: intIn(r.sort_order, 0, 9999, 0),
  };
  if (typeof r.id === 'string' && /^[0-9a-f-]{36}$/i.test(r.id)) type.id = r.id;
  const desc = s(r.description, CAP.desc); if (desc) type.description = desc;
  // price is optional; a finite non-negative cents value or null ("no set price")
  if (r.price_cents != null && r.price_cents !== '') {
    const p = Math.trunc(Number(r.price_cents));
    if (Number.isFinite(p) && p >= 0 && p <= 100_000_00) type.price_cents = p;
  }
  return { ok: true, type };
}

// ═════════ normalizeBookingConfig — always returns a safe, render-ready config ═══
// Never rejects: unknown/garbage weekly entries are dropped, numbers are clamped to
// sane bounds, so a half-filled owner form still yields a coherent booking window.
const DEFAULT_WEEKLY: WeeklyHours = [[], [], [], [], [], [], []];
export function normalizeBookingConfig(raw: unknown): BookingConfig {
  const r = (raw && typeof raw === 'object') ? raw as any : {};
  const weekly: WeeklyHours = [[], [], [], [], [], [], []];
  const rawWeekly = Array.isArray(r.weekly) ? r.weekly : DEFAULT_WEEKLY;
  for (let d = 0; d < 7; d++) {
    const day = Array.isArray(rawWeekly[d]) ? rawWeekly[d] : [];
    for (const rg of day.slice(0, MAX_RANGES_PER_DAY)) {
      const start = s(rg?.start, 5), end = s(rg?.end, 5);
      const a = hhmmToMin(start), b = hhmmToMin(end);
      if (a == null || b == null || b <= a) continue;     // drop empty/backwards ranges
      weekly[d].push({ start: minToHHMM(a), end: minToHHMM(b) });
    }
    // keep ranges ordered + non-overlapping (merge is overkill; order + de-overlap)
    weekly[d].sort((x, y) => hhmmToMin(x.start)! - hhmmToMin(y.start)!);
    const merged: TimeRange[] = [];
    for (const rg of weekly[d]) {
      const last = merged[merged.length - 1];
      if (last && hhmmToMin(rg.start)! < hhmmToMin(last.end)!) {
        if (hhmmToMin(rg.end)! > hhmmToMin(last.end)!) last.end = rg.end;   // extend
      } else merged.push({ ...rg });
    }
    weekly[d] = merged;
  }
  const closed_dates = (Array.isArray(r.closed_dates) ? r.closed_dates : [])
    .map((x: unknown) => s(x, 10)).filter((x: string) => DATE_RE.test(x) && dateMin(x, 0) != null)   // real calendar dates only
    .slice(0, MAX_CLOSED_DATES);
  const rawInt = intIn(r.slot_interval_min, 5, 120, 30);
  const slot_interval_min = INTERVAL_CHOICES.reduce((best, c) => Math.abs(c - rawInt) < Math.abs(best - rawInt) ? c : best, 30);
  return {
    weekly, closed_dates, slot_interval_min,
    buffer_min: intIn(r.buffer_min, 0, 240, 0),
    lead_time_hours: intIn(r.lead_time_hours, 0, 720, 2),
    max_days_ahead: intIn(r.max_days_ahead, 1, 365, 60),
    timezone: s(r.timezone, 60) || 'America/Los_Angeles',
    auto_confirm: r.auto_confirm === true,
  };
}

// ═════════ generateSlots — the PURE availability engine ═════════
// Open slots on ONE local date = the day's weekly ranges, stepped by the interval,
// where the appointment (start + duration) fits inside a range, is not inside a
// closed day, is at/after the lead-time boundary, is within the max-days window,
// and does not collide with an already-booked appointment (± buffer). Returns local
// "YYYY-MM-DDTHH:MM" start strings, ascending. Deterministic; no clock.
export interface SlotGenInput {
  date: string;                                    // YYYY-MM-DD (business-local)
  config: BookingConfig;
  duration_min: number;                            // the chosen appointment type's length
  now_local: string;                               // "YYYY-MM-DDTHH:MM" business-local now
  booked: Array<{ start: string; end: string }>;   // local "YYYY-MM-DDTHH:MM" ranges to avoid
}
export function generateSlots(input: SlotGenInput): string[] {
  const { date, config, duration_min } = input;
  if (!DATE_RE.test(date)) return [];
  const dur = Math.max(DUR_MIN, Math.trunc(duration_min || 0));
  const dow = dayOfWeek(date);
  if (dow == null) return [];
  if (config.closed_dates.includes(date)) return [];

  // window bounds — the requested date must sit in [todayLocal, todayLocal+maxDays].
  const nowMin = localToMin(input.now_local);
  const todayLocal = LOCAL_DT_RE.test(input.now_local) ? input.now_local.split('T')[0] : null;
  if (nowMin == null || !todayLocal) return [];
  if (date < todayLocal) return [];
  if (date > addDays(todayLocal, config.max_days_ahead)) return [];
  const earliestMin = nowMin + config.lead_time_hours * 60;   // lead-time boundary

  const buffer = config.buffer_min;
  const bookedAbs = input.booked
    .map((b) => ({ a: localToMin(b.start), z: localToMin(b.end) }))
    .filter((b): b is { a: number; z: number } => b.a != null && b.z != null);

  const out: string[] = [];
  for (const range of config.weekly[dow] || []) {
    const rs = hhmmToMin(range.start), re = hhmmToMin(range.end);
    if (rs == null || re == null) continue;
    for (let m = rs; m + dur <= re; m += config.slot_interval_min) {
      const startAbs = dateMin(date, m);
      if (startAbs == null) continue;
      if (startAbs < earliestMin) continue;                       // before lead-time
      const endAbs = startAbs + dur;
      // collide with any booked appointment (buffer separates the two intervals)
      const clash = bookedAbs.some((b) => startAbs < b.z + buffer && b.a - buffer < endAbs);
      if (clash) continue;
      out.push(`${date}T${minToHHMM(m)}`);
    }
  }
  return out;
}

// ═════════ validateBookingInput — the runtime gate for a public booking ═════════
// Mirrors lib/commercial.validateSubmission: caps every field, requires a reachable
// contact (email or phone), and validates the chosen slot shape. The route re-checks
// the slot is ACTUALLY open (recomputes generateSlots) and enforces the atomic no-
// double-book — this only shapes + sanitizes the request. Honeypot stays in the route.
export interface CleanBooking {
  type_id: string; slot_start: string; name: string; email: string; phone: string; note: string;
}
export function validateBookingInput(body: any):
  { ok: true; booking: CleanBooking } | { ok: false; error: string } {
  const type_id = s(body?.type_id ?? body?.type, 40);
  if (!type_id) return { ok: false, error: 'choose_service' };
  const slot_start = s(body?.slot_start ?? body?.slot, 20);
  if (!LOCAL_DT_RE.test(slot_start)) return { ok: false, error: 'bad_slot' };
  const name = s(body?.name, CAP.person);
  const email = s(body?.email, CAP.email).toLowerCase();
  const phone = s(body?.phone, CAP.phone);
  const note = s(body?.note ?? body?.message, CAP.note);
  if (!name) return { ok: false, error: 'need_name' };
  if (!email && !phone) return { ok: false, error: 'need_contact' };
  if (email && !EMAIL_RE.test(email)) return { ok: false, error: 'bad_email' };
  return { ok: true, booking: { type_id, slot_start, name, email, phone, note } };
}

// ── display helpers (used by the confirmation copy + owner list; pure) ──────────
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** "2026-07-20T14:30" → "Monday, Jul 20 at 2:30 PM" (null when malformed). */
export function humanSlot(local: string): string | null {
  if (!LOCAL_DT_RE.test(local)) return null;
  const [date, time] = local.split('T');
  const dow = dayOfWeek(date); if (dow == null) return null;
  const [y, mo, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const ampm = hh < 12 ? 'AM' : 'PM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${DAYS[dow]}, ${MONTHS[mo - 1]} ${d} at ${h12}:${String(mm).padStart(2, '0')} ${ampm}`;
}
/** cents → "$40" / "$39.50" (null when no price). Pure. */
export function priceText(cents?: number | null): string | null {
  if (cents == null || !Number.isFinite(cents)) return null;
  const whole = cents % 100 === 0;
  return `$${whole ? String(cents / 100) : (cents / 100).toFixed(2)}`;
}

// ═════════ reminders + no-show handling — PURE decision cores (task #164) ═════════
// The data (0099) was made ready; this is the logic the sweeps in commerce/
// lifecycle.ts run against it. Kept here, pure + unit-tested, exactly like the
// slot engine: the sweep supplies the clock, the DB, the notice-ledger dedup, and
// the branded email (all impure), and calls these to DECIDE.
//
// A confirmed appointment earns a calm customer reminder in ONE of two mutually-
// exclusive bands before the slot — so a single appointment is never reminded
// twice at once, and a very-soon booking gets exactly one nudge, not two:
//   (2h, 24h]  → 'day_before'  (the ~24h-out reminder)
//   (0, 2h]    → 'same_day'    (a short "see you soon" nudge)
// The sweep dedups each band once via the ONE notice model (period
// `remind:<id>:<band>`); suppression is inherited from sendEmail's ONE gate.
export const REMINDER_DAY_HRS = 24;      // upper edge of the day-before band
export const REMINDER_SAMEDAY_HRS = 2;   // upper edge of the same-day band

export type ReminderBand = 'day_before' | 'same_day';

/** Which reminder band (if any) is due for a slot right now. Pure + tz-free (both
 *  args are epoch-ms). Mutually exclusive bands; null when past or still too far. */
export function dueReminderBand(slotStartMs: number, nowMs: number): ReminderBand | null {
  if (!Number.isFinite(slotStartMs) || !Number.isFinite(nowMs)) return null;
  const hrs = (slotStartMs - nowMs) / 3600_000;
  if (hrs <= 0) return null;                                   // slot started/past — reminders stop
  if (hrs <= REMINDER_SAMEDAY_HRS) return 'same_day';
  if (hrs <= REMINDER_DAY_HRS) return 'day_before';
  return null;                                                 // too far out yet
}

export interface ReminderPlanInput {
  status?: string;
  slotStartMs: number;
  customer_email?: string;
}
/** The one reminder to send for an appointment now, or null. Encapsulates the
 *  whole customer-reminder decision so it is testable without any I/O:
 *    • only 'confirmed' appointments are reminded,
 *    • only when a band is due (dueReminderBand),
 *    • send-once — a band already in `sent` (from the notice ledger) yields null,
 *    • a phone-only booking (no email) has nothing to send.
 *  The sweep still guards send-once ATOMICALLY via the unique notice insert; this
 *  `sent` pre-filter just avoids a redundant write on the common path. */
export function planReminder(
  a: ReminderPlanInput, nowMs: number, sent: ReadonlySet<string>,
): { band: ReminderBand } | null {
  if (a.status !== 'confirmed') return null;                   // only confirmed appointments
  if (!a.customer_email) return null;                          // phone-only → no email reminder
  const band = dueReminderBand(a.slotStartMs, nowMs);
  if (!band) return null;
  if (sent.has(band)) return null;                             // send-once per band
  return { band };
}

/** Is a no-show / completion nudge due for the OWNER? The slot has fully ELAPSED
 *  and the appointment is still 'confirmed' — i.e. the owner never marked it done,
 *  no-show, or canceled. Pure; the sweep bounds "not ancient" in SQL and dedups
 *  once via the notice ledger. */
export function noShowNudgeDue(a: { status?: string; slotEndMs: number }, nowMs: number): boolean {
  return a.status === 'confirmed' && Number.isFinite(a.slotEndMs) && a.slotEndMs < nowMs;
}
