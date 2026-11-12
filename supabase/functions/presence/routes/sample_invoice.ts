// ── POST /sales/invoices/test: send a test invoice to myself (builder list item 175) ──
// The invoice email and PDF a customer gets, with sample lines (lib/sample_invoice.ts), on
// the studio's own brand and Business details, to the signed-in person only. Nothing is
// written: no invoice row, no invoice number used, no Stripe link. `stripe` in the answer
// says whether real invoices can go out yet, so the page can say "connect Stripe first".
import { json } from '../../_shared/http.ts';
import type { Principal } from '../../_shared/auth.ts';
import type { SiteRow } from '../lib/site.ts';
import { sendEmail } from '../commerce/account.ts';
import { stripeConfigured } from '../commerce/stripe.ts';
import { loadEmailBrand, EMAIL_BRAND_DEFAULT } from '../lib/email_brand.ts';
import { documentPdf, pdfFileName } from '../lib/doc_pdf.ts';
import { docContextFor } from '../lib/doc_context.ts';
import { dayLabel } from '../lib/documents.ts';
import { sampleInvoice, sampleInvoiceEmail, SAMPLE_BILL_TO } from '../lib/sample_invoice.ts';

export async function handleSampleInvoice(site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  const to = String(principal.email || '').trim();
  if (!to) return json({ error: 'bad_request', message: 'Your sign-in has no email to send the test to.' }, 400, cors);
  const [brand, ctx] = await Promise.all([
    loadEmailBrand(site.id).catch(() => EMAIL_BRAND_DEFAULT),
    docContextFor(site.id, 'invoice', null, { billTo: SAMPLE_BILL_TO, payments: [] }).catch(() => null),
  ]);
  const row = sampleInvoice(new Date().toISOString(), ctx?.tz || null);
  const pdf = (() => { try { return documentPdf('invoice', row, brand, ctx); } catch { return null; } })();
  const { subject, html } = sampleInvoiceEmail({
    studioName: brand.name && brand.name !== EMAIL_BRAND_DEFAULT.name ? brand.name : '',
    accent: brand.accent, amountCents: Number(row.amount_cents), dueLabel: dayLabel(row.due_date, ctx?.tz), title: String(row.title), pdf: !!pdf,
  });
  // the real invoice's way out: transactional, from the studio in its name, replies to its Inbox
  const sent = await sendEmail(to, subject, html, brand, { critical: true, asBusiness: true, siteId: site.id, ...(pdf ? { attachments: [{ filename: pdfFileName('invoice', row), content: pdf }] } : {}) }).catch(() => false);
  if (!sent) return json({ error: 'fetch_failed', message: 'The test didn’t send. Check that email sending is set up, then try again.' }, 502, cors);
  return json({ data: { sent_to: to, stripe: stripeConfigured() } }, 200, cors);
}
