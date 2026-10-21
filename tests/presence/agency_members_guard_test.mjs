// ── Agency team guards (pure) ────────────────────────────────────────────────
// Post-merge review of #47 found that an owner or admin could demote or remove
// THEMSELVES: settings.html hid the controls on "your own row" by matching an
// email that GET /agency/me never returned, and the server had no rule at all.
// This suite drives handleAgency() with a stubbed fetch (PostgREST answered from
// a table in memory — no Supabase, no credentials) and pins:
//   · /agency/me returns email + member_id (what the page matches its row by);
//   · PATCH /agency/members/:id refuses the caller's own row (by id, and by email);
//   · PATCH refuses to demote or remove the LAST active owner, from an admin too;
//   · a second owner can be demoted or removed; an ordinary member always can;
//   · /agency/portfolio carries archived_site_ids next to the non-archived rows
//     (agency.html uses it so an archived client never resurfaces as a bridge-only row).
//
//   deno run --allow-read --allow-env tests/presence/agency_members_guard_test.mjs
import { handleAgency } from '../../supabase/functions/presence/agency/routes.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const AG = 'aaaaaaaa-0000-4000-8000-000000000001';
const ME_ID = '11111111-1111-4111-8111-111111111111';
const OWNER2 = '22222222-2222-4222-8222-222222222222';
const DESIGNER = '33333333-3333-4333-8333-333333333333';
const GHOST = '99999999-9999-4999-8999-999999999999';
const SITE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', SITE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/* the in-memory tables PostgREST would answer from */
let members, clients, sites;
function reset({ owners = 2 } = {}) {
  members = [
    { id: ME_ID, agency_id: AG, email: 'eric@brightstudio.example', role: 'owner', status: 'active', created_at: '2026-01-01T00:00:00Z' },
    { id: OWNER2, agency_id: AG, email: 'pat@brightstudio.example', role: owners >= 2 ? 'owner' : 'admin', status: 'active', created_at: '2026-02-01T00:00:00Z' },
    { id: DESIGNER, agency_id: AG, email: 'sam@brightstudio.example', role: 'designer', status: 'active', created_at: '2026-03-01T00:00:00Z' },
  ];
  clients = [
    { site_id: SITE_A, agency_id: AG, status: 'active', tags: [], owner_email: '', assigned: [], notes: '', onboarded_at: '2026-01-01T00:00:00Z' },
    { site_id: SITE_B, agency_id: AG, status: 'archived', tags: [], owner_email: '', assigned: [], notes: '', onboarded_at: '2026-01-01T00:00:00Z' },
  ];
  sites = [
    { id: SITE_A, client_id: 'c-a', edition: 'presence', status: 'ready', last_published_at: null, custom_domain: null, domain_registrar: null, domain_expires_at: null },
    { id: SITE_B, client_id: 'c-b', edition: 'presence', status: 'ready', last_published_at: null, custom_domain: null, domain_registrar: null, domain_expires_at: null },
  ];
}
const writes = [];   // every non-GET PostgREST call, so a refusal can be shown to have written NOTHING

/* a tiny PostgREST: filters of the form col=eq.v / col=in.(a,b) on the tables above */
function rowsFor(table, params) {
  const src = table === 'presence_agency_members' ? members : table === 'presence_agency_clients' ? clients : table === 'presence_sites' ? sites : [];
  return src.filter((r) => [...params.entries()].every(([k, v]) => {
    if (['select', 'limit', 'order', 'on_conflict'].includes(k)) return true;
    const col = k === 'id' && table === 'presence_sites' ? 'id' : k;
    if (v.startsWith('eq.')) return String(r[col]) === v.slice(3);
    if (v.startsWith('in.(')) return v.slice(4, -1).split(',').includes(String(r[col]));
    return true;
  }));
}
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url), 'http://stub.local');
  const table = u.pathname.replace(/^.*\/rest\/v1\//, '');
  const method = (init.method || 'GET').toUpperCase();
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (method === 'GET') return reply(rowsFor(table, u.searchParams));
  writes.push({ table, method, body: init.body ? JSON.parse(init.body) : null, query: u.search });
  if (method === 'PATCH' && table === 'presence_agency_members') {
    const hit = rowsFor(table, u.searchParams);
    hit.forEach((r) => Object.assign(r, JSON.parse(init.body)));
    return reply(hit.map(({ id, email, role, status }) => ({ id, email, role, status })));
  }
  return reply([]);
};

