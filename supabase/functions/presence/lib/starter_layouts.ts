// ── Phase T-STARTER · pre-arranged, pre-filled starter layouts ────────────────
// A blank home page is a cold start — the owner stares at nothing and has to
// imagine the whole thing. This module hands them the OPPOSITE: a small set of
// ready-LAID-OUT layouts (a sensible sequence of sections already filled with
// short GUIDING placeholder copy), tuned per industry family, so they always
// EDIT real starter content instead of facing an empty canvas.
//
// A layout is just a pre-arranged `blocks` array. It is applied through the
// EXISTING save path (PUT /settings {blocks} → validateBlocks), so every starter
// block is the same structured, validated, deterministic block the render engine
// already knows — no new render code, no new storage, no new endpoint. To stay
// applicable with no photos yet, every starter uses TEXT-FIRST blocks only (the
// ones that survive validateBlocks with zero media), so the owner sees the whole
// shape immediately and swaps in their words, then adds photos where they like.
//
// Pure: no I/O, no clock, no randomness. Typed against the REAL block schema
// (StoredBlock), and the test suite re-validates every layout through the actual
// validateBlocks() — so a starter can never drift out of the schema.

import type { StoredBlock } from './site_blocks.ts';

export interface StarterLayout {
  /** stable key (also the recommended-match key per industry family). */
  key: string;
  /** owner-facing name (plain words). */
  name: string;
  /** one calm line describing what this lays out. */
  description: string;
  /** the pre-arranged, pre-filled sequence of sections. */
  blocks: StoredBlock[];
}

// A shared, guiding call-to-action close. Text-only on purpose: safeHref only
// accepts real https:/mailto:/tel: links, so the owner adds their own — the copy
// tells them exactly what to put here rather than shipping a dead button.
const cta = (text: string): StoredBlock => ({ type: 'cta', text });

