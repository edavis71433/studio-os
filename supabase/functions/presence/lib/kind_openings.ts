// ── Openings made for a kind of business (+ New site, Nov 22 2026) ──────────────────────────
// Eric picked three ways a new site can open for each of three kinds of business in Figma (file
// HSP7ScFSz2mg1xGzHRrEZi, section B, node 455:5, frames S1 to R3). An opening is one of the
// built-in designs, one of its front-page layouts (lib/template_openings.ts), one of the ready-made
// looks (lib/style_looks.ts) or the design's own new-site fonts, the name centred at the top for
// the centred editorial ones, for two of them a card on the photo, and for the two Type only ones
// the big words on the page itself, as drawn, rather than on Type only's band of colour:
//   Salon or spa, on Atelier: words on a colour panel in Blush (first), words over the photo in
//     Black & gold, centred editorial in Golden hour;
//   Home services, on Harbor: type only in Hard hat (first), words over the photo in Steady navy
//     with a form that asks for an estimate, the colour panel with the photo first in Night shift;
//   Restaurant or café, on Restaurant Classic: words over the photo in its own fonts with today's
//     hours and the booking button (first), centred editorial in Newsprint, type only in
//     Hand-lettered.
// + New site shows a kind's three before the designs, the first one picked (GET /agency/designs);
// POST /agency/sites takes the key and gives only the new site exactly these settings
// (agency/sites.ts applyKindOpening, through lib/template_openings.ts kindOpeningStart).
// thumbs/openings/<key>.jpg pictures each with its kind's sample business (scripts/thumbnails).
// The names are what the studio reads: plain words, no dashes for pauses. This file imports
// nothing, so a browser spec can.

/** A card on the welcome photo (lib/template_kit.ts heroCard): a form that asks for an estimate,
 *  or today's hours with the booking button. */
export type HeroCard = 'estimate' | 'today';
export const HERO_CARDS: readonly HeroCard[] = ['estimate', 'today'];

export interface KindOpening {
  /** What + New site sends. */
  key: string;
  /** The kind of business it is made for (lib/design_gallery.ts families). */
  family: 'beauty' | 'home' | 'food';
  /** The built-in design. */
  design: string;
  /** presence_settings.hero_layout. */
  layout: 'photo' | 'panel' | 'editorial' | 'type';
  /** A ready-made look's key, or '' for the design's own colours in its new-site fonts. */
  look: string;
  /** presence_settings.nav_style: the name centred at the top. */
  header: '' | 'centered';
  /** The style setting hero_card. */
  card: '' | HeroCard;
  /** The style setting hero_photo: the colour panel's photo on the left. */
  photo: '' | 'left';
  /** The style setting hero_band: Type only on the page itself, not on a band of colour. */
  band: '' | 'off';
  /** Its name in + New site, and the line under it. */
  name: string;
  line: string;
}

export const KIND_OPENINGS: readonly KindOpening[] = [
  // Salon or spa (Figma S2, S1, S3)
  { key: 'beauty-panel', family: 'beauty', design: 'atelier', layout: 'panel', look: 'blush', header: '', card: '', photo: '', band: '',
    name: 'Split on a colour panel · Blush', line: 'The Atelier design: your words on a soft panel beside the photo.' },
  { key: 'beauty-photo', family: 'beauty', design: 'atelier', layout: 'photo', look: 'black_gold', header: '', card: '', photo: '', band: '',
    name: 'Words over the photo · Black & gold', line: 'The Atelier design on a dark page, your words over the photo.' },
  { key: 'beauty-editorial', family: 'beauty', design: 'atelier', layout: 'editorial', look: 'golden_hour', header: 'centered', card: '', photo: '', band: '',
    name: 'Centred editorial · Golden hour', line: 'The Atelier design with the name centred at the top and three photos in a row.' },
  // Home services (Figma C1, C2, C3)
  { key: 'home-type', family: 'home', design: 'harbor', layout: 'type', look: 'hard_hat', header: '', card: '', photo: '', band: 'off',
    name: 'Type only · Hard hat', line: 'The Harbor design: big words on the page and the facts you have, no photo needed.' },
  { key: 'home-photo', family: 'home', design: 'harbor', layout: 'photo', look: 'steady_navy', header: '', card: 'estimate', photo: '', band: '',
    name: 'Words over the photo · Steady navy', line: 'The Harbor design with a form on the photo that asks for an estimate.' },
  { key: 'home-panel', family: 'home', design: 'harbor', layout: 'panel', look: 'night_shift', header: '', card: '', photo: 'left', band: '',
    name: 'Split, photo first · Night shift', line: 'The Harbor design on a dark page, the photo on the left.' },
  // Restaurant or café (Figma R1, R2, R3)
  { key: 'food-photo', family: 'food', design: 'restaurant-classic', layout: 'photo', look: '', header: '', card: 'today', photo: '', band: '',
    name: 'Words over the photo · Its own look', line: 'The Restaurant Classic design with today’s hours and your booking button on the photo.' },
  { key: 'food-editorial', family: 'food', design: 'restaurant-classic', layout: 'editorial', look: 'newsprint', header: 'centered', card: '', photo: '', band: '',
    name: 'Centred editorial · Newsprint', line: 'The Restaurant Classic design with the name centred at the top and three photos in a row.' },
  { key: 'food-type', family: 'food', design: 'restaurant-classic', layout: 'type', look: 'hand_lettered', header: '', card: '', photo: '', band: 'off',
    name: 'Type only · Hand-lettered', line: 'The Restaurant Classic design: big words on the page and the facts you have, no photo needed.' },
];

/** One opening by its key, or null. Pure. */
export const kindOpening = (key: unknown): KindOpening | null =>
  (typeof key === 'string' && key ? KIND_OPENINGS.find((o) => o.key === key) || null : null);
/** A kind's openings, the one + New site picks first, first. Pure. */
export const openingsOf = (family: unknown): KindOpening[] => KIND_OPENINGS.filter((o) => o.family === family);
/** The picture of an opening, from the app (scripts/thumbnails shoots it). */
export const openingPicture = (key: string): string => `/thumbs/openings/${key}.jpg`;

/** What GET /agency/designs adds for + New site: each kind's openings, by family, with their
 *  pictures and plain names. Pure. */
export function openingsPayload(): Record<string, Array<{ key: string; design: string; name: string; line: string; picture: string }>> {
  const out: Record<string, Array<{ key: string; design: string; name: string; line: string; picture: string }>> = {};
  for (const o of KIND_OPENINGS) (out[o.family] ||= []).push({ key: o.key, design: o.design, name: o.name, line: o.line, picture: openingPicture(o.key) });
  return out;
}
