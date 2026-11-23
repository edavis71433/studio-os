// ── Builder items 384 and 385 (Nov 2026): seen a lot and clicked little, and the holiday line ──
//   deno run --allow-read --allow-env tests/presence/seen_holiday_384_385_test.mjs
// 384: the Search tab lists the pages Google showed at least 100 times in the month that fewer
// than 2 in 100 people picked, from the page numbers Search Console already keeps, each with a
// plain hint. 385: in the seven days before a main US holiday the client's Do next list asks
// whether they're open, links to the Hours card, and asks once per holiday (the key carries the
// year). Every date here is written out and passed in: nothing reads the real clock.
const S = await import('../../supabase/functions/presence/lib/seen_little.ts');
const H = await import('../../supabase/functions/presence/lib/holidays.ts');
const D = await import('../../supabase/functions/presence/lib/do_next.ts');

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}${note ? ' — ' + note : ''}`); };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

// ── 384: seen a lot, clicked little ──
{
  const pages = [
    { path: '/', clicks: 3, impressions: 900 },            // 0.3 in 100: listed
    { path: '/menu/', clicks: 40, impressions: 1200 },     // 3.3 in 100: picked often enough
    { path: '/catering/', clicks: 0, impressions: 240 },   // never picked: listed
    { path: '/about/', clicks: 1, impressions: 99 },       // seen too few times to judge
    { path: '/hours/', clicks: 2, impressions: 100 },      // exactly 2 in 100: not under it
    { path: '/blog/a/', clicks: 1, impressions: 101 },     // under 1 in 100: listed
  ];
  const l = S.seenLittleClicked(pages);
  eq('384: only pages seen at least 100 times and picked by fewer than 2 in 100, most seen first', l.map((x) => x.path), ['/', '/catering/', '/blog/a/']);
  eq('384: each keeps what Google counted', l.map((x) => [x.seen, x.clicks]), [[900, 3], [240, 0], [101, 1]]);
  eq('384: the home page’s hint is about what you do and where', l[0].hint, 'Google showed it 900 times and people picked it 3 times. Make its title on Google say what you do and where, and its description give one reason to pick you.');
  eq('384: a page never picked says so plainly', l[1].hint, 'Google showed it 240 times and no one picked it. Make its title on Google say what this page offers, and its description say why it’s the one to pick.');
  ok('384: picked once reads “once”', l[2].hint.startsWith('Google showed it 101 times and people picked it once.'));
  ok('384: no em-dashes in the words people see', l.every((x) => !/—/.test(x.hint)));
  const many = Array.from({ length: 9 }, (_, i) => ({ path: `/p${i}/`, clicks: 0, impressions: 1000 - i }));
  eq('384: at most five, the most seen first', S.seenLittleClicked(many).map((x) => x.path), ['/p0/', '/p1/', '/p2/', '/p3/', '/p4/']);
  eq('384: nothing to list is an empty list', S.seenLittleClicked([]), []);
  ok('384: big numbers are written with commas', S.seenLittleClicked([{ path: '/', clicks: 0, impressions: 12500 }])[0].hint.includes('12,500 times'));
}

// ── 385: the main holidays, a week ahead ──
{
  eq('385: Thanksgiving 2026 is Thursday Nov 26, seen a week before', H.holidaySoon('2026-11-19'), { key: 'thanksgiving-2026', name: 'Thanksgiving', date: '2026-11-26', days: 7, when: 'a week from today', day: 'thu' });
  eq('385: six days before, it names the weekday', H.holidaySoon('2026-11-20')?.when, 'Thursday');
  eq('385: the day before says tomorrow, the day says today', [H.holidaySoon('2026-11-25')?.when, H.holidaySoon('2026-11-26')?.when], ['tomorrow', 'today']);
  eq('385: eight days before, and the day after, it isn’t there', [H.holidaySoon('2026-11-18'), H.holidaySoon('2026-11-27')], [null, null]);
  eq('385: the moving ones land on their days', ['2026-05-25', '2026-09-07', '2027-05-31', '2027-11-25'].map((d) => H.holidaySoon(d)?.key), ['memorial-day-2026', 'labor-day-2026', 'memorial-day-2027', 'thanksgiving-2027']);
  eq('385: the fixed ones too, New Year’s across the turn of the year', [H.holidaySoon('2026-07-01')?.key, H.holidaySoon('2026-12-20')?.key, H.holidaySoon('2026-12-29')?.key], ['fourth-of-july-2026', 'christmas-2026', 'new-years-day-2027']);
  eq('385: today is the day where the clients are, not in London', [H.localDay('2026-11-26T06:30:00.000Z'), H.localDay('2026-11-26T09:00:00.000Z')], ['2026-11-25', '2026-11-26']);
  eq('385: an unreadable day is no holiday', H.holidaySoon('soon'), null);

  const SITE = '11111111-1111-4111-8111-111111111111';
  const facts = { siteId: SITE, needs: [{ key: 'enquiry:e1', what: 'reply to an enquiry', when: 'Today', verb: 'Reply', href: '/inbox.html' }], health: [{ type: 'seo.description_missing', severity: 'warning', n: 1 }], search: [], reviews: null, ai: null, ideas: [] };
  const week = D.composeDoNext(facts, { decided: {} }, '2026-11-20T18:00:00.000Z');
  const hol = week.items.find((i) => i.source === 'holiday');
  eq('385: the line, right after Needs you', week.items.map((i) => i.source), ['needs', 'holiday', 'health']);
  eq('385: its words and its link to the Hours card', [hol.key, hol.title, hol.verb, hol.href], ['holiday:thanksgiving-2026', 'Thanksgiving is Thursday: are you open?', 'Set hours', `/presence.html?client=${SITE}#hours-thu`]);
  eq('431: the link names the holiday’s weekday the way the Hours card names its rows', ['2026-12-20', '2026-12-29', '2027-07-01'].map((d) => H.holidaySoon(d)?.day), ['fri', 'fri', 'sun']);
  ok('385: it says what to do there, without em-dashes', /Hours card/.test(hol.sub) && !/—/.test(hol.sub + hol.title));
  ok('385: a key the decisions accept', !('error' in D.applyDecision({ decided: {} }, hol.key, 'not_relevant', hol.title, null, '2026-11-20T18:00:00.000Z')));
  const away = D.applyDecision({ decided: {} }, hol.key, 'done', hol.title, null, '2026-11-20T18:00:00.000Z');
  ok('385: Done puts it away for the rest of the week', !D.composeDoNext(facts, away, '2026-11-25T18:00:00.000Z').items.some((i) => i.source === 'holiday'));
  ok('385: once per holiday: done this Thanksgiving, next Christmas still asks', D.composeDoNext(facts, away, '2026-12-20T18:00:00.000Z').items.some((i) => i.key === 'holiday:christmas-2026'));
  ok('385: no holiday this week, no line', !D.composeDoNext(facts, { decided: {} }, '2026-11-11T18:00:00.000Z').items.some((i) => i.source === 'holiday'));
}

const failed = results.filter((r) => !r.p).length;
console.log(`seen_holiday_384_385: ${results.length - failed} passed, ${failed} failed`);
if (failed) Deno.exit(1);
