// ── "Needs you" — the studio's OWN work, nothing else (Oct 2026, home rebuild) ──
// The home used to dump every work queue (critical evidence, customer-audience
// moments, growth opportunities, migration readiness) under one heading, and a
// client whose website merely had five search issues read as "High priority".
// This is the replacement: ONE pure list of things that need the STUDIO's hand,
// in a fixed order, each row "Name — what, in plain words" with a second line
// (when / since) and ONE button with a verb.
//
//   a. money       open invoices: overdue first, then due within 7 days
//   b. enquiry     unanswered website enquiries on a client's site
//   c. support     open support requests
//   d. deal        a deal whose next step is past its date
//   e. broken      publish failed · domain expiring ≤30d · a connection
//                  expired/error/revoked · SSL missing / infrastructure criticals
//   f. plan        approved plans the agency has not applied
//   g. publish     changes sitting unpublished (never a monitor site)
//
// What NEVER appears here, by construction: customer-audience moments (they
// belong to the client's Today), evidence of type seo.* / search.* /
// accessibility.* / freshness.* / trust.* (other than ssl), growth
// opportunities, migration readiness, review and brand reports. The helper
// ignores those inputs even when handed them — tests/presence/needs_you_test.mjs
// proves it.
//
// Pure: no DB, no network, no clock (nowIso is an input). routes.ts gathers the
// rows (fixed query count) and calls needsYouPayload().
export type NeedsKind = 'money' | 'enquiry' | 'support' | 'deal' | 'broken' | 'plan' | 'publish';

export interface NeedsRow {
  key: string;                 // stable: '<kind>:<row id>'
  kind: NeedsKind;
  site_id: string | null;      // the customer's site when known (drill-ins carry ?client=)
  client_id: string | null;
  name: string;                // the customer, as the roster names them
  what: string;                // "invoice $1,600 is overdue by 3 days"
  when: string;                // "Sent Oct 14 · no payment yet"
  verb: string;                // Resend · Open record · Reply · Open deal · Fix · Apply · Review
  href: string;
}

export interface NeedsInput {
  nowIso: string;
  /** the agency's client links — only ACTIVE links feed the list */
  links: Array<{ site_id: string; status: string }>;
  /** site_id → customer name (the portfolio's names) */
  clientNames: Record<string, string>;
  /** client_id → name, for customers the portfolio does not know by site */
  namesByClient?: Record<string, string>;
  sites?: Array<{ id: string; edition?: string; status?: string; last_published_at?: string | null; custom_domain?: string | null; domain_registrar?: string | null; domain_expires_at?: string | null }>;
  /** /sales/receivables items — the SAME rows the roster's Outstanding column and Pipeline's tile use */
  invoices?: Array<{ id: string; title?: string; amount_cents?: number; due_date?: string | null; status?: string; state?: string; processing_since?: string | null; deal_id?: string | null; deal?: string; client_id?: string | null; customer_site_id?: string | null; created_at?: string | null }>;
  /** invoice reminders that went out: period 'invremind:<invoice id>[:slot]' + when */
  reminders?: Array<{ period: string; at: string }>;
  /** presence_form_submissions status=new spam=false, on the clients' sites */
  enquiries?: Array<{ id: string; site_id: string; name?: string | null; email?: string | null; form_kind?: string | null; created_at?: string | null }>;
  /** open / in-progress support requests on the studio's own site */
  support?: Array<{ id: string; subject?: string | null; project_id?: string | null; created_at?: string | null; updated_at?: string | null }>;
  /** the studio's active service links: project → customer */
  serviceLinks?: Array<{ project_id: string | null; customer_client_id: string | null; customer_site_id: string | null }>;
  /** the studio's own deals (open stages) with their next step */
  deals?: Array<{ id: string; title?: string; stage?: string; next_step?: string | null; next_step_at?: string | null; contact_name?: string | null; converted_client_id?: string | null; converted_site_id?: string | null }>;
  /** presence_publishes rows, newest first per site (the helper keeps the latest) */
  publishes?: Array<{ site_id: string; status: string; created_at?: string | null; error_text?: string | null }>;
  /** presence_connections rows — only degraded statuses matter */
  connections?: Array<{ site_id: string; provider_key: string; status: string }>;
  evidence?: Array<{ site_id: string; type: string; severity: string; human: string }>;
  plans?: Array<{ id?: string; site_id: string; title: string; status: string }>;
  lastChange?: Record<string, string>;
  // accepted and deliberately IGNORED — the point of this list
  moments?: unknown[]; opportunities?: unknown[]; reviewReports?: unknown[]; brandReports?: unknown[];
}

