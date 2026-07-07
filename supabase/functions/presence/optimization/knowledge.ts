// ── Business Knowledge Import (M10) — deterministic extraction, PURE ────────
// The renamed Document Intelligence concept, shrunk to what it should be:
// customers hand over what they already have (menus, flyers, price sheets),
// the platform extracts STRUCTURED BUSINESS FACTS, and those facts become
// evidence through the knowledge provider. No AI, no summaries, no review of
// the document, no customer-facing content — regex-class parsing only, so
// extraction is testable, explainable, and identical on every run.

export interface ExtractedItem { name: string; price_text: string }
export interface ExtractedKnowledge {
  items: ExtractedItem[];        // "Rye Gnocchi ..... $24"-style lines
  phones: string[];              // distinct, normalized as printed
  emails: string[];
  urls: string[];
  hours_lines: string[];         // lines that look like opening hours
  line_count: number;
}

const PRICE_RE = /(\$\s?\d{1,4}(?:\.\d{2})?|\d{1,4}\.\d{2}\s*(?:dollars)?|\d{1,3}\s*dollars)/;
const PHONE_RE = /\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}/g;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const URL_RE = /https?:\/\/[^\s"'<>]+/gi;
const DAY_RE = /\b(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|daily|weekdays|weekends)\b/i;
const TIME_RE = /\b\d{1,2}(:\d{2})?\s*(am|pm)\b|\b\d{1,2}:\d{2}\b/i;

/** One pass, line-oriented, deterministic. 50k character cap enforced upstream. */
export function extractKnowledge(text: string): ExtractedKnowledge {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const items: ExtractedItem[] = [];
  const hours_lines: string[] = [];
  for (const line of lines) {
    if (line.length > 200) continue;                       // prose, not a menu line
    if (DAY_RE.test(line) && TIME_RE.test(line)) { hours_lines.push(line.slice(0, 120)); continue; }
    const m = line.match(PRICE_RE);
    if (m && m.index !== undefined) {
      const name = line.slice(0, m.index).replace(/[.·•\-_…]+\s*$/, '').trim();
      // a real item name: 2-60 chars, starts with a letter, not a sentence
      if (name.length >= 2 && name.length <= 60 && /^[A-Za-z"“'']/.test(name) && !/[.!?]$/.test(name)) {
        items.push({ name, price_text: m[1].replace(/\s+/g, '') });
      }
    }
  }
  const uniq = (a: string[]) => [...new Set(a)];
  return {
    items: items.slice(0, 120),
    phones: uniq((text.match(PHONE_RE) || []).map((p) => p.trim())).slice(0, 5),
    emails: uniq((text.match(EMAIL_RE) || []).map((e) => e.toLowerCase())).slice(0, 5),
    urls: uniq(text.match(URL_RE) || []).slice(0, 10),
    hours_lines: hours_lines.slice(0, 10),
    line_count: lines.length,
  };
}

/* comparison helpers used by the knowledge provider (pure) */
export const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
export const normPrice = (s: string) => {
  const m = (s || '').match(/(\d{1,4}(?:\.\d{2})?)/);
  return m ? String(Number(m[1])) : '';
};
export const digitsOnly = (s: string) => (s || '').replace(/\D/g, '');
