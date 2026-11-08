// ── A customer's two names (sales review item 22, second half, Nov 2026) ─────
// A customer is a business AND a person. The live review found "Bacchus
// Kitchen" on the deal and "Claud Beltran" on the customer — the two never met,
// because a customer converted from a deal is stored under the contact's name.
// No new column: the business name already lives on the customer's own site
// (presence_identity.business_name) or on their contact (company), and the
// person on that contact (name). This decides what to show. Pure.

export interface CustomerNameParts {
  clientName?: unknown;        // clients.name — sometimes the business, sometimes the person
  siteBusinessName?: unknown;  // presence_identity.business_name on their own site
  contactName?: unknown;       // the linked contact's name (the person)
  contactCompany?: unknown;    // the linked contact's company
}
const t = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);

/** name: what the lists lead with (the business first); business_name and
 *  person_name as known ('' when not). The person is never the same words as
 *  the business. */
export function customerNames(p: CustomerNameParts): { name: string; business_name: string; person_name: string } {
  const client = t(p.clientName), cname = t(p.contactName), company = t(p.contactCompany);
  // Second walk (Nov 8, item 49): converting a deal set up the customer's site
  // under the PERSON's name, so on the live account the site's "business name"
  // is just the contact's name again — a copy, not a business. (Matching the
  // customer's own name proves nothing: "Hettie Orange Designs" is both.)
  let site = t(p.siteBusinessName);
  if (site && cname && cname.toLowerCase() === site.toLowerCase()) site = '';
  const business = site || company;
  let person = cname || (business && client && client.toLowerCase() !== business.toLowerCase() ? client : '');
  if (person && business && person.toLowerCase() === business.toLowerCase()) person = '';
  const name = business || client || person || 'Customer';
  if (person && person.toLowerCase() === name.toLowerCase()) person = '';   // never the same words twice
  return { name, business_name: business, person_name: person };
}

// ── Reading the parts (item 49) ───────────────────────────────────────────────
// The second walk found PR 151 showed nothing new live: the contact behind a
// customer is tied to them through the WON DEAL (presence_deals.contact_id with
// converted_client_id = the customer), not through presence_contacts.client_id.
// This reads both, plus each customer's own site name, for a set of customers.
// `read` returns the rows of one PostgREST path (svc in production, a fake in
// tests). Every read is best-effort: a failed one leaves the plain names.
export interface NameSeed { clientId: string; clientName?: unknown; customerSiteId?: string | null; contactId?: string | null }
export interface NamedCustomer { name: string; business_name: string; person_name: string; contact_id: string; phone: string }
const idsOk = (xs: string[]) => xs.filter((x) => /^[0-9a-f-]{36}$/i.test(x));
export async function loadCustomerNames(agencySiteId: string, seeds: NameSeed[], read: (path: string) => Promise<any[]>): Promise<Record<string, NamedCustomer>> {
  const safe = (path: string) => read(path).then((r) => (Array.isArray(r) ? r : [])).catch(() => [] as any[]);
  const clientIds = idsOk([...new Set(seeds.map((s) => String(s.clientId || '')))]);
  const siteIds = idsOk([...new Set(seeds.map((s) => String(s.customerSiteId || '')))]);
  const [idents, deals, byClient] = await Promise.all([
    siteIds.length ? safe(`presence_identity?site_id=in.(${siteIds.join(',')})&select=site_id,business_name`) : Promise.resolve([]),
    clientIds.length ? safe(`presence_deals?site_id=eq.${agencySiteId}&converted_client_id=in.(${clientIds.join(',')})&deleted_at=is.null&select=converted_client_id,contact_id,updated_at&order=updated_at.desc&limit=500`) : Promise.resolve([]),
    clientIds.length ? safe(`presence_contacts?site_id=eq.${agencySiteId}&client_id=in.(${clientIds.join(',')})&deleted_at=is.null&select=id,client_id,name,company,phone,updated_at&order=updated_at.desc&limit=500`) : Promise.resolve([]),
  ]);
  const bizBySite: Record<string, string> = {}; for (const i of idents) bizBySite[String(i.site_id)] = String(i.business_name || '');
  const dealContact: Record<string, string> = {};
  for (const d of deals) { const k = String(d.converted_client_id || ''); if (k && d.contact_id && !dealContact[k]) dealContact[k] = String(d.contact_id); }
  const contactById: Record<string, any> = {}; const contactByClient: Record<string, any> = {};
  for (const c of byClient) { contactById[String(c.id)] = c; const k = String(c.client_id || ''); if (k && !contactByClient[k]) contactByClient[k] = c; }
  const wanted = idsOk([...new Set(seeds.map((s) => String(s.contactId || dealContact[String(s.clientId)] || '')))].filter((id) => id && !contactById[id]));
  if (wanted.length) for (const c of await safe(`presence_contacts?site_id=eq.${agencySiteId}&id=in.(${wanted.join(',')})&deleted_at=is.null&select=id,client_id,name,company,phone`)) contactById[String(c.id)] = c;
  const out: Record<string, NamedCustomer> = {};
  for (const s of seeds) {
    const cid = String(s.clientId || '');
    if (!cid) continue;
    // the record's own contact first, then the won deal's, then one stamped with this customer;
    // a candidate that names the business wins over one that doesn't
    const cands = [s.contactId ? contactById[String(s.contactId)] : null, contactById[dealContact[cid] || ''], contactByClient[cid]].filter(Boolean);
    const ct = cands.find((c) => t(c.company)) || cands[0] || null;
    const nm = customerNames({ clientName: s.clientName, siteBusinessName: s.customerSiteId ? bizBySite[String(s.customerSiteId)] : '', contactName: ct?.name, contactCompany: ct?.company });
    out[cid] = { ...nm, contact_id: ct ? String(ct.id || '') : '', phone: ct ? t(ct.phone) : '' };
  }
  return out;
}
