// ── Section content CRUD (M7) — additive routes for the Client Room ─────────
// One declarative spec per entity; every write goes through siteDb (the owner's
// JWT, where RLS proves ownership; an authorised scope pinned to its site),
// validates a closed field set, and records exactly one provenance event with
// field NAMES only. Deletes are soft; visibility is
// a toggle ("on the menu", never "gone").
//
//   GET    /offerings|testimonials|faqs|posts        — list (draft view)
//   POST   /offerings|...                            — create
//   PUT    /offerings/{id}|...                       — update fields
//   DELETE /offerings/{id}|...                       — soft delete
//   GET|PUT /location                                — the v1 singleton
//   GET|PUT /settings                                — section order, cover
import { json } from '../../_shared/http.ts';
import { svc, type SiteDb } from '../lib/db.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import { guardStaleDraft } from '../lib/optimistic_lock.ts';
import { suggestedBlocksFor, suggestionNoteFor } from '../lib/vertical_presets.ts';
import { REALIZED_BLOCK_TYPES, validateBlocksWithMap, type SectionMapEntry } from '../lib/site_blocks.ts';
import { componentsForIndustry } from '../lib/site_components.ts';
import { listStarterLayouts, starterKeyFor } from '../lib/starter_layouts.ts';
import { normalizeTags } from '../lib/search_index.ts';
import { normalizeAuthors, normalizeCategories, scheduleProblem } from '../lib/blog.ts';
import { detectPageRenames, duplicatePageInSettings, pageRefs, PAGE_SLUG_RE, type PageRename } from '../lib/page_ops.ts';
import { lockedEdits, lockedMessage } from '../lib/section_lock.ts';
import { publishActorKind } from '../lib/actor_kind.ts';
import { OPEN_STAGES } from '../lib/sales_lifecycle.ts';
import { GOOGLE_TAG_RE, META_PIXEL_RE } from '../lib/ad_tags.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';
import { UUID_LOWER_RE as UUID_RE } from '../lib/uuid.ts';

/** FD-T4 / T-STARTER: everything the block library needs to lead with the RIGHT
 *  choices for this site's industry, plus one-click pre-arranged starter layouts —
 *  all read-only guidance (the owner still adds + fills + approves + publishes).
 *  Reuses three existing pure layers, so nothing is duplicated on the client:
 *    · vertical_presets  → the recommended BLOCKS (the "Recommended for you" group)
 *    · site_components    → the industries[] model → an ORDER so recommended blocks
 *                           surface first inside every purpose group (hides nothing)
 *    · starter_layouts    → pre-filled layouts applied through the same /settings save */
export async function handleBlockSuggestions(site: SiteRow, cors: Record<string, string>) {
  let industry = 'generic';
  try {
    const r = await svc(`presence_settings?site_id=eq.${site.id}&select=industry_key&limit=1`);
    if (r.ok && Array.isArray(r.json) && r.json[0]?.industry_key) industry = String(r.json[0].industry_key);
  } catch { /* fall back to generic */ }
  const realized = new Set<string>(REALIZED_BLOCK_TYPES);
  // Recommended-first ordering: vertical_presets suggestions lead, then any other
  // block the site_components industries[] model marks relevant to this industry —
  // realized types only, deduped. The client sorts each group by this; nothing is
  // dropped, so the full library stays reachable below the recommended ones.
  const order: string[] = [];
  const push = (t: string) => { if (realized.has(t) && !order.includes(t)) order.push(t); };
  suggestedBlocksFor(industry).forEach(push);
  componentsForIndustry(industry).forEach((c) => push(c.key));
  return json({ data: {
    blocks: suggestedBlocksFor(industry),
    note: suggestionNoteFor(industry),
    order,
    starters: listStarterLayouts(),
    recommendedStarter: starterKeyFor(industry),
  } }, 200, cors);
}

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// strip control chars except newline
function clean(s: string): string {
  let out = '';
  for (const ch of String(s)) { const c = ch.codePointAt(0)!; if (c === 10 || c >= 32) out += ch; }
  return out.trim();
}

type FieldRule = { max?: number; min?: number; required?: boolean; kind?: 'text' | 'bool' | 'int' | 'uuid' | 'date' | 'slug' | 'json' | 'tags' | 'stage_days' | 'google_tag' | 'meta_pixel' | 'ref' | 'post_status' | 'post_categories' | 'post_authors'; json?: JsonShape };
// Item 72: a JSON field's limits. Without them a 40 MB pages list was stored and then re-read
// on every load, preview, publish, hash and sweep. The size is the saved text's length; the
// shape checks only what every reader assumes (a list of objects, an object), never a
// section's contents, so an empty section the owner is still filling in saves as before.
type JsonShape = { bytes: number; shape: 'list' | 'object' | 'blocks' | 'pages'; items?: number };
const KB = 1024;
interface EntitySpec {
  table: string;
  entityType: string;           // provenance entity_type
  noun: string;                 // plain-language name for messages/summaries
  fields: Record<string, FieldRule>;
  select: string;
  order: string;
  softDelete: boolean;
  createDefaults?: Record<string, unknown>;
}

// The 0181 columns (builder list item 40). Before the apply pack a read that names them
// 400s, so the list is read again without them and posts keep working.
const POST_BLOG_COLS = ',category,author';
const POST_STATUSES = ['draft', 'scheduled', 'published'];

