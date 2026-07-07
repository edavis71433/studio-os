// GET /site — the room's home view. Plain-language summary only: identity,
// location, voice, counts, last published, draft status. No history, snapshots,
// media, or AI (M3 scope). Reads content under the caller's JWT (RLS-scoped);
// counts + draft status via service role (fast; and draft compares against
// publishes, which clients can't read directly).
import { json } from '../../_shared/http.ts';
import { asUser, svc } from '../lib/db.ts';
import type { SiteRow } from '../lib/site.ts';

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
  const [ident, loc, voice, nOff, nTes, nFaq, nPos, nMed, evR, pubR] = await Promise.all([
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
  ]);
  const counts = { offerings: nOff, testimonials: nTes, faqs: nFaq, posts: nPos, media: nMed };
  const lastEvent = Array.isArray(evR.json) && evR.json.length ? evR.json[0].created_at : null;
  const lastLive = Array.isArray(pubR.json) && pubR.json.length ? pubR.json[0].created_at : null;
  const hasUnpublishedChanges = !!lastEvent && (!lastLive || new Date(lastEvent).getTime() > new Date(lastLive).getTime());

  return json({
    data: {
      site: { id: site.id, status: site.status, template: `${site.template_slug} ${site.template_version}` },
      identity: (Array.isArray(ident.json) && ident.json[0]) || null,
      location: (Array.isArray(loc.json) && loc.json[0]) || null,
      voice: (Array.isArray(voice.json) && voice.json[0])
        ? { tone_notes: voice.json[0].voice_characteristics || '', preferred_vocabulary: voice.json[0].preferred_vocabulary || '', never_claim: voice.json[0].never_claims || '' }
        : null,
      counts,
      last_published_at: site.last_published_at,
      has_unpublished_changes: hasUnpublishedChanges,
    },
  }, 200, cors);
}
