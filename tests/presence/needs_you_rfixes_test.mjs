// ── "Needs you" teardown · REVIEW FIXES (F1-F7) ──────────────────────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/needs_you_rfixes_test.mjs
//
// The teardown suite (needs_you_teardown_test.mjs) pins that doing the work
// clears the row. This suite pins the seven defects a rigorous review of
// 717c1bc..70713f6 found in HOW that was done — each one a behaviour Eric would
// feel:
//
//   F1  payment_trouble + account_lapsed were PROTECTED but have no teardown, so
//       the change made them permanently unclearable — strictly worse than
//       before. The guard below fails if ANY protected kind lacks a teardown.
//   F2  the invremind teardown was the LAST statement in a throwing try, and
//       Stripe's retry short-circuits on 'already paid' — money landed, row
//       stranded, and deliberately undismissable.
//   F3  presence.html swallowed the 409 and removed the card anyway: the
//       operator watched a protected notice vanish and come back on reload.
//   F4  the four client_* kinds silently lost their web push when they became
//       silent-ledger rows. "A client just messaged you" is the single most
//       time-sensitive operator notification in the product.
//   F5  clearNoticePrefix built a PostgREST `like` filter with no filter-grammar
//       guard — `*` and `_` are both wildcards and encodeURIComponent leaves
//       them alone.
//   F6  the weekly bucket orphaned every legacy `support:<id>` row: the prefix
//       clear (`support:<id>:%`) can never match the pre-change exact period.
//   F7  the money guard failed OPEN on a missing period — it depended on a DB
//       not-null constraint holding.
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));

Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');
// F4 needs a CONFIGURED push (pushToSite no-ops without VAPID keys), so the
// suite can observe the push actually being attempted rather than skipped.
Deno.env.set('VAPID_PUBLIC_KEY', 'BPtest-public-key');
Deno.env.set('VAPID_PRIVATE_KEY', 'test-private-key');
Deno.env.set('VAPID_SUBJECT', 'mailto:ops@example.com');

const AGENCY = '11111111-1111-4111-8111-111111111111';
Deno.env.set('AGENCY_SITE_ID', AGENCY);

const CLIENT = '22222222-2222-4222-8222-222222222222';
const SITE = { id: '99999999-9999-4999-8999-999999999999', client_id: CLIENT };
const REQ = '33333333-3333-4333-8333-333333333333';
const NID = '55555555-5555-4555-8555-555555555555';
const CORS = {};
const jr = (data, status = 200) => (data === null || status === 204)
  ? new Response(null, { status })
  : new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const realFetch = globalThis.fetch;
const settle = () => new Promise((r) => setTimeout(r, 25));   // let floating best-effort work run

const { noticeDismissible, NOTICE_PROTECTED_KINDS, NOTICE_PROTECTED_PERIOD_PREFIX } =
  await import('../../supabase/functions/presence/lib/inbox_feed.ts');

// ═══════════════════════════════════════════════════════════════════════════
// F1 — A PROTECTED KIND MUST HAVE A TEARDOWN, or protection is a trap
// ═══════════════════════════════════════════════════════════════════════════
// Protecting a row that nothing can clear does not defend an obligation — it
// makes the obligation permanent. Before this rule existed, payment_trouble and
// account_lapsed shipped protected with NO teardown anywhere in the codebase:
// the operator's card was fixed, the charge went through, and the row (plus the
// portfolio's `billing_issue` flag and the attention badge it inflates) stayed
// lit forever, on both surfaces, with every dismiss refused 409.
//
// So: scan every .ts the platform ships and prove each protected kind is
// actually reachable by a teardown. This test is the fix — it stops the trap
// recurring the next time someone reaches for the protected set.
function walkTs(dir, out = []) {
  for (const e of Deno.readDirSync(dir)) {
    const u = new URL(e.name + (e.isDirectory ? '/' : ''), dir);
    if (e.isDirectory) { if (e.name !== 'node_modules') walkTs(u, out); }
    else if (e.name.endsWith('.ts')) out.push(u);
  }
  return out;
}
const FN_FILES = walkTs(new URL('supabase/functions/', ROOT));
const FN_SRC = FN_FILES.map((u) => {
  try { return Deno.readTextFileSync(u); } catch { return ''; }
}).join('\n/*──file──*/\n');

