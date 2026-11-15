// ── Builder list items 236 and 232 (Nov 2026): the studio's Client portal page and a preview ──
//   deno run --allow-read --allow-env --allow-net tests/presence/portal_people_test.mjs
// The Client portal page counts the studio's clients by where they stand with the portal
// and lists five set-up steps. A client's card says when they were invited and last in,
// opens their portal as they see it (read-only, every write refused by the server) and
// sends them a sign-in link.
import * as Q from '../../supabase/functions/presence/lib/portal_people.ts';
import * as P from '../../supabase/functions/presence/lib/portal_settings.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${p || !note ? '' : ' — ' + note}`); };
const read = (p) => Deno.readTextFileSync(new URL('../../' + p, import.meta.url));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const NOW = Date.parse('2026-11-15T12:00:00Z');
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();

// ── where one client stands ──
ok('someone the portal has seen is in', Q.portalStateOf({ hasLogin: true, invitedAt: daysAgo(40), seenAt: daysAgo(2) }, NOW) === 'joined');
ok('seen counts even without a sign-in of record (an older client)', Q.portalStateOf({ hasLogin: false, invitedAt: null, seenAt: daysAgo(2) }, NOW) === 'joined');
ok('invited under a week ago and not in yet: waiting to join', Q.portalStateOf({ hasLogin: true, invitedAt: daysAgo(3), seenAt: null }, NOW) === 'waiting');
ok('seven days without coming in: the invite ran out', Q.portalStateOf({ hasLogin: true, invitedAt: daysAgo(7), seenAt: null }, NOW) === 'expired' && Q.INVITE_DAYS === 7);
ok('no sign-in of their own: not invited yet', Q.portalStateOf({ hasLogin: false, invitedAt: null, seenAt: null }, NOW) === 'none');
ok('an unreadable invite date waits rather than running out', Q.portalStateOf({ hasLogin: true, invitedAt: 'nope', seenAt: null }, NOW) === 'waiting');

// ── the four numbers ──
const people = [
  { site_id: 'a', name: 'A', email: '', state: 'joined', invited_at: daysAgo(60), seen_at: daysAgo(2) },
  { site_id: 'b', name: 'B', email: '', state: 'joined', invited_at: daysAgo(90), seen_at: daysAgo(45) },
  { site_id: 'c', name: 'C', email: '', state: 'waiting', invited_at: daysAgo(1), seen_at: null },
  { site_id: 'd', name: 'D', email: '', state: 'expired', invited_at: daysAgo(20), seen_at: null },
  { site_id: 'e', name: 'E', email: '', state: 'none', invited_at: null, seen_at: null },
];
ok('active is every client; waiting, ran out and the last 30 days are people', same(Q.portalCounts(people, NOW), { active: 5, waiting: 1, expired: 1, recent: 1 }));
ok('nobody yet: all zero', same(Q.portalCounts([], NOW), { active: 0, waiting: 0, expired: 0, recent: 0 }));

// ── the set-up list ──
const none = Q.setupList({ hasLogo: false, partsAt: null, welcome: '  ', previewedAt: null, invitedAny: false });
ok('five steps, in the drawing’s order, none done to start', same(none.map((s) => s.key), ['logo', 'parts', 'welcome', 'preview', 'invite']) && none.every((s) => !s.done));
const all = Q.setupList({ hasLogo: true, partsAt: daysAgo(1), welcome: 'Hi', previewedAt: daysAgo(1), invitedAny: true });
ok('each step ticks from its own fact', all.every((s) => s.done));

// ── the stamps the list reads ──
const EMPTY = P.normalizePortal(null);
ok('nothing stored: no parts or preview stamp', EMPTY.parts_at === null && EMPTY.previewed_at === null);
ok('a part’s switch stamps parts_at; a card or the note doesn’t', P.applyStudioChange(EMPTY, { part: { key: 'files', shown: false } }, '2026-11-15T12:00:00.000Z').parts_at === '2026-11-15T12:00:00.000Z'
  && P.applyStudioChange(EMPTY, { card: { key: 'updates', shown: false } }).parts_at === null && P.applyStudioChange(EMPTY, { welcome: 'Hi' }).parts_at === null);
