// ── PT-7: Customer Timeline — the business journey, from EXISTING events ─────
// Milestones the platform can already see: account created, first publish,
// indexed (search verification present), first inquiry (first non-spam form
// submission), first customer (entitlement active), and the upcoming renewal.
// It celebrates what's been reached and shows what's next — a rewarding arc, not
// a scoreboard. "First visitor" needs analytics we don't collect yet (honest —
// arrives with GSC/analytics), so it isn't faked here.

export interface JourneySignals {
  createdAt: string;
  firstPublishedAt: string | null;
  searchVerified: boolean;
  firstInquiryAt: string | null;
  firstCustomerAt: string | null;   // entitlement became active / first paid
  renewsAt: string | null;
}

export interface Milestone {
  key: string;
  label: string;
  achieved: boolean;
  at: string | null;
  note: string;        // plain, celebratory when achieved; anticipatory when not
}

const ORDER: Array<{ key: string; label: string; pick: (s: JourneySignals) => { at: string | null; done: boolean }; done: string; next: string }> = [
  { key: 'created', label: 'Your presence began', pick: (s) => ({ at: s.createdAt, done: true }), done: 'Your workspace was created — the journey starts here.', next: '' },
  { key: 'published', label: 'First published', pick: (s) => ({ at: s.firstPublishedAt, done: !!s.firstPublishedAt }), done: 'Your website went live for the first time. 🎉', next: 'Publish when you’re ready — this is the big one.' },
  { key: 'indexed', label: 'Findable on search', pick: (s) => ({ at: s.searchVerified ? s.firstPublishedAt : null, done: s.searchVerified }), done: 'Search engines can see your site.', next: 'Once you’re verified, search engines start listing you.' },
  { key: 'first_inquiry', label: 'First inquiry', pick: (s) => ({ at: s.firstInquiryAt, done: !!s.firstInquiryAt }), done: 'Someone reached out through your website. 🎉', next: 'Your first message from a visitor will land here.' },
  { key: 'first_customer', label: 'First customer', pick: (s) => ({ at: s.firstCustomerAt, done: !!s.firstCustomerAt }), done: 'You’re up and running with Studio OS. 🎉', next: '' },
  { key: 'renewal', label: 'One year strong', pick: (s) => ({ at: s.renewsAt, done: false }), done: '', next: 'Your first renewal — a full year of being found.' },
];

/** Build the ordered milestones + the most recent celebration. Pure. */
export function buildTimeline(s: JourneySignals, _nowIso: string): { milestones: Milestone[]; latestCelebration: Milestone | null } {
  const milestones: Milestone[] = ORDER.map((m) => {
    const { at, done } = m.pick(s);
    return { key: m.key, label: m.label, achieved: done, at: done ? at : null, note: done ? m.done : m.next };
  });
  // the most recently achieved milestone that's worth celebrating (has an emoji marker)
  const celebrated = milestones.filter((m) => m.achieved && m.note.includes('🎉') && m.at);
  celebrated.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return { milestones, latestCelebration: celebrated[0] || null };
}