/** Is there anywhere in the shipped source that takes a notice of this kind
 *  DOWN? Two shapes exist: the shared helpers (lib/notice.ts clearNotice /
 *  clearNoticePrefix) and a direct PostgREST PATCH to status='dismissed' (the
 *  stripe-webhook is its own Edge Function and has no lib/notice.ts). */
function teardownFor(kind) {
  if (new RegExp(`clearNotice(?:Prefix)?\\([^)]*['"\`]${kind}['"\`]`).test(FN_SRC)) return 'clearNotice()';
  if (new RegExp(`kind=eq\\.${kind}\\b[\\s\\S]{0,240}?PATCH[\\s\\S]{0,240}?status['":\\s]+['"\`]dismissed`).test(FN_SRC)) return 'PATCH status=dismissed';
  return null;
}

{
  ok('F1: the scan actually reads the platform source (guard against an empty haystack)',
    FN_FILES.length > 50 && FN_SRC.length > 200_000, `${FN_FILES.length} files / ${FN_SRC.length} bytes`);

  // THE INVARIANT. Every protected kind must be clearable by SOMETHING.
  for (const k of NOTICE_PROTECTED_KINDS) {
    const t = teardownFor(k);
    ok(`F1: protected kind '${k}' HAS a teardown (${t || 'NONE — this kind is now permanently unclearable'})`, t !== null,
      `nothing in supabase/functions/**.ts ever clears '${k}', so protecting it makes it permanent`);
  }

  // …and the shared-kind rule: the invoice reminder rides deal_followup, so the
  // teardown is period-scoped, not kind-scoped. Prove that one too.
  ok(`F1: the protected period rule '${NOTICE_PROTECTED_PERIOD_PREFIX}' has a teardown (the paid echo clears it)`,
    new RegExp(`kind=eq\\.deal_followup[\\s\\S]{0,240}?${NOTICE_PROTECTED_PERIOD_PREFIX}`).test(FN_SRC));

  // The named regression: these two were protected with nothing to clear them.
  // The biconditional is deliberate — if a teardown is ever ADDED, this fails and
  // tells you to re-protect the kind rather than leaving the guard stale.
  for (const k of ['payment_trouble', 'account_lapsed']) {
    ok(`F1: '${k}' is protected IF AND ONLY IF something can clear it`,
      NOTICE_PROTECTED_KINDS.has(k) === (teardownFor(k) !== null),
      teardownFor(k)
        ? `'${k}' now HAS a teardown (${teardownFor(k)}) — add it back to NOTICE_PROTECTED_KINDS`
        : `'${k}' has NO teardown — it must stay hand-dismissable or the operator can never clear it`);
    ok(`F1: '${k}' can be cleared once billing recovers (it has no automatic teardown)`,
      noticeDismissible(k, '2026-08') === true);
  }

  // the kinds that DO have a teardown stay protected — the fix must not have
  // thrown the money/legal guard out with the trap.
  for (const k of ['deletion_requested', 'site_down', 'publish_failed']) {
    ok(`F1: '${k}' is still protected`, NOTICE_PROTECTED_KINDS.has(k) && noticeDismissible(k, 'once') === false);
  }
  ok('F1: an unpaid invoice reminder is still protected', noticeDismissible('deal_followup', 'invremind:inv-1') === false);

  // the header comment must not keep promising teardowns that do not exist
  const feed = read('supabase/functions/presence/lib/inbox_feed.ts');
  ok('F1: the header comment no longer claims a billing-sync / entitlement teardown that was never written',
    !/payment_trouble\s+←/.test(feed) && !/account_lapsed\s+←/.test(feed));
  ok('F1: …and says WHY those two are hand-clearable', /no automatic teardown/i.test(feed));
}

