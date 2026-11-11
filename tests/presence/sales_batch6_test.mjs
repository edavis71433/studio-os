// ── Sales review batch six (Nov 2026): items 31, 32 and 39 ──────────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/sales_batch6_test.mjs
//
//   31  saved views (filter, search, columns, sort) on Customers, Contacts and
//       Pipeline; pick rows to act on together: Send an update, and Mark.
//   32  import customers and deals from a CSV, the contacts importer's way.
//   39  the people picked for an update are kept as a list to send to again.
const V = await import('../../supabase/functions/presence/lib/saved_views.ts');
const B = await import('../../supabase/functions/presence/lib/broadcast.ts');
let pass = 0, fail = 0; const failed = [];
const ok = (n, c) => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n); } };
const eq = (n, a, b) => ok(`${n} (got ${JSON.stringify(a)})`, JSON.stringify(a) === JSON.stringify(b));
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));

// ── saved views: the rules ──
eq('a view needs a name', V.normalizeView({ base: 'active' }), null);
const v1 = V.normalizeView({ id: 'view-0001', name: '  Waiting on us ', base: 'attention', q: 'bakery', cols: ['name', 'open_support', 'open_support', 'Bad Key!', 'status'], sort: { key: 'name', dir: -3 } });
eq('a view keeps its parts, cleaned', v1, { id: 'view-0001', name: 'Waiting on us', base: 'attention', q: 'bakery', cols: ['name', 'open_support', 'status'], sort: { key: 'name', dir: -1 } });
ok('a missing or odd id gets a fresh one', /^[0-9a-f-]{36}$/.test(V.normalizeView({ id: 'x y', name: 'A' }).id));
// final pass (Nov 8, batch D): a sort written as words — "desc" used to read as NaN and sort ascending
eq('a sort given as "desc" or "asc" (any case) is understood', ['desc', 'DESC ', 'asc', 'Asc', -1, 1, '-1', 'sideways'].map((dir) => V.normalizeView({ name: 'A', sort: { key: 'name', dir } }).sort.dir), [-1, -1, 1, 1, -1, 1, -1, 1]);
eq('at most twelve columns are kept, in the order given', V.normalizeView({ name: 'A', cols: Array.from({ length: 15 }, (_, i) => 'col' + String.fromCharCode(97 + i)) }).cols, Array.from({ length: 12 }, (_, i) => 'col' + String.fromCharCode(97 + i)));
ok('MAX_COLS is twelve', V.MAX_COLS === 12);
eq('an odd base or sort is dropped', [V.normalizeView({ name: 'A', base: 'DROP TABLE' }).base, V.normalizeView({ name: 'A', sort: { key: '' } }).sort], ['', null]);
const list = V.normalizeViewList([{ id: 'aaaaaa', name: 'One' }, { id: 'bbbbbb', name: 'one' }, { id: 'cccccc', name: 'Two' }, null, { name: '' }]);
eq('one view per name (the later wins), junk dropped', list.map((v) => v.id), ['bbbbbb', 'cccccc']);
eq('at most twenty per list', V.normalizeViewList(Array.from({ length: 25 }, (_, i) => ({ id: 'view-' + String(i).padStart(4, '0'), name: 'V' + i }))).length, V.MAX_VIEWS);
eq('only the three lists', Object.keys(V.normalizeViews({ customers: [], contacts: [], pipeline: [], secrets: [{ name: 'x' }] })), ['customers', 'contacts', 'pipeline']);
ok('isViewList', V.isViewList('pipeline') && !V.isViewList('deals'));

// ── picked lists: the rules ──
eq('people: valid emails, lower-cased, once each', V.normalizePeople([{ email: 'A@Example.com', name: 'Ann' }, { email: 'a@example.com' }, { email: 'nope' }, { email: 'b@example.org', name: 'Bo' }]), [{ email: 'a@example.com', name: 'Ann' }, { email: 'b@example.org', name: 'Bo' }]);
eq('at most five hundred people', V.normalizePeople(Array.from({ length: 600 }, (_, i) => ({ email: `p${i}@example.com` }))).length, V.MAX_PEOPLE);
const lists = V.normalizeLists([{ id: 'list-0001', name: 'Spring offer', people: [{ email: 'a@example.com' }], created_at: '2026-11-08T10:00:00Z' }, { id: 'list-0002', name: 'Empty', people: [] }, { id: 'list-0001', name: 'Dup', people: [{ email: 'b@example.com' }] }, { id: '??', name: 'Bad id', people: [{ email: 'c@example.com' }] }]);
eq('a list needs an id, a name and someone with an email', lists.map((l) => l.name), ['Spring offer']);
eq('the newest fifty lists', V.normalizeLists(Array.from({ length: 55 }, (_, i) => ({ id: 'list-' + String(i).padStart(4, '0'), name: 'L' + i, people: [{ email: 'a@example.com' }] }))).map((l) => l.name)[0], 'L5');

