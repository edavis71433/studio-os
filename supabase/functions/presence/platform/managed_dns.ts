// ── Managed DNS (slice D1) — the 'automatic' adapter the contract promised ──
// platform/contract.ts declared DNS write:'guided' with the note that a
// write-capable adapter slots in as 'automatic' "without touching anything
// above it". This is that adapter: AWS Route 53 behind the same DnsRecord
// vocabulary the whole spine already speaks (platform/dns.ts). Everything
// customer-visible stays plain-language; everything here is either PURE
// (conversions, guardrails, scan lists, SPF merge — all unit-tested) or a
// fenced I/O composition over lib/route53.ts + DoH reads.
//
// DORMANT + FAIL-CLOSED: dnsWriteActive() reads the secrets at call time;
// when absent every operation refuses honestly and the platform stays in
// guided mode — exactly the shipped behavior of today.
import * as r53 from '../lib/route53.ts';
import { NETLIFY_APEX_IP, validateRecord } from './dns.ts';
import type { DnsRecord, RecordType } from './dns.ts';
import type { DnsProvider } from './contract.ts';

/* ── the adapter card (contract registration lives in contract.ts) ── */
export const route53Dns: DnsProvider = {
  slug: 'route53', name: 'Managed DNS',
  // dnssec 'guided': the DS pre-check + registrar guidance is real; signing
  // customer zones is NOT offered in D1 — never claim what we cannot do.
  capabilities: { read: 'automatic', write: 'automatic', dnssec: 'guided' },
};
export function dnsWriteActive(): boolean { return r53.route53Configured(); }

/* ── branded nameservers (Eric's decision: white-label, Shopify-style) ── */
export const BRANDED_NS = ['ns1.davisdigitalstudio.com', 'ns2.davisdigitalstudio.com', 'ns3.davisdigitalstudio.com', 'ns4.davisdigitalstudio.com'];

/* ═══ PURE: record ↔ rrset conversion ═══ */

const stripDot = (s: string): string => (s || '').replace(/\.$/, '');
const fqdn = (s: string): string => stripDot(s).toLowerCase() + '.';

/** TXT values travel quoted (and chunked at 255 chars) on the wire. */
export function txtToWire(value: string): string {
  const esc = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const chunks: string[] = [];
  for (let i = 0; i < esc.length; i += 255) chunks.push(`"${esc.slice(i, i + 255)}"`);
  return chunks.length ? chunks.join(' ') : '""';
}
export function txtFromWire(wire: string): string {
  const parts = wire.match(/"((?:[^"\\]|\\.)*)"/g);
  if (!parts) return wire;
  return parts.map((p) => p.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')).join('');
}

/** One DnsRecord value → its Route 53 wire value. */
export function recordToWireValue(r: DnsRecord): string {
  if (r.type === 'TXT') return txtToWire(r.value);
  if (r.type === 'MX') return `${r.priority ?? 10} ${fqdn(r.value)}`;
  if (r.type === 'CNAME' || r.type === 'NS') return fqdn(r.value);
  if (r.type === 'SRV') { const m = r.value.match(/^(\d+ \d+ \d+ )(\S+)$/); return m ? m[1] + fqdn(m[2]) : r.value; }
  return r.value;
}

/** One rrset wire value → a DnsRecord. */
export function wireValueToRecord(name: string, type: string, ttl: number, value: string): DnsRecord {
  const n = stripDot(name).replace(/\\052/g, '*');
  if (type === 'TXT') return { type: 'TXT', name: n, value: txtFromWire(value), ttl };
  if (type === 'MX') {
    const m = value.match(/^(\d+)\s+(.+)$/);
    return { type: 'MX', name: n, value: stripDot(m?.[2] ?? value), priority: m ? Number(m[1]) : undefined, ttl };
  }
  if (type === 'CNAME' || type === 'NS') return { type: type as RecordType, name: n, value: stripDot(value), ttl };
  if (type === 'SRV') return { type: 'SRV', name: n, value: value.replace(/(\S)\.$/, '$1'), ttl };
  return { type: type as RecordType, name: n, value, ttl };
}

export function rrsetsToRecords(rrsets: r53.Rrset[]): DnsRecord[] {
  const out: DnsRecord[] = [];
  for (const s of rrsets) {
    if (s.type === 'SOA') continue;   // zone plumbing, never customer-facing
    for (const v of s.values) out.push(wireValueToRecord(s.name, s.type, s.ttl, v));
  }
  return out;
}