// ═══════════════════════════════════════════════════════════════════════════
// F2 — the invremind teardown must survive a throw AND a Stripe retry
// ═══════════════════════════════════════════════════════════════════════════
// The clear was the LAST statement of the paid-echo try{}: a throw at the deal
// event POST or the site lookup skipped it, and Stripe's retry then hit
// `if (inv.status === 'paid') return 'ok (already paid)'` and never re-ran the
// echo. Money landed, the "Still unpaid" row stranded — and it is deliberately
// undismissable, so nothing could ever take it down.
{
  const hook = read('supabase/functions/stripe-webhook/index.ts');
  const fn = (hook.match(/const markPresenceInvoicePaid[\s\S]*?\n  \};/) || [''])[0];
  ok('F2: markPresenceInvoicePaid was found in the webhook source', fn.length > 400, `${fn.length} bytes`);

  ok('F2: the invoice-reminder clear is its OWN never-throwing unit, not a trailing statement',
    /const clearInvoiceReminder = async[\s\S]{0,900}?catch/.test(hook));

  const iClear = fn.indexOf('clearInvoiceReminder(inv)');
  const iEvent = fn.indexOf('presence_deal_events');
  ok('F2: the clear runs BEFORE the deal-event POST that could throw past it',
    iClear >= 0 && iEvent >= 0 && iClear < iEvent, `clear@${iClear} event@${iEvent}`);

  // the healing path: a retry of an already-paid invoice must still clear.
  ok('F2: the ALREADY-PAID short-circuit clears too, so a Stripe retry heals a stranded row',
    /already paid[\s\S]{0,200}/.test(fn) && /clearInvoiceReminder\(inv\)[\s\S]{0,200}?ok \(already paid\)/.test(fn),
    'the already-paid return must run the clear first');

  ok('F2: the clear can never fail payment processing (its result is ignored, never rethrown)',
    !/return await clearInvoiceReminder|throw[\s\S]{0,40}clearInvoiceReminder/.test(hook));

  // (b) the documented "or void the invoice" escape does not exist — no route in
  // the platform ever writes status:'void' on presence_invoices. pipeline.html
  // renders a "Voided" state, but nothing can produce it. The guard's comment
  // must not offer an escape the product does not have.
  const feed = read('supabase/functions/presence/lib/inbox_feed.ts');
  ok('F2b: the guard comment no longer promises an invoice-void escape that no route implements',
    !/invoice is voided|void the invoice/i.test(feed));
  ok('F2b: …and the gap is recorded where the next reader will find it',
    /no route[\s\S]{0,120}void/i.test(feed));
  // the fact the comment now rests on — no PATCH anywhere flips an invoice to
  // 'void'. (Matched on the WRITE shape, so the prose above doesn't self-satisfy.)
  ok('F2b: (fact check) nothing in the platform writes an invoice to status void',
    !/presence_invoices[\s\S]{0,300}?PATCH[\s\S]{0,300}?status:\s*['"`]void['"`]/.test(FN_SRC));
}

// ═══════════════════════════════════════════════════════════════════════════
// F3 — presence.html's Dismiss must not LIE
// ═══════════════════════════════════════════════════════════════════════════
// The plum card is a THIRD dismiss surface. It swallowed the 409 (`catch(_){}`)
// and called card.remove() unconditionally, so the operator clicked Dismiss on a
// protected notice, watched it disappear, and found it back on reload.
{
  const pres = read('presence.html');
  const fn = (pres.match(/async function renderPlanNotice\(\)[\s\S]*?\n\}/) || [''])[0];
  ok('F3: renderPlanNotice was found', fn.length > 300, `${fn.length} bytes`);
  ok('F3: the card is removed ONLY when the server actually dismissed it',
    !/catch \(_\) \{\}\s*\n?\s*card\.remove\(\)/.test(fn) && /card\.remove\(\)/.test(fn));
  ok('F3: a refusal is SHOWN, never swallowed', /catch[\s\S]{0,160}?toast\(/.test(fn));
  ok('F3: the button is not drawn at all for a notice the server would refuse',
    /dismissible !== false/.test(fn));

  // and the feeding route must ship the flag, derived from the ONE shared rule
  const cmrc = read('supabase/functions/presence/routes/commerce.ts');
  const notices = (cmrc.match(/async function handleNotices[\s\S]*?\n\}/) || [''])[0];
  ok('F3: GET /commerce/notices selects `period` (the only thing that can tell an unpaid invoice apart)',
    /select=id,kind,period,headline,body/.test(notices));
  ok('F3: …and derives `dismissible` from the SAME imported rule (no second copy of the list)',
    /dismissible: noticeDismissible\(/.test(notices) && /import \{ noticeDismissible \} from '\.\.\/lib\/inbox_feed\.ts'/.test(cmrc));
}

// F3 behavioural — the route really ships the flag, and it really refuses
const { handleCommerce } = await import('../../supabase/functions/presence/routes/commerce.ts');
const CALLER = { kind: 'client', userId: 'u-1', email: 'eric@studio.test', jwt: 'jwt', tenantId: null, role: null, requestId: 'r' };
const patchNotice = (calls) => calls.filter((c) => c.url.includes('presence_plan_notices') && c.method === 'PATCH');

try {
  const installNoticesFetch = (rows) => {
    const calls = [];
    globalThis.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = (init.method || 'GET').toUpperCase();
      let body = null; try { body = init.body ? JSON.parse(init.body) : null; } catch { /* */ }
      calls.push({ url, method, body });
      if (url.includes('presence_sites')) return jr([SITE]);
      if (url.includes('presence_plan_notices') && method === 'GET') return jr(rows);
      if (url.includes('presence_plan_notices')) return jr(null, 204);
      return jr([]);
    };
    return calls;
  };
  const getNotices = () => new Request('https://x/functions/v1/presence/commerce/notices', {
    method: 'GET', headers: { 'x-dds-user-jwt': 'jwt' },
  });

  {
    const calls = installNoticesFetch([
      { id: NID, kind: 'deletion_requested', period: 'once', headline: 'h', body: 'b' },
      { id: 'n-2', kind: 'capacity', period: '2026-08', headline: 'h', body: 'b' },
    ]);
    const r = await handleCommerce(getNotices(), '/commerce/notices', 'GET', CALLER, CORS);
    const out = (await r.json()).data.notices;
    ok('F3: the plum card is told a protected notice cannot be dismissed',
      out[0] && out[0].dismissible === false, JSON.stringify(out[0]));
    ok('F3: …and an ordinary one can', out[1] && out[1].dismissible === true, JSON.stringify(out[1]));
    ok('F3: the read asks for `period` (without it the invremind rule is unenforceable here)',
      calls.some((c) => c.url.includes('presence_plan_notices') && /select=id,kind,period,/.test(c.url)));
  }
  {
    // an unpaid invoice reminder reaching this card is refused with NO write
    const calls = installNoticesFetch([{ id: NID, kind: 'deal_followup', period: 'invremind:inv-1' }]);
    const r = await handleCommerce(new Request('https://x/functions/v1/presence/commerce/notices/dismiss', {
      method: 'POST', body: JSON.stringify({ id: NID }), headers: { 'content-type': 'application/json' },
    }), '/commerce/notices/dismiss', 'POST', CALLER, CORS);
    ok('F3: the dismiss route still refuses money, and writes nothing',
      r.status === 409 && patchNotice(calls).length === 0, `status ${r.status}`);
  }
} finally { globalThis.fetch = realFetch; }

