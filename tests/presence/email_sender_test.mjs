// ── Sales items 74, 75 and 78: who an email is from, and how to stop it ──
//   deno run --allow-read --allow-env --allow-net tests/presence/email_sender_test.mjs
// Item 78: mail a business sends its own customers shows that business as the sender
// and its name and address in the footer, not the studio's. Item 75: every email an
// unsubscribe can stop carries a plain Unsubscribe link (the page on the app). Item 74:
// mail that always arrives (receipts, documents, sign-in links, a business's own alerts,
// payment reminders) carries no unsubscribe at all, the owner's enquiry, booking and
// review alerts and invoice reminders always arrive, "Start emails again" takes back an
// unsubscribe (never a bounce or a spam mark), and a person's record says when they
// unsubscribed. Part A is pure, B drives the one send point through a fetch fake, C the
// brand's address, D the unsubscribe route, E pins the call sites.
Deno.env.set('SUPABASE_URL', 'https://db.example');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('RESEND_KEY', 'test-resend-key');
Deno.env.set('EMAIL_FROM', 'Example Studio <hello@example.com>');
Deno.env.set('APP_URL', 'https://app.example');

const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const { fromFor, unsubscribable, sendEmail } = await import('../../supabase/functions/presence/commerce/account.ts');
const { brandEmailShell, emailFooterHtml, loadEmailBrand, EMAIL_BRAND_DEFAULT, PLATFORM_POSTAL } = await import('../../supabase/functions/presence/lib/email_brand.ts');
const { handleUnsubscribe, STILL_ARRIVES } = await import('../../supabase/functions/presence/routes/email_infra.ts');
const { unsubscribeToken } = await import('../../supabase/functions/_shared/email_infra.ts');

const SALON = { name: 'Bella’s Salon', accent: '#8c3b2e', accentDark: '#6e2e24', address: '120 Main St, Burbank, CA 91502' };

// ═══════════════════════ PART A · pure ═══════════════════════
ok('from: the business name with the platform address', fromFor('Example Studio <hello@example.com>', 'Bella’s Salon') === '"Bella’s Salon" <hello@example.com>');
ok('from: a bare sending address works too', fromFor('hello@example.com', 'Corner Café') === '"Corner Café" <hello@example.com>');
ok('from: quotes, angle brackets, line breaks and @ are dropped from the name',
  fromFor('Example Studio <hello@example.com>', 'Evil "x" <a@b.c>\r\nBcc: z@y.z') === '"Evil x a b.c Bcc: z y.z" <hello@example.com>', fromFor('Example Studio <hello@example.com>', 'Evil "x" <a@b.c>\r\nBcc: z@y.z'));
ok('from: a long name is cut to 70 characters', fromFor('S <hello@example.com>', 'A'.repeat(200)) === `"${'A'.repeat(70)}" <hello@example.com>`);
ok('from: no usable name keeps the platform sender as it is', fromFor('Example Studio <hello@example.com>', '') === 'Example Studio <hello@example.com>' && fromFor('Example Studio <hello@example.com>', ' "<>" ') === 'Example Studio <hello@example.com>');
ok('from: no address in the base keeps the base', fromFor('Example Studio', 'Bella') === 'Example Studio');
ok('unsubscribable: only mail an unsubscribe stops', unsubscribable() === true && unsubscribable({}) === true && unsubscribable({ critical: false }) === true && unsubscribable({ critical: true }) === false);

