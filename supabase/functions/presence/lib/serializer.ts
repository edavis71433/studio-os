// ── Snapshot serializer — the ONE way draft state becomes render input ──────
// Preview serializes in memory; publish persists the same object to
// presence_snapshots. There is no second serialization path, ever.
//
// Reads canonical draft rows (service role — full view incl. hidden rows it
// must EXCLUDE), builds the exact SnapshotContent shape the renderer contract
// consumes, computes the media manifest (deterministic output paths per
// variant), and stamps contract/template versions + timestamp.
import { svc } from './db.ts';
import { isImageMime } from './media.ts';
import type { Snapshot, SnapshotContent, MediaRef, TemplateManifest, SnapshotDevLayer } from './render_types.ts';
import { validateThemeTokens, sanitizeDevCss, sanitizeDevHtml } from './devmode.ts';
import { validateBlocks, resolveBlockMedia } from './site_blocks.ts';
import { linkedRefIds, resolveLinkedBlocks } from './linked_sections.ts';
import { RESERVED_PAGE_SLUGS } from './page_ops.ts';
import { aggregateApproved, shapeReviewsForDisplay } from './reviews.ts';
import { normalizeTags } from './search_index.ts';

export const CONTENT_CONTRACT_VERSION = 1;

interface MediaRow { id: string; storage_path: string; alt_text: string; mime?: string | null; width: number | null; height: number | null; focal_x?: number | null; focal_y?: number | null }

// deterministic variant output path: /img/<fnv(storage_path)>-<width>.<format>
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h = (h ^ s.charCodeAt(i)) >>> 0; h = (h * 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
/** The image formats we publish, in ascending preference (browser picks the first
 *  it supports, WebP is the universal fallback). AVIF sits alongside WebP at the
 *  SAME widths — self-hosted variants only, so the render can offer both. The
 *  `original` pseudo-format means "deploy the raw object unchanged" — used for
 *  NON-image files (a PDF download), which have no image transform. */
export type VariantFormat = 'webp' | 'avif' | 'original';
export function variantPath(storagePath: string, width: number, format: VariantFormat = 'webp'): string {
  return `/img/${fnv(storagePath)}-${width}.${format}`;
}
// DL-FILES: the deterministic served path for a NON-image original (e.g. a PDF the
// owner offers via a Download block). Same fnv(storage_path) keying as variantPath,
// so the render, the manifest, and the deploy all agree on ONE stable path. Served
// verbatim from the deploy — Netlify sets the content-type from the extension.
const ORIGINAL_EXT: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export function originalPath(storagePath: string, mime: string): string {
  const dot = storagePath.lastIndexOf('.');
  const tail = dot >= 0 ? storagePath.slice(dot + 1) : '';
  const ext = ORIGINAL_EXT[mime] || (tail && !tail.includes('/') ? tail : 'bin');
  return `/files/${fnv(storagePath)}.${ext}`;
}

export interface MediaManifestEntry {
  media_id: string;
  storage_path: string;
  variants: Array<{ name: string; width: number; format: VariantFormat; output_path: string }>;
}

function toRef(m: MediaRow | undefined, manifest: TemplateManifest): MediaRef | null {
  if (!m) return null;
  // DL-FILES: a NON-image file (a PDF document) has no image transform — it carries
  // no `variants` and instead points at its ORIGINAL, deployed verbatim. Images are
  // byte-identical to before (variants only, no `original`). This is what lets a
  // Download block's PDF actually serve, and stops the publish from trying to
  // image-transform a document (which fails the whole deploy).
  const isImg = isImageMime(String(m.mime ?? ''));
  const variants: Record<string, string> = {};
  if (isImg) for (const [name, v] of Object.entries(manifest.image_variants)) variants[name] = variantPath(m.storage_path, v.width);
  return {
    alt: m.alt_text, variants, width: m.width ?? undefined, height: m.height ?? undefined,
    ...(isImg ? {} : { original: originalPath(m.storage_path, String(m.mime ?? '')) }),
    // Phase CP-2: focal point (0-100 %) — consumed wherever a template crops
    ...(Number.isFinite(Number(m.focal_x)) && Number.isFinite(Number(m.focal_y)) ? { focal: { x: Math.min(100, Math.max(0, Number(m.focal_x))), y: Math.min(100, Math.max(0, Number(m.focal_y))) } } : {}),
  };
}

/** Build the sanitized dev layer from the raw row, or null when there's nothing
 *  to apply — so the snapshot omits it entirely (byte-identical to no-dev). Pure. */
export function buildDevLayer(row: { theme_tokens?: unknown; custom_css?: unknown; custom_html?: unknown } | undefined): SnapshotDevLayer | null {
  if (!row) return null;
  const theme_tokens = validateThemeTokens(row.theme_tokens).tokens;
  const custom_css = sanitizeDevCss(String(row.custom_css ?? ''));
  const custom_html = sanitizeDevHtml(String(row.custom_html ?? ''));
  if (Object.keys(theme_tokens).length === 0 && !custom_css.trim() && !custom_html.trim()) return null;
  return { theme_tokens, custom_css, custom_html };
}

// Wave-1 G7: per-page SHARE image — the owner stores a media ID in
// page_seo[key].share_image; the snapshot must carry a RESOLVED site-relative
// variant path (through the ONE ref() pipeline, so it lands in the media
// manifest and gets variants like every other image). A page_seo with no
// share_image passes through UNTOUCHED — byte-identical snapshots for every
// existing site. An unknown/deleted media id is dropped (never a broken og:).
const SHARE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type PageSeoMap = NonNullable<NonNullable<SnapshotContent['settings']>['page_seo']>;
function resolvePageSeoShare(rawPageSeo: unknown, ref: (id: string | null | undefined) => MediaRef | null): PageSeoMap {
  const raw = (rawPageSeo && typeof rawPageSeo === 'object' && !Array.isArray(rawPageSeo)) ? rawPageSeo as Record<string, unknown> : {};
  const hasShareImage = Object.values(raw).some((v) => !!v && typeof v === 'object' && (v as { share_image?: unknown }).share_image);
  if (!hasShareImage) return raw as PageSeoMap;   // byte-identical passthrough (the common case)
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => {
    const entry = (v && typeof v === 'object') ? v as Record<string, unknown> : null;
    if (!entry || !entry.share_image) return [k, v];
    const out = { ...entry };
    const id = String(entry.share_image);
    const m = SHARE_UUID_RE.test(id) ? ref(id) : null;
    const path = m?.variants?.w1600 || m?.variants?.w800 || Object.values(m?.variants ?? {})[0];
    if (path) out.share_image = path; else delete out.share_image;
    return [k, out];
  })) as PageSeoMap;
}

