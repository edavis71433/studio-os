// ── The studio's choices for a client's monthly report (builder list items 160 and 176) ──
// Wix Studio lets an agency choose what its client report says and who gets it, and its
// assistant writes "what to propose next". Ours, kept in the same reserved row as the
// report's switch (ops/monthly_report.ts):
//   • which parts the report says (a part switched off never shows; one with nothing
//     to say that month leaves itself out anyway);
//   • up to four more people at the business, each sent their own copy;
//   • a copy to the studio person who asked for one, marked "Your copy";
//   • skip a quiet month: no report when the site had fewer visits than a number;
//   • what to suggest next: one line a month, picked from the client's Do next list
//     (the Growth Coach's ideas first), in the studio's own words, or none.
// Everything here is pure: the stored shape, cleaned; and the suggestion picked from
// what the Do next list already knows.
import type { DoNextFacts, Decision } from './do_next.ts';
import { stillDecided } from './do_next.ts';
import { TYPE_TITLES, STATE_TYPES } from './health_score.ts';

// health findings that are a site's state or our own reading of it, never work to offer a client
const NOT_WORK = new Set([...STATE_TYPES, 'website.live_fetch_failed', 'seo.noindex']);

export const REPORT_PARTS = ['visits', 'enquiries', 'google', 'ai', 'reviews', 'health', 'pages', 'changes'] as const;
export type ReportPart = typeof REPORT_PARTS[number];
export const REPORT_PART_WORDS: Record<ReportPart, string> = {
  visits: 'Visits', enquiries: 'Enquiries', google: 'On Google', ai: 'AI answers',
  reviews: 'Reviews', health: 'Website health', pages: 'Most read pages', changes: 'What changed',
};
export const REPORT_CC_MAX = 4;
export const QUIET_DEFAULT = 30;
export const QUIET_MAX = 1000;
export const PROPOSE_TEXT_MAX = 400;
export const PROPOSE_REST_MONTHS = 3;   // a suggestion picked for the studio isn't picked again for three months
export const PROPOSE_LOG_KEPT = 12;

export type ProposeMode = 'off' | 'auto' | 'own';
/** `pick` is a suggestion the studio chose from the ones offered, for the next report only;
 *  `log` is what went out, newest first, so a picked one rests before it comes back. */
export interface ProposeSetting { mode: ProposeMode; text: string; pick: string | null; log: Array<{ month: string; key: string }> }
export interface Proposal { key: string; text: string; source: 'idea' | 'ai' | 'search' | 'health' | 'reviews' | 'own' }

const EMAIL_RE = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]{2,}$/;
const KEY_RE = /^[a-z_]+:[\w:./@-]{1,200}$/i;

/** The parts switched off: known ones, each once. Pure. */
export function normalizePartsOff(raw: unknown): ReportPart[] {
  const want = new Set(Array.isArray(raw) ? raw.map((x) => String(x)) : []);
  return REPORT_PARTS.filter((p) => want.has(p));
}
/** The extra people: real addresses, lower case, each once, never the client's own, four at most. Pure. */
export function normalizeCc(raw: unknown, clientEmail: string | null = null): string[] {
  const own = String(clientEmail || '').trim().toLowerCase();
  const out: string[] = [];
  for (const x of Array.isArray(raw) ? raw : []) {
    const e = String(x ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(e) || e.length > 160 || e === own || out.includes(e)) continue;
    out.push(e);
    if (out.length >= REPORT_CC_MAX) break;
  }
  return out;
}
/** The fewest visits a month needs for its report to go: a whole number from 1 to 1,000, or null (always send). Pure. */
export function normalizeQuiet(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === false || raw === '') return null;
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) && n >= 1 ? Math.min(QUIET_MAX, n) : null;
}
/** The copy's address: a real one, or null. Pure. */
export function normalizeCopyTo(raw: unknown): string | null {
  const e = String(raw ?? '').trim().toLowerCase();
  return EMAIL_RE.test(e) && e.length <= 160 ? e : null;
}
/** What to suggest next, cleaned. Off unless the studio chose otherwise. Pure. */
export function normalizePropose(raw: unknown): ProposeSetting {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const mode: ProposeMode = r.mode === 'auto' || r.mode === 'own' ? r.mode : 'off';
  const log = (Array.isArray(r.log) ? r.log : [])
    .filter((x: any) => x && typeof x.month === 'string' && /^\d{4}-\d{2}$/.test(x.month) && typeof x.key === 'string' && x.key.length <= 220)
    .map((x: any) => ({ month: String(x.month), key: String(x.key) }))
    .sort((a, b) => b.month.localeCompare(a.month))
    .slice(0, PROPOSE_LOG_KEPT);
  return {
    mode,
    text: typeof r.text === 'string' ? r.text.replace(/\s+/g, ' ').trim().slice(0, PROPOSE_TEXT_MAX) : '',
    pick: typeof r.pick === 'string' && KEY_RE.test(r.pick) ? r.pick : null,
    log,
  };
}

