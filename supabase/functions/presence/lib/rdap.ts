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

/** Pure: the names to ask the registry about, most specific first. Registration
 *  records exist only for the registered name, so "www.restaurant.com" is asked as
 *  "restaurant.com" (Nov 2026 review, item 132: a saved "www." name was never found,
 *  so its expiry was never known and no reminder ever went out). Any other leading
 *  sub-name is dropped one at a time, which also finds "shop.example.co.uk" without
 *  a suffix list: the registry answers "not found" until the registered name. */
export function registrableCandidates(domain: string): string[] {
  const labels = String(domain || '').trim().toLowerCase().replace(/\.$/, '').split('.').filter(Boolean);
  while (labels[0] === 'www' && labels.length > 2) labels.shift();
  const out: string[] = [];
  for (let i = 0; i <= labels.length - 2 && out.length < 4; i++) out.push(labels.slice(i).join('.'));
  return out;
}

export type RdapResult = { status: 'ok'; name: string; info: RdapInfo } | { status: 'not_found' } | { status: 'failed' };

/** Fenced RDAP lookup that says what happened: found (and under which name), not
 *  found under any name, or the lookup itself failed. Never throws, 6s cap a try. */
export async function rdapLookupDetailed(domain: string): Promise<RdapResult> {
  const names = registrableCandidates(domain);
  if (!names.length) return { status: 'not_found' };
  for (const name of names) {
    try {
      const r = await fetch(`https://rdap.org/domain/${encodeURIComponent(name)}`, { redirect: 'follow', signal: AbortSignal.timeout(6000), headers: { Accept: 'application/rdap+json, application/json' } });
      if (r.status === 404) { await r.body?.cancel().catch(() => {}); continue; }   // not a registered name: try the shorter one
      if (!r.ok) { await r.body?.cancel().catch(() => {}); return { status: 'failed' }; }
      return { status: 'ok', name, info: parseRdap(await r.json()) };
    } catch { return { status: 'failed' }; }
  }
  return { status: 'not_found' };
}

/** Fenced RDAP lookup — never throws, 6s cap. Null when not found or failed. */
export async function rdapLookup(domain: string): Promise<RdapInfo | null> {
  const r = await rdapLookupDetailed(domain);
  return r.status === 'ok' ? r.info : null;
}

// ── the expiry ladder (item 133, review finding 2) ──
/** Pure: which reminder a domain is due, by days left: 30, 15, 7 and 1 day before, and
 *  once after it has expired. Null when it's further off than 30 days or unknown. Each
 *  rung is sent once per expiry date (the notice period carries both), so a renewal,
 *  which moves the date, starts the ladder again. */
export function expiryRung(daysLeft: number | null): '30' | '15' | '7' | '1' | 'expired' | null {
  if (daysLeft === null || !Number.isFinite(daysLeft)) return null;
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= 1) return '1';
  if (daysLeft <= 7) return '7';
  if (daysLeft <= 15) return '15';
  if (daysLeft <= 30) return '30';
  return null;
}

/** Pure: the reminder's words for one rung. */
export function expiryWords(domain: string, daysLeft: number, registrar: string): { when: string; headline: string; body: string; after: string } {
  const when = daysLeft < 0 ? 'has expired' : daysLeft === 0 ? 'expires today' : daysLeft === 1 ? 'expires tomorrow' : `expires in ${daysLeft} days`;
  const at = registrar ? ` at ${registrar}` : '';
  const after = daysLeft < 0
    ? 'Most registrars hold an expired domain for about 30 days, so it can usually still be renewed at the normal price; after that it can cost much more or be lost. Your website and email stop answering until it is renewed.'
    : 'Renew it at the registrar (auto-renew is the calm option). If it lapses, the website and email stop answering.';
  return { when, headline: `Your domain ${when}`, body: `${domain} ${when}${at}. ${after}`, after };
}
