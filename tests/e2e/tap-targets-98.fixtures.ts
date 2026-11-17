import { ALL_FEATURES, STUDIO_LEVEL_NAV } from './helpers/app';

// Made-up fixtures for builder item 98's tap-target walk (tests/e2e/tap-targets-98.spec.ts). Every name is invented.
const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();
const ymd = (d: number) => new Date(Date.now() + d * DAY).toISOString().slice(0, 10);

// ── a studio at studio level (as agency.spec / home-redesign.spec use) ──────
export const STUDIO_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'],
  landing: '/agency.html', attention_count: 0, nav: STUDIO_LEVEL_NAV, plan_key: 'presence', upsell: null, scope: null,
} };
export const COMMON: Record<string, unknown> = {
  '/portal/context': STUDIO_CTX,
  '/agency/me': { data: { agency: 'Bright Studio', role: 'owner', plan: 'agency', branding: {}, email: 'owner@example.com', member_id: 'm1' } },
  '/sales/views': { data: {} },
  '/identity': { data: { site_id: 'site-studio', business_name: 'Bright Studio', booking_url: '' } },
};

// ── the invented customers every page shares ────────────────────────────────
const CUSTOMERS = [
  { client_id: 'c-1', name: 'Quinn & Rowe Bakery', person_name: 'Avery Quinn', email: 'avery@quinnrowe.example', project_id: 'p-1', project_name: 'Website rebuild', status: 'active', customer_site_id: 'site-1', open_support: 2, project_count: 1 },
  { client_id: 'c-2', name: 'Lantern Yoga Loft', person_name: 'Bea Okafor', email: 'bea@lanternyoga.example', project_id: 'p-2', project_name: 'Class booking page', status: 'active', customer_site_id: 'site-2', open_support: 0, project_count: 1 },
  { client_id: 'c-3', name: 'Copperline Plumbing', person_name: 'Dana Ortega', email: 'dana@copperline.example', project_id: 'p-3', project_name: 'New website', status: 'active', customer_site_id: 'site-3', open_support: 0, project_count: 1 },
  { client_id: 'c-4', name: 'Brandt Auto Care', person_name: 'Eli Brandt', email: 'eli@brandtauto.example', project_id: 'p-4', project_name: 'Service menu refresh', status: 'on_hold', customer_site_id: 'site-4', open_support: 1, project_count: 1 },
  { client_id: 'c-5', name: 'Nouri Florals', person_name: 'Farah Nouri', email: 'farah@nourifloral.example', project_id: 'p-5', project_name: 'Online orders', status: 'active', customer_site_id: 'site-5', open_support: 0, project_count: 2 },
  { client_id: 'c-6', name: 'Tanaka Family Dental', person_name: 'Gus Tanaka', email: 'gus@tanakadental.example', project_id: 'p-6', project_name: 'Care plan', status: 'active', customer_site_id: 'site-6', open_support: 0, project_count: 1 },
  { client_id: 'c-7', name: 'Kettle & Crumb Café', person_name: 'Hana Sato', email: 'hana@kettlecrumb.example', project_id: 'p-7', project_name: 'Website refresh', status: 'complete', customer_site_id: 'site-7', open_support: 0, project_count: 1 },
  { client_id: 'c-8', name: 'Harbor Light Realty', person_name: 'Rae Lindqvist', email: 'rae@harborlight.example', project_id: null, project_name: null, status: 'active', customer_site_id: 'site-8', open_support: 0, project_count: 0 },
];
const RECEIVABLES = { data: { items: [
  { id: 'i1', title: 'Deposit', amount_cents: 120000, due_date: ymd(-4), status: 'open', state: 'overdue', overdue: true, deal_id: 'd-1', deal: 'Quinn & Rowe Bakery — website', client_id: 'c-1', customer_site_id: 'site-1', created_at: ago(12) },
  { id: 'i2', title: 'Balance', amount_cents: 30000, due_date: ymd(6), status: 'open', state: 'upcoming', overdue: false, deal_id: 'd-1', deal: 'Quinn & Rowe Bakery — website', client_id: 'c-1', customer_site_id: 'site-1', created_at: ago(2) },
  { id: 'i3', title: 'Online orders', amount_cents: 45000, due_date: ymd(9), status: 'open', state: 'upcoming', overdue: false, deal_id: 'd-5', deal: 'Nouri Florals — orders', client_id: 'c-5', customer_site_id: 'site-5', created_at: ago(3) },
  { id: 'i4', title: 'Menu refresh', amount_cents: 80000, due_date: ymd(-9), status: 'open', state: 'overdue', overdue: true, deal_id: 'd-4', deal: 'Brandt Auto Care — menu', client_id: 'c-4', customer_site_id: 'site-4', created_at: ago(20) },
], paid: [], total_cents: 275000, overdue_cents: 200000 } };

