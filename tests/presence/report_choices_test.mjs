// ── The studio's choices for a client's monthly report (builder list items 160 and 176) ──
//   deno run --allow-read --allow-env --allow-net tests/presence/report_choices_test.mjs
// What the report says (parts switched off stay out of the email and the PDF), who gets it
// (up to four more people, never the client twice, a copy to the studio person who asked),
// a quiet month skipped, and one suggestion a month: from the client's Do next list, in
// the studio's own words, or none; a picked one rests three months. Plus the studio's
// one-card list of every client's report.
for (const [k, v] of Object.entries({ SUPABASE_URL: 'http://stub.local', SERVICE_ROLE_KEY: 'SERVICE-KEY', SUPABASE_ANON_KEY: 'ANON-KEY' })) Deno.env.set(k, v);
const P = '../../supabase/functions/presence';
const C = await import(`${P}/lib/report_choices.ts`);
const R = await import(`${P}/ops/monthly_report.ts`);
const { reportPdf } = await import(`${P}/lib/report_pdf.ts`);
const { reportRows } = await import(`${P}/agency/monthly_reports.ts`);

const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const NOW = '2026-11-20T18:00:00.000Z';

// ── the stored shape, cleaned ──
ok('parts: only known ones, each once, in the report’s order', JSON.stringify(C.normalizePartsOff(['health', 'nope', 'visits', 'health'])) === JSON.stringify(['visits', 'health']));
ok('parts: junk is every part in', C.normalizePartsOff('visits').length === 0 && C.normalizePartsOff(null).length === 0);
ok('more people: real addresses, lower case, each once, never the client, four at most',
  JSON.stringify(C.normalizeCc(['Office@Maple.example', 'office@maple.example', 'not an email', 'sam@maple.example', 'a@x.example', 'b@x.example', 'c@x.example', 'd@x.example'], 'SAM@maple.example')) === JSON.stringify(['office@maple.example', 'a@x.example', 'b@x.example', 'c@x.example']));
ok('quiet month: a whole number 1 to 1,000, else always send', C.normalizeQuiet(30) === 30 && C.normalizeQuiet('12.7') === 12 && C.normalizeQuiet(5000) === 1000 && C.normalizeQuiet(0) === null && C.normalizeQuiet(-3) === null && C.normalizeQuiet(null) === null && C.normalizeQuiet('x') === null);
ok('copy: a real address or nothing', C.normalizeCopyTo('Eric@Studio.example') === 'eric@studio.example' && C.normalizeCopyTo('nope') === null);
{
  const p = C.normalizePropose({ mode: 'auto', text: '  A   page  ', pick: 'idea:abc', log: [{ month: '2026-09', key: 'idea:x' }, { month: 'bad', key: 'y' }, { month: '2026-10', key: 'ai:q' }] });
  ok('suggest: mode, text tidied, a pick, the log newest first and clean', p.mode === 'auto' && p.text === 'A page' && p.pick === 'idea:abc' && JSON.stringify(p.log) === JSON.stringify([{ month: '2026-10', key: 'ai:q' }, { month: '2026-09', key: 'idea:x' }]));
  ok('suggest: off unless chosen; text capped', C.normalizePropose(null).mode === 'off' && C.normalizePropose({ mode: 'loud' }).mode === 'off' && C.normalizePropose({ text: 'x'.repeat(900) }).text.length === C.PROPOSE_TEXT_MAX);
}

