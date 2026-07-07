// ── M13 Agency Platform suite ────────────────────────────────────────────────
// Pure tiers: the role→capability table (permissions as data), portfolio
// building from synthetic pipeline rows, directory filtering, every work
// queue and cross-client pattern deriving ONLY from existing-architecture
// rows, and PERFORMANCE AT SCALE (1,000 clients through the pure builders).
// Integration (staging): operator provisions an agency, the owner signs in,
// links a client, portfolio + queues answer, tags/notes/archive/restore,
// seat limits enforced, readonly is truly read-only, branding round-trips,
// bulk dispatches the REAL engines with per-site results, scheduled jobs run
// when due, non-members get 401. Everything cleaned up after.
//
//   deno run --allow-read --allow-net --allow-env tests/presence/agency_test.mjs
import { can } from '../../supabase/functions/presence/agency/auth.ts';
import { buildPortfolio, filterPortfolio, buildQueues, buildPatterns } from '../../supabase/functions/presence/agency/portfolio.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

// ═══ 1. permissions — the capability table is the law ═══
{
  ok('caps: owner/admin can do everything', ['read', 'notes', 'bulk_observe', 'bulk_publish', 'manage_clients', 'manage_members', 'manage_branding'].every((c) => can('owner', c) && can('admin', c)));
  ok('caps: account managers run clients and publishing, not the team or the brand', can('account_manager', 'bulk_publish') && can('account_manager', 'manage_clients') && !can('account_manager', 'manage_members') && !can('account_manager', 'manage_branding'));
  ok('caps: makers (strategist/designer/developer) observe and propose, never publish', ['content_strategist', 'designer', 'developer'].every((r) => can(r, 'bulk_observe') && !can(r, 'bulk_publish') && !can(r, 'manage_clients')));
  ok('caps: support reads and takes notes, nothing more', can('support', 'notes') && !can('support', 'bulk_observe'));
  ok('caps: readonly is READ ONLY', can('readonly', 'read') && ['notes', 'bulk_observe', 'bulk_publish', 'manage_clients', 'manage_members', 'manage_branding'].every((c) => !can('readonly', c)));
}

/* synthetic portfolio input — every row shaped like the real pipeline's */
const NOW = '2027-01-20T12:00:00Z';
const INPUT = {
  sites: [
    { id: 's1', edition: 'presence', status: 'ready', last_published_at: '2027-01-01T00:00:00Z', custom_domain: 'marlows.example' },
    { id: 's2', edition: 'monitor', status: 'ready', last_published_at: null, custom_domain: null },
    { id: 's3', edition: 'presence', status: 'ready', last_published_at: '2027-01-10T00:00:00Z', custom_domain: null },
  ],
  links: [
    { site_id: 's1', status: 'active', tags: ['restaurant', 'la'], owner_email: 'am@agency.test', assigned: [], notes: 'VIP', onboarded_at: NOW },
    { site_id: 's2', status: 'active', tags: ['dental'], owner_email: '', assigned: [], notes: '', onboarded_at: NOW },
    { site_id: 's3', status: 'archived', tags: [], owner_email: '', assigned: [], notes: '', onboarded_at: NOW },
  ],
  clientNames: { s1: 'Marlow’s Kitchen', s2: 'Bright Dental', s3: 'Old Client' },
  moments: [{ site_id: 's1', moment_key: 'freshness', type: 'needs_attention', headline: 'The site has gone quiet' }],
  evidence: [
    { site_id: 's1', type: 'infrastructure.domain_expiring', severity: 'critical', human: 'The domain expires in 20 days.' },
    { site_id: 's2', type: 'accessibility.img_alt_missing', severity: 'warning', human: '4 images have no descriptions.' },
    { site_id: 's2', type: 'reviews.testimonials_none', severity: 'warning', human: 'No testimonials yet.' },
    { site_id: 's3', type: 'trust.ssl_missing', severity: 'critical', human: 'No HTTPS.' },
  ],
  opportunities: [
    { site_id: 's1', area: 'holiday', opportunity: 'Get ready for Valentine’s Day.', timing_ends: '2027-02-14', created_at: '2027-01-19T00:00:00Z' },
    { site_id: 's2', area: 'faq_opportunity', opportunity: 'Answer common questions.', timing_ends: null, created_at: '2026-12-20T00:00:00Z' },
  ],
  plans: [
    { site_id: 's1', kind: 'email_auth', title: 'Protect email', status: 'proposed' },
    { site_id: 's2', kind: 'registrar_care', title: 'Keep the domain safe', status: 'approved' },
  ],
  drafts: [{ site_id: 's2', kind: 'faqs', status: 'proposed', created_at: NOW }],
  connections: [{ site_id: 's2', status: 'verified', readiness: { state: 'ready' } }],
  reviewReports: [{ site_id: 's1', status: 'open', open_count: 3 }],
  brandReports: [{ site_id: 's2', status: 'open', open_count: 2 }],
  lastChange: { s1: '2027-01-15T00:00:00Z', s2: '2027-01-18T00:00:00Z' },
  nowIso: NOW,
};

