// ── The website's own settings, kept with each snapshot (builder list item 187, Nov 2026) ──
// Restoring a version or a checkpoint rewrote the business details, the lists and the
// colours, never the settings row: Home's sections, the owner's pages and their sections,
// the menu, the header and footer choices, the logo, cover and share image, the
// announcement. So no restore brought a deleted section or page back.
//
// Which settings those are is one list: SETTINGS_CONTENT_FIELDS (lib/site_roles.ts), the
// website itself, which 'edit' covers. Account configuration in the same row (verification
// codes, automation switches, the visit counter, ad tags) is never restored.
//
// A snapshot's content holds the sections as the renderer takes them: links to saved
// sections already resolved, photos as variant paths, empty or half-filled sections left
// out. So since migration 0169 every new snapshot also keeps those settings exactly as
// stored (presence_snapshots.draft_settings) and a restore writes them back as they were.
// A snapshot from before has none: its settings are rebuilt from the content
// (settingsFromContent), which brings back what that version showed.
//
// Either way a photo the version showed that has since left the library is taken out
// (withoutMedia; the draft writer counts it), and a page the restore takes off the draft
// is kept 30 days in Recently deleted pages by the trigger on presence_settings (migration
// 0154), which also takes a page off that list when it comes back exactly as it was.
import { svc } from './db.ts';
import { SETTINGS_CONTENT_FIELDS } from './site_roles.ts';
import { pageShowFields } from './page_access.ts';
import { unresolveBlockMedia } from './site_blocks.ts';
import { missingColumnSignal } from './inbound_email.ts';
import type { MediaRef, SnapshotContent } from './render_types.ts';

/** The website's settings as stored: SETTINGS_CONTENT_FIELDS → value. */
export type DraftSettings = Record<string, unknown>;

// Each field's column default (migrations 0019, 0051, 0057, 0058, 0068, 0104, 0105, 0161, 0184): what a
// site that never set it has, so a version without it goes back to it. A field added to
// SETTINGS_CONTENT_FIELDS later and not named here stays as it is on a restore from a
// version kept before it existed.
const DEFAULTS: Record<string, unknown> = {
  category_order: [], cover_media_id: null, logo_media_id: null, og_media_id: null,
  announcement_text: '', announcement_url: '', announcement_expires_at: null,
  hero_layout: '', nav_style: '', sections_hidden: [], sections_order: [], footer_hours: true, footer_social: true,
  pages_noindex: [], page_seo: {}, blocks: [], pages: [], nav: [],
  popup: null,   // builder list item 148: no pop-up
  icon_media_id: null,   // builder list item 158: the template's letter in the browser tab
};

/** The website's settings in a draft's settings row, as stored. A field the row lacks
 *  takes its default, so a restore puts back exactly this. Pure. */
export function draftSettingsOf(row: Record<string, unknown> | null | undefined): DraftSettings {
  const out: DraftSettings = {};
  for (const f of SETTINGS_CONTENT_FIELDS) {
    const v = row && typeof row === 'object' ? row[f] : undefined;
    if (v !== undefined) out[f] = v;
    else if (f in DEFAULTS) out[f] = DEFAULTS[f];
  }
  return out;
}

/** A stored value with every media id in `gone` taken out, wherever it sits: one in a
 *  list leaves the list (a gallery's caption with it, as they're index-aligned) and any
 *  other leaves its field. Each id taken out is added to `took`. Pure. */
export function withoutMedia(v: unknown, gone: ReadonlySet<string>, took: Set<string>, depth = 0): unknown {
  if (v == null || depth > 12) return v;
  const isGone = (x: unknown) => typeof x === 'string' && gone.has(x.toLowerCase());
  const take = (x: unknown) => { took.add(String(x).toLowerCase()); return false; };
  if (Array.isArray(v)) return v.filter((x) => !isGone(x) || take(x)).map((x) => withoutMedia(x, gone, took, depth + 1));
  if (typeof v !== 'object') return v;
  const o = v as Record<string, unknown>;
  const ids = Array.isArray(o.image_ids) ? o.image_ids : null;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(o)) {
    if (isGone(x)) { take(x); continue; }
    if (k === 'captions' && ids && Array.isArray(x)) { out[k] = x.filter((_, i) => !isGone(ids[i])); continue; }
    out[k] = withoutMedia(x, gone, took, depth + 1);
  }
  return out;
}