// ═══════════════════════════════════════════════════════════════════════════
// F4 — the four client_* kinds must still PUSH (row-silent ≠ notification-silent)
// ═══════════════════════════════════════════════════════════════════════════
// Making them silent-ledger rows gated the push on `status === 'active'` and
// silently killed the most time-sensitive operator notification in the product.
// Push is about REACHING the owner; status is about whether a ROW is drawn. They
// are different questions and must be different flags.
const { raiseNotice } = await import('../../supabase/functions/presence/lib/notice.ts');

function installPushProbe() {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init.method || 'GET').toUpperCase();
    let body = null; try { body = init.body ? JSON.parse(init.body) : null; } catch { /* */ }
    calls.push({ url, method, body });
    if (url.includes('presence_plan_notices')) return jr([{ id: 'n-1' }], 201);   // created
    if (url.includes('presence_push_subscriptions')) return jr([]);               // no devices; the ATTEMPT is the signal
    return jr([]);
  };
  return calls;
}
const pushed = (calls) => calls.some((c) => c.url.includes('presence_push_subscriptions'));

try {
  for (const kind of ['client_message', 'client_upload', 'client_request', 'client_approval']) {
    const calls = installPushProbe();
    await raiseNotice({
      siteId: SITE.id, clientId: CLIENT, kind, period: 'thread:1:0',
      status: 'dismissed', push: true, headline: 'A client wrote', body: 'x',
    });
    await settle();
    ok(`F4: '${kind}' still reaches the owner's device even as a silent-ledger row`, pushed(calls));
  }
  {
    // the default is unchanged: a silent-ledger row does NOT push unless asked
    const calls = installPushProbe();
    await raiseNotice({ siteId: SITE.id, clientId: CLIENT, kind: 'deal_followup', period: 'remind:doc-1', status: 'dismissed', headline: 'h', body: 'b' });
    await settle();
    ok('F4: a silent-ledger row with no explicit push stays silent (the doc reminder must not buzz)', !pushed(calls));
  }
  {
    const calls = installPushProbe();
    await raiseNotice({ siteId: SITE.id, clientId: CLIENT, kind: 'support_aging', period: 'p', headline: 'h', body: 'b' });
    await settle();
    ok('F4: an ordinary ACTIVE notice still pushes (the default is unchanged)', pushed(calls));
  }
  {
    // push:false must be able to silence an active row too — the flag is explicit
    const calls = installPushProbe();
    await raiseNotice({ siteId: SITE.id, clientId: CLIENT, kind: 'support_aging', period: 'p', push: false, headline: 'h', body: 'b' });
    await settle();
    ok('F4: push is an explicit option, not a derivation of status', !pushed(calls));
  }
  {
    // a re-raise (conflict → no new row) never re-pushes, whatever the flag says
    const calls = [];
    globalThis.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      calls.push({ url, method: (init.method || 'GET').toUpperCase(), body: null });
      if (url.includes('presence_plan_notices')) return jr([], 201);   // conflict → created=false
      return jr([]);
    };
    await raiseNotice({ siteId: SITE.id, clientId: CLIENT, kind: 'client_message', period: 'thread:1:0', status: 'dismissed', push: true, headline: 'h', body: 'b' });
    await settle();
    ok('F4: a repeat raise inside the throttle window never re-pushes', !pushed(calls));
  }
} finally { globalThis.fetch = realFetch; }

