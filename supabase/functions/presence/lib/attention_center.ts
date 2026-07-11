// ── CMS-UX-3 — Website Attention Center: pure adapter ────────────────────────
// One calm question: "What needs my attention today?"  NOT a dashboard, NOT an
// admin panel, NOT an audit report. Every card answers, in plain words:
//   • What happened?   (title)
//   • Why does it matter?   (why)
//   • What should I do?   (one clear action)
//
// A PURE projection over EXISTING signals — no new store, no new notification
// system, no duplicated validation. The website-content signals are REUSED from
// the CMS-UX-1 Content Tree (which already turns snapshot/publish validation +
// change detection into customer-safe per-section status); everything else is
// pre-fetched by the route from the tables the platform already maintains
// (notices, scheduled publishes, approvals, connections, support, forms).
//
// Calm prioritisation — no severity colours, no jargon:
//   Needs attention · Coming soon · Completed · Everything looks good
//
// Client-safe by construction: only presentation fields leave here — never a
// table name, id, internal notice kind, or field path.

export type AttentionTone = 'needs_attention' | 'coming_soon' | 'completed';

export interface AttentionCard {
  title: string;             // what happened
  why: string;               // why it matters
  action_label?: string;     // the ONE clear action
  action_href?: string;
  tone: AttentionTone;
  icon: string;
}
export interface AttentionGroup { key: AttentionTone; label: string; cards: AttentionCard[] }
export interface AttentionCenter {
  status: 'needs_attention' | 'all_clear';
  headline: string;
  needs_count: number;
  groups: AttentionGroup[];
}

// ── inputs (all pre-derived by the route; the adapter does no I/O) ───────────
export interface AttentionNotice { kind: string; headline: string; body?: string; href: string }
export interface AttentionInput {
  now: string;
  // reused from the Content Tree
  site_status: 'never_published' | 'live' | 'draft_changes' | 'scheduled' | 'publish_failed';
  has_unpublished_changes: boolean;
  publish_failed: boolean;
  last_published_at: string | null;
  missing: Array<{ section: string; page: string; href: string }>;   // sections that block publishing
  // pre-fetched signals
  notices: AttentionNotice[];
  scheduled: Array<{ at: string; summary?: string; kind?: string }>;
  new_enquiries: number;
  connections_attention: Array<{ label: string }>;
  approvals_waiting: number;          // own-site: infra + connected-write + file approvals
  project_approvals_waiting: number;  // bridged: pending delivery approvals
  project_actions: Array<{ title: string }>;  // client-visible actions the studio needs from the customer
}

// notice kinds that call for action now vs. that are simply approaching
const NOTICE_NEEDS = new Set(['payment_trouble', 'account_lapsed', 'lead_followup', 'search_setup', 'deletion_requested', 'publish_failed', 'connection_expired', 'website_enquiry', 'deal_signed', 'deal_followup']);
const NOTICE_SOON = new Set(['domain_expiry', 'trial_ending', 'trial_ended', 'renewal_reminder', 'winddown_reminder', 'win_back']);

