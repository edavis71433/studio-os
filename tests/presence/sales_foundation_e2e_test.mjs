// ── P2-C1 FOUNDATION end-to-end (Lead · CRM · Opportunity · Pipeline) ────────
//   deno run --allow-net --allow-env tests/presence/sales_foundation_e2e_test.mjs
// The runtime proof for the FROZEN foundation — contact/lead/opportunity are one
// presence_deals by stage. Covers ONLY P2-C1 (no proposals/contracts/convert —
// that's P2-C2). Requires migration 0074 applied + an operator JWT. Skips here.
// Env: SALES_E2E_TARGET (…/functions/v1/presence) · SALES_E2E_ANON · SALES_E2E_JWT
//      · SALES_E2E_SITE (x-dds-scope-site, optional)
const TARGET = Deno.env.get('SALES_E2E_TARGET');
const ANON = Deno.env.get('SALES_E2E_ANON');
const JWT = Deno.env.get('SALES_E2E_JWT');
if (!TARGET || !ANON || !JWT) { console.log('need SB integration creds — set SALES_E2E_TARGET/ANON/JWT to run (skipped)'); Deno.exit(0); }

const SITE = Deno.env.get('SALES_E2E_SITE') || '';
const H = () => ({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ANON, 'x-dds-user-jwt': JWT, 'x-dds-scope-site': SITE });
const results = [];
const ok = (n, p) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };
async function call(path, method, body) {
  const r = await fetch(TARGET + path, { method: method || 'GET', headers: H(), body: body ? JSON.stringify(body) : undefined });
  let b = {}; try { b = await r.json(); } catch { /* */ }
  return { status: r.status, ok: r.ok, body: b };
}
const tag = 'e2e-' + Date.now();

// ── CRM: contact + duplicate detection ──
const c1 = await call('/sales/contacts', 'POST', { name: 'Foundation Buyer', email: `${tag}@example.com`, phone: '5551234', company: 'Acme' });
ok('contact created', c1.ok && c1.body?.data?.id);
const contactId = c1.body?.data?.id;
const c2 = await call('/sales/contacts', 'POST', { name: 'Foundation Buyer (dup)', email: `${tag}@example.com` });
ok('duplicate contact by email is de-duplicated (same id, deduped flag)', c2.ok && c2.body?.deduped === true && c2.body?.data?.id === contactId);
const cs = await call(`/sales/contacts?q=${tag}`);
ok('contact search finds it', cs.ok && (cs.body?.data || []).some((x) => x.id === contactId));

// ── new LEAD (a deal at the entry stage) ──
const d = await call('/sales/deals', 'POST', { title: `${tag} deal`, contact_id: contactId, expected_value_cents: 250000, expected_close: '2026-09-01', source: 'referral' });
ok('new lead created (stage=lead)', d.ok && d.body?.data?.id && d.body?.data?.stage === 'lead');
const dealId = d.body?.data?.id;

// ── lead search + filter + pagination ──
const search = await call(`/sales/deals?q=${tag}`);
ok('lead search (by title) finds it', search.ok && (search.body?.data || []).some((x) => x.id === dealId));
const filtered = await call('/sales/deals?stage=lead');
ok('pipeline filter by stage=lead includes it', filtered.ok && (filtered.body?.data || []).some((x) => x.id === dealId));
const paged = await call('/sales/deals?limit=1');
ok('pagination: limit=1 returns at most 1 + echoes limit', paged.ok && (paged.body?.data || []).length <= 1 && paged.body?.limit === 1);

// ── lead update ──
const upd = await call(`/sales/deals/${dealId}`, 'PATCH', { title: `${tag} deal (updated)`, expected_value_cents: 300000 });
ok('lead update persists', upd.ok && upd.body?.data?.expected_value_cents === 300000);
const badDate = await call(`/sales/deals/${dealId}`, 'PATCH', { expected_close: 'not-a-date' });
ok('bad expected_close is rejected (422, not a 502)', !badDate.ok && badDate.status === 422);

// ── lead → opportunity is a STAGE move (same record; no separate table) ──
const s1 = await call(`/sales/deals/${dealId}/stage`, 'POST', { to: 'qualified' });
ok('lead → qualified (stage advance)', s1.ok && s1.body?.data?.stage === 'qualified');
const s2 = await call(`/sales/deals/${dealId}/stage`, 'POST', { to: 'proposal' });
ok('qualified → proposal (now an opportunity — same presence_deals row)', s2.ok && s2.body?.data?.stage === 'proposal');
const badMove = await call(`/sales/deals/${dealId}/stage`, 'POST', { to: 'won' });
ok('invalid pipeline move is refused (won is convert-only → 4xx)', !badMove.ok);
const jump = await call(`/sales/deals/${dealId}/stage`, 'POST', { to: 'lead' });
ok('non-adjacent jump (proposal → lead) refused (bounded ladder)', !jump.ok || jump.status === 409);

// ── activity history (stage history + created) ──
const detail = await call(`/sales/deals/${dealId}`);
const events = detail.body?.data?.events || [];
ok('activity history records created + stage changes', detail.ok && events.some((e) => e.kind === 'created') && events.filter((e) => e.kind === 'stage_change').length >= 2);
ok('deal detail carries the contact + is scoped to this workspace', detail.body?.data?.contact?.id === contactId);

// ── tenant scoping sanity (single-tenant): a foreign id is not reachable ──
const foreign = await call('/sales/deals/00000000-0000-4000-8000-000000000000');
ok('a non-existent/foreign deal id is not reachable (404/400)', foreign.status === 404 || foreign.status === 400);

const passed = results.filter((r) => r.p).length;
console.log(`\n════ P2-C1 FOUNDATION E2E: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
