// ── Builder list item 147: files on forms, and each form's own table of answers ──
//   deno run --allow-read --allow-env --allow-net tests/presence/form_files_test.mjs
// Part A, pure: a file is what its first bytes say, names are cleaned, the limits agree
// in all three places, the field draws as a file box (and its form posts files), and the
// answers check count, size and kind. Part B drives the real routes on a fake database
// and a fake store: a photo is kept privately with the enquiry, a fake one is refused,
// spam keeps nothing, a store that fails sends nothing; the Inbox lists the files and
// opens one by a ten-minute link; a form's answers come back as its own table with what's
// new and seen against sent. Part C: the spreadsheet (form-answers.js), and the hooks in
// the editor and the Inbox.
import { installFakePostgrest } from './fake_pgrst.mjs';

const results = [];
const ok = (n, p, note = '') => { results.push(!!p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const SID = '5e000000-0000-4000-8000-000000000001';
const OTHER = '5e000000-0000-4000-8000-000000000002';
const db = installFakePostgrest();
const fake = globalThis.fetch;
const stored = [], emails = [];
let storeFails = false;
Deno.env.set('RESEND_KEY', 'test-resend-key');
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes('/rest/v1/rpc/rate_hit')) return new Response('true', { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (u.startsWith('https://api.resend.com/')) { emails.push(JSON.parse(String(init.body || '{}'))); return new Response('{"id":"e1"}', { status: 200, headers: { 'Content-Type': 'application/json' } }); }
  if (u.startsWith('https://db.test/storage/v1/object/sign/')) return new Response(JSON.stringify({ signedURL: `/object/sign/${u.split('/object/sign/')[1]}?token=t0k` }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (u.startsWith('https://db.test/storage/v1/object/presence-media/')) {
    if (storeFails) return new Response('{}', { status: 500 });
    stored.push({ path: u.split('/object/presence-media/')[1], type: new Headers(init.headers).get('Content-Type'), bytes: new Uint8Array(init.body) });
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return fake(url, init);
};

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const { sniffType, cleanFileName, FILE_LIMITS, filesOf, FILE_LINK_TTL } = await import('../../supabase/functions/presence/lib/form_files.ts');
const { FILE_FIELD, normalizeFormDefinition, renderForm, validateFormValues } = await import('../../supabase/functions/presence/lib/forms.ts');
const { FILE_MAX_MB } = await import('../../supabase/functions/presence/lib/site_send.ts');
const { esc, attr, safeHref } = await import('../../supabase/functions/presence/lib/markdown.ts');
const { handleFormSubmit, handleFormInbox, handleFormFile, handleFormAnswers, FORM_ANSWERS_MAX } = await import('../../supabase/functions/presence/routes/commercial.ts');
const { visitorCors } = await import('../../supabase/functions/_shared/cors.ts');

// ═══ A · the pieces ═══
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const PDF = new TextEncoder().encode('%PDF-1.7\n%âãÏÓ\n');
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]);
ok('kinds from the first bytes: JPEG, PNG, WebP, PDF', sniffType(JPEG) === 'image/jpeg' && sniffType(PNG) === 'image/png' && sniffType(WEBP) === 'image/webp' && sniffType(PDF) === 'application/pdf');
ok('…and nothing else, whatever its name says', sniffType(EXE) === null && sniffType(new TextEncoder().encode('<svg onload=alert(1)>')) === null && sniffType(new Uint8Array([])) === null);
ok('names: no folders, no control characters or quotes, 120 characters at most', cleanFileName('C:\\fakepath\\roof.jpg') === 'roof.jpg' && cleanFileName('../../etc/passwd') === 'passwd' && cleanFileName('a"b<c>\u0007.pdf') === 'abc.pdf' && cleanFileName('') === 'file' && cleanFileName('x'.repeat(300)).length === 120);
ok('the limits agree: the field, the store and the page', FILE_LIMITS.perField === FILE_FIELD.perField && FILE_LIMITS.bytes === FILE_FIELD.mb * 1024 * 1024 && FILE_FIELD.mb === FILE_MAX_MB && [...FILE_LIMITS.types].sort().join(',') === FILE_FIELD.accept.split(',').sort().join(',') && FILE_LIMITS.total === 20 * 1024 * 1024);
const RAW = { type: 'form', id: 'quote', title: 'Request a quote', kind: 'quote', fields: [
  { key: 'name', label: 'Your name', type: 'text', required: true },
  { key: 'email', label: 'Email', type: 'email', required: true },
  { key: 'photos', label: 'Photos of the problem', type: 'file', required: true, prefill: true },
  { key: 'details', label: 'Tell us more', type: 'textarea' }] };
const DEF = normalizeFormDefinition(RAW).form;
ok('a "Photo or file" field is a field, never filled in by a link', !!DEF && DEF.fields[2].type === 'file' && !DEF.fields[2].prefill);
{
  const html = renderForm(DEF, { esc, attr, safeHref, formEndpoint: 'https://db.test/f' });
  ok('it draws as a labelled file box for photos and PDFs, several at once', html.includes('<label for="f-quote-photos">Photos of the problem') && html.includes(`<input type="file" id="f-quote-photos" name="photos" accept="${FILE_FIELD.accept}" multiple required aria-required="true" aria-describedby="f-quote-photos-help">`));
  ok('…says what it takes', html.includes('Photos or PDFs: up to 3, 10 MB each.'));
  ok('…and its form posts files, scripts or not', html.includes('method="post" action="https://db.test/f" enctype="multipart/form-data" novalidate'));
  ok('a form without one posts as before', !renderForm(normalizeFormDefinition({ title: 'x', fields: [{ label: 'A', type: 'text' }] }).form, { esc, attr, safeHref }).includes('enctype'));
}
{
  const base = { name: 'Ana', email: 'ana@example.com' };
  const v = (files) => validateFormValues(DEF, base, files);
  ok('answers: a required file box left empty asks for it', v({}).ok === false && v({}).error === 'Please add Photos of the problem.' && v({}).field === 'photos');
  const four = Array.from({ length: 4 }, (_, i) => ({ name: `p${i}.jpg`, size: 100, type: 'image/jpeg' }));
  ok('…more than three files is too many', v({ photos: four }).error === 'Photos of the problem: up to 3 files, please.');
  ok('…a file over 10 MB is too big, by name', v({ photos: [{ name: 'C:\\fakepath\\huge.jpg', size: 11 * 1024 * 1024, type: 'image/jpeg' }] }).error === '“huge.jpg” is bigger than 10 MB. Try a smaller one.');
  ok('…a file that says it isn’t a photo or a PDF is refused', v({ photos: [{ name: 'setup.exe', size: 10, type: 'application/x-msdownload' }] }).error === '“setup.exe” isn’t a photo or a PDF.');
  const good = v({ photos: [{ name: 'roof.jpg', size: 1000, type: 'image/jpeg' }, { name: 'plan.pdf', size: 2000, type: 'application/pdf' }] });
  ok('…good ones: the answer is their names, and the message digest names them', good.ok && good.sub.values.photos === 'roof.jpg, plan.pdf' && good.sub.message.includes('Photos of the problem: roof.jpg, plan.pdf'));
}

// ═══ B · the routes ═══
const FN = 'https://db.test/functions/v1/presence';
const EP = `${FN}/forms/${SID}/submit`;
const seed = () => { db.reset({
  presence_sites: [{ id: SID, client_id: null, custom_domain: 'shop.example', netlify_site_id: 'nf-1' }],
  presence_settings: [{ site_id: SID, blocks: [RAW, { type: 'form', id: 'other', title: 'Other', kind: 'contact', fields: [{ key: 'email', label: 'Email', type: 'email', required: true }] }], pages: [] }],
  presence_identity: [{ site_id: SID, business_name: 'Example Shop', email: 'owner@shop.example' }],
}); stored.length = 0; emails.length = 0; storeFails = false; };
const post = (fields, files = []) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ form_id: 'quote', form_kind: 'quote', source_page: '/', _hp: '', ...fields })) fd.append(k, v);
  for (const [k, bytes, name, type] of files) fd.append(k, new File([bytes], name, { type }));
  return handleFormSubmit(new Request(EP, { method: 'POST', body: fd, headers: { accept: 'application/json' } }), SID, visitorCors());
};
const body = async (r) => { try { return await r.json(); } catch { return null; } };
const subs = () => db.tables.presence_form_submissions || [];
const GOOD = { name: 'Ana', email: 'ana@customer.example', details: 'The gutter is falling off.' };
{
  seed();
  const r = await post(GOOD, [['photos', JPEG, 'C:\\fakepath\\roof.jpg', 'image/jpeg'], ['photos', PDF, 'plan.pdf', 'application/pdf']]);
  const j = await body(r);
  const row = subs()[0];
  ok('a send with a photo and a PDF goes through', r.status === 200 && j?.data?.ok === true && subs().length === 1, JSON.stringify(j));
  ok('…both are kept in the private store under forms/<site>/, by their real kind', stored.length === 2 && stored.every((f) => f.path.startsWith(`forms/${SID}/`)) && stored[0].type === 'image/jpeg' && stored[1].type === 'application/pdf' && stored[0].bytes.length === JPEG.length);
  ok('…the enquiry knows them (name, kind, size, where) and its form', row.fields.__files?.length === 2 && row.fields.__files[0].name === 'roof.jpg' && row.fields.__files[0].path === stored[0].path && row.fields.photos === 'roof.jpg, plan.pdf' && row.fields.__form === 'quote');
  const end = Date.now() + 3000; while (!emails.length && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
  ok('…and the owner’s email says two files came with it, to open from the Inbox (never attached)', emails.length === 1 && emails[0].html.includes('2 files came with it. Open them from your Inbox.') && !emails[0].attachments);
}
{
  seed();
  const fakeJpeg = await body(await post(GOOD, [['photos', new TextEncoder().encode('#!/bin/sh\necho hi'), 'roof.jpg', 'image/jpeg']]));
  ok('a file that only says it’s a photo is refused, by name, and nothing is kept', fakeJpeg?.error === 'not_allowed' && fakeJpeg.message === '“roof.jpg” isn’t a photo or a PDF.' && fakeJpeg.field === 'photos' && stored.length === 0 && subs().length === 0);
  const robot = await body(await post({ ...GOOD, _hp: 'x' }, [['photos', JPEG, 'roof.jpg', 'image/jpeg']]));
  ok('a send judged spam keeps no files (the robot is still thanked)', robot?.data?.ok === true && stored.length === 0 && subs()[0]?.spam === true && !subs()[0].fields.__files);
  storeFails = true;
  const broke = await post({ ...GOOD, email: 'ben@customer.example' }, [['photos', JPEG, 'roof.jpg', 'image/jpeg']]);
  ok('the store refusing: “Your files didn’t send”, and no enquiry without its files', broke.status === 502 && (await body(broke))?.message === 'Your files didn’t send. Please try again in a minute.' && subs().length === 1);
  storeFails = false;
  const unasked = await body(await post({ form_id: 'other', form_kind: 'contact', email: 'cy@customer.example' }, [['photos', JPEG, 'roof.jpg', 'image/jpeg']]));
  ok('files sent to a form without a file box are ignored', unasked?.data?.ok === true && stored.length === 0 && !subs().at(-1).fields.__files);
}
{
  seed();
  await post(GOOD, [['photos', JPEG, 'roof.jpg', 'image/jpeg'], ['photos', PDF, 'plan.pdf', 'application/pdf']]);
  const id = subs()[0].id;
  const list = await body(await handleFormInbox({ id: SID }, {}));
  const lead = list.data.submissions[0];
  ok('the Inbox lists the files (name, kind, size), never where they are kept, and the form', JSON.stringify(lead.files) === JSON.stringify([{ n: 0, key: 'photos', name: 'roof.jpg', type: 'image/jpeg', size: JPEG.length }, { n: 1, key: 'photos', name: 'plan.pdf', type: 'application/pdf', size: PDF.length }]) && !JSON.stringify(lead).includes('forms/') && lead.form_id === 'quote');
  const one = await body(await handleFormFile({ id: SID }, id, 0, {}));
  ok('a file opens by a link that lasts ten minutes', one?.data?.url?.startsWith(`https://db.test/storage/v1/object/sign/presence-media/forms/${SID}/`) && one.data.name === 'roof.jpg' && FILE_LINK_TTL === 600);
  const pdf = await body(await handleFormFile({ id: SID }, id, 1, {}));
  ok('…a PDF downloads under its own name', pdf?.data?.url?.endsWith('&download=plan.pdf'));
  ok('…a number past the files, or another site’s enquiry: not there', (await handleFormFile({ id: SID }, id, 5, {})).status === 404 && (await handleFormFile({ id: OTHER }, id, 0, {})).status === 404);
}
{
  seed();
  const now = Date.now(), ago = (d) => new Date(now - d * 86400_000).toISOString();
  db.tables.presence_form_submissions = [
    { id: 'a1', site_id: SID, spam: false, status: 'new', created_at: ago(1), name: 'Ana', email: 'ana@x.example', phone: '', fields: { name: 'Ana', email: 'ana@x.example', photos: 'roof.jpg', details: '=HYPERLINK("http://evil.example")', __form: 'quote', __files: [{ key: 'photos', name: 'roof.jpg', type: 'image/jpeg', size: 9, path: `forms/${SID}/x.jpg` }] } },
    { id: 'a2', site_id: SID, spam: false, status: 'replied', created_at: ago(40), name: 'Ben', email: 'ben@x.example', phone: '', fields: { name: 'Ben', email: 'ben@x.example', details: 'Old one, "quoted", with, commas', __form: 'quote' } },
    { id: 'a3', site_id: SID, spam: true, status: 'new', created_at: ago(2), name: 'Bot', email: 'bot@x.example', phone: '', fields: { __form: 'quote' } },
    { id: 'a4', site_id: SID, spam: false, status: 'new', created_at: ago(2), name: 'Cy', email: 'cy@x.example', phone: '', fields: { email: 'cy@x.example', __form: 'other' } },
    { id: 'a5', site_id: OTHER, spam: false, status: 'new', created_at: ago(2), name: 'Di', email: 'di@x.example', phone: '', fields: { __form: 'quote' } },
  ];
  db.tables.presence_visits = [
    { site_id: SID, kind: 'pageview', path: '/', ts: ago(1), visitor_hash: 'h1' }, { site_id: SID, kind: 'pageview', path: '/', ts: ago(3), visitor_hash: 'h1' },
    { site_id: SID, kind: 'pageview', path: '/', ts: ago(5), visitor_hash: 'h2' }, { site_id: SID, kind: 'pageview', path: '/', ts: ago(6), visitor_hash: 'h3' },
    { site_id: SID, kind: 'pageview', path: '/', ts: ago(45), visitor_hash: 'h4' }, { site_id: SID, kind: 'pageview', path: '/about/', ts: ago(1), visitor_hash: 'h5' },
    { site_id: SID, kind: 'phone', path: '/', ts: ago(1), visitor_hash: 'h6' }, { site_id: OTHER, kind: 'pageview', path: '/', ts: ago(1), visitor_hash: 'h7' },
  ];
  const ask = (q) => handleFormAnswers(new Request(`${FN}/forms/answers${q}`), { id: SID }, {});
  const r = await body(await ask('?form=quote'));
  const d = r?.data;
  ok('a form’s answers: its own, newest first, no spam, no other form’s or site’s', d && d.rows.map((x) => x.id).join(',') === 'a1,a2', JSON.stringify(d?.rows?.map((x) => x.id)));
  ok('…its questions as the columns, each answer’s values under them', JSON.stringify(d.form.fields.map((f) => f.key)) === '["name","email","photos","details"]' && d.rows[0].values.photos === 'roof.jpg' && d.rows[1].values.photos === '' && d.rows[0].files[0].name === 'roof.jpg' && !JSON.stringify(d.rows).includes('forms/'));
  ok('…how many are new', d.new === 1);
  ok('…and over 30 days: visitors who saw its page against who sent it', d.last30.seen === 3 && d.last30.sent === 1, JSON.stringify(d.last30));
  ok('a form that isn’t there, or no form named', (await ask('?form=gone')).status === 404 && (await ask('')).status === 400 && (await ask('?form=../x')).status === 400);
  ok('the table stops at its newest 500, and says so', FORM_ANSWERS_MAX === 500 && d.more === false);
}

// ═══ C · the spreadsheet, the editor, the Inbox ═══
{
  const win = {};
  new Function('window', 'document', read('form-answers.js'))(win, {});
  const { csv, fileName, seenLine } = win.DDSFormAnswers;
  const data = { form: { title: 'Request a quote', fields: [{ key: 'name', label: 'Your name' }, { key: 'details', label: 'Tell us more' }] }, rows: [
    { created_at: '2026-11-09T15:04:00Z', status: 'new', values: { name: 'Ana', details: '=HYPERLINK("http://evil.example")' } },
    { created_at: '2026-11-01T09:00:00Z', status: 'replied', values: { name: 'Ben', details: 'Old one, "quoted", with, commas' } }] };
  const text = csv(data);
  const lines = text.slice(1).trim().split('\r\n');
  ok('spreadsheet: marked as UTF-8, one header row of the questions', text.startsWith('\ufeff') && lines[0] === 'Sent,Your name,Tell us more,Status' && lines.length === 3);
  ok('…an answer that looks like a formula is only words', lines[1].includes(`"'=HYPERLINK(""http://evil.example"")"`) && lines[1].endsWith(',New'));
  ok('…commas and quotes stay inside their cell', lines[2].includes('"Old one, ""quoted"", with, commas"') && lines[2].endsWith(',Replied'));
  ok('…named for the form and the day', /^request-a-quote-answers-\d{4}-\d{2}-\d{2}\.csv$/.test(fileName('Request a quote')));
  ok('seen and sent, in words', seenLine({ seen: 214, sent: 9 }) === 'In the last 30 days about 214 visitors saw it and 9 sent it (4.2%).' && /couldn’t be counted/.test(seenLine({ seen: null, sent: 2 })) && /No visits to its page were counted/.test(seenLine({ seen: 0, sent: 0 })));
  const ed = read('presence.html');
  ok('editor: “Photo or file” is a field type, and each form has Answers', ed.includes('["file", "Photo or file"]') && ed.includes('const ans = el("button", "ff-btn", "Answers");') && ed.includes('s.src = "/form-answers.js?v=1"') && ed.includes('get: (route) => api("GET", route)'));
  const ib = read('inbox.html');
  ok('Inbox: an enquiry’s files, each opened by its own ten-minute link', ib.includes('${leadFilesHtml(l)}') && ib.includes("api('/forms/inbox/'+encodeURIComponent(it.lead_id)+'/files/'+encodeURIComponent(b.getAttribute('data-lfile')))") && ib.includes('Sent with it:'));
  const idx = read('supabase/functions/presence/index.ts');
  ok('the two reads sit beside the Inbox’s own, behind the same sign-in', idx.indexOf("route === '/forms/answers' && method === 'GET'") > idx.indexOf("route === '/forms/inbox' && method === 'GET'") && /\\\/files\\\/\(\\d\{1,2\}\)\$\//.test(idx));
}

const passed = results.filter(Boolean).length;
console.log(`\n════ FORM FILES + ANSWERS (item 147): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
