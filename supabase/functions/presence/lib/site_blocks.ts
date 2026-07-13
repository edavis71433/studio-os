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
  SiteBlockPartners, SiteBlockReviews, SiteBlockAppointment,
  SiteBlockNewsletter, SiteBlockSocial, SiteBlockEvents,
  SiteBlockRichText, SiteBlockAccordion, SiteBlockButtons, SiteBlockDivider,
  SiteBlockColumns, SiteBlockCards, SiteBlockDownload, SiteBlockToc,
} from './render_types.ts';
import { renderMarkdown } from './markdown.ts';
import { normalizeFormDefinition, renderForm, type FormDefinition } from './forms.ts';

/** The block types this engine realizes (⊆ the site_components catalog keys). */
export const REALIZED_BLOCK_TYPES: readonly SiteBlockType[] = [
  'features', 'stats', 'team', 'process', 'pricing', 'certifications', 'service_areas', 'cta',
  'gallery', 'before_after', 'video',
  'partners', 'reviews', 'appointment',
  'newsletter', 'social', 'events', 'map',
  'richtext', 'image', 'image_text', 'accordion', 'buttons', 'divider',
  'form',
  'columns', 'cards', 'download', 'toc',
];

// Per-block item caps — bounded content, never unbounded. Total blocks capped too.
// Most types are one-instance-per-site; the MULTI set (form/columns/cards) may repeat,
// so the total cap is generous headroom rather than the realized-type count.
const MAX_BLOCKS = 32;
const CAP = { features: 8, stats: 6, team: 12, process: 10, pricing: 4, certifications: 12, service_areas: 40, tierFeatures: 8, gallery: 16, beforeAfter: 8, partners: 12, social: 8, events: 12, accordion: 10, buttons: 3, columns: 3, cards: 8 };
// The block types a site may hold more than one of (each de-collided to a unique id).
const MULTI = new Set<string>(['form', 'columns', 'cards']);

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

