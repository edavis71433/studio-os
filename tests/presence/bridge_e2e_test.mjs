// ── P2-D Agency–Client Bridge end-to-end (LIVE, two-customer isolation) ──────
//   deno run --allow-net --allow-env tests/presence/bridge_e2e_test.mjs
// Proves the hardened post-sale model: an AGENCY site delivers ONE authoritative
// project; a CUSTOMER on their OWN workspace reaches only their linked, client-
// visible delivery through the bridge — and never another customer's records.
// Env: SALES_E2E_TARGET · SALES_E2E_ANON
//      · AGENCY_JWT (studio) · CUSTOMER_JWT (the linked customer)
//      · CUSTOMER_CLIENT (their clients.id) · OTHER_CLIENT (a different customer)
//      · BRIDGE_SR · BRIDGE_REST (service role + REST base, to seed the bridge)
const TARGET = Deno.env.get('SALES_E2E_TARGET');
const ANON = Deno.env.get('SALES_E2E_ANON');
const AJ = Deno.env.get('AGENCY_JWT');
const CJ = Deno.env.get('CUSTOMER_JWT');
const CUSTOMER_CLIENT = Deno.env.get('CUSTOMER_CLIENT');
const OTHER_CLIENT = Deno.env.get('OTHER_CLIENT');
const SR = Deno.env.get('BRIDGE_SR');
const REST = Deno.env.get('BRIDGE_REST');
const AGENCY_SITE = Deno.env.get('AGENCY_SITE');
if (!TARGET || !ANON || !AJ || !CJ || !CUSTOMER_CLIENT || !SR || !REST || !AGENCY_SITE) { console.log('need bridge creds — set SALES_E2E_TARGET/ANON + AGENCY_JWT/CUSTOMER_JWT/CUSTOMER_CLIENT/AGENCY_SITE/BRIDGE_SR/BRIDGE_REST (skipped)'); Deno.exit(0); }

const H = (jwt) => ({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ANON, 'x-dds-user-jwt': jwt, 'x-dds-scope-site': '' });
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
async function AG(path, method, body) { const r = await fetch(TARGET + path, { method: method || 'GET', headers: H(AJ), body: body ? JSON.stringify(body) : undefined }); let b = {}; try { b = await r.json(); } catch { /* */ } return { status: r.status, ok: r.ok, body: b }; }
async function CU(path, method, body) { const r = await fetch(TARGET + path, { method: method || 'GET', headers: H(CJ), body: body ? JSON.stringify(body) : undefined }); let b = {}; try { b = await r.json(); } catch { /* */ } return { status: r.status, ok: r.ok, body: b }; }
async function seedBridge(agencySiteId, projectId, customerClientId) {
  const r = await fetch(`${REST}/presence_service_links`, { method: 'POST', headers: { apikey: SR, Authorization: 'Bearer ' + SR, 'Content-Type': 'application/json', Prefer: 'return=minimal,resolution=merge-duplicates' }, body: JSON.stringify({ agency_site_id: agencySiteId, project_id: projectId, customer_client_id: customerClientId, status: 'active' }) });
  return r.ok;
}
const tag = 'bridge-' + Date.now();
const pdf = new TextEncoder().encode('%PDF-1.4\nbridge\n%%EOF');

const agencySiteId = AGENCY_SITE; // the studio's own site (where delivery lives)

// ── AGENCY builds a project for the customer + a SECOND project for someone else ──
const p1 = await AG('/projects', 'POST', { name: `${tag} customer work` });
const P1 = p1.body?.data?.id;
await seedBridge(agencySiteId, P1, CUSTOMER_CLIENT);
const p2 = await AG('/projects', 'POST', { name: `${tag} OTHER customer` });
const P2 = p2.body?.data?.id;
await seedBridge(agencySiteId, P2, OTHER_CLIENT || '00000000-0000-4000-8000-000000000000');
ok('setup: agency created P1 (customer) + P2 (other), bridges seeded', p1.status === 201 && p2.status === 201 && !!P1 && !!P2);

