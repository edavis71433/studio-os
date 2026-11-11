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
import { openPixelTag, openPixelUrl } from './email_engagement.ts';
import { loadEmailBrand, type EmailBrand } from './email_brand.ts';
import { isSuppressed } from '../routes/email_infra.ts';
import { normalizeLists } from './saved_views.ts';
import { readReservedJson, RESERVED_NAMES } from './reserved_store.ts';
import { BOOKING_TOKEN_RE, BOOKING_LINE_RE, IMAGE_LINE_RE, bookingHref, bookingButton, imageBlock, loadUpdateExtras, type UpdateExtras } from './update_media.ts';

const rows = (r: { json?: unknown }) => (Array.isArray((r as any).json) ? (r as any).json : []) as any[];

// ── Segments: light saved presets, NOT a query builder. Plain-language chips over
// the owner's OWN site-scoped audience tables. audit_leads + clients are
// deliberately excluded — they are studio/platform-global (no per-site key), so
// including them could leak another tenant's audience. Everything here is scoped
// by site_id, so a broadcast can only ever reach the sender's own people.
export type SegmentKey = 'customers' | 'subscribers' | 'contacts' | 'enquiries' | 'enquiries_30d';

export interface SegmentDef { key: SegmentKey; label: string; description: string }

export const SEGMENTS: SegmentDef[] = [
  // Second walk (Nov 8, item 56): a studio writing to the people it works for had
  // to pick them on Customers first. Only a studio has customers; the route hides
  // this list when it would reach no one.
  { key: 'customers',     label: 'Your customers',            description: 'Everyone you work for — each customer on your Customers page.' },
  // Builder list item 146: the people who joined with the "Join our list" box on the website.
  { key: 'subscribers',   label: 'People who joined your list', description: 'Everyone who signed up with the “Join our list” box on your website.' },
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
// Sales review items 31 + 39: an audience is a fixed segment OR a list of people
// the studio picked (from Customers, Contacts or Pipeline) and kept to send to
// again. A list lives in the site's own reserved store, so it is site-scoped by
// construction, and every send still goes through the same suppression.
export type AudienceKey = SegmentKey | `list:${string}`;
const LIST_KEY_RE = /^list:[A-Za-z0-9-]{6,40}$/;
export function isListKey(k: unknown): k is `list:${string}` { return typeof k === 'string' && LIST_KEY_RE.test(k); }
export function isAudienceKey(k: unknown): k is AudienceKey { return isSegmentKey(k) || isListKey(k); }
/** The site's picked lists (newest last), read from its own reserved store. */
export async function loadPickedLists(siteId: string) { return normalizeLists(await readReservedJson(siteId, RESERVED_NAMES.broadcastLists)); }

// ── Merge tokens (a FEW, safe): {{first_name}} + {{business_name}} ───────────
// Merge happens on the RAW markdown/subject text; renderMarkdown then escapes all
// HTML, so a value can never inject markup. We ALSO strip markdown-structural and
// control characters from the value so a stray "**" in a name can't reflow the
// email's formatting. Missing values fall back to a warm, generic word.
// The bold redesign adds {{booking_link}} and photos; buildEmailHtml places them
// (lib/update_media.ts), and a subject line never carries either.
export interface MergeTokens { firstName?: string; businessName?: string; bookingUrl?: string }

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
  return renderMergeTokens(subject, tokens).replace(BOOKING_TOKEN_RE, '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** The email BODY HTML fragment (sendEmail wraps it in the branded shell): merge
 *  tokens then render markdown (escape-first ⇒ XSS-safe). A line that is only
 *  {{booking_link}} becomes the "Book a time" button and a photo line its image
 *  (lib/update_media.ts); every other line renders exactly as before, and the
 *  booking link inside a sentence reads "book a time". With no booking link saved,
 *  or a photo that isn't the site's own, that part renders nothing. Pure. */
export function buildEmailHtml(bodyMarkdown: unknown, tokens: MergeTokens, extras: { images?: Record<string, string>; accent?: string } = {}): string {
  const booking = bookingHref(tokens.bookingUrl);
  const inlineBooking = booking ? `[book a time](${booking.replace(/\(/g, '%28').replace(/\)/g, '%29')})` : '';
  const images = extras.images || {};
  const out: string[] = [];
  let chunk: string[] = [];
  const flush = () => { if (chunk.length) { const h = renderMarkdown(chunk.join('\n')); if (h) out.push(h); chunk = []; } };
  for (const line of renderMergeTokens(bodyMarkdown, tokens).split('\n')) {
    const t = line.trim();
    if (BOOKING_LINE_RE.test(t)) { flush(); if (booking) out.push(bookingButton(booking, extras.accent || '')); continue; }
    const im = t.match(IMAGE_LINE_RE);
    if (im) { flush(); const src = images[im[2].toLowerCase()]; if (src) out.push(imageBlock(src, im[1])); continue; }
    chunk.push(line.replace(BOOKING_TOKEN_RE, inlineBooking));
  }
  flush();
  return out.join('\n');
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

// ── S4 (final pass, Nov 8): a picked list only reaches the studio's own people ──
/** Split picked people into those who are THIS studio's own (their address is one
 *  of its contacts, enquiries or customers) and those who aren't. Case-insensitive.
 *  Pure. */
export function keepKnown<T extends { email?: unknown }>(people: T[], known: Set<string>): { kept: T[]; dropped: number } {
  const kept: T[] = [];
  let dropped = 0;
  for (const p of people || []) {
    if (known.has(String(p?.email ?? '').trim().toLowerCase())) kept.push(p);
    else dropped++;
  }
  return { kept, dropped };
}

/** S4: every studio can reach at most this many people with updates in any 24
 *  hours — one update at the biggest audience size, never the 25,000 that 50 picked
 *  lists of 500 could add up to. BROADCAST_DAILY_CAP overrides it. */
export function dailySendCap(): number {
  const n = Number(Deno.env.get('BROADCAST_DAILY_CAP') || '');
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5000;
}
/** Would sending to `n` more people break the cap, given `used` in the last 24 hours? Pure. */
export function overDailyCap(used: number, n: number, cap: number): boolean { return used + n > cap; }
/** The words a studio sees when an update would break the cap. Pure. */
export function dailyCapMessage(used: number, n: number, cap: number): string {
  const f = (x: number) => x.toLocaleString('en-US');
  return `Updates can reach ${f(cap)} people a day. ${f(used)} already went out in the last 24 hours, and this one would reach ${f(n)}. Send it tomorrow, or send it to fewer people.`;
}
/** Thrown by dispatchBroadcast when the cap would break: the caller holds the send, it is not a failure. */
export class DailyCapError extends Error {
  constructor(public used: number, public n: number, public cap: number) { super('daily_cap'); }
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
export async function fetchAudienceRows(siteId: string, key: AudienceKey, opts: { strict?: boolean } = {}): Promise<Array<{ email?: string; name?: string }>> {
  // final pass (Nov 8, batch D): strict, a failed read throws instead of reading as nobody
  // (the audience picker showed "Contacts · 0" when the contacts couldn't be read)
  const need = async (path: string) => { const r = await svc(path); if (opts.strict && !r.ok) throw new Error('audience_read_failed'); return rows(r); };
  if (isListKey(key)) {
    const l = (await loadPickedLists(siteId)).find((x) => `list:${x.id}` === key);
    if (!l) return [];   // a removed list reaches no one
    // S4: only the studio's own people, also for a list saved before this check.
    // Strict: if they can't be read, this throws, so nothing goes to strangers.
    return keepKnown(l.people, await knownEmails(siteId)).kept.slice(0, RECIPIENT_CAP);
  }
  if (key === 'customers') {
    // the studio's active service links prove who is a customer of THIS site
    const links = await need(`presence_service_links?agency_site_id=eq.${siteId}&status=eq.active&select=customer_client_id&limit=${RECIPIENT_CAP}`);
    const ids = [...new Set(links.map((l: any) => String(l.customer_client_id || '')).filter((x) => /^[0-9a-f-]{36}$/i.test(x)))];
    if (!ids.length) return [];
    return (await need(`clients?id=in.(${ids.join(',')})&select=name,email,contact_email`)).map((c: any) => ({ email: c.email || c.contact_email || '', name: c.name || '' }));
  }
  if (key === 'contacts') {
    return await need(`presence_contacts?site_id=eq.${siteId}&deleted_at=is.null&select=email,name&limit=${RECIPIENT_CAP}`);
  }
  if (key === 'subscribers') {   // item 146: contacts who joined the list (migration 0157)
    return await need(`presence_contacts?site_id=eq.${siteId}&deleted_at=is.null&subscribed_at=not.is.null&select=email,name&limit=${RECIPIENT_CAP}`);
  }
  const base = `presence_form_submissions?site_id=eq.${siteId}&spam=is.false&select=email,name,created_at`;
  if (key === 'enquiries_30d') {
    const since = new Date(Date.now() - 30 * 86400_000).toISOString();
    return await need(`${base}&created_at=gte.${encodeURIComponent(since)}&limit=${RECIPIENT_CAP}`);
  }
  return await need(`${base}&limit=${RECIPIENT_CAP}`);   // 'enquiries'
}

/** S4: the addresses that are THIS studio's own people: its contacts, its
 *  enquiries and its customers (the same reads as those audiences). Strict: a read
 *  that fails throws; it never reads as "nobody" or "everybody". */
export async function knownEmails(siteId: string): Promise<Set<string>> {
  const all = await Promise.all((['contacts', 'enquiries', 'customers'] as const).map((k) => fetchAudienceRows(siteId, k, { strict: true })));
  return new Set(normalizeRecipients(all.flat()).map((r) => r.email));
}

/** S4: how many people this studio's updates reached in the last 24 hours (updates
 *  that finished, plus any still going out). Throws when it can't be read. */
export async function sentInLastDay(siteId: string, nowMs = Date.now(), notId = ''): Promise<number> {
  const since = new Date(nowMs - 86400_000).toISOString();
  const others = /^[0-9a-f-]{36}$/i.test(notId) ? `&id=neq.${notId}` : '';   // never count the update being sent
  const [done, going] = await Promise.all([
    svc(`presence_broadcasts?site_id=eq.${siteId}&status=eq.sent&sent_at=gte.${encodeURIComponent(since)}&select=sent_count&limit=1000`),
    svc(`presence_broadcasts?site_id=eq.${siteId}&status=eq.sending${others}&select=recipient_count&limit=100`),
  ]);
  if (!done.ok || !going.ok) throw new Error('send_log_unavailable');
  return rows(done).reduce((n, b: any) => n + (Number(b.sent_count) || 0), 0) + rows(going).reduce((n, b: any) => n + (Number(b.recipient_count) || 0), 0);
}

export interface SendableDeps {
  fetchRows?: (key: AudienceKey) => Promise<Array<{ email?: string; name?: string }>>;
  isSuppressed?: (email: string) => Promise<boolean>;
}

/** The HONEST recipient set: distinct valid addresses MINUS anyone suppressed or
 *  opted-out. A broadcast must never mail a suppressed contact, so we filter here
 *  (up front, for the count the owner sees) AND again at the ONE send point. Deps
 *  are injectable so the whole thing is tested without a database. */
export async function resolveSendable(siteId: string, key: AudienceKey, deps: SendableDeps = {}): Promise<{ recipients: Recipient[]; suppressed: number; audience: number }> {
  const fetchRows = deps.fetchRows || ((k: AudienceKey) => fetchAudienceRows(siteId, k));
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
export async function audienceCount(siteId: string, key: AudienceKey, opts: { strict?: boolean } = {}): Promise<number> {
  return normalizeRecipients(await fetchAudienceRows(siteId, key, opts)).length;
}

export interface BroadcastRow { id: string; site_id: string; subject: string; body: string; audience: AudienceKey; status?: string }

export interface DispatchDeps extends SendableDeps {
  loadBrand?: (siteId: string) => Promise<EmailBrand>;
  sendFn?: (to: string, subject: string, html: string, brand?: EmailBrand, opts?: { critical?: boolean; asBusiness?: boolean; siteId?: string; headers?: Record<string, string> }) => Promise<boolean>;
  // claim a per-recipient send slot: 'inserted' (or { id } — the new row, item 69's
  // open counter needs it) = go ahead, 'duplicate' = already sent (skip — the
  // send-once guard), 'error' = infra failure.
  claimFn?: (broadcastId: string, siteId: string, email: string) => Promise<Claim>;
  pixelFn?: (sendId: string) => Promise<string>;
  markFailedFn?: (broadcastId: string, email: string) => Promise<void>;
  recordSkippedFn?: (broadcastId: string, siteId: string, email: string) => Promise<void>;
  resolveFn?: (siteId: string, key: AudienceKey) => Promise<{ recipients: Recipient[]; suppressed: number; audience: number }>;
  sentInLastDayFn?: (siteId: string, notId: string) => Promise<number>;
  dailyCap?: number;
  // the booking link and photo links the message needs (lib/update_media.ts)
  extrasFn?: (siteId: string, body: unknown) => Promise<UpdateExtras>;
}

export type Claim = 'inserted' | { id: string } | 'duplicate' | 'error';
/** Insert a send-log row, ignoring duplicates. The unique(broadcast_id, lower(email))
 *  index makes this the send-once guard: an already-mailed address returns an empty
 *  representation ⇒ 'duplicate'. A new row answers with its id. */
async function defaultClaim(broadcastId: string, siteId: string, email: string): Promise<Claim> {
  const r = await svc('presence_broadcast_sends', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({ broadcast_id: broadcastId, site_id: siteId, email: email.toLowerCase(), status: 'sent' }),
  });
  if (!r.ok) return 'error';
  if (!Array.isArray(r.json) || !r.json.length) return 'duplicate';
  const id = String(r.json[0]?.id || '');
  return id ? { id } : 'inserted';
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
  const resolve = deps.resolveFn || ((siteId: string, key: AudienceKey) => resolveSendable(siteId, key, deps));

  const brand = await loadBrand(b.site_id);
  const businessName = brand?.name || 'us';
  const extras = await (deps.extrasFn || loadUpdateExtras)(b.site_id, b.body).catch(() => ({ bookingUrl: '', images: {} }));
  const { recipients, suppressed } = await resolve(b.site_id, b.audience);
  // S4: the daily cap, checked right before anything goes out (the callers check it
  // earlier for a clear message; this catches two sends racing). Not a failure: the
  // caller holds the update until the day allows it.
  const cap = deps.dailyCap ?? dailySendCap();
  const used = await (deps.sentInLastDayFn || ((siteId: string, notId: string) => sentInLastDay(siteId, Date.now(), notId)))(b.site_id, b.id);
  if (overDailyCap(used, recipients.length, cap)) throw new DailyCapError(used, recipients.length, cap);

  let sent = 0, failed = 0, already = 0;
  for (const r of recipients) {
    const c = await claim(b.id, b.site_id, r.email);
    if (c === 'duplicate') { already++; continue; }   // send-once guard: already mailed
    if (c === 'error') { failed++; continue; }
    const tokens: MergeTokens = { firstName: r.firstName, businessName, bookingUrl: extras.bookingUrl };
    // Item 69: the open counter — a 1×1 image naming this send's row (lib/email_engagement.ts).
    const pixel = typeof c === 'object' ? openPixelTag(await (deps.pixelFn || openPixelUrl)(c.id).catch(() => '')) : '';
    // sendEmail is the ONE send point: it re-checks suppression and attaches the
    // RFC-8058 one-click List-Unsubscribe header — inherited, never re-implemented.
    // R1: pass the broadcast's own site so a recipient's REPLY lands on that
    // site's inbound address (<siteId>@<inbound-domain>) → /email/inbound.
    // Sales item 78: an update comes from the business that wrote it (its name as the sender, its footer)
    const ok = await send(r.email, renderSubject(b.subject, tokens), buildEmailHtml(b.body, tokens, { images: extras.images, accent: brand?.accent }) + pixel, brand, { siteId: b.site_id, asBusiness: true });
    if (ok) sent++;
    else { failed++; await markFailed(b.id, r.email).catch(() => {}); }
  }
  void recordSkipped;   // audit hook (skipped count is authoritative for the summary)
  return { sent, failed, already, skipped: suppressed, recipients: recipients.length };
}

/** "Send me a test" (bold redesign, Nov 2026): the draft to ONE address — the
 *  signed-in person's own; the route never takes an address from the request —
 *  through the ONE send point (suppression + one-click unsubscribe inherited),
 *  the subject marked [Test], the fill-ins as the preview shows them ("there").
 *  Nothing is claimed, counted or recorded: a test never touches the send-once
 *  guard, the daily cap, the open counter or the history. */
export async function sendBroadcastTest(b: BroadcastRow, to: string, deps: Pick<DispatchDeps, 'loadBrand' | 'sendFn' | 'extrasFn'> = {}): Promise<boolean> {
  const loadBrand = deps.loadBrand || loadEmailBrand;
  const send = deps.sendFn || sendEmail;
  const brand = await loadBrand(b.site_id);
  const extras = await (deps.extrasFn || loadUpdateExtras)(b.site_id, b.body).catch(() => ({ bookingUrl: '', images: {} }));
  const tokens: MergeTokens = { firstName: 'there', businessName: brand?.name || 'us', bookingUrl: extras.bookingUrl };
  return send(to, '[Test] ' + renderSubject(b.subject, tokens), buildEmailHtml(b.body, tokens, { images: extras.images, accent: brand?.accent }), brand, { siteId: b.site_id, asBusiness: true });
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
      const res = await dispatchBroadcast(claimed);   // throws DailyCapError when today's cap would break
      await svc(`presence_broadcasts?id=eq.${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'sent', sent_at: new Date().toISOString(), recipient_count: res.recipients, sent_count: res.sent, skipped_count: res.skipped, failed_count: res.failed, updated_at: new Date().toISOString() }),
      }).catch(() => {});
      dispatched++; sent += res.sent; failures += res.failed;
    } catch (e) {
      // S4: a capped update simply waits: it goes out on a later tick, once the last
      // 24 hours allow it. That is not a failure (it must not page the health check).
      if (!(e instanceof DailyCapError)) failures++;
      // release the claim so the next tick retries (per-recipient guard prevents double-mail)
      await svc(`presence_broadcasts?id=eq.${row.id}&status=eq.sending`, { method: 'PATCH', body: JSON.stringify({ status: 'scheduled', updated_at: new Date().toISOString() }) }).catch(() => {});
    }
  }
  return { dispatched, sent, failures };
}
