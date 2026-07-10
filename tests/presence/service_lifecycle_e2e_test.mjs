// ── P2-D FULL service lifecycle end-to-end (the 16-step gate) ────────────────
//   deno run --allow-net --allow-env tests/presence/service_lifecycle_e2e_test.mjs
// ONE continuous walk through the whole post-sale service workflow, exactly as the
// milestone requires: converted customer → project → tasks/milestones → file →
// messages → internal-hidden → survey → approval(version) → decide → notifications
// → support → resolve → reporting → idempotency → cross-tenant isolation.
// Requires 0075..0078 + TWO operator JWTs.
// Env: SALES_E2E_TARGET · SALES_E2E_ANON · SALES_E2E_JWT · SALES_E2E_SITE
//      · SALES_E2E_JWT2 / SALES_E2E_SITE2
const TARGET = Deno.env.get('SALES_E2E_TARGET');
const ANON = Deno.env.get('SALES_E2E_ANON');
const JWT = Deno.env.get('SALES_E2E_JWT');
const JWT2 = Deno.env.get('SALES_E2E_JWT2');
if (!TARGET || !ANON || !JWT) { console.log('need SB integration creds — set SALES_E2E_TARGET/ANON/JWT (+JWT2) to run (skipped)'); Deno.exit(0); }

const SITE = Deno.env.get('SALES_E2E_SITE') || '';
const SITE2 = Deno.env.get('SALES_E2E_SITE2') || '';
const H = (jwt, site) => ({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ANON, 'x-dds-user-jwt': jwt, 'x-dds-scope-site': site });
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
async function A(path, method, body) { const r = await fetch(TARGET + path, { method: method || 'GET', headers: H(JWT, SITE), body: body ? JSON.stringify(body) : undefined }); let b = {}; try { b = await r.json(); } catch { /* */ } return { status: r.status, ok: r.ok, body: b }; }
async function B(path, method, body) { const r = await fetch(TARGET + path, { method: method || 'GET', headers: H(JWT2, SITE2), body: body ? JSON.stringify(body) : undefined }); let b = {}; try { b = await r.json(); } catch { /* */ } return { status: r.status, ok: r.ok, body: b }; }
const tag = 'life-' + Date.now();
const pdf = new TextEncoder().encode('%PDF-1.4\nlifecycle\n%%EOF');

// 1) a converted customer has a project (deal → idempotent handoff)
const contact = await A('/sales/contacts', 'POST', { name: 'Lifecycle Co', email: `${tag}@example.com` });
const deal = await A('/sales/deals', 'POST', { title: `${tag} engagement`, contact_id: contact.body?.data?.id });
const proj = await A('/projects', 'POST', { deal_id: deal.body?.data?.id });
const projectId = proj.body?.data?.id;
ok('1. a converted deal has a project (handoff)', proj.status === 201 && projectId && proj.body?.data?.deal_id === deal.body?.data?.id);

// 2) studio assigns tasks + milestones
const ms = await A(`/projects/${projectId}/milestones`, 'POST', { title: 'Launch' });
const internalTask = await A(`/projects/${projectId}/tasks`, 'POST', { title: 'Internal QA', milestone_id: ms.body?.data?.id });
const clientTask = await A(`/projects/${projectId}/tasks`, 'POST', { title: 'Approve copy', client_action_required: true });
ok('2. studio assigns milestones + tasks', ms.status === 201 && internalTask.status === 201 && clientTask.status === 201);

// 3) client-visible separation is explicit (internal task stays internal)
ok('3. an internal task is client_visible=false; a client-action task is shared', internalTask.body?.data?.client_visible === false && clientTask.body?.data?.client_visible === true);

// 4) studio uploads + shares a client-visible file
const up = await A(`/projects/${projectId}/deliverables/upload-url`, 'POST', { mime: 'application/pdf', bytes: pdf.length, title: 'Handoff.pdf' });
await fetch(up.body?.data?.upload_url, { method: 'PUT', headers: { 'Content-Type': 'application/pdf', 'x-upsert': 'true' }, body: pdf }).catch(() => {});
const deliverable = await A(`/projects/${projectId}/deliverables`, 'POST', { media_id: up.body?.data?.media_id, title: 'Handoff', status: 'shared' });
ok('4. studio uploads + shares a client-visible file', deliverable.status === 201 && deliverable.body?.data?.status === 'shared');

