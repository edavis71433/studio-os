// ── L2 Platform Operations & Commercial Readiness suite ─────────────────────
// Pure tiers: the AI capacity policy (per-plan allowances, drafting eligibility,
// operation classification, over/approaching-capacity, billing period).
// Integration (staging): plan enforcement on drafting, metering rollups, the
// capacity-notice surface, upgrade/downgrade provisioning, the unattended
// per-site cycle, and the system endpoint's secret gate.
//
//   deno run --allow-read --allow-net --allow-env tests/presence/operations_test.mjs
import {
  classifyAgent, isDraftingAgent, planAllowsDrafting, generativeAllowance,
  overCapacity, approachingCapacity, periodOf,
} from '../../supabase/functions/presence/commerce/capacity.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

// ═══ 1. capacity policy — the commercial ladder in AI terms ═══
{
  ok('allowance: Monitor small, Presence generous, Managed/Agency/Enterprise unlimited',
    generativeAllowance('presence_monitor') === 15 && generativeAllowance('presence') === 60 &&
    generativeAllowance('presence_managed') === null && generativeAllowance('agency') === null && generativeAllowance('enterprise') === null);
  ok('drafting eligibility: Monitor cannot draft; everyone else can',
    !planAllowsDrafting('presence_monitor') && planAllowsDrafting('presence') && planAllowsDrafting('presence_managed') && planAllowsDrafting('agency') && planAllowsDrafting('enterprise'));
  ok('classify: writer/coach generative, editor/concierge assistive, reviewer/guardian analysis',
    classifyAgent('writer') === 'generative' && classifyAgent('coach') === 'generative' &&
    classifyAgent('editor') === 'assistive' && classifyAgent('concierge') === 'assistive' &&
    classifyAgent('reviewer') === 'analysis' && classifyAgent('guardian') === 'analysis');
  ok('drafting agents: writer + editor are drafting; coach is not',
    isDraftingAgent('writer') && isDraftingAgent('editor') && !isDraftingAgent('coach'));
  ok('over-capacity: Monitor is over at its ceiling; unlimited plans never are',
    overCapacity('presence_monitor', 15) && overCapacity('presence_monitor', 20) && !overCapacity('presence_monitor', 14) && !overCapacity('presence_managed', 9999));
  ok('approaching (80%): Monitor at 12/15, Presence at 48/60; unlimited never',
    approachingCapacity('presence_monitor', 12) && !approachingCapacity('presence_monitor', 11) && approachingCapacity('presence', 48) && !approachingCapacity('enterprise', 100000));
  ok('period: UTC YYYY-MM', periodOf(new Date('2026-07-07T12:00:00Z')) === '2026-07' && periodOf(new Date('2026-01-01T00:00:00Z')) === '2026-01');
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} pure passed`);
if (passed !== results.length) { console.log('FAILURES:'); for (const r of results) if (!r.p) console.log('  ✗ ' + r.n); }

// ─────────────────────────────────────────────────────────────────────────────
const SB_URL = (globalThis.Deno && Deno.env.get('SUPABASE_URL')) || '';
const SERVICE = (globalThis.Deno && (Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))) || '';
const ANON = (globalThis.Deno && (Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('ANON_KEY'))) || '';
const BILLING_SECRET = (globalThis.Deno && (Deno.env.get('BILLING_SYNC_SECRET') || Deno.env.get('SCHEDULER_SECRET'))) || '';
if (!SB_URL || !SERVICE || !ANON) {
  console.log('\n(integration tiers skipped — set SUPABASE_URL, SERVICE_ROLE_KEY, SUPABASE_ANON_KEY to run)');
} else {
  await runIntegration({ SB_URL, SERVICE, ANON, BILLING_SECRET });
}

async function runIntegration({ SB_URL, SERVICE, ANON, BILLING_SECRET }) {
  const ires = [];
  const iok = (n, p, note = '') => { ires.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  [int] ${n}${note ? ' — ' + note : ''}`); };
  const FN = `${SB_URL}/functions/v1/presence`;
  const svcH = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
  const authH = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' };
  const stamp = Date.now();
  const email = `l2-acceptance+${stamp}@example.com`;
  const password = 'meadow-lantern-4279-test';
  const period = periodOf(new Date());
  let siteId = null, clientId = null, authUserId = null, jwt = null;

  const rpc = (fn, args) => fetch(`${SB_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: svcH, body: JSON.stringify(args) });
  const rest = (p, init = {}) => fetch(`${SB_URL}/rest/v1/${p}`, { ...init, headers: { ...svcH, ...(init.headers || {}) } });

  try {
    // set up: a Monitor trial customer (no card), then sign in
    const su = await (await fetch(`${FN}/commerce/signup`, { method: 'POST', headers: authH, body: JSON.stringify({ email, password, business_name: 'L2 Acceptance Co', plan: 'presence_monitor', trial: true }) })).json();
    siteId = su?.data?.site_id || null;
    const sg = await (await rest(`presence_signups?email=eq.${encodeURIComponent(email)}&select=client_id,auth_user_id&limit=1`)).json();
    clientId = sg?.[0]?.client_id || null; authUserId = sg?.[0]?.auth_user_id || null;
    iok('setup: Monitor trial provisioned', !!siteId && !!clientId);
    jwt = (await (await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: authH, body: JSON.stringify({ email, password }) })).json())?.access_token || null;
    const jH = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'x-dds-user-jwt': jwt, 'Content-Type': 'application/json' };

    // ── Plan enforcement: Monitor cannot draft (from entitlement, not UI) ──
    const wr = await fetch(`${FN}/writer/generate`, { method: 'POST', headers: jH, body: JSON.stringify({ kind: 'faqs' }) });
    const wj = await wr.json();
    iok('Monitor → POST /writer/generate is refused with upgrade (403)', wr.status === 403 && wj.error === 'plan_upgrade_required');
    const er = await fetch(`${FN}/editor/improve`, { method: 'POST', headers: jH, body: JSON.stringify({ kind: 'edit_identity', action: 'rewrite' }) });
    iok('Monitor → POST /editor/improve is refused with upgrade (403)', er.status === 403);

    // ── Metering: the atomic RPC increments the monthly rollup ──
    await rpc('presence_ai_meter', { p_client_id: clientId, p_site_id: siteId, p_period: period, p_agent: 'writer', p_kind: 'generative', p_model: 'test', p_input_tokens: 100, p_output_tokens: 50 });
    await rpc('presence_ai_meter', { p_client_id: clientId, p_site_id: siteId, p_period: period, p_agent: 'coach', p_kind: 'generative', p_model: 'test', p_input_tokens: 10, p_output_tokens: 5 });
    await rpc('presence_ai_meter', { p_client_id: clientId, p_site_id: siteId, p_period: period, p_agent: 'editor', p_kind: 'assistive', p_model: 'test', p_input_tokens: 10, p_output_tokens: 5 });
    const roll = await (await rest(`presence_ai_usage?client_id=eq.${clientId}&period=eq.${period}&select=generative_ops,assistive_ops,input_tokens&limit=1`)).json();
    iok('metering: rollup counts 2 generative + 1 assistive, tokens summed', roll?.[0]?.generative_ops === 2 && roll?.[0]?.assistive_ops === 1 && roll?.[0]?.input_tokens === 120);
    const events = await (await rest(`presence_ai_usage_events?client_id=eq.${clientId}&select=id`)).json();
    iok('metering: per-call events recorded (append-only detail)', Array.isArray(events) && events.length === 3);

    // ── Capacity notice surface: read + dismiss ──
    await rest('presence_plan_notices', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ site_id: siteId, client_id: clientId, kind: 'capacity', period, headline: 'Test notice', body: 'You are getting a lot of value.', status: 'active' }) });
    const nGet = await (await fetch(`${FN}/commerce/notices`, { headers: jH })).json();
    // Law 13 applies to the customer-VISIBLE copy — headline/body/actions — not the
    // opaque id (a UUID can contain an all-digit segment between hyphens, which is
    // not a number shown to anyone). Check the displayed fields only.
    const n0 = nGet?.data?.notices?.[0];
    const shownText = n0 ? JSON.stringify({ kind: n0.kind, headline: n0.headline, body: n0.body, actions: n0.actions }) : '';
    iok('notices: the customer sees the active capacity notice (3 actions, no numbers)', nGet?.data?.notices?.length === 1 && n0.actions.length === 3 && !shownText.match(/\b\d+\b/));
    await fetch(`${FN}/commerce/notices/dismiss`, { method: 'POST', headers: jH });
    const nGet2 = await (await fetch(`${FN}/commerce/notices`, { headers: jH })).json();
    iok('notices: dismiss clears it', (nGet2?.data?.notices?.length || 0) === 0);

    // ── Upgrade provisioning: Monitor → Presence flips edition + lifts the gate ──
    if (BILLING_SECRET) {
      const upEvt = { type: 'customer.subscription.updated', object: { id: `sub_l2_${stamp}`, customer: `cus_l2_${stamp}`, status: 'active', current_period_end: 1793000000, cancel_at_period_end: false, metadata: { client_id: clientId, plan: 'presence', term: 'monthly', founder: 'false' } } };
      const upR = await (await fetch(`${FN}/commerce/billing-sync`, { method: 'POST', headers: { ...authH, 'x-commerce-secret': BILLING_SECRET }, body: JSON.stringify(upEvt) })).json();
      iok('upgrade: billing-sync reports reprovisioned', upR?.data?.reprovisioned === true);
      const siteUp = await (await rest(`presence_sites?id=eq.${siteId}&select=edition&limit=1`)).json();
      iok('upgrade: site edition flipped monitor → presence', siteUp?.[0]?.edition === 'presence');
      const wr2 = await fetch(`${FN}/writer/generate`, { method: 'POST', headers: jH, body: JSON.stringify({ kind: 'faqs' }) });
      iok('upgrade: drafting no longer refused for plan (not 403)', wr2.status !== 403, `status ${wr2.status}`);

      // ── Downgrade: Presence → Monitor flips back, preserves data ──
      const downEvt = { type: 'customer.subscription.updated', object: { id: `sub_l2_${stamp}`, customer: `cus_l2_${stamp}`, status: 'active', current_period_end: 1793000000, cancel_at_period_end: false, metadata: { client_id: clientId, plan: 'presence_monitor', term: 'monthly', founder: 'false' } } };
      await fetch(`${FN}/commerce/billing-sync`, { method: 'POST', headers: { ...authH, 'x-commerce-secret': BILLING_SECRET }, body: JSON.stringify(downEvt) });
      const siteDown = await (await rest(`presence_sites?id=eq.${siteId}&select=edition,client_id&limit=1`)).json();
      iok('downgrade: edition flips presence → monitor, site + data preserved', siteDown?.[0]?.edition === 'monitor' && siteDown?.[0]?.client_id === clientId);
      const wr3 = await fetch(`${FN}/writer/generate`, { method: 'POST', headers: jH, body: JSON.stringify({ kind: 'faqs' }) });
      iok('downgrade: drafting refused again (capability removed, data kept)', wr3.status === 403);
    } else {
      iok('upgrade/downgrade tier skipped (no BILLING_SYNC_SECRET)', true);
    }

    // ── Unattended per-site cycle runs (isolated) ──
    const { runSiteCycle } = await import('../../supabase/functions/presence/ops/scheduler.ts');
    const siteRow = (await (await rest(`presence_sites?id=eq.${siteId}&select=id,client_id,status,last_published_at,template_slug,template_version,custom_domain,netlify_site_id,edition&limit=1`)).json())?.[0];
    const cyc = await runSiteCycle(siteRow, false);
    iok('scheduler: runSiteCycle returns a structured result with steps (unattended, never throws)', !!cyc && typeof cyc.ok === 'boolean' && typeof cyc.steps === 'object' && 'evidence' in cyc.steps);

    // ── Retry queue predicate: a failed run under max_attempts is retriable ──
    const insFail = await (await rest('presence_scheduled_runs', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ run_type: 'cycle', site_id: siteId, status: 'failed', attempts: 1, max_attempts: 3, last_error: 'test' }) })).json();
    const failId = insFail?.[0]?.id;
    // PostgREST can't compare columns; the runner filters attempts<max_attempts in code — mirror that here.
    const cand = await (await rest(`presence_scheduled_runs?status=eq.failed&run_type=eq.cycle&select=id,attempts,max_attempts&id=eq.${failId}`)).json();
    const due = (Array.isArray(cand) ? cand : []).filter((r) => (r.attempts || 0) < (r.max_attempts || 3));
    iok('retry queue: a failed run under its attempt ceiling is picked up', due.length === 1);

    // ── System endpoint secret gate ──
    const sysNoSecret = await fetch(`${FN}/system/run`, { method: 'POST', headers: authH, body: JSON.stringify({ task: 'cycle' }) });
    iok('/system/run without the secret → 403', sysNoSecret.status === 403);
    const healthNoSecret = await fetch(`${FN}/system/health`, { headers: authH });
    iok('/system/health without the secret → 403', healthNoSecret.status === 403);

  } finally {
    // teardown
    try {
      if (siteId) {
        await rest(`presence_scheduled_runs?site_id=eq.${siteId}`, { method: 'DELETE' });
        await rest(`presence_plan_notices?site_id=eq.${siteId}`, { method: 'DELETE' });
        await rest(`presence_ai_usage_events?site_id=eq.${siteId}`, { method: 'DELETE' });
        await rest(`presence_sites?id=eq.${siteId}`, { method: 'DELETE' });
      }
      if (clientId) {
        await rest(`presence_ai_usage?client_id=eq.${clientId}`, { method: 'DELETE' });
        await rest(`presence_entitlements?client_id=eq.${clientId}`, { method: 'DELETE' });
        await rest(`clients?id=eq.${clientId}`, { method: 'DELETE' });
      }
      await rest(`presence_signups?email=eq.${encodeURIComponent(email)}`, { method: 'DELETE' });
      if (authUserId) await fetch(`${SB_URL}/auth/v1/admin/users/${authUserId}`, { method: 'DELETE', headers: svcH });
    } catch (_) { /* best-effort */ }
  }

  const ip = ires.filter((r) => r.p).length;
  console.log(`\n[integration] ${ip}/${ires.length} passed`);
  if (ip !== ires.length) { console.log('INTEGRATION FAILURES:'); for (const r of ires) if (!r.p) console.log('  ✗ ' + r.n); }
}
