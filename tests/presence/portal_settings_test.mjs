// ── Builder list items 229, 233 and 238 (Nov 2026): what a studio's clients see in the portal ──
//   deno run --allow-read --allow-env --allow-net tests/presence/portal_settings_test.mjs
// A studio turns parts of the portal off for every client, or changes one part for one
// client. A part that's off is refused by the server too, not only hidden. A welcome note
// and Home's cards are the studio's, the same for every client. Documents only shows when
// there's something in it. A failed read hides nothing.
import * as P from '../../supabase/functions/presence/lib/portal_settings.ts';
import { RESERVED_NAMES } from '../../supabase/functions/presence/lib/reserved_store.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${p || !note ? '' : ' — ' + note}`); };
const read = (p) => Deno.readTextFileSync(new URL('../../' + p, import.meta.url));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const S1 = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', S2 = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const EMPTY = P.normalizePortal(null);

// ── the setting ──
ok('with nothing stored, every part and card shows and there is no note', same(EMPTY, { off: [], clients: {}, welcome: '', home_off: [] }));
ok('an unreadable setting shows everything', same(P.normalizePortal('nonsense'), EMPTY) && same(P.normalizePortal({ off: 'invoices', home_off: 7, clients: [] }), EMPTY));
ok('only known parts and cards are kept, each once, in Settings’ order', same(P.normalizePortal({ off: ['reports', 'nope', 'invoices', 'reports'], home_off: ['projects', 'website', 'x'] }), { off: ['invoices', 'reports'], clients: {}, welcome: '', home_off: ['website', 'projects'] }));
ok('only real client site ids are kept, lower-case, and a client with no choice is dropped', (() => {
  const s = P.normalizePortal({ clients: { [S1.toUpperCase()]: { invoices: false, nope: true, files: 'no' }, 'not-a-site': { invoices: false }, [S2]: {} } });
  return same(Object.keys(s.clients), [S1]) && same(s.clients[S1], { invoices: false });
})());
ok('the client list is capped', Object.keys(P.normalizePortal({ clients: Object.fromEntries(Array.from({ length: P.PORTAL_MAX_CLIENTS + 5 }, (_, i) => [`dddddddd-0000-4000-8000-${String(i).padStart(12, '0')}`, { files: false }])) }).clients).length === P.PORTAL_MAX_CLIENTS);
ok('the setting has its own reserved name', RESERVED_NAMES.portalSettings === '__portal_settings__');
ok('Settings lists nine parts and three cards, each with its words', P.PORTAL_PARTS.length === 9 && P.HOME_CARDS.length === 3 && P.PORTAL_PARTS.every((p) => P.PART_WORDS[p][0] && P.PART_WORDS[p][1]) && P.HOME_CARDS.every((c) => P.CARD_WORDS[c][0]));

// ── the welcome note ──
ok('the note is plain text, trimmed, at most 500 characters', P.cleanWelcome('  Hi there  ') === 'Hi there' && P.cleanWelcome('x'.repeat(600)).length === P.WELCOME_MAX && P.WELCOME_MAX === 500);
ok('control characters go; line breaks stay, at most one blank line in a row', P.cleanWelcome('a\u0000b\r\nc\n\n\n\nd\u0007') === 'ab\nc\n\nd');
ok('a note that isn’t text is no note', P.cleanWelcome(42) === '' && P.cleanWelcome(null) === '');

// ── what one client sees: their own choice first, else the studio's ──
const st = P.normalizePortal({ off: ['reports', 'help'], clients: { [S1]: { reports: true, invoices: false } } });
ok('a part the studio turned off is off for every client', !P.partShown(st, S2, 'reports') && !P.partShown(st, S2, 'help') && P.partShown(st, S2, 'invoices'));
ok('one client’s own choice wins, either way', P.partShown(st, S1, 'reports') && !P.partShown(st, S1, 'invoices') && !P.partShown(st, S1, 'help'));
ok('the client’s id is matched in any case', P.partShown(st, S1.toUpperCase(), 'reports'));
ok('the list of what’s off is in Settings’ order', same(P.resolveOff(st, S1), ['invoices', 'help']) && same(P.resolveOff(st, S2), ['reports', 'help']));
ok('with Messages off, Ask for a service is off too (a request becomes a conversation)', same(P.resolveOff(P.normalizePortal({ off: ['messages'] }), S1), ['messages', 'services']));
ok('no client id reads the studio’s choices', same(P.resolveOff(st, null), ['reports', 'help']));

