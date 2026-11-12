// ── Sales items 116, 117 and 118: money can't go wrong quietly (Nov 12 2026 review) ──
//   deno run --allow-read --allow-env --allow-net tests/presence/money_quiet_116_118_test.mjs
//
// File 06 of the review, findings 2 to 5 and 8 to 12. Each block below fails on the
// code as it was:
// 116  a bank payment that bounces: a Needs you line, a fresh pay link, the client told;
//      a second payment on a paid invoice, or the wrong amount: a Needs you line;
//      a part payment, or an Undo: the invoice gets a fresh pay link there and then.
// 117  a retainer link takes one approval; a second approval is an extra the studio is
//      told about and Cancel stops; the client's portal shows it and can cancel it.
// 118  a reminder counts as sent only once the email left; reminders count from the day
//      the invoice was sent; "Payment on its way" while a bank payment settles; the
//      receipt note and a private note; Undo of a deposit puts the deal back.
// Stripe, the mail service and the database are all fakes in this file. Every name
// and number is made up.
const SECRET = 'test-commerce-secret';
const HOOK_SECRET = 'whsec_test_fake';
Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');
Deno.env.set('STRIPE_SECRET', 'sk_test_fake');
Deno.env.set('STRIPE_WEBHOOK_SECRET', HOOK_SECRET);
Deno.env.set('BILLING_SYNC_SECRET', SECRET);
Deno.env.set('RESEND_KEY', 'test-resend-key');
Deno.env.set('SITE_URL', 'https://app.example');

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const P = '../../supabase/functions/presence';
const { payLinkKey } = await import(`${P}/commerce/stripe.ts`);
const { handleCommerce } = await import(`${P}/routes/commerce.ts`);
const { bouncedNoticeCopy, bouncedPeriod } = await import(`${P}/routes/invoice_bounced.ts`);
const { handleInvoicePayment, handleInvoicePaymentUndo } = await import(`${P}/routes/invoice_payments.ts`);
const { validatePayment } = await import(`${P}/lib/invoice_billing.ts`);
const { runInvoiceReminders, invoiceReminderSlot, invoiceReminderCopy, invoiceReminderOperatorBody, invoiceReminderPeriod, invoiceReminderFailedPeriod } = await import(`${P}/commerce/lifecycle.ts`);
const { applyRetainerSync, isExtraSubscription, retainerSubscriptionIds, retainerPortalView, retainerTwicePeriod } = await import(`${P}/commerce/retainers.ts`);
const { handleSalesRetainer, handleSalesRetainerCancel } = await import(`${P}/routes/sales.ts`);
const { handleClientBilling } = await import(`${P}/routes/client_delivery.ts`);
const { handleClientRetainerCancel } = await import(`${P}/routes/client_retainers.ts`);
const { renderInvoiceDocument } = await import(`${P}/lib/documents.ts`);
const { invoicePdf } = await import(`${P}/lib/doc_pdf.ts`);
const { memberWriteNeeds } = await import(`${P}/lib/site_roles.ts`);
const { checklistSource } = await import(`${P}/lib/project_checklist.ts`);
const { noticePriority, noticeTier } = await import(`${P}/lib/inbox_feed.ts`);

// the webhook is a served function: catch its handler instead of opening a port
let hook = null;
{ const realServe = Deno.serve; Deno.serve = (h) => { hook = h; return {}; }; await import('../../supabase/functions/stripe-webhook/index.ts'); Deno.serve = realServe; }

