// ── Builder list item 185, follow-up: the map rank grid in the monthly report ──
//   deno run --allow-read --allow-env tests/presence/rank_grid_report_test.mjs
// For clients the studio switched the grid on for, the monthly report gets an "On Google Maps"
// part: a small grid and one sentence for the first search with a scan that month, a line for
// each other search, the change against the month before. Each search's monthly scan counts
// when there is one, else its newest that month. It is one more part the studio can leave out,
// it waits (", off") until the grid is on, and it never says a cost.
for (const [k, v] of Object.entries({ SUPABASE_URL: 'http://stub.local', SERVICE_ROLE_KEY: 'SERVICE-KEY', SUPABASE_ANON_KEY: 'ANON-KEY' })) Deno.env.set(k, v);
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}${note ? ' — ' + note : ''}`); };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const P = '../../supabase/functions/presence';
const R = await import(`${P}/ops/monthly_report.ts`);
const PDF = await import(`${P}/lib/report_pdf.ts`);
const C = await import(`${P}/lib/report_choices.ts`);
const read = (p) => Deno.readTextFileSync(new URL(p, import.meta.url));

const G = [9, 6, 4, 4, 3, 5, 8, 7, 4, 3, 2, 2, 3, 6, 11, 5, 2, 1, 1, 2, 4, 14, 8, 3, 1, 1, 2, 5, 0, 12, 6, 2, 3, 4, 9, 0, 17, 10, 7, 6, 8, 13, 0, 0, 15, 12, 11, 14, 18];
const scan = (phrase, kind, at, top3, ranks = G) => ({ phrase, kind, scanned_at: at, size: 7, spacing_mi: 1, ranks, top3, total: 49 });
const NOV = [Date.parse('2026-11-01T00:00:00Z'), Date.parse('2026-12-01T00:00:00Z')], OCT = [Date.parse('2026-10-01T00:00:00Z'), Date.parse('2026-11-01T00:00:00Z')];

// ── 1. the month's grid ──
{
  const scans = [
    scan('plumber', 'now', '2026-11-20T10:00:00Z', 17),       // a Scan now later in the month doesn't replace the monthly scan
    scan('plumber', 'monthly', '2026-11-01T08:00:00Z', 15),
    scan('Emergency Plumber', 'monthly', '2026-11-01T08:01:00Z', 9),
    scan('plumber', 'monthly', '2026-10-01T08:00:00Z', 12),
    scan('plumber', 'now', '2026-10-22T17:00:00Z', 13),
  ];
  const m = R.foldMaps({ phrases: ['plumber', 'emergency plumber', 'water heater repair'], now: NOV, prior: OCT, scans });
  eq('fold: the monthly scan counts, against the month before’s monthly scan', [m.phrase, m.top3, m.priorTop3, m.checkedAt], ['plumber', 15, 12, '2026-11-01T08:00:00Z']);
  eq('fold: the other searches are a line each (any case); one not scanned that month is left out', m.others, [{ phrase: 'emergency plumber', top3: 9, total: 49 }]);
  eq('fold: the grid as stored, 7 by 7, a mile apart', [m.size, m.spacing, m.ranks.length, m.ranks[24], m.ranks[28]], [7, 1, 49, 1, 0]);
  const onlyNow = R.foldMaps({ phrases: ['plumber'], now: NOV, prior: OCT, scans: [scan('plumber', 'now', '2026-11-20T10:00:00Z', 17)] });
  eq('fold: a month with only a Scan now uses its newest; no month before, no change', [onlyNow.top3, onlyNow.priorTop3], [17, null]);
  eq('fold: nothing scanned that month, or nothing read, is no part at all', [R.foldMaps({ phrases: ['plumber'], now: NOV, prior: OCT, scans: [scans[3]] }), R.foldMaps({ phrases: ['plumber'], now: NOV, prior: OCT, scans: null }), R.foldMaps({ phrases: [], now: NOV, prior: OCT, scans })], [null, null, null]);
  const second = R.foldMaps({ phrases: ['water heater repair', 'plumber'], now: NOV, prior: OCT, scans });
  eq('fold: the first search WITH a scan is the one drawn', second.phrase, 'plumber');
  eq('words: the change in words', [PDF.mapsSentence(m), PDF.mapsSentence({ ...m, priorTop3: 15 }), PDF.mapsSentence({ ...m, priorTop3: 18 }), PDF.mapsSentence({ ...m, priorTop3: null })], [
    'For “plumber”, you came up in Google Maps’ top 3 at 15 of 49 spots around your business, 3 more than the month before.',
    'For “plumber”, you came up in Google Maps’ top 3 at 15 of 49 spots around your business, the same as the month before.',
    'For “plumber”, you came up in Google Maps’ top 3 at 15 of 49 spots around your business, 3 fewer than the month before.',
    'For “plumber”, you came up in Google Maps’ top 3 at 15 of 49 spots around your business.',
  ]);
  eq('words: the footnote', [PDF.mapsFootnote(m), PDF.mapsFootnote({ ...m, spacing: 0.5 })], ['Each square is a spot around your business, 1 mile apart. Checked by your studio on Nov 1.', 'Each square is a spot around your business, half a mile apart. Checked by your studio on Nov 1.']);
  eq('bands', [1, 3, 4, 10, 11, 20, 0, null].map(PDF.mapBand), ['top3', 'top3', 'top10', 'top10', 'top20', 'top20', 'out', 'gap']);
}

// ── 2. the email and the PDF ──
{
  const maps = R.foldMaps({ phrases: ['plumber', 'emergency plumber'], now: NOV, prior: OCT, scans: [scan('plumber', 'monthly', '2026-11-01T08:00:00Z', 15), scan('emergency plumber', 'monthly', '2026-11-01T08:00:00Z', 9), scan('plumber', 'monthly', '2026-10-01T08:00:00Z', 12)] });
  const d = { month: '2026-11', monthLabel: 'November 2026', visitors: 812, pageviews: 1900, truncated: false, enquiries: 3, topPages: [], publishes: 1, lastPublishedAt: '2026-11-04T00:00:00Z', address: 'https://copperline.example', siteName: 'Copperline Plumbing', priorLabel: 'October', priorVisitors: 700,
    search: { clicks: 64, impressions: 2140, priorClicks: 59, priorImpressions: null }, followed: [], ai: { month: '2026-11', asked: 7, named: 3, priorNamed: 2, engines: 'Claude', questions: [], newlyNamed: null }, reviews: null, health: null, maps };
  const html = R.reportHtml(d, { studioName: 'Brightline Studio', note: '' }).html;
  ok('email: the part, with its heading and sentence', html.includes('<strong>On Google Maps</strong>') && html.includes('For “plumber”, you came up in Google Maps’ top 3 at 15 of 49 spots around your business, 3 more than the month before.'));
  eq('email: a cell a spot, coloured by band, on the dark square', [(html.match(/<td style="width:12px;height:12px/g) || []).length, (html.match(/background:#11744a;border-radius:3px;font-size:0/g) || []).length, html.includes('background:#171522')], [49, 15, true]);
  ok('email: the other search on its own line, and the key', html.includes('emergency plumber: top 3 at 9 of 49 spots') && html.includes('Not in the top 20') && html.includes('Each square is a spot around your business, 1 mile apart.'));
  ok('email: after On Google, before AI answers', html.indexOf('<strong>On Google</strong>') < html.indexOf('<strong>On Google Maps</strong>') && html.indexOf('<strong>On Google Maps</strong>') < html.indexOf('<strong>In AI answers</strong>'));
  ok('email: never a cost', !/cent|\$\d|cost/i.test(html.slice(html.indexOf('On Google Maps'), html.indexOf('In AI answers'))));
  ok('email: left out when the studio leaves it out', !R.reportHtml(d, { studioName: 'S', note: '', off: ['maps'] }).html.includes('On Google Maps'));
  ok('email: no part without a grid that month', !R.reportHtml({ ...d, maps: null }, { studioName: 'S', note: '' }).html.includes('On Google Maps') && !R.reportHtml({ ...d, maps: undefined }, { studioName: 'S', note: '' }).html.includes('On Google Maps'));
  const enc = (t) => t.replace(/[()\\]/g, '\\$&').replace(/·/g, '\\267').replace(/’/g, '\\222').replace(/“/g, '\\223').replace(/”/g, '\\224');
  const pdf = new TextDecoder().decode(PDF.reportPdf(d, { studioName: 'Brightline Studio', siteName: 'Copperline Plumbing' }));
  for (const s of ['On Google Maps', 'For “plumber”, you came up in Google Maps’ top 3 at 15 of 49 spots around your', '“emergency plumber”: top 3 at 9 of 49 spots']) ok(`pdf: says ${s}`, pdf.includes(enc(s)), s);
  ok('pdf: left out when the studio leaves it out', !new TextDecoder().decode(PDF.reportPdf(d, { studioName: 'S', siteName: 'C', off: ['maps'] })).includes('On Google Maps'));
}

// ── 3. one more part to choose, waiting for the grid ──
{
  eq('parts: after On Google, before AI answers', [...C.REPORT_PARTS], ['visits', 'enquiries', 'google', 'maps', 'ai', 'reviews', 'health', 'pages', 'changes']);
  eq('parts: its words', C.REPORT_PART_WORDS.maps, 'On Google Maps');
  const settings = read('../../settings.html'), report = read(`${P}/ops/monthly_report.ts`);
  ok('settings: the chip says off until the grid is on, like AI answers', settings.includes("const partWaits = (d, k) => (k === 'ai' && !d.ai_checks) || (k === 'maps' && !d.maps_on);") && settings.includes("['maps', 'On Google Maps']"));
  ok('settings: the last part that can show can’t go', settings.includes('words.filter((w) => !partWaits(d, w)).every((w) => off.has(w))'));
  ok('server: the card says whether the grid is on, and the last part that can show can’t go there either', report.includes('maps_on: (await readGridSetting(site.id)') && report.includes("!(p === 'maps' && grid?.enabled !== true)"));
  ok('server: the month’s grid is read only for a client whose grid is on', /grid && grid\.enabled && grid\.phrases\.length \? await safe\(svc\(`presence_rank_grid_scans\?/.test(report));
}

const failed = results.filter((r) => !r.p).length;
console.log(`rank_grid_report: ${results.length - failed} passed, ${failed} failed`);
if (failed) Deno.exit(1);
