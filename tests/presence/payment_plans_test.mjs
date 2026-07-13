// ── Payment plans / installments — pure schedule math ────────────────────────
//   deno run --allow-read tests/presence/payment_plans_test.mjs
// buildPaymentSchedule (deposit %/$ + balance · N installments · remainder-on-
// last · sums-to-total · date ordering · stage cap · hostile over-total reject),
// the friendly builders (depositBalanceStages / equalInstallmentStages), and the
// pure UTC date stepper (addDaysISO). All pure — no DB, no network.
import {
  buildPaymentSchedule, depositBalanceStages, equalInstallmentStages, addDaysISO,
  MAX_SCHEDULE_STAGES, MIN_STAGE_CENTS,
} from '../../supabase/functions/presence/lib/sales_lifecycle.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p: !!p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };
const sum = (r) => r.stages.reduce((a, s) => a + s.amount_cents, 0);

// ═══ deposit + balance (percent) ═══
{
  const stages = depositBalanceStages({ deposit_type: 'percent', deposit_value: 50, balance_due_date: '2026-09-01' });
  const r = buildPaymentSchedule(500000, stages);   // $5,000
  ok('50% deposit + balance: ok', r.ok);
  ok('50% deposit: deposit = $2,500', r.ok && r.stages[0].amount_cents === 250000);
  ok('50% deposit: balance = $2,500', r.ok && r.stages[1].amount_cents === 250000);
  ok('50% deposit: sums to total', r.ok && sum(r) === 500000);
  ok('deposit stage is purpose=deposit, labelled Deposit', r.ok && r.stages[0].purpose === 'deposit' && r.stages[0].label === 'Deposit');
  ok('deposit due now (null), balance dated', r.ok && r.stages[0].due_date === null && r.stages[1].due_date === '2026-09-01');
}

// ═══ deposit + balance (fixed $ amount) ═══
{
  const stages = depositBalanceStages({ deposit_type: 'amount', deposit_value: 100000 });  // $1,000 of $3,000
  const r = buildPaymentSchedule(300000, stages);
  ok('$1,000 deposit of $3,000: ok', r.ok);
  ok('$ deposit: balance = remainder $2,000', r.ok && r.stages[1].amount_cents === 200000 && sum(r) === 300000);
}

// ═══ remainder-on-last (rounding drift lands on the final stage) ═══
{
  // 33% of $1,000.00 = $330.00 each for the two non-last; last absorbs the rest.
  const stages = [
    { label: 'A', percent: 33 }, { label: 'B', percent: 33 }, { label: 'C' },   // C omitted → remainder
  ];
  const r = buildPaymentSchedule(100000, stages);
  ok('percent thirds: ok', r.ok);
  ok('percent thirds: first two = $330', r.ok && r.stages[0].amount_cents === 33000 && r.stages[1].amount_cents === 33000);
  ok('percent thirds: last = remainder $340', r.ok && r.stages[2].amount_cents === 34000);
  ok('percent thirds: sums to total exactly', r.ok && sum(r) === 100000);
}

// ═══ N equal installments ═══
{
  const stages = equalInstallmentStages({ total_cents: 100000, count: 3, first_due_date: '2026-01-01', interval_days: 30 });
  const r = buildPaymentSchedule(100000, stages);
  ok('3 equal installments: ok', r.ok);
  ok('3 installments: sums to total (remainder on last)', r.ok && sum(r) === 100000);
  ok('3 installments: 33334 + 33333 + 33333 = 100000', r.ok && r.stages[0].amount_cents === 33333 && r.stages[2].amount_cents === 100000 - 33333 * 2);
  ok('3 installments: dates step by 30 days', r.ok && r.stages[0].due_date === '2026-01-01' && r.stages[1].due_date === '2026-01-31' && r.stages[2].due_date === '2026-03-02');
  ok('3 installments: dates non-decreasing', r.ok && r.stages[0].due_date <= r.stages[1].due_date && r.stages[1].due_date <= r.stages[2].due_date);
}

// ═══ hostile / invalid specs are REJECTED ═══
ok('reject: explicit amounts OVER the total', !buildPaymentSchedule(100000, [{ amount_cents: 80000 }, { amount_cents: 80000 }]).ok);
ok('reject: explicit amounts UNDER the total (do not silently pad)', !buildPaymentSchedule(100000, [{ amount_cents: 10000 }, { amount_cents: 10000 }]).ok);
ok('reject: a single stage is not a plan', !buildPaymentSchedule(100000, [{ amount_cents: 100000 }]).ok);
ok('reject: over the stage cap', !buildPaymentSchedule(1000000, Array.from({ length: MAX_SCHEDULE_STAGES + 1 }, () => ({ percent: 1 }))).ok);
ok('reject: a stage below the $0.50 floor', !buildPaymentSchedule(100000, [{ amount_cents: 99999 }, { amount_cents: 1 }]).ok);
ok('reject: due dates that go backwards', !buildPaymentSchedule(100000, [{ amount_cents: 50000, due_date: '2026-06-01' }, { amount_cents: 50000, due_date: '2026-05-01' }]).ok);
ok('reject: a "due now" stage AFTER a dated stage', !buildPaymentSchedule(100000, [{ amount_cents: 50000, due_date: '2026-06-01' }, { amount_cents: 50000, due_date: null }]).ok);
ok('reject: a percentage of 0', !buildPaymentSchedule(100000, [{ percent: 0 }, {}]).ok);
ok('reject: a percentage of 100 (leaves nothing)', !buildPaymentSchedule(100000, [{ percent: 100 }, {}]).ok);
ok('reject: total below the floor', !buildPaymentSchedule(10, [{ amount_cents: 5 }, { amount_cents: 5 }]).ok);
ok('reject: total over $1,000,000', !buildPaymentSchedule(100000001, [{ percent: 50 }, {}]).ok);
ok('reject: non-array stages', !buildPaymentSchedule(100000, 'nope').ok);

// ═══ explicit amounts that DO sum to the total are accepted ═══
{
  const r = buildPaymentSchedule(100000, [{ label: 'First', amount_cents: 40000, due_date: '2026-01-01' }, { label: 'Second', amount_cents: 60000, due_date: '2026-02-01' }]);
  ok('accept: explicit amounts summing to total', r.ok && sum(r) === 100000 && r.stages[0].label === 'First');
}

// ═══ MIN_STAGE_CENTS boundary ═══
ok('accept: a stage exactly at the $0.50 floor', buildPaymentSchedule(100000, [{ amount_cents: 100000 - MIN_STAGE_CENTS }, { amount_cents: MIN_STAGE_CENTS }]).ok);

// ═══ addDaysISO — pure UTC stepper ═══
ok('addDaysISO: +0 is identity', addDaysISO('2026-07-13', 0) === '2026-07-13');
ok('addDaysISO: crosses a month boundary', addDaysISO('2026-01-31', 1) === '2026-02-01');
ok('addDaysISO: crosses a leap-year Feb (2028)', addDaysISO('2028-02-28', 1) === '2028-02-29');
ok('addDaysISO: crosses a year boundary', addDaysISO('2026-12-31', 1) === '2027-01-01');

// ═══ summary ═══
const passed = results.filter((r) => r.p).length;
const failed = results.length - passed;
console.log(`\n════ PAYMENT PLANS: ${passed}/${results.length} passed${failed ? `, ${failed} FAILED` : ''} ════`);
if (failed) Deno.exit(1);
