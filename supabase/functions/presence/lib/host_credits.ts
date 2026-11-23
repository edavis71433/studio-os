// ── Builder item 358: the host refused a publish because its account is out of credits ──
// The host bills every deploy in credits. With none left (and auto recharge off) it refuses new
// deploys, so every Publish stops. Its answer is "payment required" (402), or words about
// credits or a usage limit. A publish that fails this way says so in plain words: to the studio
// with what to do, to a client without the studio's billing. Read from the deploy's own error as
// lib/netlify.ts words it, and as the publish row keeps it ("deploy: deploy create failed: 402 …").
// Pure: no reads, no environment.

const CREDIT_WORDS = /\bcredits?\b|usage limit|limit (?:reached|exceeded)|(?:exceeded|over) (?:its|your|the) (?:plan|usage|credit|limit)|payment required/i;

/** Did the host refuse this deploy because the account has no credits left? Only the host's own
 *  answer is read, never a file's name (a page called "credits" is not a refusal). */
export function hostOutOfCredits(error: string | null | undefined): boolean {
  const e = String(error || '');
  let m = /deploy create failed: (\d{3})\b([\s\S]*)$/.exec(e);
  if (m) return m[1] === '402' || CREDIT_WORDS.test(m[2]);
  m = /upload failed for [\s\S]*: (\d{3}) \(after retry\)$/.exec(e);
  if (m) return m[1] === '402';
  m = /deploy state=error: ([\s\S]*)$/.exec(e);
  if (m) return CREDIT_WORDS.test(m[1]);
  return false;
}

/** What Publish says to the studio (and the platform): what happened and what to do. */
export const OUT_OF_CREDITS_STUDIO = 'Publishing is paused: the hosting account has run out of credits. Add credits at the host, or turn on auto recharge there, then publish again.';
/** What Publish says to a client: no studio billing, and their work is safe. */
export const OUT_OF_CREDITS_CLIENT = 'Publishing is paused on your studio’s side for now. They can see it, and your changes are safe in your draft.';
/** Home's Needs you row for a site whose last publish was refused this way. */
export const OUT_OF_CREDITS_ROW = { what: 'couldn’t publish: the hosting account is out of credits', when: 'Add credits at the host, or turn on auto recharge, then publish again' };

// ── Builder item 358, part two: what the host's plan means for the studio ─────────────────
// The Health Center's Hosting card says the credits left, how long they last at this period's
// pace, and whether publishing is on or paused; at 75% used, or paused, the studio's Home asks
// (Needs you, platform staff only: the hosting account is the platform's). Read from the host's
// plan the way lib/netlify.ts hostPlanFrom reads it: "used" only when the host's figure can be
// believed (it reports 0 on credit plans), so nothing here guesses a number it wasn't given.
export const HOST_CREDITS_WARN = 0.75;
const DAY_MS = 86_400_000;
export interface HostPlanRead { ok: boolean; credits_included: number | null; credits_used: number | null; period_start: string | null; next_period_start: string | null; exceeded: boolean; read_at: string }
export interface HostPace { used: number; included: number; left: number; pct: number; daysLeft: number | null; runsOut: string | null; renews: string | null; beforeRenewal: boolean }
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '');

/** Credits left, the share used, and when they run out at this period's pace, as of the read.
 *  Null when the host didn't say what was used (or the plan has no credits). Pure. */
export function hostPace(h: HostPlanRead | null | undefined): HostPace | null {
  if (!h || !h.ok || h.credits_included === null || h.credits_used === null || !(h.credits_included > 0)) return null;
  const included = h.credits_included, used = Math.max(0, h.credits_used), left = Math.max(0, included - used);
  const at = Date.parse(h.read_at), start = Date.parse(String(h.period_start || '')), next = Date.parse(String(h.next_period_start || ''));
  const perDay = Number.isFinite(at) && Number.isFinite(start) && used > 0 ? used / Math.max(1, (at - start) / DAY_MS) : null;
  const daysLeft = perDay ? Math.floor(left / perDay) : null;
  const outMs = daysLeft !== null ? at + daysLeft * DAY_MS : null;
  return { used, included, left, pct: used / included, daysLeft, runsOut: outMs !== null ? new Date(outMs).toISOString() : null,
    renews: Number.isFinite(next) ? new Date(next).toISOString() : null, beforeRenewal: outMs !== null && Number.isFinite(next) && outMs < next };
}

/** The pace in words: "At this pace that's about 6 more days (to Dec 1), before it renews Dec 11." Pure. */
export function hostPaceWords(p: HostPace): string {
  const renews = p.renews ? ` ${day(p.renews)}` : '';
  if (p.daysLeft === null) return '';
  if (!p.beforeRenewal) return `At this pace they last until it renews${renews}.`;
  return `At this pace that’s about ${p.daysLeft === 1 ? '1 more day' : `${p.daysLeft} more days`} (to ${day(p.runsOut)}), before it renews${renews}.`;
}

/** Home's Needs you row when the hosting account is paused or 75% used, else null. The key
 *  carries the period (and which line), so a snoozed 75% row doesn't hide a pause. Pure. */
export function hostingNeed(h: HostPlanRead | null | undefined): { key: string; what: string; when: string } | null {
  if (!h || !h.ok) return null;
  const period = String(h.period_start || '').slice(0, 10) || 'now';
  const renews = day(h.next_period_start);
  if (h.exceeded) return { key: `hosting:${period}:paused`, what: 'is out of credits: publishing is paused', when: `Add credits at the host or wait${renews ? ` until it renews ${renews}` : ''}` };
  const p = hostPace(h);
  if (!p || p.pct < HOST_CREDITS_WARN) return null;
  return { key: `hosting:${period}:75`, what: `has used ${Math.min(100, Math.floor(p.pct * 100))}% of this period’s credits`,
    when: [`${p.left.toLocaleString('en-US')} left`, p.beforeRenewal && p.daysLeft !== null ? `about ${p.daysLeft === 1 ? '1 day' : `${p.daysLeft} days`} at this pace` : '', renews ? `renews ${renews}` : ''].filter(Boolean).join(' · ') };
}
