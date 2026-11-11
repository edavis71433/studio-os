// ── Sales items 107 and 108: the record's Billing tab tells the truth and shows all the money ──
// Pure pins for the rules behind the Nov 10 bug hunt's J findings:
//   J2  "+ Invoice" left blank bills what's LEFT of the accepted proposal and never
//       re-sends an older open invoice unasked (lib/invoice_billing.ts)
//   J4  retainer payments count in Paid and read "Retainer payment" (no invoice row exists)
//   J7  money in Activity and the Upcoming band prints "$1,250.50", never "$1,250.5" or "$1,251"
//   J8  voided invoices and removed drafts read as sentences; a teammate's logged call is theirs
// Plus the wiring in routes/sales.ts, routes/crm.ts and the two pages that use them.
//
//   deno run --allow-read --allow-env tests/presence/record_billing_truth_test.mjs
import { leftToBill, reuseDecision, retainerPaid, DOUBLE_TAP_MS } from '../../supabase/functions/presence/lib/invoice_billing.ts';
import { describeSystemEvent, usd } from '../../supabase/functions/presence/crm/deal_activity.ts';
import { mapConversationItem, buildUpcoming, actorName, isViewer } from '../../supabase/functions/presence/crm/activity.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const read = (p) => Deno.readTextFileSync(new URL('../../' + p, import.meta.url));
const NOW = '2026-11-11T18:00:00.000Z';
const nowMs = Date.parse(NOW);

// ═══ J2 — what's left of the accepted proposal ═══
{
  const inv = (amount_cents, status = 'open', extra = {}) => ({ amount_cents, status, ...extra });
  const none = leftToBill(500000, []);
  ok('nothing billed yet: the whole total is left', none.left_cents === 500000 && none.billed_cents === 0 && none.total_cents === 500000);
  const afterDeposit = leftToBill(500000, [inv(200000, 'paid', { purpose: 'deposit' })]);
  ok('a paid deposit comes off: $3,000 of $5,000 left', afterDeposit.left_cents === 300000 && afterDeposit.billed_cents === 200000);
  const openToo = leftToBill(500000, [inv(200000, 'paid'), inv(50000, 'open')]);
  ok('an open invoice is billed too (it is waiting, not missing)', openToo.left_cents === 250000);
  ok('voided, removed and recurring invoices never count', leftToBill(500000, [inv(200000, 'void'), inv(100000, 'open', { deleted_at: NOW }), inv(15000, 'paid', { recurring_id: 'r1' })]).left_cents === 500000);
  ok('fully billed: nothing left, never negative', leftToBill(300000, [inv(200000, 'paid'), inv(150000, 'open')]).left_cents === 0);
  ok('junk in, zeros out (no throw)', leftToBill('x', null).left_cents === 0 && leftToBill(undefined, [null, { status: 'open' }]).billed_cents === 0);
}

// ═══ J2 — an open invoice of the same kind: send, ask, or finish it ═══
{
  const sent = { amount_cents: 50000, stripe_url: 'https://pay.example/x', updated_at: new Date(nowMs - 10 * 60_000).toISOString() };
  ok('a different amount (typed, or what’s left) never re-sends the old one', reuseDecision(sent, 450000, nowMs) === 'mismatch');
  ok('the same amount, already sent: ask first (no unasked re-send)', reuseDecision(sent, 50000, nowMs) === 'ask');
  ok('the same amount, sent seconds ago: a double tap, no second email', reuseDecision({ ...sent, updated_at: new Date(nowMs - 30_000).toISOString() }, 50000, nowMs) === 'double_tap');
  ok('the double-tap window is two minutes', DOUBLE_TAP_MS === 120_000 && reuseDecision({ ...sent, updated_at: new Date(nowMs - 121_000).toISOString() }, 50000, nowMs) === 'ask');
  ok('never sent (its link failed): finish that same invoice', reuseDecision({ amount_cents: 50000, stripe_url: null, created_at: NOW }, 50000, nowMs) === 'repair');
}

