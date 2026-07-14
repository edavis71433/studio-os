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

const passed = results.filter((r) => r.p).length;
console.log(`\n════ CLIENT BRIDGE ROUTES (P2-D hardening): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
