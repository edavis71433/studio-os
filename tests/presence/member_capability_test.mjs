// ── An invited member is held to their role on every write route (MC-2) ──────
// MC-1 gave a member their site's content and enforced lib/site_roles.ts there. Every
// other write route runs on the service role and looked at no role, so a business_staff
// seat could delete a file, void an invoice or rewrite DNS, whatever the table said.
// Proven first on the real router, route by route, then decided 2026-11-05.
//
// memberWriteGate now holds a member to the table on all of them. Only delete and
// configure refuse anyone today: staff, developer and owner seats hold the rest. Owners,
// a studio scoped in and platform staff never meet the gate. This drives the REAL gate
// and handlers against a stubbed PostgREST that answers any read with a row, so a
// handler reaches its write. No Supabase, no credentials, no outside call leaves.
//   · the decided list, route by route, and what each role gets from it
//   · a write on no list is refused, and a reviewer keeps what the boundary gives them
//   · every route that changed: refused with nothing written, or the owner's answer
//   · a failed role read no longer hands anyone the owner's powers
//   · a new write handler in index.ts fails here until someone decides what it needs
//
//   deno run --allow-read --allow-env --allow-net tests/presence/member_capability_test.mjs
for (const [k, v] of Object.entries({
  SUPABASE_URL: 'http://stub.local', SERVICE_ROLE_KEY: 'SERVICE-KEY', SUPABASE_ANON_KEY: 'ANON-KEY', SITE_URL: 'https://app.example',
  NETLIFY_AUTH_TOKEN: 'fake', AWS_ACCESS_KEY_ID: 'fake', AWS_SECRET_ACCESS_KEY: 'fake', AWS_REGION: 'us-east-1', ROUTE53_ENABLED: '1', DNS_ZONE_ENABLED: '1',
})) Deno.env.set(k, v);

