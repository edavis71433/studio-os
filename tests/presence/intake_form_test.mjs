// ── The content form (builder list item 176) ─────────────────────────────────
// Wix Studio's client intake form: the studio picks questions for the kind of
// business and sends a link; the client answers and adds photos with no sign-in.
// This suite proves the rules (lib/intake_form.ts) and drives the real routes —
// the studio's (agency/client_tools.ts) and the link's (routes/intake_public.ts)
// — against an in-memory PostgREST and a stand-in for file storage:
//   · the questions: the kind's bank, ticks, the studio's own, the limits;
//   · the link: only the right secret opens it, a stopped link shows nothing;
//   · the words save as they type, only for the form's own word questions;
//   · a photo is checked (its bytes must be what it says), lands in the site's
//     Files under "From the content form", and can be taken back off;
//   · Send marks it sent once, emails the studio at most every fifteen minutes,
//     and the studio reading the answers marks them read;
//   · a view-only seat can look but not change, and never another studio's site.
//   deno run --allow-read --allow-env tests/presence/intake_form_test.mjs
Deno.env.set('SUPABASE_URL', 'http://stub.local');
Deno.env.set('SERVICE_ROLE_KEY', 'service-key');
Deno.env.set('APP_URL', 'https://app.example');
Deno.env.set('RESEND_KEY', 're_test');
const I = await import('../../supabase/functions/presence/lib/intake_form.ts');
const { handleClientTools } = await import('../../supabase/functions/presence/agency/client_tools.ts');
const { handleIntakePublic } = await import('../../supabase/functions/presence/routes/intake_public.ts');
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

// ═══ 1. the rules (pure) ═══
{
  const shop = I.questionBank('shop');
  ok('bank: a kind adds its own questions after "What you offer"', shop[0].id === 'about' && shop[1].id === 'offer' && shop[2].id === 'sellers' && shop[3].id === 'delivery');
  ok('bank: an unknown kind is "something else" (no extras), and "Websites you like" starts unticked', I.questionBank('nope').length === 11 && I.questionBank('other').find((q) => q.id === 'likes').on === false && I.questionBank('other').filter((q) => q.on).length === 10);
  ok('bank: photos are files questions', ['logo', 'people', 'work'].every((id) => shop.find((q) => q.id === id).kind === 'files') && I.questionBank('food').find((q) => q.id === 'menu').kind === 'files');
  const b = I.buildQuestions({ kind: 'trades', picks: ['about', 'area', 'logo', 'not-a-question'], own: [{ label: '  Which   towns? ', kind: 'words' }, { label: 'x' }, { label: 'Your van', kind: 'files' }] });
  ok('build: ticked bank questions in bank order, then the studio’s own (a too-short one dropped)', b.ok && b.questions.map((q) => q.id).join() === 'about,area,logo,own1,own3' && b.questions[3].label === 'Which towns?' && b.questions[4].kind === 'files' && b.questions[3].own === true);
  ok('build: no picks given = the bank’s defaults', I.buildQuestions({ kind: 'food' }).questions.length === I.questionBank('food').filter((q) => q.on).length);
  ok('build: nothing ticked is refused', !I.buildQuestions({ kind: 'shop', picks: [] }).ok);
  ok('build: more than five of your own is refused', !I.buildQuestions({ kind: 'shop', own: Array.from({ length: 6 }, (_, n) => ({ label: 'Question ' + n })) }).ok);
  const secret = I.newSecret();
  const SITE = '0f0e0d0c-0b0a-4908-8706-050403020100';
  const tok = I.linkToken(SITE, secret);
  ok('link: 72 hex characters that carry the site and the secret', /^[0-9a-f]{72}$/.test(tok) && I.parseToken(tok).siteId === SITE && I.parseToken(tok).secret === secret);
  ok('link: anything else is not a link', [null, '', 'zz' + tok.slice(2), tok.slice(1), tok + '0'].every((t) => I.parseToken(t) === null));
  ok('link: secrets compare exactly', I.sameSecret(secret, secret) && !I.sameSecret(secret, secret.slice(0, 39) + (secret[39] === 'a' ? 'b' : 'a')) && !I.sameSecret(secret, secret + 'a'));
  const qs = b.questions;
  const c = I.cleanTextAnswers(qs, { about: '  We fix roofs. \r\n Since 2001  ', area: 'x'.repeat(5000) });
  ok('words: trimmed, line ends kept as \\n, cut at the limit', c.ok && c.changes.about === 'We fix roofs. \n Since 2001' && c.changes.area.length === I.TEXT_MAX);
  ok('words: a photo question, or one not on the form, is refused', !I.cleanTextAnswers(qs, { logo: 'hi' }).ok && !I.cleanTextAnswers(qs, { hours: 'hi' }).ok && !I.cleanTextAnswers(qs, { about: 4 }).ok);
  const ans = I.withText({ logo: { files: [{ id: SITE, name: 'a', mime: 'image/png', at: '' }], at: '' } }, { about: 'Roofs', area: '' }, '2026-11-11T10:00:00Z');
  const p = I.progressOf(qs, ans);
  ok('progress: an answer is words or at least one file; an emptied one doesn’t count', p.answered === 2 && p.total === 5 && p.files === 1);
  ok('a damaged stored form reads as none', I.normalizeForm({ questions: [] }) === null && I.normalizeForm({ questions: qs, secret: 'short' }) === null && I.normalizeForm(null) === null);
  ok('file names: path bits removed, a default when empty', I.fileName('../../etc/pass<wd>.png', 'image/png') === '....etcpasswd.png' && I.fileName('', 'application/pdf') === 'A document');
}

