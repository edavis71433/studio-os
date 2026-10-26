// ── AI Visibility Check: read one AI answer into facts ───────────────────────
// One Claude Haiku 5.5 call per answer (spec "Extraction"), structured output:
// the businesses named in order, what the answer says about the target, whether
// the AI really knows it, and accuracy flags checked against facts we read off
// the business's own website. Whether the target was named, and where, is
// decided here in code with a fuzzy name + city match, not by the model, so
// "Bacchus Kitchen + Wine Bar" counts for "Bacchus Kitchen" but a namesake in
// another city does not.

export const EXTRACT_MODEL = 'claude-haiku-5-5';
const HAIKU_IN = 0.10 / 1_000_000, HAIKU_OUT = 0.50 / 1_000_000;

export const FLAG_TYPES = ['wrong_address', 'wrong_hours', 'marked_closed', 'confused_with_other', 'outdated_offerings'] as const;
export type FlagType = typeof FLAG_TYPES[number];
export const FLAG_LABELS: Record<FlagType, string> = {
  wrong_address: 'Wrong address', wrong_hours: 'Wrong hours', marked_closed: 'Said to be closed',
  confused_with_other: 'Confused with another business', outdated_offerings: 'Outdated menu or services',
};

export interface KnownFacts { address: string | null; phone: string | null; hours: string | null; website: string | null }
export interface Extraction {
  businesses: { name: string; city: string | null }[];
  targetFound: boolean;
  targetPosition: number | null;        // 1-based rank among the businesses named
  targetDescription: string;
  knows: 'no' | 'vague' | 'yes';
  describedCorrectly: boolean;
  flags: { type: FlagType; detail: string }[];
}

// ── fuzzy matching ───────────────────────────────────────────────────────────

const GENERIC = new Set(['the', 'llc', 'inc', 'co', 'company', 'corp', 'ltd', 'and', 'of', 'at']);
export function nameTokens(s: string): string[] {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&|\+/g, ' and ').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
    .filter((t) => t && !GENERIC.has(t));
}
const cityKey = (s: string | null | undefined) => nameTokens(s || '').join(' ');

/** Same business? (audit 3.4)
 *  - The mention carries every word of the target ("Bacchus Kitchen + Wine
 *    Bar" for "Bacchus Kitchen"). A one-word target only matches a mention of
 *    at most two words ("Union Restaurant", not "Union Station Cafe").
 *  - Or the mention is a shorter form that keeps the target's first word,
 *    the brand ("Bacchus Kitchen" for "Bacchus Kitchen + Wine Bar"; never
 *    "Wine Bar", never "Pizza" for "Joe's Pizza").
 *  - Or the mention is the target as a domain ("DavisDigitalStudio.com").
 *  A mention placed in a different city is a namesake, not the target
 *  (competitorsFrom still keeps it off the competitor list). */
export function sameBusiness(target: { name: string; city: string }, mention: { name: string; city: string | null }): boolean {
  const a = nameTokens(target.name);
  const raw = String(mention.name || '').trim();
  const b = nameTokens(/^[\w.-]+\.[a-z]{2,}$/i.test(raw) ? raw.replace(/\.[a-z]{2,}$/i, '') : raw);
  if (!a.length || !b.length) return false;
  if (b.length === 1 && b[0] === a.join('')) return true;    // "davisdigitalstudio.com"
  if (a.length === 1 && a[0] === b.join('')) return true;
  const aSet = new Set(a), bSet = new Set(b);
  if (a.every((t) => bSet.has(t))) {
    if (a.length === 1 && (b.length > 2 || a[0].length < 4)) return false;   // "Bar" alone isn't a match
  } else if (b.every((t) => aSet.has(t))) {
    if (b[0] !== a[0] || b.join('').length < 4) return false;
  } else return false;
  if (mention.city && target.city) {
    const mc = cityKey(mention.city), tc = cityKey(target.city);
    if (mc && tc && !mc.includes(tc) && !tc.includes(mc)) return false;
  }
  return true;
}

export function locate(target: { name: string; city: string }, businesses: { name: string; city: string | null }[]): number | null {
  const i = businesses.findIndex((b) => sameBusiness(target, b));
  return i >= 0 ? i + 1 : null;
}

export const domainOf = (url: string) => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };

// ── the extraction call ──────────────────────────────────────────────────────

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['businesses_mentioned', 'target_mentioned', 'target_description', 'knows_business', 'described_correctly', 'accuracy_flags'],
  properties: {
    businesses_mentioned: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'city'], properties: { name: { type: 'string' }, city: { type: ['string', 'null'] } } } },
    target_mentioned: { type: 'boolean' },
    target_description: { type: 'string' },
    knows_business: { type: 'string', enum: ['no', 'vague', 'yes'] },
    described_correctly: { type: 'boolean' },
    accuracy_flags: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['type', 'detail'], properties: { type: { type: 'string', enum: [...FLAG_TYPES] }, detail: { type: 'string' } } } },
  },
};

