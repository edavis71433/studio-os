// ── P2-C1 tenant-isolation (LIVE, two workspaces) ────────────────────────────
//   deno run --allow-net --allow-env tests/presence/sales_tenant_isolation_e2e_test.mjs
// Proves one workspace cannot read or write another's sales records at RUNTIME
// (not just structurally). Requires migration 0074 + TWO operator JWTs. Skips here.
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
const results = [];
const ok = (n, p) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };
async function call(jwt, site, path, method, body) {
  const r = await fetch(TARGET + path, { method: method || 'GET', headers: H(jwt, site), body: body ? JSON.stringify(body) : undefined });
  let b = {}; try { b = await r.json(); } catch { /* */ }
  return { status: r.status, ok: r.ok, body: b };
}
const tag = 'iso-' + Date.now();

// Tenant A creates a contact + deal.
const c = await call(JWTA, SITEA, '/sales/contacts', 'POST', { name: 'A-only', email: `${tag}@a.example` });
const contactId = c.body?.data?.id;
const d = await call(JWTA, SITEA, '/sales/deals', 'POST', { title: `${tag} A-deal`, contact_id: contactId });
const dealId = d.body?.data?.id;
ok('tenant A created its own contact + deal', c.ok && d.ok && dealId);

// Tenant B must NOT be able to reach A's records by id.
const bReadsDeal = await call(JWTB, SITEB, `/sales/deals/${dealId}`);
ok('B cannot READ A’s deal by id (404)', bReadsDeal.status === 404);
const bPatches = await call(JWTB, SITEB, `/sales/deals/${dealId}`, 'PATCH', { title: 'hijack' });
ok('B cannot UPDATE A’s deal (404, no write)', bPatches.status === 404);
const bMovesStage = await call(JWTB, SITEB, `/sales/deals/${dealId}/stage`, 'POST', { to: 'qualified' });
ok('B cannot MOVE A’s deal stage (404)', bMovesStage.status === 404);
const bAddsProposal = await call(JWTB, SITEB, `/sales/deals/${dealId}/proposals`, 'POST', { line_items: [{ label: 'x', qty: 1, unit_cents: 1 }] });
ok('B cannot attach to A’s deal (404)', bAddsProposal.status === 404);

// B's list must not include A's deal.
const bList = await call(JWTB, SITEB, `/sales/deals?q=${tag}`);
ok('B’s pipeline list does NOT contain A’s deal', bList.ok && !(bList.body?.data || []).some((x) => x.id === dealId));
const bContacts = await call(JWTB, SITEB, `/sales/contacts?q=${tag}`);
ok('B’s contacts do NOT contain A’s contact', bContacts.ok && !(bContacts.body?.data || []).some((x) => x.id === contactId));

// A can still see its own (control).
const aReads = await call(JWTA, SITEA, `/sales/deals/${dealId}`);
ok('control: A can still read its own deal', aReads.ok && aReads.body?.data?.deal?.id === dealId);

const passed = results.filter((r) => r.p).length;
console.log(`\n════ P2-C1 TENANT ISOLATION (live): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
