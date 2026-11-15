// ── The monthly AI check (builder list item 182, Nov 2026) ──────────────────────
// For each client site the studio switched it on for (the monthly report setting's
// `ai_checks`, settings.html's Monthly report card), the AI check runs once a month
// on the client's own questions (lib/ai_watch.ts) and its answers are kept in
// presence_ai_checks (migration 0172). It costs money, so:
//   • nothing runs for a client with the switch off;
//   • one check per run of the job: a check takes up to a minute, and the job runs
//     on the scheduler's tick, after everything else;
//   • the tools' daily spend cap stops it, the same as the public tools;
//   • the month is CLAIMED before the check (a compare-and-swap on the setting), so
//     two ticks can't both pay for one; a check that fails is tried again on later
//     ticks, three times a month at most.
// Each check is also saved as an ordinary AI Visibility report (tool_reports), so the
// Search tab's existing AI card and its report link show the newest one.
import { svc, svcPaged } from '../lib/db.ts';
import { insert } from '../../_shared/tools/db.ts';
import { logUsage, spendCapReached } from '../../_shared/tools/guard.ts';
import { assertPublicHttpUrl } from '../../_shared/tools/url_guard.ts';
import { runAiVisibility, type AiScanDeps } from '../../_shared/tools/ai_visibility/scan.ts';
import { ENGINES, enabledEngines } from '../../_shared/tools/ai_visibility/engines.ts';
import { readReservedJson, updateReservedJson, RESERVED_NAMES } from '../lib/reserved_store.ts';
import { normalizeReportSetting, type ReportSetting } from './monthly_report.ts';
import { aiDueNow, aiResults, asPrompts, defaultQuestions, normalizeQuestions } from '../lib/ai_watch.ts';
import { liveAddress, reviewBusinessType } from '../lib/search_visibility.ts';
import type { SiteRow } from '../lib/site.ts';

export const AI_MAX_TRIES = 3;
/** Item 209: the clients a run reads at once, and at most how many pages. */
export const AI_PAGE = 100, AI_PAGES = 50;
/** Overridable for tests: the scan's network-facing parts. */
export const aiCheckDeps: Partial<AiScanDeps> = {};

class NotDue extends Error {}
const SAVE = (siteId: string, change: (s: ReportSetting) => ReportSetting) =>
  updateReservedJson(siteId, RESERVED_NAMES.monthlyReport, (cur) => change(normalizeReportSetting(cur)), 'ai-checks');
const rows = (r: unknown): any[] => { const j = (r as { json?: unknown } | null)?.json; return Array.isArray(j) ? j : []; };

/** Pure: after a check that failed. Under the cap the month is let go (tried again on a
 *  later tick); at the cap it is handled, as failed. */
export function afterAiFailure(s: ReportSetting, month: string, before: string | null, reason: string, nowIso: string): ReportSetting {
  const count = (s.ai_tries && s.ai_tries.month === month ? s.ai_tries.count : 0) + 1;
  if (count >= AI_MAX_TRIES) return { ...s, ai_month: month, ai_tries: { month, count }, ai_result: { month, status: 'failed', reason, at: nowIso } };
  return { ...s, ai_month: s.ai_month === month ? before : s.ai_month, ai_tries: { month, count } };
}

/** What one client's check needs: the name, the town, the kind of business, the
 *  address it is read at, and its questions (the AI check's seven until changed). */
export async function aiInputsFor(site: SiteRow): Promise<{ businessName: string; city: string; businessType: string; url: string | null; questions: string[] } | null> {
  const [identQ, locQ, setQ, extQ, qs] = await Promise.all([
    svc(`presence_identity?site_id=eq.${site.id}&select=business_name&limit=1`).catch(() => null),
    svc(`presence_locations?site_id=eq.${site.id}&select=city,region&limit=1`).catch(() => null),
    svc(`presence_settings?site_id=eq.${site.id}&select=industry_key&limit=1`).catch(() => null),
    svc(`presence_monitor_connections?site_id=eq.${site.id}&select=domain&limit=1`).catch(() => null),
    readReservedJson(site.id, RESERVED_NAMES.aiQuestions),
  ]);
  const businessName = String(rows(identQ)[0]?.business_name || '').trim();
  const loc = rows(locQ)[0] || {};
  const city = [loc.city, loc.region].filter(Boolean).join(', ').slice(0, 80);
  if (!businessName || !city) return null;
  const businessType = reviewBusinessType(rows(setQ)[0]?.industry_key);
  const stored = normalizeQuestions(qs).questions.map((q) => q.text);
  const address = liveAddress(site, rows(extQ)[0]?.domain || null);
  return { businessName, city, businessType, url: address ? address.url : null, questions: stored.length ? stored : defaultQuestions({ businessName, city, businessType }) };
}

