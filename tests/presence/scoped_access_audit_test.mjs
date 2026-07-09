// ── Phase SC-2: Scoped-Access Audit Ledger — the audit row is provably safe ──
// SC-1 proved the drill-in cannot leak across tenants. SC-2 proves that when a
// drill-in IS recorded, the row is complete, correctly-labelled, and CANNOT
// carry a token, a secret, or a request body. The reason mapping and the row
// builder are pure, so every guarantee is a unit test.
//   deno run --allow-read --allow-env tests/presence/scoped_access_audit_test.mjs
import { auditReason, buildScopeAuditRow } from '../../supabase/functions/presence/lib/scope.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const AG = 'cccccccc-3333-4333-8333-cccccccccccc';

// The exact reason vocabulary the DB CHECK constraint enforces (0064). If the
// mapping ever emits something outside this set, the insert would be rejected.
const DB_REASONS = new Set(['', 'unauthorized', 'forbidden', 'missing_membership', 'removed_client', 'malformed_scope', 'archived_client', 'read_only_role']);

// ═══ 1. allowed access is recorded with an empty reason ═══
ok('allowed → reason maps to empty string', auditReason('ok') === '');
{
  const row = buildScopeAuditRow({ audit: { operatorUserId: 'u1', operatorEmail: 'op@agency.com', route: '/portal/context', method: 'GET' }, agencyId: AG, clientSiteId: A, clientName: 'Joe’s Plumbing', outcome: 'allowed', reason: '' });
  ok('allowed row: outcome allowed, reason empty, client captured', row.outcome === 'allowed' && row.reason === '' && row.client_site_id === A && row.client_name === 'Joe’s Plumbing');
}

// ═══ 2. every denial reason maps into the DB-allowed vocabulary ═══
ok('denial reasons map correctly',
  auditReason('bad_scope') === 'malformed_scope' &&
  auditReason('not_agency') === 'missing_membership' &&
  auditReason('role') === 'read_only_role' &&
  auditReason('unauthorized') === 'unauthorized' &&
  auditReason('deleted') === 'removed_client');
ok('an unknown internal reason degrades to a safe "forbidden"', auditReason('something_new') === 'forbidden');
ok('EVERY mapped reason is a value the DB CHECK accepts', ['ok','bad_scope','not_agency','role','unauthorized','deleted','???'].every((r) => DB_REASONS.has(auditReason(r))));
ok('archived_client is a valid audited reason (caller refines unauthorized→archived)', DB_REASONS.has('archived_client'));

// ═══ 3. THE CORE SAFETY PROPERTY — the row can only carry the audit fields ═══
// No token, no Authorization header, no JWT, no request body — by construction.
{
  const row = buildScopeAuditRow({ audit: { operatorUserId: 'u1', operatorEmail: 'op@agency.com', route: '/anything', method: 'POST', requestId: 'req-1', ip: '1.2.3.4', userAgent: 'x' }, agencyId: AG, clientSiteId: A, clientName: 'C', outcome: 'denied', reason: 'unauthorized' });
  const keys = Object.keys(row).sort();
  const allowed = ['agency_id','client_name','client_site_id','created_at','ip','method','operator_email','operator_user_id','outcome','reason','request_id','route','user_agent'].filter((k) => k !== 'created_at');
  const noForbidden = !keys.some((k) => /token|authorization|jwt|secret|body|password|cookie/i.test(k));
  ok('row contains ONLY the whitelisted audit fields', JSON.stringify(keys) === JSON.stringify(allowed.sort()), keys.join(','));
  ok('row has no token/secret/body/jwt/cookie field — ever', noForbidden);
}

// ═══ 4. a request body / secret handed in as extra input cannot reach the row ═══
{
  // even if a caller passed junk, buildScopeAuditRow reads only its known fields
  const dirty = { operatorUserId: 'u1', operatorEmail: 'op@a.com', route: '/x', method: 'GET', token: 'SECRET-JWT', body: { password: 'p' }, authorization: 'Bearer zzz' };
  const row = buildScopeAuditRow({ audit: dirty, agencyId: AG, clientSiteId: A, clientName: 'C', outcome: 'allowed', reason: '' });
  const serialized = JSON.stringify(row);
  ok('extraneous token/body/authorization never appear in the serialized row', !serialized.includes('SECRET-JWT') && !serialized.includes('password') && !serialized.includes('Bearer zzz'));
}

// ═══ 5. route is stored PATH-ONLY — a query string (which could carry ids) is dropped ═══
{
  const row = buildScopeAuditRow({ audit: { route: '/portal/context?client=' + A + '&token=abc', method: 'GET' }, agencyId: AG, clientSiteId: A, clientName: 'C', outcome: 'allowed', reason: '' });
  ok('route drops the query string (no token/leak in the path column)', row.route === '/portal/context' && !row.route.includes('token'));
}

// ═══ 6. IP is the first forwarded hop only; long fields are capped ═══
{
  const row = buildScopeAuditRow({ audit: { ip: '203.0.113.7, 10.0.0.1, 10.0.0.2', userAgent: 'UA'.repeat(400), route: 'r'.repeat(500), method: 'GETGETGETGET' }, agencyId: AG, clientSiteId: A, clientName: 'n'.repeat(500), outcome: 'allowed', reason: '' });
  ok('ip is the first hop only', row.ip === '203.0.113.7');
  ok('user_agent capped to 300', row.user_agent.length === 300);
  ok('route capped to 300', row.route.length <= 300);
  ok('method capped to 10', row.method.length === 10);
  ok('client_name capped to 200', row.client_name.length === 200);
}

// ═══ 7. missing operator identity degrades safely (null, not a crash) ═══
{
  const row = buildScopeAuditRow({ audit: {}, agencyId: null, clientSiteId: A, clientName: '', outcome: 'denied', reason: 'missing_membership' });
  ok('absent operator → null user id, empty email (no throw)', row.operator_user_id === null && row.operator_email === '' && row.agency_id === null);
}

// ═══ 8. outcome is exactly allowed|denied (matches the DB CHECK) ═══
{
  const a = buildScopeAuditRow({ audit: {}, agencyId: null, clientSiteId: A, clientName: '', outcome: 'allowed', reason: '' });
  const d = buildScopeAuditRow({ audit: {}, agencyId: null, clientSiteId: A, clientName: '', outcome: 'denied', reason: 'unauthorized' });
  ok('outcome is one of the two DB-allowed values', ['allowed', 'denied'].includes(a.outcome) && ['allowed', 'denied'].includes(d.outcome));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ SCOPED-ACCESS AUDIT: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
