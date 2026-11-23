// ── PT-8: Admin Health Center — ONE operational read, no duplicate monitoring ─
// Unifies the signals the platform already produces (the Phase-J activation
// dashboard, the cron ledger, the domain watch, billing/entitlement states, AI
// usage, email config, publish/run errors, active notices) into one calm status
// per area. It reads what exists; it does not add a second monitoring system.
// Pure: the /system/health route feeds it already-loaded counts.

import { stockHealthWords } from './stock/health.ts';
import { changesArea } from './schema_ledger.ts';
import { hostPace, hostPaceWords, HOST_CREDITS_WARN } from './host_credits.ts';   // builder item 358: the credits left and the pace

export interface HealthCenterInputs {
  nowIso: string;
  cronLastRunAt: string | null;
  secretsMissingRequired: string[];
  domainsWatched: number;
  domainsExpiringSoon: number;
  billing: { active: number; paused: number; lapsed: number };
  aiConfigured: boolean;
  aiOpsThisMonth: number;
  emailConfigured: boolean;
  /** builder list item 393: kept emails waiting to be tried again, and those given up on in the
   *  last 7 days (email_outbox); null when they couldn't be counted. Left out, not shown. */
  outbox?: { waiting: number | null; gaveUp7d: number | null };
  sitesLive: number;
  failedPublishes: number;
  failedRuns: number;
  activeNotices: number;
  backupsVerified: boolean;   // owner confirms a restore drill was done
  /** sales item 131: which kind of Stripe key Studio OS holds, from its prefix only
   *  (commerce/stripe.ts heldKeyKind). Left out, the area isn't shown. */
  stripeKey?: { kind: 'restricted' | 'secret' | 'none' | 'other'; live: boolean | null };
  /** item 263: whether the stock photo library answers (lib/stock/health.ts). Left out, the area isn't shown. */
  stock?: { configured: boolean; answered: boolean | null; status: number; provider: string } | null;
  /** builder list item 269: the host's plan as the host tells it (lib/netlify.ts readHostPlan).
   *  Left out, the area isn't shown. */
  hosting?: HostingRead | null;
  /** builder list item 416: server crashes (ops_errors rows), null when they couldn't be counted.
   *  Left out, the area isn't shown. */
  crashes?: { lastHour: number | null; lastDay: number | null; alarmAbove: number };
  /** builder list item 420: the newest change in the database's change ledger (null: no ledger
   *  yet). Left out, the area isn't shown. */
  changesNewest?: number | null;
}

/** Pure: the Server crashes area (builder list item 416). */
export function crashesArea(c: NonNullable<HealthCenterInputs['crashes']>): { state: AreaState; detail: string } {
  if (c.lastHour === null || c.lastDay === null) return { state: 'attention', detail: 'Crashes couldn’t be counted just now.' };
  const n = (x: number) => `${x} crash${x === 1 ? '' : 'es'}`;
  if (c.lastHour > c.alarmAbove) return { state: 'attention', detail: `${n(c.lastHour)} in the last hour: something is broken for someone, and the alarm is sounding. The newest are listed below.` };
  if (c.lastDay > 0) return { state: 'attention', detail: `${n(c.lastDay)} in the last day${c.lastHour ? `, ${c.lastHour} of them in the last hour` : ''}. The newest are listed below.` };
  return { state: 'ok', detail: 'No crashes in the last day.' };
}
/** Pure: the Email delivery area (builder list item 393), with what the outbox holds. */
export function emailArea(configured: boolean, outbox?: HealthCenterInputs['outbox']): { state: AreaState; detail: string } {
  if (!configured) return { state: 'off', detail: 'Not configured: no email can be sent.' };
  if (!outbox) return { state: 'ok', detail: 'Configured: notices and receipts can send.' };
  if (outbox.waiting === null || outbox.gaveUp7d === null) return { state: 'attention', detail: 'Configured, but the emails waiting to be sent again couldn’t be counted just now.' };
  const n = (x: number) => `${x} important email${x === 1 ? '' : 's'}`;
  const parts: string[] = [];
  if (outbox.waiting > 0) parts.push(`${n(outbox.waiting)} (money, sign-in or agreements) ${outbox.waiting === 1 ? 'is' : 'are'} waiting: the email service didn’t take ${outbox.waiting === 1 ? 'it' : 'them'}, and ${outbox.waiting === 1 ? 'it is' : 'each is'} tried again every 15 minutes for a day.`);
  if (outbox.gaveUp7d > 0) parts.push(`${n(outbox.gaveUp7d)} couldn’t be sent in the last 7 days; the site that sent each one was told.`);
  return parts.length ? { state: 'attention', detail: parts.join(' ') } : { state: 'ok', detail: 'Configured: nothing waiting, every important email went out.' };
}
export interface HostingRead { ok: boolean; team: string | null; plan: string | null; credits_included: number | null; credits_used: number | null; period_start: string | null; next_period_start: string | null; exceeded: boolean; read_at: string; why: string | null }

