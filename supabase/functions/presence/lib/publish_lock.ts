// ── Lock publishing (builder list item 214, Nov 2026 review, file 03 finding 2) ──
// A switch per site that holds the live site as it is: a launch freeze, or a client in
// dispute. While it is on, nothing goes live by any route: Publish, Publish again, a restore
// straight to live, Bring back online, Take offline, a launch, the preview's Publish and a
// scheduled publish (that one waits, and goes once it is unlocked). The draft is never
// touched: edits and checkpoints carry on as before.
//
// The lock is a reserved row on the site (lib/reserved_store.ts): whether it is on, when it
// was set, which kind of hand set it and the words the client reads beside it. Who may change
// it: the studio working inside its client's site and platform staff, always; the owner of a
// site no studio looks after, and then only a lock the owner set. A seat never.
import { svc } from './db.ts';
import { readReservedJsonOrThrow, RESERVED_NAMES } from './reserved_store.ts';

export type LockHand = 'staff' | 'operator' | 'client';
export interface PublishLock { on: boolean; at: string; by_kind: LockHand; words: string }
export const LOCK_WORDS_MAX = 140;

const HANDS: readonly string[] = ['staff', 'operator', 'client'];

/** The words the client reads with the lock: one line, at most 140 characters. Pure. */
export function lockWords(v: unknown): string {
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, LOCK_WORDS_MAX) : '';
}

/** A stored lock, read safely: anything malformed is no lock. Pure. */
export function normalizeLock(raw: unknown): PublishLock | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.on !== 'boolean' || typeof r.at !== 'string' || Number.isNaN(Date.parse(r.at))) return null;
  return { on: r.on, at: r.at, by_kind: HANDS.includes(String(r.by_kind)) ? r.by_kind as LockHand : 'staff', words: lockWords(r.words) };
}

/** May this hand change the lock now? `studioSite`: a studio looks after the site (null when
 *  that couldn't be read, which counts as yes); `owner`: the caller is the business owner, not a
 *  seat. Pure. */
export function mayChangeLock(lock: PublishLock | null, who: LockHand, studioSite: boolean | null, owner: boolean): boolean {
  if (who === 'staff' || who === 'operator') return true;
  if (!owner || studioSite !== false) return false;
  return !lock || !lock.on || lock.by_kind === 'client';
}

const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** The sentence a refused go-live answers with, for the hand that asked. Pure. */
export function lockedSentence(lock: PublishLock, who: LockHand): string {
  const note = lock.words ? ` Their note: “${lock.words}”` : '';
  if (who === 'client' && lock.by_kind !== 'client') return `Your studio locked publishing on ${day(lock.at)}.${note} Nothing was published. Ask them if something needs to go live.`;
  return `Publishing is locked since ${day(lock.at)}. Nothing was published. Unlock it in Versions to publish.`;
}

/** The site's lock as stored: null when it has none. Throws when it can't be read. */
export async function readLock(siteId: string): Promise<PublishLock | null> {
  return normalizeLock(await readReservedJsonOrThrow(siteId, RESERVED_NAMES.publishLock));
}

/** What stops a go-live on this site now, or null when publishing is open. A lock that can't
 *  be read stops it as well: a dispute lock mustn't give way to a database hiccup. */
export async function lockStop(siteId: string, who: LockHand): Promise<{ status: number; body: Record<string, unknown> } | null> {
  let lock: PublishLock | null;
  try { lock = await readLock(siteId); }
  catch { return { status: 503, body: { error: 'lock_unreadable', message: 'We couldn’t check whether publishing is locked just now. Nothing was published. Try again in a moment.' } }; }
  if (!lock || !lock.on) return null;
  return { status: 409, body: { error: 'publish_locked', message: lockedSentence(lock, who), lock: { at: lock.at, by_kind: lock.by_kind, words: lock.words } } };
}

/** Does a studio look after this site (an active client of some studio)? Null when the read failed. */
export async function studioLooksAfter(siteId: string): Promise<boolean | null> {
  try {
    const r = await svc(`presence_agency_clients?site_id=eq.${siteId}&status=eq.active&select=site_id&limit=1`);
    return r.ok && Array.isArray(r.json) ? r.json.length > 0 : null;
  } catch { return null; }
}
