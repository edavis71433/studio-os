// ── Surveys & Support — pure logic (Presence CMS Phase 2, P2-D-4) ────────────
// Survey question/answer normalization + the support status ladder. Pure (no DB,
// no network) so the intake rules are deterministic + unit-testable. This is a
// SMALL, fixed survey (stable questions + one submission) — not a form builder.

// ── surveys ──
export type SurveyStatus = 'draft' | 'active' | 'closed';
export const SURVEY_STATUSES: SurveyStatus[] = ['draft', 'active', 'closed'];
export function isSurveyStatus(s: unknown): s is SurveyStatus {
  return typeof s === 'string' && (SURVEY_STATUSES as string[]).includes(s);
}
export interface Question { key: string; label: string; type: 'text' | 'rating' | 'choice'; choices?: string[]; }
/** Validate + normalize a STABLE question set (max 30). Keys are unique + slugged. Pure. */
export function normalizeQuestions(raw: unknown): { ok: true; questions: Question[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: 'A survey needs at least one question.' };
  if (raw.length > 30) return { ok: false, error: 'A survey can have at most 30 questions.' };
  const out: Question[] = []; const seen = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i] as any;
    const label = String(r?.label || '').trim().slice(0, 300);
    if (!label) return { ok: false, error: `Question ${i + 1} needs a label.` };
    const type = (r?.type === 'rating' || r?.type === 'choice') ? r.type : 'text';
    let key = String(r?.key || label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || `q${i + 1}`;
    while (seen.has(key)) key = `${key}_${i}`;
    seen.add(key);
    const q: Question = { key, label, type };
    if (type === 'choice') { const choices = Array.isArray(r?.choices) ? r.choices.map((c: unknown) => String(c).slice(0, 120)).filter(Boolean).slice(0, 20) : []; if (!choices.length) return { ok: false, error: `Question “${label}” needs choices.` }; q.choices = choices; }
    out.push(q);
  }
  return { ok: true, questions: out };
}
/** Answers are a { key: value } map restricted to the survey's question keys. Pure. */
export function normalizeAnswers(raw: unknown, questions: Question[]): { ok: true; answers: Record<string, string> } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Answers must be provided.' };
  const keys = new Set(questions.map((q) => q.key));
  const answers: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!keys.has(k)) continue;                                     // ignore stray keys (stable schema)
    answers[k] = String(v ?? '').slice(0, 2000);
  }
  if (!Object.keys(answers).length) return { ok: false, error: 'Please answer at least one question.' };
  return { ok: true, answers };
}

// ── support ──
export type SupportStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export const SUPPORT_STATUSES: SupportStatus[] = ['open', 'in_progress', 'resolved', 'closed'];
const SUPPORT_NEXT: Record<SupportStatus, SupportStatus[]> = {
  open: ['in_progress', 'resolved', 'closed'],
  in_progress: ['open', 'resolved', 'closed'],
  resolved: ['open', 'closed'],       // reopen or close
  closed: ['open'],                   // reopen
};
export function isSupportStatus(s: unknown): s is SupportStatus {
  return typeof s === 'string' && (SUPPORT_STATUSES as string[]).includes(s);
}
export function canSupportTransition(from: SupportStatus, to: SupportStatus): boolean {
  if (from === to) return false;
  return (SUPPORT_NEXT[from] || []).includes(to);
}
export type SupportPriority = 'low' | 'normal' | 'high' | 'urgent';
export function isSupportPriority(p: unknown): p is SupportPriority {
  return p === 'low' || p === 'normal' || p === 'high' || p === 'urgent';
}

// ── service requests (R2) — a client picks one of the studio's OFFERINGS and
// submits a structured brief. There is NO auto-charge and NO paid order: this
// composes a clean, plain-text summary that is folded into the ONE support-
// request spine (presence_support_requests has no jsonb column), which the
// studio confirms + quotes by hand. Pure so the caps + formatting are
// deterministic and unit-testable. No HTML, no markup — labelled plain lines. ──
export interface ServiceBrief { need?: unknown; timeline?: unknown; budget?: unknown; }
const briefLine = (s: unknown, max: number) =>
  String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
/** Build the plain-text body for a service request. `serviceName` (optional)
 *  names the picked offering; the brief fields are the standard R2 questions
 *  ("What do you need?" / "Ideal timeline" / "Budget range"). `note` is any extra
 *  free text. Returns a labelled, plain-text block (max 5000 chars). Pure. */
export function composeServiceBrief(serviceName: unknown, brief: ServiceBrief | null | undefined, note?: unknown): string {
  const b = brief || {};
  const name = briefLine(serviceName, 120);
  const need = briefLine(b.need, 2000);
  const timeline = briefLine(b.timeline, 200);
  const budget = briefLine(b.budget, 200);
  const extra = briefLine(note, 2000);
  const lines: string[] = [];
  if (name) lines.push(`Service requested: ${name}`);
  if (need) lines.push(`What they need: ${need}`);
  if (timeline) lines.push(`Ideal timeline: ${timeline}`);
  if (budget) lines.push(`Budget range: ${budget}`);
  if (extra) lines.push(`More detail: ${extra}`);
  return lines.join('\n').slice(0, 5000);
}

// ── support aging (service edge #3 — nudge the OWNER, never the customer) ──────
export const SUPPORT_AGING_DAYS = 2;         // quiet at least this long → one owner nudge
export const SUPPORT_AGING_MAX_DAYS = 30;    // …but a truly ancient ticket isn't nagged
/** Is an open/in_progress request "aging" — untouched at least N days but younger
 *  than the max window? Pure over an ISO `now` + the request's updated_at, so the
 *  threshold is deterministic in tests and guards the sweep's SQL window. */
export function supportAgingDue(req: { status?: string; updated_at?: string | null }, nowIso: string, days = SUPPORT_AGING_DAYS): boolean {
  if (req.status !== 'open' && req.status !== 'in_progress') return false;
  const upd = req.updated_at ? Date.parse(String(req.updated_at)) : NaN;
  const now = Date.parse(nowIso);
  if (!Number.isFinite(upd) || !Number.isFinite(now)) return false;
  const ageDays = (now - upd) / 86400_000;
  return ageDays >= days && ageDays < SUPPORT_AGING_MAX_DAYS;
}

/** The dedupe `period` for a support-aging nudge — a WEEKLY bucket, not a
 *  once-ever key.
 *
 *  The old key was `support:<id>`, so the very first nudge muted the request
 *  forever: a genuinely stalled ticket went silent while it was still waiting on
 *  the owner. A 7-day bucket keeps the nudge send-once *within* a week (no
 *  storm — the sweep runs every 15 minutes) but lets a still-open request speak
 *  up again the following week.
 *
 *  The bucket is `floor(now / 7d)` — deterministic, clock-free in tests, and
 *  independent of timezone or locale (slots turn over Thursday 00:00 UTC, since
 *  the epoch is a Thursday; which weekday it lands on doesn't matter, only that
 *  it is stable and exactly 7 days wide). Every bucket shares the
 *  `support:<id>:` prefix, which is what the resolve/close teardown clears. */
const SUPPORT_AGING_BUCKET_MS = 7 * 86400_000;
export function supportAgingPeriodPrefix(requestId: string): string {
  return `support:${requestId}:`;
}
export function supportAgingPeriod(requestId: string, nowMs: number): string {
  const w = Number.isFinite(nowMs) ? Math.floor(nowMs / SUPPORT_AGING_BUCKET_MS) : 0;
  return `${supportAgingPeriodPrefix(requestId)}w${w}`;
}
