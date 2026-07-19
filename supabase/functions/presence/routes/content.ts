// ── Section content CRUD (M7) — additive routes for the Client Room ─────────
// One declarative spec per entity; every write goes through the caller's JWT
// (RLS proves ownership), validates a closed field set, and records exactly
// one provenance event with field NAMES only. Deletes are soft; visibility is
// a toggle ("on the menu", never "gone").
//
//   GET    /offerings|testimonials|faqs|posts        — list (draft view)
//   POST   /offerings|...                            — create
//   PUT    /offerings/{id}|...                       — update fields
//   DELETE /offerings/{id}|...                       — soft delete
//   GET|PUT /location                                — the v1 singleton
//   GET|PUT /voice                                   — never rendered
//   GET|PUT /settings                                — section order, cover
import { json } from '../../_shared/http.ts';
import { asUser, svc } from '../lib/db.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import { guardStaleDraft } from '../lib/optimistic_lock.ts';
import { suggestedBlocksFor, suggestionNoteFor } from '../lib/vertical_presets.ts';
import { REALIZED_BLOCK_TYPES, validateBlocksWithMap, type SectionMapEntry } from '../lib/site_blocks.ts';
import { componentsForIndustry } from '../lib/site_components.ts';
import { listStarterLayouts, starterKeyFor } from '../lib/starter_layouts.ts';
import { normalizeTags } from '../lib/search_index.ts';
import { detectPageRenames, duplicatePageInSettings, pageRefs, PAGE_SLUG_RE, type PageRename } from '../lib/page_ops.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// strip control chars except newline
function clean(s: string): string {
  let out = '';
  for (const ch of String(s)) { const c = ch.codePointAt(0)!; if (c === 10 || c >= 32) out += ch; }
  return out.trim();
}

type FieldRule = { max?: number; required?: boolean; kind?: 'text' | 'bool' | 'int' | 'uuid' | 'date' | 'slug' | 'json' | 'tags' };
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
      hero_media_id: { kind: 'uuid' }, status: { max: 12 }, published_at: { kind: 'date' },
      noindex: { kind: 'bool' },   // Phase SD: 'Show this update on Google?'
      tags: { kind: 'tags' },      // Phase SEARCH: flat, normalized update tags
    },
    select: 'id,title,slug,body_md,excerpt,hero_media_id,status,published_at,noindex,tags,updated_at',
    order: 'updated_at.desc', softDelete: true,
  },
};

const LOCATION_FIELDS: Record<string, FieldRule> = {
  address_line1: { max: 160 }, address_line2: { max: 160 }, city: { max: 80 },
  region: { max: 40 }, postal_code: { max: 16 }, country: { max: 2 }, phone: { max: 32 },
  timezone: { max: 60 }, hours: { kind: 'json' }, holiday_exceptions: { kind: 'json' },
  temporarily_closed: { kind: 'bool' }, temporarily_closed_note: { max: 200 },
};
const VOICE_FIELDS: Record<string, FieldRule> = {
  tone_notes: { max: 1000 }, preferred_vocabulary: { max: 1000 }, never_claim: { max: 1000 },
};
const SETTINGS_FIELDS: Record<string, FieldRule> = {
  category_order: { kind: 'json' }, cover_media_id: { kind: 'uuid' },
  // Phase V no-code essentials: logo (FD-N2), share image (FD-N3), announcement bar (FD-N4)
  logo_media_id: { kind: 'uuid' }, og_media_id: { kind: 'uuid' },
  announcement_text: { max: 140 }, announcement_url: { max: 300 }, announcement_expires_at: { kind: 'date' },
  industry_key: { max: 40 },   // Phase T3: drives template vocabulary + schema
  google_site_verification: { max: 100 }, bing_site_verification: { max: 100 },   // Phase Z: Search Console / Bing ownership
  // Phase CP-2 Design Studio: structured layout choices (never raw CSS)
  hero_layout: { max: 20 }, nav_style: { max: 12 },
  sections_hidden: { kind: 'json' }, sections_order: { kind: 'json' },
  footer_hours: { kind: 'bool' }, footer_social: { kind: 'bool' },
  // Phase SD: search visibility as human questions
  pages_noindex: { kind: 'json' }, page_seo: { kind: 'json' },
  // Phase T-BLOCKS: structured content blocks (validated + capped at serialize time)
  blocks: { kind: 'json' },
  // Multi-page: owner-created pages [{slug,title,blocks}] (validated at serialize time)
  pages: { kind: 'json' },
  // Editable GLOBAL nav [{label,href,children?}] (validated at serialize time)
  nav: { kind: 'json' },
};

