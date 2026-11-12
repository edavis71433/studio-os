// ── Imports you can undo, and two records for one person merged (sales items 86 + 105) ─
//   POST /sales/contacts/imports              — start an import: { file_name, on_existing: 'skip'|'update' };
//                                               with { rows } it IS the import, the whole file in one go (item 122)
//   GET  /sales/contacts/imports              — the newest import of the last day (for its Undo strip)
//   POST /sales/contacts/imports/:id/undo     — take the added people off, put the updated ones back
//   POST /sales/contacts/:id/merge            — fold { from } into :id, keeping what { pick } says
//   POST /sales/contacts/:id/unmerge          — undo a merge (:id is the record that was merged away)
// Sales item 122: Contacts sends the whole file in one request (rows, up to 500), and the
// server reads who is already here a hundred emails at a time, adds the new people a hundred
// a request and notes the lot for Undo in one write: a 500-row file used to be 500 requests,
// each paying the full sign-in checks. An older page can still send each row to POST
// /sales/contacts with the import's id; that route asks importUpdate() here what to do with
// someone already there. Undo and merge remove a contact, so a team seat needs "delete" for
// them (lib/site_roles.ts). Every read and write is pinned to the caller's site.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';
import { UUID_RE } from '../lib/uuid.ts';
import { importChanges, undoPatch, mergeValues, mergeShow, MERGE_PICKS, type MergePick } from '../lib/contact_merge.ts';
import { normEmail, emailMatch, emailsMatch, isUniqueViolation } from '../lib/contact_email.ts';
import { CONTACT_MORE_COLS } from '../lib/contact_fields.ts';
import { missingInsertColumns } from '../lib/inbound_email.ts';
import { contactIn, newContactRow, importIncoming, loadContactFieldDefs, type ContactIn } from '../lib/contact_row.ts';

const rows = (r: { json?: unknown }) => (Array.isArray((r as any).json) ? (r as any).json : []) as any[];
const nowIso = () => new Date().toISOString();
const who = (p: Principal) => p.email || p.userId || 'system';
/** An import can be undone for a day. */
export const IMPORT_UNDO_HOURS = 24;
/** A merge can be undone for thirty days. */
export const MERGE_UNDO_DAYS = 30;
const needsUpdate = (cors: Record<string, string>) => json({ error: 'needs_database_update', message: 'This needs a quick database update before it works (APPLY-0168).' }, 409, cors);
const tableMissing = (r: { ok: boolean; status?: number; json?: unknown; text?: string }) => !r.ok && (r.status === 404 || /PGRST205|42P01|does not exist|schema cache/i.test(String((r.json as any)?.code || '') + ' ' + String((r.json as any)?.message || '') + ' ' + String(r.text || '')));
const CONTACT_SEL = `id,name,email,phone,company,notes,custom,found_via,client_id,deleted_at,${CONTACT_MORE_COLS.join(',')}`;
/** One import takes this many people (the page says so before it sends; the rest go in a second file). */
export const IMPORT_MAX_ROWS = 500;
/** `fn` over `items`, `n` at a time: a few hundred small writes without opening a few hundred at once. */
async function inBatches<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += n) await Promise.all(items.slice(i, i + n).map((x) => fn(x).catch(() => {})));
}

