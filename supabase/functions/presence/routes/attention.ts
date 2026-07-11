// ── /attention (CMS-UX-3) — the Website Attention Center ─────────────────────
// "What needs my attention today?" — one calm, customer-facing projection.
// It GATHERS from EXISTING sources only and hands them to the pure
// buildAttentionCenter adapter. No new store, no second notification system,
// no duplicated validation:
//   • website content (unpublished / missing-required / publish-failed) is
//     REUSED from the CMS-UX-1 Content Tree (siteContentTree)
//   • notices, scheduled publishes, approvals, connections, enquiries come from
//     the same tables the shell bell + CRM already read
//   • bridged delivery approvals / client-actions come through the existing
//     Agency–Client Bridge (client-visible only)
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import type { SiteRow } from '../lib/site.ts';
import { CONNECTED_PROVIDERS } from '../connected/providers.ts';
import { linksForCustomer } from '../lib/service_bridge.ts';
import { siteContentTree } from './room.ts';
import { noticeHref } from './workspace.ts';
import { notifLabel } from '../lib/notifications.ts';
import { buildAttentionCenter, type AttentionInput } from '../lib/attention_center.ts';

const PROVIDER_LABEL: Record<string, string> = Object.fromEntries(CONNECTED_PROVIDERS.map((p: any) => [p.key, p.name]));
const arr = (r: { json: unknown }): any[] => (Array.isArray(r.json) ? r.json : []);
const num = (r: { json: unknown }): number => (Array.isArray(r.json) ? r.json.length : 0);

export async function handleAttentionCenter(site: SiteRow, cors: Record<string, string>) {
  const now = new Date().toISOString();

  // ── website content signals — REUSE the Content Tree (one gather) ──────────
  const tree = await siteContentTree(site);
  if (!tree) return json({ error: 'template_missing', message: 'This site’s template isn’t available.' }, 500, cors);
  const missing = tree.pages.flatMap((p) =>
    p.sections.filter((s) => s.status === 'missing_required').map((s) => ({ section: s.label, page: p.label, href: s.editor_link })));

  // ── everything else — one bounded parallel gather from existing tables ─────
  const [noticeQ, schedQ, enquiryQ, connQ, infraQ, writeQ, fileQ] = await Promise.all([
    svc(`presence_plan_notices?site_id=eq.${site.id}&status=eq.active&select=kind,headline,body&order=created_at.desc&limit=10`),
    svc(`presence_scheduled_publishes?site_id=eq.${site.id}&status=eq.pending&select=scheduled_for,summary,kind&order=scheduled_for.asc&limit=5`),
    svc(`presence_form_submissions?site_id=eq.${site.id}&spam=eq.false&status=eq.new&select=id&limit=50`),
    svc(`presence_connections?site_id=eq.${site.id}&select=provider_key,status,health`),
    svc(`presence_infra_plans?site_id=eq.${site.id}&status=eq.proposed&select=id&limit=50`),
    svc(`presence_connection_writes?site_id=eq.${site.id}&status=eq.proposed&select=id&limit=50`),
    svc(`presence_media?site_id=eq.${site.id}&asset_status=eq.pending&deleted_at=is.null&select=id,metadata&limit=50`),
  ]);

  const notices = arr(noticeQ).map((n) => ({ kind: n.kind, headline: n.headline, body: n.body, href: noticeHref(n.kind) }));
  const scheduled = arr(schedQ).map((s) => ({ at: s.scheduled_for, summary: s.summary, kind: s.kind }));
  const connections_attention = arr(connQ)
    .filter((c) => ['expired', 'error', 'revoked'].includes(c.status) || ['attention', 'down'].includes(c.health))
    .map((c) => ({ label: PROVIDER_LABEL[c.provider_key] || 'A connected service' }));
  const filesPending = arr(fileQ).filter((m) => (m.metadata || {}).pending_replace).length;
  const approvals_waiting = num(infraQ) + num(writeQ) + filesPending;

  // ── bridged delivery (if this customer has a linked project) ───────────────
  let project_approvals_waiting = 0;
  const project_actions: Array<{ title: string }> = [];
  try {
    if (site.client_id) {
      const links = await linksForCustomer(site.client_id);
      if (links.length) {
        const bySite = new Map<string, string[]>();
        for (const l of links) { const a = bySite.get(l.agency_site_id) || []; a.push(l.project_id); bySite.set(l.agency_site_id, a); }
        for (const [agencySite, ids] of bySite) {
          const [apprQ, actQ] = await Promise.all([
            svc(`presence_approvals?site_id=eq.${agencySite}&project_id=in.(${ids.join(',')})&status=eq.pending&client_visible=is.true&select=id&limit=50`),
            svc(`presence_project_events?site_id=eq.${agencySite}&project_id=in.(${ids.join(',')})&client_visible=is.true&kind=in.(client_action,support_message)&select=kind,actor_kind,created_at&order=created_at.desc&limit=5`),
          ]);
          project_approvals_waiting += num(apprQ);
          for (const e of arr(actQ)) {
            if (e.kind === 'support_message' && e.actor_kind !== 'staff' && e.actor_kind !== 'operator') continue; // only the studio's replies need you
            project_actions.push({ title: e.kind === 'support_message' ? 'Your studio replied to your support request' : notifLabel('client_action') });
          }
        }
      }
    }
  } catch { /* best-effort — attention still stands on the site's own signals */ }

  const input: AttentionInput = {
    now,
    site_status: tree.site_status,
    has_unpublished_changes: tree.has_unpublished_changes,
    publish_failed: tree.site_status === 'publish_failed',
    last_published_at: tree.last_published_at,
    missing,
    notices,
    scheduled,
    new_enquiries: num(enquiryQ),
    connections_attention,
    approvals_waiting,
    project_approvals_waiting,
    project_actions: project_actions.slice(0, 3),
  };

  return json({ data: buildAttentionCenter(input) }, 200, cors);
}
