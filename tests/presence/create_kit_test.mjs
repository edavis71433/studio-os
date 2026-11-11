// ── "+ Create" (sales list item 70, the bold redesign, Nov 2026) ─────────────
//   deno run --allow-read tests/presence/create_kit_test.mjs
//
//   Timed against Salesforce, every everyday job started by finding the
//   customer and opening their page. "+ Create" (create.js, loaded by
//   shell.js) logs a call, adds a deal, sends an invoice, opens a proposal or
//   adds a to-do from any page; you pick WHO inside the form.
//
//   The rules below run create.js's own pure block (between the create-pure
//   markers) exactly as the page has it; the rest pins the wiring the browser
//   spec (tests/e2e/create.spec.ts) drives end to end.
let pass = 0, fail = 0; const failed = [];
const ok = (n, c) => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n); } };
const eq = (n, a, b) => ok(`${n} (got ${JSON.stringify(a)})`, JSON.stringify(a) === JSON.stringify(b));
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));

const create = read('create.js');
const shell = read('shell.js');
const css = read('shell.css');
const pipe = read('pipeline.html');
const headers = read('_headers');
const contacts = read('contacts.html');
const index = read('supabase/functions/presence/index.ts');

const a = create.indexOf('/* create-pure:start'), b = create.indexOf('/* create-pure:end */');
ok('create.js has its pure block', a > 0 && b > a);
const K = new Function(create.slice(a, b) + '\nreturn { crDue, crCents, crMoney, crCallBody, crCandidates, crMatch, crSuggest, crNewDealTitle, crPickDeal, crMerge, crGoLabel };')();

// ── dates from the chips, in the studio's own calendar ──
const MON = new Date(2026, 10, 9, 15, 30).getTime();    // Monday 9 Nov 2026, mid-afternoon local
const FRI = new Date(2026, 10, 13, 9, 0).getTime();     // Friday 13 Nov
const LATE = new Date(2026, 10, 9, 23, 50).getTime();   // ten to midnight: still the 9th here, whatever UTC says
eq('on receipt is today', K.crDue('receipt', MON), '2026-11-09');
eq('today', K.crDue('today', LATE), '2026-11-09');
eq('tomorrow', K.crDue('tomorrow', MON), '2026-11-10');
eq('7 / 14 / 30 days', [K.crDue('7', MON), K.crDue('14', MON), K.crDue('30', MON)], ['2026-11-16', '2026-11-23', '2026-12-09']);
eq('Friday from a Monday is this Friday', K.crDue('friday', MON), '2026-11-13');
eq('Friday from a Friday is next Friday', K.crDue('friday', FRI), '2026-11-20');
eq('next week is next Monday — from a Monday too', [K.crDue('nextweek', MON), K.crDue('nextweek', FRI)], ['2026-11-16', '2026-11-16']);
eq('"No date" is no date', K.crDue('', MON), '');

// ── money as people type it ──
eq('dollars and cents with commas', K.crCents('$1,200.50'), 120050);
eq('a bare number', K.crCents('700'), 70000);
eq('one decimal', K.crCents('9.5'), 950);
eq('nothing usable is zero (never a guess)', [K.crCents(''), K.crCents('abc'), K.crCents('1.234'), K.crCents('-5'), K.crCents(null)], [0, 0, 0, 0, 0]);
eq('shown back the way it reads', [K.crMoney(120050), K.crMoney(70000), K.crMoney(5)], ['$1,200.50', '$700', '$0.05']);

// ── a call needs no note of its own ──
eq('a voicemail says so', K.crCallBody('voicemail', ''), 'Left a voicemail.');
eq('no answer, with a note', K.crCallBody('noanswer', ' called twice '), 'No answer. called twice');
eq('we talked: just the note', K.crCallBody('talked', '  Agreed the logo '), 'Agreed the logo');
eq('we talked, no note: an empty body (the server allows it for a call)', K.crCallBody('talked', ''), '');
ok('the server allows a call with no body', /export function activityNeedsBody\(kind: DealActivityKind\): boolean \{ return kind === 'note'; \}/.test(read('supabase/functions/presence/crm/deal_activity.ts')));

