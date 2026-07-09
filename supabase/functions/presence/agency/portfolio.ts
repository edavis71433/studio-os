// ── Portfolio + work queues (M13) — PURE builders over existing rows ────────
// Everything here is derived from rows the frozen architecture already
// produces: moments, evidence, growth opportunities, infra plans, drafts,
// monitor readiness, publishes, change events. No new intelligence, no
// scores, no dashboards — grouped, actionable work queues in plain words.
// The builders are pure functions of batched query results, so the whole
// portfolio costs a FIXED number of queries regardless of client count.

export interface SiteLite { id: string; edition: string; status: string; last_published_at: string | null; custom_domain: string | null; domain_registrar?: string | null; domain_expires_at?: string | null }
export interface LeadLite { site_id: string }
export interface NoticeLite { site_id: string; kind: string }
export interface LinkRow { site_id: string; status: string; tags: string[]; owner_email: string; assigned: string[]; notes: string; onboarded_at: string }
export interface MomentLite { site_id: string; moment_key: string; type: string; headline: string }
export interface EvLite { site_id: string; type: string; severity: string; human: string }
export interface OppLite { site_id: string; area: string; opportunity: string; timing_ends: string | null; created_at: string }
export interface PlanLite { site_id: string; kind: string; title: string; status: string }
export interface DraftLite { site_id: string; kind: string; status: string; created_at: string }
export interface ConnLite { site_id: string; status: string; readiness: { state?: string } | null }
export interface ReportLite { site_id: string; status: string; open_count: number }
export interface EventLite { site_id: string; created_at: string }

export interface PortfolioInput {
  sites: SiteLite[]; links: LinkRow[]; clientNames: Record<string, string>;
  moments: MomentLite[]; evidence: EvLite[]; opportunities: OppLite[];
  plans: PlanLite[]; drafts: DraftLite[]; connections: ConnLite[];
  reviewReports: ReportLite[]; brandReports: ReportLite[];
  leads?: LeadLite[]; notices?: NoticeLite[];   // PP/Section-3: waiting leads + active notices
  filesPending?: Record<string, number>;         // DAM-2: site_id → files awaiting approval
  billingBySite?: Record<string, string>;       // site_id → entitlement status (active|paused|lapsed)
  lastChange: Record<string, string>;      // site_id → latest change event at
  nowIso: string;
}

const by = <T extends { site_id: string }>(rows: T[]): Map<string, T[]> => {
  const m = new Map<string, T[]>();
  for (const r of rows) { const a = m.get(r.site_id) || []; a.push(r); m.set(r.site_id, a); }
  return m;
};
const days = (a: string, b: string) => Math.floor((new Date(a).getTime() - new Date(b).getTime()) / 86400000);

/* ── the directory: one row per client, everything observable at a glance ── */
export function buildPortfolio(i: PortfolioInput) {
  const moments = by(i.moments), ev = by(i.evidence), opps = by(i.opportunities),
    plans = by(i.plans), drafts = by(i.drafts), conns = by(i.connections),
    reviews = by(i.reviewReports), brands = by(i.brandReports),
    leads = by(i.leads || []), notices = by(i.notices || []);
  const billingBySite = i.billingBySite || {};
  const links = new Map(i.links.map((l) => [l.site_id, l]));
  return i.sites.map((s) => {
    const l = links.get(s.id);
    const crit = (ev.get(s.id) || []).filter((e) => e.severity === 'critical');
    const lastChange = i.lastChange[s.id] || null;
    // Section 3: the at-a-glance status, all from rows already gathered.
    const plansWaiting = (plans.get(s.id) || []).filter((p) => p.status === 'proposed' || p.status === 'approved').length;
    const noticeRows = notices.get(s.id) || [];
    const billing = billingBySite[s.id] || 'active';
    const billing_issue = billing === 'paused' || billing === 'lapsed'
      || noticeRows.some((n) => n.kind === 'payment_trouble' || n.kind === 'account_lapsed');
    const search_issues = (ev.get(s.id) || []).filter((e) => /^(search|seo)\./.test(e.type)).length;
    return {
      site_id: s.id,
      name: i.clientNames[s.id] || '(unnamed)',
      edition: s.edition, status: s.status,
      archived: l?.status === 'archived',
      tags: l?.tags || [], owner: l?.owner_email || '', assigned: l?.assigned || [],
      has_notes: !!(l?.notes || '').trim(),
      domain: s.custom_domain,
      domain_registrar: s.domain_registrar || null,
      domain_expires_at: s.domain_expires_at || null,
      moments: (moments.get(s.id) || []).length,
      criticals: crit.length,
      open_opportunities: (opps.get(s.id) || []).length,
      plans_waiting: plansWaiting,
      drafts_waiting: (drafts.get(s.id) || []).filter((d) => d.status === 'proposed').length,
      leads_waiting: (leads.get(s.id) || []).length,
      files_pending: (i.filesPending || {})[s.id] || 0,   // DAM-2: files awaiting approval
      search_issues,
      billing_issue,
      // one number the agency scans: things actively asking for someone (active notices + approvals + waiting leads + files)
      attention: noticeRows.length + plansWaiting + (leads.get(s.id) || []).length + ((i.filesPending || {})[s.id] || 0),
      review_open: (reviews.get(s.id) || []).some((r) => r.status === 'open' && r.open_count > 0)
        || (brands.get(s.id) || []).some((r) => r.status === 'open' && r.open_count > 0),
      migration: (conns.get(s.id) || [])[0]?.readiness?.state || null,
      last_published_at: s.last_published_at,
      unpublished_changes: !!lastChange && (!s.last_published_at || lastChange > s.last_published_at),
      last_change_at: lastChange,
    };
  });
}

