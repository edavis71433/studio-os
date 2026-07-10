// ── AI metering + hard ceiling: structural (P2-E W1) ─────────────────────────
//   deno run --allow-read tests/presence/ai_metering_routes_test.mjs
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const visual = read('supabase/functions/presence/routes/visual.ts');
const writer = read('supabase/functions/presence/routes/writer.ts');
const coach = read('supabase/functions/presence/routes/coach.ts');
const metering = read('supabase/functions/presence/commerce/metering.ts');
const polish = read('supabase/functions/presence/concierge/polish.ts');
const admin = read('supabase/functions/presence/routes/admin.ts');
const mig = read('supabase/migrations/0081_ai_image_metering.sql');

// ── ceiling enforced BEFORE the provider call ──
ok('ceiling: visual generate checks the ceiling BEFORE runVariations', (() => { const i = visual.indexOf('checkAiCeiling(site.client_id)'); const r = visual.indexOf('runVariations(plan, model, count)'); return i > 0 && r > 0 && i < r; })());
ok('ceiling: visual regenerate (vary/edit) also checks before runVariations', (visual.match(/checkAiCeiling\(site\.client_id\)/g) || []).length >= 2);
ok('ceiling: writer checks the ceiling before the model call', (() => { const i = writer.indexOf('checkAiCeiling(site.client_id)'); const m = writer.indexOf('meterModel(anthropicModel()'); return i > 0 && m > 0 && i < m; })());
ok('ceiling: coach checks the ceiling before runGrowthCoach', (() => { const i = coach.indexOf('checkAiCeiling(site.client_id)'); const r = coach.indexOf('runGrowthCoach(site, true)'); return i > 0 && r > 0 && i < r; })());
ok('ceiling: a blocked call returns 429 (ceilingDenial)', (visual.match(/ceilingDenial\(cors\)/g) || []).length >= 2 && /ceilingDenial\(cors\)/.test(writer) && /ceilingDenial\(cors\)/.test(coach) && /status: 429/.test(metering));

// ── ceiling logic: authoritative + bypass rules + fail-open ──
ok('ceiling: reads authoritative usage cost vs the plan hard ceiling', /hardCeilingUsd\(plan\)/.test(metering) && /estimateUsageCostUsd\(\[\{ input_tokens: row\.input_tokens/.test(metering));
ok('ceiling: founder + null-ceiling plans + env overrides bypass', /ent\.founder === true/.test(metering) && /AI_CEILING_DISABLED/.test(metering) && /AI_UNLIMITED_CLIENTS/.test(metering));
ok('ceiling: a lookup hiccup fails OPEN (never wrongly blocks a paying customer)', /failing OPEN[\s\S]*?return \{ allowed: true \}/.test(metering));
ok('ceiling: a dismissed notice cannot bypass it (ceiling is a separate hard check, not the notice)', /raiseCapacityNoticeIfNeeded/.test(metering) && /checkAiCeiling/.test(metering) && metering.indexOf('checkAiCeiling') !== metering.indexOf('raiseCapacityNoticeIfNeeded'));

// ── image metering closes the cost-invisible path (F1/H1) ──
ok('meter: visual records image usage after attachVariations (all paths)', (visual.match(/recordImageUsage\(\{ siteId: site\.id, clientId: site\.client_id, agent: 'visual' \}/g) || []).length >= 2);
ok('meter: recordImageUsage sends p_images to the atomic RPC', /recordImageUsage[\s\S]*?p_images: Math\.trunc\(images\)/.test(metering));
ok('meter: concierge polish is metered (F3)', /recordUsage\(meter, MODEL/.test(polish) && /agent: 'concierge'/.test(read('supabase/functions/presence/routes/concierge.ts')));
ok('report: admin ai-usage includes images in cost (no more $0 image spend)', /select=client_id,generative_ops,assistive_ops,input_tokens,output_tokens,images/.test(admin) && /images: x\.images/.test(admin));

// ── migration ──
ok('migration: presence_ai_usage gains an images column', /alter table public\.presence_ai_usage add column if not exists images int not null default 0/.test(mig));
ok('migration: the atomic meter RPC carries p_images', /p_images int default 0/.test(mig) && /images\s+= public\.presence_ai_usage\.images\s+\+ coalesce\(p_images, 0\)/.test(mig));
ok('migration: rollback present', /drop function if exists public\.presence_ai_meter\(uuid,uuid,text,text,text,text,int,int,int\)/.test(mig));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ AI METERING & CEILING (P2-E W1 structural): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
