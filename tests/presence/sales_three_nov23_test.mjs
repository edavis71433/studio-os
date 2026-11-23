// ── Sales items 192, 201, 211 and 212 (Nov 22 2026 review): the server halves ──
//   deno run --allow-read --allow-env --allow-net tests/presence/sales_three_nov23_test.mjs
// 192: the main search finds a call or email logged on a person with no deal, a tag, a town, a
//      job title and a second phone; the Contacts box finds a phone number by its digits, a tag
//      and a town. 201: a new enquiry raises its notice at once (it pushes to the phone and opens
//      that enquiry), the email goes to the owner's sign-in address when Business details has
//      none, and its button opens the enquiry. 211: "How I write, and my terms" and "Good to know
//      about them" reach the draft, and the draft says it used them. 212: Download my data holds
//      the history, the messages and every contact field.
// Every check drives the real code on the pretend database, with the clock pinned. The pages
// (the Contacts box, the record's note, the Settings box) are in tests/e2e/sales-three-nov23.spec.ts.
import { installFakePostgrest } from './fake_pgrst.mjs';
import { pinClock, PINNED_NOW, daysFrom } from './clock.mjs';
pinClock();
const S = '11111111-1111-4111-8111-111111111111', CLIENT = '22222222-2222-4222-8222-222222222222', U = '33333333-3333-4333-8333-333333333333';
const AG = '44444444-4444-4444-8444-444444444444', MEMBER = '55555555-5555-4555-8555-555555555555';
const HARBOR_SITE = '66666666-6666-4666-8666-666666666666', HARBOR_CLIENT = '77777777-7777-4777-8777-777777777777';
const ANA = 'c0000000-0000-4000-8000-000000000001', BEN = 'c0000000-0000-4000-8000-000000000002', CARA = 'c0000000-0000-4000-8000-000000000003', HARBOR_PERSON = 'c0000000-0000-4000-8000-000000000004';
const DEAL = 'd0000000-0000-4000-8000-000000000001', PROJ = 'b0000000-0000-4000-8000-000000000001', REQ = 'e0000000-0000-4000-8000-000000000001';
const id = (p, n) => `${p}-0000-4000-8000-${String(n).padStart(12, '0')}`;
Deno.env.set('RESEND_KEY', 'test-resend-key');
Deno.env.set('APPROVAL_SECRET', 'test-approval-secret');
const db = installFakePostgrest({ users: { 'jwt-owner': { id: U, email: 'owner@studio.test' } } });
const fake = globalThis.fetch;
const mail = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes('/rest/v1/rpc/rate_hit')) return new Response('true', { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (u.startsWith('https://api.resend.com/emails')) { mail.push(JSON.parse(String(init.body))); return new Response('{"id":"e1"}', { status: 200, headers: { 'Content-Type': 'application/json' } }); }
  return fake(url, init);
};
const C = await import('../../supabase/functions/presence/routes/crm.ts');
const R = await import('../../supabase/functions/presence/lib/record_search.ts');
const Sales = await import('../../supabase/functions/presence/routes/sales.ts');
const Com = await import('../../supabase/functions/presence/routes/commercial.ts');
const W = await import('../../supabase/functions/presence/routes/workspace.ts');
const L = await import('../../supabase/functions/presence/lib/sales_ai.ts');
const AI = await import('../../supabase/functions/presence/routes/sales_ai.ts');
const X = await import('../../supabase/functions/presence/routes/sales_export.ts');
const { visitorCors } = await import('../../supabase/functions/_shared/cors.ts');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n, note); } };
const eq = (n, got, want) => ok(n, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}`);
const site = { id: S, client_id: CLIENT, status: 'live', edition: 'presence', custom_domain: 'studio.example' };
const owner = { kind: 'client', userId: U, email: 'owner@studio.test', jwt: 'jwt-owner', requestId: 't' };
const cors = {};
const ago = (days) => daysFrom(PINNED_NOW, -days);
const settle = async (cond) => { for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 2)); return cond(); };
const world = () => ({
  presence_agency_members: [{ id: MEMBER, agency_id: AG, email: 'owner@studio.test', role: 'owner', status: 'active', user_id: U }],
  presence_agencies: [{ id: AG, name: 'Studio', status: 'active', seat_limit: 3, client_limit: 50, plan: 'studio', branding: {} }],
  presence_agency_clients: [{ site_id: HARBOR_SITE, agency_id: AG, status: 'active' }],
  presence_sites: [
    { id: S, client_id: CLIENT, custom_domain: 'studio.example', status: 'live', edition: 'presence' },
    { id: HARBOR_SITE, client_id: HARBOR_CLIENT, custom_domain: 'harbor.example', status: 'live', edition: 'presence' },
  ],
  presence_identity: [{ site_id: S, business_name: 'Larkspur Studio', email: '' }, { site_id: HARBOR_SITE, business_name: 'Harbor Cafe', email: 'hello@harbor.example' }],
  clients: [{ id: CLIENT, name: 'Larkspur Studio', email: 'owner@studio.test' }, { id: HARBOR_CLIENT, name: 'Harbor Cafe', email: 'mia@harbor.example' }],
  presence_service_links: [{ id: id('5e5e5e5e', 1), agency_site_id: S, customer_client_id: HARBOR_CLIENT, customer_site_id: HARBOR_SITE, project_id: PROJ, status: 'active', created_at: ago(40) }],
  presence_contacts: [
    { id: ANA, site_id: S, name: 'Ana Ruiz', email: 'ana@bakery.example', phone: '(555) 010-4410', phone2: '', company: 'Ruiz Bakery', job_title: 'Owner', address: { city: 'Burbank', state: 'CA' }, tags: ['restaurant'], notes: 'Met at the fair [[connect-on-signup]]', good_to_know: 'Prefers texts. Her partner Luis pays the invoices.', custom: { size: 'Small' }, found_via: 'referral', subscribed_at: ago(9), created_at: ago(30), updated_at: ago(2), deleted_at: null },
    { id: BEN, site_id: S, name: 'Ben Okafor', email: 'ben@garage.example', phone: '818-213-4567', phone2: '(626) 555-0199', company: 'Okafor Auto', job_title: 'Service manager', address: { city: 'Glendale' }, tags: ['past client', 'garage'], notes: '', good_to_know: '', custom: {}, found_via: '', created_at: ago(20), updated_at: ago(3), deleted_at: null },
    { id: CARA, site_id: S, name: 'Cara Lin', email: 'cara@studio.example', phone: '', phone2: '', company: '', job_title: '', address: {}, tags: [], notes: '', good_to_know: '', custom: {}, found_via: '', created_at: ago(10), updated_at: ago(4), deleted_at: null },
    { id: HARBOR_PERSON, site_id: S, client_id: HARBOR_CLIENT, name: 'Mia Harbor', email: 'mia@harbor.example', phone: '', phone2: '', company: 'Harbor Cafe', job_title: '', address: {}, tags: [], notes: '', good_to_know: 'Closed on Mondays.', custom: {}, found_via: '', created_at: ago(40), updated_at: ago(5), deleted_at: null },
  ],
  presence_deals: [{ id: DEAL, site_id: S, title: 'Bakery website', stage: 'proposal', contact_id: ANA, notes: '', created_at: ago(25), updated_at: ago(1), deleted_at: null }],
  presence_projects: [{ id: PROJ, site_id: S, name: 'Harbor website', status: 'active', created_at: ago(40), deleted_at: null }],
  presence_person_events: [
    { id: id('a1a1a1a1', 1), site_id: S, contact_id: CARA, client_id: null, kind: 'call', body: 'Called about the spring menu shoot', subject: '', via: '', occurred_at: ago(6), actor: 'owner@studio.test', created_at: ago(6), deleted_at: null },
    { id: id('a1a1a1a1', 2), site_id: S, contact_id: null, client_id: HARBOR_CLIENT, kind: 'email', body: 'Here are the photo options', subject: 'Spring menu photos', via: 'app', occurred_at: ago(5), actor: 'owner@studio.test', created_at: ago(5), deleted_at: null },
    { id: id('a1a1a1a1', 3), site_id: S, contact_id: CARA, client_id: null, kind: 'note', body: 'Spring menu is secret, do not post', subject: '', via: '', occurred_at: ago(4), actor: 'owner@studio.test', created_at: ago(4), deleted_at: ago(1) },
  ],
  presence_deal_events: [
    { id: id('b1b1b1b1', 1), site_id: S, deal_id: DEAL, kind: 'note', detail: { activity_kind: 'call', body: 'Talked through the quote', occurred_at: ago(8) }, actor: 'owner@studio.test', created_at: ago(8) },
    { id: id('b1b1b1b1', 2), site_id: S, deal_id: DEAL, kind: 'note', detail: { activity_kind: 'removed', removed: { activity_kind: 'note', body: 'Something private' }, removed_at: ago(2) }, actor: 'owner@studio.test', created_at: ago(7) },
    { id: id('b1b1b1b1', 3), site_id: S, deal_id: DEAL, kind: 'note', detail: { change: 'value', from: 100000, to: 150000 }, actor: 'owner@studio.test', created_at: ago(6) },
    { id: id('b1b1b1b1', 4), site_id: S, deal_id: DEAL, kind: 'stage_change', from_stage: 'lead', to_stage: 'proposal', detail: {}, actor: 'owner@studio.test', created_at: ago(9) },
  ],
  presence_relationship_notes: [{ id: id('c1c1c1c1', 1), site_id: HARBOR_SITE, audience: 'internal', body: 'Harbor prefers mornings', author: 'owner@studio.test', created_at: ago(12), deleted_at: null }],
  presence_project_messages: [{ id: id('d1d1d1d1', 1), site_id: S, project_id: PROJ, audience: 'client', body: 'The photos are in the folder', author: 'Mia', author_kind: 'client', created_at: ago(3), deleted_at: null }],
  presence_support_requests: [{ id: REQ, site_id: S, subject: 'Hours are wrong', body: 'Saturday says closed', status: 'open', priority: 'normal', created_at: ago(2), deleted_at: null }],
  presence_support_messages: [{ id: id('e1e1e1e1', 1), site_id: S, request_id: REQ, body: 'Fixed the hours, thanks!', author: 'Larkspur Studio', author_kind: 'studio', created_at: ago(1), deleted_at: null }],
  presence_form_submissions: [{ id: id('f1f1f1f1', 1), site_id: S, form_kind: 'contact', name: 'Dee Park', email: 'dee@flowers.example', phone: '', message: 'Do you build shops?', source_page: '/', status: 'replied', spam: false, created_at: ago(11), fields: { __studio_replies: [{ body: 'Yes, happy to talk', at: ago(10) }], __studio_note: { body: 'Wants it by March', at: ago(10) } } }],
  presence_plan_notices: [],
  presence_sales_templates: [{ id: id('7e7e7e7e', 1), site_id: S, kind: 'proposal', name: '__crm_contact_fields__', body: JSON.stringify([{ key: 'size', label: 'Shop size', type: 'text' }]), deleted_at: null, updated_at: ago(30) }],
});
db.reset(world());

// ═══ 192 · the main search ═══
const search = async (q) => { const r = await C.handleCrmSearch(new Request(`https://fn.test/functions/v1/presence/crm/search?q=${encodeURIComponent(q)}`), 'jwt-owner', site, owner, cors); return { status: r.status, body: await r.json().catch(() => null) }; };
{
  const r = await search('spring menu');
  const rs = r.body?.data?.results || [];
  const call = rs.find((x) => x.label.includes('Called about the spring menu shoot'));
  ok('192: a call logged on a person with no deal is found, says what it was and with whom, and opens their history',
    call?.group === 'notes' && call.sub.startsWith('Logged call with Cara Lin') && call.href === `/crm.html?contact=${CARA}&tab=activity`, JSON.stringify(rs));
  const sent = rs.find((x) => x.sub.startsWith('Email you sent'));
  ok('192: an email sent from Studio OS to a customer is found by its subject, and opens the customer', sent?.href === `/crm.html?client_id=${HARBOR_CLIENT}&tab=activity` && sent.sub.startsWith('Email you sent to Harbor Cafe') && sent.label.includes('Spring menu photos'), JSON.stringify(sent));
  ok('192: a removed log is never found', !JSON.stringify(rs).includes('secret'));
}
{
  const town = (await search('burbank')).body?.data?.results || [];
  ok('192: a town finds the people there, and the line says the town', town.some((x) => x.group === 'people' && x.label === 'Ana Ruiz' && x.sub === 'Contact · Burbank'), JSON.stringify(town));
  const tag = (await search('past client')).body?.data?.results || [];
  ok('192: a whole tag finds the people tagged with it', tag.some((x) => x.label === 'Ben Okafor' && x.sub === 'Contact · tagged past client'), JSON.stringify(tag));
  const job = (await search('service manager')).body?.data?.results || [];
  ok('192: a job title finds them, and says it', job.some((x) => x.label === 'Ben Okafor' && x.sub === 'Contact · Service manager'), JSON.stringify(job));
  const p2 = (await search('626 555 0199')).body?.data?.results || [];
  ok('192: a second phone is found by its digits', p2.some((x) => x.label === 'Ben Okafor' && x.sub === 'Contact · (626) 555-0199'), JSON.stringify(p2));
  const byName = (await search('ana ruiz')).body?.data?.results || [];
  ok('192: a person found by name shows once, as before', byName.filter((x) => x.label === 'Ana Ruiz' && x.group === 'people').length === 1);
}
eq('192: why a person was found (job title, town, a whole tag, a second phone), else nothing', [
  R.personFoundBy({ job_title: 'Owner' }, 'own', '', ''), R.personFoundBy({ address: { city: 'Burbank' } }, 'burb', 'burb', ''),
  R.personFoundBy({ tags: ['restaurant'] }, 'restaurant', 'restaurant', ''), R.personFoundBy({ tags: ['restaurant'] }, 'rest', 'rest', ''),
  R.personFoundBy({ phone2: '(626) 555-0199' }, '5550199', '5550199', '5550199'), R.personFoundBy({ phone2: '6-5-5-1' }, '6551', '6551', '6551'),
], ['Owner', 'Burbank', 'tagged restaurant', '', '(626) 555-0199', '6-5-5-1']);

