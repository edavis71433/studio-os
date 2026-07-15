// ── Operator delivery UX: managing customers (FIX 5/6/7/D) ───────────────────
// Structural guards for the operator's customer-management surfaces:
//   FIX 6 — the "Customers" nav opens a real ROSTER of the studio's customers.
//   FIX 7 — opening a customer lands on the DELIVERY view (not their website).
//   FIX D — the project detail is a FULL-SCREEN in-page view, not a modal popup.
//   FIX 5 — client messages/requests are first-class in the studio Inbox and are
//           never silently dropped when they belong to no single project.
// Pure filesystem; no network.
//   deno run --allow-read tests/presence/operator_delivery_test.mjs
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const nav = read('supabase/functions/presence/lib/navigation.ts');
const ws = read('supabase/functions/presence/routes/workspace.ts');
const cd = read('supabase/functions/presence/routes/client_delivery.ts');
const customers = read('customers.html');
const agency = read('agency.html');
const projects = read('projects.html');
const inbox = read('inbox.html');

// ═══ FIX 6 — Customers nav → a real list ═══
ok('FIX6: nav Customers points at the roster page (/customers.html)', /label: 'Customers', href: '\/customers\.html'/.test(nav));
ok('FIX6: customers.html fetches the studio roster (/studio/customers)', /\/studio\/customers/.test(customers));
ok('FIX6: customers.html has a plain-language empty state', /haven’t added a customer yet/.test(customers));
ok('FIX6: roster handler is tenant-scoped to the operator’s own site + active links', /presence_service_links\?agency_site_id=eq\.\$\{site\.id\}&status=eq\.active/.test(cd));

// ═══ FIX 7 — opening a customer → the delivery view ═══
ok('FIX7: customers.html "Open" routes to the unified Client Record (crm.html)', /crm\.html\?client='\+encodeURIComponent\(c\.customer_site_id\)/.test(customers) && /tab=delivery/.test(customers));
ok('FIX7: customers.html keeps "Manage their website" as a secondary action', /Manage their website/.test(customers) && /today\.html\?client='\+encodeURIComponent\(c\.customer_site_id\)/.test(customers));
ok('FIX7: agency.html opens the unified Client Record when a project exists', /const pid = PROJECT_BY_SITE\[siteId\];[\s\S]*?crm\.html\?project=/.test(agency));
ok('FIX7: agency.html builds the site→project map from /studio/customers', /\/studio\/customers/.test(agency) && /PROJECT_BY_SITE\[c\.customer_site_id\]=c\.project_id/.test(agency));
ok('FIX7: agency.html keeps "Manage their website" as a secondary action', /data-web=/.test(agency) && /Manage their website/.test(agency));

// ═══ FIX D — the project detail is a full-screen in-page view ═══
ok('FIXD: the modal <dialog id="detail"> is gone', !/<dialog id="detail"/.test(projects));
ok('FIXD: a full-screen in-page detail container exists (#detailWrap)', /id="detailWrap"/.test(projects));
ok('FIXD: show/hide swap the list and detail panels in-page', /function showDetail\(\)\{ const l=\$\('listWrap'\),d=\$\('detailWrap'\)/.test(projects) && /function hideDetail\(\)/.test(projects));
ok('FIXD: opening a project shows the full-screen detail (not a modal)', /dds-skeleton[\s\S]{0,80}?showDetail\(\)/.test(projects));
ok('FIXD: a clear "← Back to projects" affordance', /← Back to projects/.test(projects));
ok('FIXD: all detail sections still present (milestones/tasks/files/approvals/surveys/support/messages)', ['Milestones', 'Tasks', 'Files', 'Approvals', 'Surveys', 'Support', 'Messages'].every((s) => projects.includes('>' + s + ' ') || projects.includes('>' + s + '<') || projects.includes(s)));

// ═══ FIX 5 — client messages first-class in the Inbox + never dropped ═══
ok('FIX5: the feed builds a client_messages section (studio side only)', /let client_messages/.test(ws) && /return json\(\{ data: \{ role, moments, notices, pending_approvals: pending, last_published: last, client_messages \}/.test(ws));
ok('FIX5: OPEN support requests (incl. project-less) feed the section', /presence_support_requests\?site_id=eq\.\$\{site\.id\}&status=in\.\(open,in_progress\)/.test(ws));
ok('FIX5: client project messages use the authoritative from=client signal', /\(e\.detail \|\| \{\}\)\.from === 'client'/.test(ws));
ok('FIX5: section links to where the operator replies (the Client Record / the request)', /\/crm\.html\?project=\$\{/.test(ws) && /\/projects\.html\?support=\$\{r\.id\}/.test(ws));
ok('FIX5: the section is NOT gated on the per-reader last-seen (not auto-read on open)', !/last_seen|activity_reads/.test(ws.slice(ws.indexOf('let client_messages'))));
ok('FIX5: inbox renders a prominent "Messages from your clients" section', /Messages from your clients/.test(inbox) && /feed\.client_messages/.test(inbox));
ok('FIX5: inbox counts client messages toward "needs you" total', /\+clientMsgs\.length/.test(inbox));
ok('FIX5: projects.html can open + reply to a project-less request (full-screen)', /function openStudioSupportFull/.test(projects) && /params\.get\('support'\)/.test(projects));

// ═══ BY-CLIENT — Inbox groups client messages by CLIENT (with a dropdown); the
//     studio-wide roll-up is REMOVED from projects.html (it lives in the Inbox now) ═══
ok('BYCLIENT: feed enriches each message with the CLIENT id + name', /client_id: c\.client_id, client: c\.client/.test(ws));
ok('BYCLIENT: client lookups are BATCHED via the bridge + one clients read (no N+1)', /presence_service_links\?agency_site_id=eq\.\$\{site\.id\}&status=eq\.active&select=project_id,customer_client_id/.test(ws) && /clients\?id=in\.\(\$\{\[\.\.\.clientIds\]\.join\(','\)\}\)/.test(ws));
ok('BYCLIENT: a project-less request groups by matching its requester → customer', /requesterToClient\[requester\]/.test(ws));
ok('BYCLIENT: inbox groups the section by client_id', /const key=c\.client_id/.test(inbox) && /groups\.set\(key/.test(inbox));
ok('BYCLIENT: inbox shows ONE conversation row per client (avatar + name + open)', /class="item convo/.test(inbox) && /class="avatar"/.test(inbox) && /Open conversation/.test(inbox));
ok('BYCLIENT: each conversation opens that client’s thread + shows a message-count badge', /class="cmbadge"/.test(inbox) && /scoped\(g\.href/.test(inbox));
ok('BYCLIENT: projects.html no longer shows the studio-wide client-messages list', !/loadClientMessages/.test(projects) && !/id="clientMsgs"/.test(projects));
ok('BYCLIENT: projects.html KEEPS the per-customer general messages inside the delivery view', /loadClientGeneral/.test(projects) && /id="genList"/.test(projects));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ OPERATOR DELIVERY UX (FIX 5/6/7/D): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
