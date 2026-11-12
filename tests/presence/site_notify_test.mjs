// ── Builder list item 126 (Nov 2026): one notifications switch per client site ──
//   deno run --allow-read --allow-env --allow-net tests/presence/site_notify_test.mjs
// Each client site has one switch, then a Dashboard channel (Home and the bell) and an
// Email channel (the studio's copies of the site's emails). Repeats fold into one line
// that names the site, the number and one link. What is owed, broken or written by a
// client is never silenced, and nothing the client gets changes.
import * as N from '../../supabase/functions/presence/lib/site_notify.ts';
import { siteNews } from '../../supabase/functions/presence/agency/routes.ts';
import { buildNeedsYou } from '../../supabase/functions/presence/agency/needs_you.ts';
import { RESERVED_NAMES } from '../../supabase/functions/presence/lib/reserved_store.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${p || !note ? '' : ' — ' + note}`); };
const read = (p) => Deno.readTextFileSync(new URL('../../' + p, import.meta.url));

const S1 = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', S2 = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', S3 = 'cccccccc-3333-4333-8333-cccccccccccc';

// ── the setting ──
ok('a site with no entry hears everything', JSON.stringify(N.prefFor({ sites: {} }, S1)) === JSON.stringify({ on: true, dashboard: true, email: true }));
ok('an unreadable setting hears everything', JSON.stringify(N.normalizeNotify('nonsense')) === '{"sites":{}}' && N.hears(N.normalizeNotify(null), S1, 'email'));
ok('only real site ids are kept, and all-on entries are dropped (that is the default)', (() => {
  const s = N.normalizeNotify({ sites: { [S1]: { on: false }, 'not-a-site': { on: false }, [S2]: { on: true, dashboard: true, email: true } } });
  return Object.keys(s.sites).join() === S1 && s.sites[S1].on === false && s.sites[S1].dashboard === true;
})());
ok('ids are kept lower-case, so a stored site always matches', N.prefFor(N.normalizeNotify({ sites: { [S1.toUpperCase()]: { email: false } } }), S1).email === false);
ok('a malformed flag reads as on', JSON.stringify(N.normalizePref({ on: 'no', dashboard: 0, email: null })) === JSON.stringify({ on: true, dashboard: true, email: true }));
ok('the switch off silences both channels', !N.hears({ sites: { [S1]: { on: false, dashboard: true, email: true } } }, S1, 'dashboard') && !N.hears({ sites: { [S1]: { on: false, dashboard: true, email: true } } }, S1, 'email'));
ok('one channel off leaves the other', (() => { const s = { sites: { [S1]: { on: true, dashboard: false, email: true } } }; return !N.hears(s, S1, 'dashboard') && N.hears(s, S1, 'email'); })());
ok('quiet sites are the ones off Home and the bell', (() => { const q = N.quietSites({ sites: { [S1]: { on: false, dashboard: true, email: true }, [S2]: { on: true, dashboard: false, email: true }, [S3]: { on: true, dashboard: true, email: false } } }); return q.has(S1) && q.has(S2) && !q.has(S3); })());
ok('a change takes only the three switches', JSON.stringify(N.pickFlags({ on: false, email: 'yes', name: 'x', dashboard: true })) === JSON.stringify({ on: false, dashboard: true }));
ok('a change keeps what it doesn’t touch', (() => { const a = N.applyNotifyChange({ sites: {} }, S1, { email: false }); const b = N.applyNotifyChange(a, S1, { on: false }); return b.sites[S1].email === false && b.sites[S1].on === false && b.sites[S1].dashboard === true; })());
ok('turning everything back on removes the entry', Object.keys(N.applyNotifyChange({ sites: { [S1]: { on: false, dashboard: true, email: true } } }, S1, { on: true }).sites).length === 0);
ok('the setting has its own reserved name', RESERVED_NAMES.siteNotify === '__site_notify__');
ok('a studio with no site of its own hears everything', (await N.studioWantsEmail(null, S1)) === true && (await N.studioWantsEmail('x', null)) === true);

