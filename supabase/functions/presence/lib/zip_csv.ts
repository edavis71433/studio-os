// ── CSV files in one zip (sales review item 69: "Download my data") ──────────
// A tiny, dependency-free writer: CSV text the way spreadsheets read it, and a
// zip that stores the files as they are (no compression: a studio's CSVs are
// small, and "stored" is the simplest form every unzip tool opens). Pure.

/** One CSV cell: quoted when it holds a comma, quote or line break; a cell that
 *  starts like a formula (= + - @, or a tab/return) gets a leading apostrophe so
 *  a spreadsheet shows it as text instead of running it. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
/** A whole CSV: a header row, then one row per record, CRLF line ends, and a
 *  byte-order mark so Excel reads accents and emoji as UTF-8. */
export function toCsv(header: string[], rows: unknown[][]): string {
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
/** The zip format's checksum (CRC-32, as in PNG and gzip). */
export function crc32(b: Uint8Array): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** Files into one zip, stored (method 0), names flagged UTF-8. */
export function zipStore(files: Array<{ name: string; data: Uint8Array }>, when = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const time = ((when.getUTCHours() << 11) | (when.getUTCMinutes() << 5) | Math.floor(when.getUTCSeconds() / 2)) & 0xFFFF;
  const date = (((Math.max(1980, when.getUTCFullYear()) - 1980) << 9) | ((when.getUTCMonth() + 1) << 5) | when.getUTCDate()) & 0xFFFF;
  const locals: Uint8Array[] = [], centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    const local = new Uint8Array(30 + name.length + size);
    local.set(new Uint8Array(lh.buffer), 0); local.set(name, 30); local.set(f.data, 30 + name.length);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, time, true); ch.setUint16(14, date, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, size, true); ch.setUint32(24, size, true); ch.setUint16(28, name.length, true);
    ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true); ch.setUint32(38, 0, true);
    ch.setUint32(42, offset, true);
    const central = new Uint8Array(46 + name.length);
    central.set(new Uint8Array(ch.buffer), 0); central.set(name, 46);
    locals.push(local); centrals.push(central);
    offset += local.length;
  }
  const cdSize = centrals.reduce((a, c) => a + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(4, 0, true); end.setUint16(6, 0, true);
  end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true); end.setUint16(20, 0, true);
  const out = new Uint8Array(offset + cdSize + 22);
  let at = 0;
  for (const l of locals) { out.set(l, at); at += l.length; }
  for (const c of centrals) { out.set(c, at); at += c.length; }
  out.set(new Uint8Array(end.buffer), at);
  return out;
}