export const NEEDS_YOU_CAP = 8;
/** rows beyond the cap still travel (for "+N more") up to this many */
export const NEEDS_YOU_REST = 40;
export const DOMAIN_SOON_DAYS = 30;
export const MONEY_SOON_DAYS = 7;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ymdOf = (s: unknown): string | null => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s ?? '')); return m ? m[0] : null; };
const utcDay = (ymd: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd)!; return Date.UTC(+m[1], +m[2] - 1, +m[3]); };
/** whole days from a → b (y-m-d text, UTC); null when either is not a date */
export function daysBetween(a: unknown, b: unknown): number | null {
  const x = ymdOf(a), y = ymdOf(b);
  if (!x || !y) return null;
  return Math.round((utcDay(y) - utcDay(x)) / 86400000);
}
/** "Nov 3" */
export function shortDate(s: unknown): string {
  const y = ymdOf(s); if (!y) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(y)!;
  return `${MONTHS[+m[2] - 1]} ${+m[3]}`;
}
/** "today" · "yesterday" · "3 days ago" · "Aug 8" (beyond two weeks) */
export function ago(s: unknown, todayYmd: string): string {
  const d = daysBetween(s, todayYmd);
  if (d === null) return '';
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d <= 14) return `${d} days ago`;
  return shortDate(s);
}
export const money = (cents: unknown) => '$' + Math.round((Number(cents) || 0) / 100).toLocaleString('en-US');
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const PROVIDER_LABEL: Record<string, string> = { google_search_console: 'Google Search Console', gsc: 'Google Search Console', ga4: 'Google Analytics', google_analytics: 'Google Analytics', google_business: 'Google Business Profile', gbp: 'Google Business Profile', stripe: 'Stripe', mailchimp: 'Mailchimp' };
const providerLabel = (k: string) => PROVIDER_LABEL[k] || k.replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/** The whole list, in the fixed order above. Every row names a customer and
 *  carries exactly one verb. Archived clients never appear. */
