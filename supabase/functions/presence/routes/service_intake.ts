// ── Surveys & Support routes (Presence CMS Phase 2, P2-D-4) ──────────────────
// A small fixed survey (stable questions, one idempotent submission per
// respondent) + the smallest coherent support workflow (submit → triage →
// respond → resolve → reopen). Site-scoped; the studio manages, the client
// submits/replies. Project-linked items feed the ONE activity log. No form
// builder, no helpdesk, no parallel systems.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { isStudioSide, studioDenied, loadProject, projectEvent } from './projects.ts';
import { clampLimit, clampOffset } from '../lib/service_delivery.ts';
import {
  normalizeQuestions, normalizeAnswers,
  isSupportStatus, canSupportTransition, isSupportPriority, supportAgingPeriodPrefix, supportAgingLegacyPeriod,
} from '../lib/intake.ts';
import { clearNotice, clearNoticePrefix } from '../lib/notice.ts';
import { offerCsat } from '../lib/csat.ts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** The calm "we've got it" auto-acknowledgement of a NEW support request — today
 *  a submitted ticket emails no one (a real trust gap). Best-effort, transactional
 *  (survives a marketing opt-out), on the site's own email brand. Never throws. */
async function ackSupportRequester(siteId: string, toEmail: string, subject: string): Promise<void> {
  try {
    if (!EMAIL_RE.test(String(toEmail))) return;
    const { sendEmail } = await import('../commerce/account.ts');
    const { loadEmailBrand } = await import('../lib/email_brand.ts');
    const brand = await loadEmailBrand(siteId);
    await sendEmail(toEmail, subject,
      `<p>Thanks — we've got your request and it's in our queue. Nothing more is needed from you right now; we'll follow up here. You can add details or reply any time from your workspace.</p>`,
      brand, { critical: true, siteId });
  } catch { /* best-effort — an ack must never block the submission */ }
}
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (s: unknown, max = 500) => String(s ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, max);
const nowIso = () => new Date().toISOString();
const rows = (r: { json?: unknown }) => (Array.isArray((r as any).json) ? (r as any).json : []) as any[];
const readerKey = (p: Principal) => String(p.userId || p.email || 'anon');

// ═══ SURVEYS ═══
export async function handleProjectSurveys(req: Request, jwt: string, site: SiteRow, principal: Principal, projectId: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(projectId)) return json({ error: 'bad_request' }, 400, cors);
  const studio = await isStudioSide(jwt, site, principal);
  const project = await loadProject(site.id, projectId);
  if (!project || (!studio && !project.client_visible)) return json({ error: 'not_found' }, 404, cors);
  if (req.method === 'GET') {
    let path = `presence_surveys?project_id=eq.${projectId}&site_id=eq.${site.id}&deleted_at=is.null&select=id,title,status,client_visible,created_at&order=created_at.desc&limit=100`;
    if (!studio) path += `&client_visible=is.true&status=eq.active`;
    const r = await svc(path);
    return r.ok ? json({ data: rows(r), is_studio_view: studio }, 200, cors) : json({ error: 'read_failed' }, 502, cors);
  }
  if (req.method === 'POST') {
    if (!studio) return studioDenied(cors);
    let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
    const title = clean(b.title, 200);
    if (!title) return json({ error: 'validation', message: 'A survey needs a title.' }, 422, cors);
    const norm = normalizeQuestions(b.questions);
    if (!norm.ok) return json({ error: 'validation', message: norm.error }, 422, cors);
    const ins = await svc('presence_surveys', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ site_id: site.id, project_id: projectId, title, questions: norm.questions, status: 'active', client_visible: b.client_visible === false ? false : true }) });
    if (!ins.ok || !rows(ins)[0]) return json({ error: 'write_failed' }, 502, cors);
    const s = rows(ins)[0];
    await projectEvent(site.id, projectId, 'survey_requested', principal, s.client_visible, { survey_id: s.id, title });
    return json({ data: s }, 201, cors);
  }
  return json({ error: 'method_not_allowed' }, 405, cors);
}

export async function handleSurvey(req: Request, jwt: string, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  const studio = await isStudioSide(jwt, site, principal);
  const survey = rows(await svc(`presence_surveys?id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=*&limit=1`))[0];
  if (!survey || (!studio && !(survey.client_visible && survey.status === 'active'))) return json({ error: 'not_found' }, 404, cors);
  if (studio) {
    const resp = rows(await svc(`presence_survey_responses?survey_id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=id,respondent,answers,status,submitted_at&order=created_at.desc&limit=200`));
    return json({ data: { survey, responses: resp, is_studio_view: true } }, 200, cors);
  }
  const mine = rows(await svc(`presence_survey_responses?survey_id=eq.${id}&site_id=eq.${site.id}&respondent=eq.${encodeURIComponent(readerKey(principal))}&deleted_at=is.null&select=id,answers,status,submitted_at&limit=1`))[0] || null;
  return json({ data: { survey: { id: survey.id, title: survey.title, questions: survey.questions, status: survey.status }, my_response: mine, is_studio_view: false } }, 200, cors);
}

