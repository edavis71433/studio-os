// ── Wave 2, the missing doors (Oct 2026 studio audit changes 9, 11, 12 + bugs
// 7 and 10): the ⌘K entries, the Health Center's door, the ask-the-client
// flow, and the edge tidy-ups — source pins in the phase4_triage style ──────
import { buildNav } from '../../supabase/functions/presence/lib/navigation.ts';
import { signAsk, verifyAsk } from '../../supabase/functions/presence/connected/auth.ts';
const read = (p) => Deno.readTextFile(new URL(p, import.meta.url));
const ag = await read('../../agency.html');
const pipe = await read('../../pipeline.html');
const settings = await read('../../settings.html');
const conn = await read('../../connections.html');
const cb = await read('../../connections-callback.html');
const client = await read('../../client.html');
const build = await read('../../scripts/build-public.sh');
const redirects = await read('../../_redirects');
const route = await read('../../supabase/functions/presence/routes/connections.ts');
const index = await read('../../supabase/functions/presence/index.ts');
const shellSrc = await read('../../shell.js');
let pass = 0, fail = 0; const failed = [];
const ok = (n, c) => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n); } };

// ═══ bug 10 + change 11: ⌘K finds plan · team · kit · client · health, and "billing" lands on money ═══
// the palette's own match (shell.js): label, section label, or desc, case-insensitively, in nav order
const flatten = (nav) => nav.flatMap((s) => s.items.map((i) => ({ ...i, section: s.label })));
const hits = (nav, q) => flatten(nav).filter((d) => [d.label, d.section, d.desc || ''].some((x) => x.toLowerCase().includes(q)));
const caps = ['view_all', 'edit', 'publish', 'connect', 'configure', 'invite'];
const studio = buildNav({ role: 'business_owner', edition: 'presence', capabilities: caps, isAgency: true, isOperator: false, siteLive: true });
const staff = buildNav({ role: 'business_owner', edition: 'presence', capabilities: caps, isAgency: true, isOperator: true, siteLive: true });
const scoped = buildNav({ role: 'business_owner', edition: 'presence', capabilities: caps, isAgency: true, isOperator: false, scoped: true, siteLive: true });
const owner = buildNav({ role: 'business_owner', edition: 'presence', capabilities: caps, isAgency: false, isOperator: false, siteLive: true });
const visible = (nav) => flatten(nav).filter((i) => !i.hidden);
// builder list item 43 (Nov 2026): Sites joins, right after Home
// Semrush review item 112 (Nov 2026): Prospects joins, beside Pipeline
// sales item 85 (Nov 2026): To-dos after Inbox and Invoices after Pipeline, each a page of its own
ok('the studio menu lists thirteen places, Analytics back among them and Sites after Home', visible(studio).length === 13 && visible(studio).map((i) => i.label).join('·') === 'Home·Sites·Inbox·To-dos·Customers·Pipeline·Invoices·Prospects·Projects·Files·Analytics·Your website·Settings');
// Nov 9 2026: a studio whose own site lives elsewhere found an empty placeholder behind
// "Your website" and took it for a client's site. Until it publishes one here, no menu item.
const unpublished = buildNav({ role: 'business_owner', edition: 'presence', capabilities: caps, isAgency: true, isOperator: false, siteLive: false });
ok('a studio with no published site of its own has twelve places, no "Your website"', visible(unpublished).length === 12 && !visible(unpublished).some((i) => i.label === 'Your website'));
ok('…search still finds its own site, and Sites lists its clients’ sites', hits(unpublished, 'own site')[0]?.href === '/presence.html' && visible(unpublished).some((i) => i.href === '/sites.html'));
ok('inside a client the menu is still the client’s six', visible(scoped).length === 6);
ok('the plain owner’s menu is nine places and the two pages of sales item 85 (To-dos, Invoices)', visible(owner).length === 11 && ['To-dos', 'Invoices'].every((l) => visible(owner).some((i) => i.label === l)));
ok('⌘K "billing" (studio) → Pipeline’s Outstanding first, never Customers', hits(studio, 'billing')[0]?.href === '/pipeline.html#outstanding' && !hits(studio, 'billing').some((h) => h.href === '/customers.html'));
ok('⌘K "billing" (owner) → Pipeline’s Outstanding first', hits(owner, 'billing')[0]?.href === '/pipeline.html#outstanding');
ok('⌘K "billing" (scoped) → the record’s Billing tab', hits(scoped, 'billing').every((h) => h.href.startsWith('/crm.html')) && hits(scoped, 'billing').some((h) => h.href === '/crm.html?tab=billing'));
// builder list item 176: a studio's Home also has Plan my week, and the palette lists in menu order,
// so for a studio "plan" shows it first and Settings' plan right after; a plain owner has no week page
ok('⌘K "plan" → Settings’ Plan & billing (owner first; a studio sees Plan my week, then it)', hits(owner, 'plan')[0]?.href === '/settings.html#billing' && hits(studio, 'plan')[0]?.href === '/week.html' && hits(studio, 'plan').some((h) => h.href === '/settings.html#billing'));
ok('⌘K "week" → Plan my week, for a studio only', hits(studio, 'week')[0]?.href === '/week.html' && !hits(owner, 'week').some((h) => h.href === '/week.html'));
ok('⌘K "team" → Settings’ Team (studio) / Sharing & access (owner)', hits(studio, 'team')[0]?.href === '/settings.html#team' && hits(owner, 'team')[0]?.href === '/sharing.html');
ok('⌘K "kit" (and "template") → the Templates tab on Sites (item 166)', hits(studio, 'kit')[0]?.href === '/templates.html' && hits(studio, 'template')[0]?.href === '/templates.html');
ok('⌘K "client" → Customers (studio + owner)', hits(studio, 'client').some((h) => h.href === '/customers.html') && hits(owner, 'client')[0]?.href === '/customers.html');
ok('⌘K "health" → the Health Center for platform staff only', hits(staff, 'health').some((h) => h.href === '/admin-health.html') && !hits(studio, 'health').some((h) => h.href === '/admin-health.html'));
ok('every new entry is ⌘K-only (hidden) — the menu did not grow', ['billing', 'plan', 'team', 'kits', 'health'].every((k) => { const e = flatten(staff).filter((i) => i.key === k); return e.length > 0 && e.every((i) => i.hidden); }));
// builder item 202: the health check lives on the website's Search tab now (item 184), and "health" opens it there
ok('"health" still finds the website’s health check for an owner, on its Search tab', hits(owner, 'health').some((h) => h.href === '/presence.html#search'));

