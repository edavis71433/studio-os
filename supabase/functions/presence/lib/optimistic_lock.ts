// ── Optimistic locking (Presence CMS Phase 1, M9) ────────────────────────────
// Prevents two editors from silently clobbering each other, reusing the M3
// canonical draft hash as the version token — NO second versioning system, no
// new column. The client loads the draft (GET /site or /changes → `draft_hash`)
// and echoes it back on a write via the standard HTTP `If-Match` header; if the
// draft has moved on since, the write is refused with a clear 409 so the newer
// edit is never overwritten.
//
// OPT-IN + backward-compatible: a request with no `If-Match` behaves exactly as
// before. `If-Match: *` is the HTTP "any current version" wildcard → proceed.

import { json } from '../../_shared/http.ts';
import { draftHashForSite } from './draft_hash.ts';
import type { SiteRow } from './site.ts';

/** Read + normalize the `If-Match` precondition. Strips a weak-validator `W/`
 *  prefix and surrounding quotes. Returns null when absent (→ no precondition).
 *  Pure. */
export function readIfMatch(req: Request): string | null {
  const raw = req.headers.get('If-Match');
  if (raw === null) return null;
  const v = raw.trim().replace(/^W\//i, '').replace(/^"|"$/g, '').trim();
  return v; // '' or '*' handled by preconditionOutcome
}

export type PreconditionOutcome = 'skip' | 'match' | 'stale';

/** Decide the precondition outcome. Pure. `skip` = no check (absent / wildcard /
 *  hash uncomputable → fail-open, never block a legitimate save on our inability
 *  to hash). `match` = safe to proceed. `stale` = the draft changed → refuse. */
export function preconditionOutcome(ifMatch: string | null, currentHash: string | null): PreconditionOutcome {
  if (ifMatch === null || ifMatch === '' || ifMatch === '*') return 'skip';
  if (currentHash === null) return 'skip';
  return ifMatch === currentHash ? 'match' : 'stale';
}

/** The 409 conflict payload — carries the CURRENT hash so the client can refresh
 *  and reapply. Pure. */
export function staleConflictBody(currentHash: string | null) {
  return {
    error: 'stale_draft',
    message: 'This site changed since you opened it — refresh to load the latest, then reapply your change so nothing is overwritten.',
    current_hash: currentHash,
  };
}

/** Guard a draft-mutating request. Returns a 409 Response when the caller's
 *  `If-Match` no longer matches the current draft, otherwise null (proceed).
 *  Serializes the draft ONCE, and only when the caller opted in (sent If-Match).
 *  The 409 also carries the current hash as an `ETag`. */
export async function guardStaleDraft(req: Request, site: SiteRow, cors: Record<string, string>): Promise<Response | null> {
  const ifMatch = readIfMatch(req);
  if (ifMatch === null || ifMatch === '' || ifMatch === '*') return null; // opt-in / wildcard → unchanged behavior
  const current = await draftHashForSite(site);
  if (preconditionOutcome(ifMatch, current) === 'stale') {
    return json(staleConflictBody(current), 409, { ...cors, ...(current ? { ETag: `"${current}"` } : {}) });
  }
  return null;
}
