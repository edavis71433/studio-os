// ── AI Visibility Check: the questions we ask each AI ────────────────────────
// Seven per engine (spec "Prompts run"): five unbranded questions that test
// whether the business gets recommended and who gets recommended instead, and
// two branded ones that test whether the AI knows the business and gets it
// right. If the visitor typed what customers search for, it goes into the
// industry question.

export type PromptKind = 'unbranded' | 'branded';
export interface Prompt { id: string; kind: PromptKind; text: string }
export interface VisibilityInput { businessName: string; city: string; businessType: string; searchPhrases: string; url: string | null; detail: string }

// How each business type is said in a sentence ("a salon", "salons").
const NOUN: Record<string, string> = {
  restaurant: 'restaurant', salon: 'salon', retail: 'shop', 'home services': 'home services company',
  'health and wellness': 'wellness studio', other: 'local business',
};

const first = (s: string) => s.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean)[0] || '';

function industryPrompt(type: string, city: string, phrase: string): string {
  switch (type) {
    case 'restaurant': return phrase ? `Where should I go for ${phrase} in ${city}?` : `Where should I eat for date night in ${city}?`;
    case 'salon': return `What's the best place for ${phrase || 'a haircut and color'} in ${city}?`;
    case 'home services': return `Who do I call for ${phrase || 'a repair'} in ${city}?`;
    case 'health and wellness': return phrase ? `What's the best place for ${phrase} in ${city}?` : `What's the best wellness studio in ${city} for beginners?`;
    case 'retail': return `Where can I buy ${phrase || 'something special'} in ${city}?`;
    default: return phrase ? `Who's the best for ${phrase} in ${city}?` : `What local business in ${city} would you recommend, and why?`;
  }
}

export function buildPrompts(inp: VisibilityInput): Prompt[] {
  const noun = NOUN[inp.businessType] || NOUN.other;
  const city = inp.city;
  const where = inp.detail ? `${inp.businessName} (${inp.detail}) in ${city}` : `${inp.businessName} in ${city}`;
  return [
    { id: 'u1', kind: 'unbranded', text: `What's the best ${noun} in ${city}?` },
    { id: 'u2', kind: 'unbranded', text: `Can you recommend a ${noun} near ${city}?` },
    { id: 'u3', kind: 'unbranded', text: `What are the top rated ${noun}s in ${city}, and why?` },
    { id: 'u4', kind: 'unbranded', text: `I need a ${noun} in ${city}. Who should I go to?` },
    { id: 'u5', kind: 'unbranded', text: industryPrompt(inp.businessType, city, first(inp.searchPhrases)) },
    { id: 'b1', kind: 'branded', text: `What do you know about ${where}?` },
    { id: 'b2', kind: 'branded', text: `Is ${where} any good, and what do they offer?` },
  ];
}
