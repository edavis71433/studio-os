// ── Client-facing Business Moments routes (M9.3) ────────────────────────────
//   GET  /moments               — the ≤3 active moments, customer-safe fields ONLY
//   POST /moments/:id/dismiss   — dismissal is memory (mirrors notes semantics)
// The customer never sees importance, priority, rules, or recommendation
// internals — clientView() is the only shape that leaves this module.
// No generation happens here: moments are produced by the engine
// (operator/system-triggered), read calmly by the room.
import { json } from '../../_shared/http.ts';
import { asUser } from '../lib/db.ts';
import { clientView } from '../moments/contract.ts';
import { dismissMoment } from '../moments/engine.ts';
import type { SiteRow } from '../lib/site.ts';

export async function handleMomentsList(jwt: string, site: SiteRow, cors: Record<string, string>) {
  // caller-JWT read: RLS proves ownership (clients have SELECT on their own moments)
  const r = await asUser(jwt, `presence_moments?site_id=eq.${site.id}&status=eq.active&select=id,moment_type,headline,summary,tone,dismissable,importance,created_at,expires_at&order=importance.desc,moment_key.asc&limit=3`);
  if (!r.ok) return json({ error: 'read_failed', message: 'We couldn’t open today’s notes just now — nothing is lost.' }, 502, cors);
  const rows = (r.json ?? []).filter((m: { expires_at: string }) => new Date(m.expires_at) > new Date());
  return json({ data: rows.map(clientView) }, 200, cors);
}

export async function handleMomentDismiss(site: SiteRow, momentId: string, cors: Record<string, string>) {
  const res = await dismissMoment(site.id, momentId);
  if (!res.ok) return json({ error: 'not_found', message: 'That note is gone already.' }, 404, cors);
  return json({ data: { ok: true } }, 200, cors);
}
