// ── AI Visual Studio — the brief builder (pure) ─────────────────────────────
// Turns a customer's plain description + their brand into a generation brief the
// model can use. Deterministic and testable: no I/O, no model. Two jobs:
//   1. Make it *this business's* graphic — fold in palette, personality, the
//      words that ring true, the industry, and the target size.
//   2. Keep it honest — the fact law applies to pixels too. A graphic must never
//      assert a CLAIM the business can't back (awards, ratings, "#1", prices,
//      certifications). We scrub claim-language from the subject and always tell
//      the model, in the negative brief, to render no such text.
import type { AssetSpec, BrandSnapshot } from './contract.ts';

/** Claim words the fact law forbids a graphic from asserting. Scrubbed from the
 *  subject and always named in the negative brief. Plain, case-insensitive. */
const CLAIM_PATTERNS: RegExp[] = [
  /\b#?1\b|\bnumber one\b|\bbest\b|\btop[- ]rated\b|\bvoted\b|\baward[- ]?winning\b|\bawards?\b/i,
  /\b\d(?:\.\d)?\s*stars?\b|\brated\b|\brating\b|\breviews?\b|\btestimonials?\b/i,
  /\bcertified\b|\blicen[cs]ed\b|\bguarantee[ds]?\b|\bofficial\b|\bendorsed\b/i,
  /\$\s?\d|\d+\s*%\s*off\b|\bsale\b|\bdiscount\b|\bcheapest\b|\blowest price\b/i,
];

export interface Brief {
  prompt: string;             // the positive brief
  negative: string;           // what to avoid (fact law + quality)
  removed_claims: string[];   // claim phrases scrubbed from the subject (surfaced to the customer)
  width: number;
  height: number;
}

/** Scrub claim-language from the customer's subject. Returns the safe subject and
 *  the phrases we removed (so the UI can say, plainly, what it left out and why). */
export function scrubClaims(subject: string): { safe: string; removed: string[] } {
  const removed: string[] = [];
  let safe = String(subject || '');
  for (const re of CLAIM_PATTERNS) {
    safe = safe.replace(new RegExp(re.source, 'gi'), (m) => { removed.push(m.trim()); return ''; });
  }
  safe = safe.replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1').trim();
  return { safe, removed: [...new Set(removed.filter(Boolean))] };
}

const KIND_STYLE: Record<string, string> = {
  hero: 'a clean, uncluttered banner with clear space where a headline could sit; nothing crowds the edges',
  social_square: 'a bold, centered composition that reads well small in a feed',
  social_portrait: 'a tall composition with the subject in the upper two-thirds',
  social_story: 'a vertical, full-bleed composition safe for full-screen phones',
  open_graph: 'a simple, legible composition that stays clear at small link-preview sizes',
  general: 'a clean, versatile composition',
};

/** Build the brand-aware brief. Pure. */
export function buildBrief(subject: string, spec: AssetSpec, brand: BrandSnapshot): Brief {
  const { safe, removed } = scrubClaims(subject);

  const brandBits: string[] = [];
  if (brand.industry) brandBits.push(`for a ${brand.industry} business`);
  if (brand.personality) brandBits.push(`the feel is ${brand.personality}`);
  if (brand.palette?.length) brandBits.push(`use this colour palette: ${brand.palette.slice(0, 5).join(', ')}`);
  if (brand.vocabulary?.length) brandBits.push(`in the spirit of: ${brand.vocabulary.slice(0, 6).join(', ')}`);

  const prompt = [
    safe || 'a warm, inviting image that suits the business',
    brandBits.join('; '),
    KIND_STYLE[spec.kind] || KIND_STYLE.general,
    'photographic and natural, tasteful, high quality',
  ].filter(Boolean).join('. ') + '.';

  const negativeBits = [
    'no text, no words, no lettering, no logos, no watermarks',   // the fact law: render no claims/text
    'no awards, badges, ratings, stars, prices, or “#1” marks',
    'nothing misleading; no fake people presented as real customers',
    brand.avoid?.length ? `avoid: ${brand.avoid.slice(0, 6).join(', ')}` : '',
    'no low-quality artifacts, no distortion',
  ].filter(Boolean);

  return { prompt, negative: negativeBits.join('; '), removed_claims: removed, width: spec.width, height: spec.height };
}
