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
import { loadVisits } from './analytics.ts';
import { aggregateVisits } from '../lib/visits.ts';
import { buildContentPerformance } from '../lib/content_performance.ts';
import { sslStatus } from '../lib/netlify.ts';

const PROVIDER_LABEL: Record<string, string> = Object.fromEntries(CONNECTED_PROVIDERS.map((p: any) => [p.key, p.name]));
const arr = (r: { json: unknown }): any[] => (Array.isArray(r.json) ? r.json : []);

export async function handleWebsiteHealth(site: SiteRow, cors: Record<string, string>) {
  const now = new Date().toISOString();
  const nowMs = Date.parse(now);

  // reused projections + the honest launch probes, in parallel with the small
  // evidence reads (contact-form message received, a saved version exists) and
  // the already-collected first-party visits (for the plain-English "what this
  // means" projection — no new tracking, reuses loadVisits + aggregateVisits).
  const [tree, launch, connQ, formQ, snapQ, visits, upQ, sslQ] = await Promise.all([
    siteContentTree(site),
    siteLaunchChecklist(site),
    svc(`presence_connections?site_id=eq.${site.id}&select=provider_key,status,health`),
    svc(`presence_form_submissions?site_id=eq.${site.id}&spam=eq.false&select=id&limit=1`),
    svc(`presence_snapshots?site_id=eq.${site.id}&select=id&limit=1`),
    loadVisits(site.id, 'month', nowMs),
    // Real uptime-heartbeat state (0094). Best-effort: pre-migration this 400s and
    // we fall back to the publish-state inference — never breaks the page.
    svc(`presence_sites?id=eq.${site.id}&select=uptime_ok,uptime_checked_at&limit=1`).catch(() => ({ ok: false, json: null as any })),
    // Custom-domain TLS certificate expiry, best-effort. Only meaningful once a
    // custom domain + Netlify site exist; any failure degrades to no expiry line.
    (site.custom_domain && site.netlify_site_id)
      ? sslStatus(site.netlify_site_id).catch(() => ({ ok: false, expires_at: null as string | null }))
      : Promise.resolve({ ok: false, expires_at: null as string | null }),
  ]);
  if (!tree) return json({ error: 'template_missing', message: 'This site’s template isn’t available.' }, 500, cors);
  const upRow = (upQ && (upQ as any).ok) ? arr(upQ)[0] : null;
  const sslExpiresAt = (sslQ && (sslQ as any).ok) ? ((sslQ as any).expires_at ?? null) : null;

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
    // Real "online right now" from the latest probe. `typeof === 'boolean'` gates
    // the card: null (never probed) / missing column (pre-0094) → inference.
    online_now: typeof upRow?.uptime_ok === 'boolean' ? upRow.uptime_ok : undefined,
    uptime_checked_at: upRow?.uptime_checked_at ?? null,
    // Best-effort custom-domain certificate expiry → "Secure until {date}, renews
    // automatically" (only shown when the secure-connection check is already "done").
    ssl_expires_at: sslExpiresAt,
  };

  // Plain-English "what this means" over the visits we already collect (30-day
  // window — the calmest for an owner). Deterministic, honest empty state, and it
  // respects the fetch-cap `truncated` flag (never over-reads an incomplete set).
  const content_performance = buildContentPerformance(aggregateVisits(visits, nowMs, 30));

  return json({ data: { ...buildWebsiteHealth(input), content_performance } }, 200, cors);
}
