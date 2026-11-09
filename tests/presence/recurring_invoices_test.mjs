// ── Estimates and recurring invoices, the pure parts (sales review item 47) ──
// The schedule a recurring invoice keeps (lib/recurring_invoices.ts), the rules an
// estimate's answer follows (lib/estimates.ts), and migration 0145 + its apply pack.
// Eric's choices (Nov 8): every month, 3 months or year; the day the first one
// goes out, the 31st → the last day of a shorter month; around 9 am the studio's
// time; due 14 days later; named for the month; a heads-up 3 days before; pause
// itself when two in a row are unpaid. Estimates: Approve or Not now, 30 days.
//   deno run --allow-read --allow-env --allow-net tests/presence/recurring_invoices_test.mjs
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const R = await import('../../supabase/functions/presence/lib/recurring_invoices.ts');
const E = await import('../../supabase/functions/presence/lib/estimates.ts');
const DA = await import('../../supabase/functions/presence/crm/deal_activity.ts');
const DOCS = await import('../../supabase/functions/presence/lib/documents.ts');

let pass = 0, fail = 0;
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; console.log('FAIL ', n, note); } };

// ═══ 1. dates ═══
{
  ok('1: real dates only', R.isYmd('2026-12-01') && R.isYmd('2028-02-29') && !R.isYmd('2027-02-29') && !R.isYmd('2026-13-01') && !R.isYmd('2026-12-1') && !R.isYmd('') && !R.isYmd(null));
  ok('1: days in a month', R.daysInMonth(2027, 2) === 28 && R.daysInMonth(2028, 2) === 29 && R.daysInMonth(2026, 12) === 31 && R.daysInMonth(2026, 11) === 30);
  ok('1: adding days crosses months and years', R.addDays('2026-12-25', 14) === '2027-01-08' && R.addDays('2026-12-01', -3) === '2026-11-28');
  const m = (from, n, anchor) => R.shiftMonths(from, n, anchor);
  ok('1: the 31st becomes the last day of a shorter month, then comes back', m('2027-01-31', 1, 31) === '2027-02-28' && m('2027-02-28', 1, 31) === '2027-03-31' && m('2027-03-31', 1, 31) === '2027-04-30');
  ok('1: a leap year keeps the 29th', m('2028-01-31', 1, 31) === '2028-02-29' && m('2028-02-29', 12, 29) === '2029-02-28');
  ok('1: December rolls into January', m('2026-12-15', 1, 15) === '2027-01-15' && m('2026-11-30', 3, 30) === '2027-02-28');
  const next = (ymd, anchor, every) => R.nextOccurrence(ymd, anchor, every);
  ok('1: every month, every 3 months, every year', next('2026-12-01', 1, 'month') === '2027-01-01' && next('2026-12-01', 1, 'quarter') === '2027-03-01' && next('2026-12-01', 1, 'year') === '2027-12-01');
  let d = '2027-01-31'; const run = []; for (let i = 0; i < 4; i++) { run.push(d); d = next(d, 31, 'month'); }
  ok('1: a schedule on the 31st walks Jan 31 → Feb 28 → Mar 31 → Apr 30', run.join() === '2027-01-31,2027-02-28,2027-03-31,2027-04-30', run.join());
  ok('1: a quarterly schedule on the 30th keeps its day after February', next('2026-11-30', 30, 'quarter') === '2027-02-28' && next('2027-02-28', 30, 'quarter') === '2027-05-30');
  ok('1: the day of a date', R.dayOf('2026-12-31') === 31 && R.dayOf('2026-12-01') === 1);
}

