// ── Plan my week (builder list item 176) ─────────────────────────────────────
// Wix Studio's "Plan your week": every client in the order they need the studio
// over the next seven days. This suite proves the rules (lib/week_plan.ts) and
// drives GET /agency/week (agency/client_tools.ts) against stand-ins:
//   · Home's Needs you rows are the start, and a row gets its day when it has one
//     (an invoice's due date, a deal step's date) — one line per thing, never two;
//   · dated to-dos and project steps, estimates that run out, recurring invoices
//     and monthly reports that go out, content forms that came back, join in;
//   · snoozed things stay away, things after the week stay out;
//   · late first, then today, then by day; clients ranked by who needs you
//     first; the studio's own last; a "why" line from the first two things;
//   · the day counts, and the plain list for "Copy as a list".
//   deno run --allow-read --allow-env tests/presence/week_plan_test.mjs
Deno.env.set('SUPABASE_URL', 'http://stub.local');
Deno.env.set('SERVICE_ROLE_KEY', 'service-key');
const W = await import('../../supabase/functions/presence/lib/week_plan.ts');
const { handleClientTools } = await import('../../supabase/functions/presence/agency/client_tools.ts');
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const TODAY = '2026-11-16';   // a Monday
const A = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', B = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2', C = 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3';
const CL_B = 'cbcbcbcb-cbcb-4cbc-8cbc-cbcbcbcbcbcb';
const names = { [A]: 'Maple & Main Realty', [B]: 'Juniper Floral Co.', [C]: 'Harbor Dental' };

// ═══ 1. the small rules ═══
ok('days: add, between, weekday', W.addDays(TODAY, 6) === '2026-11-22' && W.daysBetween('2026-11-10', TODAY) === 6 && W.dow(TODAY) === 'Mon' && W.dow('2026-11-20') === 'Fri');
ok('today: the page’s own day within a day of ours, else ours', W.todayFrom('2026-11-15', '2026-11-16T03:00:00Z') === '2026-11-15' && W.todayFrom('2026-11-20', '2026-11-16T03:00:00Z') === '2026-11-16' && W.todayFrom('junk', '2026-11-16T03:00:00Z') === '2026-11-16');
ok('money words', W.money(160000) === '$1,600' && W.money(4550) === '$45.5' && W.money(null) === '$0');

