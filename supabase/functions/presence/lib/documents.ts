// ── Branded, print-ready Documents of Record (Presence CMS Phase 2) ──────────
// Proposals/contracts today are plain-HTML email and invoices are Stripe-hosted;
// none is a clean, on-brand, keepable document. This module SERVER-RENDERS a
// self-contained, print-optimized branded HTML document for a proposal, an
// invoice, a deposit request/receipt, or a SIGNED contract — the last being the
// immutable Document of Record (the exact executed body + typed signer + UTC
// timestamp + the existing content_hash & signed_evidence rendered as a visible
// certificate). It RENDERS existing immutable data — it creates NO storage, NO
// table, NO column, NO migration, and adds NO external dependency. Sales item 82:
// the same documents also come as a real PDF (lib/doc_pdf.ts); the page's
// "Download PDF" fetches it, and "Print" stays for paper.
//
// Pure: no I/O, no clock, no randomness — same data + brand in → same bytes out,
// so every renderer is unit-testable. routes/sales.ts does the I/O (token verify,
// row load, brand load) and calls these. Brand is DERIVED from the Brand Kit via
// the same lib/email_brand.ts path the emails use (name + contrast-safe accent);
// line-item math reuses lib/sales_lifecycle.ts so the document can never disagree
// with the proposal it renders. Escaping reuses lib/markdown.ts `esc`.
import { esc } from './markdown.ts';
import { splitLineItems, computeProposalTotals, subtotalOf, type LineItem } from './sales_lifecycle.ts';
import { hmacHex, timingSafeEqual } from '../../_shared/hmac.ts';
import { UUID_RE } from './uuid.ts';

// ── the studio's identity on the page (structurally the EmailBrand shape) ─────
export interface DocBrand { name: string; accent: string; accentDark: string }
const DEFAULT_BRAND: DocBrand = { name: 'Studio OS', accent: '#5b3fa0', accentDark: '#3a2470' };

export type DocKind = 'proposal' | 'contract' | 'invoice' | 'estimate';   // estimate: item 47

// ── signed document token (own type `doc` so it can NEVER be mistaken for a
//    sign/accept token — a doc link only ever RENDERS, it never mutates). Mirrors
//    the house HMAC idiom used by routes/sales.ts signSalesToken. Pure: caller
//    passes the secret and the current epoch seconds, so there is no clock here. ─
export interface DocTokenPayload { t: 'doc'; k: DocKind; id: string; site_id: string; exp: number; e?: 1 }   // e: 1 = the copy linked from an email (item 69)
function b64url(s: string): string { return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64url(s: string): string { const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : ''; return atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad); }
const isKind = (k: unknown): k is DocKind => k === 'proposal' || k === 'contract' || k === 'invoice' || k === 'estimate';