export const SPECS: Record<string, EntitySpec> = {
  offerings: {
    table: 'presence_offerings', entityType: 'offering', noun: 'offering',
    fields: {
      name: { max: 120, required: true }, category: { max: 60, required: true },
      description: { max: 500 }, price_text: { max: 40 },
      media_id: { kind: 'uuid' }, is_visible: { kind: 'bool' }, sort_order: { kind: 'int' },
    },
    select: 'id,name,category,description,price_text,media_id,is_visible,sort_order,updated_at',
    order: 'sort_order.asc,created_at.asc', softDelete: true,
  },
  testimonials: {
    table: 'presence_testimonials', entityType: 'testimonial', noun: 'testimonial',
    fields: {
      quote: { max: 600, required: true }, author: { max: 120, required: true },
      source: { max: 80 }, quote_date: { kind: 'date' },
      is_visible: { kind: 'bool' }, sort_order: { kind: 'int' },
    },
    select: 'id,quote,author,source,quote_date,is_visible,sort_order,updated_at',
    order: 'sort_order.asc,created_at.asc', softDelete: true,
  },
  faqs: {
    table: 'presence_faqs', entityType: 'faq', noun: 'FAQ',
    fields: {
      question: { max: 200, required: true }, answer: { max: 2000, required: true },
      is_visible: { kind: 'bool' }, sort_order: { kind: 'int' },
    },
    select: 'id,question,answer,is_visible,sort_order,updated_at',
    order: 'sort_order.asc,created_at.asc', softDelete: true,
  },
  posts: {
    table: 'presence_posts', entityType: 'post', noun: 'update',
    fields: {
      title: { max: 160, required: true }, slug: { kind: 'slug', max: 80 },
      body_md: { max: 20000 }, excerpt: { max: 300 },
      hero_media_id: { kind: 'uuid' }, status: { kind: 'post_status' }, published_at: { kind: 'date' },
      noindex: { kind: 'bool' },   // Phase SD: 'Show this update on Google?'
      tags: { kind: 'tags' },      // Phase SEARCH: flat, normalized update tags
      // Builder list item 40 (0181): a day and time to go live, and one category and author
      // by id from the site's lists (lib/blog.ts)
      category: { kind: 'ref' }, author: { kind: 'ref' },
    },
    select: 'id,title,slug,body_md,excerpt,hero_media_id,status,published_at,noindex,tags,updated_at' + POST_BLOG_COLS,
    order: 'updated_at.desc', softDelete: true,
  },
};

const LOCATION_FIELDS: Record<string, FieldRule> = {
  address_line1: { max: 160 }, address_line2: { max: 160 }, city: { max: 80 },
  region: { max: 40 }, postal_code: { max: 16 }, country: { max: 2 }, phone: { max: 32 },
  timezone: { max: 60 }, hours: { kind: 'json', json: { bytes: 32 * KB, shape: 'list', items: 14 } }, holiday_exceptions: { kind: 'json', json: { bytes: 64 * KB, shape: 'list', items: 400 } },
  temporarily_closed: { kind: 'bool' }, temporarily_closed_note: { max: 200 },
};
const SETTINGS_FIELDS: Record<string, FieldRule> = {
  category_order: { kind: 'json', json: { bytes: 64 * KB, shape: 'list', items: 200 } }, cover_media_id: { kind: 'uuid' },
  // Phase V no-code essentials: logo (FD-N2), share image (FD-N3), announcement bar (FD-N4)
  logo_media_id: { kind: 'uuid' }, og_media_id: { kind: 'uuid' },
  announcement_text: { max: 140 }, announcement_url: { max: 300 }, announcement_expires_at: { kind: 'date' },
  popup: { kind: 'json', json: { bytes: 8 * KB, shape: 'object' } },   // builder list item 148 (0161): made safe at publish (lib/popup.ts)
  industry_key: { max: 40 },   // Phase T3: drives template vocabulary + schema
  // Three switches, not a workflow builder (benchmark 2026-10, item 6) + the
  // per-stage stale threshold (item 13). Migration 0134; every switch default off.
  auto_ack_enquiries: { kind: 'bool' }, invoice_reminders: { kind: 'bool' }, invoice_remind_after_days: { kind: 'int', min: 1, max: 90 },
  deal_nudges: { kind: 'bool' }, deal_nudge_days: { kind: 'int', min: 1, max: 90 },
  review_requests: { kind: 'bool' }, review_request_after_days: { kind: 'int', min: 1, max: 90 },   // list item 29 (0137)
  // sales item 87 (0175): the recipes — the owner's own words, the two follow-ups, the second
  // overdue reminder and the week-before-it-runs-out note (lib/follow_ups.ts)
  auto_ack_message: { max: 1200 }, enquiry_followups: { kind: 'bool' },
  enquiry_followup_1_days: { kind: 'int', min: 1, max: 14 }, enquiry_followup_2_days: { kind: 'int', min: 3, max: 30 },
  enquiry_followup_1_message: { max: 1200 }, enquiry_followup_2_message: { max: 1200 },
  invoice_overdue_repeat: { kind: 'bool' }, quote_expiry_reminders: { kind: 'bool' },
  visit_counter: { kind: 'bool' },   // list item 61 (0139): the published site's visit counter, on unless switched off
  ai_crawlers: { kind: 'bool' },     // list item 175 (0159): let AI assistants read the published site, on unless switched off
  search_hidden: { kind: 'bool' }, llms_txt: { max: 4000 },   // list item 124 (0171): hide the site from search; the owner's llms.txt
  google_tag_id: { kind: 'google_tag' }, meta_pixel_id: { kind: 'meta_pixel' },   // list item 152 (0155): ad tags, behind a cookie notice; empty = none
  stage_stale_days: { kind: 'stage_days' },   // { lead?: 1–365, qualified?: …, proposal?: …, contract?: … } — a shaped map, not free json
  google_site_verification: { max: 100 }, bing_site_verification: { max: 100 },   // Phase Z: Search Console / Bing ownership
  // Phase CP-2 Design Studio: structured layout choices (never raw CSS)
  hero_layout: { max: 20 }, nav_style: { max: 12 },
  sections_hidden: { kind: 'json', json: { bytes: 16 * KB, shape: 'list', items: 200 } }, sections_order: { kind: 'json', json: { bytes: 16 * KB, shape: 'list', items: 200 } },
  footer_hours: { kind: 'bool' }, footer_social: { kind: 'bool' },
  // Phase SD: search visibility as human questions
  pages_noindex: { kind: 'json', json: { bytes: 16 * KB, shape: 'list', items: 200 } }, page_seo: { kind: 'json', json: { bytes: 256 * KB, shape: 'object' } },
  // Phase T-BLOCKS: structured content blocks (validated + capped at serialize time)
  blocks: { kind: 'json', json: { bytes: 1024 * KB, shape: 'blocks', items: 64 } },
  // Multi-page: owner-created pages [{slug,title,blocks}] (validated at serialize time)
  pages: { kind: 'json', json: { bytes: 2048 * KB, shape: 'pages', items: 40 } },
  // Editable GLOBAL nav [{label,href,children?}] (validated at serialize time)
  nav: { kind: 'json', json: { bytes: 64 * KB, shape: 'list', items: 60 } },
  // Builder list item 40 (0181): the blog's categories and authors, made safe as they're saved
  post_categories: { kind: 'post_categories', json: { bytes: 16 * KB, shape: 'list', items: 60 } },
  post_authors: { kind: 'post_authors', json: { bytes: 32 * KB, shape: 'list', items: 40 } },
};

