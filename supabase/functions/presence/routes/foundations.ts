// ── Platform Services routes (M12) — the foundations surface ────────────────
//   GET  /foundations                     — domain, DNS, SSL, email, hosting: plain words
//   POST /foundations/prepare             — {goal, params?} → an Infrastructure Change Plan
//   GET  /foundations/plans               — proposed/approved/applied plans
//   POST /foundations/plans/:id/decide    — {decision: approve|abandon}
//   POST /foundations/plans/:id/done      — the studio marks an approved plan finished
// The customer manages their presence; Studio OS manages the complexity.
// Nothing here performs an infrastructure action: plans are prepared and
// decided; automated steps are applied by the OPERATOR route (admin) using
// provider capabilities, and only on approved plans.
import { json } from '../../_shared/http.ts';
import { registrarTip, providerGuide } from '../lib/rdap.ts';
import { getSite } from '../lib/netlify.ts';
import { svc, type SiteDb } from '../lib/db.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import { readZone, bareDomain } from '../platform/dns.ts';
import { explainRecord } from '../platform/dns.ts';
import { planConnectDomain, planEmailAuth, planRegistrarCare, planHostingRestore } from '../platform/plans.ts';
import { planMigration } from '../platform/migration.ts';
import { planTransferIn, planTransferOut } from '../platform/transfer.ts';
import { planEmailSetup, emailFacts } from '../platform/email_providers.ts';
import { clearFoundPlans } from '../platform/plan_found.ts';
import { diffZones, planDnsRepair } from '../platform/zone.ts';
import { registrarFor, hostFor, dnsFor } from '../platform/contract.ts';
import { applyRecords, applyableRecords, mergeDesired } from '../platform/managed_dns.ts';
import { findHostedZone } from '../lib/route53.ts';
import type { DnsRecord } from '../platform/dns.ts';
import { decidePlan, claimApprovedPlan, releaseApprovedPlanClaim } from '../lib/approved_plan.ts';
import { notifyOwnerOfReviewerDecision } from '../lib/notice.ts';
import type { InfraPlan } from '../platform/plans.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const PLAN_SELECT = 'id,kind,title,summary,steps,risk,reversible,rollback_note,requires_approval,status,extra,decided_at,applied_at,created_at';

/** The domain this site lives on (custom domain, or the verified monitor domain). */
async function siteDomain(site: SiteRow): Promise<string | null> {
  if (site.custom_domain) return site.custom_domain;
  const c = await svc(`presence_monitor_connections?site_id=eq.${site.id}&status=eq.verified&select=domain&limit=1`);
  return c.json?.[0]?.domain ?? null;
}

/** A date the way a person writes it: February 12, 2027 (Nov 12 review, finding 18: the sheet
 *  showed 2027-02-12). Empty when there is none to show. */
export function plainDate(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';
}