export function whenWord(iso: string, now: string): string {
  const then = Date.parse(iso), n = Date.parse(now);
  if (!isFinite(then) || !isFinite(n)) return 'soon';
  const days = Math.round((then - n) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 7) { const d = new Date(iso); return `on ${d.toLocaleDateString('en-US', { weekday: 'long' })}`; }
  if (days < 14) return 'next week';
  return `in ${Math.round(days / 7)} weeks`;
}
function agoWord(iso: string, now: string): string {
  const then = Date.parse(iso), n = Date.parse(now);
  if (!isFinite(then) || !isFinite(n)) return 'recently';
  const days = Math.floor((n - then) / 86400000);
  if (days <= 0) return 'today'; if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`; return 'recently';
}

/** Build the calm Attention Center from existing signals. Pure. */
export function buildAttentionCenter(input: AttentionInput): AttentionCenter {
  const needs: AttentionCard[] = [];
  const soon: AttentionCard[] = [];
  const done: AttentionCard[] = [];

  // ── Needs attention ────────────────────────────────────────────────────────
  // 1) a publish that didn't finish — the most important thing to resolve
  if (input.publish_failed) {
    needs.push({ tone: 'needs_attention', icon: '📤', title: 'A recent publish didn’t finish', why: 'Your latest changes may not be visible to visitors yet.', action_label: 'Try publishing again', action_href: '/presence.html#history' });
  }

  // 2) content that's required before the site can publish
  const miss = input.missing.slice(0, 3);
  for (const m of miss) {
    needs.push({ tone: 'needs_attention', icon: '✏️', title: `${m.section} needs a little more`, why: `${m.page} can’t go live until this is filled in.`, action_label: 'Add it', action_href: m.href });
  }
  if (input.missing.length > miss.length) {
    needs.push({ tone: 'needs_attention', icon: '✏️', title: `${input.missing.length - miss.length} more items need filling in`, why: 'A few sections still need something before you can publish.', action_label: 'See what’s left', action_href: '/content-tree.html' });
  }

  // 3) changes waiting for the customer's approval (own site + bridged delivery)
  const appr = input.approvals_waiting + input.project_approvals_waiting;
  if (appr > 0) {
    needs.push({ tone: 'needs_attention', icon: '✅', title: appr === 1 ? 'A change is waiting for your approval' : `${appr} changes are waiting for your approval`, why: 'Nothing goes ahead until you say yes — take a quick look when you can.', action_label: 'Review', action_href: '/today.html' });
  }

  // 4) something the studio needs from you (client-visible actions)
  for (const a of input.project_actions.slice(0, 2)) {
    needs.push({ tone: 'needs_attention', icon: '💬', title: a.title || 'Your studio needs something from you', why: 'A quick reply keeps your project moving.', action_label: 'Open your project', action_href: '/client.html' });
  }

  // 5) connections that need a quick reconnect
  for (const c of input.connections_attention.slice(0, 2)) {
    needs.push({ tone: 'needs_attention', icon: '🔌', title: `${c.label} needs a quick reconnect`, why: 'It stopped updating — reconnecting keeps your numbers current.', action_label: 'Reconnect', action_href: '/connections.html' });
  }

  // 6) new enquiries from the website
  if (input.new_enquiries > 0) {
    needs.push({ tone: 'needs_attention', icon: '✉️', title: input.new_enquiries === 1 ? 'A new enquiry came in' : `${input.new_enquiries} new enquiries came in`, why: 'Someone reached out through your website and is waiting to hear back.', action_label: 'Read it', action_href: '/leads.html' });
  }

  // 7) unpublished changes that are otherwise ready to go
  if (input.has_unpublished_changes && !input.publish_failed && input.missing.length === 0) {
    needs.push({ tone: 'needs_attention', icon: '📤', title: 'Your changes are ready to publish', why: 'You’ve made edits that aren’t live yet — publish when you’re happy with them.', action_label: 'Review & publish', action_href: '/presence.html#history' });
  }

  // 8) action-worthy notices (renewals/trials go to "Coming soon" below)
  for (const n of input.notices) {
    if (!NOTICE_NEEDS.has(n.kind)) continue;
    needs.push({ tone: 'needs_attention', icon: '🔔', title: n.headline, why: n.body || 'This one’s worth a look when you have a moment.', action_label: 'Take a look', action_href: n.href });
  }

  // ── Coming soon ─────────────────────────────────────────────────────────────
  for (const s of input.scheduled) {
    soon.push({ tone: 'coming_soon', icon: '🗓️', title: `A publish is scheduled ${whenWord(s.at, input.now)}`, why: s.summary ? s.summary : 'Your changes will go live automatically — nothing to do.', action_label: 'View', action_href: '/presence.html#history' });
  }
  for (const n of input.notices) {
    if (!NOTICE_SOON.has(n.kind)) continue;
    soon.push({ tone: 'coming_soon', icon: '⏳', title: n.headline, why: n.body || 'Coming up — no action needed yet.', action_label: 'See details', action_href: n.href });
  }

  // ── Completed (a little reassurance) ────────────────────────────────────────
  if (input.last_published_at && !input.has_unpublished_changes && !input.publish_failed) {
    done.push({ tone: 'completed', icon: '✓', title: 'Your website is up to date', why: `Everything you’ve edited is live — last published ${agoWord(input.last_published_at, input.now)}.`, action_label: 'View your website', action_href: '/presence.html' });
  }

  // ── assemble ────────────────────────────────────────────────────────────────
  const groups: AttentionGroup[] = [];
  if (needs.length) groups.push({ key: 'needs_attention', label: 'Needs attention', cards: needs });
  if (soon.length) groups.push({ key: 'coming_soon', label: 'Coming soon', cards: soon });
  if (done.length) groups.push({ key: 'completed', label: 'Completed', cards: done });

  const status = needs.length ? 'needs_attention' : 'all_clear';
  const headline = needs.length
    ? (needs.length === 1 ? 'One thing needs your attention.' : `${needs.length} things need your attention.`)
    : 'Everything looks good.';

  return { status, headline, needs_count: needs.length, groups };
}
