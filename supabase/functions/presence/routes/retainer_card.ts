// ── A retainer's card, put right by the client (sales item 129, Stripe review Nov 15) ──
// When a retainer's monthly charge fails, Stripe tries the card again over a few days
// and then, by the studio's Stripe setting, ends the retainer. The client was never
// told and had no way to put in a new card: their portal said "message your studio",
// and the studio's line asked for a fresh approval link, which the deal refuses while
// the retainer is past due. Now there are three ways in, all to the same place:
//   · Update your card on the client's portal      POST /client/retainers/:deal/card
//   · Email the card link on the deal               POST /sales/deals/:id/retainer/card-link
//     (the client gets a link that lasts 30 days, for a client with no portal sign-in)
//   · that link, opened                             card.html → POST /retainer-card
// Each opens Stripe's own customer portal on "update your payment method" and nothing
// else (commerce/stripe.ts createCardUpdateSession). Nothing here charges, refunds or
// changes a retainer: Stripe uses the new card at its next try, and the webhook says
// so when the charge lands. Stripe's own failed-card and expiring-card emails, when
// they are switched on in Stripe, link to Stripe's page too.
import { linkKey, signedWithAny } from '../../_shared/link_keys.ts';   // builder item 394: each kind of link has its own key
import { appBase } from '../../_shared/app_url.ts';   // builder item 388: every link starts at the app's address
import { json } from '../../_shared/http.ts';
import { hmacHex, timingSafeEqual } from '../../_shared/hmac.ts';
import { svc } from '../lib/db.ts';
import { sendEmail } from '../commerce/account.ts';
import { loadEmailBrand, EMAIL_BRAND_DEFAULT, emailBand } from '../lib/email_brand.ts';
import { stripeConfigured, createCardUpdateSession } from '../commerce/stripe.ts';
import { retainerCardFixable, type RetainerState } from '../commerce/retainers.ts';
import { rateAllow, clientIp, tooMany } from '../lib/ratelimit.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';
import { UUID_RE } from '../lib/uuid.ts';

const rows = (r: { json?: unknown }) => (Array.isArray((r as any)?.json) ? (r as any).json : []) as any[];
const appUrl = () => appBase();
const usd = (c: unknown) => '$' + ((Number(c) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const escH = (t: string) => t.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] as string));
const retainerOf = (deal: any): Partial<RetainerState> | null => (deal && deal.retainer && typeof deal.retainer === 'object' ? deal.retainer : null);

// ── the emailed link: signed, names one deal, lasts 30 days ─────────────────
// The house HMAC idiom (routes/sales.ts signSalesToken) with its own kind, 'card',
// which no other reader accepts: verifySalesToken takes only proposal, contract,
// flow and estimate, and readDocToken only 'doc'. So this link can open Stripe's
// card page for one retainer and do nothing else. Pure.
export const CARD_LINK_DAYS = 30;
function b64url(s: string): string { return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64url(s: string): string { const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : ''; return atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad); }
export function cardLinkSecret(): string | null {
  return linkKey('retainer_card') || null;   // builder item 394: its own key
}
export async function signCardToken(dealId: string, siteId: string, nowSec: number, secret: string): Promise<string> {
  const body = b64url(JSON.stringify({ t: 'card', id: dealId, site_id: siteId, exp: nowSec + CARD_LINK_DAYS * 86400 }));
  return `${body}.${await hmacHex(secret, body)}`;
}
/** ok: the deal and site it names. expired: signed by us, but past its date (the page
 *  then says to ask for a new one, by the studio's name). null: not one of ours. */
export async function readCardToken(token: string, secret: string, nowSec: number): Promise<{ ok: true; id: string; site_id: string } | { ok: false; expired: true; id: string; site_id: string } | null> {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1] || parts[0].length > 400) return null;
  if (!(await signedWithAny('retainer_card', secret, async (k) => timingSafeEqual(parts[1], await hmacHex(k, parts[0]))))) return null;
  let p: any; try { p = JSON.parse(unb64url(parts[0])); } catch { return null; }
  if (!p || p.t !== 'card' || !UUID_RE.test(p.id || '') || !UUID_RE.test(p.site_id || '') || typeof p.exp !== 'number') return null;
  if (p.exp < nowSec) return { ok: false, expired: true, id: p.id, site_id: p.site_id };
  return { ok: true, id: p.id, site_id: p.site_id };
}
export const cardLinkUrl = (token: string): string => `${appUrl()}/card.html?t=${encodeURIComponent(token)}`;