// ── the words of a line: the site, the number and one link ──
ok('a busy day says the site and the page views', (() => { const w = N.newsWords('traffic_spike', 'Kismet', 1, { headline: 'A busy day: 78 page views yesterday', body: '' }); return w.title === 'Traffic spike on Kismet: 78 page views' && w.link === 'View analytics'; })());
ok('several bookings fold into "3 new bookings on …"', (() => { const w = N.newsWords('new_booking', 'Bacchus Kitchen', 3, { headline: 'New booking: Haircut — Fri 2pm', body: '' }); return w.title === '3 new bookings on Bacchus Kitchen' && w.sub === 'The latest: Haircut — Fri 2pm' && w.link === 'Open bookings'; })());
ok('one booking names it', N.newsWords('new_booking', 'Bacchus Kitchen', 1, { headline: 'New booking: Haircut — Fri 2pm', body: '' }).sub === 'Haircut — Fri 2pm');
ok('reviews count too, and the link says "reviews" for more than one', N.newsWords('new_review', 'Harbor Dental', 2, { headline: 'x', body: '' }).title === '2 new reviews on Harbor Dental' && N.newsWords('new_review', 'Harbor Dental', 2, { headline: 'x', body: '' }).link === 'Read the reviews');
ok('a publish keeps its own words', N.newsWords('site_published', 'Bacchus Kitchen', 1, { headline: 'Published 3 changes', body: '' }).title === 'Published 3 changes on Bacchus Kitchen');
ok('spikeViews reads the number, commas and all', N.spikeViews('A busy day: 1,204 page views yesterday') === 1204 && N.spikeViews('nothing here') === null);

// ── the fold, through siteNews ──
const NOW = '2026-11-12T09:00:00.000Z';
const names = { [S1]: 'Bacchus Kitchen', [S2]: 'Harbor Dental', [S3]: 'Kismet' };
const notices = [
  { id: 'b1', site_id: S1, kind: 'new_booking', period: 'appt:1', headline: 'New booking: Haircut — Fri 2pm', body: 'Sam booked online.', created_at: '2026-11-11T08:00:00Z' },
  { id: 'b2', site_id: S1, kind: 'new_booking', period: 'appt:2', headline: 'New booking: Colour — Sat 10am', body: 'Dana booked online.', created_at: '2026-11-11T10:00:00Z' },
  { id: 'b3', site_id: S1, kind: 'new_booking', period: 'appt:3', headline: 'New booking: Trim — Sat 11am', body: 'Lee booked online.', created_at: '2026-11-11T09:00:00Z' },
  { id: 'p1', site_id: S1, kind: 'site_published', period: 'pub:1', headline: 'Published 2 changes', body: 'The website is live with the latest changes.', created_at: '2026-11-10T08:00:00Z' },
  { id: 't1', site_id: S3, kind: 'traffic_spike', period: 'day:2026-11-11', headline: 'A busy day: 78 page views yesterday', body: 'About 4 times a usual day.', created_at: '2026-11-12T06:00:00Z' },
  { id: 'r1', site_id: S2, kind: 'new_review', period: 'rev:1', headline: '5 stars from Ana', body: '', created_at: '2026-11-12T07:00:00Z' },
];
const news = siteNews(notices, names, NOW);
ok('three bookings on one site are one line', news.filter((n) => n.kind === 'new_booking').length === 1 && news.find((n) => n.kind === 'new_booking').count === 3);
ok('the folded line names the site and the number, and links to the newest', (() => { const b = news.find((n) => n.kind === 'new_booking'); return b.title === '3 new bookings on Bacchus Kitchen' && b.id === 'b2' && b.link === 'Open bookings' && /client=/.test(b.href); })());
ok('lines run newest first', news.map((n) => n.id).join() === 'r1,t1,b2,p1', news.map((n) => n.id).join());
ok('a spike line carries its number and its one link', (() => { const t = news.find((n) => n.kind === 'traffic_spike'); return t.title === 'Traffic spike on Kismet: 78 page views' && t.link === 'View analytics' && t.href === '/analytics.html?client=' + S3; })());
ok('a site the studio turned off leaves no news', (() => { const q = siteNews(notices, names, NOW, 12, new Set([S1])); return !q.some((n) => n.site_id === S1) && q.length === 2; })());
ok('the cap counts lines, not notices', siteNews(Array.from({ length: 30 }, (_, i) => ({ id: 'x' + i, site_id: `dddddddd-0000-4000-8000-${String(i).padStart(12, '0')}`, kind: 'site_published', period: 'pub:' + i, headline: 'P', body: '', created_at: '2026-11-11T0' + (i % 10) + ':00:00Z' })), Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`dddddddd-0000-4000-8000-${String(i).padStart(12, '0')}`, 'Site ' + i])), NOW).length === 12);

