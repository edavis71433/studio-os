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
    logo?: MediaRef | null;
    og_image?: MediaRef | null;
    announcement?: { text: string; url?: string; expires_at?: string | null };
  };
  offerings: Array<{ id: string; name: string; category: string; description?: string; price_text?: string; media?: MediaRef | null; sort_order?: number; is_visible?: boolean }>;
  testimonials: Array<{ id: string; quote: string; author: string; source?: string; quote_date?: string; sort_order?: number }>;
  faqs: Array<{ id: string; question: string; answer: string; sort_order?: number }>;
  posts: Array<{ id: string; title: string; slug: string; body_md: string; excerpt?: string; hero?: MediaRef | null; published_at: string }>;
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

/** A media reference resolved at snapshot time: deterministic output paths per variant. */
export interface MediaRef {
  alt: string;
  /** variant name -> site-relative output path (e.g. { w800: "/img/ab12cd-800.webp" }) */
  variants: Record<string, string>;
  width?: number; height?: number;
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