const rrKey = (name: string, type: string): string => `${type}|${stripDot(name).toLowerCase()}`;
const recKey = (r: DnsRecord): string => rrKey(r.name, r.type);
const valueKey = (r: DnsRecord): string => r.type === 'CNAME' || r.type === 'NS' || r.type === 'MX'
  ? stripDot(r.value).toLowerCase() + (r.type === 'MX' ? `|${r.priority ?? ''}` : '')
  : (r.value || '').trim();
export const sameRecord = (a: DnsRecord, b: DnsRecord): boolean => recKey(a) === recKey(b) && valueKey(a) === valueKey(b);

/* ═══ PURE: guardrails ═══ */

export type ProtectedClass = 'mx' | 'spf' | 'dkim' | 'dmarc' | 'site';

/** The protected classes (spec §2 guardrails): email-critical records and the
 *  records that keep the website itself answering. Mutations require an
 *  explicit confirm:true — friction proportional to blast radius. */
export function protectedClass(r: DnsRecord, domain: string): ProtectedClass | null {
  const name = stripDot(r.name).toLowerCase();
  const apex = stripDot(domain).toLowerCase();
  if (r.type === 'MX') return 'mx';
  if (r.type === 'TXT' && /^v=spf1\b/i.test(r.value || '')) return 'spf';
  if (name.includes('._domainkey')) return 'dkim';
  if (name.startsWith('_dmarc')) return 'dmarc';
  if ((r.type === 'A' || r.type === 'AAAA' || r.type === 'CNAME') && (name === apex || name === `www.${apex}`)) return 'site';
  if (r.type === 'TXT' && name === `_dds-verify.${apex}`) return 'site';
  return null;
}

/** SPF is MERGE, never append: two v=spf1 TXT records at one name is itself an
 *  SPF error (RFC 7208 §4.5 permerror). Mechanisms union (existing first,
 *  order preserved, deduped); the existing record's `all` qualifier wins —
 *  merging must never LOOSEN a policy the customer already chose. */
export function mergeSpf(existing: string, incoming: string): string {
  const parse = (v: string) => {
    const terms = v.trim().split(/\s+/).filter(Boolean);
    const mech = terms.filter((t) => !/^v=spf1$/i.test(t) && !/^[+~?-]?all$/i.test(t));
    const all = terms.find((t) => /^[+~?-]?all$/i.test(t)) || null;
    return { mech, all };
  };
  const a = parse(existing), b = parse(incoming);
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const m of [...a.mech, ...b.mech]) { const k = m.toLowerCase(); if (!seen.has(k)) { seen.add(k); merged.push(m); } }
  return ['v=spf1', ...merged, a.all || b.all || '~all'].join(' ');
}

/* ═══ PURE: the onboarding record scan (spec §2 step 2 — fixed name list) ═══ */

export function scanTargets(domain: string): Array<{ name: string; types: RecordType[] }> {
  const d = stripDot(domain).toLowerCase();
  return [
    { name: d, types: ['A', 'AAAA', 'MX', 'TXT', 'CAA'] },
    { name: `www.${d}`, types: ['CNAME', 'A', 'AAAA'] },
    { name: `mail.${d}`, types: ['CNAME', 'A', 'AAAA'] },
    { name: `ftp.${d}`, types: ['CNAME', 'A'] },
    { name: `autodiscover.${d}`, types: ['CNAME', 'A'] },
    { name: `autoconfig.${d}`, types: ['CNAME', 'A'] },
    { name: `_dmarc.${d}`, types: ['TXT'] },
    // the common DKIM selectors (Google, generic, Microsoft 365 ×2, Mailchimp, Zoho)
    { name: `google._domainkey.${d}`, types: ['TXT', 'CNAME'] },
    { name: `default._domainkey.${d}`, types: ['TXT', 'CNAME'] },
    { name: `selector1._domainkey.${d}`, types: ['CNAME', 'TXT'] },
    { name: `selector2._domainkey.${d}`, types: ['CNAME', 'TXT'] },
    { name: `k1._domainkey.${d}`, types: ['CNAME', 'TXT'] },
    { name: `zmail._domainkey.${d}`, types: ['TXT'] },
    { name: `_dds-verify.${d}`, types: ['TXT'] },
    { name: `_autodiscover._tcp.${d}`, types: ['SRV'] },
    { name: `_sip._tls.${d}`, types: ['SRV'] },
  ];
}

