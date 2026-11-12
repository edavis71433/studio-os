// ── Builder list item 159 (Nov 2026): notes take a picture, filter by open or done,
//    and feedback on a shared draft carries a name ──
//   deno run --allow-read --allow-env --allow-net tests/presence/comments_159_test.mjs
// Runs the real routes against a stubbed database and storage: a client's note keeps
// the name they typed and one picture (checked by its first bytes, kept privately),
// the studio's list shows the name and a short-lived link (never the stored path), and
// on a database without migration 0183 notes still save and read, without either.
for (const [k, v] of Object.entries({ SUPABASE_URL: 'http://stub.local', SERVICE_ROLE_KEY: 'SERVICE-KEY', SUPABASE_ANON_KEY: 'ANON-KEY', PREVIEW_LINK_SECRET: 'test-secret-159' })) Deno.env.set(k, v);
const SC = await import('../../supabase/functions/presence/lib/section_comments.ts');
const C = await import('../../supabase/functions/presence/routes/comments.ts');
const { signPreviewToken } = await import('../../supabase/functions/presence/lib/preview_link.ts');

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${p || !note ? '' : ' — ' + note}`); };
const read = (p) => Deno.readTextFileSync(new URL('../../' + p, import.meta.url));
const SITE = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const cors = {};
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];

// ── the pure parts ──
ok('a name keeps its words, loses control characters and long runs of spaces', SC.cleanAuthorName('  Sam\u0007   at the  bakery ') === 'Sam at the bakery');
ok('a name stops at 60 characters', SC.cleanAuthorName('x'.repeat(90)).length === 60 && SC.AUTHOR_NAME_MAX === 60);
ok('no name is fine', SC.cleanAuthorName(undefined) === '' && SC.cleanAuthorName(null) === '');
ok('no picture is fine', SC.decodeCommentImage(undefined) === null && SC.decodeCommentImage('') === null);
ok('a JPEG is read by its first bytes', (() => { const r = SC.decodeCommentImage('data:image/jpeg;base64,' + b64(JPEG)); return r.ok && r.type === 'image/jpeg' && r.bytes.length === JPEG.length; })());
ok('a PNG sent as a JPEG is still a PNG (its bytes decide)', (() => { const r = SC.decodeCommentImage('data:image/jpeg;base64,' + b64(PNG)); return r.ok && r.type === 'image/png'; })());
ok('a file pretending to be a picture is refused', SC.decodeCommentImage('data:image/png;base64,' + b64([1, 2, 3, 4, 5, 6, 7, 8, 9])).error === 'not_image');
ok('something that isn’t a picture address is refused', SC.decodeCommentImage('https://example.com/x.png').error === 'not_image' && SC.decodeCommentImage('data:text/html;base64,PGI+').error === 'not_image');
ok('a picture over 3 MB is refused before it is decoded', SC.decodeCommentImage('data:image/jpeg;base64,' + 'A'.repeat(4_300_000)).error === 'too_large');
ok('only sane sizes are kept', JSON.stringify(SC.pictureSize(1600, 900)) === '{"w":1600,"h":900}' && SC.pictureSize(0, 9) === null && SC.pictureSize('x', 9) === null && SC.pictureSize(20000, 9) === null);

// ── the client's panel: a name remembered for the visit, a picture a note, a script that parses ──
{
  const html = SC.injectFeedbackPanel('<html><body><p>Draft</p></body></html>', { pfx: 'https://fn.example/p/s/tok', page: '/' });
  ok('the panel asks for a name, optional, with a label', /<label class="pfb-who" for="pfb-name">Your name/.test(html) && /<input id="pfb-name" type="text" maxlength="60"/.test(html));
  ok('the name is remembered for this visit only (sessionStorage)', /sessionStorage\.getItem\(NKEY\)/.test(html) && !/localStorage/.test(html));
  ok('each note can take a screenshot or a photo', /Add a screenshot or photo/.test(html) && /pi\.type='file';pi\.accept='image\/\*'/.test(html));
  ok('a note sends the name and the picture with it', /if\(who\)msg\.name=who;if\(pic\)\{msg\.image=pic\.data;msg\.w=pic\.w;msg\.h=pic\.h;\}/.test(html));
  const script = (html.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';
  let parses = true; try { new Function(script); } catch (e) { parses = String(e); }
  ok('the panel’s script still parses (the escapes inside the template are right)', parses === true, String(parses));
  ok('the picture check in the panel is a real pattern', /\/\^image\\\/\(jpeg\|png\|webp\|gif\)\$\/\.test\(file\.type\)/.test(script));
}

// ── the routes, against a stubbed database and storage ──
let has0183 = true, rows = [], puts = [], storeOk = true, inserts = [];
const reply = (body, status = 200) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const method = (init.method || 'GET').toUpperCase();
  if (u.pathname.startsWith('/storage/v1/object/sign/')) return reply({ signedURL: '/object/sign/presence-media/' + u.pathname.split('/presence-media/')[1] + '?token=t' });
  if (u.pathname.startsWith('/storage/v1/object/')) { puts.push({ path: u.pathname.replace('/storage/v1/object/presence-media/', ''), type: init.headers['Content-Type'] }); return reply(storeOk ? { Key: 'x' } : { error: 'no' }, storeOk ? 200 : 500); }
  const table = u.pathname.replace('/rest/v1/', '');
  if (method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-range': '*/0' } });
  if (table === 'rpc/rate_hit') return reply(true);
  if (table === 'presence_site_preview') return reply([{ snapshot_id: 'snap-1' }]);
  if (table === 'presence_change_events') return reply([]);
  if (table === 'presence_section_comments') {
    const sel = u.searchParams.get('select') || '';
    if (method === 'GET') return (!has0183 && /author_name|attachment/.test(sel)) ? reply({ code: '42703', message: 'column does not exist' }, 400) : reply(rows);
    if (method === 'POST') {
      const b = JSON.parse(init.body);
      if (!has0183 && ('author_name' in b || 'attachment' in b)) return reply({ code: 'PGRST204', message: 'column not found' }, 400);
      inserts.push(b);
      return reply([{ id: 'n' + inserts.length, ...b, created_at: '2026-11-12T10:00:00Z' }], 201);
    }
  }
  return reply([]);
};
const token = await signPreviewToken({ site_id: SITE, exp: Math.floor(Date.now() / 1000) + 3600, scope: 'preview' }, 'test-secret-159');
const post = (body) => C.handleTokenComment(new Request('https://fn.example/p/s/' + token + '/comments', { method: 'POST', body: JSON.stringify(body), headers: { 'x-forwarded-for': '203.0.113.9' } }), token, cors);

{
  const r = await post({ page: '/', block_id: '', body: 'The phone number is wrong', name: '  Dana  ', image: 'data:image/jpeg;base64,' + b64(JPEG), w: 1280, h: 720 });
  ok('a client’s note with a name and a picture is taken', r.status === 200, String(r.status));
  const row = inserts.at(-1);
  ok('the name is kept as they typed it, and nothing else about them', row.author_name === 'Dana' && row.author_key === null && row.author_kind === 'client');
  ok('the picture is kept privately under comments/<site>/, as what its bytes say', puts.length === 1 && puts[0].path.startsWith(`comments/${SITE}/`) && puts[0].path.endsWith('.jpg') && puts[0].type === 'image/jpeg');
  ok('the note remembers the picture’s place, kind, size and shape', row.attachment && row.attachment.path === puts[0].path && row.attachment.type === 'image/jpeg' && row.attachment.size === JPEG.length && row.attachment.w === 1280 && row.attachment.h === 720);
  const bad = await post({ page: '/', body: 'x', image: 'data:image/png;base64,' + b64([1, 2, 3, 4, 5, 6, 7, 8]) });
  ok('a picture that isn’t one is refused, plainly, and nothing is saved', bad.status === 422 && (await bad.json()).message.includes('couldn’t be read') && inserts.length === 1);
  storeOk = false;
  const down = await post({ page: '/', body: 'x', image: 'data:image/jpeg;base64,' + b64(JPEG) });
  ok('a picture that won’t upload says so, and the note isn’t half-saved', down.status === 502 && inserts.length === 1);
  storeOk = true;
  const plain = await post({ page: '/', body: 'Just words' });
  ok('a note with no name and no picture is taken as before', plain.status === 200 && !('author_name' in inserts.at(-1)) && !('attachment' in inserts.at(-1)));
}
{
  // the studio's list: the name, and the picture as a short-lived link, never the path
  rows = [
    { id: 'c1', page_slug: '', block_id: null, author_kind: 'client', body: 'Phone number', status: 'open', created_at: '2026-11-12T10:00:00Z', author_name: 'Dana', attachment: { path: `comments/${SITE}/p1.jpg`, type: 'image/jpeg', w: 1280, h: 720 } },
    { id: 'c2', page_slug: '', block_id: null, author_kind: 'client', body: 'Not ours', status: 'resolved', created_at: '2026-11-11T10:00:00Z', author_name: null, attachment: { path: 'comments/someone-else/x.jpg', type: 'image/jpeg' } },
  ];
  const r = await C.handleCommentsList(new Request('https://fn.example/comments'), { id: SITE }, cors);
  const d = (await r.json()).data;
  const all = d.threads.flatMap((t) => t.comments);
  const c1 = all.find((c) => c.id === 'c1'), c2 = all.find((c) => c.id === 'c2');
  ok('the studio sees the name with the note', c1.author_name === 'Dana');
  ok('the picture comes as a link that lasts a while, with its shape, and never its stored path', /^http:\/\/stub\.local\/storage\/v1\/object\/sign\/presence-media\/comments\//.test(c1.picture.url) && c1.picture.w === 1280 && !('attachment' in c1) && !JSON.stringify(d).includes('"path"'));
  ok('a picture outside this site’s folder is never linked', c2.picture === null);
}
{
  // a database without 0183: notes still save and read, without a name or a picture
  has0183 = false; inserts = []; rows = [{ id: 'c3', page_slug: '', block_id: null, author_kind: 'client', body: 'Old note', status: 'open', created_at: '2026-11-10T10:00:00Z' }];
  const r = await post({ page: '/', body: 'Saved anyway', name: 'Dana' });
  ok('before 0183 a named note still saves, without the name', r.status === 200 && inserts.length === 1 && !('author_name' in inserts[0]) && inserts[0].body === 'Saved anyway');
  const l = await C.handleCommentsList(new Request('https://fn.example/comments'), { id: SITE }, cors);
  const d = (await l.json()).data;
  ok('before 0183 the list still reads, with no name or picture', d.threads.length === 1 && d.threads[0].comments[0].author_name === null && d.threads[0].comments[0].picture === null);
  has0183 = true;
}

// ── the editor and the database step ──
{
  const page = read('presence.html');
  ok('a thread can show Open, Done or All, Open first while any note is open', /\["open", "Open \(" \+ t\.open_count \+ "\)"\], \["done", "Done \(" \+ done \+ "\)"\], \["all", "All"\]/.test(page) && /const show = CM_FILTER \|\| \(t\.open_count \? "open" : "all"\);/.test(page));
  ok('a client’s name shows beside “Client”', /c\.author_kind === "client" && c\.author_name\) who\.appendChild\(el\("span", "cm-name", c\.author_name\)\)/.test(page));
  ok('a note’s picture shows and opens full size', /const a = el\("a", "cm-pic"\); a\.href = c\.picture\.url; a\.target = "_blank"; a\.rel = "noopener";/.test(page));
  ok('the studio can add a picture to its own note too', /if \(pic\) Object\.assign\(msg, \{ image: pic\.data, w: pic\.w, h: pic\.h \}\);/.test(page));
  const mig = read('supabase/migrations/0183_comment_name_picture.sql'), pack = read('docs/presence/APPLY-0183-prod.sql');
  ok('migration 0183 adds the two columns, the name at most 60 characters', /add column if not exists author_name text/.test(mig) && /add column if not exists attachment jsonb/.test(mig) && /char_length\(author_name\) <= 60/.test(mig));
  ok('the apply pack does the same, is safe to run twice, and ends with a check', /add column if not exists author_name text/.test(pack) && /drop constraint if exists presence_section_comments_author_name_len/.test(pack) && /select column_name, data_type/.test(pack));
}

const passed = results.filter((x) => x.p).length;
console.log(`\n════ NOTES: PICTURE, OPEN OR DONE, A NAME (item 159): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
