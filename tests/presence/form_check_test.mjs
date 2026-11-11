// ── Builder list item 140: stronger spam protection on a client's site ───────
//   deno run --allow-read --allow-env --allow-net tests/presence/form_check_test.mjs
// Part A, pure: the time ticket, the words, the order of reasons, the remembered-sender
// hash and the email link's token. Part B drives the real routes on a fake database: a
// site checks sends only an hour after its first publish with this code; a send with a
// good ticket reaches the owner (with "This was spam" in the alert), without one it lands
// in Spam and the robot is still thanked; marking spam teaches the site, Not spam
// unteaches it; the Inbox's Spam list says why; the email link asks, marks and undoes;
// booking refuses a robot outright. Part C reads the page scripts.
import { installFakePostgrest } from './fake_pgrst.mjs';

const results = [];
const ok = (n, p, note = '') => { results.push(!!p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const SID = '5e000000-0000-4000-8000-000000000001';
const OTHER = '5e000000-0000-4000-8000-000000000002';
const TYPE = '7e000000-0000-4000-8000-000000000001';
const KEY = 'test-approval-secret';
Deno.env.set('APPROVAL_SECRET', KEY);
Deno.env.set('RESEND_KEY', 'test-resend-key');
Deno.env.set('APP_URL', 'https://app.example');
const db = installFakePostgrest({ unique: { presence_appointments: [{ cols: ['site_id', 'slot_start_local'], where: (r) => ['pending', 'confirmed'].includes(r.status) }] } });
const fake = globalThis.fetch;
const emails = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes('/rest/v1/rpc/rate_hit')) return new Response('true', { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (u.startsWith('https://api.resend.com/')) { emails.push(JSON.parse(String(init.body || '{}'))); return new Response(JSON.stringify({ id: 'e1' }), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
  return fake(url, init);
};

const fc = await import('../../supabase/functions/presence/lib/form_check.ts');
const { issueTicket, readTicket, wordsLookLikeSpam, spamReason, SPAM_REASONS, senderKey, spamLinkToken, readSpamLinkToken, startCheckingSends, siteChecksSends, CHECK_GRACE_MS, TICKET_MIN_AGE_S } = fc;
const { RESERVED_NAMES } = await import('../../supabase/functions/presence/lib/reserved_store.ts');
const { VISITOR_ROUTE, senderTag, bookingScript, TICKET_SETTLE_MS } = await import('../../supabase/functions/presence/lib/site_send.ts');
const { visitorCors } = await import('../../supabase/functions/_shared/cors.ts');
const { handleFormSubmit, handleFormInbox, handleFormStatus, handleSendTicket, handleSpamLinkGet, handleSpamLinkPost } = await import('../../supabase/functions/presence/routes/commercial.ts');
const { handleBookingCreate } = await import('../../supabase/functions/presence/routes/booking.ts');
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const now = () => Math.floor(Date.now() / 1000);

// ═══ A · the pieces ═══
{
  const t = await issueTicket(SID, 1_800_000_000);
  ok('ticket: seconds and a signature', /^1800000000\.[0-9a-f]{32}$/.test(t));
  ok('ticket: good from three seconds on', await readTicket(t, SID, 1_800_000_000 + TICKET_MIN_AGE_S) === 'ok' && TICKET_MIN_AGE_S === 3);
  ok('ticket: faster than a person types is too fast', await readTicket(t, SID, 1_800_000_002) === 'too_fast');
  ok('ticket: a day old is stale', await readTicket(t, SID, 1_800_000_000 + 86400 + 1) === 'stale');
  ok('ticket: another site’s is no good', await readTicket(t, OTHER, 1_800_000_010) === 'bad');
  ok('ticket: a changed time breaks the signature', await readTicket(t.replace('1800000000', '1799999990'), SID, 1_800_000_010) === 'bad');
  ok('ticket: none, or junk', await readTicket('', SID, 1) === 'missing' && await readTicket(undefined, SID, 1) === 'missing' && await readTicket('hello', SID, 1) === 'bad');
  ok('ticket: no key, no ticket, and nothing reads as good', await issueTicket(SID, 1, '') === '' && await readTicket(t, SID, 1_800_000_010, '') === 'bad');
}
ok('words: a link in the name box', wordsLookLikeSpam('Buy now https://x.example', 'hi') === 'link_in_name' && wordsLookLikeSpam('see www.x.example', '') === 'link_in_name');
ok('words: three links in a message, but not two', wordsLookLikeSpam('Ana', 'a https://a.example b http://b.example c www.c.example') === 'many_links' && wordsLookLikeSpam('Ana', 'our site https://a.example and https://b.example') === null);
ok('words: an ordinary message', wordsLookLikeSpam('Sam Rivera', 'Do you fix gutters? Call me at 555-0100.') === null);
{
  const base = { trap: false, ticket: 'ok', checking: true, known: false, words: null };
  ok('reason: the hidden box comes first', spamReason({ ...base, trap: true, known: true }) === 'trap');
  ok('reason: no ticket, once the site checks', spamReason({ ...base, ticket: 'missing' }) === 'no_check' && spamReason({ ...base, ticket: 'bad' }) === 'no_check' && spamReason({ ...base, ticket: 'stale' }) === 'no_check');
  ok('reason: too fast', spamReason({ ...base, ticket: 'too_fast' }) === 'too_fast');
  ok('reason: before the site checks, the ticket counts for nothing', spamReason({ ...base, checking: false, ticket: 'missing' }) === null);
  ok('reason: an address marked before, then the words', spamReason({ ...base, known: true }) === 'marked_before' && spamReason({ ...base, words: 'many_links' }) === 'many_links');
  ok('reason: a clean send', spamReason(base) === null);
  ok('reason: each has a plain sentence for the owner', ['trap', 'no_check', 'too_fast', 'marked_before', 'link_in_name', 'many_links', 'owner'].every((k) => /^[A-Z].*\.$/.test(SPAM_REASONS[k] || '')));
}
{
  const a = await senderKey('Sam@Customer.Example'), b = await senderKey(' sam@customer.example ');
  ok('memory: one key per address, any case, and not the address itself', a === b && /^[0-9a-f]{24}$/.test(a) && !a.includes('sam') && await senderKey('') === '');
  const tok = await spamLinkToken(SID, TYPE, 1_800_000_000);
  ok('email link: names the site and the message', JSON.stringify(await readSpamLinkToken(tok, 1_800_000_100)) === JSON.stringify({ siteId: SID, submissionId: TYPE }));
  ok('email link: good for 60 days, then expired', (await readSpamLinkToken(tok, 1_800_000_000 + 59 * 86400)) !== 'expired' && await readSpamLinkToken(tok, 1_800_000_000 + 61 * 86400) === 'expired');
  const [body, sig] = tok.split('.');
  const forged = btoa(JSON.stringify({ s: OTHER, f: TYPE, e: 1_900_000_000 })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  ok('email link: another site’s message or a changed one is refused', await readSpamLinkToken(`${forged}.${sig}`, 1_800_000_100) === null && await readSpamLinkToken(`${body}.${'0'.repeat(40)}`, 1_800_000_100) === null && await readSpamLinkToken('junk', 1) === null);
}

// ═══ B · the routes ═══
const FN = 'https://db.test/functions/v1/presence';
const EP = `${FN}/forms/${SID}/submit`;
const seed = (checkSince) => {
  db.reset({
    presence_sites: [{ id: SID, client_id: null, custom_domain: 'shop.example', netlify_site_id: 'nf-1' }],
    presence_settings: [{ site_id: SID, blocks: [], pages: [] }],
    presence_identity: [{ site_id: SID, business_name: 'Example Shop', email: 'owner@shop.example' }],
    presence_booking_settings: [{ site_id: SID, enabled: true, weekly: Array.from({ length: 7 }, () => [{ start: '08:00', end: '18:00' }]), slot_interval_min: 30, buffer_min: 0, lead_time_hours: 0, max_days_ahead: 60, timezone: 'UTC', auto_confirm: true, closed_dates: [] }],
    presence_appointment_types: [{ id: TYPE, site_id: SID, name: 'Haircut', duration_min: 30, price_cents: 4000, description: '', active: true, sort_order: 0 }],
    presence_sales_templates: checkSince ? [{ id: crypto.randomUUID(), site_id: SID, kind: 'proposal', name: RESERVED_NAMES.formCheck, title: '', body: JSON.stringify({ since: checkSince }), deleted_at: null, updated_at: new Date().toISOString() }] : [],
  });
  emails.length = 0;
};
const subs = () => db.tables.presence_form_submissions || [];
// the owner alert goes out after the answer: wait for `count` emails (or 3 seconds), then a little more for a wrong extra one
const settle = async (count = 1) => { const end = Date.now() + 3000; while (emails.length < count && Date.now() < end) await new Promise((r) => setTimeout(r, 10)); await new Promise((r) => setTimeout(r, 150)); };
const MSG = (extra = {}) => ({ form_kind: 'contact', source_page: '/contact/', name: 'Sam Rivera', contact: 'sam@customer.example', message: `Do you fix gutters? ${crypto.randomUUID().slice(0, 6)}`, _hp: '', ...extra });
const post = (fields, page = true) => { const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.append(k, v); return handleFormSubmit(new Request(EP, { method: 'POST', body: fd, headers: page ? { accept: 'application/json' } : {} }), SID, visitorCors()); };
const body = async (r) => { try { return await r.json(); } catch { return null; } };
const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString();

{
  seed(null);
  const r = await body(await post(MSG()));
  await settle();
  ok('before the site checks: a send with no ticket still reaches the owner (pages published earlier have no ticket)', r?.data?.ok && subs().length === 1 && subs()[0].spam === false && emails.length === 1);
  seed(hoursAgo(0.5));
  await body(await post(MSG()));
  await settle();
  ok('…and for the first hour after the publish, for a page opened before it', subs()[0].spam === false && emails.length === 1 && CHECK_GRACE_MS === 3600_000);
}
{
  seed(hoursAgo(2));
  const good = await issueTicket(SID, now() - 5);
  const r = await body(await post(MSG({ _tk: good })));
  await settle();
  const row = subs()[0];
  ok('a send with a good ticket reaches the owner', r?.data?.ok && row.spam === false && !row.fields?.__spam && emails.length === 1, JSON.stringify({ r, spam: row.spam, f: row.fields, n: emails.length, to: emails.map((e) => e.to) }));
  const mail = emails[0];
  const link = /https:\/\/app\.example\/spam\.html\?t=([^"&]+)/.exec(mail?.html || '');
  ok('the owner’s alert carries “This was spam”, a link to this very message', !!link && JSON.stringify(await readSpamLinkToken(decodeURIComponent(link[1]))) === JSON.stringify({ siteId: SID, submissionId: row.id }) && /This was spam<\/a>/.test(mail.html));
  emails.length = 0;
  const none = await body(await post(MSG()));
  await settle(1);
  const r2 = subs()[1];
  ok('no ticket: kept in Spam with its reason, no alert, and the robot is still thanked', none?.data?.ok && r2.spam === true && r2.fields?.__spam?.reason === 'no_check' && emails.length === 0);
  await body(await post(MSG({ _tk: await issueTicket(SID, now()) })));
  ok('a ticket used at once: too fast', subs()[2].spam === true && subs()[2].fields.__spam.reason === 'too_fast');
  await body(await post(MSG({ _tk: await issueTicket(OTHER, now() - 10) })));
  ok('another site’s ticket: no good', subs()[3].fields.__spam.reason === 'no_check');
  const plain = await post(MSG(), false);
  ok('a plain post (scripts off) goes to the thank-you page as before, and waits in Spam', plain.status === 303 && plain.headers.get('location') === 'https://shop.example/thanks/' && subs()[4].spam === true);
}
{
  seed(null);
  await body(await post(MSG({ name: 'Cheap pills https://pills.example' })));
  ok('words count even before the site checks: a link in the name goes to Spam', subs()[0].spam === true && subs()[0].fields.__spam.reason === 'link_in_name');
}
{
  seed(null);
  await body(await post(MSG()));
  const first = subs()[0];
  const site = { id: SID };
  const mark = (id, spam) => handleFormStatus(new Request('https://x/forms/inbox/' + id, { method: 'POST', body: JSON.stringify({ spam }) }), site, id, {});
  ok('the Inbox’s Spam button marks it, with the owner’s own reason', (await mark(first.id, true)).status === 200 && first.spam === true && first.fields.__spam.reason === 'owner');
  const row = (db.tables.presence_sales_templates || []).find((t) => t.name === RESERVED_NAMES.spamSenders);
  ok('…and the site remembers the address, as a hash only', !!row && JSON.parse(row.body).keys.includes(await senderKey('sam@customer.example')) && !row.body.includes('sam@'));
  await body(await post(MSG({ contact: 'SAM@customer.example' })));
  ok('more from that address goes to Spam, whatever the case', subs()[1].spam === true && subs()[1].fields.__spam.reason === 'marked_before');
  await mark(first.id, false);
  ok('Not spam brings it back, clears the reason and forgets the address', first.spam === false && !first.fields.__spam && JSON.parse((db.tables.presence_sales_templates || []).find((t) => t.name === RESERVED_NAMES.spamSenders).body).keys.length === 0);
  await body(await post(MSG()));
  ok('…so the next one from them reaches the owner', subs()[2].spam === false);
  const list = await body(await handleFormInbox(site, {}, new Request('https://x/forms/inbox?spam=1')));
  ok('the Inbox’s Spam list: what was held back, each with why in plain words', list?.data?.days === 30 && list.data.spam.length === 1 && list.data.spam[0].id === subs()[1].id && list.data.spam[0].spam_reason === SPAM_REASONS.marked_before && !('fields' in list.data.spam[0]));
  const inbox = await body(await handleFormInbox(site, {}));
  ok('…and the ordinary list leaves Spam out', inbox.data.submissions.every((s) => s.id !== subs()[1].id));
}
{
  seed(null);
  await body(await post(MSG()));
  const row = subs()[0];
  const tok = await spamLinkToken(SID, row.id);
  const get = (t) => handleSpamLinkGet(new Request(`${FN}/forms/spam?t=${encodeURIComponent(t)}`), {});
  const send = (b) => handleSpamLinkPost(new Request(`${FN}/forms/spam`, { method: 'POST', body: JSON.stringify(b) }), {});
  const shown = await body(await get(tok));
  ok('the email link’s page first shows the message, unchanged', shown?.data?.who === 'Sam Rivera' && shown.data.preview.startsWith('Do you fix gutters?') && shown.data.spam === false && row.spam === false);
  const marked = await body(await send({ t: tok }));
  ok('its button moves it to Spam and teaches the site', marked?.data?.spam === true && row.spam === true && row.fields.__spam.reason === 'owner' && await fc.isMarkedSender(SID, 'sam@customer.example'));
  const undone = await body(await send({ t: tok, undo: true }));
  ok('Undo takes both back', undone?.data?.spam === false && row.spam === false && !(await fc.isMarkedSender(SID, 'sam@customer.example')));
  ok('a broken link says so', (await get('junk')).status === 400 && (await send({ t: 'junk' })).status === 400);
  ok('an expired link says so', (await get(await spamLinkToken(SID, row.id, now() - 61 * 86400))).status === 410);
  ok('a link for a message that’s gone says so', (await get(await spamLinkToken(SID, crypto.randomUUID()))).status === 404);
}
{
  const r = await handleSendTicket(new Request(`${FN}/forms/${SID}/ticket`), SID, visitorCors());
  const j = await body(r);
  ok('the ticket route: a ticket for this site, never kept by a cache', r.status === 200 && r.headers.get('cache-control') === 'no-store' && await readTicket(j?.data?.ticket, SID, now() + 3) === 'ok' && j.data.wait_s === 3);
  ok('the ticket routes are visitor routes (any address may ask)', VISITOR_ROUTE.test(`/forms/${SID}/ticket`) && VISITOR_ROUTE.test(`/book/${SID}/ticket`) && !VISITOR_ROUTE.test(`/forms/${SID}/tickets`) && !VISITOR_ROUTE.test('/forms/spam'));
  const idx = read('supabase/functions/presence/index.ts');
  ok('index.ts routes the ticket and the email link before sign-in', /route\.match\(\/\^\\\/\(\?:forms\|book\)\\\/\(\[0-9a-f-\]\{36\}\)\\\/ticket\$\/\)/.test(idx) && idx.includes("if (route === '/forms/spam' && method === 'POST') return handleSpamLinkPost(req, cors);") && idx.indexOf("'/forms/spam'") < idx.indexOf('resolveSite(') );
}
{
  seed(hoursAgo(2));
  const day = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);
  const book = (extra) => handleBookingCreate(new Request(`${FN}/book/${SID}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type_id: TYPE, slot_start: `${day}T10:00`, name: 'Sam Rivera', email: 'sam@customer.example', ...extra }) }), SID, visitorCors());
  const robot = await book({});
  const rj = await body(robot);
  ok('booking, once the site checks: no ticket is refused out loud, and no time is held', robot.status === 400 && rj?.error === 'check' && /try again/.test(rj.message) && !(db.tables.presence_appointments || []).length);
  const person = await body(await book({ _tk: await issueTicket(SID, now() - 20) }));
  ok('…a person with a good ticket books', person?.data?.ok === true && db.tables.presence_appointments.length === 1);
  seed(null);
  const early = await body(await book({}));
  ok('…and before the site checks, a widget published earlier still books', early?.data?.ok === true);
}
{
  seed(null);
  await startCheckingSends(SID);
  const first = JSON.parse(db.tables.presence_sales_templates.find((t) => t.name === RESERVED_NAMES.formCheck).body).since;
  await new Promise((r) => setTimeout(r, 15));
  await startCheckingSends(SID);
  const still = JSON.parse(db.tables.presence_sales_templates.find((t) => t.name === RESERVED_NAMES.formCheck).body).since;
  ok('a publish starts the checks once; later publishes keep the first time', first === still && !(await siteChecksSends(SID)) && await siteChecksSends(SID, Date.now() + CHECK_GRACE_MS + 1000));
  const pub = read('supabase/functions/presence/routes/publish.ts');
  ok('publish starts them after a deploy of pages with a form address', /if \(!dep\.ok\) return await fail\('deploy'[^\n]*\n\s*at\('deploy'\);\n[\s\S]{0,400}if \(siteCfg\.formEndpoint\) await startCheckingSends\(site\.id\)/.test(pub));
}

// ═══ C · the page scripts ═══
{
  const s = senderTag(EP);
  ok('the sender asks for a ticket when a visitor starts on a form, and sends it', s.includes("EP.replace(/\\/submit$/,'/ticket')") && s.includes("addEventListener('focusin'") && s.includes("fd.append('_tk',TK)"));
  ok('…it waits until the ticket is old enough, and asks again after 11 hours', TICKET_SETTLE_MS === 3500 && s.includes(`TKAT+${TICKET_SETTLE_MS}-Date.now()`) && s.includes(`Date.now()-TKAT<${11 * 3600_000}`));
  ok('…and a ticket it can’t get is a send that didn’t go through', s.includes("if(!r.ok)throw new Error('ticket '+r.status)"));
  const b = bookingScript();
  ok('the booking widget sends its ticket and, refused, asks for a new one and tries once more', b.includes('_tk:TK') && b.includes("o.j.error==='check'&&!second){TK='';return send(true);}"));
}
{
  const page = read('spam.html');
  ok('spam.html: asks before it marks (a scanner opening the link changes nothing), with Undo', page.includes('Is this message spam?') && page.includes('Yes, it’s spam') && page.includes('It’s not spam') && page.includes('noindex') && !/fetch\([^)]*POST/.test(page.split("call('GET')")[1]?.split('.then')[0] || ''));
  const inbox = read('inbox.html');
  ok('inbox.html: a Spam chip beside Open, New and All, with the reason and Not spam', inbox.includes("${chip('spam','Spam')}") && inbox.includes("api('/forms/inbox?spam=1')") && inbox.includes('<button id="notSpam" class="primary">Not spam</button>') && inbox.includes('l.spam_reason'));
}

const passed = results.filter(Boolean).length;
console.log(`\n════ FORM CHECKS (item 140): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
