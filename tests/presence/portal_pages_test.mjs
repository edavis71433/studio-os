// ── Builder list item 234 (Nov 2026): pages and quick links the studio makes for its clients ──
//   deno run --allow-read --allow-env --allow-net tests/presence/portal_pages_test.mjs
// A page has a title, words, and links, videos and files, and is shown to every client or
// to chosen ones; up to six quick links go to a web address or a place in the portal. They
// sit at the top of the client's Help. A page chosen for others is never sent to a client,
// and a page's file opens through a fresh link only for a client who may see that page.
import * as G from '../../supabase/functions/presence/lib/portal_pages.ts';
import { RESERVED_NAMES } from '../../supabase/functions/presence/lib/reserved_store.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${p || !note ? '' : ' — ' + note}`); };
const read = (p) => Deno.readTextFileSync(new URL('../../' + p, import.meta.url));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const P1 = '11111111-aaaa-4aaa-8aaa-111111111111', P2 = '22222222-bbbb-4bbb-8bbb-222222222222', L1 = '33333333-cccc-4ccc-8ccc-333333333333';
const S1 = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', S2 = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const M1 = '44444444-dddd-4ddd-8ddd-444444444444';
const NOW = '2026-11-15T12:00:00.000Z';
const EMPTY = G.normalizePages(null);

// ── a page ──
ok('nothing stored: no pages, no links', same(EMPTY, { pages: [], links: [] }) && same(G.normalizePages('nonsense'), EMPTY));
ok('the setting has its own reserved name', RESERVED_NAMES.portalPages === '__portal_pages__');
const page = G.cleanPage({ title: '  Welcome   guide ', words: 'Here’s how we’ll work together.\r\n\r\n\r\n\r\nEach week…', items: [], who: 'all' }, P1, NOW);
ok('a page keeps its title on one line and its words with their breaks', !!page && page.title === 'Welcome guide' && page.words === 'Here’s how we’ll work together.\n\nEach week…' && page.updated_at === NOW);
ok('a page needs a title and an id', G.cleanPage({ title: '   ' }, P1) === null && G.cleanPage({ title: 'Hi' }, 'nope') === null);
ok('the title and words are capped', G.cleanPage({ title: 'x'.repeat(200), words: 'y'.repeat(9000) }, P1).title.length === G.TITLE_MAX && G.cleanPage({ title: 'T', words: 'y'.repeat(9000) }, P1).words.length === G.WORDS_MAX);
ok('links and videos are https addresses only; nothing that runs', (() => {
  const p = G.cleanPage({ title: 'T', items: [
    { kind: 'link', label: 'Brand board', url: 'https://example.com/brand' },
    { kind: 'link', url: 'javascript:alert(1)' }, { kind: 'link', url: 'http://plain.example' }, { kind: 'video', url: 'https://www.youtube.com/watch?v=abc' },
    { kind: 'link', url: 'https://no-dot' }, { kind: 'script', url: 'https://example.com' },
  ] }, P1);
  return p.items.length === 2 && p.items[0].label === 'Brand board' && p.items[1].kind === 'video' && p.items[1].label === 'Watch the video';
})());
ok('a link with no name is named by its address', G.cleanPage({ title: 'T', items: [{ kind: 'link', url: 'https://example.com/guide/' }] }, P1).items[0].label === 'example.com/guide');
ok('a file is one of the studio’s files, by id', (() => { const p = G.cleanPage({ title: 'T', items: [{ kind: 'file', label: 'Logo pack', media_id: M1 }, { kind: 'file', media_id: 'nope' }] }, P1); return p.items.length === 1 && p.items[0].media_id === M1 && !('url' in p.items[0]); })());
ok('at most twelve things on a page', G.cleanPage({ title: 'T', items: Array.from({ length: 20 }, () => ({ kind: 'link', url: 'https://example.com' })) }, P1).items.length === G.MAX_ITEMS);
ok('who sees it: every client, or chosen real client sites', G.cleanPage({ title: 'T' }, P1).who === 'all' && same(G.cleanPage({ title: 'T', who: [S1, 'nope', S1.toUpperCase(), S2] }, P1).who, [S1, S2]));

// ── a quick link ──
ok('a quick link goes to an https address or a place in the portal', same(G.cleanLink({ label: 'Your website', to: 'https://example.com' }, L1), { id: L1, label: 'Your website', to: 'https://example.com/' }) && G.cleanLink({ label: 'Book a call', to: 'book' }, L1).to === 'book');
ok('anything else is no link', G.cleanLink({ label: 'X', to: 'javascript:x' }, L1) === null && G.cleanLink({ label: '', to: 'book' }, L1) === null && G.cleanLink({ label: 'X', to: 'settings' }, L1) === null);

