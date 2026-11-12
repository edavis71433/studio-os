// ── AI answers over time, the Search tab's routes (builder list item 182) ──────
//   GET /visibility/ai             the client's questions, the monthly switch, a point a
//                                  month for the chart, and the latest check's answers
//   PUT /visibility/ai/questions   { questions: [...] } up to ten; a member needs `edit`
// The switch itself is the monthly report card's (PUT /report/monthly { ai_checks }),
// which needs `configure`: it spends money. Under /visibility for the reason
// routes/visibility.ts gives (search works whoever hosts the site).
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { readReservedJson, updateReservedJson, RESERVED_NAMES } from '../lib/reserved_store.ts';
import { readReportSetting } from '../ops/monthly_report.ts';
import { aiInputsFor } from '../ops/ai_checks.ts';
import { ENGINES } from '../../_shared/tools/ai_visibility/engines.ts';
import { AI_QUESTIONS_MAX, applyQuestions, costWords, normalizeQuestions, questionKind } from '../lib/ai_watch.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const rows = (r: unknown): any[] => { const j = (r as { json?: unknown } | null)?.json; return Array.isArray(j) ? j : []; };

/** The first of next month, as the card says it ("Dec 1"). Pure. */
export function nextCheckDay(nowIso: string): string {
  const d = new Date(nowIso);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export async function handleAiGet(site: SiteRow, cors: Record<string, string>) {
  const nowIso = new Date().toISOString();
  const [setting, qs, checksQ, inputs] = await Promise.all([
    readReportSetting(site.id).catch(() => null),
    readReservedJson(site.id, RESERVED_NAMES.aiQuestions),
    svc(`presence_ai_checks?site_id=eq.${site.id}&select=month,checked_at,engines,asked,named,results&order=month.desc&limit=6`).catch(() => null),
    aiInputsFor(site).catch(() => null),
  ]);
  const stored = normalizeQuestions(qs).questions;
  const texts = stored.length ? stored.map((q) => q.text) : (inputs?.questions || []);
  const name = inputs?.businessName || '';
  const checks = rows(checksQ);
  const latest = checks[0] || null;
  return json({ data: {
    questions: texts.map((text) => ({ text, kind: questionKind(text, name) })),
    defaults: !stored.length,
    max: AI_QUESTIONS_MAX,
    ready: !!(checksQ && checksQ.ok),
    can_check: !!inputs,   // a name and a town to ask about
    watch: {
      enabled: setting?.ai_checks === true,
      last_result: setting?.ai_result || null,
      next: nextCheckDay(nowIso),
      cost: costWords(texts.length || 7),
    },
    months: checks.slice().reverse().map((c) => ({ month: String(c.month), asked: Number(c.asked) || 0, named: Number(c.named) || 0, checked_at: c.checked_at })),
    latest: latest ? { month: String(latest.month), checked_at: latest.checked_at, engines: (Array.isArray(latest.engines) ? latest.engines : []).map((id: string) => ({ id, name: ENGINES.find((e) => e.id === id)?.name || id })), results: Array.isArray(latest.results) ? latest.results : [] } : null,
    engines: ENGINES.map((e) => ({ id: e.id, name: e.name })),
  } }, 200, cors);
}

export async function handleAiQuestionsPut(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  let b: { questions?: unknown } = {}; try { b = await req.json(); } catch { /* answered below */ }
  let refused = '';
  const saved = await updateReservedJson(site.id, RESERVED_NAMES.aiQuestions, (cur) => {
    const r = applyQuestions(normalizeQuestions(cur), b.questions, principal.email || null, new Date().toISOString());
    if ('error' in r) { refused = r.error; throw new Error('refused'); }
    return r;
  }, principal.email || 'search').catch(() => null);
  if (refused) return json({ error: 'bad_request', message: refused }, 400, cors);
  if (!saved) return json({ error: 'write_failed', message: 'That didn’t save. Nothing changed; try again.' }, 502, cors);
  const n = normalizeQuestions(saved).questions.length;
  return json({ data: { questions: normalizeQuestions(saved).questions.map((q) => q.text), cost: costWords(n) } }, 200, cors);
}
