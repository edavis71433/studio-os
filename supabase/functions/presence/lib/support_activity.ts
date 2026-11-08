// ── A support request's real activity (client portal walk, Nov 8 2026) ──────
// presence_support_requests carries a touch trigger: updated_at moves on EVERY
// write — a one-time link to its customer (healSupportOwners), a priority or
// assignee change. Shown as "updated", those made three July requests read
// "3 hours ago" and light the client's bell. Activity is what people did: the
// request was opened, someone wrote in it, it was resolved. Pure.

export interface SupportMsg { request_id?: unknown; author?: unknown; body?: unknown; created_at?: unknown }
export interface NewestMsg { at: string; body: string; mine: boolean; studioAt: string }

/** Per request: its newest message (and whether the person who opened the request
 *  wrote it), and its newest message by anyone else — the studio. The writer is
 *  compared with the request's requester because author_kind can't tell them
 *  apart: both doors stamp principal.kind, which is 'client' for a studio owner too. */
export function newestPerRequest(msgs: SupportMsg[], requesterOf: Record<string, string>): Record<string, NewestMsg> {
  const out: Record<string, NewestMsg> = {};
  for (const m of msgs || []) {
    const id = String(m?.request_id || ''); const at = String(m?.created_at || '');
    if (!id || !at) continue;
    const mine = requesterOf[id] !== undefined && String(m.author || '') === String(requesterOf[id]);
    const cur = out[id] || { at: '', body: '', mine: false, studioAt: '' };
    if (at > cur.at) { cur.at = at; cur.body = String(m.body || ''); cur.mine = mine; }
    if (!mine && at > cur.studioAt) cur.studioAt = at;
    out[id] = cur;
  }
  return out;
}

/** When something last happened: opened, written in, or resolved — never a bookkeeping write. */
export function supportActivityAt(req: { created_at?: unknown; resolved_at?: unknown } | null | undefined, newestMessageAt?: string | null): string {
  const c = [String(req?.created_at || ''), String(newestMessageAt || ''), String(req?.resolved_at || '')].filter(Boolean).sort();
  return c.length ? c[c.length - 1] : '';
}

/** What a client should hear about on their bell: the studio's newest reply, or
 *  the request being resolved — whichever is later. Their own filing is not news. */
export function clientSupportNews(req: { subject?: unknown; status?: unknown; resolved_at?: unknown } | null | undefined, studioReplyAt?: string | null): { at: string; label: string } | null {
  const subj = String(req?.subject || 'your request').trim().slice(0, 60) || 'your request';
  const res = (req?.status === 'resolved' || req?.status === 'closed') ? String(req?.resolved_at || '') : '';
  const rep = String(studioReplyAt || '');
  if (!res && !rep) return null;
  return res > rep ? { at: res, label: `Resolved: ${subj}` } : { at: rep, label: `Your studio replied: ${subj}` };
}

/** One line for a conversation list: the newest message, said as who wrote it. */
export function lastLine(n: NewestMsg | undefined): { from: 'you' | 'studio'; text: string } | null {
  if (!n || !n.body.trim()) return null;
  const t = n.body.replace(/\s+/g, ' ').trim();
  return { from: n.mine ? 'you' : 'studio', text: t.length > 120 ? t.slice(0, 119) + '…' : t };
}