// F4 at the source — notifyStudioOfClientAction must actually ask for the push
try {
  const { notifyStudioOfClientAction } = await import('../../supabase/functions/presence/lib/service_bridge.ts');
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init.method || 'GET').toUpperCase();
    let body = null; try { body = init.body ? JSON.parse(init.body) : null; } catch { /* */ }
    calls.push({ url, method, body });
    if (url.includes('api.resend.com')) return jr({ id: 're_1' });
    if (url.includes('presence_projects')) return jr([{ id: 'p-1', title: 'Acme site', client_id: 'cust-1', site_id: AGENCY }]);
    if (url.includes('presence_sites')) return jr([{ id: AGENCY, client_id: CLIENT }]);
    if (url.includes('presence_plan_notices')) return jr([{ id: 'n-1' }], 201);
    if (url.includes('presence_push_subscriptions')) return jr([]);
    if (url.includes('clients')) return jr([{ id: CLIENT, name: 'Acme', email: 'eric@studio.test' }]);
    return jr([]);
  };
  await notifyStudioOfClientAction({
    agencySiteId: AGENCY, projectId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    kind: 'client_message', threadKey: 'thread:1', subject: 'Hello', excerpt: 'hi', href: '/inbox.html',
  }).catch(() => {});
  await settle();
  const ins = calls.filter((c) => c.url.includes('presence_plan_notices') && c.method === 'POST');
  ok('F4: notifyStudioOfClientAction still writes the silent-ledger row (throttle key intact)',
    ins.length === 1 && ins[0].body && ins[0].body.status === 'dismissed', JSON.stringify(ins[0]?.body));
  ok('F4: …and the row-silent client notice still reaches the owner’s device', pushed(calls));
} finally { globalThis.fetch = realFetch; }

{
  const bridge = read('supabase/functions/presence/lib/service_bridge.ts');
  ok('F4: the bridge asks for the push EXPLICITLY (never inferred from status)', /push: true/.test(bridge));
  const life = read('supabase/functions/presence/commerce/lifecycle.ts');
  const remind = (life.match(/const fresh = await raiseNotice\(\{[^}]*remind:\$\{doc\.id\}[\s\S]{0,300}?\}\);/) || [''])[0];
  ok('F4: the doc reminder does NOT ask for a push (status, not an ask)', remind.length > 0 && !/push:\s*true/.test(remind), remind.slice(0, 120));
}

