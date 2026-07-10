// ── P2-C2 CLOSING-workflow tenant isolation (LIVE, two workspaces) ───────────
//   deno run --allow-net --allow-env tests/presence/sales_closing_isolation_e2e_test.mjs
// Proves — at RUNTIME — that one workspace cannot touch another's CLOSING records:
// no attaching/sending proposals or contracts, no converting another tenant's
// deal, and a signed link is bound to ONE record id (cannot be replayed against a
// different proposal/contract). Complements the P2-C1 foundation-isolation suite.
// Requires migration 0074 + TWO operator JWTs for DIFFERENT workspaces. Skips here.
// Env: SALES_E2E_TARGET · SALES_E2E_ANON
//      · SALES_E2E_JWT  / SALES_E2E_SITE   (tenant A)
//      · SALES_E2E_JWT2 / SALES_E2E_SITE2  (tenant B — a DIFFERENT workspace)
const TARGET = Deno.env.get('SALES_E2E_TARGET');
const ANON = Deno.env.get('SALES_E2E_ANON');
const JWTA = Deno.env.get('SALES_E2E_JWT');
const JWTB = Deno.env.get('SALES_E2E_JWT2');
if (!TARGET || !ANON || !JWTA || !JWTB) { console.log('need SB integration creds — set SALES_E2E_TARGET/ANON/JWT/JWT2 (two tenants) to run (skipped)'); Deno.exit(0); }

const SITEA = Deno.env.get('SALES_E2E_SITE') || '';
const SITEB = Deno.env.get('SALES_E2E_SITE2') || '';
const H = (jwt, site) => ({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ANON, 'x-dds-user-jwt': jwt, 'x-dds-scope-site': site });
const pubH = () => ({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ANON });
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const skip = (n) => console.log(`SKIP  ${n} — link secret not configured on target`);
async function call(jwt, site, path, method, body) {
  const r = await fetch(TARGET + path, { method: method || 'GET', headers: H(jwt, site), body: body ? JSON.stringify(body) : undefined });
  let b = {}; try { b = await r.json(); } catch { /* */ }
  return { status: r.status, ok: r.ok, body: b };
}
async function pub(path, method, body) {
  const r = await fetch(TARGET + path, { method: method || 'GET', headers: pubH(), body: body ? JSON.stringify(body) : undefined });
  let b = {}; try { b = await r.json(); } catch { /* */ }
  return { status: r.status, ok: r.ok, body: b };
}
const tokenOf = (url) => (typeof url === 'string' && url ? url.split('/').pop() : null);
const tag = 'clsiso-' + Date.now();

// Tenant A builds a full closing chain on its own deal.
const cA = await call(JWTA, SITEA, '/sales/contacts', 'POST', { name: 'A buyer', email: `${tag}@a.example` });
const dA = await call(JWTA, SITEA, '/sales/deals', 'POST', { title: `${tag} A-deal`, contact_id: cA.body?.data?.id });
const dealA = dA.body?.data?.id;
const pA = await call(JWTA, SITEA, `/sales/deals/${dealA}/proposals`, 'POST', { line_items: [{ label: 'x', qty: 1, unit_cents: 100000 }] });
const propA = pA.body?.data?.id;
const kA = await call(JWTA, SITEA, `/sales/deals/${dealA}/contracts`, 'POST', { body: 'A private agreement' });
const contractA = kA.body?.data?.id;
ok('setup: A built deal + proposal + contract', dA.ok && pA.status === 201 && kA.status === 201 && dealA && propA && contractA);

// Tenant B must NOT be able to touch any of A's closing records by id.
const bProp = await call(JWTB, SITEB, `/sales/deals/${dealA}/proposals`, 'POST', { line_items: [{ label: 'hijack', qty: 1, unit_cents: 1 }] });
ok('B cannot ATTACH a proposal to A’s deal (404)', bProp.status === 404);
const bCon = await call(JWTB, SITEB, `/sales/deals/${dealA}/contracts`, 'POST', { body: 'hijack' });
ok('B cannot ATTACH a contract to A’s deal (404)', bCon.status === 404);
const bSendP = await call(JWTB, SITEB, `/sales/proposals/${propA}/send`, 'POST', {});
ok('B cannot SEND A’s proposal (404)', bSendP.status === 404);
const bSendC = await call(JWTB, SITEB, `/sales/contracts/${contractA}/send`, 'POST', {});
ok('B cannot SEND A’s contract (404)', bSendC.status === 404);
const bConvert = await call(JWTB, SITEB, `/sales/deals/${dealA}/convert`, 'POST', { plan: 'business_os_only' });
ok('B cannot CONVERT A’s deal (404 — no cross-tenant customer creation)', bConvert.status === 404);

// Control: A can still operate on its own.
const aSelf = await call(JWTA, SITEA, `/sales/deals/${dealA}`);
ok('control: A can still read its own deal + sees its proposal/contract', aSelf.ok && aSelf.body?.data?.deal?.id === dealA && (aSelf.body?.data?.proposals || []).some((x) => x.id === propA));

// Signed-link binding: a token minted for A’s proposal cannot be replayed against a
// DIFFERENT record id (the token binds t+id+site_id). Only if a link secret exists.
const sendA = await call(JWTA, SITEA, `/sales/proposals/${propA}/send`, 'POST', {});
const tokA = tokenOf(sendA.body?.url);
if (!tokA) {
  skip('token: A’s proposal link is bound to that one proposal id (no replay)');
  skip('token: A’s proposal link cannot decide a foreign proposal id');
} else {
  // reuse A's token but point the path at a different (random) proposal id → invalid_link
  const foreignId = '00000000-0000-4000-8000-000000000000';
  const replay = await pub(`/sales/proposals/${foreignId}/decide`, 'POST', { decision: 'accepted', token: tokA });
  ok('token: A’s proposal link cannot decide a foreign proposal id (403 invalid_link)', replay.status === 403 && replay.body?.error === 'invalid_link');
  // and B minting its own token cannot act on A’s proposal
  const dB = await call(JWTB, SITEB, '/sales/deals', 'POST', { title: `${tag} B-deal` });
  const pB = await call(JWTB, SITEB, `/sales/deals/${dB.body?.data?.id}/proposals`, 'POST', { line_items: [{ label: 'y', qty: 1, unit_cents: 1 }] });
  const sendB = await call(JWTB, SITEB, `/sales/proposals/${pB.body?.data?.id}/send`, 'POST', {});
  const tokB = tokenOf(sendB.body?.url);
  const cross = await pub(`/sales/proposals/${propA}/decide`, 'POST', { decision: 'accepted', token: tokB });
  ok('token: B’s link cannot decide A’s proposal (403 invalid_link)', cross.status === 403 && cross.body?.error === 'invalid_link');
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ P2-C2 CLOSING TENANT ISOLATION (live): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
