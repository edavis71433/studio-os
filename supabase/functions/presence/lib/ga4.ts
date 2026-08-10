// ── GA4: Google Analytics 4 — pure helpers ───────────────────────────────────
// Deterministic shaping/parsing for the GA4 Data + Admin APIs. The actual API
// calls + token handling live in connected/adapters.ts (the on-demand read) and
// ops/ga4_sync.ts (the scheduled sync); everything here is pure and unit-tested.
//
// The one boundary that cannot be live-tested from this environment (Google's
// API itself) uses shapes transcribed from the OFFICIAL contract — both the
// reference docs and the machine-readable discovery documents:
//   • runReport (report over one property):
//     POST https://analyticsdata.googleapis.com/v1beta/properties/{id}:runReport
//     https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport
//     discovery: https://analyticsdata.googleapis.com/$discovery/rest?version=v1beta
//       RunReportRequest  { dateRanges:[{startDate,endDate}], metrics:[{name}], dimensions:[{name}], limit }
//       RunReportResponse { dimensionHeaders:[{name}], metricHeaders:[{name,type}],
//                           rows:[{ dimensionValues:[{value}], metricValues:[{value}] }], rowCount }
//     (metric values arrive as STRINGS — "512", not 512.)
//   • accountSummaries.list (which properties this Google account can read):
//     GET https://analyticsadmin.googleapis.com/v1beta/accountSummaries
//     https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/accountSummaries/list
//     discovery: https://analyticsadmin.googleapis.com/$discovery/rest?version=v1beta
//       { accountSummaries:[{ account, displayName,
//           propertySummaries:[{ property:"properties/123", displayName, propertyType, parent }] }],
//         nextPageToken }
//   • metric names (totalUsers, sessions, screenPageViews):
//     https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema
// Both endpoints accept the ONE scope the registry already declares:
// https://www.googleapis.com/auth/analytics.readonly (verified in both discovery
// documents' per-method `scopes`).

/** The GA4 property identifier in the path form the Data API wants
 *  ("properties/123456"), from either a bare id or an already-pathed one.
 *  Returns null for anything that is not a numeric property id — a wrong id
 *  must fail closed here, never become a malformed URL. */
export function ga4PropertyPath(id: unknown): string | null {
  const s = String(id ?? '').trim().replace(/^properties\//, '');
  return /^\d+$/.test(s) ? `properties/${s}` : null;
}

/** The metrics we read — the plain visitor numbers the analytics surfaces talk
 *  about. Order matters only to the fixture; parsing matches by header name. */
export const GA4_METRICS = ['totalUsers', 'sessions', 'screenPageViews'] as const;

/** RunReportRequest body (transcribed from the official RunReportRequest schema
 *  — see the header). dimensions=[] → property totals in a single row. */
export function ga4RunReportBody(startDate: string, endDate: string, dimensions: string[] = [], limit = 1) {
  return {
    dateRanges: [{ startDate, endDate }],
    metrics: GA4_METRICS.map((name) => ({ name })),
    dimensions: dimensions.map((name) => ({ name })),
    limit: String(Math.min(Math.max(limit, 1), 250)),   // RunReportRequest.limit is a string (int64)
  };
}

/** A recent-days window for the on-demand read (the connections card's "recent
 *  visitors"). `now` passed in for determinism; end date is YESTERDAY — GA4's
 *  intraday numbers for today are still settling, and a number that shrinks on
 *  refresh reads as broken. */
export function ga4RecentWindow(now: Date, days = 30): { startDate: string; endDate: string } {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const end = new Date(now.getTime() - 86_400_000);
  const start = new Date(end.getTime() - (Math.max(1, days) - 1) * 86_400_000);
  return { startDate: iso(start), endDate: iso(end) };
}

export interface Ga4Totals { visitors: number | null; sessions: number | null; pageviews: number | null; hasRows: boolean; }

/** Parse a RunReportResponse (dimensions=[] → one totals row) into plain
 *  numbers. Matches metric values to metrics BY HEADER NAME — the response
 *  echoes `metricHeaders` in request order, but relying on position would break
 *  silently if the request ever changed. Values are strings per the schema.
 *  Never fabricates: absent metric → null, absent rows → hasRows:false
 *  (a property with no data in the window answers rowCount:0 / no rows). */
export function parseGa4Report(resp: any): Ga4Totals {
  const headers: string[] = Array.isArray(resp?.metricHeaders) ? resp.metricHeaders.map((h: any) => String(h?.name || '')) : [];
  const row = (Array.isArray(resp?.rows) && resp.rows[0]) || null;
  const values: unknown[] = row && Array.isArray(row.metricValues) ? row.metricValues.map((v: any) => v?.value) : [];
  const at = (metric: string): number | null => {
    const i = headers.indexOf(metric);
    if (i < 0 || values[i] === undefined) return null;
    const n = Number(values[i]);
    return Number.isFinite(n) ? n : null;
  };
  return { visitors: at('totalUsers'), sessions: at('sessions'), pageviews: at('screenPageViews'), hasRows: !!row };
}

export interface Ga4Property { id: string; name: string; account: string; }

/** Parse a ListAccountSummariesResponse into a flat property list. A property
 *  arrives as "properties/123456"; we keep the bare numeric id (what the config
 *  stores; ga4PropertyPath re-paths it for the call). Malformed entries are
 *  skipped, never guessed at. */
export function parseAccountSummaries(resp: any): Ga4Property[] {
  const out: Ga4Property[] = [];
  const accounts = Array.isArray(resp?.accountSummaries) ? resp.accountSummaries : [];
  for (const a of accounts) {
    const accountName = String(a?.displayName || '');
    const props = Array.isArray(a?.propertySummaries) ? a.propertySummaries : [];
    for (const p of props) {
      const m = /^properties\/(\d+)$/.exec(String(p?.property || ''));
      if (!m) continue;
      out.push({ id: m[1], name: String(p?.displayName || `Property ${m[1]}`), account: accountName });
    }
  }
  return out;
}

/** Build the `signals` upsert rows for one period of GA4 numbers. Pure.
 *  source='ga4' — NEVER 'visits' and never blended into presence_visits-derived
 *  counts: our first-party counter and Google Analytics measure differently
 *  (beacon on pages WE serve vs. Google's tag on pages we may not), so the
 *  provenance travels with every row and every surface labels it. */
export function ga4SignalRows(clientId: string, period: string, t: Ga4Totals): Array<Record<string, unknown>> {
  const base = { client_id: clientId, period, source: 'ga4', unit: 'count', confidence: 'measured', scope: 'client' };
  const rows: Array<Record<string, unknown>> = [];
  if (t.visitors !== null) rows.push({ ...base, metric: 'visitors', value: t.visitors });
  if (t.sessions !== null) rows.push({ ...base, metric: 'sessions', value: t.sessions });
  if (t.pageviews !== null) rows.push({ ...base, metric: 'pageviews', value: t.pageviews });
  return rows;
}
