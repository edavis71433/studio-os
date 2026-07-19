// ── Managed DNS zone lifecycle (DNS one-stop shop, slice D1) ────────────────
//   POST   /foundations/zone          — create the customer's managed zone
//                                        (DS pre-flight → record scan+import →
//                                        site records → desired-zone doc)
//   GET    /foundations/zone          — status: nameservers, NS propagation,
//                                        per-record state, SSL handshake
//                                        (dns_pending → ns_pending →
//                                         ssl_pending → live)
//   DELETE /foundations/zone          — detach: confirm + snapshot + delete,
//                                        back to guided mode
//   POST/PUT/DELETE /foundations/zone/records — record CRUD with guardrails
//                                        (protected classes need confirm:true;
//                                         SPF merges, never appends)
// DORMANT + FAIL-CLOSED (slice-6 pattern): without the AWS secrets every
// route answers an honest 503 and NOTHING above this file changes — the
// shipped guided experience stays exactly as it is.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import { readZone, validateRecord, explainRecord } from '../platform/dns.ts';
import {
  dnsWriteActive, ensureZone, applyRecords, removeRecord, deleteZone,
  checkDs, scanZone, importFilter, siteRecords, publicNameservers, nsPropagated,
  delegationGlue, brandZone, protectedClass, mergeDesired, sameRecord,
  rrsetsToRecords, BRANDED_NS,
} from '../platform/managed_dns.ts';
import { getOrCreateDelegationSet, findHostedZone, listRrsets } from '../lib/route53.ts';
import { getSite, sslStatus, provisionSsl } from '../lib/netlify.ts';
import type { DnsRecord } from '../platform/dns.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const nowIso = () => new Date().toISOString();
const fence = async <T>(p: Promise<T>): Promise<T | null> => { try { return await p; } catch { return null; } };

/** The honest dormant answer — the surface exists but does nothing yet. */
const notConfigured = (cors: Record<string, string>) =>
  json({ error: 'not_configured', message: 'DNS management isn’t switched on yet — records are read-only guidance for now, and nothing here can change them.' }, 503, cors);

async function siteDomain(site: SiteRow): Promise<string | null> {
  if (site.custom_domain) return site.custom_domain;
  const c = await svc(`presence_monitor_connections?site_id=eq.${site.id}&status=eq.verified&select=domain&limit=1`);
  return c.json?.[0]?.domain ?? null;
}

/** Reads that DECIDE something must not collapse failure to emptiness
 *  (the okRows discipline from slice 6). */
class InfraRead extends Error {}
function okRows(r: { ok?: boolean; json?: unknown }): any[] {
  if (!r || (r as { ok?: boolean }).ok === false) throw new InfraRead();
  return Array.isArray((r as { json?: unknown }).json) ? (r as { json: any[] }).json : [];
}

type SourcedRecord = DnsRecord & { source?: string };

async function desiredDoc(siteId: string): Promise<SourcedRecord[]> {
  const q = await svc(`presence_dns_zones?site_id=eq.${siteId}&select=records&limit=1`);
  return okRows(q)[0]?.records ?? [];
}
async function saveDesired(siteId: string, domain: string, records: SourcedRecord[], note: string): Promise<void> {
  await svc(`presence_dns_zones?on_conflict=site_id`, {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ site_id: siteId, domain, records }),
  });
  await svc('presence_dns_zone_history', { method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ site_id: siteId, records, note: note.slice(0, 200) }) });
}
async function snapshotZone(siteId: string, domain: string, records: DnsRecord[]): Promise<void> {
  await svc('presence_zone_snapshots', { method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ site_id: siteId, domain, records, taken_at: nowIso() }) });
}

/** The platform section every configured response carries: the delegation set
 *  + the glue map (this is WHERE the runbook sends Eric for the four glue
 *  values — see docs/presence/DNS-SETUP.md). */
async function platformSection() {
  const ds = await getOrCreateDelegationSet();
  if (!ds.ok || !ds.set) return { available: false as const, error: ds.error || 'unavailable', sentence: 'The DNS backbone didn’t answer — the delegation set couldn’t be read or created. Try again shortly.' };
  const { glue, branded_ready } = await delegationGlue(ds.set.nameservers);
  return {
    available: true as const,
    delegation_set_id: ds.set.id,
    aws_nameservers: ds.set.nameservers,
    branded_nameservers: BRANDED_NS,
    glue,   // [{host: ns1.davisdigitalstudio.com, aws_ns, ips (glue values), branded_ips (what answers today)}]
    branded_ready,
    sentence: branded_ready
      ? 'Branded nameservers are live — customers see ns1–ns4.davisdigitalstudio.com.'
      : 'Branded nameservers aren’t answering yet — add the four glue records from `glue[].ips` at the registrar for davisdigitalstudio.com (one-time; see docs/presence/DNS-SETUP.md). Zones work on the AWS names meanwhile.',
  };
}

