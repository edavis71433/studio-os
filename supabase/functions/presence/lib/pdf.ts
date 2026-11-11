// ── A small PDF writer (sales item 82: a real PDF instead of the print box) ──────
// Writes a plain PDF 1.4 file with the two fonts every PDF reader carries
// (Helvetica and Helvetica-Bold, so nothing is embedded), filled boxes, lines,
// wrapped text and link boxes. Pure: no I/O, no clock, no randomness, so the same
// layout gives the same bytes and tests can read the file back. The documents
// themselves are laid out in lib/doc_pdf.ts.
//
// Text is written in WinAnsi, the encoding those fonts use: Latin letters with
// accents, curly quotes, dashes, the euro sign and the like print as typed; any
// other character (an emoji, Chinese) prints as "?" rather than breaking the file.

export type PdfFont = 'R' | 'B';
export type Rgb = [number, number, number];

// Advance widths (thousandths of the font size) for codes 32–126, from the
// standard Helvetica and Helvetica-Bold metrics.
const W_R = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const W_B = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
// WinAnsi's code points above 127 that differ from Latin-1, and their byte
const WIN_ANSI: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e,
  '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};
// widths for the bytes above 127 that aren't a letter with an accent (those take their letter's width)
const HIGH_W: Record<number, [number, number]> = {
  0x80: [556, 556], 0x82: [222, 278], 0x84: [333, 500], 0x85: [1000, 1000], 0x86: [556, 556], 0x87: [556, 556], 0x89: [1000, 1000], 0x8b: [333, 333],
  0x91: [222, 278], 0x92: [222, 278], 0x93: [333, 500], 0x94: [333, 500], 0x95: [350, 350], 0x96: [556, 556], 0x97: [1000, 1000], 0x99: [1000, 1000], 0x9b: [333, 333],
  0xa0: [278, 278], 0xa1: [333, 333], 0xa2: [556, 556], 0xa3: [556, 556], 0xa5: [556, 556], 0xa7: [556, 556], 0xa9: [737, 737], 0xab: [556, 556], 0xae: [737, 737],
  0xb0: [400, 400], 0xb1: [584, 584], 0xb2: [333, 333], 0xb3: [333, 333], 0xb6: [537, 556], 0xb7: [278, 278], 0xb9: [333, 333], 0xbb: [556, 556],
  0xbc: [834, 834], 0xbd: [834, 834], 0xbe: [834, 834], 0xbf: [611, 611], 0xd7: [584, 584], 0xf7: [584, 584],
};
// stand-ins for characters the fonts don't have
const FOLD: Record<string, string> = { '−': '-', '‐': '-', '‑': '-', ' ': ' ', ' ': ' ', ' ': ' ', '​': '', '\t': ' ', '→': '->', '←': '<-', '✓': 'v', '★': '*', '·': '·' };

/** One character → its WinAnsi byte, or 63 ("?") when the fonts can't show it. */
function byteOf(ch: string): number {
  const c = ch.codePointAt(0) || 63;
  if (c >= 32 && c <= 126) return c;
  if (WIN_ANSI[ch] !== undefined) return WIN_ANSI[ch];
  if (c >= 0xa0 && c <= 0xff) return c;
  return 63;
}
/** A string as WinAnsi bytes (folded stand-ins first; control characters dropped). Pure. */
export function winAnsi(s: unknown): number[] {
  const out: number[] = [];
  for (const raw of String(s ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')) {
    const ch = FOLD[raw] !== undefined ? FOLD[raw] : raw;
    for (const c of ch) out.push(byteOf(c));
  }
  return out;
}
function byteWidth(b: number, font: PdfFont): number {
  if (b >= 32 && b <= 126) return (font === 'B' ? W_B : W_R)[b - 32];
  const hw = HIGH_W[b];
  if (hw) return font === 'B' ? hw[1] : hw[0];
  if (b >= 0xc0) {   // a letter with an accent: its plain letter's width
    const base = String.fromCharCode(b).normalize('NFD')[0];
    const bc = base.charCodeAt(0);
    if (bc >= 32 && bc <= 126) return (font === 'B' ? W_B : W_R)[bc - 32];
  }
  return 556;
}
/** The width of `s` in points at `size`. Pure. */
export function textWidth(s: unknown, font: PdfFont, size: number): number {
  let w = 0;
  for (const b of winAnsi(s)) w += byteWidth(b, font);
  return (w * size) / 1000;
}
/** Break `s` into lines no wider than `max` points: at spaces, and inside a
 *  word only when the word alone is wider than a line. Keeps the text's own
 *  line breaks; an empty line stays an empty line. Pure. */
export function wrapText(s: unknown, font: PdfFont, size: number, max: number): string[] {
  const out: string[] = [];
  for (const para of String(s ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    if (!para.trim()) { out.push(''); continue; }
    let line = '';
    for (const word of para.split(/ +/)) {
      if (!word) continue;
      const tryLine = line ? line + ' ' + word : word;
      if (textWidth(tryLine, font, size) <= max) { line = tryLine; continue; }
      if (line) { out.push(line); line = ''; }
      if (textWidth(word, font, size) <= max) { line = word; continue; }
      let piece = '';   // a word longer than the line (a long link, a fingerprint): break it
      for (const ch of word) {
        if (textWidth(piece + ch, font, size) > max && piece) { out.push(piece); piece = ''; }
        piece += ch;
      }
      line = piece;
    }
    out.push(line);
  }
  return out;
}

/** "#5b3fa0" → [r, g, b] in 0–1; a bad colour is ink. Pure. */
export function rgb(hex: unknown, fallback: Rgb = [0.106, 0.082, 0.145]): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const num = (n: number) => (Math.round(n * 100) / 100).toString();
const col = (c: Rgb) => c.map((v) => num(Math.max(0, Math.min(1, v)))).join(' ');
/** A PDF string literal for WinAnsi bytes: ( ) \ escaped, bytes above 126 as
 *  octal, so the whole file stays plain ASCII and its byte offsets are its length. */
function pdfString(bytes: number[]): string {
  let s = '(';
  for (const b of bytes) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) s += '\\' + String.fromCharCode(b);
    else if (b >= 32 && b <= 126) s += String.fromCharCode(b);
    else s += '\\' + b.toString(8).padStart(3, '0');
  }
  return s + ')';
}

