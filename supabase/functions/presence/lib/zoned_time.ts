// ── Wall clocks in a time zone (builder list item 149) ───────────────────────
// The one local ↔ UTC bridge booking uses: routes/booking.ts for "now" and a
// booking's stored instants, lib/busy_calendar.ts for the times in an owner's own
// calendar. Intl knows the zone rules, daylight saving included. A name Intl doesn't
// know counts as UTC, as booking always has. A "wall" time is the clock on the wall
// written as Date.UTC milliseconds, so plain arithmetic on it is calendar arithmetic.
// Pure: no clock is read here.

const FMTS = new Map<string, Intl.DateTimeFormat | null>();
function fmt(tz: string): Intl.DateTimeFormat | null {
  if (!FMTS.has(tz)) {
    let f: Intl.DateTimeFormat | null = null;
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
    } catch { f = null; }
    FMTS.set(tz, f);
  }
  return FMTS.get(tz)!;
}

/** A time zone name Intl knows ("America/Los_Angeles", "UTC", "Etc/GMT+8"). */
export function knownTimeZone(tz: string): boolean {
  return !!tz && !!fmt(tz);
}

/** Minutes to ADD to a UTC instant to get the wall clock in `tz` (−420 for PDT);
 *  0 for a zone Intl doesn't know. */
export function tzOffsetMin(tz: string, atMs: number): number {
  const f = fmt(tz);
  if (!f || !Number.isFinite(atMs)) return 0;
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(new Date(atMs))) if (part.type !== 'literal') p[part.type] = Number(part.value);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return Math.round((asUtc - atMs) / 60000);
}

/** A wall clock in `tz` → the instant. One refinement pass settles the hour that
 *  daylight saving moves. */
export function wallToUtc(wallMs: number, tz: string): number {
  const off = tzOffsetMin(tz, wallMs);
  let utc = wallMs - off * 60000;
  const off2 = tzOffsetMin(tz, utc);
  if (off2 !== off) utc = wallMs - off2 * 60000;
  return utc;
}

/** An instant → the wall clock in `tz`. */
export function utcToWall(ms: number, tz: string): number {
  return ms + tzOffsetMin(tz, ms) * 60000;
}

const p2 = (n: number) => String(n).padStart(2, '0');
/** "YYYY-MM-DDTHH:MM" for a wall time (the seconds dropped). */
export function wallString(wallMs: number): string {
  const d = new Date(wallMs);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}