export async function signDocToken(payload: DocTokenPayload, secret: string): Promise<string> {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${await hmacHex(secret, body)}`;
}
/** Verify a doc token: signature valid, well-formed, and unexpired at `nowSec`.
 *  Returns the payload or null. Pure (deterministic for a fixed nowSec). */
export async function verifyDocToken(token: string, secret: string, nowSec: number): Promise<DocTokenPayload | null> {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  if (!timingSafeEqual(parts[1], await hmacHex(secret, parts[0]))) return null;
  let p: any; try { p = JSON.parse(unb64url(parts[0])); } catch { return null; }
  if (!p || p.t !== 'doc' || !isKind(p.k) || !UUID_RE.test(p.id || '') || !UUID_RE.test(p.site_id || '') || typeof p.exp !== 'number') return null;
  if (p.exp < nowSec) return null;
  return p as DocTokenPayload;
}

// ── formatting (pure) ────────────────────────────────────────────────────────
const CUR_SYMBOL: Record<string, string> = { usd: '$', cad: '$', aud: '$', eur: '€', gbp: '£' };
export function money(cents: unknown, currency = 'usd'): string {
  const sym = CUR_SYMBOL[String(currency || 'usd').toLowerCase()] || '$';
  const n = (Math.round(Number(cents) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return sym + n;
}
/** The stored ISO timestamp as an unambiguous UTC stamp, e.g. "2026-07-11 14:03:22 UTC". */
export function utcStamp(iso: unknown): string {
  const s = String(iso || '');
  if (!s) return '';
  return s.slice(0, 19).replace('T', ' ') + ' UTC';
}
// ── sales item 81: what a proper invoice carries beyond its own row ──────────
/** A party on the page: the studio (From) or the client (Billed to). */
export interface DocParty { name?: string; company?: string; email?: string; phone?: string; address?: string }
/** A part payment recorded toward an invoice (item 77): its own paid row. */
export interface DocPayment { amount_cents: number; paid_at?: string | null; paid_method?: string; paid_note?: string }
/** Everything the page shows that isn't in the document's own row. All optional:
 *  a document renders without any of it, exactly as before. */
export interface DocContext {
  studio?: DocParty | null;        // From: the studio's Business details
  billTo?: DocParty | null;        // Billed to: the client
  tz?: string | null;              // the studio's time zone, for the dates
  pdfUrl?: string | null;          // this same document as a PDF (the toolbar's Download PDF)
  pdfName?: string | null;         // the file name it downloads as
  payments?: DocPayment[] | null;  // part payments recorded toward this invoice
  forWhat?: string | null;         // the deal it bills ("Website refresh")
}
/** "#0013" — the studio's running invoice number, or '' when there is none. Pure. */
export function invoiceNo(n: unknown): string {
  const v = Math.trunc(Number(n));
  return Number.isFinite(v) && v > 0 ? '#' + String(v).padStart(4, '0') : '';
}
const DEFAULT_TZ = 'America/Los_Angeles';
/** "Nov 4, 2026". A plain date ("2026-11-18") is that day; a moment is the day
 *  it was in the studio's time zone (Pacific when unknown). '' for nothing. Pure. */
export function dayLabel(v: unknown, tz?: string | null): string {
  const s = String(v || '').trim();
  if (!s) return '';
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s);
  const t = Date.parse(dateOnly ? s + 'T12:00:00Z' : s);
  if (!Number.isFinite(t)) return '';
  const fmt = (zone: string) => new Intl.DateTimeFormat('en-US', { timeZone: zone, month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(t));
  try { return fmt(dateOnly ? 'UTC' : (tz || DEFAULT_TZ)); } catch { return fmt(dateOnly ? 'UTC' : DEFAULT_TZ); }
}
/** How a payment came in, as the end of a sentence: "by check", "in cash",
 *  "online" (Stripe: card or bank). Pure. */
export function payMethodWords(m: unknown): string {
  const k = String(m || '');
  return k === 'check' ? 'by check' : k === 'cash' ? 'in cash' : k === 'bank_transfer' ? 'by bank transfer' : k === 'zelle' ? 'by Zelle' : k === 'other' ? '' : 'online';
}
/** "Paid Nov 11, 2026 by check · Check #1042". Pure. */
export function paidLine(p: { paid_at?: unknown; paid_method?: unknown; paid_note?: unknown }, tz?: string | null): string {
  const day = dayLabel(p?.paid_at, tz);
  const how = payMethodWords(p?.paid_method);
  const note = String(p?.paid_note || '').trim();
  return ['Paid' + (day ? ' ' + day : '') + (how ? ' ' + how : ''), note].filter(Boolean).join(' · ');
}
/** A party's lines, top to bottom: name, company, each address line, email, phone. Pure. */
export function partyLines(p?: DocParty | null): string[] {
  if (!p) return [];
  const out: string[] = [];
  const push = (v: unknown) => { const t = String(v ?? '').trim(); if (t && !out.includes(t)) out.push(t); };
  push(p.name); push(p.company);
  for (const l of String(p.address || '').split(/\r?\n/)) push(l);
  push(p.email); push(p.phone);
  return out;
}
export interface InvoiceLine { label: string; qty: number; amount_cents: number }
/** The invoice's lines, which always add up to what it bills: its own stored lines
 *  (billed from the proposal), else one line, its description. `billedCents` is the
 *  amount before any part payment (the row's amount plus what was paid toward it). Pure. */
export function invoiceLines(v: any, billedCents: number): InvoiceLine[] {
  const raw = Array.isArray(v?.lines) ? v.lines : [];
  const lines: InvoiceLine[] = raw
    .filter((l: any) => l && typeof l === 'object' && String(l.label || '').trim())
    .map((l: any) => ({ label: String(l.label).trim().slice(0, 200), qty: Math.max(1, Math.trunc(Number(l.qty) || 1)), amount_cents: Math.round(Number(l.amount_cents) || 0) }));
  if (lines.length && lines.reduce((n, l) => n + l.amount_cents, 0) === billedCents) return lines;
  return [{ label: String(v?.description || v?.title || 'Invoice').trim(), qty: 1, amount_cents: billedCents }];
}

const brandOf = (b?: Partial<DocBrand> | null): DocBrand => ({
  name: (b?.name || '').trim() || DEFAULT_BRAND.name,
  accent: b?.accent || DEFAULT_BRAND.accent,
  accentDark: b?.accentDark || DEFAULT_BRAND.accentDark,
});

// ── the ONE branded print-ready shell every document is wrapped in ────────────
// Self-contained: inline styles, no external assets. On screen it's a calm card;
// @media print hides the toolbar/chrome, drops shadows, and sets page margins so
// the browser's Save-as-PDF yields a clean, keepable document.
function shell(o: { title: string; brand: DocBrand; docLabel: string; heading: string; sub?: string; bodyHtml: string; pdfUrl?: string | null; pdfName?: string | null; headHtml?: string }): string {
  const b = o.brand;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">
<title>${esc(o.title)}</title>
<style>
  :root{--accent:${b.accent};--accent-deep:${b.accentDark};--ink:#1b1525;--soft:#6b6478;--line:#e9e4dc;--bg:#f6f4f1;--card:#fff;
    --serif:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  *{box-sizing:border-box;margin:0}
  body{background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.6;-webkit-font-smoothing:antialiased}
  .page{max-width:760px;margin:0 auto;padding:26px 20px 80px}
  .toolbar{display:flex;justify-content:flex-end;gap:10px;margin-bottom:16px}
  .toolbar button{font-family:inherit;font-size:14px;font-weight:600;border-radius:999px;border:1px solid var(--accent);background:var(--accent);color:#fff;padding:10px 20px;cursor:pointer}
  .paper{background:var(--card);border:1px solid var(--line);border-radius:16px;overflow:hidden;box-shadow:0 1px 2px rgba(27,21,37,.04),0 10px 30px rgba(27,21,37,.06)}
  .accentbar{height:6px;background:var(--accent)}
  .inner{padding:34px 40px 40px}
  .wordmark{font-family:var(--serif);font-weight:600;font-size:22px;color:var(--accent-deep);letter-spacing:-.01em}
  .doclabel{text-transform:uppercase;letter-spacing:.09em;font-size:11.5px;font-weight:700;color:var(--soft);margin:26px 0 3px}
  h1{font-family:var(--serif);font-weight:500;font-size:clamp(23px,4.4vw,30px);line-height:1.2;margin:0 0 4px}
  .sub{color:var(--soft);font-size:14.5px;margin:0}
  .hr{height:1px;background:var(--line);margin:26px 0}
  table{width:100%;border-collapse:collapse;font-size:14.5px}
  td{padding:10px 2px;border-bottom:1px solid var(--line);vertical-align:top}
  td:last-child{text-align:right;white-space:nowrap}
  tr.total td{font-weight:700;font-size:16px;border-bottom:none;padding-top:14px}
  .body{white-space:pre-wrap;font-size:14.5px;overflow-wrap:anywhere;line-height:1.7}
  .terms{color:var(--soft);font-size:13.5px;white-space:pre-wrap;overflow-wrap:anywhere;margin-top:6px}
  .amountbox{display:flex;justify-content:space-between;align-items:baseline;gap:16px;background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:16px 20px;margin:8px 0}
  .amountbox .n{font-family:var(--serif);font-size:26px;font-weight:600}
  .pill{display:inline-block;font-size:12px;font-weight:700;padding:3px 11px;border-radius:999px}
  .pill.paid{background:#e7f1ea;color:#2c5c42}.pill.due{background:#f6ecda;color:#775d31}.pill.void{background:#efecea;color:#6b6478}
  .paylink{display:inline-block;background:var(--accent);color:#fff;font-weight:600;padding:11px 22px;border-radius:999px;text-decoration:none;margin-top:6px}
  .cert{border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin-top:8px;background:var(--bg)}
  .cert h2{font-family:var(--sans);font-size:13px;text-transform:uppercase;letter-spacing:.07em;color:var(--soft);margin:0 0 10px}
  .kv{display:flex;justify-content:space-between;gap:16px;padding:7px 0;border-bottom:1px solid var(--line);font-size:14px}
  .kv:last-of-type{border-bottom:none}
  .kv .k{color:var(--soft);white-space:nowrap}
  .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;overflow-wrap:anywhere;text-align:right}
  .note{color:var(--soft);font-size:12.5px;margin-top:12px}
  .toolbar .ghost{background:transparent;color:var(--accent)}
  .head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;flex-wrap:wrap}
  .from{color:var(--soft);font-size:13px;line-height:1.5;margin-top:4px}
  .docno{text-align:right}.docno .lbl{text-transform:uppercase;letter-spacing:.09em;font-size:11.5px;font-weight:700;color:var(--soft)}
  .docno .no{font-family:var(--serif);font-size:24px;font-weight:600;line-height:1.25}
  .parties{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:4px 0 18px}
  .party{background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:12px 16px;font-size:14px;line-height:1.55;overflow-wrap:anywhere}
  .party .k{text-transform:uppercase;letter-spacing:.08em;font-size:11px;font-weight:700;color:var(--soft);margin-bottom:2px}
  .party .first{font-weight:600}
  th{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--soft);text-align:left;font-weight:700;padding:8px 2px;border-bottom:1px solid var(--line)}
  th:last-child{text-align:right}
  td.qty,th.qty{text-align:right;width:56px;color:var(--soft)}
  tr.less td{color:var(--soft)}
  .paidbox{background:#e7f1ea;border:1px solid #cfe4d6;color:#2c5c42;border-radius:12px;padding:12px 16px;margin-top:14px;font-size:14px}
  @media (max-width:560px){.parties{grid-template-columns:1fr}.inner{padding:24px 20px 28px}.docno{text-align:left}}
  footer{color:var(--soft);font-size:12px;text-align:center;margin-top:22px;line-height:1.5}
  @media print{
    @page{margin:14mm}
    body{background:#fff}
    .no-print,.toolbar{display:none!important}
    .page{max-width:100%;padding:0}
    .paper{box-shadow:none;border:none;border-radius:0}
    .inner{padding:0}
    .cert,tr,.amountbox{page-break-inside:avoid;break-inside:avoid}
  }
</style></head>
<body>
<div class="page">
  <div class="toolbar no-print">${o.pdfUrl ? '<button type="button" class="ghost" onclick="window.print()">Print</button><button type="button" id="dlpdf">Download PDF</button>' : '<button type="button" onclick="window.print()">Save as PDF / Print</button>'}</div>
  <div class="paper"><div class="accentbar"></div><div class="inner">
    ${o.headHtml || `<div class="wordmark">${esc(b.name)}</div>
    <div class="doclabel">${esc(o.docLabel)}</div>`}
    <h1>${esc(o.heading)}</h1>
    ${o.sub ? `<p class="sub">${esc(o.sub)}</p>` : ''}
    <div class="hr"></div>
    ${o.bodyHtml}
  </div></div>
  <footer>Prepared by ${esc(b.name)}. Keep this document for your records — reprint any time from your original link.</footer>
</div>${o.pdfUrl ? pdfScript(o.pdfUrl, o.pdfName || 'document.pdf') : ''}
</body></html>`;
}
/** Sales item 82: "Download PDF" fetches the PDF and saves it under its own name.
 *  Fetching (rather than a plain link) keeps the file's type whatever the host
 *  answers with, and works on a phone. The URL is JSON-escaped into the script. */
