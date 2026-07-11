// ── CMS-UX-2 — Website Timeline: pure adapter ────────────────────────────────
// A calm, chronological story of a customer's website — "what's been happening".
// NOT an activity log, NOT an audit trail. It answers one question, in plain
// English, grouped by when it happened.
//
// This is a PURE projection over EXISTING event sources — no new store, no new
// business logic. It REUSES the calm plain-language mappers the platform already
// has (crm/contract.ts) and the project-event labels (lib/notifications.ts), then
// adds only the customer presentation layer the timeline needs: a friendly
// category, an icon, who did it, a deep link, and natural date grouping.
//
// The user's recommendation, honoured: publishing history + website milestones
// (launch, domain) + project milestones all MERGE into ONE timeline — not three
// separate screens.
//
// Client-safe by construction: the output carries only presentation fields —
// never a table name, database id, internal event key, or field path.
import {
  mapPublish, mapChange, mapConnected, mapMoment, mapLead, humanWhen,
  type TimelineItem,
} from '../crm/contract.ts';
import { notifLabel } from './notifications.ts';

// ── raw inputs (already fetched by the route; the adapter never does I/O) ─────
export interface RawPublish { id: string; kind?: string; status?: string; change_summary?: string; actor_kind?: string; created_at: string; completed_at?: string }
export interface RawChange { id: string; entity_type: string; action: string; summary?: string; actor_kind?: string; created_at: string }
export interface RawConnection { id: string; provider_key: string; action: string; actor_kind?: string; created_at: string; provider_label?: string }
export interface RawMoment { id: string; headline: string; summary?: string; created_at: string; first_seen_at?: string }
export interface RawEnquiry { id: string; form_kind: string; name?: string; email?: string; message?: string; created_at: string }
export interface RawScheduled { id: string; scheduled_for: string; summary?: string; kind?: string; created_at: string }
export interface RawLaunch { id: string; name?: string; status?: string; created_at: string; approved_at?: string; updated_at?: string }
export interface RawDomainAction { id: string; title?: string; applied_at?: string; created_at: string }
export interface RawProjectEvent { id: string; kind: string; actor_kind?: string; detail?: Record<string, unknown>; created_at: string }

export interface WebsiteTimelineInput {
  now: string;
  publishes: RawPublish[];
  changes: RawChange[];
  connections: RawConnection[];
  moments: RawMoment[];
  enquiries: RawEnquiry[];
  scheduled: RawScheduled[];
  launches: RawLaunch[];
  domainActions: RawDomainAction[];
  projectEvents: RawProjectEvent[];
}

// ── client-safe output ───────────────────────────────────────────────────────
export type TimelineCategory = 'Content' | 'Publishing' | 'Website' | 'Communication' | 'Support' | 'Milestones' | 'System';

export interface TimelineEvent {
  title: string;              // plain language, no jargon
  description?: string;       // a short calm line — never raw data
  at: string;                 // ISO timestamp (presentation-safe; not an id)
  when: string;               // human relative time, e.g. "today", "2 days ago"
  icon: string;               // a soft emoji cue
  category: TimelineCategory;
  actor: string;              // "You" | "Your studio" | "Automatic" | "A visitor"
  href?: string;              // an existing customer page, optionally deep-linked
  related_page?: string;      // a friendly page name
}
export interface TimelineGroup { key: 'upcoming' | 'today' | 'yesterday' | 'this_week' | 'earlier'; label: string; events: TimelineEvent[] }
export interface WebsiteTimeline {
  groups: TimelineGroup[];
  total: number;
  last_activity_at: string | null;
  last_activity_when: string | null;
  upcoming_count: number;
}

