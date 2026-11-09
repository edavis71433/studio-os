// ── Support requests that named nobody (sales review, Nov 2026, B2) ─────────
//   deno run --allow-read --allow-env --allow-net tests/presence/support_owners_test.mjs
//
// Live on Nov 8 2026: five open support requests from July read "A customer" on
// Home and "Support request" in the Inbox, and Customers said their customer was
// "all clear". They were filed before the write-time stamp (0115) with the
// customer's SIGN-IN ID as requester, and the customer was tied to the workspace
// by EMAIL, so no read path could match them. This pins:
//   1. healSupportOwners resolves an unstamped, project-less request through the
//      sign-in's email (auth admin), gated on an ACTIVE bridge to this studio,
//      and stamps it only where the stamp is still null;
//   2. a request that names no customer comes back with the sender's email;
//   3. stamped rows and project rows are never touched; the sign-in lookup is
//      cached; nothing throws on a failed read;
//   4. Home's Needs-you names a request by its stamp, then its project, then the
//      sender's email, and only then "A customer";
//   5. every read path is wired to it (Inbox, Home, Customers, record, project).
Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c) => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n); } };
const eq = (n, a, b) => ok(`${n} (got ${JSON.stringify(a)})`, JSON.stringify(a) === JSON.stringify(b));
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));

const AGENCY = '11111111-1111-4111-8111-111111111111';
const UID_CUSTOMER = '0c0c0c0c-0000-4000-8000-000000000001';
const UID_NOBODY = '0d0d0d0d-0000-4000-8000-000000000002';
const CLIENT_H = '22222222-2222-4222-8222-222222222222';
const R1 = 'a1a1a1a1-0000-4000-8000-00000000000a';   // the customer, unstamped, project-less
const R2 = 'a2a2a2a2-0000-4000-8000-00000000000a';   // the customer again (same requester → one lookup)
const R3 = 'a3a3a3a3-0000-4000-8000-00000000000a';   // a sign-in that is no customer
const R4 = 'a4a4a4a4-0000-4000-8000-00000000000a';   // already stamped
const R5 = 'a5a5a5a5-0000-4000-8000-00000000000a';   // on a project
const R6 = 'a6a6a6a6-0000-4000-8000-00000000000a';   // requester is an email

const calls = [];
const jr = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, init = {}) => {
  const u = String(url); const method = (init.method || 'GET').toUpperCase();
  calls.push({ u, method, body: init.body ? String(init.body) : '' });
  if (u.includes('/auth/v1/admin/users/')) {
    if (u.endsWith(UID_CUSTOMER)) return jr({ id: UID_CUSTOMER, email: 'Owner@MapleStreet.test' });
    if (u.endsWith(UID_NOBODY)) return jr({ id: UID_NOBODY, email: 'owner@studio.test' });
    return jr({ msg: 'not found' }, 404);
  }
  if (u.includes('/rest/v1/clients?or=')) {
    return jr(decodeURIComponent(u).toLowerCase().includes('owner@maplestreet.test') ? [{ id: CLIENT_H, email: 'owner@maplestreet.test', contact_email: null }] : []);
  }
  if (u.includes('/rest/v1/contacts?auth_user_id=')) return jr([]);
  if (u.includes('/rest/v1/presence_service_links?agency_site_id=')) return jr(u.includes(CLIENT_H) ? [{ customer_client_id: CLIENT_H }] : []);
  if (u.includes('/rest/v1/presence_support_requests?id=eq.') && method === 'PATCH') return jr([]);
  if (u.includes('/rest/v1/presence_support_requests?site_id=')) return jr([{ id: R1, client_id: null, project_id: null, requester: UID_CUSTOMER }]);
  return jr([]);
};

const B = await import('../../supabase/functions/presence/lib/service_bridge.ts');