/* ═══ GET /foundations/zone — status + the SSL handshake ═══ */
export async function handleZoneGet(site: SiteRow, cors: Record<string, string>) {
  if (!dnsWriteActive()) return notConfigured(cors);
  const domain = await siteDomain(site);
  const platform = await platformSection();
  if (!domain) {
    return json({ data: { configured: true, domain: null, zone: null, platform, sentence: 'Connect a domain first — the managed zone is created from it.' } }, 200, cors);
  }
  const found = await findHostedZone(domain);
  if (!found.ok) return json({ error: 'provider_error', message: 'The DNS backbone didn’t answer just now — nothing is wrong with your zone; try again shortly.', detail: found.error }, 502, cors);
  if (!found.zone) {
    return json({ data: { configured: true, domain, zone: null, platform, sentence: 'No managed zone yet for this domain — creating one imports the current records first, so nothing breaks at cutover.' } }, 200, cors);
  }

  const [live, observedNs, desired] = await Promise.all([
    listRrsets(found.zone.id),
    publicNameservers(domain),
    fence(desiredDoc(site.id)),
  ]);
  if (!live.ok) return json({ error: 'provider_error', message: 'The zone exists but couldn’t be read just now — try again shortly.', detail: live.error }, 502, cors);
  const liveRecords = rrsetsToRecords(live.rrsets);
  const zoneNs = live.rrsets.filter((s) => s.type === 'NS' && s.name.replace(/\.$/, '').toLowerCase() === domain.toLowerCase())
    .flatMap((s) => s.values.map((v) => v.replace(/\.$/, '')));
  const awsNs = platform.available ? platform.aws_nameservers : zoneNs;
  const branded = platform.available && platform.branded_ready;
  const showNs = branded ? BRANDED_NS : (zoneNs.length ? zoneNs : awsNs);
  const propagated = observedNs !== null && nsPropagated(observedNs, awsNs, BRANDED_NS);

  // records not yet answered into the zone? (creation just happened / change pending)
  const desiredRecords: SourcedRecord[] = desired ?? [];
  const missing = desiredRecords.filter((d) => !liveRecords.some((l) => sameRecord(l, d)));

  // ── the SSL handshake (Eric's hard requirement): once delegation is
  // observed, re-trigger certificate provisioning and surface the state ──
  let ssl: { state: string; expires_at: string | null } | null = null;
  let sslOk = false;
  let sslRetriggered = false;
  if (site.netlify_site_id) {
    const s = await sslStatus(site.netlify_site_id);
    ssl = { state: s.state, expires_at: s.expires_at };
    sslOk = s.state === 'issued' || s.state === 'renewed';
    if (propagated && !sslOk) {
      const p = await provisionSsl(site.netlify_site_id);
      sslRetriggered = p.ok;
      const again = await sslStatus(site.netlify_site_id);
      ssl = { state: again.state, expires_at: again.expires_at };
      sslOk = again.state === 'issued' || again.state === 'renewed';
    }
  }

  const status = missing.length && !propagated ? 'dns_pending'
    : !propagated ? 'ns_pending'
    : site.netlify_site_id && !sslOk ? 'ssl_pending'
    : 'live';
  const sentence =
    status === 'dns_pending' ? 'The zone is being written — records are settling on the nameservers (seconds to minutes).'
    : status === 'ns_pending' ? `Waiting for the nameserver change at the registrar. Point ${domain} at: ${showNs.join(', ')}. Detection is automatic — usually under an hour, up to 24–72h in the slowest cases.`
    : status === 'ssl_pending' ? 'Nameservers detected — the security certificate is being issued now (usually minutes, up to an hour). Nothing for you to do.'
    : 'This domain is fully managed here: records, nameservers, and the certificate are all live.';

  const records = liveRecords.filter((r) => r.type !== 'NS' || r.name.toLowerCase() !== domain.toLowerCase()).map((r) => {
    const doc = desiredRecords.find((d) => sameRecord(d, r));
    return { ...r, plain: explainRecord(r), managed: !!doc, source: doc?.source ?? null, protected: protectedClass(r, domain) };
  });

  return json({ data: {
    configured: true, domain,
    zone: {
      id: found.zone.id, status, sentence,
      nameservers: showNs, branded,
      ns: { propagated, observed: observedNs ?? null, checked: observedNs !== null },
      records,
      pending_records: missing.map((r) => ({ ...r, plain: explainRecord(r) })),
      ssl: ssl ? { ...ssl, ok: sslOk, retriggered: sslRetriggered } : null,
    },
    platform,
  } }, 200, cors);
}