/** Why there is no card to change, in the words each side reads. Pure. */
export function cardRefusal(r: Partial<RetainerState> | null, who: 'studio' | 'client'): string {
  const st = String(r?.status || '');
  if (!r || !st) return who === 'studio' ? 'This deal has no retainer.' : 'That retainer isn’t here.';
  if (st === 'canceled') return who === 'studio' ? 'This retainer has ended, so there’s no card to change. Set it up again to start it.' : 'This retainer has ended, so there’s no card to change.';
  if (st === 'pending') return who === 'studio' ? 'The client hasn’t approved this retainer yet, so there’s no card on it. Copy its approval link instead.' : 'This retainer hasn’t started yet, so there’s no card to change.';
  return who === 'studio' ? 'Stripe hasn’t told us which customer this retainer charges yet. Try again in a minute.' : 'We can’t open the card page for this retainer just now. Please message your studio.';
}

// ── POST /client/retainers/:deal/card — Update your card, on the client's portal ──
// Scoped like /client/retainers/:deal/cancel: the caller is on their own site and the
// retainer is theirs only when its deal became their client account. An 'edit' write
// (lib/site_roles.ts): a new card keeps the retainer paid and stops nothing.
export async function handleClientRetainerCard(_req: Request, site: SiteRow, _principal: Principal, dealId: string, cors: Record<string, string>): Promise<Response> {
  const me = site.client_id ? String(site.client_id) : '';
  if (!UUID_RE.test(dealId) || !me) return json({ error: 'not_found', message: 'That retainer isn’t here.' }, 404, cors);
  const dr = await svc(`presence_deals?id=eq.${dealId}&converted_client_id=eq.${me}&deleted_at=is.null&select=id,site_id,retainer&limit=1`);
  if (!dr.ok) return json({ error: 'unavailable', message: 'We couldn’t open the card page just now. Please try again in a minute.' }, 503, cors);
  const deal = rows(dr)[0];
  const r = retainerOf(deal);
  if (!deal || !r) return json({ error: 'not_found', message: 'That retainer isn’t here.' }, 404, cors);
  if (!retainerCardFixable(r)) return json({ error: 'bad_state', message: cardRefusal(r, 'client') }, 409, cors);
  if (!stripeConfigured()) return json({ error: 'unavailable', message: 'We can’t open the card page just now. Please message your studio.' }, 503, cors);
  try {
    const s = await createCardUpdateSession({
      customerId: String(r.stripe_customer_id),
      returnUrl: `${appUrl()}/client.html#invoices`,
      doneUrl: `${appUrl()}/client.html?card=saved#invoices`,
    });
    return json({ data: { url: s.url } }, 200, cors);
  } catch (e) {
    console.error(`[retainer-card] Stripe refused a card page for deal ${dealId}: ${String((e as Error)?.message || e)} (is the customer portal saved in Stripe's settings?)`);
    return json({ error: 'card_page_failed', message: 'We couldn’t open Stripe’s card page just now. Please try again in a minute, or message your studio.' }, 502, cors);
  }
}

