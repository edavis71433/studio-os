// ── /website-health (CMS-UX-4) — the customer Website Health page ────────────
// "Is my website healthy?" — one calm projection over signals that ALREADY
// exist. It composes, it does not recompute:
//   • siteContentTree (CMS-UX-1)   → content + publish state (reused validation)
//   • siteLaunchChecklist          → domain / secure connection / search /
//                                     analytics / email (reused honest probes)
//   • presence_connections         → connected services + health
//   • real evidence                → a received enquiry (contact form works),
//                                     a saved version (nothing is ever lost)
// No new validator, no new monitoring, no duplicated logic.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import type { SiteRow } from '../lib/site.ts';
import { CONNECTED_PROVIDERS } from '../connected/providers.ts';
import { siteContentTree } from './room.ts';
import { siteLaunchChecklist } from './services.ts';
import { buildWebsiteHealth, type WebsiteHealthInput } from '../lib/website_health.ts';

const PROVIDER_LABEL: Record<string, string> = Object.fromEntries(CONNECTED_PROVIDERS.map((p: any) => [p.key, p.name]));
const arr = (r: { json: unknown }): any[] => (Array.isArray(r.json) ? r.json : []);

export async function handleWebsiteHealth(site: SiteRow, cors: Record<string, string>) {
  const now = new Date().toISOString();

  // reused projections + the honest launch probes, in parallel with the small
  // evidence reads (contact-form message received, a saved version exists)
  const [tree, launch, connQ, formQ, snapQ] = await Promise.all([
    siteContentTree(site),
    siteLaunchChecklist(site),
    svc(`presence_connections?site_id=eq.${site.id}&select=provider_key,status,health`),
    svc(`presence_form_submissions?site_id=eq.${site.id}&spam=eq.false&select=id&limit=1`),
    svc(`presence_snapshots?site_id=eq.${site.id}&select=id&limit=1`),
  ]);
  if (!tree) return json({ error: 'template_missing', message: 'This site’s template isn’t available.' }, 500, cors);

  // content-tree → the content/publish signals (reuse the validation mapping)
  const missing = tree.pages.flatMap((p) => p.sections.filter((s) => s.status === 'missing_required').map((s) => s.editor_link));

  // connected services worth showing: the connected ones + any needing a look
  const connections = arr(connQ)
    .filter((c) => c.status === 'connected' || ['expired', 'error', 'revoked'].includes(c.status) || ['attention', 'down'].includes(c.health))
    .map((c) => ({
      label: PROVIDER_LABEL[c.provider_key] || 'A connected service',
      state: (c.status === 'connected' && !['attention', 'down'].includes(c.health)) ? 'ok' as const : 'attention' as const,
    }));

  const input: WebsiteHealthInput = {
    now,
    site_status: tree.site_status,
    has_unpublished_changes: tree.has_unpublished_changes,
    publish_failed: tree.site_status === 'publish_failed',
    last_published_at: tree.last_published_at,
    missing_count: missing.length,
    missing_href: missing[0] || null,
    scheduled: tree.site_status === 'scheduled',
    launch: launch.items,
    connections,
    contact_form_working: arr(formQ).length > 0,
    versions_saved: arr(snapQ).length > 0,
    domain: site.custom_domain || null,
  };

  return json({ data: buildWebsiteHealth(input) }, 200, cors);
}