function pdfScript(url: string, name: string): string {
  const j = (v: string) => JSON.stringify(v).replace(/</g, '\\u003c');
  return `<script>(function(){var b=document.getElementById('dlpdf');if(!b)return;b.addEventListener('click',async function(){var u=${j(url)};b.disabled=true;b.textContent='Preparing…';try{var r=await fetch(u);if(!r.ok)throw new Error(String(r.status));var blob=new Blob([await r.arrayBuffer()],{type:'application/pdf'});var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=${j(name)};document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove();},5000);b.textContent='Download PDF';}catch(e){b.textContent='Couldn’t download — try again';}b.disabled=false;});})();</script>`;
}

// ── PROPOSAL (and ESTIMATE, item 47 — the same lines, its own label and note) ──
export function renderProposalDocument(p: any, brandIn?: Partial<DocBrand> | null, ctx?: DocContext | null): string {
  const statusNote = p?.status === 'accepted' ? 'Accepted — thank you.'
    : p?.status === 'declined' ? 'This proposal was declined.'
    : 'This is a proposal — nothing is final until you accept.';
  return renderLineItemsDocument(p, brandIn, { docLabel: 'Proposal', heading: String(p?.title || 'Proposal'), note: statusNote }, ctx);
}
/** An estimate prints like a proposal: its lines, discount, tax and total, its
 *  notes, and a closing line that says what it is (and how long it is good for). */
