// ── A welcome email for each new person on a client's list (builder list item 221) ──
// Squarespace's "Welcome new subscribers" and Wix's welcome email (Nov 12 review, file 01
// finding 10, file 02 finding 6). Someone joins a client's list on their website and
// presses "Yes, add me" (lib/join_confirm.ts); right after, they get one welcome email
// from the business. It is on from the start, in standard words below; the owner or the
// studio changes the words, or switches it off, on Send an update.
//
// The setting is one reserved JSON row on the client's site (`__join_welcome__`), so no
// migration: { enabled, subject, body, updated_by, updated_at, sent, last_sent_at }. An
// empty subject or body means the standard words, so a later change to them reaches
// every site that never wrote its own. The words are written like an update's (first
// name, the business's name, the booking link, a line that is a link becomes a button)
// and drawn by the same renderer (lib/broadcast.ts), escape-first.
//
// It is list mail: the one-click unsubscribe header and a visible link (sendEmail,
// optional), from the business (asBusiness), and a reply reaches the owner's own address
// (items 72 and 78); the person joined a moment ago, so they are a contact of the site
// and the site's own reply address is the fallback when the owner has none.
import { readReservedJson, updateReservedJson, RESERVED_NAMES } from './reserved_store.ts';
import { renderSubject, buildEmailHtml, cleanBody, cleanSubject } from './broadcast.ts';
import { loadUpdateExtras } from './update_media.ts';
import { loadEmailBrand } from './email_brand.ts';
import { ownerReplyTo } from './service_bridge.ts';
import { sendEmail } from '../commerce/account.ts';
import { svc } from './db.ts';

export const WELCOME_SUBJECT = 'Welcome to {{business_name}}';
export const WELCOME_BODY = 'Hi {{first_name}},\n\nThanks for joining our list. You’ll hear from us now and then with news, offers and what’s new.\n\nReply to this email any time if you have a question.';
export const WELCOME_SUBJECT_MAX = 200;
export const WELCOME_BODY_MAX = 4000;

export interface WelcomeSetting {
  enabled: boolean;
  subject: string;             // '' = WELCOME_SUBJECT
  body: string;                // '' = WELCOME_BODY
  updated_by: string | null; updated_at: string | null;
  sent: number;                // welcome emails that went out, all time
  last_sent_at: string | null;
}

/** The stored setting, cleaned: on unless switched off, the standard words unless changed. Pure. */
export function normalizeWelcome(raw: unknown): WelcomeSetting {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const n = Math.trunc(Number(r.sent));
  return {
    enabled: r.enabled !== false,
    subject: cleanSubject(r.subject).slice(0, WELCOME_SUBJECT_MAX),
    body: cleanBody(r.body).trim().slice(0, WELCOME_BODY_MAX),
    updated_by: typeof r.updated_by === 'string' ? r.updated_by : null,
    updated_at: typeof r.updated_at === 'string' ? r.updated_at : null,
    sent: Number.isFinite(n) && n > 0 ? n : 0,
    last_sent_at: typeof r.last_sent_at === 'string' ? r.last_sent_at : null,
  };
}

/** The words that go out: the owner's, else the standard ones. Pure. */
export function welcomeWords(s: Pick<WelcomeSetting, 'subject' | 'body'>): { subject: string; body: string } {
  return { subject: s.subject || WELCOME_SUBJECT, body: s.body || WELCOME_BODY };
}

export interface WelcomeChange { enabled?: unknown; subject?: unknown; body?: unknown; standard?: unknown }
/** Apply what the card sent. `standard: true` puts the standard words back. Words that
 *  match the standard ones are kept as '' (standard), so they follow any later change.
 *  Pure. */
