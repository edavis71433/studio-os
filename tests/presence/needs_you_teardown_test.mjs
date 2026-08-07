// ── "Needs you" teardown — doing the work clears the row ─────────────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/needs_you_teardown_test.mjs
//
// Eric's Today page "Needs you" list only ever GREW: of the ~30 kinds in
// presence_plan_notices only five had a teardown, and all five were
// infrastructure recovery. Every BUSINESS obligation — a support request that
// waited, an unpaid invoice, a sent agreement — had none, so the row survived
// the work that resolved it.
//
// Tier A (this suite's Part A/B/C): doing the work clears the row.
//   1. resolve/close a support request  → the support_aging notice goes
//   2. an invoice is paid (stripe)      → the "Still unpaid" reminder goes
//   3. a doc reminder                   → silent ledger, never a row
//   4. sign/accept/convert/delete       → the deal_followup rows go
//   5. the four client_* kinds          → silent ledger (badge + rows agree)
//
// Part A is pure (no DB, no clock). Parts B/C drive the real handlers through a
// globalThis.fetch PostgREST fake (the support_routing_test idiom) so the CLEAR
// is observed as an actual write with the right (client_id, kind, period) — and,
// just as load-bearing, is observed NOT to happen on the wrong transition.
// Part D pins the surfaces that can only be read (the webhook, the sweeps).
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');

const CLIENT = '22222222-2222-4222-8222-222222222222';
const SITE = { id: '99999999-9999-4999-8999-999999999999', client_id: CLIENT };
const REQ = '33333333-3333-4333-8333-333333333333';
const CORS = {};
const jr = (data, status = 200) => (data === null || status === 204)
  ? new Response(null, { status })
  : new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const realFetch = globalThis.fetch;

// ═══════════════════════════════════════════════════════════════════════════
// PART A — the pure cores
// ═══════════════════════════════════════════════════════════════════════════
const { supportAgingPeriod } = await import('../../supabase/functions/presence/lib/intake.ts');

// A1 — the weekly re-nudge bucket. "Waiting on you" must not be permanently
// muted by one fire: a genuinely stalled request speaks up again next week.
{
  const WEEK = 7 * 86400_000;
  const t0 = Date.parse('2026-07-20T00:00:00Z');
  const p0 = supportAgingPeriod(REQ, t0);
  ok('A1: the aging period is scoped to the request', typeof p0 === 'string' && p0.startsWith(`support:${REQ}:`), String(p0));
  ok('A1: deterministic — same request, same instant, same bucket', supportAgingPeriod(REQ, t0) === p0);
  ok('A1: stable WITHIN a week (nothing re-fires mid-bucket)',
    supportAgingPeriod(REQ, t0 + 60_000) === p0 && supportAgingPeriod(REQ, t0 + 6 * 86400_000) === p0 ||
    // whichever 7-day slot t0 falls in, +1ms and the slot's own start must agree
    supportAgingPeriod(REQ, Math.floor(t0 / WEEK) * WEEK) === supportAgingPeriod(REQ, Math.floor(t0 / WEEK) * WEEK + WEEK - 1));
  {
    const start = Math.floor(t0 / WEEK) * WEEK;
    ok('A1: constant across the whole 7-day slot',
      supportAgingPeriod(REQ, start) === supportAgingPeriod(REQ, start + WEEK - 1));
    ok('A1: CHANGES the instant the 7-day boundary is crossed',
      supportAgingPeriod(REQ, start + WEEK - 1) !== supportAgingPeriod(REQ, start + WEEK));
    ok('A1: the next slot is stable too (a new bucket, not a new period per tick)',
      supportAgingPeriod(REQ, start + WEEK) === supportAgingPeriod(REQ, start + WEEK + 86400_000));
  }
  ok('A1: different requests never share a bucket', supportAgingPeriod('other-id', t0) !== p0);
  ok('A1: a non-finite clock degrades to the un-bucketed key (never NaN in the dedupe key)',
    !/NaN|undefined/.test(supportAgingPeriod(REQ, NaN)));
  ok('A1: every bucket shares the `support:<id>:` prefix the teardown clears',
    [t0, t0 + WEEK, t0 + 9 * WEEK].every((t) => supportAgingPeriod(REQ, t).startsWith(`support:${REQ}:`)));
}

