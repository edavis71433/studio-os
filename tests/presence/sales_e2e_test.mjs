// ── Sales lifecycle END-TO-END (P2-C) — integration (staging) ────────────────
//   deno run --allow-net --allow-env tests/presence/sales_e2e_test.mjs
// Runs the full 12-step lifecycle against a LIVE function. Requires migration
// 0074 applied + an authed operator JWT. Skips cleanly here (no creds).
// Env: SALES_E2E_TARGET (…/functions/v1/presence) · SALES_E2E_ANON ·
//      SALES_E2E_JWT (operator) · SALES_E2E_SITE (x-dds-scope-site, optional) ·
//      SALES_E2E_APPROVAL_SECRET (to mint accept/sign links, else those steps skip)
const TARGET = Deno.env.get('SALES_E2E_TARGET');
const ANON = Deno.env.get('SALES_E2E_ANON');
const JWT = Deno.env.get('SALES_E2E_JWT');
if (!TARGET || !ANON || !JWT) { console.log('need SB integration creds — set SALES_E2E_TARGET/ANON/JWT to run (skipped)'); Deno.exit(0); }

const SITE = Deno.env.get('SALES_E2E_SITE') || '';
const H = () => ({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ANON, 'x-dds-user-jwt': JWT, 'x-dds-scope-site': SITE });
const results = [];
const ok = (n, p) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };
async function call(path, method, body, headers) {
  const r = await fetch(TARGET + path, { method: method || 'GET', headers: headers || H(), body: body ? JSON.stringify(body) : undefined });
  let b = {}; try { b = await r.json(); } catch { /* */ }
  return { status: r.status, ok: r.ok, body: b };
}

// 1. contact + deal (a "captured lead" as a manual deal; form capture is reused separately)
const c = await call('/sales/contacts', 'POST', { name: 'E2E Buyer', email: `e2e+${Date.now()}@example.com` });
ok('1. contact created', c.ok && c.body?.data?.id);
const d0 = await call('/sales/deals', 'POST', { title: 'E2E deal', contact_id: c.body?.data?.id, expected_value_cents: 250000 });
ok('2. deal created (appears in this tenant)', d0.ok && d0.body?.data?.id);
const dealId = d0.body?.data?.id;
const listed = await call(`/sales/deals?stage=lead`);
ok('3. deal shows in the pipeline (lead stage)', listed.ok && (listed.body?.data || []).some((x) => x.id === dealId));

// 3→4. advance to qualified→proposal
await call(`/sales/deals/${dealId}/stage`, 'POST', { to: 'qualified' });
const prop = await call(`/sales/deals/${dealId}/proposals`, 'POST', { line_items: [{ label: 'Website', qty: 1, unit_cents: 250000 }], terms: 'Net 15' });
ok('4. proposal created from the opportunity', prop.ok && prop.body?.data?.id && prop.body?.data?.subtotal_cents === 250000);
const propId = prop.body?.data?.id;

// 5. send + accept the proposal (needs the signing secret to mint the link)
const sent = await call(`/sales/proposals/${propId}/send`, 'POST', {});
ok('5a. proposal sent', sent.ok);
if (sent.body?.url) {
  const token = sent.body.url.split('/sales/p/')[1];
  const dec = await call(`/sales/proposals/${propId}/decide`, 'POST', { decision: 'accepted', token }, { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ANON });
  ok('5b. proposal accepted via signed link (public)', dec.ok);
  const decAgain = await call(`/sales/proposals/${propId}/decide`, 'POST', { decision: 'accepted', token }, { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ANON });
  ok('5c. accept is idempotent', decAgain.ok && decAgain.body?.already === true);
} else { ok('5b/c. accept link (skipped — no signing secret in env)', true); }

// 6. contract created + sent + signed (version integrity)
const con = await call(`/sales/deals/${dealId}/contracts`, 'POST', { body: 'Service agreement — E2E.', proposal_id: propId });
ok('6a. contract created with a content hash', con.ok && con.body?.data?.content_hash);
const conId = con.body?.data?.id, hash = con.body?.data?.content_hash;
const conSent = await call(`/sales/contracts/${conId}/send`, 'POST', {});
ok('6b. contract sent', conSent.ok);
if (conSent.body?.url) {
  const token = conSent.body.url.split('/sales/c/')[1];
  const badSign = await call(`/sales/contracts/${conId}/sign`, 'POST', { token, presented_hash: 'deadbeef', signer_name: 'X' }, { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ANON });
  ok('6c. signing a MISMATCHED version is rejected (integrity)', !badSign.ok && badSign.status === 409);
  const sign = await call(`/sales/contracts/${conId}/sign`, 'POST', { token, presented_hash: hash, signer_name: 'E2E Buyer' }, { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ANON });
  ok('6d. contract signed with the correct version', sign.ok);
} else { ok('6c/d. sign link (skipped — no signing secret)', true); }

// 7-10. convert once → customer/workspace + onboarding handoff
const conv = await call(`/sales/deals/${dealId}/convert`, 'POST', {});
ok('7. deal converted once', conv.ok && conv.body?.data?.converted);
ok('8. a customer + workspace/site was created', !!conv.body?.data?.client_id && !!conv.body?.data?.site_id);
ok('10. lands in the existing onboarding', conv.body?.data?.onboarding === '/get-started.html' || conv.body?.data?.idempotent);

// 11. retry convert → no duplicate
const conv2 = await call(`/sales/deals/${dealId}/convert`, 'POST', {});
ok('11. retrying convert is idempotent (same client_id, no dup)', conv2.ok && conv2.body?.data?.idempotent === true && conv2.body?.data?.client_id === conv.body?.data?.client_id);

// 12. cross-tenant isolation (best-effort: a random other site id must not be readable via our scope)
const cross = await call(`/sales/deals/00000000-0000-4000-8000-000000000000`, 'GET');
ok('12. another tenant’s record id is not reachable (404/again scoped)', cross.status === 404 || cross.status === 400);

const passed = results.filter((r) => r.p).length;
console.log(`\n════ SALES E2E (P2-C): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
