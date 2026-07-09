// ── Phase AN-3.1: Google Search Console — scheduled sync (I/O) ────────────────
// Reuses EVERYTHING: the connected-platform OAuth tokens (loadTokens/refreshTokens,
// encrypted in presence_connection_secrets), the shared `signals` time-series for
// aggregate metrics (AN-3 already reads it), and the ops cron for scheduling. The
// searchAnalytics/query request shape mirrors the proven clever-api collector, so
// the one boundary that can't be live-tested here (Google's API) uses a known-good
// contract. Fail-safe: a site that errors is skipped, never blocks the others.
//
// OWNER-GATED: nothing flows until the Google OAuth app + `webmasters.readonly`
// consent + the CONNECTED_GOOGLE_SEARCH_CONSOLE_* / CONNECTION_ENC_KEY secrets are
// set; without a real token, loadTokens returns null and each site is skipped.
import { svc } from '../lib/db.ts';
import { loadTokens, saveTokens, markStatus } from '../connected/store.ts';
import { refreshTokens } from '../connected/auth.ts';
import { propertyCandidates, gscQueryBody, gscMonthWindow, parseTotals, parseTermRows, signalRowsFor } from '../lib/gsc.ts';

const PROVIDER = 'google_search_console';
const arr = (r: { json?: unknown }): any[] => (Array.isArray((r as { json?: unknown[] }).json) ? (r as { json: any[] }).json : []);

/** POST searchAnalytics/query for one property, with a 401→refresh→retry once. */
async function query(siteId: string, siteUrl: string, body: unknown, tokenState: { access: string; refresh: string | null }): Promise<{ ok: boolean; status: number; json: any }> {
  const call = (access: string) => fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  let r = await call(tokenState.access);
  if (r.status === 401 && tokenState.refresh) {
    const refreshed = await refreshTokens(PROVIDER, tokenState.refresh).catch(() => null);
    if (refreshed?.access_token) {
      tokenState.access = refreshed.access_token;
      await saveTokens(siteId, PROVIDER, refreshed, ['webmasters.readonly']).catch(() => {});
      r = await call(tokenState.access);
    }
  }
  const json = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json };
}

/** Sync one site's GSC data → signals (aggregate) + presence_search_terms (detail). */
export async function syncGscForSite(site: { id: string; client_id: string; custom_domain: string | null; netlify_site_id: string | null }, now: Date): Promise<{ ok: boolean; note: string }> {
  const bundle = await loadTokens(site.id, PROVIDER);
  if (!bundle?.access_token) return { ok: false, note: 'not_connected' };
  const tokenState = { access: bundle.access_token, refresh: bundle.refresh_token || null };
  const domain = site.custom_domain || (site.netlify_site_id ? `${site.netlify_site_id}.netlify.app` : '');
  if (!domain) return { ok: false, note: 'no_domain' };
  const { startDate, endDate, period } = gscMonthWindow(now);

  // find the verified property (Domain vs URL-prefix), reusing the proven candidates
  let prop = '';
  let totalsResp: any = null;
  for (const cand of propertyCandidates(domain)) {
    const res = await query(site.id, cand, gscQueryBody(startDate, endDate, [], 1), tokenState);
    if (res.status === 403 || res.status === 404) continue;      // not verified for this account → try next
    if (res.ok) { prop = cand; totalsResp = res.json; break; }
  }
  if (!prop) { await markStatus(site.id, PROVIDER, 'connected', 'attention', 'No verified Search Console property for this site’s domain').catch(() => {}); return { ok: false, note: 'no_verified_property' }; }

  // aggregate metrics → signals (mapped site → client_id, the store AN-3 reads)
  const totals = parseTotals(totalsResp);
  await svc('signals?on_conflict=client_id,metric,period,source', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(signalRowsFor(site.client_id, period, totals)) }).catch(() => {});

  // detail breakdowns → presence_search_terms (top queries + pages; bounded rows = quota-safe)
  for (const dim of ['query', 'page'] as const) {
    const res = await query(site.id, prop, gscQueryBody(startDate, endDate, [dim], 25), tokenState);
    if (!res.ok) continue;
    const terms = parseTermRows(res.json, 25).map((t) => ({ client_id: site.client_id, period, dimension: dim, key: t.key, clicks: t.clicks, impressions: t.impressions, position: t.position }));
    if (terms.length) await svc('presence_search_terms?on_conflict=client_id,period,dimension,key', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(terms) }).catch(() => {});
  }

  await markStatus(site.id, PROVIDER, 'connected', 'ok').catch(() => {});
  return { ok: true, note: `synced ${period} (${totals.impressions} impressions)` };
}

/** Scheduled sync across every connected GSC site. Secret-gated via /system/run. */
export async function runGscSync(limit = 100, now: Date = new Date()): Promise<{ ok: boolean; synced: number; failed: number; skipped: number }> {
  const conns = arr(await svc(`presence_connections?provider_key=eq.${PROVIDER}&status=eq.connected&select=site_id&limit=${limit}`));
  let synced = 0, failed = 0, skipped = 0;
  for (const c of conns) {
    const site = arr(await svc(`presence_sites?id=eq.${c.site_id}&select=id,client_id,custom_domain,netlify_site_id&limit=1`))[0];
    if (!site) { skipped++; continue; }
    try { const r = await syncGscForSite(site, now); r.ok ? synced++ : (r.note === 'not_connected' ? skipped++ : failed++); }
    catch { failed++; }
  }
  return { ok: true, synced, failed, skipped };
}
