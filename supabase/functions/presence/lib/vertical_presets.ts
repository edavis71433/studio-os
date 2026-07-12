// ── Phase T · Vertical realization (FD-T4) — presets, not template proliferation ─
// The constitution (Part 4) caps templates: "as few as honesty allows… template
// count is a maintenance liability… a second template within a vertical only when
// a vertical genuinely contains two presentation populations." And the Phase-T
// thesis: verticals differ by VOCABULARY + which structured blocks they emphasize,
// not by bespoke render code. So a vertical is realized as:
//   (one engine) × (industry_vocab) × (theme preset) × (recommended blocks)
// This file is the RECOMMENDED-BLOCKS layer: for an industry it names the content
// blocks that make that kind of business feel intentionally designed. Pure; every
// recommendation is a realized site_components block. The owner one-taps to add
// them (still fills + approves + publishes — nothing is auto-created).

import { REALIZED_BLOCK_TYPES } from './site_blocks.ts';
import type { SiteBlockType } from './render_types.ts';

// Block palettes per vertical family (ordered by how prominently they belong).
// Later realized types (reviews, appointment, partners, video, gallery,
// before_after) are woven in where they earn their place — same engine, richer
// out-of-the-box recommendations, zero render changes.
// r2 additions: 'social' everywhere (every business has profiles worth linking);
// 'newsletter' for most (skipped for trades + medical, where booking/proof lead);
// 'events' where gatherings are the rhythm (food, fitness, community, creative);
// 'map' for storefront families people travel TO (never mobile trades — they
// already carry service_areas). Map + social are link-out only, zero embeds.
const HOME_TRADES: SiteBlockType[] = ['before_after', 'reviews', 'service_areas', 'gallery', 'process', 'certifications', 'stats', 'features', 'social'];
const BEAUTY: SiteBlockType[] = ['appointment', 'before_after', 'team', 'gallery', 'pricing', 'reviews', 'features', 'map', 'social', 'newsletter'];
const FITNESS: SiteBlockType[] = ['appointment', 'pricing', 'events', 'gallery', 'team', 'reviews', 'stats', 'features', 'map', 'social', 'newsletter'];
const PROFESSIONAL: SiteBlockType[] = ['team', 'process', 'reviews', 'appointment', 'stats', 'certifications', 'features', 'social', 'newsletter'];
// creative studios: the work leads, and shows/bookings follow (split from professional)
const CREATIVE: SiteBlockType[] = ['gallery', 'reviews', 'events', 'process', 'appointment', 'stats', 'features', 'social', 'newsletter'];
const MEDICAL: SiteBlockType[] = ['appointment', 'team', 'certifications', 'reviews', 'features', 'process', 'map', 'social'];
const RETAIL: SiteBlockType[] = ['gallery', 'reviews', 'partners', 'features', 'stats', 'map', 'social', 'newsletter'];
const FOOD: SiteBlockType[] = ['gallery', 'events', 'reviews', 'features', 'map', 'social', 'newsletter'];  // the menu is already the core page
const COMMUNITY: SiteBlockType[] = ['events', 'gallery', 'stats', 'partners', 'video', 'features', 'newsletter', 'social', 'map', 'cta'];
const GENERIC: SiteBlockType[] = ['features', 'reviews', 'stats', 'newsletter', 'social', 'cta'];

const FAMILY: Record<string, SiteBlockType[]> = {
  // home & trades
  home_services: HOME_TRADES, plumber: HOME_TRADES, hvac: HOME_TRADES, electrician: HOME_TRADES,
  contractor: HOME_TRADES, roofing: HOME_TRADES, landscaping: HOME_TRADES, cleaning: HOME_TRADES,
  pest_control: HOME_TRADES, moving: HOME_TRADES, auto_repair: HOME_TRADES, auto_detailing: HOME_TRADES,
  // beauty & wellness
  salon: BEAUTY, barber: BEAUTY, spa: BEAUTY, nail_salon: BEAUTY, massage: BEAUTY, pet_grooming: BEAUTY,
  fitness: FITNESS, gym: FITNESS, yoga: FITNESS,
  // professional
  professional: PROFESSIONAL, law: PROFESSIONAL, accounting: PROFESSIONAL, insurance: PROFESSIONAL,
  consulting: PROFESSIONAL, marketing: PROFESSIONAL, real_estate: PROFESSIONAL,
  childcare: PROFESSIONAL, tutoring: PROFESSIONAL,
  // creative (the work itself is the pitch)
  photography: CREATIVE, videography: CREATIVE, interior_design: CREATIVE, event_planning: CREATIVE,
  // medical
  medical: MEDICAL, dental: MEDICAL, veterinary: MEDICAL,
  // retail / product
  retail: RETAIL, florist: RETAIL, jewelry: RETAIL, boutique: RETAIL, bookstore: RETAIL, furniture: RETAIL,
  // food
  restaurant: FOOD, coffee_shop: FOOD, cafe: FOOD, bar: FOOD, food_truck: FOOD, bakery: FOOD,
  catering: FOOD, brewery: FOOD, winery: FOOD,
  // community
  nonprofit: COMMUNITY, church: COMMUNITY,
  generic: GENERIC, business: GENERIC,
};

const realized = new Set<string>(REALIZED_BLOCK_TYPES);

/** The blocks recommended for an industry — realized types only, deduped, capped.
 *  Never null (generic is the baseline). Pure. */
export function suggestedBlocksFor(industryKey: string | null | undefined): SiteBlockType[] {
  const fam = FAMILY[String(industryKey || 'generic')] || GENERIC;
  return fam.filter((b) => realized.has(b));
}

/** A short, plain-English reason for the suggestion (owner-facing, no jargon). */
export function suggestionNoteFor(industryKey: string | null | undefined): string {
  const k = String(industryKey || 'generic');
  if (FAMILY[k] === HOME_TRADES) return 'Trades win trust with proof of work and clear service areas.';
  if (FAMILY[k] === BEAUTY) return 'Show your team, your space, and simple pricing.';
  if (FAMILY[k] === FITNESS) return 'Lead with your classes or packages and the people who teach them.';
  if (FAMILY[k] === PROFESSIONAL) return 'Credibility comes from your people, your process, and your track record.';
  if (FAMILY[k] === CREATIVE) return 'Lead with your work — then make it easy to follow you and book you.';
  if (FAMILY[k] === MEDICAL) return 'Reassure with your practitioners and their credentials.';
  if (FAMILY[k] === RETAIL) return 'Let your products and a few standout details do the talking.';
  if (FAMILY[k] === FOOD) return 'A few great photos go a long way alongside your menu.';
  if (FAMILY[k] === COMMUNITY) return 'Share your impact and a clear way to get involved.';
  return 'A few sections that build trust for any business.';
}
