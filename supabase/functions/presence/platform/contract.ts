// ── Platform Services contracts (M12) ───────────────────────────────────────
// PERMANENT PRINCIPLE (adopted M12): infrastructure should be replaceable;
// customer trust should not. Studio OS is the stable control plane; every
// registrar, DNS host, hosting provider, and email provider is an adapter
// behind these contracts. Switching providers must never change the customer
// experience — providers are implementation details.
//
// Every capability is declared, never assumed: 'automatic' (the adapter can
// do it), 'guided' (the adapter prepares exact steps a human performs), or
// 'unsupported'. Adapters never claim what they cannot do — automation where
// safe, guidance where automation is impossible, reality never hidden.
import * as netlify from '../lib/netlify.ts';

export type Capability = 'automatic' | 'guided' | 'unsupported';

/* ── registrars ──────────────────────────────────────────────────────────── */
export interface RegistrarProvider {
  slug: string;
  name: string;
  capabilities: {
    search: Capability; purchase: Capability; transfer_in: Capability; transfer_out: Capability;
    renew: Capability; auto_renew: Capability; whois_privacy: Capability; portfolio: Capability;
  };
  /** Guided adapters return exact human steps; automatic adapters perform them. */
  guide(action: keyof RegistrarProvider['capabilities'], domain: string): string[];
}

/** The shipped adapter: every action guided, honestly. Expiration monitoring
 *  is already real (M10 RDAP evidence); purchase/transfer automation arrives
 *  as a future adapter — a registry entry, not a redesign. */
export const manualRegistrar: RegistrarProvider = {
  slug: 'manual', name: 'Your current registrar',
  capabilities: { search: 'guided', purchase: 'guided', transfer_in: 'guided', transfer_out: 'guided',
    renew: 'guided', auto_renew: 'guided', whois_privacy: 'guided', portfolio: 'guided' },
  guide(action, domain) {
    const G: Record<string, string[]> = {
      search: [`Check availability for ${domain} at any registrar — the name, not the registrar, is what matters.`],
      purchase: [`Register ${domain} wherever you like (a registrar is just where the name is parked).`, 'Turn on auto-renew during checkout.', 'Turn on WHOIS privacy (usually free).'],
      transfer_in: [`Unlock ${domain} at the current registrar and request the transfer code (EPP).`, 'Start the transfer at the destination; approve the confirmation email.', 'Nothing about the website changes during a transfer.'],
      transfer_out: [`Unlock ${domain} and request the transfer code — the name is yours to move, always.`],
      renew: [`Renew ${domain} at the registrar before its expiration date.`],
      auto_renew: [`Turn on auto-renew for ${domain} in the registrar's dashboard — one switch, one worry gone.`],
      whois_privacy: [`Turn on WHOIS privacy for ${domain} so your home address isn't public.`],
      portfolio: ['Keep every domain at one registrar with one payment method — fewer places for a renewal to slip.'],
    };
    return G[action] || [];
  },
};

export const REGISTRARS: Record<string, RegistrarProvider> = { manual: manualRegistrar };
export const registrarFor = (slug: string): RegistrarProvider => REGISTRARS[slug] || manualRegistrar;

/* ── hosting ─────────────────────────────────────────────────────────────── */
export interface HostingProvider {
  slug: string;
  name: string;
  capabilities: {
    provision: Capability; deploy: Capability; deploy_history: Capability; restore: Capability;
    ssl: Capability; ssl_renew: Capability; cdn: Capability; health: Capability; custom_domain: Capability;
  };
  deploys(hostId: string): Promise<{ ok: boolean; deploys: Array<{ id: string; state: string; created_at: string; title: string }> }>;
  restore(hostId: string, deployId: string): Promise<{ ok: boolean; error?: string }>;
  ssl(hostId: string): Promise<{ ok: boolean; state: string; expires_at: string | null }>;
}

/** The shipped adapter: a THIN mapping over the existing lib/netlify.ts —
 *  the frozen publishing pipeline keeps calling that lib directly; this
 *  adapter only gives Platform Services the same powers behind the contract. */
export const netlifyHosting: HostingProvider = {
  slug: 'netlify', name: 'Managed hosting',
  capabilities: { provision: 'automatic', deploy: 'automatic', deploy_history: 'automatic', restore: 'automatic',
    ssl: 'automatic', ssl_renew: 'automatic', cdn: 'automatic', health: 'automatic', custom_domain: 'automatic' },
  async deploys(hostId) {
    const r = await netlify.listDeploys(hostId, 20);
    return { ok: r.ok, deploys: (r.deploys || []).map((d) => ({ id: d.id, state: d.state, created_at: d.created_at, title: d.title })) };
  },
  restore: (hostId, deployId) => netlify.restoreDeploy(hostId, deployId),
  ssl: (hostId) => netlify.sslStatus(hostId),
};

export const HOSTS: Record<string, HostingProvider> = { netlify: netlifyHosting };
export const hostFor = (slug: string): HostingProvider => HOSTS[slug] || netlifyHosting;

/* ── DNS ─────────────────────────────────────────────────────────────────── */
// Reads are real today (DNS-over-HTTPS); writes are 'guided' — the platform
// prepares EXACT records and plain-language instructions. A DNS host with an
// API becomes an 'automatic' adapter here without touching anything above it.
export interface DnsProvider {
  slug: string;
  name: string;
  capabilities: { read: Capability; write: Capability; dnssec: Capability };
}
export const guidedDns: DnsProvider = {
  slug: 'guided', name: 'Your DNS host',
  capabilities: { read: 'automatic', write: 'guided', dnssec: 'guided' },
};
export const DNS_PROVIDERS: Record<string, DnsProvider> = { guided: guidedDns };

/* ── email authentication ────────────────────────────────────────────────── */
// Inspection is real (DoH); setup is guided record preparation. A mail
// provider adapter (Google Workspace API etc.) slots in as 'automatic'.
export interface EmailAuthProvider {
  slug: string;
  capabilities: { inspect: Capability; setup: Capability; deliverability: Capability };
}
export const guidedEmailAuth: EmailAuthProvider = {
  slug: 'guided',
  capabilities: { inspect: 'automatic', setup: 'guided', deliverability: 'guided' },
};
