// ── Operator email notifications (client portal → the studio) ────────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/operator_notify_test.mjs
//
// Eric (the sole studio operator) gets an INSTANT, THROTTLED email when a client
// acts in the portal: a message, a file upload, a support/service request (open
// or reply), or an approval decision. This suite drives the ONE seam —
// notifyStudioOfClientAction (lib/service_bridge.ts) — behaviorally through a
// globalThis.fetch PostgREST fake (the inbound_email_test / email_infra_test
// idiom), then pins the call sites + in-app plumbing structurally.
//
// The hazards it exists to hold down:
//   • THROTTLE — six uploads in one thread must send ONE email (raiseNotice's
//     created-flag is the throttle key; period = <thread>:<15-min bucket>).
//   • REPLY-TO — an operator notification must NEVER carry opts.siteId, or the
//     reply-to becomes the INBOUND WEBHOOK address and Eric hitting Reply posts
//     his text back into /email/inbound, potentially onto a client's thread.
//   • CRITICAL — without opts.critical an opt-out silently suppresses the mail.
//   • RECIPIENT — identity → the site owner's own client email → (only for the
//     explicitly-named agency site) OPS_ALERT_EMAIL → warn + return. The
//     OPS fallback must be IMPOSSIBLE to fire for a client site.
//   • PRE-MIGRATION — the notices insert fails (0116 not applied) → no email,
//     no throw, and the client's own request still succeeds.
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));

// ── env MUST be set before importing (module-load reads) ──
const AGENCY = '11111111-1111-4111-8111-111111111111';
const OTHER_SITE = '99999999-9999-4999-8999-999999999999';
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

const { notifyStudioOfClientAction } = await import('../../supabase/functions/presence/lib/service_bridge.ts');