// ═══ 2. names ═══
{
  ok('2: each invoice is named for its month', R.recurringInvoiceTitle('Website care', '2026-12-01') === 'Website care — December 2026');
  ok('2: a blank name still reads', R.recurringInvoiceTitle('  ', '2027-01-15') === 'Invoice — January 2027');
  ok('2: control characters never reach the name', R.recurringInvoiceTitle('Care\nplan\t', '2027-03-01') === 'Care plan — March 2027');
  ok('2: months and days in words', R.monthLabel('2027-02-28') === 'February 2027' && R.dayLabel('2026-12-01') === 'Dec 1, 2026' && R.monthLabel('nope') === '');
  ok('2: how often, in words', R.everyLabel('month') === 'every month' && R.everyLabel('quarter') === 'every 3 months' && R.everyLabel('year') === 'every year' && R.everyLabel(undefined) === 'every month');
}

// ═══ 3. the studio's own clock ═══
{
  const at = (iso) => Date.parse(iso);
  const la = R.localClock('America/Los_Angeles', at('2026-12-01T16:30:00Z'));
  ok('3: 16:30 UTC is 8:30 am on Dec 1 in Los Angeles', la.ymd === '2026-12-01' && la.hour === 8, JSON.stringify(la));
  ok('3: 17:00 UTC is 9 am there', R.localClock('America/Los_Angeles', at('2026-12-01T17:00:00Z')).hour === 9);
  ok('3: 03:00 UTC Dec 2 is still Dec 1 in Los Angeles', R.localClock('America/Los_Angeles', at('2026-12-02T03:00:00Z')).ymd === '2026-12-01');
  ok('3: New York is three hours ahead', R.localClock('America/New_York', at('2026-12-01T14:00:00Z')).hour === 9);
  const bad = R.localClock('Not/A_Zone', at('2026-12-01T17:00:00Z'));
  ok('3: a bad or missing zone falls back to Pacific', bad.ymd === '2026-12-01' && bad.hour === 9 && R.localClock(null, at('2026-12-01T17:00:00Z')).hour === 9);
}

// ═══ 4. when it sends, and the heads-up ═══
{
  const s = (over = {}) => ({ status: 'active', next_on: '2026-12-01', ...over });
  ok('4: on its day, not before 9 am the studio\'s time', !R.sendDue(s(), { ymd: '2026-12-01', hour: 8 }));
  ok('4: on its day, from 9 am', R.sendDue(s(), { ymd: '2026-12-01', hour: 9 }) && R.sendDue(s(), { ymd: '2026-12-01', hour: 17 }));
  ok('4: a day that went by goes at once, whatever the hour', R.sendDue(s(), { ymd: '2026-12-02', hour: 0 }));
  ok('4: never early', !R.sendDue(s(), { ymd: '2026-11-30', hour: 23 }));
  ok('4: never while paused, stopped or finished', ['paused', 'stopped', 'finished'].every((st) => !R.sendDue(s({ status: st }), { ymd: '2026-12-05', hour: 12 })));
  ok('4: never without a date', !R.sendDue(s({ next_on: null }), { ymd: '2026-12-05', hour: 12 }));
  ok('4: the heads-up shows from three days before', R.headsUpDue(s(), '2026-11-28') && R.headsUpDue(s(), '2026-11-30'));
  ok('4: …not four days before, and not on the day', !R.headsUpDue(s(), '2026-11-27') && !R.headsUpDue(s(), '2026-12-01'));
  ok('4: …and never for a paused one', !R.headsUpDue(s({ status: 'paused' }), '2026-11-29'));
}

