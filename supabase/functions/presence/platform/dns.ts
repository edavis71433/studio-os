// ── DNS as a service layer (M12) — validation, templates, plain language ────
// Customers never need to understand these records; this module is where the
// platform does. Validation and templates are PURE; the zone read is the one
// I/O (DNS-over-HTTPS, read-only). The M10 infrastructure provider keeps
// OBSERVING problems through the evidence pipeline — this layer EXPLAINS the
// zone and PREPARES exact fixes; no parallel monitoring exists.

export type RecordType = 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'SRV' | 'CAA' | 'NS';
export interface DnsRecord { type: RecordType; name: string; value: string; priority?: number; ttl?: number }

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6 = /^[0-9a-f:]+$/i;
const HOSTNAME = /^(?=.{1,253}$)(\*\.)?([a-z0-9_]([a-z0-9-_]{0,61}[a-z0-9_])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.?$/i;

/** PURE record validation — every supported type, plus SPF/DKIM/DMARC as TXT specializations. */
export function validateRecord(r: DnsRecord): { ok: boolean; problem?: string } {
  if (!r.name || r.name.length > 253) return { ok: false, problem: 'The record name is missing or too long.' };
  switch (r.type) {
    case 'A': {
      const m = r.value.match(IPV4);
      if (!m || m.slice(1).some((o) => Number(o) > 255)) return { ok: false, problem: 'An A record needs a valid IPv4 address like 75.2.60.5.' };
      return { ok: true };
    }
    case 'AAAA':
      return IPV6.test(r.value) && r.value.includes(':') ? { ok: true } : { ok: false, problem: 'An AAAA record needs a valid IPv6 address.' };
    case 'CNAME':
      if (!HOSTNAME.test(r.value)) return { ok: false, problem: 'A CNAME must point at a hostname, not an address.' };
      if (r.name.split('.').length <= 2 && !r.name.startsWith('www')) return { ok: false, problem: 'A CNAME can’t sit on the bare domain — use an A record (or your host’s ALIAS) at the apex.' };
      return { ok: true };
    case 'MX':
      if (!Number.isInteger(r.priority) || r.priority! < 0 || r.priority! > 65535) return { ok: false, problem: 'An MX record needs a priority number (10 is typical).' };
      return HOSTNAME.test(r.value) ? { ok: true } : { ok: false, problem: 'An MX record must point at a mail server hostname.' };
    case 'TXT': {
      if (!r.value || r.value.length > 4096) return { ok: false, problem: 'A TXT record needs a value under 4096 characters.' };
      if (r.value.startsWith('v=spf1')) {
        if (!/[+~-]all\s*$/.test(r.value)) return { ok: false, problem: 'An SPF record should end with ~all or -all so forgeries are actually rejected.' };
        if ((r.value.match(/\bv=spf1\b/g) || []).length > 1) return { ok: false, problem: 'Only one v=spf1 marker per record.' };
      }
      if (r.name.startsWith('_dmarc') && !/^v=DMARC1;\s*p=(none|quarantine|reject)/i.test(r.value)) {
        return { ok: false, problem: 'A DMARC record starts with v=DMARC1; p=none|quarantine|reject.' };
      }
      if (/\._domainkey/.test(r.name) && !/v=DKIM1/i.test(r.value)) {
        return { ok: false, problem: 'A DKIM record carries v=DKIM1 and the public key from your mail provider.' };
      }
      return { ok: true };
    }
    case 'SRV':
      return /^\d+ \d+ \d+ \S+$/.test(r.value) ? { ok: true } : { ok: false, problem: 'An SRV value is "priority weight port target".' };
    case 'CAA':
      return /^\d+ (issue|issuewild|iodef) "/.test(r.value) ? { ok: true } : { ok: false, problem: 'A CAA value looks like: 0 issue "letsencrypt.org".' };
    case 'NS':
      return HOSTNAME.test(r.value) ? { ok: true } : { ok: false, problem: 'An NS record points at a name server hostname.' };
    default:
      return { ok: false, problem: 'Unsupported record type.' };
  }
}

/** PURE plain-language translation — the customer's sentence for any record. */
export function explainRecord(r: DnsRecord): string {
  if (r.type === 'A' || r.type === 'AAAA') return `Points ${r.name} at your website’s server.`;
  if (r.type === 'CNAME') return `Makes ${r.name} follow ${r.value} — an alias, not a copy.`;
  if (r.type === 'MX') return `Tells the internet where email for ${r.name.replace(/^@\.?/, '')} should be delivered.`;
  if (r.type === 'TXT' && r.value.startsWith('v=spf1')) return 'Lists who is allowed to send email as you — forgeries get caught.';
  if (r.type === 'TXT' && r.name.startsWith('_dmarc')) return 'Tells inboxes what to do with email that fails your checks.';
  if (r.type === 'TXT' && /\._domainkey/.test(r.name)) return 'A signature key so inboxes can prove your email wasn’t altered.';
  if (r.type === 'TXT') return 'A small note other services read to verify or configure things.';
  if (r.type === 'SRV') return 'Points a specific service (like calling or chat) at the right server.';
  if (r.type === 'CAA') return 'Restricts who may issue security certificates for your domain.';
  if (r.type === 'NS') return 'Names the servers that answer all DNS questions for your domain.';
  return 'A DNS record.';
}

/* ── the apex target — ONE authoritative source (business-continuity hardening) ──
 * The bare-domain (apex) A record for a Netlify-hosted site points at Netlify's
 * load-balancer IP. That value used to be a bare literal (75.2.60.5) copied into
 * the point-domain template AND the domain-health check — so if Netlify ever
 * retired the IP, every guided-connected customer's apex would break SILENTLY,
 * with the fix scattered across files. Two defenses now live here:
 *   1. ONE named constant — the single place to change if the IP ever moves,
 *      instead of a literal duplicated across templates and health checks.
 *   2. PREFER the self-updating path — an ALIAS / ANAME / CNAME-flattening record
 *      at the apex, pointed at the site's own <name>.netlify.app hostname, follows
 *      Netlify automatically and is immune to an IP change. The fixed A record is
 *      the universal LAST RESORT for DNS hosts that can't flatten at the apex.
 *      `apexGuidance()` expresses that preference; `apexMatchesExpected()` verifies
 *      a live apex still points home (drift detection). */
export const NETLIFY_APEX_IP = '75.2.60.5';

export interface ApexExpectation { target: string | null; ip?: string }

/** The apex setup we hand a customer: the universally-valid A record (sourced from
 *  the ONE constant) plus a plain-language recommendation to prefer an ALIAS/ANAME/
 *  CNAME-flattening record to the netlify target where the DNS host supports it
 *  (self-updating, never needs a value change). PURE. `target` is the site's
 *  <name>.netlify.app hostname when known. */
export function apexGuidance(domain: string, target?: string | null): { record: DnsRecord; recommended: string } {
  const record: DnsRecord = { type: 'A', name: domain, value: NETLIFY_APEX_IP, ttl: 3600 };
  const recommended = target
    ? `Preferred: if your DNS host offers an ALIAS, ANAME, or CNAME-flattening record at the apex, point ${domain} at ${target.replace(/\.$/, '')} — it follows your site automatically and never needs updating. Otherwise add the A record to ${NETLIFY_APEX_IP}.`
    : `Add an A record for ${domain} to ${NETLIFY_APEX_IP}. If your DNS host offers an ALIAS/ANAME/CNAME-flattening record at the apex, that self-updating path is preferred once the hosting target is known.`;
  return { record, recommended };
}

/** PURE apex verification — does the live apex still point at the site? Formalizes
 *  (and is the single source for) the domain-health check: a CNAME/ALIAS-flattened
 *  value equal to the netlify `target`, OR an A record equal to the expected IP,
 *  counts as correct. Anything else that RESOLVES is drift (a wrong/stale record);
 *  nothing resolving is "unresolved" (a different, already-observed condition). */
export function apexMatchesExpected(
  observed: { aRecords: string[]; cnames: string[] },
  expected: ApexExpectation,
): { ok: boolean; resolved: boolean; reason: string } {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\.$/, '');
  const a = observed.aRecords.map(norm).filter(Boolean);
  const c = observed.cnames.map(norm).filter(Boolean);
  const target = expected.target ? norm(expected.target) : null;
  const ip = (expected.ip ?? NETLIFY_APEX_IP).toLowerCase();
  const resolved = a.length > 0 || c.length > 0;
  if (!resolved) return { ok: false, resolved: false, reason: 'The bare domain doesn’t answer yet.' };
  if ((target !== null && c.includes(target)) || a.includes(ip)) {
    return { ok: true, resolved: true, reason: 'The bare domain points at your site.' };
  }
  const where = [...c, ...a].slice(0, 3).join(', ') || 'an unexpected address';
  return { ok: false, resolved: true, reason: `The bare domain points at ${where} instead of ${target || ip}.` };
}

