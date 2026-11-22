// ── Files for the studio (builder item 337) ──────────────────────────────────
// A client in the portal (and a studio sharing a deliverable) can send Word, text,
// SVG, Illustrator/EPS, iPhone HEIC, zips and short videos besides photos and PDFs.
// The kind is decided from the bytes, an SVG that could run is refused, the caps
// are 25MB for photos and documents and 100MB for videos and zips, the editor's
// picker never lists the new kinds, and a studio-only kind always downloads as an
// attachment under its own extension. Real code, in-memory PostgREST, stubbed
// storage. All names made up.
//   deno run --allow-read --allow-env --allow-net tests/presence/client_file_kinds_337_test.mjs
import { installFakePostgrest } from './fake_pgrst.mjs';
const uuid = (c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const SITE = uuid('1'), CLIENT = uuid('2');
const db = installFakePostgrest({});
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
const pg = globalThis.fetch;

const CF = await import('../../supabase/functions/presence/lib/client_files.ts');
const { STUDIO_KINDS, STUDIO_FILE_MIME, STUDIO_ONLY_MIME, STUDIO_ACCEPT, STUDIO_BOX_WORDS, CLIENT_PHOTO_BYTES, CLIENT_BIG_BYTES, byteFamilies, checkStudioBytes, svgSafe, isPlainText, ftypBrands, hiddenFromPicker, downloadName, attachmentName, bytesNeeded } = CF;
const M = await import('../../supabase/functions/presence/lib/media.ts');
const { createUpload, SITE_DOOR, STUDIO_DOOR, MIME_ALLOW, MAX_BYTES, MAX_DOC_BYTES, signDownload, IMAGE_MIME, DOC_MIME } = M;
const { verifyStoredUpload } = await import('../../supabase/functions/presence/lib/upload_check.ts');
const { fileKind } = await import('../../supabase/functions/presence/lib/dam.ts');
const { handleMediaList } = await import('../../supabase/functions/presence/routes/room.ts');

let pass = 0, fail = 0;
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; console.log('FAIL ', n, note); } };
const enc = (s) => new TextEncoder().encode(s);
const u8 = (...a) => new Uint8Array(a);
const MB = 1024 * 1024;
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// ── byte fixtures ──
const JPEG = u8(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46);
const PNG = u8(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d);
const WEBP = u8(0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50);
const PDF = enc('%PDF-1.7\n%âãÏÓ\n');
const PS = enc('%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 10 10\n');
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0, 0, 0, ...enc('mimetypeapplication/zip')]);
const DOCX_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...enc('[Content_Types].xml'), ...enc('PK\x03\x04'), ...enc('word/document.xml')]);
const DOC_BYTES = u8(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0);
const ftyp = (major, ...compat) => new Uint8Array([0, 0, 0, 16 + 4 * compat.length, ...enc('ftyp'), ...enc(major), 0, 0, 0, 0, ...compat.flatMap((b) => [...enc(b)]), 0, 0, 0, 8, ...enc('mdat')]);
const HEIC = ftyp('heic', 'mif1', 'heic');
const HEIF_MIF1 = ftyp('mif1', 'heic');
const MP4 = ftyp('isom', 'isom', 'iso2', 'avc1', 'mp41');
const MOV = ftyp('qt  ', 'qt  ');
const M4A = ftyp('M4A ', 'M4A ', 'isom');
const TXT = enc('Dear studio,\nhere are the words for the About page.\nThanks, Pat\n');
const SVG = enc('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#5b3fa0"/></svg>\n');
const EXE = u8(0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0);
const HTML = enc('<!doctype html><html><body><script>alert(1)</script></body></html>');

