// ── Concierge notes (reconciliation §4) — the suggestion seam ────────────────
// Rules today; AI (M9), humans, and cross-product sources later — one grammar:
// a title (question or statement), one honest reason, exactly one action,
// dismiss means gone. Outcomes are recorded; they ARE the memory substrate.
// Max three active notes are ever shown; caution outranks suggestion outranks
// celebration. Rules are deterministic and deduped so a dismissed note never
// nags again unless the facts themselves change (a new dedupe key).
import { svc } from './db.ts';

export interface NoteRow {
  id: string; source: string; kind: 'suggestion' | 'caution' | 'celebration';
  title: string; reason: string; action: { label?: string; section?: string; entity_id?: string };
  status: string; created_at: string;
}

export interface NoteContext {
  hostingProblem: boolean;
  everPublished: boolean;
  lastPublishedAt: string | null;
  lastPublishFailed: boolean;
  draftChanges: number;
  oldestDraftChangeAt: string | null;
  nowIso: string;
}

const DAY = 24 * 60 * 60 * 1000;
const daysBetween = (a: string, b: string) => Math.floor((new Date(a).getTime() - new Date(b).getTime()) / DAY);
const isoWeek = (iso: string): string => {
  const d = new Date(iso); const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return `${d.getUTCFullYear()}w${Math.ceil(((d.getTime() - start.getTime()) / DAY + 1) / 7)}`;
};
const quarter = (iso: string): string => { const d = new Date(iso); return `${d.getUTCFullYear()}q${Math.floor(d.getUTCMonth() / 3) + 1}`; };

interface Candidate { kind: NoteRow['kind']; title: string; reason: string; action: NoteRow['action']; dedupe: string }

function ruleCandidates(ctx: NoteContext): Candidate[] {
  const out: Candidate[] = [];
  if (ctx.hostingProblem) {
    out.push({
      kind: 'caution', dedupe: 'hosting-issue',
      title: 'Your website hosting needs attention.',
      reason: 'Your concierge has been notified and is on it — your live site keeps serving.',
      action: {},
    });
  }
  if (ctx.lastPublishFailed) {
    out.push({
      kind: 'caution', dedupe: `publish-failed-${isoWeek(ctx.nowIso)}`,
      title: 'Your last publish didn’t go through.',
      reason: 'Your live site is unchanged and nothing was lost.',
      action: { label: 'Try again', section: 'publish' },
    });
  }
  if (ctx.draftChanges > 0 && ctx.oldestDraftChangeAt && daysBetween(ctx.nowIso, ctx.oldestDraftChangeAt) >= 14) {
    out.push({
      kind: 'suggestion', dedupe: `draft-idle-${isoWeek(ctx.oldestDraftChangeAt)}`,
      title: `${ctx.draftChanges} change${ctx.draftChanges > 1 ? 's are' : ' is'} waiting to publish.`,
      reason: 'They’ve been ready for a couple of weeks — customers only see published changes.',
      action: { label: 'Review & publish', section: 'publish' },
    });
  }
  if (ctx.everPublished && ctx.lastPublishedAt && daysBetween(ctx.nowIso, ctx.lastPublishedAt) >= 90 && ctx.draftChanges === 0) {
    out.push({
      kind: 'suggestion', dedupe: `freshness-${quarter(ctx.nowIso)}`,
      title: 'Worth a minute to confirm hours and menu are current?',
      reason: `It’s been ${Math.floor(daysBetween(ctx.nowIso, ctx.lastPublishedAt) / 30)} months since your last publish.`,
      action: { label: 'Check business info', section: 'business' },
    });
  }
  if (ctx.everPublished && ctx.lastPublishedAt && daysBetween(ctx.nowIso, ctx.lastPublishedAt) <= 2) {
    out.push({
      kind: 'celebration', dedupe: 'first-publish',
      title: 'Your website is live.',
      reason: 'Every fact on it came from you — keep it accurate and it keeps working.',
      action: { label: 'See it live', section: 'preview' },
    });
  }
  return out;
}

/** Idempotently materialize rule notes (dedupe honors prior dismissals), then
 *  return the ≤3 active notes to show, caution-first. */
export async function ensureAndListNotes(siteId: string, ctx: NoteContext): Promise<NoteRow[]> {
  for (const c of ruleCandidates(ctx)) {
    // unique partial index (site,dedupe status in active|dismissed) makes this race-safe:
    // a dismissed note with the same key blocks re-creation — dismiss means gone.
    await svc('presence_notes', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ site_id: siteId, source: 'rule', kind: c.kind, title: c.title, reason: c.reason, action: c.action, dedupe_key: c.dedupe }),
    }); // 409 on dedupe conflict is expected and fine
  }
  // resolve cautions whose condition cleared (hosting recovered)
  if (!ctx.hostingProblem) {
    await svc(`presence_notes?site_id=eq.${siteId}&dedupe_key=eq.hosting-issue&status=eq.active`, {
      method: 'PATCH', body: JSON.stringify({ status: 'expired', resolved_at: ctx.nowIso }),
    });
  }
  const r = await svc(`presence_notes?site_id=eq.${siteId}&status=eq.active&select=id,source,kind,title,reason,action,status,created_at&order=created_at.desc&limit=12`);
  const rows: NoteRow[] = Array.isArray(r.json) ? r.json : [];
  const rank = { caution: 0, suggestion: 1, celebration: 2 } as Record<string, number>;
  return rows.sort((a, b) => (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9) || b.created_at.localeCompare(a.created_at)).slice(0, 3);
}

/** Record an outcome — accepted or dismissed. This is the memory substrate. */
export async function resolveNote(siteId: string, noteId: string, outcome: 'accepted' | 'dismissed'): Promise<boolean> {
  const r = await svc(`presence_notes?id=eq.${encodeURIComponent(noteId)}&site_id=eq.${siteId}&status=eq.active`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: outcome, resolved_at: new Date().toISOString() }),
  });
  return r.ok && Array.isArray(r.json) && r.json.length > 0;
}