interface Page { ops: string[]; links: Array<{ x: number; y: number; w: number; h: number; url: string }> }

/** The page is US Letter (612 × 792 points); y counts up from the bottom, as in PDF. */
export class PdfDoc {
  readonly width = 612;
  readonly height = 792;
  private pages: Page[] = [];
  private title: string;
  constructor(title = '') { this.title = title; this.addPage(); }
  get pageCount(): number { return this.pages.length; }
  private get cur(): Page { return this.pages[this.pages.length - 1]; }
  addPage(): void { this.pages.push({ ops: [], links: [] }); }
  /** Draw on an earlier page (the footer, once the page count is known). */
  onPage(i: number, fn: () => void): void {
    const keep = this.pages;
    const target = keep[i];
    if (!target) return;
    const rest = keep.slice();
    this.pages = [target];
    try { fn(); } finally { this.pages = rest; }
  }
  rect(x: number, y: number, w: number, h: number, fill: Rgb): void {
    this.cur.ops.push(`${col(fill)} rg ${num(x)} ${num(y)} ${num(w)} ${num(h)} re f`);
  }
  line(x1: number, y1: number, x2: number, y2: number, stroke: Rgb, width = 0.75): void {
    this.cur.ops.push(`${col(stroke)} RG ${num(width)} w ${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S`);
  }
  text(x: number, y: number, s: unknown, o: { font?: PdfFont; size?: number; color?: Rgb } = {}): void {
    const bytes = winAnsi(s);
    if (!bytes.length) return;
    const f = o.font === 'B' ? 'F2' : 'F1';
    this.cur.ops.push(`BT ${col(o.color || [0.106, 0.082, 0.145])} rg /${f} ${num(o.size || 10)} Tf ${num(x)} ${num(y)} Td ${pdfString(bytes)} Tj ET`);
  }
  /** Text whose right edge sits at `right`. */
  textRight(right: number, y: number, s: unknown, o: { font?: PdfFont; size?: number; color?: Rgb } = {}): void {
    this.text(right - textWidth(s, o.font || 'R', o.size || 10), y, s, o);
  }
  /** A clickable area that opens `url` (http or https only). */
  link(x: number, y: number, w: number, h: number, url: string): void {
    if (/^https?:\/\/[^\s()<>\\]+$/i.test(url)) this.cur.links.push({ x, y, w, h, url });
  }
  /** The finished file. */
  bytes(): Uint8Array<ArrayBuffer> {
    const objs: string[] = [];   // objs[i] is object i+1
    const add = (body: string) => { objs.push(body); return objs.length; };
    const catalog = add('');   // filled once the page tree's number is known
    const pagesId = add('');
    const fR = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const fB = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const info = add(`<< /Producer (Studio OS)${this.title ? ` /Title ${pdfString(winAnsi(this.title))}` : ''} >>`);
    const kids: number[] = [];
    for (const p of this.pages) {
      const content = p.ops.join('\n');
      const cId = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
      const annots = p.links.map((l) => add(`<< /Type /Annot /Subtype /Link /Rect [${num(l.x)} ${num(l.y)} ${num(l.x + l.w)} ${num(l.y + l.h)}] /Border [0 0 0] /A << /S /URI /URI ${pdfString(winAnsi(l.url))} >> >>`));
      kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.width} ${this.height}] /Resources << /Font << /F1 ${fR} 0 R /F2 ${fB} 0 R >> >> /Contents ${cId} 0 R${annots.length ? ` /Annots [${annots.map((a) => a + ' 0 R').join(' ')}]` : ''} >>`));
    }
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
    let out = '%PDF-1.4\n';
    const offsets: number[] = [];
    objs.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return new TextEncoder().encode(out);   // every byte is ASCII, so the offsets above are byte offsets
  }
}
