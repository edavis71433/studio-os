import { ALL_FEATURES } from '../../../../../tests/e2e/helpers/app';
import { REAL_NAV, PRESENCE_API } from '../../walks/fixtures';

// ── The STUDIO personas (docs/design/STUDIO-AUDIT-2026-10.md) ────────────────
// buildNav (supabase/functions/presence/lib/navigation.ts) for an AGENCY member
// at studio level (isAgency, not scoped): Today · Customers ▸ · Pipeline ·
// Projects · Inbox · Files ▸ · Analytics · Studio; overflow: Your website ▸,
// Connections, Settings ▸, Help. Copied by hand from buildNav on main dfcf28d.
const one = (key: string, label: string, href: string, utility = false, desc?: string) => ({ key, label, items: [{ key, label, href, ...(desc ? { desc } : {}) }], ...(utility ? { utility: true } : {}) });
const websiteItems = REAL_NAV.find((s) => s.key === 'website')!.items;
export const AGENCY_NAV = [
  one('today', 'Today', '/today.html'),
  { key: 'customers', label: 'Customers', items: [
    { key: 'customers', label: 'Customers', href: '/customers.html', desc: 'Every customer, with their deal, billing, project, files and messages on one record.' },
    { key: 'contacts', label: 'Contacts', href: '/contacts.html', desc: 'The people — one may belong to a customer.' },
    { key: 'broadcasts', label: 'Broadcasts', href: '/broadcasts.html' },
  ] },
  one('pipeline', 'Pipeline', '/pipeline.html', false, 'Deals by stage — proposals, agreements and payments move through here.'),
  one('projects', 'Projects', '/projects.html'),
  one('inbox', 'Inbox', '/inbox.html', false, 'The one place for everything that needs you — messages, approvals, notices, and new enquiries.'),
  { key: 'files', label: 'Files', items: [{ key: 'files_all', label: 'Files', href: '/files.html' }, { key: 'files_visual', label: 'Visual Studio', href: '/visual-studio.html' }] },
  one('analytics', 'Analytics', '/analytics.html'),
  one('studio', 'Studio', '/agency.html'),
  { key: 'website', label: 'Your website', items: websiteItems, utility: true },
  one('connections', 'Connections', '/connections.html', true),
  { key: 'settings', label: 'Settings', utility: true, items: [
    { key: 'settings', label: 'Settings', href: '/settings.html' },
    { key: 'sharing', label: 'Sharing & access', href: '/sharing.html' },
    { key: 'developer', label: 'Developer Mode', href: '/developer.html' },
  ] },
  one('help', 'Help', '/help.html', true),
];

export const CAPS = ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all', 'bulk_publish'];
export const AGENCY_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: CAPS, landing: '/agency.html', attention_count: 3, nav: AGENCY_NAV, plan_key: 'agency', upsell: null,
} };

// Drilled into ONE client (?client=<site>): the client's Website is primary again, no Studio item; the shell paints the context bar.
export const MARLOW_SITE = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
export const DENTAL_SITE = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
export const CEDAR_SITE = 'cccccccc-3333-4333-8333-cccccccccccc';
export const SCOPED_CTX = (name = 'Marlow’s Kitchen', site = MARLOW_SITE) => ({ data: {
  ...AGENCY_CTX.data, landing: '/today.html', nav: REAL_NAV, attention_count: 2, scope: { site_id: site, name },
} });