// ═══ 5. two in a row unpaid ═══
{
  const v = (on, over = {}) => ({ recurring_on: on, status: 'open', due_date: R.addDays(on, 14), created_at: on + 'T17:00:00Z', ...over });
  const today = '2026-12-01';
  ok('5: the last two still open and past due → pause', R.twoUnpaidInARow([v('2026-10-01'), v('2026-11-01')], today));
  ok('5: one of them paid → keep going', !R.twoUnpaidInARow([v('2026-10-01'), v('2026-11-01', { status: 'paid' })], today));
  ok('5: one of them settling (processing) → keep going', !R.twoUnpaidInARow([v('2026-10-01'), v('2026-11-01', { processing_since: '2026-11-20T00:00:00Z' })], today));
  ok('5: not past due yet → keep going', !R.twoUnpaidInARow([v('2026-10-01'), v('2026-11-20')], today));
  ok('5: only one sent so far → keep going', !R.twoUnpaidInARow([v('2026-11-01')], today));
  ok('5: a voided one isn\'t owed, so the two before it count', R.twoUnpaidInARow([v('2026-09-01'), v('2026-10-01'), v('2026-11-01', { status: 'void' })], today));
  ok('5: the newest two decide, in date order', !R.twoUnpaidInARow([v('2026-11-01', { status: 'paid' }), v('2026-09-01'), v('2026-10-01')], today));
  ok('5: after Resume, the ones sent before it don\'t count', !R.twoUnpaidInARow([v('2026-10-01'), v('2026-11-01')], today, '2026-11-25T00:00:00Z'));
  ok('5: times compare as times, whatever their written form', !R.twoUnpaidInARow([v('2026-10-01', { created_at: '2026-11-25T10:00:00.5+00:00' }), v('2026-11-01', { created_at: '2026-11-25T10:00:00+00:00' })], today, '2026-11-25T10:00:00.900Z')
    && R.twoUnpaidInARow([v('2026-10-01', { created_at: '2026-11-25T11:00:00+00:00' }), v('2026-11-01', { created_at: '2026-11-25T12:00:00+00:00' })], today, '2026-11-25T10:00:00.900Z'));
}

// ═══ 6. after a send, resume ═══
{
  const base = { next_on: '2026-12-01', anchor_day: 1, every: 'month', times: null, sent_count: 0 };
  ok('6: after one goes out, the next date and the count', JSON.stringify(R.afterSend(base)) === JSON.stringify({ next_on: '2027-01-01', sent_count: 1, status: 'active' }));
  ok('6: the last of a set number finishes it', JSON.stringify(R.afterSend({ ...base, times: 3, sent_count: 2 })) === JSON.stringify({ next_on: null, sent_count: 3, status: 'finished' }));
  ok('6: resume keeps a date still ahead', R.resumeOn('2026-12-10', '2026-12-01') === '2026-12-10' && R.resumeOn('2026-12-01', '2026-12-01') === '2026-12-01');
  ok('6: resume sends a missed date today', R.resumeOn('2026-11-01', '2026-12-03') === '2026-12-03' && R.resumeOn(null, '2026-12-03') === '2026-12-03');
}

// ═══ 7. what the studio types ═══
{
  const today = '2026-11-20';
  const good = { title: ' Website care ', amount_cents: 50000, every: 'month', first_on: '2026-12-01', times: '' };
  const v = R.validateRecurringStart(good, today);
  ok('7: a good Start form', v.ok && v.value.title === 'Website care' && v.value.amount_cents === 50000 && v.value.anchor_day === 1 && v.value.times === null && v.value.due_days === 14, JSON.stringify(v));
  const err = (over) => { const r = R.validateRecurringStart({ ...good, ...over }, today); return r.ok ? '' : r.error; };
  ok('7: it needs what it\'s for', /what it’s for/.test(err({ title: '' })));
  ok('7: at least $0.50, at most $1,000,000', /at least \$0\.50/.test(err({ amount_cents: 49 })) && /over \$1,000,000/.test(err({ amount_cents: 100000001 })) && /at least/.test(err({ amount_cents: 'lots' })));
  ok('7: every month, 3 months or year', /every month, every 3 months or every year/.test(err({ every: 'week' })));
  ok('7: a real first date, from today on, within a year', /Pick the date the first one goes out/.test(err({ first_on: '2026-02-30' })) && /from today on/.test(err({ first_on: '2026-11-19' })) && /within the next year/.test(err({ first_on: '2027-12-01' })) && err({ first_on: today }) === '');
  ok('7: how many times: blank, or 1 to 120', err({ times: 12 }) === '' && /1 to 120/.test(err({ times: 0 })) && /1 to 120/.test(err({ times: 1.5 })) && /1 to 120/.test(err({ times: 121 })));
  ok('7: the first date sets the day it repeats on', R.validateRecurringStart({ ...good, first_on: '2027-01-31' }, today).value.anchor_day === 31);
  const ch = (b, cur = { sent_count: 2 }) => R.validateRecurringChange(b, cur, today);
  ok('7: Change moves the day with a new next date', JSON.stringify(ch({ next_on: '2026-12-15' }).value) === JSON.stringify({ next_on: '2026-12-15', anchor_day: 15 }));
  ok('7: Change takes a new amount and name', ch({ amount_cents: 60000, title: 'Care plan' }).ok && ch({ amount_cents: 60000 }).value.amount_cents === 60000);
  ok('7: Change can\'t set fewer times than have already gone out', !ch({ times: 2 }).ok && /already gone out 2 times/.test(ch({ times: 2 }).error) && ch({ times: 3 }).ok && ch({ times: null }).ok);
  ok('7: Change with nothing in it says so', !ch({}).ok && /Nothing to change/.test(ch({}).error));
}