export async function handleFoundationsGet(site: SiteRow, cors: Record<string, string>) {
  const now = new Date().toISOString();
  const domain = await siteDomain(site);
  // Nov 12 review, finding 15: the records and the email check are read on the bare name. With
  // "www." as the main name the read used to ask about www.x.com, where mail never lives.
  const bare = domain ? bareDomain(domain) : null;
  const zone = bare ? await readZone(bare, now) : null;
  // Nov 12 review, finding 25: one picture of the records a day. Every open used to save a row,
  // and nothing ever cleared them.
  if (zone) {
    const today = await svc(`presence_zone_snapshots?site_id=eq.${site.id}&taken_at=gte.${now.slice(0, 10)}T00:00:00Z&select=id&limit=1`).catch(() => null);
    const have = !!(today && today.ok && Array.isArray(today.json) && today.json.length);
    if (!have && today && today.ok) {
      await svc('presence_zone_snapshots', { method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ site_id: site.id, domain: zone.domain, records: zone.records, taken_at: now }) });
    }
  }
  const host = hostFor('netlify');
  const ssl = site.netlify_site_id ? await host.ssl(site.netlify_site_id) : null;
  const mail = emailFacts(zone?.records ?? [], bare || '');
  const spf = mail.hasSpf, dmarc = mail.hasDmarc;
  // finding 13: an approved plan whose records now answer is finished, here and at the daily check
  const cleared = zone && bare ? await clearFoundPlans(site.id, bare, now, zone) : [];

  return json({ data: {
    domain: domain ? {
      name: domain,
      sentence: await (async () => {
        const dQ = await svc(`presence_sites?id=eq.${site.id}&select=domain_registrar,domain_expires_at&limit=1`);
        const reg = String(dQ.json?.[0]?.domain_registrar || '');
        const exp = dQ.json?.[0]?.domain_expires_at ? new Date(dQ.json[0].domain_expires_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '';
        const tip = registrarTip(reg);
        return `Your address is ${domain}${reg ? `, registered at ${reg}` : ''}${exp ? ` — renews ${exp}` : ''}. Keeping auto-renew on is the one thing that matters.${tip ? ' ' + tip : ''}`;
      })(),
    } : { name: null, sentence: 'No custom domain yet — the site answers on its included address. A domain of your own can be connected any time.' },
    dns: zone ? {
      record_count: zone.records.length,
      records: zone.records.map((r) => ({ ...r, plain: explainRecord(r) })),
      sentence: `${zone.records.length} records answer for ${bare} right now, each said below in plain words. Changes always arrive as steps you approve first.`,
    } : { record_count: 0, records: [], sentence: 'Nothing to read yet. The domain’s records show here once a domain is connected.' },
    ssl: ssl ? {
      state: ssl.state,
      sentence: ssl.state === 'issued' || ssl.state === 'renewed'
        ? `The padlock is on${plainDate(ssl.expires_at) ? ` and renews itself before ${plainDate(ssl.expires_at)}` : ' and renews itself'}. Nothing for you to do.`
        : 'The padlock is being switched on. It comes by itself once the domain’s records point here.',
    } : { state: 'n/a', sentence: site.edition === 'monitor' ? 'The company that hosts your site looks after the padlock. We check it stays on.' : 'The padlock comes by itself once your site is set up here.' },
    email: {
      has_mail: mail.hasMail, spf, dmarc,
      // finding 14: who runs the email, so the protection offered is that company's
      provider: mail.provider ? mail.provider.name : null,
      // finding 23: the card names the missing record
      missing: !mail.hasMail ? [] : [...(spf ? [] : ['sender']), ...(dmarc ? [] : ['fakes'])],
      sentence: !mail.hasMail ? 'No email runs on this domain, so there is nothing to protect.'
        : spf && dmarc ? 'Email from your domain is protected. Inboxes can trust it.'
        : !spf && !dmarc ? 'Email runs on this domain, and two records are missing: the one that lists who may send as you, and the one that tells inboxes what to do with fakes.'
        : !spf ? 'Email runs on this domain, and one record is missing: the one that lists who may send as you.'
        : 'Email runs on this domain, and one record is missing: the one that tells inboxes what to do with fakes.',
    },
    hosting: {
      managed: !!site.netlify_site_id,
      sentence: site.netlify_site_id
        ? 'Your site is hosted here. Every published version is kept, and any of them can be put back.'
        : site.edition === 'monitor'
          ? 'Your website stays where it is hosted now. We watch it and tell you what we find.'
          : 'Your site is hosted here once it is set up.',
    },
    cleared_plans: cleared,
  } }, 200, cors);
}

