// ── Commercial V1 features — pure cores (Phase F) ────────────────────────────
// The tested logic behind the three Product-Review-approved commercial features:
//   FD-1 scheduled publish/expiry · FD-2 lead capture · FD-3 one-tap approve.
// Pure (no I/O except the token HMAC via Web Crypto). Reuses existing spines —
// no new architecture: scheduled runs fire the ONE publish pipeline; forms feed
// the CRM timeline; one-tap approve calls the existing decide logic via a signed
// stateless token.

// ── FD-1: scheduling ─────────────────────────────────────────────────────────
export type ScheduleKind = 'publish' | 'revert';   // publish a captured draft · revert to a prior version (expiry)
export function isScheduleKind(x: unknown): x is ScheduleKind { return x === 'publish' || x === 'revert'; }

/** A scheduled action is due when its time has arrived (and it's still pending). */
export function isDue(scheduledFor: string, nowIso: string): boolean {
  const t = Date.parse(scheduledFor), now = Date.parse(nowIso);
  return isFinite(t) && isFinite(now) && t <= now;
}

/** Validate a requested schedule time: must parse and be in the future (with a
 *  small grace so "in 1 minute" works). Returns a normalized ISO or an error. */
export function validateScheduleTime(input: unknown, nowIso: string): { ok: true; iso: string } | { ok: false; error: string } {
  const t = Date.parse(String(input ?? ''));
  if (!isFinite(t)) return { ok: false, error: 'bad_time' };
  const now = Date.parse(nowIso);
  if (t < now - 60_000) return { ok: false, error: 'past' };            // >1 min in the past
  if (t > now + 400 * 86400_000) return { ok: false, error: 'too_far' }; // >~13 months out
  return { ok: true, iso: new Date(t).toISOString() };
}

// ── FD-2: form / lead capture ────────────────────────────────────────────────
export type FormKind = 'contact' | 'quote' | 'booking';
export function isFormKind(x: unknown): x is FormKind { return x === 'contact' || x === 'quote' || x === 'booking'; }

export interface CleanSubmission { form_kind: FormKind; name: string; email: string; phone: string; message: string; fields: Record<string, string>; source_page: string; }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clip = (s: unknown, n: number): string => {
  let o = ""; for (const ch of String(s ?? "")) { const c = ch.codePointAt(0)!; o += (c < 0x20 || c === 0x7f) ? " " : ch; }
  return o.trim().slice(0, n);
};

/** Phase V FD-N1: map a plain HTML form post (urlencoded/multipart) to the JSON
 *  submission shape. The published template posts `name`/`contact`/`message` —
 *  `contact` becomes email when it looks like one, else phone. Pure. */
export function formParamsToSubmission(get: (k: string) => string | null): any {
  const contact = String(get('contact') ?? '').trim();
  const looksEmail = EMAIL_RE.test(contact);
  return {
    form_kind: get('form_kind') ?? 'contact',
    name: get('name') ?? '',
    email: looksEmail ? contact : (get('email') ?? ''),
    phone: !looksEmail && contact ? contact : (get('phone') ?? ''),
    message: get('message') ?? '',
    source_page: get('source_page') ?? '',
    _hp: get('_hp') ?? '',
  };
}

/** Validate + sanitize a public form submission. Honeypot (`_hp`) marks spam
 *  without rejecting (so bots think they succeeded). Caps every field. */
export function validateSubmission(body: any): { ok: true; sub: CleanSubmission; spam: boolean } | { ok: false; error: string } {
  const form_kind: FormKind = isFormKind(body?.form_kind) ? body.form_kind : 'contact';
  const name = clip(body?.name, 120);
  const email = clip(body?.email, 200);
  const phone = clip(body?.phone, 40);
  const message = clip(body?.message, 4000);
  const source_page = clip(body?.source_page, 300);
  if (!email && !phone) return { ok: false, error: 'need_contact' };      // must be reachable somehow
  if (email && !EMAIL_RE.test(email)) return { ok: false, error: 'bad_email' };
  if (!message && form_kind === 'contact') return { ok: false, error: 'empty' };
  // extra declared fields (bounded)
  const fields: Record<string, string> = {};
  if (body?.fields && typeof body.fields === 'object') {
    let n = 0;
    for (const [k, v] of Object.entries(body.fields)) { if (n++ >= 20) break; fields[clip(k, 60)] = clip(v, 500); }
  }
  const spam = !!clip(body?._hp, 100);   // honeypot filled → spam
  return { ok: true, sub: { form_kind, name, email, phone, message, fields, source_page }, spam };
}

// ── Phase CRM (FD-CRM1): the un-replied lead follow-up nudge ──────────────────
// A lead emails the owner once on arrival. If it then sits un-actioned (still
// 'new', not spam) for a day, nothing tapped them until the WEEKLY digest — too
// slow for a hot quote. A lead deserves ONE calm follow-up nudge when it's aged
// at least a day but is still fresh enough to matter (under a week). Older-still-
// new leads are left to the digest; nudging about week-old leads would only
// annoy. Reply auto-marks a lead 'read', so 'new' is an honest "not yet dealt
// with" signal. Pure — the runner in commerce/lifecycle.ts raises the notice.
export function leadFollowupDue(lead: { status?: string; spam?: boolean; created_at?: string }, nowIso: string): boolean {
  if (lead?.status !== 'new' || lead?.spam) return false;
  const t = Date.parse(String(lead?.created_at ?? '')), now = Date.parse(nowIso);
  if (!isFinite(t) || !isFinite(now)) return false;
  const ageMs = now - t;
  return ageMs >= 24 * 3600_000 && ageMs <= 7 * 86400_000;
}

