// ── Site Review: the written part of the report ──────────────────────────────
// Claude Haiku 5.5 turns the check results into the summary, findings and Top 3
// in Eric's voice. The numbers never come from Claude: scores are rule-based,
// and every finding Claude writes is tied to one of our checks by id, keeps our
// priority and pillar, and is thrown back to the template text if it quotes a
// number the check never measured (spec: "use only facts from the JSON, never
// invent numbers or pages"). Two failed calls → the template text throughout.
//
// API notes: structured outputs (output_config.format) force the JSON shape.
// The spec's "temperature 0.3" can't be sent: the API now rejects sampling
// parameters on every model, so effort "low" keeps the writing tight instead.

import { andList, pillarName, priorityOf, type Check, type Priority } from './checks.ts';

export const NARRATIVE_MODEL = 'claude-haiku-5-5';
// $ per token for the cost log (Haiku 5.5: $0.10 / $0.50 per million).
const PRICE_IN = 0.10 / 1_000_000, PRICE_OUT = 0.50 / 1_000_000;

export interface Finding { check_id: string; title: string; what_we_found: string; why_it_matters: string; fix: string; priority: Priority; pillar: string }
export interface Narrative { summary: string; findings: Finding[]; top_three: string[]; source: 'claude' | 'template'; costUsd: number; attempts: number }