// ── saving, one at a time ──
const one = G.putPage(EMPTY, page);
ok('a new page goes at the end; saving it again replaces it where it is', (() => { const two = G.putPage(one, G.cleanPage({ title: 'Brand files' }, P2, NOW)); const again = G.putPage(two, G.cleanPage({ title: 'Welcome guide, v2' }, P1, NOW)); return same(again.pages.map((p) => p.title), ['Welcome guide, v2', 'Brand files']); })());
ok('twenty pages is the most; the twenty-first is refused', (() => { let s = EMPTY; for (let i = 0; i < 20; i++) s = G.putPage(s, G.cleanPage({ title: 'P' + i }, `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)); return s.pages.length === 20 && G.putPage(s, G.cleanPage({ title: 'one more' }, P1)) === null; })());
ok('six quick links is the most', (() => { let s = EMPTY; for (let i = 0; i < 6; i++) s = G.putLink(s, G.cleanLink({ label: 'L' + i, to: 'book' }, `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)); return s.links.length === 6 && G.putLink(s, G.cleanLink({ label: 'one more', to: 'book' }, L1)) === null; })());
ok('delete takes only that one', G.dropPage(G.putPage(one, G.cleanPage({ title: 'B' }, P2)), P1).pages.length === 1 && G.dropLink(G.putLink(EMPTY, G.cleanLink({ label: 'L', to: 'book' }, L1)), L1).links.length === 0);

// ── who sees which page ──
const mixed = G.putPage(G.putPage(EMPTY, G.cleanPage({ title: 'For everyone', who: 'all' }, P1)), G.cleanPage({ title: 'For Harbor only', who: [S2] }, P2));
ok('every client sees the pages for all; a chosen page only for those chosen', same(G.pagesFor(mixed, S1).map((p) => p.title), ['For everyone']) && same(G.pagesFor(mixed, S2.toUpperCase()).map((p) => p.title), ['For everyone', 'For Harbor only']));
ok('the line under a title is the first line, cut at a word', G.subLine('How we’ll work together\nMore here') === 'How we’ll work together' && G.subLine('word '.repeat(40)).endsWith('…') && G.subLine('word '.repeat(40)).length <= 71 && G.subLine('') === '');

// ── the wiring ──
const routes = read('supabase/functions/presence/agency/routes.ts');
ok('GET /agency/portal/pages reads for anyone on the team, failing loudly', /route === '\/agency\/portal\/pages' && method === 'GET'\) \{\s*if \(!can\(member\.role, 'read'\)\) return forbid\(cors\);/.test(routes) && /readReservedJsonOrThrow\(own\.id, RESERVED_NAMES\.portalPages\)[\s\S]{0,80}catch \{ return json\(\{ error: 'read_failed'/.test(routes));
ok('a page or a link changes one at a time, with manage_clients, by compare-and-swap', /if \(pm && \(method === 'PUT' \|\| method === 'DELETE'\)\) \{\s*if \(!can\(member\.role, 'manage_clients'\)\) return forbid\(cors\);/.test(routes) && /updateReservedJson\(own\.id, RESERVED_NAMES\.portalPages, \(cur\) => \{/.test(routes) && /error: 'full'/.test(routes));
const index = read('supabase/functions/presence/index.ts');
ok('the client reads their pages, and a page’s file, through their own routes', /route === '\/client\/portal-pages' && method === 'GET'\) return \(await import\('\.\/routes\/client_pages\.ts'\)\)\.handleClientPortalPages\(site, cors\)/.test(index) && /\/\^\\\/client\\\/portal-pages\\\/files\\\/\(\[\^\/\]\+\)\$\//.test(index));
const cp = read('supabase/functions/presence/routes/client_pages.ts');
ok('only the pages this client may see are sent', /pagesFor\(all, site\.id\)/.test(cp));
ok('a file opens only from a page this client may see that lists it, never a client-private one', /pagesFor\(await readPortalPages\(studio\), site\.id\)\.find\(\(p\) => p\.id === pageId\)/.test(cp) && /i\.kind === 'file' && i\.media_id === id/.test(cp) && /m\.client_private === true\) return missing\(\)/.test(cp) && /signDownload\(/.test(cp));
const client = read('client.html');
ok('Help reads the pages whatever Help answers are, and draws them above the kit', client.includes("const pgP=api('/client/portal-pages').catch(()=>null);") && client.includes('+whatsNewDoorHtml()+portalPagesHtml()+(answers?kitHtml(kr):\'\')'));
ok('a page opens full screen with a back arrow; a file asks for a fresh link', /function openPortalPage\(id\)/.test(client) && client.includes("sheetBackHtml({label:'Help'})") && client.includes("api('/client/portal-pages/files/'+encodeURIComponent(b.getAttribute('data-file'))+'?page='+encodeURIComponent(p.id))"));
ok('a quick link to a place turned off for this client isn’t drawn', /function quickLinkShown\(l\)\{[^\n]*if\(t==='book'\)return partOn\('book'\);if\(t==='messages'\)return partOn\('messages'\);if\(t==='documents'\)return tabShown\('documents'\);/.test(client));
const settings = read('settings.html');
ok('Settings has the pages card at studio level, with its two editors', /id="portalPages" aria-labelledby="portalPagesHead" hidden/.test(settings) && /id="pageDlg"/.test(settings) && /id="linkDlg"/.test(settings) && /function loadPortalPages\(\) \{\s*if \(!\(CTX && CTX\.is_agency\) \|\| SCOPE\) return Promise\.resolve\(\);/.test(settings));
ok('a page saves by its id; delete asks twice on the same button', /api\('\/agency\/portal\/pages\/' \+ encodeURIComponent\(PG_EDIT\.id\), 'PUT'/.test(settings) && /if \(!ed\.sure\) \{ ed\.sure = true;/.test(settings));
ok('a client-private file is never offered for a page', /a\.client_private !== true/.test(settings));

const passed = results.filter((x) => x.p).length;
console.log(`\n════ PORTAL PAGES AND QUICK LINKS (item 234): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
