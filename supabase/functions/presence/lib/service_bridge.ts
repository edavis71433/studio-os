// ── Agency–Client Bridge — store helpers (Presence CMS Phase 2, P2-D hardening) ─
// The tenant-safe link between an agency-site delivery project and the customer's
// own workspace. ONE authoritative project (on the agency site); the customer
// reaches only their linked, client-visible delivery through this bridge. Used by
// the convert handoff (create project + bridge, idempotent) and the /client/*
// endpoints (resolve which projects a customer may see).
import { svc } from './db.ts';

const rows = (r: { json?: unknown }) => (Array.isArray((r as any).json) ? (r as any).json : []) as any[];
const nowIso = () => new Date().toISOString();

async function projectEventRow(siteId: string, projectId: string, kind: string, actor: string, actorKind: string, clientVisible: boolean, detail: Record<string, unknown> = {}) {
  await svc('presence_project_events', { method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ project_id: projectId, site_id: siteId, kind, actor, actor_kind: actorKind, client_visible: clientVisible, detail }) }).catch(() => {});
}

/** Upsert the bridge for a project (idempotent — UNIQUE(project_id)). Enforces the
 *  frozen launch constraint: ONE primary agency per customer. A customer already
 *  owned by a DIFFERENT agency is refused (returns false) — the link is not made. */
export async function ensureBridge(agencySiteId: string, projectId: string, customerClientId: string | null, customerSiteId: string | null, dealId: string | null): Promise<boolean> {
  if (!customerClientId) return false; // a project with no customer (manual studio project) needs no bridge
  // claim the customer's primary agency (first writer wins; PK enforces one-agency)
  await svc('presence_customer_agency?on_conflict=customer_client_id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({ customer_client_id: customerClientId, agency_site_id: agencySiteId }) }).catch(() => {});
  const owner = rows(await svc(`presence_customer_agency?customer_client_id=eq.${customerClientId}&select=agency_site_id&limit=1`))[0];
  if (owner && owner.agency_site_id !== agencySiteId) return false; // belongs to another agency — refuse (multi-agency is deferred)
  const r = await svc('presence_service_links?on_conflict=project_id', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ agency_site_id: agencySiteId, project_id: projectId, customer_client_id: customerClientId, customer_site_id: customerSiteId, deal_id: dealId, status: 'active' }),
  });
  return r.ok;
}

export interface DealForHandoff { id: string; title?: string | null; created_project_id?: string | null; converted_client_id?: string | null; converted_site_id?: string | null; }

/** Idempotently ensure a delivery PROJECT + BRIDGE exist for a converted deal.
 *  Creates the project on the AGENCY site (client_id = the customer), stamps
 *  deal.created_project_id (race-safe), links the bridge, and records a handoff
 *  event. Re-running returns the existing project (never a duplicate). */
