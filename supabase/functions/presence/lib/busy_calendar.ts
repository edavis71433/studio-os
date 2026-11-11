// ── Builder list item 149: the owner's own calendar, read for busy times ─────
// An owner who also keeps a Google, Outlook or Apple calendar pastes its private
// address (Google's "secret address in iCal format", Outlook's published ICS link,
// iCloud's calendar link), and the times it shows them busy are kept off their booking
// page, so nobody books them on top of a dentist appointment. Read only, and nothing
// is kept but the times: no titles, places or people. Wix reads Google's calendar with
// Google's calendar permission; a private address needs no approval and works with
// any calendar that has one.
//
// What counts as busy: an event shown as busy (not "free", not canceled, not an
// invitation the owner declined), timed or
// all-day, once or repeating (daily, weekly, monthly or yearly; every N; a count or an
// end date; chosen weekdays, days of the month, months or positions), minus the dates
// taken out of a series, with each occurrence the calendar moved or canceled as it
// moved it. Times are in the event's own zone (an IANA name, a Windows one like
// "Pacific Standard Time", or a fixed offset); an all-day event, or one with no zone,
// is in the business's. The bookings on our own calendar link (lib/calendar_feed.ts)
// are left out: they're counted already. Pure: routes/booking.ts fetches the file.
import { knownTimeZone, wallToUtc, utcToWall, wallString } from './zoned_time.ts';

/** A busy stretch, [start, end) in epoch milliseconds. */
export type BusyRange = [number, number];
/** The most busy times kept, the soonest first: a full diary for a year fits. */
export const BUSY_MAX_RANGES = 4000;
const MAX_SCAN = 5000;          // periods one repeating event is walked through, at most
const DAY = 86_400_000;

// ── the address ──
/** A pasted calendar address → the https address to read, or not a usable one.
 *  webcal:// (what Apple and Outlook hand out) is the same address over https. */
export function calendarUrl(raw: unknown): { ok: true; url: string; host: string } | { ok: false } {
  let s = String(raw ?? '').trim();
  if (!s || s.length > 2000 || /\s/.test(s)) return { ok: false };
  s = s.replace(/^webcals?:\/\//i, 'https://');
  let u: URL;
  try { u = new URL(s); } catch { return { ok: false }; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || !u.hostname.includes('.')) return { ok: false };
  if (u.hostname.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(u.hostname)) return { ok: false };   // a calendar lives at a name, not a bare address
  u.hash = '';
  return { ok: true, url: u.toString(), host: u.hostname.toLowerCase() };
}

// ── the file's lines ──
interface Prop { name: string; params: Record<string, string>; value: string }
const WANT = new Set(['UID', 'DTSTART', 'DTEND', 'DURATION', 'RRULE', 'EXDATE', 'RDATE', 'RECURRENCE-ID', 'STATUS', 'TRANSP', 'X-MICROSOFT-CDO-BUSYSTATUS', 'ATTENDEE']);
/** NAME;PARAM=x;PARAM="y:z":value — a quoted parameter may hold a colon. */
function prop(line: string): Prop | null {
  let q = false, colon = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c === 34) q = !q;
    else if (c === 58 && !q) { colon = i; break; }
  }
  if (colon <= 0) return null;
  const parts: string[] = [];
  let cur = '';
  q = false;
  for (const ch of line.slice(0, colon)) {
    if (ch === '"') q = !q;
    if (ch === ';' && !q) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).trim().toUpperCase()] = p.slice(eq + 1).trim().replace(/^"(.*)"$/, '$1');
  }
  return { name: parts[0].trim().toUpperCase(), params, value: line.slice(colon + 1) };
}

