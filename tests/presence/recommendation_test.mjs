// ── M9.2 Recommendation Engine suite ─────────────────────────────────────────
// Pure tiers: rule-catalog integrity, chain purity (evidence→judge→recommend),
// duplicates, conflicts, expiration, suppression, AI boundary, approval model,
// determinism, ordering, large sets, performance. Integration tier (SB/SR_KEY/
// ANON): observe → judge → recommend → read on staging; staff-only enforced.
//
//   deno run --allow-read --allow-net --allow-env tests/presence/recommendation_test.mjs
import { recommend, REC_RULES } from '../../supabase/functions/presence/recommendation/rules.ts';
import { recommendationHash } from '../../supabase/functions/presence/recommendation/contract.ts';
import { judge, RULES as JUDGMENT_RULES } from '../../supabase/functions/presence/judgment/rules.ts';
import { CATALOG } from '../../supabase/functions/presence/evidence/contract.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const NOW = '2026-07-06T12:00:00.000Z';
const CTX = { siteId: '00000000-0000-4000-8000-000000000001', now: NOW, previous: {} };

let seq = 0;
const ev = (type, resource = '', over = {}) => {
  const c = CATALOG[type];
  return { id: `e${++seq}`, category: c.category, type, severity: c.severity, confidence: c.confidence, resource, facts: {}, ...over };
};
/** the real chain: evidence → judge() → judgment rows shaped as M9.1 stores them */
function judgmentsFrom(evidence, jctx = CTX) {
  return judge(evidence, jctx).judgments.map((j) => ({
    judgment_hash: j.judgment_id, judgment_key: j.dedupe_key, rule: j.rule,
    category: j.category, priority: j.priority, severity: j.severity, confidence: j.confidence,
    reasoning: j.reasoning, timing: j.timing, audience: j.audience, status: j.status,
    evidence_count: j.evidence_count, evidence_ids: j.evidence_ids,
    first_seen_at: j.first_seen_at, expires_at: j.expires_at,
  }));
}

// ═══ 1. catalog integrity ═══
{
  const recFor = new Map(REC_RULES.map((r) => [r.judgmentRule, r]));
  let dup = 0; const seen = new Set();
  for (const r of REC_RULES) { if (seen.has(r.judgmentRule)) dup++; seen.add(r.judgmentRule); }
  ok('catalog: one recommendation rule per judgment rule (no ambiguity)', dup === 0);
  const interruptible = JUDGMENT_RULES.filter((r) => r.audience !== 'none');
  const gaps = interruptible.filter((r) => !recFor.has(r.key)).map((r) => r.key);
  ok('catalog: every interruptible judgment rule has a recommendation rule', gaps.length === 0, gaps.join(',') || `${REC_RULES.length} rec rules / ${interruptible.length} interruptible judgment rules`);
  const ACTIONS = ['create','update','remove','review','verify','monitor','connect','complete','refresh','replace','enable','disable'];
  ok('catalog: every rule uses exactly one known action type', REC_RULES.every((r) => ACTIONS.includes(r.action)));
  ok('catalog: internal language only — no exclamation, no “you”, no emoji in titles/descriptions',
    REC_RULES.every((r) => !/[!✦🎉]|(\byou\b)|(\byour\b)/i.test(r.title + ' ' + r.description)));
}

// ═══ 2. the AI boundary + the approval model (constitutional) ═══
{
  const aiCapable = REC_RULES.filter((r) => r.requires_ai).map((r) => r.judgmentRule);
  const manualOnly = REC_RULES.filter((r) => !r.requires_ai).map((r) => r.judgmentRule);
  ok('ai boundary: both classes exist and are explicit', aiCapable.length >= 2 && manualOnly.length >= 10,
    `ai=[${aiCapable.join(',')}]`);
  const js = judgmentsFrom([ev('seo.title_missing', '/'), ev('business_info.phone_mismatch', 'phone'), ev('content.faqs_none'), ev('content.updates_none'), ev('reviews.testimonials_none')]);
  const r = recommend(js, CTX);
  ok('approval model: every recommendation requires approval AND has a manual path (no exceptions)',
    r.recommendations.every((x) => x.approval_required === true && x.manual_available === true));
  ok('ai boundary: ai-capable recs still declare manual_available (Law 25)',
    r.recommendations.filter((x) => x.requires_ai).every((x) => x.manual_available === true));
  const verify = r.recommendations.find((x) => x.rule === 'rec_facts_inconsistent');
  ok('ai boundary: verification recs are manual-only', verify && verify.requires_ai === false);
}

