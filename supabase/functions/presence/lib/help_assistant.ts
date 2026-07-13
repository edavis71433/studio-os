// ── HELP-1 · In-app "how do I…?" helper — deterministic, grounded, honest ────
// A product-help assistant grounded in OUR OWN help copy (help.html) + the real
// destinations of the workspace shell. It answers "how do I change my hours / send
// a broadcast / set up booking?" by matching the question to a CURATED answer with
// a deep link to the exact screen. This is help ABOUT the product — distinct from
// the customer-facing Concierge (concierge/answer.ts), which speaks about the
// owner's own site/moments.
//
// Deterministic-first: no model is required, and the curated answer IS the product.
// Every answer is written here (never invented), points to a real place, and stays
// calm and honest — "here's where to do that →". A no-match returns an honest
// fallback (the full Help page + a real person), never a guess. An optional LLM
// polish (routes/help.ts, gated on a key) may only REWORD this text, never add a
// product feature. Pure: no I/O, no clock, no randomness.

export interface HelpLink { href: string; label: string }
export interface HelpTopic {
  id: string;
  /** The canonical question this topic answers (shown back to the owner). */
  q: string;
  /** Lowercase trigger terms — the question matches when it contains any of them.
   *  Distinct enough that topics don't poach each other's questions. */
  kw: string[];
  /** The grounded answer, in the plain, honest voice of help.html. */
  a: string;
  /** Where to go — deep links straight into the right screen. */
  links: HelpLink[];
}

