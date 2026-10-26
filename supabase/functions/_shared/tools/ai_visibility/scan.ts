// ── AI Visibility Check: one scan, start to finish ───────────────────────────
// Ambiguity check → (website readiness, in parallel) → 7 questions per engine,
// all at once → one extraction per answer → scores, competitors, sources →
// findings → Claude narrative. One deadline keeps the whole scan near 60 s.
// Errors (spec): one engine failing → the report runs on the rest and says
// which engine couldn't be checked; two or more failing, or every engine
// failing → a friendly retry and no report; an ambiguous name → ask for the
// street or neighborhood first.

import type { FetchLike, UrlGuard } from '../../site_discovery.ts';
import { scoreLabel } from '../report_view.ts';
import { writeNarrative, type Narrative } from '../site_review/narrative.ts';
import { checkAmbiguous } from './ambiguity.ts';
import { ENGINES, enabledEngines, type Engine } from './engines.ts';
import { domainOf, extractAnswer, type Extraction, type KnownFacts } from './extract.ts';
import { buildPrompts, type VisibilityInput } from './prompts.ts';
import { checkReadiness, type ReadinessResult } from './readiness.ts';
import { aiPillarName, buildIssues, buildTables, competitorsFrom, perEngine, scoreAll, sourcesFrom, type AnswerRecord } from './score.ts';

export const AI_SCAN_BUDGET_MS = 58_000;

export type AiProgress =
  | { step: 'asking'; done: number; total: number }
  | { step: 'reading'; done: number; total: number }
  | { step: 'website' }
  | { step: 'writing' };

export interface AiScanDeps {
  guard: UrlGuard;
  siteFetch?: FetchLike;
  aiFetch?: typeof fetch;            // Anthropic (engine, extraction, ambiguity, narrative)
  engines?: Engine[];
  now?: () => number;
  onProgress?: (p: AiProgress) => void;
}

export type AiScanResult =
  | { ok: true; input: Record<string, unknown>; scores: Record<string, unknown>; findings: Record<string, unknown>; raw: Record<string, unknown>; costUsd: number; narrativeSource: Narrative['source'] }
  | { ok: false; error: 'ambiguous' | 'engines_failed'; message: string; costUsd: number };

const LOOKING_FOR: Record<string, string> = { restaurant: 'a restaurant', salon: 'a salon', retail: 'a shop', 'home services': 'someone to hire', 'health and wellness': 'a wellness studio', other: 'a business like yours' };

export const SNAPSHOT_NOTE = "Based on live AI queries run today through each company's API. Answers vary by person and day, so treat this as a snapshot.";

const AI_SYSTEM = `You write the findings section of a free "AI Visibility Check" for a small local business owner: whether AI assistants recommend them, who they recommend instead, and why. You work for Davis Digital Studio, a one-person web studio; the owner may book a call with Eric afterwards.

Rules:
- Use only the facts in the JSON. Every number is an observed count ("named in 2 of 5 answers"); never invent a rating, percentage, business, source or result.
- Name the competitor and the source when the JSON gives them.
- Write to the owner as "you". Plain words, warm and direct, no hype, no exclamation marks, no em dashes, no "unlock", "boost" or "skyrocket".
- No promises about rankings, traffic or AI results.
- "fix" is one sentence naming the direction (get listed on X, fix the hours on Y, add an about page that says what you do and where), not the steps.
- Never paste the raw evidence field or add lines like "Evidence:".
- Keep every finding tied to its check_id. If the JSON says the business was never named and the AI didn't know it, the headline finding is that AI doesn't know they exist yet.

Return JSON only: summary (2 to 3 sentences), findings (one per issue, most important first), top_three (the three highest-impact fixes, one short sentence each).`;

