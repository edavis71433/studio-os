// ── Approval per deliverable, with reminders (studio audit Oct 2026, change 8) ──
//   deno run --allow-read --allow-env --allow-net tests/presence/approval_reminders_test.mjs
//
// PART A — the pure rule (lib/approvals.ts): which reminder an approval is owed
//          (day before · daily overdue · once per UTC day · never without a date),
//          the dated copy, the due-date cleaner, the overdue notice period.
// PART B — the route (routes/project_delivery.ts): subject_type 'deliverable' is
//          checked against THIS project, due_date is stored (and degrades before
//          0134), the "Needs your OK" email carries the date; both records return
//          subject_type / subject_id / due_date.
// PART C — the sweep (commerce/lifecycle.runApprovalReminders) driven through a
//          fetch fake: the day-before row and the overdue-yesterday row are
//          emailed, the overdue-reminded-today row and the due-today row are
//          not; the overdue one raises exactly one studio notice; the claim is
//          stamped BEFORE the send with the previous value in the WHERE; a
//          second tick the same day sends nothing.
// PART D — migration 0134 + APPLY pack + registration + the bell's deep link.
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');
Deno.env.set('RESEND_KEY', 'test-resend-key');
Deno.env.set('PLATFORM_REPLY_TO', 'eric@davisdigitalstudio.com');
Deno.env.set('OPS_ALERT_EMAIL', 'ops@davisdigitalstudio.com');

const { approvalReminderDue, approvalReminderCopy, cleanDueDate, dueDateText, daysUntilDue, approvalOverduePeriod, projectIdOfApprovalPeriod, approvalOverdueCopy } =
  await import('../../supabase/functions/presence/lib/approvals.ts');

// ═══ PART A — the pure rule ═══
{
  const NOW = '2026-10-20T15:30:00.000Z';
  const base = { status: 'pending', client_visible: true, last_reminded_at: null };
  ok('A1: due tomorrow → day_before', approvalReminderDue({ ...base, due_date: '2026-10-21' }, NOW) === 'day_before');
  ok('A2: due today → nothing (the day-before went yesterday; overdue starts tomorrow)', approvalReminderDue({ ...base, due_date: '2026-10-20' }, NOW) === null);
  ok('A3: due in two days → nothing yet', approvalReminderDue({ ...base, due_date: '2026-10-22' }, NOW) === null);
  ok('A4: due yesterday → overdue', approvalReminderDue({ ...base, due_date: '2026-10-19' }, NOW) === 'overdue');
  ok('A5: due a month ago → still overdue, every day', approvalReminderDue({ ...base, due_date: '2026-09-15' }, NOW) === 'overdue');
  ok('A6: no due date → never', approvalReminderDue({ ...base, due_date: null }, NOW) === null && approvalReminderDue({ ...base }, NOW) === null);
  ok('A7: already reminded TODAY (UTC) → nothing more today', approvalReminderDue({ ...base, due_date: '2026-10-19', last_reminded_at: '2026-10-20T03:00:00Z' }, NOW) === null);
  ok('A8: reminded YESTERDAY → due again today', approvalReminderDue({ ...base, due_date: '2026-10-19', last_reminded_at: '2026-10-19T23:59:59Z' }, NOW) === 'overdue');
  ok('A9: the day-before is also once: reminded today at 00:01 → not again at 15:30', approvalReminderDue({ ...base, due_date: '2026-10-21', last_reminded_at: '2026-10-20T00:01:00Z' }, NOW) === null);
  ok('A10: decided (approved / changes_requested / superseded) → never', ['approved', 'changes_requested', 'rejected', 'superseded'].every((st) => approvalReminderDue({ ...base, status: st, due_date: '2026-10-19' }, NOW) === null));
  ok('A11: internal (client_visible=false) → never reaches the client', approvalReminderDue({ ...base, client_visible: false, due_date: '2026-10-19' }, NOW) === null);
  ok('A12: a garbage due date → nothing (no NaN days)', approvalReminderDue({ ...base, due_date: 'soon' }, NOW) === null && daysUntilDue('soon', NOW) === null);
  ok('A13: daysUntilDue counts whole UTC days (+1 / 0 / -1)', daysUntilDue('2026-10-21', NOW) === 1 && daysUntilDue('2026-10-20', NOW) === 0 && daysUntilDue('2026-10-19', NOW) === -1);
  ok('A14: cleanDueDate accepts YYYY-MM-DD only, refuses Feb 30 / prose / empty', cleanDueDate('2026-10-30') === '2026-10-30' && cleanDueDate('2026-02-30') === null && cleanDueDate('tomorrow') === null && cleanDueDate('') === null && cleanDueDate(undefined) === null);
  ok('A15: cleanDueDate tolerates a timestamp by taking its date part', cleanDueDate('2026-10-30T00:00:00Z') === '2026-10-30');
  ok('A16: dueDateText reads as a calm long date (UTC, no off-by-one)', dueDateText('2026-10-30') === 'October 30, 2026' && dueDateText('2026-01-01') === 'January 1, 2026');
  const db = approvalReminderCopy('Homepage mockup', '2026-10-21', 'day_before');
  const od = approvalReminderCopy('Homepage mockup', '2026-10-19', 'overdue');
  ok('A17: the subject is "A reminder — {title} is waiting for your OK"', db.subject === 'A reminder — Homepage mockup is waiting for your OK' && od.subject === db.subject);
  ok('A18: the day-before body names the date and says it is tomorrow', /October 21, 2026/.test(db.html) && /tomorrow/.test(db.html) && /Homepage mockup/.test(db.html));
  ok('A19: the overdue body names the date and says it is still waiting', /was due <strong>October 19, 2026/.test(od.html) && /still waiting/.test(od.html));
  ok('A20: both bodies promise nothing moves without them', /Nothing goes ahead without you/.test(db.html) && /Nothing goes ahead without you/.test(od.html));
  ok('A21: a title with markup is escaped in the mail', /&lt;b&gt;/.test(approvalReminderCopy('<b>x</b>', '2026-10-19', 'overdue').html));
  ok('A22: an empty title still reads as a sentence', /something your studio shared/.test(approvalReminderCopy('', '2026-10-19', 'overdue').html));
  const P = '11111111-1111-4111-8111-111111111111', A = '22222222-2222-4222-8222-222222222222';
  ok('A23: the overdue notice period names project AND approval; the bell can read the project back', approvalOverduePeriod(P, A) === `approval:${P}:${A}` && projectIdOfApprovalPeriod(approvalOverduePeriod(P, A)) === P && projectIdOfApprovalPeriod('lead:x') === null && projectIdOfApprovalPeriod(null) === null);
  const n = approvalOverdueCopy('Homepage mockup', '2026-10-19');
  ok('A24: the studio notice says who is late, the date, and that the client is being reminded', /Still waiting on the client — Homepage mockup/.test(n.headline) && /October 19, 2026/.test(n.body) && /reminded/.test(n.body));
}

