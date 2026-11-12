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
export type NeedsKind = 'money' | 'enquiry' | 'support' | 'message' | 'deal' | 'broken' | 'plan' | 'publish' | 'account' | 'notice';

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
  /** item 96: when the wait began, for the "older than a month" count */
  at?: string | null;
  /** Nov 2026 review (bug hunt A2): when the newest thing behind this row happened
   *  (the latest message, the failed publish, the last change, the step's due date,
   *  the request's last message). A snooze made before it no longer holds: the row
   *  key names the conversation, site or deal, so news under the same key wakes it. */
  since?: string | null;
  /** item 96: how "Clear" puts it away: an enquiry is marked read, a support request closed */
  clear?: { kind: 'enquiry' | 'support'; site_id: string | null; ids: string[] };
}

export interface NeedsInput {
  nowIso: string;
  /** the agency's client links — only ACTIVE links feed the list */
  links: Array<{ site_id: string; status: string }>;
  /** site_id → customer name (the portfolio's names) */
  clientNames: Record<string, string>;
  /** client_id → name, for customers the portfolio does not know by site */
  namesByClient?: Record<string, string>;
  sites?: Array<{ id: string; edition?: string; status?: string; last_published_at?: string | null; custom_domain?: string | null; domain_registrar?: string | null; domain_expires_at?: string | null;
    /** item 134: the padlock's end date, and since when the records have been right with no padlock on */
    cert_expires_at?: string | null; cert_pending_since?: string | null;
    /** item 134 (0153): what the domain shows, compared with the site's own address */
    domain_serving?: string | null;
    /** item 162 (0162): the registry's status words */
    domain_statuses?: string[] | null }>;
  /** /sales/receivables items — the SAME rows the roster's Outstanding column and Pipeline's tile use */
  invoices?: Array<{ id: string; title?: string; amount_cents?: number; due_date?: string | null; status?: string; state?: string; processing_since?: string | null; deal_id?: string | null; deal?: string; client_id?: string | null; customer_site_id?: string | null; created_at?: string | null }>;
  /** invoice reminders that went out: period 'invremind:<invoice id>[:slot]' + when */
  reminders?: Array<{ period: string; at: string }>;
  /** presence_form_submissions status=new spam=false, on the clients' sites */
  enquiries?: Array<{ id: string; site_id: string; name?: string | null; email?: string | null; form_kind?: string | null; created_at?: string | null }>;
  /** open / in-progress support requests on the studio's own site */
  // client_id: the write-time stamp (or one healed from the requester's sign-in);
  // requester_name / requester_email: who wrote, when no customer could be named (the contact's name first)
  support?: Array<{ id: string; subject?: string | null; project_id?: string | null; client_id?: string | null; requester_email?: string | null; requester_name?: string | null; created_at?: string | null; updated_at?: string | null; last_activity_at?: string | null }>;
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
  /** Sales review item 11 (Nov 2026): the studio site's OWN Inbox rows
   *  (routes/workspace.ts buildPortalFeed — the very rows the Inbox lists), so
   *  Home, the bell and the Inbox name one set of things. Each becomes one row
   *  here, except the nudges ABOUT a thing already listed (see SKIP below). */
  own?: {
    site_id?: string | null;
    enquiries?: Array<{ id: string; name?: string | null; email?: string | null; form_kind?: string | null; status?: string | null; tier?: string | null; created_at?: string | null }>;
    messages?: Array<{ type?: string | null; tier?: string | null; client_id?: string | null; client?: string | null; project?: string | null; count?: number | null; created_at?: string | null; href?: string | null; thread_key?: string | null }>;
    notices?: Array<{ id?: string | null; kind?: string | null; period?: string | null; headline?: string | null; body?: string | null; href?: string | null; tier?: string | null }>;
    /** the deals those notices name (id → the deal now), so a notice about a deal
     *  since converted, lost or deleted is not a row (dealNoticeIds / staleDealNotices) */
    deals?: Record<string, { stage?: string | null; converted_client_id?: string | null; deleted_at?: string | null }>;
  };
  /** Home's Snooze (bold redesign, sales item 70): row key → when it wakes (ISO).
   *  A row asleep at nowIso leaves the list, the total (the bell) and the
   *  roster's Next, and travels under `snoozed` instead. */
  snoozed?: Record<string, string>;
  /** row key → when it was snoozed (ISO); a row whose `since` is later is awake (A2) */
  snoozedAt?: Record<string, string>;
  /** Builder list item 126: client sites the studio turned off on Home and the bell
   *  (lib/site_notify.ts). Their visitors' enquiries leave the list; what is owed, what
   *  is broken and what a client wrote never do. */
  quiet?: string[];
  // accepted and deliberately IGNORED — the point of this list
  moments?: unknown[]; opportunities?: unknown[]; reviewReports?: unknown[]; brandReports?: unknown[];
}

