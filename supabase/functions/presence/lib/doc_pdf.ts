// ── The documents as real PDFs (sales item 82) ───────────────────────────────
// The same invoice, receipt, proposal, estimate and agreement lib/documents.ts
// draws as a page, laid out on US Letter with lib/pdf.ts: the studio's name in its
// colour, who it's from and who it's billed to, the lines and totals, and for a
// signed agreement the certificate of record. Pure: the caller (routes/sales.ts)
// loads the row, the brand and the context; same input, same bytes.
import { PdfDoc, rgb, textWidth, wrapText, type PdfFont, type Rgb } from './pdf.ts';
import {
  money, utcStamp, invoiceNo, dayLabel, paidLine, partyLines, invoiceLines, invoiceDocLabel,
  type DocBrand, type DocContext, type DocKind,
} from './documents.ts';
import { splitLineItems, computeProposalTotals, subtotalOf } from './sales_lifecycle.ts';
import { agreementBlocks } from './agreement_layout.ts';   // sales item 88: the agreement as a document
import { scheduleView } from './proposal_schedule.ts';   // sales item 106: paid in parts

const INK: Rgb = [0.106, 0.082, 0.145];
const SOFT: Rgb = [0.42, 0.392, 0.471];
const LINE: Rgb = [0.914, 0.894, 0.863];
const PANEL: Rgb = [0.965, 0.957, 0.945];
const GOOD: Rgb = [0.173, 0.361, 0.259];
const GOOD_BG: Rgb = [0.906, 0.945, 0.918];
const WARN: Rgb = [0.467, 0.365, 0.192];
const L = 54, R = 558, W = R - L, TOP = 742, BOTTOM = 72;

/** A cursor that flows down the page and starts a new one when it runs out. */
class Flow {
  y = TOP;
  constructor(readonly pdf: PdfDoc) {}
  need(h: number): void { if (this.y - h < BOTTOM) { this.pdf.addPage(); this.y = TOP; } }
  gap(h: number): void { this.y -= h; }
  /** Wrapped text from the left edge (plus `indent`), `width` wide. */
  para(s: unknown, o: { font?: PdfFont; size?: number; color?: Rgb; indent?: number; width?: number; lead?: number } = {}): void {
    const size = o.size || 10, font = o.font || 'R', lead = o.lead || size * 1.45;
    for (const line of wrapText(s, font, size, (o.width || W) - (o.indent || 0))) {
      this.need(lead);
      if (line) this.pdf.text(L + (o.indent || 0), this.y - size, line, { font, size, color: o.color || INK });
      this.y -= lead;
    }
  }
  rule(color: Rgb = LINE): void { this.pdf.line(L, this.y, R, this.y, color, 0.75); }
}

function newPdf(title: string): PdfDoc { return new PdfDoc(title); }

/** The first page's top: the colour bar, the studio's name and lines, and on the
 *  right what the document is, its number and its state. Returns the flow below it. */
function head(pdf: PdfDoc, brand: DocBrand, o: { label: string; no?: string; state?: string; stateColor?: Rgb; from?: string[] }): Flow {
  const accent = rgb(brand.accent), deep = rgb(brand.accentDark, accent);
  pdf.rect(0, 786, 612, 6, accent);
  const f = new Flow(pdf);
  pdf.text(L, f.y - 18, brand.name, { font: 'B', size: 18, color: deep });
  let ly = f.y - 34;
  for (const l of (o.from || []).slice(0, 5)) { pdf.text(L, ly, l, { size: 9, color: SOFT }); ly -= 12; }
  pdf.textRight(R, f.y - 10, o.label.toUpperCase(), { font: 'B', size: 9, color: SOFT });
  if (o.no) pdf.textRight(R, f.y - 32, o.no, { font: 'B', size: 20, color: INK });
  if (o.state) pdf.textRight(R, f.y - (o.no ? 48 : 26), o.state, { font: 'B', size: 9.5, color: o.stateColor || SOFT });
  f.y = Math.min(ly, f.y - 56) - 14;
  return f;
}

/** Two side-by-side boxes ("Billed to", "Details"), each a list of lines. */
function boxes(f: Flow, cols: Array<{ title: string; lines: string[] }>): void {
  const live = cols.filter((c) => c.lines.length);
  if (!live.length) return;
  const gapX = 14, bw = (W - gapX * (live.length - 1)) / live.length, size = 9.5, lead = 13.5;
  const wrapped = live.map((c) => c.lines.flatMap((l) => wrapText(l, 'R', size, bw - 24)));
  const h = 30 + Math.max(...wrapped.map((w) => w.length)) * lead + 6;
  f.need(h);
  live.forEach((c, i) => {
    const x = L + i * (bw + gapX);
    f.pdf.rect(x, f.y - h, bw, h, PANEL);
    f.pdf.text(x + 12, f.y - 16, c.title.toUpperCase(), { font: 'B', size: 8, color: SOFT });
    wrapped[i].forEach((l, j) => f.pdf.text(x + 12, f.y - 32 - j * lead, l, { font: j === 0 ? 'B' : 'R', size, color: j === 0 ? INK : SOFT }));
  });
  f.y -= h + 18;
}

