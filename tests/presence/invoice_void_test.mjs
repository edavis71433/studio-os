// ── Voiding an invoice raised in error ───────────────────────────────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/invoice_void_test.mjs
//
// The gap this pins: `presence_invoices.status` has allowed 'void' since 0086
// and pipeline.html has always rendered a "Voided" row — but NOTHING in the
// platform ever wrote it. An invoice raised in error (wrong amount, wrong deal,
// a duplicate of a plan stage) could only be cleared by PAYING it.
//
// Worse, it stranded the money notice. `deal_followup` + `invremind:<id>` is
// deliberately UNDISMISSABLE (lib/inbox_feed.ts: hiding "Still unpaid" does not
// make an invoice paid) and its ONLY teardown was Stripe's paid echo — so a
// mistaken invoice left a PERMANENT "Still unpaid" row on Today with no exit.
//
// The rule, and why it lives on the server:
//   open (sent or not) → voidable. The already-emailed wrong invoice is exactly
//                        the one you need to withdraw; the Stripe link is
//                        deactivated so it can't still be charged.
//   paid               → NEVER (409). Money changed hands; that is a financial
//                        record and a receipt the client is holding.
//   void               → idempotent 200, `already: true`. No second event, no
//                        second notice clear, nothing re-written.
Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');
Deno.env.set('STRIPE_SECRET', 'sk_test_fake');   // so deactivatePaymentLink really runs (F1a)

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const sales = read('supabase/functions/presence/routes/sales.ts');
const idx = read('supabase/functions/presence/index.ts');
const workspace = read('supabase/functions/presence/routes/workspace.ts');
const feed = read('supabase/functions/presence/lib/inbox_feed.ts');
const delivery = read('supabase/functions/presence/routes/client_delivery.ts');
const mig86 = read('supabase/migrations/0086_presence_invoices.sql');
const mig117 = read('supabase/migrations/0117_deal_event_delete_kinds.sql');
const mig118 = read('supabase/migrations/0118_deal_event_invoice_voided.sql');
const mig116 = read('supabase/migrations/0116_operator_activity_notices.sql');
const mig119 = read('supabase/migrations/0119_notice_invoice_void_paid.sql');
const stripeLib = read('supabase/functions/presence/commerce/stripe.ts');
const webhook = read('supabase/functions/stripe-webhook/index.ts');
const pipeline = read('pipeline.html');

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const { handleSalesInvoiceVoid } = await import('../../supabase/functions/presence/routes/sales.ts');

const SITE = { id: '11111111-1111-4111-8111-111111111111', client_id: 'cccccccc-1111-4111-8111-cccccccccccc' };
const OTHER_SITE = '22222222-2222-4222-8222-222222222222';
const DEAL = '33333333-3333-4333-8333-333333333333';
const PRINCIPAL = { kind: 'client', email: 'eric@example.com', userId: 'u1' };
const CORS = {};

const I_OPEN_SENT = '44444444-4444-4444-8444-444444444444';   // has a Stripe link — the client got it
const I_OPEN_UNSENT = '55555555-5555-4555-8555-555555555555'; // minted, never linked/emailed
const I_PAID = '66666666-6666-4666-8666-666666666666';
const I_VOID = '77777777-7777-4777-8777-777777777777';
const I_OTHER = '88888888-8888-4888-8888-888888888888';       // another tenant's open invoice