export async function handleFoundationsPrepare(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  let body: { goal?: string; deploy_id?: string; deploy_title?: string; provider?: string; preview?: boolean } = {};
  try { body = await req.json(); } catch { return json({ error: 'bad_json', message: 'That didn’t read right.' }, 400, cors); }
  const domain = await siteDomain(site);
  const now = new Date().toISOString();
  let plan: InfraPlan;
  let extra: Record<string, unknown> = {};
  let zoneNow: Awaited<ReturnType<typeof readZone>> | null = null;
  try {
    if (body.goal === 'connect_domain') {
      if (!domain) return json({ error: 'no_domain', message: 'Tell us the domain first — it can be set with your studio.' }, 400, cors);
      // item 162: the site's own address, so the www record is the real one, not a placeholder
      const nf = site.netlify_site_id ? await getSite(site.netlify_site_id).catch(() => null) : null;
      plan = planConnectDomain(domain, nf && nf.ok && nf.site ? nf.site.default_domain : null);
    } else if (body.goal === 'email_auth') {
      if (!domain) return json({ error: 'no_domain', message: 'Email protection needs a domain first.' }, 400, cors);
      // Nov 12 review, findings 14 and 15: read who runs the email on the bare name, give that
      // company's records, and only the ones that are missing
      const bare = bareDomain(domain);
      zoneNow = await readZone(bare, now);
      const mail = emailFacts(zoneNow.records, bare);
      if (!mail.hasMail) return json({ error: 'no_mail', message: 'We couldn’t find email on this domain just now. If it has email, try again in a minute.' }, 409, cors);
      if (mail.hasSpf && mail.hasDmarc) return json({ error: 'already_protected', message: 'Both records are already there. Email from this domain is protected.' }, 409, cors);
      plan = planEmailAuth(bare, mail);
      extra = { email_provider: mail.provider ? mail.provider.slug : null };
    } else if (body.goal === 'registrar_care') {
      if (!domain) return json({ error: 'no_domain', message: 'Domain care needs a domain first.' }, 400, cors);
      const reg = registrarFor('manual');
      // item 162 (review domains finding 8): the seller by name, its sign-in page and where the switch is
      const sold = await svc(`presence_sites?id=eq.${site.id}&select=domain_registrar&limit=1`).then((r) => String((Array.isArray(r.json) && (r.json[0] as { domain_registrar?: string } | undefined)?.domain_registrar) || '')).catch(() => '');
      const g = providerGuide(sold);
      plan = planRegistrarCare(domain, (a, d) => g && a === 'auto_renew' ? [`Sign in to ${g.company} (${g.sign_in}) and turn on auto-renew for ${d}: it’s under ${g.renewal}.`]
        : g && a === 'whois_privacy' ? [`While you’re signed in to ${g.company}, turn on privacy for ${d} so your home address isn’t public.`]
        : reg.guide(a, d));
    } else if (body.goal === 'hosting_restore') {
      if (!site.netlify_site_id || !body.deploy_id) return json({ error: 'bad_request', message: 'A previous version to restore is needed.' }, 400, cors);
      plan = planHostingRestore(body.deploy_id, body.deploy_title || 'a previous version');
    } else if (body.goal === 'transfer_in' || body.goal === 'transfer_out') {
      if (!domain) return json({ error: 'no_domain', message: 'A domain transfer needs a domain first.' }, 400, cors);
      plan = body.goal === 'transfer_in' ? planTransferIn(domain) : planTransferOut(domain);
    } else if (body.goal === 'email_setup') {
      if (!domain) return json({ error: 'no_domain', message: 'Email setup needs a domain first.' }, 400, cors);
      plan = planEmailSetup(bareDomain(domain), String(body.provider || 'other'));   // finding 15: mail lives on the bare name
    } else if (body.goal === 'dns_repair') {
      if (!domain) return json({ error: 'no_domain', message: 'DNS repair needs a domain first.' }, 400, cors);
      const [zQ, observed] = await Promise.all([
        svc(`presence_dns_zones?site_id=eq.${site.id}&select=records&limit=1`),
        readZone(domain, now),
      ]);
      const drift = diffZones(zQ.json?.[0]?.records ?? [], observed.records);
      if (!drift.missing.length) return json({ error: 'no_drift', message: 'Reality already matches what you decided — nothing to repair.' }, 409, cors);
      plan = planDnsRepair(domain, drift);
    } else if (body.goal === 'migration') {
      const c = await svc(`presence_monitor_connections?site_id=eq.${site.id}&status=eq.verified&select=domain,readiness&limit=1`);
      const conn = c.json?.[0];
      if (!conn?.readiness?.pages) return json({ error: 'not_ready', message: 'Run the migration look-over first — it feeds the plan.' }, 409, cors);
      const mp = planMigration(conn.readiness, conn.domain);
      extra = { content_mapping: mp.content_mapping, redirects: mp.redirects, launch_checks: mp.launch_checks, post_launch_qa: mp.post_launch_qa };
      plan = mp;
    } else {
      return json({ error: 'bad_goal', message: 'That isn’t something we have steps for yet.' }, 400, cors);
    }
  } catch (e) {
    return json({ error: 'plan_failed', message: (e as Error)?.message?.slice(0, 200) || 'The plan couldn’t be prepared.' }, 502, cors);
  }

  // item 162: the studio's Domains panel reads the steps before sending them; a preview saves nothing
  if (body.preview === true) return json({ data: { ...plan, preview: true } }, 200, cors);
  // the rollback reference: the zone as it stands at proposal time
  // Nov 12 review, finding 13: the same plan can't be made twice. Each press of "Set up email
  // protection" used to add another; an open one is handed back instead.
  const openQ = await svc(`presence_infra_plans?site_id=eq.${site.id}&kind=eq.${plan.kind}&status=in.(proposed,approved)&select=${PLAN_SELECT}&order=created_at.desc&limit=10`);
  const open = (Array.isArray(openQ.json) ? openQ.json as Array<{ title?: string }> : []).find((p) => p && p.title === plan.title);
  if (open) return json({ data: { ...open, already: true } }, 200, cors);
  const prior = zoneNow || (domain ? await readZone(bareDomain(domain), now) : null);
  const ins = await svc(`presence_infra_plans?select=${PLAN_SELECT}`, {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      site_id: site.id, kind: plan.kind, title: plan.title, summary: plan.summary,
      steps: plan.steps, risk: plan.risk, reversible: plan.reversible, rollback_note: plan.rollback_note,
      prior_state: prior ? { zone: prior } : {}, extra,
    }),
  });
  if (!ins.ok || !ins.json?.[0]) return json({ error: 'write_failed', message: 'The plan didn’t save — nothing was changed.' }, 502, cors);
  await writeChangeEvent({ siteId: site.id, entityType: 'settings', entityId: null, action: 'create', summary: `Prepared a plan: ${plan.title}`, principal, provenance: 'human', fields: ['infra_plan'] });
  return json({ data: ins.json[0] }, 200, cors);
}

