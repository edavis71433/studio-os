// ── People on a site, invited by role, and handing a site to a new owner (builder item 53) ─
// Wix's model: the client owns the site and the studio works on it with a role. This
// drives the real lib/workspace.ts, lib/site_transfer.ts and their routes against an
// in-memory PostgREST, GoTrue and Resend (nothing leaves the process):
//   · the pure rules: who may start a transfer, why one can't, what each person may do
//     with it, when it lapses, and the owner said as a person;
//   · invites: an email already here is pointed at, never re-invited; a removed person
//     comes back only on purpose; the owner's own email is never a seat; a role changes
//     only by its own route, and never on a removed seat;
//   · the People sheet's read: owner, studio, seats with their role words, an open transfer;
//   · transfers, end to end: the owner starts one and the new owner accepts; the studio
//     starts one, the owner agrees, the new owner accepts; every refusal, and that nothing
//     changes until the accept, which switches the client record only while it still
//     names the owner who was asked;
//   · the routes are wired where a new owner (who has no site yet) can reach them.
//
//   deno run --allow-read --allow-env --allow-net tests/presence/site_people_transfer_test.mjs
for (const [k, v] of Object.entries({
  SUPABASE_URL: 'http://stub.local', SERVICE_ROLE_KEY: 'SERVICE-KEY', SUPABASE_ANON_KEY: 'ANON-KEY',
  SITE_URL: 'https://davisdigitalstudio.example', APP_URL: 'https://app.studio.example', RESEND_KEY: 're_test',
})) Deno.env.set(k, v);