// ── who you can pick ──
const people = [
  { id: 'c1', name: 'Jane Doe', company: 'Blue Finch', email: 'jane@example.com' },
  { id: 'c2', name: 'Sam Lee', company: '', email: 'sam@example.com' },
  { id: 'c3', name: '', company: 'Oak & Iron', email: 'hi@oak.example' },
  { id: 'c4', name: 'Lost Lou', email: 'lou@example.com' },
];
const deals = [
  { id: 'd1', title: 'Blue Finch — site', stage: 'proposal', contact_id: 'c1', expected_value_cents: 250000, next_step: 'Call back', next_step_at: '2026-11-12', updated_at: '2026-11-01' },
  { id: 'd2', title: 'Sam — logo', stage: 'lead', contact_id: 'c2', updated_at: '2026-11-08' },
  { id: 'd3', title: 'Old job', stage: 'won', contact_id: 'c2', updated_at: '2026-10-01' },
  { id: 'd4', title: 'Lost one', stage: 'lost', contact_id: 'c4', updated_at: '2026-11-07' },
  { id: 'd5', title: 'Overdue', stage: 'qualified', contact_id: null, next_step_at: '2026-11-02', updated_at: '2026-09-01' },
];
const cands = K.crCandidates(deals, people);
eq('every deal but the lost one, then people with no deal yet', cands.map((c) => c.id), ['d1', 'd2', 'd3', 'd5', 'c3', 'c4']);
ok('a deal carries its person', cands[0].name === 'Jane Doe' && cands[0].company === 'Blue Finch' && cands[0].value_cents === 250000);
ok('a person whose only deal is lost can be picked again (as no deal yet)', cands.find((c) => c.id === 'c4')?.kind === 'contact');
ok('a person with no name keeps their own name empty (the title falls to the business)', cands.find((c) => c.id === 'c3')?.pname === '' && cands.find((c) => c.id === 'c3')?.name === 'hi@oak.example');
eq('with nothing typed: open deals, the overdue next step first', K.crSuggest(cands, 5).map((c) => c.id), ['d5', 'd1', 'd2']);
ok('a won deal is never suggested (it isn’t open)', !K.crSuggest(cands, 9).some((c) => c.id === 'd3'));
ok('typing finds a person, a business or a deal', K.crMatch(cands[0], 'finch') && K.crMatch(cands[0], 'JANE') && K.crMatch(cands.find((c) => c.id === 'c3'), 'oak') && K.crMatch(cands[1], 'logo') && !K.crMatch(cands[1], 'finch'));