// ═══ 192 · the Contacts box ═══
const list = async (q) => { const r = await Sales.handleSalesContacts(new Request(`https://fn.test/functions/v1/presence/sales/contacts?q=${encodeURIComponent(q)}&total=1`), site, owner, cors); const b = await r.json().catch(() => null); return (b?.data || []).map((c) => c.name).sort(); };
eq('192: the box finds a phone number by its digits, however it was written', [await list('5550104410'), await list('010-4410'), await list('(626) 555 0199')], [['Ana Ruiz'], ['Ana Ruiz'], ['Ben Okafor']]);
eq('192: digits that only come in that order, with others between, find nobody', await list('1234'), []);
eq('192: a whole tag, a town and a job title find people too; a name still does', [await list('garage'), await list('glendale'), await list('owner'), await list('cara')], [['Ben Okafor'], ['Ben Okafor'], ['Ana Ruiz'], ['Cara Lin']]);
ok('192: the box\'s filter reads the digits as a run with only marks between', Sales.contactSearchFilter('555 0104').includes(`phone.match.${encodeURIComponent('5[^0-9]*5[^0-9]*5[^0-9]*0[^0-9]*1[^0-9]*0[^0-9]*4')}`) && !Sales.contactSearchFilter('ana').includes('match.'));

// ═══ 201 · a new enquiry ═══
eq('201: the button and the push open that enquiry in the Inbox', [Com.enquiryHref('f1f1f1f1-0000-4000-8000-000000000009'), Com.enquiryHref(''), Com.enquiryHref('not-an-id')],
  ['/inbox.html#enquiries?sel=lead:f1f1f1f1-0000-4000-8000-000000000009', '/inbox.html#enquiries', '/inbox.html#enquiries']);
