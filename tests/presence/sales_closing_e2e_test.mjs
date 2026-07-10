// ── P2-C2 CLOSING workflow end-to-end (Proposal · Contract · Convert · Onboard) ─
//   deno run --allow-net --allow-env tests/presence/sales_closing_e2e_test.mjs
// The runtime proof for the CLOSING half of the sales lifecycle — the part P2-C1
// deliberately did NOT cover. Exercises, on live staging:
//   proposal create → send(link) → public accept(token) → contract create →
//   send(link+hash) → version-integrity → public sign(token) → convert →
//   provision(reused, idempotent) → onboarding handoff.
// Plus idempotency (double-send/decide/sign/convert) and the not-ready gate.
// Requires migration 0074 applied + an operator JWT for a relationship (Business
// OS) workspace. The public token steps also require a link secret configured on
// the target (APPROVAL_SECRET / STATE_SIGNING_SECRET / SCHEDULER_SECRET); when it
// is absent those steps are reported as skipped (never as passed). Skips here.
// Env: SALES_E2E_TARGET (…/functions/v1/presence) · SALES_E2E_ANON · SALES_E2E_JWT
//      · SALES_E2E_SITE (x-dds-scope-site, blank for a solo owner)
const TARGET = Deno.env.get('SALES_E2E_TARGET');
const ANON = Deno.env.get('SALES_E2E_ANON');
const JWT = Deno.env.get('SALES_E2E_JWT');
if (!TARGET || !ANON || !JWT) { console.log('need SB integration creds — set SALES_E2E_TARGET/ANON/JWT to run (skipped)'); Deno.exit(0); }

const SITE = Deno.env.get('SALES_E2E_SITE') || '';
const authH = () => ({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ANON, 'x-dds-user-jwt': JWT, 'x-dds-scope-site': SITE });
const pubH = () => ({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ANON });
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const skip = (n) => { console.log(`SKIP  ${n} — link secret not configured on target`); };
async function A(path, method, body) { // authed call
  const r = await fetch(TARGET + path, { method: method || 'GET', headers: authH(), body: body ? JSON.stringify(body) : undefined });
  let b = {}; try { b = await r.json(); } catch { /* */ }
  return { status: r.status, ok: r.ok, body: b };
}
async function P(path, method, body) { // public (token) call — no session
  const r = await fetch(TARGET + path, { method: method || 'GET', headers: pubH(), body: body ? JSON.stringify(body) : undefined });
  let b = {}; try { b = await r.json(); } catch { /* */ }
  return { status: r.status, ok: r.ok, body: b };
}
const tokenOf = (url) => (typeof url === 'string' && url ? url.split('/').pop() : null);
const tag = 'close-' + Date.now();

// ═══ PART A — authed closing path (no link secret needed): reach contract via the
//     bounded ladder, then convert → provision → onboarding. Always runs. ═══
const c1 = await A('/sales/contacts', 'POST', { name: 'Closing Buyer', email: `${tag}-a@example.com`, company: `${tag} Co` });
const contactId = c1.body?.data?.id;
const d1 = await A('/sales/deals', 'POST', { title: `${tag} A-deal`, contact_id: contactId, expected_value_cents: 500000 });
const deal1 = d1.body?.data?.id;
ok('setup: contact + deal created', c1.ok && d1.ok && deal1);

const prop1 = await A(`/sales/deals/${deal1}/proposals`, 'POST', { title: 'Website + care plan', line_items: [{ label: 'Build', qty: 1, unit_cents: 400000 }, { label: 'Care', qty: 2, unit_cents: 50000 }] });
ok('proposal: created with computed subtotal (400000 + 2×50000 = 500000)', prop1.status === 201 && prop1.body?.data?.subtotal_cents === 500000);
const badProp = await A(`/sales/deals/${deal1}/proposals`, 'POST', { line_items: [{ label: '', qty: 1, unit_cents: 1 }] });
ok('proposal: rejects a line item with no label (422, not 502)', badProp.status === 422);

// advance to contract via authed stage moves (lead→qualified→proposal→contract)
await A(`/sales/deals/${deal1}/stage`, 'POST', { to: 'qualified' });
await A(`/sales/deals/${deal1}/stage`, 'POST', { to: 'proposal' });
const toContract = await A(`/sales/deals/${deal1}/stage`, 'POST', { to: 'contract' });
ok('stage: reached contract via the bounded ladder', toContract.ok && toContract.body?.data?.stage === 'contract');

const con1 = await A(`/sales/deals/${deal1}/contracts`, 'POST', { title: 'Service agreement', body: 'Full scope of work and terms.', terms_snapshot: { total_cents: 500000 } });
ok('contract: created with a content_hash (version integrity anchor)', con1.status === 201 && /^[0-9a-f]{64}$/.test(con1.body?.data?.content_hash || ''));

// convert → provision (business_os_only avoids the hosting dependency) → onboarding
const conv1 = await A(`/sales/deals/${deal1}/convert`, 'POST', { plan: 'business_os_only' });
ok('convert: contract-stage deal converts → customer + workspace', conv1.ok && conv1.body?.data?.converted === true && !!conv1.body?.data?.client_id, JSON.stringify(conv1.body));
const clientId1 = conv1.body?.data?.client_id;
ok('convert: hands off to the EXISTING guided onboarding (/get-started.html)', conv1.body?.data?.onboarding === '/get-started.html');
ok('convert: a brand-new customer is invited to set a login', conv1.body?.data?.invited === true);
const conv1b = await A(`/sales/deals/${deal1}/convert`, 'POST', { plan: 'business_os_only' });
ok('convert: idempotent — re-convert returns the SAME customer, no duplicate', conv1b.ok && conv1b.body?.data?.client_id === clientId1 && conv1b.body?.data?.idempotent === true);
const dealWon = await A(`/sales/deals/${deal1}`);
ok('convert: the deal is now won + carries converted_client_id', dealWon.body?.data?.deal?.stage === 'won' && dealWon.body?.data?.deal?.converted_client_id === clientId1);

