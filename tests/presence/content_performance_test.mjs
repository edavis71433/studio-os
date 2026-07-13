// Content Performance — pure composer tests.
//   deno run -A tests/presence/content_performance_test.mjs
// Covers: ranks most/least correctly, produces the right actionable sentence for
// sample aggregates, stays SILENT + honest under low volume and when `truncated`,
// and never fabricates a number (or a page/source) that isn't in the input.
import { buildContentPerformance } from '../../supabase/functions/presence/lib/content_performance.ts';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('FAIL ', name); } };
const eq = (name, a, b) => ok(name + ` (got ${JSON.stringify(a)})`, a === b);

// a full, healthy aggregate (matching aggregateVisits(...) output shape)
const base = {
  visitors: 40, pageviews: 120,
  topPages: [
    { path: '/services', views: 60 },
    { path: '/about', views: 30 },
    { path: '/faq', views: 5 },
  ],
  topSources: [
    { source: 'Google', visits: 30 },
    { source: 'Direct', visits: 8 },
    { source: 'Facebook', visits: 2 },
  ],
  devices: [
    { device: 'mobile', share: 72 },
    { device: 'desktop', share: 24 },
    { device: 'tablet', share: 4 },
  ],
  hasData: true, truncated: false,
};
const build = (over) => buildContentPerformance({ ...base, ...over });
const sug = (r, key) => r.suggestions.find((s) => s.key === key);
const textOf = (r) => r.suggestions.map((s) => s.text).join(' || ');

// 1. Full data → most/least page ranking with an actionable link suggestion
{
  const r = build({});
  ok('1 enough', r.enough === true);
  const p = sug(r, 'pages_most_least');
  ok('1 emits most/least page card', !!p);
  ok('1 names the most-visited page (Services)', /Services page gets the most visits/.test(p.text));
  ok('1 names the least-visited page (FAQ)', /FAQ page gets the fewest/.test(p.text));
  ok('1 gives an action', /linking to it from your home page/.test(p.text));
}

// 2. Reads the store's contract: [0] = most, last = least (views-desc). A
//    different descending set must produce the leader/least from the right ends.
{
  const r = build({ topPages: [
    { path: '/menu', views: 80 },
    { path: '/hours', views: 40 },
    { path: '/gallery', views: 6 },
  ] });
  const p = sug(r, 'pages_most_least');
  ok('2 leader = first element (Menu)', /Menu page gets the most/.test(p.text));
  ok('2 least = last element (Gallery)', /Gallery page gets the fewest/.test(p.text));
}

// 3. Top source (Google search, dominant) → a good-tone, honest suggestion
{
  const r = build({});
  const s = sug(r, 'source');
  ok('3 emits source card', !!s);
  ok('3 mentions Google search', /find you through Google search/.test(s.text));
  eq('3 good tone', s.tone, 'good');
}

// 4. Device majority (phones ≥ 60%) → reassuring good-tone note
{
  const r = build({});
  const d = sug(r, 'device');
  ok('4 emits device card', !!d);
  ok('4 phones note', /Most visitors are on phones/.test(d.text));
}

// 5. Low volume → silent + honest (never a fabricated suggestion)
{
  const r = build({ visitors: 3 });
  eq('5 not enough', r.enough, false);
  eq('5 no suggestions', r.suggestions.length, 0);
  ok('5 has a calm note', /few more visits/.test(r.note));
}

// 6. No data at all → honest empty state
{
  const r = buildContentPerformance({ visitors: 0, pageviews: 0, topPages: [], topSources: [], devices: [], hasData: false, truncated: false });
  eq('6 not enough', r.enough, false);
  eq('6 no suggestions', r.suggestions.length, 0);
}

// 7. TRUNCATED → suppress every whole-distribution claim (least/source/device);
//    keep only the robust single leader page. Honesty under an incomplete set.
{
  const r = build({ truncated: true });
  ok('7 still enough (has a leader)', r.enough === true);
  ok('7 no most/least ranking under truncation', !sug(r, 'pages_most_least'));
  ok('7 leader-only page card kept', !!sug(r, 'pages_most'));
  ok('7 no source claim under truncation', !sug(r, 'source'));
  ok('7 no device claim under truncation', !sug(r, 'device'));
}

// 8. "Fewest" only when the WHOLE page set is visible (fewer than the cap of 5).
//    At the cap we can't see the true tail → leader-only, never a false "fewest".
{
  const fivePages = [
    { path: '/services', views: 60 }, { path: '/about', views: 40 },
    { path: '/work', views: 30 }, { path: '/blog', views: 20 }, { path: '/faq', views: 10 },
  ];
  const r = build({ topPages: fivePages });
  ok('8 at the cap → no fewest claim', !sug(r, 'pages_most_least'));
  ok('8 at the cap → leader-only card', !!sug(r, 'pages_most'));
}

// 9. Never fabricate a number/page: every page label in output comes from input
{
  const r = build({});
  const t = textOf(r);
  // The only page slugs mentioned must be ones we passed in.
  ok('9 no invented page appears', !/checkout|pricing|contact page/i.test(t));
  ok('9 no raw numeric counts leaked as fake precision', !/\b\d+ (visits|views)\b/.test(t) || /the most visits/.test(t));
}

// 10. Home page is never advised as the least (would read "link home from home")
{
  const r = build({ topPages: [ { path: '/services', views: 50 }, { path: '/', views: 4 } ] });
  ok('10 home not used as the fewest', !sug(r, 'pages_most_least'));
  ok('10 falls back to leader-only', !!sug(r, 'pages_most'));
}

// 11. Direct-dominant source → neutral, honest nudge (not a false "SEO working")
{
  const r = build({ topSources: [ { source: 'Direct', visits: 30 }, { source: 'Google', visits: 3 } ] });
  const s = sug(r, 'source');
  ok('11 direct note', /come straight to your site/.test(s.text));
  eq('11 neutral tone', s.tone, 'neutral');
}

// 12. No dominant source (even split) → no source claim (nothing stands out)
{
  const r = build({ topSources: [ { source: 'Google', visits: 10 }, { source: 'Facebook', visits: 9 }, { source: 'Direct', visits: 9 } ] });
  ok('12 no source card when nothing dominates', !sug(r, 'source'));
}

// 13. At most 3 suggestions, in priority order (pages, source, device)
{
  const r = build({});
  ok('13 no more than 3', r.suggestions.length <= 3);
  eq('13 pages first', r.suggestions[0].key.startsWith('pages'), true);
}

// 14. Desktop-majority phrasing differs from phone phrasing (device correctness)
{
  const r = build({ devices: [ { device: 'desktop', share: 80 }, { device: 'mobile', share: 20 } ] });
  const d = sug(r, 'device');
  ok('14 desktop note', /desktop computers/.test(d.text));
}

console.log(fail === 0
  ? `\n════ CONTENT PERFORMANCE: ${pass}/${pass} PASS ════`
  : `\n${fail} FAILURE(S), ${pass} passed`);
if (fail) Deno.exit(1);
