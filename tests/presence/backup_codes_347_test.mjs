// ── Backup codes for two-step sign-in (builder list item 347) ──────────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/backup_codes_347_test.mjs
//
// PART A — the pure rules (lib/backup_codes.ts): the code's shape (8 symbols, no 0/O/1/I,
//          shown XXXX-XXXX, typed back any way), the hash (sha256(salt|CODE), the page's
//          rule), the constant-time compare, the one-use match, the set summary, the email.
// PART B — the routes (routes/backup_codes.ts) through a fetch fake: PostgREST answered from
//          memory (fake_pgrst.mjs), the auth ADMIN API faked (a user with their factors, a
//          user by email, deleting a factor), Resend caught.
//          · GET: none yet; after a save; a database before 0253 says so
//          · POST: bad hashes refused; no authenticator app refused; ten rows of hashes and
//            never a code; a second save replaces the first
//          · use: unknown email, wrong code and no codes get ONE identical answer; the right
//            code removes every TOTP factor, burns the set, emails with the studio's brand,
//            and writes the change log; the same code twice fails (two at once: one wins);
//            a factor that won't go gives the code back; the limiter's no is a 429
//          · the owner's route through handleAgency: owner only, their own client only, a
//            client with no sign-in / no second step, the fresh code asked first, then the
//            factor goes, the client is emailed under the studio's brand, the log says so
// PART C — migration 0253 (the table, its indexes, row security, the wider fresh-code
//          constraint) and the APPLY-0253 note at its top; the apply pack in docs/; the
//          route wiring in index.ts and the agency router.
import { installFakePostgrest } from './fake_pgrst.mjs';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

// ═══ the fake world, before the first import of the code under test ═══
const ALEX = '11111111-1111-4111-8111-111111111111';   // a studio's client, two-step on
const BEA = '22222222-2222-4222-8222-222222222222';    // two-step off
const OWNER = '33333333-3333-4333-8333-333333333333';  // the studio's owner
const AG = 'aaaaaaaa-0000-4000-8000-000000000001';
const STUDIO_SITE = '55555555-5555-4555-8555-555555555555';
const ALEX_SITE = '66666666-6666-4666-8666-666666666666';
const BEA_SITE = '77777777-7777-4777-8777-777777777777';
const ALEX_CLIENT = '88888888-8888-4888-8888-888888888888';
const BEA_CLIENT = '99999999-9999-4999-8999-999999999999';
const ALEX_CONTACT = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1';
const BEA_CONTACT = 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2';

const db = installFakePostgrest({
  users: {
    'jwt-alex': { id: ALEX, email: 'alex@bloom.example', aud: 'authenticated' },
    'jwt-bea': { id: BEA, email: 'bea@bloom.example', aud: 'authenticated' },
    'jwt-owner': { id: OWNER, email: 'eric@brightstudio.example', aud: 'authenticated' },
  },
  ownSite: { 'jwt-alex': ALEX_SITE, 'jwt-bea': BEA_SITE, 'jwt-owner': STUDIO_SITE },
});
Deno.env.set('RESEND_KEY', 'test-resend-key');
Deno.env.set('SITE_URL', 'https://app.test');