// not-ready gate: a fresh lead cannot convert
const d2 = await A('/sales/deals', 'POST', { title: `${tag} not-ready`, expected_value_cents: 1000 });
const conv2 = await A(`/sales/deals/${d2.body?.data?.id}/convert`, 'POST', { plan: 'business_os_only' });
ok('convert: a fresh lead is refused (409 not_ready — sign/accept first)', conv2.status === 409 && conv2.body?.error === 'not_ready');

// ═══ PART B — public token path (link, accept, sign, version integrity). Runs only
//     when a link secret is configured; otherwise honestly reported as skipped. ═══
const c3 = await A('/sales/contacts', 'POST', { name: 'Token Buyer', email: `${tag}-b@example.com` });
const d3 = await A('/sales/deals', 'POST', { title: `${tag} token-deal`, contact_id: c3.body?.data?.id });
const deal3 = d3.body?.data?.id;
const prop3 = await A(`/sales/deals/${deal3}/proposals`, 'POST', { title: 'Quote', line_items: [{ label: 'Package', qty: 1, unit_cents: 250000 }] });
const prop3Id = prop3.body?.data?.id;
const send3 = await A(`/sales/proposals/${prop3Id}/send`, 'POST', {});
const propToken = tokenOf(send3.body?.url);
const secretPresent = !!propToken;

if (!secretPresent) {
  for (const n of ['public: proposal share link minted', 'public: re-send is idempotent (already_sent)', 'public: prospect can VIEW the proposal by token', 'public: prospect ACCEPTS via token → deal advances to contract', 'public: re-accept is idempotent', 'public: contract share link + hash minted', 'integrity: signing a STALE/edited version is refused (version_mismatch)', 'public: prospect SIGNS with the matching hash → signed', 'public: re-sign is idempotent', 'history: closing events recorded (sent/decided/signed)']) skip(n);
  ok('proposal: send transitions to sent even without a link secret (status only)', send3.ok && send3.body?.data?.status === 'sent');
} else {
  ok('public: proposal share link minted', send3.ok && send3.body?.data?.status === 'sent' && !!propToken);
  const resend3 = await A(`/sales/proposals/${prop3Id}/send`, 'POST', {});
  ok('public: re-send is idempotent (already_sent)', resend3.ok && resend3.body?.already_sent === true);
  const view3 = await P(`/sales/p/${propToken}`);
  ok('public: prospect can VIEW the proposal by token', view3.ok && view3.body?.data?.kind === 'proposal' && view3.body?.data?.subtotal_cents === 250000);
  const accept3 = await P(`/sales/proposals/${prop3Id}/decide`, 'POST', { decision: 'accepted', token: propToken });
  ok('public: prospect ACCEPTS via token → deal advances to contract', accept3.ok && accept3.body?.data?.status === 'accepted');
  const reaccept3 = await P(`/sales/proposals/${prop3Id}/decide`, 'POST', { decision: 'accepted', token: propToken });
  ok('public: re-accept is idempotent', reaccept3.ok && reaccept3.body?.already === true);

  const con3 = await A(`/sales/deals/${deal3}/contracts`, 'POST', { title: 'Agreement', body: 'The agreed terms of engagement.', proposal_id: prop3Id });
  const con3Id = con3.body?.data?.id;
  const sendC3 = await A(`/sales/contracts/${con3Id}/send`, 'POST', {});
  const conToken = tokenOf(sendC3.body?.url);
  const conHash = sendC3.body?.content_hash;
  ok('public: contract share link + hash minted', sendC3.ok && !!conToken && /^[0-9a-f]{64}$/.test(conHash || ''));
  const badSign = await P(`/sales/contracts/${con3Id}/sign`, 'POST', { token: conToken, presented_hash: 'f'.repeat(64), signer_name: 'Mallory' });
  ok('integrity: signing a STALE/edited version is refused (version_mismatch)', badSign.status === 409 && badSign.body?.error === 'version_mismatch');
  const sign3 = await P(`/sales/contracts/${con3Id}/sign`, 'POST', { token: conToken, presented_hash: conHash, signer_name: 'Dana Prospect', signer_email: `${tag}-b@example.com` });
  ok('public: prospect SIGNS with the matching hash → signed', sign3.ok && sign3.body?.data?.status === 'signed');
  const resign3 = await P(`/sales/contracts/${con3Id}/sign`, 'POST', { token: conToken, presented_hash: conHash, signer_name: 'Dana Prospect' });
  ok('public: re-sign is idempotent', resign3.ok && resign3.body?.already === true);

  const detail3 = await A(`/sales/deals/${deal3}`);
  const kinds = new Set((detail3.body?.data?.events || []).map((e) => e.kind));
  ok('history: closing events recorded (sent/decided/signed)', kinds.has('proposal_sent') && kinds.has('proposal_decided') && kinds.has('contract_signed'));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ P2-C2 CLOSING E2E: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'}${secretPresent ? '' : ' (public-token steps skipped — no link secret)'} ════`);
if (passed !== results.length) Deno.exit(1);