export async function handleSurveyRespond(req: Request, jwt: string, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  const survey = rows(await svc(`presence_surveys?id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=id,project_id,questions,status,client_visible&limit=1`))[0];
  if (!survey || survey.status !== 'active') return json({ error: 'not_found', message: 'That survey isn’t open.' }, 404, cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const norm = normalizeAnswers(b.answers, survey.questions || []);
  if (!norm.ok) return json({ error: 'validation', message: norm.error }, 422, cors);
  const respondent = readerKey(principal);
  // idempotent: one submitted response per (survey, respondent) — the unique index enforces it
  const existing = rows(await svc(`presence_survey_responses?survey_id=eq.${id}&site_id=eq.${site.id}&respondent=eq.${encodeURIComponent(respondent)}&status=eq.submitted&select=id&limit=1`))[0];
  if (existing) return json({ data: { id: existing.id, status: 'submitted' }, already: true }, 200, cors);
  const ins = await svc('presence_survey_responses', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: site.id, survey_id: id, project_id: survey.project_id, respondent, answers: norm.answers, status: 'submitted', submitted_at: nowIso() }) });
  if (!ins.ok || !rows(ins)[0]) { // unique-violation race → treat as already submitted
    const race = rows(await svc(`presence_survey_responses?survey_id=eq.${id}&site_id=eq.${site.id}&respondent=eq.${encodeURIComponent(respondent)}&status=eq.submitted&select=id&limit=1`))[0];
    if (race) return json({ data: { id: race.id, status: 'submitted' }, already: true }, 200, cors);
    return json({ error: 'write_failed' }, 502, cors);
  }
  if (survey.project_id) await projectEvent(site.id, survey.project_id, 'survey_submitted', principal, false, { survey_id: id });
  return json({ data: { id: rows(ins)[0].id, status: 'submitted' } }, 201, cors);
}

// ═══ SUPPORT ═══
export async function handleSupport(req: Request, jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  const studio = await isStudioSide(jwt, site, principal);
  if (req.method === 'GET') {
    const u = new URL(req.url);
    const status = u.searchParams.get('status');
    const q = clean(u.searchParams.get('q'), 80).replace(/[(),*"\\]/g, ' ').trim();   // neutralize PostgREST filter grammar (matches sales.ts/projects.ts)
    const limit = clampLimit(u.searchParams.get('limit'));
    const offset = clampOffset(u.searchParams.get('offset'));
    let path = `presence_support_requests?site_id=eq.${site.id}&deleted_at=is.null&select=id,subject,status,priority,project_id,requester,assigned_to,resolved_at,updated_at&order=updated_at.desc&limit=${limit}&offset=${offset}`;
    if (!studio) path += `&requester=eq.${encodeURIComponent(readerKey(principal))}`;   // the client sees only its own
    if (status && isSupportStatus(status)) path += `&status=eq.${status}`;
    if (q) path += `&subject.ilike.*${encodeURIComponent(q)}*`;
    const r = await svc(path);
    return r.ok ? json({ data: rows(r), limit, offset, is_studio_view: studio }, 200, cors) : json({ error: 'read_failed' }, 502, cors);
  }
  if (req.method === 'POST') {
    let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
    const subject = clean(b.subject, 200);
    if (!subject) return json({ error: 'validation', message: 'A support request needs a subject.' }, 422, cors);
    let projectId: string | null = UUID_RE.test(b.project_id || '') ? b.project_id : null;
    if (projectId && !(await loadProject(site.id, projectId))) projectId = null;
    const priority = isSupportPriority(b.priority) ? b.priority : 'normal';
    // F3: stamp client_id at write time when the requester resolves to one of
    // THIS site's bridged customers (best-effort — a studio-side submitter simply
    // doesn't resolve). Pre-0115 degrade: on the precise missing-column signal
    // the insert retries once in the old shape (never on any other failure).
    const { clientIdForRequester } = await import('../lib/service_bridge.ts');
    const { missingColumnSignal } = await import('../lib/inbound_email.ts');
    const clientId = (principal.kind === 'staff' || principal.kind === 'system') ? null
      : await clientIdForRequester(site.id, { userId: (principal as any).userId, email: principal.email }).catch(() => null);
    const reqRow = { site_id: site.id, project_id: projectId, subject, body: clean(b.body, 5000), status: 'open', priority, requester: readerKey(principal), requester_kind: principal.kind };
    let ins = await svc('presence_support_requests', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify(clientId ? { ...reqRow, client_id: clientId } : reqRow) });
    if ((!ins.ok || !rows(ins)[0]) && clientId && missingColumnSignal(ins.json, ins.text, 'client_id')) {
      ins = await svc('presence_support_requests', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(reqRow) });
    }
    if (!ins.ok || !rows(ins)[0]) return json({ error: 'write_failed' }, 502, cors);
    const req0 = rows(ins)[0];
    if (projectId) await projectEvent(site.id, projectId, 'support_opened', principal, true, { request_id: req0.id, subject });
    // auto-acknowledge the requester (best-effort). The agency-side submitter is
    // reached at their own login email; a bridged customer's ack is handled on
    // the /client/support path (client_delivery.ts) where their email resolves.
    await ackSupportRequester(site.id, String(principal.email || ''), 'We’ve got your request');
    return json({ data: req0 }, 201, cors);
  }
  return json({ error: 'method_not_allowed' }, 405, cors);
}