// ── a picked list is an audience ──
ok('list keys', B.isListKey('list:list-0001') && !B.isListKey('list:') && !B.isListKey('list:../x') && !B.isListKey('contacts'));
ok('an audience is a segment or a list', B.isAudienceKey('contacts') && B.isAudienceKey('list:1b2c3d4e-0000-4000-8000-000000000000') && !B.isAudienceKey('audit_leads'));
const sendable = await B.resolveSendable('site', 'list:list-0001', { fetchRows: async (k) => k === 'list:list-0001' ? [{ email: 'a@example.com' }, { email: 'off@example.com' }] : [], isSuppressed: async (e) => e === 'off@example.com' });
eq('a list goes through the same suppression as any audience', [sendable.recipients.map((r) => r.email), sendable.suppressed], [['a@example.com'], 1]);
const lib = read('supabase/functions/presence/lib/broadcast.ts');
ok('a list is read from the site\'s own store; a removed list reaches no one', /const l = \(await loadPickedLists\(siteId\)\)\.find\(\(x\) => `list:\$\{x\.id\}` === key\);\s*if \(!l\) return \[\];[\s\S]{0,400}?return keepKnown\(l\.people, await knownEmails\(siteId\)\)\.kept\.slice\(0, RECIPIENT_CAP\);/.test(lib));

// ── the routes ──
const bc = read('supabase/functions/presence/routes/broadcasts.ts');
ok('a draft may only name one of this site\'s lists', /if \(isListKey\(body\?\.audience\) && !\(await audienceOk\(site\.id, body\.audience\)\)\) return json\(\{ error: 'validation'/.test(bc));
ok('a list in use by a scheduled update can\'t be removed — and an unanswered check never deletes (F8)', /status=in\.\(scheduled,sending\)&select=id&limit=1`\);[\s\S]{0,260}?if \(!busy\.ok\) return json\(\{ error: 'unavailable'[^\n]*\n\s*if \(rows\(busy\)\[0\]\) return json\(\{ error: 'in_use'/.test(bc));
ok('the picked lists follow the presets in the audience picker', /segments: \[\.\.\.SEGMENTS(\.filter\([^\n]*?\))?\.map\(/.test(bc)   /* item 56 (Nov 8) hides an empty Your customers */);
const idx = read('supabase/functions/presence/index.ts');
ok('the new routes are wired', /route === '\/sales\/views' && \(method === 'GET' \|\| method === 'PUT'\)/.test(idx) && /route === '\/broadcasts\/lists' && method === 'POST'/.test(idx) && /lm && method === 'DELETE'\) return handleBroadcastListDelete/.test(idx));
const sales = read('supabase/functions/presence/routes/sales.ts');
ok('the templates list never shows the reserved rows', (sales.match(/\$\{NOT_RESERVED_STORE\}&/g) || []).length === 2);
ok('an imported deal starts at an open stage, never Won; an enquiry\'s deal is always a lead', /const startStage = \(!srcSub && \['qualified', 'proposal', 'contract'\]\.includes\(String\(b\.stage\)\)\) \? String\(b\.stage\) : 'lead';/.test(sales));
const store = read('supabase/functions/presence/lib/reserved_store.ts');
ok('the reserved store is site-scoped on every read and write', (store.match(/site_id=eq\.\$\{siteId\}/g) || []).length >= 2);

// ── the pages ──
const cust = read('customers.html');
ok('Customers: Mark offers Active and On hold only (Complete emails the client a survey)', /<option value="active">Active<\/option><option value="on_hold">On hold<\/option><\/select>/.test(cust) && !/<option value="complete">/.test(cust));
ok('Customers: the import connects by email, never sets up an account', /api\('\/sales\/customers','POST',\{mode:'connect',/.test(cust));
// bold redesign (Nov 2026): a row opens the preview beside the list; its checkbox (and its own buttons and links) still never do
ok('Customers: a row\'s checkbox never opens the preview (or the record)', /if\(e\.target\.closest\('button,input,td\.pick,a'\)\)return;openPreview/.test(cust));
const pipe = read('pipeline.html');
ok('Pipeline: Mark as not a fit only moves deals the board could move', /if\(!boardCanMove\(d\.stage,'lost'\)\)\{skip\+\+;continue;\}/.test(pipe));
ok('Pipeline: won and lost rows are skipped on import', /if\(it\.stage==='won'\|\|it\.stage==='lost'\)return'skipped';/.test(pipe));
ok('Pipeline: the tools stay at studio level', /if\(scope\(\)\)\{\['importDeals','pvBtn','chartsBtn','printBtn'\]/.test(pipe));
const shell = read('shell.js');
ok('one shared kit: views, a name prompt, columns, send-to, the CSV importer', /window\.ddsListKit = \(function \(\) \{/.test(shell) && /return \{ use: function \(fn\) \{ REQ = fn; \}, views: views, saveViews: saveViews, ask: ask, columnsMenu: columnsMenu, sendTo: sendTo, parseCsv: parseCsv, importPanel: importPanel, style: style, fit: fit, confirmIn: confirmIn, announce: announce, tagInput: tagInput, cleanTag: cleanTag, charts: charts, chartTips: chartTips, printList: printList \};/.test(shell));
ok('send-to opens the composer on the kept list', /location\.href = '\/broadcasts\.html\?list=' \+ encodeURIComponent\(r\.body\.data\.id\)/.test(shell));
ok('the composer picks the list it was sent', /if\(pick&&!DRAFT&&SEGMENTS\.some\(x=>x\.key==='list:'\+pick\)\)\{SEL='list:'\+pick;/.test(read('broadcasts.html')));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
