// ── Booking reminders + no-show handling — pure logic (task #164) ────────────
//   deno run --allow-read tests/presence/booking_reminders_test.mjs
// The PURE decision cores the two sweeps (commerce/lifecycle.runBookingReminders +
// runBookingFollowups) run against 0099's appointments:
//   • dueReminderBand — the mutually-exclusive day-before / same-day bands,
//   • planReminder    — the whole customer-reminder decision (only-confirmed,
//                       band due, SEND-ONCE via the ledger `sent` set, phone-only
//                       skip),
//   • noShowNudgeDue  — the owner no-show/completion nudge trigger (slot elapsed +
//                       still confirmed).
// All pure — no DB, no network, no clock. Suppression itself is enforced once at
// sendEmail (tested in email_infra); here "suppressed skip" is proven at the
// decision boundary (a phone-only booking has nothing to send).
import {
  dueReminderBand, planReminder, noShowNudgeDue,
  REMINDER_DAY_HRS, REMINDER_SAMEDAY_HRS,
} from '../../supabase/functions/presence/lib/booking.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };

const now = Date.parse('2026-07-20T12:00:00Z');
const hrs = (h) => now + h * 3600_000;   // a slot h hours from `now`
const NONE = new Set();

// ═══ dueReminderBand — mutually-exclusive bands, tz-free (epoch ms) ═══
ok('band: 30h out → no reminder yet', dueReminderBand(hrs(30), now) === null);
ok('band: 24h out (edge) → day_before', dueReminderBand(hrs(REMINDER_DAY_HRS), now) === 'day_before');
ok('band: 20h out → day_before', dueReminderBand(hrs(20), now) === 'day_before');
ok('band: just above same-day edge (3h) → day_before', dueReminderBand(hrs(3), now) === 'day_before');
ok('band: 2h out (edge) → same_day', dueReminderBand(hrs(REMINDER_SAMEDAY_HRS), now) === 'same_day');
ok('band: 1h out → same_day', dueReminderBand(hrs(1), now) === 'same_day');
ok('band: exactly at slot (0) → none', dueReminderBand(hrs(0), now) === null);
ok('band: past slot (-1h) → none', dueReminderBand(hrs(-1), now) === null);
ok('band: NaN inputs → none', dueReminderBand(NaN, now) === null && dueReminderBand(hrs(5), NaN) === null);
// mutual exclusivity: the two bands never both claim the same moment
{
  let overlap = false;
  for (let h = -1; h <= 30; h += 0.25) {
    const b = dueReminderBand(hrs(h), now);
    // a single call returns at most one band by construction — assert the band matches the interval
    if (b === 'same_day' && !(h > 0 && h <= REMINDER_SAMEDAY_HRS)) overlap = true;
    if (b === 'day_before' && !(h > REMINDER_SAMEDAY_HRS && h <= REMINDER_DAY_HRS)) overlap = true;
  }
  ok('band: bands are mutually exclusive across the whole horizon', !overlap);
}

// ═══ planReminder — the full customer-reminder decision ═══
const confEmail = { status: 'confirmed', slotStartMs: hrs(20), customer_email: 'guest@example.com' };
ok('plan: confirmed + email + day_before due → send day_before', planReminder(confEmail, now, NONE)?.band === 'day_before');
ok('plan: same-day due → send same_day', planReminder({ ...confEmail, slotStartMs: hrs(1) }, now, NONE)?.band === 'same_day');
ok('plan: only confirmed — pending is never reminded', planReminder({ ...confEmail, status: 'pending' }, now, NONE) === null);
ok('plan: only confirmed — canceled is never reminded', planReminder({ ...confEmail, status: 'canceled' }, now, NONE) === null);
ok('plan: phone-only (no email) → nothing to send (suppressed skip)', planReminder({ ...confEmail, customer_email: '' }, now, NONE) === null);
ok('plan: too far out (30h) → nothing yet', planReminder({ ...confEmail, slotStartMs: hrs(30) }, now, NONE) === null);
ok('plan: past slot → nothing', planReminder({ ...confEmail, slotStartMs: hrs(-2) }, now, NONE) === null);
// SEND-ONCE: a band already recorded in the ledger `sent` set is never re-sent
ok('plan: send-once — day_before already sent → null', planReminder(confEmail, now, new Set(['day_before'])) === null);
ok('plan: send-once — other band sent does NOT block a due band', planReminder(confEmail, now, new Set(['same_day']))?.band === 'day_before');
ok('plan: send-once — same_day already sent → null', planReminder({ ...confEmail, slotStartMs: hrs(1) }, now, new Set(['same_day'])) === null);
// a booking made <2h out gets exactly ONE reminder (same_day only) — never two
{
  const soon = { status: 'confirmed', slotStartMs: hrs(1.5), customer_email: 'g@e.com' };
  const first = planReminder(soon, now, NONE);
  const afterFirst = planReminder(soon, now, new Set([first.band]));
  ok('plan: a <2h booking → one same_day reminder, then nothing', first?.band === 'same_day' && afterFirst === null);
}

// ═══ noShowNudgeDue — owner no-show / completion nudge trigger ═══
ok('noshow: confirmed + slot elapsed → nudge due', noShowNudgeDue({ status: 'confirmed', slotEndMs: hrs(-1) }, now) === true);
ok('noshow: confirmed + slot still in future → not due', noShowNudgeDue({ status: 'confirmed', slotEndMs: hrs(2) }, now) === false);
ok('noshow: already completed → not due', noShowNudgeDue({ status: 'completed', slotEndMs: hrs(-1) }, now) === false);
ok('noshow: already no_show → not due', noShowNudgeDue({ status: 'no_show', slotEndMs: hrs(-1) }, now) === false);
ok('noshow: canceled → not due', noShowNudgeDue({ status: 'canceled', slotEndMs: hrs(-1) }, now) === false);
ok('noshow: pending (unconfirmed) + elapsed → not due', noShowNudgeDue({ status: 'pending', slotEndMs: hrs(-1) }, now) === false);
ok('noshow: NaN slot end → not due', noShowNudgeDue({ status: 'confirmed', slotEndMs: NaN }, now) === false);

const passed = results.filter((r) => r.p).length;
console.log(`\n════ BOOKING REMINDERS (task #164 pure): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