// ═══════════════════════════════════════════════════════════════════════════
// F5 — clearNoticePrefix must not be able to inherit a LIKE wildcard
// ═══════════════════════════════════════════════════════════════════════════
// `period=like.${encodeURIComponent(prefix)}*` — encodeURIComponent leaves
// `_ * ! ~ ' ( ) - .` alone, and PostgREST's `like` reads BOTH `*` and `_` as
// wildcards. Safe today only because the single caller passes a twice-gated
// UUID. A second caller must not inherit a wildcard by accident.
const { clearNoticePrefix } = await import('../../supabase/functions/presence/lib/notice.ts');
try {
  const run = async (prefix) => {
    const calls = [];
    globalThis.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      calls.push({ url, method: (init.method || 'GET').toUpperCase() });
      return jr(null, 204);
    };
    await clearNoticePrefix(CLIENT, 'support_aging', prefix);
    return patchNotice(calls);
  };

  {
    const p = await run(`support:${REQ}:`);
    ok('F5: the ordinary internal prefix still clears every weekly bucket',
      p.length === 1 && /period=like\./.test(p[0].url) && p[0].url.includes(encodeURIComponent(`support:${REQ}:`)), p[0]?.url || 'no write');
  }
  {
    // a `_` in the literal must not become a single-character wildcard
    const p = await run('support_x:');
    const url = p[0]?.url || '';
    const like = (url.match(/period=like\.([^&]*)/) || [])[1] || '';
    ok('F5: a literal `_` is escaped, never left as a single-char LIKE wildcard',
      p.length === 0 || !/(^|[^\\%5C])_/i.test(decodeURIComponent(like).replace(/\*$/, '')), like);
  }
  {
    // an embedded `*` must never widen the clear to every row of the kind
    const p = await run('support:*:');
    ok('F5: an embedded `*` cannot widen the clear (refused, or escaped — never a blanket wipe)',
      p.length === 0 || !/\*.+\*$/.test(decodeURIComponent((p[0].url.match(/period=like\.([^&]*)/) || [])[1] || '')),
      p[0]?.url || 'refused');
  }
  {
    const p = await run('sup,port:(x):');
    ok('F5: PostgREST filter grammar (`,` `(` `)`) can never reach the filter — the clear is refused instead',
      p.length === 0, p[0]?.url || '');
  }
  {
    const p = await run('');
    ok('F5: an empty prefix is refused outright (it would clear EVERY row of the kind)', p.length === 0, p[0]?.url || '');
  }
} finally { globalThis.fetch = realFetch; }

// ═══════════════════════════════════════════════════════════════════════════
// F6 — legacy `support:<id>` rows must clear too
// ═══════════════════════════════════════════════════════════════════════════
// Before the weekly bucket the period was the EXACT string `support:<id>`.
// `LIKE 'support:<id>:%'` never matches it, so every row raised before this
// deploy is orphaned — permanently "Waiting on you" for work that is done.
const { handleSupportOne } = await import('../../supabase/functions/presence/routes/service_intake.ts');
const STAFF = { kind: 'staff', userId: 'op-1', email: 'eric@studio.test', jwt: 'jwt' };
try {
  const base = { id: REQ, site_id: SITE.id, status: 'open', priority: 'normal', project_id: null, requester: 'jane@acme.com' };
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init.method || 'GET').toUpperCase();
    let body = null; try { body = init.body ? JSON.parse(init.body) : null; } catch { /* */ }
    calls.push({ url, method, body });
    if (url.includes('presence_support_requests') && method === 'GET') return jr([base]);
    if (url.includes('presence_support_requests') && method === 'PATCH') return jr([{ ...base, status: 'resolved' }]);
    return jr([]);
  };
  await handleSupportOne(new Request('https://x/functions/v1/presence/support/' + REQ, {
    method: 'PATCH', body: JSON.stringify({ status: 'resolved' }), headers: { 'content-type': 'application/json' },
  }), 'jwt', SITE, STAFF, REQ, CORS);
  const p = patchNotice(calls);
  ok('F6: resolving clears the WEEKLY buckets (period prefix)',
    p.some((c) => /period=like\./.test(c.url) && c.url.includes(encodeURIComponent(`support:${REQ}:`))), p.map((c) => c.url).join(' | '));
  ok('F6: …AND the legacy exact period raised before the weekly bucket existed',
    p.some((c) => c.url.includes(`period=eq.${encodeURIComponent(`support:${REQ}`)}`) && !/period=eq\.[^&]*%3A(?:&|$)/.test(c.url)),
    p.map((c) => c.url).join(' | '));
  ok('F6: both clears stay scoped to this client + kind + active rows',
    p.length >= 2 && p.every((c) => c.url.includes(`client_id=eq.${CLIENT}`) && c.url.includes('kind=eq.support_aging') && c.url.includes('status=eq.active')));
  ok('F6: the trailing colon stays load-bearing — support:abc: never reaches support:abcd:',
    p.every((c) => !/period=like\.support%3A(?:[0-9a-f-]+)(?:\*|$)/.test(c.url)));
  // and the wrong transition still clears nothing at all
  const calls2 = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init.method || 'GET').toUpperCase();
    calls2.push({ url, method, body: null });
    if (url.includes('presence_support_requests') && method === 'GET') return jr([base]);
    if (url.includes('presence_support_requests') && method === 'PATCH') return jr([{ ...base, status: 'in_progress' }]);
    return jr([]);
  };
  await handleSupportOne(new Request('https://x/functions/v1/presence/support/' + REQ, {
    method: 'PATCH', body: JSON.stringify({ status: 'in_progress' }), headers: { 'content-type': 'application/json' },
  }), 'jwt', SITE, STAFF, REQ, CORS);
  ok('F6: neither clear fires on a non-resolving transition', patchNotice(calls2).length === 0);
} finally { globalThis.fetch = realFetch; }

