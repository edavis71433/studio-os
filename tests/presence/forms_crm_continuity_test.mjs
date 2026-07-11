// ── P2-F G1: Forms → Leads → CRM continuity (structural) ─────────────────────
//   deno run --allow-read tests/presence/forms_crm_continuity_test.mjs
// Website enquiry → deal must be idempotent (one deal per submission), mark the
// enquiry converted, link it, and stay tenant-safe.
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const sales = read('supabase/functions/presence/routes/sales.ts');
const commercial = read('supabase/functions/presence/routes/commercial.ts');
const leads = read('leads.html');
const mig = read('supabase/migrations/0085_form_submission_converted.sql');

// dedupe: one deal per website enquiry
ok('dedupe: an existing deal for the submission is returned, not duplicated', /source_submission_id=eq\.\$\{srcSub\}&deleted_at=is\.null[\s\S]*?if \(existing\) return json\(\{ data: existing, already_converted: true \}/.test(sales));
ok('dedupe: the lookup is tenant-scoped (site_id)', /presence_deals\?site_id=eq\.\$\{site\.id\}&source_submission_id=eq\.\$\{srcSub\}/.test(sales));
ok('convert: the originating enquiry is marked converted (system status)', /presence_form_submissions\?id=eq\.\$\{srcSub\}&site_id=eq\.\$\{site\.id\}`, \{ method: 'PATCH', body: JSON\.stringify\(\{ status: 'converted' \}\)/.test(sales));
ok('convert: the created event carries the source submission (deep-link provenance)', /dealEvent\(site\.id, deal\.id, 'created', principal, \{ to_stage: 'lead', source_submission_id: srcSub \}\)/.test(sales));

// inbox: link each enquiry to its deal, tenant-scoped, bounded
ok('inbox: links each enquiry to its CRM deal (converted + deal_id)', /deal_id: dealMap\.get\(String\(s\.id\)\) \|\| null, converted: s\.status === 'converted' \|\| dealMap\.has/.test(commercial));
ok('inbox: the deal lookup is site-scoped + bounded to the shown ids', /presence_deals\?site_id=eq\.\$\{site\.id\}&deleted_at=is\.null&source_submission_id=in\.\(\$\{ids\.join\(','\)\}\)/.test(commercial));

// frontend: converted state + deep link + no re-convert
ok('leads UI: converted enquiry shows "in pipeline — view deal" deep link', /l\.converted\?`<a class="reply" href="\/pipeline\.html\?deal=\$\{esc\(l\.deal_id\|\|''\)\}/.test(leads));
ok('leads UI: the "→ Deal" button is hidden once converted (no re-convert)', /l\.converted\?[\s\S]*?:`<button data-deal=/.test(leads));
ok('leads UI: reflects idempotent server response ("already in your pipeline")', /already_converted\?'This enquiry is already in your pipeline\.'/.test(leads));
ok('wording: "Website enquiry" terminology used consistently', /website enquiry/i.test(leads) && /website enquiry/i.test(commercial));

// migration
ok('migration: status widened with terminal converted + dedupe index', /check \(status in \('new','read','archived','converted'\)\)/.test(mig) && /presence_deals_source_submission_idx/.test(mig));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ P2-F G1 FORMS→CRM CONTINUITY (structural): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
