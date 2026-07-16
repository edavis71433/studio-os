// ── Unified Client Record — structural guards ────────────────────────────────
// One relationship, one page: crm.html is the Lightning-style record (header +
// highlights + Path + Details/Deal/Delivery/Files related cards + ONE activity
// timeline with a multi-action composer); /crm/record resolves any inbound key
// into a canonical identity; every entry point opens the record; the Deal and
// Delivery panels render as related-list CARDS linking into pipeline/projects
// (no iframes); "Won" stays on the same record. Pure filesystem.
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
ok('RECORD: renders the related-card tab bar (Details · Deal · Delivery · Files)', /TAB_ORDER=\['details','deal','delivery','files'\]/.test(crm) && /class="tabs"/.test(crm));
ok('RECORD: old deep links keep working (?tab=messages/overview aliases)', /TAB_ALIAS=\{overview:'details',messages:'details'/.test(crm));
ok('RECORD: with NO identity it shows a picker (never /crm/profile as the landing)', /function picker\(\)/.test(crm) && /if\(!rq\)\{ picker\(\); return; \}/.test(crm));
ok('RECORD: Deal + Delivery are related-list CARDS linking out — no iframes', /pipeline\.html[\s\S]*?Open in pipeline/.test(crm) && /projects\.html[\s\S]*?Open project/.test(crm) && !/<iframe/.test(crm) && !/embed=1/.test(crm));
ok('RECORD: sales/project reads + links run UNSCOPED (deal rows live on the agency site)', /apiAg/.test(crm) && /UNSCOPED on purpose/.test(crm) && /&client='/.test(crm));
ok('RECORD: canonical addressing redirects to ?client= for a converted customer', /canon\.key==='client'/.test(crm) && /location\.replace\('\/crm\.html\?client='/.test(crm));
ok('RECORD: highlights panel renders label-over-value tiles', /function renderHighlights/.test(crm) && /hl-panel/.test(crm));

// ═══ Path (the pipeline chevron on the record) ═══
ok('PATH: stage maps mirror pipeline.html (kept in sync by hand)', /kept in sync with pipeline\.html by hand/.test(crm) && /BOARD_NEXT=\{lead:\['qualified','lost'\]/.test(crm) && /PIPELINE_GUIDANCE/.test(crm));
// the hand-copy must stay byte-identical — pin EVERY stage key, not just the first
const boardNext = (src) => (src.match(/const BOARD_NEXT=\{[^}]+\}/) || [''])[0];
ok('PATH: BOARD_NEXT is byte-identical to pipeline.html (all six stage keys pinned)', boardNext(crm) !== '' && boardNext(crm) === boardNext(pipeline));
const stageLabelMap = (src) => (src.match(/const STAGE_LABEL=\{[^}]+\}/) || [''])[0];
ok('PATH: STAGE_LABEL is byte-identical to pipeline.html', stageLabelMap(crm) !== '' && stageLabelMap(crm) === stageLabelMap(pipeline));
ok('PATH: guidance renders BOTH tip and action (the pipeline.html:694 bug, fixed here)', /esc\(g\.tip\)/.test(crm) && /esc\(g\.action\)/.test(crm) && !/esc\(g\.suggested_action\)/.test(crm));
ok('PATH: Mark Stage as Complete advances via the stage route', /Mark Stage as Complete/.test(crm) && /\/stage','POST',\{to\}/.test(crm));
ok('PATH: won is convert-only — the button becomes a pipeline link', /Convert to customer →/.test(crm) && /signed/.test(crm));

// ═══ Embed mode on the panel pages (still supported for other hosts) ═══
ok('EMBED: pipeline.html supports ?embed=1 (hides shell + list)', /dds-embed/.test(pipeline) && /html\.dds-embed #listWrap\{display:none/.test(pipeline));
ok('EMBED: projects.html supports ?embed=1 (hides shell + list)', /dds-embed/.test(projects) && /html\.dds-embed #listWrap\{display:none/.test(projects));

// ═══ Every entry point opens the record ═══
ok('ENTRY: customers roster opens the record', /crm\.html\?client='\+encodeURIComponent\(c\.customer_site_id\)/.test(customers));
ok('ENTRY: contacts open the record (Details tab), not a here-only modal', /\/crm\.html\?contact='\+encodeURIComponent\(id\)\+'&tab=details'/.test(contacts));
ok('ENTRY: leads "view deal" + convert open the record (Deal tab)', /\/crm\.html\?deal=/.test(leads));
ok('ENTRY: agency opens the record', /crm\.html\?project=/.test(agency));

// ═══ Unified messaging → the ONE activity timeline (Salesforce anatomy) ═══
ok('MESSAGES: /crm/messages merges project msgs + support + replies into ONE thread', /export async function handleCrmMessages/.test(crmTs) && /presence_project_messages/.test(crmTs) && /presence_support_messages/.test(crmTs));
ok('MESSAGES: wired in index.ts', /route === '\/crm\/messages' && method === 'GET'\) return handleCrmMessages/.test(indexTs));
ok('ACTIVITY: /crm/activity serves the merged record timeline + upcoming', /export async function handleCrmActivity/.test(crmTs) && /buildUpcoming/.test(crmTs) && /mergeActivity/.test(crmTs));
ok('ACTIVITY: wired in index.ts', /route === '\/crm\/activity' && method === 'GET'\) return handleCrmActivity/.test(indexTs));
ok('ACTIVITY: the record renders ONE timeline + a multi-action composer', /\/crm\/activity/.test(crm) && /function renderTimeline/.test(crm) && /function renderComposer/.test(crm) && /Log call/.test(crm));
ok('ACTIVITY: deploy-order tolerant — falls back to /crm/messages + /crm/timeline', /function loadActivityFallback/.test(crm) && /\/crm\/messages\?/.test(crm) && /\/crm\/timeline/.test(crm));
// the fallback MIRRORS crm/activity.ts — the client-side normalizers must exist
// and speak the exact same six-type vocabulary the server module emits
const activityTs = read('supabase/functions/presence/crm/activity.ts');
const typeUnion = (((activityTs.match(/export type ActivityType = ([^;]+);/) || ['', ''])[1]).match(/'([a-z]+)'/g) || []).map((s) => s.replace(/'/g, ''));
ok('ACTIVITY: crm/activity.ts type vocabulary is the six-icon set', typeUnion.join(',') === 'message,email,call,task,note,system');
ok('ACTIVITY: the client-side mirrors exist (convItem + siteItem)', /function convItem\(/.test(crm) && /function siteItem\(/.test(crm));
const iconKeys = ((((crm.match(/TYPE_ICON=\{([^}]*)\}/) || ['', ''])[1]).match(/(\w+):/g)) || []).map((s) => s.replace(':', ''));
ok('ACTIVITY: the page renders exactly the vocabulary the server emits', iconKeys.join(',') === typeUnion.join(','));
const fb = crm.slice(crm.indexOf('function convItem'), crm.indexOf('const FILTER_DEFS'));
const literalTypes = [...fb.matchAll(/type:\s*'(\w+)'/g)].map((m) => m[1]);
const mappedTypes = [...fb.matchAll(/\['(\w+)','/g)].map((m) => m[1]);
ok('ACTIVITY: every type the fallback mirrors assign is inside the vocabulary', literalTypes.length > 0 && mappedTypes.length > 0 && [...literalTypes, ...mappedTypes].every((t) => typeUnion.includes(t)));
ok('ACTIVITY: the Notes chip is a real notes view (pinned-first /crm/notes + Pin/Unpin + Remove)', /function renderNotesView/.test(crm) && /\/crm\/notes\/'\+b\.getAttribute\('data-pin'\)\+'\/pin'/.test(crm) && /data-delnote/.test(crm));
ok('ACTIVITY: the reply composer keeps the honest no-target hint', /Replies open once this client has a project or an open support thread\./.test(crm));
ok('ACTIVITY: Upcoming & Overdue band with done-checkbox on deal to-dos', /Upcoming &amp; overdue/.test(crm) && /\/sales\/deal-tasks\//.test(crm));
ok('MESSAGES: inbox conversations open the record Messages tab', /tab=messages/.test(ws) && /\/crm\.html\?project=/.test(ws));

// ═══ "Won stays put" ═══
ok('WON: convert posts to the parent record instead of navigating away', /window\.parent\.postMessage\(\{type:'dds-deal-converted'/.test(pipeline));
// crm.html carries NO iframes anymore, so a message listener there could never
// fire — it must stay deleted (convert re-enters via the canonical ?client= URL)
ok('WON: no dead iframe message listener on the record page', !/dds-deal-converted/.test(crm) && !/addEventListener\('message'/.test(crm));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ UNIFIED CLIENT RECORD: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
