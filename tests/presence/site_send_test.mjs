// ── Builder list item 131: a client's site sends its forms from the page ──────
//   deno run --allow-read --allow-env --allow-net tests/presence/site_send_test.mjs
// Part A: a client's site is on its own address, so the visitor routes answer any origin
// (before this, the browser refused every booking call from a client's site). Part B:
// which pages carry the sender and the business's phone and email, that hostile words
// can't escape, and that every script a published page carries is valid code (the form
// rules, steps and prefill scripts weren't: escaping every "<" broke them). Part C: the
// form route answers the page's sender with words, a plain post with a page, never twice
// for one message. Part D: a booking retried after no answer is the same booking.
// The browser half (Sending…, the thank-you in place, the 15-second wait, words kept) is
// tests/e2e/site-send.spec.ts.
import { installFakePostgrest } from './fake_pgrst.mjs';

const results = [];
const ok = (n, p, note = '') => { results.push(!!p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const SID = '5e000000-0000-4000-8000-000000000001';
const TYPE = '7e000000-0000-4000-8000-000000000001';
const db = installFakePostgrest({ unique: { presence_appointments: [{ cols: ['site_id', 'slot_start_local'], where: (r) => ['pending', 'confirmed'].includes(r.status) }] } });
const fake = globalThis.fetch;
let overLimit = false, notSentPage = true;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes('/rest/v1/rpc/rate_hit')) return new Response(JSON.stringify(!overLimit), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (u === 'https://shop.example/not-sent/') return new Response(null, { status: notSentPage ? 200 : 404 });
  return fake(url, init);
};

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const { VISITOR_ROUTE, SEND_WAIT_MS, senderTag, siteReach, injectSender } = await import('../../supabase/functions/presence/lib/site_send.ts');
const { visitorCors, corsFor, PREFLIGHT_MAX_AGE } = await import('../../supabase/functions/_shared/cors.ts');
const { renderSnapshot } = await import('../../supabase/functions/presence/lib/render.ts');
const { attr } = await import('../../supabase/functions/presence/lib/markdown.ts');
const { renderForm, normalizeFormDefinition } = await import('../../supabase/functions/presence/lib/forms.ts');
const { handleFormSubmit, FORM_THANKS, RESEND_WINDOW_MIN } = await import('../../supabase/functions/presence/routes/commercial.ts');
const { handleBookingCreate, REBOOK_WINDOW_MIN } = await import('../../supabase/functions/presence/routes/booking.ts');
const { TEMPLATES, fullFixture, PAGE } = await import('./full_fixture.mjs');

// ═══ A · the visitor routes answer the client's own address ═══
for (const r of [`/forms/${SID}/submit`, `/book/${SID}`, `/book/${SID}/types`, `/book/${SID}/slots`]) ok(`visitor route: ${r}`, VISITOR_ROUTE.test(r));
for (const r of ['/forms/inbox', `/forms/inbox/${SID}/reply`, '/bookings/appointments', `/book/${SID}/other`, `/reviews/${SID}`, `/forms/${SID}/submit/x`, `/px/${SID}`, '/site', `/book/${SID.slice(1)}`]) ok(`not a visitor route: ${r}`, !VISITOR_ROUTE.test(r));
{
  const vc = visitorCors();
  ok('visitor answer: any address may read it, and it carries no sign-in', vc['Access-Control-Allow-Origin'] === '*' && !('Access-Control-Allow-Credentials' in vc));
  ok('visitor answer: GET and POST, the content type, kept like the app’s', /\bGET\b/.test(vc['Access-Control-Allow-Methods']) && /\bPOST\b/.test(vc['Access-Control-Allow-Methods']) && /content-type/.test(vc['Access-Control-Allow-Headers']) && vc['Access-Control-Max-Age'] === PREFLIGHT_MAX_AGE);
  ok('visitor answer: it names none of the app’s sign-in headers', !/x-dds|authorization|apikey/i.test(vc['Access-Control-Allow-Headers']));
  const idx = read('supabase/functions/presence/index.ts');
  ok('index.ts answers the visitor routes with it, the browser’s preflight included', /const cors = VISITOR_ROUTE\.test\(routeOf\(req\.url\)\) \? visitorCors\(\) : corsFor\(req\);\n\s*if \(req\.method === 'OPTIONS'\) return new Response\('ok', \{ headers: cors \}\);/.test(idx));
  ok('the app’s own routes keep the list of addresses', corsFor(new Request('https://fn.example/presence/site', { headers: { origin: 'https://elsewhere.example' } }))['Access-Control-Allow-Origin'] !== '*');
}

// ═══ B · what a published page carries ═══
const FN = 'https://db.test/functions/v1/presence';
const SITE = { baseUrl: 'https://shop.example', formEndpoint: `${FN}/forms/${SID}/submit`, bookEndpoint: `${FN}/book/${SID}` };
const TAG = senderTag(SITE.formEndpoint);
const scriptsOf = (html) => [...String(html).matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const parses = (code) => { try { new Function(code); return true; } catch { return false; } };
{
  const bad = [], badJs = [];
  for (const slug of TEMPLATES) {
    const fx = fullFixture(slug);
    const files = await renderSnapshot(fx, SITE);
    const reach = siteReach(fx.content);
    const onBody = (h) => (reach.tel ? h.includes(`data-reach-tel="${attr(reach.tel)}"`) : !h.includes('data-reach-tel')) && (reach.mail ? h.includes(`data-reach-mail="${attr(reach.mail)}"`) : !h.includes('data-reach-mail'));
    // the home page holds the Newsletter section's "Join our list" box (item 146), a form too; About holds none
    const contact = String(files['contact/index.html']), own = String(files[`${PAGE.slug}/index.html`]), home = String(files['about/index.html']);
    if (!(contact.split(TAG).length === 2 && contact.indexOf(TAG) < contact.lastIndexOf('</body>'))) bad.push(`${slug}: contact page sender`);
    if (!(own.split(TAG).length === 2 && own.includes(`data-book="${attr(SITE.bookEndpoint)}"`))) bad.push(`${slug}: owner’s page (form and booking) sender`);
    if (!onBody(contact) || !onBody(own)) bad.push(`${slug}: phone and email on <body>`);
    if (home.includes(TAG) || home.includes('data-reach-')) bad.push(`${slug}: About (no form) changed`);
    if (!reach.tel && !reach.mail) bad.push(`${slug}: its sample has no phone or email`);
    for (const [k, v] of Object.entries(files)) if (k.endsWith('.html')) for (const js of scriptsOf(v)) if (!parses(js)) badJs.push(`${slug} ${k}`);
    const canvas = await renderSnapshot(fx, { baseUrl: 'https://preview.invalid' });
    if (Object.values(canvas).some((v) => typeof v === 'string' && (v.includes('ps-note') || v.includes('data-reach-')))) bad.push(`${slug}: the builder’s canvas got the sender`);
  }
  ok('all eight templates: the contact page and the owner’s page with a form carry one sender; the phone and email ride on <body>; pages without a form are untouched', bad.length === 0, bad.join(' | '));
  ok('all eight templates: every inline script on every page is valid code', badJs.length === 0, badJs.slice(0, 4).join(' | '));
}
{
  const ep = SITE.bookEndpoint;
  const out = injectSender({ 'book/index.html': `<html><body class="x"><div class="booking-widget" data-book="${ep}"></div></body></html>`, 'a.css': 'body{}' }, { identity: { phone: '(555) 123-4567', email: 'hello@shop.example' } }, { bookEndpoint: ep });
  ok('a page with booking and no form: the phone and email, no sender', out['book/index.html'].startsWith('<html><body data-reach-tel="(555) 123-4567" data-reach-mail="hello@shop.example" class="x">') && !out['book/index.html'].includes('<script') && out['a.css'] === 'body{}');
  const hostile = injectSender({ 'c.html': `<body><form action="${attr(SITE.formEndpoint)}"></form></body>` }, { identity: { phone: '555 "><img src=x onerror=alert(1)>', email: 'a@b.co"><script>alert(1)</script>' } }, SITE)['c.html'];
  const bodyTag = hostile.match(/<body[^>]*>/)?.[0] || '';
  ok('hostile phone and email: escaped in the attribute, no tag escapes', bodyTag.includes('data-reach-tel="555 &quot;&gt;&lt;img') && !/<img|<script>alert/.test(hostile.replace(TAG, '')));
  ok('reach: a location’s phone first, then the business’s; junk dropped', siteReach({ identity: { phone: '111', email: 'x' }, locations: [{ phone: '(555) 222-3333' }] }).tel === '(555) 222-3333' && siteReach({ identity: { phone: '(555) 444-5555' } }).tel === '(555) 444-5555' && siteReach({ identity: { phone: 'call us', email: 'not an email' } }).tel === '' && siteReach({ identity: { email: 'not an email' } }).mail === '' && siteReach(null).tel === '');
  const js = scriptsOf(TAG)[0] || '';
  ok('the sender: valid code with no "</" of its own, the address as data', parses(js) && !js.includes('</') && js.includes(`var EP=${JSON.stringify(SITE.formEndpoint)}`));
  ok('the sender: waits 15 seconds, says Sending… and Still sending…, and says plainly when it didn’t send', SEND_WAIT_MS === 15000 && js.includes(`WAIT=${SEND_WAIT_MS}`) && js.includes('Sending…') && js.includes('Still sending…') && js.includes('Your message didn’t send. What you wrote is still here') && js.includes('Wait a minute, then send it again') && js.includes('You can also '));
  ok('the sender: asks for words (Accept: application/json), sends the whole form, builds text without HTML', js.includes("headers:{accept:'application/json'}") && js.includes('new FormData(f)') && !js.includes('innerHTML'));
}
{
  const def = normalizeFormDefinition({ title: 'Quote', fields: [
    { key: 'name', label: 'Name', type: 'text', required: true, step: 1, prefill: true },
    { key: 'email', label: 'Email', type: 'email', required: true, step: 1 },
    { key: 'kind', label: 'Kind', type: 'select', choices: ['Roof', 'Other</script>'], step: 2 },
    { key: 'other', label: 'Say more', type: 'textarea', step: 2 }],
    rules: [{ when: { field: 'kind', op: 'notEquals', value: 'Other</script>' }, then: { action: 'hide', target: 'other' } }] });
  const html = renderForm(def.form, { esc: (s) => s, attr, safeHref: (s) => s, formEndpoint: SITE.formEndpoint });
  const js = scriptsOf(html);
  ok('a form with rules, steps and prefill: three scripts, each valid code (they used to stop on their first line)', def.ok && js.length === 3 && js.every(parses), js.map(parses).join(','));
  ok('…and the owner’s words can’t end the tag early', !html.split('<script>').slice(1).some((part) => part.split('</script>')[0].includes('</')));
}

// ═══ C · the form route: words for the page, a page for a plain post ═══
const FORM_ID = 'quote';
const REDIRECT = 'https://shop.example/thank-you-for-asking/';
const quote = { type: 'form', id: FORM_ID, title: 'Request a quote', kind: 'quote', redirect_url: REDIRECT, confirmation_text: 'Got it, a quote is on its way.', fields: [
  { key: 'name', label: 'Your name', type: 'text', required: true }, { key: 'email', label: 'Email', type: 'email', required: true }, { key: 'details', label: 'Tell us more', type: 'textarea', required: true }], rules: [] };
const seed = () => db.reset({
  presence_sites: [{ id: SID, client_id: null, custom_domain: 'shop.example', netlify_site_id: 'nf-1' }],
  presence_settings: [{ site_id: SID, blocks: [quote], pages: [] }],
  presence_identity: [{ site_id: SID, business_name: 'Example Shop', email: 'owner@shop.example' }],
  presence_booking_settings: [{ site_id: SID, enabled: true, weekly: Array.from({ length: 7 }, () => [{ start: '08:00', end: '18:00' }]), slot_interval_min: 30, buffer_min: 0, lead_time_hours: 0, max_days_ahead: 60, timezone: 'UTC', auto_confirm: true, closed_dates: [] }],
  presence_appointment_types: [{ id: TYPE, site_id: SID, name: 'Haircut', duration_min: 30, price_cents: 4000, description: '', active: true, sort_order: 0 }],
});
const post = (fields, how = 'page') => {
  const body = how === 'plain' ? new URLSearchParams(fields) : (() => { const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.append(k, v); return fd; })();
  return handleFormSubmit(new Request(SITE.formEndpoint, { method: 'POST', body, headers: how === 'page' ? { accept: 'application/json' } : {} }), SID, visitorCors());
};
const body = async (r) => { try { return await r.json(); } catch { return null; } };
const stored = () => (db.tables.presence_form_submissions || []);
const fresh = () => { for (const r of stored()) r.created_at = new Date().toISOString(); };
const CONTACT = { form_kind: 'contact', source_page: '/contact/', name: 'Sam Rivera', contact: 'sam@customer.example', message: 'Do you fix gutters?', _hp: '' };
{
  seed(); overLimit = false; notSentPage = true;
  const r = await post(CONTACT);
  const j = await body(r);
  ok('the page’s sender: a 200 with words, not a redirect, and the message is stored', r.status === 200 && !r.headers.get('location') && j?.data?.ok === true && j.data.message === FORM_THANKS && stored().length === 1 && stored()[0].email === 'sam@customer.example', `${r.status} ${JSON.stringify(j)}`);
  ok('…and any address may read the answer', r.headers.get('access-control-allow-origin') === '*');
  fresh();
  const again = await body(await post(CONTACT));
  ok('the same words again within ten minutes (a retry after no answer): thanked, not stored twice', RESEND_WINDOW_MIN === 10 && again?.data?.ok === true && stored().length === 1);
  const other = await body(await post({ ...CONTACT, message: 'And windows?' }));
  ok('a different message from the same person is stored', other?.data?.ok === true && stored().length === 2);
  const plain = await post({ ...CONTACT, message: 'Plain post, scripts off' }, 'plain');
  ok('a plain post (scripts off) still goes on to the site’s thank-you page', plain.status === 303 && plain.headers.get('location') === 'https://shop.example/thanks/' && stored().length === 3);
  const noWay = await post({ ...CONTACT, contact: '' });
  const nj = await body(noWay);
  ok('the page’s sender, nothing to reply to: a 400 with the sentence to show', noWay.status === 400 && nj?.message === 'Leave an email or phone so they can reply.', JSON.stringify(nj));
  const noWayPlain = await post({ ...CONTACT, contact: '' }, 'plain');
  ok('…a plain post goes to the site’s “didn’t send” page with the reason', noWayPlain.status === 303 && noWayPlain.headers.get('location') === 'https://shop.example/not-sent/#ns-need_contact');
}
{
  seed();
  const good = { form_id: FORM_ID, form_kind: 'quote', name: 'Ana', email: 'ana@customer.example', details: 'A new roof' };
  const j = await body(await post(good));
  ok('a form of the owner’s with its own thank-you address: the sender is told where to go, with the owner’s words', j?.data?.ok === true && j.data.redirect === REDIRECT && j.data.message === 'Got it, a quote is on its way.', JSON.stringify(j));
  const plain = await post({ ...good, details: 'Plain' }, 'plain');
  ok('…a plain post is sent there itself', plain.status === 303 && plain.headers.get('location') === REDIRECT);
  const missing = await post({ ...good, details: '' });
  const mj = await body(missing);
  ok('…a missing answer: a 400 naming the field and saying what’s wrong', missing.status === 400 && mj?.field === 'details' && mj?.message === 'Tell us more is required.', JSON.stringify(mj));
  const gone = await post({ ...good, form_id: 'deleted-form' });
  ok('…a form that was taken down: a 404 with a sentence (the page offers the phone and email)', gone.status === 404 && (await body(gone))?.message === 'That form is no longer available.');
}
{
  seed(); overLimit = true;
  const busy = await post(CONTACT);
  ok('over the limit, the page’s sender gets a 429 it can explain', busy.status === 429 && /wait a minute/.test((await body(busy))?.message || ''));
  const plain = await post(CONTACT, 'plain');
  ok('over the limit, a plain post lands on the site’s “didn’t send” page, not the server’s raw answer', plain.status === 303 && plain.headers.get('location') === 'https://shop.example/not-sent/#ns-try_again');
  ok('…and nothing was stored', stored().length === 0);
  overLimit = false;
}

// ═══ D · booking: a retry after no answer is the same booking ═══
{
  seed();
  const day = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);
  const book = (who) => handleBookingCreate(new Request(SITE.bookEndpoint, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ type_id: TYPE, slot_start: `${day}T10:00`, ...who }) }), SID, visitorCors());
  const SAM = { name: 'Sam Rivera', email: 'Sam@Customer.example' };
  const first = await body(await book(SAM));
  const appts = () => db.tables.presence_appointments || [];
  ok('a booking goes through', first?.data?.ok === true && appts().length === 1, JSON.stringify(first));
  for (const a of appts()) a.created_at = new Date().toISOString();
  const retry = await book(SAM);
  const rj = await body(retry);
  ok('the same person again on the same time (a retry after no answer): told it went through, not that it was taken', retry.status === 200 && rj?.data?.ok === true && rj.data.message === first.data.message && appts().length === 1, JSON.stringify(rj));
  const byPhone = await body(await book({ name: 'Sam', phone: '555-010-2000' }));
  ok('someone else on that time is still told it was just taken', byPhone?.error === 'slot_taken');
  for (const a of appts()) a.created_at = new Date(Date.now() - (REBOOK_WINDOW_MIN + 1) * 60_000).toISOString();
  const late = await book(SAM);
  ok('after ten minutes it’s not taken as a retry', REBOOK_WINDOW_MIN === 10 && late.status === 409);
}

const passed = results.filter(Boolean).length;
console.log(`\n════ SITE SEND (item 131): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
