// ── P2-D Service Delivery end-to-end (Projects · Tasks · Milestones · Events) ─
//   deno run --allow-net --allow-env tests/presence/projects_e2e_test.mjs
// Runtime proof of the delivery foundation on live staging: a converted customer's
// project, milestones, tasks (internal vs client-visible), guarded status moves,
// activity history, progress roll-up, and the idempotent deal→project handoff.
// Requires migration 0075 applied + an operator JWT for a relationship workspace.
// Env: SALES_E2E_TARGET · SALES_E2E_ANON · SALES_E2E_JWT · SALES_E2E_SITE (blank for solo owner)
const TARGET = Deno.env.get('SALES_E2E_TARGET');
const ANON = Deno.env.get('SALES_E2E_ANON');
const JWT = Deno.env.get('SALES_E2E_JWT');
if (!TARGET || !ANON || !JWT) { console.log('need SB integration creds — set SALES_E2E_TARGET/ANON/JWT to run (skipped)'); Deno.exit(0); }

const SITE = Deno.env.get('SALES_E2E_SITE') || '';
const H = () => ({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ANON, 'x-dds-user-jwt': JWT, 'x-dds-scope-site': SITE });
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
async function call(path, method, body) {
  const r = await fetch(TARGET + path, { method: method || 'GET', headers: H(), body: body ? JSON.stringify(body) : undefined });
  let b = {}; try { b = await r.json(); } catch { /* */ }
  return { status: r.status, ok: r.ok, body: b };
}
const tag = 'proj-' + Date.now();

// ── project ──
const p = await call('/projects', 'POST', { name: `${tag} launch`, description: 'Website build + care', target_date: '2026-12-01' });
ok('project created (status=active)', p.status === 201 && p.body?.data?.id && p.body?.data?.status === 'active');
const projectId = p.body?.data?.id;
const badDate = await call('/projects', 'POST', { name: 'x', target_date: 'nope' });
ok('bad date rejected (422, not 502)', badDate.status === 422);

// ── milestone ──
const m = await call(`/projects/${projectId}/milestones`, 'POST', { title: 'Design approved', due_date: '2026-09-01' });
ok('milestone created', m.status === 201 && m.body?.data?.id);
const milestoneId = m.body?.data?.id;

// ── tasks: internal by default; a client-action task is explicitly visible ──
const t1 = await call(`/projects/${projectId}/tasks`, 'POST', { title: 'Internal: wireframes', milestone_id: milestoneId, priority: 'high' });
ok('task created, INTERNAL by default (client_visible=false)', t1.status === 201 && t1.body?.data?.client_visible === false);
const task1 = t1.body?.data?.id;
const t2 = await call(`/projects/${projectId}/tasks`, 'POST', { title: 'Send us your logo', client_action_required: true, due_date: '2026-07-01' });
ok('client-action task is client_visible + action-required + overdue-derived', t2.status === 201 && t2.body?.data?.client_visible === true && t2.body?.data?.client_action_required === true);
const task2 = t2.body?.data?.id;

// ── task transitions (guarded ladder) ──
const s1 = await call(`/projects/${projectId}/tasks/${task1}`, 'PATCH', { status: 'in_progress' });
ok('task todo→in_progress', s1.ok && s1.body?.data?.status === 'in_progress');
const s2 = await call(`/projects/${projectId}/tasks/${task1}`, 'PATCH', { status: 'done' });
ok('task in_progress→done (stamps completed_at)', s2.ok && s2.body?.data?.status === 'done' && !!s2.body?.data?.completed_at);
const blockJump = await call(`/projects/${projectId}/tasks/${task2}`, 'PATCH', { status: 'blocked' });
const badTaskMove = await call(`/projects/${projectId}/tasks/${task2}`, 'PATCH', { status: 'done' });
ok('task blocked→done refused (must unblock first, 409)', blockJump.ok && badTaskMove.status === 409);

// ── field patch (not a status change) ──
const fp = await call(`/projects/${projectId}/tasks/${task1}`, 'PATCH', { priority: 'low' });
ok('task field patch (priority) persists', fp.ok && fp.body?.data?.priority === 'low');

// ── milestone completion ──
const mc = await call(`/projects/${projectId}/milestones/${milestoneId}`, 'PATCH', { status: 'complete' });
ok('milestone completed (stamps completed_at)', mc.ok && mc.body?.data?.status === 'complete' && !!mc.body?.data?.completed_at);

// ── project status ladder ──
const ph = await call(`/projects/${projectId}/status`, 'POST', { to: 'on_hold' });
ok('project active→on_hold', ph.ok && ph.body?.data?.status === 'on_hold');
await call(`/projects/${projectId}/status`, 'POST', { to: 'active' });
const badProjMove = await call(`/projects/${projectId}/status`, 'POST', { to: 'active' }); // already active → no-op 200
ok('project status no-op returns 200 (idempotent)', badProjMove.ok);

// ── bundle: milestones + tasks (with derived) + events + progress ──
const detail = await call(`/projects/${projectId}`);
const d = detail.body?.data;
ok('bundle carries milestones + tasks + events + progress', detail.ok && Array.isArray(d?.milestones) && Array.isArray(d?.tasks) && Array.isArray(d?.events) && d?.progress);
ok('bundle: derived overdue is computed for the client-action task', (d?.tasks || []).some((x) => x.id === task2 && x.derived?.overdue === true));
ok('bundle: progress reflects 1 of 2 tasks done (50%)', d?.progress?.total === 2 && d?.progress?.done === 1 && d?.progress?.pct === 50);
const kinds = new Set((d?.events || []).map((e) => e.kind));
ok('activity history records the meaningful changes', kinds.has('project_created') && kinds.has('task_created') && kinds.has('task_status_change') && kinds.has('milestone_completed') && kinds.has('status_change'));

// ── list + pagination + filter ──
const list = await call('/projects?limit=1');
ok('projects list is bounded (limit echoed, ≤1)', list.ok && (list.body?.data || []).length <= 1 && list.body?.limit === 1);
const filtered = await call('/projects?status=active');
ok('projects filter by status=active includes it', filtered.ok && (filtered.body?.data || []).some((x) => x.id === projectId));

// ── idempotent convert→project handoff ──
const contact = await call('/sales/contacts', 'POST', { name: 'Handoff Co', email: `${tag}@example.com` });
const deal = await call('/sales/deals', 'POST', { title: `${tag} handoff deal`, contact_id: contact.body?.data?.id });
const dealId = deal.body?.data?.id;
const h1 = await call('/projects', 'POST', { deal_id: dealId });
ok('handoff: create-from-deal makes a project named after the deal', h1.status === 201 && h1.body?.data?.deal_id === dealId && h1.body?.data?.name?.includes(tag));
const h2 = await call('/projects', 'POST', { deal_id: dealId });
ok('handoff: idempotent — re-create returns the SAME project (no duplicate)', h2.ok && h2.body?.idempotent === true && h2.body?.data?.id === h1.body?.data?.id);

// ── a foreign id is not reachable ──
const foreign = await call('/projects/00000000-0000-4000-8000-000000000000');
ok('a non-existent/foreign project id is not reachable (404/400)', foreign.status === 404 || foreign.status === 400);

const passed = results.filter((r) => r.p).length;
console.log(`\n════ P2-D SERVICE DELIVERY E2E: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