// ═══ the accept list ═══
{
  const want = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', DOCX, 'application/msword', 'text/plain', 'image/svg+xml', 'application/postscript', 'application/illustrator', 'image/heic', 'image/heif', 'application/zip', 'video/mp4', 'video/quicktime'];
  ok('the studio door takes exactly the fifteen kinds', want.every((m) => STUDIO_FILE_MIME.has(m)) && STUDIO_FILE_MIME.size === want.length);
  ok('the website’s own four kinds are not studio-only; the other eleven are', [...MIME_ALLOW].every((m) => !STUDIO_ONLY_MIME.has(m)) && STUDIO_ONLY_MIME.size === 11 && [...STUDIO_ONLY_MIME].every((m) => STUDIO_FILE_MIME.has(m)));
  ok('the website’s own lists did not move (images + PDF, 10MB and 25MB)', IMAGE_MIME.size === 3 && DOC_MIME.size === 1 && MIME_ALLOW.size === 4 && MAX_BYTES === 10 * MB && MAX_DOC_BYTES === 25 * MB);
  ok('the caps: photos and documents 25MB, videos and zips 100MB', CLIENT_PHOTO_BYTES === 25 * MB && CLIENT_BIG_BYTES === 100 * MB
    && ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf', DOCX, 'application/msword', 'text/plain', 'image/svg+xml', 'application/postscript', 'application/illustrator'].every((m) => STUDIO_KINDS[m].cap === 25 * MB)
    && ['application/zip', 'video/mp4', 'video/quicktime'].every((m) => STUDIO_KINDS[m].cap === 100 * MB));
  ok('every kind has its own extension', new Set(Object.values(STUDIO_KINDS).map((k) => k.ext)).size === Object.keys(STUDIO_KINDS).length);
  ok('the page’s accept list names every mime and extension', STUDIO_FILE_MIME.size + 16 === STUDIO_ACCEPT.split(',').length && ['.docx', '.doc', '.txt', '.svg', '.ai', '.eps', '.heic', '.heif', '.zip', '.mp4', '.mov', '.jpg', '.jpeg', '.png', '.webp', '.pdf'].every((e) => STUDIO_ACCEPT.split(',').includes(e)));
  ok('the box’s words name the kinds and both caps', /Word/.test(STUDIO_BOX_WORDS) && /HEIC/.test(STUDIO_BOX_WORDS) && /25MB/.test(STUDIO_BOX_WORDS) && /100MB/.test(STUDIO_BOX_WORDS) && /MP4 or MOV/.test(STUDIO_BOX_WORDS));
}

// ═══ the kind from the bytes ═══
{
  const fam = (b) => byteFamilies(b).join('+');
  ok('JPEG, PNG, WebP from their first bytes', fam(JPEG) === 'jpeg' && fam(PNG) === 'png' && fam(WEBP) === 'webp');
  ok('%PDF- is a PDF, and could be a newer .ai', fam(PDF) === 'pdf+postscript');
  ok('%!PS is EPS or Illustrator', fam(PS) === 'postscript');
  ok('PK is a zip; a zip holding word/ is also a Word file', fam(ZIP) === 'zip' && fam(DOCX_BYTES) === 'zip+word');
  ok('an OLE file is an old Word file', fam(DOC_BYTES) === 'word');
  ok('ftyp heic/mif1 is an iPhone photo (major or compatible brand)', fam(HEIC) === 'heic' && fam(HEIF_MIF1) === 'heic' && ftypBrands(HEIC).includes('mif1'));
  ok('ftyp isom/mp41 is a video; qt is a video', fam(MP4) === 'video' && fam(MOV) === 'video');
  ok('an audio-only M4A is not a video', fam(M4A) === '');
  ok('UTF-8 with no NUL is text; text with <svg is an SVG', fam(TXT) === 'text' && fam(SVG) === 'svg' && isPlainText(TXT) && !isPlainText(u8(0x41, 0, 0x42)) && !isPlainText(u8(0xff, 0xfe, 0x41)));
  ok('an executable, an empty file: nothing', fam(EXE) === '' && fam(new Uint8Array()) === '');
  ok('a text kind is read whole; a binary kind by its first 64KB', bytesNeeded('text/plain') === 'all' && bytesNeeded('image/svg+xml') === 'all' && bytesNeeded(DOCX) === 65536 && bytesNeeded('video/mp4') === 65536);
}