// ── 0. which rows are in scope (pure) ──
const rows = [
  { id: R1, client_id: null, project_id: null, requester: UID_CUSTOMER },
  { id: R2, client_id: null, project_id: null, requester: UID_CUSTOMER },
  { id: R3, client_id: null, project_id: null, requester: UID_NOBODY },
  { id: R4, client_id: CLIENT_H, project_id: null, requester: UID_CUSTOMER },
  { id: R5, client_id: null, project_id: 'p1', requester: UID_CUSTOMER },
  { id: R6, client_id: null, project_id: null, requester: 'owner@maplestreet.test' },
];
eq('in scope: no stamp, no project, a requester', B.unownedSupportRows(rows).map((r) => r.id), [R1, R2, R3, R6]);
eq('a blank requester is out of scope', B.unownedSupportRows([{ id: 'x', requester: '  ' }]).length, 0);

// ── 1-3. the heal ──
const out = await B.healSupportOwners(AGENCY, rows);
eq('a customer\'s sign-in id resolves to their customer (both rows)', [out.clientOf[R1], out.clientOf[R2]], [CLIENT_H, CLIENT_H]);
eq('an email requester resolves without a sign-in lookup', out.clientOf[R6], CLIENT_H);
eq('a sign-in that is no customer comes back with its email', out.emailOf[R3], 'owner@studio.test');
ok('…and is not stamped', !out.clientOf[R3]);
ok('stamped and project rows are untouched', !(R4 in out.clientOf) && !(R5 in out.clientOf));
const patches = calls.filter((c) => c.method === 'PATCH');
// final pass (Nov 8, batch B): a requester's rows are stamped in ONE write (id=in.(…))
const stampedIds = patches.flatMap((c) => { const m = c.u.match(/[?&]id=(?:eq\.([0-9a-f-]+)|in\.\(([^)]*)\))/); return m ? (m[1] ? [m[1]] : m[2].split(',')) : []; });
eq('every resolved row is stamped, once', stampedIds.sort(), [R1, R2, R6].sort());
eq('…one write per requester (R1 and R2 share a sign-in)', patches.length, 2);
ok('a stamp is written only where it is still null, on this studio\'s site', patches.every((c) => c.u.includes(`site_id=eq.${AGENCY}`) && c.u.includes('client_id=is.null') && JSON.parse(c.body).client_id === CLIENT_H));
const authCalls = calls.filter((c) => c.u.includes('/auth/v1/admin/users/'));
eq('one sign-in lookup per distinct sign-in id', authCalls.length, 2);
ok('the bridge gate is asked (an unbridged namesake never earns a stamp)', calls.some((c) => c.u.includes(`presence_service_links?agency_site_id=eq.${AGENCY}`)));

calls.length = 0;
await B.healSupportOwners(AGENCY, [{ id: R1, client_id: null, project_id: null, requester: UID_CUSTOMER }]);
ok('the sign-in email is cached between reads', !calls.some((c) => c.u.includes('/auth/v1/admin/users/')));

// nothing to do → no reads at all
calls.length = 0;
const none = await B.healSupportOwners(AGENCY, [{ id: R4, client_id: CLIENT_H, project_id: null, requester: UID_CUSTOMER }]);
ok('no unstamped rows → no reads, empty maps', calls.length === 0 && !Object.keys(none.clientOf).length && !Object.keys(none.emailOf).length);
eq('no studio site → nothing', Object.keys((await B.healSupportOwners('', rows)).clientOf).length, 0);

// a failing database never throws
const saved = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('network down'); };
let threw = false; let res;
try { res = await B.healSupportOwners(AGENCY, [{ id: 'f1', client_id: null, project_id: null, requester: 'b0b0b0b0-0000-4000-8000-000000000003' }]); } catch { threw = true; }
ok('a network failure never throws and stamps nothing', !threw && res && !Object.keys(res.clientOf).length);
let threw2 = false; try { await B.healUnstampedSupport(AGENCY); } catch { threw2 = true; }
ok('healUnstampedSupport never throws either', !threw2);
globalThis.fetch = saved;

