// ── Estimates (sales review item 47, Nov 2026): the real routes ──────────────
// A price before anything is agreed, as Eric chose it on Nov 8: an email with one
// button to a page with the lines, the total, and Approve or Not now with an
// optional note; good for 30 days; one reminder after 3 days; printable.
// Approving puts a line in Needs you and fills an empty deal value, never the
// stage; Turn into a proposal and Bill it as an invoice make drafts only.
// Real handlers against the shared in-memory PostgREST; all names are made up.
//   deno run --allow-read --allow-env --allow-net tests/presence/estimates_test.mjs
Deno.env.set('APPROVAL_SECRET', 'sign-secret-for-tests-0123456789abcdef');
Deno.env.set('RESEND_KEY', 'test-resend-key');
Deno.env.set('EMAIL_FROM', 'Example Studio <hello@example.com>');
Deno.env.set('SITE_URL', 'https://app.example.com');
Deno.env.set('RESEND_INBOUND_DOMAIN', 'reply.example.com');   // a client's answer to a site's email comes back to its Inbox
Deno.env.delete('STRIPE_SECRET');   // a studio without Stripe: the recurring check at the end needs it off
import { installFakePostgrest } from './fake_pgrst.mjs';
const uuid = (c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const SITE = uuid('1'), OWNER = uuid('2'), U = uuid('3'), CT = uuid('4'), DEAL = uuid('5'), EST = uuid('6'), EST2 = uuid('7'), PROP = uuid('8'), OTHER_SITE = uuid('9');
const db = installFakePostgrest({ users: { 'jwt-owner': { id: U, email: 'owner@example.com' } }, ownSite: { 'jwt-owner': SITE } });
// the mail and the outside world: Resend answers 200 and keeps what it was given
const pg = globalThis.fetch;
const mail = [];
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (u.hostname === 'api.resend.com') { mail.push(JSON.parse(String(init.body || '{}'))); return new Response(JSON.stringify({ id: `em_${mail.length}` }), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
  return pg(url, init);
};
const ES = await import('../../supabase/functions/presence/routes/estimates.ts');
const SALES = await import('../../supabase/functions/presence/routes/sales.ts');
const LC = await import('../../supabase/functions/presence/commerce/lifecycle.ts');
const NY = await import('../../supabase/functions/presence/agency/needs_you.ts');
const WS = await import('../../supabase/functions/presence/routes/workspace.ts');
const FEED = await import('../../supabase/functions/presence/lib/inbox_feed.ts');
const DOCS = await import('../../supabase/functions/presence/lib/documents.ts');
const RI = await import('../../supabase/functions/presence/routes/recurring_invoices.ts');

let pass = 0, fail = 0;
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; console.log('FAIL ', n, note); } };
const cors = {};
const site = { id: SITE, client_id: OWNER, status: 'live', edition: 'presence' };
const owner = { kind: 'client', userId: U, email: 'owner@example.com', jwt: 'jwt-owner', requestId: 't' };
const req = (method, path, body) => new Request(`https://fn.test/functions/v1/presence${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const res = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const daysAgo = (n) => new Date(Date.now() - n * 86400_000).toISOString();
const daysAhead = (n) => new Date(Date.now() + n * 86400_000).toISOString();
const LINES = [{ label: 'Homepage refresh', qty: 1, unit_cents: 90000 }, { label: 'Menu page', qty: 2, unit_cents: 20000 }];
const events = (kind) => (db.tables.presence_deal_events || []).filter((e) => !kind || e.kind === kind);
const notices = (kind) => (db.tables.presence_plan_notices || []).filter((n) => !kind || n.kind === kind);
const est = (id = EST) => (db.tables.presence_estimates || []).find((e) => e.id === id);
const world = (extra = {}) => {
  db.reset({
    presence_sites: [{ id: SITE, client_id: OWNER }, { id: OTHER_SITE, client_id: uuid('a') }],
    presence_deals: [{ id: DEAL, site_id: SITE, title: 'Blue Finch Café website', stage: 'qualified', contact_id: CT, expected_value_cents: 0, deleted_at: null }],
    presence_contacts: [{ id: CT, site_id: SITE, name: 'Riley Park', email: 'riley@example.org', company: 'Blue Finch Café' }],
    ...extra,
  });
  db.fail.add('rpc/rate_hit');   // the limiter fails open
  mail.length = 0;
};
const sentEstimate = (over = {}) => ({ id: EST, site_id: SITE, deal_id: DEAL, title: 'Spring refresh', line_items: [...LINES, { __meta__: { discount: { mode: 'percent', value: 10 } } }], subtotal_cents: 130000, currency: 'usd', terms: '', status: 'sent', sent_at: daysAgo(1), expires_at: daysAhead(29), first_viewed_at: null, decided_at: null, decided_note: '', proposal_id: null, invoice_id: null, deleted_at: null, ...over });
const tokenFor = async (id, site_id = SITE, t = 'estimate') => SALES.signSalesToken({ t, id, site_id, exp: Math.floor(Date.now() / 1000) + 86400 }, SALES.linkSecret());
// Before APPLY-0145 the tables aren't there: PostgREST answers 404 PGRST205.
const before0145 = (fn) => async (...a) => {
  const fake = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url));
    if (/\/rest\/v1\/presence_(estimates|recurring_invoices)/.test(u)) return new Response(JSON.stringify({ code: 'PGRST205', message: "Could not find the table 'public.presence_estimates' in the schema cache" }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    return fake(url, init);
  };
  try { return await fn(...a); } finally { globalThis.fetch = fake; }
};

// ═══ 1. make one ═══
{
  world();
  const r = await res(await ES.handleEstimateCreate(req('POST', `/sales/deals/${DEAL}/estimates`, { line_items: LINES, discount: { mode: 'percent', value: 10 }, tax_pct: 8 }), site, owner, DEAL, cors));
  const row = (db.tables.presence_estimates || [])[0];
  ok('1: a draft estimate with its lines, discount and tax', r.status === 201 && row && row.status === 'draft' && row.site_id === SITE && row.deal_id === DEAL && row.title === 'Estimate' && row.subtotal_cents === 130000, JSON.stringify(r.body));
  ok('1: its total is after discount and tax ($1,300 − 10% + 8% = $1,263.60)', r.body?.data?.total_cents === 126360, String(r.body?.data?.total_cents));
  ok('1: nothing went to the client', mail.length === 0 && events().length === 0);
  const bad = await res(await ES.handleEstimateCreate(req('POST', `/sales/deals/${DEAL}/estimates`, { line_items: [] }), site, owner, DEAL, cors));
  ok('1: it needs at least one line', bad.status === 422);
  const nodeal = await res(await ES.handleEstimateCreate(req('POST', `/sales/deals/${uuid('b')}/estimates`, { line_items: LINES }), site, owner, uuid('b'), cors));
  ok('1: only on a deal of this studio', nodeal.status === 404);
  const early = await res(await before0145(() => ES.handleEstimateCreate(req('POST', `/sales/deals/${DEAL}/estimates`, { line_items: LINES }), site, owner, DEAL, cors))());
  ok('1: before the database step it says so, plainly', early.status === 503 && /one-time database update/.test(early.body?.message), JSON.stringify(early.body));
}

// ═══ 2. send it ═══
{
  world({ presence_estimates: [sentEstimate({ status: 'draft', sent_at: null, expires_at: null })] });
  const r = await res(await ES.handleEstimateSend(req('POST', `/sales/estimates/${EST}/send`, {}), site, owner, EST, cors));
  const row = est();
  ok('2: draft → sent, good for 30 days', r.status === 200 && row.status === 'sent' && row.sent_at && Math.abs(Date.parse(row.expires_at) - Date.now() - 30 * 86400_000) < 60_000, JSON.stringify(r.body));
  ok('2: one email, to the deal\'s contact, "Your estimate from …"', mail.length === 1 && mail[0].to === 'riley@example.org' && /^Your estimate from /.test(mail[0].subject), JSON.stringify(mail.map((m) => m.subject)));
  ok('2: it shows the total, says nothing is charged, and has one button to its own page', /\$1,170\.00/.test(mail[0].html) && /nothing is charged/.test(mail[0].html) && /href="https:\/\/app\.example\.com\/sign\.html\?t=[^"]+"[^>]*>See the estimate →/.test(mail[0].html));
  const t = /sign\.html\?t=([^"&]+)/.exec(mail[0].html)?.[1];
  const tok = await SALES.verifySalesToken(t, SALES.linkSecret(), Math.floor(Date.now() / 1000));
  ok('2: the link names this estimate, on this studio', tok && tok.t === 'estimate' && tok.id === EST && tok.site_id === SITE);
  ok('2: their reply comes back to the Inbox (the send carries the site)', mail[0].reply_to === `${SITE}@reply.example.com`, String(mail[0].reply_to));
  ok('2: the deal says so', events('estimate_sent').length === 1 && events('estimate_sent')[0].detail.estimate_id === EST && events('estimate_sent')[0].detail.total_cents === 117000);
  ok('2: the stage doesn\'t move', db.tables.presence_deals[0].stage === 'qualified');
  const again = await res(await ES.handleEstimateSend(req('POST', `/sales/estimates/${EST}/send`, {}), site, owner, EST, cors));
  ok('2: pressing Send again hands back the link and emails nobody twice', again.status === 200 && again.body.already_sent === true && /sign\.html\?t=/.test(again.body.url) && mail.length === 1 && events('estimate_sent').length === 1);
  db.tables.presence_estimates[0].status = 'approved';
  const done = await res(await ES.handleEstimateSend(req('POST', `/sales/estimates/${EST}/send`, {}), site, owner, EST, cors));
  ok('2: an answered estimate can\'t be sent again', done.status === 409);
  world({ presence_estimates: [sentEstimate({ status: 'draft', site_id: OTHER_SITE })] });
  ok('2: another studio\'s estimate isn\'t here', (await ES.handleEstimateSend(req('POST', '/x', {}), site, owner, EST, cors)).status === 404);
}

// ═══ 3. the client's page ═══
{
  world({ presence_estimates: [sentEstimate()] });
  const view = await res(await SALES.handleSalesPublicView(req('GET', '/sales/p/x'), await tokenFor(EST), cors));
  const d = view.body?.data;
  ok('3: the estimate link opens the estimate', view.status === 200 && d.kind === 'estimate' && d.id === EST && d.title === 'Spring refresh' && d.status === 'sent' && d.expired === false && Array.isArray(d.line_items), JSON.stringify(view.body).slice(0, 200));
  ok('3: it carries no ids beyond its own', !('deal_id' in d) && !('site_id' in d) && !('proposal_id' in d));
  ok('3: the first open is on the deal: "They opened your estimate"', events('doc_opened').length === 1 && events('doc_opened')[0].detail.what === 'estimate' && est().first_viewed_at);
  await SALES.handleSalesPublicView(req('GET', '/sales/p/x'), await tokenFor(EST), cors);
  ok('3: a second open adds nothing', events('doc_opened').length === 1);
  db.tables.presence_estimates[0].status = 'draft';
  ok('3: a draft can\'t be seen through a link', (await SALES.handleSalesPublicView(req('GET', '/sales/p/x'), await tokenFor(EST), cors)).status === 404);
  world({ presence_estimates: [sentEstimate()], presence_proposals: [{ id: EST, site_id: SITE, deal_id: DEAL, status: 'sent', line_items: LINES, title: 'P' }] });
  const asProposal = await res(await SALES.handleSalesProposalDecide(req('POST', `/sales/proposals/${EST}/decide`, { token: await tokenFor(EST), decision: 'accepted' }), EST, cors));
  ok('3: an estimate link can never accept a proposal', asProposal.status === 403);
  const asSign = await res(await SALES.handleSalesContractSign(req('POST', `/sales/contracts/${EST}/sign`, { token: await tokenFor(EST), signer_name: 'X' }), EST, cors));
  ok('3: …or sign an agreement', asSign.status === 403);
}

// ═══ 4. Approve ═══
{
  world({ presence_estimates: [sentEstimate()] });
  const tok = await tokenFor(EST);
  const r = await res(await ES.handleEstimateDecide(req('POST', `/sales/estimates/${EST}/decide`, { token: tok, decision: 'approved', note: 'Looks good — can we start in May?' }), EST, cors));
  const row = est();
  ok('4: approved, with their note', r.status === 200 && row.status === 'approved' && row.decided_at && row.decided_note === 'Looks good — can we start in May?', JSON.stringify(r.body));
  ok('4: an empty deal value takes the estimate\'s total', db.tables.presence_deals[0].expected_value_cents === 117000);
  ok('4: the stage never moves', db.tables.presence_deals[0].stage === 'qualified');
  const ev = events('estimate_decided');
  ok('4: the deal says so', ev.length === 1 && ev[0].detail.decision === 'approved' && ev[0].detail.total_cents === 117000 && ev[0].detail.value_backfilled_cents === 117000 && ev[0].detail.note && ev[0].actor_kind === 'public');
  const n = notices('deal_signed')[0];
  ok('4: a Needs-you line for the studio', n && n.client_id === OWNER && n.status === 'active' && n.period === `estimate:${DEAL}:${EST}` && n.headline === 'Estimate approved — Blue Finch Café website ($1,170.00)' && /Turn it into a proposal or bill it as an invoice/.test(n.body), JSON.stringify(n));
  ok('4: no email to the client for it', mail.length === 0);
  const twice = await res(await ES.handleEstimateDecide(req('POST', `/sales/estimates/${EST}/decide`, { token: tok, decision: 'approved' }), EST, cors));
  ok('4: a second tap changes nothing', twice.status === 200 && twice.body.already === true && events('estimate_decided').length === 1);
  const flip = await res(await ES.handleEstimateDecide(req('POST', `/sales/estimates/${EST}/decide`, { token: tok, decision: 'declined' }), EST, cors));
  ok('4: …and an answer can\'t be changed from the link', flip.status === 409 && est().status === 'approved');
  world({ presence_estimates: [sentEstimate()], presence_deals: [{ id: DEAL, site_id: SITE, title: 'Blue Finch Café website', stage: 'proposal', contact_id: CT, expected_value_cents: 500000 }] });
  await ES.handleEstimateDecide(req('POST', '/x', { token: await tokenFor(EST), decision: 'approved' }), EST, cors);
  ok('4: a deal value the studio set is kept', db.tables.presence_deals[0].expected_value_cents === 500000 && !events('estimate_decided')[0].detail.value_backfilled_cents);
  world({ presence_estimates: [sentEstimate({ expires_at: daysAgo(1) })] });
  const late = await res(await ES.handleEstimateDecide(req('POST', '/x', { token: await tokenFor(EST), decision: 'approved' }), EST, cors));
  ok('4: past 30 days it can\'t be approved', late.status === 409 && late.body.error === 'expired' && est().status === 'sent');
  const lateNo = await res(await ES.handleEstimateDecide(req('POST', '/x', { token: await tokenFor(EST), decision: 'declined' }), EST, cors));
  ok('4: …but Not now still works', lateNo.status === 200 && est().status === 'declined');
}

// ═══ 5. Not now, and bad links ═══
{
  world({ presence_estimates: [sentEstimate()] });
  const r = await res(await ES.handleEstimateDecide(req('POST', '/x', { token: await tokenFor(EST), decision: 'declined', note: 'Maybe next quarter' }), EST, cors));
  ok('5: Not now is stored as declined, with the note', r.status === 200 && est().status === 'declined' && est().decided_note === 'Maybe next quarter');
  const n = notices('deal_followup')[0];
  ok('5: the studio hears, with the note, as a follow-up', n && n.period === `estdeclined:${DEAL}:${EST}` && n.headline === 'They passed on the estimate — Blue Finch Café website' && /They chose Not now: “Maybe next quarter”/.test(n.body) && n.status === 'active');
  ok('5: no deal value, no stage change', db.tables.presence_deals[0].expected_value_cents === 0 && db.tables.presence_deals[0].stage === 'qualified');
  world({ presence_estimates: [sentEstimate(), sentEstimate({ id: EST2 })] });
  const other = await res(await ES.handleEstimateDecide(req('POST', '/x', { token: await tokenFor(EST2), decision: 'approved' }), EST, cors));
  ok('5: one estimate\'s link can\'t answer another', other.status === 403 && est().status === 'sent');
  const flow = await res(await ES.handleEstimateDecide(req('POST', '/x', { token: await tokenFor(DEAL, SITE, 'flow'), decision: 'approved' }), EST, cors));
  ok('5: a proposal\'s link can\'t answer an estimate', flow.status === 403);
  const forged = (await tokenFor(EST)).replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'));
  ok('5: a changed link is refused', (await ES.handleEstimateDecide(req('POST', '/x', { token: forged, decision: 'approved' }), EST, cors)).status === 403);
  ok('5: only Approve or Not now', (await ES.handleEstimateDecide(req('POST', '/x', { token: await tokenFor(EST), decision: 'accepted' }), EST, cors)).status === 422);
  const theirs = await tokenFor(EST, OTHER_SITE);
  ok('5: a link minted for another studio finds nothing here', (await ES.handleEstimateDecide(req('POST', '/x', { token: theirs, decision: 'approved' }), EST, cors)).status === 404 && est().status === 'sent');
}

// ═══ 6. Turn into a proposal ═══
{
  world({ presence_estimates: [sentEstimate({ status: 'approved', terms: 'Photos supplied by you.' })], presence_plan_notices: [{ id: uuid('c'), client_id: OWNER, site_id: SITE, kind: 'deal_signed', period: `estimate:${DEAL}:${EST}`, status: 'active', headline: 'Estimate approved — x' }] });
  const r = await res(await ES.handleEstimateToProposal(req('POST', `/sales/estimates/${EST}/proposal`, {}), site, owner, EST, cors));
  const p = (db.tables.presence_proposals || [])[0];
  ok('6: a proposal DRAFT with the same lines, discount and notes', r.status === 201 && p && p.status === 'draft' && p.deal_id === DEAL && p.title === 'Spring refresh' && p.terms === 'Photos supplied by you.' && JSON.stringify(p.line_items) === JSON.stringify(sentEstimate().line_items), JSON.stringify(p));
  ok('6: the estimate remembers it', est().proposal_id === p.id);
  ok('6: the Needs-you line is done', notices('deal_signed')[0].status === 'dismissed');
  ok('6: nothing went to the client, and no proposal was sent', mail.length === 0 && events('proposal_sent').length === 0);
  const again = await res(await ES.handleEstimateToProposal(req('POST', '/x', {}), site, owner, EST, cors));
  ok('6: pressing it again returns the same proposal', again.status === 200 && again.body.already === true && again.body.data.id === p.id && db.tables.presence_proposals.length === 1);
  world({ presence_estimates: [sentEstimate({ title: 'Estimate' })] });
  await ES.handleEstimateToProposal(req('POST', '/x', {}), site, owner, EST, cors);
  ok('6: an estimate still called "Estimate" becomes a "Proposal"', db.tables.presence_proposals[0].title === 'Proposal');
}

// ═══ 7. Bill it as an invoice ═══
{
  world({ presence_estimates: [sentEstimate({ status: 'approved' })], presence_deals: [{ id: DEAL, site_id: SITE, title: 'Blue Finch Café website', stage: 'won', contact_id: CT, expected_value_cents: 117000, converted_client_id: uuid('d'), converted_site_id: uuid('e') }] });
  const r = await res(await ES.handleEstimateToInvoice(req('POST', `/sales/estimates/${EST}/invoice`, {}), site, owner, EST, cors));
  const v = (db.tables.presence_invoices || [])[0];
  ok('7: an open invoice for the estimate\'s total, NOT sent', r.status === 201 && v && v.status === 'open' && v.amount_cents === 117000 && v.purpose === 'service' && !v.stripe_url && v.title === 'Spring refresh', JSON.stringify(v));
  ok('7: …which their portal can show (a customer\'s deal)', v.customer_client_id === uuid('d') && v.customer_site_id === uuid('e'));
  ok('7: the estimate remembers it; nothing was emailed', est().invoice_id === v.id && mail.length === 0 && events('invoice_sent').length === 0);
  const again = await res(await ES.handleEstimateToInvoice(req('POST', '/x', {}), site, owner, EST, cors));
  ok('7: pressing it again returns the same invoice', again.status === 200 && again.body.already === true && db.tables.presence_invoices.length === 1);
  db.tables.presence_invoices[0].status = 'void';
  const afterVoid = await res(await ES.handleEstimateToInvoice(req('POST', '/x', {}), site, owner, EST, cors));
  ok('7: a voided one can be billed again', afterVoid.status === 201 && db.tables.presence_invoices.length === 2);
  world({ presence_estimates: [sentEstimate({ line_items: [{ label: 'Tiny', qty: 1, unit_cents: 40 }] })] });
  ok('7: under $0.50 there\'s nothing to bill', (await ES.handleEstimateToInvoice(req('POST', '/x', {}), site, owner, EST, cors)).status === 422);
}

// ═══ 8. remove a draft ═══
{
  world({ presence_estimates: [sentEstimate({ status: 'draft' })] });
  const r = await res(await ES.handleEstimateDelete(site, owner, EST, cors));
  ok('8: a draft goes, softly, and the deal says so', r.status === 200 && est().deleted_at && events('estimate_deleted').length === 1);
  world({ presence_estimates: [sentEstimate()] });
  const sent = await res(await ES.handleEstimateDelete(site, owner, EST, cors));
  ok('8: a sent one stays on the record', sent.status === 409 && !est().deleted_at);
}

// ═══ 9. the reminder after three days ═══
{
  world({ presence_estimates: [sentEstimate({ sent_at: daysAgo(4) }), sentEstimate({ id: EST2, sent_at: daysAgo(4), expires_at: daysAgo(1) })] });
  await LC.runSalesDocReminders(20);
  await new Promise((s) => setTimeout(s, 20));   // the reminder email is fire-and-forget
  ok('9: one reminder, with the estimate\'s own link', mail.length === 1 && /^Still there for you — Spring refresh/.test(mail[0].subject) && /See the estimate →/.test(mail[0].html) && /approve it, or say not now/.test(mail[0].html), JSON.stringify(mail.map((m) => m.subject)));
  const t = /sign\.html\?t=([^"&]+)/.exec(mail[0]?.html || '')?.[1];
  const tok = t && await SALES.verifySalesToken(decodeURIComponent(t), SALES.linkSecret(), Math.floor(Date.now() / 1000));
  ok('9: …an estimate link, not the deal\'s proposal page', tok && tok.t === 'estimate' && tok.id === EST);
  ok('9: an expired one gets none', !notices('deal_followup').some((n) => n.period === `remind:${EST2}`) && notices('deal_followup').some((n) => n.period === `remind:${EST}` && n.status === 'dismissed'));
  await LC.runSalesDocReminders(20);
  await new Promise((s) => setTimeout(s, 20));
  ok('9: once, ever', mail.length === 1);
}

// ═══ 10. where the studio sees it ═══
{
  const sig = (period, kind = 'deal_signed', headline = 'Estimate approved — Blue Finch Café website ($1,170.00)') => ({ id: period, kind, period, headline, body: 'x', tier: FEED.noticeTier(kind), href: WS.noticeHrefFor({ kind, period }) });
  ok('10: each new notice opens that deal\'s Billing', WS.noticeHrefFor({ kind: 'deal_signed', period: `estimate:${DEAL}:${EST}` }) === `/pipeline.html?deal=${DEAL}&dtab=billing`
    && WS.noticeHrefFor({ kind: 'deal_followup', period: `estdeclined:${DEAL}:${EST}` }) === `/pipeline.html?deal=${DEAL}&dtab=billing`
    && WS.noticeHrefFor({ kind: 'deal_followup', period: `recurpause:${DEAL}:${EST}:2026-12-01` }) === `/pipeline.html?deal=${DEAL}&dtab=billing`
    && WS.noticeHrefFor({ kind: 'invoice_upcoming', period: `recurnext:${DEAL}:${EST}:2026-12-01` }) === `/pipeline.html?deal=${DEAL}&dtab=billing`);
  ok('10: …and the old shapes keep theirs', WS.noticeHrefFor({ kind: 'deal_signed', period: `signed:${DEAL}` }) === `/pipeline.html?deal=${DEAL}#convert` && WS.noticeHrefFor({ kind: 'deal_followup', period: `deal:${DEAL}:w3` }) === '/pipeline.html');
  ok('10: the heads-up is news (Updates); the approval and the pause ask (Needs you)', FEED.noticeTier('invoice_upcoming') === 'update' && FEED.noticeTier('deal_signed') === 'needs_you' && FEED.noticeTier('deal_followup') === 'needs_you');
  const rows = NY.buildNeedsYou({ nowIso: new Date().toISOString(), own: { notices: [sig(`estimate:${DEAL}:${EST}`)], deals: { [DEAL]: { stage: 'qualified' } } } });
  const row = rows.find((x) => x.key === `deal:estimate:${EST}`);
  ok('10: Needs you: "approved your estimate — turn it into a proposal or an invoice"', row && row.name === 'Blue Finch Café website ($1,170.00)' && row.what === 'approved your estimate — turn it into a proposal or an invoice' && row.verb === 'Open deal' && row.href === `/pipeline.html?deal=${DEAL}&dtab=billing`, JSON.stringify(rows));
  const pausedRow = NY.buildNeedsYou({ nowIso: new Date().toISOString(), own: { notices: [{ ...sig(`recurpause:${DEAL}:${EST}:2026-12-01`, 'deal_followup', 'Recurring invoice paused — Blue Finch Café website'), body: 'The last two invoices are still unpaid, so the next one didn’t go out. Resume it on the deal when you’re ready, or stop it.' }], deals: {} } });
  ok('10: a paused recurring invoice is a row of its own, opening the deal', pausedRow.length === 1 && pausedRow[0].name === 'Recurring invoice paused — Blue Finch Café website' && /last two invoices are still unpaid/.test(pausedRow[0].what) && pausedRow[0].href === `/pipeline.html?deal=${DEAL}&dtab=billing`, JSON.stringify(pausedRow));
  const upcoming = NY.buildNeedsYou({ nowIso: new Date().toISOString(), own: { notices: [sig(`recurnext:${DEAL}:${EST}:2026-12-01`, 'invoice_upcoming', 'Goes out Dec 1: …')], deals: {} } });
  ok('10: the heads-up is never a Needs-you row', upcoming.length === 0);
  const n = [{ kind: 'deal_signed', period: `estimate:${DEAL}:${EST}` }];
  ok('10: an approved estimate on a removed or lost deal is cleared', NY.staleDealNotices(n, { [DEAL]: { deleted_at: daysAgo(1) } }).length === 1 && NY.staleDealNotices(n, { [DEAL]: { stage: 'lost' } }).length === 1 && NY.staleDealNotices(n, {}).length === 1);
  ok('10: …but not on a customer\'s deal (extra work is the point)', NY.staleDealNotices(n, { [DEAL]: { stage: 'won', converted_client_id: uuid('d') } }).length === 0);
  ok('10: "ready to convert" keeps its old rule', NY.staleDealNotices([{ kind: 'deal_signed', period: `signed:${DEAL}` }], { [DEAL]: { stage: 'won', converted_client_id: uuid('d') } }).length === 1);
}

