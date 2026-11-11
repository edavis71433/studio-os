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

// ── Where things live at each company (FD-INF2-lite; item 162, review domains findings 6 and 7) ──
// One table for every sentence that names a company: where its records are edited,
// where renewal lives, and its sign-in page (each checked to answer, Nov 11 2026).
// The records live at the company that runs the DNS, which is often not the one the
// name was bought from, so steps for records use the DNS company and steps for
// renewal use the seller.
export interface ProviderGuide { company: string; sign_in: string; records: string; renewal: string; tip: string }
const GUIDES: Array<[RegExp, ProviderGuide]> = [
  [/godaddy/, { company: 'GoDaddy', sign_in: 'https://sso.godaddy.com/', records: 'My Products, then your domain, then Manage DNS', renewal: 'Renewals & Billing',
    tip: 'At GoDaddy: My Products → your domain → Manage DNS (renewal lives under Billing).' }],
  [/namecheap/, { company: 'Namecheap', sign_in: 'https://ap.www.namecheap.com/domains/list/', records: 'Domain List, then Manage next to your domain, then Advanced DNS', renewal: 'the Auto-Renew switch on the same Domain List',
    tip: 'At Namecheap: Domain List → Manage → Advanced DNS (renewal is on the same page).' }],
  [/cloudflare/, { company: 'Cloudflare', sign_in: 'https://dash.cloudflare.com/', records: 'your domain, then DNS, then Records', renewal: 'Domain Registration, then Manage Domains',
    tip: 'At Cloudflare: the domain’s dashboard → DNS (registrar renewals are under Domain Registration).' }],
  [/squarespace|google/, { company: 'Squarespace Domains', sign_in: 'https://account.squarespace.com/domains', records: 'Domains, then your domain, then DNS', renewal: 'your domain’s own page, under Auto-renew',
    tip: 'At Squarespace Domains (Google Domains moved there): Domains → your domain → DNS.' }],
  [/porkbun/, { company: 'Porkbun', sign_in: 'https://porkbun.com/account/domainsSpeedy', records: 'Domain Management, then DNS under your domain', renewal: 'the Auto Renew switch in Domain Management',
    tip: 'At Porkbun: Domain Management → the gear icon → DNS records.' }],
  [/wix/, { company: 'Wix', sign_in: 'https://manage.wix.com/account/domains', records: 'Domains, then your domain, then Manage DNS records', renewal: 'Domains, then your domain, then Auto-renew',
    tip: 'At Wix: Domains → your domain → Manage DNS records.' }],
  [/network solutions|networksolutions|worldnic/, { company: 'Network Solutions', sign_in: 'https://www.networksolutions.com/my-account/login', records: 'My Domain Names, then Manage, then DNS', renewal: 'My Domain Names, then Auto-renew',
    tip: 'At Network Solutions: Account Manager → My Domain Names → Manage → DNS.' }],
  [/ionos|1&1|1and1/, { company: 'IONOS', sign_in: 'https://my.ionos.com/', records: 'Domains & SSL, then your domain, then DNS', renewal: 'Domains & SSL, then your domain, then Contract',
    tip: 'At IONOS: Domains & SSL → your domain → DNS.' }],
  [/amazon|route 53|route53|awsdns/, { company: 'Amazon Route 53', sign_in: 'https://console.aws.amazon.com/route53/', records: 'Hosted zones, then your domain, then Create record', renewal: 'Registered domains, then your domain, then Auto-renew',
    tip: 'At Amazon Route 53: Hosted zones → your domain → Create record.' }],
  [/hover/, { company: 'Hover', sign_in: 'https://www.hover.com/signin', records: 'your domain, then the DNS tab', renewal: 'your domain, then Auto-renew',
    tip: 'At Hover: your domain → the DNS tab.' }],
  [/dnsimple/, { company: 'DNSimple', sign_in: 'https://dnsimple.com/login', records: 'Domains, then your domain, then DNS', renewal: 'your domain, then Auto-renewal',
    tip: 'At DNSimple: Domains → your domain → DNS.' }],
  [/digitalocean/, { company: 'DigitalOcean', sign_in: 'https://cloud.digitalocean.com/login', records: 'Networking, then Domains, then your domain', renewal: 'the company the name was bought from',
    tip: 'At DigitalOcean: Networking → Domains → your domain.' }],
];
/** Pure: the guide for a company, by any of its names (a registrar's "GoDaddy.com, LLC", a
 *  DNS company from dnsHostOf, a nameserver). Null when we don't know the company. */