const P = '../../supabase/functions/presence';
const T = await import(`${P}/lib/site_transfer.ts`);
const { addSiteMember, changeSiteMemberRole, revokeSiteMember, listSiteMembers } = await import(`${P}/lib/workspace.ts`);
const { handleMembersList, handleMemberAdd, handleMemberRole, SEAT_ROLE_WORDS } = await import(`${P}/routes/workspace.ts`);
const { handleTransferStart, handleTransferCancel, handleTransfersMine, handleTransferAnswer } = await import(`${P}/routes/site_transfer.ts`);
const { memberWriteNeeds } = await import(`${P}/lib/site_roles.ts`);

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const uuid = (c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const SITE = uuid('a'), CLIENT = uuid('c'), OTHER_CLIENT = uuid('d'), STUDIO_SITE = uuid('e'), AGENCY = uuid('f');
const OWNER_CONTACT = uuid('1'), NOW = new Date().toISOString();
const USERS = {
  'jwt-owner': { id: uuid('3'), email: 'sam@maple.example' },
  'jwt-coowner': { id: uuid('4'), email: 'co@maple.example' },
  'jwt-studio': { id: uuid('5'), email: 'eric@studio.example' },
  'jwt-designer': { id: uuid('6'), email: 'dee@studio.example' },
  'jwt-new': { id: uuid('7'), email: 'ana@maple.example' },
  'jwt-stranger': { id: uuid('8'), email: 'someone@else.example' },
  'jwt-busy': { id: uuid('9'), email: 'busy@owns.example' },
};
// builder item 191: the risky ones ask for a fresh code. Here everyone has an authenticator app,
// and the requests below carry its code unless a test leaves it off on purpose (bare).
const { freshDeps } = await import(`${P}/lib/fresh_code.ts`);
const { alertDeps } = await import(`${P}/lib/security_alerts.ts`);
const APP_CODE = '135790';
freshDeps.user = async (jwt) => (USERS[jwt] ? { ...USERS[jwt], factors: [{ id: 'factor-1', factor_type: 'totp', status: 'verified' }] } : null);
freshDeps.verifyApp = async (_jwt, _factor, code) => code === APP_CODE;
let alerts = [];
alertDeps.send = async (to, subject) => { alerts.push({ to, subject }); return true; };
const principalOf = (jwt, extra = {}) => ({ kind: 'client', userId: USERS[jwt].id, tenantId: null, role: 'client', email: USERS[jwt].email, jwt, requestId: 'test', ...extra });
const owner = () => principalOf('jwt-owner');
const studio = () => principalOf('jwt-studio', { scope: { site_id: SITE, name: 'Maple & Main Realty' } });
const designer = () => principalOf('jwt-designer', { scope: { site_id: SITE, name: 'Maple & Main Realty' } });
const coowner = () => principalOf('jwt-coowner', { member: { site_id: SITE, role: 'business_owner' } });
const platform = () => principalOf('jwt-stranger', { kind: 'staff', role: 'owner' });
const SITE_ROW = { id: SITE, client_id: CLIENT, status: 'live', last_published_at: '2026-10-01T00:00:00Z', template_slug: 'atelier', template_version: '1.0.0', custom_domain: null, netlify_site_id: null, edition: 'presence' };

/* ── a small PostgREST: real rows, the filters these modules use, and the unique rules that matter ── */
let DB, emails, minted, transfersMissing;
function reset() {
  DB = {
    presence_sites: [{ ...SITE_ROW }],
    clients: [
      { id: CLIENT, name: 'Maple & Main Realty', email: 'sam@maple.example', contact_email: 'sam@maple.example', contact_id: OWNER_CONTACT, deleted_at: null },
      { id: OTHER_CLIENT, name: 'Busy Bakery', email: 'busy@owns.example', contact_email: 'busy@owns.example', contact_id: null, deleted_at: null },
    ],
    contacts: [{ id: OWNER_CONTACT, name: 'Sam Reyes', email: 'sam@maple.example', auth_user_id: USERS['jwt-owner'].id }],
    presence_identity: [{ site_id: SITE, business_name: 'Maple & Main Realty' }],
    presence_site_members: [
      { id: uuid('b'), site_id: SITE, email: 'co@maple.example', user_id: USERS['jwt-coowner'].id, role: 'business_owner', status: 'active', created_at: '2026-10-01T00:00:00Z' },
      { id: uuid('2'), site_id: SITE, email: 'dana@maple.example', user_id: null, role: 'business_staff', status: 'active', created_at: '2026-10-02T00:00:00Z' },
      { id: uuid('0'), site_id: SITE, email: 'gone@maple.example', user_id: null, role: 'developer', status: 'revoked', created_at: '2026-10-03T00:00:00Z' },
      { id: uuid('6'), site_id: SITE, email: 'ana@maple.example', user_id: USERS['jwt-new'].id, role: 'business_staff', status: 'active', created_at: '2026-10-04T00:00:00Z' },
    ],
    presence_site_transfers: [],
    presence_agency_clients: [{ agency_id: AGENCY, site_id: SITE, status: 'active', owner_email: 'sam@maple.example' }],
    presence_agencies: [{ id: AGENCY, name: 'Bright Studio', status: 'active', seat_limit: 5, client_limit: 25, plan: 'agency', branding: {} }],
    presence_agency_members: [
      { id: uuid('7'), agency_id: AGENCY, email: 'eric@studio.example', user_id: USERS['jwt-studio'].id, role: 'owner', status: 'active', created_at: '2026-01-01T00:00:00Z' },
      { id: uuid('8'), agency_id: AGENCY, email: 'pat@studio.example', user_id: null, role: 'account_manager', status: 'active', created_at: '2026-01-02T00:00:00Z' },
      { id: uuid('9'), agency_id: AGENCY, email: 'dee@studio.example', user_id: USERS['jwt-designer'].id, role: 'designer', status: 'active', created_at: '2026-01-03T00:00:00Z' },
    ],
    presence_service_links: [],
    presence_change_events: [],
  };
  emails = []; minted = []; transfersMissing = false; alerts = [];
}
const splitTop = (s) => { const out = []; let depth = 0, q = false, cur = ''; for (let i = 0; i < s.length; i++) { const c = s[i]; if (c === '"' && s[i - 1] !== '\\') q = !q; if (!q && c === '(') depth++; if (!q && c === ')') depth--; if (!q && depth === 0 && c === ',') { out.push(cur); cur = ''; } else cur += c; } if (cur) out.push(cur); return out; };
const unq = (v) => (v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\') : v);
function test(row, col, op, val) {
  const have = row[col];
  if (op === 'eq') return String(have) === unq(val);
  if (op === 'neq') return String(have) !== unq(val);
  if (op === 'in') return val.slice(1, -1).split(',').map(unq).includes(String(have));
  if (op === 'is') return val === 'null' ? have === null || have === undefined : String(have) === val;
  throw new Error('stub: no op ' + op);
}
function cond(row, expr) {
  const m = /^(and|or)\((.*)\)$/.exec(expr);
  if (m) { const parts = splitTop(m[2]); return m[1] === 'and' ? parts.every((p) => cond(row, p)) : parts.some((p) => cond(row, p)); }
  const [col, op, ...rest] = expr.split('.');
  if (op === 'not') { const [op2, ...r2] = rest; return !test(row, col, op2, r2.join('.')); }
  return test(row, col, op, rest.join('.'));
}
const CTRL = ['select', 'limit', 'order', 'on_conflict'];
function filterRows(table, params) {
  let rows = (DB[table] || []).filter((r) => [...params.entries()].every(([k, v]) => CTRL.includes(k) || (k === 'or' ? cond(r, `or${v}`) : k === 'and' ? cond(r, `and${v}`) : cond(r, `${k}.${v}`))));
  const order = params.get('order'); if (order) { const [col, dir] = order.split('.'); rows = rows.slice().sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (dir === 'desc' ? -1 : 1)); }
  const lim = Number(params.get('limit')); if (lim) rows = rows.slice(0, lim);
  return rows;
}
const reply = (body, status = 200) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const UNIQUE = {
  presence_site_members: (a, b) => a.site_id === b.site_id && a.email === b.email,
  presence_site_transfers: (a, b) => a.site_id === b.site_id && ['asked_owner', 'asked_new'].includes(a.status) && ['asked_owner', 'asked_new'].includes(b.status),
  clients: (a, b) => !!a.email && a.email === b.email,
};
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url), 'http://stub.local');
  const method = (init.method || 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  const token = (headers.get('Authorization') || '').replace(/^Bearer /, '');
  const body = init.body ? JSON.parse(init.body) : null;
  if (u.hostname === 'api.resend.com') { emails.push(body); return reply({ id: 'e' + emails.length }); }
  if (u.hostname !== 'stub.local') return reply({}, 404);
  if (u.pathname === '/auth/v1/user') return USERS[token] ? reply(USERS[token]) : reply({}, 401);
  if (u.pathname === '/auth/v1/admin/generate_link') { minted.push(body); return reply({ action_link: `http://stub.local/auth/v1/verify?type=${body.type}&redirect_to=${encodeURIComponent(body.redirect_to)}` }); }
  const adminUser = u.pathname.match(/^\/auth\/v1\/admin\/users\/(.+)$/);
  if (adminUser) return adminUser[1] === USERS['jwt-owner'].id ? reply({ id: adminUser[1], last_sign_in_at: null }) : reply({}, 404);
  if (!u.pathname.startsWith('/rest/v1/')) return reply({}, 404);
  const table = u.pathname.replace('/rest/v1/', '');
  if (table === 'presence_site_transfers' && transfersMissing) return reply({ code: '42P01', message: 'relation "presence_site_transfers" does not exist' }, 404);
  if (token !== 'SERVICE-KEY') return reply([]);   // nothing here is read under a user's own sign-in
  const rep = (headers.get('Prefer') || '').includes('return=representation');
  if (method === 'GET' || method === 'HEAD') return reply(filterRows(table, u.searchParams));
  if (method === 'POST') {
    const merge = (headers.get('Prefer') || '').includes('resolution=merge-duplicates');
    const made = [];
    for (const r of (Array.isArray(body) ? body : [body])) {
      const row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...r };
      if (table === 'presence_site_transfers') row.status = row.status || 'asked_owner';
      const clash = (DB[table] || []).find((x) => UNIQUE[table] && UNIQUE[table](x, row));
      if (clash && merge) { Object.assign(clash, r); made.push(clash); continue; }
      if (clash) return reply({ code: '23505', message: `duplicate key value violates unique constraint "${table}_one_open"` }, 409);
      (DB[table] = DB[table] || []).push(row); made.push(row);
    }
    return rep ? reply(made, 201) : reply(null, 201);
  }
  if (method === 'PATCH') {
    const hit = filterRows(table, u.searchParams);
    for (const r of hit) { const next = { ...r, ...body }; if (UNIQUE[table] && (DB[table] || []).some((x) => x !== r && UNIQUE[table](x, next))) return reply({ code: '23505' }, 409); Object.assign(r, body); }
    return rep ? reply(hit) : reply(null, 204);
  }
  if (method === 'DELETE') { const hit = filterRows(table, u.searchParams); DB[table] = (DB[table] || []).filter((r) => !hit.includes(r)); return reply(null, 204); }
  return reply({}, 405);
};
const quiet = async (fn) => { const e = console.error, w = console.warn; console.error = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.error = e; console.warn = w; } };
const bare = (method, body) => new Request('http://stub.local/functions/v1/presence/x', { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const req = (method, body) => (method === 'POST' ? bare(method, { fresh_code: APP_CODE, ...(body || {}) }) : bare(method, body));
const answer = async (res) => ({ status: res.status, body: await res.json().catch(() => null) });
const cors = {};
const seat = (email) => DB.presence_site_members.find((m) => m.email === email);
const open = () => DB.presence_site_transfers.filter((t) => ['asked_owner', 'asked_new'].includes(t.status));
const clientRow = () => DB.clients.find((c) => c.id === CLIENT);

// ═══ 1. the rules, pure ═══
{
  const t = { id: 'x', site_id: SITE, client_id: CLIENT, from_email: 'sam@maple.example', to_email: 'ana@maple.example', keep_old: true, started_by: 'eric@studio.example', started_side: 'studio', status: 'asked_owner', expires_at: '2026-12-01T00:00:00Z' };
  ok('step: the owner agrees to a request the studio started', T.transferStep(t, 'Sam@Maple.example', '2026-11-11T00:00:00Z') === 'agree');
  ok('step: the new owner can\'t accept before the owner agrees', T.transferStep(t, 'ana@maple.example', '2026-11-11T00:00:00Z') === null);
  ok('step: once agreed, the new owner accepts, and the owner has nothing left to press', T.transferStep({ ...t, status: 'asked_new' }, 'ana@maple.example', '2026-11-11T00:00:00Z') === 'accept' && T.transferStep({ ...t, status: 'asked_new' }, 'sam@maple.example', '2026-11-11T00:00:00Z') === null);
  ok('step: anyone else, or a closed request, gets nothing', T.transferStep(t, 'someone@else.example', '2026-11-11T00:00:00Z') === null && T.transferStep({ ...t, status: 'done' }, 'sam@maple.example', '2026-11-11T00:00:00Z') === null && T.transferStep(t, '', '2026-11-11T00:00:00Z') === null);
  ok('lapse: an open request past its date has lapsed, and offers nothing', T.liveStatus(t, '2026-12-02T00:00:00Z') === 'expired' && T.transferStep(t, 'sam@maple.example', '2026-12-02T00:00:00Z') === null && T.transferSummary(t, '2026-12-02T00:00:00Z') === null);
  ok('lapse: a closed request keeps its own status', T.liveStatus({ ...t, status: 'declined' }, '2027-01-01T00:00:00Z') === 'declined');
  ok('lapse: fourteen days', T.TRANSFER_DAYS === 14);
  const side = (o) => T.starterSide({ scoped: false, studioCanManage: false, kind: 'client', seated: false, role: 'business_owner', ...o });
  ok('who starts: the owner on their own site', side({}) === 'owner');
  ok('who starts: the studio inside the client, with a role that runs clients', side({ scoped: true, studioCanManage: true }) === 'studio');
  ok('who starts: not a studio role that can\'t run clients', side({ scoped: true, studioCanManage: false }) === null);
  ok('who starts: not a Co-owner seat, though it holds every other power', side({ seated: true }) === null);
  ok('who starts: not staff, a developer or a reviewer', ['business_staff', 'developer', 'client_reviewer'].every((role) => side({ role, seated: true }) === null));
  ok('who starts: not platform staff', side({ kind: 'staff' }) === null);
  const refuse = (o) => T.startRefusal({ toEmail: 'ana@maple.example', ownerEmails: ['sam@maple.example'], hasOwner: true, open: false, ownsAnother: false, ...o });
  ok('refuse: a clean request starts', refuse({}) === null);
  ok('refuse: a bad email, no owner, the owner themself, one already open, someone who owns another',
    refuse({ toEmail: 'nope' }) === 'bad_email' && refuse({ hasOwner: false }) === 'no_owner' && refuse({ toEmail: 'SAM@maple.example' }) === 'same_owner' && refuse({ open: true }) === 'already_open' && refuse({ ownsAnother: true }) === 'owns_another');
  ok('refuse: every refusal has a status and a sentence', Object.values(T.START_WORDS).every(([s, m]) => s >= 400 && /\.$/.test(m)));
  ok('owner in words: the person\'s name', JSON.stringify(T.ownerWho({ name: 'Maple & Main Realty', email: 'Sam@maple.example' }, 'Sam Reyes')) === JSON.stringify({ name: 'Sam Reyes', email: 'sam@maple.example' }));
  ok('owner in words: a contact holding the business name falls back to the email', T.ownerWho({ name: 'Maple & Main Realty', email: 'sam@maple.example' }, 'maple & main realty').name === 'sam@maple.example');
  ok('owner in words: no one there is null', T.ownerWho({ name: 'X', email: null, contact_email: null }, '') === null);
}

// ═══ 2. invites by role ═══
{
  reset();
  const dup = await quiet(() => addSiteMember(SITE, 'Dana@Maple.example', 'client_reviewer', 'x', { ownerEmails: ['sam@maple.example'] }));
  ok('invite: an email already here is pointed at, whatever its capitals, and keeps its role', !dup.ok && dup.error === 'already_member' && dup.member.role === 'business_staff' && seat('dana@maple.example').role === 'business_staff');
  const own = await quiet(() => addSiteMember(SITE, 'sam@maple.example', 'business_staff', 'x', { ownerEmails: ['sam@maple.example'] }));
  ok('invite: the owner\'s own email is never made a seat', !own.ok && own.error === 'is_owner' && !seat('sam@maple.example'));
  const back = await quiet(() => addSiteMember(SITE, 'gone@maple.example', 'business_staff', 'x', {}));
  ok('invite: someone removed comes back only on purpose', !back.ok && back.error === 'was_removed' && seat('gone@maple.example').status === 'revoked');
  const restored = await quiet(() => addSiteMember(SITE, 'gone@maple.example', 'business_staff', 'x', { restore: true }));
  ok('invite: …and on purpose, with the role named again', restored.ok && restored.restored && seat('gone@maple.example').status === 'active' && seat('gone@maple.example').role === 'business_staff');
  const sent = emails.length;
  const fresh = await quiet(() => addSiteMember(SITE, 'alex@maple.example', 'business_owner', 'x', {}));
  ok('invite: a new person gets a seat with the role picked, and a sign-in email', fresh.ok && fresh.member.role === 'business_owner' && seat('alex@maple.example').status === 'active' && emails.length === sent + 1);
  // Developer is paused (DEVELOPER_PAUSED): its custom HTML goes through a cleaner that isn't a parser yet
  const paused = await quiet(() => addSiteMember(SITE, 'dev@maple.example', 'developer', 'x', {}));
  ok('developer paused: an owner or studio can\'t make a Developer seat, and nothing is written or sent', !paused.ok && paused.error === 'role_paused' && !seat('dev@maple.example') && emails.length === sent + 1);
  const staffDev = await quiet(() => addSiteMember(SITE, 'dev@maple.example', 'developer', 'x', { allowDeveloper: true }));
  ok('developer paused: platform staff still can (the narrow way the cleaner\'s note allows)', staffDev.ok && seat('dev@maple.example').role === 'developer');
  ok('invite: a full-workspace seat\'s link lands on the studio door', minted.some((m) => m.email === 'alex@maple.example' && /\/studio\.html$/.test(m.redirect_to)));
  DB.presence_service_links.push({ agency_site_id: SITE, status: 'active', id: 'l1' });
  const rev = await quiet(() => addSiteMember(SITE, 'look@maple.example', 'client_reviewer', 'x', {}));
  ok('invite: still no reviewer seat on a studio\'s shared site (review finding 5)', !rev.ok && rev.error === 'shared_site');
  DB.presence_service_links = [];
  const role = await changeSiteMemberRole(SITE, uuid('2'), 'client_reviewer');
  ok('role: a seat\'s role changes by its own route', role.ok && seat('dana@maple.example').role === 'client_reviewer');
  const toDev = await changeSiteMemberRole(SITE, uuid('2'), 'developer');
  ok('developer paused: no seat is changed to Developer either', !toDev.ok && toDev.error === 'role_paused' && seat('dana@maple.example').role === 'client_reviewer');
  ok('developer paused: …unless platform staff ask', (await changeSiteMemberRole(SITE, uuid('2'), 'developer', { allowDeveloper: true })).ok && seat('dana@maple.example').role === 'developer');
  const badRole = await changeSiteMemberRole(SITE, uuid('2'), 'owner');
  ok('role: only the four seat roles; "owner" is not one', !badRole.ok && badRole.error === 'bad_role');
  DB.presence_site_members.find((m) => m.email === 'dana@maple.example').status = 'revoked';
  const ghost = await changeSiteMemberRole(SITE, uuid('2'), 'business_staff');
  ok('role: a removed seat isn\'t given a role back', !ghost.ok && ghost.error === 'not_found' && seat('dana@maple.example').status === 'revoked');
  ok('remove: a seat that isn\'t there says so', (await revokeSiteMember(SITE, uuid('2'))) === false && (await revokeSiteMember(SITE, uuid('b'))) === true && seat('co@maple.example').status === 'revoked');
  const listed = await listSiteMembers(SITE);
  ok('list: says who has signed in, and never hands out their sign-in id', listed.find((m) => m.email === 'ana@maple.example').joined === true && listed.find((m) => m.email === 'alex@maple.example').joined === false && listed.every((m) => !('user_id' in m)));
}

// ═══ 3. the routes for people ═══
{
  reset();
  const devAsk = await answer(await quiet(async () => handleMemberAdd(req('POST', { email: 'new.dev@maple.example', role: 'developer' }), 'jwt-owner', SITE_ROW, owner(), cors)));
  ok('route: an owner asking for a Developer is told it is paused, in words', devAsk.status === 409 && devAsk.body.error === 'role_paused' && /paused/.test(devAsk.body.message) && !seat('new.dev@maple.example'));
  const devStaff = await answer(await quiet(async () => handleMemberAdd(req('POST', { email: 'new.dev@maple.example', role: 'developer' }), 'jwt-stranger', SITE_ROW, platform(), cors)));
  ok('route: platform staff can still make one', devStaff.status === 200 && seat('new.dev@maple.example')?.role === 'developer');
  const devRole = await answer(await quiet(async () => handleMemberRole(req('POST', { role: 'developer' }), 'jwt-owner', SITE_ROW, uuid('2'), owner(), cors)));
  ok('route: …and an owner can\'t change someone to Developer', devRole.status === 409 && devRole.body.error === 'role_paused');
  const dup = await answer(await quiet(async () => handleMemberAdd(req('POST', { email: 'dana@maple.example', role: 'client_reviewer' }), 'jwt-owner', SITE_ROW, owner(), cors)));
  ok('route: inviting someone already here answers 409 with their row and a sentence', dup.status === 409 && dup.body.error === 'already_member' && dup.body.member.role === 'business_staff' && /already here as Staff/.test(dup.body.message));
  const own = await answer(await quiet(async () => handleMemberAdd(req('POST', { email: 'SAM@maple.example', role: 'business_staff' }), 'jwt-owner', SITE_ROW, owner(), cors)));
  ok('route: the owner\'s own email, read from the client record, is refused', own.status === 409 && own.body.error === 'is_owner');
  const made = await answer(await quiet(async () => handleMemberAdd(req('POST', { email: 'alex@maple.example', role: 'business_owner' }), 'jwt-studio', SITE_ROW, studio(), cors)));
  ok('route: the studio inside the client invites a Co-owner, said in words', made.status === 200 && /Co-owner/.test(made.body.data.message) && seat('alex@maple.example').role === 'business_owner');
  const staffTry = await answer(await quiet(async () => handleMemberAdd(req('POST', { email: 'x@maple.example', role: 'business_staff' }), 'jwt-new', SITE_ROW, principalOf('jwt-new', { member: { site_id: SITE, role: 'business_staff' } }), cors)));
  ok('route: a staff seat can\'t invite (the invite capability)', staffTry.status === 403 && !seat('x@maple.example'));
  const sentBefore = emails.length, rowsBefore = DB.presence_site_members.length;
  const again = await answer(await quiet(async () => handleMemberAdd(req('POST', { email: 'dana@maple.example', resend: true }), 'jwt-owner', SITE_ROW, owner(), cors)));
  ok('resend: "Send it again" emails the same seat a new link and changes nothing else', again.status === 200 && emails.length === sentBefore + 1 && emails[emails.length - 1].to === 'dana@maple.example' && DB.presence_site_members.length === rowsBefore && seat('dana@maple.example').role === 'business_staff');
  const gone = await answer(await quiet(async () => handleMemberAdd(req('POST', { email: 'gone@maple.example', resend: true }), 'jwt-owner', SITE_ROW, owner(), cors)));
  ok('resend: never to someone removed', gone.status === 404 && emails.length === sentBefore + 1);
  const sheet = read('people.js'), sharing = read('sharing.html');
  ok('resend: the People sheet sends it as a resend, and says when it didn\'t go; the Sharing page no longer claims "re-sent"', sheet.includes("me.req('/portal/members', 'POST', { email: email, resend: true })") && sheet.includes("'That didn’t send. Try again.'") && !sharing.includes("||'Invite re-sent.'"));
  const changed = await answer(await quiet(async () => handleMemberRole(req('POST', { role: 'client_reviewer' }), 'jwt-owner', SITE_ROW, uuid('2'), owner(), cors)));
  ok('route: a role change answers with the new role in words', changed.status === 200 && changed.body.data.message === 'dana@maple.example is now Reviewer.' && seat('dana@maple.example').role === 'client_reviewer');
  const list = await answer(await quiet(async () => handleMembersList('jwt-studio', SITE_ROW, studio(), cors)));
  const d = list.body;
  ok('people: the owner as a person, who hasn\'t signed in yet', list.status === 200 && d.owner.name === 'Sam Reyes' && d.owner.email === 'sam@maple.example' && d.owner.signed_in === false && d.owner.me === false);
  ok('people: the studio by name, as Website manager, listing only who can open the site', d.studio.name === 'Bright Studio' && d.studio.role === 'Website manager' && d.studio.people.map((p) => p.email).join(',') === 'eric@studio.example,pat@studio.example' && d.studio.people[0].me === true && d.studio.people[0].role === 'Studio owner');
  ok('people: each seat carries its role in words', d.data.every((m) => m.role_words === SEAT_ROLE_WORDS[m.role]) && SEAT_ROLE_WORDS.business_owner === 'Co-owner');
  ok('people: no transfer yet, the table is there, and the studio may start one', d.transfer === null && d.transfer_ready === true && d.can_transfer === 'studio');
  const asOwner = await answer(await quiet(async () => handleMembersList('jwt-owner', SITE_ROW, owner(), cors)));
  ok('people: the owner sees themself as the owner, and may start a transfer', asOwner.body.owner.me === true && asOwner.body.can_transfer === 'owner');
  const asCo = await answer(await quiet(async () => handleMembersList('jwt-coowner', SITE_ROW, coowner(), cors)));
  ok('people: a Co-owner manages people but can\'t hand the site over', asCo.status === 200 && asCo.body.can_transfer === null);
  transfersMissing = true;
  const before = await answer(await quiet(async () => handleMembersList('jwt-owner', SITE_ROW, owner(), cors)));
  ok('people: before APPLY-0177 the sheet still loads, and says transfers aren\'t ready', before.status === 200 && before.body.transfer_ready === false && before.body.transfer === null);
}

// ═══ 4. the owner hands the site over; the new owner accepts ═══
{
  reset();
  const start = await answer(await quiet(async () => handleTransferStart(req('POST', { email: 'Ana@Maple.example', keep_owner: true }), 'jwt-owner', SITE_ROW, owner(), cors)));
  const t = open()[0];
  ok('owner starts: 201, waiting on the new owner (no one else to ask)', start.status === 201 && t && t.status === 'asked_new' && t.started_side === 'owner' && t.to_email === 'ana@maple.example' && t.from_email === 'sam@maple.example');
  ok('owner starts: the new owner is emailed a link that signs them in on the transfer page, on the app\'s own address', emails.length === 1 && emails[0].to === 'ana@maple.example' && minted.some((m) => m.email === 'ana@maple.example' && m.redirect_to === `https://app.studio.example/transfer.html?id=${t.id}`));
  ok('owner starts: nothing about the owner has changed yet', clientRow().email === 'sam@maple.example' && clientRow().contact_id === OWNER_CONTACT);
  const again = await answer(await quiet(async () => handleTransferStart(req('POST', { email: 'other@maple.example' }), 'jwt-owner', SITE_ROW, owner(), cors)));
  ok('one at a time: a second request waits for the first to end', again.status === 409 && again.body.error === 'already_open' && open().length === 1);
  const mine = await answer(await quiet(async () => handleTransfersMine(principalOf('jwt-new'), cors)));
  ok('waiting on me: the new owner sees the business, who is handing it over, and that they accept', mine.status === 200 && mine.body.data.length === 1 && mine.body.data[0].business === 'Maple & Main Realty' && mine.body.data[0].owner_name === 'Sam Reyes' && mine.body.data[0].step === 'accept');
  const stranger = await answer(await quiet(async () => handleTransferAnswer(req('POST'), t.id, 'accept', principalOf('jwt-stranger'), cors)));
  ok('accept: anyone else gets a 404, the same as no request at all', stranger.status === 404 && t.status === 'asked_new');
  const ownerAccept = await answer(await quiet(async () => handleTransferAnswer(req('POST'), t.id, 'accept', owner(), cors)));
  ok('accept: the owner can\'t accept for the new owner', ownerAccept.status === 404 && t.status === 'asked_new');
  emails = [];
  const accepted = await answer(await quiet(async () => handleTransferAnswer(req('POST'), t.id, 'accept', principalOf('jwt-new'), cors)));
  const c = clientRow();
  const newContact = DB.contacts.find((x) => x.id === c.contact_id);
  ok('accept: 200, and the request is done', accepted.status === 200 && accepted.body.data.status === 'done' && t.status === 'done' && t.decided_by === 'ana@maple.example');
  ok('accept: the client record names the new owner, through a contact tied to their own sign-in', c.email === 'ana@maple.example' && c.contact_email === 'ana@maple.example' && newContact && newContact.auth_user_id === USERS['jwt-new'].id);
  ok('accept: the old contact is left alone', DB.contacts.find((x) => x.id === OWNER_CONTACT).auth_user_id === USERS['jwt-owner'].id);
  ok('accept: the new owner\'s staff seat here is gone, so it can\'t decide their role ahead of owning it', seat('ana@maple.example').status === 'revoked');
  ok('accept: the old owner stays on as Co-owner, as asked', seat('sam@maple.example')?.role === 'business_owner' && seat('sam@maple.example').status === 'active');
  ok('accept: the studio\'s own record of the owner follows', DB.presence_agency_clients[0].owner_email === 'ana@maple.example');
  ok('accept: the old owner is told', emails.some((e) => e.to === 'sam@maple.example' && /now owns Maple & Main Realty/.test(e.subject)));
  const twice = await answer(await quiet(async () => handleTransferAnswer(req('POST'), t.id, 'accept', principalOf('jwt-new'), cors)));
  ok('accept: pressing again changes nothing', twice.status === 404 && DB.contacts.length === 2);
}

// ═══ 5. the studio asks; the owner agrees; the new owner accepts ═══
{
  reset();
  const refused = await answer(await quiet(async () => handleTransferStart(req('POST', { email: 'ana@maple.example' }), 'jwt-designer', SITE_ROW, designer(), cors)));
  ok('studio: a studio role that can\'t run clients can\'t start one', refused.status === 403 && open().length === 0);
  const co = await answer(await quiet(async () => handleTransferStart(req('POST', { email: 'ana@maple.example' }), 'jwt-coowner', SITE_ROW, coowner(), cors)));
  const plat = await answer(await quiet(async () => handleTransferStart(req('POST', { email: 'ana@maple.example' }), 'jwt-stranger', SITE_ROW, platform(), cors)));
  ok('refused: a Co-owner seat and platform staff, with a sentence', co.status === 403 && plat.status === 403 && /Only the owner/.test(co.body.message) && open().length === 0);
  const busy = await answer(await quiet(async () => handleTransferStart(req('POST', { email: 'busy@owns.example' }), 'jwt-studio', SITE_ROW, studio(), cors)));
  ok('refused: someone who already owns a business here (add them as Co-owner instead)', busy.status === 409 && busy.body.error === 'owns_another' && /Co-owner/.test(busy.body.message));
  const same = await answer(await quiet(async () => handleTransferStart(req('POST', { email: 'sam@maple.example' }), 'jwt-studio', SITE_ROW, studio(), cors)));
  ok('refused: the owner themself', same.status === 409 && same.body.error === 'same_owner');
  const start = await answer(await quiet(async () => handleTransferStart(req('POST', { email: 'ana@maple.example', keep_owner: false }), 'jwt-studio', SITE_ROW, studio(), cors)));
  const t = open()[0];
  ok('studio starts: waiting on the owner to agree, and the owner is the one emailed', start.status === 201 && t.status === 'asked_owner' && t.started_side === 'studio' && emails.length === 1 && emails[0].to === 'sam@maple.example' && /Bright Studio asks/.test(emails[0].subject));
  const early = await answer(await quiet(async () => handleTransferAnswer(req('POST'), t.id, 'accept', principalOf('jwt-new'), cors)));
  ok('studio starts: the new owner can\'t accept before the owner agrees', early.status === 404 && t.status === 'asked_owner' && clientRow().email === 'sam@maple.example');
  const people = await answer(await quiet(async () => handleMembersList('jwt-studio', SITE_ROW, studio(), cors)));
  ok('people: the open request shows on the sheet, waiting on the owner', people.body.transfer && people.body.transfer.status === 'asked_owner' && people.body.transfer.to_email === 'ana@maple.example');
  emails = [];
  const agreed = await answer(await quiet(async () => handleTransferAnswer(req('POST'), t.id, 'agree', owner(), cors)));
  ok('owner agrees: now it waits on the new owner, who is emailed', agreed.status === 200 && t.status === 'asked_new' && emails.length === 1 && emails[0].to === 'ana@maple.example' && /Sam Reyes wants you to own Maple & Main Realty/.test(emails[0].subject));
  ok('owner agrees: still nothing about the owner has changed', clientRow().email === 'sam@maple.example');
  // the owner changes by some other route before the accept: the request can't go ahead
  clientRow().email = 'sam.new@maple.example'; clientRow().contact_email = 'sam.new@maple.example';
  DB.contacts.find((x) => x.id === OWNER_CONTACT).email = 'sam.new@maple.example';
  const stale = await answer(await quiet(async () => handleTransferAnswer(req('POST'), t.id, 'accept', principalOf('jwt-new'), cors)));
  ok('accept: if the owner changed meanwhile, it can\'t go ahead and nothing is written', stale.status === 409 && stale.body.error === 'owner_changed' && t.status === 'asked_new' && clientRow().email === 'sam.new@maple.example' && DB.contacts.length === 1);
  clientRow().email = 'sam@maple.example'; clientRow().contact_email = 'sam@maple.example'; DB.contacts.find((x) => x.id === OWNER_CONTACT).email = 'sam@maple.example';
  const accepted = await answer(await quiet(async () => handleTransferAnswer(req('POST'), t.id, 'accept', principalOf('jwt-new'), cors)));
  ok('accept: then it goes ahead', accepted.status === 200 && clientRow().email === 'ana@maple.example');
  ok('accept: "don\'t keep me on" leaves the old owner without a seat', !seat('sam@maple.example'));
}

// ═══ 6. saying no, stopping, lapsing, and the database step ═══
{
  reset();
  await quiet(async () => handleTransferStart(req('POST', { email: 'ana@maple.example' }), 'jwt-studio', SITE_ROW, studio(), cors));
  const t = open()[0];
  emails = [];
  const no = await answer(await quiet(async () => handleTransferAnswer(req('POST'), t.id, 'decline', owner(), cors)));
  ok('owner says no: declined, the studio that asked is told, nothing changes', no.status === 200 && t.status === 'declined' && emails.some((e) => e.to === 'eric@studio.example') && clientRow().email === 'sam@maple.example');
  await quiet(async () => handleTransferStart(req('POST', { email: 'ana@maple.example' }), 'jwt-owner', SITE_ROW, owner(), cors));
  const t2 = open()[0];
  const stop = await answer(await quiet(async () => handleTransferCancel('jwt-studio', SITE_ROW, studio(), cors)));
  ok('stop: the studio can stop the owner\'s request too, and the new owner is told', stop.status === 200 && t2.status === 'cancelled' && emails.some((e) => e.to === 'ana@maple.example' && /was stopped/.test(e.subject)));
  const none = await answer(await quiet(async () => handleTransferCancel('jwt-owner', SITE_ROW, owner(), cors)));
  ok('stop: with nothing waiting, it says so', none.status === 404);
  const coStop = await answer(await quiet(async () => handleTransferCancel('jwt-coowner', SITE_ROW, coowner(), cors)));
  ok('stop: a Co-owner can\'t', coStop.status === 403);
  await quiet(async () => handleTransferStart(req('POST', { email: 'ana@maple.example' }), 'jwt-owner', SITE_ROW, owner(), cors));
  const t3 = open()[0];
  t3.expires_at = '2020-01-01T00:00:00Z';
  const late = await answer(await quiet(async () => handleTransferAnswer(req('POST'), t3.id, 'accept', principalOf('jwt-new'), cors)));
  ok('lapsed: a request past its date can\'t be accepted', late.status === 404 && clientRow().email === 'sam@maple.example');
  const fresh = await answer(await quiet(async () => handleTransferStart(req('POST', { email: 'ana@maple.example' }), 'jwt-owner', SITE_ROW, owner(), cors)));
  ok('lapsed: and doesn\'t block a new one (it is marked lapsed on the way)', fresh.status === 201 && t3.status === 'expired' && open().length === 1);
  reset(); transfersMissing = true;
  const pre = await answer(await quiet(async () => handleTransferStart(req('POST', { email: 'ana@maple.example' }), 'jwt-owner', SITE_ROW, owner(), cors)));
  ok('before APPLY-0177: a plain 503 naming the step, and nothing sent', pre.status === 503 && /APPLY-0177/.test(pre.body.message) && emails.length === 0);
  const noOwner = (() => { reset(); const c = clientRow(); c.email = null; c.contact_email = null; c.contact_id = null; return 0; })();
  const nobody = await answer(await quiet(async () => handleTransferStart(req('POST', { email: 'ana@maple.example' }), 'jwt-studio', SITE_ROW, studio(), cors)));
  ok('no owner yet: invite the owner first', noOwner === 0 && nobody.status === 409 && nobody.body.error === 'no_owner');
}

// ═══ 7. the Sites card says who owns each site ═══
{
  const { buildSites } = await import(`${P}/agency/sites.ts`);
  const row = (id) => ({ site_id: id, name: 'n', edition: 'presence', status: 'live', tags: [], domain: null, domain_registrar: null, domain_expires_at: null, last_published_at: null, last_change_at: null, unpublished_changes: false, billing_issue: false });
  const extras = [{ id: 's1', client_id: 'c1' }, { id: 's2', client_id: 'c2' }, { id: 's3', client_id: 'c3' }];
  const owners = [{ id: 'c1', name: 'Maple & Main Realty', email: 'sam@maple.example', contact_id: 'k1' }, { id: 'c2', name: 'Harbor Dental', email: null, contact_email: null, contact_id: null }, { id: 'c3', name: 'Bluebird Bakery', email: 'lena@bluebird.example', contact_id: 'k3' }];
  const contacts = [{ id: 'k1', name: 'Sam Reyes' }, { id: 'k3', name: 'Bluebird Bakery' }];
  const transfers = { s3: { id: 't', to_email: 'ana@bluebird.example', from_email: 'lena@bluebird.example', status: 'asked_owner', started_side: 'studio', keep_old: true, expires_at: '2026-12-01T00:00:00Z', created_at: null } };
  const rows = buildSites({ portfolio: ['s1', 's2', 's3'].map(row), extras, plans: [], seats: [], owners, portalSites: [], studio: [], me: '', opened: {}, pins: [], nowIso: NOW, contacts, transfers });
  const by = Object.fromEntries(rows.map((r) => [r.site_id, r]));
  ok('card: the owner by name when their contact holds one', by.s1.owner.name === 'Sam Reyes' && by.s1.owner.email === 'sam@maple.example' && by.s1.no_owner === false);
  ok('card: a site with no owner yet has none, and says so', by.s2.owner === null && by.s2.no_owner === true);
  ok('card: a contact holding the business name shows the email instead', by.s3.owner.name === 'lena@bluebird.example');
  ok('card: a waiting transfer rides on its site only', by.s3.transfer?.to_email === 'ana@bluebird.example' && by.s1.transfer === null && by.s2.transfer === null);
}

// ═══ 9. builder item 191: a fresh code first, and the owner told ═══
{
  reset();
  const noCode = await answer(await quiet(async () => handleMemberAdd(bare('POST', { email: 'alex@maple.example', role: 'business_owner' }), 'jwt-studio', SITE_ROW, studio(), cors)));
  ok('191: inviting a co-owner with no code asks for the app’s, and adds nobody', noCode.status === 403 && noCode.body.error === 'fresh_code_needed' && noCode.body.way === 'app' && !seat('alex@maple.example') && alerts.length === 0);
  const wrong = await answer(await quiet(async () => handleMemberAdd(bare('POST', { email: 'alex@maple.example', role: 'business_owner', fresh_code: '000000' }), 'jwt-studio', SITE_ROW, studio(), cors)));
  ok('191: …a wrong code adds nobody', wrong.status === 403 && wrong.body.error === 'fresh_code_wrong' && !seat('alex@maple.example'));
  const staffSeat = await answer(await quiet(async () => handleMemberAdd(bare('POST', { email: 'kim@maple.example', role: 'business_staff' }), 'jwt-owner', SITE_ROW, owner(), cors)));
  ok('191: inviting Staff needs no code', staffSeat.status === 200 && seat('kim@maple.example')?.role === 'business_staff');
  const made = await answer(await quiet(async () => handleMemberAdd(req('POST', { email: 'alex@maple.example', role: 'business_owner' }), 'jwt-studio', SITE_ROW, studio(), cors)));
  ok('191: with the code, the co-owner is added, and the owner is told who, by whom', made.status === 200 && seat('alex@maple.example')?.role === 'business_owner' && alerts.length === 1 && alerts[0].to === 'sam@maple.example' && alerts[0].subject === 'alex@maple.example is now a co-owner of Maple & Main Realty', JSON.stringify(alerts));
  const promote = await answer(await quiet(async () => handleMemberRole(bare('POST', { role: 'business_owner' }), 'jwt-owner', SITE_ROW, uuid('2'), owner(), cors)));
  ok('191: making Staff a co-owner asks for a code too, and changes nothing without it', promote.status === 403 && promote.body.error === 'fresh_code_needed' && seat('dana@maple.example').role === 'business_staff');
  const promoted = await answer(await quiet(async () => handleMemberRole(req('POST', { role: 'business_owner' }), 'jwt-owner', SITE_ROW, uuid('2'), owner(), cors)));
  ok('191: …with it, the role changes and the owner is told', promoted.status === 200 && seat('dana@maple.example').role === 'business_owner' && alerts.some((a) => a.subject === 'dana@maple.example is now a co-owner of Maple & Main Realty'));
}
{
  reset();
  const noCode = await answer(await quiet(async () => handleTransferStart(bare('POST', { email: 'ana@maple.example' }), 'jwt-owner', SITE_ROW, owner(), cors)));
  ok('191: starting a handover with no code: asked for one, nothing started, nobody emailed', noCode.status === 403 && noCode.body.error === 'fresh_code_needed' && open().length === 0 && emails.length === 0);
  const start = await answer(await quiet(async () => handleTransferStart(req('POST', { email: 'ana@maple.example' }), 'jwt-owner', SITE_ROW, owner(), cors)));
  ok('191: with it, it starts, and the owner who started it gets the alert, in case it wasn’t them', start.status === 201 && open().length === 1 && alerts.length === 1 && alerts[0].to === 'sam@maple.example' && alerts[0].subject === 'Maple & Main Realty is being handed to ana@maple.example');
}
{
  reset();
  await quiet(async () => handleTransferStart(req('POST', { email: 'ana@maple.example' }), 'jwt-studio', SITE_ROW, studio(), cors));
  const t = open()[0];
  ok('191: when the studio starts it, the owner’s email asking them to agree is the news (no second alert)', t?.status === 'asked_owner' && alerts.length === 0 && emails.some((e) => e.to === 'sam@maple.example'));
  const noCode = await answer(await quiet(async () => handleTransferAnswer(bare('POST'), t.id, 'agree', owner(), cors)));
  ok('191: the owner agreeing asks for a code first, and nothing moves without it', noCode.status === 403 && noCode.body.error === 'fresh_code_needed' && t.status === 'asked_owner');
  const agreed = await answer(await quiet(async () => handleTransferAnswer(req('POST'), t.id, 'agree', owner(), cors)));
  ok('191: …with it, it moves on to the new owner', agreed.status === 200 && t.status === 'asked_new');
  const declined = await answer(await quiet(async () => handleTransferAnswer(bare('POST'), t.id, 'decline', principalOf('jwt-new'), cors)));
  ok('191: saying no needs no code', declined.status === 200 && t.status === 'declined');
}

// ═══ 8. wiring ═══
{
  const idx = read('supabase/functions/presence/index.ts');
  const transfers = idx.indexOf("if (route === '/transfers' || route.startsWith('/transfers/'))");
  ok('index: the answers sit before any site is resolved (the new owner has none)', transfers > 0 && transfers < idx.indexOf('// 3. resolve the caller\'s site'));
  ok('index: …and after the sign-in gate', transfers > idx.indexOf("if (principal.kind !== 'client' && principal.kind !== 'staff') {"));
  ok('index: start, stop and the role change sit with the other people routes', /'\/portal\/transfer' && method === 'POST'/.test(idx) && /'\/portal\/transfer\/cancel' && method === 'POST'/.test(idx) && /portal\\\/members\\\/\(\[0-9a-f-\]\{36\}\)\\\/role\$/.test(idx));
  ok('members: the three new writes check the role themselves (open on the member list)', memberWriteNeeds(`/portal/members/${uuid('2')}/role`, 'POST') === 'open' && memberWriteNeeds('/portal/transfer', 'POST') === 'open' && memberWriteNeeds('/portal/transfer/cancel', 'POST') === 'open');
  const mig = read('supabase/migrations/0177_site_transfers.sql'), pack = read('docs/presence/APPLY-0177-prod.sql');
  for (const [name, sql] of [['migration', mig], ['APPLY pack', pack]]) {
    ok(`${name}: one table, row security on, one open request per site`, /create table if not exists public\.presence_site_transfers/.test(sql) && /enable row level security/.test(sql) && /presence_site_transfers_one_open[\s\S]*where status in \('asked_owner', 'asked_new'\)/.test(sql));
    ok(`${name}: the statuses the code uses, and the two sides`, ['asked_owner', 'asked_new', 'done', 'cancelled', 'declined', 'expired'].every((s) => sql.includes(`'${s}'`)) && /started_side in \('owner', 'studio'\)/.test(sql));
  }
  ok('migration: says how to roll back', /rollback: drop table if exists public\.presence_site_transfers;/.test(mig));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ SITE PEOPLE + TRANSFER: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
Deno.exit(0);