export const NEEDS_YOU_CAP = 8;
/** rows beyond the cap still travel (for "+N more") up to this many */
export const NEEDS_YOU_REST = 40;
export const DOMAIN_SOON_DAYS = 30;
/** item 134: Home asks when a padlock ends within this, or has been stuck this long (lib/domain_health.ts) */
export const PADLOCK_SOON_DAYS = 14, PADLOCK_STUCK_HOURS = 24;
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
/** "today" · "yesterday" · "3 days ago" · "3 weeks ago" · "2 months ago" · "over a year ago".
 *  Item 96: beyond two weeks it said only the date ("Aug 8"), so an enquiry from
 *  August sat in Needs you looking as fresh as last week's. */
export function ago(s: unknown, todayYmd: string): string {
  const d = daysBetween(s, todayYmd);
  if (d === null) return '';
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d <= 14) return `${d} days ago`;
  if (d < 60) return `${Math.floor(d / 7)} weeks ago`;
  if (d < 365) return `${Math.floor(d / 30)} months ago`;
  return 'over a year ago';
}
/** item 96: a waiting enquiry or support request this many days old can be cleared from Home */
export const OLD_DAYS = 30;
export const money = (cents: unknown) => '$' + Math.round((Number(cents) || 0) / 100).toLocaleString('en-US');
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const PROVIDER_LABEL: Record<string, string> = { google_search_console: 'Google Search Console', gsc: 'Google Search Console', ga4: 'Google Analytics', google_analytics: 'Google Analytics', google_business: 'Google Business Profile', gbp: 'Google Business Profile', stripe: 'Stripe', mailchimp: 'Mailchimp' };
const providerLabel = (k: string) => PROVIDER_LABEL[k] || k.replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/** The whole list, in the fixed order above. Every row names a customer and
 *  carries exactly one verb. Archived clients never appear. */