const SYSTEM = `You write the findings section of a free website review for a small local business owner. You work for Davis Digital Studio, a one-person web studio; the owner may book a call with Eric afterwards.

Rules:
- Use only the facts in the JSON you are given. Never invent a number, page, file, competitor or result. Quote evidence exactly as given.
- Write to the owner as "you". Plain words; when a technical term is unavoidable, add a short gloss in parentheses the first time.
- Warm, direct analyst voice. No hype, no exclamation marks, no "unlock", "boost", "skyrocket", "game-changing", no em dashes.
- No promises about rankings, traffic or revenue.
- "fix" is one sentence that names the fix and the direction, not a step-by-step to-do list someone else could follow.
- Keep every finding tied to the check_id it came from. Do not merge or invent checks.

Return JSON only, matching the schema:
- summary: 2 to 3 sentences on what the site does well and what to fix first, for this kind of business.
- findings: one per issue you were given, most important first, up to 12. what_we_found cites the real page and value from the evidence. why_it_matters speaks to this business type.
- top_three: the three fixes with the biggest business impact, in order, each one short sentence.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'findings', 'top_three'],
  properties: {
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['check_id', 'title', 'what_we_found', 'why_it_matters', 'fix'],
        properties: {
          check_id: { type: 'string' },
          title: { type: 'string' },
          what_we_found: { type: 'string' },
          why_it_matters: { type: 'string' },
          fix: { type: 'string' },
        },
      },
    },
    top_three: { type: 'array', items: { type: 'string' } },
  },
};

export interface NarrativeInput {
  businessName: string; businessType: string; city: string; url: string;
  overall: number | null; pillars: { name: string; score: number | null; note?: string }[];
  issues: Check[]; strengths: string[]; pagesReviewed: string[]; notes: string[];
}

const numbersIn = (s: string) => (String(s).match(/\d+(?:[.,]\d+)?/g) || []).map((n) => n.replace(',', ''));

/** A Claude finding is kept only if every number it states appears in the
 *  check's own evidence or template text. */
export function groundedIn(f: { what_we_found: string; title: string }, c: Check): boolean {
  const source = `${c.evidence} ${c.draft?.what || ''} ${c.draft?.title || ''}`;
  const known = new Set(numbersIn(source));
  return [...numbersIn(f.what_we_found), ...numbersIn(f.title)].every((n) => known.has(n));
}

export function templateFinding(c: Check): Finding {
  const d = c.draft!;
  return { check_id: c.id, title: d.title, what_we_found: d.what, why_it_matters: d.why, fix: d.fix, priority: priorityOf(c), pillar: pillarName(c.pillar) };
}

export function templateNarrative(inp: NarrativeInput, attempts = 0, costUsd = 0): Narrative {
  const issues = inp.issues.slice(0, 12);
  const top = issues.slice(0, 3).map((c) => c.draft!.fix);
  const strong = inp.pillars.filter((p) => p.score != null && p.score >= 80).map((p) => p.name.toLowerCase());
  const weak = inp.pillars.filter((p) => p.score != null && p.score < 60).map((p) => p.name.toLowerCase());
  const first = issues[0]?.draft?.title.replace(/\.$/, '');
  const pagesNote = inp.pagesReviewed.length < 2 ? ' We could only review the homepage this time.' : '';
  const summary = [
    strong.length ? `Your site is in good shape on ${andList(strong)}.` : `We reviewed ${inp.pagesReviewed.length} page${inp.pagesReviewed.length > 1 ? 's' : ''} of your site.`,
    weak.length ? `The weakest area is ${weak[0]}${first ? `, and the first thing to fix is this: ${first.charAt(0).toLowerCase() + first.slice(1)}.` : '.'}` : first ? `The first thing to fix: ${first.charAt(0).toLowerCase() + first.slice(1)}.` : 'We found nothing urgent to fix.',
  ].join(' ') + pagesNote;
  return { summary, findings: issues.map(templateFinding), top_three: top, source: 'template', costUsd, attempts };
}

async function callClaude(payload: unknown, timeoutMs: number, fetchImpl: typeof fetch): Promise<{ ok: true; data: { summary: string; findings: Omit<Finding, 'priority' | 'pillar'>[]; top_three: string[] }; costUsd: number } | { ok: false; costUsd: number }> {
  const key = Deno.env.get('ANTHROPIC_KEY') || Deno.env.get('ANTHROPIC_API_KEY') || '';
  if (!key) return { ok: false, costUsd: 0 };
  try {
    const r = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: NARRATIVE_MODEL,
        max_tokens: 6000,
        system: SYSTEM,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{ role: 'user', content: `Here are the results for this site. Write the report.\n\n${JSON.stringify(payload)}` }],
      }),
      signal: AbortSignal.timeout(Math.max(1000, timeoutMs)),
    });
    const j = await r.json().catch(() => null);
    const u = j?.usage || {};
    const costUsd = (Number(u.input_tokens) || 0) * PRICE_IN + (Number(u.output_tokens) || 0) * PRICE_OUT;
    if (!r.ok || !j || j.stop_reason === 'refusal' || j.stop_reason === 'max_tokens') return { ok: false, costUsd };
    const text = (j.content || []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('');
    const data = JSON.parse(text);
    if (typeof data?.summary !== 'string' || !Array.isArray(data?.findings) || !Array.isArray(data?.top_three)) return { ok: false, costUsd };
    return { ok: true, data, costUsd };
  } catch { return { ok: false, costUsd: 0 }; }
}

export async function writeNarrative(inp: NarrativeInput, budgetMs: number, fetchImpl: typeof fetch = fetch, now: () => number = Date.now): Promise<Narrative> {
  const issues = inp.issues.slice(0, 12);
  const byId = new Map(issues.map((c) => [c.id, c]));
  const payload = {
    business: { name: inp.businessName, type: inp.businessType, city: inp.city || null, website: inp.url },
    overall_score: inp.overall, pillar_scores: inp.pillars, pages_reviewed: inp.pagesReviewed, notes: inp.notes,
    strengths: inp.strengths.slice(0, 8),
    issues: issues.map((c) => ({ check_id: c.id, area: c.area, pillar: pillarName(c.pillar), status: c.status, priority: priorityOf(c), evidence: c.evidence, plain_draft: c.draft })),
  };
  const deadline = now() + budgetMs;
  let cost = 0;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const left = deadline - now();
    if (left < 4000) return templateNarrative(inp, attempt - 1, cost);
    const res = await callClaude(payload, Math.min(25_000, left - 500), fetchImpl);
    cost += res.costUsd;
    if (!res.ok) continue;
    const seen = new Set<string>();
    const findings: Finding[] = [];
    for (const f of res.data.findings) {
      const c = byId.get(String(f.check_id));
      if (!c || seen.has(c.id)) continue;
      seen.add(c.id);
      const ok = groundedIn(f, c) && f.title && f.what_we_found && f.why_it_matters && f.fix;
      findings.push(ok ? { check_id: c.id, title: f.title, what_we_found: f.what_we_found, why_it_matters: f.why_it_matters, fix: f.fix, priority: priorityOf(c), pillar: pillarName(c.pillar) } : templateFinding(c));
    }
    // Anything Claude skipped still gets reported, from the template.
    for (const c of issues) if (!seen.has(c.id)) findings.push(templateFinding(c));
    // Keep our importance order; Claude may reorder within the same priority.
    const rank = (p: Priority) => (p === 'Fix now' ? 0 : p === 'Important' ? 1 : 2);
    findings.sort((a, b) => rank(a.priority) - rank(b.priority));
    const top = res.data.top_three.filter((s) => typeof s === 'string' && s.trim()).slice(0, 3);
    return {
      summary: res.data.summary.trim() || templateNarrative(inp).summary,
      findings,
      top_three: top.length === 3 ? top : templateNarrative(inp).top_three,
      source: 'claude', costUsd: cost, attempts: attempt,
    };
  }
  return templateNarrative(inp, 2, cost);
}
