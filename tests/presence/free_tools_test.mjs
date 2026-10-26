// ── Free Tools Phase 1: foundation (report store, gate, unlock, emails) ──────
//   deno run --allow-read --allow-env tests/presence/free_tools_test.mjs
// Pure tier: the real handlers run against an in-memory PostgREST/Resend/
// Turnstile fake (fixtures/free_tools_fake.mjs), so no network is needed.
import { makeFake, setFakeEnv } from './fixtures/free_tools_fake.mjs';

setFakeEnv();
const fake = makeFake();
globalThis.fetch = fake.fetch;

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const { scoreLabel, publicReport } = await import('../../supabase/functions/_shared/tools/report_view.ts');
const { windowStart, cacheKeyFor, isEmail, beginScan, finishScan } = await import('../../supabase/functions/_shared/tools/guard.ts');
const { reportReadyEmail, leadAlertEmail } = await import('../../supabase/functions/_shared/tools/email.ts');
const { handler: reportHandler } = await import('../../supabase/functions/tool-report/handler.ts');
const { handler: unlockHandler, pendingFollowUps } = await import('../../supabase/functions/unlock-report/handler.ts');
const { handler: alertHandler } = await import('../../supabase/functions/send-lead-alert/handler.ts');
fake.handlers.leadAlert = alertHandler;

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p: !!p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const sample = JSON.parse(read('tests/presence/fixtures/tool_report_sample.json'));
const aiSample = {
  id: crypto.randomUUID(), tool: 'ai_visibility', unlocked: false,
  input: { business_name: 'Bacchus Kitchen', city: 'Pasadena' },
  scores: { overall: 41, pillars: [{ key: 'rec', name: 'Recommendation rate', score: 20 }], highlights: [{ label: 'Appeared in', value: '4 of 15 answers' }, { label: 'Top competitor', value: 'Union Restaurant' }] },
  findings: { summary: 'AI knows you, but rarely recommends you.', items: [{ title: 'Only Perplexity names you' }], top_three: ['x'], tables: [{ title: 'Who AI recommends instead', columns: [], rows: [] }] },
};
let ipN = 0;
const req = (url, init = {}, ip = `203.0.113.${++ipN}`) => new Request(url, { ...init, headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip, origin: 'https://tools.davisdigitalstudio.com', ...(init.headers || {}) } });
const post = (fn, body, ip) => req(`https://x/functions/v1/${fn}`, { method: 'POST', body: JSON.stringify(body) }, ip);
const seed = (row) => { fake.state.tables.tool_reports.push(structuredClone(row)); return row.id; };

// ── scoring labels (spec: 80+ Strong, 60-79 Needs work, under 60 Fix now) ──
ok('label: 80 is Strong, 79 Needs work', scoreLabel(80) === 'Strong' && scoreLabel(79) === 'Needs work');
ok('label: 60 Needs work, 59 Fix now, null stays null', scoreLabel(60) === 'Needs work' && scoreLabel(59) === 'Fix now' && scoreLabel(null) === null);

// ── teaser rule is enforced server side ──
const lockedSR = publicReport(sample);
ok('teaser (Site Review): overall, four pillars, summary, exactly two findings', lockedSR.overall === 64 && lockedSR.pillars.length === 4 && !!lockedSR.summary && lockedSR.findings.length === 2);
ok('teaser (Site Review): no Top 3, no tables, but the total is known', lockedSR.top_three.length === 0 && lockedSR.tables.length === 0 && lockedSR.findings_total === 5);
const lockedAI = publicReport(aiSample);
ok('teaser (AI Visibility): score + highlights + summary, no findings or pillars', lockedAI.overall === 41 && lockedAI.highlights.length === 2 && lockedAI.findings.length === 0 && lockedAI.pillars.length === 0 && !!lockedAI.summary);
const fullSR = publicReport({ ...sample, unlocked: true });
ok('full report: every finding, Top 3, tables, closing CTA', fullSR.findings.length === 5 && fullSR.top_three.length === 3 && fullSR.tables.length === 2 && /Book a free 30 minute call/.test(fullSR.closing.text) && fullSR.closing.url === 'https://calendly.com/eric-davisdigitalstudio/30min');
ok('full report: AI Visibility closing line from the spec', /show up where your competitors do/.test(publicReport({ ...aiSample, unlocked: true }).closing.text));

