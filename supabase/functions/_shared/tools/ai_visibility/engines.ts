// ── AI Visibility Check: the AI engines we ask ───────────────────────────────
// Each engine answers the question the way a person would get it: the plain
// question, no system prompt steering it, with the engine's own web search on.
// Phase 3 runs Claude only (Eric, Oct 2026). ChatGPT (OpenAI web search) and
// Perplexity (Sonar) slot in here as more entries in ENGINES once their API
// keys exist; nothing else in the tool changes, and the report already shows
// per-engine counts and says which engine couldn't be checked.

// sources: what the answer CITED (the assistant drew on it). searched: what
// its web search returned but the answer never used (audit 3.1: the two were
// one list, so "Yelp was cited in 5 answers" meant "Yelp came up in search").
export interface EngineAnswer { ok: true; text: string; sources: { url: string; title: string }[]; searched: { url: string; title: string }[]; model?: string; costUsd: number }
export type EngineResult = EngineAnswer | { ok: false; reason: 'timeout' | 'error' | 'refusal'; costUsd: number };
export interface Engine {
  id: string;
  name: string;
  enabled: () => boolean;
  ask: (question: string, ctx: { city: string }, budgetMs: number, fetchImpl: typeof fetch) => Promise<EngineResult>;
}

// Claude Sonnet 5.5 with live web search. Opus 5.5 measured about $0.80 a
// scan live (Oct 26 2026), above the spec's $0.30-0.60, so Eric chose Sonnet
// 5.5: same web search, about half the cost. $2 / $10 per million tokens,
// $10 per 1,000 searches.
export const CLAUDE_ENGINE_MODEL = 'claude-sonnet-5-5';
const MODEL_IN = 2 / 1_000_000, MODEL_OUT = 10 / 1_000_000, SEARCH = 10 / 1000;

const claudeKey = () => Deno.env.get('ANTHROPIC_KEY') || Deno.env.get('ANTHROPIC_API_KEY') || '';

export function readClaudeAnswer(content: { type: string; [k: string]: unknown }[]): { text: string; sources: { url: string; title: string }[]; searched: { url: string; title: string }[] } {
  const parts: string[] = [];
  const sources: { url: string; title: string }[] = [];
  const searched: { url: string; title: string }[] = [];
  const add = (into: { url: string; title: string }[], url: unknown, title: unknown) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url) || into.some((s) => s.url === url)) return;
    into.push({ url, title: typeof title === 'string' ? title.slice(0, 200) : '' });
  };
  for (const b of content || []) {
    if (b.type === 'text') {
      parts.push(String(b.text || ''));
      for (const c of (b.citations as { url?: string; title?: string }[] | undefined) || []) add(sources, c.url, c.title);
    } else if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
      for (const r of b.content as { url?: string; title?: string }[]) add(searched, r.url, r.title);
    }
  }
  return { text: parts.join('').trim(), sources, searched: searched.filter((s) => !sources.some((c) => c.url === s.url)) };
}

async function askClaude(question: string, ctx: { city: string }, budgetMs: number, fetchImpl: typeof fetch): Promise<EngineResult> {
  const key = claudeKey();
  if (!key) return { ok: false, reason: 'error', costUsd: 0 };
  const deadline = Date.now() + budgetMs;
  const messages: { role: string; content: unknown }[] = [{ role: 'user', content: question }];
  let cost = 0;
  const content: { type: string; [k: string]: unknown }[] = [];
  let withFallbacks = true;
  let retried = false;
  let model: string | undefined;
  // A server-tool turn can pause after its own search loop; resume up to twice.
  for (let round = 0; round < 3; round++) {
    const left = deadline - Date.now();
    if (left < 1500) return content.length ? done() : { ok: false, reason: 'timeout', costUsd: cost };
    let r: Response;
    try {
      r = await fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', ...(withFallbacks ? { 'anthropic-beta': 'server-side-fallback-2026-07-01' } : {}) },
        body: JSON.stringify({
          model: CLAUDE_ENGINE_MODEL,
          max_tokens: 4000,
          output_config: { effort: 'low' },
          ...(withFallbacks ? { fallbacks: 'default' } : {}),
          // allowed_callers "direct": on web_search_20260209 the default runs the
          // search through code-execution "dynamic filtering", and the first live
          // scan after the cited-vs-seen split came back with ZERO citations in all
          // seven answers. A direct search returns the documented cited form
          // (text blocks with web_search_result_location citations).
          tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3, allowed_callers: ['direct'], user_location: { type: 'approximate', city: ctx.city, country: 'US' } }],
          messages,
        }),
        signal: AbortSignal.timeout(Math.max(1000, left)),
      });
    } catch (e) {
      return { ok: false, reason: e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'timeout' : 'error', costUsd: cost };
    }
    const j = await r.json().catch(() => null);
    // If this account can't use the fallback beta, ask again without it.
    if (r.status === 400 && withFallbacks && /fallback/i.test(JSON.stringify(j?.error || ''))) { withFallbacks = false; round--; continue; }
    const u = j?.usage || {};
    cost += (Number(u.input_tokens) || 0) * MODEL_IN + (Number(u.output_tokens) || 0) * MODEL_OUT + (Number(u.server_tool_use?.web_search_requests) || 0) * SEARCH;
    // One retry on a rate limit or overload when the budget allows (audit
    // 3.7: seven questions go out at once, and four lost answers end the scan).
    if ((r.status === 429 || r.status === 529 || r.status === 503 || r.status === 500) && !retried && deadline - Date.now() > 8000) {
      retried = true;
      const after = Math.min(3000, Math.max(1000, (Number(r.headers.get('retry-after')) || 1.5) * 1000));
      await new Promise((res) => setTimeout(res, after));
      round--;
      continue;
    }
    if (!r.ok || !j) return { ok: false, reason: 'error', costUsd: cost };
    if (typeof j.model === 'string') model = j.model;
    if (j.stop_reason === 'refusal') return { ok: false, reason: 'refusal', costUsd: cost };
    const blocks = Array.isArray(j.content) ? j.content : [];
    content.push(...blocks);
    if (j.stop_reason !== 'pause_turn') return done();
    messages.push({ role: 'assistant', content: blocks });
  }
  return done();

  function done(): EngineResult {
    const a = readClaudeAnswer(content);
    return a.text ? { ok: true, text: a.text.slice(0, 12000), sources: a.sources.slice(0, 40), searched: a.searched.slice(0, 40), model, costUsd: cost } : { ok: false, reason: 'error', costUsd: cost };
  }
}

export const ENGINES: Engine[] = [
  { id: 'claude', name: 'Claude', enabled: () => !!claudeKey(), ask: askClaude },
];
export const enabledEngines = () => ENGINES.filter((e) => e.enabled());