export async function serializeDraft(siteId: string, manifest: TemplateManifest, opts: { templateSlug: string; templateVersion: string; now: string }): Promise<{ snapshot: Snapshot; mediaManifest: MediaManifestEntry[] }> {
  const q = (p: string) => svc(p).then((r) => (Array.isArray(r.json) ? r.json : []));
  const [identArr, locArr, offerings, testimonials, faqs, posts, media, redirects, settingsArr, devArr, reviewsArr] = await Promise.all([
    q(`presence_identity?site_id=eq.${siteId}&limit=1`),
    q(`presence_locations?site_id=eq.${siteId}&order=created_at.asc`),
    q(`presence_offerings?site_id=eq.${siteId}&deleted_at=is.null&is_visible=is.true&order=sort_order.asc,created_at.asc`),
    q(`presence_testimonials?site_id=eq.${siteId}&deleted_at=is.null&is_visible=is.true&order=sort_order.asc,created_at.asc`),
    q(`presence_faqs?site_id=eq.${siteId}&deleted_at=is.null&is_visible=is.true&order=sort_order.asc,created_at.asc`),
    q(`presence_posts?site_id=eq.${siteId}&deleted_at=is.null&status=eq.published&order=published_at.desc`),
    q(`presence_media?site_id=eq.${siteId}&deleted_at=is.null&select=id,storage_path,alt_text,mime,width,height,focal_x,focal_y`),
    q(`presence_redirects?site_id=eq.${siteId}&order=from_path.asc&select=from_path,to_path`),
    q(`presence_settings?site_id=eq.${siteId}&limit=1`),
    q(`presence_dev_customizations?site_id=eq.${siteId}&select=theme_tokens,custom_css,custom_html&limit=1`),
    // Phase RV: approved reviews ONLY — baked into the reviews_wall block so the render
    // is pure and the schema.org is honest. Deploy-order-tolerant: pre-0101 this table
    // is absent → q() returns [] → no reviews_wall renders (nothing fabricated).
    q(`presence_reviews?site_id=eq.${siteId}&status=eq.approved&order=approved_at.desc,created_at.desc&select=reviewer_name,rating,body,owner_reply,status,approved_at,created_at&limit=500`),
  ]);
  // Phase RV: resolve the approved reviews → display items + HONEST aggregate (only
  // approved rows, real counts). Passed to resolveBlockMedia as extras so the reviews_wall
  // block can render + carry its schema without the pure engine reading the DB.
  const approvedReviews = reviewsArr as any[];
  const reviewsWall = approvedReviews.length
    ? { items: shapeReviewsForDisplay(approvedReviews, 24), aggregate: aggregateApproved(approvedReviews) }
    : undefined;

  const mediaById = new Map<string, MediaRow>((media as MediaRow[]).map((m) => [m.id, m]));
  const usedMedia = new Set<string>();
  const ref = (id: string | null | undefined): MediaRef | null => {
    if (!id) return null;
    const m = mediaById.get(id);
    if (m) usedMedia.add(m.id);
    return toRef(m, manifest);
  };

  const ident = identArr[0] || {};
  const settings = settingsArr[0] || {};

  // CL-LINK: resolve any "linked" sections to the CURRENT content of their library
  // item (single source, update-once). The impure read lives HERE; the pure engine
  // (validateBlocks → resolveBlockMedia) is unchanged, so a copy-inserted block and
  // a linked one render identically. No links → no query, byte-identical to before.
  const rawBlocks: unknown[] = Array.isArray(settings.blocks) ? settings.blocks : [];
  // Multi-page: owner-created pages carry their own block arrays. Collect linked
  // refs across the home page AND every custom page so one library query resolves
  // them all (a linked section can appear on any page).
  const rawPages: any[] = Array.isArray(settings.pages) ? settings.pages : [];
  const allRawForLinks: unknown[] = rawBlocks.slice();
  for (const p of rawPages) if (Array.isArray(p?.blocks)) allRawForLinks.push(...p.blocks);
  const refIds = linkedRefIds(allRawForLinks);
  const libMap = new Map<string, unknown>();
  if (refIds.length) {
    const libRows = await q(`presence_content_library?site_id=eq.${siteId}&id=in.(${refIds.join(',')})&select=id,payload`);
    for (const r of libRows as Array<{ id: string; payload: unknown }>) libMap.set(r.id, r.payload);
  }
  const resolvedBlocks = resolveLinkedBlocks(rawBlocks, (id) => libMap.get(id) ?? null);
  // Build the custom pages: each page's blocks run through the SAME validate →
  // resolve pipeline as the home blocks, so they're identical structured/safe blocks.
  // Slugs are made URL-safe + unique and can never collide with a template's built-in
  // pages (about/contact/services/faq/updates/…). Capped at 20.
  const pageSlug = (raw: unknown): string => String(raw ?? '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const seenSlugs = new Set<string>();
  const customPages = rawPages.slice(0, 20).map((p: any) => {
    const slug = pageSlug(p?.slug || p?.title);
    if (!slug || RESERVED_PAGE_SLUGS.has(slug) || seenSlugs.has(slug)) return null;
    seenSlugs.add(slug);
    const title = (String(p?.title || '').trim().slice(0, 80)) || slug;
    const pResolved = resolveLinkedBlocks(Array.isArray(p?.blocks) ? p.blocks : [], (id) => libMap.get(id) ?? null);
    const blocks = resolveBlockMedia(validateBlocks(pResolved), ref, reviewsWall ? { reviewsWall } : undefined);
    return p?.hideNav === true ? { slug, title, blocks, hideNav: true } : { slug, title, blocks };
  }).filter((p): p is { slug: string; title: string; blocks: ReturnType<typeof resolveBlockMedia> } => !!p);

  // Editable GLOBAL nav (the header/footer are global — one edit changes every page).
  // Each item: a trimmed/capped label + a SAFE href — an internal path ("/", "/x/") or
  // an https/mailto/tel URL only (never javascript:/data:/raw markup). A single level
  // of dropdown children is allowed. Empty/all-invalid → absent (template default nav).
  const navHref = (raw: unknown): string | null => {
    const v = String(raw ?? '').trim();
    if (!v) return null;
    if (v === '/' || /^\/[a-z0-9][a-z0-9-]*\/$/.test(v)) return v;              // home or a single-segment internal page
    if (/^https:\/\/[^\s<>"']+$/i.test(v)) return v.slice(0, 300);              // external https
    if (/^mailto:[^\s<>"']+$/i.test(v) || /^tel:[+0-9()\-.\s]+$/i.test(v)) return v.slice(0, 300);
    return null;
  };
  const navItem = (it: any): { label: string; href: string } | null => {
    const label = String(it?.label ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
    const href = navHref(it?.href);
    return label && href ? { label, href } : null;
  };
  const rawNav: any[] = Array.isArray(settings.nav) ? settings.nav : [];
  const customNav = rawNav.slice(0, 12).map((it: any) => {
    const top = navItem(it); if (!top) return null;
    const kids = (Array.isArray(it?.children) ? it.children : []).slice(0, 8).map(navItem).filter(Boolean) as Array<{ label: string; href: string }>;
    return kids.length ? { ...top, children: kids } : top;
  }).filter(Boolean) as Array<{ label: string; href: string; children?: Array<{ label: string; href: string }> }>;

  const content: SnapshotContent = {
    identity: {
      business_name: ident.business_name || '', description: ident.description || '',
      phone: ident.phone || '', email: ident.email || '', tagline: ident.tagline || '',
      story: ident.story || '', service_area: ident.service_area || '',
      booking_url: ident.booking_url || '', ordering_url: ident.ordering_url || '',
      social: ident.social || {}, seo_title: ident.seo_title || '', seo_description: ident.seo_description || '',
    },
    // locations is a LIST by contract (reconciliation §9) — v1 carries one
    locations: (locArr as any[]).map((loc) => ({
      address_line1: loc.address_line1 || '', address_line2: loc.address_line2 || '',
      city: loc.city || '', region: loc.region || '', postal_code: loc.postal_code || '',
      country: loc.country || 'US', phone: loc.phone || '', timezone: loc.timezone || 'America/Los_Angeles',
      hours: loc.hours || [], holiday_exceptions: loc.holiday_exceptions || [],
      temporarily_closed: !!loc.temporarily_closed, temporarily_closed_note: loc.temporarily_closed_note || '',
    })),
    settings: {
      category_order: Array.isArray(settings.category_order) ? settings.category_order : [],
      industry: String(settings.industry_key || 'generic'),   // Phase T3: templates read vocabFor(industry)
      // Phase CP-2 Design Studio: structured layout choices
      hero_layout: String(settings.hero_layout || ''),
      nav_style: String(settings.nav_style || ''),
      sections: {
        hidden: Array.isArray(settings.sections_hidden) ? settings.sections_hidden.map(String).slice(0, 24) : [],
        order: Array.isArray(settings.sections_order) ? settings.sections_order.map(String).slice(0, 24) : [],
      },
      // Phase T-BLOCKS: validated + capped structured blocks (authoritative boundary);
      // FD-T17 resolves any block media IDs → MediaRefs via the SAME ref() (so block
      // photos land in the media manifest and get variants — one media pipeline).
      blocks: resolveBlockMedia(validateBlocks(resolvedBlocks), ref, reviewsWall ? { reviewsWall } : undefined),
      // Multi-page: only present when the owner has custom pages (absent = byte-identical).
      ...(customPages.length ? { pages: customPages } : {}),
      // Editable global nav — only present when the owner set one (absent = default nav).
      ...(customNav.length ? { nav: customNav } : {}),
      footer: { hours: settings.footer_hours !== false, social: settings.footer_social !== false },
      // Phase SD: per-page search visibility + overrides
      // cap must cover the worst case: 5 built-in pages + up to 20 builder pages
      // ("page:<slug>" keys, writable per-page since slice B) — a 12-entry slice
      // silently un-hid pages the owner explicitly hid.
      pages_noindex: Array.isArray(settings.pages_noindex) ? settings.pages_noindex.map(String).slice(0, 32) : [],
      page_seo: resolvePageSeoShare(settings.page_seo, ref),
      // Phase Z: ownership-verification tokens (emitted as meta tags when set)
      ...(String(settings.google_site_verification || '').trim() || String(settings.bing_site_verification || '').trim()
        ? { verification: { google: String(settings.google_site_verification || '').trim() || undefined, bing: String(settings.bing_site_verification || '').trim() || undefined } }
        : {}),
      // Phase V no-code essentials — through ref() so variants land in the media manifest
      logo: ref(settings.logo_media_id),
      og_image: ref(settings.og_media_id),
      cover: ref(settings.cover_media_id),   // the owner's chosen hero image (preferred over an auto-pick)
      ...(String(settings.announcement_text || '').trim()
        ? { announcement: { text: String(settings.announcement_text).trim(), url: String(settings.announcement_url || '').trim() || undefined, expires_at: settings.announcement_expires_at || null } }
        : {}),
    },
    offerings: offerings.map((o: any) => ({ id: o.id, name: o.name, category: o.category, description: o.description || '', price_text: o.price_text || '', media: ref(o.media_id), sort_order: o.sort_order })),
    testimonials: testimonials.map((t: any) => ({ id: t.id, quote: t.quote, author: t.author, source: t.source || '', quote_date: t.quote_date || undefined, sort_order: t.sort_order })),
    faqs: faqs.map((f: any) => ({ id: f.id, question: f.question, answer: f.answer, sort_order: f.sort_order })),
    // Phase SEARCH: flat tags on updates. normalizeTags is the ONE gate; deploy-order
    // tolerant — pre-0102 the `tags` column is absent → p.tags is undefined → [].
    posts: posts.map((p: any) => ({ id: p.id, title: p.title, slug: p.slug, body_md: p.body_md, excerpt: p.excerpt || '', hero: ref(p.hero_media_id), published_at: p.published_at || p.updated_at, noindex: p.noindex === true, tags: normalizeTags(p.tags) })),
    redirects: redirects.map((r: any) => ({ from_path: r.from_path, to_path: r.to_path })),
  };

  const mediaManifest: MediaManifestEntry[] = [...usedMedia].sort().map((id) => {
    const m = mediaById.get(id)!;
    // DL-FILES: a NON-image file (a PDF Download) is deployed as its ORIGINAL, byte
    // for byte — NEVER image-transformed (that would fail the deploy). Images keep
    // the exact same variant manifest as before, so their output is byte-identical.
    if (!isImageMime(String(m.mime ?? ''))) {
      return {
        media_id: m.id, storage_path: m.storage_path,
        variants: [{ name: 'original', width: 0, format: 'original' as VariantFormat, output_path: originalPath(m.storage_path, String(m.mime ?? '')) }],
      };
    }
    return {
      media_id: m.id, storage_path: m.storage_path,
      // Emit BOTH formats at every width: WebP (universal) + AVIF (smaller, modern).
      // The render offers both via <picture>; fetchVariants generates both files.
      variants: Object.entries(manifest.image_variants).flatMap(([name, v]) => ([
        { name, width: v.width, format: 'webp' as VariantFormat, output_path: variantPath(m.storage_path, v.width, 'webp') },
        { name: `${name}_avif`, width: v.width, format: 'avif' as VariantFormat, output_path: variantPath(m.storage_path, v.width, 'avif') },
      ])),
    };
  });

  // Phase B1: the Developer-Mode layer rides in the snapshot as a sibling of
  // content. Re-sanitize here so the snapshot always carries inert values even
  // if the row were somehow tampered; omit entirely when empty so a site with no
  // customization produces a byte-identical snapshot (no version churn).
  const devCustomization = buildDevLayer(devArr[0]);

  const snapshot: Snapshot = {
    content,
    content_contract_version: CONTENT_CONTRACT_VERSION,
    template_slug: opts.templateSlug,
    template_version: opts.templateVersion,
    created_at: opts.now,
    ...(devCustomization ? { dev_customization: devCustomization } : {}),
  };
  return { snapshot, mediaManifest };
}
