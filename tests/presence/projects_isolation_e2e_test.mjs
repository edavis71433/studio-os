// ── P2-D Service Delivery tenant isolation (LIVE, two workspaces) ────────────
//   deno run --allow-net --allow-env tests/presence/projects_isolation_e2e_test.mjs
// Proves at RUNTIME that one workspace cannot read or mutate another's projects,
// tasks, or milestones. Requires migration 0075 + TWO operator JWTs (different
// workspaces). Skips here.
// Env: SALES_E2E_TARGET · SALES_E2E_ANON
//      · SALES_E2E_JWT  / SALES_E2E_SITE   (tenant A)
//      · SALES_E2E_JWT2 / SALES_E2E_SITE2  (tenant B — a DIFFERENT workspace)
const TARGET = Deno.env.get('SALES_E2E_TARGET');
const ANON = Deno.env.get('SALES_E2E_ANON');
const JWTA = Deno.env.get('SALES_E2E_JWT');
const JWTB = Deno.env.get('SALES_E2E_JWT2');
if (!TARGET || !ANON || !JWTA || !JWTB) { console.log('need SB integration creds — set SALES_E2E_TARGET/ANON/JWT/JWT2 (two tenants) to run (skipped)'); Deno.exit(0); }

const SITEA = Deno.env.get('SALES_E2E_SITE') || '';
const SITEB = Deno.env.get('SALES_E2E_SITE2') || '';
const H = (jwt, site) => ({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ANON, 'x-dds-user-jwt': jwt, 'x-dds-scope-site': site });
const results = [];
const ok = (n, p) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };
async function call(jwt, site, path, method, body) {
  const r = await fetch(TARGET + path, { method: method || 'GET', headers: H(jwt, site), body: body ? JSON.stringify(body) : undefined });
  let b = {}; try { b = await r.json(); } catch { /* */ }
  return { status: r.status, ok: r.ok, body: b };
}
const tag = 'projiso-' + Date.now();

// Tenant A builds a project + milestone + task.
const p = await call(JWTA, SITEA, '/projects', 'POST', { name: `${tag} A-project` });
const projectId = p.body?.data?.id;
const m = await call(JWTA, SITEA, `/projects/${projectId}/milestones`, 'POST', { title: 'A milestone' });
const t = await call(JWTA, SITEA, `/projects/${projectId}/tasks`, 'POST', { title: 'A task' });
const taskId = t.body?.data?.id;
ok('tenant A built its own project + milestone + task', p.status === 201 && m.status === 201 && t.status === 201 && projectId && taskId);

// Tenant B must NOT reach A's records by id.
const bReads = await call(JWTB, SITEB, `/projects/${projectId}`);
ok('B cannot READ A’s project by id (404)', bReads.status === 404);
const bPatch = await call(JWTB, SITEB, `/projects/${projectId}`, 'PATCH', { name: 'hijack' });
ok('B cannot UPDATE A’s project (404, no write)', bPatch.status === 404);
const bStatus = await call(JWTB, SITEB, `/projects/${projectId}/status`, 'POST', { to: 'archived' });
ok('B cannot change A’s project status (404)', bStatus.status === 404);
const bTask = await call(JWTB, SITEB, `/projects/${projectId}/tasks`, 'POST', { title: 'hijack task' });
ok('B cannot add a task to A’s project (404)', bTask.status === 404);
const bTaskPatch = await call(JWTB, SITEB, `/projects/${projectId}/tasks/${taskId}`, 'PATCH', { status: 'done' });
ok('B cannot mutate A’s task (404)', bTaskPatch.status === 404);
const bMilestone = await call(JWTB, SITEB, `/projects/${projectId}/milestones`, 'POST', { title: 'hijack ms' });
ok('B cannot add a milestone to A’s project (404)', bMilestone.status === 404);

// B's project list must not include A's project.
const bList = await call(JWTB, SITEB, `/projects?q=${tag}`);
ok('B’s project list does NOT contain A’s project', bList.ok && !(bList.body?.data || []).some((x) => x.id === projectId));

// Control: A can still read its own.
const aReads = await call(JWTA, SITEA, `/projects/${projectId}`);
ok('control: A can still read its own project + task', aReads.ok && aReads.body?.data?.project?.id === projectId && (aReads.body?.data?.tasks || []).some((x) => x.id === taskId));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ P2-D SERVICE DELIVERY TENANT ISOLATION (live): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
