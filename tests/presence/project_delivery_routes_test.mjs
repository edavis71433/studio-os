// ── Deliverables & Approvals routes: structural security (P2-D-2) ────────────
//   deno run --allow-read tests/presence/project_delivery_routes_test.mjs
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const pd = read('supabase/functions/presence/routes/project_delivery.ts');
const idx = read('supabase/functions/presence/index.ts');
const mig = read('supabase/migrations/0076_p2d_deliverables_approvals.sql');
const media = read('supabase/functions/presence/lib/media.ts');
const wsp = read('supabase/functions/presence/routes/workspace.ts');

// ── tenant isolation: every table access site-scoped ──
for (const t of ['presence_deliverables', 'presence_approvals']) {
  const uses = pd.match(new RegExp(`${t}\\?[^\\\`]*`, 'g')) || [];
  const unscoped = uses.filter((u) => !/site_id=eq\.\$\{site(Id|\.id)\}/.test(u));
  ok(`tenant: every ${t} query is site-scoped (${uses.length} uses)`, unscoped.length === 0, unscoped[0] || '');
}
ok('tenant: media lookups in delivery are site-scoped', (pd.match(/presence_media\?[^`]*/g) || []).every((u) => /site_id=eq\.\$\{site(Id|\.id)\}/.test(u)));

// ── studio-only writes; client reviews ──
ok('perms: deliverable create/patch/delete + approval create are studio-only', (pd.match(/if \(!\(await isStudioSide[\s\S]*?\)\)\) return studioDenied/g) || []).length >= 4);
ok('perms: deliverable download allows the client only for a SHARED, client_visible file', /!studio && !\(d\.client_visible && d\.status === 'shared'\)/.test(pd));
ok('perms: approval decide requires the approval be client_visible', /!a \|\| !a\.client_visible\) return json\(\{ error: 'not_found'/.test(pd));

// ── version integrity: decision bound to the exact version ──
ok('integrity: decide guards status=pending AND content_hash in the WHERE', /status=eq\.pending&content_hash=eq\.\$\{a\.content_hash\}/.test(pd));
ok('integrity: a presented hash that differs is refused (version_mismatch)', /presented !== a\.content_hash\) return json\(\{ error: 'version_mismatch'/.test(pd));
ok('integrity: a new request supersedes a prior PENDING one for the same subject', /status=eq\.pending`, \{ method: 'PATCH'[\s\S]{0,40}status: 'superseded'/.test(pd));
ok('integrity: content_hash comes from the SUBJECT version (deliverable media+path / row updated_at)', /approvalHash\('deliverable', subjectId, `\$\{d\.media_id\}:/.test(pd) && /approvalHash\(subjectType, subjectId, String\(row\.updated_at/.test(pd));

// ── idempotency ──
ok('idempotent: re-decide returns already', /a\.status === b\.decision\) return json\(\{ data: \{ status: a\.status \}, already: true/.test(pd));
ok('idempotent: only pending can be decided (canDecideApproval)', /canDecideApproval\(a\.status\)/.test(pd));

// ── files: ONE store; deliverable is an overlay; delete-protection ──
ok('files: deliverable references presence_media (no second bucket)', /media_id uuid not null references public\.presence_media/.test(mig));
ok('files: relationship-gated upload reuses createUpload (same store)', /createUpload\(site\.id/.test(pd) && /handleDeliverableUploadUrl/.test(pd));
ok('files: deliverable DELETE soft-deletes the OVERLAY only (media untouched)', /soft-delete the OVERLAY only/.test(pd));
ok('protect: deleteMedia refuses while a deliverable references the file', /presence_deliverables\?site_id=eq\.\$\{siteId\}&media_id=eq\.\$\{mediaId\}[\s\S]*?select=title/.test(media) && /deliverable “/.test(media));
ok('protect: bucket now allows application/pdf (0065 doc support + deliverables)', /allowed_mime_types = array_append\(allowed_mime_types, 'application\/pdf'\)/.test(mig));

// ── reviewer boundary ──
ok('reviewer: client may download a shared deliverable + decide an approval', wsp.includes('download$/.test(route)) return true') && wsp.includes('decide$/.test(route)) return true'));

// ── wiring + migration ──
ok('wiring: deliverable + approval routes dispatched', idx.includes('handleDeliverableUploadUrl(') && idx.includes('handleDeliverablesCreate(') && idx.includes('handleDeliverableDownload(') && idx.includes('handleApprovalsCreate(') && idx.includes('handleApprovalDecide('));
ok('migration: both tables site-scoped + RLS + subject/version columns', /create table if not exists public\.presence_approvals[\s\S]*?content_hash text/.test(mig) && /alter table public\.presence_approvals enable row level security/.test(mig) && /alter table public\.presence_deliverables enable row level security/.test(mig));
ok('migration: project_events kind vocabulary extended for delivery/approvals', /deliverable_added','approval_requested','approval_decided/.test(mig));
ok('migration: rollback present', /drop table if exists public\.presence_approvals;/.test(mig) && /drop table if exists public\.presence_deliverables;/.test(mig));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ DELIVERABLES & APPROVALS ROUTES (P2-D-2): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
