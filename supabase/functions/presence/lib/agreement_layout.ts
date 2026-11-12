// ── The agreement reads as a document (sales item 88, file 07 finding 9) ─────
// An agreement is stored and signed as plain text: content_hash fingerprints the
// exact characters, so nothing here may change them. What changes is how the text
// is SHOWN: the client's page (sign.html, which carries a mirror of agreementBlocks
// that tests/presence/agreement_layout_test.mjs runs against this one), the signed
// document page and its PDF (lib/documents.ts, lib/doc_pdf.ts) and the signed-copy
// email all draw the same blocks — a title, numbered headings, paragraphs and list
// items — instead of one wall of text.
//
// The rules follow how the studio's own agreements are written (pipeline.html's
// packages): "1. SCOPE OF WORK" is a numbered heading; "11. Severability.  If any…"
// is a heading with its first paragraph on the same line; a short line in capitals
// ("PROJECT SUMMARY") is a heading without a number; "(a) …", "a) …", "- …" and
// "• …" are list items; lines that follow one another make one paragraph (their own
// line breaks kept, so a "Studio:   Brightline" summary keeps its rows). Anything
// else is a paragraph, so no wording is ever lost. Pure.

export type AgreementBlock =
  | { t: 'title'; text: string }
  | { t: 'heading'; n: string | null; text: string; id: string }
  | { t: 'para'; text: string }
  | { t: 'item'; mark: string; text: string };

const isCapsLine = (s: string): boolean => {
  const letters = s.replace(/[^A-Za-z]/g, '');
  return letters.length >= 3 && s.length <= 90 && letters === letters.toUpperCase() && !/[.:;,]$/.test(s.trim());
};

