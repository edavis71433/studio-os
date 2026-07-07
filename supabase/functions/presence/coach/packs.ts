// ── Growth packs (M9.5E) — industry patterns as DATA, per constitution 05 §13 ─
// Same law as the Writer's pack registry: one flagship vertical shipped deep
// (restaurant), every future vertical is an entry in this registry, nothing
// more. A pack never generates anything by itself — it tells the rules which
// calendar events matter here, what the seasonal angles are, and which
// industry moments exist. The VALUE FILTER lives in rules.ts: a pack angle
// without concrete grounding in the customer's own site produces nothing.

export interface GrowthPack {
  slug: string;
  /** holiday key prefixes that matter in this vertical, with the business angle */
  holidays: Record<string, string>;
  /** per-season angle — what this vertical actually does when the season turns */
  seasons: Record<string, string>;
  /** recurring industry events beyond national holidays: month/day window + angle */
  events: Array<{ key: string; name: string; month: number; day: number; lead_days: number; angle: string }>;
  /** what customer education looks like here (used only when the site's own content grounds it) */
  educationAngle: string;
  /** when asking for reviews lands naturally in this vertical */
  reviewMoment: string;
}

const GENERIC: GrowthPack = {
  slug: 'generic',
  holidays: {
    'small-biz-saturday': 'Customers go out of their way to shop small this weekend.',
    'new-years': 'People start the year looking for new providers.',
  },
  seasons: {},
  events: [],
  educationAngle: 'a plain-language explainer of how your service works',
  reviewMoment: 'right after a job well done',
};

export const GROWTH_PACKS: Record<string, GrowthPack> = {
  restaurant: {
    slug: 'restaurant',
    holidays: {
      'valentines': 'One of the biggest dining-out nights of the year — tables book up weeks ahead.',
      'mothers-day': 'The single busiest restaurant day of the year in most of the country.',
      'fathers-day': 'A major family-dining day — brunch and dinner both fill.',
      'thanksgiving': 'Diners look for holiday hours, pre-orders, and alternatives to cooking.',
      'christmas': 'Holiday parties and gift cards drive December.',
      'new-years-eve': 'Prix fixe and late seatings — guests decide early where to celebrate.',
      'small-biz-saturday': 'Neighbors make a point of eating local this weekend.',
      'july-4': 'Cookout weekend — takeout and patio traffic if you’re open.',
      'halloween': 'Family early-evening traffic and themed specials.',
    },
    seasons: {
      spring: 'Spring produce changes the menu — tell people what’s new.',
      summer: 'Patio season. If you have outdoor seating, this is its moment.',
      fall: 'Comfort-food season begins; menus turn heartier.',
      winter: 'Holiday parties, gift cards, and warm-plates messaging.',
    },
    events: [],
    educationAngle: 'where your ingredients come from and how the menu changes',
    reviewMoment: 'while the meal is still fresh in a happy guest’s mind',
  },
  dental: {
    slug: 'dental',
    holidays: { 'new-years': 'Insurance benefits reset — patients book early-year cleanings.' },
    seasons: {
      fall: 'Year-end insurance benefits expire — patients with unused coverage book now.',
      summer: 'School’s out: families book kids’ checkups before the new school year.',
    },
    events: [{ key: 'childrens-dental-month', name: 'Children’s Dental Health Month', month: 2, day: 1, lead_days: 21, angle: 'A natural month to talk about kids’ visits.' }],
    educationAngle: 'what to expect at a first visit, in plain words',
    reviewMoment: 'right after a comfortable appointment',
  },
  landscaper: {
    slug: 'landscaper',
    holidays: {},
    seasons: {
      spring: 'Spring cleanups and planting — the year’s biggest booking window.',
      summer: 'Maintenance season; irrigation and mowing schedules fill.',
      fall: 'Leaf cleanup and winterizing — the second booking wave.',
      winter: 'Snow contracts and next-season planning.',
    },
    events: [],
    educationAngle: 'what a seasonal cleanup actually includes',
    reviewMoment: 'when a finished yard looks its best',
  },
  hvac: {
    slug: 'hvac',
    holidays: {},
    seasons: {
      spring: 'AC tune-up season — beat the first heat wave.',
      fall: 'Furnace checks before the first cold snap.',
      summer: 'Peak breakdown season; emergency availability matters.',
      winter: 'Heating emergencies; response time is the message.',
    },
    events: [],
    educationAngle: 'how a tune-up prevents the expensive failure',
    reviewMoment: 'right after restoring someone’s heat or cooling',
  },
  retail: {
    slug: 'retail',
    holidays: {
      'small-biz-saturday': 'The biggest shop-small day of the year.',
      'christmas': 'Gift season carries the quarter.',
      'valentines': 'Gift traffic spikes.',
      'mothers-day': 'One of the strongest gift-buying windows.',
    },
    seasons: { winter: 'Holiday shopping season — hours, gift ideas, and returns policy up front.' },
    events: [],
    educationAngle: 'how to choose between your most-asked-about products',
    reviewMoment: 'when a purchase works out beautifully',
  },
};

/** template_slug → growth pack; the writer's registry uses the same convention. */
export function growthPackFor(templateSlug: string): GrowthPack {
  const slug = (templateSlug || '').split('-')[0];
  return GROWTH_PACKS[slug] || GENERIC;
}
