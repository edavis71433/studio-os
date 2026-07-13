// ── Owner-approved broadcast email (compose → preview → EXPLICITLY send/schedule) ─
// Salesforce-grade "send an update to your list", built the ONLY safe way: it
// reuses the ONE deliverability spine and NEVER auto-sends.
//
// THE MOAT RULE (hard): nothing goes out on the customer's behalf without an
// explicit per-send owner action. Composing makes a DRAFT. The owner previews the
// rendered email + the honest recipient count, then explicitly Sends or Schedules.
// The cron sweep only DISPATCHES a broadcast the owner already moved to
// 'scheduled' — deferred execution of an approved decision, not automation.
//
// REUSE (no second mailer, no re-implemented suppression):
//   • send        → commerce/account.ts sendEmail  (the ONE Resend send point:
//                   suppression gate isSuppressed/maySend + RFC-8058 one-click
//                   List-Unsubscribe are inherited there — we never re-add them)
//   • suppression → _shared/email_infra.ts isSuppressed (we ALSO filter up front,
//                   so a suppressed/opted-out address is never even a recipient)
//   • brand       → lib/email_brand.ts loadEmailBrand/brandEmailShell (owner brand)
//   • body render → lib/markdown.ts renderMarkdown (escape-first, XSS-safe)
//   • audiences   → presence_contacts + presence_form_submissions (site-scoped)
//
// Pure decision logic + copy up top (tested); the impure runner below.
import { svc } from './db.ts';
import { renderMarkdown } from './markdown.ts';
import { sendEmail, validEmail } from '../commerce/account.ts';
import { loadEmailBrand, type EmailBrand } from './email_brand.ts';
import { isSuppressed } from '../routes/email_infra.ts';

const rows = (r: { json?: unknown }) => (Array.isArray((r as any).json) ? (r as any).json : []) as any[];

// ── Segments: light saved presets, NOT a query builder. Plain-language chips over
// the owner's OWN site-scoped audience tables. audit_leads + clients are
// deliberately excluded — they are studio/platform-global (no per-site key), so
// including them could leak another tenant's audience. Everything here is scoped
// by site_id, so a broadcast can only ever reach the sender's own people.
export type SegmentKey = 'contacts' | 'enquiries' | 'enquiries_30d';

export interface SegmentDef { key: SegmentKey; label: string; description: string }

export const SEGMENTS: SegmentDef[] = [
  { key: 'contacts',      label: 'All contacts',              description: 'Everyone saved in your contacts.' },
  { key: 'enquiries',     label: 'All website enquiries',     description: 'Everyone who has messaged you through your website.' },
  { key: 'enquiries_30d', label: 'Recent enquiries (30 days)', description: 'People who enquired through your website in the last month.' },
];

export function isSegmentKey(k: unknown): k is SegmentKey {
  return typeof k === 'string' && SEGMENTS.some((s) => s.key === k);
}
export function segmentLabel(k: string): string {
  return SEGMENTS.find((s) => s.key === k)?.label || 'your audience';
}

// ── Merge tokens (a FEW, safe): {{first_name}} + {{business_name}} ───────────
// Merge happens on the RAW markdown/subject text; renderMarkdown then escapes all
// HTML, so a value can never inject markup. We ALSO strip markdown-structural and
// control characters from the value so a stray "**" in a name can't reflow the
// email's formatting. Missing values fall back to a warm, generic word.
export interface MergeTokens { firstName?: string; businessName?: string }

