// ── Write-Capable Adapters (L4.3) — the plan core, PURE ─────────────────────
// The first external writes. The safety architecture is the M12 Infrastructure
// Change Plan, applied to connected providers: EVERY write is a PLAN the
// customer reviews and approves before anything happens. Capabilities are
// DECLARED, never assumed. There is ONE shape and ONE flow for every provider —
// no provider-specific write path exists.
//
//   Observation → Evidence → Judgment → Recommendation → PLAN → Human Approval
//     → Execute → Audit → Verify
//
// Two kinds only, both safe by construction:
//   • 'write'   — a real provider write, approval-gated, verified by read-back,
//                 reversible or explained. Live only when write scopes are
//                 registered (owner setup); otherwise honestly "not available".
//   • 'handoff' — the platform PREPARES content (a post, an email, a booking)
//                 and hands it to the customer. Nothing is ever sent or posted;
//                 the customer acts on it themselves. Structurally incapable of
//                 an external write.
import { providerByKey } from './providers.ts';
import type { ConnectedProvider } from './contract.ts';

export type WriteKind = 'write' | 'handoff';
export type WriteWorkflow =
  | 'gbp_post' | 'gbp_hours' | 'gsc_verify'          // real provider writes
  | 'calendar_hold' | 'email_draft' | 'social_draft'; // handoffs — never sent

/** The plan the customer reviews — plain language, everything on the table. */
export interface WritePlan {
  workflow: WriteWorkflow;
  provider_key: string;
  kind: WriteKind;
  title: string;
  summary: string;
  what_changes: string[];      // plain bullets — what this does
  what_stays: string[];        // what will NOT change (the reassurance that matters)
  risk: string;                // honest, plain words
  reversible: boolean;
  rollback: string;            // how to undo, or why undo is unneeded/impossible
  verify: string;              // how we confirm it worked, plain words
  requires_approval: true;     // constitutional constant (schema CHECK re-enforces)
  payload: Record<string, unknown>;      // exact data to write (or the handoff content)
  prior_state: Record<string, unknown> | null; // snapshot for rollback
}

// The declared write capability of each workflow: which provider, whether it is
// a real write or a handoff, and (for writes) the endpoint + method + verify
// read the executor uses. Declared here so the architecture is provably uniform;
// a new write workflow is an entry, never a new code path.
export interface WriteSpec {
  workflow: WriteWorkflow;
  provider_key: string;
  kind: WriteKind;
  label: string;               // what the customer calls this action
  // execution shape (kind 'write' only — the executor reads these):
  method?: 'POST' | 'PATCH' | 'PUT';
  endpoint?: string;           // documented provider endpoint (bearer write)
  verifyReads?: boolean;       // true = confirm by reading the provider back
}

export const WRITE_SPECS: readonly WriteSpec[] = [
  { workflow: 'gbp_post', provider_key: 'google_business_profile', kind: 'write', label: 'publish a post to your Google listing',
    method: 'POST', endpoint: 'https://mybusiness.googleapis.com/v4/{location}/localPosts', verifyReads: true },
  { workflow: 'gbp_hours', provider_key: 'google_business_profile', kind: 'write', label: 'update the hours on your Google listing',
    method: 'PATCH', endpoint: 'https://mybusinessbusinessinformation.googleapis.com/v1/{location}?updateMask=regularHours', verifyReads: true },
  { workflow: 'gsc_verify', provider_key: 'google_search_console', kind: 'write', label: 'request Search Console verification',
    method: 'POST', endpoint: 'https://www.googleapis.com/siteVerification/v1/webResource', verifyReads: true },
  // Handoffs — deliberately NOT provider writes. Google Calendar stays read-only
  // (writing to a real calendar can't be safely verified/undone per-event yet):
  // we prepare a booking the customer drops in themselves.
  { workflow: 'calendar_hold', provider_key: 'google_calendar', kind: 'handoff', label: 'prepare a booking you add yourself' },
  { workflow: 'email_draft', provider_key: 'mailchimp', kind: 'handoff', label: 'prepare an email for your list (you send it)' },
  { workflow: 'social_draft', provider_key: 'facebook_page', kind: 'handoff', label: 'prepare a post for you to publish' },
] as const;

export function writeSpec(workflow: string): WriteSpec | null {
  return WRITE_SPECS.find((w) => w.workflow === workflow) || null;
}
export function writeWorkflowsForProvider(key: string): WriteSpec[] {
  return WRITE_SPECS.filter((w) => w.provider_key === key);
}
export const isHandoff = (workflow: string): boolean => writeSpec(workflow)?.kind === 'handoff';

// ── plain-language plan builders (pure) — one per workflow ───────────────────
// Each returns a complete WritePlan: every required field, in the customer's
// words, with the reassurance ("what stays") always present.
const str = (v: unknown) => String(v ?? '').trim();

interface BuildInput {
  // shared, all optional — each builder uses what it needs
  text?: string;                                   // post / email / social body
  subject?: string;                                // email subject
  hours?: Record<string, string>;                  // { mon: '9-5', … }
  priorHours?: Record<string, string>;             // captured at prepare, for rollback
  siteUrl?: string;                                // gsc
  when?: string;                                   // calendar hold, plain
  recommendationHash?: string;
}

