// ── Back-office fixes from the full review of Nov 22, 2026 ─────────────────────
// Builder list items 261 (one "live" rule), 265 (Netlify's own addresses), 266 (the report
// on the 4th to 6th, once Google's month is in; the map scan in the last week), 267 (the
// studio hears first, and chooses whether the client is told), 268 (one client-email
// helper), 269 (the host's real plan, or "not known"), 282 (the studio's or the site's own
// day) and 283 (the Account menu's hint on its own line). Pure; every clock is pinned.
//
//   deno run --allow-read --allow-env --allow-net tests/presence/office_fixes_nov22_test.mjs
import { siteState, siteLive, publishedOnce, DOWN_THRESHOLD } from '../../supabase/functions/presence/lib/site_live.ts';
import { reportSiteLive } from '../../supabase/functions/presence/ops/monthly_report.ts';
import { nameCheckFrom, domainChecklist, netlifyAddressSet, NETLIFY_KNOWN_IPS, NETLIFY_APEX_NAME, checklistOk } from '../../supabase/functions/presence/lib/domain_health.ts';
import { apexMatchesExpected, NETLIFY_APEX_IP } from '../../supabase/functions/presence/platform/dns.ts';
import { reportDueNow, anyZoneInSendDays, googleMonthIn, normalizeReportSetting, REPORT_SEND_FROM, REPORT_SEND_TO } from '../../supabase/functions/presence/ops/monthly_report.ts';
import { gridDueNow, inLastWeek, nextScanDay, normalizeGridSetting } from '../../supabase/functions/presence/lib/rank_grid.ts';
import { normalizePref, applyNotifyChange, pickFlags, prefFor, NOTIFY_ALL } from '../../supabase/functions/presence/lib/site_notify.ts';
import { studioDownEmail, studioUpEmail } from '../../supabase/functions/presence/monitor/heartbeat.ts';
import { pickClientEmail, allClientEmails } from '../../supabase/functions/presence/lib/client_reach.ts';
import { ownerEmailsOf } from '../../supabase/functions/presence/lib/site_transfer.ts';
import { hostPlanFrom } from '../../supabase/functions/presence/lib/netlify.ts';
import { hostingArea, summarizeHealthCenter } from '../../supabase/functions/presence/lib/health_center.ts';
import { dayInZone, SITE_DEFAULT_TZ } from '../../supabase/functions/presence/lib/visits.ts';
import { publishDayLabel } from '../../supabase/functions/presence/routes/room.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const NOW = '2026-11-21T20:30:00.000Z';   // 12:30 pm in Burbank, Nov 21

// ═══ 261: one rule for "is this site live" ═══
{
  const pub = { edition: 'presence', status: 'ready', last_published_at: '2026-11-01T00:00:00Z' };
  ok('261: never published is not live, whatever its address', !publishedOnce({ edition: 'presence', status: 'ready', last_published_at: null }) && siteLive({ edition: 'presence', status: 'ready', last_published_at: null }).is_live === false);
  ok('261: published once and answering is live', siteLive(pub, { id: 's' }).is_live === true && siteLive(pub, { id: 's' }).published === true && siteState(pub).key === 'live');
  ok('261: taken offline is not live, though published', siteLive(pub, { id: 's', offline_at: '2026-11-20T00:00:00Z' }).is_live === false && siteLive(pub, { id: 's', offline_at: '2026-11-20T00:00:00Z' }).words === 'Offline');
  ok('261: not answering the probe is not live', siteLive(pub, { id: 's', uptime_fail_streak: DOWN_THRESHOLD }).key === 'down' && siteLive(pub, { id: 's', uptime_fail_streak: DOWN_THRESHOLD - 1 }).is_live === true);
  ok('261: a watched site on its own host is "elsewhere", not published here', siteLive({ ...pub, edition: 'monitor' }).key === 'elsewhere' && siteLive({ ...pub, edition: 'monitor' }).published === false);
  ok('261: the report’s "live" is the same rule (a watch plan counts)', reportSiteLive(pub) && !reportSiteLive({ edition: 'presence', status: 'ready', last_published_at: null }) && reportSiteLive({ edition: 'monitor', status: 'ready', last_published_at: null }));
}

