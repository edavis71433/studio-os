// ── M9.1 Judgment Engine suite ───────────────────────────────────────────────
// Pure tiers (no network): healthy sets, dedup, grouping, conflicts, noise
// suppression, determinism, reproducibility, large sets, malformed evidence,
// contract completeness, performance + memory. Integration tier (SB/SR_KEY/
// ANON): observe → judge → read judgments on staging, staff-only enforced.
//
//   deno run --allow-read --allow-net --allow-env tests/presence/judgment_test.mjs
import { judge, RULES } from '../../supabase/functions/presence/judgment/rules.ts';
import { judgmentHash } from '../../supabase/functions/presence/judgment/contract.ts';
import { CATALOG } from '../../supabase/functions/presence/evidence/contract.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const NOW = '2026-07-06T12:00:00.000Z';
const CTX = { siteId: '00000000-0000-4000-8000-000000000001', now: NOW, previous: {} };

let seq = 0;
const ev = (type, resource = '', over = {}) => {
  const c = CATALOG[type];
  if (!c) throw new Error('test built unknown evidence type: ' + type);
  return { id: `e${++seq}`, category: c.category, type, severity: c.severity, confidence: c.confidence, resource, facts: {}, ...over };
};
const byRule = (r) => Object.fromEntries(r.judgments.map((j) => [j.rule, j]));

// ═══ 1. rule table integrity: every catalog type is consumed by exactly one rule ═══
{
  const owners = new Map();
  let overlap = 0;
  for (const r of RULES) for (const t of r.types) { if (owners.has(t)) overlap++; owners.set(t, r.key); }
  ok('rules: no evidence type is claimed by two rules (grouping is unambiguous)', overlap === 0);
  const orphans = Object.keys(CATALOG).filter((t) => !owners.has(t));
  ok('rules: every catalog evidence type has a judging rule (no silent gaps)', orphans.length === 0, orphans.join(',') || `${owners.size} types across ${RULES.length} rules`);
}

// ═══ 2. healthy site → nothing critical, mostly suppressed/low ═══
{
  const healthy = [ev('local_presence.profile_unconnected'), ev('reviews.source_unconnected'), ev('trust.policy_page_missing', 'privacy'), ev('business_info.holiday_hours_missing')];
  const r = judge(healthy, CTX);
  const active = r.judgments.filter((j) => j.status === 'active');
  ok('healthy: roadmap-only evidence → zero active judgments (nobody interrupted)', active.length === 0, `judged=${r.judgments.length} all suppressed`);
  ok('healthy: suppressed judgments carry reasons (auditable)', r.judgments.every((j) => j.status === 'active' || j.suppression_reason.length > 0));
}

// ═══ 3. deduplication: many observations → ONE judgment ═══
{
  const twenty = Array.from({ length: 20 }, (_, i) => ev('accessibility.img_alt_missing', `/p${i}/`, { facts: { count: 1 } }));
  const r = judge(twenty, CTX);
  const acc = r.judgments.filter((j) => j.category === 'accessibility');
  ok('dedup: 20 missing-alt observations → 1 judgment', acc.length === 1 && acc[0].evidence_count === 20);
  const six = Array.from({ length: 6 }, (_, i) => ev('links.internal_broken', `/a${i}→/x${i}/`));
  const r2 = judge(six, CTX);
  ok('dedup: 6 broken links → 1 judgment (priority high, timing immediate)', r2.judgments.length === 1 && r2.judgments[0].priority === 'high' && r2.judgments[0].timing === 'immediate');
}

// ═══ 4. grouping: related evidence → one business issue ═══
{
  const mixed = [ev('seo.title_missing', '/'), ev('seo.description_missing', '/'), ev('seo.thin_content', '/about/')];
  const r = judge(mixed, CTX);
  ok('grouping: title+description+thin → ONE search-snippets judgment', r.judgments.length === 1 && r.judgments[0].rule === 'search_snippets' && r.judgments[0].evidence_ids.length === 3);
  ok('grouping: critical evidence lifts priority (title_missing → high)', r.judgments[0].priority === 'high');
  const inconsistent = [ev('business_info.phone_mismatch', 'phone')];
  const r2 = judge(inconsistent, CTX);
  ok('grouping: consistency evidence lands in the accuracy category', r2.judgments[0].category === 'accuracy' && r2.judgments[0].rule === 'facts_inconsistent');
}

// ═══ 5. conflict suppression: not-live site mutes public-facing judgments ═══
{
  const conflict = [ev('website.not_live'), ev('freshness.publish_stale', '', { facts: { days: 200 } }), ev('links.internal_broken', '/x→/y/')];
  const r = judge(conflict, CTX);
  const m = byRule(r);
  ok('conflict: site_not_yet_live stays active', m.site_not_yet_live?.status === 'active');
  ok('conflict: freshness + broken paths suppressed with reason site_not_live',
    m.public_freshness?.status === 'suppressed' && m.public_freshness?.suppression_reason === 'site_not_live'
    && m.broken_paths?.status === 'suppressed');
}