// ═══ IMPORTS ═══
export async function handleContactImports(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  if (req.method === 'POST') {
    let b: any = {}; try { b = await req.json(); } catch { /* defaults below */ }
    if (Array.isArray(b.rows)) return importWholeFile(site, principal, b, cors);   // item 122: the whole file in one go
    const row = { site_id: site.id, file_name: String(b.file_name ?? '').replace(/[\u0000-\u001F]/g, '').trim().slice(0, 160), started_by: who(principal), on_existing: b.on_existing === 'update' ? 'update' : 'skip' };
    const r = await svc('presence_contact_imports', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) });
    if (tableMissing(r)) return json({ data: { id: null, undo: false }, message: 'The import runs; Undo needs a quick database update (APPLY-0168).' }, 200, cors);
    if (!r.ok || !rows(r)[0]) return json({ error: 'write_failed', message: 'The import couldn’t start — please try again.' }, 502, cors);
    return json({ data: { id: rows(r)[0].id, undo: true } }, 201, cors);
  }
  if (req.method === 'GET') {
    const since = new Date(Date.now() - IMPORT_UNDO_HOURS * 3600_000).toISOString();
    const r = await svc(`presence_contact_imports?site_id=eq.${site.id}&created_at=gte.${encodeURIComponent(since)}&select=id,file_name,on_existing,created_at,undone_at&order=created_at.desc&limit=1`);
    if (tableMissing(r)) return json({ data: null }, 200, cors);
    if (!r.ok) return json({ error: 'read_failed', message: 'We couldn’t check your last import just now.' }, 502, cors);
    const imp = rows(r)[0];
    if (!imp) return json({ data: null }, 200, cors);
    const rr = await svc(`presence_contact_import_rows?import_id=eq.${imp.id}&site_id=eq.${site.id}&select=action&limit=5000`);
    const acts = rows(rr).map((x: any) => x.action);
    return json({ data: { ...imp, added: acts.filter((a) => a === 'added').length, updated: acts.filter((a) => a === 'updated').length, undo_until: new Date(Date.parse(imp.created_at) + IMPORT_UNDO_HOURS * 3600_000).toISOString() } }, 200, cors);
  }
  return json({ error: 'method_not_allowed' }, 405, cors);
}

/** The import a row belongs to, when it is this site's, live and less than a day old. */
export async function liveImport(siteId: string, importId: unknown): Promise<{ id: string; on_existing: 'skip' | 'update' } | null> {
  const id = String(importId ?? '');
  if (!UUID_RE.test(id)) return null;
  const r = await svc(`presence_contact_imports?id=eq.${id}&site_id=eq.${siteId}&undone_at=is.null&select=id,on_existing,created_at&limit=1`).catch(() => null);
  const imp = r ? rows(r)[0] : null;
  if (!imp || Date.now() - Date.parse(imp.created_at) > IMPORT_UNDO_HOURS * 3600_000) return null;
  return { id: imp.id, on_existing: imp.on_existing === 'update' ? 'update' : 'skip' };
}

