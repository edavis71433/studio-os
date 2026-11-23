// ── Special dates: one day closed, or open different hours (builder list item 432) ──
//   deno run --allow-read --allow-env --allow-net tests/presence/special_dates_432_test.mjs
// A business sets a date in Business details' Hours card, closed or with its own hours and a
// short note. A. the rules (lib/special_dates.ts). B. the save: from today on in the site's
// own time zone, a year ahead at most, forty at most. C. the published site, every template:
// the hours list, Google's data, the Open now data, the Today card, and the page's own script
// taking a date away once it's over. D. the phone bar's tray and its script. E. bookings: no
// time on a closed date, a date's own hours kept to. F. the Do next holiday line opens the
// date, and leaves a holiday already set. Every date is made up; the clock is pinned where
// the code reads it.
import { pinClock } from './clock.mjs';

const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);

Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');

const SD = await import('../../supabase/functions/presence/lib/special_dates.ts');
const LA = 'America/Los_Angeles';
const THANKSGIVING = { date: '2026-11-26', label: 'Closed for Thanksgiving', closed: true, intervals: [] };
const XMAS_EVE = { date: '2026-12-24', label: 'Closing early for Christmas Eve', closed: false, intervals: [{ open: '09:00', close: '14:00' }] };
const GONE = { date: '2026-11-20', label: 'Staff day', closed: true, intervals: [] };

// ═══ A. the rules ═══
{
  ok('A1: a real date, written YYYY-MM-DD', SD.isDay('2026-11-26') && SD.isDay('2028-02-29') && !SD.isDay('2026-02-29') && !SD.isDay('2026-11-31') && !SD.isDay('2026-11-26T00:00') && !SD.isDay(null));
  eq('A2: a year ahead of Thanksgiving', SD.plusDays('2026-11-26', SD.SPECIAL_DAYS_AHEAD), '2027-11-27');
  eq('A3: today in the site’s own zone: at 9pm on Thanksgiving in Burbank it is still Thanksgiving there, not in New York; a zone the computer doesn’t know is Los Angeles',
    [SD.todayIn('2026-11-27T05:00:00Z', LA), SD.todayIn('2026-11-27T05:00:00Z', 'America/New_York'), SD.todayIn('2026-11-27T05:00:00Z', 'Not/AZone'), SD.todayIn('2026-11-27T05:00:00Z', ''), SD.todayIn('soon', LA)],
    ['2026-11-26', '2026-11-27', '2026-11-26', '2026-11-26', '']);
  const given = [
    { ...XMAS_EVE, label: '  Closing  early\u0007 for Christmas Eve ', intervals: [{ open: '09:00', close: '14:00' }, { open: 'noon', close: '1' }] },
    GONE,
    { ...THANKSGIVING, intervals: [{ open: '09:00', close: '17:00' }], label: 'Closed' },
    { date: '2026-12-31', label: 'x'.repeat(80), closed: false, intervals: [{ open: '10:00', close: '10:00' }] },
    THANKSGIVING,
    { date: 'soon', closed: true }, null, 'x',
  ];
  const up = SD.upcomingSpecial(given, '2026-11-23');
  eq('A4: the dates from today on, one per date (the last given wins), in date order', up.map((e) => e.date), ['2026-11-26', '2026-12-24', '2026-12-31']);
  eq('A5: a closed date keeps no times', up[0], THANKSGIVING);
  eq('A6: a note loses control characters and extra spaces; a time that can’t be read is dropped', up[1], XMAS_EVE);
  ok('A7: a note is 60 characters at most, and a day open from 10 to 10 has no time it can use, so it’s closed', up[2].label.length === 60 && up[2].closed === true && up[2].intervals.length === 0);
  eq('A8: today counts; the day after, it’s gone', [SD.upcomingSpecial(given, '2026-11-26')[0].date, SD.upcomingSpecial(given, '2026-11-27')[0].date], ['2026-11-26', '2026-12-24']);
  eq('B1: a save with none is an empty list', [SD.cleanSpecialDates(null, '2026-11-23'), SD.cleanSpecialDates([], '2026-11-23')], [{ ok: true, list: [] }, { ok: true, list: [] }]);
  eq('B2: a date gone by is dropped without a word (the tidy-up)', SD.cleanSpecialDates([GONE, THANKSGIVING], '2026-11-23'), { ok: true, list: [THANKSGIVING] });
  eq('B3: up to a year ahead; a day further is refused, in plain words', [SD.cleanSpecialDates([{ date: '2027-11-24', closed: true }], '2026-11-23').ok, SD.cleanSpecialDates([{ date: '2027-11-25', closed: true }], '2026-11-23')],
    [true, { ok: false, message: 'Special dates can be set up to a year ahead.' }]);
  ok('B4: something that isn’t a list of real dates is refused', ['soon', [{ date: '2026-11-31' }], [{ label: 'no date' }], [null]].every((v) => !SD.cleanSpecialDates(v, '2026-11-23').ok));
  const forty = (n) => Array.from({ length: n }, (_, i) => ({ date: SD.plusDays('2026-11-24', i), closed: true }));
  eq('B5: forty at most', [SD.cleanSpecialDates(forty(40), '2026-11-23').ok, SD.cleanSpecialDates(forty(41), '2026-11-23')], [true, { ok: false, message: 'You can keep up to 40 special dates.' }]);
  const content = { identity: { business_name: 'x' }, locations: [{ timezone: LA, hours: [], holiday_exceptions: [GONE, THANKSGIVING] }, { timezone: LA, hours: [], holiday_exceptions: [] }] };
  const asOf = SD.specialAsOf(content, '2026-11-23T18:00:00Z');
  ok('B6: a snapshot as the site shows it keeps the dates still to come, and leaves the stored content alone', asOf.locations[0].holiday_exceptions.length === 1 && content.locations[0].holiday_exceptions.length === 2 && asOf.locations[1] === content.locations[1]);
  const none = { locations: [{ timezone: LA, holiday_exceptions: [] }] };
  ok('B7: content with no special dates comes back as the same object', SD.specialAsOf(none, '2026-11-23T18:00:00Z') === none && SD.specialAsOf(null, '2026-11-23T18:00:00Z') === null);
}

