// ── The calendar link's feed, checked against the iCalendar format (RFC 5545) ──
//   deno run --allow-read tests/presence/calendar_feed_structure_test.mjs
// Final pass on the sales side, batch D (Nov 8 2026): the old test pinned the
// semicolon bug (a "\;" that is just ";"). This one parses the whole feed the
// way a strict calendar reader does and checks every rule it relies on:
//   lines end in CRLF only · no line over 75 octets · a folded line starts with
//   one space · components open and close in order · VERSION and PRODID once ·
//   every event has one UID (unique), DTSTAMP, DTSTART, DTEND and SUMMARY ·
//   dates are YYYYMMDD (all day) or YYYYMMDDTHHMMSSZ, and end after start ·
//   text unescapes back to what went in (; , \ and line breaks) · no control
//   characters · an impossible date is left out instead of breaking the feed
const F = await import('../../supabase/functions/presence/lib/calendar_feed.ts');
let pass = 0, fail = 0; const failed = [];
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n, note); } };
const enc = new TextEncoder();

/** A strict reader: physical lines → unfolded content lines → { name, params, value }. */
function read(ics) {
  const problems = [];
  if (!ics.endsWith('\r\n')) problems.push('does not end with CRLF');
  if (/\r(?!\n)/.test(ics)) problems.push('a bare CR');
  if (/(?<!\r)\n/.test(ics)) problems.push('a bare LF');
  const phys = ics.split('\r\n'); phys.pop();
  const lines = [];
  phys.forEach((l, i) => {
    if (enc.encode(l).length > 75) problems.push(`line ${i + 1} is ${enc.encode(l).length} octets`);
    if (l.startsWith(' ')) { if (!lines.length) problems.push('a continuation with nothing before it'); else lines[lines.length - 1] += l.slice(1); }
    else if (l.startsWith('\t')) problems.push(`line ${i + 1} folds with a tab`);
    else lines.push(l);
  });
  const props = lines.map((l) => {
    const m = /^([A-Z][A-Z0-9-]*)((?:;[^:;]+)*):(.*)$/.exec(l);
    if (!m) { problems.push('not a content line: ' + l.slice(0, 40)); return null; }
    return { name: m[1], params: m[2], value: m[3] };
  }).filter(Boolean);
  return { problems, props };
}
/** TEXT unescaping; null when the value holds an unescaped , ; or a stray backslash. */
function unescapeText(v) {
  let out = '';
  for (let i = 0; i < v.length; i++) {
    const ch = v[i];
    if (ch === '\\') { const n = v[++i]; if (n === '\\' || n === ';' || n === ',') out += n; else if (n === 'n' || n === 'N') out += '\n'; else return null; }
    else if (ch === ';' || ch === ',') return null;
    else out += ch;
  }
  return out;
}
/** Components: balanced, and each VEVENT's properties grouped. */
function components(props) {
  const stack = [], events = [], problems = []; let cur = null;
  for (const p of props) {
    if (p.name === 'BEGIN') { stack.push(p.value); if (p.value === 'VEVENT') cur = []; continue; }
    if (p.name === 'END') { const top = stack.pop(); if (top !== p.value) problems.push(`END:${p.value} closes ${top || 'nothing'}`); if (p.value === 'VEVENT') { events.push(cur); cur = null; } continue; }
    if (cur) cur.push(p);
  }
  if (stack.length) problems.push('left open: ' + stack.join(','));
  return { events, problems };
}
const one = (ev, name) => ev.filter((p) => p.name === name);
const DATE = /^\d{8}$/, UTC = /^\d{8}T\d{6}Z$/;
const realYmd = (s) => { const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8))); return d.toISOString().slice(0, 10).replace(/-/g, '') === s; };

