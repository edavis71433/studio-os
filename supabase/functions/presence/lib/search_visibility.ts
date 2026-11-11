// ── The Search tab's composition (PURE) ──────────────────────────────────────
// The score isn't a new measurement. It is the studio's own Site Review (and,
// beside it, its AI Visibility Check): the same checks and scoring the public
// tools run, read from the shared tool_reports store. Nothing here invents a
// number, and a website we can't read yet has no score rather than a low one.

export interface VisibilitySite {
  id: string;
  edition?: string | null;
  custom_domain?: string | null;
  last_published_at?: string | null;
}

// A bare hostname or nothing. This ends up inside a PostgREST in.(…) list and a URL
// to fetch, so anything that isn't a hostname character never gets that far.
const hostOnly = (v: unknown) => {
  const h = String(v ?? '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
  return /^[a-z0-9.-]+$/.test(h) ? h : '';
};

/** Where this website can actually be read from the outside, which is what a
 *  check needs and is narrower than "which domain does Google report on": a site
 *  we host and have never published has nothing there to read, even when a custom
 *  domain is already attached.
 *    monitor edition — only the recorded external address exists
 *    hosted, live    — the custom domain, else its hosting address
 *    hosted, draft   — a recorded external address (a rebuild whose old site is
 *                      still the live one), else nothing yet */
export function liveAddress(site: VisibilitySite, externalDomain?: string | null): { url: string; domain: string; hosted: boolean } | null {
  const ext = hostOnly(externalDomain);
  const external = ext ? { url: `https://${ext}/`, domain: ext, hosted: false } : null;
  if (site.edition === 'monitor') return external;
  if (!site.last_published_at) return external;
  const custom = hostOnly(site.custom_domain);
  // The hosting name the provisioner gives every site (routes/admin.ts).
  const domain = custom || `presence-${String(site.id).replace(/-/g, '').slice(0, 12)}.netlify.app`;
  return { url: `https://${domain}/`, domain, hosted: true };
}

/** What Search says when there's no address to read. */
export function visibilityState(site: VisibilitySite, address: unknown): 'ready' | 'no_domain' | 'draft' {
  if (address) return 'ready';
  return site.edition === 'monitor' ? 'no_domain' : 'draft';
}

/** Every spelling a report's stored url can take for this domain. Matching on the
 *  whole value, never a pattern, so another site's address that merely contains
 *  this one (notmarlows.example) can't lend its score. */
export function reportUrlCandidates(domain: string): string[] {
  const d = hostOnly(domain).replace(/^www\./, '');
  if (!d) return [];
  const out: string[] = [];
  for (const scheme of ['https', 'http']) for (const host of [d, `www.${d}`]) for (const tail of ['/', '']) out.push(`${scheme}://${host}${tail}`);
  return out;
}

/** A PostgREST `in.(…)` over those candidates, ready for a query string. */
export function reportUrlFilter(domain: string): string {
  const list = reportUrlCandidates(domain).map((u) => `"${u}"`).join(',');
  return list ? `input->>url=in.(${encodeURIComponent(list)})` : '';
}

/** The Site Review's own business types, from the site's industry setting. The
 *  review uses this to judge a couple of checks; "other" is always safe. */
export function reviewBusinessType(industryKey: unknown): string {
  const k = String(industryKey ?? '');
  if (['restaurant', 'bar', 'coffee_shop'].includes(k)) return 'restaurant';
  if (['salon', 'barber', 'spa'].includes(k)) return 'salon';
  if (k === 'retail') return 'retail';
  if (['home_services', 'cleaning', 'contractor', 'electrician', 'hvac', 'landscaping', 'plumber', 'roofing'].includes(k)) return 'home services';
  if (['dental', 'fitness', 'medical', 'veterinary'].includes(k)) return 'health and wellness';
  return 'other';
}

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? v as T[] : []);
const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {});
const scoreOf = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);

/** A Site Review row → what the Search tab shows. The owner sees every finding,
 *  including on a report someone ran through the public tool: the email gate is
 *  there for strangers, and this is their own website. */
export function scoreSummary(row: Record<string, unknown> | null | undefined, reportBase: string) {
  if (!row) return null;
  const scores = obj(row.scores), findings = obj(row.findings);
  const overall = scoreOf(scores.overall);
  if (overall === null) return null;
  const items = arr<Record<string, unknown>>(findings.items);
  return {
    overall,
    label: String(scores.label || ''),
    pillars: arr<Record<string, unknown>>(scores.pillars).map((p) => ({ name: String(p.name || ''), score: scoreOf(p.score), note: String(p.note || '') })),
    summary: String(findings.summary || ''),
    notes: arr<string>(scores.notes).map(String),
    issue_count: items.length,
    issues: items.slice(0, 6).map((f) => ({
      title: String(f.title || ''), what: String(f.what_we_found || ''), why: String(f.why_it_matters || ''), fix: String(f.fix || ''),
      priority: String(f.priority || ''), pillar: String(f.pillar || ''),
    })),
    checked_at: String(row.created_at || ''),
    report_url: row.id ? `${reportBase}/report/${row.id}` : null,
  };
}

/** One of the saved check's tables, by its title (the report page draws the same ones). */
const reportRows = (findings: Record<string, any>, title: string): unknown[][] =>
  arr<unknown[]>(arr<Record<string, any>>(findings.tables).find((t) => t.title === title)?.rows).filter(Array.isArray);

/** An AI Visibility row → its headline. Only the result: who ran it is not ours to
 *  show, and the name is shown so a check run under another spelling reads as such.
 *  List item 153: with it, who the assistants named instead and the websites their
 *  answers drew on, the most-named and most-cited first, as the report lists them. */
export function aiSummary(row: Record<string, unknown> | null | undefined, reportBase: string) {
  if (!row) return null;
  const scores = obj(row.scores), input = obj(row.input), findings = obj(row.findings);
  const overall = scoreOf(scores.overall);
  if (overall === null) return null;
  return {
    overall,
    label: String(scores.label || ''),
    pillars: arr<Record<string, unknown>>(scores.pillars).map((p) => ({ name: String(p.name || ''), score: scoreOf(p.score) })),
    business_name: String(input.business_name || ''),
    city: String(input.city || ''),
    checked_at: String(row.created_at || ''),
    report_url: row.id ? `${reportBase}/report/${row.id}` : null,
    competitors: reportRows(findings, 'Who AI recommends instead').slice(0, 3)
      .map((r) => ({ name: String(r[0] ?? '').trim(), times: Number(r[1]) || 0 })).filter((c) => c.name),
    sources: reportRows(findings, 'Sources AI used').filter((r) => Number(r[1]) > 0).slice(0, 4)
      .map((r) => ({ name: String(r[0] ?? '').trim(), cited: Number(r[1]) || 0, own: r[3] === 'Your website' })).filter((x) => x.name),
  };
}
