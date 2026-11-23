// ── Builder item 395: every upload is checked on what arrived, not what was claimed ──
//   deno run --allow-read --allow-env --allow-net tests/presence/upload_checks_395_test.mjs
// Uploads go from the browser straight to storage on a signed link, and only the client
// portal read the stored file back (Nov 22 2026 review, file 07 finding 19). Now:
//   1  the judgement: the kind from the file's first bytes and the type storage serves it as,
//      the size storage counted; a PNG named .jpg is kept, a page that isn't a photo isn't
//   2  the 15-minute run reads each new upload back: the real size is recorded (the storage
//      total counts it), a lie is taken out of Files with its bytes and the site is told,
//      one not uploaded yet or a storage that doesn't answer is left for next time
//   3  the buckets are written down as the code needs them, and no storage rule lets a
//      browser at client-files (migration 0269)
import { installFakePostgrest } from './fake_pgrst.mjs';
import { pinClock } from './clock.mjs';

const ROOT = new URL('../../', import.meta.url);
const kindsSql = Deno.readTextFileSync(new URL('supabase/migrations/0270_notice_kinds_safety.sql', ROOT));
const NOTICE_KINDS = [...kindsSql.slice(kindsSql.indexOf('check (kind in (')).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
const db = installFakePostgrest({ strict: { presence_plan_notices: { check: { kind: NOTICE_KINDS } } } });

const results = [];
const ok = (n, p, note = '') => { results.push(!!p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const restore = pinClock('2026-11-21T18:00:00Z');
const P = '../../supabase/functions/presence';
const U = await import(`${P}/lib/upload_check.ts`);
const { STUDIO_FILE_MIME } = await import(`${P}/lib/client_files.ts`);
const { sweepIssues } = await import(`${P}/routes/system.ts`);

const enc = (s) => new TextEncoder().encode(s);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const PDF = enc('%PDF-1.7\n%âã');
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0]);
const HTML = enc('<!doctype html><script>alert(1)</script>');
const MB = 1024 * 1024;
const judge = (declaredMime, bytes, o = {}) => U.judgeStored({ declaredMime, declaredBytes: o.declared ?? 1000, storedType: o.type === undefined ? declaredMime : o.type, storedSize: o.size === undefined ? 1000 : o.size, bytes });

try {
  // ═══ 1. the judgement ═══
  ok('an honest photo: kept, at the size storage counted', JSON.stringify(judge('image/jpeg', JPEG)) === JSON.stringify({ kind: 'ok', size: 1000 }));
  ok('a PNG named .jpg (common, harmless): kept', judge('image/jpeg', PNG).kind === 'ok');
  ok('a web page claiming to be a photo: refused', judge('image/png', HTML).kind === 'refuse' && /kind of file its name says/.test(judge('image/png', HTML).message));
  ok('…or stored to be served as a drawing: refused, whatever its bytes', judge('image/png', PNG, { type: 'image/svg+xml' }).kind === 'refuse');
  ok('a type storage can\'t tell (octet-stream) is judged by the bytes alone', judge('image/png', PNG, { type: 'application/octet-stream' }).kind === 'ok');
  ok('larger than it said: refused', judge('image/jpeg', JPEG, { declared: 900, size: 2 * MB }).kind === 'refuse' && /larger than it said/.test(judge('image/jpeg', JPEG, { declared: 900, size: 2 * MB }).message));
  ok('over the most any door takes for its kind (25MB for a photo): refused, whatever it said', judge('image/jpeg', JPEG, { declared: 30 * MB, size: 30 * MB }).kind === 'refuse' && U.largestCap('image/jpeg') === 25 * MB && U.largestCap('video/mp4') === 100 * MB);
  ok('smaller than it said: kept, at its real size', JSON.stringify(judge('image/jpeg', JPEG, { declared: 5000, size: 4000 })) === JSON.stringify({ kind: 'ok', size: 4000 }));
  ok('a PDF that is one: kept; a photo named .pdf: refused', judge('application/pdf', PDF).kind === 'ok' && judge('application/pdf', JPEG).kind === 'refuse');
  ok('the portal\'s kinds: a zip is a zip', judge('application/zip', ZIP).kind === 'ok' && judge('video/mp4', ZIP).kind === 'refuse');
  ok('a drawing with a script in it: refused, in words that say so', /script/.test(judge('image/svg+xml', enc('<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>')).message || ''));
  ok('an empty file: refused; bytes that didn\'t come back from a file storage counted: not judged', judge('image/jpeg', new Uint8Array(0), { size: 0 }).kind === 'refuse' && judge('image/jpeg', null, { size: 50 }).kind === 'unknown');
  ok('a kind no door takes: refused', judge('text/html', HTML, { type: 'text/html' }).kind === 'refuse');

  // ═══ 2. the 15-minute run ═══
  const SITE = '39500000-0000-4000-8000-000000000001', CLIENT = '39500000-0000-4000-8000-0000000000c1';
  const id = (n) => `39500000-0000-4000-8000-00000000000${n}`;
  const row = (n, o) => ({ id: id(n), site_id: SITE, storage_path: `presence-media/${SITE}/${n}.jpg`, mime: 'image/jpeg', bytes: 1000, alt_text: `Photo ${n}`, created_at: '2026-11-21T17:40:00Z', deleted_at: null, checked_at: null, ...o });
  const store = new Map(), deleted = [];
  let storageDown = false;
  const pg = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url), method = (init.method || 'GET').toUpperCase();
    const m = /\/storage\/v1\/object\/(?:authenticated\/)?presence-media\/(.+)$/.exec(u);
    if (!m) return pg(url, init);
    if (storageDown) throw new Error('connection refused');
    const path = decodeURIComponent(m[1]);
    if (method === 'DELETE') { deleted.push(path); store.delete(path); return new Response('{}', { status: 200 }); }
    const o = store.get(path);
    if (!o) return new Response(method === 'HEAD' ? null : '{"statusCode":"404","error":"not_found"}', { status: 400 });
    const headers = { 'content-type': o.type, 'content-length': String(o.size) };
    return method === 'HEAD' ? new Response(null, { status: 200, headers }) : new Response(o.bytes, { status: 206, headers });
  };
  const seed = () => {
    db.reset({
      presence_sites: [{ id: SITE, client_id: CLIENT }], presence_plan_notices: [],
      presence_media: [
        row(1),                                                                 // honest
        row(2, { bytes: 1000 }),                                                // larger than it said
        row(3),                                                                 // not uploaded yet
        row(4, { checked_at: '2026-11-21T17:45:00Z' }),                         // already checked
        row(5, { created_at: '2026-11-18T10:00:00Z' }),                         // older than the 48 hours
        row(6, { deleted_at: '2026-11-21T17:50:00Z' }),                         // in the trash
        row(7, { mime: 'image/png', storage_path: `presence-media/${SITE}/7.png` }),   // a web page posing as a photo
      ],
    });
    store.clear(); deleted.length = 0;
    store.set(`${SITE}/1.jpg`, { type: 'image/jpeg', size: 987, bytes: JPEG });
    store.set(`${SITE}/2.jpg`, { type: 'image/jpeg', size: 4 * MB, bytes: JPEG });
    store.set(`${SITE}/7.png`, { type: 'image/png', size: 900, bytes: HTML });
    for (const n of [4, 5, 6]) store.set(`${SITE}/${n}.jpg`, { type: 'image/jpeg', size: 1000, bytes: JPEG });
  };
  seed();
  const res = await U.runUploadChecks();
  const media = (n) => db.tables.presence_media.find((x) => x.id === id(n));
  ok('the run reads only new, unchecked, kept uploads', res.read === 4, JSON.stringify(res));
  ok('an honest upload: marked checked, its size now the one storage counted', !!media(1).checked_at && media(1).bytes === 987 && !media(1).deleted_at);
  ok('larger than it said: out of Files, its bytes deleted', !!media(2).deleted_at && deleted.includes(`${SITE}/2.jpg`) && !!media(2).checked_at);
  ok('a web page posing as a photo: out too', !!media(7).deleted_at && deleted.includes(`${SITE}/7.png`));
  ok('not uploaded yet: left for the next run, untouched', !media(3).checked_at && !media(3).deleted_at);
  ok('the rest are never read', [4, 5, 6].every((n) => !deleted.includes(`${SITE}/${n}.jpg`)) && media(4).bytes === 1000);
  ok('the run counts what it did', res.checked === 1 && res.refused === 2 && res.waiting === 1, JSON.stringify(res));
  const notes = db.tables.presence_plan_notices.filter((x) => x.kind === 'upload_refused');
  ok('the site is told, once per file, in plain words', notes.length === 2 && notes.every((x) => x.client_id === CLIENT && x.site_id === SITE) && notes.some((x) => x.period === `media:${id(2)}` && /Photo 2/.test(x.headline) && /larger than it said/.test(x.body) && /upload it again/.test(x.body)), JSON.stringify(notes.map((x) => x.headline + ' | ' + x.body)));
  ok('…with no dashes in the words people see', notes.every((x) => !/—/.test(x.headline + x.body)));
  ok('a run that refused files never fails the scheduled run', sweepIssues({ upload_checks: res }).length === 0);
  const again = await U.runUploadChecks();
  ok('the next run reads only what is still waiting', again.read === 1 && again.waiting === 1, JSON.stringify(again));
  seed();
  storageDown = true;
  const down = await U.runUploadChecks();
  ok('storage not answering: nothing refused, nothing marked, all left for next time', down.refused === 0 && down.checked === 0 && down.waiting === 4 && !media(2).deleted_at, JSON.stringify(down));
  storageDown = false;
  db.failMethod.set('presence_media', 'GET');
  ok('a read that fails is a failed chore', sweepIssues({ upload_checks: await U.runUploadChecks() }).length === 1);
  db.failMethod.delete('presence_media');

  // ═══ 3. the buckets and the storage rules, as the migration writes them ═══
  const mig = Deno.readTextFileSync(new URL('supabase/migrations/0269_upload_checks_buckets.sql', ROOT));
  const bucket = (name) => (new RegExp(`\\('${name}', '${name}', (false|true), (\\d+), array\\[([^\\]]*)\\]`).exec(mig) || []);
  const media_ = bucket('presence-media'), files_ = bucket('client-files');
  const kindsOf = (m) => [...String(m[3] || '').matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
  ok('presence-media: private, room for the largest file a door takes, and every kind the doors take', media_[1] === 'false' && Number(media_[2]) === U.largestCap('video/mp4') && kindsOf(media_).join() === [...STUDIO_FILE_MIME].sort().join(), String(media_[3]).slice(0, 80));
  ok('client-files: private, 50MB, its 15 kinds, as production has it', files_[1] === 'false' && Number(files_[2]) === 50 * MB && kindsOf(files_).length === 15);
  ok('"Allow all on client-files" is dropped, and every other rule naming the bucket, by what it says', mig.includes('drop policy if exists "Allow all on client-files" on storage.objects;') && /like '%client-files%'[\s\S]{0,200}execute format\('drop policy %I on storage\.objects'/.test(mig));
  ok('…and nothing makes one again', !/create policy[^;]*client-files/i.test(mig));
} finally { restore(); }

const passed = results.filter(Boolean).length;
console.log(`\n════ UPLOAD CHECKS (builder item 395): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
