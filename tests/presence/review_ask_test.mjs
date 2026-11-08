// ── List item 29: ask for a review after a project is done ──────────────────────
//   deno run --allow-read --allow-env tests/presence/review_ask_test.mjs
// The switch's settings, the day a project is due its ask, and the sweep against a
// stubbed database: one email per finished project, the right day, once, never for a
// project reopened since or finished long ago, and nothing at all before migration 0137.
Deno.env.set('RESEND_KEY', 'test-key');
Deno.env.set('SUPABASE_URL', 'https://db.example');
Deno.env.set('SERVICE_ROLE_KEY', 'test-service-key');   // signs the email's unsubscribe link
const { reviewAskDue, automationSettings, AUTOMATION_DEFAULTS, runReviewRequests, reviewAskPeriod } = await import('../../supabase/functions/presence/commerce/lifecycle.ts');

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const DAY = 86400_000, NOW = Date.now(), ago = (d) => new Date(NOW - d * DAY).toISOString();

// ═══ 1. the switch's values ═══
ok('off by default, three days after', AUTOMATION_DEFAULTS.review_requests === false && AUTOMATION_DEFAULTS.review_request_after_days === 3);
ok('a saved row reads through', JSON.stringify(automationSettings({ review_requests: true, review_request_after_days: 5 })).includes('"review_requests":true,"review_request_after_days":5'));
ok('days out of range fall back to three', automationSettings({ review_requests: true, review_request_after_days: 0 }).review_request_after_days === 3 && automationSettings({ review_request_after_days: 400 }).review_request_after_days === 3);
ok('a row from before the switch reads as off', automationSettings({ deal_nudges: true }).review_requests === false);

// ═══ 2. the day ═══
ok('not before its day', !reviewAskDue(ago(2.9), NOW, 3));
ok('on its day', reviewAskDue(ago(3), NOW, 3) && reviewAskDue(ago(10), NOW, 3));
ok('never once two weeks past its day', !reviewAskDue(ago(17.1), NOW, 3));
ok('never without a date', !reviewAskDue('', NOW, 3) && !reviewAskDue('soon', NOW, 3));

// ═══ 3. the sweep, against a stubbed database ═══
const A = 'a0000000-0000-4000-8000-000000000001', B = 'b0000000-0000-4000-8000-000000000002';
const P = (n) => `00000000-0000-4000-8000-00000000000${n}`;
const C1 = 'c1000000-0000-4000-8000-000000000001';
function world({ pre0137 = false, asked = [] } = {}) {
  const w = { emails: [], ledger: [], asks: [] };
  const settings = [{ site_id: A, review_request_after_days: 3 }, { site_id: B, review_request_after_days: 5 }];
  const events = [
    { project_id: P(1), site_id: A, detail: { from: 'active', to: 'complete' }, created_at: ago(4) },    // due
    { project_id: P(2), site_id: A, detail: { from: 'active', to: 'complete' }, created_at: ago(1) },    // not yet
    { project_id: P(3), site_id: A, detail: { from: 'active', to: 'complete' }, created_at: ago(30) },   // long ago
    { project_id: P(4), site_id: B, detail: { from: 'active', to: 'complete' }, created_at: ago(4) },    // site B waits five days
    { project_id: P(5), site_id: A, detail: { from: 'active', to: 'complete' }, created_at: ago(4) },    // reopened since
    { project_id: P(6), site_id: A, detail: { from: 'active', to: 'complete' }, created_at: ago(4) },    // already asked
  ];
  const projects = { [P(1)]: { id: P(1), name: 'New website', status: 'complete', client_id: C1 }, [P(5)]: { id: P(5), name: 'Logo', status: 'active', client_id: C1 }, [P(6)]: { id: P(6), name: 'Photos', status: 'complete', client_id: C1 } };
  const ledger = new Set(asked.map(reviewAskPeriod).concat([reviewAskPeriod(P(6))]));
  const reply = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  globalThis.fetch = (url, init = {}) => {
    const u = decodeURIComponent(String(url)), m = (init.method || 'GET').toUpperCase();
    if (u.startsWith('https://api.resend.com/')) { w.emails.push(JSON.parse(init.body)); return reply({ id: 'e' + w.emails.length }); }
    if (u.includes('/presence_settings?review_requests=is.true')) return pre0137 ? reply({ message: 'column does not exist' }, 400) : reply(settings);
    if (u.includes('/presence_project_events?')) { w.asks.push(u); return reply(events); }
    if (u.includes('/presence_plan_notices?') && m === 'GET') return reply([...ledger].filter((p) => u.includes(`"${p}"`)).map((period) => ({ period })));
    if (u.includes('/presence_plan_notices') && m === 'POST') {
      const row = JSON.parse(init.body); w.ledger.push(row);
      if (ledger.has(row.period)) return reply([]);
      ledger.add(row.period); return reply([{ id: 'n' + w.ledger.length, ...row }], 201);
    }
    if (u.includes('/presence_projects?')) { const id = (u.match(/id=eq\.([0-9a-f-]{36})/) || [])[1]; return reply(projects[id] ? [projects[id]] : []); }
    if (u.includes('/clients?')) return reply([{ email: 'pat@client.example', name: 'Pat' }]);
    if (u.includes('/presence_sites?')) return reply([{ client_id: 'owner-1' }]);
    if (u.includes('/presence_identity?')) return reply([{ business_name: 'Marlow Studio' }]);
    return reply([]);   // brand kit, suppression list and the rest: nothing on file
  };
  return w;
}
{
  const w = world();
  const r = await runReviewRequests(20);
  ok('one finished project is due today, and its client is asked once', r.asked === 1 && w.emails.length === 1, JSON.stringify({ asked: r.asked, emails: w.emails.length }));
  ok('the email is the review request, to the project’s client', w.emails[0]?.to === 'pat@client.example' || (Array.isArray(w.emails[0]?.to) && w.emails[0].to[0] === 'pat@client.example'));
  ok('…with the hand-sent request’s words', String(w.emails[0]?.html || '').includes('Thanks for choosing Marlow Studio. If you have a moment, we’d love a quick review'));
  ok('the ledger row is written for that project only, silently', w.ledger.length === 1 && w.ledger[0].period === reviewAskPeriod(P(1)) && w.ledger[0].status === 'dismissed');
  ok('nothing for a project not yet due, long finished, on a later day for its site, reopened or already asked',
    !w.ledger.some((l) => [2, 3, 4, 5, 6].some((n) => l.period === reviewAskPeriod(P(n)))));
}
{
  const w = world({ asked: [P(1)] });
  const r = await runReviewRequests(20);
  ok('the next day’s sweep asks nobody again', r.asked === 0 && w.emails.length === 0);
}
{
  const w = world({ pre0137: true });
  const r = await runReviewRequests(20);
  ok('before migration 0137 the sweep does nothing at all', r.asked === 0 && w.emails.length === 0 && w.asks.length === 0);
}

const failed = results.filter((r) => !r.p);
console.log(`\n════ REVIEW ASK: ${results.length - failed.length}/${results.length} PASSED ════`);
if (failed.length) { for (const f of failed) console.log(' FAIL: ' + f.n); Deno.exit(1); }