/** Pure: the Hosting area's state and words, from the host's answer. */
export function hostingArea(h: HostingRead | null | undefined): { state: AreaState; detail: string } {
  if (!h) return { state: 'off', detail: 'No hosting key is set, so nothing is published from here.' };
  const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : null);
  if (!h.ok) {
    if (h.why === 'no_token') return { state: 'off', detail: 'No hosting key is set, so nothing is published from here.' };
    if (h.why === 'refused') return { state: 'attention', detail: 'The hosting key can’t read the team’s plan. Check the key at the host.' };
    return { state: 'attention', detail: 'The host’s plan couldn’t be read just now.' };
  }
  const plan = [h.plan, h.credits_included !== null ? `${h.credits_included.toLocaleString('en-US')} credits a period` : null].filter(Boolean).join(', ');
  const renews = day(h.next_period_start);
  if (h.exceeded) return { state: 'attention', detail: `The host’s plan is used up: publishes are paused${renews ? ` until ${renews}` : ''}. Buy credits at the host or wait.` };
  // builder item 358: the credits left, how long they last at this pace, and that publishing is on;
  // at 75% used it asks for a look (Home's Needs you asks the studio too)
  const pace = hostPace(h);
  if (pace) {
    const left = `${pace.left.toLocaleString('en-US')} of ${pace.included.toLocaleString('en-US')} credits left (${Math.min(100, Math.floor(pace.pct * 100))}% used)`;
    const how = hostPaceWords(pace) || (renews ? `It renews ${renews}.` : '');
    return { state: pace.pct >= HOST_CREDITS_WARN ? 'attention' : 'ok', detail: `${plan || 'Plan read'}; ${left}. ${how ? how + ' ' : ''}Publishing is on.` };
  }
  const used = h.credits_used !== null ? `${h.credits_used.toLocaleString('en-US')} used` : 'credits used: not known (the host reports 0, which it does even when credits were spent)';
  return { state: 'ok', detail: `${plan || 'Plan read'}; ${used}${renews ? `; renews ${renews}` : ''}. Publishing is on.` };
}

export type AreaState = 'ok' | 'attention' | 'off';
export interface HealthArea { key: string; label: string; state: AreaState; detail: string }

