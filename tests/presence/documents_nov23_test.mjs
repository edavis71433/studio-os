// ── Sales items 181 to 185 (Nov 22 2026 review): the documents job, server half ──
//   deno run --allow-read --allow-env --allow-net tests/presence/documents_nov23_test.mjs
// 185 halves and quarters priced once per line; 184 a typed name on every yes, kept with the
// internet address and browser for the certificate; 181 Take it back; 182 Not a fit withdraws;
// 183 estimates get Edit and Revise, and Not now can become a yes. The pages are in
// tests/e2e/documents-nov23.spec.ts. Every check drives the real code with the clock pinned.
Deno.env.set('APPROVAL_SECRET', 'sign-secret-for-tests-0123456789abcdef');
Deno.env.set('RESEND_KEY', 'test-resend-key');
Deno.env.set('EMAIL_FROM', 'Example Studio <hello@example.com>');
Deno.env.set('SITE_URL', 'https://app.example.com');
Deno.env.delete('STRIPE_SECRET');
import { installFakePostgrest } from './fake_pgrst.mjs';
import { pinClock, PINNED_NOW, daysFrom } from './clock.mjs';
pinClock();
const uuid = (c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const SITE = uuid('1'), OWNER = uuid('2'), U = uuid('3'), CT = uuid('4'), DEAL = uuid('5'), EST = uuid('6'), PROP = uuid('8'), CON = uuid('9'), DEP = uuid('a'), PROP2 = uuid('b');
const db = installFakePostgrest({ users: { 'jwt-owner': { id: U, email: 'owner@example.com' } }, ownSite: { 'jwt-owner': SITE } });
const pg = globalThis.fetch;
const stripeSent = [];
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const j = (x) => new Response(JSON.stringify(x), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (u.hostname === 'api.resend.com') return j({ id: 'em_1' });
  if (u.hostname === 'api.stripe.com') { stripeSent.push({ path: u.pathname, params: new URLSearchParams(String(init.body || '')) }); return j(u.pathname.endsWith('/payment_links') ? { id: 'plink_1', url: 'https://buy.stripe.com/test_1' } : { id: 'price_1' }); }
  return pg(url, init);
};
const SL = await import('../../supabase/functions/presence/lib/sales_lifecycle.ts');
const IB = await import('../../supabase/functions/presence/lib/invoice_billing.ts');
const IC = await import('../../supabase/functions/presence/lib/invoice_changes.ts');
const DOCS = await import('../../supabase/functions/presence/lib/documents.ts');
const AX = await import('../../supabase/functions/presence/lib/accounting_export.ts');
const EL = await import('../../supabase/functions/presence/lib/estimates.ts');
const DA = await import('../../supabase/functions/presence/crm/deal_activity.ts');
const SALES = await import('../../supabase/functions/presence/routes/sales.ts');
const ES = await import('../../supabase/functions/presence/routes/estimates.ts');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n, note); } };
const eq = (n, got, want) => ok(n, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}`);
const cors = {};
const site = { id: SITE, client_id: OWNER, status: 'live', edition: 'presence' };
const owner = { kind: 'client', userId: U, email: 'owner@example.com', jwt: 'jwt-owner', requestId: 't' };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const req = (method, path, body, ip = '203.0.113.7') => new Request(`https://fn.test/functions/v1/presence${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip, 'user-agent': UA } });
const res = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const ago = (d) => daysFrom(PINNED_NOW, -d), ahead = (d) => daysFrom(PINNED_NOW, d);
const tokenFor = (id, t) => SALES.signSalesToken({ t, id, site_id: SITE, exp: Math.floor(Date.now() / 1000) + 86400 }, SALES.linkSecret());
const T = (name) => db.tables[name] || [];
const row = (name, id) => T(name).find((x) => x.id === id);
const notes = () => T('presence_deal_events').filter((e) => e.kind === 'note' && e.detail && e.detail.change);
const LINES = [{ label: 'Design hours', qty: 2.5, unit_cents: 10000 }];
const world = (extra = {}) => {
  db.reset({
    presence_sites: [{ id: SITE, client_id: OWNER }],
    presence_deals: [{ id: DEAL, site_id: SITE, title: 'Blue Finch Café website', stage: 'proposal', contact_id: CT, expected_value_cents: 0, deleted_at: null }],
    presence_contacts: [{ id: CT, site_id: SITE, name: 'Riley Park', email: 'riley@example.org', company: 'Blue Finch Café' }],
    presence_proposals: [{ id: PROP, site_id: SITE, deal_id: DEAL, title: 'Website', line_items: LINES, subtotal_cents: 25000, currency: 'usd', terms: '', status: 'sent', version: 1, sent_at: ago(2), expires_at: ahead(28), decided_note: '', deleted_at: null }],
    presence_estimates: [], presence_contracts: [], presence_invoices: [], presence_deal_events: [], presence_sign_evidence: [],
    ...extra,
  });
  db.fail.add('rpc/rate_hit');   // the limiter fails open
};

