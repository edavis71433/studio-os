// ── "The studio must never be silent" — the money/feed/dunning/reminder set ──
//   deno run --allow-read --allow-env --allow-net tests/presence/never_silent_test.mjs
//
// Four confirmed silences, each pinned behaviorally here:
//   A · the invoice-paid echo tells the TRUTH in its body (notice/already/
//       failed), the operator email is convert-aware, and the CLIENT finally
//       gets the receipt payment-success.html has always promised — send-once,
//       and only when their address is actually resolvable (loud warn if not).
//   B · clientEvent (routes/client_delivery.ts) — the write that IS the
//       Inbox/bell feed — checks .ok, retries once, and warns loudly when both
//       attempts fail. It still never throws into the client's request.
//   C · retainer dunning — a care-plan payment failing (past_due) or ending
//       (canceled) raises a notice + emails the operator exactly once per
//       transition per week; recovery clears; a webhook replay is silent;
//       pre-0127 (CHECK rejects the kind) degrades to a clean no-op.
//   D · deal to-dos + next-step dates — the dates the owner set finally remind.
const ROOT = new URL('../../', import.meta.url);
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const AGENCY = '11111111-1111-4111-8111-111111111111';
const OWNER_CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJECT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DEAL = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const INVOICE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const TASK = '77777777-7777-4777-8777-777777777777';
const SECRET = 'test-commerce-secret';
Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');
Deno.env.set('RESEND_KEY', 'test-resend-key');
Deno.env.set('PLATFORM_REPLY_TO', 'eric@davisdigitalstudio.com');
Deno.env.set('OPS_ALERT_EMAIL', 'ops@davisdigitalstudio.com');
Deno.env.set('AGENCY_SITE_ID', AGENCY);
Deno.env.set('BILLING_SYNC_SECRET', SECRET);
Deno.env.set('SITE_URL', 'https://davisdigitalstudio.com');

const { handleCommerce } = await import('../../supabase/functions/presence/routes/commerce.ts');
const { clientEvent } = await import('../../supabase/functions/presence/routes/client_delivery.ts');
const { applyRetainerSync, retainerTransition, retainerNoticeCopy } = await import('../../supabase/functions/presence/commerce/retainers.ts');
const { runDealTaskReminders, dealTaskDue, nextStepOverdue } = await import('../../supabase/functions/presence/commerce/lifecycle.ts');

