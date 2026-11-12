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
  site: { id?: string | null; edition?: string | null; custom_domain?: string | null; netlify_site_id?: string | null },
  externalDomain?: string | null,
): { domain: string; source: GscDomainSource } | null {
  const host = (v: unknown) => String(v ?? '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./i, '').toLowerCase();
  const ext = host(externalDomain);
  const custom = host(site?.custom_domain);
  // netlify_site_id is Netlify's internal id, not part of the address. The address is
  // the name the provisioner gives every site (routes/admin.ts), built from our own id.
  const netlify = !site?.netlify_site_id ? ''
    : site.id ? `presence-${String(site.id).replace(/-/g, '').slice(0, 12)}.netlify.app`
    : `${site.netlify_site_id}.netlify.app`;
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

/** The full calendar months before gscMonthWindow's, newest first. Search Console
 *  keeps about 16 months, so a site with history can show a real trend on the day
 *  it connects instead of waiting a year for one to build up. Pure. */
export function gscBackMonths(now: Date, count: number): Array<{ startDate: string; endDate: string; period: string }> {
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  return Array.from({ length: Math.max(0, count) }, (_, i) => gscMonthWindow(new Date(Date.UTC(y, m - 1 - i, 1))));
}

/** What to tell someone whose Google account can't see this site, naming what it
 *  CAN see: picking the wrong account is the usual cause, and the list is what
 *  makes that obvious. Pure; `sites` is the sites.list response. */
export function noPropertySentence(domain: string, sitesResp: any): string {
  const seen: string[] = ((sitesResp && Array.isArray(sitesResp.siteEntry) && sitesResp.siteEntry) || [])
    .map((s: any) => String(s?.siteUrl || '').replace(/^sc-domain:/, '').replace(/^https?:\/\//, '').replace(/\/$/, ''))
    .filter(Boolean);
  const start = `That Google account can’t see ${domain} in Search Console.`;
  if (!seen.length) return `${start} Add the site in Search Console, or connect the account that owns it.`.slice(0, 200);
  const shown = seen.slice(0, 3).join(', ');
  return `${start} It can see ${shown}${seen.length > 3 ? ' and others' : ''}. Connect the account that owns it.`.slice(0, 200);
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

// ── Builder list item 181: searches a client follows ──
/** One search's numbers, asked for by name: Google filters the rows to that exact
 *  query, so a search outside the month's top 25 still gets its own line. `dims`
 *  ['query'] for a month's total, ['date'] for its days. */
export function gscTermBody(startDate: string, endDate: string, term: string, dims: string[] = ['query'], rowLimit = 1) {
  return { ...gscQueryBody(startDate, endDate, dims, rowLimit), dimensionFilterGroups: [{ filters: [{ dimension: 'query', operator: 'equals', expression: term }] }] };
}

/** Days of one search (dimensions ['date']) folded into whole months: clicks and
 *  impressions added up, the place averaged by impressions, as Google averages it.
 *  A month with no impressions is left out, never a zero place. Pure. */
export function foldDaysToMonths(resp: any): Array<{ period: string; clicks: number; impressions: number; position: number | null }> {
  const by = new Map<string, { clicks: number; impressions: number; weighted: number }>();
  for (const r of (resp && Array.isArray(resp.rows) ? resp.rows : [])) {
    const day = String((r.keys && r.keys[0]) || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const m = by.get(day.slice(0, 7)) || { clicks: 0, impressions: 0, weighted: 0 };
    const imp = Number(r.impressions) || 0;
    m.clicks += Number(r.clicks) || 0; m.impressions += imp;
    if (typeof r.position === 'number') m.weighted += r.position * imp;
    by.set(day.slice(0, 7), m);
  }
  return [...by.entries()].filter(([, m]) => m.impressions > 0).sort(([a], [b]) => a.localeCompare(b))
    .map(([period, m]) => ({ period, clicks: m.clicks, impressions: m.impressions, position: m.weighted ? Math.round((m.weighted / m.impressions) * 10) / 10 : null }));
}