export async function ensureProjectForDeal(opts: {
  agencySiteId: string; deal: DealForHandoff; clientId: string | null; customerSiteId: string | null; actor: string; actorKind: string;
}): Promise<{ ok: boolean; project: any | null; idempotent: boolean; conflict?: boolean }> {
  const { agencySiteId, deal, clientId, customerSiteId, actor, actorKind } = opts;

  // already handed off → return the existing project (+ ensure the bridge)
  if (deal.created_project_id) {
    const existing = rows(await svc(`presence_projects?id=eq.${deal.created_project_id}&site_id=eq.${agencySiteId}&deleted_at=is.null&select=*&limit=1`))[0];
    if (existing) { await ensureBridge(agencySiteId, existing.id, clientId, customerSiteId, deal.id); return { ok: true, project: existing, idempotent: true }; }
  }

  const ins = await svc('presence_projects', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: agencySiteId, client_id: clientId, deal_id: deal.id, name: String(deal.title || 'New project').slice(0, 200), description: '', status: 'active', client_visible: true }) });
  const project = rows(ins)[0];
  if (!project) return { ok: false, project: null, idempotent: false };

  // claim the handoff atomically (UNIQUE created_project_id backs this)
  const claim = await svc(`presence_deals?id=eq.${deal.id}&site_id=eq.${agencySiteId}&created_project_id=is.null&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ created_project_id: project.id }) });
  if (!rows(claim)[0]) { // lost the race → drop our orphan, return the winner
    await svc(`presence_projects?id=eq.${project.id}`, { method: 'PATCH', body: JSON.stringify({ deleted_at: nowIso() }) }).catch(() => {});
    const fresh = rows(await svc(`presence_deals?id=eq.${deal.id}&site_id=eq.${agencySiteId}&select=created_project_id&limit=1`))[0];
    const won = fresh?.created_project_id ? rows(await svc(`presence_projects?id=eq.${fresh.created_project_id}&site_id=eq.${agencySiteId}&deleted_at=is.null&select=*&limit=1`))[0] : null;
    if (won) { await ensureBridge(agencySiteId, won.id, clientId, customerSiteId, deal.id); return { ok: true, project: won, idempotent: true }; }
    return { ok: false, project: null, idempotent: false, conflict: true };
  }

  await ensureBridge(agencySiteId, project.id, clientId, customerSiteId, deal.id);
  await projectEventRow(agencySiteId, project.id, 'project_created', actor, actorKind, true, { name: project.name, from_deal: deal.id });
  return { ok: true, project, idempotent: false };
}

// ── customer-side resolution (the /client/* endpoints) ──
export interface Link { project_id: string; agency_site_id: string; customer_client_id: string; }

/** The active links for a customer (by their clients.id). Bounded. */
export async function linksForCustomer(customerClientId: string): Promise<Link[]> {
  if (!customerClientId) return [];
  return rows(await svc(`presence_service_links?customer_client_id=eq.${customerClientId}&status=eq.active&select=project_id,agency_site_id,customer_client_id&order=created_at.desc&limit=200`)) as Link[];
}

/** Verify a customer is linked to a specific project; returns the link (with the
 *  agency_site_id the data lives on) or null. This is the tenant-isolation gate
 *  for every /client/* project action. */
export async function linkForCustomerProject(customerClientId: string, projectId: string): Promise<Link | null> {
  if (!customerClientId || !projectId) return null;
  return rows(await svc(`presence_service_links?project_id=eq.${projectId}&customer_client_id=eq.${customerClientId}&status=eq.active&select=project_id,agency_site_id,customer_client_id&limit=1`))[0] || null;
}

/** Given an approval / deliverable / survey / support id, resolve the project it
 *  belongs to (on any agency site) then verify the customer is linked to it.
 *  Returns { link, siteId } or null. `table` must be a delivery table with a
 *  project_id column; `parentCol` is the id column to match. */
export async function linkForCustomerVia(customerClientId: string, table: string, id: string, hasProject = true): Promise<{ link: Link; row: any } | null> {
  if (!customerClientId || !id) return null;
  const sel = hasProject ? 'project_id,site_id' : 'site_id';
  const row = rows(await svc(`${table}?id=eq.${id}&deleted_at=is.null&select=id,${sel}&limit=1`))[0];
  if (!row || !row.project_id) return null;
  const link = await linkForCustomerProject(customerClientId, row.project_id);
  return link ? { link, row } : null;
}

/** Email the bridged customer about project activity that needs them (a studio
 *  message, an approval request). Without this, the delivery loop stalls unless
 *  the client habitually opens the portal — an approval could sit unseen forever.
 *  Best-effort: resolves project → bridge → customer email; never throws. */
export async function emailBridgedCustomer(agencySiteId: string, projectId: string, subject: string, bodyHtml: string): Promise<boolean> {
  try {
    const link = rows(await svc(`presence_service_links?project_id=eq.${projectId}&agency_site_id=eq.${agencySiteId}&status=eq.active&select=customer_client_id&limit=1`))[0];
    if (!link?.customer_client_id) return false;
    const client = rows(await svc(`clients?id=eq.${link.customer_client_id}&select=email&limit=1`))[0];
    const email = client?.email ? String(client.email) : '';
    if (!email) return false;
    const { sendEmail } = await import('../commerce/account.ts');
    const { loadEmailBrand } = await import('./email_brand.ts');
    const brand = await loadEmailBrand(agencySiteId);
    const btn = `<a href="${(Deno.env.get('SITE_URL') || 'https://davisdigitalstudio.com')}/client.html" style="display:inline-block;margin-top:6px;background:${brand.accent};color:#fff;padding:9px 16px;border-radius:999px;text-decoration:none">Open your project →</a>`;
    // critical: this is the "your project needs you" nudge — an opted-out client's
    // approval/message must still reach them (bounces still suppress).
    return await sendEmail(email, subject, `${bodyHtml}<p class="cta">${btn}</p>`, brand, { critical: true });
  } catch { return false; }
}

/** Email a customer DIRECTLY by their clients.id — the transactional channel for
 *  a support request that has no project to resolve a recipient through (the
 *  auto-acknowledgement of a new ticket). Same agency brand + "open your project"
 *  button as emailBridgedCustomer. Best-effort: never throws. */
export async function emailCustomerByClient(agencySiteId: string, customerClientId: string | null, subject: string, bodyHtml: string): Promise<boolean> {
  try {
    if (!customerClientId) return false;
    const client = rows(await svc(`clients?id=eq.${customerClientId}&select=email&limit=1`))[0];
    const email = client?.email ? String(client.email) : '';
    if (!email) return false;
    const { sendEmail } = await import('../commerce/account.ts');
    const { loadEmailBrand } = await import('./email_brand.ts');
    const brand = await loadEmailBrand(agencySiteId);
    const btn = `<a href="${(Deno.env.get('SITE_URL') || 'https://davisdigitalstudio.com')}/client.html" style="display:inline-block;margin-top:6px;background:${brand.accent};color:#fff;padding:9px 16px;border-radius:999px;text-decoration:none">Open your project →</a>`;
    return await sendEmail(email, subject, `${bodyHtml}<p class="cta">${btn}</p>`, brand, { critical: true });
  } catch { return false; }
}
