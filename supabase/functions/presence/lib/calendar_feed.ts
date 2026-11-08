// ── Your calendar in Google Calendar (sales review item 46, Nov 2026) ─────────
// The review's call was "connect, later; My tasks first". The first real step is
// one way and needs no Google approval: a private calendar link (an iCalendar
// feed) the studio subscribes to from Google Calendar ("From URL"), Apple or
// Outlook. It carries the studio's bookings and its dated tasks — the same list
// as Home's My tasks — and nothing else: no emails, phones or notes, because
// anyone holding the link can read it. Two-way (busy times blocking bookings)
// needs Google's calendar permission and is a later step. Pure.

export interface FeedEvent {
  uid: string;
  summary: string;
  description?: string;
  url?: string;
  start?: string;       // ISO instant, for a timed event
  minutes?: number;     // its length
  allDay?: string;      // YYYY-MM-DD, for an all-day event
  tentative?: boolean;
}

/** A link's secret: 40 lowercase hex characters (160 random bits). */
export const FEED_TOKEN_RE = /^[0-9a-f]{40}$/;
export function newFeedToken(): string {
  const b = new Uint8Array(20); crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** RFC 5545 TEXT escaping. */
export function icsEscape(s: unknown): string {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Fold a content line at 75 octets (UTF-8), continuing with CRLF + one space. */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = []; let cur = ''; let n = 0; let limit = 75;
  for (const ch of line) {
    const w = enc.encode(ch).length;
    if (n + w > limit) { out.push(cur); cur = ''; n = 0; limit = 74; }   // continuation lines lose one octet to the leading space
    cur += ch; n += w;
  }
  if (cur) out.push(cur);
  return out.join('\r\n ');
}

const utc = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const ymdNext = (ymd: string) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

/** The whole feed. Events without a usable date are left out. */
export function buildIcs(calName: string, events: FeedEvent[], nowIso: string): string {
  const stamp = utc(Date.parse(nowIso) || Date.now());
  const L: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Studio OS//Calendar link//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(calName)}`, 'X-PUBLISHED-TTL:PT1H', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H'];
  for (const e of events) {
    let when: string[] = [];
    if (e.allDay && /^\d{4}-\d{2}-\d{2}$/.test(e.allDay)) {
      when = [`DTSTART;VALUE=DATE:${e.allDay.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${ymdNext(e.allDay).replace(/-/g, '')}`];
    } else if (e.start && isFinite(Date.parse(e.start))) {
      const s = Date.parse(e.start), mins = Math.max(5, Math.min(24 * 60, Number(e.minutes) || 30));
      when = [`DTSTART:${utc(s)}`, `DTEND:${utc(s + mins * 60000)}`];
    } else continue;
    L.push('BEGIN:VEVENT', `UID:${icsEscape(e.uid)}@studio-os`, `DTSTAMP:${stamp}`, ...when, `SUMMARY:${icsEscape(e.summary)}`);
    if (e.description) L.push(`DESCRIPTION:${icsEscape(e.description)}`);
    if (e.url) L.push(`URL:${e.url.replace(/[\r\n]/g, '')}`);
    L.push(`STATUS:${e.tentative ? 'TENTATIVE' : 'CONFIRMED'}`, 'TRANSP:' + (e.allDay ? 'TRANSPARENT' : 'OPAQUE'), 'END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(foldLine).join('\r\n') + '\r\n';
}

/** A booking as an event: the kind of booking and who, nothing private. */
export function bookingEvent(a: any, appBase: string): FeedEvent | null {
  if (!a || !a.id || !a.slot_start) return null;
  const who = String(a.customer_name || '').trim();
  const kind = String(a.type_name || '').trim() || 'Booking';
  const pending = a.status === 'pending';
  return {
    uid: `booking-${a.id}`,
    summary: `${kind}${who ? ' — ' + who : ''}${pending ? ' (to confirm)' : ''}`,
    description: pending ? 'Booked through your website. Confirm it in Studio OS.' : 'Booked through your website.',
    url: `${appBase}/presence.html#bookings`,
    start: String(a.slot_start), minutes: Number(a.duration_min) || 30, tentative: pending,
  };
}

/** A dated task from My tasks as an all-day event. */
export function taskEvent(t: any, appBase: string): FeedEvent | null {
  if (!t || !t.id || !t.due) return null;
  return {
    uid: `${t.kind}-${t.id}`,
    summary: `${t.title}${t.context ? ' · ' + t.context : ''}`,
    description: t.kind === 'next_step' ? 'Next step on a deal' : t.kind === 'deal_task' ? 'To-do on a deal' : 'Project task',
    url: `${appBase}${t.href || ''}`,
    allDay: String(t.due),
  };
}