/** Item 72: why a JSON value can't be saved, in a sentence, or null when it can. Pure. */
export function jsonFieldProblem(v: unknown, limit: JsonShape): string | null {
  if (v === null || v === undefined) return null;
  let text = '';
  try { text = JSON.stringify(v); } catch { return 'That couldn’t be read. Nothing was changed.'; }
  if (text.length > limit.bytes) return 'That’s more than one save can hold. Try removing a few sections or pages, then save again.';
  const isObj = (x: unknown) => !!x && typeof x === 'object' && !Array.isArray(x);
  if (limit.shape === 'object') return isObj(v) ? null : 'That couldn’t be read. Nothing was changed.';
  if (!Array.isArray(v)) return 'That couldn’t be read. Nothing was changed.';
  if (limit.items && v.length > limit.items) return `That’s more than ${limit.items} at once. Remove a few, then save again.`;
  if (limit.shape === 'blocks' && !v.every((b) => isObj(b) && typeof (b as { type?: unknown }).type === 'string')) return 'A section couldn’t be read. Nothing was changed.';
  const pageOk = (p: unknown) => { if (!isObj(p)) return false; const b = (p as { blocks?: unknown }).blocks; return b === undefined || (Array.isArray(b) && b.length <= 64); };
  if (limit.shape === 'pages' && !v.every(pageOk)) return 'A page couldn’t be read. Nothing was changed.';
  return null;
}

/** { stage: days } for the OPEN stages only, each a whole number 1–365; null when
 *  the value is not that shape (an array, a string, an unknown stage, 0, 400, 'soon'). */
export function stageDaysMap(v: unknown): Record<string, number> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out: Record<string, number> = {};
  for (const [stage, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!(OPEN_STAGES as string[]).includes(stage)) return null;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 365) return null;
    out[stage] = n;
  }
  return out;
}

