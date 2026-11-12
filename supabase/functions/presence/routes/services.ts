// ── Presence Platform Services routes (M14) ─────────────────────────────────
//   GET  /export                    — everything the customer owns, portable (the right to leave)
//   GET  /launch                    — the Launch Assistant checklist, from actual state
// Plus new prepare goals handled in foundations.ts: transfer_in, transfer_out,
// email_setup, dns_repair. Nothing here changes the world: documents, plans,
// and reads only — the approval law owns every real change.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import { readZone } from '../platform/dns.ts';
import { buildExport } from '../platform/exporter.ts';
import { buildLaunchChecklist } from '../platform/launch.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';
import { guardedFetch } from '../../_shared/tools/url_guard.ts';   // builder item 204

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
    // builder item 204: the domain is typed, so both checks go through the guarded fetcher
    liveUrl ? fence((async () => (await guardedFetch(liveUrl, { method: 'HEAD', signal: AbortSignal.timeout(6000) })).ok)()) : Promise.resolve(null),
    liveUrl ? fence((async () => (await guardedFetch(liveUrl + '/sitemap.xml', { method: 'HEAD', signal: AbortSignal.timeout(6000) })).ok)()) : Promise.resolve(null),
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