// ═══ the fake world ═══
const STUDIO = { id: '11111111-1111-4111-8111-111111111111', client_id: '22222222-2222-4222-8222-222222222222' };
const CUSTOMER = { id: '99999999-1111-4111-8111-999999999999', client_id: '99999999-2222-4222-8222-999999999999' };
const STRANGER = { id: '88888888-1111-4111-8111-888888888888', client_id: '88888888-2222-4222-8222-888888888888' };
const DEAL = '33333333-3333-4333-8333-333333333333';
const CONTACT = '33333333-4444-4333-8333-333333333333';
const PROJECT = '33333333-5555-4333-8333-333333333333';
const INV = '44444444-4444-4444-8444-444444444444';
const DEP = '55555555-5555-4555-8555-555555555555';
const PRINCIPAL = { kind: 'client', userId: 'u1', email: 'owner@studio.example', tenantId: null, role: 'owner', jwt: 'j', requestId: 'r' };
const PUBLIC = { kind: 'public', userId: null, tenantId: null, role: null, email: null, jwt: null, requestId: 't' };
const CORS = {};
const TABLES = { presence_invoices: 'invoices', presence_deal_events: 'events', presence_plan_notices: 'notices', presence_deals: 'deals', presence_contracts: 'contracts', presence_contacts: 'contacts', presence_sites: 'sites', presence_settings: 'settings', presence_tasks: 'tasks', stripe_webhook_events: 'hooks' };
const world = {};
let emailOk = true, hopDown = false, stripeOk = true;
const jres = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const field = (row, key) => { if (key.includes('->>')) { const [a, b] = key.split('->>'); return row[a] && typeof row[a] === 'object' ? row[a][b] : undefined; } return row[key]; };
const test = (row, key, expr) => {
  const v = field(row, key);
  if (expr === 'is.null') return v === null || v === undefined;
  if (expr === 'not.is.null') return v !== null && v !== undefined;
  const dot = expr.indexOf('.'); const op = expr.slice(0, dot); const want = expr.slice(dot + 1);
  if (op === 'eq') return String(v ?? '') === want;
  if (op === 'neq') return String(v ?? '') !== want;
  if (op === 'gt') return Number(v) > Number(want);
  if (op === 'lt') return String(v ?? '') < want;
  if (op === 'like') return String(v ?? '').startsWith(want.replace(/\*$/, '').replace(/\\(.)/g, '$1'));
  if (op === 'in') return want.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, '')).includes(String(v));
  return true;
};
const SKIP = ['select', 'order', 'limit', 'offset', 'on_conflict'];
let n = 0;
globalThis.fetch = async (input, init) => {
  const u = new URL(typeof input === 'string' ? input : input.url);
  const method = (init?.method || 'GET').toUpperCase();
  if (u.hostname === 'api.stripe.com') {
    const body = init?.body ? Object.fromEntries(new URLSearchParams(String(init.body))) : {};
    world.stripe.push({ method, path: u.pathname, key: new Headers(init?.headers).get('Idempotency-Key') || '', body });
    if (!stripeOk) return jres(400, { error: { message: 'no' } });
    if (method === 'POST' && u.pathname === '/v1/payment_links') { n++; return jres(200, { id: `plink_new_${n}`, url: `https://pay.example/new-${n}` }); }
    if (method === 'POST' && u.pathname === '/v1/prices') return jres(200, { id: `price_${++n}` });
    return jres(200, { id: 'x', active: false });
  }
  if (u.hostname === 'api.resend.com') { const b = JSON.parse(init.body); world.mail.push({ to: String(b.to), subject: b.subject, html: b.html }); return emailOk ? jres(200, { id: 'm' }) : jres(500, { message: 'down' }); }
  if (u.hostname !== 'example.supabase.co') { world.escaped.push(u.href); return jres(500, {}); }
  if (u.pathname === '/functions/v1/presence/commerce/invoice-bounced') {
    world.hops.push('bounced');
    if (hopDown) return jres(500, {});
    return handleCommerce(new Request('https://x/commerce/invoice-bounced', { method: 'POST', headers: init.headers, body: init.body }), '/commerce/invoice-bounced', 'POST', PUBLIC, {});
  }
  if (u.pathname.startsWith('/functions/v1/')) { world.hops.push(u.pathname.split('/').pop()); return jres(200, { data: { notice: true } }); }
  const table = u.pathname.replace('/rest/v1/', '');
  const bucket = TABLES[table] ? world[TABLES[table]] : null;
  if (!bucket) return method === 'GET' ? jres(200, []) : jres(201, []);
  const hit = () => { let out = bucket.slice(); for (const [k, e] of u.searchParams) { if (SKIP.includes(k)) continue; if (k === 'or') { const parts = e.replace(/^\(|\)$/g, '').split(','); out = out.filter((r) => parts.some((p) => { const i = p.indexOf('.'); return test(r, p.slice(0, i), p.slice(i + 1)); })); continue; } out = out.filter((r) => test(r, k, e)); } return out; };
  if (method === 'GET') return jres(200, hit());
  if (method === 'POST') {
    const body = JSON.parse(init.body);
    if (table === 'presence_plan_notices' && bucket.some((r) => r.client_id === body.client_id && r.kind === body.kind && r.period === body.period)) return jres(200, []);
    if (table === 'stripe_webhook_events' && bucket.some((r) => r.event_id === body.event_id)) return jres(200, []);
    const row = { id: crypto.randomUUID(), deleted_at: null, created_at: new Date().toISOString(), ...body }; bucket.push(row); return jres(201, [row]);
  }
  if (method === 'PATCH') { const rows = hit(); const patch = JSON.parse(init.body); for (const r of rows) Object.assign(r, patch); return jres(200, rows); }
  if (method === 'DELETE') { const rows = hit(); for (const r of rows) bucket.splice(bucket.indexOf(r), 1); return jres(200, rows); }
  return jres(405, {});
};
const invoice = (over = {}) => ({ id: INV, site_id: STUDIO.id, deal_id: DEAL, customer_client_id: CUSTOMER.client_id, number: 13, title: 'Balance at launch', description: 'Balance', amount_cents: 200000, currency: 'usd', purpose: 'service', status: 'open', stripe_url: 'https://pay.example/old', stripe_payment_link_id: 'plink_old', processing_since: null, paid_at: null, paid_method: '', paid_note: '', paid_private_note: '', paid_ref: '', payment_for: null, link_gen: 0, first_sent_at: null, due_date: null, deleted_at: null, created_at: '2026-10-01T18:00:00Z', ...over });
const seed = (invs = [invoice()]) => {
  Object.assign(world, { invoices: invs, events: [], notices: [], hooks: [], stripe: [], mail: [], hops: [], escaped: [], tasks: [],
    deals: [{ id: DEAL, site_id: STUDIO.id, stage: 'contract', contact_id: CONTACT, title: 'Website refresh', converted_client_id: CUSTOMER.client_id, created_project_id: PROJECT, retainer: null, deleted_at: null, created_at: '2026-10-01T00:00:00Z' }],
    contracts: [{ id: 'c1', site_id: STUDIO.id, deal_id: DEAL, status: 'signed', deleted_at: null }],
    contacts: [{ id: CONTACT, site_id: STUDIO.id, name: 'Ivy Chen', email: 'ivy@client.example' }],
    sites: [{ id: STUDIO.id, client_id: STUDIO.client_id }, { id: CUSTOMER.id, client_id: CUSTOMER.client_id }],
    settings: [{ site_id: STUDIO.id, invoice_reminders: true, invoice_remind_after_days: 2 }] });
  emailOk = true; hopDown = false; stripeOk = true;
};
const row = (id = INV) => world.invoices.find((r) => r.id === id);
const notice = (re) => world.notices.find((x) => re.test(x.period));
const links = () => world.stripe.filter((c) => c.method === 'POST' && c.path === '/v1/payment_links');

