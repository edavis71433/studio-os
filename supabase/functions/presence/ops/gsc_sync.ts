// ── Phase AN-3.1: Google Search Console — scheduled sync (I/O) ────────────────
// Reuses EVERYTHING: the connected-platform OAuth tokens (loadTokens/refreshTokens,
// encrypted in presence_connection_secrets), the shared `signals` time-series for
// aggregate metrics (AN-3 already reads it), and the ops cron for scheduling. The
// searchAnalytics/query request shape mirrors the proven clever-api collector, so
// the one boundary that can't be live-tested here (Google's API) uses a known-good
// contract. Fail-safe: a site that errors is skipped, never blocks the others.
//
// HOSTING-AGNOSTIC: Search Console reports on a VERIFIED DOMAIN PROPERTY and has
// no opinion about who serves the pages. This sync used to derive the property
// from custom_domain-or-netlify-subdomain, which quietly assumed we host every
// client. gscDomainFor now resolves the domain per SITE EDITION, so a client
// whose established website lives at their own domain syncs exactly as happily.
//
// OWNER-GATED: nothing flows until the Google OAuth app + `webmasters.readonly`
// consent + the CONNECTED_GOOGLE_SEARCH_CONSOLE_* / CONNECTION_ENC_KEY secrets are
// set; without a real token, loadTokens returns null and each site is skipped.
import { svc } from '../lib/db.ts';
import { loadTokens, saveTokens, markStatus } from '../connected/store.ts';
import { refreshTokens } from '../connected/auth.ts';
import { propertyCandidates, gscQueryBody, gscMonthWindow, gscBackMonths, noPropertySentence, parseTotals, parseTermRows, signalRowsFor, gscDomainFor, gscTermBody, foldDaysToMonths, type GscTotals } from '../lib/gsc.ts';
import { readReservedJson, RESERVED_NAMES } from '../lib/reserved_store.ts';
import { normalizeFollowed } from '../lib/search_tools.ts';

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

/** The client's own website address, when we are not the ones hosting it. Read
 *  per-site (never assumed): a monitor-edition workspace watches an EXTERNAL
 *  site, and that domain — not a netlify subdomain we never deployed — is the
 *  Search Console property. `status` is deliberately NOT filtered to 'verified':
 *  Search Console does its own ownership check (an unverified property answers
 *  403/404 and propertyCandidates simply moves on), so requiring OUR meta-tag
 *  verification first would block a client whose domain Google already trusts. */
async function externalDomainFor(siteId: string): Promise<string | null> {
  const r = await svc(`presence_monitor_connections?site_id=eq.${siteId}&select=domain&limit=1`).catch(() => null);
  return (r && arr(r)[0]?.domain) ? String(arr(r)[0].domain) : null;
}

/** How many earlier months a first read fills in. Twelve gives the trend line a
 *  full year; the sync stays one query per month, well inside Google's quota. */
const BACKFILL_MONTHS = 12;

/** Sync one site's GSC data → signals (aggregate) + presence_search_terms (detail).
 *  `backfill` is the first-read path: when this client has almost no history yet,
 *  the earlier months come too. The daily cron leaves it off. */
