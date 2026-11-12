// ── Sales review, second walk fixes (items 49–59, Nov 8 2026) ────────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/sales_batch11_test.mjs
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const N = await import('../../supabase/functions/presence/lib/customer_names.ts');
const A = await import('../../supabase/functions/presence/crm/activity.ts');
const C = await import('../../supabase/functions/presence/crm/contract.ts');
const T = await import('../../supabase/functions/presence/lib/my_tasks.ts');
const B = await import('../../supabase/functions/presence/lib/broadcast.ts');
let pass = 0, fail = 0; const failed = [];
const ok = (n, c) => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n); } };
const eq = (n, a, b) => ok(`${n} (got ${JSON.stringify(a)})`, JSON.stringify(a) === JSON.stringify(b));

// ── item 49: names on the live account's shape ──
eq('the site name only repeats the person: no business, and the person is not said twice', N.customerNames({ clientName: 'Jordan Ellis', siteBusinessName: 'Jordan Ellis', contactName: 'Jordan Ellis' }), { name: 'Jordan Ellis', business_name: '', person_name: '' });
eq('…and once the contact names the business, it leads', N.customerNames({ clientName: 'Jordan Ellis', siteBusinessName: 'jordan ellis', contactName: 'Jordan Ellis', contactCompany: 'Larkspur Kitchen + Wine Bar' }), { name: 'Larkspur Kitchen + Wine Bar', business_name: 'Larkspur Kitchen + Wine Bar', person_name: 'Jordan Ellis' });
eq('a real site name still wins (PR 151 case)', N.customerNames({ clientName: 'Jordan Ellis', siteBusinessName: 'Larkspur Kitchen', contactName: 'Jordan Ellis' }), { name: 'Larkspur Kitchen', business_name: 'Larkspur Kitchen', person_name: 'Jordan Ellis' });
eq('a customer added as a business keeps it (the site name matching the customer\'s own name proves nothing)', N.customerNames({ clientName: 'Fennel Street Designs', siteBusinessName: 'Fennel Street Designs', contactName: 'Marigold Orange' }), { name: 'Fennel Street Designs', business_name: 'Fennel Street Designs', person_name: 'Marigold Orange' });

