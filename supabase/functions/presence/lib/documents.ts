// ── Branded, print-ready Documents of Record (Presence CMS Phase 2) ──────────
// Proposals/contracts today are plain-HTML email and invoices are Stripe-hosted;
// none is a clean, on-brand, keepable document. This module SERVER-RENDERS a
// self-contained, print-optimized branded HTML document for a proposal, an
// invoice, a deposit request/receipt, or a SIGNED contract — the last being the
// immutable Document of Record (the exact executed body + typed signer + UTC
// timestamp + the existing content_hash & signed_evidence rendered as a visible
// certificate). It RENDERS existing immutable data — it creates NO storage, NO
// table, NO column, NO migration, and adds NO external dependency (the branded
// page is saved as PDF via the browser's own Print / Save-as-PDF).
//
// Pure: no I/O, no clock, no randomness — same data + brand in → same bytes out,
// so every renderer is unit-testable. routes/sales.ts does the I/O (token verify,
// row load, brand load) and calls these. Brand is DERIVED from the Brand Kit via
// the same lib/email_brand.ts path the emails use (name + contrast-safe accent);
// line-item math reuses lib/sales_lifecycle.ts so the document can never disagree
// with the proposal it renders. Escaping reuses lib/markdown.ts `esc`.
import { esc } from './markdown.ts';
import { splitLineItems, computeProposalTotals, type LineItem } from './sales_lifecycle.ts';
import { hmacHex, timingSafeEqual } from '../../_shared/hmac.ts';

// ── the studio's identity on the page (structurally the EmailBrand shape) ─────
export interface DocBrand { name: string; accent: string; accentDark: string }
const DEFAULT_BRAND: DocBrand = { name: 'Studio OS', accent: '#5b3fa0', accentDark: '#3a2470' };

export type DocKind = 'proposal' | 'contract' | 'invoice';

// ── signed document token (own type `doc` so it can NEVER be mistaken for a
//    sign/accept token — a doc link only ever RENDERS, it never mutates). Mirrors
//    the house HMAC idiom used by routes/sales.ts signSalesToken. Pure: caller
//    passes the secret and the current epoch seconds, so there is no clock here. ─
export interface DocTokenPayload { t: 'doc'; k: DocKind; id: string; site_id: string; exp: number }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function b64url(s: string): string { return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64url(s: string): string { const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : ''; return atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad); }
const isKind = (k: unknown): k is DocKind => k === 'proposal' || k === 'contract' || k === 'invoice';

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
const brandOf = (b?: Partial<DocBrand> | null): DocBrand => ({
  name: (b?.name || '').trim() || DEFAULT_BRAND.name,
  accent: b?.accent || DEFAULT_BRAND.accent,
  accentDark: b?.accentDark || DEFAULT_BRAND.accentDark,
});

