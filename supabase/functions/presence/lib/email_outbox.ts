// ── An outbox for the emails that matter (builder list item 393) ─────────────
// An email the sending service refused or didn't answer used to be logged and dropped
// (Nov 22 2026 review, file 07 finding 17), so in a bad hour invoices, receipts, signed
// agreements and sign-in links were simply lost. Now a send that asks to be kept
// (sendEmail's `keep`: 'money', 'sign_in' or 'agreement') goes like this:
//   1. the exact message is written to email_outbox BEFORE the send (migration 0268), so
//      a request that dies mid-send leaves it waiting, not lost;
//   2. it is sent with the header `Idempotency-Key: outbox-<row id>`. The sending
//      service answers a repeat of the same key and message with its first answer and
//      delivers nothing more, so an answer lost after it took the email can't make a
//      second copy;
//   3. taken: the row is ticked sent and the message cleared from it. Refused for good
//      (a malformed message or address, 400/413/422): ticked failed, and the caller hears
//      "not sent", as before. Anything else (no answer in 10 seconds, the service down,
//      too many at once, a key problem): it waits, and the caller hears "sent", because
//      it will be;
//   4. the 15-minute scheduled run (runEmailOutbox, routes/system.ts) tries what waits,
//      oldest first, with the same key, for 23 and a half hours: every try stays inside
//      the 24 hours the service remembers a key. After that it gives up, clears the
//      message, and tells the site that sent it (an `email_not_sent` notice), so the
//      person who sent the invoice knows to send it another way;
//   5. before each try the do-not-email list is read again: an address that bounced or
//      complained meanwhile gets nothing.
// Only money, sign-in and agreement mail is kept: a reminder that waits a day is
// noise, and a fresh sign-in code (lib/fresh_code.ts) lives minutes, so trying it again
// later would only confuse. Rows stay 30 days (who, what, when; never the message).
// When the outbox can't be written (before 0268, or a database hiccup) the email goes the
// way it always did, once.
import { svc } from './db.ts';
import { maskEmail, maySend } from '../../_shared/email_infra.ts';
import type { ResendAnswer } from '../commerce/account.ts';

export type OutboxKind = 'money' | 'sign_in' | 'agreement';
export const OUTBOX_KINDS: ReadonlySet<string> = new Set(['money', 'sign_in', 'agreement']);
/** A waiting email is tried again this long after its last try (the scheduled run's beat). */
export const OUTBOX_RETRY_MS = 15 * 60_000;
/** …for this long after it was first written: inside the sending service's 24 hours. */
export const OUTBOX_GIVE_UP_MS = 23.5 * 3600_000;
/** Done rows (sent or given up) are kept this long, then removed. */
export const OUTBOX_KEEP_DAYS = 30;
/** At most this many waiting emails are tried in one scheduled run. */
export const OUTBOX_PER_RUN = 25;

/** The key that makes a repeat of this email a no-op at the sending service. Pure. */
export const outboxKey = (id: string) => `outbox-${id}`;

/** Is a refusal about this email itself, so trying it again can't help? A malformed message
 *  or address (400, 422) or one too large (413). Everything else may pass. Pure. */
export function refusedForGood(status: number): boolean {
  return status === 400 || status === 413 || status === 422;
}

/** What the outbox needs besides the message: who it's to, the subject, the site it's from. */
export interface KeptMeta { to: string; subject: string; siteId?: string | null }

/** The outside calls; tests swap them. `post` is the one sending call (commerce/account.ts);
 *  `gate` the do-not-email list. */
export const outboxDeps = {
  post: async (payload: Record<string, unknown>, key?: string): Promise<ResendAnswer> => (await import('../commerce/account.ts')).postToResend(payload, key),
  gate: (to: string): Promise<{ ok: boolean; reason: string | null }> => maySend(to, { critical: true }),
  now: (): number => Date.now(),
};

const short = (s: string) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 300);
const iso = (ms: number) => new Date(ms).toISOString();

/** Send a kept email: written first, sent with its key, ticked after. True when the sending
 *  service took it, or it waits to be tried again; false only when it was refused for good. */
export async function sendKept(kind: OutboxKind, payload: Record<string, unknown>, meta: KeptMeta): Promise<boolean> {
  const now = outboxDeps.now();
  const ins = await svc('email_outbox', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      kind, to_email: String(meta.to).slice(0, 320), subject: short(meta.subject), site_id: meta.siteId || null,
      payload, status: 'queued', tries: 1, next_try_at: iso(now + OUTBOX_RETRY_MS), created_at: iso(now),
    }),
  }).catch(() => null);
  const id = ins && ins.ok && Array.isArray(ins.json) && ins.json[0]?.id ? String(ins.json[0].id) : '';
  if (!id) {
    // no outbox (before 0268, or the database didn't answer): once, the way it always went
    const r = await outboxDeps.post(payload);
    if (!r.ok) console.error(`[email] Resend ${r.status} to ${maskEmail(meta.to)}: ${r.said} (not kept: the outbox couldn't be written)`);
    return r.ok;
  }
  const r = await outboxDeps.post(payload, outboxKey(id));
  if (r.ok) { await finish(id, 'sent', null); return true; }
  if (refusedForGood(r.status)) {
    console.error(`[email] Resend ${r.status} to ${maskEmail(meta.to)}: ${r.said} (refused, not tried again)`);
    await finish(id, 'failed', `Refused (${r.status}): ${r.said}`);
    return false;
  }
  console.warn(`[email] Resend ${r.status || 'gave no answer'} to ${maskEmail(meta.to)}: ${r.said}; kept, tried again in 15 minutes`);
  await svc(`email_outbox?id=eq.${id}&status=eq.queued`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ last_error: short(`${r.status || 'no answer'}: ${r.said}`) }) }).catch(() => {});
  return true;
}