const SYSTEM = `You read one answer an AI assistant gave to a local recommendation question and record what it says. Use only the answer text. Do not add businesses or facts that are not in it.

- businesses_mentioned: every business the answer names or recommends, in the order they appear, with the city if the answer gives one (else null). Use the business's name as written. Do not include the target unless the answer names it.
- target_mentioned: whether the answer names the target business.
- target_description: one plain sentence summarizing what the answer says about the target, or "" if it says nothing.
- knows_business: "yes" if the answer clearly knows the target and describes it specifically; "vague" if it mentions it with little or generic detail, or hedges about whether it exists; "no" if it says it doesn't know it or doesn't mention it.
- described_correctly: false if what the answer says about the target contradicts the known facts or says it is closed; otherwise true.
- accuracy_flags: only for clear errors about the target: an address or hours that contradict the known facts, saying it is closed, presenting another business's details as the target's, or describing services the known facts contradict. Each with a one-sentence detail quoting what the answer said. Empty when there is nothing clearly wrong. Never flag something just because it is missing. An answer that says it doesn't know the target and names a different business as a possible match, while saying it is a different business, is NOT a mix-up: that is knows_business "no" with no flag.`;

// A "did you mean X, which is a different business" is the assistant being
// careful, not a mix-up (audit 3.3: it cost 25 Accuracy points live).
const NOT_A_MIXUP = /\b(?:is|as|be) (?:a )?(?:different|separate|unrelated) business|not (?:the same|related|affiliated)|closest match|may be thinking of|did you mean|doesn'?t appear to be the same/i;
export const realFlags = (flags: { type: FlagType; detail: string }[]) => flags.filter((f) => f.type !== 'confused_with_other' || !NOT_A_MIXUP.test(f.detail));

export async function extractAnswer(args: { question: string; answer: string; target: { name: string; city: string }; facts: KnownFacts }, budgetMs: number, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; data: Extraction; costUsd: number } | { ok: false; costUsd: number }> {
  const key = Deno.env.get('ANTHROPIC_KEY') || Deno.env.get('ANTHROPIC_API_KEY') || '';
  if (!key) return { ok: false, costUsd: 0 };
  const facts = Object.entries(args.facts).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n') || 'none known';
  try {
    const r = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: EXTRACT_MODEL, max_tokens: 2000, system: SYSTEM,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{ role: 'user', content: `Target business: ${args.target.name}, ${args.target.city}\nKnown facts about the target (from its own website):\n${facts}\n\nQuestion asked: ${args.question}\n\nAI answer:\n<answer>\n${args.answer}\n</answer>` }],
      }),
      signal: AbortSignal.timeout(Math.max(1000, budgetMs)),
    });
    const j = await r.json().catch(() => null);
    const u = j?.usage || {};
    const costUsd = (Number(u.input_tokens) || 0) * HAIKU_IN + (Number(u.output_tokens) || 0) * HAIKU_OUT;
    if (!r.ok || !j || j.stop_reason !== 'end_turn') return { ok: false, costUsd };
    const text = (j.content || []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('');
    const d = JSON.parse(text);
    const businesses = (Array.isArray(d.businesses_mentioned) ? d.businesses_mentioned : [])
      .filter((b: { name?: unknown }) => typeof b?.name === 'string' && b.name.trim())
      .map((b: { name: string; city?: string | null }) => ({ name: b.name.trim().slice(0, 120), city: typeof b.city === 'string' && b.city.trim() ? b.city.trim().slice(0, 80) : null }))
      .slice(0, 25);
    const pos = locate(args.target, businesses);
    // The model may record the target only in target_mentioned; keep our code
    // as the judge, but accept a mention it saw that the list missed.
    const found = pos != null || (d.target_mentioned === true && nameTokens(args.answer).join(' ').includes(nameTokens(args.target.name).join(' ')));
    const flags = realFlags((Array.isArray(d.accuracy_flags) ? d.accuracy_flags : [])
      .filter((f: { type?: string }) => FLAG_TYPES.includes(f?.type as FlagType))
      .map((f: { type: FlagType; detail?: string }) => ({ type: f.type, detail: String(f.detail || '').slice(0, 300) })))
      .slice(0, 5);
    return {
      ok: true, costUsd,
      data: {
        businesses, targetFound: found, targetPosition: pos ?? (found ? businesses.length + 1 : null),
        targetDescription: String(d.target_description || '').slice(0, 400),
        knows: d.knows_business === 'yes' || d.knows_business === 'vague' ? d.knows_business : 'no',
        describedCorrectly: d.described_correctly !== false, flags,
      },
    };
  } catch { return { ok: false, costUsd: 0 }; }
}