/** The lines table: Description · Qty · Amount, then totals (bold last). */
function table(f: Flow, rows: Array<{ label: string; qty?: string; amount: string; soft?: boolean }>, totals: Array<{ label: string; amount: string; bold?: boolean }>): void {
  const qtyRight = R - 110, size = 10, lead = 14;
  f.need(24);
  f.pdf.text(L, f.y - 10, 'DESCRIPTION', { font: 'B', size: 8, color: SOFT });
  f.pdf.textRight(qtyRight, f.y - 10, 'QTY', { font: 'B', size: 8, color: SOFT });
  f.pdf.textRight(R, f.y - 10, 'AMOUNT', { font: 'B', size: 8, color: SOFT });
  f.gap(16); f.rule();
  for (const r of rows) {
    const lines = wrapText(r.label, 'R', size, qtyRight - L - 60);
    const h = lines.length * lead + 10;
    f.need(h);
    lines.forEach((l, i) => f.pdf.text(L, f.y - 14 - i * lead, l, { size, color: r.soft ? SOFT : INK }));
    if (r.qty) f.pdf.textRight(qtyRight, f.y - 14, r.qty, { size, color: SOFT });
    f.pdf.textRight(R, f.y - 14, r.amount, { size, color: r.soft ? SOFT : INK });
    f.gap(h); f.rule();
  }
  for (const t of totals) {
    f.need(22);
    const font: PdfFont = t.bold ? 'B' : 'R';
    const sz = t.bold ? 11.5 : 10;
    f.pdf.text(L, f.y - 15, t.label, { font, size: sz, color: t.bold ? INK : SOFT });
    f.pdf.textRight(R, f.y - 15, t.amount, { font, size: sz, color: t.bold ? INK : SOFT });
    f.gap(22);
  }
  f.gap(6);
}

/** A tinted panel holding a few wrapped lines. */
function panel(f: Flow, lines: string[], o: { bg?: Rgb; color?: Rgb; bold?: boolean } = {}): void {
  const size = 10, lead = 14;
  const wrapped = lines.flatMap((l) => wrapText(l, 'R', size, W - 28));
  const h = wrapped.length * lead + 16;
  f.need(h);
  f.pdf.rect(L, f.y - h, W, h, o.bg || PANEL);
  wrapped.forEach((l, i) => f.pdf.text(L + 14, f.y - 18 - i * lead, l, { font: o.bold && i === 0 ? 'B' : 'R', size, color: o.color || INK }));
  f.y -= h + 12;
}

/** Every page's foot: what it is and "Page 1 of 2", once the count is known. */
function feet(pdf: PdfDoc, left: string): void {
  const n = pdf.pageCount;
  for (let i = 0; i < n; i++) {
    pdf.onPage(i, () => {
      pdf.line(L, 50, R, 50, LINE, 0.5);
      pdf.text(L, 36, left, { size: 8, color: SOFT });
      if (n > 1) pdf.textRight(R, 36, `Page ${i + 1} of ${n}`, { size: 8, color: SOFT });
    });
  }
}
const fromLines = (ctx?: DocContext | null) => partyLines(ctx?.studio ? { ...ctx.studio, name: '' } : null);
const brandOf = (b?: Partial<DocBrand> | null): DocBrand => ({ name: (b?.name || '').trim() || 'Studio OS', accent: b?.accent || '#5b3fa0', accentDark: b?.accentDark || '#3a2470' });