eq('201: the notice says who and the start of what they wrote', [Com.enquiryNoticeCopy({ form_kind: 'contact', name: 'Dee Park', message: 'Do you  build\nshops?' }), Com.enquiryNoticeCopy({ form_kind: 'quote', email: 'x@y.example' }).headline, Com.enquiryNoticeCopy({ message: 'a'.repeat(200) }).body.length],
  [{ headline: 'New enquiry from Dee Park', body: '“Do you build shops?”' }, 'New quote from x@y.example', 112]);
eq('201: the notice opens the enquiry, as the day-later nudge does', [W.noticeHrefFor({ kind: 'website_enquiry', period: 'lead:abc-1' }), W.noticeHrefFor({ kind: 'website_enquiry', period: null })], ['/inbox.html#enquiries?sel=lead:abc-1', '/inbox.html#enquiries']);
{
  db.reset(world()); mail.length = 0;
  const fd = new FormData();
  for (const [k, v] of Object.entries({ form_kind: 'contact', name: 'Eli Stone', email: 'eli@stone.example', phone: '', message: 'Can you redo our menu page this week?', source_page: '/contact/', _hp: '' })) fd.append(k, v);
  const r = await Com.handleFormSubmit(new Request(`https://fn.test/functions/v1/presence/forms/${S}/submit`, { method: 'POST', body: fd, headers: { accept: 'application/json' } }), S, visitorCors());
  const sub = (db.tables.presence_form_submissions || []).find((x) => x.email === 'eli@stone.example');
  const arrived = await settle(() => mail.some((m) => /from your website/.test(m.subject || '')));
  const n = (db.tables.presence_plan_notices || []).find((x) => x.kind === 'website_enquiry');
  ok('201: the send is thanked and kept', r.status === 200 && !!sub);
  ok('201: a notice is raised the moment it lands, for this enquiry, written once and kept out of the bell (it is already there live)',
    n?.period === `lead:${sub?.id}` && n.status === 'dismissed' && n.client_id === CLIENT && n.headline === 'New enquiry from Eli Stone' && /redo our menu page/.test(n.body), JSON.stringify(n));
  const alert = mail.find((m) => /from your website/.test(m.subject || ''));
  ok('201: with no email in Business details, the alert goes to the owner\'s sign-in email', arrived && [].concat(alert?.to || []).includes('owner@studio.test'), JSON.stringify(alert?.to));
  ok('201: its button opens that enquiry, not an empty record page', String(alert?.html || '').includes(`/inbox.html#enquiries?sel=lead:${sub?.id}`) && !String(alert?.html || '').includes('/crm.html"') && /Open the enquiry/.test(String(alert?.html || '')));
  const again = await Com.handleFormSubmit(new Request(`https://fn.test/functions/v1/presence/forms/${S}/submit`, { method: 'POST', body: (() => { const f = new FormData(); for (const [k, v] of Object.entries({ form_kind: 'contact', name: 'Eli Stone', email: 'eli@stone.example', message: 'Can you redo our menu page this week?', source_page: '/contact/', _hp: '' })) f.append(k, v); return f; })(), headers: { accept: 'application/json' } }), S, visitorCors());
  ok('201: the same send again (a retry) raises nothing more', again.status === 200 && (db.tables.presence_plan_notices || []).filter((x) => x.kind === 'website_enquiry').length === 1);
}

