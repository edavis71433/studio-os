// ── Sales review, Nov 8 2026 — batch twelve ─────────────────────────────────
//   item 46  your bookings and dated tasks in Google Calendar (a private link)
//   item 49  (the rest) Home's Needs you and Analytics lead with the business
//   deno run --allow-read --allow-env --allow-net tests/presence/sales_batch12_test.mjs
Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('APP_URL', 'https://app.example.com');
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const F = await import('../../supabase/functions/presence/lib/calendar_feed.ts');
const { handleCalendarFeed } = await import('../../supabase/functions/presence/routes/calendar.ts');
let pass = 0, fail = 0; const failed = [];
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n, note); } };

// ── the feed format ──
const NOW = '2026-11-08T12:00:00Z';
ok('escaping: backslash, semicolon, comma and newlines', F.icsEscape('a\\b;c,d\ne') === 'a\\\\b\;c\\,d\\ne');
const long = 'SUMMARY:' + 'Résumé review with Harbor Lane Bakery '.repeat(4);
const folded = F.foldLine(long);
ok('folding: no line over 75 octets, and unfolding gives the line back', folded.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75) && folded.replace(/\r\n /g, '') === long);
ok('folding: a short line is left alone', F.foldLine('UID:x@studio-os') === 'UID:x@studio-os');
const ics = F.buildIcs('Studio OS — Harbor, Lane', [
  { uid: 'booking-1', summary: 'Discovery call — Sam Rivera', start: '2026-11-10T17:30:00Z', minutes: 45, url: 'https://app.example.com/presence.html#bookings' },
  { uid: 'next_step-2', summary: 'Send the proposal · Willow Day Spa', allDay: '2026-11-12' },
  { uid: 'bad', summary: 'No date' },
], NOW);
const lines = ics.split('\r\n');
ok('a calendar: begins, ends and ends its lines with CRLF', lines[0] === 'BEGIN:VCALENDAR' && ics.endsWith('END:VCALENDAR\r\n') && !/[^\r]\n/.test(ics));
ok('the calendar is named, with its comma escaped', lines.includes('X-WR-CALNAME:Studio OS — Harbor\\, Lane'));
ok('a timed booking: start and end in UTC, 45 minutes', lines.includes('DTSTART:20261110T173000Z') && lines.includes('DTEND:20261110T181500Z'));
ok('an all-day task: the day and the day after', lines.includes('DTSTART;VALUE=DATE:20261112') && lines.includes('DTEND;VALUE=DATE:20261113'));
ok('an event with no date is left out', (ics.match(/BEGIN:VEVENT/g) || []).length === 2 && !ics.includes('No date'));
ok('each event has a stable id and a stamp', lines.includes('UID:booking-1@studio-os') && lines.filter((l) => l.startsWith('DTSTAMP:20261108T120000Z')).length === 2);
const b = F.bookingEvent({ id: 'a1', type_name: 'Discovery call', slot_start: '2026-11-10T17:30:00Z', duration_min: 45, customer_name: 'Sam Rivera', customer_email: 'sam@example.com', customer_phone: '555', note: 'gate code 1234', status: 'pending' }, 'https://app.example.com');
ok('a booking says what and who, and a pending one says to confirm', b.summary === 'Discovery call — Sam Rivera (to confirm)' && b.tentative === true);
ok('a booking never carries an email, phone or note', !JSON.stringify(b).includes('sam@example.com') && !JSON.stringify(b).includes('555') && !JSON.stringify(b).includes('gate code'));
const t = F.taskEvent({ kind: 'deal_task', id: 'd1', title: 'Price the add-ons', context: 'Willow Day Spa', due: '2026-11-12', href: '/pipeline.html?deal=x' }, 'https://app.example.com');
ok('a dated task is an all-day event linking back to its deal', t.allDay === '2026-11-12' && t.summary === 'Price the add-ons · Willow Day Spa' && t.url === 'https://app.example.com/pipeline.html?deal=x');
ok('an undated task is not an event', F.taskEvent({ kind: 'project_task', id: 'p', title: 'x', due: null }, '') === null);
const tok = F.newFeedToken();
ok('a link\'s secret is 40 hex characters and new every time', F.FEED_TOKEN_RE.test(tok) && tok !== F.newFeedToken());

