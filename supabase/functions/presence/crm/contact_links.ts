// ── What a contact is attached to, and what deleting them would leave ────────
// Eric asked to delete contacts. Most are safe. Some are not: a converted
// customer carries a signed agreement, a paid invoice, a won deal and a live
// project — and `presence_contacts` is referenced by THREE foreign keys
// (presence_deals.contact_id, presence_appointments.contact_id,
// presence_reviews.contact_id), every one of them `on delete set null`.
//
// So the confirm must NAME what is attached before anything happens — "Claud has
// 1 deal, 1 signed agreement, 1 paid invoice and 1 project" beats "Are you
// sure?" — and the delete itself must be a SOFT delete (`deleted_at`, the
// established pattern since 0074) that touches exactly one row. Nothing
// cascades. Nothing is destroyed.
//
// PURE: no network, no clock, no randomness. The route does the counting; this
// module turns counts into the sentence and decides whether a warning is owed.
// Tested in isolation (tests/presence/contacts_detail_test.mjs).

import { findPossibleDuplicates, type DupCandidate, type DupMatch } from './dedupe.ts';

/** Raw counts the DELETE pre-flight gathers. Every field optional so a failed
 *  sub-count degrades to "not counted" rather than a fabricated zero. */
export interface AttachmentCounts {
  deals?: number;
  won_deals?: number;
  projects?: number;
  signed_contracts?: number;
  paid_invoices?: number;
  open_invoices?: number;
  appointments?: number;
  reviews?: number;
}

export interface AttachmentSummary {
  counts: Required<AttachmentCounts>;
  /** Total attached records — 0 means a plain confirm is enough. */
  total: number;
  /** Is this contact a converted customer (a deal of theirs became one)? */
  converted: boolean;
  /** ["1 deal", "1 signed agreement", …] — only the non-zero ones. */
  items: string[];
  /** "1 deal, 1 signed agreement, 1 paid invoice and 1 project" — '' when none. */
  sentence: string;
}

const n = (v: unknown): number => {
  const x = Math.trunc(Number(v));
  return Number.isFinite(x) && x > 0 ? x : 0;
};

/** "1 deal" / "3 deals" — the plural is the label's own, never a bare "(s)". */
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Join a list the way a person writes it: "a", "a and b", "a, b and c". */
export function listSentence(parts: string[]): string {
  const p = (Array.isArray(parts) ? parts : []).filter((x) => !!x);
  if (!p.length) return '';
  if (p.length === 1) return p[0];
  return `${p.slice(0, -1).join(', ')} and ${p[p.length - 1]}`;
}

/** Turn the pre-flight counts into the confirm's plain-English inventory.
 *  Order is the order the work happened in: deal → agreement → money → delivery
 *  → the incidental (appointments, reviews). */
export function summarizeAttachments(raw: AttachmentCounts | null | undefined): AttachmentSummary {
  const c = raw || {};
  const counts = {
    deals: n(c.deals),
    won_deals: n(c.won_deals),
    projects: n(c.projects),
    signed_contracts: n(c.signed_contracts),
    paid_invoices: n(c.paid_invoices),
    open_invoices: n(c.open_invoices),
    appointments: n(c.appointments),
    reviews: n(c.reviews),
  };
  const items: string[] = [];
  if (counts.deals) items.push(plural(counts.deals, 'deal', 'deals'));
  if (counts.signed_contracts) items.push(plural(counts.signed_contracts, 'signed agreement', 'signed agreements'));
  if (counts.paid_invoices) items.push(plural(counts.paid_invoices, 'paid invoice', 'paid invoices'));
  if (counts.open_invoices) items.push(plural(counts.open_invoices, 'unpaid invoice', 'unpaid invoices'));
  if (counts.projects) items.push(plural(counts.projects, 'project', 'projects'));
  if (counts.appointments) items.push(plural(counts.appointments, 'booking', 'bookings'));
  if (counts.reviews) items.push(plural(counts.reviews, 'review', 'reviews'));
  // `won_deals` is a QUALIFIER on `deals`, never its own line — counting it
  // separately would double-report the same deal ("1 deal, 1 won deal").
  const total = counts.deals + counts.projects + counts.signed_contracts
    + counts.paid_invoices + counts.open_invoices + counts.appointments + counts.reviews;
  return { counts, total, converted: counts.won_deals > 0, items, sentence: listSentence(items) };
}

/** The whole warning, in Eric's words. `who` is the contact's display name.
 *  Returns '' when there is nothing attached — the caller then uses the plain
 *  confirm, because there is genuinely nothing to warn about. */
export function attachmentWarning(who: string, s: AttachmentSummary): string {
  if (!s || !s.total) return '';
  const name = String(who || 'This contact').trim() || 'This contact';
  const lead = `${name} has ${s.sentence}.`;
  const kept = s.converted
    ? 'They became a customer. Removing them takes them off your contact list only — the deal, the agreement, the invoices and the project all stay exactly where they are, and nothing is deleted with them.'
    : 'Removing them takes them off your contact list only — everything above stays exactly where it is, and nothing is deleted with them.';
  return `${lead} ${kept}`;
}

// ── roster duplicate hints ───────────────────────────────────────────────────
// "6262346081" and "(626) 234-6081" are the same number; "Claud Beltran" and
// "Claude Beltran" are the same person. The dedupe module already knows both
// (phoneKey normalizes, nameSimilarity tolerates the typo) — it just only ever
// ran on CREATE. Running it across the roster surfaces the pairs already sitting
// there. A HINT only: it never merges, never hides, never reorders.

export interface DupeHint { id: string; name: string; email: string; phone: string; reasons: string[]; why: string }

/** Annotate a roster with its best possible-duplicate partner per row.
 *  O(n²) over one page of contacts (≤100) — a few thousand short-string
 *  comparisons. Returns a map of contact id → the single best hint. */
export function duplicateHints(contacts: DupCandidate[] | null | undefined, cap = 400): Record<string, DupeHint> {
  const list = (Array.isArray(contacts) ? contacts : []).filter((c) => c && c.id);
  const out: Record<string, DupeHint> = {};
  if (list.length < 2 || list.length > cap) return out;   // above the cap the quadratic scan isn't worth it — say nothing rather than stall
  for (const c of list) {
    const best: DupMatch | undefined = findPossibleDuplicates(c, list, 1)[0];
    if (!best || !best.id) continue;
    out[String(c.id)] = {
      id: String(best.id),
      name: String(best.name || best.email || best.phone || 'another contact'),
      email: String(best.email || ''),
      phone: String(best.phone || ''),
      reasons: Array.isArray(best.reasons) ? best.reasons : [],
      why: listSentence(Array.isArray(best.reasons) ? best.reasons : []),
    };
  }
  return out;
}
