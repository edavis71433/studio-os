// ── Connected Platform Inventory (L4.0) ─────────────────────────────────────
// The living inventory the whole milestone is verified against — GENERATED from
// the registry, never hand-maintained, so it can't drift into one-off truth.
// Every provider gets the same single-page profile; every edition gets the same
// customer-facing surface. Pure.
import { CONNECTED_PROVIDERS } from './providers.ts';
import type { ConnectedProvider, EditionKey, ImplStatus } from './contract.ts';
import { EDITIONS, editionAllows } from './contract.ts';

const AUTH_PLAIN: Record<string, string> = {
  oauth2: 'Secure sign-in you approve on the provider’s own screen — Studio OS never sees your password.',
  api_key: 'A read-only key you paste in — nothing else.',
  ownership_verification: 'A one-time check that you own the listing.',
  none: 'No sign-in needed.',
};
const APPROVAL_PLAIN: Record<string, string> = {
  oauth_consent: 'You approve access on the provider’s sign-in screen, and can revoke it any time.',
  ownership_verification: 'You prove ownership once; nothing else is asked.',
  api_key_entry: 'You paste a read-only key you control.',
  none: 'Nothing to approve.',
};
const STATUS_PLAIN: Record<ImplStatus, string> = {
  planned: 'Planned', read_only: 'Read-only', read_write: 'Read/Write',
};

export interface ProviderProfile {
  key: string; name: string; customerLabel: string; category: string; purpose: string;
  authentication: string;            // plain method
  permissions: string[];             // least-privilege scopes (the required permissions)
  read_capabilities: string[];
  future_write_capabilities: string[];
  customer_approval: string;         // plain approval requirement
  supported_editions: EditionKey[];  // technical capability (NOT pricing)
  status: string;                    // Planned / Read-only / Read/Write
}

export function profileOf(p: ConnectedProvider): ProviderProfile {
  return {
    key: p.key, name: p.name, customerLabel: p.customerLabel, category: p.category, purpose: p.purpose,
    authentication: AUTH_PLAIN[p.auth] || p.auth,
    permissions: p.scopes,
    read_capabilities: p.reads,
    future_write_capabilities: p.futureWrites,
    customer_approval: APPROVAL_PLAIN[p.approval] || p.approval,
    supported_editions: EDITIONS.filter((e) => editionAllows(e, p.minEdition)),
    status: STATUS_PLAIN[p.status],
  };
}

// The full inventory — every provider's single-page profile.
export function inventory(): ProviderProfile[] {
  return CONNECTED_PROVIDERS.map(profileOf);
}

// The CUSTOMER surface for one edition: what they can connect, in their words,
// grouped by category, with no APIs in sight. Providers below the edition floor
// simply don't appear.
export interface ConnectableItem {
  key: string; label: string; category: string; purpose: string;
  reads: string[]; approval: string; status: string;
}
export function connectableFor(edition: EditionKey): ConnectableItem[] {
  return CONNECTED_PROVIDERS
    .filter((p) => editionAllows(edition, p.minEdition))
    .map((p) => ({
      key: p.key, label: p.customerLabel, category: p.category, purpose: p.purpose,
      reads: p.reads, approval: APPROVAL_PLAIN[p.approval] || p.approval, status: STATUS_PLAIN[p.status],
    }));
}

// Architecture introspection — coverage across category / status / edition.
export function inventorySummary() {
  const byCategory: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const byEdition: Record<string, number> = {};
  for (const p of CONNECTED_PROVIDERS) {
    byCategory[p.category] = (byCategory[p.category] || 0) + 1;
    byStatus[p.status] = (byStatus[p.status] || 0) + 1;
    for (const e of EDITIONS) if (editionAllows(e, p.minEdition)) byEdition[e] = (byEdition[e] || 0) + 1;
  }
  return { total: CONNECTED_PROVIDERS.length, byCategory, byStatus, byEdition };
}
