// ── ROADMAP item 72: a site's customers reply to the business, not the platform ──
//   deno run --allow-read --allow-env --allow-net tests/presence/owner_reply_to_test.mjs
// Emails a client's website sends its OWN customers (the booking confirmation, the
// note when the owner confirms, the cancellation, the reminder, the review request,
// the enquiry acknowledgement) carried no site, so their Reply-To was the platform's
// mailbox: a salon's customer who answered "just reply to this email" reached the
// studio, not the salon. Part A pins sendEmail's Reply-To rule, Part B the owner
// lookup, Part C drives every one of those sends through a fetch fake and reads the
// Reply-To Resend was handed, and Part D proves mail to owners and the operator kept
// the platform's reply-to.
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

// ── env MUST be set before importing (module-load reads) ──
const SALON = '51000000-0000-4000-8000-000000000001';          // a client's website
const STUDIO = '57000000-0000-4000-8000-000000000002';         // the platform's own studio site
const OWNER = 'c1000000-0000-4000-8000-000000000001';          // the salon owner's clients row
const STUDIO_OWNER = 'c2000000-0000-4000-8000-000000000002';
const CUSTOMER = 'c3000000-0000-4000-8000-000000000003';       // a client of the salon (the review sweep's)
const TYPE = 'e1000000-0000-4000-8000-000000000001';
const APPT = 'a1000000-0000-4000-8000-000000000001';
const PROJECT = 'b2000000-0000-4000-8000-000000000001';
const INVOICE = 'f1000000-0000-4000-8000-000000000001';
const DEAL = 'd1000000-0000-4000-8000-000000000001';
const PAYER = 'b1000000-0000-4000-8000-000000000001';
const PLATFORM = 'platform@example.com';
const INBOUND = 'reply.example.com';
const SECRET = 'test-commerce-secret';
Deno.env.set('SUPABASE_URL', 'https://db.example');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('RESEND_KEY', 'test-resend-key');
Deno.env.set('RESEND_INBOUND_DOMAIN', INBOUND);
Deno.env.set('PLATFORM_REPLY_TO', PLATFORM);
Deno.env.set('AGENCY_SITE_ID', STUDIO);
Deno.env.set('OPS_ALERT_EMAIL', 'ops@example.com');
Deno.env.set('BILLING_SYNC_SECRET', SECRET);
Deno.env.set('SITE_URL', 'https://app.example.com');

const { replyToFor } = await import('../../supabase/functions/presence/commerce/account.ts');
const { ownerReplyTo, emailOperator } = await import('../../supabase/functions/presence/lib/service_bridge.ts');
const { handleBookingCreate, handleBookingConfirm, handleBookingCancel } = await import('../../supabase/functions/presence/routes/booking.ts');
const { handleReviewRequest } = await import('../../supabase/functions/presence/routes/reviews.ts');
const { handleFormSubmit } = await import('../../supabase/functions/presence/routes/commercial.ts');
const { runBookingReminders, runReviewRequests, daytimeIn } = await import('../../supabase/functions/presence/commerce/lifecycle.ts');
const { handleCommerce } = await import('../../supabase/functions/presence/routes/commerce.ts');