/* ── directory filtering (search / tags / status) — pure ── */
export function filterPortfolio(rows: ReturnType<typeof buildPortfolio>, q: { search?: string; tag?: string; archived?: boolean }) {
  return rows.filter((r) => {
    if (r.archived !== (q.archived === true)) return false;   // archived hidden unless asked for
    if (q.tag && !r.tags.includes(q.tag)) return false;
    if (q.search) {
      const s = q.search.toLowerCase();
      if (!r.name.toLowerCase().includes(s) && !(r.domain || '').includes(s) && !r.tags.some((t: string) => t.toLowerCase().includes(s))) return false;
    }
    return true;
  });
}

/* ── work queues: actionable, grouped, from the EXISTING pipeline only ── */
export interface QueueItem { site_id: string; name: string; why: string }
export interface WorkQueue { key: string; title: string; items: QueueItem[] }

export function buildQueues(i: PortfolioInput): WorkQueue[] {
  const name = (id: string) => i.clientNames[id] || '(unnamed)';
  const active = new Set(i.links.filter((l) => l.status === 'active').map((l) => l.site_id));
  const on = <T extends { site_id: string }>(rows: T[]) => rows.filter((r) => active.has(r.site_id));
  const dedupe = (items: QueueItem[]) => {
    const seen = new Set<string>();
    return items.filter((x) => !seen.has(x.site_id + '|' + x.why) && seen.add(x.site_id + '|' + x.why));
  };
  const Q = (key: string, title: string, items: QueueItem[]): WorkQueue => ({ key, title, items: dedupe(items) });

  const evOf = (types: (t: string, sev: string) => boolean) =>
    on(i.evidence).filter((e) => types(e.type, e.severity)).map((e) => ({ site_id: e.site_id, name: name(e.site_id), why: e.human }));

  return [
    Q('high_priority', 'High priority',
      on(i.evidence).filter((e) => e.severity === 'critical').map((e) => ({ site_id: e.site_id, name: name(e.site_id), why: e.human }))
        .concat(on(i.moments).filter((m) => m.type === 'needs_attention').map((m) => ({ site_id: m.site_id, name: name(m.site_id), why: m.headline })))),
    Q('review_today', 'Review today',
      on(i.reviewReports.concat(i.brandReports)).filter((r) => r.status === 'open' && r.open_count > 0)
        .map((r) => ({ site_id: r.site_id, name: name(r.site_id), why: `${r.open_count} open finding${r.open_count === 1 ? '' : 's'} awaiting a look` }))),
    Q('publish_today', 'Publish today',
      on(i.sites.map((s) => ({ site_id: s.id, s }))).filter(({ s }) => {
        const lc = i.lastChange[s.id];
        return !!lc && (!s.last_published_at || lc > s.last_published_at) && s.edition !== 'monitor';
      }).map(({ s }) => ({ site_id: s.id, name: name(s.id), why: 'Changes are sitting unpublished' }))),
    Q('infrastructure', 'Infrastructure',
      evOf((t) => t.startsWith('infrastructure.') || t === 'trust.ssl_missing')
        .concat(on(i.plans).filter((p) => p.status === 'approved').map((p) => ({ site_id: p.site_id, name: name(p.site_id), why: `Approved and waiting: ${p.title}` })))),
    Q('brand_review', 'Brand review',
      on(i.brandReports).filter((r) => r.status === 'open' && r.open_count > 0)
        .map((r) => ({ site_id: r.site_id, name: name(r.site_id), why: `${r.open_count} brand note${r.open_count === 1 ? '' : 's'} open` }))),
    Q('growth', 'Growth opportunities',
      on(i.opportunities).map((o) => ({ site_id: o.site_id, name: name(o.site_id), why: o.opportunity }))),
    Q('migration_ready', 'Migration ready',
      on(i.connections).filter((c) => c.status === 'verified' && (c.readiness?.state === 'ready' || c.readiness?.state === 'mostly_ready'))
        .map((c) => ({ site_id: c.site_id, name: name(c.site_id), why: c.readiness?.state === 'ready' ? 'Ready to move whenever they are' : 'Mostly ready — a few decisions first' }))),
    Q('awaiting_client', 'Awaiting client approval',
      on(i.plans).filter((p) => p.status === 'proposed').map((p) => ({ site_id: p.site_id, name: name(p.site_id), why: `Plan proposed: ${p.title}` }))
        .concat(on(i.drafts).filter((d) => d.status === 'proposed').map((d) => ({ site_id: d.site_id, name: name(d.site_id), why: 'A draft is waiting on their yes' })))),
    Q('waiting_on_agency', 'Waiting on the agency',
      on(i.plans).filter((p) => p.status === 'approved').map((p) => ({ site_id: p.site_id, name: name(p.site_id), why: `Approved plan not yet applied: ${p.title}` }))),
  ];
}

