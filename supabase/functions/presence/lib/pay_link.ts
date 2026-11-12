// ── A fresh pay link for an open invoice (sales item 116, Nov 12 2026 review) ──
// Each invoice's Stripe link takes ONE payment and then switches itself off, and
// reminders, the client's Pay button and the studio's Send all hand out whatever
// link the row holds. Three things used to leave the row with a dead link or none,
// and so with no reminders and no Pay button until someone pressed Send:
//   a bank payment that bounced   the link was used up the moment the payment started
//   a part payment                the link was for the old amount
//   an Undo                       the link was switched off when the invoice was marked paid
// Whoever clears the stored link adds one to link_gen (migration 0188); this makes
// the next link under that number and stores it, so the invoice is payable again
// straight away. Never throws: null means "no link yet", and the next Send, or the
// reminder sweep, tries again under the same number.
import { svc } from './db.ts';
import { stripeConfigured, createServicePaymentLink } from '../commerce/stripe.ts';

export interface PayLinkRow { id: string; site_id: string; amount_cents: unknown; currency?: unknown; description?: unknown; title?: unknown; link_gen?: unknown }

export async function mintPayLink(inv: PayLinkRow): Promise<string | null> {
  if (!stripeConfigured() || !inv?.id || !inv?.site_id) return null;
  try {
    const link = await createServicePaymentLink({ amountCents: Number(inv.amount_cents), currency: String(inv.currency || 'usd'), description: String(inv.description || inv.title || 'Invoice'), invoiceId: String(inv.id), gen: inv.link_gen });
    if (!/^https:\/\//.test(String(link.url))) return null;   // Stripe's links are https; anything else is no link
    // only onto the row it was made for: still open, still without a link, still this amount
    const up = await svc(`presence_invoices?id=eq.${inv.id}&site_id=eq.${inv.site_id}&status=eq.open&stripe_url=is.null&amount_cents=eq.${Math.round(Number(inv.amount_cents))}&deleted_at=is.null&select=id`,
      { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ stripe_url: link.url, stripe_payment_link_id: link.id }) });
    return up.ok && Array.isArray(up.json) && up.json[0] ? link.url : null;
  } catch { return null; }
}

/** The first time an invoice goes to the client, it remembers the day (sales item
 *  118): reminders count from it. A resend never moves it. Best-effort; before
 *  APPLY-0188 the column is missing and this is a no-op. */
export async function stampFirstSent(invoiceId: string, siteId: string, nowIso: string): Promise<void> {
  await svc(`presence_invoices?id=eq.${invoiceId}&site_id=eq.${siteId}&first_sent_at=is.null`, { method: 'PATCH', body: JSON.stringify({ first_sent_at: nowIso }) }).catch(() => {});
}