{
  const biz = emailFooterHtml(SALON, { asBusiness: true, unsubscribeUrl: 'https://app.example/unsubscribe.html?e=a&t=b' });
  ok('footer (business, optional mail): its name and address, then Unsubscribe', /Bella’s Salon<\/strong> · 120 Main St, Burbank, CA 91502/.test(biz) && /Don’t want these emails\? <a href="https:\/\/app\.example\/unsubscribe\.html\?e=a&amp;t=b"[^>]*>Unsubscribe<\/a>/.test(biz));
  ok('footer (business): nothing about the studio or Studio OS', !/Studio OS|Davis Digital Studio/.test(biz));
  const conf = emailFooterHtml(SALON, { asBusiness: true });
  ok('footer (business, always-arrives mail): name and address, no Unsubscribe', /Bella’s Salon/.test(conf) && /120 Main St/.test(conf) && !/Unsubscribe/.test(conf));
  const noAddr = emailFooterHtml({ ...SALON, address: '' }, { asBusiness: true, unsubscribeUrl: 'https://app.example/u' });
  ok('footer (business without an address, optional mail): the platform’s postal line stands in', noAddr.includes(`Sent through ${PLATFORM_POSTAL}`) && /Unsubscribe/.test(noAddr));
  ok('footer (business without an address, always-arrives mail): just the name', emailFooterHtml({ ...SALON, address: '' }, { asBusiness: true }) === '<strong style="color:#6b6478;font-weight:600">Bella’s Salon</strong>');
  const plat = emailFooterHtml(SALON, {});
  ok('footer (platform mail, e.g. an owner’s alert): sent by the business on Studio OS, the platform’s postal line, no Unsubscribe', plat === `Sent by Bella’s Salon on Studio OS.<br>${PLATFORM_POSTAL}`);
  ok('footer: the default brand reads "Sent by Studio OS."', emailFooterHtml(EMAIL_BRAND_DEFAULT, {}).startsWith('Sent by Studio OS.'));
  ok('footer: asBusiness with the default brand is platform mail', emailFooterHtml(EMAIL_BRAND_DEFAULT, { asBusiness: true }).startsWith('Sent by Studio OS.'));
  ok('footer: a link that is not https is never drawn', !/Unsubscribe/.test(emailFooterHtml(SALON, { unsubscribeUrl: 'javascript:alert(1)' })));
  const hostile = emailFooterHtml({ ...SALON, name: '<script>x</script>', address: '<img src=x>' }, { asBusiness: true, unsubscribeUrl: 'https://u.example/"><script>' });
  ok('footer: a hostile name, address or link is escaped', !/<script>|<img/.test(hostile) && /&lt;script&gt;/.test(hostile));
  const shell = brandEmailShell('<p>hi</p>', SALON, { asBusiness: true, unsubscribeUrl: 'https://app.example/u' });
  ok('shell: the footer rides in the one frame', shell.includes('120 Main St') && shell.includes('>Unsubscribe</a>'));
  ok('shell: the old "use the unsubscribe link in your email app" line is gone', !/unsubscribe link in your email app/.test(brandEmailShell('<p>hi</p>')));
  ok('shell: no options = platform footer, no Unsubscribe (as callers outside sendEmail had it)', !/Unsubscribe/.test(brandEmailShell('<p>hi</p>', SALON)) && brandEmailShell('<p>hi</p>', SALON).includes(PLATFORM_POSTAL));
}