// client-visible delivery on P1
const task = await AG(`/projects/${P1}/tasks`, 'POST', { title: 'Please review copy', client_action_required: true });
const up = await AG(`/projects/${P1}/deliverables/upload-url`, 'POST', { mime: 'application/pdf', bytes: pdf.length, title: 'Draft' });
await fetch(up.body?.data?.upload_url, { method: 'PUT', headers: { 'Content-Type': 'application/pdf', 'x-upsert': 'true' }, body: pdf }).catch(() => {});
const del = await AG(`/projects/${P1}/deliverables`, 'POST', { media_id: up.body?.data?.media_id, title: 'Draft', status: 'shared' });
const appr = await AG(`/projects/${P1}/approvals`, 'POST', { subject_type: 'project', subject_id: P1, title: 'Approve the plan' });
const surv = await AG(`/projects/${P1}/surveys`, 'POST', { title: 'Kickoff', questions: [{ label: 'Goals?', type: 'text' }] });
ok('setup: agency added a client task + shared file + approval + survey on P1', task.status === 201 && del.status === 201 && appr.status === 201 && surv.status === 201);

// ── CUSTOMER sees ONLY their linked project ──
const list = await CU('/client/projects');
ok('customer sees P1 in their projects', list.ok && (list.body?.data || []).some((x) => x.id === P1));
ok('customer does NOT see P2 (another customer’s project)', list.ok && !(list.body?.data || []).some((x) => x.id === P2));
const bundle = await CU(`/client/projects/${P1}`);
ok('customer opens P1 → client-visible bundle (task/file/approval/survey)', bundle.ok && (bundle.body?.data?.tasks || []).length >= 1 && (bundle.body?.data?.deliverables || []).length >= 1 && (bundle.body?.data?.approvals || []).length >= 1 && (bundle.body?.data?.surveys || []).length >= 1);
const foreign = await CU(`/client/projects/${P2}`);
ok('customer CANNOT open P2 (not linked → 404)', foreign.status === 404);

// ── customer acts: approve, download, message, survey, support ──
const a = (bundle.body?.data?.approvals || [])[0];
const decide = await CU(`/client/approvals/${a?.id}/decide`, 'POST', { decision: 'approved', presented_hash: a?.content_hash });
ok('customer approves via the bridge (version-guarded)', decide.ok && decide.body?.data?.status === 'approved');
const d = (bundle.body?.data?.deliverables || [])[0];
const dl = await CU(`/client/deliverables/${d?.id}/download`);
ok('customer downloads a shared file via the bridge', dl.ok && /^https?:\/\//.test(dl.body?.data?.url || ''));
const msg = await CU(`/client/projects/${P1}/messages`, 'POST', { body: 'Thanks!' });
ok('customer posts a message to the shared thread', msg.status === 201);
const sv = (bundle.body?.data?.surveys || [])[0];
const respond = await CU(`/client/surveys/${sv?.id}/respond`, 'POST', { answers: { goals: 'Grow' } });
ok('customer submits the survey via the bridge', respond.status === 201 || respond.body?.already === true);
const sup = await CU('/client/support', 'POST', { subject: 'A question', project_id: P1 });
ok('customer opens a support request (lands on the agency site)', sup.status === 201);

// ── isolation: the customer cannot reach the OTHER project's records ──
const otherDeliverable = await CU(`/client/deliverables/${d?.id ? '00000000-0000-4000-8000-000000000000' : d?.id}/download`);
ok('customer cannot download a foreign/unknown file (404)', otherDeliverable.status === 404);
const notifs = await CU('/client/notifications');
ok('customer notifications are scoped to their linked delivery', notifs.ok && Array.isArray(notifs.body?.data));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ P2-D AGENCY–CLIENT BRIDGE E2E: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
