// ── Media hardening (Presence CMS Phase 1, M6) ───────────────────────────────
//   deno run --allow-read --allow-env tests/presence/media_hardening_test.mjs
// Pure decision helpers (magic-byte · EXIF strip · quota · GC eligibility) +
// structural wiring checks. No network.
Deno.env.delete('MAX_MEDIA_FILES');
Deno.env.delete('MAX_MEDIA_BYTES');
Deno.env.delete('MEDIA_GC_RETENTION_MS');
Deno.env.delete('MEDIA_GC_ORPHAN_MS');

const G = await import('../../supabase/functions/presence/lib/media_guard.ts');
const { sniffType, magicMatchesMime, stripJpegExif, hasJpegExif, mediaQuota, quotaExceeded, DEFAULT_MAX_MEDIA_FILES, DEFAULT_MAX_MEDIA_BYTES } = G;
const GC = await import('../../supabase/functions/presence/lib/media_gc.ts');
const { agedPast, gcRetentionMs, gcOrphanMs, DEFAULT_GC_RETENTION_MS, DEFAULT_GC_ORPHAN_MS } = GC;

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

// ── byte fixtures ──
const JPEG_SIG = [0xff, 0xd8, 0xff];
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const WEBP_SIG = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
const PDF_SIG = [0x25, 0x50, 0x44, 0x46, 0x2d];
const u8 = (arr) => new Uint8Array(arr);

// A minimal-but-well-formed JPEG: SOI · APP0(JFIF) · APP1(EXIF, w/ fake GPS) · SOS · scan · EOI
function buildJpegWithExif() {
  const seg = (marker, payload) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload];
  const app0 = seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]); // "JFIF\0" + fields
  const exifPayload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, /*GPS-ish junk*/ 0x47, 0x50, 0x53, 0x11, 0x22, 0x33, 0x44];
  const app1 = seg(0xe1, exifPayload);
  const sos = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00];
  const scan = [0xaa, 0xbb, 0xcc, 0xdd, 0xee]; // pretend compressed image data
  const eoi = [0xff, 0xd9];
  return u8([0xff, 0xd8, ...app0, ...app1, ...sos, ...scan, ...eoi]);
}

// ── magic-byte: sniff true type from the leading bytes ──
ok('sniff: JPEG signature → image/jpeg', sniffType(u8([...JPEG_SIG, 0xe0, 0])) === 'image/jpeg');
ok('sniff: PNG signature → image/png', sniffType(u8(PNG_SIG)) === 'image/png');
ok('sniff: WebP RIFF/WEBP → image/webp', sniffType(u8(WEBP_SIG)) === 'image/webp');
ok('sniff: %PDF- → application/pdf', sniffType(u8(PDF_SIG)) === 'application/pdf');
ok('sniff: garbage → null (unrecognized rejected)', sniffType(u8([0x00, 0x01, 0x02, 0x03, 0x04, 0x05])) === null);

// ── magic-byte: declared MIME must MATCH the binary (polyglot/mismatch rejected) ──
ok('valid: real JPEG declared image/jpeg → accepted', magicMatchesMime(u8([...JPEG_SIG, 0xe0]), 'image/jpeg') === true);
ok('valid: real PNG declared image/png → accepted', magicMatchesMime(u8(PNG_SIG), 'image/png') === true);
ok('polyglot: PNG bytes declared image/jpeg → REJECTED', magicMatchesMime(u8(PNG_SIG), 'image/jpeg') === false);
ok('polyglot: JPEG bytes declared image/png → REJECTED', magicMatchesMime(u8([...JPEG_SIG, 0]), 'image/png') === false);
ok('malformed: garbage declared image/jpeg → REJECTED', magicMatchesMime(u8([0, 1, 2, 3, 4, 5, 6, 7]), 'image/jpeg') === false);
ok('short: truncated JPEG (2 bytes) declared image/jpeg → REJECTED', magicMatchesMime(u8([0xff, 0xd8]), 'image/jpeg') === false);

// ── EXIF strip (JPEG) ──
{
  const jpeg = buildJpegWithExif();
  ok('exif: fixture starts WITH an APP1/EXIF segment', hasJpegExif(jpeg) === true);
  const stripped = stripJpegExif(jpeg);
  ok('exif: APP1/EXIF removed after strip (GPS + camera metadata gone)', hasJpegExif(stripped) === false);
  ok('exif: strip shrank the file (metadata dropped)', stripped.length < jpeg.length);
  ok('exif: still a valid JPEG signature after strip', magicMatchesMime(stripped, 'image/jpeg') === true);
  // image data preserved: the SOS marker + scan bytes + EOI survive verbatim
  const hasSeq = (hay, needle) => { outer: for (let i = 0; i + needle.length <= hay.length; i++) { for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer; return true; } return false; };
  ok('exif: compressed image data (scan) preserved — never decoded/corrupted', hasSeq(stripped, [0xaa, 0xbb, 0xcc, 0xdd, 0xee]));
  ok('exif: SOS marker preserved', hasSeq(stripped, [0xff, 0xda]));
  ok('exif: the "Exif" APP1 bytes are gone', !hasSeq(stripped, [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]));
  // idempotent + safe on non-JPEG
  ok('exif: strip is idempotent (second pass no-ops)', stripJpegExif(stripped).length === stripped.length);
  ok('exif: non-JPEG (PNG) passes through unchanged', (() => { const p = u8(PNG_SIG); return stripJpegExif(p).length === p.length; })());
  ok('exif: a JPEG without APP1 → hasJpegExif false', hasJpegExif(stripped) === false);
}

