// ── Broadcasts routes — owner-approved email to a saved segment ──────────────
// The whole surface enforces the moat rule: compose → preview → EXPLICITLY send/
// schedule. Nothing here auto-sends; the cron only dispatches what the owner
// already approved (status 'scheduled'). Every query is site_id-scoped (tenant
// isolation) and studio-gated by the reviewer boundary in index.ts (a
// client_reviewer never reaches /broadcasts). Dispatch reuses the ONE send path
// (commerce/account.ts sendEmail) so suppression + one-click unsubscribe are
// inherited — this file never re-implements email.
//   GET   /broadcasts                 — the owner's broadcasts (drafts/scheduled/sent)
//   POST  /broadcasts                 — create a draft {subject, body, audience}
//   GET   /broadcasts/segments        — the segment presets + live audience counts
//   POST  /broadcasts/draft-assist    — AI PROPOSES a subject+body (owner edits/approves)
//   GET   /broadcasts/:id             — one broadcast + rendered preview + honest count
//   PATCH /broadcasts/:id             — edit a draft
//   POST  /broadcasts/:id/send        — send now, or {scheduled_at} to schedule
//   POST  /broadcasts/:id/cancel      — cancel a scheduled broadcast
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { loadEmailBrand, brandEmailShell } from '../lib/email_brand.ts';
import { anthropicModel } from '../writer/model.ts';
import {
  SEGMENTS, isSegmentKey, segmentLabel, validSubject, cleanSubject, cleanBody,
  scheduleDecision, resolveSendable, audienceCount, dispatchBroadcast,
  buildEmailHtml, renderSubject, type SegmentKey, type BroadcastRow,
} from '../lib/broadcast.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rows = (r: { json?: unknown }) => (Array.isArray((r as any).json) ? (r as any).json : []) as any[];
const nowIso = () => new Date().toISOString();
// Send-now dispatches INLINE (immediate). Above this size we queue it for the
// cron (scheduled_at = now) so a big list never blows the request wall-clock —
// still the owner's one explicit Send, just dispatched over the next tick.
const INLINE_CAP = 300;

// The feature depends on migration 0098. Before it's applied any read/write to the
// tables returns not-ok; we answer "unavailable" cleanly rather than erroring —
// the same graceful-degrade posture as the 0094–0097 surfaces.
function unavailable(cors: Record<string, string>): Response {
  return json({ error: 'unavailable', message: 'Broadcasts aren’t switched on yet.', broadcasts: [] }, 200, cors);
}

/** Load one broadcast, site-scoped. null when missing (or pre-0098). */
async function loadBroadcast(siteId: string, id: string): Promise<any | null> {
  const r = await svc(`presence_broadcasts?id=eq.${id}&site_id=eq.${siteId}&select=*&limit=1`);
  if (!r.ok) return null;
  return rows(r)[0] || null;
}

export async function handleBroadcastsList(site: SiteRow, cors: Record<string, string>): Promise<Response> {
  const r = await svc(`presence_broadcasts?site_id=eq.${site.id}&select=id,subject,audience,status,scheduled_at,sent_at,recipient_count,sent_count,skipped_count,failed_count,created_at&order=created_at.desc&limit=100`);
  if (!r.ok) return unavailable(cors);
  return json({ data: { broadcasts: rows(r) } }, 200, cors);
}

export async function handleBroadcastSegments(site: SiteRow, cors: Record<string, string>): Promise<Response> {
  // Live audience size per preset (distinct valid addresses, pre-suppression — the
  // honest post-suppression count is shown on the specific broadcast's preview).
  const counts: Record<string, number> = {};
  for (const s of SEGMENTS) counts[s.key] = await audienceCount(site.id, s.key).catch(() => 0);
  return json({ data: { segments: SEGMENTS.map((s) => ({ ...s, count: counts[s.key] ?? 0 })) } }, 200, cors);
}

export async function handleBroadcastCreate(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: 'bad_json', message: 'That didn’t read right — nothing was saved.' }, 400, cors); }
  const audience = isSegmentKey(body?.audience) ? body.audience : 'contacts';
  const subject = cleanSubject(body?.subject);
  const bodyMd = cleanBody(body?.body);
  const ins = await svc('presence_broadcasts', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: site.id, subject, body: bodyMd, audience, status: 'draft', created_by: principal.email || principal.userId || 'owner' }),
  });
  if (!ins.ok || !rows(ins)[0]) return unavailable(cors);
  return json({ data: rows(ins)[0] }, 200, cors);
}

