// ── The main holidays, a week ahead (builder list item 385, Nov 2026) ──────────
// Wix and Squarespace both remind an owner before a holiday to say whether they're
// open. The client's Do next list says "Thanksgiving is Thursday: are you open?" in
// the seven days before each of the main US holidays, with a link to the website's
// Hours card. The key carries the year, so each holiday is asked about once: Done or
// Not relevant puts that year's away, and it leaves the list by itself once the day
// has gone. The main ones are the six days most local businesses close or keep short
// hours on; the eves, Easter and the rest are left out on purpose. Pure.

export const HOLIDAY_DAYS_AHEAD = 7;
// The studio's clients are local businesses around it, so "today" is the day there,
// not in London: at 5pm on a Wednesday in Burbank, Thanksgiving is tomorrow.
export const HOLIDAY_ZONE = 'America/Los_Angeles';

const DAY_MS = 86_400_000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// the nth (1-based) weekday of a month, and the last one; month 1 to 12, weekday 0 = Sunday
const nthWeekday = (y: number, month: number, weekday: number, n: number) => {
  const first = new Date(Date.UTC(y, month - 1, 1)).getUTCDay();
  return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
};
const lastWeekday = (y: number, month: number, weekday: number) => {
  const days = new Date(Date.UTC(y, month, 0)).getUTCDate();
  const last = new Date(Date.UTC(y, month - 1, days)).getUTCDay();
  return days - ((last - weekday + 7) % 7);
};

const HOLIDAYS: Array<{ key: string; name: string; on: (y: number) => [number, number] }> = [
  { key: 'new-years-day', name: 'New Year’s Day', on: () => [1, 1] },
  { key: 'memorial-day', name: 'Memorial Day', on: (y) => [5, lastWeekday(y, 5, 1)] },
  { key: 'fourth-of-july', name: 'The Fourth of July', on: () => [7, 4] },
  { key: 'labor-day', name: 'Labor Day', on: (y) => [9, nthWeekday(y, 9, 1, 1)] },
  { key: 'thanksgiving', name: 'Thanksgiving', on: (y) => [11, nthWeekday(y, 11, 4, 4)] },
  { key: 'christmas', name: 'Christmas Day', on: () => [12, 25] },
];

// `day` is the weekday's key as the editor's Hours card names its rows (mon to sun): the line's
// link opens that row (builder item 431)
export interface HolidaySoon { key: string; name: string; date: string; days: number; when: string; day: string }

/** Today's date ('YYYY-MM-DD') in a time zone, from an ISO moment. Pure. */
export function localDay(nowIso: string, zone = HOLIDAY_ZONE): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(nowIso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** The main holiday in the next seven days (today counts), or null. `when` is how the
 *  line says it: today, tomorrow, the weekday, or a week from today. Pure. */
export function holidaySoon(today: string): HolidaySoon | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (!m) return null;
  const y = Number(m[1]), at0 = Date.UTC(y, Number(m[2]) - 1, Number(m[3]));
  let best: HolidaySoon | null = null;
  for (const year of [y, y + 1]) {
    for (const h of HOLIDAYS) {
      const [month, day] = h.on(year);
      const at = Date.UTC(year, month - 1, day), days = Math.round((at - at0) / DAY_MS);
      if (days < 0 || days > HOLIDAY_DAYS_AHEAD || (best && best.days <= days)) continue;
      const weekday = WEEKDAYS[new Date(at).getUTCDay()], dkey = weekday.slice(0, 3).toLowerCase();
      best = {
        key: `${h.key}-${year}`, name: h.name, date: new Date(at).toISOString().slice(0, 10), days,
        when: days === 0 ? 'today' : days === 1 ? 'tomorrow' : days === HOLIDAY_DAYS_AHEAD ? 'a week from today' : weekday, day: dkey,
      };
    }
  }
  return best;
}