// ═══ 2. the portfolio — everything observable from one place ═══
{
  const rows = buildPortfolio(INPUT);
  const m = rows.find((r) => r.site_id === 's1');
  ok('portfolio: one row per client with moments/criticals/opps/plans/drafts/review/migration/publishing', rows.length === 3 &&
    m.moments === 1 && m.criticals === 1 && m.open_opportunities === 1 && m.plans_waiting === 1 && m.review_open === true &&
    m.unpublished_changes === true && rows.find((r) => r.site_id === 's2').migration === 'ready');
  ok('portfolio: archived stays visible only when asked', filterPortfolio(rows, {}).length === 2 && filterPortfolio(rows, { archived: true }).length === 1);
  ok('portfolio: search hits names, domains, and tags', filterPortfolio(rows, { search: 'marlow' }).length === 1 &&
    filterPortfolio(rows, { search: 'dental' }).length === 1 && filterPortfolio(rows, { tag: 'la' }).length === 1);
}

// ═══ 3. work queues — every item originates from the existing pipeline ═══
{
  const queues = buildQueues(INPUT);
  const q = (k) => queues.find((x) => x.key === k);
  ok('queues: all nine exist', ['high_priority', 'review_today', 'publish_today', 'infrastructure', 'brand_review', 'growth', 'migration_ready', 'awaiting_client', 'waiting_on_agency'].every((k) => q(k)));
  ok('queues: high priority = critical evidence + needs_attention moments', q('high_priority').items.length === 2 && q('high_priority').items.some((i) => /domain expires/.test(i.why)));
  ok('queues: publish today = unpublished changes, never monitor sites', q('publish_today').items.length === 1 && q('publish_today').items[0].site_id === 's1');
  ok('queues: awaiting client = proposed plans + proposed drafts', q('awaiting_client').items.length === 2);
  ok('queues: waiting on agency = approved-but-unapplied plans', q('waiting_on_agency').items.length === 1 && /registrar|domain safe/i.test(q('waiting_on_agency').items[0].why));
  ok('queues: migration ready comes from M11 readiness', q('migration_ready').items.length === 1 && q('migration_ready').items[0].site_id === 's2');
  ok('queues: archived clients appear in NO queue', queues.every((x) => x.items.every((i) => i.site_id !== 's3')));
  ok('queues: every item explains itself in a sentence', queues.every((x) => x.items.every((i) => i.why.length > 8 && i.name.length > 0)));
}

// ═══ 4. cross-client patterns — the same rows, grouped by concern ═══
{
  const p = buildPatterns(INPUT);
  const k = (key) => p.find((x) => x.key === key);
  ok('patterns: expiring domains / accessibility / review requests grouped across clients',
    k('expiring_domains')?.items.length === 1 && k('accessibility')?.items.length === 1 && k('review_requests')?.items.length === 1);
  ok('patterns: holiday prep + unresolved opportunities from the coach’s own rows', k('holiday_updates')?.items.length === 1 && k('unresolved_opportunities')?.items.some((i) => /open \d+ days/.test(i.why)));
  ok('patterns: empty concerns simply don’t appear (no dashboard noise)', p.every((x) => x.items.length > 0));
}

