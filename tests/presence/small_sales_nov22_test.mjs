// ── Sales items 158, 194, 196, 198, 204, 208 and 215 (Nov 22 2026): counts that say what they count ──
//   deno run --allow-read --allow-env --allow-net tests/presence/small_sales_nov22_test.mjs
// Item 195 (Home's "Your business details" step) is in setup_strip_105_test.mjs, beside the strip.
// Each check drives the real code where it can: the server on the pretend database, and the pages'
// own helpers lifted out of the page and run (a page helper that reads today gets a pinned day, not
// the real clock). The three checks that read a page's words are there because the words are the fix.
import { installFakePostgrest } from './fake_pgrst.mjs';
const ME_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const SITE = '11111111-1111-4111-8111-111111111111', AGENCY = 'cccccccc-0000-4000-8000-000000000001', PROJ = 'bbbbbbbb-0000-4000-8000-000000000001';
const db = installFakePostgrest({ users: { 'jwt-owner': { id: ME_ID, email: 'owner@studio.test' } } });
const C = await import('../../supabase/functions/presence/crm/contract.ts');
const R = await import('../../supabase/functions/presence/lib/sales_reports.ts');
const S = await import('../../supabase/functions/presence/routes/sales.ts');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n, note); } };
const eq = (n, got, want) => ok(n, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}`);

const ROOT = new URL('../../', import.meta.url);
const page = (f) => Deno.readTextFileSync(new URL(f, ROOT));
const CRM = page('crm.html');
const TODOS = page('todos.html');
const PROS = page('prospects.html');
const PIPE = page('pipeline.html');
const CUST = page('customers.html');
const BC = page('broadcasts.html');
const INBOX = page('inbox.html');
const ANA = page('analytics.html');
// a page's one-line helper, or a function up to its closing brace at the start of a line
const lineOf = (text, start) => { const l = text.split('\n').find((x) => x.startsWith(start)); if (!l) throw new Error('not on the page: ' + start); return l; };
const blockOf = (text, start) => { const i = text.indexOf(start); if (i < 0) throw new Error('not on the page: ' + start); return text.slice(i, text.indexOf('\n}', i) + 2); };
// the pinned day a lifted helper reads as "today": Nov 22 2026, noon UTC
const AT = Date.parse('2026-11-22T12:00:00Z');
class PinnedDate extends Date { constructor(...a) { super(...(a.length ? a : [AT])); } }

// ═══ 194: the customer record in plain words ═══
{
  const phoneWords = new Function(lineOf(CRM, 'const phoneWords=') + '\nreturn phoneWords;')();
  eq('194: a ten-digit phone reads (818) 555-0142, with or without the 1; anything else stays as typed',
    ['8185550142', '+1 818 555 0142', '(818)555-0142', '818-555-0142 ext 12', '+44 20 7946 0958', ''].map(phoneWords),
    ['(818) 555-0142', '(818) 555-0142', '(818) 555-0142', '818-555-0142 ext 12', '+44 20 7946 0958', '']);
  const NOW = '2026-11-22T12:00:00Z';
  const prof = (over) => { const b = { business_name: 'Brightline', edition: 'presence', status: 'draft', live: false, last_published_at: null, members: 1, connected: 2, connected_needing_attention: 0, active_moments: 3, pending_approvals: 0, ...over }; return { ...b, health: C.deriveClientHealth(b, NOW) }; };
  const said = C.relationshipSummary(prof({}), null, NOW);
  ok('194: the summary says linked accounts and updates to share, with no builder words and no long dash',
    said === 'Brightline is getting set up: nothing has been published yet. All 2 linked accounts are working. 3 updates are ready to share with them.', said);
  const one = C.relationshipSummary(prof({ connected: 1, active_moments: 1, live: true, status: 'live' }), null, NOW);
  const bad = C.relationshipSummary(prof({ connected: 2, connected_needing_attention: 1, active_moments: 0 }), null, NOW);
  ok('194: one of each reads as one, and an account that needs a look says so', one.includes('Their linked account is working.') && one.includes('1 update is ready to share with them.') && bad.includes('1 linked account needs a look.') && !/update/.test(bad), `${one} | ${bad}`);
  // the record's own words: the At a glance facts, the next step in full, the two cards named, the status in words
  ok('194: the record names what each fact counts, the suggested step in full, and "Project" and "Deal" on their cards', CRM.includes("['Changes to approve', String(p.pending_approvals||0), p.pending_approvals?'waiting on them':'none waiting']") && CRM.includes("['Linked accounts', String(p.connected||0)") && CRM.includes("['Updates to share', String(p.active_moments||0)") && CRM.includes('<h2>At a glance</h2>') && !CRM.includes("'worth a look']") && CRM.includes("v:esc(ns||suggested||'—'),wrap:!!(ns||suggested)") && CRM.includes("'Suggested, not set yet'") && CRM.includes(".hl-v.wrap{white-space:normal") && CRM.includes("esc(d.title?'Deal · '+d.title:'Deal')") && CRM.includes("esc(p.name?'Project · '+p.name:'Project')") && CRM.includes("esc(SC_STATUS[p.status]||"));
}

// ═══ 198: a record tab keeps the page's own address ═══
{
  const setTabUrl = new Function('QP', 'history', 'location', lineOf(CRM, 'function setTabUrl(tab){') + '\nreturn setTabUrl;');
  const wrote = [];
  const history = { replaceState: (_s, _t, url) => wrote.push(url) };
  setTabUrl(() => new URLSearchParams('client=s1'), history, { pathname: '/crm' })('billing');
  setTabUrl(() => new URLSearchParams('deal=d1&tab=deal'), history, { pathname: '/crm.html' })('details');
  eq('198: pressing a tab writes the address the page was opened at (/crm live), never the old /crm.html', wrote, ['/crm?client=s1&tab=billing', '/crm.html?deal=d1&tab=details']);
}

// ═══ 196: where a deal came from has one set of words: the list's, Analytics' and the record's row ═══
{
  const words = Function(`return ${/const SOURCE_WORDS=(\{[^}]*\})/.exec(PIPE)[1]}`)();
  const differ = Object.keys(words).filter((k) => R.sourceLabel(k) !== words[k]);
  ok('196: Analytics groups a deal under the same words Pipeline shows for it ("Added by you", not "Added by hand")', !differ.length && R.sourceLabel('manual') === 'Added by you', differ.join(','));
  eq('196: a source with no words reads as words, and none as Not recorded', [R.sourceLabel('trade_show'), R.sourceLabel('')], ['Trade show', 'Not recorded']);
}

// ═══ 158 + 204: To-dos counts what Home counts, finds everyone, and tells two of a name apart ═══
{
  const TD = new Function('DATA', 'teamOn', 'mineItem', [lineOf(TODOS, 'const dayDiff='), lineOf(TODOS, 'const upNow='), lineOf(TODOS, 'function groupOf('), blockOf(TODOS, 'function headLine(today){')].join('\n') + '\nreturn { headLine, groupOf };');
  const items = [
    { kind: 'next_step', id: 'n1', title: 'Call back', due: '2026-11-21', owner: 'me' },
    { kind: 'deal_task', id: 't1', title: 'Send the quote', due: '2026-11-22', owner: 'mate' },
    { kind: 'project_task', id: 'p1', title: 'Write the brief', due: null, later: false },
    { kind: 'project_task', id: 'p2', title: 'Upload photos', due: null, later: true },
    { kind: 'project_task', id: 'p3', title: 'Check the form', due: null, later: true },
  ];
  const solo = TD({ items }, () => false, () => true), team = TD({ items }, () => true, (t) => t.kind === 'project_task' || t.owner === 'me');
  eq('158: "open" leaves out the project steps waiting on an earlier one, the way Home\'s My to-dos does', solo.headLine('2026-11-22'), '3 open · 1 overdue · 1 due today');
  eq('158: with a team, the line says how many are yours (Home\'s number)', team.headLine('2026-11-22'), '3 open · 2 yours · 1 overdue · 1 due today');
  eq('204: a waiting project step sits in its own group, not "No date"', items.map((t) => solo.groupOf(t, '2026-11-22')), ['over', 'today', 'nodate', 'wait', 'wait']);

  // the picker reads page after page until a short one
  const asked = [];
  const people = Array.from({ length: 230 }, (_, i) => ({ id: 'c' + i, name: 'Person ' + i }));
  const api = async (path) => { asked.push(path); const off = Number(/offset=(\d+)/.exec(path)[1]); return { ok: true, body: { data: people.slice(off, off + 100) } }; };
  const readAll = new Function('api', blockOf(TODOS, 'async function readAll(path,most){') + '\nreturn readAll;')(api);
  const got = await readAll('/sales/contacts?sort=name', 5000);
  ok('204: "Who it\'s for" finds everyone, not the first 100 (three reads for 230 people)', got.length === 230 && asked.length === 3 && asked[2] === '/sales/contacts?sort=name&limit=100&offset=200', JSON.stringify(asked));
  const failing = new Function('api', blockOf(TODOS, 'async function readAll(path,most){') + '\nreturn readAll;')(async (p) => (/offset=100/.test(p) ? { ok: false } : { ok: true, body: { data: people.slice(0, 100) } }));
  eq('204: a page that fails keeps the ones read before it', (await failing('/sales/deals?open=1', 2000)).length, 100);
  ok('204: the picker reads people and open deals that way, and the waiting group is named and waits behind Show', TODOS.includes("readAll('/sales/contacts?sort=name',5000),api('/studio/customers'),readAll('/sales/deals?open=1',2000)") && TODOS.includes("['wait','Waiting on an earlier step']") && TODOS.includes("const shut=(g==='later'||g==='wait')&&SHOW==='open'&&!OPENED.has(g);"));

  const pickLabels = new Function(blockOf(TODOS, 'function pickLabels(list,kind,other){') + '\nreturn pickLabels;')();
  const ppl = [{ id: 'a', name: 'Ana Ruiz', email: 'ana@one.test' }, { id: 'b', name: 'Ana Ruiz', email: 'ana@two.test' }, { id: 'c', name: 'Lee Park', email: '' }];
  const cus = [{ id: 'k1', name: 'Ana Ruiz', email: 'ana@one.test' }, { id: 'k2', name: 'Harbor Cafe', email: '' }];
  eq('204: a name in both lists says which is which, and two people of one name add their email',
    [...pickLabels(ppl, 'person', cus), ...pickLabels(cus, 'customer', ppl)].map((x) => x.label),
    ['Ana Ruiz · ana@one.test (person)', 'Ana Ruiz · ana@two.test (person)', 'Lee Park', 'Ana Ruiz (customer)', 'Harbor Cafe']);
}

// ═══ 158: Home's My to-dos counts what is up now over the whole list, past the 50 it shows ═══
{
  const step = (id, title, sort) => ({ id, site_id: SITE, project_id: PROJ, title, status: 'todo', due_date: null, assigned_to: null, client_action_required: false, sort_order: sort, deleted_at: null, created_at: '2026-11-01T00:00:00Z' });
  const deals = Array.from({ length: 52 }, (_, i) => ({ id: `dddddddd-0000-4000-8000-${String(i).padStart(12, '0')}`, site_id: SITE, title: 'Deal ' + i, stage: 'lead', source: 'manual', expected_value_cents: 0, contact_id: null, converted_client_id: null, assigned_to: null, next_step: 'Call them', next_step_at: null, deleted_at: null, updated_at: '2026-11-10T00:00:00Z' }));
  db.reset({
    presence_agencies: [{ id: AGENCY, name: 'Bright Studio', status: 'active', seat_limit: 5, client_limit: 25, plan: 'agency', branding: {} }],
    presence_agency_members: [{ id: 'm1', agency_id: AGENCY, email: 'owner@studio.test', user_id: ME_ID, role: 'owner', status: 'active', created_at: '2026-01-01T00:00:00Z' }],
    presence_agency_clients: [], presence_deals: deals, presence_deal_tasks: [], presence_contacts: [], presence_sales_templates: [], presence_deal_events: [],
    presence_tasks: [step('s1', 'Write the brief', 1), step('s2', 'Upload photos', 2), step('s3', 'Check the form', 3)],
    presence_projects: [{ id: PROJ, site_id: SITE, name: 'A project', status: 'active', deleted_at: null }],
  });
  const site = { id: SITE, client_id: null, status: 'live', edition: 'presence' };
  const owner = { kind: 'client', userId: ME_ID, email: 'owner@studio.test', jwt: 'jwt-owner', requestId: 't' };
  const r = await S.handleSalesMyTasks(new Request('https://fn.test/functions/v1/presence/sales/my-tasks'), site, owner, {});
  const d = (await r.json()).data;
  ok('158: my-tasks says how many are up now over the whole list (53 of 55; the two waiting steps aside), while it sends the first 50', r.status === 200 && d.items.length === 50 && d.total === 55 && d.now === 53, JSON.stringify({ n: d.items.length, total: d.total, now: d.now }));
}

// ═══ 208: Prospects and Send an update in words ═══
{
  const dayWords = new Function('Date', lineOf(PROS, 'const dayWords=') + '\nreturn dayWords;')(PinnedDate);
  const kindWords = new Function(lineOf(PROS, 'const kindWords=') + '\nreturn kindWords;')();
  eq('208: a lead\'s day reads "Oct 26", with the year only when it isn\'t this one', [dayWords('2026-10-26T15:00:00Z'), dayWords('2025-12-30T15:00:00Z'), dayWords(''), dayWords('soon')], ['Oct 26', 'Dec 30, 2025', '', '']);
  eq('208: the kind of business in words; the free tools\' "other" says nothing', ['other', 'home services', 'home_services', 'salon', '', 'Other'].map(kindWords), ['', 'Home services', 'Home services', 'Salon', '', '']);
  const placeholders = [...BC.matchAll(/placeholder="([^"]*)"/g)].map((m) => m[1]);
  ok('208, 198, 158, 194, 215: no name code in Send an update\'s placeholders, List over Customers\' rows, Inbox names its notices, Expires in words, Money in beside Won this month', placeholders.length > 0 && !placeholders.some((p) => p.includes('{{')) && BC.includes('placeholder="Hi there,&#10;&#10;Write your update here. + First name below greets each person by name."') && CUST.includes(">List</button></div>") && !/>Cards<\/button>/.test(CUST) && INBOX.includes("and ${sysN} thing${sysN===1?'':'s'} worth a look") && PIPE.includes("'Expires '+exp.toLocaleDateString('en-US',exp.getFullYear()===") && ANA.includes("numCard({label:'Money in · '+mon(cur.label)") && !ANA.includes("label:'Revenue"));
}

console.log(`\n════ SALES 158, 194, 196, 198, 204, 208, 215 (Nov 22): ${pass}/${pass + fail} PASSED ════`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