function validateFields(payload: Record<string, unknown>, spec: Record<string, FieldRule>, requireRequired: boolean) {
  const errors: Array<{ field: string; message: string }> = [];
  const cleanBody: Record<string, unknown> = {};
  const fields: string[] = [];
  for (const key of Object.keys(payload || {})) {
    const rule = spec[key];
    if (!rule) continue; // closed set: unknown keys ignored
    const v = payload[key];
    if (rule.kind === 'bool') { cleanBody[key] = !!v; fields.push(key); continue; }
    if (rule.kind === 'int') { const n = Number(v); if (!Number.isFinite(n)) { errors.push({ field: key, message: `${key} must be a number.` }); continue; } cleanBody[key] = Math.trunc(n); fields.push(key); continue; }
    if (rule.kind === 'uuid') { if (v === null || v === '') { cleanBody[key] = null; fields.push(key); continue; } if (!UUID_RE.test(String(v))) { errors.push({ field: key, message: `${key} isn’t a valid reference.` }); continue; } cleanBody[key] = v; fields.push(key); continue; }
    if (rule.kind === 'json') { cleanBody[key] = v ?? (key === 'hours' || key === 'holiday_exceptions' || key === 'category_order' ? [] : null); fields.push(key); continue; }
    if (rule.kind === 'tags') { cleanBody[key] = normalizeTags(v); fields.push(key); continue; }   // Phase SEARCH: the ONE tag gate — normalized to a clean text[]
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
export async function handleCollection(req: Request, jwt: string, site: SiteRow, principal: Principal, entity: string, id: string | null, cors: Record<string, string>) {
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

  if (method === 'GET' && !id) {
    const r = await asUser(jwt, `${spec.table}?site_id=eq.${site.id}&deleted_at=is.null&select=${spec.select}&order=${spec.order}`);
    if (!r.ok) return json({ error: 'read_failed', message: `We couldn’t load your ${spec.noun}s just now.` }, 502, cors);
    return json({ data: r.json ?? [] }, 200, cors);
  }

  if (method === 'POST' && !id) {
    let payload: Record<string, unknown> = {};
    try { payload = await req.json(); } catch { return json({ error: 'bad_json', message: 'The request body wasn’t valid JSON.' }, 400, cors); }
    const v = validateFields(payload, spec.fields, true);
    if (!v.ok) return json({ error: 'validation_failed', message: 'Some fields need a second look.', fields: v.errors }, 422, cors);
    if ('media_id' in v.cleanBody && !(await mediaBelongs(site.id, v.cleanBody.media_id))) return json({ error: 'bad_media', message: 'That photo isn’t in your library.' }, 422, cors);
    if ('hero_media_id' in v.cleanBody && !(await mediaBelongs(site.id, v.cleanBody.hero_media_id))) return json({ error: 'bad_media', message: 'That photo isn’t in your library.' }, 422, cors);
    if (entity === 'posts') {
      if (!v.cleanBody.slug) v.cleanBody.slug = slugify(String(v.cleanBody.title || ''));
      if (v.cleanBody.status && !['draft', 'published'].includes(String(v.cleanBody.status))) v.cleanBody.status = 'draft';
      if (v.cleanBody.status === 'published' && !v.cleanBody.published_at) v.cleanBody.published_at = new Date().toISOString();
    }
    const w = await asUser(jwt, `${spec.table}?select=${spec.select}`, {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ site_id: site.id, ...v.cleanBody }),
    });
    if (!w.ok || !w.json?.[0]) return json({ error: 'write_failed', message: 'That didn’t save — nothing was changed. Please try again.', detail: w.status === 409 ? 'That link is already used by another update.' : undefined }, w.status === 409 ? 409 : 502, cors);
    await writeChangeEvent({ siteId: site.id, entityType: spec.entityType, entityId: w.json[0].id, action: 'create', summary: `Added a ${spec.noun}`, principal, provenance: 'human', fields: v.fields });
    return json({ data: w.json[0] }, 201, cors);
  }

  if ((method === 'PUT' || method === 'PATCH') && id) {
    if (!UUID_RE.test(id)) return json({ error: 'bad_request', message: 'Invalid reference.' }, 400, cors);
    let payload: Record<string, unknown> = {};
    try { payload = await req.json(); } catch { return json({ error: 'bad_json', message: 'The request body wasn’t valid JSON.' }, 400, cors); }
    const v = validateFields(payload, spec.fields, false);
    if (!v.ok) return json({ error: 'validation_failed', message: 'Some fields need a second look.', fields: v.errors }, 422, cors);
    if (v.fields.length === 0) return json({ error: 'empty_update', message: 'No editable fields were provided.' }, 400, cors);
    if ('media_id' in v.cleanBody && !(await mediaBelongs(site.id, v.cleanBody.media_id))) return json({ error: 'bad_media', message: 'That photo isn’t in your library.' }, 422, cors);
    if ('hero_media_id' in v.cleanBody && !(await mediaBelongs(site.id, v.cleanBody.hero_media_id))) return json({ error: 'bad_media', message: 'That photo isn’t in your library.' }, 422, cors);
    if (entity === 'posts' && v.cleanBody.status === 'published') {
      const cur = await svc(`presence_posts?id=eq.${id}&site_id=eq.${site.id}&select=published_at&limit=1`);
      if (!cur.json?.[0]?.published_at && !v.cleanBody.published_at) { v.cleanBody.published_at = new Date().toISOString(); v.fields.push('published_at'); }
    }
    const w = await asUser(jwt, `${spec.table}?id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=${spec.select}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(v.cleanBody),
    });
    if (!w.ok) return json({ error: 'write_failed', message: 'That didn’t save — nothing was changed. Please try again.' }, 502, cors);
    if (!w.json?.[0]) return json({ error: 'not_found', message: `We couldn’t find that ${spec.noun}.` }, 404, cors);
    const action = v.fields.length === 1 && v.fields[0] === 'is_visible' ? (v.cleanBody.is_visible ? 'show' : 'hide')
      : v.fields.length === 1 && v.fields[0] === 'sort_order' ? 'reorder' : 'update';
    await writeChangeEvent({ siteId: site.id, entityType: spec.entityType, entityId: id, action, summary: `Updated a ${spec.noun}`, principal, provenance: 'human', fields: v.fields });
    return json({ data: w.json[0] }, 200, cors);
  }

  if (method === 'DELETE' && id) {
    if (!UUID_RE.test(id)) return json({ error: 'bad_request', message: 'Invalid reference.' }, 400, cors);
    const w = await asUser(jwt, `${spec.table}?id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=id`, {
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
async function singleton(req: Request, jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>, cfg: {
  table: string; entityType: string; noun: string; fields: Record<string, FieldRule>; select: string; conflict: string; summary: string;
}, preParsed?: Record<string, unknown>) {
  const method = req.method.toUpperCase();
  if (method === 'GET') {
    const r = await asUser(jwt, `${cfg.table}?site_id=eq.${site.id}&select=${cfg.select}&limit=1`);
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
    if (!v.ok) return json({ error: 'validation_failed', message: 'Some fields need a second look.', fields: v.errors }, 422, cors);
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
    const w = await asUser(jwt, `${cfg.table}?on_conflict=${cfg.conflict}&select=${cfg.select}`, {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(body),
    });
    if (!w.ok || !w.json?.[0]) return json({ error: 'write_failed', message: 'That didn’t save — nothing was changed. Please try again.' }, 502, cors);
    await writeChangeEvent({ siteId: site.id, entityType: cfg.entityType, entityId: null, action: 'update', summary: cfg.summary, principal, provenance: 'human', fields: v.fields });
    return json({ data: w.json[0] }, 200, cors);
  }
  return null;
}

export const handleLocation = (req: Request, jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) =>
  singleton(req, jwt, site, principal, cors, {
    table: 'presence_locations', entityType: 'location', noun: 'address & hours', fields: LOCATION_FIELDS,
    select: 'id,address_line1,address_line2,city,region,postal_code,country,phone,timezone,hours,holiday_exceptions,temporarily_closed,temporarily_closed_note,updated_at',
    conflict: 'site_id', summary: 'Updated hours & location',
  });

// M9.5G: /voice keeps its route and shape, but the Brand Profile is now the
// ONE canonical voice source — this handler maps tone_notes ↔
// voice_characteristics and never_claim ↔ never_claims. presence_voice is
// retired: nothing reads or writes it.
export async function handleVoice(req: Request, jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const method = req.method.toUpperCase();
  const SELECT = 'site_id,voice_characteristics,preferred_vocabulary,never_claims,updated_at';
  const shape = (row: Record<string, unknown> | null) => row ? {
    site_id: row.site_id, tone_notes: row.voice_characteristics || '',
    preferred_vocabulary: row.preferred_vocabulary || '', never_claim: row.never_claims || '',
    updated_at: row.updated_at,
  } : null;
  if (method === 'GET') {
    const r = await asUser(jwt, `presence_brand_profile?site_id=eq.${site.id}&select=${SELECT}&limit=1`);
    if (!r.ok) return json({ error: 'read_failed', message: 'We couldn’t open your voice profile just now.' }, 502, cors);
    return json({ data: shape(r.json?.[0] ?? null) }, 200, cors);
  }
  if (method === 'PUT') {
    let payload: Record<string, unknown> = {};
    try { payload = await req.json(); } catch { return json({ error: 'bad_json', message: 'That didn’t read right — nothing changed.' }, 400, cors); }
    const v = validateFields(payload, VOICE_FIELDS, false);
    if (v.errors.length) return json({ error: 'validation', details: v.errors }, 400, cors);
    if (!v.fields.length) return json({ error: 'empty_update', message: 'No editable fields were provided.' }, 400, cors);
    const body: Record<string, unknown> = { site_id: site.id };
    if ('tone_notes' in v.cleanBody) body.voice_characteristics = v.cleanBody.tone_notes;
    if ('preferred_vocabulary' in v.cleanBody) body.preferred_vocabulary = v.cleanBody.preferred_vocabulary;
    if ('never_claim' in v.cleanBody) body.never_claims = v.cleanBody.never_claim;
    const w = await asUser(jwt, `presence_brand_profile?on_conflict=site_id&select=${SELECT}`, {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(body),
    });
    if (!w.ok || !w.json?.[0]) return json({ error: 'write_failed', message: 'That didn’t save — nothing was changed. Please try again.' }, 502, cors);
    await writeChangeEvent({ siteId: site.id, entityType: 'voice', entityId: null, action: 'update', summary: 'Updated voice profile', principal, provenance: 'human', fields: v.fields });
    return json({ data: shape(w.json[0]) }, 200, cors);
  }
  return null;
}

const SETTINGS_CFG = {
  table: 'presence_settings', entityType: 'settings', noun: 'site settings', fields: SETTINGS_FIELDS,
  select: 'site_id,category_order,cover_media_id,logo_media_id,og_media_id,announcement_text,announcement_url,announcement_expires_at,industry_key,google_site_verification,bing_site_verification,hero_layout,nav_style,sections_hidden,sections_order,footer_hours,footer_social,pages_noindex,page_seo,blocks,pages,nav,updated_at',
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
      const livePages = s.json?.[0]?.content?.settings?.pages;
      liveSlugs = new Set(Array.isArray(livePages) ? livePages.map((p: { slug?: unknown }) => String(p?.slug ?? '')) : []);
    }
    for (const rn of renames.slice(0, 5)) {
      const from = `/${rn.from}/`, to = `/${rn.to}/`;
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
// just-written row (home blocks + each custom page). This is the exact join
// between a stamped `data-dds-sid` on the canvas and an index into the client's
// working copy, with validateBlocks' drop rules applied by the SERVER — never
// imitated client-side. Recomputed per response, never stored: the row, the
// snapshots, and the draft hash are untouched.
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

export async function handleSettings(req: Request, jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  if (req.method.toUpperCase() !== 'PUT') return withSectionMeta(await singleton(req, jwt, site, principal, cors, SETTINGS_CFG), cors);
  let payload: Record<string, unknown> = {};
  try { payload = await req.json(); } catch { return json({ error: 'bad_json', message: 'The request body wasn’t valid JSON.' }, 400, cors); }
  // G7: pull rename markers out of a pages payload (the stored draft never carries them)
  let renames: PageRename[] = [];
  if (payload && Array.isArray(payload.pages)) {
    const d = detectPageRenames(payload.pages);
    payload.pages = d.pages; renames = d.renames;
  }
  const resp = await singleton(req, jwt, site, principal, cors, SETTINGS_CFG, payload);
  if (resp && resp.status === 200 && renames.length) await redirectsForRenames(site, principal, renames);
  return withSectionMeta(resp, cors);
}

// ═══ Wave-1 G7 · page operations ═══

/** POST /pages/duplicate { slug } — duplicate one page ('' = the Home canvas)
 *  into a new custom page: deep-copied block list with REGENERATED stable ids,
 *  title "<Title> copy", slug "<slug>-copy" collision-bumped. One settings.pages
 *  write through the caller's JWT (RLS proves ownership), one provenance event —
 *  the same shape every pages edit already takes. */
export async function handlePageDuplicate(req: Request, jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const stale = await guardStaleDraft(req, site, cors);
  if (stale) return stale;
  let payload: Record<string, unknown> = {};
  try { payload = await req.json(); } catch { /* {} → duplicate Home */ }
  const slug = String(payload?.slug ?? '');
  if (slug && !PAGE_SLUG_RE.test(slug)) return json({ error: 'bad_request', message: 'Which page should be duplicated?' }, 400, cors);
  const cur = await asUser(jwt, `presence_settings?site_id=eq.${site.id}&select=blocks,pages&limit=1`);
  if (!cur.ok) return json({ error: 'read_failed', message: 'We couldn’t load your pages just now.' }, 502, cors);
  const row = cur.json?.[0] ?? {};
  const dup = duplicatePageInSettings({ blocks: row.blocks, pages: row.pages }, slug);
  if ('error' in dup) return json({ error: dup.error, message: dup.message }, dup.error === 'not_found' ? 404 : 422, cors);
  const w = await asUser(jwt, `presence_settings?on_conflict=site_id&select=site_id,pages`, {
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