// ── never two deals for one person ──
eq('a new deal is titled the way Contacts titles it', [K.crNewDealTitle({ pname: 'Jane Doe', company: 'X', email: 'j@x' }), K.crNewDealTitle({ pname: '', company: 'Oak & Iron', email: 'hi@oak' }), K.crNewDealTitle({ pname: '', company: '', email: 'hi@oak' }), K.crNewDealTitle({})], ['Jane Doe — project', 'Oak & Iron — project', 'hi@oak — project', 'New — project']);
ok('…the same order Contacts uses (name, business, email)', contacts.includes("const title=(c.name||c.company||c.email||'New')+' — project';"));
eq('a person with an open deal gets that deal, not a new one', K.crPickDeal([{ id: 'w', stage: 'won' }, { id: 'o', stage: 'qualified' }])?.id, 'o');
eq('…else their won deal', K.crPickDeal([{ id: 'l', stage: 'lost' }, { id: 'w', stage: 'won' }])?.id, 'w');
eq('…and only lost deals means a new one', K.crPickDeal([{ id: 'l', stage: 'lost' }]), null);
ok('create.js checks the person’s deals before starting one', /c\._look = api\('\/sales\/contacts\/' \+ encodeURIComponent\(c\.id\)\)/.test(create) && /return lookDeal\(c\)\.then\(function \(have\) \{\s*if \(have\) return have;/.test(create));
ok('…a failed check never risks a second deal (it stops and says so)', /if \(!r0\.ok\) \{ c\._look = null; return Promise\.reject\(/.test(create));
ok('…the check starts as soon as they are picked, so the button tells the truth', /if \(c\.kind === 'contact' && S\.kind !== 'deal'\) lookDeal\(c\)/.test(create));
ok('…and the pick becomes that deal, so pressing again never starts a second', /c\.kind = 'deal'; c\.deal_id = id;/.test(create));
eq('a search folds in by id', K.crMerge([{ id: 'a', v: 1 }, { id: 'b', v: 1 }], [{ id: 'b', v: 2 }, { id: 'c', v: 2 }]).map((x) => x.id + x.v), ['a1', 'b2', 'c2']);
ok('a reply that isn’t a list counts as an empty one (never a crash)', /var rowsOf = function \(r\) \{ var d = r && r\.ok && r\.body && r\.body\.data; return Array\.isArray\(d\) \? d : \[\]; \}/.test(create) && /var deals = rowsOf\(r\[0\]\), contacts = rowsOf\(r\[1\]\);/.test(create));
ok('past the first 100, typing asks the server too', /api\('\/sales\/contacts\?limit=20&q=' \+ enc\), api\('\/sales\/deals\?limit=20&q=' \+ enc\)/.test(create) && /api\('\/sales\/deals\?limit=100'\), api\('\/sales\/contacts\?limit=100'\)/.test(create));

// ── the button says what it will do ──
eq('the main button, for a deal and for a person with none', [K.crGoLabel('call', { kind: 'deal' }), K.crGoLabel('call', { kind: 'contact' }), K.crGoLabel('invoice', { kind: 'contact' }), K.crGoLabel('todo', null), K.crGoLabel('deal', null), K.crGoLabel('proposal', null)],
  ['Log call', 'Start a deal and log the call', 'Start a deal and send', 'Add to-do', 'Add deal', 'Open the proposal']);

// ── the routes it calls exist ──
for (const [what, re] of [['activity', /\^\\\/sales\\\/deals\\\/\(\[0-9a-f-\]\{36\}\)\\\/activity\$/], ['tasks', /\^\\\/sales\\\/deals\\\/\(\[0-9a-f-\]\{36\}\)\\\/tasks\$/], ['invoice', /handleSalesInvoice\(req, site, principal, m\[1\], cors\)/], ['contacts', /route === '\/sales\/contacts'\) return handleSalesContacts/]]) ok(`the server has the ${what} route`, re.test(index));
ok('an invoice whose link didn’t generate keeps the form open (Send again finishes it)', /b2\.warning === 'link_failed' \|\| !url\) return Promise\.reject/.test(create));
ok('"copied" is said only when the copy worked', /return copy\.then\(function \(copied\) \{/.test(create));

// ── shell.js: who gets it, where it is ──
const canCreate = (shell.match(/function canCreate\(\) \{[\s\S]*?\n  \}/) || [''])[0];
ok('only a studio, at studio level, with Pipeline in its menu', /!CTX\.is_agency \|\| \(CTX\.scope && CTX\.scope\.name\) \|\| isReviewerCtx\(\)\) return false;/.test(canCreate) && /s\.key === 'pipeline'/.test(canCreate));
ok('the sidebar button only when it applies', /\(canCreate\(\) \? '<button type="button" class="dds-create" id="dds-create"/.test(shell));
ok('create.js loads on idle, from the site itself', /sc\.src = '\/create\.js';/.test(shell) && /requestIdleCallback \|\| function \(f\) \{ return setTimeout\(f, 1500\); \}\)\(function \(\) \{ loadCreate\(\)/.test(shell));
ok('a failed load says so (and the next press retries)', /sc\.onerror = function \(\) \{ createP = null;/.test(shell) && /Create didn’t load — check your connection and try again\./.test(shell));
const bar = (shell.match(/if \(pipe && custs\) \{[\s\S]*?\n    \}/) || [''])[0];
const order = ['homeA', 'inboxA', 'dds-mbar-create', 'pipe.href', 'custs.href'].map((k) => bar.indexOf(k));
ok('the phone bar: Home · Inbox · + · Pipeline · Customers', order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])));
// bug hunt A3 (Nov 10): a studio that hid Pipeline or Customers still may create, so its bar is Home · Inbox · + · Menu
ok('…and everyone else keeps Home · Inbox · Menu, with the + when they may create', /bar\.innerHTML = homeA \+ inboxA \+\s*\(plusHere \? '<button type="button" id="dds-mbar-create"[^\n]*: ''\) \+\s*'<button type="button" id="dds-mbar-menu"/.test(shell) && /var plusHere = canCreate\(\);/.test(shell));
ok('"c" opens it, never while typing or under a modal', /else if \(e\.key === 'c' && !e\.shiftKey && canCreate\(\)\) \{ if \(modalOpen\(\)\) return;/.test(shell) && /tour \|\| \(window\.ddsCreate && window\.ddsCreate\.isOpen\(\)\)\); \}/.test(shell));
ok('⌘K lists the five, last, and opens them in place (no hash for a page to trip on)', /if \(canCreate\(\)\) DESTS = DESTS\.concat\(CREATE_DESTS\);/.test(shell) && /closest\('a\.res\[data-create\]'\)/.test(shell) && /sel\.hasAttribute\('data-create'\)\) \{ e\.preventDefault\(\); openCreate\(/.test(shell));
ok('"#create:<kind>" opens it once and clears itself', /var CREATE_HASH = \/\^#create\(\?::\(call\|deal\|invoice\|proposal\|todo\|customer\|update\)\)\?\$\/;/.test(shell) && /history\.replaceState\(history\.state, '', location\.pathname \+ location\.search\)/.test(shell));
ok('the n key never picks the shell’s Create button (it isn’t the page’s +)', /n\.closest\('#dds-shell, \.dds-pop, \.dds-palette, \.dds-drawer, #dds-mbar'\)/.test(shell));

// ── shell.css ──
ok('hidden unless the sidebar shows it', /\.dds-create\{display:none\}/.test(css) && /html\.dds-side \.dds-create\{order:1;display:flex;/.test(css));
ok('a 44px button on a touch screen, and no key hints there', /@media \(pointer:coarse\)\{\s*html\.dds-side \.dds-create\{height:44px\}\s*html\.dds-side \.dds-create kbd,html \.dds-search kbd,html\.dds-side #dds-search kbd\{display:none\}/.test(css));
ok('the dialog’s hidden parts stay hidden', /\.dds-cr \[hidden\]\{display:none !important\}/.test(css));
ok('a phone gets a sheet with room for the home bar', /\.dds-cr\.sheet\{position:fixed;inset:auto 0 0 0;/.test(css) && /\.dds-cr\.sheet \.cr-foot\{padding:12px 16px calc\(12px \+ env\(safe-area-inset-bottom,0px\)\)\}/.test(css));
ok('no motion for people who ask for none', /@media \(prefers-reduced-motion:reduce\)\{\.dds-cr\.form,\.dds-cr\.sheet\{animation:none\}\}/.test(css));

// ── the proposal lands open ──
ok('Pipeline reads compose=proposal on a fresh open and lands on Billing', /WANT_PROPOSAL=q\.get\('compose'\)==='proposal';DTAB=DTAB_KEYS\.includes\(u\)\?u:\(\(WANT_SCHEDULE\|\|WANT_CONVERT\|\|WANT_PROPOSAL\)\?'billing':'overview'\);/.test(pipe));
ok('…opens a new proposal, or points at the draft already there (never a second)', /if\(WANT_PROPOSAL\)\{WANT_PROPOSAL=false;if\(draftProp\)\{[\s\S]{0,420}\}else\{const ap=\$\('addProp'\);if\(ap\)ap\.click\(\);\}\}/.test(pipe));
ok('…and the address drops it, so a reload doesn’t open another', /history\.replaceState\(null,'','\?deal='\+id\+\(scope\(\)\?'&client='\+scope\(\):''\)\+\(DTAB!=='overview'\?'&dtab='\+DTAB:''\)\);/.test(pipe));
ok('create.js sends a proposal there', /location\.assign\('\/pipeline\.html\?deal=' \+ encodeURIComponent\(c\.deal_id\) \+ '&dtab=billing&compose=proposal'\)/.test(create));

// ── it ships, fresh ──
ok('/create.js revalidates like shell.js', /\n\/create\.js\n  Cache-Control: no-cache, must-revalidate\n/.test(headers));
ok('the public build copies it (every root .js)', /cp \.\/\*\.js dist\//.test(read('scripts/build-public.sh')));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILED:\n  ' + failed.join('\n  ')); Deno.exit(1); }