/** Read the live apex through the DoH zone read and compare it to what it SHOULD
 *  be. Fenced I/O + a pure comparison. Returns drift with the observed values so a
 *  caller can surface a plain-language finding. */
export async function verifyApex(domain: string, expected: ApexExpectation, nowIso: string): Promise<{ ok: boolean; resolved: boolean; reason: string; aRecords: string[]; cnames: string[] }> {
  const zone = await readZone(domain, nowIso);
  const aRecords = zone.records.filter((r) => r.type === 'A' && r.name === domain).map((r) => r.value);
  const cnames = zone.records.filter((r) => r.type === 'CNAME' && r.name === domain).map((r) => r.value);
  const cmp = apexMatchesExpected({ aRecords, cnames }, expected);
  return { ...cmp, aRecords, cnames };
}

/* ── templates — goals become exact records (PURE) ── */
export function templateRecords(goal: 'point_domain' | 'email_auth' | 'verify_ownership', p: { domain: string; target?: string; token?: string; mailNote?: string }): DnsRecord[] {
  if (goal === 'point_domain') return [
    // Apex A record from the ONE authoritative constant. Prefer an ALIAS/ANAME to
    // p.target where the host supports it (see apexGuidance) — this A record is the
    // universal fallback and the single place to update if Netlify's IP ever moves.
    { type: 'A', name: p.domain, value: NETLIFY_APEX_IP, ttl: 3600 },
    { type: 'CNAME', name: `www.${p.domain}`, value: p.target || `${p.domain}.`, ttl: 3600 },
  ];
  if (goal === 'email_auth') return [
    { type: 'TXT', name: p.domain, value: 'v=spf1 include:_spf.google.com ~all', ttl: 3600 },
    { type: 'TXT', name: `_dmarc.${p.domain}`, value: 'v=DMARC1; p=none; rua=mailto:postmaster@' + p.domain, ttl: 3600 },
    // DKIM comes from the mail provider — named honestly, never invented:
    { type: 'TXT', name: `google._domainkey.${p.domain}`, value: 'v=DKIM1; (copy the key from your email provider’s admin panel)', ttl: 3600 },
  ];
  return [{ type: 'TXT', name: `_dds-verify.${p.domain}`, value: p.token || '', ttl: 300 }];
}

