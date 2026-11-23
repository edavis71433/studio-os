// ── One sample business per kind of business (builder list item 331) ───────────
//   deno run --allow-read --allow-write scripts/thumbnails/kind_samples.ts
// Writes supabase/functions/presence/lib/kind_samples.json: for each of the ten kinds in
// + New site (lib/design_gallery.ts families), a whole sample site's words, so a salon owner
// sees eight salons in the design pictures, and "See it full size" draws a salon in any
// design. Seven kinds are the templates' own samples (item 103); health, nonprofits and
// "something else" are written here. Every photo becomes the kind's stand-in picture
// (thumbs/stand-ins/<family>.jpg) until real photos are approved. Fake names only.
const ROOT = new URL('../../', import.meta.url);
const fixture = (slug: string) => JSON.parse(Deno.readTextFileSync(new URL(`supabase/functions/presence/templates/${slug}/1.0.0/fixture.json`, ROOT))).content;
const WEEK = (open: string, close: string, sat?: [string, string], sun?: [string, string]) => ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => {
  const iv = day === 'sat' ? sat : day === 'sun' ? sun : [open, close];
  return iv ? { day, closed: false, intervals: [{ open: iv[0], close: iv[1] }] } : { day, closed: true, intervals: [] };
});
const photo = (alt: string) => ({ alt, variants: { w400: '/x-400.webp', w800: '/x-800.webp', w1600: '/x-1600.webp' }, width: 1600, height: 1000 });
const place = (line1: string, city: string, postal: string, phone: string, hours: unknown) => ({ address_line1: line1, address_line2: '', city, region: 'CA', postal_code: postal, country: 'US', phone, timezone: 'America/Los_Angeles', hours, holiday_exceptions: [], temporarily_closed: false, temporarily_closed_note: '' });

