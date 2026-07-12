// ── Account deletion executor + lifecycle: structural (P2-E W2) ──────────────
//   deno run --allow-read tests/presence/deletion_routes_test.mjs
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const del = read('supabase/functions/presence/commerce/deletion.ts');
const commerce = read('supabase/functions/presence/routes/commerce.ts');
const system = read('supabase/functions/presence/routes/system.ts');
const admin = read('supabase/functions/presence/routes/admin.ts');
const stripe = read('supabase/functions/presence/commerce/stripe.ts');
const mig = read('supabase/migrations/0082_account_deletion.sql');

// executor completes the lifecycle (not just a write-only request)
ok('executor: exists + wired into the cron (task=deletion + default cycle)', /export async function runDeletionSweep/.test(del) && /task === 'deletion'.*runDeletionSweep/.test(system) && /const deletion = await step\('deletion', \(\) => runDeletionSweep\(25\)\)/.test(system));
ok('executor: atomic claim (pending → executing, guarded) so two ticks can’t double-run', /status=eq\.pending&select=id`, \{ method: 'PATCH'[\s\S]*?status: 'executing'/.test(del));
ok('executor: revokes access (entitlement status → deleted)', /product=eq\.presence[\s\S]*?status: 'deleted'/.test(del));
ok('executor: cancels Stripe billing (keeps customer + invoices)', /cancelSubscription\(ent\.stripe_subscription_id\)/.test(del) && /export async function cancelSubscription/.test(stripe));
ok('executor: takes the hosted site down + soft-deletes the workspace (staged, recoverable)', /deleteSite\(s\.netlify_site_id\)/.test(del) && /status: 'deleting'/.test(del));
ok('executor: anonymizes customer PII', /name: 'Deleted account', email: `deleted-\$\{clientId\}@deleted\.invalid`/.test(del));
// The TWO allowed DELETEs: the GoTrue admin auth-user delete (privacy requires
// the LOGIN to actually die) and the push-subscription purge (device tokens
// carrying email/endpoint/UA — not business records). No OTHER table row is
// ever hard-deleted (financial evidence retained).
ok('executor: RETAINS financial evidence (only auth-user + push-subscription DELETEs; no other table)', (del.match(/method: 'DELETE'/g) || []).length === 2 && /auth\/v1\/admin\/users\/\$\{u\.id\}`, \{ method: 'DELETE'/.test(del) && /presence_push_subscriptions\?email=eq\.\$\{enc\(em\)\}`, \{ method: 'DELETE'/.test(del) && /status: 'deleted'/.test(del) && /status: 'deleting'/.test(del));
ok('executor: a failed run is retryable (status back to pending + error recorded)', /status: 'pending', error: res\.error/.test(del));
ok('executor: cross-tenant safe (every op scoped to the row’s client_id)', (del.match(/client_id=eq\.\$\{enc\(clientId\)\}/g) || []).length >= 3);

// request + cancel lifecycle
ok('request: idempotent — one OPEN deletion per client', /status=in\.\(pending,executing\)&select=id[\s\S]*?if \(open\) return/.test(del));
ok('request: cooling-off is configurable (ACCOUNT_DELETION_DAYS, default 30)', /ACCOUNT_DELETION_DAYS/.test(del) && /: 30/.test(del));
ok('cancel: a pending deletion can be canceled during the window', /export async function cancelDeletion[\s\S]*?status=eq\.pending&select=id[\s\S]*?status: 'canceled'/.test(del));

// wiring: routes + admin visibility
ok('wiring: delete-request uses requestDeletion; delete-cancel route exists', /requestDeletion\(site\.client_id, site\.id, 'customer'\)/.test(commerce) && /route === '\/commerce\/delete-cancel'/.test(commerce) && /cancelDeletion\(site\.client_id\)/.test(commerce));
ok('operator: /admin/deletions shows pending/executing/failed/completed', /route === '\/admin\/deletions'/.test(admin) && /presence_account_deletions\?select=/.test(admin));

// migration
ok('migration: presence_account_deletions with a single OPEN per client + due index', /create table if not exists public\.presence_account_deletions/.test(mig) && /presence_account_deletions_open_uq[\s\S]*?where status in \('pending','executing'\)/.test(mig) && /presence_account_deletions_due_idx/.test(mig));
ok('migration: entitlement status widened with a terminal deleted state', /add constraint presence_entitlements_status_check check \(status in \('active','paused','lapsed','deleted'\)\)/.test(mig));
ok('migration: rollback present', /drop table if exists public\.presence_account_deletions;/.test(mig));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ ACCOUNT DELETION (P2-E W2 structural): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