const P = '../../supabase/functions/presence';
const { SITE_ROLES, siteCan, contentWriteNeeds, memberWriteNeeds } = await import(`${P}/lib/site_roles.ts`);
const { resolveSiteRoleCached } = await import(`${P}/lib/workspace.ts`);
const { memberWriteGate, reviewerAllowed } = await import(`${P}/routes/workspace.ts`);
const { handleMediaDelete } = await import(`${P}/routes/media.ts`);
const { handleAssetDelete, handleAssetStatus } = await import(`${P}/routes/assets.ts`);
const { handleRedirectDelete } = await import(`${P}/routes/search.ts`);
const { handleContentLibraryDelete } = await import(`${P}/routes/content_library.ts`);
const { handleCheckpointDelete, handleTakeOffline, handleBackOnline } = await import(`${P}/routes/publish.ts`);
const { handleBookingTypeDelete, handleBookingSettingsPut } = await import(`${P}/routes/booking.ts`);
const { handleKnowledgeDelete } = await import(`${P}/routes/knowledge.ts`);
const { handleCommentDelete } = await import(`${P}/routes/comments.ts`);
const { handleSalesContact, handleSalesContactFields, handleSalesDeal, handleSalesProposalDelete, handleSalesContractDelete, handleSalesTemplateDelete, handleSalesInvoiceVoid, handleSalesRetainerCancel } = await import(`${P}/routes/sales.ts`);
const { handleDeliverable } = await import(`${P}/routes/project_delivery.ts`);
const { handleDomain } = await import(`${P}/routes/admin.ts`);
const { handleDnsPut, handleDnsRollback } = await import(`${P}/routes/services.ts`);
const { handleZoneCreate, handleZoneDelete, handleZoneRecords } = await import(`${P}/routes/zone.ts`);
const { handleFoundationsPrepare } = await import(`${P}/routes/foundations.ts`);
const { handlePreviewSettings } = await import(`${P}/routes/preview_env.ts`);
const { handlePutTemplate } = await import(`${P}/routes/site.ts`);
const { handleDevCustomizationPut, handleBrandKitPut } = await import(`${P}/routes/dev.ts`);
const { handleLaunchDecide } = await import(`${P}/routes/launches.ts`);
const { handleBroadcastListDelete } = await import(`${P}/routes/broadcasts.ts`);
const { handleSalesStages } = await import(`${P}/routes/sales.ts`);
const { handleCalendarLink } = await import(`${P}/routes/calendar.ts`);

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const uuid = (c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const SITE_A = uuid('a'), CLIENT_A = uuid('c'), ROW = uuid('1'), ROW2 = uuid('2');
const A = { id: SITE_A, client_id: CLIENT_A, status: 'live', last_published_at: '2026-01-01T00:00:00Z', template_slug: 'restaurant-classic', template_version: '1.0.0', custom_domain: 'alpha.example', netlify_site_id: 'nf-1', edition: 'presence' };
const USERS = {
  'jwt-owner': { id: uuid('3'), email: 'owner-a@example.com' },
  'jwt-coowner': { id: uuid('4'), email: 'coowner@example.com' },
  'jwt-staff': { id: uuid('5'), email: 'staff@example.com' },
  'jwt-dev': { id: uuid('6'), email: 'dev@example.com' },
  'jwt-reviewer': { id: uuid('7'), email: 'reviewer@example.com' },
  'jwt-platform': { id: uuid('8'), email: 'platform@example.com' },
  'jwt-studio': { id: uuid('9'), email: 'studio@example.com' },
};
const principalOf = (jwt, extra = {}) => ({ kind: 'client', userId: USERS[jwt].id, tenantId: null, role: 'client', email: USERS[jwt].email, jwt, requestId: 'test', ...extra });
const seated = (jwt, role) => principalOf(jwt, { member: { site_id: SITE_A, role } });
const SEATS = [['business_owner', 'jwt-coowner'], ['business_staff', 'jwt-staff'], ['developer', 'jwt-dev']];
const owner = () => principalOf('jwt-owner');
const scopedStudio = () => principalOf('jwt-studio', { scope: { site_id: SITE_A, name: 'Alpha' } });
const platformStaff = () => principalOf('jwt-platform', { kind: 'staff', role: 'owner' });

/* ── a tiny PostgREST: seats are real rows; any other read by the service role or the owner gets a row ── */
const STATUS = { presence_launches: 'draft', presence_invoices: 'open', presence_publishes: 'live', presence_media: 'approved', presence_proposals: 'draft', presence_contracts: 'draft', presence_infra_plans: 'proposed', presence_connection_writes: 'proposed' };
const rowOf = (table, id) => ({ id: id || ROW, site_id: SITE_A, status: STATUS[table] || 'draft', name: 'Thing', title: 'Thing', email: 'someone@example.com', metadata: {}, storage_path: `${SITE_A}/a.jpg`, mime: 'image/jpeg', bytes: 10, alt_text: 'a photo', stage: 'lead', deal_id: ROW, contact_id: ROW, project_id: ROW, client_id: CLIENT_A, snapshot_id: ROW, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', deleted_at: null });
let seats, siteRow, calls, outside, failSeatReads, fixture;
function reset(fx = {}) {
  const seat = (jwt, role) => ({ id: crypto.randomUUID(), site_id: SITE_A, email: USERS[jwt].email, user_id: USERS[jwt].id, role, status: 'active', created_at: '2026-01-01T00:00:00Z' });
  seats = [seat('jwt-coowner', 'business_owner'), seat('jwt-staff', 'business_staff'), seat('jwt-dev', 'developer'), seat('jwt-reviewer', 'client_reviewer')];
  siteRow = { ...A, ...(fx.site || {}) };
  calls = []; outside = []; failSeatReads = false; fixture = fx;
}
const reply = (body, status = 200) => new Response(status === 204 ? null : (body === null ? '' : JSON.stringify(body)), { status, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url), 'http://stub.local');
  const headers = new Headers(init.headers);
  const token = (headers.get('Authorization') || '').replace(/^Bearer /, '');
  const method = (init.method || 'GET').toUpperCase();
  if (u.hostname !== 'stub.local') { outside.push(`${method} ${u.hostname}`); return reply({}, 404); }
  if (u.pathname === '/auth/v1/user') return USERS[token] ? reply(USERS[token]) : reply({}, 401);
  if (u.pathname.startsWith('/storage/v1/')) { if (method !== 'GET') calls.push({ table: 'storage', method }); return reply({ signedURL: '/x' }); }
  if (!u.pathname.startsWith('/rest/v1/')) return reply({}, 404);
  const table = u.pathname.replace('/rest/v1/', '');
  const seesAll = token === 'SERVICE-KEY' || token === 'jwt-owner';
  const prefer = headers.get('Prefer') || '';
  const query = decodeURIComponent(u.search);
  if (method !== 'GET' && method !== 'HEAD') calls.push({ table, method, role: token === 'SERVICE-KEY' ? 'service' : 'user' });
  if (method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-range': '*/0' } });
  if (table === 'presence_site_members') {
    if (method !== 'GET') return reply([]);
    if (failSeatReads || token !== 'SERVICE-KEY') return reply({ message: 'boom' }, 500);
    const who = Object.values(USERS).find((x) => query.includes(`user_id.eq.${x.id}`));
    return reply(seats.filter((s) => s.status === 'active' && (!who || s.user_id === who.id)));
  }
  if (table === 'presence_sites') return method === 'GET' ? reply([siteRow]) : reply([siteRow]);
  const eqs = Object.fromEntries([...u.searchParams.entries()].filter(([, v]) => v.startsWith('eq.')).map(([k, v]) => [k, v.slice(3)]));
  const row = () => ({ ...rowOf(table, eqs.id), ...(fixture.rows?.[table] || {}), ...eqs });
  if (method === 'GET') {
    if (!seesAll || (fixture.only && !fixture.only.includes(table))) return reply([]);
    if (table === 'presence_publishes' && /status=(in\.\(queued|eq\.deploying|eq\.queued)/.test(query)) return reply([]);
    return reply([row()]);
  }
  const body = init.body ? JSON.parse(init.body) : null;
  if (!seesAll) return method === 'POST' ? reply({ code: '42501' }, 403) : reply([]);
  if (method === 'DELETE') return prefer.includes('representation') ? reply([row()]) : reply(null, 204);
  return prefer.includes('representation') ? reply([{ ...row(), ...(Array.isArray(body) ? body[0] : body) }], method === 'POST' ? 201 : 200) : reply(null, method === 'POST' ? 201 : 200);
};

const cors = {};
const quiet = (fn) => async (...a) => { const e = console.error, w = console.warn; console.error = () => {}; console.warn = () => {}; try { return await fn(...a); } finally { console.error = e; console.warn = w; } };
const pathOf = (name) => name.split(' ')[1].replaceAll(':id2', ROW2).replaceAll(':id', ROW).replaceAll(':key', 'google_search_console');
const methodOf = (name) => name.split(' ')[0];
const req = (method, route, body) => new Request(`http://stub.local/functions/v1/presence${route}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const answer = async (res) => ({ status: res.status, body: await res.json().catch(() => null) });
const wrote = () => calls.filter((c) => !(c.table === 'presence_site_members' && c.method === 'PATCH')).length;
const reached = () => wrote() > 0 || outside.length > 0;

// ═══ the decided list. Every write a member reaches off the content path. ═══
const DECIDED = {
  delete: [
    'DELETE /assets/:id', 'DELETE /bookings/types/:id', 'DELETE /content-library/:id', 'DELETE /knowledge/docs/:id',
    'DELETE /media/:id', 'DELETE /projects/:id/deliverables/:id2', 'DELETE /publishes/checkpoints/:id',
    'DELETE /redirects/:id', 'DELETE /sales/contacts/:id', 'DELETE /sales/contracts/:id', 'DELETE /sales/deals/:id',
    'DELETE /sales/proposals/:id', 'DELETE /sales/templates/:id', 'POST /comments/:id/delete',
    'POST /sales/deals/:id/retainer/cancel', 'POST /sales/invoices/:id/void', 'DELETE /broadcasts/lists/:id',
  ],
  configure: [
    'DELETE /foundations/domain', 'DELETE /foundations/zone', 'DELETE /foundations/zone/records',
    'POST /foundations/dns/rollback', 'POST /foundations/domain', 'POST /foundations/prepare',
    'POST /foundations/zone', 'POST /foundations/zone/records', 'POST /preview/settings', 'POST /site/offline',
    'POST /site/online', 'PUT /bookings/settings', 'PUT /foundations/dns', 'PUT /foundations/zone/records',
    'PUT /sales/contacts/fields', 'PUT /sales/stages', 'POST /calendar/link', 'DELETE /calendar/link',
  ],
  approve: [
    'POST /approvals/:id/decide', 'POST /assets/:id/status', 'POST /client/approvals/:id/decide',
    'POST /connections/:key/write/:id/decide', 'POST /foundations/plans/:id/decide', 'POST /launches/:id/decide',
    'POST /visual/plans/:id/decide',
  ],
  connect: [
    'DELETE /monitor/connection', 'POST /connections/:key/callback', 'POST /connections/:key/connect',
    'POST /connections/:key/disconnect', 'POST /connections/:key/property', 'POST /connections/:key/refresh',
    'POST /connections/:key/write/:id/execute', 'POST /connections/:key/write/:id/rollback',
    'POST /connections/:key/write/prepare', 'POST /connections/ask', 'POST /monitor/connect', 'POST /monitor/verify',
  ],
  publish: [
    'POST /broadcasts/:id/send', 'POST /launches/:id/promote', 'POST /launches/:id/rollback',
    'POST /launches/:id/schedule', 'POST /preview/promote', 'POST /publish', 'POST /restore', 'POST /schedule',
    'POST /schedule/:id/cancel',
  ],
  comment: [
    'POST /client/projects/:id/messages', 'POST /client/support', 'POST /client/support/:id/messages',
    'POST /client/surveys/:id/respond', 'POST /comments', 'POST /comments/:id/resolve',
    'POST /projects/:id/messages', 'POST /support/:id/messages', 'POST /surveys/:id/respond',
  ],
  edit: [
    'PATCH /assets/:id', 'PATCH /bookings/types/:id', 'PATCH /broadcasts/:id', 'PATCH /projects/:id',
    'PATCH /projects/:id/deliverables/:id2', 'PATCH /projects/:id/milestones/:id2', 'PATCH /projects/:id/tasks/:id2',
    'PATCH /sales/contacts/:id', 'PATCH /sales/deal-tasks/:id', 'PATCH /sales/deals/:id', 'PATCH /support/:id',
    'POST /visibility/check', 'POST /approve/send', 'POST /assets/:id/duplicate', 'POST /assets/:id/remove-background',
    'POST /assets/:id/replace', 'POST /assets/:id/rollback', 'POST /assets/:id/suggest', 'POST /assets/bulk',
    'POST /bookings/appointments/:id/cancel', 'POST /bookings/appointments/:id/complete',
    'POST /bookings/appointments/:id/confirm', 'POST /bookings/appointments/:id/no_show', 'POST /bookings/types',
    'POST /brand/reports/:id/dismiss', 'POST /brand/review', 'POST /broadcasts', 'POST /broadcasts/lists', 'POST /broadcasts/:id/cancel',
    'POST /broadcasts/draft-assist', 'POST /client/projects/:id/tasks/:id2/done',
    'POST /client/projects/:id/upload-url', 'POST /client/projects/:id/uploads',
    'POST /coach/opportunities/:id/decide', 'POST /coach/run', 'POST /content-library', 'POST /editor/improve',
    'POST /forms/inbox/:id', 'POST /forms/inbox/:id/reply', 'POST /knowledge/import', 'POST /launches',
    'POST /launches/:id/cancel', 'POST /launches/:id/recapture', 'POST /media/upload-url',
    'POST /moments/:id/dismiss', 'POST /notes/:id/accept', 'POST /notes/:id/dismiss', 'POST /preview/publish',
    'POST /preview/section', 'POST /preview/share-link', 'POST /projects', 'POST /projects/:id/approvals', 'POST /projects/:id/checklist',
    'POST /projects/:id/deliverables', 'POST /projects/:id/deliverables/upload-url', 'POST /projects/:id/milestones',
    'POST /projects/:id/status', 'POST /projects/:id/surveys', 'POST /projects/:id/tasks',
    'POST /publishes/:id/label', 'POST /publishes/checkpoints', 'POST /publishes/checkpoints/:id/restore',
    'POST /redirects', 'POST /restore-to-draft', 'POST /review/reports/:id/dismiss', 'POST /review/run',
    'POST /reviews/:id/approve', 'POST /reviews/:id/hide', 'POST /reviews/:id/reply', 'POST /sales/contacts',
    'POST /sales/contacts/:id/restore', 'POST /sales/contracts/:id/send', 'POST /sales/contracts/:id/term',
    'POST /sales/customers', 'POST /sales/deals', 'POST /sales/deals/:id/activity',
    'POST /sales/deals/:id/contracts', 'POST /sales/deals/:id/convert', 'POST /sales/deals/:id/invoice',
    'POST /sales/deals/:id/proposals', 'POST /sales/deals/:id/resend-invite', 'POST /sales/deals/:id/retainer',
    'POST /sales/deals/:id/schedule', 'POST /sales/deals/:id/send', 'POST /sales/deals/:id/stage',
    'POST /sales/deals/:id/tasks', 'POST /sales/invoices/:id/send', 'POST /sales/proposals/:id/revise',
    'POST /sales/proposals/:id/send', 'POST /sales/templates', 'POST /stock/import', 'POST /support',
    'POST /visual/generate', 'POST /visual/plans/:id/edit', 'POST /visual/plans/:id/vary',
    'POST /writer/drafts/:id/accept', 'POST /writer/drafts/:id/discard', 'POST /writer/generate',
    'POST /writer/rewrite', 'PUT /content-library/:id', 'PUT /media/:id', 'PUT /sales/services', 'PUT /service/faq',
    'PUT /service/saved-replies', 'PUT /sales/views',
  ],
  open: [
    'DELETE /crm/notes/:id', 'POST /client/notifications/read', 'POST /concierge/ask', 'POST /crm/notes',
    'POST /crm/notes/:id/pin', 'POST /dev/brand-kit/apply', 'POST /notifications/read', 'POST /portal/members',
    'POST /portal/members/:id/revoke', 'POST /portal/shares', 'POST /threads/read', 'PUT /dev/brand-kit',
    'PUT /dev/customization', 'PUT /site/template',
  ],
};
const ALL = Object.entries(DECIDED).flatMap(([need, names]) => names.map((name) => ({ name, need })));

// ═══ 1. the list says what was decided ═══
{
  for (const { name, need } of ALL) ok(`list: ${name} needs ${need}`, memberWriteNeeds(pathOf(name), methodOf(name)) === need, String(memberWriteNeeds(pathOf(name), methodOf(name))));
  ok('list: nothing was classified twice', new Set(ALL.map((r) => r.name)).size === ALL.length);
  const has = (need, ...names) => names.every((n) => DECIDED[need].includes(n));
  ok('decided: withdrawing an invoice and cancelling a retainer count as delete', has('delete', 'POST /sales/invoices/:id/void', 'POST /sales/deals/:id/retainer/cancel'));
  ok('decided: taking the site offline and back is configure, not publish', has('configure', 'POST /site/offline', 'POST /site/online'));
  ok('decided: domain, DNS and zone deletes are configure, so a developer keeps them', has('configure', 'DELETE /foundations/domain', 'DELETE /foundations/zone', 'DELETE /foundations/zone/records'));
  ok('decided: the everyday lists stay edit', has('edit', 'PUT /sales/services', 'PUT /service/faq', 'PUT /service/saved-replies', 'POST /bookings/types', 'PATCH /bookings/types/:id', 'POST /redirects'));
  ok('decided: archiving a file is not deleting it', has('edit', 'POST /assets/bulk') && has('approve', 'POST /assets/:id/status'));
  ok('decided: staff can still send what they can\'t withdraw', has('edit', 'POST /sales/deals/:id/invoice', 'POST /sales/invoices/:id/send') && has('publish', 'POST /broadcasts/:id/send'));

  const CONTENT = [['PUT', '/identity'], ['PUT', '/location'], ['PUT', '/voice'], ['PUT', '/settings'], ['PUT', '/brand/profile'], ['POST', '/pages/duplicate'], ['POST', '/offerings'], ['PUT', `/posts/${ROW}`], ['DELETE', `/faqs/${ROW}`]];
  ok('list: the content routes answer from contentWriteNeeds, and only there', CONTENT.every(([m, r]) => contentWriteNeeds(r, m) !== null && memberWriteNeeds(r, m) === null));
  ok('list: nothing here is on the content path', ALL.every(({ name }) => contentWriteNeeds(pathOf(name), methodOf(name)) === null));
  ok('list: a read is not its business', memberWriteNeeds('/media', 'GET') === null && memberWriteNeeds('/export', 'GET') === null);
}

// ═══ 2. what the gate does with it, for every role, on every route ═══
{
  for (const role of SITE_ROLES) {
    const wrong = [];
    for (const { name, need } of ALL) {
      const seat = { site_id: SITE_A, role };
      const r = await memberWriteGate(req(methodOf(name), pathOf(name), {}), pathOf(name), methodOf(name), seat, cors);
      const allowed = need === 'open' || siteCan(role, need);
      if ((r === null) !== allowed || (r && r.status !== 403) || seat.cleared) wrong.push(name);
    }
    ok(`gate: ${role} gets exactly what the table gives, and is never cleared for siteDb`, wrong.length === 0, wrong.join(', '));
  }
  const refused = (role, cap) => ALL.filter(({ need }) => need === cap && !siteCan(role, cap)).length;
  ok('gate: staff lose delete and configure', refused('business_staff', 'delete') === DECIDED.delete.length && refused('business_staff', 'configure') === DECIDED.configure.length);
  ok('gate: a developer loses delete and keeps configure', refused('developer', 'delete') === DECIDED.delete.length && refused('developer', 'configure') === 0);
  ok('gate: an owner seat loses nothing', ['delete', 'configure', 'edit', 'publish', 'connect', 'approve', 'comment'].every((c) => refused('business_owner', c) === 0));
  ok('gate: staff and developers keep everything else', ['edit', 'publish', 'connect', 'approve', 'comment'].every((c) => refused('business_staff', c) === 0 && refused('developer', c) === 0));

  const UNLISTED = [['POST', '/brand-new-route'], ['DELETE', `/projects/${ROW}`], ['DELETE', `/media/${ROW}/extra`], ['DELETE', '/media/not-a-uuid'], ['PUT', `/redirects/${ROW}`], ['PATCH', '/publish']];
  for (const [m, r] of UNLISTED) {
    for (const role of SITE_ROLES) {
      const res = await memberWriteGate(req(m, r, {}), r, m, { site_id: SITE_A, role }, cors);
      ok(`gate: ${m} ${r} is on no list, so ${role} is refused`, res?.status === 403);
    }
  }
  const seat = { site_id: SITE_A, role: 'business_staff' };
  ok('gate: a content write they may make is still cleared for siteDb', await memberWriteGate(req('PUT', '/identity', {}), '/identity', 'PUT', seat, cors) === null && seat.cleared === true);
  await memberWriteGate(req('POST', '/publish', {}), '/publish', 'POST', seat, cors);
  ok('gate: …and a write off that path resets it, so siteDb stays shut', seat.cleared === false);
}

// ═══ 3. a reviewer keeps exactly what the boundary gives them ═══
{
  const REVIEWER = ALL.filter(({ name }) => reviewerAllowed(pathOf(name), methodOf(name)));
  ok('reviewer: the boundary lets through the four sign-offs and nothing else on this list',
    JSON.stringify(REVIEWER.map((r) => r.name).sort()) === JSON.stringify(['POST /assets/:id/status', 'POST /connections/:key/write/:id/decide', 'POST /foundations/plans/:id/decide', 'POST /launches/:id/decide']), REVIEWER.map((r) => r.name).join(', '));
  ok('reviewer: all four need approve, which the table gives them', REVIEWER.every((r) => r.need === 'approve') && siteCan('client_reviewer', 'approve'));
  for (const { name } of REVIEWER) ok(`reviewer: the gate passes ${name}`, await memberWriteGate(req('POST', pathOf(name), {}), pathOf(name), 'POST', { site_id: SITE_A, role: 'client_reviewer' }, cors) === null);
}

// ═══ 4. every route that changed, through the gate and the real handler ═══
const CHANGED = [
  { name: 'DELETE /media/:id', fx: { only: ['presence_media'] }, run: (r, p) => handleMediaDelete(A, p, ROW, cors) },
  { name: 'DELETE /assets/:id', fx: { only: ['presence_media'] }, run: (r, p) => handleAssetDelete(A, p, ROW, cors) },
  { name: 'DELETE /redirects/:id', run: (r, p) => handleRedirectDelete(A, p, ROW, cors) },
  { name: 'DELETE /content-library/:id', run: (r, p) => handleContentLibraryDelete(A, p, ROW, cors) },
  { name: 'DELETE /publishes/checkpoints/:id', run: (r, p) => handleCheckpointDelete(A, p, ROW, cors) },
  { name: 'DELETE /bookings/types/:id', run: (r, p) => handleBookingTypeDelete(A, ROW, p, cors) },
  { name: 'DELETE /knowledge/docs/:id', run: (r, p) => handleKnowledgeDelete(A, ROW, p, cors) },
  { name: 'POST /comments/:id/delete', run: (r, p) => handleCommentDelete(A, p, ROW, cors) },
  { name: 'DELETE /sales/contacts/:id', query: '?confirm=1', run: (r, p) => handleSalesContact(r, A, p, ROW, cors) },
  { name: 'DELETE /sales/deals/:id', run: (r, p) => handleSalesDeal(r, A, p, ROW, cors) },
  { name: 'DELETE /sales/proposals/:id', run: (r, p) => handleSalesProposalDelete(A, p, ROW, cors) },
  { name: 'DELETE /sales/contracts/:id', run: (r, p) => handleSalesContractDelete(A, p, ROW, cors) },
  { name: 'DELETE /sales/templates/:id', run: (r, p) => handleSalesTemplateDelete(A, ROW, cors) },
  { name: 'DELETE /projects/:id/deliverables/:id2', run: (r, p) => handleDeliverable(r, p.jwt, A, p, ROW, ROW2, cors) },
  { name: 'POST /sales/invoices/:id/void', run: (r, p) => handleSalesInvoiceVoid(A, p, ROW, cors) },
  { name: 'DELETE /broadcasts/lists/:id', fx: { only: ['presence_sales_templates'], rows: { presence_sales_templates: { body: JSON.stringify([{ id: ROW, name: 'Picked', people: [{ email: 'a@example.com' }], created_at: '2026-01-01T00:00:00Z' }]) } } }, run: (r, p) => handleBroadcastListDelete(A, p, ROW, cors) },
  { name: 'POST /sales/deals/:id/retainer/cancel', fx: { rows: { presence_deals: { retainer: { status: 'pending' } } } }, run: (r, p) => handleSalesRetainerCancel(r, A, p, ROW, cors) },
  { name: 'POST /foundations/domain', body: { domain: 'beta.example' }, run: (r, p) => handleDomain(r, 'POST', A, p, cors) },
  { name: 'DELETE /foundations/domain', run: (r, p) => handleDomain(r, 'DELETE', A, p, cors) },
  { name: 'PUT /foundations/dns', body: { records: [{ type: 'TXT', name: '@', value: 'v', ttl: 300 }] }, run: (r, p) => handleDnsPut(r, A, p, cors) },
  { name: 'POST /foundations/dns/rollback', fx: { rows: { presence_dns_zone_history: { saved_at: '2026-01-01T00:00:00Z', records: [] } } }, body: { history_id: ROW }, run: (r, p) => handleDnsRollback(r, A, p, cors) },
  { name: 'POST /foundations/zone', body: { domain: 'alpha.example' }, run: (r, p) => handleZoneCreate(r, A, p, cors) },
  { name: 'DELETE /foundations/zone', body: { confirm: true }, run: (r, p) => handleZoneDelete(r, A, p, cors) },
  { name: 'POST /foundations/zone/records', body: { type: 'TXT', name: '@', value: 'v', ttl: 300 }, run: (r, p) => handleZoneRecords(r, 'POST', A, p, cors) },
  { name: 'PUT /foundations/zone/records', body: { type: 'TXT', name: '@', value: 'v', ttl: 300 }, run: (r, p) => handleZoneRecords(r, 'PUT', A, p, cors) },
  { name: 'DELETE /foundations/zone/records', body: { type: 'TXT', name: '@', value: 'v' }, run: (r, p) => handleZoneRecords(r, 'DELETE', A, p, cors) },
  { name: 'POST /foundations/prepare', body: { goal: 'email_auth' }, run: (r, p) => handleFoundationsPrepare(r, A, p, cors) },
  { name: 'POST /preview/settings', body: {}, run: (r, p) => handlePreviewSettings(r, A, p, cors) },
  { name: 'PUT /bookings/settings', body: { enabled: true }, run: (r, p) => handleBookingSettingsPut(r, A, p, cors) },
  { name: 'PUT /sales/contacts/fields', body: { fields: [{ label: 'A' }] }, run: (r, p) => handleSalesContactFields(r, A, p, cors) },
  { name: 'PUT /sales/stages', body: { names: { lead: 'Enquiry' } }, run: (r, p) => handleSalesStages(r, A, p, cors) },
  { name: 'POST /calendar/link', run: (r, p) => handleCalendarLink(r, A, p, cors) },     // sales review item 46
  { name: 'DELETE /calendar/link', run: (r, p) => handleCalendarLink(r, A, p, cors) },
  { name: 'POST /site/offline', run: (r, p) => handleTakeOffline(A, p, cors) },
  { name: 'POST /site/online', fx: { site: { offline_at: '2026-01-01T00:00:00Z' } }, run: (r, p) => handleBackOnline(A, p, cors) },
];
{
  const expected = ALL.filter(({ need }) => need === 'delete' || need === 'configure').map((r) => r.name).sort();
  ok('changed: this section drives every delete and configure route', JSON.stringify(CHANGED.map((w) => w.name).sort()) === JSON.stringify(expected), expected.filter((n) => !CHANGED.some((w) => w.name === n)).join(', '));
  const drive = quiet(async (w, p) => {
    const r = req(methodOf(w.name), pathOf(w.name) + (w.query || ''), w.body);
    return answer(await w.run(r, p));
  });
  const asMember = quiet(async (w, p) => {
    const route = pathOf(w.name), method = methodOf(w.name);
    const r = req(method, route + (w.query || ''), w.body);
    const refused = await memberWriteGate(r, route, method, p.member, cors);
    return answer(refused || await w.run(r, p));
  });
  const needOf = (name) => ALL.find((r) => r.name === name).need;
  for (const w of CHANGED) {
    reset(w.fx);
    const mine = await drive(w, owner());
    const ownerWrote = reached();
    ok(`${w.name} owner: reaches its write`, ownerWrote, `${mine.status} ${mine.body?.error ?? ''}`);
    for (const [role, jwt] of SEATS) {
      reset(w.fx);
      const out = await asMember(w, seated(jwt, role));
      if (siteCan(role, needOf(w.name))) {
        ok(`${w.name} ${role}: the owner's answer, and the write happens`, out.status === mine.status && reached(), `${out.status} ${out.body?.error ?? ''}`);
      } else {
        ok(`${w.name} ${role}: refused, nothing written, nothing sent`, out.status === 403 && out.body?.error === 'forbidden' && wrote() === 0 && outside.length === 0, `${out.status} ${out.body?.error ?? ''}`);
      }
    }
    // these never meet the gate: index.ts stamps principal.member for a seated client alone
    for (const [label, who] of [['a studio scoped in', scopedStudio], ['platform staff', platformStaff]]) {
      reset(w.fx);
      const out = await drive(w, who());
      ok(`${w.name} ${label}: the owner's answer, and the write happens`, out.status === mine.status && reached(), `${out.status} ${out.body?.error ?? ''}`);
    }
  }
}

// ═══ 5. a failed role read hands nobody the owner's powers ═══
// resolveSiteRole answers business_owner after a failed read. These routes used to ask
// it directly, so one bad read made a staff member or a reviewer the owner.
{
  const failing = quiet(async (p, run) => {
    reset();
    failSeatReads = true;
    const out = await answer(await run(p));
    return { ...out, wrote: wrote() };
  });
  const template = (p) => handlePutTemplate(req('PUT', '/site/template', { slug: 'business-classic' }), p.jwt, A, p, cors);
  const status = (action) => (p) => handleAssetStatus(req('POST', `/assets/${ROW}/status`, { action }), A, p, ROW, cors);
  const palette = (p) => handleDevCustomizationPut(req('PUT', '/dev/customization', { theme_tokens: {} }), p.jwt, A, p, cors);
  const kit = (p) => handleBrandKitPut(req('PUT', '/dev/brand-kit', { primary: '#2f5d8a' }), p.jwt, A, p, cors);
  const refused = (o) => o.status === 403 && o.wrote === 0;

  ok('failed read: staff can\'t change the look', refused(await failing(seated('jwt-staff', 'business_staff'), template)));
  ok('failed read: a developer can\'t change the look', refused(await failing(seated('jwt-dev', 'developer'), template)));
  ok('failed read: staff can\'t restyle the site', refused(await failing(seated('jwt-staff', 'business_staff'), palette)));
  ok('failed read: staff can\'t set the brand kit', refused(await failing(seated('jwt-staff', 'business_staff'), kit)));
  ok('failed read: a reviewer can\'t archive a file', refused(await failing(seated('jwt-reviewer', 'client_reviewer'), status('archive'))));
  ok('failed read: a reviewer can\'t publish a file', refused(await failing(seated('jwt-reviewer', 'client_reviewer'), status('publish'))));
  ok('failed read: a reviewer can still approve a file', (await failing(seated('jwt-reviewer', 'client_reviewer'), status('approve'))).status !== 403);
  ok('failed read: a developer keeps developer mode', (await failing(seated('jwt-dev', 'developer'), palette)).status === 200);
  ok('failed read: an owner seat keeps the look', (await failing(seated('jwt-coowner', 'business_owner'), template)).status === 200);

  const unchanged = async (p) => (await failing(p, template)).status === 200;
  ok('failed read: the owner with no seat keeps today\'s answer', await unchanged(owner()));
  ok('failed read: platform staff keep today\'s answer', await unchanged(platformStaff()));
  ok('failed read: a studio scoped in keeps today\'s answer', await unchanged(scopedStudio()));

  reset();
  const launch = (p) => handleLaunchDecide(req('POST', `/launches/${ROW}/decide`, { decision: 'approve' }), p.jwt, A, p, ROW, cors);
  ok('a reviewer can still sign off a launch', (await answer(await launch(seated('jwt-reviewer', 'client_reviewer')))).status === 200);

  reset();
  const once = seated('jwt-staff', 'business_staff');
  await template(once);
  const before = calls.length;
  failSeatReads = true;
  ok('the role is read once per request', (await answer(await template(once))).status === 403 && calls.length === before);
  reset();
  ok('a seat on another site doesn\'t speak for this one', await resolveSiteRoleCached(principalOf('jwt-staff', { member: { site_id: uuid('b'), role: 'developer' } }), 'jwt-staff', SITE_A) !== 'developer');
}

// ═══ 6. wiring: what production runs, and what fails when someone adds a route ═══
// A new write handler fails here until someone decides what it needs in lib/site_roles.ts
// and adds it to DECIDED and to this list. At runtime an unlisted write is refused anyway.
const WRITE_HANDLERS = [
  'handleVisibilityCheck', 'handleApprovalDecide', 'handleApprovalsCreate', 'handleApproveSend', 'handleAssetDelete', 'handleAssetDuplicate',
  'handleAssetRemoveBackground', 'handleAssetReplace', 'handleAssetRollback', 'handleAssetStatus',
  'handleAssetSuggest', 'handleAssetUpdate', 'handleAssetsBulk', 'handleBackOnline', 'handleBookingCancel',
  'handleBookingConfirm', 'handleBookingMark', 'handleBookingSettingsPut', 'handleBookingTypeCreate',
  'handleBookingTypeDelete', 'handleBookingTypeUpdate', 'handleBrandKitApply', 'handleBrandKitPut',
  'handleBrandProfilePut', 'handleBrandReportDismiss', 'handleBrandReviewRun', 'handleBroadcastCancel',
  'handleBroadcastCreate', 'handleBroadcastDraftAssist', 'handleBroadcastListCreate', 'handleBroadcastListDelete', 'handleBroadcastSend', 'handleBroadcastUpdate',
  'handleCheckpointDelete', 'handleCheckpointRestore', 'handleCheckpointSave', 'handleClientApprovalDecide',
  'handleClientMessages', 'handleClientNotificationsRead', 'handleClientSupport', 'handleClientSupportMessage',
  'handleClientSurveyRespond', 'handleClientTaskDone', 'handleClientUploadCreate', 'handleClientUploadUrl',
  'handleCoachDecide', 'handleCoachRun', 'handleCollection', 'handleCommentCreate', 'handleCommentDelete',
  'handleCommentResolve', 'handleConciergeAsk', 'handleConnectionAsk', 'handleConnectionCallback',
  'handleConnectionConnect', 'handleConnectionDisconnect', 'handleConnectionPropertySelect',
  'handleConnectionRefresh', 'handleContentLibraryDelete', 'handleContentLibrarySave', 'handleContentLibraryUpdate',
  'handleCrmNoteAdd', 'handleCrmNoteDelete', 'handleCrmNotePin', 'handleDealTaskCreate', 'handleDealTaskUpdate',
  'handleDeliverable', 'handleDeliverableUploadUrl', 'handleDeliverablesCreate', 'handleDevCustomizationPut',
  'handleDnsPut', 'handleDnsRollback', 'handleDomain', 'handleEditorImprove', 'handleFaqAdmin', 'handleFormReply',
  'handleFormStatus', 'handleFoundationsDecide', 'handleFoundationsPrepare', 'handleKnowledgeDelete',
  'handleKnowledgeImport', 'handleLaunchCancel', 'handleLaunchCreate', 'handleLaunchDecide', 'handleLaunchPromote',
  'handleLaunchRecapture', 'handleLaunchRollback', 'handleLaunchSchedule', 'handleLocation', 'handleMediaDelete',
  'handleMediaUpdate', 'handleMediaUpload', 'handleMemberAdd', 'handleMemberRevoke', 'handleMessages',
  'handleMilestone', 'handleMilestonesCreate', 'handleMomentDismiss', 'handleMonitorConnect',
  'handleMonitorDisconnect', 'handleMonitorVerify', 'handleNoteResolve', 'handleNotificationsRead',
  'handlePageDuplicate', 'handlePreviewPromote', 'handlePreviewPublish', 'handlePreviewSection', 'handlePreviewSettings',
  'handlePreviewShareLink', 'handleProject', 'handleProjectChecklist', 'handleProjectStatus', 'handleProjectSurveys',
  'handleProjects', 'handlePublish', 'handlePutIdentity', 'handlePutTemplate', 'handleRedirectCreate',
  'handleRedirectDelete', 'handleRestore', 'handleRestoreToDraft', 'handleReviewApprove', 'handleReviewDismiss',
  'handleReviewHide', 'handleReviewReply', 'handleReviewRequest', 'handleReviewRun', 'handleSalesAddCustomer',
  'handleSalesContact', 'handleSalesContactFields', 'handleSalesContactRestore', 'handleSalesContacts',
  'handleSalesContractCreate', 'handleSalesContractDelete', 'handleSalesContractSend', 'handleSalesContractTerm',
  'handleSalesConvert', 'handleSalesDeal', 'handleSalesDealActivity', 'handleSalesDealSend', 'handleSalesDealStage',
  'handleSalesDeals', 'handleSalesInvoice', 'handleSalesInvoiceSend', 'handleSalesInvoiceVoid',
  'handleSalesProposalCreate', 'handleSalesProposalDelete', 'handleSalesProposalRevise', 'handleSalesProposalSend',
  'handleSalesResendInvite', 'handleSalesRetainer', 'handleSalesRetainerCancel', 'handleSalesSchedule',
  'handleSalesServices', 'handleSalesTemplateDelete', 'handleSalesStages', 'handleSalesTemplates', 'handleSalesViews', 'handleSavedReplies',
  'handleCalendarLink',   // sales review item 46: POST and DELETE /calendar/link need configure
  'handleScheduleCancel', 'handleScheduleCreate', 'handleSettings', 'handleShareSet', 'handleStockImport',
  'handleSupport', 'handleSupportMessage', 'handleSupportOne', 'handleSurveyRespond', 'handleTakeOffline',
  'handleTask', 'handleTasksCreate', 'handleThreadRead', 'handleVersionLabel', 'handleVisualDecide',
  'handleVisualEdit', 'handleVisualGenerate', 'handleVisualVary', 'handleVoice', 'handleWriteDecide',
  'handleWriteExecute', 'handleWritePrepare', 'handleWriteRollback', 'handleWriterAccept', 'handleWriterDiscard',
  'handleWriterGenerate', 'handleWriterRewrite', 'handleZoneCreate', 'handleZoneDelete', 'handleZoneRecords',
];
{
  const idx = read('supabase/functions/presence/index.ts');
  const router = idx.slice(idx.indexOf('// 5. router'));
  const found = new Set();
  for (const line of router.split('\n')) {
    const readOnly = /method === 'GET'/.test(line) && !/method === '(POST|PUT|PATCH|DELETE)'/.test(line);
    if (!readOnly) for (const m of line.matchAll(/\b(handle[A-Z]\w+)\(/g)) found.add(m[1]);
  }
  const fresh = [...found].filter((h) => !WRITE_HANDLERS.includes(h));
  const gone = WRITE_HANDLERS.filter((h) => !found.has(h));
  ok('tripwire: no write handler in index.ts is undecided', fresh.length === 0, fresh.length ? `decide what a member needs for: ${fresh.join(', ')}` : '');
  ok('tripwire: the list names no handler that left', gone.length === 0, gone.join(', '));

  const at = (s) => idx.indexOf(s);
  ok('index: the gate runs for every write by a seated member, after the reviewer boundary and before any route', at("if (siteRole === 'client_reviewer'") > 0 && at("if (siteRole === 'client_reviewer'") < at('if (principal.member && isWrite) {') && at('if (principal.member && isWrite) {') < at('// 5. router'));
  ok('index: its refusal returns', /const refused = await memberWriteGate\(req, route, method, principal\.member, cors\);\s*if \(refused\) return refused;/.test(idx));
  ok('index: a seat is stamped for a client caller alone, so staff and a scoped studio never meet the gate', idx.includes("if (principal.kind === 'client') principal.member = seated.member;") && idx.split('principal.member =').length === 2);
  const beforeGate = idx.slice(idx.indexOf('async function route_'), at('if (principal.member && isWrite) {'));
  ok('index: the routes that run before the gate are the public, operator and account ones', ['/system', '/agency', '/commerce', '/admin', '/marketplace', '/enterprise', '/push/subscribe', '/help/ask'].every((r) => beforeGate.includes(`'${r}`)));

  const direct = [...Deno.readDirSync(new URL('supabase/functions/presence/routes/', ROOT))].filter((f) => f.name.endsWith('.ts') && /\bresolveSiteRole\(/.test(read(`supabase/functions/presence/routes/${f.name}`))).map((f) => f.name);
  ok('routes: none asks resolveSiteRole directly, so the seat always outranks a failed read', direct.length === 0, direct.join(', '));
  const gate = read('supabase/functions/presence/routes/workspace.ts').split('export async function memberWriteGate')[1].split('\n}')[0];
  ok('gate: there is one, and it reads both lists', gate.includes('contentWriteNeeds(route, method, fields)') && gate.includes('memberWriteNeeds(route, method)'));
  ok('gate: siteDb clearance still comes from the content list alone', gate.includes('member.cleared = !!content;'));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ MEMBER CAPABILITIES: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
Deno.exit(0);
