// ── Presence Platform Services routes (M14) ─────────────────────────────────
//   GET  /export                    — everything the customer owns, portable (the right to leave)
//   GET  /launch                    — the Launch Assistant checklist, from actual state
//   GET  /foundations/dns           — desired zone + observed zone + drift, plain words
//   PUT  /foundations/dns           — save the desired zone (validated; history kept)
//   POST /foundations/dns/rollback  — {history_id} → restore a saved version
//   GET  /foundations/email         — deliverability posture in plain words
// Plus new prepare goals handled in foundations.ts: transfer_in, transfer_out,
// email_setup, dns_repair. Nothing here changes the world: documents, plans,
// and reads only — the approval law owns every real change.
import { json } from '../../_shared/http.ts';
import { asUser, svc } from '../lib/db.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import { readZone, explainRecord } from '../platform/dns.ts';
import { validateZone, diffZones } from '../platform/zone.ts';
import { buildExport } from '../platform/exporter.ts';
import { buildLaunchChecklist } from '../platform/launch.ts';
import type { DnsRecord } from '../platform/dns.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const fence = async <T>(p: Promise<T>): Promise<T | null> => { try { return await p; } catch { return null; } };

async function siteDomain(site: SiteRow): Promise<string | null> {
  if (site.custom_domain) return site.custom_domain;
  const c = await svc(`presence_monitor_connections?site_id=eq.${site.id}&status=eq.verified&select=domain&limit=1`);
  return c.json?.[0]?.domain ?? null;
}

export async function handleExport(site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const data = await buildExport(site);
  await writeChangeEvent({ siteId: site.id, entityType: 'settings', entityId: null, action: 'update', summary: 'Exported everything (ownership export)', principal, provenance: 'human', fields: ['export'] });
  return json({ data }, 200, cors);
}

/** The Launch Assistant checklist for a site, from ACTUAL state (live probes +
 *  evidence + zone). Extracted so the CMS-UX-4 Website Health page can project
 *  the very same honest done/todo/n-a signals — one gather, one source. */
export async function siteLaunchChecklist(site: SiteRow) {
  const now = new Date().toISOString();
  const domain = await siteDomain(site);
  const [zone, conn, runQ, reviewQ] = await Promise.all([
    domain ? fence(readZone(domain, now)) : Promise.resolve(null),
    svc(`presence_monitor_connections?site_id=eq.${site.id}&select=status&limit=1`),
    svc(`presence_evidence_runs?site_id=eq.${site.id}&finished_at=not.is.null&error_text=is.null&select=id&order=started_at.desc&limit=1`),
    svc(`presence_ai_reviews?site_id=eq.${site.id}&select=id&limit=1`),
  ]);
  let evTypes = new Set<string>(); let a11yCrit = 0; let hasEvidence = false;
  if (runQ.json?.[0]?.id) {
    const evQ = await svc(`presence_evidence?run_id=eq.${runQ.json[0].id}&select=type,severity,category&limit=1000`);
    hasEvidence = true;
    for (const e of (evQ.json ?? []) as Array<{ type: string; severity: string; category: string }>) {
      evTypes.add(e.type);
      if (e.category === 'accessibility' && e.severity === 'critical') a11yCrit++;
    }
  }
  const liveUrl = domain ? `https://${domain}` : null;
  const [httpsOk, sitemapOk] = await Promise.all([
    liveUrl ? fence((async () => (await fetch(liveUrl, { method: 'HEAD', signal: AbortSignal.timeout(6000) })).ok)()) : Promise.resolve(null),
    liveUrl ? fence((async () => (await fetch(liveUrl + '/sitemap.xml', { method: 'HEAD', signal: AbortSignal.timeout(6000) })).ok)()) : Promise.resolve(null),
  ]);
  const rec = zone?.records ?? [];
  return buildLaunchChecklist({
    edition: site.edition, domain,
    apex_resolves: zone ? rec.some((r) => (r.type === 'A' || r.type === 'AAAA' || r.type === 'CNAME') && r.name === domain) : null,
    https_ok: httpsOk,
    published: !!site.last_published_at,
    monitor_verified: conn.json?.[0]?.status === 'verified',
    sitemap_present: sitemapOk,
    gbp_connected: hasEvidence && !evTypes.has('local_presence.profile_unconnected'),
    analytics_connected: hasEvidence && !evTypes.has('analytics.not_connected'),
    email_has_mx: rec.some((r) => r.type === 'MX'),
    email_authenticated: rec.some((r) => r.type === 'TXT' && r.value.startsWith('v=spf1')) && rec.some((r) => r.name.startsWith('_dmarc')),
    accessibility_criticals: a11yCrit,
    review_done: (reviewQ.json ?? []).length > 0,
  });
}

export async function handleLaunch(site: SiteRow, cors: Record<string, string>) {
  return json({ data: await siteLaunchChecklist(site) }, 200, cors);
}

export async function handleDnsGet(jwt: string, site: SiteRow, cors: Record<string, string>) {
  const now = new Date().toISOString();
  const domain = await siteDomain(site);
  if (!domain) return json({ data: { domain: null, sentence: 'DNS appears here once a domain is connected.', desired: [], observed: [], drift: null } }, 200, cors);
  const [zQ, hQ, observed] = await Promise.all([
    asUser(jwt, `presence_dns_zones?site_id=eq.${site.id}&select=records,updated_at&limit=1`),
    asUser(jwt, `presence_dns_zone_history?site_id=eq.${site.id}&select=id,note,saved_at&order=saved_at.desc&limit=10`),
    fence(readZone(domain, now)),
  ]);
  const desired: DnsRecord[] = zQ.json?.[0]?.records ?? [];
  const drift = observed ? diffZones(desired, observed.records) : null;
  return json({ data: {
    domain,
    desired: desired.map((r) => ({ ...r, plain: explainRecord(r) })),
    observed: (observed?.records ?? []).map((r) => ({ ...r, plain: explainRecord(r) })),
    drift: drift ? {
      missing: drift.missing.map((r) => ({ ...r, plain: explainRecord(r) })),
      sentence: drift.missing.length
        ? `${drift.missing.length} record${drift.missing.length === 1 ? '' : 's'} you decided on ${drift.missing.length === 1 ? 'isn’t' : 'aren’t'} answering yet — one click prepares the repair plan.`
        : desired.length ? 'Reality matches what you decided — no drift.' : 'No desired records saved yet — the editor below is where decisions live.',
    } : null,
    history: hQ.json ?? [],
  } }, 200, cors);
}

