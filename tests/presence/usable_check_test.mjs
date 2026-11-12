// ── Builder list item 150: "Usable by everyone", the fix list (Nov 2026) ─────
//   deno run --allow-read tests/presence/usable_check_test.mjs
// The editor reads each page of the draft as it is drawn and lists what an owner can fix.
// This checks the parts that need no browser: the sums, the words each row says, how pages
// are counted, what's kept with the site, and that the editor is wired to all of it. The
// drawn-page reading itself is tested in tests/e2e/usable-check-150.spec.ts.
await import('../../a11y-check.js');
const A = globalThis.DDSA11Y;
const { normalizeUsable, applyUsable, USABLE_TICKS } = await import('../../supabase/functions/presence/lib/usable_check.ts');

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p: !!p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${p || !note ? '' : ' — ' + note}`); };
const eq = (n, got, want) => ok(n, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}`);

// the sums are WCAG's own
eq('colour: black on white is 21 to 1', Math.round(A.ratio([0, 0, 0], [255, 255, 255])), 21);
eq('colour: #767676 on white just passes 4.5', A.ratio(A.parseColor('#767676'), [255, 255, 255]) >= 4.5, true);
eq('colour: #777777 on white just fails 4.5', A.ratio(A.parseColor('#777777'), [255, 255, 255]) < 4.5, true);
eq('colour: rgb() reads', A.parseColor('rgb(10, 20, 30)'), [10, 20, 30, 1]);
eq('colour: rgba() with a slash reads', A.parseColor('rgba(10 20 30 / 0.5)'), [10, 20, 30, 0.5]);
eq('colour: a short hex reads', A.parseColor('#fa0'), [255, 170, 0, 1]);
eq('colour: anything else is left alone', A.parseColor('color(srgb 1 0 0)'), null);
eq('colour: back to a hex', A.hex([255, 170.4, 0]), '#ffaa00');
eq('size: body words need 4.5', A.needs(16, 400), 4.5);
eq('size: a 24px heading needs 3', A.needs(24, 400), 3);
eq('size: bold 19px needs 3', A.needs(19, 700), 3);
eq('size: bold 18px still needs 4.5', A.needs(18, 700), 4.5);

// which words say nothing about where a button goes
for (const w of ['Click here', 'here', 'Read more', 'Learn more…', 'More', 'click here!']) ok(`vague: “${w}”`, A.VAGUE.test(w));
for (const w of ['See the menu', 'Read more about our bread', 'Book a table', 'Here to help']) ok(`clear: “${w}”`, !A.VAGUE.test(w));
for (const t of ['New page', 'new page 2', 'Untitled page']) ok(`a page called “${t}” is unnamed`, A.NEW_PAGE.test(t));
for (const t of ['News', 'New pages for spring', 'Lessons']) ok(`a page called “${t}” is named`, !A.NEW_PAGE.test(t));

// the rows, in the drawing's words
const home = { slug: '', title: 'Home' };
const photo = A.rowFor(home, { kind: 'photo', src: 2, label: 'From the oven', n: 2 });
eq('row: two photos', [photo.title, photo.where, photo.fix], ['2 photos have no description', 'Home · From the oven', 'Describe them']);
eq('row: one photo', [A.rowFor(home, { kind: 'photo', src: 0, label: '', n: 1 }).title, A.rowFor(home, { kind: 'photo', src: 0, label: '', n: 1 }).fix], ['A photo has no description', 'Describe it']);
const faint = A.rowFor({ slug: 'about', title: 'About' }, { kind: 'faint', src: 1, label: 'Our team', n: 3, ratio: 2.9, min: 4.5, fg: '#999999', bg: '#f5f0e8' });
eq('row: faint words', [faint.title, faint.where, faint.why, faint.fix], ['Words too faint for their background', 'About · Our team', '2.9 to 1 now. Easy reading needs 4.5 to 1.', 'Pick colours']);
ok('row: faint words carry the pair for the Style tab', faint.fg === '#999999' && faint.bg === '#f5f0e8' && faint.src === 1 && faint.slug === 'about');
eq('row: a big faint heading says 3 to 1', A.rowFor(home, { kind: 'faint', src: 0, label: '', n: 1, ratio: 2.1, min: 3 }).why, '2.1 to 1 now. Big headings need 3 to 1.');
const link = A.rowFor(home, { kind: 'link', src: 0, label: 'Fresh bread, every morning', n: 1, words: 'Click here' });
eq('row: a vague button', [link.title, link.why, link.fix], ['A button only says “Click here”', 'Say where it goes: “See the menu”.', 'Change words']);
eq('row: a button with no words', A.rowFor(home, { kind: 'link', src: 0, label: '', n: 1, words: '' }).title, 'A button has no words');
eq('row: outside a section the button opens the page', A.rowFor(home, { kind: 'link', src: null, core: 'header', label: 'The top of the page', n: 1, words: 'here' }).fix, 'Open the page');
const named = A.rowFor({ slug: 'new-page', title: 'New page' }, { kind: 'name' });
eq('row: a page still called New page', [named.title, named.where, named.fix], ['A page is still called “New page”', 'New page', 'Rename']);