export async function runAiVisibility(inp: VisibilityInput, deps: AiScanDeps): Promise<AiScanResult> {
  const now = deps.now || Date.now;
  const t0 = now();
  const deadline = t0 + AI_SCAN_BUDGET_MS;
  const progress = (p: AiProgress) => { try { deps.onProgress?.(p); } catch { /* stream closed */ } };
  const aiFetch = deps.aiFetch || fetch;
  const target = { name: inp.businessName, city: inp.city };
  let cost = 0;

  const engines = deps.engines || enabledEngines();
  if (!engines.length) return { ok: false, error: 'engines_failed', message: "The AI check isn't available right now. Try again later, or book a call and I'll run it by hand.", costUsd: 0 };

  if (!inp.detail) {
    const amb = await checkAmbiguous(inp.businessName, inp.city, 5000, aiFetch);
    cost += amb.costUsd;
    if (amb.ambiguous) return { ok: false, error: 'ambiguous', message: `There may be more than one "${inp.businessName}" around ${inp.city}. Add the street or neighborhood so we check the right one.`, costUsd: cost };
  }

  const prompts = buildPrompts(inp);
  const jobs = engines.flatMap((e) => prompts.map((p) => ({ e, p })));
  const readinessP: Promise<ReadinessResult> = checkReadiness(inp.url, inp, { guard: deps.guard, fetchImpl: deps.siteFetch }, 25_000).catch(() => ({ checked: false, reason: 'unreachable' } as const));

  // Each answer is read (extracted) the moment it arrives instead of after
  // the slowest one, so a long engine turn no longer squeezes extraction into
  // its last few seconds (audit 3.8). The calls go out 120 ms apart to soften
  // the burst on the rate limit (audit 3.7). Progress stays in order: "asking"
  // until every question is answered, then "reading" with the count so far.
  progress({ step: 'asking', done: 0, total: jobs.length });
  let asked = 0, read = 0;
  const engineBudget = Math.max(5000, Math.min(36_000, deadline - now() - 20_000));
  const factsP: Promise<KnownFacts> = readinessP.then((rd) => rd.checked ? rd.facts : { address: null, phone: null, hours: null, website: inp.url });
  const settled = await Promise.all(jobs.map(async ({ e, p }, i) => {
    if (i) await new Promise((res) => setTimeout(res, Math.min(i * 120, 800)));
    const r = await e.ask(p.text, { city: inp.city }, engineBudget, aiFetch);
    cost += r.costUsd;
    asked++;
    progress({ step: 'asking', done: asked, total: jobs.length });
    if (!r.ok) return { e, p, r, x: null as Extraction | null, readFailed: false };
    const facts = await factsP;
    const extractBudget = Math.max(3000, Math.min(12_000, deadline - now() - 9_000));
    const x = await extractAnswer({ question: p.text, answer: r.text, target, facts }, extractBudget, aiFetch);
    cost += x.costUsd;
    read++;
    if (asked === jobs.length) progress({ step: 'reading', done: read, total: jobs.length });
    return { e, p, r, x: x.ok ? x.data : null, readFailed: !x.ok };
  }));
  const answers = settled.map(({ e, p, r }) => ({ e, p, r }));

  // An engine "fails" when most of its answers didn't come back.
  const failedEngines = engines.filter((e) => { const mine = answers.filter((a) => a.e === e); return mine.filter((a) => !a.r.ok).length * 2 > mine.length; });
  if (failedEngines.length >= 2 || failedEngines.length === engines.length) {
    return { ok: false, error: 'engines_failed', message: "We couldn't reach the AI services just now. Please try again in a few minutes.", costUsd: cost };
  }

  if (inp.url) progress({ step: 'website' });
  const readiness = await readinessP;

  const records: AnswerRecord[] = settled.map(({ e, p, r, x }) => ({
    engine: e.id, engineName: e.name, promptId: p.id, kind: p.kind, question: p.text, ok: r.ok && !failedEngines.includes(e),
    sources: r.ok ? r.sources : [], searched: r.ok ? r.searched : [], extraction: r.ok && !failedEngines.includes(e) ? x : null,
  }));
  if (!records.some((r) => r.extraction)) {
    return { ok: false, error: 'engines_failed', message: "We couldn't read the AI answers just now. Please try again in a few minutes.", costUsd: cost };
  }
  const unread = settled.filter((s) => s.r.ok && s.readFailed && !failedEngines.includes(s.e)).length;

  const rawAnswers = answers.map(({ e, p, r }) => ({ engine: e.id, prompt: p.id, question: p.text, ok: r.ok, reason: r.ok ? null : r.reason, text: r.ok ? r.text : null, sources: r.ok ? r.sources : [], searched: r.ok ? r.searched : [], model: r.ok ? r.model || null : null }));
  const report = await assembleReport(inp, { engines, failedEngines, promptIds: prompts.map((p) => p.id), records, readiness, rawAnswers, aiFetch, now, deadline, onProgress: progress, unread });
  return { ok: true, ...report, raw: { ...report.raw, elapsed_ms: now() - t0 }, costUsd: cost + report.costUsd };
}