// ═══════════════════════ PART A · sendEmail's Reply-To rule ═══════════════════════
ok('rule: the owner’s address is the Reply-To', replyToFor({ replyTo: 'hello@salon.example' }) === 'hello@salon.example');
ok('rule: it wins over the site’s inbound address', replyToFor({ siteId: SALON, replyTo: 'hello@salon.example' }) === 'hello@salon.example');
ok('rule: it is trimmed', replyToFor({ replyTo: '  hello@salon.example  ' }) === 'hello@salon.example');
ok('rule: none given → the platform’s reply-to, as before', replyToFor() === PLATFORM && replyToFor({}) === PLATFORM && replyToFor({ replyTo: '' }) === PLATFORM && replyToFor({ replyTo: '   ' }) === PLATFORM);
ok('rule: none given with a site → that site’s inbound address, as before', replyToFor({ siteId: SALON }) === `${SALON}@${INBOUND}` && replyToFor({ siteId: SALON, replyTo: '' }) === `${SALON}@${INBOUND}`);
{
  const junk = ['a@salon.example, b@salon.example', 'a@salon.example,b@salon.example', 'Example Salon <hello@salon.example>', '<hello@salon.example>',
    'hello at salon', 'hello@salon', '@salon.example', 'hello@salon.example\r\nBcc: x@other.example', '"hello"@salon.example', 'hello;x@salon.example',
    `${'a'.repeat(250)}@salon.example`];
  const kept = junk.filter((j) => replyToFor({ replyTo: j }) !== PLATFORM);
  ok('rule: anything but one plain address is ignored (a list, a display name, spaces, a header break, too long)', kept.length === 0, JSON.stringify(kept));
  ok('rule: …and the site’s inbound address still stands behind it', junk.every((j) => replyToFor({ siteId: SALON, replyTo: j }) === `${SALON}@${INBOUND}`));
}
ok('rule: an inbound-domain address is never taken as an owner’s (any case)', replyToFor({ replyTo: `${STUDIO}@${INBOUND}` }) === PLATFORM && replyToFor({ replyTo: `${STUDIO}@REPLY.EXAMPLE.COM` }) === PLATFORM);
ok('rule: …so another site’s inbound address can’t be planted on this site’s mail', replyToFor({ siteId: SALON, replyTo: `${STUDIO}@${INBOUND}` }) === `${SALON}@${INBOUND}`);

