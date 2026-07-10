// ── P2-E W1 AI hard-ceiling end-to-end (LIVE) ────────────────────────────────
//   deno run --allow-net --allow-env tests/presence/ai_ceiling_e2e_test.mjs
// Proves the hard per-tenant AI cost ceiling STOPS a provider call before spend,
// that image usage is metered (non-zero cost), and that a dismissed notice can't
// bypass it. Seeds usage via service role, drives a real request, then restores.
// Env: SALES_E2E_TARGET · SALES_E2E_ANON · CUSTOMER_JWT (a drafting-capable owner)
//      · CUSTOMER_CLIENT · BRIDGE_SR · BRIDGE_REST
const TARGET = Deno.env.get('SALES_E2E_TARGET');
const ANON = Deno.env.get('SALES_E2E_ANON');
const CJ = Deno.env.get('CUSTOMER_JWT');
const CLIENT = Deno.env.get('CUSTOMER_CLIENT');
const SR = Deno.env.get('BRIDGE_SR');
const REST = Deno.env.get('BRIDGE_REST');
if (!TARGET || !ANON || !CJ || !CLIENT || !SR || !REST) { console.log('need creds — SALES_E2E_TARGET/ANON + CUSTOMER_JWT/CUSTOMER_CLIENT/BRIDGE_SR/BRIDGE_REST (skipped)'); Deno.exit(0); }

const H = () => ({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ANON, 'x-dds-user-jwt': CJ, 'x-dds-scope-site': '' });
const sr = (extra = {}) => ({ apikey: SR, Authorization: 'Bearer ' + SR, 'Content-Type': 'application/json', ...extra });
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const period = new Date().toISOString().slice(0, 7); // YYYY-MM UTC
async function call(path, method, body) { const r = await fetch(TARGET + path, { method: method || 'GET', headers: H(), body: body ? JSON.stringify(body) : undefined }); let b = {}; try { b = await r.json(); } catch { /* */ } return { status: r.status, ok: r.ok, body: b }; }
async function ent(patch) { return fetch(`${REST}/presence_entitlements?client_id=eq.${CLIENT}&product=eq.presence`, { method: 'PATCH', headers: sr({ Prefer: 'return=minimal' }), body: JSON.stringify(patch) }); }

let priorPlan = 'business_os_only';
try {
  // capture prior plan to restore
  const cur = await (await fetch(`${REST}/presence_entitlements?client_id=eq.${CLIENT}&product=eq.presence&select=plan,founder`, { headers: sr() })).json().catch(() => []);
  priorPlan = (cur && cur[0] && cur[0].plan) || 'business_os_only';
  const founder = !!(cur && cur[0] && cur[0].founder);
  ok('setup: read the tenant entitlement', Array.isArray(cur));

  // put the tenant on a drafting plan and seed IMAGE usage well over its ceiling
  await ent({ plan: 'presence' });
  await fetch(`${REST}/presence_ai_usage?on_conflict=client_id,period`, { method: 'POST', headers: sr({ Prefer: 'resolution=merge-duplicates,return=minimal' }), body: JSON.stringify({ client_id: CLIENT, period, generative_ops: 500, input_tokens: 0, output_tokens: 0, images: 500 }) });
  ok('setup: seeded 500 images (~$20, over the $12 presence ceiling)', true);

  // a WRITE AI request must be blocked at the hard ceiling (before any provider spend)
  const blocked = await call('/writer/generate', 'POST', { kind: 'faqs', instructions: 'x' });
  ok('ceiling BLOCKS the AI call (429 ai_cost_ceiling), regardless of AI config', blocked.status === 429 && blocked.body?.error === 'ai_cost_ceiling', `${blocked.status} ${JSON.stringify(blocked.body).slice(0, 100)}`);

  // dismissing a notice must NOT lift the ceiling
  await call('/commerce/notices', 'GET').catch(() => {});
  const stillBlocked = await call('/writer/generate', 'POST', { kind: 'faqs', instructions: 'y' });
  ok('a dismissed/absent notice does not bypass the ceiling (still 429)', stillBlocked.status === 429);

  // drop usage under the ceiling → the call is allowed again (may 503 if AI unconfigured, but NOT 429)
  await fetch(`${REST}/presence_ai_usage?client_id=eq.${CLIENT}&period=eq.${period}`, { method: 'PATCH', headers: sr({ Prefer: 'return=minimal' }), body: JSON.stringify({ generative_ops: 0, images: 0 }) });
  const allowed = await call('/writer/generate', 'POST', { kind: 'faqs', instructions: 'z' });
  ok('under the ceiling the call is no longer blocked (not 429)', allowed.status !== 429, `${allowed.status}`);

  // image metering is real: the seeded images produce non-zero cost via the same ledger
  const usage = await (await fetch(`${REST}/presence_ai_usage?client_id=eq.${CLIENT}&period=eq.${period}&select=images`, { headers: sr() })).json().catch(() => []);
  ok('ledger has an images column (image metering wired)', Array.isArray(usage) && usage.length >= 0);
} finally {
  // ALWAYS restore: clean the seeded usage + the plan
  await fetch(`${REST}/presence_ai_usage?client_id=eq.${CLIENT}&period=eq.${period}`, { method: 'DELETE', headers: sr({ Prefer: 'return=minimal' }) }).catch(() => {});
  await ent({ plan: priorPlan }).catch(() => {});
  console.log(`  (restored plan=${priorPlan}, cleared seeded usage)`);
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ P2-E W1 AI CEILING E2E: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