/* ═══ POST /foundations/zone — create + import (the honest cutover) ═══ */
export async function handleZoneCreate(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  if (!dnsWriteActive()) return notConfigured(cors);
  const domain = await siteDomain(site);
  if (!domain) return json({ error: 'no_domain', message: 'Connect a domain first — the managed zone is created from it.' }, 400, cors);

  // 1. DNSSEC pre-flight — a stale DS record breaks delegation the moment
  //    nameservers change. Block with guidance; refuse honestly on a failed probe.
  const ds = await checkDs(domain);
  if (ds === 'present') {
    return json({ error: 'dnssec_active', message: `DNSSEC is switched on for ${domain} (a DS record answers at the registry). Changing nameservers now would take the domain offline. Turn DNSSEC off at the registrar first, wait for the DS record to clear (up to 24h), then try again — it can be re-enabled properly afterwards.` }, 409, cors);
  }
  if (ds === 'unknown') {
    return json({ error: 'dnssec_unverified', message: 'The DNSSEC safety check couldn’t complete just now — creating the zone without it could break the domain, so nothing was done. Try again in a moment.' }, 502, cors);
  }

  // 2. the record scan (fixed name list over DoH) + pre-migration snapshot
  const [scanned, current] = await Promise.all([scanZone(domain), fence(readZone(domain, nowIso()))]);
  if (current) await snapshotZone(site.id, domain, current.records);
  const { keep, replaced } = importFilter(scanned, domain);

  // 3. the records the platform places (target + verification token from real state, never invented)
  const [nfSite, connQ] = await Promise.all([
    site.netlify_site_id ? getSite(site.netlify_site_id) : Promise.resolve({ ok: false as const, status: 0, site: undefined }),
    svc(`presence_monitor_connections?site_id=eq.${site.id}&select=token&limit=1`),
  ]);
  const target = nfSite.ok && nfSite.site ? nfSite.site.default_domain : null;
  let token: string | null;
  try { token = okRows(connQ)[0]?.token ?? null; } catch { token = null; }   // tolerated: token is optional enrichment
  const placed = siteRecords(domain, target, token);

  // 4. create the zone (idempotent) and write import + site records BEFORE returning
  const zone = await ensureZone(domain, site.id);
  if (!zone.ok || !zone.zone) return json({ error: 'provider_error', message: 'The managed zone couldn’t be created — nothing was changed. Try again shortly.', detail: zone.error }, 502, cors);
  const toApply = [...keep, ...placed];
  const applied = await applyRecords(zone.zone.zoneId, toApply, `Studio OS: zone cutover for ${domain}`);
  if (!applied.ok) {
    return json({ error: 'provider_error', message: 'The zone was created but the records couldn’t be written — nothing is live yet (nameservers haven’t changed). Try again shortly.', detail: applied.error }, 502, cors);
  }

  // 5. white-label when the branded glue already answers
  const platform = await platformSection();
  if (platform.available && platform.branded_ready) await brandZone(zone.zone.zoneId, domain);
  const showNs = platform.available && platform.branded_ready ? BRANDED_NS : zone.zone.nameservers;

  // 6. desired-zone write-through (drift machinery keeps working, untouched)
  let desired: SourcedRecord[] = [];
  try { desired = await desiredDoc(site.id); } catch { desired = []; }
  desired = mergeDesired(desired, keep, 'import');
  desired = mergeDesired(desired, placed, 'platform');
  await saveDesired(site.id, domain, desired, `managed zone created; imported ${keep.length}, placed ${placed.length}`);
  await writeChangeEvent({ siteId: site.id, entityType: 'settings', entityId: null, action: 'create', summary: `Created the managed DNS zone for ${domain} (imported ${keep.length} records)`, principal, provenance: 'human', fields: ['dns_zone'] });

  return json({ data: {
    zone_id: zone.zone.zoneId, domain,
    created: zone.zone.created,
    nameservers: showNs,
    imported: keep.map((r) => ({ ...r, plain: explainRecord(r) })),
    replaced_by_site_records: replaced,
    placed: placed.map((r) => ({ ...r, plain: explainRecord(r) })),
    spf_merged: applied.merged,
    next_step: `Change the nameservers for ${domain} at the registrar to: ${showNs.join(', ')}. Everything found in the old DNS was imported first, so nothing breaks when the switch happens.`,
  } }, 201, cors);
}

