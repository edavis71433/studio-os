// ── Phase AN-3.1: Google Search Console — pure helpers ───────────────────────
// Deterministic parsing/shaping for GSC. The actual API call + token handling
// live in ops/gsc_sync.ts (I/O); everything here is pure and unit-tested. The
// request/response shapes mirror the PROVEN clever-api collector exactly, so the
// one boundary I cannot live-test here (the Google API itself) uses a known-good
// contract rather than a guess.

/** Candidate GSC property identifiers for a domain, tried in order (a site may be
 *  verified as a Domain property or a URL-prefix property). Mirrors clever-api. */
export function propertyCandidates(domain: string): string[] {
  const d = String(domain || '').replace(/^https?:\/\//, '').replace(/\/$/, '').replace(/^www\./, '').toLowerCase();
  if (!d) return [];
  return [`sc-domain:${d}`, `https://${d}/`, `https://www.${d}/`];
}

/** Which domain should Search Console be asked about for this site?
 *
 *  Search Console reports on a VERIFIED DOMAIN PROPERTY. It does not care who
 *  hosts the site — so the answer is "wherever this client's website actually
 *  lives", which for a large part of Eric's book is a domain he does not host.
 *
 *    monitor edition — the site row is a workspace ABOUT someone else's website
 *                      (0031: "observing the customer's EXISTING external
 *                      website (no hosting, no publishing)"). Its real address
 *                      is the verified/pending external one in
 *                      presence_monitor_connections.domain. It is NEVER a
 *                      *.netlify.app: we deploy nothing for it, so a stale
 *                      netlify_site_id would point Google at the wrong property.
 *    presence edition — we host it. custom_domain is the address people type;
 *                      the netlify subdomain is the fallback while a custom
 *                      domain is still being pointed. An external domain may
 *                      still be recorded (a client whose old site is live
 *                      elsewhere while we build the new one) and is preferred
 *                      over the netlify subdomain, because that is where the
 *                      established search presence actually is.
 *
 *  Pure; returns null when we simply don't know where the website is — which is
 *  a different, honestly-reportable situation from "no numbers yet". */
export type GscDomainSource = 'external' | 'custom_domain' | 'netlify';
export function gscDomainFor(
  site: { edition?: string | null; custom_domain?: string | null; netlify_site_id?: string | null },
  externalDomain?: string | null,
): { domain: string; source: GscDomainSource } | null {
  const host = (v: unknown) => String(v ?? '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./i, '').toLowerCase();
  const ext = host(externalDomain);
  const custom = host(site?.custom_domain);
  const netlify = site?.netlify_site_id ? `${site.netlify_site_id}.netlify.app` : '';
  const order: Array<[GscDomainSource, string]> = site?.edition === 'monitor'
    ? [['external', ext], ['custom_domain', custom]]
    : [['custom_domain', custom], ['external', ext], ['netlify', netlify]];
  for (const [source, domain] of order) if (domain) return { domain, source };
  return null;
}

/** The searchAnalytics/query request body. dimensions=[] → site totals; else a
 *  breakdown. Bounded rowLimit keeps us well inside API quotas. */
export function gscQueryBody(startDate: string, endDate: string, dimensions: string[] = [], rowLimit = 1) {
  return { startDate, endDate, dimensions, rowLimit: Math.min(Math.max(rowLimit, 1), 250) };
}

/** The month window (previous full calendar month) as GSC ISO dates + the period
 *  label. `now` is passed in (never Date.now() implicitly) for determinism/tests. */
export function gscMonthWindow(now: Date): { startDate: string; endDate: string; period: string } {
  const y = now.getUTCFullYear(), m = now.getUTCMonth(); // 0-based
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0)); // last day of previous month
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const period = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`;
  return { startDate: iso(start), endDate: iso(end), period };
}

export interface GscTotals { impressions: number; clicks: number; ctr: number | null; position: number | null; }
/** Parse the site-total response (dimensions=[]) → aggregate metrics. */
export function parseTotals(resp: any): GscTotals {
  const row = (resp && Array.isArray(resp.rows) && resp.rows[0]) || {};
  const impressions = Number(row.impressions) || 0;
  const clicks = Number(row.clicks) || 0;
  return {
    impressions, clicks,
    ctr: typeof row.ctr === 'number' ? row.ctr : (impressions > 0 ? clicks / impressions : null),
    position: typeof row.position === 'number' ? row.position : null,
  };
}

export interface GscTermRow { key: string; clicks: number; impressions: number; position: number | null; }
/** Parse a dimension breakdown response (rows have `keys:[value]`). Pure. */
export function parseTermRows(resp: any, max = 25): GscTermRow[] {
  const rows = (resp && Array.isArray(resp.rows) && resp.rows) || [];
  return rows.slice(0, max).map((r: any) => ({
    key: String((r.keys && r.keys[0]) ?? '').slice(0, 400),
    clicks: Number(r.clicks) || 0,
    impressions: Number(r.impressions) || 0,
    position: typeof r.position === 'number' ? r.position : null,
  })).filter((r: GscTermRow) => r.key);
}

/** Build the `signals` upsert rows for the aggregate metrics of one period. Pure. */
export function signalRowsFor(clientId: string, period: string, t: GscTotals): Array<Record<string, unknown>> {
  const base = { client_id: clientId, period, source: 'gsc', unit: 'count', confidence: 'measured', scope: 'client' };
  const rows: Array<Record<string, unknown>> = [
    { ...base, metric: 'search_impressions', value: t.impressions },
    { ...base, metric: 'search_clicks', value: t.clicks },
  ];
  if (t.ctr !== null) rows.push({ ...base, metric: 'search_ctr', value: Math.round(t.ctr * 1000) / 10 }); // pct, 1dp
  if (t.position !== null) rows.push({ ...base, metric: 'avg_position', value: Math.round(t.position * 10) / 10 });
  return rows;
}
