// ── Recurring invoices (sales review item 47, Nov 2026): the real routes ─────
// A fresh invoice with its own pay link on a schedule, which the client pays
// themselves (a retainer charges a card; both stay). As Eric chose it on Nov 8:
// Start on the deal (a first date of today goes out right away); each one goes
// on its own around 9 am the studio's time, due 14 days later, named for its
// month; a heads-up under Updates three days before; Pause, Resume, Skip this
// one, Change and Stop; it pauses itself, in Needs you, when the last two are
// unpaid or the contact has no email. Nothing is ever billed or emailed twice.
// Real handlers against the shared in-memory PostgREST, Stripe and Resend faked;
// all names are made up.
//   deno run --allow-read --allow-env --allow-net tests/presence/recurring_routes_test.mjs
Deno.env.set('APPROVAL_SECRET', 'sign-secret-for-tests-0123456789abcdef');
Deno.env.set('RESEND_KEY', 'test-resend-key');
Deno.env.set('EMAIL_FROM', 'Example Studio <hello@example.com>');
Deno.env.set('SITE_URL', 'https://app.example.com');
Deno.env.set('RESEND_INBOUND_DOMAIN', 'reply.example.com');
Deno.env.set('STRIPE_SECRET', 'sk_test_fake');
import { installFakePostgrest } from './fake_pgrst.mjs';
const uuid = (c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const SITE = uuid('1'), OWNER = uuid('2'), U = uuid('3'), CT = uuid('4'), DEAL = uuid('5'), S1 = uuid('6'), S2 = uuid('7'), CUST = uuid('8'), CUST_SITE = uuid('9'), OTHER = uuid('a');
const db = installFakePostgrest({ users: { 'jwt-owner': { id: U, email: 'owner@example.com' } }, ownSite: { 'jwt-owner': SITE },
  unique: { presence_invoices: [{ cols: ['recurring_id', 'recurring_on'], where: (r) => !!r.recurring_id }] } });
// the outside world: Resend and Stripe answer, and keep what they were given
const pg = globalThis.fetch;
const mail = [], stripe = [];
let stripeDown = false;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const j = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  if (u.hostname === 'api.resend.com') { mail.push(JSON.parse(String(init.body || '{}'))); return j({ id: `em_${mail.length}` }); }
  if (u.hostname === 'api.stripe.com') {
    const p = Object.fromEntries(new URLSearchParams(String(init.body || '')));
    stripe.push({ path: u.pathname, params: p, idem: new Headers(init.headers).get('Idempotency-Key') });
    if (stripeDown) return j({ error: { message: 'Stripe is having a moment' } }, 500);
    if (u.pathname === '/v1/prices') return j({ id: `price_${stripe.length}` });
    if (u.pathname === '/v1/payment_links') return j({ id: `plink_${p['metadata[presence_invoice_id]']}`, url: `https://pay.example.test/${p['metadata[presence_invoice_id]']}` });
    return j({});
  }
  return pg(url, init);
};
const RI = await import('../../supabase/functions/presence/routes/recurring_invoices.ts');
const R = await import('../../supabase/functions/presence/lib/recurring_invoices.ts');