const cors = {};
const asMember = (over = {}) => ({ agency_id: AG, member_id: ME_ID, email: 'eric@brightstudio.example', role: 'owner', agency_name: 'Bright Studio', seat_limit: 5, client_limit: 10, plan: 'agency', branding: {}, ...over });
async function call(member, method, route, body) {
  const req = new Request('http://stub.local/functions/v1/presence' + route, { method, body: body ? JSON.stringify(body) : undefined, headers: { 'Content-Type': 'application/json' } });
  const res = await handleAgency(req, route.split('?')[0], method, member, { kind: 'member' }, cors);   // the router hands over the path; the query rides on req.url
  return { status: res.status, body: await res.json() };
}

// ═══ 1. /agency/me says who you are — email and member_id ═══
{
  reset();
  const me = await call(asMember(), 'GET', '/agency/me');
  ok('me: 200 with agency · role · plan · branding', me.status === 200 && me.body.data.agency === 'Bright Studio' && me.body.data.role === 'owner' && me.body.data.plan === 'agency');
  ok('me: carries email (what settings.html matched its own row by — and never got)', me.body.data.email === 'eric@brightstudio.example');
  ok('me: carries member_id (the row id, so the match never depends on email case)', me.body.data.member_id === ME_ID);
}

// ═══ 2. your own row is off limits ═══
{
  reset(); writes.length = 0;
  const demote = await call(asMember(), 'PATCH', `/agency/members/${ME_ID}`, { role: 'admin' });
  ok('own row: an owner demoting themselves → 409 own_row, plain words', demote.status === 409 && demote.body.error === 'own_row' && /^You can’t change your own role or remove yourself\./.test(demote.body.message));
  const revoke = await call(asMember(), 'PATCH', `/agency/members/${ME_ID}`, { status: 'revoked' });
  ok('own row: an owner removing themselves → 409 own_row', revoke.status === 409 && revoke.body.error === 'own_row');
  ok('own row: nothing was written', writes.length === 0 && members.find((m) => m.id === ME_ID).role === 'owner' && members.find((m) => m.id === ME_ID).status === 'active');
  // the same person reached under a different member_id (a stale token, say) is still caught by email
  const byEmail = await call(asMember({ member_id: GHOST, email: 'ERIC@brightstudio.example' }), 'PATCH', `/agency/members/${ME_ID}`, { role: 'designer' });
  ok('own row: matched by email too, case-insensitively', byEmail.status === 409 && byEmail.body.error === 'own_row' && writes.length === 0);
  const admin = await call(asMember({ member_id: OWNER2, email: 'pat@brightstudio.example', role: 'admin' }), 'PATCH', `/agency/members/${OWNER2}`, { status: 'revoked' });
  ok('own row: an admin removing themselves → 409 own_row as well', admin.status === 409 && admin.body.error === 'own_row');
}

