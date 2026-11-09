// ── Every template's full sample (list item 110) ─────────────────────────────────
// A template's fixture.json is its sample business with the built-in pages only. The full
// sample adds what a real site carries: one of every section the builder offers (the
// picker's own samples, scripts/thumbnails/samples.ts), a form and a free layout, some on
// the home page and the rest on a page of the owner's own, and a menu with a dropdown.
// The sections go through the serializer's real step (composeBlocks), so they arrive as a
// publish draws them. render_test.mjs runs its structure checks on it and keeps its golden
// copy for every template; class_clash_test.mjs reads both sides' markup from it.
import { composeBlocks } from '../../supabase/functions/presence/lib/serializer.ts';
import { FORM_PRESETS } from '../../supabase/functions/presence/lib/forms.ts';
import { vocabFor } from '../../supabase/functions/presence/lib/industry_vocab.ts';
import { listTemplates } from '../../supabase/functions/presence/lib/render.ts';
import { SAMPLE_BLOCKS, FILE_ID } from '../../scripts/thumbnails/samples.ts';

const ROOT = new URL('../../', import.meta.url);
export const TEMPLATES = listTemplates().map((t) => t.slug);
/** A template's own sample, as committed. */
export const fixture = (slug) => JSON.parse(Deno.readTextFileSync(new URL(`supabase/functions/presence/templates/${slug}/1.0.0/fixture.json`, ROOT)));

// The sections a home page carries. Every other type (a new one too) goes on the owner's page.
export const HOME_TYPES = ['features', 'stats', 'team', 'process', 'pricing', 'certifications', 'service_areas', 'cta', 'gallery', 'before_after', 'reviews', 'reviews_wall', 'appointment', 'newsletter', 'social', 'map', 'buttons', 'spotlight'];
export const PAGE = { slug: 'our-work', title: 'Our work' };
const FORM = FORM_PRESETS[0].def;   // the contact form, as the builder adds it
const FREE = { type: 'freeform', id: 'free-layout', title: 'Placed by hand', aspect: 'banner', elements: [
  { id: 'words', kind: 'text', x: 6, y: 16, w: 46, h: 40, z: 1, text: { body: 'Words placed **anywhere** in the section', size: 'l' } },
  { id: 'photo', kind: 'image', x: 58, y: 10, w: 36, h: 80, z: 2, image: { image_id: '00000000-0000-4000-8000-0000000000f1' } },
  { id: 'go', kind: 'button', x: 6, y: 64, w: 26, h: 20, z: 3, button: { label: 'Book a visit', url: 'https://example.com/book', style: 'primary' } }] };

// Photos as a publish resolves them, three sizes under /img/; the price list as a file.
const ref = (id) => (id === FILE_ID
  ? { alt: 'Price list', variants: {}, original: '/files/price-list.pdf' }
  : { alt: 'A sample photo', variants: { w400: `/img/s${id.slice(-4)}-400.webp`, w800: `/img/s${id.slice(-4)}-800.webp`, w1600: `/img/s${id.slice(-4)}-1600.webp` }, width: 1600, height: 1067 });
const REVIEWS = { reviewsWall: { items: [
  { author: 'Jordan P.', rating: 5, body: 'On time, tidy, and fairly priced.', date: '2026-05-02' },
  { author: 'Priya S.', rating: 4, body: 'They explained everything before starting.', reply: 'Thank you, Priya.', date: '2026-04-11' }],
  aggregate: { count: 2, average: 4.5 } } };

/** The stored sections, as the builder saves them: [home page, the owner's page]. */
export function storedSections() {
  const all = Object.entries(SAMPLE_BLOCKS);
  return [all.filter(([t]) => HOME_TYPES.includes(t)).map(([, b]) => b), [...all.filter(([t]) => !HOME_TYPES.includes(t)).map(([, b]) => b), FORM, FREE]];
}

/** A template's sample with every section, a page of its own and a dropdown menu. `words`,
 *  when given, rewrites the owner's words (sections, page title, menu labels) before the
 *  serializer's step, the way render_test.mjs feeds hostile words through it. */
export function fullFixture(slug, words = (x) => x) {
  const fx = fixture(slug);
  const [home, page] = storedSections().map((list) => composeBlocks(words(structuredClone(list)), () => null, ref, REVIEWS));
  const v = vocabFor(fx.content.settings?.industry);
  const title = words(PAGE.title);
  fx.content.settings = {
    ...fx.content.settings,
    blocks: home.blocks, blocks_src: home.src,
    pages: [{ slug: PAGE.slug, title, blocks: page.blocks, blocks_src: page.src }],
    nav: [
      { label: words('Home'), href: '/' },
      { label: words(v.offeringLabel), href: v.offeringPath },
      { label: words('About'), href: '/about/', children: [{ label: title, href: `/${PAGE.slug}/` }, { label: words('Questions'), href: '/faq/' }] },
      { label: words('Updates'), href: '/updates/' },
      { label: words('Contact'), href: '/contact/' },
    ],
  };
  return fx;
}
