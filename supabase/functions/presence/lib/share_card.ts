// ── Builder item 379: the plain share card ───────────────────────────────────────
// A texted or posted link shows a picture. A site with no photo and no logo has none of its
// own, so it gets a plain card: 1200 by 630 (the usual link-preview shape), the site's accent
// colour, the business name in capitals and the town under it. The server has no image tools,
// so this file holds everything the card needs: a small line font (capital letters, figures and
// the usual marks), soft-edged drawing, and a PNG writer with its own deflate (fixed codes,
// repeats of the byte before and of the row above). The same words and colours always give the
// same bytes. Pure: no I/O, no clock.
import { normHex, mix, contrastRatio } from './brand_kit.ts';

export const CARD_W = 1200, CARD_H = 630;
/** Part of the card's file name: raise it when the drawing changes, so shared links fetch the new one. */
export const SHARE_CARD_VERSION = 1;
const BAND = 18;              // a darker strip along the bottom edge
const MAX_LINE = 1040;        // the words keep 80px clear at each side
const MAX_BLOCK = 440;        // and at least 86px clear above and below
const LINE_GAP = 4;           // between the name's lines, in font units
const NAME_TRACK = 2.0, TOWN_TRACK = 2.6, NAME_PEN = 1.45, TOWN_PEN = 1.5;

