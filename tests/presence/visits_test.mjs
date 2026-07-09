// ── Phase AN-2: Analytics Foundation — pure visit parsing + aggregation ───────
//   deno run --allow-read --allow-env tests/presence/visits_test.mjs
import { parseUA, refHost, sourceLabel, cleanPath, cleanUtms, visitorDayHash, aggregateVisits, trackerScript, isVisitKind } from '../../supabase/functions/presence/lib/visits.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };
const NOW = Date.parse('2026-07-08T12:00:00Z');
const daysAgo = (d) => new Date(NOW - d * 86_400_000).toISOString();

// ── UA parsing (deterministic, no lib) ──
{
  const iphone = parseUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Version/17 Mobile/15E Safari/604');
  ok('parseUA: iPhone → mobile / Safari / iOS', iphone.device === 'mobile' && iphone.browser === 'Safari' && iphone.os === 'iOS' && !iphone.bot);
  const win = parseUA('Mozilla/5.0 (Windows NT 10.0; Win64) AppleWebKit/537 Chrome/120 Safari/537');
  ok('parseUA: Windows Chrome → desktop / Chrome / Windows', win.device === 'desktop' && win.browser === 'Chrome' && win.os === 'Windows');
  ok('parseUA: iPad → tablet', parseUA('Mozilla/5.0 (iPad; CPU OS 16) Safari').device === 'tablet');
  ok('parseUA: Googlebot flagged as bot (dropped, never stored)', parseUA('Mozilla/5.0 (compatible; Googlebot/2.1)').bot === true);
  ok('parseUA: Edge distinguished from Chrome', parseUA('Windows Chrome/120 Edg/120').browser === 'Edge');
}

// ── referrer (host only, privacy) ──
ok('refHost: keeps host only, strips www', refHost('https://www.google.com/search?q=secret+query') === 'google.com');
ok('refHost: same-site referral is not a referral', refHost('https://joes.com/about', 'joes.com') === '');
ok('refHost: empty/direct → empty', refHost('') === '' && refHost('not a url') === '');
ok('sourceLabel: google host → Google; empty → Direct; utm wins', sourceLabel('google.com', '') === 'Google' && sourceLabel('', '') === 'Direct' && sourceLabel('google.com', 'newsletter') === 'newsletter');

// ── path + utm sanitization ──
ok('cleanPath: strips query/hash, keeps path', cleanPath('/services?utm=x#top') === '/services' && cleanPath('') === '/');
ok('cleanUtms: sanitizes + caps', (() => { const u = cleanUtms({ s: 'spring<script>', m: 'email', c: 'a'.repeat(80) }); return u.source === 'springscript' && u.medium === 'email' && u.campaign.length === 60; })());

// ── daily visitor hash — anonymous + rotates daily (no cross-day identity) ──
{
  const a = await visitorDayHash('1.2.3.4', 'UA', 'site1', '2026-07-08', 'salt');
  const b = await visitorDayHash('1.2.3.4', 'UA', 'site1', '2026-07-08', 'salt');
  const nextDay = await visitorDayHash('1.2.3.4', 'UA', 'site1', '2026-07-09', 'salt');
  const other = await visitorDayHash('9.9.9.9', 'UA', 'site1', '2026-07-08', 'salt');
  ok('visitorHash: same input same day → stable (dedupe)', a === b);
  ok('visitorHash: rotates the next day → no cross-day tracking', a !== nextDay);
  ok('visitorHash: different visitor → different hash', a !== other);
  ok('visitorHash: opaque hex, not reversible to an IP', /^[0-9a-f]{20}$/.test(a) && !a.includes('1.2.3.4'));
}

