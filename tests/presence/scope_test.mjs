// ── Phase SC-1: Secure Client Scope — the tenant-authorization decision ──────
// Every attack scenario from the security review is a case here. The pure
// scopeDecision encodes the ENTIRE authorization; if this is airtight, the
// drill-in cannot leak across tenants.
//   deno run --allow-read --allow-env tests/presence/scope_test.mjs
import { scopeDecision, isScopeId } from '../../supabase/functions/presence/lib/scope.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';   // an authorized client
const B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';   // ANOTHER tenant (never authorized)
const base = { requestedSiteId: A, isAgencyMember: true, roleCanManage: true, authorizedSiteIds: [A], siteExists: true };
const d = (over = {}) => scopeDecision({ ...base, ...over });

// ═══ 1. the ONLY happy path ═══
ok('authorized manager + own client + exists → allow', d().ok === true && d().status === 200);

// ═══ 2. cross-tenant / forged id — the leak that must never happen ═══
ok('another tenant\'s site (not in authorized set) → 403, never allowed', d({ requestedSiteId: B }).ok === false && d({ requestedSiteId: B }).status === 403 && d({ requestedSiteId: B }).reason === 'unauthorized');
ok('authorized set empty → every request denied', d({ authorizedSiteIds: [] }).ok === false && d({ authorizedSiteIds: [] }).status === 403);
ok('forged / malformed scope id → 400, never resolves', d({ requestedSiteId: 'not-a-uuid' }).ok === false && d({ requestedSiteId: '' }).ok === false && d({ requestedSiteId: "A' OR '1'='1" }).ok === false);
ok('a valid-looking id that isn\'t authorized is still denied', d({ requestedSiteId: B, authorizedSiteIds: [A] }).status === 403);

// ═══ 3. non-agency caller must NEVER scope (business owner forging a header) ═══
ok('non-agency caller → 403 not_agency (cannot scope to anyone)', d({ isAgencyMember: false }).ok === false && d({ isAgencyMember: false }).reason === 'not_agency');
ok('non-agency caller can\'t escape by also naming their own authorized-looking id', d({ isAgencyMember: false, authorizedSiteIds: [A] }).ok === false);

// ═══ 4. role gate — read-only agency roles get no drill-in (least privilege) ═══
ok('agency member without manage capability → 403 role', d({ roleCanManage: false }).ok === false && d({ roleCanManage: false }).reason === 'role');

// ═══ 5. deleted / suspended client ═══
ok('deleted client (no row) → 404', d({ siteExists: false }).ok === false && d({ siteExists: false }).status === 404 && d({ siteExists: false }).reason === 'deleted');
ok('removed/archived client (dropped from authorized set) → 403', d({ authorizedSiteIds: [B] }).ok === false && d({ authorizedSiteIds: [B] }).status === 403);

// ═══ 6. permission-removal / stale scope: authorization is recomputed each call ═══
ok('once no longer authorized, the SAME id that worked before is denied', d().ok === true && d({ authorizedSiteIds: [] }).ok === false);

// ═══ 7. deny takes precedence — ANY failing check denies, never a partial allow ═══
ok('multiple failures still deny (never a partial allow)', d({ isAgencyMember: false, roleCanManage: false, authorizedSiteIds: [], siteExists: false }).ok === false);
ok('order: bad id is caught before any membership assumption', d({ requestedSiteId: 'x', isAgencyMember: true }).reason === 'bad_scope');

// ═══ 8. isScopeId — only a real UUID passes ═══
ok('isScopeId accepts a UUID, rejects junk/empty/injection', isScopeId(A) && !isScopeId('') && !isScopeId('123') && !isScopeId(null) && !isScopeId(A + "' --") && !isScopeId(A.toUpperCase() + 'x'));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ SECURE CLIENT SCOPE: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
