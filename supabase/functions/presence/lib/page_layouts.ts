// ── Ready-made pages, grouped by what the page is for (builder list item 216) ──
// Squarespace's Add a Page shows a big picture of every ready-made page, grouped
// Introduce, Sell and Showcase (Nov 12 review, file 01, finding 3). Studio OS had home
// layouts by industry (lib/starter_layouts.ts) and nothing grouped by purpose. Here are
// the pages a small business adds most, each a short set of sections with guiding words
// to replace, and the twelve home layouts as the Home pages group.
//
// Every page is a plain `blocks` list, saved through the same path as any page
// (PUT /settings → validateBlocks at publish), so nothing here can draw anything the
// sections can't. They are text-first: what the owner sees on arrival is words to
// replace, never invented facts. The only sections that wait for something are the photo
// ones (a gallery, before and after), which arrive empty for the owner's own photos, and
// the reviews wall, which draws the site's own approved reviews and nothing else.
//
// Each page has a picture (thumbs/pages/<key>.jpg), made by scripts/thumbnails like the
// section and template pictures; tests/presence/page_layouts_test.mjs checks every page
// validates, has a picture, and that its address never lands on a built-in page.
//
// Pure: no I/O, no clock, no randomness.
import type { StoredBlock } from './site_blocks.ts';
import { STARTER_LAYOUTS } from './starter_layouts.ts';

/** The four groups, in the order Add a page shows them. */
export type PagePurpose = 'introduce' | 'sell' | 'show' | 'home';
export const PAGE_PURPOSES: readonly PagePurpose[] = ['introduce', 'sell', 'show', 'home'];
export const PAGE_GROUPS: ReadonlyArray<{ key: PagePurpose; name: string; line: string }> = [
  { key: 'introduce', name: 'Introduce', line: 'Pages that tell people who you are.' },
  { key: 'sell', name: 'Sell', line: 'Pages that turn visitors into customers.' },
  { key: 'show', name: 'Show', line: 'Pages that prove you are good at what you do.' },
  { key: 'home', name: 'Home pages', line: 'Whole front pages, laid out for a kind of business.' },
];

export interface ReadyPage {
  /** stable key; also the picture's file name (thumbs/pages/<key>.jpg) */
  key: string;
  /** the card's name in Add a page */
  name: string;
  /** one line under the card */
  description: string;
  group: PagePurpose;
  /** the new page's name until the owner types one */
  title: string;
  /** its address until the owner types a name: never a template's built-in page */
  slug: string;
  blocks: StoredBlock[];
}

const cta = (text: string): StoredBlock => ({ type: 'cta', text });

