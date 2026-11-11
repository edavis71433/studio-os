// ── Inviting someone already on the team (bug hunt I1, Nov 10 2026) ──────────
// POST /agency/members used to be an upsert on (agency, email) with "merge
// duplicates": inviting an email already on the team rewrote that person's role
// (an admin could make the only owner an account manager), turned a removed person
// back on, and said "Invited". The own-row and last-owner rules only ever ran on
// PATCH. This suite drives handleAgency() with a stubbed fetch (PostgREST answered
// from a table in memory, the (agency, email) unique rule included) and pins:
//   · an invite never carries the owner role;
//   · an email already on the team, whatever its capitals, is refused and nothing
//     is written: not the owner's row, not anyone's;
//   · a removed email is refused until the page says restore, then comes back with
//     the role asked for;
//   · the seat limit is only counted when a seat is needed;
//   · a new email is a plain insert (no merge), and a second insert of the same
//     email at once is "already on the team", never a rewrite.
//
//   deno run --allow-read --allow-env tests/presence/agency_invite_test.mjs
import { handleAgency } from '../../supabase/functions/presence/agency/routes.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const AG = 'aaaaaaaa-0000-4000-8000-000000000001';
const ME_ID = '11111111-1111-4111-8111-111111111111';
const PAT = '22222222-2222-4222-8222-222222222222';
const GONE = '44444444-4444-4444-8444-444444444444';

let members;
function reset() {
  members = [
    { id: ME_ID, agency_id: AG, email: 'eric@brightstudio.example', role: 'owner', status: 'active', created_at: '2026-01-01T00:00:00Z' },
    { id: PAT, agency_id: AG, email: 'Pat@BrightStudio.example', role: 'admin', status: 'active', created_at: '2026-02-01T00:00:00Z' },   // stored with capitals by an older writer
    { id: GONE, agency_id: AG, email: 'jo@brightstudio.example', role: 'designer', status: 'revoked', created_at: '2026-03-01T00:00:00Z' },
  ];
}
const writes = [];
/** the ilike pattern PostgREST would apply: \ escapes, % and _ are wildcards, no case */
function likeRe(p) {
  let s = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '\\' && i + 1 < p.length) { s += p[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue; }
    s += c === '%' ? '.*' : c === '_' ? '.' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + s + '$', 'i');
}
function rowsFor(params) {
  return members.filter((r) => [...params.entries()].every(([k, v]) => {
    if (['select', 'limit', 'order', 'on_conflict'].includes(k)) return true;
    if (v.startsWith('eq.')) return String(r[k]) === v.slice(3);
    if (v.startsWith('ilike.')) return likeRe(v.slice(6)).test(String(r[k]));
    if (v.startsWith('in.(')) return v.slice(4, -1).split(',').includes(String(r[k]));
    return true;
  }));
}
let failNextInsertAsDuplicate = false;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url), 'http://stub.local');
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (!u.pathname.includes('/rest/v1/')) return reply({ error: 'not stubbed' }, 500);   // the invite email: best effort, never blocks
  const table = u.pathname.replace(/^.*\/rest\/v1\//, '');
  if (table !== 'presence_agency_members') return reply([]);
  const method = (init.method || 'GET').toUpperCase();
  if (method === 'GET') return reply(rowsFor(u.searchParams));
  const body = init.body ? JSON.parse(init.body) : null;
  writes.push({ method, body, query: decodeURIComponent(u.search), prefer: new Headers(init.headers).get('Prefer') || '' });
  if (method === 'PATCH') {
    const hit = rowsFor(u.searchParams);
    hit.forEach((r) => Object.assign(r, body));
    return reply(hit.map(({ id, email, role, status }) => ({ id, email, role, status })));
  }
  if (method === 'POST') {
    // the table's unique (agency_id, email): an insert never merges into a row
    const dup = failNextInsertAsDuplicate || members.some((r) => r.agency_id === body.agency_id && r.email === body.email);
    failNextInsertAsDuplicate = false;
    if (dup) return reply({ code: '23505', message: 'duplicate key value violates unique constraint' }, 409);
    const row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...body };
    members.push(row);
    return reply([{ id: row.id, email: row.email, role: row.role, status: row.status }], 201);
  }
  return reply([]);
};

