// ── Follow-ups that go out on their own (sales item 87, Nov 2026 review) ─────
// File 01 finding 6: after the one automatic acknowledgement a person who wrote
// in heard nothing more unless the owner wrote. File 07 finding 14: the
// acknowledgement itself was off unless someone found the switch. Wix's
// Automations open on ready-made recipes; these are ours:
//   · a quiet enquiry gets two short follow-ups, in the owner's words (day 3 and
//     day 7 by default), and stops the moment the person writes again, books, or
//     the owner marks the enquiry or presses Stop follow-ups;
//   · an overdue invoice gets a second reminder a week after the first;
//   · a proposal or estimate gets one note a week before it runs out.
// Every one of them is a switch on the site's settings (migration 0175), off
// until the owner turns it on; the acknowledgement alone starts on for a new
// site. Pure: no I/O, no clock — commerce/lifecycle.ts does the reads and sends.
//
// NOTHING GOES TWICE. Each email has one ledger row (presence_plan_notices,
// unique per client · kind · period) raised before it is sent, exactly like the
// invoice and document reminders: `enqfollow:<enquiry>:<n>` and `expiry:<doc>`.
// A person with two enquiries gets one series, for the newest.

const DAY = 86_400_000;
const ymdOf = (x: unknown): string | null => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(x || '')); return m ? m[1] : null; };
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

// ── the follow-up series ─────────────────────────────────────────────────────
export const FOLLOWUP_DEFAULT_DAYS: readonly [number, number] = [3, 7];
/** What each follow-up says when the owner hasn't written their own. settings.html
 *  shows these as the placeholders (tests/presence/follow_ups_test.mjs pins the pair). */
export const FOLLOWUP_WORDS: readonly [string, string] = [
  'Just checking in on your message. If you still need a hand, reply to this email and we’ll pick it up straight away.',
  'One last note from us about your message. If the timing isn’t right, no problem at all. Whenever you’re ready, just reply.',
];
export const FOLLOWUP_WORDS_MAX = 1200;
/** An enquiry the owner has settled: made a deal or a customer, Not a fit, or archived. */
export const FOLLOWUP_STOP_STATUSES: ReadonlySet<string> = new Set(['converted', 'not_a_fit', 'archived']);

export interface FollowupSettings { on: boolean; days: [number, number]; words: [string, string] }
/** The two days, made sane: the first 1–14, the second 2–30 and at least two days
 *  after the first (so the two never land on the same day, or the day after). Pure. */
export function followupDays(a: unknown, b: unknown): [number, number] {
  const int = (v: unknown, d: number) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? n : d; };
  const first = Math.min(14, Math.max(1, int(a, FOLLOWUP_DEFAULT_DAYS[0])));
  const second = Math.min(30, Math.max(first + 2, int(b, FOLLOWUP_DEFAULT_DAYS[1])));
  return [first, second];
}
/** The owner's own words for one follow-up, or '' for the standard ones. Pure. */
export function followupWords(v: unknown): string {
  return String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').trim().slice(0, FOLLOWUP_WORDS_MAX);
}