export async function syncGscForSite(site: { id: string; client_id: string; custom_domain: string | null; netlify_site_id: string | null; edition?: string | null }, now: Date, externalDomain?: string | null, opts: { backfill?: boolean } = {}): Promise<{ ok: boolean; note: string; totals?: GscTotals; attention?: string; status?: number }> {
  const bundle = await loadTokens(site.id, PROVIDER);
  if (!bundle?.access_token) return { ok: false, note: 'not_connected' };
  const tokenState = { access: bundle.access_token, refresh: bundle.refresh_token || null };
  const ext = externalDomain !== undefined ? externalDomain : await externalDomainFor(site.id);
  const picked = gscDomainFor(site, ext);
  if (!picked) {
    // Two different silences: we host it and no domain is attached yet, vs. we
    // don't host it and nobody has told us where their website is. The second is
    // fixable by Eric in a sentence, so it says so where he'll see it.
    if (site.edition === 'monitor') {
      const attention = 'Add this client’s website address — Search Console needs to know which domain to report on';
      await markStatus(site.id, PROVIDER, 'connected', 'attention', attention).catch(() => {});
      return { ok: false, note: 'no_external_domain', attention };
    }
    return { ok: false, note: 'no_domain', attention: 'Search numbers start once this website is live. Publish it and they’ll follow.' };
  }
  const domain = picked.domain;
  const { startDate, endDate, period } = gscMonthWindow(now);

  // find the verified property (Domain vs URL-prefix), reusing the proven candidates
  let prop = '';
  let totalsResp: any = null;
  let failure = 0;   // an answer that isn't "not this property": a lapsed token or Google having trouble
  for (const cand of propertyCandidates(domain)) {
    const res = await query(site.id, cand, gscQueryBody(startDate, endDate, [], 1), tokenState);
    if (res.status === 403 || res.status === 404) continue;      // not verified for this account → try next
    if (res.ok) { prop = cand; totalsResp = res.json; break; }
    failure = res.status;
  }
  // A lapsed token used to fall through to "no verified property", which sends
  // someone off to fix Search Console when the fix is one tap on Reconnect.
  if (!prop && failure) return { ok: false, note: `read_${failure}`, status: failure };
  if (!prop) {
    const listed = await fetch('https://www.googleapis.com/webmasters/v3/sites', { headers: { Authorization: `Bearer ${tokenState.access}`, accept: 'application/json' }, signal: AbortSignal.timeout(8000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const attention = noPropertySentence(domain, listed);
    await markStatus(site.id, PROVIDER, 'connected', 'attention', attention).catch(() => {});
    return { ok: false, note: 'no_verified_property', attention };
  }

  // aggregate metrics → signals (mapped site → client_id, the store AN-3 reads)
  const totals = parseTotals(totalsResp);
  await svc('signals?on_conflict=client_id,metric,period,source', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(signalRowsFor(site.client_id, period, totals)) }).catch(() => {});

  // detail breakdowns → presence_search_terms (top queries + pages; bounded rows = quota-safe)
  for (const dim of ['query', 'page'] as const) {
    const res = await query(site.id, prop, gscQueryBody(startDate, endDate, [dim], 25), tokenState);
    if (!res.ok) continue;
    const terms = parseTermRows(res.json, 25).map((t) => ({ client_id: site.client_id, period, dimension: dim, key: t.key, clicks: t.clicks, impressions: t.impressions, position: t.position }));
    if (terms.length) await svc('presence_search_terms?on_conflict=client_id,period,dimension,key', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(terms) }).catch(() => {});
    if (dim === 'query') await syncFollowed(site, prop, startDate, endDate, period, new Set(terms.map((t) => t.key)), tokenState).catch(() => {});
  }

  if (opts.backfill) {
    const have = arr(await svc(`signals?client_id=eq.${encodeURIComponent(site.client_id)}&source=eq.gsc&metric=eq.search_impressions&select=period&limit=3`).catch(() => ({})));
    if (have.length < 3) {
      for (const month of gscBackMonths(now, BACKFILL_MONTHS)) {
        const res = await query(site.id, prop, gscQueryBody(month.startDate, month.endDate, [], 1), tokenState);
        if (!res.ok) break;   // keep whatever landed; the next read tries the rest
        const t = parseTotals(res.json);
        // Months before the site was on Google are absent, not zero. Storing
        // zeros would draw a flat year that never happened.
        if (t.impressions > 0) await svc('signals?on_conflict=client_id,metric,period,source', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(signalRowsFor(site.client_id, month.period, t)) }).catch(() => {});
      }
    }
  }

  await markStatus(site.id, PROVIDER, 'connected', 'ok').catch(() => {});
  return { ok: true, note: `synced ${period} (${totals.impressions} impressions)`, totals };
}