/** Tick a row done: the message itself goes, who/what/when stay. */
async function finish(id: string, status: 'sent' | 'failed', why: string | null): Promise<void> {
  const at = iso(outboxDeps.now());
  await svc(`email_outbox?id=eq.${id}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status, payload: null, done_at: at, ...(status === 'sent' ? { sent_at: at } : {}), ...(why ? { last_error: short(why) } : {}) }),
  }).catch(() => {});
}

interface OutboxRow { id: string; kind: string; to_email: string; subject: string; site_id: string | null; payload: Record<string, unknown> | null; tries: number; created_at: string }

/** The words of the notice a site gets when one of its emails couldn't be sent. Pure. */
export type GiveUpWhy = 'tried_a_day' | 'do_not_email' | 'refused';
export function notSentWords(row: { subject: string; to_email: string }, why: GiveUpWhy): { headline: string; body: string } {
  const subject = short(row.subject) || 'an email';
  const body = why === 'do_not_email'
    ? `It was for ${row.to_email}, whose address is on the do-not-email list now (it bounced or they complained). Reach them another way.`
    : why === 'refused'
      ? `It was for ${row.to_email}, and the email service refused it, so the address may be wrong. Check it, then send it again from where you sent it.`
      : `It was for ${row.to_email}. We tried every 15 minutes for a day and the email service didn’t take it. Send it again from where you sent it, or reach them another way.`;
  return { headline: `An email didn’t go out: ${subject}`.slice(0, 200), body };
}

/** Give up on a row and tell the site that sent it, once (the notice's period is the row). */
async function giveUp(row: OutboxRow, why: GiveUpWhy, said = ''): Promise<void> {
  await finish(row.id, 'failed', why === 'do_not_email' ? 'Not sent: the address is on the do-not-email list.' : why === 'refused' ? `Refused: ${said}` : 'Given up after a day of tries.');
  if (!row.site_id) return;   // platform mail: the Health page's count is the record
  try {
    const s = await svc(`presence_sites?id=eq.${row.site_id}&select=id,client_id&limit=1`);
    const clientId = s.ok && Array.isArray(s.json) ? s.json[0]?.client_id : null;
    if (!clientId) return;
    const { raiseNotice } = await import('./notice.ts');
    const w = notSentWords(row, why);
    await raiseNotice({ siteId: row.site_id, clientId: String(clientId), kind: 'email_not_sent', period: `outbox:${row.id}`, headline: w.headline, body: w.body });
  } catch { /* the Health page still counts it */ }
}

/** The 15-minute run's chore: try what waits, oldest first, give up on what's a day old,
 *  and remove done rows older than 30 days. Counts only (no "failures" key: an email the
 *  service won't take yet is the outbox working, not the run failing). */
export async function runEmailOutbox(limit = OUTBOX_PER_RUN): Promise<Record<string, unknown>> {
  const now = outboxDeps.now();
  const r = await svc(`email_outbox?status=eq.queued&next_try_at=lte.${encodeURIComponent(iso(now))}&order=created_at.asc&limit=${Math.max(1, Math.min(100, limit))}&select=id,kind,to_email,subject,site_id,payload,tries,created_at`).catch(() => null);
  if (!r || !r.ok || !Array.isArray(r.json)) {
    if (r && r.status === 404) return { skipped_no_outbox: true };   // before migration 0268
    return { ok: false };
  }
  let tried = 0, sent = 0, waiting = 0, gave_up = 0;
  for (const row of r.json as OutboxRow[]) {
    const born = Date.parse(row.created_at);
    const age = Number.isFinite(born) ? now - born : 0;
    if (!row.payload || !(age < OUTBOX_GIVE_UP_MS)) { await giveUp(row, 'tried_a_day'); gave_up++; continue; }
    // claim it: only if no other run moved it since the read
    const claim = await svc(`email_outbox?id=eq.${row.id}&status=eq.queued&tries=eq.${Number(row.tries) || 0}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ tries: (Number(row.tries) || 0) + 1, next_try_at: iso(now + OUTBOX_RETRY_MS) }),
    }).catch(() => null);
    if (!claim || !claim.ok || !Array.isArray(claim.json) || !claim.json.length) continue;
    const gate = await outboxDeps.gate(row.to_email).catch(() => ({ ok: true, reason: null }));
    if (!gate.ok) { await giveUp(row, 'do_not_email'); gave_up++; continue; }
    tried++;
    const res = await outboxDeps.post(row.payload, outboxKey(row.id));
    if (res.ok) { await finish(row.id, 'sent', null); sent++; continue; }
    if (refusedForGood(res.status)) { await giveUp(row, 'refused', `${res.status} ${res.said}`); gave_up++; continue; }
    waiting++;
    await svc(`email_outbox?id=eq.${row.id}&status=eq.queued`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ last_error: short(`${res.status || 'no answer'}: ${res.said}`) }) }).catch(() => {});
  }
  await svc(`email_outbox?status=neq.queued&created_at=lt.${encodeURIComponent(iso(now - OUTBOX_KEEP_DAYS * 86_400_000))}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }).catch(() => {});
  return { read: r.json.length, tried, sent, waiting, gave_up };
}
