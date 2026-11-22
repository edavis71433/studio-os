// ── Builder item 349 (Nov 2026): what the thank-you page says after a payment ──
// A payer lands on payment-success.html?paid=<invoice id> (client.html forwards a payer with
// no portal sign-in there; the Stripe return into client.html is untouched). The page used to
// know the studio only from a sign-in this browser had done before, so a first-time payer saw
// no studio, no amount, and a "Sign in to your workspace" button they couldn't use.
//
// GET /public/pay/thanks?paid=<invoice id>, before any sign-in, authorized by the id alone
// (a uuid nobody can guess, the same one the return URL carries). It reads the invoice with
// the service role and answers only what the payer already knows or was promised:
//   { studio: { name, logo_url, accent, contact: { email, phone } }, amount: "$1,200.00", invoice_title,
//     receipt_to: "m•••@juniperfloral.com" | null, signin: boolean }
// The receipt address is MASKED, never the raw one: the page says where the receipt went
// without handing the address to whoever holds the link. `signin` is true only when the
// invoice's customer has a portal sign-in (its contact has an auth user, the same test
// lib/portal_people.ts makes), so the page offers the button to someone who can use it.
// A bad or missing id, an invoice that isn't there, was deleted or voided: 400 / 404.
// Never cached: it is about a payment.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { studioBrandOf, publicContactOf } from './studio_brand.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { 'Cache-Control': 'private, no-store' };

/** An email with the local part hidden but its first letter: m•••@juniperfloral.com. Pure.
 *  '' when it isn't an email. */
export function maskEmail(raw: unknown): string {
  const e = String(raw ?? '').trim().toLowerCase();
  const at = e.indexOf('@');
  if (at < 1 || at === e.length - 1 || /\s/.test(e) || e.indexOf('@', at + 1) >= 0) return '';
  return e.charAt(0) + '•••@' + e.slice(at + 1);
}

/** "$1,200.00" for 120000 cents of usd; another currency shows its code. Pure. */
export function moneyWords(cents: unknown, currency: unknown): string {
  const n = Math.max(0, Math.round(Number(cents) || 0)) / 100;
  const cur = String(currency || 'usd').toUpperCase();
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(n); }
  catch { return `${cur} ${n.toFixed(2)}`; }
}

const row = (r: { ok: boolean; json: unknown }) => (r.ok && Array.isArray(r.json) ? r.json[0] : null) as Record<string, unknown> | null;

/** The payer's email, where the receipt route (routes/commerce.ts) finds it: the deal's contact,
 *  then what Stripe collected at checkout, then the customer record. '' when none. */
async function payerEmailOf(inv: Record<string, unknown>): Promise<string> {
  const site = String(inv.site_id || '');
  try {
    if (inv.deal_id && UUID.test(String(inv.deal_id))) {
      const deal = row(await svc(`presence_deals?id=eq.${inv.deal_id}&site_id=eq.${site}&select=contact_id&limit=1`));
      if (deal?.contact_id && UUID.test(String(deal.contact_id))) {
        const c = row(await svc(`presence_contacts?id=eq.${deal.contact_id}&site_id=eq.${site}&select=email&limit=1`));
        const e = String(c?.email || '').trim();
        if (e) return e;
      }
    }
  } catch { /* the next source */ }
  try {
    const { payerEmailFromStripe } = await import('./commerce.ts');
    const e = await payerEmailFromStripe(String(inv.id), String(inv.paid_ref || ''));
    if (e) return e;
  } catch { /* the next source */ }
  try {
    if (inv.customer_client_id && UUID.test(String(inv.customer_client_id))) {
      const c = row(await svc(`clients?id=eq.${inv.customer_client_id}&select=email,contact_email&limit=1`));
      return String(c?.email || c?.contact_email || '').trim();
    }
  } catch { /* none */ }
  return '';
}

/** Whether the invoice's customer has a portal sign-in: clients.contact_id → contacts.auth_user_id. */
async function hasSignIn(inv: Record<string, unknown>): Promise<boolean> {
  try {
    if (!inv.customer_client_id || !UUID.test(String(inv.customer_client_id))) return false;
    const c = row(await svc(`clients?id=eq.${inv.customer_client_id}&select=contact_id&limit=1`));
    if (!c?.contact_id || !UUID.test(String(c.contact_id))) return false;
    const contact = row(await svc(`contacts?id=eq.${c.contact_id}&select=auth_user_id&limit=1`));
    return !!(contact && contact.auth_user_id);
  } catch { return false; }
}

export async function handlePayThanks(req: Request, cors: Record<string, string>): Promise<Response> {
  const id = String(new URL(req.url).searchParams.get('paid') || '').trim();
  if (!UUID.test(id)) return json({ error: 'bad_request', message: 'That link is missing the invoice it is for.' }, 400, { ...cors, ...NO_STORE });
  const inv = row(await svc(`presence_invoices?id=eq.${id}&deleted_at=is.null&select=id,site_id,deal_id,customer_client_id,title,amount_cents,currency,status,paid_ref&limit=1`));
  if (!inv || inv.status === 'void') return json({ error: 'not_found', message: 'That invoice isn’t here.' }, 404, { ...cors, ...NO_STORE });
  const [brand, contact, email, signin] = await Promise.all([studioBrandOf(String(inv.site_id)), publicContactOf(String(inv.site_id)), payerEmailOf(inv), hasSignIn(inv)]);
  return json({
    data: {
      studio: { name: brand.name, logo_url: brand.logo_url, accent: brand.accent, contact },
      amount: moneyWords(inv.amount_cents, inv.currency),
      invoice_title: String(inv.title || '').trim().slice(0, 120),
      receipt_to: maskEmail(email) || null,
      signin,
    },
  }, 200, { ...cors, ...NO_STORE });
}
