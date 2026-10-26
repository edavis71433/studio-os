// ── Free Tools: the report as a PDF, built in ────────────────────────────────
// Phase 4 (spec: "server side PDF generation … and attach the file"). Eric
// chose a built-in PDF over a paid HTML-to-PDF service, so this writes a
// plain PDF 1.4 file itself: the standard fonts every reader has (Helvetica,
// Times), the studio's navy and gold, every section of the report, a clickable
// Calendly link. No dependency, no network, a few KB per report.
//
// Text is set in WinAnsi encoding: curly quotes, dashes and accented letters
// print correctly; anything outside it (emoji) becomes "?".

import type { publicReport } from './report_view.ts';

type Report = ReturnType<typeof publicReport>;

const W = 612, H = 792, M = 54;                       // US Letter, 0.75 in margins
const NAVY = [15, 20, 42], GOLD = [176, 141, 87], INK = [29, 34, 54], MUTED = [91, 96, 117], LINE = [226, 223, 216];
const FIX = [180, 72, 58], WORK = [154, 113, 52], GOOD = [47, 107, 79];
const rgb = (c: number[]) => c.map((v) => (v / 255).toFixed(3)).join(' ');

// Helvetica advance widths (1/1000 em) for ASCII 32-126, from the standard AFM.
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const FONT_SCALE: Record<string, number> = { F1: 1, F2: 1.07, F3: 0.93, F4: 1 };   // Helvetica, -Bold, Times-Roman, Times-Bold (approx.)

const WIN: Record<string, number> = { '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '…': 0x85, '€': 0x80, '™': 0x99 };
function encodeChar(ch: string): number {
  const c = ch.charCodeAt(0);
  if (c >= 32 && c <= 126) return c;
  if (WIN[ch] != null) return WIN[ch];
  if (c >= 0xa0 && c <= 0xff) return c;
  if (c === 0x0a || c === 0x09) return 32;
  return 63; // ?
}
/** Text as a PDF string literal body: WinAnsi bytes, escaped, ASCII only. */
export function pdfString(s: string): string {
  let out = '';
  for (const ch of String(s).normalize('NFC')) {
    const b = encodeChar(ch);
    if (b === 0x28 || b === 0x29 || b === 0x5c) out += '\\' + String.fromCharCode(b);
    else if (b > 126) out += '\\' + b.toString(8).padStart(3, '0');
    else out += String.fromCharCode(b);
  }
  return out;
}
export function textWidth(s: string, font: string, size: number): number {
  let w = 0;
  for (const ch of String(s)) { const b = encodeChar(ch); w += b >= 32 && b <= 126 ? HELV[b - 32] : 556; }
  return (w * size * (FONT_SCALE[font] || 1)) / 1000;
}
export function wrap(s: string, font: string, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const para of String(s || '').split(/\n/)) {
    let cur = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = cur ? `${cur} ${word}` : word;
      if (textWidth(next, font, size) <= width) { cur = next; continue; }
      if (cur) lines.push(cur);
      // A single word wider than the line (a long URL): break it by characters.
      let w = word;
      while (textWidth(w, font, size) > width) {
        let k = w.length;
        while (k > 1 && textWidth(w.slice(0, k), font, size) > width) k--;
        lines.push(w.slice(0, k)); w = w.slice(k);
      }
      cur = w;
    }
    lines.push(cur);
  }
  return lines.length ? lines : [''];
}

class Doc {
  pages: { ops: string[]; links: { x: number; y: number; w: number; h: number; url: string }[] }[] = [];
  y = 0;
  constructor() { this.newPage(); }
  get page() { return this.pages[this.pages.length - 1]; }
  newPage() { this.pages.push({ ops: [], links: [] }); this.y = H - M; }
  need(h: number) { if (this.y - h < M + 24) this.newPage(); }
  text(s: string, x: number, y: number, font: string, size: number, color = INK) {
    this.page.ops.push(`BT /${font} ${size} Tf ${rgb(color)} rg ${x.toFixed(2)} ${y.toFixed(2)} Td (${pdfString(s)}) Tj ET`);
  }
  rect(x: number, y: number, w: number, h: number, color: number[]) { this.page.ops.push(`${rgb(color)} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`); }
  line(x1: number, y1: number, x2: number, y2: number, color = LINE, width = 0.75) { this.page.ops.push(`${rgb(color)} RG ${width} w ${x1} ${y1.toFixed(2)} m ${x2} ${y2.toFixed(2)} l S`); }
  /** Wrapped paragraph from the current position; returns nothing, moves y. */
  para(s: string, opts: { font?: string; size?: number; color?: number[]; x?: number; width?: number; lead?: number; after?: number } = {}) {
    const font = opts.font || 'F1', size = opts.size || 10, x = opts.x ?? M, width = opts.width ?? W - 2 * M, lead = opts.lead ?? size * 1.42;
    for (const ln of wrap(s, font, size, width)) { this.need(lead); this.y -= lead; this.text(ln, x, this.y, font, size, opts.color || INK); }
    this.y -= opts.after ?? 0;
  }
  heading(s: string) { this.need(46); this.y -= 22; this.text(s, M, this.y, 'F3', 17, NAVY); this.y -= 8; }
  link(label: string, url: string, x: number, size: number, color = NAVY) {
    this.need(size * 1.6); this.y -= size * 1.5;
    this.text(label, x, this.y, 'F2', size, color);
    this.page.links.push({ x, y: this.y - 3, w: textWidth(label, 'F2', size), h: size + 5, url });
  }
}