async function loadSupport(site: SiteRow, id: string, studio: boolean, principal: Principal) {
  const r = rows(await svc(`presence_support_requests?id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=*&limit=1`))[0];
  if (!r) return null;
  if (!studio && r.requester !== readerKey(principal)) return null;   // the client sees only its own
  return r;
}

export async function handleSupportOne(req: Request, jwt: string, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  const studio = await isStudioSide(jwt, site, principal);
  const reqRow = await loadSupport(site, id, studio, principal);
  if (!reqRow) return json({ error: 'not_found', message: 'That request isn’t here.' }, 404, cors);
  if (req.method === 'GET') {
    const msgs = rows(await svc(`presence_support_messages?request_id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=id,body,author,author_kind,attachment_media_id,created_at&order=created_at.asc&limit=200`));
    return json({ data: { request: reqRow, messages: msgs, is_studio_view: studio } }, 200, cors);
  }
  if (req.method === 'PATCH') { // triage/resolve — studio only
    if (!studio) return studioDenied(cors);
    let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
    const patch: Record<string, unknown> = {};
    let resolvedNow = false;
    let clearedNow = false;   // resolved OR closed — the two transitions that END the wait
    if (b.priority !== undefined) { if (!isSupportPriority(b.priority)) return json({ error: 'validation', message: 'Invalid priority.' }, 422, cors); patch.priority = b.priority; }
    if (b.assigned_to !== undefined) patch.assigned_to = UUID_RE.test(b.assigned_to || '') ? b.assigned_to : null;
    if (b.resolution !== undefined) patch.resolution = clean(b.resolution, 2000);
    if (b.status !== undefined) {
      if (!isSupportStatus(b.status)) return json({ error: 'bad_status' }, 422, cors);
      if (b.status !== reqRow.status && !canSupportTransition(reqRow.status, b.status)) return json({ error: 'invalid_transition', message: `A request can’t move from ${reqRow.status} to ${b.status}.` }, 409, cors);
      patch.status = b.status;
      patch.resolved_at = b.status === 'resolved' ? nowIso() : (b.status === 'open' ? null : reqRow.resolved_at);
      resolvedNow = b.status === 'resolved' && reqRow.status !== 'resolved';
      clearedNow = (b.status === 'resolved' || b.status === 'closed') && b.status !== reqRow.status;
    }
    if (!Object.keys(patch).length) return json({ error: 'empty_update' }, 400, cors);
    // B5: optimistic guard — a status change pins the prior status in the WHERE so two
    // concurrent triages can't silently clobber each other (matches every other ladder).
    const guard = (b.status !== undefined && patch.status !== reqRow.status) ? `&status=eq.${reqRow.status}` : '';
    const up = await svc(`presence_support_requests?id=eq.${id}&site_id=eq.${site.id}${guard}&select=*`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
    if (!up.ok || !rows(up)[0]) return json({ error: 'conflict', message: 'That request just changed — refresh and try again.' }, 409, cors);
    // ── TEARDOWN: doing the work clears the row ────────────────────────────────
    // runSupportAging raises "Waiting on you — <subject>" on the notices rail, and
    // nothing ever took it down: the owner could resolve the request and the row
    // stayed forever. Resolving OR CLOSING ends the wait, so both clear it (a mere
    // REPLY deliberately does not — a reply that goes unanswered is still waiting).
    // Placed AFTER the guarded write, so a lost optimistic race never clears a
    // notice for work that didn't land. Prefix-scoped because the nudge now
    // re-fires on a weekly bucket: last week's row and this week's both go.
    // Best-effort by construction (clearNoticePrefix never throws) — the studio's
    // resolve must never fail over its own echo.
    //
    // BOTH SHAPES. The prefix (`support:<id>:`) covers every weekly bucket, but
    // its trailing colon — the thing that stops `support:abc:` reaching
    // `support:abcd:` — is also what makes it unable to match the PRE-BUCKET
    // period, which was the exact string `support:<id>`. Without the second call
    // every notice raised before this deploy is orphaned: permanently "Waiting on
    // you" for a request the owner has already finished.
    if (clearedNow && site.client_id) {
      await clearNoticePrefix(site.client_id, 'support_aging', supportAgingPeriodPrefix(id));
      await clearNotice(site.client_id, 'support_aging', supportAgingLegacyPeriod(id));
    }
    if (resolvedNow && reqRow.project_id) {
      await projectEvent(site.id, reqRow.project_id, 'support_resolved', principal, true, { request_id: id });
      // service edge #1: on resolve, offer the client a one-question CSAT (reuses
      // the survey spine; idempotent per ticket; emails the bridged customer).
      await offerCsat({ agencySiteId: site.id, projectId: reqRow.project_id, source: 'support', sourceId: id });
    }
    return json({ data: rows(up)[0] }, 200, cors);
  }
  return json({ error: 'method_not_allowed' }, 405, cors);
}

/** I2: when the STUDIO posts a support reply, also notify the requester by EMAIL —
 *  otherwise an email-NATIVE customer (one who filed via /email/inbound and never
 *  opens the portal) never learns the studio replied; the loop is half-open. Best-
 *  effort, mirrors project_comms' bridge-nudge idiom: branded, critical (survives a
 *  marketing opt-out), throttled (if a studio message on THIS request already went
 *  out < 15 min ago, the earlier email already carries the thread — don't stack),
 *  and siteId is passed so reply_to = the site's inbound address (R1: the reply
 *  lands right back on /email/inbound). The recipient is the request's `requester`
 *  ONLY when it is an email address — an auth-uid requester means a portal user who
 *  is reached in-app, so we skip silently (also skip if it can't be resolved).
 *  Never blocks or fails the reply. `insId` is the just-inserted message, excluded
 *  from the throttle probe. */
async function emailStudioSupportReply(site: SiteRow, reqRow: any, body: string, insId: string): Promise<void> {
  try {
    const to = String(reqRow?.requester || '').trim();
    if (!EMAIL_RE.test(to)) return;   // auth-uid requester (portal user) or unresolved → skip silently
    const prev = rows(await svc(`presence_support_messages?request_id=eq.${reqRow.id}&site_id=eq.${site.id}&deleted_at=is.null&id=neq.${insId}&author_kind=neq.client&select=created_at&order=created_at.desc&limit=1`))[0];
    if (prev && (Date.now() - Date.parse(String(prev.created_at))) < 15 * 60 * 1000) return;   // throttle
    const { sendEmail } = await import('../commerce/account.ts');
    const { loadEmailBrand } = await import('../lib/email_brand.ts');
    const brand = await loadEmailBrand(site.id);
    const safe = body.slice(0, 500).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
    await sendEmail(to, 'A reply from your studio',
      `<p>Your studio replied to your message:</p><blockquote style="margin:8px 0;padding:8px 14px;border-left:3px solid #ccc">${safe}</blockquote><p>Just reply to this email to continue the conversation.</p>`,
      brand, { critical: true, siteId: site.id });
  } catch { /* best-effort — the email must never block or fail the studio reply */ }
}

export async function handleSupportMessage(req: Request, jwt: string, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  const studio = await isStudioSide(jwt, site, principal);
  const reqRow = await loadSupport(site, id, studio, principal);
  if (!reqRow) return json({ error: 'not_found' }, 404, cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const body = clean(b.body, 5000);
  if (!body) return json({ error: 'validation', message: 'Write a message first.' }, 400, cors);
  let attachment: string | null = UUID_RE.test(b.attachment_media_id || '') ? b.attachment_media_id : null;
  if (attachment) { const m = rows(await svc(`presence_media?id=eq.${attachment}&site_id=eq.${site.id}&deleted_at=is.null&select=id&limit=1`))[0]; if (!m) attachment = null; }
  const ins = await svc('presence_support_messages', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: site.id, request_id: id, body, author: readerKey(principal), author_kind: principal.kind, attachment_media_id: attachment }) });
  if (!ins.ok || !rows(ins)[0]) return json({ error: 'write_failed' }, 502, cors);
  // a studio reply on an open request bumps it to in_progress (best-effort, guarded)
  if (studio && reqRow.status === 'open') await svc(`presence_support_requests?id=eq.${id}&site_id=eq.${site.id}&status=eq.open`, { method: 'PATCH', body: JSON.stringify({ status: 'in_progress' }) }).catch(() => {});
  if (reqRow.project_id) await projectEvent(site.id, reqRow.project_id, 'support_message', principal, true, { request_id: id });
  // I2: notify an email-native requester that the studio replied (best-effort, throttled).
  if (studio) emailStudioSupportReply(site, reqRow, body, String(rows(ins)[0].id)).catch(() => {});
  return json({ data: rows(ins)[0] }, 201, cors);
}