// ═══ 265: Netlify's own addresses, looked up, never a leftover ═══
{
  const LB = ['75.2.60.5', '99.83.231.61'], OWN = ['52.52.192.191', '13.52.188.95'];
  const ours = netlifyAddressSet([LB, OWN]);
  ok('265: the set holds the fallback constant and every looked-up address', ours.has(NETLIFY_APEX_IP) && ours.has('99.83.231.61') && ours.has('52.52.192.191') && ours.size === 4 && NETLIFY_KNOWN_IPS.has(NETLIFY_APEX_IP) && NETLIFY_APEX_NAME === 'apex-loadbalancer.netlify.com');
  ok('265: a failed lookup adds nothing, and a name is never an address', netlifyAddressSet([[], ['example.com']]).size === 1);
  const flattened = nameCheckFrom('bistro.com', 'bistro.netlify.app', [], LB, ours);
  ok('265: a bare name flattened to the load balancer points here with NO leftover', flattened.points && flattened.leftovers.length === 0, JSON.stringify(flattened));
  const old = nameCheckFrom('bistro.com', 'bistro.netlify.app', [], LB);
  ok('265: (before) the same records with the old one-address list called 99.83.231.61 a leftover', old.points && old.leftovers.length === 1);
  const own = nameCheckFrom('bistro.com', 'bistro.netlify.app', [], OWN, ours);
  ok('265: a name flattened to the site’s own netlify.app address points here', own.points && own.leftovers.length === 0);
  const stale = nameCheckFrom('bistro.com', 'bistro.netlify.app', [], ['75.2.60.5', '203.0.113.9'], ours);
  ok('265: a real old record is still a leftover', stale.points && stale.leftovers.join() === '203.0.113.9');
  const lines = domainChecklist({ domain: 'bistro.com', names: [{ name: 'bistro.com', points: false, leftovers: [] }, { name: 'www.bistro.com', points: true, leftovers: [] }], padlockOn: true, padlockNames: ['bistro.com', 'www.bistro.com'], serving: 'latest', compared: true });
  ok('265: when the domain shows our latest page, its "points here" line passes whatever its records', lines.filter((l) => l.key.startsWith('points:')).every((l) => l.ok) && checklistOk(lines), JSON.stringify(lines));
  const twinOff = domainChecklist({ domain: 'bistro.com', names: [{ name: 'bistro.com', points: false, leftovers: [] }, { name: 'www.bistro.com', points: false, leftovers: [] }], padlockOn: true, padlockNames: ['bistro.com'], serving: 'latest', compared: true });
  ok('265: …but its twin keeps its own records test (the page was compared at the bare name)', twinOff.find((l) => l.key === 'points:bistro.com').ok && !twinOff.find((l) => l.key === 'points:www.bistro.com').ok && !checklistOk(twinOff));
  const notShown = domainChecklist({ domain: 'bistro.com', names: [{ name: 'bistro.com', points: false, leftovers: [] }], padlockOn: false, padlockNames: [], serving: 'other', compared: true });
  ok('265: showing something else, a name that doesn’t point still fails', notShown.find((l) => l.key === 'points:bistro.com').ok === false);
  const drift = apexMatchesExpected({ aRecords: ['99.83.231.61'], cnames: [] }, { target: 'bistro.netlify.app', ips: [...ours] });
  ok('265: the daily drift check accepts every Netlify address', drift.ok === true && apexMatchesExpected({ aRecords: ['99.83.231.61'], cnames: [] }, { target: 'bistro.netlify.app' }).ok === false);
}