let pass = 0, fail = 0;
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; console.log('FAIL ', n, note); } };
const cors = {};
const site = { id: SITE, client_id: OWNER, status: 'live', edition: 'presence' };
const owner = { kind: 'client', userId: U, email: 'owner@example.com', jwt: 'jwt-owner', requestId: 't' };
const req = (method, path, body) => new Request(`https://fn.test/functions/v1/presence${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const res = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const TODAY = R.localClock('', Date.now()).ymd;   // the studio has no location row → Pacific, like the routes
const day = (n) => R.addDays(TODAY, n);
const events = (kind) => (db.tables.presence_deal_events || []).filter((e) => !kind || e.kind === kind);
const recEvents = (action) => events('recurring_invoice').filter((e) => !action || e.detail.action === action);
const notices = (kind) => (db.tables.presence_plan_notices || []).filter((n) => !kind || n.kind === kind);
const invoices = () => db.tables.presence_invoices || [];
const sched = (id = S1) => (db.tables.presence_recurring_invoices || []).find((s) => s.id === id);
const schedule = (over = {}) => ({ id: S1, site_id: SITE, deal_id: DEAL, title: 'Website care', amount_cents: 50000, currency: 'usd', every: 'month', anchor_day: Number(day(-1).slice(8)), next_on: day(-1), due_days: 14, times: null, sent_count: 0, status: 'active', paused_reason: '', resumed_at: null, deleted_at: null, ...over });
const world = (extra = {}) => {
  db.reset({
    presence_sites: [{ id: SITE, client_id: OWNER }],
    presence_deals: [{ id: DEAL, site_id: SITE, title: 'Blue Finch Café website', stage: 'won', contact_id: CT, expected_value_cents: 600000, converted_client_id: CUST, converted_site_id: CUST_SITE, deleted_at: null }],
    presence_contacts: [{ id: CT, site_id: SITE, name: 'Riley Park', email: 'riley@example.org', company: 'Blue Finch Café' }],
    ...extra,
  });
  mail.length = 0; stripe.length = 0; stripeDown = false;
};
const before0145 = (fn) => async (...a) => {
  const fake = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (/\/rest\/v1\/presence_recurring_invoices/.test(decodeURIComponent(String(url)))) return new Response(JSON.stringify({ code: 'PGRST205', message: "Could not find the table 'public.presence_recurring_invoices' in the schema cache" }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    return fake(url, init);
  };
  try { return await fn(...a); } finally { globalThis.fetch = fake; }
};
const start = (body) => RI.handleRecurringStart(req('POST', `/sales/deals/${DEAL}/recurring`, body), site, owner, DEAL, cors).then(res);
const act = (id, a) => RI.handleRecurringAction(req('POST', `/sales/recurring/${id}/${a}`, {}), site, owner, id, a, cors).then(res);
const change = (id, body) => RI.handleRecurringChange(req('PATCH', `/sales/recurring/${id}`, body), site, owner, id, cors).then(res);

// ═══ 1. Start, with a first date ahead ═══
{
  world();
  const r = await start({ title: 'Website care', amount_cents: 50000, every: 'month', first_on: day(10), times: '' });
  const s = (db.tables.presence_recurring_invoices || [])[0];
  ok('1: started: active, its first date, the day it repeats on, due in 14 days', r.status === 201 && s && s.status === 'active' && s.next_on === day(10) && s.anchor_day === Number(day(10).slice(8)) && s.due_days === 14 && s.times === null && s.sent_count === 0 && s.amount_cents === 50000 && s.every === 'month', JSON.stringify(r.body));
  ok('1: on this studio and deal, with who started it', s.site_id === SITE && s.deal_id === DEAL && s.created_by === 'owner@example.com');
  ok('1: the deal says so', recEvents('started').length === 1 && recEvents('started')[0].detail.title === 'Website care' && recEvents('started')[0].detail.on === day(10) && recEvents('started')[0].detail.amount_cents === 50000);
  ok('1: nothing billed or emailed yet', invoices().length === 0 && mail.length === 0 && stripe.length === 0 && r.body.data.sent === null);
  const twin = await start({ title: 'Website care', amount_cents: 50000, every: 'month', first_on: day(12) });
  ok('1: the same one twice (a double-tap) is refused', twin.status === 409 && twin.body.error === 'exists' && db.tables.presence_recurring_invoices.length === 1);
  const second = await start({ title: 'Hosting', amount_cents: 3000, every: 'year', first_on: day(20), times: 3 });
  ok('1: a different one on the same deal is fine (hosting beside care)', second.status === 201 && db.tables.presence_recurring_invoices.length === 2 && second.body.data.recurring.times === 3);
  const bad = await start({ title: '', amount_cents: 50000, every: 'month', first_on: day(10) });
  ok('1: what it\'s for is needed', bad.status === 422 && /what it’s for/.test(bad.body.message));
  const past = await start({ title: 'Care', amount_cents: 50000, every: 'month', first_on: day(-1) });
  ok('1: a first date in the past is refused', past.status === 422 && /from today on/.test(past.body.message));
  world({ presence_contacts: [{ id: CT, site_id: SITE, name: 'Riley Park', email: '', company: 'Blue Finch Café' }] });
  const noEmail = await start({ title: 'Care', amount_cents: 50000, every: 'month', first_on: day(10) });
  ok('1: no client email on the deal → it says to add one first', noEmail.status === 422 && noEmail.body.error === 'no_email' && !(db.tables.presence_recurring_invoices || []).length);
  world();
  const early = await before0145(() => start({ title: 'Care', amount_cents: 50000, every: 'month', first_on: day(10) }))();
  ok('1: before the database step it says so, plainly', early.status === 503 && /one-time database update/.test(early.body.message), JSON.stringify(early.body));
}

// ═══ 2. Start with today: the first one goes right away ═══
{
  world();
  const r = await start({ title: 'Website care', amount_cents: 50000, every: 'month', first_on: TODAY });
  const v = invoices()[0];
  const s = db.tables.presence_recurring_invoices[0];
  ok('2: the first invoice went out at once', r.status === 201 && r.body.data.sent?.result === 'sent' && r.body.data.sent?.emailed === true && invoices().length === 1, JSON.stringify(r.body));
  ok('2: named for its month, the amount, open, due in 14 days', v.title === R.recurringInvoiceTitle('Website care', TODAY) && v.amount_cents === 50000 && v.status === 'open' && v.purpose === 'service' && v.due_date === day(14));
  ok('2: it belongs to the schedule and the date (the send-once key)', v.recurring_id === s.id && v.recurring_on === TODAY);
  ok('2: their portal shows it (a customer\'s deal)', v.customer_client_id === CUST && v.customer_site_id === CUST_SITE);
  ok('2: its own pay link, for this invoice', v.stripe_url === `https://pay.example.test/${v.id}` && stripe.filter((x) => x.path === '/v1/payment_links').length === 1 && stripe.find((x) => x.path === '/v1/payment_links').idem === `plink-${v.id}`);
  const m = mail[0];
  ok('2: one email to the client, the usual invoice email', mail.length === 1 && m.to === 'riley@example.org' && m.subject === `${v.title} — $500.00` && /Pay \$500\.00 securely/.test(m.html) && m.html.includes(`https://pay.example.test/${v.id}`));
  ok('2: it says which invoice it is and when it\'s due', m.html.includes(`This is your monthly invoice for Website care. It’s due ${R.dayLabel(day(14))}.`), m.html.slice(0, 400));
  ok('2: their reply comes back to the Inbox', m.reply_to === `${SITE}@reply.example.com`);
  const sent = events('invoice_sent')[0];
  ok('2: the deal says "Recurring invoice sent"', sent && sent.detail.recurring_id === s.id && sent.detail.amount_cents === 50000 && sent.detail.period === R.monthLabel(TODAY) && sent.actor_kind === 'system');
  ok('2: the schedule moved to next month, same day', s.next_on === R.nextOccurrence(TODAY, Number(TODAY.slice(8)), 'month') && s.sent_count === 1 && s.status === 'active');
}

