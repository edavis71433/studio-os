// ── Deposits & service invoices (structural) ─────────────────────────────────
//   deno run --allow-read tests/presence/deposits_test.mjs
// An accepted proposal (or an explicit amount) → a payable Stripe link, on the ONE
// Stripe authority, marked paid by the webhook. Service billing, separate from SaaS.
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };

const mig = read('supabase/migrations/0086_presence_invoices.sql');
const sales = read('supabase/functions/presence/routes/sales.ts');
const stripe = read('supabase/functions/presence/commerce/stripe.ts');
const index = read('supabase/functions/presence/index.ts');
const webhook = read('supabase/functions/stripe-webhook/index.ts');
const clientd = read('supabase/functions/presence/routes/client_delivery.ts');

// migration: a clean multi-tenant, cents-based, purpose-tagged table
ok('migration: presence_invoices in CENTS (not the legacy dollars table)', /create table if not exists public\.presence_invoices/.test(mig) && /amount_cents integer/.test(mig));
ok('migration: purpose distinguishes deposit vs service; status bounded', /purpose text not null default 'service' check \(purpose in \('service','deposit'\)\)/.test(mig) && /status text not null default 'open' check \(status in \('open','paid','void'\)\)/.test(mig));
ok('migration: customer-scoped read index + deny-all RLS', /presence_invoices_customer_idx[\s\S]*customer_client_id/.test(mig) && /enable row level security/.test(mig));

// route + handler
ok('route: POST /sales/deals/:id/invoice → handleSalesInvoice', /\\\/sales\\\/deals\\\/\(\[0-9a-f-\]\{36\}\)\\\/invoice\$/.test(index) && /handleSalesInvoice\(req, site, principal, m\[1\], cors\)/.test(index));
ok('handler: defaults the amount to the ACCEPTED proposal total', /presence_proposals\?deal_id=eq\.\$\{dealId\}&site_id=eq\.\$\{site\.id\}&status=eq\.accepted[\s\S]*?subtotal_cents/.test(sales));
ok('handler: writes presence_invoices with the customer + purpose + cents', /svc\('presence_invoices'[\s\S]*?customer_client_id: deal\.converted_client_id[\s\S]*?amount_cents: amountCents/.test(sales));
ok('handler: refuses without Stripe configured (503, never fake)', /if \(!stripeConfigured\(\)\) return json\(\{ error: 'unavailable'/.test(sales));
ok('handler: emails the pay link + records an invoice_sent event', /emailInvoice\(site\.id, dealId/.test(sales) && /dealEvent\(site\.id, dealId, 'invoice_sent'/.test(sales));

// Stripe helper — a NON-expiring payment link with webhook-matchable metadata
ok('stripe: createServicePaymentLink builds a payment_links (non-expiring), not a 24h session', /export async function createServicePaymentLink/.test(stripe) && /stripeReq\('payment_links'/.test(stripe));
ok('stripe: threads presence_invoice_id onto the payment INTENT (webhook match)', /payment_intent_data\[metadata\]\[presence_invoice_id\]/.test(stripe));

// webhook — the ONE authority flips presence_invoices paid, additively
ok('webhook: marks presence_invoices paid via presence_invoice_id (payment_intent + checkout)', /markPresenceInvoicePaid/.test(webhook) && /md\.presence_invoice_id\) return await markPresenceInvoicePaid/.test(webhook));
ok('webhook: leaves the legacy invoice path untouched (still handles md.invoice_id)', /md\.invoice_id\) return await markInvoicePaid/.test(webhook));

// customer sees it, pay link only while unpaid
ok('client: billing reads presence_invoices by the customer, cents→dollars', /presence_invoices\?customer_client_id=eq\.\$\{me\}/.test(clientd) && /amount: \(Number\(i\.amount_cents\) \|\| 0\) \/ 100/.test(clientd));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ DEPOSITS & SERVICE INVOICES (structural): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