const NEW: Record<string, Record<string, unknown>> = {
  health: {
    identity: { business_name: 'Brightside Family Dental', tagline: 'Gentle dentistry for the whole family in Pasadena', description: 'Checkups, cleanings and fillings for kids and grown-ups, with evening hours twice a week and a team that goes at your pace.', story: 'Dr. Amara Okafor opened Brightside in 2015 so families could see one dentist they trust, from a first tooth to a first crown.\n\nWe explain everything before we start, and we never rush.', phone: '(626) 555-0131', email: 'hello@brightside.example', service_area: 'Pasadena, Altadena and South Pasadena', booking_url: 'https://book.example/brightside', ordering_url: '', social: {}, seo_title: 'Brightside Family Dental in Pasadena', seo_description: 'Family dentist in Pasadena: checkups, cleanings, fillings and whitening, with evening hours.' },
    offerings: [
      { id: 'o1', name: 'Checkup and cleaning', category: 'Everyday care', description: 'An exam, a gentle cleaning and X-rays when you need them.', price_text: 'Most insurance', sort_order: 1, media: photo('A bright, calm treatment room') },
      { id: 'o2', name: 'Fillings', category: 'Everyday care', description: 'Tooth-colored fillings, usually in one visit.', price_text: 'from $160', sort_order: 2, media: photo('A dentist talking with a patient') },
      { id: 'o3', name: 'Whitening', category: 'Smile care', description: 'In-office whitening or trays to use at home.', price_text: 'from $250', sort_order: 3, media: photo('A smile after whitening') },
      { id: 'o4', name: 'Same-day visits', category: 'Urgent care', description: 'Toothache or a chipped tooth? Call before noon and we see you today.', price_text: '', sort_order: 4, media: null },
    ],
    testimonials: [
      { id: 't1', quote: 'My son used to dread the dentist. Now he asks when we are going back.', author: 'Renee T.', source: 'Google', sort_order: 1 },
      { id: 't2', quote: 'They saw me the same day for a cracked tooth and explained every step.', author: 'Marcus L.', source: 'Google', sort_order: 2 },
      { id: 't3', quote: 'Kind, careful and on time. The evening hours are a lifesaver.', author: 'Joy P.', source: 'Yelp', sort_order: 3 },
    ],
    faqs: [
      { id: 'f1', question: 'Do you take my insurance?', answer: 'We take most dental plans. Call with your plan name and we will check before your visit.', sort_order: 1 },
      { id: 'f2', question: 'Do you see children?', answer: 'Yes, from their first tooth. Kids get a short, friendly first visit.', sort_order: 2 },
      { id: 'f3', question: 'I am nervous. Can you help?', answer: 'Tell us when you book. We go slowly, explain each step and stop whenever you ask.', sort_order: 3 },
    ],
    posts: [{ id: 'p1', title: 'How often should you see the dentist?', slug: 'how-often', excerpt: 'For most people, twice a year. Here is why.', body_md: 'Most people do well with a **checkup every six months**.\n\nIf your gums bleed when you brush, come sooner.', published_at: '2026-10-12T17:00:00Z', hero: photo('A toothbrush and a glass by a window') }],
    redirects: [],
    locations: [place('210 E Colorado Blvd', 'Pasadena', '91101', '(626) 555-0131', WEEK('08:00', '17:00', ['09:00', '13:00']))],
    settings: { category_order: [], industry: 'dental' },
  },
  community: {
    identity: { business_name: 'Northside Community Kitchen', tagline: 'Free meals and cooking classes in Glendale, open to everyone', description: 'Hot meals every Saturday, cooking classes for families and a pantry shelf you can take from, run by neighbors and volunteers.', story: 'We started in a church kitchen in 2018 with eleven volunteers and one big pot of soup.\n\nToday more than 200 neighbors help cook, serve and drive meals across the north side.', phone: '(818) 555-0158', email: 'hello@northsidekitchen.example', service_area: 'Glendale, Montrose and La Crescenta', booking_url: '', ordering_url: '', social: {}, seo_title: 'Northside Community Kitchen, Glendale', seo_description: 'Free Saturday meals, family cooking classes and volunteer shifts in Glendale.' },
    offerings: [
      { id: 'o1', name: 'Saturday meals', category: 'Programs', description: 'A hot, free meal every Saturday from noon. Everyone is welcome.', price_text: 'Free', sort_order: 1, media: photo('Neighbors sharing a meal at long tables') },
      { id: 'o2', name: 'Family cooking classes', category: 'Programs', description: 'Cook simple, healthy dinners together. Ingredients included.', price_text: 'Free', sort_order: 2, media: photo('A family cooking class') },
      { id: 'o3', name: 'Volunteer shifts', category: 'Get involved', description: 'Two-hour shifts in the kitchen, on the serving line or driving meals.', price_text: '', sort_order: 3, media: photo('Volunteers packing meals') },
    ],
    testimonials: [
      { id: 't1', quote: 'The Saturday meal is where I met half my neighbors.', author: 'Gloria M.', source: '', sort_order: 1 },
      { id: 't2', quote: 'My kids now ask to cook dinner on Tuesdays.', author: 'Daniel R.', source: '', sort_order: 2 },
    ],
    faqs: [
      { id: 'f1', question: 'Do I need to sign up for a meal?', answer: 'No. Come by on Saturday from noon. There is always enough.', sort_order: 1 },
      { id: 'f2', question: 'How can I give?', answer: 'Volunteer a shift, bring pantry items on Fridays, or give online.', sort_order: 2 },
    ],
    posts: [{ id: 'p1', title: 'A thank-you to our volunteers', slug: 'thank-you', excerpt: 'What one year of Saturdays looked like.', body_md: 'This year our volunteers served **meals every single Saturday**.\n\nThank you for showing up.', published_at: '2026-10-05T17:00:00Z', hero: photo('Volunteers in the kitchen') }],
    redirects: [],
    locations: [place('618 N Verdugo Rd', 'Glendale', '91206', '(818) 555-0158', WEEK('10:00', '16:00', ['11:00', '15:00']))],
    settings: { category_order: [], industry: 'nonprofit' },
  },
  other: {
    identity: { business_name: 'Cobalt Auto Care', tagline: 'Honest repairs and oil changes in Burbank, done while you wait', description: 'Brakes, oil changes, tires and check-engine lights, with the price agreed before we start and a free ride home if it takes longer than an hour.', story: 'Two mechanics opened Cobalt in 2012 to run the kind of shop they would send their own families to.\n\nWe show you the worn part, explain the fix and let you decide.', phone: '(818) 555-0176', email: 'shop@cobaltauto.example', service_area: 'Burbank, Toluca Lake and North Hollywood', booking_url: 'https://book.example/cobalt', ordering_url: '', social: {}, seo_title: 'Cobalt Auto Care, Burbank auto repair', seo_description: 'Auto repair in Burbank: brakes, oil changes, tires and diagnostics, priced before we start.' },
    offerings: [
      { id: 'o1', name: 'Oil change', category: 'Maintenance', description: 'Synthetic oil and a 20-point check, usually in 30 minutes.', price_text: 'from $69', sort_order: 1, media: photo('A mechanic checking the oil') },
      { id: 'o2', name: 'Brakes', category: 'Repairs', description: 'Pads, rotors and a test drive with you before you pay.', price_text: 'from $189', sort_order: 2, media: photo('New brake pads on a car') },
      { id: 'o3', name: 'Check-engine light', category: 'Repairs', description: 'We read the code, find the cause and price the fix.', price_text: '$95', sort_order: 3, media: photo('A diagnostic tool plugged into a car') },
      { id: 'o4', name: 'Tires', category: 'Maintenance', description: 'New tires, rotation and balancing.', price_text: '', sort_order: 4, media: null },
    ],
    testimonials: [
      { id: 't1', quote: 'They showed me the worn pads before replacing anything. Fair price, no upsell.', author: 'Tom H.', source: 'Google', sort_order: 1 },
      { id: 't2', quote: 'Oil change done while I had a coffee next door.', author: 'Lena K.', source: 'Google', sort_order: 2 },
      { id: 't3', quote: 'The only shop I trust with my car.', author: 'The Ortiz family', source: 'Yelp', sort_order: 3 },
    ],
    faqs: [
      { id: 'f1', question: 'Do I need an appointment?', answer: 'For oil changes and checks, walk in. For repairs, book online so the part is here.', sort_order: 1 },
      { id: 'f2', question: 'Is your work guaranteed?', answer: 'Yes. Parts and work are covered for a year.', sort_order: 2 },
    ],
    posts: [{ id: 'p1', title: 'When to change your brakes', slug: 'brakes', excerpt: 'Three sounds that mean it is time.', body_md: 'A **squeal**, a grind or a soft pedal means book a check.', published_at: '2026-09-20T17:00:00Z', hero: photo('A car on a lift') }],
    redirects: [],
    locations: [place('905 W Olive Ave', 'Burbank', '91506', '(818) 555-0176', WEEK('08:00', '18:00', ['08:00', '14:00']))],
    settings: { category_order: [], industry: 'auto_repair' },
  },
};
const FROM: Record<string, string> = { food: 'restaurant-classic', beauty: 'atelier', home: 'harbor', professional: 'business-classic', retail: 'meadow', fitness: 'slate', creative: 'aurora' };
const FAMILIES = ['food', 'beauty', 'home', 'health', 'professional', 'retail', 'fitness', 'creative', 'community', 'other'];

// every photo becomes the kind's stand-in; a logo stays off (a drawing is no logo)
const withStandIns = (v: unknown, path: string): unknown => {
  if (Array.isArray(v)) return v.map((x) => withStandIns(x, path));
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (o.variants && typeof o.variants === 'object') return { alt: String(o.alt || ''), variants: { w400: path, w800: path, w1600: path }, width: 1600, height: 1000 };
    return Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'logo').map(([k, x]) => [k, withStandIns(x, path)]));
  }
  return v;
};
const out: Record<string, unknown> = {};
for (const f of FAMILIES) out[f] = withStandIns(NEW[f] || fixture(FROM[f]), `/thumbs/stand-ins/${f}.jpg`);
await Deno.writeTextFile(new URL('supabase/functions/presence/lib/kind_samples.json', ROOT), JSON.stringify(out, null, 1) + '\n');
console.log('wrote', FAMILIES.length, 'kinds');