/* ── cross-client patterns: the SAME rows, grouped by concern ── */
export function buildPatterns(i: PortfolioInput): WorkQueue[] {
  const name = (id: string) => i.clientNames[id] || '(unnamed)';
  const active = new Set(i.links.filter((l) => l.status === 'active').map((l) => l.site_id));
  const evPattern = (key: string, title: string, match: (t: string) => boolean) => ({
    key, title,
    items: [...new Map(i.evidence.filter((e) => active.has(e.site_id) && match(e.type))
      .map((e) => [e.site_id, { site_id: e.site_id, name: name(e.site_id), why: e.human }])).values()],
  });
  const out: WorkQueue[] = [
    evPattern('expiring_domains', 'Domains expiring', (t) => t === 'infrastructure.domain_expiring'),
    evPattern('ssl_missing', 'SSL problems', (t) => t === 'trust.ssl_missing'),
    evPattern('accessibility', 'Accessibility issues', (t) => t.startsWith('accessibility.')),
    evPattern('stale_content', 'Stale content', (t) => t.startsWith('freshness.')),
    evPattern('trust_declining', 'Trust signals thinning', (t) => t.startsWith('trust.') && t !== 'trust.ssl_missing'),
    evPattern('review_requests', 'Should ask for reviews', (t) => t.startsWith('reviews.')),
    evPattern('team_photos', 'Missing faces and story', (t) => t === 'trust.team_info_missing' || t === 'media.imagery_none'),
    { key: 'holiday_updates', title: 'Holiday prep open',
      items: i.opportunities.filter((o) => active.has(o.site_id) && ['holiday', 'seasonal', 'promotion'].includes(o.area))
        .map((o) => ({ site_id: o.site_id, name: name(o.site_id), why: o.opportunity })) },
    { key: 'unresolved_opportunities', title: 'Opportunities sitting unresolved',
      items: i.opportunities.filter((o) => active.has(o.site_id) && days(i.nowIso, o.created_at) >= 14)
        .map((o) => ({ site_id: o.site_id, name: name(o.site_id), why: `${o.opportunity} (open ${days(i.nowIso, o.created_at)} days)` })) },
    { key: 'migration_ready', title: 'Ready for migration',
      items: i.connections.filter((c) => active.has(c.site_id) && c.status === 'verified' && c.readiness?.state === 'ready')
        .map((c) => ({ site_id: c.site_id, name: name(c.site_id), why: 'Readiness says: ready when they are' })) },
  ];
  return out.filter((q) => q.items.length > 0);
}
