// ── Builder list item 210: what each client uses ──────────────────────────────────
// Review file 03, findings 1, 6 and 11. GET /agency/usage: per client, the publishes that
// went up this month and what they cost at Netlify (a restore is one too), the ones
// skipped because nothing had changed (item 208), the storage their files take, and last
// month's visits; the month's totals and the publishes on each day; a word when one site
// went up many times inside an hour.
//
//   deno run --allow-read --allow-env --allow-net tests/presence/usage_per_client_210_test.mjs
import { installFakePostgrest } from './fake_pgrst.mjs';

const db = installFakePostgrest({ users: { 'jwt-eric': { id: 'u-eric', email: 'eric@studio.example' } } });
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const quiet = async (fn) => { const e = console.error, w = console.warn; console.error = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.error = e; console.warn = w; } };

const U = await import('../../supabase/functions/presence/agency/usage.ts');
const { usageMonth, burstOf, foldUsage, handleUsage, PUBLISH_COST_CENTS, PLAN_PUBLISHES, BURST_AT } = U;

// ═══ 1. the pure parts ═══
{
  const m = usageMonth(null, '2026-11-12T15:00:00Z');
  ok('month: this one by default, start to start of the next', m.month === '2026-11' && m.startIso === '2026-11-01T00:00:00.000Z' && m.endIso === '2026-12-01T00:00:00.000Z' && m.label === 'November');
  const d = usageMonth('2026-12', '2026-11-12T15:00:00Z');
  ok('month: one asked for, and a bad one is this one', d.endIso === '2027-01-01T00:00:00.000Z' && usageMonth('2026-13', '2026-11-12T15:00:00Z').month === '2026-11');
  const t = (h, m) => `2026-11-09T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`;
  ok('burst: eight in under an hour is named, with its day', JSON.stringify(burstOf([t(10, 0), t(10, 5), t(10, 9), t(10, 20), t(10, 31), t(10, 40), t(10, 51), t(10, 59), t(14, 0)])) === JSON.stringify({ count: 8, day: '2026-11-09' }));
  ok(`burst: fewer than ${BURST_AT} in any hour is nothing`, burstOf([t(10, 0), t(10, 5), t(10, 9), t(10, 20), t(11, 30), t(12, 40)]) === null);
  ok('the cost and the plan: about 10 cents a publish, about 330 a month', PUBLISH_COST_CENTS === 10 && PLAN_PUBLISHES === 330);

  const pub = (site, kind, at, extra = {}) => ({ site_id: site, kind, status: 'live', netlify_deploy_id: 'dep-' + at, created_at: at, ...extra });
  const out = foldUsage({
    sites: [
      { id: 's1', edition: 'presence', status: 'live', last_published_at: '2026-11-09T10:00:00Z' },
      { id: 's2', edition: 'monitor', status: 'ready', last_published_at: null },
      { id: 's3', edition: 'presence', status: 'ready', last_published_at: null },
    ],
    publishes: [
      pub('s1', 'publish', '2026-11-02T09:00:00Z'), pub('s1', 'restore', '2026-11-03T09:00:00Z'),
      pub('s1', 'publish', '2026-11-04T09:00:00Z', { unchanged: true }),           // nothing changed: sent nothing
      pub('s1', 'publish', '2026-11-05T09:00:00Z', { status: 'failed' }),           // reached the host, failed there: paid all the same
      pub('s1', 'publish', '2026-11-06T09:00:00Z', { status: 'failed', netlify_deploy_id: null }),   // never reached the host
    ],
    storage: new Map([['s1', { bytes: 340e6, files: 120 }], ['s3', { bytes: 5e6, files: 3 }]]),
    visits: [{ site_id: 's1', month: '2026-10', visitors: 389 }, { site_id: 's1', month: '2026-09', visitors: 660 }],
    visitsReady: true, visitsMonth: '2026-10', priorMonth: '2026-09', startIso: '2026-11-01T00:00:00Z', endIso: '2026-12-01T00:00:00Z',
  });
  const s1 = out.data.s1;
  ok('publishes: what reached the host, restores included, never a skipped one', s1.publishes === 3 && s1.restores === 1 && s1.skipped === 1 && s1.cost_cents === 30, JSON.stringify(s1));
  ok('storage and visits per client', s1.storage.bytes === 340e6 && s1.visits.value === 389 && s1.visits.prior === 660);
  ok('a site hosted elsewhere says so, never a zero', out.data.s2.publishes_why === 'hosted_elsewhere' && out.data.s2.visits === null && out.data.s2.visits_why === 'hosted_elsewhere');
  ok('a site not live yet says so', out.data.s3.publishes === 0 && out.data.s3.publishes_why === 'not_live' && out.data.s3.visits_why === 'not_live' && out.data.s3.storage.files === 3);
  ok('totals add up across the clients', out.totals.publishes === 3 && out.totals.cost_cents === 30 && out.totals.skipped === 1 && out.totals.bytes === 345e6 && out.totals.visits === 389, JSON.stringify(out.totals));
  ok('every day of the month, with its publishes', out.days.length === 30 && out.days[1].day === '2026-11-02' && out.days[1].publishes === 1 && out.days[3].publishes === 0 && out.days.reduce((n, d) => n + d.publishes, 0) === 3);
}