// ── a feed with every awkward thing a real studio's data holds ──
const NOW = '2026-11-08T12:00:00Z';
const LONG = 'Ünïcødé 😀 ' + 'Kickoff call about the menu, the hours; and the photos — '.repeat(4);
const events = [
  { uid: 'booking-1', summary: 'Review; phase 2, part \\ "one"', description: 'Line one\nLine two\r\nLine three\rFour', start: '2026-11-10T17:00:00Z', minutes: 45 },
  { uid: 'task-1', summary: LONG, description: 'tab\there · bell\u0007gone · nul\u0000gone', allDay: '2026-11-12' },
  { uid: 'task-2', summary: 'An impossible day', allDay: '2026-02-30' },
  { uid: 'task-3', summary: 'No date at all' },
  { uid: 'booking-2', summary: 'A bad start', start: 'not a date' },
  F.bookingEvent({ id: 'b3', slot_start: '2026-11-11T15:30:00Z', duration_min: 30, type_name: 'Consult', customer_name: 'Sam, the owner', status: 'pending' }, 'https://app.example'),
  F.taskEvent({ id: 't4', kind: 'deal_task', title: 'Price the add-ons; send them', context: 'Larkspur Kitchen', due: '2026-12-31', href: '/pipeline.html' }, 'https://app.example'),
];
const ics = F.buildIcs('Studio; bookings, tasks', events, NOW);
const { problems, props } = read(ics);
ok('lines end in CRLF only, none over 75 octets, folds start with one space', problems.length === 0, problems.join(' | '));
const { events: evs, problems: cp } = components(props);
ok('components open and close in order', cp.length === 0 && props[0].name === 'BEGIN' && props[0].value === 'VCALENDAR' && props[props.length - 1].value === 'VCALENDAR', cp.join(' | '));
const top = props.filter((p) => !evs.flat().includes(p));
ok('VERSION:2.0 and one PRODID', top.filter((p) => p.name === 'VERSION' && p.value === '2.0').length === 1 && top.filter((p) => p.name === 'PRODID').length === 1);
ok('the calendar name unescapes back', unescapeText(props.find((p) => p.name === 'X-WR-CALNAME').value) === 'Studio; bookings, tasks');
ok('the events without a usable date are left out (an impossible day, none, a bad start)', evs.length === 4, String(evs.length));
const uids = evs.map((e) => (one(e, 'UID')[0] || {}).value);
ok('every event has one UID, all different', evs.every((e) => one(e, 'UID').length === 1) && new Set(uids).size === uids.length, JSON.stringify(uids));
ok('every event has one DTSTAMP in UTC', evs.every((e) => one(e, 'DTSTAMP').length === 1 && UTC.test(one(e, 'DTSTAMP')[0].value)));
const when = evs.map((e) => [one(e, 'DTSTART'), one(e, 'DTEND')]);
ok('one DTSTART and one DTEND each', when.every(([s, e]) => s.length === 1 && e.length === 1));
ok('all-day dates are VALUE=DATE YYYYMMDD and real; timed ones are UTC', when.every(([[s], [e]]) => s.params === e.params && (s.params === ';VALUE=DATE' ? DATE.test(s.value) && DATE.test(e.value) && realYmd(s.value) && realYmd(e.value) : s.params === '' && UTC.test(s.value) && UTC.test(e.value))), JSON.stringify(when.map(([[s], [e]]) => [s.params, s.value, e.value])));
const wholeDays = when.filter(([[s]]) => s.params === ';VALUE=DATE');
ok('every event ends after it starts (all day: the next day)', when.every(([[s], [e]]) => e.value > s.value) && wholeDays.length > 0 && wholeDays.every(([[s], [e]]) => { const d = new Date(Date.UTC(+s.value.slice(0, 4), +s.value.slice(4, 6) - 1, +s.value.slice(6, 8) + 1)); return d.toISOString().slice(0, 10).replace(/-/g, '') === e.value; }));
ok('the 45-minute booking ends 45 minutes later', (() => { const ev = evs.find((e) => one(e, 'UID')[0].value.startsWith('booking-1')); return one(ev, 'DTSTART')[0].value === '20261110T170000Z' && one(ev, 'DTEND')[0].value === '20261110T174500Z'; })());
const text = (uidStart, name) => { const ev = evs.find((e) => one(e, 'UID')[0].value.startsWith(uidStart)); return unescapeText((one(ev, name)[0] || {}).value || ''); };
ok('a summary with ; , \\ and quotes unescapes back exactly', text('booking-1', 'SUMMARY') === 'Review; phase 2, part \\ "one"', JSON.stringify(text('booking-1', 'SUMMARY')));
ok('every kind of line break becomes one line break', text('booking-1', 'DESCRIPTION') === 'Line one\nLine two\nLine three\nFour', JSON.stringify(text('booking-1', 'DESCRIPTION')));
ok('a long summary with accents and an emoji folds and unfolds back exactly', text('task-1', 'SUMMARY') === LONG);
ok('control characters are dropped; a tab stays', text('task-1', 'DESCRIPTION') === 'tab\there · bellgone · nulgone', JSON.stringify(text('task-1', 'DESCRIPTION')));
ok('no control character anywhere in the feed but the line ends', !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(ics));
ok('every SUMMARY and DESCRIPTION is valid TEXT (no bare ; , or stray backslash)', evs.every((e) => [...one(e, 'SUMMARY'), ...one(e, 'DESCRIPTION')].every((p) => unescapeText(p.value) !== null)));
ok('a booking says who and what, never more (its comma escaped)', text('booking-b3', 'SUMMARY') === 'Consult — Sam, the owner (to confirm)' && /^TENTATIVE$/.test(one(evs.find((e) => one(e, 'UID')[0].value.startsWith('booking-b3')), 'STATUS')[0].value));
ok('a dated to-do is an all-day event that blocks nothing', (() => { const ev = evs.find((e) => one(e, 'UID')[0].value.startsWith('deal_task-t4')); return one(ev, 'DTSTART')[0].value === '20261231' && one(ev, 'DTEND')[0].value === '20270101' && one(ev, 'TRANSP')[0].value === 'TRANSPARENT'; })());
// an empty feed is still a valid calendar
const empty = read(F.buildIcs('Nothing yet', [], NOW));
ok('an empty feed is still a valid calendar', empty.problems.length === 0 && components(empty.props).problems.length === 0 && components(empty.props).events.length === 0);
// folding at exactly the edges: 75 octets stays one line; a 3-octet character never splits
ok('a 75-octet line stays one line; 76 folds', F.foldLine('X'.repeat(75)) === 'X'.repeat(75) && F.foldLine('X'.repeat(76)).split('\r\n ').length === 2);
ok('a multi-octet character is never split across a fold', F.foldLine('€'.repeat(60)).split('\r\n ').every((l) => !l.includes('�') && enc.encode(l).length <= 75) && F.foldLine('€'.repeat(60)).split('\r\n ').join('') === '€'.repeat(60));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