// ── INVOICE / DEPOSIT REQUEST / RECEIPT ──────────────────────────────────────
export function invoicePdf(v: any, brandIn?: Partial<DocBrand> | null, ctx?: DocContext | null): Uint8Array<ArrayBuffer> {
  const brand = brandOf(brandIn), tz = ctx?.tz || null, currency = String(v?.currency || 'usd');
  const paid = v?.status === 'paid', voided = v?.status === 'void';
  const label = invoiceDocLabel(v), no = invoiceNo(v?.number);
  const title = String(v?.title || (v?.purpose === 'deposit' ? 'Deposit' : 'Invoice'));
  const pdf = newPdf(`${label}${no ? ' ' + no : ''} — ${title}`);
  const f = head(pdf, brand, { label, no, state: paid ? 'PAID' : voided ? 'VOIDED' : 'AMOUNT DUE', stateColor: paid ? GOOD : voided ? SOFT : WARN, from: fromLines(ctx) });
  f.para(ctx?.forWhat ? `For ${ctx.forWhat}` : label, { font: 'B', size: 8.5, color: SOFT });
  f.para(title, { font: 'B', size: 16, lead: 22 });
  f.gap(8);
  const details: string[] = [];
  if (no) details.push(`${paid ? 'Receipt for invoice' : 'Invoice no.'} ${no}`);
  if (v?.created_at) details.push('Issued ' + dayLabel(v.created_at, tz));
  if (!paid && !voided) details.push(v?.due_date ? 'Due ' + dayLabel(v.due_date, tz) : 'Due on receipt');
  if (paid) details.push(paidLine(v, tz));
  if (voided) details.push('Voided: no longer payable');
  boxes(f, [{ title: 'Billed to', lines: partyLines(ctx?.billTo) }, { title: 'Details', lines: details }]);
  const payments = (Array.isArray(ctx?.payments) ? ctx!.payments! : []).filter((p) => Number(p?.amount_cents) > 0);
  const amount = Math.round(Number(v?.amount_cents) || 0);
  const billed = amount + payments.reduce((n, p) => n + Math.round(Number(p.amount_cents) || 0), 0);
  const lines = invoiceLines(v, billed);
  const fmt = (c: number) => (c < 0 ? '-' + money(-c, currency) : money(c, currency));
  const rows = lines.map((l) => ({ label: l.label, qty: l.qty !== 1 ? String(l.qty) : '', amount: fmt(l.amount_cents), soft: l.amount_cents < 0 }));
  // a part payment reads under the total it came off: Total, Paid Nov 8 by Zelle, Amount due
  const totals = [
    ...(payments.length && !paid ? [{ label: 'Total', amount: money(billed, currency) }, ...payments.map((p) => ({ label: paidLine(p, tz), amount: fmt(-Math.round(Number(p.amount_cents) || 0)) }))] : []),
    { label: paid ? 'Total paid' : voided ? 'Total (voided)' : 'Amount due', amount: money(paid ? billed : amount, currency), bold: true },
  ];
  table(f, rows, totals);
  if (paid) panel(f, [paidLine(v, tz), ...payments.map((p) => 'Earlier part payment: ' + paidLine(p, tz))], { bg: GOOD_BG, color: GOOD, bold: true });
  if (!paid && !voided && v?.stripe_url) {
    const url = String(v.stripe_url);
    f.para('Pay securely online:', { font: 'B', size: 10 });
    const before = f.y;
    f.para(url, { size: 9.5, color: rgb(brand.accentDark) });
    pdf.link(L, f.y, Math.min(W, textWidth(url, 'R', 9.5)), before - f.y, url);
    f.gap(6);
  }
  f.para(paid ? 'Thank you. This is your receipt of payment.'
    : voided ? 'This request was voided and is no longer payable.'
    : `${no ? `Please quote ${no} with any payment by check or transfer. ` : ''}Keep this document for your records.`, { size: 9, color: SOFT });
  feet(pdf, `${brand.name}${no ? ' · ' + label + ' ' + no : ''}`);
  return pdf.bytes();
}