// ═══ 8. the words ═══
{
  ok('8: started', R.recurringEventLine({ action: 'started', title: 'Website care', amount_cents: 50000, every: 'month', on: '2026-12-01' }) === 'Recurring invoice started — Website care, $500.00 every month from Dec 1, 2026');
  ok('8: changed, skipped, paused, resumed, stopped, finished', R.recurringEventLine({ action: 'changed', amount_cents: 60000, on: '2027-01-15' }) === 'Recurring invoice changed — $600.00, next on Jan 15, 2027'
    && R.recurringEventLine({ action: 'skipped', on: '2026-12-01' }) === 'Recurring invoice: skipped Dec 1, 2026'
    && R.recurringEventLine({ action: 'paused', reason: 'unpaid' }) === 'Recurring invoice paused — the last two invoices are still unpaid'
    && R.recurringEventLine({ action: 'paused', reason: 'manual' }) === 'Recurring invoice paused'
    && R.recurringEventLine({ action: 'resumed', on: '2026-12-03' }) === 'Recurring invoice resumed — next on Dec 3, 2026'
    && R.recurringEventLine({ action: 'stopped' }) === 'Recurring invoice stopped'
    && R.recurringEventLine({ action: 'finished' }) === 'Recurring invoice finished — the last one went out');
  const p = R.pauseNoticeCopy('no_email', 'Blue Finch Café website');
  ok('8: the pause notice names the deal, says why and what to do', p.headline === 'Recurring invoice paused — Blue Finch Café website' && /no client email/.test(p.body) && /Add their email/.test(p.body));
  ok('8: …for each reason', /still unpaid/.test(R.pauseNoticeCopy('unpaid', 'x').body) && /Stripe isn’t connected/.test(R.pauseNoticeCopy('no_stripe', 'x').body));
  const h = R.headsUpCopy({ title: 'Website care', on: '2026-12-01', amount_cents: 50000, who: 'Blue Finch Café' });
  ok('8: the heads-up says what goes out, when, to whom and for how much', h.headline === 'Goes out Dec 1: Website care — December 2026 to Blue Finch Café ($500.00)' && /skip this one, change it or stop it/i.test(h.body), h.headline);
  ok('8: the deal history reads them (server)', DA.describeSystemEvent({ kind: 'recurring_invoice', detail: { action: 'stopped' } }) === 'Recurring invoice stopped'
    && DA.describeSystemEvent({ kind: 'invoice_sent', detail: { amount_cents: 50000, purpose: 'service', recurring_id: 'r', period: 'December 2026' } }) === 'Recurring invoice sent — $500 (December 2026)'
    && DA.describeSystemEvent({ kind: 'invoice_sent', detail: { amount_cents: 50000, purpose: 'service' } }) === 'Invoice sent — $500');
}