function validateFields(payload: Record<string, unknown>, spec: Record<string, FieldRule>, requireRequired: boolean) {
  const errors: Array<{ field: string; message: string; plain?: boolean }> = [];
  const cleanBody: Record<string, unknown> = {};
  const fields: string[] = [];
  for (const key of Object.keys(payload || {})) {
    const rule = spec[key];
    if (!rule) continue; // closed set: unknown keys ignored
    const v = payload[key];
    if (rule.kind === 'bool') { cleanBody[key] = !!v; fields.push(key); continue; }
    if (rule.kind === 'int') { const n = Number(v); if (!Number.isFinite(n)) { errors.push({ field: key, message: `${key} must be a number.` }); continue; } const t = Math.trunc(n); if ((rule.min !== undefined && t < rule.min) || (rule.max !== undefined && t > rule.max)) { errors.push({ field: key, message: `${key} must be between ${rule.min ?? '…'} and ${rule.max ?? '…'}.` }); continue; } cleanBody[key] = t; fields.push(key); continue; }
    if (rule.kind === 'uuid') { if (v === null || v === '') { cleanBody[key] = null; fields.push(key); continue; } if (!UUID_RE.test(String(v))) { errors.push({ field: key, message: `${key} isn’t a valid reference.` }); continue; } cleanBody[key] = v; fields.push(key); continue; }
    if (rule.kind === 'json') {
      const problem = rule.json ? jsonFieldProblem(v, rule.json) : null;
      if (problem) { errors.push({ field: key, message: problem, plain: true }); continue; }
      cleanBody[key] = v ?? (key === 'hours' || key === 'holiday_exceptions' || key === 'category_order' ? [] : null); fields.push(key); continue;
    }
    if (rule.kind === 'stage_days') {   // the per-stage "stale after N days" map (lib/sales_lifecycle.ts staleDaysFor): open stages only, whole days 1–365
      if (v === null || v === undefined) { cleanBody[key] = null; fields.push(key); continue; }
      const shaped = stageDaysMap(v);
      if (!shaped) { errors.push({ field: key, message: `${key} must map a stage (${OPEN_STAGES.join(', ')}) to a number of days between 1 and 365.` }); continue; }
      cleanBody[key] = shaped; fields.push(key); continue;
    }
    if (rule.kind === 'tags') { cleanBody[key] = normalizeTags(v); fields.push(key); continue; }   // Phase SEARCH: the ONE tag gate — normalized to a clean text[]
    if (rule.kind === 'ref') {   // item 40: one of the site's categories or authors by id, or '' for none
      const s = clean(String(v ?? '')).toLowerCase();
      if (s && !(s.length <= 40 && SLUG_RE.test(s))) { errors.push({ field: key, message: 'That isn’t one of your choices.', plain: true }); continue; }
      cleanBody[key] = s; fields.push(key); continue;
    }
    if (rule.kind === 'post_status') {   // item 40: a draft, a post waiting for its time, or a published one
      const s = String(v ?? '');
      if (!POST_STATUSES.includes(s)) { errors.push({ field: key, message: 'A post is a draft, scheduled or published.', plain: true }); continue; }
      cleanBody[key] = s; fields.push(key); continue;
    }
    if (rule.kind === 'post_categories' || rule.kind === 'post_authors') {   // item 40: the blog's lists, made safe here so only clean values are stored
      const problem = rule.json ? jsonFieldProblem(v ?? [], rule.json) : null;
      if (problem) { errors.push({ field: key, message: problem, plain: true }); continue; }
      cleanBody[key] = rule.kind === 'post_categories' ? normalizeCategories(v) : normalizeAuthors(v); fields.push(key); continue;
    }
    if (rule.kind === 'google_tag' || rule.kind === 'meta_pixel') {   // list item 152: an ad tag's ID goes into a script on the live site, so only its exact shape passes
      const id = String(v ?? '').replace(/\s+/g, '').toUpperCase();
      if (id && !(rule.kind === 'google_tag' ? GOOGLE_TAG_RE : META_PIXEL_RE).test(id)) {
        errors.push({ field: key, plain: true, message: rule.kind === 'google_tag' ? 'A Google tag ID looks like G-XXXXXXXXXX or AW-XXXXXXXXX.' : 'A Meta Pixel ID is the 15 or 16 digits Meta Events Manager shows.' });
        continue;
      }
      cleanBody[key] = id; fields.push(key); continue;
    }
    if (rule.kind === 'date') { if (v === null || v === '') { cleanBody[key] = null; fields.push(key); continue; } cleanBody[key] = String(v); fields.push(key); continue; }
    if (rule.kind === 'slug') { const s = clean(String(v ?? '')).toLowerCase(); if (s && !SLUG_RE.test(s)) { errors.push({ field: key, message: 'Links use lowercase letters, numbers, and dashes.' }); continue; } cleanBody[key] = s; fields.push(key); continue; }
    const s = clean(String(v ?? ''));
    if (rule.max && s.length > rule.max) { errors.push({ field: key, message: `${key} is too long (max ${rule.max} characters).` }); continue; }
    cleanBody[key] = s; fields.push(key);
  }
  if (requireRequired) {
    for (const [key, rule] of Object.entries(spec)) {
      if (rule.required && !String(cleanBody[key] ?? '').trim()) errors.push({ field: key, message: `${key} is required.` });
    }
  }
  return { ok: errors.length === 0, errors, cleanBody, fields };
}

/** same-site media guard: a media reference must belong to this site */
async function mediaBelongs(siteId: string, mediaId: unknown): Promise<boolean> {
  if (!mediaId) return true;
  const r = await svc(`presence_media?id=eq.${mediaId}&site_id=eq.${siteId}&deleted_at=is.null&select=id&limit=1`);
  return Array.isArray(r.json) && r.json.length > 0;
}

const slugify = (s: string): string =>
  clean(s).toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'update';

