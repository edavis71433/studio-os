// ── Every template's full sample (list item 110) ─────────────────────────────────
// A template's fixture.json is its sample business with the built-in pages only. The full
// sample adds what a real site carries: one of every section the builder offers (the
// picker's own samples, scripts/thumbnails/samples.ts), a form, a free layout and a Blocks
// section (item 57), some on
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

// Builder item 57: a Blocks section with every kind of block. Its picker sample joins
// scripts/thumbnails/samples.ts with the editor half, which offers the section.
const STACK = { type: 'stack', items: [
  { kind: 'heading', text: 'Built from blocks' },
  { kind: 'text', body: 'A heading, words, a photo and buttons, **stacked** in reading order.' },
  { kind: 'image', image_id: '00000000-0000-4000-8000-0000000000f2', caption: 'A photo with its caption' },
  { kind: 'button', buttons: [{ label: 'Book a visit', url: 'https://example.com/book' }, { label: 'Our hours', url: '/contact/#hours', style: 'outline' }] },
  { kind: 'heading', text: 'A smaller heading', size: 'm' },
  { kind: 'video', url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', poster_id: '00000000-0000-4000-8000-0000000000f3', caption: 'A minute in the shop' },
  { kind: 'spacer', size: 's' },
  { kind: 'divider', width: 's' },
  { kind: 'form', form: { ...FORM, id: 'blocks_form' } },
  { kind: 'map', address: '12 Olive Ave, Burbank', image_id: '00000000-0000-4000-8000-0000000000f4' },
] };

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
  return [all.filter(([t]) => HOME_TYPES.includes(t)).map(([, b]) => b), [...all.filter(([t]) => !HOME_TYPES.includes(t)).map(([, b]) => b), FORM, FREE, STACK]];
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
  // Builder list item 40: a post with a category, an author with a photo and a photo in its
  // text, and a second post in another category, so the list, the category pages, the byline,
  // the figure and the author's line are all drawn.
  const [first] = fx.content.posts || [];
  if (first) {
    const PIC = '00000000-0000-4000-8000-0000000000a8';
    fx.content.posts = [
      { ...first, category: { id: 'news', name: words('News') },
        author: { id: 'maria-lopez', name: words('Maria Lopez'), bio: words('Owner and head chef'), photo: ref('00000000-0000-4000-8000-0000000000a7') },
        body_md: `${first.body_md}\n\n![${words('The room on a quiet night')}](media:${PIC} "${words('Before the doors open')}")\n\n${words('See you soon.')}`,
        images: { [PIC]: ref(PIC) } },
      { id: 'p2', title: words('Wine dinner on the patio'), slug: 'wine-dinner', body_md: words('Five courses, five wines, one long table.'), excerpt: '', published_at: '2026-02-02T18:00:00Z',
        category: { id: 'events', name: words('Events') }, author: { id: 'sam-ortiz', name: words('Sam Ortiz') } },
    ];
  }
  // Builder list item 127: a short description, and a second place with a name and its own
  // week, so the footer, the Contact page and what Google reads all carry it. Plain words:
  // render_test's hostile run draws the business details from the template's own sample,
  // and business_details_127_test.mjs feeds hostile words through these.
  const [main] = fx.content.locations || [];
  if (main) {
    fx.content.identity = { ...fx.content.identity, short_description: 'What we do, where we do it, and what we are known for, in one line.' };
    fx.content.locations = [main, {
      ...main, label: 'Glendale', address_line1: '410 Brand Blvd', address_line2: '', city: 'Glendale', postal_code: '91203', phone: '(555) 010-0199',
      hours: (main.hours || []).map((d) => (d.day === 'mon' ? { day: 'mon', closed: true, intervals: [] } : d)), holiday_exceptions: [] }];
  }
  return fx;
}