// ── a studio's change: one thing at a time, applied to what's stored ──
ok('a change takes one part, one card or the note, nothing else', same(P.pickStudioChange({ part: 'files', shown: false, off: ['invoices'], clients: {} }), { part: { key: 'files', shown: false } })
  && same(P.pickStudioChange({ card: 'updates', shown: true }), { card: { key: 'updates', shown: true } })
  && same(P.pickStudioChange({ welcome: ' Hello ' }), { welcome: 'Hello' }));
ok('an unknown part, a card that isn’t one, or a flag that isn’t true or false is no change', !Object.keys(P.pickStudioChange({ part: 'nope', shown: false })).length && !Object.keys(P.pickStudioChange({ card: 'files', shown: false })).length && !Object.keys(P.pickStudioChange({ part: 'files', shown: 'no' })).length && !Object.keys(P.pickStudioChange(null)).length);
ok('turning a part off keeps what someone else turned off a moment before', (() => {
  const theirs = P.applyStudioChange(EMPTY, P.pickStudioChange({ part: 'reports', shown: false }));
  const ours = P.applyStudioChange(theirs, P.pickStudioChange({ part: 'files', shown: false }));
  return same(ours.off, ['files', 'reports']);
})());
ok('turning it back on removes only that part', same(P.applyStudioChange(P.normalizePortal({ off: ['files', 'reports'] }), { part: { key: 'files', shown: true } }).off, ['reports']));
ok('a card change leaves the parts and the note', (() => { const s = P.applyStudioChange(P.normalizePortal({ off: ['help'], welcome: 'Hi' }), { card: { key: 'projects', shown: false } }); return same(s.home_off, ['projects']) && same(s.off, ['help']) && s.welcome === 'Hi'; })());
ok('a note change leaves the switches; an empty note is no note', (() => { const s = P.applyStudioChange(P.normalizePortal({ off: ['help'], home_off: ['updates'], welcome: 'Hi' }), P.pickStudioChange({ welcome: '' })); return s.welcome === '' && same(s.off, ['help']) && same(s.home_off, ['updates']); })());
ok('a studio change keeps every client’s own choices', same(P.applyStudioChange(st, { part: { key: 'files', shown: false } }).clients, st.clients));

// ── one client's change ──
ok('a client change takes one part with true, false or null, or a reset', same(P.pickClientChange({ part: 'files', shown: false }), { part: 'files', shown: false }) && same(P.pickClientChange({ part: 'files', shown: null }), { part: 'files', shown: null }) && same(P.pickClientChange({ reset: true, part: 'files' }), { reset: true }));
ok('anything else is no change', P.pickClientChange({ part: 'files' }) === null && P.pickClientChange({ part: 'nope', shown: true }) === null && P.pickClientChange({ reset: 'yes' }) === null && P.pickClientChange(null) === null);
ok('a client’s own choice is kept beside the studio’s', same(P.applyClientChange(EMPTY, S1, { part: 'invoices', shown: false }).clients, { [S1]: { invoices: false } }));
ok('a choice that matches the studio’s is no choice: it reads “Same as studio”', (() => {
  const s = P.normalizePortal({ off: ['reports'] });
  return !Object.keys(P.applyClientChange(s, S1, { part: 'reports', shown: false }).clients).length && !Object.keys(P.applyClientChange(s, S1, { part: 'files', shown: true }).clients).length;
})());
ok('null puts one part back to the studio’s choice and keeps the client’s others', same(P.applyClientChange(st, S1, { part: 'reports', shown: null }).clients, { [S1]: { invoices: false } }));
ok('a reset puts every part back to the studio’s, and leaves other clients', (() => {
  const s = P.normalizePortal({ clients: { [S1]: { files: false }, [S2]: { help: false } } });
  return same(P.applyClientChange(s, S1.toUpperCase(), { reset: true }).clients, { [S2]: { help: false } });
})());