// ── 1. Contacts ─────────────────────────────────────────────────────────────
const dupe = (id: string, name: string, email: string, phone: string) => ({ id, name, email, phone, reasons: ['same phone number', 'similar name'], why: 'same phone number and similar name' });
const CONTACTS = [
  { id: 'ct-1', name: 'Avery Quinn', company: 'Quinn & Rowe Bakery', job_title: 'Owner', email: 'avery@quinnrowe.example', phone: '(555) 010-1001', tags: ['VIP'], client_id: 'c-1', updated_at: ago(1) },
  { id: 'ct-2', name: 'Bea Okafor', company: 'Lantern Yoga Loft', job_title: 'Studio manager', email: 'bea@lanternyoga.example', phone: '(555) 010-1002', tags: ['Referral'], client_id: 'c-2', updated_at: ago(2) },
  { id: 'ct-3', name: 'Cal Whitmore', company: '', job_title: '', email: 'cal.whitmore@example.com', phone: '', tags: [], client_id: null, updated_at: ago(4) },
  { id: 'ct-4', name: 'Dana Ortega', company: 'Copperline Plumbing', job_title: 'Office lead', email: 'dana@copperline.example', phone: '(555) 010-1004', tags: ['Lead', 'Spring promo'], client_id: 'c-3', updated_at: ago(5) },
  { id: 'ct-5', name: 'Eli Brandt', company: 'Brandt Auto Care', job_title: 'Service manager', email: 'eli@brandtauto.example', phone: '(555) 010-1005', tags: [], client_id: 'c-4', updated_at: ago(6), possible_duplicate_of: dupe('ct-6', 'Elijah Brandt', '', '5550101005') },
  { id: 'ct-6', name: 'Elijah Brandt', company: '', job_title: '', email: '', phone: '5550101005', tags: [], client_id: null, updated_at: ago(6), possible_duplicate_of: dupe('ct-5', 'Eli Brandt', 'eli@brandtauto.example', '(555) 010-1005') },
  { id: 'ct-7', name: 'Farah Nouri', company: 'Nouri Florals', job_title: 'Owner', email: 'farah@nourifloral.example', phone: '(555) 010-1007', tags: ['Newsletter'], client_id: 'c-5', updated_at: ago(8) },
  { id: 'ct-8', name: 'Gus Tanaka', company: 'Tanaka Family Dental', job_title: 'Office manager', email: 'gus@tanakadental.example', phone: '(555) 010-1008', tags: [], client_id: 'c-6', updated_at: ago(11) },
  { id: 'ct-9', name: 'Hana Sato', company: 'Kettle & Crumb Café', job_title: '', email: 'hana@kettlecrumb.example', phone: '(555) 010-1009', tags: ['VIP', 'Catering'], client_id: 'c-7', updated_at: ago(14) },
];
export const CONTACTS_API = {
  ...COMMON,
  '/sales/contacts': { data: CONTACTS, limit: 100, offset: 0, total: CONTACTS.length },
  '/sales/contacts/fields': { data: [] },
  '/sales/contacts/imports': { data: null },
};