/** Calm, reply-oriented copy for the follow-up nudge — no pressure, no sales
 *  language, just "someone's waiting, a quick reply keeps them warm." Pure. */
export function leadFollowupCopy(form_kind: string, who: string): { headline: string; body: string; subject: string } {
  const label = form_kind === 'quote' ? 'A quote request' : form_kind === 'booking' ? 'A booking request' : 'A message';
  const name = (who || '').trim() || 'Someone';
  return {
    headline: `${label} is waiting for a reply`,
    body: `${name} reached out through your website about a day ago and hasn’t heard back yet. A quick reply keeps them warm — it only takes a minute.`,
    subject: `${label} is waiting for your reply`,
  };
}

/** PP-1: the follow-up nudge must represent reality. Acting on a lead — reply
 *  (auto-marks read), mark read, or archive — resolves it; a still-'new' lead
 *  does not. Pure. */
export function leadFollowupResolvesOn(status: string): boolean {
  return status === 'read' || status === 'archived';
}

/** PP-1: the exact notices-rail key for a lead's follow-up nudge. Because the
 *  period embeds the lead id, resolving one lead can never touch another's
 *  notice (or a notice of any other kind). Pure. */
export function leadFollowupNoticeKey(leadId: string): { kind: string; period: string } {
  return { kind: 'lead_followup', period: `lead:${leadId}` };
}

// ── PP-2 / CP-3.1: the annual renewal heads-up ───────────────────────────────
// Never surprise a customer with a yearly charge. For ANNUAL terms not already
// set to cancel, a calm reminder goes out ~30 days and again ~7 days before the
// renewal date. Informational, not sales. Pure decision; the runner sends it.
export interface RenewalView { term?: string | null; current_period_end?: string | null; cancel_at_period_end?: boolean; }
export function renewalReminderWindow(e: RenewalView, nowIso: string): 7 | 30 | null {
  if (e?.term !== 'annual' || e?.cancel_at_period_end || !e?.current_period_end) return null;
  const end = Date.parse(String(e.current_period_end)), now = Date.parse(nowIso);
  if (!isFinite(end) || !isFinite(now)) return null;
  const days = Math.floor((end - now) / 86400_000);
  if (days < 0) return null;
  if (days <= 7) return 7;
  if (days <= 30) return 30;
  return null;
}

/** The send-once key for a renewal reminder: one per renewal cycle per window,
 *  so the 30-day and 7-day notes each fire exactly once. Pure. */
export function renewalNoticePeriod(currentPeriodEndIso: string, window: 7 | 30): string {
  return `${String(currentPeriodEndIso).slice(0, 10)}:${window}`;
}

/** Calm, informational renewal copy — renewal date, plan, what they've built,
 *  and a link to manage the plan. No urgency, no upsell. Pure. */
export function renewalReminderCopy(planName: string, renewalDateIso: string, window: 7 | 30, publishedUpdates: number): { headline: string; body: string; subject: string } {
  const when = new Date(renewalDateIso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const lead = window === 7 ? `Your ${planName} plan renews on ${when}` : `A heads-up: your ${planName} plan renews ${when}`;
  const built = publishedUpdates > 0
    ? ` Over the past year your website published ${publishedUpdates} update${publishedUpdates === 1 ? '' : 's'} and stayed correct and online the whole way.`
    : ' Your website has stayed correct and online all year.';
  return {
    headline: lead,
    body: `${lead}, continuing your annual plan.${built} Nothing is needed from you — it renews automatically. If you'd like to review or change your plan, you can do that any time.`,
    subject: lead,
  };
}

// ── FD-3: one-tap approve — stateless signed token ───────────────────────────
// HMAC-SHA256 over the payload with a server secret; base64url; carries an expiry.
// No table: verification is pure crypto. The token authorizes exactly ONE decision
// on ONE plan; the decision itself still runs through the existing approval spine.
export interface ApprovalTokenPayload { site_id: string; kind: 'infrastructure' | 'connected'; plan_id: string; exp: number; }

function b64url(bytes: Uint8Array): string {
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBytes(s: string): Uint8Array {
  const t = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(t); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function hmac(data: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function signApprovalToken(p: ApprovalTokenPayload, secret: string): Promise<string> {
  const body = b64url(new TextEncoder().encode(JSON.stringify(p)));
  const sig = b64url(await hmac(body, secret));
  return `${body}.${sig}`;
}

export async function verifyApprovalToken(token: string, secret: string, nowSec: number): Promise<{ ok: true; payload: ApprovalTokenPayload } | { ok: false; error: string }> {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return { ok: false, error: 'malformed' };
  const [body, sig] = parts;
  const expected = await hmac(body, secret);
  if (!timingSafeEqual(b64urlToBytes(sig), expected)) return { ok: false, error: 'bad_signature' };
  let payload: ApprovalTokenPayload;
  try { payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(body))); } catch { return { ok: false, error: 'malformed' }; }
  if (!payload || typeof payload.exp !== 'number' || payload.exp < nowSec) return { ok: false, error: 'expired' };
  if (!payload.site_id || !payload.plan_id || (payload.kind !== 'infrastructure' && payload.kind !== 'connected')) return { ok: false, error: 'malformed' };
  return { ok: true, payload };
}