// ── POST /sales/deals/:id/retainer/card-link — Email the card link, on the deal ──
// The studio sends the client a link to Stripe's card page. Studio-gated and site-scoped
// like every /sales/* route; an 'edit' write, like sending an invoice. The link comes
// back too, so the studio can copy it when the contact has no email.
export async function handleSalesRetainerCardLink(_req: Request, site: SiteRow, _principal: Principal, dealId: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(dealId)) return json({ error: 'bad_request' }, 400, cors);
  const dr = await svc(`presence_deals?id=eq.${dealId}&site_id=eq.${site.id}&deleted_at=is.null&select=id,title,contact_id,retainer&limit=1`);
  if (!dr.ok) return json({ error: 'unavailable', message: 'We couldn’t read the deal just now. Nothing was sent.' }, 503, cors);
  const deal = rows(dr)[0];
  if (!deal) return json({ error: 'not_found', message: 'That deal is no longer here.' }, 404, cors);
  const r = retainerOf(deal);
  if (!retainerCardFixable(r)) return json({ error: 'bad_state', message: cardRefusal(r, 'studio') }, 409, cors);
  const secret = cardLinkSecret();
  if (!secret) return json({ error: 'unavailable', message: 'Links can’t be signed on this server yet. Nothing was sent.' }, 503, cors);
  const url = cardLinkUrl(await signCardToken(dealId, site.id, Math.floor(Date.now() / 1000), secret));
  let to = '', first = '';
  if (deal.contact_id) {
    const c = rows(await svc(`presence_contacts?id=eq.${deal.contact_id}&site_id=eq.${site.id}&select=name,email&limit=1`).catch(() => ({ json: [] })))[0];
    to = String(c?.email || '').trim();
    first = String(c?.name || '').trim().split(/\s+/)[0] || '';
  }
  if (!to) return json({ data: { emailed: false, reason: 'no_email', url } }, 200, cors);
  const brand = await loadEmailBrand(site.id).catch(() => EMAIL_BRAND_DEFAULT);
  const studio = brand.name !== EMAIL_BRAND_DEFAULT.name ? brand.name : '';
  const failed = r!.status === 'past_due';
  const per = r!.interval === 'year' ? 'year' : 'month';
  const amt = usd(r!.amount_cents);
  const btn = `<a href="${escH(url)}" style="display:inline-block;margin-top:6px;background:${brand.accent};color:#fff;padding:11px 20px;border-radius:999px;text-decoration:none;font-weight:600">Update your card →</a>`;
  const lead = failed
    ? `The ${amt} a ${per} charge for your retainer${studio ? ` with ${escH(studio)}` : ''} didn’t go through. Put in a new card on Stripe’s secure page, and Stripe uses it for the next try.`
    : `${studio ? escH(studio) : 'Your studio'} sent you a link to change the card your ${amt} a ${per} retainer uses. It opens Stripe’s secure page.`;
  const html = `${emailBand('Retainer', failed ? 'Your card didn’t go through' : 'Update your card')}<p>${first ? `Hi ${escH(first)},` : 'Hi there,'}</p><p>${lead}</p><p class="cta">${btn}</p><p style="font-size:13px;color:#6b6478">The link works for ${CARD_LINK_DAYS} days. Saving a card charges nothing by itself; Stripe uses it for the next charge.</p>`;
  const emailed = await sendEmail(to, failed ? 'Your retainer payment didn’t go through' : 'Update the card for your retainer', html, brand, { critical: true, asBusiness: true, siteId: site.id });
  const { maskEmail } = await import('./email_infra.ts');
  return json({ data: { emailed, to: maskEmail(to), url } }, 200, cors);
}

// ── POST /retainer-card {token} — the emailed link, opened ───────────────────
// PUBLIC and pre-auth, authorized only by the link's own signature (index.ts step 4).
// card.html posts the token and goes where this says: a fresh Stripe page each time,
// since Stripe's pages last a short while and the link lasts 30 days.
export async function handleRetainerCardOpen(req: Request, cors: Record<string, string>): Promise<Response> {
  if (!(await rateAllow(`retcard:${clientIp(req)}`, 20, 600))) return tooMany(cors, 120);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const secret = cardLinkSecret();
  const tok = secret ? await readCardToken(String(b?.token || ''), secret, Math.floor(Date.now() / 1000)) : null;
  if (!tok) return json({ error: 'bad_link', message: 'This link isn’t right. Ask your studio to send it again.' }, 404, cors);
  const brand = await loadEmailBrand(tok.site_id).catch(() => EMAIL_BRAND_DEFAULT);
  const studio = brand.name !== EMAIL_BRAND_DEFAULT.name ? { name: brand.name, accent: brand.accent } : null;
  const ask = studio ? `Ask ${studio.name}` : 'Ask your studio';
  if (!tok.ok) return json({ error: 'expired', message: `This link has run out. ${ask} to send a new one.`, studio }, 410, cors);
  const dr = await svc(`presence_deals?id=eq.${tok.id}&site_id=eq.${tok.site_id}&deleted_at=is.null&select=id,retainer&limit=1`);
  if (!dr.ok) return json({ error: 'unavailable', message: 'We couldn’t open the card page just now. Please try again in a minute.', studio }, 503, cors);
  const r = retainerOf(rows(dr)[0]);
  if (!retainerCardFixable(r)) return json({ error: 'not_live', message: r?.status === 'canceled' ? `This retainer has ended, so there’s no card to change. ${ask} if that’s a surprise.` : `There’s no card to change on this retainer. ${ask} about it.`, studio }, 409, cors);
  if (!stripeConfigured()) return json({ error: 'unavailable', message: `We can’t open the card page just now. ${ask} about it.`, studio }, 503, cors);
  try {
    const s = await createCardUpdateSession({
      customerId: String(r!.stripe_customer_id),
      returnUrl: `${appUrl()}/card.html?left=1`,
      doneUrl: `${appUrl()}/card.html?done=1`,
    });
    return json({ data: { url: s.url, studio } }, 200, cors);
  } catch (e) {
    console.error(`[retainer-card] Stripe refused a card page for deal ${tok.id}: ${String((e as Error)?.message || e)} (is the customer portal saved in Stripe's settings?)`);
    return json({ error: 'card_page_failed', message: 'We couldn’t open Stripe’s card page just now. Please try again in a minute.', studio }, 502, cors);
  }
}
