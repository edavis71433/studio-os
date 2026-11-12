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

// item 162 (review domains finding 24): every record at a name, for the Domains side panel.
// Only the asked type AT that name: a CNAME on the way to an answer is its own row, and the
// addresses behind someone else's name aren't the client's records. TXT keeps its case
// (verification codes are case-sensitive) and loses its quotes.
export const RECORD_TYPE_NUM = { A: 1, CNAME: 5, MX: 15, TXT: 16, AAAA: 28 } as const;
export type RecordType = keyof typeof RECORD_TYPE_NUM;
export function recordsFromAnswer(name: string, type: RecordType, answer: unknown): string[] {
  const want = name.toLowerCase().replace(/\.$/, '');
  return (Array.isArray(answer) ? answer : [])
    .filter((a: any) => a && a.type === RECORD_TYPE_NUM[type] && String(a.name || '').toLowerCase().replace(/\.$/, '') === want)
    .map((a: any) => {
      const d = String(a.data || '');
      return type === 'TXT' ? d.replace(/^"|"$/g, '').replace(/"\s*"/g, '') : d.replace(/\.$/, '').toLowerCase();
    })
    .filter(Boolean);
}
export async function dnsRecords(name: string, type: RecordType): Promise<string[]> {
  try {
    const r = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) { await r.body?.cancel().catch(() => {}); return []; }
    return recordsFromAnswer(name, type, (await r.json()).Answer);
  } catch { return []; }
}

/** Item 163: like dnsRecords, but null when the answer couldn't be had. [] only when the
 *  resolver said there are none, so a passing blip never reads as "the email records are gone". */
export async function dnsRecordsSure(name: string, type: RecordType): Promise<string[] | null> {
  try {
    const r = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) { await r.body?.cancel().catch(() => {}); return null; }
    const j = await r.json();
    if (j.Status !== 0 && j.Status !== 3) return null;   // 0: answered; 3: no such name; anything else is a failure
    return recordsFromAnswer(name, type, j.Answer);
  } catch { return null; }
}

/** The one honest wait, said the same way everywhere (Nov 12 review, finding 21: one sheet
 *  said "a few minutes", "within an hour" and "a day or two"). */
export const DOMAIN_WAIT = 'Usually within an hour of adding the records, sometimes a day or two.';

/** The padlock is on (Netlify's words for a live certificate). */
export const certIsOn = (state: string | null | undefined) => state === 'issued' || state === 'renewed';

type SiteAnswer = Awaited<ReturnType<typeof getSite>>;
type SslAnswer = Awaited<ReturnType<typeof sslStatus>>;
/** What a caller has already read, so one open of the sheet asks each thing once (Nov 12
 *  review, finding 25: the sheet asked the hosting company four times and looked the domain
 *  up twice). Anything left out is read here as before. */
export interface DomainRead { nf?: SiteAnswer | null; ssl?: SslAnswer | null; lookups?: { cnames: string[]; aRecords: string[] }; names?: NameCheck[] }

export async function lookupName(name: string): Promise<{ cnames: string[]; aRecords: string[] }> {
  const [cnames, aRecords] = await Promise.all([dnsLookup(name, 'CNAME'), dnsLookup(name, 'A')]);
  return { cnames, aRecords };
}

/** Pure: the registered name a domain sits under, when the lookup hasn't said. Two parts
 *  (bistro.com), or three where the ending is itself two parts (bistro.co.uk). */
export function guessRegistered(domain: string): string {
  const parts = String(domain || '').toLowerCase().replace(/\.$/, '').split('.');
  const twoPartEnding = parts.length >= 3 && parts[parts.length - 1].length === 2 && ['co', 'com', 'org', 'net', 'ac', 'gov', 'edu'].includes(parts[parts.length - 2]);
  return parts.slice(-(twoPartEnding ? 3 : 2)).join('.');
}

export interface ConnectRecord { type: 'A' | 'CNAME'; host: string; name: string; value: string }
/** Pure: the records that connect a domain, written the way a provider's form wants them
 *  (Nov 12 review, finding 19). A registered name, with or without "www.", gets the usual two:
 *  "@" to the address and "www" to the site. A sub-name (shop.bistro.com) gets ONE record for
 *  itself: it used to be shown the "@" and "www" pair, which the check never looks at and
 *  which can take over the main site at bistro.com. */
export function connectRecords(domain: string, registered: string | null | undefined, target: string | null): { kind: 'pair' | 'sub'; records: ConnectRecord[] } {
  const d = String(domain || '').toLowerCase().replace(/\.$/, '');
  const bare = d.startsWith('www.') ? d.slice(4) : d;
  const reg = String(registered || '').toLowerCase() || guessRegistered(bare);
  const site = target || '';
  if (bare === reg || !bare.endsWith('.' + reg)) return { kind: 'pair', records: [
    { type: 'A', host: '@', name: bare, value: NETLIFY_APEX_IP },
    { type: 'CNAME', host: 'www', name: 'www.' + bare, value: site },
  ] };
  return { kind: 'sub', records: [{ type: 'CNAME', host: d.slice(0, -(reg.length + 1)), name: d, value: site }] };
}

