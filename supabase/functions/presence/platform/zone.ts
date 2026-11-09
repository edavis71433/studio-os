// ── Desired-state DNS + drift + repair (M14) — PURE ─────────────────────────
// The desired zone is a DOCUMENT, never the world. Observed reality comes from
// read-only zone snapshots (M12). Drift is the difference; repair is a PLAN
// carrying the exact records — the approval law and the write-capability
// honesty (guided until a DNS adapter ships) are unchanged.
import { explainRecord } from './dns.ts';
import type { DnsRecord } from './dns.ts';
import type { InfraPlan } from './plans.ts';

const normHost = (s: string) => (s || '').toLowerCase().replace(/\.$/, '');
const normVal = (r: DnsRecord) => r.type === 'CNAME' || r.type === 'MX' || r.type === 'NS'
  ? normHost(r.value) : (r.value || '').trim().replace(/^"|"$/g, '');
const normKey = (r: DnsRecord) => `${r.type}|${normHost(r.name)}|${normVal(r)}${r.type === 'MX' ? '|' + (r.priority ?? '') : ''}`;

export interface Drift {
  missing: DnsRecord[];       // desired but not observed — reality hasn't caught up
  satisfied: number;          // desired records that reality already honors
  observed_extra: number;     // records in the world we don't manage (NOT drift — never touched)
}

/** desired vs observed. Only DESIRED records can drift; the platform never
 *  claims authority over records it doesn't manage. */
export function diffZones(desired: DnsRecord[], observed: DnsRecord[]): Drift {
  const have = new Set(observed.map(normKey));
  const missing = desired.filter((r) => !have.has(normKey(r)));
  return { missing, satisfied: desired.length - missing.length, observed_extra: Math.max(0, observed.length - (desired.length - missing.length)) };
}

/** One-click repair: the drift becomes a plan (guided records, honest risk). */
export function planDnsRepair(domain: string, drift: Drift): InfraPlan {
  return {
    kind: 'dns_repair',
    title: `Bring ${domain}'s DNS back in line`,
    summary: `${drift.missing.length} record${drift.missing.length === 1 ? '' : 's'} you decided on ${drift.missing.length === 1 ? 'isn’t' : 'aren’t'} answering in the real zone yet. This plan carries the exact records; nothing you don’t manage is touched.`,
    steps: [
      {
        what: 'Add the missing records at your DNS host', why: 'The zone should match what you decided — drift means reality wandered.',
        automated: false, records: drift.missing, explain: drift.missing.map(explainRecord), done: false,
      },
      { what: 'The platform re-reads the zone and confirms the drift is gone', why: 'Repair isn’t done until it’s observed done.', automated: true, done: false },
    ],
    risk: 'Low — the plan only ADDS the records you already chose; nothing is deleted.',
    reversible: true,
    rollback_note: 'Remove the added records at the DNS host, or roll the desired zone back to an earlier saved version.',
    requires_approval: true,
  };
}
