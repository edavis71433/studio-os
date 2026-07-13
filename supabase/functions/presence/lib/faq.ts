// ── Customer FAQ (mini knowledge base) — studio-written, no new table ────────
// A small Q&A the studio writes once and the client portal shows, to deflect
// repeat questions. Stored as JSON on the site (presence_settings.customer_faq)
// like form definitions live inside presence_settings — NO new table. Answers are
// written in the SAME sanitizing markdown the rest of the CMS trusts (esc-first,
// allowlisted output), so a FAQ answer can never inject markup into the portal.
// Pure: normalize (validate/cap) + render (escape/markdown). No I/O, no clock.
import { esc, renderMarkdown } from './markdown.ts';

export interface FaqItem { q: string; a: string; }
export interface Faq { intro?: string; items: FaqItem[]; }

const MAX_ITEMS = 40;
const CAP = { intro: 500, q: 200, a: 4000 };
// collapse to a single clean line (control chars via codepoint, matching markdown.ts)
function line(x: unknown, n: number): string {
  let out = '';
  for (const ch of String(x ?? '')) { const c = ch.codePointAt(0)!; out += (c >= 32 && c !== 127) ? ch : ' '; }
  return out.replace(/\s+/g, ' ').trim().slice(0, n);
}
// keep line breaks (markdown will sanitize the rest)
function block(x: unknown, n: number): string {
  let out = '';
  for (const ch of String(x ?? '')) { const c = ch.codePointAt(0)!; if (c === 10 || c >= 32) out += ch; }
  return out.trim().slice(0, n);
}

/** Validate + normalize the FAQ. Caps the item count and field lengths, drops
 *  items missing a question or an answer. Returns a clean FAQ or a plain-language
 *  error. Pure. */
export function normalizeFaq(raw: unknown):
  { ok: true; faq: Faq } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'A FAQ needs at least one question.' };
  const r = raw as any;
  const rawItems = Array.isArray(r.items) ? r.items : (Array.isArray(r) ? r : null);
  if (!rawItems) return { ok: false, error: 'A FAQ needs a list of questions.' };
  if (rawItems.length > MAX_ITEMS) return { ok: false, error: `A FAQ can have at most ${MAX_ITEMS} questions.` };
  const items: FaqItem[] = [];
  for (const it of rawItems) {
    const q = line(it?.q ?? it?.question, CAP.q);
    const a = block(it?.a ?? it?.answer, CAP.a);
    if (!q || !a) continue;                 // silently drop an incomplete pair
    items.push({ q, a });
  }
  if (!items.length) return { ok: false, error: 'Each question needs both a question and an answer.' };
  const faq: Faq = { items };
  const intro = line(r.intro, CAP.intro); if (intro) faq.intro = intro;
  return { ok: true, faq };
}

/** Render the FAQ as accessible, XSS-safe HTML for the client portal. Questions
 *  are escaped; answers go through the sanitizing markdown pipeline (esc-first,
 *  allowlisted elements, https/mailto/tel links only). Uses native <details> so
 *  it works with zero script. Pure. Returns '' when empty. */
export function renderFaq(faq: Faq | null | undefined): string {
  const items = faq?.items || [];
  if (!items.length) return '';
  const intro = faq?.intro ? `<p class="faq-intro">${esc(faq.intro)}</p>` : '';
  const rows = items.map((it) =>
    `<details class="faq-item"><summary>${esc(it.q)}</summary><div class="faq-answer">${renderMarkdown(it.a)}</div></details>`).join('');
  return `<section class="faq">${intro}${rows}</section>`;
}