// ── the agency's portfolio (agency.spec's real row shape) ────────────────────
const soon = new Date(Date.now() + 12 * 86400_000).toISOString();
const far = new Date(Date.now() + 200 * 86400_000).toISOString();
const row = (over: Record<string, unknown>) => ({
  site_id: '', name: '', edition: 'presence', status: 'ready', archived: false, tags: [], owner: 'owner@studio.example', assigned: [], has_notes: false,
  domain: null, domain_registrar: null, domain_expires_at: null, moments: 0, criticals: 0, open_opportunities: 0, plans_waiting: 0, drafts_waiting: 0,
  leads_waiting: 0, files_pending: 0, search_issues: 0, billing_issue: false, attention: 0, review_open: false, migration: null,
  last_published_at: '2026-10-05T00:00:00Z', unpublished_changes: false, last_change_at: null, ...over,
});
export const PORTFOLIO = [
  row({ site_id: MARLOW_SITE, name: 'Marlow’s Kitchen', attention: 4, leads_waiting: 2, domain: 'marlowskitchen.com', domain_registrar: 'GoDaddy.com, LLC', domain_expires_at: soon, search_issues: 1, billing_issue: true, plans_waiting: 1, unpublished_changes: true }),
  row({ site_id: DENTAL_SITE, name: 'Bright Dental', domain: 'brightdental.com', domain_expires_at: far }),
  row({ site_id: CEDAR_SITE, name: 'Cedar Garage', leads_waiting: 1, domain: 'cedargarage.com', domain_expires_at: far }),
];

