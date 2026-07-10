// ── P2-E W2 account-deletion request/cancel lifecycle (LIVE) ─────────────────
//   deno run --allow-net --allow-env tests/presence/deletion_e2e_test.mjs
// Proves the customer-facing deletion lifecycle end to end: request → recorded
// (cooling-off, cancelable) → idempotent re-request → cancel → account stays
// active. Uses a THROWAWAY customer so nothing real is touched. The destructive
// executor (runDeletionSweep) is covered by deletion_routes_test + runs under the
// owner's scheduler. Env: SALES_E2E_TARGET · SALES_E2E_ANON · STG_AUTH · BRIDGE_SR/REST
const TARGET = Deno.env.get('SALES_E2E_TARGET');
const ANON = Deno.env.get('SALES_E2E_ANON');
const AUTH = Deno.env.get('STG_AUTH');
const SR = Deno.env.get('BRIDGE_SR');
const REST = Deno.env.get('BRIDGE_REST');
if (!TARGET || !ANON || !AUTH || !SR || !REST) { console.log('need creds — SALES_E2E_TARGET/ANON + STG_AUTH + BRIDGE_SR/BRIDGE_REST (skipped)'); Deno.exit(0); }

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const sr = (extra = {}) => ({ apikey: SR, Authorization: 'Bearer ' + SR, 'Content-Type': 'application/json', ...extra });
const stamp = Date.now();
const email = `del-e2e-${stamp}@example.com`;
const pass = 'Valid1234pass';
let TOKEN = '', clientId = '';
async function api(path, method, body, tok = TOKEN) { const r = await fetch(TARGET + path, { method: method || 'GET', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ANON, 'x-dds-user-jwt': tok, 'x-dds-scope-site': '' }, body: body ? JSON.stringify(body) : undefined }); let b = {}; try { b = await r.json(); } catch { /* */ } return { status: r.status, ok: r.ok, body: b }; }

// throwaway customer (business_os_only trial → no hosting to tear down)
const signup = await api('/commerce/signup', 'POST', { email, password: pass, plan: 'business_os_only', business_name: 'Deletion Test Co' });
ok('setup: throwaway customer signed up', signup.ok || signup.status === 200, `${signup.status} ${JSON.stringify(signup.body).slice(0, 120)}`);
// sign in for a JWT
const tokRes = await (await fetch(`${AUTH}/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pass }) })).json().catch(() => ({}));
TOKEN = tokRes?.access_token || '';
ok('setup: signed in as the throwaway customer', !!TOKEN);
// resolve their client_id via SR (by email)
const cl = await (await fetch(`${REST}/clients?email=eq.${encodeURIComponent(email)}&select=id`, { headers: sr() })).json().catch(() => []);
clientId = cl?.[0]?.id || '';
ok('setup: resolved the throwaway client id', !!clientId);

// ── request deletion ──
const req1 = await api('/commerce/delete-request', 'POST', {});
ok('request: deletion recorded with a cooling-off window', req1.ok && req1.body?.data?.completes_within_days >= 1 && !!req1.body?.data?.scheduled_for);
const rows1 = await (await fetch(`${REST}/presence_account_deletions?client_id=eq.${clientId}&select=status,scheduled_for`, { headers: sr() })).json().catch(() => []);
ok('request: a pending deletion row exists, scheduled in the future', Array.isArray(rows1) && rows1.some((r) => r.status === 'pending') && new Date(rows1[0].scheduled_for) > new Date());

// ── idempotent re-request ──
const req2 = await api('/commerce/delete-request', 'POST', {});
const rows2 = await (await fetch(`${REST}/presence_account_deletions?client_id=eq.${clientId}&status=in.(pending,executing)&select=id`, { headers: sr() })).json().catch(() => []);
ok('request: a second request does NOT create a duplicate (one open per client)', req2.ok && Array.isArray(rows2) && rows2.length === 1);

// ── cancel during the window ──
const cancel = await api('/commerce/delete-cancel', 'POST', {});
ok('cancel: the pending deletion is canceled', cancel.ok && cancel.body?.data?.canceled === true);
const rows3 = await (await fetch(`${REST}/presence_account_deletions?client_id=eq.${clientId}&select=status`, { headers: sr() })).json().catch(() => []);
ok('cancel: the row is now canceled (no open deletion)', Array.isArray(rows3) && !rows3.some((r) => r.status === 'pending' || r.status === 'executing'));
const ent = await (await fetch(`${REST}/presence_entitlements?client_id=eq.${clientId}&product=eq.presence&select=status,deletion_requested_at`, { headers: sr() })).json().catch(() => []);
ok('cancel: the account is NOT deleted (entitlement still active, request cleared)', Array.isArray(ent) && ent[0]?.status !== 'deleted' && !ent[0]?.deletion_requested_at);

// cleanup: mark the throwaway for real deletion so it doesn't linger (best-effort)
await fetch(`${REST}/clients?id=eq.${clientId}`, { method: 'PATCH', headers: sr({ Prefer: 'return=minimal' }), body: JSON.stringify({ status: 'deleted', email: `deleted-${clientId}@deleted.invalid` }) }).catch(() => {});

const passed = results.filter((r) => r.p).length;
console.log(`\n════ P2-E W2 DELETION LIFECYCLE E2E: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