export function buildNeedsYou(i: NeedsInput): NeedsRow[] {
  const today = ymdOf(i.nowIso) || '';
  const active = new Set((i.links || []).filter((l) => l.status === 'active').map((l) => l.site_id));
  const archivedSites = new Set((i.links || []).filter((l) => l.status === 'archived' || l.status === 'trashed').map((l) => l.site_id));   // item 154: a trashed site asks for nothing
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

  // ── b. unanswered enquiries on the clients' sites (oldest first); none from a site the
  //      studio turned off (item 126) ──
  const quiet = new Set((i.quiet || []).map((x) => String(x).toLowerCase()));
  for (const e of [...(i.enquiries || [])].filter((e) => active.has(e.site_id) && !quiet.has(String(e.site_id).toLowerCase())).sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))) {
    const who = String(e.name || e.email || '').trim() || 'a visitor';
    const kind = String(e.form_kind || '').trim();
    push({ key: `enquiry:${e.id}`, kind: 'enquiry', site_id: e.site_id, client_id: null, name: nameOf(e.site_id, null),
      what: `new enquiry from ${who}`, when: [ago(e.created_at, today), kind ? `${kind} form` : ''].filter(Boolean).join(' · ').replace(/^\w/, (c) => c.toUpperCase()),
      verb: 'Reply', href: `/inbox.html${sc(e.site_id)}#enquiries?sel=lead:${encodeURIComponent(e.id)}`,
      at: e.created_at || null, clear: { kind: 'enquiry', site_id: e.site_id, ids: [String(e.id)] } });
  }

  // ── b2. the studio's OWN new enquiries — one row per person, as the Inbox
  //      groups them (three messages from one sender are one conversation) ──
  {
    type Enq = NonNullable<NonNullable<NeedsInput['own']>['enquiries']>[number];
    const groups = new Map<string, Enq[]>();
    for (const e of (i.own?.enquiries || [])) {
      if (String(e.status || 'new') !== 'new' || (e.tier && e.tier !== 'needs_you')) continue;
      const k = String(e.email || '').trim().toLowerCase() || String(e.name || '').trim().toLowerCase() || String(e.id);
      const g = groups.get(k) || []; g.push(e); groups.set(k, g);
    }
    const ordered = [...groups.values()].map((g) => g.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))))
      .sort((a, b) => String(a[a.length - 1].created_at || '').localeCompare(String(b[b.length - 1].created_at || '')));   // the longest wait first
    for (const g of ordered) {
      const newest = g[0];
      const who = String(newest.name || newest.email || '').trim() || 'Someone';
      const kind = String(newest.form_kind || '').trim();
      const noun = kind === 'quote' ? 'quote request' : kind === 'booking' ? 'booking request' : 'enquiry';
      push({ key: `enquiry:own:${newest.id}`, kind: 'enquiry', site_id: null, client_id: null, name: who,
        what: g.length > 1 ? `${g.length} new ${noun === 'enquiry' ? 'enquiries' : noun + 's'} through your website` : `new ${noun} through your website`,
        when: ago(g[g.length - 1].created_at, today).replace(/^\w/, (c) => c.toUpperCase()),
        verb: 'Reply', href: `/inbox.html#enquiries?sel=lead:${encodeURIComponent(String(newest.id))}`,
        at: g[g.length - 1].created_at || null, clear: { kind: 'enquiry', site_id: null, ids: g.map((x) => String(x.id)) } });
    }
  }

  // ── c. open support requests (oldest first), mapped to the customer by their
  //    stamp first, then by project; one that names nobody shows who wrote ──
  {
    const custByProject = new Map<string, { client_id: string | null; site_id: string | null }>();
    const siteByClient = new Map<string, string>();
    for (const l of i.serviceLinks || []) {
      if (l.project_id) custByProject.set(String(l.project_id), { client_id: l.customer_client_id || null, site_id: l.customer_site_id || null });
      if (l.customer_client_id && l.customer_site_id && !siteByClient.has(String(l.customer_client_id))) siteByClient.set(String(l.customer_client_id), String(l.customer_site_id));
    }
    const rows = [...(i.support || [])].sort((a, b) => String(a.created_at || a.updated_at || '').localeCompare(String(b.created_at || b.updated_at || '')));
    for (const s of rows) {
      const stamped = s.client_id ? { client_id: String(s.client_id), site_id: siteByClient.get(String(s.client_id)) || null } : null;
      const cust = stamped || custByProject.get(String(s.project_id || '')) || { client_id: null, site_id: null };
      if (cust.site_id && archivedSites.has(cust.site_id)) continue;
      const subject = String(s.subject || '').trim();
      push({ key: `support:${s.id}`, kind: 'support', site_id: cust.site_id, client_id: cust.client_id, name: nameOf(cust.site_id, cust.client_id, String(s.requester_name || s.requester_email || '').trim() || 'A customer'),
        what: subject ? `support request: ${subject}` : 'has an open support request',
        when: `Opened ${ago(s.created_at || s.updated_at, today) || 'recently'}`,
        verb: 'Reply', href: `/inbox.html#support?sel=sup:${encodeURIComponent(s.id)}`,
        at: s.last_activity_at ?? null, since: s.last_activity_at ?? null, clear: { kind: 'support', site_id: null, ids: [String(s.id)] } });   // old = no message for a month (routes.ts reads it); unknown = never old
    }
  }

  // ── c2. client conversations waiting for the studio's reply (the Inbox's own rows) ──
  for (const m of (i.own?.messages || [])) {
    if (String(m.type || '') !== 'message' || m.tier !== 'needs_you') continue;
    const n = Number(m.count || 0);
    push({ key: `message:${m.thread_key || m.client_id || m.project || ''}`, kind: 'message', site_id: null, client_id: m.client_id || null,
      name: String(m.client || '').trim() || nameOf(null, m.client_id || null, String(m.project || '').trim() || 'A customer'),
      what: n > 1 ? `${n} messages are waiting for your reply` : 'is waiting for your reply',
      when: ago(m.created_at, today).replace(/^\w/, (c) => c.toUpperCase()),
      verb: 'Reply', href: String(m.href || '/inbox.html'), since: m.created_at || null });
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
        verb: 'Open deal', href: `/crm.html?deal=${encodeURIComponent(d.id)}`, since: d.next_step_at || null });
    }
  }

  // ── d2. a deal that is waiting on the studio's next move: signed (make them a
  //      customer), accepted (send the agreement), or gone quiet ──
  for (const n of ownNotices(i)) {
    const kind = String(n.kind || ''); const p = String(n.period || ''); const head = String(n.headline || '').trim();
    let m: RegExpExecArray | null;
    if (kind === 'deal_signed' && (m = /^(signed|accepted):(.+)$/.exec(p))) {
      const signed = m[1] === 'signed'; const dealId = m[2];
      const title = head.replace(/^Agreement signed — ready to convert\s*/, '').replace(/^Proposal accepted —\s*/, '').trim() || 'A deal';
      push({ key: `deal:${m[1]}:${dealId}`, kind: 'deal', site_id: null, client_id: null, name: title,
        what: signed ? 'signed the agreement — make them a customer' : 'accepted your proposal — send the agreement',
        when: signed ? 'Agreement signed' : 'Proposal accepted', verb: signed ? 'Convert' : 'Open deal',
        href: `/pipeline.html?deal=${encodeURIComponent(dealId)}${signed ? '#convert' : ''}` });   // item 22: Convert lands on the Convert step
    } else if (kind === 'deal_signed' && (m = /^estimate:([0-9a-f-]{36}):([0-9a-f-]{36})$/i.exec(p))) {
      // item 47: the client approved an estimate — turn it into a proposal or an invoice
      push({ key: `deal:estimate:${m[2]}`, kind: 'deal', site_id: null, client_id: null, name: head.replace(/^Estimate approved —\s*/, '').trim() || 'A deal',
        what: 'approved your estimate — turn it into a proposal or an invoice', when: 'Estimate approved', verb: 'Open deal',
        href: `/pipeline.html?deal=${encodeURIComponent(m[1])}&dtab=billing` });
    } else if (kind === 'deal_followup' && (m = /^deal:([^:]+)(?::.*)?$/.exec(p))) {
      if (seen.has(`deal:${m[1]}`)) continue;                     // its late next step is already a row
      push({ key: `deal:quiet:${m[1]}`, kind: 'deal', site_id: null, client_id: null, name: head.replace(/^Follow up on\s*/, '').trim() || 'A deal',
        what: 'has had no next step for a while', when: 'Gone quiet', verb: 'Open deal', href: `/pipeline.html?deal=${encodeURIComponent(m[1])}` });
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
          verb: 'Fix', href: `/presence.html${sc(s.id)}#publish`, since: p.created_at || null });
      }
      // item 162 (review domains finding 6): the registry says the domain itself is in trouble
      const rs = Array.isArray(s.domain_statuses) ? s.domain_statuses : [];
      const regWhat = rs.includes('pending delete') ? 'is about to be deleted at the registry'
        : rs.includes('redemption period') ? 'is in the redemption period: it lapsed'
        : (rs.includes('client hold') || rs.includes('server hold')) ? 'is on hold at the registry, so it isn’t answering' : '';
      if (s.custom_domain && regWhat) {
        push({ key: `broken:registry:${s.id}`, kind: 'broken', site_id: s.id, client_id: null, name: nameOf(s.id, null),
          what: `${s.custom_domain} ${regWhat}`, when: s.domain_registrar ? `At ${s.domain_registrar}` : 'At the registry',
          verb: 'Fix', href: `/domains.html` });
      }
      // item 134 (review findings 3): the domain answers, but not with this site
      if (s.custom_domain && s.edition !== 'monitor' && (s.domain_serving === 'old_copy' || s.domain_serving === 'other')) {
        push({ key: `broken:serving:${s.id}`, kind: 'broken', site_id: s.id, client_id: null, name: nameOf(s.id, null),
          what: s.domain_serving === 'old_copy' ? `${s.custom_domain} is showing an old copy of the site` : `${s.custom_domain} is showing something else, not the site`,
          when: s.domain_serving === 'old_copy' ? 'Another hosting project or a cache is answering' : 'A parking page, an old host or a proxy is answering',
          verb: 'Fix', href: `/presence.html${sc(s.id)}#domain` });
      }
      // item 134 (review findings 4 and 20): the padlock stuck for a day with the records right,
      // or ending within two weeks without renewing (what happens when records drift)
      const stuckH = s.cert_pending_since ? (Date.parse(i.nowIso) - Date.parse(s.cert_pending_since)) / 3600_000 : null;
      const pe = daysBetween(today, s.cert_expires_at);
      if (s.custom_domain && stuckH !== null && Number.isFinite(stuckH) && stuckH >= PADLOCK_STUCK_HOURS) {
        push({ key: `broken:padlock:${s.id}`, kind: 'broken', site_id: s.id, client_id: null, name: nameOf(s.id, null),
          what: `the padlock for ${s.custom_domain} hasn’t come on`, when: `Records right since ${shortDate(s.cert_pending_since)} · asked again each day`,
          verb: 'Fix', href: `/presence.html${sc(s.id)}#domain`, since: s.cert_pending_since || null });
      } else if (s.custom_domain && pe !== null && pe <= PADLOCK_SOON_DAYS) {
        push({ key: `broken:padlock:${s.id}`, kind: 'broken', site_id: s.id, client_id: null, name: nameOf(s.id, null),
          what: pe < 0 ? `the padlock for ${s.custom_domain} has ended` : `the padlock for ${s.custom_domain} ends ${pe === 0 ? 'today' : `in ${plural(pe, 'day')}`}`,
          when: 'It renews by itself while the domain points here; a renewal that hasn’t happened usually means the records changed',
          verb: 'Fix', href: `/presence.html${sc(s.id)}#domain`, since: s.cert_expires_at || null });
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
      what: 'changes are sitting unpublished', when: `Last change ${ago(lc, today) || shortDate(lc)}`, verb: 'Review', href: `/presence.html${sc(s.id)}#publish`, since: lc });
  }

  // ── h. the studio's own account, then anything else that asks for the studio ──
  for (const n of ownNotices(i)) {
    const kind = String(n.kind || ''); const p = String(n.period || '');
    if (kind === 'deal_signed' || (kind === 'deal_followup' && p.startsWith('deal:'))) continue;   // rows in d2
    const head = String(n.headline || '').trim() || 'Something needs a look';
    const body = String(n.body || '').trim();
    const firstSentence = (body.match(/^[^.!?]*[.!?]?/) || [''])[0].trim().replace(/[.!?]$/, '').slice(0, 90);
    const account = ACCOUNT_KINDS.has(kind);
    push({ key: `${account ? 'account' : 'notice'}:${n.id || kind + ':' + p}`, kind: account ? 'account' : 'notice', site_id: null, client_id: null,
      name: account ? 'Your Studio OS account' : head,
      what: account ? head.replace(/^\w/, (c) => c.toLowerCase()) : (firstSentence ? firstSentence.replace(/^\w/, (c) => c.toLowerCase()) : 'needs a look'),
      when: '', verb: 'Open', href: String(n.href || '/inbox.html') });
  }

  return out;
}