// ═══ 2. the routes against a stand-in database ═══
const AG = 'aaaaaaaa-0000-4000-8000-000000000001', OTHER_AG = 'aaaaaaaa-0000-4000-8000-000000000002';
const SITE = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', THEIRS = 'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2', STUDIO = 'e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3';
const CLIENT = 'f4f4f4f4-f4f4-4f4f-8f4f-f4f4f4f4f4f4';
let T, storage, mail, idn, clock;
function reset() {
  T = {
    presence_agency_clients: [{ agency_id: AG, site_id: SITE, status: 'active' }, { agency_id: OTHER_AG, site_id: THEIRS, status: 'active' }],
    presence_sites: [{ id: SITE, client_id: CLIENT, status: 'draft', last_published_at: null, template_slug: 't', template_version: '1', custom_domain: null, netlify_site_id: null, edition: 'presence' }],
    presence_identity: [{ site_id: SITE, business_name: 'Juniper Floral Co.' }],
    clients: [{ id: CLIENT, name: 'Jun Park', email: 'jun@juniper.example' }],
    presence_sales_templates: [], presence_media: [],
  };
  storage = new Map(); mail = []; idn = 0; clock = 0;
}
const CTRL = ['select', 'limit', 'order', 'on_conflict'];
function match(r, k, v) {
  const val = r[k] == null ? null : String(r[k]);
  if (v === 'is.null') return r[k] == null;
  if (v === 'not.is.null') return r[k] != null;
  if (v.startsWith('eq.')) return val === decodeURIComponent(v.slice(3));
  if (v.startsWith('neq.')) return val !== decodeURIComponent(v.slice(4));
  if (v.startsWith('in.(')) return v.slice(4, -1).split(',').map(decodeURIComponent).includes(val);
  if (v.startsWith('gte.')) return val != null && val >= decodeURIComponent(v.slice(4));
  if (v.startsWith('lte.')) return val != null && val <= decodeURIComponent(v.slice(4));
  if (v.startsWith('lt.')) return val != null && val < decodeURIComponent(v.slice(3));
  if (v.startsWith('gt.')) return val != null && val > decodeURIComponent(v.slice(3));
  return true;
}
const hits = (table, params) => (T[table] || []).filter((r) => [...params.entries()].every(([k, v]) => CTRL.includes(k) || match(r, k, v)));
function pick(rows, params) {
  const sel = params.get('select');
  let out = rows;
  if (params.get('order')?.startsWith('updated_at.desc')) out = [...out].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  if (sel && sel !== '*') out = out.map((r) => Object.fromEntries(sel.split(',').map((c) => [c, r[c]])));
  const lim = Number(params.get('limit'));
  return lim ? out.slice(0, lim) : out;
}
const tick = () => new Date(Date.UTC(2026, 10, 11, 10, 0, clock++)).toISOString();
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url), 'http://stub.local');
  const method = (init.method || 'GET').toUpperCase();
  const reply = (b, status = 200) => new Response(b === null ? null : JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  if (u.hostname === 'api.resend.com') { mail.push(JSON.parse(init.body)); return reply({ id: 'mail' }); }
  if (u.pathname.startsWith('/storage/v1/object/upload/sign/')) { const path = u.pathname.replace('/storage/v1/object/upload/sign/', ''); if (method === 'PUT') { storage.set(path, init.body); return reply({}); } return reply({ url: `/object/upload/sign/${path}?token=t` }); }
  if (u.pathname.startsWith('/storage/v1/object/sign/')) return reply({ signedURL: u.pathname.replace('/storage/v1', '') + '?token=s' });
  if (u.pathname.startsWith('/storage/v1/object/')) { if (method === 'DELETE') storage.delete(u.pathname.replace('/storage/v1/object/', '')); return reply({}); }
  const table = u.pathname.replace(/^.*\/rest\/v1\//, '');
  if (table === 'rpc/rate_hit') return reply(true);
  if (method === 'GET') return reply(pick(hits(table, u.searchParams), u.searchParams));
  const body = init.body ? JSON.parse(init.body) : null;
  if (method === 'POST') {
    const row = { id: crypto.randomUUID(), created_at: tick(), updated_at: tick(), deleted_at: null, ...body };
    if (table === 'presence_sales_templates' && T[table].some((r) => r.site_id === row.site_id && r.name === row.name && !r.deleted_at)) return reply({ code: '23505' }, 409);
    (T[table] = T[table] || []).push(row); return reply([row], 201);
  }
  if (method === 'PATCH') { const h = hits(table, u.searchParams); h.forEach((r) => Object.assign(r, body, table === 'presence_sales_templates' ? { updated_at: tick() } : {})); return reply(h.map((r) => ({ id: r.id }))); }
  if (method === 'DELETE') { const h = hits(table, u.searchParams); T[table] = T[table].filter((r) => !h.includes(r)); return reply(h); }
  return reply([]);
};
const reserved = (name) => { const r = T.presence_sales_templates.find((x) => x.site_id === SITE && x.name === name && !x.deleted_at); return r ? JSON.parse(r.body) : null; };
const member = (over = {}) => ({ agency_id: AG, member_id: 'm1', email: 'sam@studio.example', role: 'owner', agency_name: 'Bright Studio', seat_limit: 5, client_limit: 25, plan: 'agency', branding: {}, ...over });
const deps = { ownSite: async () => ({ id: STUDIO }), needs: async () => ({ rows: [] }), gather: async () => ({ links: [], clientNames: {} }) };
async function studio(method, route, body, m = member()) {
  const req = new Request('http://stub.local/functions/v1/presence' + route, { method, body: body ? JSON.stringify(body) : undefined, headers: { 'Content-Type': 'application/json' } });
  const res = await handleClientTools(req, route, method, m, { kind: 'client', userId: 'u1', email: m.email }, {}, deps);
  return res ? { status: res.status, body: await res.json() } : null;
}
async function pub(method, token, rest = '', body, headers = {}, query = '') {
  const req = new Request(`http://stub.local/functions/v1/presence/intake/${token}${rest}${query}`, { method, body, headers: { 'x-forwarded-for': '203.0.113.9', ...headers } });
  const res = await handleIntakePublic(req, token, rest, method, {});
  return { status: res.status, body: await res.json().catch(() => null) };
}
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);

