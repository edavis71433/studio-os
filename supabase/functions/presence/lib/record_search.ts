// ── ⌘K search across everything a studio keeps (sales item 84, Nov 2026) ────
// The search knew contacts by name, email and company, deals by title, projects,
// customers and invoices. A missed call's number, a line in a note, an enquiry,
// a proposal, a to-do, a client's website or domain and a message found nothing.
// The route (routes/crm.ts handleCrmSearch) reads each place; these pure helpers
// shape the query and the answer: the groups and their order, a phone number
// matched by its digits whatever its format, and a short piece of the text
// around a match so a note or a message says why it was found.

/** The groups results come in, in the order the palette shows them. */
export const SEARCH_GROUPS = ['people', 'websites', 'enquiries', 'deals', 'money', 'projects', 'todos', 'messages', 'notes', 'actions'] as const;
export type SearchGroup = typeof SEARCH_GROUPS[number];
/** What each group is called above its results. */
export const SEARCH_GROUP_LABEL: Record<SearchGroup, string> = {
  people: 'People', websites: 'Websites', enquiries: 'Enquiries', deals: 'Deals and documents', money: 'Money',
  projects: 'Projects', todos: 'To-dos', messages: 'Messages', notes: 'Notes', actions: 'Actions',
};
/** The most results a group shows; the palette stays one screen tall. */
export const SEARCH_GROUP_CAP: Record<SearchGroup, number> = {
  people: 6, websites: 4, enquiries: 4, deals: 5, money: 5, projects: 4, todos: 4, messages: 4, notes: 4, actions: 4,
};

/** One result: what it is, its group, the line and the quieter line beside it, where it
 *  opens; `snippet` is the words found inside it (an enquiry's message), and `alt` a
 *  second place it opens (a website row's live site). */
export interface SearchResult { kind: string; group: SearchGroup; label: string; sub: string; href: string; snippet?: string; alt?: { label: string; href: string } }

/** The words searched for: PostgREST's filter grammar and the any-run wildcards
 *  are taken out (they would change the question), spaces squeezed, 60 at most.
 *  An underscore stays: as a one-letter wildcard it still finds jane_doe@. */
export function cleanSearch(raw: unknown): string {
  return String(raw ?? '').replace(/[(),*"\\%]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

export const digitsOf = (s: unknown): string => String(s ?? '').replace(/\D/g, '');

/** The digits to look for when the words are a phone number or a piece of one
 *  ("(555) 010-4410", "010 4410", "5550104410"): four digits or more and nothing
 *  but digits and the marks numbers are written with. '' otherwise. */
export function phoneDigits(q: string): string {
  const s = String(q || '').trim();
  if (!/^[\d\s().+\-]+$/.test(s)) return '';
  const d = digitsOf(s);
  return d.length >= 4 ? d.slice(0, 15) : '';
}

/** An invoice asked for by its number (sales item 120, code pass finding 55). A client
 *  calls about "invoice #0013": "#0013", "#13", "0013", "invoice 13", "inv #0013" and
 *  "invoice no. 13" all mean invoice 13, and none of them is an amount ("0013" was read
 *  as $13.00). Plain digits ("13") might be either, so `only` is false and the caller
 *  looks for the amount too. null when the words aren't a number. */
export function invoiceNumberQuery(q: string): { number: number; only: boolean } | null {
  const s = String(q || '').trim().toLowerCase();
  const said = /^(?:inv|invoice)\.?\s*(?:no\.?|number|#)?\s*#?\s*(\d{1,9})$/.exec(s) || /^#\s*(\d{1,9})$/.exec(s);
  const zero = said ? null : /^(0\d{0,8})$/.exec(s);
  const plain = said || zero ? null : /^(\d{1,7})$/.exec(s);
  const m = said || zero || plain;
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? { number: n, only: !plain } : null;
}

/** A loose ilike pattern for those digits in a stored number, whatever is
 *  written between them ("5*5*5*0*1*0" finds "(555) 010-…"). The route checks
 *  each hit again by its digits, so a number whose digits only happen to come
 *  in that order with others between is dropped. */
export function phonePattern(digits: string): string {
  return '*' + digitsOf(digits).split('').join('*') + '*';
}

/** Does a stored number hold these digits in a row? */
export function phoneHas(stored: unknown, digits: string): boolean {
  const d = digitsOf(digits);
  return !!d && digitsOf(stored).includes(d);
}

/** A piece of `text` around the first place `q` is found, about `max` long, on
 *  one line, with … where it was cut. The start of the text when `q` isn't in it. */
export function snippet(text: unknown, q: string, max = 90): string {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const at = q ? t.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (at < 0) return t.slice(0, max - 1).trimEnd() + '…';
  const room = Math.max(0, max - q.length);
  let from = Math.max(0, at - Math.floor(room / 3));
  let to = Math.min(t.length, from + max);
  if (to - from < max) from = Math.max(0, to - max);
  return (from > 0 ? '…' : '') + t.slice(from, to).trim() + (to < t.length ? '…' : '');
}

/** Results in group order, each group at most its cap, each result once (a
 *  contact found by name and by phone shows once; a deal and its proposal, which
 *  open the same page, are two results). */
export function arrangeResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>(), out: SearchResult[] = [];
  for (const g of SEARCH_GROUPS) {
    let n = 0;
    for (const r of results) {
      if (r.group !== g || n >= SEARCH_GROUP_CAP[g]) continue;
      const key = r.kind + '|' + r.href + '|' + r.label;
      if (seen.has(key)) continue;
      seen.add(key); out.push(r); n++;
    }
  }
  return out;
}

/** A short date for a result's second line ("Nov 3"), on the UTC day. '' for nothing usable. */
export function shortDate(iso: unknown): string {
  const t = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
