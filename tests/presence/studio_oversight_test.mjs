// ── P2-F G4: Studio website oversight (structural) ───────────────────────────
//   deno run --allow-read tests/presence/studio_oversight_test.mjs
// The agency sees coarse website health across linked customers — reusing the
// existing portfolio, agency-scoped, no data duplication, no payment details.
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const a = read('supabase/functions/presence/routes/analytics.ts');
// SS7 seams: the per-site row SHAPE moved into the pure websiteRows builder
// (analytics/compose.ts) so parity + additive fields are fixture-pinned there.
const w = read('supabase/functions/presence/analytics/compose.ts');

ok('oversight: gated to agency members with read access (bridge/role scope)', /resolveAgencyMember\(jwt\)/.test(a) && /can\(member\.role, 'read'\)/.test(a));
ok('oversight: bounded to the agency-authorized site scope (agencySiteIds)', /const siteIds = await agencySiteIds\(member\.agency_id\)/.test(a));
ok('oversight: per-client website status (draft/live, last publish, unpublished)', /draft_live: c\.last_published_at \? 'live' : 'draft'/.test(w) && /unpublished_changes: !!c\.unpublished_changes/.test(w));
ok('oversight: surfaces publish failures (bounded query over scoped sites)', /presence_publishes\?site_id=in\.\(\$\{siteIds\.join\(','\)\}\)&status=eq\.failed/.test(a) && /publish_failed: pubFailed/.test(w));
ok('oversight: coarse SaaS blocker only (plan status, NEVER payment details)', /plan_status: plan/.test(w) && /never payment details/.test(w) && !/payment_method|stripe_customer|card_number/.test((a.split('handleAnalyticsPortfolio')[1] || '') + w));
ok('oversight: an attention flag rolls up failures + paused/lapsed plans', /needs_attention: !!c\.attention \|\| pubFailed \|\| plan === 'paused' \|\| plan === 'lapsed'/.test(w));
ok('oversight: reads live — no customer data copied into the agency workspace', /no customer data duplicated/.test(a));
ok('oversight: attention insights for failed publishes + blocked subscriptions', /key: 'publish_failed'[\s\S]*?tone: 'attention'/.test(a) && /key: 'plan_blocked'[\s\S]*?tone: 'attention'/.test(a));
ok('oversight: websites array returned to the studio', /websites, client_count: siteIds\.length/.test(a));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ P2-F G4 STUDIO WEBSITE OVERSIGHT (structural): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
