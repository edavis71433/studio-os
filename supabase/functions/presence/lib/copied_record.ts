// ── The copy record's reads and writes (builder list item 145) ───────────────
// lib/site_layout.ts decides what counts as still copied (pure); these do the
// I/O: the record is ONE reserved row on the new site (lib/reserved_store.ts).
import { readReservedJson, writeReservedJson, updateReservedJson, RESERVED_NAMES } from './reserved_store.ts';
import { normalizeCopied, copiedLeftovers, copiedBlocker, printSections } from './site_layout.ts';
import type { CopiedRecord } from './site_layout.ts';
import { addToCopied } from './saved_pages.ts';
import type { MediaManifestEntry } from './serializer.ts';

/** The site's copy record, or null (none, unreadable, or malformed). */
export async function readCopied(siteId: string): Promise<CopiedRecord | null> {
  return normalizeCopied(await readReservedJson(siteId, RESERVED_NAMES.copiedFrom));
}

/** Record what just arrived: every section of the new site's draft, printed,
 *  and its own copies of the photos and files. */
export async function recordCopied(siteId: string, from: string, content: unknown, media: string[], by: string): Promise<boolean> {
  const rec: CopiedRecord = { from, at: new Date().toISOString(), sections: [...new Set(printSections(content).map((s) => s.print))], media, kept: false };
  return writeReservedJson(siteId, RESERVED_NAMES.copiedFrom, rec, by);
}

/** Builder list item 216: a page saved to the studio landed on this site. Its sections
 *  (the prints of that page alone) and its photos join the record, so an earlier copy's
 *  leftovers stay listed too; a record already kept starts again with this page only. */
export async function addCopiedPage(siteId: string, from: string, prints: string[], media: string[], by: string): Promise<boolean> {
  const out = await updateReservedJson(siteId, RESERVED_NAMES.copiedFrom, (cur) => addToCopied(normalizeCopied(cur), from, new Date().toISOString(), prints, media), by);
  return !!out;
}

/** "Keep them as they are": the studio has looked, and the copied words and
 *  photos may publish. Null when there is no record to keep. */
export async function keepCopied(siteId: string, by: string): Promise<CopiedRecord | null> {
  if (!(await readCopied(siteId))) return null;   // nothing to keep: never write an empty record
  const out = await updateReservedJson(siteId, RESERVED_NAMES.copiedFrom, (cur) => {
    const rec = normalizeCopied(cur);
    return rec ? { ...rec, kept: true } : cur;
  }, by);
  return normalizeCopied(out);
}

/** The one thing to finish before publishing while copied words or photos are
 *  untouched (routes/room.ts and routes/publish.ts), or null. A failed read is
 *  no record: the check never blocks a site it can't read. */
export async function copiedBlockerFor(siteId: string, content: unknown, mediaManifest: MediaManifestEntry[] | null | undefined): Promise<{ field: string; message: string } | null> {
  const rec = await readCopied(siteId).catch(() => null);
  if (!rec || rec.kept) return null;
  return copiedBlocker(copiedLeftovers(rec, content, (mediaManifest || []).map((m) => m.media_id)));
}