// ═══════════════════════════════════════════════════════════════════════════
// PART B — resolve/close a support request CLEARS its "Waiting on you" row
// ═══════════════════════════════════════════════════════════════════════════
const { handleSupportOne } = await import('../../supabase/functions/presence/routes/service_intake.ts');
const STAFF = { kind: 'staff', userId: 'op-1', email: 'eric@studio.test', jwt: 'jwt' };

function installSupportFetch(reqRow) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init.method || 'GET').toUpperCase();
    let body = null; try { body = init.body ? JSON.parse(init.body) : null; } catch { /* */ }
    calls.push({ url, method, body });
    if (url.includes('presence_support_requests') && method === 'GET') return jr([reqRow]);
    if (url.includes('presence_support_requests') && method === 'PATCH') {
      let patch = {}; try { patch = JSON.parse(init.body); } catch { /* */ }
      return jr([{ ...reqRow, ...patch }]);
    }
    if (url.includes('presence_plan_notices')) return jr([]);
    return jr([]);
  };
  return calls;
}
const patchNotice = (calls) => calls.filter((c) => c.url.includes('presence_plan_notices') && c.method === 'PATCH');
const triage = (patch) => new Request('https://x/functions/v1/presence/support/' + REQ, {
  method: 'PATCH', body: JSON.stringify(patch), headers: { 'content-type': 'application/json' },
});

try {
  const base = { id: REQ, site_id: SITE.id, status: 'open', priority: 'normal', project_id: null, requester: 'jane@acme.com' };

  // B1 — RESOLVE clears, with the right (client_id, kind, period)
  {
    const calls = installSupportFetch(base);
    await handleSupportOne(triage({ status: 'resolved' }), 'jwt', SITE, STAFF, REQ, CORS);
    const p = patchNotice(calls);
    ok('B1: resolving a support request clears its notice (exactly one teardown write)', p.length === 1, `${p.length} writes`);
    ok('B1: the clear is scoped to THIS owner client_id', p[0] && p[0].url.includes(`client_id=eq.${CLIENT}`), p[0]?.url || '');
    ok('B1: the clear is scoped to kind=support_aging', p[0] && p[0].url.includes('kind=eq.support_aging'), p[0]?.url || '');
    ok('B1: the clear targets every weekly bucket of THIS request (period prefix)',
      p[0] && /period=like\./.test(p[0].url) && p[0].url.includes(encodeURIComponent(`support:${REQ}:`)), p[0]?.url || '');
    ok('B1: the clear only touches ACTIVE rows', p[0] && p[0].url.includes('status=eq.active'), p[0]?.url || '');
    ok('B1: the clear dismisses (never deletes) — the ledger survives',
      p[0] && p[0].body && p[0].body.status === 'dismissed', JSON.stringify(p[0]?.body));
  }

  // B2 — CLOSE clears too (Eric: "resolve OR close", not reply)
  {
    const calls = installSupportFetch(base);
    await handleSupportOne(triage({ status: 'closed' }), 'jwt', SITE, STAFF, REQ, CORS);
    ok('B2: CLOSING a support request also clears its notice', patchNotice(calls).length === 1);
  }

  // B3 — the wrong transitions must NOT clear
  {
    const calls = installSupportFetch(base);
    await handleSupportOne(triage({ status: 'in_progress' }), 'jwt', SITE, STAFF, REQ, CORS);
    ok('B3: moving to in_progress does NOT clear (it is still waiting on you)', patchNotice(calls).length === 0);
  }
  {
    const calls = installSupportFetch(base);
    await handleSupportOne(triage({ priority: 'high' }), 'jwt', SITE, STAFF, REQ, CORS);
    ok('B3: a priority change does NOT clear', patchNotice(calls).length === 0);
  }
  {
    const calls = installSupportFetch(base);
    await handleSupportOne(triage({ assigned_to: '44444444-4444-4444-8444-444444444444' }), 'jwt', SITE, STAFF, REQ, CORS);
    ok('B3: an assignment does NOT clear', patchNotice(calls).length === 0);
  }
  {
    // already resolved → re-sending 'resolved' is not a transition; nothing re-fires
    const calls = installSupportFetch({ ...base, status: 'resolved' });
    await handleSupportOne(triage({ status: 'resolved' }), 'jwt', SITE, STAFF, REQ, CORS);
    ok('B3: re-resolving an already-resolved request does NOT re-fire the clear', patchNotice(calls).length === 0);
  }
  {
    // a reopen must never clear — the row should come back, not be torn down
    const calls = installSupportFetch({ ...base, status: 'resolved' });
    await handleSupportOne(triage({ status: 'open' }), 'jwt', SITE, STAFF, REQ, CORS);
    ok('B3: reopening does NOT clear', patchNotice(calls).length === 0);
  }
  {
    // a failed write (conflict) must not clear a notice for work that didn't land
    const calls = [];
    globalThis.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = (init.method || 'GET').toUpperCase();
      calls.push({ url, method, body: null });
      if (url.includes('presence_support_requests') && method === 'GET') return jr([base]);
      if (url.includes('presence_support_requests') && method === 'PATCH') return jr([]);   // lost the race
      return jr([]);
    };
    await handleSupportOne(triage({ status: 'resolved' }), 'jwt', SITE, STAFF, REQ, CORS);
    ok('B3: a LOST optimistic race does NOT clear the notice', patchNotice(calls).length === 0);
  }
} finally { globalThis.fetch = realFetch; }

