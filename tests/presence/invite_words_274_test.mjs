// ── Builder item 274 (Nov 22 review): the invite emails tell the truth about their button ──
//   deno run --allow-read tests/presence/invite_words_274_test.mjs
// The invite's big button is a one-use sign-in link made by Supabase. How long it lives is a
// dashboard setting (Authentication › Sign In / Providers › Email › Email OTP expiration: an
// hour unless changed, a day at most), not anything in this repo, while the studio's Client
// portal page talks about 7 days. So both emails say the button works once, for a short
// while, and name the door that works any time (the sign-in page emails a code), and the
// Client portal page says what its 7 days means.
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const ws = read('supabase/functions/presence/lib/workspace.ts');
const sales = read('supabase/functions/presence/routes/sales.ts');
const noComments = (t) => t.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');   // the words the email carries, not the notes beside them
const team = ws.slice(ws.indexOf('export async function sendInviteLink('), ws.indexOf('async function sendSiteInvite('));
const customer = sales.slice(sales.indexOf('export async function sendCustomerInvite('), sales.indexOf('return left === true;'));

ok('the team and reviewer invite says the button works once, for a short while', /It works once, for a short while\./.test(team));
ok('…and names the sign-in page as the door that works any time, with a code', /After that, go to <a href="\$\{door\}"/.test(team) && /we’ll email you a code/.test(team));
ok('…where the door is the page the button would have opened (studio.html or portal.html)', /const door = `\$\{\(Deno\.env\.get\('SITE_URL'\) \|\| 'https:\/\/davisdigitalstudio\.com'\)\.replace\(\/\\\/\$\/, ''\)\}\$\{opts\.next\}`;/.test(team));
ok('the client invite says the same about its button', /It works once, for a short while\./.test(customer));
ok('…and links to this studio’s own sign-in page (the one with its name and logo)', /open <a href="\$\{base\}\/portal\.html\?studio=\$\{siteId\}"/.test(customer) && /we’ll email you a code/.test(customer));
ok('neither email claims the link lasts days', !/\b\d+ days?\b/.test(noComments(team)) && !/\b\d+ days?\b/.test(noComments(customer)));
ok('the one-use link is still the button (it is the smoothest door while it lasts)', /href="\$\{link\}"/.test(team) && /href="\$\{magic\}"/.test(customer));

const cp = read('client-portal.html');
ok('the Client portal page says what "runs out after 7 days" means, and that the button is one-use', /An invite counts as run out after 7 days without them coming in\. The email’s button signs them in once, for a short while; after that the sign-in page emails them a code any time\./.test(cp));

const passed = results.filter(Boolean).length;
console.log(`\n════ INVITE EMAIL WORDS (builder item 274): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
