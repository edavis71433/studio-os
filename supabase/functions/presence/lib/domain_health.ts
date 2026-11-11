// ── A domain's health: does its DNS point at the site, and is its padlock on? ──
// Moved here from routes/admin.ts (Nov 2026 review, builder list item 134) so the
// client's domain sheet and the daily domain watch (commerce/lifecycle.ts) ask the
// same question the same way. DNS is read over DNS-over-HTTPS (Google's resolver):
// a CNAME to the site's netlify.app name, or the Netlify apex address. The apex
// address comes from the ONE constant (platform/dns.ts), never a second literal.
import { getSite, sslStatus } from './netlify.ts';
import { NETLIFY_APEX_IP } from '../platform/dns.ts';

const NETLIFY_APEX_IPS = new Set([NETLIFY_APEX_IP]);

export async function dnsLookup(name: string, type: 'A' | 'CNAME'): Promise<string[]> {
  try {
    const r = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`, { headers: { Accept: 'application/json' } });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j.Answer) ? j.Answer.map((a: any) => String(a.data || '').replace(/\.$/, '').toLowerCase()) : [];
  } catch { return []; }
}

/** The padlock is on (Netlify's words for a live certificate). */
export const certIsOn = (state: string | null | undefined) => state === 'issued' || state === 'renewed';

export async function domainHealth(site: { custom_domain: string | null; netlify_site_id: string | null }) {
  if (!site.custom_domain) {
    const nf = site.netlify_site_id ? await getSite(site.netlify_site_id) : { ok: false as const, site: undefined };
    return {
      custom_domain: null, health: 'no_domain',
      message: 'No custom domain attached — the site serves from its netlify.app address.',
      netlify_subdomain: nf.ok && nf.site ? nf.site.default_domain : null,
      dns: null, ssl: null,
    };
  }
  const nf = site.netlify_site_id ? await getSite(site.netlify_site_id) : { ok: false as const, site: undefined };
  const target = nf.ok && nf.site ? nf.site.default_domain.toLowerCase() : null;
  const cnames = await dnsLookup(site.custom_domain, 'CNAME');
  const aRecords = await dnsLookup(site.custom_domain, 'A');
  const dnsOk = (target !== null && cnames.includes(target)) || aRecords.some((ip) => NETLIFY_APEX_IPS.has(ip));
  const ssl = site.netlify_site_id ? await sslStatus(site.netlify_site_id) : { ok: false, state: 'unknown', expires_at: null };
  const sslOk = certIsOn(ssl.state);
  const health = !dnsOk ? 'dns_pending' : !sslOk ? 'ssl_pending' : 'ok';
  const message =
    health === 'ok' ? 'Domain is healthy: DNS points at the site and the certificate is active.'
    : health === 'ssl_pending' ? 'DNS is correct; the HTTPS certificate is still being issued (usually minutes, up to an hour).'
    : `DNS does not point at the site yet. Set a CNAME for ${site.custom_domain} to ${target ?? '<site>.netlify.app'}${aRecords.length ? ` (currently resolves to ${aRecords.join(', ')})` : ' (currently no record found)'}.`;
  return {
    custom_domain: site.custom_domain, health, message,
    netlify_subdomain: target,
    dns: { ok: dnsOk, cname: cnames, a: aRecords, expected_cname: target, expected_apex_ip: [...NETLIFY_APEX_IPS] },
    ssl: { state: ssl.state, expires_at: ssl.expires_at },
  };
}

// ── the padlock watch (item 134, review findings 4 and 20) ──
// Home's thresholds (14 days, a day stuck) live with Home's list: agency/needs_you.ts.

/** Pure: what the daily watch records about the padlock, from one health check.
 *  `pendingSince` starts when the records are right but no padlock is on, and
 *  clears when it comes on (or the records go wrong again, which is the client's
 *  side, not stuck on ours). `reask` says to ask Netlify for it again. */
export function padlockAfterCheck(h: { health: string; ssl: { state: string; expires_at: string | null } | null }, prevPendingSince: string | null, nowIso: string) {
  const state = h.ssl ? h.ssl.state : null;
  const on = certIsOn(state);
  const waiting = h.health === 'ssl_pending';
  return {
    cert_state: state,
    cert_expires_at: on && h.ssl ? h.ssl.expires_at : null,
    cert_pending_since: waiting ? (prevPendingSince || nowIso) : null,
    reask: waiting,
  };
}