// ── which request belongs to which part (the server refuses a part that's off) ──
const R = (route) => P.partForClientRoute(route, 'GET');
ok('invoices: the billing read and a retainer', R('/client/billing') === 'invoices' && R('/client/retainers/abc/cancel') === 'invoices');
ok('reports: the list and each month’s PDF', R('/client/reports') === 'reports' && R('/client/reports/2026-10/pdf') === 'reports' && R('/client/reports/latest') === null);
ok('book, services and help each have theirs; the hand-over kit’s files go with Help', R('/client/book') === 'book' && R('/client/services') === 'services' && R('/client/faq') === 'help' && R('/client/kit') === 'help' && R('/client/kit/files/f1') === 'help' && R('/client/kitchen') === null);
ok('messages: support, its threads, and a project’s messages', R('/client/support') === 'messages' && R('/client/support/t1/reply') === 'messages' && R('/client/projects/p1/messages') === 'messages');
ok('files stay open: a to-do’s upload and an approval’s download use them', R('/client/files') === null && R('/client/files/f1/download') === null && R('/client/uploads') === null);
ok('a project, the documents read and Home’s reads are never refused', R('/client/projects') === null && R('/client/projects/p1') === null && R('/client/documents') === null && R('/client/website') === null);

// ── a failed read hides nothing ──
ok('a site with no studio has nothing off', same(await P.portalOffFor({ id: S1, client_id: null }), []));