// ═══ 9. estimates ═══
{
  ok('9: only a sent estimate can be answered', E.canDecideEstimate('sent', 'approved') && E.canDecideEstimate('sent', 'declined') && !E.canDecideEstimate('draft', 'approved') && !E.canDecideEstimate('approved', 'declined') && !E.canDecideEstimate('sent', 'accepted'));
  const now = '2026-12-01T00:00:00.000Z';
  ok('9: good for 30 days', E.estimateExpiresAt(Date.parse(now)) === '2026-12-31T00:00:00.000Z' && E.ESTIMATE_TTL_DAYS === 30);
  ok('9: expired after that', E.estimateExpired({ expires_at: '2026-11-30T23:59:59.000Z' }, now) && !E.estimateExpired({ expires_at: '2026-12-31T00:00:00.000Z' }, now) && !E.estimateExpired({ expires_at: null }, now));
  ok('9: one word for where it stands', E.estimateState({ status: 'sent', expires_at: '2026-12-31T00:00:00Z' }, now) === 'open' && E.estimateState({ status: 'sent', expires_at: '2026-11-01T00:00:00Z' }, now) === 'expired' && E.estimateState({ status: 'approved' }, now) === 'approved' && E.estimateState({ status: 'declined' }, now) === 'declined' && E.estimateState({}, now) === 'draft');
  ok('9: the deal history reads them', DA.describeSystemEvent({ kind: 'estimate_sent', detail: { total_cents: 120000 } }) === 'Estimate sent — $1,200'
    && DA.describeSystemEvent({ kind: 'estimate_decided', detail: { decision: 'approved', total_cents: 120000 } }) === 'Estimate approved — $1,200'
    && DA.describeSystemEvent({ kind: 'estimate_decided', detail: { decision: 'declined' } }) === 'They passed on the estimate (Not now)'
    && DA.describeSystemEvent({ kind: 'estimate_deleted', detail: {} }) === 'Draft estimate removed'
    && DA.describeSystemEvent({ kind: 'doc_opened', detail: { what: 'estimate' } }) === 'They opened your estimate');
  const li = [{ label: 'Homepage refresh', qty: 1, unit_cents: 90000 }, { label: 'Menu page', qty: 2, unit_cents: 20000 }, { __meta__: { discount: { mode: 'percent', value: 10 } } }];
  const doc = DOCS.renderDocument('estimate', { title: 'Spring refresh', line_items: li, currency: 'usd', status: 'sent', expires_at: '2026-12-31T00:00:00Z', terms: 'Photos supplied by you.' }, { name: 'Example Studio', accent: '#5b3fa0', accentDark: '#3d2a6e' });
  ok('9: the printable copy says Estimate, with the lines, the discount and the total', /<div class="doclabel">Estimate<\/div>/.test(doc) && /Spring refresh/.test(doc) && /Discount \(10%\)/.test(doc) && /\$1,170\.00/.test(doc) && /Photos supplied by you\./.test(doc));
  ok('9: …and says nothing is charged, and until when', /not a final price — nothing is charged until you get an invoice\. Good until 2026-12-31\./.test(doc));
  ok('9: an approved one says thank you; a passed-on one says so', /Approved — thank you\./.test(DOCS.renderDocument('estimate', { line_items: li, status: 'approved' })) && /You chose not now on this estimate\./.test(DOCS.renderDocument('estimate', { line_items: li, status: 'declined' })));
  const prop = DOCS.renderDocument('proposal', { title: 'Spring refresh', line_items: li, currency: 'usd', status: 'sent' });
  ok('9: a proposal still prints as a proposal', /<div class="doclabel">Proposal<\/div>/.test(prop) && /This is a proposal — nothing is final until you accept\./.test(prop) && /<title>Spring refresh — Studio OS<\/title>/.test(prop));
}

