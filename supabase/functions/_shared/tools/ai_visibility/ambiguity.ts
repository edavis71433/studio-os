// ── AI Visibility Check: is the name ambiguous? ──────────────────────────────
// Spec Errors table: "Ambiguous name (a chain or a common name) → ask for the
// street or neighborhood before running." One small Haiku call, no web search,
// before any of the paid engine calls. Fails open: if the check itself errors,
// the scan runs (the fuzzy name + city match still guards the counting).

const MODEL = 'claude-haiku-5-5';
const PRICE_IN = 0.10 / 1_000_000, PRICE_OUT = 0.50 / 1_000_000;

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['ambiguous', 'reason'],
  properties: { ambiguous: { type: 'boolean' }, reason: { type: 'string' } },
};

const SYSTEM = `You decide whether a business name plus city is ambiguous for a local search. It is ambiguous only if (a) the name is a chain or franchise with more than one location in or right around that city (for example "Starbucks" in Los Angeles), or (b) the name is so generic that many unrelated businesses there use it (for example "Main Street Pizza" or "Hair Studio"). A distinctive independent name is not ambiguous, even if you have never heard of it. When unsure, answer false. reason: one short sentence.`;

export async function checkAmbiguous(name: string, city: string, budgetMs: number, fetchImpl: typeof fetch = fetch): Promise<{ ambiguous: boolean; reason: string; costUsd: number }> {
  const key = Deno.env.get('ANTHROPIC_KEY') || Deno.env.get('ANTHROPIC_API_KEY') || '';
  if (!key) return { ambiguous: false, reason: '', costUsd: 0 };
  try {
    const r = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 300, system: SYSTEM, output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } }, messages: [{ role: 'user', content: `Business name: ${name}\nCity: ${city}` }] }),
      signal: AbortSignal.timeout(Math.max(1000, budgetMs)),
    });
    const j = await r.json().catch(() => null);
    const u = j?.usage || {};
    const costUsd = (Number(u.input_tokens) || 0) * PRICE_IN + (Number(u.output_tokens) || 0) * PRICE_OUT;
    if (!r.ok || !j) return { ambiguous: false, reason: '', costUsd };
    const d = JSON.parse((j.content || []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join(''));
    return { ambiguous: d?.ambiguous === true, reason: String(d?.reason || '').slice(0, 200), costUsd };
  } catch { return { ambiguous: false, reason: '', costUsd: 0 }; }
}