// ── the wiring ──
const routes = read('supabase/functions/presence/agency/routes.ts');
ok('GET /agency/portal reads for anyone who can read, and lists the active clients by name', /route === '\/agency\/portal' && method === 'GET'\) \{\s*if \(!can\(member\.role, 'read'\)\) return forbid\(cors\);/.test(routes) && /input\.links\.filter\(\(l\) => l\.status === 'active'\)\s*\n?\s*\.map\(\(l\) => \(\{ site_id: l\.site_id, name: input\.clientNames\[l\.site_id\]/.test(routes));
ok('a failed read says so instead of showing every switch on', /readReservedJsonOrThrow\(own\.id, RESERVED_NAMES\.portalSettings\)[\s\S]{0,80}catch \{ return json\(\{ error: 'read_failed'/.test(routes));
ok('PUT /agency/portal needs manage_clients and a real change, and saves by compare-and-swap', /route === '\/agency\/portal' && method === 'PUT'\) \{\s*if \(!can\(member\.role, 'manage_clients'\)\) return forbid\(cors\);/.test(routes) && /updateReservedJson\(own\.id, RESERVED_NAMES\.portalSettings, \(cur\) => applyStudioChange\(normalizePortal\(cur\), change\)/.test(routes));
ok('PUT /agency/portal/clients/:site needs manage_clients and one of your active clients', /if \(pm && method === 'PUT'\) \{\s*if \(!can\(member\.role, 'manage_clients'\)\) return forbid\(cors\);/.test(routes) && /input\.links\.some\(\(l\) => l\.site_id === siteId && l\.status === 'active'\)/.test(routes) && /applyClientChange\(normalizePortal\(cur\), siteId, change\)/.test(routes));
ok('a save forgets this server’s short memory, so the portal follows at once', (routes.match(/forgetPortalOff\(\);/g) || []).length === 2);
const index = read('supabase/functions/presence/index.ts');
ok('every /client/ request is checked before its route runs', /if \(route\.startsWith\('\/client\/'\)\) \{[\s\S]{0,200}partForClientRoute\(route, method\);[\s\S]{0,120}\(await portalOffFor\(site\)\)\.includes\(part\)\) return json\(\{ error: 'hidden'[\s\S]{0,120}403, cors\);/.test(index)
  && index.indexOf("route.startsWith('/client/')") < index.indexOf("route === '/client/projects' && method === 'GET'"));
const delivery = read('supabase/functions/presence/routes/client_delivery.ts');
ok('Documents leaves out proposals and estimates, or agreements, that are off', /off\.includes\('proposals'\) && \(d\.kind === 'proposal' \|\| d\.kind === 'estimate'\)/.test(delivery) && /off\.includes\('agreements'\) && d\.kind === 'contract'/.test(delivery) && /documents: shown/.test(delivery));
const ws = read('supabase/functions/presence/routes/workspace.ts');
ok('the portal’s context carries what’s off, the note and Home’s cards, read beside the brand', /readPortalSettings\(studioSiteId\)\.then\(\(s\) => \(\{ off: m\.resolveOff\(s, site\.id\), welcome: s\.welcome, home_off: s\.home_off \}\)\)\)\.catch\(\(\) => null\)/.test(ws) && /portal: portalSettings,/.test(ws));

const settings = read('settings.html');
ok('Settings has both cards, for a studio only, hidden until their read answers', /id="portalParts" aria-labelledby="portalPartsHead" hidden/.test(settings) && /id="portalHome" aria-labelledby="portalHomeHead" hidden/.test(settings) && /function loadPortalSettings\(\) \{\s*if \(!\(CTX && CTX\.is_agency\)\) return Promise\.resolve\(\);/.test(settings));
ok('a flip sends one change, and a failed save puts the switch back', /api\('\/agency\/portal', 'PUT', \{ part: k, shown: show \}\)/.test(settings) && /api\('\/agency\/portal\/clients\/' \+ encodeURIComponent\(c\.site_id\), 'PUT', \{ part: k, shown: show \}\)/.test(settings) && /undo\(\); paintPortalParts\(\); toast\(/.test(settings));
ok('inside a client the card is that client’s, with a way back to the studio’s choices', /possessive\(who\) \+ ' portal'/.test(settings) && /'PUT', \{ reset: true \}\)/.test(settings) && /Same as studio/.test(settings));
ok('the note and Home’s cards stay at studio level', /if \(!SCOPE\) \{ paintPortalHome\(\); \$\('portalHome'\)\.hidden = false; \}/.test(settings) && /maxlength="500"/.test(settings));
ok('Settings starts the read beside Notifications, and search finds it', /loadNotify\(\);[^\n]*\n\s*loadPortalSettings\(\);/.test(settings) && /key: 'portal', href: '#portalParts'/.test(settings));

const client = read('client.html');
ok('the portal reads what’s off from its context', /PORTAL\.off=new Set\(/.test(client) && /c\.portal/.test(client));
ok('a tab with nothing left in it is gone from the menu, and its address goes Home', /function tabShown\(t\)/.test(client) && /TABS\.filter\(t=>PORTAL\.persona!=='client'\|\|tabShown\(t\[0\]\)\)/.test(client) && /if\(PORTAL\.persona==='client'&&!tabShown\(tab\)\)tab='home';/.test(client));
ok('Documents only shows when there’s something in it (item 238)', /async function decidePapers\(/.test(client) && /PORTAL\.papers!==false/.test(client));
ok('the welcome note is on Home, signed with the studio’s name', /function welcomeNoteHtml\(\)/.test(client) && /id="home-note"/.test(client));
ok('Home’s cards follow the studio’s choice; Needs you always stays', /cardOn\('website'\)/.test(client) && /cardOn\('updates'\)/.test(client) && /cardOn\('projects'\)/.test(client) && !/cardOn\('needs/.test(client));

const passed = results.filter((x) => x.p).length;
console.log(`\n════ PORTAL SETTINGS (items 229, 233, 238): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
