// ── Presence Health (constitution: tri-state behind a sentence, never a score) ─
// Deterministic derivation. The enum is machine-readable (mobile, fleet, AI);
// the client always meets it as a sentence. No percentages. Ever.

export type HealthState = 'healthy' | 'needs_attention' | 'outdated';

export interface HealthInput {
  businessName: string;
  siteStatus: string;                 // presence_sites.status (lifecycle)
  everPublished: boolean;
  lastPublishedAt: string | null;
  lastPublishFailed: boolean;
  hostingProblem: boolean;            // netlify site missing / lookup failed (when configured)
  draftBlockers: number;              // validation blockers on the current draft
  draftChanges: number;               // diff-engine count vs live
  oldestDraftChangeAt: string | null; // earliest change event since last live publish
  nowIso: string;
}

export interface Health {
  state: HealthState;
  sentence: string;                   // the h1
  detail: string;                     // the supporting line
  first_run: boolean;                 // never published + effectively empty → room shows welcome
}

const DAY = 24 * 60 * 60 * 1000;
const days = (a: string, b: string): number => Math.floor((new Date(a).getTime() - new Date(b).getTime()) / DAY);

export function deriveHealth(x: HealthInput): Health {
  const name = x.businessName || 'Your business';

  if (!x.everPublished) {
    return {
      state: 'needs_attention',
      sentence: `Let’s introduce ${name} to the internet.`,
      detail: 'Your website isn’t live yet. A few facts and one publish is all it takes.',
      first_run: true,
    };
  }

  if (x.hostingProblem || x.siteStatus === 'paused' || x.lastPublishFailed) {
    return {
      state: 'needs_attention',
      sentence: x.siteStatus === 'paused' ? `${name}’s site is paused.` : 'One thing needs attention.',
      detail: x.siteStatus === 'paused'
        ? 'Your live site still serves its last published version. Contact your studio to resume publishing.'
        : x.lastPublishFailed
          ? 'Your last publish didn’t go through — your live site is unchanged and nothing was lost. Try again when you’re ready.'
          : 'We’re looking at your website hosting — your concierge has been notified.',
      first_run: false,
    };
  }

  if (x.draftBlockers > 0) {
    return {
      state: 'needs_attention',
      sentence: 'A few things need fixing before your next publish.',
      detail: `Your live site is fine — but the draft has ${x.draftBlockers} item${x.draftBlockers > 1 ? 's' : ''} to fix before it can go out.`,
      first_run: false,
    };
  }

  const staleDraft = x.draftChanges > 0 && x.oldestDraftChangeAt && days(x.nowIso, x.oldestDraftChangeAt) >= 14;
  const stalePublish = x.lastPublishedAt && days(x.nowIso, x.lastPublishedAt) >= 120;
  if (staleDraft || stalePublish) {
    return {
      state: 'outdated',
      sentence: staleDraft ? `${name} has changes waiting to go out.` : `Worth a quick freshness check.`,
      detail: staleDraft
        ? `${x.draftChanges} change${x.draftChanges > 1 ? 's have' : ' has'} been sitting in your draft for a couple of weeks.`
        : 'It’s been a few months since your last publish — a minute to confirm hours and menu keeps everything trustworthy.',
      first_run: false,
    };
  }

  return {
    state: 'healthy',
    sentence: `${name} is saying the right things.`,
    detail: x.draftChanges > 0
      ? `Your website matches your latest published information. ${x.draftChanges} edit${x.draftChanges > 1 ? 's are' : ' is'} waiting whenever you’re ready to publish.`
      : 'Your website matches your latest information. Nothing needs you right now.',
    first_run: false,
  };
}