ok('one client’s choice stamps it too', P.applyClientChange(EMPTY, 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', { part: 'files', shown: false }, '2026-11-15T12:00:00.000Z').parts_at === '2026-11-15T12:00:00.000Z');
ok('the first preview is kept, never moved', (() => { const a = P.markPreviewed(EMPTY, '2026-11-01T00:00:00.000Z'); const b = P.markPreviewed(a, '2026-11-15T00:00:00.000Z'); return a.previewed_at === '2026-11-01T00:00:00.000Z' && b.previewed_at === '2026-11-01T00:00:00.000Z'; })());
ok('a stamp that isn’t a date is dropped', P.normalizePortal({ parts_at: 'soon', previewed_at: 7 }).parts_at === null && P.normalizePortal({ previewed_at: 7 }).previewed_at === null);
ok('stamps survive a studio change', P.applyStudioChange(P.normalizePortal({ previewed_at: '2026-11-01T00:00:00Z' }), { welcome: 'Hi' }).previewed_at === '2026-11-01T00:00:00.000Z');

// ── the wiring ──
const people_src = read('supabase/functions/presence/lib/portal_people.ts');
ok('last in is noted at most once an hour, only when older', /or=\(portal_seen_at\.is\.null,portal_seen_at\.lt\.\$\{encodeURIComponent\(since\)\}\)/.test(people_src) && Q.SEEN_EVERY_MS === 3600000);
ok('a sign-in is looked up only for someone the portal hasn’t seen, eight at a time, fifty at most', /clients\.filter\(\(c\) => !c\.portal_seen_at\)/.test(people_src) && /\.slice\(0, 50\)/.test(people_src) && /i \+= 8/.test(people_src));
ok('ids are read in hundreds, never one long address', /i \+= 100/.test(people_src));

const routes = read('supabase/functions/presence/agency/routes.ts');
ok('GET /agency/portal/overview reads for anyone on the team', /route === '\/agency\/portal\/overview' && method === 'GET'\) \{\s*if \(!can\(member\.role, 'read'\)\) return forbid\(cors\);/.test(routes));
ok('one client’s card reads only one of your active clients', /if \(pp && method === 'GET'\) \{\s*if \(!can\(member\.role, 'read'\)\) return forbid\(cors\);/.test(routes) && /activeClientsOf\(input\)\.find\(\(c\) => c\.site_id === siteId\)/.test(routes));
ok('a sign-in link needs manage_clients, one of your clients with a sign-in, and two minutes between', /if \(sm && method === 'POST'\) \{\s*if \(!can\(member\.role, 'manage_clients'\)\) return forbid\(cors\);/.test(routes) && /2 \* 60_000/.test(routes) && /error: 'no_login'/.test(routes) && /sendCustomerInvite\(own\.id, p\.email, false\)/.test(routes));
ok('the address is the one the invite email carries', /portal\.html\?studio=\$\{studioSiteId\}/.test(routes));

const index = read('supabase/functions/presence/index.ts');
ok('a preview is only a studio drilled into that client', /if \(req\.headers\.get\('x-dds-preview'\) === '1'\) \{\s*if \(!principal\.scope \|\| principal\.scope\.site_id !== site\.id\) return json\(\{ error: 'preview_denied'/.test(index));
ok('a preview refuses every write before any route runs', /if \(method !== 'GET'\) return json\(\{ error: 'preview', message: 'This is a preview: nothing is saved or sent\.' \}, 403, cors\);/.test(index)
  && index.indexOf("req.headers.get('x-dds-preview') === '1'") < index.indexOf("route === '/portal/context' && method === 'GET') return handlePortalContext"));
ok('a preview answers the portal’s own reads only, with the client’s context', /if \(route === '\/portal\/context'\) return handlePortalPreviewContext\(site, principal\.scope, principal, cors\);/.test(index) && /route\.startsWith\('\/client\/'\) \|\| route === '\/portal\/feed' \|\| route === '\/connections\/ask'/.test(index));
const ws = read('supabase/functions/presence/routes/workspace.ts');
ok('the client opening their portal stamps last in, after the answer', /if \(isManagedClient && site\.client_id\) runAfterResponse\(import\('\.\.\/lib\/portal_people\.ts'\)\.then\(\(m\) => m\.stampPortalSeen\(String\(site\.client_id\)\)\)\);/.test(ws));
ok('the preview’s context is the client’s, stamps nothing as seen, and ticks the first preview', /export async function handlePortalPreviewContext\(/.test(ws) && /is_managed_client: true/.test(ws) && /preview: \{ site_id: site\.id, name: scope\.name, email:/.test(ws) && /if \(!ps\.previewed_at\) runAfterResponse\(updateReservedJson\(studioSiteId, RESERVED_NAMES\.portalSettings, \(cur\) => markPreviewed/.test(ws)
  && !/stampPortalSeen/.test(ws.slice(ws.indexOf('export async function handlePortalPreviewContext('))));
const cors = read('supabase/functions/_shared/cors.ts');
ok('the browser may send the preview header', /x-region, x-dds-preview'/.test(cors));
const nav = read('supabase/functions/presence/lib/navigation.ts');
ok('the menu has Client portal right under Customers, studio level only', /if \(studioLevel && f\.hasRelationship && f\.hasClientPortal\) sections\.push\(\{ key: 'client_portal', label: 'Client portal'/.test(nav) && nav.indexOf("key: 'client_portal'") > nav.indexOf("sections.push({ key: 'customers', label: 'Customers', items: customers });"));

const client = read('client.html');
ok('the portal asks as the client, drilled in, saying it’s a preview', /'x-dds-scope-site':PREVIEW\|\|/.test(client) && /PREVIEW\?\{'x-dds-preview':'1'\}:\{\}/.test(client));
ok('in a preview a write never leaves the page, and says so', /if\(PREVIEW&&method&&method!=='GET'\)\{PREVIEW_REFUSED=Date\.now\(\);/.test(client) && client.includes("const PREVIEW_MSG='This is a preview: nothing is saved, sent or paid.';"));
ok('this device keeps nothing of a preview', ['function rememberStudio(){if(PREVIEW)return;', 'function rememberedClient(){if(PREVIEW)return false;', 'function rememberPersona(c){if(PREVIEW)return;', 'function papersRemembered(){if(PREVIEW)return false;', 'function rememberPapers(){if(PREVIEW)return;', 'if(landsOnHome()&&!PREVIEW)paintHomeCache();'].every((x) => client.includes(x)) && /function saveHomeCache\(\)\{\s*if\(PREVIEW\)return;/.test(client));
ok('never the studio member’s own name or email', client.includes(":PREVIEW?'':firstName(USER);}") && /const email=PREVIEW\?String\(\(PORTAL\.ctx&&PORTAL\.ctx\.preview&&PORTAL\.ctx\.preview\.email\)\|\|''\)/.test(client));
ok('a paper’s or a payment’s link says it’s a preview instead of opening', /a\.hasAttribute\('data-pay'\)\|\|pays\.includes\(href\)\|\|\/\\\/doc\\\.html\\\?t=\/\.test\(href\)/.test(client));
ok('the strip names the client and goes back to them', /You’re seeing \$\{esc\(poss\)\} portal as \$\{esc\(name\)\} sees it\. Nothing you press is saved or sent, and nothing is marked as read\./.test(client) && /Back to \$\{esc\(name\)\}/.test(client));
ok('back goes only to a page of this app', /return \/\^\\\/\(\?!\[\\\/\\\\\]\)\[\^\\s\]\*\$\/\.test\(b\)\?b:'';/.test(client));

const settings = read('settings.html');
ok('a client’s card opens their portal and sends a sign-in link, or a new invite', /'\/client\.html\?preview=' \+ encodeURIComponent\(c\.site_id\)/.test(settings) && /'\/agency\/portal\/clients\/' \+ encodeURIComponent\(c\.site_id\) \+ '\/sign-in-link', 'POST'/.test(settings) && /'Send a new invite' : 'Send a sign-in link'/.test(settings));
const page = read('client-portal.html');
ok('the page reads its overview and draws the four numbers and the five steps', page.includes("api('/agency/portal/overview')") && ['Active clients', 'Waiting to join', 'Invites run out', 'In the last 30 days'].every((w) => page.includes(w)) && page.includes('Set up your portal'));
ok('See a client’s portal picks a client, then opens their preview', page.includes("'/client.html?preview='+encodeURIComponent(c.site_id)+'&back='+encodeURIComponent('/client-portal.html')") && page.includes('id="pick"'));

const passed = results.filter((x) => x.p).length;
console.log(`\n════ CLIENT PORTAL PAGE AND PREVIEW (items 236, 232): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
