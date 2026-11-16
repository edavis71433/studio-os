// ── How many sites a studio looks after, against its plan (builder item 198) ──
// File 06, finding 44: the limit counted sites in the Trash, was shown nowhere, and only
// + New site checked it. One rule now, the same at every door that adds a site to a
// studio's list: + New site, Add a customer (Home, Customers, Contacts), Convert on a
// won deal, Add to your list (POST /agency/clients) and Restore from the Trash. Every
// site in the list counts (archived ones too: the studio still has them) except the
// ones in the Trash, which are on their way out. Sites shows it as "8 of 25 sites".
import { svc } from './db.ts';
import { UUID_RE } from './uuid.ts';

export interface Room { used: number; limit: number | null; full: boolean }
export interface ListRow { site_id: string; status: string }

/** Pure: the count from the statuses of the studio's list. A limit that isn't a number
 *  (never so in the database, where it defaults to 25) is no limit, as the old check had it. */
export function roomOf(statuses: ReadonlyArray<string | null | undefined>, limit: unknown): Room {
  const used = statuses.filter((s) => s !== 'trashed').length;
  const n = limit === null || limit === undefined || limit === '' ? NaN : Number(limit);
  if (!Number.isFinite(n)) return { used, limit: null, full: false };
  const max = Math.max(0, Math.trunc(n));
  return { used, limit: max, full: used >= max };
}

/** What each door says when the plan is full. Plain words; nothing was made. */
export function roomFullMessage(max: number | null, door: 'new' | 'add' | 'convert' | 'restore'): string {
  const limit = max ?? 0;   // only a full room is ever said, and a full room has a number
  const head = `Your plan covers ${limit} site${limit === 1 ? '' : 's'}, and all ${limit} ${limit === 1 ? 'is' : 'are'} in use.`;
  if (door === 'add') return `${head} Move one you no longer need to the Trash on Sites, then add them. Nothing was made.`;
  if (door === 'convert') return `${head} Move one you no longer need to the Trash on Sites, then convert again.`;   // under 160: the deal page shows it whole
  if (door === 'restore') return `${head} Move another you no longer need to the Trash first, then bring this one back.`;
  return `${head} Sites in the Trash don’t count, so moving one you no longer need there makes room.`;
}

/** The studio's list, read once: each site and its status. Null when the read fails; the
 *  door then goes ahead, since a plan limit isn't worth refusing work over a hiccup. */
export async function studioList(agencyId: string): Promise<ListRow[] | null> {
  if (!UUID_RE.test(String(agencyId))) return null;
  const r = await svc(`presence_agency_clients?agency_id=eq.${agencyId}&select=site_id,status&limit=1000`).catch(() => null);
  return r && r.ok && Array.isArray(r.json) ? (r.json as ListRow[]) : null;
}

/** Would putting this site in the list add one to the count? Not when it's already
 *  there and out of the Trash. */
export function addsToRoom(list: ReadonlyArray<ListRow>, siteId: string | null | undefined): boolean {
  const row = siteId ? list.find((l) => l.site_id === siteId) : undefined;
  return !row || row.status === 'trashed';
}
