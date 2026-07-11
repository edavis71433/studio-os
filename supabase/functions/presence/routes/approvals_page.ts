// ── /approval-center (CMS-UX-6) — the Approval Center ────────────────────────
// "What am I waiting to approve?" — one calm place, projected from the approval
// state that ALREADY exists. No new approval system, no duplicated workflow:
//   • an update the customer can publish now   (Content Tree — nothing blocking)
//   • website/infra changes awaiting approval  (presence_infra_plans, proposed)
//   • connected-service writes awaiting approval(presence_connection_writes)
//   • file replacements awaiting approval       (presence_media, pending_replace)
//   • studio deliverables/agreements/proposals  (presence_approvals, pending,
//                                                 client-visible, via the bridge)
//   • already-approved scheduled publishes      (presence_scheduled_publishes)
//   • recently approved items                    (presence_approvals, approved)
// Each card links to the EXISTING surface where the approval actually happens.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import type { SiteRow } from '../lib/site.ts';
import { linksForCustomer } from '../lib/service_bridge.ts';
import { siteContentTree } from './room.ts';
import { buildApprovalCenter, type ApprovalCenterInput, type WaitingKind } from '../lib/approval_center.ts';

const arr = (r: { json: unknown }): any[] => (Array.isArray(r.json) ? r.json : []);

// presence_approvals.subject_type → the customer-facing waiting kind
function approvalKind(subjectType: string): WaitingKind {
  switch (subjectType) {
    case 'project': return 'proposal';
    case 'custom': return 'agreement';
    default: return 'delivery';   // deliverable / task
  }
}

export async function handleApprovalCenter(site: SiteRow, cors: Record<string, string>) {
  const now = new Date().toISOString();

  const [tree, infraQ, writeQ, fileQ, schedQ] = await Promise.all([
    siteContentTree(site),
    svc(`presence_infra_plans?site_id=eq.${site.id}&status=eq.proposed&select=id,title,summary&order=created_at.desc&limit=25`),
    svc(`presence_connection_writes?site_id=eq.${site.id}&status=eq.proposed&select=id,provider_key,title,summary&order=created_at.desc&limit=25`),
    svc(`presence_media?site_id=eq.${site.id}&asset_status=eq.pending&deleted_at=is.null&select=id,metadata&limit=25`),
    svc(`presence_scheduled_publishes?site_id=eq.${site.id}&status=eq.pending&select=scheduled_for,summary,kind&order=scheduled_for.asc&limit=10`),
  ]);
  if (!tree) return json({ error: 'template_missing', message: 'This site’s template isn’t available.' }, 500, cors);

  const waiting: ApprovalCenterInput['waiting'] = [];
  for (const p of arr(infraQ)) waiting.push({ kind: 'website', title: p.title || undefined, summary: p.summary || undefined, href: '/presence.html#foundations' });
  for (const w of arr(writeQ)) waiting.push({ kind: 'connected', title: w.title || undefined, summary: w.summary || undefined, href: '/connections.html' });
  for (const m of arr(fileQ)) if ((m.metadata || {}).pending_replace) waiting.push({ kind: 'file', href: `/files.html?focus=${m.id}` });

  // an update the customer could publish right now (nothing blocking it)
  const missing = tree.pages.some((p) => p.sections.some((s) => s.status === 'missing_required'));
  const update_ready = tree.has_unpublished_changes && !missing && tree.site_status !== 'publish_failed';

  // ── bridged studio approvals (deliverables / agreements / proposals) ───────
  const recently_approved: ApprovalCenterInput['recently_approved'] = [];
  try {
    if (site.client_id) {
      const links = await linksForCustomer(site.client_id);
      if (links.length) {
        const bySite = new Map<string, string[]>();
        for (const l of links) { const a = bySite.get(l.agency_site_id) || []; a.push(l.project_id); bySite.set(l.agency_site_id, a); }
        for (const [agencySite, ids] of bySite) {
          const [pendQ, doneQ] = await Promise.all([
            svc(`presence_approvals?site_id=eq.${agencySite}&project_id=in.(${ids.join(',')})&status=eq.pending&client_visible=is.true&select=subject_type,title,summary&order=requested_at.desc&limit=25`),
            svc(`presence_approvals?site_id=eq.${agencySite}&project_id=in.(${ids.join(',')})&status=eq.approved&client_visible=is.true&decided_at=not.is.null&select=title,decided_at&order=decided_at.desc&limit=10`),
          ]);
          for (const a of arr(pendQ)) waiting.push({ kind: approvalKind(a.subject_type), title: a.title || undefined, summary: a.summary || undefined, href: '/client.html' });
          for (const a of arr(doneQ)) recently_approved.push({ title: a.title || 'A change', at: String(a.decided_at) });
        }
      }
    }
  } catch { /* best-effort — the center still stands on the site's own approvals */ }

  const input: ApprovalCenterInput = {
    now,
    update_ready,
    waiting,
    scheduled: arr(schedQ).map((s) => ({ at: s.scheduled_for, summary: s.summary, kind: s.kind })),
    recently_approved,
  };

  return json({ data: buildApprovalCenter(input) }, 200, cors);
}
