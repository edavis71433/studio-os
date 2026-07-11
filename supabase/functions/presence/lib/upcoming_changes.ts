// ── CMS-UX-5 — Upcoming Changes: pure adapter ────────────────────────────────
// "What's happening next with my website?" — a calm, future-looking schedule.
// NOT project management, NOT a task list, NOT a release log.
//
// The customer story, in order:
//   Content Tree → what exists · Timeline → what happened ·
//   Attention Center → what needs attention · Website Health → is it healthy ·
//   Upcoming Changes → what's coming next.
//
// A PURE projection over EXISTING dated truth — no scheduling engine, no new
// store. Every item is backed by a REAL stored date or a REAL pending state;
// nothing is estimated or invented (same Evidence standard as Timeline / Health
// / Attention). Reuses the future relative-date helper (`whenWord`) from the
// Attention Center — presentation logic is not forked.
//
// Client-safe by construction: only presentation fields leave here — never a
// table name, id, internal kind, or raw timestamp beyond the ISO `at`.
import { whenWord } from './attention_center.ts';

export interface UpcomingInput {
  now: string;
  scheduled: Array<{ at: string; summary?: string; kind?: string }>;   // scheduled_for (pending)
  domain_expires_at: string | null;
  trial_ends_at: string | null;
  project_due: Array<{ title: string; at: string; kind: 'milestone' | 'project' }>;  // due_date / target_date
  approvals_waiting: number;   // own-site + bridged, combined
  almost_ready: boolean;       // unpublished changes, nothing blocking
}

export type UpcomingBucket = 'today' | 'this_week' | 'coming_soon' | 'later' | 'waiting';
export interface UpcomingItem {
  title: string;
  why: string;
  at?: string;                 // ISO (dated items only)
  when?: string;               // human relative, e.g. "on Friday", "in 3 weeks"
  icon: string;
  action_label?: string;
  action_href?: string;
}
export interface UpcomingGroup { key: UpcomingBucket; label: string; items: UpcomingItem[] }
export interface UpcomingChanges {
  groups: UpcomingGroup[];
  total: number;
  next_at: string | null;      // the soonest dated item
  next_when: string | null;
  waiting_count: number;
}

const GROUP_LABEL: Record<UpcomingBucket, string> = {
  today: 'Today', this_week: 'This week', coming_soon: 'Coming soon', later: 'Later', waiting: 'Waiting on you',
};
const GROUP_ORDER: UpcomingBucket[] = ['today', 'this_week', 'coming_soon', 'later', 'waiting'];

// only surface renewals that are genuinely near (a real date, shown when relevant)
const DOMAIN_WINDOW_DAYS = 90;
const TRIAL_WINDOW_DAYS = 60;

function dayOrdinal(iso: string): number {
  const t = Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z');
  return Number.isFinite(t) ? Math.floor(t / 86400000) : NaN;
}
// bucket a FUTURE date by calendar day (handles both timestamptz and date-only
// values honestly — a milestone "due today" counts as today, not the past).
function bucketOf(at: string, now: string): Exclude<UpcomingBucket, 'waiting'> | null {
  const d = dayOrdinal(at) - dayOrdinal(now);
  if (!Number.isFinite(d) || d < 0) return null;
  if (d === 0) return 'today';
  if (d <= 7) return 'this_week';
  if (d <= 30) return 'coming_soon';
  return 'later';
}
function daysUntil(at: string, now: string): number {
  return (Date.parse(at) - Date.parse(now)) / 86400000;
}

interface Dated { at: string; title: string; why: string; icon: string; action?: { label: string; href: string } }

/** Build the calm, future-looking schedule from existing dated truth. Pure. */
export function buildUpcomingChanges(i: UpcomingInput): UpcomingChanges {
  const now = i.now;
  const dated: Dated[] = [];

  // Scheduled publishes — the clearest "what's next"
  for (const s of i.scheduled || []) {
    if (!bucketOf(s.at, now)) continue;
    dated.push({
      at: s.at, icon: '🗓️',
      title: s.kind === 'revert' ? 'A change is scheduled to roll back' : 'Your next update is scheduled',
      why: s.summary ? s.summary : 'Your changes will go live automatically — nothing to do.',
      action: { label: 'View', href: '/presence.html#history' },
    });
  }

  // Domain renewal — a real expiry date, shown only when it's genuinely near
  if (i.domain_expires_at && bucketOf(i.domain_expires_at, now) && daysUntil(i.domain_expires_at, now) <= DOMAIN_WINDOW_DAYS) {
    dated.push({
      at: i.domain_expires_at, icon: '🌐',
      title: 'Your domain renewal is approaching',
      why: 'Renewing on time keeps your web address yours — we’ll guide you through it.',
      action: { label: 'See details', href: '/presence.html#foundations' },
    });
  }

  // Trial ending — a real trial_ends_at date
  if (i.trial_ends_at && bucketOf(i.trial_ends_at, now) && daysUntil(i.trial_ends_at, now) <= TRIAL_WINDOW_DAYS) {
    dated.push({
      at: i.trial_ends_at, icon: '⏳',
      title: 'Your free trial ends soon',
      why: 'Choosing a plan keeps everything running without interruption.',
      action: { label: 'See your plan', href: '/portal.html' },
    });
  }

  // Project milestones / expected wrap-up — real due dates from your project
  for (const p of i.project_due || []) {
    if (!bucketOf(p.at, now)) continue;
    dated.push({
      at: p.at, icon: '🎯',
      title: p.kind === 'project' ? 'Your project is expected to wrap up' : `“${p.title}” is due`,
      why: p.kind === 'project' ? 'The target date your studio set for finishing up.' : 'A step in your project is coming up.',
      action: { label: 'Open your project', href: '/client.html' },
    });
  }

  // ── group the dated items by when ──────────────────────────────────────────
  dated.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)); // soonest first
  const byKey = new Map<UpcomingBucket, UpcomingItem[]>();
  for (const d of dated) {
    const key = bucketOf(d.at, now)!;
    const list = byKey.get(key) || [];
    list.push({
      title: d.title, why: d.why, at: d.at, when: whenWord(d.at, now), icon: d.icon,
      ...(d.action ? { action_label: d.action.label, action_href: d.action.href } : {}),
    });
    byKey.set(key, list);
  }

  // ── undated "waiting on you" items (genuinely pending, no stored date) ──────
  const waiting: UpcomingItem[] = [];
  if (i.approvals_waiting > 0) {
    waiting.push({
      title: i.approvals_waiting === 1 ? 'A change is waiting for your approval' : `${i.approvals_waiting} changes are waiting for your approval`,
      why: 'Nothing goes ahead until you say yes — a quick look is all it takes.',
      icon: '✅', action_label: 'Review', action_href: '/today.html',
    });
  }
  if (i.almost_ready) {
    waiting.push({
      title: 'A website update is almost ready',
      why: 'You’ve made changes that aren’t live yet — publish them whenever you’re happy.',
      icon: '📤', action_label: 'Review & publish', action_href: '/presence.html#history',
    });
  }
  if (waiting.length) byKey.set('waiting', waiting);

  const groups: UpcomingGroup[] = GROUP_ORDER
    .filter((k) => (byKey.get(k) || []).length > 0)
    .map((k) => ({ key: k, label: GROUP_LABEL[k], items: byKey.get(k)! }));

  const next = dated[0]?.at || null;   // soonest-first after sort
  const total = dated.length + waiting.length;
  return {
    groups,
    total,
    next_at: next,
    next_when: next ? whenWord(next, now) : null,
    waiting_count: waiting.length,
  };
}
