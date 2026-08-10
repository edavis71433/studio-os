// ── Presence Monitor connection routes (M11) ────────────────────────────────
//   GET    /monitor/connection   — the connection (url, method, token, status)
//   POST   /monitor/connect      — {url, method?} → pending connection + instructions
//   POST   /monitor/verify       — run the read-only ownership check
//   DELETE /monitor/connection   — disconnect (observation stops)
// Observation only, forever: this file and everything it calls performs GET
// fetches and DNS lookups. Nothing on the customer's website, DNS, hosting,
// or infrastructure is ever modified. Monitor sites only.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import { verifyConnection, fetchExternalSite } from '../monitor/external.ts';
import { assessMigrationReadiness } from '../monitor/readiness.ts';
import { buildImportInventory } from '../platform/importer.ts';
import type { ReadinessReport } from '../monitor/readiness.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const CONN_SELECT = 'site_id,url,domain,platform,method,token,status,verified_at,last_checked_at,last_check_note,created_at';
const METHODS = ['dns', 'meta', 'file'];

const instructions = (method: string, token: string, domain: string) =>
  method === 'dns' ? `Add a DNS TXT record on _dds-verify.${domain} with this value: ${token}`
  : method === 'file' ? `Place a file at /dds-verify-${token}.txt on your website containing exactly: ${token}`
  : `Add this tag inside your homepage's <head>: <meta name="dds-site-verification" content="${token}">`;

export async function handleMonitorGet(_jwt: string, site: SiteRow, cors: Record<string, string>) {
  // Service-role read, deliberately. `site` only reaches this handler after
  // index.ts authorized the caller for it (owner via resolveSite/RLS, agency
  // operator via resolveScopedSite — fail-closed — and client_reviewers are
  // refused at the reviewer boundary). The previous asUser read answered NULL
  // for a scoped operator (RLS: my_presence_site_ids covers only the caller's
  // OWN clients), so the card showed "Connect" over an existing connection —
  // and one more tap would merge-duplicate a fresh token over a VERIFIED row.
  const r = await svc(`presence_monitor_connections?site_id=eq.${site.id}&select=${CONN_SELECT}&limit=1`);
  if (!r.ok) return json({ error: 'read_failed', message: 'We couldn’t check the connection just now.' }, 502, cors);
  const c = r.json?.[0] ?? null;
  return json({ data: c ? { ...c, instructions: instructions(c.method, c.token, c.domain) } : null }, 200, cors);
}

export async function handleMonitorConnect(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  // Who may record an external website address here:
  //   edition 'monitor'                 — always (this workspace exists to observe one).
  //   edition 'presence', UNPUBLISHED   — yes: a rebuild-in-progress whose client is
  //     already live at their own domain. Recording it feeds Search Console now
  //     (gscDomainFor prefers a recorded external domain over the unpublished
  //     hosting subdomain) WITHOUT flipping the edition — a bare edition flip is
  //     unsafe (provisionForSignup re-syncs edition from the entitlement plan, and
  //     'monitor' would revoke drafting/publishing at the index.ts boundary).
  //   edition 'presence', PUBLISHED     — refused: the website we host IS their
  //     website; its own domain is the Search Console property.
  if (site.edition !== 'monitor' && site.last_published_at) {
    return json({ error: 'not_monitor', message: 'This website is hosted and published here — its own address is what Google reports on. There’s nothing elsewhere to record.' }, 400, cors);
  }
  let body: { url?: string; method?: string } = {};
  try { body = await req.json(); } catch { return json({ error: 'bad_json', message: 'That didn’t read right.' }, 400, cors); }
  let url: URL;
  try {
    url = new URL(String(body?.url || ''));
    if (!/^https?:$/.test(url.protocol) || !url.hostname.includes('.')) throw new Error('bad');
  } catch { return json({ error: 'bad_url', message: 'A full website address is needed — like https://yourbusiness.com.' }, 400, cors); }
  const method = METHODS.includes(String(body?.method)) ? String(body?.method) : 'meta';
  const clean = `${url.protocol}//${url.host}/`;

  // read-only look at the site: platform detection is a courtesy, not a gate
  let platform = 'custom';
  try { const ext = await fetchExternalSite(clean); if (ext) platform = ext.platform; } catch { /* detection optional */ }

  const token = 'dds-' + crypto.randomUUID().replace(/-/g, '').slice(0, 24);
  const w = await svc(`presence_monitor_connections?on_conflict=site_id&select=${CONN_SELECT}`, {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ site_id: site.id, url: clean, domain: url.hostname, platform, method, token, status: 'pending', verified_at: null, last_check_note: '' }),
  });
  if (!w.ok || !w.json?.[0]) return json({ error: 'write_failed', message: 'That didn’t save — please try again.' }, 502, cors);
  await writeChangeEvent({ siteId: site.id, entityType: 'settings', entityId: null, action: 'update', summary: `Connected website ${url.hostname} (pending verification)`, principal, provenance: 'human', fields: ['monitor_connection'] });
  const c = w.json[0];
  return json({ data: { ...c, instructions: instructions(c.method, c.token, c.domain) } }, 200, cors);
}

