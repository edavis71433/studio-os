// ── Phase 2: one customer model + search across everything — source pins ────
// The pieces live in four files that have to agree on one contract: the
// contacts column (0130), the routes that set it, the search that reads the
// customers, and the record page that honours ⌘K's ?act=.
const read = (p) => Deno.readTextFile(new URL(p, import.meta.url));
const migration = await read('../../supabase/migrations/0130_contact_customer_link.sql');
const sales = await read('../../supabase/functions/presence/routes/sales.ts');
const crmRoute = await read('../../supabase/functions/presence/routes/crm.ts');
const crm = await read('../../crm.html');
const inbox = await read('../../inbox.html');   // the Enquiries page folded in here (Oct 2026 audit change 5)
const contacts = await read('../../contacts.html');
const customers = await read('../../customers.html');
let pass = 0, fail = 0; const failed = [];
const ok = (n, c) => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n); } };

// the column + its index
ok('0130 adds presence_contacts.client_id', /add column if not exists client_id uuid/.test(migration));
ok('0130 indexes (site_id, client_id)', /presence_contacts_client_idx/.test(migration));
ok('0130 opens with a rollback note', /^-- rollback:/.test(migration));

// the routes that set it
ok('sales: linkContactToCustomer exists and is UUID-guarded', /async function linkContactToCustomer/.test(sales) && /UUID_RE\.test\(String\(contactId\)\)/.test(sales));
ok('sales: deal convert links the deal contact to the new customer', /await linkContactToCustomer\(site\.id, deal\.contact_id, clientId\)/.test(sales));
ok('sales: add-customer (connect) links the contact', /const ct = await ensureConnectContact\(site\.id, email, name, false\);\s*await linkContactToCustomer\(site\.id, ct\?\.id, clientId\)/.test(sales));
ok('sales: add-customer (provision) links the contact', /\{ const ct = await ensureConnectContact\(site\.id, email, name, false\); await linkContactToCustomer\(site\.id, ct\?\.id, clientId\)/.test(sales));
ok('sales: an enquiry converted this way is marked converted', /async function markSubmissionConverted/.test(sales) && (sales.match(/markSubmissionConverted\(site\.id, b\.source_submission_id\)/g) || []).length >= 2);
// the read tolerates a database without the column
ok('sales: contacts read selects client_id and retries narrow on 400', /company,client_id,updated_at/.test(sales) && /r\.status === 400\) r = await svc\(mkPath\('id,name,email,phone,company,updated_at'\)\)/.test(sales));

// search across everything
ok('search: customers come from the bridge links + clients', /presence_service_links\?agency_site_id=eq\.\$\{site\.id\}&status=eq\.active&select=customer_client_id,customer_site_id/.test(crmRoute) && /clients\?id=in\./.test(crmRoute));
ok('search: invoices are searched by title or amount', /presence_invoices\?site_id=eq\.\$\{site\.id\}&deleted_at=is\.null&or=\(title\.ilike/.test(crmRoute));
ok('search: a money word lists open invoices', /moneyWord/.test(crmRoute) && /status=eq\.open&select=id,title,amount_cents/.test(crmRoute));
ok('search: actions land on the record with ?act=', /tab=billing&act=invoice/.test(crmRoute) && /tab=details&act=message/.test(crmRoute));
ok('search: every result carries a kind', /kind: 'customer'/.test(crmRoute) && /kind: 'invoice'/.test(crmRoute) && /kind: 'action'/.test(crmRoute));

// the record honours ?act=
ok('crm.html: ?act=invoice opens Billing once the deal is in', /if\(act==='invoice'\|\|act==='deposit'\)DEAL_READY\.then/.test(crm));
ok('crm.html: ?act=message brings the composer forward', /act==='message'\|\|act==='note'\|\|act==='task'\)setTimeout\(\(\)=>focusComposer\(act\)/.test(crm));

// the enquiry's one-step convert
ok('inbox.html: Make customer posts /sales/customers with the enquiry id', /api\('\/sales\/customers','POST',\{email,name:l\.name\|\|'',business_name:biz,source_submission_id:id\}\)/.test(inbox) && /const l=it\.lead\|\|\{\},id=it\.lead_id;/.test(inbox));
ok('inbox.html: the deal is optional', /\$\('conv-deal'\)\.checked/.test(inbox));
// the person → customer link on both rosters
ok('contacts.html: a linked person links to the customer record', /crm\.html\?client_id=\$\{esc\(c\.client_id\)\}/.test(contacts));
ok('customers.html: People tab reads /sales/contacts', /api\('\/sales\/contacts\?limit=200'\)/.test(customers) && /id="tabPeople"/.test(customers));

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) { console.log('FAILURES'); failed.forEach((f) => console.log(' -', f)); Deno.exit(1); }
