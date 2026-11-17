// Made-up fixtures for the tap walk over builder item 241's parts (PR 466): a customer's
// steps card on their profile (Create website, Invite to their portal, a site that lives
// somewhere else), the Delete customer box, and Delete customer… in Customers' preview.
// Copied from tests/e2e/customers-241.spec.ts; every name is made up.
export const CID = 'cccccccc-2410-4241-8241-cccccccccccc';
const SITE = 'eeeeeeee-2410-4241-8241-eeeeeeeeeeee';
export const state = (over: Record<string, unknown> = {}) => ({ data: {
  client_id: CID, business_name: 'Willow & Ash Bakery', person: { name: 'Maya Ortiz', email: 'maya@willowash.example', company: 'Willow & Ash Bakery' },
  website: { state: 'none', site_id: null, address: null, live: false, last_published_at: null, in_trash: false },
  portal: { state: 'none', email: 'maya@willowash.example', invited_at: null, seen_at: null },
  offers: { create_website: true, invite: true, invite_again: false, delete: true, can_manage_sites: true },
  ...over,
} });
export const WITH_SITE = state({
  website: { state: 'ours', site_id: SITE, address: 'https://willowash.example', live: true, last_published_at: '2026-11-10T12:00:00Z', in_trash: false },
  offers: { create_website: false, invite: true, invite_again: false, delete: true, can_manage_sites: true },
});
const RECORD = { data: {
  identity: { contact_id: null, deal_id: null, client_id: CID, customer_site_id: null, project_id: null },
  header: { name: 'Willow & Ash Bakery', person: 'Maya Ortiz', company: 'Willow & Ash Bakery', email: 'maya@willowash.example', phone: '', status: 'customer' },
  highlights: {}, sections: { overview: false, messages: true, deal: false, delivery: false, details: false },
  default_tab: 'details', canonical: { key: 'contact', value: '' }, related_projects: [], related_deals: [],
} };
export const PROFILE_241 = (over: Record<string, unknown> = {}) => ({
  '/crm/record': RECORD,
  '/crm/activity': { data: { items: [], upcoming: [], project_id: null, deal_id: null, reply_to: null, reply_support_to: null } },
  '/sales/stages': { data: { chances: {} } },
  [`/sales/customers/${CID}`]: state(),
  ...over,
});
const ROW = { client_id: CID, name: 'Willow & Ash Bakery', person_name: 'Maya Ortiz', email: 'maya@willowash.example', project_id: 'pppppppp-2410-4241-8241-pppppppppppp', project_name: 'Willow & Ash Bakery', status: 'active', customer_site_id: null, open_support: 0, project_count: 1 };
export const CUSTOMERS_241 = {
  '/studio/customers': { data: [ROW] }, '/sales/receivables': { data: { items: [], total_cents: 0 } },
  '/crm/record': RECORD, '/crm/activity': { data: { items: [], upcoming: [] } },
  [`/sales/customers/${CID}`]: state(),
};
