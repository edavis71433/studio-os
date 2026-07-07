// ── The Fact Guard + Self-Check (M9.5A) — pure, deterministic, model-blind ──
// The Fact Law's teeth. Whatever the model wrote, THIS decides what survives:
//   • no phone / address / hours / prices / years-in-business the fact sheet
//     doesn't contain — placeholders like [your phone number] are the legal
//     way to say "missing"
//   • no awards, licenses, guarantees, superlatives, invented reviews or
//     customer quotes, no invented staff
//   • the client's never_claim list is a hard denylist
// Violations are reported per option; a violating option is marked and the
// engine drops it. The guard runs on EVERY generation — trust is not a path.
import type { WriterPayload, SelfCheck } from './contract.ts';
import { FIELD_CAPS } from './contract.ts';
import type { FactSheet } from './facts.ts';

const PLACEHOLDER_RE = /\[(?:your |the )?[a-z0-9 '&-]{2,40}\]/gi;

const CLAIM_DENYLIST: Array<[RegExp, string]> = [
  [/\b(award[- ]winning|prize[- ]winning|winner of)\b/i, 'claims an award'],
  [/\b(licensed|certified|accredited|insured and bonded)\b/i, 'claims a license/certification'],
  [/\b(guarantee[ds]?|money[- ]back|refund promise)\b/i, 'makes a guarantee'],
  [/\b(best in (?:town|the city|the area)|#1|number one|five[- ]star)\b/i, 'claims a superlative/rating'],
  [/\b(est\.?|established|serving .{0,20} since|family[- ]owned for)\s+(?:19|20)\d{2}\b/i, 'invents business history'],
  [/["“][^"”]{12,}["”]\s*[—-]\s*[A-Z][a-z]+/, 'fabricates a customer quote'],
  [/\b[Oo]ur (?:chef|founder|owner|team member) [A-Z][a-z]+\b/, 'invents a named person'],
];

const text = (p: WriterPayload): string => JSON.stringify(p);
const digitsIn = (s: string) => s.match(/\d[\d\-.,() ]{2,}\d/g) || [];
const stripPlaceholders = (s: string) => s.replace(PLACEHOLDER_RE, '');

export function factGuard(payload: WriterPayload, facts: FactSheet, extraAllowed = ''): { ok: boolean; violations: string[]; placeholders: string[] } {
  const violations: string[] = [];
  const body = text(payload);
  const placeholders = (body.match(PLACEHOLDER_RE) || []).map((p) => p.toLowerCase());
  const clean = stripPlaceholders(body);
  const allowed = JSON.stringify(facts) + '|' + extraAllowed;

  // numeric-fact invention: any multi-digit run absent from the fact sheet
  for (const d of digitsIn(clean)) {
    const norm = d.replace(/\D/g, '');
    if (norm.length >= 3 && !allowed.replace(/\D/g, '').includes(norm)) {
      violations.push(`invents a number/fact: "${d.trim()}"`);
    }
  }
  // price invention: $ amounts not on the sheet
  for (const m of clean.match(/\$\s?\d[\d.,]*/g) || []) {
    if (!allowed.includes(m.replace(/\s/g, ''))) violations.push(`invents a price: "${m}"`);
  }
  // percentage/discount invention: any % or discount language not on the sheet
  for (const m of clean.match(/\d{1,3}\s?%/g) || []) {
    if (!allowed.includes(m.replace(/\s/g, ''))) violations.push(`invents a percentage: "${m}"`);
  }
  if (/\b(percent|% )?(off|discount)\b/i.test(clean) && !/\b(off|discount)\b/i.test(allowed)) {
    violations.push('invents an offer/discount');
  }
  // hour-like claims when the sheet has no hours
  if (!facts.hours_text && /\b(open (?:daily|from|until)|\d{1,2}\s?(?:am|pm)\s?[-–]\s?\d{1,2}\s?(?:am|pm))\b/i.test(clean)) {
    violations.push('states hours the business has not provided');
  }
  // claim classes
  for (const [re, label] of CLAIM_DENYLIST) {
    if (re.test(clean)) violations.push(label);
  }
  // the client's own never-claim list (comma/newline separated phrases)
  const never = (facts.voice.never_claim || '').split(/[,\n;]+/).map((s) => s.trim().toLowerCase()).filter((s) => s.length > 2);
  for (const phrase of never) {
    if (clean.toLowerCase().includes(phrase)) violations.push(`uses a never-claim phrase: "${phrase}"`);
  }
  // testimonials/faq answers must not fabricate reviewers
  if (payload.faqs) for (const f of payload.faqs) {
    if (/customers say|reviews say|people rave/i.test(f.answer)) violations.push('cites reviews that were not provided');
  }
  return { ok: violations.length === 0, violations: [...new Set(violations)], placeholders: [...new Set(placeholders)] };
}

/* ── the self-check: quality signals, deterministic ── */
function flesch(t: string): number {
  const s = Math.max(1, (t.match(/[.!?]+/g) || []).length);
  const words = t.split(/\s+/).filter(Boolean);
  if (!words.length) return 100;
  const syll = words.reduce((n, w) => n + Math.max(1, (w.toLowerCase().match(/[aeiouy]+/g) || []).length), 0);
  return Math.round(206.835 - 1.015 * (words.length / s) - 84.6 * (syll / words.length));
}
const JARGON = /\b(synergy|leverage|utilize|best-in-class|cutting[- ]edge|state[- ]of[- ]the[- ]art|solutions|paradigm)\b/i;
const WEAK_CTA = /\b(click here|learn more|submit|read more)\b/i;

function mainProse(p: WriterPayload): string {
  return [
    p.identity?.description, p.identity?.story,
    ...(p.faqs || []).map((f) => f.answer),
    ...(p.offering_descriptions || []).map((o) => o.description),
    p.post?.body_md, p.document?.body,
  ].filter(Boolean).join(' ');
}

export function selfCheck(p: WriterPayload, facts: FactSheet): SelfCheck {
  const prose = mainProse(p);
  const read = prose ? flesch(prose) : 100;
  const seo: string[] = [];
  if (p.identity?.seo_title && (p.identity.seo_title.length < 15 || p.identity.seo_title.length > FIELD_CAPS.seo_title)) seo.push('search title outside 15-70 chars');
  if (p.identity?.seo_description && (p.identity.seo_description.length < 50 || p.identity.seo_description.length > FIELD_CAPS.seo_description)) seo.push('search description outside 50-170 chars');

  const limits: Array<[string | undefined, number]> = [
    [p.identity?.tagline, FIELD_CAPS.tagline], [p.identity?.description, FIELD_CAPS.description],
    [p.identity?.story, FIELD_CAPS.story], [p.post?.title, FIELD_CAPS.post_title],
    [p.post?.body_md, FIELD_CAPS.post_body], [p.document?.body, FIELD_CAPS.document_body],
    ...(p.faqs || []).flatMap((f) => [[f.question, FIELD_CAPS.question], [f.answer, FIELD_CAPS.answer]] as Array<[string, number]>),
    ...(p.offering_descriptions || []).map((o) => [o.description, FIELD_CAPS.offering_description] as [string, number]),
  ];
  const fieldLimitsOk = limits.every(([v, cap]) => !v || v.length <= cap);

  const existing = (facts.description + ' ' + facts.story + ' ' + facts.faq_questions.join(' ')).toLowerCase();
  const dup = prose.length > 80 && existing.length > 80 &&
    existing.includes(prose.slice(0, 80).toLowerCase());

  const grammar: string[] = [];
  if (/\s{2,}/.test(prose)) grammar.push('double spaces');
  if (/\b(\w+) \1\b/i.test(prose)) grammar.push('repeated word');

  return {
    readability: read,
    reading_ok: read >= 50,
    seo,
    weak_cta: WEAK_CTA.test(text(p)),
    duplicate_of_existing: dup,
    plain_language_ok: !JARGON.test(prose),
    field_limits_ok: fieldLimitsOk,
    grammar_notes: grammar,
  };
}
