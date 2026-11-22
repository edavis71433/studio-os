// ── Item 275: sample words that can go live ──────────────────────────────────
// A new section arrives with short sample words so it draws at once (presence-edit.js
// emptyBlock): "Your heading", a price that is only a dash, a link to example.com. Until
// Nov 22 2026 the publish check said "Everything needed is in place" while such lines went
// live on a test site. This is the one list of those words, read by the publish check
// (lib/manifest_validate.ts: a warning for each section, never a block) and by the drawing
// (lib/site_blocks.ts: a section still carrying them is left out of what Google reads).
// Pure. The words here must match presence-edit.js emptyBlock exactly.
import type { SiteBlock, SnapshotContent } from './render_types.ts';

/** Whole sample lines, as the editor seeds them. Matched whole, after trimming. */
export const SAMPLE_LINES: readonly string[] = [
  // Only lines no owner would keep: the ones that tell the owner what to write, or stand in for
  // a thing ("A second strength"). A seeded line an owner might really mean ("Get in touch",
  // "Starter", "Happy customers") is left out, so a real site is never told it has sample words.
  'Your heading', 'Say a little more here: who you help and how.',
  'A little about this.', 'And a little about this.',
  'A highlight', 'A short line about it.', 'One more short line.',
  'Ready to get started? Add your phone, email or a booking link.',
  'Write your text here — tell visitors who you are and what you do, in a friendly sentence or two.',
  'Write the text that sits beside your image.',
  'Something worth highlighting', 'A sentence or two that draws the eye.',
  'A common question', 'Answer it here.',
  'What goes in the first tab.', 'And the second.',
  'A strength',
  'Your area', 'A nearby town',
  'What makes you great', 'Say it in a clear line.', 'A second strength', 'Keep it specific.', 'A third reason', 'Something true about you.',
  'The easy first step.', 'What happens next.', 'The outcome.',
  "What's included", 'A second line', 'The best value', 'Key benefits',
  'Your state',
  'An upcoming event', 'Add the details.',
  'A useful link', 'Another link',
];
const LINES = new Set(SAMPLE_LINES.map((x) => x.toLowerCase()));
/** A price that is only a dash, however it was typed. */
const DASH_PRICE = /^\$?\s*[-–—]+\s*$/;
/** A link that points at nobody: example.com, or a social page for "yourbusiness". */
const SAMPLE_LINK = /^https?:\/\/(?:www\.)?(?:example\.(?:com|org|net)(?:\/|$)|[a-z.]+\/yourbusiness\/?$)/i;

/** True when this one string is a sample line, a dash price or a sample link. Pure. */
export function isSampleText(x: unknown): boolean {
  if (typeof x !== 'string') return false;
  const t = x.trim();
  if (!t) return false;
  return LINES.has(t.toLowerCase()) || DASH_PRICE.test(t) || SAMPLE_LINK.test(t);
}

/** True when any string anywhere in this value (a block, a list, a row) is sample text. Pure. */
export function hasSampleWords(v: unknown, depth = 0): boolean {
  if (depth > 6 || v === null || v === undefined) return false;
  if (typeof v === 'string') return isSampleText(v);
  if (Array.isArray(v)) return v.some((x) => hasSampleWords(x, depth + 1));
  if (typeof v === 'object') return Object.entries(v as Record<string, unknown>).some(([k, x]) => k !== 'type' && k !== 'kind' && k !== 'id' && hasSampleWords(x, depth + 1));
  return false;
}

export interface SampleSection { page: string; pageTitle: string; index: number; title: string; type: string }

/** Every section on the home page and the owner's pages that still carries sample words, in
 *  page order: the page's slug ('' for home), the section's index in that page's list, its
 *  title or type. Pure. */
export function sampleSections(c: SnapshotContent): SampleSection[] {
  const settings = (c.settings || {}) as NonNullable<SnapshotContent['settings']>;
  const out: SampleSection[] = [];
  const walk = (page: string, pageTitle: string, blocks: SiteBlock[] | undefined) => {
    (blocks || []).forEach((b, index) => {
      if (!b || typeof b !== 'object' || b.type === 'toc' || b.type === 'divider') return;
      if (hasSampleWords(b)) out.push({ page, pageTitle, index, title: String((b as { title?: unknown }).title || '').trim(), type: b.type });
    });
  };
  walk('', 'Home', settings.blocks);
  for (const p of settings.pages || []) if (p && p.slug) walk(p.slug, p.title || p.slug, p.blocks);
  return out;
}

/** The publish check's warnings for those sections: one line that counts them, then one per
 *  section the editor can open (`field` is `blocks.<index>` for the home page and
 *  `page:<slug>.blocks.<index>` for the owner's pages, the shape its Fix button reads). Pure. */
export function sampleWordWarnings(c: SnapshotContent): Array<{ field: string; message: string; at?: { page: string; index: number } }> {
  const found = sampleSections(c);
  if (!found.length) return [];
  const out: Array<{ field: string; message: string; at?: { page: string; index: number } }> = [];
  out.push({ field: 'sample_words', message: found.length === 1 ? '1 section still has sample words. It can publish as it is, but visitors will read them.' : `${found.length} sections still have sample words. They can publish as they are, but visitors will read them.` });
  for (const f of found) {
    const name = f.title ? `“${f.title}”` : `The ${f.type.replace(/_/g, ' ')} section`;
    out.push({ field: f.page ? `page:${f.page}.blocks.${f.index}` : `blocks.${f.index}`, message: `${name} on ${f.page ? `the ${f.pageTitle} page` : 'your home page'} still has sample words.`, at: { page: f.page, index: f.index } });
  }
  return out;
}