// ── presentation tables ──────────────────────────────────────────────────────
const ICON: Record<TimelineCategory, string> = {
  Content: '✏️', Publishing: '📤', Website: '🌐', Communication: '✉️', Support: '💬', Milestones: '🎉', System: '✨',
};
// actor_kind vocabularies differ across sources (client/staff/system and
// customer/operator/system) — normalise both to one calm word.
function actorOf(kind?: string): string {
  switch (kind) {
    case 'client': case 'customer': return 'You';
    case 'staff': case 'operator': return 'Your studio';
    case 'system': return 'Automatic';
    default: return '';
  }
}
// content section → the editor's existing hash-tab (same contract as the room)
const SECTION_TAB: Record<string, string> = {
  identity: 'business', location: 'business', settings: 'design', voice: 'business',
  offering: 'offerings', testimonial: 'testimonials', faq: 'faqs', post: 'updates',
  media: 'media', redirect: 'business',
};

interface Internal { at: string; category: TimelineCategory; actor: string; title: string; description?: string; href?: string; related_page?: string }

const trim = (s?: string, n = 140): string | undefined => {
  if (!s) return undefined;
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : (t || undefined);
};

// ── day bucketing (deterministic; uses the passed-in `now`, never a live clock) ─
function dayOrdinal(iso: string): number {
  const t = Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z');
  return Number.isFinite(t) ? Math.floor(t / 86400000) : NaN;
}
function bucketOf(at: string, now: string): TimelineGroup['key'] {
  const ta = Date.parse(at), tn = Date.parse(now);
  if (Number.isFinite(ta) && Number.isFinite(tn) && ta > tn) return 'upcoming';
  const d = dayOrdinal(now) - dayOrdinal(at);
  if (!Number.isFinite(d)) return 'earlier';
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 7) return 'this_week';
  return 'earlier';
}
const GROUP_LABEL: Record<TimelineGroup['key'], string> = {
  upcoming: 'Coming up', today: 'Today', yesterday: 'Yesterday', this_week: 'This week', earlier: 'Earlier',
};
const GROUP_ORDER: TimelineGroup['key'][] = ['upcoming', 'today', 'yesterday', 'this_week', 'earlier'];