// ═══ 2. the sources ═══
const needs = [
  { key: 'money:inv1', kind: 'money', site_id: A, client_id: null, name: 'Maple & Main Realty', what: 'Invoice $1,600 is 6 days overdue', verb: 'Resend', href: '/pipeline.html#outstanding' },
  { key: 'money:inv2', kind: 'money', site_id: null, client_id: CL_B, name: 'Juniper Floral Co.', what: 'Invoice $450 is due Thursday', verb: 'Open', href: '/pipeline.html#outstanding' },
  { key: 'broken:domain:' + A, kind: 'broken', site_id: A, client_id: null, name: 'Maple & Main Realty', what: 'maplemain.example ends in 4 days', verb: 'Renew', href: '/domains.html' },
  { key: 'enquiry:own:e1', kind: 'enquiry', site_id: null, client_id: null, name: 'Dana Reyes', what: 'New enquiry from your website', verb: 'Reply', href: '/inbox.html' },
  { key: 'deal:d9', kind: 'deal', site_id: null, client_id: null, name: 'Rivera Law', what: 'Next step is 1 day late: send the proposal', verb: 'Open deal', href: '/pipeline.html?deal=d9' },
  { key: 'publish:' + C, kind: 'publish', site_id: C, client_id: null, name: 'Harbor Dental', what: '3 changes not published', verb: 'Review', href: '/presence.html?client=' + C },
];
const fromNeeds = W.thingsFromNeeds(needs, { invoiceDue: { inv1: '2026-11-10', inv2: '2026-11-19' }, stepDue: { d9: '2026-11-15' } }, TODAY);
ok('needs: an invoice gets its due date — late, or a day this week', fromNeeds[0].day === '2026-11-10' && fromNeeds[0].short === 'a late invoice' && fromNeeds[1].day === '2026-11-19' && fromNeeds[1].short === 'an invoice due Thu');
ok('needs: a deal step gets its date; a domain row stays "now"', fromNeeds[4].day === '2026-11-15' && fromNeeds[2].day === null && fromNeeds[2].short === 'their domain to renew');
const tasks = [
  { kind: 'next_step', id: 'd9', parent_id: 'd9', title: 'send the proposal', due: '2026-11-15', context: 'Rivera Law', href: '/pipeline.html?deal=d9' },
  { kind: 'deal_task', id: 't1', parent_id: 'd1', title: 'call about photos', due: '2026-11-18', context: 'Juniper site', href: '/pipeline.html?deal=d1' },
  { kind: 'project_task', id: 'p1', parent_id: 'proj1', title: 'first draft to the client', due: '2026-11-18', context: 'Juniper build', href: '/projects.html' },
  { kind: 'deal_task', id: 't2', parent_id: 'd1', title: 'undated one', due: null, context: '', href: '/x' },
];
const fromTasks = W.thingsFromTasks(tasks, { deal: { d1: { site_id: B, client_id: null } }, project: { proj1: { site_id: B, client_id: null } } }, TODAY);
ok('tasks: undated work isn’t this week’s; a next step shares the deal row’s key', fromTasks.length === 3 && fromTasks[0].key === 'deal:d9' && fromTasks[1].key === 'task:t1' && fromTasks[2].key === 'ptask:p1');
ok('tasks: words name what kind, and the deal when it has no client', fromTasks[0].what === 'Next step: send the proposal · Rivera Law' && fromTasks[1].what === 'To-do: call about photos' && fromTasks[2].what === 'Project step: first draft to the client' && fromTasks[2].verb === 'Open project');
const est = W.thingsFromEstimates([{ id: 'e1', deal_id: 'd3', subtotal_cents: 240000, expires_at: '2026-11-18T17:00:00Z', status: 'sent' }, { id: 'e2', deal_id: 'd3', status: 'approved', expires_at: '2026-11-18T00:00:00Z' }], { d3: { site_id: C, client_id: null } });
ok('estimates: a sent one runs out on its day; a decided one doesn’t count', est.length === 1 && est[0].day === '2026-11-18' && est[0].what === 'Estimate $2,400 runs out' && est[0].href === '/pipeline.html?deal=d3');
const rec = W.thingsFromRecurring([{ id: 'r1', deal_id: 'd4', title: 'Website care', amount_cents: 35000, next_on: '2026-11-17', status: 'active' }, { id: 'r2', deal_id: 'd4', next_on: '2026-11-17', status: 'paused' }], { d4: { site_id: null, client_id: null, title: 'Kiln Street Bakery' } });
ok('recurring: an active one goes out on its day (a paused one doesn’t); with no client it names the deal', rec.length === 1 && rec[0].what === 'Website care goes out ($350) · Kiln Street Bakery' && rec[0].day === '2026-11-17');
const rep = W.thingsFromReports([{ site_id: A, enabled: true, last_month: '2026-10' }, { site_id: B, enabled: false, last_month: null }], '2026-11-27');
ok('reports: the 1st inside the week, about the month before, only when switched on', rep.length === 1 && rep[0].day === '2026-12-01' && rep[0].key === `report:${A}:2026-11` && rep[0].href === `/settings.html?client=${A}#report`);
ok('reports: a month already handled isn’t listed again', W.thingsFromReports([{ site_id: A, enabled: true, last_month: '2026-11' }], '2026-11-27').length === 0);
ok('reports: on the 2nd, a month not yet handled is due today', (() => { const r = W.thingsFromReports([{ site_id: A, enabled: true, last_month: '2026-10' }], '2026-12-02'); return r.length === 1 && r[0].day === '2026-12-02' && r[0].key.endsWith(':2026-11'); })());
const intake = W.thingsFromIntake([
  { site_id: B, status: 'open', answered: 9, sent_at: '2026-11-15T10:00:00Z', seen_at: null, emailed_at: null, created_at: '2026-11-01T00:00:00Z' },
  { site_id: C, status: 'open', answered: 0, sent_at: null, seen_at: null, emailed_at: '2026-11-05T00:00:00Z', created_at: '2026-11-05T00:00:00Z' },
  { site_id: A, status: 'open', answered: 0, sent_at: null, seen_at: null, emailed_at: '2026-11-14T00:00:00Z', created_at: '2026-11-14T00:00:00Z' },
], TODAY);
ok('content forms: answers that came back unread, and one never started after a week (not one sent two days ago)', intake.length === 2 && intake[0].what === 'Their words and photos arrived' && intake[0].href === `/sites.html#answers=${B}` && intake[1].site_id === C && intake[1].verb === 'Send it again');