/** Builder list item 181: the month's line for each search this site follows that
 *  isn't already among the month's top 25, asked for by name (one small query each,
 *  ten at most). A search nobody used that month gets no line, never a zero place. */
async function syncFollowed(site: { id: string; client_id: string }, prop: string, startDate: string, endDate: string, period: string, have: Set<string>, tokenState: { access: string; refresh: string | null }) {
  const { terms } = normalizeFollowed(await readReservedJson(site.id, RESERVED_NAMES.followedSearches));
  for (const t of terms) {
    if (have.has(t.term)) continue;
    const res = await query(site.id, prop, gscTermBody(startDate, endDate, t.term, ['query'], 1), tokenState);
    if (!res.ok) break;
    const row = parseTermRows(res.json, 1)[0];
    if (row && row.impressions > 0) await svc('presence_search_terms?on_conflict=client_id,period,dimension,key', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([{ client_id: site.client_id, period, dimension: 'query', key: t.term, clicks: row.clicks, impressions: row.impressions, position: row.position }]) }).catch(() => {});
  }
}

/** Builder list item 181: when a search is first followed, its last six whole months,
 *  from one query by day, so its chart has a past on the day it's added. Months
 *  already kept (the month's top 25) are left as they are. Best-effort. */
export async function backfillFollowed(site: { id: string; client_id: string; custom_domain: string | null; netlify_site_id: string | null; edition?: string | null }, terms: string[], now: Date = new Date()): Promise<number> {
  if (!terms.length) return 0;
  const bundle = await loadTokens(site.id, PROVIDER);
  if (!bundle?.access_token) return 0;
  const tokenState = { access: bundle.access_token, refresh: bundle.refresh_token || null };
  const picked = gscDomainFor(site, await externalDomainFor(site.id));
  if (!picked) return 0;
  const last = gscMonthWindow(now), first = gscBackMonths(now, 5).slice(-1)[0] || last;
  let prop = '';
  for (const cand of propertyCandidates(picked.domain)) {
    const res = await query(site.id, cand, gscQueryBody(last.startDate, last.endDate, [], 1), tokenState);
    if (res.ok) { prop = cand; break; }
    if (res.status !== 403 && res.status !== 404) return 0;
  }
  if (!prop) return 0;
  let kept = 0;
  for (const term of terms.slice(0, 10)) {
    const res = await query(site.id, prop, gscTermBody(first.startDate, last.endDate, term, ['date'], 250), tokenState);
    if (!res.ok) break;
    const rows = foldDaysToMonths(res.json).map((m) => ({ client_id: site.client_id, dimension: 'query', key: term, ...m }));
    if (rows.length) { await svc('presence_search_terms?on_conflict=client_id,period,dimension,key', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(rows) }).catch(() => {}); kept += rows.length; }
  }
  return kept;
}

/** Scheduled sync across every connected GSC site. Secret-gated via /system/run. */
export async function runGscSync(limit = 100, now: Date = new Date()): Promise<{ ok: boolean; synced: number; failed: number; skipped: number }> {
  const conns = arr(await svc(`presence_connections?provider_key=eq.${PROVIDER}&status=eq.connected&select=site_id&limit=${limit}`));
  let synced = 0, failed = 0, skipped = 0;
  for (const c of conns) {
    const site = arr(await svc(`presence_sites?id=eq.${c.site_id}&select=id,client_id,custom_domain,netlify_site_id,edition&limit=1`))[0];
    if (!site) { skipped++; continue; }
    try { const r = await syncGscForSite(site, now); r.ok ? synced++ : (r.note === 'not_connected' ? skipped++ : failed++); }
    catch { failed++; }
  }
  return { ok: failed === 0, synced, failed, skipped };
}