/** Build the calm, grouped Website Timeline from existing events. Pure. */
export function buildWebsiteTimeline(input: WebsiteTimelineInput): WebsiteTimeline {
  const now = input.now;
  const events: Internal[] = [];
  const item = (m: TimelineItem) => ({ title: m.title, description: trim(m.detail), at: m.at });

  // Published / restored — REUSE mapPublish
  for (const r of input.publishes || []) {
    const m = item(mapPublish(r));
    events.push({ ...m, category: 'Publishing', actor: actorOf(r.actor_kind) || 'You', href: '/presence.html#history', related_page: 'Your website' });
  }

  // Content edits — REUSE mapChange; drop publish/restore (covered above) and internal notes
  for (const r of input.changes || []) {
    if (r.entity_type === 'publish' || r.entity_type === 'restore' || r.entity_type === 'internal_note') continue;
    const m = item(mapChange(r));
    const isSite = r.entity_type === 'domain' || r.entity_type === 'site';
    const tab = SECTION_TAB[r.entity_type];
    events.push({
      ...m,
      category: isSite ? 'Website' : 'Content',
      actor: actorOf(r.actor_kind) || 'You',
      href: isSite ? '/presence.html#foundations' : (tab ? `/presence.html#${tab}` : '/presence.html'),
      related_page: 'Your website',
    });
  }

  // Connected services — REUSE mapConnected
  for (const r of input.connections || []) {
    const m = item(mapConnected(r, r.provider_label));
    events.push({ ...m, category: 'Website', actor: actorOf(r.actor_kind) || 'You', href: '/connections.html', related_page: 'Connections' });
  }

  // Insights (Business Moments) — REUSE mapMoment
  for (const r of input.moments || []) {
    const m = item(mapMoment(r));
    events.push({ ...m, category: 'System', actor: 'Automatic', href: '/today.html', related_page: 'Today' });
  }

  // Enquiries from the site — REUSE mapLead
  for (const r of input.enquiries || []) {
    const m = item(mapLead(r));
    events.push({ ...m, category: 'Communication', actor: 'A visitor', href: '/leads.html', related_page: 'Your messages' });
  }

  // Scheduled publishes — future-dated → "Coming up"
  for (const r of input.scheduled || []) {
    const soon = humanWhen(r.scheduled_for, now);
    events.push({
      at: r.scheduled_for,
      category: 'Publishing', actor: 'You',
      title: r.kind === 'revert' ? 'A change is scheduled to roll back' : 'A publish is scheduled',
      description: trim(r.summary) || `Your changes are set to go live ${soon}.`,
      href: '/presence.html#history', related_page: 'Your website',
    });
  }

  // Named website releases (launches) — the go-live milestones
  for (const r of input.launches || []) {
    const st = r.status;
    if (st !== 'published' && st !== 'rolled_back' && st !== 'scheduled') continue;
    const at = (st === 'published' && r.approved_at) ? r.approved_at : (r.updated_at || r.created_at);
    const name = r.name ? `“${r.name}”` : 'A release';
    events.push({
      at,
      category: st === 'published' ? 'Milestones' : 'Publishing',
      actor: 'You',
      title: st === 'published' ? `${name} went live` : st === 'rolled_back' ? `${name} was rolled back` : `${name} is scheduled`,
      href: '/presence.html#history', related_page: 'Your website',
    });
  }

  // Domain connected — a website milestone (REUSE infra_plans applied)
  for (const r of input.domainActions || []) {
    events.push({
      at: r.applied_at || r.created_at,
      category: 'Milestones', actor: 'You',
      title: 'Your domain was connected',
      description: trim(r.title),
      href: '/presence.html#foundations', related_page: 'Your website',
    });
  }

  // Project delivery events (bridged) — REUSE notifLabel; customer pages only
  for (const r of input.projectEvents || []) {
    const cat = projectCategory(r.kind);
    if (!cat) continue; // internal-only kinds (e.g. bare task churn) are skipped
    events.push({
      at: r.created_at,
      category: cat, actor: actorOf(r.actor_kind) || 'Your studio',
      title: notifLabel(r.kind),
      description: trim(typeof r.detail?.title === 'string' ? r.detail.title as string : undefined),
      href: '/client.html', related_page: 'Your project',
    });
  }

  // sort newest-first, cap, then bucket by day
  events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const capped = events.slice(0, 80);

  const byKey = new Map<TimelineGroup['key'], TimelineEvent[]>();
  for (const e of capped) {
    const key = bucketOf(e.at, now);
    const list = byKey.get(key) || [];
    list.push({
      title: e.title,
      description: e.description,
      at: e.at,
      when: humanWhen(e.at, now),
      icon: ICON[e.category],
      category: e.category,
      actor: e.actor,
      href: e.href,
      related_page: e.related_page,
    });
    byKey.set(key, list);
  }

  const groups: TimelineGroup[] = GROUP_ORDER
    .filter((k) => (byKey.get(k) || []).length > 0)
    .map((k) => ({ key: k, label: GROUP_LABEL[k], events: byKey.get(k)! }));

  const past = capped.filter((e) => bucketOf(e.at, now) !== 'upcoming');
  const lastAt = past[0]?.at || null; // capped is already newest-first
  const upcoming = capped.filter((e) => bucketOf(e.at, now) === 'upcoming').length;

  return {
    groups,
    total: capped.length,
    last_activity_at: lastAt,
    last_activity_when: lastAt ? humanWhen(lastAt, now) : null,
    upcoming_count: upcoming,
  };
}

// which customer category a project-event kind belongs to (null = keep internal)
function projectCategory(kind: string): TimelineCategory | null {
  switch (kind) {
    case 'project_created':
    case 'milestone_created':
    case 'milestone_completed':
      return 'Milestones';
    case 'message':
    case 'client_action':
    case 'deliverable_added':
    case 'approval_requested':
    case 'approval_decided':
    case 'survey_requested':
    case 'survey_submitted':
      return 'Communication';
    case 'support_opened':
    case 'support_message':
    case 'support_resolved':
      return 'Support';
    // status_change, task_created, task_status_change, note → internal churn; omit
    default:
      return null;
  }
}
