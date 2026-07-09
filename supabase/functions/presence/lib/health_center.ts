// ── PT-8: Admin Health Center — ONE operational read, no duplicate monitoring ─
// Unifies the signals the platform already produces (the Phase-J activation
// dashboard, the cron ledger, the domain watch, billing/entitlement states, AI
// usage, email config, publish/run errors, active notices) into one calm status
// per area. It reads what exists; it does not add a second monitoring system.
// Pure: the /system/health route feeds it already-loaded counts.

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
  sitesLive: number;
  failedPublishes: number;
  failedRuns: number;
  activeNotices: number;
  backupsVerified: boolean;   // owner confirms a restore drill was done
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

  // AI
  add('ai', 'AI', i.aiConfigured ? 'ok' : 'off',
    i.aiConfigured ? `Configured — ${i.aiOpsThisMonth} operation${i.aiOpsThisMonth === 1 ? '' : 's'} this month.` : 'Not configured (AI features degrade gracefully).');

  // email
  add('email', 'Email delivery', i.emailConfigured ? 'ok' : 'off',
    i.emailConfigured ? 'Configured — notices and receipts can send.' : 'Not configured — email silently no-ops.');

  // usage
  add('usage', 'Usage', 'ok', `${i.sitesLive} site${i.sitesLive === 1 ? '' : 's'} live.`);

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