// The curated index. Each answer is grounded in help.html / real features; each
// link lands on a real screen (presence.html hashes route via routeHash()).
export const HELP_TOPICS: HelpTopic[] = [
  {
    id: 'hours',
    q: 'How do I change my opening hours?',
    kw: ['hour', 'opening time', 'open time', 'close time', 'closing', 'when we are open', 'trading hours'],
    a: 'Your hours live with the rest of your business info. Open Business info, update the hours (or flip the temporarily-closed switch near the bottom), then publish — nothing goes live until you do.',
    links: [{ href: '/presence.html#business', label: 'Open Business info' }],
  },
  {
    id: 'business_facts',
    q: 'How do I update my business name, address or phone?',
    kw: ['business name', 'address', 'phone number', 'contact detail', 'email address', 'change my name', 'nap', 'location detail'],
    a: 'Your name, address, phone, email and service area are all on the Business info page. Fill them in so they agree everywhere, then publish to apply.',
    links: [{ href: '/presence.html#business', label: 'Open Business info' }],
  },
  {
    id: 'add_section',
    q: 'How do I add a section to my home page?',
    kw: ['add a section', 'add section', 'new section', 'home page', 'homepage', 'block', 'layout', 'add content', 'reusable'],
    a: 'On your home page you pick a ready-made section, fill it in, and reorder or hide it — no design needed. You can also save a section to reuse later, and insert it as a copy (independent) or a link (edits to the saved section update everywhere it’s linked). Publish to apply.',
    links: [{ href: '/presence.html#design', label: 'Open your home page sections' }],
  },
  {
    id: 'publish',
    q: 'How do I publish my changes / put them live?',
    kw: ['publish', 'go live', 'make it live', 'put live', 'preview', 'push live', 'update my site', 'apply changes'],
    a: 'You edit a draft, preview it, then publish with one calm step. Every publish is kept as a version you can restore, and your live site never changes until you publish — a failed publish leaves it untouched.',
    links: [{ href: '/presence.html#publish', label: 'Review & publish' }],
  },
  {
    id: 'booking',
    q: 'How do I set up online booking?',
    kw: ['booking', 'book appointment', 'appointment', 'set up booking', 'take bookings', 'reservation', 'schedule appointment'],
    a: 'Add a Booking section to a page, then set your services, hours and appointments in the Bookings tab. It shows a calm, mobile-friendly widget on your site — first-party, with no external calendar loaded.',
    links: [{ href: '/presence.html#bookings', label: 'Set up Bookings' }],
  },
  {
    id: 'reviews',
    q: 'How do I show customer reviews?',
    kw: ['review', 'testimonial', 'rating', 'star rating', 'show reviews', 'collect reviews', 'feedback'],
    a: 'Collect and approve reviews in the Reviews tab, and add a Reviews section to a page. Only reviews you approve appear, with honest star ratings for search — nothing shows until you approve one and publish.',
    links: [{ href: '/presence.html#reviews', label: 'Collect & approve reviews' }],
  },
  {
    id: 'photos',
    q: 'How do I add photos or fix alt text?',
    kw: ['photo', 'image', 'picture', 'alt text', 'gallery', 'upload photo', 'describe image', 'media'],
    a: 'Your photographs live in Files, and each can carry a one-sentence description (alt text) that helps screen readers and search. Add photos there, then use them in image, gallery or team sections.',
    links: [{ href: '/presence.html#media', label: 'Open Photographs' }, { href: '/files.html', label: 'Open Files' }],
  },
  {
    id: 'broadcast',
    q: 'How do I send a broadcast to my customers?',
    kw: ['broadcast', 'send email', 'newsletter blast', 'email my customers', 'announcement to', 'mass email', 'send a message to'],
    a: 'Broadcasts let you send an update to your contacts. Open Broadcasts to write one, choose who it goes to, and send — every send is recorded so you can see what went out.',
    links: [{ href: '/broadcasts.html', label: 'Open Broadcasts' }],
  },
  {
    id: 'enquiries',
    q: 'Where do I find my enquiries and contacts?',
    kw: ['enquir', 'inquir', 'lead', 'contact', 'customer list', 'pipeline', 'crm', 'who contacted'],
    a: 'Enquiries, contacts and your pipeline all live under Customers. Anything that needs you also lands in your Inbox and your email, so nothing depends on you checking in.',
    links: [{ href: '/crm.html', label: 'Open Customers' }, { href: '/inbox.html', label: 'Open your Inbox' }],
  },
  {
    id: 'connect',
    q: 'How do I connect a service?',
    kw: ['connect', 'connection', 'integrate', 'link my google', 'link account', 'disconnect', 'connected service'],
    a: 'Connect the tools you already use to read your own data — safely, with only the access you approve. Any change we’d make on your behalf is proposed first and waits for your OK, and you can disconnect any time with your accounts left exactly as they are.',
    links: [{ href: '/connections.html', label: 'Open Connections' }],
  },
  {
    id: 'projects',
    q: 'Where is my project with the studio?',
    kw: ['project', 'my studio', 'work in progress', 'deliverable', 'proposal', 'invoice', 'sign', 'approve work', 'updates page'],
    a: 'When a studio builds for you, your project lives in one place — progress, files to review, things waiting on your OK, messages and invoices. Anything that needs you also arrives in your email.',
    links: [{ href: '/projects.html', label: 'Open Projects' }, { href: '/client.html', label: 'Open your updates page' }],
  },
  {
    id: 'analytics',
    q: 'How is my website doing / where are the stats?',
    kw: ['analytic', 'stats', 'statistic', 'how is my site doing', 'visitor', 'traffic', 'performance report', 'how it is going'],
    a: 'Analytics shows how it’s going in plain terms — visits and how people find you. It’s a calm read, not a wall of numbers.',
    links: [{ href: '/analytics.html', label: 'Open Analytics' }],
  },
  {
    id: 'billing',
    q: 'How do I change my plan, payment or cancel?',
    kw: ['billing', 'plan', 'upgrade', 'downgrade', 'cancel', 'subscription', 'payment method', 'pricing', 'invoice me', 'price'],
    a: 'Your plan decides which features you see. Upgrading adds capabilities with nothing reset; downgrading simply hides what you’re not using and preserves your information. Manage your subscription, payment method, or cancel any time from your billing portal in your account menu.',
    links: [{ href: '/pricing.html', label: 'See plans & pricing' }],
  },
  {
    id: 'data',
    q: 'How do I export my data or is my data mine?',
    kw: ['export', 'download my data', 'my data', 'ownership', 'own my', 'leave', 'delete my', 'take my data', 'gdpr'],
    a: 'Your data is yours, always. You can export everything you own at any time, connect or disconnect services freely, and leave without penalty. We store business facts and text, never your customers’ card details (billing is handled by Stripe). The "Download everything I own" option lives in your website editor’s technical desk.',
    links: [{ href: '/presence.html#export', label: 'Download everything I own' }],
  },
  {
    id: 'reliability',
    q: 'Is my website reliable / will it go down?',
    kw: ['reliab', 'uptime', 'go down', 'downtime', 'is it safe', 'restore', 'roll back', 'previous version', 'backup'],
    a: 'Your published website is served as plain, fast pages from a global network, and keeps working even if the platform is having a bad day. Every version you publish is kept and restorable in one click, and publishing changes nothing until it succeeds — no maintenance windows, no downtime for updates.',
    links: [{ href: '/presence.html#publish', label: 'Your website editor' }],
  },
];

