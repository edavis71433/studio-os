// ── Operator delivery: managing customers (FIX 5/6/7/D), checked by what the code does ──
// Builder item 212 (review finding 108) rewrote this suite: it used to match the pages' and
// routes' text; now it drives the real server code against an in-memory PostgREST
// (tests/presence/fake_pgrst.mjs) with TWO studios, and the page halves live in the browser.
//   FIX 6  the "Customers" menu item opens the roster (buildNav), and GET /studio/customers
//          (handleStudioCustomers) lists only this studio's active customers, never another's
//   FIX 5  client messages and requests are first-class in the studio's Inbox feed
//          (GET /portal/feed): open requests, project-less ones included, each grouped under
//          its customer, linked to where the studio replies, never dropped, never auto-read,
//          and only on the studio's side
//   BY-CLIENT  the feed names each conversation's customer from one batched lookup
//   FIX 7 / FIX D  customers.html, agency.html, projects.html and inbox.html: in the browser
//          (the list at the end of this file)
//
//   deno run --allow-read --allow-env --allow-net tests/presence/operator_delivery_test.mjs
import { installFakePostgrest } from './fake_pgrst.mjs';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}`);

const uuid = (c, n = 0) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${String(n).padStart(12, '0')}`;
const SITE_S = uuid('5'), SITE_T = uuid('6');          // this studio, another studio
const USERS = {
  'jwt-studio': { id: uuid('5', 9), email: 'owner@studio.example.com' },
  'jwt-other': { id: uuid('6', 9), email: 'owner@other.example.com' },
};
const db = installFakePostgrest({ users: USERS, ownSite: { 'jwt-studio': SITE_S, 'jwt-other': SITE_T } });
Deno.env.delete('RESEND_API_KEY');

const NAV = await import('../../supabase/functions/presence/lib/navigation.ts');
const ROLES = await import('../../supabase/functions/presence/lib/site_roles.ts');
const CD = await import('../../supabase/functions/presence/routes/client_delivery.ts');
const W = await import('../../supabase/functions/presence/routes/workspace.ts');

const owner = (jwt, extra = {}) => ({ kind: 'client', userId: USERS[jwt].id, tenantId: 't-1', role: 'client', email: USERS[jwt].email, jwt, requestId: 'op-delivery', scope: null, ...extra });
const reviewer = (jwt, site) => owner(jwt, { member: { site_id: site, role: 'client_reviewer' } });
const SITE_ROW = { [SITE_S]: { id: SITE_S, client_id: uuid('5', 1), status: 'live' }, [SITE_T]: { id: SITE_T, client_id: uuid('6', 1), status: 'live' } };
const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();
const gets = (frag) => db.log.filter((c) => c.method === 'GET' && c.url.includes(frag));

// ═══ FIX 6: the Customers menu item opens the roster ═══
{
  const caps = ROLES.capabilitiesOf('business_owner');
  const item = (c) => { const i = NAV.buildNav(c).find((s) => s.key === 'customers')?.items?.[0]; return i ? [i.key, i.label, i.href, !!i.hidden] : null; };
  eq('FIX6: for an owner, Customers opens the roster page', item({ role: 'business_owner', edition: 'presence', capabilities: caps, isAgency: false, isOperator: false }), ['customers', 'Customers', '/customers.html', false]);
  eq('FIX6: for a studio at its own level, Customers opens the roster page too', item({ role: 'business_owner', edition: 'presence', capabilities: caps, isAgency: true, isOperator: false }), ['customers', 'Customers', '/customers.html', false]);
  const scoped = NAV.buildNav({ role: 'business_owner', edition: 'presence', capabilities: caps, isAgency: true, isOperator: false, scoped: true });
  ok('FIX6: inside a client the roster stays one search away (All customers), never the single record', scoped.some((s) => s.items.some((i) => i.label === 'All customers' && i.href === '/customers.html' && i.hidden === true)) && !scoped.some((s) => s.key === 'customers'));
}

