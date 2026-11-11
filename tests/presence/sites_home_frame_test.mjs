// ── Nov 2026 review, bug hunt group A: Sites, Home and the frame ──
//   deno run --allow-read --allow-env tests/presence/sites_home_frame_test.mjs
// A2: a snooze holds only until something new happens under the same row key.
// The rest are page fixes, pinned here by their code and driven in a browser by
// tests/e2e/sites-home-frame.spec.ts.
import { needsYouPayload, stillAsleep } from '../../supabase/functions/presence/agency/needs_you.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}${note ? ' — ' + note : ''}`); };
const read = (p) => Deno.readTextFileSync(new URL('../../' + p, import.meta.url));

// ═══ A2: news under a snoozed key wakes the row ═══
{
  const asleep = new Set(['message:t1']);
  ok('asleep by key with nothing newer', stillAsleep({ key: 'message:t1', since: '2026-11-01T10:00:00Z' }, asleep, { 'message:t1': '2026-11-02T10:00:00Z' }));
  ok('a message after the snooze wakes it', !stillAsleep({ key: 'message:t1', since: '2026-11-03T10:00:00Z' }, asleep, { 'message:t1': '2026-11-02T10:00:00Z' }));
  ok('a row without a time keeps the key’s answer', stillAsleep({ key: 'message:t1' }, asleep, { 'message:t1': '2026-11-02T10:00:00Z' }));
  ok('a snooze without a time keeps the key’s answer', stillAsleep({ key: 'message:t1', since: '2026-11-03T10:00:00Z' }, asleep, {}));
  ok('a key that isn’t snoozed is awake', !stillAsleep({ key: 'message:t2', since: null }, asleep, {}));
  ok('a time that can’t be read keeps the key’s answer', stillAsleep({ key: 'message:t1', since: 'soon' }, asleep, { 'message:t1': '2026-11-02T10:00:00Z' }));

  const NOW = '2026-11-04T12:00:00Z', UNTIL = '2026-11-06T12:00:00Z';
  const input = (msgAt) => ({
    nowIso: NOW, links: [{ site_id: 's1', status: 'active' }], clientNames: { s1: 'Fennel Street' },
    sites: [{ id: 's1', edition: 'presence', status: 'live', last_published_at: '2026-10-01T00:00:00Z' }],
    lastChange: { s1: '2026-11-03T09:00:00Z' },
    own: { site_id: 'own1', messages: [{ type: 'message', tier: 'needs_you', client_id: 'c1', client: 'Fennel Street', thread_key: 't1', count: 1, created_at: msgAt }] },
    snoozed: { 'message:t1': UNTIL, 'publish:s1': UNTIL },
    snoozedAt: { 'message:t1': '2026-11-02T10:00:00Z', 'publish:s1': '2026-11-03T10:00:00Z' },
  });
  const quiet = needsYouPayload(input('2026-11-01T10:00:00Z'));
  ok('the message snoozed before it came in stays asleep', quiet.snoozed.some((r) => r.key === 'message:t1') && ![...quiet.rows, ...quiet.rest].some((r) => r.key === 'message:t1'));
  const fresh = needsYouPayload(input('2026-11-03T10:00:00Z'));
  ok('the customer’s NEXT message is on the list, not born asleep', [...fresh.rows, ...fresh.rest].some((r) => r.key === 'message:t1') && !fresh.snoozed.some((r) => r.key === 'message:t1'));
  ok('…and it counts toward the bell', fresh.total === quiet.total + 1, `${fresh.total} vs ${quiet.total}`);
  ok('a change made before its snooze stays snoozed', quiet.snoozed.some((r) => r.key === 'publish:s1'));
  const later = needsYouPayload({ ...input('2026-11-01T10:00:00Z'), lastChange: { s1: '2026-11-04T08:00:00Z' } });
  ok('a change made after the snooze is back on the list', [...later.rows, ...later.rest].some((r) => r.key === 'publish:s1'));
}
{
  const ny = read('supabase/functions/presence/agency/needs_you.ts');
  ok('message, failed publish, unpublished changes, late steps and support carry `since`', ['since: m.created_at', 'since: p.created_at', 'since: lc', 'since: d.next_step_at', 'since: s.last_activity_at'].every((x) => ny.includes(x)));
  ok('a support request’s `since` is its last message only (a stamp also moves updated_at)', !/since: s\.last_activity_at \?\? s\.updated_at/.test(ny));
  const routes = read('supabase/functions/presence/agency/routes.ts');
  ok('the snooze read carries when each was made', /presence_needs_snoozes\?agency_id=eq\.\$\{member\.agency_id\}&until=gt\.[^`]*&select=row_key,until,created_at/.test(routes) && /snoozedAt: Object\.fromEntries/.test(routes));
  ok('a re-snooze restarts "since when"', /created_by: principal\.email \|\| principal\.userId \|\| null, created_at: now \}/.test(routes));
}

// ═══ the page fixes, by their code ═══
const sites = read('sites.html'), shell = read('shell.js'), css = read('shell.css'), create = read('create.js');
const agency = read('agency.html'), contacts = read('contacts.html'), customers = read('customers.html'), today = read('today.html');
ok('A1: the Sites filter click is wired once', /if\(mn&&!mn\.dataset\.filterWired\)\{mn\.dataset\.filterWired='1';mn\.addEventListener\('click'/.test(sites) && !/^\s*\$\('main'\)\.addEventListener\('click'/m.test(sites));
ok('A3: the phone bar keeps a + when the sales bar can’t be drawn', /var plusHere = canCreate\(\);/.test(shell) && /#dds-mbar\.sales,#dds-mbar\.plus\{align-items:center\}/.test(css));
ok('A4: no message sends anyone to the Starter kits card that left Home', ![sites, agency, contacts, customers].some((p) => /Starter kits card on your studio home|try a starter kit from Home|use a starter kit instead/.test(p)));
ok('A4: a kit that didn’t apply offers it again, on all three add-a-customer forms', [agency, contacts, customers].every((p) => /id="cu-kit-again">Try the kit again</.test(p) && /kitRetry=applyKit/.test(p)));
ok('A5: Go through them removes the saved row by key, and Skip waits while one saves', /const skip=\(\)=>\{if\(F\.busy\)return;/.test(agency) && /F\.list\.findIndex\(x=>x\.key===r\.key\)/.test(agency));
ok('A6: an open housekeeping form keeps its fields across a redraw', /const hkVals=hkf\?Array\.from\(hkf\.elements\)/.test(agency) && /if\(hkVals\)\{const nf=document\.querySelector\(hkSel\)/.test(agency));
ok('A7: the bell’s repaint also sets the phone bar’s Inbox number', /paintMobileInboxDot\(\);\n  \}/.test(shell) && /a\[data-mbar="inbox"\] \.mlbl/.test(shell) && /<a data-mbar="inbox" href=/.test(shell));
ok('A8: a failed people read is kept, with Try again', /var WHO_ERR = '';/.test(create) && /if \(!DATA && WHO_ERR\)/.test(create) && /class="cr-retry">Try again</.test(create));
ok('A9: a save answers only the form that sent it', /var mine = S;/.test(create) && /var stillMine = function \(\) \{ return S === mine && dlg && dlg\.open; \};/.test(create) && /function finishDone\(/.test(create) && /function failForm\(/.test(create));
ok('A10: Duplicate remembers the customer step and retries only the copy', /DUP_MADE=\{site_id:d\.site_id/.test(sites) && /id="dup-again">Try copying again</.test(sites) && /We lost the connection while copying the setup\./.test(sites));
ok('A11: Switch site closes with the other layers', /closeDrawer\(\); closeShortcuts\(\);\n    if \(siteSwitchPop\(\)\) closeSiteSwitch\(false\);/.test(shell));
ok('A12: the waiting tab knows when it saw only 100 deals, and dates in the viewer’s day', /DEALS_CUT=Array\.isArray\(deals\)&&deals\.length>=100/.test(agency) && /daysBetween\(localDayOf\(d\.updated_at\),today\)/.test(agency));
ok('A13: a re-read no longer closes the opened list', !/^\s*NEEDS_EXPANDED=false;/m.test(agency.split('async function mountNeeds')[1] || ''));
ok('A14: a failed Dismiss or Done on the Overview says so', (today.match(/bug hunt A14/g) || []).length === 2);

const passed = results.filter((r) => r.p).length;
console.log(`${passed}/${results.length} passed`);
if (passed !== results.length) Deno.exit(1);