// ═══ 201's follow-up · acting on an enquiry clears its day-later nudge, whatever week it was raised ═══
{
  const N = await import('../../supabase/functions/presence/lib/notice.ts');
  const L2 = id('f2f2f2f2', 1), L3 = id('f2f2f2f2', 2);
  const w = world();
  w.presence_form_submissions.push(
    { id: L2, site_id: S, form_kind: 'contact', name: 'Gus Vale', email: 'gus@vale.example', phone: '', message: 'A quote for a menu page?', source_page: '/', status: 'new', spam: false, created_at: ago(2), fields: {} },
    { id: L3, site_id: S, form_kind: 'quote', name: 'Hana Ito', email: 'hana@ito.example', phone: '', message: 'A logo and a site?', source_page: '/', status: 'new', spam: false, created_at: ago(2), fields: {} });
  // an older nudge kept the once-only key it had before the weekly bucket
  w.presence_plan_notices = [{ id: id('9a9a9a9a', 1), site_id: S, client_id: CLIENT, kind: 'lead_followup', period: N.leadFollowupLegacyPeriod(L2), status: 'active', headline: 'Gus is waiting', body: '', created_at: ago(30) }];
  db.reset(w); mail.length = 0;
  // raised the way the day-later sweep raises them (commerce/lifecycle.ts runLeadFollowups): this week's bucket
  for (const lead of [L2, L3]) await N.raiseNotice({ siteId: S, clientId: CLIENT, kind: 'lead_followup', period: N.leadFollowupPeriod(lead, Date.now()), headline: 'Still waiting', body: 'They reached out a day ago.', push: false });
  const nudge = (period) => (db.tables.presence_plan_notices || []).find((n) => n.kind === 'lead_followup' && n.period === period);
  const week = (lead) => nudge(N.leadFollowupPeriod(lead, Date.now()));
  ok('201 follow-up: each quiet enquiry\'s nudge is in the bell, in this week\'s bucket', week(L2)?.status === 'active' && week(L3)?.status === 'active' && /^lead:f2f2f2f2-0000-4000-8000-000000000001:w\d+$/.test(week(L2)?.period || ''));
  const reply = await Com.handleFormReply(new Request(`https://fn.test/functions/v1/presence/forms/inbox/${L2}/reply`, { method: 'POST', body: JSON.stringify({ body: 'Happy to help, Gus. Are you free Tuesday?' }) }), 'jwt-owner', site, owner, L2, cors);
  ok('201 follow-up: a reply clears that enquiry\'s nudge: this week\'s, and the older once-only one',
    reply.status === 200 && week(L2)?.status === 'dismissed' && nudge(N.leadFollowupLegacyPeriod(L2))?.status === 'dismissed', JSON.stringify([reply.status, db.tables.presence_plan_notices]));
  ok('201 follow-up: …and nobody else\'s', week(L3)?.status === 'active');
  const st = await Com.handleFormStatus(new Request(`https://fn.test/functions/v1/presence/forms/inbox/${L3}`, { method: 'PATCH', body: JSON.stringify({ status: 'read' }) }), site, L3, cors);
  ok('201 follow-up: settling an enquiry (Mark read) clears its nudge too', st.status === 200 && week(L3)?.status === 'dismissed');
  const L4 = id('f2f2f2f2', 4);
  await N.raiseNotice({ siteId: S, clientId: CLIENT, kind: 'lead_followup', period: N.leadFollowupPeriod(L4, Date.now()), headline: 'Still waiting', body: '', push: false });
  await N.clearLeadFollowup(S, '*');
  ok('201 follow-up: an id carrying filter grammar is refused, never widened to other enquiries', week(L4)?.status === 'active');
}

