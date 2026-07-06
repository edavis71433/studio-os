// ── M9.3 Business Moments suite ──────────────────────────────────────────────
// Pure tiers: template coverage, healthy/busy businesses, the three-moment
// law, the ladder, merging, dismissal memory (all three resurface conditions),
// tone lint, no-priority-exposure, determinism, performance. Integration tier
// (SB/SR_KEY/ANON): full chain observe → judge → recommend → moments on
// staging; client reads ≤3 safe moments and dismisses one; memory holds.
//
//   deno run --allow-read --allow-net --allow-env tests/presence/moments_test.mjs
import { momentize, TEMPLATES, DISMISSAL_TTL_DAYS } from '../../supabase/functions/presence/moments/rules.ts';
import { clientView } from '../../supabase/functions/presence/moments/contract.ts';
import { RULES as JUDGMENT_RULES } from '../../supabase/functions/presence/judgment/rules.ts';
import { REC_RULES } from '../../supabase/functions/presence/recommendation/rules.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const NOW = '2026-07-06T12:00:00.000Z';
const CTX = () => ({ siteId: '00000000-0000-4000-8000-000000000001', now: NOW, previous: {}, dismissals: {} });

let n = 0;
const rec = (rule, priority = 'medium', dims = ['business_accuracy'], over = {}) => ({
  recommendation_hash: `r_${rule}_${++n}`, rule: `rec_${rule}`, priority, audience: 'customer',
  status: 'active', value_dimensions: dims, timing: 'soon', expires_at: '2026-08-01T00:00:00.000Z', ...over,
});
const active = (r) => r.moments.filter((m) => m.status === 'active');

// ═══ 1. template coverage: every customer-audience recommendation translates ═══
{
  const audience = new Map(JUDGMENT_RULES.map((j) => [j.key, j.audience]));
  const customerRecs = REC_RULES.filter((r) => audience.get(r.judgmentRule) === 'customer');
  const covered = new Set(TEMPLATES.map((t) => t.recRule));
  const gaps = customerRecs.filter((r) => !covered.has('rec_' + r.judgmentRule));
  ok('coverage: every customer recommendation rule has a moment template', gaps.length === 0,
    gaps.map((g) => g.judgmentRule).join(',') || `${TEMPLATES.length} templates / ${customerRecs.length} customer rec rules`);
  const operatorLeaks = TEMPLATES.filter((t) => audience.get(t.recRule.replace(/^rec_/, '')) !== 'customer');
  ok('coverage: no template exists for operator concerns (they never reach customers)', operatorLeaks.length === 0);
}

// ═══ 2. tone lint: merchant words only, calm, never blaming ═══
{
  const denylist = /\b(SEO|schema|metadata|canonical|HTML|CSS|API|URL|error|failure|failed|broken|invalid|critical|urgent|immediately|ASAP|click here|buy now|upgrade)\b|!|✦|⚠/i;
  const blame = /\b(you failed|you forgot|you should have|your mistake|neglect)\b/i;
  let bad = [];
  const busy = TEMPLATES.map((t) => rec(t.recRule.replace(/^rec_/, '')));
  const out = momentize(busy, CTX());
  const texts = [
    ...TEMPLATES.flatMap((t) => [t.headline, t.summary]),
    ...out.moments.flatMap((m) => [m.headline, m.summary]),
  ];
  for (const s of texts) if (denylist.test(s) || blame.test(s)) bad.push(s.slice(0, 50));
  ok('tone: no engineering words, no alarm, no exclamation, no blame — templates AND generated output', bad.length === 0, bad.join(' | '));
}

// ═══ 3. healthy business → one calm good-news moment ═══
{
  const r = momentize([], CTX());
  const a = active(r);
  ok('healthy: zero recommendations → exactly one good-news moment', a.length === 1 && a[0].moment_type === 'good_news' && a[0].deduplication_key === 'all_well');
  ok('healthy: the good-news moment is not dismissable and expires quickly', a[0].dismissable === false && (new Date(a[0].expires_at) - new Date(NOW)) / 86400000 <= 2);
  ok('healthy: it reads like the constitution wrote it', a[0].headline === 'Everything customers can see is current.');
}

// ═══ 4. the three-moment law + merging ═══
{
  const busy = TEMPLATES.map((t) => rec(t.recRule.replace(/^rec_/, ''), 'medium'));
  const r = momentize(busy, CTX());
  const a = active(r);
  ok('three-moment law: 11 customer recommendations → at most 3 moments', a.length <= 3, `active=${a.length}`);
  const bundle = a.find((m) => m.deduplication_key === 'improvements_bundle');
  ok('merging: crowded opportunities fold into ONE bundle moment', !!bundle && bundle.supporting_recommendation_ids.length >= 4, `bundled=${bundle?.supporting_recommendation_ids.length}`);
  ok('merging: the bundle lists concerns in plain words', !!bundle && / and /.test(bundle.summary) && !/rec_/.test(bundle.summary));
  ok('audit: every active moment traces to recommendation hashes', a.every((m) => m.deduplication_key === 'all_well' || m.supporting_recommendation_ids.length > 0));
}