export async function handleDnsPut(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  let body: { records?: DnsRecord[]; note?: string } = {};
  try { body = await req.json(); } catch { return json({ error: 'bad_json', message: 'That didn’t read right — nothing changed.' }, 400, cors); }
  const domain = await siteDomain(site);
  if (!domain) return json({ error: 'no_domain', message: 'Connect a domain first.' }, 400, cors);
  const records = (Array.isArray(body?.records) ? body.records : []).slice(0, 50).map((r) => ({
    type: r.type, name: String(r.name || '').slice(0, 253), value: String(r.value || '').slice(0, 4096),
    ...(r.priority !== undefined ? { priority: Number(r.priority) } : {}), ...(r.ttl ? { ttl: Number(r.ttl) } : {}),
  })) as DnsRecord[];
  const v = validateZone(records);
  if (!v.ok) return json({ error: 'validation', message: 'Some records need fixing — nothing was saved.', details: v.problems }, 400, cors);
  const w = await svc(`presence_dns_zones?on_conflict=site_id&select=records,updated_at`, {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ site_id: site.id, domain, records }),
  });
  if (!w.ok || !w.json?.[0]) return json({ error: 'write_failed', message: 'That didn’t save — nothing was changed.' }, 502, cors);
  await svc('presence_dns_zone_history', { method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ site_id: site.id, records, note: String(body?.note || '').slice(0, 200) }) });
  await writeChangeEvent({ siteId: site.id, entityType: 'settings', entityId: null, action: 'update', summary: 'Updated the desired DNS zone (document only — reality changes via plans)', principal, provenance: 'human', fields: ['dns_zone'] });
  return json({ data: { saved: records.length, note: 'Saved as a decision. Reality follows through an approved plan — check drift to prepare one.' } }, 200, cors);
}

export async function handleDnsRollback(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  let body: { history_id?: string } = {};
  try { body = await req.json(); } catch { /* below */ }
  const hid = String(body?.history_id || '');
  const h = await svc(`presence_dns_zone_history?id=eq.${hid}&site_id=eq.${site.id}&select=records,saved_at&limit=1`);
  if (!h.json?.[0]) return json({ error: 'not_found', message: 'No saved version with that id.' }, 404, cors);
  const domain = await siteDomain(site);
  await svc(`presence_dns_zones?on_conflict=site_id`, {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ site_id: site.id, domain, records: h.json[0].records }),
  });
  await svc('presence_dns_zone_history', { method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ site_id: site.id, records: h.json[0].records, note: `rolled back to ${h.json[0].saved_at.slice(0, 16)}` }) });
  await writeChangeEvent({ siteId: site.id, entityType: 'settings', entityId: null, action: 'update', summary: 'Rolled the desired DNS zone back to a saved version', principal, provenance: 'human', fields: ['dns_zone'] });
  return json({ data: { restored: (h.json[0].records || []).length, from: h.json[0].saved_at } }, 200, cors);
}

export async function handleEmailHealth(site: SiteRow, cors: Record<string, string>) {
  const now = new Date().toISOString();
  const domain = await siteDomain(site);
  if (!domain) return json({ data: { sentence: 'Email posture appears here once a domain is connected.' } }, 200, cors);
  const zone = await fence(readZone(domain, now));
  const rec = zone?.records ?? [];
  const mx = rec.filter((r) => r.type === 'MX');
  const spf = rec.find((r) => r.type === 'TXT' && r.value.startsWith('v=spf1'));
  const dmarc = rec.find((r) => r.name.startsWith('_dmarc'));
  const checks = [
    { check: 'Mail service (MX)', state: mx.length ? 'done' : 'n/a', plain: mx.length ? `Email for @${domain} is delivered to ${mx[0].value}.` : 'No email runs on this domain.' },
    { check: 'SPF', state: spf ? 'done' : mx.length ? 'todo' : 'n/a', plain: spf ? 'The allowed-senders list is published.' : 'Anyone can forge mail from this domain until SPF exists.' },
    { check: 'DMARC', state: dmarc ? 'done' : mx.length ? 'todo' : 'n/a', plain: dmarc ? `Inboxes are told what to do with failures${/p=none/i.test(dmarc.value) ? ' (monitor-only — tightening is a later decision)' : ''}.` : 'Without DMARC, inboxes ignore your authentication.' },
    { check: 'DKIM', state: 'guided', plain: 'Signing keys live in your mail provider’s panel — the setup plan names the record; the observer confirms once placed.' },
  ];
  const healthy = mx.length === 0 || (!!spf && !!dmarc);
  return json({ data: {
    domain, checks,
    sentence: mx.length === 0 ? 'No email runs on this domain — nothing to protect.'
      : healthy ? 'Email from your domain is authenticated. Deliverability posture is good and stays watched.'
      : 'Email runs here but isn’t fully protected — the setup plan prepares every record with plain-language reasons.',
  } }, 200, cors);
}
