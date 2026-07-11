// ── CMS-UX-6 — Approval Center: pure adapter ─────────────────────────────────
// "What am I waiting to approve?" — the single place a customer reviews and
// approves work before it goes live. NOT project management, NOT an activity
// feed, NOT another notification center.
//
// The customer story: Content Tree (what exists) · Timeline (what happened) ·
// Attention Center (what needs attention) · Website Health (is it healthy) ·
// Upcoming Changes (what's next) · Approval Center (what needs my approval).
//
// A PURE projection over the approval state that ALREADY exists — no new
// approval system, no duplicated workflow. Every card is backed by a real
// pending/decided row (Evidence Rule). Each explains, in plain words:
//   • What is this?   • Why am I seeing it?
//   • What happens if I approve?   • What happens if I wait?
// with one obvious action that links to the existing surface where the approval
// actually happens (reusing existing customer actions — no forked decide logic).
//
// Reuses the relative-date helpers `whenWord` (future) and `humanWhen` (past).
// Client-safe: only presentation fields leave here — never a table name, id,
// internal kind, or raw timestamp beyond the ISO `at`.
import { whenWord } from './attention_center.ts';
import { humanWhen } from '../crm/contract.ts';

export type WaitingKind = 'website' | 'connected' | 'file' | 'delivery' | 'agreement' | 'proposal';

export interface ApprovalCenterInput {
  now: string;
  update_ready: boolean;   // the customer's own draft is ready to publish (nothing blocking)
  waiting: Array<{ kind: WaitingKind; title?: string; summary?: string; href: string }>;
  scheduled: Array<{ at: string; summary?: string; kind?: string }>;
  recently_approved: Array<{ title: string; at: string }>;
}

export interface ApprovalCard {
  title: string;               // what this is, plain English
  why: string;                 // why you're seeing it
  if_approved?: string;        // what happens if you approve
  if_wait?: string;            // what happens if you leave it
  action_label?: string;       // one obvious action
  action_href?: string;
  when?: string;               // relative time (scheduled / recently approved)
  at?: string;                 // ISO
  icon: string;
  status_label?: string;       // a word, so colour is never the only signal
}
export type ApprovalGroupKey = 'ready_now' | 'waiting' | 'scheduled' | 'recently_approved';
export interface ApprovalGroup { key: ApprovalGroupKey; label: string; cards: ApprovalCard[] }
export interface ApprovalCenter {
  status: 'pending' | 'clear';
  headline: string;
  pending_count: number;
  scheduled_count: number;
  groups: ApprovalGroup[];
}

// per-kind plain-language copy (what / why / if-approved / if-wait) — one place,
// reused for every card of that kind so wording never drifts.
const COPY: Record<WaitingKind, { title: string; icon: string; why: string; if_approved: string; if_wait: string; action: string }> = {
  website: {
    title: 'Website update ready', icon: '📤',
    why: 'You’ve made changes to your website that aren’t live yet.',
    if_approved: 'Your changes go live for visitors right away.',
    if_wait: 'Your site keeps showing the current version until you publish.',
    action: 'Review & publish',
  },
  connected: {
    title: 'A connected update is ready', icon: '🔌',
    why: 'A change to one of your connected services is ready for your OK.',
    if_approved: 'The update is made on your connected service.',
    if_wait: 'Nothing changes on the service until you approve it.',
    action: 'Review',
  },
  file: {
    title: 'A file replacement is ready', icon: '🖼️',
    why: 'A new version of one of your images is waiting for your OK.',
    if_approved: 'The new image goes live in place of the old one.',
    if_wait: 'Your current image stays exactly as it is until you approve.',
    action: 'Review',
  },
  delivery: {
    title: 'Review these changes', icon: '✅',
    why: 'Your studio has something ready for your approval.',
    if_approved: 'It’s marked approved and your studio moves ahead.',
    if_wait: 'It stays waiting until you’ve had a chance to look.',
    action: 'Review',
  },
  agreement: {
    title: 'Agreement ready to review', icon: '📄',
    why: 'Your studio has prepared an agreement for your review.',
    if_approved: 'It’s approved and your studio proceeds.',
    if_wait: 'It stays waiting until you review it — no rush.',
    action: 'Review',
  },
  proposal: {
    title: 'Project proposal ready', icon: '📄',
    why: 'Your studio has prepared a proposal for your review.',
    if_approved: 'It’s approved and your project moves forward.',
    if_wait: 'It stays waiting until you review it — no rush.',
    action: 'Review',
  },
};

/** Build the calm Approval Center from existing approval state. Pure. */
export function buildApprovalCenter(i: ApprovalCenterInput): ApprovalCenter {
  const ready: ApprovalCard[] = [];
  const waiting: ApprovalCard[] = [];
  const scheduled: ApprovalCard[] = [];
  const done: ApprovalCard[] = [];

  // Ready now — the customer's own update, ready to publish (a self-approval)
  if (i.update_ready) {
    const c = COPY.website;
    ready.push({
      title: c.title, why: c.why, if_approved: c.if_approved, if_wait: c.if_wait,
      icon: c.icon, status_label: 'Ready', action_label: c.action, action_href: '/presence.html#history',
    });
  }

  // Waiting on you — everything prepared by the platform/studio for your OK
  for (const w of i.waiting || []) {
    const c = COPY[w.kind];
    waiting.push({
      title: w.title || c.title,
      why: w.summary || c.why,
      if_approved: c.if_approved, if_wait: c.if_wait,
      icon: c.icon, status_label: 'Waiting on you',
      action_label: c.action, action_href: w.href,
    });
  }

  // Scheduled — already approved by you, set to go live on a date
  const sched = [...(i.scheduled || [])].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  for (const s of sched) {
    scheduled.push({
      title: s.kind === 'revert' ? 'A scheduled roll-back' : 'Your website update is scheduled',
      why: 'You’ve already approved this — it’s set to go live automatically.',
      if_wait: 'Nothing to do — it publishes on its own. You can change it anytime before then.',
      at: s.at, when: whenWord(s.at, i.now), icon: '🗓️', status_label: 'Scheduled',
      action_label: 'View', action_href: '/presence.html#history',
    });
  }

  // Recently approved — a little reassurance (already decided)
  const recent = [...(i.recently_approved || [])].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, 5);
  for (const r of recent) {
    done.push({
      title: r.title, why: `Approved ${humanWhen(r.at, i.now)}.`,
      at: r.at, when: humanWhen(r.at, i.now), icon: '✓', status_label: 'Approved',
    });
  }

  const groups: ApprovalGroup[] = [];
  if (ready.length) groups.push({ key: 'ready_now', label: 'Ready now', cards: ready });
  if (waiting.length) groups.push({ key: 'waiting', label: 'Waiting on you', cards: waiting });
  if (scheduled.length) groups.push({ key: 'scheduled', label: 'Scheduled', cards: scheduled });
  if (done.length) groups.push({ key: 'recently_approved', label: 'Recently approved', cards: done });

  const pending_count = ready.length + waiting.length;
  const scheduled_count = scheduled.length;
  const status = pending_count > 0 ? 'pending' : 'clear';
  const headline = pending_count > 0
    ? (pending_count === 1 ? 'One thing is waiting for your approval.' : `${pending_count} things are waiting for your approval.`)
    : (scheduled_count > 0 ? 'Nothing to approve — your updates are scheduled.' : 'You’re all caught up — nothing to approve.');

  return { status, headline, pending_count, scheduled_count, groups };
}