// ═══════════════════════════════════════════════════════════════════════════
// PART C2 — a pre-dismissed raise still returns created=true (email throttle)
// ═══════════════════════════════════════════════════════════════════════════
const { raiseNotice } = await import('../../supabase/functions/presence/lib/notice.ts');
try {
  {
    const calls = [];
    globalThis.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      let body = null; try { body = init.body ? JSON.parse(init.body) : null; } catch { /* */ }
      calls.push({ url, method: (init.method || 'GET').toUpperCase(), body });
      if (url.includes('presence_plan_notices')) return jr([{ id: 'n-1' }], 201);
      return jr([]);
    };
    const created = await raiseNotice({
      siteId: SITE.id, clientId: CLIENT, kind: 'client_message', period: 'thread:1:0',
      headline: 'A client wrote', body: 'x', status: 'dismissed',
    });
    ok('C5: a PRE-DISMISSED raise still returns created=true on first insert (the email throttle survives)', created === true);
    const ins = calls.filter((c) => c.url.includes('presence_plan_notices') && c.method === 'POST');
    ok('C5: the row is written with status=dismissed (a silent ledger, not a row)',
      ins.length === 1 && ins[0].body && ins[0].body.status === 'dismissed', JSON.stringify(ins[0]?.body));
    ok('C5: a silent ledger row never pushes to the owner’s device',
      !calls.some((c) => /web.?push|fcm|onesignal/i.test(c.url)));
  }
  {
    // second insert (conflict → empty representation) → created=false → no second email
    globalThis.fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('presence_plan_notices')) return jr([], 201);
      return jr([]);
    };
    const created = await raiseNotice({
      siteId: SITE.id, clientId: CLIENT, kind: 'client_message', period: 'thread:1:0',
      headline: 'A client wrote', body: 'x', status: 'dismissed',
    });
    ok('C5: a repeat raise inside the window returns created=false (no email storm)', created === false);
  }
  {
    // the default is unchanged — an ordinary raise is still an ACTIVE row
    const calls = [];
    globalThis.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      let body = null; try { body = init.body ? JSON.parse(init.body) : null; } catch { /* */ }
      calls.push({ url, body });
      if (url.includes('presence_plan_notices')) return jr([], 201);   // conflict → skips the push branch
      return jr([]);
    };
    await raiseNotice({ siteId: SITE.id, clientId: CLIENT, kind: 'support_aging', period: 'p', headline: 'h', body: 'b' });
    const ins = calls.find((c) => c.url.includes('presence_plan_notices'));
    ok('C5: raiseNotice still defaults to an ACTIVE row', ins && ins.body && ins.body.status === 'active');
  }
} finally { globalThis.fetch = realFetch; }