// ── per-site quota (count + storage) ──
{
  const limits = { maxFiles: 1000, maxBytes: 1000 };
  ok('quota: under both limits → allowed', quotaExceeded(10, 100, 50, limits).exceeded === false);
  ok('quota: at file count → blocked (reason=count)', (() => { const r = quotaExceeded(1000, 0, 1, limits); return r.exceeded && r.reason === 'count'; })());
  ok('quota: would exceed bytes → blocked (reason=bytes)', (() => { const r = quotaExceeded(5, 951, 50, limits); return r.exceeded && r.reason === 'bytes'; })());
  ok('quota: exactly filling bytes → allowed (boundary)', quotaExceeded(5, 900, 100, limits).exceeded === false);
  ok('quota: defaults are 1000 files / 1GB when env unset', mediaQuota().maxFiles === DEFAULT_MAX_MEDIA_FILES && mediaQuota().maxBytes === DEFAULT_MAX_MEDIA_BYTES && DEFAULT_MAX_MEDIA_FILES === 1000 && DEFAULT_MAX_MEDIA_BYTES === 1024 * 1024 * 1024);
  Deno.env.set('MAX_MEDIA_FILES', '25');
  ok('quota: MAX_MEDIA_FILES env overrides the default (configurable)', mediaQuota().maxFiles === 25);
  Deno.env.set('MAX_MEDIA_FILES', '0');
  ok('quota: non-positive env falls back to default', mediaQuota().maxFiles === DEFAULT_MAX_MEDIA_FILES);
  Deno.env.delete('MAX_MEDIA_FILES');
}

// ── GC eligibility (deterministic, fail-safe) ──
{
  const NOW = 1_000_000_000_000;
  const RET = DEFAULT_GC_RETENTION_MS;
  ok('gc: soft-deleted older than retention → eligible', agedPast(new Date(NOW - RET - 1000).toISOString(), NOW, RET) === true);
  ok('gc: soft-deleted within retention → NOT eligible (undo window)', agedPast(new Date(NOW - 1000).toISOString(), NOW, RET) === false);
  ok('gc: null timestamp → NOT eligible (fail-safe keep)', agedPast(null, NOW, RET) === false);
  ok('gc: unparseable timestamp → NOT eligible', agedPast('not-a-date', NOW, RET) === false);
  ok('gc: retention default 7d, orphan default 48h', gcRetentionMs() === DEFAULT_GC_RETENTION_MS && DEFAULT_GC_RETENTION_MS === 7 * 24 * 60 * 60_000 && gcOrphanMs() === DEFAULT_GC_ORPHAN_MS && DEFAULT_GC_ORPHAN_MS === 48 * 60 * 60_000);
}

// ── structural wiring: guards actually applied in the pipeline + GC on the cron ──
{
  const media = read('supabase/functions/presence/lib/media.ts');
  ok('wiring: createUpload enforces the per-site quota BEFORE issuing a URL', /quotaExceeded\(/.test(media) && /mediaQuota\(\)/.test(media) && /quota_exceeded/.test(media));
  ok('tenant: quota usage query is SITE-scoped (no cross-tenant count)', /presence_media\?site_id=eq\.\$\{siteId\}&deleted_at=is\.null&select=bytes/.test(media));
  ok('wiring: importImage validates magic bytes (rejects polyglots)', /magicMatchesMime\(bytes, mime\)/.test(media) && /invalid_image/.test(media));
  ok('wiring: importImage strips EXIF from the stored JPEG original', /stripJpegExif\(bytes\)/.test(media));
  // FD-AUD1: delete must refuse while the image is the site's logo/OG/cover or embedded in a block
  ok('delete-guard: deleteMedia checks presence_settings (logo/og/cover/blocks) before deleting', /presence_settings\?site_id=eq\.\$\{siteId\}&select=logo_media_id,og_media_id,cover_media_id,blocks/.test(media));
  ok('delete-guard: logo/og/cover/block references block the delete with a named reason', /logo_media_id === mediaId/.test(media) && /your logo/.test(media) && /a section on your website/.test(media));

  const sys = read('supabase/functions/presence/routes/system.ts');
  ok('wiring: media GC runs on the default cron cycle (no owner cron change)', /const media_gc = await reapMedia\(/.test(sys));
  ok('wiring: media GC also has a dedicated task', /task === 'media_gc'/.test(sys));

  // ONE store / no second pipeline: variants still come from the render transform (EXIF-safe output path)
  const lib = read('supabase/functions/presence/lib/media.ts');
  ok('invariant: publish variants still ride the render transform (orientation-safe, EXIF-free output)', /render\/image\/authenticated/.test(lib));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ MEDIA HARDENING (M6): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
