// ── Builder list item 203: a stranger can't make a business send email, or fill its storage ──
//   deno run --allow-read --allow-env --allow-net tests/presence/abuse_limits_203_test.mjs
// Part A: each kind of automatic reply once a day per address per site, none to the do-not-send list
// (lib/auto_reply.ts). Part B drives the real routes on a fake database, mail service
// and store: a second enquiry or booking from the same address the same day gets no
// second email, an unsubscribed address gets none; "Join our list" adds nobody until
// "Yes, add me" is pressed on join.html; a site's form files have a ceiling; Delete takes
// a message and its files; Spam's old messages go after 30 days, files first. Part C:
// the wiring in index.ts, the Inbox and join.html.
import { installFakePostgrest } from './fake_pgrst.mjs';

const results = [];
const ok = (n, p, note = '') => { results.push(!!p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const SID = '5e000000-0000-4000-8000-000000000001';
const OTHER = '5e000000-0000-4000-8000-000000000002';
const TYPE = 'e1000000-0000-4000-8000-000000000001';
Deno.env.set('APPROVAL_SECRET', 'test-approval-secret');
Deno.env.set('RESEND_KEY', 'test-resend-key');
Deno.env.set('APP_URL', 'https://app.example');
const db = installFakePostgrest();
const fake = globalThis.fetch;
const counts = new Map(), mail = [], stored = [], removed = [];
let rateDown = false, storeRefuses = false;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = (init.method || 'GET').toUpperCase();
  if (u.startsWith('https://api.resend.com/emails')) { mail.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ id: `e${mail.length}` }), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
  if (u.includes('/rest/v1/rpc/rate_hit')) {
    if (rateDown) return new Response('{"message":"boom"}', { status: 500 });
    const b = JSON.parse(String(init.body));
    const k = `${b.p_bucket}|${b.p_window}`;
    counts.set(k, (counts.get(k) || 0) + 1);
    return new Response(JSON.stringify(counts.get(k) <= b.p_max), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (u.startsWith('https://db.test/storage/v1/object/presence-media')) {
    if (storeRefuses) return new Response('{}', { status: 500 });
    if (method === 'DELETE') { removed.push(...JSON.parse(String(init.body)).prefixes); return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }); }
    stored.push(u.split('/object/presence-media/')[1]);
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return fake(url, init);
};

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const P = '../../supabase/functions/presence';
const { dayWindow, autoReplyBucket, autoReplyVerdict, autoReplyDeps, AUTO_REPLIES_PER_DAY } = await import(`${P}/lib/auto_reply.ts`);
const { joinLinkToken, readJoinLinkToken, JOIN_LINK_DAYS, JOIN_CHECK_EMAIL, JOINED } = await import(`${P}/lib/join_confirm.ts`);
const { FILE_LIMITS, storeFormFiles, formFileBytes, removeFormFiles, filePathsOf, clearOldSpam, SPAM_KEEP_DAYS } = await import(`${P}/lib/form_files.ts`);
const { handleFormSubmit, handleJoinGet, handleJoinPost, handleFormDelete, SITE_FULL, SPAM_DAYS } = await import(`${P}/routes/commercial.ts`);
const { handleBookingCreate } = await import(`${P}/routes/booking.ts`);
const { runRetentionSweep } = await import(`${P}/ops/retention.ts`);
const { SIGNUP_CONSENT } = await import(`${P}/lib/site_send.ts`);
const { visitorCors } = await import('../../supabase/functions/_shared/cors.ts');

const settle = async (n, ms = 3000) => { const end = Date.now() + ms; while (mail.length < n && Date.now() < end) await new Promise((r) => setTimeout(r, 5)); await new Promise((r) => setTimeout(r, 40)); };
const to = (e) => (Array.isArray(e?.to) ? e.to[0] : e?.to);
const sentTo = (addr) => mail.filter((e) => to(e) === addr);
const body = async (r) => { try { return await r.json(); } catch { return null; } };
const clear = () => { counts.clear(); mail.length = 0; stored.length = 0; removed.length = 0; rateDown = false; storeRefuses = false; };

// ═══ A · one automatic reply a day ═══
{
  ok('one automatic reply of each kind a day to an address', AUTO_REPLIES_PER_DAY === 1);
  ok('the day is the UTC day', dayWindow(Date.parse('2026-11-12T23:59:59Z')) === '2026-11-12T00:00:00.000Z' && dayWindow(Date.parse('2026-11-13T00:00:01Z')) === '2026-11-13T00:00:00.000Z');
  const [b1, b2, b3, b4] = await Promise.all([autoReplyBucket('enquiry', SID, 'Sam@Customer.example'), autoReplyBucket('enquiry', SID, ' sam@customer.example '), autoReplyBucket('enquiry', OTHER, 'sam@customer.example'), autoReplyBucket('booking', SID, 'sam@customer.example')]);
  ok('the count is kept under a hash: no address in it, capitals and spaces don’t matter, each site and each kind its own', b1 === b2 && b1 !== b3 && b1 !== b4 && b1.startsWith(`autoreply:enquiry:${SID}:`) && !/sam|customer/.test(b1));
  db.reset({ suppressed_emails: [{ email: 'gone@customer.example', reason: 'opt_out' }, { email: 'dead@customer.example', reason: 'bounce' }] }); clear();
  ok('the first reply of the day goes', await autoReplyVerdict('enquiry', SID, 'sam@customer.example') === 'send');
  ok('…a second the same day is held back, whatever the capitals', await autoReplyVerdict('enquiry', SID, 'Sam@Customer.example') === 'sent_today');
  ok('…another site has its own one', await autoReplyVerdict('enquiry', OTHER, 'sam@customer.example') === 'send');
  ok('…and each kind its own: their booking’s confirmation still goes that day', await autoReplyVerdict('booking', SID, 'sam@customer.example') === 'send' && await autoReplyVerdict('booking', SID, 'sam@customer.example') === 'sent_today');
  const before = counts.size;
  ok('someone who unsubscribed gets none, and nothing is counted for them', await autoReplyVerdict('enquiry', SID, 'gone@customer.example') === 'unsubscribed' && counts.size === before);
  ok('…nor does an address that bounced', await autoReplyVerdict('booking', SID, 'dead@customer.example') === 'unsubscribed');
  const now = autoReplyDeps.now;
  autoReplyDeps.now = () => Date.now() + 86_400_000;
  ok('the next day, one more', await autoReplyVerdict('enquiry', SID, 'sam@customer.example') === 'send');
  autoReplyDeps.now = now;
  rateDown = true;
  ok('when the count can’t be read, an optional reply waits', await autoReplyVerdict('enquiry', SID, 'new@customer.example') === 'unchecked');
  ok('…and a booking’s confirmation still goes (failOpen)', await autoReplyVerdict('booking', SID, 'new@customer.example', { failOpen: true }) === 'send');
  rateDown = false;
  ok('not an address: nothing is sent or counted', await autoReplyVerdict('enquiry', SID, 'not an address') === 'unchecked');
}

// ═══ B · the routes ═══
const FN = 'https://db.test/functions/v1/presence';
const EP = `${FN}/forms/${SID}/submit`;
const RAW = { type: 'form', id: 'quote', title: 'Request a quote', kind: 'quote', fields: [
  { key: 'name', label: 'Your name', type: 'text', required: true },
  { key: 'email', label: 'Email', type: 'email', required: true },
  { key: 'photos', label: 'Photos of the problem', type: 'file', required: true },
  { key: 'details', label: 'Tell us more', type: 'textarea' }] };
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const SLOT_DATE = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
const seed = (extra = {}) => { db.reset({
  presence_sites: [{ id: SID, client_id: null, custom_domain: 'shop.example', netlify_site_id: 'nf-1' }],
  presence_settings: [{ site_id: SID, blocks: [RAW], pages: [], auto_ack_enquiries: true }],
  presence_identity: [{ site_id: SID, business_name: 'Example Shop', email: 'owner@shop.example' }],
  presence_booking_settings: [{ site_id: SID, enabled: true, weekly: Array.from({ length: 7 }, () => [{ start: '08:00', end: '18:00' }]), slot_interval_min: 30, buffer_min: 0, lead_time_hours: 0, max_days_ahead: 60, timezone: 'UTC', auto_confirm: true }],
  presence_appointment_types: [{ id: TYPE, site_id: SID, name: 'Haircut', duration_min: 30, price_cents: 4000, description: '', sort_order: 0, active: true, deleted_at: null }],
  ...extra,
}); clear(); };
const enquire = (fields) => handleFormSubmit(new Request(EP, { method: 'POST', headers: { 'Content-Type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ form_kind: 'contact', _hp: '', ...fields }) }), SID, visitorCors());
const join = (fields) => { const fd = new FormData(); for (const [k, v] of Object.entries({ form_kind: 'signup', source_page: '/about/', _hp: '', consent: 'yes', ...fields })) fd.append(k, v); return handleFormSubmit(new Request(EP, { method: 'POST', body: fd, headers: { accept: 'application/json' } }), SID, visitorCors()); };
const book = (slot, email) => handleBookingCreate(new Request(`${FN}/book/${SID}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type_id: TYPE, slot_start: `${SLOT_DATE}T${slot}`, name: 'Sam Rivera', email }) }), SID, {});

// the enquiry acknowledgement
{
  seed();
  await enquire({ name: 'Sam', email: 'sam@customer.example', message: 'Do you fix gutters?' });
  await settle(2);
  ok('an enquiry: the person who wrote in gets the acknowledgement, the owner the alert', sentTo('sam@customer.example').length === 1 && sentTo('owner@shop.example').length === 1, JSON.stringify(mail.map(to)));
  await enquire({ name: 'Sam', email: 'Sam@Customer.example', message: 'And roofs?' });
  await enquire({ name: 'Sam', email: 'sam@customer.example', message: 'And windows?' });
  await settle(4);
  ok('…two more from that address the same day: both kept, the owner hears of both, but no second acknowledgement', (db.tables.presence_form_submissions || []).length === 3 && sentTo('owner@shop.example').length === 3 && sentTo('sam@customer.example').length === 1 && sentTo('Sam@Customer.example').length === 0, JSON.stringify(mail.map(to)));
  seed({ suppressed_emails: [{ email: 'gone@customer.example', reason: 'opt_out' }] });
  await enquire({ name: 'Gone', email: 'gone@customer.example', message: 'Hello there' });
  await settle(1);
  ok('…someone who unsubscribed gets no acknowledgement (the owner still hears)', sentTo('gone@customer.example').length === 0 && sentTo('owner@shop.example').length === 1, JSON.stringify(mail.map(to)));
}

// a booking's confirmation
{
  seed();
  const r1 = await body(await book('10:00', 'sam@customer.example'));
  await settle(2);
  ok('a booking: the confirmation goes, and the page says it’s on its way', r1?.data?.status === 'confirmed' && sentTo('sam@customer.example').length === 1 && /A confirmation is on its way\.$/.test(r1.data.message), JSON.stringify(r1));
  const r2 = await body(await book('11:00', 'sam@customer.example'));
  await settle(4);
  ok('…a second booking from that address the same day: booked, the owner hears, no second email', r2?.data?.status === 'confirmed' && sentTo('sam@customer.example').length === 1 && mail.filter((e) => /^New booking/.test(e.subject)).length === 2, JSON.stringify(mail.map((e) => [to(e), e.subject])));
  ok('…and its page doesn’t promise an email: it shows the booking and its links', r2.data.message === `You’re booked for Haircut — ${r2.data.when}.` && !!r2.data.links);
  seed({ suppressed_emails: [{ email: 'gone@customer.example', reason: 'opt_out' }] });
  await book('10:00', 'gone@customer.example');
  await settle(1);
  ok('…someone who unsubscribed books, and gets no email (the owner still hears)', sentTo('gone@customer.example').length === 0 && mail.some((e) => /^New booking/.test(e.subject)));
  seed(); rateDown = true;
  await book('10:00', 'kim@customer.example');
  await settle(2);
  ok('…when the day’s count can’t be read, the confirmation still goes (it is their appointment)', sentTo('kim@customer.example').length === 1);
  seed();
  await enquire({ name: 'Lee', email: 'lee@customer.example', message: 'Do you have Saturdays?' });
  await settle(2);
  await book('12:00', 'lee@customer.example');
  await settle(4);
  ok('someone who writes in and then books the same day gets the acknowledgement and the booking’s confirmation', sentTo('lee@customer.example').length === 2 && sentTo('lee@customer.example').some((e) => /^We got your message/.test(e.subject)) && sentTo('lee@customer.example').some((e) => /Haircut/.test(e.subject)), JSON.stringify(sentTo('lee@customer.example').map((e) => e.subject)));
}

// Join our list
const contacts = () => (db.tables.presence_contacts || []).filter((c) => c.site_id === SID);
const tokenIn = (e) => { const m = /join\.html\?t=([^"&]+)/.exec(String(e?.html || '')); return m ? decodeURIComponent(m[1]) : ''; };
const joinGet = (t) => handleJoinGet(new Request(`${FN}/join?t=${encodeURIComponent(t)}`), {});
const joinPost = (t) => handleJoinPost(new Request(`${FN}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t }) }), {});
{
  seed();
  const r = await body(await join({ email: ' Sam@Customer.example ' }));
  await settle(1);
  const e = sentTo('sam@customer.example');
  ok('joining adds nobody: the box says to check email', r?.data?.message === JOIN_CHECK_EMAIL && contacts().length === 0, JSON.stringify(r));
  ok('…one email, from the business, with a “Yes, add me” button to join.html', e.length === 1 && e[0].subject === 'Confirm: join Example Shop’s list' && e[0].html.includes('>Yes, add me</a>') && e[0].html.includes('https://app.example/join.html?t=') && !!tokenIn(e[0]));
  ok('…which says what happens if it wasn’t them', e[0].html.includes('If it wasn’t you, ignore this email and nothing happens'));
  const t = tokenIn(e[0]);
  const g = await body(await joinGet(t));
  ok('join.html shows who and what before anything is kept', g?.data?.business === 'Example Shop' && g.data.email === 'sam@customer.example' && g.data.joined === false && contacts().length === 0);
  const p = await joinPost(t);
  const c = contacts()[0];
  ok('“Yes, add me” adds them, with what they agreed to, where, and when they said yes', p.status === 200 && contacts().length === 1 && c.email === 'sam@customer.example' && !!c.subscribed_at && c.subscribed_note.startsWith(`Joined on /about/: “${SIGNUP_CONSENT}” Said yes by email on 20`), JSON.stringify(c));
  const at = c.subscribed_at;
  await joinPost(t);
  ok('…pressing it twice changes nothing', contacts().length === 1 && contacts()[0].subscribed_at === at);
  ok('…and the link then says they’re on the list', (await body(await joinGet(t)))?.data?.joined === true);
  mail.length = 0;
  const again = await body(await join({ email: 'sam@customer.example', source_page: '/' }));
  await settle(1, 300);
  ok('someone already on the list: the same answer, and no email', again?.data?.message === JOIN_CHECK_EMAIL && mail.length === 0);
}
{
  seed([]);
  seed({ presence_contacts: [{ id: 'c-1', site_id: SID, name: 'Pat Lee', email: 'Pat@Customer.example', phone: '555', subscribed_at: null, subscribed_note: '', deleted_at: null }] });
  await join({ email: 'pat@customer.example' });
  await settle(1);
  await joinPost(tokenIn(sentTo('pat@customer.example')[0]));
  ok('a contact already on file (other capitals) is the one marked, keeping their name', contacts().length === 1 && contacts()[0].name === 'Pat Lee' && !!contacts()[0].subscribed_at);
  mail.length = 0;
  await join({ email: 'ana@customer.example' });
  await join({ email: 'ana@customer.example', source_page: '/' });
  await settle(2, 400);
  ok('joining twice the same day: one email', sentTo('ana@customer.example').length === 1);
}
{
  seed({ suppressed_emails: [{ email: 'gone@customer.example', reason: 'opt_out' }] });
  const r = await body(await join({ email: 'gone@customer.example' }));
  await settle(1, 300);
  ok('someone who unsubscribed: the same answer, no email, nobody added', r?.data?.message === JOIN_CHECK_EMAIL && mail.length === 0 && contacts().length === 0);
  const robot = await body(await join({ email: 'bot@spam.example', _hp: 'gotcha' }));
  await settle(1, 300);
  ok('a robot: thanked, and nothing sent', robot?.data?.ok === true && mail.length === 0);
  const noYes = await body(await join({ email: 'sam@customer.example', consent: '' }));
  ok('no tick: said at the tick, nothing sent', noYes?.field === 'consent' && mail.length === 0);
}
{
  const nowSec = Math.floor(Date.now() / 1000);
  const good = await joinLinkToken(SID, 'sam@customer.example', '/about/', nowSec);
  const old = await joinLinkToken(SID, 'sam@customer.example', '/about/', nowSec - (JOIN_LINK_DAYS * 86400 + 60));
  const [body0, sig] = good.split('.');
  const forged = btoa(JSON.stringify({ s: SID, m: 'someone@else.example', p: '/', e: nowSec + 3600 })).replace(/=+$/, '') + '.' + sig;
  ok('the link: read back as it was made', JSON.stringify(await readJoinLinkToken(good, nowSec)) === JSON.stringify({ siteId: SID, email: 'sam@customer.example', page: '/about/' }));
  ok('…one past its days has run out, and one with another address under the same signature is no link', await readJoinLinkToken(old, nowSec) === 'expired' && await readJoinLinkToken(forged, nowSec) === null && await readJoinLinkToken(body0 + '.' + '0'.repeat(40), nowSec) === null);
  ok('…another signing key’s link is no link', await readJoinLinkToken(await joinLinkToken(SID, 'sam@customer.example', '/', nowSec, 'other-key'), nowSec) === null);
  seed();
  ok('join.html: a run-out link says so, and adds nobody', (await joinPost(old)).status === 410 && contacts().length === 0);
  ok('join.html: a broken one too', (await joinGet('nonsense')).status === 400 && (await joinPost(forged)).status === 400 && contacts().length === 0);
  ok('what join.html says once they pressed it', JOINED === 'You’re on the list. Thank you!');
}

// a site's form files: a ceiling, and they go with their message
const post = (fields, files = []) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ form_id: 'quote', form_kind: 'quote', source_page: '/', _hp: '', ...fields })) fd.append(k, v);
  for (const [k, bytes, name, type] of files) fd.append(k, new File([bytes], name, { type }));
  return handleFormSubmit(new Request(EP, { method: 'POST', body: fd, headers: { accept: 'application/json' } }), SID, visitorCors());
};
const subs = () => db.tables.presence_form_submissions || [];
const GOOD = { name: 'Ana', email: 'ana@customer.example', details: 'The gutter is falling off.' };
{
  ok('a site keeps at most 1 GB in form files, the media library’s own size', FILE_LIMITS.site === 1024 * 1024 * 1024);
  const near = FILE_LIMITS.site - 5;
  const full = await storeFormFiles(SID, [{ key: 'photos', file: new File([JPEG], 'roof.jpg', { type: 'image/jpeg' }) }], async () => true, near);
  ok('the store: a send that would pass the ceiling keeps nothing', full.ok === false && full.error === 'site_full');
  ok('…one that fits is kept, and an unread total doesn’t cost a customer their files', (await storeFormFiles(SID, [{ key: 'photos', file: new File([JPEG], 'a.jpg') }], async () => true, 0)).ok && (await storeFormFiles(SID, [{ key: 'photos', file: new File([JPEG], 'a.jpg') }], async () => true, null)).ok);
  seed({ presence_form_submissions: [
    { id: 'f-1', site_id: SID, spam: false, created_at: new Date().toISOString(), fields: { __files: [{ key: 'photos', name: 'a.jpg', type: 'image/jpeg', size: 400, path: `forms/${SID}/a.jpg` }, { key: 'photos', name: 'b.pdf', type: 'application/pdf', size: 600, path: `forms/${SID}/b.pdf` }] } },
    { id: 'f-2', site_id: SID, spam: false, created_at: new Date().toISOString(), fields: { name: 'No files' } },
    { id: 'f-3', site_id: OTHER, spam: false, created_at: new Date().toISOString(), fields: { __files: [{ size: 99999, path: `forms/${OTHER}/c.jpg` }] } },
  ] });
  ok('the total is this site’s files, summed', await formFileBytes(SID) === 1000);
  db.tables.presence_form_submissions[1].fields = { __files: [{ key: 'photos', name: 'big.jpg', type: 'image/jpeg', size: FILE_LIMITS.site - 1000, path: `forms/${SID}/big.jpg` }] };
  const r = await post(GOOD, [['photos', JPEG, 'roof.jpg', 'image/jpeg']]);
  const j = await body(r);
  ok('a send to a full site: refused in plain words at the file box, nothing stored, no message kept', r.status === 400 && j?.error === 'site_full' && j.message === SITE_FULL && j.field === 'photos' && stored.length === 0 && subs().length === 3, JSON.stringify(j));
  db.tables.presence_form_submissions[1].fields = { name: 'No files' };
  const r2 = await post(GOOD, [['photos', JPEG, 'roof.jpg', 'image/jpeg']]);
  ok('…with room, the same send goes through', r2.status === 200 && stored.length === 1 && subs().length === 4);
}
{
  const fields = { __files: [{ key: 'photos', name: 'a.jpg', size: 400, path: `forms/${SID}/a.jpg` }, { key: 'photos', name: 'evil', size: 1, path: '../../etc' }] };
  ok('a message’s stored paths, and only real ones under forms/', JSON.stringify(filePathsOf(fields)) === JSON.stringify([`forms/${SID}/a.jpg`]) && filePathsOf(null).length === 0);
  const calls = [];
  ok('removing: nothing to remove is fine', await removeFormFiles([], async (p) => { calls.push(p); return true; }) && calls.length === 0);
  ok('…only paths under forms/ are ever sent to the store', await removeFormFiles(['forms/x/a.jpg', 'media/x/logo.png', 'forms/../x'], async (p) => { calls.push(p); return true; }) && JSON.stringify(calls) === JSON.stringify([['forms/x/a.jpg']]));
}
const SITE = { id: SID };
{
  seed({ presence_form_submissions: [
    { id: 'f0000000-0000-4000-8000-000000000001', site_id: SID, spam: false, status: 'new', created_at: new Date().toISOString(), fields: { __files: [{ key: 'photos', name: 'a.jpg', size: 400, path: `forms/${SID}/a.jpg` }] } },
    { id: 'f0000000-0000-4000-8000-000000000002', site_id: SID, spam: false, status: 'new', created_at: new Date().toISOString(), fields: {} },
  ], presence_plan_notices: [{ id: 'n-1', site_id: SID, kind: 'lead_followup', period: 'lead:f0000000-0000-4000-8000-000000000001', status: 'active' }] });
  storeRefuses = true;
  const kept = await handleFormDelete(SITE, 'f0000000-0000-4000-8000-000000000001', {});
  ok('Delete: when the store refuses the files, the message stays and says so', kept.status === 502 && (await body(kept))?.error === 'files_kept' && subs().length === 2);
  storeRefuses = false;
  const gone = await handleFormDelete(SITE, 'f0000000-0000-4000-8000-000000000001', {});
  ok('Delete: the files go, then the message, and its follow-up nudge', gone.status === 200 && JSON.stringify(removed) === JSON.stringify([`forms/${SID}/a.jpg`]) && subs().length === 1 && db.tables.presence_plan_notices[0].status === 'dismissed');
  ok('Delete: another site’s message, or one already gone, is not found', (await handleFormDelete({ id: OTHER }, 'f0000000-0000-4000-8000-000000000002', {})).status === 404 && (await handleFormDelete(SITE, 'f0000000-0000-4000-8000-000000000001', {})).status === 404 && subs().length === 1);
}
{
  const day = 86_400_000, iso = (d) => new Date(Date.now() - d * day).toISOString();
  ok('Spam keeps a message 30 days, as the Inbox says', SPAM_KEEP_DAYS === 30 && SPAM_DAYS === 30);
  seed({ presence_form_submissions: [
    { id: 's-old-files', site_id: SID, spam: true, created_at: iso(31), fields: { __files: [{ size: 5, path: `forms/${SID}/old.jpg` }] } },
    { id: 's-old', site_id: SID, spam: true, created_at: iso(40), fields: {} },
    { id: 's-new', site_id: SID, spam: true, created_at: iso(5), fields: { __files: [{ size: 5, path: `forms/${SID}/new.jpg` }] } },
    { id: 'real-old', site_id: SID, spam: false, created_at: iso(200), fields: { __files: [{ size: 5, path: `forms/${SID}/real.jpg` }] } },
  ] });
  const out = await runRetentionSweep();
  ok('the retention sweep: Spam older than 30 days goes, with its files first', out.spam_messages === 2 && JSON.stringify(subs().map((s) => s.id).sort()) === JSON.stringify(['real-old', 's-new']) && JSON.stringify(removed) === JSON.stringify([`forms/${SID}/old.jpg`]), JSON.stringify(out));
  ok('…a real enquiry and newer spam are never touched', subs().some((s) => s.id === 'real-old') && subs().some((s) => s.id === 's-new'));
  seed({ presence_form_submissions: [{ id: 's-old-files', site_id: SID, spam: true, created_at: iso(31), fields: { __files: [{ size: 5, path: `forms/${SID}/old.jpg` }] } }] });
  storeRefuses = true;
  ok('…a store that refuses keeps that message for the next run, and the sweep says it failed', await clearOldSpam(iso(30)) === false && subs().length === 1);
  storeRefuses = false;
}