// ═══ FIX 6: GET /studio/customers lists THIS studio's customers ═══
const C1 = uuid('1', 1), C2 = uuid('1', 2), C5 = uuid('1', 5), C6 = uuid('1', 6), C9 = uuid('1', 9);
const P1 = uuid('7', 1), P2 = uuid('7', 2), P3 = uuid('7', 3), P5 = uuid('7', 5), P9 = uuid('7', 9);
const CS1 = uuid('a', 1);   // C1's own website
const rosterWorld = () => ({
  presence_service_links: [
    { id: uuid('8', 1), agency_site_id: SITE_S, project_id: P1, customer_client_id: C1, customer_site_id: CS1, status: 'active', created_at: minutesAgo(10) },
    { id: uuid('8', 2), agency_site_id: SITE_S, project_id: P2, customer_client_id: C2, customer_site_id: null, status: 'active', created_at: minutesAgo(20) },
    { id: uuid('8', 5), agency_site_id: SITE_S, project_id: P5, customer_client_id: C5, customer_site_id: null, status: 'ended', created_at: minutesAgo(30) },
    // a link of this studio's that points at the OTHER studio's project id
    { id: uuid('8', 6), agency_site_id: SITE_S, project_id: P9, customer_client_id: C6, customer_site_id: null, status: 'active', created_at: minutesAgo(40) },
    { id: uuid('8', 9), agency_site_id: SITE_T, project_id: P9, customer_client_id: C9, customer_site_id: null, status: 'active', created_at: minutesAgo(5) },
  ],
  clients: [
    { id: C1, name: 'Marlow’s Kitchen', email: 'jo@marlow.example.com' }, { id: C2, name: 'Beacon Bakery', email: 'bea@beacon.example.com' },
    { id: C5, name: 'Old Customer', email: 'old@example.com' }, { id: C6, name: 'Cedar Garage', email: 'cedar@example.com' },
    { id: C9, name: 'THEIR customer', email: 'their@example.com' },
  ],
  presence_projects: [
    { id: P1, site_id: SITE_S, name: 'Site build', status: 'active', client_id: C1, deleted_at: null },
    { id: P2, site_id: SITE_S, name: 'Menu refresh', status: 'on_hold', client_id: C2, deleted_at: null },
    { id: P9, site_id: SITE_T, name: 'THEIR project', status: 'active', client_id: C9, deleted_at: null },
  ],
  presence_support_requests: [
    { id: uuid('4', 1), site_id: SITE_S, project_id: P1, client_id: C1, status: 'open', requester: 'jo@marlow.example.com', deleted_at: null },
    { id: uuid('4', 2), site_id: SITE_S, project_id: null, client_id: C2, status: 'in_progress', requester: 'bea@beacon.example.com', deleted_at: null },
    { id: uuid('4', 3), site_id: SITE_S, project_id: P1, client_id: C1, status: 'resolved', requester: 'jo@marlow.example.com', deleted_at: null },
    { id: uuid('4', 9), site_id: SITE_T, project_id: P9, client_id: C9, status: 'open', requester: 'their@example.com', deleted_at: null },
  ],
});
const roster = async (jwt, principal) => {
  const r = await CD.handleStudioCustomers(new Request('https://fn.test/functions/v1/presence/studio/customers'), jwt, SITE_ROW[jwt === 'jwt-studio' ? SITE_S : SITE_T], principal, {});
  return { status: r.status, body: await r.json() };
};
{
  db.reset(rosterWorld());
  const { status, body } = await roster('jwt-studio', owner('jwt-studio'));
  const by = Object.fromEntries((body.data || []).map((c) => [c.client_id, c]));
  ok('FIX6: the roster answers 200', status === 200 && Array.isArray(body.data), String(status));
  eq('FIX6: it lists this studio’s customers with an active link, and nobody else (not an ended link, not another studio’s)', Object.keys(by).sort(), [C1, C2, C6].sort());
  eq('FIX6: each row carries what the roster draws and where it opens: the delivery project and their own site', [by[C1]?.name, by[C1]?.project_id, by[C1]?.project_name, by[C1]?.customer_site_id, by[C1]?.status], ['Marlow’s Kitchen', P1, 'Site build', CS1, 'active']);
  eq('FIX6: a customer with no site of their own says so (no Their website for them)', [by[C2]?.customer_site_id, by[C2]?.project_name, by[C2]?.status], [null, 'Menu refresh', 'on_hold']);
  eq('FIX6: open requests count against the right customer, a project-less one by its stamp; a resolved one doesn’t count', [by[C1]?.open_support, by[C2]?.open_support], [1, 1]);
  ok('FIX6: a link that points at another studio’s project never shows that project', by[C6]?.project_name === '' && !/THEIR/.test(JSON.stringify(body)), JSON.stringify(by[C6]));
  ok('FIX6: every read named this studio’s own site', gets('presence_service_links').length > 0 && gets('presence_service_links').every((c) => c.url.includes(`agency_site_id=eq.${SITE_S}`)) && gets('presence_projects').every((c) => c.url.includes(`site_id=eq.${SITE_S}`)) && gets('presence_support_requests').every((c) => c.url.includes(`site_id=eq.${SITE_S}`)), db.log.map((c) => c.url).join('\n'));
  ok('FIX6: the customers looked up are only the ones linked here', gets('/rest/v1/clients?id=in.').length === 1 && !gets('/rest/v1/clients?id=in.')[0].url.includes(C9) && !gets('/rest/v1/clients?id=in.')[0].url.includes(C5));
  const theirs = await roster('jwt-other', owner('jwt-other'));
  eq('FIX6: the other studio’s roster is theirs alone', (theirs.body.data || []).map((c) => [c.client_id, c.project_name]), [[C9, 'THEIR project']]);
  db.reset(rosterWorld());
  const rv = await roster('jwt-studio', reviewer('jwt-studio', SITE_S));
  ok('FIX6: a client reviewer is refused and nothing is read', rv.status === 403 && gets('presence_service_links').length === 0 && gets('/rest/v1/clients').length === 0, `${rv.status} ${JSON.stringify(rv.body)}`);
  db.reset({ presence_service_links: [] });
  const none = await roster('jwt-studio', owner('jwt-studio'));
  ok('FIX6: a studio with no customers yet gets an empty list (the page’s own empty state)', none.status === 200 && Array.isArray(none.body.data) && none.body.data.length === 0);
}

