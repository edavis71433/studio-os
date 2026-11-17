// Builder item 98's tap-target walk borrows this spec's made-up fixtures, copied as they are from tests/e2e/inbox.spec.ts.
import { installApp } from './helpers/app';
import { headerAction } from './helpers/page-header';

// Inbox — the split-view console (redesign slice 2). List pane of every
// conversation (client messages · support · enquiries · approvals) with REAL
// per-thread unread dots; reading pane renders the selection in place.
// Hermetic: fixtures below stand in for /portal/feed (with the slice-2
// client_messages/enquiries additions), /crm/activity, and /support/:id.

const FEED = { data: {
  role: 'business_owner',
  moments: [{ id: 'm1', headline: 'Add your holiday hours', summary: 'Customers check before they visit.', moment_type: 'reminder', created_at: '2026-07-01T00:00:00Z' }],
  notices: [{ id: 'n1', kind: 'lead_followup', headline: 'A quote request is waiting for a reply', body: '', href: '/inbox.html#enquiries' }],
  pending_approvals: [{ id: 'p1', kind: 'infrastructure', title: 'Protect your email', summary: 'Add email authentication.', decide_path: '/foundations/plans/p1/decide' }],
  last_published: null,
  client_messages: [
    { type: 'message', project: 'Site build', project_id: 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa', client_id: 'c-1', client: 'Marlow’s Kitchen', created_at: '2026-07-15T00:00:00Z', needs_reply: true, count: 3, thread_key: 'client:c-1', unread: true, href: '/crm.html?project=aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa&tab=messages' },
    { type: 'support', id: 's-1', subject: 'Logo tweak', status: 'open', project: '', client_id: 'c-1', client: 'Marlow’s Kitchen', created_at: '2026-07-14T00:00:00Z', thread_key: 'support:s-1', unread: true, href: '/projects.html?support=s-1' },
  ],
  enquiries: [
    { id: 'l-9', form_kind: 'quote', name: 'Sam Rivera', email: 'sam@example.com', phone: '', message: 'Can I get a quote for a patio?', status: 'new', created_at: '2026-07-13T00:00:00Z', thread_key: 'lead:l-9', unread: true },
  ],
} };

const API = {
  '/portal/feed': FEED,
  // the Enquiries view's queue (GET /forms/inbox) — the same enquiry the feed
  // carries, so a row picked in either view is the same enquiry (l-9)
  '/forms/inbox': { data: { submissions: [
    { id: 'l-9', form_kind: 'quote', name: 'Sam Rivera', email: 'sam@example.com', phone: '', message: 'Can I get a quote for a patio?', source_page: '/contact/', status: 'new', created_at: '2026-07-13T00:00:00Z' },
  ], unread: 1 } },
  '/notifications': { data: [
    { kind: 'milestone_done', label: 'Milestone reached — Design', href: '/projects/aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa', project_id: 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa', created_at: '2026-07-10T00:00:00Z', read: false },
  ], unread_count: 1 },
  '/crm/activity': { data: {
    upcoming: [],
    items: [
      { id: 'i1', kind: 'message', type: 'message', title: 'The client sent a message', body: 'Hello — how is it going?', at: '2026-07-15T00:00:00Z', meta: null, href: null },
      { id: 'i2', kind: 'activity', type: 'call', title: 'You logged a call', body: null, at: '2026-07-11T00:00:00Z', meta: 'Logged call', href: null },
    ],
    reply_to: '/projects/aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa/messages', reply_support_to: null,
  } },
  '/support/s-1': { data: {
    request: { id: 's-1', subject: 'Logo tweak', status: 'open', body: 'Please tweak the logo', created_at: '2026-07-14T00:00:00Z' },
    messages: [{ id: 'sm1', body: 'Can we make it bigger?', author_kind: 'client', created_at: '2026-07-14T01:00:00Z' }],
    is_studio_view: true,
  } },
  // the saves these tests make, answered as the server answers them (builder item 212)
  'POST /projects/aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa/messages': { data: { id: 'pm-new', project_id: 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa', audience: 'client', body: 'On it — draft coming today.', author_kind: 'client', created_at: '2026-07-15T01:00:00Z' } },
  'POST /support/s-1/messages': { data: { id: 'sm-new', request_id: 's-1', body: 'Done — take a look.', author_kind: 'client', created_at: '2026-07-15T01:00:00Z' } },
  'PATCH /support/s-1': { data: { id: 's-1', subject: 'Logo tweak', status: 'resolved', resolved_at: '2026-07-15T01:00:00Z' } },
  'POST /foundations/plans/p1/decide': { data: { id: 'p1', status: 'approved' } },
  'POST /forms/inbox/l-9': { data: { ok: true } },
};

export const INBOX_98 = API;
