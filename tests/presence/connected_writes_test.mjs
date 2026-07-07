// ── L4.3 Write-Capable Adapters suite ───────────────────────────────────────
// Proves the write safety core: every workflow is a complete plain-language
// PLAN; every write follows one architecture; approval is a law enforced in the
// executor; handoffs are structurally incapable of an external write; real
// writes are gated + verified; rollback is real or honestly explained; a broken
// plan never throws. Integration (staging): the full handoff lifecycle
// prepare → approve → execute → verify → audit, and approval-before-execute.
//
//   deno run --allow-read --allow-net --allow-env tests/presence/connected_writes_test.mjs
import { WRITE_SPECS, writeSpec, buildWritePlan, writeWorkflowsForProvider, isHandoff } from '../../supabase/functions/presence/connected/writes.ts';
import { executeWrite, writeConfigured } from '../../supabase/functions/presence/connected/execute.ts';
import { providerByKey, CONNECTED_PROVIDERS } from '../../supabase/functions/presence/connected/providers.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const WORKFLOWS = WRITE_SPECS.map((w) => w.workflow);
const planFor = (wf, input = {}) => buildWritePlan(wf, providerByKey(writeSpec(wf).provider_key), input);

// ═══ 1. every workflow builds a COMPLETE, plain-language plan ═══
{
  let bad = [];
  for (const wf of WORKFLOWS) {
    const pl = planFor(wf, { text: 'Open late Friday', hours: { fri: '9-9' }, priorHours: { fri: '9-5' }, subject: 'Hi', siteUrl: 'https://x.example', when: 'Fri 2pm' });
    const complete = pl.title && pl.summary && Array.isArray(pl.what_changes) && pl.what_changes.length > 0 &&
      Array.isArray(pl.what_stays) && pl.what_stays.length > 0 && pl.risk && pl.verify && pl.rollback &&
      pl.requires_approval === true && typeof pl.reversible === 'boolean' && pl.kind && pl.provider_key;
    if (!complete) bad.push(wf);
  }
  ok('plan: every workflow yields a complete plan (title/summary/what-changes/what-stays/risk/verify/rollback/approval)', bad.length === 0, bad.join(','));
  ok('plan: approval is a constant on every plan (nothing opts out)', WORKFLOWS.every((wf) => planFor(wf).requires_approval === true));
  ok('plan: every plan says what will NOT change (the reassurance is mandatory)', WORKFLOWS.every((wf) => planFor(wf).what_stays.length >= 1));
  ok('plan: every plan explains how it is verified', WORKFLOWS.every((wf) => planFor(wf).verify.length > 10));
}

// ═══ 2. ONE architecture — no provider-specific write path ═══
{
  ok('architecture: every write spec targets a real registered provider', WRITE_SPECS.every((w) => !!providerByKey(w.provider_key)));
  ok('architecture: every spec is exactly write or handoff', WRITE_SPECS.every((w) => w.kind === 'write' || w.kind === 'handoff'));
  ok('architecture: writes declare a method + endpoint; handoffs declare neither', WRITE_SPECS.every((w) =>
    w.kind === 'write' ? (!!w.method && !!w.endpoint) : (!w.method && !w.endpoint)));
  // the three write workflows and three handoffs the milestone asked for
  const writes = WRITE_SPECS.filter((w) => w.kind === 'write').map((w) => w.workflow).sort();
  const handoffs = WRITE_SPECS.filter((w) => w.kind === 'handoff').map((w) => w.workflow).sort();
  ok('architecture: writes = GBP post, GBP hours, GSC verify', JSON.stringify(writes) === JSON.stringify(['gbp_hours', 'gbp_post', 'gsc_verify']));
  ok('architecture: handoffs = calendar, email, social (prepared, never sent)', JSON.stringify(handoffs) === JSON.stringify(['calendar_hold', 'email_draft', 'social_draft']));
  ok('architecture: providers with no write workflow stay read-only (e.g. Analytics, Yelp)', writeWorkflowsForProvider('google_analytics').length === 0 && writeWorkflowsForProvider('yelp').length === 0);
}

// ═══ 3. approval is a LAW — the executor refuses an unapproved plan ═══
{
  const proposed = { id: 'p1', provider_key: 'google_business_profile', workflow: 'gbp_post', kind: 'write', status: 'proposed', payload: { summary: 'hi' } };
  const r = await executeWrite('s1', proposed, 'your Google listing');
  ok('approval: an unapproved write cannot execute (law enforced in the executor)', r.ok === false && r.reason === 'not_approved');
  const abandoned = { ...proposed, status: 'abandoned' };
  ok('approval: an abandoned plan cannot execute either', (await executeWrite('s1', abandoned, 'x')).ok === false);
}