// ═══ 3. the sweep ═══
{
  world({ presence_recurring_invoices: [schedule(), schedule({ id: S2, title: 'Hosting', amount_cents: 3000, next_on: day(2), anchor_day: Number(day(2).slice(8)) })] });
  const out = await RI.runRecurringInvoices(20);
  ok('3: a date that went by is sent; one three days or less out gets its heads-up', out.sent === 1 && out.heads_up === 1 && out.paused === 0 && out.failed === 0, JSON.stringify(out));
  ok('3: one invoice, one email, for the due one only', invoices().length === 1 && invoices()[0].recurring_id === S1 && mail.length === 1);
  const h = notices('invoice_upcoming')[0];
  ok('3: the heads-up names the date, what, who and how much', h && h.period === `recurnext:${DEAL}:${S2}:${day(2)}` && h.status === 'active' && h.client_id === OWNER && h.headline === R.headsUpCopy({ title: 'Hosting', on: day(2), amount_cents: 3000, who: 'Blue Finch Café' }).headline, JSON.stringify(h));
  const again = await RI.runRecurringInvoices(20);
  ok('3: the next tick sends nothing twice and raises no second heads-up', again.sent === 0 && again.heads_up === 0 && invoices().length === 1 && mail.length === 1 && notices('invoice_upcoming').length === 1);
  world({ presence_recurring_invoices: [schedule({ status: 'paused', paused_reason: 'manual' }), schedule({ id: S2, status: 'stopped', next_on: null })] });
  const quiet = await RI.runRecurringInvoices(20);
  ok('3: paused and stopped ones are left alone', quiet.sent === 0 && quiet.heads_up === 0 && invoices().length === 0);
  world({ presence_recurring_invoices: [schedule({ next_on: day(5) })] });
  ok('3: a date further out is left alone', (await RI.runRecurringInvoices(20)).heads_up === 0 && notices().length === 0);
  world({ presence_recurring_invoices: [schedule()] });
  const early = await before0145(() => RI.runRecurringInvoices(20))();
  ok('3: before the database step the sweep is a clean no-op', JSON.stringify(early) === JSON.stringify({ sent: 0, paused: 0, heads_up: 0, failed: 0 }) && invoices().length === 0);
}