// ═══ 11. the deal page reads them; the printable copy ═══
{
  world({ presence_estimates: [sentEstimate()], presence_recurring_invoices: [{ id: uuid('f'), site_id: SITE, deal_id: DEAL, title: 'Website care', amount_cents: 50000, every: 'month', anchor_day: 1, next_on: '2026-12-01', status: 'active', sent_count: 0, updated_at: daysAgo(1) }] });
  const r = await res(await SALES.handleSalesDeal(req('GET', `/sales/deals/${DEAL}`), site, owner, DEAL, cors));
  ok('11: the deal read carries its estimates (with totals) and its recurring invoices', r.status === 200 && r.body.data.estimates.length === 1 && r.body.data.estimates[0].total_cents === 117000 && r.body.data.recurring.length === 1 && r.body.data.recurring[0].title === 'Website care');
  const early = await res(await before0145(() => SALES.handleSalesDeal(req('GET', `/sales/deals/${DEAL}`), site, owner, DEAL, cors))());
  ok('11: before the database step the deal still opens, with none of either', early.status === 200 && Array.isArray(early.body.data.estimates) && early.body.data.estimates.length === 0 && early.body.data.recurring.length === 0 && Array.isArray(early.body.data.proposals));
  const link = await res(await SALES.handleSalesDocumentLink(site, 'estimate', EST, cors));
  ok('11: View / print mints a copy link for an estimate of this studio', link.status === 200 && /doc\.html\?t=/.test(link.body.url));
  const t = decodeURIComponent(/\?t=(.+)$/.exec(link.body.url)[1]);
  const page = await SALES.handleSalesDocument(req('GET', '/sales/doc/x'), t, cors);
  const html = await page.text();
  ok('11: the copy is the estimate, labelled Estimate', page.status === 200 && /<div class="doclabel">Estimate<\/div>/.test(html) && /Spring refresh/.test(html) && /nothing is charged until you get an invoice/.test(html));
  ok('11: another studio\'s estimate gets no link', (await SALES.handleSalesDocumentLink({ ...site, id: OTHER_SITE }, 'estimate', EST, cors)).status === 404);
  const tokOk = await DOCS.verifyDocToken(t, SALES.linkSecret(), Math.floor(Date.now() / 1000));
  ok('11: an estimate copy link is a read-only document token', tokOk && tokOk.t === 'doc' && tokOk.k === 'estimate');
}