/** the auth ADMIN API, as GoTrue answers it; `admin` is what the tests reach into */
const admin = { users: {}, deleted: [], refuseDelete: false, listCalls: [] };
const seedAdmin = () => {
  admin.users = {
    [ALEX]: { id: ALEX, email: 'alex@bloom.example', factors: [{ id: 'f-alex-1', factor_type: 'totp', status: 'verified' }, { id: 'f-alex-2', factor_type: 'totp', status: 'unverified' }] },
    [BEA]: { id: BEA, email: 'bea@bloom.example', factors: [] },
    [OWNER]: { id: OWNER, email: 'eric@brightstudio.example', factors: [{ id: 'f-owner', factor_type: 'totp', status: 'verified' }] },
  };
  admin.deleted = []; admin.refuseDelete = false; admin.listCalls = [];
};
const mails = [];
let rateSaysNo = false, tableGone = false;
const inner = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url)); const method = (init.method || 'GET').toUpperCase();
  const reply = (b, s = 200) => new Response(s === 204 ? null : JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
  const tok = (new Headers(init.headers).get('Authorization') || '').replace(/^Bearer /, '');
  if (u.pathname.startsWith('/auth/v1/admin/')) {
    if (tok !== 'svc-key') return reply({ msg: 'not the service role' }, 401);
    const m = u.pathname.match(/^\/auth\/v1\/admin\/users\/([^/]+)\/factors\/([^/]+)$/);
    if (m && method === 'DELETE') {
      if (admin.refuseDelete) return reply({ msg: 'boom' }, 500);
      const user = admin.users[m[1]]; if (!user) return reply({ msg: 'no user' }, 404);
      const before = user.factors.length; user.factors = user.factors.filter((f) => f.id !== m[2]);
      admin.deleted.push(`${m[1]}/${m[2]}`);
      return before === user.factors.length ? reply({ msg: 'no factor' }, 404) : reply({ id: m[2] });
    }
    if (u.pathname === '/auth/v1/admin/users' && method === 'GET') {
      const filter = (u.searchParams.get('filter') || '').toLowerCase(); admin.listCalls.push(filter);
      // GoTrue's filter is a contains-search: "ale" matches alex AND a lookalike
      const users = Object.values(admin.users).filter((x) => x.email.includes(filter));
      return reply({ users, aud: 'authenticated' });
    }
    const one = u.pathname.match(/^\/auth\/v1\/admin\/users\/([^/]+)$/);
    if (one && method === 'GET') return admin.users[one[1]] ? reply(admin.users[one[1]]) : reply({ msg: 'no user' }, 404);
    return reply({ msg: 'not stubbed' }, 404);
  }
  if (u.hostname === 'api.resend.com') { const b = JSON.parse(String(init.body)); mails.push({ to: b.to, from: b.from, subject: b.subject, html: b.html }); return reply({ id: `mail-${mails.length}` }); }
  if (u.pathname === '/rest/v1/rpc/rate_hit_both') { db.log.push({ method, url: decodeURIComponent(u.pathname + u.search), body: JSON.parse(String(init.body || 'null')) }); return reply(rateSaysNo ? false : true); }
  if (tableGone && u.pathname.startsWith('/rest/v1/presence_backup_codes')) return reply({ code: 'PGRST205', message: 'Could not find the table' }, 404);
  return inner(url, init);
};

const L = await import('../../supabase/functions/presence/lib/backup_codes.ts');
const R = await import('../../supabase/functions/presence/routes/backup_codes.ts');
const F = await import('../../supabase/functions/presence/lib/fresh_code.ts');
const { handleAgency } = await import('../../supabase/functions/presence/agency/routes.ts');

const sha256hex = async (s) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))).map((b) => b.toString(16).padStart(2, '0')).join('');