// ═══ 4. nothing is ever billed or emailed twice ═══
{
  // a: the invoice was made but its link wasn't (a crash): the next tick finishes it
  world({ presence_recurring_invoices: [schedule()], presence_invoices: [{ id: uuid('b'), site_id: SITE, deal_id: DEAL, title: 'Website care — X', description: 'd', amount_cents: 50000, status: 'open', purpose: 'service', recurring_id: S1, recurring_on: day(-1), due_date: day(13), stripe_url: null }] });
  await RI.runRecurringInvoices(20);
  ok('4a: it finishes THAT invoice — link, one email — and moves on', invoices().length === 1 && invoices()[0].stripe_url && mail.length === 1 && sched().next_on > TODAY && sched().sent_count === 1);
  // b: it was sent but the schedule didn't move: only the move happens
  world({ presence_recurring_invoices: [schedule()], presence_invoices: [{ id: uuid('b'), site_id: SITE, deal_id: DEAL, title: 'Website care — X', amount_cents: 50000, status: 'open', purpose: 'service', recurring_id: S1, recurring_on: day(-1), due_date: day(13), stripe_url: 'https://pay.example.test/b' }] });
  await RI.runRecurringInvoices(20);
  ok('4b: already sent → no second email, no second link, just the next date', mail.length === 0 && stripe.length === 0 && invoices().length === 1 && sched().next_on > TODAY);
  // c: two ticks race: one's read misses the invoice the other just made
  world({ presence_recurring_invoices: [schedule()], presence_invoices: [{ id: uuid('b'), site_id: SITE, deal_id: DEAL, title: 'Website care — X', description: 'd', amount_cents: 50000, status: 'open', purpose: 'service', recurring_id: S1, recurring_on: day(-1), due_date: day(13), stripe_url: null }] });
  const fake = globalThis.fetch; let missed = false;
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url));
    if (!missed && (init.method || 'GET') === 'GET' && /presence_invoices\?recurring_id=eq\./.test(u) && /order=recurring_on/.test(u)) { missed = true; return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }); }
    return fake(url, init);
  };
  try { await RI.runRecurringInvoices(20); } finally { globalThis.fetch = fake; }
  ok('4c: the database\'s one-per-date rule wins: still one invoice, one email', missed && invoices().length === 1 && mail.length === 1 && sched().sent_count === 1);
  // d: Stripe is down: nothing is emailed, the date waits, the next tick sends it once
  world({ presence_recurring_invoices: [schedule()] });
  stripeDown = true;
  const down = await RI.runRecurringInvoices(20);
  ok('4d: Stripe down → the invoice waits for its link, nobody is emailed, the date stays', down.failed === 1 && invoices().length === 1 && !invoices()[0].stripe_url && mail.length === 0 && sched().next_on === day(-1));
  stripeDown = false;
  const up = await RI.runRecurringInvoices(20);
  ok('4d: …and the next tick sends that same invoice, once', up.sent === 1 && invoices().length === 1 && invoices()[0].stripe_url && mail.length === 1 && sched().next_on > TODAY);
  // e: two sweeps at the very same moment (overlapping ticks): one invoice, one email
  world({ presence_recurring_invoices: [schedule()] });
  const s0 = { ...sched() };
  const both = await Promise.all([RI.sendRecurringNow({ ...s0 }, { localYmd: TODAY, clientId: OWNER }), RI.sendRecurringNow({ ...s0 }, { localYmd: TODAY, clientId: OWNER })]);
  ok('4e: two at once → one invoice, one email, one history line, moved once', invoices().length === 1 && mail.length === 1 && events('invoice_sent').length === 1 && sched().sent_count === 1, JSON.stringify(both) + ' mails=' + mail.length);
}

