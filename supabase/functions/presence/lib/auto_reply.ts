// ── One automatic reply a day to an address (builder list item 203) ──────────
// A website's automatic emails go to whatever address a visitor typed, under the
// business's name: the enquiry acknowledgement, a new booking's confirmation, and the
// "Yes, add me" email of Join our list. A stranger could type someone else's address
// again and again, and the complaints would land on the sending address every client
// shares. So a site sends each kind of automatic reply at most once a day (the UTC day)
// to an address, and none at all to an address on the do-not-send list for any reason:
// someone who unsubscribed, bounced or complained gets no automatic reply. Each kind
// counts on its own, so someone who writes in and then books the same day still gets
// their booking's confirmation.
//
// Builder list item 391 (Nov 22 2026 review, file 07 finding 10): one a day to an address
// still let a script send thousands a day, each to a different address. So a site also
// sends at most SITE_AUTO_REPLIES_PER_DAY automatic replies in a UTC day, all three kinds
// together. The 201st waits for the next day (the enquiry or booking itself still lands,
// only its email doesn't go), and the site's people and its studio hear it once that day
// (an `auto_reply_ceiling` notice: on the site's bell, and in the studio's news for the site).
//
// The day's count lives in the rate limiter's own table (rate_hit, migration 0008),
// under a salted hash of the address, so no address is stored for it, and the
// retention sweep clears the old days. An enquiry's acknowledgement and a list's
// confirmation are optional, so when the count can't be read nothing is sent; a
// booking's confirmation is the customer's own appointment, so it goes (failOpen).
import { linkKey } from '../../_shared/link_keys.ts';
import { svc } from './db.ts';
import { suppressionOf } from '../../_shared/email_infra.ts';
import { normEmail } from './contact_email.ts';

export const AUTO_REPLIES_PER_DAY = 1;
/** Builder item 391: every automatic reply a site sends in a UTC day, all kinds together. */
export const SITE_AUTO_REPLIES_PER_DAY = 200;
/** The automatic replies a visitor can set off, each counted on its own. */
export type AutoReplyKind = 'enquiry' | 'booking' | 'join';
const DAY_MS = 86_400_000;

/** send · unsubscribed (on the do-not-send list) · sent_today · site_ceiling (the site sent
 *  its day's SITE_AUTO_REPLIES_PER_DAY) · unchecked (the count couldn't be read, or there is
 *  no address). Only `send` sends. */
export type AutoReplyVerdict = 'send' | 'unsubscribed' | 'sent_today' | 'site_ceiling' | 'unchecked';

/** The start of the UTC day `nowMs` falls in: the count's window. Pure. */
export function dayWindow(nowMs: number): string {
  return new Date(Math.floor(nowMs / DAY_MS) * DAY_MS).toISOString();
}

const saltKey = () => linkKey('address_hash') || 'salt';   // builder item 394: its own key, never the scheduler's secret

/** The count's key for one kind of reply to one address on one site: a salted hash, never the address. */
export async function autoReplyBucket(kind: AutoReplyKind, siteId: string, email: string, salt = saltKey()): Promise<string> {
  const data = new TextEncoder().encode(`auto-reply|${normEmail(email)}|${salt}`);
  const hex = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data))).slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `autoreply:${kind}:${siteId}:${hex}`;
}

/** The two reads behind a verdict; tests swap them. `hit` counts one more and says whether
 *  it is still within `max` (true), over it (false), or couldn't tell (null). */
export const autoReplyDeps = {
  suppression: (email: string): Promise<string | null> => suppressionOf(email),
  hit: async (bucket: string, window: string, max: number): Promise<boolean | null> => {
    try {
      const r = await svc('rpc/rate_hit', { method: 'POST', body: JSON.stringify({ p_bucket: bucket.slice(0, 200), p_window: window, p_max: max }) });
      if (!r.ok) return null;
      return r.json === true ? true : r.json === false ? false : null;
    } catch { return null; }
  },
  now: () => Date.now(),
  /** Item 391: tell the site and its studio, once a UTC day (the notice's period is the day). */
  ceilingNotice: async (siteId: string, day: string): Promise<void> => {
    const r = await svc(`presence_sites?id=eq.${siteId}&select=id,client_id&limit=1`).catch(() => null);
    const clientId = r && r.ok && Array.isArray(r.json) ? r.json[0]?.client_id : null;
    if (!clientId) return;
    const { raiseNotice } = await import('./notice.ts');
    const w = ceilingWords(SITE_AUTO_REPLIES_PER_DAY);
    await raiseNotice({ siteId, clientId: String(clientId), kind: 'auto_reply_ceiling', period: `day:${day}`, headline: w.headline, body: w.body, push: false });
  },
};

const TOLD = new Set<string>();
/** Tests: forget which sites were told today. */
export function forgetCeilingNotices(): void { TOLD.clear(); }
/** The site's count for the day, all kinds together (item 391). Pure. */
export const siteCeilingBucket = (siteId: string) => `autoreply-site:${siteId}`;

/** The notice's words (item 391). Pure. */
export function ceilingWords(max: number): { headline: string; body: string } {
  return {
    headline: `Automatic replies paused for today: ${max} sent`,
    body: `Your website sent ${max} automatic emails today (thank-you notes, booking confirmations and list confirmations), the most it sends in a day, so no more go out today. Enquiries and bookings still arrive as usual; reply to anyone waiting yourself. This many in a day often means someone is sending your forms on purpose: look in Spam.`,
  };
}

/** May this site send this kind of automatic reply to `email` now? Counts the send when the
 *  answer is `send`, so ask only right before sending. */
export async function autoReplyVerdict(kind: AutoReplyKind, siteId: string, email: string, opts: { failOpen?: boolean } = {}): Promise<AutoReplyVerdict> {
  const addr = normEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return 'unchecked';
  // the do-not-send list first, so a refused address doesn't use up the day's reply
  if (await autoReplyDeps.suppression(addr).catch(() => null)) return 'unsubscribed';
  const window = dayWindow(autoReplyDeps.now());
  const within = await autoReplyDeps.hit(await autoReplyBucket(kind, siteId, addr), window, AUTO_REPLIES_PER_DAY).catch(() => null);
  if (within === null) return opts.failOpen ? 'send' : 'unchecked';
  if (!within) return 'sent_today';
  // item 391: then the site's own ceiling for the day, counted only for a reply that would go
  const siteWithin = await autoReplyDeps.hit(siteCeilingBucket(siteId), window, SITE_AUTO_REPLIES_PER_DAY).catch(() => null);
  if (siteWithin === null) return opts.failOpen ? 'send' : 'unchecked';
  if (!siteWithin) {
    // once a day per site from this worker: the notice dedupes on its own, this saves the writes
    const told = `${siteId}|${window}`;
    if (!TOLD.has(told)) { TOLD.add(told); await autoReplyDeps.ceilingNotice(siteId, window.slice(0, 10)).catch(() => {}); }
    return 'site_ceiling';
  }
  return 'send';
}
