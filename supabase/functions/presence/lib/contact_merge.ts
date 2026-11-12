// ── Import updates, their Undo, and merging two records (sales items 86 + 105) ─
// Pure rules the contact routes share (routes/contacts_more.ts, routes/sales.ts):
//   importChanges  — what an import row changes on someone already there: only the
//                    fields the file fills in, never blanking one; tags are added to
//   undoPatch      — putting an updated person back, field by field, but only where
//                    nobody has changed it again since the import
//   mergeValues    — folding a duplicate into the record you keep: the values you
//                    picked, tags and your own fields from both, notes from both
import { normalizeTags, normalizeAddress, addressLine, MAX_TAGS } from './contact_fields.ts';

/** The fields an import can fill and a merge lets you pick between. */
export const IMPORT_FIELDS = ['name', 'phone', 'company', 'job_title', 'phone2', 'address', 'found_via', 'notes', 'tags'] as const;
export const MERGE_PICKS = ['name', 'email', 'phone', 'phone2', 'company', 'job_title', 'address', 'found_via'] as const;
export type MergePick = typeof MERGE_PICKS[number];

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '');
const empty = (v: unknown) => v == null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v as object).length);

/** What an import row changes on a contact already there: `patch` to write and
 *  `changes` ({ field: { before, after } }) to keep for Undo. A field the file
 *  leaves empty never blanks one that has a value; tags are added, not replaced;
 *  notes are added under the ones there; your own fields fill in key by key. */
export function importChanges(existing: Record<string, any>, incoming: Record<string, any>): { patch: Record<string, unknown>; changes: Record<string, { before: unknown; after: unknown }> } {
  const patch: Record<string, unknown> = {}, changes: Record<string, { before: unknown; after: unknown }> = {};
  const put = (k: string, after: unknown) => { const before = existing[k] ?? (k === 'tags' ? [] : k === 'address' || k === 'custom' ? {} : ''); if (same(before, after)) return; patch[k] = after; changes[k] = { before, after }; };
  for (const k of ['name', 'phone', 'company', 'job_title', 'phone2', 'found_via']) {
    const v = incoming[k];
    if (typeof v === 'string' && v.trim()) put(k, v.trim());
  }
  if (incoming.address !== undefined) { const a = normalizeAddress(incoming.address); if (!empty(a)) put('address', a); }
  if (incoming.tags !== undefined) {
    const add = normalizeTags(incoming.tags);
    if (add.length) put('tags', normalizeTags([...(Array.isArray(existing.tags) ? existing.tags : []), ...add]));
  }
  if (typeof incoming.notes === 'string' && incoming.notes.trim()) {
    const cur = String(existing.notes || '');
    const add = incoming.notes.trim();
    if (!cur.includes(add)) put('notes', (cur.trim() ? cur.trim() + '\n\n' : '') + add);
  }
  if (incoming.custom && typeof incoming.custom === 'object') {
    const cur = existing.custom && typeof existing.custom === 'object' ? existing.custom : {};
    const next: Record<string, unknown> = { ...cur };
    for (const [k, v] of Object.entries(incoming.custom)) if (v != null && String(v).trim() !== '') next[k] = v;
    put('custom', next);
  }
  return { patch, changes };
}

/** Putting an updated person back as they were before an import: each field the
 *  import changed goes back, unless it has been changed again since (then it is
 *  left alone and counted). */
export function undoPatch(current: Record<string, any>, changes: Record<string, { before: unknown; after: unknown }>): { patch: Record<string, unknown>; kept: string[] } {
  const patch: Record<string, unknown> = {}, kept: string[] = [];
  for (const [k, c] of Object.entries(changes || {})) {
    if (!c || typeof c !== 'object') continue;
    if (same(current[k] ?? (k === 'tags' ? [] : k === 'address' || k === 'custom' ? {} : ''), c.after)) patch[k] = c.before;
    else kept.push(k);
  }
  return { patch, kept };
}

/** A note line naming an email the merged-away record wrote from, so it stays findable. */
export const otherEmailNote = (email: string) => `Also wrote from ${email}`;

