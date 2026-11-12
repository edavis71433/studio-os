// ── A business's second location (builder list item 127, Nov 2026) ──────────
// The first location is the presence_locations row, as always. A second one lives
// beside it, in that row's second_location (migration 0182): a name for the place
// ("Glendale"), its address and phone, and its hours, either the same as the first
// location's or its own week.
//
// The snapshot carries it as locations[1] (the contract's list was always meant to
// grow, render_types.ts), so everything that reads locations[0] (the phone bar, the
// emails, the legal pages, Google's listing) keeps the main location. The templates
// draw it beside the main address in the footer and on the Contact page, and give
// Google both places. Everything here is pure.
import type { HoursDay, LocationContent } from './render_types.ts';

export interface SecondLocation {
  label: string; address_line1: string; address_line2: string; city: string; region: string; postal_code: string;
  phone: string; same_hours: boolean; hours: HoursDay[];
}

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function text(v: unknown, max: number): string {
  let out = '';
  for (const ch of String(v ?? '')) { const c = ch.codePointAt(0)!; if (c >= 32 && c !== 127) out += ch; }
  return out.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** A week of hours as the first location keeps it: seven days, each closed or with up to
 *  three HH:MM ranges. Anything else is dropped; a missing day counts as closed. Pure. */
export function cleanWeek(v: unknown): HoursDay[] {
  const given = new Map<string, any>();
  for (const d of Array.isArray(v) ? v : []) if (d && typeof d === 'object' && DAYS.includes(String((d as any).day))) given.set(String((d as any).day), d);
  return DAYS.map((day) => {
    const d = given.get(day);
    const intervals = (Array.isArray(d?.intervals) ? d.intervals : [])
      .filter((iv: any) => iv && TIME_RE.test(String(iv.open)) && TIME_RE.test(String(iv.close)))
      .slice(0, 3).map((iv: any) => ({ open: String(iv.open), close: String(iv.close) }));
    return { day, closed: !d || d.closed === true || intervals.length === 0, intervals: d && d.closed !== true ? intervals : [] };
  });
}

/** The second location as it may be stored, or null for none: it needs a street and a
 *  town to be a place at all. Pure. */
export function normalizeSecondLocation(v: unknown): SecondLocation | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const loc: SecondLocation = {
    label: text(o.label, 60), address_line1: text(o.address_line1, 160), address_line2: text(o.address_line2, 160),
    city: text(o.city, 80), region: text(o.region, 40), postal_code: text(o.postal_code, 16), phone: text(o.phone, 32),
    same_hours: o.same_hours !== false, hours: [],
  };
  if (!loc.address_line1 || !loc.city) return null;
  if (!loc.same_hours) loc.hours = cleanWeek(o.hours);
  return loc;
}

/** The snapshot's locations[1] for a stored second location, or null. Its time zone and
 *  country are the main location's; with the same hours it carries the main week, so a
 *  page or Google reads both places the same way. Pure. */
export function secondLocationContent(stored: unknown, main: LocationContent | null | undefined): (LocationContent & { label?: string; same_hours?: true }) | null {
  const s = normalizeSecondLocation(stored);
  if (!s || !main) return null;
  return {
    address_line1: s.address_line1, address_line2: s.address_line2, city: s.city, region: s.region, postal_code: s.postal_code,
    country: main.country || 'US', phone: s.phone, timezone: main.timezone,
    hours: s.same_hours ? main.hours : s.hours, holiday_exceptions: [],
    ...(s.label ? { label: s.label } : {}), ...(s.same_hours ? { same_hours: true as const } : {}),
  };
}

/** One line for a location's address: "410 Brand Blvd, Glendale, CA 91203". Pure. */
export function addressLine(l: { address_line1?: string; address_line2?: string; city?: string; region?: string; postal_code?: string } | null | undefined): string {
  if (!l) return '';
  const town = [l.city, [l.region, l.postal_code].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [l.address_line1, l.address_line2, town].filter(Boolean).join(', ');
}
