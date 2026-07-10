// ── P2-D-2 Deliverables & Approvals end-to-end (LIVE) ────────────────────────
//   deno run --allow-net --allow-env tests/presence/project_delivery_e2e_test.mjs
// Runtime proof on staging: upload a deliverable file (relationship-gated, reuses
// the media store), share it, download via signed URL, delete-protection; request
// an approval bound to the exact version, decide it (version-integrity + idempotent
// + supersede), and cross-tenant isolation. Requires 0075+0076 + operator JWT(s).
// Env: SALES_E2E_TARGET · SALES_E2E_ANON · SALES_E2E_JWT · SALES_E2E_SITE
//      · SALES_E2E_JWT2 / SALES_E2E_SITE2 (2nd tenant, for isolation — optional)
const TARGET = Deno.env.get('SALES_E2E_TARGET');
const ANON = Deno.env.get('SALES_E2E_ANON');
const JWT = Deno.env.get('SALES_E2E_JWT');
if (!TARGET || !ANON || !JWT) { console.log('need SB integration creds — set SALES_E2E_TARGET/ANON/JWT to run (skipped)'); Deno.exit(0); }

const SITE = Deno.env.get('SALES_E2E_SITE') || '';
const JWT2 = Deno.env.get('SALES_E2E_JWT2');
const SITE2 = Deno.env.get('SALES_E2E_SITE2') || '';
const H = (jwt, site) => ({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ANON, 'x-dds-user-jwt': jwt, 'x-dds-scope-site': site });
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
async function A(path, method, body) { const r = await fetch(TARGET + path, { method: method || 'GET', headers: H(JWT, SITE), body: body ? JSON.stringify(body) : undefined }); let b = {}; try { b = await r.json(); } catch { /* */ } return { status: r.status, ok: r.ok, body: b }; }
async function B(path, method, body) { const r = await fetch(TARGET + path, { method: method || 'GET', headers: H(JWT2, SITE2), body: body ? JSON.stringify(body) : undefined }); let b = {}; try { b = await r.json(); } catch { /* */ } return { status: r.status, ok: r.ok, body: b }; }
const tag = 'del-' + Date.now();

const proj = await A('/projects', 'POST', { name: `${tag} delivery` });
const projectId = proj.body?.data?.id;
ok('setup: project created', proj.status === 201 && projectId);