// ── 2. Projects (studio level) ──────────────────────────────────────────────
const P = (n: number) => `bbbbbbbb-0000-4000-8000-00000000000${n}`;
const PROJECTS = { data: [
  { id: P(1), name: 'Website rebuild', status: 'active', client_visible: true, client_id: 'c-1', target_date: ymd(25), updated_at: ago(1) },
  { id: P(2), name: 'Class booking page', status: 'active', client_visible: true, client_id: 'c-2', target_date: ymd(33), updated_at: ago(2) },
  { id: P(3), name: 'New website', status: 'active', client_visible: true, client_id: 'c-3', target_date: ymd(3), updated_at: ago(1) },
  { id: P(4), name: 'Service menu refresh', status: 'on_hold', client_visible: true, client_id: 'c-4', target_date: null, updated_at: ago(15) },
  { id: P(5), name: 'Online orders', status: 'active', client_visible: true, client_id: 'c-5', target_date: ymd(-2), updated_at: ago(3) },
  { id: P(6), name: 'Care plan', status: 'active', client_visible: true, client_id: 'c-6', target_date: ymd(60), updated_at: ago(4) },
  { id: P(7), name: 'Website refresh', status: 'complete', client_visible: true, client_id: 'c-7', target_date: ymd(-20), updated_at: ago(20) },
  { id: P(8), name: 'Studio portfolio update', status: 'active', client_visible: false, client_id: null, target_date: null, updated_at: ago(6) },
  { id: P(9), name: 'Old flyer', status: 'archived', client_visible: true, client_id: null, target_date: null, updated_at: ago(90) },
], is_studio_view: true };
const pr = (done: number, total: number) => ({ done, total, pct: Math.round((done * 100) / total) });
const PROGRESS = { data: {
  [P(1)]: { progress: pr(7, 10), pending_approvals: 1, stage: 'review', next: { title: 'Apply the homepage changes', theirs: false, due_date: null }, waiting: { kind: 'approval', title: 'Homepage design' }, overdue: 0 },
  [P(2)]: { progress: pr(2, 10), pending_approvals: 0, stage: 'kickoff', next: { title: 'Send your class schedule', theirs: true, due_date: null }, waiting: { kind: 'task', title: 'Send your class schedule' }, overdue: 0 },
  [P(3)]: { progress: pr(9, 10), pending_approvals: 0, stage: 'launch', next: { title: 'Point the domain', theirs: false, due_date: null }, waiting: null, overdue: 0 },
  [P(4)]: { progress: pr(3, 10), pending_approvals: 0, stage: 'design', next: null, waiting: null, overdue: 0 },
  [P(5)]: { progress: pr(8, 10), pending_approvals: 0, stage: 'review', next: { title: 'Check the order form', theirs: false, due_date: null }, waiting: null, overdue: 1 },
  [P(6)]: { progress: pr(4, 10), pending_approvals: 0, stage: 'design', next: { title: 'Draft the service pages', theirs: false, due_date: null }, waiting: null, overdue: 0 },
  [P(7)]: { progress: pr(10, 10), pending_approvals: 0, stage: 'launch', next: null, waiting: null, overdue: 0 },
  [P(8)]: { progress: pr(1, 4), pending_approvals: 0, stage: null, next: { title: 'Pick the case studies', theirs: false, due_date: null }, waiting: null, overdue: 0 },
  [P(9)]: { progress: pr(1, 1), pending_approvals: 0, stage: 'launch', next: null, waiting: null, overdue: 0 },
} };
export const PROJECTS_API: Record<string, unknown> = {
  ...COMMON,
  '/projects': PROJECTS,
  '/projects/progress': PROGRESS,
  '/studio/customers': { data: CUSTOMERS.map(({ client_id, name, person_name, email, customer_site_id }) => ({ client_id, name, person_name, email, customer_site_id })) },
  '/support': { data: [] },
};
for (let n = 1; n <= 9; n++) {
  const g = (PROGRESS.data as Record<string, { progress: unknown; pending_approvals: number }>)[P(n)];
  PROJECTS_API[`/projects/${P(n)}/report`] = { data: { summary: { progress: g.progress, pending_approvals: g.pending_approvals, milestones: { complete: 1, total: 3 }, open_client_actions: 0, shared_files: 2 } } };
}