// ═══ 4. handoffs are STRUCTURALLY incapable of an external write ═══
{
  const handoff = { id: 'h1', provider_key: 'mailchimp', workflow: 'email_draft', kind: 'handoff', status: 'approved', payload: { subject: 'S', body: 'B' } };
  const r = await executeWrite('s1', handoff, 'your email list');
  ok('handoff: an approved handoff "executes" without touching a provider', r.ok === true && r.kind === 'handoff' && r.response?.prepared === true);
  ok('handoff: a handoff verifies as prepared-not-sent', r.verification?.ok === true && /nothing was sent|in your hands/i.test(r.verification.note));
  ok('handoff: handoff availability never depends on external write scopes', WRITE_SPECS.filter((w) => w.kind === 'handoff').every((w) => writeConfigured(w.workflow) === true));
}

// ═══ 5. real writes are GATED — off until the owner registers write scopes ═══
{
  ok('gating: real writes are not available without registered write scopes (honest, not a fake success)',
    WRITE_SPECS.filter((w) => w.kind === 'write').every((w) => writeConfigured(w.workflow) === false));
  const approvedWrite = { id: 'w1', provider_key: 'google_business_profile', workflow: 'gbp_hours', kind: 'write', status: 'approved', payload: { hours: { fri: '9-9' } } };
  const r = await executeWrite('s1', approvedWrite, 'your Google listing');
  ok('gating: an approved real write is honestly "not available" here, never silently dropped', r.ok === false && r.reason === 'not_available');
}

// ═══ 6. reversible / rollback — undo is real or honestly explained ═══
{
  const hours = planFor('gbp_hours', { hours: { fri: '9-9' }, priorHours: { fri: '9-5' } });
  ok('rollback: hours are reversible and snapshot the prior state', hours.reversible === true && hours.prior_state?.hours?.fri === '9-5');
  const post = planFor('gbp_post', { text: 'hi' });
  ok('rollback: a post is reversible (can be deleted)', post.reversible === true && /delete|remove/i.test(post.rollback));
  const verify = planFor('gsc_verify', { siteUrl: 'https://x.example' });
  ok('rollback: an irreversible write explains why undo is unneeded (nothing public changed)', verify.reversible === false && verify.rollback.length > 20);
  ok('rollback: handoffs are trivially reversible (nothing was sent)', WRITE_SPECS.filter((w) => w.kind === 'handoff').every((w) => planFor(w.workflow).reversible === true));
}

// ═══ 7. plain language — no engineering jargon in customer-facing plans ═══
{
  const denylist = /\b(API|OAuth|endpoint|payload|token|scope|HTTP|PATCH|JSON|localPosts|updateMask)\b/i;
  let offenders = [];
  for (const wf of WORKFLOWS) {
    const pl = planFor(wf, { text: 'x', hours: {}, siteUrl: 'https://x' });
    const text = [pl.title, pl.summary, ...pl.what_changes, ...pl.what_stays, pl.risk, pl.rollback, pl.verify].join(' ');
    if (denylist.test(text)) offenders.push(wf);
  }
  ok('language: plans carry no jargon — the customer reads plain words only', offenders.length === 0, offenders.join(','));
}

// ═══ 8. isolation — a malformed plan never throws ═══
{
  let threw = false;
  try {
    await executeWrite('s', { id: 'x', provider_key: 'nope', workflow: 'not_a_workflow', kind: 'write', status: 'approved', payload: {} }, 'x');
    await executeWrite('s', {}, 'x');
  } catch { threw = true; }
  ok('isolation: executing a garbage plan returns safely, never throws', !threw);
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ WRITE-CAPABLE ADAPTERS: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) { console.log('FAILURES:'); for (const r of results) if (!r.p) console.log('  ✗ ' + r.n); }

// ── Integration (staging): the full handoff lifecycle + approval-before-execute ──
const SB = (globalThis.Deno && Deno.env.get('SUPABASE_URL')) || '';
const SR = (globalThis.Deno && (Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))) || '';
const ANON = (globalThis.Deno && (Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('ANON_KEY'))) || '';
if (!SB || !SR || !ANON) { console.log('\n(integration tier skipped — set SUPABASE_URL, SERVICE_ROLE_KEY, SUPABASE_ANON_KEY)'); }
else { await integration({ SB, SR, ANON }); }

