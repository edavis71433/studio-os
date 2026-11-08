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
  const client = t(p.clientName), site = t(p.siteBusinessName), cname = t(p.contactName), company = t(p.contactCompany);
  const business = site || company;
  let person = cname || (business && client && client.toLowerCase() !== business.toLowerCase() ? client : '');
  if (person && business && person.toLowerCase() === business.toLowerCase()) person = '';
  return { name: business || client || person || 'Customer', business_name: business, person_name: person };
}