// ═══ 12. a recurring invoice can't go out without Stripe (this file runs with none) ═══
{
  const S = uuid('f');
  world({ presence_recurring_invoices: [{ id: S, site_id: SITE, deal_id: DEAL, title: 'Website care', amount_cents: 50000, currency: 'usd', every: 'month', anchor_day: 1, next_on: '2026-11-01', due_days: 14, times: null, sent_count: 0, status: 'active', paused_reason: '' }] });
  const out = await RI.sendRecurringNow(db.tables.presence_recurring_invoices[0], { localYmd: '2026-11-01', clientId: OWNER });
  const s = db.tables.presence_recurring_invoices[0];
  ok('12: no Stripe → it pauses itself instead of billing', out.result === 'paused' && out.reason === 'no_stripe' && s.status === 'paused' && s.paused_reason === 'no_stripe' && !(db.tables.presence_invoices || []).length);
  const n = notices('deal_followup')[0];
  ok('12: …and says so in Needs you, opening the deal', n && n.period === `recurpause:${DEAL}:${S}:2026-11-01` && /Stripe isn’t connected/.test(n.body) && n.status === 'active');
  const start = await res(await RI.handleRecurringStart(req('POST', `/sales/deals/${DEAL}/recurring`, { title: 'Care', amount_cents: 5000, every: 'month', first_on: '2026-12-01' }), site, owner, DEAL, cors));
  ok('12: …and Start asks for Stripe first', start.status === 503 && /Connect Stripe/.test(start.body.message));
}