async function integration({ SB, SR, ANON }) {
  const ires = []; const iok = (n, p, note = '') => { ires.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  [int] ${n}${note ? ' — ' + note : ''}`); };
  const FN = `${SB}/functions/v1/presence`;
  const svcH = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' };
  const authH = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' };
  const stamp = Date.now(); const email = `l43+${stamp}@example.com`; const password = 'meadow-lantern-4279-test';
  let siteId = null, clientId = null, authUserId = null, jwt = null;
  const rest = (p, i = {}) => fetch(`${SB}/rest/v1/${p}`, { ...i, headers: { ...svcH, ...(i.headers || {}) } });
  try {
    const su = await (await fetch(`${FN}/commerce/signup`, { method: 'POST', headers: authH, body: JSON.stringify({ email, password, business_name: 'L4.3 Co', plan: 'presence', trial: true }) })).json();
    siteId = su?.data?.site_id;
    const sg = await (await rest(`presence_signups?email=eq.${encodeURIComponent(email)}&select=client_id,auth_user_id&limit=1`)).json();
    clientId = sg?.[0]?.client_id; authUserId = sg?.[0]?.auth_user_id;
    jwt = (await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: authH, body: JSON.stringify({ email, password }) })).json())?.access_token;
    const jH = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'x-dds-user-jwt': jwt, 'Content-Type': 'application/json' };
    iok('setup: trial site + sign-in', !!siteId && !!jwt);

    // prepare a handoff write plan (email draft — never sent)
    const prep = await (await fetch(`${FN}/connections/mailchimp/write/prepare`, { method: 'POST', headers: jH, body: JSON.stringify({ workflow: 'email_draft', subject: 'Spring hours', text: 'We are open later on Fridays.' }) })).json();
    const planId = prep?.data?.id;
    iok('prepare: a proposed handoff plan is created with plain-language fields', !!planId && prep.data.status === 'proposed' && prep.data.what_stays.length >= 1 && prep.data.requires_approval === true, prep?.error || '');

    // approval is a law: execute BEFORE approve must be refused
    const early = await fetch(`${FN}/connections/mailchimp/write/${planId}/execute`, { method: 'POST', headers: jH });
    iok('law: executing before approval is refused (409 not_approved)', early.status === 409);

    // approve, then execute
    const dec = await fetch(`${FN}/connections/mailchimp/write/${planId}/decide`, { method: 'POST', headers: jH, body: JSON.stringify({ decision: 'approve' }) });
    iok('decide: the plan is explicitly approved', dec.status === 200);
    const exec = await (await fetch(`${FN}/connections/mailchimp/write/${planId}/execute`, { method: 'POST', headers: jH })).json();
    iok('execute: the handoff completes and verifies as prepared-not-sent', exec?.data?.status === 'executed' && exec.data.kind === 'handoff' && exec.data.verification?.ok === true, exec?.error || '');

    // audit trail: every step recorded
    const events = await (await rest(`presence_connection_events?site_id=eq.${siteId}&provider_key=eq.mailchimp&select=action&order=created_at.asc`)).json();
    const actions = (events || []).map((e) => e.action);
    iok('audit: prepare, approve, and execute are all recorded', ['write_prepare', 'write_approve', 'write_execute'].every((a) => actions.includes(a)), actions.join(','));

    // a real write (GBP) is honestly gated, approval still saved
    const gp = await (await fetch(`${FN}/connections/google_business_profile/write/prepare`, { method: 'POST', headers: jH, body: JSON.stringify({ workflow: 'gbp_hours', hours: { fri: '9-9' } }) })).json();
    if (gp?.data?.id) {
      await fetch(`${FN}/connections/google_business_profile/write/${gp.data.id}/decide`, { method: 'POST', headers: jH, body: JSON.stringify({ decision: 'approve' }) });
      const ge = await fetch(`${FN}/connections/google_business_profile/write/${gp.data.id}/execute`, { method: 'POST', headers: jH });
      iok('gating: an approved real write is honestly "not available yet" (503), approval preserved', ge.status === 503);
    }
  } finally {
    try {
      if (siteId) { await rest(`presence_connection_writes?site_id=eq.${siteId}`, { method: 'DELETE' }); await rest(`presence_connection_events?site_id=eq.${siteId}`, { method: 'DELETE' }); await rest(`presence_connections?site_id=eq.${siteId}`, { method: 'DELETE' }); await rest(`presence_sites?id=eq.${siteId}`, { method: 'DELETE' }); }
      if (clientId) { await rest(`presence_entitlements?client_id=eq.${clientId}`, { method: 'DELETE' }); await rest(`clients?id=eq.${clientId}`, { method: 'DELETE' }); }
      await rest(`presence_signups?email=eq.${encodeURIComponent(email)}`, { method: 'DELETE' });
      if (authUserId) await fetch(`${SB}/auth/v1/admin/users/${authUserId}`, { method: 'DELETE', headers: svcH });
    } catch (_) { /* */ }
  }
  const ip = ires.filter((r) => r.p).length;
  console.log(`\n[integration] ${ip}/${ires.length} passed`);
  if (ip !== ires.length) { console.log('INTEGRATION FAILURES:'); for (const r of ires) if (!r.p) console.log('  ✗ ' + r.n); }
}
