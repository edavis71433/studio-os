// ── One person, one email, whatever its capitals (sales item 110, finding K1) ─
// The database keeps one live contact per site and LOWER-CASED email
// (presence_contacts_site_email_uq, migration 0074). The lookups that ask "is
// there one already?" compared the email exactly, so a visitor who typed
// Jane@Example.com on a website form got a contact with the capitals kept, and
// every later add, import, edit, booking or "→ Deal" for jane@example.com missed
// her, tried to insert, and was refused by that rule ("That contact didn't save").
// Now every writer stores the email lower-cased and every lookup matches the way
// the rule does. Pure helpers; the routes do the reading.

/** The email as the contacts table keeps it: trimmed and lower-cased. */
export function normEmail(v: unknown): string {
  return String(v ?? '').trim().toLowerCase();
}

/** A PostgREST filter on `email` (default column) that matches this address
 *  whatever its capitals and nothing else. ilike compares without case; its
 *  pattern characters are escaped so "jane_doe@x.com" can't match
 *  "janeXdoe@x.com". PostgREST turns `*` into a wildcard with no escape, so an
 *  address holding one (allowed, never seen) falls back to an exact match on
 *  the lower-cased address, which is how every writer stores it now. */
export function emailMatch(email: unknown, column = 'email'): string {
  const e = normEmail(email);
  if (e.includes('*')) return `${column}=eq.${encodeURIComponent(e)}`;
  return `${column}=ilike.${encodeURIComponent(e.replace(/[\\%_]/g, (c) => '\\' + c))}`;
}

/** One PostgREST filter matching any of these addresses, whatever their capitals
 *  (sales item 122: an import reads who is already here a hundred emails at a
 *  time). Each is an ilike with its pattern characters escaped, inside quotes
 *  so the dots and @ of an address read as text; an address holding a `*`
 *  matches exactly, as emailMatch does. */
export function emailsMatch(emails: unknown[], column = 'email'): string {
  const q = (s: string) => '"' + s.replace(/[\\"]/g, (c) => '\\' + c) + '"';
  const terms = [...new Set(emails.map(normEmail).filter(Boolean))].map((e) => e.includes('*')
    ? `${column}.eq.${q(e)}`
    : `${column}.ilike.${q(e.replace(/[\\%_]/g, (c) => '\\' + c))}`);
  return `or=(${encodeURIComponent(terms.join(','))})`;
}

/** Did the database refuse a write because the row already exists? (Postgres
 *  unique_violation.) Two adds of one new person at once — two rows of one
 *  import file, two tabs — both pass the "is there one?" check before either
 *  insert lands; the second is the same person, not a failure. */
export function isUniqueViolation(r: { status?: number; json?: unknown; text?: string }): boolean {
  const j: any = r && r.json;
  if (j && typeof j === 'object' && String(j.code || '') === '23505') return true;
  return r?.status === 409 && /23505|duplicate key/i.test(String(r?.text || ''));
}
