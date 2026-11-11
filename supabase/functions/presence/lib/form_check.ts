// ── Builder list item 140: stronger spam protection on a client's site ───────
// One hidden box (only robots fill it) and a per-minute limit stopped only the simplest
// robots, and one that skipped the box could hold real booking times. Three checks more,
// all our own: nothing loads from another company, no cookies, so a site's "no cookie
// banner" stays true.
//   1. A time ticket. When a visitor starts on a form, or opens booking, the page asks
//      our server for a ticket, signed and stamped with the time, and sends it with the
//      form (lib/site_send.ts). A send with no ticket, a forged or old one, or one under
//      three seconds old (faster than anyone types) didn't come from a person on the
//      page. A form keeps it in Spam, and the robot sees "thank you"; booking refuses
//      it, so no robot holds a time.
//   2. Words: a web link in the name box, or three or more links in a message.
//   3. Memory: once the owner marks a message as spam (the Inbox's Spam button, or the
//      "This was spam" link in the alert email), more from that email address goes to
//      Spam. Not spam forgets it. Only a hash of the address is kept.
// Nothing is thrown away: the Inbox's enquiries have a Spam filter with Not spam.
// The ticket check starts for a site at its first publish with this code, since only
// then do its pages carry the sender that asks for tickets: older live pages lose nothing.
import { hmacHex, timingSafeEqual } from '../../_shared/hmac.ts';
import { readReservedJson, updateReservedJson, RESERVED_NAMES } from './reserved_store.ts';

/** A ticket younger than this came from something faster than a person. */
export const TICKET_MIN_AGE_S = 3;
/** And one older than this is stale: the page asks again after 11 hours. */
export const TICKET_MAX_AGE_S = 24 * 3600;
const signingKey = () => Deno.env.get('APPROVAL_SECRET') || Deno.env.get('SCHEDULER_SECRET') || '';
/** Without a signing key no ticket can be issued, so none is asked for. */
export const ticketsOn = (): boolean => !!signingKey();

/** "<seconds>.<signature>" for this site at this time; empty when no key is set. */
export async function issueTicket(siteId: string, nowSec: number, key = signingKey()): Promise<string> {
  if (!key) return '';
  return `${nowSec}.${(await hmacHex(key, `form-ticket|${siteId}|${nowSec}`)).slice(0, 32)}`;
}

export type TicketState = 'ok' | 'missing' | 'bad' | 'too_fast' | 'stale';
export async function readTicket(ticket: unknown, siteId: string, nowSec: number, key = signingKey()): Promise<TicketState> {
  const t = String(ticket ?? '').trim();
  if (!t) return 'missing';
  const m = /^(\d{9,11})\.([0-9a-f]{32})$/.exec(t);
  if (!m || !key) return 'bad';
  const issued = Number(m[1]);
  if (!timingSafeEqual(m[2], (await hmacHex(key, `form-ticket|${siteId}|${issued}`)).slice(0, 32))) return 'bad';
  const age = nowSec - issued;
  if (age < TICKET_MIN_AGE_S) return 'too_fast';
  return age > TICKET_MAX_AGE_S ? 'stale' : 'ok';
}

/** A link in the name box, or three or more in the message: a robot's or a pitch's mark. */
export function wordsLookLikeSpam(name: unknown, message: unknown): 'link_in_name' | 'many_links' | null {
  if (/https?:\/\/|www\./i.test(String(name ?? ''))) return 'link_in_name';
  return (String(message ?? '').match(/https?:\/\/|www\./gi) || []).length >= 3 ? 'many_links' : null;
}

/** Why a message is in Spam, in the owner's words (the Inbox's Spam filter shows it). */
export const SPAM_REASONS: Record<string, string> = {
  trap: 'It filled in the hidden box only robots see.',
  no_check: 'It came without the check your site’s pages add: a robot sent it, or a browser with scripts turned off.',
  too_fast: 'It was sent faster than a person can type.',
  marked_before: 'It came from an address you marked as spam before.',
  link_in_name: 'It had a web link in the name box.',
  many_links: 'It was full of web links.',
  owner: 'You marked it as spam.',
};

/** Pure: the reason a send is spam, or null. The ticket counts only once the site checks. */
export function spamReason(i: { trap: boolean; ticket: TicketState; checking: boolean; known: boolean; words: string | null }): string | null {
  if (i.trap) return 'trap';
  if (i.checking && i.ticket !== 'ok') return i.ticket === 'too_fast' ? 'too_fast' : 'no_check';
  if (i.known) return 'marked_before';
  return i.words;
}

/** True an hour after the site first published pages that ask for tickets (set by
 *  routes/publish.ts): the hour lets a visitor who opened an older page finish sending. */