// ═══ FIX 5 + BY-CLIENT: the client messages in the studio's Inbox feed ═══
const SR = { NOPROJ: uuid('4', 11), ONP1: uuid('4', 12), ORPHAN: uuid('4', 13), RESOLVED: uuid('4', 14), CLOSED: uuid('4', 15), ONTHEIRS: uuid('4', 16), THEIRS: uuid('4', 19) };
const U_C1 = uuid('c', 1), CT_C1 = uuid('c', 2);
const feedWorld = () => ({
  presence_sites: [{ id: SITE_S, client_id: uuid('5', 1), status: 'live', unfinished_sections: 0 }, { id: SITE_T, client_id: uuid('6', 1), status: 'live', unfinished_sections: 0 }],
  presence_projects: [
    { id: P1, site_id: SITE_S, name: 'Site build', client_id: C1, deleted_at: null },
    { id: P2, site_id: SITE_S, name: 'Menu refresh', client_id: C2, deleted_at: null },
    { id: P3, site_id: SITE_S, name: 'Internal', client_id: null, deleted_at: null },
    { id: P9, site_id: SITE_T, name: 'THEIR project', client_id: C9, deleted_at: null },
  ],
  presence_service_links: [
    { id: uuid('8', 11), agency_site_id: SITE_S, project_id: P1, customer_client_id: C1, status: 'active' },
    { id: uuid('8', 12), agency_site_id: SITE_S, project_id: P2, customer_client_id: C2, status: 'active' },
    // the other studio's bridge comes later in the table: a feed that read it would map P1 to their customer
    { id: uuid('8', 19), agency_site_id: SITE_T, project_id: P1, customer_client_id: C9, status: 'active' },
  ],
  clients: [
    { id: C1, name: 'Marlow’s Kitchen', email: 'jo@marlow.example.com', contact_email: null, contact_id: CT_C1 },
    { id: C2, name: 'Beacon Bakery', email: 'bea@beacon.example.com', contact_email: null, contact_id: null },
    { id: C9, name: 'THEIR customer', email: 'their@example.com', contact_email: null, contact_id: null },
  ],
  contacts: [{ id: CT_C1, auth_user_id: U_C1 }],
  presence_project_events: [
    // P1: Marlow wrote, the studio answered: the studio isn't on the hook
    { id: uuid('9', 1), site_id: SITE_S, project_id: P1, kind: 'message', detail: { from: 'client' }, created_at: minutesAgo(60) },
    { id: uuid('9', 2), site_id: SITE_S, project_id: P1, kind: 'message', detail: { from: 'studio' }, created_at: minutesAgo(30) },
    // P2: the studio wrote, then Beacon: waiting on the studio
    { id: uuid('9', 3), site_id: SITE_S, project_id: P2, kind: 'message', detail: { from: 'studio' }, created_at: minutesAgo(50) },
    { id: uuid('9', 4), site_id: SITE_S, project_id: P2, kind: 'message', detail: { from: 'client' }, created_at: minutesAgo(10) },
    // P3: only the studio's own approval decision (no from): not a client conversation
    { id: uuid('9', 5), site_id: SITE_S, project_id: P3, kind: 'approval_decided', detail: { decision: 'approved' }, created_at: minutesAgo(5) },
    // the other studio's client wrote to THEM
    { id: uuid('9', 9), site_id: SITE_T, project_id: P9, kind: 'message', detail: { from: 'client' }, created_at: minutesAgo(1) },
  ],
  presence_support_requests: [
    // project-less and unstamped: Beacon emailed in from their sign-in address
    { id: SR.NOPROJ, site_id: SITE_S, subject: 'Can you add our new menu?', status: 'open', priority: 'normal', project_id: null, client_id: null, requester: 'bea@beacon.example.com', created_at: minutesAgo(40), updated_at: minutesAgo(40), deleted_at: null },
    { id: SR.ONP1, site_id: SITE_S, subject: 'Logo tweak', status: 'in_progress', priority: 'high', project_id: P1, client_id: C1, requester: U_C1, created_at: minutesAgo(45), updated_at: minutesAgo(45), deleted_at: null },
    // nobody we know: it opens on its own page
    { id: SR.ORPHAN, site_id: SITE_S, subject: 'Who do I talk to?', status: 'open', priority: 'normal', project_id: null, client_id: null, requester: 'stranger@example.com', created_at: minutesAgo(35), updated_at: minutesAgo(35), deleted_at: null },
    { id: SR.RESOLVED, site_id: SITE_S, subject: 'All sorted', status: 'resolved', priority: 'normal', project_id: P1, client_id: C1, requester: U_C1, created_at: minutesAgo(90), updated_at: minutesAgo(90), deleted_at: null },
    { id: SR.CLOSED, site_id: SITE_S, subject: 'Closed one', status: 'closed', priority: 'normal', project_id: P2, client_id: C2, requester: 'bea@beacon.example.com', created_at: minutesAgo(95), updated_at: minutesAgo(95), deleted_at: null },
    // a request on this studio's site naming the other studio's project id
    { id: SR.ONTHEIRS, site_id: SITE_S, subject: 'Odd project', status: 'open', priority: 'normal', project_id: P9, client_id: null, requester: 'odd@example.com', created_at: minutesAgo(25), updated_at: minutesAgo(25), deleted_at: null },
    { id: SR.THEIRS, site_id: SITE_T, subject: 'THEIR request', status: 'open', priority: 'normal', project_id: null, client_id: null, requester: 'jo@marlow.example.com', created_at: minutesAgo(2), updated_at: minutesAgo(2), deleted_at: null },
  ],
  presence_support_messages: [],
});
const feedAs = async (jwt, principal) => {
  const r = await W.handlePortalFeed(jwt, SITE_ROW[SITE_S], principal, {});
  return { status: r.status, data: (await r.json()).data };
};
{
  db.reset(feedWorld());
  const { status, data } = await feedAs('jwt-studio', owner('jwt-studio'));
  const rows = data.client_messages || [];
  const sup = (id) => rows.find((r) => r.type === 'support' && r.id === id);
  const msg = (pid) => rows.find((r) => r.type === 'message' && r.project_id === pid);
  ok('FIX5: the studio’s feed carries the client messages, the enquiries and whether either list was cut', status === 200 && Array.isArray(data.client_messages) && Array.isArray(data.enquiries) && data.client_messages_more === false && data.enquiries_more === false, JSON.stringify(Object.keys(data || {})));
  eq('FIX5: open and in-progress requests are listed, project-less ones included; resolved and closed ones are not', [SR.NOPROJ, SR.ONP1, SR.ORPHAN, SR.ONTHEIRS].map((id) => !!sup(id)).concat([SR.RESOLVED, SR.CLOSED].map((id) => !!sup(id))), [true, true, true, true, false, false]);
  eq('FIX5: one conversation row per project the client wrote on; the studio’s own approval decision is not a conversation', [!!msg(P1), !!msg(P2), !!msg(P3)], [true, true, false]);
  eq('FIX5: whose turn it is comes from who wrote last (from=client): Marlow was answered, Beacon is waiting', [msg(P1)?.needs_reply, msg(P2)?.needs_reply], [false, true]);
  eq('BYCLIENT: each conversation names its customer', [[msg(P1)?.client_id, msg(P1)?.client], [msg(P2)?.client_id, msg(P2)?.client]], [[C1, 'Marlow’s Kitchen'], [C2, 'Beacon Bakery']]);
  eq('BYCLIENT: a project-less request is grouped under the customer it came from', [sup(SR.NOPROJ)?.client_id, sup(SR.NOPROJ)?.client], [C2, 'Beacon Bakery']);
  eq('BYCLIENT: a request on a project names that project’s customer', [sup(SR.ONP1)?.client_id, sup(SR.ONP1)?.client, sup(SR.ONP1)?.project], [C1, 'Marlow’s Kitchen', 'Site build']);
  eq('FIX5: each row links to where the studio replies: the customer’s record on their project', [msg(P1)?.href, sup(SR.ONP1)?.href, sup(SR.NOPROJ)?.href], [`/crm.html?project=${P1}&tab=messages`, `/crm.html?project=${P1}&tab=messages`, `/crm.html?project=${P2}&tab=messages`]);
  eq('FIX5: a request tied to nobody we know opens on its own page instead of being dropped', [sup(SR.ORPHAN)?.href, sup(SR.ORPHAN)?.client_id], [`/projects.html?support=${SR.ORPHAN}`, '']);
  ok('FIX5: nothing of the other studio’s comes back: not their request, their client’s message, their project or their customer', !sup(SR.THEIRS) && !rows.some((r) => r.project_id === P9 && r.type === 'message') && !/THEIR/.test(JSON.stringify(data)) && sup(SR.ONTHEIRS)?.project === '', JSON.stringify(rows.map((r) => [r.type, r.subject || r.project, r.client])));
  ok('FIX5: every request, event and project read named this studio’s site', ['presence_support_requests', 'presence_project_events', 'presence_projects'].every((t) => gets(`/rest/v1/${t}?`).every((c) => c.url.includes(`site_id=eq.${SITE_S}`))) && gets('/rest/v1/presence_service_links?agency_site_id=').every((c) => c.url.includes(`agency_site_id=eq.${SITE_S}`)), db.log.filter((c) => c.method === 'GET').map((c) => c.url).join('\n'));
  const clientReads = gets('/rest/v1/clients?id=in.');
  ok('BYCLIENT: the customers are looked up in ONE batched read, of this studio’s customers only', clientReads.length === 1 && clientReads[0].url.includes(C1) && clientReads[0].url.includes(C2) && !clientReads[0].url.includes(C9), clientReads.map((c) => c.url).join('\n'));
  ok('BYCLIENT: the project names come from one read too', gets('/rest/v1/presence_projects?id=in.').length === 1);
}
{
  // many customers: still one read each (no N+1)
  const many = feedWorld();
  for (let i = 0; i < 6; i++) {
    const pid = uuid('b', 100 + i), cid = uuid('d', 100 + i);
    many.presence_projects.push({ id: pid, site_id: SITE_S, name: `Project ${i}`, client_id: cid, deleted_at: null });
    many.presence_service_links.push({ id: uuid('e', 100 + i), agency_site_id: SITE_S, project_id: pid, customer_client_id: cid, status: 'active' });
    many.clients.push({ id: cid, name: `Customer ${i}`, email: `c${i}@example.com`, contact_email: null, contact_id: null });
    many.presence_project_events.push({ id: uuid('f', 100 + i), site_id: SITE_S, project_id: pid, kind: 'message', detail: { from: 'client' }, created_at: minutesAgo(100 + i) });
  }
  db.reset(many);
  const { data } = await feedAs('jwt-studio', owner('jwt-studio'));
  ok('BYCLIENT: eight customers still cost one customers read and one projects read', (data.client_messages || []).filter((r) => r.type === 'message').length === 8 && gets('/rest/v1/clients?id=in.').length === 1 && gets('/rest/v1/presence_projects?id=in.').length === 1 && (data.client_messages || []).filter((r) => /^Customer \d$/.test(r.client)).length === 6, `${gets('/rest/v1/clients?id=in.').length} ${gets('/rest/v1/presence_projects?id=in.').length}`);
}
{
  // opening the Inbox never marks these read: the read marks only light or dim a row's dot
  const w = feedWorld();
  const later = new Date(Date.now() + 86_400_000).toISOString();
  w.presence_activity_reads = [{ site_id: SITE_S, reader: USERS['jwt-studio'].id, last_seen_at: later }, { site_id: SITE_S, reader: USERS['jwt-studio'].email, last_seen_at: later }];
  w.presence_thread_reads = [`client:${C1}`, `client:${C2}`, `support:${SR.NOPROJ}`, `support:${SR.ONP1}`, `support:${SR.ORPHAN}`, `support:${SR.ONTHEIRS}`].map((k) => ({ site_id: SITE_S, reader: USERS['jwt-studio'].id, thread_key: k, last_seen_at: later }));
  db.reset(w);
  const first = await feedAs('jwt-studio', owner('jwt-studio'));
  const second = await feedAs('jwt-studio', owner('jwt-studio'));
  const listed = (d) => (d.client_messages || []).map((r) => r.thread_key).sort();
  ok('FIX5: a studio that has seen everything still has every open conversation listed (dots off, rows on)', listed(first.data).length === 6 && (first.data.client_messages || []).every((r) => r.unread === false), JSON.stringify((first.data.client_messages || []).map((r) => [r.thread_key, r.unread])));
  ok('FIX5: reading the feed marks nothing read, so the rows are still there the next time', JSON.stringify(listed(second.data)) === JSON.stringify(listed(first.data)) && db.writes('presence_activity_reads').length === 0 && db.writes('presence_thread_reads').length === 0);
}
{
  // the studio's side only: a client reviewer on the site gets none of it, and nothing is read
  db.reset(feedWorld());
  const { status, data } = await feedAs('jwt-studio', reviewer('jwt-studio', SITE_S));
  ok('FIX5: a client reviewer gets no client messages and no enquiries, and the feed never reads them', status === 200 && JSON.stringify(data.client_messages) === '[]' && JSON.stringify(data.enquiries) === '[]' && gets('presence_support_requests').length === 0 && gets('presence_project_events').length === 0 && gets('/rest/v1/clients').length === 0, `${status} ${JSON.stringify(data).slice(0, 200)}`);
}

