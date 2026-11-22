// ── Sales fixes of Nov 22 2026 (items 143, 146, 150, 151, 153–156, 158, 161): the pure parts ──
//   deno run --allow-read --allow-env --allow-net tests/presence/sales_fixes_nov22_test.mjs
//
// The route and page halves are pinned where their harnesses live (contact_import_merge_test,
// customers_241_test, never_silent_test, needs_you_test, projects_routes_test and
// tests/e2e/sales-fixes-nov22.spec.ts). This file pins what is pure and shared:
//   146  one list of deal stages, read by the reminder job, My tasks and Needs you alike
//   151  the day a page sends is taken only when it is a real day near the clock
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');

const { OPEN_DEAL_STAGES, CLOSED_DEAL_STAGES, DEAL_STAGES, isOpenDealStage, OPEN_DEAL_STAGES_FILTER } = await import('../../supabase/functions/presence/lib/deal_stages.ts');
const { OPEN_STAGES } = await import('../../supabase/functions/presence/lib/sales_reports.ts');
const { MY_TASKS_OPEN_STAGES } = await import('../../supabase/functions/presence/lib/my_tasks.ts');
const { callerDay } = await import('../../supabase/functions/presence/agency/routes.ts');

// ═══ 146: the shared stage list ═══
{
  const same = (a, b) => JSON.stringify([...a]) === JSON.stringify([...b]);
  ok('146: the open stages are lead, qualified, proposal, contract — the first is lead, never new', same(OPEN_DEAL_STAGES, ['lead', 'qualified', 'proposal', 'contract']));
  ok('146: the reports’ list and My tasks’ list are the shared one', same(OPEN_STAGES, OPEN_DEAL_STAGES) && same(MY_TASKS_OPEN_STAGES, OPEN_DEAL_STAGES));
  ok('146: closed stages are won and lost, and together they are the six the database allows', same(CLOSED_DEAL_STAGES, ['won', 'lost']) && DEAL_STAGES.length === 6);
  ok('146: isOpenDealStage says yes to each open stage and no to new, won, lost and nothing', OPEN_DEAL_STAGES.every(isOpenDealStage) && !isOpenDealStage('new') && !isOpenDealStage('won') && !isOpenDealStage('lost') && !isOpenDealStage('') && !isOpenDealStage(null));
  ok('146: the database filter names the same stages', OPEN_DEAL_STAGES_FILTER === 'stage=in.(lead,qualified,proposal,contract)');
  // the migration that made the stage column allows exactly these six
  const mig = Deno.readTextFileSync(new URL('../../supabase/migrations/0074_p2c_sales_lifecycle.sql', import.meta.url));
  const m = /stage\s+text[^\n]*?check\s*\(\s*stage\s+in\s*\(([^)]*)\)/i.exec(mig) || /check\s*\(\s*stage\s+in\s*\(([^)]*)\)/i.exec(mig);
  const allowed = m ? m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')) : [];
  ok('146: the shared list is exactly what migration 0074 lets a deal be', allowed.length === 6 && same([...allowed].sort(), [...DEAL_STAGES].sort()), JSON.stringify(allowed));
}

// ═══ 151: the day a page sends ═══
{
  const clock = '2026-11-22T01:00:00Z';
  ok('151: a day beside the clock is taken (the evening before, in Burbank; the day after, in Sydney)', callerDay('2026-11-21', clock) === '2026-11-21' && callerDay('2026-11-22', clock) === '2026-11-22' && callerDay('2026-11-23', clock) === '2026-11-23');
  ok('151: a day far from the clock, a time, a word or nothing is not', callerDay('2026-11-01', clock) === undefined && callerDay('2027-01-01', clock) === undefined && callerDay('2026-11-21T10:00:00Z', clock) === undefined && callerDay('today', clock) === undefined && callerDay('', clock) === undefined && callerDay(null, clock) === undefined);
}

const passed = results.filter(Boolean).length;
console.log(`\n════ SALES FIXES NOV 22 (pure): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
