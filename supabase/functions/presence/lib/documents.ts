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
import { agreementHtml, agreementBlocks, agreementContents } from './agreement_layout.ts';   // sales item 88: headings and numbered sections
import { scheduleView } from './proposal_schedule.ts';   // sales item 106: paid in parts

// ── the studio's identity on the page (structurally the EmailBrand shape) ─────
export interface DocBrand { name: string; accent: string; accentDark: string; logoUrl?: string | null }   // logoUrl: the studio's logo, a signed https link (item 59)
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
/** Read a doc token: signature valid and well-formed, whatever its date. Sales item 79:
 *  the page decides about the date once it knows the document (see lastingRecord).
 *  Returns the payload or null. Pure. */
export async function readDocToken(token: string, secret: string): Promise<DocTokenPayload | null> {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  if (!timingSafeEqual(parts[1], await hmacHex(secret, parts[0]))) return null;
  let p: any; try { p = JSON.parse(unb64url(parts[0])); } catch { return null; }
  if (!p || p.t !== 'doc' || !isKind(p.k) || !UUID_RE.test(p.id || '') || !UUID_RE.test(p.site_id || '') || typeof p.exp !== 'number') return null;
  return p as DocTokenPayload;
}
/** Verify a doc token: signature valid, well-formed, and unexpired at `nowSec`.
 *  Returns the payload or null. Pure (deterministic for a fixed nowSec). */
export async function verifyDocToken(token: string, secret: string, nowSec: number): Promise<DocTokenPayload | null> {
  const p = await readDocToken(token, secret);
  if (!p || p.exp < nowSec) return null;
  return p;
}
/** Sales item 79: a SIGNED agreement and a PAID invoice (a receipt) are finished records,
 *  so a link to one keeps working after its date, as the page has always promised ("keep
 *  this for your records"). The token still names exactly one document and only ever
 *  shows it; a proposal, an estimate or an unpaid invoice still ends with its link, because
 *  what they say can change. Pure. */
export function lastingRecord(kind: DocKind, row: { status?: unknown } | null | undefined): boolean {
  const st = String(row?.status || '');
  return (kind === 'contract' && st === 'signed') || (kind === 'invoice' && st === 'paid');
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
  logoUrl: b?.logoUrl || null,
});