function cleanMergeValue(v: unknown): string {
  return String(v ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')   // control chars
    .replace(/[<>*_`~#\[\]|]/g, '')          // markdown/HTML structural chars
    .replace(/\s+/g, ' ')
    .trim();
}

/** First token of a name, cleaned. '' when there is no usable name. Pure. */
export function firstNameOf(name: unknown): string {
  const first = cleanMergeValue(name).split(' ')[0] || '';
  return first;
}

/** Replace the supported tokens in raw text. Pure. Safe values, warm fallbacks. */
export function renderMergeTokens(text: unknown, tokens: MergeTokens): string {
  const fn = cleanMergeValue(tokens.firstName) || 'there';
  const bn = cleanMergeValue(tokens.businessName) || 'us';
  return String(text ?? '')
    .replace(/\{\{\s*first_name\s*\}\}/gi, fn)
    .replace(/\{\{\s*business_name\s*\}\}/gi, bn);
}

/** The email SUBJECT line: merge tokens, then flatten to a single plain line. Pure. */
export function renderSubject(subject: unknown, tokens: MergeTokens): string {
  return renderMergeTokens(subject, tokens).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** The email BODY HTML fragment (sendEmail wraps it in the branded shell): merge
 *  tokens then render markdown (escape-first ⇒ XSS-safe). Pure. */
export function buildEmailHtml(bodyMarkdown: unknown, tokens: MergeTokens): string {
  return renderMarkdown(renderMergeTokens(bodyMarkdown, tokens));
}

// ── Recipient normalization: distinct, valid, lower-cased. Pure. ─────────────
export interface Recipient { email: string; firstName: string }

/** De-duplicate by lower(email), drop blanks/invalids. First occurrence (which may
 *  carry a name) wins. This is the honest recipient set BEFORE suppression. Pure. */
export function normalizeRecipients(raw: Array<{ email?: unknown; name?: unknown }>): Recipient[] {
  const seen = new Set<string>();
  const out: Recipient[] = [];
  for (const r of raw || []) {
    const email = String(r?.email ?? '').trim().toLowerCase();
    if (!email || !validEmail(email) || seen.has(email)) continue;
    seen.add(email);
    out.push({ email, firstName: firstNameOf(r?.name) });
  }
  return out;
}

/** Partition a recipient list by a set of suppressed addresses. Pure — the core
 *  of the suppression filter, isolated so it is tested without the network. */
export function partitionSuppressed(recipients: Recipient[], suppressedLower: Set<string>): { kept: Recipient[]; skipped: Recipient[] } {
  const kept: Recipient[] = [];
  const skipped: Recipient[] = [];
  for (const r of recipients) (suppressedLower.has(r.email) ? skipped : kept).push(r);
  return { kept, skipped };
}

// ── Composition validation. Pure. ────────────────────────────────────────────
export function validSubject(s: unknown): boolean {
  const t = String(s ?? '').trim();
  return t.length > 0 && t.length <= 200;
}
export function cleanBody(s: unknown): string {
  return String(s ?? '').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').slice(0, 20000);
}
export function cleanSubject(s: unknown): string {
  return String(s ?? '').replace(/[\r\n\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

// ── Scheduling. Pure. ─────────────────────────────────────────────────────────
/** Is this scheduled broadcast due to go out now? Pure — the sweep's guard. */
export function broadcastDue(b: { status?: string; scheduled_at?: string | null }, nowIso: string): boolean {
  return b?.status === 'scheduled' && !!b.scheduled_at && b.scheduled_at <= nowIso;
}

/** Decide send-now vs schedule-for-later from the owner's requested time. Pure.
 *  No time (or a past/now time) = send now; a future time = schedule. */
export function scheduleDecision(scheduledAtInput: unknown, nowIso: string):
  { mode: 'now' } | { mode: 'scheduled'; scheduledAt: string } | { error: 'bad_time' } {
  if (scheduledAtInput === undefined || scheduledAtInput === null || scheduledAtInput === '') return { mode: 'now' };
  const t = Date.parse(String(scheduledAtInput));
  if (!Number.isFinite(t)) return { error: 'bad_time' };
  const iso = new Date(t).toISOString();
  return iso <= nowIso ? { mode: 'now' } : { mode: 'scheduled', scheduledAt: iso };
}

// ═══════════════════ impure — audience reads + dispatch + sweep ═══════════════

const RECIPIENT_CAP = 5000;   // MVP bound: a single broadcast reaches at most this many

/** Raw audience rows for a segment, SITE-SCOPED. Never crosses tenants. */
export async function fetchAudienceRows(siteId: string, key: SegmentKey): Promise<Array<{ email?: string; name?: string }>> {
  if (key === 'contacts') {
    return rows(await svc(`presence_contacts?site_id=eq.${siteId}&deleted_at=is.null&select=email,name&limit=${RECIPIENT_CAP}`));
  }
  const base = `presence_form_submissions?site_id=eq.${siteId}&spam=is.false&select=email,name,created_at`;
  if (key === 'enquiries_30d') {
    const since = new Date(Date.now() - 30 * 86400_000).toISOString();
    return rows(await svc(`${base}&created_at=gte.${encodeURIComponent(since)}&limit=${RECIPIENT_CAP}`));
  }
  return rows(await svc(`${base}&limit=${RECIPIENT_CAP}`));   // 'enquiries'
}

export interface SendableDeps {
  fetchRows?: (key: SegmentKey) => Promise<Array<{ email?: string; name?: string }>>;
  isSuppressed?: (email: string) => Promise<boolean>;
}

/** The HONEST recipient set: distinct valid addresses MINUS anyone suppressed or
 *  opted-out. A broadcast must never mail a suppressed contact, so we filter here
 *  (up front, for the count the owner sees) AND again at the ONE send point. Deps
 *  are injectable so the whole thing is tested without a database. */
export async function resolveSendable(siteId: string, key: SegmentKey, deps: SendableDeps = {}): Promise<{ recipients: Recipient[]; suppressed: number; audience: number }> {
  const fetchRows = deps.fetchRows || ((k: SegmentKey) => fetchAudienceRows(siteId, k));
  const suppressedFn = deps.isSuppressed || isSuppressed;
  const recips = normalizeRecipients(await fetchRows(key));
  const kept: Recipient[] = [];
  let suppressed = 0;
  for (const r of recips) {
    if (await suppressedFn(r.email)) suppressed++;
    else kept.push(r);
  }
  return { recipients: kept, suppressed, audience: recips.length };
}

/** Just the audience SIZE (distinct valid, pre-suppression) — the cheap number
 *  behind the segment chips. The honest post-suppression count is computed per
 *  broadcast at preview/send time via resolveSendable. */
export async function audienceCount(siteId: string, key: SegmentKey): Promise<number> {
  return normalizeRecipients(await fetchAudienceRows(siteId, key)).length;
}

export interface BroadcastRow { id: string; site_id: string; subject: string; body: string; audience: SegmentKey; status?: string }

export interface DispatchDeps extends SendableDeps {
  loadBrand?: (siteId: string) => Promise<EmailBrand>;
  sendFn?: (to: string, subject: string, html: string, brand?: EmailBrand) => Promise<boolean>;
  // claim a per-recipient send slot: 'inserted' = go ahead, 'duplicate' = already
  // sent (skip — the send-once guard), 'error' = infra failure.
  claimFn?: (broadcastId: string, siteId: string, email: string) => Promise<'inserted' | 'duplicate' | 'error'>;
  markFailedFn?: (broadcastId: string, email: string) => Promise<void>;
  recordSkippedFn?: (broadcastId: string, siteId: string, email: string) => Promise<void>;
  resolveFn?: (siteId: string, key: SegmentKey) => Promise<{ recipients: Recipient[]; suppressed: number; audience: number }>;
}

/** Insert a send-log row, ignoring duplicates. The unique(broadcast_id, lower(email))
 *  index makes this the send-once guard: an already-mailed address returns an empty
 *  representation ⇒ 'duplicate'. */
async function defaultClaim(broadcastId: string, siteId: string, email: string): Promise<'inserted' | 'duplicate' | 'error'> {
  const r = await svc('presence_broadcast_sends', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({ broadcast_id: broadcastId, site_id: siteId, email: email.toLowerCase(), status: 'sent' }),
  });
  if (!r.ok) return 'error';
  return Array.isArray(r.json) && r.json.length ? 'inserted' : 'duplicate';
}
async function defaultMarkFailed(broadcastId: string, email: string): Promise<void> {
  await svc(`presence_broadcast_sends?broadcast_id=eq.${broadcastId}&email=eq.${encodeURIComponent(email.toLowerCase())}`,
    { method: 'PATCH', body: JSON.stringify({ status: 'failed', reason: 'send_failed' }) }).catch(() => {});
}
async function defaultRecordSkipped(broadcastId: string, siteId: string, email: string): Promise<void> {
  await svc('presence_broadcast_sends', {
    method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({ broadcast_id: broadcastId, site_id: siteId, email: email.toLowerCase(), status: 'skipped_suppressed', reason: 'suppressed' }),
  }).catch(() => {});
}

/** Send ONE approved broadcast to its (suppression-filtered) audience. Idempotent
 *  per recipient (the claim guard) so a retried dispatch never double-mails. Sends
 *  flow through the ONE send point, inheriting suppression + one-click unsubscribe.
 *  Deps injectable ⇒ fully unit-tested. */
export async function dispatchBroadcast(b: BroadcastRow, deps: DispatchDeps = {}): Promise<{ sent: number; failed: number; already: number; skipped: number; recipients: number }> {
  const loadBrand = deps.loadBrand || loadEmailBrand;
  const send = deps.sendFn || sendEmail;
  const claim = deps.claimFn || defaultClaim;
  const markFailed = deps.markFailedFn || defaultMarkFailed;
  const recordSkipped = deps.recordSkippedFn || defaultRecordSkipped;
  const resolve = deps.resolveFn || ((siteId: string, key: SegmentKey) => resolveSendable(siteId, key, deps));

  const brand = await loadBrand(b.site_id);
  const businessName = brand?.name || 'us';
  const { recipients, suppressed } = await resolve(b.site_id, b.audience);

  let sent = 0, failed = 0, already = 0;
  for (const r of recipients) {
    const c = await claim(b.id, b.site_id, r.email);
    if (c === 'duplicate') { already++; continue; }   // send-once guard: already mailed
    if (c === 'error') { failed++; continue; }
    const tokens: MergeTokens = { firstName: r.firstName, businessName };
    // sendEmail is the ONE send point: it re-checks suppression and attaches the
    // RFC-8058 one-click List-Unsubscribe header — inherited, never re-implemented.
    const ok = await send(r.email, renderSubject(b.subject, tokens), buildEmailHtml(b.body, tokens), brand);
    if (ok) sent++;
    else { failed++; await markFailed(b.id, r.email).catch(() => {}); }
  }
  void recordSkipped;   // audit hook (skipped count is authoritative for the summary)
  return { sent, failed, already, skipped: suppressed, recipients: recipients.length };
}

/** Atomically CLAIM a scheduled broadcast for dispatch: flip scheduled→sending and
 *  return the row ONLY to the caller that won the flip (so two ticks never both
 *  dispatch the same send). */
export async function claimScheduledBroadcast(id: string): Promise<BroadcastRow | null> {
  const r = await svc(`presence_broadcasts?id=eq.${id}&status=eq.scheduled`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'sending', updated_at: new Date().toISOString() }),
  });
  return (r.ok && Array.isArray(r.json) && r.json[0]) ? r.json[0] as BroadcastRow : null;
}

// ── the cron sweep step (wired into /system/run) ─────────────────────────────
// Dispatches broadcasts the owner already EXPLICITLY scheduled and whose time has
// come. Send-once: the atomic claim + the per-recipient guard. Degrades to a clean
// no-op before 0098 is applied (the table read is not ok). failures>0 makes the
// tick page (sweepIssues), matching every other sweep.
export async function runScheduledBroadcasts(limit = 25): Promise<{ dispatched: number; sent: number; failures: number }> {
  const nowIso = new Date().toISOString();
  const q = await svc(`presence_broadcasts?status=eq.scheduled&scheduled_at=lte.${encodeURIComponent(nowIso)}&select=id,site_id,subject,body,audience,status&order=scheduled_at.asc&limit=${limit}`);
  if (!q.ok) return { dispatched: 0, sent: 0, failures: 0 };   // pre-0098 → clean no-op
  let dispatched = 0, sent = 0, failures = 0;
  for (const row of rows(q)) {
    if (!broadcastDue(row, nowIso)) continue;           // pure guard (defends the SQL window)
    const claimed = await claimScheduledBroadcast(row.id);
    if (!claimed) continue;                              // another tick took it
    try {
      const res = await dispatchBroadcast(claimed);
      await svc(`presence_broadcasts?id=eq.${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'sent', sent_at: new Date().toISOString(), recipient_count: res.recipients, sent_count: res.sent, skipped_count: res.skipped, failed_count: res.failed, updated_at: new Date().toISOString() }),
      }).catch(() => {});
      dispatched++; sent += res.sent; failures += res.failed;
    } catch {
      failures++;
      // release the claim so the next tick retries (per-recipient guard prevents double-mail)
      await svc(`presence_broadcasts?id=eq.${row.id}&status=eq.sending`, { method: 'PATCH', body: JSON.stringify({ status: 'scheduled', updated_at: new Date().toISOString() }) }).catch(() => {});
    }
  }
  return { dispatched, sent, failures };
}