// ═══ 5. it pauses itself ═══
{
  const owed = (on, over = {}) => ({ id: crypto.randomUUID(), site_id: SITE, deal_id: DEAL, title: 'Website care', amount_cents: 50000, status: 'open', purpose: 'service', recurring_id: S1, recurring_on: on, due_date: R.addDays(on, 14), stripe_url: 'https://pay.example.test/x', created_at: on + 'T17:00:00.000Z', ...over });
  world({ presence_recurring_invoices: [schedule()], presence_invoices: [owed(day(-62)), owed(day(-31))] });
  const out = await RI.runRecurringInvoices(20);
  const s = sched();
  ok('5: the last two still unpaid → paused, nothing new billed', out.paused === 1 && out.sent === 0 && s.status === 'paused' && s.paused_reason === 'unpaid' && invoices().length === 2 && mail.length === 0);
  const n = notices('deal_followup')[0];
  ok('5: …with a Needs-you line that says why and opens the deal', n && n.status === 'active' && n.period === `recurpause:${DEAL}:${S1}:${day(-1)}` && n.headline === 'Recurring invoice paused — Blue Finch Café website' && /last two invoices are still unpaid/.test(n.body));
  ok('5: …and a line on the deal', recEvents('paused').length === 1 && recEvents('paused')[0].detail.reason === 'unpaid');
  world({ presence_recurring_invoices: [schedule()], presence_invoices: [owed(day(-62)), owed(day(-31), { status: 'paid' })] });
  ok('5: one of them paid → it keeps going', (await RI.runRecurringInvoices(20)).sent === 1 && sched().status === 'active');
  world({ presence_recurring_invoices: [schedule({ resumed_at: new Date(Date.now() - 3600_000).toISOString() })], presence_invoices: [owed(day(-62)), owed(day(-31))] });
  ok('5: after Resume, the ones before don\'t count', (await RI.runRecurringInvoices(20)).sent === 1);
  world({ presence_recurring_invoices: [schedule()], presence_contacts: [{ id: CT, site_id: SITE, name: 'Riley Park', email: '', company: 'Blue Finch Café' }] });
  await RI.runRecurringInvoices(20);
  ok('5: the contact lost their email → paused, saying so', sched().status === 'paused' && sched().paused_reason === 'no_email' && /no client email/.test(notices('deal_followup')[0]?.body || '') && invoices().length === 0);
  world({ presence_recurring_invoices: [schedule()], presence_deals: [] });
  await RI.runRecurringInvoices(20);
  ok('5: the deal was removed → the schedule ends, nothing billed', sched().status === 'stopped' && sched().next_on === null && invoices().length === 0);
}

// ═══ 6. a set number of times ═══
{
  world({ presence_recurring_invoices: [schedule({ times: 2, sent_count: 1 })] });
  await RI.runRecurringInvoices(20);
  ok('6: the last one goes out, then it\'s finished', invoices().length === 1 && mail.length === 1 && sched().status === 'finished' && sched().next_on === null && sched().sent_count === 2 && recEvents('finished').length === 1);
  ok('6: a finished one never sends again', (await RI.runRecurringInvoices(20)).sent === 0 && invoices().length === 1);
}