export function buildWritePlan(workflow: WriteWorkflow, provider: ConnectedProvider, input: BuildInput): WritePlan {
  const base = { workflow, provider_key: provider.key, requires_approval: true as const };
  switch (workflow) {
    case 'gbp_post':
      return { ...base, kind: 'write',
        title: 'Publish a post to your Google listing',
        summary: `A short update in your own words is posted to ${provider.customerLabel}, where people see it when they find you on Google. You approve the exact words first.`,
        what_changes: ['A new post appears on your Google listing.'],
        what_stays: ['Your hours, phone, address, photos, and reviews are untouched.', 'Nothing on your own website changes.'],
        risk: 'Low. A post is public, but it can be removed in one step if you change your mind.',
        reversible: true,
        rollback: 'The post can be deleted from your listing — one step, and it’s gone as if it were never there.',
        verify: 'We read your listing back and confirm the post is actually live before calling it done.',
        payload: { summary: str(input.text) }, prior_state: null };
    case 'gbp_hours':
      return { ...base, kind: 'write',
        title: 'Update the hours on your Google listing',
        summary: `Your opening hours on ${provider.customerLabel} are set to match what you told us. Your previous hours are saved first, so this can always be put back.`,
        what_changes: ['Your listed opening hours change to the new hours you approved.'],
        what_stays: ['Your name, address, phone, photos, and reviews are untouched.', 'Your website’s hours are separate — they change only if you update them there too.'],
        risk: 'Low. Hours are easy to correct, and your previous hours are saved in this plan.',
        reversible: true,
        rollback: 'Your previous hours are saved here; restoring them is one step.',
        verify: 'We read your listing back and confirm the hours now match what you approved.',
        payload: { hours: input.hours || {} }, prior_state: input.priorHours ? { hours: input.priorHours } : null };
    case 'gsc_verify':
      return { ...base, kind: 'write',
        title: 'Ask Google to verify your site in Search Console',
        summary: `Sends Google a verification request for ${str(input.siteUrl) || 'your site'} so your full search data becomes available. It only grants visibility — it changes nothing anyone can see.`,
        what_changes: ['Google records your site as verified for Search Console.'],
        what_stays: ['Your website, its content, and your Google listing are all completely untouched.', 'Nothing public changes — this is a visibility request, not a change to your site.'],
        risk: 'None to anything public. It grants read access to your own search data and nothing more.',
        reversible: false,
        rollback: 'There’s nothing to undo — it changes nothing public. If ever unwanted, verification can be removed in Search Console.',
        verify: 'We read the verification status back and confirm it succeeded.',
        payload: { site_url: str(input.siteUrl) }, prior_state: null };
    case 'calendar_hold':
      return { ...base, kind: 'handoff',
        title: 'Prepare a booking for your calendar',
        summary: `We prepare a ready-to-add booking${input.when ? ` for ${str(input.when)}` : ''}. Nothing is written to ${provider.customerLabel} — you drop it into your own calendar so it’s always exactly as you intend.`,
        what_changes: ['A ready-to-add booking is prepared for you.'],
        what_stays: ['Nothing is written to your calendar. Your existing appointments are untouched.', 'Your calendar changes only when you add it yourself.'],
        risk: 'None — nothing is written anywhere. It’s a handoff you complete.',
        reversible: true,
        rollback: 'There’s nothing to undo — nothing was written. Simply don’t add it, or remove it from your calendar if you did.',
        verify: 'The booking is ready to add; the actual change stays in your hands.',
        payload: { when: str(input.when), text: str(input.text) }, prior_state: null };
    case 'email_draft':
      return { ...base, kind: 'handoff',
        title: 'Prepare an email for your list',
        summary: `We draft the email in your words. Nothing is sent — you take it to ${provider.customerLabel} and send it when you’re ready.`,
        what_changes: ['A ready-to-send email draft is prepared for you.'],
        what_stays: ['Nothing is sent. Your list, your past campaigns, and your settings are untouched.', 'No one receives anything until you send it yourself.'],
        risk: 'None — nothing leaves Studio OS. It’s a draft handoff.',
        reversible: true,
        rollback: 'There’s nothing to undo — nothing was sent.',
        verify: 'The draft is ready to copy across; sending stays entirely in your hands.',
        payload: { subject: str(input.subject), body: str(input.text) }, prior_state: null };
    case 'social_draft':
      return { ...base, kind: 'handoff',
        title: 'Prepare a post for your social account',
        summary: `We draft the post in your words. Nothing is auto-posted — you review it on ${provider.customerLabel} and publish it yourself.`,
        what_changes: ['A ready-to-publish post is prepared for you.'],
        what_stays: ['Nothing is posted. Your account, followers, and past posts are untouched.', 'Nothing goes public until you publish it yourself.'],
        risk: 'None — nothing is posted anywhere. It’s a draft handoff.',
        reversible: true,
        rollback: 'There’s nothing to undo — nothing was posted.',
        verify: 'The post is ready to publish; posting stays in your hands.',
        payload: { body: str(input.text) }, prior_state: null };
  }
}
