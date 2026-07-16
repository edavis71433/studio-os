// ── Phase T-BLOCKS · the structured block library, REALIZED ───────────────────
// site_components.ts is the CATALOG (blocks as data). This file is the single
// place that (a) validates a stored block list into safe, capped, typed instances
// and (b) renders each block to deterministic HTML with its correct schema.org +
// accessibility contract. Every template calls the SAME renderer — there is no
// second block-render path, so a block looks and validates identically everywhere.
//
// Constitution-safe: these are CHOSEN-AND-FILLED structured blocks (typed fields →
// deterministic render), never free-form layout or runtime code. Text-only in v1.
// Pure: no I/O, no clock, no randomness. The catalog (COMPONENTS) is the authority
// for which block types exist; the test suite asserts this file only realizes keys
// that the catalog declares.

import type {
  SiteBlock, SiteBlockType, SiteBlockFeatures, SiteBlockStats, SiteBlockTeam,
  SiteBlockProcess, SiteBlockPricing, SiteBlockCertifications, SiteBlockServiceAreas, SiteBlockCtaBanner,
  SiteBlockGallery, SiteBlockBeforeAfter, SiteBlockVideo, MediaRef,
  SiteBlockPartners, SiteBlockReviews, SiteBlockReviewsWall, SiteBlockAppointment, SiteBlockBooking,
  SiteBlockNewsletter, SiteBlockSocial, SiteBlockEvents,
  SiteBlockRichText, SiteBlockAccordion, SiteBlockButtons, SiteBlockDivider,
  SiteBlockProgress,
  SiteBlockColumns, SiteBlockCards, SiteBlockDownload, SiteBlockToc,
  SiteBlockTitle, SiteBlockLinkList, SiteBlockTable, SiteBlockSpotlight,
  BlockLook,
} from './render_types.ts';
import { renderMarkdown } from './markdown.ts';
import { normalizeFormDefinition, renderForm, type FormDefinition } from './forms.ts';
import { brandTint } from './palettes.ts';
import { parseWindow, isVisibleNow } from './content_window.ts';

/** The block types this engine realizes (⊆ the site_components catalog keys). */
export const REALIZED_BLOCK_TYPES: readonly SiteBlockType[] = [
  'features', 'stats', 'team', 'process', 'pricing', 'certifications', 'service_areas', 'cta',
  'gallery', 'before_after', 'video',
  'partners', 'reviews', 'reviews_wall', 'appointment', 'booking',
  'newsletter', 'social', 'events', 'map',
  'richtext', 'image', 'image_text', 'accordion', 'tabs', 'carousel', 'progress', 'buttons', 'divider',
  'form',
  'columns', 'cards', 'download', 'toc',
  'title', 'link_list', 'table', 'spotlight',
];

// Per-block item caps — bounded content, never unbounded. Total blocks capped too.
// Most types are one-instance-per-site; the MULTI set (form/columns/cards) may repeat,
// so the total cap is generous headroom rather than the realized-type count.
const MAX_BLOCKS = 32;
const CAP = { features: 8, stats: 6, team: 12, process: 10, pricing: 4, certifications: 12, service_areas: 40, tierFeatures: 8, gallery: 16, beforeAfter: 8, partners: 12, social: 8, events: 12, accordion: 10, tabs: 6, carousel: 12, progress: 8, buttons: 3, columns: 6, cards: 8, linkList: 16, tableCols: 6, tableRows: 24 };
// Layout Container: a column's optional width on a 12-unit responsive grid (AEM's
// snap-to-grid column span). Absent = equal widths (the original 2–3 col behavior).
const clampSpan = (v: unknown): number | undefined => {
  const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 1 && n <= 12 ? n : undefined;
};
// A progress percentage, clamped to 0..100 (integers only).
const clampPct = (v: unknown): number => {
  const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
};
// MULTI = types that carry a stable per-instance id (needed to address their nested
// content), so their render key is block_<type>_<id>. Every OTHER type may now also
// repeat freely (a real builder lets you stack several text boxes, feature grids,
// image+text rows…); duplicates are de-collided by a numeric render-key suffix.
const MULTI = new Set<string>(['form', 'columns', 'cards']);
// The few types that are genuinely one-per-page — a second one would be nonsense or
// duplicate a page-wide singleton (the on-this-page contents list; the reviews wall
// that also feeds the page's single AggregateRating schema node). Only THESE dedupe.
const SINGLETON = new Set<string>(['toc', 'reviews_wall']);
// #184: types that may NOT be nested inside a column cell — the containers/multi blocks
// (which would allow container-in-container / id-collision) and the page-level toc.
// Everything else (text AND media: image, video, gallery, carousel, …) is allowed.
const NOT_IN_CELL = new Set<string>(['columns', 'cards', 'form', 'toc']);

const s = (x: unknown, max: number): string => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
// Prose sanitizer: like s() but PRESERVES newlines (markdown structure) — collapses
// only intra-line runs of spaces/tabs, caps blank runs, length-caps. renderMarkdown
// still escapes-first and strips control chars, so this is a length/shape bound only.
const ml = (x: unknown, max: number): string => String(x ?? '')
  .replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const arr = (x: unknown): any[] => (Array.isArray(x) ? x : []);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uid = (x: unknown): string => { const v = String(x ?? '').trim(); return UUID_RE.test(v) ? v : ''; };