// ═══ 211 · what AI help knows ═══
eq('211: "How I write" is kept with the goal, cleaned, and cleared by empty', [
  L.applyGoalAi(L.normalizeGoalAi(null), { writing: '  Friendly, first names.\r\n\r\n\r\n50% deposit.  ' }, 'o@s.test', PINNED_NOW).value.writing,
  L.applyGoalAi(L.normalizeGoalAi({ writing: 'x' }), { writing: '' }, 'o@s.test', PINNED_NOW).value.writing,
  'error' in L.applyGoalAi(L.normalizeGoalAi(null), { writing: 5 }, 'o@s.test', PINNED_NOW),
  L.normalizeGoalAi({ writing: 'a'.repeat(L.WRITING_MAX + 50) }).writing.length,
], ['Friendly, first names.\n\n50% deposit.', '', true, L.WRITING_MAX]);
{
  const facts = { business: 'Larkspur Studio', services: [], person: { name: 'Ana Ruiz', email: 'ana@bakery.example' }, deal: null, upcoming: [], thread: [{ at: ago(1), who: 'Ana Ruiz', text: 'Can we start in May?' }], timeline: [], good_to_know: 'Prefers texts.', writing: 'Short and warm. Invoices due in 14 days.' };
  const m = L.draftMessages(facts, '', 'Re: May');
  ok('211: the draft reads how the owner writes (theirs, so in the instructions) and their note on the person (in the facts)',
    m.system.includes('<how_i_write>\nShort and warm. Invoices due in 14 days.\n</how_i_write>') && m.user.includes("Good to know about them, in the owner's words: Prefers texts.") && !m.user.includes('how_i_write'));
  const plain = L.draftMessages({ ...facts, good_to_know: '', writing: '' }, '', '');
  ok('211: with neither, the draft asks as before', !plain.system.includes('how_i_write') && !plain.user.includes('Good to know'));
  ok('211: the summary reads the note, never how they write', L.summaryMessages(facts).user.includes('Prefers texts.') && !L.summaryMessages(facts).system.includes('how_i_write'));
  eq('211: "Drafted by AI from …" names the note and how you write', [L.draftFrom('record', facts, PINNED_NOW, 0, null), L.draftFrom('enquiry', { ...facts, writing: '' }, PINNED_NOW, 0, null)],
    ['Ana’s messages, your note on Ana and how you write', 'Ana’s enquiry and your note on Ana']);
}
db.reset(world());
eq('211: the note is found by the person, a customer\'s first person, or an email', [
  await AI.goodToKnowFor(S, { contactId: ANA }), await AI.goodToKnowFor(S, { clientId: HARBOR_CLIENT }), await AI.goodToKnowFor(S, { email: 'ANA@bakery.example' }), await AI.goodToKnowFor(S, { email: 'nobody@x.example' }), await AI.goodToKnowFor('not-a-site', { contactId: ANA }),
], ['Prefers texts. Her partner Luis pays the invoices.', 'Closed on Mondays.', 'Prefers texts. Her partner Luis pays the invoices.', '', '']);
{
  const contact = async (method, body) => { const r = await Sales.handleSalesContact(new Request(`https://fn.test/functions/v1/presence/sales/contacts/${CARA}`, method === 'GET' ? {} : { method, body: JSON.stringify(body) }), site, owner, CARA, cors); return { status: r.status, body: await r.json().catch(() => null) }; };
  const saved = await contact('PATCH', { good_to_know: '  Loves dogs.\r\nCall after 10.  ' });
  ok('211: the record saves the note on the person, cleaned', saved.status === 200 && saved.body?.data?.good_to_know === 'Loves dogs.\nCall after 10.' && db.tables.presence_contacts.find((c) => c.id === CARA).good_to_know === 'Loves dogs.\nCall after 10.');
  ok('211: and reads it back', (await contact('GET')).body?.data?.contact?.good_to_know === 'Loves dogs.\nCall after 10.');
  ok('211: a note that isn\'t words is refused plainly', (await contact('PATCH', { good_to_know: 42 })).status === 422);
  ok('211: a note too long is kept to 1,000 characters', (await contact('PATCH', { good_to_know: 'x'.repeat(1500) })).body?.data?.good_to_know?.length === L.GOOD_TO_KNOW_MAX);
}
{
  const goal = async (method, body) => { const r = await AI.handleGoalAi(new Request('https://fn.test/functions/v1/presence/sales/goal-ai?today=2026-11-22&tzo=480', method === 'GET' ? {} : { method, body: JSON.stringify(body) }), 'jwt-owner', site, owner, cors); return { status: r.status, body: await r.json().catch(() => null) }; };
  const put = await goal('PUT', { writing: 'Friendly. 50% deposit.' });
  ok('211: Settings saves "How I write, and my terms"', put.status === 200 && put.body?.data?.writing === 'Friendly. 50% deposit.', JSON.stringify(put.body));
  ok('211: and reads it back beside the goal', (await goal('GET')).body?.data?.writing === 'Friendly. 50% deposit.');
}
{
  const rec = await C.handleCrmRecord(new Request(`https://fn.test/functions/v1/presence/crm/record?client_id=${HARBOR_CLIENT}`), 'jwt-owner', site, owner, cors);
  const d = (await rec.json().catch(() => null))?.data;
  ok('211: a customer\'s record names the person their note belongs to', rec.status === 200 && d?.identity?.person_id === HARBOR_PERSON, JSON.stringify(d?.identity));
  const anaRec = await C.handleCrmRecord(new Request(`https://fn.test/functions/v1/presence/crm/record?contact=${ANA}`), 'jwt-owner', site, owner, cors);
  ok('211: a person\'s record names them', (await anaRec.json().catch(() => null))?.data?.identity?.person_id === ANA);
}