// ── which of the studio's own notices are rows of their own ──────────────────
// Website kinds are about the studio's OWN site and stay on the Website page
// (sales review decision 2). The nudge kinds are reminders ABOUT a thing that
// is already a row — the request (support_aging), the enquiry (lead_followup,
// website_enquiry), the invoice (an invremind deal_followup) — and counting
// them as well is how the bell reached 25 for eleven things.
export const NEEDS_WEBSITE_KINDS: ReadonlySet<string> = new Set([
  'site_published', 'traffic_spike',   // builder list item 47: a site's own news stays on its Website page at studio level
  'search_setup', 'domain_expiry', 'publish_failed', 'connection_expired', 'site_down', 'email_auth', 'apex_drift', 'new_review', 'missing_required', 'client_feedback',
]);
export const NEEDS_NUDGE_KINDS: ReadonlySet<string> = new Set(['support_aging', 'lead_followup', 'website_enquiry', 'client_updates']);
const ACCOUNT_KINDS: ReadonlySet<string> = new Set(['capacity', 'trial_ending', 'trial_ended', 'payment_trouble', 'account_lapsed', 'renewal_reminder', 'winddown_reminder', 'deletion_requested']);
// ── deal notices that outlived their deal (found live on Nov 8 2026) ─────────
// Reading 30 notices instead of 10 surfaced two old rows: "make them a
// customer" for a deal converted months ago, and "no next step" for a deal no
// longer in the pipeline. A deal notice is only a row while its deal still
// waits on that step; the caller clears the rest (computeStudioNeeds).
const DEAL_NOTICE_RE = /^(signed|accepted|deal|estimate):([0-9a-f-]{36})(?::.*)?$/i;
/** The deal ids the studio's deal notices name. Pure. */
export function dealNoticeIds(notices: Array<{ kind?: string | null; period?: string | null }>): string[] {
  const out = new Set<string>();
  for (const n of notices || []) {
    const kind = String(n?.kind || ''); const m = DEAL_NOTICE_RE.exec(String(n?.period || ''));
    if (!m) continue;
    if ((kind === 'deal_signed' && m[1] !== 'deal') || (kind === 'deal_followup' && m[1] === 'deal')) out.add(m[2].toLowerCase());
  }
  return [...out];
}
/** Deal notices whose deal no longer waits on that step. Pure. `deals` holds
 *  every deal that could be read; null = the read failed (keep everything). */
