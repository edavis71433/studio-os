// ── The frozen rendering contract (M3.5 §3 / M3.75) ─────────────────────────
//   render(snapshot, manifest, siteConfig) → FileMap
// The renderer knows nothing about Netlify, HTTP, auth, databases, or users.
// Pure: no network, no clock beyond snapshot timestamps, no randomness.

/** path -> file contents. Text files as strings; binary (none in 1.0.0) as bytes. */
export type FileMap = Record<string, string | Uint8Array>;

export interface SiteConfig {
  /** canonical absolute origin, no trailing slash, e.g. https://bacchuskitchen.com */
  baseUrl: string;
  /** reserved seams (M3.5 ⟐4) — optional now, additive later */
  locale?: string;
  brand?: { credit?: string };
  /** inquiry-form endpoint; when absent the contact page renders a mailto CTA (M5 wires it) */
  formEndpoint?: string;
  /** Phase BK: the public native-booking API base (…/book/:siteId); the booking
   *  block's first-party enhancer reads it to call /types, /slots, and POST a booking. */
  bookEndpoint?: string;
  /** AN-2: the site id, baked into the injected first-party analytics tracker. */
  siteId?: string;
}

export interface HoursInterval { open: string; close: string }
export interface HoursDay { day: string; closed: boolean; intervals: HoursInterval[] }
export interface HolidayException { date: string; label: string; closed: boolean; intervals?: HoursInterval[] }

export interface LocationContent {
  address_line1: string; address_line2?: string; city: string; region: string;
  postal_code: string; country: string; phone?: string; timezone: string;
  hours: HoursDay[]; holiday_exceptions?: HolidayException[];
  temporarily_closed?: boolean; temporarily_closed_note?: string;
}

export interface SnapshotContent {
  identity: {
    business_name: string; description: string; phone: string; email: string;
    tagline?: string; story?: string; service_area?: string;
    booking_url?: string; ordering_url?: string;
    social?: Record<string, string>;
    seo_title?: string; seo_description?: string;
  };
  /** M7 (reconciliation §9): locations is a LIST — v1 carries exactly one.
   *  Multi-location becomes an additive change, not a contract major. */
  locations: LocationContent[];
  /** M7: presentation settings — offering section (category) display order.
   *  Phase V (additive, all optional): logo (header/favicon/OG fallback), the
   *  chosen share image, and the announcement bar. Old snapshots lack them and
   *  render exactly as before. */
  settings?: {
    category_order?: string[];
    /** Phase T3: the business industry (lib/industry_vocab key) — templates read vocabFor(industry). */
    industry?: string;
    /** Phase Z: search-engine ownership tokens (meta tags at render). */
    verification?: { google?: string; bing?: string };
    logo?: MediaRef | null;
    og_image?: MediaRef | null;
    cover?: MediaRef | null;   // owner-chosen hero image (preferred over the auto-pick)
    announcement?: { text: string; url?: string; expires_at?: string | null };
    /** Phase CP-2 Design Studio: structured layout choices (all optional/additive). */
    hero_layout?: string;
    nav_style?: string;
    sections?: { hidden: string[]; order: string[] };
    footer?: { hours: boolean; social: boolean };
    /** Phase SD: page keys hidden from search (noindex + out of the sitemap). */
    pages_noindex?: string[];
    /** Phase SD: per-page search headline/description overrides, keyed by page. */
    page_seo?: Record<string, { title?: string; description?: string }>;
    /** Phase T-BLOCKS: optional structured content blocks the owner turned on and
     *  filled (validated + capped at serialize time). Rendered deterministically as
     *  home sections; each carries its own schema.org + a11y. Never free-form HTML. */
    blocks?: SiteBlock[];
  };
  offerings: Array<{ id: string; name: string; category: string; description?: string; price_text?: string; media?: MediaRef | null; sort_order?: number; is_visible?: boolean }>;
  testimonials: Array<{ id: string; quote: string; author: string; source?: string; quote_date?: string; sort_order?: number }>;
  faqs: Array<{ id: string; question: string; answer: string; sort_order?: number }>;
  posts: Array<{ id: string; title: string; slug: string; body_md: string; excerpt?: string; hero?: MediaRef | null; published_at: string; noindex?: boolean; tags?: string[] }>;
  redirects: Array<{ from_path: string; to_path: string }>;
  // voice is present in the snapshot but marked private — the renderer MUST NOT read it.
}

