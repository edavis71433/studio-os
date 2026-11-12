// ── A customer's two names (sales review item 22, second half, Nov 2026) ─────
//   deno run --allow-read --allow-env --allow-net tests/presence/customer_names_test.mjs
// Live: "Larkspur Kitchen" on the deal, "Jordan Ellis" on the customer — the two
// never met. A customer now leads with the business and names the person.
const N = await import('../../supabase/functions/presence/lib/customer_names.ts');
let pass = 0, fail = 0; const failed = [];
const ok = (n, c) => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n); } };
const eq = (n, a, b) => ok(`${n} (got ${JSON.stringify(a)})`, JSON.stringify(a) === JSON.stringify(b));
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));

eq('converted from a deal: the person is on the customer, the business on their site', N.customerNames({ clientName: 'Jordan Ellis', siteBusinessName: 'Larkspur Kitchen', contactName: 'Jordan Ellis', contactCompany: '' }), { name: 'Larkspur Kitchen', business_name: 'Larkspur Kitchen', person_name: 'Jordan Ellis' });
eq('no site yet: the contact\'s company is the business', N.customerNames({ clientName: 'Sam Rivera', contactName: 'Sam Rivera', contactCompany: 'Harbor Lane Bakery' }), { name: 'Harbor Lane Bakery', business_name: 'Harbor Lane Bakery', person_name: 'Sam Rivera' });
eq('added as a business with no contact: the customer\'s own name, no person invented', N.customerNames({ clientName: 'Northside Dental' }), { name: 'Northside Dental', business_name: '', person_name: '' });
eq('the person is never the same words as the business', N.customerNames({ clientName: 'Maple Street Studio', siteBusinessName: 'Maple Street Studio', contactName: '' , contactCompany: 'maple street studio' }), { name: 'Maple Street Studio', business_name: 'Maple Street Studio', person_name: '' });
// item 49 (Nov 8): a site name that only repeats the contact's name is a copy made at conversion, not a business
eq('a site name that repeats the contact is not a business', N.customerNames({ clientName: 'Maple Street Studio', siteBusinessName: 'Maple Street Studio', contactName: 'maple street studio' }), { name: 'Maple Street Studio', business_name: '', person_name: '' });
eq('a business on the site, a different name on the customer, no contact: that name is the person', N.customerNames({ clientName: 'Dana Lee', siteBusinessName: 'Willow Day Spa' }), { name: 'Willow Day Spa', business_name: 'Willow Day Spa', person_name: 'Dana Lee' });
eq('nothing known', N.customerNames({}), { name: 'Customer', business_name: '', person_name: '' });

// builder list item 179: the portal greets the person by their first name, from the studio's record
eq('greeting: the person on the record, first name only', N.greetingName(N.customerNames({ clientName: 'Jordan Ellis', siteBusinessName: 'Larkspur Kitchen', contactName: 'Jordan Ellis' })), 'Jordan');
eq('greeting: a record named for a person, with no business, is that person', N.greetingName(N.customerNames({ clientName: 'eric test' })), 'Eric');
eq('greeting: a business with no person behind it gets no name (Home just says good afternoon)', N.greetingName(N.customerNames({ clientName: 'Northside Dental', siteBusinessName: 'Northside Dental' })), '');
eq('greeting: an initial, an address or nothing is never a name', [N.greetingName({ person_name: 'j. smith' }), N.greetingName({ person_name: 'maria@example.com' }), N.greetingName({ name: 'Customer' }), N.greetingName(null)], ['', '', '', '']);
eq('greeting: a name already in capitals keeps them', N.greetingName({ person_name: 'McKenna Ruiz' }), 'McKenna');
const ws = read('supabase/functions/presence/routes/workspace.ts');
ok('greeting: /portal/context reads it beside the studio brand and hands it over', /const \[studio, clientFirstName\] = await Promise\.all\(/.test(ws) && /client_first_name: clientFirstName \|\| null/.test(ws) && /loadCustomerNames\(agencySiteId, \[\{ clientId, clientName: c\?\.name, customerSiteId: siteId \}\], read\)/.test(ws));

const cd = read('supabase/functions/presence/routes/client_delivery.ts');
// item 49 moved the reads into lib/customer_names.ts (loadCustomerNames) — see sales_batch11_test.mjs
ok('Customers reads the names through the shared reader and serves both', /loadCustomerNames\(String\(site\.id\)/.test(cd) && /business_name: clean\(names\.business_name, 200\),\s*person_name: clean\(names\.person_name, 200\),/.test(cd));
ok('the record header leads with the business and names the person', /header = \{ \.\.\.header, name: nm\.name \|\| header\.name, company: nm\.business_name, person: nm\.person_name/.test(read('supabase/functions/presence/routes/crm.ts')) && /if\(hd\.person\)bits\.push\(esc\(hd\.person\)\);/.test(read('crm.html')));
ok('Customers shows the person under the business, and search finds either', /c\.person_name\?`<span class="pn">/.test(read('customers.html')) && /String\(c\.person_name\|\|''\)\.toLowerCase\(\)\.includes\(q\)/.test(read('customers.html')));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
