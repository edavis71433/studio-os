// ── Whose Stripe takes the money (sales item 149, Nov 22 2026 review) ─────────
// Every pay link and retainer link is made with the one platform key, so a client's
// business using "Send an invoice" for its own customer would send that money to the
// platform studio's Stripe under the client's name. Until a business can connect its
// own Stripe (parked on Nov 15 as "not now"), pay links and retainers are made only
// for the platform's own studio site.
//
// The platform's own site is AGENCY_SITE_ID (the env manifest, routes/system.ts). When
// it is set, only that site may bill. When it is not set (it is optional today), the
// one case the code can still see is refused: a studio drilled into a CLIENT's
// business (principal.scope), whose invoices would be the client's. Pure.
export interface BillerPrincipal { scope?: { site_id: string } | null }

export function ownStripeAllowed(siteId: string, principal: BillerPrincipal | null | undefined, agencySiteId: string | undefined | null): boolean {
  const own = String(agencySiteId || '').trim();
  if (own) return String(siteId || '') === own;
  return !(principal && principal.scope);
}

/** The refusal every money route answers with. 403, in plain words. */
export const OWN_STRIPE_MESSAGE = 'Payments made from here go to the platform studio’s own Stripe account, so invoices and retainers can only be sent from the studio itself. A way for your business to connect its own Stripe is coming; until then, send this invoice from your own invoicing tool.';
export function ownStripeRefused(siteId: string, principal: BillerPrincipal | null | undefined): boolean {
  return !ownStripeAllowed(siteId, principal, Deno.env.get('AGENCY_SITE_ID'));
}
