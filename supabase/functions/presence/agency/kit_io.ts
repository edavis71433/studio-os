// ── Starter kits: the reads and writes (Phase CP-1) ──────────────────────────
// lib/kits.ts decides what a kit carries and what applying it may touch (pure,
// test-locked). These do the I/O, for the kit routes in routes.ts and for
// Duplicate site (agency/sites.ts), so a kit is made and applied one way only.
// Item 145: a site's pages and sections travel too (layoutFromSite and
// applyLayoutTo; lib/site_layout.ts says what they carry). Callers fence both
// sites to the agency first.
import { svc } from '../lib/db.ts';
import { buildKitPayload, applyPlan } from '../lib/kits.ts';
import type { KitPayload } from '../lib/kits.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import type { Principal } from '../../_shared/auth.ts';
import { copyObject } from '../lib/media.ts';
import { serializeDraft } from '../lib/serializer.ts';
import { getTemplate, latestTemplateVersion } from '../lib/render.ts';
import { LAYOUT_COLUMNS, MAX_LAYOUT_MEDIA, menuForCopy, swapIds, swapName, layoutMediaIds, layoutLinkedIds, layoutCounts } from '../lib/site_layout.ts';
import type { SiteLayout, LayoutMedia, LayoutLibraryItem, LayoutColumn } from '../lib/site_layout.ts';
import { recordCopied } from '../lib/copied_record.ts';

const rows = <T,>(r: { ok?: boolean; json?: unknown }): T[] => (r.ok !== false && Array.isArray(r.json) ? r.json as T[] : []);
const UUIDISH = /^[0-9a-f-]{36}$/i;
/** id=in.(…) reads, a batch at a time (a long list would outgrow the address) */
export async function readByIds<T>(table: string, siteId: string, ids: string[], select: string, extra = ''): Promise<T[]> {
  const out: T[] = [];
  const clean = ids.filter((x) => UUIDISH.test(x));
  for (let i = 0; i < clean.length; i += 80) out.push(...rows<T>(await svc(`${table}?site_id=eq.${siteId}&id=in.(${clean.slice(i, i + 80).join(',')})${extra}&select=${select}&limit=200`)));
  return out;
}
/** `fn` over `items`, a few at a time */
export async function inBatches<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
  return out;
}

/** A site's pages and sections as a layout: the settings columns that carry them
 *  (the menu keeps only links to its own pages), the look and its own CSS, the
 *  saved sections they link to, and the photos and files they use. With
 *  `keepPhotosIn` (a storage folder) the photos are copied there now, so a
 *  template outlives the site it was saved from; otherwise they are read from
 *  the site itself when the layout lands. */
export async function layoutFromSite(siteId: string, opts: { label?: string; keepPhotosIn?: string } = {}): Promise<SiteLayout> {
  const [setQ, devQ, siteQ, identQ] = await Promise.all([
    svc(`presence_settings?site_id=eq.${siteId}&select=${LAYOUT_COLUMNS.join(',')}&limit=1`),
    svc(`presence_dev_customizations?site_id=eq.${siteId}&select=custom_css&limit=1`),
    svc(`presence_sites?id=eq.${siteId}&select=template_slug&limit=1`),
    svc(`presence_identity?site_id=eq.${siteId}&select=business_name&limit=1`),
  ]);
  const row = rows<Record<string, unknown>>(setQ)[0] || {};
  const settings: Partial<Record<LayoutColumn, unknown>> = {};
  for (const c of LAYOUT_COLUMNS) if (row[c] !== undefined && row[c] !== null) settings[c] = c === 'nav' ? menuForCopy(row[c]) : row[c];
  const linked = layoutLinkedIds(settings);
  const library = linked.length ? await readByIds<LayoutLibraryItem>('presence_content_library', siteId, linked, 'id,name,payload') : [];
  const ids = layoutMediaIds(settings, library);
  let media = (ids.length ? await readByIds<LayoutMedia>('presence_media', siteId, ids, 'id,storage_path,mime,alt_text,bytes,width,height,focal_x,focal_y', '&deleted_at=is.null') : []).slice(0, MAX_LAYOUT_MEDIA);
  if (opts.keepPhotosIn) {
    const kept = await inBatches(media, 6, async (m) => { const p = await copyObject(opts.keepPhotosIn!, m.storage_path, m.mime || 'image/jpeg'); return p ? { ...m, storage_path: p } : null; });
    media = kept.filter((m): m is LayoutMedia => !!m);
  }
  const fromName = String(rows<{ business_name?: string }>(identQ)[0]?.business_name || '').trim();
  return {
    v: 1, from_name: fromName, from_label: String(opts.label || fromName || 'another site').slice(0, 120),
    template_slug: String(rows<{ template_slug?: string }>(siteQ)[0]?.template_slug || '') || null,
    settings, custom_css: String(rows<{ custom_css?: string }>(devQ)[0]?.custom_css || ''), library, media,
  };
}

