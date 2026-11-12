// ── One automatic reply a day to an address (builder list item 203) ──────────
// A website's automatic emails go to whatever address a visitor typed, under the
// business's name: the enquiry acknowledgement, a new booking's confirmation, and the
// "Yes, add me" email of Join our list. A stranger could type someone else's address
// again and again, and the complaints would land on the sending address every client
// shares. So a site sends at most one automatic reply a day (the UTC day) to an
// address, and none at all to an address on the do-not-send list for any reason:
// someone who unsubscribed, bounced or complained gets no automatic reply.
//
// The day's count lives in the rate limiter's own table (rate_hit, migration 0008),
// under a salted hash of the address, so no address is stored for it, and the
// retention sweep clears the old days. An enquiry's acknowledgement and a list's
// confirmation are optional, so when the count can't be read nothing is sent; a
// booking's confirmation is the customer's own appointment, so it goes (failOpen).
import { svc } from './db.ts';
import { suppressionOf } from '../../_shared/email_infra.ts';
import { normEmail } from './contact_email.ts';

export const AUTO_REPLIES_PER_DAY = 1;
const DAY_MS = 86_400_000;

/** send · unsubscribed (on the do-not-send list) · sent_today · unchecked (the count
 *  couldn't be read, or there is no address). Only `send` sends. */
export type AutoReplyVerdict = 'send' | 'unsubscribed' | 'sent_today' | 'unchecked';

/** The start of the UTC day `nowMs` falls in: the count's window. Pure. */
export function dayWindow(nowMs: number): string {
  return new Date(Math.floor(nowMs / DAY_MS) * DAY_MS).toISOString();
}

const saltKey = () => Deno.env.get('APPROVAL_SECRET') || Deno.env.get('SCHEDULER_SECRET') || Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || 'salt';

/** The count's key for one address on one site: a salted hash, never the address. */
export async function autoReplyBucket(siteId: string, email: string, salt = saltKey()): Promise<string> {
  const data = new TextEncoder().encode(`auto-reply|${normEmail(email)}|${salt}`);
  const hex = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data))).slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `autoreply:${siteId}:${hex}`;
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
};

/** May this site send its automatic reply to `email` now? Counts the send when the answer
 *  is `send`, so ask only right before sending. */
export async function autoReplyVerdict(siteId: string, email: string, opts: { failOpen?: boolean } = {}): Promise<AutoReplyVerdict> {
  const addr = normEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return 'unchecked';
  // the do-not-send list first, so a refused address doesn't use up the day's reply
  if (await autoReplyDeps.suppression(addr).catch(() => null)) return 'unsubscribed';
  const within = await autoReplyDeps.hit(await autoReplyBucket(siteId, addr), dayWindow(autoReplyDeps.now()), AUTO_REPLIES_PER_DAY).catch(() => null);
  if (within === null) return opts.failOpen ? 'send' : 'unchecked';
  return within ? 'send' : 'sent_today';
}