// ── the line font: a cap height of 10, y down; a path is points and arcs, a lone point a dot ──
type Cmd = [number, number] | ['a', number, number, number, number, number, number];
interface Glyph { w: number; p: Cmd[][] }
const A = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number): Cmd => ['a', cx, cy, rx, ry, a0, a1];
const FONT: Record<string, Glyph> = {
  A: { w: 8, p: [[[0, 10], [4, 0], [8, 10]], [[1.36, 6.6], [6.64, 6.6]]] },
  B: { w: 7.4, p: [[[0, 10], [0, 0], [4.2, 0], A(4.2, 2.5, 2.6, 2.5, -90, 90), [0, 5], [4.6, 5], A(4.6, 7.5, 2.8, 2.5, -90, 90), [0, 10]]] },
  C: { w: 8.1, p: [[A(4.6, 5, 4.6, 5, -42, -318)]] },
  D: { w: 8, p: [[[0, 0], [0, 10], [3, 10], A(3, 5, 5, 5, 90, -90), [0, 0]]] },
  E: { w: 7, p: [[[7, 0], [0, 0], [0, 10], [7, 10]], [[0, 5], [5.6, 5]]] },
  F: { w: 7, p: [[[7, 0], [0, 0], [0, 10]], [[0, 5], [5.6, 5]]] },
  G: { w: 8.8, p: [[A(4.4, 5, 4.4, 5, -42, -360), [5.2, 5]]] },
  H: { w: 7, p: [[[0, 0], [0, 10]], [[7, 0], [7, 10]], [[0, 5], [7, 5]]] },
  I: { w: 0, p: [[[0, 0], [0, 10]]] },
  J: { w: 5, p: [[[5, 0], [5, 7], A(2.5, 7, 2.5, 3, 0, 180)]] },
  K: { w: 7.2, p: [[[0, 0], [0, 10]], [[7, 0], [0, 6.6]], [[2.6, 4.15], [7.2, 10]]] },
  L: { w: 6.4, p: [[[0, 0], [0, 10], [6.4, 10]]] },
  M: { w: 9, p: [[[0, 10], [0, 0], [4.5, 7.4], [9, 0], [9, 10]]] },
  N: { w: 7.6, p: [[[0, 10], [0, 0], [7.6, 10], [7.6, 0]]] },
  O: { w: 10, p: [[A(5, 5, 5, 5, 0, 360)]] },
  P: { w: 7, p: [[[0, 10], [0, 0], [4.2, 0], A(4.2, 2.8, 2.8, 2.8, -90, 90), [0, 5.6]]] },
  Q: { w: 10, p: [[A(5, 5, 5, 5, 0, 360)], [[6.2, 7.2], [9.6, 10.4]]] },
  R: { w: 7.2, p: [[[0, 10], [0, 0], [4.2, 0], A(4.2, 2.8, 2.8, 2.8, -90, 90), [0, 5.6]], [[3.8, 5.6], [7.2, 10]]] },
  S: { w: 7.4, p: [[A(3.7, 2.6, 3.5, 2.6, -28, -270), A(3.7, 7.5, 3.7, 2.5, -90, 150)]] },
  T: { w: 8, p: [[[0, 0], [8, 0]], [[4, 0], [4, 10]]] },
  U: { w: 7.6, p: [[[0, 0], [0, 6.4], A(3.8, 6.4, 3.8, 3.6, 180, 0), [7.6, 0]]] },
  V: { w: 8, p: [[[0, 0], [4, 10], [8, 0]]] },
  W: { w: 11, p: [[[0, 0], [2.7, 10], [5.5, 2.2], [8.3, 10], [11, 0]]] },
  X: { w: 7.6, p: [[[0, 0], [7.6, 10]], [[7.6, 0], [0, 10]]] },
  Y: { w: 8, p: [[[0, 0], [4, 5.4], [8, 0]], [[4, 5.4], [4, 10]]] },
  Z: { w: 7.6, p: [[[0, 0], [7.6, 0], [0, 10], [7.6, 10]]] },
  0: { w: 7.2, p: [[A(3.6, 5, 3.6, 5, 0, 360)]] },
  1: { w: 3.4, p: [[[0.6, 2.2], [3.4, 0], [3.4, 10]]] },
  2: { w: 7.2, p: [[A(3.6, 3, 3.4, 3, -165, 28), [0, 10], [7.2, 10]]] },
  3: { w: 7.2, p: [[A(3.5, 2.6, 3.2, 2.6, -160, 90), [2.6, 5.2], A(3.6, 7.5, 3.6, 2.5, -90, 155)]] },
  4: { w: 7.4, p: [[[5.6, 10], [5.6, 0], [0, 7], [7.4, 7]]] },
  5: { w: 7.2, p: [[[6.8, 0], [1, 0], [0.6, 4.9], A(3.6, 7, 3.6, 3, -145, 150)]] },
  6: { w: 7.2, p: [[[5.6, 0], [0.65, 4.81]], [A(3.6, 6.7, 3.6, 3.3, 0, 360)]] },
  7: { w: 7.2, p: [[[0, 0], [7.2, 0], [2.4, 10]]] },
  8: { w: 7.2, p: [[A(3.6, 2.6, 3, 2.6, 0, 360)], [A(3.6, 7.5, 3.6, 2.5, 0, 360)]] },
  9: { w: 7.2, p: [[A(3.6, 3.3, 3.6, 3.3, 0, 360)], [[6.55, 5.19], [1.6, 10]]] },
  ' ': { w: 4.4, p: [] },
  '.': { w: 0, p: [[[0, 10]]] },
  ',': { w: 0.8, p: [[[0.8, 9.6], [0, 11.6]]] },
  '-': { w: 4, p: [[[0, 6], [4, 6]]] },
  "'": { w: 0, p: [[[0, 0], [0, 2.8]]] },
  '"': { w: 1.6, p: [[[0, 0], [0, 2.8]], [[1.6, 0], [1.6, 2.8]]] },
  '!': { w: 0, p: [[[0, 0], [0, 7]], [[0, 10]]] },
  '?': { w: 6, p: [[A(3, 2.8, 3, 2.8, -175, 60), [3, 6.4], [3, 7.2]], [[3, 10]]] },
  ':': { w: 0, p: [[[0, 4]], [[0, 10]]] },
  '/': { w: 5, p: [[[5, 0], [0, 10]]] },
  '+': { w: 6, p: [[[0, 5.4], [6, 5.4]], [[3, 2.4], [3, 8.4]]] },
  '(': { w: 1.8, p: [[A(4.2, 5, 4.2, 6.2, -126, -234)]] },
  ')': { w: 1.8, p: [[A(-2.4, 5, 4.2, 6.2, -54, 54)]] },
  '&': { w: 8, p: [[[8, 10], A(3.4, 2.5, 2.1, 2.1, 137, 403), A(3.4, 7.6, 2.6, 2.4, 195, -25), [7.6, 5.2]]] },
};

