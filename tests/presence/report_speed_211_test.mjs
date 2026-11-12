// ── Builder list item 211: the monthly report says how fast the client's site loads ──
// Review file 01, finding 1: a page Studio OS publishes is about 25 kB, so it shows fast, and
// the client should hear it. The report gains a part, "How fast it loads", from the speed each
// visitor's browser reported as they left a page (list item 151, 0160): three visitors in four
// saw a page that fast or faster, Google's own measure. Left out when too few visits reported
// one, and when the studio switched the part off (item 160).
//
//   deno run --allow-read --allow-env tests/presence/report_speed_211_test.mjs
const R = await import('../../supabase/functions/presence/ops/monthly_report.ts');
const C = await import('../../supabase/functions/presence/lib/report_choices.ts');
const V = await import('../../supabase/functions/presence/lib/visits.ts');
const { reportPdf } = await import('../../supabase/functions/presence/lib/report_pdf.ts');
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const rows = (device, ms, n, path = '/') => Array.from({ length: n }, (_, i) => ({ path, device, lcp_ms: ms + (i % 5) * 10 }));
// ── the words ──
{
  const fast = V.reportSpeed([...rows('mobile', 900, 30), ...rows('desktop', 600, 30)]);
  ok('fast: both kinds of screen, Google’s measure, plainly', fast && fast.verdict === 'fast' && V.speedWords(fast) === 'Three visitors in four saw your pages within 0.9 seconds on phones and 0.6 seconds on computers. That’s fast: Google counts under 2.5 seconds as good.', V.speedWords(fast));
  const slow = V.reportSpeed([...rows('mobile', 3100, 30, '/menu/'), ...rows('desktop', 800, 30)]);
  ok('a little slow: says where', slow && slow.verdict === 'a_little_slow' && /^Three visitors in four saw your pages within 3\.1 seconds on phones and 0\.8 seconds on computers\. A little slow on phones: the menu page takes 3\.1 s for most visitors\.$/.test(V.speedWords(slow)), V.speedWords(slow));
  const one = V.reportSpeed(rows('desktop', 1200, 25));
  ok('one kind of screen only: just that one', one && V.speedWords(one) === 'Three visitors in four saw your pages within 1.2 seconds on computers. That’s fast: Google counts under 2.5 seconds as good.', V.speedWords(one));
  ok('too few visits to judge: nothing said, never a guess', V.reportSpeed(rows('mobile', 900, 5)) === null && V.speedWords(null) === null && V.reportSpeed(null) === null);
}
// ── a part of the report the studio can switch off ──
{
  ok('the part: "How fast it loads", after Website health', C.REPORT_PARTS.includes('speed') && C.REPORT_PARTS.indexOf('speed') === C.REPORT_PARTS.indexOf('health') + 1 && C.REPORT_PART_WORDS.speed === 'How fast it loads');
  ok('the part can be switched off like the others', JSON.stringify(C.normalizePartsOff(['speed', 'nope'])) === '["speed"]');
  const D = { month: '2026-10', monthLabel: 'October 2026', visitors: 812, pageviews: 2104, truncated: false, enquiries: 3, topPages: [{ path: '/listings', views: 402 }],
    publishes: 2, lastPublishedAt: '2026-10-24T17:00:00Z', address: 'https://maple.example', siteName: 'Maple & Main Realty', priorLabel: 'September', priorVisitors: 690,
    search: null, followed: [], ai: null, reviews: null, health: { n: 3, then: 5, fixed: 2 },
    speed: { phones_ms: 900, computers_ms: 600, verdict: 'fast', sentence: 'Loads fast for most visitors.' } };
  const on = R.reportHtml(D, { studioName: 'Brightline Studio', note: '' }).html;
  const off = R.reportHtml(D, { studioName: 'Brightline Studio', note: '', off: ['speed'] }).html;
  const none = R.reportHtml({ ...D, speed: null }, { studioName: 'Brightline Studio', note: '' }).html;
  ok('email: the part, after Website health', /How fast it loads<\/strong><\/p><p[^>]*>Three visitors in four saw your pages within 0\.9 seconds on phones/.test(on) && on.indexOf('How fast it loads') > on.indexOf('Website health'));
  ok('email: switched off, or nothing to say, it is left out', !/How fast it loads/.test(off) && !/How fast it loads/.test(none) && /Website health/.test(off));
  const text = (bytes) => new TextDecoder('latin1').decode(bytes);
  const pdf = text(reportPdf(D, { studioName: 'Brightline Studio', siteName: 'Maple & Main Realty' }));
  const pdfOff = text(reportPdf(D, { studioName: 'Brightline Studio', siteName: 'Maple & Main Realty', off: ['speed'] }));
  ok('PDF: the same part, and switched off it stays out', /How fast it loads/.test(pdf) && /Three visitors in four/.test(pdf) && !/How fast it loads/.test(pdfOff));
}
// ── the read ──
{
  const src = read('supabase/functions/presence/ops/monthly_report.ts');
  ok('the month’s speed rows are read every one, a page at a time', /svcPages\(`presence_visits\?site_id=eq\.\$\{site\.id\}&ts=gte\.\$\{win\.startIso\}&ts=lt\.\$\{win\.endIso\}&kind=eq\.leave&lcp_ms=not\.is\.null&select=path,device,lcp_ms`, 'ts', VISITS_PAGE, 5\)/.test(src) && /speed: reportSpeed\(sq \? sq\.rows as SpeedRow\[\] : null\)/.test(src));
  const page = read('settings.html');
  ok('settings: a part the server adds is named in its own words', /d\.parts\.map\(\(p\) => \[p\.key, p\.words\]\) : REPORT_PARTS\)\.find\(\(p\) => p\[0\] === k\)/.test(page));
}

const failed = results.filter((r) => !r.p);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) Deno.exit(1);