export async function domainHealth(site: { custom_domain: string | null; netlify_site_id: string | null }, pre: DomainRead = {}) {
  if (!site.custom_domain) {
    const nf = site.netlify_site_id ? await getSite(site.netlify_site_id) : { ok: false as const, site: undefined };
    return {
      custom_domain: null, health: 'no_domain',
      message: 'No custom domain attached — the site serves from its netlify.app address.',
      netlify_subdomain: nf.ok && nf.site ? nf.site.default_domain : null,
      dns: null, ssl: null,
    };
  }
  const nf = 'nf' in pre ? pre.nf : site.netlify_site_id ? await getSite(site.netlify_site_id) : null;
  const target = nf && nf.ok && nf.site ? nf.site.default_domain.toLowerCase() : null;
  const { cnames, aRecords } = pre.lookups || await lookupName(site.custom_domain);
  const dnsOk = (target !== null && cnames.includes(target)) || aRecords.some((ip) => NETLIFY_APEX_IPS.has(ip));
  const ssl = ('ssl' in pre ? pre.ssl : site.netlify_site_id ? await sslStatus(site.netlify_site_id) : null) || { ok: false, state: 'unknown', expires_at: null };
  const sslOk = certIsOn(ssl.state);
  const health = !dnsOk ? 'dns_pending' : !sslOk ? 'ssl_pending' : 'ok';
  const message =
    health === 'ok' ? 'The records point at the site and the padlock is on.'
    : health === 'ssl_pending' ? `The records are right. The padlock is being switched on. ${DOMAIN_WAIT}`
    : `The records for ${site.custom_domain} don’t point at the site yet${aRecords.length ? ` (it goes to ${aRecords.join(', ')} now)` : ' (no record found)'}.`;
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

// ── "Connected" means the domain shows OUR site, and both names work (item 134,
//    review findings 3 and 5) ──────────────────────────────────────────────────
// Uptime used to call any normal answer "Connected", so a registrar's parking page,
// an old host or a caching proxy all read as healthy. Our own July incident was
// exactly that (docs/runbooks/DOMAIN-STALE-CACHE.md): "serves Netlify headers" is
// not "serves our deploy", and only comparing the page proves it. So once a day the
// home page at the domain is compared with the home page at the site's own hosting
// address, byte for byte, and both names (the bare name and "www.") are checked.

export type Serving = 'latest' | 'old_copy' | 'other' | 'unreachable';

/** Pure: what the domain is showing, from the two fetches. */
export function classifyServing(d: { ok: boolean; server: string; hash: string | null }, origin: { ok: boolean; hash: string | null }): Serving | null {
  if (!origin.ok || !origin.hash) return null;            // our own copy didn't answer: nothing to compare with
  if (!d.ok || !d.hash) return 'unreachable';
  if (d.hash === origin.hash) return 'latest';
  return /netlify/i.test(d.server) ? 'old_copy' : 'other';  // Netlify, but not this deploy (another project, a cache); or someone else entirely
}

/** Pure: the other name of the pair, or null for a sub-name that has no "www." twin.
 *  `registered` is the registered name the lookup found (lib/rdap.ts), when known. */
export function twinName(domain: string, registered?: string | null): string | null {
  const d = String(domain || '').toLowerCase();
  if (d.startsWith('www.')) return d.slice(4);
  const reg = String(registered || '').toLowerCase();
  if (reg) return d === reg ? 'www.' + d : null;       // a sub-name (shop.example.com) has no "www." twin
  return d.split('.').length === 2 ? 'www.' + d : null;  // not looked up yet: only a plain two-part name is surely registered
}

export interface NameCheck { name: string; points: boolean; leftovers: string[] }
export interface CheckLine { key: string; ok: boolean; words: string }

/** Pure: the checklist the sheet and the Domains page show, one line per thing. */
export function domainChecklist(i: { domain: string; names: NameCheck[]; padlockOn: boolean; padlockNames: string[]; serving: Serving | null; compared?: boolean }): CheckLine[] {
  const out: CheckLine[] = [];
  for (const n of i.names) {
    out.push({ key: `points:${n.name}`, ok: n.points, words: n.points ? `${n.name} points here` : `${n.name} doesn’t point here yet` });
    for (const ip of n.leftovers) out.push({ key: `leftover:${n.name}:${ip}`, ok: false, words: `An old record is still on ${n.name}: delete ${ip} at the provider` });
  }
  if (i.padlockOn) {
    const missing = i.names.filter((n) => n.points && i.padlockNames.length && !i.padlockNames.includes(n.name)).map((n) => n.name);
    out.push(missing.length
      ? { key: 'padlock', ok: false, words: `The padlock doesn’t cover ${missing.join(' or ')} yet` }
      : { key: 'padlock', ok: true, words: i.names.length > 1 ? 'The padlock covers both names' : 'The padlock is on' });
  } else out.push({ key: 'padlock', ok: false, words: 'The padlock isn’t on yet' });
  // Nov 12 review, finding 16: when our own copy of the page didn't answer there was nothing to
  // compare with, and the list used to pass without the comparison. Now that is a line of its own.
  if (i.serving === null && i.compared === false) out.push({ key: 'serving', ok: false, words: 'We couldn’t compare the page just now. Check again in a minute' });
  if (i.serving) out.push({ key: 'serving', ok: i.serving === 'latest', words: {
    latest: 'Showing your latest site',
    old_copy: 'Showing an old copy of the site (another hosting project or a cache is answering)',
    other: 'Showing something else (a parking page, an old host or a proxy)',
    unreachable: `${i.domain} didn’t answer just now`,
  }[i.serving] });
  return out;
}
export const checklistOk = (lines: CheckLine[]) => lines.length > 0 && lines.every((l) => l.ok);

async function pageHash(url: string): Promise<{ ok: boolean; server: string; hash: string | null }> {
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(8000), headers: { 'Cache-Control': 'no-cache', 'User-Agent': 'StudioOS-DomainCheck/1.0' } });
    if (!r.ok) { await r.body?.cancel().catch(() => {}); return { ok: false, server: String(r.headers.get('server') || ''), hash: null }; }
    const buf = new Uint8Array(await r.arrayBuffer());
    const dig = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
    return { ok: true, server: String(r.headers.get('server') || ''), hash: Array.from(dig).map((b) => b.toString(16).padStart(2, '0')).join('') };
  } catch { return { ok: false, server: '', hash: null }; }
}

