// ── P2-D-5 Client Reporting end-to-end (LIVE) ────────────────────────────────
//   deno run --allow-net --allow-env tests/presence/project_report_e2e_test.mjs
// The client report is composed from AUTHORITATIVE rows (no report store). This
// proves the numbers reflect real tasks/milestones/approvals/files. Requires
// 0075..0078 + operator JWT.
// Env: SALES_E2E_TARGET · SALES_E2E_ANON · SALES_E2E_JWT · SALES_E2E_SITE
const TARGET = Deno.env.get('SALES_E2E_TARGET');
const ANON = Deno.env.get('SALES_E2E_ANON');
const JWT = Deno.env.get('SALES_E2E_JWT');
if (!TARGET || !ANON || !JWT) { console.log('need SB integration creds — set SALES_E2E_TARGET/ANON/JWT to run (skipped)'); Deno.exit(0); }

const SITE = Deno.env.get('SALES_E2E_SITE') || '';
const H = () => ({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ANON, 'x-dds-user-jwt': JWT, 'x-dds-scope-site': SITE });
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
async function A(path, method, body) { const r = await fetch(TARGET + path, { method: method || 'GET', headers: H(), body: body ? JSON.stringify(body) : undefined }); let b = {}; try { b = await r.json(); } catch { /* */ } return { status: r.status, ok: r.ok, body: b }; }
const tag = 'rep-' + Date.now();

const proj = await A('/projects', 'POST', { name: `${tag} report` });
const projectId = proj.body?.data?.id;
ok('setup: project created', proj.status === 201 && projectId);

// two tasks: one done, one client-action + overdue
const t1 = await A(`/projects/${projectId}/tasks`, 'POST', { title: 'Build' });
await A(`/projects/${projectId}/tasks/${t1.body?.data?.id}`, 'PATCH', { status: 'in_progress' });
await A(`/projects/${projectId}/tasks/${t1.body?.data?.id}`, 'PATCH', { status: 'done' });
await A(`/projects/${projectId}/tasks`, 'POST', { title: 'Send your logo', client_action_required: true, due_date: '2020-01-01' });
// a milestone, completed
const m = await A(`/projects/${projectId}/milestones`, 'POST', { title: 'Design' });
await A(`/projects/${projectId}/milestones/${m.body?.data?.id}`, 'PATCH', { status: 'complete' });
// a pending approval
await A(`/projects/${projectId}/approvals`, 'POST', { subject_type: 'project', subject_id: projectId, title: 'Approve the plan' });

const rep = await A(`/projects/${projectId}/report`);
const s = rep.body?.data?.summary;
ok('report: composed summary returned', rep.ok && s && rep.body?.data?.generated_at);
ok('report: progress = 1 of 2 tasks done (50%)', s?.progress?.total === 2 && s?.progress?.done === 1 && s?.progress?.pct === 50);
ok('report: milestones = 1 of 1 complete', s?.milestones?.total === 1 && s?.milestones?.complete === 1);
ok('report: 1 open client action', s?.open_client_actions === 1);
ok('report: 1 overdue task', s?.overdue_tasks === 1);
ok('report: 1 pending approval', s?.pending_approvals === 1);
ok('report: last_activity_at is present', !!s?.last_activity_at);

const passed = results.filter((r) => r.p).length;
console.log(`\n════ P2-D-5 CLIENT REPORT E2E: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