export async function handleMonitorVerify(site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const q = await svc(`presence_monitor_connections?site_id=eq.${site.id}&select=${CONN_SELECT}&limit=1`);
  const c = q.json?.[0];
  if (!c) return json({ error: 'not_connected', message: 'Connect your website first.' }, 404, cors);
  const result = await verifyConnection(c);
  const patch: Record<string, unknown> = { last_checked_at: new Date().toISOString(), last_check_note: result.note };
  if (result.verified && c.status !== 'verified') { patch.status = 'verified'; patch.verified_at = new Date().toISOString(); }
  await svc(`presence_monitor_connections?site_id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  if (result.verified && c.status !== 'verified') {
    await writeChangeEvent({ siteId: site.id, entityType: 'settings', entityId: null, action: 'update', summary: `Website ownership verified (${c.domain})`, principal, provenance: 'human', fields: ['monitor_connection'] });
  }
  return json({ data: { verified: result.verified, note: result.note } }, 200, cors);
}

/** Compute + quietly store the Migration Readiness assessment. Shared by the
 *  client route (sentences) and the admin route (full detail). Read-only
 *  toward the customer's website; deterministic given pages + evidence. */
export async function computeReadiness(site: SiteRow): Promise<ReadinessReport | null> {
  const connQ = await svc(`presence_monitor_connections?site_id=eq.${site.id}&status=eq.verified&select=url&limit=1`);
  const conn = connQ.json?.[0];
  if (!conn?.url) return null;
  const ext = await (async () => { try { return await fetchExternalSite(conn.url); } catch { return null; } })();
  if (!ext || !ext.pages.length) return null;
  const runQ = await svc(`presence_evidence_runs?site_id=eq.${site.id}&finished_at=not.is.null&error_text=is.null&select=id&order=started_at.desc&limit=1`);
  let evidence: Array<{ category: string; type: string; severity: string; human: string }> = [];
  if (runQ.json?.[0]?.id) {
    const evQ = await svc(`presence_evidence?run_id=eq.${runQ.json[0].id}&select=category,type,severity,human&limit=1000`);
    evidence = evQ.json ?? [];
  }
  const report = assessMigrationReadiness(ext.pages, evidence);
  await svc(`presence_monitor_connections?site_id=eq.${site.id}`, {
    method: 'PATCH', body: JSON.stringify({ readiness: report, readiness_at: new Date().toISOString() }),
  });
  return report;
}

export async function handleMonitorReadiness(site: SiteRow, cors: Record<string, string>) {
  if (site.edition !== 'monitor') return json({ error: 'not_monitor', message: 'This website already lives here.' }, 400, cors);
  const r = await computeReadiness(site);
  if (!r) return json({ error: 'not_ready', message: 'Connect and verify your website first — then this can take a proper look.' }, 409, cors);
  // customers get sentences and plans — never the state word, never counts-as-scores
  return json({ data: {
    summary: r.summary,
    pages: r.pages.map((p) => ({ path: p.path, plan: p.plan })),
    first_fixes: r.accessibility_first.map((a) => a.what),
    after_the_move: r.content_after,
  } }, 200, cors);
}

/** M14: the migration import inventory — what's on the external site, page by
 *  page (text, images, meta), reviewable BEFORE anything moves. Read-only;
 *  content arrives only through the existing CMS flows after plan approval. */
export async function handleImportInventory(site: SiteRow, cors: Record<string, string>) {
  if (site.edition !== 'monitor') return json({ error: 'not_monitor', message: 'The import inventory reads an external website.' }, 400, cors);
  const connQ = await svc(`presence_monitor_connections?site_id=eq.${site.id}&status=eq.verified&select=url&limit=1`);
  const conn = connQ.json?.[0];
  if (!conn?.url) return json({ error: 'not_ready', message: 'Connect and verify the website first.' }, 409, cors);
  const ext = await (async () => { try { return await fetchExternalSite(conn.url); } catch { return null; } })();
  if (!ext?.pages.length) return json({ error: 'fetch_failed', message: 'The website didn’t answer — try again shortly.' }, 502, cors);
  const inventory = buildImportInventory(ext.pages, conn.url);
  return json({ data: { ...inventory, note: 'Nothing has been imported. This is the review — content moves only through the migration plan you approve, and every page arrives as a draft first.' } }, 200, cors);
}

export async function handleMonitorDisconnect(site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const w = await svc(`presence_monitor_connections?site_id=eq.${site.id}&select=domain`, {
    method: 'DELETE', headers: { Prefer: 'return=representation' },
  });
  if (!w.ok || !w.json?.[0]) return json({ error: 'not_found', message: 'No website is connected.' }, 404, cors);
  await writeChangeEvent({ siteId: site.id, entityType: 'settings', entityId: null, action: 'delete', summary: `Disconnected website ${w.json[0].domain}`, principal, provenance: 'human' });
  return json({ data: { ok: true } }, 200, cors);
}
