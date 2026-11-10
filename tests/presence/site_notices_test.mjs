// ── Builder list item 47 (Nov 2026): notifications per site ──
//   deno run --allow-read --allow-env tests/presence/site_notices_test.mjs
// A busy day of visitors is found by a pure fold; a publish finished and a busy
// day are UPDATE notices with their own landing; the studio's bell gets the news
// per client site, each named and scoped; the migration and its apply pack name
// both kinds.
import { spikeSites, spikeWords, daysBefore, dayOf, SPIKE_MIN_VIEWS } from '../../supabase/functions/presence/ops/traffic_spikes.ts';
import { siteNews, SITE_NEWS_KINDS } from '../../supabase/functions/presence/agency/routes.ts';
import { noticeTier, UPDATE_NOTICE_KINDS } from '../../supabase/functions/presence/lib/inbox_feed.ts';
import { noticeHrefFor, STUDIO_WEBSITE_NOTICE_KINDS } from '../../supabase/functions/presence/routes/workspace.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}`); };
const read = (p) => Deno.readTextFileSync(new URL('../../' + p, import.meta.url));

// days
ok('daysBefore steps whole UTC days', daysBefore('2026-11-10', 1) === '2026-11-09' && daysBefore('2026-03-01', 1) === '2026-02-28');
ok('dayOf takes the UTC day', dayOf('2026-11-09T23:59:59.000Z') === '2026-11-09');

// the fold
const DAY = '2026-11-09';
const rows = (site, perDay) => Object.entries(perDay).flatMap(([d, n]) => Array.from({ length: n }, (_, i) => ({ site_id: site, ts: `${d}T1${String(i % 10)}:00:00.000Z` })));
const usual = { '2026-11-02': 10, '2026-11-03': 10, '2026-11-04': 10, '2026-11-05': 10, '2026-11-06': 10, '2026-11-07': 10, '2026-11-08': 10 };
const busy = rows('a', { ...usual, [DAY]: 40 });
const calm = rows('b', { ...usual, [DAY]: 14 });
const spikes = spikeSites(busy.concat(calm), DAY);
ok('a day four times the usual spikes', spikes.length === 1 && spikes[0].site_id === 'a');
ok('the spike carries yesterday, the usual and the ratio', spikes[0].yesterday === 40 && spikes[0].usual === 10 && spikes[0].ratio === 4);
ok('a day under three times the usual does not', spikeSites(rows('c', { ...usual, [DAY]: 29 }), DAY).length === 0);
ok('exactly three times does', spikeSites(rows('c', { ...usual, [DAY]: 30 }), DAY).length === 1);
ok('a small site never spikes under twenty views', spikeSites(rows('d', { '2026-11-06': 1, '2026-11-07': 1, '2026-11-08': 1, [DAY]: SPIKE_MIN_VIEWS - 1 }), DAY).length === 0);
ok('a new site with two earlier days has no usual yet', spikeSites(rows('e', { '2026-11-07': 2, '2026-11-08': 2, [DAY]: 60 }), DAY).length === 0);
ok('three earlier days are enough, and quiet days count as zero', (() => { const s = spikeSites(rows('f', { '2026-11-06': 7, '2026-11-07': 7, '2026-11-08': 7, [DAY]: 20 }), DAY); return s.length === 1 && s[0].usual === 3; })());
ok('views outside the eight days are ignored', spikeSites(rows('g', { '2026-10-20': 500, ...usual, [DAY]: 25 }), DAY).length === 0);
ok('the busiest spike comes first', (() => { const s = spikeSites(rows('h', { ...usual, [DAY]: 90 }).concat(rows('i', { ...usual, [DAY]: 35 })), DAY); return s.map((x) => x.site_id).join() === 'h,i'; })());
const w = spikeWords(spikes[0], 'bacchus.example');
ok('the words name the number, the ratio and the site', w.headline === 'A busy day: 40 visitors yesterday' && /about 4 times a usual day for bacchus\.example/.test(w.body) && /Analytics/.test(w.body));
ok('without a host the words still read', !/for $/.test(spikeWords(spikes[0], null).body));

// the kinds
ok('both kinds are updates, never asks', noticeTier('site_published') === 'update' && noticeTier('traffic_spike') === 'update' && UPDATE_NOTICE_KINDS.has('site_published'));
ok('a publish lands on the Website overview; a spike on Analytics', noticeHrefFor({ kind: 'site_published', period: 'pub:x' }) === '/presence.html' && noticeHrefFor({ kind: 'traffic_spike', period: 'day:2026-11-09' }) === '/analytics.html');
ok('the studio’s own site keeps them on its Website page', STUDIO_WEBSITE_NOTICE_KINDS.has('site_published') && STUDIO_WEBSITE_NOTICE_KINDS.has('traffic_spike'));

// the news per site
const NOW = '2026-11-10T09:00:00.000Z';
const names = { s1: 'Bacchus Kitchen', s2: 'Harbor Dental' };
const notices = [
  { id: 'n1', site_id: 's1', kind: 'site_published', period: 'pub:p1', headline: 'Published 3 changes', body: 'The website is live with the latest changes.', created_at: '2026-11-09T20:00:00Z' },
  { id: 'n2', site_id: 's2', kind: 'traffic_spike', period: 'day:2026-11-09', headline: 'A busy day: 48 visitors yesterday', body: 'About 3 times a usual day.', created_at: '2026-11-10T06:00:00Z' },
  { id: 'n3', site_id: 's1', kind: 'lead_followup', period: 'lead:x', headline: 'An enquiry is waiting', body: '', created_at: '2026-11-10T07:00:00Z' },   // an ask: Needs you has it
  { id: 'n4', site_id: 's1', kind: 'site_published', period: 'pub:old', headline: 'Published', body: '', created_at: '2026-10-01T00:00:00Z' },   // too old
  { id: 'n5', site_id: 'zz', kind: 'site_published', period: 'pub:p9', headline: 'Published', body: '', created_at: '2026-11-10T08:00:00Z' },   // not a client here
];
const news = siteNews(notices, names, NOW);
ok('news keeps the update kinds for named sites from the last fortnight', news.map((n) => n.id).join() === 'n2,n1');
ok('each row names the site', news[0].name === 'Harbor Dental' && news[1].name === 'Bacchus Kitchen');
ok('each link carries the client’s scope and lands on the right page', news[0].href === '/analytics.html?client=s2' && news[1].href === '/presence.html?client=s1');
ok('the news kinds include a review and a booking too', SITE_NEWS_KINDS.has('new_review') && SITE_NEWS_KINDS.has('new_booking') && !SITE_NEWS_KINDS.has('lead_followup'));
ok('the cap holds', siteNews(Array.from({ length: 30 }, (_, i) => ({ id: 'x' + i, site_id: 's1', kind: 'site_published', period: 'pub:' + i, headline: 'P', body: '', created_at: '2026-11-10T0' + (i % 10) + ':00:00Z' })), names, NOW).length === 12);

// the migration and the apply pack
const mig = read('supabase/migrations/0147_site_notices.sql'), pack = read('docs/presence/APPLY-0147-prod.sql');
ok('migration 0147 names both kinds in the check', /'site_published','traffic_spike'/.test(mig) && /presence_plan_notices_kind_check/.test(mig));
ok('the apply pack names both kinds and ends with a check query', /'site_published','traffic_spike'/.test(pack) && /select position\('site_published'/.test(pack));
ok('the pack keeps every kind the migration keeps', [...mig.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).every((k) => pack.includes(`'${k}'`)));

const passed = results.filter((x) => x.p).length;
console.log(`\n════ SITE NOTICES (item 47): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
