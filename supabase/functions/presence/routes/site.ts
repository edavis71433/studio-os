// GET /site — the room's home view. Plain-language summary only: identity,
// location, voice, counts, last published, draft status. No history, snapshots,
// media, or AI (M3 scope). Reads content under the caller's JWT (RLS-scoped);
// counts + draft status via service role (fast; and draft compares against
// publishes, which clients can't read directly).
import { json } from '../../_shared/http.ts';
import { asUser, svc } from '../lib/db.ts';
import type { SiteRow } from '../lib/site.ts';
import { listTemplates, latestTemplateVersion, getTemplate } from '../lib/render.ts';
import { draftHashForSite } from '../lib/draft_hash.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import { resolveSiteRole } from '../lib/workspace.ts';
import type { Principal } from '../../_shared/auth.ts';

// ── Phase CP-1 (FD-T8): template catalog + switch ───────────────────────────
// Switching NEVER touches content — the same structured facts re-render through
// the new template (the whole point of the architecture). Owner-only; the old
// look remains restorable because every published version pins its template.
export function handleTemplatesList(site: SiteRow, cors: Record<string, string>) {
  return json({ data: { current: { slug: site.template_slug, version: site.template_version }, templates: listTemplates() } }, 200, cors);
}

export async function handlePutTemplate(req: Request, jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const role = await resolveSiteRole(jwt, site.id, principal.kind);
  const isOperator = principal.kind === 'staff' || principal.kind === 'system';
  if (!isOperator && role !== 'business_owner') return json({ error: 'forbidden', message: 'Only the account owner can change the site’s look.' }, 403, cors);
  let b: any = {}; try { b = await req.json(); } catch { /* */ }
  const slug = String(b?.slug || '');
  const version = latestTemplateVersion(slug);
  const t = version ? getTemplate(slug, version) : null;
  if (!t) return json({ error: 'bad_template', message: 'That look isn’t available.' }, 400, cors);
  if (slug === site.template_slug) return json({ data: { ok: true, unchanged: true } }, 200, cors);
  const w = await svc(`presence_sites?id=eq.${site.id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ template_slug: slug, template_version: version }) });
  if (!w.ok) return json({ error: 'write_failed', message: 'That didn’t save.' }, 502, cors);
  await writeChangeEvent({ siteId: site.id, entityType: 'settings', entityId: null, action: 'update', summary: `Changed the site’s look to ${t.manifest.name}`, principal, provenance: 'human', fields: ['template_slug'] });
  return json({ data: { ok: true, slug, version, name: t.manifest.name } }, 200, cors);
}

// Count via row length under the service role. Pilot-scale (manifest caps keep
// collections tiny); revisit with count=exact headers if it ever matters.
async function count(table: string, siteId: string, extra = ''): Promise<number> {
  const r = await svc(`${table}?site_id=eq.${siteId}&select=id${extra}`);
  return Array.isArray(r.json) ? r.json.length : 0;
}

export async function handleGetSite(jwt: string, site: SiteRow, cors: Record<string, string>) {
  // Everything the home view needs runs in ONE concurrent batch: the three
  // singletons under the caller's JWT (RLS proves ownership), the five counts,
  // and the two draft-status probes. One round-trip depth, not three.
  const [ident, loc, voice, nOff, nTes, nFaq, nPos, nMed, evR, pubR, draftHash] = await Promise.all([
    asUser(jwt, `presence_identity?site_id=eq.${site.id}&select=business_name,tagline,description,phone,email,service_area,booking_url,ordering_url,social,seo_title,seo_description&limit=1`),
    asUser(jwt, `presence_locations?site_id=eq.${site.id}&select=address_line1,address_line2,city,region,postal_code,country,phone,timezone,hours,holiday_exceptions,temporarily_closed,temporarily_closed_note&limit=1`),
    // M9.5G: voice now lives in the Brand Profile (one canonical source);
    // the /site payload keeps its frozen shape via the mapping below
    asUser(jwt, `presence_brand_profile?site_id=eq.${site.id}&select=voice_characteristics,preferred_vocabulary,never_claims&limit=1`),
    count('presence_offerings',    site.id, '&deleted_at=is.null&is_visible=is.true'),
    count('presence_testimonials', site.id, '&deleted_at=is.null&is_visible=is.true'),
    count('presence_faqs',         site.id, '&deleted_at=is.null&is_visible=is.true'),
    count('presence_posts',        site.id, '&deleted_at=is.null&status=eq.published'),
    count('presence_media',        site.id, '&deleted_at=is.null'),
    // draft status: latest change event vs latest live publish (service role —
    // publishes are default-deny to clients).
    svc(`presence_change_events?site_id=eq.${site.id}&select=created_at&order=created_at.desc&limit=1`),
    svc(`presence_publishes?site_id=eq.${site.id}&status=eq.live&select=created_at&order=created_at.desc&limit=1`),
    // M3: the canonical draft-version hash (compute-on-read from the ONE serializer).
    // Fail-soft — a serialize hiccup returns null and never blocks the home view.
    draftHashForSite(site).catch(() => null),
  ]);
  const counts = { offerings: nOff, testimonials: nTes, faqs: nFaq, posts: nPos, media: nMed };
  const lastEvent = Array.isArray(evR.json) && evR.json.length ? evR.json[0].created_at : null;
  const lastLive = Array.isArray(pubR.json) && pubR.json.length ? pubR.json[0].created_at : null;
  const hasUnpublishedChanges = !!lastEvent && (!lastLive || new Date(lastEvent).getTime() > new Date(lastLive).getTime());

  return json({
    data: {
      site: { id: site.id, status: site.status, template: `${site.template_slug} ${site.template_version}`, edition: site.edition },
      identity: (Array.isArray(ident.json) && ident.json[0]) || null,
      location: (Array.isArray(loc.json) && loc.json[0]) || null,
      voice: (Array.isArray(voice.json) && voice.json[0])
        ? { tone_notes: voice.json[0].voice_characteristics || '', preferred_vocabulary: voice.json[0].preferred_vocabulary || '', never_claim: voice.json[0].never_claims || '' }
        : null,
      counts,
      last_published_at: site.last_published_at,
      has_unpublished_changes: hasUnpublishedChanges,
      // M3: canonical draft fingerprint. Foundation for M8/M9 + unpublished-changes
      // detection + publish summaries — surfaced here, consumed later. Null only if
      // the template is unavailable. Does NOT change has_unpublished_changes above.
      draft_hash: draftHash,
    },
  }, 200, cors);
}