// ═══ PART A — the pure rules ═══
{
  ok('A1: a code typed with the dash, in lower case, with spaces, reads as 8 capitals', L.normalizeCode('abcd-efgh') === 'ABCDEFGH' && L.normalizeCode(' AB CD EF GH ') === 'ABCDEFGH' && L.normalizeCode('ABCDEFGH') === 'ABCDEFGH');
  ok('A2: 0, O, 1 and I are not in the alphabet, so a code with one is no code', L.normalizeCode('ABCD-EFG0') === '' && L.normalizeCode('ABCD-EFGO') === '' && L.normalizeCode('ABCD-EFG1') === '' && L.normalizeCode('ABCD-EFGI') === '' && !/[01OI]/.test(L.CODE_ALPHABET) && L.CODE_ALPHABET.length === 32);
  ok('A3: the wrong length, an empty value, a number or nothing is no code', L.normalizeCode('ABCDEFG') === '' && L.normalizeCode('ABCDEFGHJ') === '' && L.normalizeCode('') === '' && L.normalizeCode(12345678) === '' && L.normalizeCode(undefined) === '' && L.normalizeCode(null) === '');
  ok('A4: a code is shown as XXXX-XXXX; a non-code shows as nothing', L.formatCode('abcdefgh') === 'ABCD-EFGH' && L.formatCode('ABCD-EFGH') === 'ABCD-EFGH' && L.formatCode('nope') === '');
  ok('A5: a salt is 32 to 128 lowercase hex characters', L.isSalt('a'.repeat(32)) && L.isSalt('0123456789abcdef'.repeat(8)) && !L.isSalt('A'.repeat(32)) && !L.isSalt('a'.repeat(31)) && !L.isSalt('a'.repeat(129)) && !L.isSalt(42));
  ok('A6: a hash is 64 lowercase hex characters', L.isHash('f'.repeat(64)) && !L.isHash('F'.repeat(64)) && !L.isHash('f'.repeat(63)) && !L.isHash(null));
  const ten = Array.from({ length: 10 }, (_, i) => String(i).repeat(64));
  ok('A7: a set is exactly ten different hashes', L.isHashList(ten) && !L.isHashList(ten.slice(0, 9)) && !L.isHashList([...ten, 'a'.repeat(64)]) && !L.isHashList([...ten.slice(0, 9), ten[0]]) && !L.isHashList('x') && !L.isHashList([...ten.slice(0, 9), 'zz']));
  const salt = 'ab'.repeat(16);
  const h = await L.codeHash('abcd-efgh', salt);
  ok('A8: the hash is sha256(salt|CODE) in hex, the code normalised first (the page hashes the same way)', h === await sha256hex(`${salt}|ABCDEFGH`) && h === await L.codeHash('ABCDEFGH', salt) && h === await L.codeHash(' ab cd-ef gh ', salt));
  ok('A9: a non-code or a bad salt hashes to nothing (never a match)', await L.codeHash('ABCD-EFG0', salt) === '' && await L.codeHash('ABCDEFGH', 'short') === '');
  ok('A10: a different salt gives a different hash', await L.codeHash('ABCDEFGH', 'cd'.repeat(16)) !== h);
  ok('A11: sameHash: equal is true; a different character, a different length, empty, or a non-string is false', L.sameHash(h, h) && !L.sameHash(h, h.slice(0, -1) + (h.endsWith('0') ? '1' : '0')) && !L.sameHash(h, h.slice(0, 63)) && !L.sameHash('', '') && !L.sameHash(h, null) && !L.sameHash(undefined, h));
  ok('A12: a difference in the first character and one in the last are both just "no"', !L.sameHash('a' + h.slice(1), 'b' + h.slice(1)) && !L.sameHash(h.slice(0, -1) + 'a', h.slice(0, -1) + 'b') && L.sameHash('a' + h.slice(1), 'a' + h.slice(1)));
  const rowsA = [
    { id: 'r1', code_hash: h, salt, used_at: '2026-11-01T00:00:00Z' },   // this code, already used
    { id: 'r2', code_hash: await L.codeHash('BCDEFGHJ', salt), salt, used_at: null },
    { id: 'r3', code_hash: h, salt, used_at: null },                       // this code, unused
  ];
  const by = (s) => (s === salt ? h : '');
  ok('A13: matchRow finds the UNUSED row for the code and skips the used one', L.matchRow(rowsA, by, (r) => r.salt)?.id === 'r3');
  ok('A14: matchRow: no unused row with that hash → null; no rows → null', L.matchRow(rowsA.slice(0, 2), by, (r) => r.salt) === null && L.matchRow([], by, (r) => r.salt) === null && L.matchRow(null, by, (r) => '') === null);
  const fixed = (a) => { a.fill(7); return a; };
  ok('A15: newCode takes 8 symbols from the alphabet; a fixed byte source gives a fixed code', L.newCode().length === 8 && [...L.newCode()].every((c) => L.CODE_ALPHABET.includes(c)) && L.newCode(fixed) === L.CODE_ALPHABET[7].repeat(8));
  const set = L.newSet();
  ok('A16: newSet gives ten different codes and a 32-hex salt (what the page makes)', set.codes.length === 10 && new Set(set.codes).size === 10 && set.codes.every((c) => L.normalizeCode(c) === c) && L.isSalt(set.salt) && set.salt.length === 32);
  const hashes = await L.hashSet(set.codes, set.salt);
  ok('A17: hashSet hashes a set in order; the result is a valid list', L.isHashList(hashes) && hashes[3] === await L.codeHash(set.codes[3], set.salt));
  ok('A18: setSummary counts the unused rows and the earliest created_at; none → 0 and null', JSON.stringify(L.setSummary([{ used_at: null, created_at: '2026-11-02T00:00:00Z' }, { used_at: '2026-11-03T00:00:00Z', created_at: '2026-11-01T00:00:00Z' }])) === JSON.stringify({ remaining: 1, total: 2, created_at: '2026-11-01T00:00:00Z' }) && JSON.stringify(L.setSummary([])) === JSON.stringify({ remaining: 0, total: 0, created_at: null }));
  ok('A19: whenText reads as a plain UTC time; garbage is nothing', L.whenText('2026-11-22T14:05:09Z') === 'Sun, 22 Nov 2026 14:05 UTC' && L.whenText('soon') === '');
  const m1 = L.offEmail('code', { at: '2026-11-22T14:05:09Z', signInUrl: 'https://app.test/portal.html' });
  ok('A20: the backup-code email says what happened, when, how to sign in, and what to do if it wasn\'t you', m1.subject === 'Two-step sign-in was turned off with a backup code' && /backup code was used/.test(m1.html) && /22 Nov 2026 14:05 UTC/.test(m1.html) && /https:\/\/app\.test\/portal\.html/.test(m1.html) && /Wasn’t you\?/.test(m1.html) && /Change your password/.test(m1.html));
  const m2 = L.offEmail('studio', { at: '2026-11-22T14:05:09Z', studio: 'Bright <Studio>' });
  ok('A21: the studio\'s email names the studio (escaped) and says the client asked', m2.subject === 'Bright <Studio> turned off your two-step sign-in' && /Bright &lt;Studio&gt; turned off two-step sign-in/.test(m2.html) && /because you asked them to/.test(m2.html) && /Didn’t ask for this\?/.test(m2.html));
  ok('A22: without a studio name the studio email still reads', /^Your studio turned off/.test(L.offEmail('studio', { at: 'x' }).subject));
  ok('A23: the change-log lines', L.offSummary('code', 'a***@x.y') === 'Two-step sign-in was turned off with a backup code (a***@x.y)' && L.offSummary('studio', 'a***@x.y') === 'Turned off two-step sign-in for a***@x.y');
  ok('A24: the fresh-code action is named and has its words (lib/fresh_code.ts)', L.TWO_STEP_OFF_ACTION === 'two_step_off' && F.FRESH_WORDS.two_step_off && /two-step/.test(F.FRESH_WORDS.two_step_off.doing) && /Confirm/.test(F.FRESH_WORDS.two_step_off.go));
  ok('A25: totpFactors lists every authenticator-app factor, verified or not, and nothing else', JSON.stringify(R.totpFactors({ factors: [{ id: 'a', factor_type: 'totp', status: 'verified' }, { id: 'b', factor_type: 'totp', status: 'unverified' }, { id: 'c', factor_type: 'phone', status: 'verified' }] })) === '["a","b"]' && R.totpFactors(null).length === 0);
}