// ═══ J4 — retainer payments ═══
{
  const ev = (detail, created_at, kind = 'invoice_paid') => ({ kind, detail, created_at });
  const rp = retainerPaid([
    ev({ retainer: true, amount_cents: 50000, interval: 'month' }, '2026-09-01T10:00:00Z'),
    ev({ retainer: true, amount_cents: 50000, interval: 'month' }, '2026-11-01T10:00:00Z'),
    ev({ retainer: true, amount_cents: 50000, interval: 'month' }, '2026-10-01T10:00:00Z'),
    ev({ invoice_id: 'i1', amount_cents: 120000, purpose: 'deposit' }, '2026-08-01T10:00:00Z'),   // an invoice's payment is on its invoice row already
    ev({ retainer: true, amount_cents: 50000 }, '2026-11-02T10:00:00Z', 'invoice_sent'),
  ]);
  ok('three retainer charges: $1,500, last on Nov 1', rp.cents === 150000 && rp.count === 3 && rp.last_at === '2026-11-01T10:00:00Z');
  ok('no events, nothing paid', retainerPaid([]).cents === 0 && retainerPaid(null).count === 0 && retainerPaid(undefined).last_at === null);
  ok('the Activity line names it a retainer payment', describeSystemEvent({ kind: 'invoice_paid', detail: { retainer: true, amount_cents: 50000 } }) === 'Retainer payment — $500');
  ok('an invoice payment still reads as one', describeSystemEvent({ kind: 'invoice_paid', detail: { amount_cents: 50000, purpose: 'service' } }) === 'Invoice paid — $500' && describeSystemEvent({ kind: 'invoice_paid', detail: { amount_cents: 120000, purpose: 'deposit' } }) === 'Deposit paid — $1,200');
}

// ═══ J7 — one money format ═══
{
  ok('cents print with two decimals', usd(125050) === '$1,250.50' && usd(5) === '$0.05');
  ok('whole dollars print whole', usd(125000) === '$1,250' && usd(100) === '$1');
  ok('nothing is empty', usd(0) === '' && usd('x') === '' && usd(null) === '');
  ok('Activity: "Invoice sent — $1,250.50"', describeSystemEvent({ kind: 'invoice_sent', detail: { amount_cents: 125050, purpose: 'service' } }) === 'Invoice sent — $1,250.50');
  const up = buildUpcoming({ invoices: [{ title: 'Balance', amount_cents: 125050, status: 'open', due_date: '2026-11-20' }] }, NOW);
  ok('the Upcoming band no longer rounds: "Unpaid invoice — Balance ($1,250.50)"', up.length === 1 && up[0].title === 'Unpaid invoice — Balance ($1,250.50)');
}

// ═══ J8 — sentences and the right name ═══
{
  ok('a voided invoice: title and amount', describeSystemEvent({ kind: 'invoice_voided', detail: { title: 'Logo add-on', amount_cents: 30000, purpose: 'service' } }) === 'Invoice voided — Logo add-on ($300)');
  ok('a voided deposit request says so', describeSystemEvent({ kind: 'invoice_voided', detail: { amount_cents: 50000, purpose: 'deposit' } }) === 'Deposit request voided — $500');
  ok('a voided invoice with nothing in its detail still reads as a sentence', describeSystemEvent({ kind: 'invoice_voided', detail: {} }) === 'Invoice voided');
  ok('a removed draft proposal names it', describeSystemEvent({ kind: 'proposal_deleted', detail: { title: 'Website refresh' } }) === 'Draft proposal removed — Website refresh');
  ok('a removed draft agreement names it', describeSystemEvent({ kind: 'contract_deleted', detail: { title: 'Service agreement' } }) === 'Draft agreement removed — Service agreement' && describeSystemEvent({ kind: 'contract_deleted', detail: {} }) === 'Draft agreement removed');
  const call = (actor) => ({ id: 'a1', kind: 'activity', activity_kind: 'call', from: 'studio', actor, body: '', created_at: NOW });
  ok('my own call: "You logged a call"', mapConversationItem(call('owner@studio.example'), 'Owner@Studio.example').title === 'You logged a call');
  ok('a teammate’s call: their name', mapConversationItem(call('jamie.lee@studio.example'), 'owner@studio.example').title === 'Jamie Lee logged a call');
  ok('a shared mailbox reads as itself', mapConversationItem(call('hello@studio.example'), 'owner@studio.example').title === 'hello@studio.example logged a call');
  ok('a row from before the actor rode along stays "You"', mapConversationItem(call(''), 'owner@studio.example').title === 'You logged a call' && mapConversationItem({ ...call(undefined) }).title === 'You logged a call');
  ok('a teammate’s note: "Jamie added a note"', mapConversationItem({ ...call('jamie@studio.example'), activity_kind: 'note', body: 'x' }, 'owner@studio.example').title === 'Jamie added a note');
  ok('actorName: not an email → "A teammate"', actorName('a2f1c0de-1111-4111-8111-111111111111') === 'A teammate' && actorName('') === 'A teammate');
  ok('actorName: digits and dashes tidy up', actorName('sam_ortiz2@x.example') === 'Sam Ortiz' && actorName('42@x.example') === '42@x.example');
  ok('isViewer ignores capitals', isViewer('A@B.example', 'a@b.example') && !isViewer('c@b.example', 'a@b.example'));
}