/* ═══ DELETE /foundations/zone — detach, back to guided mode ═══ */
export async function handleZoneDelete(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  if (!dnsWriteActive()) return notConfigured(cors);
  let body: { confirm?: boolean } = {};
  try { body = await req.json(); } catch { /* below */ }
  if (body?.confirm !== true) {
    return json({ error: 'confirm_required', message: 'Detaching deletes the managed zone. Point the nameservers somewhere else FIRST (or the domain goes dark), then send {"confirm": true}. A full snapshot of every record is kept either way.' }, 400, cors);
  }
  const domain = await siteDomain(site);
  if (!domain) return json({ error: 'no_domain', message: 'No domain, no zone.' }, 400, cors);
  const found = await findHostedZone(domain);
  if (!found.ok) return json({ error: 'provider_error', message: 'The DNS backbone didn’t answer — nothing was deleted. Try again shortly.', detail: found.error }, 502, cors);
  if (!found.zone) return json({ error: 'not_found', message: 'No managed zone exists for this domain — already in guided mode.' }, 404, cors);

  const del = await deleteZone(found.zone.id, domain);
  if (del.snapshot.length) await snapshotZone(site.id, domain, del.snapshot);
  if (!del.ok) return json({ error: 'provider_error', message: 'The zone couldn’t be fully removed — records are snapshotted and nothing was half-deleted where it matters. Try again shortly.', detail: del.error }, 502, cors);
  await svc('presence_dns_zone_history', { method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ site_id: site.id, records: del.snapshot, note: 'managed zone detached — snapshot of the zone at deletion' }) });
  await writeChangeEvent({ siteId: site.id, entityType: 'settings', entityId: null, action: 'delete', summary: `Detached the managed DNS zone for ${domain} (guided mode again)`, principal, provenance: 'human', fields: ['dns_zone'] });
  return json({ data: { deleted: true, domain, snapshot_records: del.snapshot.length, note: 'The zone is gone and DNS management is back to guided mode. The final snapshot holds every record it contained.' } }, 200, cors);
}

/* ═══ record CRUD — POST/PUT/DELETE /foundations/zone/records ═══ */

function cleanRecord(r: unknown): DnsRecord | null {
  if (!r || typeof r !== 'object') return null;
  const x = r as Record<string, unknown>;
  const rec = {
    type: String(x.type || ''), name: String(x.name || '').slice(0, 253), value: String(x.value || '').slice(0, 4096),
    ...(x.priority !== undefined ? { priority: Number(x.priority) } : {}), ...(x.ttl ? { ttl: Number(x.ttl) } : {}),
  } as DnsRecord;
  return rec.type && rec.name ? rec : null;
}

const confirmRefusal = (why: string, cors: Record<string, string>) =>
  json({ error: 'confirm_required', message: `${why} Resend with {"confirm": true} if this is intended.` }, 409, cors);