// ── what it could suggest, from the Do next list ──
const FACTS = {
  siteId: 's1',
  needs: [{ key: 'unpublished:s1', what: 'changes are sitting unpublished', when: '', verb: 'Publish', href: '/x' }],
  health: [{ type: 'website.hosting_missing', severity: 'critical', n: 1 }, { type: 'seo.description_missing', severity: 'warning', n: 3 }],
  search: [{ key: 'meta', priority: 'high', done: false, title: 'Write a search description for Services', sub: 'Google shows a blank line now', go: null }, { key: 'low', priority: 'medium', done: false, title: 'Small thing', sub: '', go: null }],
  reviews: { googleUnreplied: 2, pending: 1 },
  ai: { results: [{ q: 'best florist in burbank', kind: 'unbranded', answers: [{ named: false }] }] },
  ideas: [{ id: '11111111-2222-4333-8444-555555555555', opportunity: 'A focused fall page that ends at your booking link', suggested_next_step: 'Draft it this week', timing_phrase: null }],
};
{
  const c = C.proposalCandidates(FACTS, {}, NOW);
  ok('candidates: the Growth Coach idea first, as two sentences', c[0].key === 'idea:11111111-2222-4333-8444-555555555555' && c[0].text === 'A focused fall page that ends at your booking link. Draft it this week.');
  ok('candidates: then the AI question that misses them', c[1].key === 'ai:best-florist-in-burbank' && c[1].text.includes('“best florist in burbank”'));
  ok('candidates: then Search’s high to-dos, not its medium ones', c.some((x) => x.key === 'search:meta') && !c.some((x) => x.key === 'search:low'));
  ok('candidates: a health problem, never the site’s state (not hosted yet)', c.some((x) => x.key === 'health:seo.description_missing' && /in 3 places/.test(x.text)) && !c.some((x) => x.key === 'health:website.hosting_missing'));
  ok('candidates: Google reviews waiting for a reply', c.some((x) => x.key === 'reviews:google' && x.text.startsWith('2 Google reviews are waiting')));
  ok('candidates: never the studio’s own Needs you rows', !c.some((x) => x.key.startsWith('unpublished')));
  const decided = { 'idea:11111111-2222-4333-8444-555555555555': { state: 'not_relevant', at: '2026-11-01T00:00:00Z', by: null, title: '' } };
  ok('candidates: what the studio marked Not relevant on Do next stays out', C.proposalCandidates(FACTS, decided, NOW)[0].key === 'ai:best-florist-in-burbank');
}

// ── the one it picks ──
{
  const cands = C.proposalCandidates(FACTS, {}, NOW);
  const base = C.normalizePropose({ mode: 'auto' });
  ok('pick: off says nothing', C.pickProposal(C.normalizePropose({ mode: 'off' }), cands, '2026-11') === null);
  ok('pick: the studio’s own words, as written', C.pickProposal(C.normalizePropose({ mode: 'own', text: 'Let’s add a gallery.' }), cands, '2026-11').text === 'Let’s add a gallery.');
  ok('pick: own words left empty say nothing', C.pickProposal(C.normalizePropose({ mode: 'own', text: '' }), cands, '2026-11') === null);
  ok('pick: the best one', C.pickProposal(base, cands, '2026-11').key === cands[0].key);
  ok('pick: one the studio chose for this report', C.pickProposal({ ...base, pick: 'reviews:google' }, cands, '2026-11').key === 'reviews:google');
  ok('pick: a chosen one that has gone away falls back to the best', C.pickProposal({ ...base, pick: 'search:gone' }, cands, '2026-11').key === cands[0].key);
  const rest = { ...base, log: [{ month: '2026-09', key: cands[0].key }] };
  ok('pick: what went out two months ago rests', C.pickProposal(rest, cands, '2026-11').key === cands[1].key);
  ok('pick: three months on it can come back', C.pickProposal({ ...base, log: [{ month: '2026-08', key: cands[0].key }] }, cands, '2026-11').key === cands[0].key);
  ok('pick: nothing to suggest says nothing', C.pickProposal(base, [], '2026-11') === null);
  const after = C.afterProposal({ ...base, pick: 'reviews:google' }, '2026-11', cands[2]);
  ok('after: logged once for the month, the one-off pick used up', after.pick === null && after.log[0].month === '2026-11' && after.log[0].key === cands[2].key && C.afterProposal(after, '2026-11', cands[1]).log.filter((l) => l.month === '2026-11').length === 1);
  ok('after: nothing sent changes nothing', C.afterProposal(base, '2026-11', null) === base);
  ok('quiet: under the number skips; unread counts never do', C.quietMonth(30, 12) && !C.quietMonth(30, 30) && !C.quietMonth(null, 0) && !C.quietMonth(30, null));
}

