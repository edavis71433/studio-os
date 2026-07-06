// ─────────────────────────────────────────────────────────────────────────────
//  clever-api SMOKE SUITE — the baseline safety gate (M1a)
//
//  Purpose: prove the monolith's representative behaviors BEFORE and AFTER any
//  change to it (first consumer: the _shared middleware extraction). This is
//  not coverage — it is a tripwire across every major behavior class.
//
//  Two tiers:
//    • ANONYMOUS tier (default): needs no secrets beyond the public anon key.
//      Safe for CI. Read-only against production. Sends no email, spends no
//      AI tokens, writes nothing.
//    • AUTH tier (enabled by SR_KEY env): logs in as the dedicated, archived
//      "RCAT Acceptance" test client (rcat-acceptance@example.com) by
//      resetting its password via the service role, then exercises client /
//      Growth / journal / messaging paths. Local or staging-runner only —
//      never put SR_KEY in CI for a public repo.
//
//  Run (anonymous tier):
//    deno run --allow-net tests/smoke/smoke_test.ts
//  Run (full):
//    SR_KEY=<service-role-key> deno run --allow-net --allow-env tests/smoke/smoke_test.ts
//
//  Exit code 0 = all green. Non-zero = at least one FAIL (details printed).
// ─────────────────────────────────────────────────────────────────────────────

const URL_ = Deno.env.get('SUPABASE_URL') || 'https://qksstlqzbhesadrrofgn.supabase.co';
const ANON = Deno.env.get('ANON_KEY') ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrc3N0bHF6Ymhlc2FkcnJvZmduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5NzMwMDMsImV4cCI6MjA5NzU0OTAwM30.4V94Ua7z5cntPWtvtqN24TUnfY5A6K6-zCxY0iEcgYo';
const SR = Deno.env.get('SR_KEY') || '';
const SITE = Deno.env.get('SITE_URL') || 'https://davisdigitalstudio.com';
const FN = `${URL_}/functions/v1/clever-api`;
const WEBHOOK = `${URL_}/functions/v1/stripe-webhook`;
const TEST_EMAIL = 'rcat-acceptance@example.com';

type Row = { name: string; expected: string; actual: string; pass: boolean; ci: boolean };
const rows: Row[] = [];
function record(name: string, expected: string, actual: string, pass: boolean, ci: boolean) {
  rows.push({ name, expected, actual, pass, ci });
  console.log(`${pass ? 'PASS' : 'FAIL'}  [${ci ? 'CI-safe' : 'auth-tier'}] ${name}\n      expected: ${expected}\n      actual:   ${actual}`);
}

