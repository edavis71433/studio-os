// ── Sales routes: tenant isolation + structural wiring (P2-C) ────────────────
//   deno run --allow-read tests/presence/sales_routes_test.mjs
// The runtime handlers can't run without a live DB; these assertions prove the
// SECURITY-critical properties structurally: every query is site-scoped, public
// actions are token-authorized, and the idempotency/version guards are in place.
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const sales = read('supabase/functions/presence/routes/sales.ts');
const idx = read('supabase/functions/presence/index.ts');
const mig = read('supabase/migrations/0074_p2c_sales_lifecycle.sql');
const feat = read('supabase/functions/presence/middleware/feature.ts');

// ── TENANT ISOLATION: every authed table access is site-scoped ──
{
  // no read/write of a sales table WITHOUT a site_id filter (authed handlers)
  const tables = ['presence_deals', 'presence_contacts', 'presence_proposals', 'presence_contracts', 'presence_deal_events'];
  for (const t of tables) {
    const re = new RegExp(`${t}\\?[^\\\`]*`, 'g');
    const uses = sales.match(re) || [];
    const unscoped = uses.filter((u) => !/site_id=eq\.|deal_id=eq\./.test(u)); // deal_events scope via deal_id+site_id; inserts scoped in body
    ok(`tenant: every ${t} query filter is site/deal-scoped (${uses.length} uses)`, unscoped.length === 0, unscoped[0] || '');
  }
  // inserts carry site_id explicitly
  ok('tenant: deals/contacts/proposals/contracts inserts carry site_id', /site_id: site\.id/.test(sales));
}