// ── The layouts. Each is a hero-follows-through sequence the core sections
//    (hero / about / testimonials / FAQ live in their own tabs) complement:
//    intro → why-us → what-we-offer → how/pricing → a clear close. ──
export const STARTER_LAYOUTS: StarterLayout[] = [
  {
    key: 'generic',
    name: 'Simple business',
    description: 'A calm, all-purpose home page: a welcome, why choose you, what you offer, and a clear next step.',
    blocks: [
      { type: 'richtext', title: 'Welcome', body: 'Tell visitors who you are and what you do, in two or three friendly sentences. Write it the way you’d greet someone at your door — warm, plain and specific. You can format this text with the toolbar above.' },
      { type: 'features', title: 'Why choose us', items: [
        { title: 'A reason to choose you', text: 'What do you do better than anyone else? Say it in one clear line.' },
        { title: 'A second strength', text: 'Reliability, experience, care, value — pick one and be specific.' },
        { title: 'A third reason to trust you', text: 'Real details win trust. Replace this with something true about you.' },
      ] },
      { type: 'cards', id: 'starter_offerings', title: 'What we offer', cards: [
        { heading: 'Your first offering', text: 'Describe one product or service in a single clear line.' },
        { heading: 'Your second offering', text: 'Add another here — keep each one short and scannable.' },
        { heading: 'Your third offering', text: 'One more. Three is a friendly number to start with.' },
      ] },
      { type: 'stats', title: 'By the numbers', items: [
        { value: '10+', label: 'Years doing this' },
        { value: '500+', label: 'Happy customers' },
        { value: '100%', label: 'Focused on you' },
      ] },
      cta('Ready to get started? Tell customers the best way to reach you — add your phone, email or a booking link.'),
    ],
  },
  {
    key: 'columns_layout',
    name: 'Side-by-side',
    description: 'A modern split layout: a welcome, two side-by-side intro columns, why-choose-you, and what you’re great at.',
    blocks: [
      { type: 'richtext', title: 'Welcome', body: 'Open with a warm, specific hello — who you are and who you help, in two or three sentences.' },
      { type: 'columns', id: 'starter_cols', title: 'A bit about us', columns: [
        { body: '**Who we are**\n\nA sentence or two about your story — how you started and what drives you.' },
        { body: '**What we do**\n\nName what you offer and the result customers get. Keep it clear and concrete.' },
      ] },
      { type: 'features', title: 'Why choose us', items: [
        { title: 'A clear strength', text: 'Say what you do better than anyone else.', icon: '⭐' },
        { title: 'A reason to trust you', text: 'Experience, care, guarantees — pick one and be specific.', icon: '🤝' },
        { title: 'A third reason', text: 'Something true and concrete about you.', icon: '✅' },
      ] },
      { type: 'progress', title: 'What we’re great at', items: [
        { label: 'Add a strength', percent: 90 },
        { label: 'Add another', percent: 80 },
        { label: 'And one more', percent: 75 },
      ] },
      cta('Ready to talk? Add your phone, email or a booking link so people can reach you.'),
    ],
  },
  {
    key: 'tabbed_layout',
    name: 'Tabbed & tidy',
    description: 'Keeps a lot of info tidy: a welcome, tabbed sections for what you offer, why-choose-you, and good-to-know answers.',
    blocks: [
      { type: 'richtext', title: 'Welcome', body: 'Introduce your business in a few friendly sentences — the more human, the better.' },
      { type: 'tabs', title: 'What we offer', tabs: [
        { label: 'Overview', body: 'A short summary of what you do and who it’s for.' },
        { label: 'Services', body: 'List your main services here, one per line or as a short paragraph.' },
        { label: 'Pricing', body: 'Give a sense of pricing or how you quote — even a starting-from figure helps.' },
      ] },
      { type: 'features', title: 'Why choose us', items: [
        { title: 'What sets you apart', text: 'Lead with your strongest reason.', icon: '✨' },
        { title: 'A second reason', text: 'Keep it concrete and true.', icon: '👍' },
        { title: 'A third reason', text: 'Something customers thank you for.', icon: '💬' },
      ] },
      { type: 'accordion', title: 'Good to know', items: [
        { summary: 'Where you’re based / who you serve', body: 'Add your area or location.' },
        { summary: 'How to get started', body: 'Explain the first step in a sentence.' },
        { summary: 'A common question', body: 'Answer something customers often ask.' },
      ] },
      cta('Have a question? Add the best way to reach you and invite people to get in touch.'),
    ],
  },
  {
    key: 'onepage_pitch',
    name: 'One-page pitch',
    description: 'A punchy, sales-first page: the benefits you offer, the numbers, how it works, simple pricing and a strong close.',
    blocks: [
      { type: 'features', title: 'What you get', items: [
        { title: 'A key benefit', text: 'Lead with the outcome the customer wants.', icon: '🎯' },
        { title: 'A second benefit', text: 'What makes their life easier or better.', icon: '⚡' },
        { title: 'A third benefit', text: 'One more reason to say yes.', icon: '🏆' },
      ] },
      { type: 'stats', title: 'By the numbers', items: [
        { value: '10+', label: 'Years experience' },
        { value: '500+', label: 'Customers served' },
        { value: '5★', label: 'Average rating' },
      ] },
      { type: 'process', title: 'How it works', steps: [
        { step: 'Reach out', detail: 'Describe the easy first step.' },
        { step: 'We make a plan', detail: 'What happens next.' },
        { step: 'You get results', detail: 'The outcome they walk away with.' },
      ] },
      { type: 'pricing', title: 'Simple pricing', tiers: [
        { name: 'Starter', price_text: '$—', features: ['What’s included', 'A second line', 'A third line'] },
        { name: 'Most popular', price_text: '$—', features: ['The best value', 'Key benefits', 'Keep lines short'] },
      ] },
      cta('Ready to start? Add your booking link, phone or email and invite people to take the next step.'),
    ],
  },
  {
    key: 'creative',
    name: 'Creative portfolio',
    description: 'For photographers, designers and makers: an intro, a few pieces of work, your skills, how you work, and a way to hire you.',
    blocks: [
      { type: 'richtext', title: 'About my work', body: 'Introduce yourself and your style in a few sentences — what you make, who it’s for, and what makes your work yours.' },
      { type: 'cards', id: 'starter_work', title: 'Recent work', cards: [
        { heading: 'A project', text: 'Name a piece of work and describe it in a line. Add photos to bring it to life.' },
        { heading: 'Another project', text: 'A second example of what you do.' },
        { heading: 'One more', text: 'A third — swap in your best work.' },
      ] },
      { type: 'progress', title: 'Skills & tools', items: [
        { label: 'A skill', percent: 90 },
        { label: 'Another', percent: 85 },
        { label: 'And one more', percent: 80 },
      ] },
      { type: 'accordion', title: 'How we’ll work together', items: [
        { summary: 'The process', body: 'Walk through what working with you looks like.' },
        { summary: 'Timing & booking', body: 'How far ahead to book and what to expect.' },
        { summary: 'Pricing', body: 'Give a sense of your rates or how you quote.' },
      ] },
      cta('Like what you see? Add your email or a booking link so people can hire you.'),
    ],
  },
  {
    key: 'services_business',
    name: 'Services business',
    description: 'For trades, pros and studios: a welcome, why choose you, your services, how you work, and a call to reach out.',
    blocks: [
      { type: 'richtext', title: 'About us', body: 'Introduce your business in a few friendly sentences — what you do, who you help, and why you care about doing it well. This is the first thing most visitors read, so make it human.' },
      { type: 'features', title: 'Why choose us', items: [
        { title: 'What sets you apart', text: 'Experience, speed, honesty, craftsmanship — lead with your strongest one.' },
        { title: 'A second reason', text: 'Something customers consistently thank you for. Keep it concrete.' },
        { title: 'A third reason', text: 'Licensed, insured, local, guaranteed — whatever earns their trust.' },
      ] },
      { type: 'cards', id: 'starter_services', title: 'Our services', cards: [
        { heading: 'First service', text: 'Name a service and describe it in one clear line.' },
        { heading: 'Second service', text: 'Add another service you offer here.' },
        { heading: 'Third service', text: 'List a third — you can add more once you’re happy with these.' },
      ] },
      { type: 'process', title: 'How it works', steps: [
        { step: 'Get in touch', detail: 'Describe the first step — a call, a message, or a free quote.' },
        { step: 'We make a plan', detail: 'Explain what happens next in a sentence.' },
        { step: 'We get it done', detail: 'Finish with the result the customer walks away with.' },
      ] },
      cta('Ready to start? Tell customers the best way to reach you — a phone number, email or a quick contact form.'),
    ],
  },
  {
    key: 'restaurant',
    name: 'Restaurant & cafe',
    description: 'For food places: a warm welcome, what makes you special, a few favourites, good-to-know details, and a booking prompt.',
    blocks: [
      { type: 'richtext', title: 'Welcome', body: 'Set the scene in a few sentences — the kind of food you serve, the feeling of the room, what makes a visit special. Make people hungry to come in.' },
      { type: 'features', title: 'What makes us special', items: [
        { title: 'Your signature', text: 'The dish, drink or detail people come back for. Name it.' },
        { title: 'How you cook', text: 'Fresh, local, from scratch, family recipes — what’s your approach?' },
        { title: 'The experience', text: 'Cosy, lively, quick, special-occasion — describe the vibe.' },
      ] },
      { type: 'cards', id: 'starter_favourites', title: 'A few favourites', cards: [
        { heading: 'A popular dish', text: 'Name a favourite and tempt people in a single line.' },
        { heading: 'Another favourite', text: 'Add a second dish or drink here.' },
        { heading: 'One more', text: 'A third to round it out. Your full menu lives in its own tab.' },
      ] },
      { type: 'accordion', title: 'Good to know', items: [
        { summary: 'Hours & finding us', body: 'Add your opening hours and where to find you.' },
        { summary: 'Bookings & walk-ins', body: 'Let guests know whether to reserve ahead or just drop by.' },
        { summary: 'Dietary options', body: 'Mention vegetarian, vegan or gluten-free choices if you have them.' },
      ] },
      cta('Hungry? Add a booking link or your phone number so guests can reserve a table.'),
    ],
  },
  {
    key: 'retail',
    name: 'Shop & retail',
    description: 'For shops: an intro, what you stock, why shop with you, and an invitation to visit or buy.',
    blocks: [
      { type: 'richtext', title: 'Our shop', body: 'Introduce your shop in a few sentences — what you sell, what makes your selection special, and the kind of customer you love to help.' },
      { type: 'cards', id: 'starter_range', title: 'What we stock', cards: [
        { heading: 'A category you carry', text: 'Name a range or collection and describe it in one line.' },
        { heading: 'Another category', text: 'Add a second here to show your range.' },
        { heading: 'One more', text: 'A third category. Add photos later to bring these to life.' },
      ] },
      { type: 'features', title: 'Why shop with us', items: [
        { title: 'Curated selection', text: 'What makes your choices better than the big stores?' },
        { title: 'Real expertise', text: 'The advice or service customers get from you in person.' },
        { title: 'A reason to return', text: 'Loyalty, quality, values — why people come back.' },
      ] },
      cta('Come and see us — add your address, opening hours or a link to your online store.'),
    ],
  },
  {
    key: 'wellness',
    name: 'Wellness & appointments',
    description: 'For salons, clinics and studios: a welcome, your services, why choose you, simple packages, and a booking prompt.',
    blocks: [
      { type: 'richtext', title: 'Welcome', body: 'Introduce your practice in a few calm, reassuring sentences — what you offer, who it’s for, and how people feel when they leave. Warmth and clarity matter here.' },
      { type: 'cards', id: 'starter_services', title: 'Services & treatments', cards: [
        { heading: 'A treatment', text: 'Name a service and describe it in one clear, calming line.' },
        { heading: 'Another treatment', text: 'Add a second service you offer here.' },
        { heading: 'One more', text: 'A third to start with — add pricing and more below.' },
      ] },
      { type: 'features', title: 'Why choose us', items: [
        { title: 'Your approach', text: 'Gentle, expert, personalised — what defines your care?' },
        { title: 'Your people', text: 'The experience and warmth of your team.' },
        { title: 'The results', text: 'How clients feel and what they achieve with you.' },
      ] },
      { type: 'pricing', title: 'Packages', tiers: [
        { name: 'Starter', price_text: '$—', features: ['Add what’s included', 'A second line', 'A third line'] },
        { name: 'Most popular', price_text: '$—', features: ['List the key benefits', 'Highlight the best value', 'Keep each line short'] },
      ] },
      cta('Ready to book? Add your booking link or phone number so clients can reserve a time.'),
    ],
  },
  {
    key: 'nonprofit',
    name: 'Nonprofit / cause',
    description: 'For nonprofits and causes: your mission, what you do, the impact you’ve made, and how people can help.',
    blocks: [
      { type: 'richtext', title: 'Our mission', body: 'Say what you stand for in a few clear, heartfelt sentences — who you help and the change you’re working toward.' },
      { type: 'cards', id: 'starter_programs', title: 'What we do', cards: [
        { heading: 'A program', text: 'Describe one thing you do and who it helps.' },
        { heading: 'Another program', text: 'Add a second area of your work.' },
        { heading: 'One more', text: 'A third — keep each short and clear.' },
      ] },
      { type: 'stats', title: 'Our impact', items: [
        { value: '1,000+', label: 'People helped' },
        { value: '10 yrs', label: 'Serving the community' },
        { value: '100%', label: 'Mission-driven' },
      ] },
      { type: 'features', title: 'How you can help', items: [
        { title: 'Donate', text: 'Explain how a gift makes a difference.', icon: '💛' },
        { title: 'Volunteer', text: 'Invite people to give their time.', icon: '🙌' },
        { title: 'Spread the word', text: 'Ask supporters to share your mission.', icon: '📣' },
      ] },
      cta('Want to help? Add your donation link, volunteer form or the best way to get involved.'),
    ],
  },
  {
    key: 'education',
    name: 'Courses & classes',
    description: 'For tutors, coaches, studios and schools: a welcome, your programs, why choose you, common questions, and an enrol prompt.',
    blocks: [
      { type: 'richtext', title: 'Welcome', body: 'Introduce what you teach and who it’s for in a few encouraging sentences.' },
      { type: 'cards', id: 'starter_courses', title: 'Programs & classes', cards: [
        { heading: 'A course', text: 'Name a class and who it’s for in one line.' },
        { heading: 'Another course', text: 'Add a second program here.' },
        { heading: 'One more', text: 'A third — add levels, ages or schedules below.' },
      ] },
      { type: 'features', title: 'Why learn with us', items: [
        { title: 'Experienced teachers', text: 'What makes your instruction stand out.', icon: '🎓' },
        { title: 'Real results', text: 'What students achieve with you.', icon: '📈' },
        { title: 'A supportive space', text: 'The environment learners can expect.', icon: '🤝' },
      ] },
      { type: 'accordion', title: 'Common questions', items: [
        { summary: 'Who is this for?', body: 'Ages, levels or prerequisites.' },
        { summary: 'How do I sign up?', body: 'Explain enrolment in a sentence.' },
        { summary: 'Pricing & schedule', body: 'Give a sense of cost and timing.' },
      ] },
      cta('Ready to enrol? Add your sign-up link or the best way to get started.'),
    ],
  },
  {
    key: 'events',
    name: 'Events & venue',
    description: 'For venues, entertainers and event hosts: a welcome, what makes you special, what’s on, good-to-know details, and a booking prompt.',
    blocks: [
      { type: 'richtext', title: 'Welcome', body: 'Set the scene — what you host, the atmosphere, and why people love coming.' },
      { type: 'features', title: 'What makes us special', items: [
        { title: 'The experience', text: 'What guests remember most.', icon: '✨' },
        { title: 'The space', text: 'Describe your venue or setup.', icon: '📍' },
        { title: 'Made easy', text: 'How you take care of the details.', icon: '✅' },
      ] },
      { type: 'cards', id: 'starter_events', title: 'What’s on', cards: [
        { heading: 'An event or package', text: 'Name it and tempt people in one line.' },
        { heading: 'Another', text: 'Add a second offering here.' },
        { heading: 'One more', text: 'A third — add dates and details below.' },
      ] },
      { type: 'accordion', title: 'Good to know', items: [
        { summary: 'Booking & availability', body: 'How far ahead to book.' },
        { summary: 'Capacity & options', body: 'Group sizes, packages, add-ons.' },
        { summary: 'Getting here', body: 'Location and parking.' },
      ] },
      cta('Ready to plan something? Add a booking link or the best way to get in touch.'),
    ],
  },
  {
    key: 'medical',
    name: 'Clinic & practice',
    description: 'For clinics and practices: a reassuring welcome, your services, why choose you, good-to-know answers, and a booking prompt.',
    blocks: [
      { type: 'richtext', title: 'Welcome', body: 'Introduce your practice in a few calm, reassuring sentences — the care you provide and who it’s for.' },
      { type: 'cards', id: 'starter_services', title: 'Our services', cards: [
        { heading: 'A service', text: 'Name a service and describe it in one clear line.' },
        { heading: 'Another service', text: 'Add a second here.' },
        { heading: 'One more', text: 'A third to start with.' },
      ] },
      { type: 'features', title: 'Why choose us', items: [
        { title: 'Experienced team', text: 'The expertise patients can trust.', icon: '🩺' },
        { title: 'Gentle, personal care', text: 'How you put people at ease.', icon: '💙' },
        { title: 'Easy to reach', text: 'Booking, hours and location.', icon: '📅' },
      ] },
      { type: 'accordion', title: 'Good to know', items: [
        { summary: 'Insurance & payment', body: 'What you accept.' },
        { summary: 'New patients', body: 'How to get started.' },
        { summary: 'Hours & location', body: 'Where and when to find you.' },
      ] },
      cta('Ready to book? Add your booking link or phone number so patients can make an appointment.'),
    ],
  },
];

