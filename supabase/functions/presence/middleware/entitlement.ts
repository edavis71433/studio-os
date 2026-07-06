// Entitlement gate — enforced at the function boundary, OUTSIDE RLS (the
// ratified separation: RLS answers "is this yours", middleware answers "are you
// allowed to use this feature"). Reads presence_entitlements with the service
// role (a system table, default-deny to clients).
//
//   staff        -> full   (admin bypass; unchanged)
//   active       -> full
//   paused       -> readonly (writes 403, reads ok)
//   lapsed/none  -> denied (friendly 403)
import { svc } from '../lib/db.ts';
import type { Principal } from '../../_shared/auth.ts';

export type Mode = 'full' | 'readonly' | 'denied';

export async function checkEntitlement(principal: Principal, clientId: string | null): Promise<{ mode: Mode; message: string }> {
  if (principal.kind === 'staff') return { mode: 'full', message: '' };
  if (!clientId) return { mode: 'denied', message: 'No Presence subscription found for this account.' };

  const r = await svc(`presence_entitlements?client_id=eq.${encodeURIComponent(clientId)}&product=eq.presence&select=status&limit=1`);
  const status = r.ok && Array.isArray(r.json) && r.json.length ? String(r.json[0].status) : 'none';

  if (status === 'active') return { mode: 'full', message: '' };
  if (status === 'paused') return { mode: 'readonly', message: 'Your Presence subscription is paused — you can view your site but editing is turned off.' };
  return { mode: 'denied', message: 'Your Presence subscription isn’t active. Reach out to get it turned back on.' };
}
