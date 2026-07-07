// ── Optional language polish (M9.4) — the ONLY place an LLM may appear ──────
// Constitutional boundary (M9.4 brief + 05): the model may reword, improve
// readability, adjust tone. It may NEVER add facts, evidence, priorities,
// recommendations, numbers, or claims — everything factual arrives already
// written by the deterministic answer engine.
//
// Doubly gated: (1) env — CONCIERGE_POLISH=on AND ANTHROPIC_KEY present;
// default OFF, so the deterministic voice IS the product until the per-client
// AI toggle exists (Law 24). (2) verifyPolish — any invention → fall back to
// the deterministic answer. polish() never throws and never blocks.
import { verifyPolish } from './verify.ts';

const POLISH_SYSTEM = `You edit a short note from a business concierge to a small-business owner.
Rules, absolute:
- Reword ONLY. Do not add any fact, number, name, claim, promise, percentage, URL, or suggestion that is not in the input.
- Keep every fact and every caveat that is in the input.
- Keep it the same length or shorter.
- Calm, warm, plain merchant language. No exclamation marks. Never mention AI, assistants, or specialists.
Return only the reworded note.`;

export async function polish(text: string, groundingText: string): Promise<{ text: string; polished: boolean }> {
  if ((Deno.env.get('CONCIERGE_POLISH') || '').toLowerCase() !== 'on') return { text, polished: false };
  const key = Deno.env.get('ANTHROPIC_KEY') || '';
  if (!key) return { text, polished: false };
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', max_tokens: 400,
        system: POLISH_SYSTEM,
        messages: [{ role: 'user', content: `<<<NOTE\n${text.slice(0, 2000)}\nNOTE>>>` }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    const j = await res.json();
    if (j?.error) return { text, polished: false };
    const out = Array.isArray(j?.content) ? j.content.filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('\n').trim() : '';
    const v = verifyPolish(text, out, groundingText);
    if (!v.ok) return { text, polished: false };   // invention detected → deterministic answer stands
    return { text: out, polished: true };
  } catch {
    return { text, polished: false };
  }
}
