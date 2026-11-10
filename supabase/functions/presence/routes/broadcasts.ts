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
//   POST  /broadcasts/:id/test        — "Send me a test": the draft to YOUR OWN address only, marked [Test]
//   POST  /broadcasts/lists           — keep a list of picked people {name, people} (items 31 + 39)
//   DELETE /broadcasts/lists/:id      — remove a picked list (refused while a scheduled send uses it)
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { loadEmailBrand, brandEmailShell } from '../lib/email_brand.ts';
import { loadUpdateExtras } from '../lib/update_media.ts';
import { anthropicModel } from '../writer/model.ts';
import {
  SEGMENTS, isSegmentKey, segmentLabel, validSubject, cleanSubject, cleanBody,
  scheduleDecision, resolveSendable, audienceCount, dispatchBroadcast,
  knownEmails, keepKnown, sentInLastDay, dailySendCap, overDailyCap, dailyCapMessage, DailyCapError,
  buildEmailHtml, renderSubject, sendBroadcastTest, type SegmentKey, type BroadcastRow,
  isAudienceKey, isListKey, loadPickedLists, type AudienceKey,
} from '../lib/broadcast.ts';
import { normalizeLists, normalizePeople, newId, MAX_LISTS } from '../lib/saved_views.ts';
import { loadEngagement } from '../lib/email_engagement.ts';
import { updateReservedJson, RESERVED_NAMES } from '../lib/reserved_store.ts';
import { rateAllow, tooMany } from '../lib/ratelimit.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';
import { UUID_RE } from '../lib/uuid.ts';

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
  // batch B (final pass, Nov 8): every count and the picked lists side by side, not one after another
  const [pairs, picked, known] = await Promise.all([
    // batch D: a count that couldn't be read is null ("couldn't count"), never 0
    Promise.all(SEGMENTS.map(async (s) => [s.key, await audienceCount(site.id, s.key, { strict: true }).catch(() => null)] as const)),
    loadPickedLists(site.id).catch(() => []),
    knownEmails(site.id).catch(() => null),   // S4: a list counts only the studio's own people
  ]);
  const counts: Record<string, number | null> = Object.fromEntries(pairs);
  // the studio's picked lists follow the presets, newest first (items 31 + 39)
  const lists = picked.slice().reverse().map((l) => {
    const n = known ? keepKnown(l.people, known).kept.length : l.people.length;
    return { key: `list:${l.id}`, label: l.name, description: `A list you picked · ${n} ${n === 1 ? 'person' : 'people'}`, count: n, list: true };
  });
  return json({ data: { segments: [...SEGMENTS.filter((s) => s.key !== 'customers' || counts[s.key] !== 0).map((s) => ({ ...s, count: counts[s.key] ?? null })), ...lists], partial: Object.values(counts).some((n) => n === null) } }, 200, cors);   // item 56: no customers, no customers list
}

/** A list key must name one of THIS site's lists; a segment key is always fine. */
async function audienceOk(siteId: string, key: unknown): Promise<boolean> {
  if (isSegmentKey(key)) return true;
  if (!isListKey(key)) return false;
  return (await loadPickedLists(siteId).catch(() => [])).some((l) => `list:${l.id}` === key);
}
async function audienceLabelFor(siteId: string, key: string): Promise<string> {
  if (!isListKey(key)) return segmentLabel(key);
  const l = (await loadPickedLists(siteId).catch(() => [])).find((x) => `list:${x.id}` === key);
  return l ? l.name : 'A list that was removed';
}

export async function handleBroadcastListCreate(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const picked = normalizePeople(body?.people);
  if (!picked.length) return json({ error: 'validation', message: 'None of the people you picked has an email address.' }, 422, cors);
  // S4 (final pass): a list only ever holds THIS studio's own people (its contacts,
  // enquiries and customers), so Send an update can't mail people who never
  // contacted you. When that can't be checked, nothing is saved.
  let known: Set<string>;
  try { known = await knownEmails(site.id); }
  catch { return json({ error: 'unavailable', message: 'We couldn’t check who you picked just now. Please try again in a moment.' }, 503, cors); }
  const { kept: people, dropped } = keepKnown(picked, known);
  if (!people.length) return json({ error: 'validation', message: 'None of the people you picked is one of your contacts, enquiries or customers.' }, 422, cors);
  const day = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const name = String(body?.name || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80) || `Picked on ${day} · ${people.length} ${people.length === 1 ? 'person' : 'people'}`;
  const list = { id: newId(), name, people, created_at: nowIso() };
  // F9 (final pass): appended to whatever is saved now, so two lists made at once both stay
  const saved = await updateReservedJson(site.id, RESERVED_NAMES.broadcastLists, (cur) => normalizeLists([...normalizeLists(cur), list].slice(-MAX_LISTS)), principal.email || principal.userId || 'owner');
  if (!saved) return json({ error: 'write_failed', message: 'That list didn’t save — please try again.' }, 502, cors);
  return json({ data: { id: list.id, key: `list:${list.id}`, name, count: people.length, left_out: dropped } }, 201, cors);
}

export async function handleBroadcastListDelete(site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  const key = `list:${id}`;
  if (!isListKey(key)) return json({ error: 'not_found' }, 404, cors);
  const busy = await svc(`presence_broadcasts?site_id=eq.${site.id}&audience=eq.${encodeURIComponent(key)}&status=in.(scheduled,sending)&select=id&limit=1`);
  // F8 (final pass): when "is it in use?" can't be answered, don't delete — a
  // scheduled update on a removed list would quietly go to no one
  if (!busy.ok) return json({ error: 'unavailable', message: 'We couldn’t check whether an update is going to this list. Please try again in a moment.' }, 503, cors);
  if (rows(busy)[0]) return json({ error: 'in_use', message: 'A scheduled update is going to this list. Cancel it first.' }, 409, cors);
  if (!(await loadPickedLists(site.id)).some((l) => l.id === id)) return json({ error: 'not_found' }, 404, cors);
  const saved = await updateReservedJson(site.id, RESERVED_NAMES.broadcastLists, (cur) => normalizeLists(cur).filter((l) => l.id !== id), principal.email || principal.userId || 'owner');
  return saved ? json({ data: { ok: true } }, 200, cors) : json({ error: 'write_failed', message: 'That didn’t save — please try again.' }, 502, cors);
}