// ── Stored (pre-resolution) shapes for media blocks — carry media by ID; the
//    serializer's resolveBlockMedia() turns IDs into MediaRefs (reusing ref()). ──
interface StoredTeam { type: 'team'; title?: string; members: Array<{ name: string; role?: string; bio?: string; media_id?: string }> }
interface StoredGallery { type: 'gallery'; title?: string; image_ids: string[] }
interface StoredBeforeAfter { type: 'before_after'; title?: string; items: Array<{ before_id: string; after_id: string; caption?: string }> }
interface StoredVideo { type: 'video'; title?: string; url: string; caption?: string; poster_id?: string }
interface StoredPartners { type: 'partners'; title?: string; image_ids: string[] }
interface StoredMap { type: 'map'; title?: string; image_media_id?: string; address?: string; directions_url?: string }
// Text & layout staples: image/image_text carry media by ID (resolved by resolveBlockMedia);
// richtext/accordion/buttons/divider carry no media (pass straight through).
interface StoredImage { type: 'image'; title?: string; image_id?: string; caption?: string; alt?: string; link?: string; decorative?: boolean }
interface StoredImageText { type: 'image_text'; title?: string; image_id?: string; body: string; side: 'left' | 'right'; button?: { label: string; url: string } }
// Layout & utility staples (T-BLOCKS r4). Columns/cards carry media by ID (resolved
// by resolveBlockMedia) + a stable id (multi-instance). Download carries one file id.
// Toc carries no media/id — its list is derived at render from sibling headings.
interface StoredColumns { type: 'columns'; id: string; title?: string; columns: Array<{ body: string; image_id?: string; button?: { label: string; url: string } }> }
interface StoredCards { type: 'cards'; id: string; title?: string; cards: Array<{ heading: string; text?: string; image_id?: string; link?: string }> }
interface StoredDownload { type: 'download'; title?: string; file_id?: string; label?: string }
export type StoredBlock =
  | SiteBlockFeatures | SiteBlockStats | StoredTeam | SiteBlockProcess | SiteBlockPricing
  | SiteBlockCertifications | SiteBlockServiceAreas | SiteBlockCtaBanner
  | StoredGallery | StoredBeforeAfter | StoredVideo
  | StoredPartners | SiteBlockReviews | SiteBlockAppointment
  | SiteBlockNewsletter | SiteBlockSocial | SiteBlockEvents | StoredMap
  | SiteBlockRichText | StoredImage | StoredImageText | SiteBlockAccordion | SiteBlockButtons | SiteBlockDivider
  | StoredColumns | StoredCards | StoredDownload | SiteBlockToc
  | FormDefinition;

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
    // MULTI blocks (form/columns/cards) are exempt from the one-per-type rule.
    if (!(REALIZED_BLOCK_TYPES as readonly string[]).includes(type) || (!MULTI.has(type) && seen.has(type))) continue;
    const title = s((b as any).title, 80) || undefined;
    let block: StoredBlock | null = null;
    switch (type as SiteBlockType) {
      case 'features': {
        const items = arr((b as any).items).map((it) => ({ title: s(it?.title, 80), text: s(it?.text, 240) || undefined })).filter((it) => it.title).slice(0, CAP.features);
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
        const image_ids = arr((b as any).image_ids).map(uid).filter(Boolean).slice(0, CAP.gallery);
        if (image_ids.length) block = { type: 'gallery', title, image_ids };
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
      case 'appointment': {   // booking button — link-out only (zero external origins)
        const url = s((b as any).url, 300);
        if (/^https?:\/\//i.test(url)) block = { type: 'appointment', title, url, text: s((b as any).text, 200) || undefined, button: s((b as any).button, 40) || undefined } as SiteBlockAppointment;
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
          return col;
        }).filter((c) => c.body || c.image_id || c.button).slice(0, CAP.columns);
        if (cols.length >= 2) block = { type: 'columns', id: uniqueId('columns', (b as any).id, 'columns'), title, columns: cols };
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
    }
    if (block) { out.push(block); if (!MULTI.has(type)) seen.add(type); }
    if (out.length >= MAX_BLOCKS) break;
  }
  return out;
}

/** Resolve stored media IDs → MediaRefs using the serializer's ref() (which also
 *  registers them in the media manifest, so variants are generated — the ONE media
 *  pipeline, reused). A media block whose media can't resolve is dropped; a team
 *  keeps its text even without photos. StoredBlock[] → render-facing SiteBlock[]. */
export function resolveBlockMedia(blocks: StoredBlock[], ref: (id: string) => MediaRef | null): SiteBlock[] {
  const out: SiteBlock[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case 'team':
        out.push({ type: 'team', title: b.title, members: b.members.map((m) => ({ name: m.name, role: m.role, bio: m.bio, media: m.media_id ? ref(m.media_id) : null })) });
        break;
      case 'gallery': {
        const images = b.image_ids.map((id) => ref(id)).filter((x): x is MediaRef => !!x);
        if (images.length) out.push({ type: 'gallery', title: b.title, images });
        break;
      }
      case 'before_after': {
        const items: SiteBlockBeforeAfter['items'] = [];
        for (const it of b.items) {
          const before = ref(it.before_id), after = ref(it.after_id);
          if (before && after) items.push({ before, after, ...(it.caption ? { caption: it.caption } : {}) });
        }
        if (items.length) out.push({ type: 'before_after', title: b.title, items });
        break;
      }
      case 'video':
        out.push({ type: 'video', title: b.title, url: b.url, caption: b.caption, poster: b.poster_id ? ref(b.poster_id) : null });
        break;
      case 'partners': {
        const logos = b.image_ids.map((id) => ref(id)).filter((x): x is MediaRef => !!x);
        if (logos.length) out.push({ type: 'partners', title: b.title, logos });
        break;
      }
      case 'map': {   // an address keeps the block valuable even if the image can't resolve
        const image = b.image_media_id ? ref(b.image_media_id) : null;
        if (image || b.address) out.push({ type: 'map', title: b.title, image, address: b.address, directions_url: b.directions_url });
        break;
      }
      case 'image': {   // an image with no resolvable media is nothing to show — drop it
        const image = b.image_id ? ref(b.image_id) : null;
        if (image) out.push({ type: 'image', title: b.title, image, caption: b.caption, alt: b.alt, link: b.link, decorative: b.decorative });
        break;
      }
      case 'columns':   // prose/button ride through; each column's image resolves (or drops to null)
        out.push({ type: 'columns', id: b.id, title: b.title, columns: b.columns.map((c) => ({ body: c.body, image: c.image_id ? ref(c.image_id) : null, button: c.button })) });
        break;
      case 'cards':
        out.push({ type: 'cards', id: b.id, title: b.title, cards: b.cards.map((c) => ({ heading: c.heading, text: c.text, image: c.image_id ? ref(c.image_id) : null, link: c.link })) });
        break;
      case 'download': {   // a download with no resolvable file is nothing to offer — drop it
        const file = b.file_id ? ref(b.file_id) : null;
        if (file) out.push({ type: 'download', title: b.title, file, label: b.label });
        break;
      }
      case 'image_text': {   // prose keeps the block valuable even if the image can't resolve
        const image = b.image_id ? ref(b.image_id) : null;
        if (image || b.body) out.push({ type: 'image_text', title: b.title, image, body: b.body, side: b.side, button: b.button });
        break;
      }
      default:
        out.push(b);
    }
  }
  return out;
}

