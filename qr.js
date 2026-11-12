/* A QR code for a link (builder list item 158, Nov 2026).
 * Preview's "On my phone" shows the private draft link as a code a phone's camera opens.
 * This draws it: byte mode (the link's UTF-8), error correction level M (a code still reads
 * with about 15% of it smudged or covered), the smallest of the 40 sizes that holds it, and
 * the mask that leaves the fewest patterns a camera could mistake. It follows the QR standard
 * (ISO/IEC 18004) step by step; tests/presence/qr_test.mjs checks the error correction against
 * the standard's worked example and the code's fixed parts on every size.
 *
 *   window.DDSQR.matrix(text)      rows of booleans (true is dark), no quiet zone; null if too long
 *   window.DDSQR.svg(text, label)  an <svg> string with a 4-module quiet zone, or "" if too long
 */
(function () {
  "use strict";
  // Error correction codewords per block, and the number of blocks, by size (1 to 40), level M.
  const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
  const BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];
  const LEVEL_M = 0;   // the format bits' code for level M

  // the modules left for data once a size's fixed patterns are drawn
  function rawModules(ver) {
    let n = (16 * ver + 128) * ver + 64;
    if (ver >= 2) { const a = Math.floor(ver / 7) + 2; n -= (25 * a - 10) * a - 55; if (ver >= 7) n -= 36; }
    return n;
  }
  const dataCodewords = (ver) => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ver] * BLOCKS[ver];

  // ── Reed–Solomon over GF(256), the polynomial x^8 + x^4 + x^3 + x^2 + 1 ──
  function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; }
    return z & 0xff;
  }
  function rsDivisor(degree) {
    const out = new Array(degree).fill(0); out[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < degree; j++) { out[j] = gfMul(out[j], root); if (j + 1 < degree) out[j] ^= out[j + 1]; }
      root = gfMul(root, 0x02);
    }
    return out;
  }
  function rsRemainder(data, divisor) {
    const out = divisor.map(() => 0);
    for (const b of data) {
      const factor = b ^ out.shift(); out.push(0);
      divisor.forEach((c, i) => { out[i] ^= gfMul(c, factor); });
    }
    return out;
  }

  function utf8(text) {
    if (typeof TextEncoder !== "undefined") return Array.from(new TextEncoder().encode(text));
    return Array.from(unescape(encodeURIComponent(text)), (c) => c.charCodeAt(0));
  }

  // the data codewords for the bytes at a size: mode, count, the bytes, the end and the padding
  function encode(bytes, ver) {
    const bits = [];
    const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(0x4, 4);
    put(bytes.length, ver <= 9 ? 8 : 16);
    bytes.forEach((b) => put(b, 8));
    const cap = dataCodewords(ver) * 8;
    put(0, Math.min(4, cap - bits.length));
    put(0, (8 - (bits.length % 8)) % 8);
    for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
    const out = [];
    for (let i = 0; i < bits.length; i += 8) { let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j]; out.push(v); }
    return out;
  }

  // split into blocks, add each block's error correction, and interleave them
  function withEcc(data, ver) {
    const nb = BLOCKS[ver], ecLen = ECC_PER_BLOCK[ver], raw = Math.floor(rawModules(ver) / 8);
    const nShort = nb - (raw % nb), shortLen = Math.floor(raw / nb), div = rsDivisor(ecLen);
    const blocks = [];
    for (let i = 0, k = 0; i < nb; i++) {
      const dat = data.slice(k, k + shortLen - ecLen + (i < nShort ? 0 : 1)); k += dat.length;
      const ecc = rsRemainder(dat, div);
      if (i < nShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    const out = [];
    for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - ecLen || j >= nShort) out.push(b[i]); });
    return out;
  }

  function alignmentAt(ver) {
    if (ver === 1) return [];
    const n = Math.floor(ver / 7) + 2, size = ver * 4 + 17;
    const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    const out = [6];
    for (let pos = size - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
    return out;
  }

  function formatBits(mask) {
    const data = (LEVEL_M << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return ((data << 10) | rem) ^ 0x5412;
  }

  function versionBits(ver) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    return (ver << 12) | rem;
  }

  function build(codewords, ver) {
    const size = ver * 4 + 17;
    const dark = Array.from({ length: size }, () => new Array(size).fill(false));
    const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, v) => { dark[y][x] = v; fixed[y][x] = true; };
    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }   // timing
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    const al = alignmentAt(ver), last = al.length - 1;
    al.forEach((ay, i) => al.forEach((ax, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
    const drawFormat = (mask) => {
      const b = formatBits(mask), bit = (i) => ((b >>> i) & 1) === 1;
      for (let i = 0; i <= 5; i++) set(8, i, bit(i));
      set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
      for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
      set(8, size - 8, true);   // the dark module
    };
    drawFormat(0);
    if (ver >= 7) {
      const b = versionBits(ver);
      for (let i = 0; i < 18; i++) { const v = ((b >>> i) & 1) === 1, a = size - 11 + (i % 3), c = Math.floor(i / 3); set(a, c, v); set(c, a, v); }
    }
    // the data, two columns at a time in a zigzag from the bottom right
    let k = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
        if (!fixed[y][x] && k < codewords.length * 8) { dark[y][x] = ((codewords[k >>> 3] >>> (7 - (k & 7))) & 1) === 1; k++; }
      }
    }
    // try the eight masks and keep the one with the lowest penalty
    const MASKS = [
      (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
      (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
    ];
    const flip = (m) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fixed[y][x] && MASKS[m](x, y)) dark[y][x] = !dark[y][x]; };
    let best = 0, bestScore = Infinity;
    for (let m = 0; m < 8; m++) {
      flip(m); drawFormat(m);
      const s = penalty(dark);
      if (s < bestScore) { bestScore = s; best = m; }
      flip(m);   // undo
    }
    flip(best); drawFormat(best);
    return dark;
  }

  // the standard's four penalty rules: runs, 2×2 blocks, finder-like patterns, and balance
  function penalty(m) {
    const size = m.length;
    let score = 0, darkCount = 0;
    const line = (get) => {
      let s = 0;
      for (let i = 0; i < size; i++) {
        let run = 1;
        for (let j = 1; j <= size; j++) {
          if (j < size && get(i, j) === get(i, j - 1)) { run++; continue; }
          if (run >= 5) s += 3 + (run - 5);
          run = 1;
        }
        for (let j = 0; j + 10 < size; j++) {   // 1:1:3:1:1 with four light on one side
          const p = (o) => get(i, j + o);
          const core = p(0) && !p(1) && p(2) && p(3) && p(4) && !p(5) && p(6);
          if (core && !p(7) && !p(8) && !p(9) && !p(10)) s += 40;
          const core2 = p(4) && !p(5) && p(6) && p(7) && p(8) && !p(9) && p(10);
          if (core2 && !p(0) && !p(1) && !p(2) && !p(3)) s += 40;
        }
      }
      return s;
    };
    score += line((i, j) => m[i][j]) + line((i, j) => m[j][i]);
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
    }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (m[y][x]) darkCount++;
    const total = size * size;
    score += Math.floor(Math.abs(darkCount * 20 - total * 10) / total) * 10;
    return score;
  }

  function matrix(text) {
    const bytes = utf8(String(text));
    for (let ver = 1; ver <= 40; ver++) {
      const capBits = dataCodewords(ver) * 8, need = 4 + (ver <= 9 ? 8 : 16) + bytes.length * 8;
      if (need <= capBits) return build(withEcc(encode(bytes, ver), ver), ver);
    }
    return null;
  }

  function svg(text, label) {
    const m = matrix(text); if (!m) return "";
    const q = 4, n = m.length + q * 2;
    let d = "";
    m.forEach((row, y) => row.forEach((on, x) => { if (on) d += "M" + (x + q) + " " + (y + q) + "h1v1h-1z"; }));
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + " " + n + '" shape-rendering="crispEdges" role="img" aria-label="' + esc(label || "QR code") + '">'
      + '<rect width="' + n + '" height="' + n + '" fill="#fff"/><path fill="#000" d="' + d + '"/></svg>';
  }

  window.DDSQR = { matrix, svg, _test: { gfMul, rsDivisor, rsRemainder, encode, withEcc, alignmentAt, formatBits, versionBits, dataCodewords, rawModules, penalty } };
})();