export interface FollowupEnquiry { created_at?: unknown; status?: unknown; spam?: unknown; email?: unknown }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Which follow-up (1 or 2) is due for this enquiry now, or null. `sent` holds when
 *  each one went (from the enquiry's own record of them). A follow-up has a window,
 *  so switching the recipe on never emails people who wrote weeks ago: the first
 *  goes from its day until the second's day; the second from its day for a week, and
 *  never within two days of the first. Pure. */
export function followupStepDue(sub: FollowupEnquiry, nowMs: number, cfg: FollowupSettings, sent: { 1?: string | null; 2?: string | null }): 1 | 2 | null {
  if (!cfg.on || sub.spam === true) return null;
  if (!EMAIL_RE.test(String(sub.email || '').trim())) return null;
  if (FOLLOWUP_STOP_STATUSES.has(String(sub.status || 'new'))) return null;
  const at = Date.parse(String(sub.created_at || ''));
  if (!Number.isFinite(at)) return null;
  const age = (nowMs - at) / DAY;
  const [d1, d2] = cfg.days;
  if (!sent[1]) return age >= d1 && age < d2 ? 1 : null;
  if (sent[2]) return null;
  const firstAt = Date.parse(String(sent[1]));
  if (Number.isFinite(firstAt) && (nowMs - firstAt) / DAY < 2) return null;
  return age >= d2 && age < d2 + 7 ? 2 : null;
}

/** Why a series stopped, or null while it may go on. The owner's marks first, then
 *  what the person did. Pure. */
export type FollowupStop = 'marked' | 'spam' | 'off' | 'wrote_again' | 'booked' | 'wrote_back';
export function followupStopReason(sub: FollowupEnquiry, s: { off?: boolean; laterEnquiry?: boolean; booked?: boolean; wroteBack?: boolean }): FollowupStop | null {
  if (sub.spam === true) return 'spam';
  if (FOLLOWUP_STOP_STATUSES.has(String(sub.status || 'new'))) return 'marked';
  if (s.off) return 'off';
  if (s.laterEnquiry) return 'wrote_again';
  if (s.booked) return 'booked';
  if (s.wroteBack) return 'wrote_back';
  return null;
}
/** The words the Inbox shows for a stopped series. Pure. */
export const FOLLOWUP_STOP_WORDS: Record<FollowupStop, string> = {
  marked: 'Follow-ups stopped: you marked this enquiry.',
  spam: 'No follow-ups: this is in Spam.',
  off: 'Follow-ups stopped by you.',
  wrote_again: 'Follow-ups stopped: they wrote again.',
  booked: 'Follow-ups stopped: they booked.',
  wrote_back: 'Follow-ups stopped: they wrote back.',
};

/** What the Inbox shows on one enquiry: the follow-ups that went (the enquiry's own
 *  list, fields.__followups), whether the owner stopped them, and when the next one
 *  goes while the switch is on ("unless they write back, book or you mark it": the
 *  sweep checks those at the time). Pure. */
export interface FollowupView { sent: Array<{ n: 1 | 2; at: string }>; off: boolean; next: { n: 1 | 2; at: string } | null }
export function followupPlan(sub: FollowupEnquiry, fields: unknown, cfg: FollowupSettings, nowMs: number): FollowupView {
  const f = fields && typeof fields === 'object' ? fields as Record<string, unknown> : {};
  const sent = (Array.isArray(f.__followups) ? f.__followups : [])
    .filter((x: any) => x && (x.n === 1 || x.n === 2) && typeof x.at === 'string')
    .map((x: any) => ({ n: x.n as 1 | 2, at: String(x.at) }))
    .sort((a, b) => a.n - b.n);
  const off = f.__followups_off === true;
  let next: FollowupView['next'] = null;
  const created = Date.parse(String(sub.created_at || ''));
  if (cfg.on && !off && sub.spam !== true && EMAIL_RE.test(String(sub.email || '').trim()) && !FOLLOWUP_STOP_STATUSES.has(String(sub.status || 'new')) && Number.isFinite(created)) {
    const has = (n: number) => sent.some((x) => x.n === n);
    const [d1, d2] = cfg.days;
    if (!has(1) && nowMs < created + d2 * DAY) next = { n: 1, at: new Date(Math.max(nowMs, created + d1 * DAY)).toISOString() };
    else if (has(1) && !has(2) && nowMs < created + (d2 + 7) * DAY) next = { n: 2, at: new Date(Math.max(nowMs, created + d2 * DAY)).toISOString() };
  }
  return { sent, off, next };
}

/** What the person wrote, safe to send back to them: links taken out (a form must
 *  never become a way to mail someone else's links to a stranger's address), spaces
 *  tidied, at most `max` characters. Pure. */
export function echoOfMessage(message: unknown, max = 600): string {
  let t = String(message ?? '').replace(/\r\n?/g, '\n');
  // web addresses, with or without https:// (an email address keeps its domain)
  t = t.replace(/\b(?:https?:\/\/|www\.)\S+/gi, '[link]').replace(/(?<![@\w.-])[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|info|biz|xyz|ru|cn|top|site|online|shop|app|dev)\b(?:\/\S*)?/gi, '[link]');
  t = t.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}
/** "You wrote:" and the quote, as email HTML; '' when there is nothing to quote. Pure. */
export function quoteBlock(message: unknown, label = 'You wrote:'): string {
  const t = echoOfMessage(message);
  if (!t) return '';
  return `<p style="margin-top:18px;color:#6b6478;font-size:13px">${esc(label)}</p><blockquote style="margin:0;padding-left:12px;border-left:3px solid #e2dff0;color:#6b6478;font-size:13px">${esc(t).replace(/\n/g, '<br>')}</blockquote>`;
}
/** Paragraphs from the owner's words: a blank line starts a new one. Pure. */
export function wordsHtml(words: string): string {
  return String(words || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
}
const firstName = (name: unknown) => String(name || '').trim().split(/\s+/)[0] || '';

/** One follow-up email: a greeting, the owner's words (or ours), and what they
 *  wrote, so they know what it is about. Pure. */
export function followupEmail(step: 1 | 2, o: { name?: unknown; business?: unknown; words?: unknown; message?: unknown }): { subject: string; html: string } {
  const biz = String(o.business || '').trim();
  const words = followupWords(o.words) || FOLLOWUP_WORDS[step - 1];
  const hi = firstName(o.name);
  const subject = step === 1 ? (biz ? `Following up on your message — ${biz}` : 'Following up on your message') : (biz ? `One last note — ${biz}` : 'One last note about your message');
  return { subject, html: `<p>${hi ? `Hi ${esc(hi)},` : 'Hi,'}</p>${wordsHtml(words)}${quoteBlock(o.message, 'Your message:')}` };
}

// ── the quote-expiry heads-up ────────────────────────────────────────────────
export const QUOTE_EXPIRY_LEAD_DAYS = 7;
/** A sent proposal or estimate is due its one heads-up when it runs out within the
 *  next week (and hasn't yet). A replaced proposal never is. Pure. */
export function quoteExpiryDue(doc: { status?: unknown; expires_at?: unknown; superseded?: boolean }, nowMs: number): boolean {
  if (String(doc.status || '') !== 'sent' || doc.superseded) return false;
  const exp = Date.parse(String(doc.expires_at || ''));
  if (!Number.isFinite(exp)) return false;
  return exp > nowMs && exp - nowMs <= QUOTE_EXPIRY_LEAD_DAYS * DAY;
}
/** "Good until Dec 11" in the business's words. Pure. */
export function quoteExpiryCopy(kind: 'proposal' | 'estimate', title: unknown, expiresAt: unknown, tz?: string | null): { subject: string; line: string } {
  const what = kind === 'estimate' ? 'estimate' : 'proposal';
  const t = String(title || '').trim();
  const ymd = ymdOf(expiresAt);
  let day = ymd || '';
  try {
    const at = Date.parse(String(expiresAt || ''));
    if (Number.isFinite(at)) day = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/Los_Angeles', month: 'long', day: 'numeric' }).format(new Date(at));
  } catch { /* the plain date */ }
  return {
    subject: `Good until ${day}${t ? ` — ${t}` : ''}`,
    line: `A quick note: your ${what}${t ? ` for <strong>${esc(t)}</strong>` : ''} is good until <strong>${esc(day)}</strong>, a week from now. Here’s the link if you’d like another look.`,
  };
}
