// ── Industry vocabulary & schema (Phase T) — templates-as-data primitive ─────
// The template ecosystem scales to hundreds WITHOUT new render code by treating a
// template as (render engine) × (industry vocabulary) × (theme) × (components).
// This file is the INDUSTRY VOCABULARY layer: for a given industry it supplies the
// correct schema.org type + the words a template should use ("Services" vs "Menu")
// + the right item schema. It is the fix for the deepest gap — today every site
// emits `@type: Restaurant / Menu`, which is wrong for any non-restaurant. A
// template reads `vocabFor(industry)` and is correct for that industry.
//
// Pure, exhaustively testable. Industry is derived from the template slug's first
// segment (see industry/registry.ts resolveIndustryKey), so `home_services-classic`
// → `home_services`, `business-classic` → generic.

export interface IndustryVocab {
  /** schema.org type for the LocalBusiness node — the correctness fix. */
  schemaType: string;
  /** what the business offers, plural (nav + headings), e.g. "Services", "Menu". */
  offeringLabel: string;
  /** singular, e.g. "Service", "Dish". */
  offeringLabelSingular: string;
  /** the offerings page path, e.g. "/services/", "/menu/". */
  offeringPath: string;
  /** schema.org type for an individual offering, e.g. "Service", "MenuItem", "Product". */
  offeringItemSchema: string;
  /** the primary customer action verb, e.g. "Book", "Order", "Get a quote". */
  primaryAction: string;
  /** true when the offerings are a food menu (emit Menu/MenuSection/MenuItem schema). */
  isMenu: boolean;
}

// The V1 industry families. schema.org types are real (LocalBusiness subtypes).
// A vertical inherits its family's vocab and overrides only what differs — mirrors
// the pack `extends` inheritance, so adding an industry is one data row.
const GENERIC: IndustryVocab = {
  schemaType: 'LocalBusiness', offeringLabel: 'Services', offeringLabelSingular: 'Service',
  offeringPath: '/services/', offeringItemSchema: 'Service', primaryAction: 'Get in touch', isMenu: false,
};

function food(schemaType: string): IndustryVocab {
  return { schemaType, offeringLabel: 'Menu', offeringLabelSingular: 'Item', offeringPath: '/menu/', offeringItemSchema: 'MenuItem', primaryAction: 'Order', isMenu: true };
}
function services(schemaType: string, action = 'Book'): IndustryVocab {
  return { ...GENERIC, schemaType, primaryAction: action };
}
function store(schemaType = 'Store'): IndustryVocab {
  return { schemaType, offeringLabel: 'Products', offeringLabelSingular: 'Product', offeringPath: '/products/', offeringItemSchema: 'Product', primaryAction: 'Shop', isMenu: false };
}