export async function handleFoundationsPlans(db: SiteDb, site: SiteRow, cors: Record<string, string>) {
  const r = await db(`presence_infra_plans?site_id=eq.${site.id}&select=${PLAN_SELECT}&order=created_at.desc&limit=20`);
  if (!r.ok) return json({ error: 'read_failed', message: 'We couldn’t open the plans just now.' }, 502, cors);
  return json({ data: r.json ?? [] }, 200, cors);
}

export async function handleFoundationsDecide(req: Request, site: SiteRow, planId: string, principal: Principal, cors: Record<string, string>) {
  let body: { decision?: string } = {};
  try { body = await req.json(); } catch { /* below */ }
  const decision = decidePlan(body?.decision || '');   // shared spine transition
  if (!decision) return json({ error: 'bad_request', message: 'Decide with approve or abandon.' }, 400, cors);
  const w = await svc(`presence_infra_plans?id=eq.${planId}&site_id=eq.${site.id}&status=eq.proposed&select=id,title`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: decision, decided_at: new Date().toISOString() }),
  });
  if (!w.ok || !w.json?.[0]) return json({ error: 'not_found', message: 'That plan isn’t open for a decision.' }, 404, cors);
  await writeChangeEvent({ siteId: site.id, entityType: 'settings', entityId: null, action: 'update', summary: `${decision === 'approved' ? 'Approved' : 'Set aside'} the plan: ${w.json[0].title}`, principal, provenance: 'human', fields: ['infra_plan'] });
  await notifyOwnerOfReviewerDecision(site, principal, `${decision === 'approved' ? 'Approved' : 'Passed on'}: ${w.json[0].title}`, `plan:${planId}`);
  return json({ data: { id: planId, status: decision } }, 200, cors);
}

/** POST /foundations/plans/:id/done (Nov 12 review, finding 13): the studio marks an approved
 *  plan finished. Home said "Apply" and opened a sheet with no such button; the only route
 *  that finished a plan sat on the staff-only admin path, called by no page. The studio is a
 *  member working inside the client's site, or platform staff; the approval law in applyPlan
 *  still refuses anything not approved. */
export async function handleFoundationsPlanDone(site: SiteRow, planId: string, principal: Principal, cors: Record<string, string>) {
  if (!(principal.scope || principal.kind === 'staff')) {
    return json({ error: 'studio_only', message: 'Your studio marks this done. It also closes by itself once its records are found.' }, 403, cors);
  }
  return applyPlan(site, planId, principal, cors);
}

/** OPERATOR-ONLY (called from admin router, and by the studio's "Mark as done" above): apply an APPROVED plan's
 *  automated steps through provider capabilities; guided steps are marked
 *  done by the human who performed them. The approval law is enforced here:
 *  a plan that isn't approved cannot be applied, ever. */
