// ── Operator notifications · REVIEW FIXES (F1-F6, F8) ────────────────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/operator_notify_fixes_test.mjs
//
// The feature suite (operator_notify_test.mjs) pins WHAT the notification does.
// This suite pins the seven defects a rigorous review of 37b186e..2640510 found
// in HOW it does it — each one a behaviour Eric would feel:
//
//   F1  the bell badge double-counted every client action (a notice AND an
//       event) and the notice half never cleared → a permanently-rising badge.
//   F2  a client's chatter hijacked the plum "outgrown your plan" card, so
//       "New message from Acme Bakery" shipped with a See-plans → pricing CTA.
//   F3  the notify was an un-awaited ~10-hop chain the edge isolate could tear
//       down before the mail left — silent non-delivery for a mail feature.
//   F4  AGENCY_SITE_ID was undocumented in the env manifest.
//   F5  the throttle comment promised more than the request path delivers.
//   F6  a STUDIO-side approval decision inflated the Inbox conversation count,
//       and a client APPROVING flipped a thread to "needs reply".
//   F8  the e2e "coverage" restated its own stub — it passed with the server
//       change fully reverted. Replaced by the pure shaping tests below.
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));

// env before any module load (the bridge reads env at module scope)
const AGENCY = '11111111-1111-4111-8111-111111111111';
const OWNER_CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CUSTOMER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROJECT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');
Deno.env.set('RESEND_KEY', 'test-resend-key');
Deno.env.set('RESEND_INBOUND_DOMAIN', 'inbound.example.com');
Deno.env.set('PLATFORM_REPLY_TO', 'eric@davisdigitalstudio.com');
Deno.env.set('OPS_ALERT_EMAIL', 'ops@davisdigitalstudio.com');
Deno.env.set('AGENCY_SITE_ID', AGENCY);

const { studioBellCount, shapeClientConversations, CLIENT_ACTIVITY_NOTICE_KINDS } =
  await import('../../supabase/functions/presence/lib/inbox_feed.ts');
const { notifyStudioOfClientAction, deliverStudioNotification } =
  await import('../../supabase/functions/presence/lib/service_bridge.ts');