// The full-help fallback destination + a real person — used when nothing matches,
// and offered as "more help" alongside every answer. Grounded in help.html.
export const HELP_FALLBACK_LINKS: HelpLink[] = [
  { href: '/help.html', label: 'Open full Help' },
  { href: 'mailto:support@davisdigitalstudio.com', label: 'Email a person' },
];

export interface HelpMatch {
  matched: boolean;
  id: string | null;
  question: string;      // the canonical question (or the owner's, when no match)
  answer: string;
  links: HelpLink[];
  low_confidence: boolean;   // a weak (single-term) match — worth an honest hedge
}

const norm = (s: unknown): string =>
  String(s ?? '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Score a topic against the normalized question: the number of its trigger terms
 *  present. Longer, more specific terms are worth slightly more so a precise phrase
 *  ("set up booking") beats an incidental word. Pure. */
function scoreTopic(t: HelpTopic, q: string): number {
  let score = 0;
  for (const term of t.kw) {
    if (q.includes(term)) score += term.includes(' ') ? 2 : 1;
  }
  return score;
}

/** Match a free-text question to the best curated help topic. Deterministic:
 *  same question → same answer. Returns an honest fallback (no invented product
 *  feature) when nothing is a real match. */
export function matchHelp(question: unknown): HelpMatch {
  const q = norm(question);
  if (!q) {
    return {
      matched: false, id: null, question: 'How can we help?',
      answer: 'Ask a "how do I…?" question — like changing your hours, sending a broadcast, or setting up booking — and I’ll point you to the right place. Or open the full Help.',
      links: HELP_FALLBACK_LINKS, low_confidence: false,
    };
  }
  let best: HelpTopic | null = null;
  let bestScore = 0;
  for (const t of HELP_TOPICS) {
    const s = scoreTopic(t, q);
    if (s > bestScore) { bestScore = s; best = t; }
  }
  if (!best || bestScore === 0) {
    return {
      matched: false, id: null, question: String(question ?? '').slice(0, 300),
      answer: 'I don’t have a canned answer for that one — I’d rather point you to a real person than guess. Open the full Help, or email us and someone who knows the product will help.',
      links: HELP_FALLBACK_LINKS, low_confidence: false,
    };
  }
  return {
    matched: true, id: best.id, question: best.q, answer: best.a,
    // every answer also offers the full-Help door, without duplicating a link
    links: [...best.links, ...HELP_FALLBACK_LINKS.filter((f) => !best!.links.some((l) => l.href === f.href))],
    low_confidence: bestScore <= 1,   // a single incidental word — hedge honestly
  };
}

/** The plain-text help corpus (every curated answer) — the grounding an optional
 *  LLM polish is checked against, so a reword can never introduce a claim that
 *  isn't already in our own help copy. */
export function helpCorpus(): string {
  return HELP_TOPICS.map((t) => t.q + ' ' + t.a).join('\n');
}
