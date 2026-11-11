// ── One "do next" list per client (builder list item 184, Nov 2026) ──────────────
// Semrush's Growth Actions is a short daily list for one business with Done and
// Not relevant. Ours joins what already knows about one client into one list, in
// order: Needs you (the studio's own work for them), the health check's problems,
// Search's top tasks, reviews waiting, the AI answers that miss them, and the Growth
// Coach's ideas. Most items tick themselves: they leave the list when the thing is
// done (the enquiry answered, the page fixed). "Done" puts one away for 30 days
// (back if it is still true then); "Not relevant" puts it away for good. Decisions
// are kept on the client's site (reserved JSON `__do_next__`). Pure.
import { TYPE_TITLES, HEADINGS, headingOf } from './health_score.ts';

export const DO_NEXT_SHOWN = 8;
export const DONE_HIDES_DAYS = 30;
export const DECISIONS_KEPT = 300;

export type DoNextSource = 'needs' | 'health' | 'search' | 'reviews' | 'ai' | 'idea';
export interface DoNextItem { key: string; source: DoNextSource; title: string; sub: string; verb: string; href: string }
export interface Decision { state: 'done' | 'not_relevant'; at: string; by: string | null; title: string }

/** The stored decisions, cleaned and capped (newest kept). Pure. */
export function normalizeDecisions(raw: unknown): { decided: Record<string, Decision> } {
  const src = (raw && typeof raw === 'object' && (raw as { decided?: unknown }).decided && typeof (raw as { decided: unknown }).decided === 'object') ? (raw as { decided: Record<string, any> }).decided : {};
  const rows = Object.entries(src)
    .filter(([k, v]) => /^[a-z_]+:[\w:./@-]{1,200}$/i.test(k) && v && (v.state === 'done' || v.state === 'not_relevant') && typeof v.at === 'string')
    .map(([k, v]) => [k, { state: v.state, at: String(v.at), by: v.by ? String(v.by) : null, title: String(v.title || '').slice(0, 200) }] as const)
    .sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, DECISIONS_KEPT);
  return { decided: Object.fromEntries(rows) };
}

/** One decision applied: done, not relevant, or undone. Pure. */
export function applyDecision(cur: { decided: Record<string, Decision> }, key: string, decision: unknown, title: string, who: string | null, nowIso: string): { decided: Record<string, Decision> } | { error: string } {
  if (!/^[a-z_]+:[\w:./@-]{1,200}$/i.test(key)) return { error: 'That item can’t be marked.' };
  const decided = { ...cur.decided };
  if (decision === 'undo') { delete decided[key]; return { decided }; }
  if (decision !== 'done' && decision !== 'not_relevant') return { error: 'Say done, not relevant, or undo.' };
  decided[key] = { state: decision, at: nowIso, by: who, title: String(title || '').slice(0, 200) };
  return normalizeDecisions({ decided });
}

/** Is a decision still keeping its item off the list? Not relevant always; done for 30 days. Pure. */
export function stillDecided(d: Decision | undefined, nowIso: string): boolean {
  if (!d) return false;
  if (d.state === 'not_relevant') return true;
  return Date.parse(nowIso) - Date.parse(d.at) < DONE_HIDES_DAYS * 86_400_000;
}

export interface DoNextFacts {
  siteId: string;
  needs: Array<{ key: string; what: string; when: string; verb: string; href: string }>;
  health: Array<{ type: string; severity: string; n: number }> | null;
  search: Array<{ key: string; priority: string; done: boolean; title: string; sub: string; go: string | null }> | null;
  reviews: { googleUnreplied: number; pending: number } | null;
  ai: { results: Array<{ q: string; kind: string; answers: Array<{ named: boolean | null }> }> } | null;
  ideas: Array<{ id: string; opportunity: string; suggested_next_step: string; timing_phrase?: string | null }>;
}

const qkey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

/** The list, in order, with what was decided this month. Pure. */
export function composeDoNext(f: DoNextFacts, decisions: { decided: Record<string, Decision> }, nowIso: string): { items: DoNextItem[]; more: number; decided: Array<{ key: string; title: string; state: Decision['state']; at: string }> } {
  const ws = `/presence.html?client=${f.siteId}`;
  const all: DoNextItem[] = [];
  const add = (it: DoNextItem) => { if (!all.some((x) => x.key === it.key)) all.push(it); };
  for (const n of f.needs) add({ key: n.key, source: 'needs', title: n.what, sub: n.when, verb: n.verb || 'Open', href: n.href });
  const healthTypes = new Set<string>();
  for (const h of (f.health || []).slice().sort((a, b) => (a.severity === b.severity ? b.n - a.n : a.severity === 'critical' ? -1 : 1)).slice(0, 3)) {
    healthTypes.add(h.type);
    add({ key: `health:${h.type}`, source: 'health', title: TYPE_TITLES[h.type] || 'Something to look at on the site', sub: `${HEADINGS.find((x) => x.key === headingOf(h.type))?.title || 'Website health'}${h.n > 1 ? ` · ${h.n} places` : ''}`, verb: 'Fix', href: `${ws}#health` });
  }
  for (const t of (f.search || []).filter((t) => !t.done && t.priority !== 'medium').slice(0, 3)) {
    if (t.key.startsWith('health:') && healthTypes.has(t.key.slice(7))) continue;
    add({ key: `search:${t.key}`, source: 'search', title: t.title, sub: t.sub, verb: 'Open', href: `${ws}#search` });
  }
  if (f.reviews?.googleUnreplied) add({ key: 'reviews:google', source: 'reviews', title: f.reviews.googleUnreplied === 1 ? 'Reply to a Google review' : `Reply to ${f.reviews.googleUnreplied} Google reviews`, sub: 'Replies show under the review on Google.', verb: 'Reply', href: `${ws}#search` });
  if (f.reviews?.pending) add({ key: 'reviews:pending', source: 'reviews', title: f.reviews.pending === 1 ? 'Approve a new review' : `Approve ${f.reviews.pending} new reviews`, sub: 'They show on the site once approved.', verb: 'Review', href: `${ws}#reviews` });
  const missed = (f.ai?.results || []).find((r) => r.kind === 'unbranded' && r.answers.length && r.answers.every((a) => a.named === false));
  if (missed) add({ key: `ai:${qkey(missed.q)}`, source: 'ai', title: `Claude doesn’t suggest them for “${missed.q}”`, sub: 'A page that answers it, in their words, helps.', verb: 'Plan', href: `${ws}#search` });
  for (const i of f.ideas.slice(0, 3)) add({ key: `idea:${i.id}`, source: 'idea', title: i.opportunity, sub: i.timing_phrase || i.suggested_next_step, verb: 'Open', href: `${ws}#plan` });
  const open = all.filter((it) => !stillDecided(decisions.decided[it.key], nowIso));
  const month = nowIso.slice(0, 7);
  const decided = Object.entries(decisions.decided).filter(([, d]) => d.at.slice(0, 7) === month).map(([key, d]) => ({ key, title: d.title, state: d.state, at: d.at }));
  return { items: open.slice(0, DO_NEXT_SHOWN), more: Math.max(0, open.length - DO_NEXT_SHOWN), decided };
}