const PURPOSE_PAGES: ReadyPage[] = [
  // ── Introduce ──
  {
    key: 'about_us', name: 'About us', group: 'introduce', title: 'About us', slug: 'about-us',
    description: 'Your story, what you believe in and the people behind it.',
    blocks: [
      { type: 'title', title: 'About us', subtitle: 'One line on who you are and who you help.' },
      { type: 'image_text', title: 'Our story', side: 'right', body: 'How you started, what drives you and what has changed since. Two or three short paragraphs are plenty. Add a photo of you or your place.' },
      { type: 'features', title: 'What we believe', items: [
        { title: 'Something you care about', text: 'Say it plainly, in a line.' },
        { title: 'A promise you keep', text: 'What customers can count on every time.' },
        { title: 'What makes you different', text: 'Something true that others can’t say.' },
      ] },
      { type: 'stats', title: 'In numbers', items: [
        { value: '10+', label: 'Years doing this' },
        { value: '500+', label: 'Happy customers' },
        { value: '1', label: 'Place, run by people who care' },
      ] },
      cta('Want to work with us? Add the best way to reach you.'),
    ],
  },
  {
    key: 'contact', name: 'Contact', group: 'introduce', title: 'Get in touch', slug: 'get-in-touch',
    description: 'A message form, with where to find you and when.',
    blocks: [
      { type: 'title', title: 'Get in touch', subtitle: 'We usually reply within a day.' },
      { type: 'form', id: 'get_in_touch', title: 'Send us a message', fields: [
        { key: 'name', label: 'Your name', type: 'text', required: true },
        { key: 'email', label: 'Email', type: 'email', required: true },
        { key: 'phone', label: 'Phone', type: 'phone' },
        { key: 'message', label: 'Message', type: 'textarea', required: true },
      ] },
      { type: 'accordion', title: 'Good to know', items: [
        { summary: 'Where to find us', body: 'Add your address, and a word on parking or the nearest stop.' },
        { summary: 'When we are open', body: 'Add the days and times you are open.' },
        { summary: 'Other ways to reach us', body: 'Add your phone number and email address.' },
      ] },
    ] as unknown as StoredBlock[],
  },
  {
    key: 'meet_the_team', name: 'Meet the team', group: 'introduce', title: 'Meet the team', slug: 'meet-the-team',
    description: 'The people customers will meet, each with a photo and a line.',
    blocks: [
      { type: 'title', title: 'Meet the team', subtitle: 'The people you will meet when you come in.' },
      { type: 'team', title: 'Our people', members: [
        { name: 'A name', role: 'What they do', bio: 'A line about them. Add a photo too.' },
        { name: 'Another name', role: 'What they do', bio: 'Something they love about the work.' },
        { name: 'One more', role: 'What they do', bio: 'How long they have been with you.' },
      ] },
      { type: 'richtext', title: 'Join us', body: 'Hiring now and then? Say what you look for and how to get in touch.' },
    ],
  },
  {
    key: 'questions', name: 'Questions', group: 'introduce', title: 'Questions', slug: 'questions',
    description: 'Quick answers to what people ask most, in groups.',
    blocks: [
      { type: 'title', title: 'Questions and answers', subtitle: 'Quick answers to what people ask most.' },
      { type: 'accordion', title: 'Before you come', items: [
        { summary: 'Do I need to book?', body: 'Say whether people should book ahead or just come in.' },
        { summary: 'Where do I park?', body: 'Add parking, or the nearest stop.' },
        { summary: 'How long does it take?', body: 'Give a rough time so people can plan.' },
      ] },
      { type: 'accordion', title: 'Prices and paying', items: [
        { summary: 'How much does it cost?', body: 'Give a starting price, or say how you quote.' },
        { summary: 'How can I pay?', body: 'List the ways you take payment.' },
        { summary: 'Can I change or cancel?', body: 'Say how much notice you need.' },
      ] },
      cta('Still wondering? Add the best way to ask you directly.'),
    ],
  },
  // ── Sell ──
  {
    key: 'services', name: 'Services', group: 'sell', title: 'Services', slug: 'our-services',
    description: 'What you offer, each with a price and a way to book.',
    blocks: [
      { type: 'title', title: 'Our services', subtitle: 'What we do, and what it costs.' },
      { type: 'cards', id: 'services', title: 'What we offer', cards: [
        { heading: 'Your first service', text: 'Describe it in one clear line.' },
        { heading: 'Your second service', text: 'Who it is for and what they get.' },
        { heading: 'Your third service', text: 'Add a photo to each one later.' },
      ] },
      { type: 'pricing', title: 'Prices', tiers: [
        { name: 'Basic', price_text: '$—', features: ['What is included', 'A second line', 'A third line'] },
        { name: 'Most popular', price_text: '$—', features: ['The best value', 'What makes it worth it', 'Keep each line short'] },
        { name: 'Everything', price_text: '$—', features: ['For people who want it all', 'A second line', 'A third line'] },
      ] },
      { type: 'process', title: 'How it works', steps: [
        { step: 'Get in touch', detail: 'A call, a message or a booking.' },
        { step: 'We agree the plan', detail: 'What happens next, in a sentence.' },
        { step: 'We do the work', detail: 'The result people walk away with.' },
      ] },
      cta('Ready to book? Add your booking link or phone number.'),
    ],
  },
  {
    key: 'prices', name: 'Prices', group: 'sell', title: 'Prices', slug: 'prices',
    description: 'Your prices as a clean list, or as three plans side by side.',
    blocks: [
      { type: 'title', title: 'Prices', subtitle: 'Clear prices, no surprises.' },
      { type: 'pricing', title: 'Plans', tiers: [
        { name: 'Small', price_text: '$—', features: ['What is included', 'A second line'] },
        { name: 'Medium', price_text: '$—', features: ['What is included', 'A second line'] },
        { name: 'Large', price_text: '$—', features: ['What is included', 'A second line'] },
      ] },
      { type: 'pricing', title: 'Everything else', variant: 'list', tiers: [
        { name: 'One thing you charge for', price_text: '$—', features: ['A word on what it is'] },
        { name: 'Another', price_text: '$—', features: ['A word on what it is'] },
        { name: 'One more', price_text: '$—', features: ['A word on what it is'] },
      ] },
      { type: 'accordion', title: 'About paying', items: [
        { summary: 'How can I pay?', body: 'List the ways you take payment.' },
        { summary: 'Do prices change?', body: 'Say when prices were last set, or how you quote.' },
      ] },
    ],
  },
  {
    key: 'menu', name: 'Menu', group: 'sell', title: 'Menu', slug: 'our-menu',
    description: 'Dishes and prices course by course, with the specials on top.',
    blocks: [
      { type: 'title', title: 'Our menu', subtitle: 'Ask us about allergies and anything made without.' },
      { type: 'pricing', title: 'To start', variant: 'list', tiers: [
        { name: 'A small plate', price_text: '$—', features: ['What is in it'] },
        { name: 'Another small plate', price_text: '$—', features: ['What is in it'] },
        { name: 'One more', price_text: '$—', features: ['What is in it'] },
      ] },
      { type: 'pricing', title: 'Mains', variant: 'list', tiers: [
        { name: 'A main dish', price_text: '$—', features: ['What is in it'] },
        { name: 'Another main', price_text: '$—', features: ['What is in it'] },
        { name: 'A third main', price_text: '$—', features: ['What is in it'] },
        { name: 'One for everyone', price_text: '$—', features: ['What is in it'] },
      ] },
      { type: 'pricing', title: 'Something sweet', variant: 'list', tiers: [
        { name: 'A dessert', price_text: '$—', features: ['What is in it'] },
        { name: 'Another dessert', price_text: '$—', features: ['What is in it'] },
      ] },
      cta('Want a table? Add your booking link or phone number.'),
    ],
  },
  {
    key: 'book_a_visit', name: 'Book a visit', group: 'sell', title: 'Book a visit', slug: 'book-a-visit',
    description: 'Times people can book, with your services beside them.',
    blocks: [
      { type: 'title', title: 'Book a visit', subtitle: 'Pick a time that suits you.' },
      { type: 'booking', title: 'Choose a time', intro: 'Pick a service, then a time. We confirm by email.' },
      { type: 'cards', id: 'bookable', title: 'What you can book', cards: [
        { heading: 'A service', text: 'How long it takes, and the price.' },
        { heading: 'Another service', text: 'How long it takes, and the price.' },
        { heading: 'One more', text: 'How long it takes, and the price.' },
      ] },
      { type: 'accordion', title: 'Before you come', items: [
        { summary: 'Changing or cancelling', body: 'Say how much notice you need.' },
        { summary: 'Running late', body: 'Say what happens if someone is late.' },
      ] },
    ],
  },
  // ── Show ──
  {
    key: 'gallery', name: 'Gallery', group: 'show', title: 'Gallery', slug: 'gallery',
    description: 'Your best photos in a grid, a mosaic or a strip.',
    blocks: [
      { type: 'title', title: 'Our work', subtitle: 'A few things we are proud of.' },
      { type: 'gallery', title: 'Recent work', image_ids: [] },
      { type: 'richtext', title: 'About the work', body: 'A line or two on what people are looking at, and what you could make for them.' },
      cta('Like what you see? Add the best way to ask about your own.'),
    ],
  },
  {
    key: 'reviews', name: 'Reviews', group: 'show', title: 'Reviews', slug: 'reviews',
    description: 'What customers say, with your star rating on top.',
    blocks: [
      { type: 'title', title: 'Kind words', subtitle: 'What customers say about us.' },
      { type: 'reviews_wall', title: 'Reviews', max: 12 },
      { type: 'richtext', title: 'Been to see us?', body: 'We would love to hear how it went. Add a link to where people can leave a review.' },
    ],
  },
  {
    key: 'whats_on', name: 'Events', group: 'show', title: 'Events', slug: 'events',
    description: 'What is coming up, with dates people can scan.',
    blocks: [
      { type: 'title', title: 'What’s on', subtitle: 'Dates for your diary.' },
      { type: 'events', title: 'Coming up', items: [
        { name: 'Your first event', date: 'Add a date', time: 'Add a time', detail: 'What happens, and who it is for.' },
        { name: 'Another event', date: 'Add a date', detail: 'What happens, and who it is for.' },
        { name: 'One more', date: 'Add a date', detail: 'What happens, and who it is for.' },
      ] },
      { type: 'richtext', title: 'Private events', body: 'Hosting something of your own? Say what you can do and how to ask.' },
      cta('Want to come? Add your booking link or phone number.'),
    ],
  },
  {
    key: 'before_and_after', name: 'Before and after', group: 'show', title: 'Before and after', slug: 'before-and-after',
    description: 'Jobs side by side, before you started and after you finished.',
    blocks: [
      { type: 'title', title: 'Before and after', subtitle: 'See the difference.' },
      { type: 'before_after', title: 'Recent jobs', items: [] },
      { type: 'process', title: 'How we work', steps: [
        { step: 'We take a look', detail: 'What you check before you start.' },
        { step: 'We do the job', detail: 'How long it usually takes.' },
        { step: 'We tidy up', detail: 'What it looks like when you leave.' },
      ] },
      cta('Want the same for yours? Add the best way to ask for a quote.'),
    ],
  },
];

/** The twelve home layouts, as the Home pages group. A new page made from one is called
 *  "Welcome" until the owner names it (its address can't be "home"). */
const HOME_PAGES: ReadyPage[] = STARTER_LAYOUTS.map((l) => ({
  key: l.key, name: l.name, description: l.description, group: 'home' as const,
  title: 'Welcome', slug: 'welcome', blocks: l.blocks,
}));

/** Every ready-made page, purpose groups first, then the Home pages. Pure. */
export function listReadyPages(): ReadyPage[] {
  return [...PURPOSE_PAGES, ...HOME_PAGES];
}

/** The sections that wait for the owner's own photos: a ready-made page brings them empty. */
export const PHOTO_SECTIONS: ReadonlySet<string> = new Set(['gallery', 'before_after', 'carousel', 'partners']);

/** A purpose as stored, or null. Pure. */
export function purposeOf(raw: unknown): PagePurpose | null {
  const v = String(raw ?? '').trim().toLowerCase();
  return (PAGE_PURPOSES as readonly string[]).includes(v) ? v as PagePurpose : null;
}