// ═══════════════════════ PART A · behavioral (fetch fake) ═══════════════════
const realFetch = globalThis.fetch;
const jr = (data, status = 200) => new Response(data === null ? '' : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

/** cfg:
 *   noticeCreated  false → the unique key already existed (throttled)
 *   noticeStatus   e.g. 400 → the pre-0116 CHECK-constraint rejection
 *   identityEmail  '' → no presence_identity.email for the site
 *   ownerEmail     '' → the site owner's clients row carries no email either
 *   siteClientId   null → the site has no owner client row at all
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
    if (url.includes('presence_plan_notices') && method === 'POST') {
      if (cfg.noticeStatus && cfg.noticeStatus >= 400) return jr({ code: '23514', message: 'violates check constraint "presence_plan_notices_kind_check"' }, cfg.noticeStatus);
      return jr(cfg.noticeCreated === false ? [] : [{ id: 'notice_1' }], 201);
    }
    if (url.includes('presence_sites')) return jr([{ id: AGENCY, client_id: cfg.siteClientId === null ? null : (cfg.siteClientId || OWNER_CLIENT) }]);
    if (url.includes('presence_identity')) return jr([{ business_name: 'Davis Digital Studio', email: cfg.identityEmail === undefined ? 'studio@davisdigitalstudio.com' : cfg.identityEmail }]);
    if (url.includes('presence_brand_kits') || url.includes('brand_kit')) return jr([]);
    if (url.includes(`clients?id=eq.${OWNER_CLIENT}`)) return jr([{ id: OWNER_CLIENT, name: 'Davis Digital Studio', email: cfg.ownerEmail === undefined ? 'eric@davisdigitalstudio.com' : cfg.ownerEmail, contact_email: '' }]);
    if (url.includes('clients?id=eq.')) return jr([{ id: CUSTOMER, name: 'Acme Bakery', email: 'jane@acme.com' }]);
    if (url.includes('presence_projects')) return jr([{ id: PROJECT, name: 'Website refresh' }]);
    if (url.includes('presence_push_subscriptions')) return jr([]);
    return jr([]);
  };
  return { calls, sent };
}
const restore = () => { globalThis.fetch = realFetch; };

const baseArgs = (over = {}) => ({
  agencySiteId: AGENCY, kind: 'client_message', threadKey: `proj:${PROJECT}`,
  customerClientId: CUSTOMER, projectId: PROJECT,
  subject: 'Website refresh', excerpt: 'Can we swap the hero photo?',
  href: `/crm.html?project=${PROJECT}&tab=messages`, ...over,
});

let warned = [];
const realWarn = console.warn;
const captureWarn = () => { warned = []; console.warn = (...a) => { warned.push(a.join(' ')); }; };
const releaseWarn = () => { console.warn = realWarn; };

try {
  // 1. the happy path — one notice, one email
  {
    const { sent, calls } = installFetch();
    const r = await notifyStudioOfClientAction(baseArgs());
    ok('send: a client message raises a notice AND emails the operator', r === true && sent.length === 1);
    ok('send: the email goes to the site’s presence_identity.email', sent[0]?.to === 'studio@davisdigitalstudio.com');
    const notice = calls.find((c) => c.url.includes('presence_plan_notices') && c.method === 'POST');
    ok('notice: raised on the ONE model (presence_plan_notices) with the site owner’s client_id', notice?.body?.client_id === OWNER_CLIENT && notice?.body?.site_id === AGENCY);
    ok('notice: kind is the portal kind (client_message)', notice?.body?.kind === 'client_message');
    ok('notice: period is <threadKey>:<15-minute bucket>', /^proj:[0-9a-f-]+:\d+$/.test(String(notice?.body?.period || '')));
    restore();
  }

  // 2. THROTTLE — the notice already existed (created=false) → NO email
  {
    const { sent } = installFetch({ noticeCreated: false });
    const r = await notifyStudioOfClientAction(baseArgs());
    ok('throttle: created===false (same thread + bucket) → NO email is sent', r === false && sent.length === 0);
    restore();
  }

  // 3. six uploads in one thread+bucket → exactly ONE email
  {
    let first = true;
    const { sent } = installFetch();
    const realF = globalThis.fetch;
    globalThis.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('presence_plan_notices') && (init.method || 'GET').toUpperCase() === 'POST') {
        const created = first; first = false;
        return jr(created ? [{ id: 'n1' }] : [], 201);   // the unique key absorbs the rest
      }
      return realF(input, init);
    };
    for (let i = 0; i < 6; i++) await notifyStudioOfClientAction(baseArgs({ kind: 'client_upload', subject: `file-${i}.pdf` }));
    ok('throttle: six uploads on one thread in one bucket → exactly ONE email', sent.length === 1);
    restore();
  }

  // 4. ⚠ REPLY-TO — operator mail must keep the HUMAN platform reply-to
  {
    const { sent } = installFetch();
    await notifyStudioOfClientAction(baseArgs());
    ok('reply-to: operator notification carries the HUMAN PLATFORM_REPLY_TO', sent[0]?.reply_to === 'eric@davisdigitalstudio.com');
    ok('reply-to: it is NOT the inbound webhook address (<siteId>@inbound-domain)', !String(sent[0]?.reply_to || '').includes('inbound.example.com') && !String(sent[0]?.reply_to || '').includes(AGENCY));
    restore();
  }

  // 5. critical:true — an opt-out must not silently swallow operator mail
  {
    const { calls } = installFetch();
    await notifyStudioOfClientAction(baseArgs());
    // maySend is consulted at the ONE send point; critical is what survives an
    // opt-out. Pin it structurally too (below) — behaviorally, the send happened.
    ok('critical: the send reached Resend (not suppressed)', calls.some((c) => c.url.includes('api.resend.com/emails')));
    restore();
  }

  // 6. RECIPIENT fallback chain
  {
    const { sent } = installFetch({ identityEmail: '' });
    await notifyStudioOfClientAction(baseArgs());
    ok('recipient: blank identity email falls back to the site owner’s OWN client email', sent[0]?.to === 'eric@davisdigitalstudio.com');
    restore();
  }
  {
    const { sent } = installFetch({ identityEmail: '', ownerEmail: '' });
    await notifyStudioOfClientAction(baseArgs());
    ok('recipient: identity + owner both blank → OPS_ALERT_EMAIL (named agency site only)', sent[0]?.to === 'ops@davisdigitalstudio.com');
    restore();
  }
  {
    // TENANT HAZARD: OPS_ALERT_EMAIL is the PLATFORM operator's address. It may
    // never receive a notification for a site that is not the platform's own
    // agency site — that would leak one tenant's client activity to another.
    const { sent } = installFetch({ identityEmail: '', ownerEmail: '' });
    captureWarn();
    const r = await notifyStudioOfClientAction(baseArgs({ agencySiteId: OTHER_SITE }));
    releaseWarn();
    ok('recipient: a NON-agency site NEVER falls back to OPS_ALERT_EMAIL (no misrouting)', r === false && sent.length === 0);
    ok('recipient: no recipient at all → a clear warn, and return (no throw)', warned.some((w) => /no operator recipient/i.test(w)));
    restore();
  }

  // 7. PRE-MIGRATION — the notices insert fails (0116 not applied yet)
  {
    const { sent } = installFetch({ noticeStatus: 400 });
    let threw = false; let r;
    try { r = await notifyStudioOfClientAction(baseArgs()); } catch { threw = true; }
    ok('pre-migration: a CHECK-constraint rejection → no email, no throw', !threw && r === false && sent.length === 0);
    restore();
  }

  // 8. never throws — even when every read fails outright
  {
    globalThis.fetch = async () => { throw new Error('network down'); };
    let threw = false; let r;
    try { r = await notifyStudioOfClientAction(baseArgs()); } catch { threw = true; }
    ok('resilience: a total infrastructure failure → returns false, never throws', !threw && r === false);
    restore();
  }

  // 9. one-shot events (an approval decision) skip the time bucket
  {
    const { calls } = installFetch();
    await notifyStudioOfClientAction(baseArgs({ kind: 'client_approval', threadKey: `approval:${PROJECT}`, bucket: false }));
    const notice = calls.find((c) => c.url.includes('presence_plan_notices') && c.method === 'POST');
    ok('throttle: bucket:false → the period is the bare thread key (once, forever)', notice?.body?.period === `approval:${PROJECT}`);
    restore();
  }

  // 10. the email carries who / what / a deep link
  {
    const { sent } = installFetch();
    await notifyStudioOfClientAction(baseArgs());
    const html = String(sent[0]?.html || '');
    ok('content: names the client and the project', html.includes('Acme Bakery') && html.includes('Website refresh'));
    ok('content: carries enough of the message to act on without logging in', html.includes('Can we swap the hero photo?'));
    ok('content: deep-links into the right studio surface', html.includes(`/crm.html?project=${PROJECT}&amp;tab=messages`) || html.includes(`/crm.html?project=${PROJECT}&tab=messages`));
    ok('content: the subject names the client', /Acme Bakery/.test(String(sent[0]?.subject || '')));
    restore();
  }
} finally {
  restore();
  releaseWarn();
}

// ═══════════════════════ PART B · the seam, structurally ════════════════════
const br = read('supabase/functions/presence/lib/service_bridge.ts');

ok('seam: notifyStudioOfClientAction lives in the bridge (beside the outbound helpers)', /export async function notifyStudioOfClientAction/.test(br));
ok('seam: sendEmail is called with critical:true', /sendEmail\([\s\S]{0,400}?\{ critical: true \}\)/.test(br.slice(br.indexOf('notifyStudioOfClientAction'))));
{
  // ⚠ the load-bearing assertion: the operator send must NOT pass siteId.
  const fn = br.slice(br.indexOf('export async function notifyStudioOfClientAction'));
  const send = (fn.match(/sendEmail\([^;]*?\);/s) || [''])[0];
  ok('reply-to: the operator sendEmail call NEVER passes opts.siteId (feedback-loop hazard)', send.length > 0 && !/siteId/.test(send));
  ok('reply-to: the hazard is explained in a comment beside the send', /reply/i.test(fn.slice(0, fn.indexOf(send))) && /inbound/i.test(fn.slice(0, fn.indexOf(send))));
}
ok('seam: the OPS fallback is gated on the explicitly-named agency site (AGENCY_SITE_ID)', /AGENCY_SITE_ID/.test(br));
ok('seam: raiseNotice gates the email (created===true only)', /raiseNotice/.test(br) && /created/.test(br.slice(br.indexOf('notifyStudioOfClientAction'))));

// the three existing notifiers are UNTOUCHED (adding an OPS fallback there would
// misroute a client site's booking/lead/review mail to the platform operator).
ok('scope: booking/review/lead notifiers keep identity-only recipients (no OPS fallback added)',
  !/OPS_ALERT_EMAIL/.test(read('supabase/functions/presence/routes/booking.ts'))
  && !/OPS_ALERT_EMAIL/.test(read('supabase/functions/presence/routes/reviews.ts'))
  && !/OPS_ALERT_EMAIL/.test(read('supabase/functions/presence/routes/commercial.ts')));

// ═══════════════════════ PART C · the call sites ════════════════════════════
const cd = read('supabase/functions/presence/routes/client_delivery.ts');
const ib = read('supabase/functions/presence/routes/inbound_email.ts');

const between = (src, from, to) => { const a = src.indexOf(from); const b = to ? src.indexOf(to, a) : src.length; return a < 0 ? '' : src.slice(a, b < 0 ? src.length : b); };

// `kind: 'client_upload'` also names a presence_project_events kind, so these
// assertions require the NOTIFY call itself to carry it — not a bare mention.
const notifiesWith = (block, kind) => new RegExp(`notifyStudioOfClientAction\\([^;]*kind: '${kind}'`, 's').test(block);
ok('call site: MESSAGE (handleClientMessages) notifies with kind client_message',
  notifiesWith(between(cd, 'export async function handleClientMessages', 'export async function handleClientDeliverableDownload'), 'client_message'));
ok('call site: UPLOAD (handleClientUploadCreate) notifies with kind client_upload',
  notifiesWith(between(cd, 'export async function handleClientUploadCreate', '// ═══ DOCUMENTS'), 'client_upload'));
ok('call site: APPROVAL (handleClientApprovalDecide) notifies with kind client_approval',
  notifiesWith(between(cd, 'export async function handleClientApprovalDecide', '// ═══ SURVEY view'), 'client_approval'));
{
  const sup = between(cd, 'export async function handleClientSupport(', 'async function clientSupportRow');
  ok('call site: SUPPORT OPENED notifies with kind client_request', /kind: 'client_request'/.test(sup));
  ok('call site: SUPPORT OPENED notifies OUTSIDE the if (projectId) guard (project-less is the common path)',
    !/if \(projectId\) await notifyStudioOfClientAction/.test(sup));
  ok('call site: an APPEND onto the open project-less thread notifies too (a reply is an event)',
    (sup.match(/notifyStudioOfClientAction/g) || []).length >= 2);
}
{
  const rep = between(cd, 'export async function handleClientSupportMessage', '// ═══ WEBSITE STATS');
  ok('call site: SUPPORT REPLY notifies with kind client_request', /kind: 'client_request'/.test(rep));
  ok('call site: SUPPORT REPLY notifies even when the request has no project', !/if \(reqRow\.project_id\) await notifyStudioOfClientAction/.test(rep));
}
ok('call site: SURVEY submit does NOT notify (not on the list)', !/notifyStudioOfClientAction/.test(between(cd, 'export async function handleClientSurveyRespond', '// ═══ NOTIFICATIONS')));
ok('call site: TASK DONE does NOT notify (not on the list)', !/notifyStudioOfClientAction/.test(between(cd, 'export async function handleClientTaskDone', '// ═══ BOOK A CALL')));
ok('call site: no portal-side booking notify (POST /book/:site already fires notifyOwnerOfBooking — no double email)',
  !/notifyStudioOfClientAction/.test(between(cd, 'export async function handleClientBook', '// ═══ CLIENT FILE UPLOAD')));

ok('inbound: an emailed-in PROJECT message notifies the operator', /notifyStudioOfClientAction/.test(ib) && /kind: 'client_message'/.test(ib));
ok('inbound: an emailed-in support append/create notifies the operator', (ib.match(/kind: 'client_request'/g) || []).length >= 3);

// ═══════════════════════ PART D · in-app leaks (N3) ═════════════════════════
const ws = read('supabase/functions/presence/routes/workspace.ts');
const nt = read('supabase/functions/presence/lib/notifications.ts');

ok('in-app: the bell badge filter includes client_upload + task_done', /kind=in\.\([^)]*client_upload[^)]*\)/.test(ws) && /kind=in\.\([^)]*task_done[^)]*\)/.test(ws));
{
  // the Inbox rows read (workspace.ts feed) must no longer be message-only
  const inbox = (ws.match(/presence_project_events\?site_id=eq\.\$\{site\.id\}&kind=[^&]*&select=project_id,detail,created_at/g) || [])[0] || '';
  ok('in-app: the Inbox row filter carries approval_decided + client_upload + task_done', /client_upload/.test(inbox) && /approval_decided/.test(inbox) && /task_done/.test(inbox));
}
ok('in-app: notifLabel labels client_upload + task_done (no more generic "Activity")', /client_upload:/.test(nt) && /task_done:/.test(nt));
ok('in-app: notifHref deep-links client_upload (#files) and task_done (#tasks)', /case 'client_upload'/.test(nt) && /case 'task_done'/.test(nt));
{
  const href = between(ws, 'const NOTICE_HREF', 'export const noticeHref');
  ok('in-app: noticeHref maps every NEW notice kind (bell rows deep-link)',
    ['client_message', 'client_upload', 'client_request', 'client_approval'].every((k) => href.includes(k + ':')));
}

// ═══════════════════════ PART E · the migration (N4) ════════════════════════
const mig = read('supabase/migrations/0116_operator_activity_notices.sql');
const prev = read('supabase/migrations/0102_email_auth_nudge.sql');

ok('migration: 0116 drops + re-adds the kind CHECK', /drop constraint if exists presence_plan_notices_kind_check/.test(mig) && /add constraint presence_plan_notices_kind_check/.test(mig));
ok('migration: the four new portal kinds are allowed', ['client_message', 'client_upload', 'client_request', 'client_approval'].every((k) => mig.includes(`'${k}'`)));
{
  // NEVER drop an existing kind — the full superset is carried forward.
  const kindsOf = (sql) => [...(sql.match(/'[a-z_]+'/g) || [])].map((s) => s.slice(1, -1));
  const before = new Set(kindsOf(prev.slice(prev.indexOf('check (kind in ('), prev.indexOf('));', prev.indexOf('check (kind in (')))));
  const after = new Set(kindsOf(mig.slice(mig.indexOf('check (kind in ('), mig.indexOf('));', mig.indexOf('check (kind in (')))));
  const dropped = [...before].filter((k) => !after.has(k));
  ok('migration: the FULL 0102 superset is carried forward (no kind dropped)', dropped.length === 0, dropped.join(','));
}
ok('migration: header states additive · idempotent · RLS untouched', /additive/i.test(mig) && /idempotent/i.test(mig) && /RLS/i.test(mig));
ok('migration: header states the deploy order (apply BEFORE or WITH the function deploy)', /before or with/i.test(mig));
ok('migration: header names the pre-migration degradation (no email, no crash)', /no email/i.test(mig) && /(no crash|never.*error|degrade)/i.test(mig));
ok('migration: rollback note present', /rollback/i.test(mig));

// ═══════════════════════════════ summary ════════════════════════════════════
const failed = results.filter((r) => !r).length;
console.log(`\n──── operator notifications: ${results.length - failed}/${results.length} passed ────`);
if (failed) Deno.exit(1);