export async function handleBroadcastGet(site: SiteRow, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'not_found' }, 404, cors);
  const b = await loadBroadcast(site.id, id);
  if (!b) return json({ error: 'not_found', message: 'That broadcast isn’t here.' }, 404, cors);
  // The HONEST recipient count (suppression-filtered) + a full branded preview the
  // owner sees before they approve. Rendered with a representative first name.
  const brand = await loadEmailBrand(site.id);
  const sendable = await resolveSendable(site.id, b.audience as SegmentKey).catch(() => ({ recipients: [], suppressed: 0, audience: 0 }));
  const tokens = { firstName: 'there', businessName: brand.name };
  const preview_html = brandEmailShell(buildEmailHtml(b.body, tokens), brand);
  const preview_subject = renderSubject(b.subject, tokens);
  return json({ data: {
    broadcast: b,
    audience_label: segmentLabel(b.audience),
    recipient_count: sendable.recipients.length,
    suppressed_count: sendable.suppressed,
    preview_subject, preview_html,
  } }, 200, cors);
}

export async function handleBroadcastUpdate(req: Request, site: SiteRow, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'not_found' }, 404, cors);
  const b = await loadBroadcast(site.id, id);
  if (!b) return json({ error: 'not_found', message: 'That broadcast isn’t here.' }, 404, cors);
  if (b.status !== 'draft') return json({ error: 'not_editable', message: 'Only a draft can be edited. Cancel a scheduled send first.' }, 409, cors);
  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const patch: Record<string, unknown> = { updated_at: nowIso() };
  if (body.subject !== undefined) patch.subject = cleanSubject(body.subject);
  if (body.body !== undefined) patch.body = cleanBody(body.body);
  if (body.audience !== undefined) patch.audience = isSegmentKey(body.audience) ? body.audience : b.audience;
  const up = await svc(`presence_broadcasts?id=eq.${id}&site_id=eq.${site.id}&status=eq.draft`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch),
  });
  if (!up.ok || !rows(up)[0]) return json({ error: 'update_failed', message: 'That didn’t save.' }, 502, cors);
  return json({ data: rows(up)[0] }, 200, cors);
}

export async function handleBroadcastCancel(site: SiteRow, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'not_found' }, 404, cors);
  const up = await svc(`presence_broadcasts?id=eq.${id}&site_id=eq.${site.id}&status=in.(draft,scheduled)`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'canceled', updated_at: nowIso() }),
  });
  if (!up.ok) return unavailable(cors);
  if (!rows(up)[0]) return json({ error: 'not_cancelable', message: 'That broadcast has already been sent or is sending.' }, 409, cors);
  return json({ data: { ok: true, status: 'canceled' } }, 200, cors);
}