export function renderEstimateDocument(e: any, brandIn?: Partial<DocBrand> | null, ctx?: DocContext | null): string {
  const until = /^\d{4}-\d{2}-\d{2}/.test(String(e?.expires_at || '')) ? String(e.expires_at).slice(0, 10) : '';
  const note = e?.status === 'approved' ? 'Approved — thank you.'
    : e?.status === 'declined' ? 'You chose not now on this estimate.'
    : `This is an estimate, not a final price — nothing is charged until you get an invoice.${until ? ` Good until ${until}.` : ''}`;
  return renderLineItemsDocument(e, brandIn, { docLabel: 'Estimate', heading: String(e?.title || 'Estimate'), note }, ctx);
}
function renderLineItemsDocument(p: any, brandIn: Partial<DocBrand> | null | undefined, o: { docLabel: string; heading: string; note: string }, ctx?: DocContext | null): string {
  const brand = brandOf(brandIn);
  // Unpack the real line items from the reserved discount/tax meta, then recompute
  // the whole breakdown — the document can never disagree with the stored math.
  const { items, meta } = splitLineItems(p?.line_items);
  const currency = String(p?.currency || 'usd');
  const t = computeProposalTotals(items, meta);
  // Nov 10 review (G11): a line's amount by the total's own rule (subtotalOf), so a
  // quantity-0 line reads "× 0" and $0.00 instead of a price the total never counted.
  const rows = items.length
    ? items.map((i) => `<tr><td>${esc(i.label)}${i.qty !== 1 ? ` <span style="color:var(--soft)">× ${i.qty}</span>` : ''}</td><td>${esc(money(subtotalOf([i]), currency))}</td></tr>`).join('')
    : `<tr><td colspan="2" style="color:var(--soft)">No line items.</td></tr>`;
  // Show the breakdown ONLY when a discount or tax applies; otherwise the total
  // is the subtotal and one clean Total line is all that's honest to print.
  const hasBreakdown = t.discount_cents > 0 || t.tax_cents > 0;
  const discLabel = meta.discount?.mode === 'percent' ? `Discount (${Number(meta.discount.value)}%)` : 'Discount';
  const taxLabel = (meta.tax_pct != null) ? `Tax (${Number(meta.tax_pct)}%)` : 'Tax';
  const breakdown = hasBreakdown ? `
      <tr class="sub"><td style="color:var(--soft)">Subtotal</td><td style="color:var(--soft)">${esc(money(t.subtotal_cents, currency))}</td></tr>
      ${t.discount_cents > 0 ? `<tr class="sub"><td style="color:var(--soft)">${esc(discLabel)}</td><td style="color:var(--soft)">−${esc(money(t.discount_cents, currency))}</td></tr>` : ''}
      ${t.tax_cents > 0 ? `<tr class="sub"><td style="color:var(--soft)">${esc(taxLabel)}</td><td style="color:var(--soft)">+${esc(money(t.tax_cents, currency))}</td></tr>` : ''}` : '';
  const body = `
    <table><tbody>${rows}${breakdown}<tr class="total"><td>Total</td><td>${esc(money(t.total_cents, currency))}</td></tr></tbody></table>
    ${p?.terms ? `<div class="hr"></div><p class="terms">${esc(p.terms)}</p>` : ''}
    <p class="note">${esc(o.note)}</p>`;
  return shell({ title: `${o.heading} — ${brand.name}`, brand, docLabel: o.docLabel, heading: o.heading, sub: undefined, bodyHtml: body, pdfUrl: ctx?.pdfUrl, pdfName: ctx?.pdfName });
}