export function providerGuide(name: string | null | undefined): ProviderGuide | null {
  const n = String(name || '').toLowerCase();
  if (!n) return null;
  for (const [re, g] of GUIDES) if (re.test(n)) return g;
  return null;
}

/** Registrar-aware pointer: where "manage DNS / renew" lives, in each company's own
 *  words (from the table above). Generic fallback keeps the sentence honest. */
export function registrarTip(registrar: string): string {
  const g = providerGuide(registrar);
  if (g) return g.tip;
  return registrar ? `Your registrar is ${registrar} — their dashboard has a DNS / renewal section.` : '';
}

/** Pure: where the client goes for each job (findings 6 and 7). Records at the DNS company
 *  (falling back to the seller when the DNS company isn't known); renewal at the seller. */
export function whereToGo(registrar: string | null | undefined, dnsHost: string | null | undefined) {
  const recordsAt = providerGuide(dnsHost) || (dnsHost ? null : providerGuide(registrar));
  const renewAt = providerGuide(registrar);
  return {
    registrar: String(registrar || ''), dns_host: String(dnsHost || ''),
    records_at: recordsAt ? { company: recordsAt.company, sign_in: recordsAt.sign_in, path: recordsAt.records } : (dnsHost ? { company: String(dnsHost), sign_in: '', path: '' } : null),
    renew_at: renewAt ? { company: renewAt.company, sign_in: renewAt.sign_in, path: renewAt.renewal } : (registrar ? { company: String(registrar), sign_in: '', path: '' } : null),
  };
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

// ── what else the public record says (item 162, review domains finding 6) ──
// The same answer carries whether the transfer lock is on, which company runs the
// DNS (the nameservers, which is where the client must add records, often not the
// company the domain was bought from), status words such as "redemption period",
// the registration date and the DNSSEC switch. We used to keep only the expiry.
export interface RdapFacts { lock: boolean | null; dns_host: string; nameservers: string[]; statuses: string[]; registered_at: string | null; dnssec: boolean | null }

const NS_HOSTS: Array<[RegExp, string]> = [
  [/domaincontrol\.com$/, 'GoDaddy'], [/registrar-servers\.com$/, 'Namecheap'], [/cloudflare\.com$/, 'Cloudflare'],
  [/(squarespacedns|squarespace)\.com$/, 'Squarespace'], [/googledomains\.com$/, 'Google Domains (now Squarespace)'], [/wixdns\.net$/, 'Wix'],
  [/awsdns-[0-9]+\.(com|net|org|co\.uk)$/, 'Amazon Route 53'], [/nsone\.net$/, 'NS1 (Netlify DNS runs on it)'], [/porkbun\.com$/, 'Porkbun'],
  [/name-services\.com$/, 'Enom'], [/worldnic\.com$/, 'Network Solutions'], [/ui-dns\.(com|de|org|biz)$/, 'IONOS'], [/hostgator\.com$/, 'HostGator'],
  [/bluehost\.com$/, 'Bluehost'], [/dreamhost\.com$/, 'DreamHost'], [/hover\.com$/, 'Hover'], [/dnsimple\.com$/, 'DNSimple'], [/digitalocean\.com$/, 'DigitalOcean'],
];
/** Pure: the company that runs a domain's DNS, from its nameservers. */
export function dnsHostOf(nameservers: string[]): string {
  const ns = nameservers.map((n) => String(n || '').toLowerCase().replace(/\.$/, '')).filter(Boolean);
  if (!ns.length) return '';
  for (const [re, name] of NS_HOSTS) if (ns.some((n) => re.test(n))) return name;
  const parts = ns[0].split('.');   // unknown: the nameserver's own domain says who it is
  return parts.length >= 2 ? parts.slice(-2).join('.') : ns[0];
}

/** Pure: does this domain's registry say "transfer prohibited" when it's locked? Every generic
 *  ending does (.com, .net, .org, .shop…), and .us and .co. Many country endings (.uk, .de) have
 *  no such word, so silence there means "not known", never "off". */
export function lockIsReported(name: string): boolean {
  const tld = String(name || '').toLowerCase().replace(/\.$/, '').split('.').pop() || '';
  return tld.length >= 3 || tld === 'us' || tld === 'co';
}

/** Pure: is the company running the DNS the one the domain was bought from? Loosely, by name:
 *  "GoDaddy" and "GoDaddy.com, LLC" are one company; "Cloudflare" and "NameCheap, Inc." aren't. */
export function sameCompany(dnsHost: string | null | undefined, registrar: string | null | undefined): boolean {
  const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const first = String(dnsHost || '').toLowerCase().split(/[^a-z0-9]+/).find((w) => w.length >= 3) || '';
  return !!first && !!registrar && flat(String(registrar)).includes(first);
}

/** Pure: the lock, the DNS company, the status words, the registration date and DNSSEC. */
export function parseRdapFacts(j: unknown): RdapFacts {
  const doc = (j ?? {}) as Record<string, unknown>;
  const statuses = (Array.isArray(doc.status) ? doc.status : []).map((x) => String(x).toLowerCase().trim()).filter(Boolean);
  const nameservers = (Array.isArray(doc.nameservers) ? doc.nameservers : []).map((n) => String((n as Record<string, unknown>)?.ldhName || '').toLowerCase()).filter(Boolean);
  let registered: string | null = null;
  for (const ev of (Array.isArray(doc.events) ? doc.events : []) as Array<Record<string, unknown>>) {
    if (String(ev.eventAction || '').toLowerCase() === 'registration' && ev.eventDate) { const t = Date.parse(String(ev.eventDate)); if (Number.isFinite(t)) registered = new Date(t).toISOString(); }
  }
  const sd = doc.secureDNS as Record<string, unknown> | undefined;
  return {
    lock: statuses.includes('client transfer prohibited') || statuses.includes('server transfer prohibited') ? true : lockIsReported(String(doc.ldhName || '')) ? false : null,
    dns_host: dnsHostOf(nameservers), nameservers, statuses, registered_at: registered,
    dnssec: sd && typeof sd.delegationSigned === 'boolean' ? sd.delegationSigned : null,
  };
}

/** Pure: what the status words mean for the studio, worst first. `severity` 'bad' is
 *  the domain itself in trouble; 'warn' is a door left open. */
export function registryWarnings(f: Pick<RdapFacts, 'lock' | 'statuses'> | null): Array<{ key: string; severity: 'bad' | 'warn'; words: string }> {
  if (!f) return [];
  const has = (w: string) => f.statuses.includes(w);
  const out: Array<{ key: string; severity: 'bad' | 'warn'; words: string }> = [];
  if (has('pending delete')) out.push({ key: 'pending_delete', severity: 'bad', words: 'About to be deleted at the registry: renew it today or it can be lost' });
  if (has('redemption period')) out.push({ key: 'redemption', severity: 'bad', words: 'In the redemption period: it lapsed, and buying it back costs more than renewing' });
  if (has('client hold') || has('server hold')) out.push({ key: 'hold', severity: 'bad', words: 'On hold at the registry, so it isn’t answering: the provider has to lift it' });
  if (has('auto renew period') || has('renew period')) out.push({ key: 'grace', severity: 'warn', words: 'Just renewed or in its grace period: check it renewed on purpose' });
  if (f.lock === false && f.statuses.length) out.push({ key: 'unlocked', severity: 'warn', words: 'The transfer lock is off: anyone with the account could move it away' });
  return out;
}

export type RdapResult = { status: 'ok'; name: string; info: RdapInfo; facts: RdapFacts } | { status: 'not_found' } | { status: 'failed' };

/** Pure: what one lookup writes onto the site row. The daily watch, Check now and the
 *  client's sheet (the first time it opens) all write the same fields the same way. A
 *  failed or empty lookup writes only its status, so yesterday's facts stay. */
export function lookupPatch(look: RdapResult): Record<string, unknown> {
  if (look.status !== 'ok') return { domain_lookup_status: look.status };
  return {
    domain_lookup_status: 'ok', domain_registered_name: look.name,   // item 134: tells a "www." twin from a sub-name
    domain_registrar: look.info.registrar, domain_expires_at: look.info.expires_at,
    // item 162 (review domains finding 6): the lock, who runs the DNS, the status words, since when
    domain_lock: look.facts.lock, domain_dns_host: look.facts.dns_host || null, domain_statuses: look.facts.statuses, domain_registered_at: look.facts.registered_at,
  };
}

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
      const j = await r.json();
      return { status: 'ok', name, info: parseRdap(j), facts: parseRdapFacts(j) };
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
    : 'Renew it at the registrar (auto-renew is the calm option). If it lapses, the website and email stop answering.'
      // item 162 (review domains finding 10): the first reminder asks the one fact we can't see from outside
      + (daysLeft > 15 ? ` Is it set to renew by itself? A quick look at ${registrar || 'the company it’s registered with'} settles it. If someone looks after it for you, add them as a user there rather than sharing your password.` : '');
  return { when, headline: `Your domain ${when}`, body: `${domain} ${when}${at}. ${after}`, after };
}
