// ── The two money moments + the delivery checklist ──────────────────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/money_moments_test.mjs
//
// Eric's client Claud Beltran signed a contract and paid a deposit, and Eric got
// NO EMAIL for either — because no such email existed. Both moments raised an
// in-app notice and stopped there, which only ever helps someone already looking
// at the app. This suite holds down the two sends, the send-ONCE gate on each,
// the recipient fallback that made them reachable at all, and the ten-step
// delivery checklist that finally lets a project's progress move off 0%.
//
// The hazards it exists to hold down:
//   • SEND-ONCE — raiseNotice returns true only for a NEWLY INSERTED row
//     (lib/notice.ts). raiseDealReady used to DISCARD that flag and return void,
//     so there was nothing to gate a signed-agreement email on. A replayed sign
//     or a re-fired Stripe webhook must email exactly ONCE, ever.
//   • RECIPIENT — presence_identity.email is `default ''` (0015) and blank on
//     Eric's own site, so `const owner = ident.json?.[0]?.email; if (owner)` was
//     a SILENT skip: no send, no log. Every operator send must fall back
//     (identity → the owner's own clients row → OPS_ALERT_EMAIL) and must WARN
//     rather than vanish when it resolves to nobody.
//   • DEPOSIT ≠ INVOICE — a deposit is presence_invoices.purpose='deposit'
//     (0086), not a separate flow, and the mail must SAY "deposit" and name the
//     amount and the payer rather than saying "invoice" generically.
//   • IDEMPOTENT AUTO-TICK — a re-fired webhook or a re-publish must not
//     double-tick a checklist step, and must never fail the parent operation.
//   • NO PORTAL LEAK — seeding ten steps must not put the studio's internal
//     work in front of the customer.
//   • SEEING AN ASK ≠ SETTLING IT — the three client-facing steps must STAY in
//     the customer's portal (they are their homework) while the tick stays the
//     studio's, because the studio's progress bar is computed from these very
//     rows. Enforced on the ROUTE, not by a hidden button.
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));

// ── env MUST be set before importing (module-load reads) ──
const AGENCY = '11111111-1111-4111-8111-111111111111';
const OWNER_CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJECT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DEAL = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const INVOICE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
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
const bridge = await import('../../supabase/functions/presence/lib/service_bridge.ts');
const { DELIVERY_CHECKLIST, checklistSource, checklistRows, clientMayTick, isChecklistSource } = await import('../../supabase/functions/presence/lib/project_checklist.ts');
const { handleClientTaskDone } = await import('../../supabase/functions/presence/routes/client_delivery.ts');