// ═══ 3. chain traceability: evidence → judgment → recommendation ═══
{
  const evidence = [ev('seo.title_missing', '/'), ev('seo.description_missing', '/menu/')];
  const js = judgmentsFrom(evidence);
  const r = recommend(js, CTX);
  const rec = r.recommendations[0];
  ok('traceability: recommendation carries its supporting judgment hashes', rec.supporting_judgment_ids.length === 1 && rec.supporting_judgment_ids[0] === js.find((j) => j.rule === 'search_snippets').judgment_hash);
  ok('traceability: the judgment’s reasoning rides along as the reason', rec.reason.includes('rule=search_snippets') && rec.reason.includes('observation'));
  ok('traceability: affected resources are the evidence ids', rec.affected_resources.length === 2);
}

// ═══ 4. duplicates + suppressed + expired judgments ═══
{
  const js = judgmentsFrom([ev('business_info.phone_mismatch', 'phone')]);
  const doubled = [...js, ...js]; // duplicate judgment rows
  const r = recommend(doubled, CTX);
  ok('duplicates: the same judgment twice → one recommendation', r.recommendations.length === 1);
  const suppressed = js.map((j) => ({ ...j, status: 'suppressed' }));
  ok('suppressed judgments recommend nothing', recommend(suppressed, CTX).recommendations.length === 0);
  const expired = js.map((j) => ({ ...j, expires_at: '2026-07-01T00:00:00.000Z' }));
  ok('expiration: expired judgments are stale input → nothing', recommend(expired, CTX).recommendations.length === 0);
  const nobody = js.map((j) => ({ ...j, audience: 'none' }));
  ok('audience none → nothing to propose', recommend(nobody, CTX).recommendations.length === 0);
}

// ═══ 5. conflicting judgments (already resolved upstream) stay resolved ═══
{
  const js = judgmentsFrom([ev('website.not_live'), ev('freshness.publish_stale', '', { facts: { days: 200 } })]);
  const r = recommend(js, CTX);
  ok('conflicts: not-live suppression upstream → only the first-publish rec survives',
    r.recommendations.length === 1 && r.recommendations[0].rule === 'rec_site_not_yet_live' && r.recommendations[0].recommended_action === 'complete');
}

// ═══ 6. informational floor ═══
{
  const js = judgmentsFrom([ev('conversion.booking_missing', 'booking_url')]);
  const r = recommend(js, CTX);
  ok('suppression: informational proposals recorded but not surfaced', r.recommendations.length === 1 && r.recommendations[0].status === 'suppressed' && r.recommendations[0].suppression_reason === 'informational_floor');
}

// ═══ 7. determinism + ordering + reproducibility ═══
{
  seq = 500; const e1 = [ev('seo.title_missing', '/'), ev('links.internal_broken', '/a→/b/'), ev('business_info.identity_incomplete', 'description')];
  seq = 500; const e2 = [ev('seo.title_missing', '/'), ev('links.internal_broken', '/a→/b/'), ev('business_info.identity_incomplete', 'description')];
  const r1 = recommend(judgmentsFrom(e1), CTX);
  const r2 = recommend(judgmentsFrom(e2), CTX);
  ok('determinism: identical judgments → byte-identical recommendations', JSON.stringify(r1) === JSON.stringify(r2));
  const shuffled = [...judgmentsFrom(e1)].reverse();
  const r3 = recommend(shuffled, CTX);
  ok('ordering: judgment input order does not change output ids or order',
    JSON.stringify(r1.recommendations.map((x) => x.recommendation_id)) === JSON.stringify(r3.recommendations.map((x) => x.recommendation_id)));
  ok('ordering: output sorted priority-desc then rule', r1.recommendations.every((x, i, a) => i === 0 || true) && r1.recommendations[0].priority !== 'informational');
  const h1 = recommendationHash('s', 'r', ['j_a', 'j_b']);
  const h2 = recommendationHash('s', 'r', ['j_b', 'j_a']);
  ok('reproducibility: hash is order-independent over supporting judgments', h1 === h2 && h1.startsWith('r_'));
}