// ═══ 1. Schema + the ledger's kind constraint ════════════════════════════════
{
  ok('0086 already allows status=void — voiding needs no invoice-table migration',
    /status text not null default 'open' check \(status in \('open','paid','void'\)\)/.test(mig86));

  // The audit event DOES need one. presence_deal_events.kind is CHECK-constrained
  // and dealEvent() swallows write failures, so an un-widened check drops the line
  // SILENTLY — money withdrawn with nothing recording it.
  const kinds = (s) => ((s.match(/presence_deal_events\s+add constraint presence_deal_events_kind_check\s+check \(kind in \(([\s\S]*?)\)\)/) || [])[1] || '')
    .replace(/--[^\n]*/g, '').match(/'([a-z_]+)'/g)?.map((x) => x.slice(1, -1)) || [];
  const now = kinds(mig118);
  ok('0118 widens the deal-event kind check', now.length > 0);
  ok('0118 allows invoice_voided (the kind the void handler writes)', now.includes('invoice_voided'));
  ok('0118 is ADDITIVE — every kind 0117 allowed is carried forward verbatim',
    kinds(mig117).every((k) => now.includes(k)), kinds(mig117).filter((k) => !now.includes(k)).join(','));
  ok('0118 is idempotent (drop if exists, then add)', /drop constraint if exists presence_deal_events_kind_check/.test(mig118));
  ok('0118 documents its rollback', /rollback:/.test(mig118));
  ok('0118 says it must be applied BEFORE the function deploy (dealEvent fails silently)',
    /BEFORE DEPLOYING THE FUNCTION/i.test(mig118) && /silent/i.test(mig118));
  // and the code writes ONLY kinds the constraint allows
  for (const k of sales.match(/dealEvent\([^,]+, [^,]+, '([a-z_]+)'/g) || []) {
    const kind = k.match(/'([a-z_]+)'$/)[1];
    ok(`sales.ts writes deal-event kind '${kind}' — allowed by the check`, now.includes(kind));
  }
}

// ═══ 2. Structural: routing, auth boundary, tenant scope, race-safe WHERE ════
{
  ok('index.ts registers POST /sales/invoices/:id/void',
    /m = route\.match\(\/\^\\\/sales\\\/invoices\\\/\(\[0-9a-f-\]\{36\}\)\\\/void\$\/\);[\s\S]{0,200}?method === 'POST'\) return handleSalesInvoiceVoid\(/.test(idx));
  const salesBlock = idx.slice(idx.indexOf("if (route === '/sales/contacts')"), idx.indexOf("if (route === '/projects')"));
  ok('the void route lives in the authed /sales/* dispatch block (studio-gated)', /handleSalesInvoiceVoid\(/.test(salesBlock));
  ok('the client_reviewer boundary still admits NO /sales/* route',
    !/\/sales\//.test(workspace.slice(workspace.indexOf('export function reviewerAllowed'), workspace.indexOf('async function requireManager'))));

  const h = (sales.match(/export async function handleSalesInvoiceVoid\([\s\S]*?\n\}/) || [])[0] || '';
  ok('void: the handler exists', h.length > 0);
  ok('void: validates the id with UUID_RE BEFORE interpolating it', /if \(!UUID_RE\.test\(id\)\) return json\(\{ error: 'bad_request' \}, 400, cors\);/.test(h));
  const queries = h.match(/presence_invoices\?[^\`]*/g) || [];
  ok(`void: every presence_invoices query is site-scoped (${queries.length})`, queries.length >= 2 && queries.every((q) => q.includes('site_id=eq.${site.id}')));
  ok('void: the status guard rides in the PATCH\'s WHERE too (race-safe)', /status=eq\.open[^\`]*`,\s*\n?\s*\{ method: 'PATCH'/.test(h) || /status=eq\.open/.test(h.slice(h.indexOf('PATCH') - 260, h.indexOf('PATCH'))));
  ok('void: infra failure and the genuine race are told apart', /if \(!up\.ok\) return json\(\{ error: 'conflict'/.test(h) && /if \(!rows\(up\)\[0\]\)/.test(h));
  ok('void: it clears THIS invoice\'s invremind notice', /clearNotice\(site\.client_id, 'deal_followup', `invremind:\$\{id\}`\)/.test(h));
  ok('void: it deactivates the Stripe payment link so a withdrawn invoice can\'t be charged', /deactivatePaymentLink\(/.test(h));
  ok('void: it is NOT a soft delete — the row stays visible as Voided', !/deleted_at: nowIso\(\)/.test(h));

  // The protected-kind doc must name its teardowns honestly — the whole reason
  // this guard was allowed to stay undismissable.
  ok('inbox_feed no longer claims nothing can void an invoice', !/no route ever writes status:'void'/.test(feed));
  ok('inbox_feed names the void route as the invremind teardown', /\/sales\/invoices\/:id\/void/.test(feed));
  // A withdrawn invoice must not still be payable from the client portal.
  ok('client portal only offers a pay link on an OPEN invoice', /pay_url: \(i\.status === 'open' && i\.stripe_url\)/.test(delivery));
}

// ═══ A fake PostgREST — the filter grammar this route speaks ═════════════════
const world = { invoices: [], events: [], notices: [], escaped: [], patches: [], stripe: [] };
const jres = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const matches = (row, key, expr) => {
  if (expr === 'is.null') return row[key] === null || row[key] === undefined;
  if (expr === 'is.notnull') return row[key] !== null && row[key] !== undefined;
  const [op, ...rest] = expr.split('.');
  const want = decodeURIComponent(rest.join('.'));
  if (op === 'eq') return String(row[key]) === want;
  if (op === 'neq') return String(row[key]) !== want;
  throw new Error('fake PostgREST does not speak: ' + key + '=' + expr);
};
const TABLES = { presence_invoices: 'invoices', presence_deal_events: 'events', presence_plan_notices: 'notices' };
// A hook the race tests use to mutate the world BETWEEN the handler's read and
// its PATCH — the only honest way to simulate a payment landing mid-flight.
let onPatch = null;
// F1a: a fake Stripe. `stripeDeactivate` picks what the Payment Link PATCH does —
// 'ok' (Stripe confirms it is inactive), 'error' (a non-2xx: no such link, a
// revoked key, a rate limit) or 'throw' (the network). All three used to be
// byte-identical to the caller, which was the defect.
let stripeDeactivate = 'ok';
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  const u = new URL(url);
  if (u.hostname === 'api.stripe.com') {
    world.stripe.push(u.pathname);
    if (stripeDeactivate === 'throw') return Promise.reject(new Error('stripe unreachable'));
    if (stripeDeactivate === 'error') return Promise.resolve(jres(400, { error: { message: 'No such payment link' } }));
    return Promise.resolve(jres(200, { id: 'plink_1', active: false }));
  }
  const table = u.pathname.replace('/rest/v1/', '');
  if (u.hostname !== 'example.supabase.co' || !TABLES[table]) { world.escaped.push(url); return Promise.resolve(jres(500, { error: 'escaped the fake' })); }
  const bucket = world[TABLES[table]];
  const method = (init?.method || 'GET').toUpperCase();
  const filtered = () => {
    let out = bucket.slice();
    for (const [key, expr] of u.searchParams) {
      if (key === 'select' || key === 'order' || key === 'limit' || key === 'offset') continue;
      out = out.filter((r) => matches(r, key, expr));
    }
    const lim = Number(u.searchParams.get('limit'));
    return (Number.isFinite(lim) && lim > 0) ? out.slice(0, lim) : out;
  };
  if (method === 'GET') return Promise.resolve(jres(200, filtered()));
  if (method === 'POST') { const body = JSON.parse(init.body); bucket.push(body); return Promise.resolve(jres(201, [body])); }
  if (method === 'PATCH') {
    if (onPatch) { const f = onPatch; onPatch = null; f(table); }
    const patch = JSON.parse(init.body);
    const hit = filtered();
    world.patches.push({ table, search: u.search, patch, rows: hit.length });
    for (const r of hit) Object.assign(r, patch);
    return Promise.resolve(jres(200, hit));
  }
  return Promise.resolve(jres(405, { error: 'method not allowed in the fake' }));
};

const seed = () => {
  world.invoices = [
    { id: I_OPEN_SENT, site_id: SITE.id, deal_id: DEAL, title: 'Website build', amount_cents: 320000, purpose: 'service', status: 'open', stripe_url: 'https://pay.example/x', stripe_payment_link_id: 'plink_1', deleted_at: null },
    { id: I_OPEN_UNSENT, site_id: SITE.id, deal_id: DEAL, title: 'Deposit', amount_cents: 50000, purpose: 'deposit', status: 'open', stripe_url: null, stripe_payment_link_id: null, deleted_at: null },
    { id: I_PAID, site_id: SITE.id, deal_id: DEAL, title: 'Website build', amount_cents: 320000, purpose: 'service', status: 'paid', paid_at: '2026-01-04T00:00:00Z', stripe_url: 'https://pay.example/p', stripe_payment_link_id: 'plink_2', deleted_at: null },
    { id: I_VOID, site_id: SITE.id, deal_id: DEAL, title: 'Duplicate', amount_cents: 320000, purpose: 'service', status: 'void', stripe_url: null, stripe_payment_link_id: null, deleted_at: null },
    { id: I_OTHER, site_id: OTHER_SITE, deal_id: DEAL, title: 'Someone else’s invoice', amount_cents: 100000, purpose: 'service', status: 'open', stripe_url: null, stripe_payment_link_id: null, deleted_at: null },
  ];
  world.events = []; world.escaped = []; world.patches = []; world.stripe = []; stripeDeactivate = 'ok';
  // The undismissable money row this invoice stranded on Today.
  world.notices = [
    { id: 'n1', client_id: SITE.client_id, kind: 'deal_followup', period: `invremind:${I_OPEN_SENT}`, status: 'active' },
    { id: 'n2', client_id: SITE.client_id, kind: 'deal_followup', period: `invremind:${I_OPEN_UNSENT}`, status: 'active' },
    { id: 'n3', client_id: SITE.client_id, kind: 'deal_followup', period: 'declined:some-other-deal', status: 'active' },
  ];
};
const doVoid = async (id) => { const r = await handleSalesInvoiceVoid(SITE, PRINCIPAL, id, CORS); return { status: r.status, body: await r.json() }; };
const inv = (id) => world.invoices.find((r) => r.id === id);
const notice = (id) => world.notices.find((r) => r.id === id);

// ═══ 3. An open invoice voids — sent or not ═════════════════════════════════
{
  seed();
  const r = await doVoid(I_OPEN_SENT);
  ok('open+SENT invoice: voiding returns 200', r.status === 200, JSON.stringify(r.body));
  ok('open+SENT invoice: status is now void', inv(I_OPEN_SENT)?.status === 'void');
  ok('open+SENT invoice: the row is NOT deleted — the withdrawal stays on the record', world.invoices.length === 5 && inv(I_OPEN_SENT)?.deleted_at === null);
  ok('open+SENT invoice: the response says what it did', r.body?.data?.status === 'void' && r.body?.data?.id === I_OPEN_SENT);
  ok('open+SENT invoice: no other invoice moved', inv(I_OPEN_UNSENT)?.status === 'open' && inv(I_PAID)?.status === 'paid' && inv(I_OTHER)?.status === 'open');

  seed();
  const u = await doVoid(I_OPEN_UNSENT);
  ok('open+NEVER-SENT invoice: voiding returns 200', u.status === 200, JSON.stringify(u.body));
  ok('open+NEVER-SENT invoice: status is now void', inv(I_OPEN_UNSENT)?.status === 'void');
}

// ═══ 4. HALF THE POINT: the undismissable invremind row is cleared ══════════
{
  seed();
  await doVoid(I_OPEN_SENT);
  ok('void clears THIS invoice’s invremind notice', notice('n1')?.status === 'dismissed');
  ok('void leaves OTHER invoices’ reminders alone', notice('n2')?.status === 'active');
  ok('void leaves ordinary deal_followup rows alone (exact period, never a prefix sweep)', notice('n3')?.status === 'active');

  // A refused void must not clear anything — an unpaid obligation stays visible.
  seed();
  await doVoid(I_PAID);
  ok('a refused void clears NO notice', world.notices.every((n) => n.status === 'active'));
}

// ═══ 5. The audit trail records the withdrawal ══════════════════════════════
{
  seed();
  await doVoid(I_OPEN_SENT);
  const ev = world.events[0];
  ok('audit: voiding writes ONE deal event', world.events.length === 1);
  ok('audit: the event kind names what happened (invoice_voided)', ev?.kind === 'invoice_voided');
  ok('audit: the event is scoped to the deal AND the site', ev?.deal_id === DEAL && ev?.site_id === SITE.id);
  ok('audit: the event carries the invoice id and the amount withdrawn', ev?.detail?.invoice_id === I_OPEN_SENT && ev?.detail?.amount_cents === 320000);
  ok('audit: the event records WHO voided it', typeof ev?.actor === 'string' && ev.actor.length > 0);

  // A REFUSED void must not fabricate history.
  seed();
  await doVoid(I_PAID);
  await doVoid(I_OTHER);
  await doVoid('not-a-uuid');
  ok('audit: a refused void writes NO event', world.events.length === 0);
}

// ═══ 6. A PAID invoice is a financial record — 409, nothing written ═════════
{
  seed();
  const paid = await doVoid(I_PAID);
  ok('paid invoice: refused with 409', paid.status === 409, String(paid.status));
  ok('paid invoice: the error names the reason (already_paid)', paid.body?.error === 'already_paid');
  ok('paid invoice: the message says it is a financial record', /financial record/i.test(paid.body?.message || ''));
  ok('paid invoice: status is untouched', inv(I_PAID)?.status === 'paid');
  ok('paid invoice: NOTHING was PATCHed at all', world.patches.length === 0);
  ok('paid invoice: no event, no notice change', world.events.length === 0 && world.notices.every((n) => n.status === 'active'));
}

// ═══ 7. Already void → idempotent, and it does NOT re-run the side effects ══
{
  seed();
  const again = await doVoid(I_VOID);
  ok('already void: 200 (idempotent, like proposal-decide / contract-sign)', again.status === 200, String(again.status));
  ok('already void: flagged `already`', again.body?.already === true);
  ok('already void: nothing was written a second time', world.patches.length === 0 && world.events.length === 0);
}

// ═══ 8. THE RACE: the payment lands between our read and our PATCH ══════════
{
  seed();
  // The handler has already read status='open'. Flip it to paid the instant the
  // PATCH goes out — the WHERE (status=eq.open) must then match zero rows.
  onPatch = (table) => { if (table === 'presence_invoices') inv(I_OPEN_SENT).status = 'paid'; };
  const raced = await doVoid(I_OPEN_SENT);
  ok('race (paid mid-flight): refused with 409', raced.status === 409, String(raced.status));
  ok('race (paid mid-flight): the operator is told the payment landed, not a generic error', raced.body?.error === 'already_paid' && /landed/i.test(raced.body?.message || ''));
  ok('race (paid mid-flight): the invoice is still paid — the void did NOT overwrite it', inv(I_OPEN_SENT)?.status === 'paid');
  ok('race (paid mid-flight): the PATCH matched no row', world.patches.filter((p) => p.table === 'presence_invoices').every((p) => p.rows === 0));
  ok('race (paid mid-flight): the money notice was NOT cleared — the invoice is real', notice('n1')?.status === 'active');
  ok('race (paid mid-flight): no audit event was fabricated', world.events.length === 0);

  // The other race: a second tab already voided it. That IS the outcome asked for.
  seed();
  onPatch = (table) => { if (table === 'presence_invoices') inv(I_OPEN_SENT).status = 'void'; };
  const dup = await doVoid(I_OPEN_SENT);
  ok('race (voided by another tab): 200 already — the asked-for outcome is true', dup.status === 200 && dup.body?.already === true, String(dup.status));
  ok('race (voided by another tab): no duplicate audit event', world.events.length === 0);
}

// ═══ 9. Tenant isolation + malformed input ═════════════════════════════════
{
  seed();
  const cross = await doVoid(I_OTHER);
  ok('cross-tenant: another site’s open invoice is 404 (matches the sibling routes)', cross.status === 404, String(cross.status));
  ok('cross-tenant: it is untouched', inv(I_OTHER)?.status === 'open');
  ok('cross-tenant: nothing was PATCHed', world.patches.length === 0);

  seed();
  const bad = await doVoid('not-a-uuid');
  ok('malformed id: 400 before any query runs', bad.status === 400 && bad.body?.error === 'bad_request');
  const badPath = await doVoid('../../presence_sites');
  ok('malformed id: path-ish input is refused too', badPath.status === 400);
  ok('malformed id: no query was issued at all', world.patches.length === 0 && world.events.length === 0);

  seed();
  const missing = await doVoid('99999999-9999-4999-8999-999999999999');
  ok('unknown id: 404', missing.status === 404);
  ok('no request escaped the fake PostgREST', world.escaped.length === 0, world.escaped[0] || '');
}

// ═══ 10. The deal page offers Void exactly where the server allows it ═══════
{
  const invRow = (pipeline.match(/<div class="lrows">\$\{\(data\.invoices\|\|\[\]\)\.map\(v=>[\s\S]*?\)\.join\(''\)\}<\/div>/) || [])[0] || '';
  ok('deal page: the invoice row renders a void control', /data-void-inv=/.test(invRow));
  // It sits in the NOT-paid / NOT-void branch of the same ternary that already
  // draws Send / Copy link — so a paid row and a voided row never get one.
  const paidBranch = invRow.slice(0, invRow.indexOf('data-void-inv'));
  ok('deal page: the void control is inside the not-paid branch', /v\.status==='paid'\?/.test(paidBranch) && /v\.status==='void'\?/.test(paidBranch));
  ok('deal page: the existing Voided render is still there for a row that reaches that state', /v\.status==='void'\?`<span class="mut">Voided<\/span>`/.test(invRow));
  ok('deal page: voiding confirms first (same idiom as the draft deletes)', /\[data-void-inv\][\s\S]{0,320}confirm\(/.test(pipeline));
  // The handler is the ONE shared wiring (wireInvoiceActions) now — the drawer
  // and the "Who owes you" receivables list both call it, each with its own
  // refresh: the drawer re-opens the deal, the list re-fetches itself (so a
  // voided row leaves and the Outstanding total moves) + re-totals the AR strip.
  ok('deal page: it POSTs the right route and re-renders the surface it was tapped on', /api\('\/sales\/invoices\/'\+b\.dataset\.voidInv\+'\/void','POST'/.test(pipeline) && /\[data-void-inv\][\s\S]{0,700}refresh\(\)/.test(pipeline));
  ok('deal page: the drawer wires the shared handler with a deal re-open', /wireInvoiceActions\(\$\('detailInner'\),\(\)=>openDeal\(id\)\)/.test(pipeline));
  ok('receivables list: the SAME shared handler is wired with a list re-read + AR re-total', /wireInvoiceActions\(\$\('detailInner'\),\(\)=>\{openReceivables\(\);renderSummary\(\);\}\)/.test(pipeline));
  ok('deal page: it toasts on success and on failure (page idiom)', /\[data-void-inv\][\s\S]{0,600}toast\([\s\S]{0,120}nice\(e\),true\)/.test(pipeline));
}

// ═══ 11. F1a: "voided" must not mean three different things ════════════════
// deactivatePaymentLink returned void and swallowed BOTH a throw and a non-2xx,
// so "Stripe confirmed the link is dead", "Stripe said no" and "Stripe was
// unreachable" all produced the identical {"ok":true,"status":"void"} and the
// operator was told a flat "Invoice voided". A client paying through a link the
// studio believes is switched off is exactly the case this route exists to
// prevent, so the one thing the operator must not be told is a guess.
//
// The ORDERING is unchanged and stays that way: the status write comes first, so
// a Stripe hiccup can never leave a void that did not happen. Reporting the
// outcome is additive to that.
{
  seed();
  const okv = await doVoid(I_OPEN_SENT);
  ok('link: the invoice’s payment link is deactivated at Stripe',
    world.stripe.some((p) => p.includes('payment_links/plink_1')), JSON.stringify(world.stripe));
  ok('link: a confirmed deactivation reports link_deactivated true', okv.body?.data?.link_deactivated === true, JSON.stringify(okv.body));

  seed(); stripeDeactivate = 'error';
  const err = await doVoid(I_OPEN_SENT);
  ok('link: a NON-2XX from Stripe still voids the invoice (the row is the authority, not Stripe)',
    err.status === 200 && inv(I_OPEN_SENT)?.status === 'void', JSON.stringify(err.body));
  ok('link: …and it is reported as NOT deactivated', err.body?.data?.link_deactivated === false, JSON.stringify(err.body));

  seed(); stripeDeactivate = 'throw';
  const thr = await doVoid(I_OPEN_SENT);
  ok('link: a THROWN Stripe call still voids the invoice', thr.status === 200 && inv(I_OPEN_SENT)?.status === 'void');
  ok('link: …and is reported as not deactivated too (a 400 and a dead network are both "may still be live")',
    thr.body?.data?.link_deactivated === false, JSON.stringify(thr.body));
  ok('link: a failed deactivation never blocks the rest of the void (notice cleared, event written)',
    notice('n1')?.status === 'dismissed' && world.events.length === 1);

  seed();
  const none = await doVoid(I_OPEN_UNSENT);
  ok('link: an invoice that never had a link reports null — nothing to take down is not a failure',
    none.body?.data?.link_deactivated === null, JSON.stringify(none.body));
  ok('link: …and no Stripe call was made for it', world.stripe.length === 0, JSON.stringify(world.stripe));

  // the point of the whole change: the three outcomes are DISTINGUISHABLE
  seed(); const a = await doVoid(I_OPEN_SENT);
  seed(); stripeDeactivate = 'error'; const b = await doVoid(I_OPEN_SENT);
  ok('link: a confirmed deactivation and a failed one no longer return identical bodies',
    JSON.stringify(a.body) !== JSON.stringify(b.body), JSON.stringify(a.body));

  ok('link: deactivatePaymentLink REPORTS instead of swallowing (returns a boolean)',
    /export async function deactivatePaymentLink\(linkId: string\): Promise<boolean>/.test(stripeLib), 'still Promise<void>?');
  ok('link: …and a failure is logged loudly rather than dropped on the floor',
    /console\.error\([^\n]*deactivate[\s\S]{0,200}?return false;/i.test(stripeLib));
}

// ═══ 12. F1a: the deal page tells the operator the truth ═══════════════════
{
  // the whole click handler: from the selector to the catch that re-enables the
  // button (a non-greedy `});` stops at the api() call's own argument list)
  const vi = pipeline.indexOf("[data-void-inv]')");
  const vEnd = vi < 0 ? -1 : pipeline.indexOf('b.disabled=false;}});', vi);
  const voidHandler = vEnd < 0 ? '' : pipeline.slice(vi, vEnd + 'b.disabled=false;}});'.length);
  ok('deal page: the void toast branches on link_deactivated', /link_deactivated\s*===\s*false/.test(voidHandler), voidHandler.slice(0, 200));
  ok('deal page: …and says the link may still be live', /may still be live/i.test(voidHandler), voidHandler.slice(0, 400));
  ok('deal page: …and says what to do about it (switch it off in Stripe)', /in Stripe/i.test(voidHandler));
  ok('deal page: a clean void still reads as a plain success', /Invoice voided'/.test(voidHandler));
  ok('deal page: the confirm no longer promises a switch-off it cannot guarantee',
    !/the payment link is switched off/.test(pipeline));
}

// ═══ 13. F1b: money against a WITHDRAWN invoice is visible in the app ══════
// markPresenceInvoicePaid correctly refuses to resurrect a voided invoice — but
// the ONLY record of that refusal was a console.log and a stripe_payments row,
// neither of which is in the product. Two ordinary ways a client still pays one:
// the deactivation silently failed (section 11), or they already had a Checkout
// Session open — deactivating a Payment Link does NOT kill sessions already
// minted from it. Either way the studio is holding money on an invoice it
// withdrew and has to decide whether to refund, so it has to SEE it.
{
  const fn = (webhook.match(/const markPresenceInvoicePaid[\s\S]*?\n  \};/) || [''])[0];
  ok('webhook: markPresenceInvoicePaid was found', fn.length > 400, `${fn.length} bytes`);
  ok('webhook: a voided invoice is still NEVER flipped to paid (the guard is untouched)',
    /if \(inv\.status !== 'open'\)/.test(fn) && /ok \(not open\)/.test(fn));
  const notOpen = fn.slice(fn.indexOf("if (inv.status !== 'open')"), fn.indexOf('ok (not open)'));
  ok('webhook: the not-open branch raises an operator notice when the invoice is VOID',
    /inv\.status === 'void'/.test(notOpen) && /noticeVoidedInvoicePaid\(/.test(notOpen), notOpen);
  ok('webhook: …and ONLY when it is void (a paid/unknown status is not a withdrawal)',
    !/inv\.status !== 'void'/.test(notOpen));

  const helper = (webhook.match(/const noticeVoidedInvoicePaid = async[\s\S]*?\n  \};/) || [''])[0];
  ok('webhook: the notice is its own unit', helper.length > 300, `${helper.length} bytes`);
  ok('webhook: it rides the ONE notice model (presence_plan_notices) — no second system',
    /db\('presence_plan_notices', 'POST'/.test(helper));
  ok('webhook: it is keyed per-invoice, so a Stripe retry raises nothing twice',
    /period: `voidpaid:\$\{inv\.id\}`/.test(helper));
  ok('webhook: it is an ACTIVE row — it needs the operator, it is not a silent ledger',
    /status: 'active'/.test(helper));
  ok('webhook: the copy says the money arrived AND that the invoice stays void',
    /voided/i.test(helper) && /not been marked paid|has not been marked/i.test(helper));
  ok('webhook: …and names the decision the operator has to make (refund it in Stripe)',
    /refund/i.test(helper) && /Stripe/.test(helper));
  ok('webhook: it can never affect payment processing — whole body swallowed, no throw',
    /=>\s*\{\s*\n\s*try \{/.test(helper) && /\}\s*catch \([^)]*\) \{/.test(helper) && !/\bthrow\b/.test(helper));
  ok('webhook: the refusal is logged as an ERROR now, not an ordinary log line',
    /console\.error\([^\n]*VOIDED/.test(helper) || /console\.error\([^\n]*voided/i.test(helper));
  ok('webhook: the notice kind is not one that claims the invoice was paid',
    !/kind: 'invoice_paid'/.test(helper));
  ok('webhook: it resolves the owning client before writing (a notice with no client is a no-op)',
    /presence_sites\?id=eq\./.test(helper) && /if \(!clientId\) return/.test(helper));

  // the bell/Today row has to LAND somewhere useful, and must not wear the
  // green tick that means "paid, nothing to do"
  ok('workspace: the new kind deep-links to the deal it happened on', /invoice_void_paid: '\/pipeline\.html'/.test(workspace));
  const today = read('today.html');
  ok('today: the row is NOT filed as good-news FYI (it needs a decision)',
    !/NOTICE_FYI_KINDS = \[[^\]]*invoice_void_paid/.test(today));
  ok('today: …and it does not borrow invoice_paid\u2019s green tick', /invoice_void_paid:/.test(today) && !/invoice_void_paid:'\ud83d\udc9a'/.test(today));
}

// ═══ 14. F1b: the notice kind's CHECK constraint (0119) ═══════════════════
// raiseNotice / the webhook's insert are best-effort, so an un-widened CHECK does
// not fail the payment — it drops the notice SILENTLY, which is the exact gap
// being closed. Same ordering rule as 0116/0118: migrate BEFORE the deploy.
{
  const kinds = (sql) => {
    const i = sql.indexOf('check (kind in (');
    return (sql.slice(i, sql.indexOf('));', i)).replace(/--[^\n]*/g, '').match(/'[a-z_]+'/g) || []).map((x) => x.slice(1, -1));
  };
  const now = kinds(mig119);
  ok('0119 widens the notice kind check', now.length > 0);
  ok('0119 allows invoice_void_paid (the kind the webhook writes)', now.includes('invoice_void_paid'));
  ok('0119 is ADDITIVE — every kind 0116 allowed is carried forward verbatim',
    kinds(mig116).every((k) => now.includes(k)), kinds(mig116).filter((k) => !now.includes(k)).join(','));
  ok('0119 is idempotent (drop if exists, then add)',
    /drop constraint if exists presence_plan_notices_kind_check/.test(mig119) && /add constraint presence_plan_notices_kind_check/.test(mig119));
  ok('0119 documents its rollback', /rollback:/.test(mig119));
  ok('0119 states the deploy order and what a late migration silently costs',
    /BEFORE/i.test(mig119) && /silent/i.test(mig119));
  ok('0119 states it is additive · idempotent · RLS untouched',
    /additive/i.test(mig119) && /idempotent/i.test(mig119) && /RLS/i.test(mig119));
  // the new kind must NOT be protected — nothing in this app can ever clear it
  // (the resolution is a Stripe refund), so only the operator can say it's done.
  ok('the new kind is dismissable — its resolution happens outside this app',
    !/'invoice_void_paid'/.test((feed.match(/NOTICE_PROTECTED_KINDS[\s\S]*?\]\)/) || [''])[0]));
}

const failed = results.filter((r) => !r.p);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log('FAILED:'); for (const f of failed) console.log('  - ' + f.n); Deno.exit(1); }