// ═══════════════════════════════════════════════════════════════════════════
// PART D — the remaining Tier A teardowns, at their source
// ═══════════════════════════════════════════════════════════════════════════
const life = read('supabase/functions/presence/commerce/lifecycle.ts');
const hook = read('supabase/functions/stripe-webhook/index.ts');
const sales = read('supabase/functions/presence/routes/sales.ts');
const bridge = read('supabase/functions/presence/lib/service_bridge.ts');
const si = read('supabase/functions/presence/routes/service_intake.ts');

// D1 — the weekly re-nudge is wired into the sweep
ok('D1: runSupportAging raises on the WEEKLY bucket (a stalled request speaks up again)',
  /period: supportAgingPeriod\(/.test(life) && !/period: `support:\$\{r\.id\}`/.test(life));

// D2 — money landing clears "Still unpaid" (the contradiction Eric sees today)
ok('D2: the stripe webhook dismisses the invremind row beside the invoice_paid insert',
  /presence_plan_notices\?[^`'"]*kind=eq\.deal_followup[^`'"]*/.test(hook) && /invremind:/.test(hook) && /status.{0,4}:.{0,3}'dismissed'/.test(hook));
ok('D2: …scoped to the paid invoice and the owning client (never a blanket clear)',
  /invremind:\$\{[^}]*\}/.test(hook) && /client_id=eq\./.test(hook));

// D3 — "Reminder sent" is status, not an ask: a silent ledger like booking_reminder
ok('D3: the sales doc reminder is raised as a silent ledger row (status dismissed)',
  /kind: 'deal_followup', period: `remind:\$\{doc\.id\}`[\s\S]{0,400}?status: 'dismissed'|status: 'dismissed'[\s\S]{0,400}?period: `remind:\$\{doc\.id\}`/.test(life));
ok('D3: …and still gates the send-once email (fresh/created still guards the send)',
  /const fresh = await raiseNotice\(\{[\s\S]{0,400}?period: `remind:\$\{doc\.id\}`[\s\S]{0,300}?\}\);\s*\n\s*if \(!fresh\) continue;/.test(life));

// D4 — signing / accepting / converting / deleting tears the deal rows down
ok('D4: raiseDealReady also clears the document reminder for the doc that just landed',
  /clearNotice\([^)]*'deal_followup', `remind:\$\{/.test(sales));
ok('D4: contract-sign passes the signed document to the teardown', /raiseDealReady\(tok\.site_id, dealId, 'signed', id\)/.test(sales));
ok('D4: proposal-accept passes the accepted document to the teardown', /raiseDealReady\(tok\.site_id, dealId, 'accepted', id\)/.test(sales));
{
  const clears = sales.match(/clearNotice\(site\.client_id, 'deal_followup', `deal:\$\{(?:dealId|id)\}`\)/g) || [];
  ok('D4: convert (both idempotent + fresh paths) and delete clear the deal follow-up row', clears.length >= 3, `${clears.length} sites`);
}
ok('D4: the deal DELETE path clears too', /deleted_at[\s\S]{0,600}?clearNotice\([^)]*'deal_followup', `deal:/.test(sales));

// D5 — the four client_* kinds become the silent throttle key they were documented to be
ok('D5: notifyStudioOfClientAction raises the client_* kinds pre-dismissed (rows and badge finally agree)',
  /raiseNotice\(\{[\s\S]{0,300}?clientId: ownerClientId[\s\S]{0,300}?status: 'dismissed'/.test(bridge));
ok('D5: …and the created flag still gates the email (throttle intact)',
  /const created = await raiseNotice\(\{[\s\S]{0,500}?\}\);\s*\n\s*if \(!created\) return false;/.test(bridge));

// D7 — the support teardown lives on the transition, not the request
ok('D7: service_intake clears on resolve OR close, and only on a real transition',
  /clearedNow[\s\S]{0,200}?'resolved'[\s\S]{0,120}?'closed'/.test(si) && /if \(clearedNow[\s\S]{0,200}?clearNoticePrefix\(/.test(si));

const passed = results.filter(Boolean).length;
console.log(`\n════ NEEDS-YOU TEARDOWN (Tier A): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