// The map. Keys align with industry pack keys; templates resolve via the slug.
const VOCAB: Record<string, IndustryVocab> = {
  generic: GENERIC,
  business: GENERIC,
  // food
  restaurant: food('Restaurant'),
  coffee_shop: food('CafeOrCoffeeShop'),
  cafe: food('CafeOrCoffeeShop'),
  bar: food('BarOrPub'),
  food_truck: food('FoodEstablishment'),
  // home & construction
  home_services: services('HomeAndConstructionBusiness', 'Get a quote'),
  plumber: services('Plumber', 'Get a quote'),
  hvac: services('HVACBusiness', 'Get a quote'),
  electrician: services('Electrician', 'Get a quote'),
  contractor: services('GeneralContractor', 'Get a quote'),
  roofing: services('RoofingContractor', 'Get a quote'),
  landscaping: services('LandscapingBusiness', 'Get a quote'),
  cleaning: services('LocalBusiness', 'Get a quote'),
  // beauty & wellness
  salon: services('HairSalon'),
  barber: services('HairSalon'),
  spa: services('DaySpa'),
  fitness: { ...GENERIC, schemaType: 'HealthClub', offeringLabel: 'Classes', offeringLabelSingular: 'Class', offeringPath: '/classes/', primaryAction: 'Join' },
  gym: { ...GENERIC, schemaType: 'HealthClub', offeringLabel: 'Classes', offeringLabelSingular: 'Class', offeringPath: '/classes/', primaryAction: 'Join' },
  yoga: { ...GENERIC, schemaType: 'HealthClub', offeringLabel: 'Classes', offeringLabelSingular: 'Class', offeringPath: '/classes/', primaryAction: 'Book' },
  // medical
  medical: services('MedicalBusiness', 'Book an appointment'),
  dental: services('Dentist', 'Book an appointment'),
  veterinary: services('VeterinaryCare', 'Book an appointment'),
  // professional
  professional: services('ProfessionalService', 'Get in touch'),
  law: services('Attorney', 'Request a consultation'),
  accounting: services('AccountingService', 'Get in touch'),
  insurance: services('InsuranceAgency', 'Get a quote'),
  consulting: services('ProfessionalService', 'Get in touch'),
  marketing: services('ProfessionalService', 'Get in touch'),
  real_estate: services('RealEstateAgent', 'Get in touch'),
  photography: services('ProfessionalService', 'Book a session'),
  videography: services('ProfessionalService', 'Book a session'),
  // food (Phase PT — more of the menu family)
  bakery: food('Bakery'),
  catering: food('Caterer'),
  brewery: food('Brewery'),
  winery: food('Winery'),
  // retail (Phase PT — the product family, each with a correct storefront schema)
  retail: store('Store'),
  florist: store('Florist'),
  jewelry: store('JewelryStore'),
  boutique: store('ClothingStore'),
  bookstore: store('BookStore'),
  furniture: store('FurnitureStore'),
  // beauty & wellness (Phase PT)
  nail_salon: services('BeautySalon'),
  massage: services('HealthAndBeautyBusiness'),
  // home & auto (Phase PT)
  auto_repair: services('AutoRepair', 'Get a quote'),
  auto_detailing: services('AutoWash', 'Book'),
  moving: services('MovingCompany', 'Get a quote'),
  pest_control: services('HomeAndConstructionBusiness', 'Get a quote'),
  pet_grooming: services('LocalBusiness', 'Book'),
  // professional & care (Phase PT)
  childcare: services('ChildCare', 'Get in touch'),
  tutoring: services('EducationalOrganization', 'Get in touch'),
  event_planning: services('ProfessionalService', 'Get in touch'),
  interior_design: services('ProfessionalService', 'Book a consultation'),
  // community
  nonprofit: { ...GENERIC, schemaType: 'NGO', offeringLabel: 'Programs', offeringLabelSingular: 'Program', offeringPath: '/programs/', primaryAction: 'Donate' },
  church: { ...GENERIC, schemaType: 'Church', offeringLabel: 'Programs', offeringLabelSingular: 'Program', offeringPath: '/programs/', primaryAction: 'Visit' },
};

/** The vocabulary for an industry key; never null (generic is the baseline). */
export function vocabFor(industryKey: string | null | undefined): IndustryVocab {
  return VOCAB[String(industryKey || 'generic')] || GENERIC;
}

export function isKnownIndustry(key: string): boolean { return Object.prototype.hasOwnProperty.call(VOCAB, key); }
export function allIndustryKeys(): string[] { return Object.keys(VOCAB); }

/** Industry → the V1 template slug that realizes it. Until a vertical template is
 *  authored, an industry falls back to the neutral `business-classic` (correct
 *  schema/vocab for any LocalBusiness). Food industries use the restaurant family.
 *  This is how "default template by industry" resolves — data, not code. */
export function templateSlugForIndustry(industryKey: string): string {
  const v = vocabFor(industryKey);
  if (v.isMenu) return 'restaurant-classic';        // the shipped food template
  return 'business-classic';                          // the neutral V1 template (to author)
}
