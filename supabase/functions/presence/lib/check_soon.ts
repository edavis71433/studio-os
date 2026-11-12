// ── Builder list item 206: when a site's health is checked ───────────────────
// A site is checked once a day, and again after each publish. The scheduled tick
// still runs every 15 minutes (publishes, reminders and the rest need it), but it
// used to run the whole check for every site every time: about 90 full checks a
// site a day, each writing a new set of findings, for sites that change only when
// someone edits or publishes. presence_sites.last_observed_at (0091) is the mark:
// the tick checks a site whose mark is empty or older than CHECK_EVERY_MS.
import { svc } from './db.ts';

/** A little under a day, so a site checked at 03:15 is due again at the 03:15 tick
 *  the next day and its hour doesn't creep 15 minutes later every day. */
export const CHECK_EVERY_MS = 24 * 3600_000 - 10 * 60_000;
/** A site whose check failed is tried again after this long, not on every tick. */
export const CHECK_RETRY_MS = 3600_000;

/** The moment before which a mark is old enough for the site to be checked again. */
export function checkDueBefore(nowMs: number): string {
  return new Date(nowMs - CHECK_EVERY_MS).toISOString();
}

/** The site just changed for visitors (a publish went live): empty its mark, so the
 *  next tick checks it. Best-effort; without it the daily check still comes. */
export async function checkSoon(siteId: string): Promise<void> {
  await svc(`presence_sites?id=eq.${siteId}`, { method: 'PATCH', body: JSON.stringify({ last_observed_at: null }) }).catch(() => {});
}

/** A failed check: move the mark back so the site comes round again in an hour. */
export async function checkAgainInAnHour(siteId: string, nowMs: number): Promise<void> {
  const mark = new Date(nowMs - CHECK_EVERY_MS + CHECK_RETRY_MS).toISOString();
  await svc(`presence_sites?id=eq.${siteId}`, { method: 'PATCH', body: JSON.stringify({ last_observed_at: mark }) }).catch(() => {});
}
