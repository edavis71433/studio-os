// ── The outside accounts Studio OS depends on, on the Health page (builder list item 398) ──
// GET  /admin/accounts                 every account on the list, its last tick, and which are due
// POST /admin/accounts/<key>/checked   the platform's owner says they looked at that account today
// Platform staff only (index.ts sends /admin/* here only for staff), and only the owner may tick:
// a tick is the owner's own word that they looked. The list and what to check at each account
// are lib/outside_accounts.ts; the ticks are platform_account_checks (migration 0267). Before
// that migration has run, every account reads as never checked and a tick says it couldn't save.
import { json } from '../../_shared/http.ts';
import type { Principal } from '../../_shared/auth.ts';
import { svc } from '../lib/db.ts';
import { CHECK_EVERY_DAYS, accountLines, isAccountKey, type AccountCheck } from '../lib/outside_accounts.ts';

/** Only the platform's owner ticks an account. Pure. */
export const mayTick = (p: Pick<Principal, 'kind' | 'role'>): boolean => p.kind === 'staff' && p.role === 'owner';

async function readTicks(): Promise<{ ticks: AccountCheck[]; ready: boolean }> {
  const r = await svc('platform_account_checks?select=account,checked_at,checked_by&limit=50').catch(() => null);
  if (!r || !r.ok || !Array.isArray(r.json)) return { ticks: [], ready: false };
  return { ticks: r.json as AccountCheck[], ready: true };
}

export async function handleAccountsList(principal: Principal, cors: Record<string, string>, nowMs: number = Date.now()): Promise<Response> {
  const { ticks, ready } = await readTicks();
  const accounts = accountLines(ticks, nowMs);
  return json({ data: { accounts, due: accounts.filter((a) => a.due).length, every_days: CHECK_EVERY_DAYS, can_tick: mayTick(principal), ready } }, 200, { ...cors, 'Cache-Control': 'no-store' });
}

export async function handleAccountChecked(key: string, principal: Principal, cors: Record<string, string>, nowMs: number = Date.now()): Promise<Response> {
  if (!mayTick(principal)) return json({ error: 'forbidden', message: 'Only the platform’s owner ticks these, after looking at each account.' }, 403, cors);
  if (!isAccountKey(key)) return json({ error: 'not_found', message: 'That account isn’t on the list.' }, 404, cors);
  const w = await svc('platform_account_checks?on_conflict=account', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ account: key, checked_at: new Date(nowMs).toISOString(), checked_by: principal.email || principal.userId || 'owner' }),
  }).catch(() => null);
  if (!w || !w.ok) return json({ error: 'write_failed', message: 'That didn’t save just now. Try again in a moment.' }, 502, cors);
  return handleAccountsList(principal, cors, nowMs);
}
