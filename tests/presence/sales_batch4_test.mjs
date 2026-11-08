// ── Sales review batch four (Nov 2026): items 24–28 ─────────────────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/sales_batch4_test.mjs
//
//   24  a client's Overview (today.html?client=) showed the studio's sales tiles
//       read against the client's own site: all zeros. It now leads with the
//       client's facts: project, what waits on them, what they owe, their site.
//   25  one name per thing: Customers, Send an update, Record, Needs you,
//       Waiting on them.
//   26  a repeat customer's projects and deals are lists on the record.
//   27  one tip per visit, and a shown tip is retired when the page is left.
//   28  an enquiry carries its status on every row and a private note.
import { buildNav } from '../../supabase/functions/presence/lib/navigation.ts';
const CM = await import('../../supabase/functions/presence/routes/commercial.ts');
let pass = 0, fail = 0; const failed = [];
const ok = (n, c) => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n); } };
const eq = (n, a, b) => ok(`${n} (got ${JSON.stringify(a)})`, JSON.stringify(a) === JSON.stringify(b));
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));

// ── 24 ──
const today = read('today.html');
const ws = read('supabase/functions/presence/routes/workspace.ts');
ok('the context says whether the site is live', /site_live: !!siteLive,/.test(ws));
ok('the Overview reads the record under the client\'s scope', /apiGet\('\/crm\/record\?client='\+encodeURIComponent\(new URLSearchParams\(location\.search\)\.get\('client'\)\)\)\.catch\(\(\)=>null\)/.test(today));
ok('…and the project at studio level (no scope header)', /function apiGetStudio\(path\)\{[^}]*'x-dds-scope-site':''/.test(today) && /apiGetStudio\('\/projects\/'\+encodeURIComponent\(pid\)\)/.test(today));
ok('only a studio (or platform staff) gets the band', /if\(c0 && \(c0\.is_agency \|\| c0\.is_operator\) && rec && rec\.data && rec\.data\.identity\)/.test(today));
ok('a hosted-elsewhere site is never called live', /if\(ed==='monitor'\)t\.push\(\{id:'cf-site',k:'Website',v:'Hosted elsewhere'/.test(today));
ok('an older server without site_live draws no Website tile', /else if\(ctx&&typeof ctx\.site_live==='boolean'\)/.test(today));
ok('a failed project read drops both project tiles', /if\(p\)\{   \/\/ a failed project read drops both project tiles/.test(today));
ok('the client\'s own sales tiles stay only with sales of their own', /statTiles\(facts && !salesActivity\(summary\) \? null : summary,/.test(today));

// ── 25 ──
const studioCtx = { role: 'business_owner', edition: 'presence', capabilities: ['edit', 'publish', 'invite', 'configure', 'view_all'], isAgency: true, isOperator: false, editionKey: 'studio_os', isManagedClient: false, scoped: false };
const all = (c) => buildNav(c).flatMap((s) => (s.items || []).map((i) => ({ ...i, section: s.label })));
const top = all(studioCtx);
const bc = top.find((i) => i.key === 'broadcasts');
eq('broadcasts are "Send an update" in the menu and ⌘K', bc && bc.label, 'Send an update');
ok('…and "broadcast" still finds it in ⌘K', !!bc && /broadcast/.test(bc.desc || ''));
const scoped = all({ ...studioCtx, scoped: true });
const rec = scoped.find((i) => i.key === 'record');
eq('a client\'s record is "Record" in their menu', rec && [rec.label, rec.section], ['Record', 'Record']);
ok('no nav label still says Details & billing or Broadcasts', !buildNav({ ...studioCtx, scoped: true }).concat(buildNav(studioCtx)).some((s) => s.label === 'Details & billing' || (s.items || []).some((i) => i.label === 'Details & billing' || i.label === 'Broadcasts')));
ok('Home is headed Home (final pass, batch C: the nav says Home; the Customers page is Customers)', /<h1 id="pagehead" tabindex="-1">Home<\/h1>/.test(read('agency.html')));
ok('the Customers column says Requests (batch C: it counts requests only), its badge counts requests', /\['open_support','Requests',/.test(read('customers.html')) && /att\+\(att===1\?' request':' requests'\)/.test(read('customers.html')));
ok('the record says Waiting on them', /Waiting on them/.test(read('crm.html')) && !/Waiting on client/.test(read('crm.html')));
ok('the project page says Waiting on them', !/Waiting on client/.test(read('projects.html')));
ok('Send an update\'s breadcrumb goes back to the Inbox', /<a href="\/inbox\.html">\$\{IC\.back\}Inbox<\/a>/.test(read('broadcasts.html')));
ok('the record\'s tab title is Record', /<title>Record — Studio OS<\/title>/.test(read('crm.html')));

// ── 26 ──
const crm = read('supabase/functions/presence/routes/crm.ts');
ok('the record returns every project bridged to the customer', /presence_service_links\?customer_client_id=eq\.\$\{clientId\}&agency_site_id=eq\.\$\{AS\}&status=eq\.active&select=project_id/.test(crm) && /related_projects, related_deals,/.test(crm));
ok('…and every deal that became them, on the studio\'s own site', /presence_deals\?converted_client_id=eq\.\$\{clientId\}&site_id=eq\.\$\{AS\}&deleted_at=is\.null&select=id,title,stage,expected_value_cents,updated_at/.test(crm));
const crmPage = read('crm.html');
ok('the lists draw only when there is more than one', /if\(rel\.length>1\)\{/.test(crmPage) && /if\(relD\.length>1\)\{/.test(crmPage));

// ── 27 ──
const shell = read('shell.js');
ok('a shown tip is retired when the page is left', /window\.addEventListener\('pagehide', function \(\) \{ if \(hintThisVisit\) markHint\(hintThisVisit\); \}\);/.test(shell));
ok('page tips: one per visit', /if \(hintThisVisit\) return;   \/\/ one tip per visit/.test(shell));
ok('imperative tips: one per visit', /if \(hintThisVisit\) return false;   \/\/ one tip per visit/.test(shell));

// ── 28 ──
eq('a note reads back', CM.leadNote({ name: 'x', __studio_note: { body: 'Wants a quote in March', at: '2026-11-08T10:00:00Z' } }), { body: 'Wants a quote in March', at: '2026-11-08T10:00:00Z' });
eq('no note, a blank note, a bad shape → null', [CM.leadNote({}), CM.leadNote({ __studio_note: { body: '   ' } }), CM.leadNote({ __studio_note: 'x' }), CM.leadNote(null)], [null, null, null, null]);
eq('the note is capped', CM.LEAD_NOTE_MAX, 1000);
const com = read('supabase/functions/presence/routes/commercial.ts');
ok('a note alone leaves the status as it is', /const noteOnly = typeof b\?\.note === 'string' && b\?\.status === undefined && spamFlag === null;/.test(com) && /\(spamFlag === null && !noteOnly \? 'read' : null\)/.test(com));
ok('the Inbox list carries the note', /note: leadNote\(fields\)/.test(com));
ok('an empty note clears it', /else delete fields\.__studio_note;/.test(com));
const inbox = read('inbox.html');
ok('every enquiry row says where it stands', /function rowChip\(r\)\{\s*if\(!r\.lead\)return r\.chip\|\|'';\s*const st=leadState\(r\.lead\);/.test(inbox));
ok('the note box is labelled and capped like the server', /<label for="leadNote">Your note/.test(inbox) && /<textarea id="leadNote" maxlength="1000"/.test(inbox));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