// ── pure guard helpers ──
const t = new Date('2026-10-29T17:42:10Z'); // a Thursday
ok('window: hour start', windowStart(t, 'hour').toISOString() === '2026-10-29T17:00:00.000Z');
ok('window: day start', windowStart(t, 'day').toISOString() === '2026-10-29T00:00:00.000Z');
ok('window: week starts Monday', windowStart(t, 'week').toISOString() === '2026-10-26T00:00:00.000Z' && windowStart(new Date('2026-11-01T23:00:00Z'), 'week').toISOString() === '2026-10-26T00:00:00.000Z');
ok('cache key: Site Review ignores scheme, www, case and trailing slash', cacheKeyFor('site_review', { url: 'https://www.Example.com/' }) === 'example.com' && cacheKeyFor('site_review', { url: 'example.com' }) === 'example.com');
ok('cache key: AI Visibility is business + city, whitespace/case-insensitive', cacheKeyFor('ai_visibility', { business_name: ' Bacchus  Kitchen', city: 'PASADENA' }) === 'bacchus kitchen|pasadena');
ok('email check: accepts real, rejects junk', isEmail('pat@example.com') && !isEmail('pat@') && !isEmail('a b@c.com') && !isEmail('<x>@y.com'));

// ── emails escape visitor-supplied text ──
const em = reportReadyEmail({ name: '<b>Pat</b>', toolName: 'Site Review', businessName: 'Evil <script>', score: 64, label: 'Needs work', reportUrl: 'https://tools.davisdigitalstudio.com/report/x', calendlyUrl: 'https://calendly.com/eric-davisdigitalstudio/30min', unsubscribeUrl: 'https://u' });
ok('visitor email: HTML-escapes name and business, keeps the link and unsubscribe', !em.html.includes('<script>') && em.html.includes('&lt;script&gt;') && em.html.includes('/report/x') && /Unsubscribe/.test(em.html) && /Unsubscribe: https:\/\/u/.test(em.text));
const la = leadAlertEmail({ toolName: 'Site Review', reportUrl: 'https://r', score: 64, label: 'Needs work', lead: { email: 'pat@example.com', business_name: 'Cedar & Core' } });
ok('lead alert: subject is "New lead: [business] ran [tool]"', la.subject === 'New lead: Cedar & Core ran Site Review' && la.html.includes('Cedar &amp; Core'));

// ── tool-report ──
const sampleId = seed(sample);
let r = await reportHandler(req(`https://x/functions/v1/tool-report?id=not-a-uuid`));
ok('tool-report: malformed id is a 404', r.status === 404);
r = await reportHandler(req(`https://x/functions/v1/tool-report?id=${crypto.randomUUID()}`));
ok('tool-report: unknown id is a 404', r.status === 404);
r = await reportHandler(req(`https://x/functions/v1/tool-report?id=${sampleId}`));
let raw = await r.text();
let out = JSON.parse(raw);
ok('tool-report: locked report returns the teaser', r.status === 200 && out.report.unlocked === false && out.report.findings.length === 2);
ok('tool-report: locked response never carries the hidden findings or tables', !raw.includes(sample.findings.items[2].title) && !raw.includes('Core Web Vitals') && !raw.includes('raw_results'));
ok('tool-report: CORS echoes the tools origin, never "*"', r.headers.get('access-control-allow-origin') === 'https://tools.davisdigitalstudio.com');
r = await reportHandler(new Request(`https://x/functions/v1/tool-report?id=${sampleId}`, { headers: { origin: 'https://evil.example' } }));
ok('tool-report: a foreign origin is not echoed', r.headers.get('access-control-allow-origin') === 'https://davisdigitalstudio.com');

