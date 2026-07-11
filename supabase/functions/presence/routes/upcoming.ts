// ── /upcoming (CMS-UX-5) — Upcoming Changes ──────────────────────────────────
// "What's happening next with my website?" — a calm future schedule projected
// from EXISTING dated truth only. No scheduling engine, no new store:
//   • scheduled publishes            (presence_scheduled_publishes.scheduled_for)
//   • domain renewal                 (presence_sites.domain_expires_at)
//   • trial ending                   (presence_entitlements.trial_ends_at)
//   • project milestones / wrap-up   (presence_milestones.due_date /
//                                      presence_projects.target_date, via the
//                                      Agency–Client Bridge, client-visible)
//   • waiting on you                 (pending approvals — own + bridged; an
//                                      almost-ready update from the Content Tree)
// Anything without a real stored date is omitted (Evidence Rule).
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import type { SiteRow } from '../lib/site.ts';
import { linksForCustomer } from '../lib/service_bridge.ts';
import { siteContentTree } from './room.ts';
import { buildUpcomingChanges, type UpcomingInput } from '../lib/upcoming_changes.ts';

const arr = (r: { json: unknown }): any[] => (Array.isArray(r.json) ? r.json : []);
const num = (r: { json: unknown }): number => (Array.isArray(r.json) ? r.json.length : 0);

export async function handleUpcoming(site: SiteRow, cors: Record<string, string>) {
  const now = new Date().toISOString();

  const [tree, schedQ, siteQ, entQ, infraQ, writeQ, fileQ] = await Promise.all([
    siteContentTree(site),
    svc(`presence_scheduled_publishes?site_id=eq.${site.id}&status=eq.pending&select=scheduled_for,summary,kind&order=scheduled_for.asc&limit=10`),
    svc(`presence_sites?id=eq.${site.id}&select=domain_expires_at&limit=1`),
    site.client_id ? svc(`presence_entitlements?client_id=eq.${encodeURIComponent(site.client_id)}&product=eq.presence&select=trial_ends_at&limit=1`) : Promise.resolve({ json: [] as any[] }),
    svc(`presence_infra_plans?site_id=eq.${site.id}&status=eq.proposed&select=id&limit=50`),
    svc(`presence_connection_writes?site_id=eq.${site.id}&status=eq.proposed&select=id&limit=50`),
    svc(`presence_media?site_id=eq.${site.id}&asset_status=eq.pending&deleted_at=is.null&select=id,metadata&limit=50`),
  ]);
  if (!tree) return json({ error: 'template_missing', message: 'This site’s template isn’t available.' }, 500, cors);

  const domain_expires_at = arr(siteQ)[0]?.domain_expires_at ?? null;
  const trial_ends_at = arr(entQ)[0]?.trial_ends_at ?? null;
  const filesPending = arr(fileQ).filter((m) => (m.metadata || {}).pending_replace).length;
  let approvals_waiting = num(infraQ) + num(writeQ) + filesPending;

  // an update the customer could publish right now (nothing blocking it)
  const missing = tree.pages.some((p) => p.sections.some((s) => s.status === 'missing_required'));
  const almost_ready = tree.has_unpublished_changes && !missing && tree.site_status !== 'publish_failed';

  // ── bridged project dates + pending delivery approvals ─────────────────────
  const project_due: Array<{ title: string; at: string; kind: 'milestone' | 'project' }> = [];
  try {
    if (site.client_id) {
      const links = await linksForCustomer(site.client_id);
      if (links.length) {
        const bySite = new Map<string, string[]>();
        for (const l of links) { const a = bySite.get(l.agency_site_id) || []; a.push(l.project_id); bySite.set(l.agency_site_id, a); }
        for (const [agencySite, ids] of bySite) {
          const [msQ, prQ, apprQ] = await Promise.all([
            svc(`presence_milestones?site_id=eq.${agencySite}&project_id=in.(${ids.join(',')})&status=eq.open&client_visible=is.true&due_date=not.is.null&select=title,due_date&order=due_date.asc&limit=20`),
            svc(`presence_projects?site_id=eq.${agencySite}&id=in.(${ids.join(',')})&status=eq.active&client_visible=is.true&target_date=not.is.null&select=target_date&limit=20`),
            svc(`presence_approvals?site_id=eq.${agencySite}&project_id=in.(${ids.join(',')})&status=eq.pending&client_visible=is.true&select=id&limit=50`),
          ]);
          for (const m of arr(msQ)) if (m.due_date) project_due.push({ title: m.title || 'A milestone', at: String(m.due_date), kind: 'milestone' });
          for (const p of arr(prQ)) if (p.target_date) project_due.push({ title: '', at: String(p.target_date), kind: 'project' });
          approvals_waiting += num(apprQ);
        }
      }
    }
  } catch { /* best-effort — the schedule still stands on the site's own dates */ }

  const input: UpcomingInput = {
    now,
    scheduled: arr(schedQ).map((s) => ({ at: s.scheduled_for, summary: s.summary, kind: s.kind })),
    domain_expires_at,
    trial_ends_at,
    project_due,
    approvals_waiting,
    almost_ready,
  };

  return json({ data: buildUpcomingChanges(input) }, 200, cors);
}