export function buildNeedsYou(i: NeedsInput): NeedsRow[] {
  const today = ymdOf(i.nowIso) || '';
  const active = new Set((i.links || []).filter((l) => l.status === 'active').map((l) => l.site_id));
  const archivedSites = new Set((i.links || []).filter((l) => l.status === 'archived').map((l) => l.site_id));
  const names = i.clientNames || {};
  const byClient = i.namesByClient || {};
  const nameOf = (siteId?: string | null, clientId?: string | null, fallback = 'A customer') =>
    (siteId && names[siteId]) || (clientId && byClient[clientId]) || fallback;
  const sc = (siteId: string | null) => (siteId ? '?client=' + encodeURIComponent(siteId) : '');
  const out: NeedsRow[] = [];
  const seen = new Set<string>();
  const push = (r: NeedsRow) => { if (!seen.has(r.key)) { seen.add(r.key); out.push(r); } };

  // ── a. money: overdue first (most overdue at the top), then due within 7 days ──
  {
    const remindedToday = new Set<string>();
    for (const r of i.reminders || []) {
      const d = daysBetween(r.at, today);
      if (d !== null && d <= 0 && String(r.period || '').startsWith('invremind:')) remindedToday.add(String(r.period).slice('invremind:'.length).split(':')[0]);
    }
    type Inv = NonNullable<NeedsInput['invoices']>[number] & { _days: number | null };
    const open: Inv[] = (i.invoices || [])
      .filter((v) => String(v.status || 'open') === 'open' && !v.processing_since && v.state !== 'processing' && v.state !== 'paid')
      .filter((v) => !(v.customer_site_id && archivedSites.has(v.customer_site_id)))
      .map((v) => ({ ...v, _days: daysBetween(today, v.due_date) }));   // negative = overdue
    const overdue = open.filter((v) => v._days !== null && v._days < 0).sort((a, b) => (a._days as number) - (b._days as number));
    const soon = open.filter((v) => v._days !== null && v._days >= 0 && v._days <= MONEY_SOON_DAYS).sort((a, b) => (a._days as number) - (b._days as number));
    for (const v of [...overdue, ...soon]) {
      const d = v._days as number;
      const what = d < 0 ? `invoice ${money(v.amount_cents)} is overdue by ${plural(-d, 'day')}`
        : d === 0 ? `invoice ${money(v.amount_cents)} is due today`
        : `invoice ${money(v.amount_cents)} is due ${shortDate(v.due_date)}`;
      const reminded = remindedToday.has(String(v.id));
      const when = reminded ? 'Reminder went out today · no payment yet'
        : v.created_at ? `Sent ${shortDate(v.created_at)} · no payment yet` : 'No payment yet';
      const siteId = v.customer_site_id || null;
      const href = v.deal_id
        ? `/crm.html?deal=${encodeURIComponent(String(v.deal_id))}${reminded ? '' : '&tab=billing'}`
        : `/crm.html${siteId ? sc(siteId) + '&tab=billing' : (v.client_id ? '?client_id=' + encodeURIComponent(String(v.client_id)) + '&tab=billing' : '')}`;
      push({ key: `money:${v.id}`, kind: 'money', site_id: siteId, client_id: v.client_id || null,
        name: nameOf(siteId, v.client_id, v.deal || 'A customer'), what, when,
        verb: reminded || !v.deal_id ? 'Open record' : 'Resend', href });
    }
  }

  // ── b. unanswered enquiries on the clients' sites (oldest first) ──
  for (const e of [...(i.enquiries || [])].filter((e) => active.has(e.site_id)).sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))) {
    const who = String(e.name || e.email || '').trim() || 'a visitor';
    const kind = String(e.form_kind || '').trim();
    push({ key: `enquiry:${e.id}`, kind: 'enquiry', site_id: e.site_id, client_id: null, name: nameOf(e.site_id, null),
      what: `new enquiry from ${who}`, when: [ago(e.created_at, today), kind ? `${kind} form` : ''].filter(Boolean).join(' · ').replace(/^\w/, (c) => c.toUpperCase()),
      verb: 'Reply', href: `/inbox.html${sc(e.site_id)}#enquiries?sel=lead:${encodeURIComponent(e.id)}` });
  }

  // ── c. open support requests (oldest first), mapped to the customer by project ──
  {
    const custByProject = new Map<string, { client_id: string | null; site_id: string | null }>();
    for (const l of i.serviceLinks || []) if (l.project_id) custByProject.set(String(l.project_id), { client_id: l.customer_client_id || null, site_id: l.customer_site_id || null });
    const rows = [...(i.support || [])].sort((a, b) => String(a.created_at || a.updated_at || '').localeCompare(String(b.created_at || b.updated_at || '')));
    for (const s of rows) {
      const cust = custByProject.get(String(s.project_id || '')) || { client_id: null, site_id: null };
      if (cust.site_id && archivedSites.has(cust.site_id)) continue;
      const subject = String(s.subject || '').trim();
      push({ key: `support:${s.id}`, kind: 'support', site_id: cust.site_id, client_id: cust.client_id, name: nameOf(cust.site_id, cust.client_id),
        what: subject ? `support request: ${subject}` : 'has an open support request',
        when: `Opened ${ago(s.created_at || s.updated_at, today) || 'recently'}`,
        verb: 'Reply', href: `/inbox.html#support?sel=sup:${encodeURIComponent(s.id)}` });
    }
  }

  // ── d. deals whose next step is past its date (most late first) ──
  {
    const OPEN = new Set(['lead', 'qualified', 'proposal', 'contract']);
    const late = (i.deals || [])
      // open stages only; a step the deal has outgrown (signed → "sign the
      // contract") is already cleared by routes/sales.ts via nextStepStaleAfter
      .filter((d) => OPEN.has(String(d.stage || '')) && String(d.next_step || '').trim())
      .map((d) => ({ d, days: daysBetween(d.next_step_at, today) }))
      .filter((x) => x.days !== null && (x.days as number) > 0)
      .sort((a, b) => (b.days as number) - (a.days as number));
    for (const { d, days } of late) {
      const siteId = d.converted_site_id || null;
      const name = nameOf(siteId, d.converted_client_id, String(d.contact_name || d.title || 'A deal'));
      push({ key: `deal:${d.id}`, kind: 'deal', site_id: siteId, client_id: d.converted_client_id || null, name,
        what: `next step “${String(d.next_step).trim()}” is ${plural(days as number, 'day')} late`,
        when: `On the deal${d.title ? ' ' + d.title : ''} · due ${shortDate(d.next_step_at)}`,
        verb: 'Open deal', href: `/crm.html?deal=${encodeURIComponent(d.id)}` });
    }
  }

  // ── e. broken things, per active site ──
  {
    const sites = (i.sites || []).filter((s) => active.has(s.id));
    const latestPublish = new Map<string, NonNullable<NeedsInput['publishes']>[number]>();
    for (const p of i.publishes || []) {
      const cur = latestPublish.get(p.site_id);
      if (!cur || String(p.created_at || '') > String(cur.created_at || '')) latestPublish.set(p.site_id, p);
    }
    for (const s of sites) {
      const p = latestPublish.get(s.id);
      if (p && p.status === 'failed') {
        const err = String(p.error_text || '').replace(/\s+/g, ' ').trim();
        push({ key: `broken:publish:${s.id}`, kind: 'broken', site_id: s.id, client_id: null, name: nameOf(s.id, null),
          what: 'the last publish failed', when: [ago(p.created_at, today) ? `Failed ${ago(p.created_at, today)}` : 'Failed', err ? err.slice(0, 80) : ''].filter(Boolean).join(' · '),
          verb: 'Fix', href: `/presence.html${sc(s.id)}#publish` });
      }
      const de = daysBetween(today, s.domain_expires_at);
      if (de !== null && de <= DOMAIN_SOON_DAYS) {
        const dom = s.custom_domain || 'the domain';
        push({ key: `broken:domain:${s.id}`, kind: 'broken', site_id: s.id, client_id: null, name: nameOf(s.id, null),
          what: de < 0 ? `${dom} expired ${plural(-de, 'day')} ago` : de === 0 ? `${dom} expires today` : `${dom} expires in ${plural(de, 'day')}`,
          when: s.domain_registrar ? `Registrar: ${s.domain_registrar}` : 'Domain', verb: 'Fix', href: `/presence.html${sc(s.id)}#domain` });
      }
    }
    for (const c of i.connections || []) {
      if (!active.has(c.site_id)) continue;
      const st = String(c.status || '');
      if (!['expired', 'error', 'revoked'].includes(st)) continue;
      push({ key: `broken:conn:${c.site_id}:${c.provider_key}`, kind: 'broken', site_id: c.site_id, client_id: null, name: nameOf(c.site_id, null),
        what: `${providerLabel(c.provider_key)} connection ${st === 'revoked' ? 'was revoked' : st === 'expired' ? 'has expired' : 'has an error'}`,
        when: 'Connections', verb: 'Fix', href: `/connections.html${sc(c.site_id)}` });
    }
    for (const e of i.evidence || []) {
      if (!active.has(e.site_id) || e.severity !== 'critical') continue;
      const t = String(e.type || '');
      const ssl = t === 'trust.ssl_missing';
      if (!ssl && !t.startsWith('infrastructure.')) continue;      // seo.* / search.* / accessibility.* / freshness.* / trust.* stay on the Website page
      if (t === 'infrastructure.domain_expiring') continue;         // the site's own expiry date above covers it (≤30d, not 45)
      push({ key: `broken:ev:${e.site_id}:${t}`, kind: 'broken', site_id: e.site_id, client_id: null, name: nameOf(e.site_id, null),
        what: String(e.human || t).trim().replace(/\.$/, '').replace(/^\w/, (c) => c.toLowerCase()), when: 'Found by the health check',
        verb: 'Fix', href: `/presence.html${sc(e.site_id)}#${ssl ? 'domain' : 'foundations'}` });
    }
  }

  // ── f. approved plans the agency has not applied ──
  for (const p of (i.plans || []).filter((p) => p.status === 'approved' && active.has(p.site_id))) {
    push({ key: `plan:${p.id || p.site_id + ':' + p.title}`, kind: 'plan', site_id: p.site_id, client_id: null, name: nameOf(p.site_id, null),
      what: `approved “${p.title}” — not applied yet`, when: 'Approved plan', verb: 'Apply', href: `/presence.html${sc(p.site_id)}#foundations` });
  }

  // ── g. changes sitting unpublished (never a monitor site) ──
  for (const s of (i.sites || []).filter((s) => active.has(s.id) && s.edition !== 'monitor')) {
    const lc = (i.lastChange || {})[s.id];
    if (!lc || (s.last_published_at && lc <= s.last_published_at)) continue;
    push({ key: `publish:${s.id}`, kind: 'publish', site_id: s.id, client_id: null, name: nameOf(s.id, null),
      what: 'changes are sitting unpublished', when: `Last change ${ago(lc, today) || shortDate(lc)}`, verb: 'Review', href: `/presence.html${sc(s.id)}#publish` });
  }

  return out;
}