/** Upgrade any pre-M7 snapshot content in place: `location` scalar → `locations` list.
 *  Deterministic and idempotent; lets retained staging-era snapshots stay viewable.
 *  Also guarantees every section exists (degenerate pre-contract snapshots are
 *  retained forever in history — reading one must never crash the room). */
export function normalizeSnapshotContent(c: any): SnapshotContent {
  if (c && !Array.isArray(c.locations)) {
    c.locations = c.location ? [c.location] : [];
    delete c.location;
  }
  if (c) {
    if (!c.settings) c.settings = {};
    if (!c.identity || typeof c.identity !== 'object') c.identity = {};
    for (const k of ['offerings', 'testimonials', 'faqs', 'posts', 'redirects']) {
      if (!Array.isArray(c[k])) c[k] = [];
    }
  }
  return c as SnapshotContent;
}

/** True when a retained snapshot carries real contract-shaped content — the
 *  minimum to view or restore it. Pre-contract probe/degenerate snapshots fail. */
export function snapshotContentUsable(c: any): boolean {
  return !!(c && typeof c === 'object' && c.identity && typeof c.identity === 'object'
    && typeof c.identity.business_name === 'string' && c.identity.business_name.trim());
}

// ── Phase T-BLOCKS: structured content blocks (data only; logic in lib/site_blocks.ts) ──
// Each block is a chosen-and-filled entry from the site_components catalog. Text-only
// in v1 (no media plumbing), typed + capped, so the render stays deterministic.
export interface SiteBlockFeatures { type: 'features'; title?: string; items: Array<{ title: string; text?: string }> }
export interface SiteBlockStats { type: 'stats'; title?: string; items: Array<{ value: string; label: string }> }
export interface SiteBlockTeam { type: 'team'; title?: string; members: Array<{ name: string; role?: string; bio?: string; media?: MediaRef | null }> }
export interface SiteBlockProcess { type: 'process'; title?: string; steps: Array<{ step: string; detail?: string }> }
export interface SiteBlockPricing { type: 'pricing'; title?: string; tiers: Array<{ name: string; price_text?: string; features: string[] }> }
export interface SiteBlockCertifications { type: 'certifications'; title?: string; items: Array<{ name: string; issuer?: string }> }
export interface SiteBlockServiceAreas { type: 'service_areas'; title?: string; areas: string[] }
export interface SiteBlockCtaBanner { type: 'cta'; text: string; button?: string; url?: string }
// FD-T17 media-bearing blocks (render-facing: media already resolved to MediaRef via the serializer's ref()).
export interface SiteBlockGallery { type: 'gallery'; title?: string; images: MediaRef[] }
export interface SiteBlockBeforeAfter { type: 'before_after'; title?: string; items: Array<{ before: MediaRef; after: MediaRef; caption?: string }> }
export interface SiteBlockVideo { type: 'video'; title?: string; url: string; caption?: string; poster?: MediaRef | null }
// Trust/action blocks (previously dormant catalog entries, now realized)
export interface SiteBlockPartners { type: 'partners'; title?: string; logos: MediaRef[] }
export interface SiteBlockReviews { type: 'reviews'; title?: string; rating: number; count: number; source?: string }
// Phase RV: the NATIVE reviews wall (distinct from `reviews`, which is a static,
// owner-typed rating badge). This block shows REAL customer reviews collected +
// approved through the reputation loop (routes/reviews.ts). The block itself stores
// only display config (an optional heading + how many to show); the approved reviews
// + their HONEST aggregate are baked in at serialize time (approved rows only), so
// the render is pure and the schema.org (AggregateRating + Review) is truthful.
export interface ReviewDisplayItem { author: string; rating: number; body: string; reply?: string; date?: string }
export interface SiteBlockReviewsWall {
  type: 'reviews_wall';
  title?: string;
  reviews: ReviewDisplayItem[];                // resolved at serialize time (approved only)
  aggregate: { count: number; average: number }; // HONEST: only approved rows, real counts
}
export interface SiteBlockAppointment { type: 'appointment'; title?: string; text?: string; button?: string; url: string }
// Phase BK: the NATIVE booking widget (distinct from `appointment`, which is a
// link-OUT button to a third-party scheduler). This block renders a calm, mobile-
// first, first-party booking widget (pick service → day → open slot → details →
// confirm) driven by the site's own public /book/:siteId endpoints — zero external
// origins. Services + availability live in the DB (not the block), so the block
// itself carries only an optional heading + intro.
export interface SiteBlockBooking { type: 'booking'; title?: string; intro?: string }
// Growth blocks (T-BLOCKS r2) — link-out only, zero external origins on the page.
export interface SiteBlockNewsletter { type: 'newsletter'; title?: string; text?: string; button?: string; url: string }
export interface SiteBlockSocial { type: 'social'; title?: string; links: Array<{ network: string; url: string }> }
export interface SiteBlockEvents { type: 'events'; title?: string; items: Array<{ name: string; date: string; time?: string; detail?: string; url?: string }> }
export interface SiteBlockMap { type: 'map'; title?: string; image?: MediaRef | null; address?: string; directions_url?: string }
// Text & layout staples (T-BLOCKS r3) — prose bodies render through renderMarkdown
// (escape-first, output-allowlisted); media resolved to MediaRef; links via safeHref.
export interface SiteBlockRichText { type: 'richtext'; title?: string; body: string }
// `decorative`: an explicit a11y choice — a purely decorative image renders alt=""
// + role="presentation" (announced by nothing), instead of carrying its media alt.
export interface SiteBlockImage { type: 'image'; title?: string; image?: MediaRef | null; caption?: string; alt?: string; link?: string; decorative?: boolean }
export interface SiteBlockImageText { type: 'image_text'; title?: string; image?: MediaRef | null; body: string; side: 'left' | 'right'; button?: { label: string; url: string } }
export interface SiteBlockAccordion { type: 'accordion'; title?: string; items: Array<{ summary: string; body: string }> }
export interface SiteBlockButtons { type: 'buttons'; title?: string; buttons: Array<{ label: string; url: string; style: 'primary' | 'outline' }> }
export interface SiteBlockDivider { type: 'divider'; style: 'line' | 'space'; size: 'small' | 'medium' | 'large' }
// Layout & utility blocks (T-BLOCKS r4). Columns + Cards are MULTI-INSTANCE (like
// `form`): each carries its own stable `id` so a site may hold several, keyed by id.
// Columns: 2–3 equal columns, each a small stack (markdown + optional image + button);
// stacks to one column on mobile. Cards: a repeatable teaser grid (image + heading +
// text + optional link). Download: an accessible link to a media-library file. Toc:
// an auto-built "On this page" jump list, computed at render from section headings.
export interface SiteBlockColumns { type: 'columns'; id: string; title?: string; columns: Array<{ body: string; image?: MediaRef | null; button?: { label: string; url: string } }> }
export interface SiteBlockCards { type: 'cards'; id: string; title?: string; cards: Array<{ heading: string; text?: string; image?: MediaRef | null; link?: string }> }
export interface SiteBlockDownload { type: 'download'; title?: string; file?: MediaRef | null; label?: string }
export interface SiteBlockToc { type: 'toc'; title?: string }
// Custom form builder (Phase FB): a typed, structured, whitelisted form (never a
// code box). The full shape + validation live in lib/forms.ts; a form block is a
// stored FormDefinition. Multiple forms per site are allowed (unlike other block
// types), each keyed by its own id. See lib/forms.ts for the normalization gate.
export type { FormDefinition as SiteBlockForm } from './forms.ts';
import type { FormDefinition } from './forms.ts';
// ── Phase T-STYLE: curated per-section style options (owner picks from an enumerated
// set; never raw CSS). Optional + orthogonal to a block's content, so a block with no
// `look` renders byte-identically to before. Each field maps to ONE emitted CSS class
// (see lib/site_blocks.ts): background (brand-tint / plain vs the auto-alternate default),
// full-bleed width, vertical spacing, and center alignment. Contrast stays a platform
// guarantee — the tint is derived + contrast-checked (lib/palettes.ts brandTint). ──
export interface BlockLook {
  /** 'tinted' = a brand-derived, contrast-safe light wash; 'plain' = no background
   *  (clears the auto-alternate band); omitted = the template's default. */
  background?: 'tinted' | 'plain';
  /** 'full' = edge-to-edge section; inner content still capped for readability. */
  width?: 'full';
  /** vertical padding vs the default. */
  spacing?: 'tight' | 'roomy';
  /** 'center' = center the section heading + short text. */
  align?: 'center';
}
/** Distributive conditional: adds an optional `look` to EVERY union member while
 *  preserving the `type` discriminant (so `switch (b.type)` narrowing keeps working).
 *  Also carries the optional auto-expiring window (Phase EXP: show_from / show_until,
 *  canonical ISO instants) — the render omits a section outside its window at
 *  snapshot.created_at; a section with no window renders exactly as before. */
