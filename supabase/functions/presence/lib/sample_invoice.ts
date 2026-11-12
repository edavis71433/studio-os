// ── A sample invoice, for "Send a test invoice to myself" (builder list item 175) ──
// Borrowed from Squarespace's Invoicing, where the first card is a test invoice that
// goes to yourself. Ours is the email a customer gets with an invoice, on the studio's
// real brand and Business details, with two sample lines and the PDF, sent to the
// person asking and nobody else. Nothing is created (no invoice, no number used, no
// Stripe link), so nothing can be paid: the pay button is drawn but leads nowhere, and
// the line under it says what a real one does. The words follow emailInvoice in
// routes/sales.ts; tests/presence/sample_invoice_test.mjs holds the two side by side
// so they don't drift apart. Pure. Since sales item 125 it wears the same new look: the
// band in the studio's colour on top, and the box with the due date and the amount.
import { emailBand, emailFacts } from './email_brand.ts';

export const SAMPLE_INVOICE_DUE_DAYS = 14;

/** The sample invoice row, shaped like a presence_invoices row: open, two lines adding up
 *  to its amount, issued today and due in two weeks on the studio's clock. Pure. */
export function sampleInvoice(nowIso: string, tz: string | null = null): Record<string, unknown> {
  const zone = (() => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/Los_Angeles' }); return tz || 'America/Los_Angeles'; } catch { return 'America/Los_Angeles'; } })();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowIso));
  const due = new Date(Date.parse(today + 'T12:00:00Z') + SAMPLE_INVOICE_DUE_DAYS * 86_400_000).toISOString().slice(0, 10);
  return {
    title: 'Test invoice', purpose: 'invoice', status: 'open', currency: 'usd',
    amount_cents: 45000, description: 'Website care',
    lines: [
      { label: 'Website care, one month', qty: 1, amount_cents: 30000 },
      { label: 'New photos on the Services page', qty: 2, amount_cents: 15000 },
    ],
    created_at: nowIso, due_date: due, number: null,
  };
}

/** Who the sample is billed to: a stand-in, never a real customer. */
export const SAMPLE_BILL_TO = { name: 'Your customer’s name', company: 'Their business', email: '', phone: '', address: '' };

const escH = (t: string) => t.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] as string));
const dollars = (cents: number) => '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The email, as emailInvoice writes it for a customer, with a note under the band saying it
 *  is a test and a pay button that is drawn but goes nowhere. `studioName` is '' when the
 *  studio has no name of its own yet (no "Studio OS" stand-in, as sales item 92 has it). Pure. */
export function sampleInvoiceEmail(o: { studioName: string; accent: string; amountCents: number; dueLabel: string; title: string; pdf: boolean }): { subject: string; html: string } {
  const amount = dollars(o.amountCents);
  const who = o.studioName ? escH(o.studioName) : '';
  const due = o.dueLabel ? `due ${escH(o.dueLabel)}` : 'due on receipt';
  const note = `<p style="margin:0 0 16px;padding:10px 14px;border-radius:10px;background:#f4f0fd;border:1px solid #dcd2f7;font-size:13px;color:#2b2540"><strong>This is a test.</strong> It’s the email your customers get with an invoice, sent only to you. No invoice was made and nothing can be paid.</p>`;
  const btn = `<span style="display:inline-block;margin-top:6px;background:${escH(o.accent)};color:#fff;padding:9px 16px;border-radius:999px;text-decoration:none">Pay ${amount} securely →</span>`;
  const how = `<p style="font-size:13px;color:#6b6478">On a real invoice, this button opens Stripe’s secure page for the amount, and the invoice marks itself paid when they pay.</p>`;
  const docLine = o.pdf ? `<p style="margin-top:6px">The invoice is attached as a PDF.</p>` : '';
  return {
    subject: `[Test] ${o.title} — ${amount}`,
    // the band has to come first: the email frame only reads it at the very start
    html: `${emailBand('Invoice', o.title)}${note}<p>Hi there,</p><p>${who ? `${who} has sent you` : 'Here is'} an invoice (${escH(o.title)}) for <strong>${amount}</strong>, ${due}. You can pay securely here — nothing else needed.</p>${emailFacts([['Due', o.dueLabel || 'On receipt'], ['Amount due', amount]], { big: true })}<p class="cta">${btn}</p>${how}${docLine}`,
  };
}