/** What a scan may import into the new zone. Zone plumbing (NS/SOA) never
 *  imports; an apex CNAME is invalid; apex/www address records are REPLACED
 *  by the platform's site records (reported, not silently dropped). */
export function importFilter(scanned: DnsRecord[], domain: string): { keep: DnsRecord[]; replaced: DnsRecord[]; dropped: DnsRecord[] } {
  const apex = stripDot(domain).toLowerCase();
  const keep: DnsRecord[] = []; const replaced: DnsRecord[] = []; const dropped: DnsRecord[] = [];
  const seen = new Set<string>();
  for (const r of scanned) {
    const name = stripDot(r.name).toLowerCase();
    const dedupe = `${recKey(r)}|${valueKey(r)}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    if (r.type === 'NS' || (r.type as string) === 'SOA') { dropped.push(r); continue; }
    if (r.type === 'CNAME' && name === apex) { dropped.push(r); continue; }
    if ((r.type === 'A' || r.type === 'AAAA' || r.type === 'CNAME') && (name === apex || name === `www.${apex}`)) { replaced.push(r); continue; }
    keep.push(r);
  }
  return { keep, replaced, dropped };
}

/** The records the platform itself places at cutover: apex A (the ONE
 *  authoritative constant), www CNAME, and the _dds-verify TXT when a
 *  verification token exists — never an invented one. */
export function siteRecords(domain: string, netlifyTarget: string | null, verifyToken: string | null): DnsRecord[] {
  const d = stripDot(domain).toLowerCase();
  const out: DnsRecord[] = [
    { type: 'A', name: d, value: NETLIFY_APEX_IP, ttl: 300 },                              // low TTL during cutover (guardrail)
    { type: 'CNAME', name: `www.${d}`, value: netlifyTarget ? stripDot(netlifyTarget) : d, ttl: 300 },
  ];
  if (verifyToken) out.push({ type: 'TXT', name: `_dds-verify.${d}`, value: verifyToken, ttl: 300 });
  return out;
}

/** Which of a plan's guided records can be APPLIED automatically. A record
 *  carrying a placeholder (the DKIM "copy the key from your provider" note)
 *  is guidance, not data — writing it would publish a lie. */
export function applyableRecords(records: DnsRecord[]): { apply: DnsRecord[]; stillGuided: DnsRecord[] } {
  const apply: DnsRecord[] = []; const stillGuided: DnsRecord[] = [];
  for (const r of records) {
    const placeholder = /\(copy the key|\(copy the|your email provider.s admin panel/i.test(r.value || '');
    if (!placeholder && validateRecord(r).ok) apply.push(r); else stillGuided.push(r);
  }
  return { apply, stillGuided };
}

/* ═══ PURE: the change planner (rrset semantics, SPF merge-not-append) ═══ */

export interface PlannedChanges { changes: r53.RrsetChange[]; merged: string[] }

/** Desired records IN → the minimal batch of complete-rrset UPSERTs. Existing
 *  values at a (name,type) are preserved and unioned (never clobbered by a
 *  partial set); CNAMEs replace (singletons by definition); an incoming SPF
 *  merges into an existing SPF instead of appending a second v=spf1. */
export function planUpserts(existing: DnsRecord[], incoming: DnsRecord[]): PlannedChanges {
  const merged: string[] = [];
  const byKey = new Map<string, DnsRecord[]>();
  for (const r of existing) { const k = recKey(r); byKey.set(k, [...(byKey.get(k) || []), r]); }
  const touched = new Map<string, { ttl: number; records: DnsRecord[] }>();
  for (const inc of incoming) {
    const k = recKey(inc);
    const current = touched.get(k)?.records ?? (byKey.get(k) || []).slice();
    let next: DnsRecord[];
    if (inc.type === 'CNAME') next = [inc];   // singleton: replace
    else if (inc.type === 'TXT' && /^v=spf1\b/i.test(inc.value)) {
      const spfIdx = current.findIndex((r) => /^v=spf1\b/i.test(r.value));
      if (spfIdx >= 0 && current[spfIdx].value.trim() !== inc.value.trim()) {
        const m = mergeSpf(current[spfIdx].value, inc.value);
        next = current.map((r, i) => i === spfIdx ? { ...r, value: m } : r);
        merged.push(m);
      } else if (spfIdx >= 0) next = current;
      else next = [...current, inc];
    } else if (current.some((r) => valueKey(r) === valueKey(inc))) next = current;
    else next = [...current, inc];
    touched.set(k, { ttl: inc.ttl || current[0]?.ttl || 300, records: next });
  }
  const changes: r53.RrsetChange[] = [];
  for (const [k, v] of touched) {
    const before = byKey.get(k) || [];
    const unchanged = before.length === v.records.length && v.records.every((r) => before.some((b) => valueKey(b) === valueKey(r) && (b.value === r.value)));
    if (unchanged) continue;
    const first = v.records[0];
    changes.push({ action: 'UPSERT', rrset: { name: fqdn(first.name), type: first.type, ttl: v.ttl, values: v.records.map(recordToWireValue) } });
  }
  return { changes, merged };
}

/** Remove ONE value from its rrset: UPSERT the remainder, or DELETE the rrset
 *  when it was the last value. Returns null when the record isn't in the zone. */
export function planRemoval(existing: DnsRecord[], target: DnsRecord, currentRrsets: r53.Rrset[]): r53.RrsetChange | null {
  const setRecords = existing.filter((r) => recKey(r) === recKey(target));
  const hit = setRecords.find((r) => valueKey(r) === valueKey(target));
  if (!hit) return null;
  const rr = currentRrsets.find((s) => rrKey(s.name, s.type) === recKey(target));
  const ttl = rr?.ttl || hit.ttl || 300;
  const remainder = setRecords.filter((r) => valueKey(r) !== valueKey(target));
  if (!remainder.length) {
    return { action: 'DELETE', rrset: { name: fqdn(target.name), type: target.type, ttl, values: rr ? rr.values : [recordToWireValue(hit)] } };
  }
  return { action: 'UPSERT', rrset: { name: fqdn(target.name), type: target.type, ttl, values: remainder.map(recordToWireValue) } };
}

/** Merge applied records into the desired-zone document (write-through so the
 *  existing drift machinery keeps working, untouched). Extra keys like
 *  `source` ride along harmlessly in the jsonb document. */
export function mergeDesired(existing: Array<DnsRecord & { source?: string }>, applied: DnsRecord[], source: string): Array<DnsRecord & { source?: string }> {
  const out = existing.slice();
  for (const r of applied) {
    const i = out.findIndex((e) => recKey(e) === recKey(r) && (r.type === 'CNAME' || valueKey(e) === valueKey(r)));
    if (i >= 0) out[i] = { ...out[i], ...r };
    else out.push({ ...r, source });
  }
  return out.slice(0, 200);
}

/* ═══ fenced DoH reads (pre-flight + propagation) ═══ */

const DOH = 'https://cloudflare-dns.com/dns-query';
const TYPE_CODES: Record<string, number> = { A: 1, NS: 2, CNAME: 5, SOA: 6, MX: 15, TXT: 16, AAAA: 28, SRV: 33, DS: 43, CAA: 257 };

async function dohAnswers(name: string, type: string): Promise<Array<{ data: string; TTL?: number }> | null> {
  try {
    const r = await fetch(`${DOH}?name=${encodeURIComponent(name)}&type=${TYPE_CODES[type] ?? type}`,
      { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null;
    const j = await r.json();
    const code = TYPE_CODES[type];
    return (Array.isArray(j?.Answer) ? j.Answer : []).filter((a: { type?: number }) => !code || a?.type === code);
  } catch { return null; }
}

/** DNSSEC DS pre-flight. A stale DS record at the parent breaks delegation
 *  the moment nameservers change — three-state honest answer:
 *  'present' (block with guidance), 'absent' (safe), 'unknown' (the probe
 *  failed — refuse to proceed; never claim safe from a failed lookup). */
export async function checkDs(domain: string): Promise<'present' | 'absent' | 'unknown'> {
  const answers = await dohAnswers(stripDot(domain), 'DS');
  if (answers === null) return 'unknown';
  return answers.length > 0 ? 'present' : 'absent';
}

/** The honest import scan: the fixed name list over DoH. A failed lookup on
 *  one name reads as empty for that name (fenced) — the customer confirms the
 *  found set; nothing here pretends to be exhaustive. */
export async function scanZone(domain: string): Promise<DnsRecord[]> {
  const found: DnsRecord[] = [];
  await Promise.all(scanTargets(domain).flatMap(({ name, types }) => types.map(async (t) => {
    const answers = await dohAnswers(name, t);
    for (const a of answers || []) {
      const value = String(a.data || '');
      found.push(wireValueToRecord(name, t, Number(a.TTL) || 300, t === 'TXT' ? value : value));
    }
  })));
  found.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name) || a.value.localeCompare(b.value));
  return found;
}

/** The domain's live NS set as the public internet sees it. null = probe failed. */
export async function publicNameservers(domain: string): Promise<string[] | null> {
  const answers = await dohAnswers(stripDot(domain), 'NS');
  if (answers === null) return null;
  return answers.map((a) => stripDot(String(a.data || '')).toLowerCase()).filter(Boolean);
}

export async function resolveIps(host: string): Promise<string[]> {
  const [a, aaaa] = await Promise.all([dohAnswers(host, 'A'), dohAnswers(host, 'AAAA')]);
  return [...(a || []), ...(aaaa || [])].map((x) => String(x.data || '')).filter(Boolean);
}

/** Has delegation reached us? True when ANY observed NS is one of ours
 *  (branded or raw AWS) — registrar changes propagate name-by-name. */
export function nsPropagated(observed: string[], awsNs: string[], branded: string[]): boolean {
  const ours = new Set([...awsNs, ...branded].map((n) => stripDot(n).toLowerCase()));
  return observed.some((n) => ours.has(n));
}

/* ═══ fenced Route 53 compositions (the adapter's write surface) ═══ */

export interface ZoneHandle { zoneId: string; nameservers: string[]; delegationSetId: string; created: boolean }

/** Idempotent zone materialization: the ONE delegation set (created once,
 *  ever), then find-or-create the customer zone inside it. */
export async function ensureZone(domain: string, siteId: string): Promise<{ ok: boolean; zone?: ZoneHandle; error?: string }> {
  if (!dnsWriteActive()) return { ok: false, error: 'not_configured' };
  const ds = await r53.getOrCreateDelegationSet();
  if (!ds.ok || !ds.set) return { ok: false, error: `delegation set: ${ds.error || 'unavailable'}` };
  const found = await r53.findHostedZone(domain);
  if (!found.ok) return { ok: false, error: `zone lookup: ${found.error}` };
  if (found.zone) return { ok: true, zone: { zoneId: found.zone.id, nameservers: ds.set.nameservers, delegationSetId: ds.set.id, created: false } };
  const created = await r53.createHostedZone(domain, ds.set.id, `sos-${siteId}-${Date.now()}`);
  if (!created.ok || !created.zone) return { ok: false, error: `zone create: ${created.error}` };
  return { ok: true, zone: { zoneId: created.zone.id, nameservers: created.nameservers?.length ? created.nameservers : ds.set.nameservers, delegationSetId: ds.set.id, created: true } };
}

/** Apply desired records through the planner (union + SPF merge), one batch. */
export async function applyRecords(zoneId: string, records: DnsRecord[], comment: string): Promise<{ ok: boolean; applied: number; merged: string[]; changeId?: string; error?: string }> {
  if (!dnsWriteActive()) return { ok: false, applied: 0, merged: [], error: 'not_configured' };
  if (!records.length) return { ok: true, applied: 0, merged: [] };
  const live = await r53.listRrsets(zoneId);
  if (!live.ok) return { ok: false, applied: 0, merged: [], error: `zone read: ${live.error}` };
  const plan = planUpserts(rrsetsToRecords(live.rrsets), records);
  if (!plan.changes.length) return { ok: true, applied: 0, merged: plan.merged };
  const w = await r53.changeRrsets(zoneId, plan.changes, comment);
  if (!w.ok) return { ok: false, applied: 0, merged: [], error: `zone write: ${w.error}` };
  return { ok: true, applied: plan.changes.length, merged: plan.merged, changeId: w.changeId };
}

/** Remove one record value (rrset-correct). */
export async function removeRecord(zoneId: string, record: DnsRecord, comment: string): Promise<{ ok: boolean; removed: boolean; error?: string }> {
  if (!dnsWriteActive()) return { ok: false, removed: false, error: 'not_configured' };
  const live = await r53.listRrsets(zoneId);
  if (!live.ok) return { ok: false, removed: false, error: `zone read: ${live.error}` };
  const change = planRemoval(rrsetsToRecords(live.rrsets), record, live.rrsets);
  if (!change) return { ok: true, removed: false };
  const w = await r53.changeRrsets(zoneId, [change], comment);
  if (!w.ok) return { ok: false, removed: false, error: `zone write: ${w.error}` };
  return { ok: true, removed: true };
}

/** Empty a zone of everything but its NS/SOA plumbing, then delete it.
 *  (Route 53 refuses to delete a non-empty zone — the right default.) */
export async function deleteZone(zoneId: string, domain: string): Promise<{ ok: boolean; snapshot: DnsRecord[]; error?: string }> {
  if (!dnsWriteActive()) return { ok: false, snapshot: [], error: 'not_configured' };
  const live = await r53.listRrsets(zoneId);
  if (!live.ok) return { ok: false, snapshot: [], error: `zone read: ${live.error}` };
  const snapshot = rrsetsToRecords(live.rrsets);
  const apex = fqdn(domain);
  const removable = live.rrsets.filter((s) => !((s.type === 'NS' || s.type === 'SOA') && s.name.toLowerCase() === apex));
  if (removable.length) {
    const w = await r53.changeRrsets(zoneId, removable.map((rrset) => ({ action: 'DELETE' as const, rrset })), 'Studio OS: zone detach');
    if (!w.ok) return { ok: false, snapshot, error: `zone empty: ${w.error}` };
  }
  const del = await r53.deleteHostedZone(zoneId);
  if (!del.ok) return { ok: false, snapshot, error: `zone delete: ${del.error}` };
  return { ok: true, snapshot };
}

/** White-label glue map: ns{1-4}.davisdigitalstudio.com ↔ the delegation
 *  set's AWS nameservers + their resolved IPs (the values Eric places as glue
 *  records, one time, at HIS registrar — see docs/presence/DNS-SETUP.md). */
export async function delegationGlue(awsNameservers: string[]): Promise<{ glue: Array<{ host: string; aws_ns: string; ips: string[]; branded_ips: string[] }>; branded_ready: boolean }> {
  const glue = await Promise.all(BRANDED_NS.map(async (host, i) => {
    const awsNs = awsNameservers[i] || '';
    const [ips, brandedIps] = await Promise.all([awsNs ? resolveIps(awsNs) : Promise.resolve([]), resolveIps(host)]);
    return { host, aws_ns: awsNs, ips, branded_ips: brandedIps };
  }));
  const branded_ready = glue.length > 0 && glue.every((g) => g.ips.length > 0 && g.branded_ips.some((ip) => g.ips.includes(ip)));
  return { glue, branded_ready };
}

/** Once the branded glue answers, stamp the zone itself with the branded NS
 *  set (and SOA MNAME) — the documented AWS white-label procedure. Customers
 *  then see ns1-4.davisdigitalstudio.com everywhere. */
export async function brandZone(zoneId: string, domain: string): Promise<{ ok: boolean; error?: string }> {
  if (!dnsWriteActive()) return { ok: false, error: 'not_configured' };
  const live = await r53.listRrsets(zoneId);
  if (!live.ok) return { ok: false, error: live.error };
  const apex = fqdn(domain);
  const soa = live.rrsets.find((s) => s.type === 'SOA' && s.name.toLowerCase() === apex);
  const changes: r53.RrsetChange[] = [
    { action: 'UPSERT', rrset: { name: apex, type: 'NS', ttl: 172800, values: BRANDED_NS.map((n) => n + '.') } },
  ];
  if (soa && soa.values[0]) {
    const parts = soa.values[0].split(/\s+/);
    parts[0] = BRANDED_NS[0] + '.';
    changes.push({ action: 'UPSERT', rrset: { name: apex, type: 'SOA', ttl: soa.ttl, values: [parts.join(' ')] } });
  }
  const w = await r53.changeRrsets(zoneId, changes, 'Studio OS: branded nameservers');
  return w.ok ? { ok: true } : { ok: false, error: w.error };
}