// ═══ B. the save (PUT /location), the clock pinned ═══
{
  const { handleLocation } = await import('../../supabase/functions/presence/routes/content.ts');
  const site = { id: '00000000-0000-4000-8000-000000000001', client_id: '00000000-0000-4000-8000-000000000002', status: 'live' };
  const principal = { kind: 'owner', userId: 'u1', tenantId: null, role: null, email: 'o@example.com', jwt: 'j', requestId: 'r' };
  let posts = [], stored = { id: 'l1', site_id: site.id, address_line1: '12 Main St', city: 'Burbank', region: 'CA', postal_code: '91502', timezone: LA, hours: [], holiday_exceptions: [GONE] };
  const db = async (path, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    if ((init.method || 'GET').toUpperCase() === 'POST') posts.push(body);
    return { ok: true, status: 200, json: [{ site_id: site.id, ...(body || {}) }] };
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => new Response(JSON.stringify(String(url).includes('presence_locations?') ? [stored] : []), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const put = async (body) => {
    posts = [];
    const r = await handleLocation(new Request('https://x.example/l', { method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }), db, site, principal, {});
    return { status: r.status, body: await r.json() };
  };
  let restore = pinClock('2026-11-23T18:00:00Z');
  try {
    let r = await put({ holiday_exceptions: [XMAS_EVE, { ...THANKSGIVING, label: '  Closed for   Thanksgiving ' }, { date: '2026-11-22', closed: true }] });
    eq('C1: a save keeps the dates from today on, made safe and in date order, and answers with them', [r.status, posts[0]?.holiday_exceptions, r.body.data?.holiday_exceptions?.length], [200, [THANKSGIVING, XMAS_EVE], 2]);
    r = await put({ holiday_exceptions: [{ date: '2027-11-25', closed: true }] });
    ok('C2: more than a year ahead is refused in plain words, and nothing is written', r.status === 422 && r.body.message === 'Special dates can be set up to a year ahead.' && posts.length === 0, JSON.stringify(r.body));
    r = await put({ holiday_exceptions: [{ date: '2026-11-31', closed: true }] });
    ok('C3: a date that isn’t one is refused', r.status === 422 && /isn’t a real date/.test(r.body.message) && posts.length === 0);
    r = await put({ phone: '(818) 555-0100' });
    eq('C4: a save that isn’t about the dates leaves them as they are', [r.status, posts[0]?.holiday_exceptions], [200, [GONE]]);
    restore();
    restore = pinClock('2026-11-27T05:00:00Z');   // 9pm on Thanksgiving in Burbank, midnight in New York
    r = await put({ holiday_exceptions: [THANKSGIVING] });
    eq('C5: “today” is the site’s own: at 9pm on Thanksgiving in Burbank the day is still kept', posts[0]?.holiday_exceptions?.map((e) => e.date), ['2026-11-26']);
    stored = { ...stored, timezone: 'America/New_York' };
    r = await put({ holiday_exceptions: [THANKSGIVING] });
    eq('C6: …and a New York site has already moved on', [r.status, posts[0]?.holiday_exceptions], [200, []]);
  } finally { restore(); globalThis.fetch = realFetch; }
}

// ═══ C. the published site, every template ═══
const SHOWN_AT = '2026-11-23T18:00:00Z';
{
  const { renderSnapshot } = await import('../../supabase/functions/presence/lib/render.ts');
  const { SPECIAL_JS } = await import('../../supabase/functions/presence/lib/template_kit.ts');
  const { TEMPLATES, fullFixture } = await import('./full_fixture.mjs');
  const SITE = { baseUrl: 'https://marlows.example', brand: { credit: 'Site by Davis Digital Studio' } };
  const withDates = (slug, list, at = SHOWN_AT) => {
    const fx = fullFixture(slug);
    fx.created_at = at;
    fx.content.locations[0] = { ...fx.content.locations[0], timezone: LA, holiday_exceptions: list };
    return fx;
  };
  const lds = (html) => [...String(html).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const special = (html) => lds(html).flatMap((l) => (l.specialOpeningHoursSpecification || []).map((s) => `${s.validFrom} ${s.opens}-${s.closes}`));
  const scripts = (html) => [...String(html).matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  for (const slug of TEMPLATES) {
    const files = await renderSnapshot(withDates(slug, [GONE, THANKSGIVING, { ...XMAS_EVE, label: 'Christmas <b>Eve</b> & "early"' }]), SITE);
    const contact = String(files['contact/index.html']), home = String(files['index.html']);
    const list = (contact.match(/<div class="holiday"[^>]*>[\s\S]*?<\/div>/) || [''])[0];
    ok(`D1 [${slug}]: the Contact page lists the dates still to come under Special hours, the date and its hours first, the note on its own line`,
      list.includes('data-tz="America/Los_Angeles"') && list.includes('<strong>Special hours</strong>')
      && list.includes('<li><time datetime="2026-11-26">Thu Nov 26</time>: Closed<br>Closed for Thanksgiving</li>')
      && list.includes('<li><time datetime="2026-12-24">Thu Dec 24</time>: 9am–2pm<br>Christmas &lt;b&gt;Eve&lt;/b&gt; &amp; &quot;early&quot;</li>'), list.slice(0, 400));
    ok(`D2 [${slug}]: a date gone by on the day of the publish is nowhere: not in the list, Google’s data or the Open now data`, !contact.includes('2026-11-20') && !home.includes('2026-11-20') && !home.includes('Staff day'));
    eq(`D3 [${slug}]: Google is told each date still to come, closed as 00:00 to 00:00`, special(contact), ['2026-11-26 00:00-00:00', '2026-12-24 09:00-14:00']);
    const data = JSON.parse((home.match(/<script id="hours-data" type="application\/json">([\s\S]*?)<\/script>/) || [, '{}'])[1]);
    eq(`D4 [${slug}]: the Open now line reads the same dates, in the site’s zone`, [data.tz, Object.keys(data.ex || {})], [LA, ['2026-11-26', '2026-12-24']]);
    ok(`D5 [${slug}]: every page that shows the list carries the script that takes a date away once it’s over; the footer shows it on every page`,
      Object.entries(files).filter(([k, v]) => k.endsWith('.html') && String(v).includes('<div class="holiday" data-tz=')).every(([, v]) => scripts(v).includes(SPECIAL_JS)) && home.includes('<div class="holiday" data-tz='));
  }
  // the page's own script, run as the browser would, on the day after Thanksgiving in Burbank
  const files = await renderSnapshot(withDates('slate', [THANKSGIVING, XMAS_EVE]), SITE);
  const code = scripts(files['contact/index.html']).find((s) => s === SPECIAL_JS);
  // a stand-in page: the list, each date's <time datetime> inside its line
  const page = (dates) => {
    const items = dates.map(() => ({ hidden: false }));
    const times = dates.map((d, i) => ({ dateTime: d, parentNode: items[i] }));
    const box = { hidden: false, dataset: { tz: LA }, querySelectorAll: (q) => (q === 'time' ? times : []) };
    return { box, items, document: { querySelectorAll: (q) => (q === '.holiday' ? [box] : []) } };
  };
  const run = (at, dates) => { const p = page(dates); const restore = pinClock(at); try { new Function('document', code)(p.document); } finally { restore(); } return p; };
  let p = run('2026-11-27T05:00:00Z', ['2026-11-26', '2026-12-24']);
  eq('D6: at 9pm on Thanksgiving in Burbank the page still shows it', p.items.map((i) => i.hidden), [false, false]);
  p = run('2026-11-27T09:00:00Z', ['2026-11-26', '2026-12-24']);
  eq('D7: once the day is over there, the page takes it away and keeps the next', [p.items.map((i) => i.hidden), p.box.hidden], [[true, false], false]);
  p = run('2026-12-25T09:00:00Z', ['2026-11-26', '2026-12-24']);
  ok('D8: with every date over, the whole list goes', p.box.hidden === true);
  // a publish after the day: the date isn't drawn at all, and a site with none draws nothing new
  const after = String((await renderSnapshot(withDates('slate', [THANKSGIVING], '2026-11-27T09:00:00Z'), SITE))['contact/index.html']);
  ok('D9: published once the day is over, the date isn’t drawn and no script comes with it', typeof code === 'string' && !after.includes('Special hours') && !after.includes('2026-11-26') && !scripts(after).includes(SPECIAL_JS));
  const nineLA = String((await renderSnapshot(withDates('slate', [THANKSGIVING], '2026-11-27T05:00:00Z'), SITE))['contact/index.html']);
  ok('D10: published at 9pm on Thanksgiving in Burbank, it’s still drawn', nineLA.includes('<li><time datetime="2026-11-26">'));
  const today = fullFixture('slate');
  today.created_at = SHOWN_AT;
  today.dev_customization = { theme_tokens: { hero_card: 'today' } };
  today.content.settings = { ...today.content.settings, hero_layout: 'photo' };
  today.content.locations[0] = { ...today.content.locations[0], holiday_exceptions: [THANKSGIVING, XMAS_EVE] };
  const card = String((await renderSnapshot(today, SITE))['index.html']);
  ok('D11: the Today card’s line for a special date says the day first, then the note',
    card.includes('id="hc_today"') && card.includes('<p class="hc-when" data-date="2026-11-26" hidden>Closed today<br>Closed for Thanksgiving</p>') && card.includes('<p class="hc-when" data-date="2026-12-24" hidden>Open 9am to 2pm<br>Closing early for Christmas Eve</p>'));
}

// ═══ D. the phone bar's tray ═══
{
  const PB = await import('../../supabase/functions/presence/lib/phone_bar.ts');
  const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => ({ day, closed: day === 'mon', intervals: day === 'mon' ? [] : [{ open: '17:00', close: '22:00' }] }));
  const details = (list) => ({ identity: { phone: '(818) 555-0100' }, locations: [{ address_line1: '12 Main St', city: 'Burbank', timezone: LA, hours: WEEK, holiday_exceptions: list }] });
  const html = PB.phoneBarHtml(details([THANKSGIVING, { ...XMAS_EVE, label: 'Early <close>' }]));
  ok('E1: the tray lists each date under the week, its note under the date, words escaped',
    html.includes('<p class="dds-pb-h dds-pb-sh">Special hours</p><table class="dds-pb-sd"><tbody><tr data-date="2026-11-26"><th scope="row">Thu Nov 26<span class="dds-pb-note">Closed for Thanksgiving</span></th><td>Closed</td></tr><tr data-date="2026-12-24"><th scope="row">Thu Dec 24<span class="dds-pb-note">Early &lt;close&gt;</span></th><td>9am–2pm</td></tr></tbody></table>'), html.slice(html.indexOf('Special'), html.indexOf('Special') + 300));
  ok('E2: a business with none has the tray it had', !PB.phoneBarHtml(details([])).includes('Special hours') && !PB.phoneBarHtml(details(undefined)).includes('dds-pb-sd'));
  const page = PB.applyPhoneBar({ 'index.html': '<html><head></head><body><footer class="site"></footer></body></html>' }, 'light', details([THANKSGIVING, XMAS_EVE]))['index.html'];
  const code = (page.match(/<script id="dds-phonebar-js">([\s\S]*?)<\/script>/) || [])[1];
  const run = (at) => {
    const mk = (attrs) => ({ hidden: false, attrs: { ...attrs }, getAttribute(k) { return this.attrs[k] ?? null; }, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } });
    const thu = mk({ 'data-day': 'thu' }), fri = mk({ 'data-day': 'fri' }), sd = [mk({ 'data-date': '2026-11-26' }), mk({ 'data-date': '2026-12-24' })], table = mk({}), head = mk({});
    const tray = mk({ 'data-tz': LA });
    const d = { open: false, contains: () => false, querySelector: (q) => (q === '[data-tz]' ? tray : q === 'tr[data-day="thu"]' ? thu : q === 'tr[data-day="fri"]' ? fri : q === '.dds-pb-sd' ? table : q === '.dds-pb-sh' ? head : null), querySelectorAll: (q) => (q === 'tr[data-date]' ? sd : []) };
    const document = { querySelector: (q) => (q === '.dds-pb-hours' ? d : null), addEventListener: () => {} };
    const restore = pinClock(at);
    try { new Function('document', code)(document); } finally { restore(); }
    return { thu, fri, sd, table, head };
  };
  let t = run('2026-11-26T20:00:00Z');   // Thanksgiving noon in Burbank
  ok('E3: on the day, its row is marked as today in place of the weekday’s', 'data-today' in t.sd[0].attrs && !('data-today' in t.thu.attrs) && !t.sd[0].hidden);
  t = run('2026-11-27T20:00:00Z');   // the Friday after
  ok('E4: the day after, it’s taken away; the next stays; the weekday is today again', t.sd[0].hidden && !t.sd[1].hidden && 'data-today' in t.fri.attrs && !t.table.hidden);
  t = run('2026-12-26T20:00:00Z');
  ok('E5: with every date over, the heading and the list go', t.sd.every((r) => r.hidden) && t.table.hidden && t.head.hidden);
}

// ═══ E. bookings ═══
{
  const B = await import('../../supabase/functions/presence/lib/booking.ts');
  const own = B.normalizeBookingConfig({ weekly: [[], [], [{ start: '10:00', end: '18:00' }], [{ start: '10:00', end: '18:00' }], [{ start: '10:00', end: '12:00' }, { start: '13:00', end: '18:00' }], [{ start: '10:00', end: '18:00' }], []], slot_interval_min: 60, max_days_ahead: 60, lead_time_hours: 0, timezone: LA });
  const sunday = { date: '2026-12-27', label: 'Open for the holidays', closed: false, intervals: [{ open: '10:00', close: '16:00' }] };
  const cfg = B.withSpecialDates(own, [THANKSGIVING, XMAS_EVE, sunday]);
  const slots = (date, c = cfg) => B.generateSlots({ date, config: c, duration_min: 60, now_local: '2026-11-23T09:00', booked: [] }).map((s) => s.slice(11));
  eq('F1: own booking hours: a closed date offers no time', slots('2026-11-26'), []);
  eq('F2: …a date with its own hours offers only the booking hours inside them (Thursday’s 10 to 12 and 1 to 6, inside 9 to 2)', slots('2026-12-24'), ['10:00', '11:00', '13:00']);
  eq('F3: …a special opening on a day with no booking hours takes no bookings; other days are as they were', [slots('2026-12-27'), slots('2026-12-23', cfg), slots('2026-12-23', own)], [[], ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00'], ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00']]);
  const R = await import('../../supabase/functions/presence/routes/booking.ts');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify([{ hours: [{ day: 'thu', closed: false, intervals: [{ open: '08:00', close: '20:00' }] }], holiday_exceptions: [THANKSGIVING, XMAS_EVE] }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  try {
    const mine = await R.withBusinessHours('s1', own);
    const follows = await R.withBusinessHours('s1', B.normalizeBookingConfig({ slot_interval_min: 60, max_days_ahead: 60, timezone: LA }));
    eq('F4: the site’s bookings read the business’s special dates over its own booking hours', [slots('2026-11-26', mine), slots('2026-12-24', mine)], [[], ['10:00', '11:00', '13:00']]);
    eq('F5: bookings that follow the business hours keep a date’s own hours, and close a closed one', [slots('2026-11-26', follows), slots('2026-12-24', follows), slots('2026-12-03', follows).length], [[], ['09:00', '10:00', '11:00', '12:00', '13:00'], 12]);
  } finally { globalThis.fetch = realFetch; }
}

// ═══ F. the Do next holiday line ═══
{
  const D = await import('../../supabase/functions/presence/lib/do_next.ts');
  const facts = (special) => ({ siteId: 's1', needs: [], health: null, search: null, reviews: null, ai: null, ideas: [], special });
  const hol = (special) => D.composeDoNext(facts(special), { decided: {} }, '2026-11-20T18:00:00.000Z').items.find((i) => i.source === 'holiday');
  const h = hol(null);
  eq('G1: “Thanksgiving is Thursday: are you open?” opens Special dates with that date, not the weekly Thursday', [h.title, h.verb, h.href], ['Thanksgiving is Thursday: are you open?', 'Set hours', '/presence.html?client=s1#hours-2026-11-26']);
  ok('G2: it says where, in plain words', /Special dates on the website’s Hours card/.test(h.sub) && !/—/.test(h.sub));
  ok('G3: once the business has set that date, it isn’t asked; another date set doesn’t count', !hol(['2026-11-26']) && !!hol(['2026-12-24']) && !!hol([]));
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed) Deno.exit(1);
