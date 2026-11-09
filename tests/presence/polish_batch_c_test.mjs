// ── Final pass on the sales side, batch C (Nov 8 2026) ───────────────────────
//   deno run --allow-read tests/presence/polish_batch_c_test.mjs
// The rules behind the wording batch that a page test can't see:
//   * "Not a fit for us" became "Outside what we do"; deals already marked with
//     the old words count with the new ones in the Won / Not a fit report
//   * the deal page offers exactly the report's reasons
//   * the shared kit carries the in-place confirm, the announcer and the menu fit
const R = await import('../../supabase/functions/presence/lib/sales_reports.ts');
const read = (p) => Deno.readTextFileSync(new URL('../../' + p, import.meta.url));
let pass = 0, fail = 0; const failed = [];
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n, note); } };

ok('the fifth reason is "Outside what we do"', R.LOST_REASONS[4] === 'Outside what we do', JSON.stringify(R.LOST_REASONS));
ok('the old words count with the new ones', R.reasonLabel('Not a fit for us') === 'Outside what we do' && R.reasonLabel('  not a FIT for us ') === 'Outside what we do', R.reasonLabel('Not a fit for us'));
ok('the new words match whatever the case', R.reasonLabel('outside what we do') === 'Outside what we do');
ok('anything else still groups by its own words', R.reasonLabel('Budget moved') === 'Budget moved' && R.reasonLabel('') === 'No reason given');
const pipe = read('pipeline.html');
const mirror = (pipe.match(/const LOST_REASONS=\[([^\]]+)\]/) || [])[1];
ok('the deal page offers the same five', !!mirror && JSON.stringify(JSON.parse('[' + mirror.replace(/'/g, '"') + ']')) === JSON.stringify(R.LOST_REASONS));
const shell = read('shell.js');
ok('the kit asks in place, announces, and keeps menus on screen', /function confirmIn\(anchor, o\)/.test(shell) && /function announce\(text\)/.test(shell) && /function fit\(m\)/.test(shell));
ok('the in-place confirm lands on Cancel, the safe answer', /box\.querySelector\('\.no'\)\.focus\(\);/.test(shell));
ok('nothing on the sales pages still says "Marked as lost" or "won or closed"', !/Marked as lost|won or closed deal|already closed`/.test(pipe));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