// ═══ 266: the report on the 4th to 6th, once Google's month is in ═══
{
  const on = normalizeReportSetting({ enabled: true });
  const LA = 'America/Los_Angeles', NY = 'America/New_York';
  ok('266: the window is the 4th to 6th', REPORT_SEND_FROM === 4 && REPORT_SEND_TO === 6);
  ok('266: not due on the 1st, even with nothing sent', !reportDueNow(on, '2026-12-01T09:00:00.000Z', LA) && !reportDueNow(on, '2026-12-03T23:59:00.000Z', LA));
  ok('266: due on the 4th on the site’s clock (Dec 4, 00:30 in Los Angeles is 08:30 UTC)', reportDueNow(on, '2026-12-04T08:30:00.000Z', LA) && !reportDueNow(on, '2026-12-04T07:30:00.000Z', LA));
  ok('266: a site without Google waits for nothing', reportDueNow(on, '2026-12-04T12:00:00.000Z', NY, { connected: false, stored_at: null }));
  ok('266: a site with Google waits until its month was read on or after the 4th', !reportDueNow(on, '2026-12-04T12:00:00.000Z', NY, { connected: true, stored_at: '2026-12-03T07:00:00.000Z' }) && reportDueNow(on, '2026-12-04T12:00:00.000Z', NY, { connected: true, stored_at: '2026-12-04T07:01:00.000Z' }));
  ok('266: with Google connected and nothing stored, it waits', !reportDueNow(on, '2026-12-05T12:00:00.000Z', NY, { connected: true, stored_at: null }));
  ok('266: on the 6th it goes whatever Google did', reportDueNow(on, '2026-12-06T12:00:00.000Z', NY, { connected: true, stored_at: null }) && !reportDueNow(on, '2026-12-07T12:00:00.000Z', NY, { connected: true, stored_at: null }));
  ok('266: googleMonthIn is the 4th of the month after, UTC', googleMonthIn('2026-12-04T00:00:00.000Z', '2026-11') && !googleMonthIn('2026-12-03T23:59:59.000Z', '2026-11') && !googleMonthIn(null, '2026-11') && googleMonthIn('2027-01-04T07:00:00.000Z', '2026-12'));
  ok('266: the job wakes only when some clock is on a send day', !anyZoneInSendDays('2026-12-02T12:00:00.000Z') && anyZoneInSendDays('2026-12-03T13:00:00.000Z') && anyZoneInSendDays('2026-12-06T12:00:00.000Z') && anyZoneInSendDays('2026-12-07T11:00:00.000Z') && !anyZoneInSendDays('2026-12-15T12:00:00.000Z'));
  // the map grid scans in the last week of the month
  const g = normalizeGridSetting({ enabled: true, phrases: ['plumber'], place: { id: 'ChIJN1t_tDeuEmsRUsoyG83frY4', source: 'listing', confirmed_by: 'e', confirmed_at: '2026-10-01T00:00:00Z' }, month: '2026-10', last_result: { month: '2026-10', status: 'scanned', reason: null, at: '2026-10-26T00:00:00Z' } });
  ok('266: a client scanned before is not due mid-month', !!g.place && !gridDueNow(g, '2026-11-12T09:00:00.000Z'), JSON.stringify(g.place));
  ok('266: …and is due from the 24th (seven days left in November)', gridDueNow(g, '2026-11-24T09:00:00.000Z') && !gridDueNow(g, '2026-11-23T23:00:00.000Z') && inLastWeek('2026-11-30T23:00:00.000Z') && inLastWeek('2026-02-22T00:00:00.000Z') && !inLastWeek('2026-02-21T23:00:00.000Z'));
  ok('266: a client never scanned is due at once', gridDueNow({ ...g, last_result: null }, '2026-11-12T09:00:00.000Z'));
  ok('266: a month already handled is never due', !gridDueNow({ ...g, month: '2026-11' }, '2026-11-26T09:00:00.000Z'));
  ok('266: the next scan day named is the start of the last week', nextScanDay('2026-11-12T09:00:00.000Z') === 'Nov 24' && nextScanDay('2026-11-26T09:00:00.000Z') === 'Dec 25' && nextScanDay('2026-02-10T00:00:00.000Z') === 'Feb 22');
}

