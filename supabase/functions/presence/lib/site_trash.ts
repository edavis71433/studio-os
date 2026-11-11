// ── The trash for sites, and deleted pages kept 30 days (builder list item 154) ──
// Wix's way, on our own rows: "Move to trash" on a site's menu takes it offline and
// out of every list; for TRASH_DAYS one press restores it (still offline until it is
// published or brought back online), then it is deleted for good (ops/site_trash.ts).
// Deleted pages: every page that leaves a draft is kept PAGE_KEEP_DAYS by a database
// trigger (migration 0154), and Versions lists them with Put back
// (routes/deleted_pages.ts). Pure: the routes and the job do the reads and writes.

export const TRASH_DAYS = 90;
export const PAGE_KEEP_DAYS = 30;
const DAY = 86_400_000;

/** When something put away at `at` goes for good, `days` later. Null for no date. Pure. */
export function goesAt(at: string | null | undefined, days: number): string | null {
  const t = Date.parse(String(at || ''));
  return Number.isFinite(t) ? new Date(t + days * DAY).toISOString() : null;
}

/** Whole days left before `at + days`, never below 0. Null for no date. Pure. */
export function daysLeft(nowIso: string, at: string | null | undefined, days: number): number | null {
  const end = goesAt(at, days);
  if (!end) return null;
  return Math.max(0, Math.ceil((Date.parse(end) - Date.parse(nowIso)) / DAY));
}

/** Is this trashed site due to be deleted for good? Pure. */
export function trashDue(nowIso: string, trashedAt: string | null | undefined): boolean {
  const end = goesAt(trashedAt, TRASH_DAYS);
  return !!end && Date.parse(end) <= Date.parse(nowIso);
}

export interface TrashLink { site_id: string; trashed_at?: string | null; trashed_by?: string | null; trashed_was_live?: boolean | null }
/** The Trash at the foot of Sites: newest first, each with its day of going and
 *  the days left. Pure. */
export function buildTrash(links: TrashLink[], names: Record<string, string>, nowIso: string) {
  return links
    .filter((l) => l && l.site_id && l.trashed_at)
    .map((l) => ({
      site_id: l.site_id, name: names[l.site_id] || '',
      trashed_at: String(l.trashed_at), trashed_by: String(l.trashed_by || ''),
      was_live: l.trashed_was_live === true,
      goes_at: goesAt(l.trashed_at, TRASH_DAYS), days_left: daysLeft(nowIso, l.trashed_at, TRASH_DAYS),
    }))
    .sort((a, b) => (a.trashed_at < b.trashed_at ? 1 : -1));
}

export interface DeletedPageRow { id: string; slug: string; title?: string | null; page?: unknown; deleted_at: string }
/** Versions' list of recently deleted pages: within PAGE_KEEP_DAYS, newest first,
 *  each with how many sections it held and the days left. Pure. */
export function deletedPagesList(rows: DeletedPageRow[], nowIso: string) {
  return rows
    .filter((r) => r && r.id && (daysLeft(nowIso, r.deleted_at, PAGE_KEEP_DAYS) ?? 0) > 0)
    .map((r) => {
      const p = (r.page && typeof r.page === 'object' ? r.page : {}) as { blocks?: unknown; title?: unknown };
      return {
        id: r.id, slug: r.slug, title: String(r.title || p.title || r.slug).slice(0, 120),
        deleted_at: r.deleted_at, sections: Array.isArray(p.blocks) ? p.blocks.length : 0,
        days_left: daysLeft(nowIso, r.deleted_at, PAGE_KEEP_DAYS),
      };
    })
    .sort((a, b) => (a.deleted_at < b.deleted_at ? 1 : -1));
}

/** The address a page comes back under: its own, or the first free "-2", "-3"… Pure. */
export function freeSlug(slug: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((s) => String(s)));
  const base = String(slug || 'page').slice(0, 36) || 'page';
  if (!used.has(base)) return base;
  for (let n = 2; n < 100; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
  return `${base}-${Date.now().toString(36).slice(-4)}`;
}