// every page as one list
const sum = A.summarize([
  { slug: '', title: 'Home', findings: [{ kind: 'link', src: 0, label: 'Fresh bread', n: 1, words: 'Click here' }, { kind: 'photo', src: 2, label: 'From the oven', n: 2 }] },
  { slug: 'about', title: 'About', findings: [{ kind: 'faint', src: 1, label: 'Our team', n: 1, ratio: 2.9, min: 4.5, fg: '#999999', bg: '#f5f0e8' }] },
  { slug: 'new-page', title: 'New page', findings: [] },
  { slug: 'lessons', title: 'Lessons', findings: null },
]);
eq('list: worst first (photos, faint words, the name, the button)', sum.rows.map((r) => r.kind), ['photo', 'faint', 'name', 'link']);
eq('list: how many to fix', sum.fix, 4);
eq('list: what passed (six checks a page, less what was found, less a page that couldn’t be read)', sum.passed, 4 + 5 + 5 + 1);
eq('list: a page that couldn’t be read is said', sum.unread, 1);
eq('list: Site health’s line', sum.worst, '2 photos on Home have no description.');
eq('list: Home is never "still called New page"', A.summarize([{ slug: '', title: 'New page', findings: [] }]).fix, 0);
eq('list: nothing found', [A.summarize([{ slug: '', title: 'Home', findings: [] }]).fix, A.summarize([{ slug: '', title: 'Home', findings: [] }]).passed, A.summarize([]).worst], [0, 6, '']);
const two = A.summarize([{ slug: '', title: 'Home', findings: [{ kind: 'faint', src: 0, label: '', n: 1, ratio: 3.9, min: 4.5 }, { kind: 'faint', src: 1, label: '', n: 1, ratio: 1.8, min: 4.5 }] }]);
eq('list: the faintest words lead', two.rows.map((r) => r.ratio), [1.8, 3.9]);
eq('publish card: things left and ticks left', A.publishLine(4, 3), '4 things to fix · 3 to check yourself');
eq('publish card: one thing', A.publishLine(1, 0), '1 thing to fix');
eq('publish card: nothing', A.publishLine(0, 0), 'Nothing to fix');
eq('ticks: the three in the drawing', A.TICKS.map((t) => t[0]), [...USABLE_TICKS]);

// what's kept with the site
eq('kept: nothing yet', normalizeUsable(null), { ticks: { photo_words: false, zoom: false, captions: false }, last: null });
const now = '2026-11-12T10:42:00.000Z';
const t1 = applyUsable(null, { ticks: { captions: true } }, now);
eq('kept: one tick changes, the others stay', t1.ticks, { photo_words: false, zoom: false, captions: true });
const t2 = applyUsable(t1, { last: { fix: 4, passed: 21, worst: '2 photos on Home have no description.' } }, now);
eq('kept: a check’s result, stamped by the server', t2, { ticks: t1.ticks, last: { at: now, fix: 4, passed: 21, worst: '2 photos on Home have no description.' } });
eq('kept: a later tick leaves the last check', applyUsable(t2, { ticks: { captions: false } }, '2026-11-13T00:00:00.000Z').last, t2.last);
eq('kept: nothing to fix keeps no worst line', applyUsable(null, { last: { fix: 0, passed: 30, worst: 'left over' } }, now).last.worst, '');
ok('kept: an unknown tick is refused', 'error' in applyUsable(null, { ticks: { other: true } }, now));
ok('kept: a tick that isn’t yes or no is refused', 'error' in applyUsable(null, { ticks: { zoom: 'yes' } }, now));
ok('kept: an empty save is refused', 'error' in applyUsable(null, {}, now));
eq('kept: markup in the worst line is taken out, and it is cut short', normalizeUsable({ last: { at: now, fix: 1, worst: '<b>x</b>' + 'y'.repeat(400) } }).last.worst.length <= 200 && !/[<>]/.test(normalizeUsable({ last: { at: now, fix: 1, worst: '<b>x</b>' } }).last.worst), true);
eq('kept: a made-up date is no check', normalizeUsable({ last: { at: 'soon', fix: 2 } }).last, null);

// the editor is wired to it, and the server knows the route
const read = (p) => Deno.readTextFileSync(new URL('../../' + p, import.meta.url));
const page = read('presence.html'), index = read('supabase/functions/presence/index.ts'), roles = read('supabase/functions/presence/lib/site_roles.ts');
ok('editor: loads the check only when asked', /sc\.src = "\/a11y-check\.js\?v=\d+"/.test(page) && !/<script[^>]+a11y-check\.js/.test(page));
ok('editor: the draft is read out of sight and its scripts never run', /setAttribute\("sandbox", "allow-same-origin"\)/.test(page) && /\.ue-frame\{[^}]*visibility:hidden/.test(page));
ok('editor: the Publish card shows the row beside the ready list', /renderReadyList\(\);\n\s+ueRitualRow\(\);/.test(page));
ok('editor: the Publish button never waits on the check', !/ueRun\([^)]*\)[^\n]*runPublish|runPublish[^\n]*ueRun/.test(page) && !/c\.blockers[^\n]*UE\./.test(page));
ok('editor: Site health shows the same list', /const usable = ueHealthBlock\(\); if \(usable\) card\.appendChild\(usable\)/.test(page));
ok('editor: Pick colours opens the Style tab with the pair marked', /eeEditBlock\(row\.src, "style"\)/.test(page) && /ueFaintBanner\(idx, st\)/.test(page) && /ueRateSwatches\(idx, st, row, shades\)/.test(page));
ok('editor: Rename opens the page’s settings', /if \(row\.kind === "name"\) \{ pgOpenSettings\(/.test(page));
ok('editor: the Page menu opens the check', /mi\("Usable by everyone…", \(\) => openUsable\(\)/.test(page));
ok('server: the route reads and saves', /route === '\/site\/usable' && method === 'GET'/.test(index) && /route === '\/site\/usable' && method === 'PUT'/.test(index));
ok('server: a save needs edit', /\['edit', \[[\s\S]*?'PUT \/site\/usable'/.test(roles));

const passed = results.filter((x) => x.p).length;
console.log(`\n════ USABLE BY EVERYONE (item 150): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