// ── a PUT's changes ──
{
  const cur = R.normalizeReportSetting({ enabled: true, note: 'Hi', last_month: '2026-10' });
  const next = R.applyReportChange(cur, { parts_off: ['health', 'x'], cc: ['A@b.example', 'bad'], copy: true, quiet_min: 25, propose: { mode: 'own', text: 'A gallery page.' } }, 'eric@studio.example', NOW);
  ok('change: parts, people, copy to whoever asked, quiet, suggestion', JSON.stringify(next.parts_off) === '["health"]' && JSON.stringify(next.cc) === '["a@b.example"]' && next.copy_to === 'eric@studio.example' && next.quiet_min === 25 && next.propose.mode === 'own' && next.propose.text === 'A gallery page.');
  ok('change: the switch and the month mark are untouched', next.enabled === true && next.last_month === '2026-10' && next.note === 'Hi');
  const off = R.applyReportChange(next, { copy: false, quiet_min: null, propose: { mode: 'auto', pick: 'ai:q' } }, 'jo@studio.example', NOW);
  ok('change: copy off, quiet off, back to picking, the own words kept for later', off.copy_to === null && off.quiet_min === null && off.propose.mode === 'auto' && off.propose.pick === 'ai:q' && off.propose.text === 'A gallery page.');
}

// ── the email and the PDF ──
const D = { month: '2026-10', monthLabel: 'October 2026', visitors: 812, pageviews: 2104, truncated: false, enquiries: 3, topPages: [{ path: '/listings', views: 402 }],
  publishes: 2, lastPublishedAt: '2026-10-24T17:00:00Z', address: 'https://maple.example', siteName: 'Maple & Main Realty', priorLabel: 'September', priorVisitors: 690,
  search: { clicks: 64, impressions: 2140, priorClicks: 58, priorImpressions: 1900 }, followed: [], ai: null,
  reviews: { rating: 4.6, count: 28, newGoogle: 2, unreplied: 1, ownNew: null }, health: { n: 3, then: 5, fixed: 2 } };
{
  const all = R.reportHtml(D, { studioName: 'Brightline Studio', note: '' });
  const some = R.reportHtml(D, { studioName: 'Brightline Studio', note: '', off: ['health', 'google', 'pages'], proposal: 'A page for open houses. <b>Now</b>.' });
  ok('email: every part in by default', /Website health/.test(all.html) && /On Google/.test(all.html) && /What people read most/.test(all.html) && !/What we suggest next/.test(all.html));
  ok('email: a part switched off never shows', !/Website health/.test(some.html) && !/On Google/.test(some.html) && !/What people read most/.test(some.html) && /Reviews/.test(some.html) && /What changed/.test(some.html));
  ok('email: the suggestion box, escaped, with the reply line', /What we suggest next/.test(some.html) && some.html.includes('A page for open houses. &lt;b&gt;Now&lt;/b&gt;.') && /Reply to this email and we’ll set it up →/.test(some.html));
  const noTiles = R.reportHtml(D, { studioName: 'S', note: '', off: ['visits', 'enquiries'] });
  ok('email: with both numbers off there are no empty tiles', !/<table role="presentation"/.test(noTiles.html) && !/>Visits</.test(noTiles.html));
  const text = (bytes) => new TextDecoder('latin1').decode(bytes);
  const pdfAll = text(reportPdf(D, { studioName: 'Brightline Studio', siteName: 'Maple & Main Realty' }));
  const pdfSome = text(reportPdf(D, { studioName: 'Brightline Studio', siteName: 'Maple & Main Realty', off: ['health'], proposal: 'A page for open houses.' }));
  ok('PDF: a part switched off stays out of the PDF too', /Website health/.test(pdfAll) && !/Website health/.test(pdfSome));
  ok('PDF: the suggestion is in it', /What we suggest next/.test(pdfSome) && /A page for open houses\./.test(pdfSome) && !/What we suggest next/.test(pdfAll));
}