/** The first `cap` rows, how many more there are, and the next slice (so the
 *  page can expand "+N more" in place without a second read). */
export function capNeedsYou(rows: NeedsRow[], cap = NEEDS_YOU_CAP, rest = NEEDS_YOU_REST): { rows: NeedsRow[]; more: number; rest: NeedsRow[] } {
  return { rows: rows.slice(0, cap), more: Math.max(0, rows.length - cap), rest: rows.slice(cap, cap + rest) };
}

export interface NextLine { what: string; verb: string; href: string; kind: NeedsKind }
/** The roster's "Next" column: each customer's FIRST row, by site and by client id. */
export function nextBySite(rows: NeedsRow[]): Record<string, NextLine> {
  const out: Record<string, NextLine> = {};
  for (const r of rows) if (r.site_id && !out[r.site_id]) out[r.site_id] = { what: r.what, verb: r.verb, href: r.href, kind: r.kind };
  return out;
}
export function nextByClient(rows: NeedsRow[]): Record<string, NextLine> {
  const out: Record<string, NextLine> = {};
  for (const r of rows) if (r.client_id && !out[r.client_id]) out[r.client_id] = { what: r.what, verb: r.verb, href: r.href, kind: r.kind };
  return out;
}

/** The one honest line under "Nothing needs you." — the next invoice coming
 *  due when there is one, else the plain truth. */