// ═══ 267: the studio hears first, and chooses whether the client is told ═══
{
  ok('267: the choice defaults to telling the client, as before', normalizePref({}).client_down === true && NOTIFY_ALL.client_down === true && prefFor({ sites: {} }, '11111111-1111-4111-8111-111111111111').client_down === true);
  const id = '11111111-1111-4111-8111-111111111111';
  const store = applyNotifyChange({ sites: {} }, id, { client_down: false });
  ok('267: switching it off for one client is kept, and only that', prefFor(store, id).client_down === false && prefFor(store, id).email === true && Object.keys(store.sites).length === 1);
  ok('267: switching it back on empties the entry (all on is the default)', Object.keys(applyNotifyChange(store, id, { client_down: true }).sites).length === 0);
  ok('267: the request body’s fourth flag is read, nothing else', JSON.stringify(pickFlags({ client_down: false, email: true, bogus: 1 })) === JSON.stringify({ email: true, client_down: false }));
  const told = studioDownEmail('https://bistro.com', true, 'Marlow’s Kitchen');
  const kept = studioDownEmail('https://bistro.com', false, null);
  ok('267: the studio’s words name the client and the site, and say whether the client was told', /Marlow’s Kitchen/.test(told.subject) && /bistro\.com isn’t answering/.test(told.subject) && /has been emailed/.test(told.html) && /NOT been emailed/.test(kept.html) && /A client’s website/.test(kept.html));
  ok('267: the back-up note is short and names the site', /bistro\.com is answering again/.test(studioUpEmail('https://bistro.com', null).subject));
  ok('267: a client name is escaped', /&lt;b&gt;/.test(studioDownEmail('https://x.com', true, '<b>').html));
}

// ═══ 268: one "client's email" helper reads all four places ═══
{
  const c = (o) => ({ client: { name: 'Marlow’s Kitchen', email: '', contact_email: '', contact_id: null, ...o.client }, contact: o.contact || null, person: o.person || null });
  ok('268: the client row’s own email first', pickClientEmail(c({ client: { email: 'Own@X.com', contact_email: 'two@x.com' } })).email === 'own@x.com');
  ok('268: then its contact email', pickClientEmail(c({ client: { contact_email: 'Two@x.com' }, contact: { email: 'three@x.com' } })).email === 'two@x.com');
  ok('268: then the sign-in contact', pickClientEmail(c({ contact: { email: 'Three@x.com' }, person: { email: 'four@x.com' } })).email === 'three@x.com');
  ok('268: then the linked person (Add a customer since Nov 16 saves it there)', pickClientEmail(c({ person: { name: 'Pat', email: 'Four@x.com' } })).email === 'four@x.com' && pickClientEmail(c({ person: { email: 'four@x.com' } })).name === 'Marlow’s Kitchen');
  ok('268: nowhere means null, never a zero-length string', pickClientEmail(c({})).email === null && pickClientEmail(null).email === null && pickClientEmail({ client: null, contact: null, person: null }).email === null);
  ok('268: every address, once each', JSON.stringify(allClientEmails(c({ client: { email: 'a@x.com' }, contact: { email: 'A@x.com' }, person: { email: 'b@x.com' } }))) === JSON.stringify(['a@x.com', 'b@x.com']));
  ok('268: the owner-facts helper counts the linked person too', ownerEmailsOf({ client: { id: 'c', email: '', contact_email: '', contact_id: null }, contact: null, person: { email: 'Four@x.com' } }).join() === 'four@x.com');
}

