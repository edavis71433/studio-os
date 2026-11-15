// ── Lock publishing, the switch (builder list item 214) ──
//   GET /site/publish-lock → the lock as it stands, and whether the caller may change it
//   PUT /site/publish-lock { on, words? } → lock or unlock; words are what the client reads
// The rules are lib/publish_lock.ts's; every way of going live checks the lock there.
import { json } from '../../_shared/http.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import { writeReservedJson, RESERVED_NAMES } from '../lib/reserved_store.ts';
import { readLock, mayChangeLock, lockWords, studioLooksAfter, type PublishLock } from '../lib/publish_lock.ts';
import { publishActorKind } from '../lib/actor_kind.ts';
import { resolveSiteRoleCached } from '../lib/workspace.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const unreadable = (cors: Record<string, string>) => json({ error: 'read_failed', message: 'We couldn’t read whether publishing is locked just now. Try again in a moment.' }, 502, cors);

// The caller's hand, whether they are the business owner (not a seat), and whether a studio
// looks after the site: what mayChangeLock asks.
async function whoAsks(jwt: string, site: SiteRow, principal: Principal) {
  const who = publishActorKind(principal);
  if (who !== 'client') return { who, owner: false, studioSite: null as boolean | null };
  const [role, studioSite] = await Promise.all([resolveSiteRoleCached(principal, jwt, site.id).catch(() => null), studioLooksAfter(site.id)]);
  return { who, owner: role === 'business_owner' && !principal.member, studioSite };
}

const shape = (lock: PublishLock | null, canChange: boolean) => ({
  on: !!(lock && lock.on), at: lock ? lock.at : null, by_kind: lock ? lock.by_kind : null, words: lock && lock.on ? lock.words : '', can_change: canChange,
});

export async function handlePublishLockGet(jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  let lock: PublishLock | null;
  try { lock = await readLock(site.id); } catch { return unreadable(cors); }
  const w = await whoAsks(jwt, site, principal);
  return json({ data: shape(lock, mayChangeLock(lock, w.who, w.studioSite, w.owner)) }, 200, cors);
}

export async function handlePublishLockPut(req: Request, jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  let b: { on?: unknown; words?: unknown } = {};
  try { b = await req.json(); } catch { /* answered below */ }
  if (typeof b.on !== 'boolean') return json({ error: 'bad_request', message: 'Say on: true or false.' }, 400, cors);
  let lock: PublishLock | null;
  try { lock = await readLock(site.id); } catch { return unreadable(cors); }
  const w = await whoAsks(jwt, site, principal);
  if (!mayChangeLock(lock, w.who, w.studioSite, w.owner)) {
    const studios = lock && lock.on && lock.by_kind !== 'client';
    return json({ error: 'forbidden', message: studios ? 'Your studio locked publishing. Ask them to unlock it.' : 'Your studio looks after publishing locks for this site.' }, 403, cors);
  }
  const now = new Date().toISOString();
  // A lock that stays on keeps when it was set and who set it; only its words change.
  const next: PublishLock = b.on
    ? { on: true, at: lock && lock.on ? lock.at : now, by_kind: lock && lock.on ? lock.by_kind : w.who, words: b.words === undefined && lock && lock.on ? lock.words : lockWords(b.words) }
    : { on: false, at: now, by_kind: w.who, words: '' };
  if (!(await writeReservedJson(site.id, RESERVED_NAMES.publishLock, next, principal.email || principal.userId || 'studio'))) {
    return json({ error: 'write_failed', message: 'That didn’t save. Publishing is as it was.' }, 502, cors);
  }
  const was = !!(lock && lock.on);
  if (was !== next.on || (next.on && (lock?.words || '') !== next.words)) {
    await writeChangeEvent({ siteId: site.id, entityType: 'site', entityId: null, action: 'update', summary: next.on ? (was ? 'Changed the note on the publishing lock' : 'Locked publishing') + (next.words ? `: “${next.words}”` : '') : 'Unlocked publishing', principal, provenance: 'human' }).catch(() => {});
  }
  return json({ data: shape(next, mayChangeLock(next, w.who, w.studioSite, w.owner)) }, 200, cors);
}