export function emptyLine(i: NeedsInput): string {
  const today = ymdOf(i.nowIso) || '';
  const names = i.clientNames || {}, byClient = i.namesByClient || {};
  const open = (i.invoices || []).filter((v) => String(v.status || 'open') === 'open' && !v.processing_since && v.state !== 'processing' && v.state !== 'paid');
  if (!open.length) return 'Everything is paid and published.';
  const dated = open.filter((v) => ymdOf(v.due_date)).sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
  const v = dated[0] || open[0];
  const name = (v.customer_site_id && names[v.customer_site_id]) || (v.client_id && byClient[v.client_id]) || v.deal || 'A customer';
  const d = daysBetween(today, v.due_date);
  return d === null ? `${name} owes ${money(v.amount_cents)}.` : `${name} owes ${money(v.amount_cents)}, due ${shortDate(v.due_date)}.`;
}

/** What the /agency/needs-you route returns. */
export function needsYouPayload(i: NeedsInput, cap = NEEDS_YOU_CAP) {
  const all = buildNeedsYou(i);
  const { rows, more, rest } = capNeedsYou(all, cap);
  return {
    rows, more, rest, total: all.length,
    empty_line: all.length ? '' : emptyLine(i),
    next_by_site: nextBySite(all),
    next_by_client: nextByClient(all),
  };
}