// ═══ 269: the host's real plan, or "not known" ═══
{
  const acct = { name: 'davis digital studio', type_name: 'Pro', plan_credits: 3000, capabilities: { credits: { included: 3000, used: 0 } }, current_billing_period_start: '2026-11-11T00:00:00Z', next_billing_period_start: '2026-12-11T00:00:00Z', usages_exceeded: false };
  const p0 = hostPlanFrom(acct, NOW, 12);
  ok('269: the plan, its credits and its dates are read', p0.ok && p0.plan === 'Pro' && p0.credits_included === 3000 && p0.next_period_start === '2026-12-11T00:00:00Z' && p0.team === 'davis digital studio');
  ok('269: "0 used" with publishes on record is NOT believed: used is not known', p0.credits_used === null);
  ok('269: a real used figure is kept', hostPlanFrom({ ...acct, capabilities: { credits: { included: 3000, used: 714.5 } } }, NOW, 12).credits_used === 714.5);
  ok('269: "0 used" with nothing published is believed', hostPlanFrom(acct, NOW, 0).credits_used === 0);
  const over = hostPlanFrom({ ...acct, usages_exceeded: true }, NOW, 12);
  ok('269: usage exceeded is read, and counts as the plan used up', over.exceeded && over.credits_used === 3000);
  ok('269: a plan with no numbers is still a plan', hostPlanFrom({ type_name: 'Personal' }, NOW).credits_included === null && hostPlanFrom({}, NOW).ok);
  ok('269: Health Center says "not known" rather than a number that isn’t one', /not known/.test(hostingArea(p0).detail) && hostingArea(p0).state === 'ok' && /3,000 credits a period/.test(hostingArea(p0).detail) && /renews Dec 11/.test(hostingArea(p0).detail));
  ok('269: Health Center flags a used-up plan', hostingArea(over).state === 'attention' && /paused until Dec 11/.test(hostingArea(over).detail));
  ok('269: no key reads as off; a refused key asks for a look', hostingArea(null).state === 'off' && hostingArea({ ...p0, ok: false, why: 'refused' }).state === 'attention' && hostingArea({ ...p0, ok: false, why: 'no_token' }).state === 'off');
  const base = { nowIso: NOW, cronLastRunAt: '2026-11-21T20:20:00Z', secretsMissingRequired: [], domainsWatched: 1, domainsExpiringSoon: 0, billing: { active: 1, paused: 0, lapsed: 0 }, aiConfigured: true, aiOpsThisMonth: 1, emailConfigured: true, sitesLive: 1, failedPublishes: 0, failedRuns: 0, activeNotices: 0, backupsVerified: true };
  const withHost = summarizeHealthCenter({ ...base, hosting: over }), without = summarizeHealthCenter(base);
  ok('269: the Hosting line joins Health Center when the host was asked, and not otherwise', withHost.areas.some((a) => a.key === 'hosting' && a.label === 'Hosting' && a.state === 'attention') && withHost.overall === 'attention' && !without.areas.some((a) => a.key === 'hosting'));
}

// ═══ 282: the studio's or the site's own day ═══
{
  ok('282: 7:19 pm in Burbank on Nov 21 is Nov 21 on the site’s clock, Nov 22 in UTC', dayInZone('2026-11-22T03:19:00.000Z', 'America/Los_Angeles') === '2026-11-21' && dayInZone('2026-11-22T03:19:00.000Z', 'UTC') === '2026-11-22');
  ok('282: no zone set means Los Angeles, as everywhere else', SITE_DEFAULT_TZ === 'America/Los_Angeles' && dayInZone('2026-11-22T03:19:00.000Z', null) === '2026-11-21');
  ok('282: a zone that isn’t one falls back to UTC, never throws', dayInZone('2026-11-22T03:19:00.000Z', 'Mars/Olympus') === '2026-11-22' && dayInZone('nonsense', 'UTC') === '');
  ok('282: a visitor across 4 pm Burbank stays one visitor (same day)', dayInZone('2026-11-21T23:30:00.000Z', 'America/Los_Angeles') === dayInZone('2026-11-22T00:30:00.000Z', 'America/Los_Angeles'));
  ok('282: "Last published" is the site’s own day', publishDayLabel('2026-11-22T04:29:00.000Z', 'America/Los_Angeles') === 'Sat, Nov 21' && publishDayLabel('2026-11-22T04:29:00.000Z', 'UTC') === 'Sun, Nov 22' && publishDayLabel('2026-11-22T04:29:00.000Z', 'Mars/Olympus') === 'Sat, Nov 21');
}

// 283 (the Account menu's hint on its own line), the Usage page's day and its gauge are checked in
// the browser: tests/e2e/menus-names-201-202.spec.ts and tests/e2e/usage-210.spec.ts.

const failed = results.filter((r) => !r.p);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log('FAILED:', failed.map((f) => f.n).join(' | ')); Deno.exit(1); }