const realFetch = globalThis.fetch;
const jr = (data, status = 200) => new Response(data === null ? '' : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

/** cfg:
 *   noticeCreated false → the unique key already existed ('exists')
 *   noticeStatus  400   → the CHECK rejects the insert ('failed' / pre-migration)
 *   contactEmail  ''    → no client address resolvable (no receipt, warn)
 *   converted     true  → the deal already has converted_client_id
 *   retainer      {...} → the deal's stored retainer state
 *   projectEventFails n → first n presence_project_events POSTs return 500
 *   dealTasks / nextStepDeals → rows for the reminder sweep
 */
function installFake(cfg = {}) {
  const calls = [];
  const sent = [];
  let eventFails = cfg.projectEventFails || 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init.method || 'GET').toUpperCase();
    let body = null; try { body = init.body ? JSON.parse(init.body) : null; } catch { /* */ }
    calls.push({ url, method, body });
    if (url.includes('api.resend.com/emails')) { sent.push(body); return jr({ id: 're_1' }, 200); }
    if (url.includes('suppressed_emails')) return jr([]);
    if (url.includes('/rpc/rate_hit')) return jr(true);
    if (url.includes('presence_plan_notices') && method === 'POST') {
      if (cfg.noticeStatus) return jr({ message: 'check constraint' }, cfg.noticeStatus);
      return jr(cfg.noticeCreated === false ? [] : [{ id: 'notice_1' }], 201);
    }
    if (url.includes('presence_plan_notices') && method === 'PATCH') return jr(null, 204);
    if (url.includes('presence_project_events') && method === 'POST') {
      if (eventFails > 0) { eventFails--; return jr({ message: 'boom' }, 500); }
      return jr(null, 201);
    }
    if (url.includes('presence_invoices')) return jr([{ id: INVOICE, site_id: AGENCY, deal_id: DEAL, title: 'Deposit', amount_cents: 50000, purpose: 'deposit' }]);
    if (url.includes('presence_deal_tasks')) return jr(cfg.dealTasks || []);
    if (url.includes('presence_deals') && url.includes('next_step_at=not.is.null')) return jr(cfg.nextStepDeals || []);
    if (url.includes('presence_deals') && url.includes('retainer-%3E%3Estripe_subscription_id') || url.includes('retainer->>stripe_subscription_id')) {
      return jr(cfg.retainer ? [{ id: DEAL, site_id: AGENCY }] : []);
    }
    if (url.includes('presence_deals')) {
      return jr([{ id: DEAL, site_id: AGENCY, title: 'Bacchus website', stage: 'proposal', contact_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', converted_client_id: cfg.converted ? OWNER_CLIENT : null, retainer: cfg.retainer || null }]);
    }
    if (url.includes('presence_contacts')) return jr([{ name: 'Claud Beltran', email: cfg.contactEmail === undefined ? 'claud@client.test' : cfg.contactEmail }]);
    if (url.includes('presence_sites')) return jr([{ id: AGENCY, client_id: OWNER_CLIENT }]);
    if (url.includes('presence_identity')) return jr([{ business_name: 'Davis Digital Studio', email: 'studio@davisdigitalstudio.com' }]);
    if (url.includes(`clients?id=eq.${OWNER_CLIENT}`)) return jr([{ id: OWNER_CLIENT, name: 'Davis Digital Studio', email: 'eric@davisdigitalstudio.com', contact_email: '' }]);
    if (url.includes('presence_brand_kits') || url.includes('brand_kit')) return jr([]);
    if (url.includes('presence_tasks')) return jr([{ id: 'task_1', title: 'Deposit paid', client_visible: false }]);
    if (url.includes('presence_push_subscriptions')) return jr([]);
    return jr([]);
  };
  return { calls, sent };
}
const restore = () => { globalThis.fetch = realFetch; };
// the operator emails are deliberately fire-and-forget at the call sites
// (`emailOperator(...).catch(() => {})`) — give the chain a few turns to land
// before asserting on `sent`.
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5)); };

let warned = [];
const realWarn = console.warn;
const captureWarn = () => { warned = []; console.warn = (...a) => { warned.push(a.join(' ')); }; };
const releaseWarn = () => { console.warn = realWarn; };

const echoReq = () => new Request('https://x/commerce/invoice-paid', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-commerce-secret': SECRET },
  body: JSON.stringify({ invoice_id: INVOICE }),
});
const PRINCIPAL = { kind: 'public', userId: null, tenantId: null, role: null, email: null, jwt: null, requestId: 't' };
const echo = () => handleCommerce(echoReq(), '/commerce/invoice-paid', 'POST', PRINCIPAL, {});