// ═══ 2. the route, against the database ═══
{
  const AG = 'aaaaaaaa-0000-4000-8000-000000000001';
  const S1 = '11111111-1111-4111-8111-111111111111', S2 = '22222222-2222-4222-8222-222222222222', OTHER = '33333333-3333-4333-8333-333333333333';
  const at = (d, h = 9) => `2026-11-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00Z`;
  db.reset({
    presence_agency_clients: [{ agency_id: AG, site_id: S1, status: 'active' }, { agency_id: AG, site_id: S2, status: 'active' }, { agency_id: 'someone-else', site_id: OTHER, status: 'active' }],
    presence_sites: [{ id: S1, edition: 'presence', status: 'live', last_published_at: at(9) }, { id: S2, edition: 'presence', status: 'live', last_published_at: at(2) }, { id: OTHER, edition: 'presence', status: 'live' }],
    presence_publishes: [
      ...Array.from({ length: 8 }, (_, i) => ({ site_id: S1, kind: 'publish', status: 'live', netlify_deploy_id: 'd' + i, unchanged: false, created_at: `2026-11-09T10:${String(i * 7).padStart(2, '0')}:00Z` })),
      { site_id: S1, kind: 'publish', status: 'live', netlify_deploy_id: 'd7', unchanged: true, created_at: at(10) },
      { site_id: S2, kind: 'restore', status: 'live', netlify_deploy_id: 'r1', unchanged: false, created_at: at(2) },
      { site_id: S2, kind: 'publish', status: 'live', netlify_deploy_id: 'old', unchanged: false, created_at: '2026-10-30T09:00:00Z' },   // last month
      { site_id: OTHER, kind: 'publish', status: 'live', netlify_deploy_id: 'x', unchanged: false, created_at: at(3) },
    ],
  });
  const member = { agency_id: AG, role: 'owner', user_id: 'u-eric', email: 'eric@studio.example' };
  // the two database functions, as production answers them
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.pathname === '/rest/v1/rpc/presence_media_usage') { const b = JSON.parse(init.body); return new Response(JSON.stringify([{ files: b.p_site === S1 ? 120 : 8, bytes: b.p_site === S1 ? 340e6 : 12e6 }]), { status: 200 }); }
    if (u.pathname === '/rest/v1/rpc/presence_month_visitors') return new Response(JSON.stringify([{ site_id: S1, month: '2026-10', visitors: 389, pageviews: 900 }, { site_id: S2, month: '2026-10', visitors: 1108, pageviews: 2000 }, { site_id: S2, month: '2026-09', visitors: 990, pageviews: 1800 }]), { status: 200 });
    return real(url, init);
  };
  const res = await quiet(() => handleUsage(new Request('http://x/agency/usage'), '/agency/usage', 'GET', member, {}, '2026-11-12T15:00:00Z'));
  const body = await res.json();
  globalThis.fetch = real;
  const d1 = body.data[S1], d2 = body.data[S2];
  ok('route: the studio’s own clients only', res.status === 200 && !!d1 && !!d2 && !body.data[OTHER]);
  ok('route: this month’s publishes and their cost, a restore counted, a skip apart, last month left out', d1.publishes === 8 && d1.skipped === 1 && d1.cost_cents === 80 && d2.publishes === 1 && d2.restores === 1, JSON.stringify({ d1, d2 }));
  ok('route: eight in one hour on Nov 9 is named', d1.burst && d1.burst.count === 8 && d1.burst.day === '2026-11-09');
  ok('route: storage and last month’s visits', d1.storage.bytes === 340e6 && d1.visits.value === 389 && d2.visits.prior === 990);
  ok('route: the month, the visits month, the plan', body.month === '2026-11' && body.visits_month === '2026-10' && body.visits_label === 'October' && body.plan.publishes === 330 && body.plan.cost_cents === 10 && body.totals.publishes === 9 && !body.partial, JSON.stringify({ m: body.month, t: body.totals, p: body.partial }));
  ok('route: someone without read is refused', (await handleUsage(new Request('http://x/agency/usage'), '/agency/usage', 'GET', { ...member, role: 'none' }, {})).status === 403);
  ok('route: another route is not its business', (await handleUsage(new Request('http://x/agency/sites'), '/agency/sites', 'GET', member, {})) === null);

  // before migration 0205 there is no `unchanged`: every deploy counts, as it was
  db.tables.presence_publishes.forEach((p) => { delete p.unchanged; });
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.pathname === '/rest/v1/presence_publishes' && /unchanged/.test(decodeURIComponent(u.search))) return new Response(JSON.stringify({ code: '42703', message: 'no column' }), { status: 400 });
    if (u.pathname.startsWith('/rest/v1/rpc/')) return new Response(JSON.stringify([]), { status: 200 });
    return real(url, init);
  };
  const old = await (await quiet(() => handleUsage(new Request('http://x/agency/usage'), '/agency/usage', 'GET', member, {}, '2026-11-12T15:00:00Z'))).json();
  globalThis.fetch = real;
  ok('before 0205: the publishes still count, the skip as a publish', old.data[S1].publishes === 9 && old.data[S1].skipped === 0, JSON.stringify(old.data[S1]));
}

const failed = results.filter((r) => !r.p);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) Deno.exit(1);
