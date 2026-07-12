// ── Saved proposal & contract templates (structural) ─────────────────────────
//   deno run --allow-read tests/presence/sales_templates_test.mjs
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };

const mig = read('supabase/migrations/0087_sales_templates.sql');
const sales = read('supabase/functions/presence/routes/sales.ts');
const index = read('supabase/functions/presence/index.ts');
const pipeline = read('pipeline.html');

ok('migration: site-scoped table, kind bounded to proposal|contract, deny-all RLS', /create table if not exists public\.presence_sales_templates/.test(mig) && /kind text not null check \(kind in \('proposal','contract'\)\)/.test(mig) && /enable row level security/.test(mig));
ok('routes: GET/POST /sales/templates + DELETE /sales/templates/:id', /route === '\/sales\/templates' && \(method === 'GET' \|\| method === 'POST'\)/.test(index) && /handleSalesTemplateDelete\(site, m\[1\], cors\)/.test(index));
ok('templates: list is site-scoped', /presence_sales_templates\?site_id=eq\.\$\{site\.id\}&deleted_at=is\.null/.test(sales));
ok('save-from: an existing proposal or contract can become the template (site-scoped load)', /from_proposal_id[\s\S]*?presence_proposals\?id=eq\.\$\{b\.from_proposal_id\}&site_id=eq\.\$\{site\.id\}/.test(sales) && /from_contract_id[\s\S]*?presence_contracts\?id=eq\.\$\{b\.from_contract_id\}&site_id=eq\.\$\{site\.id\}/.test(sales));
ok('use: proposal create accepts template_id (site+kind-scoped lookup)', /loadTemplate\(site\.id, String\(b\.template_id\), 'proposal'\)/.test(sales));
ok('use: contract create accepts template_id + fills placeholders from the deal', /loadTemplate\(site\.id, String\(b\.template_id\), 'contract'\)/.test(sales) && /fillPlaceholders\(site\.id, deal, String\(t\.body \|\| ''\)\)/.test(sales));
ok('placeholders: {{client_name}} + {{deal_title}} substitution exists', /client_name\\s\*\\\}\\\}/.test(sales) && /deal_title\\s\*\\\}\\\}/.test(sales));
ok('UI: one-tap "Use" buttons + "Save as template" on proposals and agreements', /data-use-ptpl/.test(pipeline) && /data-use-ctpl/.test(pipeline) && /data-tpl-prop/.test(pipeline) && /data-tpl-con/.test(pipeline));
ok('validated line items still gate template proposals (normalizeLineItems after template merge)', /b = \{ \.\.\.b, line_items: t\.line_items[\s\S]*?normalizeLineItems\(b\.line_items\)/.test(sales));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ SALES TEMPLATES (structural): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