/** The blocks of an agreement's text, in order. Pure. */
export function agreementBlocks(body: unknown): AgreementBlock[] {
  const lines = String(body ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out: AgreementBlock[] = [];
  let para: string[] = [];
  let hn = 0;
  const flush = () => { if (para.length) { out.push({ t: 'para', text: para.join('\n') }); para = []; } };
  const heading = (n: string | null, text: string) => { hn++; out.push({ t: 'heading', n, text, id: 's' + hn }); };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const s = line.trim();
    if (!s) { flush(); continue; }
    // the first line of the document, in capitals, is its title
    if (!out.length && !para.length && isCapsLine(s) && !/^\d{1,2}\.\s/.test(s)) { out.push({ t: 'title', text: s }); continue; }
    let m = /^(\d{1,2})\.\s+(.+)$/.exec(s);
    if (m) {
      const rest = m[2].trim();
      if (isCapsLine(rest)) { flush(); heading(m[1], rest); continue; }
      // "11. Severability.  If any provision …" — a short name, then its words
      const named = /^([A-Z][A-Za-z ,&'’()\/-]{1,60}?)\.\s+(\S.*)$/.exec(rest);
      if (named) { flush(); heading(m[1], named[1]); para.push(named[2]); continue; }
      if (rest.length <= 70 && !/[.;:]$/.test(rest)) { flush(); heading(m[1], rest); continue; }
    }
    if (isCapsLine(s) && !/^\(?[a-z0-9]{1,3}\)/i.test(s)) { flush(); heading(null, s); continue; }
    m = /^\(([a-z0-9]{1,3})\)\s+(.+)$/i.exec(s) || /^([a-z])\)\s+(.+)$/.exec(s);
    if (m) { flush(); out.push({ t: 'item', mark: `(${m[1]})`, text: m[2] }); continue; }
    m = /^[-•*]\s+(.+)$/.exec(s);
    if (m) { flush(); out.push({ t: 'item', mark: '•', text: m[1] }); continue; }
    para.push(line);
  }
  flush();
  return out;
}

/** The numbered and named headings, for a contents list. Pure. */
export function agreementContents(blocks: AgreementBlock[]): Array<{ id: string; n: string | null; text: string }> {
  return blocks.filter((b): b is Extract<AgreementBlock, { t: 'heading' }> => b.t === 'heading').map((b) => ({ id: b.id, n: b.n, text: b.text }));
}

/** Every word of the text survives the layout, in order (what the tests hold it to). Pure. */
export function agreementWords(blocks: AgreementBlock[]): string {
  return blocks.map((b) => b.t === 'heading' ? `${b.n ? b.n + '. ' : ''}${b.text}` : b.t === 'item' ? `${b.mark} ${b.text}` : b.text).join(' ').replace(/\s+/g, ' ').trim();
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

/** The blocks as HTML for the document page and the signed-copy email. `email`
 *  inlines every style (mail apps drop style blocks). Pure. */
export function agreementHtml(body: unknown, opts: { email?: boolean; accent?: string } = {}): string {
  const accent = opts.accent || '#5b3fa0';
  const st = (css: string) => opts.email ? ` style="${css}"` : '';
  return agreementBlocks(body).map((b) => {
    if (b.t === 'title') return `<h2 class="ag-title"${st('font-family:Georgia,serif;font-size:20px;font-weight:600;margin:0 0 12px;letter-spacing:.02em')}>${esc(b.text)}</h2>`;
    if (b.t === 'heading') return `<h3 class="ag-h" id="${esc(b.id)}"${st('font-size:15px;font-weight:700;margin:20px 0 6px')}>${b.n ? `<span class="ag-n"${st(`color:${accent};margin-right:8px`)}>${esc(b.n)}.</span>` : ''}${esc(b.text)}</h3>`;
    if (b.t === 'item') return `<p class="ag-item"${st('margin:4px 0 4px 18px')}><span class="ag-mark"${st(`color:${accent};font-weight:600;margin-right:6px`)}>${esc(b.mark)}</span>${esc(b.text)}</p>`;
    return `<p class="ag-p"${st('margin:0 0 10px;white-space:pre-wrap')}>${esc(b.text)}</p>`;
  }).join('');
}

// ── the rest of item 88's small rules ───────────────────────────────────────
/** Why a client declines, as the page offers it (the note says the rest). */
export const DECLINE_REASONS: Record<string, string> = { price: 'The price', timing: 'The timing', scope: 'What’s included', elsewhere: 'We went another way' };
export const declineReason = (v: unknown): string => (typeof v === 'string' && Object.prototype.hasOwnProperty.call(DECLINE_REASONS, v) ? v : '');
/** The decline in a sentence for the studio: "The timing: “If online ordering …”". Pure. */
export function declineWords(reason: unknown, note: unknown): string {
  const r = DECLINE_REASONS[declineReason(reason)] || '';
  const n = String(note ?? '').trim();
  if (r && n) return `${r}: “${n}”`;
  return r || (n ? `“${n}”` : '');
}
/** The Inbox subject for a question from the page. Pure. */
export function askSubject(kind: 'proposal' | 'contract' | 'estimate', title: unknown): string {
  const what = kind === 'contract' ? 'the agreement' : kind === 'estimate' ? 'the estimate' : 'the proposal';
  const t = String(title ?? '').trim();
  return `A question about ${what}${t ? `: ${t}` : ''}`.slice(0, 200);
}
/** "s…@cornercafe.com": enough for the person to know it's theirs. Pure. */
export function maskEmail(email: unknown): string {
  const e = String(email ?? '').trim();
  const at = e.indexOf('@');
  if (at < 1) return '';
  return e[0] + '…' + e.slice(at);
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const validSignerEmail = (v: unknown): boolean => EMAIL_RE.test(String(v ?? '').trim()) && String(v).trim().length <= 160;
/** Who signs for the studio: the name and title set in Settings, else the owner's
 *  own name, else the business's name. Pure. */
export function studioSignerOf(o: { signsAsName?: unknown; signsAsTitle?: unknown; ownerName?: unknown; business?: unknown }): { name: string; title: string; business: string } {
  const business = String(o.business ?? '').trim();
  const name = String(o.signsAsName ?? '').trim() || String(o.ownerName ?? '').trim() || business;
  return { name: name.slice(0, 120), title: String(o.signsAsTitle ?? '').trim().slice(0, 80), business };
}