// ═══ 13. the first proposal or invoice is gone: the second one is real (full review Nov 10, F3) ═══
{
  world({ presence_estimates: [sentEstimate({ status: 'approved' })] });
  const first = await res(await ES.handleEstimateToProposal(req('POST', '/x', {}), site, owner, EST, cors));
  db.tables.presence_proposals[0].deleted_at = new Date().toISOString();
  const second = await res(await ES.handleEstimateToProposal(req('POST', '/x', {}), site, owner, EST, cors));
  const live = db.tables.presence_proposals.filter((p) => !p.deleted_at);
  ok('13: after the first proposal was deleted, the next press makes one that stays', second.status === 201 && live.length === 1 && live[0].id !== first.body.data.id && est().proposal_id === live[0].id, JSON.stringify(second.body));
  const third = await res(await ES.handleEstimateToProposal(req('POST', '/x', {}), site, owner, EST, cors));
  ok('13: …and pressing again returns that one', third.status === 200 && third.body.already === true && third.body.data.id === live[0].id);
  world({ presence_estimates: [sentEstimate({ status: 'approved' })], presence_deals: [{ id: DEAL, site_id: SITE, title: 'Blue Finch Café website', stage: 'won', contact_id: CT }] });
  const inv1 = await res(await ES.handleEstimateToInvoice(req('POST', '/x', {}), site, owner, EST, cors));
  db.tables.presence_invoices[0].deleted_at = new Date().toISOString();
  const inv2 = await res(await ES.handleEstimateToInvoice(req('POST', '/x', {}), site, owner, EST, cors));
  const liveInv = db.tables.presence_invoices.filter((v) => !v.deleted_at);
  ok('13: the same for an invoice that was deleted', inv2.status === 201 && liveInv.length === 1 && liveInv[0].id !== inv1.body.data.id && est().invoice_id === liveInv[0].id, JSON.stringify(inv2.body));
}

console.log(`\n════ ESTIMATES (routes): ${pass}/${pass + fail} ${fail ? 'FAILED' : 'PASSED'} ════`);
if (fail) Deno.exit(1);