// healUnstampedSupport reads only this studio's unstamped project-less rows
calls.length = 0;
await B.healUnstampedSupport(AGENCY);
const listRead = calls.find((c) => c.u.includes('/rest/v1/presence_support_requests?site_id='));
ok('healUnstampedSupport reads unstamped, project-less, live rows of this site', !!listRead && listRead.u.includes(`site_id=eq.${AGENCY}`) && listRead.u.includes('client_id=is.null') && listRead.u.includes('project_id=is.null') && listRead.u.includes('deleted_at=is.null'));

// ── 4. Home names the row ──
const { needsYouPayload } = await import('../../supabase/functions/presence/agency/needs_you.ts');
const base = {
  nowIso: '2026-11-08T15:00:00Z',
  links: [{ site_id: 's1', status: 'active' }],
  clientNames: { s1: 'Maple Street Studio' }, namesByClient: { [CLIENT_H]: 'Maple Street Studio' },
  sites: [{ id: 's1', edition: 'presence', status: 'ready', last_published_at: null, custom_domain: null }],
  serviceLinks: [{ project_id: 'p1', customer_client_id: CLIENT_H, customer_site_id: 's1' }],
  support: [
    { id: 'st', subject: 'Can you update our hours', project_id: null, client_id: CLIENT_H, created_at: '2026-07-22T00:00:00Z' },
    { id: 'em', subject: 'test 2', project_id: null, requester_email: 'owner@studio.test', created_at: '2026-07-14T00:00:00Z' },
    { id: 'pr', subject: 'the gallery page', project_id: 'p1', created_at: '2026-07-20T00:00:00Z' },
    { id: 'no', subject: 'hey', project_id: null, created_at: '2026-07-14T00:00:00Z' },
  ],
};
const p = needsYouPayload(base, 50);
const by = (k) => [...p.rows, ...(p.rest || [])].find((r) => r.key === `support:${k}`);
eq('a stamped request is named by its customer', by('st')?.name, 'Maple Street Studio');
eq('…and opens that customer (their site)', by('st')?.site_id, 's1');
eq('an unnamed one shows who wrote', by('em')?.name, 'owner@studio.test');
eq('a project request is still named by its project', by('pr')?.name, 'Maple Street Studio');
eq('nothing at all → "A customer"', by('no')?.name, 'A customer');

// ── 5. the read paths are wired ──
const ws = read('supabase/functions/presence/routes/workspace.ts');
// item 71: a contact who emailed in is named first; the email is the last fallback
ok('Inbox: heals, then shows the email for a row that names nobody', /healSupportOwners\(site\.id, sup\)/.test(ws) && /client: c\.client \|\| owners\.nameOf\[String\(r\.id\)\] \|\| owners\.emailOf\[String\(r\.id\)\] \|\| ''/.test(ws));
const ag = read('supabase/functions/presence/agency/routes.ts');
ok('Home: selects client_id and requester, and heals', /select=id,subject,project_id,client_id,requester,created_at,updated_at/.test(ag) && /healSupportOwners\(own\.id, supportRows\)/.test(ag));
ok('Home: never hands the raw sign-in id to the page', /support: supportRows\.map\(\(\{ requester: _r, \.\.\.row \}\) => row\)/.test(ag));
const cd = read('supabase/functions/presence/routes/client_delivery.ts');
ok('Customers: project-less requests count against their customer', /healSupportOwners\(site\.id, supRows\)/.test(cd) && /row\.open_support \+= n/.test(cd));
const crm = read('supabase/functions/presence/routes/crm.ts');
// batch B: the heal runs in round 2, the stamped read in round 3 (after it lands)
ok('Record: heals before the stamped read', (() => { const h = crm.indexOf('clientId ? healUnstampedSupport(AS)'); const r3 = crm.indexOf('// round 3'); const st = crm.indexOf('project_id=is.null&client_id=eq.${clientId}'); return h > 0 && r3 > h && st > r3; })());
const pc = read('supabase/functions/presence/routes/project_comms.ts');
ok('Project page: heals before the stamped read', /await healUnstampedSupport\(site\.id\);/.test(pc));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