export const CHECK_GRACE_MS = 3600_000;
export async function siteChecksSends(siteId: string, nowMs = Date.now()): Promise<boolean> {
  const v = await readReservedJson(siteId, RESERVED_NAMES.formCheck);
  const since = v && typeof v === 'object' ? Date.parse(String((v as { since?: string }).since || '')) : NaN;
  return Number.isFinite(since) && nowMs - since >= CHECK_GRACE_MS;
}
/** Called after a successful publish: from now on this site's sends must carry a ticket. */
export async function startCheckingSends(siteId: string): Promise<void> {
  const v = await readReservedJson(siteId, RESERVED_NAMES.formCheck);
  if (v && typeof v === 'object' && (v as { since?: string }).since) return;
  await updateReservedJson(siteId, RESERVED_NAMES.formCheck, (cur) => (cur && typeof cur === 'object' && (cur as { since?: string }).since ? cur : { since: new Date().toISOString() }), 'system');
}

// ── the addresses an owner marked as spam, per site, as hashes ──
export const MARKED_SENDERS_MAX = 500;
export async function senderKey(email: unknown): Promise<string> {
  const e = String(email ?? '').trim().toLowerCase();
  if (!e) return '';
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`spam-sender|${e}`));
  return Array.from(new Uint8Array(d)).slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}
const keysOf = (v: unknown): string[] => (v && typeof v === 'object' && Array.isArray((v as { keys?: unknown }).keys) ? (v as { keys: unknown[] }).keys.map(String) : []);
export async function isMarkedSender(siteId: string, email: unknown): Promise<boolean> {
  const k = await senderKey(email);
  return !!k && keysOf(await readReservedJson(siteId, RESERVED_NAMES.spamSenders)).includes(k);
}
/** Remember (on) or forget (off) an address. The newest MARKED_SENDERS_MAX are kept. */
export async function markSender(siteId: string, email: unknown, on: boolean): Promise<void> {
  const k = await senderKey(email);
  if (!k) return;
  await updateReservedJson(siteId, RESERVED_NAMES.spamSenders, (cur) => {
    const keys = keysOf(cur).filter((x) => x !== k);
    return { keys: (on ? [...keys, k] : keys).slice(-MARKED_SENDERS_MAX) };
  }, 'system');
}

/** One read of everything a form send is judged on. Never throws: a failed read checks nothing. */
export async function judgeSend(siteId: string, s: { trap: boolean; ticket: unknown; email: unknown; name: unknown; message: unknown }, nowSec = Math.floor(Date.now() / 1000)): Promise<string | null> {
  const [checking, known, ticket] = await Promise.all([
    ticketsOn() ? siteChecksSends(siteId).catch(() => false) : false,
    isMarkedSender(siteId, s.email).catch(() => false),
    readTicket(s.ticket, siteId, nowSec),
  ]);
  return spamReason({ trap: s.trap, ticket, checking, known, words: wordsLookLikeSpam(s.name, s.message) });
}

// ── the "This was spam" link in the owner's alert email ──
// Signed, and good for 60 days. The page it opens (spam.html, on the app's address) asks
// before it marks, since mail scanners open links on their own.
export const SPAM_LINK_DAYS = 60;
const b64u = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s: string) => { try { return atob(s.replace(/-/g, '+').replace(/_/g, '/')); } catch { return ''; } };
export async function spamLinkToken(siteId: string, submissionId: string, nowSec = Math.floor(Date.now() / 1000), key = signingKey()): Promise<string> {
  if (!key) return '';
  const body = b64u(JSON.stringify({ s: siteId, f: submissionId, e: nowSec + SPAM_LINK_DAYS * 86400 }));
  return `${body}.${(await hmacHex(key, `spam-link|${body}`)).slice(0, 40)}`;
}
export async function readSpamLinkToken(token: unknown, nowSec = Math.floor(Date.now() / 1000), key = signingKey()): Promise<{ siteId: string; submissionId: string } | 'expired' | null> {
  const m = /^([A-Za-z0-9_-]{10,400})\.([0-9a-f]{40})$/.exec(String(token ?? '').trim());
  if (!m || !key || !timingSafeEqual(m[2], (await hmacHex(key, `spam-link|${m[1]}`)).slice(0, 40))) return null;
  let p: { s?: unknown; f?: unknown; e?: unknown };
  try { p = JSON.parse(unb64u(m[1])); } catch { return null; }
  const uuid = /^[0-9a-f-]{36}$/;
  if (!p || typeof p.s !== 'string' || typeof p.f !== 'string' || !uuid.test(p.s) || !uuid.test(p.f) || typeof p.e !== 'number') return null;
  return p.e < nowSec ? 'expired' : { siteId: p.s, submissionId: p.f };
}
