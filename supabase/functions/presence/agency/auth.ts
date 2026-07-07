// ── Agency membership + capabilities (M13) ──────────────────────────────────
// EXTENDS the existing security model, never replaces it: staff stays the
// operator superset; clients keep owning their sites; an agency member is a
// third, explicitly-scoped principal that exists ONLY inside /agency routes.
// Fail-closed exactly like verifyStaff: no row, bad token, revoked, paused
// agency — all deny.
import { svc } from '../lib/db.ts';

const SB_URL = Deno.env.get('SUPABASE_URL') || '';
const SB_SERVICE = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

export type AgencyRole = 'owner' | 'admin' | 'account_manager' | 'content_strategist' | 'designer' | 'developer' | 'support' | 'readonly';

export interface AgencyMember {
  agency_id: string;
  member_id: string;
  email: string;
  role: AgencyRole;
  agency_name: string;
  seat_limit: number;
  client_limit: number;
  plan: string;
  branding: Record<string, unknown>;
}

/* ── the capability table (PURE) — permissions as data, one place ── */
export type Capability =
  | 'read'            // portfolio, queues, usage, branding
  | 'notes'           // internal notes on clients
  | 'bulk_observe'    // dispatch observation/proposal engines (never changes content)
  | 'bulk_publish'    // dispatch the existing publish pipeline per site
  | 'manage_clients'  // onboard, tag, assign, archive/restore
  | 'manage_members'  // invite, change roles, revoke
  | 'manage_branding';

const CAPS: Record<AgencyRole, Capability[]> = {
  owner: ['read', 'notes', 'bulk_observe', 'bulk_publish', 'manage_clients', 'manage_members', 'manage_branding'],
  admin: ['read', 'notes', 'bulk_observe', 'bulk_publish', 'manage_clients', 'manage_members', 'manage_branding'],
  account_manager: ['read', 'notes', 'bulk_observe', 'bulk_publish', 'manage_clients'],
  content_strategist: ['read', 'notes', 'bulk_observe'],
  designer: ['read', 'notes', 'bulk_observe'],
  developer: ['read', 'notes', 'bulk_observe'],
  support: ['read', 'notes'],
  readonly: ['read'],
};

export const can = (role: AgencyRole, cap: Capability): boolean => (CAPS[role] || []).includes(cap);

/** Resolve an authenticated JWT to an active agency membership. Fail-closed. */
export async function resolveAgencyMember(jwt: string): Promise<AgencyMember | null> {
  if (!jwt) return null;
  let user: { id?: string; email?: string } | null = null;
  try {
    const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_SERVICE, Authorization: `Bearer ${jwt}` } });
    if (!r.ok) return null;
    user = await r.json();
  } catch { return null; }
  if (!user?.id) return null;
  const email = (user.email || '').toLowerCase();
  const m = await svc(`presence_agency_members?status=eq.active&or=(user_id.eq.${user.id},email.eq.${encodeURIComponent(email)})&select=id,agency_id,email,role&limit=1`);
  const row = m.json?.[0];
  if (!row) return null;
  const a = await svc(`presence_agencies?id=eq.${row.agency_id}&status=eq.active&select=id,name,seat_limit,client_limit,plan,branding&limit=1`);
  const ag = a.json?.[0];
  if (!ag) return null;          // paused agency ⇒ every member denied
  // learn the user_id on first sight (email-invited members)
  if (!row.user_id) await svc(`presence_agency_members?id=eq.${row.id}`, { method: 'PATCH', body: JSON.stringify({ user_id: user.id }) });
  return {
    agency_id: row.agency_id, member_id: row.id, email: row.email, role: row.role as AgencyRole,
    agency_name: ag.name, seat_limit: ag.seat_limit, client_limit: ag.client_limit, plan: ag.plan,
    branding: ag.branding || {},
  };
}

/** The agency's active site ids — the scope every /agency operation is fenced to. */
export async function agencySiteIds(agencyId: string, includeArchived = false): Promise<string[]> {
  const st = includeArchived ? '' : '&status=eq.active';
  const r = await svc(`presence_agency_clients?agency_id=eq.${agencyId}${st}&select=site_id&limit=1000`);
  return (r.json ?? []).map((x: { site_id: string }) => x.site_id);
}