/** Land a layout on a NEW site: fill-only-empty, like a kit — a site that already
 *  has pages or sections keeps its own. The photos and files become the site's
 *  own copies (never a file shared with another site, whose clean-up could remove
 *  it), saved sections become its own, the old business's name in the words
 *  becomes this one's, the look is set, and the copy is recorded so publishing
 *  can say what is still exactly as copied (lib/copied_record.ts). */
export async function applyLayoutTo(layout: SiteLayout, siteId: string, principal: Principal, opts: { label?: string } = {}) {
  const counts = layoutCounts(layout.settings || {});
  if (!counts.sections && !counts.pages) return { applied: false as const, skipped: null };
  const [curQ, identQ] = await Promise.all([
    svc(`presence_settings?site_id=eq.${siteId}&select=blocks,pages&limit=1`),
    svc(`presence_identity?site_id=eq.${siteId}&select=business_name&limit=1`),
  ]);
  const cur = rows<{ blocks?: unknown[]; pages?: unknown[] }>(curQ)[0];
  if ((Array.isArray(cur?.blocks) && cur!.blocks.length) || (Array.isArray(cur?.pages) && cur!.pages.length)) {
    return { applied: false as const, skipped: 'pages and sections (this site already has its own)' };
  }
  const label = String(opts.label || layout.from_label || 'another site');
  const toName = String(rows<{ business_name?: string }>(identQ)[0]?.business_name || '').trim();
  const by = principal.email || principal.userId || null;
  const map: Record<string, string> = {};
  // the photos and files: the new site's own copies
  const made = await inBatches((layout.media || []).slice(0, MAX_LAYOUT_MEDIA), 6, async (m) => {
    const path = await copyObject(siteId, m.storage_path, m.mime || 'image/jpeg');
    if (!path) return null;
    const ins = await svc('presence_media', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
      site_id: siteId, storage_path: path, alt_text: String(m.alt_text || '').trim().length >= 3 ? m.alt_text : 'Photo', mime: m.mime || '', bytes: m.bytes ?? null,
      width: m.width ?? null, height: m.height ?? null, focal_x: m.focal_x ?? null, focal_y: m.focal_y ?? null,
      metadata: { copied_from: label }, asset_status: 'approved',
    }) });
    const id = rows<{ id: string }>(ins)[0]?.id;
    if (!id) return null;
    map[String(m.id).toLowerCase()] = id;
    return id;
  });
  const photos = made.filter((x): x is string => !!x);
  // the saved sections they link to: the new site's own
  for (const it of layout.library || []) {
    const ins = await svc('presence_content_library', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
      site_id: siteId, name: String(it.name || 'Saved section').slice(0, 120), kind: 'block', payload: swapName(swapIds(it.payload, map), layout.from_name, toName), created_by: by,
    }) });
    const id = rows<{ id: string }>(ins)[0]?.id;
    if (id) map[String(it.id).toLowerCase()] = id;
  }
  const patch: Record<string, unknown> = {};
  for (const c of LAYOUT_COLUMNS) if (c in layout.settings) patch[c] = swapName(swapIds(layout.settings[c], map), layout.from_name, toName);
  const w = await svc('presence_settings?on_conflict=site_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ site_id: siteId, ...patch }) });
  if (!w.ok) {
    // nothing half-made lingers: the copies go back out
    if (photos.length) await svc(`presence_media?site_id=eq.${siteId}&id=in.(${photos.join(',')})`, { method: 'PATCH', body: JSON.stringify({ deleted_at: new Date().toISOString() }) }).catch(() => null);
    return { applied: false as const, skipped: 'pages and sections (that didn’t save)' };
  }
  // the look's own CSS, only onto a site that has none
  if (layout.custom_css) {
    const dev = rows<{ custom_css?: string }>(await svc(`presence_dev_customizations?site_id=eq.${siteId}&select=custom_css&limit=1`))[0];
    if (!String(dev?.custom_css || '').trim()) await svc('presence_dev_customizations?on_conflict=site_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ site_id: siteId, custom_css: layout.custom_css }) });
  }
  // the look: the layout's template at its latest version, as Styles would set it
  let look: string | null = null;
  const site = rows<{ template_slug?: string; template_version?: string }>(await svc(`presence_sites?id=eq.${siteId}&select=template_slug,template_version&limit=1`))[0] || {};
  let slug = String(site.template_slug || ''), version = String(site.template_version || '');
  const want = layout.template_slug ? latestTemplateVersion(layout.template_slug) : null;
  const tpl = want && layout.template_slug ? getTemplate(layout.template_slug, want) : null;
  if (tpl && layout.template_slug !== slug) {
    const lw = await svc(`presence_sites?id=eq.${siteId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ template_slug: layout.template_slug, template_version: want }) });
    if (lw.ok) {
      look = tpl.manifest.name; slug = layout.template_slug!; version = want!;
      await writeChangeEvent({ siteId, entityType: 'settings', entityId: null, action: 'update', summary: `Changed the site’s look to ${tpl.manifest.name}`, principal, provenance: 'human', fields: ['template_slug'] });
    }
  } else if (tpl) look = tpl.manifest.name;
  await writeChangeEvent({ siteId, entityType: 'settings', entityId: null, action: 'update', summary: `Copied the pages and sections from ${label}`, principal, provenance: 'human', fields: ['blocks', 'pages', 'nav'] });
  // the record: every section as it arrived, and the copies, so publishing can tell what's untouched
  const t = getTemplate(slug, version);
  let recorded = false;
  if (t) {
    try {
      const d = await serializeDraft(siteId, t.manifest, { templateSlug: slug, templateVersion: version, now: new Date().toISOString() });
      recorded = await recordCopied(siteId, label, d.snapshot.content, photos, String(by || ''));
    } catch { recorded = false; }
  }
  return { applied: true as const, pages: counts.pages, sections: counts.sections, menu: Array.isArray(patch.nav) ? (patch.nav as unknown[]).length : 0, photos: photos.length, photos_failed: (layout.media || []).length - photos.length, look, recorded };
}

/** A site's setup as a kit: services, FAQs, voice, colors, industry and the
 *  template it uses. buildKitPayload leaves every business fact out. */
export async function kitFromSite(siteId: string): Promise<KitPayload> {
  const [siteQ, off, faqs, voiceQ, setQ, devQ] = await Promise.all([
    svc(`presence_sites?id=eq.${siteId}&select=template_slug&limit=1`),
    svc(`presence_offerings?site_id=eq.${siteId}&deleted_at=is.null&is_visible=is.true&select=name,category,description,price_text,sort_order&order=sort_order.asc&limit=100`),
    svc(`presence_faqs?site_id=eq.${siteId}&deleted_at=is.null&is_visible=is.true&select=question,answer,sort_order&order=sort_order.asc&limit=50`),
    svc(`presence_voice?site_id=eq.${siteId}&select=tone_notes,preferred_vocabulary,never_claim&limit=1`),
    svc(`presence_settings?site_id=eq.${siteId}&select=industry_key,category_order&limit=1`),
    svc(`presence_dev_customizations?site_id=eq.${siteId}&select=theme_tokens&limit=1`),
  ]);
  return buildKitPayload({
    industry_key: setQ.json?.[0]?.industry_key, template_slug: siteQ.json?.[0]?.template_slug,
    category_order: setQ.json?.[0]?.category_order, offerings: off.json ?? [], faqs: faqs.json ?? [],
    voice: voiceQ.json?.[0] ?? null, theme_tokens: devQ.json?.[0]?.theme_tokens ?? null,
  });
}

/** Apply a kit to a site, fill-only-empty (applyPlan), and record it on the
 *  site's history under `summary`. Says what was applied and what was skipped.
 *  A kit saved as "my template" (item 145) brings its pages too (applyLayoutTo),
 *  named `opts.label` on the new site when given. */
export async function applyKitTo(kit: KitPayload, siteId: string, principal: Principal, summary: string, opts: { label?: string } = {}) {
  const [off, faqs, voiceQ, setQ, devQ] = await Promise.all([
    svc(`presence_offerings?site_id=eq.${siteId}&deleted_at=is.null&select=id&limit=1`),
    svc(`presence_faqs?site_id=eq.${siteId}&deleted_at=is.null&select=id&limit=1`),
    svc(`presence_voice?site_id=eq.${siteId}&select=tone_notes,preferred_vocabulary,never_claim&limit=1`),
    svc(`presence_settings?site_id=eq.${siteId}&select=industry_key,category_order&limit=1`),
    svc(`presence_dev_customizations?site_id=eq.${siteId}&select=theme_tokens&limit=1`),
  ]);
  const v0 = voiceQ.json?.[0];
  const plan = applyPlan(kit, {
    offerings_count: (off.json ?? []).length, faqs_count: (faqs.json ?? []).length,
    has_voice: !!(v0 && (v0.tone_notes || v0.preferred_vocabulary || v0.never_claim)),
    has_tokens: Object.keys(devQ.json?.[0]?.theme_tokens ?? {}).length > 0,
    industry_key: String(setQ.json?.[0]?.industry_key || 'generic'),
    category_order_count: (setQ.json?.[0]?.category_order ?? []).length,
  });
  if (plan.insert_offerings.length) {
    await svc('presence_offerings', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(plan.insert_offerings.map((o) => ({ ...o, site_id: siteId }))) });
  }
  if (plan.insert_faqs.length) {
    await svc('presence_faqs', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(plan.insert_faqs.map((f) => ({ ...f, site_id: siteId }))) });
  }
  if (plan.set_voice) await svc(`presence_voice?on_conflict=site_id`, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ site_id: siteId, ...plan.set_voice }) });
  const setPatch: Record<string, unknown> = {};
  if (plan.set_industry) setPatch.industry_key = plan.set_industry;
  if (plan.set_category_order) setPatch.category_order = plan.set_category_order;
  if (Object.keys(setPatch).length) await svc(`presence_settings?on_conflict=site_id`, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ site_id: siteId, ...setPatch }) });
  if (plan.set_tokens) await svc(`presence_dev_customizations?on_conflict=site_id`, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ site_id: siteId, theme_tokens: plan.set_tokens, custom_css: '', custom_html: '' }) });
  await writeChangeEvent({ siteId, entityType: 'settings', entityId: null, action: 'update', summary, principal, provenance: 'human', fields: ['starter_kit'] });
  const skipped = plan.skipped.slice();
  let layout: Awaited<ReturnType<typeof applyLayoutTo>> | null = null;
  if (kit.layout) {
    try { layout = await applyLayoutTo(kit.layout, siteId, principal, opts); }
    catch { layout = { applied: false as const, skipped: 'pages and sections (that didn’t go through)' }; }
    if (!layout.applied && layout.skipped) skipped.push(layout.skipped);
  }
  return {
    applied: { offerings: plan.insert_offerings.length, faqs: plan.insert_faqs.length, voice: !!plan.set_voice, colors: !!plan.set_tokens, industry: plan.set_industry || null },
    skipped, ...(layout ? { layout } : {}),
  };
}