/** One status per operational area + an honest overall. Pure. */
export function summarizeHealthCenter(i: HealthCenterInputs): { overall: AreaState; areas: HealthArea[] } {
  const areas: HealthArea[] = [];
  const add = (key: string, label: string, state: AreaState, detail: string) => areas.push({ key, label, state, detail });

  // core / secrets
  add('platform', 'Platform', i.secretsMissingRequired.length ? 'attention' : 'ok',
    i.secretsMissingRequired.length ? `Missing required config: ${i.secretsMissingRequired.join(', ')}.` : 'All required configuration is present.');

  // cron (fresh if it ran within the last ~30 minutes)
  const cronFresh = !!i.cronLastRunAt && (Date.parse(i.nowIso) - Date.parse(i.cronLastRunAt)) <= 30 * 60_000;
  add('cron', 'Scheduled operations', cronFresh ? 'ok' : 'attention',
    i.cronLastRunAt ? (cronFresh ? 'Running on schedule.' : `Last run was ${humanAgo(i.cronLastRunAt, i.nowIso)} — check the trigger.`) : 'No scheduled run recorded yet.');

  // domains
  add('domains', 'Domains', i.domainsExpiringSoon > 0 ? 'attention' : 'ok',
    i.domainsWatched === 0 ? 'No custom domains to watch.' : (i.domainsExpiringSoon > 0 ? `${i.domainsExpiringSoon} expiring within 30 days.` : `${i.domainsWatched} watched, all healthy.`));

  // billing
  const billTrouble = i.billing.paused + i.billing.lapsed;
  add('billing', 'Billing', billTrouble > 0 ? 'attention' : 'ok',
    billTrouble > 0 ? `${i.billing.paused} with payment trouble, ${i.billing.lapsed} lapsed.` : `${i.billing.active} active, all current.`);

  // the Stripe key (sales item 131): a full-power key works, but a leak of it could
  // refund, pay out and change settings, so it asks for a look until it's swapped
  if (i.stripeKey) {
    const k = i.stripeKey;
    add('stripe_key', 'Stripe key', k.kind === 'none' ? 'off' : k.kind === 'restricted' && k.live === true ? 'ok' : 'attention',
      k.kind === 'none' ? 'No Stripe key is set, so invoices can’t be paid online.'
        : k.kind === 'other' ? 'The Stripe key isn’t one Stripe gives out. Check the STRIPE_SECRET setting.'
        : k.live === false ? 'This is a test key, so real payments can’t be taken.'
        : k.kind === 'secret' ? 'Studio OS holds a full-power Stripe key. Swap it for a restricted key that can do only what Studio OS needs.'
        : 'A restricted key that can do only what Studio OS needs. Check its permissions to see each one.');
  }

  // stock photos (item 263): a refused key used to fail every search quietly
  if (i.stock !== undefined) {
    const w = stockHealthWords(i.stock);
    add('stock', 'Stock photos', w.state, w.detail);
  }

  // AI
  add('ai', 'AI', i.aiConfigured ? 'ok' : 'off',
    i.aiConfigured ? `Configured — ${i.aiOpsThisMonth} operation${i.aiOpsThisMonth === 1 ? '' : 's'} this month.` : 'Not configured (AI features degrade gracefully).');

  // email (builder list item 393: what the outbox holds)
  { const e = emailArea(i.emailConfigured, i.outbox); add('email', 'Email delivery', e.state, e.detail); }

  // usage
  add('usage', 'Usage', 'ok', `${i.sitesLive} site${i.sitesLive === 1 ? '' : 's'} live.`);

  // hosting (builder list item 269): the host's plan, as the host tells it
  if (i.hosting !== undefined) { const h = hostingArea(i.hosting); add('hosting', 'Hosting', h.state, h.detail); }

  // server crashes (builder list item 416): every crashed request writes one row; nothing read them before
  if (i.crashes !== undefined) { const c = crashesArea(i.crashes); add('crashes', 'Server crashes', c.state, c.detail); }

  // database changes (builder list item 420): the ledger's newest number against the code's
  if (i.changesNewest !== undefined) { const c = changesArea(i.changesNewest); add('changes', 'Database changes', c.state, c.detail); }

  // errors
  const errs = i.failedPublishes + i.failedRuns;
  add('errors', 'Errors', errs > 0 ? 'attention' : 'ok',
    errs > 0 ? `${i.failedPublishes} failed publish${i.failedPublishes === 1 ? '' : 'es'}, ${i.failedRuns} failed run${i.failedRuns === 1 ? '' : 's'} recently.` : 'No recent failures.');

  // alerts (active notices across the platform)
  add('alerts', 'Alerts', i.activeNotices > 0 ? 'attention' : 'ok',
    i.activeNotices > 0 ? `${i.activeNotices} active customer notice${i.activeNotices === 1 ? '' : 's'}.` : 'Nothing outstanding.');

  // backups — honest: 'attention' until a restore drill is confirmed
  add('backups', 'Backups & recovery', i.backupsVerified ? 'ok' : 'attention',
    i.backupsVerified ? 'Backups on; a restore has been tested.' : 'Backups on, but a restore drill hasn’t been confirmed yet.');

  const overall: AreaState = areas.some((a) => a.state === 'attention') ? 'attention' : 'ok';
  return { overall, areas };
}

function humanAgo(iso: string, nowIso: string): string {
  const mins = Math.floor((Date.parse(nowIso) - Date.parse(iso)) / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