// ═══ declared type against the bytes ═══
{
  const yes = (b, m) => checkStudioBytes(b, m).ok === true;
  const no = (b, m) => { const r = checkStudioBytes(b, m); return r.ok === false ? r.message : ''; };
  ok('each kind passes under its own declared type', yes(JPEG, 'image/jpeg') && yes(PNG, 'image/png') && yes(WEBP, 'image/webp') && yes(PDF, 'application/pdf') && yes(DOCX_BYTES, DOCX) && yes(DOC_BYTES, 'application/msword') && yes(TXT, 'text/plain') && yes(SVG, 'image/svg+xml') && yes(PS, 'application/postscript') && yes(PS, 'application/illustrator') && yes(PDF, 'application/illustrator') && yes(HEIC, 'image/heic') && yes(HEIF_MIF1, 'image/heif') && yes(ZIP, 'application/zip') && yes(DOCX_BYTES, 'application/zip') && yes(MP4, 'video/mp4') && yes(MOV, 'video/quicktime'));
  ok('a PNG declared as a Word file is refused in plain words', /isn’t what its name says/.test(no(PNG, DOCX)));
  ok('a plain zip declared as a Word file is refused (no word/ inside)', /isn’t what its name says/.test(no(ZIP, DOCX)));
  ok('an executable declared as anything is refused', [...STUDIO_FILE_MIME].every((m) => no(EXE, m)));
  ok('an HTML page declared as plain text is refused (it is not text? it is — but never an SVG)', yes(HTML, 'text/plain') && no(HTML, 'image/svg+xml'));
  ok('an SVG sent as plain text is a mismatch, not text', /isn’t what its name says/.test(no(SVG, 'text/plain')));
  ok('a JPEG declared as HEIC, a MOV declared as a photo: refused', no(JPEG, 'image/heic') && no(MOV, 'image/jpeg'));
  ok('text with a NUL byte declared as text is refused', no(u8(0x41, 0x42, 0, 0x43), 'text/plain'));
  ok('a kind the door does not take says which kinds it does', /can’t be sent here/.test(no(PNG, 'image/gif')) && /Word/.test(no(PNG, 'image/gif')));
  ok('an SVG with a script is refused with its own words', /script or a link/.test(no(enc('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'image/svg+xml')));
}

// ═══ the SVG rule ═══
{
  const svg = (inner, attrs = '') => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"${attrs}>${inner}</svg>`;
  ok('a plain drawing is safe', svgSafe(svg('<rect width="4" height="4"/><text x="1" y="2">Hi</text>')) && svgSafe(new TextDecoder().decode(SVG)));
  ok('a drawing with styles, gradients and a local <use> is safe', svgSafe(svg('<defs><linearGradient id="g"><stop offset="0"/></linearGradient><style>.a{fill:url(#g)}</style></defs><use href="#g"/>')));
  ok('<script> is refused, in any case or spacing', !svgSafe(svg('<script>1</script>')) && !svgSafe(svg('<SCRIPT href="x"/>')) && !svgSafe(svg('< script>1</script>')));
  ok('an on* attribute is refused', !svgSafe(svg('<rect onload="alert(1)"/>')) && !svgSafe(svg('<a onclick = "x"/>')) && !svgSafe(svg('', ' onload="x"')));
  ok('a javascript: address is refused, entity-spelled too', !svgSafe(svg('<a href="javascript:alert(1)"><text>x</text></a>')) && !svgSafe(svg('<a xlink:href="JavaScript : x"/>')) && !svgSafe(svg('<a href="&#106;avascript:alert(1)"/>')));
  ok('foreignObject is refused', !svgSafe(svg('<foreignObject><div>x</div></foreignObject>')));
  ok('a remote image, use or stylesheet is refused', !svgSafe(svg('<image href="https://example.com/x.png"/>')) && !svgSafe(svg('<use xlink:href="//example.com/s.svg#a"/>')) && !svgSafe(svg('<style>@import "https://example.com/x.css"</style>')));
  ok('an entity declaration, an iframe, a form are refused', !svgSafe('<!DOCTYPE svg [<!ENTITY x "y">]>' + svg('&x;')) && !svgSafe(svg('<iframe src="x"/>')) && !svgSafe(svg('<form><input/></form>')));
  ok('something that is not an SVG at all is not safe', !svgSafe('<html><body>hi</body></html>') && !svgSafe('') && !svgSafe('svg'));
  ok('a comment hides nothing', !svgSafe(svg('<!-- <script> --><script>1</script>')));
}

// ═══ the caps at the doors (createUpload refuses before any read) ═══
{
  const at = async (door, mime, bytes) => { const r = await createUpload(SITE, { mime, bytes, alt_text: 'The brief' }, door); return r.error || 'ok?'; };
  ok('the studio door takes a 25MB photo and refuses 25MB + 1', (await at(STUDIO_DOOR, 'image/jpeg', 25 * MB)) !== 'too_large' && (await at(STUDIO_DOOR, 'image/jpeg', 25 * MB + 1)) === 'too_large');
  ok('…a 100MB video or zip, and refuses 100MB + 1', (await at(STUDIO_DOOR, 'video/mp4', 100 * MB)) !== 'too_large' && (await at(STUDIO_DOOR, 'application/zip', 100 * MB)) !== 'too_large' && (await at(STUDIO_DOOR, 'video/quicktime', 100 * MB + 1)) === 'too_large' && (await at(STUDIO_DOOR, 'application/zip', 100 * MB + 1)) === 'too_large');
  ok('…a 25MB Word file, SVG or text file, and refuses 25MB + 1', (await at(STUDIO_DOOR, DOCX, 25 * MB)) !== 'too_large' && (await at(STUDIO_DOOR, 'image/svg+xml', 25 * MB + 1)) === 'too_large' && (await at(STUDIO_DOOR, 'text/plain', 25 * MB + 1)) === 'too_large');
  ok('the studio door refuses a kind it does not take, naming the kinds', (await at(STUDIO_DOOR, 'image/gif', 10)) === 'unsupported_type' && /Word/.test((await createUpload(SITE, { mime: 'application/x-msdownload', bytes: 10, alt_text: 'x' }, STUDIO_DOOR)).message));
  ok('the website’s door is what it was: 10MB photos, 25MB PDFs, four kinds', (await at(SITE_DOOR, 'image/jpeg', 10 * MB + 1)) === 'too_large' && (await at(SITE_DOOR, 'application/pdf', 25 * MB + 1)) === 'too_large' && (await at(SITE_DOOR, DOCX, 10)) === 'unsupported_type' && (await at(SITE_DOOR, 'image/svg+xml', 10)) === 'unsupported_type');
  ok('createUpload with no door is the website’s door', (await createUpload(SITE, { mime: 'video/mp4', bytes: 10, alt_text: 'x' })).error === 'unsupported_type');
  const words = (await createUpload(SITE, { mime: 'video/mp4', bytes: 100 * MB + 1, alt_text: 'x' }, STUDIO_DOOR)).message;
  ok('the too-big words name the cap for that kind', /100MB/.test(words) && /Videos/.test(words) && /25MB/.test((await createUpload(SITE, { mime: 'image/heic', bytes: 30 * MB, alt_text: 'x' }, STUDIO_DOOR)).message));
}

// ═══ a studio-door upload is stored under the kind's own extension ═══
{
  db.reset({ presence_media: [] });
  globalThis.fetch = (url, init) => {
    const u = String(url);
    if (u.startsWith('https://db.test/storage/v1/object/upload/sign/')) return Promise.resolve(new Response(JSON.stringify({ url: '/object/upload/sign/' + u.split('/upload/sign/')[1] + '?token=t' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    return pg(url, init);
  };
  const r = await createUpload(SITE, { mime: DOCX, bytes: 1200, alt_text: 'The brief' }, STUDIO_DOOR);
  const row = db.tables.presence_media[0];
  ok('a Word file gets a .docx path and a media row with its mime', r.media_id && /\.docx$/.test(r.storage_path) && row && row.mime === DOCX && row.storage_path === r.storage_path);
  const r2 = await createUpload(SITE, { mime: 'video/quicktime', bytes: 1200, alt_text: 'Walk-through' }, STUDIO_DOOR);
  ok('a MOV gets a .mov path', /\.mov$/.test(r2.storage_path || ''));
  globalThis.fetch = pg;
}

// ═══ the stored bytes, checked before the file is recorded ═══
{
  const store = (bytes, ctype, opts = {}) => async (url, init) => {
    const method = (init && init.method) || 'GET';
    if (!String(url).includes('/storage/v1/object/authenticated/')) return new Response('{}', { status: 404 });
    if (opts.headFails) return new Response('', { status: 404 });
    if (method === 'HEAD') return new Response(null, { status: 200, headers: { 'Content-Type': ctype, 'Content-Length': String(opts.length ?? bytes.byteLength) } });
    if (opts.getFails) throw new Error('network');
    const range = new Headers(init.headers).get('Range');
    const m = range && range.match(/^bytes=0-(\d+)$/);
    const part = m ? bytes.subarray(0, Number(m[1]) + 1) : bytes;
    return new Response(part, { status: m ? 206 : 200 });
  };
  const verdict = async (bytes, ctype, declared, opts) => verifyStoredUpload(`presence-media/${SITE}/x.bin`, declared, store(bytes, ctype, opts));
  ok('a Word file stored as one: recorded', (await verdict(DOCX_BYTES, DOCX, DOCX)).ok === true);
  ok('a MOV, a HEIC, an SVG, a text file, an EPS, a zip: recorded', (await verdict(MOV, 'video/quicktime', 'video/quicktime')).ok && (await verdict(HEIC, 'image/heic', 'image/heic')).ok && (await verdict(SVG, 'image/svg+xml', 'image/svg+xml')).ok && (await verdict(TXT, 'text/plain', 'text/plain')).ok && (await verdict(PS, 'application/postscript', 'application/postscript')).ok && (await verdict(ZIP, 'application/zip', 'application/zip')).ok);
  const v1 = await verdict(PNG, DOCX, DOCX);
  ok('PNG bytes declared as a Word file: refused, in plain words', v1.ok === false && /isn’t what its name says/.test(v1.message));
  const v2 = await verdict(DOCX_BYTES, 'text/html', DOCX);
  ok('stored under a type other than the declared one: refused (storage would serve it as that type)', v2.ok === false && /isn’t what its name says/.test(v2.message));
  ok('…while an octet-stream or absent stored type carries no information', (await verdict(DOCX_BYTES, 'application/octet-stream', DOCX)).ok === true && (await verdict(DOCX_BYTES, '', DOCX)).ok === true);
  const v3 = await verdict(enc('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), 'image/svg+xml', 'image/svg+xml');
  ok('an SVG with an onload: refused with the SVG words', v3.ok === false && /script or a link/.test(v3.message));
  const v4 = await verdict(MP4, 'video/mp4', 'video/mp4', { length: 100 * MB + 1 });
  ok('bigger than the kind’s cap, by storage’s own count: refused', v4.ok === false && /too big/.test(v4.message) && /100MB/.test(v4.message));
  ok('a kind the door does not take: refused', (await verdict(PNG, 'image/gif', 'image/gif')).ok === false);
  ok('an empty object: refused', (await verdict(new Uint8Array(), DOCX, DOCX)).ok === false);
  ok('a store that counted bytes but sent none is no positive read: fails open', (await verdict(new Uint8Array(), DOCX, DOCX, { length: 10 })).ok === true);
  ok('storage unreadable (HEAD 404, GET throws): fails open, as before', (await verdict(PNG, DOCX, DOCX, { headFails: true })).ok === true && (await verdict(PNG, DOCX, DOCX, { getFails: true })).ok === true);
  // the first 64KB decide a binary kind, even when the store ignores Range
  const big = new Uint8Array(200 * 1024); big.set(DOCX_BYTES);
  ok('a large Word file is read by its first 64KB', (await verdict(big, DOCX, DOCX)).ok === true);
  Deno.env.delete('SERVICE_ROLE_KEY');
  ok('with no service key there is nothing to check against: fails open', (await verdict(PNG, DOCX, DOCX)).ok === true);
  Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
}

// ═══ the editor's picker never lists a studio-only kind ═══
{
  ok('hiddenFromPicker: the eleven studio-only kinds, never a photo or a PDF or an unknown', [...STUDIO_ONLY_MIME].every(hiddenFromPicker) && !hiddenFromPicker('image/jpeg') && !hiddenFromPicker('application/pdf') && !hiddenFromPicker('') && !hiddenFromPicker(null));
  ok('fileKind: an SVG or a HEIC is a file, not a photo; the three photo kinds are photos', fileKind('image/svg+xml') === 'other' && fileKind('image/heic') === 'other' && fileKind(DOCX) === 'other' && fileKind('video/mp4') === 'other' && fileKind('image/jpeg') === 'image' && fileKind('image/png') === 'image' && fileKind('image/webp') === 'image' && fileKind('application/pdf') === 'document');
  db.reset({
    presence_media: [
      { id: uuid('a'), site_id: SITE, storage_path: `presence-media/${SITE}/a.jpg`, mime: 'image/jpeg', alt_text: 'The room', client_private: false, created_at: '2026-11-01T00:00:00Z' },
      { id: uuid('b'), site_id: SITE, storage_path: `presence-media/${SITE}/b.pdf`, mime: 'application/pdf', alt_text: 'Price list', client_private: false, created_at: '2026-11-02T00:00:00Z' },
      { id: uuid('c'), site_id: SITE, storage_path: `presence-media/${SITE}/c.docx`, mime: DOCX, alt_text: 'The brief', client_private: false, created_at: '2026-11-03T00:00:00Z' },
      { id: uuid('d'), site_id: SITE, storage_path: `presence-media/${SITE}/d.svg`, mime: 'image/svg+xml', alt_text: 'Logo drawing', client_private: false, created_at: '2026-11-04T00:00:00Z' },
      { id: uuid('e'), site_id: SITE, storage_path: `presence-media/${SITE}/e.mov`, mime: 'video/quicktime', alt_text: 'Walk-through', client_private: false, created_at: '2026-11-05T00:00:00Z' },
      { id: uuid('f'), site_id: SITE, storage_path: `presence-media/${SITE}/f.heic`, mime: 'image/heic', alt_text: 'Phone photo', client_private: false, created_at: '2026-11-06T00:00:00Z' },
    ],
    presence_offerings: [], presence_posts: [], presence_settings: [{ site_id: SITE, cover_media_id: null }],
  });
  globalThis.fetch = (url, init) => (new URL(String(url)).hostname === 'db.test' && !String(url).includes('/storage/') ? pg(url, init) : Promise.resolve(new Response('{}', { status: 404 })));
  const site = { id: SITE, client_id: CLIENT, status: 'live', edition: 'presence', template_slug: 'business-classic', template_version: 1 };
  const r = await handleMediaList(site, {});
  const ids = ((await r.json()).data || []).map((m) => m.id);
  ok('GET /media lists the photo and the PDF, never the Word file, the SVG, the video or the HEIC', r.status === 200 && ids.length === 2 && ids.includes(uuid('a')) && ids.includes(uuid('b')));
  globalThis.fetch = pg;
}

// ═══ a studio-only kind always downloads as an attachment, under its extension ═══
{
  ok('downloadName: the title plus the kind’s extension, once', downloadName('The brief', DOCX) === 'The brief.docx' && downloadName('brief.docx', DOCX) === 'brief.docx' && downloadName('Walk-through', 'video/quicktime') === 'Walk-through.mov' && downloadName('Logo', 'image/svg+xml') === 'Logo.svg' && downloadName('', 'application/pdf') === 'download.pdf' && downloadName('Photo.jpeg', 'image/jpeg') === 'Photo.jpeg' && downloadName('Photo', 'image/jpeg') === 'Photo.jpg');
  ok('downloadName: no extension for a kind nobody knows; no slashes or quotes', downloadName('x', 'application/x-thing') === 'x' && downloadName('a/b"c', DOCX) === 'abc.docx');
  ok('attachmentName: a studio-only path is always named (given name, else the stored one), with its extension', attachmentName('Logo', `presence-media/${SITE}/d.svg`) === 'Logo.svg' && attachmentName(undefined, `presence-media/${SITE}/d.svg`) === 'd.svg' && attachmentName('brief.docx', `presence-media/${SITE}/c.docx`) === 'brief.docx' && attachmentName('', `presence-media/${SITE}/e.mov`) === 'e.mov');
  ok('attachmentName: a photo or PDF keeps what it was given (none means inline, as before)', attachmentName(undefined, `presence-media/${SITE}/a.jpg`) === undefined && attachmentName('Price list.pdf', `presence-media/${SITE}/b.pdf`) === 'Price list.pdf' && attachmentName('Room', `presence-media/${SITE}/a.jpg`) === 'Room');
  globalThis.fetch = (url) => Promise.resolve(new Response(JSON.stringify({ signedURL: '/object/sign/presence-media/' + String(url).split('/object/sign/presence-media/')[1] + '?token=t0k' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  const svgNoName = await signDownload(`presence-media/${SITE}/d.svg`);
  const svgNamed = await signDownload(`presence-media/${SITE}/d.svg`, 'Logo');
  const docx = await signDownload(`presence-media/${SITE}/c.docx`, downloadName('The brief', DOCX));
  const jpgNoName = await signDownload(`presence-media/${SITE}/a.jpg`);
  const pdfNamed = await signDownload(`presence-media/${SITE}/b.pdf`, 'Price list.pdf');
  ok('signDownload: an SVG with no name still carries download= (an attachment), under its stored name', svgNoName.endsWith('&download=d.svg'));
  ok('signDownload: an SVG named Logo downloads as Logo.svg; a Word file as The brief.docx', svgNamed.endsWith('&download=Logo.svg') && docx.endsWith('&download=The%20brief.docx'));
  ok('signDownload: a photo with no name is unchanged (inline); a named PDF as before', !/download=/.test(jpgNoName) && pdfNamed.endsWith('&download=Price%20list.pdf'));
  ok('signDownload: one signer (the same ten-minute signed object URL underneath)', svgNoName.startsWith('https://db.test/storage/v1/object/sign/presence-media/') && /token=t0k/.test(svgNoName));
  globalThis.fetch = pg;
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) Deno.exit(1);