/** The words as the card draws them: capitals, accents dropped (É → E), curly marks made
 *  straight, anything the font has no shape for left out, and the spaces closed up. */
export function cardText(s: string): string {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[‘’`´]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
    .toUpperCase().split('').filter((ch) => FONT[ch] || /\s/.test(ch)).join('').replace(/\s+/g, ' ').trim();
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;   // the same points on every machine
/** A glyph's strokes as polylines, in font units. */
function strokes(g: Glyph): Array<Array<[number, number]>> {
  return g.p.map((path) => {
    const pts: Array<[number, number]> = [];
    for (const c of path) {
      if (c[0] !== 'a') { pts.push([c[0] as number, c[1] as number]); continue; }
      const [, cx, cy, rx, ry, a0, a1] = c as ['a', number, number, number, number, number, number];
      const n = Math.max(6, Math.ceil(Math.abs(a1 - a0) / 8));
      for (let k = 0; k <= n; k++) { const t = (a0 + (a1 - a0) * k / n) * Math.PI / 180; pts.push([round3(cx + rx * Math.cos(t)), round3(cy + ry * Math.sin(t))]); }
    }
    return pts;
  });
}
const lineUnits = (text: string, track: number) => [...text].reduce((w, ch, i) => w + FONT[ch].w + (i ? track : 0), 0);
/** Greedy lines of whole words no wider than `max` font units. */
function wrap(words: string[], max: number, track: number): string[] {
  const out: string[] = [];
  for (const w of words) {
    const cur = out[out.length - 1];
    if (cur !== undefined && lineUnits(`${cur} ${w}`, track) <= max) out[out.length - 1] = `${cur} ${w}`; else out.push(w);
  }
  return out;
}

/** Draws one line of text into `cov` (0 to 255 per pixel, the strongest stroke wins). */
function drawLine(cov: Uint8Array, text: string, x0: number, y0: number, s: number, track: number, pen: number): void {
  const r = pen * s / 2;
  let x = x0;
  for (const ch of text) {
    const g = FONT[ch];
    for (const pts of strokes(g)) {
      const segs = pts.length === 1 ? [[pts[0], pts[0]]] : pts.slice(1).map((p, i) => [pts[i], p]);
      for (const [[ax, ay], [bx, by]] of segs) {
        const X0 = x + ax * s, Y0 = y0 + ay * s, X1 = x + bx * s, Y1 = y0 + by * s;
        const minX = Math.max(0, Math.floor(Math.min(X0, X1) - r - 1)), maxX = Math.min(CARD_W - 1, Math.ceil(Math.max(X0, X1) + r + 1));
        const minY = Math.max(0, Math.floor(Math.min(Y0, Y1) - r - 1)), maxY = Math.min(CARD_H - 1, Math.ceil(Math.max(Y0, Y1) + r + 1));
        const dx = X1 - X0, dy = Y1 - Y0, len2 = dx * dx + dy * dy;
        for (let py = minY; py <= maxY; py++) {
          for (let px = minX; px <= maxX; px++) {
            const qx = px + 0.5 - X0, qy = py + 0.5 - Y0;
            const t = len2 ? Math.max(0, Math.min(1, (qx * dx + qy * dy) / len2)) : 0;
            const ex = qx - t * dx, ey = qy - t * dy;
            const c = Math.max(0, Math.min(1, r + 0.5 - Math.sqrt(ex * ex + ey * ey)));
            const v = Math.round(c * 255), at = py * CARD_W + px;
            if (v > cov[at]) cov[at] = v;
          }
        }
      }
    }
    x += (g.w + track) * s;
  }
}

/** The card's colours from the site's accent: the accent behind, white or near-black words
 *  (whichever reads better on it), the town a little softer, the strip a little deeper. */
export function cardColours(accent?: string | null): { bg: string; ink: string; town: string; band: string } {
  const bg = normHex(accent) || '#1f2a44';
  const ink = contrastRatio('#ffffff', bg) >= contrastRatio('#111827', bg) ? '#ffffff' : '#111827';
  return { bg, ink, town: mix(ink, bg, 0.22), band: mix(bg, ink, 0.18) };
}

/** Where the words go: the name's lines and size, then the town's. Exported for its test. */
export function cardLayout(name: string, town = ''): { lines: string[]; scale: number; town: string; townScale: number; top: number } {
  const words = cardText(name).split(' ').filter(Boolean), t = cardText(town);
  const townScaleAt = (sc: number) => {
    let ts = Math.min(4.2, Math.max(2.5, sc * 0.55));
    while (t && ts > 2.5 && lineUnits(t, TOWN_TRACK) * ts > MAX_LINE) ts -= 0.25;
    return ts;
  };
  const height = (n: number, sc: number) => (n ? n * 10 * sc + (n - 1) * LINE_GAP * sc : 0) + (t ? 10 * townScaleAt(sc) + (n ? Math.max(26, 3.5 * sc) : 0) : 0);
  let scale = 3, lines: string[] = [];
  for (let sc = 11; sc >= 3; sc -= 0.5) {
    const ls = wrap(words, MAX_LINE / sc, NAME_TRACK);
    if (ls.length <= 3 && ls.every((l) => lineUnits(l, NAME_TRACK) * sc <= MAX_LINE) && height(ls.length, sc) <= MAX_BLOCK) { scale = sc; lines = ls; break; }
  }
  if (!lines.length && words.length) lines = wrap(words, MAX_LINE / scale, NAME_TRACK).slice(0, 3);
  return { lines, scale, town: t, townScale: townScaleAt(scale), top: Math.round((CARD_H - BAND - height(lines.length, scale)) / 2) };
}

/** The share card for a business: its name and town in its colours, as PNG bytes. */
export function shareCard(o: { name: string; town?: string; accent?: string | null }): Uint8Array {
  const col = cardColours(o.accent);
  const L = cardLayout(o.name, o.town || '');
  const nameCov = new Uint8Array(CARD_W * CARD_H), townCov = new Uint8Array(CARD_W * CARD_H);
  let y = L.top;
  for (const line of L.lines) {
    drawLine(nameCov, line, (CARD_W - lineUnits(line, NAME_TRACK) * L.scale) / 2, y, L.scale, NAME_TRACK, NAME_PEN);
    y += (10 + LINE_GAP) * L.scale;
  }
  if (L.town) {
    const ty = L.lines.length ? y - LINE_GAP * L.scale + Math.max(26, 3.5 * L.scale) : L.top;
    drawLine(townCov, L.town, (CARD_W - lineUnits(L.town, TOWN_TRACK) * L.townScale) / 2, ty, L.townScale, TOWN_TRACK, TOWN_PEN);
  }
  // palette: 0 the accent, 1 to 16 the name's soft edge to full, 17 to 32 the town's, 33 the strip
  const palette = [col.bg];
  for (let k = 1; k <= 16; k++) palette.push(mix(col.bg, col.ink, k / 16));
  for (let k = 1; k <= 16; k++) palette.push(mix(col.bg, col.town, k / 16));
  palette.push(col.band);
  const px = new Uint8Array(CARD_W * CARD_H);
  for (let i = 0; i < px.length; i++) {
    const n = Math.round(nameCov[i] / 255 * 16), t = Math.round(townCov[i] / 255 * 16);
    px[i] = i >= (CARD_H - BAND) * CARD_W ? 33 : n ? n : t ? 16 + t : 0;
  }
  return pngIndexed(CARD_W, CARD_H, palette, px);
}

// ── the PNG writer ──────────────────────────────────────────────────────────────
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(b: Uint8Array): number { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function adler32(b: Uint8Array): number { let a = 1, d = 0; for (let i = 0; i < b.length; i++) { a = (a + b[i]) % 65521; d = (d + a) % 65521; } return ((d << 16) | a) >>> 0; }

class Bits {
  out: number[] = []; cur = 0; n = 0;
  /** `len` bits of `v`, lowest first (extra bits, block header). */
  put(v: number, len: number) { for (let i = 0; i < len; i++) this.bit((v >> i) & 1); }
  /** A Huffman code, highest bit first. */
  code(v: number, len: number) { for (let i = len - 1; i >= 0; i--) this.bit((v >> i) & 1); }
  bit(b: number) { this.cur |= b << this.n; if (++this.n === 8) { this.out.push(this.cur); this.cur = 0; this.n = 0; } }
  done(): number[] { if (this.n) this.out.push(this.cur); return this.out; }
}
const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
function sym(b: Bits, s: number) {
  if (s < 144) b.code(0x30 + s, 8); else if (s < 256) b.code(0x190 + s - 144, 9); else if (s < 280) b.code(s - 256, 7); else b.code(0xc0 + s - 280, 8);
}
/** zlib data for `data` in one fixed-code deflate block; a repeat looks back one byte or one row. */
export function zlibFixed(data: Uint8Array, row: number): Uint8Array {
  const b = new Bits();
  b.put(1, 1); b.put(1, 2);   // the last block, fixed codes
  for (let p = 0; p < data.length;) {
    let best = 0, dist = 0;
    for (const d of [1, row]) {
      if (d <= 0 || p < d || d > 32768) continue;
      let l = 0; while (l < 258 && p + l < data.length && data[p + l] === data[p + l - d]) l++;
      if (l > best) { best = l; dist = d; }
    }
    if (best >= 3) {
      let i = LBASE.length - 1; while (LBASE[i] > best) i--;
      sym(b, 257 + i); if (LEXT[i]) b.put(best - LBASE[i], LEXT[i]);
      let j = DBASE.length - 1; while (DBASE[j] > dist) j--;
      b.code(j, 5); if (DEXT[j]) b.put(dist - DBASE[j], DEXT[j]);
      p += best;
    } else { sym(b, data[p]); p++; }
  }
  sym(b, 256);
  const body = b.done(), a = adler32(data);
  return Uint8Array.from([0x78, 0x01, ...body, a >>> 24, (a >>> 16) & 255, (a >>> 8) & 255, a & 255]);
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const t = new TextEncoder().encode(type), out = new Uint8Array(12 + data.length), v = new DataView(out.buffer);
  v.setUint32(0, data.length); out.set(t, 4); out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
/** An 8-bit palette PNG: `px` holds one palette index per pixel, row by row. */
export function pngIndexed(w: number, h: number, palette: string[], px: Uint8Array): Uint8Array {
  const raw = new Uint8Array(h * (w + 1));
  for (let y = 0; y < h; y++) raw.set(px.subarray(y * w, y * w + w), y * (w + 1) + 1);   // filter 0 on every row
  const ihdr = new Uint8Array(13), v = new DataView(ihdr.buffer);
  v.setUint32(0, w); v.setUint32(4, h); ihdr.set([8, 3, 0, 0, 0], 8);
  const plte = new Uint8Array(palette.length * 3);
  palette.forEach((hex, i) => plte.set([1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16)), i * 3));
  const parts = [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('PLTE', plte), chunk('IDAT', zlibFixed(raw, w + 1)), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0; for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
