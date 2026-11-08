// ── A customer's two names (sales review item 22, second half, Nov 2026) ─────
//   deno run --allow-read --allow-env --allow-net tests/presence/customer_names_test.mjs
// Live: "Bacchus Kitchen" on the deal, "Claud Beltran" on the customer — the two
// never met. A customer now leads with the business and names the person.
const N = await import('../../supabase/functions/presence/lib/customer_names.ts');
let pass = 0, fail = 0; const failed = [];
const ok = (n, c) => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n); } };
const eq = (n, a, b) => ok(`${n} (got ${JSON.stringify(a)})`, JSON.stringify(a) === JSON.stringify(b));
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));

eq('converted from a deal: the person is on the customer, the business on their site', N.customerNames({ clientName: 'Claud Beltran', siteBusinessName: 'Bacchus Kitchen', contactName: 'Claud Beltran', contactCompany: '' }), { name: 'Bacchus Kitchen', business_name: 'Bacchus Kitchen', person_name: 'Claud Beltran' });
eq('no site yet: the contact\'s company is the business', N.customerNames({ clientName: 'Sam Rivera', contactName: 'Sam Rivera', contactCompany: 'Harbor Lane Bakery' }), { name: 'Harbor Lane Bakery', business_name: 'Harbor Lane Bakery', person_name: 'Sam Rivera' });
eq('added as a business with no contact: the customer\'s own name, no person invented', N.customerNames({ clientName: 'Northside Dental' }), { name: 'Northside Dental', business_name: '', person_name: '' });
eq('the person is never the same words as the business', N.customerNames({ clientName: 'Maple Street Studio', siteBusinessName: 'Maple Street Studio', contactName: 'maple street studio' }), { name: 'Maple Street Studio', business_name: 'Maple Street Studio', person_name: '' });
eq('a business on the site, a different name on the customer, no contact: that name is the person', N.customerNames({ clientName: 'Dana Lee', siteBusinessName: 'Willow Day Spa' }), { name: 'Willow Day Spa', business_name: 'Willow Day Spa', person_name: 'Dana Lee' });
eq('nothing known', N.customerNames({}), { name: 'Customer', business_name: '', person_name: '' });

const cd = read('supabase/functions/presence/routes/client_delivery.ts');
ok('Customers reads the business from the site\'s identity and the person from the linked contact', /presence_identity\?site_id=in\.\(\$\{siteIds\.join\(','\)\}\)&select=site_id,business_name/.test(cd) && /presence_contacts\?site_id=eq\.\$\{site\.id\}&client_id=in\.\(\$\{clientIds\.join\(','\)\}\)/.test(cd) && /business_name: clean\(names\.business_name, 200\),\s*person_name: clean\(names\.person_name, 200\),/.test(cd));
ok('the record header leads with the business and names the person', /header = \{ \.\.\.header, name: nm\.name \|\| header\.name, company: nm\.business_name, person: nm\.person_name/.test(read('supabase/functions/presence/routes/crm.ts')) && /if\(hd\.person\)bits\.push\(esc\(hd\.person\)\);/.test(read('crm.html')));
ok('Customers shows the person under the business, and search finds either', /c\.person_name\?`<span class="pn">/.test(read('customers.html')) && /String\(c\.person_name\|\|''\)\.toLowerCase\(\)\.includes\(q\)/.test(read('customers.html')));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