// ── aggregation ──
{
  const rows = [
    { ts: daysAgo(1), kind: 'pageview', path: '/', ref_host: 'google.com', utm_source: '', device: 'mobile', country: 'US', visitor_hash: 'v1' },
    { ts: daysAgo(1), kind: 'pageview', path: '/services', ref_host: 'google.com', utm_source: '', device: 'mobile', country: 'US', visitor_hash: 'v1' },
    { ts: daysAgo(2), kind: 'pageview', path: '/services', ref_host: '', utm_source: '', device: 'desktop', country: 'US', visitor_hash: 'v2' },
    { ts: daysAgo(3), kind: 'phone', path: '/contact', ref_host: '', utm_source: '', device: 'mobile', country: 'US', visitor_hash: 'v1' },
    { ts: daysAgo(10), kind: 'pageview', path: '/', ref_host: '', utm_source: '', device: 'desktop', country: 'US', visitor_hash: 'v9' }, // prior window
  ];
  const a = aggregateVisits(rows, NOW, 7);
  ok('aggregate: unique visitors this week (v1,v2)', a.visitors === 2 && a.priorVisitors === 1);
  ok('aggregate: pageviews counted (3 this week)', a.pageviews === 3);
  ok('aggregate: top page is /services', a.topPages[0].path === '/services' && a.topPages[0].views === 2);
  ok('aggregate: top source is Google', a.topSources[0].source === 'Google');
  ok('aggregate: phone click event counted', a.events.phone === 1);
  ok('aggregate: hasData true when there is traffic; false when empty', a.hasData === true && aggregateVisits([], NOW, 7).hasData === false);
}

// ── the injected tracker: privacy-first + tiny ──
{
  const t = trackerScript('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'https://x.supabase.co/functions/v1/presence');
  ok('tracker: honors Do-Not-Track', t.includes('doNotTrack'));
  ok('tracker: uses sendBeacon (no latency, fire-and-forget)', t.includes('sendBeacon'));
  ok('tracker: sets NO cookie and uses NO localStorage', !/document\.cookie|localStorage/.test(t));
  ok('tracker: posts to the site-scoped collector', t.includes('/px/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'));
  ok('tracker: is lightweight (< 1200 bytes)', t.length < 1200);
}

ok('isVisitKind: guards the kind enum', isVisitKind('pageview') && isVisitKind('phone') && !isVisitKind('evil') && !isVisitKind(null));

// ── render injection: ONE tracker into every page, idempotent, html-only ──
{
  Deno.env.set('SUPABASE_URL', 'https://x.supabase.co');
  const { injectAnalytics } = await import('../../supabase/functions/presence/lib/render.ts');
  const SITE = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
  const fm = { 'index.html': '<html><body>Home</body></html>', 'about/index.html': '<html><body>About</body></html>', 'assets/site.css': 'body{}' };
  const out = injectAnalytics(fm, SITE);
  ok('inject: tracker added to every .html page', out['index.html'].includes('id="presence-analytics"') && out['about/index.html'].includes('id="presence-analytics"'));
  ok('inject: non-html files untouched', out['assets/site.css'] === 'body{}');
  ok('inject: baked with the site-scoped collector', out['index.html'].includes(`/px/${SITE}`));
  const twice = injectAnalytics(out, SITE);
  ok('inject: idempotent (never double-injects)', (twice['index.html'].match(/presence-analytics/g) || []).length === 1);
  ok('inject: no site id → unchanged (safe for preview)', injectAnalytics(fm, undefined)['index.html'] === fm['index.html']);
}

// ── AN-2.10 no-AI guard: the collector + visits lib add no model calls ──
{
  const collectSrc = await Deno.readTextFile(new URL('../../supabase/functions/presence/routes/collect.ts', import.meta.url));
  const visitsSrc = await Deno.readTextFile(new URL('../../supabase/functions/presence/lib/visits.ts', import.meta.url));
  const banned = /(writer\/model|anthropic|openai|concierge)/;
  ok('AN-2.10: collector uses no AI', !banned.test(collectSrc));
  ok('AN-2.10: visits lib uses no AI (pure/deterministic)', !banned.test(visitsSrc));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ VISITS (AN-2): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