// ── INVOICE / DEPOSIT / RECEIPT ──────────────────────────────────────────────
// Sales item 81: a proper invoice a client's bookkeeper can file. The studio's
// running number, who it's from and who it's billed to (both addresses), its lines,
// when it was issued and when it's due, and on a paid one when and how it was paid.
// A part payment recorded toward it (item 77) shows as a line of its own.
/** The word the page leads with. Pure. */
export function invoiceDocLabel(v: any): string {
  return v?.status === 'paid' ? 'Receipt' : v?.purpose === 'deposit' ? 'Deposit request' : 'Invoice';
}
export function renderInvoiceDocument(v: any, brandIn?: Partial<DocBrand> | null, ctx?: DocContext | null): string {
  const brand = brandOf(brandIn);
  const tz = ctx?.tz || null;
  const currency = String(v?.currency || 'usd');
  const paid = v?.status === 'paid';
  const voided = v?.status === 'void';
  const isDeposit = v?.purpose === 'deposit';
  const docLabel = invoiceDocLabel(v);
  const heading = String(v?.title || (isDeposit ? 'Deposit' : 'Invoice'));
  const no = invoiceNo(v?.number);
  const pill = paid ? '<span class="pill paid">Paid</span>' : voided ? '<span class="pill void">Voided</span>' : '<span class="pill due">Amount due</span>';
  // the head: who it's from on the left, what it is and its number on the right
  const from = partyLines(ctx?.studio ? { ...ctx.studio, name: '' } : null);
  const headHtml = `<div class="head"><div><div class="wordmark">${esc(brand.name)}</div>${from.length ? `<div class="from">${from.map(esc).join('<br>')}</div>` : ''}</div>
      <div class="docno"><div class="lbl">${esc(docLabel)}</div>${no ? `<div class="no">${esc(no)}</div>` : ''}<div>${pill}</div></div></div>
    <div class="doclabel" style="margin-top:22px">${esc(ctx?.forWhat ? 'For ' + ctx.forWhat : docLabel)}</div>`;
  // Billed to · Details
  const billTo = partyLines(ctx?.billTo);
  const details: string[] = [];
  if (no) details.push(`${paid ? 'Receipt for invoice' : 'Invoice no.'} ${no}`);
  if (v?.created_at) details.push('Issued ' + dayLabel(v.created_at, tz));
  if (!paid && !voided) details.push(v?.due_date ? 'Due ' + dayLabel(v.due_date, tz) : 'Due on receipt');
  if (paid) details.push(paidLine(v, tz));
  if (voided) details.push('Voided — no longer payable');
  const box = (k: string, lines: string[]) => `<div class="party"><div class="k">${esc(k)}</div>${lines.map((l, i) => i === 0 ? `<div class="first">${esc(l)}</div>` : `<div>${esc(l)}</div>`).join('')}</div>`;
  const parties = `<div class="parties">${billTo.length ? box('Billed to', billTo) : ''}${box('Details', details)}</div>`;
  // the lines: they add up to what was billed (the row's amount plus any part payments)
  const payments = (Array.isArray(ctx?.payments) ? ctx!.payments! : []).filter((p) => Number(p?.amount_cents) > 0);
  const paidParts = payments.reduce((n, p) => n + Math.round(Number(p.amount_cents) || 0), 0);
  const amount = Math.round(Number(v?.amount_cents) || 0);
  const billed = amount + paidParts;
  const lines = invoiceLines(v, billed);
  const rows = lines.map((l) => `<tr${l.amount_cents < 0 ? ' class="less"' : ''}><td>${esc(l.label)}</td><td class="qty">${l.qty !== 1 ? esc(String(l.qty)) : ''}</td><td>${esc(l.amount_cents < 0 ? '−' + money(-l.amount_cents, currency) : money(l.amount_cents, currency))}</td></tr>`).join('');
  const partRows = payments.map((p) => `<tr class="less"><td>${esc(paidLine(p, tz))}</td><td class="qty"></td><td>−${esc(money(p.amount_cents, currency))}</td></tr>`).join('');
  const totalLabel = paid ? 'Total paid' : voided ? 'Total (voided)' : 'Amount due';
  const totalCents = paid ? billed : amount;
  const table = `<table><thead><tr><th>Description</th><th class="qty">Qty</th><th>Amount</th></tr></thead><tbody>${rows}${payments.length && !paid ? `<tr><td style="color:var(--soft)">Total</td><td class="qty"></td><td style="color:var(--soft)">${esc(money(billed, currency))}</td></tr>` + partRows : ''}<tr class="total"><td>${esc(totalLabel)}</td><td class="qty"></td><td>${esc(money(totalCents, currency))}</td></tr></tbody></table>`;
  const paidBox = paid ? `<div class="paidbox">${esc(paidLine(v, tz))}${payments.length ? ` · with ${payments.length} earlier part payment${payments.length === 1 ? '' : 's'}: ${esc(payments.map((p) => paidLine(p, tz)).join('; '))}` : ''}</div>` : '';
  // A live pay link is an ACTION, not part of the printed record → no-print.
  const pay = (!paid && !voided && v?.stripe_url)
    ? `<p class="no-print" style="margin-top:16px"><a class="paylink" href="${esc(String(v.stripe_url))}">Pay ${esc(money(v?.amount_cents, currency))} securely →</a></p>`
    : '';
  const note = paid ? 'Thank you — this is your receipt of payment.'
    : voided ? 'This request was voided and is no longer payable.'
    : `Payment is processed securely.${no ? ` Please quote ${no} with any payment by check or transfer.` : ''} This document is your copy of the request.`;
  const body = `${parties}${table}${paidBox}${pay}<p class="note">${esc(note)}</p>`;   // the table's bold total is the amount (the old amount box said it twice)
  return shell({ title: `${heading}${no ? ' ' + no : ''} — ${brand.name}`, brand, docLabel, heading, sub: undefined, bodyHtml: body, pdfUrl: ctx?.pdfUrl, pdfName: ctx?.pdfName, headHtml });
}