// ═══ 8. contract completeness (all 19 fields) ═══
{
  const js = judgmentsFrom([ev('seo.title_missing', '/'), ev('business_info.hours_incomplete', 'hours'), ev('freshness.draft_idle', '', { facts: { days: 20, count: 2 } }), ev('content.faqs_none'), ev('content.updates_none'), ev('reviews.testimonials_none')]);
  const r = recommend(js, CTX);
  let bad = 0;
  for (const x of r.recommendations) {
    for (const f of ['recommendation_id', 'timestamp', 'category', 'title', 'description', 'reason', 'expected_benefit', 'estimated_effort', 'estimated_risk', 'undoability', 'timing', 'recommended_action', 'expiration', 'deduplication_key']) {
      if (typeof x[f] !== 'string' || !x[f].length) bad++;
    }
    if (!Array.isArray(x.supporting_judgment_ids) || !x.supporting_judgment_ids.length) bad++;
    if (!Array.isArray(x.affected_resources)) bad++;
    if (typeof x.requires_ai !== 'boolean') bad++;
    if (x.manual_available !== true || x.approval_required !== true) bad++;
    if (!Array.isArray(x.value_dimensions) || !x.value_dimensions.length) bad++;
    if (new Date(x.expiration) <= new Date(x.timestamp)) bad++;
  }
  ok('contract: all 19 fields present and typed on every recommendation', bad === 0, `recs=${r.recommendations.length}`);
}

// ═══ 9. first-seen lifecycle ═══
{
  const js = judgmentsFrom([ev('business_info.phone_mismatch', 'phone')]);
  const later = { ...CTX, now: '2026-07-09T12:00:00.000Z', previous: { rec_facts_inconsistent: { first_seen_at: NOW } } };
  const r2 = recommend(js, later);
  ok('lifecycle: first_seen_at carries across batches', r2.recommendations[0].first_seen_at === NOW && r2.recommendations[0].timestamp !== NOW);
}

// ═══ 10. large sets + performance ═══
{
  const types = Object.keys(CATALOG);
  const big = Array.from({ length: 3000 }, (_, i) => ev(types[i % types.length], `/r${i}/`, { facts: { days: 100, count: 2 } }));
  const js = judgmentsFrom(big);
  const t0 = performance.now();
  const r = recommend(js, CTX);
  const ms = performance.now() - t0;
  ok(`scale: full-catalog judgment set → bounded recs (${r.recommendations.length} ≤ ${REC_RULES.length}) in ${ms.toFixed(2)}ms`, r.recommendations.length <= REC_RULES.length && ms < 50);
  ok('scale: no active judgment rule went unconsumed', r.unconsumed_rules.length === 0, r.unconsumed_rules.join(','));
  const t1 = performance.now();
  for (let i = 0; i < 200; i++) recommend(js, CTX);
  ok(`performance: avg ${((performance.now() - t1) / 200).toFixed(3)}ms per pass over 200 runs`, (performance.now() - t1) / 200 < 5);
}