export function staleDealNotices<T extends { kind?: string | null; period?: string | null }>(notices: T[], deals: Record<string, { stage?: string | null; converted_client_id?: string | null; deleted_at?: string | null }> | null): T[] {
  if (!deals) return [];
  const out: T[] = [];
  for (const n of notices || []) {
    const kind = String(n?.kind || ''); const m = DEAL_NOTICE_RE.exec(String(n?.period || ''));
    if (!m) continue;
    const isEstimate = kind === 'deal_signed' && m[1] === 'estimate';   // item 47: lives as long as its deal (a customer's extra work counts too)
    const isSigned = kind === 'deal_signed' && (m[1] === 'signed' || m[1] === 'accepted');
    const isQuiet = kind === 'deal_followup' && m[1] === 'deal';
    if (!isSigned && !isQuiet && !isEstimate) continue;
    const d = deals[m[2].toLowerCase()];
    const gone = !d || !!d.deleted_at || d.stage === 'lost';
    if (gone || (isSigned && !!d?.converted_client_id) || (isQuiet && d?.stage === 'won')) out.push(n);
  }
  return out;
}
function ownNotices(i: NeedsInput) {
  const deals = i.own?.deals;
  const stale = new Set(deals ? staleDealNotices(i.own?.notices || [], deals) : []);
  return (i.own?.notices || []).filter((n) => {
    if (stale.has(n)) return false;
    const kind = String(n.kind || ''); const p = String(n.period || '');
    if (n.tier && n.tier !== 'needs_you') return false;                       // news (a payment landed) is not an ask
    if (NEEDS_WEBSITE_KINDS.has(kind) || NEEDS_NUDGE_KINDS.has(kind)) return false;
    if (kind === 'deal_followup' && p.startsWith('invremind:')) return false;  // the money row says it
    if (kind === 'deal_followup' && p.startsWith('remind:')) return false;     // "Reminder sent — Proposal": a report of what the platform did, not an ask
    return true;
  });
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

// ── Snooze (bold redesign, sales item 70) ──────────────────────────────────
// A row keeps its key ('<kind>:<id>') for as long as it needs you, so a snooze
// is just that key and the day it wakes. It is studio-wide: one person snoozes,
// the whole studio's list and bell agree. When the thing itself is dealt with,
// the row goes and the snooze is never seen again. Nov 2026 review (A2): a key
// names a conversation, site or deal, so a NEW message, failure or step under the
// same key would be born asleep; a row whose `since` is later than the snooze
// is awake (`stillAsleep`).
export const SNOOZE_MAX_DAYS = 30;
export const SNOOZE_KEY_RE = /^[a-z_]+:\S{1,300}$/;
/** The keys still asleep at `nowIso`; a wake time that has passed or can't be read wakes the row. */
export function asleepKeys(snoozed: Record<string, string> | undefined, nowIso: string): Set<string> {
  const now = Date.parse(nowIso), out = new Set<string>();
  for (const [k, until] of Object.entries(snoozed || {})) { const t = Date.parse(String(until)); if (Number.isFinite(t) && t > now) out.add(k); }
  return out;
}
/** Pure: is this row still asleep? Asleep by its key, and nothing newer has happened
 *  behind it since the snooze (a row without `since`, or a snooze without a time, keeps
 *  the key's answer). */
export function stillAsleep(row: Pick<NeedsRow, 'key' | 'since'>, asleep: Set<string>, snoozedAt?: Record<string, string>): boolean {
  if (!asleep.has(row.key)) return false;
  const at = snoozedAt?.[row.key], news = row.since;
  if (!at || !news) return true;
  const a = Date.parse(at), n = Date.parse(news);
  return !(Number.isFinite(a) && Number.isFinite(n) && n > a);
}
/** When a snooze of `days` (1–30, whole days) wakes: that many days on, at the same time. Null when out of range. */
export function snoozeUntil(nowIso: string, days: unknown): string | null {
  const n = Number(days), t = Date.parse(nowIso);
  if (!Number.isInteger(n) || n < 1 || n > SNOOZE_MAX_DAYS || !Number.isFinite(t)) return null;
  return new Date(t + n * 86400000).toISOString();
}

/** What the /agency/needs-you route returns. */
export function needsYouPayload(i: NeedsInput, cap = NEEDS_YOU_CAP) {
  const every = buildNeedsYou(i);
  const asleep = asleepKeys(i.snoozed, i.nowIso);
  const sleeping = (r: NeedsRow) => stillAsleep(r, asleep, i.snoozedAt);
  const all = asleep.size ? every.filter((r) => !sleeping(r)) : every;
  // what's asleep, soonest to wake first, each with its wake time
  const snoozed = every.filter(sleeping).map((r) => ({ ...r, until: String(i.snoozed![r.key]) }))
    .sort((a, b) => a.until.localeCompare(b.until));
  const { rows, more, rest } = capNeedsYou(all, cap);
  // item 96: the waiting enquiries and support requests more than a month old, across
  // the whole list (rows and rest carry only the first 48), for Home's "Clear" offer
  const today = ymdOf(i.nowIso) || '';
  const old = all.filter((r) => r.clear && r.at && (daysBetween(r.at, today) ?? 0) > OLD_DAYS);
  return {
    rows, more, rest, total: all.length, snoozed,
    old: { count: old.length, items: old.map((r) => r.clear!) },
    empty_line: all.length ? '' : emptyLine(i),
    next_by_site: nextBySite(all),
    next_by_client: nextByClient(all),
  };
}