// ═══ PART B — the route + the reads ═══
{
  const pd = read('supabase/functions/presence/routes/project_delivery.ts');
  const pj = read('supabase/functions/presence/routes/projects.ts');
  const cd = read('supabase/functions/presence/routes/client_delivery.ts');
  ok('B1: a deliverable subject is looked up with project_id=eq.${projectId} (a file from another project is refused)', /presence_deliverables\?id=eq\.\$\{subjectId\}&project_id=eq\.\$\{projectId\}&site_id=eq\.\$\{siteId\}/.test(pd));
  ok('B2: subjectVersion is handed the project id', /subjectVersion\(site\.id, projectId, b\.subject_type/.test(pd));
  ok('B3: a deliverable approval defaults its title to the file\'s', /const title = clean\(b\.title, 200\) \|\| ver\.title/.test(pd));
  ok('B4: due_date is cleaned (cleanDueDate) and a bad one is refused with 422', /cleanDueDate\(b\.due_date\)/.test(pd) && /The due date needs to be a real date/.test(pd));
  ok('B5: due_date is written on the approval row only when given', /if \(dueDate\) row\.due_date = dueDate;/.test(pd));
  ok('B6: pre-0134 degrade — a 400 naming due_date retries the insert without it', /ins\.status === 400 && \/due_date\/\.test\(ins\.text/.test(pd) && /delete row\.due_date;/.test(pd));
  ok('B7: the prior PENDING approval on the same subject is still superseded', /status=eq\.pending`, \{ method: 'PATCH'[\s\S]{0,40}status: 'superseded'/.test(pd));
  ok('B8: the "Needs your OK — {title}" email carries the due date when set', /`Needs your OK — \$\{title\}`/.test(pd) && /They’d like your answer by <strong>\$\{dueDateText\(String\(a\.due_date\)\)\}<\/strong>/.test(pd) && /\$\{when\}<p>Nothing goes ahead without you/.test(pd));
  ok('B9: the ONE approvals read (loadApprovals) selects due_date and retries without it', /export async function loadApprovals/.test(pj) && /select=\$\{cols\},due_date`\);\s*if \(withDue\.ok\) return rows\(withDue\);/.test(pj) && /select=\$\{cols\}`\)\);/.test(pj));
  ok('B10: GET /projects/:id returns subject_type, subject_id (+ due_date) via loadApprovals', /loadApprovals\(`project_id=eq\.\$\{id\}&site_id=eq\.\$\{site\.id\}[^`]*`, 'id,subject_type,subject_id,title/.test(pj));
  ok('B11: GET /client/projects/:id returns subject_type, subject_id (+ due_date) via loadApprovals', /loadApprovals\(`project_id=eq\.\$\{id\}&site_id=eq\.\$\{s\}&deleted_at=is\.null&client_visible=is\.true[^`]*`, 'id,subject_type,subject_id,title/.test(cd));
  ok('B12: the client decide route is untouched (status=pending AND content_hash guard)', /status=eq\.pending&content_hash=eq\.\$\{a\.content_hash\}/.test(cd));
  ok('B13: a decision from EITHER side clears the studio\'s approval_overdue row (exact per-approval key)', /clearApprovalOverdue\(site\.id, a\.project_id, id\)/.test(pd) && /clearApprovalOverdue\(s, a\.project_id, id\)/.test(cd) && /clearNotice\(clientId, 'approval_overdue', approvalOverduePeriod\(projectId, approvalId\)\)/.test(pj));
}

// ═══ PART C — the sweep through a fetch fake ═══
const realFetch = globalThis.fetch;
const jr = (data, status = 200) => new Response(data === null ? '' : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const SITE = '99999999-9999-4999-8999-999999999999';
const CLIENT = '22222222-2222-4222-8222-222222222222';
const PROJ = '33333333-3333-4333-8333-333333333333';
const CUST = '44444444-4444-4444-8444-444444444444';
const dayOff = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const todayAt = (h) => `${dayOff(0)}T${String(h).padStart(2, '0')}:00:00.000Z`;
const yesterdayAt = (h) => `${dayOff(-1)}T${String(h).padStart(2, '0')}:00:00.000Z`;

function installFake(rows) {
  const calls = [], sent = [], notices = [], claims = [];
  const held = new Set();
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init.method || 'GET').toUpperCase();
    let body = null; try { body = init.body ? JSON.parse(init.body) : null; } catch { /* */ }
    calls.push({ url, method, body });
    if (url.includes('api.resend.com/emails')) { sent.push(body); return jr({ id: 're_1' }, 200); }
    if (url.includes('suppressed_emails') || url.includes('email_suppress')) return jr([]);
    if (url.includes('presence_approvals') && method === 'GET') {
      // the sweep's filter: pending · client-visible · dated · due by tomorrow
      const tomorrow = dayOff(1);
      return jr(rows.filter((r) => r.status === 'pending' && r.client_visible === true && r.due_date && r.due_date <= tomorrow));
    }
    if (url.includes('presence_approvals') && method === 'PATCH') {
      const id = (url.match(/id=eq\.([0-9a-f-]{36})/) || [])[1];
      const prev = (url.match(/last_reminded_at=([^&]+)/) || [])[1] || '';
      const row = rows.find((r) => r.id === id);
      claims.push({ id, prev, body });
      // the guard as PostgREST would apply it: the WHERE must match the CURRENT value
      const matches = row && row.status === 'pending' && (prev === 'is.null' ? row.last_reminded_at == null : decodeURIComponent(prev.replace(/^eq\./, '')) === row.last_reminded_at);
      if (!matches) return jr([], 200);
      row.last_reminded_at = body.last_reminded_at;
      return jr([{ id }], 200);
    }
    if (url.includes('presence_service_links')) return jr([{ customer_client_id: CUST }]);
    if (url.includes('clients?id=eq.')) return jr([{ email: 'client@biz.test', name: 'Biz' }]);
    if (url.includes('presence_plan_notices') && method === 'POST') {
      const key = `${body?.kind}|${body?.period}`;
      notices.push(body);
      if (held.has(key)) return jr([], 201);
      held.add(key);
      return jr([{ id: `n_${held.size}` }], 201);
    }
    if (url.includes('presence_plan_notices')) return jr([]);
    if (url.includes('presence_sites')) return jr([{ id: SITE, client_id: CLIENT }]);
    if (url.includes('presence_identity')) return jr([{ business_name: 'Studio', email: 'studio@biz.test' }]);
    if (url.includes('presence_settings') || url.includes('presence_brand_kits') || url.includes('presence_push_subscriptions')) return jr([]);
    return jr([]);
  };
  return { calls, sent, notices, claims };
}
const restore = () => { globalThis.fetch = realFetch; };

{
  const { runApprovalReminders } = await import('../../supabase/functions/presence/commerce/lifecycle.ts');
  const ap = (id, due, last, extra = {}) => ({ id, site_id: SITE, project_id: PROJ, title: `File ${id.slice(0, 1)}`, due_date: due, last_reminded_at: last, status: 'pending', client_visible: true, ...extra });
  const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';   // due tomorrow, never reminded → day-before mail
  const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';   // overdue, reminded TODAY → nothing
  const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';   // overdue, reminded YESTERDAY → mail + ONE studio notice
  const D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';   // due today → nothing
  const E = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';   // no due date → never (the filter never returns it either)
  const F = 'ffffffff-ffff-4fff-8fff-ffffffffffff';   // overdue but internal → never reaches the client
  const rows = [ap(A, dayOff(1), null), ap(B, dayOff(-3), todayAt(2)), ap(C, dayOff(-2), yesterdayAt(22)), ap(D, dayOff(0), null), ap(E, null, null), ap(F, dayOff(-1), null, { client_visible: false })];
  const fake = installFake(rows);
  const r1 = await runApprovalReminders(50);
  ok('C1: first tick → two reminders (A day-before, C overdue), one overdue notice', r1.reminded === 2 && r1.overdue_notices === 1, JSON.stringify(r1));
  ok('C2: exactly two emails went out, both with the reminder subject', fake.sent.length === 2 && fake.sent.every((m) => /^A reminder — File [ac] is waiting for your OK$/.test(m.subject)), fake.sent.map((m) => m.subject).join(' | '));
  ok('C3: the day-before mail names tomorrow\'s date; the overdue mail says still waiting', (() => { const a = fake.sent.find((m) => m.subject.includes('File a')); const c = fake.sent.find((m) => m.subject.includes('File c')); return a && c && /tomorrow/.test(a.html) && /still waiting/.test(c.html); })());
  ok('C4: the reminder mail goes to the BRIDGED customer (presence_service_links → clients.email)', fake.sent.every((m) => (Array.isArray(m.to) ? m.to : [m.to]).includes('client@biz.test')));
  ok('C5: B (reminded today), D (due today), E (undated), F (internal) were neither claimed nor mailed', !fake.claims.some((c) => [B, D, E, F].includes(c.id)) && !fake.sent.some((m) => /File [bdef]/.test(m.subject)));
  ok('C6: the claim is stamped BEFORE the send, with the previous value in the WHERE (is.null for A, the old stamp for C)', (() => { const a = fake.claims.find((c) => c.id === A); const c = fake.claims.find((c) => c.id === C); const firstClaim = fake.calls.findIndex((x) => x.url.includes('presence_approvals') && x.method === 'PATCH'); const firstMail = fake.calls.findIndex((x) => x.url.includes('api.resend.com')); return a && a.prev === 'is.null' && c && decodeURIComponent(c.prev.replace(/^eq\./, '')) === yesterdayAt(22) && firstClaim < firstMail; })());
  ok('C7: ONE studio notice: kind approval_overdue, period approval:<project>:<C>, active + dismissible wording', fake.notices.length === 1 && fake.notices[0].kind === 'approval_overdue' && fake.notices[0].period === `approval:${PROJ}:${C}` && fake.notices[0].client_id === CLIENT && fake.notices[0].status === 'active' && /Still waiting on the client/.test(fake.notices[0].headline));
  ok('C8: the day-before approval raised NO studio notice (only overdue does)', !fake.notices.some((n) => n.period.endsWith(A)));
  // the second tick, same day: the stamps are set → nothing more
  const before = fake.sent.length;
  const r2 = await runApprovalReminders(50);
  ok('C9: a second tick the same day sends nothing and raises nothing (once per day)', r2.reminded === 0 && r2.overdue_notices === 0 && fake.sent.length === before, JSON.stringify(r2));
  // tomorrow: C is still overdue → reminded again; the notice is NOT re-raised (send-once key held)
  rows.find((x) => x.id === C).last_reminded_at = yesterdayAt(12);
  const r3 = await runApprovalReminders(50);
  ok('C10: the next day C is reminded again, and the studio is NOT told twice', r3.reminded === 1 && r3.overdue_notices === 0 && fake.notices.filter((n) => n.period.endsWith(C)).length === 2, JSON.stringify(r3));
  // a parallel tick that lost the race: the WHERE no longer matches → no send
  rows.find((x) => x.id === C).last_reminded_at = yesterdayAt(12);
  const stolen = installFake(rows);
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('presence_approvals') && (init.method || 'GET') === 'GET') { const r = await origFetch(input, init); rows.find((x) => x.id === C).last_reminded_at = todayAt(1); return r; }   // another tick stamps it between the read and the claim
    return origFetch(input, init);
  };
  const r4 = await runApprovalReminders(50);
  ok('C11: a tick that loses the claim race sends nothing (the WHERE guards the stamp)', r4.reminded === 0 && stolen.sent.length === 0, JSON.stringify(r4));
  // pre-0134: the filter 400s on the unknown column → clean no-op, no throw
  globalThis.fetch = async (input) => { const url = typeof input === 'string' ? input : input.url; return url.includes('presence_approvals') ? jr({ code: '42703', message: 'column presence_approvals.due_date does not exist' }, 400) : jr([]); };
  const r5 = await runApprovalReminders(50);
  ok('C12: before migration 0134 the sweep is a clean no-op (400 on the column → zeros, no throw)', r5.reminded === 0 && r5.overdue_notices === 0);
  restore();
}

// ═══ PART D — migration, pack, registration, the bell ═══
{
  const mig = read('supabase/migrations/0134_approval_due_date_reminders.sql');
  const pack = read('docs/presence/APPLY-0134-prod.sql');
  const lc = read('supabase/functions/presence/commerce/lifecycle.ts');
  const sys = read('supabase/functions/presence/routes/system.ts');
  const ws = read('supabase/functions/presence/routes/workspace.ts');
  const prev = read('supabase/migrations/0133_actor_kind_operator.sql');
  ok('D1: 0134 adds due_date (date) + last_reminded_at (timestamptz), idempotently', /add column if not exists due_date date;/.test(mig) && /add column if not exists last_reminded_at timestamptz;/.test(mig));
  ok('D2: 0134 widens the notice-kind CHECK with approval_overdue and carries the 0133 list forward', /'approval_overdue'/.test(mig) && /'studio_published'/.test(mig) && (() => { const kinds = (s) => (s.match(/check \(kind in \(([\s\S]*?)\)\);/) || ['', ''])[1].match(/'([a-z_]+)'/g) || []; const old = kinds(prev); const now = new Set(kinds(mig)); return old.length > 30 && old.every((k) => now.has(k)); })());
  ok('D3: 0134 opens with a rollback note and touches no RLS', /^-- rollback:/.test(mig) && !/row level security|create policy|grant /i.test(mig));
  ok('D4: 0134 indexes the sweep\'s read (pending · client-visible · dated)', /create index if not exists presence_approvals_due_idx/.test(mig) && /status = 'pending' and client_visible = true and due_date is not null/.test(mig));
  ok('D5: APPLY-0134 carries the same columns, index and CHECK, plus verify queries', /add column if not exists due_date date/.test(pack) && /add column if not exists last_reminded_at timestamptz/.test(pack) && /presence_approvals_due_idx/.test(pack) && /'approval_overdue'/.test(pack) && /'studio_published'/.test(pack) && /-- Verify/.test(pack));
  ok('D6: runApprovalReminders exists, reads only dated pending client-visible approvals due by tomorrow', /export async function runApprovalReminders/.test(lc) && /presence_approvals\?status=eq\.pending&client_visible=is\.true&deleted_at=is\.null&due_date=not\.is\.null&due_date=lte\./.test(lc));
  ok('D7: the sweep decides with the pure rule and claims with the previous stamp in the WHERE', /approvalReminderDue\(a, nowIso\)/.test(lc) && /last_reminded_at=\$\{prev\}&select=id`/.test(lc) && /last_reminded_at: nowIso/.test(lc));
  ok('D8: the client mail goes through emailBridgedCustomer; the studio notice is approval_overdue', /emailBridgedCustomer\(a\.site_id, a\.project_id, copy\.subject, copy\.html\)/.test(lc) && /kind: 'approval_overdue', period: approvalOverduePeriod\(a\.project_id, a\.id\)/.test(lc));
  ok('D9: registered in BOTH tick modes (split revenue group + the default chain)', /\['approval_reminders', \(\) => runApprovalReminders\(50\)\]/.test(sys) && /step\('approval_reminders', \(\) => runApprovalReminders\(50\)\)/.test(sys));
  ok('D10: the bell maps approval_overdue to the project record (deep link by period)', /approval_overdue: '\/projects\.html'/.test(ws) && /projectIdOfApprovalPeriod\(n\.period\)/.test(ws) && /\?project=\$\{project\}/.test(ws));
}

const passed = results.filter(Boolean).length;
console.log(`\n════ APPROVAL PER DELIVERABLE + REMINDERS (audit change 8): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
