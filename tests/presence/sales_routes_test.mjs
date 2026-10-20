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
// Post-refactor the account+provision failure paths consolidated into the shared
// provisionCustomerAccount helper (which does its OWN rollback); convert now has
// two post-claim failure returns — the helper-failure return and the stamp-failure
// return — and BOTH release the claim.
ok('concurrency: releases the claim (unclaim) on every failure path after claiming', (() => { const claimAt = sales.indexOf('const unclaim ='); const conv = sales.slice(claimAt, sales.indexOf('provisionCustomerAccount', claimAt) + 4000); return (conv.match(/await unclaim\(\)/g) || []).length >= 2 && /if \(!acct\.ok[\s\S]{0,80}await unclaim\(\)/.test(sales); })());
ok('safety: NEVER deletes a reused existing customer — both rollback DELETEs are guarded by createdClient', (() => { const dels = sales.match(/svc\(`clients\?id=eq\.\$\{clientId\}`, \{ method: 'DELETE' \}\)/g) || []; const guarded = sales.match(/if \(createdClient\) \{ await svc\(`clients\?id=eq\.\$\{clientId\}`/g) || []; return dels.length >= 2 && dels.length === guarded.length; })());
ok('safety: EVERY convert client-insert path is tracked for rollback (no orphan on failure)', (() => { const inserts = sales.match(/svc\('clients', \{ method: 'POST'/g) || []; const tracked = sales.match(/createdClient = true/g) || []; return inserts.length >= 2 && tracked.length >= inserts.length + 1; })()); // +1: the createContactAndClient chain path also sets it; every direct clients POST is followed by a createdClient=true

// ── cohesion seams + refinements (deep-sweep follow-ups) ──
{
  const inbox = read('inbox.html');   // the Enquiries page folded in here (Oct 2026 audit change 5)
  const pipe = read('pipeline.html');
  const sp = read('set-password.html');
  ok('Seam1: convert links an agency operator’s new customer into their portfolio', /resolveAgencyMember\(principal\.jwt\)/.test(sales) && /presence_agency_clients\?on_conflict=site_id/.test(sales));
  ok('Seam2: the invite lands in the client portal (?next=/client.html) + set-password honors it', /set-password\.html\?next=\/client\.html/.test(sales) && /params\.get\("next"\)/.test(sp));
  ok('Seam3: the Inbox enquiry pane promotes an inquiry into a deal (source_submission_id, no re-typing)', /function createDeal\(/.test(inbox) && /source_submission_id:id/.test(inbox) && /id="leadDeal"/.test(inbox));
  ok('refine: expected_close is date-validated (422, not a 502)', /DATE_RE\.test\(closeDate\)/.test(sales) && /DATE_RE = \//.test(sales));
  ok('refine: convert edition is selectable (whitelist, default presence)', /pickPlan\(cb\.plan\)/.test(sales) && /CONVERT_PLANS = new Set/.test(sales));
  ok('refine: pipeline shows ONLY valid next stages (bounded transitions mirror)', /const NEXT=\{lead:\['qualified','lost'\]/.test(pipe));
  // deep-audit refinements
  ok('R1: auto-advanced stages record a stage_change event (advanceStage, only when a row moved)', /async function advanceStage/.test(sales) && /if \(rows\(up\)\[0\]\) await dealEvent\(siteId, dealId, 'stage_change'/.test(sales) && (sales.match(/advanceStage\(/g) || []).length >= 4);
  ok('R3: contract signing evidence captures a hashed signer IP (ip_hash)', /ip_hash: await hmacHex\(secret, clientIp\(req\)\)/.test(sales));
  ok('R6: expected_value_cents is bounded (min 0, max 1_000_000_00) like line items', (sales.match(/Math\.min\(1_000_000_00, Math\.max\(0, Math\.trunc\(Number\(b\.expected_value_cents\)\)/g) || []).length >= 2);
}

// ── The deal's CONTACT is EDITABLE after creation ────────────────────────────
// A deal created with neither a name nor an email gets contact_id = null (both
// fields are optional on the create form) — and a null contact is exactly why
// emailSalesDoc returns false, so an agreement/proposal/invoice could never
// auto-send and convert-to-customer could never mint a portal login. Before this
// the deal PATCH had NO contact_id branch, so such a deal could never gain one.
{
  const dealFn = sales.indexOf('export async function handleSalesDeal');
  const patchAt = sales.indexOf("if (req.method === 'PATCH') {", dealFn);
  const delAt = sales.indexOf("if (req.method === 'DELETE') {", dealFn);
  const patchBlock = (dealFn > 0 && patchAt > 0 && delAt > patchAt) ? sales.slice(patchAt, delAt) : '';
  ok('contact-edit: the deal PATCH accepts contact_id', /b\.contact_id !== undefined/.test(patchBlock) && /patch\.contact_id/.test(patchBlock));
  ok('contact-edit: the contact is TENANT-GUARDED (site-scoped lookup, same as the POST)', /presence_contacts\?id=eq\.\$\{[^}]+\}&site_id=eq\.\$\{site\.id\}/.test(patchBlock));
  ok('contact-edit: a foreign / unknown contact is refused with a 422 (never silently attached)', /bad_contact[\s\S]{0,200}422/.test(patchBlock) && (patchBlock.match(/'bad_contact'/g) || []).length >= 2);
  ok('contact-edit: an explicit null (or blank) CLEARS the link', /patch\.contact_id = null/.test(patchBlock));
  ok('contact-edit: a malformed contact_id is a 422 — never a quiet clear', /UUID_RE\.test\(String\(raw\)\)[\s\S]{0,180}422/.test(patchBlock));
  // the drawer edits the contact in place (existing contact) or mints one and
  // links it (contactless deal) — the same two-step the create form already does.
  const pipe2 = read('pipeline.html');
  ok('contact-edit: the deal page has a Contact block (name / email / phone) in Details', /id="ed-cname"/.test(pipe2) && /id="ed-cemail"/.test(pipe2) && /id="ed-cphone"/.test(pipe2));
  ok('contact-edit: Save patches an existing contact, else creates one and links it to the deal', /api\('\/sales\/contacts\/'\+c\.id,'PATCH'/.test(pipe2) && /const link=\(cid\)=>api\('\/sales\/deals\/'\+id,'PATCH',\{contact_id:cid\}\)/.test(pipe2) && /api\('\/sales\/contacts','POST'[\s\S]{0,600}await link\(cid\)/.test(pipe2));
  // create-then-link is TWO calls: if the link fails, a plain retry used to mint a
  // SECOND contact (server dedupe keys on (site,email), so a name-only contact
  // duplicated every time). The row we created is remembered and reused —
  // but a DEDUPED row belongs to someone else and is never re-patched.
  ok('contact-edit: a failed link can’t duplicate the contact on retry', /let madeContactId=null/.test(pipe2) && /if\(madeContactId\)\{[\s\S]{0,220}await link\(madeContactId\)/.test(pipe2) && /if\(!nc\.deduped\)madeContactId=cid/.test(pipe2));
  // …and a dedupe that hands back somebody ELSE's contact is never covered by a
  // bare "Saved" — both create paths name whose contact got linked.
  ok('contact-edit: a deduped (someone else’s) contact is announced, not swapped in silently', /const dedupeNote=\(row,typedName,typedEmail\)=>/.test(pipe2) && /already belongs to \$\{who\|\|'another contact'\}/.test(pipe2) && /return nc\.deduped\?dedupeNote\(nc\.data,cn,ce\):null/.test(pipe2) && /if\(c&&c\.deduped\)cnote=dedupeNote\(c\.data,cname,email\)/.test(pipe2));
  ok('contact-edit: a no-email send says exactly WHY and points at the fix', /no client email on this deal, so nothing was sent[\s\S]{0,200}Add their email in Details/.test(pipe2));
}

// ── convert reuses the ONE provisioning path (no second provisioner) ──
ok('convert: reuses provisionForSignup (idempotent)', /provisionForSignup\(\{ clientId/.test(sales));
ok('convert: rolls back the client on provision failure', /clients\?id=eq\.\$\{clientId\}`, \{ method: 'DELETE' \}/.test(sales));
ok('convert: hands off to the EXISTING guided onboarding (get-started)', /get-started\.html/.test(sales));

// ── ADD A CUSTOMER (direct — no sales ceremony): shared provisioning, gated, idempotent ──
{
  // the SHARED provisioning internal exists and is the SINGLE provisioner —
  // provisionForSignup is only ever called from inside provisionCustomerAccount.
  ok('add-customer: a shared provisionCustomerAccount helper wraps the ONE provisioner', /async function provisionCustomerAccount\(/.test(sales) && (sales.match(/provisionForSignup\(\{ clientId/g) || []).length === 1);
  // BOTH the convert ceremony and the direct route reuse it — no duplicated body
  ok('add-customer: convert AND add-customer both call the shared helper (no 2nd provisioner)', (sales.match(/provisionCustomerAccount\(\{ email/g) || []).length >= 2);
  // the account-creation primitives live ONCE, inside the shared helper (not duplicated per route)
  ok('add-customer: account primitives (createAuthUser/createContactAndClient) appear once (shared)', (sales.match(/createAuthUser\(/g) || []).length === 1 && (sales.match(/createContactAndClient\(/g) || []).length === 1);
  // route + handler wired, POST only
  ok('add-customer: handler exported + dispatched at POST /sales/customers', /export async function handleSalesAddCustomer/.test(sales) && /route === '\/sales\/customers' && method === 'POST'/.test(idx));
  // studio-gated exactly like the rest of /sales/* (relationship feature) and
  // dispatched in the AUTHED block (after the entitlement + reviewer gate), never
  // as a pre-auth public route.
  ok('add-customer: gated to the relationship edition (same /sales gate)', /case 'sales':[\s\S]{0,80}return 'relationship'/.test(feat));
  ok('add-customer: dispatched in the authed block (after checkEntitlement gate)', idx.indexOf("route === '/sales/customers'") > idx.indexOf('checkEntitlement(principal'));
  // reuses the frozen bridge + one-primary-agency (ensureBridge), never a parallel
  // bridge — the bridge is now formed in the ONE shared bridgeCustomerToStudio helper.
  ok('add-customer: reuses ensureBridge via the shared bridgeCustomerToStudio (one primary agency)', /ensureBridge\(agencySiteId, project\.id, clientId/.test(sales) && /import \{ ensureProjectForDeal, ensureBridge, linksForCustomer[^}]*\} from '\.\.\/lib\/service_bridge\.ts'/.test(sales) && /export async function bridgeCustomerToStudio/.test(sales));
  // SERVICE customer: entitlement without a Stripe subscription (active access, no checkout)
  ok('add-customer: SERVICE billing boundary — provisions active access, no Stripe subscription created', !/createServicePaymentLink|createCheckout|stripe/i.test(sales.slice(sales.indexOf('handleSalesAddCustomer'))));
  // IDEMPOTENT existing-email: returns a friendly already_exists (with a link), never a duplicate
  ok('add-customer: existing email → friendly already_exists (no duplicate, no new invite)', /if \(acct\.alreadyExisted\)/.test(sales) && /already_exists: true/.test(sales) && /alreadyExisted = true/.test(sales));
  // the invite only fires for a genuinely new setup (after the already-exists early return)
  ok('add-customer: sends the sign-in invite only for a new setup', (() => { const h = sales.indexOf('handleSalesAddCustomer'); const already = sales.indexOf('if (acct.alreadyExisted)', h); const invite = sales.indexOf('sendCustomerInvite(site.id, email, acct.isNewLogin)', h); return already > 0 && invite > already; })());
  // reuses an existing bridge instead of minting a duplicate empty project on retry
  ok('add-customer: idempotent bridge — reuses an existing link (no duplicate project)', /linksForCustomer\(clientId\)/.test(sales) && /links\.find\(\(l\) => l\.agency_site_id === agencySiteId\)/.test(sales));
  // the shared bridge helper is the SINGLE non-deal bridge path (no parallel bridge):
  // ensureBridge + linksForCustomer + the project insert appear ONCE, inside it.
  ok('add-customer: bridgeCustomerToStudio is the one non-deal bridge path (ensureBridge called once, inside the helper)', (() => {
    // The deal handoff bridges via ensureProjectForDeal; the non-deal paths (add,
    // connect, signup-hook) bridge via bridgeCustomerToStudio. So a DIRECT ensureBridge
    // call appears exactly once in sales.ts — inside the shared helper — and never
    // inside handleSalesAddCustomer (which only CALLS the helper, twice).
    const ensureCalls = (sales.match(/ensureBridge\(/g) || []).length;
    const addBody = sales.slice(sales.indexOf('export async function handleSalesAddCustomer'));
    return ensureCalls === 1 && /export async function bridgeCustomerToStudio[\s\S]*?ensureBridge\(agencySiteId/.test(sales) && !/ensureBridge\(/.test(addBody) && (addBody.match(/bridgeCustomerToStudio\(\{ agencySiteId/g) || []).length >= 2;
  })());
}

// ── ADD A CUSTOMER · CONNECT-BY-EMAIL (mode='connect') — provisions NOTHING ────
// The owner's second option: "they'll sign up themselves — connect by email".
{
  const addAt = sales.indexOf('export async function handleSalesAddCustomer');
  const add = sales.slice(addAt);
  // mode is accepted, default 'provision' (today's behavior unchanged)
  ok('connect: handleSalesAddCustomer accepts mode (provision|connect, default provision)', /const mode = b\.mode === 'connect' \? 'connect' : 'provision'/.test(add));
  // CONNECT provisions NOTHING: no provisionCustomerAccount, no auth user, no invite,
  // inside the connect branch (which returns before the provision path).
  ok('connect: the connect branch provisions nothing (no provisionCustomerAccount / createAuthUser / sendCustomerInvite before its returns)', (() => {
    const start = add.indexOf("if (mode === 'connect')");
    const end = add.indexOf('// ── A) SET THEM UP NOW');
    const branch = add.slice(start, end);
    return start > 0 && end > start && !/provisionCustomerAccount\(/.test(branch) && !/createAuthUser\(/.test(branch) && !/sendCustomerInvite\(/.test(branch) && !/provisionForSignup\(/.test(branch);
  })());
  // EXISTING account → bridge NOW (reuse the shared helper) and report connected:true
  ok('connect: existing account → findClientByEmail then bridge now, connected:true', /if \(mode === 'connect'\)[\s\S]*?findClientByEmail\(email\)[\s\S]*?bridgeCustomerToStudio\(\{ agencySiteId: site\.id[\s\S]*?connected: true/.test(add));
  // NO account → record a CONTACT under this site (the pending record) + pending:true;
  // NEVER duplicates a table — reuses presence_contacts via ensureConnectContact.
  ok('connect: no account → records the pending contact (ensureConnectContact, tagged) + pending:true', /ensureConnectContact\(site\.id, email, name, true\)[\s\S]*?pending: true/.test(add) && /async function ensureConnectContact/.test(sales));
  // the pending record is a presence_contacts row (site-scoped = the studio), tagged
  // with the shared marker — NO new table.
  ok('connect: pending record reuses presence_contacts (site-scoped) + the shared CONNECT_INTENT_TAG (no new table)', /export const CONNECT_INTENT_TAG =/.test(sales) && /svc\('presence_contacts', \{ method: 'POST'/.test(sales) && /notes: mark \? CONNECT_INTENT_TAG/.test(sales));
  // connect self-guard: never bridge the studio to itself
  ok('connect: self-guard — does not bridge the studio to itself', /if \(clientId !== site\.client_id\)/.test(add));
}

// ── SIGNUP AUTO-CONNECT HOOK (commerce/handleSignup) ──────────────────────────
// When a pre-listed email self-serve signs up, they auto-connect to that studio —
// reusing the SAME bridge (bridgeCustomerToStudio → ensureBridge), best-effort.
{
  const commerce = read('supabase/functions/presence/routes/commerce.ts');
  ok('signup-hook: commerce imports the SHARED bridge + tag from sales (no parallel bridge)', /import \{ bridgeCustomerToStudio, CONNECT_INTENT_TAG \} from '\.\/sales\.ts'/.test(commerce));
  // finds the tagged pending contact by email, resolves its site_id (= the studio)
  ok('signup-hook: resolves the pre-listing studio via the tagged presence_contacts (site_id)', /presence_contacts\?email=eq\.\$\{encodeURIComponent\(email\)\}&notes=ilike\.\*\$\{needle\}\*/.test(commerce) && /CONNECT_INTENT_TAG\.replace\(/.test(commerce));
  // calls the shared bridge — never a second bridge implementation in commerce
  ok('signup-hook: bridges via the shared bridgeCustomerToStudio (single bridge path)', /bridgeCustomerToStudio\(\{ agencySiteId, clientId, customerSiteId/.test(commerce) && !/ensureBridge\(/.test(commerce) && !/presence_service_links/.test(commerce));
  // wired into handleSignup for BOTH the trial and the paid path, best-effort
  ok('signup-hook: called from handleSignup (trial + paid), best-effort (never blocks signup)', (commerce.match(/autoConnectPreListedStudio\(chain\.clientId/g) || []).length >= 2 && /async function autoConnectPreListedStudio[\s\S]*?try \{[\s\S]*?\} catch/.test(commerce));
  // masked logging (no raw email in logs)
  ok('signup-hook: logs are email-masked', /maskEmail\(email\)/.test(commerce));
}

// ── UI: contacts.html "Add a customer" (service language; success + already-exists states) ──
{
  const contacts = read('contacts.html');
  ok('ui: a prominent "+ Add a customer" action + dialog', /id="addCust"/.test(contacts) && /openAddCustomer/.test(contacts) && /id="custDlg"/.test(contacts));
  // `edition:cuPlan()` — the UI-only 'business_os_no_site' answer is mapped to
  // the real Business OS plan key before it reaches the wire (external_client_door_test).
  ok('ui: posts to /sales/customers with name/business_name/email/edition', /api\('\/sales\/customers','POST'/.test(contacts) && /business_name/.test(contacts) && /edition:cuPlan\(\)/.test(contacts));
  ok('ui: SERVICE language (never SaaS plan words) + "never pay for software"', /never pay for software/.test(contacts) && /What kind of work is this\?/.test(contacts) && !/subscription|SaaS|per month|\/mo/i.test(contacts.slice(contacts.indexOf('custDlg'), contacts.indexOf('custDlg') + 1400)));
  ok('ui: success state shows "Invitation sent to {email}" + the already-exists case', /Invitation sent to/.test(contacts) && /already_exists/.test(contacts) && /already have a workspace/.test(contacts));
  ok('ui: labels wired to inputs (for/id) + focus managed', /for="cu-email"/.test(contacts) && /id="cu-email"/.test(contacts) && /\$\('cu-name'\)\.focus\(\)/.test(contacts));
  // TWO-OPTION chooser (owner's words): "set them up now" vs "connect by email".
  ok('ui: a two-option chooser (radiogroup) precedes the work-type field', /role="radiogroup"/.test(contacts) && /name="cumode" value="provision"/.test(contacts) && /name="cumode" value="connect"/.test(contacts) && contacts.indexOf('name="cumode"') < contacts.indexOf('id="cu-edition"'));
  ok('ui: option copy — set-up-now (default) + sign-up-themselves', /I’ll set them up now/.test(contacts) && /They’ll sign up themselves — connect by email/.test(contacts) && /value="provision" checked/.test(contacts));
  ok('ui: connect copy explains existing-vs-later auto-connect', /If they already have an account, they connect to you now\. If not, they’ll connect automatically the moment they sign up/.test(contacts));
  ok('ui: mode drives the POST body (provision vs connect) to /sales/customers', /mode:'connect',name:name\|\|undefined,email/.test(contacts) && /mode:'provision'/.test(contacts) && /const mode=cuMode\(\)/.test(contacts));
  ok('ui: distinct success states — connected / saved-for-later / invitation-sent', /When '\+esc\(email\)\+' signs up, they’ll connect to you automatically/.test(contacts) && /Connected to their workspace/.test(contacts));
  ok('ui: connect mode hides provision-only fields (no workspace set-up)', /id="cu-provision-only"/.test(contacts) && /po\.style\.display=connect\?'none':''/.test(contacts));
}

// ── Oct 2026 studio audit, change 4 — the dialog is honest and needs no password,
//    on all THREE hand-synced copies (agency.html is the home; the rosters keep theirs)
for (const p of ['agency.html', 'customers.html', 'contacts.html']) {
  const h = read(p);
  const di = h.indexOf('<dialog id="custDlg"'), dlg = h.slice(di, h.indexOf('</dialog>', di) + 9);
  const prov = dlg.slice(dlg.indexOf('id="cu-provision-only"'), dlg.indexOf('id="cu-connect-only"'));
  const conn = dlg.slice(dlg.indexOf('id="cu-connect-only"'));
  ok(`${p}: no "set their password" anywhere in the dialog or its done screen`, !/set their password/.test(h) && /Create their workspace and email them a sign-in link\./.test(dlg) && /They’ll sign in from the email and land in their client portal\./.test(h));
  ok(`${p}: provision mode says what provisioning does (workspace + site + sign-in link, never pay for software)`, /Adding them creates their client workspace and their site, and emails them a sign-in link\. You bill them for your work the usual way — they never pay for software here\./.test(prov));
  ok(`${p}: the pricing box lives in CONNECT mode only (nothing is bought when the studio provisions)`, !/id="cu-signup"/.test(prov) && /id="cu-signup"/.test(conn) && /send them this to sign up/.test(conn));
  ok(`${p}: "Start from" kit select in provision mode (default "No kit — start empty")`, /id="cu-kit-wrap"/.test(prov) && /<select id="cu-kit"><option value="">No kit — start empty<\/option><\/select>/.test(prov));
  ok(`${p}: kits come from GET /agency/kits and apply to the NEW site via POST /agency/kits/:id/apply {site_id}`, /api\('\/agency\/kits'\)/.test(h) && /'\/agency\/kits\/'\+encodeURIComponent\(kitId\)\+'\/apply'/.test(h) && /\{site_id:d\.site_id\}/.test(h));
  ok(`${p}: the done screen names the applied kit, and a kit never repaints the set-up as a failure`, /kitLine=k\.ok\?esc\(kitName\)\+' applied\.'/.test(h) && /id="cu-kit-line"/.test(h) && /if\(d\.already_exists\)kitLine=/.test(h));
  ok(`${p}: ${p === 'agency.html' ? 'the home always offers kits' : 'the kit field shows only for an agency (ddsContext.is_agency)'}`, p === 'agency.html' ? /async function cuIsAgency\(\)\{return true;\}/.test(h) : /return !!\(c&&c\.is_agency\)/.test(h));
}
{
  const ag = read('agency.html');
  ok('agency.html: ⌘K lands on #add → the dialog opens and the hash is cleared (boot + hashchange)', /function openFromHash\(\)\{\s*if\(location\.hash!=='#add'\)return;/.test(ag) && /history\.replaceState\(null,'',location\.pathname\+location\.search\)/.test(ag) && /window\.addEventListener\('hashchange',openFromHash\)/.test(ag) && /renderTop\(\);\s*openFromHash\(\);/.test(ag));
  ok('add-customer: the response carries the new site id the dialog applies the kit to', /return json\(\{ data: \{ created: true, client_id: clientId, site_id: acct\.siteId/.test(sales));
}

// ── STUDIO SERVICES CATALOG (/sales/services) — manageable catalog + proposal dropdown ──
{
  const pipe = read('pipeline.html');
  // route exists (GET+PUT), exported + dispatched
  ok('services: handleSalesServices exported + dispatched at GET/PUT /sales/services', /export async function handleSalesServices/.test(sales) && /route === '\/sales\/services' && \(method === 'GET' \|\| method === 'PUT'\)/.test(idx));
  // studio-gated exactly like the rest of /sales/* (relationship feature) + dispatched
  // in the AUTHED block after the entitlement gate (never a pre-auth public route).
  ok('services: gated to the relationship edition (same /sales gate)', /case 'sales':[\s\S]{0,80}return 'relationship'/.test(feat));
  ok('services: dispatched in the authed block (after checkEntitlement gate)', idx.indexOf("route === '/sales/services'") > idx.indexOf('checkEntitlement(principal'));
  // NO new migration: catalog stored in the EXISTING sales-templates store via a reserved sentinel row
  ok('services: stored in the existing sales-templates store via a reserved sentinel (no new migration)', /SERVICES_CATALOG_NAME = '__services_catalog__'/.test(sales) && /kind=eq\.proposal&name=eq\.\$\{encodeURIComponent\(SERVICES_CATALOG_NAME\)\}/.test(sales));
  // site-scoped read + write (tenant isolation)
  ok('services: catalog read/write is site_id-scoped', /presence_sales_templates\?site_id=eq\.\$\{siteId\}&kind=eq\.proposal&name=eq\.\$\{encodeURIComponent\(SERVICES_CATALOG_NAME\)\}/.test(sales) && /presence_sales_templates\?site_id=eq\.\$\{site\.id\}&kind=eq\.proposal&name=eq\.\$\{encodeURIComponent\(SERVICES_CATALOG_NAME\)\}/.test(sales));
  // the sentinel row is hidden from the reusable-templates list
  ok('services: the sentinel row is excluded from the templates list', /name=neq\.\$\{encodeURIComponent\(SERVICES_CATALOG_NAME\)\}/.test(sales));
  // PUT validates: name ≤120 (clean), price bounded 0–$1,000,000, catalog capped ~40
  ok('services: PUT validates name (≤120) + bounds price + caps the catalog (40)', /b\.services\.length > 40/.test(sales) && /clean\(s\?\.name, 120\)/.test(sales) && /Math\.min\(1_000_000_00, Math\.max\(0, Math\.trunc\(Number\(\(s as any\)\?\.price_cents\)\)/.test(sales));
  // ── pipeline.html UI: dropdown + Custom + empty-catalog fallback + manage editor ──
  ok('ui: proposal line item is a <select> of services with a Custom… option', /class="pl-pick"/.test(pipe) && /Pick a service…<\/option>/.test(pipe) && /__custom__">Custom…<\/option>/.test(pipe));
  ok('ui: picking a service auto-fills the line name + price (still editable)', /const s=SERVICES\[\+v\]; if\(s\)\{ lab\.value=s\.name; pr\.value=\(s\.price_cents\/100\)/.test(pipe));
  ok('ui: empty catalog falls back to free-text with a manage hint/link', /const hasCat=SERVICES\.length>0/.test(pipe) && /id="plManageHint"/.test(pipe) && /Add your services/.test(pipe));
  ok('ui: a Manage services editor (name+price rows, add/remove) saves via PUT /sales/services', /id="svcDlg"/.test(pipe) && /openManageServices/.test(pipe) && /api\('\/sales\/services','PUT',\{services\}\)/.test(pipe));
}

// ── document links open through the site-origin viewer (hotfix: *.supabase.co
//    rewrites GET text/html to text/plain, so a direct function URL shows raw
//    HTML source; every MINTED link must point at doc.html on OUR origin) ──
{
  const doc = read('doc.html');
  ok('doc-viewer: docViewerUrl mints <SITE_URL>/doc.html?t=<token> (site origin, not the function domain)', /export function docViewerUrl\(token: string\)/.test(sales) && /siteUrl\(\)\}\/doc\.html\?t=\$\{encodeURIComponent\(token\)\}/.test(sales));
  ok('doc-viewer: NO minted link points at the raw function /sales/doc URL anymore', !/functions\/v1\/presence\/sales\/doc\/\$\{/.test(sales));
  ok('doc-viewer: emailed docLink and the CRM document-link route both mint via docViewerUrl', (sales.match(/docViewerUrl\(token\)/g) || []).length >= 2);
  ok('doc-viewer: the raw GET /sales/doc render route STAYS (the viewer fetches it)', /handleSalesDocument\(req, m\[1\], cors\)/.test(idx));
  ok('doc-viewer: doc.html fetches /sales/doc/<token> bare (public token-gated GET) and document.writes the render', /\/sales\/doc\/'\+encodeURIComponent\(t\)/.test(doc) && /document\.open\(\);document\.write\(html\);document\.close\(\)/.test(doc));
  ok('doc-viewer: doc.html is unindexable and shows a friendly expiry message on failure', /noindex,nofollow/.test(doc) && /ask your studio for a fresh copy/.test(doc));
}

// ── ONE LINK (benchmark 2026-10, item 5): the deal-bound `flow` token ──
{
  ok('flow: the token kind set is proposal | contract | flow, and verify still fails closed on anything else', /p\.t !== 'proposal' && p\.t !== 'contract' && p\.t !== 'flow'/.test(sales) && /export type SalesTokenKind = 'proposal' \| 'contract' \| 'flow'/.test(sales));
  ok('flow: flowLink mints sign.html?t=<flow token> bound to the DEAL id, 30 days, null without a secret', /async function flowLink\(siteId: string, dealId: string\)/.test(sales) && /signSalesToken\(\{ t: 'flow', id: dealId, site_id: siteId, exp: Math\.floor\(Date\.now\(\) \/ 1000\) \+ FLOW_TTL_SEC \}/.test(sales) && /const FLOW_TTL_SEC = 30 \* 86400/.test(sales) && /if \(!secret \|\| !UUID_RE\.test\(dealId \|\| ''\)\) return null/.test(sales));
  ok('flow: every send mints the ONE link (proposal send, contract send, the combined deal send)', (sales.match(/flowLink\(site\.id, (?:p|c)\.deal_id\)/g) || []).length >= 3 && /const url = await flowLink\(site\.id, dealId\)/.test(sales) && !/signSalesToken\(\{ t: 'proposal'/.test(sales) && !/signSalesToken\(\{ t: 'contract'/.test(sales));
  ok('flow: the reminder sweep mints the same deal link (no second page for the client)', /signSalesToken\(\{ t: 'flow', id: doc\.deal_id, site_id: doc\.site_id/.test(read('supabase/functions/presence/commerce/lifecycle.ts')));
  // the public actions accept a flow token ONLY for a document on that deal
  ok('flow: decide accepts a proposal token naming the proposal OR a flow token — then checks the deal (tokenCovers)', /if \(!tok \|\| !\(tok\.t === 'proposal' \? tok\.id === id : tok\.t === 'flow'\)\)/.test(sales) && /if \(!tokenCovers\(tok, 'proposal', id, p\.deal_id\)\) return json\(\{ error: 'invalid_link'/.test(sales));
  ok('flow: sign accepts a contract token naming the agreement OR a flow token — then checks the deal (tokenCovers)', /if \(!tok \|\| !\(tok\.t === 'contract' \? tok\.id === id : tok\.t === 'flow'\)\)/.test(sales) && /if \(!tokenCovers\(tok, 'contract', id, c\.deal_id\)\) return json\(\{ error: 'invalid_link'/.test(sales));
  ok('flow: tokenCovers — a document token must name the document, a flow token must name its deal, anything else is no', /if \(tok\.t === kind\) return tok\.id === docId;\s*\n\s*if \(tok\.t === 'flow'\) return typeof dealId === 'string' && tok\.id === dealId;\s*\n\s*return false;/.test(sales));
  ok('flow: FORCED ORDER server-side — a flow-token sign goes through the pure flowSignGate (409 while unaccepted, declined, or between versions)', /if \(tok\.t === 'flow'\) \{\s*\n\s*const \{ proposal, proposal_pending \} = await flowDocuments\(tok\.site_id, tok\.id\);\s*\n\s*const gate = flowSignGate\(\{ proposal, pending: proposal_pending \}\);[^\n]*\n\s*if \(gate\) return json\(gate, 409, cors\);/.test(sales));
  ok('flow: the public view resolves a flow token to the deal, scoped by tok.site_id, 404 when the deal is gone', /presence_deals\?id=eq\.\$\{tok\.id\}&site_id=eq\.\$\{tok\.site_id\}&deleted_at=is\.null&select=id,title&limit=1/.test(sales));
  ok('flow: the client never sees a draft — currentProposal() picks only sent/accepted/declined, non-superseded rows; agreements sent/signed only', /const sentOnce = live\.filter\(\(r\) => !superseded\(r\) && \(r\.status === 'sent' \|\| r\.status === 'accepted' \|\| r\.status === 'declined'\)\)/.test(read('supabase/functions/presence/lib/sales_lifecycle.ts')) && /cons\.find\(\(c\) => c\.status === 'signed'\) \|\| cons\.find\(\(c\) => c\.status === 'sent'\) \|\| null/.test(sales));
  ok('flow: between versions (Revise → v1 superseded, v2 draft) the deal reads as proposal_pending, never as "no proposal"', /pending: !proposal && live\.some\(superseded\)/.test(read('supabase/functions/presence/lib/sales_lifecycle.ts')) && /proposal_pending: pending/.test(sales));
  ok('wiring: POST /sales/deals/:id/send is an AUTHED route (after site resolution), not a public one', /\\\/sales\\\/deals\\\/\(\[0-9a-f-\]\{36\}\)\\\/send\$/.test(idx) && idx.indexOf('handleSalesDealSend(req, site, principal') > idx.indexOf('handleSalesProposalSend(req, site, principal'));
}

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