// ═══ 185: halves and quarters, each line rounded to the cent once ═══
eq('185: a quantity in quarters is kept; anything else is not a quantity', [SL.quarterQty(2.5), SL.quarterQty('0.25'), SL.quarterQty(0.1 + 0.15), SL.quarterQty(1.3), SL.quarterQty(''), SL.quarterQty('two')], [2.5, 0.25, 0.25, null, null, null]);
{
  const n = SL.normalizeLineItems([{ label: 'Design hours', qty: 1.3, unit_cents: 10000 }]);
  ok('185: 1.3 is refused out loud, never cut to 1', !n.ok && /whole number, a half or a quarter/.test(n.error), JSON.stringify(n));
  const k = SL.normalizeLineItems([{ label: 'Design hours', qty: 2.5, unit_cents: 3333 }, { label: 'Check-in', qty: 0.25, unit_cents: 333 }]);
  eq('185: 2.5 × $33.33 and 0.25 × $3.33 bill $83.33 and $0.83, and the subtotal adds the rounded lines', [k.ok && k.items.map((i) => i.qty), k.subtotal_cents, SL.lineCents(2.5, 3333), SL.lineCents(0.25, 333)], [[2.5, 0.25], 8416, 8333, 83]);
  eq('185: a stored 2.5 reads back as 2.5 and totals the same', [SL.splitLineItems(SL.packLineItems(k.items, {})).items.map((i) => i.qty), SL.proposalTotals(SL.packLineItems(k.items, { tax_pct: 10 })).total_cents], [[2.5, 0.25], 9258]);
  eq('185: an invoice billed from it carries 2.5 and the line\'s own rounded amount', IB.linesFromProposal(k.items, { discount_cents: 0, tax_cents: 0 }, {}, []), [{ label: 'Design hours', qty: 2.5, amount_cents: 8333 }, { label: 'Check-in', qty: 0.25, amount_cents: 83 }]);
}
{
  const good = IC.cleanLines([{ label: 'Design hours', qty: 2.5, amount_cents: 25000 }]);
  const bad = IC.cleanLines([{ label: 'Design hours', qty: 1.3, amount_cents: 13000 }]);
  ok('185: an invoice line takes 2.5 and refuses 1.3 out loud', good.ok && good.lines[0].qty === 2.5 && !bad.ok && /a half or a quarter/.test(bad.message));
  eq('185: the invoice page and PDF print 2.5, not 2', DOCS.invoiceLines({ lines: [{ label: 'Design hours', qty: 2.5, amount_cents: 25000 }, { label: 'Hosting', qty: 1, amount_cents: 5000 }] }, 30000).map((l) => l.qty), [2.5, 1]);
}
{
  eq('185: the bookkeeper file sends a part quantity as 1 at its total, its words naming the quantity', [AX.wholeQtyLine({ label: 'Design hours', qty: 2.5, amount_cents: 25000 }), AX.wholeQtyLine({ label: 'Hosting', qty: 2, amount_cents: 10000 })],
    [{ label: 'Design hours (2.5 × $100.00)', qty: 1, amount_cents: 25000 }, { label: 'Hosting', qty: 2, amount_cents: 10000 }]);
  const out = AX.invoiceExportRows([{ id: uuid('c'), number: 12, title: 'Website', amount_cents: 6250, status: 'open', issued_at: ago(1), lines: [{ label: 'Care plan', qty: 0.75, amount_cents: 6250 }] }], { from: ago(5).slice(0, 10), to: PINNED_NOW.slice(0, 10) });
  const r0 = out.rows[0] || [];
  ok('185: QuickBooks gets quantity 1 × $62.50 (0.75 × $83.33 would not add up), the line saying 0.75', r0[7] === '1' && r0[8] === '62.50' && r0[9] === '62.50' && /0\.75 ×/.test(r0[6]), JSON.stringify(r0));
  // Stripe only ever gets whole quantities: an invoice's pay link is one line, quantity 1, at its total
  // (already rounded line by line). Driven for real, on a fresh copy of the module with a test key.
  Deno.env.set('STRIPE_SECRET', 'sk_test_documents');
  const ST = await import('../../supabase/functions/presence/commerce/stripe.ts?documents=1');
  Deno.env.delete('STRIPE_SECRET');
  const link = await ST.createServicePaymentLink({ amountCents: 8416, description: 'Invoice #0012 (Design hours 2.5)', invoiceId: uuid('e') });
  const price = stripeSent.find((x) => x.path === '/v1/prices'), plink = stripeSent.find((x) => x.path === '/v1/payment_links');
  ok('185: Stripe only ever gets whole quantities: one line, quantity 1, at the invoice\'s rounded total', link.url === 'https://buy.stripe.com/test_1' && price?.params.get('unit_amount') === '8416' && plink?.params.get('line_items[0][quantity]') === '1' && [...plink.params.keys()].filter((k) => /quantity/.test(k)).length === 1, JSON.stringify(stripeSent.map((x) => [x.path, [...x.params.entries()].filter(([k]) => /quantity|amount/.test(k))])));
}