// ═══ the pages: customers.html, agency.html, projects.html and inbox.html ═══
// Covered in the browser by:
//   tests/e2e/rosters.spec.ts › table rows open the client record; row action stays separate
//       (customers.html draws /studio/customers; Open record on every row, Their website only with a site)
//   tests/e2e/operator-delivery-212.spec.ts › FIX6: a studio with no customers yet is told so in plain words, with the way to the pipeline
//   tests/e2e/operator-delivery-212.spec.ts › FIX7: Open record opens the customer’s record, by their site when they have one, else by their id; Their website opens their site in the editor
//   tests/e2e/agency.spec.ts › row drill-ins carry the client scope (SC-1): delivery project + plain record
//       (agency.html maps each site to its delivery project from /studio/customers and opens crm.html?project=)
//   tests/e2e/agency.spec.ts › table view: Name · Status · Next · Outstanding, one button and a ⋯ — never Edition/Waiting/Leads/Domain
//   tests/e2e/agency.spec.ts › the ⋯ menu: "Their website" opens the client’s website editor in their scope; Escape closes the menu back to the ⋯
//       (Their website moved from the row into its ⋯ menu)
//   tests/e2e/operator-delivery-212.spec.ts › FIXD: a project opens as a full-screen view on the page, never a dialog, with every section; the breadcrumb puts the list back
//       (also: Projects draws no studio-wide list of client messages and never reads the studio-wide /support list)
//   tests/e2e/projects.spec.ts › a row opens the record in-page and keeps the ?client= scope; breadcrumb returns
//   tests/e2e/operator-delivery-212.spec.ts › FIXD: a record that won’t load says so, and ← Back to projects returns to the list
//       (← Back to projects is now the error state's way out; the breadcrumb is the everyday one)
//   tests/e2e/projects.spec.ts › ?support= deep-link boots straight into the full conversation surface with the reply wired
//   tests/e2e/operator-delivery-212.spec.ts › BYCLIENT: a customer’s general messages are listed, opened and answered inside their record
//   tests/e2e/inbox.spec.ts › list pane renders every conversation kind with unread dots + meta line
//       (feed.client_messages are rows of the Inbox list; the old "Messages from your clients" heading is gone,
//       and the old check matched those words in a code comment)
//   tests/e2e/inbox.spec.ts › a client-message row opens the record timeline + Message composer in place   (Open full record → crm.html?client_id=)
//   tests/e2e/inbox.spec.ts › the client lens is one action from the list header and narrows to that client   (one row per client)
//   tests/e2e/operator-delivery-212.spec.ts › FIX5 + BYCLIENT: client conversations count in the Inbox, one row per client with their initials, an unread dot and the message count

const passed = results.filter((r) => r.p).length;
console.log(`\n════ OPERATOR DELIVERY (FIX 5/6/7/D): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