export function applyWelcomeChange(cur: WelcomeSetting, b: WelcomeChange, who: string | null, nowIso: string): { ok: true; setting: WelcomeSetting } | { ok: false; message: string } {
  const known = typeof b.enabled === 'boolean' || typeof b.subject === 'string' || typeof b.body === 'string' || b.standard === true;
  if (!known) return { ok: false, message: 'Say whether the welcome email is on, or give its words.' };
  const next: WelcomeSetting = { ...cur, updated_by: who, updated_at: nowIso };
  if (typeof b.enabled === 'boolean') next.enabled = b.enabled;
  if (b.standard === true) { next.subject = ''; next.body = ''; return { ok: true, setting: next }; }
  if (typeof b.subject === 'string') {
    const s = cleanSubject(b.subject);
    if (s.length > WELCOME_SUBJECT_MAX) return { ok: false, message: `Keep the subject under ${WELCOME_SUBJECT_MAX} characters.` };
    if (!s) return { ok: false, message: 'Give it a subject, or put the standard words back.' };
    next.subject = s === WELCOME_SUBJECT ? '' : s;
  }
  if (typeof b.body === 'string') {
    if (String(b.body).length > WELCOME_BODY_MAX) return { ok: false, message: `Keep the message under ${WELCOME_BODY_MAX.toLocaleString('en-US')} characters.` };
    const t = cleanBody(b.body).trim();
    if (!t) return { ok: false, message: 'Write the message, or put the standard words back.' };
    next.body = t === WELCOME_BODY ? '' : t;
  }
  return { ok: true, setting: next };
}

/** The email for one person: the words with their fill-ins, drawn like an update. Pure. */
export function welcomeEmail(words: { subject: string; body: string }, o: { firstName?: string; businessName: string; bookingUrl?: string; images?: Record<string, string>; accent?: string }): { subject: string; html: string } {
  const tokens = { firstName: o.firstName || '', businessName: o.businessName, bookingUrl: o.bookingUrl || '' };
  return { subject: renderSubject(words.subject, tokens), html: buildEmailHtml(words.body, tokens, { images: o.images, accent: o.accent }) };
}

export async function readWelcome(siteId: string): Promise<WelcomeSetting> {
  return normalizeWelcome(await readReservedJson(siteId, RESERVED_NAMES.joinWelcome));
}

/** The business as its visitors know it: the business details, else its brand. */
export async function welcomeBusiness(siteId: string, brandName: string): Promise<string> {
  const ident = await svc(`presence_identity?site_id=eq.${siteId}&select=business_name&limit=1`).catch(() => null);
  return String((ident && Array.isArray(ident.json) && ident.json[0]?.business_name) || brandName || '').trim();
}

/** Compose and send the welcome email to `to`, with these words. `test` marks the subject
 *  [Test] and counts nothing. True when it went. */
export async function sendWelcomeTo(siteId: string, to: string, words: { subject: string; body: string }, opts: { firstName?: string; test?: boolean } = {}): Promise<boolean> {
  const brand = await loadEmailBrand(siteId);
  const [business, extras, replyTo] = await Promise.all([
    welcomeBusiness(siteId, brand.name),
    loadUpdateExtras(siteId, words.body).catch(() => ({ bookingUrl: '', images: {} })),
    ownerReplyTo(siteId),
  ]);
  const mail = welcomeEmail(words, { firstName: opts.firstName, businessName: business, bookingUrl: extras.bookingUrl, images: extras.images, accent: brand.accent });
  return await sendEmail(to, (opts.test ? '[Test] ' : '') + mail.subject, mail.html, brand, { asBusiness: true, siteId, replyTo });
}

/** Right after someone presses "Yes, add me" (routes/commercial.ts handleJoinPost): their
 *  welcome email, when the site has it on, then the count the card shows. Never throws;
 *  says what happened. */
export async function sendJoinWelcome(siteId: string, email: string, nowIso = new Date().toISOString()): Promise<'sent' | 'off' | 'failed'> {
  try {
    const s = await readWelcome(siteId);
    if (!s.enabled) return 'off';
    const ok = await sendWelcomeTo(siteId, email, welcomeWords(s));
    if (!ok) return 'failed';
    await updateReservedJson(siteId, RESERVED_NAMES.joinWelcome, (cur) => {
      const c = normalizeWelcome(cur);
      return { ...c, sent: c.sent + 1, last_sent_at: nowIso };
    }, 'join-welcome').catch(() => null);
    return 'sent';
  } catch { return 'failed'; }
}