// ═══ change 11: the Health Center's door. Item 96 (Nov 8) moved it from the studio's
//     Home, where it was staff wording on the owner's page, to the account menu ═══
ok('agency.html: no platform line on the studio Home (item 96)', !/Platform: all clear/.test(ag) && !/id="healthDoor"/.test(ag) && !/\/admin\/health-center/.test(ag));
ok('shell.js: the account menu has "Platform health" for staff only, with its count', /CTX && CTX\.is_operator\) rows \+= '<a class="row" href="\/admin-health\.html" id="dds-health-row">Platform health/.test(shellSrc) && /api\('\/admin\/health-center'\)/.test(shellSrc) && /' areas need'\) \+ ' a look' : 'All clear'/.test(shellSrc));
ok('agency.html: no text link under the kits any more', !/Platform health — background jobs/.test(ag));
// Oct 2026 home rebuild: the kits card left the home — #kits opens Add a customer (where "Start from a kit" lives)
ok('agency.html: #kits opens Add a customer, the kits card is gone', !/class="kitcard"/.test(ag) && /location\.hash!=='#kits'/.test(ag) && /Save as a starter kit/.test(ag));

// ═══ change 12: tidy the edges ═══
ok('build-public.sh: provision.html is carved out of the public build', /for f in email-signature\.html styleguide\.html a11y\.html provision\.html; do/.test(build));
ok('_redirects: /provision and /provision.html force a 404', /^\/provision\s+\/404\.html\s+404!/m.test(redirects) && /^\/provision\.html\s+\/404\.html\s+404!/m.test(redirects));
ok('pipeline.html: ?tab= is an alias of ?dtab=, and #schedule opens Billing', /q\.get\('dtab'\)\|\|q\.get\('tab'\)/.test(pipe) && /WANT_SCHEDULE=location\.hash==='#schedule';WANT_CONVERT=location\.hash==='#convert'\|\|WANT_CONVERT_NEXT;WANT_CONVERT_NEXT=false;(WANT_PROPOSAL=q\.get\('compose'\)==='proposal';)?DTAB=DTAB_KEYS\.includes\(u\)\?u:\(\(WANT_SCHEDULE\|\|WANT_CONVERT(\|\|WANT_PROPOSAL)?\)\?'billing':'overview'\)/.test(pipe));   // #convert joined #schedule (sales review item 22); ?compose=proposal too (item 70)
ok('pipeline.html: #schedule opens the schedule builder once the deal renders', /if\(WANT_SCHEDULE\)\{WANT_SCHEDULE=false;if\(setupPlanBtn\)setupPlanBtn\.click\(\);\}/.test(pipe) && pipe.indexOf("setupPlanBtn.click()") > pipe.indexOf("$('pl-create').onclick"));
ok('pipeline.html: #outstanding opens "Who owes you" (⌘K billing)', /location\.hash==='#outstanding'\)\{[^\n]*openReceivables\(\);\}/.test(pipe));
ok('pipeline.html: the deposit mini-form’s button says "Request deposit"', /title:'Deposit'\}\);\},\{saveLabel:'Request deposit'\}\)/.test(pipe));

