// ── Infrastructure Change Plans (M12) — the safety core, PURE ───────────────
// EVERY infrastructure action is a PLAN: what, why, exact records or steps,
// what's automated vs guided, the risk in plain words, and whether it can be
// rolled back. Nothing applies without explicit approval (requires_approval
// is a schema CHECK, like every constitutional constant before it). Applying
// automated steps uses provider capabilities; guided steps are performed by
// a human and marked done. Reality is never hidden: a guided step says so.
import { templateRecords, validateRecord, explainRecord } from './dns.ts';
import type { DnsRecord } from './dns.ts';
import type { ApprovedPlanBase } from '../lib/approved_plan.ts';
import { dmarcRecord } from './email_providers.ts';
import type { EmailProviderPreset } from './email_providers.ts';

export type PlanKind = 'connect_domain' | 'email_auth' | 'registrar_care' | 'hosting_restore' | 'migration'
  // M14 (additive, matching the 0035 CHECK):
  | 'domain_transfer_in' | 'domain_transfer_out' | 'dns_repair' | 'email_setup';

export interface PlanStep {
  what: string;                 // the action, plain words
  why: string;                  // the reason, plain words
  automated: boolean;           // true only when a provider capability is 'automatic'
  records?: DnsRecord[];        // exact records for guided DNS steps
  explain?: string[];           // per-record plain-language translations
  done: boolean;
}

// Extends the shared ApprovedPlanBase (title/summary/risk/reversible/approval) —
// the same lifecycle spine as a Connected Write Plan; only the executor differs.
export interface InfraPlan extends ApprovedPlanBase {
  kind: PlanKind;
  steps: PlanStep[];
  rollback_note: string;
}

const step = (what: string, why: string, automated: boolean, records?: DnsRecord[]): PlanStep => ({
  what, why, automated, records,
  explain: records?.map(explainRecord),
  done: false,
});

export function planConnectDomain(domain: string, target: string | null): InfraPlan {
  const records = templateRecords('point_domain', { domain, target: target || undefined });
  for (const r of records) { const v = validateRecord(r); if (!v.ok) throw new Error(`template invalid: ${v.problem}`); }
  return {
    kind: 'connect_domain',
    title: `Point ${domain} at your website`,
    summary: `Two DNS records route ${domain} (and www.${domain}) to your site. Email, and everything else on the domain, is untouched. Visitors may see the change settle over a few hours.`,
    steps: [
      step(`Add these records at your DNS host`, 'They tell the internet where your website lives now.', false, records),
      step('The platform attaches the domain and provisions the security certificate', 'HTTPS certificates are issued and renewed automatically once the records answer.', true),
      step('The platform verifies the domain answers with your site over HTTPS', 'Trust, but verify — the change isn’t done until it’s observed working.', true),
    ],
    risk: 'Low. The old records keep working until you change them; nothing is deleted by this plan.',
    reversible: true,
    rollback_note: 'Point the records back at their previous values (kept in this plan’s snapshot) and the domain behaves exactly as before.',
    requires_approval: true,
  };
}

/** What is already on the domain, read before the plan is made (Nov 12 review, finding 14). */
export interface EmailFacts { provider: EmailProviderPreset | null; mxHost?: string | null; hasSpf: boolean; hasDmarc: boolean }

/** Email protection for the company that really runs the client's email, adding only what is
 *  missing. Google's records used to go to everyone: on Microsoft 365, GoDaddy or Zoho that
 *  made real mail fail the sender check, and a second sender record beside an existing one
 *  breaks both. With no facts (nothing read yet) no sender record is offered at all. */
export function planEmailAuth(domain: string, facts: EmailFacts = { provider: null, hasSpf: false, hasDmarc: false }): InfraPlan {
  const p = facts.provider;
  const steps: PlanStep[] = [];
  if (!facts.hasSpf) {
    if (p) {
      const rec = p.spf(domain);
      const v = validateRecord(rec); if (!v.ok) throw new Error(`preset invalid: ${v.problem}`);
      steps.push(step(`Add ${p.name}’s sender record`, `It lists who may send email as you. This is the one for ${p.name}, which runs your email.`, false, [rec]));
    } else {
      steps.push(step(`Ask the company that runs your email${facts.mxHost ? ` (its mail server is ${facts.mxHost})` : ''} for its sender record, and add it`,
        'It lists who may send email as you, and every email company has its own. We don’t guess: the wrong one sends your real mail to spam.', false));
    }
  }
  if (!facts.hasDmarc) steps.push(step('Add the record that tells inboxes what to do with fakes', 'It asks inboxes to report email that pretends to be you. It only watches: nothing is blocked.', false, [dmarcRecord(domain)]));
  steps.push(step(p ? `Turn on email signing in ${p.name}` : 'Turn on email signing with your email company', p ? p.dkim_note : 'Signing proves a message wasn’t altered. The record for it comes from your email company’s own settings.', false));
  steps.push(step('We look for the records and close this when they’re found', 'Each time this sheet opens, and once a day.', true));
  const have = facts.hasSpf ? ' Your sender record is already there, so it stays as it is.' : facts.hasDmarc ? ' The record for fakes is already there, so it stays as it is.' : '';
  return {
    kind: 'email_auth',
    title: `Protect email sent from @${domain}`,
    summary: `A few small records tell inboxes your mail is really from you, so it stays out of spam.${p ? ` Your email runs at ${p.name}, so these are ${p.name}’s.` : ''}${have} Email you already get and send keeps working the same way.`,
    steps,
    risk: 'Low. These records only add proof; nothing about how your email is delivered changes.',
    reversible: true,
    rollback_note: 'Remove the added records; email flows exactly as before.',
    requires_approval: true,
  };
}

export function planRegistrarCare(domain: string, guide: (a: 'auto_renew' | 'whois_privacy' | 'renew', d: string) => string[]): InfraPlan {
  return {
    kind: 'registrar_care',
    title: `Keep ${domain} safely yours`,
    summary: 'Auto-renew and WHOIS privacy are the two switches that prevent the two common domain disasters: silent expiration and a public home address.',
    steps: [
      step(guide('auto_renew', domain).join(' '), 'Expired domains take websites and email down with them — and can be bought by strangers.', false),
      step(guide('whois_privacy', domain).join(' '), 'Registration details are public by default; privacy is usually one free switch.', false),
      step('The platform keeps watching the expiration date', 'The infrastructure observer already checks it on every run and raises it long before it’s urgent.', true),
    ],
    risk: 'None — both switches are protective and reversible.',
    reversible: true,
    rollback_note: 'Both switches can be turned off at the registrar at any time.',
    requires_approval: true,
  };
}

export function planHostingRestore(deployId: string, deployTitle: string): InfraPlan {
  return {
    kind: 'hosting_restore',
    title: 'Restore a previous version of the live website',
    summary: `The live site returns to “${deployTitle}”. The current version stays in history — nothing is deleted, and restoring forward again is one step.`,
    steps: [
      step(`Restore deploy ${deployId.slice(0, 8)}…`, 'Hosting keeps every published version; restoring re-publishes a previous one.', true),
      step('The platform verifies the live site answers correctly after the restore', 'A restore isn’t done until the site is observed healthy.', true),
    ],
    risk: 'Low. Content published after that version won’t be visible until re-published.',
    reversible: true,
    rollback_note: 'Restore the newer deploy from the same history — one step back.',
    requires_approval: true,
  };
}
