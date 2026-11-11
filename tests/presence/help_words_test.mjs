// ── One set of words, and a Help page that knows what shipped (builder list item 166) ──
// Nov 10 review, file 05 findings 12, 14, 15 and 16: Help had no word about Sites,
// Domains, Switch site, Duplicate, Pin, updates or estimates, and its tour sentence
// still walked "through Today"; "Billing" meant three different things; the product
// had four names on its own pages; and inside a client the menu said "Inbox" for
// that client's messages. This suite pins the fixes, and keeps Help honest from now
// on: every label a menu shows must be named somewhere in Help.
//   deno run --allow-read --allow-env tests/presence/help_words_test.mjs
import { buildNav } from '../../supabase/functions/presence/lib/navigation.ts';
const read = (p) => Deno.readTextFileSync(new URL('../../' + p, import.meta.url));
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const help = read('help.html');
const words = help.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const caps = ['view_all', 'edit', 'publish', 'connect', 'configure', 'invite'];
const navs = {
  studio: buildNav({ role: 'business_owner', edition: 'presence', capabilities: caps, isAgency: true, isOperator: false, siteLive: true }),
  scoped: buildNav({ role: 'business_owner', edition: 'presence', capabilities: caps, isAgency: true, isOperator: false, scoped: true, siteLive: true }),
  owner: buildNav({ role: 'business_owner', edition: 'presence', capabilities: caps, isAgency: false, isOperator: false, siteLive: true }),
};
const flat = (nav) => nav.flatMap((s) => s.items.map((i) => ({ ...i, section: s.label })));

// ═══ Help names every place a menu shows ═══
for (const [who, nav] of Object.entries(navs)) {
  const labels = [...new Set(flat(nav).filter((i) => !i.hidden).map((i) => i.label))];
  const missing = labels.filter((l) => !words.includes(l));
  ok(`help: every ${who} menu label is named in Help`, labels.length > 4 && missing.length === 0, missing.join(', '));
}
ok('help: a Client sites topic that opens Sites', /<a class="setcard" href="\/sites\.html">[\s\S]*?<b>Client sites<\/b>/.test(help));
ok('help: what shipped for client sites is answered', ['+ New site', 'Invite the owner', 'Pin', 'Duplicate', 'Save as a template', 'Templates tab', 'Domains tab', 'Switch site', 'Move to trash', 'Restore', 'Put back'].every((w) => words.includes(w)));
ok('help: updates and estimates are answered', /id="a-updates"/.test(help) && ['Send an update', 'An estimate', 'A recurring invoice'].every((w) => words.includes(w)));
ok('help: the tour no longer walks "through Today" (a studio starts at Home)', !/walk through Today/.test(help) && /walk through your home page/.test(help));

// ═══ "Billing": one meaning ═══
const all = flat(navs.studio).concat(flat(navs.scoped), flat(navs.owner));
ok('words: no menu or search entry is called "Billing" any more', !all.some((i) => i.label === 'Billing'));
const byKey = (nav, key) => flat(nav).find((i) => i.key === key);
ok('words: money owed to the studio is "Who owes you" at studio level, "Invoices" inside a client', byKey(navs.studio, 'billing')?.label === 'Who owes you' && byKey(navs.scoped, 'billing')?.label === 'Invoices');
ok('words: …and searching "billing" still finds them (it stays in the words)', /billing/.test(byKey(navs.studio, 'billing')?.desc || '') && /billing/.test(byKey(navs.scoped, 'billing')?.desc || ''));
ok('words: the studio\'s own subscription is "Your plan", in search and in Settings', byKey(navs.studio, 'plan')?.label === 'Your plan' && /<h2 id="billingHead" tabindex="-1">Your plan<\/h2>/.test(read('settings.html')) && /title: 'Your plan'/.test(read('settings.html')));
ok('words: with no plan name on file, Settings no longer says "your Your plan plan"', /const planWords = s\.plan_name \|\| s\.plan \? esc\(planName\) \+ ' plan' : 'plan';/.test(read('settings.html')) && /Changes to your \$\{planWords\} go through our team/.test(read('settings.html')));

// ═══ one product name ═══
const pages = [...Deno.readDirSync(new URL('../../', import.meta.url))].filter((f) => f.isFile && f.name.endsWith('.html')).map((f) => f.name);
const oldNames = pages.filter((p) => /<title>[^<]*(Studio OS Presence|DDS OS|— Presence)[^<]*<\/title>|DDS OS|>Presence ·/.test(read(p)));
ok('names: no page calls the product "Studio OS Presence", "Presence" or "DDS OS"', oldNames.length === 0, oldNames.join(', '));

// ═══ inside a client, "Messages" ═══
ok('menu: inside a client, their messages are "Messages", not the studio\'s Inbox', flat(navs.scoped).some((i) => i.key === 'messages' && i.label === 'Messages' && !i.hidden) && !flat(navs.scoped).some((i) => !i.hidden && i.label === 'Inbox'));
ok('menu: the studio\'s own Inbox keeps its name', flat(navs.studio).some((i) => i.label === 'Inbox' && !i.hidden));

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.error('FAILURES'); Deno.exit(1); }