// ═══ 212 · Download my data ═══
{
  const row = X.contactRow(world().presence_contacts[0]);
  eq('212: a contact carries every field, the notes without Studio OS\'s marker', row,
    ['Ana Ruiz', 'ana@bakery.example', '(555) 010-4410', '', 'Ruiz Bakery', 'Owner', '', 'Burbank', 'CA', '', '', 'restaurant', 'Met at the fair', 'Prefers texts. Her partner Luis pays the invoices.', 'referral', ago(9).slice(0, 10), ago(30).slice(0, 10)]);
  ok('212: the header names each column', X.CONTACT_HEADER.length === row.length && X.CONTACT_HEADER.includes('Good to know') && X.CONTACT_HEADER.includes('Second phone') && X.CONTACT_HEADER.includes('Tags'));
}
const unzip = (u8) => {   // a stored (uncompressed) zip: name → text
  const out = {}; const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); let p = 0; const dec = new TextDecoder();
  while (p + 30 <= u8.length && dv.getUint32(p, true) === 0x04034b50) {
    const size = dv.getUint32(p + 18, true), nlen = dv.getUint16(p + 26, true), xlen = dv.getUint16(p + 28, true);
    const name = dec.decode(u8.subarray(p + 30, p + 30 + nlen)); const start = p + 30 + nlen + xlen;
    out[name] = dec.decode(u8.subarray(start, start + size)); p = start + size;
  }
  return out;
};
{
  db.reset(world());
  const r = await X.handleSalesExport(site, owner, cors);
  const files = unzip(new Uint8Array(await r.arrayBuffer()));
  const h = files['history.csv'] || '', m = files['messages.csv'] || '', c = files['contacts.csv'] || '';
  ok('212: the download has a history file and a messages file', r.status === 200 && !!files['history.csv'] && !!files['messages.csv'], Object.keys(files).join(','));
  ok('212: the history holds a call on a person with no deal, an email sent to a customer, a deal\'s call, a customer\'s record note and an enquiry\'s note',
    /Cara Lin,,Call,,Called about the spring menu shoot,owner@studio\.test,Logged by hand/.test(h) && /Harbor Cafe,,Email,Spring menu photos,Here are the photo options,owner@studio\.test,Sent from Studio OS/.test(h)
    && /Ana Ruiz,Bakery website,Call,,Talked through the quote/.test(h) && /Harbor Cafe,,Note,,Harbor prefers mornings,owner@studio\.test,On their record/.test(h) && /Dee Park,,Note,,Wants it by March,,On their enquiry/.test(h), h);
  ok('212: a removed log, a change line and a stage move are not in the history', !h.includes('secret') && !h.includes('Something private') && !/150000|proposal/.test(h));
  ok('212: the history runs oldest first', h.indexOf('Wants it by March') < h.indexOf('Talked through the quote') && h.indexOf('Talked through the quote') < h.indexOf('Called about the spring menu shoot'));
  ok('212: messages hold the project messages, support replies and your replies to enquiries',
    /Project: Harbor website,Mia,The photos are in the folder/.test(m) && /Support: Hours are wrong,Larkspur Studio,"Fixed the hours, thanks!"/.test(m) && /Enquiry: Dee Park,Your studio,"Yes, happy to talk"/.test(m), m);
  ok('212: contacts carry the newer fields and your own fields by their label', c.split('\r\n')[0].endsWith('Good to know,How they found you,Joined your list,Added,Shop size') && /Ana Ruiz,.*,Burbank,CA,.*restaurant,Met at the fair,Prefers texts\. Her partner Luis pays the invoices\.,referral,.*,Small/.test(c) && !c.includes('connect-on-signup'), c.split('\r\n').slice(0, 2).join(' | '));
  ok('212: READ-ME says what the two new files hold', /history\.csv holds every call, email, meeting and note you logged\. messages\.csv holds your conversations with customers\./.test(files['READ-ME.txt'] || ''));
  db.fail.add('presence_person_events');
  const r2 = await X.handleSalesExport(site, owner, cors);
  const f2 = unzip(new Uint8Array(await r2.arrayBuffer()));
  ok('212: a history that can\'t be read is left out and named, never an empty file', !f2['history.csv'] && /couldn't be read just now, so they aren't included: history\.csv/.test(f2['READ-ME.txt'] || '') && !!f2['messages.csv'], f2['READ-ME.txt']);
}

console.log(`\n════ SALES THREE (items 192, 201, 211, 212): ${pass}/${pass + fail} ${fail ? 'FAILED' : 'PASSED'} ════`);
if (fail) { console.log('failed: ' + failed.join(' | ')); Deno.exit(1); }