// 5) the file is accessible via a signed URL
const dl = await A(`/projects/${projectId}/deliverables/${deliverable.body?.data?.id}/download`);
ok('5. the shared file is accessible (signed URL)', dl.ok && /^https?:\/\//.test(dl.body?.data?.url || ''));

// 6) studio + client exchange messages (client thread)
const clientMsg = await A(`/projects/${projectId}/messages`, 'POST', { audience: 'client', body: 'Welcome aboard!' });
ok('6. a client-visible message is posted to the shared thread', clientMsg.status === 201 && clientMsg.body?.data?.audience === 'client');

// 7) internal notes remain hidden (audience internal)
const internalMsg = await A(`/projects/${projectId}/messages`, 'POST', { audience: 'internal', body: 'Client is price-sensitive' });
ok('7. an internal note is audience=internal (hidden from the client filter)', internalMsg.status === 201 && internalMsg.body?.data?.audience === 'internal');

// 8) client completes a survey
const survey = await A(`/projects/${projectId}/surveys`, 'POST', { title: 'Kickoff survey', questions: [{ label: 'Goals?', type: 'text' }] });
const respond = await A(`/surveys/${survey.body?.data?.id}/respond`, 'POST', { answers: { goals: 'More leads' } });
ok('8. a survey is created + a response submitted', survey.status === 201 && respond.status === 201);

// 9) studio requests approval on a specific version (deliverable content_hash)
const appr = await A(`/projects/${projectId}/approvals`, 'POST', { subject_type: 'deliverable', subject_id: deliverable.body?.data?.id, title: 'Approve the handoff' });
ok('9. approval requested, bound to the deliverable version (content_hash)', appr.status === 201 && /^[0-9a-f]{64}$/.test(appr.body?.data?.content_hash || ''));

// 10) approve it (version-guarded)
const decide = await A(`/approvals/${appr.body?.data?.id}/decide`, 'POST', { decision: 'approved', presented_hash: appr.body?.data?.content_hash });
ok('10. the approval is decided (approved)', decide.ok && decide.body?.data?.status === 'approved');

// 11) notifications deep-link to the correct source
const notifs = await A('/notifications?limit=50');
const hasDeepLinks = (notifs.body?.data || []).some((n) => typeof n.href === 'string' && n.href.includes(`/projects/${projectId}`)) && (notifs.body?.data || []).some((n) => n.kind === 'approval_decided');
ok('11. notifications derive from activity + deep-link to the source', notifs.ok && hasDeepLinks);

// 12) client submits a support request
const support = await A('/support', 'POST', { subject: 'Question about hosting', body: 'Where is my site hosted?', project_id: projectId });
const supportId = support.body?.data?.id;
ok('12. a support request is opened', support.status === 201 && support.body?.data?.status === 'open');

// 13) studio resolves it
await A(`/support/${supportId}/messages`, 'POST', { body: 'Netlify — details inside.' });
const resolve = await A(`/support/${supportId}`, 'PATCH', { status: 'resolved', resolution: 'Explained hosting' });
ok('13. studio resolves the support request', resolve.ok && resolve.body?.data?.status === 'resolved');

// 14) client reporting reflects the authoritative activity
const report = await A(`/projects/${projectId}/report`);
const s = report.body?.data?.summary;
ok('14. reporting reflects authoritative data (tasks, milestone, files, approvals)', report.ok && s?.progress?.total === 2 && s?.milestones?.total === 1 && s?.shared_files === 1 && s?.open_client_actions === 1);

// 15) retried actions do not create duplicates
const reproj = await A('/projects', 'POST', { deal_id: deal.body?.data?.id });
const reresp = await A(`/surveys/${survey.body?.data?.id}/respond`, 'POST', { answers: { goals: 'changed' } });
const redecide = await A(`/approvals/${appr.body?.data?.id}/decide`, 'POST', { decision: 'approved', presented_hash: appr.body?.data?.content_hash });
ok('15. retries are idempotent (project handoff, survey submit, approval decide)', reproj.body?.data?.id === projectId && reproj.body?.idempotent === true && reresp.body?.already === true && redecide.body?.already === true);

// 16) a second tenant cannot read or mutate ANY record in the workflow
if (JWT2) {
  const checks = await Promise.all([
    B(`/projects/${projectId}`), B(`/projects/${projectId}/report`),
    B(`/projects/${projectId}/deliverables/${deliverable.body?.data?.id}/download`),
    B(`/approvals/${appr.body?.data?.id}/decide`, 'POST', { decision: 'rejected', presented_hash: appr.body?.data?.content_hash }),
    B(`/surveys/${survey.body?.data?.id}`), B(`/support/${supportId}`),
    B(`/projects/${projectId}/messages`), B(`/projects/${projectId}/tasks`, 'POST', { title: 'x' }),
  ]);
  ok('16. a second tenant cannot read or mutate ANY record (all 404)', checks.every((c) => c.status === 404), checks.map((c) => c.status).join(','));
} else {
  console.log('SKIP  16. cross-tenant isolation — set SALES_E2E_JWT2 to run');
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ P2-D FULL SERVICE LIFECYCLE (16-step): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