/** What a restore writes back from a snapshot that kept the settings: every field, as
 *  kept, less the photos in `gone`. A media column whose photo is gone is cleared. Pure. */
export function settingsBack(kept: DraftSettings, gone: ReadonlySet<string>, took: Set<string>): DraftSettings {
  const out: DraftSettings = {};
  for (const f of SETTINGS_CONTENT_FIELDS) {
    if (!(f in kept)) { if (f in DEFAULTS) out[f] = DEFAULTS[f]; continue; }
    const v = kept[f];
    out[f] = typeof v === 'string' && gone.has(v.toLowerCase()) ? (took.add(v.toLowerCase()), null) : withoutMedia(v, gone, took);
  }
  return out;
}

/** The settings rebuilt from a version's content, for a snapshot kept before they were:
 *  the sections and pages as that version showed them (lib/site_blocks.ts
 *  unresolveBlockMedia), its menu, header and footer choices, and each photo back to its
 *  media id through `idOf` (null when it has left the library). A field the version
 *  didn't carry was off or empty then. Pure. */
export function settingsFromContent(settings: SnapshotContent['settings'], idOf: (m: MediaRef | string) => string | null, altOf?: (id: string) => string | undefined): DraftSettings {
  const s = settings || {};
  const blocks = (list: unknown) => unresolveBlockMedia(list, idOf, altOf);
  const media = (m: MediaRef | null | undefined) => (m && typeof m === 'object' ? idOf(m) : null);
  // a page's share image is kept as its photo's path; the owner stores the photo's id
  const pageSeo: Record<string, unknown> = {};
  for (const [key, e] of Object.entries(s.page_seo || {})) {
    if (!e || typeof e !== 'object') continue;
    const { share_image, ...rest } = e as Record<string, unknown>;
    const id = typeof share_image === 'string' && share_image ? idOf(share_image) : null;
    pageSeo[key] = id ? { ...rest, share_image: id } : rest;
  }
  return {
    ...DEFAULTS,
    category_order: Array.isArray(s.category_order) ? s.category_order : [],
    blocks: blocks(s.blocks),
    pages: (Array.isArray(s.pages) ? s.pages : []).map((p) => ({ slug: p.slug, title: p.title, blocks: blocks(p.blocks), ...(p.hideNav === true ? { hideNav: true } : {}), ...pageShowFields(p) })),
    nav: Array.isArray(s.nav) ? s.nav : [],
    nav_style: s.nav_style || '', hero_layout: s.hero_layout || '',
    sections_hidden: s.sections?.hidden || [], sections_order: s.sections?.order || [],
    footer_hours: s.footer?.hours !== false, footer_social: s.footer?.social !== false,
    logo_media_id: media(s.logo), og_media_id: media(s.og_image), cover_media_id: media(s.cover), icon_media_id: media(s.icon),
    announcement_text: s.announcement?.text || '', announcement_url: s.announcement?.url || '', announcement_expires_at: s.announcement?.expires_at || null,
    page_seo: pageSeo,
    pages_noindex: Array.isArray(s.pages_noindex) ? s.pages_noindex : [],
    popup: s.popup || null,   // item 148: a version carries its pop-up only while it was on
  };
}

/** Is this a database without migration 0169? Pure. */
export function noDraftSettingsColumn(r: { ok: boolean; json: unknown; text?: string }): boolean {
  return !r.ok && missingColumnSignal(r.json, r.text, 'draft_settings');
}

/** Write one snapshot row with the draft's settings beside it. A database without
 *  migration 0169 takes the row without them, so a restore of it rebuilds them from
 *  the content. */
export async function insertSnapshot(row: Record<string, unknown>, settings: DraftSettings | null | undefined, prefer = 'return=representation') {
  const send = (body: Record<string, unknown>) => svc('presence_snapshots', { method: 'POST', headers: { Prefer: prefer }, body: JSON.stringify(body) });
  if (!settings) return send(row);
  const r = await send({ ...row, draft_settings: settings });
  return noDraftSettingsColumn(r) ? send(row) : r;
}
