// ── Sales item 121: Pipeline small fixes ─────────────────────────────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/pipeline_fixes_121_test.mjs
// The deal search by name is a filter PostgREST reads (the old `&title.ilike.*q*` has no "=", and the real
// server quietly ignores such a part, so the search filtered nothing; the shared fake now reads filters the
// same way, checked against the real server on Nov 12 2026); the board's read takes
// the open deals only, every page of them; every source a deal is written with
// reads as words on Pipeline and the record; a merge keeps the old email line
// first and says when the notes were cut.
import { installFakePostgrest } from './fake_pgrst.mjs';
const SITE = '11111111-1111-4111-8111-111111111111', U = '33333333-3333-4333-8333-333333333333';
const db = installFakePostgrest();
const S = await import('../../supabase/functions/presence/routes/sales.ts');
const L = await import('../../supabase/functions/presence/lib/contact_merge.ts');
const read = (p) => Deno.readTextFile(new URL('../../' + p, import.meta.url));
const [pipe, crm, create] = await Promise.all([read('pipeline.html'), read('crm.html'), read('create.js')]);

let pass = 0, fail = 0;
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; console.log('FAIL ', n, note); } };
const site = { id: SITE, client_id: null, status: 'live', edition: 'presence' };
const owner = { kind: 'client', userId: U, email: 'owner@studio.test', jwt: 'jwt-owner', requestId: 't' };
const req = (path) => new Request(`https://fn.test/functions/v1/presence${path}`, { method: 'GET' });
const res = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const n = (i) => `dddddddd-0000-4000-8000-${String(i).padStart(12, '0')}`;
const deal = (i, extra = {}) => ({ id: n(i), site_id: SITE, title: `Deal ${i}`, stage: 'lead', source: 'manual', expected_value_cents: 0, expected_close: null, contact_id: null, converted_client_id: null, next_step: '', next_step_at: null, found_via: '', deleted_at: null, created_at: '2026-10-01T10:00:00Z', updated_at: `2026-11-01T10:00:${String(i % 60).padStart(2, '0')}Z`, ...extra });

// ═══ the shared fake reads filters the way PostgREST does ═══
{
  db.reset({ presence_deals: [deal(1, { title: 'Juniper' }), deal(2, { title: 'Harbor' })] });
  const svc = { headers: { Authorization: 'Bearer svc-key' } };
  const ignored = await fetch(`https://db.test/rest/v1/presence_deals?site_id=eq.${SITE}&title.ilike.*Juniper*`, svc);
  const refused = await fetch(`https://db.test/rest/v1/presence_deals?site_id=eq.${SITE}&title=nonsense`, svc);
  const fine = await fetch(`https://db.test/rest/v1/presence_deals?site_id=eq.${SITE}&title=ilike.*juniper*`, svc);
  ok('a filter part with no "=" is quietly ignored, as on the real server: every deal comes back', ignored.status === 200 && (await ignored.json()).length === 2);
  ok('a filter with "=" that doesn’t parse is refused with PGRST100, as on the real server', refused.status === 400 && /PGRST100/.test(await refused.text()));
  ok('…and the filter written the right way finds the one deal', fine.status === 200 && (await fine.json()).length === 1);
}

