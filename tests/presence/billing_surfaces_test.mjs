// ── P2-E W11: Studio + Client billing surfaces (structural) ──────────────────
//   deno run --allow-read tests/presence/billing_surfaces_test.mjs
// Both surfaces must reflect AUTHORITATIVE entitlement/usage/lifecycle state,
// and SaaS (software subscription) must be explicitly distinguishable from
// SERVICE (agency project invoices).
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const commerce = read('supabase/functions/presence/routes/commerce.ts');
const client = read('supabase/functions/presence/routes/client_delivery.ts');
const projects = read('supabase/functions/presence/routes/projects.ts');
const index = read('supabase/functions/presence/index.ts');
const clientHtml = read('client.html');

// ── Client SaaS surface: authoritative + labeled + calm usage (no numbers) ──
ok('saas: subscription surface reads authoritative lifecycle (status/grace/period)', /select=plan,status,term,founder,trial_ends_at,current_period_end,cancel_at_period_end,grace_until/.test(commerce));
ok('saas: labeled billing_type "saas" (distinct from service)', /billing_type: 'saas'/.test(commerce));
ok('saas: AI usage is a calm boolean position, NOT a number (Law 13)', /const ceiling = await checkAiCeiling\(site\.client_id\)/.test(commerce) && /ai_pooled: aiPooled, ai_at_limit: aiAtLimit/.test(commerce) && !/spent_usd:/.test(commerce.split('handleSubscription')[1].split('handlePortal')[0]));
ok('saas: points to service billing when the customer has invoices', /has_service_billing: Array\.isArray\(invCount\)/.test(commerce));

// ── Client SERVICE surface: separate, scoped, amounts shown, pay link ──
ok('service: /client/billing handler exists + is routed', /export async function handleClientBilling/.test(client) && /route === '\/client\/billing' && method === 'GET'/.test(index));
ok('service: labeled billing_type "service" + explicitly separate from SaaS', /billing_type: 'service'/.test(client) && /billed separately/i.test(client));
ok('service: scoped to the caller\'s own customer (tenant-safe, multi-tenant presence_invoices)', /presence_invoices\?customer_client_id=eq\.\$\{me\}&deleted_at=is\.null/.test(client));
// Allow-list, not a not-paid test: `status !== 'paid'` was harmless only while
// 'void' was unreachable. POST /sales/invoices/:id/void now makes it reachable,
// and a WITHDRAWN invoice must never come with a live pay button.
// Oct 2026 (item 2): the allow-list is now the two states that still WAIT on
// the client — upcoming + overdue — so a PROCESSING (settling ACH) payment
// never gets a second Pay button either.
ok('service: exposes a pay link ONLY for an invoice still waiting on the client (never paid, voided or processing)', /\(state === 'upcoming' \|\| state === 'overdue'\) && i\.stripe_url\) \? i\.stripe_url : null/.test(client));

// ── Studio surface: sees the customer's SaaS status, read-only, distinguished ──
ok('studio: project view surfaces the customer SaaS status (read-only)', /customer_saas/.test(projects) && /managed_by_customer: true/.test(projects));
ok('studio: only on the studio side, resolved via the service link', /if \(studio\) \{[\s\S]*?presence_service_links\?project_id=eq\.\$\{id\}&select=customer_client_id/.test(projects));
ok('studio: labels it billing_type saas (the customer software subscription, not agency billing)', /customer_saas = \{[\s\S]*?billing_type: 'saas'/.test(projects));

// ── Client App renders the service-billing section, labeled distinct from SaaS ──
// Item 179 part four folded the Invoices tab into the Documents shelf: the pins
// follow the shelf but stay non-vacuous — rerouting it off /client/billing (via
// ensureBilling), dropping the row builder, or unwiring the invoice rows from the
// shelf's paint must each redden here.
ok('client app: fetches /client/billing (ensureBilling) and renders it through the shelf’s rows',
  /api\('\/client\/billing'\)/.test(clientHtml) && /function shelfRows\(invoices,docs,snaps,todayYmd,pending,now\)/.test(clientHtml)
  && /const \[snaps,docsRes,b\]=await Promise\.all\(\[ensureSnaps\(\),api\('\/client\/documents'\)\.catch\(\(\)=>null\),ensureBilling\(\)\]\);/.test(clientHtml)
  && /const rows=shelfRows\(\(d\.b&&d\.b\.invoices\)\|\|\[\],docs,d\.snaps,today,PAID_PENDING,now\);/.test(clientHtml));
ok('client app: states the software subscription is billed separately', /billed separately/i.test(clientHtml));
// the Pay action exists ONLY past the paid, processing and void/canceled guards,
// opens the server's pay_url in THIS tab (Nov 10 review, G9: a new tab left the
// first one still saying Pay after Stripe returned to a second copy), and is
// named per invoice
ok('client app: shows a safe pay link for unpaid invoices only (paid/processing/dead guards first, https-only, same tab)',
  // the one money formula's state decides: paid, then PROCESSING (the client
  // already paid), then void/canceled (dead), and only then the pay link
  /const act=st==='paid'\?\(view\?\{verb:'Receipt',href:view\}:null\):st==='processing'\?\{note:'processing',inv:i\}:!st\?null:pay\?\{verb:'Pay',href:pay,pay:true\}/.test(clientHtml)
  // the link renders ONLY through the https-allowlisted `pay` value, and only
  // while the invoice waits on payment (the scheme gate is the review's
  // defense-in-depth on the money surface)
  && /const pay=\(st==='upcoming'\|\|st==='overdue'\)&&\/\^https:\\\/\\\/\/\.test\(String\(i\.pay_url\|\|''\)\)\?i\.pay_url:'';/.test(clientHtml)
  && /act=`<a class="fbtn" href="\$\{esc\(a\.href\)\}"\$\{a\.pay\?'':' target="_blank" rel="noopener"'\} aria-label="\$\{esc\(a\.verb\)\} — /.test(clientHtml)
  && !/data-pay href="[^"]*" target="_blank"/.test(clientHtml));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ P2-E W11 BILLING SURFACES (structural): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
