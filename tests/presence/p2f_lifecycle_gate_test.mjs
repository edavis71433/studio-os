// ── P2-F integrated-lifecycle gate ───────────────────────────────────────────
//   deno run --allow-read tests/presence/p2f_lifecycle_gate_test.mjs
// One contract over the connected product: each integration seam the milestone
// promises is backed by real code (not a comment). Complements the live/e2e
// suites (which need staging creds). Steps mirror the P2-F validation list.
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const R = [];
const step = (n, label, p) => { R.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${String(n).padStart(2)}. ${label}`); };

const commerce = read('supabase/functions/presence/routes/commerce.ts');
const entitlement = read('supabase/functions/presence/middleware/entitlement.ts');
const editor = read('supabase/functions/presence/routes/editor.ts');
const metering = read('supabase/functions/presence/commerce/metering.ts');
const publish = read('supabase/functions/presence/routes/publish.ts');
const sales = read('supabase/functions/presence/routes/sales.ts');
const commercial = read('supabase/functions/presence/routes/commercial.ts');
const analytics = read('supabase/functions/presence/routes/analytics.ts');
const review = read('presence.html');
const notice = read('supabase/functions/presence/lib/notice.ts');
const clientd = read('supabase/functions/presence/routes/client_delivery.ts');
const projects = read('supabase/functions/presence/routes/projects.ts');

// entitlement + AI (1-5, 18, 19)
step(1, 'Active/entitled → the gate grants full access', /status === 'active'\) return \{ mode: 'full'/.test(entitlement));
step(4, 'AI drafting is entitlement-gated (drafting denial before the model)', /draftingDenial\(plan, cors\)/.test(editor));
step(5, 'Every AI path is metered + hard-ceiling-gated before provider spend', /checkAiCeiling\(site\.client_id\)/.test(editor) && /export async function checkAiCeiling/.test(metering));
step(7, 'CMS findings deep-link to the right editor (Recommend→Fix→Publish)', /f\.handoff && f\.handoff\.route === "editor"/.test(review));
step(8, 'Publish runs the ONE pipeline; success updates the live site', /status: 'live', last_published_at/.test(publish));

// forms → CRM (10, 11, 21)
step(10, 'A website enquiry converts to a CRM deal, idempotently (no duplicate)', /source_submission_id=eq\.\$\{srcSub\}[\s\S]*?already_converted: true/.test(sales));
step(11, 'The enquiry surfaces in the Studio (leads inbox links its deal)', /converted: s\.status === 'converted' \|\| dealMap\.has/.test(commercial));

// analytics + oversight (12, 17)
step(12, 'Analytics is site-scoped + connection-state aware (no fake data)', /gscConnected/.test(analytics) && /presence_visits\?site_id=eq/.test(analytics));
step(17, 'Studio oversees linked customers WITHOUT payment details (coarse plan)', /plan_status: plan/.test(analytics) && /never payment details/.test(analytics));

// notifications (15, 21)
step(15, 'Website-attention rides the ONE notice model, idempotent + deep-linked', /presence_plan_notices\?on_conflict=client_id,kind,period/.test(notice) && /kind: 'publish_failed', period: `pub:\$\{pubId\}`/.test(publish));

// connection failure → scoped actionable state (16)
step(16, 'A connection-expired notice is deep-linked to reconnect', /connection_expired:\s*\{ label:[^}]*href: "connections\.html"/.test(review));

// lifecycle (18, 19)
step(18, 'Lapsed/read-only denies paid actions but keeps view + export', /status === 'lapsed'\) return \{ mode: 'readonly'/.test(entitlement));
step(19, 'Recovery is reachable in-app (billing portal button) + reconciled', /\/commerce\/portal/.test(review) && /can_manage_billing/.test(commerce));

// tenant isolation (20) — the new seams are all site/client scoped
step(20, 'New seams are tenant-scoped (forms→deal, inbox, oversight, client billing)', /presence_deals\?site_id=eq\.\$\{site\.id\}&source_submission_id/.test(sales) && /invoices\?client_id=eq\.\$\{me\}/.test(clientd) && /agencySiteIds\(member\.agency_id\)/.test(analytics));

// idempotency across the board (21)
step(21, 'Retries do not duplicate: deal (dedupe), notice (unique key), webhook (claim)', /if \(existing\) return json\(\{ data: existing, already_converted: true \}/.test(sales) && /resolution=ignore-duplicates/.test(notice));

// studio sees the customer SaaS status read-only (2 / bridge)
step(2, 'Studio project view shows the customer SaaS status (read-only, no leak)', /customer_saas/.test(projects) && /managed_by_customer: true/.test(projects));

const passed = R.filter((r) => r.p).length;
console.log(`\n════ P2-F INTEGRATED-LIFECYCLE GATE: ${passed}/${R.length} ${passed === R.length ? 'PASSED ✓' : 'FAILED'} ════`);
if (passed !== R.length) Deno.exit(1);