// A human-ish, storage-safe id for the multi-instance blocks (form/columns/cards) —
// mirrors lib/forms.ts slug(): lowercase, non-alphanumerics → '_', trimmed, capped.
const slugId = (x: unknown): string => String(x ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

// ── Phase T-STYLE: validate a block's optional `look` (per-section style options).
// Enumerated ONLY — any unknown value is dropped (→ the template default), never
// stored. Returns undefined when nothing non-default was chosen, so a default block
// keeps NO `look` key and renders byte-identically (goldens only drift by CSS).
function parseLook(raw: unknown): BlockLook | undefined {
  const l = (raw && typeof raw === 'object') ? (raw as any).look : undefined;
  if (!l || typeof l !== 'object') return undefined;
  const out: BlockLook = {};
  if (l.background === 'tinted' || l.background === 'plain' || l.background === 'accent' || l.background === 'dark') out.background = l.background;
  if (l.width === 'full') out.width = 'full';
  if (l.spacing === 'tight' || l.spacing === 'roomy') out.spacing = l.spacing;
  if (l.align === 'center') out.align = 'center';
  if (l.hideOn === 'mobile' || l.hideOn === 'desktop') out.hideOn = l.hideOn;
  return Object.keys(out).length ? out : undefined;
}

// ── Wave-1 G4: per-block STYLE VARIANTS (Adobe's Style System, translated to the
// curated philosophy). Each entry lists the NON-DEFAULT variants a block type may
// take — 1-2 curated alternate looks rendered by THIS engine, on-brand across every
// template. The default look has no name in storage: absent `variant` = the current
// render, so every existing site stays byte-identical. Unknown values are dropped
// at validation (→ default), never stored; the render branches only on these
// enumerated strings, so a variant can never emit arbitrary markup/CSS. The
// matching rules live in BLOCK_CSS, namespaced .v-<variant>. ──
export const BLOCK_VARIANTS: Record<string, readonly string[]> = {
  reviews_wall: ['quotes', 'strip'],   // testimonials: card grid (default) | big pull-quotes | compact band
  accordion: ['two-column'],           // faq-style: accordion (default) | open Q&A grid
  cta: ['card'],                       // banner (default) | boxed, centered card
  pricing: ['list'],                   // tier cards (default) | atelier-style name—rule—price rows
  gallery: ['masonry', 'filmstrip'],   // grid (default) | CSS-columns masonry | horizontal filmstrip
};
function parseVariant(type: string, raw: unknown): string | undefined {
  const v = (raw && typeof raw === 'object') ? (raw as { variant?: unknown }).variant : undefined;
  if (typeof v !== 'string') return undefined;
  const allowed = BLOCK_VARIANTS[type];
  return allowed && allowed.includes(v) ? v : undefined;
}

// ── Stored (pre-resolution) shapes for media blocks — carry media by ID; the
//    serializer's resolveBlockMedia() turns IDs into MediaRefs (reusing ref()). ──
interface StoredTeam { type: 'team'; title?: string; members: Array<{ name: string; role?: string; bio?: string; media_id?: string }> }
// Wave-2 G18 (DM-7/DM-11): a gallery may carry per-image captions (index-aligned
// with image_ids — a media-set's per-view label) and an opt-in `zoom` flag that
// turns on the zero-JS :target lightbox. Both are additive: absent → the stored
// shape and the render are byte-identical to before this feature.
interface StoredGallery { type: 'gallery'; title?: string; image_ids: string[]; captions?: string[]; zoom?: true }
interface StoredBeforeAfter { type: 'before_after'; title?: string; items: Array<{ before_id: string; after_id: string; caption?: string }> }
interface StoredVideo { type: 'video'; title?: string; url: string; caption?: string; poster_id?: string }
interface StoredPartners { type: 'partners'; title?: string; image_ids: string[] }
interface StoredMap { type: 'map'; title?: string; image_media_id?: string; address?: string; directions_url?: string }
// Phase RV: the reviews wall stores only DISPLAY config — its approved reviews +
// honest aggregate are injected at serialize time (resolveBlockMedia extras), never
// stored on the block (so a stale block can't fabricate ratings). `max` bounds how
// many approved reviews are shown; the aggregate always counts ALL approved rows.
interface StoredReviewsWall { type: 'reviews_wall'; title?: string; max: number }
// Text & layout staples: image/image_text carry media by ID (resolved by resolveBlockMedia);
// richtext/accordion/buttons/divider carry no media (pass straight through).
interface StoredImage { type: 'image'; title?: string; image_id?: string; caption?: string; alt?: string; link?: string; decorative?: boolean }
interface StoredImageText { type: 'image_text'; title?: string; image_id?: string; body: string; side: 'left' | 'right'; button?: { label: string; url: string } }
// Layout & utility staples (T-BLOCKS r4). Columns/cards carry media by ID (resolved
// by resolveBlockMedia) + a stable id (multi-instance). Download carries one file id.
// Toc carries no media/id — its list is derived at render from sibling headings.
interface StoredColumns { type: 'columns'; id: string; title?: string; columns: Array<{ body: string; image_id?: string; button?: { label: string; url: string }; span?: number; block?: StoredBlock }> }
interface StoredCards { type: 'cards'; id: string; title?: string; cards: Array<{ heading: string; text?: string; image_id?: string; link?: string }> }
interface StoredTabs { type: 'tabs'; title?: string; tabs: Array<{ label: string; body: string; image_id?: string }> }
interface StoredCarousel { type: 'carousel'; title?: string; slides: Array<{ image_id: string; caption?: string }> }
interface StoredDownload { type: 'download'; title?: string; file_id?: string; label?: string }
// Same distributive WithLook as render_types: the owner-chosen per-section style
// (Phase T-STYLE) rides on the stored block, orthogonal to its content. Phase EXP:
// it ALSO carries the optional auto-expiring window (show_from / show_until).
// Wave-1 G4: and the optional, enumerated style `variant` (BLOCK_VARIANTS above).
type WithLook<T> = T extends unknown ? T & { look?: BlockLook; show_from?: string; show_until?: string; variant?: string } : never;
export type StoredBlock = WithLook<
  | SiteBlockFeatures | SiteBlockStats | StoredTeam | SiteBlockProcess | SiteBlockPricing
  | SiteBlockCertifications | SiteBlockServiceAreas | SiteBlockCtaBanner
  | StoredGallery | StoredBeforeAfter | StoredVideo
  | StoredPartners | SiteBlockReviews | StoredReviewsWall | SiteBlockAppointment | SiteBlockBooking
  | SiteBlockNewsletter | SiteBlockSocial | SiteBlockEvents | StoredMap
  | SiteBlockRichText | StoredImage | StoredImageText | SiteBlockAccordion | StoredTabs | StoredCarousel | SiteBlockProgress | SiteBlockButtons | SiteBlockDivider
  | StoredColumns | StoredCards | StoredDownload | SiteBlockToc
  | SiteBlockTitle | SiteBlockLinkList | SiteBlockTable | SiteBlockSpotlight
  | FormDefinition
>;

/** Validate a raw stored blocks value into safe, capped, typed instances.
 *  Deterministic: drops anything malformed/empty, keeps the FIRST instance of each
 *  type (a site has one Team section, one Pricing section…), preserves owner order.
 *  EXCEPTION: `form` blocks are the one multi-instance type (a site can have a
 *  contact form AND a quote form AND …), each de-collided to a unique id so its
 *  render key + storage never clash. This is the authoritative boundary — the
 *  render trusts only what this returns. */
export function validateBlocks(raw: unknown): StoredBlock[] {
  const out: StoredBlock[] = [];
  const seen = new Set<string>();
  // Per-type id registries for the MULTI blocks — each instance gets a unique id so
  // its render key (block_<type>_<id>) + storage never collide with a sibling.
  const idsByType: Record<string, Set<string>> = { form: new Set(), columns: new Set(), cards: new Set() };
  const uniqueId = (t: string, rawId: unknown, fallback: string): string => {
    let id = slugId(rawId) || fallback;
    const set = idsByType[t];
    while (set.has(id)) id = `${id}_${out.length}`;
    set.add(id); return id;
  };
  for (const b of arr(raw)) {
    if (!b || typeof b !== 'object') continue;
    const type = String((b as any).type || '');
    // Only the genuine SINGLETON types (toc / reviews_wall) are one-per-page; every
    // other realized type may repeat, so a dropped second instance is KEPT, not dropped.
    if (!(REALIZED_BLOCK_TYPES as readonly string[]).includes(type) || (SINGLETON.has(type) && seen.has(type))) continue;
    const title = s((b as any).title, 80) || undefined;
    let block: StoredBlock | null = null;
    switch (type as SiteBlockType) {
      case 'features': {
        const items = arr((b as any).items).map((it) => ({ title: s(it?.title, 80), text: s(it?.text, 240) || undefined, icon: s(it?.icon, 12) || undefined })).filter((it) => it.title).slice(0, CAP.features);
        if (items.length) block = { type: 'features', title, items } as SiteBlockFeatures;
        break;
      }
      case 'stats': {
        const items = arr((b as any).items).map((it) => ({ value: s(it?.value, 24), label: s(it?.label, 60) })).filter((it) => it.value && it.label).slice(0, CAP.stats);
        if (items.length) block = { type: 'stats', title, items } as SiteBlockStats;
        break;
      }
      case 'team': {
        const members = arr((b as any).members).map((m) => {
          const mem: StoredTeam['members'][number] = { name: s(m?.name, 80), role: s(m?.role, 80) || undefined, bio: s(m?.bio, 300) || undefined };
          const mid = uid(m?.media_id); if (mid) mem.media_id = mid;
          return mem;
        }).filter((m) => m.name).slice(0, CAP.team);
        if (members.length) block = { type: 'team', title, members };
        break;
      }
      case 'process': {
        const steps = arr((b as any).steps).map((st) => ({ step: s(st?.step, 80), detail: s(st?.detail, 300) || undefined })).filter((st) => st.step).slice(0, CAP.process);
        if (steps.length) block = { type: 'process', title, steps } as SiteBlockProcess;
        break;
      }
      case 'pricing': {
        const tiers = arr((b as any).tiers).map((tr) => ({
          name: s(tr?.name, 60), price_text: s(tr?.price_text, 40) || undefined,
          features: arr(tr?.features).map((f) => s(f, 100)).filter(Boolean).slice(0, CAP.tierFeatures),
        })).filter((tr) => tr.name).slice(0, CAP.pricing);
        if (tiers.length) block = { type: 'pricing', title, tiers } as SiteBlockPricing;
        break;
      }
      case 'certifications': {
        const items = arr((b as any).items).map((it) => ({ name: s(it?.name, 100), issuer: s(it?.issuer, 100) || undefined })).filter((it) => it.name).slice(0, CAP.certifications);
        if (items.length) block = { type: 'certifications', title, items } as SiteBlockCertifications;
        break;
      }
      case 'service_areas': {
        const areas = arr((b as any).areas).map((a) => s(a, 60)).filter(Boolean).slice(0, CAP.service_areas);
        if (areas.length) block = { type: 'service_areas', title, areas } as SiteBlockServiceAreas;
        break;
      }
      case 'cta': {
        const text = s((b as any).text, 160);
        if (text) block = { type: 'cta', text, button: s((b as any).button, 40) || undefined, url: s((b as any).url, 300) || undefined } as SiteBlockCtaBanner;
        break;
      }
      case 'gallery': {
        // Wave-2 G18: captions ride index-aligned with the RAW image_ids list, so a
        // dropped junk id drops its caption too (alignment survives the uid filter).
        const rawIds = arr((b as any).image_ids);
        const rawCaps = arr((b as any).captions);
        const image_ids: string[] = [], captions: string[] = [];
        rawIds.forEach((v, i) => {
          const id = uid(v);
          if (!id || image_ids.length >= CAP.gallery) return;
          image_ids.push(id); captions.push(s(rawCaps[i], 160));
        });
        if (image_ids.length) {
          block = { type: 'gallery', title, image_ids };
          if (captions.some(Boolean)) (block as StoredGallery).captions = captions;
          // zoom: strict boolean true only (same allowlist posture as `variant` —
          // anything else is dropped, so existing sites store/render byte-identically).
          if ((b as any).zoom === true) (block as StoredGallery).zoom = true;
        }
        break;
      }
      case 'before_after': {
        const items = arr((b as any).items).map((it) => ({ before_id: uid(it?.before_id), after_id: uid(it?.after_id), caption: s(it?.caption, 120) || undefined }))
          .filter((it) => it.before_id && it.after_id).slice(0, CAP.beforeAfter);
        if (items.length) block = { type: 'before_after', title, items };
        break;
      }
      case 'video': {
        const url = s((b as any).url, 400);
        // Only http(s) links — the block renders a poster + link-out (never an
        // external iframe: constitution Part 4 requires zero external origins).
        if (/^https?:\/\//i.test(url)) {
          block = { type: 'video', title, url, caption: s((b as any).caption, 160) || undefined };
          const pid = uid((b as any).poster_id); if (pid) (block as StoredVideo).poster_id = pid;
        }
        break;
      }
      case 'partners': {   // "trusted by" logo strip — same media path as gallery
        const image_ids = arr((b as any).image_ids).map(uid).filter(Boolean).slice(0, CAP.partners);
        if (image_ids.length) block = { type: 'partners', title, image_ids };
        break;
      }
      case 'reviews': {    // a rating badge — honest numbers only, bounded 0–5
        const rating = Math.round(Math.min(5, Math.max(0, Number((b as any).rating) || 0)) * 10) / 10;
        const count = Math.min(1000000, Math.max(0, Math.trunc(Number((b as any).count) || 0)));
        if (rating > 0 && count > 0) block = { type: 'reviews', title, rating, count, source: s((b as any).source, 40) || undefined } as SiteBlockReviews;
        break;
      }
      case 'reviews_wall': {   // NATIVE reviews wall — always valid; approved reviews +
        // their honest aggregate are injected at serialize time. Stores only how many
        // to show (bounded); it renders nothing until there are approved reviews.
        const max = Math.min(50, Math.max(1, Math.trunc(Number((b as any).max) || 12)));
        block = { type: 'reviews_wall', title, max } as StoredReviewsWall;
        break;
      }
      case 'appointment': {   // booking button — link-out only (zero external origins)
        const url = s((b as any).url, 300);
        if (/^https?:\/\//i.test(url)) block = { type: 'appointment', title, url, text: s((b as any).text, 200) || undefined, button: s((b as any).button, 40) || undefined } as SiteBlockAppointment;
        break;
      }
      case 'booking': {   // NATIVE booking widget — first-party (its data lives in the
        // DB, reached via the site's own /book/:siteId endpoints; zero external origins)
        block = { type: 'booking', title, intro: s((b as any).intro, 400) || undefined } as SiteBlockBooking;
        break;
      }
      case 'newsletter': {   // ESP sign-up button — same link-out posture as appointment
        const url = s((b as any).url, 300);
        if (/^https?:\/\//i.test(url)) block = { type: 'newsletter', title, url, text: s((b as any).text, 200) || undefined, button: s((b as any).button, 40) || undefined } as SiteBlockNewsletter;
        break;
      }
      case 'social': {   // profile icon strip — links out only, never an embedded feed
        const links = arr((b as any).links)
          .map((l) => ({ network: s(l?.network, 24).toLowerCase(), url: s(l?.url, 300) }))
          .filter((l) => /^https?:\/\//i.test(l.url)).slice(0, CAP.social);
        if (links.length) block = { type: 'social', title, links } as SiteBlockSocial;
        break;
      }
      case 'events': {   // upcoming events list — name + date required per item
        const items = arr((b as any).items).map((it) => {
          const ev: SiteBlockEvents['items'][number] = { name: s(it?.name, 100), date: s(it?.date, 40) };
          const time = s(it?.time, 40); if (time) ev.time = time;
          const detail = s(it?.detail, 240); if (detail) ev.detail = detail;
          const url = s(it?.url, 300); if (/^https?:\/\//i.test(url)) ev.url = url;
          return ev;
        }).filter((it) => it.name && it.date).slice(0, CAP.events);
        if (items.length) block = { type: 'events', title, items } as SiteBlockEvents;
        break;
      }
      case 'map': {   // PRIVACY-SAFE static map: the site's OWN image + address text +
        // a directions LINK-OUT — never a third-party tile/iframe embed (constitution
        // Part 4: zero external origins; embeds would put trackers on customer sites).
        const address = s((b as any).address, 200) || undefined;
        const image_media_id = uid((b as any).image_media_id) || undefined;
        const du = s((b as any).directions_url, 400);
        const directions_url = /^https?:\/\//i.test(du) ? du : undefined;
        if (address || image_media_id) block = { type: 'map', title, address, image_media_id, directions_url } as StoredMap;
        break;
      }
      case 'richtext': {   // a readable prose section — markdown body (rendered safely at output)
        const body = ml((b as any).body, 4000);
        if (body) block = { type: 'richtext', title, body } as SiteBlockRichText;
        break;
      }
      case 'image': {   // a single figure from the media library; optional caption/alt/link
        const image_id = uid((b as any).image_id) || undefined;
        if (image_id) block = {
          type: 'image', title, image_id,
          caption: s((b as any).caption, 200) || undefined,
          alt: s((b as any).alt, 200) || undefined,
          link: s((b as any).link, 300) || undefined,   // validated by safeHref at render
          ...((b as any).decorative ? { decorative: true } : {}),   // a11y: alt="" + role="presentation"
        } as StoredImage;
        break;
      }
      case 'image_text': {   // image beside prose; stacks on mobile. Optional single button.
        const body = ml((b as any).body, 2000);
        const image_id = uid((b as any).image_id) || undefined;
        if (body || image_id) {
          const side = (b as any).side === 'right' ? 'right' : 'left';
          const st: StoredImageText = { type: 'image_text', title, image_id, body, side };
          const bl = s((b as any).button?.label, 40);
          const bu = s((b as any).button?.url, 300);
          if (bl && bu) st.button = { label: bl, url: bu };   // url validated by safeHref at render
          block = st;
        }
        break;
      }
      case 'accordion': {   // general expandable content (distinct from FAQ's Q&A + schema)
        const items = arr((b as any).items).map((it) => ({ summary: s(it?.summary, 120), body: ml(it?.body, 1500) }))
          .filter((it) => it.summary).slice(0, CAP.accordion);
        if (items.length) block = { type: 'accordion', title, items } as SiteBlockAccordion;
        break;
      }
      case 'tabs': {   // tabbed panels — each tab: a label + rich body + optional image
        const tabs = arr((b as any).tabs).map((t) => {
          const tab: StoredTabs['tabs'][number] = { label: s(t?.label, 40), body: ml(t?.body, 1500) };
          const image_id = uid(t?.image_id); if (image_id) tab.image_id = image_id;
          return tab;
        }).filter((t) => t.label && (t.body || t.image_id)).slice(0, CAP.tabs);
        if (tabs.length) block = { type: 'tabs', title, tabs } as StoredTabs;
        break;
      }
      case 'carousel': {   // a swipeable slideshow — each slide needs an image, caption optional
        const slides = arr((b as any).slides).map((sl) => {
          const image_id = uid(sl?.image_id); if (!image_id) return null;
          const slide: StoredCarousel['slides'][number] = { image_id };
          const cap = s(sl?.caption, 160); if (cap) slide.caption = cap;
          return slide;
        }).filter((sl): sl is StoredCarousel['slides'][number] => !!sl).slice(0, CAP.carousel);
        if (slides.length) block = { type: 'carousel', title, slides } as StoredCarousel;
        break;
      }
      case 'progress': {   // labeled progress/skill bars — label + a 0..100 percent
        const items = arr((b as any).items).map((it) => ({ label: s(it?.label, 60), percent: clampPct(it?.percent) }))
          .filter((it) => it.label).slice(0, CAP.progress);
        if (items.length) block = { type: 'progress', title, items } as SiteBlockProgress;
        break;
      }
      case 'buttons': {   // a small row of real links; each label required, url via safeHref at render
        const buttons = arr((b as any).buttons).map((bt) => ({
          label: s(bt?.label, 40), url: s(bt?.url, 300),
          style: bt?.style === 'outline' ? 'outline' as const : 'primary' as const,
        })).filter((bt) => bt.label && bt.url).slice(0, CAP.buttons);
        if (buttons.length) block = { type: 'buttons', title, buttons } as SiteBlockButtons;
        break;
      }
      case 'divider': {   // presentational spacer/rule — always valid (no content to be empty)
        const style = (b as any).style === 'space' ? 'space' : 'line';
        const sz = (b as any).size;
        const size = sz === 'small' || sz === 'large' ? sz : 'medium';
        block = { type: 'divider', style, size } as SiteBlockDivider;
        break;
      }
      case 'form': {   // custom form builder — full validation delegated to lib/forms.ts
        const r = normalizeFormDefinition(b);
        if (r.ok) block = { ...r.form, id: uniqueId('form', r.form.id, 'form') };   // unique id → unique render key + storage
        break;
      }
      case 'columns': {   // MULTI: 2–3 equal columns, each a small stack (prose + optional image + button)
        const cols = arr((b as any).columns).map((c) => {
          const col: StoredColumns['columns'][number] = { body: ml(c?.body, 1200) };
          const image_id = uid(c?.image_id); if (image_id) col.image_id = image_id;
          const bl = s(c?.button?.label, 40), bu = s(c?.button?.url, 300);
          if (bl && bu) col.button = { label: bl, url: bu };   // url validated by safeHref at render
          const span = clampSpan(c?.span); if (span !== undefined) col.span = span;   // 12-grid width (optional)
          // #184: a cell may instead hold a nested COMPONENT (any block except the
          // container/multi ones + toc, so there's never container-in-container). It's
          // validated by the SAME validateBlocks, so a nested image/video/gallery is a
          // real, safe, media-resolvable block — just like a top-level one.
          if (c?.block && typeof c.block === 'object' && !NOT_IN_CELL.has(String((c.block as any).type))) {
            const nested = validateBlocks([c.block]);
            if (nested[0]) col.block = nested[0];
          }
          return col;
        }).filter((c) => c.body || c.image_id || c.button || c.block).slice(0, CAP.columns);
        // A single-column layout container is valid (Adobe allows 1..N). Only spans
        // are additive: columns with no span keep the original equal-width behavior.
        if (cols.length >= 1) block = { type: 'columns', id: uniqueId('columns', (b as any).id, 'columns'), title, columns: cols };
        break;
      }
      case 'cards': {   // MULTI: a repeatable teaser grid (image + heading + short text + optional link)
        const cards = arr((b as any).cards).map((c) => {
          const card: StoredCards['cards'][number] = { heading: s(c?.heading ?? c?.title, 80) };
          const text = s(c?.text, 240); if (text) card.text = text;
          const image_id = uid(c?.image_id); if (image_id) card.image_id = image_id;
          const link = s(c?.link, 300); if (link) card.link = link;   // validated by safeHref at render
          return card;
        }).filter((c) => c.heading || c.text || c.image_id).slice(0, CAP.cards);
        if (cards.length) block = { type: 'cards', id: uniqueId('cards', (b as any).id, 'cards'), title, cards };
        break;
      }
      case 'download': {   // an accessible download link to one media-library file
        const file_id = uid((b as any).file_id) || undefined;
        if (file_id) block = { type: 'download', title, file_id, label: s((b as any).label, 80) || undefined } as StoredDownload;
        break;
      }
      case 'toc': {   // always valid; the render skips it when the page has no headings to list
        block = { type: 'toc', title } as SiteBlockToc;
        break;
      }
      case 'title': {   // a standalone heading + optional subtitle (no media)
        const heading = s((b as any).title, 120);
        if (heading) block = { type: 'title', title: heading, subtitle: s((b as any).subtitle, 200) || undefined } as SiteBlockTitle;
        break;
      }
      case 'link_list': {   // a titled list of links — each label required, url via safeHref at render
        const links = arr((b as any).links).map((lk) => ({ label: s(lk?.label, 80), url: s(lk?.url, 300) }))
          .filter((lk) => lk.label && lk.url).slice(0, CAP.linkList);
        if (links.length) block = { type: 'link_list', title, links } as SiteBlockLinkList;
        break;
      }
      case 'table': {   // a simple data table — capped header row + body rows of plain text
        const headers = arr((b as any).headers).map((h) => s(h, 80)).slice(0, CAP.tableCols);
        const cols = headers.length || Math.min(CAP.tableCols, Math.max(1, arr((b as any).rows)[0] ? arr(arr((b as any).rows)[0]).length : 0));
        const rows = arr((b as any).rows).map((r) => { const cells = arr(r).map((c) => s(c, 200)).slice(0, cols); while (cells.length < cols) cells.push(''); return cells; })
          .filter((r) => r.some((c) => c)).slice(0, CAP.tableRows);
        if (rows.length && cols > 0) block = { type: 'table', title, headers: headers.length ? headers : [], rows } as SiteBlockTable;
        break;
      }
      case 'spotlight': {   // a prominent highlight band — eyebrow + heading + prose + optional button
        const heading = s((b as any).title, 120);
        if (heading) {
          const sp: SiteBlockSpotlight = { type: 'spotlight', title: heading };
          const eyebrow = s((b as any).eyebrow, 60); if (eyebrow) sp.eyebrow = eyebrow;
          const body = ml((b as any).body, 800); if (body) sp.body = body;
          const bl = s((b as any).button?.label, 40), bu = s((b as any).button?.url, 300);
          if (bl && bu) sp.button = { label: bl, url: bu };
          block = sp;
        }
        break;
      }
    }
    if (block) {
      const look = parseLook(b);   // Phase T-STYLE: attach validated per-section style (or nothing)
      if (look) (block as any).look = look;
      // Wave-1 G4: attach the validated style variant (or nothing — the default look
      // stores NO variant key, so a default block stays byte-identical in storage).
      const variant = parseVariant(type, b);
      if (variant) (block as any).variant = variant;
      // Phase EXP: attach the normalized auto-expiring window (or nothing). Parsing
      // is clockless — WHEN it shows is decided at render against snapshot.created_at.
      const win = parseWindow(b);
      if (win) { if (win.show_from) (block as any).show_from = win.show_from; if (win.show_until) (block as any).show_until = win.show_until; }
      out.push(block); if (SINGLETON.has(type)) seen.add(type);
    }
    if (out.length >= MAX_BLOCKS) break;
  }
  return out;
}

/** Resolve stored media IDs → MediaRefs using the serializer's ref() (which also
 *  registers them in the media manifest, so variants are generated — the ONE media
 *  pipeline, reused). A media block whose media can't resolve is dropped; a team
 *  keeps its text even without photos. StoredBlock[] → render-facing SiteBlock[]. */
// Phase RV: the reviews wall's approved reviews + honest aggregate are resolved
// alongside media (both are impure DB reads the serializer performs once). Passed as
// `extras` so the pure block engine never itself reads the DB. Absent/empty → the
// reviews_wall block resolves to nothing (rendered as absent), keeping goldens stable
// and honoring "shown only after approval".
export interface BlockResolveExtras {
  reviewsWall?: { items: import('./render_types.ts').ReviewDisplayItem[]; aggregate: { count: number; average: number } };
}
export function resolveBlockMedia(blocks: StoredBlock[], ref: (id: string) => MediaRef | null, extras?: BlockResolveExtras): SiteBlock[] {
  const out: SiteBlock[] = [];
  // Phase T-STYLE: the media-bearing branches rebuild their block object, so carry
  // the owner-chosen per-section style across the rebuild (default `out.push(b)` keeps it).
  // Phase EXP: the auto-expiring window rides along the same way, so a rebuilt
  // media block (team/gallery/image/columns/cards/…) keeps its show_from/show_until.
  const lk = (b: StoredBlock) => ({
    ...(b.look ? { look: b.look } : {}),
    ...((b as any).show_from ? { show_from: (b as any).show_from } : {}),
    ...((b as any).show_until ? { show_until: (b as any).show_until } : {}),
    ...(b.variant ? { variant: b.variant } : {}),   // Wave-1 G4: the style variant rides the rebuild too
  });
  for (const b of blocks) {
    switch (b.type) {
      case 'team':
        out.push({ type: 'team', title: b.title, members: b.members.map((m) => ({ name: m.name, role: m.role, bio: m.bio, media: m.media_id ? ref(m.media_id) : null })), ...lk(b) });
        break;
      case 'gallery': {
        // Wave-2 G18: captions stay index-aligned as unresolvable images drop out;
        // zoom rides the rebuild like look/variant. Both absent → identical output.
        const images: MediaRef[] = [], captions: string[] = [];
        b.image_ids.forEach((id, i) => {
          const m = ref(id); if (!m) return;
          images.push(m); captions.push(b.captions?.[i] || '');
        });
        if (images.length) out.push({ type: 'gallery', title: b.title, images,
          ...(captions.some(Boolean) ? { captions } : {}),
          ...(b.zoom ? { zoom: true as const } : {}), ...lk(b) } as SiteBlock);
        break;
      }
      case 'before_after': {
        const items: SiteBlockBeforeAfter['items'] = [];
        for (const it of b.items) {
          const before = ref(it.before_id), after = ref(it.after_id);
          if (before && after) items.push({ before, after, ...(it.caption ? { caption: it.caption } : {}) });
        }
        if (items.length) out.push({ type: 'before_after', title: b.title, items, ...lk(b) });
        break;
      }
      case 'video':
        out.push({ type: 'video', title: b.title, url: b.url, caption: b.caption, poster: b.poster_id ? ref(b.poster_id) : null, ...lk(b) });
        break;
      case 'partners': {
        const logos = b.image_ids.map((id) => ref(id)).filter((x): x is MediaRef => !!x);
        if (logos.length) out.push({ type: 'partners', title: b.title, logos, ...lk(b) });
        break;
      }
      case 'reviews_wall': {   // inject approved reviews + honest aggregate; drop when
        // there are none to show (never render an empty wall / fabricate a rating).
        const rw = extras?.reviewsWall;
        if (rw && rw.aggregate.count > 0 && rw.items.length) {
          out.push({ type: 'reviews_wall', title: b.title, reviews: rw.items.slice(0, b.max || 12), aggregate: rw.aggregate, ...lk(b) });
        }
        break;
      }
      case 'map': {   // an address keeps the block valuable even if the image can't resolve
        const image = b.image_media_id ? ref(b.image_media_id) : null;
        if (image || b.address) out.push({ type: 'map', title: b.title, image, address: b.address, directions_url: b.directions_url, ...lk(b) });
        break;
      }
      case 'image': {   // an image with no resolvable media is nothing to show — drop it
        const image = b.image_id ? ref(b.image_id) : null;
        if (image) out.push({ type: 'image', title: b.title, image, caption: b.caption, alt: b.alt, link: b.link, decorative: b.decorative, ...lk(b) });
        break;
      }
      case 'columns':   // prose/button ride through; each column's image resolves (or drops to null)
        out.push({ type: 'columns', id: b.id, title: b.title, columns: b.columns.map((c) => {
          const cell: SiteBlockColumns['columns'][number] = { body: c.body, image: c.image_id ? ref(c.image_id) : null, button: c.button, span: c.span };
          // #184: a nested cell component resolves its OWN media through the same ref()
          // (one media pipeline). If it resolves to nothing (e.g. an image whose media is
          // gone), the cell simply falls back to its body/image/button.
          if (c.block) { const rb = resolveBlockMedia([c.block], ref, extras)[0]; if (rb) cell.block = rb; }
          return cell;
        }), ...lk(b) });
        break;
      case 'tabs':   // each tab's body/label ride through; optional image resolves (or null)
        out.push({ type: 'tabs', title: b.title, tabs: b.tabs.map((t) => ({ label: t.label, body: t.body, image: t.image_id ? ref(t.image_id) : null })), ...lk(b) });
        break;
      case 'carousel': {   // each slide's image resolves; a slide whose image is gone is dropped
        const slides = b.slides.map((sl) => ({ image: sl.image_id ? ref(sl.image_id) : null, caption: sl.caption })).filter((sl) => sl.image);
        if (slides.length) out.push({ type: 'carousel', title: b.title, slides, ...lk(b) });
        break;
      }
      case 'cards':
        out.push({ type: 'cards', id: b.id, title: b.title, cards: b.cards.map((c) => ({ heading: c.heading, text: c.text, image: c.image_id ? ref(c.image_id) : null, link: c.link })), ...lk(b) });
        break;
      case 'download': {   // a download with no resolvable file is nothing to offer — drop it
        const file = b.file_id ? ref(b.file_id) : null;
        if (file) out.push({ type: 'download', title: b.title, file, label: b.label, ...lk(b) });
        break;
      }
      case 'image_text': {   // prose keeps the block valuable even if the image can't resolve
        const image = b.image_id ? ref(b.image_id) : null;
        if (image || b.body) out.push({ type: 'image_text', title: b.title, image, body: b.body, side: b.side, button: b.button, ...lk(b) });
        break;
      }
      default:
        out.push(b);
    }
  }
  return out;
}

// AVIF sits beside WebP at the same widths: the deterministic variant path only
// differs by extension (see serializer.variantPath), so we derive the AVIF srcset
// from the WebP one — zero external origins, self-hosted variants only.
const avifOf = (webpPath: string): string => webpPath.replace(/\.webp$/, '.avif');

/** Deterministic responsive image from a resolved MediaRef — mirrors each template's
 *  img(): a <picture> that offers AVIF then WebP (browser picks the first it supports)
 *  with the <img> as the ultimate fallback. Preserves alt, lazy-load, dimensions, and
 *  focal crop. Zero external origins. */
function blockImg(m: MediaRef, esc: (s: string) => string, attr: (s: string) => string, sizes: string, opts?: { decorative?: boolean }): string {
  const v = m.variants || {};
  const order = ['w400', 'w800', 'w1600'].filter((k) => v[k]);
  const webpSrcset = order.map((k) => `${attr(v[k])} ${k.slice(1)}w`).join(', ');
  const src = v.w800 || v.w400 || Object.values(v)[0]; if (!src) return '';
  const dims = m.width && m.height ? ` width="${m.width}" height="${m.height}"` : '';
  // Phase G3 (focal beyond hero): presence_media.focal_x/y ride the MediaRef into every
  // block image (gallery, carousel, cards, columns, team, image, image_text, before/after,
  // video poster, map, teaser) — object-position keeps the chosen point framed wherever
  // the block's CSS cover-crops. Guarded: both coordinates must be finite numbers,
  // clamped to 0-100; anything else omits the style entirely (deterministic + safe).
  const fx = Number(m.focal?.x), fy = Number(m.focal?.y);
  const focal = m.focal && Number.isFinite(fx) && Number.isFinite(fy)
    ? ` style="${attr(`object-position:${Math.min(100, Math.max(0, fx))}% ${Math.min(100, Math.max(0, fy))}%`)}"`
    : '';
  // Decorative → empty alt + role="presentation" (announced by nothing). Otherwise
  // the media's alt describes the image for AT + search.
  const a11y = opts?.decorative ? ` alt="" role="presentation"` : ` alt="${attr(m.alt || '')}"`;
  const imgTag = `<img src="${attr(src)}"${webpSrcset ? ` srcset="${webpSrcset}" sizes="${attr(sizes)}"` : ''}${a11y}${dims} loading="lazy" decoding="async"${focal}>`;
  if (!webpSrcset) return imgTag;   // single-variant edge: nothing to choose between
  const avifSrcset = order.map((k) => `${attr(avifOf(v[k]))} ${k.slice(1)}w`).join(', ');
  const sz = ` sizes="${attr(sizes)}"`;
  return `<picture><source type="image/avif" srcset="${avifSrcset}"${sz}><source type="image/webp" srcset="${webpSrcset}"${sz}>${imgTag}</picture>`;
}

// ── Render context: the escapers + safe-href a template already has, injected so
//    this module stays free of any template's helper imports. ──
// ── Phase RV: the reviews' HONEST schema.org, folded into the page's ONE business
//    node. A standalone AggregateRating/Review node would create a SECOND, duplicate
//    LocalBusiness on the page (Google merges/ignores duplicates); instead a template
//    spreads this onto its ldBusiness() output, so aggregateRating + review sit on the
//    real business — the correct rich-results shape. Counts only approved rows (the
//    resolved block already carries approved-only data). Returns null when there is
//    nothing approved to show, so a template with no reviews_wall is byte-identical. ──
export function reviewsSchema(blocks: SiteBlock[] | undefined, now?: string): { aggregateRating: object; review: object[] } | null {
  const rw = (blocks || []).find((b) => b.type === 'reviews_wall'
    // Phase EXP: a reviews wall outside its window isn't shown, so it emits no schema either.
    && (!now || isVisibleNow(b as { show_from?: string; show_until?: string }, now))) as SiteBlockReviewsWall | undefined;
  if (!rw || !rw.aggregate || rw.aggregate.count < 1 || !rw.reviews.length) return null;
  return {
    aggregateRating: { '@type': 'AggregateRating', ratingValue: rw.aggregate.average, reviewCount: rw.aggregate.count, bestRating: 5, worstRating: 1 },
    review: rw.reviews.slice(0, 20).map((r) => ({
      '@type': 'Review',
      reviewRating: { '@type': 'Rating', ratingValue: r.rating, bestRating: 5, worstRating: 1 },
      author: { '@type': 'Person', name: r.author },
      reviewBody: r.body,
      ...(r.date ? { datePublished: r.date } : {}),
    })),
  };
}

export interface BlockRenderCtx {
  esc: (s: string) => string;
  attr: (s: string) => string;
  safeHref: (s: string) => string | null;
  /** Phase FB: the public submit endpoint for custom form blocks (site.formEndpoint). */
  formEndpoint?: string;
  /** Phase BK: the public native-booking API base (site.bookEndpoint = …/book/:siteId).
   *  The booking block's first-party enhancer calls /types, /slots, and POSTs here. */
  bookEndpoint?: string;
  /** Phase EXP: the deterministic publish clock (snapshot.created_at). When set,
   *  a section outside its show_from/show_until window is omitted from the output.
   *  When absent (e.g. a direct unit call), every section renders — so no-window
   *  output is byte-identical to before this feature. */
  now?: string;
}

export interface RenderedBlock { key: string; type: SiteBlockType; html: string; ld?: object }

const numericPrice = (p?: string): string | undefined => {
  if (!p) return undefined;
  const m = p.replace(/,/g, '').match(/\d+(\.\d+)?/);
  return m ? m[0] : undefined;
};

// ── Events: dates stay honest — ISO in storage renders human, pure string math
//    (no clock, no timezone). Anything else renders exactly as the owner wrote it. ──
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_24_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
/** "2026-07-26" → "Jul 26" (null when not a plausible ISO date). */
const humanDate = (d: string): string | null => {
  const m = ISO_DATE_RE.exec(d); if (!m) return null;
  const mo = Number(m[2]), day = Number(m[3]);
  if (mo < 1 || mo > 12 || day < 1 || day > 31) return null;
  return `${MONTHS[mo - 1]} ${day}`;
};

// ── Social: inline SVG icons — self-hosted markup, zero external origins, one
//    consistent stroke weight. Evocative line icons (not trademark-exact glyphs);
//    unknown networks fall back to a generic link icon. ──
const SOCIAL_ICONS: Record<string, string> = {
  instagram: '<rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>',
  facebook: '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>',
  x: '<path d="M4 4l16 16"/><path d="M20 4L4 20"/>',
  tiktok: '<path d="M14 4v9.5a3.75 3.75 0 1 1-3.75-3.75"/><path d="M14 4c.4 2.8 2.3 4.7 5 5"/>',
  youtube: '<rect x="2.5" y="5.5" width="19" height="13" rx="4"/><polygon points="10 9.2 15 12 10 14.8 10 9.2" fill="currentColor" stroke="none"/>',
  linkedin: '<path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4V8h4v2"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/>',
  yelp: '<polygon points="12 2 14.6 8.6 21.5 9.3 16.5 13.9 17.9 20.8 12 17.3 6.1 20.8 7.5 13.9 2.5 9.3 9.4 8.6 12 2"/>',
  google: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
};
const SOCIAL_LABELS: Record<string, string> = {
  instagram: 'Instagram', facebook: 'Facebook', x: 'X', twitter: 'X', tiktok: 'TikTok',
  youtube: 'YouTube', linkedin: 'LinkedIn', yelp: 'Yelp', google: 'Google',
};
const socialIcon = (network: string): string => {
  const key = network === 'twitter' ? 'x' : network;
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${SOCIAL_ICONS[key] || SOCIAL_ICONS.link}</svg>`;
};

// ── Anchors + Table of contents ──────────────────────────────────────────────
// Blocks whose section ALWAYS shows an <h2> (title or this fallback). The fallback
// text MUST match the render's h2() fallback so the anchor slug matches the shown
// heading. Title-optional blocks (richtext/image/image_text/buttons/columns/cards/
// download/form) get a heading only when the owner set a title; cta/divider/toc none.
const MANDATORY_H2: Record<string, string> = {
  features: 'Why choose us', stats: 'By the numbers', team: 'Meet the team', process: 'How it works',
  pricing: 'Pricing', certifications: 'Credentials & certifications', service_areas: 'Areas we serve',
  gallery: 'Gallery', before_after: 'Before & after', video: 'Video', newsletter: 'Get updates from us',
  social: 'Find us online', events: 'Upcoming events', map: 'Find us', accordion: 'More information',
  partners: 'Trusted by', reviews: 'What customers say', reviews_wall: 'Reviews', appointment: 'Book an appointment',
  booking: 'Book an appointment',
};
/** The effective (displayed) heading of a block, or null when it shows none. */
function effHeading(b: SiteBlock): string | null {
  if (Object.prototype.hasOwnProperty.call(MANDATORY_H2, b.type)) return (b as { title?: string }).title || MANDATORY_H2[b.type];
  if (b.type === 'cta' || b.type === 'divider' || b.type === 'toc') return null;
  return (b as { title?: string }).title || null;   // title-optional blocks
}
/** A stable, human-ish anchor slug (deterministic — same text → same id). */
function slugifyAnchor(t: string): string {
  return t.toLowerCase().replace(/&[a-z]+;/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'section';
}

// ── Phase T-STYLE: an owner-chosen `look` → a small set of deterministic CSS
// classes stamped onto the section's `class="block …"`. Enumerated only (validated
// upstream), so this never emits arbitrary CSS. A block with no `look` (the default)
// gets NO extra class, so its markup is byte-identical to before this feature. The
// matching rules live in BLOCK_CSS. ──
function lookClasses(look?: BlockLook): string {
  if (!look) return '';
  const c: string[] = [];
  if (look.background === 'tinted') c.push('block--bg-tint');
  else if (look.background === 'plain') c.push('block--bg-plain');
  else if (look.background === 'accent') c.push('block--bg-accent');
  else if (look.background === 'dark') c.push('block--bg-dark');
  if (look.width === 'full') c.push('block--full');
  if (look.spacing === 'tight') c.push('block--space-tight');
  else if (look.spacing === 'roomy') c.push('block--space-roomy');
  if (look.align === 'center') c.push('block--align-center');
  if (look.hideOn === 'mobile') c.push('block--hide-mobile');
  else if (look.hideOn === 'desktop') c.push('block--hide-desktop');
  return c.join(' ');
}
/** Inject the look classes into a section's `class="block …"` (first occurrence).
 *  No-op when no non-default look is set — the default render is untouched. */
function applyLook(html: string, look?: BlockLook): string {
  const cls = lookClasses(look);
  if (!cls || !html) return html;
  return html.replace('class="block ', `class="block ${cls} `);
}

// ── Phase BK: the booking widget's first-party enhancer ──────────────────────
// A minimal, self-contained IIFE (same posture as the form block's inline enhancer:
// scoped to the widget on the page, ZERO external origins). It calls the site's own
// /book/:siteId endpoints (/types, /slots, POST) — read from data-book. All dynamic
// UI is built with createElement + textContent, so owner/customer data is never
// interpolated into HTML. Deterministic string (no clock/random), so goldens stay
// stable. The only HTML-parser hazard in an inline script is the literal "</" that
// could close the tag early — guarded below (the script contains none, but we escape
// defensively). Comparison operators (< >) are safe inside a <script> raw-text element.
function bookingScript(): string {
  const js = `(function(){
var W=document.querySelector('.booking-widget[data-book]');if(!W)return;
var EP=W.getAttribute('data-book');var stage=W.querySelector('.bk-stage');
var S={types:[],type:null,date:'',slot:'',cfg:{}};
var MO=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e;}
function clr(){while(stage.firstChild)stage.removeChild(stage.firstChild);}
function msg(t){clr();stage.appendChild(el('p','bk-msg',t));}
function getj(u){return fetch(u,{headers:{accept:'application/json'}}).then(function(r){return r.json();});}
function ftime(hm){var p=hm.split(':');var h=+p[0],m=p[1];var ap=h<12?'AM':'PM';var h12=(h%12===0)?12:(h%12);return h12+':'+m+' '+ap;}
function fdate(d){var p=d.split('-');return MO[(+p[1])-1]+' '+(+p[2]);}
function back(fn){var b=el('button','bk-back','← Back');b.type='button';b.addEventListener('click',fn);return b;}
msg('Loading…');
getj(EP+'/types').then(function(res){var d=(res&&res.data)||{};if(!d.enabled||!d.types||!d.types.length){msg('Online booking isn’t available right now.');return;}S.types=d.types;S.cfg=d;services();}).catch(function(){msg('We couldn’t load booking just now. Please try again later.');});
function services(){clr();stage.appendChild(el('p','bk-step','1. Choose a service'));var list=el('div','bk-services');S.types.forEach(function(t){var b=el('button','bk-service');b.type='button';b.appendChild(el('span','bk-svc-name',t.name));b.appendChild(el('span','bk-svc-meta',t.duration_min+' min'+(t.price_text?(' · '+t.price_text):'')));if(t.description)b.appendChild(el('span','bk-svc-desc',t.description));b.addEventListener('click',function(){S.type=t;pickDate();});list.appendChild(b);});stage.appendChild(list);}
function pickDate(){clr();stage.appendChild(back(services));stage.appendChild(el('p','bk-step','2. Pick a day for '+S.type.name));var inp=el('input','bk-date');inp.type='date';var now=new Date();inp.min=now.toISOString().slice(0,10);if(S.cfg.max_days_ahead){inp.max=new Date(now.getTime()+S.cfg.max_days_ahead*86400000).toISOString().slice(0,10);}inp.addEventListener('change',function(){S.date=inp.value;if(S.date)slots();});stage.appendChild(inp);}
function slots(){clr();stage.appendChild(back(pickDate));stage.appendChild(el('p','bk-step','3. Choose a time'));var load=el('p','bk-msg','Finding open times…');stage.appendChild(load);getj(EP+'/slots?type='+encodeURIComponent(S.type.id)+'&date='+encodeURIComponent(S.date)).then(function(res){var sl=((res&&res.data)||{}).slots||[];if(load.parentNode)stage.removeChild(load);if(!sl.length){stage.appendChild(el('p','bk-msg','No open times that day — try another.'));return;}var grid=el('div','bk-slots');sl.forEach(function(s){var b=el('button','bk-slot',ftime(s.split('T')[1]));b.type='button';b.addEventListener('click',function(){S.slot=s;details();});grid.appendChild(b);});stage.appendChild(grid);}).catch(function(){if(load.parentNode)stage.removeChild(load);stage.appendChild(el('p','bk-msg','Couldn’t load times. Please try again.'));});}
function field(lb,nm,ty,req){var w=el('label','bk-field');w.appendChild(el('span',null,lb+(req?' *':'')));var i=el(ty==='textarea'?'textarea':'input');if(ty!=='textarea')i.type=ty;i.name=nm;if(req)i.required=true;w.appendChild(i);return {w:w,i:i};}
function details(){clr();stage.appendChild(back(slots));stage.appendChild(el('p','bk-step','4. Your details'));var f=el('form','bk-form');var nm=field('Your name','name','text',true),em=field('Email','email','email',false),ph=field('Phone','phone','tel',false),nt=field('Anything we should know?','note','textarea',false);f.appendChild(nm.w);f.appendChild(em.w);f.appendChild(ph.w);f.appendChild(nt.w);var hp=el('div','bk-hp');var hpi=el('input');hpi.name='_hp';hpi.tabIndex=-1;hpi.setAttribute('autocomplete','off');hp.appendChild(hpi);f.appendChild(hp);f.appendChild(el('p','bk-summary',S.type.name+' — '+fdate(S.date)+' at '+ftime(S.slot.split('T')[1])));var btn=el('button','bk-submit btn','Confirm booking');btn.type='submit';f.appendChild(btn);var err=el('p','bk-err');f.appendChild(err);f.addEventListener('submit',function(ev){ev.preventDefault();err.textContent='';if(!nm.i.value.trim()){err.textContent='Please add your name.';return;}if(!em.i.value.trim()&&!ph.i.value.trim()){err.textContent='Leave an email or phone so they can confirm.';return;}btn.disabled=true;btn.textContent='Booking…';fetch(EP,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type_id:S.type.id,slot_start:S.slot,name:nm.i.value,email:em.i.value,phone:ph.i.value,note:nt.i.value,_hp:hpi.value})}).then(function(r){return r.json().then(function(j){return {s:r.status,j:j};});}).then(function(o){if(o.s>=200&&o.s<300&&o.j&&o.j.data&&o.j.data.ok){done(o.j.data.message);}else{btn.disabled=false;btn.textContent='Confirm booking';err.textContent=(o.j&&o.j.message)||'That didn’t go through — please try again.';if(o.s===409){setTimeout(function(){S.slot='';slots();},1800);}}}).catch(function(){btn.disabled=false;btn.textContent='Confirm booking';err.textContent='Something went wrong — please try again.';});});stage.appendChild(f);}
function done(m){clr();var d=el('div','bk-done');d.appendChild(el('p','bk-done-ic','✓'));d.appendChild(el('p','bk-done-msg',m||'Thanks — your booking request was received.'));stage.appendChild(d);}
})();`;
  return `<script>${js.replace(/<\//g, '<\\/')}</script>`;
}

/** Render validated blocks to deterministic HTML sections + optional JSON-LD.
 *  One section each, stable `block_<type>` key (for section order/visibility;
 *  MULTI blocks add their id: `block_<type>_<id>`), reusing the template's existing
 *  classes (.block/.wrap/.cards/.card/.svc-grid). Every rendered <section> gets a
 *  stable, deterministic anchor id (slug of its heading, de-duped) so a Table of
 *  contents block + in-page links resolve. Each block meets the site_components
 *  a11y contract (lists, headings, text-first). */
export function renderSiteBlocks(blocks: SiteBlock[] | undefined, ctx: BlockRenderCtx): RenderedBlock[] {
  const { esc, attr, safeHref } = ctx;
  // First pass: build each block's HTML/LD (the `toc` block is deferred — it needs
  // every OTHER section's heading + anchor, known only after this pass).
  const built: Array<{ b: SiteBlock; html: string; ld?: object }> = [];
  const h2 = (t: string | undefined, fallback: string) => `<h2>${esc(t || fallback)}</h2>`;
  let tabsSeq = 0;   // per-page counter → each tabs block gets a unique radio-group name
  // Wave-2 G18: per-page counter → each ZOOM gallery gets its own lightbox id
  // namespace (lb-0, lb-1, …). Same per-call posture as tabsSeq: deterministic for
  // a given page's block list. (Known shared limit with tabs: a zoom gallery nested
  // inside a columns cell re-enters renderSiteBlocks and restarts the counter, so a
  // page mixing a TOP-LEVEL zoom gallery with a NESTED one could collide ids.)
  let zoomSeq = 0;

  for (const b of blocks || []) {
    // Phase EXP: auto-expiring content — a section outside its window at the publish
    // clock is omitted entirely (no HTML, no schema, no anchor, absent from the TOC).
    // No window (the default) → always visible → byte-identical to before.
    if (ctx.now && !isVisibleNow(b as { show_from?: string; show_until?: string }, ctx.now)) continue;
    let html = '', ld: object | undefined;
    switch (b.type) {
      case 'features':
        html = `<section class="block wrap block-features">${h2(b.title, 'Why choose us')}<div class="svc-grid">${b.items.map((it) =>
          `<div class="svc">${it.icon ? `<div class="svc-ic" aria-hidden="true">${esc(it.icon)}</div>` : ''}<div class="nm">${esc(it.title)}</div>${it.text ? `<div class="ds">${esc(it.text)}</div>` : ''}</div>`).join('')}</div></section>`;
        break;
      case 'stats':
        html = `<section class="block alt block-stats"><div class="wrap">${h2(b.title, 'By the numbers')}<div class="cards stats">${b.items.map((it) =>
          `<div class="card stat"><div class="stat-v">${esc(it.value)}</div><div class="stat-l">${esc(it.label)}</div></div>`).join('')}</div></div></section>`;
        break;
      case 'team':
        html = `<section class="block wrap block-team">${h2(b.title, 'Meet the team')}<div class="cards">${b.members.map((m) =>
          `<div class="card team-card">${m.media ? `<div class="team-photo">${blockImg(m.media, esc, attr, '(max-width:640px) 100vw, 220px')}</div>` : ''}<div class="nm">${esc(m.name)}</div>${m.role ? `<div class="pr">${esc(m.role)}</div>` : ''}${m.bio ? `<p class="ds">${esc(m.bio)}</p>` : ''}</div>`).join('')}</div></section>`;
        ld = { '@context': 'https://schema.org', '@type': 'ItemList', itemListElement: b.members.map((m, i) => ({ '@type': 'ListItem', position: i + 1, item: { '@type': 'Person', name: m.name, jobTitle: m.role || undefined } })) };
        break;
      case 'process':
        html = `<section class="block alt block-process"><div class="wrap">${h2(b.title, 'How it works')}<ol class="process">${b.steps.map((st) =>
          `<li><span class="step-t">${esc(st.step)}</span>${st.detail ? `<span class="step-d">${esc(st.detail)}</span>` : ''}</li>`).join('')}</ol></div></section>`;
        ld = { '@context': 'https://schema.org', '@type': 'HowTo', name: b.title || 'How it works', step: b.steps.map((st, i) => ({ '@type': 'HowToStep', position: i + 1, name: st.step, text: st.detail || st.step })) };
        break;
      case 'pricing':
        if (b.variant === 'list') {
          // Wave-1 G4 variant: atelier-style price rows — name, a quiet dotted
          // rule, price; features as a muted line beneath. Same data, same schema.
          html = `<section class="block wrap block-pricing v-list">${h2(b.title, 'Pricing')}<div class="price-list">${b.tiers.map((tr) =>
            `<div class="pl-row"><div class="pl-head"><span class="pl-name">${esc(tr.name)}</span><span class="pl-rule" aria-hidden="true"></span>${tr.price_text ? `<span class="pl-price">${esc(tr.price_text)}</span>` : ''}</div>${tr.features.length ? `<p class="pl-feats">${tr.features.map((f) => esc(f)).join(' · ')}</p>` : ''}</div>`).join('')}</div></section>`;
        } else {
          html = `<section class="block wrap block-pricing">${h2(b.title, 'Pricing')}<div class="cards">${b.tiers.map((tr) =>
            `<div class="card price-tier"><div class="nm">${esc(tr.name)}</div>${tr.price_text ? `<div class="pr">${esc(tr.price_text)}</div>` : ''}${tr.features.length ? `<ul class="tier-feats">${tr.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}</div>`).join('')}</div></section>`;
        }
        ld = { '@context': 'https://schema.org', '@type': 'ItemList', name: b.title || 'Pricing', itemListElement: b.tiers.map((tr, i) => {
          const price = numericPrice(tr.price_text);
          return { '@type': 'ListItem', position: i + 1, item: { '@type': 'Offer', name: tr.name, ...(price ? { price, priceCurrency: 'USD' } : {}), ...(tr.features.length ? { description: tr.features.join('; ') } : {}) } };
        }) };
        break;
      case 'certifications':
        html = `<section class="block alt block-certs"><div class="wrap">${h2(b.title, 'Credentials & certifications')}<ul class="certs">${b.items.map((it) =>
          `<li><strong>${esc(it.name)}</strong>${it.issuer ? ` — ${esc(it.issuer)}` : ''}</li>`).join('')}</ul></div></section>`;
        break;
      case 'service_areas':
        html = `<section class="block wrap block-areas">${h2(b.title, 'Areas we serve')}<ul class="areas">${b.areas.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></section>`;
        break;
      case 'cta': {
        const href = b.url ? safeHref(b.url) : null;
        // Wave-1 G4 variant 'card': the same content in a boxed, centered card —
        // the .v-card class switches the layout (rules in BLOCK_CSS); the default
        // ('banner') emits no class, so existing markup stays byte-identical.
        const vc = b.variant === 'card' ? ' v-card' : '';
        html = `<section class="block alt block-cta${vc}"><div class="wrap cta-inner"><p class="cta-text">${esc(b.text)}</p>${href ? `<a class="btn" href="${attr(href)}" rel="noopener">${esc(b.button || 'Get started')}</a>` : ''}</div></section>`;
        break;
      }
      case 'gallery': {
        // Wave-1 G4 variants: 'masonry' (CSS columns, natural heights) and
        // 'filmstrip' (one horizontal, swipeable row). Same figures either way —
        // only the section's .v-<variant> class changes (rules in BLOCK_CSS);
        // the default ('grid') emits no class → byte-identical markup.
        const vg = b.variant === 'masonry' ? ' v-masonry' : b.variant === 'filmstrip' ? ' v-filmstrip' : '';
        // Wave-2 G18 (DM-11): per-image captions + the opt-in ZERO-JS tap-to-zoom
        // lightbox. `zoom` is a FIELD, not a variant, so it composes with every
        // layout (grid/masonry/filmstrip). Absent (every existing site) → the
        // original markup, byte-identical. The lightbox is the CSS :target
        // technique: each thumb is an anchor to a hidden full-screen <figure
        // id="lb-<n>-<i>"> showing the full-resolution rendition (blockImg with
        // sizes 100vw → browsers pick w1600; focal rides along); close links (the
        // big ✕ pill AND the backdrop itself) target the gallery container
        // (#lb-<n>) so the page returns to the grid; prev/next anchors wrap
        // around. All anchors are focusable with visible focus styles; the close
        // pill is the FIRST focusable inside the overlay (one Tab reaches it).
        // HONEST LIMIT: without JavaScript there is no Escape-key close and no
        // focus trap — the close affordance is large (48px pill, top corner) and
        // the whole backdrop closes; documented in BLOCK_CSS too.
        const caps = (b as { captions?: string[] }).captions || [];
        const capOf = (m: MediaRef, i: number) => caps[i] || m.alt || '';
        if ((b as { zoom?: true }).zoom) {
          const gid = `lb-${zoomSeq++}`;
          const n = b.images.length;
          const thumbs = b.images.map((m, i) => {
            const cap = capOf(m, i);
            return `<figure class="ga"><a class="ga-zoom" href="#${gid}-${i + 1}" aria-label="${attr(cap ? `View larger: ${cap}` : `View image ${i + 1} larger`)}">${blockImg(m, esc, attr, '(max-width:640px) 50vw, 320px')}</a>${cap ? `<figcaption>${esc(cap)}</figcaption>` : ''}</figure>`;
          }).join('');
          const overlays = b.images.map((m, i) => {
            const cap = capOf(m, i);
            const prev = i === 0 ? n : i, next = i === n - 1 ? 1 : i + 2;   // wrap around
            return `<figure class="lb" id="${gid}-${i + 1}" aria-label="${attr(`Image ${i + 1} of ${n}${cap ? `: ${cap}` : ''}`)}">` +
              `<a class="lb-bg" href="#${gid}" aria-hidden="true" tabindex="-1"></a>` +
              `<a class="lb-close" href="#${gid}" aria-label="Close and return to the gallery">✕<span class="lb-close-t">Close</span></a>` +
              `<span class="lb-frame">${blockImg(m, esc, attr, '100vw')}</span>` +
              (cap ? `<figcaption class="lb-cap">${esc(cap)}</figcaption>` : '') +
              (n > 1 ? `<span class="lb-count">${i + 1} / ${n}</span><a class="lb-prev" href="#${gid}-${prev}" aria-label="Previous image">‹</a><a class="lb-next" href="#${gid}-${next}" aria-label="Next image">›</a>` : '') +
              `</figure>`;
          }).join('');
          html = `<section class="block wrap block-gallery${vg} v-zoom">${h2(b.title, 'Gallery')}<div class="gallery" id="${gid}">${thumbs}</div>${overlays}</section>`;
        } else {
          html = `<section class="block wrap block-gallery${vg}">${h2(b.title, 'Gallery')}<div class="gallery">${b.images.map((m, i) =>
            `<figure class="ga">${blockImg(m, esc, attr, '(max-width:640px) 50vw, 320px')}${capOf(m, i) ? `<figcaption>${esc(capOf(m, i))}</figcaption>` : ''}</figure>`).join('')}</div></section>`;
        }
        break;
      }
      case 'before_after':
        html = `<section class="block alt block-ba"><div class="wrap">${h2(b.title, 'Before &amp; after')}${b.items.map((it) =>
          `<div class="ba-pair">${['Before', 'After'].map((lab, k) => { const m = k ? it.after : it.before; return `<figure class="ba-fig"><span class="ba-lab">${lab}</span>${blockImg(m, esc, attr, '(max-width:640px) 100vw, 340px')}</figure>`; }).join('')}${it.caption ? `<p class="ba-cap">${esc(it.caption)}</p>` : ''}</div>`).join('')}</div></section>`;
        break;
      case 'video': {
        // Poster + link-out — NEVER an external iframe (constitution Part 4: zero
        // external origins on the published site). The link opens the video.
        const href = safeHref(b.url);
        if (href) {
          const label = b.caption || b.title || 'Watch the video';
          const inner = b.poster
            ? `<span class="v-poster">${blockImg(b.poster, esc, attr, '(max-width:900px) 100vw, 820px')}<span class="v-play" aria-hidden="true">▶</span></span>`
            : `<span class="v-textlink">▶ ${esc(label)}</span>`;
          html = `<section class="block wrap block-video">${h2(b.title, 'Video')}<a class="v-link" href="${attr(href)}" rel="noopener" aria-label="${attr('Watch: ' + label)}">${inner}</a>${b.caption ? `<p class="v-cap">${esc(b.caption)}</p>` : ''}</section>`;
        }
        break;
      }
      case 'newsletter': {   // calm ESP link-out — mirrors the appointment button
        const href = safeHref(b.url);
        html = href ? `<section class="block wrap block-newsletter">${h2(b.title, 'Get updates from us')}${b.text ? `<p class="nl-text">${esc(b.text)}</p>` : ''}<p class="nl-cta"><a class="btn" href="${attr(href)}" rel="noopener">${esc(b.button || 'Sign up')}</a></p></section>` : '';
        break;
      }
      case 'social': {   // icon strip, link-out only — no live feeds, no external assets
        const links = b.links.map((l) => {
          const href = safeHref(l.url); if (!href) return '';
          const label = SOCIAL_LABELS[l.network] || (l.network ? l.network.charAt(0).toUpperCase() + l.network.slice(1) : 'Website');
          return `<li><a href="${attr(href)}" rel="noopener" target="_blank" aria-label="${attr(label)}" title="${attr(label)}">${socialIcon(l.network)}</a></li>`;
        }).filter(Boolean);
        if (links.length) html = `<section class="block wrap block-social">${h2(b.title, 'Find us online')}<ul class="social">${links.join('')}</ul></section>`;
        break;
      }
      case 'events': {   // clean list; ISO dates show human ("Jul 26") inside <time>
        const rows = b.items.map((it) => {
          const nice = humanDate(it.date);
          const when = nice ? `<time datetime="${attr(it.date)}">${esc(nice)}</time>` : esc(it.date);
          const href = it.url ? safeHref(it.url) : null;
          const name = href ? `<a href="${attr(href)}" rel="noopener">${esc(it.name)}</a>` : esc(it.name);
          return `<li class="ev"><span class="ev-when">${when}${it.time ? `<span class="ev-time">${esc(it.time)}</span>` : ''}</span><span class="ev-body"><span class="ev-name">${name}</span>${it.detail ? `<span class="ev-detail">${esc(it.detail)}</span>` : ''}</span></li>`;
        });
        html = `<section class="block alt block-events"><div class="wrap">${h2(b.title, 'Upcoming events')}<ul class="events">${rows.join('')}</ul></div></section>`;
        // Honest Event schema: only items with a machine-readable ISO date, and only
        // the fields actually present (startDate gains a time only when it's HH:MM).
        const ldEvents = b.items.filter((it) => humanDate(it.date) !== null).map((it) => {
          const t24 = it.time ? TIME_24_RE.exec(it.time) : null;
          return {
            '@type': 'Event', name: it.name,
            startDate: t24 ? `${it.date}T${t24[1].padStart(2, '0')}:${t24[2]}` : it.date,
            ...(it.detail ? { description: it.detail } : {}),
            ...(it.url && safeHref(it.url) ? { url: it.url } : {}),
          };
        });
        if (ldEvents.length) ld = { '@context': 'https://schema.org', '@type': 'ItemList', name: b.title || 'Upcoming events', itemListElement: ldEvents.map((ev, i) => ({ '@type': 'ListItem', position: i + 1, item: ev })) };
        break;
      }
      case 'map': {   // PRIVACY-SAFE: self-hosted image + address text + a directions
        // LINK-OUT (built from the address when none given) — never a third-party
        // tile/iframe embed, so no trackers ever load on the customer's site.
        const dirHref = b.directions_url ? safeHref(b.directions_url)
          : (b.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.address)}` : null);
        const img = b.image ? `<div class="map-img">${blockImg(b.image, esc, attr, '(max-width:900px) 100vw, 820px')}</div>` : '';
        const addr = b.address ? `<p class="map-addr">${esc(b.address)}</p>` : '';
        const dir = dirHref ? `<p class="map-dir"><a href="${attr(dirHref)}" rel="noopener" target="_blank">Get directions →</a></p>` : '';
        if (img || addr) html = `<section class="block wrap block-map">${h2(b.title, 'Find us')}${img}${addr}${dir}</section>`;
        break;
      }
      case 'richtext': {   // readable prose, markdown → safe semantic HTML (escape-first)
        const prose = renderMarkdown(b.body);
        if (prose) html = `<section class="block wrap block-richtext">${b.title ? h2(b.title, '') : ''}<div class="prose">${prose}</div></section>`;
        break;
      }
      case 'image': {   // a figure; wrapped in a safe link only when the link is safe
        if (b.image) {
          const fig = `<figure class="img-fig">${blockImg(b.image, esc, attr, '(max-width:900px) 100vw, 820px', b.decorative ? { decorative: true } : undefined)}${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ''}</figure>`;
          const href = b.link ? safeHref(b.link) : null;
          const inner = href ? `<a class="img-link" href="${attr(href)}" rel="noopener">${fig}</a>` : fig;
          html = `<section class="block wrap block-image">${b.title ? h2(b.title, '') : ''}${inner}</section>`;
        }
        break;
      }
      case 'image_text': {   // image beside prose; flex row STACKS < 620px (see BLOCK_CSS)
        const prose = b.body ? renderMarkdown(b.body) : '';
        const img = b.image ? `<div class="it-media">${blockImg(b.image, esc, attr, '(max-width:620px) 100vw, 460px')}</div>` : '';
        const href = b.button ? safeHref(b.button.url) : null;
        const btn = href ? `<p class="it-cta"><a class="btn" href="${attr(href)}" rel="noopener">${esc(b.button!.label)}</a></p>` : '';
        const text = `<div class="it-text">${prose}${btn}</div>`;
        if (img || prose) html = `<section class="block wrap block-imgtext">${b.title ? h2(b.title, '') : ''}<div class="it-row it-${b.side === 'right' ? 'right' : 'left'}">${img}${text}</div></section>`;
        break;
      }
      case 'accordion': {   // native <details>/<summary> — keyboard + a11y for free, zero JS
        if (b.variant === 'two-column') {
          // Wave-1 G4 variant: an OPEN Q&A grid (two columns ≥620px, stacks on
          // phones) — every answer visible, real headings, still zero JS.
          const rows = b.items.map((it) => `<div class="qa-item"><h3 class="qa-q">${esc(it.summary)}</h3>${it.body ? `<div class="prose">${renderMarkdown(it.body)}</div>` : ''}</div>`).join('');
          html = `<section class="block wrap block-accordion v-two-column">${h2(b.title, 'More information')}<div class="qa-grid">${rows}</div></section>`;
        } else {
          const rows = b.items.map((it) => `<details class="acc-item"><summary>${esc(it.summary)}</summary>${it.body ? `<div class="prose">${renderMarkdown(it.body)}</div>` : ''}</details>`).join('');
          html = `<section class="block wrap block-accordion">${h2(b.title, 'More information')}<div class="accordion">${rows}</div></section>`;
        }
        break;
      }
      case 'tabs': {   // tabbed panels — ZERO JS (CSS radio pattern): keyboard-operable,
        // stacks on phones, no external anything. One tabs section per page (nm fixed).
        const nm = 'site-tabs' + (tabsSeq ? '-' + tabsSeq : '');   // first keeps 'site-tabs' (byte-identical); duplicates get their own group
        tabsSeq++;
        const radios = b.tabs.map((_t, i) => `<input type="radio" name="${nm}" id="${nm}-${i}" class="tab-radio"${i === 0 ? ' checked' : ''}>`).join('');
        const strip = b.tabs.map((t, i) => `<label class="tab-label" for="${nm}-${i}">${esc(t.label)}</label>`).join('');
        const panels = b.tabs.map((t) => {
          const img = t.image ? `<div class="col-media">${blockImg(t.image, esc, attr, '(max-width:620px) 100vw, 640px')}</div>` : '';
          const prose = t.body ? `<div class="prose">${renderMarkdown(t.body)}</div>` : '';
          return `<div class="tab-panel">${img}${prose}</div>`;
        }).join('');
        html = `<section class="block wrap block-tabs">${b.title ? h2(b.title, '') : ''}<div class="tabs">${radios}<div class="tab-strip" role="tablist">${strip}</div><div class="tab-panels">${panels}</div></div></section>`;
        break;
      }
      case 'carousel': {   // swipeable slideshow — ZERO JS (CSS scroll-snap). Keyboard-
        // scrollable (the track is focusable); each slide snaps; images are lazy + responsive.
        const slides = b.slides.map((sl) => {
          const cap = sl.caption ? `<figcaption class="cr-cap">${esc(sl.caption)}</figcaption>` : '';
          return `<figure class="cr-slide">${blockImg(sl.image!, esc, attr, '(max-width:760px) 100vw, 900px')}${cap}</figure>`;
        }).join('');
        html = `<section class="block wrap block-carousel">${b.title ? h2(b.title, '') : ''}<div class="carousel" tabindex="0" role="group" aria-roledescription="carousel" aria-label="${attr(b.title || 'Image carousel')}"><div class="cr-track">${slides}</div></div><p class="cr-hint">Swipe or scroll →</p></section>`;
        break;
      }
      case 'progress': {   // labeled progress/skill bars — width via inline style (CSP allows it)
        const rows = b.items.map((it) => {
          const p = Math.max(0, Math.min(100, Math.round(it.percent)));
          return `<div class="pgb"><div class="pgb-head"><span class="pgb-lbl">${esc(it.label)}</span><span class="pgb-pct">${p}%</span></div><div class="pgb-track"><div class="pgb-fill" style="width:${p}%" role="progressbar" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100" aria-label="${attr(it.label)}"></div></div></div>`;
        }).join('');
        html = `<section class="block wrap block-progress">${b.title ? h2(b.title, '') : ''}<div class="pgbars">${rows}</div></section>`;
        break;
      }
      case 'buttons': {   // a small centered row of real links; drop any without a safe href
        const btns = b.buttons.map((bt) => {
          const href = safeHref(bt.url); if (!href) return '';
          return `<a class="btn${bt.style === 'outline' ? ' btn-outline' : ''}" href="${attr(href)}" rel="noopener">${esc(bt.label)}</a>`;
        }).filter(Boolean);
        if (btns.length) html = `<section class="block wrap block-buttons">${b.title ? h2(b.title, '') : ''}<div class="btn-row">${btns.join('')}</div></section>`;
        break;
      }
      case 'divider': {   // presentational only — a hairline rule or plain vertical space
        html = b.style === 'space'
          ? `<div class="block-divider div-space div-${b.size}" aria-hidden="true"></div>`
          : `<div class="block wrap block-divider div-line div-${b.size}"><hr></div>`;
        break;
      }
      case 'form': {   // custom form builder — typed fields → accessible, XSS-safe form
        const inner = renderForm(b, { esc, attr, safeHref, formEndpoint: ctx.formEndpoint });
        html = `<section class="block wrap block-form">${b.title ? h2(b.title, '') : ''}${inner}</section>`;
        break;
      }
      case 'booking': {   // NATIVE booking widget — a calm, mobile-first, first-party
        // stepper (service → day → open slot → details → confirm) driven by the site's
        // OWN /book/:siteId endpoints. Zero external origins. Degrades gracefully: with
        // no JS the visitor sees a clear note pointing them to the page's contact
        // details; the server validates every step regardless. The enhancer builds all
        // dynamic UI via createElement + textContent (owner data never interpolated
        // into HTML). Without a bookEndpoint (unpublished/preview) it shows a placeholder.
        const endpoint = ctx.bookEndpoint || '';
        const intro = b.intro ? `<p class="bk-intro">${esc(b.intro)}</p>` : '';
        const inner = endpoint
          ? `<div class="booking-widget" data-book="${attr(endpoint)}">${intro}<div class="bk-stage" aria-live="polite"><p class="bk-msg">Loading available times…</p><noscript><p class="bk-msg">Online booking needs JavaScript turned on. Please enable it, or use the contact details on this page to book with us directly.</p></noscript></div></div>`
          : `${intro}<p class="bk-msg">Your booking widget will appear here once your site is published.</p>`;
        html = `<section class="block wrap block-booking">${h2(b.title, 'Book an appointment')}${inner}</section>`;
        if (endpoint) html += bookingScript();
        ld = { '@context': 'https://schema.org', '@type': 'ReserveAction', name: b.title || 'Book an appointment' };
        break;
      }
      case 'reviews_wall': {   // NATIVE reviews wall — real, owner-approved customer
        // reviews (rating + quote + name + optional owner reply). The visible content;
        // the honest schema.org (AggregateRating + Review) is folded into the page's
        // ONE business node by the template (reviewsSchema() below) to avoid a second,
        // duplicate LocalBusiness node — so this block emits NO standalone ld.
        const avg = b.aggregate.average % 1 === 0 ? String(b.aggregate.average) : b.aggregate.average.toFixed(1);
        const summary = b.aggregate.count > 0
          ? `<p class="rw-agg"><span class="rw-agg-stars" aria-hidden="true">${'★'.repeat(Math.min(5, Math.round(b.aggregate.average)))}${'☆'.repeat(Math.max(0, 5 - Math.round(b.aggregate.average)))}</span> <span class="rw-agg-num">${esc(avg)} out of 5</span> <span class="rw-agg-count">· ${esc(String(b.aggregate.count))} review${b.aggregate.count === 1 ? '' : 's'}</span></p>`
          : '';
        const cards = b.reviews.map((r) => {
          const full = Math.min(5, Math.max(0, Math.round(r.rating)));
          const stars = '★'.repeat(full) + '☆'.repeat(5 - full);
          const reply = r.reply
            ? `<div class="rw-reply"><p class="rw-reply-lbl">Response from the owner</p><p class="rw-reply-body">${esc(r.reply)}</p></div>`
            : '';
          const when = r.date ? `<time class="rw-date" datetime="${attr(r.date)}">${esc(r.date)}</time>` : '';
          return `<figure class="rw-card"><p class="rw-stars" aria-label="${attr(r.rating + ' out of 5')}">${stars}</p>` +
            `<blockquote class="rw-body"><p>${esc(r.body)}</p></blockquote>` +
            `<figcaption class="rw-author">${esc(r.author)}${when}</figcaption>${reply}</figure>`;
        }).join('');
        // Wave-1 G4 variants — same honest data, a different curated presentation:
        // 'quotes' = large centered serif pull-quotes (one per row); 'strip' = the
        // SAME cards in one compact, horizontally-scrolling band. Default ('cards')
        // keeps the original grid byte-identically. Schema is unchanged either way
        // (reviewsSchema reads the block data, not the markup).
        if (b.variant === 'quotes') {
          const quotes = b.reviews.map((r) => {
            const full = Math.min(5, Math.max(0, Math.round(r.rating)));
            const stars = '★'.repeat(full) + '☆'.repeat(5 - full);
            const when = r.date ? `<time class="rw-date" datetime="${attr(r.date)}">${esc(r.date)}</time>` : '';
            const reply = r.reply
              ? `<div class="rw-reply"><p class="rw-reply-lbl">Response from the owner</p><p class="rw-reply-body">${esc(r.reply)}</p></div>`
              : '';
            return `<figure class="rw-quote"><p class="rw-stars" aria-label="${attr(r.rating + ' out of 5')}">${stars}</p>` +
              `<blockquote class="rw-quote-body"><p>${esc(r.body)}</p></blockquote>` +
              `<figcaption class="rw-quote-author">${esc(r.author)}${when}</figcaption>${reply}</figure>`;
          }).join('');
          html = `<section class="block alt block-reviews-wall v-quotes"><div class="wrap"><div class="rw-head">${h2(b.title, 'Reviews')}${summary}</div><div class="rw-quotes">${quotes}</div></div></section>`;
        } else if (b.variant === 'strip') {
          html = `<section class="block alt block-reviews-wall v-strip"><div class="wrap"><div class="rw-head">${h2(b.title, 'Reviews')}${summary}</div><div class="rw-strip">${cards}</div></div></section>`;
        } else {
          html = `<section class="block alt block-reviews-wall"><div class="wrap"><div class="rw-head">${h2(b.title, 'Reviews')}${summary}</div><div class="rw-grid">${cards}</div></div></section>`;
        }
        break;
      }
      case 'columns': {   // Layout Container — a responsive grid that stacks < 620px
        const cells = b.columns.map((c) => {
          // #184: a cell holding a nested COMPONENT renders it (recursively, via the
          // SAME engine — never a container, so recursion is bounded). Falls back to the
          // classic body/image/button stack when there's no nested block.
          if (c.block) { const nested = renderSiteBlocks([c.block], ctx); if (nested[0] && nested[0].html) return { inner: `<div class="col-block">${nested[0].html}</div>`, span: c.span }; }
          const prose = c.body ? renderMarkdown(c.body) : '';
          const img = c.image ? `<div class="col-media">${blockImg(c.image, esc, attr, '(max-width:620px) 100vw, 320px')}</div>` : '';
          const href = c.button ? safeHref(c.button.url) : null;
          const btn = href ? `<p class="col-cta"><a class="btn" href="${attr(href)}" rel="noopener">${esc(c.button!.label)}</a></p>` : '';
          return { inner: `${img}${prose ? `<div class="prose">${prose}</div>` : ''}${btn}`, span: c.span };
        });
        const cnt = b.columns.length;
        const hasSpan = cells.some((c) => c.span !== undefined);
        if (!hasSpan && cnt >= 2 && cnt <= 3) {
          // ORIGINAL equal-width path — kept byte-identical so existing sites (and the
          // render goldens) are unchanged. Spans + 1/4+ columns take the grid path below.
          const cols = cells.map((c) => `<div class="col">${c.inner}</div>`).join('');
          html = `<section class="block wrap block-columns">${b.title ? h2(b.title, '') : ''}<div class="cols" data-cols="${cnt}">${cols}</div></section>`;
        } else {
          // 12-unit responsive grid (Adobe's Layout Container). Each cell spans its
          // width; a cell with no span takes an equal share. Everything stacks to one
          // column below 620px, so it stays readable on phones automatically.
          const equal = Math.max(1, Math.min(12, Math.round(12 / Math.max(1, cnt))));
          const cols = cells.map((c) => {
            const sp = c.span !== undefined ? Math.max(1, Math.min(12, c.span)) : equal;
            return `<div class="col" data-span="${sp}">${c.inner}</div>`;
          }).join('');
          html = `<section class="block wrap block-columns">${b.title ? h2(b.title, '') : ''}<div class="cols cols-grid">${cols}</div></section>`;
        }
        break;
      }
      case 'cards': {   // a teaser grid; each card is one link when a safe href is set
        const cards = b.cards.map((c) => {
          const media = c.image ? `<div class="tc-media">${blockImg(c.image, esc, attr, '(max-width:620px) 100vw, 300px')}</div>` : '';
          const head = c.heading ? `<p class="tc-title">${esc(c.heading)}</p>` : '';
          const text = c.text ? `<p class="tc-text">${esc(c.text)}</p>` : '';
          const href = c.link ? safeHref(c.link) : null;
          const body = `<div class="tc-body">${head}${text}${href ? `<span class="tc-link" aria-hidden="true">Learn more →</span>` : ''}</div>`;
          return href
            ? `<a class="teaser-card" href="${attr(href)}" rel="noopener">${media}${body}</a>`
            : `<div class="teaser-card">${media}${body}</div>`;
        }).join('');
        html = `<section class="block wrap block-cards">${b.title ? h2(b.title, '') : ''}<div class="card-grid">${cards}</div></section>`;
        break;
      }
      case 'download': {   // an accessible download link to a first-party file (zero external origins)
        if (b.file) {
          // DL-FILES: a document (PDF) carries `original` — the raw file deployed
          // verbatim, which is what actually serves. An image download falls back to
          // its largest variant. No resolvable target → nothing to offer (dropped
          // upstream in resolveBlockMedia; the href guard is the belt-and-braces).
          const v = b.file.variants || {};
          const href = b.file.original || v.w1600 || v.w800 || v.w400 || Object.values(v)[0];
          if (href) {
            const name = b.label || b.file.alt || 'file';
            const icon = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
            html = `<section class="block wrap block-download">${b.title ? h2(b.title, '') : ''}<p class="dl-row"><a class="dl" href="${attr(href)}" download rel="noopener" aria-label="${attr('Download ' + name)}">${icon}<span>Download ${esc(name)}</span></a></p></section>`;
          }
        }
        break;
      }
      case 'title': {   // a standalone heading + optional subtitle
        html = `<section class="block wrap block-titleonly"><h2>${esc(b.title)}</h2>${b.subtitle ? `<p class="title-sub">${esc(b.subtitle)}</p>` : ''}</section>`;
        break;
      }
      case 'link_list': {   // a titled list of safe links (safeHref drops anything unsafe)
        const items = b.links.map((lk) => { const href = safeHref(lk.url); return href ? `<li><a href="${attr(href)}" rel="noopener">${esc(lk.label)}</a></li>` : ''; }).filter(Boolean).join('');
        if (items) html = `<section class="block wrap block-linklist">${b.title ? h2(b.title, '') : ''}<ul class="linklist">${items}</ul></section>`;
        break;
      }
      case 'table': {   // a simple data table; the wrapper scrolls it horizontally on phones
        const head = b.headers.length ? `<thead><tr>${b.headers.map((hd) => `<th scope="col">${esc(hd)}</th>`).join('')}</tr></thead>` : '';
        const body = `<tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
        html = `<section class="block wrap block-table">${b.title ? h2(b.title, '') : ''}<div class="table-wrap"><table class="site-table">${head}${body}</table></div></section>`;
        break;
      }
      case 'spotlight': {   // a prominent highlight band — eyebrow + heading + prose + optional button
        const href = b.button ? safeHref(b.button.url) : null;
        const btn = href ? `<p class="sp-cta"><a class="btn" href="${attr(href)}" rel="noopener">${esc(b.button!.label)}</a></p>` : '';
        const eyebrow = b.eyebrow ? `<p class="sp-eyebrow">${esc(b.eyebrow)}</p>` : '';
        const body = b.body ? `<div class="prose sp-body">${renderMarkdown(b.body)}</div>` : '';
        html = `<section class="block wrap block-spotlight"><div class="sp-inner">${eyebrow}<h2>${esc(b.title)}</h2>${body}${btn}</div></section>`;
        break;
      }
      case 'toc':   // deferred — rendered after anchors are assigned (needs sibling headings)
        html = '';
        break;
    }
    if (b.type === 'partners') {
      html = `<section class="block wrap block-partners">${h2(b.title, 'Trusted by')}<ul class="partners">${b.logos.map((m) => `<li>${blockImg(m, esc, attr, '150px')}</li>`).join('')}</ul></section>`;
    }
    if (b.type === 'reviews') {
      const full = Math.round(b.rating);
      const stars = '★'.repeat(Math.min(5, full)) + '☆'.repeat(Math.max(0, 5 - full));
      html = `<section class="block alt block-reviews"><div class="wrap rev-inner">${h2(b.title, 'What customers say')}<p class="rev-stars" aria-hidden="true">${stars}</p><p class="rev-text">${esc(String(b.rating))} out of 5 — from ${esc(String(b.count))} reviews${b.source ? ` on ${esc(b.source)}` : ''}</p></div></section>`;
    }
    if (b.type === 'appointment') {
      const href = safeHref(b.url);
      html = href ? `<section class="block wrap block-appt">${h2(b.title, 'Book an appointment')}${b.text ? `<p class="appt-text">${esc(b.text)}</p>` : ''}<p class="appt-cta"><a class="btn" href="${attr(href)}" rel="noopener">${esc(b.button || 'Book now')}</a></p></section>` : '';
    }
    built.push({ b, html: applyLook(html, (b as { look?: BlockLook }).look), ld });
  }

  // Second pass: stamp a stable, de-duped anchor id onto every rendered <section>,
  // and collect the heading list a Table-of-contents block links to.
  const usedIds = new Set<string>();
  const tocEntries: Array<{ id: string; text: string }> = [];
  for (const e of built) {
    if (!e.html || e.b.type === 'toc' || !e.html.includes('<section')) continue;   // divider = <div>, toc = deferred
    const heading = effHeading(e.b);
    const base = slugifyAnchor(heading || e.b.type);
    let id = base, n = 2;
    while (usedIds.has(id)) id = `${base}-${n++}`;
    usedIds.add(id);
    e.html = e.html.replace('<section ', `<section id="${attr(id)}" `);   // first section only
    if (heading) tocEntries.push({ id, text: heading });
  }

  // Third pass: render each toc block now that anchors exist (skipped when the page
  // has no headings to list). A labelled <nav> landmark of real in-page jump links.
  for (const e of built) {
    if (e.b.type !== 'toc') continue;
    if (!tocEntries.length) { e.html = ''; continue; }
    const title = (e.b as SiteBlockToc).title || 'On this page';
    e.html = applyLook(`<nav class="block wrap block-toc" aria-label="${attr(title)}"><h2>${esc(title)}</h2><ol class="toc">${
      tocEntries.map((x) => `<li><a href="#${attr(x.id)}">${esc(x.text)}</a></li>`).join('')}</ol></nav>`, (e.b as { look?: BlockLook }).look);
  }

  const out: RenderedBlock[] = [];
  const usedKeys = new Set<string>();
  for (const e of built) {
    if (!e.html) continue;
    const b = e.b;
    // Every rendered block needs a UNIQUE key: the template keys its parts map by it
    // (parts[key] = html) and the section-order/visibility machinery addresses it by
    // it — two blocks sharing a key silently overwrite each other (a dropped second
    // "rich text"/"features"/etc. would vanish). MULTI blocks (form/columns/cards)
    // key off their stable id; every other type keys off its type, then de-dupes with
    // a numeric suffix so the FIRST instance keeps `block_<type>` (byte-identical to
    // before) and later duplicates get `block_<type>_2`, `_3`, … — all distinct.
    const baseKey = (b.type === 'form' || b.type === 'columns' || b.type === 'cards')
      ? `block_${b.type}_${(b as { id: string }).id}`
      : `block_${b.type}`;
    let key = baseKey, n = 2;
    while (usedKeys.has(key)) key = `${baseKey}_${n++}`;
    usedKeys.add(key);
    out.push({ key, type: b.type, html: e.html, ...(e.ld ? { ld: e.ld } : {}) });
  }
  return out;
}

// Phase T-STYLE: the no-`color-mix` fallback for a tinted section background —
// DERIVED from lib/palettes.ts brandTint (contrast-checked), so palettes.ts is the
// single source of the tint. Modern browsers upgrade to a live, brand-adaptive
// color-mix of var(--accent) (see the @supports rule in BLOCK_CSS below).
const TINT_FALLBACK = brandTint('#5b3fa0');

/** The extra CSS the block sections need — appended once to a template's stylesheet.
 *  Reuses existing tokens (--accent, --line, --soft…); no external assets. */
export const BLOCK_CSS = `.stats{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
.card.stat{text-align:center}.stat-v{font-size:2rem;font-weight:800;color:var(--accent-dark,var(--accent))}.stat-l{color:var(--soft);font-size:.95rem;margin-top:4px}
ol.process{margin:8px 0 0 0;padding:0;list-style:none;counter-reset:step}
ol.process li{counter-increment:step;position:relative;padding:14px 0 14px 46px;border-bottom:1px solid var(--line)}
ol.process li::before{content:counter(step);position:absolute;left:0;top:12px;width:30px;height:30px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700}
.step-t{display:block;font-weight:700}.step-d{display:block;color:var(--soft);font-size:.95rem;margin-top:2px}
ul.tier-feats,ul.certs,ul.areas{margin:10px 0 0 0;padding-left:18px}
ul.tier-feats li,ul.certs li{margin:4px 0}
ul.areas{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:8px}
ul.areas li{background:var(--wash);color:var(--ink);padding:5px 12px;border-radius:999px;font-size:.92rem}
.block-cta .cta-inner{display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap}
.block-cta .cta-text{font-size:1.2rem;font-weight:700;margin:0}
.team-card .team-photo{margin:-2px 0 10px}
.team-card .team-photo img{width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:10px;display:block}
.partners{list-style:none;margin:12px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:26px;align-items:center}
.partners li{margin:0}
.partners img{height:44px;width:auto;max-width:150px;object-fit:contain;display:block}
.block-reviews .rev-inner{text-align:center}
.rev-stars{font-size:1.6rem;letter-spacing:4px;color:var(--accent);margin:6px 0 2px}
.rev-text{color:var(--soft);margin:0;font-size:1.02rem}
.block-reviews-wall .rw-head{text-align:center;margin-bottom:8px}
.rw-agg{margin:6px 0 0;font-size:1.05rem}
.rw-agg-stars{color:var(--accent);letter-spacing:2px}
.rw-agg-num{font-weight:700;color:var(--ink)}
.rw-agg-count{color:var(--soft)}
.rw-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;margin-top:18px}
.rw-card{margin:0;background:var(--wash,#faf9fc);border:1px solid var(--line);border-radius:12px;padding:16px 18px}
.rw-stars{color:var(--accent);letter-spacing:2px;margin:0 0 8px;font-size:1.05rem}
.rw-body{margin:0;border:0;padding:0;font-size:.98rem;color:var(--ink);line-height:1.55}
.rw-body p{margin:0}
.rw-author{margin-top:10px;font-weight:700;font-size:.92rem;color:var(--ink);display:flex;justify-content:space-between;align-items:baseline;gap:10px}
.rw-date{font-weight:400;color:var(--soft);font-size:.82rem}
.rw-reply{margin-top:10px;padding:10px 12px;border-left:3px solid var(--accent);background:color-mix(in srgb,var(--accent) 6%,transparent);border-radius:0 8px 8px 0}
.rw-reply-lbl{margin:0 0 3px;font-size:.72rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--accent-dark,var(--accent))}
.rw-reply-body{margin:0;font-size:.9rem;color:var(--soft)}
.block-appt{text-align:center}
.appt-text{color:var(--soft);max-width:56ch;margin:8px auto 0}
.appt-cta{margin-top:14px}
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}
.gallery .ga{margin:0}
.gallery .ga img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:10px;display:block}
.gallery .ga figcaption{font-size:.85rem;color:var(--soft);margin-top:5px}
.ba-pair{margin-top:12px}
.ba-pair .ba-fig{position:relative;margin:0 0 10px}
.ba-pair .ba-lab{position:absolute;top:8px;left:8px;background:var(--ink,#222);color:#fff;font-size:.72rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:3px 9px;border-radius:999px}
.ba-pair .ba-fig img{width:100%;border-radius:10px;display:block}
.ba-cap{color:var(--soft);font-size:.95rem;margin-top:4px}
@media(min-width:620px){.ba-pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}.ba-pair .ba-cap{grid-column:1/-1}}
.v-link{display:block;text-decoration:none;color:inherit;margin-top:6px}
.v-poster{position:relative;display:block}
.v-poster img{width:100%;border-radius:12px;display:block}
.v-play{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:64px;height:64px;border-radius:50%;background:rgba(0,0,0,.6);color:#fff;display:flex;align-items:center;justify-content:center;font-size:24px}
.v-textlink{display:inline-block;font-weight:700;color:var(--accent-dark,var(--accent));border:2px solid var(--accent);border-radius:999px;padding:10px 20px}
.v-cap{color:var(--soft);font-size:.95rem;margin-top:8px}
.block-newsletter{text-align:center}
.nl-text{color:var(--soft);max-width:56ch;margin:8px auto 0}
.nl-cta{margin-top:14px}
ul.social{list-style:none;margin:14px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:12px}
ul.social a{display:flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:50%;border:2px solid var(--accent);color:var(--accent-dark,var(--accent))}
ul.social svg{display:block}
ul.events{list-style:none;margin:10px 0 0;padding:0}
ul.events .ev{display:flex;gap:16px;padding:12px 0;border-bottom:1px solid var(--line)}
.ev-when{flex:0 0 92px;font-weight:700;color:var(--accent-dark,var(--accent))}
.ev-time{display:block;font-weight:400;color:var(--soft);font-size:.9rem}
.ev-name{display:block;font-weight:700}
.ev-detail{display:block;color:var(--soft);font-size:.95rem;margin-top:2px}
.block-map .map-img img{width:100%;border-radius:12px;display:block}
.map-addr{margin:10px 0 0;font-size:1.05rem}
.map-dir{margin-top:6px}
.map-dir a{font-weight:700;color:var(--accent-dark,var(--accent))}
.block-richtext .prose,.block-imgtext .it-text .prose{max-width:68ch}
.prose>*:first-child{margin-top:0}.prose>*:last-child{margin-bottom:0}
.prose h2,.prose h3{margin:1.1em 0 .4em}.prose p{margin:0 0 .8em}
.prose ul,.prose ol{margin:0 0 .8em;padding-left:1.3em}.prose li{margin:.2em 0}
.prose blockquote{margin:0 0 .8em;padding-left:14px;border-left:3px solid var(--accent);color:var(--soft)}
.prose a{color:var(--accent-dark,var(--accent))}
.block-image .img-fig{margin:0}
.block-image .img-fig img{width:100%;border-radius:12px;display:block}
.block-image figcaption{font-size:.9rem;color:var(--soft);margin-top:6px}
.block-image .img-link{display:block;text-decoration:none;color:inherit}
.it-row{display:flex;flex-direction:column;gap:20px;margin-top:6px}
.it-row .it-media img{width:100%;border-radius:12px;display:block}
.it-text{align-self:center}
.it-cta{margin:14px 0 0}
@media(min-width:620px){.it-row{flex-direction:row;align-items:center;gap:32px}.it-row .it-media,.it-row .it-text{flex:1 1 0;min-width:0}.it-row.it-right{flex-direction:row-reverse}}
.accordion{margin-top:8px}
.acc-item{border-bottom:1px solid var(--line);padding:0}
.acc-item summary{cursor:pointer;font-weight:700;padding:14px 0;list-style:none;position:relative;padding-right:28px}
.acc-item summary::-webkit-details-marker{display:none}
.acc-item summary::after{content:"+";position:absolute;right:4px;top:50%;transform:translateY(-50%);font-weight:400;font-size:1.3rem;color:var(--accent)}
.acc-item[open] summary::after{content:"–"}
.acc-item .prose{padding:0 0 14px}
.acc-item summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.btn-row{display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-top:8px}
.btn-outline{background:transparent;color:var(--accent-dark,var(--accent));border:2px solid var(--accent)}
.block-divider{padding-top:0;padding-bottom:0}
.block-divider hr{border:none;border-top:1px solid var(--line);margin:0}
.div-small{--div-gap:16px}.div-medium{--div-gap:36px}.div-large{--div-gap:64px}
.block-divider.div-line{margin:var(--div-gap,36px) 0}
.div-space{height:var(--div-gap,36px)}
.block-columns .cols{display:grid;gap:24px;grid-template-columns:1fr;margin-top:6px}
.block-columns .col-media img{width:100%;border-radius:10px;display:block;margin-bottom:10px}
.block-columns .col .prose{max-width:none}
.block-columns .col-block>.block{padding-top:0;padding-bottom:0}
.block-columns .col-block .wrap{padding-left:0;padding-right:0;max-width:none;margin:0}
.block-columns .col-block section:first-child{margin-top:0}
.block-columns .col-block h2{margin-top:0}
.block-columns .col-cta{margin:12px 0 0}
@media(min-width:620px){.block-columns .cols[data-cols="2"]{grid-template-columns:1fr 1fr}.block-columns .cols[data-cols="3"]{grid-template-columns:repeat(3,1fr)}}
/* Layout Container: a 12-unit responsive grid. Each cell spans data-span units on
   desktop and the full width on phones (auto-responsive). Cells wrap to new rows
   when their spans exceed 12 — Adobe's "float to new line". */
@media(min-width:620px){.block-columns .cols-grid{grid-template-columns:repeat(12,1fr)}.block-columns .cols-grid>.col[data-span="1"]{grid-column:span 1}.block-columns .cols-grid>.col[data-span="2"]{grid-column:span 2}.block-columns .cols-grid>.col[data-span="3"]{grid-column:span 3}.block-columns .cols-grid>.col[data-span="4"]{grid-column:span 4}.block-columns .cols-grid>.col[data-span="5"]{grid-column:span 5}.block-columns .cols-grid>.col[data-span="6"]{grid-column:span 6}.block-columns .cols-grid>.col[data-span="7"]{grid-column:span 7}.block-columns .cols-grid>.col[data-span="8"]{grid-column:span 8}.block-columns .cols-grid>.col[data-span="9"]{grid-column:span 9}.block-columns .cols-grid>.col[data-span="10"]{grid-column:span 10}.block-columns .cols-grid>.col[data-span="11"]{grid-column:span 11}.block-columns .cols-grid>.col[data-span="12"]{grid-column:span 12}}
/* Tabs — ZERO-JS tabbed panels via the CSS radio pattern. The radios are visually
   hidden but keyboard-focusable (arrow keys switch tabs); the checked radio reveals
   its panel + marks its label. Stacks fine on phones (the strip wraps). */
.block-tabs .tabs{margin-top:6px}
.block-tabs .tab-radio{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.block-tabs .tab-strip{display:flex;flex-wrap:wrap;gap:2px;border-bottom:2px solid var(--line);margin-bottom:2px}
.block-tabs .tab-label{padding:10px 16px;cursor:pointer;font-weight:600;color:var(--soft);border-bottom:2px solid transparent;margin-bottom:-2px;border-radius:8px 8px 0 0}
.block-tabs .tab-label:hover{color:var(--ink,inherit)}
.block-tabs .tab-panel{display:none;padding:18px 2px}
.block-tabs .tab-panel .col-media img{border-radius:10px;display:block;max-width:100%;margin-bottom:12px}
.block-tabs .tab-panel .prose{max-width:none}
.block-tabs .tab-radio:nth-of-type(1):checked~.tab-strip .tab-label:nth-of-type(1),.block-tabs .tab-radio:nth-of-type(2):checked~.tab-strip .tab-label:nth-of-type(2),.block-tabs .tab-radio:nth-of-type(3):checked~.tab-strip .tab-label:nth-of-type(3),.block-tabs .tab-radio:nth-of-type(4):checked~.tab-strip .tab-label:nth-of-type(4),.block-tabs .tab-radio:nth-of-type(5):checked~.tab-strip .tab-label:nth-of-type(5),.block-tabs .tab-radio:nth-of-type(6):checked~.tab-strip .tab-label:nth-of-type(6){color:var(--accent);border-bottom-color:var(--accent)}
.block-tabs .tab-radio:nth-of-type(1):checked~.tab-panels .tab-panel:nth-of-type(1),.block-tabs .tab-radio:nth-of-type(2):checked~.tab-panels .tab-panel:nth-of-type(2),.block-tabs .tab-radio:nth-of-type(3):checked~.tab-panels .tab-panel:nth-of-type(3),.block-tabs .tab-radio:nth-of-type(4):checked~.tab-panels .tab-panel:nth-of-type(4),.block-tabs .tab-radio:nth-of-type(5):checked~.tab-panels .tab-panel:nth-of-type(5),.block-tabs .tab-radio:nth-of-type(6):checked~.tab-panels .tab-panel:nth-of-type(6){display:block}
.block-tabs .tab-radio:nth-of-type(1):focus-visible~.tab-strip .tab-label:nth-of-type(1),.block-tabs .tab-radio:nth-of-type(2):focus-visible~.tab-strip .tab-label:nth-of-type(2),.block-tabs .tab-radio:nth-of-type(3):focus-visible~.tab-strip .tab-label:nth-of-type(3),.block-tabs .tab-radio:nth-of-type(4):focus-visible~.tab-strip .tab-label:nth-of-type(4),.block-tabs .tab-radio:nth-of-type(5):focus-visible~.tab-strip .tab-label:nth-of-type(5),.block-tabs .tab-radio:nth-of-type(6):focus-visible~.tab-strip .tab-label:nth-of-type(6){outline:2px solid var(--accent);outline-offset:2px}
/* Carousel — ZERO-JS swipeable slideshow via CSS scroll-snap. The track is focusable
   (keyboard scroll) and each slide snaps to center; images stay responsive + lazy. */
.block-carousel .carousel{margin-top:6px;border-radius:12px}
.block-carousel .carousel:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.block-carousel .cr-track{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;scroll-behavior:smooth;-webkit-overflow-scrolling:touch;padding-bottom:4px}
.block-carousel .cr-slide{flex:0 0 100%;scroll-snap-align:center;margin:0}
.block-carousel .cr-slide img{width:100%;height:auto;border-radius:12px;display:block}
.block-carousel .cr-cap{margin-top:8px;color:var(--soft);font-size:.95rem;text-align:center}
.block-carousel .cr-hint{margin:8px 0 0;text-align:center;color:var(--soft);font-size:.8rem;letter-spacing:.03em}
@media(min-width:760px){.block-carousel .cr-slide{flex-basis:72%}.block-carousel .cr-hint{display:none}}
/* Progress bars — labeled, animated-in, width set inline (0..100%). */
.block-progress .pgbars{margin-top:8px;display:flex;flex-direction:column;gap:16px}
.block-progress .pgb-head{display:flex;justify-content:space-between;font-weight:600;margin-bottom:6px}
.block-progress .pgb-pct{color:var(--accent)}
.block-progress .pgb-track{background:color-mix(in srgb,var(--accent) 12%,transparent);border-radius:999px;height:12px;overflow:hidden}
.block-progress .pgb-fill{background:var(--accent);height:100%;border-radius:999px;min-width:2px}
/* optional icon on a feature/highlight item (decorative — aria-hidden in markup) */
.svc-ic{font-size:1.9rem;line-height:1;margin-bottom:8px}
.card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;margin-top:8px}
.teaser-card{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--card,#fff)}
a.teaser-card{text-decoration:none;color:inherit}
.teaser-card .tc-media img{width:100%;aspect-ratio:16/10;object-fit:cover;display:block}
.teaser-card .tc-body{padding:14px 16px}
.teaser-card .tc-title{font-weight:700;margin:0 0 4px}
.teaser-card .tc-text{color:var(--soft);font-size:.95rem;margin:0}
.teaser-card .tc-link{display:inline-block;margin-top:10px;font-weight:700;color:var(--accent-dark,var(--accent))}
a.teaser-card:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
ol.toc{margin:8px 0 0;padding-left:1.2em}
ol.toc li{margin:.25em 0}
ol.toc a{color:var(--accent-dark,var(--accent))}
.block-download .dl-row{margin:8px 0 0}
.block-download .dl{display:inline-flex;align-items:center;gap:10px;border:2px solid var(--accent);border-radius:12px;padding:12px 18px;text-decoration:none;color:var(--accent-dark,var(--accent));font-weight:700}
.block-download .dl:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.block-download .dl svg{flex:0 0 auto}
/* ── Phase BK · native booking widget (first-party stepper) ── */
.booking-widget{max-width:560px;margin-top:8px}
.bk-intro{color:var(--soft);margin:0 0 12px}
.bk-step{font-weight:700;margin:0 0 10px}
.bk-msg{color:var(--soft)}
.bk-services{display:grid;gap:10px}
.bk-service{display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:left;width:100%;border:1px solid var(--line);border-radius:12px;background:var(--card,#fff);color:inherit;padding:12px 16px;cursor:pointer}
.bk-service:hover{border-color:var(--accent)}
.bk-service:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.bk-svc-name{font-weight:700}
.bk-svc-meta{color:var(--soft);font-size:.9rem}
.bk-svc-desc{color:var(--soft);font-size:.9rem;margin-top:2px}
.bk-back{background:none;border:none;color:var(--accent-dark,var(--accent));font-weight:700;cursor:pointer;padding:0 0 10px}
.bk-date{width:100%;max-width:240px;padding:10px 12px;border:1px solid var(--line);border-radius:10px}
.bk-slots{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px}
.bk-slot{border:1px solid var(--line);border-radius:10px;background:var(--card,#fff);color:inherit;padding:10px 8px;cursor:pointer;font-weight:600}
.bk-slot:hover{border-color:var(--accent)}
.bk-slot:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.bk-form{display:grid;gap:12px}
.bk-field{display:flex;flex-direction:column;gap:4px;font-weight:600}
.bk-field input,.bk-field textarea{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:10px;font:inherit}
.bk-field textarea{min-height:80px}
.bk-hp{position:absolute;left:-9999px;height:1px;overflow:hidden}
.bk-summary{background:var(--wash,#f5f5f5);border-radius:10px;padding:10px 14px;font-weight:600;margin:0}
.bk-submit{justify-self:start}
.bk-err{color:#b42318;margin:0;min-height:1em}
.bk-done{text-align:center;padding:14px 0}
.bk-done-ic{display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;border-radius:50%;background:var(--accent);color:#fff;font-size:1.5rem;margin:0 auto 8px}
.bk-done-msg{font-weight:600;margin:0}
/* ── Phase T-STYLE · curated per-section style options (owner picks; never raw CSS) ── */
/* background: 'tinted' = a brand-derived, contrast-safe wash; 'plain' = clears the
   auto-alternate band. .block.<class> ties the (0,2,0) specificity of .block.alt and
   wins by source order (BLOCK_CSS is appended after the template's .block.alt rule). */
.block.block--bg-tint{background:${TINT_FALLBACK}}
@supports (background:color-mix(in srgb,red,#fff)){.block.block--bg-tint{background:var(--block-tint,color-mix(in srgb,var(--accent) 8%,var(--paper,#f7f7f5)))}}
.block.block--bg-plain{background:none;border-top:0;border-bottom:0}
/* bold bands — a strong accent or dark section with light text throughout. Text
   colours are forced light so contrast holds regardless of the block's content. */
.block.block--bg-accent{background:var(--accent-dark,var(--accent));color:#fff}
.block.block--bg-dark{background:#1a1622;color:#f2eef8}
.block.block--bg-accent :is(h1,h2,h3,h4,h5,p,li,dt,dd,figcaption,blockquote,strong,em,.nm,.pr,.ds,.stat-v,.stat-l,summary),.block.block--bg-dark :is(h1,h2,h3,h4,h5,p,li,dt,dd,figcaption,blockquote,strong,em,.nm,.pr,.ds,.stat-v,.stat-l,summary){color:inherit}
.block.block--bg-accent a:not(.btn),.block.block--bg-dark a:not(.btn){color:#fff;text-decoration:underline}
.block.block--bg-accent .btn{background:#fff;color:var(--accent-dark,var(--accent));border-color:#fff}
.block.block--bg-dark .btn{background:var(--accent);color:#fff;border-color:var(--accent)}
.block.block--bg-accent .card,.block.block--bg-dark .card{background:rgba(255,255,255,.10);border-color:rgba(255,255,255,.22)}
/* spacing: vertical padding, honouring the site's --spacing-scale like .block does */
.block--space-tight{padding-top:calc(28px * var(--spacing-scale,1));padding-bottom:calc(28px * var(--spacing-scale,1))}
.block--space-roomy{padding-top:calc(84px * var(--spacing-scale,1));padding-bottom:calc(84px * var(--spacing-scale,1))}
/* width: full-bleed section; inner content re-capped to a readable measure + padded
   (so full-width backgrounds reach the edges but text never touches the screen). */
.block--full{max-width:none;padding-left:0;padding-right:0}
.block--full>*{max-width:1000px;margin-left:auto;margin-right:auto;padding-left:22px;padding-right:22px}
/* responsive visibility — hide a section on one device class */
@media(max-width:620px){.block--hide-mobile{display:none!important}}
@media(min-width:621px){.block--hide-desktop{display:none!important}}
/* align: center the section's heading + short text; structured content (grids,
   lists, tables, prose bodies) stays left-aligned so it never turns ragged. */
.block--align-center{text-align:center}
.block--align-center .svc-grid,.block--align-center .cards,.block--align-center .card-grid,.block--align-center .cols,.block--align-center .accordion,.block--align-center .prose,.block--align-center ul,.block--align-center ol,.block--align-center table,.block--align-center .it-row{text-align:left}
.block--align-center .btn-row,.block--align-center .cta-inner{justify-content:center}
.block-titleonly .title-sub{color:var(--soft);font-size:1.05rem;margin-top:6px;max-width:60ch}
.block-linklist ul.linklist{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-direction:column;gap:2px}
.block-linklist ul.linklist li{margin:0}
.block-linklist ul.linklist a{display:inline-block;padding:8px 0;color:var(--accent);text-decoration:none;border-bottom:1px solid transparent}
.block-linklist ul.linklist a:hover{border-bottom-color:var(--accent)}
.block-table .table-wrap{overflow-x:auto;margin-top:12px;-webkit-overflow-scrolling:touch}
table.site-table{border-collapse:collapse;width:100%;min-width:min(100%,480px);font-size:.97rem}
table.site-table th,table.site-table td{text-align:left;padding:10px 14px;border-bottom:1px solid var(--line);vertical-align:top}
table.site-table thead th{font-weight:700;color:var(--ink);border-bottom:2px solid var(--line)}
table.site-table tbody tr:last-child td{border-bottom:none}
.block-spotlight .sp-inner{padding:28px 26px;border-radius:16px;background:var(--wash,rgba(0,0,0,.04));border:1px solid var(--line);text-align:center;max-width:760px;margin:0 auto}
.block-spotlight .sp-eyebrow{text-transform:uppercase;letter-spacing:.12em;font-size:.78rem;font-weight:700;color:var(--accent);margin:0 0 8px}
.block-spotlight h2{margin:0}
.block-spotlight .sp-body{margin-top:10px;color:var(--soft)}
.block-spotlight .sp-cta{margin-top:18px}
/* ── Wave-1 G4 · per-block STYLE VARIANTS (Adobe Style System, curated). Classes
   are enumerated in BLOCK_VARIANTS; a block with no variant gets NO class, so none
   of these rules can touch a default section. Token-driven (--accent/--line/--wash/
   --ink/--soft/--font-display), so every variant stays on-brand on all templates. */
/* CTA 'card' — boxed + centered. .block.block-cta.v-card (0,3,0) outranks the
   template's .block.alt band; BLOCK_CSS is appended after it, same trick as
   .block--bg-plain. */
.block.block-cta.v-card{background:none;border-top:0;border-bottom:0}
.block-cta.v-card .cta-inner{flex-direction:column;text-align:center;gap:16px;background:var(--wash,rgba(0,0,0,.04));border:1px solid var(--line);border-radius:16px;padding:36px 28px;max-width:640px;margin:0 auto}
/* Gallery 'masonry' — CSS columns; images keep their natural heights (no crop). */
.block-gallery.v-masonry .gallery{display:block;columns:3 220px;column-gap:12px}
.block-gallery.v-masonry .gallery .ga{break-inside:avoid;margin:0 0 12px}
.block-gallery.v-masonry .gallery .ga img{aspect-ratio:auto;height:auto}
/* Gallery 'filmstrip' — one horizontal, swipe/keyboard-scrollable row. */
.block-gallery.v-filmstrip .gallery{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch;padding-bottom:6px}
.block-gallery.v-filmstrip .gallery .ga{flex:0 0 auto;width:min(70vw,320px);scroll-snap-align:start}
/* Accordion 'two-column' — an open Q&A grid (answers always visible, zero JS). */
.block-accordion.v-two-column .qa-grid{display:grid;grid-template-columns:1fr;gap:22px 36px;margin-top:8px}
@media(min-width:620px){.block-accordion.v-two-column .qa-grid{grid-template-columns:1fr 1fr}}
.block-accordion.v-two-column .qa-q{margin:0 0 6px;font-size:1.02rem}
.block-accordion.v-two-column .qa-item .prose{color:var(--soft);max-width:none}
/* Pricing 'list' — atelier-style rows: name, a quiet dotted rule, price. */
.block-pricing.v-list .price-list{margin-top:8px;max-width:720px}
.block-pricing.v-list .pl-row{padding:14px 0;border-bottom:1px solid var(--line)}
.block-pricing.v-list .pl-row:last-child{border-bottom:none}
.block-pricing.v-list .pl-head{display:flex;align-items:baseline;gap:12px}
.block-pricing.v-list .pl-name{font-weight:700}
.block-pricing.v-list .pl-rule{flex:1;border-bottom:1px dotted var(--line);align-self:center;min-width:24px}
.block-pricing.v-list .pl-price{font-weight:700;color:var(--accent-dark,var(--accent));white-space:nowrap}
.block-pricing.v-list .pl-feats{margin:6px 0 0;color:var(--soft);font-size:.92rem}
/* Reviews wall 'quotes' — large, centered pull-quotes in the display face. */
.block-reviews-wall.v-quotes .rw-quotes{max-width:720px;margin:18px auto 0;display:flex;flex-direction:column;gap:36px}
.block-reviews-wall.v-quotes .rw-quote{margin:0;text-align:center}
.block-reviews-wall.v-quotes .rw-quote .rw-stars{margin:0 0 10px;letter-spacing:3px}
.block-reviews-wall.v-quotes .rw-quote-body{margin:0;border:0;padding:0;font-family:var(--font-display,Georgia,'Times New Roman',serif);font-size:1.3rem;line-height:1.55;font-style:italic;color:var(--ink)}
.block-reviews-wall.v-quotes .rw-quote-body p{margin:0}
.block-reviews-wall.v-quotes .rw-quote-author{margin-top:12px;font-weight:700;font-size:.92rem;display:inline-flex;align-items:baseline;gap:10px}
.block-reviews-wall.v-quotes .rw-reply{text-align:left;max-width:480px;margin-left:auto;margin-right:auto}
/* Reviews wall 'strip' — the same cards in one compact scrolling band. */
.block-reviews-wall.v-strip .rw-strip{display:flex;gap:14px;overflow-x:auto;margin-top:18px;padding-bottom:6px;scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch}
.block-reviews-wall.v-strip .rw-card{flex:0 0 auto;width:min(78vw,300px);scroll-snap-align:start}
/* ── Wave-2 G18 · gallery tap-to-zoom lightbox — the CSS :target technique, ZERO
   JS (platform law: blocks emit no scripts). Additive .v-zoom composes with any
   gallery layout (grid/masonry/filmstrip). The overlay is position:fixed with its
   OWN deliberate scrim/ink (same posture as .v-play/.ba-lab overlay chrome) so it
   reads identically on all 8 template families; interactive states use the brand
   --accent token. HONEST LIMIT: no JS means no Escape-key close and no focus trap
   — mitigations: a large (48px) labelled close pill, first in the overlay's tab
   order, plus the entire backdrop is a close link. Motion only under
   prefers-reduced-motion:no-preference. */
.block-gallery.v-zoom .ga-zoom{display:block;color:inherit;text-decoration:none;cursor:zoom-in;border-radius:10px}
.block-gallery.v-zoom .ga-zoom:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.lb{display:none;position:fixed;inset:0;z-index:9999;margin:0;padding:20px;background:rgba(12,10,16,.93);flex-direction:column;align-items:center;justify-content:center}
.lb:target{display:flex}
.lb-bg{position:absolute;inset:0;cursor:zoom-out}
.lb-frame{position:relative;display:flex;align-items:center;justify-content:center;max-width:min(1600px,100%)}
.lb-frame picture,.lb-frame img{display:block;max-width:100%;max-height:76vh}
.lb-frame img{width:auto;height:auto;object-fit:contain;border-radius:8px}
.lb-cap{position:relative;margin-top:14px;color:#fff;text-align:center;font-size:.95rem;max-width:70ch}
.lb-count{position:relative;margin-top:8px;color:rgba(255,255,255,.72);font-size:.8rem;letter-spacing:.08em}
.lb-close{position:absolute;top:16px;right:16px;display:inline-flex;align-items:center;gap:8px;min-height:48px;padding:10px 20px;border-radius:999px;background:rgba(255,255,255,.16);color:#fff;font-weight:700;font-size:1rem;text-decoration:none}
.lb-close:hover{background:rgba(255,255,255,.3)}
.lb-prev,.lb-next{position:absolute;top:50%;transform:translateY(-50%);display:flex;align-items:center;justify-content:center;width:48px;height:48px;border-radius:50%;background:rgba(255,255,255,.16);color:#fff;font-size:1.7rem;line-height:1;text-decoration:none}
.lb-prev{left:14px}.lb-next{right:14px}
.lb-prev:hover,.lb-next:hover{background:rgba(255,255,255,.3)}
.lb a:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
@media(max-width:640px){.lb{padding:12px}.lb-close{top:10px;right:10px}.lb-prev{left:6px}.lb-next{right:6px}}
@media(prefers-reduced-motion:no-preference){.lb:target .lb-frame{animation:lb-zoom .16s ease-out}}
@keyframes lb-zoom{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:none}}`;
