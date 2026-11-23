// ── Who to email about a client's site: the client, and the studio that looks after it ──
// Builder list items 267 and 268 (full review of Nov 22, 2026).
//
// 268: a customer's email can sit in four places: the client row's own `email`, its
// `contact_email`, the sign-in contact it points at (contact_id), and, since Add a customer
// (Nov 16) saves the address on the linked person in the studio's contacts, that person.
// Four emails (domain reminders, site down and back up, domain changes, the monthly report)
// read the first place only, so a customer added the new way got none of them and the
// report card said "there's no email on their record". This is the ONE helper, used by all.
//
// 267: the studio's copy of those emails was addressed through the active service link
// only. A site made with "+ New site" has no link until its owner is invited, so the
// studio heard nothing about it. The studio is found through its list of sites too.
import { svc } from './db.ts';

const lower = (v: unknown) => String(v || '').trim().toLowerCase();
const rowsOf = <T,>(q: unknown): T[] => (q && (q as { ok?: boolean }).ok !== false && Array.isArray((q as { json?: unknown }).json) ? ((q as { json: T[] }).json) : []);

export interface ClientPlaces {
  client: { name?: string | null; email?: string | null; contact_email?: string | null; contact_id?: string | null } | null;
  contact: { name?: string | null; email?: string | null } | null;   // the sign-in contact the client row points at
  person: { name?: string | null; email?: string | null } | null;    // the linked person in the studio's contacts
}
/** Pure: the client's address and name from the four places, the client row's own first. */
export function pickClientEmail(p: ClientPlaces | null | undefined): { email: string | null; name: string | null } {
  if (!p || !p.client) return { email: null, name: null };
  const email = [p.client.email, p.client.contact_email, p.contact?.email, p.person?.email].map(lower).find(Boolean) || null;
  const name = String(p.client.name || p.contact?.name || p.person?.name || '').trim() || null;
  return { email, name };
}
/** Pure: every address the client can be reached at, lower-cased, once each. */
export function allClientEmails(p: ClientPlaces | null | undefined): string[] {
  if (!p || !p.client) return [];
  return [...new Set([p.client.email, p.client.contact_email, p.contact?.email, p.person?.email].map(lower).filter(Boolean))];
}

/** The four places, read. Null client when there is no such record. */
export async function clientPlaces(clientId: string | null | undefined): Promise<ClientPlaces> {
  const id = String(clientId || '');
  if (!id) return { client: null, contact: null, person: null };
  const client = rowsOf<NonNullable<ClientPlaces['client']>>(await svc(`clients?id=eq.${encodeURIComponent(id)}&select=name,email,contact_email,contact_id&limit=1`).catch(() => null))[0] || null;
  if (!client) return { client: null, contact: null, person: null };
  const [contact, person] = await Promise.all([
    client.contact_id ? svc(`contacts?id=eq.${encodeURIComponent(String(client.contact_id))}&select=name,email&limit=1`).then((q) => rowsOf<NonNullable<ClientPlaces['contact']>>(q)[0] || null).catch(() => null) : Promise.resolve(null),
    svc(`presence_contacts?client_id=eq.${encodeURIComponent(id)}&deleted_at=is.null&email=neq.&select=name,email&order=created_at.asc&limit=1`).then((q) => rowsOf<NonNullable<ClientPlaces['person']>>(q)[0] || null).catch(() => null),
  ]);
  return { client, contact, person };
}
/** The client's address and name, from wherever their record keeps it. */
export async function clientReach(clientId: string | null | undefined): Promise<{ email: string | null; name: string | null }> {
  return pickClientEmail(await clientPlaces(clientId));
}

/** The studio site that looks after a client site: the active service link first, else
 *  (item 267) the studio whose list the site is on, through that studio's owner's own site.
 *  Null when nobody looks after it. Never throws. */
export async function studioSiteFor(siteId: string | null | undefined): Promise<string | null> {
  const id = String(siteId || '');
  if (!id) return null;
  try {
    const link = rowsOf<{ agency_site_id?: string }>(await svc(`presence_service_links?customer_site_id=eq.${id}&status=eq.active&select=agency_site_id&order=created_at.desc&limit=1`))[0];
    if (link?.agency_site_id) return String(link.agency_site_id);
    const listed = rowsOf<{ agency_id?: string }>(await svc(`presence_agency_clients?site_id=eq.${id}&status=eq.active&select=agency_id&limit=1`))[0];
    if (!listed?.agency_id) return null;
    const owner = rowsOf<{ user_id?: string | null; email?: string }>(await svc(`presence_agency_members?agency_id=eq.${listed.agency_id}&role=eq.owner&status=eq.active&select=user_id,email&order=created_at.asc&limit=1`))[0];
    if (!owner) return null;
    const { seatFilter } = await import('./workspace.ts');   // builder item 397: the address quoted in the filter
    const or = seatFilter({ userId: owner.user_id || null, email: lower(owner.email) || null });
    if (!or) return null;
    const seat = rowsOf<{ site_id?: string }>(await svc(`presence_site_members?status=eq.active&${or}&select=site_id&order=created_at.asc&limit=1`))[0];
    return seat?.site_id && String(seat.site_id) !== id ? String(seat.site_id) : null;
  } catch { return null; }
}
