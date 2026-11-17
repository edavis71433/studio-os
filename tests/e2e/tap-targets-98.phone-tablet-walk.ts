// Builder item 98's tap-target walk borrows this spec's made-up fixtures, copied as they are from tests/e2e/phone-tablet-walk.spec.ts.
import { installApp, STUDIO_LEVEL_NAV, ALL_FEATURES } from './helpers/app';

// Sales list item 43 — the phone and tablet walk (Nov 2026). Home, Customers, a
// record, Pipeline and the Inbox were walked in the iOS Simulator's real Safari
// (iPhone 17 at 402px, iPad at 820px upright) with made-up data. What broke there
// is pinned here, at every project size:
//  · Inbox on an upright iPad: the split view left the reading pane ~180px wide —
//    the name ran over three lines, Resolve/Close sat on the chips, Send hung off
//    the edge. Under 1024px the panes now stack (list, then the conversation with
//    ← Inbox); the pane header and the reply row wrap instead of squeezing.
//  · On a 402px iPhone the same reply row put "… gets an email" one word per line
//    and pushed Send off the screen.
//  · The Inbox's view title spilled into "Send an update" where its column is 21rem.
//  · A touch screen of any width gets 44px controls — block 4 of shell.css only
//    reached phones, so an iPad's buttons, tabs, chips and drop-downs were 21–36px.
//  · Beside the sidebar the one-time tip centres on the content (it slid under it).
//  · The record's header kept a "·" at the end of a line when the email wrapped.

const ctx = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'view_all'],
  landing: '/agency.html', attention_count: 2, attention_stale: false, nav: STUDIO_LEVEL_NAV, plan_key: 'presence', upsell: null, scope: null,
} };

const INBOX = {
  '/portal/context': ctx,
  '/portal/feed': { data: {
    role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null, enquiries: [],
    client_messages: [
      { type: 'support', id: 's-1', subject: 'Logo files — please review the stacked one', status: 'open', priority: 'high', project: '', client_id: 'c-3', client: 'Juniper Floral Co.', created_at: '2026-07-14T00:00:00Z', thread_key: 'support:s-1', unread: true, href: '/projects.html?support=s-1' },
    ],
  } },
  '/forms/inbox': { data: { submissions: [], unread: 0 } },
  '/notifications': { data: [], unread_count: 0 },
  '/support/s-1': { data: {
    request: { id: 's-1', subject: 'Logo files — please review the stacked one', status: 'open', priority: 'high', body: 'The new logo looks great. Could we try the stacked version on the homepage before Friday?', created_at: '2026-07-14T00:00:00Z' },
    messages: [{ id: 'sm1', body: 'Absolutely — two options this afternoon.', author_kind: 'studio', created_at: '2026-07-14T01:00:00Z' }],
    is_studio_view: true,
  } },
};

const CLIENT = 'cccccccc-3333-4333-8333-cccccccccccc';
const DEAL = 'dddddddd-4444-4444-8444-dddddddddddd';
const RECORD = {
  '/portal/context': ctx,
  '/crm/record': { data: {
    identity: { contact_id: null, deal_id: DEAL, client_id: 'cl-1', customer_site_id: CLIENT, project_id: null },
    header: { name: 'Juniper Floral Co.', company: 'Juniper Floral Co.', email: 'ivy@juniperfloral.example', phone: '(555) 010-2299', status: 'customer' },
    highlights: {}, sections: { overview: true, messages: true, deal: true, delivery: false, details: true },
    default_tab: 'overview', canonical: { key: 'client', value: CLIENT },
  } },
  '/crm/activity': { data: {
    items: [
      { id: 'act:c1', kind: 'activity', type: 'call', title: 'You logged a call', body: 'Walked through the homepage.', at: '2026-07-10T00:00:00Z', meta: 'Logged call', href: null },
      { id: 'act:n1', kind: 'activity', type: 'note', title: 'You added a note', body: 'Prefers email in the mornings.', at: '2026-07-08T00:00:00Z', meta: 'Note', href: null },
    ],
    upcoming: [], deal_id: DEAL, reply_to: null, reply_support_to: null,
  } },
};

const coarse = (page: Page) => page.evaluate(() => matchMedia('(pointer:coarse)').matches);
const vw = (page: Page) => page.evaluate(() => document.documentElement.clientWidth);
async function rect(l: Locator) { const b = await l.boundingBox(); if (!b) throw new Error('not laid out'); return b; }
const overlaps = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;

export const RECORD_98 = RECORD;
export const RECORD_98_CLIENT = CLIENT;
