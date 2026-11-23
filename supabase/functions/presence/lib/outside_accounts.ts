// ── The outside accounts Studio OS depends on (builder list item 398) ──────────
// The settings that keep Studio OS safe live in other companies' dashboards: new sign-ups
// off and confirm email on at Supabase, the leaked-password check, two-step sign-in on
// every account. None of them is in the code, so a rebuild wouldn't bring them back and a
// switch flipped by mistake would go unnoticed. The Health page lists them here, with
// where to look, and the platform's owner ticks each account once a quarter after looking.
// The ticks are kept in platform_account_checks (migration 0267); this list is the card.

export interface OutsideAccount { key: string; name: string; why: string; checks: string[]; where: string }

export const OUTSIDE_ACCOUNTS: OutsideAccount[] = [
  {
    key: 'supabase', name: 'Supabase', why: 'The database, sign-in and the server.',
    checks: [
      'New sign-ups are off: Authentication, Sign In / Providers, “Allow new users to sign up” is off.',
      'Email: “Confirm email” is on, and “Allow unverified email sign-ins” is off.',
      'The leaked-password check is on: Authentication, Attack Protection.',
      'Two-step sign-in is on for your own Supabase account.',
    ],
    where: 'https://supabase.com/dashboard/project/qksstlqzbhesadrrofgn/auth/providers',
  },
  {
    key: 'github', name: 'GitHub', why: 'The code and every release.',
    checks: [
      'Two-step sign-in is on for your account.',
      'Secret scanning, push protection and Dependabot alerts are on: the repository’s Settings, Advanced Security.',
      'The main branch is protected, with “Do not allow bypassing the above settings” ticked.',
    ],
    where: 'https://github.com/edavis71433/studio-os/settings/security_analysis',
  },
  {
    key: 'netlify', name: 'Netlify', why: 'Hosting for the app and every client’s site.',
    checks: [
      'Two-step sign-in is on for your account.',
      'Only the app’s own site is linked to the code. An old second copy is unlinked or deleted.',
      'Credits: auto recharge is set the way you want it, so client sites never pause.',
    ],
    where: 'https://app.netlify.com/user/settings',
  },
  {
    key: 'stripe', name: 'Stripe', why: 'Every payment.',
    checks: [
      'Two-step sign-in is on for your account.',
      'Studio OS holds the limited key: the Stripe key card on this page says so.',
    ],
    where: 'https://dashboard.stripe.com/settings/user',
  },
  {
    key: 'resend', name: 'Resend', why: 'Every email Studio OS sends.',
    checks: [
      'Two-step sign-in is on for your account.',
      'The sending domain shows as verified.',
    ],
    where: 'https://resend.com/settings',
  },
];

/** A tick older than this is due again: a quarter, with a few days' grace. */
export const CHECK_EVERY_DAYS = 92;

export interface AccountCheck { account: string; checked_at: string; checked_by: string }
export interface AccountLine extends OutsideAccount { checked_at: string | null; checked_by: string | null; due: boolean }

/** The card's lines: every account on the list with its last tick, due when it was never
 *  ticked or the tick is over a quarter old. A stored tick for an account that left the
 *  list is dropped. Pure. */
export function accountLines(ticks: AccountCheck[], nowMs: number): AccountLine[] {
  const by = new Map(ticks.filter((t) => t && typeof t.account === 'string').map((t) => [t.account, t]));
  return OUTSIDE_ACCOUNTS.map((a) => {
    const t = by.get(a.key);
    const at = t && !Number.isNaN(Date.parse(t.checked_at)) ? t.checked_at : null;
    const due = !at || nowMs - Date.parse(at) > CHECK_EVERY_DAYS * 86_400_000;
    return { ...a, checked_at: at, checked_by: at ? (t!.checked_by || null) : null, due };
  });
}

export const isAccountKey = (k: unknown): k is string => typeof k === 'string' && OUTSIDE_ACCOUNTS.some((a) => a.key === k);
