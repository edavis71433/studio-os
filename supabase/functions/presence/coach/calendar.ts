// ── The business calendar (M9.5E) — PURE date math, no clock, no I/O ────────
// Providers never read time (evidence discipline, kept here too): `now` is
// always passed in. National holidays are computed per year — fixed dates and
// nth-weekday rules — plus seasons and business anniversaries. The calendar
// only says WHEN; the packs and rules decide WHETHER something is worth
// saying. Nothing here publishes or schedules anything.

export interface CalendarEvent {
  key: string;            // stable identity: 'valentines-2027', 'season-spring-2027', 'anniversary-2027'
  kind: 'holiday' | 'season' | 'anniversary';
  name: string;
  date: string;           // YYYY-MM-DD (the day itself; seasons use their first day)
  lead_days: number;      // how far ahead a suggestion is worth surfacing
  days_away: number;      // computed against `now`
}

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
/** nth (1-based) weekday (0=Sun..6=Sat) of a month; nth=-1 → last */
function nthWeekday(y: number, month: number, weekday: number, nth: number): string {
  if (nth > 0) {
    const first = new Date(Date.UTC(y, month - 1, 1)).getUTCDay();
    return iso(y, month, 1 + ((weekday - first + 7) % 7) + (nth - 1) * 7);
  }
  const lastDay = new Date(Date.UTC(y, month, 0));
  return iso(y, month, lastDay.getUTCDate() - ((lastDay.getUTCDay() - weekday + 7) % 7));
}

export interface Holiday { key: string; name: string; date: string; lead_days: number }

/** US national + commercial holidays for one year. Deterministic. */
export function holidaysFor(y: number): Holiday[] {
  const thanksgiving = nthWeekday(y, 11, 4, 4);
  const tgDate = new Date(thanksgiving + 'T00:00:00Z');
  const smallBizSat = new Date(tgDate.getTime() + 2 * 86400000).toISOString().slice(0, 10);
  return [
    { key: `new-years-${y}`, name: 'New Year’s Day', date: iso(y, 1, 1), lead_days: 21 },
    { key: `mlk-${y}`, name: 'Martin Luther King Jr. Day', date: nthWeekday(y, 1, 1, 3), lead_days: 10 },
    { key: `valentines-${y}`, name: 'Valentine’s Day', date: iso(y, 2, 14), lead_days: 28 },
    { key: `mothers-day-${y}`, name: 'Mother’s Day', date: nthWeekday(y, 5, 0, 2), lead_days: 28 },
    { key: `memorial-day-${y}`, name: 'Memorial Day', date: nthWeekday(y, 5, 1, -1), lead_days: 21 },
    { key: `fathers-day-${y}`, name: 'Father’s Day', date: nthWeekday(y, 6, 0, 3), lead_days: 21 },
    { key: `july-4-${y}`, name: 'Independence Day', date: iso(y, 7, 4), lead_days: 21 },
    { key: `labor-day-${y}`, name: 'Labor Day', date: nthWeekday(y, 9, 1, 1), lead_days: 21 },
    { key: `halloween-${y}`, name: 'Halloween', date: iso(y, 10, 31), lead_days: 21 },
    { key: `veterans-day-${y}`, name: 'Veterans Day', date: iso(y, 11, 11), lead_days: 14 },
    { key: `thanksgiving-${y}`, name: 'Thanksgiving', date: thanksgiving, lead_days: 28 },
    { key: `small-biz-saturday-${y}`, name: 'Small Business Saturday', date: smallBizSat, lead_days: 28 },
    { key: `christmas-${y}`, name: 'Christmas', date: iso(y, 12, 25), lead_days: 35 },
    { key: `new-years-eve-${y}`, name: 'New Year’s Eve', date: iso(y, 12, 31), lead_days: 28 },
  ];
}

export const SEASONS: Array<{ key: string; name: string; startMonth: number; startDay: number }> = [
  { key: 'spring', name: 'Spring', startMonth: 3, startDay: 20 },
  { key: 'summer', name: 'Summer', startMonth: 6, startDay: 21 },
  { key: 'fall', name: 'Fall', startMonth: 9, startDay: 22 },
  { key: 'winter', name: 'Winter', startMonth: 12, startDay: 21 },
];
const SEASON_LEAD = 21;

const daysBetween = (fromIso: string, toIso: string) =>
  Math.round((new Date(toIso + 'T00:00:00Z').getTime() - new Date(fromIso.slice(0, 10) + 'T00:00:00Z').getTime()) / 86400000);

/**
 * Everything worth preparing for: events whose window [date - lead_days, date]
 * contains `now`. Suggestions surface BEFORE things become urgent — an event
 * is included from lead_days out until the day itself, never after.
 */
export function upcomingEvents(nowIso: string, firstPublishedAt: string | null): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  const y = Number(nowIso.slice(0, 4));
  const push = (key: string, kind: CalendarEvent['kind'], name: string, date: string, lead: number) => {
    const away = daysBetween(nowIso, date);
    if (away >= 0 && away <= lead) out.push({ key, kind, name, date, lead_days: lead, days_away: away });
  };
  for (const yr of [y, y + 1]) {
    for (const h of holidaysFor(yr)) push(h.key, 'holiday', h.name, h.date, h.lead_days);
    for (const s of SEASONS) push(`season-${s.key}-${yr}`, 'season', s.name, iso(yr, s.startMonth, s.startDay), SEASON_LEAD);
    if (firstPublishedAt) {
      const anniv = iso(yr, Number(firstPublishedAt.slice(5, 7)), Number(firstPublishedAt.slice(8, 10)));
      const years = yr - Number(firstPublishedAt.slice(0, 4));
      if (years >= 1) push(`anniversary-${yr}`, 'anniversary', `${years} year${years > 1 ? 's' : ''} online`, anniv, 21);
    }
  }
  out.sort((a, b) => a.days_away - b.days_away);
  return out;
}

/** 'in three days' / 'about two weeks out' / 'about a month out' — the customer's sentence. */
export function timingPhrase(daysAway: number, name: string): string {
  if (daysAway === 0) return `${name} is today`;
  if (daysAway <= 3) return `${name} is ${daysAway === 1 ? 'tomorrow' : `${daysAway} days away`}`;
  if (daysAway <= 10) return `${name} is about a week out`;
  if (daysAway <= 17) return `${name} is about two weeks out`;
  if (daysAway <= 24) return `${name} is about three weeks out`;
  return `${name} is about a month out`;
}