// ═══ 5. the ladder: urgent business issues take the seats ═══
{
  const mix = [
    rec('business_facts_incomplete', 'high', ['business_accuracy', 'trust']),
    rec('closed_flag_stale', 'high', ['business_accuracy', 'conversion']),
    rec('draft_waiting', 'medium', ['business_accuracy']),
    rec('search_snippets', 'medium', ['search_visibility']),
    rec('content_depth', 'low', ['trust', 'search_visibility']),
    rec('conversion_paths', 'low', ['conversion']),
  ];
  const r = momentize(mix, CTX());
  const a = active(r);
  const keys = a.map((m) => m.deduplication_key);
  ok('ladder: accuracy/trust issues outrank growth opportunities', keys.includes('missing_basics') && keys.includes('closed_notice'), keys.join(','));
  ok('ladder: opportunities merge to fit the last seat', keys.includes('improvements_bundle') || keys.includes('draft_waiting'), keys.join(','));
  ok('ladder: no good-news moment on a day with real concerns', !keys.includes('all_well'));
}

// ═══ 6. dismissal memory — all three resurface conditions ═══
{
  const one = [rec('facts_inconsistent', 'medium', ['business_accuracy'], { recommendation_hash: 'r_stable' })];
  const first = momentize(one, CTX());
  const m0 = active(first)[0];
  // same fact, remembered dismissal → suppressed
  const dismissed = { [m0.deduplication_key]: { moment_hash: m0.moment_id, importance: m0.importance, dismissed_at: NOW } };
  const again = momentize(one, { ...CTX(), now: '2026-07-10T12:00:00.000Z', dismissals: dismissed });
  const sup = again.moments.find((m) => m.deduplication_key === m0.deduplication_key);
  ok('memory: a dismissed moment stays gone for the same facts', sup?.status === 'suppressed' && sup?.suppression_reason === 'dismissed_remembered');
  ok('memory: suppressed moments carry a future follow-up date', !!sup?.future_follow_up);
  // (a) new evidence: different supporting hash → resurfaces
  const changed = [rec('facts_inconsistent', 'medium', ['business_accuracy'], { recommendation_hash: 'r_changed' })];
  const r2 = momentize(changed, { ...CTX(), now: '2026-07-10T12:00:00.000Z', dismissals: dismissed });
  ok('memory: NEW EVIDENCE (changed hash) resurfaces the moment', active(r2).some((m) => m.deduplication_key === m0.deduplication_key));
  // (b) materially worse: higher importance → resurfaces
  const worse = [rec('facts_inconsistent', 'critical', ['business_accuracy', 'trust'], { recommendation_hash: 'r_stable' })];
  const r3 = momentize(worse, { ...CTX(), now: '2026-07-10T12:00:00.000Z', dismissals: dismissed });
  ok('memory: a MATERIALLY WORSE concern resurfaces despite dismissal', active(r3).some((m) => m.deduplication_key === m0.deduplication_key));
  // (c) dismissal expiry
  const old = { [m0.deduplication_key]: { moment_hash: m0.moment_id, importance: m0.importance, dismissed_at: '2026-05-01T00:00:00.000Z' } };
  const r4 = momentize(one, { ...CTX(), now: NOW, dismissals: old });
  ok(`memory: dismissal ages out after ${DISMISSAL_TTL_DAYS} days`, active(r4).some((m) => m.deduplication_key === m0.deduplication_key));
}

// ═══ 7. input hygiene ═══
{
  const bad = [
    rec('search_snippets', 'medium', ['search_visibility'], { audience: 'operator' }),
    rec('search_snippets', 'medium', ['search_visibility'], { status: 'suppressed' }),
    rec('search_snippets', 'medium', ['search_visibility'], { expires_at: '2026-07-01T00:00:00.000Z' }),
  ];
  const r = momentize(bad, CTX());
  ok('hygiene: operator/suppressed/expired recommendations never become moments', active(r).length === 1 && active(r)[0].deduplication_key === 'all_well');
}

// ═══ 8. the customer view exposes no internals ═══
{
  const r = momentize([rec('business_facts_incomplete', 'high', ['business_accuracy'])], CTX());
  const m = active(r)[0];
  const view = clientView({ id: 'x', moment_type: m.moment_type, headline: m.headline, summary: m.summary, tone: m.tone, dismissable: m.dismissable, created_at: NOW });
  const keys = Object.keys(view);
  ok('exposure: client view carries no importance, priority, rule, or recommendation ids',
    !keys.some((k) => ['importance', 'priority', 'rule', 'supporting_recommendation_ids', 'moment_key', 'expires_at'].includes(k)),
    keys.join(','));
}