// ═══ wiring ═══
{
  const sales = read('supabase/functions/presence/routes/sales.ts');
  const inv = sales.slice(sales.indexOf('export async function handleSalesInvoice('), sales.indexOf('export async function handleSalesSchedule('));
  ok('+ Invoice: blank bills leftToBill, not the whole total', /leftToBill\(proposalTotals\(prop\.line_items\)\.total_cents, rows\(ir\)\)/.test(inv) && /amountCents = fromProposal\.left_cents/.test(inv));
  ok('+ Invoice: a fully billed proposal is refused with a sentence', /error: 'fully_billed'/.test(inv));
  ok('+ Invoice: the guard runs on every amount, typed or not (reuseDecision)', /const decision = reuseDecision\(inv, amountCents, Date\.now\(\)\)/.test(inv) && !/b\.amount_cents !== undefined && Number\(inv\.amount_cents\) !== amountCents/.test(inv));
  ok('+ Invoice: an already-sent one asks (already_open), never re-sends', /error: 'already_open'/.test(inv));
  ok('both send routes say when the email was held back (double_tap)', (sales.match(/double_tap: doubleTap/g) || []).length === 2);
  const deal = sales.slice(sales.indexOf('export async function handleSalesDeal('), sales.indexOf('export async function handleSalesDealActivity('));
  ok('the deal read counts the retainer’s payments beside the deal', /kind=eq\.invoice_paid/.test(deal) && /retainer_paid = .*retainerPaid\(/.test(deal) && /retainer_paid \}/.test(deal));
  ok('the deal read carries recurring_id (what’s left leaves recurring out)', /processing_since,recurring_id&order/.test(deal));
  const crm = read('supabase/functions/presence/routes/crm.ts');
  ok('the record’s activity knows who logged each call', /actor: String\(ev\.actor \|\| ''\)/.test(crm) && /mapConversationItem\(m, principal\.email \|\| ''\)/.test(crm));

  const page = read('crm.html');
  ok('record: a void whose link may still be live says so (J1)', /link_deactivated===false/.test(page) && /may still be live/.test(page));
  ok('record: sending an agreement mentions the deposit it added (J5)', /dep&&dep\.minted\?' A '\+fmtC\(dep\.amount_cents\)\+' deposit request is ready/.test(page));
  ok('record: the invoice form says what blank bills (J2)', /function leftOfProposal\(\)/.test(page) && /what’s left of the accepted proposal/.test(page));
  ok('record: already_open and amount_mismatch resend THAT invoice by its own route', /why==='amount_mismatch'\|\|why==='already_open'/.test(page) && /billingSend\('\/sales\/invoices\/'\+encodeURIComponent\(open\.id\)\+'\/send'/.test(page));
  ok('record: a declined or expired proposal changes the advice (J3)', /function proposalOutcome\(\)/.test(page) && /They declined your proposal\./.test(page) && /Revise the proposal →/.test(page));
  ok('record: an expired proposal has no Copy link (J3)', /p\.status==='sent'&&!expired&&!replaced\)acts\+=act\(`data-send-prop/.test(page));
  ok('record: Paid counts the retainer (J4)', /fmtC\(got\+rp\.cents\)/.test(page) && /Paid so far:/.test(page));
  ok('record: estimates and the recurring invoice are on Billing (J6)', /id="bEstimates"/.test(page) && /id="bRecurring"/.test(page) && /data-est-prop/.test(page) && /data-rec-skip/.test(page));
  ok('record: the Deal tab lists estimates and leaves voided invoices out of its total', /sum\('Estimates'/.test(page) && /const live=inv\.filter\(v=>v\.status==='open'\|\|v\.status==='paid'\)/.test(page));
  ok('record: the Files tab lists estimates', /kind:'estimates',id:es\.id/.test(page));
  const pipe = read('pipeline.html');
  ok('deal page: the same words for a retainer payment and a voided invoice', /d\.retainer\?'Retainer payment'/.test(pipe) && /'Deposit request voided':'Invoice voided'/.test(pipe));
  ok('deal page: already_open handled, resend by the invoice’s own route', /why==='amount_mismatch'\|\|why==='already_open'/.test(pipe) && /api\('\/sales\/invoices\/'\+open\.id\+'\/send'/.test(pipe));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.error('FAILURES'); Deno.exit(1); }