// ── PROPOSAL and ESTIMATE ─────────────────────────────────────────────────────
function linesPdf(p: any, brandIn: Partial<DocBrand> | null | undefined, ctx: DocContext | null | undefined, o: { label: string; note: string; state?: string; stateColor?: Rgb }): Uint8Array<ArrayBuffer> {
  const brand = brandOf(brandIn), currency = String(p?.currency || 'usd');
  const title = String(p?.title || o.label);
  const pdf = newPdf(`${o.label} — ${title}`);
  const f = head(pdf, brand, { label: o.label, state: o.state, stateColor: o.stateColor, from: fromLines(ctx) });
  f.para(title, { font: 'B', size: 16, lead: 22 });
  f.gap(10);
  if (ctx?.billTo) boxes(f, [{ title: 'Prepared for', lines: partyLines(ctx.billTo) }]);
  const { items, meta } = splitLineItems(p?.line_items);
  const t = computeProposalTotals(items, meta);
  const rows = items.map((i) => ({ label: i.label, qty: i.qty !== 1 ? String(i.qty) : '', amount: money(subtotalOf([i]), currency) }));
  if (!rows.length) rows.push({ label: 'No line items.', qty: '', amount: '', soft: true } as any);
  const totals: Array<{ label: string; amount: string; bold?: boolean }> = [];
  if (t.discount_cents > 0 || t.tax_cents > 0) {
    totals.push({ label: 'Subtotal', amount: money(t.subtotal_cents, currency) });
    if (t.discount_cents > 0) totals.push({ label: meta.discount?.mode === 'percent' ? `Discount (${Number(meta.discount.value)}%)` : 'Discount', amount: '-' + money(t.discount_cents, currency) });
    if (t.tax_cents > 0) totals.push({ label: meta.tax_pct != null ? `Tax (${Number(meta.tax_pct)}%)` : 'Tax', amount: '+' + money(t.tax_cents, currency) });
  }
  totals.push({ label: 'Total', amount: money(t.total_cents, currency), bold: true });
  table(f, rows, totals);
  // sales item 106: how they'll pay, part by part
  const parts = scheduleView(meta.schedule ?? null, t.total_cents);
  if (parts) { f.para('How you’ll pay', { font: 'B', size: 10 }); table(f, parts.map((r) => ({ label: `Part ${r.n} of ${r.of} · ${r.words}`, amount: money(r.amount_cents, currency) })), []); }
  if (p?.terms) { f.para('Terms', { font: 'B', size: 10 }); f.para(p.terms, { size: 9.5, color: SOFT }); f.gap(6); }
  f.para(o.note, { size: 9, color: SOFT });
  feet(pdf, `${brand.name} · ${o.label}`);
  return pdf.bytes();
}
export function proposalPdf(p: any, brand?: Partial<DocBrand> | null, ctx?: DocContext | null): Uint8Array<ArrayBuffer> {
  const note = p?.status === 'accepted' ? 'Accepted. Thank you.' : p?.status === 'declined' ? 'This proposal was declined.' : 'This is a proposal. Nothing is final until you accept.';
  return linesPdf(p, brand, ctx, { label: 'Proposal', note, state: p?.status === 'accepted' ? 'ACCEPTED' : p?.status === 'declined' ? 'DECLINED' : '', stateColor: p?.status === 'accepted' ? GOOD : SOFT });
}
export function estimatePdf(e: any, brand?: Partial<DocBrand> | null, ctx?: DocContext | null): Uint8Array<ArrayBuffer> {
  const until = dayLabel(/^\d{4}-\d{2}-\d{2}/.test(String(e?.expires_at || '')) ? String(e.expires_at).slice(0, 10) : '');
  const note = e?.status === 'approved' ? 'Approved. Thank you.' : e?.status === 'declined' ? 'You chose not now on this estimate.'
    : `This is an estimate, not a final price. Nothing is charged until you get an invoice.${until ? ` Good until ${until}.` : ''}`;
  return linesPdf(e, brand, ctx, { label: 'Estimate', note, state: e?.status === 'approved' ? 'APPROVED' : '', stateColor: GOOD });
}

