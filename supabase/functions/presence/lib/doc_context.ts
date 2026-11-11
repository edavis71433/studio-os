// ── What a document shows beyond its own row (sales items 81 and 82) ─────────
// The reads behind lib/documents.ts's DocContext: who it is from (the studio's
// Business details and location), who it is billed to (the deal's person, their
// address, or their own site's address once they're a customer), the studio's
// time zone for the dates, and the part payments recorded toward an invoice.
// Every read is best-effort and site-scoped: a document still renders, with less
// on it, when one fails or a column isn't there yet (before APPLY-0167).
import { svc } from './db.ts';
import { UUID_RE } from './uuid.ts';
import type { DocContext, DocParty, DocPayment } from './documents.ts';

const rows = (r: { json?: unknown }) => (Array.isArray((r as any)?.json) ? (r as any).json : []) as any[];
const first = async (path: string) => { try { const r = await svc(path); return r.ok ? rows(r)[0] || null : null; } catch { return null; } };

/** "120 Main St\nBurbank, CA 91502" from a presence_locations row. Pure. */
export function addressOf(loc: any): string {
  if (!loc) return '';
  const city = [String(loc.city || '').trim(), [String(loc.region || '').trim(), String(loc.postal_code || '').trim()].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [loc.address_line1, loc.address_line2, city].map((l) => String(l || '').trim()).filter(Boolean).join('\n');
}

/** A contact's address as lines. Sales item 89 keeps it as { street, city, state,
 *  zip, country }; plain text is read as it is. '' for none. Pure. */
export function addressText(a: unknown): string {
  if (!a) return '';
  if (typeof a === 'string') return a.trim();
  if (typeof a !== 'object') return '';
  const o = a as Record<string, unknown>;
  const t = (k: string) => String(o[k] ?? '').trim();
  const city = [t('city'), [t('state'), t('zip')].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [t('street'), city, t('country')].filter(Boolean).join('\n');
}

/** The studio as it signs its documents: Business details (name, email, phone)
 *  and its location's address, plus the time zone its dates are told in. */
export async function studioParty(siteId: string): Promise<{ party: DocParty; tz: string | null }> {
  const [id, loc] = await Promise.all([
    first(`presence_identity?site_id=eq.${siteId}&select=business_name,email,phone&limit=1`),
    first(`presence_locations?site_id=eq.${siteId}&select=address_line1,address_line2,city,region,postal_code,timezone,phone&limit=1`),
  ]);
  return {
    party: { name: String(id?.business_name || ''), email: String(id?.email || ''), phone: String(id?.phone || loc?.phone || ''), address: addressOf(loc) },
    tz: loc?.timezone ? String(loc.timezone) : null,
  };
}

/** Who a deal's documents are billed to: its person (name, business, email,
 *  phone, address), and — when they have no address on file and are already a
 *  customer — the address on their own site's Business details. */
export async function billToForDeal(siteId: string, dealId: unknown): Promise<DocParty | null> {
  if (!UUID_RE.test(String(dealId || ''))) return null;
  const deal = await first(`presence_deals?id=eq.${dealId}&site_id=eq.${siteId}&select=contact_id,title,converted_site_id&limit=1`);
  if (!deal) return null;
  let c: any = null;
  if (UUID_RE.test(String(deal.contact_id || ''))) {
    // the address is sales item 89's column; before it exists the same read without it
    c = await first(`presence_contacts?id=eq.${deal.contact_id}&site_id=eq.${siteId}&select=name,email,phone,company,address&limit=1`)
      || await first(`presence_contacts?id=eq.${deal.contact_id}&site_id=eq.${siteId}&select=name,email,phone,company&limit=1`);
  }
  let address = addressText(c?.address);
  if (!address && UUID_RE.test(String(deal.converted_site_id || ''))) {
    address = addressOf(await first(`presence_locations?site_id=eq.${deal.converted_site_id}&select=address_line1,address_line2,city,region,postal_code&limit=1`));
  }
  if (!c && !address) return null;
  return { name: String(c?.name || ''), company: String(c?.company || ''), email: String(c?.email || ''), phone: String(c?.phone || ''), address };
}

/** The part payments recorded toward an invoice (item 77), oldest first. */
export async function partPayments(siteId: string, invoiceId: string): Promise<DocPayment[]> {
  if (!UUID_RE.test(invoiceId)) return [];
  try {
    const r = await svc(`presence_invoices?payment_for=eq.${invoiceId}&site_id=eq.${siteId}&status=eq.paid&deleted_at=is.null&select=amount_cents,paid_at,paid_method,paid_note&order=paid_at.asc&limit=50`);
    return r.ok ? rows(r).map((p) => ({ amount_cents: Number(p.amount_cents) || 0, paid_at: p.paid_at || null, paid_method: String(p.paid_method || ''), paid_note: String(p.paid_note || '') })) : [];
  } catch { return []; }
}

/** Everything one document needs around its row, read side by side. */
export async function docContextFor(siteId: string, kind: 'proposal' | 'contract' | 'invoice' | 'estimate', row: any, extra: Partial<DocContext> = {}): Promise<DocContext> {
  const dealId = row?.deal_id;
  const [studio, billTo, payments, deal] = await Promise.all([
    studioParty(siteId),
    billToForDeal(siteId, dealId),
    kind === 'invoice' && row?.id ? partPayments(siteId, String(row.id)) : Promise.resolve([] as DocPayment[]),
    UUID_RE.test(String(dealId || '')) ? first(`presence_deals?id=eq.${dealId}&site_id=eq.${siteId}&select=title&limit=1`) : Promise.resolve(null),
  ]);
  return { studio: studio.party, tz: studio.tz, billTo, payments, forWhat: deal?.title ? String(deal.title) : null, ...extra };
}
