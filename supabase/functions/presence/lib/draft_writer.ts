// ── The Draft Writer (reconciliation §3) — the ONE gate into the draft ───────
// Every structured mutation that isn't a client keystroke enters the draft
// here: restore today, AI proposals (M9) and cross-product patches tomorrow.
// First caller: restore-to-draft. Semantics (frozen):
//   • REPLACE, never merge — but the current draft is preserved first as a
//     retained safety snapshot ("we set your work aside, nothing is lost").
//   • Entities in the draft but absent from the applied snapshot are HIDDEN,
//     not deleted (the toggle philosophy, applied to time).
//   • Media references that no longer resolve are dropped, counted, and told.
import { svc } from './db.ts';
import { serializeDraft, variantPath } from './serializer.ts';
import { writeChangeEvent } from './provenance.ts';
import { normalizeSnapshotContent, snapshotContentUsable } from './render_types.ts';
import type { SnapshotContent } from './render_types.ts';
import type { Principal } from '../../_shared/auth.ts';
import type { SiteRow } from './site.ts';

export interface ApplyResult {
  ok: boolean;
  error?: string;
  applied?: { entities: number; hidden: number; dropped_media: number };
}

interface MediaManifestRow { media_id: string; storage_path: string; variants: Array<{ output_path: string }> }

/** Map a MediaRef back to a still-existing media_id via the snapshot's media
 *  manifest (variant paths are deterministic per storage_path). */
function mediaResolver(mediaManifest: MediaManifestRow[], liveMedia: Array<{ id: string; storage_path: string }>) {
  const byVariant = new Map<string, string>(); // output_path -> storage_path
  for (const m of mediaManifest || []) for (const v of m.variants || []) byVariant.set(v.output_path, m.storage_path);
  const liveByPath = new Map(liveMedia.map((m) => [m.storage_path, m.id]));
  return (ref: { variants?: Record<string, string> } | null | undefined): { id: string | null; dropped: boolean } => {
    if (!ref?.variants) return { id: null, dropped: false };
    for (const p of Object.values(ref.variants)) {
      const sp = byVariant.get(p) ?? [...liveByPath.keys()].find((k) => variantPath(k, 800) === p || variantPath(k, 400) === p || variantPath(k, 1600) === p);
      if (sp && liveByPath.has(sp)) return { id: liveByPath.get(sp)!, dropped: false };
    }
    return { id: null, dropped: true };
  };
}