type WithLook<T> = T extends unknown ? T & { look?: BlockLook; show_from?: string; show_until?: string } : never;
export type SiteBlock = WithLook<
  | SiteBlockFeatures | SiteBlockStats | SiteBlockTeam | SiteBlockProcess
  | SiteBlockPricing | SiteBlockCertifications | SiteBlockServiceAreas | SiteBlockCtaBanner
  | SiteBlockGallery | SiteBlockBeforeAfter | SiteBlockVideo
  | SiteBlockPartners | SiteBlockReviews | SiteBlockReviewsWall | SiteBlockAppointment | SiteBlockBooking
  | SiteBlockNewsletter | SiteBlockSocial | SiteBlockEvents | SiteBlockMap
  | SiteBlockRichText | SiteBlockImage | SiteBlockImageText | SiteBlockAccordion | SiteBlockButtons | SiteBlockDivider
  | SiteBlockColumns | SiteBlockCards | SiteBlockDownload | SiteBlockToc
  | FormDefinition
>;
export type SiteBlockType = SiteBlock['type'];

/** A media reference resolved at snapshot time: deterministic output paths per variant. */
export interface MediaRef {
  alt: string;
  /** variant name -> site-relative output path (e.g. { w800: "/img/ab12cd-800.webp" }) */
  variants: Record<string, string>;
  width?: number; height?: number;
  /** Phase CP-2: focal point (0-100 %) for cropped presentations. */
  focal?: { x: number; y: number };
}