try {
  // ═══════════ A · the echo's honest body + receipt + convert-aware copy ═════
  {
    const { sent } = installFake();
    const out = await (await echo()).json();
    ok('A1: a fresh echo answers notice:true, already:false', out.data?.notice === true && out.data?.already === false);
    const receipt = sent.find((s) => s?.to === 'claud@client.test');
    ok('A1: the CLIENT gets the promised receipt (branded thank-you with the amount and what it was for)',
      out.data?.receipted === true && !!receipt && /\$500\.00/.test(String(receipt?.html || '')) && /Deposit/.test(String(receipt?.html || '')));
    ok('A1: the receipt says the studio has been notified (the payment-success promise, kept)',
      /studio has been notified/i.test(String(receipt?.html || '')));
    const operator = sent.find((s) => s?.to === 'studio@davisdigitalstudio.com');
    ok('A1: the operator email is CONVERT-AWARE — an unconverted deal says "convert them now"',
      /signed and paid — convert them now/i.test(String(operator?.html || '')) && /pipeline\.html\?deal=/.test(String(operator?.html || '')));
    restore();
  }
  {
    const { sent } = installFake({ converted: true });
    await echo();
    const operator = sent.find((s) => s?.to === 'studio@davisdigitalstudio.com');
    ok('A2: an already-converted deal does NOT nag about converting', !!operator && !/convert them now/i.test(String(operator?.html || '')));
    restore();
  }
  {
    const { sent } = installFake({ noticeCreated: false });
    const out = await (await echo()).json();
    ok('A3: a retry answers notice:false, already:TRUE (the operator was told before) and re-sends nothing',
      out.data?.notice === false && out.data?.already === true && sent.length === 0);
    restore();
  }
  {
    const { sent } = installFake({ noticeStatus: 400 });
    const out = await (await echo()).json();
    ok('A4: a FAILED insert answers notice:false, already:false — the hollow 200 the webhook floor keys on',
      out.data?.notice === false && out.data?.already === false && sent.length === 0);
    restore();
  }
  {
    const { sent } = installFake({ contactEmail: '' });
    captureWarn();
    const out = await (await echo()).json();
    releaseWarn();
    ok('A5: no resolvable client email → NO receipt, receipted:false, and a LOUD warn naming the invoice',
      out.data?.receipted === false && !sent.some((s) => s?.to && s.to !== 'studio@davisdigitalstudio.com') &&
      warned.some((w) => w.includes('[invoice-paid]') && w.includes(INVOICE)),
      JSON.stringify(warned));
    ok('A5: …while the operator email still goes out (their silence and the client’s are separate failures)',
      sent.some((s) => s?.to === 'studio@davisdigitalstudio.com'));
    restore();
  }

  // ═══════════ B · clientEvent — the Inbox feed write, checked + retried ═════
  {
    const { calls } = installFake({ projectEventFails: 1 });
    captureWarn();
    await clientEvent(AGENCY, PROJECT, 'client_upload', PRINCIPAL, { title: 'logo.png' });
    releaseWarn();
    const posts = calls.filter((c) => c.url.includes('presence_project_events') && c.method === 'POST');
    ok('B1: a transient failure is RETRIED once — the feed row lands on attempt two, no warn',
      posts.length === 2 && warned.length === 0, `${posts.length} posts, warns: ${JSON.stringify(warned)}`);
    restore();
  }
  {
    const { calls } = installFake({ projectEventFails: 2 });
    captureWarn();
    let threw = false;
    try { await clientEvent(AGENCY, PROJECT, 'message', PRINCIPAL, {}); } catch { threw = true; }
    releaseWarn();
    const posts = calls.filter((c) => c.url.includes('presence_project_events') && c.method === 'POST');
    ok('B2: both attempts failing WARNS LOUDLY with what was lost — and never throws into the client’s request',
      !threw && posts.length === 2 && warned.some((w) => w.includes('[client-event] LOST') && w.includes('message') && w.includes(PROJECT)),
      JSON.stringify(warned));
    ok('B2: the feed row still stamps detail.from=client (the studio’s own actions must never ring its bell)',
      posts.every((c) => c.body?.detail?.from === 'client' && c.body?.client_visible === true));
    restore();
  }

  // ═══════════ C · retainer dunning — the transition, made audible ═══════════
  // pure core first
  ok('C0: active→past_due is a transition; a replay (past_due→past_due) is not',
    retainerTransition('active', 'past_due') === 'past_due' && retainerTransition('past_due', 'past_due') === null);
  ok('C0: past_due→active is a recovery; active→active is nothing',
    retainerTransition('past_due', 'active') === 'recovered' && retainerTransition('active', 'active') === null);
  ok('C0: anything→canceled always speaks (an ended retainer is never silent)',
    retainerTransition('active', 'canceled') === 'canceled' && retainerTransition('past_due', 'canceled') === 'canceled');
  ok('C0: pending→active (first authorization) is calm — good news is the deal drawer’s job',
    retainerTransition('pending', 'active') === null);
  {
    const c = retainerNoticeCopy('past_due', 'Bacchus care plan', 45000, 'month');
    ok('C0: the past_due copy names the client, the amount, and what to do (plain voice, no jargon)',
      /Bacchus care plan/.test(c.subject) && /\$450\.00\/month/.test(c.body) && /card/i.test(c.body) && /Stripe/i.test(c.html));
    const k = retainerNoticeCopy('canceled', '', 120000, 'year');
    ok('C0: the canceled copy degrades gracefully with no title and says it won’t bill again',
      /a retainer client/.test(k.subject) && /\$1,200\.00\/year/.test(k.body) && /won’t bill again/.test(k.body));
  }
  const retainerEvent = (type, status) => applyRetainerSync(type, {
    object: 'subscription', id: 'sub_1', status,
    metadata: { purpose: 'service_retainer', deal_id: DEAL, site_id: AGENCY },
  });
  {
    const { calls, sent } = installFake({ retainer: { status: 'active', amount_cents: 45000, interval: 'month', stripe_subscription_id: 'sub_1' } });
    const r = await retainerEvent('customer.subscription.updated', 'past_due');
    await settle();
    const notice = calls.find((c) => c.method === 'POST' && c.url.includes('presence_plan_notices'));
    ok('C1: active→past_due raises retainer_status on the week-bucketed per-deal key',
      r.synced === true && notice?.body?.kind === 'retainer_status' && new RegExp(`^retainer:${DEAL}:past_due:w\\d+$`).test(String(notice?.body?.period)),
      String(notice?.body?.period));
    ok('C1: …and EMAILS the operator once (send-once rides the notice’s created flag)',
      sent.length === 1 && sent[0]?.to === 'studio@davisdigitalstudio.com' && /retainer payment didn’t go through/i.test(String(sent[0]?.subject)));
    ok('C1: the email’s CTA is the Stripe subscription (where the fix lives)',
      /dashboard\.stripe\.com\/subscriptions\/sub_1/.test(String(sent[0]?.html || '')));
    restore();
  }
  {
    const { calls, sent } = installFake({ retainer: { status: 'past_due', amount_cents: 45000, interval: 'month', stripe_subscription_id: 'sub_1' } });
    await retainerEvent('customer.subscription.updated', 'past_due');
    await settle();
    ok('C2: a webhook replay on the SAME status raises nothing and re-emails nothing (no transition)',
      !calls.some((c) => c.method === 'POST' && c.url.includes('presence_plan_notices')) && sent.length === 0);
    restore();
  }
  {
    const { calls, sent } = installFake({ retainer: { status: 'past_due', amount_cents: 45000, interval: 'month', stripe_subscription_id: 'sub_1' } });
    await applyRetainerSync('invoice.payment_succeeded', { object: 'invoice', subscription: 'sub_1', metadata: { purpose: 'service_retainer', deal_id: DEAL, site_id: AGENCY }, amount_paid: 45000 });
    await settle();
    const clear = calls.find((c) => c.method === 'PATCH' && c.url.includes('kind=eq.retainer_status') && /period=like\./.test(c.url));
    ok('C3: recovery (past_due→active) CLEARS every retainer_status bucket by prefix — the bell tells the truth',
      !!clear && sent.length === 0, calls.filter((c) => c.method === 'PATCH').map((c) => c.url).join('\n'));
    restore();
  }
  {
    const { calls, sent } = installFake({ retainer: { status: 'active', amount_cents: 45000, interval: 'month', stripe_subscription_id: 'sub_1' } });
    await retainerEvent('customer.subscription.deleted', 'canceled');
    await settle();
    const notice = calls.find((c) => c.method === 'POST' && c.url.includes('presence_plan_notices'));
    ok('C4: cancellation raises + emails too (an ended care plan is never silent)',
      String(notice?.body?.period || '').includes(':canceled:') && sent.length === 1 && /retainer ended/i.test(String(sent[0]?.subject)));
    restore();
  }
  {
    // PRE-0127: the CHECK rejects the kind → no email, no throw, sync still lands.
    const { sent } = installFake({ retainer: { status: 'active', amount_cents: 45000, interval: 'month', stripe_subscription_id: 'sub_1' }, noticeStatus: 400 });
    let r = null, threw = false;
    const realErr = console.error; console.error = () => {};
    try { r = await retainerEvent('customer.subscription.updated', 'past_due'); } catch { threw = true; }
    await settle();
    console.error = realErr;
    ok('C5: pre-migration (kind CHECK rejects) → dormant, not broken: synced, no email, no throw',
      !threw && r?.synced === true && sent.length === 0);
    restore();
  }

  // ═══════════ D · deal to-dos + next-step dates finally remind ══════════════
  {
    const today = new Date().toISOString().slice(0, 10);
    ok('D0: an open to-do due TODAY is due; done or dateless never is',
      dealTaskDue({ status: 'open', due_date: today }, new Date().toISOString()) === true &&
      dealTaskDue({ status: 'done', due_date: '2020-01-01' }, new Date().toISOString()) === false &&
      dealTaskDue({ status: 'open', due_date: null }, new Date().toISOString()) === false);
    ok('D0: a next-step date is overdue only once PAST, only on open pipeline stages, never on a converted deal',
      nextStepOverdue({ stage: 'proposal', next_step_at: '2020-01-01', converted_client_id: null }, new Date().toISOString()) === true &&
      nextStepOverdue({ stage: 'proposal', next_step_at: today, converted_client_id: null }, new Date().toISOString()) === false &&
      nextStepOverdue({ stage: 'won', next_step_at: '2020-01-01', converted_client_id: null }, new Date().toISOString()) === false &&
      nextStepOverdue({ stage: 'proposal', next_step_at: '2020-01-01', converted_client_id: OWNER_CLIENT }, new Date().toISOString()) === false);
  }
  {
    const { calls, sent } = installFake({
      dealTasks: [{ id: TASK, site_id: AGENCY, deal_id: DEAL, title: 'Send the contract', due_date: '2020-01-02' }],
      nextStepDeals: [{ id: DEAL, site_id: AGENCY, title: 'Bacchus website', stage: 'proposal', next_step_at: '2020-01-05', next_step: 'Call Claud' }],
    });
    const r = await runDealTaskReminders(10);
    await settle();
    const notices = calls.filter((c) => c.method === 'POST' && c.url.includes('presence_plan_notices'));
    ok('D1: an overdue deal to-do raises deal_task_due on a week-bucketed per-task key',
      notices.some((c) => c.body?.kind === 'deal_task_due' && new RegExp(`^dealtask:${TASK}:w\\d+$`).test(String(c.body?.period))),
      notices.map((c) => c.body?.period).join(', '));
    ok('D1: a passed next-step date raises on its own per-deal key (same kind, distinct namespace)',
      notices.some((c) => c.body?.kind === 'deal_task_due' && new RegExp(`^nextstep:${DEAL}:w\\d+$`).test(String(c.body?.period))));
    ok('D1: both nudges email the operator with a deep link to the deal',
      r.nudged === 2 && sent.length === 2 && sent.every((s) => s?.to === 'studio@davisdigitalstudio.com' && new RegExp(`pipeline\\.html\\?deal=${DEAL}`).test(String(s?.html || ''))));
    ok('D1: the copy names the to-do / the step and the date it slipped',
      sent.some((s) => /Send the contract/.test(String(s?.html))) && sent.some((s) => /Call Claud/.test(String(s?.html)) && /2020-01-05/.test(String(s?.html))));
    restore();
  }
  {
    // pre-0108 (no presence_deal_tasks table) → the whole sweep no-ops cleanly
    const { calls } = installFake();
    const orig = globalThis.fetch;
    globalThis.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('presence_deal_tasks')) return jr({ message: 'relation does not exist' }, 404);
      return orig(input, init);
    };
    let r = null, threw = false;
    try { r = await runDealTaskReminders(10); } catch { threw = true; }
    ok('D2: a pre-0108 environment no-ops cleanly (no throw, tasks skipped, next-step half still runs)',
      !threw && r !== null && !calls.some((c) => c.method === 'POST' && c.url.includes('presence_plan_notices') && String(c.body?.period || '').startsWith('dealtask:')));
    restore();
  }
} finally {
  restore();
  releaseWarn();
}

const passed = results.filter(Boolean).length;
console.log(`\n════ NEVER SILENT (echo truth · feed write · dunning · deal dates): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
