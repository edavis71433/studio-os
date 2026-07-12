// Entitlement gate — enforced at the function boundary, OUTSIDE RLS (the
// ratified separation: RLS answers "is this yours", middleware answers "are you
// allowed to use this feature"). Reads presence_entitlements with the service
// role (a system table, default-deny to clients).
//
//   staff          -> full   (admin bypass; unchanged)
//   active         -> full
//   paused         -> readonly (writes 403, reads ok)
//   lapsed         -> readonly (M3: view your workspace + export any time; paid
//                     editing/publishing/AI stay off. Billing routes are dispatched
//                     BEFORE this gate, so payment can still be fixed to recover.)
//   deleted/none   -> denied (friendly 403; export still allowed by the caller)
import { svc } from '../lib/db.ts';
import type { Principal } from '../../_shared/auth.ts';

export type Mode = 'full' | 'readonly' | 'denied';

// Per-request memo (same WeakMap pattern as resolveSiteRoleCached): the
// entitlement row was read up to 3× per request (boundary gate reads status,
// feature gate reads plan, portal-context reads plan — same row). ONE memoized
// full-row read serves all three. Keyed on the per-request principal object →
// GC'd with the request, no cross-request staleness.
export interface EntRow { status: string; plan: string | null }
const entCache = new WeakMap<object, Map<string, EntRow>>();

export async function entitlementFor(principal: Principal, clientId: string): Promise<EntRow> {
  let m = entCache.get(principal as object);
  if (!m) { m = new Map(); entCache.set(principal as object, m); }
  const hit = m.get(clientId);
  if (hit) return hit;
  const r = await svc(`presence_entitlements?client_id=eq.${encodeURIComponent(clientId)}&product=eq.presence&select=status,plan&limit=1`);
  const row: EntRow = r.ok && Array.isArray(r.json) && r.json.length
    ? { status: String(r.json[0].status), plan: r.json[0].plan == null ? null : String(r.json[0].plan) }
    : { status: 'none', plan: null };
  m.set(clientId, row);
  return row;
}

export async function checkEntitlement(principal: Principal, clientId: string | null): Promise<{ mode: Mode; message: string }> {
  if (principal.kind === 'staff') return { mode: 'full', message: '' };
  if (!clientId) return { mode: 'denied', message: 'No Presence subscription found for this account.' };

  const status = (await entitlementFor(principal, clientId)).status;

  if (status === 'active') return { mode: 'full', message: '' };
  if (status === 'paused') return { mode: 'readonly', message: 'Your Presence subscription is paused — you can view your site but editing is turned off.' };
  // M3: lapsed keeps read-only workspace + export (so "download from your workspace
  // any time" is true); editing/publishing/AI stay off. Update payment to recover.
  if (status === 'lapsed') return { mode: 'readonly', message: 'Your Presence subscription ended — you can still view and download everything. Update your payment to turn editing and publishing back on.' };
  return { mode: 'denied', message: 'Your Presence subscription isn’t active. Reach out to get it turned back on.' };
}