// ── unlock-report ──
r = await unlockHandler(post('unlock-report', { report_id: sampleId, email: 'nope' }));
ok('unlock: invalid email is a 400 with a plain message', r.status === 400 && /valid email/.test((await r.json()).message));
fake.state.emails.length = 0;
r = await unlockHandler(post('unlock-report', { report_id: sampleId, email: 'Pat@Example.com', name: 'Pat', consent_marketing: true }));
out = await r.json();
await pendingFollowUps();
const stored = fake.state.tables.tool_reports.find((x) => x.id === sampleId);
const lead = fake.state.tables.tool_leads[0];
ok('unlock: responds with the full report', r.status === 200 && out.ok && out.report.unlocked && out.report.findings.length === 5 && out.report.tables.length === 2);
ok('unlock: report row is marked unlocked and linked to the lead', stored.unlocked === true && !!stored.unlocked_at && stored.lead_id === lead?.id);
ok('unlock: lead row has the email (lowercased), name, consent and business details', lead.email === 'pat@example.com' && lead.name === 'Pat' && lead.consent_marketing === true && lead.source_tool === 'site_review' && lead.business_name === 'Cedar & Core' && lead.city === 'Burbank');
const mirror = fake.state.tables.audit_leads[0];
ok('unlock: lead is mirrored into audit_leads for the Studio OS pipeline', mirror?.client_email === 'pat@example.com' && mirror.source === 'free_tools' && mirror.score === 64 && lead.audit_lead_id === mirror.id);
const visitorMail = fake.state.emails.find((e) => e.to[0] === 'pat@example.com');
ok('unlock: visitor gets "Your report is ready" with the report link and one-click unsubscribe', out.email_queued === true && visitorMail?.subject === 'Your Site Review is ready' && visitorMail.html.includes(`/report/${sampleId}`) && !!visitorMail.headers['List-Unsubscribe'] && visitorMail.from === 'Eric Davis <eric@davisdigitalstudio.com>');
const alertMail = fake.state.emails.find((e) => e.to[0] === 'eric@davisdigitalstudio.com');
const att = visitorMail?.attachments?.[0];
const pdfText = att ? atob(att.content) : '';
ok('unlock: the full report is attached as a PDF named after the business', !!att && att.filename === 'Cedar-Core-Site-Review.pdf' && pdfText.startsWith('%PDF-1.4') && pdfText.trimEnd().endsWith('%%EOF') && /A PDF copy is attached/.test(visitorMail.html));
ok('unlock: the attached PDF carries every finding and the Calendly link', ['The homepage takes almost 5 seconds', 'Burbank doesn', 'No business details for Google', 'calendly.com/eric-davisdigitalstudio/30min'].every((t) => pdfText.includes(t)));
const xrefAt = Number(/startxref\n(\d+)/.exec(pdfText)?.[1]);
ok('pdf: the cross-reference table is where the file says it is (valid structure)', pdfText.slice(xrefAt, xrefAt + 4) === 'xref');
ok('unlock: Eric gets the lead alert with the report link, reply-to the visitor', alertMail?.subject === 'New lead: Cedar & Core ran Site Review' && alertMail.html.includes(`/report/${sampleId}`) && alertMail.reply_to === 'pat@example.com');
ok('unlock: logged in the usage log', fake.state.tables.tool_usage_log.some((u) => u.kind === 'unlock' && u.report_id === sampleId));

const before = fake.state.emails.length;
r = await unlockHandler(post('unlock-report', { report_id: sampleId, email: 'someone@else.com' }));
out = await r.json();
ok('unlock: an already-unlocked report just returns, no second lead or email', out.already_unlocked === true && fake.state.emails.length === before && fake.state.tables.tool_leads.length === 1);