const cors = {};
const asMember = (over = {}) => ({ agency_id: AG, member_id: ME_ID, email: 'eric@brightstudio.example', role: 'owner', agency_name: 'Bright Studio', seat_limit: 5, client_limit: 10, plan: 'agency', branding: {}, ...over });
const asPat = (over = {}) => asMember({ member_id: PAT, email: 'pat@brightstudio.example', role: 'admin', ...over });
async function invite(member, body) {
  const req = new Request('http://stub.local/functions/v1/presence/agency/members', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
  const res = await handleAgency(req, '/agency/members', 'POST', member, { kind: 'member' }, cors);
  return { status: res.status, body: await res.json() };
}
const row = (id) => members.find((m) => m.id === id);
const memberWrites = () => writes.filter((w) => w.method !== 'GET');

// ═══ 1. an invite never makes an owner ═══
{
  reset(); writes.length = 0;
  const r = await invite(asMember(), { email: 'new@brightstudio.example', role: 'owner' });
  ok('owner role: refused with 400 bad_role, in plain words', r.status === 400 && r.body.error === 'bad_role' && /^An invite can’t make an owner\./.test(r.body.message));
  ok('owner role: nothing written', memberWrites().length === 0 && members.length === 3);
}

// ═══ 2. an email already on the team is never rewritten ═══
{
  reset(); writes.length = 0;
  const owner = await invite(asPat(), { email: 'eric@brightstudio.example', role: 'account_manager' });
  ok('the only owner, invited by an admin as account manager: 409 already_member', owner.status === 409 && owner.body.error === 'already_member' && owner.body.message === 'eric@brightstudio.example is already on the team. Change their role in the list.');
  ok('…and the owner is still the owner, nothing written', row(ME_ID).role === 'owner' && row(ME_ID).status === 'active' && memberWrites().length === 0);
  const caps = await invite(asMember(), { email: 'PAT@brightstudio.EXAMPLE', role: 'readonly' });
  ok('an email on the team with other capitals is the same person: 409, role kept', caps.status === 409 && caps.body.error === 'already_member' && row(PAT).role === 'admin' && memberWrites().length === 0);
  const self = await invite(asMember(), { email: 'eric@brightstudio.example', role: 'admin' });
  ok('inviting your own email: 409 already_member, your role kept', self.status === 409 && row(ME_ID).role === 'owner');
}

// ═══ 3. a removed person comes back only when the page says so ═══
{
  reset(); writes.length = 0;
  const ask = await invite(asMember(), { email: 'jo@brightstudio.example', role: 'support' });
  ok('removed email, plain invite: 409 was_removed, still removed, nothing written', ask.status === 409 && ask.body.error === 'was_removed' && row(GONE).status === 'revoked' && row(GONE).role === 'designer' && memberWrites().length === 0);
  const back = await invite(asMember(), { email: 'jo@brightstudio.example', role: 'support', restore: true });
  ok('removed email with restore: 200, active again with the role asked for, marked restored', back.status === 200 && back.body.data.status === 'active' && back.body.data.role === 'support' && back.body.data.restored === true && row(GONE).status === 'active' && row(GONE).role === 'support');
  ok('…written as a PATCH of that one row, only while it is still removed', memberWrites().length === 1 && memberWrites()[0].method === 'PATCH' && memberWrites()[0].query.includes(`id=eq.${GONE}`) && memberWrites()[0].query.includes('status=eq.revoked'));
  const again = await invite(asMember(), { email: 'jo@brightstudio.example', role: 'admin', restore: true });
  ok('restore on someone already back is "already on the team", role kept', again.status === 409 && again.body.error === 'already_member' && row(GONE).role === 'support');
}

// ═══ 4. the seat limit counts only when a seat is needed ═══
{
  reset(); writes.length = 0;
  const full = asMember({ seat_limit: 2 });   // eric + pat active: full
  const existing = await invite(full, { email: 'pat@brightstudio.example', role: 'designer' });
  ok('full seats, an email already on the team: "already on the team", not a seat refusal', existing.status === 409 && existing.body.error === 'already_member');
  const fresh = await invite(full, { email: 'kim@brightstudio.example', role: 'designer' });
  ok('full seats, a new person: 400 seat_limit', fresh.status === 400 && fresh.body.error === 'seat_limit');
  const back = await invite(full, { email: 'jo@brightstudio.example', role: 'designer', restore: true });
  ok('full seats, bringing a removed person back needs a seat too: 400 seat_limit, still removed', back.status === 400 && back.body.error === 'seat_limit' && row(GONE).status === 'revoked');
  ok('…nothing written by any of the three', memberWrites().length === 0);
}

// ═══ 5. a new email is a plain insert ═══
{
  reset(); writes.length = 0;
  const r = await invite(asMember(), { email: '  Kim@BrightStudio.example ', role: 'designer' });
  ok('new email: 200, lower-cased, active, with the role asked for', r.status === 200 && r.body.data.email === 'kim@brightstudio.example' && r.body.data.role === 'designer' && r.body.data.status === 'active' && r.body.data.restored === false);
  const w = memberWrites()[0] || {};
  ok('…a POST with no on_conflict and no merge-duplicates (an insert can never rewrite a row)', memberWrites().length === 1 && w.method === 'POST' && !w.query.includes('on_conflict') && !/merge-duplicates/.test(w.prefer));
  ok('…the invite email failing does not undo the seat (emailed false)', r.body.data.emailed === false && members.some((m) => m.email === 'kim@brightstudio.example'));
  writes.length = 0; failNextInsertAsDuplicate = true;
  const race = await invite(asMember(), { email: 'lee@brightstudio.example', role: 'designer' });
  ok('two invites of one new email at once: the second meets the unique rule → 409 already_member', race.status === 409 && race.body.error === 'already_member');
  const nope = await invite(asMember({ member_id: PAT, email: 'pat@brightstudio.example', role: 'designer' }), { email: 'x@brightstudio.example', role: 'designer' });
  ok('a designer has no manage_members → 403, before any read', nope.status === 403);
  const bad = await invite(asMember(), { email: 'no-at-sign', role: 'designer' });
  ok('no email → 400 bad_request', bad.status === 400 && bad.body.error === 'bad_request');
}

const fails = results.filter((r) => !r.p);
console.log(`\n════ AGENCY INVITES: ${results.length - fails.length}/${results.length} PASSED ════`);
if (fails.length) Deno.exit(1);