export async function handleBroadcastCreate(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: 'bad_json', message: 'That didn’t read right — nothing was saved.' }, 400, cors); }
  if (isListKey(body?.audience) && !(await audienceOk(site.id, body.audience))) return json({ error: 'validation', message: 'That list isn’t here any more — pick who it goes to again.' }, 422, cors);
  const audience = isAudienceKey(body?.audience) ? body.audience : 'contacts';
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
  const sendable = await resolveSendable(site.id, b.audience as AudienceKey).catch(() => ({ recipients: [], suppressed: 0, audience: 0 }));
  const extras = await loadUpdateExtras(site.id, b.body).catch(() => ({ bookingUrl: '', images: {} as Record<string, string> }));
  const tokens = { firstName: 'there', businessName: brand.name, bookingUrl: extras.bookingUrl };
  const preview_html = brandEmailShell(buildEmailHtml(b.body, tokens, { images: extras.images, accent: brand.accent }), brand);
  const preview_subject = renderSubject(b.subject, tokens);
  // Item 69: who opened a sent update (null before APPLY-0144, or when the read fails).
  const engagement = b.status === 'sent' ? await loadEngagement(site.id, id) : null;
  return json({ data: {
    broadcast: b,
    audience_label: await audienceLabelFor(site.id, String(b.audience || '')),
    recipient_count: sendable.recipients.length,
    suppressed_count: sendable.suppressed,
    preview_subject, preview_html, engagement,
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
  if (body.audience !== undefined) patch.audience = (await audienceOk(site.id, body.audience)) ? body.audience : b.audience;
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
    const sendable = await resolveSendable(site.id, b.audience as AudienceKey).catch(() => ({ recipients: [] as unknown[], suppressed: 0, audience: 0 }));
    return json({ data: { status: 'scheduled', scheduled_at: decision.scheduledAt, recipient_count: sendable.recipients.length, skipped_count: sendable.suppressed } }, 200, cors);
  }

  // ── SEND NOW. Resolve the honest (suppression-filtered) audience first.
  const sendable = await resolveSendable(site.id, b.audience as AudienceKey).catch(() => null);
  if (!sendable) return unavailable(cors);
  if (sendable.recipients.length === 0) {
    return json({ error: 'no_recipients', message: 'No reachable contacts in this list right now — everyone is either unsubscribed or has no email on file.' }, 400, cors);
  }
  // S4: the per-studio daily cap. Checked before queueing or sending, so the studio
  // hears why now rather than an update quietly waiting.
  let used: number;
  try { used = await sentInLastDay(site.id, Date.now(), id); } catch { return unavailable(cors); }
  const cap = dailySendCap();
  if (overDailyCap(used, sendable.recipients.length, cap)) {
    return json({ error: 'daily_cap', message: dailyCapMessage(used, sendable.recipients.length, cap), used, cap, recipient_count: sendable.recipients.length }, 429, cors);
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
  } catch (e) {
    // release the claim so nothing is stranded 'sending' (per-recipient guard makes a retry safe)
    await svc(`presence_broadcasts?id=eq.${id}&site_id=eq.${site.id}&status=eq.sending`, { method: 'PATCH', body: JSON.stringify({ status: 'draft', updated_at: nowIso() }) }).catch(() => {});
    // S4: another send got in first and the day's cap would now break — nothing went out
    if (e instanceof DailyCapError) return json({ error: 'daily_cap', message: dailyCapMessage(e.used, e.n, e.cap), used: e.used, cap: e.cap, recipient_count: e.n }, 429, cors);
    return json({ error: 'send_failed', message: 'The send hit a snag — nothing further went out. Try again.' }, 502, cors);
  }
}

// ── "Send me a test" (bold redesign, Nov 2026): the draft to the signed-in
// person's own address — never one from the request, so this can't mail anyone
// else — marked [Test]. Nothing changes on the broadcast: no claim, no count
// toward the day's cap, no history. Ten tests an hour per studio (each is a
// real email). The owner still previews and presses Send for the list.
export async function handleBroadcastTest(site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'not_found' }, 404, cors);
  const to = String(principal.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return json({ error: 'no_email', message: 'Your sign-in has no email address to send a test to.' }, 400, cors);
  const b = await loadBroadcast(site.id, id);
  if (!b) return json({ error: 'not_found', message: 'That broadcast isn’t here.' }, 404, cors);
  if (b.status !== 'draft' && b.status !== 'scheduled') return json({ error: 'not_testable', message: 'This update has already gone out.' }, 409, cors);
  if (!validSubject(b.subject)) return json({ error: 'no_subject', message: 'Add a subject line first.' }, 400, cors);
  if (!String(b.body || '').trim()) return json({ error: 'no_body', message: 'Write a message first.' }, 400, cors);
  if (!(await rateAllow(`broadcast_test:${site.id}`, 10, 3600))) return tooMany(cors, 600);
  const sent = await sendBroadcastTest(b as BroadcastRow, to).catch(() => false);
  return sent ? json({ data: { ok: true, to } }, 200, cors)
    : json({ error: 'send_failed', message: 'The test didn’t send — nothing went to your list. Try again in a moment.' }, 502, cors);
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