// ═══ 3. the team always keeps one owner ═══
{
  reset({ owners: 1 }); writes.length = 0;   // eric is the only owner; pat is an admin (manage_members)
  const pat = asMember({ member_id: OWNER2, email: 'pat@brightstudio.example', role: 'admin' });
  const demote = await call(pat, 'PATCH', `/agency/members/${ME_ID}`, { role: 'admin' });
  ok('last owner: an admin demoting the only owner → 409 last_owner, plain words', demote.status === 409 && demote.body.error === 'last_owner' && demote.body.message === 'The team needs at least one owner. Make someone else an owner first.');
  const revoke = await call(pat, 'PATCH', `/agency/members/${ME_ID}`, { status: 'revoked' });
  ok('last owner: an admin removing the only owner → 409 last_owner', revoke.status === 409 && revoke.body.error === 'last_owner');
  ok('last owner: nothing was written', writes.length === 0 && members.find((m) => m.id === ME_ID).role === 'owner');
  const toOwner = await call(pat, 'PATCH', `/agency/members/${ME_ID}`, { role: 'owner' });
  ok('last owner: re-saying "owner" on the only owner is not a demotion → 200', toOwner.status === 200 && toOwner.body.data.role === 'owner');
  // promote pat → two owners → eric may now be demoted by pat
  reset({ owners: 2 }); writes.length = 0;
  const now = await call(asMember({ member_id: OWNER2, email: 'pat@brightstudio.example', role: 'owner' }), 'PATCH', `/agency/members/${ME_ID}`, { role: 'admin' });
  ok('two owners: the other owner CAN demote one of them → 200, the row is written', now.status === 200 && now.body.data.role === 'admin' && writes.length === 1 && writes[0].method === 'PATCH' && writes[0].body.role === 'admin');
  reset({ owners: 2 }); writes.length = 0;
  const gone = await call(asMember(), 'PATCH', `/agency/members/${OWNER2}`, { status: 'revoked' });
  ok('two owners: removing the second owner → 200', gone.status === 200 && gone.body.data.status === 'revoked');
  const thenDemote = await call(asMember({ member_id: DESIGNER, email: 'sam@brightstudio.example', role: 'admin' }), 'PATCH', `/agency/members/${ME_ID}`, { role: 'support' });
  ok('…and with the second owner removed, the remaining owner is the last one again → 409', thenDemote.status === 409 && thenDemote.body.error === 'last_owner');
}

// ═══ 4. ordinary changes still go through; the rest of the contract holds ═══
{
  reset(); writes.length = 0;
  const r1 = await call(asMember(), 'PATCH', `/agency/members/${DESIGNER}`, { role: 'account_manager' });
  ok('member: an owner changes a designer’s role → 200 with the new row', r1.status === 200 && r1.body.data.role === 'account_manager' && r1.body.data.email === 'sam@brightstudio.example');
  const r2 = await call(asMember(), 'PATCH', `/agency/members/${DESIGNER}`, { status: 'revoked' });
  ok('member: an owner removes a designer → 200 status revoked', r2.status === 200 && r2.body.data.status === 'revoked');
  const r3 = await call(asMember(), 'PATCH', `/agency/members/${DESIGNER}`, { status: 'active' });
  ok('member: …and restores them → 200 status active', r3.status === 200 && r3.body.data.status === 'active');
  const r4 = await call(asMember(), 'PATCH', `/agency/members/${GHOST}`, { role: 'support' });
  ok('member: an id the agency does not have → 404 not_found (never another agency’s row)', r4.status === 404 && r4.body.error === 'not_found');
  const r5 = await call(asMember(), 'PATCH', `/agency/members/${DESIGNER}`, { nonsense: 1 });
  ok('member: an empty patch → 400 empty_update, before any guard runs', r5.status === 400 && r5.body.error === 'empty_update');
  const r6 = await call(asMember({ member_id: DESIGNER, email: 'sam@brightstudio.example', role: 'designer' }), 'PATCH', `/agency/members/${OWNER2}`, { role: 'support' });
  ok('member: a designer has no manage_members → 403', r6.status === 403);
}

// ═══ 5. the portfolio read names its archived sites ═══
{
  reset();
  const pf = await call(asMember(), 'GET', '/agency/portfolio');
  ok('portfolio: the default read lists only the non-archived rows', pf.status === 200 && Array.isArray(pf.body.data) && pf.body.data.map((r) => r.site_id).join() === SITE_A);
  ok('portfolio: …and carries archived_site_ids so the roster never re-adds an archived client from the bridge list', Array.isArray(pf.body.archived_site_ids) && pf.body.archived_site_ids.join() === SITE_B);
  const arch = await call(asMember(), 'GET', '/agency/portfolio?archived=true');
  ok('portfolio: ?archived=true lists the archived rows', arch.status === 200 && arch.body.data.map((r) => r.site_id).join() === SITE_B && arch.body.data[0].archived === true);
}

const fails = results.filter((r) => !r.p);
console.log(`\n════ AGENCY TEAM GUARDS: ${results.length - fails.length}/${results.length} PASSED ════`);
if (fails.length) Deno.exit(1);