/** The job. Returns what it did; `resting` when the spend cap stopped it. */
export async function runAiChecks(limit = 1, nowIso = new Date().toISOString()): Promise<{ checked: number; failed: number; skipped: number; resting?: boolean; not_ready?: boolean }> {
  const month = nowIso.slice(0, 7);
  // Item 209 (review file 06, finding 63): every client with the report on, a page at a
  // time in a set order, until this run's checks are done. One read of 500 in no order
  // used to be all of it, so a client past it was never checked.
  const settings = (async function* () {
    for await (const page of svcPaged(`presence_sales_templates?kind=eq.proposal&name=eq.${encodeURIComponent(RESERVED_NAMES.monthlyReport)}&deleted_at=is.null&select=site_id,body`, 'site_id.asc', AI_PAGE, AI_PAGES)) yield* page as Array<{ site_id: string; body: string }>;
  })();
  let checked = 0, failed = 0, skipped = 0;
  for await (const r of settings) {
    if (checked + failed >= limit) break;
    let seen: ReportSetting; try { seen = normalizeReportSetting(JSON.parse(r.body)); } catch { skipped++; continue; }
    if (!aiDueNow(seen, nowIso)) { skipped++; continue; }
    if (!enabledEngines().length) return { checked, failed, skipped, resting: true };
    if (await spendCapReached()) return { checked, failed, skipped, resting: true };
    // the table first: without it there is nowhere to keep what this would pay for
    const ready = await svc('presence_ai_checks?select=site_id&limit=1').catch(() => null);
    if (!ready || !ready.ok) return { checked, failed, skipped, not_ready: true };
    const site = rows(await svc(`presence_sites?id=eq.${r.site_id}&select=*&limit=1`).catch(() => null))[0] as SiteRow | undefined;
    if (!site) { skipped++; continue; }
    const inputs = await aiInputsFor(site);
    let before: string | null = null;
    const claimed = await SAVE(site.id, (s) => {
      if (!aiDueNow(s, nowIso)) throw new NotDue();
      before = s.ai_month;
      // a client without a name or a town can't be asked about: handled for the month, said why
      return inputs ? { ...s, ai_month: month } : { ...s, ai_month: month, ai_result: { month, status: 'failed', reason: 'no_name_or_town', at: nowIso } };
    }).catch(() => null);
    if (!claimed) { skipped++; continue; }
    if (!inputs) { failed++; continue; }
    const prompts = asPrompts(inputs.questions, inputs.businessName);
    const result = await runAiVisibility(
      { businessName: inputs.businessName, city: inputs.city, businessType: inputs.businessType, searchPhrases: '', url: inputs.url, detail: '', questions: prompts },
      { guard: assertPublicHttpUrl, ...aiCheckDeps },
    ).catch(() => null);
    if (!result || !result.ok) {
      failed++;
      if (result) await logUsage({ tool: 'ai_visibility', kind: 'scan', cost_usd: result.costUsd, note: 'monthly AI check (failed)' }).catch(() => {});
      await SAVE(site.id, (s) => afterAiFailure(s, month, before, result ? String((result as { error?: string }).error || 'failed') : 'failed', nowIso)).catch(() => null);
      continue;
    }
    const report = await insert('tool_reports', { tool: 'ai_visibility', input: { ...result.input, site_id: site.id }, raw_results: result.raw, findings: result.findings, scores: result.scores, unlocked: true, unlocked_at: nowIso }).catch(() => null);
    await logUsage({ tool: 'ai_visibility', kind: 'scan', report_id: report ? String(report.id) : null, cost_usd: result.costUsd, note: 'monthly AI check' }).catch(() => {});
    const names = Object.fromEntries(ENGINES.map((e) => [e.id, e.name]));
    const got = aiResults(result.raw, prompts, inputs.businessName, names);
    const kept = await svc('presence_ai_checks?on_conflict=site_id,month', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ site_id: site.id, month, checked_at: nowIso, report_id: report ? report.id : null, engines: got.engines, asked: got.asked, named: got.named, results: got.results, cost_usd: Math.round(result.costUsd * 10000) / 10000 }),
    }).catch(() => null);
    if (kept && kept.ok) {
      checked++;
      await SAVE(site.id, (s) => ({ ...s, ai_tries: null, ai_result: { month, status: 'checked', reason: null, at: nowIso } })).catch(() => null);
    } else {
      failed++;
      await SAVE(site.id, (s) => afterAiFailure(s, month, before, 'not_kept', nowIso)).catch(() => null);
    }
  }
  return { checked, failed, skipped };
}
