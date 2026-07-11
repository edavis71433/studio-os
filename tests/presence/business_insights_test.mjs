// CMS-UX-7 — Business Insights: pure adapter tests.
//   deno run -A tests/presence/business_insights_test.mjs
// Covers the reframing of existing composed insights into calm categorised
// observations (what / why / should-I), the category mapping, tone → action,
// the empty state, and client-safety.
import { buildBusinessInsights } from '../../supabase/functions/presence/lib/business_insights.ts';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('FAIL ', name); } };
const eq = (name, a, b) => ok(name + ` (got ${JSON.stringify(a)})`, a === b);

const obs = (b) => b.groups.flatMap((g) => g.observations);
const grp = (b, key) => b.groups.find((g) => g.key === key);
const ins = (key, sentence, over = {}) => ({ key, title: key, sentence, ...over });

// 1. Empty → nothing invented
{
  const b = buildBusinessInsights([]);
  eq('1 no groups', b.groups.length, 0);
  eq('1 total 0', b.total, 0);
  eq('1 calm headline', b.headline, 'Nothing to report just yet.');
}

// 2. Every observation answers what/why/should-I
{
  const b = buildBusinessInsights([ins('traffic', '12 people visited your website this month.', { tone: 'good' })]);
  const o = obs(b)[0];
  eq('2 observation is the platform sentence', o.observation, '12 people visited your website this month.');
  ok('2 has why', !!o.why);
  ok('2 has should_i', !!o.should_i);
  eq('2 good → nothing to do', o.should_i, 'Nothing to do — just good to know.');
}

// 3. Category mapping (keys → the six categories)
{
  const b = buildBusinessInsights([
    ins('traffic', 'v'), ins('source', 's'), ins('device', 'd'),
    ins('inquiries', 'i'), ins('top_page', 't'), ins('publishing', 'p'),
    ins('search', 'q'), ins('contact_clicks', 'c'), ins('milestone', 'm'),
  ]);
  eq('3 Visitors has traffic+source+device', grp(b, 'Visitors')?.observations.length, 3);
  eq('3 Enquiries', grp(b, 'Enquiries')?.observations.length, 1);
  eq('3 Content has top_page+publishing', grp(b, 'Content')?.observations.length, 2);
  eq('3 Search', grp(b, 'Search')?.observations.length, 1);
  eq('3 Engagement', grp(b, 'Engagement')?.observations.length, 1);
  eq('3 Growth', grp(b, 'Growth')?.observations.length, 1);
}

// 4. Calm category order, only non-empty categories
{
  const b = buildBusinessInsights([ins('inquiries', 'i'), ins('traffic', 'v'), ins('search', 'q')]);
  eq('4 order', b.groups.map((g) => g.key).join(','), 'Visitors,Enquiries,Search');
}

// 5. attention tone → an action (worth a look), with the insight's href
{
  const b = buildBusinessInsights([ins('publishing', 'Your website was last updated 90 days ago.', { tone: 'attention', href: '/presence.html' })]);
  const o = obs(b)[0];
  ok('5 should_i suggests a look', /worth a look/i.test(o.should_i));
  eq('5 action label', o.action_label, 'Take a look');
  eq('5 action href reused', o.action_href, '/presence.html');
}

// 6. unknown search-prefixed key still lands in Search
{
  const b = buildBusinessInsights([ins('search_queries', 'People find you searching for “bakery burbank”.')]);
  eq('6 search_* → Search', grp(b, 'Search')?.observations.length, 1);
}

// 7. unknown key falls to Growth (never dropped)
{
  const b = buildBusinessInsights([ins('brand_new_signal', 'Something notable happened.')]);
  eq('7 unknown → Growth', grp(b, 'Growth')?.observations.length, 1);
}

// 8. detail is carried through; blank sentences are skipped
{
  const b = buildBusinessInsights([ins('traffic', 'v', { detail: '40 page views in all.' }), ins('source', '')]);
  eq('8 only the sentence-bearing one', b.total, 1);
  eq('8 detail carried', obs(b)[0].detail, '40 page views in all.');
}

// 9. headline reflects that there's something to say
{
  const b = buildBusinessInsights([ins('inquiries', 'You received 3 inquiries this month.', { tone: 'good' })]);
  eq('9 headline', b.headline, 'Here’s what stands out right now.');
}

// 10. Client-safe: no keys / tones / hrefs-as-jargon leak into labels
{
  const b = buildBusinessInsights([ins('traffic', 'v', { tone: 'good', number: 12 }), ins('inquiries', 'i', { tone: 'good' })]);
  const s = JSON.stringify(b);
  ok('10 no internal insight keys leak', !s.includes('"traffic"') && !s.includes('"inquiries"'));
  ok('10 group key is a friendly category', b.groups.every((g) => ['Visitors','Enquiries','Content','Search','Engagement','Growth'].includes(g.key)));
  ok('10 no tone field', !s.includes('"tone"'));
  ok('10 no number field leaked', !s.includes('"number"'));
  ok('10 observations carry only safe fields', obs(b).every((o) => 'observation' in o && 'why' in o && 'should_i' in o && 'icon' in o));
}

console.log(fail === 0
  ? `\n════ BUSINESS INSIGHTS: ${pass}/${pass} PASS ════`
  : `\n${fail} FAILURE(S), ${pass} passed`);
if (fail) Deno.exit(1);
