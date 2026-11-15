// ── The QR code for "On my phone" (builder list item 158) ──
//   deno run --allow-read tests/presence/qr_test.mjs
// qr.js draws the private draft link as a code a phone's camera opens. A code with one wrong
// module may not scan at all, so this checks it against the QR standard's own numbers: the
// error correction on the standard's worked example ("HELLO WORLD", size 1, level M), the
// format and version bits from its tables, where the alignment patterns sit, how much each of
// the 40 sizes holds, and the fixed parts of the drawn code at every size.
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

globalThis.window = globalThis;
await import('../../qr.js');
const Q = globalThis.DDSQR;
const T = Q._test;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ═══ error correction: the standard's worked example ═══
{
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  const ecc = T.rsRemainder(data, T.rsDivisor(10));
  ok('Reed–Solomon gives the worked example’s ten error correction codewords', eq(ecc, [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]), JSON.stringify(ecc));
  ok('GF(256) multiplication: 2 × 128 wraps through the polynomial to 29', T.gfMul(2, 128) === 29);
  ok('…and multiplying by 1 changes nothing', [0, 1, 7, 128, 255].every((x) => T.gfMul(x, 1) === x));
}

// ═══ format and version bits, from the standard's tables ═══
{
  const M = ['101010000010010', '101000100100101', '101111001111100', '101101101001011', '100010111111001', '100000011001110', '100111110010111', '100101010100000'];
  M.forEach((want, mask) => ok(`format bits, level M, mask ${mask}`, T.formatBits(mask).toString(2).padStart(15, '0') === want));
  ok('version bits for size 7', T.versionBits(7).toString(2).padStart(18, '0') === '000111110010010100');
  ok('version bits for size 40', T.versionBits(40).toString(2).padStart(18, '0') === '101000110001101001');
}

// ═══ alignment pattern places ═══
{
  ok('size 1 has none', eq(T.alignmentAt(1), []));
  ok('size 2: 6 and 18', eq(T.alignmentAt(2), [6, 18]));
  ok('size 7: 6, 22, 38', eq(T.alignmentAt(7), [6, 22, 38]));
  ok('size 32 (the odd one): 6, 34, 60, 86, 112, 138', eq(T.alignmentAt(32), [6, 34, 60, 86, 112, 138]));
  ok('size 40: 6, 30, 58, 86, 114, 142, 170', eq(T.alignmentAt(40), [6, 30, 58, 86, 114, 142, 170]));
}

// ═══ what each size holds at level M (data codewords) ═══
{
  const want = [16, 28, 44, 64, 86, 108, 124, 154, 182, 216, 254, 290, 334, 365, 415, 453, 507, 563, 627, 669, 714, 782, 860, 914, 1000, 1062, 1128, 1193, 1267, 1373, 1455, 1541, 1631, 1725, 1812, 1914, 1992, 2102, 2216, 2334];
  const got = want.map((_, i) => T.dataCodewords(i + 1));
  ok('data codewords at level M match the standard for all 40 sizes', eq(got, want), JSON.stringify(got.map((g, i) => g - want[i])));
  ok('total codewords: 26 at size 1, 346 at size 10, 3706 at size 40', Math.floor(T.rawModules(1) / 8) === 26 && Math.floor(T.rawModules(10) / 8) === 346 && Math.floor(T.rawModules(40) / 8) === 3706);
}

// ═══ the drawn code ═══
{
  const finderAt = (m, x0, y0) => {
    for (let dy = 0; dy < 7; dy++) for (let dx = 0; dx < 7; dx++) {
      const d = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
      if (m[y0 + dy][x0 + dx] !== (d !== 2)) return false;
    }
    return true;
  };
  const fixedOk = (m) => {
    const n = m.length;
    if (!finderAt(m, 0, 0) || !finderAt(m, n - 7, 0) || !finderAt(m, 0, n - 7)) return 'finder';
    for (let i = 8; i < n - 8; i++) if (m[6][i] !== (i % 2 === 0) || m[i][6] !== (i % 2 === 0)) return 'timing';
    if (!m[n - 8][8]) return 'dark module';
    // the two copies of the format bits agree
    const a = [], b = [];
    for (let i = 0; i <= 5; i++) a.push(m[i][8]);
    a.push(m[7][8], m[8][8], m[8][7]);
    for (let i = 9; i < 15; i++) a.push(m[8][14 - i]);
    for (let i = 0; i < 8; i++) b.push(m[8][n - 1 - i]);
    for (let i = 8; i < 15; i++) b.push(m[n - 15 + i][8]);
    if (!eq(a, b)) return 'format copies';
    const bits = a.reduce((v, on, i) => v | ((on ? 1 : 0) << i), 0);
    const mask = [0, 1, 2, 3, 4, 5, 6, 7].find((k) => T.formatBits(k) === bits);
    return mask === undefined ? 'format bits' : '';
  };
  const sizes = [];
  for (let len = 1; len <= 300; len += 13) {
    const text = 'https://app.example.com/draft.html?s=' + 'a'.repeat(len);
    const m = Q.matrix(text);
    const ver = (m.length - 17) / 4;
    const bad = fixedOk(m);
    if (bad) { ok(`the code for a ${text.length}-character link`, false, bad); continue; }
    sizes.push(ver);
  }
  ok('every drawn code has its finders, timing, dark module and two matching format copies', sizes.length === 24);
  ok('longer links take bigger codes, never smaller', sizes.every((v, i) => i === 0 || v >= sizes[i - 1]));
  // a timed draft link as the server makes it: the site, the end and the scope, signed (lib/preview_link.ts)
  const body = btoa(JSON.stringify({ site_id: '0b8c1d9e-1234-4abc-9def-0123456789ab', exp: 1763500000, scope: 'preview' })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const draft = 'https://app.davisdigitalstudio.com/draft.html?s=' + encodeURIComponent(body + '.' + 'f'.repeat(64));
  const m = Q.matrix(draft);
  ok(`a real draft link (${draft.length} characters) fits size 11 (61 squares a side), easy for a phone at 220 pixels`, m && (m.length - 17) / 4 <= 11, m ? String((m.length - 17) / 4) : 'none');
  ok('the smallest size that holds the bytes is the one used', (() => { const v = (Q.matrix('hello').length - 17) / 4; return v === 1; })());
  ok('a link too long for size 40 draws nothing rather than a broken code', Q.matrix('x'.repeat(3000)) === null && Q.svg('x'.repeat(3000)) === '');
  const svg = Q.svg('https://app.example.com/draft.html?s=abc', 'Code for your draft');
  ok('the picture is an SVG with a white quiet zone and a name for screen readers', /^<svg [^>]*viewBox="0 0 (\d+) \1"/.test(svg) && svg.includes('role="img"') && svg.includes('aria-label="Code for your draft"') && svg.includes('<rect width='));
  ok('names are escaped in the picture', Q.svg('x', 'a"b<c').includes('aria-label="a&quot;b&lt;c"'));
}

const passed = results.filter(Boolean).length;
console.log(`\n════ QR CODE (item 158): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