// a Stripe event, signed the way Stripe signs it
let evt = 0;
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function stripeEvent(type, object) {
  const raw = JSON.stringify({ id: `evt_${++evt}`, type, created: Math.floor(Date.now() / 1000), data: { object } });
  const t = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(HOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${raw}`)));
  const quiet = console.error, quietW = console.warn, quietL = console.log; console.error = console.warn = console.log = () => {};
  try { return await hook(new Request('https://x/stripe-webhook', { method: 'POST', headers: { 'stripe-signature': `t=${t},v1=${sig}` }, body: raw })); }
  finally { console.error = quiet; console.warn = quietW; console.log = quietL; }
}
const session = (over = {}) => ({ id: 'cs_1', object: 'checkout.session', payment_intent: 'pi_1', amount_total: 200000, currency: 'usd', payment_status: 'paid', metadata: { presence_invoice_id: INV }, ...over });
const intent = (over = {}) => ({ id: 'pi_1', object: 'payment_intent', amount: 200000, amount_received: 200000, currency: 'usd', metadata: { presence_invoice_id: INV }, ...over });

// ═══ 116 · a bank payment that bounces (finding 2) ═══
{
  seed([invoice({ processing_since: '2026-11-10T00:00:00Z' })]);
  const r = await stripeEvent('checkout.session.async_payment_failed', session({ payment_status: 'unpaid' }));
  ok('bounce: Stripe is answered 200', r.status === 200);
  ok('bounce: the invoice is open again, not settling', row().status === 'open' && row().processing_since === null);
  ok('bounce: the spent link is off the invoice and its link number moved on', row().link_gen === 1 && row().stripe_payment_link_id !== 'plink_old');
  ok('bounce: a NEW link is made at Stripe, under the new number (the old key would hand the dead link back)', links().length === 1 && links()[0].key === `plink-${INV}-g1` && links()[0].body['restrictions[completed_sessions][limit]'] === '1', JSON.stringify(links()));
  ok('bounce: the fresh link is on the invoice, so Send, the Pay button and reminders carry it', /^https:\/\/pay\.example\/new-/.test(String(row().stripe_url)) && row().stripe_url !== 'https://pay.example/old');
  const nb = notice(/^bounced:/);
  ok('bounce: a Needs you line for the studio, on the money kind', !!nb && nb.kind === 'invoice_void_paid' && nb.status === 'active' && nb.period === bouncedPeriod(INV, 1) && /^Bank payment bounced: Balance at launch \(\$2,000\.00\) from Ivy Chen$/.test(nb.headline), JSON.stringify(world.notices));
  ok('bounce: that line needs the studio and sits on top', noticeTier('invoice_void_paid') === 'needs_you' && noticePriority('invoice_void_paid', nb.period) === true);
  const m = world.mail.find((x) => x.to.includes('ivy@client.example'));
  ok('bounce: the client is emailed the fresh link, and told the old one is dead', !!m && /didn’t go through/.test(m.subject) && m.html.includes(String(row().stripe_url)) && !m.html.includes('https://pay.example/old') && /no longer works/.test(m.html), JSON.stringify(world.mail.map((x) => x.subject)));
  ok('bounce: the studio’s line says the client was told', /We emailed them a fresh pay link/.test(nb.body));
  // Stripe sends the bounce twice: the session's event and the intent's
  const before = { notices: world.notices.length, mail: world.mail.length, links: links().length, url: row().stripe_url };
  await stripeEvent('payment_intent.payment_failed', intent({ amount_received: 0 }));
  ok('bounce: the second event for the same bounce changes nothing', world.notices.length === before.notices && world.mail.length === before.mail && links().length === before.links && row().stripe_url === before.url && row().link_gen === 1);
  ok('bounce: nothing escaped to the outside world', world.escaped.length === 0, world.escaped.join(' '));
}
{
  // the presence function can't be reached: the studio is still told, and the dead link is still gone
  seed([invoice({ processing_since: '2026-11-10T00:00:00Z' })]); hopDown = true;
  await stripeEvent('payment_intent.payment_failed', intent({ amount_received: 0 }));
  const nb = notice(/^bounced:/);
  ok('bounce, hop down: the dead link is off the invoice', row().stripe_url === null && row().link_gen === 1 && row().processing_since === null);
  ok('bounce, hop down: the studio still gets its line, saying to press Send', !!nb && nb.kind === 'invoice_void_paid' && /press Send/.test(nb.body));
  // …and the reminder sweep is the net: it makes the link the hop couldn't
  hopDown = false; row().first_sent_at = '2026-10-01T18:00:00Z';
  await runInvoiceReminders(20);
  ok('bounce, hop down: the reminder sweep makes the missing link, under the same number', /^https:\/\/pay\.example\/new-/.test(String(row().stripe_url)) && links().some((c) => c.key === `plink-${INV}-g1`));
  ok('bounce, hop down: and its reminder carries that link', world.mail.some((x) => x.html.includes(String(row().stripe_url))));
}
{
  // a card declined on the pay page is not a bounce: nothing was settling, the link is not spent
  seed();
  await stripeEvent('payment_intent.payment_failed', intent({ amount_received: 0 }));
  ok('a declined card: the invoice, its link and the studio’s list are untouched', row().stripe_url === 'https://pay.example/old' && row().link_gen === 0 && world.notices.length === 0 && world.mail.length === 0 && !world.hops.includes('bounced'));
}
{
  const c = bouncedNoticeCopy({ what: 'Deposit', amount: '$500.00', who: '', linked: true, emailed: false, hasEmail: true });
  ok('bounce words: a failed email is said, never "we emailed them"', /didn’t go out/.test(c.body) && !/We emailed/.test(c.body));
  ok('bounce words: no email on the contact is said', /no email on the deal’s contact/.test(bouncedNoticeCopy({ what: 'Deposit', amount: '$500.00', who: '', linked: true, emailed: false, hasEmail: false }).body));
  ok('bounce words: no link is said', /couldn’t make a new pay link/.test(bouncedNoticeCopy({ what: 'Deposit', amount: '$500.00', who: '', linked: false, emailed: false, hasEmail: true }).body));
  const forbidden = await handleCommerce(new Request('https://x/commerce/invoice-bounced', { method: 'POST', headers: { 'x-commerce-secret': 'wrong' }, body: JSON.stringify({ invoice_id: INV }) }), '/commerce/invoice-bounced', 'POST', PUBLIC, {});
  ok('the bounced route is closed without the secret', forbidden.status === 403);
  seed();
  const idle = await handleCommerce(new Request('https://x/commerce/invoice-bounced', { method: 'POST', headers: { 'x-commerce-secret': SECRET }, body: JSON.stringify({ invoice_id: INV }) }), '/commerce/invoice-bounced', 'POST', PUBLIC, {});
  ok('the bounced route does nothing to an invoice that did not bounce', idle.status === 200 && (await idle.json()).data.ignored === true && world.mail.length === 0 && world.notices.length === 0 && links().length === 0);
}

// ═══ 116 · paid twice, or the wrong amount (finding 3) ═══
{
  // the studio recorded a check; the client still had the pay page open and paid by card
  seed([invoice({ status: 'paid', paid_method: 'check', paid_at: '2026-11-08T12:00:00Z' })]);
  const r = await stripeEvent('payment_intent.succeeded', intent({ id: 'pi_card' }));
  const nt = notice(/^paidtwice:/);
  ok('paid twice: Stripe is answered 200 and the invoice keeps how it was paid', r.status === 200 && row().paid_method === 'check');
  ok('paid twice: "Paid twice, refund one" in Needs you', !!nt && nt.kind === 'invoice_void_paid' && nt.status === 'active' && /^Paid twice, refund one: Balance at launch \(\$2,000\.00\)$/.test(nt.headline) && /recorded by hand/.test(nt.body) && /\$2,000\.00 has now come in/.test(nt.body), JSON.stringify(world.notices));
  await stripeEvent('checkout.session.completed', session({ payment_intent: 'pi_card' }));
  ok('paid twice: the same payment arriving as its other event raises nothing more', world.notices.filter((x) => /^paidtwice:/.test(x.period)).length === 1);
}
{
  // paid online, then a second, different online payment
  seed();
  await stripeEvent('checkout.session.completed', session({ payment_intent: 'pi_first' }));
  ok('a card payment: the invoice is paid and remembers which payment paid it', row().status === 'paid' && row().paid_ref === 'pi_first' && world.notices.length === 0, JSON.stringify(world.notices));
  await stripeEvent('payment_intent.succeeded', intent({ id: 'pi_first' }));
  ok('the same payment again (its other event) is silent', world.notices.length === 0);
  await stripeEvent('payment_intent.succeeded', intent({ id: 'pi_second' }));
  ok('a different payment on the paid invoice: "Paid twice, refund one"', world.notices.length === 1 && /^Paid twice, refund one/.test(world.notices[0].headline) && world.notices[0].period === `paidtwice:${INV}:pi_second`);
}
{
  // a part payment was recorded, and the client paid the old, higher amount from an open page
  seed([invoice({ amount_cents: 150000 })]);
  await stripeEvent('checkout.session.completed', session({ payment_intent: 'pi_old_page', amount_total: 200000 }));
  const na = notice(/^payamount:/);
  ok('wrong amount: the invoice is paid, and the studio is told to refund the difference', row().status === 'paid' && !!na && na.kind === 'invoice_void_paid' && /^Paid too much, refund the difference/.test(na.headline) && /\$2,000\.00 came in/.test(na.body) && /down to \$1,500\.00/.test(na.body) && /Refund \$500\.00/.test(na.body), JSON.stringify(world.notices));
  seed();
  await stripeEvent('checkout.session.completed', session({ amount_total: 200000 }));
  ok('the right amount raises nothing', world.notices.length === 0);
  seed();
  await stripeEvent('checkout.session.completed', session({ amount_total: 180000, currency: 'eur' }));
  ok('a payer charged in another currency is not a wrong amount', row().status === 'paid' && world.notices.length === 0);
}

// ═══ 116 · after a part payment or an Undo, a fresh pay link (finding 4) ═══
const req = (path, body) => new Request(`https://example.supabase.co/functions/v1/presence${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const pay = async (id, body) => { const r = await handleInvoicePayment(req(`/sales/invoices/${id}/payment?today=2026-11-11`, body), STUDIO, PRINCIPAL, id, CORS); return { status: r.status, body: await r.json() }; };
const undo = async (id) => { const r = await handleInvoicePaymentUndo(req(`/sales/invoices/${id}/payment/undo`, {}), STUDIO, PRINCIPAL, id, CORS); return { status: r.status, body: await r.json() }; };
{
  ok('link keys: number 0 keeps every old invoice’s key; a new number is a new key', payLinkKey(INV, 0) === INV && payLinkKey(INV, undefined) === INV && payLinkKey(INV, 2) === `${INV}-g2`);
  seed();
  const r = await pay(INV, { method: 'zelle', amount_cents: 50000, paid_on: '2026-11-08', email_receipt: false });
  ok('part payment: what is left gets its own pay link at once', r.status === 200 && row().amount_cents === 150000 && /^https:\/\/pay\.example\/new-/.test(String(row().stripe_url)) && r.body.data.fresh_link === true && r.body.data.invoice.stripe_url === row().stripe_url, JSON.stringify(r.body));
  const made = links()[0];
  ok('part payment: the link is for what is left, under a new number', !!made && made.key === `plink-${INV}-g1` && row().link_gen === 1 && world.stripe.some((c) => c.path === '/v1/prices' && c.body.unit_amount === '150000' && c.key === `price-${INV}-g1`), JSON.stringify(world.stripe));
  ok('part payment: the old link is switched off', world.stripe.some((c) => c.path === '/v1/payment_links/plink_old' && c.body.active === 'false'));
  // the reminder sweep sees it: it has a link, and it is still owed
  row().first_sent_at = '2026-10-01T18:00:00Z';
  const swept = await runInvoiceReminders(20);
  ok('part payment: the rest is chased (a reminder goes, for what is left, with the fresh link)', swept.reminded === 1 && world.mail.some((x) => /\$1,500\.00/.test(x.subject) && x.html.includes(String(row().stripe_url))), JSON.stringify(world.mail.map((x) => x.subject)));
  const part = world.invoices.find((x) => x.payment_for === INV);
  const u = await undo(part.id);
  ok('undo a part payment: the whole amount is due again, with a link of its own', u.status === 200 && row().amount_cents === 200000 && row().link_gen === 2 && u.body.data.fresh_link === true && links().some((c) => c.key === `plink-${INV}-g2`) && /^https:\/\/pay\.example\/new-/.test(String(row().stripe_url)), JSON.stringify(u.body));
}
{
  seed();
  await pay(INV, { method: 'cash', email_receipt: false });
  const u = await undo(INV);
  ok('undo all of it: open again WITH a fresh pay link, so its reminders can start again', u.status === 200 && row().status === 'open' && /^https:\/\/pay\.example\/new-/.test(String(row().stripe_url)) && row().link_gen === 1 && u.body.data.fresh_link === true, JSON.stringify(u.body));
  seed(); stripeOk = false;
  const r = await pay(INV, { method: 'cash', amount_cents: 50000, email_receipt: false });
  ok('Stripe down: the payment is still recorded, and the page is told there is no new link yet', r.status === 200 && row().amount_cents === 150000 && row().stripe_url === null && r.body.data.fresh_link === false && row().link_gen === 1);
}
{
  // a receipt for a part payment gives the client a way to pay the rest
  seed();
  const r = await pay(INV, { method: 'check', amount_cents: 50000 });
  const m = world.mail.find((x) => /^Receipt/.test(x.subject));
  ok('part payment receipt: "still due" comes with a Pay button for what is left', r.body.data.receipt_emailed === true && !!m && /\$1,500\.00 is still due/.test(m.html) && m.html.includes(String(row().stripe_url)) && /Pay \$1,500\.00 securely/.test(m.html), m ? m.html.slice(0, 600) : 'no receipt');
}

// ═══ 117 · a retainer is approved once (finding 5) ═══
const retainer = (over = {}) => ({ status: 'active', amount_cents: 50000, interval: 'month', stripe_subscription_id: 'sub_first', stripe_customer_id: 'cus_1', stripe_payment_link_id: 'plink_r', checkout_url: 'https://pay.example/retainer', current_period_end: '2026-12-01T00:00:00.000Z', created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-11-01T00:00:00.000Z', canceled_at: null, ...over });
const subEvent = (id, over = {}) => ({ id, object: 'subscription', status: 'active', customer: 'cus_1', metadata: { purpose: 'service_retainer', deal_id: DEAL, site_id: STUDIO.id }, ...over });
{
  seed();
  const r = await handleSalesRetainer(req(`/sales/deals/${DEAL}/retainer`, { amount_cents: 50000, interval: 'month' }), STUDIO, PRINCIPAL, DEAL, CORS);
  const made = links()[0];
  ok('a retainer link takes ONE approval', r.status === 201 && !!made && made.body['restrictions[completed_sessions][limit]'] === '1' && made.body['metadata[purpose]'] === 'service_retainer', JSON.stringify(made));
  ok('after approving, the client lands on retainer words, not "your invoice is paid"', /payment-success\.html\?retainer=1$/.test(made.body['after_completion[redirect][url]']) && /get\('retainer'\) !== '1'/.test(read('payment-success.html')) && /Your retainer is set up/.test(read('payment-success.html')));
  // cancelled before approval, then set up again at the same amount: a NEW link, never the dead one back
  await handleSalesRetainerCancel(req('/x', {}), STUDIO, PRINCIPAL, DEAL, CORS);
  await new Promise((res) => setTimeout(res, 5));
  await handleSalesRetainer(req(`/sales/deals/${DEAL}/retainer`, { amount_cents: 50000, interval: 'month' }), STUDIO, PRINCIPAL, DEAL, CORS);
  ok('a retainer set up again after a cancel asks Stripe for a new link', links().length === 2 && links()[0].key !== links()[1].key, JSON.stringify(links().map((c) => c.key)));
}
{
  ok('second approval: a different subscription on a live retainer is an extra', isExtraSubscription(retainer(), 'sub_second') && !isExtraSubscription(retainer(), 'sub_first') && !isExtraSubscription(retainer({ status: 'pending', stripe_subscription_id: null }), 'sub_first') && isExtraSubscription(retainer({ status: 'canceled' }), 'sub_late'));
  seed(); world.deals[0].retainer = retainer();
  const r = await applyRetainerSync('customer.subscription.created', subEvent('sub_second'));
  const d = world.deals[0].retainer;
  ok('second approval: the retainer stays on its first subscription', r.synced === true && r.reason === 'second_approval' && d.stripe_subscription_id === 'sub_first' && d.status === 'active', JSON.stringify(d));
  ok('second approval: the extra is remembered', JSON.stringify(d.extra_subscription_ids) === JSON.stringify(['sub_second']));
  const nt = world.notices.find((x) => x.period === retainerTwicePeriod(DEAL, 'sub_second'));
  ok('second approval: the studio is told, in Needs you', !!nt && nt.kind === 'retainer_status' && nt.status === 'active' && /^Retainer approved twice: Website refresh$/.test(nt.headline) && /two charges are running/.test(nt.body) && noticeTier('retainer_status') === 'needs_you', JSON.stringify(world.notices));
  await applyRetainerSync('invoice.payment_succeeded', { id: 'in_1', object: 'invoice', subscription: 'sub_second', amount_paid: 50000, subscription_details: { metadata: { purpose: 'service_retainer', deal_id: DEAL, site_id: STUDIO.id } } });
  ok('second approval: its later events never take the retainer over, and tell the studio once', world.deals[0].retainer.stripe_subscription_id === 'sub_first' && world.notices.filter((x) => /twice/.test(x.period)).length === 1);
  ok('second approval: the money it took is in the deal’s history', world.events.some((e) => e.kind === 'invoice_paid' && e.detail.retainer === true && e.detail.extra === true && e.detail.amount_cents === 50000));
  ok('Cancel knows every subscription', JSON.stringify(retainerSubscriptionIds(world.deals[0].retainer)) === JSON.stringify(['sub_first', 'sub_second']));
  const c = await handleSalesRetainerCancel(req('/x', {}), STUDIO, PRINCIPAL, DEAL, CORS);
  const stopped = world.stripe.filter((x) => x.method === 'DELETE').map((x) => x.path);
  ok('Cancel retainer stops BOTH charges', c.status === 200 && stopped.includes('/v1/subscriptions/sub_first') && stopped.includes('/v1/subscriptions/sub_second') && world.deals[0].retainer.status === 'canceled' && world.deals[0].retainer.extra_subscription_ids.length === 0, JSON.stringify(stopped));
  // approved through an old link AFTER the cancel
  const late = await applyRetainerSync('customer.subscription.created', subEvent('sub_late'));
  ok('approved after a cancel: remembered, the studio told, the retainer still cancelled', late.reason === 'second_approval' && world.deals[0].retainer.status === 'canceled' && world.deals[0].retainer.extra_subscription_ids.includes('sub_late') && world.notices.some((x) => /^Retainer approved after you cancelled it/.test(x.headline)));
  await applyRetainerSync('customer.subscription.deleted', subEvent('sub_late', { status: 'canceled' }));
  ok('an extra that ends is forgotten', !world.deals[0].retainer.extra_subscription_ids.includes('sub_late'));
}

// ═══ 117 · the client's portal shows the retainer, and can cancel it ═══
{
  seed(); world.deals[0].retainer = retainer();
  world.events.push({ id: 'e1', deal_id: DEAL, site_id: STUDIO.id, kind: 'invoice_paid', created_at: '2026-11-01T09:00:00Z', detail: { retainer: true, amount_cents: 50000 } }, { id: 'e2', deal_id: DEAL, site_id: STUDIO.id, kind: 'invoice_paid', created_at: '2026-10-01T09:00:00Z', detail: { retainer: true, amount_cents: 50000 } }, { id: 'e3', deal_id: DEAL, site_id: STUDIO.id, kind: 'invoice_paid', created_at: '2026-10-02T09:00:00Z', detail: { invoice_id: INV, amount_cents: 999 } });
  const b = await (await handleClientBilling(req('/client/billing', {}), CUSTOMER, PRINCIPAL, CORS)).json();
  const rt = (b.data.retainers || [])[0];
  ok('portal: the retainer, how much, how often, where it stands, the next charge', !!rt && rt.id === DEAL && rt.amount === 500 && rt.interval === 'month' && rt.status === 'active' && rt.next_charge === '2026-12-01T00:00:00.000Z' && rt.can_cancel === true, JSON.stringify(b.data.retainers));
  ok('portal: its charges, and only its charges', rt.charges.length === 2 && rt.charges[0].amount === 500 && rt.charges[0].at === '2026-11-01T09:00:00Z');
  ok('portal: nothing of Stripe’s leaves the server', !/sub_first|cus_1|plink_r|pay\.example\/retainer/.test(JSON.stringify(rt)));
  const none = await (await handleClientBilling(req('/client/billing', {}), STRANGER, PRINCIPAL, CORS)).json();
  ok('portal: another client sees no retainer', (none.data.retainers || []).length === 0);
  ok('portal view: one waiting for approval carries its link; one withdrawn before any charge is not shown', retainerPortalView({ id: DEAL, title: 'x', retainer: retainer({ status: 'pending' }) }, []).approve_url === 'https://pay.example/retainer' && retainerPortalView({ id: DEAL, title: 'x', retainer: retainer({ status: 'canceled' }) }, []) === null && retainerPortalView({ id: DEAL, title: 'x', retainer: retainer({ status: 'canceled' }) }, [{ at: 'a', amount: 1 }]).can_cancel === false);
  const no = await handleClientRetainerCancel(req('/x', {}), STRANGER, PRINCIPAL, DEAL, CORS);
  ok('cancel: another client can’t cancel it', no.status === 404 && world.deals[0].retainer.status === 'active' && !world.stripe.some((x) => x.method === 'DELETE'));
  stripeOk = false;
  const down = await handleClientRetainerCancel(req('/x', {}), CUSTOMER, PRINCIPAL, DEAL, CORS);
  ok('cancel: Stripe says no, so nothing is marked cancelled', down.status === 502 && world.deals[0].retainer.status === 'active');
  stripeOk = true; world.stripe = [];
  const yes = await handleClientRetainerCancel(req('/x', {}), CUSTOMER, PRINCIPAL, DEAL, CORS);
  ok('cancel: the client’s own cancel stops the charges at Stripe and marks it cancelled', yes.status === 200 && world.stripe.some((x) => x.method === 'DELETE' && x.path === '/v1/subscriptions/sub_first') && world.deals[0].retainer.status === 'canceled' && !!world.deals[0].retainer.canceled_at);
  const nt = world.notices.find((x) => /clientcancel/.test(x.period));
  ok('cancel: the studio is told who cancelled, and that nothing was refunded', !!nt && nt.kind === 'retainer_status' && nt.client_id === STUDIO.client_id && /^The client cancelled their retainer: Website refresh$/.test(nt.headline) && /Nothing was refunded/.test(nt.body));
  const again = await handleClientRetainerCancel(req('/x', {}), CUSTOMER, PRINCIPAL, DEAL, CORS);
  ok('cancel: twice is once', again.status === 200 && (await again.json()).data.already === true);
  ok('roles: cancelling the business’s retainer is the owner’s call', memberWriteNeeds(`/client/retainers/${DEAL}/cancel`, 'POST') === 'delete');
  const idx = read('supabase/functions/presence/index.ts');
  ok('index: the client cancel route', /\\\/client\\\/retainers\\\/\(\[0-9a-f-\]\{36\}\)\\\/cancel\$/.test(idx) && /handleClientRetainerCancel\(req, site, principal, m\[1\], cors\)/.test(idx));
  const page = read('client.html');
  ok('portal page: the retainer card, its charges, and a cancel that asks first and says nothing is refunded', /function retainerCardHtml\(r\)/.test(page) && /aria-label="Charges so far"/.test(page) && /data-ret-ask>Cancel retainer</.test(page) && /It stops future charges\. Charges already made are not refunded\./.test(page) && /api\('\/client\/retainers\/'\+encodeURIComponent\(id\)\+'\/cancel','POST',\{\}\)/.test(page));
  ok('portal page: a retainer with no invoices is not "No invoices yet"', /html\+=rets\.length\?'':emptyCard\('No invoices yet\./.test(page));
}

// ═══ 118 · a reminder is sent only once the email left (finding 8) ═══
{
  seed([invoice({ first_sent_at: '2026-10-01T18:00:00Z' })]); emailOk = false;
  const r = await runInvoiceReminders(20);
  const leg = invoiceReminderPeriod(INV, 'after');
  ok('email down: the reminder is NOT counted or recorded as sent', r.reminded === 0 && !world.notices.some((x) => x.period === leg), JSON.stringify(world.notices));
  const nf = world.notices.find((x) => x.period === invoiceReminderFailedPeriod(INV, 'after'));
  ok('email down: the studio is told it didn’t send, and that we’ll try again', !!nf && nf.status === 'active' && /^Reminder didn’t send/.test(nf.headline) && /try again/.test(nf.body) && !/We nudged/.test(nf.body));
  emailOk = true; world.mail = [];
  const r2 = await runInvoiceReminders(20);
  ok('next run: it is tried again, sent, and now recorded', r2.reminded === 1 && world.mail.length === 1 && world.notices.some((x) => x.period === leg && x.status === 'active' && /^Still unpaid/.test(x.headline)));
  ok('next run: the "didn’t send" line is taken down', world.notices.find((x) => x.period === invoiceReminderFailedPeriod(INV, 'after')).status === 'dismissed');
  const r3 = await runInvoiceReminders(20);
  ok('a reminder that went never goes twice', r3.reminded === 0 && world.mail.length === 1);
  ok('the failed line sits under the invoice’s reminder prefix, so paying or voiding clears it', invoiceReminderFailedPeriod(INV, 'due').startsWith(`invremind:${INV}:`));
  ok('"the third and last" only where there are three: an invoice with no due date gets two', /the second automatic reminder and the last/.test(invoiceReminderOperatorBody('after', true, true)) && /the third automatic reminder and the last/.test(invoiceReminderOperatorBody('after', true, false)) && /One more goes in a week/.test(invoiceReminderOperatorBody('after', true, false, true)) && /no client email/.test(invoiceReminderOperatorBody('after', false, true)));
}

// ═══ 118 · reminders count from the day the invoice was sent (finding 9) ═══
{
  const slot = (inv, today) => invoiceReminderSlot({ status: 'open', stripe_url: 'https://pay.example/x', ...inv }, today, 2);
  // made Oct 20 from an estimate, sent Nov 3, no due date
  const late = { created_at: '2026-10-20T10:00:00Z', first_sent_at: '2026-11-03T10:00:00Z' };
  ok('sent two weeks after it was made: nothing the next morning', slot(late, '2026-11-04') === null);
  ok('…its first reminder is a week after it was SENT', slot(late, '2026-11-09') === null && slot(late, '2026-11-10') === 'due' && slot(late, '2026-11-12') === 'after');
  ok('never on the day it went out', slot({ ...late, due_date: '2026-11-03' }, '2026-11-03') === null);
  ok('an invoice from before the column counts from the day it was made, as it did', slot({ created_at: '2026-10-20T10:00:00Z' }, '2026-10-27') === 'due');
  const c = invoiceReminderCopy('due', 'invoice', '$100.00', 'Invoice', true);
  ok('no due date: the reminder never says "due today"', !/due today/i.test(c.subject + c.line) && /still open/.test(c.line) && /due today/i.test(invoiceReminderCopy('due', 'invoice', '$100.00', 'Invoice').subject));
  const sales = read('supabase/functions/presence/routes/sales.ts');
  ok('sending stamps the day: + Invoice, a plan’s first stage, Send, the agreement’s deposit, a recurring invoice', (sales.match(/await stampFirstSent\(/g) || []).length === 4 && /if \(emailed\) await stampFirstSent\(inv\.id, s\.site_id/.test(read('supabase/functions/presence/routes/recurring_invoices.ts')));
  ok('the stamp is set once: a resend never moves it', /first_sent_at=is\.null`, \{ method: 'PATCH', body: JSON\.stringify\(\{ first_sent_at: nowIso \}\)/.test(read('supabase/functions/presence/lib/pay_link.ts')));
}

// ═══ 118 · "Payment on its way" while a bank payment settles (finding 10) ═══
{
  const brand = { name: 'Northwind Studio', accent: '#6d3fd4', accentDark: '#3d2185' };
  const inv = { number: 13, title: 'Deposit', amount_cents: 120000, purpose: 'deposit', status: 'open', stripe_url: 'https://pay.example/x', due_date: null, created_at: '2026-11-04T18:00:00Z' };
  const html = renderInvoiceDocument({ ...inv, processing_since: '2026-11-10T00:00:00Z' }, brand, null);
  ok('invoice page, settling: "Payment on its way", no Pay button, no "Amount due"', html.includes('<span class="pill due">Payment on its way</span>') && !html.includes('class="paylink"') && !html.includes('pay.example/x') && !/Amount due/.test(html.replace(/<style>[\s\S]*?<\/style>/, '')) && /Your payment is on its way/.test(html));
  ok('invoice page, not settling: the Pay button as before', renderInvoiceDocument(inv, brand, null).includes('class="paylink" href="https://pay.example/x"'));
  const pdf = new TextDecoder().decode(invoicePdf({ ...inv, processing_since: '2026-11-10T00:00:00Z' }, brand, null));
  ok('invoice PDF, settling: says so, and carries no pay link', pdf.includes('(PAYMENT ON ITS WAY)') && !pdf.includes('pay.example/x') && !pdf.includes('(AMOUNT DUE)'));
  const sales = read('supabase/functions/presence/routes/sales.ts');
  ok('the document read carries whether a payment is settling', /select=\$\{base\},number,paid_method,paid_note,payment_for,lines,processing_since&limit=1/.test(sales));
  ok('sign page read: a settling deposit is flagged and its link withheld', /const settling = !!dep && dep\.status === 'open' && !!dep\.processing_since;/.test(sales) && /processing: settling, url: \(contract\?\.status === 'signed' && dep\.status === 'open' && !settling && dep\.stripe_url\)/.test(sales));
  const sign = read('sign.html');
  ok('sign page: "Payment on its way", checked before the Pay button', /else if\(dep&&dep\.processing\)\{[\s\S]*?Payment on its way\./.test(sign) && sign.indexOf('dep&&dep.processing') < sign.indexOf('}else if(dep&&dep.url){'));
}

// ═══ 118 · the receipt note, and a private note (finding 11) ═══
{
  const v = validatePayment({ method: 'check', note: ' Check  #1042 ', private_note: '  Paid late,\n waived the fee ' }, { status: 'open', amount_cents: 200000 }, '2026-11-11');
  ok('the two notes are kept apart and tidied', v.ok && v.value.note === 'Check #1042' && v.value.private_note === 'Paid late, waived the fee');
  seed();
  await pay(INV, { method: 'check', note: 'Check #1042', private_note: 'Paid late, waived the fee', email_receipt: false });
  ok('recorded: each note in its own column', row().paid_note === 'Check #1042' && row().paid_private_note === 'Paid late, waived the fee');
  const html = renderInvoiceDocument({ ...row() }, null, null);
  ok('the receipt prints the receipt note and never the private one', html.includes('Check #1042') && !html.includes('waived the fee'));
  ok('the receipt PDF never carries the private note', !new TextDecoder().decode(invoicePdf({ ...row() }, { name: 'S', accent: '#6d3fd4', accentDark: '#3d2185' }, null)).includes('waived the fee'));
  const sales = read('supabase/functions/presence/routes/sales.ts');
  const docRow = sales.slice(sales.indexOf('export async function docRow('), sales.indexOf('// ═══ DOCUMENT LINK (authed)'));
  ok('the client’s document read never selects the private note; the studio’s deal read does', !/paid_private_note/.test(docRow) && !/paid_private_note/.test(read('supabase/functions/presence/lib/doc_context.ts')) && !/paid_private_note/.test(read('supabase/functions/presence/routes/client_delivery.ts')) && /paid_note,payment_for,paid_private_note&order=/.test(sales));
  await undo(INV);
  ok('undo clears both notes', row().paid_note === '' && row().paid_private_note === '');
  const crm = read('crm.html'), pipe = read('pipeline.html'), invs = read('invoices.html');
  ok('Invoices page: the same two notes, each saying who sees it', /Note on their receipt \(optional\)/.test(invs) && /Shown on their receipt: the client sees this note/.test(invs) && /Private note, only you see it \(optional\)/.test(invs) && /private_note:\$\('payPrivate'\)\.value\.trim\(\)/.test(invs) && !/>Note \(optional\)</.test(invs));
  for (const [name, src] of [['record', crm], ['deal page', pipe]]) {
    ok(`${name}: the note says it is shown on their receipt, and a private note sits beside it`, /Note on their receipt \(optional\)/.test(src) && /Shown on their receipt: the client sees this note on the receipt, its PDF and the receipt email\./.test(src) && /Private note, only you see it \(optional\)/.test(src) && !/<label>Note \(optional\)/.test(src));
    ok(`${name}: the private note is sent, and shown back only to the studio`, /private_note:/.test(src) && /v\.paid_private_note\?/.test(src));
    ok(`${name}: the words no longer say the rest waits for the next Send`, !/the next Send makes one for what’s left/.test(src) && !/send it again for a fresh payment link/.test(src) && /a fresh one is made for what’s left/.test(src));
  }
}

// ═══ 118 · Undo of a deposit puts the deal back (finding 12) ═══
{
  seed([invoice({ id: DEP, number: 12, title: 'Deposit', purpose: 'deposit', amount_cents: 120000 })]);
  world.tasks.push({ id: 't1', project_id: PROJECT, site_id: STUDIO.id, source: checklistSource('deposit_paid'), status: 'todo', title: 'Deposit paid', client_visible: false, deleted_at: null });
  const r = await pay(DEP, { method: 'bank_transfer', email_receipt: false });
  ok('a deposit recorded by hand ticks the step and wins the signed deal (as before)', r.body.data.moved === true && world.deals[0].stage === 'won' && world.tasks[0].status === 'done');
  const mv = world.events.find((e) => e.kind === 'stage_change' && e.to_stage === 'won');
  ok('the move remembers where the deal was, and which payment moved it', !!mv && mv.detail.from === 'contract' && mv.detail.invoice_id === DEP);
  const u = await undo(DEP);
  ok('undo: the deal is back where it was', u.status === 200 && world.deals[0].stage === 'contract' && u.body.data.moved_back === 'contract', JSON.stringify(u.body));
  ok('undo: "Deposit paid" is unticked', world.tasks[0].status === 'todo' && world.tasks[0].completed_at === null && u.body.data.unticked === true);
  ok('undo: the history says why the deal moved back', world.events.some((e) => e.kind === 'stage_change' && e.to_stage === 'contract' && e.detail.because === 'payment_undone'));
  // the deal moved on since: Undo leaves it where the studio put it
  seed([invoice({ id: DEP, number: 12, title: 'Deposit', purpose: 'deposit', amount_cents: 120000 })]);
  await pay(DEP, { method: 'cash', email_receipt: false });
  world.deals[0].stage = 'lost';
  const u2 = await undo(DEP);
  ok('undo: a deal moved on since stays where it is', u2.status === 200 && world.deals[0].stage === 'lost' && u2.body.data.moved_back === null);
  // another deposit on the deal is paid: the step and the stage still hold
  seed([invoice({ id: DEP, number: 12, title: 'Deposit', purpose: 'deposit', amount_cents: 120000 }), invoice({ id: INV, number: 11, title: 'First deposit', purpose: 'deposit', status: 'paid', paid_at: '2026-11-01T12:00:00Z' })]);
  world.tasks.push({ id: 't1', project_id: PROJECT, site_id: STUDIO.id, source: checklistSource('deposit_paid'), status: 'todo', title: 'Deposit paid', client_visible: false, deleted_at: null });
  await pay(DEP, { method: 'cash', email_receipt: false });
  const u3 = await undo(DEP);
  ok('undo: with another deposit still paid, nothing is unticked or moved', u3.status === 200 && world.deals[0].stage === 'won' && world.tasks[0].status === 'done' && u3.body.data.unticked === false);
  // an invoice that is not a deposit never touches the deal
  seed(); world.deals[0].stage = 'won';
  await pay(INV, { method: 'cash', email_receipt: false }); await undo(INV);
  ok('undo of an ordinary invoice leaves the deal alone', world.deals[0].stage === 'won' && !world.events.some((e) => e.kind === 'stage_change'));
}

// ═══ the database step (0188) and the wiring ═══
{
  const mig = read('supabase/migrations/0188_money_cant_go_wrong_quietly.sql');
  const pack = read('docs/presence/APPLY-0188-prod.sql');
  ok('0188: four invoice columns, all re-runnable', ['first_sent_at timestamptz', 'link_gen integer not null default 0', "paid_ref text not null default ''", "paid_private_note text not null default ''"].every((c) => mig.includes('add column if not exists ' + c)));
  ok('0188: invoices already sent get their day (the history’s, else the day they were made)', /set first_sent_at = coalesce\(\s*\(select min\(e\.created_at\) from public\.presence_deal_events e[\s\S]*?e\.kind = 'invoice_sent'[\s\S]*?i\.created_at\)\s*where i\.first_sent_at is null and i\.payment_for is null/.test(mig));
  ok('0188: no notice or history kind list is rewritten (other work is widening them)', !/kind_check/.test(mig) && !/kind_check/.test(pack));
  ok('0188: a rollback is written down', /-- rollback:[\s\S]*drop column if exists first_sent_at;/.test(mig));
  ok('the pack: the same statements as the migration, and a check query', pack.includes(mig.slice(mig.indexOf('alter table public.presence_invoices\n  add column if not exists first_sent_at'), mig.indexOf('\n-- rollback:')).trim()) && /-- check: select[\s\S]*as sent_but_unstamped;\s+-- 0\n$/.test(pack));
  const hookSrc = read('supabase/functions/stripe-webhook/index.ts');
  ok('webhook: both failure events go through the bounce path', (hookSrc.match(/await bouncePresenceInvoice\(String\(md\.presence_invoice_id\)/g) || []).length === 2);
  ok('webhook: before the database step it falls back to the old reads and writes', /\|\| \(await dbGet\(`presence_invoices\?id=eq\.\$\{encodeURIComponent\(invoiceId\)\}&select=id,site_id,deal_id,title,amount_cents,purpose,status&limit=1`\)\)\[0\];/.test(hookSrc) && /if \(!r\.ok\) \{ await clearPresenceInvoiceProcessing\(invoiceId, via\); return; \}/.test(hookSrc));
  const { isPublicCommerceRoute } = await import(`${P}/routes/commerce.ts`);
  ok('the bounced route is a system route, like the paid echo', isPublicCommerceRoute('/commerce/invoice-bounced', 'POST') === true);
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.error('FAILURES'); Deno.exit(1); }
