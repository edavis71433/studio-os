// ── Client bridge routes: structural isolation (P2-D hardening) ──────────────
//   deno run --allow-read tests/presence/client_delivery_routes_test.mjs
// The /client/* surface must be bridge-scoped: resolve the caller's own client,
// verify a service_link to the target, then read agency-site data. No path may
// touch delivery data without a verified link.
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const cd = read('supabase/functions/presence/routes/client_delivery.ts');
const br = read('supabase/functions/presence/lib/service_bridge.ts');
const idx = read('supabase/functions/presence/index.ts');
const mig = read('supabase/migrations/0079_p2d_agency_client_bridge.sql');

// ── the caller can only be their OWN client, resolved from their own site ──
ok('scope: the customer is resolved from their OWN site (site.client_id), not a request field', /customerOf = \(site: SiteRow\): string \| null => \(site\.client_id/.test(cd));

// ── every project action verifies a bridge link BEFORE reading agency data ──
ok('bridge: project bundle/report resolve via linkForCustomerProject before reading', (cd.match(/linkForCustomerProject\(me,/g) || []).length >= 2);
ok('bridge: deliverable/approval/survey actions verify via linkForCustomerVia', (cd.match(/linkForCustomerVia\(me,/g) || []).length >= 3);
ok('bridge: linkForCustomerVia resolves the row’s project then checks the customer link', /linkForCustomerProject\(customerClientId, row\.project_id\)/.test(br));
ok('bridge: linksForCustomer / linkForCustomerProject filter by customer_client_id + status=active', /customer_client_id=eq\.\$\{customerClientId\}&status=eq\.active/.test(br) && /project_id=eq\.\$\{projectId\}&customer_client_id=eq\.\$\{customerClientId\}&status=eq\.active/.test(br));

// ── all agency-side reads are scoped to the VERIFIED link's site ──
{
  const tables = ['presence_projects', 'presence_milestones', 'presence_tasks', 'presence_project_events', 'presence_deliverables', 'presence_approvals', 'presence_surveys', 'presence_survey_responses', 'presence_project_messages', 'presence_support_requests', 'presence_support_messages'];
  for (const t of tables) {
    const uses = cd.match(new RegExp(`${t}\\?[^\\\`]*`, 'g')) || [];
    // every read is scoped to the bridge's agency site (site_id=eq.${s} / agency_site_id)
    // OR — for the studio-side roster (FIX 6, handleStudioCustomers) — to the operator's
    // OWN site (site_id=eq.${site.id}); both are tenant-safe. OR an on_conflict upsert.
    const unscoped = uses.filter((u) => !/site_id=eq\.\$\{(s|site\.id|found\.link\.agency_site_id|links\[0\]\.agency_site_id|agencySiteId)\}/.test(u) && !/site_id=in\.|on_conflict|id=in\.\(\$\{ids/.test(u)); // id=in.(linked ids) is bridge-verified
    ok(`scope: every ${t} query is scoped to the verified agency site (${uses.length})`, unscoped.length === 0, unscoped[0] || '');
  }
}
ok('scope: the projects LIST returns only the customer’s linked project ids', /presence_projects\?id=in\.\(\$\{ids\.join/.test(cd) && /const ids = links\.map/.test(cd));

// ── client-visibility is always enforced on reads ──
ok('vis: client reads always filter client_visible=is.true', (cd.match(/client_visible=is\.true/g) || []).length >= 6);
ok('vis: deliverable download requires shared + client_visible', /client_visible=is\.true&status=eq\.shared/.test(cd));

// ── writes keep the integrity guards ──
ok('integrity: client approval decide guards status=pending AND content_hash', /status=eq\.pending&content_hash=eq\.\$\{a\.content_hash\}/.test(cd));
ok('integrity: client survey respond is idempotent per respondent', /status=eq\.submitted&select=id&limit=1[\s\S]*?already: true/.test(cd));
ok('scope: client support sees ONLY its own requests (requester match)', /r\.requester !== readerKey\(principal\)\) return null/.test(cd));

// ── wiring + migration ──
ok('wiring: /client/* dispatched (projects/report/messages/download/decide/respond/notifications/support)', ['handleClientProjects', 'handleClientProject', 'handleClientReport', 'handleClientMessages', 'handleClientDeliverableDownload', 'handleClientApprovalDecide', 'handleClientSurveyRespond', 'handleClientNotifications', 'handleClientSupport'].every((h) => idx.includes(h + '(')));

// ── FIX 6: the studio-side customer roster (operator's own list of customers) ──
ok('roster: handleStudioCustomers is studio-gated (isStudioSide else studioDenied)', /export async function handleStudioCustomers[\s\S]*?if \(!\(await isStudioSide\(jwt, site, principal\)\)\) return studioDenied/.test(cd));
ok('roster: resolves customers from ACTIVE links on the operator’s OWN site (agency_site_id=eq.${site.id})', /presence_service_links\?agency_site_id=eq\.\$\{site\.id\}&status=eq\.active/.test(cd));
ok('roster: reads the global clients table ONLY for ids proven to belong here (id=in.(clientIds))', /clients\?id=in\.\(\$\{clientIds\.join/.test(cd));
ok('roster: returns one row per customer with a project id to route into delivery', /project_id: l\.project_id/.test(cd) && /byCustomer/.test(cd));
ok('roster: GET /studio/customers is wired', /route === '\/studio\/customers' && method === 'GET'\) return handleStudioCustomers\(/.test(idx));
ok('migration: presence_service_links site-scoped, RLS, UNIQUE(project_id)', /create table if not exists public\.presence_service_links[\s\S]*?agency_site_id uuid not null references public\.presence_sites/.test(mig) && /presence_service_links_project_uq[\s\S]*?\(project_id\)/.test(mig) && /alter table public\.presence_service_links enable row level security/.test(mig));
ok('migration: D3 support recent index added', /presence_support_site_recent_idx/.test(mig));
ok('migration: rollback present', /drop table if exists public\.presence_service_links;/.test(mig));

// portal document lists mint site-origin viewer links (doc.html), never the raw
// function URL — the default *.supabase.co domain downgrades text/html to text/plain.
ok('documents: portal view_url mints via docViewerUrl (site-origin doc.html viewer)', /docViewerUrl\(await signDocToken\(/.test(cd) && !/functions\/v1\/presence\/sales\/doc/.test(cd));

// ── client-upload provenance: the MEDIA row itself is stamped (SS1 F1) ────────
// The deliverable's note never reaches presence_media; the studio's Files roster
// reads the media row via /assets, so the client door must stamp THAT row —
// site-scoped, with the marker shape the frontend detection reads.
{
  const media = read('supabase/functions/presence/routes/media.ts');
  const mlib = read('supabase/functions/presence/lib/media.ts');
  const assetsRoute = read('supabase/functions/presence/routes/assets.ts');
  ok('provenance: the client upload-url flow stamps the media row metadata (client_upload + note), site-scoped',
    /handleClientUploadUrl[\s\S]*?presence_media\?id=eq\.\$\{.*?media_id\}&site_id=eq\.\$\{link\.agency_site_id\}[\s\S]*?client_upload: true, note: 'Uploaded by the client\.'[\s\S]*?handleClientUploadCreate/.test(cd));
  ok('provenance: the STUDIO upload path stamps no client marker (studio uploads must never wear the chip)',
    !/client_upload/.test(media) && !/client_upload/.test(mlib));
  ok('provenance: /assets present() surfaces the marker via the pure isClientUpload detection',
    /client_upload: isClientUpload\(a\)/.test(assetsRoute));
}

// ── the CLIENT dimension on Files is OPERATOR-ONLY (Files-by-client) ─────────
// The studio roster learns which client a file belongs to by joining
// presence_deliverables → presence_service_links → clients. That join lives
// entirely inside the operator's GET /assets. The portal must gain NOTHING from
// it: cross-client isolation there is enforced by the bridge (0079) and was a
// deliberate hardening — a client_name leaking into a /client/* bundle would
// name one customer to another.
{
  const assetsRoute = read('supabase/functions/presence/routes/assets.ts');
  const ws = read('supabase/functions/presence/routes/workspace.ts');
  const dam = read('supabase/functions/presence/lib/dam.ts');
  ok('files-by-client: the media→client map is built inside the OPERATOR list handler',
    /async function clientByMedia\(site: SiteRow\)/.test(assetsRoute) && /handleAssetsList[\s\S]*?clientByMedia\(site\)/.test(assetsRoute));
  ok('files-by-client: the join is scoped to the operator\'s OWN site on every hop',
    /presence_deliverables\?site_id=eq\.\$\{site\.id\}/.test(assetsRoute) && /presence_service_links\?agency_site_id=eq\.\$\{site\.id\}/.test(assetsRoute));
  ok('files-by-client: it is NOT the ?client= tenant switch — the customer\'s OWN site is never consulted',
    !/customer_site_id/.test(assetsRoute) && /clientByMedia[\s\S]*?presence_service_links\?agency_site_id/.test(assetsRoute));
  ok('isolation: NO /client/* route emits client_id / client_name / clientsByMedia',
    !/client_name/.test(cd) && !/clientsByMedia|clientByMedia/.test(cd));
  ok('isolation: the pure core is imported by the operator route only (not the client door)',
    /clientsByMedia/.test(assetsRoute) && /export function clientsByMedia/.test(dam) && !/clientsByMedia/.test(cd));
  ok('isolation: GET /assets is operator-only — a reviewer\'s only /assets door is POST :id/status',
    /export function reviewerAllowed/.test(ws)
    && ws.includes("method === 'POST' && /^\\/assets\\/[0-9a-f-]{36}\\/status$/")
    && (ws.match(/method === 'GET'[^\n]*/g) || []).every((l) => /portal\/context|portal\/feed/.test(l) && !/assets/.test(l)));
  ok('present(): the client fields are ADDITIVE — undefined for a file that was never delivered',
    /client_id: c\?\.client_id \|\| undefined/.test(assetsRoute) && /client_name: c\?\.client_name \|\| undefined/.test(assetsRoute) && /project_id: c\?\.project_id \|\| undefined/.test(assetsRoute));
  ok('present(): only the LIST handler ever supplies a client — every other call site omits it',
    (assetsRoute.match(/present\(/g) || []).length > 2 && (assetsRoute.match(/client: byClient\.get/g) || []).length === 1);
  ok('files-by-client: a project with no bridge link contributes no client (the pure core refuses to guess)',
    /if \(!client\) continue;/.test(dam));

  // ── R-fixes: the client dimension must fail LOUDLY and WHOLLY, never partially ──
  // svc() does not throw on a non-2xx (lib/db.ts returns { ok:false, json:null }), so
  // the try/catch this replaced could not see a failed hop — it silently produced a
  // half map, and a client file with no NAME then rendered as "Studio".
  const cbm = (assetsRoute.match(/async function clientByMedia[\s\S]*?\n}\n/) || [''])[0];
  ok('F10: hop 1 reads only LIVE deliverables — deleted_at=is.null is load-bearing (a deleted, older deliverable would outrank a live one)',
    /presence_deliverables\?site_id=eq\.\$\{site\.id\}&deleted_at=is\.null/.test(cbm));
  ok('F8: hop 1 orders by created_at AND id — created_at alone is not a total order for rows written in one transaction',
    /order=created_at\.asc,id\.asc/.test(cbm));
  ok('F2: every hop checks .ok explicitly — svc() returns { ok:false } on a non-2xx, it does not throw',
    (cbm.match(/if \(!dlR\.ok\)/g) || []).length === 1 && (cbm.match(/if \(!links\)/g) || []).length === 1 && (cbm.match(/if \(!clients\)/g) || []).length === 1);
  ok('F2: a failed hop degrades to an EMPTY map and LOGS which hop — never a half map, never silence',
    /console\.error\(/.test(cbm) && (cbm.match(/bail\('hop [123]/g) || []).length === 3 && /return new Map\(\);/.test(cbm));
  ok('F3: the in.() reads are CHUNKED — 2000 unchunked ids is ~74KB of query string, past the proxy request-line limit',
    /const IN_CHUNK = \d+;/.test(assetsRoute)
    && /svcInChunks\(\s*\(ids\) => `presence_service_links\?agency_site_id=eq\.\$\{site\.id\}&project_id=in\.\(\$\{ids\}\)/.test(cbm)
    && /svcInChunks\(\(ids\) => `clients\?id=in\.\(\$\{ids\}\)/.test(cbm)
    && !/in\.\(\$\{projectIds\.join|in\.\(\$\{clientIds\.join/.test(assetsRoute));
  ok('F3: one failed chunk fails the WHOLE hop — a partial in.() result would MISLABEL rows, not merely omit them',
    /if \(reads\.some\(\(r\) => !r\.ok\)\) return null;/.test(assetsRoute));
  // ── F4: hop 2 deliberately deviates from the bridge convention ──
  // Twelve sibling reads filter status=eq.active because they gate ACCESS. This one
  // answers "whose work is this file?", and a file delivered to a former client is
  // still theirs — filtering to active would re-file their whole body of work under
  // "Studio", a false claim of authorship. Pinned so it is never "fixed" by accident.
  ok('F4: hop 2 intentionally does NOT filter status=eq.active — historical attribution is the point',
    /presence_service_links\?agency_site_id=eq\.\$\{site\.id\}[^`]*select=project_id,customer_client_id/.test(cbm)
    && !/presence_service_links[^`]*status=eq\.active/.test(cbm));
  ok('F4: the deviation is DOCUMENTED at the read, so a future reader sees the intent before the convention',
    /only presence_service_links read in the codebase that omits it/i.test(cbm) && /former client|three years ago/i.test(cbm));
  // ── F5: the recovered FILENAME is an operator affordance, not a portal one ──
  // displayName's alt_text rung recovers a file's real uploaded name. Filenames
  // routinely carry client identity ("Rivera-Builders-new-logo-FINAL-v3"), and an
  // AGENCY site pools every bridged client's uploads in one presence_media table,
  // while /portal/feed's pending-approval read is SITE-WIDE — so a client_reviewer
  // there could enumerate the studio's other customers from filenames alone. The
  // rung is therefore opt-in and the default is the pre-9059e5a name; only the
  // operator route opts in.
  ok('F5: the alt_text rung is OPT-IN — the pure core reads it only when asked',
    /fromAltText\?: boolean/.test(dam) && /if \(opts\.fromAltText && alt && alt !== 'Photo'\)/.test(dam));
  ok('F5: routes/assets.ts (operator-only) is the surface that opts in',
    /displayName\(a, \{ hint, fromAltText: true \}\)/.test(assetsRoute));
  ok('F5: /portal/feed names a pending file WITHOUT the opt-in — the portal shows what it showed before',
    /kind: 'file', title: `Replace \$\{displayName\(m\)\}`/.test(ws) && !/fromAltText/.test(ws));
  ok('F5: NO portal/client-reachable module passes the opt-in flag',
    ['routes/client_delivery.ts', 'routes/workspace.ts', 'routes/project_comms.ts', 'lib/service_bridge.ts']
      .every((p) => !/fromAltText/.test(read(`supabase/functions/presence/${p}`))));
  ok('F5: routes/assets.ts is the ONLY module in the whole function that opts in',
    (() => {
      const dir = 'supabase/functions/presence';
      const files = [];
      const walk = (d) => { for (const e of Deno.readDirSync(new URL(`${d}/`, ROOT))) { if (e.isDirectory) walk(`${d}/${e.name}`); else if (e.name.endsWith('.ts')) files.push(`${d}/${e.name}`); } };
      walk(dir);
      const optIn = files.filter((f) => /fromAltText: true/.test(read(f)));
      return optIn.length === 1 && optIn[0] === `${dir}/routes/assets.ts`;
    })());
  ok('F4: every OTHER presence_service_links read still filters status=eq.active (the access-gating convention is intact)',
    ['lib/service_bridge.ts', 'routes/workspace.ts', 'routes/crm.ts', 'routes/client_delivery.ts', 'routes/project_comms.ts', 'routes/inbound_email.ts']
      .every((p) => (read(`supabase/functions/presence/${p}`).match(/presence_service_links\?[^`]*/g) || [])
        .filter((q) => /select=/.test(q))   // reads only; the upsert (?on_conflict=project_id) writes
        .every((q) => /status=eq\.active/.test(q))));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ CLIENT BRIDGE ROUTES (P2-D hardening): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