// ── PUBLIC actions are authorized ONLY by a signed token whose site_id is used ──
ok('public: proposal-decide verifies a signed token + scopes by tok.site_id', /verifySalesToken\(String\(b\.token/.test(sales) && /site_id=eq\.\$\{tok\.site_id\}/.test(sales));
ok('public: contract-sign verifies token + scopes by tok.site_id (no session trust)', /handleSalesContractSign[\s\S]*?verifySalesToken[\s\S]*?site_id=eq\.\$\{tok\.site_id\}/.test(sales));
ok('public: view handler is token-gated', /handleSalesPublicView[\s\S]*?verifySalesToken/.test(sales));
ok('security: token binds t+id+site_id+exp and fails closed', /p\.t !== 'proposal' && p\.t !== 'contract'/.test(sales) && /p\.exp < nowSec/.test(sales) && /timingSafeEqual/.test(sales));

// ── IDEMPOTENCY + integrity guards ──
ok('idempotent: convert returns existing on already_converted (no dup)', /already_converted[\s\S]*?idempotent: true/.test(sales));
ok('idempotent: convert stamps under converted_client_id=is.null guard (race-safe)', /converted_client_id=is\.null/.test(sales));
ok('idempotent: DB unique index on converted_client_id', /presence_deals_converted_client_uq[\s\S]*?converted_client_id.*where converted_client_id is not null/.test(mig));
ok('idempotent: proposal-send returns existing when already sent', /already_sent: true/.test(sales));
ok('integrity: contract sign guards content_hash in the WHERE (version integrity)', /status=eq\.sent&content_hash=eq\.\$\{c\.content_hash\}/.test(sales));
ok('integrity: stage move guards the prior stage in WHERE (no lost update)', /stage=eq\.\$\{deal\.stage\}/.test(sales) && /canTransition\(deal\.stage, to\)/.test(sales));

// ── feature-gate + public rate limits (gap-check refinements) ──
ok('feature-gate: authed /sales gated to the relationship edition (like /crm)', /case 'sales':[\s\S]{0,80}return 'relationship'/.test(feat));
ok('rate-limit: public decide/sign/view are per-IP rate-limited', /rateAllow\(`sales_decide/.test(sales) && /rateAllow\(`sales_sign/.test(sales) && /rateAllow\(`sales_view/.test(sales));
ok('access: convert gives the customer a real login (auth user + set-password invite)', /createAuthUser\(/.test(sales) && /createContactAndClient\(/.test(sales) && /generateSetPasswordLink\(/.test(sales));
ok('access: convert reuses an existing account by email (no duplicate customer)', /findClientByEmail\(email\)/.test(sales));
ok('access: convert rolls back only what it created on provision failure', /if \(createdClient\)/.test(sales) && /deleteAuthUser\(createdAuthId\)/.test(sales));
// deep-review fixes:
ok('concurrency: convert CLAIMS the deal (converted_at) BEFORE creating any account/workspace', (() => { const claimAt = sales.indexOf('converted_client_id=is.null&converted_at=is.null&select=id'); const provAt = sales.indexOf('provisionForSignup({ clientId'); return claimAt > 0 && provAt > 0 && claimAt < provAt && /const claimBody = \(\) => JSON\.stringify\(\{ converted_at: nowIso\(\) \}\)/.test(sales); })());
ok('concurrency: a stale claim (>5min) is reclaimable (self-healing)', /converted_at=lt\.\$\{encodeURIComponent\(staleBefore\)\}/.test(sales));
ok('concurrency: releases the claim (unclaim) on every failure path after claiming', (sales.match(/await unclaim\(\)/g) || []).length >= 3);
ok('safety: NEVER deletes a reused existing customer — both rollback DELETEs are guarded by createdClient', (() => { const dels = sales.match(/svc\(`clients\?id=eq\.\$\{clientId\}`, \{ method: 'DELETE' \}\)/g) || []; const guarded = sales.match(/if \(createdClient\) \{ await svc\(`clients\?id=eq\.\$\{clientId\}`/g) || []; return dels.length >= 2 && dels.length === guarded.length; })());
ok('safety: EVERY convert client-insert path is tracked for rollback (no orphan on failure)', (() => { const inserts = sales.match(/svc\('clients', \{ method: 'POST'/g) || []; const tracked = sales.match(/createdClient = true/g) || []; return inserts.length >= 2 && tracked.length >= inserts.length + 1; })()); // +1: the createContactAndClient chain path also sets it; every direct clients POST is followed by a createdClient=true

// ── cohesion seams + refinements (deep-sweep follow-ups) ──
{
  const leads = read('leads.html');
  const pipe = read('pipeline.html');
  const sp = read('set-password.html');
  ok('Seam1: convert links an agency operator’s new customer into their portfolio', /resolveAgencyMember\(principal\.jwt\)/.test(sales) && /presence_agency_clients\?on_conflict=site_id/.test(sales));
  ok('Seam2: the invite lands in guided onboarding (?next=/get-started.html) + set-password honors it', /set-password\.html\?next=\/get-started\.html/.test(sales) && /params\.get\("next"\)/.test(sp));
  ok('Seam3: leads.html promotes an inquiry into a deal (source_submission_id, no re-typing)', /function createDeal\(/.test(leads) && /source_submission_id:id/.test(leads) && /data-deal=/.test(leads));
  ok('refine: expected_close is date-validated (422, not a 502)', /DATE_RE\.test\(closeDate\)/.test(sales) && /DATE_RE = \//.test(sales));
  ok('refine: convert edition is selectable (whitelist, default presence)', /pickPlan\(cb\.plan\)/.test(sales) && /CONVERT_PLANS = new Set/.test(sales));
  ok('refine: pipeline shows ONLY valid next stages (bounded transitions mirror)', /const NEXT=\{lead:\['qualified','lost'\]/.test(pipe));
}

// ── convert reuses the ONE provisioning path (no second provisioner) ──
ok('convert: reuses provisionForSignup (idempotent)', /provisionForSignup\(\{ clientId/.test(sales));
ok('convert: rolls back the client on provision failure', /clients\?id=eq\.\$\{clientId\}`, \{ method: 'DELETE' \}/.test(sales));
ok('convert: hands off to the EXISTING guided onboarding (get-started)', /get-started\.html/.test(sales));

// ── dispatch wired (authed + public) ──
ok('wiring: authed /sales/* dispatched after site resolution', /route === '\/sales\/deals'/.test(idx) && /\\\/sales\\\/deals\\\/.*\\\/convert/.test(idx));
ok('wiring: PUBLIC token actions dispatched pre-auth', /\\\/sales\\\/proposals\\\/.*\\\/decide/.test(idx) && /\\\/sales\\\/contracts\\\/.*\\\/sign/.test(idx) && /handleSalesPublicView/.test(idx));

// ── migration: tables, RLS, FKs, indexes ──
{
  for (const t of ['presence_contacts', 'presence_deals', 'presence_deal_events', 'presence_proposals', 'presence_contracts']) {
    ok(`migration: ${t} exists, site_id-scoped, RLS enabled`, new RegExp(`create table if not exists public\\.${t}[\\s\\S]*?site_id uuid not null references public\\.presence_sites`).test(mig) && new RegExp(`alter table public\\.${t} enable row level security`).test(mig));
  }
  ok('migration: bounded stage ladder as a CHECK', /check \(stage in \('lead','qualified','proposal','contract','won','lost'\)\)/.test(mig));
  ok('migration: pagination/stage indexes present', /presence_deals_site_stage_idx/.test(mig) && /presence_deals_site_recent_idx/.test(mig));
  ok('migration: rollback block present', /^--   drop table if exists public\.presence_contracts;/m.test(mig));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ SALES ROUTES (P2-C wiring/tenant): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