// ═══════════════════════ the fake database + mail service ═══════════════════════
const DAY = 86400_000;
const ZONES = ['Pacific/Kiritimati', 'Pacific/Auckland', 'Asia/Tokyo', 'Asia/Kolkata', 'Asia/Dubai', 'Europe/Moscow', 'Europe/Berlin', 'Europe/London', 'Atlantic/Azores', 'America/Sao_Paulo', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Pacific/Honolulu', 'Pacific/Pago_Pago'];
const DAY_ZONE = ZONES.find((z) => daytimeIn(z, Date.now()));
const inDays = (d) => new Date(Date.now() + d * DAY);
const SLOT_DATE = inDays(3).toISOString().slice(0, 10);
const APPT_ROW = { id: APPT, site_id: SALON, type_id: TYPE, type_name: 'Haircut', slot_start_local: `${SLOT_DATE}T10:00`, duration_min: 30, price_cents: 4000, customer_name: 'Sam Rivera', customer_email: 'sam@customer.example', status: 'pending' };

/** cfg shapes the salon's owner address (identity card → the owner's clients row →
 *  its contact_email) and which reads fail. */
function world(cfg = {}) {
  const w = { emails: [], gets: [] };
  const identityEmail = cfg.identityEmail === undefined ? 'hello@salon.example' : cfg.identityEmail;
  const sites = { [SALON]: { id: SALON, client_id: OWNER }, [STUDIO]: { id: STUDIO, client_id: STUDIO_OWNER } };
  const identity = {
    [SALON]: { site_id: SALON, business_name: 'Example Salon', email: identityEmail },
    [STUDIO]: { site_id: STUDIO, business_name: 'Example Studio', email: cfg.studioIdentityEmail === undefined ? 'studio@example.com' : cfg.studioIdentityEmail },
  };
  const clients = {
    [OWNER]: { id: OWNER, name: 'Example Salon', email: cfg.ownerEmail === undefined ? 'owner@salon.example' : cfg.ownerEmail, contact_email: cfg.ownerContactEmail === undefined ? 'desk@salon.example' : cfg.ownerContactEmail },
    [STUDIO_OWNER]: { id: STUDIO_OWNER, name: 'Example Studio', email: cfg.studioOwnerEmail === undefined ? 'founder@example.com' : cfg.studioOwnerEmail, contact_email: '' },
    [CUSTOMER]: { id: CUSTOMER, name: 'Pat', email: 'pat@customer.example', contact_email: '' },
  };
  const reply = (body, status = 200) => new Response(body === null ? '' : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const ids = (u, col) => {
    const list = u.match(new RegExp(`[?&]${col}=in\\.\\(([^)]*)\\)`));
    if (list) return list[1].split(',').map((x) => x.replace(/"/g, ''));
    const one = u.match(new RegExp(`[?&]${col}=eq\\.([^&]+)`));
    return one ? [one[1]] : [];
  };
  let n = 0;
  globalThis.fetch = async (input, init = {}) => {
    const u = decodeURIComponent(String(typeof input === 'string' ? input : input.url));
    const m = (init.method || 'GET').toUpperCase();
    if (u.startsWith('https://api.resend.com/emails')) { w.emails.push(JSON.parse(init.body)); return reply({ id: `e${w.emails.length}` }); }
    if (!u.startsWith('https://db.example/rest/v1/')) return reply({}, 404);
    const path = u.slice('https://db.example/rest/v1/'.length);
    if (m === 'GET') w.gets.push(path);
    if (path.startsWith('rpc/rate_hit')) return reply(true);
    if (path.startsWith('suppressed_emails')) return reply([]);
    if (path.startsWith('presence_sites?')) {
      if (cfg.ownerLookupFails && /select=client_id&limit=1$/.test(path)) throw new TypeError('network down');
      return reply(ids(path, 'id').map((id) => sites[id]).filter(Boolean));
    }
    if (path.startsWith('presence_identity?')) return reply(ids(path, 'site_id').map((id) => identity[id]).filter(Boolean));
    if (path.startsWith('clients?')) return reply(ids(path, 'id').map((id) => clients[id]).filter(Boolean));
    if (path.startsWith('presence_settings?review_requests=is.true')) return reply([{ site_id: SALON, review_request_after_days: 3 }]);
    if (path.startsWith('presence_settings?') && path.includes('auto_ack_enquiries')) return reply([{ auto_ack_enquiries: true }]);
    if (path.startsWith('presence_settings?')) return reply([]);   // no brand kit
    if (path.startsWith('presence_booking_settings?')) {
      return reply([{ site_id: SALON, enabled: true, weekly: Array.from({ length: 7 }, () => [{ start: '08:00', end: '18:00' }]), slot_interval_min: 30, buffer_min: 0, lead_time_hours: 0, max_days_ahead: 60, timezone: 'UTC', auto_confirm: true }]);
    }
    if (path.startsWith('presence_appointment_types?')) return reply([{ id: TYPE, name: 'Haircut', duration_min: 30, price_cents: 4000, description: '', sort_order: 0 }]);
    if (path.startsWith('presence_appointments') && m === 'POST') return reply([{ id: APPT, ...JSON.parse(init.body) }], 201);
    if (path.startsWith('presence_appointments?') && m === 'PATCH') return reply([{ ...APPT_ROW, ...JSON.parse(init.body) }]);
    if (path.startsWith('presence_appointments?status=eq.confirmed')) return reply(cfg.reminders || []);
    if (path.startsWith('presence_contacts') && m === 'POST') return reply([{ id: 'contact-1' }], 201);
    if (path.startsWith(`presence_contacts?id=eq.${PAYER}`)) return reply([{ name: 'Jordan Lee', email: 'payer@customer.example' }]);
    if (path.startsWith('presence_plan_notices') && m === 'POST') { const row = JSON.parse(init.body); return reply([{ id: `n${++n}`, ...row }], 201); }
    if (path.startsWith('presence_invoices?')) return reply([{ id: INVOICE, site_id: SALON, deal_id: DEAL, title: 'Deposit', amount_cents: 5000, purpose: 'deposit' }]);
    if (path.startsWith('presence_deals?')) return reply([{ id: DEAL, title: 'Spring package', contact_id: PAYER, converted_client_id: null }]);
    if (path.startsWith('presence_project_events?')) return reply([{ project_id: PROJECT, site_id: SALON, detail: { from: 'active', to: 'complete' }, created_at: inDays(-4).toISOString() }]);
    if (path.startsWith('presence_locations?')) return reply([{ site_id: SALON, timezone: DAY_ZONE }]);
    if (path.startsWith('presence_projects?')) return reply([{ id: PROJECT, site_id: SALON, name: 'Color', status: 'complete', client_id: CUSTOMER }]);
    return reply(m === 'POST' ? null : [], m === 'POST' ? 201 : 200);   // notices read, form submissions, tasks, pushes: nothing on file
  };
  return w;
}
const realFetch = globalThis.fetch;
/** The fire-and-forget sends finish after the handler answers — wait for them. */
async function settle(w, count, ms = 3000) {
  const end = Date.now() + ms;
  while (w.emails.length < count && Date.now() < end) await new Promise((r) => setTimeout(r, 5));
  await new Promise((r) => setTimeout(r, 30));   // and let any extra (wrong) send land too
  return w.emails;
}
const to = (e) => (Array.isArray(e?.to) ? e.to[0] : e?.to);
const sentTo = (w, addr) => w.emails.filter((e) => to(e) === addr);
const SITE = { id: SALON };
const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

try {
  // ═══════════════════════ PART B · whose address it is ═══════════════════════
  world();
  ok('owner: the identity card’s email comes first', (await ownerReplyTo(SALON)) === 'hello@salon.example');
  world({ identityEmail: '' });
  ok('owner: no identity email → the owner’s own account email', (await ownerReplyTo(SALON)) === 'owner@salon.example');
  world({ identityEmail: '', ownerEmail: '' });
  ok('owner: …then the account’s contact email', (await ownerReplyTo(SALON)) === 'desk@salon.example');
  world({ identityEmail: '', ownerEmail: '', ownerContactEmail: '' });
  ok('owner: a client’s site with no address at all → "" (never the platform operator’s alert address)', (await ownerReplyTo(SALON)) === '');
  world({ studioIdentityEmail: '', studioOwnerEmail: '' });
  ok('owner: only the platform’s own site has that last rung (it is the operator’s own site)', (await ownerReplyTo(STUDIO)) === 'ops@example.com');
  world({ ownerLookupFails: true });
  ok('owner: a failed read → "" and no throw', (await ownerReplyTo(SALON).catch(() => 'threw')) === '');
  ok('owner: no site → ""', (await ownerReplyTo('')) === '');

  // ═══════════ PART C · every customer-facing send carries the owner's address ═══════════
  // the public booking: the confirmation to the booker, plus the owner's "New booking" alert
  {
    const w = world();
    const r = await handleBookingCreate(new Request(`https://fn.example/book/${SALON}`, json({ type_id: TYPE, slot_start: `${SLOT_DATE}T10:00`, name: 'Sam Rivera', email: 'sam@customer.example' })), SALON, {});
    const out = await r.json();
    await settle(w, 2);
    const conf = sentTo(w, 'sam@customer.example');
    ok('booking: the booking goes through', r.status === 200 && out.data?.status === 'confirmed', `${r.status} ${JSON.stringify(out)}`);
    ok('booking: the confirmation’s Reply-To is the salon’s own email', conf.length === 1 && conf[0].reply_to === 'hello@salon.example', JSON.stringify(conf.map((e) => e.reply_to)));
    ok('booking: …and it still says "just reply to this email"', /Just reply to this email/.test(String(conf[0]?.html || '')));
    const alert = sentTo(w, 'hello@salon.example');
    ok('booking: the owner’s own "New booking" alert keeps the platform’s reply-to', alert.length === 1 && /^New booking/.test(alert[0].subject) && alert[0].reply_to === PLATFORM, JSON.stringify(alert.map((e) => [e.subject, e.reply_to])));
    ok('booking: nothing in this flow replies to the platform but the owner’s own alert', w.emails.filter((e) => e.reply_to === PLATFORM).length === 1);
  }
  // the owner confirms a pending booking → the booker hears, and their reply reaches the salon
  {
    const w = world({ identityEmail: '' });
    const r = await handleBookingConfirm(SITE, APPT, {}, {});
    await settle(w, 1);
    const e = sentTo(w, 'sam@customer.example');
    ok('confirm: the "your booking is confirmed" note replies to the owner (identity blank → their account email)', r.status === 200 && e.length === 1 && /confirmed/.test(e[0].subject) && e[0].reply_to === 'owner@salon.example', JSON.stringify(e.map((x) => x.reply_to)));
  }
  // the owner cancels
  {
    const w = world();
    const r = await handleBookingCancel(new Request('https://fn.example/x', json({ reason: 'We are closed that day.' })), SITE, APPT, {}, {});
    await settle(w, 1);
    const e = sentTo(w, 'sam@customer.example');
    ok('cancel: the cancellation replies to the salon', r.status === 200 && e.length === 1 && /^Booking canceled/.test(e[0].subject) && e[0].reply_to === 'hello@salon.example', JSON.stringify(e.map((x) => x.reply_to)));
  }
  // the reminder sweep: two appointments at the salon, one at the studio's own site
  {
    const slot = inDays(20 / 24);
    const appt = (id, site, email) => ({ id, site_id: site, type_name: 'Haircut', slot_start: slot.toISOString(), slot_start_local: slot.toISOString().slice(0, 16), price_cents: 4000, customer_name: 'Sam Rivera', customer_email: email });
    const w = world({ reminders: [
      appt('a2000000-0000-4000-8000-000000000001', SALON, 'sam@customer.example'),
      appt('a2000000-0000-4000-8000-000000000002', SALON, 'kim@customer.example'),
      appt('a2000000-0000-4000-8000-000000000003', STUDIO, 'lee@customer.example'),
    ] });
    const r = await runBookingReminders(50);
    const by = (addr) => sentTo(w, addr)[0];
    ok('reminder: every reminder went out', r.reminded === 3 && w.emails.length === 3, JSON.stringify({ reminded: r.reminded, emails: w.emails.length }));
    ok('reminder: the salon’s two customers reply to the salon', by('sam@customer.example')?.reply_to === 'hello@salon.example' && by('kim@customer.example')?.reply_to === 'hello@salon.example');
    ok('reminder: the studio’s own customer replies to the studio’s own address', by('lee@customer.example')?.reply_to === 'studio@example.com');
    const ownerReads = w.gets.filter((p) => p.startsWith(`presence_identity?site_id=eq.${SALON}&select=business_name,email`)).length;
    ok('reminder: the salon’s owner address is read once, not once per appointment', ownerReads === 1, `read ${ownerReads}×`);
  }
  // the hand-sent review request
  {
    const w = world();
    const r = await handleReviewRequest(new Request('https://fn.example/reviews/request', json({ email: 'sam@customer.example', name: 'Sam' })), SITE, {}, {});
    const e = sentTo(w, 'sam@customer.example');
    ok('review ask: "How was your experience …?" replies to the salon', r.status === 200 && e.length === 1 && /^How was your experience with Example Salon\?$/.test(e[0].subject) && e[0].reply_to === 'hello@salon.example', JSON.stringify(e.map((x) => [x.subject, x.reply_to])));
  }
  // the automatic review request after a finished project
  {
    const w = world({ identityEmail: '' });
    const r = await runReviewRequests(20);
    const e = sentTo(w, 'pat@customer.example');
    ok('review sweep: the automatic ask replies to the owner (identity blank → their account email)', r.asked === 1 && e.length === 1 && e[0].reply_to === 'owner@salon.example', JSON.stringify({ asked: r.asked, reply: e.map((x) => x.reply_to) }));
    const count = (t) => w.gets.filter((p) => p.startsWith(`${t}?`)).length;
    ok('review sweep: projects, clients and site owners are still one read each (item 90)', count('presence_projects') === 1 && count('clients') === 1 && count('presence_sites') === 1, JSON.stringify({ projects: count('presence_projects'), clients: count('clients'), sites: count('presence_sites') }));
    ok('review sweep: the identity cards are one read for every site too', w.gets.filter((p) => p.startsWith('presence_identity?site_id=in.(')).length === 1 && !w.gets.some((p) => /presence_identity\?site_id=eq\.[^&]+&select=business_name,email/.test(p)));
  }
  {
    const w = world();
    await runReviewRequests(20);
    ok('review sweep: with an identity email, that is the reply-to', sentTo(w, 'pat@customer.example')[0]?.reply_to === 'hello@salon.example');
  }
  // the enquiry acknowledgement (the site's "we got your message", when switched on)
  {
    const w = world();
    const r = await handleFormSubmit(new Request(`https://fn.example/forms/${SALON}`, json({ name: 'Sam Rivera', email: 'sam@customer.example', message: 'Do you do weddings?' })), SALON, {});
    await settle(w, 2);
    const ack = sentTo(w, 'sam@customer.example');
    ok('enquiry: the acknowledgement replies to the salon, not the inbound door that drops strangers', r.status === 200 && ack.length === 1 && ack[0].reply_to === 'hello@salon.example', JSON.stringify(ack.map((x) => x.reply_to)));
    const alert = sentTo(w, 'hello@salon.example');
    ok('enquiry: the owner’s "New contact from your website" alert keeps the platform’s reply-to', alert.length === 1 && alert[0].reply_to === PLATFORM, JSON.stringify(alert.map((x) => [x.subject, x.reply_to])));
  }
  // the payment receipt: the payer is the deal's own contact, so it answers into the Inbox
  {
    const w = world();
    const PRINCIPAL = { kind: 'public', userId: null, tenantId: null, role: null, email: null, jwt: null, requestId: 't' };
    const r = await handleCommerce(new Request('https://fn.example/commerce/invoice-paid', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-commerce-secret': SECRET }, body: JSON.stringify({ invoice_id: INVOICE }) }), '/commerce/invoice-paid', 'POST', PRINCIPAL, {});
    const out = await r.json();
    const receipt = sentTo(w, 'payer@customer.example');
    ok('receipt: the payer’s receipt answers into that site’s Inbox (their contact is on file)', out.data?.receipted === true && receipt.length === 1 && receipt[0].reply_to === `${SALON}@${INBOUND}`, JSON.stringify({ receipted: out.data?.receipted, reply: receipt.map((x) => x.reply_to) }));
    const op = sentTo(w, 'hello@salon.example');
    ok('receipt: the owner’s "Deposit received" email keeps the platform’s reply-to', op.length === 1 && /^Deposit received/.test(op[0].subject) && op[0].reply_to === PLATFORM, JSON.stringify(op.map((x) => [x.subject, x.reply_to])));
  }

  // ═══════════ falling back: today's behaviour when there is no usable owner address ═══════════
  {
    const w = world({ identityEmail: '', ownerEmail: '', ownerContactEmail: '' });
    await handleBookingConfirm(SITE, APPT, {}, {});
    await settle(w, 1);
    const e = sentTo(w, 'sam@customer.example');
    ok('fallback: no owner address → the confirmation still goes, with the platform’s reply-to as before', e.length === 1 && e[0].reply_to === PLATFORM);
  }
  {
    const w = world({ identityEmail: 'hello at the salon' });
    await handleBookingConfirm(SITE, APPT, {}, {});
    await settle(w, 1);
    const e = sentTo(w, 'sam@customer.example');
    ok('fallback: a badly typed identity email can’t stop the confirmation (platform reply-to)', e.length === 1 && e[0].reply_to === PLATFORM);
  }
  {
    const w = world({ ownerLookupFails: true });
    await handleBookingConfirm(SITE, APPT, {}, {});
    await settle(w, 1);
    const e = sentTo(w, 'sam@customer.example');
    ok('fallback: a failed owner lookup can’t stop the confirmation either', e.length === 1 && e[0].reply_to === PLATFORM);
  }

  // ═══════════ PART D · operator mail is exactly as it was ═══════════
  {
    const w = world();
    const sent = await emailOperator(SALON, 'Something happened', '<p>Details</p>', 'test');
    ok('operator: an operator email goes to the owner and keeps the platform’s reply-to (never their own address, never the inbound door)', sent === true && w.emails.length === 1 && to(w.emails[0]) === 'hello@salon.example' && w.emails[0].reply_to === PLATFORM);
  }
  {
    const read = (p) => Deno.readTextFileSync(new URL(`../../${p}`, import.meta.url));
    const bridge = read('supabase/functions/presence/lib/service_bridge.ts');
    const operatorSends = [...bridge.matchAll(/sendEmail\(to, [^\n]*\{ critical: true[^}]*\}\)/g)].map((x) => x[0]);
    ok('operator: the two operator sends in service_bridge.ts carry neither siteId nor replyTo', operatorSends.length === 2 && operatorSends.every((s) => !/siteId|replyTo/.test(s)), JSON.stringify(operatorSends));
  }
} finally {
  globalThis.fetch = realFetch;
}

const passed = results.filter(Boolean).length;
console.log(`\n════ OWNER REPLY-TO (item 72): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