export const PID = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee';   // Marlow's delivery project (on the agency's own site)
export const DEAL = 'dddddddd-4444-4444-8444-dddddddddddd';
export const DEAL2 = '22222222-2222-4222-8222-222222222222';
const past = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
const ymd = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

export const CUSTOMERS = { data: [
  { client_id: 'c-marlow', name: 'Marlow’s Kitchen', email: 'ana@marlowskitchen.com', status: 'active', customer_site_id: MARLOW_SITE, project_id: PID, open_support: 1, project_count: 1 },
  { client_id: 'c-dental', name: 'Bright Dental', email: 'hi@brightdental.com', status: 'active', customer_site_id: DENTAL_SITE, project_id: null, open_support: 0, project_count: 0 },
  { client_id: 'c-cedar', name: 'Cedar Garage', email: 'ray@cedargarage.com', status: 'active', customer_site_id: CEDAR_SITE, project_id: null, open_support: 0, project_count: 0 },
] };

export const DEAL_DETAIL = { data: {
  deal: { id: DEAL, title: 'Cedar Garage — new website', stage: 'proposal', expected_value_cents: 500000, expected_close: ymd(20), next_step: 'Send the proposal', next_step_at: ymd(0), notes: '', contact_id: 'ct-1', converted_client_id: null, retainer: null },
  contact: { id: 'ct-1', name: 'Ray Cedar', email: 'ray@cedargarage.com', phone: '', company: 'Cedar Garage', notes: '' },
  proposals: [{ id: 'pr1', title: 'Website build', status: 'draft', version: 1, total_cents: 500000, created_at: past(1), items: [{ name: 'Website build', price_cents: 500000, qty: 1 }] }],
  contracts: [{ id: 'k1', title: 'Service agreement', status: 'draft', version: 1, created_at: past(1), body: 'A non-refundable deposit of 50% is due before work begins.' }],
  events: [], timeline: [], invoices: [], last_contacted_at: past(3),
} };
export const WON_DEAL = '88888888-8888-4888-8888-888888888888';
export const WON_DETAIL = { data: {
  deal: { id: WON_DEAL, title: 'Bright Dental — redesign', stage: 'won', expected_value_cents: 800000, expected_close: ymd(-2), next_step: null, next_step_at: null, notes: '', contact_id: 'ct-2', converted_client_id: null, retainer: null },
  contact: { id: 'ct-2', name: 'Dr. Priya Shah', email: 'hi@brightdental.com', phone: '', company: 'Bright Dental', notes: '' },
  proposals: [{ id: 'pr2', title: 'Redesign', status: 'accepted', version: 1, total_cents: 800000, created_at: past(9), accepted_at: past(3) }],
  contracts: [{ id: 'k2', title: 'Service agreement', status: 'signed', version: 1, created_at: past(8), signed_at: past(2), signer_name: 'Priya Shah' }],
  events: [], timeline: [], invoices: [], last_contacted_at: past(2),
} };

export const FEED = { data: {
  role: 'business_owner', moments: [], last_published: null,
  notices: [{ id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', kind: 'lead_followup', period: 'lead:l1', dismissible: true, headline: 'A quote request is waiting for a reply', body: 'Sam reached out about a day ago.', href: '/inbox.html#enquiries' }],
  pending_approvals: [],
  client_messages: [
    { type: 'message', project: 'Website redesign', project_id: PID, client_id: 'c-marlow', client: 'Marlow’s Kitchen', created_at: past(0.2), needs_reply: true, count: 3, thread_key: 'client:c-marlow', unread: true, href: `/crm.html?project=${PID}&tab=messages` },
    { type: 'support', id: 's-1', subject: 'Change our Saturday hours', status: 'open', project: '', client_id: 'c-dental', client: 'Bright Dental', created_at: past(1), thread_key: 'support:s-1', unread: true, href: '/projects.html?support=s-1' },
  ],
  enquiries: [{ id: 'l1', form_kind: 'quote', name: 'Sam Rivera', email: 'sam@example.com', phone: '', message: 'Can I get a quote for a patio?', status: 'new', created_at: past(1), thread_key: 'lead:l1', unread: true }],
} };

export const HC = { data: { overall: 'attention', areas: [
  { key: 'platform', label: 'Platform', state: 'ok', detail: 'All required configuration is present.' },
  { key: 'cron', label: 'Scheduled operations', state: 'ok', detail: 'Running on schedule.' },
  { key: 'domains', label: 'Domains', state: 'attention', detail: '1 expiring within 30 days.' },
  { key: 'billing', label: 'Billing', state: 'attention', detail: '1 with payment trouble, 0 lapsed.' },
  { key: 'ai', label: 'AI', state: 'ok', detail: 'Configured.' },
  { key: 'email', label: 'Email delivery', state: 'ok', detail: 'Configured — notices and receipts can send.' },
  { key: 'usage', label: 'Usage', state: 'ok', detail: '3 sites live.' },
  { key: 'errors', label: 'Errors', state: 'ok', detail: 'No recent failures.' },
  { key: 'alerts', label: 'Alerts', state: 'ok', detail: 'Nothing outstanding.' },
  { key: 'backups', label: 'Backups & recovery', state: 'ok', detail: 'Backups on; last restore drill confirmed.' },
] } };

export const CONNECTIONS = { data: {
  edition: 'presence',
  note: 'Connect the services you already use — read-only, always with your approval, and yours to disconnect any time.',
  groups: { 'Being found': [
    { key: 'google_search_console', label: 'how you show up in Google Search', purpose: 'See which searches bring people to you, and whether Google can find your pages.',
      reads: ['the searches that lead to you'], approval: 'You approve access on the provider’s sign-in screen.', availability: 'Read-only',
      connection: { status: 'disconnected', health: 'unknown', last_sync_at: null, connected_at: null, reason: '' }, data: null },
  ], 'Your numbers': [
    { key: 'google_analytics', label: 'your visitor numbers', purpose: 'Understand how many people visit and what they look at — in plain numbers.',
      reads: ['visitors and page views'], approval: 'You approve access on the provider’s sign-in screen.', availability: 'Read-only',
      connection: { status: 'disconnected', health: 'unknown', last_sync_at: null, connected_at: null, reason: '' }, data: null },
  ] },
} };

// The record for Marlow's (crm.spec's hub shape) + the project record (projects.spec's shape)
export const RECORD = { data: {
  identity: { contact_id: null, deal_id: null, client_id: 'c-marlow', customer_site_id: MARLOW_SITE, project_id: PID },
  header: { name: 'Marlow’s Kitchen', company: '', email: 'ana@marlowskitchen.com', phone: '', status: 'customer' },
  highlights: {}, sections: { overview: true, messages: true, deal: false, delivery: true, details: true }, default_tab: 'overview',
  canonical: { key: 'project', value: PID },
} };
export const RECORD_DEAL = { data: {
  identity: { contact_id: 'ct-1', deal_id: DEAL, client_id: null, customer_site_id: null, project_id: null },
  header: { name: 'Cedar Garage', company: 'Cedar Garage', email: 'ray@cedargarage.com', phone: '', status: 'deal' },
  highlights: {}, sections: { overview: true, messages: false, deal: true, delivery: false, details: true }, default_tab: 'overview',
  canonical: { key: 'deal', value: DEAL },
} };
export const PROJECT = { data: {
  project: { id: PID, name: 'Website redesign', status: 'active', client_visible: true, client_id: 'c-marlow', target_date: ymd(30) },
  milestones: [{ id: 'm1', title: 'Kickoff', status: 'complete', client_visible: true, due_date: ymd(-10) }, { id: 'm2', title: 'Design', status: 'open', client_visible: true, due_date: ymd(10) }],
  tasks: [{ id: 't1', title: 'Collect content', status: 'todo', client_visible: true, client_action_required: true, due_date: ymd(5), derived: { overdue: false } }],
  deliverables: [{ id: 'd1', title: 'Homepage mock', status: 'shared', client_visible: true }],
  approvals: [], progress: { pct: 33, done: 1, total: 3 }, is_studio_view: true,
} };
export const ACTIVITY = { data: {
  upcoming: [],
  items: [{ id: 'i1', kind: 'message', type: 'message', title: 'Ana sent a message', body: 'Can we move the Saturday hours to 9–5?', at: past(0.2), meta: null, href: null }],
  reply_to: `/projects/${PID}/messages`, reply_support_to: null,
} };

// ── everything the studio-level pages read ───────────────────────────────────
export const STUDIO_API: Record<string, unknown> = {
  '/portal/context': AGENCY_CTX,
  '/agency/me': { data: { agency: 'Bright Studio', role: 'owner', plan: 'agency', branding: {} } },
  '/agency/portfolio': { data: PORTFOLIO },
  '/agency/queues': { data: { queues: [
    { key: 'high_priority', title: 'High priority', items: [{ site_id: MARLOW_SITE, name: 'Marlow’s Kitchen', why: 'billing needs a look · 2 leads waiting' }] },
    { key: 'leads', title: 'Leads waiting', items: [{ site_id: MARLOW_SITE, name: 'Marlow’s Kitchen', why: '2 leads waiting' }, { site_id: CEDAR_SITE, name: 'Cedar Garage', why: '1 lead waiting' }] },
  ], patterns: [] } },
  '/agency/kits': { data: [{ id: 'kit1', name: 'Restaurant starter' }] },
  '/studio/customers': CUSTOMERS,
  '/admin/health-center': HC,
  '/portal/feed': FEED,
  '/notifications': { data: [], unread_count: 0 },
  '/forms/inbox': { data: { submissions: [{ id: 'l1', form_kind: 'quote', name: 'Sam Rivera', email: 'sam@example.com', phone: '', message: 'Can I get a quote for a patio?', source_page: '/contact/', status: 'new', created_at: past(1) }], unread: 1 } },
  '/crm/activity': ACTIVITY,
  '/crm/record': RECORD,
  '/crm/profile': { data: { profile: { business_name: 'Marlow’s Kitchen', health: 'attention', live: true }, summary: 'Marlow’s Kitchen’s website is live.', is_studio_view: true, last_activity_at: past(0.2) } },
  '/crm/notes': { data: { notes: [], can_write_internal: true } },
  '/crm/timeline': { data: { items: [], is_studio_view: true } },
  '/crm/messages': { data: { items: [], reply_to: `/projects/${PID}/messages` } },
  '/sales/deals': { data: [
    { id: DEAL, title: 'Cedar Garage — new website', stage: 'proposal', source: 'manual', expected_value_cents: 500000, expected_close: ymd(20), contact_id: 'ct-1', converted_client_id: null, updated_at: past(1), next_step: 'Send the proposal', next_step_at: ymd(0), last_contacted_at: past(3), agreement_signed: false },
    { id: WON_DEAL, title: 'Bright Dental — redesign', stage: 'won', source: 'enquiry', expected_value_cents: 800000, expected_close: ymd(-2), contact_id: 'ct-2', converted_client_id: null, updated_at: past(2), next_step: null, next_step_at: null, last_contacted_at: past(2), agreement_signed: true },
  ] },
  [`/sales/deals/${DEAL}`]: DEAL_DETAIL, [`/sales/deals/${DEAL}/tasks`]: { data: [] },
  [`/sales/deals/${WON_DEAL}`]: WON_DETAIL, [`/sales/deals/${WON_DEAL}/tasks`]: { data: [] },
  '/sales/summary': { data: { total: 2, open: { count: 1, value_cents: 500000 }, won_month: { count: 1, value_cents: 800000 }, win_rate: { pct: 50, won: 1, lost: 1 }, by_stage: [{ label: 'Proposal sent', count: 1, value_cents: 500000 }, { label: 'Won', count: 1, value_cents: 800000 }], ar: { outstanding_cents: 120000, overdue_cents: 0, count: 1 } } },
  '/sales/contacts': { data: [{ id: 'ct-1', name: 'Ray Cedar', email: 'ray@cedargarage.com', phone: '', company: 'Cedar Garage', updated_at: past(1) }, { id: 'ct-2', name: 'Dr. Priya Shah', email: 'hi@brightdental.com', phone: '', company: 'Bright Dental', updated_at: past(2) }] },
  '/sales/templates': { data: [] }, '/sales/services': { data: [] },
  '/sales/receivables': { data: { items: [{ id: 'inv1', title: 'Design phase', amount_cents: 120000, status: 'open', client: 'Marlow’s Kitchen', due_date: ymd(5) }], total_cents: 120000 } },
  '/sales/customers': { data: { invited: true, portal_url: 'https://davisdigitalstudio.com/portal.html', client_id: 'c-new' } },
  '/identity': { data: { site_id: 'agency-site', business_name: 'Bright Studio', email: 'hello@brightstudio.example', phone: '', service_area: 'Burbank, CA', tagline: '', description: '', story: '', booking_url: '', ordering_url: '', social: {}, seo_title: '', seo_description: '' } },
  '/settings': { data: { industry_key: 'web_design', pages: [] } },
  '/connections': CONNECTIONS,
  '/commerce/subscription': { data: { plan_name: 'Agency', status: 'active', can_manage_billing: true } },
  '/portal/members': { data: [{ id: 'm-0', email: 'eric@brightstudio.example', role: 'business_owner', status: 'active' }] },
  '/portal/shares': { data: { shares: [] } },
  '/projects': { data: [
    { id: PID, name: 'Website redesign', status: 'active', client_visible: true, client_id: 'c-marlow', deal_id: null, start_date: null, target_date: ymd(30), updated_at: past(0.5) },
  ], is_studio_view: true },
  [`/projects/${PID}`]: PROJECT,
  [`/projects/${PID}/report`]: { data: { summary: { progress: { pct: 33, done: 1, total: 3 }, milestones: { complete: 1, total: 2 }, open_client_actions: 1, pending_approvals: 0, shared_files: 1 } } },
  [`/projects/${PID}/messages`]: { data: [] }, [`/projects/${PID}/surveys`]: { data: [] },
  [`/projects/${PID}/client-messages`]: { data: [], customer: { name: 'Marlow’s Kitchen' } },
  '/support': { data: [] },
  '/support/s-1': { data: { request: { id: 's-1', subject: 'Change our Saturday hours', status: 'open', body: 'Can you change Saturday to 9–5?', created_at: past(1) }, messages: [{ id: 'sm1', body: 'Can you change Saturday to 9–5?', author_kind: 'client', created_at: past(1) }], is_studio_view: true } },
  '/moments': { data: [] },
  '/analytics/dashboard': { data: {} },
};

// The SAME API with the builder's reads for a drilled client (presence.html?client=…) — the context swaps by header in walk.ts.
export const SCOPED_API: Record<string, unknown> = { ...STUDIO_API, ...PRESENCE_API, '/portal/context': SCOPED_CTX(), '/portal/feed': FEED, '/forms/inbox': STUDIO_API['/forms/inbox'] };
