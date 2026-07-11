// ── CMS-UX-8 — Snapshot History: pure adapter ────────────────────────────────
// "What versions of my website exist?" — a customer-friendly history of website
// versions you can revisit or restore. NOT Git, NOT version control, NOT
// deployment history. It should feel like flipping through previous editions of
// your website, not browsing technical deployments.
//
// The customer story: … Business Insights ("what should I know") · Snapshot
// History ("which versions can I revisit or restore").
//
// A PURE projection over the EXISTING publish/version history — no new snapshot
// system. It consumes the rows the platform already builds (publishHistoryRows:
// the SAME customer-facing summary fallback + restorable flag GET /publishes
// uses) and re-frames them as saved versions. Reuses `humanWhen` for dates.
//
// Honesty Rule: names/summaries are only ever the customer's own version label
// or the existing customer-facing summary — never invented. If neither exists,
// the version is shown by its date. Preview/restore reuse the existing editor
// version-history surface; no forked restore/preview logic.
//
// Client-safe: only presentation fields leave here — never a table name, id,
// snapshot id, or internal status beyond the friendly words.
import { humanWhen } from '../crm/contract.ts';

export interface VersionRow {
  kind: 'publish' | 'restore' | string;
  status: string;                 // 'live' | 'failed' | 'publishing'
  summary: string;                // existing customer-facing summary (already has a fallback)
  label: string;                  // the customer's own version name, or ''
  at: string;
  completed_at: string | null;
  restorable: boolean;
}
export interface SnapshotHistoryInput { now: string; versions: VersionRow[] }

export type VersionCategory = 'current' | 'previous' | 'restored';
export interface VersionCard {
  name: string;                   // the version's name (label, else summary, else date)
  what_changed?: string;          // the change summary, when it adds something beyond the name
  when: string;                   // relative, e.g. "3 days ago"
  published_on: string;           // a friendly absolute date
  at: string;                     // ISO
  why: string;                    // why this version exists
  is_current: boolean;
  can_preview: boolean;
  can_restore: boolean;
  preview_href?: string;
  restore_href?: string;
  icon: string;
}
export interface VersionGroup { key: VersionCategory; label: string; versions: VersionCard[] }
export interface SnapshotHistory {
  headline: string;
  total: number;
  groups: VersionGroup[];
}

// preview + restore both happen on the existing editor version-history surface —
// we link there rather than fork the restore/preview flow.
const HISTORY = '/presence.html#history';

function friendlyDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** Re-frame existing publish history as saved website versions. Pure. */
export function buildSnapshotHistory(input: SnapshotHistoryInput): SnapshotHistory {
  // only versions that actually EXIST as something to revisit — the live ones
  const live = (input.versions || [])
    .filter((v) => v.status === 'live')
    .sort((a, b) => {
      const ta = a.completed_at || a.at, tb = b.completed_at || b.at;
      return ta < tb ? 1 : ta > tb ? -1 : 0;   // newest first
    });

  const current: VersionCard[] = [];
  const previous: VersionCard[] = [];
  const restored: VersionCard[] = [];

  live.forEach((v, idx) => {
    const isCurrent = idx === 0;
    const published = v.completed_at || v.at;
    const hasLabel = !!v.label;
    const name = v.label || v.summary || `Version from ${friendlyDate(published)}`;
    const why = v.kind === 'restore'
      ? 'You restored an earlier version of your website.'
      : isCurrent ? 'This is your live website right now.' : 'A published update to your website.';
    const card: VersionCard = {
      name,
      // show the change summary as "what changed" only when it isn't already the name
      what_changed: hasLabel && v.summary && v.summary !== v.label ? v.summary : undefined,
      when: humanWhen(published, input.now),
      published_on: friendlyDate(published),
      at: published,
      why,
      is_current: isCurrent,
      can_preview: true,
      can_restore: !isCurrent && v.restorable,
      preview_href: HISTORY,
      ...(!isCurrent && v.restorable ? { restore_href: HISTORY } : {}),
      icon: isCurrent ? '🌐' : v.kind === 'restore' ? '↩️' : '📄',
    };
    if (isCurrent) current.push(card);
    else if (v.kind === 'restore') restored.push(card);
    else previous.push(card);
  });

  const groups: VersionGroup[] = [];
  if (current.length) groups.push({ key: 'current', label: 'Current website', versions: current });
  if (previous.length) groups.push({ key: 'previous', label: 'Previous versions', versions: previous });
  if (restored.length) groups.push({ key: 'restored', label: 'Restored versions', versions: restored });

  const total = current.length + previous.length + restored.length;
  const headline = total === 0
    ? 'No saved versions yet.'
    : total === 1
      ? 'Your website has one saved version so far.'
      : `Your website has ${total} saved versions.`;

  return { headline, total, groups };
}