/** Send now, or schedule for a future time. The ONE explicit owner approval. */
export async function handleBroadcastSend(req: Request, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'not_found' }, 404, cors);
  const b = await loadBroadcast(site.id, id);
  if (!b) return json({ error: 'not_found', message: 'That broadcast isn’t here.' }, 404, cors);
  if (b.status !== 'draft' && b.status !== 'scheduled') {
    return json({ error: 'not_sendable', message: b.status === 'sent' ? 'This broadcast has already been sent.' : 'This broadcast is already going out.' }, 409, cors);
  }
  if (!validSubject(b.subject)) return json({ error: 'no_subject', message: 'Add a subject line before sending.' }, 400, cors);
  if (!String(b.body || '').trim()) return json({ error: 'no_body', message: 'Write a message before sending.' }, 400, cors);

  let body: any = {};
  try { body = await req.json(); } catch { /* no body = send now */ }
  const decision = scheduleDecision(body?.scheduled_at, nowIso());
  if ('error' in decision) return json({ error: 'bad_time', message: 'That send time didn’t read as a date.' }, 400, cors);

  // ── SCHEDULE: content is approved up front; only dispatch is deferred to the cron.
  if (decision.mode === 'scheduled') {
    const up = await svc(`presence_broadcasts?id=eq.${id}&site_id=eq.${site.id}&status=in.(draft,scheduled)`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ status: 'scheduled', scheduled_at: decision.scheduledAt, updated_at: nowIso() }),
    });
    if (!up.ok || !rows(up)[0]) return json({ error: 'schedule_failed', message: 'Couldn’t schedule that.' }, 502, cors);
    const sendable = await resolveSendable(site.id, b.audience as SegmentKey).catch(() => ({ recipients: [] as unknown[], suppressed: 0, audience: 0 }));
    return json({ data: { status: 'scheduled', scheduled_at: decision.scheduledAt, recipient_count: sendable.recipients.length, skipped_count: sendable.suppressed } }, 200, cors);
  }

  // ── SEND NOW. Resolve the honest (suppression-filtered) audience first.
  const sendable = await resolveSendable(site.id, b.audience as SegmentKey).catch(() => null);
  if (!sendable) return unavailable(cors);
  if (sendable.recipients.length === 0) {
    return json({ error: 'no_recipients', message: 'No reachable contacts in this list right now — everyone is either unsubscribed or has no email on file.' }, 400, cors);
  }
  // Large list → queue for the cron (scheduled_at = now) rather than dispatch inline.
  if (sendable.recipients.length > INLINE_CAP) {
    const up = await svc(`presence_broadcasts?id=eq.${id}&site_id=eq.${site.id}&status=in.(draft,scheduled)`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ status: 'scheduled', scheduled_at: nowIso(), updated_at: nowIso() }),
    });
    if (!up.ok || !rows(up)[0]) return json({ error: 'send_failed' }, 502, cors);
    return json({ data: { status: 'queued', recipient_count: sendable.recipients.length, skipped_count: sendable.suppressed, note: 'Sending now — it goes out over the next few minutes.' } }, 200, cors);
  }

  // Inline dispatch: atomically claim (draft/scheduled → sending) so a double-tap
  // can't send twice, then run the ONE shared dispatch path.
  const claim = await svc(`presence_broadcasts?id=eq.${id}&site_id=eq.${site.id}&status=in.(draft,scheduled)`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'sending', updated_at: nowIso() }),
  });
  if (!claim.ok || !rows(claim)[0]) return json({ error: 'already_sending', message: 'This broadcast is already going out.' }, 409, cors);
  const row = rows(claim)[0] as BroadcastRow;
  try {
    const res = await dispatchBroadcast(row);
    await svc(`presence_broadcasts?id=eq.${id}&site_id=eq.${site.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'sent', sent_at: nowIso(), recipient_count: res.recipients, sent_count: res.sent, skipped_count: res.skipped, failed_count: res.failed, updated_at: nowIso() }),
    }).catch(() => {});
    void principal;
    return json({ data: { status: 'sent', sent_count: res.sent, skipped_count: res.skipped, failed_count: res.failed, recipient_count: res.recipients } }, 200, cors);
  } catch (_e) {
    // release the claim so nothing is stranded 'sending' (per-recipient guard makes a retry safe)
    await svc(`presence_broadcasts?id=eq.${id}&site_id=eq.${site.id}&status=eq.sending`, { method: 'PATCH', body: JSON.stringify({ status: 'draft', updated_at: nowIso() }) }).catch(() => {});
    return json({ error: 'send_failed', message: 'The send hit a snag — nothing further went out. Try again.' }, 502, cors);
  }
}

// ── AI draft-assist (optional): PROPOSE a subject + body the owner edits/approves.
// Reuses the existing Writer model caller. Never auto-fills-and-sends: it returns a
// proposal only. Honest "unavailable" without ANTHROPIC_KEY.
export async function handleBroadcastDraftAssist(req: Request, site: SiteRow, cors: Record<string, string>): Promise<Response> {
  const model = anthropicModel();
  if (!model) return json({ error: 'ai_unavailable', message: 'Writing help isn’t switched on right now — you can always write it by hand.' }, 503, cors);
  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const goal = String(body?.goal || body?.prompt || '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600);
  if (!goal) return json({ error: 'no_goal', message: 'Tell me what the update is about and I’ll suggest a draft.' }, 400, cors);
  const brand = await loadEmailBrand(site.id);
  const system = `You draft a short, warm broadcast email a small business sends to its own customers/leads. Plain merchant language, no marketing jargon, no exclamation marks. You may use the merge tokens {{first_name}} and {{business_name}} verbatim where natural. The sender's business is "${brand.name}". Respond with ONLY a JSON object: {"subject": string, "body": string}. The body is markdown (short paragraphs, an optional bullet list). Do not invent facts, offers, prices, dates, or discounts that were not given to you.`;
  const res = await model(system, `<<<TASK\n${goal}\nTASK>>>`);
  if (!res.ok) return json({ error: 'draft_failed', message: 'The draft didn’t come through — nothing changed. Try again, or write it by hand.' }, 502, cors);
  let parsed: any = null;
  try { parsed = JSON.parse(res.text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()); } catch { /* handled below */ }
  const subject = cleanSubject(parsed?.subject);
  const draftBody = cleanBody(parsed?.body);
  if (!subject && !draftBody) return json({ error: 'draft_failed', message: 'The draft came back empty — try rephrasing, or write it by hand.' }, 502, cors);
  return json({ data: { subject, body: draftBody, note: 'A starting point — edit anything, and nothing sends until you say so.' } }, 200, cors);
}
