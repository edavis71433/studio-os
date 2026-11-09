// ── Picker pictures: the pages to photograph (list item 25) ─────────────────────
// Pure: builds each template's sample home page and one page per section type, as file
// maps, with soft placeholder pictures where photos go. render.ts writes them to disk
// for shoot.mjs; tests/presence/thumbnails_test.mjs checks every section draws, and
// that each picture was shot from the page as it draws today (pictureSources).
import { renderSnapshot, listTemplates } from '../../supabase/functions/presence/lib/render.ts';
import { composeBlocks } from '../../supabase/functions/presence/lib/serializer.ts';
import type { Snapshot, FileMap } from '../../supabase/functions/presence/lib/render_types.ts';
import { SAMPLE_BLOCKS, FILE_ID } from './samples.ts';

const ROOT = new URL('../../', import.meta.url);
const SITE = { baseUrl: 'https://example.com' };
export const TEMPLATES = listTemplates().map((t) => t.slug);

// Soft placeholder "photos": a muted gradient with a sun and a hill, in a few hues.
const HUES = [[24, 42], [168, 30], [210, 34], [280, 22], [40, 30], [140, 26]];
function placeholder(i: number, w = 1600, h = 1067): string {
  const [hue, sat] = HUES[i % HUES.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue},${sat}%,82%)"/><stop offset="1" stop-color="hsl(${hue},${sat}%,64%)"/></linearGradient></defs>`
    + `<rect width="100%" height="100%" fill="url(#g)"/><circle cx="${w * 0.72}" cy="${h * 0.32}" r="${h * 0.11}" fill="hsl(${hue},${sat}%,90%)"/>`
    + `<path d="M0 ${h * 0.78} Q${w * 0.3} ${h * 0.52} ${w * 0.55} ${h * 0.72} T${w} ${h * 0.66} V${h} H0Z" fill="hsl(${hue},${sat}%,52%)"/></svg>`;
}
export const media = new Map<string, number>();
function ref(id: string) {
  if (id === FILE_ID) return { alt: 'Price list', variants: {}, original: '/ph/price-list.pdf' };
  if (!media.has(id)) media.set(id, media.size);
  const n = media.get(id)!, p = `/ph/${n}.svg`;
  return { alt: 'A placeholder photo', variants: { w400: p, w800: p, w1600: p }, width: 1600, height: 1067 };
}
const fixture = (slug: string) => {
  const fx = JSON.parse(Deno.readTextFileSync(new URL(`supabase/functions/presence/templates/${slug}/1.0.0/fixture.json`, ROOT)));
  // every photo in the sample site becomes a placeholder
  const swap = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(swap);
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (o.variants && typeof o.variants === 'object') return { ...o, variants: ref('fx-' + JSON.stringify(o.variants).length + '-' + String(o.alt || '')).variants };
      return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, swap(x)]));
    }
    return v;
  };
  return swap(fx) as Snapshot;
};

const reviews = { items: [
  { author: 'Jordan P.', rating: 5, body: 'On time, tidy, and fairly priced. We will call them again.' },
  { author: 'Priya S.', rating: 5, body: 'They explained everything before starting. No surprises.' },
  { author: 'Luis M.', rating: 5, body: 'Fixed in an hour, and they cleaned up after.' }],
  aggregate: { count: 128, average: 4.9 } };
// Each type on its own page (a page holds at most 32 sections). A contents list needs
// headings after it to list, so it gets some company; the picture starts at the first section.
// Each type on its own page (a page holds at most 32 sections). A contents list needs
// headings after it to list, so it gets some company; the picture starts at the first section.
// A divider alone is a line on an empty page, so it gets text after it to divide.
const COMPANY: Record<string, string[]> = { toc: ['title', 'features', 'process'], divider: ['richtext', 'features'] };

/** Each template's sample site. */
export async function templatePages(): Promise<Record<string, FileMap>> {
  const out: Record<string, FileMap> = {};
  for (const slug of TEMPLATES) out[slug] = await renderSnapshot(fixture(slug), SITE);
  return out;
}
/** One page per section type, on Business Classic with the built-in sections hidden. */
export async function sectionPages(): Promise<Record<string, FileMap>> {
  const out: Record<string, FileMap> = {};
  for (const [type, sample] of Object.entries(SAMPLE_BLOCKS)) {
    const page = fixture('business-classic');
    const raw = [sample, ...(COMPANY[type] || []).map((t) => SAMPLE_BLOCKS[t])];
    const composed = composeBlocks(raw, () => null, ref as never, { reviewsWall: reviews as never });
    page.content.settings = {
      ...(page.content.settings || {}),
      blocks: composed.blocks, blocks_src: composed.src,
      sections: { hidden: ['hero', 'about', 'offerings', 'testimonials', 'faqs'], order: [] },
    } as never;
    out[type] = await renderSnapshot(page, SITE);
  }
  return out;
}
/** Whether a section page drew its section. */
export const drew = (type: string, files: FileMap) => new RegExp(` data-dds-key="block_${type}`).test(String(files['index.html']));
/** The placeholder pictures a page set refers to. */
export function placeholderFiles(): Record<string, string> {
  const ph: Record<string, string> = {};
  for (const n of media.values()) ph[`ph/${n}.svg`] = placeholder(n);
  return { ...ph, 'ph/price-list.pdf': '%PDF-1.4\n' };
}

/** Every page set, in the one order that numbers the placeholders the same way each time. */
export async function allPages() {
  media.clear();
  const templates = await templatePages(), sections = await sectionPages();
  return { templates, sections, ph: placeholderFiles() };
}

/** What each picture shows, as a digest: its page, the stylesheet and the placeholders the
 *  page loads. shoot.mjs records it beside the picture; the test compares it with today's. */
export async function pictureSources(): Promise<Record<string, string>> {
  const { templates, sections, ph } = await allPages();
  const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const shown = async (files: FileMap) => {
    const page = String(files['index.html']);
    const used = Object.keys(files).filter((k) => k.startsWith('assets/')).sort().map((k) => [k, String(files[k])]);
    for (const n of new Set([...page.matchAll(/\/ph\/(\d+)\.svg/g)].map((m) => m[1]))) used.push([`ph/${n}.svg`, ph[`ph/${n}.svg`]]);
    return sha(JSON.stringify([['index.html', page], ...used]));
  };
  const out: Record<string, string> = {};
  for (const [slug, files] of Object.entries(templates)) out[`templates/${slug}.jpg`] = await shown(files);
  for (const [type, files] of Object.entries(sections)) out[`sections/${type}.jpg`] = await shown(files);
  return out;
}