const tone = (s: number | null) => (s == null ? MUTED : s >= 80 ? GOOD : s >= 60 ? WORK : FIX);
const prioColor = (p: string) => (p === 'Fix now' ? FIX : p === 'Later' ? MUTED : WORK);

function table(d: Doc, t: { title: string; note?: string; columns: string[]; rows: (string | number | null)[][] }) {
  d.heading(t.title);
  if (t.note) d.para(t.note, { size: 9, color: MUTED, after: 4 });
  if (!t.rows.length) return;
  const total = W - 2 * M, n = t.columns.length;
  // Wider columns for the text-heavy first and second columns.
  const weights = t.columns.map((_, i) => (i === 0 ? 1.4 : i === 1 && n > 3 ? 1.6 : 1));
  const sum = weights.reduce((a, b) => a + b, 0);
  const cw = weights.map((w) => (w / sum) * total);
  const size = n > 5 ? 7.5 : 8.5, lead = size * 1.35, pad = 4;
  const row = (cells: string[], font: string, color: number[], shade: boolean) => {
    const lines = cells.map((c, i) => wrap(c, font, size, cw[i] - pad * 2));
    const h = Math.max(...lines.map((l) => l.length)) * lead + pad * 2;
    d.need(h);
    if (shade) d.rect(M, d.y - h, total, h, [250, 248, 245]);
    let x = M;
    lines.forEach((ls, i) => { ls.forEach((ln, k) => d.text(ln, x + pad, d.y - pad - (k + 1) * lead + 2, font, size, color)); x += cw[i]; });
    d.y -= h;
    d.line(M, d.y, M + total, d.y);
  };
  d.y -= 4;
  row(t.columns.map((c) => c.toUpperCase()), 'F2', MUTED, true);
  for (const r of t.rows) row(r.map((c) => (c == null || c === '' ? '–' : String(c))), 'F1', INK, false);
}