// ═══ 9. determinism + reproducibility ═══
{
  n = 900; const a1 = [rec('search_snippets'), rec('media_quality'), rec('content_depth'), rec('business_facts_incomplete', 'high')];
  n = 900; const a2 = [rec('search_snippets'), rec('media_quality'), rec('content_depth'), rec('business_facts_incomplete', 'high')];
  const r1 = momentize(a1, CTX());
  const r2 = momentize(a2, CTX());
  ok('determinism: identical recommendations → byte-identical moments', JSON.stringify(r1) === JSON.stringify(r2));
  const r3 = momentize([...a1].reverse(), CTX());
  ok('determinism: input order does not change moment ids or seating',
    JSON.stringify(r1.moments.map((m) => m.moment_id)) === JSON.stringify(r3.moments.map((m) => m.moment_id)));
}

// ═══ 10. performance ═══
{
  const busy = TEMPLATES.map((t) => rec(t.recRule.replace(/^rec_/, '')));
  const t0 = performance.now();
  for (let i = 0; i < 500; i++) momentize(busy, CTX());
  const avg = (performance.now() - t0) / 500;
  ok(`performance: avg ${avg.toFixed(3)}ms per pass over 500 runs (<5ms)`, avg < 5);
}

// ═══ 11. integration (staging): the full chain, then a real dismissal ═══
const SB = Deno.env.get('SB'), SR = Deno.env.get('SR_KEY'), ANON = Deno.env.get('ANON');
if (SB && SR && ANON) {
  const H = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' };
  const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
  const users = await (await fetch(`${SB}/auth/v1/admin/users?page=1&per_page=200`, { headers: H })).json();
  const login = async (email) => {
    const u = (users.users || []).find((x) => (x.email || '').toLowerCase() === email);
    const pw = 'pw-' + crypto.randomUUID().slice(0, 12);
    await fetch(`${SB}/auth/v1/admin/users/${u.id}`, { method: 'PUT', headers: H, body: JSON.stringify({ password: pw }) });
    return (await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw }) })).json()).access_token;
  };
  const staffJwt = await login('staging-staff@studio-os.test');
  const clientJwt = await login('rcat-acceptance@example.com');
  const call = async (m, route, jwt) => {
    const r = await fetch(`${SB}/functions/v1/presence${route}`, { method: m, headers: { 'Content-Type': 'application/json', 'x-dds-user-jwt': jwt } });
    return { status: r.status, json: await j(r) };
  };
  const cA = (await j(await fetch(`${SB}/rest/v1/clients?email=eq.rcat-acceptance%40example.com&select=id`, { headers: H })))[0];
  const site = (await j(await fetch(`${SB}/rest/v1/presence_sites?client_id=eq.${cA.id}&select=id`, { headers: H })))[0];

  await call('POST', `/admin/sites/${site.id}/observe`, staffJwt);
  await call('POST', `/admin/sites/${site.id}/judge`, staffJwt);
  await call('POST', `/admin/sites/${site.id}/recommend`, staffJwt);
  const gen = await call('POST', `/admin/sites/${site.id}/moments-generate`, staffJwt);
  ok('integration: full chain generates moments', gen.status === 200 && gen.json?.data?.ok === true && gen.json.data.active >= 1 && gen.json.data.active <= 3,
    `active=${gen.json?.data?.active} suppressed=${gen.json?.data?.suppressed} untranslated=${(gen.json?.data?.untranslated_rules || []).length}`);
  ok('integration: no customer recommendation went untranslated', (gen.json?.data?.untranslated_rules || []).length === 0, (gen.json?.data?.untranslated_rules || []).join(','));

  const cm = await call('GET', '/moments', clientJwt);
  ok('integration: client reads ≤3 calm moments', cm.status === 200 && Array.isArray(cm.json?.data) && cm.json.data.length >= 1 && cm.json.data.length <= 3, `n=${cm.json?.data?.length} · “${cm.json?.data?.[0]?.headline}”`);
  const leak = (cm.json?.data || []).some((m) => 'importance' in m || 'priority' in m || 'supporting_recommendation_ids' in m || 'moment_key' in m);
  ok('integration: customer payload exposes no priorities or internals', !leak, Object.keys(cm.json?.data?.[0] || {}).join(','));

  const dismissable = (cm.json?.data || []).find((m) => m.dismissable);
  if (dismissable) {
    const d = await call('POST', `/moments/${dismissable.id}/dismiss`, clientJwt);
    ok('integration: client dismissal recorded', d.status === 200);
    await call('POST', `/admin/sites/${site.id}/moments-generate`, staffJwt);
    const cm2 = await call('GET', '/moments', clientJwt);
    const back = (cm2.json?.data || []).some((m) => m.headline === dismissable.headline);
    ok('integration: dismissal memory holds across regeneration (same facts stay gone)', !back, (cm2.json?.data || []).map((m) => m.headline).join(' | '));
  } else {
    console.log('      (no dismissable moment this run — dismissal path covered by pure tiers)');
  }
} else {
  console.log('      (SB/SR_KEY/ANON not set — staging integration tier skipped)');
}

const fails = results.filter((r) => !r.p);
console.log(`\n════ BUSINESS MOMENTS: ${results.length - fails.length}/${results.length} PASSED ════`);
if (fails.length) Deno.exit(1);