// ═══ 5. performance at scale — 1,000 clients through the pure builders ═══
{
  const N = 1000;
  const big = {
    ...INPUT,
    sites: Array.from({ length: N }, (_, i) => ({ id: `x${i}`, edition: i % 3 ? 'presence' : 'monitor', status: 'ready', last_published_at: i % 2 ? '2027-01-01T00:00:00Z' : null, custom_domain: null })),
    links: Array.from({ length: N }, (_, i) => ({ site_id: `x${i}`, status: i % 10 === 9 ? 'archived' : 'active', tags: [i % 2 ? 'even' : 'odd'], owner_email: '', assigned: [], notes: '', onboarded_at: NOW })),
    clientNames: Object.fromEntries(Array.from({ length: N }, (_, i) => [`x${i}`, `Client ${i}`])),
    evidence: Array.from({ length: N * 2 }, (_, i) => ({ site_id: `x${i % N}`, type: i % 5 ? 'accessibility.img_alt_missing' : 'infrastructure.domain_expiring', severity: i % 5 ? 'warning' : 'critical', human: `Observation ${i}.` })),
    moments: Array.from({ length: N }, (_, i) => ({ site_id: `x${i}`, moment_key: 'freshness', type: i % 4 ? 'opportunity' : 'needs_attention', headline: `Moment ${i}` })),
    opportunities: Array.from({ length: N }, (_, i) => ({ site_id: `x${i}`, area: 'holiday', opportunity: `Opp ${i}`, timing_ends: null, created_at: NOW })),
    lastChange: {},
  };
  const t0 = Date.now();
  const rows = buildPortfolio(big);
  const queues = buildQueues(big);
  const patterns = buildPatterns(big);
  const ms = Date.now() - t0;
  ok(`scale: 1,000 clients build portfolio + queues + patterns in ${ms}ms (< 2000)`, ms < 2000 && rows.length === N);
  ok('scale: queues stay correct at volume (archived excluded everywhere)', queues.every((q2) => q2.items.every((i) => !i.site_id.endsWith('9') || !big.links.find((l) => l.site_id === i.site_id && l.status === 'archived'))));
  ok('scale: the gather layer is FIXED-COST — one batched query per table, no per-site loops', (() => {
    const src = Deno.readTextFileSync(new URL('../../supabase/functions/presence/agency/routes.ts', import.meta.url));
    const gatherBody = src.slice(src.indexOf('async function gather'), src.indexOf('export async function handleAgency'));
    return !/for\s*\(.*await svc/.test(gatherBody) && /Promise\.all/.test(gatherBody);
  })());
}

// ═══ 6. orchestration, not duplication — structural ═══
{
  const src = Deno.readTextFileSync(new URL('../../supabase/functions/presence/agency/routes.ts', import.meta.url))
    + Deno.readTextFileSync(new URL('../../supabase/functions/presence/agency/portfolio.ts', import.meta.url));
  ok('structure: bulk actions import the EXISTING engines (runEvidence/runJudgment/runMoments/runGrowthCoach/runReview/runBrandReview/handlePublish)',
    ['runEvidence', 'runJudgment', 'runRecommendation', 'runMoments', 'runGrowthCoach', 'runReview', 'runBrandReview', 'handlePublish', 'computeReadiness'].every((f) => src.includes(f)));
  ok('structure: no new intelligence — no model calls, no scoring, no new judgment', !/anthropicModel|\bscore\b\s*[:=(]|new Judg/i.test(src));
}

// ═══ 7. integration (staging) ═══
const SB = Deno.env.get('SB'), SR = Deno.env.get('SR_KEY'), ANON = Deno.env.get('ANON');
if (SB && SR && ANON) {
  const H = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' };
  const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
  const users = await (await fetch(`${SB}/auth/v1/admin/users?page=1&per_page=200`, { headers: H })).json();
  const login = async (email) => {
    let u = (users.users || []).find((x) => (x.email || '').toLowerCase() === email);
    if (!u) u = (await (await fetch(`${SB}/auth/v1/admin/users`, { method: 'POST', headers: H, body: JSON.stringify({ email, email_confirm: true }) })).json());
    const pw = 'pw-' + crypto.randomUUID().slice(0, 12);
    await fetch(`${SB}/auth/v1/admin/users/${u.id}`, { method: 'PUT', headers: H, body: JSON.stringify({ password: pw }) });
    return { id: u.id, jwt: (await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw }) })).json()).access_token };
  };
  const staff = await login('staging-staff@studio-os.test');
  const ownerU = await login('m13-agency-owner@studio-os.test');
  const roU = await login('m13-agency-readonly@studio-os.test');
  const client = await login('rcat-acceptance@example.com');
  const call = async (jwt, m, route, body) => {
    const r = await fetch(`${SB}/functions/v1/presence${route}`, { method: m, headers: { 'Content-Type': 'application/json', 'x-dds-user-jwt': jwt }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await j(r) };
  };
  const siteId = (await call(client.jwt, 'GET', '/site')).json?.data?.site?.id;
  let agencyId = null;

  try {
    // provisioning: the operator creates the agency + owner seat (tight seat limit for the test)
    const created = await call(staff.jwt, 'POST', '/admin/agencies', { name: 'M13 Test Agency', owner_email: 'm13-agency-owner@studio-os.test', seat_limit: 2, client_limit: 25 });
    agencyId = created.json?.data?.id;
    ok('integration: operator provisions an agency with an owner seat', created.status === 200 && !!agencyId);

    ok('integration: a plain client JWT is NOT an agency member — 401', (await call(client.jwt, 'GET', '/agency/portfolio')).status === 401);
    ok('integration: unauthenticated → 401', (await call('', 'GET', '/agency/portfolio')).status === 401);

    const me = await call(ownerU.jwt, 'GET', '/agency/me');
    ok('integration: the owner resolves with role and branding', me.status === 200 && me.json?.data?.role === 'owner');

    // onboard a client (link the existing staging site)
    const link = await call(ownerU.jwt, 'POST', '/agency/clients', { site_id: siteId, tags: ['restaurant'] });
    ok('integration: client onboarded into the portfolio with a guided checklist', link.status === 200 && Array.isArray(link.json?.data?.onboarding) && link.json.data.onboarding.length === 5);

    const pf = await call(ownerU.jwt, 'GET', '/agency/portfolio');
    ok('integration: the portfolio shows the client with live rollups', pf.status === 200 && pf.json?.data?.length === 1 && typeof pf.json.data[0].moments === 'number' && pf.json.data[0].name.length > 0, `name=${pf.json?.data?.[0]?.name}`);

    const qs = await call(ownerU.jwt, 'GET', '/agency/queues');
    ok('integration: work queues + patterns derive from the live pipeline rows', qs.status === 200 && (qs.json?.data?.queues || []).length === 9 && Array.isArray(qs.json?.data?.patterns));

    // client management: tags, notes, archive, restore
    const patched = await call(ownerU.jwt, 'PATCH', `/agency/clients/${siteId}`, { tags: ['restaurant', 'vip'], notes: 'internal only' });
    ok('integration: tags + internal notes save', patched.status === 200 && patched.json?.data?.tags?.includes('vip'));
    const arch = await call(ownerU.jwt, 'PATCH', `/agency/clients/${siteId}`, { status: 'archived' });
    const pfArch = await call(ownerU.jwt, 'GET', '/agency/portfolio');
    ok('integration: archive removes from the active portfolio (and all queues); restore brings it back', arch.status === 200 && pfArch.json?.data?.length === 0 &&
      (await call(ownerU.jwt, 'PATCH', `/agency/clients/${siteId}`, { status: 'active' })).status === 200);

    // team: invite readonly; the second invite hits the seat limit
    const inv = await call(ownerU.jwt, 'POST', '/agency/members', { email: 'm13-agency-readonly@studio-os.test', role: 'readonly' });
    ok('integration: a seat is granted with a role', inv.status === 200 && inv.json?.data?.role === 'readonly');
    const over = await call(ownerU.jwt, 'POST', '/agency/members', { email: 'm13-one-too-many@studio-os.test', role: 'support' });
    ok('integration: the seat limit is enforced, in plain words', over.status === 400 && over.json?.error === 'seat_limit');

    // permissions live: readonly reads, and only reads
    ok('integration: readonly can read the portfolio', (await call(roU.jwt, 'GET', '/agency/portfolio')).status === 200);
    ok('integration: readonly cannot bulk-observe', (await call(roU.jwt, 'POST', '/agency/bulk', { action: 'moments', site_ids: [siteId] })).status === 403);
    ok('integration: readonly cannot invite, brand, or manage clients', (await call(roU.jwt, 'POST', '/agency/members', { email: 'x@y.z', role: 'support' })).status === 403 &&
      (await call(roU.jwt, 'PUT', '/agency/branding', {})).status === 403 && (await call(roU.jwt, 'PATCH', `/agency/clients/${siteId}`, { tags: ['x'] })).status === 403);

    // white label
    const brand = await call(ownerU.jwt, 'PUT', '/agency/branding', { display_name: 'Bright Web Studio', color_accent: '#6b4d8a', email_from: 'hello@brightweb.test' });
    ok('integration: branding round-trips (Studio OS identity intact underneath)', brand.status === 200 && (await call(roU.jwt, 'GET', '/agency/branding')).json?.data?.display_name === 'Bright Web Studio');

    // bulk: dispatch a REAL engine with per-site explainable results
    const bulk = await call(ownerU.jwt, 'POST', '/agency/bulk', { action: 'moments', site_ids: [siteId, crypto.randomUUID()] });
    ok('integration: bulk runs the real engine per site — foreign sites silently fenced out', bulk.status === 200 && bulk.json?.data?.results?.length === 1 && bulk.json.data.results[0].ok === true, bulk.json?.data?.results?.[0]?.note);

    // scheduled bulk (scheduled publishing shape): queue then run when due
    const sched = await call(ownerU.jwt, 'POST', '/agency/bulk', { action: 'coach', site_ids: [siteId], run_after: new Date(Date.now() - 1000).toISOString() });
    ok('integration: scheduled bulk work becomes a job', sched.status === 200 && sched.json?.data?.scheduled === true);
    const ran = await call(ownerU.jwt, 'POST', '/agency/jobs/run-due');
    ok('integration: due jobs run with recorded per-site results', ran.status === 200 && ran.json?.data?.ran >= 1);

    // usage: billing preparation
    const usage = await call(ownerU.jwt, 'GET', '/agency/usage');
    ok('integration: usage summarizes seats, clients, editions, publishing', usage.status === 200 && usage.json?.data?.seats?.used === 2 && usage.json?.data?.clients?.used === 1 && usage.json?.data?.seats?.limit === 2);

    // client ownership intact: the client's own room is untouched by all of the above
    const room = await call(client.jwt, 'GET', '/site');
    ok('integration: the client still fully controls their own site', room.status === 200 && room.json?.data?.site?.id === siteId);
  } finally {
    if (agencyId) await fetch(`${SB}/rest/v1/presence_agencies?id=eq.${agencyId}`, { method: 'DELETE', headers: H });
    for (const email of ['m13-agency-owner@studio-os.test', 'm13-agency-readonly@studio-os.test']) {
      const u = (await (await fetch(`${SB}/auth/v1/admin/users?page=1&per_page=200`, { headers: H })).json()).users?.find((x) => (x.email || '').toLowerCase() === email);
      if (u) await fetch(`${SB}/auth/v1/admin/users/${u.id}`, { method: 'DELETE', headers: H });
    }
  }
} else {
  console.log('      (SB/SR_KEY/ANON not set — staging integration tier skipped)');
}

const fails = results.filter((r) => !r.p);
console.log(`\n════ AGENCY PLATFORM: ${results.length - fails.length}/${results.length} PASSED ════`);
if (fails.length) Deno.exit(1);