/** Everything after the answers are read: scores, competitors, findings and
 *  the narrative. Shared by a live scan and rebuildFromRaw, which re-scores a
 *  saved report after the rules change without asking the AI anything new. */
export async function assembleReport(inp: VisibilityInput, ctx: {
  engines: { id: string; name: string }[]; failedEngines: { id: string; name: string }[]; promptIds: string[];
  records: AnswerRecord[]; readiness: ReadinessResult; rawAnswers: unknown[];
  aiFetch: typeof fetch; now: () => number; deadline: number; onProgress?: (p: AiProgress) => void; unread?: number;
}) {
  const { engines, failedEngines, records, readiness, aiFetch, now, deadline } = ctx;
  const target = { name: inp.businessName, city: inp.city };
  let cost = 0;
  const ownDomain = readiness.checked ? domainOf(readiness.homeUrl) : inp.url ? domainOf(inp.url) : null;
  const competitors = competitorsFrom(records, target);
  const sources = sourcesFrom(records, ownDomain);
  const engineStats = perEngine(records);
  const s = scoreAll(records, readiness);
  const { issues, strengths } = buildIssues({ recs: records, target, businessType: inp.businessType, url: inp.url, readiness, competitors, sources, engines: engineStats });

  const un = records.filter((r) => r.kind === 'unbranded' && r.extraction);
  const named = un.filter((r) => r.extraction!.targetFound).length;
  const notes = [SNAPSHOT_NOTE];
  for (const e of failedEngines) notes.push(`${e.name} couldn't be checked today, so this report covers the other assistants.`);
  if (ctx.unread) notes.push(`${ctx.unread} of the ${records.length} answers couldn't be read in time, so ${ctx.unread === 1 ? 'it is' : 'they are'} left out of the counts.`);
  if (inp.url && !readiness.checked) notes.push("We couldn't read your website, so AI readiness is left out of the overall score.");

  try { ctx.onProgress?.({ step: 'writing' }); } catch { /* stream closed */ }
  // "Other" with a search phrase reads better as the phrase ("web design in Burbank").
  const phrase = inp.searchPhrases.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean)[0];
  const lookingFor = inp.businessType === 'other' && phrase ? phrase : LOOKING_FOR[inp.businessType] || LOOKING_FOR.other;
  const narrative = await writeNarrative({
    businessName: inp.businessName, businessType: inp.businessType, city: inp.city, url: inp.url || '',
    overall: s.overall, pillars: s.pillars.map((p) => ({ name: p.name, score: p.score, note: p.note })),
    issues, strengths, pagesReviewed: ctx.promptIds, notes,
  }, Math.max(0, deadline - now()), aiFetch, now, {
    system: AI_SYSTEM,
    pillarName: aiPillarName,
    fallbackSummary: () => named === 0
      ? `When we asked ${engines.map((e) => e.name).join(' and ')} for ${lookingFor} in ${inp.city}, ${inp.businessName} came up in 0 of ${un.length} answers.${competitors[0] ? ` ${competitors[0].name} was named most often, in ${competitors[0].mentions}.` : ''} The fixes below are the places to start.`
      : `${inp.businessName} came up in ${named} of ${un.length} answers when we asked for local recommendations in ${inp.city}.${competitors[0] ? ` ${competitors[0].name} was named most often, in ${competitors[0].mentions}.` : ''} The fixes below would close the gap.`,
  });
  cost += narrative.costUsd;

  return {
    input: { business_name: inp.businessName, city: inp.city, business_type: inp.businessType, search_phrases: inp.searchPhrases || null, url: readiness.checked ? readiness.homeUrl : inp.url, detail: inp.detail || null },
    scores: {
      overall: s.overall, label: scoreLabel(s.overall), pillars: s.pillars, notes,
      highlights: [
        { label: 'Appeared in', value: `${named} of ${un.length} answers` },
        { label: 'Top competitor', value: competitors[0]?.name || 'None named' },
      ],
    },
    findings: {
      summary: narrative.summary,
      items: narrative.findings.map(({ check_id: _id, ...f }) => f),
      top_three: narrative.top_three,
      tables: buildTables({ recs: records, target, ownDomain, competitors, sources, engines: engineStats, readiness }),
    },
    raw: {
      answers: ctx.rawAnswers,
      extractions: records.map((r) => ({ engine: r.engine, prompt: r.promptId, extraction: r.extraction })),
      readiness, competitors, sources, engines: engineStats, failed_engines: failedEngines.map((e) => e.id),
      narrative: { source: narrative.source, attempts: narrative.attempts },
    },
    costUsd: cost,
    narrativeSource: narrative.source,
  };
}