// ═══ THE WHOLE FILE IN ONE GO (sales item 122) ═══
// What each row did, counted the way the page's summary reads them: added, updated,
// existed (already here, left as they were, or a second row for the same email), failed.
async function importWholeFile(site: SiteRow, principal: Principal, b: any, cors: Record<string, string>): Promise<Response> {
  const asked: unknown[] = b.rows;
  if (!asked.length) return json({ error: 'validation', message: 'That file has no one to import.' }, 422, cors);
  if (asked.length > IMPORT_MAX_ROWS) return json({ error: 'too_many_rows', message: `An import takes ${IMPORT_MAX_ROWS} people at a time. Put the rest in a second file.` }, 413, cors);
  const onExisting: 'skip' | 'update' = b.on_existing === 'update' ? 'update' : 'skip';
  // the import itself, for Undo; before APPLY-0168 the people still go in, without an Undo
  const ir = await svc('presence_contact_imports', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ site_id: site.id, file_name: String(b.file_name ?? '').replace(/[\u0000-\u001F]/g, '').trim().slice(0, 160), started_by: who(principal), on_existing: onExisting }) });
  if (!ir.ok && !tableMissing(ir)) return json({ error: 'write_failed', message: 'The import couldn’t start — please try again.' }, 502, cors);
  const importId: string | null = ir.ok && rows(ir)[0] ? String(rows(ir)[0].id) : null;
  const counts = { added: 0, updated: 0, existed: 0, failed: 0 };
  const notes: Array<{ contact_id: string; action: 'added' | 'updated'; changes: Record<string, unknown> }> = [];
  const defs = asked.some((x: any) => x && typeof x.custom === 'object' && x.custom) ? await loadContactFieldDefs(site.id) : [];
  const people = asked.map((x) => contactIn(x, defs));
  counts.failed += people.filter((c) => !c).length;   // neither a name nor an email: nothing to keep
  // who is already here, a hundred emails a read, whatever their capitals
  const emails = [...new Set(people.filter((c): c is ContactIn => !!c && !!c.email).map((c) => c.email))];
  const here = new Map<string, any>();
  for (let i = 0; i < emails.length; i += 100) {
    const chunk = emails.slice(i, i + 100);
    let r = await svc(`presence_contacts?site_id=eq.${site.id}&deleted_at=is.null&${emailsMatch(chunk)}&select=${CONTACT_SEL}&limit=1000`);
    if (!r.ok && missingInsertColumns(r.json, r.text, [...CONTACT_MORE_COLS]).length) r = await svc(`presence_contacts?site_id=eq.${site.id}&deleted_at=is.null&${emailsMatch(chunk)}&select=id,name,email,phone,company,notes,custom,found_via,client_id,deleted_at&limit=1000`);
    if (!r.ok) return json({ error: 'read_failed', message: 'We couldn’t check who is already in your contacts, so nothing was imported. Please try again.' }, 502, cors);
    for (const c of rows(r)) here.set(normEmail(c.email), c);
  }
  // what each row does, in the file's order: a second row for an email already seen is the same person
  const seen = new Set<string>(), toAdd: ContactIn[] = [], toUpdate: Array<{ full: any; c: ContactIn }> = [];
  for (const c of people) {
    if (!c) continue;
    if (c.email && seen.has(c.email)) { counts.existed++; continue; }
    if (c.email) seen.add(c.email);
    const full = c.email ? here.get(c.email) : null;
    if (!full) toAdd.push(c);
    else if (onExisting === 'update') toUpdate.push({ full, c });
    else counts.existed++;
  }
  // the new people, a hundred a request; a request the database refuses goes again one by one
  for (let i = 0; i < toAdd.length; i += 100) {
    const chunk = toAdd.slice(i, i + 100);
    const made = await insertMany(site.id, chunk);
    if (made) { counts.added += made.length; for (const c of made) notes.push({ contact_id: String(c.id), action: 'added', changes: {} }); continue; }
    await inBatches(chunk, 8, async (c) => {
      const one = await insertMany(site.id, [c]);
      if (one && one[0]) { counts.added++; notes.push({ contact_id: String(one[0].id), action: 'added', changes: {} }); return; }
      // two rows for one new email in one file can't reach here (the plan above); someone added meanwhile can
      const again = c.email ? rows(await svc(`presence_contacts?site_id=eq.${site.id}&${emailMatch(c.email)}&deleted_at=is.null&select=id&limit=1`))[0] : null;
      if (again) counts.existed++; else counts.failed++;
    });
  }
  // the people already here, when the file updates them: each changes only what the file fills in
  await inBatches(toUpdate, 8, async ({ full, c }) => {
    const u = await applyImportUpdate(site.id, full, importIncoming(c));
    if (!u) { counts.failed++; return; }
    if (!u.updated) { counts.existed++; return; }
    counts.updated++; notes.push({ contact_id: String(full.id), action: 'updated', changes: u.changes });
  });
  // what the import did, for its Undo: one write for the lot (best-effort, like each row's note before)
  if (importId) for (let i = 0; i < notes.length; i += 500) {
    await svc('presence_contact_import_rows', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(notes.slice(i, i + 500).map((x) => ({ import_id: importId, site_id: site.id, ...x }))) }).catch(() => null);
  }
  return json({ data: { id: importId, undo: !!importId, counts } }, 201, cors);
}

/** New people in one insert. Every row names the same columns (absent ones take the column's
 *  default, as a one-person insert does); a newer optional column the database doesn't have yet
 *  is left out and the rest go in. null when the database refused the lot. */