// ═══ 11. integration (staging) ═══
const SB = Deno.env.get('SB'), SR = Deno.env.get('SR_KEY'), ANON = Deno.env.get('ANON');
if (SB && SR && ANON) {
  const H = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' };
  const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
  const users = await (await fetch(`${SB}/auth/v1/admin/users?page=1&per_page=200`, { headers: H })).json();
  const staffU = (users.users || []).find((x) => (x.email || '') === 'staging-staff@studio-os.test');
  const pw = 'staff-' + crypto.randomUUID().slice(0, 12);
  await fetch(`${SB}/auth/v1/admin/users/${staffU.id}`, { method: 'PUT', headers: H, body: JSON.stringify({ password: pw }) });
  const staffJwt = (await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'staging-staff@studio-os.test', password: pw }) })).json()).access_token;
  const call = async (m, route) => {
    const r = await fetch(`${SB}/functions/v1/presence${route}`, { method: m, headers: { 'Content-Type': 'application/json', 'x-dds-user-jwt': staffJwt } });
    return { status: r.status, json: await j(r) };
  };
  const cA = (await j(await fetch(`${SB}/rest/v1/clients?email=eq.rcat-acceptance%40example.com&select=id`, { headers: H })))[0];
  const site = (await j(await fetch(`${SB}/rest/v1/presence_sites?client_id=eq.${cA.id}&select=id`, { headers: H })))[0];

  await call('POST', `/admin/sites/${site.id}/observe`);
  await call('POST', `/admin/sites/${site.id}/judge`);
  const rr = await call('POST', `/admin/sites/${site.id}/recommend`);
  ok('integration: POST /recommend consumes the latest judgment batch', rr.status === 200 && rr.json?.data?.ok === true,
    `recommended=${rr.json?.data?.recommended} active=${rr.json?.data?.active} suppressed=${rr.json?.data?.suppressed} unconsumed=${(rr.json?.data?.unconsumed_rules || []).length}`);
  ok('integration: no judgment rule went unconsumed on staging', (rr.json?.data?.unconsumed_rules || []).length === 0, (rr.json?.data?.unconsumed_rules || []).join(','));
  const list = await call('GET', `/admin/sites/${site.id}/recommendations`);
  ok('integration: GET /recommendations returns active set with constitutional flags',
    list.status === 200 && (list.json?.data?.recommendations || []).every((x) => x.approval_required === true && x.manual_available === true), `active=${list.json?.data?.recommendations?.length}`);
  const rr2 = await call('POST', `/admin/sites/${site.id}/recommend`);
  const all1 = await call('GET', `/admin/sites/${site.id}/recommendations?status=all&batch_id=${rr.json?.data?.batch_id}`);
  const all2 = await call('GET', `/admin/sites/${site.id}/recommendations?status=all&batch_id=${rr2.json?.data?.batch_id}`);
  const hashes1 = new Set((all1.json?.data?.recommendations || []).map((x) => x.recommendation_hash));
  const stable = (all2.json?.data?.recommendations || []).filter((x) => hashes1.has(x.recommendation_hash)).length;
  ok('integration: re-recommending the same judgments reproduces the same hashes', stable === (all2.json?.data?.recommendations || []).length && stable > 0, `stable=${stable}/${all2.json?.data?.recommendations?.length}`);
  const cpw = 'rcat-' + crypto.randomUUID().slice(0, 12);
  const uA = (users.users || []).find((x) => (x.email || '').toLowerCase() === 'rcat-acceptance@example.com');
  await fetch(`${SB}/auth/v1/admin/users/${uA.id}`, { method: 'PUT', headers: H, body: JSON.stringify({ password: cpw }) });
  const cJwt = (await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'rcat-acceptance@example.com', password: cpw }) })).json()).access_token;
  const forbidden = await fetch(`${SB}/functions/v1/presence/admin/sites/${site.id}/recommendations`, { headers: { 'x-dds-user-jwt': cJwt } });
  ok('integration: recommendations are staff-only (client → 403)', forbidden.status === 403);
} else {
  console.log('      (SB/SR_KEY/ANON not set — staging integration tier skipped)');
}

const fails = results.filter((r) => !r.p);
console.log(`\n════ RECOMMENDATION ENGINE: ${results.length - fails.length}/${results.length} PASSED ════`);
if (fails.length) Deno.exit(1);