// ── the ONE branded print-ready shell every document is wrapped in ────────────
// Sales item 124: the documents wear the product's new look. A band in the studio's
// own colour opens the page with its logo or mark, its name, a large title and the
// number that matters; below it white cards sit on cream, like the sales pages and
// the client portal. Self-contained apart from the app host's own font file (a
// relative link, so the page still makes no request to anyone else). @media print
// keeps the band's colour, hides the buttons and the side card, and sets page
// margins, so paper and the browser's Save-as-PDF give a clean, keepable document.
/** `a` mixed toward `b` by `t` (0 to 1), as #rrggbb. A colour that isn't #rgb or #rrggbb comes back as it is. Pure. */
export function mixHex(a: string, b: string, t: number): string {
  const parse = (h: string) => { const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(h || '').trim()); if (!m) return null; const s = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1]; return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)); };
  const x = parse(a), y = parse(b);
  if (!x || !y) return a;
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * Math.min(1, Math.max(0, t))).toString(16).padStart(2, '0')).join('');
}
/** The band's two ends: a deep tone of the studio's colour, running into the colour itself. Pure. */
export function bandColors(b: DocBrand): { from: string; to: string } {
  return { from: mixHex(b.accentDark, '#140c1f', 0.3), to: b.accent };
}
/** The studio in the band: its logo on a white chip when it set one (an https link only), else a mark with its first letter, then its name. */
function studioHtml(b: DocBrand): string {
  const logo = typeof b.logoUrl === 'string' && /^https:\/\//.test(b.logoUrl) ? b.logoUrl : '';
  const letter = (b.name.trim().match(/[\p{L}\p{N}]/u) || ['•'])[0].toUpperCase();
  return `<div class="studio">${logo ? `<span class="logochip"><img src="${esc(logo)}" alt=""></span>` : `<span class="mark" aria-hidden="true">${esc(letter)}</span>`}<span class="wordmark">${esc(b.name)}</span></div>`;
}
interface ShellFigure { label?: string; amount?: string; pillHtml?: string }
function shell(o: { title: string; brand: DocBrand; kickerHtml: string; heading: string; sub?: string; figure?: ShellFigure | null; bannerHtml?: string; railHtml?: string; asideHtml?: string; payBarHtml?: string; bodyHtml: string; pdfUrl?: string | null; pdfName?: string | null; lasting?: boolean }): string {
  const b = o.brand, band = bandColors(b);
  const layout = o.railHtml ? ' railed' : o.asideHtml ? ' cols' : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">
<title>${esc(o.title)}</title>
<link rel="stylesheet" href="/fonts/brand.css">
<style>
  :root{--accent:${b.accent};--accent-deep:${b.accentDark};--band-a:${band.from};--band-b:${band.to};--tint:${mixHex(b.accent, '#ffffff', 0.9)};--ink:#1b1525;--soft:#6b6478;--line:#eee9e0;--bg:#faf8f5;--panel:#f6f3ee;--card:#fff;--good:#2f6a4a;--good-bg:#e7f1ea;
    --serif:"Fraunces","Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;--sans:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  *{box-sizing:border-box;margin:0}
  html{scroll-behavior:smooth}
  body{background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.6;-webkit-font-smoothing:antialiased}
  .wrap{max-width:1180px;margin:0 auto;padding:0 40px}
  /* the band */
  .band{background:var(--band-b);background:linear-gradient(100deg,var(--band-a),var(--band-b));color:#fff;padding:26px 0 42px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .bandtop{display:flex;justify-content:space-between;align-items:center;gap:16px;min-height:40px}
  .studio{display:flex;align-items:center;gap:10px;min-width:0}
  .mark{flex:none;width:30px;height:30px;border-radius:9px;background:rgba(255,255,255,.18);display:grid;place-items:center;font-weight:700;font-size:14px}
  .logochip{flex:none;background:#fff;border-radius:10px;padding:5px 9px;display:flex;align-items:center}
  .logochip img{display:block;height:26px;width:auto;max-width:150px}
  .wordmark{font-weight:600;font-size:15px;letter-spacing:-.005em;overflow-wrap:anywhere}
  .toolbar{display:flex;gap:10px;flex:none}
  .toolbar button{font-family:inherit;font-size:13.5px;font-weight:600;border-radius:999px;border:1.5px solid #fff;background:#fff;color:var(--band-a);padding:9px 18px;min-height:40px;cursor:pointer}
  .toolbar .ghost{background:transparent;color:#fff;border-color:rgba(255,255,255,.55)}
  .toolbar button:focus-visible,.btn:focus-visible,.paylink:focus-visible,.rail a:focus-visible{outline:3px solid #fff;outline-offset:2px;box-shadow:0 0 0 5px var(--band-a)}
  .bandmain{display:flex;justify-content:space-between;align-items:flex-end;gap:28px;margin-top:34px;flex-wrap:wrap}
  .bandtitle{min-width:0;flex:1 1 420px}
  .kicker{display:flex;flex-wrap:wrap;gap:0 8px;text-transform:uppercase;letter-spacing:.09em;font-size:11.5px;font-weight:700;color:rgba(255,255,255,.78);margin-bottom:8px}
  .doclabel{text-transform:uppercase;letter-spacing:.09em;font-size:11.5px;font-weight:700}
  h1{font-family:var(--serif);font-weight:400;font-size:clamp(28px,4.6vw,42px);line-height:1.14;letter-spacing:-.01em;margin:0;overflow-wrap:anywhere}
  .sub{color:rgba(255,255,255,.84);font-size:14.5px;margin:8px 0 0}
  .figure{text-align:right;flex:none;max-width:100%}
  .figure .flbl{font-size:13px;color:rgba(255,255,255,.8)}
  .figure .n{font-family:var(--serif);font-weight:600;font-size:clamp(38px,6vw,52px);line-height:1.1;letter-spacing:-.01em}
  .pill{display:inline-block;font-size:12.5px;font-weight:600;padding:5px 12px;border-radius:999px;margin-top:6px}
  .pill.paid{background:#fff;color:var(--good)}.pill.due{background:rgba(255,255,255,.18);color:#fff}.pill.void{background:rgba(255,255,255,.18);color:#fff}
  /* the body: cards on cream */
  .body{padding-top:34px;padding-bottom:26px;display:grid;gap:22px;grid-template-columns:minmax(0,1fr)}
  .body.cols{grid-template-columns:minmax(0,1fr) 340px;align-items:start}
  .body.railed{grid-template-columns:200px minmax(0,1fr);align-items:start}
  .banner{grid-column:1/-1;display:flex;gap:14px;align-items:center;background:var(--good-bg);color:var(--good);border-radius:16px;padding:16px 22px;font-size:14px}
  .banner .dot{flex:none;width:34px;height:34px;border-radius:50%;background:var(--good);color:#fff;display:grid;place-items:center;font-weight:700}
  .banner b{display:block;font-family:var(--serif);font-weight:400;font-size:20px;line-height:1.3}
  .paper,.aside{background:var(--card);border-radius:20px;box-shadow:0 1px 2px rgba(27,21,37,.04),0 10px 30px rgba(27,21,37,.07)}
  .inner{padding:32px 36px 34px}
  .aside{padding:26px 26px 28px;position:sticky;top:20px}
  .aside .lbl,.lbl{text-transform:uppercase;letter-spacing:.08em;font-size:11px;font-weight:700;color:var(--soft)}
  .aside .n{font-family:var(--serif);font-weight:600;font-size:38px;line-height:1.2;margin:4px 0 6px;letter-spacing:-.01em}
  .aside .n.struck{text-decoration:line-through;color:var(--soft)}
  .aside p{font-size:13.5px;color:var(--soft);line-height:1.5;margin:0 0 14px}
  .aside .row{display:flex;justify-content:space-between;gap:12px;font-size:14px;padding:8px 0}
  .aside .row small{display:block;color:var(--soft);font-size:12.5px}
  .aside .sum{display:flex;justify-content:space-between;align-items:center;gap:12px;background:var(--good-bg);color:var(--good);border-radius:14px;padding:12px 16px;font-weight:600;margin:10px 0 14px}
  .aside .sum span:last-child{font-family:var(--serif);font-size:22px}
  .aside hr{border:0;border-top:1px solid var(--line);margin:14px 0}
  .btn,.paylink{display:block;width:100%;text-align:center;font-family:inherit;font-size:15px;font-weight:600;border-radius:999px;padding:13px 22px;min-height:48px;cursor:pointer;text-decoration:none}
  .paylink{background:var(--accent);color:#fff;border:1.5px solid var(--accent);margin:0 0 12px}
  .btn{background:transparent;color:var(--accent-deep);border:1.5px solid var(--accent)}
  .btn.solid{background:var(--accent);color:#fff}
  .hr{height:1px;background:var(--line);margin:24px 0}
  table{width:100%;border-collapse:collapse;font-size:15px}
  td{padding:14px 2px;border-bottom:1px solid var(--line);vertical-align:top}
  td:last-child{text-align:right;white-space:nowrap}
  tr.sub td,tr.less td{color:var(--soft);font-size:14px;padding:9px 2px;border-bottom:none}
  tr.total td{font-weight:600;font-size:16px;border-bottom:none;padding-top:14px}
  tr.total td:last-child{font-family:var(--serif);font-size:24px;font-weight:600;line-height:1.2}
  th{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--soft);text-align:left;font-weight:700;padding:0 2px 10px;border-bottom:1px solid var(--line)}
  th:last-child{text-align:right}
  td.qty,th.qty{text-align:right;width:56px;color:var(--soft)}
  .body .doclabel{color:var(--soft);font-size:11px;letter-spacing:.08em;margin:0 0 8px}
  .terms{color:var(--soft);font-size:14px;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6}
  .note{color:var(--accent-deep);background:var(--tint);border-radius:14px;padding:13px 16px;font-size:13.5px;margin-top:22px;line-height:1.5}
  .parties{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:22px 28px;margin:0 0 24px;padding-bottom:24px;border-bottom:1px solid var(--line)}
  .party{font-size:14px;line-height:1.55;color:var(--soft);overflow-wrap:anywhere}
  .party .k{text-transform:uppercase;letter-spacing:.08em;font-size:11px;font-weight:700;color:var(--soft);margin-bottom:6px}
  .party .first{font-weight:600;color:var(--ink)}
  .paidbox{display:none}
  /* sales item 88: the agreement as a document — a title, numbered headings, paragraphs, list items — and both signatures */
  .agreement{font-size:15px;line-height:1.7;overflow-wrap:anywhere}
  .agreement .ag-title{text-transform:uppercase;letter-spacing:.08em;font-size:11px;font-weight:700;color:var(--soft);margin:0 0 14px}
  .agreement .ag-h{font-family:var(--serif);font-size:18px;font-weight:600;margin:26px 0 6px;scroll-margin-top:20px;break-after:avoid;page-break-after:avoid}
  .agreement .ag-n{font-weight:400;font-size:24px;color:var(--accent);margin-right:12px}
  .agreement .ag-p{margin:0 0 10px;white-space:pre-wrap}
  .agreement .ag-item{margin:4px 0 4px 20px}
  .agreement .ag-mark{color:var(--accent);font-weight:600;margin-right:6px}
  .sigh{font-family:var(--serif);font-size:20px;font-weight:600;margin:0 0 14px;scroll-margin-top:20px}
  .sigs{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:6px}
  .sig{border:1px solid var(--line);border-radius:16px;padding:16px 20px 14px;break-inside:avoid}
  .sig .k{text-transform:uppercase;letter-spacing:.08em;font-size:11px;font-weight:700;color:var(--soft)}
  .sig .sgn{font-family:var(--serif);font-style:italic;font-size:30px;color:var(--accent-deep);line-height:1.3;margin-top:6px;overflow-wrap:anywhere}
  .sig .line{height:1.5px;background:rgba(27,21,37,.55);margin:2px 0 8px}
  .sig .who{font-size:12.5px;color:var(--soft);overflow-wrap:anywhere}
  .cert{border-radius:18px;padding:22px 26px;margin-top:22px;background:var(--band-a);color:#fff;scroll-margin-top:20px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .cert h2{font-family:var(--serif);font-size:20px;font-weight:400;margin:0}
  .cert .certsub{font-size:13px;color:rgba(255,255,255,.74);margin:0 0 12px}
  .kv{display:flex;justify-content:space-between;gap:16px;padding:10px 0;border-top:1px solid rgba(255,255,255,.16);font-size:13.5px}
  .kv .k{color:rgba(255,255,255,.74);white-space:nowrap}
  .kv span:last-child{text-align:right;overflow-wrap:anywhere}
  .mono{font-family:"Geist Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
  .cert .note{background:none;color:rgba(255,255,255,.74);padding:0;margin-top:6px;font-size:12.5px}
  /* the contents list beside an agreement */
  .rail{position:sticky;top:20px;font-size:13px}
  .rail a{display:block;color:var(--soft);text-decoration:none;padding:6px 10px;border-radius:8px;overflow-wrap:anywhere}
  .rail a:hover{background:var(--tint);color:var(--accent-deep)}
  .rail a b{font-weight:600;margin-right:8px}
  footer{color:var(--soft);font-size:12.5px;text-align:center;padding:0 20px 36px;line-height:1.5}
  .paybar{display:none}
  @media (max-width:980px){
    .body.cols,.body.railed{grid-template-columns:minmax(0,1fr)}
    .rail{display:none}.aside{position:static}
  }
  @media (max-width:640px){
    .wrap{padding:0 16px}
    .band{padding:18px 0 30px}.bandmain{margin-top:22px;gap:14px;align-items:flex-start;flex-direction:column}
    .bandtitle{flex:none}.figure{text-align:left;display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px}.figure .flbl{flex-basis:100%}.pill{margin-top:0}
    .toolbar .ghost{display:none}
    .body{padding-top:20px;gap:14px}.inner{padding:22px 20px 24px}.aside{padding:22px 20px}
    .sigs{grid-template-columns:1fr}
    .cert{padding:20px}.kv{flex-direction:column;gap:2px}.kv span:last-child{text-align:left}
    .has-paybar{padding-bottom:92px}
    .has-paybar .aside{display:none}
    .paybar{display:flex;gap:10px;position:fixed;left:0;right:0;bottom:0;background:var(--card);border-top:1px solid var(--line);padding:12px 16px calc(12px + env(safe-area-inset-bottom));z-index:5}
    .paybar .paylink{margin:0;flex:1}.paybar .btn{width:auto;flex:none}
  }
  @media print{
    @page{margin:12mm}
    body{background:#fff}
    .no-print,.toolbar,.aside,.rail,.paybar{display:none!important}
    .wrap{max-width:100%;padding:0}
    .band{padding:8mm 8mm 9mm;border-radius:4mm}.bandmain{margin-top:6mm}
    .body,.body.cols,.body.railed{display:block;padding:8mm 0 0}
    .banner{margin-bottom:6mm;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .paper{box-shadow:none;border-radius:0}
    .inner{padding:0}
    .has-paybar{padding-bottom:0}
    .cert,.sig,tr,.note{page-break-inside:avoid;break-inside:avoid}
    footer{padding:8mm 0 0}
  }
</style></head>
<body${o.payBarHtml ? ' class="has-paybar"' : ''}>
<header class="band"><div class="wrap">
  <div class="bandtop">${studioHtml(b)}
    <div class="toolbar no-print">${o.pdfUrl ? '<button type="button" class="ghost" onclick="window.print()">Print</button><button type="button" data-dlpdf id="dlpdf">Download PDF</button>' : '<button type="button" onclick="window.print()">Save as PDF / Print</button>'}</div></div>
  <div class="bandmain"><div class="bandtitle">
    <div class="kicker">${o.kickerHtml}</div>
    <h1>${esc(o.heading)}</h1>
    ${o.sub ? `<p class="sub">${esc(o.sub)}</p>` : ''}</div>
    ${o.figure ? `<div class="figure">${o.figure.label ? `<div class="flbl">${esc(o.figure.label)}</div>` : ''}${o.figure.amount ? `<div class="n">${esc(o.figure.amount)}</div>` : ''}${o.figure.pillHtml ? `<div>${o.figure.pillHtml}</div>` : ''}</div>` : ''}
  </div>
</div></header>
<main class="wrap body${layout}">
  ${o.bannerHtml || ''}${o.railHtml || ''}
  <div class="paper"><div class="inner">
    ${o.bodyHtml}
  </div></div>
  ${o.asideHtml ? `<aside class="aside no-print">${o.asideHtml}</aside>` : ''}
</main>
<footer>${footerWords(b.name, !!o.lasting, !!o.pdfUrl)}</footer>
${o.payBarHtml ? `<div class="paybar no-print">${o.payBarHtml}</div>` : ''}${o.pdfUrl ? pdfScript(o.pdfUrl, o.pdfName || 'document.pdf') : ''}
</body></html>`;
}
/** The kicker's words: what the document is, then who it is for. `labelHtml` is already safe HTML. */
function kicker(labelHtml: string, forWhom?: string): string {
  return `${labelHtml}${forWhom ? `<span>· For ${esc(forWhom)}</span>` : ''}`;
}
/** Who a document is for, as the band says it: their company, else their name. Pure. */
const forWhomOf = (ctx?: DocContext | null): string => String(ctx?.billTo?.company || ctx?.billTo?.name || '').trim();
/** A side-card or pay-bar "Download PDF" button (the script binds every one). */
const pdfButton = (label: string, solid = false): string => `<button type="button" class="btn${solid ? ' solid' : ''}" data-dlpdf>${esc(label)}</button>`;
/** One party as a column: a small label, then its lines, the first in bold. */
const partyBox = (k: string, lines: string[]): string => lines.length ? `<div class="party"><div class="k">${esc(k)}</div>${lines.map((l, i) => i === 0 ? `<div class="first">${esc(l)}</div>` : `<div>${esc(l)}</div>`).join('')}</div>` : '';
/** The line under a document (sales item 79): a finished record (a signed agreement, a receipt)
 *  says its link keeps working; anything that can still change makes no promise about its link. Pure. */
export function footerWords(name: string, lasting: boolean, hasPdf: boolean): string {
  return lasting
    ? `Prepared by ${esc(name)}. Keep this for your records: this link keeps working${hasPdf ? ', and Download PDF saves a copy' : ''}.`
    : `Prepared by ${esc(name)}.`;
}
/** Sales item 82: "Download PDF" fetches the PDF and saves it under its own name.
 *  Fetching (rather than a plain link) keeps the file's type whatever the host
 *  answers with, and works on a phone. The URL is JSON-escaped into the script. */
function pdfScript(url: string, name: string): string {
  const j = (v: string) => JSON.stringify(v).replace(/</g, '\\u003c');
  return `<script>(function(){var u=${j(url)};Array.prototype.forEach.call(document.querySelectorAll('[data-dlpdf]'),function(b){var label=b.textContent;b.addEventListener('click',async function(){b.disabled=true;b.textContent='Preparing…';try{var r=await fetch(u);if(!r.ok)throw new Error(String(r.status));var blob=new Blob([await r.arrayBuffer()],{type:'application/pdf'});var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=${j(name)};document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove();},5000);b.textContent=label;}catch(e){b.textContent='Couldn’t download — try again';}b.disabled=false;});});})();</script>`;
}

// ── PROPOSAL (and ESTIMATE, item 47 — the same lines, its own label and note) ──
export function renderProposalDocument(p: any, brandIn?: Partial<DocBrand> | null, ctx?: DocContext | null): string {
  const statusNote = p?.status === 'accepted' ? 'Accepted — thank you.'
    : p?.status === 'declined' ? 'This proposal was declined.'
    : 'This is a proposal — nothing is final until you accept.';
  const pill = p?.status === 'accepted' ? '<span class="pill paid">Accepted</span>' : p?.status === 'declined' ? '<span class="pill void">Declined</span>' : '';
  return renderLineItemsDocument(p, brandIn, { docLabel: 'Proposal', heading: String(p?.title || 'Proposal'), note: statusNote, pill }, ctx);
}
/** An estimate prints like a proposal: its lines, discount, tax and total, its
 *  notes, and a closing line that says what it is (and how long it is good for). */
export function renderEstimateDocument(e: any, brandIn?: Partial<DocBrand> | null, ctx?: DocContext | null): string {
  const until = /^\d{4}-\d{2}-\d{2}/.test(String(e?.expires_at || '')) ? String(e.expires_at).slice(0, 10) : '';
  const note = e?.status === 'approved' ? 'Approved — thank you.'
    : e?.status === 'declined' ? 'You chose not now on this estimate.'
    : `This is an estimate, not a final price — nothing is charged until you get an invoice.${until ? ` Good until ${until}.` : ''}`;
  const pill = e?.status === 'approved' ? '<span class="pill paid">Approved</span>' : e?.status === 'declined' ? '<span class="pill void">Not now</span>' : until ? `<span class="pill due">Good until ${esc(dayLabel(until) || until)}</span>` : '';
  return renderLineItemsDocument(e, brandIn, { docLabel: 'Estimate', heading: String(e?.title || 'Estimate'), note, pill }, ctx);
}
function renderLineItemsDocument(p: any, brandIn: Partial<DocBrand> | null | undefined, o: { docLabel: string; heading: string; note: string; pill?: string }, ctx?: DocContext | null): string {
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
  // sales item 106: how they'll pay, part by part (an estimate never has parts)
  const parts = scheduleView(meta.schedule ?? null, t.total_cents);
  const partsHtml = parts ? `<div class="hr"></div><div class="doclabel" style="margin-top:0">How you’ll pay</div><table><tbody>${parts.map((r) => `<tr><td>Part ${r.n} of ${r.of} · ${esc(r.words)}</td><td>${esc(money(r.amount_cents, currency))}</td></tr>`).join('')}</tbody></table>` : '';
  // who it's from and who it's for, when the page knows (the PDF has always said so)
  const from = partyLines(ctx?.studio ? { ...ctx.studio, name: brand.name } : null);
  const parties = (from.length || partyLines(ctx?.billTo).length) ? `<div class="parties">${partyBox('From', from)}${partyBox('Prepared for', partyLines(ctx?.billTo))}</div>` : '';
  const body = `${parties}
    <div class="lbl" style="margin-bottom:8px">What’s included</div>
    <table><tbody>${rows}${breakdown}<tr class="total"><td>Total</td><td>${esc(money(t.total_cents, currency))}</td></tr></tbody></table>
    ${partsHtml}
    ${p?.terms ? `<div class="hr"></div><div class="lbl" style="margin-bottom:8px">Good to know</div><p class="terms">${esc(p.terms)}</p>` : ''}
    <p class="note">${esc(o.note)}</p>`;
  const total = money(t.total_cents, currency);
  const aside = `<div class="lbl">Total</div><div class="n">${esc(total)}</div>${parts ? `<p>${esc(`Paid in ${parts.length} parts.`)}</p>` : ''}${ctx?.pdfUrl ? pdfButton('Download PDF') : `<button type="button" class="btn" onclick="window.print()">Print</button>`}`;
  return shell({ title: `${o.heading} — ${brand.name}`, brand, kickerHtml: kicker(`<div class="doclabel">${esc(o.docLabel)}</div>`, forWhomOf(ctx)), heading: o.heading, figure: { label: 'Total', amount: total, pillHtml: o.pill }, bodyHtml: body, asideHtml: aside, pdfUrl: ctx?.pdfUrl, pdfName: ctx?.pdfName });
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
  const pill = paid ? '<span class="pill paid">✓ Paid in full</span>' : voided ? '<span class="pill void">Voided</span>' : `<span class="pill due">${esc(v?.due_date ? 'Due ' + dayLabel(v.due_date, ctx?.tz || null) : 'Due on receipt')}</span>`;
  // who it's from, who it's billed to, and the details a bookkeeper files it by
  const from = partyLines(ctx?.studio ? { ...ctx.studio, name: brand.name } : null);
  const billTo = partyLines(ctx?.billTo);
  const details: string[] = [];
  if (no) details.push(`${paid ? 'Receipt for invoice' : 'Invoice no.'} ${no}`);
  if (v?.created_at) details.push('Issued ' + dayLabel(v.created_at, tz));
  if (!paid && !voided) details.push(v?.due_date ? 'Due ' + dayLabel(v.due_date, tz) : 'Due on receipt');
  if (paid) details.push(paidLine(v, tz));
  if (voided) details.push('Voided — no longer payable');
  if (ctx?.forWhat) details.push('For ' + ctx.forWhat);
  const parties = `<div class="parties">${partyBox('From', from)}${partyBox(paid ? 'Paid by' : 'Billed to', billTo)}${partyBox('Details', details)}</div>`;
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
  // a paid one opens with when and how it was paid, every part named
  const banner = paid ? `<div class="banner"><span class="dot" aria-hidden="true">✓</span><div><b>Paid in full. Thank you.</b>${esc(paidLine(v, tz))}${payments.length ? ` · with ${payments.length} earlier part payment${payments.length === 1 ? '' : 's'}: ${esc(payments.map((p) => paidLine(p, tz)).join('; '))}` : ''}</div></div>` : '';
  // A live pay link is an ACTION, not part of the printed record → no-print (the side card, and the bar a phone keeps at the bottom).
  const payUrl = (!paid && !voided && v?.stripe_url) ? String(v.stripe_url) : '';
  const payLink = payUrl ? `<a class="paylink" href="${esc(payUrl)}">Pay ${esc(money(v?.amount_cents, currency))} securely →</a>` : '';
  const note = paid ? 'Thank you — this is your receipt of payment.'
    : voided ? 'This request was voided and is no longer payable.'
    : `Payment is processed securely.${no ? ` Please quote ${no} with any payment by check or transfer.` : ''} This document is your copy of the request.`;
  const body = `${parties}${table}<p class="note">${esc(note)}</p>`;
  // the side card: the amount and the one thing to do next
  const dueWords = v?.due_date ? `Due ${dayLabel(v.due_date, tz)}.` : 'Due on receipt.';
  const dl = ctx?.pdfUrl ? pdfButton(paid ? 'Download the receipt' : 'Download PDF', paid) : '';
  const aside = paid
    ? `<div class="lbl">How it was paid</div>${[...payments, { amount_cents: amount, paid_at: v?.paid_at, paid_method: v?.paid_method, paid_note: v?.paid_note }].map((p) => `<div class="row"><span>${esc(dayLabel(p.paid_at, tz) || 'Paid')}<small>${esc([payMethodWords(p.paid_method).replace(/^(by|in) /, '').replace(/^./, (ch) => ch.toUpperCase()), String(p.paid_note || '').trim()].filter(Boolean).join(' · '))}</small></span><span>${esc(money(p.amount_cents, currency))}</span></div>`).join('')}<div class="sum"><span>Total paid</span><span>${esc(money(billed, currency))}</span></div>${dl}`
    : voided
      ? `<div class="lbl">Voided</div><div class="n struck">${esc(money(amount, currency))}</div><p>This request was voided and is no longer payable.</p>${dl}`
      : `<div class="lbl">Amount due</div><div class="n">${esc(money(amount, currency))}</div><p>${esc(dueWords)}${paidParts ? ` ${esc(money(paidParts, currency))} of ${esc(money(billed, currency))} is already paid.` : ''}</p>${payLink}${payLink ? '<p>A receipt comes by email as soon as it goes through.</p>' : ''}${payLink && dl ? '<hr>' : ''}${dl}`;
  const payBar = payLink ? `${ctx?.pdfUrl ? pdfButton('PDF') : ''}${payLink}` : '';
  const sub = [v?.created_at ? 'Issued ' + dayLabel(v.created_at, tz) : '', paid ? (dayLabel(v?.paid_at, tz) ? 'Paid ' + dayLabel(v.paid_at, tz) : '') : voided ? 'Voided' : (v?.due_date ? 'Due ' + dayLabel(v.due_date, tz) : 'Due on receipt')].filter(Boolean).join(' · ');
  return shell({ title: `${heading}${no ? ' ' + no : ''} — ${brand.name}`, brand, kickerHtml: kicker(`<div class="doclabel">${esc(docLabel)}${no ? ' ' + esc(no) : ''}</div>`, forWhomOf(ctx)), heading, sub, figure: { label: totalLabel, amount: money(totalCents, currency), pillHtml: pill }, bannerHtml: banner, bodyHtml: body, asideHtml: aside, payBarHtml: payBar || undefined, pdfUrl: ctx?.pdfUrl, pdfName: ctx?.pdfName, lasting: paid });
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
    if (c?.countersigned_name) rows.push(`<div class="kv"><span class="k">Countersigned by</span><span>${esc(String(c.countersigned_name))}${c?.countersigned_title ? ', ' + esc(String(c.countersigned_title)) : ''} for ${esc(brand.name)}</span></div>`);   // sales item 88
    rows.push(`<div class="kv"><span class="k">Signed at</span><span>${esc(utcStamp(c?.signed_at || ev?.at))}</span></div>`);
    rows.push(`<div class="kv"><span class="k">Document fingerprint (SHA-256)</span><span class="mono">${esc(hash)}</span></div>`);
    if (ev?.ip_hash) rows.push(`<div class="kv"><span class="k">Signing evidence (hashed IP)</span><span class="mono">${esc(String(ev.ip_hash))}</span></div>`);
    cert = `<div class="cert" id="certificate"><h2>Certificate of record</h2><p class="certsub">Proof of who signed, when, and exactly which words.</p>${rows.join('')}
      <p class="note">Typing a name to sign constitutes an electronic signature. The fingerprint identifies the exact text that was signed — it changes if even one character does, so this copy is tamper-evident.</p></div>`;
  }
  const statusSub = signed ? 'Executed copy — this is the signed document of record.'
    : c?.status === 'sent' ? 'Sent for signature — not yet signed.'
    : 'Draft — not yet sent for signature.';
  // sales item 88: the text laid out as a document (the signed characters unchanged), then both signatures
  const sigs = signed ? `<div class="hr"></div><h2 class="sigh" id="signatures">Signatures</h2>${signaturesHtml(c, brand, ctx)}` : '';
  const body = `<div class="agreement">${agreementHtml(String(c?.body || ''))}</div>${sigs}${cert}${signed ? '' : `<p class="note">This copy is not an executed agreement until it is signed.</p>`}`;
  // the contents beside the text: its headings, then the signatures and the certificate
  const heads = agreementContents(agreementBlocks(c?.body));
  const rail = heads.length >= 3 ? `<nav class="rail no-print" aria-label="In this agreement"><div class="lbl" style="padding:0 10px 8px">In this agreement</div>${heads.map((h) => `<a href="#${esc(h.id)}">${h.n ? `<b>${esc(h.n)}</b>` : ''}${esc(h.text)}</a>`).join('')}${signed ? '<a href="#signatures">Signatures</a><a href="#certificate">Certificate of record</a>' : ''}</nav>` : '';
  const both = signed && c?.countersigned_name;
  const pill = signed ? `<span class="pill paid">✓ ${both ? 'Signed by both' : 'Signed'}</span>` : c?.status === 'sent' ? '<span class="pill due">Waiting for a signature</span>' : '<span class="pill void">Draft</span>';
  const clientName = forWhomOf(ctx);
  const label = `<div class="doclabel">${signed ? 'Signed agreement' : 'Agreement'}</div>${clientName ? `<span>· Between ${esc(brand.name)} and ${esc(clientName)}</span>` : ''}`;
  return shell({ title: `${c?.title || 'Agreement'} — ${brand.name}`, brand, kickerHtml: label, heading: String(c?.title || 'Service agreement'), sub: statusSub, figure: { pillHtml: pill }, railHtml: rail || undefined, bodyHtml: body, pdfUrl: ctx?.pdfUrl, pdfName: ctx?.pdfName, lasting: signed });
}

/** Sales item 88: the two signatures on a signed agreement — the client's, typed by
 *  them, and the studio's, added at the same moment. Pure. */
export function signaturesHtml(c: any, brand: DocBrand, ctx?: DocContext | null): string {
  const tz = ctx?.tz || null;
  const day = dayLabel(c?.signed_at, tz);
  const clientName = String(ctx?.billTo?.company || ctx?.billTo?.name || '').trim();
  const one = (k: string, name: string, who: string) => `<div class="sig"><div class="k">${esc(k)}</div><div class="sgn">${esc(name)}</div><div class="line"></div><div class="who">${esc(who)}</div></div>`;
  const client = one(clientName ? `For ${clientName}` : 'For the client', String(c?.signer_name || ''), [String(c?.signer_name || ''), String(c?.signer_email || ''), day].filter(Boolean).join(' · '));
  const studio = c?.countersigned_name
    ? one(`For ${brand.name}`, String(c.countersigned_name), [String(c.countersigned_name) + (c?.countersigned_title ? ', ' + String(c.countersigned_title) : ''), dayLabel(c?.countersigned_at || c?.signed_at, tz) + ' (countersigned)'].filter(Boolean).join(' · '))
    : '';
  return `<div class="sigs">${client}${studio}</div>`;
}

/** Dispatch by kind. `data` is an already-loaded, site-scoped row. Pure. */
export function renderDocument(kind: DocKind, data: any, brand?: Partial<DocBrand> | null, ctx?: DocContext | null): string {
  if (kind === 'proposal') return renderProposalDocument(data, brand, ctx);
  if (kind === 'estimate') return renderEstimateDocument(data, brand, ctx);
  if (kind === 'invoice') return renderInvoiceDocument(data, brand, ctx);
  return renderContractDocument(data, brand, ctx);
}
