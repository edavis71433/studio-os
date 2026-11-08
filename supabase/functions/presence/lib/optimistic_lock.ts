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
import { svc } from './db.ts';
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

/** Wave-1 G7: what the client can honestly say about WHO moved the draft — the
 *  most recent provenance event (summary + actor kind + when). Never a name the
 *  system doesn't already record; provenance is the one actor ledger we have. */
export interface LastChangeInfo { summary: string; actor_kind: string; at: string }

/** The 409 conflict payload — carries the CURRENT hash so the client can refresh
 *  and reapply, plus (when known) who last changed the draft. Pure. */
export function staleConflictBody(currentHash: string | null, lastChange?: LastChangeInfo | null) {
  return {
    error: 'stale_draft',
    message: 'This site changed since you opened it — refresh to load the latest, then reapply your change so nothing is overwritten.',
    current_hash: currentHash,
    ...(lastChange ? { last_change: lastChange } : {}),
  };
}

/** Guard a draft-mutating request. Returns a 409 Response when the caller's
 *  `If-Match` no longer matches the current draft, otherwise null (proceed).
 *  Serializes the draft ONCE, and only when the caller opted in (sent If-Match).
 *  The 409 also carries the current hash as an `ETag`. */
export async function guardStaleDraft(req: Request, site: SiteRow, cors: Record<string, string>): Promise<Response | null> {
  const ifMatch = readIfMatch(req);
  if (ifMatch === null || ifMatch === '' || ifMatch === '*') return null; // opt-in / wildcard → unchanged behavior
  const current = await draftVersionBefore(req, site);
  if (preconditionOutcome(ifMatch, current) === 'stale') {
    // Wave-1 G7 "someone else is editing": surface WHO last moved the draft — the
    // newest provenance event, read only on this (rare) conflict path. Best-effort:
    // the 409 is complete without it.
    let last: LastChangeInfo | null = null;
    try {
      const r = await svc(`presence_change_events?site_id=eq.${site.id}&select=summary,actor_kind,created_at&order=created_at.desc&limit=1`);
      const row = Array.isArray(r.json) ? r.json[0] : null;
      if (row) last = { summary: String(row.summary || ''), actor_kind: String(row.actor_kind || ''), at: String(row.created_at || '') };
    } catch { /* best-effort */ }
    return json(staleConflictBody(current, last), 409, { ...cors, ...(current ? { ETag: `"${current}"` } : {}) });
  }
  return null;
}

// ── The version a write leaves (Nov 2026) ────────────────────────────────────
// A page names the version it has loaded on each write. Once its own write lands the
// draft has moved on, and the page used to learn where to from a /changes read a second
// later. That read also carried anyone else's change from that second, which the page had
// never loaded, so its next write wasn't checked against it: a /settings write carries
// whole columns, and put the other person's change back. Now the answer to each write
// that moves the draft names the version that write left, decided here, where the draft
// was looked at before the write:
//   · the draft was where the caller said → the version after this write;
//   · it had moved on without the caller (only on a route the guard doesn't refuse) → the
//     caller's own version back, so its next checked write is refused instead of let
//     through over a change it never loaded.
// Nothing for a write that named no version, failed, or doesn't move the draft. The draft
// can still move between the write and the hash after it, as it can between the guard's
// check and the write; both are this function's own few milliseconds.

/** The routes whose writes move the draft version. The same list as the page's
 *  DRAFT_WRITE (presence.html), which sends these one at a time; optimistic_lock_test
 *  keeps the two in step. */
export const DRAFT_WRITE = /^\/(?:settings|identity|location|offerings|testimonials|faqs|posts|pages\/duplicate|media|stock\/import|redirects|site\/template|content-library|dev\/customization|dev\/brand-kit|restore-to-draft)(?:[/?]|$)|^\/reviews\/[^/]+\/|^\/publishes\/checkpoints\/[^/]+\/restore$|^\/writer\/drafts\/[^/]+\/accept$/;

/** Does this request write the draft? Pure. */
export function movesDraft(method: string, route: string): boolean {
  return method.toUpperCase() !== 'GET' && DRAFT_WRITE.test(route);
}

/** The answer header naming the version a write left. */
export const DRAFT_VERSION_HEADER = 'X-Draft-Version';

// One hash of the draft as the request found it, shared by the guard and the answer.
const BEFORE = new WeakMap<Request, { site: SiteRow; hash: Promise<string | null> }>();

/** The draft's version before this request wrote, hashed once per request. */
export function draftVersionBefore(req: Request, site: SiteRow, hashFor: (s: SiteRow) => Promise<string | null> = draftHashForSite): Promise<string | null> {
  let b = BEFORE.get(req);
  if (!b) { b = { site, hash: hashFor(site) }; BEFORE.set(req, b); }
  return b.hash;
}

/** Before a write that moves the draft and names a version: look at the draft first.
 *  A route the guard covers reuses this hash; on any other, an error here only means
 *  the answer won't name a version. */
export async function noteDraftBefore(req: Request, route: string, site: SiteRow, hashFor?: (s: SiteRow) => Promise<string | null>): Promise<void> {
  if (!movesDraft(req.method, route)) return;
  const named = readIfMatch(req);
  if (named === null || named === '' || named === '*') return;
  try { await draftVersionBefore(req, site, hashFor); } catch { /* the write goes ahead, unnamed */ }
}

/** Name the version a successful write left (see above). Returns the response as it
 *  was when there is nothing to name. */
export async function withDraftVersion(req: Request, resp: Response, hashFor: (s: SiteRow) => Promise<string | null> = draftHashForSite): Promise<Response> {
  const b = BEFORE.get(req);
  if (!b || !resp.ok) return resp;
  const named = readIfMatch(req);
  if (named === null || named === '' || named === '*') return resp;
  let version: string | null = null;
  try {
    const before = await b.hash;
    if (before === null) return resp;
    version = before === named ? await hashFor(b.site) : named;
  } catch { return resp; }
  if (!version) return resp;
  const headers = new Headers(resp.headers);
  headers.set(DRAFT_VERSION_HEADER, version);
  headers.set('Access-Control-Expose-Headers', DRAFT_VERSION_HEADER);   // a cross-origin page can't read it otherwise
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers });
}