// 2 runs per email per tool per week: third unlock with the same email is refused.
const ip = '198.51.100.7';
const a = seed({ ...sample, id: crypto.randomUUID() }), b = seed({ ...sample, id: crypto.randomUUID() }), c = seed({ ...sample, id: crypto.randomUUID() });
const r1 = await unlockHandler(post('unlock-report', { report_id: a, email: 'repeat@example.com' }, ip));
const r2 = await unlockHandler(post('unlock-report', { report_id: b, email: 'repeat@example.com' }, ip));
const r3 = await unlockHandler(post('unlock-report', { report_id: c, email: 'repeat@example.com' }, ip));
ok('limit: 2 unlocks per email per tool per week, the third is a 429 with a call link', r1.status === 200 && r2.status === 200 && r3.status === 429 && !!(await r3.json()).calendly);
const aiId = seed({ ...aiSample, id: crypto.randomUUID() });
const r4 = await unlockHandler(post('unlock-report', { report_id: aiId, email: 'repeat@example.com' }, ip));
ok('limit: the weekly email cap is per tool (AI Visibility still allowed)', r4.status === 200);

fake.state.failResend = true;
const d = seed({ ...sample, id: crypto.randomUUID() });
r = await unlockHandler(post('unlock-report', { report_id: d, email: 'resend-down@example.com' }));
out = await r.json();
await pendingFollowUps();
fake.state.failResend = false;
ok('unlock: if email sending fails the visitor still sees the full report', r.status === 200 && out.report.unlocked);
ok('unlock: a failed send is recorded in the usage log', fake.state.tables.tool_usage_log.some((u) => u.kind === 'unlock' && u.report_id === d && /emailed=false/.test(u.note)));

// Speed: the page gets its answer before a slow email finishes.
fake.state.resendDelayMs = 400;
const slow = seed({ ...sample, id: crypto.randomUUID() });
const sentBefore = fake.state.emails.length;
const t0 = Date.now();
r = await unlockHandler(post('unlock-report', { report_id: slow, email: 'slow@example.com' }));
const answeredMs = Date.now() - t0;
const sentAtAnswer = fake.state.emails.length - sentBefore;
await pendingFollowUps();
fake.state.resendDelayMs = 0;
ok('unlock: answers before the emails go out (slow send does not hold the page)', r.status === 200 && answeredMs < 300 && sentAtAnswer === 0 && fake.state.emails.length - sentBefore === 2, `answered in ${answeredMs}ms with ${sentAtAnswer} sent`);

// On Supabase the follow-up is handed to EdgeRuntime.waitUntil.
const handed = [];
globalThis.EdgeRuntime = { waitUntil: (p) => handed.push(p) };
const viaRt = seed({ ...sample, id: crypto.randomUUID() });
r = await unlockHandler(post('unlock-report', { report_id: viaRt, email: 'runtime@example.com' }));
await Promise.all(handed);
delete globalThis.EdgeRuntime;
ok('unlock: uses EdgeRuntime.waitUntil when Supabase provides it', r.status === 200 && handed.length === 1 && fake.state.emails.some((e) => e.to[0] === 'runtime@example.com'));

await pendingFollowUps();

// ── send-lead-alert is internal only ──
r = await alertHandler(new Request('https://x/functions/v1/send-lead-alert', { method: 'POST', body: JSON.stringify({ report_id: sampleId }) }));
ok('lead alert: no service key is a 401', r.status === 401);
r = await alertHandler(new Request('https://x/functions/v1/send-lead-alert', { method: 'POST', headers: { Authorization: 'Bearer wrong' }, body: JSON.stringify({ report_id: sampleId }) }));
ok('lead alert: a wrong key is a 401', r.status === 401);

// ── the scan gate (used by site-review and ai-visibility in Phases 2-3) ──
const scanReq = (ipAddr) => req('https://x/functions/v1/site-review', { method: 'POST', body: '{}' }, ipAddr);
let g = await beginScan(scanReq('192.0.2.1'), { tool: 'site_review', turnstileToken: 'bad-token', input: { url: 'gate.example' } });
ok('gate: a failed Turnstile check is a 403', !g.ok && g.response.status === 403);
g = await beginScan(scanReq('192.0.2.1'), { tool: 'site_review', turnstileToken: '', input: { url: 'gate.example' } });
ok('gate: a missing Turnstile token is a 403', !g.ok && g.response.status === 403);
const gates = [];
for (let i = 0; i < 4; i++) gates.push(await beginScan(scanReq('192.0.2.2'), { tool: 'site_review', turnstileToken: 'good-token', input: { url: `gate${i}.example` } }));
ok('gate: 3 scans per IP per hour, the 4th is a 429', gates.slice(0, 3).every((x) => x.ok) && !gates[3].ok && gates[3].response.status === 429);