async function insertMany(siteId: string, people: ContactIn[]): Promise<any[] | null> {
  let list = people.map((c) => newContactRow(siteId, c));
  const OPTIONAL = ['found_via', 'custom', ...CONTACT_MORE_COLS];
  for (let n = 0; n < 3; n++) {
    const cols = [...new Set(list.flatMap((r) => Object.keys(r)))];
    const r = await svc(`presence_contacts?columns=${cols.join(',')}`, { method: 'POST', headers: { Prefer: 'return=representation,missing=default' }, body: JSON.stringify(list) });
    if (r.ok) return rows(r);
    if (isUniqueViolation(r)) return null;
    const named = missingInsertColumns(r.json, r.text, OPTIONAL.filter((c) => cols.includes(c)));
    // the four newer fields arrive together (APPLY-0166): one missing means all four are
    const missing = named.some((c) => (CONTACT_MORE_COLS as readonly string[]).includes(c)) ? [...new Set([...named, ...CONTACT_MORE_COLS])] : named;
    if (!missing.length) return null;
    list = list.map((row) => { const o = { ...row }; for (const c of missing) delete o[c]; return o; });
  }
  return null;
}

/** Note what an import did to one person (best-effort: a note that fails only costs that row's Undo). */
export async function noteImportRow(siteId: string, importId: string, contactId: string, action: 'added' | 'updated', changes: Record<string, unknown> = {}): Promise<void> {
  await svc('presence_contact_import_rows', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ import_id: importId, site_id: siteId, contact_id: contactId, action, changes }) }).catch(() => null);
}

/** Someone already here, in an import that updates: fill in what the file has (never
 *  blanking a field), note the before and after, answer the updated row. */
export async function importUpdate(siteId: string, importId: string, existing: Record<string, any>, incoming: Record<string, any>): Promise<{ row: any; updated: boolean } | null> {
  const full = rows(await svc(`presence_contacts?id=eq.${existing.id}&site_id=eq.${siteId}&deleted_at=is.null&select=${CONTACT_SEL}&limit=1`))[0];
  if (!full) return null;
  const u = await applyImportUpdate(siteId, full, incoming);
  if (!u) return null;
  if (!u.updated) return { row: existing, updated: false };
  await noteImportRow(siteId, importId, full.id, 'updated', u.changes);
  return { row: u.row, updated: true };
}

/** The update itself, for someone read in full already: the fields the file fills in (never
 *  blanking one), the before and after for Undo. Nothing written when nothing changes. */
