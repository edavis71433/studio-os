// ── Per-thread read marks (Inbox split view, slice 2 · migration 0113) ───────
// Real per-conversation unread dots for the studio Inbox: one row per
// (site, reader, thread) in presence_thread_reads recording when the reader
// last opened that thread. reader = the same text key presence_activity_reads
// uses (auth user id or email — see readerKey in routes/project_comms.ts).
// thread_key is a UUID-free opaque key, so it is ALLOWLISTED here:
//   client:<client-or-project id>   the per-client message conversation
//   support:<request id>            one support thread
//   lead:<submission id>            one website enquiry
// The pure half (key validation + the unread rule) lives up top so it can be
// unit-tested in isolation (tests/presence/thread_reads_test.mjs); the impure
// half (load marks / upsert a mark) is deploy-order-tolerant — a database
// without 0113 yet degrades to null/false and the caller falls back to the old
// needs-reply heuristic. Never a second store: the marks are read cursors only.
import { svc } from './db.ts';

// ═══ PURE ═════════════════════════════════════════════════════════════════════

export const THREAD_KEY_MAX = 80;
export const THREAD_KEY_PREFIXES = ['client:', 'support:', 'lead:'] as const;
// after the allowlisted prefix: a bounded id-ish suffix (uuids, emails, plain ids)
const THREAD_KEY_RE = /^(client|support|lead):[A-Za-z0-9@._+-]{1,72}$/;

/** Validate + normalize an inbound thread key (deny-by-default: control-char
 *  strip → trim → length cap → allowlisted prefix + bounded charset). Returns
 *  the clean key, or null when it isn't a thread key at all. */
export function cleanThreadKey(raw: unknown): string | null {
  const s = String(raw ?? '').replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (!s || s.length > THREAD_KEY_MAX) return null;
  return THREAD_KEY_RE.test(s) ? s : null;
}

/** The unread rule (spec §2.4): a thread is unread when the latest CLIENT
 *  activity is newer than the reader's mark for that key.
 *  - mark == null/undefined → no mark to compare against (table missing, or the
 *    reader never opened this thread) → fall back to the caller's existing
 *    needs-reply heuristic, so pre-0113 behaviour is exactly today's.
 *  - with a mark: strictly newer client activity → unread. */
export function threadUnread(latestClientAt: string | null | undefined, mark: string | null | undefined, heuristic: boolean): boolean {
  if (mark == null || mark === '') return heuristic;
  if (!latestClientAt) return false;
  return String(latestClientAt) > String(mark);
}

/** The newest CLIENT-authored support message per request, reduced from ONE
 *  batched presence_support_messages read. Both message doors write
 *  author_kind = principal.kind (handleClientSupportMessage in
 *  client_delivery.ts and handleSupportMessage in service_intake.ts), so the
 *  client side is author_kind 'client'/'customer' — the same isClientKind rule
 *  crm.ts and the support pane render with. Rows may arrive in any order
 *  (explicit max, tie-stable: an equal timestamp never flips the result).
 *  Feeds the support rows' unread input in /portal/feed: their updated_at moves
 *  on STUDIO actions too (triage PATCH, the open→in_progress bump on reply), so
 *  it can't stand in for client activity. Pure so it's unit-testable. */
export function newestClientMessageAt(rows: Array<{ request_id?: unknown; author_kind?: unknown; created_at?: unknown }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of rows || []) {
    if (!m || (m.author_kind !== 'client' && m.author_kind !== 'customer')) continue;
    const id = String(m.request_id || ''); const at = String(m.created_at || '');
    if (!id || !at) continue;
    if (out[id] === undefined || at > out[id]) out[id] = at;
  }
  return out;
}

// ═══ IMPURE (deploy-order-tolerant) ═══════════════════════════════════════════

/** All of one reader's marks for a site, as { thread_key → last-seen ISO }.
 *  Returns NULL when the table can't be read (pre-0113 database, hiccup) so the
 *  caller's threadUnread(..) falls back to its heuristic — never fails a feed. */
export async function loadThreadMarks(siteId: string, reader: string): Promise<Record<string, string> | null> {
  try {
    // order=last_seen_at.desc: past the 500-row cap PostgREST would otherwise
    // return an ARBITRARY subset — read threads would flip back nondeterministically.
    // Newest marks win (first row per key kept), so truncation only ever sheds the
    // oldest marks — those threads fall back to the heuristic, deterministically.
    const r = await svc(`presence_thread_reads?site_id=eq.${siteId}&reader=eq.${encodeURIComponent(reader)}&select=thread_key,last_seen_at&order=last_seen_at.desc&limit=500`);
    if (!r.ok || !Array.isArray(r.json)) return null;
    const out: Record<string, string> = {};
    for (const row of r.json as any[]) { if (row && row.thread_key && out[String(row.thread_key)] === undefined) out[String(row.thread_key)] = String(row.last_seen_at || ''); }
    return out;
  } catch { return null; }
}

/** Upsert the reader's mark for one thread to now. Best-effort: false on any
 *  failure (incl. a database without 0113 yet) — the route still answers 200.
 *  Only the DOCUMENTED pre-0113 case (missing relation, 42P01) stays silent;
 *  any other write failure is logged so a broken mark store is observable. */
export async function markThreadRead(siteId: string, reader: string, threadKey: string): Promise<boolean> {
  try {
    const up = await svc('presence_thread_reads?on_conflict=site_id,reader,thread_key', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ site_id: siteId, reader, thread_key: threadKey, last_seen_at: new Date().toISOString() }),
    });
    if (!up.ok) {
      const code = String((up.json as any)?.code || '');
      const msg = String((up.json as any)?.message || up.text || '');
      const preMigration = code === '42P01' || msg.includes('presence_thread_reads');
      if (!preMigration) console.error(`[thread_reads] mark upsert failed (${up.status}) for ${threadKey}: ${msg.slice(0, 200)}`);
    }
    return up.ok;
  } catch (e) {
    console.error(`[thread_reads] mark upsert threw for ${threadKey}: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}