const scanned = seed({ ...sample, id: crypto.randomUUID(), unlocked: true });
await finishScan({ tool: 'site_review', ipHash: 'h', cacheKey: 'cached.example', reportId: scanned, costUsd: 0.02 });
g = await beginScan(scanReq('192.0.2.3'), { tool: 'site_review', turnstileToken: 'good-token', input: { url: 'https://www.cached.example/' } });
ok('gate: a cache hit returns a fresh LOCKED copy, not the original report', g.ok && g.cachedReport && g.cachedReport.id !== scanned && g.cachedReport.unlocked === false && g.cachedReport.cached_from === scanned);
ok('gate: finishScan logged the scan cost', fake.state.tables.tool_usage_log.some((u) => u.kind === 'scan' && u.report_id === scanned && u.cost_usd === 0.02));

fake.state.spend = 10;
g = await beginScan(scanReq('192.0.2.4'), { tool: 'site_review', turnstileToken: 'good-token', input: { url: 'new.example' } });
const resting = g.ok ? null : await g.response.json();
ok('gate: at the $10 daily cap new scans stop with the "resting" message', !g.ok && g.response.status === 503 && resting.message === "The tools are resting for today. Book a call and I'll run it by hand.");
g = await beginScan(scanReq('192.0.2.5'), { tool: 'site_review', turnstileToken: 'good-token', input: { url: 'cached.example' } });
ok('gate: cached reports still serve when the cap is hit (they cost nothing)', g.ok && !!g.cachedReport);
fake.state.spend = 0;

// ── structural ──
const pageJs = read('tool-report.js');
const { pdfString, wrap, textWidth } = await import('../../supabase/functions/_shared/tools/pdf.ts');
ok('pdf: parentheses and backslashes escaped; curly quotes and dashes in WinAnsi; emoji safe', pdfString('a (b) \\ c') === 'a \\(b\\) \\\\ c' && pdfString('\u2019\u2014') === '\\222\\227' && pdfString('\u{1F600}') === '?');
ok('pdf: wrapping keeps every line inside the width, long words broken', wrap('word '.repeat(60), 'F1', 10, 200).every((l) => textWidth(l, 'F1', 10) <= 200) && wrap('x'.repeat(300), 'F1', 10, 100).length > 2);
ok('report page: never uses innerHTML (report text is untrusted)', !/innerHTML/.test(pageJs));
ok('report page: fires the spec GA4 events', ['report_viewed', 'email_captured', 'calendly_clicked', 'pdf_downloaded'].every((e) => pageJs.includes(`'${e}'`)));
ok('report page: noindex and print stylesheet', /noindex/.test(read('report.html')) && /@media print/.test(read('tool-report.css')));
ok('redirects: /report/<id> serves report.html', /^\/report\/\*\s+\/report\.html\s+200$/m.test(read('_redirects')));
const deploy = read('.github/workflows/deploy.yml');
ok('deploy: all three functions ship to production', ['tool-report', 'unlock-report', 'send-lead-alert'].every((f) => deploy.includes(`functions deploy ${f} --no-verify-jwt --project-ref \${{ secrets.SUPABASE_PROJECT_REF_PROD }}`)));
const mig = read('supabase/migrations/0136_free_tools.sql');
ok('migration: RLS on every tool_* table, anon/authenticated revoked', ['tool_leads', 'tool_reports', 'tool_scan_cache', 'tool_usage_log'].every((tb) => mig.includes(`alter table public.${tb}`) && mig.includes('enable row level security')) && /revoke all on public\.tool_leads.*from anon, authenticated/.test(mig));

const passed = results.filter((x) => x.p).length;
console.log(`\n════ FREE TOOLS PHASE 1 FOUNDATION: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