reset();
// ── the studio makes the form ──
{
  const g = await studio('GET', `/agency/sites/${SITE}/intake`);
  ok('studio: no form yet — the questions to pick from, the owner’s address to send to', g.status === 200 && g.body.data.form === null && g.body.data.owner_email === 'jun@juniper.example' && g.body.data.kinds.length === 7 && g.body.data.bank.shop.length === 13 && g.body.data.business_name === 'Juniper Floral Co.');
  ok('studio: a view-only seat can’t make one', (await studio('PUT', `/agency/sites/${SITE}/intake`, { kind: 'shop' }, member({ role: 'readonly' }))).status === 403);
  ok('studio: another studio’s site is not found', (await studio('GET', `/agency/sites/${THEIRS}/intake`)).status === 404 && (await studio('PUT', `/agency/sites/${THEIRS}/intake`, { kind: 'shop' })).status === 404);
  ok('studio: nothing ticked is a plain refusal', (await studio('PUT', `/agency/sites/${SITE}/intake`, { kind: 'shop', picks: [] })).status === 400);
  const made = await studio('PUT', `/agency/sites/${SITE}/intake`, { kind: 'shop', picks: ['about', 'offer', 'hours', 'people'], own: [{ label: 'Which flowers never?', kind: 'words' }] });
  const f = made.body.data.form;
  ok('studio: Make the link — a link on the app host, the questions in order, open, nothing answered', made.status === 200 && /^https:\/\/app\.example\/intake\?t=[0-9a-f]{72}$/.test(f.link) && f.questions.map((q) => q.id).join() === 'about,offer,hours,people,own1' && f.status === 'open' && f.answered === 0 && f.total === 5);
  ok('studio: the secret itself is never sent, only the link', !('secret' in f) && f.studio_site_id === STUDIO);
  globalThis.TOKEN = f.link.split('t=')[1];
}
const TOKEN = globalThis.TOKEN;
// ── the link ──
{
  ok('link: a wrong secret is "not live", and so is nonsense', (await pub('GET', TOKEN.slice(0, 40) + '0'.repeat(32))).status === 404 && (await pub('GET', 'abc')).status === 404);
  const g = await pub('GET', TOKEN);
  ok('link: opens — the business, the questions (no hints of other forms), nothing answered', g.status === 200 && g.body.data.status === 'open' && g.body.data.business_name === 'Juniper Floral Co.' && g.body.data.questions.length === 5 && g.body.data.answered === 0 && JSON.stringify(g.body.data.answers) === '{}');
  ok('link: the first open is noted for the studio', !!reserved('__intake_form__').opened_at);
  const s1 = await pub('POST', TOKEN, '', JSON.stringify({ answers: { about: 'Family florist since 2009.', hours: 'Tue–Sat 9 to 6' } }), { 'Content-Type': 'text/plain;charset=UTF-8' });
  ok('words: saved (sent as plain text, read as JSON), progress counted', s1.status === 200 && s1.body.data.answered === 2 && s1.body.data.total === 5 && reserved('__intake_answers__').answers.about.text === 'Family florist since 2009.');
  ok('words: a photo question can’t take words', (await pub('POST', TOKEN, '', JSON.stringify({ answers: { people: 'hi' } }))).status === 400);
  const s2 = await pub('POST', TOKEN, '', JSON.stringify({ answers: { hours: '' } }));
  ok('words: emptying an answer takes it off the count', s2.body.data.answered === 1);
  // a photo
  const bad = await pub('POST', TOKEN, '/files', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), { 'Content-Type': 'image/png' }, '?q=people&name=shop.png');
  ok('photo: bytes that aren’t the image they claim are refused', bad.status === 422 && T.presence_media.length === 0);
  ok('photo: a type the form doesn’t take is refused', (await pub('POST', TOKEN, '/files', PNG, { 'Content-Type': 'image/gif' }, '?q=people&name=a.gif')).status === 415);
  ok('photo: only a photo question takes files', (await pub('POST', TOKEN, '/files', PNG, { 'Content-Type': 'image/png' }, '?q=about&name=a.png')).status === 400);
  ok('photo: too big for a photo is refused before it’s read', (await pub('POST', TOKEN, '/files', PNG, { 'Content-Type': 'image/png', 'content-length': String(11 * 1024 * 1024) }, '?q=people&name=a.png')).status === 413);
  const up = await pub('POST', TOKEN, '/files', PNG, { 'Content-Type': 'image/png' }, '?q=people&name=../front%20door.png');
  const m = T.presence_media[0];
  ok('photo: lands in this site’s Files, under "From the content form", named for its question', up.status === 200 && m && m.site_id === SITE && m.collection === 'From the content form' && m.alt_text === 'You, your team and your place — ..front door.png' && storage.size === 1);
  ok('photo: on the form, with a small picture, and counted', up.body.data.file.id === m.id && up.body.data.file.thumb_url && up.body.data.answered === 2 && up.body.data.files === 1 && reserved('__intake_answers__').answers.people.files.length === 1);
  const gone = await pub('DELETE', TOKEN, `/files/${m.id}`);
  ok('photo: taken back off the form and out of Files', gone.status === 200 && gone.body.data.files === 0 && !reserved('__intake_answers__').answers.people.files?.length && T.presence_media[0].deleted_at);
  ok('photo: one that isn’t on the form can’t be taken off', (await pub('DELETE', TOKEN, `/files/${CLIENT}`)).status === 404);
  await pub('POST', TOKEN, '/files', PNG, { 'Content-Type': 'image/png' }, '?q=people&name=team.png');
  // Send
  const sent = await pub('POST', TOKEN, '', JSON.stringify({ answers: { offer: 'Weddings\nBouquets' }, send: true }));
  const to0 = (m) => [].concat(m?.to || [])[0];
  ok('send: marks it sent and emails the studio member who made it, once', sent.status === 200 && !!sent.body.data.sent_at && mail.length === 1 && to0(mail[0]) === 'sam@studio.example' && /Juniper Floral Co\. sent their words and photos/.test(mail[0].subject) && mail[0].html.includes(`/sites.html#answers=${SITE}`));
  const again = await pub('POST', TOKEN, '', JSON.stringify({ send: true }));
  ok('send: pressing Send again within fifteen minutes doesn’t email again', again.status === 200 && mail.length === 1);
  // the studio reads it
  const tools = await studio('GET', '/agency/site-tools');
  ok('cards: the site’s line says it came back, unread — and never the link or the words', tools.body.data[SITE].intake.unread === true && tools.body.data[SITE].intake.answered === 3 && !JSON.stringify(tools.body).includes(TOKEN.slice(32)) && !JSON.stringify(tools.body).includes('Family florist'));
  const a = await studio('GET', `/agency/sites/${SITE}/intake/answers`, null, member({ role: 'readonly' }));
  const people = a.body.data.answers.find((x) => x.id === 'people');
  ok('answers: every question in order, words and files (with a picture and a download link), for a view-only seat too', a.status === 200 && a.body.data.answers.map((x) => x.id).join() === 'about,offer,hours,people,own1' && a.body.data.answers[0].text === 'Family florist since 2009.' && people.files.length === 1 && people.files[0].thumb_url && people.files[0].url);
  ok('answers: opening them marks them read', (await studio('GET', '/agency/site-tools')).body.data[SITE].intake.unread === false);
  // stop the link
  ok('stop: a view-only seat can’t', (await studio('POST', `/agency/sites/${SITE}/intake/state`, { open: false }, member({ role: 'readonly' }))).status === 403);
  const stopped = await studio('POST', `/agency/sites/${SITE}/intake/state`, { open: false });
  const g2 = await pub('GET', TOKEN);
  ok('stop: the link then shows nothing that was written', stopped.body.data.form.status === 'closed' && g2.status === 200 && g2.body.data.status === 'closed' && !('answers' in g2.body.data) && !JSON.stringify(g2.body).includes('Family florist'));
  ok('stop: and takes nothing more', (await pub('POST', TOKEN, '', JSON.stringify({ answers: { about: 'x' } }))).status === 409 && (await pub('POST', TOKEN, '/files', PNG, { 'Content-Type': 'image/png' }, '?q=people&name=a.png')).status === 409);
  ok('stop: emailing a stopped link is refused', (await studio('POST', `/agency/sites/${SITE}/intake/email`, { to: 'jun@juniper.example' })).status === 409);
  await studio('POST', `/agency/sites/${SITE}/intake/state`, { open: true });
  ok('open again: the same link works', (await pub('GET', TOKEN)).body.data.status === 'open');
  // change the questions: the link stays, answers to kept questions stay
  const ch = await studio('PUT', `/agency/sites/${SITE}/intake`, { kind: 'shop', picks: ['about', 'people', 'faqs'] });
  ok('change: same link, new questions, progress against what’s kept', ch.body.data.form.link.endsWith(TOKEN) && ch.body.data.form.questions.map((q) => q.id).join() === 'about,faqs,people' && ch.body.data.form.answered === 2 && ch.body.data.form.total === 3);
  ok('email: a bad address is refused', (await studio('POST', `/agency/sites/${SITE}/intake/email`, { to: 'not an email' })).status === 400);
  ok('email: a view-only seat can’t send it', (await studio('POST', `/agency/sites/${SITE}/intake/email`, { to: 'jun@juniper.example' }, member({ role: 'readonly' }))).status === 403);
  mail.length = 0;
  const em = await studio('POST', `/agency/sites/${SITE}/intake/email`, { to: 'jun@juniper.example' });
  const m0 = mail[0] || {};
  ok('email: goes to the address given, with the link, and replies reach the studio member who sent it', em.status === 200 && [].concat(m0.to || [])[0] === 'jun@juniper.example' && String(m0.html || '').includes(TOKEN) && /asked for your words and photos/.test(m0.subject || '') && JSON.stringify(m0).includes('sam@studio.example') && em.body.data.form.emailed_to === 'jun@juniper.example' && !!em.body.data.form.emailed_at);
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.error('FAILURES'); Deno.exit(1); }