/** Re-score a saved report from its stored answers and extractions: the same
 *  assembly a live scan runs, with no new questions to the AI. The narrative
 *  is rewritten by Claude when a key is set, otherwise from the templates. */
// deno-lint-ignore no-explicit-any
export async function rebuildFromRaw(row: { input: any; raw: any }, deps: { aiFetch?: typeof fetch; now?: () => number } = {}) {
  const now = deps.now || Date.now;
  const inp: VisibilityInput = {
    businessName: String(row.input.business_name), city: String(row.input.city), businessType: String(row.input.business_type || 'other'),
    searchPhrases: String(row.input.search_phrases || ''), url: row.input.url || null, detail: String(row.input.detail || ''),
  };
  const nameOf = (id: string) => ENGINES.find((e) => e.id === id)?.name || id;
  const failed: string[] = row.raw.failed_engines || [];
  // deno-lint-ignore no-explicit-any
  const extraction = (a: any) => (row.raw.extractions || []).find((x: any) => x.engine === a.engine && x.prompt === a.prompt)?.extraction || null;
  // deno-lint-ignore no-explicit-any
  const records: AnswerRecord[] = (row.raw.answers || []).map((a: any) => ({
    engine: a.engine, engineName: nameOf(a.engine), promptId: a.prompt, kind: String(a.prompt).startsWith('b') ? 'branded' : 'unbranded',
    question: a.question, ok: !!a.ok && !failed.includes(a.engine), sources: a.ok ? a.sources || [] : [], searched: a.ok ? a.searched || [] : [], extraction: extraction(a),
  }));
  const engineIds = [...new Set(records.map((r) => r.engine))];
  const report = await assembleReport(inp, {
    engines: engineIds.map((id) => ({ id, name: nameOf(id) })),
    failedEngines: failed.map((id) => ({ id, name: nameOf(id) })),
    promptIds: [...new Set(records.map((r) => r.promptId))], records, readiness: row.raw.readiness, rawAnswers: row.raw.answers,
    aiFetch: deps.aiFetch || fetch, now, deadline: now() + 20_000,
  });
  return { ...report, raw: { ...report.raw, elapsed_ms: row.raw.elapsed_ms ?? null, rebuilt_at: new Date(now()).toISOString() } };
}
