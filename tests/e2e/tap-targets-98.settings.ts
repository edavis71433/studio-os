// Builder item 98's tap-target walk borrows this spec's made-up fixtures, copied as they are from tests/e2e/settings.spec.ts.
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// ── Oct 2026 review: Settings is its own page ────────────────────────────────
// /presence.html#settings landed on the website builder, which waited on its
// whole read wave before it could switch views ("Setting the table…"). The nav
// now points at /settings.html: eight cards that route to where each thing
// already lives, plus the studio profile editable inline (GET/PUT /identity,
// the industry via /settings). The old hash keeps working as a deep link.
const IDENTITY = { data: { site_id: 's1', business_name: 'Davis Digital Studio', email: 'hello@example.com', phone: '', service_area: 'Burbank, CA', tagline: '', description: '', story: '', booking_url: '', ordering_url: '', social: {}, seo_title: '', seo_description: '', updated_at: '2026-10-01T00:00:00Z' } };
// GET /connections answers the GROUPS shape (routes/connections.ts) — the card's
// status read `data.services` for a year and never rendered (studio audit bug 2).
const CONNECTIONS = { data: { edition: 'studio_os', note: '', groups: {
  'Google': [
    { key: 'google_analytics', label: 'Google Analytics', connection: { status: 'connected', health: 'ok' } },
    { key: 'google_search_console', label: 'Search Console', connection: { status: 'connected', health: 'ok' } },
    { key: 'google_business_profile', label: 'Business Profile', connection: { status: 'expired', health: 'attention' } },
  ],
  'Email': [{ key: 'resend', label: 'Email sending', connection: { status: 'disconnected', health: 'unknown' } }],
} } };
const API = {
  '/identity': IDENTITY,
  '/settings': { data: { industry_key: 'generic' } },
  '/connections': CONNECTIONS,
  '/commerce/subscription': { data: { plan: 'studio', plan_name: 'Studio', status: 'active', can_manage_billing: true, current_period_end: '2026-11-03T00:00:00Z', in_grace: false, has_service_billing: false } },
};
const CLIENT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
/** An agency member drilled into a client — the shell's context carries scope.name (what the "Viewing client" bar shows). */
const SCOPED_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS',
  edition_features: ALL_FEATURES, is_agency: true, is_operator: false, sees_full_workspace: true,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'], landing: '/today.html', attention_count: 0, nav: STUDIO_NAV,
  scope: { site_id: CLIENT, name: 'Marlow’s Kitchen' },
} };
const AGENCY_CTX = { data: { ...SCOPED_CTX.data, scope: undefined } };

export const SETTINGS_98 = API;
