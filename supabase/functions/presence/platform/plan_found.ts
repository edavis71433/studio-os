// ── An approved plan clears itself once its records are found (Nov 12 review, finding 13) ──
// A client approved "Protect email", was told "your studio takes it from here", and the plan
// then sat at "approved" for good: the only route that finished a plan was called by no page.
// The records a plan asks for can be read from outside, so the plan is closed the moment
// they answer: when the Domain sheet opens, and at the daily domain check.
import { svc } from '../lib/db.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import { readZone } from './dns.ts';
import { applyableRecords } from './managed_dns.ts';
import { emailFacts } from './email_providers.ts';
import type { DnsRecord, ZoneSnapshot } from './dns.ts';
import type { Principal } from '../../_shared/auth.ts';

/** The plans whose work is records someone adds where the domain is kept. */
export const RECORD_PLAN_KINDS = ['connect_domain', 'email_auth', 'email_setup', 'dns_repair'];

const host = (x: unknown) => String(x ?? '').trim().toLowerCase().replace(/\.$/, '');
const text = (x: unknown) => String(x ?? '').trim().replace(/^"|"$/g, '').replace(/"\s*"/g, '');

/** PURE: does this record answer? Names never mind case; a TXT's words are compared as written. */
export function recordAnswers(want: DnsRecord, zone: DnsRecord[]): boolean {
  return (zone || []).some((r) => r.type === want.type && host(r.name) === host(want.name)
    && (want.type === 'TXT' ? text(r.value) === text(want.value) : host(r.value) === host(want.value)));
}

/** PURE: every exact record the plan carries is answering. A plan with no exact record (only
 *  words, or a key to copy from the email company) is never found this way. */
export function planRecordsFound(steps: Array<{ records?: DnsRecord[] }> | null | undefined, zone: DnsRecord[]): boolean {
  const exact = (steps || []).flatMap((s) => applyableRecords(Array.isArray(s.records) ? s.records : []).apply);
  return exact.length > 0 && exact.every((r) => recordAnswers(r, zone));
}

const SYSTEM: Principal = { kind: 'system', userId: null, tenantId: null, role: null, email: null, jwt: null, requestId: 'plan-found' };

/** Close every approved record plan on this site whose records now answer. `bare` is the domain
 *  without "www."; the zone is read here only when there is a plan to check and none was
 *  passed in. Returns the ids it closed. Never throws. */
export async function clearFoundPlans(siteId: string, bare: string, nowIso: string, zone?: ZoneSnapshot | null): Promise<string[]> {
  const done: string[] = [];
  try {
    const q = await svc(`presence_infra_plans?site_id=eq.${siteId}&status=eq.approved&kind=in.(${RECORD_PLAN_KINDS.join(',')})&select=id,kind,title,steps&limit=20`);
    const plans = (Array.isArray(q.json) ? q.json : []) as Array<{ id: string; kind: string; title: string; steps: Array<{ records?: DnsRecord[]; done?: boolean }> }>;
    if (!plans.length) return done;
    const z = zone || await readZone(bare, nowIso);
    const mail = emailFacts(z.records, bare);
    for (const p of plans) {
      // email protection is also done when both records answer, whoever's wording they carry
      const found = planRecordsFound(p.steps, z.records) || (p.kind === 'email_auth' && mail.hasSpf && mail.hasDmarc);
      if (!found) continue;
      const w = await svc(`presence_infra_plans?id=eq.${p.id}&site_id=eq.${siteId}&status=eq.approved&select=id`, {
        method: 'PATCH', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ status: 'applied', applied_at: nowIso, steps: (p.steps || []).map((s) => ({ ...s, done: true })) }),
      });
      if (!w.ok || !Array.isArray(w.json) || !w.json[0]) continue;   // someone else closed it first
      done.push(p.id);
      await writeChangeEvent({ siteId, entityType: 'settings', entityId: null, action: 'update', summary: `Finished by itself, its records were found: ${p.title}`, principal: SYSTEM, fields: ['infra_plan'] }).catch(() => null);
    }
  } catch { /* best-effort: the plan stays approved and the next check tries again */ }
  return done;
}