// ═══ C · the wiring ═══
{
  const idx = read('supabase/functions/presence/index.ts');
  ok('index: the join link’s two routes are public, beside the spam link', idx.includes("if (route === '/join' && method === 'GET') return handleJoinGet(req, cors);") && idx.includes("if (route === '/join' && method === 'POST') return handleJoinPost(req, cors);") && idx.indexOf("route === '/join'") < idx.indexOf('// 5. router'));
  ok('index: DELETE /forms/inbox/:id is the Inbox’s Delete', idx.includes("if (m && method === 'DELETE') return handleFormDelete(site, m[1], cors);"));
  const inbox = read('inbox.html');
  ok('Inbox: an enquiry’s Delete is marked for the delete capability and asks first, in place', inbox.includes('<button id="leadDel" class="quiet" data-needs="delete"') && inbox.includes('function askDeleteLead(it,btn)') && inbox.includes('Delete for good</button><button type="button" data-keep>Keep it</button>'));
  ok('Inbox: Spam says its messages go for good after 30 days, with any files', inbox.includes('After that it goes for good, with any files.'));
  const page = read('join.html');
  ok('join.html: asks before adding, then says so; no address in the page’s own words', page.includes("b.textContent='Yes, add me'") && page.includes("call('POST',{t:t})") && page.includes('You’re on the list. Thank you!') && page.includes('<meta name="robots" content="noindex,nofollow">') && page.includes('<meta name="referrer" content="no-referrer">'));
  const commercial = read('supabase/functions/presence/routes/commercial.ts');
  ok('the acknowledgement asks for the day’s reply before it sends', /if \(!auto\.auto_ack_enquiries\) return false;\n\s*\/\/ item 203[^\n]*\n\s*if \(await autoReplyVerdict\('enquiry', siteId, sub\.email\) !== 'send'\) return false;/.test(commercial));
}

const passed = results.filter(Boolean).length;
console.log(`\n════ ABUSE LIMITS (item 203): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