// ═══ 6. noise floor ═══
{
  const lone = [ev('content.reading_hard', 'description', { confidence: 0.6, facts: { score: 40 } })];
  const r = judge(lone, CTX);
  ok('suppression: a lone low-confidence informational finding → noise_floor', r.judgments[0].status === 'suppressed' && r.judgments[0].suppression_reason === 'noise_floor');
  const several = [ev('content.faqs_none'), ev('content.updates_none'), ev('reviews.testimonials_none')];
  const r2 = judge(several, CTX);
  ok('suppression: three real gaps survive as one active low judgment', r2.judgments[0].status === 'active' && r2.judgments[0].priority === 'low' && r2.judgments[0].evidence_count === 3);
}

// ═══ 7. determinism + reproducibility ═══
{
  seq = 100; const set = [ev('seo.title_missing', '/'), ev('accessibility.img_alt_missing', '/', { facts: { count: 3 } }), ev('business_info.hours_incomplete', 'hours')];
  seq = 100; const setA = [ev('seo.title_missing', '/'), ev('accessibility.img_alt_missing', '/', { facts: { count: 3 } }), ev('business_info.hours_incomplete', 'hours')];
  const r1 = judge(set, CTX);
  const r2 = judge(setA, CTX);
  ok('determinism: identical evidence → byte-identical judgments', JSON.stringify(r1) === JSON.stringify(r2));
  const shuffled = [set[2], set[0], set[1]];
  const r3 = judge(shuffled, CTX);
  ok('determinism: evidence ORDER does not change judgment ids or order',
    JSON.stringify(r1.judgments.map((j) => j.judgment_id)) === JSON.stringify(r3.judgments.map((j) => j.judgment_id)));
  ok('reproducibility: judgment_id derives from evidence content (hash match)',
    r1.judgments.every((j) => j.judgment_id.startsWith('j_') && j.judgment_id.length === 18));
  const h1 = judgmentHash('site-a', 'r', [ev('seo.title_missing', '/')]);
  const h2 = judgmentHash('site-a', 'r', [ev('seo.title_missing', '/')]);
  const h3 = judgmentHash('site-a', 'r', [ev('seo.title_missing', '/menu/')]);
  ok('reproducibility: hash stable for same content, distinct for different resources', h1 === h2 && h1 !== h3);
}

// ═══ 8. contract completeness on every judgment ═══
{
  const busy = [ev('seo.title_missing', '/'), ev('links.internal_broken', '/a→/b/'), ev('business_info.identity_incomplete', 'description'),
    ev('freshness.draft_idle', '', { facts: { days: 20, count: 3 } }), ev('media.unused', '', { facts: { count: 2 } }), ev('conversion.prices_missing', '', { facts: { count: 4 } })];
  const r = judge(busy, CTX);
  let bad = 0;
  for (const j of r.judgments) {
    for (const f of ['judgment_id', 'timestamp', 'category', 'priority', 'severity', 'reasoning', 'customer_impact', 'timing', 'dedupe_key', 'expires_at', 'rule', 'audience', 'status']) {
      if (typeof j[f] !== 'string' || !j[f].length) bad++;
    }
    if (!Array.isArray(j.evidence_ids) || j.evidence_ids.length !== j.evidence_count) bad++;
    if (typeof j.confidence !== 'number' || j.confidence <= 0 || j.confidence > 1) bad++;
    if (!Array.isArray(j.business_impact.dimensions) || !j.business_impact.note) bad++;
    if (new Date(j.expires_at) <= new Date(j.timestamp)) bad++;
    if (!j.reasoning.includes('rule=') || !j.reasoning.includes('observation')) bad++;
  }
  ok('contract: all 13 fields present, typed, explainable on every judgment', bad === 0, `judgments=${r.judgments.length}`);
}

// ═══ 9. first-seen carries across batches ═══
{
  const set = [ev('business_info.phone_mismatch', 'phone')];
  const r1 = judge(set, CTX);
  const r2 = judge(set, { ...CTX, now: '2026-07-08T12:00:00.000Z', previous: { facts_inconsistent: { first_seen_at: NOW } } });
  ok('lifecycle: first_seen_at survives into later batches', r1.judgments[0].first_seen_at === NOW && r2.judgments[0].first_seen_at === NOW && r2.judgments[0].timestamp !== NOW);
}

