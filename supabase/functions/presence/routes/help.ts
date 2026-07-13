// ── HELP-1 · In-app "how do I…?" helper — route ──────────────────────────────
//   POST /help/ask  { question }
// Deterministic-first product help: matchHelp (lib/help_assistant.ts) grounds every
// answer in our own help copy + real screens. The deterministic answer IS the
// product. An OPTIONAL language polish only rewords it — doubly gated (HELP_POLISH=on
// AND ANTHROPIC_KEY) and guarded by the SAME hallucination verifier the Concierge
// uses (verifyPolish), so it can never introduce a product feature that isn't in our
// help copy. Distinct from /concierge/ask (which speaks about the owner's own site).
import { json } from '../../_shared/http.ts';
import { matchHelp, helpCorpus } from '../lib/help_assistant.ts';
import { verifyPolish } from '../concierge/verify.ts';

const HELP_POLISH_SYSTEM = `You edit a short product-help note for a small-business owner using website software.
Rules, absolute:
- Reword ONLY. Do not add any feature, step, fact, number, name, claim, or URL that is not in the input.
- Keep every instruction and every link the input mentions.
- Keep it the same length or shorter.
- Calm, warm, plain language. No exclamation marks. Never mention AI, assistants, or specialists.
Return only the reworded note.`;

/** Optional, doubly-gated language polish. Default OFF → the deterministic answer
 *  is returned unchanged. Any invention (verifyPolish) → the deterministic answer
 *  stands. Never throws, never blocks. */
async function polishHelp(text: string, grounding: string): Promise<string> {
  if ((Deno.env.get('HELP_POLISH') || '').toLowerCase() !== 'on') return text;
  const key = Deno.env.get('ANTHROPIC_KEY') || '';
  if (!key) return text;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', max_tokens: 400,
        system: HELP_POLISH_SYSTEM,
        messages: [{ role: 'user', content: `<<<NOTE\n${text.slice(0, 1500)}\nNOTE>>>` }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    const j = await res.json();
    if (j?.error) return text;
    const out = Array.isArray(j?.content) ? j.content.filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('\n').trim() : '';
    const v = verifyPolish(text, out, grounding);
    return v.ok ? out : text;   // invention detected → deterministic answer stands
  } catch {
    return text;
  }
}

export async function handleHelpAsk(req: Request, cors: Record<string, string>) {
  let body: { question?: string } = {};
  try { body = await req.json(); } catch { /* empty ask → the honest prompt */ }
  const m = matchHelp(body?.question);
  const answer = m.matched ? await polishHelp(m.answer, helpCorpus()) : m.answer;
  return json({ data: { matched: m.matched, id: m.id, question: m.question, answer, links: m.links, low_confidence: m.low_confidence } }, 200, cors);
}