// ── AGREEMENT (a signed one carries its certificate of record) ───────────────
export function contractPdf(c: any, brandIn?: Partial<DocBrand> | null, ctx?: DocContext | null): Uint8Array<ArrayBuffer> {
  const brand = brandOf(brandIn);
  const signed = c?.status === 'signed';
  const title = String(c?.title || 'Service agreement');
  const pdf = newPdf(`${signed ? 'Signed agreement' : 'Agreement'} — ${title}`);
  const f = head(pdf, brand, { label: signed ? 'Signed agreement' : 'Agreement', state: signed ? 'SIGNED' : c?.status === 'sent' ? 'AWAITING SIGNATURE' : 'DRAFT', stateColor: signed ? GOOD : SOFT, from: fromLines(ctx) });
  f.para(title, { font: 'B', size: 16, lead: 22 });
  f.para(signed ? 'Executed copy: this is the signed document of record.' : c?.status === 'sent' ? 'Sent for signature, not yet signed.' : 'Draft, not yet sent for signature.', { size: 9.5, color: SOFT });
  f.gap(10); f.rule(); f.gap(12);
  // sales item 88: a title, numbered headings, paragraphs and list items (lib/agreement_layout.ts)
  const accent = rgb(brand.accentDark, rgb(brand.accent));
  for (const b of agreementBlocks(c?.body)) {
    if (b.t === 'title') { f.para(b.text, { font: 'B', size: 12.5, lead: 18, color: accent }); f.gap(4); continue; }
    if (b.t === 'heading') { f.need(44); f.gap(6); f.para((b.n ? b.n + '. ' : '') + b.text, { font: 'B', size: 11, lead: 16 }); f.gap(2); continue; }
    if (b.t === 'item') { f.para(b.mark + '  ' + b.text, { size: 10, lead: 15, indent: 14 }); continue; }
    for (const line of b.text.split('\n')) f.para(line, { size: 10, lead: 15 });
    f.gap(5);
  }
  f.gap(10);
  if (signed) {
    // both signatures, side by side: the client's as they typed it, the studio's added at the same moment
    const tz = ctx?.tz || null;
    const clientName = String(ctx?.billTo?.company || ctx?.billTo?.name || '').trim();
    const cols: Array<{ k: string; name: string; who: string }> = [{ k: clientName ? `For ${clientName}` : 'For the client', name: String(c?.signer_name || ''), who: [c?.signer_email ? String(c.signer_email) : '', dayLabel(c?.signed_at, tz)].filter(Boolean).join(' · ') }];
    if (c?.countersigned_name) cols.push({ k: `For ${brand.name}`, name: String(c.countersigned_name), who: [c?.countersigned_title ? String(c.countersigned_title) : '', `${dayLabel(c?.countersigned_at || c?.signed_at, tz)} (countersigned)`].filter(Boolean).join(' · ') });
    f.need(84); f.rule(); f.gap(14);
    f.para('SIGNATURES', { font: 'B', size: 8.5, color: SOFT });
    const colW = (W - 24) / 2, top = f.y;
    cols.forEach((col, i) => {
      const x = L + i * (colW + 24);
      pdf.text(x, top - 10, col.k.toUpperCase(), { font: 'B', size: 8, color: SOFT });
      pdf.text(x, top - 32, wrapText(col.name, 'B', 15, colW)[0] || '', { font: 'B', size: 15, color: accent });
      pdf.line(x, top - 38, x + colW, top - 38, INK, 0.75);
      pdf.text(x, top - 50, wrapText(col.who, 'R', 8.5, colW)[0] || '', { size: 8.5, color: SOFT });
    });
    f.y = top - 66;
    const ev = (c?.signed_evidence && typeof c.signed_evidence === 'object') ? c.signed_evidence : {};
    const rows: string[] = [`Signed by: ${String(c?.signer_name || '')}`];
    if (c?.signer_email) rows.push(`Signer email: ${String(c.signer_email)}`);
    if (c?.countersigned_name) rows.push(`Countersigned by: ${String(c.countersigned_name)}${c?.countersigned_title ? ', ' + String(c.countersigned_title) : ''} for ${brand.name}`);
    rows.push(`Signed at: ${utcStamp(c?.signed_at || ev?.at)}`);
    rows.push(`Document fingerprint (SHA-256): ${String(c?.content_hash || ev?.hash || '')}`);
    if (ev?.ip_hash) rows.push(`Signing evidence (hashed IP): ${String(ev.ip_hash)}`);
    f.para('CERTIFICATE OF RECORD', { font: 'B', size: 8.5, color: SOFT });
    panel(f, rows);
    f.para('Typing a name to sign is an electronic signature. The fingerprint identifies the exact text that was signed; it changes if even one character does, so this copy shows any change.', { size: 8.5, color: SOFT });
  } else {
    f.para('This copy is not an executed agreement until it is signed.', { size: 9, color: SOFT });
  }
  feet(pdf, `${brand.name} · ${signed ? 'Signed agreement' : 'Agreement'}`);
  return pdf.bytes();
}

/** Dispatch by kind, like renderDocument. Pure. */
export function documentPdf(kind: DocKind, data: any, brand?: Partial<DocBrand> | null, ctx?: DocContext | null): Uint8Array<ArrayBuffer> {
  if (kind === 'invoice') return invoicePdf(data, brand, ctx);
  if (kind === 'proposal') return proposalPdf(data, brand, ctx);
  if (kind === 'estimate') return estimatePdf(data, brand, ctx);
  return contractPdf(data, brand, ctx);
}
/** The file name a document downloads as: "Invoice-0013.pdf", "Receipt-0013.pdf",
 *  "Proposal-Website-refresh.pdf". Pure. */
export function pdfFileName(kind: DocKind, data: any): string {
  const slug = (s: unknown) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  if (kind === 'invoice') {
    const label = invoiceDocLabel(data).replace(/ /g, '-');
    const no = invoiceNo(data?.number).replace('#', '');
    return `${label}-${no || slug(data?.title) || 'invoice'}.pdf`;
  }
  const label = kind === 'contract' ? (data?.status === 'signed' ? 'Signed-agreement' : 'Agreement') : kind === 'estimate' ? 'Estimate' : 'Proposal';
  return `${label}${slug(data?.title) ? '-' + slug(data?.title) : ''}.pdf`;
}