// ═══ bug 7: Settings' Connections card ═══
ok('settings.html: reads data.groups (the API’s shape) and names what is connected', /Object\.values\(d\.groups\)\.flat\(\)/.test(settings) && /names\.slice\(0, 2\)/.test(settings));
ok('settings.html: says "Nothing connected yet" rather than nothing', /setStatus\('connections', \{ text: 'Nothing connected yet'/.test(settings));

// ═══ change 9: ask the client to connect their Google ═══
ok('auth.ts: the ask token round-trips and binds the site', (await verifyAsk(await signAsk('site-a', 1700000000000), 'site-a')) === 1700000000000 && (await verifyAsk(await signAsk('site-a', 1700000000000), 'site-b')) === null && (await verifyAsk('garbage', 'site-a')) === null);
ok('connections.ts: the ask is operator-only while scoped, and covers Search Console, Analytics and the listing', /if \(!principal\.scope\) return json\(\{ error: 'not_scoped'/.test(route) && /ASKABLE_PROVIDERS = \['google_search_console', 'google_analytics', 'google_business_profile'\]/.test(route));
ok('connections.ts: one pending slot per client and provider (status pending + the ask in config)', /setConnection\(site\.id, it\.key, \{ status: 'pending', health: 'unknown', last_error: '', config: \{ ask_at: askedAt, ask_by: principal\.email \|\| '' \} \}\)/.test(route));
ok('connections.ts: the email carries the signed link into the client’s portal, via the ONE mailer', /\/client\.html\?connect=\$\{encodeURIComponent\(token\)\}/.test(route) && /await sendEmail\(email, subject, body, brand, \{ critical: true/.test(route) && /loadEmailBrand\(agencySiteId\)/.test(route));
ok('connections.ts: the portal read verifies the token and retires an older link after a re-ask', /askedAt = await verifyAsk\(token, site\.id\)/.test(route) && /Number\(r\.config\?\.ask_at\) === askedAt/.test(route));
ok('index.ts: /connections/ask routes before the /:key handlers', index.indexOf("route === '/connections/ask'") < index.indexOf("/^\\/connections\\/([a-z0-9_]+)(\\/connect"));
ok('connections.html: the scoped page offers the ask as a second door; the row’s Connect stays', /id="askClient"/.test(conn) && /apiPost\('\/connections\/ask', \{\}\)/.test(conn) && /if\(!SCOPE \|\| !open\.length\)\{ host\.innerHTML=''; return; \}/.test(conn) && /SCOPE \? 'Asked the client' : 'Waiting for your permission'/.test(conn));
ok('connections-callback.html: a client returns to their portal (same-site path only)', /dds-pending-return/.test(cb) && /\/\^\\\/\[\^\\\/\\\\\]\/\.test\(v\)/.test(cb) && /localStorage\.removeItem\('dds-pending-return'\)/.test(cb));
ok('client.html: ?connect= is read (and stashed through a sign-in), the ask fetched, the card painted', /params\.get\('connect'\)\|\|localStorage\.getItem\('dds-connect-ask'\)/.test(client) && /api\('\/connections\/ask'\+\(askTok\?'\?token='/.test(client) && /html\+=connectAskHtml\(\);/.test(client) && /localStorage\.setItem\('dds-connect-ask',ct\)/.test(client));
ok('client.html: Connect uses the client’s own session (no scope) and comes back to the portal', /localStorage\.removeItem\('dds-pending-scope'\);localStorage\.setItem\('dds-pending-return','\/client\.html#connections'\)/.test(client) && /api\('\/connections\/'\+encodeURIComponent\(key\)\+'\/connect','POST',\{\}\)/.test(client));

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) { console.log('FAILURES'); failed.forEach((f) => console.log(' -', f)); Deno.exit(1); }