export async function applyPlan(site: SiteRow, planId: string, principal: Principal, cors: Record<string, string>) {
  const q = await svc(`presence_infra_plans?id=eq.${planId}&site_id=eq.${site.id}&select=id,kind,title,steps,status&limit=1`);
  const plan = q.json?.[0];
  if (!plan) return json({ error: 'not_found', message: 'No such plan.' }, 404, cors);
  if (plan.status !== 'approved') {
    return json({ error: 'not_approved', message: 'Plans apply only after explicit approval — that is a law, not a setting.' }, 409, cors);
  }
  // L4.5: the SHARED atomic claim (lib/approved_plan.ts) — the same guarantee the
  // connected write executor uses. Only one caller applies an approved plan; a
  // concurrent apply is refused; an interrupted apply self-recovers after the
  // staleness window. Released on every non-success exit so retry stays immediate.
  const claimed = await claimApprovedPlan({ table: 'presence_infra_plans', id: planId, siteId: site.id, claimColumn: 'applied_at', select: 'id' });
  if (!claimed) return json({ error: 'in_progress', message: 'This plan is already being applied — nothing is done twice.' }, 409, cors);
  const release = () => releaseApprovedPlanClaim('presence_infra_plans', planId, 'applied_at');
  const host = hostFor('netlify');
  const steps = plan.steps as Array<{ what: string; automated: boolean; done: boolean; records?: DnsRecord[] }>;
  const notes: string[] = [];

  // ── D1: when the automatic DNS adapter is active AND this domain's zone is
  // managed here, a plan's record-carrying steps are APPLIED, not instructed.
  // The approval machinery above is untouched — this only changes who types.
  // Guided stays guided when: secrets absent, no managed zone, or a record is
  // a placeholder (DKIM keys are never invented). Dormant = today's behavior.
  const DNS_PLAN_KINDS = new Set(['connect_domain', 'email_auth', 'email_setup', 'dns_repair']);
  let dnsZoneId: string | null = null;
  let planDomain: string | null = null;
  if (dnsFor().capabilities.write === 'automatic' && DNS_PLAN_KINDS.has(plan.kind)) {
    planDomain = await siteDomain(site);
    if (planDomain) {
      const z = await findHostedZone(planDomain);
      dnsZoneId = z.ok && z.zone ? z.zone.id : null;
    }
  }
  const appliedDns: DnsRecord[] = [];

  for (const s of steps) {
    if (!s.automated && dnsZoneId && Array.isArray(s.records) && s.records.length) {
      const { apply, stillGuided } = applyableRecords(s.records);
      if (apply.length) {
        const r = await applyRecords(dnsZoneId, apply, `Studio OS plan: ${String(plan.title).slice(0, 60)}`);
        if (!r.ok) { await release(); return json({ error: 'apply_failed', message: `The DNS records couldn’t be written: ${r.error || 'provider error'} — the plan stays approved; nothing was half-done.` }, 502, cors); }
        appliedDns.push(...apply);
        s.done = true;
        notes.push(`applied ${apply.length} DNS record${apply.length === 1 ? '' : 's'} through managed DNS${r.merged.length ? ' (SPF merged, not appended)' : ''}${stillGuided.length ? `; ${stillGuided.length} still guided (provider-issued values)` : ''}`);
        continue;
      }
    }
    if (!s.automated) { s.done = true; notes.push(`guided (performed by operator/customer): ${s.what.slice(0, 80)}`); continue; }
    if (plan.kind === 'hosting_restore' && /^Restore deploy/.test(s.what) && site.netlify_site_id) {
      const dep = s.what.match(/deploy ([a-z0-9]+)…/i)?.[1];
      const full = dep ? (await host.deploys(site.netlify_site_id)).deploys.find((d) => d.id.startsWith(dep)) : null;
      if (!full) { await release(); return json({ error: 'apply_failed', message: 'The deploy to restore wasn’t found in history.' }, 409, cors); }
      const r = await host.restore(site.netlify_site_id, full.id);
      if (!r.ok) { await release(); return json({ error: 'apply_failed', message: `Restore failed: ${r.error || 'unknown'} — the plan stays approved; nothing was half-done.` }, 502, cors); }
      s.done = true; notes.push('restored via hosting provider');
    } else {
      // verification-class automated steps: the evidence pipeline is the verifier
      s.done = true; notes.push(`verification scheduled through the observation run: ${s.what.slice(0, 60)}`);
    }
  }
  // write-through: records the plan applied become part of the desired-zone
  // document, so the existing drift machinery keeps observing them — unchanged.
  if (appliedDns.length && planDomain) {
    const zQ = await svc(`presence_dns_zones?site_id=eq.${site.id}&select=records&limit=1`);
    const merged = mergeDesired(zQ.json?.[0]?.records ?? [], appliedDns, 'platform');
    await svc(`presence_dns_zones?on_conflict=site_id`, {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ site_id: site.id, domain: planDomain, records: merged }),
    });
    await svc('presence_dns_zone_history', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ site_id: site.id, records: merged, note: `plan applied: ${String(plan.title).slice(0, 160)}` }) });
  }
  await svc(`presence_infra_plans?id=eq.${planId}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'applied', steps, applied_at: new Date().toISOString() }),
  });
  await writeChangeEvent({ siteId: site.id, entityType: 'settings', entityId: null, action: 'update', summary: `Applied the plan: ${plan.title}`, principal, provenance: 'human', fields: ['infra_plan'] });
  return json({ data: { id: planId, status: 'applied', notes } }, 200, cors);
}