/** Deterministic <img> from a resolved MediaRef — mirrors each template's img():
 *  responsive srcset, lazy, alt, focal crop. Zero external origins. */
function blockImg(m: MediaRef, esc: (s: string) => string, attr: (s: string) => string, sizes: string, opts?: { decorative?: boolean }): string {
  const v = m.variants || {};
  const srcset = ['w400', 'w800', 'w1600'].filter((k) => v[k]).map((k) => `${attr(v[k])} ${k.slice(1)}w`).join(', ');
  const src = v.w800 || v.w400 || Object.values(v)[0]; if (!src) return '';
  const dims = m.width && m.height ? ` width="${m.width}" height="${m.height}"` : '';
  const focal = m.focal ? ` style="object-position:${m.focal.x}% ${m.focal.y}%"` : '';
  // Decorative → empty alt + role="presentation" (announced by nothing). Otherwise
  // the media's alt describes the image for AT + search.
  const a11y = opts?.decorative ? ` alt="" role="presentation"` : ` alt="${attr(m.alt || '')}"`;
  return `<img src="${attr(src)}"${srcset ? ` srcset="${srcset}" sizes="${attr(sizes)}"` : ''}${a11y}${dims} loading="lazy" decoding="async"${focal}>`;
}

// ── Render context: the escapers + safe-href a template already has, injected so
//    this module stays free of any template's helper imports. ──
export interface BlockRenderCtx {
  esc: (s: string) => string;
  attr: (s: string) => string;
  safeHref: (s: string) => string | null;
  /** Phase FB: the public submit endpoint for custom form blocks (site.formEndpoint). */
  formEndpoint?: string;
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
  partners: 'Trusted by', reviews: 'What customers say', appointment: 'Book an appointment',
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