// ── deliverable: upload URL (reuses media store) → attach → bundle → download ──
const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const up = await A(`/projects/${projectId}/deliverables/upload-url`, 'POST', { mime: 'application/pdf', bytes: pdf.length, title: 'Proposal PDF' });
ok('deliverable: relationship-gated upload URL minted (reuses presence_media)', up.ok && !!up.body?.data?.media_id && !!up.body?.data?.upload_url);
const mediaId = up.body?.data?.media_id;
const storagePath = up.body?.data?.storage_path; // presence-media/{siteId}/{uuid}.pdf
// Seed the object bytes so signDownload has a real object to sign. Prefer the
// signed upload URL (the real client path); fall back to a service-role seed.
const SR = Deno.env.get('SALES_E2E_SR'); const STORAGE = Deno.env.get('SALES_E2E_STORAGE');
let putOk = false;
try { const r = await fetch(up.body?.data?.upload_url, { method: 'PUT', headers: { 'Content-Type': 'application/pdf', 'x-upsert': 'true' }, body: pdf }); putOk = r.ok; } catch { /* */ }
if (!putOk && SR && STORAGE && storagePath) {
  try { const r = await fetch(`${STORAGE}/object/${storagePath}`, { method: 'PUT', headers: { Authorization: 'Bearer ' + SR, apikey: SR, 'Content-Type': 'application/pdf', 'x-upsert': 'true' }, body: pdf }); putOk = r.ok; } catch { /* */ }
}
ok('deliverable: bytes present in storage (for a real signed download)', putOk);
const del = await A(`/projects/${projectId}/deliverables`, 'POST', { media_id: mediaId, title: 'Signed proposal', status: 'shared' });
ok('deliverable: attached to the project (client_visible shared)', del.status === 201 && del.body?.data?.client_visible === true && del.body?.data?.status === 'shared');
const deliverableId = del.body?.data?.id;
const bundle = await A(`/projects/${projectId}`);
ok('deliverable appears in the project bundle', bundle.ok && (bundle.body?.data?.deliverables || []).some((d) => d.id === deliverableId));
const dl = await A(`/projects/${projectId}/deliverables/${deliverableId}/download`);
ok('deliverable: signed download URL issued', dl.ok && /^https?:\/\//.test(dl.body?.data?.url || ''));

// ── delete-protection: the file backing a shared deliverable cannot be removed.
//    For a Business-OS account DELETE /media is feature-gated (403) before the
//    in_use check even runs — either way the file is NOT deletable. The in_use
//    logic itself (deleteMedia refuses while a deliverable references it) is
//    covered structurally in projects_routes / lib. ──
const protect = await A(`/media/${mediaId}`, 'DELETE');
ok('delete-protection: the deliverable’s file is not deletable (403 gate or 409 in_use)', protect.status === 403 || protect.status === 409, JSON.stringify(protect.body));

// ── approval: request bound to the exact version → decide with hash guard ──
const areq = await A(`/projects/${projectId}/approvals`, 'POST', { subject_type: 'deliverable', subject_id: deliverableId, title: 'Approve the proposal', summary: 'Please review + approve' });
ok('approval: requested (pending) with a content_hash', areq.status === 201 && areq.body?.data?.status === 'pending' && /^[0-9a-f]{64}$/.test(areq.body?.data?.content_hash || ''));
const approvalId = areq.body?.data?.id;
const hash = areq.body?.data?.content_hash;
const wrong = await A(`/approvals/${approvalId}/decide`, 'POST', { decision: 'approved', presented_hash: 'f'.repeat(64) });
ok('approval: deciding a STALE version is refused (version_mismatch)', wrong.status === 409 && wrong.body?.error === 'version_mismatch');
const decide = await A(`/approvals/${approvalId}/decide`, 'POST', { decision: 'approved', presented_hash: hash, note: 'Looks great' });
ok('approval: decided (approved) with the matching hash', decide.ok && decide.body?.data?.status === 'approved');
const redecide = await A(`/approvals/${approvalId}/decide`, 'POST', { decision: 'approved', presented_hash: hash });
ok('approval: re-decide is idempotent', redecide.ok && redecide.body?.already === true);
const changeDecide = await A(`/approvals/${approvalId}/decide`, 'POST', { decision: 'rejected', presented_hash: hash });
ok('approval: cannot re-decide an already-decided request (409 already_decided)', changeDecide.status === 409 && changeDecide.body?.error === 'already_decided');

// ── supersede: a new request for the SAME subject supersedes the prior pending one ──
const r1 = await A(`/projects/${projectId}/approvals`, 'POST', { subject_type: 'project', subject_id: projectId, title: 'Approve the plan (round 1)' });
const r2 = await A(`/projects/${projectId}/approvals`, 'POST', { subject_type: 'project', subject_id: projectId, title: 'Approve the plan (round 2)' });
ok('approval: a second request for the same subject is created', r1.status === 201 && r2.status === 201);
const decideSuperseded = await A(`/approvals/${r1.body?.data?.id}/decide`, 'POST', { decision: 'approved', presented_hash: r1.body?.data?.content_hash });
ok('approval: the superseded (round-1) request can no longer be decided (409)', decideSuperseded.status === 409);
const decideLatest = await A(`/approvals/${r2.body?.data?.id}/decide`, 'POST', { decision: 'approved', presented_hash: r2.body?.data?.content_hash });
ok('approval: the latest (round-2) request decides normally', decideLatest.ok && decideLatest.body?.data?.status === 'approved');

// ── activity + progress reflect delivery/approval events ──
const bundle2 = await A(`/projects/${projectId}`);
const kinds = new Set((bundle2.body?.data?.events || []).map((e) => e.kind));
ok('activity records deliverable_added + approval_requested + approval_decided', kinds.has('deliverable_added') && kinds.has('approval_requested') && kinds.has('approval_decided'));

// ── tenant isolation (if a 2nd tenant is configured) ──
if (JWT2) {
  const bDown = await B(`/projects/${projectId}/deliverables/${deliverableId}/download`);
  ok('B cannot download A’s deliverable (404)', bDown.status === 404);
  const bDecide = await B(`/approvals/${approvalId}/decide`, 'POST', { decision: 'rejected', presented_hash: hash });
  ok('B cannot decide A’s approval (404)', bDecide.status === 404);
  const bAttach = await B(`/projects/${projectId}/deliverables`, 'POST', { media_id: mediaId });
  ok('B cannot attach a deliverable to A’s project (404)', bAttach.status === 404);
} else {
  console.log('SKIP  tenant isolation — set SALES_E2E_JWT2 to run');
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ P2-D-2 DELIVERABLES & APPROVALS E2E: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