// ═══ 3. the plan ═══
const later = { key: 'estimate:far', kind: 'estimate', site_id: C, client_id: null, name: '', what: 'Estimate runs out', verb: 'Follow up', href: '/x', day: '2026-11-30', short: 'x' };
const plan = W.buildWeek({ today: TODAY, things: [...fromNeeds, ...fromTasks, ...est, ...rec, ...intake, later], names, siteOfClient: { [CL_B]: B }, snoozed: { ['publish:' + C]: '2026-11-20T00:00:00Z' } });
const byName = Object.fromEntries(plan.clients.map((c) => [c.name, c]));
ok('one line per thing: Needs you’s deal row and its next step are one', plan.clients.flatMap((c) => c.items).filter((i) => i.key === 'deal:d9').length === 1);
ok('snoozed things and things after the week stay out', !plan.clients.flatMap((c) => c.items).some((i) => i.key === 'publish:' + C || i.key === 'estimate:far'));
ok('a client known only by its customer record joins its site’s card', byName['Juniper Floral Co.'].items.some((i) => i.key === 'money:inv2') && byName['Juniper Floral Co.'].site_id === B);
ok('ranked: the client with the latest thing first, marked "needs you first"; the studio’s own last', plan.clients[0].name === 'Maple & Main Realty' && plan.clients[0].first === true && plan.clients.filter((c) => c.first).length === 1 && plan.clients[plan.clients.length - 1].own === true && plan.clients[plan.clients.length - 1].name === 'Not tied to a client');
ok('ranked: today’s things beat later-this-week ones', plan.clients.findIndex((c) => c.name === 'Juniper Floral Co.') < plan.clients.findIndex((c) => c.name === 'Harbor Dental'));
const maple = byName['Maple & Main Realty'];
ok('inside a card: late, then now, then by day — with how late', maple.items.map((i) => i.when).join() === 'late,today' && maple.items[0].late_days === 6 && maple.items[0].what === 'Invoice $1,600 is 6 days overdue');
ok('the "why" line is the first two things', maple.why === 'A late invoice, and their domain to renew' && byName['Juniper Floral Co.'].why.startsWith('Their words and photos arrived, and'));
const own = plan.clients.find((c) => c.own);
ok('the studio’s own card says whose each thing is', own.items.some((i) => i.what === 'Dana Reyes — New enquiry from your website') && own.items.some((i) => i.key === 'deal:d9' && i.when === 'late'));
ok('the day counts: late, then each day of the week', plan.days.length === 8 && plan.days[0].day === 'late' && plan.days[0].count === plan.late && plan.late === 2 && plan.days[1].day === TODAY && plan.days.slice(1).every((d, i) => d.day === W.addDays(TODAY, i)) && plan.days.reduce((n, d) => n + d.count, 0) === plan.total);
ok('a quiet week is an empty plan, not an error', (() => { const q = W.buildWeek({ today: TODAY, things: [], names }); return q.total === 0 && q.clients.length === 0 && q.days.length === 8; })());
const text = W.weekAsText(plan);
ok('Copy as a list: the plain lines, first client marked', text.startsWith('Plan for 2026-11-16 to 2026-11-22') && text.includes('Maple & Main Realty (first) — A late invoice') && text.includes('  • Late 6 days: Invoice $1,600 is 6 days overdue') && text.includes('Thu 19'));

// ═══ 4. GET /agency/week, end to end ═══
// the route trusts the page's day only within a day of its own clock, so this part runs on the real today
const RT = new Date().toISOString().slice(0, 10), DUE = W.addDays(RT, -6), RUNS_OUT = W.addDays(RT, 2);
const DEAL = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const AG = 'aaaaaaaa-0000-4000-8000-000000000001', STUDIO = 'e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3';
const reads = [];
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  const table = u.pathname.replace(/^.*\/rest\/v1\//, '');
  reads.push(table);
  const reply = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (table === 'presence_invoices') return reply(u.searchParams.get('status') === 'eq.open' ? [{ id: 'inv1', title: 'Website', amount_cents: 160000, due_date: DUE, deal_id: null }] : []);
  if (table === 'presence_estimates') return reply([{ id: 'e1', deal_id: DEAL, title: '', subtotal_cents: 240000, expires_at: RUNS_OUT + 'T17:00:00Z', status: 'sent' }]);
  if (table === 'presence_deals') return reply(u.searchParams.get('id') ? [{ id: DEAL, title: 'Harbor refresh', converted_client_id: null, converted_site_id: C }] : []);
  if (table === 'presence_sites') return reply([{ id: A, client_id: null }, { id: C, client_id: null }]);
  return reply([]);
};
const member = { agency_id: AG, member_id: 'm1', email: 'sam@bright.example', role: 'readonly', agency_name: 'Bright Studio', seat_limit: 5, client_limit: 25, plan: 'agency', branding: {} };
const deps = {
  ownSite: async () => ({ id: STUDIO, client_id: null }),
  needs: async () => ({ rows: [needs[0]], rest: [], snoozed: [] }),
  gather: async () => ({ links: [{ site_id: A, status: 'active' }, { site_id: C, status: 'active' }], clientNames: names }),
};
const req = new Request(`http://stub.local/functions/v1/presence/agency/week?today=${RT}`);
const res = await handleClientTools(req, '/agency/week', 'GET', member, { kind: 'client', userId: 'u1', email: member.email }, {}, deps);
const body = await res.json();
const d = body.data;
ok('route: a view-only seat can plan the week (it only reads)', res.status === 200 && d.today === RT && d.end === W.addDays(RT, 6));
ok('route: Needs you’s invoice row, with its due date from the books', d.clients[0].name === 'Maple & Main Realty' && d.clients[0].items[0].when === 'late' && d.clients[0].items[0].late_days === 6);
ok('route: the estimate joins its client’s card through the deal', d.clients.some((c) => c.name === 'Harbor Dental' && c.items.some((i) => i.key === 'estimate:e1' && i.day === RUNS_OUT)));
ok('route: the plain list rides along, and nothing failed', typeof d.text === 'string' && d.text.includes('Maple & Main Realty') && d.partial === false);
ok('route: estimates and recurring invoices are read only inside the week', reads.includes('presence_estimates') && reads.includes('presence_recurring_invoices'));
const noAccess = await handleClientTools(new Request('http://stub.local/x'), '/agency/week', 'GET', { ...member, role: 'nobody' }, { kind: 'client' }, {}, deps);
ok('route: a role without read is refused', noAccess.status === 403);

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.error('FAILURES'); Deno.exit(1); }