/** Joined notes stop at this, like the notes box itself (routes/sales.ts keeps a contact's notes to 2,000). */
export const MERGE_NOTES_MAX = 2000;
/** Text cut to `max` characters at a word break, with "…" to show it was cut; how much went. */
function cutNotes(text: string, max: number): { text: string; cut: number } {
  if (text.length <= max) return { text, cut: 0 };
  let end = max - 1;
  const space = text.lastIndexOf(' ', end), nl = text.lastIndexOf('\n', end);
  const br = Math.max(space, nl);
  if (br > max - 60) end = br;
  const kept = text.slice(0, end).replace(/\s+$/, '');
  return { text: kept + '…', cut: text.length - kept.length };
}

/** Folding `other` into `keep`. `pick` says, per field, whether the other record's
 *  value wins ('other'); a field the kept record has empty takes the other's
 *  anyway. Tags and your own fields come from both, notes from both, and an email
 *  that isn't kept goes into the notes. Sales item 121: that email line goes FIRST,
 *  so a cut never loses it, and `notesCut` says how many characters didn't fit
 *  (0 when nothing was cut; the full notes stay on the record set aside, for Undo). */
export function mergeValues(keep: Record<string, any>, other: Record<string, any>, pick: Partial<Record<MergePick, 'keep' | 'other'>> = {}): { values: Record<string, unknown>; conflict: string | null; notesCut: number } {
  const values: Record<string, unknown> = {};
  for (const k of MERGE_PICKS) {
    const mine = k === 'address' ? normalizeAddress(keep.address) : keep[k], theirs = k === 'address' ? normalizeAddress(other.address) : other[k];
    values[k] = (pick[k] === 'other' && !empty(theirs)) || empty(mine) ? (empty(theirs) ? mine ?? '' : theirs) : mine;
  }
  values.tags = normalizeTags([...(Array.isArray(keep.tags) ? keep.tags : []), ...(Array.isArray(other.tags) ? other.tags : [])]).slice(0, MAX_TAGS);
  const ck = keep.custom && typeof keep.custom === 'object' ? keep.custom : {}, co = other.custom && typeof other.custom === 'object' ? other.custom : {};
  const custom: Record<string, unknown> = { ...co };
  for (const [k, v] of Object.entries(ck)) if (v != null && String(v) !== '') custom[k] = v;
  values.custom = custom;
  const notes: string[] = [];
  const kn = String(keep.notes || '').trim(), on = String(other.notes || '').trim();
  if (kn) notes.push(kn);
  if (on && on !== kn) notes.push(on);
  const lostEmail = String(other.email || '').trim() && String(values.email || '').toLowerCase() !== String(other.email || '').toLowerCase() ? String(other.email) : '';
  const lostKept = String(keep.email || '').trim() && String(values.email || '').toLowerCase() !== String(keep.email || '').toLowerCase() ? String(keep.email) : '';
  const emailLines: string[] = [];
  for (const e of [lostEmail, lostKept]) if (e && !notes.join('\n').includes(otherEmailNote(e)) && !emailLines.includes(otherEmailNote(e))) emailLines.push(otherEmailNote(e));
  const joined = cutNotes([...emailLines, ...notes].join('\n\n'), MERGE_NOTES_MAX);
  values.notes = joined.text;
  // a person can belong to one customer: two different customers is a merge to refuse
  const kc = keep.client_id ? String(keep.client_id) : '', oc = other.client_id ? String(other.client_id) : '';
  if (kc && oc && kc !== oc) return { values, conflict: 'different_customers', notesCut: joined.cut };
  values.client_id = kc || oc || null;
  return { values, conflict: null, notesCut: joined.cut };
}

/** The values a merge view shows for one record, one line each. */
export function mergeShow(c: Record<string, any>): Record<MergePick, string> {
  return {
    name: String(c.name || ''), email: String(c.email || ''), phone: String(c.phone || ''), phone2: String(c.phone2 || ''),
    company: String(c.company || ''), job_title: String(c.job_title || ''), address: addressLine(c.address), found_via: String(c.found_via || ''),
  };
}
