import { ALL_FEATURES } from '../../../../tests/e2e/helpers/app';

// buildNav (supabase/functions/presence/lib/navigation.ts) for a non-agency business_owner, every feature + capability.
const one = (key: string, label: string, href: string, utility = false) => ({ key, label, items: [{ key, label, href }], ...(utility ? { utility: true } : {}) });
export const REAL_NAV = [
  one('today', 'Today', '/today.html'),
  { key: 'website', label: 'Website', items: [
    { key: 'content', label: 'Website', href: '/presence.html' },
    { key: 'business_info', label: 'Business info', href: '/presence.html#business' },
    { key: 'design', label: 'Design', href: '/presence.html#design' },
    { key: 'publish', label: 'Publish', href: '/presence.html#publish' },
    { key: 'schedule', label: 'Scheduled publishes', href: '/schedule.html' },
    { key: 'history', label: 'History', href: '/presence.html#history' },
  ] },
  { key: 'customers', label: 'Customers', items: [
    { key: 'customers', label: 'Customers', href: '/customers.html' },
    { key: 'contacts', label: 'Contacts', href: '/contacts.html' },
    { key: 'leads', label: 'Enquiries', href: '/leads.html' },
    { key: 'broadcasts', label: 'Broadcasts', href: '/broadcasts.html' },
  ] },
  one('pipeline', 'Pipeline', '/pipeline.html'),
  one('projects', 'Projects', '/projects.html'),
  one('inbox', 'Inbox', '/inbox.html'),
  { key: 'files', label: 'Files', items: [{ key: 'files_all', label: 'Files', href: '/files.html' }, { key: 'files_visual', label: 'Visual Studio', href: '/visual-studio.html' }] },
  one('analytics', 'Analytics', '/analytics.html'),
  { key: 'focus_views', label: 'Focused views', utility: true, items: [
    { key: 'attention', label: 'Website attention', href: '/attention.html' },
    { key: 'approval_center', label: 'Approvals', href: '/approval-center.html' },
  ] },
  { key: 'views', label: 'Understand your site', utility: true, items: [
    { key: 'view_content_tree', label: 'Website map', href: '/content-tree.html' },
    { key: 'view_site_health', label: 'Website health', href: '/website-health.html' },
    { key: 'view_timeline', label: 'Website story', href: '/timeline.html' },
    { key: 'view_snapshots', label: 'Version history', href: '/snapshot-history.html' },
    { key: 'view_upcoming', label: 'What’s coming next', href: '/upcoming.html' },
    { key: 'view_insights', label: 'Business insights', href: '/business-insights.html' },
  ] },
  one('connections', 'Connections', '/connections.html', true),
  { key: 'settings', label: 'Settings', utility: true, items: [
    { key: 'settings', label: 'Settings', href: '/presence.html#settings' },
    { key: 'sharing', label: 'Sharing & access', href: '/sharing.html' },
    { key: 'developer', label: 'Developer Mode', href: '/developer.html' },
  ] },
  one('help', 'Help', '/help.html', true),
];

export const OWNER_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: false, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'],
  landing: '/today.html', attention_count: 2, nav: REAL_NAV, plan_key: 'presence', upsell: null,
} };

export const PRESENCE_API = {
  '/portal/context': OWNER_CTX,
  '/site': { data: { site: { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1 }, identity: { business_name: 'Marlow’s Kitchen', tagline: 'Neighbourhood kitchen' }, location: {} } },
  '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] },
  '/media': { data: [] }, '/settings': { data: { pages: [] } }, '/notes': { data: [] },
  '/health': { data: { state: 'healthy', sentence: 'Marlow’s Kitchen is live and healthy.' } },
  '/changes': { data: { count: 2, first_publish: false, changes: [{ section: 'hours', sentence: 'Your hours changed' }, { section: 'about', sentence: 'Your tagline changed' }], blockers: 0, warnings: 0, draft_hash: 'e2e-draft-hash' } },
  '/moments': { data: [] },
  '/dev/customization': { data: { theme_tokens: {}, custom_css: '', custom_html: '', allowed_tokens: [], can_edit_css: false, updated_at: null, updated_by: null } },
  '/schedule': { data: { scheduled: [] } },
  '/content-library': { data: [] },
  '/commerce/first-run': { data: { dismissed: true } },
  '/foundations': { data: { dns: { sentence: 'Your site is on its temporary address.', records: [] }, ssl: { sentence: 'The padlock is on.' }, email: { sentence: 'No email on a domain yet.', has_mail: false, spf: false, dmarc: false }, hosting: { sentence: 'Hosted on our fast network.' } } },
  '/foundations/plans': { data: [] },
  '/foundations/domain': { data: null },
  '/launch': { data: { launched: true, sentence: 'You’re live.', items: [] } },
  '/blocks/suggested': { data: { starters: [{ name: 'Services', description: 'A list of what you offer with prices.', blocks: [] }] } },
  '/publishes': { data: [] },
  '/preview/status': { data: {} },
};

