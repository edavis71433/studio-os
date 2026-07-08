// ── /portal/* — A7 workspace context, members, and client-visibility shares ──
// context: any signed-in caller learns their site-role + capabilities (so the UI
// can present the business-owner workspace vs the simpler client portal).
// members + shares: managing them requires the owner (or the operator) — a
// client_reviewer can never manage members or change what's shared.
//   GET  /portal/context                 — { site_role, capabilities, sees_full_workspace }
//   GET  /portal/members                 — list (owner/operator)
//   POST /portal/members                 — { email, role } add/update (owner/operator)
//   POST /portal/members/:id/revoke      — revoke (owner/operator)
//   GET  /portal/shares                  — current overrides (owner/operator)
//   POST /portal/shares                  — { surface, item_id?, shared } set (owner/operator)
import { json } from '../../_shared/http.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';
import { capabilitiesOf, siteCan } from '../lib/site_roles.ts';
import type { SiteRole } from '../lib/site_roles.ts';
import { resolveSiteRole, listSiteMembers, addSiteMember, revokeSiteMember, loadShares, setShare } from '../lib/workspace.ts';

async function requireManager(jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<{ role: SiteRole } | Response> {
  const role = await resolveSiteRole(jwt, site.id, principal.kind);
  if (!siteCan(role, 'invite') && !siteCan(role, 'configure')) {
    return json({ error: 'forbidden', message: 'Only the account owner can manage who sees what.' }, 403, cors);
  }
  return { role };
}

export async function handlePortalContext(jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const role = await resolveSiteRole(jwt, site.id, principal.kind);
  return json({ data: {
    site_role: role,
    capabilities: capabilitiesOf(role),
    sees_full_workspace: siteCan(role, 'view_all'),
    is_client_portal: siteCan(role, 'view_shared') && !siteCan(role, 'view_all'),
  } }, 200, cors);
}

export async function handleMembersList(jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const g = await requireManager(jwt, site, principal, cors); if (g instanceof Response) return g;
  return json({ data: await listSiteMembers(site.id) }, 200, cors);
}

export async function handleMemberAdd(req: Request, jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const g = await requireManager(jwt, site, principal, cors); if (g instanceof Response) return g;
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const res = await addSiteMember(site.id, String(body?.email || ''), body?.role, principal.userId || 'owner');
  if (!res.ok) {
    const msg = res.error === 'bad_email' ? 'That doesn’t look like an email address.' : res.error === 'bad_role' ? 'Pick a valid role.' : 'That didn’t save — please try again.';
    return json({ error: res.error, message: msg }, res.error === 'write_failed' ? 502 : 400, cors);
  }
  return json({ data: { ok: true, message: 'Added. They’ll see only what you choose to share.' } }, 200, cors);
}

export async function handleMemberRevoke(jwt: string, site: SiteRow, memberId: string, principal: Principal, cors: Record<string, string>) {
  const g = await requireManager(jwt, site, principal, cors); if (g instanceof Response) return g;
  const ok = await revokeSiteMember(site.id, memberId);
  return ok ? json({ data: { ok: true, message: 'Access removed.' } }, 200, cors) : json({ error: 'not_found', message: 'That person isn’t on this account.' }, 404, cors);
}

export async function handleSharesList(jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const g = await requireManager(jwt, site, principal, cors); if (g instanceof Response) return g;
  const m = await loadShares(site.id);
  return json({ data: { shares: [...m.entries()].map(([k, shared]) => { const [surface, item] = k.split(':'); return { surface, item_id: item === '*' ? null : item, shared }; }) } }, 200, cors);
}

export async function handleShareSet(req: Request, jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const g = await requireManager(jwt, site, principal, cors); if (g instanceof Response) return g;
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const surface = String(body?.surface || '').trim();
  if (!surface) return json({ error: 'bad_request', message: 'Which kind of item?' }, 400, cors);
  const ok = await setShare(site.id, surface, body?.item_id ?? null, !!body?.shared, principal.userId || 'owner');
  return ok ? json({ data: { ok: true, message: body?.shared ? 'Shared with your client.' : 'Kept internal.' } }, 200, cors) : json({ error: 'write_failed', message: 'That didn’t save — please try again.' }, 502, cors);
}