/** Phase B1: the Developer-Mode presentation layer, a SIBLING of content in the
 *  snapshot (never inside the structured-content contract). Present only when a
 *  site has customization; absent → render is byte-identical to before. Values
 *  are already sanitized (at save AND at serialize time), so the renderer treats
 *  them as inert data. This is what makes a developer edit part of the ONE
 *  snapshot → one render → same bytes → same rollback/restore/preview. */
export interface SnapshotDevLayer {
  theme_tokens: Record<string, string>;
  custom_css: string;
  custom_html: string;
}

export interface Snapshot {
  content: SnapshotContent;
  content_contract_version: number;
  template_slug: string;
  template_version: string;
  created_at: string;
  /** optional presentation layer (Developer Mode); omitted when empty */
  dev_customization?: SnapshotDevLayer | null;
}

export interface TemplateManifest {
  name: string;
  slug: string;
  version: string;
  content_contract_version: number;
  pages: Array<{ path: string; kind: string }>;
  entities: Record<string, { required?: string[]; max?: number }>;
  image_variants: Record<string, { width: number; format: string }>;
  validation: { blockers: string[]; warnings: string[] };
  preview_fixture: string; // module-relative path to the canonical fixture
}

export type RenderFn = (snapshot: Snapshot, manifest: TemplateManifest, site: SiteConfig) => FileMap;
