// ── Google Analytics 4 — scheduled sync (I/O) ────────────────────────────────
// The GSC treatment (ops/gsc_sync.ts), applied to visitor numbers. Reuses
// EVERYTHING: the connected-platform OAuth tokens (loadTokens/refreshTokens,
// encrypted in presence_connection_secrets), the shared `signals` time-series
// (source='ga4' — NEVER blended with the first-party presence_visits counts:
// different methodologies, labeled provenance), and the ops cron for
// scheduling. The runReport request/response shapes are transcribed from the
// official GA4 Data API contract (doc URLs in lib/ga4.ts), so the one boundary
// that can't be live-tested here uses the published contract, not a guess.
// Fail-safe: a site that errors is skipped, never blocks the others.
//
// HOSTING-AGNOSTIC BY CONSTRUCTION: GA4 reports on a PROPERTY, not on hosting —
// the client's own site (Wix today, ours tomorrow) carries the GA4 tag, and
// this sync reads whatever that property measured. That is exactly Eric's
// "analytics on websites I don't host" ask.
//
// OWNER-GATED: nothing flows until the Google OAuth app + `analytics.readonly`
// consent + the CONNECTED_GOOGLE_ANALYTICS_* / CONNECTION_ENC_KEY secrets are
// set (and the Analytics Data + Admin APIs enabled on the Cloud project);
// without a real token, loadTokens returns null and each site is skipped.
import { svc } from '../lib/db.ts';
import { loadTokens, saveTokens, markStatus, getConnectionConfig, setConnectionConfig } from '../connected/store.ts';
import { refreshTokens } from '../connected/auth.ts';
import { discoverGa4Properties } from '../connected/adapters.ts';
import { ga4PropertyPath, ga4RunReportBody, parseGa4Report, ga4SignalRows } from '../lib/ga4.ts';
import { gscMonthWindow } from '../lib/gsc.ts';

const PROVIDER = 'google_analytics';
const arr = (r: { json?: unknown }): any[] => (Array.isArray((r as { json?: unknown[] }).json) ? (r as { json: any[] }).json : []);

/** POST properties/{id}:runReport, with a 401→refresh→retry once (the same
 *  token dance the GSC sync proved). Endpoint per the official contract:
 *  https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport */
async function runReport(siteId: string, propertyPath: string, body: unknown, tokenState: { access: string; refresh: string | null }): Promise<{ ok: boolean; status: number; json: any }> {
  const call = (access: string) => fetch(`https://analyticsdata.googleapis.com/v1beta/${propertyPath}:runReport`, {
    method: 'POST', headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  let r = await call(tokenState.access);
  if (r.status === 401 && tokenState.refresh) {
    const refreshed = await refreshTokens(PROVIDER, tokenState.refresh).catch(() => null);
    if (refreshed?.access_token) {
      tokenState.access = refreshed.access_token;
      await saveTokens(siteId, PROVIDER, refreshed, ['https://www.googleapis.com/auth/analytics.readonly']).catch(() => {});
      r = await call(tokenState.access);
    }
  }
  const json = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json };
}

/** Sync one site's GA4 numbers → signals (source='ga4', monthly period — the
 *  same previous-full-calendar-month bucketing the GSC signals use, so the two
 *  Google sources on one dashboard always describe the same month). */
export async function syncGa4ForSite(site: { id: string; client_id: string }, now: Date): Promise<{ ok: boolean; note: string }> {
  const bundle = await loadTokens(site.id, PROVIDER);
  if (!bundle?.access_token) return { ok: false, note: 'not_connected' };
  const tokenState = { access: bundle.access_token, refresh: bundle.refresh_token || null };

  // which property? The stored choice first; else discover, auto-selecting only
  // the unambiguous case (exactly one). Several properties is a human decision —
  // the connection stays honest about needing it rather than guessing a business.
  const cfg = await getConnectionConfig(site.id, PROVIDER);
  let prop = ga4PropertyPath(cfg.property_id);
  if (!prop) {
    const found = await discoverGa4Properties(tokenState.access);
    if (!found.ok) { await markStatus(site.id, PROVIDER, found.status === 401 ? 'expired' : 'error', found.status === 401 ? 'attention' : 'down', `read ${found.status}`).catch(() => {}); return { ok: false, note: `discovery_${found.status}` }; }
    if (found.properties.length === 1) {
      const only = found.properties[0];
      await setConnectionConfig(site.id, PROVIDER, { property_id: only.id, property_name: only.name, auto_selected: true }).catch(() => {});
      prop = ga4PropertyPath(only.id);
    } else {
      const why = found.properties.length === 0
        ? 'That Google account has no Google Analytics property yet — connect the account that owns this website’s Analytics, or create the property first.'
        : `Choose which Google Analytics property is this website — that account has ${found.properties.length}.`;
      await markStatus(site.id, PROVIDER, 'connected', 'attention', why).catch(() => {});
      return { ok: false, note: 'no_property' };
    }
  }
  if (!prop) return { ok: false, note: 'bad_property' };

  const { startDate, endDate, period } = gscMonthWindow(now);
  const res = await runReport(site.id, prop, ga4RunReportBody(startDate, endDate), tokenState);
  if (!res.ok) {
    // 403/404 with a STORED property usually means the reconnected account no
    // longer sees it — connectionReason translates `read 403`/`read 404` into
    // the plain sentence the card shows.
    await markStatus(site.id, PROVIDER, res.status === 401 ? 'expired' : 'error', res.status === 401 ? 'attention' : 'down', `read ${res.status}`).catch(() => {});
    return { ok: false, note: `report_${res.status}` };
  }

  const totals = parseGa4Report(res.json);
  const rows = ga4SignalRows(site.client_id, period, totals);
  if (rows.length) {
    await svc('signals?on_conflict=client_id,metric,period,source', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows),
    }).catch(() => {});
  }
  await markStatus(site.id, PROVIDER, 'connected', 'ok').catch(() => {});
  return { ok: true, note: `synced ${period} (${totals.visitors ?? 0} visitors)` };
}

/** Scheduled sync across every connected GA4 site. Secret-gated via /system/run
 *  (task 'ga4_sync'), scheduled by supabase/ops/schedule-presence-cron.sql. */
export async function runGa4Sync(limit = 100, now: Date = new Date()): Promise<{ ok: boolean; synced: number; failed: number; skipped: number }> {
  const conns = arr(await svc(`presence_connections?provider_key=eq.${PROVIDER}&status=eq.connected&select=site_id&limit=${limit}`));
  let synced = 0, failed = 0, skipped = 0;
  for (const c of conns) {
    const site = arr(await svc(`presence_sites?id=eq.${c.site_id}&select=id,client_id&limit=1`))[0];
    if (!site) { skipped++; continue; }
    try { const r = await syncGa4ForSite(site, now); r.ok ? synced++ : (r.note === 'not_connected' || r.note === 'no_property' ? skipped++ : failed++); }
    catch { failed++; }
  }
  return { ok: failed === 0, synced, failed, skipped };
}
