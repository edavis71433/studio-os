// ── Connected Platform contracts (L4.0) — the unified foundation ────────────
// Extends the M12 principle to EXTERNAL services: Studio OS is the stable
// control plane; every connected platform (Google, Meta, booking, CRM, …) is an
// adapter behind ONE contract, never a bespoke integration. The customer thinks
// "my Google listing", "my reviews", "my appointments" — never APIs.
//
// FOUNDATION ONLY (L4.0): nothing here reads, writes, syncs, or authenticates
// against a live service. It declares the shape every provider must fit so that
// adding the 25th provider is a registry entry, not a redesign — and so that
// today's read-only adapters become tomorrow's write-capable ones without the
// architecture changing.
//
// Three laws inherited from M12 and the constitution:
//   • Capabilities are DECLARED, never assumed ('automatic' | 'guided' |
//     'unsupported') — an adapter never claims what it cannot do.
//   • READ-ONLY FIRST — every provider begins observing; nothing external
//     changes until a write-capable adapter is deliberately shipped and the
//     customer approves each change.
//   • The customer owns the account and the authorization, ALWAYS. Studio OS
//     holds delegated, encrypted, least-privilege, revocable tokens — never a
//     password, never ownership. Disconnecting is one switch, any time, free.

export type Capability = 'automatic' | 'guided' | 'unsupported'; // reuse M12 vocabulary
export type ImplStatus = 'planned' | 'read_only' | 'read_write';
export type AuthModel = 'oauth2' | 'api_key' | 'ownership_verification' | 'none';
export type ApprovalModel = 'oauth_consent' | 'ownership_verification' | 'api_key_entry' | 'none';
export type ConnectionCategory =
  | 'search' | 'local_listing' | 'analytics' | 'social' | 'reviews'
  | 'scheduling' | 'crm' | 'email_marketing' | 'payments';
export type EditionKey = 'presence_monitor' | 'presence' | 'presence_managed' | 'agency' | 'enterprise';

// The static declaration of a provider — the registry entry. A live CONNECTION
// (below) is separate: this is what the provider CAN be, that is what a given
// customer's link to it currently IS.
export interface ConnectedProvider {
  key: string;                 // stable slug ('google_business_profile')
  name: string;                // technical/display name
  customerLabel: string;       // what the customer calls it ("your Google listing")
  category: ConnectionCategory;
  purpose: string;             // one plain sentence — the customer's "why"
  auth: AuthModel;
  approval: ApprovalModel;     // how the customer grants access
  scopes: string[];            // least-privilege permissions requested (declared)
  reads: string[];             // what can be READ, in plain phrases (read-only-first surface)
  futureWrites: string[];      // what could EVENTUALLY be written (declared, never built here)
  minEdition: EditionKey;      // technical capability floor — NOT pricing
  rateNote: string;            // rate-limit posture in plain words
  status: ImplStatus;          // Planned / Read-only / Read/Write — every provider is 'planned' at L4.0
}

// A customer's live link to a provider — the CONNECTION record (presence_connections).
// Status/health/last-sync/errors live here; capabilities/permissions/ownership
// live on the provider declaration above. This is the other half of the unified
// contract: every provider surfaces the SAME concepts.
export type ConnectionStatus = 'disconnected' | 'pending' | 'connected' | 'expired' | 'error' | 'revoked';
export interface ConnectionState {
  provider_key: string;
  status: ConnectionStatus;
  health: 'ok' | 'attention' | 'down' | 'unknown';
  scopes_granted: string[];
  last_sync_at: string | null;
  last_error: string;          // internal; never raw provider errors to the customer
  connected_at: string | null;
}

// The ownership answer — a PLATFORM CONSTANT, identical for every provider. That
// sameness is the point (constitution Part 4; Laws 1–4).
export const OWNERSHIP = {
  account: 'the customer — the Google/Meta/booking/CRM account is theirs',
  authorization: 'the customer — they grant it, they revoke it, one switch, any time',
  tokens: 'Studio OS holds delegated, encrypted, least-privilege tokens; never a password, never ownership',
  refresh: 'Studio OS refreshes its own delegated tokens silently; the customer is never asked to re-auth for maintenance, only for genuinely new permissions',
  on_disconnect: 'tokens are destroyed and access ends immediately; the customer’s data AT the provider is untouched',
  on_leave: 'disconnecting is always available and never penalized (Laws 3, 4); export always includes what was read',
} as const;

// The error philosophy — external systems fail; Studio OS stays calm. A failed
// or expired connection degrades to observation-of-absence, never an alarm.
export const ERROR_PHILOSOPHY = {
  oauth_expired: 'silently attempt refresh; if it truly lapses, mark the connection "needs a quick reconnect" — calm, one tap, never red',
  rate_limited: 'back off and try later; the customer sees nothing — stale-but-honest beats hammering',
  provider_outage: 'health = down, last-known data kept and labelled as of its last-sync time; never invented',
  permission_revoked: 'treat as a clean disconnect the customer chose; thank, don’t chase',
  account_deleted: 'mark disconnected; keep nothing that isn’t ours to keep',
  api_change: 'the adapter fails closed and isolated — one provider breaking never touches another (provider isolation)',
  network_failure: 'transient; last-sync time tells the truth; retried on the next natural pass, never a background storm',
} as const;

export const EDITIONS: readonly EditionKey[] = ['presence_monitor', 'presence', 'presence_managed', 'agency', 'enterprise'] as const;
export function editionRank(e: EditionKey): number { return EDITIONS.indexOf(e); }
// Technical capability only (the milestone forbids finalizing pricing here): an
// edition may use a provider when it sits at or above the provider's floor.
export function editionAllows(edition: EditionKey, minEdition: EditionKey): boolean {
  return editionRank(edition) >= editionRank(minEdition);
}