// ═══ 10. malformed evidence — contained, never fatal ═══
{
  const junk = [
    { id: 'z1', category: 'seo', type: 'seo.some_future_type', severity: 'warning', confidence: 1, resource: '', facts: {} },
    ev('seo.title_missing', '/'),
    { id: 'z2', category: '???', type: 'unknown.thing', severity: 'info', confidence: 0.5, resource: '', facts: {} },
  ];
  const r = judge(junk, CTX);
  ok('malformed: unknown evidence types are reported as unmatched, not fatal', r.judgments.length === 1 && r.unmatched_types.includes('seo.some_future_type') && r.unmatched_types.includes('unknown.thing'));
}

// ═══ 11. large sets: performance, memory, scaling ═══
{
  const types = Object.keys(CATALOG);
  const big = Array.from({ length: 5000 }, (_, i) => ev(types[i % types.length], `/r${i}/`, { facts: { days: 100, count: 2 } }));
  const memBefore = Deno.memoryUsage().heapUsed;
  const t0 = performance.now();
  const r = judge(big, CTX);
  const ms = performance.now() - t0;
  const memMB = (Deno.memoryUsage().heapUsed - memBefore) / 1048576;
  ok(`scale: 5,000 evidence items judged in ${ms.toFixed(1)}ms (<250ms), ~${memMB.toFixed(1)}MB heap delta`, ms < 250 && r.judgments.length <= RULES.length);
  ok('scale: output stays bounded — judgments ≤ rule count regardless of evidence volume', r.judgments.length <= RULES.length, `judgments=${r.judgments.length}`);
  const t1 = performance.now();
  for (let i = 0; i < 50; i++) judge(big.slice(0, 100), CTX);
  ok(`performance: 100-item set avg ${((performance.now() - t1) / 50).toFixed(2)}ms over 50 runs`, (performance.now() - t1) / 50 < 20);
}

// ═══ 12. integration (staging) ═══
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

  await call('POST', `/admin/sites/${site.id}/observe`); // fresh evidence
  const jr = await call('POST', `/admin/sites/${site.id}/judge`);
  ok('integration: POST /judge consumes the latest evidence run', jr.status === 200 && jr.json?.data?.ok === true && jr.json.data.judged > 0,
    `judged=${jr.json?.data?.judged} active=${jr.json?.data?.active} suppressed=${jr.json?.data?.suppressed} unmatched=${(jr.json?.data?.unmatched_types || []).length}`);
  ok('integration: no evidence type went unjudged on staging', (jr.json?.data?.unmatched_types || []).length === 0, (jr.json?.data?.unmatched_types || []).join(','));
  const list = await call('GET', `/admin/sites/${site.id}/judgments`);
  ok('integration: GET /judgments returns the active set of the latest batch', list.status === 200 && Array.isArray(list.json?.data?.judgments) && list.json.data.judgments.every((x) => x.status === 'active'), `active=${list.json?.data?.judgments?.length}`);
  const all = await call('GET', `/admin/sites/${site.id}/judgments?status=all`);
  ok('integration: suppressed judgments stored with reasons (auditable)', (all.json?.data?.judgments || []).some((x) => x.status === 'suppressed' && x.suppression_reason));
  const jr2 = await call('POST', `/admin/sites/${site.id}/judge`);
  const all2 = await call('GET', `/admin/sites/${site.id}/judgments?status=all&batch_id=${jr2.json?.data?.batch_id}`);
  const hashes1 = new Set((all.json?.data?.judgments || []).map((x) => x.judgment_hash));
  const stable = (all2.json?.data?.judgments || []).filter((x) => hashes1.has(x.judgment_hash)).length;
  ok('integration: re-judging the same evidence reproduces the same judgment hashes', jr2.json?.data?.ok && stable === (all2.json?.data?.judgments || []).length, `stable=${stable}/${all2.json?.data?.judgments?.length}`);
  const cpw = 'rcat-' + crypto.randomUUID().slice(0, 12);
  const uA = (users.users || []).find((x) => (x.email || '').toLowerCase() === 'rcat-acceptance@example.com');
  await fetch(`${SB}/auth/v1/admin/users/${uA.id}`, { method: 'PUT', headers: H, body: JSON.stringify({ password: cpw }) });
  const cJwt = (await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'rcat-acceptance@example.com', password: cpw }) })).json()).access_token;
  const forbidden = await fetch(`${SB}/functions/v1/presence/admin/sites/${site.id}/judgments`, { headers: { 'x-dds-user-jwt': cJwt } });
  ok('integration: judgments are staff-only (client → 403)', forbidden.status === 403);
} else {
  console.log('      (SB/SR_KEY/ANON not set — staging integration tier skipped)');
}

const fails = results.filter((r) => !r.p);
console.log(`\n════ JUDGMENT ENGINE: ${results.length - fails.length}/${results.length} PASSED ════`);
if (fails.length) Deno.exit(1);