export async function applyImportUpdate(siteId: string, full: Record<string, any>, incoming: Record<string, any>): Promise<{ row: any; updated: boolean; changes: Record<string, unknown> } | null> {
  const { patch, changes } = importChanges(full, incoming);
  if (!Object.keys(patch).length) return { row: full, updated: false, changes: {} };
  let up = await svc(`presence_contacts?id=eq.${full.id}&site_id=eq.${siteId}&select=id,name,email,phone,company`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
  const named = up.ok ? [] : missingInsertColumns(up.json, up.text, Object.keys(patch));
  // the four newer fields arrive together (APPLY-0166): one missing means all four are
  const missing = named.some((c) => (CONTACT_MORE_COLS as readonly string[]).includes(c)) ? [...new Set([...named, ...CONTACT_MORE_COLS])].filter((c) => c in patch) : named;
  if (missing.length) {   // before APPLY-0166: the newer fields wait, the rest goes in
    for (const k of missing) { delete patch[k]; delete changes[k]; }
    if (!Object.keys(patch).length) return { row: full, updated: false, changes: {} };
    up = await svc(`presence_contacts?id=eq.${full.id}&site_id=eq.${siteId}&select=id,name,email,phone,company`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
  }
  if (!up.ok || !rows(up)[0]) return null;
  return { row: rows(up)[0], updated: true, changes };
}

export async function handleContactImportUndo(_req: Request, site: SiteRow, principal: Principal, importId: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(importId)) return json({ error: 'bad_request' }, 400, cors);
  const ir = await svc(`presence_contact_imports?id=eq.${importId}&site_id=eq.${site.id}&select=id,created_at,undone_at&limit=1`);
  if (tableMissing(ir)) return needsUpdate(cors);
  const imp = rows(ir)[0];
  if (!imp) return json({ error: 'not_found', message: 'That import isn’t one of yours.' }, 404, cors);
  if (imp.undone_at) return json({ data: { already: true, removed: 0, restored: 0, kept: 0 } }, 200, cors);
  if (Date.now() - Date.parse(imp.created_at) > IMPORT_UNDO_HOURS * 3600_000) return json({ error: 'too_old', message: 'An import can be undone for a day after it ran. This one is older.' }, 409, cors);
  // claim it first, so two Undo presses can't both run
  const claim = await svc(`presence_contact_imports?id=eq.${importId}&site_id=eq.${site.id}&undone_at=is.null&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ undone_at: nowIso(), undone_by: who(principal) }) });
  if (!claim.ok) return json({ error: 'write_failed', message: 'Undo didn’t start — please try again.' }, 502, cors);
  if (!rows(claim)[0]) return json({ data: { already: true, removed: 0, restored: 0, kept: 0 } }, 200, cors);
  const list = rows(await svc(`presence_contact_import_rows?import_id=eq.${importId}&site_id=eq.${site.id}&select=contact_id,action,changes&limit=5000`));
  let removed = 0, restored = 0, kept = 0, failed = 0;
  // added: taken off again, unless they have a deal now (then they stay, and are counted)
  const added = list.filter((x: any) => x.action === 'added').map((x: any) => String(x.contact_id));
  for (let i = 0; i < added.length; i += 100) {
    const ids = added.slice(i, i + 100);
    const busy = new Set(rows(await svc(`presence_deals?site_id=eq.${site.id}&contact_id=in.(${ids.join(',')})&deleted_at=is.null&select=contact_id&limit=1000`)).map((d: any) => String(d.contact_id)));
    const go = ids.filter((id) => !busy.has(id));
    kept += ids.length - go.length;
    if (!go.length) continue;
    const del = await svc(`presence_contacts?site_id=eq.${site.id}&id=in.(${go.join(',')})&deleted_at=is.null&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ deleted_at: nowIso() }) });
    if (del.ok) removed += rows(del).length; else failed += go.length;
  }
  // updated: each field back as it was, where nobody has changed it since. Item 122: the people
  // are read back a hundred at a time and put back eight at a time — one by one, a big
  // "update" import's Undo could run out of time halfway.
  const updated = list.filter((y: any) => y.action === 'updated' && UUID_RE.test(String(y.contact_id)));
  const now = new Map<string, any>();
  for (let i = 0; i < updated.length; i += 100) {
    const ids = [...new Set(updated.slice(i, i + 100).map((x: any) => String(x.contact_id)))];
    for (const c of rows(await svc(`presence_contacts?site_id=eq.${site.id}&id=in.(${ids.join(',')})&deleted_at=is.null&select=${CONTACT_SEL}&limit=100`))) now.set(String(c.id), c);
  }
  await inBatches(updated, 8, async (x: any) => {
    const cur = now.get(String(x.contact_id));
    if (!cur) { kept++; return; }
    const { patch, kept: changedSince } = undoPatch(cur, x.changes || {});
    if (changedSince.length) kept++;
    if (!Object.keys(patch).length) return;
    const up = await svc(`presence_contacts?id=eq.${cur.id}&site_id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
    if (up.ok) restored++; else failed++;
  });
  return json({ data: { removed, restored, kept, failed } }, 200, cors);
}

// ═══ MERGE ═══
export async function handleContactMerge(req: Request, site: SiteRow, principal: Principal, keepId: string, cors: Record<string, string>): Promise<Response> {
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const otherId = String(b.from ?? '');
  if (!UUID_RE.test(keepId) || !UUID_RE.test(otherId)) return json({ error: 'bad_request' }, 400, cors);
  if (keepId === otherId) return json({ error: 'same_person', message: 'Pick two different records to merge.' }, 400, cors);
  const one = (id: string) => svc(`presence_contacts?id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=${CONTACT_SEL}&limit=1`);
  const [kr, or] = await Promise.all([one(keepId), one(otherId)]);
  if ([kr, or].some((r) => !r.ok && missingInsertColumns(r.json, r.text, [...CONTACT_MORE_COLS]).length)) return json({ error: 'needs_database_update', message: 'Merging needs a quick database update first (APPLY-0166 and APPLY-0168).' }, 409, cors);
  if (!kr.ok || !or.ok) return json({ error: 'read_failed', message: 'We couldn’t read those two records just now.' }, 502, cors);
  const keep = rows(kr)[0], other = rows(or)[0];
  if (!keep || !other) return json({ error: 'not_found', message: 'One of those records is no longer in your contacts — refresh and try again.' }, 404, cors);
  // the dry run: what each record holds and what would move, written nothing
  const pick: Partial<Record<MergePick, 'keep' | 'other'>> = {};
  for (const k of MERGE_PICKS) if (b.pick && (b.pick[k] === 'other' || b.pick[k] === 'keep')) pick[k] = b.pick[k];
  const { values, conflict } = mergeValues(keep, other, pick);
  if (conflict === 'different_customers') return json({ error: 'different_customers', message: 'These two records belong to two different customers, so they can’t be merged.' }, 409, cors);
  const [dealsR, apptR, revR] = await Promise.all([
    svc(`presence_deals?site_id=eq.${site.id}&contact_id=eq.${otherId}&deleted_at=is.null&select=id&limit=500`),
    svc(`presence_appointments?site_id=eq.${site.id}&contact_id=eq.${otherId}&select=id&limit=500`),
    svc(`presence_reviews?site_id=eq.${site.id}&contact_id=eq.${otherId}&select=id&limit=500`),
  ]);
  const moved = { deals: rows(dealsR).map((x: any) => x.id), appointments: rows(apptR).map((x: any) => x.id), reviews: rows(revR).map((x: any) => x.id) };
  if (b.confirm !== true) {
    return json({ data: { dry_run: true, keep: { id: keep.id, ...mergeShow(keep), tags: keep.tags || [] }, other: { id: other.id, ...mergeShow(other), tags: other.tags || [] },
      result: { ...mergeShow(values), tags: values.tags }, moves: { deals: moved.deals.length, bookings: moved.appointments.length, reviews: moved.reviews.length }, partial: !dealsR.ok || !apptR.ok || !revR.ok } }, 200, cors);
  }
  if (!dealsR.ok) return json({ error: 'read_failed', message: 'We couldn’t check their deals just now, so nothing was merged.' }, 502, cors);
  // 1) the record merged away keeps what it takes to undo this, and steps aside (its email frees up)
  const before: Record<string, unknown> = {};
  for (const k of [...MERGE_PICKS, 'tags', 'custom', 'notes', 'client_id']) before[k] = keep[k] ?? null;
  const record = { at: nowIso(), by: who(principal), into: keepId, moved, keep_before: before, keep_after: values };
  const away = await svc(`presence_contacts?id=eq.${otherId}&site_id=eq.${site.id}&deleted_at=is.null&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ deleted_at: nowIso(), merged_into: keepId, merge_record: record }) });
  if (!away.ok && missingInsertColumns(away.json, away.text, ['merged_into', 'merge_record']).length) return needsUpdate(cors);
  if (!away.ok || !rows(away)[0]) return json({ error: 'write_failed', message: 'Nothing was merged — the change didn’t reach the database. Please try again.' }, 502, cors);
  // 2) their deals, bookings and reviews move to the record you keep
  const move = async (table: string, ids: string[]) => ids.length ? (await svc(`${table}?site_id=eq.${site.id}&contact_id=eq.${otherId}&id=in.(${ids.join(',')})`, { method: 'PATCH', body: JSON.stringify({ contact_id: keepId }) })).ok : true;
  const mv = await Promise.all([move('presence_deals', moved.deals), move('presence_appointments', moved.appointments), move('presence_reviews', moved.reviews)]);
  // 3) the kept record takes the picked values, both sets of tags and the notes
  const patch: Record<string, unknown> = { ...values };
  const up = await svc(`presence_contacts?id=eq.${keepId}&site_id=eq.${site.id}&select=id,name,email`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
  if (!up.ok || !mv.every(Boolean)) {
    // put everything back where it was; say plainly that it didn't happen
    await unmergeRecord(site.id, otherId, record).catch(() => null);
    return json({ error: 'write_failed', message: 'Nothing was merged — part of it didn’t save, so everything was put back. Please try again.' }, 502, cors);
  }
  return json({ data: { merged: true, keep: rows(up)[0], merged_away: { id: otherId, name: String(other.name || other.email || 'Contact') }, moved: { deals: moved.deals.length, bookings: moved.appointments.length, reviews: moved.reviews.length } } }, 200, cors);
}