const realFetch = globalThis.fetch;
const jr = (data, status = 200) => new Response(data === null ? '' : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

/** cfg:
 *   noticeCreated  false → the unique key already existed (throttled / retry)
 *   identityEmail  '' → no presence_identity.email for the site (Eric's real state)
 *   ownerEmail     '' → the site owner's clients row carries no email either
 *   purpose        'deposit' | 'service'
 *   invoicePaid    false → the invoice isn't actually paid (forged id)
 *   taskAlreadyDone true → the checklist PATCH matches nothing (already ticked)
 *   projectHasTasks true → the project is not empty, so no seeding
 */
function installFetch(cfg = {}) {
  const calls = [];
  const sent = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init.method || (typeof input !== 'string' ? input.method : 'GET') || 'GET').toUpperCase();
    let body = null; try { body = init.body ? JSON.parse(init.body) : null; } catch { /* */ }
    calls.push({ url, method, body });
    if (url.includes('api.resend.com/emails')) { sent.push(body); return jr({ id: 're_1' }, 200); }
    if (url.includes('suppressed_emails')) return jr([]);
    if (url.includes('/rpc/rate_hit')) return jr(true);
    if (url.includes('presence_plan_notices') && method === 'POST') return jr(cfg.noticeCreated === false ? [] : [{ id: 'notice_1' }], 201);
    if (url.includes('presence_invoices')) {
      if (cfg.invoicePaid === false) return jr([]);
      return jr([{ id: INVOICE, site_id: AGENCY, deal_id: DEAL, title: cfg.purpose === 'service' ? 'Phase 2' : 'Deposit', amount_cents: 50000, purpose: cfg.purpose || 'deposit' }]);
    }
    if (url.includes('presence_sites')) return jr([{ id: AGENCY, client_id: cfg.siteClientId === null ? null : OWNER_CLIENT }]);
    if (url.includes('presence_identity')) return jr([{ business_name: 'Davis Digital Studio', email: cfg.identityEmail === undefined ? 'studio@davisdigitalstudio.com' : cfg.identityEmail }]);
    if (url.includes('presence_brand_kits') || url.includes('brand_kit')) return jr([]);
    if (url.includes(`clients?id=eq.${OWNER_CLIENT}`)) return jr([{ id: OWNER_CLIENT, name: 'Davis Digital Studio', email: cfg.ownerEmail === undefined ? 'eric@davisdigitalstudio.com' : cfg.ownerEmail, contact_email: '' }]);
    if (url.includes('presence_deals')) return jr([{ id: DEAL, title: 'Bacchus website', contact_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', created_project_id: PROJECT }]);
    if (url.includes('presence_contacts')) return jr([{ name: 'Claud Beltran' }]);
    if (url.includes('presence_tasks') && method === 'PATCH') return jr(cfg.taskAlreadyDone ? [] : [{ id: 'task_1', title: 'Deposit paid', client_visible: false }]);
    if (url.includes('presence_tasks') && method === 'POST') return jr((body || []).map((_, i) => ({ id: `task_${i}` })), 201);
    if (url.includes('presence_tasks')) return jr(cfg.projectHasTasks ? [{ id: 'task_x' }] : []);
    if (url.includes('presence_project_events')) return jr(null, 201);
    if (url.includes('presence_push_subscriptions')) return jr([]);
    return jr([]);
  };
  return { calls, sent };
}
const restore = () => { globalThis.fetch = realFetch; };

let warned = [];
const realWarn = console.warn;
const captureWarn = () => { warned = []; console.warn = (...a) => { warned.push(a.join(' ')); }; };
const releaseWarn = () => { console.warn = realWarn; };

const echoReq = (secret = SECRET, invoiceId = INVOICE) => new Request('https://x/commerce/invoice-paid', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-commerce-secret': secret },
  body: JSON.stringify({ invoice_id: invoiceId }),
});
const PRINCIPAL = { kind: 'public', userId: null, tenantId: null, role: null, email: null, jwt: null, requestId: 't' };
const echo = (req) => handleCommerce(req, '/commerce/invoice-paid', 'POST', PRINCIPAL, {});

try {
  // ═══════════════ PART A · the DEPOSIT-PAID operator email ═══════════════
  {
    const { sent, calls } = installFetch({ purpose: 'deposit' });
    const r = await echo(echoReq());
    const out = await r.json();
    ok('paid: a paid deposit emails the operator', r.status === 200 && out.data?.emailed === true && sent.length === 1);
    ok('paid: it goes to the site’s resolved operator address', sent[0]?.to === 'studio@davisdigitalstudio.com');
    ok('paid: the subject SAYS deposit, the amount, and who paid — not "invoice"',
      /^Deposit received — \$500\.00 from Claud Beltran$/.test(String(sent[0]?.subject || '')), String(sent[0]?.subject));
    ok('paid: the body names the amount and the payer', /\$500\.00/.test(String(sent[0]?.html || '')) && /Claud Beltran/.test(String(sent[0]?.html || '')));
    // reply-to: operator mail must NEVER carry the site's inbound webhook address
    ok('paid: reply-to stays the human platform address (never the inbound webhook)', sent[0]?.reply_to === 'eric@davisdigitalstudio.com');
    const notice = calls.find((c) => c.url.includes('presence_plan_notices') && c.method === 'POST');
    ok('paid: the notice goes through raiseNotice’s on_conflict upsert (so it also PUSHES)',
      /on_conflict=client_id,kind,period/.test(String(notice?.url || '')), String(notice?.url));
    ok('paid: the notice keys on the invoice id, so a Stripe retry re-raises nothing', notice?.body?.period === `paid:${INVOICE}`);
    ok('paid: the notice headline names the deposit + amount + payer',
      /^Deposit — Deposit \(\$500\.00\) from Claud Beltran$/.test(String(notice?.body?.headline || '')), String(notice?.body?.headline));
    const tick = calls.find((c) => c.url.includes('presence_tasks') && c.method === 'PATCH');
    ok('paid: a paid DEPOSIT ticks checklist step 2', out.data?.ticked === true && /source=eq\.checklist%3Adeposit_paid/.test(String(tick?.url || '')), String(tick?.url));
    restore();
  }

  // SEND-ONCE — the `fresh` gate. A re-fired Stripe webhook hits the same unique
  // (client_id, kind, period) key, raiseNotice returns false, and NOTHING sends.
  {
    const { sent } = installFetch({ purpose: 'deposit', noticeCreated: false });
    const out = await (await echo(echoReq())).json();
    ok('paid ONCE: a re-fired webhook (notice already exists) sends NO second email', out.data?.emailed === false && sent.length === 0);
    restore();
  }

  // A plain service invoice says "Payment", not "Deposit".
  {
    const { sent } = installFetch({ purpose: 'service' });
    await echo(echoReq());
    ok('paid: a purpose=service invoice says "Payment received", never "Deposit"',
      /^Payment received — /.test(String(sent[0]?.subject || '')) && !/Deposit/.test(String(sent[0]?.subject || '')), String(sent[0]?.subject));
    restore();
  }

  // ═══════════════ PART B · the RECIPIENT fallback chain ═══════════════
  // This is the bug: Eric's presence_identity.email is blank, so the old
  // `if (owner)` idiom skipped every operator send in silence.
  {
    const { sent } = installFetch({ purpose: 'deposit', identityEmail: '' });
    await echo(echoReq());
    ok('recipient: a BLANK presence_identity.email FALLS BACK to the owner’s own clients row (it does not skip)',
      sent.length === 1 && sent[0]?.to === 'eric@davisdigitalstudio.com');
    restore();
  }
  {
    // identity blank AND the owner's client row blank → the platform's own agency
    // site may use OPS_ALERT_EMAIL (AGENCY_SITE_ID matches).
    const { sent } = installFetch({ purpose: 'deposit', identityEmail: '', ownerEmail: '' });
    await echo(echoReq());
    ok('recipient: both blank on the PLATFORM’s agency site → OPS_ALERT_EMAIL, still not silence',
      sent.length === 1 && sent[0]?.to === 'ops@davisdigitalstudio.com');
    restore();
  }
  {
    // Nothing resolvable → a WARN, never a silent skip. (AGENCY_SITE_ID no longer
    // matches, so the OPS rung correctly does not exist for this site.)
    Deno.env.set('AGENCY_SITE_ID', '00000000-0000-4000-8000-000000000000');
    const { sent } = installFetch({ purpose: 'deposit', identityEmail: '', ownerEmail: '' });
    captureWarn();
    const emailed = await bridge.emailOperator(AGENCY, 'subject', '<p>body</p>', 'test_kind');
    releaseWarn();
    ok('recipient: no address anywhere → no send, and a WARN that names the site and what was skipped',
      emailed === false && sent.length === 0 && warned.some((w) => w.includes('[operator-mail]') && w.includes(AGENCY) && w.includes('test_kind')),
      JSON.stringify(warned));
    Deno.env.set('AGENCY_SITE_ID', AGENCY);
    restore();
  }
  {
    // The OPS rung must be IMPOSSIBLE to reach for a site that isn't the platform's.
    Deno.env.set('AGENCY_SITE_ID', '00000000-0000-4000-8000-000000000000');
    const { sent } = installFetch({ purpose: 'deposit', identityEmail: '', ownerEmail: '' });
    await echo(echoReq());
    ok('recipient: OPS_ALERT_EMAIL can NEVER receive another tenant’s activity', sent.length === 0);
    Deno.env.set('AGENCY_SITE_ID', AGENCY);
    restore();
  }

  // ═══════════════ PART C · the echo route's own guards ═══════════════
  {
    const { sent } = installFetch({ purpose: 'deposit' });
    const r = await echo(echoReq('wrong-secret'));
    ok('route: a wrong x-commerce-secret is refused (403) and sends nothing', r.status === 403 && sent.length === 0);
    restore();
  }
  {
    const { sent } = installFetch({ purpose: 'deposit', invoicePaid: false });
    const r = await echo(echoReq());
    const out = await r.json();
    ok('route: an invoice that is not actually PAID in the database is ignored (facts come from the db, not the body)',
      r.status === 200 && out.data?.ignored === true && sent.length === 0);
    restore();
  }
  {
    const { sent } = installFetch({ purpose: 'deposit' });
    const r = await echo(echoReq(SECRET, 'not-a-uuid'));
    ok('route: a non-uuid invoice id is a 400, never a lookup', r.status === 400 && sent.length === 0);
    restore();
  }

  // ═══════════════ PART D · the CHECKLIST ═══════════════
  ok('checklist: exactly TEN steps, so each is worth exactly 10%', DELIVERY_CHECKLIST.length === 10);
  ok('checklist: the steps are Eric’s list, in his order',
    DELIVERY_CHECKLIST.map((s) => s.key).join(',') === 'agreement_signed,deposit_paid,questionnaire_returned,content_received,draft_shared,client_review,revisions,domain_connected,site_live,handover');
  ok('checklist: three steps self-tick from facts the system already owns',
    DELIVERY_CHECKLIST.filter((s) => s.auto).map((s) => s.auto).join(',') === 'contract_signed,deposit_paid,site_live');
  ok('checklist: every step is addressable by a stable source key (checklist:<key>)',
    new Set(DELIVERY_CHECKLIST.map((s) => checklistSource(s.key))).size === 10);
  // THE PORTAL RULE — a task is shared with the customer EXACTLY when it needs
  // the customer to act (the convention applyTemplate already established). A
  // step that is the studio's own work must never become client_visible.
  {
    const rows = checklistRows(AGENCY, PROJECT);
    ok('portal: client_visible === client_action_required for every seeded step (no internal work is shared)',
      rows.every((r) => r.client_visible === r.client_action_required));
    ok('portal: exactly the three genuine client actions are shared; the studio’s seven stay internal',
      rows.filter((r) => r.client_visible).length === 3 &&
      rows.filter((r) => r.client_visible).map((r) => r.title).join(' | ') === 'Send back your project questionnaire | Send your content and photos | Review the design draft');
    ok('portal: the shared steps are worded as the ASK (the portal prints the raw title on the client’s to-do card)',
      rows.filter((r) => r.client_visible).every((r) => /^(Send|Review)\b/.test(String(r.title))));
    ok('checklist: sort_order strides by 10 so the studio can insert between steps', rows.map((r) => r.sort_order).join(',') === '0,10,20,30,40,50,60,70,80,90');
    ok('checklist: every seeded row starts as todo and carries the project’s own site_id (tenant-safe)',
      rows.every((r) => r.status === 'todo' && r.site_id === AGENCY && r.project_id === PROJECT));
  }

  // ═══════════════ PART D2 · SEEING an ask is not SETTLING it ═══════════════
  // Eric's rule. The client still sees "Send your content and photos" as their
  // to-do — it IS their homework — but he ticks it, when the thing actually
  // arrives. His progress bar is computed from these very rows, so a client
  // self-tick would move HIS number on evidence he does not have. The third
  // question ("may they tick it?") is answered by `source`, not by a third
  // column: a checklist step has always been settled by EVIDENCE (the three
  // auto-ticks) or by the operator — never by a claim.
  ok('tick: not one delivery-checklist step is client-tickable — not even the three addressed to the client',
    DELIVERY_CHECKLIST.every((s) => clientMayTick(checklistSource(s.key)) === false));
  ok('tick: …while ordinary work is untouched — manual and starter-template tasks keep the button they’ve had since P2-D',
    clientMayTick('manual') === true && clientMayTick('template') === true &&
    clientMayTick('') === true && clientMayTick(null) === true && clientMayTick(undefined) === true);
  ok('tick: the test is the checklist PREFIX, so a source that merely contains the word is not caught',
    isChecklistSource('checklist:content_received') === true && isChecklistSource('checklist') === false &&
    isChecklistSource('my checklist:x') === false && isChecklistSource('template') === false);
  {
    const rows = checklistRows(AGENCY, PROJECT);
    ok('tick: the three client steps STAY shared and still read as the client’s ask (the portal must keep listing them)',
      rows.filter((r) => r.client_visible).length === 3 &&
      rows.filter((r) => r.client_visible).every((r) => r.client_action_required === true));
    ok('tick: …and none of the ten seeded rows is tickable by the client',
      rows.every((r) => clientMayTick(r.source) === false));
  }

  // THE ROUTE IS THE RULE — a crafted POST must be refused even though the
  // portal draws no button. Same door, two tasks, two answers.
  {
    const CUSTOMER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const CUST_SITE = { id: '77777777-7777-4777-8777-777777777777', client_id: CUSTOMER };
    const CHK_TASK = '99999999-9999-4999-8999-999999999999';
    const TPL_TASK = '88888888-8888-4888-8888-888888888888';
    const installTaskFetch = (task) => {
      const calls = [];
      globalThis.fetch = async (input, init = {}) => {
        const url = typeof input === 'string' ? input : input.url;
        const method = (init.method || 'GET').toUpperCase();
        calls.push({ url, method });
        if (url.includes('presence_service_links')) return jr([{ project_id: PROJECT, agency_site_id: AGENCY, customer_client_id: CUSTOMER }]);
        if (url.includes('presence_tasks') && method === 'PATCH') return jr(null, 200);
        if (url.includes('presence_tasks')) return jr(task ? [task] : []);
        if (url.includes('presence_project_events')) return jr(null, 201);
        return jr([]);
      };
      return calls;
    };
    const post = (taskId) => handleClientTaskDone(new Request('https://x/done', { method: 'POST' }), CUST_SITE, PRINCIPAL, PROJECT, taskId, {});
    {
      const calls = installTaskFetch({ id: CHK_TASK, title: 'Send your content and photos', status: 'todo', source: 'checklist:content_received' });
      const r = await post(CHK_TASK);
      const out = await r.json();
      ok('route: a crafted POST for a CHECKLIST step is refused (403), even though the client can see it',
        r.status === 403 && out.error === 'operator_verified', `${r.status} ${JSON.stringify(out)}`);
      ok('route: …and NOTHING is written — no status flip, no "the client acted" event on Eric’s timeline',
        !calls.some((c) => c.method === 'PATCH') && !calls.some((c) => c.url.includes('presence_project_events')));
      ok('route: …and the refusal is honest — 403 with who ticks it, not a 404 pretending their own to-do isn’t there',
        r.status !== 404 && /Your studio marks this one off once it arrives/.test(String(out.message || '')), String(out.message));
      restore();
    }
    {
      // NO REGRESSION: the starter template's client task still ticks, exactly as before.
      const calls = installTaskFetch({ id: TPL_TASK, title: 'Send your logo', status: 'todo', source: 'template' });
      const r = await post(TPL_TASK);
      const out = await r.json();
      ok('route: a starter-TEMPLATE client task still ticks — the long-standing behaviour is unchanged',
        r.status === 200 && out.data?.ok === true, `${r.status} ${JSON.stringify(out)}`);
      const patch = calls.find((c) => c.method === 'PATCH');
      ok('route: …with the same site-scoped PATCH and the same client-visible event it always wrote',
        /presence_tasks\?id=eq\./.test(String(patch?.url || '')) && calls.some((c) => c.url.includes('presence_project_events') && c.method === 'POST'), String(patch?.url));
      restore();
    }
    {
      // The gate reads `source`, so the lookup must actually ASK for it.
      const calls = installTaskFetch({ id: TPL_TASK, title: 'Send your logo', status: 'todo', source: 'manual' });
      await post(TPL_TASK);
      const look = calls.find((c) => c.url.includes('presence_tasks') && c.method === 'GET');
      ok('route: the task lookup selects `source` — the gate can never read undefined and wave a step through',
        /select=[^&]*\bsource\b/.test(String(look?.url || '')), String(look?.url));
      restore();
    }
  }

  // SEEDING — a new project gets ten tasks, so progress can move off 0%.
  {
    const { calls } = installFetch();
    const n = await bridge.seedProjectChecklist(AGENCY, PROJECT);
    const ins = calls.find((c) => c.url.includes('presence_tasks') && c.method === 'POST');
    ok('seed: a task-less project gets all TEN steps in ONE insert', n === 10 && Array.isArray(ins?.body) && ins.body.length === 10);
    restore();
  }
  {
    // Self-guarding: it only ever FILLS an empty project, never merges into one
    // the studio is already running (and never resurrects steps they deleted).
    const { calls } = installFetch({ projectHasTasks: true });
    const n = await bridge.seedProjectChecklist(AGENCY, PROJECT);
    ok('seed: a project that already has ANY task is left completely alone', n === 0 && !calls.some((c) => c.url.includes('presence_tasks') && c.method === 'POST'));
    const guard = calls.find((c) => c.url.includes('presence_tasks') && c.method === 'GET');
    ok('seed: …and the guard counts soft-deleted rows too, so a re-run can’t resurrect deleted steps',
      guard && !/deleted_at=is\.null/.test(String(guard.url)), String(guard?.url));
    restore();
  }

  // AUTO-TICK IDEMPOTENCY — the whole guarantee is one WHERE clause.
  {
    const { calls } = installFetch();
    const first = await bridge.tickChecklistStep(AGENCY, PROJECT, 'deposit_paid');
    const patch = calls.find((c) => c.url.includes('presence_tasks') && c.method === 'PATCH');
    ok('tick: the PATCH filters on status=neq.done — the idempotency guarantee itself',
      first === true && /status=neq\.done/.test(String(patch?.url || '')), String(patch?.url));
    ok('tick: …and addresses exactly ONE step by its source key', /source=eq\.checklist%3Adeposit_paid/.test(String(patch?.url || '')), String(patch?.url));
    ok('tick: …scoped to the project AND its site (tenant-safe)',
      /project_id=eq\./.test(String(patch?.url || '')) && /site_id=eq\./.test(String(patch?.url || '')));
    ok('tick: a real tick records a project activity event', calls.some((c) => c.url.includes('presence_project_events') && c.method === 'POST'));
    restore();
  }
  {
    // The re-fired webhook: the row is already done, the PATCH matches nothing.
    const { calls } = installFetch({ taskAlreadyDone: true });
    const again = await bridge.tickChecklistStep(AGENCY, PROJECT, 'deposit_paid');
    ok('tick ONCE: an already-done step returns false and writes NO second activity event',
      again === false && !calls.some((c) => c.url.includes('presence_project_events')));
    restore();
  }
  {
    // Never fail the parent operation: signing, payment and publishing all hang
    // off this, and none of them may die because their bookkeeping did.
    globalThis.fetch = async () => { throw new Error('database is on fire'); };
    captureWarn();
    const r1 = await bridge.tickChecklistStep(AGENCY, PROJECT, 'site_live');
    const r2 = await bridge.seedProjectChecklist(AGENCY, PROJECT);
    releaseWarn();
    ok('resilience: a database failure makes the tick and the seed return falsy, never throw', r1 === false && r2 === 0);
    ok('resilience: …and it is LOGGED, not swallowed in silence', warned.some((w) => w.includes('[checklist]')), JSON.stringify(warned));
    restore();
  }
  {
    // The sign path knows a deal, not a project.
    const { calls } = installFetch();
    const t = await bridge.tickChecklistForDeal(AGENCY, DEAL, 'agreement_signed', 'contract-sign', 'system');
    ok('tick: a deal resolves to its handed-off project (deal.created_project_id) and ticks step 1',
      t === true && calls.some((c) => c.url.includes('presence_tasks') && c.method === 'PATCH' && /source=eq\.checklist%3Aagreement_signed/.test(c.url)));
    restore();
  }
  {
    // Publishing knows only the site it just put live — the tick must route
    // through the ACTIVE service link so it can never cross tenants.
    const { calls } = installFetch();
    globalThis.fetch = ((f) => async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('presence_service_links')) { calls.push({ url, method: 'GET', body: null }); return jr([{ project_id: PROJECT, agency_site_id: AGENCY }]); }
      return f(input, init);
    })(globalThis.fetch);
    const t = await bridge.tickChecklistForCustomerSite(AGENCY, 'site_live', 'publish', 'system');
    const link = calls.find((c) => c.url.includes('presence_service_links'));
    ok('tick: a live publish resolves its project through the ACTIVE service link only',
      t === true && /customer_site_id=eq\./.test(String(link?.url || '')) && /status=eq\.active/.test(String(link?.url || '')), String(link?.url));
    restore();
  }
} finally { restore(); releaseWarn(); }