// ── 3. Home (agency.html): the roster of clients ────────────────────────────
const site = (over: Record<string, unknown>) => ({
  site_id: '', name: '', edition: 'presence', status: 'ready',
  archived: false, tags: [], owner: 'owner@example.com', assigned: [], has_notes: false,
  domain: null, domain_registrar: null, domain_expires_at: null,
  moments: 0, criticals: 0, open_opportunities: 0, plans_waiting: 0, drafts_waiting: 0,
  leads_waiting: 0, files_pending: 0, search_issues: 0, billing_issue: false,
  attention: 0, review_open: false, migration: null,
  last_published_at: ago(10), unpublished_changes: false, last_change_at: null,
  ...over,
});
const PORTFOLIO = [
  site({ site_id: 'site-1', name: 'Quinn & Rowe Bakery', attention: 2, last_published_at: ago(3), domain: 'quinnrowe.example' }),
  site({ site_id: 'site-2', name: 'Lantern Yoga Loft', leads_waiting: 1, last_published_at: ago(6) }),
  site({ site_id: 'site-3', name: 'Copperline Plumbing', last_published_at: null }),
  site({ site_id: 'site-4', name: 'Brandt Auto Care', unpublished_changes: true, last_change_at: ago(1) }),
  site({ site_id: 'site-5', name: 'Nouri Florals', last_published_at: ago(2) }),
  site({ site_id: 'site-6', name: 'Tanaka Family Dental', edition: 'monitor', last_published_at: null }),
  site({ site_id: 'site-7', name: 'Kettle & Crumb Café', last_published_at: ago(21) }),
  site({ site_id: 'site-8', name: 'Harbor Light Realty', last_published_at: null }),
];
const NEEDS = [
  { key: 'money:i1', kind: 'money', site_id: 'site-1', client_id: 'c-1', name: 'Quinn & Rowe Bakery', what: 'invoice $1,200 is overdue by 4 days', when: 'Sent ' + new Date(Date.now() - 12 * DAY).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) + ' · no payment yet', verb: 'Resend', href: '/crm.html?deal=d-1&tab=billing' },
  { key: 'enquiry:e1', kind: 'enquiry', site_id: 'site-2', client_id: null, name: 'Lantern Yoga Loft', what: 'new enquiry from Priya', when: 'Yesterday', verb: 'Reply', href: '/inbox.html?client=site-2#enquiries', at: ago(1) },
  { key: 'support:s1', kind: 'support', site_id: 'site-4', client_id: 'c-4', name: 'Brandt Auto Care', what: 'support request: holiday hours', when: 'Opened 2 days ago', verb: 'Reply', href: '/inbox.html#support', at: ago(2) },
  { key: 'broken:publish:site-7', kind: 'broken', site_id: 'site-7', client_id: null, name: 'Kettle & Crumb Café', what: 'the last publish didn’t finish', when: 'Found by the health check', verb: 'Fix', href: '/presence.html?client=site-7#publish' },
  { key: 'deal:d-8', kind: 'deal', site_id: null, client_id: 'c-8', name: 'Harbor Light Realty', what: 'next step “Send the proposal” is 2 days late', when: 'On the deal Harbor Light Realty — site', verb: 'Open deal', href: '/crm.html?deal=d-8' },
];
const nextBy = (k: 'site_id' | 'client_id') => Object.fromEntries(NEEDS.filter((r) => r[k]).map((r) => [r[k], { what: r.what, verb: r.verb, href: r.href, kind: r.kind }]).reverse());
export const AGENCY_API = {
  ...COMMON,
  '/agency/portfolio': { data: PORTFOLIO },
  '/agency/needs-you': { data: {
    rows: NEEDS, more: 0, rest: [], total: NEEDS.length, empty_line: '', partial: false, own_site: true,
    next_by_site: nextBy('site_id'), next_by_client: nextBy('client_id'), old: { count: 0, items: [] }, snooze_ready: true, snoozed: [],
  } },
  '/agency/kits': { data: [] },
  '/studio/customers': { data: CUSTOMERS },
  '/sales/setup': { data: { steps: [], hidden: true, shows: false, done: 0, total: 0 } },
  '/sales/summary': { data: { total: 5, open: { count: 3, value_cents: 900000 }, won_month: { count: 1, value_cents: 195000 }, win_rate: { pct: 50, won: 1, lost: 1 }, by_stage: [], ar: { outstanding_cents: 275000, overdue_cents: 200000, count: 4, overdue_count: 2 } } },
  '/sales/deals': { data: [
    { id: 'd-8', title: 'Harbor Light Realty — site', stage: 'proposal', expected_value_cents: 500000, converted_client_id: null, created_at: ago(9), updated_at: ago(3), next_step: 'Send the proposal', next_step_at: ymd(-2) },
    { id: 'd-9', title: 'Maple Row Pottery — shop', stage: 'contract', expected_value_cents: 250000, converted_client_id: null, created_at: ago(20), updated_at: ago(8) },
    { id: 'd-10', title: 'Sunfield Tutoring — site', stage: 'lead', expected_value_cents: 150000, converted_client_id: null, created_at: ago(2), updated_at: ago(2) },
    { id: 'd-5', title: 'Nouri Florals — orders', stage: 'won', expected_value_cents: 195000, converted_client_id: 'c-5', converted_at: ago(1), updated_at: ago(1) },
  ] },
  '/sales/receivables': RECEIVABLES,
  '/sales/my-tasks': { data: { partial: false, total: 3, items: [
    { kind: 'next_step', id: 'd-8', parent_id: 'd-8', title: 'Send the proposal', due: ymd(-2), context: 'Harbor Light Realty — site', href: '/pipeline.html?deal=d-8', blocked: false },
    { kind: 'deal_task', id: 'dt1', parent_id: 'd-9', title: 'Price the add-ons', due: ymd(0), context: 'Maple Row Pottery — shop', href: '/pipeline.html?deal=d-9', blocked: false },
    { kind: 'deal_task', id: 'dt2', parent_id: 'd-9', title: 'Order the photos', due: ymd(9), context: 'Maple Row Pottery — shop', href: '/pipeline.html?deal=d-9', blocked: false },
  ] } },
};

