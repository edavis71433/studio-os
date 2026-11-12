// ── A bank payment that bounced (sales item 116, Nov 12 2026 review, finding 2) ──
// An invoice's pay link takes ONE payment and then switches itself off. A bank
// payment counts as that one payment the moment it STARTS; if the bank refuses it
// days later the invoice went back to unpaid, but the client's Pay button, the
// studio's Send and every reminder went on handing out the switched-off link, and
// the only record of the bounce was a line in the server log.
//
// The stripe-webhook function puts the invoice back to open, takes the spent link
// off the row and adds one to link_gen (migration 0188). It then calls this route,
// which does the three things that function can't (no Stripe key, no mail, no push):
//   1. a fresh pay link, stored on the invoice, so reminders carry it;
//   2. a Needs you line for the studio, with the operator email;
//   3. an email to the client with the fresh link.
// Secret-gated like /commerce/invoice-paid, and the body is an id only: the invoice
// is re-read here, and nothing happens unless it is open, not settling, and holds
// no link (which is exactly how the webhook leaves a bounced one).
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { raiseNoticeDetailed } from '../lib/notice.ts';
import { mintPayLink } from '../lib/pay_link.ts';
import { UUID_RE } from '../lib/uuid.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] as string));
const usd = (c: unknown) => '$' + ((Number(c) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** One notice per bounce: the period carries the link number the bounce moved the invoice to. Pure. */
export const bouncedPeriod = (invoiceId: string, gen: unknown): string => `bounced:${invoiceId}:g${Math.max(0, Math.trunc(Number(gen) || 0))}`;

/** What the studio reads. It says what happened to the money, and what has, or
 *  hasn't, been done about it, so nothing is claimed that didn't happen. Pure. */
export function bouncedNoticeCopy(p: { what: string; amount: string; who: string; linked: boolean; emailed: boolean; hasEmail: boolean }): { headline: string; body: string } {
  const headline = `Bank payment bounced: ${p.what} (${p.amount})${p.who ? ` from ${p.who}` : ''}`;
  const body = !p.linked ? 'Their bank refused the payment, so the invoice is unpaid again. We couldn’t make a new pay link just now: open the deal and press Send on the invoice to give them one.'
    : p.emailed ? 'Their bank refused the payment, so the invoice is unpaid again. We emailed them a fresh pay link, and reminders will carry it. A quick personal note helps too.'
    : p.hasEmail ? 'Their bank refused the payment, so the invoice is unpaid again. It has a fresh pay link, but our email to them didn’t go out: open the deal and press Send on the invoice.'
    : 'Their bank refused the payment, so the invoice is unpaid again. It has a fresh pay link, but there’s no email on the deal’s contact: copy the link to them from the deal.';
  return { headline, body };
}

export async function handleInvoiceBounced(req: Request, secret: string, cors: Record<string, string>): Promise<Response> {
  if (!secret || req.headers.get('x-commerce-secret') !== secret) return json({ error: 'forbidden' }, 403, cors);
  let body: any = null;
  try { body = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const invoiceId = String(body?.invoice_id || '');
  if (!UUID_RE.test(invoiceId)) return json({ error: 'bad_request' }, 400, cors);
  const r = await svc(`presence_invoices?id=eq.${invoiceId}&status=eq.open&deleted_at=is.null&select=id,site_id,deal_id,title,description,amount_cents,currency,purpose,stripe_url,processing_since,link_gen&limit=1`);
  const inv = r.ok && Array.isArray(r.json) ? r.json[0] : null;
  if (!inv || inv.processing_since || inv.stripe_url || !(Number(inv.link_gen) > 0)) return json({ data: { ignored: true, reason: 'not_a_bounced_invoice' } }, 200, cors);
  const clientId = (await svc(`presence_sites?id=eq.${encodeURIComponent(String(inv.site_id))}&select=client_id&limit=1`)).json?.[0]?.client_id;
  if (!clientId) return json({ data: { ignored: true, reason: 'no_owner_client' } }, 200, cors);

  const payUrl = await mintPayLink(inv);
  const isDeposit = inv.purpose === 'deposit';
  const amount = usd(inv.amount_cents);
  const what = String(inv.title || (isDeposit ? 'Deposit' : 'Invoice'));
  let who = '', first = '', payerEmail = '';
  try {
    if (inv.deal_id) {
      const deal = (await svc(`presence_deals?id=eq.${inv.deal_id}&site_id=eq.${inv.site_id}&select=title,contact_id&limit=1`)).json?.[0];
      if (deal?.contact_id) {
        const contact = (await svc(`presence_contacts?id=eq.${deal.contact_id}&site_id=eq.${inv.site_id}&select=name,email&limit=1`)).json?.[0];
        who = String(contact?.name || '').slice(0, 80);
        first = who;   // the person's own name only: a deal's title is not someone to greet
        payerEmail = String(contact?.email || '').trim();
      }
      if (!who) who = String(deal?.title || '').slice(0, 80);
    }
  } catch { /* the notice still goes, less specific */ }

  // the client first: the studio's line then says truthfully whether they were told
  let emailed = false;
  if (payUrl && payerEmail) {
    try {
      const [{ sendEmail }, { loadEmailBrand }, { firstNameOf }] = await Promise.all([import('../commerce/account.ts'), import('../lib/email_brand.ts'), import('./sales.ts')]);
      const brand = await loadEmailBrand(String(inv.site_id));
      first = firstNameOf(first);
      const btn = `<a href="${esc(payUrl)}" style="display:inline-block;margin-top:6px;background:${brand.accent};color:#fff;padding:9px 16px;border-radius:999px;text-decoration:none">Pay ${amount} securely →</a>`;
      emailed = await sendEmail(payerEmail, `Your bank payment didn’t go through: ${what} (${amount})`,
        `<p>${first ? `Hi ${esc(first)},` : 'Hi there,'}</p><p>Your bank wasn’t able to complete the payment of <strong>${amount}</strong> for ${esc(what)}, so nothing was taken and the ${isDeposit ? 'deposit' : 'invoice'} is still open.</p><p>Here is a fresh link to pay it. The earlier one no longer works.</p><p class="cta">${btn}</p><p style="color:#6b6478;font-size:14px;margin-top:14px">Paid another way already, or have a question? Just reply to this email.</p>`,
        brand, { critical: true, asBusiness: true, siteId: String(inv.site_id) });   // money they owe = transactional; their answer lands in the Inbox
    } catch { emailed = false; }
  }

  const copy = bouncedNoticeCopy({ what, amount, who, linked: !!payUrl, emailed, hasEmail: !!payerEmail });
  // the money kind (0119) under its own period: a bounce is money that needs the studio,
  // and a kind of its own would mean rewriting the kind list other work is also widening
  const outcome = await raiseNoticeDetailed({ siteId: String(inv.site_id), clientId: String(clientId), kind: 'invoice_void_paid', period: bouncedPeriod(String(inv.id), inv.link_gen), headline: copy.headline, body: copy.body });
  if (outcome === 'created') {
    try {
      const { emailOperator } = await import('../lib/service_bridge.ts');
      const base = (Deno.env.get('SITE_URL') || 'https://davisdigitalstudio.com').replace(/\/$/, '');
      await emailOperator(String(inv.site_id), copy.headline, `<p>${esc(copy.body)}</p>`, 'invoice_bounced', { label: 'Open the deal', href: inv.deal_id ? `${base}/pipeline.html?deal=${inv.deal_id}` : `${base}/today.html` });
    } catch { /* the notice carries it */ }
  }
  return json({ data: { notice: outcome === 'created', already: outcome === 'exists', linked: !!payUrl, emailed } }, 200, cors);
}