// ── Which starter suits an industry. Mirrors the vertical_presets FAMILY grouping
//    so the recommendation is consistent with the recommended-BLOCKS layer.
//    Every mapped key resolves to a real STARTER_LAYOUTS entry; unknown → generic.
const STARTER_FOR: Record<string, string> = {
  // home & trades → services business
  home_services: 'services_business', plumber: 'services_business', hvac: 'services_business',
  electrician: 'services_business', contractor: 'services_business', roofing: 'services_business',
  landscaping: 'services_business', cleaning: 'services_business', pest_control: 'services_business',
  moving: 'services_business', auto_repair: 'services_business', auto_detailing: 'services_business',
  // professional → services business
  professional: 'services_business', law: 'services_business', accounting: 'services_business',
  insurance: 'services_business', consulting: 'services_business', marketing: 'services_business',
  real_estate: 'services_business',
  // teaching & learning → courses & classes
  tutoring: 'education', childcare: 'education', music_lessons: 'education',
  driving_school: 'education', coaching: 'education', training: 'education',
  // creative & makers → creative portfolio
  photography: 'creative', videography: 'creative', interior_design: 'creative',
  graphic_design: 'creative', web_design: 'creative', artist: 'creative',
  // events & venues → events
  event_planning: 'events', venue: 'events', dj: 'events', entertainment: 'events',
  // community & causes → nonprofit
  nonprofit: 'nonprofit', church: 'nonprofit', charity: 'nonprofit',
  // beauty & fitness → wellness / appointments
  salon: 'wellness', barber: 'wellness', spa: 'wellness', nail_salon: 'wellness', massage: 'wellness',
  pet_grooming: 'wellness', fitness: 'wellness', gym: 'wellness', yoga: 'wellness',
  // clinics & practices → medical
  medical: 'medical', dental: 'medical', veterinary: 'medical', chiropractor: 'medical', optometry: 'medical',
  // retail / product → shop
  retail: 'retail', florist: 'retail', jewelry: 'retail', boutique: 'retail', bookstore: 'retail', furniture: 'retail',
  // food → restaurant
  restaurant: 'restaurant', coffee_shop: 'restaurant', cafe: 'restaurant', bar: 'restaurant',
  food_truck: 'restaurant', bakery: 'restaurant', catering: 'restaurant', brewery: 'restaurant', winery: 'restaurant',
  // explicit generics + new-layout self-keys
  generic: 'generic', business: 'generic',
  nonprofit_generic: 'nonprofit', education: 'education', events: 'events', medical_generic: 'medical',
};

/** The starter layout KEY recommended for an industry (never null; generic is the
 *  baseline). Pure. */
export function starterKeyFor(industryKey: string | null | undefined): string {
  return STARTER_FOR[String(industryKey || 'generic')] || 'generic';
}

/** The starter layout recommended for an industry (falls back to generic). Pure. */
export function starterLayoutFor(industryKey: string | null | undefined): StarterLayout {
  const key = starterKeyFor(industryKey);
  return STARTER_LAYOUTS.find((l) => l.key === key) || STARTER_LAYOUTS[0];
}

/** Every starter layout (for the "Start from a layout" picker). Pure. */
export function listStarterLayouts(): StarterLayout[] {
  return STARTER_LAYOUTS;
}