  for (const b of blocks || []) {
    let html = '', ld: object | undefined;
    switch (b.type) {
      case 'features':
        html = `<section class="block wrap block-features">${h2(b.title, 'Why choose us')}<div class="svc-grid">${b.items.map((it) =>
          `<div class="svc"><div class="nm">${esc(it.title)}</div>${it.text ? `<div class="ds">${esc(it.text)}</div>` : ''}</div>`).join('')}</div></section>`;
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
        html = `<section class="block wrap block-pricing">${h2(b.title, 'Pricing')}<div class="cards">${b.tiers.map((tr) =>
          `<div class="card price-tier"><div class="nm">${esc(tr.name)}</div>${tr.price_text ? `<div class="pr">${esc(tr.price_text)}</div>` : ''}${tr.features.length ? `<ul class="tier-feats">${tr.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}</div>`).join('')}</div></section>`;
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
        html = `<section class="block alt block-cta"><div class="wrap cta-inner"><p class="cta-text">${esc(b.text)}</p>${href ? `<a class="btn" href="${attr(href)}" rel="noopener">${esc(b.button || 'Get started')}</a>` : ''}</div></section>`;
        break;
      }
      case 'gallery':
        html = `<section class="block wrap block-gallery">${h2(b.title, 'Gallery')}<div class="gallery">${b.images.map((m) =>
          `<figure class="ga">${blockImg(m, esc, attr, '(max-width:640px) 50vw, 320px')}${m.alt ? `<figcaption>${esc(m.alt)}</figcaption>` : ''}</figure>`).join('')}</div></section>`;
        break;
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
        const rows = b.items.map((it) => `<details class="acc-item"><summary>${esc(it.summary)}</summary>${it.body ? `<div class="prose">${renderMarkdown(it.body)}</div>` : ''}</details>`).join('');
        html = `<section class="block wrap block-accordion">${h2(b.title, 'More information')}<div class="accordion">${rows}</div></section>`;
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
      case 'columns': {   // 2–3 equal columns; CSS grid stacks to one column < 620px
        const cols = b.columns.map((c) => {
          const prose = c.body ? renderMarkdown(c.body) : '';
          const img = c.image ? `<div class="col-media">${blockImg(c.image, esc, attr, '(max-width:620px) 100vw, 320px')}</div>` : '';
          const href = c.button ? safeHref(c.button.url) : null;
          const btn = href ? `<p class="col-cta"><a class="btn" href="${attr(href)}" rel="noopener">${esc(c.button!.label)}</a></p>` : '';
          return `<div class="col">${img}${prose ? `<div class="prose">${prose}</div>` : ''}${btn}</div>`;
        }).join('');
        const n = Math.min(3, Math.max(2, b.columns.length));
        html = `<section class="block wrap block-columns">${b.title ? h2(b.title, '') : ''}<div class="cols" data-cols="${n}">${cols}</div></section>`;
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
          const v = b.file.variants || {};
          const href = v.w1600 || v.w800 || v.w400 || Object.values(v)[0];
          if (href) {
            const name = b.label || b.file.alt || 'file';
            const icon = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
            html = `<section class="block wrap block-download">${b.title ? h2(b.title, '') : ''}<p class="dl-row"><a class="dl" href="${attr(href)}" download rel="noopener" aria-label="${attr('Download ' + name)}">${icon}<span>Download ${esc(name)}</span></a></p></section>`;
          }
        }
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
    built.push({ b, html, ld });
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
    e.html = `<nav class="block wrap block-toc" aria-label="${attr(title)}"><h2>${esc(title)}</h2><ol class="toc">${
      tocEntries.map((x) => `<li><a href="#${attr(x.id)}">${esc(x.text)}</a></li>`).join('')}</ol></nav>`;
  }

  const out: RenderedBlock[] = [];
  for (const e of built) {
    if (!e.html) continue;
    const b = e.b;
    // MULTI blocks (form/columns/cards) add their id → a per-instance key so the
    // section-order/visibility machinery never collides two of the same type.
    const key = (b.type === 'form' || b.type === 'columns' || b.type === 'cards')
      ? `block_${b.type}_${(b as { id: string }).id}`
      : `block_${b.type}`;
    out.push({ key, type: b.type, html: e.html, ...(e.ld ? { ld: e.ld } : {}) });
  }
  return out;
}

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
.block-columns .col-cta{margin:12px 0 0}
@media(min-width:620px){.block-columns .cols[data-cols="2"]{grid-template-columns:1fr 1fr}.block-columns .cols[data-cols="3"]{grid-template-columns:repeat(3,1fr)}}
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
.block-download .dl svg{flex:0 0 auto}`;