// ═══ 7. Pause · Resume · Skip this one · Change · Stop ═══
{
  const heads = (on) => ({ id: crypto.randomUUID(), client_id: OWNER, site_id: SITE, kind: 'invoice_upcoming', period: `recurnext:${DEAL}:${S1}:${on}`, status: 'active', headline: 'Goes out …' });
  const pauseRow = (on) => ({ id: crypto.randomUUID(), client_id: OWNER, site_id: SITE, kind: 'deal_followup', period: `recurpause:${DEAL}:${S1}:${on}`, status: 'active', headline: 'Recurring invoice paused — x' });
  world({ presence_recurring_invoices: [schedule({ next_on: day(2) })], presence_plan_notices: [heads(day(2))] });
  const p = await act(S1, 'pause');
  ok('7: Pause → paused by you, and its heads-up goes', p.status === 200 && sched().status === 'paused' && sched().paused_reason === 'manual' && notices('invoice_upcoming')[0].status === 'dismissed' && recEvents('paused')[0].detail.reason === 'manual');
  ok('7: Pause twice changes nothing', (await act(S1, 'pause')).body.already === true && recEvents('paused').length === 1);

  world({ presence_recurring_invoices: [schedule({ status: 'paused', paused_reason: 'unpaid', next_on: day(-5) })], presence_plan_notices: [pauseRow(day(-5)), { ...pauseRow(day(-36)), period: `recurpause:${DEAL}:${S1}:${day(-36)}` }, { ...pauseRow(day(-5)), period: `recurpause:${DEAL}:${S2}:${day(-5)}` }] });
  const r = await act(S1, 'resume');
  ok('7: Resume → active again; a date that went by goes today', r.status === 200 && sched().status === 'active' && sched().next_on === TODAY && sched().paused_reason === '' && !!sched().resumed_at && recEvents('resumed')[0].detail.on === TODAY);
  ok('7: …and its pause lines go (only this schedule\'s)', notices('deal_followup').filter((n) => n.period.includes(S1)).every((n) => n.status === 'dismissed') && notices('deal_followup').find((n) => n.period.includes(S2)).status === 'active');
  world({ presence_recurring_invoices: [schedule({ status: 'paused', paused_reason: 'manual', next_on: day(9) })] });
  await act(S1, 'resume');
  ok('7: Resume keeps a date still ahead', sched().next_on === day(9));
  world({ presence_recurring_invoices: [schedule({ status: 'paused', paused_reason: 'no_email' })], presence_contacts: [{ id: CT, site_id: SITE, name: 'Riley Park', email: '' }] });
  const stillNo = await act(S1, 'resume');
  ok('7: Resume with still no email says what\'s missing, and stays paused', stillNo.status === 422 && /Add the client’s email/.test(stillNo.body.message) && sched().status === 'paused');

  world({ presence_recurring_invoices: [schedule({ next_on: '2026-12-31', anchor_day: 31 })], presence_plan_notices: [{ ...heads('2026-12-31') }] });
  const sk = await act(S1, 'skip');
  ok('7: Skip this one → the one after, on the usual day (Dec 31 → Jan 31)', sk.status === 200 && sched().next_on === '2027-01-31' && sk.body.skipped === '2026-12-31' && recEvents('skipped')[0].detail.on === '2026-12-31');
  ok('7: …its heads-up goes, nothing is billed', notices('invoice_upcoming')[0].status === 'dismissed' && invoices().length === 0 && mail.length === 0);

  world({ presence_recurring_invoices: [schedule({ next_on: day(10), sent_count: 3 })], presence_plan_notices: [heads(day(10))] });
  const c = await change(S1, { amount_cents: 60000, next_on: day(12), title: 'Care plan' });
  ok('7: Change → the new amount, name and date; the day moves with the date', c.status === 200 && sched().amount_cents === 60000 && sched().title === 'Care plan' && sched().next_on === day(12) && sched().anchor_day === Number(day(12).slice(8)));
  ok('7: …the old heads-up goes, and the deal says so', notices('invoice_upcoming')[0].status === 'dismissed' && recEvents('changed')[0].detail.amount_cents === 60000 && recEvents('changed')[0].detail.on === day(12));
  ok('7: Change can\'t set fewer times than have gone out', (await change(S1, { times: 2 })).status === 422);
  ok('7: Change to a past date is refused', (await change(S1, { next_on: day(-1) })).status === 422);

  world({ presence_recurring_invoices: [schedule({ status: 'paused', paused_reason: 'unpaid' })], presence_plan_notices: [pauseRow(day(-1)), heads(day(-1))] });
  const st = await act(S1, 'stop');
  ok('7: Stop → stopped, no next date, every line about it goes', st.status === 200 && sched().status === 'stopped' && sched().next_on === null && notices().every((n) => n.status === 'dismissed') && recEvents('stopped').length === 1);
  ok('7: Stop twice changes nothing', (await act(S1, 'stop')).body.already === true && recEvents('stopped').length === 1);
  ok('7: a stopped one never starts again by itself — not by Resume, Change or Skip', (await act(S1, 'resume')).status === 409 && (await change(S1, { amount_cents: 1000 })).status === 409 && (await act(S1, 'skip')).status === 409 && sched().status === 'stopped');
  ok('7: …and the sweep never touches it', (await RI.runRecurringInvoices(20)).sent === 0 && invoices().length === 0);

  world({ presence_recurring_invoices: [schedule({ site_id: OTHER })] });
  ok('7: another studio\'s schedule isn\'t here', (await act(S1, 'stop')).status === 404 && (await change(S1, { amount_cents: 1000 })).status === 404 && sched().status === 'active');
}

console.log(`\n════ RECURRING INVOICES (routes + sweep): ${pass}/${pass + fail} ${fail ? 'FAILED' : 'PASSED'} ════`);
if (fail) Deno.exit(1);