interface Ev { uid: string; start: Prop | null; end: Prop | null; dur: string; rrule: string; ex: Prop[]; rdate: Prop[]; rid: Prop | null; status: string; transp: string; busy: string; declined: string[] }
const blank = (): Ev => ({ uid: '', start: null, end: null, dur: '', rrule: '', ex: [], rdate: [], rid: null, status: '', transp: '', busy: '', declined: [] });
function keep(e: Ev, p: Prop): void {
  const v = p.value.trim();
  switch (p.name) {
    case 'UID': e.uid = v; break;
    case 'DTSTART': e.start = p; break;
    case 'DTEND': e.end = p; break;
    case 'DURATION': e.dur = v; break;
    case 'RRULE': if (!e.rrule) e.rrule = v; break;   // a second rule (long deprecated) is left out
    case 'EXDATE': e.ex.push(p); break;
    case 'RDATE': e.rdate.push(p); break;
    case 'RECURRENCE-ID': e.rid = p; break;
    case 'STATUS': e.status = v.toUpperCase(); break;
    case 'TRANSP': e.transp = v.toUpperCase(); break;
    case 'X-MICROSOFT-CDO-BUSYSTATUS': e.busy = v.toUpperCase(); break;
    // who said no: Google keeps the invitations its owner declined in the feed
    case 'ATTENDEE': if (String(p.params.PARTSTAT || '').toUpperCase() === 'DECLINED') e.declined.push(v.replace(/^mailto:/i, '').toLowerCase()); break;
  }
}

/** The events, each VTIMEZONE's offsets (for a zone known only by its own name), and the
 *  calendar's name (a Google calendar's is its owner's address). */
