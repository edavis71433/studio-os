// ── Menus, names and the frame (builder items 201 and 202, Nov 12 review file 06) ──
// Finding 69: the ? panel and the Help page sent one question to two different helpers.
// Both ask /help/ask now, so these check that helper answers the Help page's own
// questions, and that each answer opens the place it names (finding 68). Finding 74:
// search lists only what the person can open, and "health" finds the health check
// where it lives now. The pages' own behaviour is in tests/e2e/menus-names-201-202.spec.ts.
//   deno run --allow-read --allow-env tests/presence/menus_names_201_202_test.mjs
import { buildNav } from '../../supabase/functions/presence/lib/navigation.ts';
import { matchHelp, HELP_TOPICS } from '../../supabase/functions/presence/lib/help_assistant.ts';

const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const read = (p) => Deno.readTextFileSync(new URL('../../' + p, import.meta.url));

// ═══ one helper: the Help page's suggested questions and the ? panel's chips ═══
const help = read('help.html');
const pageChips = [...help.matchAll(/data-q="([^"]+)"/g)].map((m) => m[1]);
ok('the Help page still offers its four questions', pageChips.length === 4, pageChips.join(' | '));
const expect = { 'How do I publish a change?': 'publish', 'Where do enquiries go?': 'enquiries', 'How does a client pay an invoice?': 'invoices', 'What can clients see?': 'client_view' };
for (const q of pageChips) {
  const m = matchHelp(q);
  ok(`Help page: "${q}" → ${expect[q]}`, m.matched && m.id === expect[q], JSON.stringify({ id: m.id }));
}
const shell = read('shell.js');
const panelChips = JSON.parse((/var qs = (\[[^\]]+\]);/.exec(shell) || [])[1].replace(/'/g, '"'));
for (const q of panelChips) ok(`? panel: "${q}" gets a real answer`, matchHelp(q).matched, q);
ok('both boxes ask the same helper: the Help page no longer asks the site Concierge', /apiPost\('\/help\/ask'/.test(help) && !/apiPost\('\/concierge/.test(help));

// ═══ each answer opens the place it names ═══
const links = HELP_TOPICS.flatMap((t) => t.links.map((l) => ({ id: t.id, ...l })));
ok('no answer opens the empty "Open a client" picker (a bare /crm.html)', !links.some((l) => l.href === '/crm.html'), links.filter((l) => l.href === '/crm.html').map((l) => l.id).join(', '));
ok('no answer sends "Your plan" to the marketing site\'s price page', !links.some((l) => /pricing/.test(l.href)));
ok('"Your plan" opens the plan card in Settings', matchHelp('How do I change my plan?').links.some((l) => l.href === '/settings.html#billing'));
ok('"Where do enquiries go?" opens the enquiries and Customers', ['/inbox.html#enquiries', '/customers.html'].every((h) => matchHelp('Where do enquiries go?').links.some((l) => l.href === h)));
ok('a broadcast is called what the app calls it, "Send an update"', matchHelp('How do I send a broadcast?').links.some((l) => l.label === 'Open Send an update'));
ok('"invoice" alone lands on invoices, not on a client\'s project', matchHelp('invoice').id === 'invoices');
ok('every new answer also offers the full Help and a person', ['invoices', 'client_view'].every((id) => { const t = HELP_TOPICS.find((x) => x.id === id); const m = matchHelp(t.q); return m.id === id && m.links.some((l) => l.href === '/help.html') && m.links.some((l) => /^mailto:/.test(l.href)); }));

// the Help page's own cards (static links on the page)
const card = (title) => (new RegExp(`<a class="setcard" href="([^"]+)"[^>]*>(?:(?!</a>)[\\s\\S])*?<b>${title}</b>`).exec(help) || [])[1];
ok('card: Customers and deals opens Customers', card('Customers and deals') === '/customers.html', card('Customers and deals'));
ok('card: Invoices and payments opens Invoices', card('Invoices and payments') === '/invoices.html', card('Invoices and payments'));
ok('card: Getting started opens the answer that lists the first things to do, not the website wizard', card('Getting started') === '#a-around' && /id="first-owner"/.test(help) && /id="first-studio" hidden/.test(help));
ok('card: Client sites shows for a studio only', /<a class="setcard" href="\/sites\.html" id="card-sites" hidden>/.test(help) && /cs\.hidden = false/.test(help));
ok('answer: Your plan points at Settings, not the price page', /id="a-billing"[\s\S]*?href="\/settings\.html#billing"/.test(help) && !/pricing\.html/.test(help));

// ═══ search lists only what the person can open ═══
const caps = ['view_all', 'edit', 'publish', 'connect', 'configure', 'invite'];
const nav = (o) => buildNav({ role: 'business_owner', edition: 'presence', capabilities: caps, isAgency: true, isOperator: false, siteLive: true, ...o });
const flat = (n) => n.flatMap((s) => s.items);
const has = (n, key) => flat(n).some((i) => i.key === key);
ok('search: the account\'s owner finds "Your plan"', has(nav({}), 'plan') && has(nav({ isAgency: false }), 'plan'));
ok('search: a team member doesn\'t (Settings hides the card from them)', !has(nav({ role: 'business_staff' }), 'plan') && !has(nav({ role: 'business_staff', isAgency: false }), 'plan'));
ok('search: platform staff still do', has(nav({ role: 'business_staff', isOperator: true }), 'plan'));
const health = flat(nav({ isAgency: false })).find((i) => i.key === 'site_health');
ok('search: "health" opens the health check on the Search tab', !!health && health.href === '/presence.html#search' && /health/.test(health.desc + health.label) && health.hidden === true);
ok('search: the Overview no longer claims the health check', !flat(nav({ isAgency: false })).some((i) => i.key === 'content' && /health/i.test(i.desc || '')));
ok('search: inside a client, "health" opens their Search tab too', flat(nav({ scoped: true })).some((i) => i.key === 'site_health'));

// ═══ the frame's words (shell.js) ═══
ok('the bell says its number', /function bellLabel\(n\)/.test(shell) && /'Notifications, ' \+ n/.test(shell));
ok('Help sits at the top of the account menu', /var rows = '<a class="row" href="\/help\.html" id="dds-help-row">Help/.test(shell));

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.error('FAILURES'); Deno.exit(1); }