/** Undo a merge from its record: the kept record's fields go back where nobody changed
 *  them since (first, so an email it took from the other record is free again), the
 *  merged-away record returns, and what moved goes back (only what still points at the
 *  kept record). */
async function unmergeRecord(siteId: string, awayId: string, record: any): Promise<boolean> {
  const keepId = String(record?.into || '');
  if (!UUID_RE.test(keepId)) return false;
  const cur = rows(await svc(`presence_contacts?id=eq.${keepId}&site_id=eq.${siteId}&select=${CONTACT_SEL}&limit=1`))[0];
  if (cur) {
    const changes: Record<string, { before: unknown; after: unknown }> = {};
    for (const [k, v] of Object.entries(record.keep_before || {})) changes[k] = { before: v, after: (record.keep_after || {})[k] };
    const { patch } = undoPatch(cur, changes);
    if (Object.keys(patch).length) await svc(`presence_contacts?id=eq.${keepId}&site_id=eq.${siteId}`, { method: 'PATCH', body: JSON.stringify(patch) });
  }
  const ret = await svc(`presence_contacts?id=eq.${awayId}&site_id=eq.${siteId}&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ deleted_at: null, merged_into: null, merge_record: null }) });
  if (!ret.ok || !rows(ret).length) return false;
  const back = (table: string, ids: unknown) => {
    const list = Array.isArray(ids) ? ids.map(String).filter((x) => UUID_RE.test(x)) : [];
    return list.length ? svc(`${table}?site_id=eq.${siteId}&contact_id=eq.${keepId}&id=in.(${list.join(',')})`, { method: 'PATCH', body: JSON.stringify({ contact_id: awayId }) }) : Promise.resolve(null);
  };
  await Promise.all([back('presence_deals', record?.moved?.deals), back('presence_appointments', record?.moved?.appointments), back('presence_reviews', record?.moved?.reviews)]);
  return true;
}

export async function handleContactUnmerge(_req: Request, site: SiteRow, _principal: Principal, awayId: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(awayId)) return json({ error: 'bad_request' }, 400, cors);
  const r = await svc(`presence_contacts?id=eq.${awayId}&site_id=eq.${site.id}&select=id,name,email,merged_into,merge_record&limit=1`);
  if (!r.ok && missingInsertColumns(r.json, r.text, ['merged_into', 'merge_record']).length) return needsUpdate(cors);
  const c = rows(r)[0];
  if (!c || !c.merged_into || !c.merge_record) return json({ error: 'not_found', message: 'That record wasn’t merged, or the merge was already undone.' }, 404, cors);
  if (Date.now() - Date.parse(String(c.merge_record.at || '')) > MERGE_UNDO_DAYS * 86400_000) return json({ error: 'too_old', message: `A merge can be undone for ${MERGE_UNDO_DAYS} days. This one is older.` }, 409, cors);
  const ok = await unmergeRecord(site.id, awayId, c.merge_record);
  if (!ok) return json({ error: 'write_failed', message: 'We couldn’t undo that merge just now — please try again.' }, 502, cors);
  return json({ data: { unmerged: true, id: awayId, name: String(c.name || c.email || 'Contact') } }, 200, cors);
}

/** Exported for the import route: someone already here by this email (whatever its capitals). */
export async function contactByEmail(siteId: string, email: string): Promise<any | null> {
  const e = normEmail(email);
  if (!e) return null;
  return rows(await svc(`presence_contacts?site_id=eq.${siteId}&${emailMatch(e)}&deleted_at=is.null&select=id,name,email,phone,company&limit=1`))[0] || null;
}
