// ── Closing an account removes the business's customers' details and uploads (builder item 205) ──
// Nov 12 review, finding 97: the privacy page says closing an account anonymises personal
// details, but a deletion scrubbed only the owner's own record and a few older tables; the
// business's contacts, enquiries, bookings, reviews and uploaded files stayed. When a
// deletion runs, after the cooling-off (commerce/deletion.ts), this clears each of the
// business's sites:
//   · every file it stored: the media library (<site>/…, its drafts of AI pictures with it),
//     what visitors sent with forms (forms/<site>/…) and the pictures on review notes
//     (comments/<site>/…). Files go first, so no file outlives the row that pointed to it;
//   · the people it held: enquiries, bookings, reviews, testimonials, to-dos and notes,
//     deals (their proposals, agreements, estimates and activity go with them), contacts
//     (their imports go with them), sent updates and who got them, notices that name
//     customers, review notes, saved lists and form answers, projects and support threads
//     (their messages, files and surveys go with them), notes about people, read marks,
//     devices, and the saved versions of the site (published reviews are baked into them);
//   · the media library's rows are marked deleted.
// Kept: invoices and their payments, as tax law asks (they hold no customer's name or
// address of their own: "Billed to" was read from the contact, which is gone), the
// publish and change history (no one's details), and the site row, marked deleting.
// Every step has to save. The first that doesn't stops the run with its name, the
// deletion stays pending, and the next run repeats them all: each is safe to repeat.
import { svc } from '../lib/db.ts';
import { BUCKET } from '../lib/media.ts';

const SB_URL = Deno.env.get('SUPABASE_URL') || '';
const SB_SERVICE = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

/** The tables cleared for a site, in an order the foreign keys allow (a parent after the
 *  rows that point at it with no action; cascades noted). All are keyed by site_id. */
export const ERASE_TABLES = [
  'presence_form_submissions', 'presence_appointments', 'presence_reviews', 'presence_testimonials',
  'presence_deal_tasks', 'presence_person_events',
  'presence_deals',             // and its proposals, agreements, estimates, recurring invoices and activity
  'presence_contact_imports',   // and its rows
  'presence_contacts',
  'presence_broadcasts',        // and who each went to
  'presence_plan_notices', 'presence_section_comments', 'presence_sales_templates',
  'presence_projects',          // and its milestones, tasks, messages, files, approvals and surveys
  'presence_support_requests',  // and its messages
  'presence_relationship_notes', 'presence_thread_reads', 'presence_activity_reads',
  'presence_push_subscriptions', 'presence_visual_plans', 'presence_scheduled_publishes',
  'presence_site_preview', 'presence_launches',   // they point at saved versions with no action, so they go first
  'presence_snapshots',
] as const;

/** The storage folders a site's files live in. */
export const eraseFolders = (siteId: string) => [siteId, `forms/${siteId}`, `comments/${siteId}`];

type Entry = { name: string; id: string | null };
export type EraseDeps = {
  list: (folder: string, offset: number) => Promise<Entry[] | null>;
  remove: (paths: string[]) => Promise<boolean>;
};
const PAGE = 1000;
export const eraseDeps: EraseDeps = {
  list: async (folder, offset) => {
    const r = await fetch(`${SB_URL}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST', headers: { Authorization: `Bearer ${SB_SERVICE}`, apikey: SB_SERVICE, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: folder, limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } }),
    }).catch(() => null);
    if (!r || !r.ok) { await r?.body?.cancel().catch(() => {}); return null; }
    const j = await r.json().catch(() => null);
    return Array.isArray(j) ? j.map((e: { name?: unknown; id?: unknown }) => ({ name: String(e?.name || ''), id: e?.id ? String(e.id) : null })) : null;
  },
  remove: async (paths) => {
    const r = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${SB_SERVICE}`, apikey: SB_SERVICE, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: paths }),
    }).catch(() => null);
    if (r) await r.body?.cancel().catch(() => {});
    return !!r?.ok;
  },
};

/** Every file under a folder, its sub-folders included; null when the store couldn't list it. */
async function filesUnder(folder: string, deps: EraseDeps, cap = 50_000): Promise<string[] | null> {
  const out: string[] = [];
  const queue = [folder];
  while (queue.length) {
    const at = queue.shift()!;
    for (let offset = 0; ; offset += PAGE) {
      const page = await deps.list(at, offset);
      if (!page) return null;
      for (const e of page) {
        if (!e.name) continue;
        if (e.id === null) queue.push(`${at}/${e.name}`);   // a folder
        else out.push(`${at}/${e.name}`);
      }
      if (out.length > cap) return null;
      if (page.length < PAGE) break;
    }
  }
  return out;
}

/** Clear one site's customers' details and files. ok, or the first step that didn't save. */
export async function eraseSiteData(siteId: string, deps: EraseDeps = eraseDeps): Promise<{ ok: true } | { ok: false; step: string }> {
  if (!/^[0-9a-f-]{36}$/.test(siteId)) return { ok: false, step: 'site id' };
  // 1. the files, first
  for (const folder of eraseFolders(siteId)) {
    const files = await filesUnder(folder, deps);
    if (!files) return { ok: false, step: `files in ${folder}` };
    for (let i = 0; i < files.length; i += 100) if (!(await deps.remove(files.slice(i, i + 100)))) return { ok: false, step: `files in ${folder}` };
  }
  // 2. the rows that held people
  for (const table of ERASE_TABLES) {
    const r = await svc(`${table}?site_id=eq.${siteId}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    if (!r.ok) return { ok: false, step: table };
  }
  // 3. the media library's rows: their files are gone
  const m = await svc(`presence_media?site_id=eq.${siteId}&deleted_at=is.null`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ deleted_at: new Date().toISOString() }) });
  if (!m.ok) return { ok: false, step: 'presence_media' };
  return { ok: true };
}
