// ── The hallucination gate (M9.4) — pure, deterministic ─────────────────────
// If an LLM polishes the concierge's language, this verifier decides whether
// the polished text is a faithful rewording. It rejects anything that:
//   • introduces digits/quantities absent from the deterministic answer
//   • introduces promise/guarantee/superlative claims
//   • breaks the one-host law (personas) or the no-chatbot law ("as an AI…")
//   • balloons far beyond the original (a smell of added content)
// On rejection the caller falls back to the deterministic answer — always.
export interface VerifyResult { ok: boolean; reason: string }

const CLAIM_DENYLIST = /\b(guarantee[ds]?|promise[ds]?|definitely will|number one|#1|top result|rank(?:ing)? first|double[sd]?|triple[sd]?|skyrocket|boost by|\d+\s?%)\b/i;
const PERSONA_DENYLIST = /\b(our (?:seo|accessibility|content|brand|growth) (?:specialist|expert|reviewer|strategist|coach|guardian)|the (?:writer|editor|reviewer|strategist) (?:persona|agent)|my colleague|our team of (?:ai|bots|agents))\b/i;
const CHATBOT_DENYLIST = /\b(as an ai|i'?m an ai|ai assistant|language model|how can i help|i think\b|i believe\b|great question)\b/i;

const digitsOf = (s: string) => new Set((s.match(/\d[\d,.]*/g) || []).map((d) => d.replace(/[,.]$/, '')));

export function verifyPolish(original: string, polished: string, groundingText: string): VerifyResult {
  const p = (polished || '').trim();
  if (!p) return { ok: false, reason: 'empty' };
  if (p.length > Math.max(320, original.length * 2)) return { ok: false, reason: 'ballooned' };
  if (CLAIM_DENYLIST.test(p)) return { ok: false, reason: 'invented_claim' };
  if (PERSONA_DENYLIST.test(p)) return { ok: false, reason: 'persona_leak' };
  if (CHATBOT_DENYLIST.test(p)) return { ok: false, reason: 'chatbot_voice' };
  const allowed = new Set([...digitsOf(original), ...digitsOf(groundingText)]);
  for (const d of digitsOf(p)) {
    if (!allowed.has(d)) return { ok: false, reason: `invented_number:${d}` };
  }
  if (/https?:\/\//i.test(p) && !/https?:\/\//i.test(original + groundingText)) return { ok: false, reason: 'invented_url' };
  return { ok: true, reason: '' };
}
