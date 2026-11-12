// ── What people type to find you (builder list item 160, part two, Nov 2026) ──
// The Search tab asks for the two or three phrases the business wants to be found for
// ("italian restaurant burbank"), with ideas drawn from its services and its area. Each
// phrase is checked against the search headline of every page, the words Google shows
// in bold: the home page's own, the built-in pages' and the owner's pages', each as the
// published site writes it. A phrase in no headline becomes a High task on the checklist.
//
// Kept as one reserved row (lib/reserved_store.ts, '__search_phrases__'), no migration.
// Everything here is pure.
import { vocabFor } from './industry_vocab.ts';

export const PHRASES_MAX = 3;
const PHRASE_LEN = 60;
const PHRASE_WORDS = 6;
// Little words Google pays no mind to, so "pizza in burbank" is found in "Pizza · Burbank"
const STOP = new Set(['a', 'an', 'the', 'in', 'on', 'at', 'of', 'for', 'and', 'to', 'near', 'me', 'my', 'by', 'with', 'from', 'best']);

/** One phrase as it's kept: lower case, single spaces, plain words, six at most. Pure. */
export function phraseOf(v: unknown): string {
  const words = String(v ?? '').normalize('NFKC').toLowerCase().replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[^\p{L}\p{N}&'’ -]+/gu, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).slice(0, PHRASE_WORDS);
  return words.join(' ').slice(0, PHRASE_LEN).trim();
}

/** The stored phrases, cleaned: each once, three at most. Pure. */
export function normalizePhrases(raw: unknown): { phrases: string[] } {
  const list = Array.isArray((raw as { phrases?: unknown })?.phrases) ? (raw as { phrases: unknown[] }).phrases : Array.isArray(raw) ? raw as unknown[] : [];
  const out: string[] = [];
  for (const x of list) { const p = phraseOf(x); if (p && p.length >= 3 && !out.includes(p)) out.push(p); if (out.length >= PHRASES_MAX) break; }
  return { phrases: out };
}

/** A save: the phrases asked for, or why not. Pure. */
export function applyPhrases(asked: unknown): { phrases: string[] } | { error: string } {
  if (!Array.isArray(asked)) return { error: 'Say which phrases, as a list.' };
  const clean = [...new Set(asked.map(phraseOf).filter((p) => p.length >= 3))];
  if (clean.length > PHRASES_MAX) return { error: `Up to ${PHRASES_MAX} phrases. Take one off first.` };
  return { phrases: clean };
}

const tokens = (s: unknown): string[] => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .split(/[^\p{L}\p{N}]+/u).filter((w) => w && !STOP.has(w));
// "restaurants" finds "restaurant" and the other way round
const same = (a: string, b: string) => a === b || a === b + 's' || b === a + 's' || a === b + 'es' || b === a + 'es';

export interface Headline { key: string; label: string; title: string }

/** Every page's search headline, as the published site writes it: the owner's own wording
 *  when there is one, else the template's ("Menu — Marlow’s Kitchen"). Pure. */
export function pageHeadlines(f: { name: string; seoTitle?: string; industry?: string; pageSeo?: Record<string, { title?: string }> | null; pages?: Array<{ slug?: string; title?: string }> | null; hidden?: string[] | null }): Headline[] {
  const name = String(f.name || '').trim();
  const v = vocabFor(String(f.industry || 'generic'));
  const seo = f.pageSeo && typeof f.pageSeo === 'object' ? f.pageSeo : {};
  const hidden = new Set(f.hidden || []);
  const own = (key: string, fallback: string) => String(seo[key]?.title || '').trim() || fallback;
  const out: Headline[] = [{ key: 'home', label: 'Home', title: String(f.seoTitle || '').trim() || name }];
  for (const [key, label, fallback] of [
    ['offerings', v.offeringLabel, `${v.offeringLabel} — ${name}`], ['about', 'About', `About — ${name}`], ['faq', 'FAQ', `FAQ — ${name}`],
    ['updates', 'Updates', `Updates — ${name}`], ['contact', 'Contact', `Contact & Hours — ${name}`],
  ] as Array<[string, string, string]>) if (!hidden.has(key)) out.push({ key, label, title: own(key, fallback) });
  for (const p of Array.isArray(f.pages) ? f.pages : []) {
    const slug = String(p?.slug || '').trim();
    if (!slug || hidden.has(`page:${slug}`)) continue;
    const title = String(p?.title || slug).trim();
    out.push({ key: `page:${slug}`, label: title, title: own(`page:${slug}`, `${title} — ${name}`) });
  }
  return out.filter((h) => h.title);
}

/** The first headline that has every word of the phrase in it, or null. Pure. */
export function phraseFoundIn(phrase: string, headlines: Headline[]): Headline | null {
  const want = tokens(phrase);
  if (!want.length) return null;
  for (const h of headlines) {
    const have = tokens(h.title);
    if (want.every((w) => have.some((x) => same(w, x)))) return h;
  }
  return null;
}

/** Up to six ideas from what the business offers and where: "catering burbank". Never one
 *  already chosen. Nothing is looked up outside, so ideas cost nothing. Pure. */
export function phraseIdeas(f: { industry?: string; offerings?: Array<{ name?: string; category?: string }> | null; city?: string; serviceArea?: string; chosen?: string[] }): string[] {
  const places: string[] = [];
  const add = (p: string) => { const c = phraseOf(p); if (c && !places.includes(c)) places.push(c); };
  if (f.city) add(f.city);
  for (const part of String(f.serviceArea || '').replace(/^serving\s+/i, '').split(/,|\band\b|&|·/i)) { const t = part.trim(); if (t && t.split(/\s+/).length <= 3) add(t); }
  const things: string[] = [];
  const thing = (t: string) => { const c = phraseOf(t); if (c && c.split(' ').length <= 3 && !things.includes(c)) things.push(c); };
  const industry = String(f.industry || '');
  if (industry && industry !== 'generic') thing(industry.replace(/_/g, ' '));
  const seen = new Map<string, number>();
  for (const o of f.offerings || []) for (const t of [o?.category, o?.name]) { const c = phraseOf(t); if (c) seen.set(c, (seen.get(c) || 0) + 1); }
  [...seen.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 4).forEach(([t]) => thing(t));
  const chosen = new Set((f.chosen || []).map(phraseOf));
  const out: string[] = [];
  for (const t of things) for (const p of places.slice(0, 2)) {
    const idea = phraseOf(`${t} ${p}`);
    if (idea && !chosen.has(idea) && !out.includes(idea)) out.push(idea);
  }
  return out.slice(0, 6);
}