// ═══ PART B — the routes ═══
const cors = { 'Access-Control-Allow-Origin': '*' };
const principal = (jwt, id, email) => ({ kind: 'client', userId: id, tenantId: null, role: 'client', email, jwt, requestId: 'req' });
const P_ALEX = principal('jwt-alex', ALEX, 'alex@bloom.example'), P_BEA = principal('jwt-bea', BEA, 'bea@bloom.example'), P_OWNER = principal('jwt-owner', OWNER, 'eric@brightstudio.example');
const post = (body) => new Request('http://stub.local/x', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.9' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const out = async (res) => ({ status: res.status, body: await res.json().catch(() => null), nostore: res.headers.get('Cache-Control') === 'no-store' });
const tables = () => ({
  presence_sites: [
    { id: STUDIO_SITE, client_id: null, user_id: OWNER, business_name: 'Bright Studio', created_at: '2026-01-01T00:00:00Z' },
    { id: ALEX_SITE, client_id: ALEX_CLIENT, user_id: ALEX, business_name: 'Bloom Salon', created_at: '2026-02-01T00:00:00Z' },
    { id: BEA_SITE, client_id: BEA_CLIENT, user_id: BEA, business_name: 'Bea Bakes', created_at: '2026-03-01T00:00:00Z' },
  ],
  clients: [
    { id: ALEX_CLIENT, name: 'Bloom Salon', email: 'alex@bloom.example', contact_email: null, contact_id: ALEX_CONTACT },
    { id: BEA_CLIENT, name: 'Bea Bakes', email: 'bea@bloom.example', contact_email: null, contact_id: BEA_CONTACT },
  ],
  contacts: [{ id: ALEX_CONTACT, auth_user_id: ALEX }, { id: BEA_CONTACT, auth_user_id: BEA }],
  presence_service_links: [{ project_id: 'p1', agency_site_id: STUDIO_SITE, customer_client_id: ALEX_CLIENT, status: 'active', created_at: '2026-02-02T00:00:00Z' }],
  presence_identity: [{ site_id: STUDIO_SITE, business_name: 'Bright Studio' }],
  presence_agency_clients: [{ agency_id: AG, site_id: ALEX_SITE, status: 'active' }, { agency_id: AG, site_id: BEA_SITE, status: 'active' }],
  presence_agency_members: [{ id: 'm1', agency_id: AG, email: 'eric@brightstudio.example', role: 'owner', status: 'active', user_id: OWNER }],
  presence_agencies: [{ id: AG, name: 'Bright Studio', status: 'active', seat_limit: 5, client_limit: 50, plan: 'studio', branding: {} }],
  presence_backup_codes: [],
  presence_change_events: [],
});
const reset = () => { db.reset(tables()); seedAdmin(); mails.length = 0; rateSaysNo = false; tableGone = false; };
const codesTable = () => db.tables.presence_backup_codes || [];
const events = () => db.tables.presence_change_events || [];

// ── GET and POST /auth/backup-codes ──
{
  reset();
  let r = await out(await R.handleBackupCodesGet(P_ALEX, cors));
  ok('B1: GET with no set → remaining 0, created_at null, no-store', r.status === 200 && r.body.data.remaining === 0 && r.body.data.total === 0 && r.body.data.created_at === null && r.nostore);
  r = await out(await R.handleBackupCodesGet({ ...P_ALEX, userId: null }, cors));
  ok('B2: GET without a sign-in → 401', r.status === 401);
  tableGone = true;
  r = await out(await R.handleBackupCodesGet(P_ALEX, cors));
  ok('B3: a database before 0253 → 503 "needs a one-time database update"', r.status === 503 && /one-time database update/.test(r.body.message));
  r = await out(await R.handleBackupCodesSave(post({ hashes: Array.from({ length: 10 }, (_, i) => String(i).repeat(64)), salt: 'ab'.repeat(16) }), P_ALEX, cors));
  ok('B4: a save before 0253 → 503 too, nothing written', r.status === 503 && codesTable().length === 0);
  tableGone = false;

  const set = L.newSet(); const hashes = await L.hashSet(set.codes, set.salt);
  r = await out(await R.handleBackupCodesSave(post({ hashes: hashes.slice(0, 9), salt: set.salt }), P_ALEX, cors));
  ok('B5: nine hashes → 422 bad_codes', r.status === 422 && r.body.error === 'bad_codes');
  r = await out(await R.handleBackupCodesSave(post({ hashes: [...hashes.slice(0, 9), hashes[0]], salt: set.salt }), P_ALEX, cors));
  ok('B6: a repeated hash → 422', r.status === 422);
  r = await out(await R.handleBackupCodesSave(post({ hashes, salt: 'not-hex' }), P_ALEX, cors));
  ok('B7: a bad salt → 422', r.status === 422);
  r = await out(await R.handleBackupCodesSave(post('{nope'), P_ALEX, cors));
  ok('B8: no body → 422', r.status === 422);
  r = await out(await R.handleBackupCodesSave(post({ hashes, salt: set.salt }), P_BEA, cors));
  ok('B9: no verified authenticator app → 409 two_step_off, nothing written', r.status === 409 && r.body.error === 'two_step_off' && codesTable().length === 0);
  r = await out(await R.handleBackupCodesSave(post({ hashes, salt: set.salt }), P_ALEX, cors));
  ok('B10: a good save → 200 { count: 10, created_at }', r.status === 200 && r.body.data.count === 10 && typeof r.body.data.created_at === 'string' && r.nostore);
  const rows1 = codesTable();
  ok('B11: ten rows, each the hash and the salt, the user and their site, unused', rows1.length === 10 && rows1.every((x) => x.user_id === ALEX && x.site_id === ALEX_SITE && x.salt === set.salt && !x.used_at) && hashes.every((h) => rows1.some((x) => x.code_hash === h)));
  const dump = JSON.stringify(db.log.filter((c) => c.method !== 'GET'));
  ok('B12: no code ever reached the server (only hashes in every write)', set.codes.every((c) => !dump.includes(c)));
  r = await out(await R.handleBackupCodesGet(P_ALEX, cors));
  ok('B13: GET after the save → remaining 10 and when', r.status === 200 && r.body.data.remaining === 10 && r.body.data.total === 10 && r.body.data.created_at === rows1[0].created_at);
  const set2 = L.newSet(); const hashes2 = await L.hashSet(set2.codes, set2.salt);
  r = await out(await R.handleBackupCodesSave(post({ hashes: hashes2, salt: set2.salt }), P_ALEX, cors));
  const rows2 = codesTable();
  ok('B14: a second save replaces the first: ten rows, all new, none of the old hashes', r.status === 200 && rows2.length === 10 && rows2.every((x) => x.salt === set2.salt) && hashes.every((h) => !rows2.some((x) => x.code_hash === h)));
  r = await out(await R.handleBackupCodesGet(P_BEA, cors));
  ok('B15: another person\'s GET sees none of them', r.body.data.remaining === 0);
}

// ── POST /auth/backup-codes/use ──
const seedSet = async (uid, siteId) => {
  const set = L.newSet(); const hashes = await L.hashSet(set.codes, set.salt);
  const created_at = '2026-11-20T10:00:00Z';
  db.tables.presence_backup_codes.push(...hashes.map((code_hash, i) => ({ id: `${uid.slice(0, 8)}-${i}`, user_id: uid, site_id: siteId, code_hash, salt: set.salt, used_at: null, created_at })));
  return set;
};
{
  reset();
  const set = await seedSet(ALEX, ALEX_SITE);
  let r = await out(await R.handleBackupCodeUse(post({ email: 'alex@bloom.example' }), cors));
  ok('B16: no code → 400 (and no lookup made)', r.status === 400 && admin.listCalls.length === 0);
  r = await out(await R.handleBackupCodeUse(post({ email: 'nope', code: set.codes[0] }), cors));
  ok('B17: no email → 400', r.status === 400 && admin.listCalls.length === 0);
  r = await out(await R.handleBackupCodeUse(post({ email: 'alex@bloom.example', code: 'ABCD-EFG0' }), cors));
  ok('B18: a code with a 0 in it is no code → 400 before any lookup', r.status === 400 && admin.listCalls.length === 0);

  const unknown = await out(await R.handleBackupCodeUse(post({ email: 'nobody@bloom.example', code: set.codes[0] }), cors));
  const wrong = await out(await R.handleBackupCodeUse(post({ email: 'alex@bloom.example', code: 'BCDEFGHJ' }), cors));
  const none = await out(await R.handleBackupCodeUse(post({ email: 'bea@bloom.example', code: set.codes[0] }), cors));
  const same = JSON.stringify(unknown.body) === JSON.stringify(wrong.body) && JSON.stringify(wrong.body) === JSON.stringify(none.body) && unknown.status === wrong.status && wrong.status === none.status;
  ok('B19: unknown email, wrong code and no codes → ONE identical answer (403, ok:false)', same && unknown.status === 403 && unknown.body.ok === false && unknown.nostore);
  ok('B20: those three removed no factor and sent no mail', admin.deleted.length === 0 && mails.length === 0);
  ok('B21: a wrong code leaves the set whole', codesTable().filter((x) => x.user_id === ALEX && !x.used_at).length === 10);

  // a lookalike the list's contains-search also returns must not be taken for Alex
  admin.users['dddddddd-dddd-4ddd-8ddd-dddddddddddd'] = { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', email: 'alex@bloom.example.evil', factors: [] };
  r = await out(await R.handleBackupCodeUse(post({ email: 'ALEX@Bloom.example', code: set.codes[2].toLowerCase().replace(/^(....)/, '$1-') }), cors));
  ok('B22: the right code (typed in lower case with the dash, email in capitals) → 200 ok:true', r.status === 200 && r.body.ok === true && /Two-step sign-in is off/.test(r.body.message) && r.nostore);
  ok('B23: every TOTP factor of the account is removed through the admin API (verified and the half-set-up one), nobody else\'s', admin.deleted.length === 2 && admin.deleted.includes(`${ALEX}/f-alex-1`) && admin.deleted.includes(`${ALEX}/f-alex-2`) && admin.users[ALEX].factors.length === 0 && admin.users[OWNER].factors.length === 1);
  ok('B24: the set is burned: no backup-code rows for Alex remain', codesTable().filter((x) => x.user_id === ALEX).length === 0);
  const m = mails[0];
  ok('B25: Alex is emailed "Two-step sign-in was turned off with a backup code" under the studio\'s brand', mails.length === 1 && m.to === 'alex@bloom.example' && m.subject === 'Two-step sign-in was turned off with a backup code' && /Bright Studio/.test(m.from) && /Bright Studio/.test(m.html) && r.body.emailed === true);
  ok('B26: the email is critical mail: no unsubscribe link in it', !/unsubscribe/i.test(m.html));
  const ev = events()[0];
  ok('B27: the change log on Alex\'s site says it, with the email masked', events().length === 1 && ev.site_id === ALEX_SITE && ev.entity_type === 'site' && ev.action === 'update' && /turned off with a backup code/.test(ev.summary) && !/alex@bloom\.example/.test(ev.summary) && ev.actor_user_id === ALEX);
  const again = await out(await R.handleBackupCodeUse(post({ email: 'alex@bloom.example', code: set.codes[2] }), cors));
  ok('B28: the same code a second time → the generic refusal', again.status === 403 && JSON.stringify(again.body) === JSON.stringify(unknown.body));
  ok('B29: the lookup by email is exact: the contains-search match with another address was not used', admin.deleted.every((d) => d.startsWith(ALEX)));
}
{
  // a used row stays refused, and two requests with one code can't both win
  reset();
  const set = await seedSet(ALEX, ALEX_SITE);
  db.tables.presence_backup_codes[0].used_at = '2026-11-21T00:00:00Z';
  let r = await out(await R.handleBackupCodeUse(post({ email: 'alex@bloom.example', code: set.codes[0] }), cors));
  ok('B30: a code already marked used → refused, no factor removed', r.status === 403 && admin.deleted.length === 0);
  const [a, b] = await Promise.all([
    R.handleBackupCodeUse(post({ email: 'alex@bloom.example', code: set.codes[1] }), cors).then(out),
    R.handleBackupCodeUse(post({ email: 'alex@bloom.example', code: set.codes[1] }), cors).then(out),
  ]);
  ok('B31: two uses of one code at once: exactly one succeeds (used_at set with used_at=is.null in the WHERE)', [a, b].filter((x) => x.status === 200).length === 1 && [a, b].filter((x) => x.status === 403).length === 1);
  const patch = db.log.find((c) => c.method === 'PATCH' && c.url.includes('presence_backup_codes') && c.body?.used_at);
  ok('B32: the marking PATCH carries used_at=is.null and asks for the row back', !!patch && /used_at=is\.null/.test(patch.url) && !/user_id=eq/.test(patch.url));
}
{
  // the factor won't go: the code is given back and nothing else changes
  reset();
  const set = await seedSet(ALEX, ALEX_SITE);
  admin.refuseDelete = true;
  const r = await out(await R.handleBackupCodeUse(post({ email: 'alex@bloom.example', code: set.codes[3] }), cors));
  ok('B33: the admin API refusing → 502, the code is unused again, no mail, no log', r.status === 502 && r.body.error === 'unavailable' && codesTable().filter((x) => x.user_id === ALEX && !x.used_at).length === 10 && mails.length === 0 && events().length === 0);
  admin.refuseDelete = false;
  const r2 = await out(await R.handleBackupCodeUse(post({ email: 'alex@bloom.example', code: set.codes[3] }), cors));
  ok('B34: …and works once the API is back', r2.status === 200);
}
{
  // the limiter, and someone with no studio (platform brand)
  reset();
  const set = await seedSet(BEA, BEA_SITE);
  admin.users[BEA].factors = [{ id: 'f-bea', factor_type: 'totp', status: 'verified' }];
  rateSaysNo = true;
  let r = await out(await R.handleBackupCodeUse(post({ email: 'bea@bloom.example', code: set.codes[0] }), cors));
  ok('B35: the limiter\'s no → 429 before any lookup', r.status === 429 && admin.listCalls.length === 0);
  const hit = db.log.find((c) => c.url.includes('rpc/rate_hit_both'));
  ok('B36: the limit is by email AND by address (scrambled), 5 and 20 in 15 minutes', !!hit && hit.body.p_first === 'backup:email:bea@bloom.example' && hit.body.p_first_max === 5 && /^backup:ip:[0-9a-f]{16}$/.test(hit.body.p_second) && hit.body.p_second_max === 20 && R.USE_WINDOW_SEC === 900);
  rateSaysNo = false;
  r = await out(await R.handleBackupCodeUse(post({ email: 'bea@bloom.example', code: set.codes[0] }), cors));
  ok('B37: a person with no studio → the platform\'s own brand on the email', r.status === 200 && mails.length === 1 && mails[0].to === 'bea@bloom.example' && /Studio OS/.test(mails[0].html) && !/Bright Studio/.test(mails[0].from));
  ok('B38: a user the admin API doesn\'t know (deleted account) → the generic refusal', (await out(await R.handleBackupCodeUse(post({ email: 'ghost@bloom.example', code: set.codes[1] }), cors))).status === 403);
}

// ── POST /agency/clients/:site/two-step/off ──
const member = (role = 'owner') => ({ agency_id: AG, member_id: 'm1', email: 'eric@brightstudio.example', role, agency_name: 'Bright Studio', seat_limit: 5, client_limit: 50, plan: 'studio', branding: {} });
const agencyPost = (site, body, jwt = 'jwt-owner') => handleAgency(new Request(`http://stub.local/agency/clients/${site}/two-step/off`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-dds-user-jwt': jwt }, body: JSON.stringify(body || {}) }), `/agency/clients/${site}/two-step/off`, 'POST', member(), P_OWNER, cors);
let freshNow = Math.floor(Date.now() / 1000);
F.freshDeps.user = async (jwt) => (jwt === 'jwt-owner' ? { id: OWNER, email: 'eric@brightstudio.example', factors: [{ id: 'f-owner', factor_type: 'totp', status: 'verified' }] } : null);
let appCodeRecent = false;
F.freshDeps.claims = () => ({ aal: 'aal2', amr: appCodeRecent ? [{ method: 'totp', timestamp: freshNow }] : [{ method: 'password', timestamp: freshNow - 3600 }] });
F.freshDeps.now = () => freshNow * 1000;
{
  reset();
  await seedSet(ALEX, ALEX_SITE);
  let r = await out(await handleAgency(new Request('http://stub.local/x', { method: 'POST', headers: { 'x-dds-user-jwt': 'jwt-owner' } }), `/agency/clients/${ALEX_SITE}/two-step/off`, 'POST', member('admin'), P_OWNER, cors));
  ok('B39: an admin (not the owner) → 403, nothing read from the admin API', r.status === 403 && admin.deleted.length === 0);
  r = await out(await agencyPost('44444444-4444-4444-8444-444444444444', {}));
  ok('B40: a site that isn\'t the studio\'s client → 404', r.status === 404);
  r = await out(await agencyPost('not-a-site', {}));
  ok('B41: a non-id → 400', r.status === 400);
  db.tables.contacts = db.tables.contacts.filter((c) => c.id !== BEA_CONTACT);
  r = await out(await agencyPost(BEA_SITE, {}));
  ok('B42: a client with no sign-in → 409 no_login', r.status === 409 && r.body.error === 'no_login');
  db.reset(tables()); seedAdmin();
  r = await out(await agencyPost(BEA_SITE, {}));
  ok('B43: a client whose two-step is already off → 409 no_two_step', r.status === 409 && r.body.error === 'no_two_step');
  r = await out(await agencyPost(ALEX_SITE, {}));
  ok('B44: a client with two-step on, no fresh code yet → 403 fresh_code_needed for the owner\'s app, action two_step_off, naming the client', r.status === 403 && r.body.error === 'fresh_code_needed' && r.body.way === 'app' && r.body.action === 'two_step_off' && r.body.what === 'Bloom Salon' && /Confirm and turn it off/.test(r.body.go));
  ok('B45: …and nothing happened: the factor is there, no mail, no log, the set is whole', admin.users[ALEX].factors.length === 2 && mails.length === 0 && events().length === 0 && codesTable().filter((x) => x.user_id === ALEX).length === 0);
  await seedSet(ALEX, ALEX_SITE);
  appCodeRecent = true;
  r = await out(await agencyPost(ALEX_SITE, {}));
  ok('B46: with the app code typed a moment ago → 200 with what was done', r.status === 200 && r.body.data.site_id === ALEX_SITE && r.body.data.removed === 2 && r.body.data.all_removed === true && r.body.data.emailed === true && r.body.data.confirmed_with === 'app' && !/alex@bloom\.example/.test(r.body.data.email) && /@/.test(r.body.data.email));
  ok('B47: both of Alex\'s TOTP factors are gone, through the admin API', admin.users[ALEX].factors.length === 0 && admin.deleted.length === 2);
  ok('B48: Alex\'s backup codes went with the second step', codesTable().filter((x) => x.user_id === ALEX).length === 0);
  const m = mails[0];
  ok('B49: Alex is emailed under the studio\'s brand that Bright Studio turned it off', mails.length === 1 && m.to === 'alex@bloom.example' && m.subject === 'Bright Studio turned off your two-step sign-in' && /Bright Studio/.test(m.from) && /because you asked them to/.test(m.html) && !/unsubscribe/i.test(m.html));
  const ev = events()[0];
  ok('B50: the change log on the client\'s site names the owner as the actor and masks the email', events().length === 1 && ev.site_id === ALEX_SITE && /Turned off two-step sign-in for/.test(ev.summary) && !/alex@bloom\.example/.test(ev.summary) && ev.actor_user_id === OWNER);
  appCodeRecent = false;
}

// ═══ PART C — the migration, the apply pack, the wiring ═══
{
  const sql = read('supabase/migrations/0253_backup_codes.sql');
  ok('C1: migration 0253 creates presence_backup_codes with the agreed columns', /create table if not exists public\.presence_backup_codes \(/.test(sql) && ['id uuid primary key', 'user_id uuid not null', 'site_id uuid references public.presence_sites(id) on delete set null', 'code_hash text not null', 'salt text not null', 'used_at timestamptz', 'created_at timestamptz not null default now()'].every((c) => sql.includes(c)));
  ok('C2: an index on user_id, row security on, no policy, service role only', /create index if not exists presence_backup_codes_user_idx\s+on public\.presence_backup_codes \(user_id\)/.test(sql) && /enable row level security/.test(sql) && !/create policy/.test(sql));
  ok('C3: presence_fresh_codes.action accepts two_step_off (dropped and re-added, idempotent)', /drop constraint if exists presence_fresh_codes_action_check/.test(sql) && /'close_account', 'two_step_off'\)/.test(sql));
  ok('C4: the APPLY-0253 note at the top says what it creates and that it is safe before or after the deploy', /^-- =+\n--  APPLY-0253/.test(sql) && /BEFORE OR AFTER/.test(sql) && /either order is safe/.test(sql) && /IDEMPOTENT/.test(sql) && /rollback:/.test(sql));
  const pack = read('docs/presence/APPLY-0253-prod.sql');
  ok('C5: the apply pack in docs/ carries the same table and constraint, and a check query', /create table if not exists public\.presence_backup_codes/.test(pack) && /'two_step_off'\)/.test(pack) && /-- Verify/.test(pack) && /pg_get_constraintdef/.test(pack));
  const idx = read('supabase/functions/presence/index.ts');
  const gate = idx.indexOf("if (principal.kind !== 'client' && principal.kind !== 'staff') {");
  ok('C6: index.ts answers POST /auth/backup-codes/use BEFORE the sign-in gate, and GET/POST /auth/backup-codes after it', gate > 0 && idx.indexOf("route === '/auth/backup-codes/use' && method === 'POST'") < gate && idx.indexOf("route === '/auth/backup-codes' && (method === 'GET' || method === 'POST')") > gate);
  const ag = read('supabase/functions/presence/agency/routes.ts');
  ok('C7: the agency router dispatches POST /agency/clients/:site/two-step/off to handleTwoStepOff with the studio\'s own site', /\/two-step\\\/off\$\//.test(ag) && /handleTwoStepOff\(req, member, principal, decodeURIComponent\(m\[1\]\), own\?\.id \|\| null, cors\)/.test(ag));
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) Deno.exit(1);
