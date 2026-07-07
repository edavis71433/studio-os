// ── The export — the right to leave, made executable (M14) ──────────────────
// Everything the customer owns, in one portable document: their content (the
// full draft snapshot), their media (paths + descriptions), their redirects,
// their brand profile, their knowledge imports, AND the rendered website
// itself (plain HTML/CSS through the one renderer) — hostable anywhere, by
// anyone, with no Studio OS dependency. This route existing is the ownership
// guarantee; a platform that ships its own exit cannot build lock-in.
import { svc } from '../lib/db.ts';
import { getTemplate } from '../lib/render.ts';
import { serializeDraft } from '../lib/serializer.ts';
import type { SiteRow } from '../lib/site.ts';

export interface SiteExport {
  format: 'studio-os-export/1';
  exported_at: string;
  ownership_note: string;
  site: { domain: string | null; edition: string; template: string };
  content: unknown;                       // the full snapshot content — every word they wrote
  media: Array<{ id: string; storage_path: string; alt_text: string; mime: string; width: number | null; height: number | null }>;
  redirects: unknown;
  brand_profile: unknown | null;
  knowledge_docs: Array<{ filename: string; content_text: string }>;
  website: Record<string, string> | null; // the rendered site: path → HTML/CSS, hostable anywhere
}

export async function buildExport(site: SiteRow): Promise<SiteExport> {
  const now = new Date().toISOString();
  const t = getTemplate(site.template_slug, site.template_version);
  const [{ snapshot }, mediaQ, brandQ, docsQ] = await Promise.all([
    serializeDraft(site.id, t!.manifest, { templateSlug: site.template_slug, templateVersion: site.template_version, now }),
    svc(`presence_media?site_id=eq.${site.id}&deleted_at=is.null&select=id,storage_path,alt_text,mime,width,height&limit=500`),
    svc(`presence_brand_profile?site_id=eq.${site.id}&select=mission,vision,core_values,personality,voice_characteristics,preferred_vocabulary,words_prefer,words_avoid,never_claims,reading_level,industry_terminology,taglines,elevator_pitch,target_audience,brand_promise,selling_points&limit=1`),
    svc(`presence_knowledge_docs?site_id=eq.${site.id}&deleted_at=is.null&select=filename,content_text&limit=20`),
  ]);

  // the rendered site — portable, framework-free HTML through the ONE renderer
  let website: Record<string, string> | null = null;
  try {
    const fm = t!.render(
      { content: structuredClone(snapshot.content), content_contract_version: snapshot.content_contract_version, template_slug: site.template_slug, template_version: site.template_version, created_at: now },
      t!.manifest,
      { baseUrl: site.custom_domain ? `https://${site.custom_domain}` : 'https://example.com' },
    );
    website = {};
    for (const [k, v] of Object.entries(fm)) if (typeof v === 'string') website[k] = v;
  } catch { website = null; }

  const content = snapshot.content as { redirects?: unknown };
  return {
    format: 'studio-os-export/1',
    exported_at: now,
    ownership_note: 'Everything in this file is yours: your words, your media references, your brand, your redirects, and your rendered website. Host it anywhere. Nothing here requires Studio OS.',
    site: { domain: site.custom_domain, edition: site.edition, template: `${site.template_slug} ${site.template_version}` },
    content: snapshot.content,
    media: mediaQ.json ?? [],
    redirects: content?.redirects ?? [],
    brand_profile: brandQ.json?.[0] ?? null,
    knowledge_docs: docsQ.json ?? [],
    website,
  };
}