// ── the managed client (portal.spec CLIENT_API + a moment, an open invoice with a pay link, a project thread) ──
export const PID = '11111111-1111-4111-8111-111111111111';
const ymd = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
export const CLIENT_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS',
  edition_features: ['website', 'client_portal'], is_agency: false, is_operator: false,
  sees_full_workspace: true, is_client_portal: false, is_managed_client: true, capabilities: ['view_all'],
  landing: '/client.html', attention_count: 1, nav: [{ key: 'client', label: 'Your updates', items: [{ key: 'feed', label: 'Updates', href: '/client.html' }] }],
} };
export const CLIENT_API = {
  '/portal/context': CLIENT_CTX,
  '/portal/feed': { data: { role: 'business_owner', moments: [{ id: 'm1', headline: 'Your new hours are live', summary: 'Published yesterday by your studio.' }], notices: [], pending_approvals: [], last_published: { created_at: '2026-10-18T00:00:00Z', completed_at: '2026-10-18T00:00:00Z' } } },
  '/client/notifications': { data: [
    { kind: 'approval_requested', label: 'Your approval is requested', href: `/projects/${PID}#approval-a1`, created_at: '2026-10-18T00:00:00Z', read: false },
  ], unread_count: 1 },
  '/client/projects': { data: [{ id: PID, name: 'Website redesign', status: 'active', target_date: ymd(30) }] },
  [`/client/projects/${PID}`]: { data: {
    project: { id: PID, name: 'Website redesign', status: 'active', target_date: ymd(30) },
    milestones: [
      { id: 'm1', title: 'Design', status: 'complete', completed_at: '2026-10-01T00:00:00Z', sort_order: 1 },
      { id: 'm2', title: 'Build', status: 'open', due_date: ymd(10), sort_order: 2 },
      { id: 'm3', title: 'Launch', status: 'open', sort_order: 3 },
    ],
    tasks: [{ id: 't1', title: 'Send your logo', status: 'open', client_action_required: true, derived: { overdue: false } }],
    events: [{ kind: 'deliverable_added', detail: { title: 'Homepage mockup' }, created_at: '2026-10-16T00:00:00Z' }],
    deliverables: [{ id: 'd1', title: 'Homepage mockup', note: 'First look', created_at: '2026-10-16T00:00:00Z' }],
    approvals: [{ id: 'a1', subject_type: 'deliverable', title: 'Homepage design', summary: 'The first mockup.', content_hash: 'h1', status: 'pending' }],
    surveys: [], progress: { total: 4, done: 1, pct: 25 },
  } },
  [`/client/projects/${PID}/report`]: { data: { summary: { progress: { total: 4, done: 1, pct: 25 }, milestones: { total: 3, complete: 1 }, open_client_actions: 1, overdue_tasks: 0, pending_approvals: 1, shared_files: 1, last_activity_at: '2026-10-16T00:00:00Z', csat: null } } },
  [`/client/projects/${PID}/messages`]: { data: [{ id: 'mg1', body: 'Here is the first homepage mockup — tell us what you think.', author_kind: 'staff', created_at: '2026-10-16T00:00:00Z' }] },
  '/client/support': { data: [] },
  '/client/documents': { data: { documents: [] } },
  '/client/billing': { data: { billing_type: 'service', invoices: [{ id: 'i1', name: 'Design phase', amount: 1200, status: 'open', due_date: ymd(5), pay_url: 'https://pay.example/i1', created_at: '2026-10-10T00:00:00Z' }], summary: { open_count: 1, paid_count: 0 } } },
};

export const SIGNUP_API = {
  '/commerce/plans': { data: { trial_days: 14, plans: [{ key: 'presence', name: 'Presence', tagline: 'Your website, handled.', self_serve: true, trial_eligible: true, price: { monthly: 49, annual: 490 }, features: ['Your website', 'Enquiries', 'Bookings'] }] } },
  '/commerce/signup': { data: { mode: 'trial' } },
  '/identity': { data: { business_name: 'Marlow’s Kitchen' } },
  '/writer/generate': { data: { ok: true } },
  '/writer/drafts': { data: [] },
};