const AS = '11111111-1111-4111-8111-111111111111';
const CL = '22222222-2222-4222-8222-222222222222', SITE = '33333333-3333-4333-8333-333333333333';
const DEALCT = '44444444-4444-4444-8444-444444444444', STAMPCT = '55555555-5555-4555-8555-555555555555';
const world = (over = {}) => {
  const paths = [];
  const rowsFor = {
    presence_identity: [{ site_id: SITE, business_name: 'Jordan Ellis' }],
    presence_deals: [{ converted_client_id: CL, contact_id: DEALCT }],
    contacts_by_client: [],
    contacts_by_id: [{ id: DEALCT, client_id: null, name: 'Jordan Ellis', company: 'Larkspur Kitchen + Wine Bar', phone: '(555) 010-0000' }],
    ...over,
  };
  const read = async (p) => {
    paths.push(p);
    if (rowsFor.fail && p.startsWith(rowsFor.fail)) throw new Error('down');
    if (p.startsWith('presence_identity')) return rowsFor.presence_identity;
    if (p.startsWith('presence_deals')) return rowsFor.presence_deals;
    if (p.startsWith('presence_contacts') && p.includes('client_id=in.')) return rowsFor.contacts_by_client;
    if (p.startsWith('presence_contacts') && p.includes('&id=in.')) return rowsFor.contacts_by_id;
    return [];
  };
  return { read, paths };
};
{
  const w = world();
  const r = await N.loadCustomerNames(AS, [{ clientId: CL, clientName: 'Jordan Ellis', customerSiteId: SITE }], w.read);
  eq('the contact is found through the won deal (it has no client stamp)', r[CL], { name: 'Larkspur Kitchen + Wine Bar', business_name: 'Larkspur Kitchen + Wine Bar', person_name: 'Jordan Ellis', contact_id: DEALCT, phone: '(555) 010-0000' });
  const scopedReads = w.paths.filter((p) => !p.startsWith('presence_identity'));
  ok('every read is scoped to the studio\'s own site', scopedReads.length > 0 && scopedReads.every((p) => p.includes(`site_id=eq.${AS}`)));
}
{
  const w = world({ contacts_by_client: [{ id: STAMPCT, client_id: CL, name: 'Jordan B', company: '' }] });
  const r = await N.loadCustomerNames(AS, [{ clientId: CL, clientName: 'Jordan Ellis', customerSiteId: SITE }], w.read);
  ok('a contact that names the business beats one that doesn\'t', r[CL].contact_id === DEALCT && r[CL].business_name === 'Larkspur Kitchen + Wine Bar');
}
{
  const w = world({ contacts_by_id: [{ id: DEALCT, name: 'Jordan Ellis', company: '' }] });
  const r = await N.loadCustomerNames(AS, [{ clientId: CL, clientName: 'Jordan Ellis', customerSiteId: SITE }], w.read);
  eq('live today (no company anywhere): the plain name, nothing doubled', [r[CL].name, r[CL].business_name, r[CL].person_name], ['Jordan Ellis', '', '']);
}
{
  const w = world({ fail: 'presence_' });
  const r = await N.loadCustomerNames(AS, [{ clientId: CL, clientName: 'Jordan Ellis', customerSiteId: SITE }], w.read);
  ok('failed reads leave the plain name', r[CL] && r[CL].name === 'Jordan Ellis');
}
{
  const w = world({ contacts_by_id: [{ id: STAMPCT, name: 'Dana Lee', company: 'Willow Day Spa' }, { id: DEALCT, name: 'Jordan Ellis', company: 'Larkspur Kitchen + Wine Bar' }] });
  const r = await N.loadCustomerNames(AS, [{ clientId: CL, clientName: 'Jordan Ellis', customerSiteId: SITE, contactId: STAMPCT }], w.read);
  ok('the record\'s own contact comes first', r[CL].contact_id === STAMPCT && r[CL].person_name === 'Dana Lee');
}
const cd = read('supabase/functions/presence/routes/client_delivery.ts'), crm = read('supabase/functions/presence/routes/crm.ts'), page = read('crm.html');
ok('Customers and the record both use the one reader', /loadCustomerNames\(String\(site\.id\), links\.map/.test(cd) && /loadCustomerNames\(AS, \[\{ clientId, clientName: c\.name, customerSiteId: customerSiteId \|\| null, contactId: contactId \|\| null \}\]/.test(crm));
ok('the record asks for the business name and opens the editor on that box', /data-add-biz>Add their business name</.test(page) && /WANT_EDIT='ec-company'/.test(page) && /field\('ec-company','Business name',c\.company\)/.test(page));
ok('the details card\'s Edit opens the editor (it looked for a [data-edit] that never existed)', /eb\.addEventListener\('click',\(\)=>\{WANT_EDIT='ec-name';showTab\('details'\);\}\)/.test(page) && /if\(WANT_EDIT&&eb\)\{const f=WANT_EDIT;WANT_EDIT='';editContact\(host\);/.test(page));

// ── item 50: a closed deal's old next step ──
const NOW = '2026-11-08T12:00:00Z';
const ns = (deal) => A.buildUpcoming({ deal }, NOW).filter((u) => u.kind === 'next_step');
eq('won, dated in the past: not listed', ns({ id: 'd', stage: 'won', next_step: 'Sign Contract', next_step_at: '2026-08-06' }).length, 0);
eq('won, no date: not listed', ns({ id: 'd', stage: 'won', next_step: 'Sign Contract' }).length, 0);
eq('not a fit, dated in the past: not listed', ns({ id: 'd', stage: 'lost', next_step: 'Call back', next_step_at: '2026-10-01' }).length, 0);
ok('won, dated ahead: still listed (a real plan after the win)', ns({ id: 'd', stage: 'won', next_step: 'Check in', next_step_at: '2026-12-01' }).length === 1);
ok('an open deal\'s late step still reads overdue', ns({ id: 'd', stage: 'contract', next_step: 'Sign Contract', next_step_at: '2026-08-06' })[0]?.overdue === true);
ok('the record\'s tile and its fallback list use the same rule', /const ns=\(d\.id\?liveNextStep\(d\):hl\.next_step\)\|\|'';/.test(page) && /if\(d&&liveNextStep\(d\)\)upcoming\.push/.test(page));

// ── item 51: hosted elsewhere ──
const prof = { business_name: 'Larkspur', edition: 'monitor', status: 'draft', live: false, last_published_at: null, members: 0, connected: 0, connected_needing_attention: 0, active_moments: 3, pending_approvals: 0 };
ok('a monitor-plan site is not "getting set up"', C.deriveClientHealth(prof, NOW) !== 'new');
ok('…and its summary says hosted elsewhere', /^Larkspur’s website is hosted elsewhere\./.test(C.relationshipSummary({ ...prof, health: C.deriveClientHealth(prof, NOW) }, null, NOW)));
ok('a site we host, never published, is still getting set up', C.deriveClientHealth({ ...prof, edition: 'presence' }, NOW) === 'new');
ok('the record says "Hosted elsewhere" in all three places', /const siteWord=\(p\)=>p\.live\?'Live':\(p\.edition==='monitor'\?'Hosted elsewhere'/.test(page) && (page.match(/siteWord\(p\)/g) || []).length >= 3);

// ── item 52: the tip reads the project ──
ok('the won tip reads the project\'s progress', /function guideNow\(stage\)/.test(page) && /Their project is \$\{pct\}% along\./.test(page) && /const g=guideNow\(stage\);/.test(page));

// ── item 53: My tasks ──
const P1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const tasks = T.buildMyTasks({ deals: [], dealTasks: [], taskDeals: [], userId: null,
  projects: [{ id: P1, name: 'Larkspur Kitchen + Wine Bar', status: 'active' }],
  projectTasks: [
    { id: 't3', project_id: P1, title: 'Site live', status: 'todo', sort_order: 3 },
    { id: 't1', project_id: P1, title: 'Domain connected', status: 'todo', sort_order: 1 },
    { id: 't2', project_id: P1, title: 'Handover', status: 'todo', sort_order: 2 },
    { id: 't9', project_id: P1, title: 'Launch party', status: 'todo', sort_order: 9, due_date: '2026-11-20' },
  ] });
eq('only the next step and a dated one are now; the rest wait', tasks.map((t) => `${t.title}:${t.later ? 'later' : 'now'}`), ['Launch party:now', 'Domain connected:now', 'Handover:later', 'Site live:later']);
eq('each step carries its place, so Home can move the next one up', tasks.map((t) => t.order), [9, 1, 2, 3]);
ok('the route reads each step\'s place', /select=id,project_id,title,status,due_date,assigned_to,client_action_required,sort_order(&order=[a-z_.,]+)?&limit=300/.test(read('supabase/functions/presence/routes/sales.ts')));
const home = read('agency.html');
ok('Home shows what\'s next, counts it, and moves the next step up on Done', /const now=items\.filter\(t=>!t\.later\);/.test(home) && /My to-dos · \$\{MYT_ALL\?total:now\.length\}/.test(home) && /x\.later&&x\.parent_id===t\.parent_id/.test(home));

// ── items 54–56 ──
ok('Inbox: the badge reads the name alone', /who:l\.name\|\|l\.email\|\|'Someone'/.test(read('inbox.html')) && !/initialsOf\(it\.name\)/.test(read('inbox.html')));
const pipe = read('pipeline.html');
// item 121: the list card joins its words with " · " (an unknown source says nothing, so no stray dot)
ok('Pipeline: a won or not-a-fit deal never "closes"', /d\.expected_close&&d\.stage!=='won'&&d\.stage!=='lost'\?'closes '\+niceDay\(d\.expected_close\):''\]\.filter\(Boolean\)\.join\(' · '\)/.test(pipe) && /d\.expected_close&&d\.stage!=='won'&&d\.stage!=='lost'\?`<span class="fact">Closes/.test(pipe));
ok('Send an update: a "Your customers" list', B.SEGMENTS[0].key === 'customers' && B.isSegmentKey('customers') && B.isAudienceKey('customers'));
const bl = read('supabase/functions/presence/lib/broadcast.ts');
ok('…its people are this studio\'s active customers', /presence_service_links\?agency_site_id=eq\.\$\{siteId\}&status=eq\.active&select=customer_client_id/.test(bl));
// …and it only shows when there are some: checked by behaviour in sales_reads_harness_test.mjs (final pass, batch D)

// ── items 57–59 (phones) ──
ok('record: the stage strip opens on the current stage', /const pth=host\.querySelector\('\.path'\),curStep=host\.querySelector\('\.path \.pstep\.current'\);/.test(page));
ok('Pipeline: numbers in one row, chips in one sideways row', /@media \(max-width:600px\)\{\n\s+\.stats\{grid-template-columns:none;grid-auto-flow:column/.test(pipe) && /#filters\{flex-wrap:nowrap;overflow-x:auto/.test(pipe));
ok('Customers: the view name stays on one line', /#viewBtn \.vl\{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap\}/.test(read('customers.html')));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