// ═══════════ F1 · the badge counts each client action ONCE, and CLEARS ═══════
// The repro the reviewer wrote: N client actions, then the operator opens the
// activity list (the read mark advances). The badge must land back where it
// started — the notice rows still exist (they are the email throttle key) but
// they must not inflate the count, because the event/support half already does.
{
  const baseInput = () => ({
    notices: [
      { kind: 'publish_failed' },      // a real, separately-counted needs-you item
      { kind: 'domain_expiry' },
    ],
    newEnquiries: 0, proposedPlans: 0, proposedWrites: 0, filesPending: 0, openFeedback: 0,
    openSupport: 0, clientEvents: [], lastSeenAt: null,
  });
  const before = studioBellCount(baseInput());
  ok('F1: baseline badge counts the genuine notices', before === 2);

  // three client actions: each writes an EVENT and a client_* NOTICE
  const T = ['2026-02-01T10:00:00Z', '2026-02-01T10:05:00Z', '2026-02-01T10:09:00Z'];
  const acted = {
    ...baseInput(),
    notices: [...baseInput().notices,
      { kind: 'client_message' }, { kind: 'client_upload' }, { kind: 'client_approval' }],
    clientEvents: T.map((t) => ({ created_at: t, detail: { from: 'client' } })),
  };
  const during = studioBellCount(acted);
  ok('F1: three client actions raise the badge by exactly three (not six)', during === before + 3, `got ${during}, expected ${before + 3}`);

  // the operator reads the activity list → presence_activity_reads advances
  const after = studioBellCount({ ...acted, lastSeenAt: '2026-02-01T11:00:00Z' });
  ok('F1: after the read mark advances the badge returns to its pre-action value', after === before, `got ${after}, expected ${before}`);

  // an OPEN support request is the client_request notice's other half — one signal
  const req = studioBellCount({
    ...baseInput(),
    notices: [...baseInput().notices, { kind: 'client_request' }],
    openSupport: 1,
  });
  ok('F1: a client request counts once (the open support row), not twice', req === before + 1, `got ${req}`);

  ok('F1: the four client_* kinds are the excluded set (and only those four)',
    ['client_message', 'client_upload', 'client_request', 'client_approval'].every((k) => CLIENT_ACTIVITY_NOTICE_KINDS.has(k))
    && CLIENT_ACTIVITY_NOTICE_KINDS.size === 4);

  // the lead_followup dedupe (FIX 1) must survive the new filter untouched
  const leads = studioBellCount({ ...baseInput(), notices: [...baseInput().notices, { kind: 'lead_followup' }], newEnquiries: 1 });
  ok('F1: the lead_followup ↔ new-enquiry dedupe still holds', leads === before + 1, `got ${leads}`);

  const ws = read('supabase/functions/presence/routes/workspace.ts');
  ok('F1: the route computes the badge through the ONE pure helper', /studioBellCount\(/.test(ws));
  // (the select may carry MORE columns — `period` joined it so the feed can mark
  //  money/legal rows undismissable — but the rendering fields must all still be read)
  ok('F1: the notice rows are STILL read + still surface in the bell rail', /presence_plan_notices\?site_id=eq\.\$\{site\.id\}&status=eq\.active&select=id,kind,(?:period,)?headline,body/.test(ws));
}

// the notice must still exist as the EMAIL THROTTLE KEY — excluding it from the
// badge must not have turned into "stop writing the notice".
{
  const realFetch = globalThis.fetch;
  const jr = (d, s = 200) => new Response(d === null ? '' : JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });
  const sent = []; let first = true;
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init.method || 'GET').toUpperCase();
    let body = null; try { body = init.body ? JSON.parse(init.body) : null; } catch { /* */ }
    if (url.includes('api.resend.com/emails')) { sent.push(body); return jr({ id: 're_1' }); }
    if (url.includes('presence_plan_notices') && method === 'POST') { const c = first; first = false; return jr(c ? [{ id: 'n1' }] : [], 201); }
    if (url.includes('presence_sites')) return jr([{ id: AGENCY, client_id: OWNER_CLIENT }]);
    if (url.includes('presence_identity')) return jr([{ business_name: 'DDS', email: 'studio@davisdigitalstudio.com' }]);
    if (url.includes('presence_projects')) return jr([{ id: PROJECT, name: 'Website refresh' }]);
    if (url.includes('clients?id=eq.')) return jr([{ id: CUSTOMER, name: 'Acme Bakery', email: 'jane@acme.com' }]);
    return jr([]);
  };
  const args = { agencySiteId: AGENCY, kind: 'client_message', threadKey: `proj:${PROJECT}`, customerClientId: CUSTOMER, projectId: PROJECT, subject: 'Hi', excerpt: 'hello', href: '/inbox.html' };
  const a = await deliverStudioNotification(args);
  const b = await deliverStudioNotification(args);
  ok('F1: the notice still throttles — a second action in the window sends NO second email', a === true && b === false && sent.length === 1);
  globalThis.fetch = realFetch;
}