export async function applySnapshotToDraft(
  site: SiteRow,
  snapshot: { content: unknown; media_manifest?: MediaManifestRow[]; content_contract_version: number; template_slug: string; template_version: string; dev_customization?: { theme_tokens?: Record<string, string>; custom_css?: string; custom_html?: string } | null },
  principal: Principal,
  summary: string,
): Promise<ApplyResult> {
  // the gate refuses unusable content no matter who calls — REPLACE semantics
  // applied from a degenerate snapshot would blank the draft
  if (!snapshotContentUsable(snapshot.content)) return { ok: false, error: 'unusable_snapshot' };
  const c: SnapshotContent = normalizeSnapshotContent(structuredClone(snapshot.content));
  const actorKind = principal.kind === 'staff' ? 'staff' : 'client';

  // 1. safety snapshot — the current draft is set aside, never lost
  try {
    const { getTemplate } = await import('./render.ts');
    const t = getTemplate(site.template_slug, site.template_version);
    if (t) {
      const cur = await serializeDraft(site.id, t.manifest, { templateSlug: site.template_slug, templateVersion: site.template_version, now: new Date().toISOString() });
      await svc('presence_snapshots', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          site_id: site.id, content: cur.snapshot.content, media_manifest: cur.mediaManifest,
          content_contract_version: cur.snapshot.content_contract_version,
          template_slug: site.template_slug, template_version: site.template_version,
          dev_customization: cur.snapshot.dev_customization ?? null,  // Phase B1: safety snapshot keeps the current dev layer too
          created_by: principal.userId, created_by_kind: actorKind,
        }),
      });
    }
  } catch { /* safety snapshot is best-effort; the restore itself is still explicit */ }

  let entities = 0, hidden = 0, dropped = 0;

  // 2. media resolver against current library
  const mediaRows = (await svc(`presence_media?site_id=eq.${site.id}&deleted_at=is.null&select=id,storage_path`)).json ?? [];
  const resolve = mediaResolver(snapshot.media_manifest || [], mediaRows);

  // 3. identity (singleton upsert)
  const i = c.identity || ({} as SnapshotContent['identity']);
  const identRes = await svc('presence_identity?on_conflict=site_id', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      site_id: site.id, business_name: i.business_name || '', description: i.description || '',
      phone: i.phone || '', email: i.email || '', tagline: i.tagline || '', story: i.story || '',
      service_area: i.service_area || '', booking_url: i.booking_url || '', ordering_url: i.ordering_url || '',
      social: i.social || {}, seo_title: i.seo_title || '', seo_description: i.seo_description || '',
    }),
  });
  if (!identRes.ok) return { ok: false, error: `identity: ${identRes.status}` };
  entities++;

  // 4. location (v1 singleton; unique site_id)
  const l = c.locations?.[0];
  if (l) {
    const existing = (await svc(`presence_locations?site_id=eq.${site.id}&select=id&limit=1`)).json?.[0];
    const body = JSON.stringify({
      site_id: site.id, address_line1: l.address_line1 || '', address_line2: l.address_line2 || '',
      city: l.city || '', region: l.region || '', postal_code: l.postal_code || '', country: l.country || 'US',
      phone: l.phone || '', timezone: l.timezone || 'America/Los_Angeles', hours: l.hours || [],
      holiday_exceptions: l.holiday_exceptions || [], temporarily_closed: !!l.temporarily_closed,
      temporarily_closed_note: l.temporarily_closed_note || '',
    });
    const r = existing
      ? await svc(`presence_locations?id=eq.${existing.id}`, { method: 'PATCH', body })
      : await svc('presence_locations', { method: 'POST', body });
    if (!r.ok) return { ok: false, error: `location: ${r.status}` };
    entities++;
  }

  // 5. settings (section order)
  await svc('presence_settings?on_conflict=site_id', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ site_id: site.id, category_order: c.settings?.category_order || [] }),
  });

  // 6. collection sync — upsert by original id; hide what the snapshot lacks
  const syncCollection = async (
    table: string, snapIds: Set<string>,
    rows: Array<Record<string, unknown> & { id: string }>,
  ) => {
    for (const row of rows) {
      const r = await svc(`${table}?on_conflict=id`, {
        method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(row),
      });
      if (!r.ok) throw new Error(`${table}: ${r.status} ${r.text?.slice(0, 120)}`);
      entities++;
    }
    const current = (await svc(`${table}?site_id=eq.${site.id}&deleted_at=is.null&is_visible=is.true&select=id`)).json ?? [];
    const toHide = current.filter((x: { id: string }) => !snapIds.has(x.id)).map((x: { id: string }) => x.id);
    if (toHide.length) {
      await svc(`${table}?id=in.(${toHide.join(',')})`, { method: 'PATCH', body: JSON.stringify({ is_visible: false }) });
      hidden += toHide.length;
    }
  };

  try {
    await syncCollection('presence_offerings', new Set(c.offerings.map((o) => o.id)),
      c.offerings.map((o, idx) => {
        const m = resolve(o.media); if (m.dropped) dropped++;
        return { id: o.id, site_id: site.id, name: o.name, category: o.category, description: o.description || '', price_text: o.price_text || '', media_id: m.id, is_visible: true, sort_order: o.sort_order ?? idx, deleted_at: null };
      }));
    await syncCollection('presence_testimonials', new Set(c.testimonials.map((t) => t.id)),
      c.testimonials.map((t, idx) => ({ id: t.id, site_id: site.id, quote: t.quote, author: t.author, source: t.source || '', quote_date: t.quote_date || null, is_visible: true, sort_order: t.sort_order ?? idx, deleted_at: null })));
    await syncCollection('presence_faqs', new Set(c.faqs.map((f) => f.id)),
      c.faqs.map((f, idx) => ({ id: f.id, site_id: site.id, question: f.question, answer: f.answer, is_visible: true, sort_order: f.sort_order ?? idx, deleted_at: null })));
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 200) };
  }

  // 7. posts: snapshot posts return to published; published drafts not in the snapshot step back to draft
  for (const p of c.posts) {
    const m = resolve(p.hero); if (m.dropped) dropped++;
    const r = await svc('presence_posts?on_conflict=id', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ id: p.id, site_id: site.id, title: p.title, slug: p.slug, body_md: p.body_md, excerpt: p.excerpt || '', hero_media_id: m.id, status: 'published', published_at: p.published_at, deleted_at: null }),
    });
    if (r.ok) entities++;
  }
  const snapPostIds = new Set(c.posts.map((p) => p.id));
  const pubPosts = (await svc(`presence_posts?site_id=eq.${site.id}&deleted_at=is.null&status=eq.published&select=id`)).json ?? [];
  const demote = pubPosts.filter((x: { id: string }) => !snapPostIds.has(x.id)).map((x: { id: string }) => x.id);
  if (demote.length) {
    await svc(`presence_posts?id=in.(${demote.join(',')})`, { method: 'PATCH', body: JSON.stringify({ status: 'draft' }) });
    hidden += demote.length;
  }

  // 7b. Phase B1: restore the Developer-Mode layer too, so restore-to-draft brings
  // back the exact customization of that version (or clears it if the version had
  // none) — the draft matches the restored snapshot completely.
  {
    const d = snapshot.dev_customization || null;
    await svc('presence_dev_customizations?on_conflict=site_id', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        site_id: site.id,
        theme_tokens: d?.theme_tokens ?? {},
        custom_css: d?.custom_css ?? '',
        custom_html: d?.custom_html ?? '',
        updated_by: principal.userId || 'restore',
        updated_at: new Date().toISOString(),
      }),
    });
  }

  // 8. provenance — one event, names only
  await writeChangeEvent({ siteId: site.id, entityType: 'restore', entityId: null, action: 'restore', summary, principal, provenance: 'human' });

  return { ok: true, applied: { entities, hidden, dropped_media: dropped } };
}
