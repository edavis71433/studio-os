// ── Domain transfer plans (M14) — PURE ──────────────────────────────────────
// Transfers in both directions, as first-class plans with visible progress
// (each step markable done). The OUT direction is deliberately as good as the
// IN direction: the customer's domain is theirs, and leaving must be as
// guided as arriving — that is the ownership guarantee made operational.
// The registrar adapter stays honest: every step is guided until a
// registrar API adapter ships; then steps flip to automated, same plan shape.
import type { InfraPlan, PlanStep } from './plans.ts';

const step = (what: string, why: string, automated = false): PlanStep => ({ what, why, automated, done: false });

export function planTransferIn(domain: string): InfraPlan {
  return {
    kind: 'domain_transfer_in',
    title: `Bring ${domain} under one roof`,
    summary: `The domain moves to the registrar the platform manages for you. The WEBSITE AND EMAIL KEEP WORKING the whole time — a transfer moves the name's paperwork, not its records.`,
    steps: [
      step(`Unlock ${domain} at the current registrar`, 'Registrars lock domains against theft; a transfer needs the lock lifted for a few days.'),
      step('Request the transfer code (EPP/auth code) from the current registrar', 'The code proves the owner approves the move — only you can get it.'),
      step('Start the transfer at the destination and enter the code', 'This begins the registry-level move; it typically completes in 5–7 days.'),
      step('Approve the confirmation email', 'Registrars email the owner a confirmation; approving it can speed things to hours.'),
      step('The platform watches until the registry confirms, then re-verifies expiry monitoring', 'Transfers add a year of registration; the expiration observer picks up the new date.', true),
    ],
    risk: 'Low. DNS keeps answering throughout; the only real risk is starting a transfer inside 60 days of registration or a previous transfer, which registries refuse — check the date first.',
    reversible: true,
    rollback_note: 'A transfer can be cancelled before completion, and the domain can always be transferred back out later — same steps, other direction.',
    requires_approval: true,
  };
}

export function planTransferOut(domain: string): InfraPlan {
  return {
    kind: 'domain_transfer_out',
    title: `Move ${domain} wherever you like`,
    summary: `Your domain is yours — this plan walks the move to any registrar you choose. The website and email keep working during the transfer, and everything you own here (content, media, data) remains exportable at any time.`,
    steps: [
      step(`Unlock ${domain} here and request the transfer code`, 'The code is yours on request, always — no retention hoops.'),
      step('Start the transfer at your new registrar and enter the code', 'The registry handles the move; typically 5–7 days.'),
      step('Approve the confirmation email', 'Approving speeds the move.'),
      step('The platform keeps DNS answering until the move completes, then hands off cleanly', 'No moment without a website: records stay live until the new registrar takes over.', true),
    ],
    risk: 'Low. Nothing about the live website changes; only where the name is registered.',
    reversible: true,
    rollback_note: 'Cancel before completion, or transfer back any time. Leaving is a supported workflow, not an exception.',
    requires_approval: true,
  };
}