export function reportPdf(r: Report, reportLink: string): Uint8Array {
  const d = new Doc();
  // Header band.
  d.text('DAVIS DIGITAL STUDIO', M, d.y - 10, 'F2', 9, GOLD);
  d.text(`Free ${r.tool_name}`.toUpperCase(), W - M - textWidth(`Free ${r.tool_name}`.toUpperCase(), 'F2', 8), d.y - 10, 'F2', 8, MUTED);
  d.y -= 22;
  d.line(M, d.y, W - M, d.y, GOLD, 1);
  d.y -= 8;
  d.para(r.business.name || r.business.url || 'Your report', { font: 'F4', size: 24, color: NAVY, lead: 30 });
  const date = r.created_at ? new Date(String(r.created_at)).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
  d.para([r.business.name && r.business.url ? r.business.url : '', r.business.city, date].filter(Boolean).join('  ·  '), { size: 9.5, color: MUTED, after: 10 });

  // Score panel.
  d.need(84);
  const top = d.y;
  d.rect(M, top - 78, W - 2 * M, 78, [250, 248, 245]);
  d.rect(M, top - 78, 4, 78, tone(r.overall));
  d.text(r.overall == null ? '–' : String(r.overall), M + 22, top - 50, 'F4', 38, NAVY);
  d.text('out of 100', M + 22, top - 66, 'F1', 8.5, MUTED);
  d.text(r.label || 'Score not available', M + 110, top - 26, 'F2', 12, tone(r.overall));
  let py = top - 44;
  const items = r.pillars.length ? r.pillars.map((p) => `${p.name}: ${p.score == null ? (p.note || 'not measured') : `${p.score}/100`}`) : r.highlights.map((h) => `${h.label}: ${h.value}`);
  const colW = (W - 2 * M - 120) / 2;
  items.slice(0, 4).forEach((it, i) => { d.text(it, M + 110 + (i % 2) * colW, py - Math.floor(i / 2) * 14, 'F1', 9, INK); });
  d.y = top - 92;
  if (r.pillars.length && r.highlights.length) d.para(r.highlights.map((h) => `${h.label}: ${h.value}`).join('   ·   '), { size: 9, color: MUTED });
  d.para(r.summary, { size: 10.5, lead: 15, after: 4 });
  for (const n of r.notes) d.para(n, { size: 8.5, color: MUTED });

  if (r.top_three.length) {
    d.heading('Top 3 fixes');
    r.top_three.forEach((t, i) => { d.para(`${i + 1}.  ${t}`, { size: 10.5, lead: 15, after: 2 }); });
  }

  if (r.findings.length) {
    d.heading('What we found');
    for (const f of r.findings) {
      d.need(70);
      d.y -= 12;
      const tag = `${f.priority || ''}${f.pillar ? `  ·  ${f.pillar}` : ''}`.toUpperCase();
      d.text(tag, M, d.y, 'F2', 7.5, prioColor(f.priority));
      d.y -= 2;
      d.para(f.title, { font: 'F4', size: 12.5, color: NAVY, lead: 16 });
      for (const [label, body] of [['What we found', f.what_we_found], ['Why it matters', f.why_it_matters], ['The fix', f.fix]] as const) {
        if (!body) continue;
        d.need(26);
        d.y -= 13; d.text(label.toUpperCase(), M, d.y, 'F2', 7, GOLD);
        d.para(body, { size: 9.5, lead: 13 });
      }
      d.y -= 4;
      d.line(M, d.y, W - M, d.y);
    }
  }

  for (const t of r.tables) table(d, t);

  // Closing call to action.
  d.need(90);
  d.y -= 24;
  const boxTop = d.y;
  d.rect(M, boxTop - 74, W - 2 * M, 74, NAVY);
  d.y = boxTop - 8;
  d.para(r.closing.text, { font: 'F4', size: 13, color: [255, 255, 255], x: M + 18, width: W - 2 * M - 36, lead: 17 });
  d.link(r.closing.url.replace(/^https:\/\//, ''), r.closing.url, M + 18, 10.5, [201, 164, 100]);
  d.y = boxTop - 86;
  d.para(`Online version: ${reportLink}`, { size: 8.5, color: MUTED });

  return assemble(d);
}

function assemble(d: Doc): Uint8Array {
  const objs: string[] = [];
  const add = (s: string) => { objs.push(s); return objs.length; };
  const catalog = add(''), pages = add('');
  const fonts = [['F1', 'Helvetica'], ['F2', 'Helvetica-Bold'], ['F3', 'Times-Roman'], ['F4', 'Times-Bold']]
    .map(([k, base]) => [k, add(`<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding >>`)] as const);
  const fontRes = fonts.map(([k, id]) => `/${k} ${id} 0 R`).join(' ');
  const kids: number[] = [];
  d.pages.forEach((p, i) => {
    const footer = `BT /F1 7.5 Tf ${rgb(MUTED)} rg ${M} 30 Td (${pdfString('Davis Digital Studio LLC · Burbank, California · davisdigitalstudio.com')}) Tj ET ` +
      `BT /F1 7.5 Tf ${rgb(MUTED)} rg ${W - M - 40} 30 Td (${pdfString(`Page ${i + 1} of ${d.pages.length}`)}) Tj ET`;
    const stream = [...p.ops, footer].join('\n');
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const annots = p.links.map((l) => add(`<< /Type /Annot /Subtype /Link /Rect [${l.x.toFixed(1)} ${l.y.toFixed(1)} ${(l.x + l.w).toFixed(1)} ${(l.y + l.h).toFixed(1)}] /Border [0 0 0] /A << /S /URI /URI (${pdfString(l.url)}) >> >>`));
    kids.push(add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << ${fontRes} >> >> /Contents ${content} 0 R${annots.length ? ` /Annots [${annots.map((a) => `${a} 0 R`).join(' ')}]` : ''} >>`));
  });
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pages} 0 R >>`;
  objs[pages - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info << /Producer (Davis Digital Studio) >> >>\nstartxref\n${xref}\n%%EOF\n`;
  // Everything above is ASCII (non-ASCII text was written as octal escapes),
  // so one char is one byte and the xref offsets are exact.
  return new TextEncoder().encode(out);
}
