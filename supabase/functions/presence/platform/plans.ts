// ── Infrastructure Change Plans (M12) — the safety core, PURE ───────────────
// EVERY infrastructure action is a PLAN: what, why, exact records or steps,
// what's automated vs guided, the risk in plain words, and whether it can be
// rolled back. Nothing applies without explicit approval (requires_approval
// is a schema CHECK, like every constitutional constant before it). Applying
// automated steps uses provider capabilities; guided steps are performed by
// a human and marked done. Reality is never hidden: a guided step says so.
import { templateRecords, validateRecord, explainRecord } from './dns.ts';
import type { DnsRecord } from './dns.ts';

export type PlanKind = 'connect_domain' | 'email_auth' | 'registrar_care' | 'hosting_restore' | 'migration';

export interface PlanStep {
  what: string;                 // the action, plain words
  why: string;                  // the reason, plain words
  automated: boolean;           // true only when a provider capability is 'automatic'
  records?: DnsRecord[];        // exact records for guided DNS steps
  explain?: string[];           // per-record plain-language translations
  done: boolean;
}

export interface InfraPlan {
  kind: PlanKind;
  title: string;
  summary: string;              // what changes and what does not, in sentences
  steps: PlanStep[];
  risk: string;                 // honest, plain words
  reversible: boolean;
  rollback_note: string;
  requires_approval: true;
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

export function planEmailAuth(domain: string): InfraPlan {
  const records = templateRecords('email_auth', { domain });
  return {
    kind: 'email_auth',
    title: `Protect email sent from @${domain}`,
    summary: 'Three records make your email provably yours: SPF says who may send, DKIM signs each message, DMARC tells inboxes to care. Delivery of existing email does not change.',
    steps: [
      step('Add the SPF and DMARC records at your DNS host', 'Without them, anyone can send email pretending to be you — and inboxes increasingly junk unprotected senders.', false, records.filter((r) => !/\._domainkey/.test(r.name))),
      step('Copy the DKIM record from your email provider’s admin panel, then add it', 'The signing key is issued by your mail provider — the platform names the record but never invents the key.', false, records.filter((r) => /\._domainkey/.test(r.name))),
      step('The platform re-checks the records and confirms alignment', 'The email-authentication observer verifies SPF and DMARC now answer.', true),
    ],
    risk: 'Low with p=none (monitor-only DMARC, the default here). Tightening to quarantine/reject is a later, separate decision.',
    reversible: true,
    rollback_note: 'Remove the added TXT records; email flows exactly as before.',
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