// ═══════════ F2 · client chatter must never render the plan-upgrade card ═════
{
  const presence = read('presence.html');
  const fn = presence.slice(presence.indexOf('async function renderPlanNotice'), presence.indexOf('// ── L1: first-run welcome'));
  ok('F2: renderPlanNotice filters the client-activity kinds out of its candidates', /PLAN_CARD_EXCLUDE|NOTICE_NOT_PLAN_CARD/.test(fn));
  // the exclusion list itself must name all four, and must live where the
  // fallback `notices[0]` can see it (the fallback is how they leaked in).
  const excl = presence.slice(presence.indexOf('NOTICE_PRIORITY ='), presence.indexOf('// ── L1: first-run welcome'));
  ok('F2: all four client_* kinds are excluded',
    ['client_message', 'client_upload', 'client_request', 'client_approval'].every((k) => new RegExp(`"${k}"`).test(excl)));
  ok('F2: the exclusion is applied BEFORE the notices[0] fallback (the actual leak)',
    /notices = [^;]*filter\(/.test(fn) || /const candidates =[^;]*filter\(/.test(fn));
  ok('F2: the See-plans → pricing.html default CTA is still the fallback for real plan notices',
    /label: "See plans", *href: "pricing\.html"/.test(fn) || /label: 'See plans'/.test(fn));
  // /commerce/notices has exactly ONE consumer — this card — and it reads only
  // the top 3 active notices. So the same exclusion belongs there too, or a
  // chatty client crowds a real payment_trouble notice out of the window before
  // the card ever sees it. The BELL is unaffected: it reads its notices from
  // /portal/feed, which is deliberately left unfiltered.
  const commerce = read('supabase/functions/presence/routes/commerce.ts');
  ok('F2: the /commerce/notices read excludes the four kinds (its limit-3 window can’t be crowded out)',
    /presence_plan_notices\?site_id=eq\.\$\{site\.id\}&status=eq\.active&kind=not\.in\.\(client_message,client_upload,client_request,client_approval\)/.test(commerce));
  const ws = read('supabase/functions/presence/routes/workspace.ts');
  ok('F2: the BELL rail read is NOT filtered — the notices still surface there',
    /noticeQ|presence_plan_notices\?site_id=eq\.\$\{site\.id\}&status=eq\.active&select=id,kind,headline,body,created_at/.test(ws)
    && !/status=eq\.active&kind=not\.in/.test(ws));
}

// ═══════════ F3 · delivery survives the response ════════════════════════════
{
  const realFetch = globalThis.fetch;
  const jr = (d, s = 200) => new Response(d === null ? '' : JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });
  const install = (opts = {}) => {
    const sent = []; const calls = [];
    globalThis.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      calls.push(url);
      if (url.includes('api.resend.com/emails')) {
        if (opts.hang) return await new Promise(() => {});   // a hung Resend
        let body = null; try { body = init.body ? JSON.parse(init.body) : null; } catch { /* */ }
        sent.push(body); return jr({ id: 're_1' });
      }
      if (url.includes('presence_plan_notices')) return jr([{ id: 'n1' }], 201);
      if (url.includes('presence_sites')) return jr([{ id: AGENCY, client_id: OWNER_CLIENT }]);
      if (url.includes('presence_identity')) return jr([{ business_name: 'DDS', email: 'studio@davisdigitalstudio.com' }]);
      if (url.includes('presence_projects')) return jr([{ id: PROJECT, name: 'Website refresh' }]);
      if (url.includes('clients?id=eq.')) return jr([{ id: CUSTOMER, name: 'Acme Bakery' }]);
      return jr([]);
    };
    return { sent, calls };
  };
  const args = () => ({ agencySiteId: AGENCY, kind: 'client_message', threadKey: `proj:${PROJECT}:${Math.random()}`, customerClientId: CUSTOMER, projectId: PROJECT, subject: 'Hi', excerpt: 'hello', href: '/inbox.html' });

  // (a) the waitUntil path — used whenever the edge global exists
  {
    const { sent } = install();
    const held = [];
    globalThis.EdgeRuntime = { waitUntil: (p) => { held.push(p); } };
    const t0 = Date.now();
    await notifyStudioOfClientAction(args());
    const elapsed = Date.now() - t0;
    ok('F3: EdgeRuntime.waitUntil is used when the global exists — the send is handed off', held.length === 1);
    ok('F3: handing off costs the client request nothing (returns immediately)', elapsed < 200, `${elapsed}ms`);
    await held[0];
    ok('F3: the handed-off work really sends the email', sent.length === 1);
    delete globalThis.EdgeRuntime;
  }

  // (b) no edge runtime → the work is AWAITED inline, so it can't be torn down
  {
    const { sent } = install();
    ok('F3: without EdgeRuntime the global is genuinely absent', typeof globalThis.EdgeRuntime === 'undefined');
    await notifyStudioOfClientAction(args());
    ok('F3: the fallback awaits inline — the email has landed by the time it returns', sent.length === 1);
  }

  // (c) a hung Resend must not stall the client's response past the cap
  {
    const { sent } = install({ hang: true });
    const t0 = Date.now();
    let threw = false;
    try { await notifyStudioOfClientAction(args(), 120); } catch { threw = true; }
    const elapsed = Date.now() - t0;
    ok('F3: a hung email is capped — the client request is never stalled', elapsed < 1500, `${elapsed}ms`);
    ok('F3: the cap does not throw and does not fake a send', !threw && sent.length === 0);
  }

  // (d) total infrastructure failure still never reaches the client's request
  {
    globalThis.fetch = async () => { throw new Error('network down'); };
    let threw = false;
    try { await notifyStudioOfClientAction(args()); } catch { threw = true; }
    ok('F3: a total failure resolves quietly — the client request always succeeds', !threw);
  }
  globalThis.fetch = realFetch;

  const br = read('supabase/functions/presence/lib/service_bridge.ts');
  ok('F3: waitUntil is feature-detected, never assumed', /typeof EdgeRuntime !== 'undefined'|EdgeRuntime[\s\S]{0,80}typeof[\s\S]{0,40}waitUntil/.test(br) || /waitUntil === 'function'/.test(br));
  ok('F3: studioRecipient reads its independent rows in ONE wave (Promise.all)',
    /Promise\.all/.test(br.slice(br.indexOf('async function studioRecipient'), br.indexOf('const HEADLINE'))));
  ok('F3: the worker fans its independent hops out in one wave too',
    (br.slice(br.indexOf('export async function deliverStudioNotification')).match(/Promise\.all/g) || []).length >= 1);
  // every call site must go through the dispatcher and AWAIT it (an un-awaited
  // fallback keeps nothing alive — that is the whole defect).
  for (const f of ['routes/client_delivery.ts', 'routes/inbound_email.ts']) {
    const src = read(`supabase/functions/presence/${f}`);
    const bare = (src.match(/(?<!await )notifyStudioOfClientAction\(/g) || []).length;
    ok(`F3: every notify call site in ${f} is awaited`, bare === 0, `${bare} un-awaited`);
    ok(`F3: no call site calls the worker directly in ${f}`, !/deliverStudioNotification\(/.test(src));
  }
}

// ═══════════ F4 · AGENCY_SITE_ID is documented ══════════════════════════════
{
  const sys = read('supabase/functions/presence/routes/system.ts');
  const email = sys.slice(sys.indexOf('  email: ['), sys.indexOf('  hosting: ['));
  ok('F4: AGENCY_SITE_ID appears in the env manifest, in the email group beside OPS_ALERT_EMAIL',
    /AGENCY_SITE_ID/.test(email) && /OPS_ALERT_EMAIL/.test(email));
  ok('F4: it is documented as OPTIONAL', /name: 'AGENCY_SITE_ID', required: false/.test(email));
  ok('F4: its description is honest about what it enables (the OPS fallback, agency site only)',
    /AGENCY_SITE_ID[\s\S]{0,200}OPS_ALERT_EMAIL/.test(email) && /agency site/i.test(email.slice(email.indexOf('AGENCY_SITE_ID'))));
  const br = read('supabase/functions/presence/lib/service_bridge.ts');
  const doc = br.slice(br.indexOf('/** Resolve WHO at the studio'), br.indexOf('async function studioRecipient'));
  ok('F4: the helper comment states rung 1 (presence_identity.email) WINS over rung 2',
    /wins/i.test(doc) && /presence_identity\.email/.test(doc));
}

// ═══════════ F5 · the throttle contract is stated precisely ═════════════════
{
  const br = read('supabase/functions/presence/lib/service_bridge.ts');
  const doc = br.slice(br.indexOf('/** THROTTLE WINDOW'), br.indexOf('const BUCKET_MS'));
  // The old header ASSERTED "one email per conversation per quarter-hour" as the
  // contract. The phrase may still appear — but only as the claim being retracted.
  ok('F5: the blanket "one email per conversation per quarter-hour" claim is explicitly retracted',
    !/one email per conversation per quarter-hour/.test(doc)
    || /NOT "one email per conversation per quarter-hour"/.test(doc));
  ok('F5: it names the UPLOAD/message guarantee that genuinely holds (one project thread)',
    /(six|N) files?[\s\S]{0,120}ONE email/i.test(doc) || /one email per PROJECT thread/i.test(doc));
  ok('F5: it states the honest exception — a NEW service request mints a new thread, so N requests = N emails',
    /new request/i.test(doc) && /(N requests|its own email|each .*its own)/i.test(doc));
}

// ═══════════ F6 · studio actions never inflate the client conversation ══════
// The shaping logic the Inbox row is built from, extracted so it is testable at
// all (the e2e that "covered" it restated its own stub — F8).
{
  const ev = (over) => ({ project_id: PROJECT, kind: 'message', created_at: '2026-02-01T10:00:00Z', detail: { from: 'client' }, ...over });
  const row = (events) => shapeClientConversations(events).get(PROJECT);

  // baseline: two client messages + one studio reply = a 3-message conversation
  {
    const r = row([
      ev({ created_at: '2026-02-01T12:00:00Z', detail: { from: 'studio' } }),
      ev({ created_at: '2026-02-01T11:00:00Z' }),
      ev({ created_at: '2026-02-01T10:00:00Z' }),
    ]);
    ok('F6: a message thread counts both directions (unchanged)', r.count === 3);
    ok('F6: the studio answered last → the thread does NOT need a reply', r.needsReply === false);
    ok('F6: latest client activity is the client’s newest message', r.latestClientAt === '2026-02-01T11:00:00Z');
  }

  // THE DEFECT: a STUDIO-side approval decision (projectEvent stamps no `from`)
  {
    const client = [ev({ created_at: '2026-02-01T10:00:00Z' })];
    const withStudioApproval = [
      ev({ kind: 'approval_decided', created_at: '2026-02-01T12:00:00Z', detail: { approval_id: 'x', decision: 'approved' } }),
      ...client,
    ];
    ok('F6: a STUDIO approval decision does not inflate the conversation count',
      row(withStudioApproval).count === row(client).count, `${row(withStudioApproval).count} vs ${row(client).count}`);
    ok('F6: a thread that is ONLY studio-side activity produces no conversation row at all',
      shapeClientConversations([ev({ kind: 'approval_decided', detail: { decision: 'approved' } })]).size === 0);
  }

  // the client's own actions DO count (that is the whole point of the widening)
  {
    const r = row([
      ev({ kind: 'client_upload', created_at: '2026-02-01T11:00:00Z', detail: { from: 'client', title: 'menu.pdf' } }),
      ev({ created_at: '2026-02-01T10:00:00Z' }),
    ]);
    ok('F6: a CLIENT upload folds into its project conversation (count spans the thread)', r.count === 2);
    ok('F6: an unanswered client upload needs a reply', r.needsReply === true);
  }

  // needs_reply: a clean approval is not a question
  {
    const approved = row([
      ev({ kind: 'approval_decided', created_at: '2026-02-01T12:00:00Z', detail: { from: 'client', decision: 'approved' } }),
      ev({ created_at: '2026-02-01T11:00:00Z', detail: { from: 'studio' } }),
    ]);
    ok('F6: a client APPROVING cleanly does NOT flip the thread to needs-reply', approved.needsReply === false);
    ok('F6: …but it still counts, and still marks client activity', approved.count === 2 && approved.latestClientAt === '2026-02-01T12:00:00Z');

    const changes = row([
      ev({ kind: 'approval_decided', created_at: '2026-02-01T12:00:00Z', detail: { from: 'client', decision: 'changes_requested' } }),
      ev({ created_at: '2026-02-01T11:00:00Z', detail: { from: 'studio' } }),
    ]);
    ok('F6: a REJECTION / change-request DOES need a reply', changes.needsReply === true);

    const done = row([
      ev({ kind: 'task_done', created_at: '2026-02-01T12:00:00Z', detail: { from: 'client', title: 'Send logo' } }),
      ev({ created_at: '2026-02-01T11:00:00Z', detail: { from: 'studio' } }),
    ]);
    ok('F6: a client ticking a to-do is progress, not a question (no needs-reply)', done.needsReply === false && done.count === 2);
  }

  // an older unanswered question survives a newer non-question
  {
    const r = row([
      ev({ kind: 'task_done', created_at: '2026-02-01T12:00:00Z', detail: { from: 'client' } }),
      ev({ created_at: '2026-02-01T11:00:00Z' }),
    ]);
    ok('F6: an older unanswered client MESSAGE keeps needs-reply through a later to-do tick', r.needsReply === true);
  }

  const ws = read('supabase/functions/presence/routes/workspace.ts');
  ok('F6: the Inbox conversation rows are shaped by the ONE pure helper', /shapeClientConversations\(/.test(ws));
  ok('F6: the events read selects `kind` (the shaper needs it to tell the widened kinds apart)',
    /presence_project_events\?site_id=eq\.\$\{site\.id\}&kind=in\.\([^)]*\)&select=project_id,kind,detail,created_at/.test(ws));
}

// ═══════════ F8 · the tautological e2e is gone ══════════════════════════════
{
  const spec = read('tests/e2e/inbox.spec.ts');
  ok('F8: the stub-restating e2e ("an upload folds into its project conversation row") is replaced',
    !/an upload folds into its project conversation row/.test(spec));
  ok('F8: its genuine sibling (unknown notice kinds must still render) is kept',
    /the new client-activity notice kinds render as rows/.test(spec));
}

// ═══════════════════════════════ summary ════════════════════════════════════
const failed = results.filter((r) => !r).length;
console.log(`\n──── operator notification review fixes: ${results.length - failed}/${results.length} passed ────`);
if (failed) Deno.exit(1);
