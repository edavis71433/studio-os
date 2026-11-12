// ── Builder list item 182: AI answers over time ──
//   deno run --allow-read --allow-env tests/presence/ai_watch_test.mjs
// Each client keeps up to ten questions (the AI check's seven to start); the studio
// switches the monthly check on per client, because it costs money; the job runs one
// check per tick, claims the month first, stops at the spend cap, tries a failed check
// again three times at most, and keeps each month's answers for the chart and for
// "what Claude said". Claude, Google and the database are all scripted here.
for (const [k, v] of Object.entries({ SUPABASE_URL: 'http://stub.local', SERVICE_ROLE_KEY: 'SERVICE-KEY', SUPABASE_ANON_KEY: 'ANON-KEY', ANTHROPIC_KEY: 'sk-test', DAILY_SPEND_CAP_USD: '10' })) Deno.env.set(k, v);

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}${note ? ' — ' + note : ''}`); };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const P = '../../supabase/functions/presence';
const W = await import(`${P}/lib/ai_watch.ts`);
const read = (p) => Deno.readTextFileSync(new URL(p, import.meta.url));

// ── 1. the questions ──
{
  const n = W.normalizeQuestions({ questions: [{ text: ' Who is a good realtor in Burbank? ' }, { text: 'who is a good realtor in burbank?' }, ...Array.from({ length: 12 }, (_, i) => ({ text: `Q${i}` }))] });
  eq('questions: each once (any case), ten at most', [n.questions.length, n.questions[0].text], [10, 'Who is a good realtor in Burbank?']);
  const cur = { questions: [{ text: 'Who is a good realtor in Burbank?', added_at: '2026-10-01T00:00:00Z', added_by: 'a@x' }] };
  const r = W.applyQuestions(cur, ['who is a good REALTOR in burbank?', 'How do I sell my house fast in Burbank?'], 'b@x', '2026-11-11T00:00:00Z');
  eq('questions: keeps when each was added, takes the new spelling', [r.questions[0].added_at, r.questions[0].text, r.questions[1].added_by], ['2026-10-01T00:00:00Z', 'who is a good REALTOR in burbank?', 'b@x']);
  ok('questions: none, eleven, or not a list are refused in words', 'error' in W.applyQuestions(cur, [], null, '') && 'error' in W.applyQuestions(cur, Array.from({ length: 11 }, (_, i) => `q${i}`), null, '') && 'error' in W.applyQuestions(cur, 'x', null, ''));
  eq('questions: capped at 200 characters', W.normalizeQuestions({ questions: [{ text: 'x'.repeat(300) }] }).questions[0].text.length, 200);
  eq('kind: a question naming the business tests what Claude knows', [W.questionKind('Is Maple & Main Realty well reviewed?', 'Maple & Main Realty'), W.questionKind('Who is a good realtor in Burbank?', 'Maple & Main Realty')], ['branded', 'unbranded']);
  const d = W.defaultQuestions({ businessName: 'Maple & Main Realty', city: 'Burbank, CA', businessType: 'other' });
  ok('defaults: the AI check’s own seven, with the town and the name', d.length === 7 && d.every((q) => /Burbank/.test(q)) && d.filter((q) => /Maple & Main Realty/.test(q)).length === 2);
  eq('defaults: without a name or a town there is nothing to ask', W.defaultQuestions({ businessName: '', city: 'Burbank', businessType: 'other' }), []);
  eq('prompts: numbered, with their kind', W.asPrompts(['Who is good?', 'Is Maple & Main Realty good?'], 'Maple & Main Realty').map((p) => [p.id, p.kind]), [['q1', 'unbranded'], ['q2', 'branded']]);
  eq('cost: in words', [W.costWords(10), W.costWords(1), W.costWords(20)], ['About 60 cents a month for 10 questions', 'About 6 cents a month for 1 question', 'About $1.20 a month for 20 questions']);
  ok('due: on, and this month not handled yet', W.aiDueNow({ ai_checks: true, ai_month: '2026-10' }, '2026-11-11T00:00:00Z') && !W.aiDueNow({ ai_checks: true, ai_month: '2026-11' }, '2026-11-11T00:00:00Z') && !W.aiDueNow({ ai_checks: false, ai_month: null }, '2026-11-11T00:00:00Z'));
}

// ── 2. reading one check’s answers ──
{
  const prompts = W.asPrompts(['Who is a good realtor in Burbank?', 'How do I sell my house fast in Burbank?'], 'Maple & Main Realty');
  const raw = {
    answers: [
      { engine: 'claude', prompt: 'q1', ok: true, text: '## Options\nSome say **Westside Homes**. Well-reviewed options include [Maple & Main Realty](https://maple.example) on Main Street, known for first-time buyers.' },
      { engine: 'claude', prompt: 'q2', ok: false, text: null },
    ],
    extractions: [{ engine: 'claude', prompt: 'q1', extraction: { targetFound: true, businesses: [{ name: 'Westside Homes' }, { name: 'Maple and Main Realty' }, { name: 'Valley Key Realty' }] } }],
  };
  const got = W.aiResults(raw, prompts, 'Maple & Main Realty', { claude: 'Claude' });
  eq('results: asked, named, by question', [got.asked, got.named, got.engines], [2, 1, ['claude']]);
  eq('results: a yes, with who else was named (not the business itself)', [got.results[0].answers[0].named, got.results[0].answers[0].others], [true, ['Westside Homes', 'Valley Key Realty']]);
  ok('results: what Claude said, from the sentence that names the business, without markdown', got.results[0].answers[0].excerpt.startsWith('…Well-reviewed options include Maple & Main Realty on Main Street') && !/[#*\[\]]/.test(got.results[0].answers[0].excerpt));
  eq('results: an answer that didn’t come back is neither yes nor no', [got.results[1].answers[0].named, got.results[1].answers[0].excerpt], [null, '']);
}

// ── 3. the job, against a scripted database and Claude ──
const SITE = '11111111-1111-4111-8111-111111111111';
let setting, questions, checks, reports, usage, spent, claimRaces, tableReady;
const reset = (s) => { setting = { body: JSON.stringify(s), updated_at: 't0' }; questions = null; checks = []; reports = []; usage = []; spent = 0; claimRaces = 0; tableReady = true; };
const reply = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
let claudeCalls = 0, claudeDown = false;
const named = new Set(['Who is a good realtor in Burbank?']);
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (u.hostname === 'api.anthropic.com') {
    claudeCalls++;
    const body = JSON.parse(init.body); const sys = String(body.system || '');
    const text = (o) => reply({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(o) }], usage: { input_tokens: 800, output_tokens: 200 } });
    if (body.tools) {
      if (claudeDown) return reply({ type: 'error', error: { message: 'overloaded' } }, 529);
      const q = body.messages[0].content;
      return reply({ stop_reason: 'end_turn', content: [{ type: 'text', text: named.has(q) ? 'Try Maple & Main Realty or Westside Homes.' : 'Try Westside Homes.', citations: [] }], usage: { input_tokens: 5000, output_tokens: 600, server_tool_use: { web_search_requests: 1 } } });
    }
    if (sys.startsWith('You read one answer')) {
      const q = /Question asked: (.*)\n/.exec(body.messages[0].content)[1];
      return text({ businesses_mentioned: named.has(q) ? [{ name: 'Maple & Main Realty', city: null }, { name: 'Westside Homes', city: null }] : [{ name: 'Westside Homes', city: null }], target_mentioned: named.has(q), target_description: '', knows_business: 'yes', described_correctly: true, accuracy_flags: [] });
    }
    return text({ summary: 'x', findings: [], top_three: [] });
  }
  if (u.hostname !== 'stub.local') return reply({}, 404);
  const table = u.pathname.replace('/rest/v1/', ''); const q = decodeURIComponent(u.search); const m = (init.method || 'GET').toUpperCase();
  if (table === 'presence_sales_templates') {
    if (q.includes('__ai_questions__')) return reply(questions ? [{ id: 'q', body: JSON.stringify(questions), updated_at: 'x' }] : []);
    if (m === 'POST' && JSON.parse(init.body).name === '__ai_questions__') { questions = JSON.parse(JSON.parse(init.body).body); return reply([{ id: 'q' }], 201); }
    if (m === 'PATCH' && u.searchParams.get('id') === 'eq.q') { questions = JSON.parse(JSON.parse(init.body).body); return reply([{ id: 'q' }]); }
    if (m === 'GET' && q.includes('select=site_id,body')) return reply([{ site_id: SITE, body: setting.body }]);
    if (m === 'GET') return reply([{ id: 'r1', body: setting.body, updated_at: setting.updated_at }]);
    if (m === 'PATCH') {
      if (claimRaces > 0) { claimRaces--; const s = JSON.parse(setting.body); setting = { body: JSON.stringify({ ...s, ai_month: '2026-11' }), updated_at: 'raced' }; return reply([]); }
      setting = { body: JSON.parse(init.body).body, updated_at: 't' + Math.random() }; return reply([{ id: 'r1' }]);
    }
    return reply([]);
  }
  if (table === 'presence_ai_checks') { if (!tableReady) return reply({ code: 'PGRST205' }, 404); if (m === 'POST') { checks.push(JSON.parse(init.body)); return reply(null, 201); } return reply(checks.slice().reverse()); }
  if (table === 'presence_sites') return reply([{ id: SITE, client_id: 'c', status: 'live', edition: 'presence', custom_domain: 'maple.example', last_published_at: '2026-06-01T00:00:00Z', netlify_site_id: 'n' }]);
  if (table === 'presence_identity') return reply([{ business_name: 'Maple & Main Realty' }]);
  if (table === 'presence_locations') return reply([{ city: 'Burbank', region: 'CA' }]);
  if (table === 'presence_settings') return reply([{ industry_key: 'realty' }]);
  if (table === 'tool_reports') { const row = { id: `rep-${reports.length + 1}`, ...JSON.parse(init.body) }; reports.push(row); return reply([row], 201); }
  if (table === 'tool_usage_log') { usage.push(JSON.parse(init.body)); return reply([{}], 201); }
  if (table === 'rpc/tool_spend_today') return reply(spent);
  return reply([]);
};
const { runAiChecks, afterAiFailure, aiCheckDeps } = await import(`${P}/ops/ai_checks.ts`);
aiCheckDeps.guard = async (raw) => new URL(raw);
aiCheckDeps.siteFetch = async () => new Response('<html><head><title>Maple</title></head><body>Maple & Main Realty</body></html>', { status: 200 });
const stored = () => JSON.parse(setting.body);
const NOV = '2026-11-11T09:00:00.000Z';
{
  reset({ enabled: false, ai_checks: false });
  eq('job: switched off, nothing is asked and nothing is paid for', [await runAiChecks(1, NOV), claudeCalls], [{ checked: 0, failed: 0, skipped: 1 }, 0]);
  reset({ enabled: false, ai_checks: true, ai_month: '2026-10' });
  questions = { questions: [{ text: 'Who is a good realtor in Burbank?' }, { text: 'How do I sell my house fast in Burbank?' }, { text: 'Is Maple & Main Realty well reviewed?' }] };
  const r = await runAiChecks(1, NOV);
  eq('job: one check, on the client’s own questions', [r.checked, checks.length, checks[0].asked, checks[0].named], [1, 1, 3, 1]);
  eq('job: kept for this month, with the assistant and the report', [checks[0].month, checks[0].engines, checks[0].report_id], ['2026-11', ['claude'], 'rep-1']);
  ok('job: each answer kept as yes or no with what Claude said', checks[0].results[0].answers[0].named === true && /Maple & Main Realty/.test(checks[0].results[0].answers[0].excerpt) && checks[0].results[1].answers[0].named === false);
  ok('job: saved as an ordinary AI Visibility report for the Search tab’s card, marked with the site', reports[0].tool === 'ai_visibility' && reports[0].unlocked === true && reports[0].input.site_id === SITE);
  ok('job: its cost is logged against the daily cap', usage.some((u) => u.kind === 'scan' && u.note === 'monthly AI check' && u.cost_usd > 0));
  eq('job: the month is handled, and said so', [stored().ai_month, stored().ai_result.status], ['2026-11', 'checked']);
  const calls = claudeCalls;
  eq('job: run again the same month, nothing more is paid for', [(await runAiChecks(1, NOV)).checked, claudeCalls], [0, calls]);
}
{
  reset({ ai_checks: true, ai_month: '2026-10' }); spent = 10;
  eq('job: the daily spend cap stops it before anything is asked', (await runAiChecks(1, NOV)).resting, true);
  reset({ ai_checks: true, ai_month: '2026-10' }); tableReady = false;
  eq('job: before migration 0172 nothing runs (nowhere to keep it)', (await runAiChecks(1, NOV)).not_ready, true);
  reset({ ai_checks: true, ai_month: '2026-10' }); claimRaces = 1;
  const before = claudeCalls;
  eq('job: another tick claimed the month first, so nothing is asked twice', [(await runAiChecks(1, NOV)).checked, claudeCalls], [0, before]);
}
{
  reset({ ai_checks: true, ai_month: '2026-10' }); claudeDown = true;
  const r = await runAiChecks(1, NOV);
  eq('job: a check that fails gives the month back, for a later tick', [r.failed, stored().ai_month, stored().ai_tries], [1, '2026-10', { month: '2026-11', count: 1 }]);
  claudeDown = false;
  const s = { ai_checks: true, ai_month: '2026-10', ai_tries: { month: '2026-11', count: 2 } };
  const third = afterAiFailure(s, '2026-11', '2026-10', 'engines_failed', NOV);
  eq('job: the third failure in a month is the last, and said', [third.ai_month, third.ai_result.status, third.ai_result.reason], ['2026-11', 'failed', 'engines_failed']);
}

// ── 4. the routes and the switch ──
{
  reset({ enabled: false, ai_checks: true, ai_month: '2026-10', ai_result: { month: '2026-10', status: 'checked', reason: null, at: 'x' } });
  checks = [{ month: '2026-10', checked_at: '2026-10-01T00:00:00Z', engines: ['claude'], asked: 7, named: 4, results: [] }, { month: '2026-11', checked_at: '2026-11-01T00:00:00Z', engines: ['claude'], asked: 7, named: 6, results: [{ q: 'Who?', kind: 'unbranded', answers: [{ engine: 'claude', name: 'Claude', named: true, excerpt: 'x', others: [] }] }] }];
  const A = await import(`${P}/routes/ai_answers.ts`);
  const site = { id: SITE, client_id: 'c', status: 'live', last_published_at: '2026-06-01T00:00:00Z', template_slug: 'x', template_version: '1', custom_domain: 'maple.example', netlify_site_id: 'n', edition: 'presence' };
  const g = (await (await A.handleAiGet(site, {})).json()).data;
  eq('get: the AI check’s seven until they change them', [g.defaults, g.questions.length, g.questions.filter((q) => q.kind === 'branded').length], [true, 7, 2]);
  eq('get: a point a month, oldest first', g.months.map((m) => [m.month, m.named]), [['2026-10', 4], ['2026-11', 6]]);
  eq('get: the latest check’s answers, with the assistant’s name', [g.latest.month, g.latest.engines, g.latest.results[0].answers[0].named], ['2026-11', [{ id: 'claude', name: 'Claude' }], true]);
  eq('get: the switch, when the next check is, and the cost in words', [g.watch.enabled, g.watch.next, g.watch.cost], [true, 'Dec 1', 'About 42 cents a month for 7 questions']);
  const put = await A.handleAiQuestionsPut(new Request('http://x', { method: 'PUT', body: JSON.stringify({ questions: ['Who is a good realtor in Burbank?', ''] }) }), site, { email: 'o@x' }, {});
  eq('put: saved, with the new cost', [put.status, (await put.json()).data.cost], [200, 'About 6 cents a month for 1 question']);
  const bad = await A.handleAiQuestionsPut(new Request('http://x', { method: 'PUT', body: JSON.stringify({ questions: [] }) }), site, { email: 'o@x' }, {});
  eq('put: none left is refused', bad.status, 400);
  const R = await import(`${P}/ops/monthly_report.ts`);
  const on = R.applyReportChange(R.normalizeReportSetting({}), { ai_checks: true }, 'o@x', NOV);
  ok('switch: the monthly report card turns the AI check on, and the first check is due at once', on.ai_checks === true && W.aiDueNow(on, NOV) && on.enabled === false);
  const src = { idx: read(`${P}/index.ts`), roles: read(`${P}/lib/site_roles.ts`), sys: read(`${P}/routes/system.ts`), report: read(`${P}/ops/monthly_report.ts`) };
  ok('routes: under /visibility; changing the questions is an edit, the switch stays configure', /route === '\/visibility\/ai' && method === 'GET'\) return handleAiGet\(site, cors\)/.test(src.idx) && /route === '\/visibility\/ai\/questions' && method === 'PUT'\)/.test(src.idx) && /'PUT \/visibility\/ai\/questions',/.test(src.roles));
  ok('report: PUT /report/monthly takes the switch', /typeof b\.ai_checks !== 'boolean'( && typeof b\.pdf !== 'boolean')?\) return json\(\{ error: 'bad_request'/.test(src.report));
  ok('scheduler: one check at most a tick, after everything else, in both tick lists', /\['ai_checks', \(\) => runAiChecks\(1\)\],[^\n]*\n\s+\],/.test(src.sys) && /reapSnapshots\(200\)\);[^\n]*\n\s+await step\('ai_checks', \(\) => runAiChecks\(1\)\);/.test(src.sys));
  for (const [name, sql] of [['migration', read('../../supabase/migrations/0172_ai_checks.sql')], ['pack', read('../../docs/presence/APPLY-0172-prod.sql')]]) {
    ok(`${name}: one row a site a month, closed to everyone but the function`, /create table if not exists public\.presence_ai_checks/.test(sql) && /primary key \(site_id, month\)/.test(sql) && /enable row level security/.test(sql) && /revoke all on public\.presence_ai_checks from anon, authenticated/.test(sql) && /references public\.tool_reports\(id\) on delete set null/.test(sql));
  }
}

const failed = results.filter((r) => !r.p).length;
console.log(`ai_watch: ${results.length - failed} passed, ${failed} failed`);
if (failed) Deno.exit(1);