// ═══ 10. migration 0145 and its apply pack ═══
{
  const mig = read('supabase/migrations/0145_estimates_recurring_invoices.sql');
  const pack = read('docs/presence/APPLY-0145-prod.sql');
  const m144 = read('supabase/migrations/0144_email_opens.sql');
  const m135 = read('supabase/migrations/0135_approval_due_date_reminders.sql');
  const list = (s, table, con) => ((s.match(new RegExp(`${table}\\s+add constraint ${con}\\s+check \\(kind in \\(([\\s\\S]*?)\\)\\)`)) || [])[1] || '')
    .replace(/--[^\n]*/g, '').match(/'([a-z_]+)'/g)?.map((x) => x.slice(1, -1)) || [];
  const ev = (s) => list(s, 'presence_deal_events', 'presence_deal_events_kind_check');
  const nk = (s) => list(s, 'presence_plan_notices', 'presence_plan_notices_kind_check');
  ok('10: first line is the rollback note (migrations/README)', /^-- rollback:/.test(mig));
  ok('10: the deal-history kinds carry 0144 forward and add four', ev(m144).length === 14 && ev(m144).every((k) => ev(mig).includes(k)) && ['estimate_sent', 'estimate_decided', 'estimate_deleted', 'recurring_invoice'].every((k) => ev(mig).includes(k)) && ev(mig).length === 18, ev(mig).join());
  ok('10: the notice kinds carry 0135 forward and add invoice_upcoming', nk(m135).length > 30 && nk(m135).every((k) => nk(mig).includes(k)) && nk(mig).includes('invoice_upcoming') && nk(mig).length === nk(m135).length + 1);
  ok('10: the apply pack has exactly the same two lists', JSON.stringify(ev(pack)) === JSON.stringify(ev(mig)) && JSON.stringify(nk(pack)) === JSON.stringify(nk(mig)));
  for (const t of ['presence_estimates', 'presence_recurring_invoices']) {
    for (const s of [mig, pack]) {
      ok(`10: ${t} is deny-all and the API roles can't reach it (${s === mig ? 'migration' : 'pack'})`, new RegExp(`create table if not exists public\\.${t} \\(`).test(s) && s.includes(`alter table public.${t} enable row level security`) && s.includes(`revoke all on public.${t} from anon, authenticated`) && s.includes(`grant all on public.${t} to service_role`));
    }
  }
  ok('10: the send-once guard: one invoice per schedule per date', /create unique index if not exists presence_invoices_recurring_once\s+on public\.presence_invoices \(recurring_id, recurring_on\) where recurring_id is not null/.test(mig) && /presence_invoices_recurring_once/.test(pack));
  ok('10: every change is re-runnable', !/create table public\./.test(mig) && /drop constraint if exists presence_deal_events_kind_check/.test(mig) && /drop constraint if exists presence_plan_notices_kind_check/.test(mig) && /add column if not exists recurring_id/.test(pack));
  ok('10: the pack ends in a check query', /-- Check:[\s\S]*select 'table' as what/.test(pack));
  // and the new code writes only kinds the new lists allow
  const src = read('supabase/functions/presence/routes/estimates.ts') + read('supabase/functions/presence/routes/recurring_invoices.ts');
  const written = [...src.matchAll(/dealEvent\([^,]+, [^,]+, '([a-z_]+)'/g)].map((m) => m[1]);
  ok('10: the new routes write deal-history kinds (found some)', written.length >= 8, written.join());
  for (const k of new Set(written)) ok(`10: deal-history kind '${k}' is allowed by 0145`, ev(mig).includes(k));
  const raised = [...src.matchAll(/raiseNotice\(\{[^}]*?kind: '([a-z_]+)'/g)].map((m) => m[1]);
  ok('10: the new routes raise notices (found some)', raised.length >= 4, raised.join());
  for (const k of new Set(raised)) ok(`10: notice kind '${k}' is allowed by 0145`, nk(mig).includes(k));
}

console.log(`\n════ ESTIMATES + RECURRING INVOICES (pure): ${pass}/${pass + fail} ${fail ? 'FAILED' : 'PASSED'} ════`);
if (fail) Deno.exit(1);