// ── CONTRACT (draft/sent = copy · signed = Document of Record) ────────────────
export function renderContractDocument(c: any, brandIn?: Partial<DocBrand> | null, ctx?: DocContext | null): string {
  const brand = brandOf(brandIn);
  const signed = c?.status === 'signed';
  const ev = (c?.signed_evidence && typeof c.signed_evidence === 'object') ? c.signed_evidence : {};
  const hash = String(c?.content_hash || ev?.hash || '');
  let cert = '';
  if (signed) {
    // The certificate of record: rendered ENTIRELY from existing immutable data —
    // the typed signer, the ONE signing timestamp (UTC), the document fingerprint
    // (content_hash — signing bound to it, so it identifies the exact executed
    // text), and the stored signing evidence (hashed signer IP). No new data.
    const rows: string[] = [];
    rows.push(`<div class="kv"><span class="k">Signed by</span><span>${esc(String(c?.signer_name || ''))}</span></div>`);
    if (c?.signer_email) rows.push(`<div class="kv"><span class="k">Signer email</span><span>${esc(String(c.signer_email))}</span></div>`);
    rows.push(`<div class="kv"><span class="k">Signed at</span><span>${esc(utcStamp(c?.signed_at || ev?.at))}</span></div>`);
    rows.push(`<div class="kv"><span class="k">Document fingerprint (SHA-256)</span><span class="mono">${esc(hash)}</span></div>`);
    if (ev?.ip_hash) rows.push(`<div class="kv"><span class="k">Signing evidence (hashed IP)</span><span class="mono">${esc(String(ev.ip_hash))}</span></div>`);
    cert = `<div class="hr"></div><div class="cert"><h2>Certificate of record</h2>${rows.join('')}
      <p class="note">Typing a name to sign constitutes an electronic signature. The fingerprint identifies the exact text that was signed — it changes if even one character does, so this copy is tamper-evident.</p></div>`;
  }
  const statusSub = signed ? 'Executed copy — this is the signed document of record.'
    : c?.status === 'sent' ? 'Sent for signature — not yet signed.'
    : 'Draft — not yet sent for signature.';
  const body = `<div class="body">${esc(String(c?.body || ''))}</div>${cert}${signed ? '' : `<p class="note">This copy is not an executed agreement until it is signed.</p>`}`;
  return shell({ title: `${c?.title || 'Agreement'} — ${brand.name}`, brand, docLabel: signed ? 'Signed agreement' : 'Agreement', heading: String(c?.title || 'Service agreement'), sub: statusSub, bodyHtml: body, pdfUrl: ctx?.pdfUrl, pdfName: ctx?.pdfName });
}

/** Dispatch by kind. `data` is an already-loaded, site-scoped row. Pure. */
export function renderDocument(kind: DocKind, data: any, brand?: Partial<DocBrand> | null, ctx?: DocContext | null): string {
  if (kind === 'proposal') return renderProposalDocument(data, brand, ctx);
  if (kind === 'estimate') return renderEstimateDocument(data, brand, ctx);
  if (kind === 'invoice') return renderInvoiceDocument(data, brand, ctx);
  return renderContractDocument(data, brand, ctx);
}