// ═══ collections ═══
export async function handleCollection(req: Request, db: SiteDb, site: SiteRow, principal: Principal, entity: string, id: string | null, cors: Record<string, string>) {
  const spec = SPECS[entity];
  if (!spec) return null;
  const method = req.method.toUpperCase();

  // M9 optimistic lock: refuse a mutation whose If-Match no longer matches the
  // current draft (opt-in; no header → unchanged). These entities are all part
  // of the published snapshot, so the M3 draft hash is the right version token.
  if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
    const stale = await guardStaleDraft(req, site, cors);
    if (stale) return stale;
  }

  // Item 40: before APPLY-0181 a read or a write that names the blog's new columns 400s;
  // it's asked again without them, so posts keep working ahead of the pack.
  const stepDown = async (go: (select: string) => Promise<{ ok: boolean; status: number; json?: any; text?: string }>) => {
    const r = await go(spec.select);
    return (r.ok || r.status !== 400 || entity !== 'posts') ? r : go(spec.select.replace(POST_BLOG_COLS, ''));
  };

  if (method === 'GET' && !id) {
    const r = await stepDown((select) => db(`${spec.table}?site_id=eq.${site.id}&deleted_at=is.null&select=${select}&order=${spec.order}`));
    if (!r.ok) return json({ error: 'read_failed', message: `We couldn’t load your ${spec.noun}s just now.` }, 502, cors);
    return json({ data: r.json ?? [] }, 200, cors);
  }

  if (method === 'POST' && !id) {
    let payload: Record<string, unknown> = {};
    try { payload = await req.json(); } catch { return json({ error: 'bad_json', message: 'The request body wasn’t valid JSON.' }, 400, cors); }
    const v = validateFields(payload, spec.fields, true);
    if (!v.ok) return json({ error: 'validation_failed', message: v.errors.find((e) => e.plain)?.message || 'Some fields need a second look.', fields: v.errors }, 422, cors);
    if ('media_id' in v.cleanBody && !(await mediaBelongs(site.id, v.cleanBody.media_id))) return json({ error: 'bad_media', message: 'That photo isn’t in your library.' }, 422, cors);
    if ('hero_media_id' in v.cleanBody && !(await mediaBelongs(site.id, v.cleanBody.hero_media_id))) return json({ error: 'bad_media', message: 'That photo isn’t in your library.' }, 422, cors);
    if (entity === 'posts') {
      if (!v.cleanBody.slug) v.cleanBody.slug = slugify(String(v.cleanBody.title || ''));
      if (v.cleanBody.status === 'scheduled') {   // item 40: it goes out at its time, which must be ahead
        const problem = scheduleProblem(v.cleanBody.published_at, new Date().toISOString());
        if (problem) return json({ error: 'bad_time', message: problem, fields: [{ field: 'published_at', message: problem }] }, 422, cors);
      }
      if (v.cleanBody.status === 'published' && !v.cleanBody.published_at) v.cleanBody.published_at = new Date().toISOString();
    }
    const w = await stepDown((select) => db(`${spec.table}?select=${select}`, {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ site_id: site.id, ...v.cleanBody }),
    }));
    if (!w.ok || !w.json?.[0]) return json({ error: 'write_failed', message: 'That didn’t save — nothing was changed. Please try again.', detail: w.status === 409 ? 'That link is already used by another update.' : undefined }, w.status === 409 ? 409 : 502, cors);
    await writeChangeEvent({ siteId: site.id, entityType: spec.entityType, entityId: w.json[0].id, action: 'create', summary: `Added a ${spec.noun}`, principal, provenance: 'human', fields: v.fields });
    return json({ data: w.json[0] }, 201, cors);
  }

  if ((method === 'PUT' || method === 'PATCH') && id) {
    if (!UUID_RE.test(id)) return json({ error: 'bad_request', message: 'Invalid reference.' }, 400, cors);
    let payload: Record<string, unknown> = {};
    try { payload = await req.json(); } catch { return json({ error: 'bad_json', message: 'The request body wasn’t valid JSON.' }, 400, cors); }
    const v = validateFields(payload, spec.fields, false);
    if (!v.ok) return json({ error: 'validation_failed', message: v.errors.find((e) => e.plain)?.message || 'Some fields need a second look.', fields: v.errors }, 422, cors);
    if (v.fields.length === 0) return json({ error: 'empty_update', message: 'No editable fields were provided.' }, 400, cors);
    if ('media_id' in v.cleanBody && !(await mediaBelongs(site.id, v.cleanBody.media_id))) return json({ error: 'bad_media', message: 'That photo isn’t in your library.' }, 422, cors);
    if ('hero_media_id' in v.cleanBody && !(await mediaBelongs(site.id, v.cleanBody.hero_media_id))) return json({ error: 'bad_media', message: 'That photo isn’t in your library.' }, 422, cors);
    if (entity === 'posts' && v.cleanBody.status) {
      const cur = await svc(`presence_posts?id=eq.${id}&site_id=eq.${site.id}&select=status,published_at&limit=1`);
      const row = cur.json?.[0];
      if (v.cleanBody.status === 'published' && !row?.published_at && !v.cleanBody.published_at) { v.cleanBody.published_at = new Date().toISOString(); v.fields.push('published_at'); }
      if (v.cleanBody.status === 'scheduled') {   // item 40: the time it goes out, as sent or as kept, must be ahead
        const problem = scheduleProblem('published_at' in v.cleanBody ? v.cleanBody.published_at : row?.published_at, new Date().toISOString());
        if (problem) return json({ error: 'bad_time', message: problem, fields: [{ field: 'published_at', message: problem }] }, 422, cors);
      }
      // a scheduled post taken back to a draft forgets its time; a published one keeps its date
      if (v.cleanBody.status === 'draft' && row?.status === 'scheduled' && !('published_at' in v.cleanBody)) { v.cleanBody.published_at = null; v.fields.push('published_at'); }
    }
    const w = await stepDown((select) => db(`${spec.table}?id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=${select}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(v.cleanBody),
    }));
    if (!w.ok) return json({ error: 'write_failed', message: 'That didn’t save — nothing was changed. Please try again.' }, 502, cors);
    if (!w.json?.[0]) return json({ error: 'not_found', message: `We couldn’t find that ${spec.noun}.` }, 404, cors);
    const action = v.fields.length === 1 && v.fields[0] === 'is_visible' ? (v.cleanBody.is_visible ? 'show' : 'hide')
      : v.fields.length === 1 && v.fields[0] === 'sort_order' ? 'reorder' : 'update';
    await writeChangeEvent({ siteId: site.id, entityType: spec.entityType, entityId: id, action, summary: `Updated a ${spec.noun}`, principal, provenance: 'human', fields: v.fields });
    return json({ data: w.json[0] }, 200, cors);
  }

  if (method === 'DELETE' && id) {
    if (!UUID_RE.test(id)) return json({ error: 'bad_request', message: 'Invalid reference.' }, 400, cors);
    const w = await db(`${spec.table}?id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=id`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ deleted_at: new Date().toISOString(), is_visible: false }),
    });
    if (!w.ok) return json({ error: 'write_failed', message: 'That didn’t work — nothing was changed.' }, 502, cors);
    if (!w.json?.[0]) return json({ error: 'not_found', message: `We couldn’t find that ${spec.noun}.` }, 404, cors);
    await writeChangeEvent({ siteId: site.id, entityType: spec.entityType, entityId: id, action: 'delete', summary: `Removed a ${spec.noun}`, principal, provenance: 'human' });
    return json({ data: { ok: true } }, 200, cors);
  }

  return null;
}

// ═══ singletons ═══
async function singleton(req: Request, db: SiteDb, site: SiteRow, principal: Principal, cors: Record<string, string>, cfg: {
  table: string; entityType: string; noun: string; fields: Record<string, FieldRule>; select: string; conflict: string; summary: string;
}, preParsed?: Record<string, unknown>) {
  const method = req.method.toUpperCase();
  if (method === 'GET') {
    let r = await db(`${cfg.table}?site_id=eq.${site.id}&select=${cfg.select}&limit=1`);
    for (const select of selectSteps(cfg.select).slice(1)) {   // pre-0159, pre-0155, pre-0139, pre-0137, pre-0134
      if (r.ok || r.status !== 400) break;
      r = await db(`${cfg.table}?site_id=eq.${site.id}&select=${select}&limit=1`);
    }
    if (!r.ok) return json({ error: 'read_failed', message: `We couldn’t load your ${cfg.noun} just now.` }, 502, cors);
    return json({ data: r.json?.[0] ?? null }, 200, cors);
  }
  if (method === 'PUT') {
    // M9 optimistic lock (location + settings are part of the published snapshot)
    const stale = await guardStaleDraft(req, site, cors);
    if (stale) return stale;
    let payload: Record<string, unknown> = {};
    if (preParsed !== undefined) payload = preParsed;   // G7: handleSettings pre-reads the body (a Request body reads once)
    else { try { payload = await req.json(); } catch { return json({ error: 'bad_json', message: 'The request body wasn’t valid JSON.' }, 400, cors); } }
    const v = validateFields(payload, cfg.fields, false);
    if (!v.ok) return json({ error: 'validation_failed', message: v.errors.find((e) => e.plain)?.message || 'Some fields need a second look.', fields: v.errors }, 422, cors);
    if (v.fields.length === 0) return json({ error: 'empty_update', message: 'No editable fields were provided.' }, 400, cors);
    if ('cover_media_id' in v.cleanBody && !(await mediaBelongs(site.id, v.cleanBody.cover_media_id))) return json({ error: 'bad_media', message: 'That photo isn’t in your library.' }, 422, cors);
    // location upsert must include NOT NULL columns on first insert — merge over existing
    let body: Record<string, unknown> = { site_id: site.id, ...v.cleanBody };
    if (cfg.table === 'presence_locations') {
      const cur = await svc(`presence_locations?site_id=eq.${site.id}&limit=1`);
      const base = cur.json?.[0] || { address_line1: '', city: '', region: '', postal_code: '' };
      const { id: _i, created_at: _c, updated_at: _u, ...baseFields } = base;
      body = { ...baseFields, site_id: site.id, ...v.cleanBody };
    }
    const upsert = (select: string) => db(`${cfg.table}?on_conflict=${cfg.conflict}&select=${select}`, {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(body),
    });
    let w = await upsert(cfg.select);
    // Before an apply pack the answer can't name its columns. Any save that doesn't set them still lands.
    for (const select of selectSteps(cfg.select).slice(1)) {
      if (w.ok || w.status !== 400) break;
      w = await upsert(select);
    }
    if (!w.ok || !w.json?.[0]) return json({ error: 'write_failed', message: 'That didn’t save — nothing was changed. Please try again.' }, 502, cors);
    await writeChangeEvent({ siteId: site.id, entityType: cfg.entityType, entityId: null, action: 'update', summary: cfg.summary, principal, provenance: 'human', fields: v.fields });
    return json({ data: w.json[0] }, 200, cors);
  }
  return null;
}

export const handleLocation = (req: Request, db: SiteDb, site: SiteRow, principal: Principal, cors: Record<string, string>) =>
  singleton(req, db, site, principal, cors, {
    table: 'presence_locations', entityType: 'location', noun: 'address & hours', fields: LOCATION_FIELDS,
    select: 'id,address_line1,address_line2,city,region,postal_code,country,phone,timezone,hours,holiday_exceptions,temporarily_closed,temporarily_closed_note,updated_at',
    conflict: 'site_id', summary: 'Updated hours & location',
  });

// The 0134 columns (the three switches + the per-stage stale threshold). A
// database without them 400s the widened select; `singleton` retries the read
// without them, so Settings never goes dark ahead of the apply pack.
const AUTOMATION_SETTINGS_COLS = 'auto_ack_enquiries,invoice_reminders,invoice_remind_after_days,deal_nudges,deal_nudge_days,stage_stale_days';
// The 0137 columns (list item 29's switch). Their own step down, so a database with 0134
// and not 0137 still reads and saves the other three switches, and every other setting.
const REVIEW_SETTINGS_COLS = 'review_requests,review_request_after_days';
// The 0139 column (list item 61's switch).
const VISIT_SETTINGS_COLS = 'visit_counter';
// The 0155 columns (list item 152's ad tags).
const AD_SETTINGS_COLS = 'google_tag_id,meta_pixel_id';
// The 0159 column (list item 175's AI crawler switch).
const CRAWLER_SETTINGS_COLS = 'ai_crawlers';
// The 0161 column (builder list item 148's pop-up).
const POPUP_SETTINGS_COLS = 'popup';
// The 0171 columns (list item 124's Hide from search and llms.txt).
const SEARCH_SETTINGS_COLS = 'search_hidden,llms_txt';
// The 0175 columns (sales item 87's recipes).
const RECIPE_SETTINGS_COLS = 'auto_ack_message,enquiry_followups,enquiry_followup_1_days,enquiry_followup_2_days,enquiry_followup_1_message,enquiry_followup_2_message,invoice_overdue_repeat,quote_expiry_reminders';
// The 0181 columns (builder list item 40's categories and authors).
const BLOG_SETTINGS_COLS = 'post_categories,post_authors';
// Newest apply pack first. A database without a pack's columns 400s the widened select,
// so a read or a save steps down one pack at a time; Settings never goes dark ahead of one.
const OPTIONAL_SETTINGS_COLS = [BLOG_SETTINGS_COLS, RECIPE_SETTINGS_COLS, SEARCH_SETTINGS_COLS, POPUP_SETTINGS_COLS, CRAWLER_SETTINGS_COLS, AD_SETTINGS_COLS, VISIT_SETTINGS_COLS, REVIEW_SETTINGS_COLS, AUTOMATION_SETTINGS_COLS];
function selectSteps(select: string): string[] {
  const out = [select];
  let s = select;
  for (const cols of OPTIONAL_SETTINGS_COLS) {
    if (!s.includes(',' + cols)) continue;
    s = s.replace(',' + cols, '');
    out.push(s);
  }
  return out;
}
const SETTINGS_CFG = {
  table: 'presence_settings', entityType: 'settings', noun: 'site settings', fields: SETTINGS_FIELDS,
  select: 'site_id,category_order,cover_media_id,logo_media_id,og_media_id,announcement_text,announcement_url,announcement_expires_at,industry_key,google_site_verification,bing_site_verification,hero_layout,nav_style,sections_hidden,sections_order,footer_hours,footer_social,pages_noindex,page_seo,blocks,pages,nav,updated_at'
    + ',' + AUTOMATION_SETTINGS_COLS + ',' + REVIEW_SETTINGS_COLS + ',' + VISIT_SETTINGS_COLS + ',' + AD_SETTINGS_COLS + ',' + CRAWLER_SETTINGS_COLS + ',' + POPUP_SETTINGS_COLS + ',' + SEARCH_SETTINGS_COLS + ',' + RECIPE_SETTINGS_COLS + ',' + BLOG_SETTINGS_COLS,
  conflict: 'site_id', summary: 'Updated site settings',
} as const;

// Wave-1 G7 (SC-7): a page-slug RENAME automatically forwards the old address —
// through the EXISTING redirects manager (presence_redirects; same rows the
// snapshot has always shipped). The client marks a rename with `prev_slug` on the
// page it renamed; the marker is stripped before the draft is stored. Best-effort
// AFTER a successful save (a redirect hiccup never fails the rename), provenance-
// logged, and skipped when the old address was never on the live site (nothing to
// forward). Existing forwards that pointed AT the old address follow the page, so
// a rename never leaves a redirect chain behind.
async function redirectsForRenames(site: SiteRow, principal: Principal, renames: PageRename[]): Promise<void> {
  try {
    const pub = await svc(`presence_publishes?site_id=eq.${site.id}&status=eq.live&select=snapshot_id&order=created_at.desc&limit=1`);
    const snapId = pub.json?.[0]?.snapshot_id;
    let liveSlugs: Set<string> | null = null;   // null = never published → skip every forward
    if (snapId) {
      const s = await svc(`presence_snapshots?id=eq.${snapId}&site_id=eq.${site.id}&select=content&limit=1`);
      const live = s.json?.[0]?.content;
      const livePages = live?.settings?.pages, liveForwards = live?.redirects;
      liveSlugs = new Set(Array.isArray(livePages) ? livePages.map((p: { slug?: unknown }) => String(p?.slug ?? '')) : []);
      // a live forward answers at its old address too, so it counts as being on the live site
      if (Array.isArray(liveForwards)) for (const f of liveForwards) liveSlugs.add(String(f?.from_path ?? '').replace(/^\/|\/$/g, ''));
    }
    for (const rn of renames.slice(0, 5)) {
      const from = `/${rn.from}/`, to = `/${rn.to}/`;
      // A rename taken back left a forward away from this address, which is the page's
      // again. Publishing would write it over the page, and the next line would point it at itself.
      await svc(`presence_redirects?site_id=eq.${site.id}&from_path=eq.${encodeURIComponent(to)}&to_path=eq.${encodeURIComponent(from)}`, { method: 'DELETE' });
      // reference adjust: forwards that landed on the old address follow the page (no chains)
      await svc(`presence_redirects?site_id=eq.${site.id}&to_path=eq.${encodeURIComponent(from)}`, { method: 'PATCH', body: JSON.stringify({ to_path: to }) });
      if (!liveSlugs || !liveSlugs.has(rn.from)) continue;   // never live under the old address → no forward needed
      const existing = await svc(`presence_redirects?site_id=eq.${site.id}&from_path=eq.${encodeURIComponent(from)}&select=id&limit=1`);
      if (Array.isArray(existing.json) && existing.json.length) continue;   // the owner already forwards it
      const cnt = await svc(`presence_redirects?site_id=eq.${site.id}&select=id&limit=51`);
      if ((cnt.json ?? []).length >= 50) continue;   // the manager's cap — never blow past it silently
      const w = await svc('presence_redirects', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ site_id: site.id, from_path: from, to_path: to }),
      });
      if (w.ok) await writeChangeEvent({ siteId: site.id, entityType: 'settings', entityId: null, action: 'update', summary: `Changed a page address ${from} → ${to} and added a forward so old links keep working`, principal, provenance: 'human', fields: ['pages', 'redirect'] });
    }
  } catch { /* best-effort — the rename itself already succeeded */ }
}

// ── G13 · the editor-facing sidecar (design doc §1.4) ────────────────────────
// GET and PUT /settings responses are decorated with `data.section_meta` — the
// {sid, key, src_index} map from validateBlocksWithMap over the just-read /
// just-written row (home blocks + each custom page), with validateBlocks' drop
// rules applied by the SERVER — never imitated client-side. CONTRACT: this is
// STORED-LIST meta (per-block labels/sids/keys for the panel + badges). It is
// deliberately validate-only — it lacks the render's resolve context (library
// payloads, media refs, approved reviews), so its sids can diverge from the
// canvas stamps on a page where a resolve step changed the list. Canvas INDEX
// joins therefore read the DOM's `data-dds-src` stamps (the render's own
// provenance); the sid→src_index join here is only the degrade fallback for a
// render without src stamps. Recomputed per response, never stored: the row,
// the snapshots, and the draft hash are untouched.
function settingsSectionMeta(row: Record<string, unknown>): { blocks: SectionMapEntry[]; pages: Record<string, SectionMapEntry[]> } {
  const pages: Record<string, SectionMapEntry[]> = {};
  for (const p of (Array.isArray(row.pages) ? row.pages : [])) {
    const slug = String((p as { slug?: unknown } | null)?.slug ?? '');
    if (slug) pages[slug] = validateBlocksWithMap((p as { blocks?: unknown }).blocks).map;
  }
  return { blocks: validateBlocksWithMap(row.blocks).map, pages };
}
async function withSectionMeta(resp: Response | null, cors: Record<string, string>): Promise<Response | null> {
  if (!resp || resp.status !== 200) return resp;
  try {
    const body = await resp.clone().json();
    if (!body || typeof body !== 'object' || !body.data || typeof body.data !== 'object') return resp;
    body.data.section_meta = settingsSectionMeta(body.data as Record<string, unknown>);
    return json(body, 200, cors);
  } catch { return resp; }   // decoration is additive — never break the save/read itself
}

export async function handleSettings(req: Request, db: SiteDb, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  if (req.method.toUpperCase() !== 'PUT') return withSectionMeta(await singleton(req, db, site, principal, cors, SETTINGS_CFG), cors);
  let payload: Record<string, unknown> = {};
  try { payload = await req.json(); } catch { return json({ error: 'bad_json', message: 'The request body wasn’t valid JSON.' }, 400, cors); }
  // G7: pull rename markers out of a pages payload (the stored draft never carries them)
  let renames: PageRename[] = [];
  if (payload && Array.isArray(payload.pages)) {
    const d = detectPageRenames(payload.pages);
    payload.pages = d.pages; renames = d.renames;
  }
  // Item 155: a section the studio locked stays as it is for the client, however the save
  // comes (lib/section_lock.ts); the studio itself and platform staff are never stopped.
  if (publishActorKind(principal) === 'client' && payload && (Array.isArray(payload.blocks) || Array.isArray(payload.pages))) {
    const cur = await db(`presence_settings?site_id=eq.${site.id}&select=blocks,pages&limit=1`);
    if (!cur.ok) return json({ error: 'read_failed', message: 'We couldn’t check your sections just now. Nothing was changed.' }, 502, cors);
    const edits = lockedEdits(cur.json?.[0] ?? {}, payload, Object.fromEntries(renames.map((r) => [r.from, r.to])));
    if (edits.length) return json({ error: 'section_locked', message: lockedMessage(edits), sections: edits }, 403, cors);
  }
  const resp = await singleton(req, db, site, principal, cors, SETTINGS_CFG, payload);
  if (resp && resp.status === 200 && renames.length) await redirectsForRenames(site, principal, renames);
  return withSectionMeta(resp, cors);
}

// ═══ Wave-1 G7 · page operations ═══

/** POST /pages/duplicate { slug } — duplicate one page ('' = the Home canvas)
 *  into a new custom page: deep-copied block list with REGENERATED stable ids,
 *  title "<Title> copy", slug "<slug>-copy" collision-bumped. One settings.pages
 *  write through siteDb (same proof as any /settings save), one provenance event —
 *  the same shape every pages edit already takes. */
export async function handlePageDuplicate(req: Request, db: SiteDb, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const stale = await guardStaleDraft(req, site, cors);
  if (stale) return stale;
  let payload: Record<string, unknown> = {};
  try { payload = await req.json(); } catch { /* {} → duplicate Home */ }
  const slug = String(payload?.slug ?? '');
  if (slug && !PAGE_SLUG_RE.test(slug)) return json({ error: 'bad_request', message: 'Which page should be duplicated?' }, 400, cors);
  const cur = await db(`presence_settings?site_id=eq.${site.id}&select=blocks,pages&limit=1`);
  if (!cur.ok) return json({ error: 'read_failed', message: 'We couldn’t load your pages just now.' }, 502, cors);
  const row = cur.json?.[0] ?? {};
  const dup = duplicatePageInSettings({ blocks: row.blocks, pages: row.pages }, slug);
  if ('error' in dup) return json({ error: dup.error, message: dup.message }, dup.error === 'not_found' ? 404 : 422, cors);
  const w = await db(`presence_settings?on_conflict=site_id&select=site_id,pages`, {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ site_id: site.id, pages: dup.pages }),
  });
  if (!w.ok || !w.json?.[0]) return json({ error: 'write_failed', message: 'That didn’t save — nothing was changed. Please try again.' }, 502, cors);
  await writeChangeEvent({ siteId: site.id, entityType: 'settings', entityId: null, action: 'create', summary: `Duplicated the “${dup.sourceTitle}” page as “${dup.title}”`, principal, provenance: 'human', fields: ['pages'] });
  return json({ data: { slug: dup.slug, title: dup.title, pages: w.json[0].pages ?? dup.pages } }, 201, cors);
}

/** GET /pages/refs?slug=x — delete-awareness: what points AT this page (menu
 *  items, forwards, other pages' sections, saved library sections). One pass
 *  over three small site-scoped reads; the logic is pure (lib/page_ops.ts). */
export async function handlePageRefs(req: Request, site: SiteRow, cors: Record<string, string>) {
  const slug = String(new URL(req.url).searchParams.get('slug') || '');
  if (!PAGE_SLUG_RE.test(slug)) return json({ error: 'bad_request', message: 'Which page?' }, 400, cors);
  const [setQ, redirQ, libQ] = await Promise.all([
    svc(`presence_settings?site_id=eq.${site.id}&select=blocks,pages,nav&limit=1`),
    svc(`presence_redirects?site_id=eq.${site.id}&select=from_path,to_path&limit=50`),
    svc(`presence_content_library?site_id=eq.${site.id}&select=name,payload&limit=100`),
  ]);
  const refs = pageRefs(slug, setQ.json?.[0] ?? {}, Array.isArray(redirQ.json) ? redirQ.json : [], Array.isArray(libQ.json) ? libQ.json : []);
  return json({ data: refs }, 200, cors);
}