// ═══════════════════════════════════════════════════════════════════════════
// F7 — the money guard must fail CLOSED on a missing period
// ═══════════════════════════════════════════════════════════════════════════
// noticeDismissible('deal_followup', null) returned TRUE: the route 200s and
// WRITES. Unreachable today only because `period` is `text not null` (migration
// 0037) and `kind` is CHECK-constrained. A money guard must not depend on a DB
// constraint holding somewhere else.
{
  for (const p of [null, undefined, '']) {
    ok(`F7: deal_followup with period=${JSON.stringify(p)} fails CLOSED (never hides an unpaid invoice)`,
      noticeDismissible('deal_followup', p) === false);
  }
  ok('F7: a deal_followup WITH a period is still judged on the period, not blanket-refused',
    noticeDismissible('deal_followup', 'deal:d-1') === true && noticeDismissible('deal_followup', 'remind:doc-1') === true);
  ok('F7: other kinds are unaffected by the missing-period rule',
    noticeDismissible('support_aging', null) === true && noticeDismissible('invoice_paid', undefined) === true);
  ok('F7: garbage still never accidentally protects an ordinary row',
    noticeDismissible(undefined, undefined) === true);
}

// F7 behavioural — the route refuses it too
try {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init.method || 'GET').toUpperCase();
    let body = null; try { body = init.body ? JSON.parse(init.body) : null; } catch { /* */ }
    calls.push({ url, method, body });
    if (url.includes('presence_sites')) return jr([SITE]);
    if (url.includes('presence_plan_notices') && method === 'GET') return jr([{ id: NID, kind: 'deal_followup', period: null }]);
    if (url.includes('presence_plan_notices')) return jr(null, 204);
    return jr([]);
  };
  const r = await handleCommerce(new Request('https://x/functions/v1/presence/commerce/notices/dismiss', {
    method: 'POST', body: JSON.stringify({ id: NID }), headers: { 'content-type': 'application/json' },
  }), '/commerce/notices/dismiss', 'POST', CALLER, CORS);
  ok('F7: a period-less deal_followup is REFUSED by the route, with no write',
    r.status === 409 && patchNotice(calls).length === 0, `status ${r.status}`);
} finally { globalThis.fetch = realFetch; }

// ═══════════════════════════════════════════════════════════════════════════
// F8/F9 — the two notes the review asked to be carried, pinned as comments
// ═══════════════════════════════════════════════════════════════════════════
{
  const sales = read('supabase/functions/presence/routes/sales.ts');
  const call = "if (docId) await clearNotice(site.client_id, 'deal_followup', `remind:${docId}`)";
  const i = sales.indexOf(call);
  const ctx = i > 0 ? sales.slice(Math.max(0, i - 800), i) : '';
  ok('F8: the remind: clear says out loud that it is now a no-op for new rows (belt-and-braces for pre-existing ones)',
    i > 0 && /belt-and-braces|no-op/i.test(ctx) && /silent ledger|'dismissed'/i.test(ctx), ctx.slice(-160));
}

const passed = results.filter(Boolean).length;
console.log(`\n════ NEEDS-YOU R-FIXES (F1-F7): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
