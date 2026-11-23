// ── Special dates: one day closed, or open different hours (builder list item 432, Nov 2026) ──
// The Hours card in Business details takes a date with a short note ("Closed for
// Thanksgiving"): closed that day, or open its own hours. They are the main location's
// holiday_exceptions (0015's column; HolidayException in render_types.ts), so nothing new is
// stored and no migration is needed. The site shows each date until the day is over: in the
// hours list, the phone bar's tray, the Open now line and the Today card, and Google is told
// of every one still to come. Bookings offer no time on a closed date and keep to a date's own
// hours (lib/booking.ts). "Today" is the day in the site's own time zone (the main location's,
// Los Angeles unless it says otherwise), so a Burbank shop's Thanksgiving still shows at 9pm
// that Thursday. A date that has gone by is never shown or offered again, and the next save of
// the location leaves it out. Dates can be set up to a year ahead, forty at most (the same
// forty lib/manifest_validate.ts holds). Pure.
import type { HolidayException, HoursInterval } from './render_types.ts';
import { HOLIDAY_ZONE, localDay } from './holidays.ts';

export const SPECIAL_MAX = 40;
export const SPECIAL_DAYS_AHEAD = 366;   // next year's Thanksgiving can be set the day after this year's
export const SPECIAL_NOTE_MAX = 60;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** True for a real calendar date written YYYY-MM-DD. */
export function isDay(v: unknown): v is string {
  const m = DATE_RE.exec(String(v ?? ''));
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** The day `n` days after a YYYY-MM-DD day. */
export function plusDays(day: string, n: number): string {
  const m = DATE_RE.exec(day);
  if (!m) return '';
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n)).toISOString().slice(0, 10);
}

/** Today (YYYY-MM-DD) in the site's own time zone at an ISO moment. A zone this computer
 *  doesn't know is read as the studio's; '' when the moment isn't one. */
export function todayIn(nowIso: string, zone?: string | null): string {
  if (!Number.isFinite(Date.parse(String(nowIso || '')))) return '';
  try { return localDay(nowIso, String(zone || '').trim() || HOLIDAY_ZONE); } catch { return localDay(nowIso, HOLIDAY_ZONE); }
}

function text(v: unknown, max: number): string {
  let out = '';
  for (const ch of String(v ?? '')) { const c = ch.codePointAt(0)!; if (c >= 32 && c !== 127) out += ch; }
  return out.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** One date as it is kept: closed, or open at up to three times; a date with no time that
 *  can be used is closed. */
function cleanOne(e: Record<string, unknown>): HolidayException {
  const intervals: HoursInterval[] = e.closed === true ? [] : (Array.isArray(e.intervals) ? e.intervals : [])
    .filter((iv) => iv && TIME_RE.test(String(iv.open)) && TIME_RE.test(String(iv.close)) && String(iv.open) !== String(iv.close))
    .slice(0, 3).map((iv) => ({ open: String(iv.open), close: String(iv.close) }));
  return { date: String(e.date), label: text(e.label, SPECIAL_NOTE_MAX), closed: intervals.length === 0, intervals };
}

/** The dates still to come on `today` (that day counts; '' keeps every one), one per date (the
 *  last given wins), in date order. Anything that isn't a date is left out. Pure. */
export function upcomingSpecial(list: unknown, today: string): HolidayException[] {
  const by = new Map<string, HolidayException>();
  for (const e of Array.isArray(list) ? list : []) {
    if (!e || typeof e !== 'object' || !isDay((e as { date?: unknown }).date)) continue;
    const date = String((e as { date: string }).date);
    if (today && date < today) continue;
    by.set(date, cleanOne(e as Record<string, unknown>));
  }
  return [...by.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** What a save sends, made safe, or why it can't be kept: something that isn't a list of
 *  real dates, a date further ahead than a year, or more than forty dates. A date gone by is
 *  dropped without a word: that is the tidy-up. Pure. */
export function cleanSpecialDates(v: unknown, today: string): { ok: true; list: HolidayException[] } | { ok: false; message: string } {
  if (v === null || v === undefined) return { ok: true, list: [] };
  if (!Array.isArray(v) || v.some((e) => !e || typeof e !== 'object' || !isDay((e as { date?: unknown }).date))) {
    return { ok: false, message: 'One of the special dates isn’t a real date. Check it and try again.' };
  }
  const list = upcomingSpecial(v, today);
  const last = plusDays(today, SPECIAL_DAYS_AHEAD);
  if (last && list.some((e) => e.date > last)) return { ok: false, message: 'Special dates can be set up to a year ahead.' };
  if (list.length > SPECIAL_MAX) return { ok: false, message: `You can keep up to ${SPECIAL_MAX} special dates.` };
  return { ok: true, list };
}

/** Snapshot content as the site shows it at `nowIso`: each location keeps only the special
 *  dates still to come in its own time zone. The same object back when there are none. Pure. */
export function specialAsOf<T>(content: T, nowIso: string): T {
  type Loc = { timezone?: string; holiday_exceptions?: unknown };
  const has = (l: Loc | null | undefined) => Array.isArray(l?.holiday_exceptions) && (l!.holiday_exceptions as unknown[]).length > 0;
  const locs = (content as { locations?: Loc[] } | null)?.locations;
  if (!Array.isArray(locs) || !locs.some(has)) return content;
  return { ...content, locations: locs.map((l) => (has(l) ? { ...l, holiday_exceptions: upcomingSpecial(l.holiday_exceptions, todayIn(nowIso, l.timezone)) } : l)) };
}
