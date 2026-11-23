// ── The Growth page's two picker lists, read by the old server (builder item 392) ──
// admin_query used to take a whole database path from the page and check only its first
// word, so a path that began "clients/" and then climbed out with "../" reached any other
// table, or other parts of Supabase such as the list of sign-ins, with the master key
// (Nov 22 2026 review, file 07 finding 11). Now the page names one of two lists and the
// server writes the whole read itself: nothing the page sends is put into the address.

/** The only reads admin_query makes, whole: the table, the columns, the order, the cap. */
export const ADMIN_READS: Readonly<Record<string, string>> = {
  clients: 'clients?select=id,name,contact_email,website,url,site_url,domain&order=name.asc&limit=500',
  contacts: 'contacts?select=id,name,email&order=name.asc&limit=500',
};

/** Which list a request asks for, or null. It may name the table (`table`), or send the
 *  page's old path (`path`), of which only the part before the "?" counts, and that part
 *  must be exactly one of the two names: a slash, a dot, a percent sign or anything else
 *  is refused. Pure. */
export function adminReadTable(body: { table?: unknown; path?: unknown } | null | undefined): string | null {
  const b = body || {};
  const named = typeof b.table === 'string' ? b.table : String(b.path ?? '').split('?')[0];
  return Object.prototype.hasOwnProperty.call(ADMIN_READS, named) ? named : null;
}
