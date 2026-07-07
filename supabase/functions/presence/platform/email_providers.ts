// ── Business email presets (M14) — providers as DATA, PURE ──────────────────
// The platform guides email setup and authentication; it is not an email
// service and never becomes one. Each preset is exact records + honest
// notes; DKIM keys always come from the provider's own panel, never
// invented. A new provider is a registry entry — the abstraction principle
// (M12) applied to email.
import type { DnsRecord } from './dns.ts';
import type { InfraPlan, PlanStep } from './plans.ts';
import { validateRecord, explainRecord } from './dns.ts';

export interface EmailProviderPreset {
  slug: string;
  name: string;
  mx: (domain: string) => DnsRecord[];
  spf: (domain: string) => DnsRecord;
  dkim_note: string;                       // where the key lives — never invented
  dkim_host_hint: (domain: string) => string;
}

export const EMAIL_PROVIDERS: Record<string, EmailProviderPreset> = {
  google_workspace: {
    slug: 'google_workspace', name: 'Google Workspace',
    mx: (d) => [{ type: 'MX', name: d, value: 'smtp.google.com', priority: 1, ttl: 3600 }],
    spf: (d) => ({ type: 'TXT', name: d, value: 'v=spf1 include:_spf.google.com ~all', ttl: 3600 }),
    dkim_note: 'Google Admin → Apps → Gmail → Authenticate email → generate the key, then copy it here.',
    dkim_host_hint: (d) => `google._domainkey.${d}`,
  },
  microsoft365: {
    slug: 'microsoft365', name: 'Microsoft 365',
    mx: (d) => [{ type: 'MX', name: d, value: `${d.replace(/\./g, '-')}.mail.protection.outlook.com`, priority: 0, ttl: 3600 }],
    spf: (d) => ({ type: 'TXT', name: d, value: 'v=spf1 include:spf.protection.outlook.com ~all', ttl: 3600 }),
    dkim_note: 'Microsoft 365 Defender → Email authentication settings → DKIM → enable, then add the two CNAMEs it shows.',
    dkim_host_hint: (d) => `selector1._domainkey.${d}`,
  },
  zoho: {
    slug: 'zoho', name: 'Zoho Mail',
    mx: (d) => [
      { type: 'MX', name: d, value: 'mx.zoho.com', priority: 10, ttl: 3600 },
      { type: 'MX', name: d, value: 'mx2.zoho.com', priority: 20, ttl: 3600 },
    ],
    spf: (d) => ({ type: 'TXT', name: d, value: 'v=spf1 include:zohomail.com ~all', ttl: 3600 }),
    dkim_note: 'Zoho Mail Admin → Email Authentication → DKIM → generate, then copy the key here.',
    dkim_host_hint: (d) => `zmail._domainkey.${d}`,
  },
  other: {
    slug: 'other', name: 'Another provider',
    mx: () => [],
    spf: (d) => ({ type: 'TXT', name: d, value: 'v=spf1 ~all', ttl: 3600 }),
    dkim_note: 'Your provider’s admin panel has the MX values and the DKIM key — the platform validates whatever you bring.',
    dkim_host_hint: (d) => `selector._domainkey.${d}`,
  },
};

const dmarc = (d: string): DnsRecord => ({ type: 'TXT', name: `_dmarc.${d}`, value: `v=DMARC1; p=none; rua=mailto:postmaster@${d}`, ttl: 3600 });

/** A full guided email setup for one provider — MX + SPF + DMARC prepared and
 *  validated; DKIM named honestly. Same plan machinery, same approval law. */
export function planEmailSetup(domain: string, providerSlug: string): InfraPlan {
  const p = EMAIL_PROVIDERS[providerSlug] || EMAIL_PROVIDERS.other;
  const mxRecords = p.mx(domain);
  const authRecords = [p.spf(domain), dmarc(domain)];
  for (const r of [...mxRecords, ...authRecords]) {
    const v = validateRecord(r);
    if (!v.ok) throw new Error(`preset invalid: ${v.problem}`);
  }
  const steps: PlanStep[] = [];
  if (mxRecords.length) steps.push({
    what: `Point the domain's mail at ${p.name}`, why: 'MX records tell the internet where email for your domain should be delivered.',
    automated: false, records: mxRecords, explain: mxRecords.map(explainRecord), done: false,
  });
  steps.push({
    what: 'Add the SPF and DMARC records', why: 'They make email from your domain provably yours — inboxes junk unprotected senders.',
    automated: false, records: authRecords, explain: authRecords.map(explainRecord), done: false,
  });
  steps.push({
    what: `Enable DKIM in ${p.name} and add the key it gives you (${p.dkim_host_hint(domain)})`,
    why: p.dkim_note + ' The platform never invents signing keys.',
    automated: false, done: false,
  });
  steps.push({
    what: 'The platform re-checks MX, SPF, and DMARC and confirms deliverability posture',
    why: 'The email-authentication observer verifies the records answer; mailbox health stays watched from then on.',
    automated: true, done: false,
  });
  return {
    kind: 'email_setup',
    title: `Business email on ${domain} via ${p.name}`,
    summary: `Everything email needs on the DNS side, prepared and validated. The platform guides and verifies; ${p.name} remains YOUR provider — the platform is not an email service and holds no mail.`,
    steps,
    risk: mxRecords.length ? 'Medium if mail already flows on this domain — changing MX moves delivery. If email already works, skip the MX step and keep only SPF/DKIM/DMARC.' : 'Low — authentication records only.',
    reversible: true,
    rollback_note: 'Remove or restore the previous MX/TXT records (kept in this plan’s zone snapshot); delivery returns exactly as before.',
    requires_approval: true,
  };
}
