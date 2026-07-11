// ── /website-timeline (CMS-UX-2) — the Website Timeline ──────────────────────
// A calm, chronological story of the customer's website: "what's been happening".
// This route GATHERS from EXISTING event tables only (the same ones the CRM feed,
// the room, and the P2-D delivery bridge already read) and hands the raw rows to
// the pure buildWebsiteTimeline adapter. No new store, no new business logic.
//
// Two surfaces, ONE timeline (the merge the product wants):
//   • the customer's OWN site — publishes, content edits, scheduled publishes,
//     releases, domain, connections, insights, enquiries (site_id-scoped)
//   • their linked project (if any) — client-visible delivery/milestone/support
//     events reached through the Agency–Client Bridge (client_visible only)
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import type { SiteRow } from '../lib/site.ts';
import { CONNECTED_PROVIDERS } from '../connected/providers.ts';
import { linksForCustomer } from '../lib/service_bridge.ts';
import { buildWebsiteTimeline } from '../lib/website_timeline.ts';

const PROVIDER_LABEL: Record<string, string> = Object.fromEntries(CONNECTED_PROVIDERS.map((p: any) => [p.key, p.name]));
const arr = (r: { json: unknown }): any[] => (Array.isArray(r.json) ? r.json : []);

export async function handleWebsiteTimeline(site: SiteRow, cors: Record<string, string>) {
  const now = new Date().toISOString();

  // ── the customer's OWN site: one bounded parallel gather ───────────────────
  const [pubs, changes, conns, moments, enquiries, scheduled, launches, domain] = await Promise.all([
    svc(`presence_publishes?site_id=eq.${site.id}&select=id,kind,status,change_summary,actor_kind,created_at,completed_at&order=created_at.desc&limit=25`),
    svc(`presence_change_events?site_id=eq.${site.id}&select=id,entity_type,action,summary,actor_kind,created_at&order=created_at.desc&limit=40`),
    svc(`presence_connection_events?site_id=eq.${site.id}&select=id,provider_key,action,actor_kind,created_at&order=created_at.desc&limit=15`),
    svc(`presence_moments?site_id=eq.${site.id}&select=id,headline,summary,created_at,first_seen_at&order=created_at.desc&limit=8`),
    svc(`presence_form_submissions?site_id=eq.${site.id}&spam=eq.false&select=id,form_kind,name,email,message,created_at&order=created_at.desc&limit=15`),
    svc(`presence_scheduled_publishes?site_id=eq.${site.id}&status=eq.pending&select=id,scheduled_for,summary,kind,created_at&order=scheduled_for.asc&limit=5`),
    svc(`presence_launches?site_id=eq.${site.id}&select=id,name,status,created_at,updated_at,approved_at&order=created_at.desc&limit=15`),
    svc(`presence_infra_plans?site_id=eq.${site.id}&kind=eq.connect_domain&status=eq.applied&select=id,title,applied_at,created_at&order=created_at.desc&limit=5`),
  ]);

  // provider display names, resolved server-side (never the raw key on screen)
  const connections = arr(conns).map((r) => ({ ...r, provider_label: PROVIDER_LABEL[r.provider_key] }));

  // ── their linked project(s), if bridged: client-visible events only ────────
  let projectEvents: any[] = [];
  try {
    if (site.client_id) {
      const links = await linksForCustomer(site.client_id);
      if (links.length) {
        // group linked project ids by the agency site their data lives on
        const bySite = new Map<string, string[]>();
        for (const l of links) { const a = bySite.get(l.agency_site_id) || []; a.push(l.project_id); bySite.set(l.agency_site_id, a); }
        const batches = await Promise.all([...bySite.entries()].map(([agencySite, ids]) =>
          svc(`presence_project_events?site_id=eq.${agencySite}&project_id=in.(${ids.join(',')})&client_visible=is.true&select=id,kind,actor_kind,detail,created_at&order=created_at.desc&limit=40`)
        ));
        projectEvents = batches.flatMap(arr);
      }
    }
  } catch { /* best-effort — the timeline still stands on the site's own events */ }

  const timeline = buildWebsiteTimeline({
    now,
    publishes: arr(pubs),
    changes: arr(changes),
    connections,
    moments: arr(moments),
    enquiries: arr(enquiries),
    scheduled: arr(scheduled),
    launches: arr(launches),
    domainActions: arr(domain),
    projectEvents,
  });

  return json({ data: timeline }, 200, cors);
}