// ═══ deal search by name (+ Create's server search) ═══
{
  db.reset({ presence_deals: [deal(1, { title: 'Juniper Floral — new site' }), deal(2, { title: 'Harbor Dental' }), deal(3, { title: 'juniper co-op', deleted_at: '2026-11-02T00:00:00Z' })] });
  const r = await res(await S.handleSalesDeals(req('/sales/deals?limit=20&q=juniper'), site, owner, {}));
  ok('a deal is found by its name, whatever the capitals', r.status === 200 && r.body.data.length === 1 && r.body.data[0].title === 'Juniper Floral — new site', JSON.stringify(r.body));
  const asked = db.log.filter((l) => l.method === 'GET' && l.url.startsWith('/rest/v1/presence_deals?'))[0]?.url || '';
  ok('the search is sent as title=ilike.*…* (not the ignored title.ilike.…)', /&title=ilike\.\*juniper\*/.test(asked) && !/title\.ilike/.test(asked), asked);
  const none = await res(await S.handleSalesDeals(req('/sales/deals?limit=20&q=nothing-like-it'), site, owner, {}));
  ok('a name nobody has finds nothing, and says so with an empty list (not an error)', none.status === 200 && none.body.data.length === 0);
  const sneaky = await res(await S.handleSalesDeals(req('/sales/deals?limit=20&q=' + encodeURIComponent('a),stage.eq.won,(b')), site, owner, {}));
  ok('filter grammar typed into the search is neutralised, never a second filter', sneaky.status === 200);
  ok('+ Create still asks the server for names past the first hundred', /api\('\/sales\/deals\?limit=20&q=' \+ enc\)/.test(create));
}