const qkey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
const sentence = (s: string) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t && !/[.!?…”"]$/.test(t) ? t + '.' : t; };

/** What the report could suggest, best first, from what the client's Do next list knows:
 *  the Growth Coach's ideas (written for the business), a question an AI assistant answers
 *  without naming them, Search's critical and high to-dos, the health check's worst problem,
 *  and Google reviews waiting for a reply. Never the studio's own Needs you rows, and never
 *  something the studio marked Done or Not relevant there. Keys match the Do next list's. Pure. */
export function proposalCandidates(f: DoNextFacts, decided: Record<string, Decision>, nowIso: string): Proposal[] {
  const out: Proposal[] = [];
  const add = (p: Proposal) => { if (!out.some((x) => x.key === p.key) && !stillDecided(decided[p.key], nowIso)) out.push(p); };
  for (const i of f.ideas || []) if (i.opportunity) add({ key: `idea:${i.id}`, source: 'idea', text: [sentence(i.opportunity), sentence(i.suggested_next_step)].filter(Boolean).join(' ') });
  const missed = (f.ai?.results || []).find((r) => r.kind === 'unbranded' && r.answers.length && r.answers.every((a) => a.named === false));
  if (missed) add({ key: `ai:${qkey(missed.q)}`, source: 'ai', text: `When people ask an AI assistant “${missed.q}”, it doesn’t name you yet. A page that answers it, in your words, would help.` });
  for (const t of (f.search || []).filter((t) => !t.done && t.priority !== 'medium').slice(0, 3)) add({ key: `search:${t.key}`, source: 'search', text: [sentence(t.title), sentence(t.sub)].filter(Boolean).join(' ') });
  const worst = (f.health || []).filter((h) => !NOT_WORK.has(h.type)).sort((a, b) => (a.severity === b.severity ? b.n - a.n : a.severity === 'critical' ? -1 : 1))[0];
  if (worst && TYPE_TITLES[worst.type]) add({ key: `health:${worst.type}`, source: 'health', text: `Fix something on your website: ${TYPE_TITLES[worst.type].replace(/\.$/, '').toLowerCase()}${worst.n > 1 ? `, in ${worst.n} places` : ''}.` });
  if (f.reviews?.googleUnreplied) add({ key: 'reviews:google', source: 'reviews', text: `${f.reviews.googleUnreplied === 1 ? 'A Google review is' : `${f.reviews.googleUnreplied} Google reviews are`} waiting for a reply. Replies show under the review on Google, where people choosing a business read them.` });
  return out;
}

/** The one line a month's report suggests, or null: off says nothing; the studio's own
 *  words when they chose them; otherwise the suggestion the studio picked for this report,
 *  or the best one that hasn't gone out in the last three months. Pure. */
export function pickProposal(p: ProposeSetting, cands: Proposal[], month: string): Proposal | null {
  if (p.mode === 'off') return null;
  if (p.mode === 'own') return p.text ? { key: 'own', source: 'own', text: p.text } : null;
  if (p.pick) { const c = cands.find((x) => x.key === p.pick); if (c) return c; }
  const rested = (key: string) => !p.log.some((l) => l.key === key && monthsBetween(l.month, month) < PROPOSE_REST_MONTHS && l.month !== month);
  return cands.find((c) => rested(c.key)) || null;
}
const monthsBetween = (a: string, b: string) => { const [ay, am] = a.split('-').map(Number), [by, bm] = b.split('-').map(Number); return Math.abs((by - ay) * 12 + (bm - am)); };

/** The setting after a report went out with this suggestion: logged, and a one-off pick used up. Pure. */
export function afterProposal(p: ProposeSetting, month: string, sent: Proposal | null): ProposeSetting {
  if (!sent) return p;
  return { ...p, pick: null, log: [{ month, key: sent.key }, ...p.log.filter((l) => l.month !== month)].slice(0, PROPOSE_LOG_KEPT) };
}

/** Is this month quiet enough to skip? Only when the studio set a number and the visits
 *  were read; a count that couldn't be read never skips a report. Pure. */
export function quietMonth(quietMin: number | null, visits: number | null): boolean {
  return quietMin !== null && visits !== null && visits < quietMin;
}
