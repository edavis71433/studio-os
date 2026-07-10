// ── P2-D-4 Surveys & Support end-to-end (LIVE) ───────────────────────────────
//   deno run --allow-net --allow-env tests/presence/service_intake_e2e_test.mjs
// Runtime proof on staging: a project survey (studio creates, submit is idempotent,
// studio reviews) and a support request (submit → reply → triage → resolve →
// reopen), both feeding the activity log; plus cross-tenant isolation. Requires
// 0075..0078 + operator JWT(s).
// Env: SALES_E2E_TARGET · SALES_E2E_ANON · SALES_E2E_JWT · SALES_E2E_SITE
//      · SALES_E2E_JWT2 / SALES_E2E_SITE2 (optional, isolation)
const TARGET = Deno.env.get('SALES_E2E_TARGET');
const ANON = Deno.env.get('SALES_E2E_ANON');
const JWT = Deno.env.get('SALES_E2E_JWT');
if (!TARGET || !ANON || !JWT) { console.log('need SB integration creds — set SALES_E2E_TARGET/ANON/JWT to run (skipped)'); Deno.exit(0); }

const SITE = Deno.env.get('SALES_E2E_SITE') || '';
const JWT2 = Deno.env.get('SALES_E2E_JWT2'); const SITE2 = Deno.env.get('SALES_E2E_SITE2') || '';
const H = (jwt, site) => ({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ANON, 'x-dds-user-jwt': jwt, 'x-dds-scope-site': site });
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
async function A(path, method, body) { const r = await fetch(TARGET + path, { method: method || 'GET', headers: H(JWT, SITE), body: body ? JSON.stringify(body) : undefined }); let b = {}; try { b = await r.json(); } catch { /* */ } return { status: r.status, ok: r.ok, body: b }; }
async function B(path, method, body) { const r = await fetch(TARGET + path, { method: method || 'GET', headers: H(JWT2, SITE2), body: body ? JSON.stringify(body) : undefined }); let b = {}; try { b = await r.json(); } catch { /* */ } return { status: r.status, ok: r.ok, body: b }; }
const tag = 'intake-' + Date.now();

const proj = await A('/projects', 'POST', { name: `${tag} intake` });
const projectId = proj.body?.data?.id;
ok('setup: project created', proj.status === 201 && projectId);

// ── surveys ──
const survey = await A(`/projects/${projectId}/surveys`, 'POST', { title: 'How was your launch?', questions: [{ label: 'Overall rating', type: 'rating' }, { label: 'What could be better?' }] });
ok('survey: studio creates a survey (active, stable questions)', survey.status === 201 && survey.body?.data?.status === 'active' && (survey.body?.data?.questions || []).length === 2);
const surveyId = survey.body?.data?.id;
const badQ = await A(`/projects/${projectId}/surveys`, 'POST', { title: 'x', questions: [] });
ok('survey: an empty question set is refused (422)', badQ.status === 422);
const respond = await A(`/surveys/${surveyId}/respond`, 'POST', { answers: { overall_rating: '5', what_could_be_better: 'Nothing!' } });
ok('survey: a response is submitted', respond.status === 201 && respond.body?.data?.status === 'submitted');
const rerespond = await A(`/surveys/${surveyId}/respond`, 'POST', { answers: { overall_rating: '3' } });
ok('survey: re-submission is idempotent (one submission per respondent)', rerespond.ok && rerespond.body?.already === true);
const review = await A(`/surveys/${surveyId}`);
ok('survey: studio reviews responses', review.ok && (review.body?.data?.responses || []).length >= 1 && review.body?.data?.responses[0].answers?.overall_rating === '5');

// ── support ──
const sup = await A('/support', 'POST', { subject: 'Login not working', body: 'I cannot sign in', project_id: projectId, priority: 'high' });
ok('support: a request is opened', sup.status === 201 && sup.body?.data?.status === 'open' && sup.body?.data?.priority === 'high');
const reqId = sup.body?.data?.id;
const reply = await A(`/support/${reqId}/messages`, 'POST', { body: 'Thanks — looking into it now.' });
ok('support: a reply is posted (and bumps open→in_progress)', reply.status === 201);
const afterReply = await A(`/support/${reqId}`);
ok('support: detail carries the message history + in_progress', afterReply.ok && (afterReply.body?.data?.messages || []).length >= 1 && afterReply.body?.data?.request?.status === 'in_progress');
const resolve = await A(`/support/${reqId}`, 'PATCH', { status: 'resolved', resolution: 'Reset the password' });
ok('support: studio resolves the request (records resolution + resolved_at)', resolve.ok && resolve.body?.data?.status === 'resolved' && !!resolve.body?.data?.resolved_at);
const reopen = await A(`/support/${reqId}`, 'PATCH', { status: 'open' });
ok('support: a resolved request can be reopened', reopen.ok && reopen.body?.data?.status === 'open' && !reopen.body?.data?.resolved_at);
const list = await A('/support?status=open');
ok('support: list filters by status', list.ok && (list.body?.data || []).some((x) => x.id === reqId));

// ── activity: survey + support events flow into notifications ──
const notifs = await A('/notifications?limit=50');
const kinds = new Set((notifs.body?.data || []).map((n) => n.kind));
ok('activity: survey + support events reach notifications', kinds.has('survey_requested') && kinds.has('support_opened') && kinds.has('support_resolved'));
ok('activity: a support notification deep-links to /support', (notifs.body?.data || []).some((n) => typeof n.href === 'string' && n.href.startsWith('/support')));

// ── tenant isolation ──
if (JWT2) {
  const bSurvey = await B(`/surveys/${surveyId}`);
  ok('B cannot read A’s survey (404)', bSurvey.status === 404);
  const bRespond = await B(`/surveys/${surveyId}/respond`, 'POST', { answers: { overall_rating: '1' } });
  ok('B cannot respond to A’s survey (404)', bRespond.status === 404);
  const bSupport = await B(`/support/${reqId}`);
  ok('B cannot read A’s support request (404)', bSupport.status === 404);
  const bPatch = await B(`/support/${reqId}`, 'PATCH', { status: 'closed' });
  ok('B cannot triage A’s support request (404)', bPatch.status === 404);
} else {
  console.log('SKIP  tenant isolation — set SALES_E2E_JWT2 to run');
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ P2-D-4 SURVEYS & SUPPORT E2E: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