// ── the ONE branded print-ready shell every document is wrapped in ────────────
// Self-contained: inline styles, no external assets. On screen it's a calm card;
// @media print hides the toolbar/chrome, drops shadows, and sets page margins so
// the browser's Save-as-PDF yields a clean, keepable document.
function shell(o: { title: string; brand: DocBrand; docLabel: string; heading: string; sub?: string; bodyHtml: string }): string {
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
  <div class="toolbar no-print"><button type="button" onclick="window.print()">Save as PDF / Print</button></div>
  <div class="paper"><div class="accentbar"></div><div class="inner">
    <div class="wordmark">${esc(b.name)}</div>
    <div class="doclabel">${esc(o.docLabel)}</div>
    <h1>${esc(o.heading)}</h1>
    ${o.sub ? `<p class="sub">${esc(o.sub)}</p>` : ''}
    <div class="hr"></div>
    ${o.bodyHtml}
  </div></div>
  <footer>Prepared by ${esc(b.name)}. Keep this document for your records — reprint any time from your original link.</footer>
</div>
</body></html>`;
}

// ── PROPOSAL ─────────────────────────────────────────────────────────────────
export function renderProposalDocument(p: any, brandIn?: Partial<DocBrand> | null): string {
  const brand = brandOf(brandIn);
  // Unpack the real line items from the reserved discount/tax meta, then recompute
  // the whole breakdown — the document can never disagree with the stored math.
  const { items, meta } = splitLineItems(p?.line_items);
  const currency = String(p?.currency || 'usd');
  const t = computeProposalTotals(items, meta);
  const rows = items.length
    ? items.map((i) => `<tr><td>${esc(i.label)}${i.qty > 1 ? ` <span style="color:var(--soft)">× ${i.qty}</span>` : ''}</td><td>${esc(money(i.unit_cents * Math.max(1, i.qty), currency))}</td></tr>`).join('')
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
  const statusNote = p?.status === 'accepted' ? 'Accepted — thank you.'
    : p?.status === 'declined' ? 'This proposal was declined.'
    : 'This is a proposal — nothing is final until you accept.';
  const body = `
    <table><tbody>${rows}${breakdown}<tr class="total"><td>Total</td><td>${esc(money(t.total_cents, currency))}</td></tr></tbody></table>
    ${p?.terms ? `<div class="hr"></div><p class="terms">${esc(p.terms)}</p>` : ''}
    <p class="note">${esc(statusNote)}</p>`;
  return shell({ title: `${p?.title || 'Proposal'} — ${brand.name}`, brand, docLabel: 'Proposal', heading: String(p?.title || 'Proposal'), sub: undefined, bodyHtml: body });
}

// ── INVOICE / DEPOSIT / RECEIPT ──────────────────────────────────────────────
export function renderInvoiceDocument(v: any, brandIn?: Partial<DocBrand> | null): string {
  const brand = brandOf(brandIn);
  const currency = String(v?.currency || 'usd');
  const paid = v?.status === 'paid';
  const voided = v?.status === 'void';
  const isDeposit = v?.purpose === 'deposit';
  const docLabel = paid ? 'Receipt' : isDeposit ? 'Deposit request' : 'Invoice';
  const heading = String(v?.title || (isDeposit ? 'Deposit' : 'Invoice'));
  const pill = paid ? '<span class="pill paid">Paid</span>' : voided ? '<span class="pill void">Voided</span>' : '<span class="pill due">Amount due</span>';
  const amountRow = `<div class="amountbox"><span>${paid ? 'Paid' : 'Amount due'}</span><span class="n">${esc(money(v?.amount_cents, currency))} ${pill}</span></div>`;
  const meta: string[] = [];
  if (v?.description) meta.push(`<div class="kv"><span class="k">Description</span><span>${esc(String(v.description))}</span></div>`);
  if (v?.due_date && !paid) meta.push(`<div class="kv"><span class="k">Due</span><span>${esc(String(v.due_date))}</span></div>`);
  if (paid && v?.paid_at) meta.push(`<div class="kv"><span class="k">Paid on</span><span>${esc(utcStamp(v.paid_at))}</span></div>`);
  if (v?.created_at) meta.push(`<div class="kv"><span class="k">Issued</span><span>${esc(utcStamp(v.created_at))}</span></div>`);
  const metaBlock = meta.length ? `<div class="cert" style="margin-top:16px">${meta.join('')}</div>` : '';
  // A live pay link is an ACTION, not part of the printed record → no-print.
  const pay = (!paid && !voided && v?.stripe_url)
    ? `<p class="no-print" style="margin-top:16px"><a class="paylink" href="${esc(String(v.stripe_url))}">Pay ${esc(money(v?.amount_cents, currency))} securely →</a></p>`
    : '';
  const note = paid ? 'Thank you — this is your receipt of payment.'
    : voided ? 'This request was voided and is no longer payable.'
    : 'Payment is processed securely. This document is your copy of the request.';
  const body = `${amountRow}${metaBlock}${pay}<p class="note">${esc(note)}</p>`;
  return shell({ title: `${heading} — ${brand.name}`, brand, docLabel, heading, sub: undefined, bodyHtml: body });
}

// ── CONTRACT (draft/sent = copy · signed = Document of Record) ────────────────
export function renderContractDocument(c: any, brandIn?: Partial<DocBrand> | null): string {
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
  return shell({ title: `${c?.title || 'Agreement'} — ${brand.name}`, brand, docLabel: signed ? 'Signed agreement' : 'Agreement', heading: String(c?.title || 'Service agreement'), sub: statusSub, bodyHtml: body });
}

/** Dispatch by kind. `data` is an already-loaded, site-scoped row. Pure. */
export function renderDocument(kind: DocKind, data: any, brand?: Partial<DocBrand> | null): string {
  if (kind === 'proposal') return renderProposalDocument(data, brand);
  if (kind === 'invoice') return renderInvoiceDocument(data, brand);
  return renderContractDocument(data, brand);
}
