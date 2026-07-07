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
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// strip control chars except newline
function clean(s: string): string {
  let out = '';
  for (const ch of String(s)) { const c = ch.codePointAt(0)!; if (c === 10 || c >= 32) out += ch; }
  return out.trim();
}

type FieldRule = { max?: number; required?: boolean; kind?: 'text' | 'bool' | 'int' | 'uuid' | 'date' | 'slug' | 'json' };
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
    table: 'presence_offerings', entityType: 'offering', noun: 'menu item',
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
    },
    select: 'id,title,slug,body_md,excerpt,hero_media_id,status,published_at,updated_at',
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
}) {
  const method = req.method.toUpperCase();
  if (method === 'GET') {
    const r = await asUser(jwt, `${cfg.table}?site_id=eq.${site.id}&select=${cfg.select}&limit=1`);
    if (!r.ok) return json({ error: 'read_failed', message: `We couldn’t load your ${cfg.noun} just now.` }, 502, cors);
    return json({ data: r.json?.[0] ?? null }, 200, cors);
  }
  if (method === 'PUT') {
    let payload: Record<string, unknown> = {};
    try { payload = await req.json(); } catch { return json({ error: 'bad_json', message: 'The request body wasn’t valid JSON.' }, 400, cors); }
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

export const handleSettings = (req: Request, jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) =>
  singleton(req, jwt, site, principal, cors, {
    table: 'presence_settings', entityType: 'settings', noun: 'site settings', fields: SETTINGS_FIELDS,
    select: 'site_id,category_order,cover_media_id,updated_at',
    conflict: 'site_id', summary: 'Updated site settings',
  });