// ── Home and the bell: a quiet site's visitors' enquiries go; money and broken things stay ──
const base = { nowIso: '2026-11-12T09:00:00Z', links: [{ site_id: S1, status: 'active' }, { site_id: S2, status: 'active' }], clientNames: names, namesByClient: {},
  sites: [{ id: S1, edition: 'presence', status: 'live', last_published_at: '2026-11-01T00:00:00Z', custom_domain: 'bacchus.example', domain_expires_at: '2026-11-15' }, { id: S2, edition: 'presence', status: 'live', last_published_at: '2026-11-01T00:00:00Z' }],
  enquiries: [{ id: 'e1', site_id: S1, name: 'Sam', created_at: '2026-11-11T00:00:00Z' }, { id: 'e2', site_id: S2, name: 'Ana', created_at: '2026-11-11T00:00:00Z' }],
  publishes: [{ site_id: S1, status: 'failed', created_at: '2026-11-11T00:00:00Z', error_text: 'x' }] };
const loud = buildNeedsYou(base), hush = buildNeedsYou({ ...base, quiet: [S1] });
ok('with every site on, both sites’ enquiries are listed', loud.some((r) => r.key === 'enquiry:e1') && loud.some((r) => r.key === 'enquiry:e2'));
ok('a quiet site’s enquiries leave Home and the bell; the other site’s stay', !hush.some((r) => r.key === 'enquiry:e1') && hush.some((r) => r.key === 'enquiry:e2'));
ok('a quiet site’s broken things stay (a failed publish, a domain about to lapse)', hush.some((r) => r.kind === 'broken' && r.site_id === S1));

// ── the wiring ──
const routes = read('supabase/functions/presence/agency/routes.ts');
ok('GET /agency/notify reads for anyone who can read, and lists the active client sites', /route === '\/agency\/notify' && method === 'GET'[\s\S]{0,120}can\(member\.role, 'read'\)/.test(routes) && /status === 'active'\)\s*\n?\s*\.map\(\(l\) => \(\{ site_id: l\.site_id/.test(routes));
ok('a failed read says so instead of showing every switch on', /readReservedJsonOrThrow\(own\.id, RESERVED_NAMES\.siteNotify\)[\s\S]{0,80}catch \{ return json\(\{ error: 'read_failed'/.test(routes));
ok('PUT /agency/notify/:site needs manage_clients, one of your sites, and a real change', /if \(nm && method === 'PUT'\) \{\s*if \(!can\(member\.role, 'manage_clients'\)\) return forbid\(cors\);/.test(routes) && /isSiteId\(siteId\) \|\| !Object\.keys\(change\)\.length/.test(routes) && /That site isn’t one of your clients’/.test(routes));
ok('the PUT changes one site without losing another person’s change (compare-and-swap)', /updateReservedJson\(own\.id, RESERVED_NAMES\.siteNotify, \(cur\) => applyNotifyChange/.test(routes));
ok('Needs you reads the setting with its other reads and hands the quiet sites on', /readNotify\(own\?\.id\),\s*\n\s*\]\);/.test(routes) && /quiet: \[\.\.\.quietSites\(notify\)\]/.test(routes) && /siteNews\(input\.notices \|\| \[\], input\.clientNames, now, 12, quietSites\(notify\)\)/.test(routes));
const dn = read('supabase/functions/presence/lib/domain_notify.ts'), lc = read('supabase/functions/presence/commerce/lifecycle.ts');
ok('the studio’s copy of a domain change asks the Email channel first; the client’s email doesn’t', /if \(studioSite && await studioWantsEmail\(String\(studioSite\), site\.id\)\) out\.studio = await emailOperator/.test(dn) && !/studioWantsEmail[\s\S]{0,200}out\.client/.test(dn));
ok('the studio’s copy of a domain reminder asks it too', /if \(studioSite && await studioWantsEmail\(String\(studioSite\), site\.id\)\) await emailOperator\(String\(studioSite\), `\$\{site\.custom_domain\} \$\{words\.when\}`/.test(lc));
const shell = read('shell.js');
ok('the bell folds a site’s enquiries into one line with its one link', /' new enquiries on ' \+/.test(shell) && /go: 'Reply'/.test(shell) && /'#enquiries'/.test(shell));
ok('the bell shows the server’s words for each news line, and names its link', /title: n\.title \|\|/.test(shell) && /go: n\.link \|\| ''/.test(shell) && /<span class="go">/.test(shell));
const settings = read('settings.html');
ok('Settings has the Notifications part, for a studio only, saving as you flip', /id="notify" aria-labelledby="notifyHead" hidden/.test(settings) && /if \(!\(CTX && CTX\.is_agency\)\) return Promise\.resolve\(\);/.test(settings) && /api\('\/agency\/notify\/' \+ encodeURIComponent\(siteId\), 'PUT', patch\)/.test(settings));

const passed = results.filter((x) => x.p).length;
console.log(`\n════ SITE NOTIFICATIONS (item 126): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
