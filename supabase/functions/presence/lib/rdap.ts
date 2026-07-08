// ── RDAP domain intelligence (Phase INF / CP-8 / FD-INF3) ────────────────────
// One public, keyless protocol answers the two questions every domain owner
// forgets: WHEN does it expire, and WHERE is it registered. rdap.org redirects
// to the right registry; we parse the standard shape. Pure parse + fenced fetch.

export interface RdapInfo { expires_at: string | null; registrar: string }

/** Pure: pull expiry + registrar from a standard RDAP domain response. */
export function parseRdap(j: unknown): RdapInfo {
  const doc = (j ?? {}) as Record<string, unknown>;
  let expires: string | null = null;
  for (const ev of (Array.isArray(doc.events) ? doc.events : []) as Array<Record<string, unknown>>) {
    if (String(ev.eventAction || '').toLowerCase() === 'expiration' && ev.eventDate) {
      const t = Date.parse(String(ev.eventDate));
      if (Number.isFinite(t)) expires = new Date(t).toISOString();
    }
  }
  let registrar = '';
  for (const ent of (Array.isArray(doc.entities) ? doc.entities : []) as Array<Record<string, unknown>>) {
    const roles = (Array.isArray(ent.roles) ? ent.roles : []).map((r) => String(r).toLowerCase());
    if (!roles.includes('registrar')) continue;
    const vcard = (ent.vcardArray as unknown[])?.[1];
    for (const row of (Array.isArray(vcard) ? vcard : []) as unknown[][]) {
      if (Array.isArray(row) && row[0] === 'fn' && typeof row[3] === 'string' && row[3].trim()) { registrar = row[3].trim().slice(0, 80); break; }
    }
    if (!registrar && typeof ent.handle === 'string') registrar = ent.handle.slice(0, 80);
    if (registrar) break;
  }
  return { expires_at: expires, registrar };
}

/** Days from `nowIso` until `iso` (fractional floor). Pure. */
export function daysUntil(iso: string | null | undefined, nowIso: string): number | null {
  if (!iso) return null;
  const t = Date.parse(iso), n = Date.parse(nowIso);
  if (!Number.isFinite(t) || !Number.isFinite(n)) return null;
  return Math.floor((t - n) / 86400_000);
}

/** Registrar-aware pointer (FD-INF2-lite): where "manage DNS / renew" lives, in
 *  each registrar's own words. Generic fallback keeps the sentence honest. */
export function registrarTip(registrar: string): string {
  const r = registrar.toLowerCase();
  if (r.includes('godaddy')) return 'At GoDaddy: My Products → your domain → Manage DNS (renewal lives under Billing).';
  if (r.includes('namecheap')) return 'At Namecheap: Domain List → Manage → Advanced DNS (renewal is on the same page).';
  if (r.includes('cloudflare')) return 'At Cloudflare: the domain’s dashboard → DNS (registrar renewals are under Domain Registration).';
  if (r.includes('squarespace') || r.includes('google')) return 'At Squarespace Domains (Google Domains moved there): Domains → your domain → DNS.';
  if (r.includes('porkbun')) return 'At Porkbun: Domain Management → the gear icon → DNS records.';
  if (r.includes('wix')) return 'At Wix: Domains → your domain → Manage DNS records.';
  if (r.includes('network solutions')) return 'At Network Solutions: Account Manager → My Domain Names → Manage → DNS.';
  if (r.includes('ionos')) return 'At IONOS: Domains & SSL → your domain → DNS.';
  return registrar ? `Your registrar is ${registrar} — their dashboard has a DNS / renewal section.` : '';
}

/** Fenced RDAP lookup — never throws, 6s cap. */
export async function rdapLookup(domain: string): Promise<RdapInfo | null> {
  try {
    const r = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, { redirect: 'follow', signal: AbortSignal.timeout(6000), headers: { Accept: 'application/rdap+json, application/json' } });
    if (!r.ok) return null;
    return parseRdap(await r.json());
  } catch { return null; }
}