// ═══════════════════════ PART B · the one send point ═══════════════════════
const sent = [];
let suppressed = null;
const reply = (body, status = 200) => Promise.resolve(new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
const fakeFetch = (input, init = {}) => {
  const u = decodeURIComponent(String(typeof input === 'string' ? input : input.url));
  if (u.startsWith('https://api.resend.com/emails')) { sent.push(JSON.parse(init.body)); return reply({ id: 'e' + sent.length }); }
  if (u.includes('/suppressed_emails')) return reply(suppressed ? [suppressed] : []);
  if (u.includes('/presence_settings?')) return reply([]);
  if (u.includes('/presence_identity?')) return reply([{ business_name: 'Bella’s Salon' }]);
  if (u.includes('/presence_locations?')) return reply([{ address_line1: '120 Main St', address_line2: '', city: 'Burbank', region: 'CA', postal_code: '91502' }]);
  return reply([]);
};
globalThis.fetch = fakeFetch;
const last = () => sent[sent.length - 1];
{
  await sendEmail('pat@customer.example', 'Our spring update', '<p>Hello</p>', SALON, { asBusiness: true, siteId: '11111111-1111-4111-8111-111111111111' });
  const m = last();
  ok('optional mail: the one-click header is there', /\/functions\/v1\/presence\/unsubscribe\?e=pat%40customer\.example&t=/.test(m.headers['List-Unsubscribe'] || '') && m.headers['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click');
  ok('optional mail: the footer links the page on the app', m.html.includes('https://app.example/unsubscribe.html?e=pat%40customer.example&amp;t=') && />Unsubscribe<\/a>/.test(m.html));
  ok('optional mail: the plain-text part ends with the same link', /\n\nUnsubscribe: https:\/\/app\.example\/unsubscribe\.html\?e=pat%40customer\.example&t=\S+$/.test(m.text));
  ok('a business’s mail to its customer: its name is the sender, on the platform’s address', m.from === '"Bella’s Salon" <hello@example.com>');
  ok('…and its footer names it with its address', m.html.includes('Bella’s Salon</strong> · 120 Main St, Burbank, CA 91502'));
}
{
  await sendEmail('pat@customer.example', 'Your booking is confirmed', '<p>Booked</p>', SALON, { critical: true, asBusiness: true, replyTo: 'owner@salon.example' });
  const m = last();
  ok('always-arrives mail: no one-click header', !('List-Unsubscribe' in m.headers) && !('List-Unsubscribe-Post' in m.headers));
  ok('always-arrives mail: no Unsubscribe link in the HTML or the text', !/Unsubscribe/i.test(m.html) && !/Unsubscribe/i.test(m.text));
  ok('always-arrives mail from a business is still from the business', m.from === '"Bella’s Salon" <hello@example.com>' && m.reply_to === 'owner@salon.example');
}
{
  await sendEmail('owner@salon.example', 'New booking — Haircut', '<p>New</p>', SALON, { critical: true });
  const m = last();
  ok('an owner’s alert keeps the platform as the sender (it is not the business writing to itself)', m.from === 'Example Studio <hello@example.com>');
  ok('…and the platform footer', m.html.includes('Sent by Bella’s Salon on Studio OS.') && m.html.includes(PLATFORM_POSTAL));
}
{
  await sendEmail('pat@customer.example', 'x', '<p>x</p>', undefined, { asBusiness: true });
  ok('asBusiness without a brand changes nothing', last().from === 'Example Studio <hello@example.com>');
  await sendEmail('pat@customer.example', 'x', '<p>x</p>', SALON, { headers: { 'Auto-Submitted': 'auto-replied' }, critical: true });
  ok('a caller’s own headers still go out on always-arrives mail', last().headers['Auto-Submitted'] === 'auto-replied' && !('List-Unsubscribe' in last().headers));
}
{
  const before = sent.length;
  suppressed = { reason: 'opt_out', created_at: '2026-11-03T18:00:00Z' };
  const a = await sendEmail('pat@customer.example', 'update', '<p>u</p>', SALON, { asBusiness: true });
  const b = await sendEmail('pat@customer.example', 'receipt', '<p>r</p>', SALON, { critical: true, asBusiness: true });
  suppressed = { reason: 'bounce', created_at: '2026-11-03T18:00:00Z' };
  const c = await sendEmail('pat@customer.example', 'receipt', '<p>r</p>', SALON, { critical: true });
  suppressed = null;
  ok('an unsubscribe stops optional mail, never always-arrives mail; a bounce stops both', a === false && b === true && c === false && sent.length === before + 1);
}

// ═══════════════════════ PART C · the brand’s address ═══════════════════════
{
  const b = await loadEmailBrand('11111111-1111-4111-8111-111111111111');
  ok('loadEmailBrand reads the Business details address onto one line', b.name === 'Bella’s Salon' && b.address === '120 Main St, Burbank, CA 91502', JSON.stringify(b));
  globalThis.fetch = (input, init) => String(input).includes('/presence_locations?') ? Promise.reject(new TypeError('down')) : fakeFetch(input, init);
  const c = await loadEmailBrand('11111111-1111-4111-8111-111111111111');
  ok('a failed address read still gives the brand, without an address', c.name === 'Bella’s Salon' && !c.address);
  globalThis.fetch = fakeFetch;
}

// ═══════════════════════ PART D · the unsubscribe route ═══════════════════════
{
  const E = 'pat@client.example', T = await unsubscribeToken(E);
  const q = `?e=${encodeURIComponent(E)}&t=${T}`;
  const w = { row: null, deletes: [], posts: [] };
  globalThis.fetch = (input, init = {}) => {
    const u = decodeURIComponent(String(input)), m = (init.method || 'GET').toUpperCase();
    if (!u.includes('/suppressed_emails')) return reply([]);
    if (m === 'POST') { w.posts.push(JSON.parse(init.body)); w.row = { reason: 'opt_out', created_at: '2026-11-03T18:00:00Z' }; return reply(null, 201); }
    if (m === 'DELETE') { w.deletes.push(u); if (u.includes('reason=eq.opt_out') && w.row?.reason === 'opt_out') w.row = null; return w.failDelete ? reply({}, 500) : reply(null, 204); }
    return reply(w.row ? [w.row] : []);
  };
  const ask = (method, extra = '', json = true) => handleUnsubscribe(new Request(`https://db.example/functions/v1/presence/unsubscribe${q}${extra}`, { method, headers: json ? { Accept: 'application/json' } : {} }), method);
  const g0 = await (await ask('GET')).json();
  ok('the page learns the link is good and nothing is stopped', g0.data.valid === true && g0.data.unsubscribed === false && g0.data.stopped === null && g0.data.still === STILL_ARRIVES);
  const p1 = await (await ask('POST')).json();
  ok('the page’s button unsubscribes and says what still arrives', p1.data.unsubscribed === true && w.posts.length === 1 && w.posts[0].reason === 'opt_out' && p1.data.still === STILL_ARRIVES);
  const g1 = await (await ask('GET')).json();
  ok('opening the link again says they are unsubscribed, and since when', g1.data.unsubscribed === true && g1.data.since === '2026-11-03T18:00:00Z');
  const r1 = await ask('POST', '&resume=1');
  ok('Start emails again takes back the unsubscribe', r1.status === 200 && (await r1.json()).data.unsubscribed === false && w.row === null);
  ok('…by deleting only an unsubscribe, never a bounce or a spam mark', w.deletes.length === 1 && /reason=eq\.opt_out/.test(w.deletes[0]) && /email=eq\.pat@client\.example/.test(w.deletes[0]));
  w.row = { reason: 'bounce', created_at: '2026-11-01T00:00:00Z' };
  const g2 = await (await ask('GET')).json();
  ok('a bounced address reads as stopped, not unsubscribed', g2.data.unsubscribed === false && g2.data.stopped === 'bounce');
  const r2 = await ask('POST', '&resume=1');
  const r2j = await r2.json();
  ok('a bounce can’t be started again from the page, and is left alone', r2.status === 409 && /couldn’t be delivered/.test(r2j.message) && w.row?.reason === 'bounce' && w.deletes.length === 1);
  w.row = { reason: 'complaint', created_at: '2026-11-01T00:00:00Z' };
  const r3 = await ask('POST', '&resume=1');
  ok('nor can a spam mark', r3.status === 409 && /marked as spam/.test((await r3.json()).message) && w.row?.reason === 'complaint');
  w.row = { reason: 'opt_out', created_at: '2026-11-03T18:00:00Z' };
  w.failDelete = true;
  const r4 = await ask('POST', '&resume=1');
  ok('a store that fails says so in a sentence', r4.status === 502 && /didn’t go through/.test((await r4.json()).message));
  w.failDelete = false;
  w.row = null; w.posts.length = 0;
  const one = await ask('POST', '&resume=1', false);
  ok('a mail client’s one-click POST never starts emails again: it unsubscribes', one.status === 200 && w.posts.length === 1 && w.posts[0].source === 'one_click' && w.row?.reason === 'opt_out');
  const badQ = `?e=${encodeURIComponent(E)}&t=nope`;
  const bad = await handleUnsubscribe(new Request(`https://db.example/functions/v1/presence/unsubscribe${badQ}&resume=1`, { method: 'POST', headers: { Accept: 'application/json' } }), 'POST');
  ok('a bad link starts nothing', bad.status === 400 && w.deletes.length === 2);
}

// ═══════════════════════ PART E · the call sites ═══════════════════════
const FN = new URL('../../supabase/functions/presence/', import.meta.url);
const src = (p) => Deno.readTextFileSync(new URL(p, FN));
// the whole sendEmail(...) call that follows `marker`, strings skipped so a ")" in copy never ends it
function callAfter(text, marker) {
  const at = text.indexOf(marker);
  if (at < 0) return '';
  const i = text.indexOf('sendEmail(', at);
  let j = i + 'sendEmail('.length, depth = 1, quote = null;
  for (; j < text.length && depth > 0; j++) {
    const ch = text[j];
    if (quote) { if (ch === '\\') { j++; continue; } if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '(') depth++; else if (ch === ')') depth--;
  }
  return text.slice(i, j);
}
const crit = (c) => /critical: true/.test(c);
const biz = (c) => /asBusiness: true/.test(c);
ok('item 74: the new enquiry alert always arrives', crit(callAfter(src('routes/commercial.ts'), 'async function notifyOwnerOfLead')));
ok('item 74: the new booking alert always arrives', crit(callAfter(src('routes/booking.ts'), "await sendEmail(String(to), `New booking")));
ok('item 74: the new review alert always arrives', crit(callAfter(src('routes/reviews.ts'), "await sendEmail(String(to), `New review")));
ok('item 74: a booking the customer moved or canceled always reaches the owner (item 149’s alert)', crit(callAfter(src('routes/booking.ts'), 'like a new booking, a moved or canceled one')));
ok('item 74: invoice reminders always arrive', crit(callAfter(src('commerce/lifecycle.ts'), 'const copy = invoiceReminderCopy(slot')));
ok('item 74: domain warnings always arrive (expiry, and a removed domain or lost email records)', crit(callAfter(src('commerce/lifecycle.ts'), 'BR-1: the customer\'s domain notice')) && crit(callAfter(src('lib/domain_notify.ts'), 'out.client =')));
ok('item 74: the alerts stay the platform’s (no business sender on mail to the owner)', !biz(callAfter(src('routes/booking.ts'), "await sendEmail(String(to), `New booking")) && !biz(callAfter(src('routes/commercial.ts'), 'async function notifyOwnerOfLead')));
ok('item 78: booking confirmation, cancellation and reminder come from the business', biz(callAfter(src('routes/booking.ts'), 'async function notifyCustomer')) && biz(callAfter(src('routes/booking.ts'), 'sales item 78: from the business, like the confirmation')) && biz(callAfter(src('commerce/lifecycle.ts'), 'sales item 78: the reminder comes from the business')));
ok('item 78: the review request, the enquiry answer and the emailed-reply answer come from the business', biz(callAfter(src('routes/reviews.ts'), 'export async function sendReviewAsk')) && biz(callAfter(src('routes/commercial.ts'), 'async function acknowledgeEnquiry')) && biz(callAfter(src('routes/inbound_email.ts'), 'async function ackSender')));
{
  const b = src('lib/broadcast.ts');
  ok('item 78: an update (and its test send) comes from the business that wrote it', /\{ siteId: b\.site_id, asBusiness: true \}\);\n    if \(ok\) sent\+\+;/.test(b) && /'\[Test\] ' \+ renderSubject[^\n]*\{ siteId: b\.site_id, asBusiness: true \}\);/.test(b));
}
{
  const page = Deno.readTextFileSync(new URL('../../unsubscribe.html', import.meta.url));
  ok('the page says the same "still arrives" sentence as the server', page.includes(`var STILL='${STILL_ARRIVES}'`));
  ok('the page offers Start emails again, through resume=1', page.includes("'Start emails again'") && page.includes("call('POST','&resume=1')"));
}
{
  const crm = src('routes/crm.ts');
  ok('item 74: the record header carries email_status from the suppression list', /const sup = await suppressionDetail\(em\)/.test(crm) && /email_status: \{ reason: sup\.reason, since: sup\.since \}/.test(crm));
  const page = Deno.readTextFileSync(new URL('../../crm.html', import.meta.url));
  ok('item 74: the record page draws it under the address', /const es=emailStatusWords\(hd\.email_status\);/.test(page) && /data-email-status/.test(page));
}

const passed = results.filter(Boolean).length;
console.log(`\n════ EMAIL SENDER + UNSUBSCRIBE (sales items 74, 75, 78): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