// ── 4. Send an update (broadcasts.html) ─────────────────────────────────────
const STD = { subject: 'Welcome to {{business_name}}', body: 'Hi {{first_name}},\n\nThanks for joining our list. You’ll hear from us now and then with news, offers and what’s new.\n\nReply to this email any time if you have a question.' };
const bc = (n: number, subject: string, status: string, over: Record<string, unknown> = {}) => ({
  id: `cccccccc-0000-4000-8000-00000000000${n}`, subject, audience: 'contacts', status, scheduled_at: null, sent_at: null,
  recipient_count: null, sent_count: null, skipped_count: null, failed_count: null, created_at: ago(n * 9), ...over,
});
export const BROADCASTS_API = {
  ...COMMON,
  '/broadcasts/segments': { data: { segments: [
    { key: 'subscribers', label: 'People who joined your list', description: 'Everyone who signed up with the “Join our list” box on your website.', count: 14 },
    { key: 'customers', label: 'Your customers', description: 'Everyone you’ve worked with.', count: 8 },
    { key: 'contacts', label: 'All contacts', description: 'Everyone saved in your contacts.', count: 42 },
    { key: 'enquiries', label: 'Website enquiries', description: 'Everyone who has messaged you through your website.', count: 17 },
    { key: 'list:aaaaaaaa-0000-4000-8000-000000000001', label: 'Spring promo', description: 'A list you made from Contacts.', count: 6 },
  ] } },
  '/broadcasts': { data: { broadcasts: [
    bc(1, 'November opening hours', 'draft', { created_at: ago(1) }),
    bc(2, 'Holiday gift cards', 'scheduled', { audience: 'customers', scheduled_at: new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000 + 6 * DAY).toISOString(), recipient_count: 8, created_at: ago(2) }),
    bc(3, 'Fall menu is here', 'sent', { audience: 'subscribers', sent_at: ago(9), recipient_count: 14, sent_count: 13, skipped_count: 1, failed_count: 0 }),
    bc(4, 'Thanks for a great summer', 'sent', { sent_at: ago(40), recipient_count: 42, sent_count: 40, skipped_count: 1, failed_count: 1 }),
    bc(5, 'Our new booking page', 'sent', { sent_at: ago(62), recipient_count: 39, sent_count: 39, skipped_count: 0, failed_count: 0 }),
    bc(6, 'Spring offer: 10% off', 'sent', { audience: 'list:aaaaaaaa-0000-4000-8000-000000000001', sent_at: ago(180), recipient_count: 6, sent_count: 6, skipped_count: 0, failed_count: 0 }),
    bc(7, 'Holiday hours', 'sent', { sent_at: ago(330), recipient_count: 31, sent_count: 30, skipped_count: 1, failed_count: 0 }),
  ] } },
  '/broadcasts/welcome': { data: {
    enabled: true, subject: '', body: '', updated_by: null, updated_at: null, sent: 14, last_sent_at: ago(3), standard: STD,
    subject_max: 200, body_max: 4000, reply_to: 'hello@brightstudio.example', words: { subject: STD.subject, body: STD.body },
  } },
  '/agency/update-templates': { data: [
    { id: 'dddddddd-0000-4000-8000-000000000001', name: 'Seasonal offer', subject: 'A seasonal offer from {{business_name}}', preview: 'Hi {{first_name}}, this season we have…', from_site: 'site-1', from_name: 'Quinn & Rowe Bakery', created_by: 'owner@example.com', created_at: ago(4) },
    { id: 'dddddddd-0000-4000-8000-000000000002', name: 'Holiday hours', subject: 'Our holiday hours', preview: 'Hi {{first_name}}, here’s when we’re open over the holidays.', from_site: 'site-6', from_name: 'Tanaka Family Dental', created_by: 'owner@example.com', created_at: ago(13) },
  ], available: true, can_manage: true, max: 50 },
};

// ── 5. Customers (its Cards display, the default) ───────────────────────────
export const CUSTOMERS_API = {
  ...COMMON,
  '/studio/customers': { data: CUSTOMERS },
  '/sales/receivables': RECEIVABLES,
  '/agency/kits': { data: [] },
};