function parse(ics: string): { events: Ev[]; offsets: Map<string, number[]>; name: string } {
  const lines = ics.replace(/\r\n[ \t]|\n[ \t]|\r[ \t]/g, '').split(/\r\n|\n|\r/);
  const events: Ev[] = [];
  const offsets = new Map<string, number[]>();
  const stack: string[] = [];
  let ev: Ev | null = null, tzid = '', calName = '';
  for (const line of lines) {
    if (!line) continue;
    const head = line.slice(0, 6).toUpperCase();
    if (head === 'BEGIN:') {
      const what = line.slice(6).trim().toUpperCase();
      stack.push(what);
      if (what === 'VEVENT') ev = blank();
      else if (what === 'VTIMEZONE') tzid = '';
      continue;
    }
    if (head.startsWith('END:')) {
      if (stack.pop() === 'VEVENT' && ev) { events.push(ev); ev = null; }
      continue;
    }
    const top = stack[stack.length - 1];
    const cut = line.search(/[;:]/);
    const name = (cut < 0 ? line : line.slice(0, cut)).toUpperCase();
    if (top === 'VEVENT' && ev) {
      if (WANT.has(name)) { const p = prop(line); if (p) keep(ev, p); }
    } else if (top === 'VCALENDAR' && name === 'X-WR-CALNAME') {
      calName = (prop(line)?.value || '').trim().toLowerCase();
    } else if (top === 'VTIMEZONE' && name === 'TZID') {
      tzid = (prop(line)?.value || '').trim();
    } else if ((top === 'STANDARD' || top === 'DAYLIGHT') && name === 'TZOFFSETTO' && tzid) {
      const m = /^([+-])(\d{2})(\d{2})/.exec((prop(line)?.value || '').trim());
      if (m) {
        const mins = (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
        const list = offsets.get(tzid) || [];
        if (!list.includes(mins)) list.push(mins);
        offsets.set(tzid, list);
      }
    }
  }
  return { events, offsets, name: calName };
}

// ── time zones ──
// Outlook names zones the Windows way; older exports write "(UTC-08:00) Pacific Time".
const WINDOWS: Record<string, string> = {
  'pacific standard time': 'America/Los_Angeles', 'mountain standard time': 'America/Denver', 'us mountain standard time': 'America/Phoenix',
  'central standard time': 'America/Chicago', 'eastern standard time': 'America/New_York', 'us eastern standard time': 'America/Indianapolis',
  'alaskan standard time': 'America/Anchorage', 'hawaiian standard time': 'Pacific/Honolulu', 'atlantic standard time': 'America/Halifax',
  'newfoundland standard time': 'America/St_Johns', 'canada central standard time': 'America/Regina',
  'central standard time (mexico)': 'America/Mexico_City', 'mountain standard time (mexico)': 'America/Mazatlan', 'pacific standard time (mexico)': 'America/Tijuana',
  'gmt standard time': 'Europe/London', 'greenwich standard time': 'Atlantic/Reykjavik', 'utc': 'UTC', 'coordinated universal time': 'UTC',
  'w. europe standard time': 'Europe/Berlin', 'romance standard time': 'Europe/Paris', 'central europe standard time': 'Europe/Budapest',
  'central european standard time': 'Europe/Warsaw', 'e. europe standard time': 'Europe/Chisinau', 'gtb standard time': 'Europe/Bucharest', 'fle standard time': 'Europe/Helsinki',
  'aus eastern standard time': 'Australia/Sydney', 'e. australia standard time': 'Australia/Brisbane', 'w. australia standard time': 'Australia/Perth', 'cen. australia standard time': 'Australia/Adelaide',
  'new zealand standard time': 'Pacific/Auckland', 'india standard time': 'Asia/Kolkata', 'china standard time': 'Asia/Shanghai', 'tokyo standard time': 'Asia/Tokyo',
  'singapore standard time': 'Asia/Singapore', 'arabian standard time': 'Asia/Dubai', 'sa pacific standard time': 'America/Bogota', 'e. south america standard time': 'America/Sao_Paulo',
};
const NAMED: Array<[RegExp, string]> = [
  [/pacific time/i, 'America/Los_Angeles'], [/arizona/i, 'America/Phoenix'], [/mountain time/i, 'America/Denver'], [/central time/i, 'America/Chicago'],
  [/eastern time/i, 'America/New_York'], [/alaska/i, 'America/Anchorage'], [/hawaii/i, 'Pacific/Honolulu'],
  [/london|dublin|edinburgh|lisbon/i, 'Europe/London'], [/brussels|copenhagen|madrid|paris/i, 'Europe/Paris'],
  [/amsterdam|berlin|bern|rome|stockholm|vienna/i, 'Europe/Berlin'], [/sydney|melbourne|canberra/i, 'Australia/Sydney'],
];
function zoneOf(tzid: string, offsets: Map<string, number[]>, home: string): string {
  const t = tzid.trim();
  if (knownTimeZone(t)) return t;
  const w = WINDOWS[t.toLowerCase()];
  if (w) return w;
  const tail = /([A-Za-z]+\/[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)?)$/.exec(t);
  if (tail && knownTimeZone(tail[1])) return tail[1];
  for (const [rx, z] of NAMED) if (rx.test(t)) return z;
  // a zone of the file's own making with one fixed offset of whole hours (Etc/GMT+8 is UTC−8)
  const offs = offsets.get(t);
  if (offs && offs.length === 1 && offs[0] % 60 === 0 && Math.abs(offs[0]) <= 14 * 60) {
    const h = -offs[0] / 60;
    return h === 0 ? 'UTC' : `Etc/GMT${h > 0 ? '+' : ''}${h}`;
  }
  return home;
}

// ── a moment in the file ──
interface When { wall: number; tz: string; date: boolean }
const STAMP = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/;
function when(value: string, params: Record<string, string>, zone: (tzid: string) => string, home: string): When | null {
  const m = STAMP.exec(value.trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (!m[4] || params.VALUE === 'DATE') return { wall: Date.UTC(y, mo - 1, d), tz: home, date: true };
  const h = Number(m[4]), mi = Number(m[5]), s = Number(m[6] || 0);
  if (h > 24 || mi > 59 || s > 60) return null;
  return { wall: Date.UTC(y, mo - 1, d, h, mi, Math.min(s, 59)), tz: m[7] ? 'UTC' : params.TZID ? zone(params.TZID) : home, date: false };
}
const at = (w: When) => wallToUtc(w.wall, w.tz);

function durationMs(v: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m || m[0] === 'P' || m[0] === 'PT') return null;
  const ms = Number(m[2] || 0) * 7 * DAY + Number(m[3] || 0) * DAY + Number(m[4] || 0) * 3600_000 + Number(m[5] || 0) * 60_000 + Number(m[6] || 0) * 1000;
  return m[1] === '-' ? -ms : ms;
}

// ── repeating events ──
const WD: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
interface Rule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'; interval: number; count: number; untilWall: number;
  byday: Array<{ n: number; wd: number }>; bymonthday: number[]; bymonth: number[]; bysetpos: number[]; wkst: number;
}
function rule(v: string, start: When): Rule | null {
  const r: Record<string, string> = {};
  for (const part of v.split(';')) { const eq = part.indexOf('='); if (eq > 0) r[part.slice(0, eq).trim().toUpperCase()] = part.slice(eq + 1).trim(); }
  const freq = String(r.FREQ || '').toUpperCase();
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') return null;   // hourly and finer: kept as the one event
  const ints = (s: string | undefined, max: number) => (s ? s.split(',').map((x) => parseInt(x, 10)).filter((n) => Number.isFinite(n) && n !== 0 && Math.abs(n) <= max) : []);
  // the end, as a wall time in the event's own zone (a floating end is already one)
  let untilWall = Infinity;
  const u = r.UNTIL ? STAMP.exec(r.UNTIL) : null;
  if (u) {
    const day = Date.UTC(Number(u[1]), Number(u[2]) - 1, Number(u[3]));
    untilWall = !u[4] ? day + DAY - 1 : u[7] ? utcToWall(Date.UTC(Number(u[1]), Number(u[2]) - 1, Number(u[3]), Number(u[4]), Number(u[5]), Number(u[6] || 0)), start.tz) : day + (Number(u[4]) * 3600 + Number(u[5]) * 60 + Number(u[6] || 0)) * 1000;
  }
  const byday = (r.BYDAY ? r.BYDAY.split(',') : []).map((x) => /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(x.trim())).filter(Boolean)
    .map((m) => ({ n: m![1] ? Number(m![1]) : 0, wd: WD[m![2].toUpperCase()] }));
  return {
    freq, interval: Math.max(1, parseInt(r.INTERVAL || '1', 10) || 1), count: Math.max(0, parseInt(r.COUNT || '0', 10) || 0), untilWall,
    byday, bymonthday: ints(r.BYMONTHDAY, 31), bymonth: ints(r.BYMONTH, 12).filter((n) => n > 0), bysetpos: ints(r.BYSETPOS, 366),
    wkst: WD[String(r.WKST || 'MO').toUpperCase()] ?? 1,
  };
}
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
function setpos(xs: number[], pos: number[]): number[] {
  if (!pos.length) return xs;
  return [...new Set(pos.map((p) => (p > 0 ? xs[p - 1] : xs[xs.length + p])).filter((x) => x !== undefined))].sort((a, b) => a - b);
}
/** The days of one month a monthly (or yearly) rule lands on. */
function monthDays(y: number, m: number, r: Rule, dflt: number): number[] {
  const last = daysIn(y, m);
  let days: number[];
  if (r.bymonthday.length) {
    days = r.bymonthday.map((n) => (n > 0 ? n : last + 1 + n)).filter((d) => d >= 1 && d <= last);
    if (r.byday.length) days = days.filter((d) => r.byday.some((b) => b.wd === new Date(Date.UTC(y, m, d)).getUTCDay()));
  } else if (r.byday.length) {
    days = [];
    const first = new Date(Date.UTC(y, m, 1)).getUTCDay();
    for (const b of r.byday) {
      const all: number[] = [];
      for (let d = 1 + ((b.wd - first + 7) % 7); d <= last; d += 7) all.push(d);
      if (b.n > 0) { if (all[b.n - 1]) days.push(all[b.n - 1]); } else if (b.n < 0) { if (all[all.length + b.n]) days.push(all[all.length + b.n]); } else days.push(...all);
    }
  } else days = dflt <= last ? [dflt] : [];
  return setpos([...new Set(days)].sort((a, b) => a - b), r.bysetpos);
}
/** Each occurrence's wall start from the first on (a count counts from there), up to `limitWall`. */
function occurrences(startWall: number, r: Rule, fromWall: number, limitWall: number): number[] {
  const out: number[] = [];
  const d0 = Math.floor(startWall / DAY) * DAY, tod = startWall - d0;
  const s = new Date(startWall), Y = s.getUTCFullYear(), M = s.getUTCMonth(), D = s.getUTCDate(), W = s.getUTCDay();
  const wk0 = d0 - ((W - r.wkst + 7) % 7) * DAY;
  // without a count, start near the window: a daily event since 2015 needn't be walked
  let p = 0;
  if (!r.count && fromWall > startWall) {
    const f = new Date(fromWall);
    p = r.freq === 'DAILY' ? Math.floor((fromWall - d0) / (r.interval * DAY))
      : r.freq === 'WEEKLY' ? Math.floor((fromWall - wk0) / (r.interval * 7 * DAY))
      : r.freq === 'MONTHLY' ? Math.floor(((f.getUTCFullYear() - Y) * 12 + f.getUTCMonth() - M) / r.interval)
      : Math.floor((f.getUTCFullYear() - Y) / r.interval);
    p = Math.max(0, p - 1);
  }
  let seen = 0;
  for (let scanned = 0; scanned < MAX_SCAN; scanned++, p++) {
    let days: number[];
    if (r.freq === 'DAILY') days = [d0 + p * r.interval * DAY];
    else if (r.freq === 'WEEKLY') {
      const wk = wk0 + p * r.interval * 7 * DAY;
      days = [...new Set(r.byday.length ? r.byday.map((b) => b.wd) : [W])].map((wd) => wk + ((wd - r.wkst + 7) % 7) * DAY).sort((a, b) => a - b);
    } else if (r.freq === 'MONTHLY') {
      const mi = M + p * r.interval, y = Y + Math.floor(mi / 12), m = ((mi % 12) + 12) % 12;
      days = monthDays(y, m, r, D).map((d) => Date.UTC(y, m, d));
    } else {
      const y = Y + p * r.interval;
      days = (r.bymonth.length ? [...r.bymonth].sort((a, b) => a - b).map((x) => x - 1) : [M]).flatMap((m) => monthDays(y, m, r, D).map((d) => Date.UTC(y, m, d)));
    }
    if (r.freq !== 'YEARLY' && r.bymonth.length) days = days.filter((c) => r.bymonth.includes(new Date(c).getUTCMonth() + 1));
    if (r.freq === 'DAILY' && r.byday.length) days = days.filter((c) => r.byday.some((b) => b.wd === new Date(c).getUTCDay()));
    if (r.freq === 'DAILY' && r.bymonthday.length) days = days.filter((c) => { const x = new Date(c), last = daysIn(x.getUTCFullYear(), x.getUTCMonth()); return r.bymonthday.some((n) => (n > 0 ? n : last + 1 + n) === x.getUTCDate()); });
    if ((r.freq === 'DAILY' || r.freq === 'WEEKLY') && r.bysetpos.length) days = setpos(days, r.bysetpos);
    let stop = false;
    for (const c of days) {
      const w = c + tod;
      if (w < startWall) continue;
      seen++;
      if ((r.count && seen > r.count) || w > limitWall || w > r.untilWall) { stop = true; break; }
      if (w >= fromWall) out.push(w);   // the ones before the window still count towards a count
    }
    if (stop) break;
  }
  return out;
}

