// ── PT-6: Business Health Coach — plain English, never a score ───────────────
// One calm read of "is everything okay?", composed from signals the platform
// ALREADY computes (publish state, pending approvals, connected health, search
// health, waiting leads, domain expiry). No score, no grade, no gamification —
// a word + a sentence + at most three plain suggestions, each pointing at where
// to act. Reuses the same philosophy as the health word + Today rollup.

export interface HealthSignals {
  live: boolean;
  lastPublishedAt: string | null;
  pendingApprovals: number;
  connectedNeedingAttention: number;
  searchIssues: number;
  leadsWaiting: number;
  unpublishedChanges: boolean;
  domainExpiringDays: number | null;   // null = not applicable/known
}

export type HealthStatus = 'healthy' | 'attention' | 'quiet' | 'new';
export interface HealthCoachRead {
  status: HealthStatus;
  headline: string;
  suggestions: Array<{ text: string; href: string }>;
}

/** Compose the coach read. Pure. Suggestions are ordered by what helps most. */
export function coachRead(s: HealthSignals, _nowIso: string): HealthCoachRead {
  const suggestions: Array<{ text: string; href: string }> = [];

  if (s.leadsWaiting > 0) suggestions.push({ text: s.leadsWaiting === 1 ? 'Someone’s waiting for a reply — a quick response keeps them warm.' : `${s.leadsWaiting} people are waiting for a reply.`, href: '/leads.html' });
  if (s.pendingApprovals > 0) suggestions.push({ text: s.pendingApprovals === 1 ? 'A change is ready for your approval.' : `${s.pendingApprovals} changes are ready for your approval.`, href: '/presence.html#foundations' });
  if (s.domainExpiringDays !== null && s.domainExpiringDays <= 30) suggestions.push({ text: s.domainExpiringDays <= 0 ? 'Your web address has lapsed — renew it at your registrar.' : `Your web address renews in ${s.domainExpiringDays} day${s.domainExpiringDays === 1 ? '' : 's'} — auto-renew is the calm option.`, href: '/presence.html#business' });
  if (s.connectedNeedingAttention > 0) suggestions.push({ text: s.connectedNeedingAttention === 1 ? 'A connected service needs a quick look.' : `${s.connectedNeedingAttention} connected services need a look.`, href: '/connections.html' });
  if (s.searchIssues > 0) suggestions.push({ text: s.searchIssues === 1 ? 'One thing could help how you show up in search.' : `${s.searchIssues} things could help how you show up in search.`, href: '/presence.html#search' });
  if (s.unpublishedChanges) suggestions.push({ text: 'You have edits that aren’t published yet.', href: '/presence.html#publish' });

  // status + headline — a word and a sentence, never a number
  if (!s.live && !s.lastPublishedAt) {
    return { status: 'new', headline: 'You’re getting set up — nothing needs you yet.', suggestions: suggestions.slice(0, 3) };
  }
  if (!s.live) {
    return { status: 'quiet', headline: 'Your site isn’t live right now.', suggestions: [{ text: 'Publish when you’re ready to be found again.', href: '/presence.html#publish' }, ...suggestions].slice(0, 3) };
  }
  if (suggestions.length === 0) {
    return { status: 'healthy', headline: 'Everything looks healthy.', suggestions: [] };
  }
  const headline = suggestions.length === 1 ? 'One thing could help.' : 'A couple of things could help.';
  return { status: 'attention', headline, suggestions: suggestions.slice(0, 3) };
}
