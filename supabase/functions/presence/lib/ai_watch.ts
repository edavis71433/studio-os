// ── AI answers over time (builder list item 182, Nov 2026) ──────────────────────
// Semrush tracks what the assistants say about a business month by month, and
// Squarespace lists ten questions with a tick or a cross per assistant and "Add a
// question". Ours: each client keeps up to ten questions (the AI check's own seven
// to start with), the studio switches a monthly check on per client (it costs money:
// about six cents a question, Claude with a web search), and each month's answers are
// kept (presence_ai_checks, migration 0172) for the chart and for "what Claude said".
// Only Claude is asked today (_shared/tools/ai_visibility/engines.ts); ChatGPT and
// Gemini join when their keys are set, and every count here is per question, so a
// second assistant needs no change. Pure.
import { buildPrompts, type Prompt } from '../../_shared/tools/ai_visibility/prompts.ts';
import { nameTokens } from '../../_shared/tools/ai_visibility/extract.ts';

export const AI_QUESTIONS_MAX = 10;
export const AI_QUESTION_MAX_CHARS = 200;
/** What one question costs a month, from the real scans' average (tool_usage_log,
 *  Nov 2026: $0.41 for seven questions with the website read and the write-up). */
export const AI_CENTS_PER_QUESTION = 6;

export interface AiQuestion { text: string; added_at: string; added_by: string | null }

const cleanQ = (v: unknown) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, AI_QUESTION_MAX_CHARS);

/** The stored list, cleaned: each question once, ten at most. Pure. */
export function normalizeQuestions(raw: unknown): { questions: AiQuestion[] } {
  const list = Array.isArray((raw as { questions?: unknown })?.questions) ? (raw as { questions: unknown[] }).questions : [];
  const seen = new Set<string>(); const questions: AiQuestion[] = [];
  for (const x of list) {
    const text = cleanQ((x as { text?: unknown })?.text);
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    questions.push({ text, added_at: String((x as { added_at?: unknown })?.added_at || ''), added_by: (x as { added_by?: unknown })?.added_by ? String((x as { added_by: unknown }).added_by) : null });
    if (questions.length >= AI_QUESTIONS_MAX) break;
  }
  return { questions };
}

/** A save: the questions as asked, keeping when each was first added. Pure. */
export function applyQuestions(cur: { questions: AiQuestion[] }, asked: unknown, who: string | null, nowIso: string): { questions: AiQuestion[] } | { error: string } {
  if (!Array.isArray(asked)) return { error: 'Send the questions as a list.' };
  const texts: string[] = [];
  for (const a of asked) { const t = cleanQ(a); if (t && !texts.some((x) => x.toLowerCase() === t.toLowerCase())) texts.push(t); }
  if (!texts.length) return { error: 'Keep at least one question.' };
  if (texts.length > AI_QUESTIONS_MAX) return { error: `Up to ${AI_QUESTIONS_MAX} questions. Remove one first.` };
  const had = new Map(cur.questions.map((q) => [q.text.toLowerCase(), q]));
  return { questions: texts.map((text) => had.get(text.toLowerCase()) ? { ...had.get(text.toLowerCase())!, text } : { text, added_at: nowIso, added_by: who }) };
}

/** Does a question name the business? Then it tests what the assistant knows about
 *  them (branded); otherwise whether they get recommended (unbranded). Pure. */
export function questionKind(text: string, businessName: string): 'branded' | 'unbranded' {
  const name = nameTokens(businessName);
  if (!name.length) return 'unbranded';
  const words = new Set(nameTokens(text));
  return name.every((t) => words.has(t)) ? 'branded' : 'unbranded';
}

/** The AI check's own seven questions for this client, to start the list. Pure. */
export function defaultQuestions(f: { businessName: string; city: string; businessType: string }): string[] {
  if (!f.businessName || !f.city) return [];
  return buildPrompts({ businessName: f.businessName, city: f.city, businessType: f.businessType || 'other', searchPhrases: '', url: null, detail: '' }).map((p) => p.text);
}

/** The questions as the scan asks them: an id each, and its kind. Pure. */
export function asPrompts(texts: string[], businessName: string): Prompt[] {
  return texts.slice(0, AI_QUESTIONS_MAX).map((text, i) => ({ id: `q${i + 1}`, kind: questionKind(text, businessName), text }));
}

export interface AiAnswer { engine: string; name: string; named: boolean | null; excerpt: string; others: string[] }
export interface AiResult { q: string; kind: 'branded' | 'unbranded'; answers: AiAnswer[] }

/** A short, readable piece of an answer: the sentence that names the business when
 *  it does, else the start. Markdown marks and links are taken out. Pure. */
export function excerptOf(text: unknown, businessName: string, max = 280): string {
  const plain = String(text ?? '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[#*_`>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!plain) return '';
  const first = nameTokens(businessName)[0];
  const at = first ? plain.toLowerCase().indexOf(first) : -1;
  let start = 0;
  if (at > 0) { const dot = plain.lastIndexOf('. ', at); start = dot >= 0 && at - dot < 160 ? dot + 2 : Math.max(0, at - 100); }
  const cut = plain.slice(start, start + max);
  return (start > 0 ? '…' : '') + cut + (start + max < plain.length ? '…' : '');
}

/** One check's raw answers (tool_reports.raw_results) as the table and the sheet show
 *  them: for each question, each assistant's yes or no and what it said; and how many
 *  questions any assistant named the business for. Pure. */
export function aiResults(raw: unknown, prompts: Prompt[], businessName: string, engineNames: Record<string, string>): { asked: number; named: number; results: AiResult[]; engines: string[] } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { answers?: any[]; extractions?: any[] };
  const answers = Array.isArray(r.answers) ? r.answers : [];
  const ex = Array.isArray(r.extractions) ? r.extractions : [];
  const engines = [...new Set(answers.map((a) => String(a?.engine || '')).filter(Boolean))];
  const target = nameTokens(businessName).join(' ');
  const results: AiResult[] = prompts.map((p) => ({
    q: p.text, kind: p.kind,
    answers: engines.map((e) => {
      const a = answers.find((x) => x?.engine === e && x?.prompt === p.id);
      const x = ex.find((y) => y?.engine === e && y?.prompt === p.id)?.extraction || null;
      const others = Array.isArray(x?.businesses) ? x.businesses.map((b: any) => String(b?.name || '').trim()).filter((n: string) => n && nameTokens(n).join(' ') !== target).slice(0, 3) : [];
      return { engine: e, name: engineNames[e] || e, named: a?.ok && x ? !!x.targetFound : null, excerpt: a?.ok ? excerptOf(a.text, businessName) : '', others };
    }),
  }));
  const named = results.filter((q) => q.answers.some((a) => a.named === true)).length;
  return { asked: results.length, named, results, engines };
}

/** "About 60 cents a month for 10 questions". Pure. */
export function costWords(n: number): string {
  const cents = Math.max(1, n) * AI_CENTS_PER_QUESTION;
  const amount = cents >= 100 ? `$${(cents / 100).toFixed(2)}` : `${cents} cents`;
  return `About ${amount} a month for ${n} question${n === 1 ? '' : 's'}`;
}

/** Is this month's check due? The switch on and this month not handled yet: switched on
 *  mid-month, the first check comes on the next run, then on the 1st of each month. Pure. */
export function aiDueNow(s: { ai_checks?: boolean; ai_month?: string | null }, nowIso: string): boolean {
  return s.ai_checks === true && s.ai_month !== nowIso.slice(0, 7);
}
