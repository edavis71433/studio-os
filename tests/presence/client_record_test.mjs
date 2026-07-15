// ── Unified Client Record — structural guards ────────────────────────────────
// One relationship, one page: crm.html is the record (header + Overview/Deal/
// Delivery/Details tabs); /crm/record resolves any inbound key into a canonical
// identity; every entry point opens the record; the deal/project panels embed via
// ?embed=1; "Won" stays on the same record (no navigation away). Pure filesystem.
//   deno run --allow-read tests/presence/client_record_test.mjs
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };

const crmTs = read('supabase/functions/presence/routes/crm.ts');
const indexTs = read('supabase/functions/presence/index.ts');
const ws = read('supabase/functions/presence/routes/workspace.ts');
const crm = read('crm.html');
const pipeline = read('pipeline.html');
const projects = read('projects.html');
const customers = read('customers.html');
const contacts = read('contacts.html');
const leads = read('leads.html');
const agency = read('agency.html');

// ═══ Resolver (backend) ═══
ok('RESOLVER: /crm/record resolver exists', /export async function handleCrmRecord/.test(crmTs));
ok('RESOLVER: accepts any inbound key (contact/deal/client/project)', /qp\('contact'\)/.test(crmTs) && /qp\('deal'\)/.test(crmTs) && /qp\('project'\)/.test(crmTs) && /client_id/.test(crmTs));
ok('RESOLVER: returns identity + sections + canonical + default_tab', /identity:/.test(crmTs) && /sections/.test(crmTs) && /canonical/.test(crmTs) && /default_tab/.test(crmTs));
ok('RESOLVER: overview is gated on a customer SITE (no un-scoped landmine)', /overview: !!customerSiteId/.test(crmTs));
ok('RESOLVER: wired in index.ts', /route === '\/crm\/record' && method === 'GET'\) return handleCrmRecord/.test(indexTs));

// ═══ The record page ═══
ok('RECORD: crm.html loads the resolver', /\/crm\/record/.test(crm) && /function loadRecord/.test(crm));
ok('RECORD: renders a tab bar across the record sections', /TAB_ORDER=\['overview','messages','deal','delivery','details'\]/.test(crm) && /class="tabs"/.test(crm));
ok('RECORD: with NO identity it shows a picker (never /crm/profile as the landing)', /function picker\(\)/.test(crm) && /if\(!rq\)\{ picker\(\); return; \}/.test(crm));
ok('RECORD: Deal + Delivery embed the existing panels via ?embed=1', /pipeline\.html\?deal=[\s\S]*?embed=1/.test(crm) && /projects\.html\?project=[\s\S]*?embed=1/.test(crm));
ok('RECORD: embeds run UNSCOPED (deal/project live on the agency site)', /Deal \+ Delivery embeds run UNSCOPED/.test(crm));
ok('RECORD: canonical addressing redirects to ?client= for a converted customer', /canon\.key==='client'/.test(crm) && /location\.replace\('\/crm\.html\?client='/.test(crm));

// ═══ Embed mode on the panel pages ═══
ok('EMBED: pipeline.html supports ?embed=1 (hides shell + list)', /dds-embed/.test(pipeline) && /html\.dds-embed #listWrap\{display:none/.test(pipeline));
ok('EMBED: projects.html supports ?embed=1 (hides shell + list)', /dds-embed/.test(projects) && /html\.dds-embed #listWrap\{display:none/.test(projects));

// ═══ Every entry point opens the record ═══
ok('ENTRY: customers roster opens the record', /crm\.html\?client='\+encodeURIComponent\(c\.customer_site_id\)/.test(customers));
ok('ENTRY: contacts open the record (Details tab), not a here-only modal', /\/crm\.html\?contact='\+encodeURIComponent\(id\)\+'&tab=details'/.test(contacts));
ok('ENTRY: leads "view deal" + convert open the record (Deal tab)', /\/crm\.html\?deal=/.test(leads));
ok('ENTRY: agency opens the record', /crm\.html\?project=/.test(agency));

// ═══ Unified messaging (Salesforce activity model) ═══
ok('MESSAGES: /crm/messages merges project msgs + support + replies into ONE thread', /export async function handleCrmMessages/.test(crmTs) && /presence_project_messages/.test(crmTs) && /presence_support_messages/.test(crmTs));
ok('MESSAGES: wired in index.ts', /route === '\/crm\/messages' && method === 'GET'\) return handleCrmMessages/.test(indexTs));
ok('MESSAGES: the record has a Messages tab with one reply composer', /TAB_ORDER=\['overview','messages'/.test(crm) && /function loadMessages/.test(crm) && /msg-thread/.test(crm));
ok('MESSAGES: inbox conversations open the record Messages tab', /tab=messages/.test(ws) && /\/crm\.html\?project=/.test(ws));

// ═══ "Won stays put" ═══
ok('WON: convert posts to the parent record instead of navigating away', /window\.parent\.postMessage\(\{type:'dds-deal-converted'/.test(pipeline));
ok('WON: the record reveals Delivery on convert (listens for the message)', /dds-deal-converted'\|\|m\.type==='dds-open-delivery'/.test(crm));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ UNIFIED CLIENT RECORD: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