// ── the studio's one card ──
{
  const ids = ['s-b', 's-a', 's-c', 's-gone'];
  const rows = reportRows({
    ids,
    sites: [{ id: 's-a', client_id: 'c-a' }, { id: 's-b', client_id: 'c-b' }, { id: 's-c', client_id: 'c-c' }],
    names: [{ site_id: 's-a', business_name: 'Bluebird Bakery' }, { site_id: 's-b', business_name: 'Maple & Main Realty' }],
    clients: [{ id: 'c-a', email: 'jo@bluebird.example', name: 'Jo' }, { id: 'c-b', email: 'Sam@Maple.example', name: 'Sam' }, { id: 'c-c', email: null, name: 'Ortiz Photography' }],
    settings: [{ site_id: 's-b', body: JSON.stringify({ enabled: true, cc: ['office@maple.example'], copy_to: 'eric@studio.example', propose: { mode: 'auto' }, last_result: { month: '2026-10', status: 'sent', reason: null, at: NOW } }) }, { site_id: 's-a', body: '{not json' }],
    suppressed: { 'jo@bluebird.example': 'opt_out' },
  });
  ok('card: one row a client, by name, a gone site left out', JSON.stringify(rows.map((r) => r.name)) === JSON.stringify(['Bluebird Bakery', 'Maple & Main Realty', 'Ortiz Photography']));
  const maple = rows.find((r) => r.site_id === 's-b'), blue = rows.find((r) => r.site_id === 's-a'), ortiz = rows.find((r) => r.site_id === 's-c');
  ok('card: on, one more person, a copy, picking, last sent', maple.enabled && maple.more === 1 && maple.copy && maple.propose === 'auto' && maple.last.status === 'sent' && maple.blocked === null);
  ok('card: an unreadable setting reads as off; an unsubscribed client says so', !blue.enabled && blue.blocked === 'unsubscribed');
  ok('card: no email on their record says so; the name falls back to the client’s', ortiz.blocked === 'no_email' && ortiz.name === 'Ortiz Photography');
}

// ── wiring ──
{
  const read = (p) => Deno.readTextFileSync(new URL('../../' + p, import.meta.url));
  const job = read('supabase/functions/presence/ops/monthly_report.ts');
  const run = job.slice(job.indexOf('export async function runMonthlyReports'), job.indexOf('// ── the site-scoped routes'));
  ok('job: the quiet check comes after the claim and before the send', run.indexOf('const claimed = await SAVE(') < run.indexOf('quietMonth(setting.quiet_min, data.visitors)') && run.indexOf('quietMonth(') < run.indexOf('await sendReport(site, win, setting, reach.email'));
  ok('job: the extra people and the copy only after the client’s report went', run.indexOf('if (ok) {') < run.indexOf('for (const to of setting.cc)') && run.indexOf('for (const to of setting.cc)') < run.indexOf('if (setting.copy_to)'));
  ok('job: the suggestion that went out is logged with the month', /propose: afterProposal\(s\.propose, win\.month, proposal\)/.test(run));
  const routes = read('supabase/functions/presence/agency/routes.ts');
  ok('studio card: GET /agency/monthly-reports, loaded only when asked for', /if \(route === '\/agency\/monthly-reports'\) \{\s*const r = await \(await import\('\.\/monthly_reports\.ts'\)\)\.handleMonthlyReports\(route, method, member, cors\);/.test(routes));
  const card = read('supabase/functions/presence/agency/monthly_reports.ts');
  ok('studio card: read only; the switches are the client’s own PUT', !/method: '(POST|PATCH|PUT|DELETE)'/.test(card) && /PUT \/report\/monthly, scoped to that client/.test(card));
  ok('studio card: a failed read says so, never "every report off"', /if \(!\(sitesQ as \{ ok\?: boolean \}\)\.ok \|\| !\(setQ as \{ ok\?: boolean \}\)\.ok\) return json\(\{ error: 'read_failed'/.test(card));
}

const passed = results.filter(Boolean).length;
console.log(`\n════ REPORT CHOICES (items 160 and 176): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
