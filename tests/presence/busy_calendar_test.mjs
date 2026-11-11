// ── Builder list item 149: the owner's own calendar, read for busy times ─────
//   deno run --allow-read --allow-env tests/presence/busy_calendar_test.mjs
// lib/busy_calendar.ts against calendar files written the ways Google, Outlook and Apple
// write them: zones (IANA, Windows, a file's own), repeating events with their counts, ends,
// weekdays and positions, taken-out dates, moved and canceled occurrences, all-day busy
// days, what counts as free, folded lines; then busyOnDate feeding the slot engine, and the
// address check. lib/zoned_time.ts (the local ↔ UTC bridge booking now shares) first.
const L = '../../supabase/functions/presence/lib';
const { tzOffsetMin, wallToUtc, utcToWall, wallString, knownTimeZone } = await import(`${L}/zoned_time.ts`);
const { readBusyTimes, busyOnDate, calendarUrl, BUSY_MAX_RANGES } = await import(`${L}/busy_calendar.ts`);
const { generateSlots, normalizeBookingConfig } = await import(`${L}/booking.ts`);

const results = [];
const ok = (n, p, note = '') => { results.push(!!p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const LA = 'America/Los_Angeles';
const Z = (s) => Date.parse(s);
const cal = (...events) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//EN', ...events.flat(), 'END:VCALENDAR'].join('\r\n') + '\r\n';
const ev = (...lines) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'];
// the window a 60-day booking page asks for, from a Tuesday morning in November
const WIN = { fromMs: Z('2026-11-09T00:00:00Z'), toMs: Z('2027-01-15T00:00:00Z'), tz: LA };
const read = (ics, o = WIN) => readBusyTimes(ics, o).ranges;
const iso = (r) => r.map(([a, b]) => `${new Date(a).toISOString().slice(0, 16)}/${new Date(b).toISOString().slice(11, 16)}`);

// ═══ 1 · the time zone bridge ═══
ok('zones: Los Angeles is UTC−8 in November and UTC−7 in July', tzOffsetMin(LA, Z('2026-11-10T12:00:00Z')) === -480 && tzOffsetMin(LA, Z('2026-07-10T12:00:00Z')) === -420);
ok('zones: 9:00 on a November morning in Los Angeles is 17:00 UTC, and back', wallToUtc(Date.UTC(2026, 10, 10, 9), LA) === Z('2026-11-10T17:00:00Z') && wallString(utcToWall(Z('2026-11-10T17:00:00Z'), LA)) === '2026-11-10T09:00');
ok('zones: the hour daylight saving skips still lands on a real instant', Number.isFinite(wallToUtc(Date.UTC(2026, 2, 8, 2, 30), LA)) && wallString(utcToWall(wallToUtc(Date.UTC(2026, 2, 8, 3, 30), LA), LA)) === '2026-03-08T03:30');
ok('zones: a name Intl doesn’t know counts as UTC, as booking always did', tzOffsetMin('Nowhere/Special', Z('2026-11-10T12:00:00Z')) === 0 && !knownTimeZone('Nowhere/Special') && knownTimeZone('Etc/GMT+5'));

// ═══ 2 · one event ═══
ok('a timed event in its own zone becomes its instants', JSON.stringify(iso(read(cal(ev('UID:a', 'DTSTART;TZID=America/Los_Angeles:20261117T140000', 'DTEND;TZID=America/Los_Angeles:20261117T150000'))))) === JSON.stringify(['2026-11-17T22:00/23:00']));
ok('a UTC event, and one with no zone (in the business’s)', JSON.stringify(iso(read(cal(ev('UID:b', 'DTSTART:20261118T170000Z', 'DTEND:20261118T173000Z'), ev('UID:c', 'DTSTART:20261119T090000', 'DTEND:20261119T100000'))))) === JSON.stringify(['2026-11-18T17:00/17:30', '2026-11-19T17:00/18:00']));
ok('a length given as a duration', JSON.stringify(iso(read(cal(ev('UID:d', 'DTSTART:20261120T180000Z', 'DURATION:PT1H30M'))))) === JSON.stringify(['2026-11-20T18:00/19:30']));
ok('free, canceled, and Outlook’s "free" are not busy', read(cal(
  ev('UID:e1', 'DTSTART:20261120T180000Z', 'DTEND:20261120T190000Z', 'TRANSP:TRANSPARENT'),
  ev('UID:e2', 'DTSTART:20261120T180000Z', 'DTEND:20261120T190000Z', 'STATUS:CANCELLED'),
  ev('UID:e3', 'DTSTART:20261120T180000Z', 'DTEND:20261120T190000Z', 'X-MICROSOFT-CDO-BUSYSTATUS:FREE'))).length === 0);
ok('a moment (no length) keeps nothing off', read(cal(ev('UID:f', 'DTSTART:20261120T180000Z'))).length === 0);
{
  const r = read(cal(ev('UID:g', 'DTSTART;VALUE=DATE:20261126', 'DTEND;VALUE=DATE:20261128', 'TRANSP:OPAQUE'), ev('UID:h', 'DTSTART;VALUE=DATE:20261201', 'DTEND;VALUE=DATE:20261202', 'TRANSP:TRANSPARENT')));
  ok('an all-day event marked busy covers its whole days, on the business’s clock; a "free" one (Google’s default) doesn’t', JSON.stringify(iso(r)) === JSON.stringify(['2026-11-26T08:00/08:00']) && r[0][1] - r[0][0] === 2 * 86400_000);
}
ok('outside the window: left out; overlapping events: one stretch', JSON.stringify(iso(read(cal(
  ev('UID:i1', 'DTSTART:20250101T180000Z', 'DTEND:20250101T190000Z'),
  ev('UID:i2', 'DTSTART:20261123T180000Z', 'DTEND:20261123T190000Z'),
  ev('UID:i3', 'DTSTART:20261123T183000Z', 'DTEND:20261123T200000Z'))))) === JSON.stringify(['2026-11-23T18:00/20:00']));
ok('our own calendar link’s bookings are left out (counted already); a customer’s copy of a booking elsewhere is not', JSON.stringify(iso(read(cal(
  ev('UID:booking-5e000000-0000-4000-8000-0000000000aa@studio-os', 'DTSTART:20261124T180000Z', 'DTEND:20261124T190000Z'),
  ev('UID:appt-5e000000-0000-4000-8000-0000000000bb@studio-os', 'DTSTART:20261125T180000Z', 'DTEND:20261125T190000Z'))))) === JSON.stringify(['2026-11-25T18:00/19:00']));
ok('folded lines and a quoted zone with a colon in it read the same', JSON.stringify(iso(read(cal(ev('UID:j', 'DTSTART;TZID="America/Los_Angeles":2026', ' 1117T140000', 'DTEND;X-NOTE="a:b";TZID=America/Los_Angeles:20261117T150000', 'DESCRIPTION:Dentist: Dr. Smith; bring', '  the forms'))))) === JSON.stringify(['2026-11-17T22:00/23:00']));
{
  const google = (...e) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:owner@gmail.com', ...e.flat(), 'END:VCALENDAR'].join('\r\n');
  const r = readBusyTimes(google(
    ev('UID:inv1', 'DTSTART:20261117T180000Z', 'DTEND:20261117T190000Z', 'ATTENDEE;CN=Owner;PARTSTAT=DECLINED:mailto:Owner@Gmail.com', 'ATTENDEE;PARTSTAT=ACCEPTED:mailto:pat@example.com'),
    ev('UID:inv2', 'DTSTART:20261118T180000Z', 'DTEND:20261118T190000Z', 'ATTENDEE;PARTSTAT=ACCEPTED:mailto:owner@gmail.com', 'ATTENDEE;PARTSTAT=DECLINED:mailto:pat@example.com')), WIN).ranges;
  ok('an invitation the owner declined isn’t busy; one only somebody else declined still is', JSON.stringify(iso(r)) === JSON.stringify(['2026-11-18T18:00/19:00']));
  ok('…and with no address for a name, a declined line can’t be the owner’s', read(cal(ev('UID:inv3', 'DTSTART:20261117T180000Z', 'DTEND:20261117T190000Z', 'ATTENDEE;PARTSTAT=DECLINED:mailto:owner@gmail.com'))).length === 1);
}
ok('nothing kept but the times', !JSON.stringify(readBusyTimes(cal(ev('UID:k', 'SUMMARY:Dentist', 'LOCATION:12 Main St', 'DTSTART:20261117T180000Z', 'DTEND:20261117T190000Z')), WIN)).match(/Dentist|Main/));

// ═══ 3 · repeating events ═══
{
  const weekly = (extra = [], more = []) => cal(ev('UID:w', 'DTSTART;TZID=America/Los_Angeles:20261109T090000', 'DTEND;TZID=America/Los_Angeles:20261109T100000', ...extra), ...more);
  const r = read(weekly(['RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4']));
  ok('weekly on Mondays and Wednesdays, four times', JSON.stringify(iso(r)) === JSON.stringify(['2026-11-09T17:00/18:00', '2026-11-11T17:00/18:00', '2026-11-16T17:00/18:00', '2026-11-18T17:00/18:00']));
  ok('…until a date', iso(read(weekly(['RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261124T075959Z']))).length === 3);
  ok('…with a date taken out', JSON.stringify(iso(read(weekly(['RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=3', 'EXDATE;TZID=America/Los_Angeles:20261116T090000'])))) === JSON.stringify(['2026-11-09T17:00/18:00', '2026-11-23T17:00/18:00']));
  const movedOne = weekly(['RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=3'], [ev('UID:w', 'RECURRENCE-ID;TZID=America/Los_Angeles:20261116T090000', 'DTSTART;TZID=America/Los_Angeles:20261117T130000', 'DTEND;TZID=America/Los_Angeles:20261117T140000')]);
  ok('…with one occurrence moved: the old time is free, the new one busy', JSON.stringify(iso(read(movedOne))) === JSON.stringify(['2026-11-09T17:00/18:00', '2026-11-17T21:00/22:00', '2026-11-23T17:00/18:00']));
  const canceledOne = weekly(['RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=3'], [ev('UID:w', 'RECURRENCE-ID;TZID=America/Los_Angeles:20261116T090000', 'DTSTART;TZID=America/Los_Angeles:20261116T090000', 'DTEND;TZID=America/Los_Angeles:20261116T100000', 'STATUS:CANCELLED')]);
  ok('…with one occurrence canceled', iso(read(canceledOne)).length === 2 && !iso(read(canceledOne)).includes('2026-11-16T17:00/18:00'));
  ok('…every other week', JSON.stringify(iso(read(weekly(['RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;COUNT=3'])))) === JSON.stringify(['2026-11-09T17:00/18:00', '2026-11-23T17:00/18:00', '2026-12-07T17:00/18:00']));
}
{
  // started before daylight saving ended: it stays at 9:00 on the wall clock
  const r = read(cal(ev('UID:dst', 'DTSTART;TZID=America/Los_Angeles:20261026T090000', 'DTEND;TZID=America/Los_Angeles:20261026T093000', 'RRULE:FREQ=WEEKLY;COUNT=3')), { ...WIN, fromMs: Z('2026-10-20T00:00:00Z') });
  ok('a weekly 9:00 keeps 9:00 across the change of the clocks', JSON.stringify(iso(r)) === JSON.stringify(['2026-10-26T16:00/16:30', '2026-11-02T17:00/17:30', '2026-11-09T17:00/17:30']));
}
ok('monthly on the second Tuesday', JSON.stringify(iso(read(cal(ev('UID:m1', 'DTSTART:20261110T180000Z', 'DTEND:20261110T190000Z', 'RRULE:FREQ=MONTHLY;BYDAY=2TU;COUNT=3'))))) === JSON.stringify(['2026-11-10T18:00/19:00', '2026-12-08T18:00/19:00', '2027-01-12T18:00/19:00']));
ok('monthly on the last day', JSON.stringify(iso(read(cal(ev('UID:m2', 'DTSTART:20261130T180000Z', 'DTEND:20261130T190000Z', 'RRULE:FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=2'))))) === JSON.stringify(['2026-11-30T18:00/19:00', '2026-12-31T18:00/19:00']));
ok('monthly on the last weekday (BYSETPOS)', JSON.stringify(iso(read(cal(ev('UID:m3', 'DTSTART:20261130T180000Z', 'DTEND:20261130T190000Z', 'RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=2'))))) === JSON.stringify(['2026-11-30T18:00/19:00', '2026-12-31T18:00/19:00']));
ok('monthly on the 31st skips the short months', JSON.stringify(iso(read(cal(ev('UID:m4', 'DTSTART:20261031T180000Z', 'DTEND:20261031T190000Z', 'RRULE:FREQ=MONTHLY;COUNT=3')), { ...WIN, toMs: Z('2027-02-01T00:00:00Z') }))) === JSON.stringify(['2026-12-31T18:00/19:00', '2027-01-31T18:00/19:00']));
ok('yearly on a date', JSON.stringify(iso(read(cal(ev('UID:y', 'DTSTART:20231120T180000Z', 'DTEND:20231120T190000Z', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=20'))))) === JSON.stringify(['2026-11-20T18:00/19:00']));
{
  // 4,000 days from New Year 2016 ends on December 13 2026: the past ones count, the window keeps the rest
  const t0 = performance.now();
  const r = read(cal(ev('UID:count', 'DTSTART:20160101T120000Z', 'DTEND:20160101T123000Z', 'RRULE:FREQ=DAILY;COUNT=4000')));
  ok('a long counted series is counted from its start and ends where it should', r.length === 35 && iso(r)[0] === '2026-11-09T12:00/12:30' && iso(r).at(-1) === '2026-12-13T12:00/12:30' && performance.now() - t0 < 1000, `${r.length}, last ${iso(r).at(-1)}`);
}
{
  const t0 = performance.now();
  const r = read(cal(ev('UID:daily', 'DTSTART;TZID=America/Los_Angeles:20150105T120000', 'DTEND;TZID=America/Los_Angeles:20150105T123000', 'RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR')));
  ok('a weekday lunch since 2015 lands in the window, without walking eleven years', r.length > 40 && iso(r)[0] === '2026-11-09T20:00/20:30' && performance.now() - t0 < 1000, `${r.length} in ${Math.round(performance.now() - t0)} ms`);
}

// ═══ 4 · zones the way Outlook and older files write them ═══
const VTZ = (id, ...offs) => ['BEGIN:VTIMEZONE', `TZID:${id}`, ...offs.flatMap((o, i) => [`BEGIN:${i ? 'DAYLIGHT' : 'STANDARD'}`, 'DTSTART:16010101T000000', `TZOFFSETFROM:${o}`, `TZOFFSETTO:${o}`, `END:${i ? 'DAYLIGHT' : 'STANDARD'}`]), 'END:VTIMEZONE'];
ok('Outlook’s "Pacific Standard Time"', JSON.stringify(iso(read(cal(VTZ('Pacific Standard Time', '-0800', '-0700'), ev('UID:o1', 'DTSTART;TZID=Pacific Standard Time:20261117T140000', 'DTEND;TZID=Pacific Standard Time:20261117T150000'))))) === JSON.stringify(['2026-11-17T22:00/23:00']));
ok('an older export’s "(UTC-05:00) Eastern Time (US & Canada)"', JSON.stringify(iso(read(cal(ev('UID:o2', 'DTSTART;TZID="(UTC-05:00) Eastern Time (US & Canada)":20261117T140000', 'DTEND;TZID="(UTC-05:00) Eastern Time (US & Canada)":20261117T150000'))))) === JSON.stringify(['2026-11-17T19:00/20:00']));
ok('a file’s own zone with one fixed offset', JSON.stringify(iso(read(cal(VTZ('Custom 1', '-0500'), ev('UID:o3', 'DTSTART;TZID=Custom 1:20261117T140000', 'DTEND;TZID=Custom 1:20261117T150000'))))) === JSON.stringify(['2026-11-17T19:00/20:00']));
ok('a zone it can’t place is taken as the business’s', JSON.stringify(iso(read(cal(ev('UID:o4', 'DTSTART;TZID=Somewhere Odd:20261117T140000', 'DTEND;TZID=Somewhere Odd:20261117T150000'))))) === JSON.stringify(['2026-11-17T22:00/23:00']));

// ═══ 5 · limits and junk ═══
{
  const many = [];
  for (let i = 0; i < 5000; i++) { const s = Z('2026-11-10T00:00:00Z') + i * 90 * 60_000; many.push(ev(`UID:n${i}`, `DTSTART:${new Date(s).toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`, `DTEND:${new Date(s + 3600_000).toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`)); }
  const r = read(cal(...many), { ...WIN, toMs: Z('2028-01-01T00:00:00Z') });
  ok(`a full diary keeps at most ${BUSY_MAX_RANGES} busy times, the soonest`, r.length === BUSY_MAX_RANGES && r[0][0] === Z('2026-11-10T00:00:00Z'));
}
ok('junk is no calendar, a date that isn’t one is left out, and nothing throws', read('<html>nope</html>').length === 0 && read('').length === 0 && read(cal(ev('UID:x', 'DTSTART:2026XX17', 'DTEND:20261117T150000Z'), ev('UID:x2', 'DTSTART:20261117T180000Z', 'DTEND:20261117T190000Z', 'RRULE:FREQ=SECONDLY'))).length === 1);
ok('a repeat count that isn’t a number repeats without one', read(cal(ev('UID:y', 'DTSTART:20261117T180000Z', 'RRULE:FREQ=WEEKLY;COUNT=abc', 'DTEND:20261117T190000Z'))).length === 9);

// ═══ 6 · into the slot engine ═══
{
  const busy = read(cal(ev('UID:s1', 'DTSTART;TZID=America/Los_Angeles:20261117T130000', 'DTEND;TZID=America/Los_Angeles:20261117T140000'), ev('UID:s2', 'DTSTART;TZID=America/Los_Angeles:20261116T230000', 'DTEND;TZID=America/Los_Angeles:20261117T093000')));
  const day = busyOnDate(busy, '2026-11-17', LA);
  ok('busyOnDate: the business’s clock, a stretch from the night before included', JSON.stringify(day) === JSON.stringify([{ start: '2026-11-16T23:00', end: '2026-11-17T09:30' }, { start: '2026-11-17T13:00', end: '2026-11-17T14:00' }]));
  const config = normalizeBookingConfig({ weekly: [[], [{ start: '09:00', end: '17:00' }], [{ start: '09:00', end: '17:00' }], [{ start: '09:00', end: '17:00' }], [], [], []], slot_interval_min: 30, buffer_min: 15, lead_time_hours: 0, max_days_ahead: 60, timezone: LA });
  const slots = generateSlots({ date: '2026-11-17', config, duration_min: 60, now_local: '2026-11-10T08:00', booked: day });
  ok('the slot engine keeps busy times off, with the owner’s gap around them', !slots.some((s) => /T(09:00|09:30|12:00|12:30|13:00|13:30|14:00)$/.test(s)) && slots.includes('2026-11-17T10:00') && slots.includes('2026-11-17T14:30') && slots.includes('2026-11-17T11:30'), slots.join(' '));
  ok('busyOnDate: a day with nothing busy, and a bad date, give nothing', busyOnDate(busy, '2026-11-20', LA).length === 0 && busyOnDate(busy, 'tomorrow', LA).length === 0 && busyOnDate([], '2026-11-17', LA).length === 0);
}

// ═══ 7 · the address ═══
ok('address: webcal:// is the same address over https', JSON.stringify(calendarUrl('webcal://p52-caldav.icloud.com/published/2/abc')) === JSON.stringify({ ok: true, url: 'https://p52-caldav.icloud.com/published/2/abc', host: 'p52-caldav.icloud.com' }));
ok('address: a Google secret address is kept as it is', calendarUrl(' https://calendar.google.com/calendar/ical/x%40gmail.com/private-abc/basic.ics ').url === 'https://calendar.google.com/calendar/ical/x%40gmail.com/private-abc/basic.ics');
ok('address: not https, a password in it, an odd port, one word, a bare address, spaces or nothing: refused', ['https://203.0.113.5/cal.ics', 'https://[::ffff:7f00:1]/cal.ics', 'http://example.com/a.ics', 'https://u:p@example.com/a.ics', 'https://example.com:8443/a.ics', 'https://intranet/a.ics', 'https://example.com/a b.ics', '', 'ftp://example.com/a.ics', 'javascript:alert(1)'].every((u) => calendarUrl(u).ok === false));

const passed = results.filter(Boolean).length;
console.log(`\n════ BUSY CALENDAR (item 149): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
Deno.exit(0);