// ═══════════════ PART E · structural pins (the call sites) ═══════════════
{
  const sales = read('supabase/functions/presence/routes/sales.ts');
  // THE RETURN CHANGE. raiseDealReady called raiseNotice and threw its answer
  // away, so nothing downstream could know whether this was the FIRST time.
  ok('sign: raiseDealReady returns a boolean (it no longer discards raiseNotice’s send-once flag)',
    /async function raiseDealReady\([^)]*\): Promise<boolean>/.test(sales));
  ok('sign: …and it returns raiseNotice’s created flag, not a constant',
    /const fresh = await raiseNotice\(\{ siteId, clientId: site\.client_id, kind: 'deal_signed'/.test(sales) && /\n    return fresh;/.test(sales));
  const signFn = sales.slice(sales.indexOf('export async function handleSalesContractSign'), sales.indexOf('export async function handleSalesPublicView'));
  ok('sign: the sign path captures that flag', /const signedIsNews = await raiseDealReady\(tok\.site_id, dealId, 'signed', id\)/.test(signFn));
  ok('sign: …and the operator email is GATED on it, so a replayed sign emails once',
    /if \(signedIsNews\) \{[\s\S]{0,1400}?emailOperator\(tok\.site_id,/.test(signFn));
  ok('sign: the operator email names the signer, the deal, and links to the deal',
    /Signed — \$\{dealTitle\}/.test(signFn) && /esc\(signerName\)/.test(signFn) && /label: 'Open the deal', href: `\$\{base\}\/pipeline\.html\?deal=\$\{dealId\}`/.test(signFn));
  ok('sign: …and the button is rendered on the STUDIO’s brand accent, never a hardcoded colour',
    !/background:#[0-9a-f]{6}/i.test(signFn));
  ok('sign: it uses emailOperator (studioRecipient’s fallback chain), never a bare presence_identity read',
    /emailOperator\(/.test(signFn) && !/presence_identity\?/.test(signFn));
  ok('sign: the operator email can never fail the signature (its own swallowed try)',
    /if \(signedIsNews\) \{\s*\n\s*try \{/.test(signFn));
  ok('sign: signing ticks checklist step 1', /tickChecklistForDeal\(tok\.site_id, dealId, 'agreement_signed'/.test(signFn));
}
{
  const lcRaw = read('supabase/functions/presence/commerce/lifecycle.ts');
  // strip line comments — the header WARNS about the old idiom by quoting it, and
  // a "this must not exist" check has to look at code, not at the warning.
  const lc = lcRaw.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  // Part 1b: the same silent skip, five more times.
  ok('lifecycle: the silent `const owner = ident.json?.[0]?.email` idiom is GONE from every sweep',
    !/const owner = ident\.json\?\.\[0\]\?\.email/.test(lc) && !/presence_identity\?site_id=eq\.[^&]*&select=email/.test(lc));
  const kinds = ['lead_followup', 'deal_followup', 'support_aging', 'renewal_reminder', 'agreement_renewal', 'deal_task_due'];
  for (const k of kinds) ok(`lifecycle: the ${k} email now routes through emailOperator (it was dying silently)`, new RegExp(`emailOperator\\([\\s\\S]*?'${k}'`).test(lc));
  // seven call sites: the five originals + the two deal_task_due sends (overdue
  // to-dos and passed next-step dates — runDealTaskReminders).
  ok('lifecycle: every operator send goes through the ONE door', (lc.match(/emailOperator\(/g) || []).length === 7);
}
{
  const sb = read('supabase/functions/presence/lib/service_bridge.ts');
  ok('recipient: studioRecipient is EXPORTED so it is the one resolver everywhere', /export async function studioRecipient\(/.test(sb));
  ok('recipient: emailOperator warns (never returns silently) when it resolves to nobody',
    /\[operator-mail\] no operator recipient/.test(sb));
  ok('recipient: operator mail is critical:true (an opt-out must not silently suppress it)',
    /sendEmail\(to, subject\.slice\(0, 180\), body, brand, \{ critical: true \}\)/.test(sb));
  ok('recipient: operator mail omits siteId, so Reply can never post into /email/inbound',
    !/emailOperator[\s\S]{0,900}siteId:/.test(sb));
  ok('handoff: a converted deal’s project is seeded with the checklist', /await seedProjectChecklist\(agencySiteId, project\.id\);/.test(sb));
  ok('handoff: …and the already-true steps are reconciled from evidence, not left lying at todo',
    /await reconcileChecklistFacts\(agencySiteId, deal\.id, project\.id\);/.test(sb));
}
{
  const hook = read('supabase/functions/stripe-webhook/index.ts');
  const fn = hook.slice(hook.indexOf('const markPresenceInvoicePaid'), hook.indexOf('  // Dispatch returns the Response'));
  ok('webhook: the paid echo is delegated to the presence function (which owns Resend, VAPID and the brand)',
    /const echoed = await forwardInvoicePaid\(String\(inv\.id\)\);/.test(fn));
  ok('webhook: …over the same secret-gated hop billing-sync already uses',
    /x-commerce-secret': BILLING_SYNC_SECRET/.test(hook) && /presence\/commerce\/invoice-paid/.test(hook));
  ok('webhook: the hop passes an ID ONLY — it can never assert an amount or a payee',
    /body: JSON\.stringify\(\{ invoice_id: invoiceId \}\)/.test(hook));
  const iTry = fn.indexOf('    try {');
  const iEcho = fn.indexOf('forwardInvoicePaid(String(inv.id))');
  const iCatch = fn.indexOf('} catch (e) { console.warn(`[stripe-webhook] paid-echo');
  ok('webhook: the echo stays INSIDE the swallowed try — a payment never fails because its echo did',
    iTry > 0 && iEcho > iTry && iCatch > iEcho, `try@${iTry} echo@${iEcho} catch@${iCatch}`);
  ok('webhook: …and a failure is VISIBLE — console.warn, never a bare catch {}',
    /catch \(e\) \{ console\.warn\(`\[stripe-webhook\] paid-echo/.test(fn) && !/catch \{\s*\}/.test(fn));
  // (hollow-200 fix) `echoed` is now the parsed body's own notice/already flags,
  // not "the route answered 2xx" — a 200 {ignored} or notice:false must fall
  // through to the floor, and the floor insert is conflict-safe (a retry or a
  // half-successful echo never errors and never doubles).
  ok('webhook: a failed OR hollow echo still writes the in-app notice, so the operator is never left with nothing',
    /if \(!echoed\.delivered && clientId\) \{[\s\S]{0,1600}?presence_plan_notices\?on_conflict=client_id,kind,period/.test(fn));
  ok('webhook: the echo is accepted ONLY on the body’s own flags (notice/already), never a bare 2xx',
    /d\.notice === true \|\| d\.already === true/.test(hook));
  ok('webhook: …and says exactly what was lost', /invoice-paid echo hop FAILED[\s\S]{0,80}no push, no operator email/.test(fn));
}
{
  // The 0120 backfill must describe the SAME ten steps as the code, or an
  // existing project and a new one would disagree about what the checklist is.
  const sql = read('supabase/migrations/0120_project_checklist_backfill.sql');
  for (const s of DELIVERY_CHECKLIST) {
    ok(`backfill: 0120 seeds the '${s.key}' step with the code’s exact title and visibility`,
      new RegExp(`\\('${s.key}',\\s*'${s.title.replace(/'/g, "''")}',\\s*${s.clientAction ? ' true' : 'false'},`).test(sql));
  }
  ok('backfill: it only touches projects with NO task rows at all (the re-run guard)',
    /not exists \(select 1 from public\.presence_tasks t where t\.project_id = p\.id\)/.test(sql));
  ok('backfill: every status flip is guarded on `status <> \'done\'`, so a re-run is a no-op',
    (sql.match(/and t\.status <> 'done'/g) || []).length === 3);
  ok('backfill: completed_at is COALESCEd, so a re-run can never restamp a date',
    (sql.match(/completed_at = coalesce\(t\.completed_at, now\(\)\)/g) || []).length === 3);
  ok('backfill: it never touches a task the studio wrote (every update is scoped to checklist: rows)',
    (sql.match(/t\.source = 'checklist:/g) || []).length === 3);
  ok('backfill: it is additive — no drop/alter/delete of any object', !/\b(drop|alter|truncate)\s+(table|policy|constraint|column)/i.test(sql));
  ok('backfill: the uniqueness index is PARTIAL, so ordinary manual/template tasks are untouched',
    /create unique index if not exists presence_tasks_project_checklist_uq[\s\S]{0,200}where source like 'checklist:%'/.test(sql));
  ok('backfill: the deposit evidence is purpose=deposit (a deposit is not a separate flow)',
    /i\.purpose = 'deposit' and i\.status = 'paid'/.test(sql));
  ok('backfill: the site-live evidence routes through the ACTIVE service link (never another tenant)',
    /presence_service_links l[\s\S]{0,200}l\.status = 'active'[\s\S]{0,120}s\.status = 'live'/.test(sql));
}
{
  const pub = read('supabase/functions/presence/routes/publish.ts');
  const rec = read('supabase/functions/presence/lib/deploy_reconcile.ts');
  ok('publish: a live publish ticks the "Site live" step', /if \(live\) await tickChecklistForCustomerSite\(site\.id, 'site_live'/.test(pub));
  ok('publish: …and so does the reconcile that finalizes an ASYNC deploy (both doors to live)',
    /tickChecklistForCustomerSite\(String\(p\.site_id\), 'site_live'/.test(rec));
  ok('publish: the tick can never fail a publish', /'site_live', 'publish', 'system'\)\.catch\(\(\) => false\)/.test(pub));
}
{
  // The portal's side of the contract: client.html renders ONLY tasks flagged as
  // needing the client. If that ever changes, the seven internal steps would
  // appear in the customer's portal.
  const portal = read('client.html');
  const uses = portal.match(/\(d\.tasks\|\|\[\]\)\.filter\([^)]*\)|\(data\.tasks\|\|\[\]\)\.filter\([^)]*\)/g) || [];
  ok('portal: every consumer of the task list in client.html filters on client_action_required',
    uses.length === 2 && uses.every((u) => u.includes('client_action_required')), JSON.stringify(uses));
  const cd = read('supabase/functions/presence/routes/client_delivery.ts');
  ok('portal: and the server never sends an internal task over the wire at all (client_visible=is.true)',
    (cd.match(/presence_tasks\?project_id=eq\.\$\{id\}[^`]*client_visible=is\.true/g) || []).length === 2);
  // …and the OTHER half of the same contract: the three client steps must keep
  // APPEARING (they are the client's homework) while losing only the button.
  ok('portal: the bundle ships `source`, so the portal can tell its own to-dos from the ones the studio settles',
    /presence_tasks\?project_id=eq\.\$\{id\}[^`]*select=[^&]*client_action_required,source,/.test(cd));
  ok('portal: the to-do card draws Mark done ONLY for a task the client may tick',
    /const mine=clientMayTick\(t\);/.test(portal) && /mine\?`<div class="row"><button class="approve" data-taskdone=/.test(portal));
  ok('portal: …and a studio-settled to-do still renders, saying who marks it off (never a dead card)',
    /Your studio marks this one off once it arrives\./.test(portal));
  ok('portal: the portal’s mirror uses the SAME checklist prefix as the server predicate',
    /function clientMayTick\(t\)\{return String\(\(t&&t\.source\)\|\|''\)\.indexOf\('checklist:'\)!==0;\}/.test(portal));
}

const failed = results.filter((r) => !r).length;
console.log(`\n════ MONEY MOMENTS + DELIVERY CHECKLIST: ${results.length - failed}/${results.length} ${failed ? 'FAILED' : 'PASSED'} ════`);
if (failed) Deno.exit(1);