// ── the feed route, against a fake database ──
const SITE = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'a'.repeat(40);
let world = {};
const seen = [];
globalThis.fetch = async (url) => {
  const u = decodeURIComponent(String(url)); seen.push(u);
  const reply = (rows, status = 200) => new Response(JSON.stringify(rows), { status, headers: { 'Content-Type': 'application/json' } });
  if (u.includes('presence_sales_templates')) return world.tplFail ? reply({ message: 'down' }, 500) : reply(world.tpl ?? []);
  if (u.includes('presence_appointments')) return world.apptFail ? reply({ message: 'down' }, 500) : reply(world.appts ?? []);
  if (u.includes('presence_identity')) return reply([{ business_name: 'Harbor Lane Studio' }]);
  if (u.includes('presence_deals?site_id')) return reply([{ id: 'dd', title: 'Willow Day Spa', stage: 'proposal', next_step: 'Call them', next_step_at: '2026-11-12' }]);
  return reply([]);
};
world = { tpl: [{ site_id: SITE, body: JSON.stringify({ token: TOKEN, user_id: null }) }], appts: [{ id: 'ap1', type_name: 'Discovery call', slot_start: '2026-11-10T17:30:00Z', duration_min: 30, customer_name: 'Sam Rivera', status: 'confirmed' }] };
{
  const r = await handleCalendarFeed(TOKEN);
  const body = await r.text();
  ok('the feed answers a calendar', r.status === 200 && /^text\/calendar/.test(r.headers.get('content-type') || ''), String(r.status));
  ok('…with the booking and the dated next step', body.includes('SUMMARY:Discovery call — Sam Rivera') && body.includes('SUMMARY:Call them · Willow Day Spa'));
  ok('…named for the business, and never indexed', body.includes('X-WR-CALNAME:Studio OS — Harbor Lane Studio') && r.headers.get('x-robots-tag') === 'noindex');
  ok('…reading only that site\'s bookings', seen.some((u) => u.includes(`presence_appointments?site_id=eq.${SITE}`)));
}
{
  world = { tpl: [{ site_id: SITE, body: JSON.stringify({ token: 'b'.repeat(40) }) }] };
  const r = await handleCalendarFeed(TOKEN);
  ok('a row that merely contains the token is not a match', r.status === 404);
}
{
  world = { tpl: [] };
  const r = await handleCalendarFeed(TOKEN);
  ok('a link turned off says so', r.status === 404 && (await r.text()).includes('turned off'));
}
{
  seen.length = 0;
  const r = await handleCalendarFeed('not-a-token');
  ok('a malformed token never reaches the database', r.status === 404 && seen.length === 0);
}
{
  world = { tpl: [{ site_id: SITE, body: JSON.stringify({ token: TOKEN }) }], apptFail: true };
  const r = await handleCalendarFeed(TOKEN);
  ok('a failed read answers 503, so the calendar keeps its last copy', r.status === 503);
}

// ── wiring ──
const idx = read('supabase/functions/presence/index.ts');
const pre = idx.indexOf("const calFeed = route.match(/^\\/calendar\\/feed\\/([0-9a-f]{40})\\.ics$/);"), gate = idx.indexOf("return json({ error: 'unauthorized', message: 'Please sign in.' }, 401, cors);");
ok('the feed is served before the sign-in gate; the link route after it', pre > 0 && gate > pre && idx.indexOf("route === '/calendar/link'") > gate);
ok('making or turning off the link is a setting', /'\(POST\|DELETE\) \/calendar\/link',/.test(read('supabase/functions/presence/lib/site_roles.ts')));
ok('the link lives in a reserved row', /calendarFeed: '__calendar_feed__'/.test(read('supabase/functions/presence/lib/reserved_store.ts')));
ok('My tasks and the calendar share one reader', /export async function loadMyTasks\(siteId: string, userId: string \| null\)/.test(read('supabase/functions/presence/routes/sales.ts')) && /loadMyTasks\(siteId, owner\)/.test(read('supabase/functions/presence/routes/calendar.ts')));
const cx = read('connections.html');
ok('Connections: the Calendar card, not while a client is in view', /async function paintCalendar\(\)\{\n  const host = \$\('calSec'\); if\(!host \|\| SCOPE\) return;/.test(cx) && /id="calSec" hidden/.test(cx));
ok('Connections: the steps for Google Calendar are spelled out', cx.includes('Next to <b>Other calendars</b>, choose <b>+</b>, then <b>From URL</b>.'));

// ── item 49, the rest ──
const ag = read('supabase/functions/presence/agency/routes.ts');
ok('Home and Analytics take the business name from the shared reader', /loadCustomerNames\(studioSite, ls\.map/.test(ag) && /clientNames: Object\.fromEntries\(sites\.map\(\(s\) => \[s\.id, bizBySite\[s\.id\] \|\| nameByClient\[s\.client_id\] \|\| ''\]\)\)/.test(ag));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
