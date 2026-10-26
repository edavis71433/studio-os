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
import { enabledEngines, type Engine } from './engines.ts';
import { domainOf, extractAnswer, type KnownFacts } from './extract.ts';
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

  progress({ step: 'asking', done: 0, total: jobs.length });
  let asked = 0;
  const engineBudget = Math.max(5000, Math.min(36_000, deadline - now() - 20_000));
  const answers = await Promise.all(jobs.map(async ({ e, p }) => {
    const r = await e.ask(p.text, { city: inp.city }, engineBudget, aiFetch);
    cost += r.costUsd;
    asked++;
    progress({ step: 'asking', done: asked, total: jobs.length });
    return { e, p, r };
  }));

  // An engine "fails" when most of its answers didn't come back.
  const failedEngines = engines.filter((e) => { const mine = answers.filter((a) => a.e === e); return mine.filter((a) => !a.r.ok).length * 2 > mine.length; });
  if (failedEngines.length >= 2 || failedEngines.length === engines.length) {
    return { ok: false, error: 'engines_failed', message: "We couldn't reach the AI services just now. Please try again in a few minutes.", costUsd: cost };
  }

  if (inp.url) progress({ step: 'website' });
  const readiness = await readinessP;
  const facts: KnownFacts = readiness.checked ? readiness.facts : { address: null, phone: null, hours: null, website: inp.url };

  const usable = answers.filter((a) => a.r.ok && !failedEngines.includes(a.e));
  progress({ step: 'reading', done: 0, total: usable.length });
  let read = 0;
  const extractBudget = Math.max(3000, Math.min(12_000, deadline - now() - 14_000));
  const records: AnswerRecord[] = await Promise.all(answers.map(async ({ e, p, r }) => {
    const base = { engine: e.id, engineName: e.name, promptId: p.id, kind: p.kind, question: p.text, ok: r.ok && !failedEngines.includes(e), sources: r.ok ? r.sources : [], extraction: null };
    if (!base.ok || !r.ok) return base;
    const x = await extractAnswer({ question: p.text, answer: r.text, target, facts }, extractBudget, aiFetch);
    cost += x.costUsd;
    read++;
    progress({ step: 'reading', done: read, total: usable.length });
    return { ...base, extraction: x.ok ? x.data : null };
  }));
  if (!records.some((r) => r.extraction)) {
    return { ok: false, error: 'engines_failed', message: "We couldn't read the AI answers just now. Please try again in a few minutes.", costUsd: cost };
  }

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
  if (inp.url && !readiness.checked) notes.push("We couldn't read your website, so AI readiness is left out of the overall score.");

  progress({ step: 'writing' });
  const narrative = await writeNarrative({
    businessName: inp.businessName, businessType: inp.businessType, city: inp.city, url: inp.url || '',
    overall: s.overall, pillars: s.pillars.map((p) => ({ name: p.name, score: p.score, note: p.note })),
    issues, strengths, pagesReviewed: prompts.map((p) => p.id), notes,
  }, Math.max(0, deadline - now()), aiFetch, now, {
    system: AI_SYSTEM,
    pillarName: aiPillarName,
    fallbackSummary: () => named === 0
      ? `When we asked ${engines.map((e) => e.name).join(' and ')} for ${LOOKING_FOR[inp.businessType] || LOOKING_FOR.other} in ${inp.city}, ${inp.businessName} came up in 0 of ${un.length} answers.${competitors[0] ? ` ${competitors[0].name} was named most often, in ${competitors[0].mentions}.` : ''} The fixes below are the places to start.`
      : `${inp.businessName} came up in ${named} of ${un.length} answers when we asked for local recommendations in ${inp.city}.${competitors[0] ? ` ${competitors[0].name} was named most often, in ${competitors[0].mentions}.` : ''} The fixes below would close the gap.`,
  });
  cost += narrative.costUsd;

  return {
    ok: true,
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
      tables: buildTables({ recs: records, target, competitors, sources, engines: engineStats, readiness }),
    },
    raw: {
      answers: answers.map(({ e, p, r }) => ({ engine: e.id, prompt: p.id, question: p.text, ok: r.ok, reason: r.ok ? null : r.reason, text: r.ok ? r.text : null, sources: r.ok ? r.sources : [] })),
      extractions: records.map((r) => ({ engine: r.engine, prompt: r.promptId, extraction: r.extraction })),
      readiness, competitors, sources, engines: engineStats, failed_engines: failedEngines.map((e) => e.id),
      narrative: { source: narrative.source, attempts: narrative.attempts }, elapsed_ms: now() - t0,
    },
    costUsd: cost,
    narrativeSource: narrative.source,
  };
}
