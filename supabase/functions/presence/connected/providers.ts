// ── The connected-provider registry (L4.0) ──────────────────────────────────
// Every external platform Studio OS will speak to, declared as DATA behind the
// one contract. Adding a provider is appending here — never a new architecture.
// Read-only first: `reads` is what a shipped adapter observes; `futureWrites` is
// declared (so the write architecture is provably supportable) but built by NO
// adapter at L4.0 — every `status` is 'planned'.
//
// Scopes are the least-privilege permissions we would request — the smallest set
// that satisfies `reads`. They are declared here so consent is honest before a
// single token is ever minted.
import type { ConnectedProvider } from './contract.ts';

export const CONNECTED_PROVIDERS: readonly ConnectedProvider[] = [
  // ── Search ──────────────────────────────────────────────────────────────
  { key: 'google_search_console', name: 'Google Search Console', customerLabel: 'how you show up in Google Search',
    category: 'search', purpose: 'See which searches bring people to you, and whether Google can find your pages.',
    auth: 'oauth2', approval: 'oauth_consent', scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],   // AN-3.1: full scope URL (Google rejects the short form)
    reads: ['the searches that lead to you', 'how often you appear and get clicked', 'pages Google has trouble reading'],
    futureWrites: ['submit a sitemap', 'ask Google to re-check a page'], minEdition: 'presence_monitor',
    rateNote: 'generous daily quota; observed on a gentle schedule', status: 'planned' },
  { key: 'bing_webmaster', name: 'Bing Webmaster Tools', customerLabel: 'how you show up in Bing',
    category: 'search', purpose: 'The same visibility picture for Bing and the assistants that use it.',
    auth: 'api_key', approval: 'api_key_entry', scopes: ['webmaster.read'],
    reads: ['search terms and clicks on Bing', 'indexing status'], futureWrites: ['submit a sitemap'],
    minEdition: 'presence_monitor', rateNote: 'modest quota; low-frequency reads', status: 'planned' },

  // ── Local listings ────────────────────────────────────────────────────────
  { key: 'google_business_profile', name: 'Google Business Profile', customerLabel: 'your Google listing',
    category: 'local_listing', purpose: 'Keep your Google listing — hours, phone, photos, reviews — correct and current.',
    auth: 'oauth2', approval: 'oauth_consent', scopes: ['business.manage'],
    reads: ['your listing details and hours', 'reviews and their replies', 'how many people called or asked directions'],
    futureWrites: ['update hours and details', 'reply to a review', 'publish a post'], minEdition: 'presence_monitor',
    rateNote: 'per-minute limits; batched, backed-off', status: 'planned' },
  { key: 'apple_business_connect', name: 'Apple Business Connect', customerLabel: 'your place on Apple Maps',
    category: 'local_listing', purpose: 'Make sure people on iPhones and Siri find the right you.',
    auth: 'ownership_verification', approval: 'ownership_verification', scopes: ['place.read'],
    reads: ['your Apple place card details', 'whether it is claimed and verified'], futureWrites: ['update the place card'],
    minEdition: 'presence_monitor', rateNote: 'low-frequency; verification-gated', status: 'planned' },

  // ── Analytics ─────────────────────────────────────────────────────────────
  { key: 'google_analytics', name: 'Google Analytics', customerLabel: 'your visitor numbers',
    category: 'analytics', purpose: 'Understand how many people visit and what they look at — in plain numbers.',
    auth: 'oauth2', approval: 'oauth_consent', scopes: ['analytics.readonly'],
    reads: ['visitors and page views', 'your busiest pages', 'where visitors come from'], futureWrites: [],
    minEdition: 'presence_monitor', rateNote: 'token-bucket quota; cached reads', status: 'planned' },
  { key: 'google_tag_manager', name: 'Google Tag Manager', customerLabel: 'your website tags',
    category: 'analytics', purpose: 'See what measurement tags are on your site, and keep them tidy.',
    auth: 'oauth2', approval: 'oauth_consent', scopes: ['tagmanager.readonly'],
    reads: ['which tags and trackers are installed'], futureWrites: ['add or remove a measurement tag'],
    minEdition: 'presence', rateNote: 'low-frequency config reads', status: 'planned' },

  // ── Social ────────────────────────────────────────────────────────────────
  { key: 'meta_business', name: 'Meta Business', customerLabel: 'your Facebook & Instagram business',
    category: 'social', purpose: 'One connection to the Facebook and Instagram side of your business.',
    auth: 'oauth2', approval: 'oauth_consent', scopes: ['business_management'],
    reads: ['which pages and accounts you manage'], futureWrites: [], minEdition: 'presence',
    rateNote: 'app-level rate limits; pooled', status: 'planned' },
  { key: 'facebook_page', name: 'Facebook Page', customerLabel: 'your Facebook page',
    category: 'social', purpose: 'Keep an eye on your Facebook page and, later, post to it from here.',
    auth: 'oauth2', approval: 'oauth_consent', scopes: ['pages_read_engagement'],
    reads: ['recent posts and how they did', 'page followers'], futureWrites: ['publish a post'],
    minEdition: 'presence', rateNote: 'per-page limits; backed-off', status: 'planned' },
  { key: 'instagram', name: 'Instagram', customerLabel: 'your Instagram',
    category: 'social', purpose: 'See how your Instagram is doing and, later, share to it from here.',
    auth: 'oauth2', approval: 'oauth_consent', scopes: ['instagram_basic'],
    reads: ['recent posts and reach'], futureWrites: ['publish a post'], minEdition: 'presence',
    rateNote: 'per-user hourly limits', status: 'planned' },
  { key: 'linkedin', name: 'LinkedIn', customerLabel: 'your LinkedIn page',
    category: 'social', purpose: 'For businesses whose customers live on LinkedIn.',
    auth: 'oauth2', approval: 'oauth_consent', scopes: ['r_organization_social'],
    reads: ['company page posts and followers'], futureWrites: ['post an update'], minEdition: 'presence',
    rateNote: 'daily throttles; low-frequency', status: 'planned' },
  { key: 'youtube', name: 'YouTube', customerLabel: 'your YouTube channel',
    category: 'social', purpose: 'See how your videos are doing.',
    auth: 'oauth2', approval: 'oauth_consent', scopes: ['youtube.readonly'],
    reads: ['videos and their view counts', 'channel subscribers'], futureWrites: [], minEdition: 'presence',
    rateNote: 'daily quota units; cached', status: 'planned' },

  // ── Reviews ───────────────────────────────────────────────────────────────
  { key: 'yelp', name: 'Yelp', customerLabel: 'your Yelp reviews',
    category: 'reviews', purpose: 'Watch your Yelp rating and what people are saying.',
    auth: 'api_key', approval: 'api_key_entry', scopes: ['business.read'],
    reads: ['your rating and review count', 'recent reviews'], futureWrites: [], minEdition: 'presence_monitor',
    rateNote: 'daily call cap; low-frequency', status: 'planned' },
  { key: 'trustpilot', name: 'Trustpilot', customerLabel: 'your Trustpilot reviews',
    category: 'reviews', purpose: 'Keep an eye on your Trustpilot standing.',
    auth: 'api_key', approval: 'api_key_entry', scopes: ['reviews.read'],
    reads: ['rating and recent reviews'], futureWrites: ['reply to a review'], minEdition: 'presence',
    rateNote: 'plan-based quota', status: 'planned' },

  // ── Scheduling ────────────────────────────────────────────────────────────
  { key: 'google_calendar', name: 'Google Calendar', customerLabel: 'your appointments',
    category: 'scheduling', purpose: 'So your website can show real availability and, later, take bookings.',
    auth: 'oauth2', approval: 'oauth_consent', scopes: ['calendar.readonly'],
    reads: ['your free/busy availability', 'upcoming appointments'], futureWrites: ['create a booking'],
    minEdition: 'presence', rateNote: 'per-minute limits; incremental sync', status: 'planned' },
  { key: 'calendly', name: 'Calendly', customerLabel: 'your booking page',
    category: 'scheduling', purpose: 'Bring your Calendly bookings into one place.',
    auth: 'oauth2', approval: 'oauth_consent', scopes: ['scheduled_events.read'],
    reads: ['scheduled meetings', 'your event types'], futureWrites: [], minEdition: 'presence',
    rateNote: 'webhook + polling; gentle', status: 'planned' },

  // ── CRM ───────────────────────────────────────────────────────────────────
  { key: 'hubspot', name: 'HubSpot', customerLabel: 'your customer list',
    category: 'crm', purpose: 'For businesses that keep their customers in HubSpot.',
    auth: 'oauth2', approval: 'oauth_consent', scopes: ['crm.objects.contacts.read'],
    reads: ['contacts and their stages', 'recent deals'], futureWrites: ['add a contact'], minEdition: 'presence_managed',
    rateNote: 'per-account rate limits', status: 'planned' },
  { key: 'salesforce', name: 'Salesforce', customerLabel: 'your customer records',
    category: 'crm', purpose: 'For larger organizations running on Salesforce.',
    auth: 'oauth2', approval: 'oauth_consent', scopes: ['api', 'refresh_token'],
    reads: ['accounts and contacts'], futureWrites: ['create a lead'], minEdition: 'agency',
    rateNote: 'org API call limits; batched', status: 'planned' },

  // ── Email marketing ───────────────────────────────────────────────────────
  { key: 'mailchimp', name: 'Mailchimp', customerLabel: 'your email list',
    category: 'email_marketing', purpose: 'See how your emails land and, later, grow your list from your site.',
    auth: 'oauth2', approval: 'oauth_consent', scopes: ['audiences.read'],
    reads: ['audience size', 'recent campaign open and click rates'], futureWrites: ['add a subscriber'],
    minEdition: 'presence', rateNote: 'connection cap; batched', status: 'planned' },
  { key: 'klaviyo', name: 'Klaviyo', customerLabel: 'your email marketing',
    category: 'email_marketing', purpose: 'For shops running email and SMS on Klaviyo.',
    auth: 'api_key', approval: 'api_key_entry', scopes: ['lists.read', 'metrics.read'],
    reads: ['list sizes', 'campaign performance'], futureWrites: ['add a profile'], minEdition: 'presence',
    rateNote: 'token-bucket per key', status: 'planned' },

  // ── Payments (the BUSINESS's own processor — distinct from Studio OS billing) ──
  { key: 'stripe_connect', name: 'Stripe (your account)', customerLabel: 'your payments',
    category: 'payments', purpose: 'See your own sales and, later, send a payment link from your site.',
    auth: 'oauth2', approval: 'oauth_consent', scopes: ['read_only'],
    reads: ['recent payments and payouts', 'active subscriptions'], futureWrites: ['create a payment link'],
    minEdition: 'presence', rateNote: 'generous; read-mostly', status: 'planned' },
  { key: 'square', name: 'Square', customerLabel: 'your Square sales',
    category: 'payments', purpose: 'Bring your Square sales and catalog into view.',
    auth: 'oauth2', approval: 'oauth_consent', scopes: ['PAYMENTS_READ', 'ITEMS_READ'],
    reads: ['recent sales', 'your item catalog'], futureWrites: ['update an item price'], minEdition: 'presence',
    rateNote: 'per-app QPS; batched', status: 'planned' },
] as const;

export function providerByKey(key: string): ConnectedProvider | null {
  return CONNECTED_PROVIDERS.find((p) => p.key === key) || null;
}
export function providersInCategory(category: string): ConnectedProvider[] {
  return CONNECTED_PROVIDERS.filter((p) => p.category === category);
}