/* ── the zone read — DNS-over-HTTPS, read-only, fenced by the caller ── */
export interface ZoneSnapshot { domain: string; records: DnsRecord[]; taken_at: string }
const DOH = 'https://cloudflare-dns.com/dns-query';
const TYPES: Array<[RecordType, number]> = [['A', 1], ['AAAA', 28], ['CNAME', 5], ['MX', 15], ['TXT', 16], ['NS', 2], ['CAA', 257]];

/** Is a DKIM record actually published at `host` (e.g. google._domainkey.acme.com)?
 *  Fenced DoH TXT read. Returns true (a v=DKIM1 record answers), false (the host
 *  resolves nothing DKIM-shaped), or null (the lookup itself failed — never claim
 *  "missing" from a failed probe). PURE-adjacent: one read-only lookup, no writes. */
export async function dkimPresent(host: string): Promise<boolean | null> {
  try {
    const r = await fetch(`${DOH}?name=${encodeURIComponent(host)}&type=16`, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null;
    const j = await r.json();
    const answers = Array.isArray(j?.Answer) ? j.Answer : [];
    return answers.some((a: { data?: string }) => /v=DKIM1/i.test(String(a?.data || '')));
  } catch { return null; }
}

export async function readZone(domain: string, nowIso: string): Promise<ZoneSnapshot> {
  const records: DnsRecord[] = [];
  const lookup = async (name: string, type: RecordType) => {
    try {
      const r = await fetch(`${DOH}?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(4000) });
      if (!r.ok) return;
      const j = await r.json();
      for (const a of (Array.isArray(j?.Answer) ? j.Answer : [])) {
        const value = String(a.data || '').replace(/^"|"$/g, '');
        if (type === 'MX') { const m = value.match(/^(\d+)\s+(.+)$/); records.push({ type, name, value: m?.[2] ?? value, priority: m ? Number(m[1]) : undefined, ttl: a.TTL }); }
        else records.push({ type, name, value, ttl: a.TTL });
      }
    } catch { /* fenced: an unreachable resolver reads as an empty section */ }
  };
  await Promise.all([
    ...TYPES.map(([t]) => lookup(domain, t)),
    lookup(`www.${domain}`, 'CNAME'), lookup(`www.${domain}`, 'A'),
    lookup(`_dmarc.${domain}`, 'TXT'),
  ]);
  records.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name) || a.value.localeCompare(b.value));
  return { domain, records, taken_at: nowIso };
}