async function call(body: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(FN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON}`, ...headers },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: r.status, json, text, headers: r.headers };
}

// ═════════ ANONYMOUS TIER (CI-safe) ═════════

// 1. version handshake — the deploy sanity signal CI already uses
{
  const r = await call({ type: 'version' });
  record('public: version handshake', '200 + data.build', `${r.status} build=${r.json?.data?.build ?? 'MISSING'}`,
    r.status === 200 && !!r.json?.data?.build, true);
}

// 2. unknown route fails closed
{
  const r = await call({ type: 'smoke_nonexistent_route_xyz' });
  record('gate: unknown route fails closed', '403 unknown_route', `${r.status} ${r.json?.error ?? r.text.slice(0, 60)}`,
    r.status === 403 && r.json?.error === 'unknown_route', true);
}

// 3. staff route without JWT → 401 (auth gate)
{
  const r = await call({ type: 'admin_query', path: 'clients?select=id&limit=1' });
  record('auth: staff route unauthenticated', '401 unauthorized', `${r.status} ${r.json?.error ?? ''}`,
    r.status === 401 && r.json?.error === 'unauthorized', true);
}

// 4. client-emailing notify types are staff-gated (billing/messaging abuse guard)
for (const t of ['invoice_reminder', 'approval_needed']) {
  const r = await call({ type: t, clientEmail: 'nobody@example.com', message: 'smoke' });
  record(`billing/notify: '${t}' unauthenticated`, '401 unauthorized', `${r.status} ${r.json?.error ?? ''}`,
    r.status === 401, true);
}

// 5. billing: Stripe checkout-link route is staff-gated
{
  const r = await call({ type: 'invoice_paylink', invoiceId: '00000000-0000-0000-0000-000000000000' });
  record('billing: invoice_paylink unauthenticated', '401 unauthorized', `${r.status} ${r.json?.error ?? ''}`,
    r.status === 401, true);
}

// 6. CORS allowlist: real origin echoed, foreign origin NOT echoed
{
  const good = await call({ type: 'version' }, { Origin: 'https://davisdigitalstudio.com' });
  const evil = await call({ type: 'version' }, { Origin: 'https://evil.example.com' });
  const g = good.headers.get('access-control-allow-origin');
  const e = evil.headers.get('access-control-allow-origin');
  record('cors: allowlisted origin echoed', 'ACAO=https://davisdigitalstudio.com', `ACAO=${g}`,
    g === 'https://davisdigitalstudio.com', true);
  record('cors: foreign origin not echoed', 'ACAO != evil origin', `ACAO=${e}`,
    !!e && e !== 'https://evil.example.com', true);
}

// 7. public contract read (the B2 surface): published agreement present
{
  const r = await call({ type: 'contract_get' });
  const v = r.json?.data?.version;
  record('public: contract_get returns published agreement', '200 + data.version >= 1', `${r.status} version=${v}`,
    r.status === 200 && Number(v) >= 1, true);
}

// 8. resolver probe (public identity seam)
{
  const r = await call({ type: '_resolver_probe' });
  const kind = r.json?.data?.kind ?? r.json?.kind;
  record('public: _resolver_probe anonymous → public principal', "200 + kind='public'", `${r.status} kind=${kind}`,
    r.status === 200 && kind === 'public', true);
}

// 9. stripe-webhook rejects unsigned payloads (HMAC gate)
{
  const r = await fetch(WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"type":"smoke"}' });
  const text = await r.text();
  record('stripe-webhook: unsigned payload rejected', '400 invalid signature', `${r.status} ${text.slice(0, 40)}`,
    r.status === 400 && text.includes('invalid signature'), true);
}

// 10. deployed surfaces reachable (frontends ride the same release train)
for (const p of ['/portal.html', '/dds-studio-manage-9k2p.html']) {
  const r = await fetch(`${SITE}${p}`, { method: 'HEAD' });
  record(`deploy: ${p} reachable`, '200', String(r.status), r.status === 200, true);
}

// 11. presence function is up + its auth gate fails closed (M3)
{
  const r = await fetch(`${URL_}/functions/v1/presence/site`, { method: 'GET', headers: { 'Authorization': `Bearer ${ANON}` } });
  const j = await r.json().catch(() => null);
  record('presence: GET /site unauthenticated → 401', '401 unauthorized', `${r.status} ${j?.error ?? ''}`,
    r.status === 401 && j?.error === 'unauthorized', true);
}
{
  const r = await fetch(`${URL_}/functions/v1/presence/nope`, { method: 'GET', headers: { 'Authorization': `Bearer ${ANON}` } });
  record('presence: unknown route → 401 (gate before router)', '401', String(r.status), r.status === 401, true);
}

// ═════════ AUTH TIER (SR_KEY required — local/staging only) ═════════

if (!SR) {
  console.log('\n(SR_KEY not set — auth-tier checks skipped: client_project, client_decisions, gp_workspace, messaging RLS, client-vs-staff boundary)');
} else {
  const srH = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' };
  // reset the dedicated test identity's password for this run
  const pw = 'smoke-' + crypto.randomUUID().slice(0, 12);
  const users = await (await fetch(`${URL_}/auth/v1/admin/users?page=1&per_page=200`, { headers: srH })).json();
  const u = (users.users || []).find((x: any) => (x.email || '').toLowerCase() === TEST_EMAIL);
  if (!u) {
    record('auth-tier: test identity exists', 'auth user found', 'rcat-acceptance@example.com MISSING', false, false);
  } else {
    await fetch(`${URL_}/auth/v1/admin/users/${u.id}`, { method: 'PUT', headers: srH, body: JSON.stringify({ password: pw }) });
    const li = await (await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, password: pw }),
    })).json();
    const jwt = li.access_token || '';
    record('auth-tier: test client login', 'access_token minted', jwt ? 'minted' : JSON.stringify(li).slice(0, 80), !!jwt, false);

    if (jwt) {
      const cH = { 'x-dds-user-jwt': jwt };

      // 11. journal/project behavior
      {
        const r = await call({ type: 'client_project' }, cH);
        record('client: client_project (journal/project)', '200 + data', `${r.status} data=${r.json?.data ? 'present' : 'missing'}`,
          r.status === 200 && !!r.json?.data, false);
      }

      // 12. client decisions (approvals brief)
      {
        const r = await call({ type: 'client_decisions' }, cH);
        record('client: client_decisions (approvals brief)', '200 + data', `${r.status} data=${r.json?.data ? 'present' : 'missing'}`,
          r.status === 200 && !!r.json?.data, false);
      }

      // 13. Growth Partnership workspace
      {
        const r = await call({ type: 'gp_workspace' }, cH);
        const hasP = !!r.json?.data?.partnership;
        record('growth: gp_workspace resolves partnership', '200 + data.partnership', `${r.status} partnership=${hasP}`,
          r.status === 200 && hasP, false);
      }

      // 14. messaging: RLS-scoped read as the client (portal messaging path)
      {
        const r = await fetch(`${URL_}/rest/v1/messages?select=id,from_who&limit=5`, {
          headers: { apikey: ANON, Authorization: `Bearer ${jwt}` },
        });
        const j = await r.json().catch(() => null);
        record('messaging: RLS-scoped messages read', '200 + array (own rows only)', `${r.status} rows=${Array.isArray(j) ? j.length : 'ERR'}`,
          r.status === 200 && Array.isArray(j), false);
      }

      // 15. boundary: client JWT rejected from staff routes
      {
        const r = await call({ type: 'admin_query', path: 'clients?select=id&limit=1' }, cH);
        record('auth: client JWT rejected from staff route', '401 unauthorized', `${r.status} ${r.json?.error ?? ''}`,
          r.status === 401, false);
      }
    }
  }
}

// ═════════ SUMMARY ═════════
const fails = rows.filter((r) => !r.pass);
console.log(`\n════ SMOKE: ${rows.length - fails.length}/${rows.length} PASSED ════`);
if (fails.length) {
  console.log('FAILURES:');
  for (const f of fails) console.log(` - ${f.name}: expected ${f.expected}, got ${f.actual}`);
  Deno.exit(1);
}