function merge(rs: BusyRange[]): BusyRange[] {
  rs.sort((a, b) => a[0] - b[0]);
  const out: BusyRange[] = [];
  for (const r of rs) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) { if (r[1] > last[1]) last[1] = r[1]; } else out.push([r[0], r[1]]);
  }
  return out;
}

/** The busy times in a calendar file between two instants, merged and in order.
 *  `tz` is the business's zone: the one all-day and zone-less times are in. */
export function readBusyTimes(ics: string, o: { fromMs: number; toMs: number; tz: string }): { ranges: BusyRange[]; events: number } {
  const home = knownTimeZone(o.tz) ? o.tz : 'UTC';
  const { events, offsets, name } = parse(String(ics || ''));
  const owner = /^[^\s@]+@[^\s@]+$/.test(name) ? name : '';   // only an address can say no
  const zones = new Map<string, string>();
  const zone = (tzid: string) => { let z = zones.get(tzid); if (!z) { z = zoneOf(tzid, offsets, home); zones.set(tzid, z); } return z; };
  // the occurrences a calendar moved or canceled: each one's original start, by series
  const moved = new Map<string, Set<number>>();
  for (const e of events) {
    if (!e.rid || !e.uid) continue;
    const w = when(e.rid.value, e.rid.params, zone, home);
    if (!w) continue;
    let set = moved.get(e.uid);
    if (!set) moved.set(e.uid, (set = new Set()));
    set.add(at(w));
  }
  const raw: BusyRange[] = [];
  let counted = 0;
  for (const e of events) {
    if (raw.length > BUSY_MAX_RANGES * 4) break;
    if (!e.start || e.status === 'CANCELLED' || e.transp === 'TRANSPARENT' || e.busy === 'FREE' || /^booking-[0-9a-f-]{36}@studio-os$/i.test(e.uid)) continue;
    if (owner && e.declined.includes(owner)) continue;   // an invitation the owner said no to
    const s = when(e.start.value, e.start.params, zone, home);
    if (!s) continue;
    const en = e.end ? when(e.end.value, e.end.params, zone, home) : null;
    const dur = e.dur ? durationMs(e.dur) : null;
    // how long each occurrence lasts: whole days for an all-day event, else its length
    let days = 0, span = 0;
    if (s.date) {
      days = en && en.date ? Math.round((en.wall - s.wall) / DAY) : dur ? Math.ceil(dur / DAY) : 1;
      days = Math.min(366, Math.max(1, days));
      span = days * DAY;
    } else {
      span = en ? at(en) - at(s) : dur ?? 0;
      if (!(span > 0)) continue;           // a moment, not a stretch of time: nothing to keep off
      span = Math.min(span, 31 * DAY);
    }
    const tz = s.tz;                         // an all-day event's is the business's
    const r = e.rrule && !e.rid ? rule(e.rrule, s) : null;
    const starts = r ? occurrences(s.wall, r, utcToWall(o.fromMs, tz) - span - DAY, utcToWall(o.toMs, tz) + DAY) : [];
    if (!starts.includes(s.wall)) starts.unshift(s.wall);   // the first one always counts
    if (!e.rid) for (const rd of e.rdate) for (const v of rd.value.split(',')) {
      if (rd.params.VALUE === 'PERIOD' || v.includes('/')) continue;
      const w = when(v, rd.params, zone, home);
      if (w) starts.push(w.date || s.date ? w.wall : utcToWall(at(w), tz));
    }
    const exAt = new Set<number>(), exDay = new Set<number>();
    for (const x of e.ex) for (const v of x.value.split(',')) {
      const w = when(v, x.params, zone, home);
      if (w && w.date) exDay.add(w.wall); else if (w) exAt.add(at(w));
    }
    const gone = e.rid ? null : moved.get(e.uid);
    for (const w of starts) {
      const st = wallToUtc(w, tz);
      if (exAt.has(st) || exDay.has(Math.floor(w / DAY) * DAY) || (gone && gone.has(st))) continue;
      const end = s.date ? wallToUtc(w + days * DAY, tz) : st + span;
      if (end <= o.fromMs || st >= o.toMs) continue;
      raw.push([Math.max(st, o.fromMs), Math.min(end, o.toMs)]);
    }
    counted++;
  }
  return { ranges: merge(raw).slice(0, BUSY_MAX_RANGES), events: counted };
}

/** The busy times touching one business day, as the "YYYY-MM-DDTHH:MM" ranges the
 *  slot engine avoids (lib/booking.ts generateSlots), on the business's clock. A day
 *  either side comes along, for the gap an owner keeps around appointments. */
export function busyOnDate(ranges: BusyRange[], date: string, tz: string): Array<{ start: string; end: string }> {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date));
  if (!m || !Array.isArray(ranges) || !ranges.length) return [];
  const day = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const lo = wallToUtc(day - DAY, tz), hi = wallToUtc(day + 2 * DAY, tz);
  const out: Array<{ start: string; end: string }> = [];
  for (const r of ranges) {
    if (!Array.isArray(r) || !(r[1] > lo) || !(r[0] < hi)) continue;
    const a = Math.max(r[0], lo), z = Math.min(r[1], hi);
    out.push({ start: wallString(utcToWall(a, tz)), end: wallString(Math.ceil(utcToWall(z, tz) / 60000) * 60000) });
  }
  return out;
}