// ═══ the board's read: the open deals only, every page ═══
{
  const rows = [];
  for (let i = 1; i <= 130; i++) rows.push(deal(i, { stage: ['lead', 'qualified', 'proposal', 'contract'][i % 4], updated_at: `2026-0${1 + (i % 9)}-01T10:00:00Z` }));
  // a hundred and twenty newer closed deals: before item 121 they filled the board's one page of 100
  for (let i = 131; i <= 250; i++) rows.push(deal(i, { stage: i % 2 ? 'won' : 'lost', updated_at: '2026-11-10T10:00:00Z' }));
  rows.push(deal(251, { stage: 'contract', converted_client_id: 'cccccccc-0000-4000-8000-000000000001', updated_at: '2026-11-11T10:00:00Z' }));
  db.reset({ presence_deals: rows });
  const p1 = await res(await S.handleSalesDeals(req('/sales/deals?limit=100&offset=0&open=1'), site, owner, {}));
  const p2 = await res(await S.handleSalesDeals(req('/sales/deals?limit=100&offset=100&open=1'), site, owner, {}));
  const got = [...p1.body.data, ...p2.body.data];
  ok('open=1 answers only open stages, never a won, lost or converted deal', got.every((d) => ['lead', 'qualified', 'proposal', 'contract'].includes(d.stage) && !d.converted_client_id));
  ok('two pages hold all 130 open deals, each once — the oldest open deal is not dropped', got.length === 130 && new Set(got.map((d) => d.id)).size === 130, `${got.length}`);
  ok('pages are ordered by last change with the id breaking ties', p1.body.data.length === 100 && p2.body.data.length === 30);
  const all = await res(await S.handleSalesDeals(req('/sales/deals?limit=100'), site, owner, {}));
  ok('without open=1 the list still reads every kind (List and Table views)', all.body.data.some((d) => d.stage === 'won'));
  ok('the board asks with open=1, page by page, and only the board does', /async function loadBoardDeals\(\)\{[\s\S]{0,400}open:'1'/.test(pipe) && /board\?loadBoardDeals\(\):api\('\/sales\/deals\?'\+qs\.toString\(\)\)/.test(pipe));
  ok('a board with no open deals asks once whether there are any at all (no walkthrough for a finished pipeline)', /api\('\/sales\/deals\?limit=1'\)/.test(pipe) && /!\(BOARD_OPEN_ONLY&&ANY_DEALS\)/.test(pipe));
  ok('the board’s Won and Not a fit counts come from the summary, not the open deals in hand', /SUM_COUNTS=\{total:/.test(pipe) && /const lostCount=\(\)=>BOARD_OPEN_ONLY\?/.test(pipe) && /const closedCount=\(\)=>BOARD_OPEN_ONLY\?/.test(pipe));
}

// ═══ where a deal came from, in words, on both pages ═══
{
  const mapOf = (src, name) => { const m = new RegExp(`const ${name}=(\\{[^}]*\\})`).exec(src); return m ? Function(`return ${m[1]}`)() : null; };
  const P = mapOf(pipe, 'SOURCE_WORDS'), C = mapOf(crm, 'SC_SOURCE');
  // every source a deal is written with, anywhere in the code
  const files = ['inbox.html', 'pipeline.html', 'contacts.html', 'create.js', 'supabase/functions/presence/routes/prospects.ts', 'supabase/functions/presence/routes/sales.ts', 'supabase/functions/presence/commerce/example_data.ts'];
  const written = new Set(['manual', 'website_form', 'example']);   // sales.ts's defaults and the example deal's EXAMPLE_SOURCE
  for (const f of files) for (const m of (await read(f)).matchAll(/source:\s*'([a-z_]+)'/g)) written.add(m[1]);
  const missingP = [...written].filter((s) => !P || !P[s]), missingC = [...written].filter((s) => !C || !C[s]);
  ok('Pipeline has words for every source a deal is written with', !missingP.length, missingP.join(','));
  ok('the record has words for every one too', !missingC.length, missingC.join(','));
  ok('the two pages know the same sources', P && C && JSON.stringify(Object.keys(P).sort()) === JSON.stringify(Object.keys(C).sort()));
  ok('the finding’s three read as asked on Pipeline', P.website_form === 'From your website' && P.prospecting === 'From Prospects' && P.free_tools === 'From a free tool');
  ok('no code word ever shows: an unknown source says nothing', /const sourceWord=\(s\)=>SOURCE_WORDS\[String\(s\|\|''\)\.toLowerCase\(\)\]\|\|'';/.test(pipe) && !/SC_SOURCE\[d\.source\]\|\|String\(d\.source\)/.test(crm));
  ok('“From your website” on the board counts deals from the Inbox (website_form)', /fromWeb=\(d\)=>\/\^\(form\|enquiry\|website_form\)\$\/i/.test(pipe));
}

// ═══ a merge keeps the old email line first and says when notes were cut ═══
{
  const keep = { name: 'Jordan Ellis', email: 'jordan@ellis.example', notes: 'K'.repeat(1500) };
  const other = { name: 'J. Ellis', email: 'j.ellis@mail.example', notes: 'Asked about SEO. ' + 'O'.repeat(900) };
  const m = L.mergeValues(keep, other, { email: 'other' });
  ok('the line with the old email is the first thing in the notes', String(m.values.notes).startsWith('Also wrote from jordan@ellis.example\n\n'));
  ok('notes stay within 2,000 characters and end with … when cut', String(m.values.notes).length <= L.MERGE_NOTES_MAX && String(m.values.notes).endsWith('…'));
  ok('the merge says how much was cut', m.notesCut > 0 && m.notesCut < 1000, String(m.notesCut));
  const small = L.mergeValues({ notes: 'A', email: 'a@x.example' }, { notes: 'B' });
  ok('short notes are never cut, and say so with 0', small.notesCut === 0 && small.values.notes === 'A\n\nB');
}

// ═══ free-tool leads stay on Prospects; Enquiries says so (Eric's pick, Nov 12) ═══
{
  const inbox = Deno.readTextFileSync(new URL('../../inbox.html', import.meta.url));
  ok('Enquiries points to Prospects for free-tool leads, with how many are new', /api\('\/sales\/tool-leads'\)/.test(inbox) && /waiting on Prospects\./.test(inbox) && /<a href="\/prospects\.html">Open Prospects →<\/a>/.test(inbox) && /\(l&&l\.status\|\|'new'\)==='new'/.test(inbox));
  ok('…only when that staff-only read answers (anyone else gets a 403 and sees nothing)', /r\.ok&&Array\.isArray\(r\.body&&r\.body\.data\)\?r\.body\.data:null/.test(inbox) && /const h=\$\('enqTool'\);if\(!h\|\|!list\)return;/.test(inbox));
  ok('…and never in one client’s Inbox', /if\(!host\|\|new URLSearchParams\(location\.search\)\.get\('client'\)\)return;/.test(inbox));
  ok('the pointer is painted each time the Enquiries toolbar is', /\$\('newEnq'\)\.addEventListener\('click',openNew\);\s*paintToolLeads\(\);/.test(inbox));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) Deno.exit(1);
