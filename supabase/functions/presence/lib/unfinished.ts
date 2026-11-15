// ── The unfinished-sections count, kept on the site (builder list item 209) ──────────
// Review file 06, finding 85: the bell, the Inbox and Today rebuilt the whole draft, read
// the live version and compared the two on every open, only to count the sections that
// still need something before the site can publish. The count is now kept on the site
// (presence_sites.unfinished_sections, migration 0206). A change to the draft (every
// save writes a change event) empties it, by the trigger that also keeps the site's
// latest change time; the next read that needs it works it out once and keeps it.
//
// Kept only while nothing changed since it was read: the save is refused when the
// site's latest change moved meanwhile, so a count can't outlive the draft it came from.
import { svc } from './db.ts';
import { getTemplate } from './render.ts';
import { serializeDraft } from './serializer.ts';
import { validateSnapshot } from './manifest_validate.ts';
import { buildContentTree } from './content_tree.ts';
import type { Snapshot, TemplateManifest } from './render_types.ts';
import type { SiteRow } from './site.ts';

/** How many sections of the draft need something before it can publish: the Content
 *  Tree's "Needs something before publishing" rows. Worked out from the draft alone, so
 *  the publish history doesn't change it. Pure. */
export function unfinishedOf(manifest: TemplateManifest, snapshot: Snapshot): number {
  const tree = buildContentTree({
    manifest, draft: snapshot.content, live: null,
    validation: validateSnapshot(snapshot, manifest),
    changes: { count: 0, changes: [], first_publish: false },
    publish: { lastPublishedAt: null, lastPublishFailed: false, scheduledPending: false, everPublished: false },
  });
  return tree.pages.reduce((n, p) => n + p.sections.filter((s) => s.status === 'missing_required').length, 0);
}

/** The site's unfinished sections: the kept count, or worked out now and kept. Null when
 *  the site's template isn't available. Before migration 0206 it is worked out every
 *  time, as before, and nothing is kept. */
export async function unfinishedSectionsOf(site: SiteRow): Promise<number | null> {
  const r = await svc(`presence_sites?id=eq.${site.id}&select=unfinished_sections,last_change_at&limit=1`).catch(() => null);
  const row = r && r.ok && Array.isArray(r.json) ? r.json[0] as { unfinished_sections: number | null; last_change_at: string | null } | undefined : undefined;
  if (row && Number.isInteger(row.unfinished_sections)) return row.unfinished_sections as number;
  const t = getTemplate(site.template_slug, site.template_version);
  if (!t) return null;
  const { snapshot } = await serializeDraft(site.id, t.manifest, { templateSlug: site.template_slug, templateVersion: site.template_version, now: new Date().toISOString() });
  const n = unfinishedOf(t.manifest, snapshot);
  if (row) {
    const same = row.last_change_at ? `last_change_at=eq.${encodeURIComponent(row.last_change_at)}` : 'last_change_at=is.null';
    await svc(`presence_sites?id=eq.${site.id}&${same}&unfinished_sections=is.null`, { method: 'PATCH', body: JSON.stringify({ unfinished_sections: n }) }).catch(() => null);
  }
  return n;
}