// ═══ 184: the certificate says where it was signed from ═══
eq('184: the browser in plain words', [DOCS.browserName(UA), DOCS.browserName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0'), DOCS.browserName('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) Gecko/20100101 Firefox/133.0'), DOCS.browserName('')], ['Safari on iPhone', 'Edge on Windows', 'Firefox on Mac', '']);
eq('184: with the address kept it prints it and the browser; an older signature says it wasn\'t kept', [DOCS.signedFromLines({ ip: '203.0.113.7', user_agent: UA }).map((x) => x[0]), DOCS.signedFromLines({ ip: '203.0.113.7', user_agent: UA })[1][1].startsWith('Safari on iPhone ('), DOCS.signedFromLines(null)[0][0]], [['Internet address', 'Browser'], true, 'Signed from']);
eq('183, 184: who said yes, when and from where', DOCS.yesLine({ decided_name: 'Riley Park', decided_at: PINNED_NOW, sign_evidence: { ip: '203.0.113.7', user_agent: UA } }, 'Accepted'), `Accepted by Riley Park, ${DOCS.utcStamp(PINNED_NOW)}, from 203.0.113.7 (Safari on iPhone).`);

world();
{
  const tok = await tokenFor(DEAL, 'flow');
  let r = await res(await SALES.handleSalesProposalDecide(req('POST', `/sales/proposals/${PROP}/decide`, { token: tok, decision: 'accepted' }), PROP, cors));
  ok('184: Accept without a typed name is refused, and nothing changes', r.status === 422 && r.body?.error === 'name_needed' && row('presence_proposals', PROP).status === 'sent', JSON.stringify(r));
  r = await res(await SALES.handleSalesProposalDecide(req('POST', `/sales/proposals/${PROP}/decide`, { token: tok, decision: 'accepted', name: '  Riley Park ' }), PROP, cors));
  const ev = T('presence_sign_evidence')[0];
  ok('184: Accept with a typed name keeps the name, and the address and browser privately with it', r.status === 200 && row('presence_proposals', PROP).decided_name === 'Riley Park' && ev?.doc_kind === 'proposal' && ev.ip === '203.0.113.7' && ev.user_agent === UA && ev.deal_id === DEAL, JSON.stringify([r, ev]));
  const html = DOCS.renderDocument('proposal', await SALES.docRow('proposal', PROP, SITE), null, null);
  ok('184: the printed proposal says who accepted it and from where', html.includes('Accepted by Riley Park') && html.includes('from 203.0.113.7 (Safari on iPhone)'));
  ok('184: the evidence never rides the deal read', !JSON.stringify((await res(await SALES.handleSalesDeal(req('GET', `/sales/deals/${DEAL}`), site, owner, DEAL, cors))).body).includes('203.0.113.7'));
}
world({ presence_proposals: [], presence_contracts: [{ id: CON, site_id: SITE, deal_id: DEAL, title: 'Service agreement', body: 'We build the site.', content_hash: 'h1', status: 'sent', signer_name: '', signer_email: '', signed_evidence: {}, version: 1, deleted_at: null }] });
{
  const tok = await tokenFor(CON, 'contract');
  const r = await res(await SALES.handleSalesContractSign(req('POST', `/sales/contracts/${CON}/sign`, { token: tok, signer_name: 'Riley Park', signer_email: 'riley@example.org', presented_hash: 'h1' }, '198.51.100.4'), CON, cors));
  const ev = T('presence_sign_evidence').find((e) => e.doc_kind === 'contract');
  ok('184: signing keeps the real address and browser with the signature', r.status === 200 && ev?.ip === '198.51.100.4' && ev.user_agent === UA && ev.signer_name === 'Riley Park', JSON.stringify([r, ev]));
  const html = DOCS.renderDocument('contract', await SALES.docRow('contract', CON, SITE), null, null);
  ok('184: the certificate prints the internet address and the browser, and no scrambled one', html.includes('Internet address') && html.includes('198.51.100.4') && html.includes('Safari on iPhone') && !html.includes('hashed IP'));
}

// ═══ 181: take back a sent agreement ═══
const depositRow = (over = {}) => ({ id: DEP, site_id: SITE, deal_id: DEAL, title: 'Deposit', amount_cents: 50000, purpose: 'deposit', status: 'open', stripe_url: 'https://pay.example/x', deleted_at: null, processing_since: null, ...over });
world({ presence_proposals: [], presence_contracts: [{ id: CON, site_id: SITE, deal_id: DEAL, title: 'Service agreement', body: 'We build the site. A 50% deposit.', content_hash: 'h1', status: 'sent', signer_name: '', version: 1, deleted_at: null }], presence_invoices: [depositRow()] });
{
  let r = await res(await SALES.handleSalesContractWithdraw(site, owner, CON, cors));
  const c = row('presence_contracts', CON);
  ok('181: Take it back makes it Withdrawn (voided), with when and why', r.status === 200 && c.status === 'voided' && c.withdrawn_why === 'studio' && !!c.withdrawn_at, JSON.stringify(r));
  ok('181: it names the unpaid deposit for the page to ask about, and leaves it open until asked', r.body?.open_deposit?.id === DEP && r.body.open_deposit.amount_cents === 50000 && row('presence_invoices', DEP).status === 'open');
  eq('181: the deal\'s history says it was taken back', notes().map((e) => DA.dealChangeLine(e.detail)), ['Agreement taken back to update it: Service agreement']);
  r = await res(await SALES.handleSalesContractWithdraw(site, owner, CON, cors));
  ok('181: a second press changes nothing and writes no second line', r.status === 200 && r.body?.already === true && notes().length === 1);
  const tok = await tokenFor(CON, 'contract');
  r = await res(await SALES.handleSalesContractSign(req('POST', `/sales/contracts/${CON}/sign`, { token: tok, signer_name: 'Riley Park', signer_email: 'riley@example.org', presented_hash: 'h1' }), CON, cors));
  ok('181: the client\'s old link refuses a signature and says the studio is updating it', r.status === 409 && r.body?.error === 'withdrawn' && /updat/.test(r.body.message) && row('presence_contracts', CON).status === 'voided');
  const v = await res(await SALES.handleSalesPublicView(req('GET', '/x'), await tokenFor(DEAL, 'flow'), cors));
  ok('181: the one-link page says the agreement was taken back (no new draft yet)', v.body?.data?.contract === null && v.body.data.contract_withdrawn === true, JSON.stringify(v.body?.data));
}
world({ presence_proposals: [], presence_contracts: [{ id: CON, site_id: SITE, deal_id: DEAL, title: 'Service agreement', body: 'x', content_hash: 'h1', status: 'signed', signer_name: 'Riley', version: 1, deleted_at: null }, { id: uuid('d'), site_id: SITE, deal_id: DEAL, title: 'Draft', body: 'x', content_hash: 'h2', status: 'draft', version: 1, deleted_at: null }] });
ok('181: a signed agreement stays on the record; a draft is deleted, not taken back', (await SALES.handleSalesContractWithdraw(site, owner, CON, cors)).status === 409 && (await SALES.handleSalesContractWithdraw(site, owner, uuid('d'), cors)).status === 409 && row('presence_contracts', CON).status === 'signed');

// ═══ 182: Not a fit withdraws what is still out; Undo puts it back ═══
world({
  presence_estimates: [{ id: EST, site_id: SITE, deal_id: DEAL, title: 'Estimate', line_items: LINES, subtotal_cents: 25000, currency: 'usd', terms: '', status: 'sent', version: 1, sent_at: ago(1), expires_at: ahead(29), decided_note: '', deleted_at: null }],
  presence_contracts: [{ id: CON, site_id: SITE, deal_id: DEAL, title: 'Service agreement', body: 'x', content_hash: 'h1', status: 'sent', version: 1, deleted_at: null }],
  presence_invoices: [depositRow()],
});
{
  const r = await res(await SALES.handleSalesDealStage(req('POST', `/sales/deals/${DEAL}/stage`, { to: 'lost', reason: 'Price' }), site, owner, DEAL, cors));
  ok('182: Not a fit withdraws the open proposal and estimate and takes back the unsigned agreement', r.status === 200 && row('presence_proposals', PROP).status === 'withdrawn' && row('presence_estimates', EST).status === 'withdrawn' && row('presence_contracts', CON).status === 'voided' && row('presence_proposals', PROP).withdrawn_why === 'not_a_fit', JSON.stringify(r.body));
  eq('182: it says what it took back and names the unpaid deposit (left open)', [r.body?.withdrawn, r.body?.open_deposit?.id, row('presence_invoices', DEP).status], [{ proposals: 1, estimates: 1, agreements: 1 }, DEP, 'open']);
  eq('182: one history line says so', notes().map((e) => DA.dealChangeLine(e.detail)), ['The proposal, the estimate and the agreement were withdrawn: the deal closed as Not a fit']);
  const d = await res(await SALES.handleSalesProposalDecide(req('POST', `/sales/proposals/${PROP}/decide`, { token: await tokenFor(PROP, 'proposal'), decision: 'accepted', name: 'Riley Park' }), PROP, cors));
  ok('182: the client\'s proposal link refuses, and says the studio withdrew it', d.status === 409 && d.body?.error === 'withdrawn' && row('presence_proposals', PROP).status === 'withdrawn');
  const e = await res(await ES.handleEstimateDecide(req('POST', `/sales/estimates/${EST}/decide`, { token: await tokenFor(EST, 'estimate'), decision: 'approved', name: 'Riley Park' }), EST, cors));
  ok('182: so does the estimate\'s', e.status === 409 && e.body?.error === 'withdrawn');
  const v = await res(await SALES.handleSalesPublicView(req('GET', '/x'), await tokenFor(DEAL, 'flow'), cors));
  ok('182: the one-link page shows a closed deal, with nothing to answer', v.body?.data?.closed === true && v.body.data.proposal === null && v.body.data.contract === null);
  // an agreement they had already signed stays readable on their link after the close
  const signedCon = row('presence_contracts', CON); signedCon.status = 'signed'; signedCon.signed_at = ago(1); signedCon.signer_name = 'Riley Park';
  const s2 = await res(await SALES.handleSalesPublicView(req('GET', '/x'), await tokenFor(DEAL, 'flow'), cors));
  ok('182: …but an agreement they already signed stays theirs to read', !s2.body?.data?.closed && s2.body?.data?.contract?.status === 'signed', JSON.stringify(s2.body?.data && { closed: s2.body.data.closed, c: s2.body.data.contract && s2.body.data.contract.status }));
  signedCon.status = 'voided'; signedCon.signed_at = null; signedCon.signer_name = '';
  // builder item 75's Undo, a few minutes later: what that close took back goes back out
  T('presence_deal_events').forEach((x) => { if (x.kind === 'stage_change') x.created_at = daysFrom(PINNED_NOW, -2 / 1440); });
  const u = await res(await SALES.handleSalesDealStage(req('POST', `/sales/deals/${DEAL}/stage`, { to: 'proposal', undo: true }), site, owner, DEAL, cors));
  ok('182: Undo puts the deal and its documents back as they were', u.status === 200 && row('presence_deals', DEAL).stage === 'proposal' && row('presence_proposals', PROP).status === 'sent' && row('presence_estimates', EST).status === 'sent' && row('presence_contracts', CON).status === 'sent', JSON.stringify(u.body));
}
eq('182: the history lines read plainly', [DA.dealChangeLine({ change: 'withdrawn', why: 'not_a_fit', proposals: 1 }), DA.dealChangeLine({ change: 'withdrawn', why: 'not_a_fit', proposals: 2, estimates: 1 }), DA.dealChangeLine({ change: 'restored', proposals: 1 })],
  ['The proposal was withdrawn: the deal closed as Not a fit', '2 proposals and the estimate were withdrawn: the deal closed as Not a fit', 'The proposal was put back out, with the deal']);

// ═══ 183: estimates get Edit and Revise; Not now can become a yes; Approve takes a name ═══
eq('183: Not now can become a yes, never the other way; Revise is for one sent, Not now or withdrawn', [EL.canDecideEstimate('declined', 'approved'), EL.canDecideEstimate('declined', 'declined'), EL.canDecideEstimate('approved', 'declined'), EL.canReviseEstimate('sent'), EL.canReviseEstimate('declined'), EL.canReviseEstimate('draft'), EL.canReviseEstimate('approved')], [true, false, false, true, true, false, false]);
const estRow = (over = {}) => ({ id: EST, site_id: SITE, deal_id: DEAL, title: 'Spring refresh', line_items: [{ label: 'Homepage', qty: 1, unit_cents: 90000 }], subtotal_cents: 90000, currency: 'usd', terms: '', status: 'draft', version: 1, sent_at: null, expires_at: null, decided_note: '', decided_name: '', proposal_id: null, invoice_id: null, deleted_at: null, ...over });
world({ presence_estimates: [estRow()] });
{
  let r = await res(await ES.handleEstimateEdit(req('PATCH', `/sales/estimates/${EST}`, { line_items: [{ label: 'Homepage', qty: 1.5, unit_cents: 90000 }], tax_pct: 10, title: 'Spring refresh, bigger' }), site, owner, EST, cors));
  ok('183: a draft estimate can be changed in place', r.status === 200 && row('presence_estimates', EST).title === 'Spring refresh, bigger' && r.body?.data?.total_cents === 148500, JSON.stringify(r.body));
  row('presence_estimates', EST).status = 'sent';
  r = await res(await ES.handleEstimateEdit(req('PATCH', `/sales/estimates/${EST}`, { title: 'x' }), site, owner, EST, cors));
  ok('183: once sent it can\'t be edited (Revise makes the next version)', r.status === 409 && r.body?.error === 'already_sent');
  r = await res(await ES.handleEstimateRevise(req('POST', `/sales/estimates/${EST}/revise`, { line_items: [{ label: 'Homepage', qty: 1, unit_cents: 80000 }] }), site, owner, EST, cors));
  const v2 = r.body?.data;
  ok('183: Revise makes version 2 as a draft, and marks the old one replaced', r.status === 201 && v2?.version === 2 && v2.status === 'draft' && SL.splitLineItems(v2.line_items).meta.revised_from === EST && SL.splitLineItems(row('presence_estimates', EST).line_items).meta.superseded_by === v2.id, JSON.stringify(r.body));
  const a = await res(await ES.handleEstimateDecide(req('POST', `/sales/estimates/${EST}/decide`, { token: await tokenFor(EST, 'estimate'), decision: 'approved', name: 'Riley Park' }), EST, cors));
  ok('183: the old version\'s link can no longer be approved', a.status === 409 && a.body?.error === 'superseded' && row('presence_estimates', EST).status === 'sent');
  r = await res(await ES.handleEstimateRevise(req('POST', `/sales/estimates/${EST}/revise`, {}), site, owner, EST, cors));
  ok('183: it can\'t be revised twice (change the newest one)', r.status === 409 && r.body?.error === 'already_revised');
}
world({ presence_estimates: [estRow({ status: 'sent', sent_at: ago(1), expires_at: ahead(29) })] });
{
  const tok = await tokenFor(EST, 'estimate');
  let r = await res(await ES.handleEstimateDecide(req('POST', `/sales/estimates/${EST}/decide`, { token: tok, decision: 'declined', note: 'Not this month' }), EST, cors));
  ok('183: Not now still works without a name', r.status === 200 && row('presence_estimates', EST).status === 'declined');
  r = await res(await ES.handleEstimateDecide(req('POST', `/sales/estimates/${EST}/decide`, { token: tok, decision: 'approved' }), EST, cors));
  ok('183: Approve without a typed name is refused', r.status === 422 && r.body?.error === 'name_needed' && row('presence_estimates', EST).status === 'declined');
  r = await res(await ES.handleEstimateDecide(req('POST', `/sales/estimates/${EST}/decide`, { token: tok, decision: 'approved', name: 'Riley Park' }), EST, cors));
  const e = row('presence_estimates', EST), ev = T('presence_sign_evidence').find((x) => x.doc_kind === 'estimate');
  ok('183: a Not now becomes a yes, with the name and where it came from', r.status === 200 && e.status === 'approved' && e.decided_name === 'Riley Park' && ev?.ip === '203.0.113.7', JSON.stringify([r, e]));
  ok('183: the deal\'s history says it was approved after a Not now', T('presence_deal_events').some((x) => x.kind === 'estimate_decided' && x.detail?.after_not_now === true && x.detail?.name === 'Riley Park'));
}
world({ presence_proposals: [{ id: PROP2, site_id: SITE, deal_id: DEAL, title: 'Draft', line_items: [{ label: 'Logo', qty: 1, unit_cents: 50000 }], subtotal_cents: 50000, currency: 'usd', terms: '', status: 'draft', version: 1, deleted_at: null }] });
{
  let r = await res(await SALES.handleSalesProposalEdit(req('PATCH', `/sales/proposals/${PROP2}`, { line_items: [{ label: 'Logo', qty: 0.5, unit_cents: 50000 }], terms: 'Two rounds included.' }), site, owner, PROP2, cors));
  ok('183: a draft proposal can be changed in place too', r.status === 200 && row('presence_proposals', PROP2).subtotal_cents === 25000 && row('presence_proposals', PROP2).terms === 'Two rounds included.', JSON.stringify(r.body));
  row('presence_proposals', PROP2).status = 'sent';
  r = await res(await SALES.handleSalesProposalEdit(req('PATCH', `/sales/proposals/${PROP2}`, { terms: 'x' }), site, owner, PROP2, cors));
  ok('183: …but not once sent', r.status === 409 && r.body?.error === 'already_sent');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