const IS_ADDRESS = /^\d{1,3}(\.\d{1,3}){3}$/;
/** Pure: one name's check, from its two lookups. An address lookup on a name that is a pointer
 *  answers with the pointer first and the addresses behind it after, so `aRecords` can hold a
 *  NAME ("www" pointing at the bare domain is how most providers set it up). That name used to
 *  be read as an old record: "delete x.com at the provider", and an owner who obeyed took www.
 *  offline (Nov 12 review, finding 17). Leftovers are real addresses only, and only on a name
 *  that holds its own records: behind a pointer the addresses belong to the name pointed at,
 *  which is checked on its own line. */
export function nameCheckFrom(name: string, target: string | null, cnames: string[], aRecords: string[]): NameCheck {
  const viaCname = target !== null && cnames.includes(target);
  const ours = aRecords.filter((ip) => NETLIFY_APEX_IPS.has(ip));
  const leftovers = cnames.length ? [] : aRecords.filter((ip) => IS_ADDRESS.test(ip) && !NETLIFY_APEX_IPS.has(ip) && ours.length > 0);
  return { name, points: viaCname || ours.length > 0, leftovers };
}
export async function checkName(name: string, target: string | null): Promise<NameCheck> {
  const { cnames, aRecords } = await lookupName(name);
  return nameCheckFrom(name, target, cnames, aRecords);
}

/** The live checks for one hosted site: both names, the padlock's names, and what the domain shows. */
export async function domainTruth(site: { custom_domain: string; netlify_site_id: string }, registered?: string | null, pre: DomainRead = {}) {
  const nf = 'nf' in pre ? pre.nf : await getSite(site.netlify_site_id);
  const target = nf && nf.ok && nf.site ? nf.site.default_domain.toLowerCase() : null;
  const twin = twinName(site.custom_domain, registered);
  const names = pre.names || await Promise.all([site.custom_domain, ...(twin ? [twin] : [])].map((n) => checkName(n.toLowerCase(), target)));
  const ssl = ('ssl' in pre ? pre.ssl : await sslStatus(site.netlify_site_id)) || { ok: false, state: 'unknown', expires_at: null };
  const [atDomain, atOrigin] = await Promise.all([pageHash(`https://${site.custom_domain}/`), target ? pageHash(`https://${target}/`) : Promise.resolve({ ok: false, server: '', hash: null })]);
  const serving = classifyServing(atDomain, atOrigin);
  const lines = domainChecklist({ domain: site.custom_domain, names, padlockOn: certIsOn(ssl.state), padlockNames: ssl.domains || [], serving, compared: serving !== null });
  return { serving, checklist: lines, all_ok: checklistOk(lines) };
}