export async function handleZoneRecords(req: Request, method: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  if (!dnsWriteActive()) return notConfigured(cors);
  const domain = await siteDomain(site);
  if (!domain) return json({ error: 'no_domain', message: 'Connect a domain first.' }, 400, cors);
  const found = await findHostedZone(domain);
  if (!found.ok) return json({ error: 'provider_error', message: 'The DNS backbone didn’t answer — nothing was changed. Try again shortly.', detail: found.error }, 502, cors);
  if (!found.zone) return json({ error: 'no_zone', message: 'This domain has no managed zone yet — create it first (POST /foundations/zone).' }, 409, cors);
  const zoneId = found.zone.id;

  let body: { record?: unknown; previous?: unknown; confirm?: boolean } = {};
  try { body = await req.json(); } catch { return json({ error: 'bad_json', message: 'That didn’t read right — nothing changed.' }, 400, cors); }
  const record = cleanRecord(body?.record);
  if (!record) return json({ error: 'bad_request', message: 'A record needs at least a type, name, and value.' }, 400, cors);
  const confirm = body?.confirm === true;

  let desired: SourcedRecord[];
  try { desired = await desiredDoc(site.id); } catch {
    return json({ error: 'read_failed', message: 'The zone document couldn’t be read — nothing was changed. Try again.' }, 502, cors);
  }

  if (method === 'POST' || method === 'PUT') {
    const v = validateRecord(record);
    if (!v.ok) return json({ error: 'validation', message: v.problem || 'That record isn’t valid — nothing was changed.' }, 400, cors);
  }

  if (method === 'POST') {
    const cls = protectedClass(record, domain);
    if (cls && !confirm) return confirmRefusal(`That touches a protected record class (${cls}) — email or the website itself can break if it’s wrong.`, cors);
    const applied = await applyRecords(zoneId, [record], `Studio OS: add ${record.type} ${record.name}`);
    if (!applied.ok) return json({ error: 'provider_error', message: 'The record couldn’t be written — nothing was changed. Try again shortly.', detail: applied.error }, 502, cors);
    const stored = applied.merged.length ? { ...record, value: applied.merged[applied.merged.length - 1] } : record;
    await saveDesired(site.id, domain, mergeDesired(desired, [stored], 'user'), `added ${record.type} ${record.name}${applied.merged.length ? ' (SPF merged)' : ''}`);
    await writeChangeEvent({ siteId: site.id, entityType: 'settings', entityId: null, action: 'create', summary: `Added DNS record ${record.type} ${record.name}`, principal, provenance: 'human', fields: ['dns_zone'] });
    return json({ data: { added: stored, spf_merged: applied.merged.length > 0, plain: explainRecord(stored) } }, 200, cors);
  }

  if (method === 'PUT') {
    const previous = cleanRecord(body?.previous);
    if (!previous) return json({ error: 'bad_request', message: 'An edit names the previous record and the new one: {"previous": {...}, "record": {...}}.' }, 400, cors);
    const cls = protectedClass(previous, domain) || protectedClass(record, domain);
    if (cls && !confirm) return confirmRefusal(`That edits a protected record class (${cls}) — email or the website itself can break if it’s wrong.`, cors);
    const prevDoc = desired.find((d) => sameRecord(d, previous));
    if (prevDoc?.source === 'import' && !confirm) return confirmRefusal('That record was imported from the domain’s previous DNS — changing it can break something that was already working.', cors);
    if (!sameRecord(previous, record)) {
      const rem = await removeRecord(zoneId, previous, `Studio OS: edit ${previous.type} ${previous.name}`);
      if (!rem.ok) return json({ error: 'provider_error', message: 'The edit couldn’t start — nothing was changed. Try again shortly.', detail: rem.error }, 502, cors);
    }
    const applied = await applyRecords(zoneId, [record], `Studio OS: edit ${record.type} ${record.name}`);
    if (!applied.ok) return json({ error: 'provider_error', message: 'The old value was removed but the new one didn’t write — the zone history holds both; retry to finish.', detail: applied.error }, 502, cors);
    const next = mergeDesired(desired.filter((d) => !sameRecord(d, previous)), [{ ...record, source: prevDoc?.source ?? 'user' } as SourcedRecord], prevDoc?.source ?? 'user');
    await saveDesired(site.id, domain, next, `edited ${record.type} ${record.name}`);
    await writeChangeEvent({ siteId: site.id, entityType: 'settings', entityId: null, action: 'update', summary: `Edited DNS record ${record.type} ${record.name}`, principal, provenance: 'human', fields: ['dns_zone'] });
    return json({ data: { updated: record, plain: explainRecord(record) } }, 200, cors);
  }

  if (method === 'DELETE') {
    const cls = protectedClass(record, domain);
    if (cls && !confirm) return confirmRefusal(`That deletes a protected record class (${cls}) — email or the website itself can break without it.`, cors);
    const doc = desired.find((d) => sameRecord(d, record));
    if (doc?.source === 'import' && !confirm) return confirmRefusal('That record was imported from the domain’s previous DNS — deleting it can break something that was already working.', cors);
    const rem = await removeRecord(zoneId, record, `Studio OS: delete ${record.type} ${record.name}`);
    if (!rem.ok) return json({ error: 'provider_error', message: 'The record couldn’t be removed — nothing was changed. Try again shortly.', detail: rem.error }, 502, cors);
    if (!rem.removed) return json({ error: 'not_found', message: 'That record isn’t in the zone — nothing to delete.' }, 404, cors);
    await saveDesired(site.id, domain, desired.filter((d) => !sameRecord(d, record)), `deleted ${record.type} ${record.name}`);
    await writeChangeEvent({ siteId: site.id, entityType: 'settings', entityId: null, action: 'delete', summary: `Deleted DNS record ${record.type} ${record.name}`, principal, provenance: 'human', fields: ['dns_zone'] });
    return json({ data: { deleted: record } }, 200, cors);
  }

  return json({ error: 'method_not_allowed' }, 405, cors);
}
