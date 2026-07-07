// ── Platform Services routes (M12) — the foundations surface ────────────────
//   GET  /foundations                     — domain, DNS, SSL, email, hosting: plain words
//   POST /foundations/prepare             — {goal, params?} → an Infrastructure Change Plan
//   GET  /foundations/plans               — proposed/approved/applied plans
//   POST /foundations/plans/:id/decide    — {decision: approve|abandon}
// The customer manages their presence; Studio OS manages the complexity.
// Nothing here performs an infrastructure action: plans are prepared and
// decided; automated steps are applied by the OPERATOR route (admin) using
// provider capabilities, and only on approved plans.
import { json } from '../../_shared/http.ts';
import { asUser, svc } from '../lib/db.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import { readZone } from '../platform/dns.ts';
import { explainRecord } from '../platform/dns.ts';
import { planConnectDomain, planEmailAuth, planRegistrarCare, planHostingRestore } from '../platform/plans.ts';
import { planMigration } from '../platform/migration.ts';
import { registrarFor, hostFor } from '../platform/contract.ts';
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

export async function handleFoundationsGet(site: SiteRow, cors: Record<string, string>) {
  const now = new Date().toISOString();
  const domain = await siteDomain(site);
  const zone = domain ? await readZone(domain, now) : null;
  if (zone) {
    await svc('presence_zone_snapshots', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ site_id: site.id, domain: zone.domain, records: zone.records, taken_at: now }) });
  }
  const host = hostFor('netlify');
  const ssl = site.netlify_site_id ? await host.ssl(site.netlify_site_id) : null;
  const mx = zone?.records.filter((r) => r.type === 'MX') ?? [];
  const spf = zone?.records.some((r) => r.type === 'TXT' && r.value.startsWith('v=spf1')) ?? false;
  const dmarc = zone?.records.some((r) => r.name.startsWith('_dmarc')) ?? false;

  return json({ data: {
    domain: domain ? {
      name: domain,
      sentence: `Your address is ${domain}. The name itself lives at your registrar; keeping auto-renew on is the one thing that matters.`,
    } : { name: null, sentence: 'No custom domain yet — the site answers on its included address. A domain of your own can be connected any time.' },
    dns: zone ? {
      record_count: zone.records.length,
      records: zone.records.map((r) => ({ ...r, plain: explainRecord(r) })),
      sentence: `${zone.records.length} records answer for ${domain} right now — each explained below in plain words. Changes always arrive as a plan you approve first.`,
    } : { record_count: 0, records: [], sentence: 'Nothing to read yet — DNS appears here once a domain is connected.' },
    ssl: ssl ? {
      state: ssl.state,
      sentence: ssl.state === 'issued' || ssl.state === 'renewed'
        ? `The security certificate is healthy${ssl.expires_at ? ` and renews itself before ${ssl.expires_at.slice(0, 10)}` : ' and renews itself automatically'}. Nothing for you to do — ever.`
        : 'The security certificate is being arranged — this settles on its own once the domain answers.',
    } : { state: 'n/a', sentence: site.edition === 'monitor' ? 'Your current host manages the certificate; the observer checks it stays healthy.' : 'Certificates are provisioned automatically when hosting attaches.' },
    email: {
      has_mail: mx.length > 0, spf, dmarc,
      sentence: mx.length === 0 ? 'No email runs on this domain — nothing to protect.'
        : spf && dmarc ? 'Email from your domain is authenticated — inboxes can trust it.'
        : 'Email runs on this domain but isn’t fully protected yet — a small plan fixes that.',
    },
    hosting: {
      managed: !!site.netlify_site_id,
      sentence: site.netlify_site_id
        ? 'Hosting, the CDN, deploys, backups, and restores are managed here — every published version is kept and restorable.'
        : site.edition === 'monitor'
          ? 'Your website stays on its current hosting; the platform observes it and prepares guidance. Managed hosting comes with an upgrade, whenever you want it.'
          : 'Hosting attaches when the site is provisioned.',
    },
  } }, 200, cors);
}

export async function handleFoundationsPrepare(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  let body: { goal?: string; deploy_id?: string; deploy_title?: string } = {};
  try { body = await req.json(); } catch { return json({ error: 'bad_json', message: 'That didn’t read right.' }, 400, cors); }
  const domain = await siteDomain(site);
  const now = new Date().toISOString();
  let plan: InfraPlan;
  let extra: Record<string, unknown> = {};
  try {
    if (body.goal === 'connect_domain') {
      if (!domain) return json({ error: 'no_domain', message: 'Tell us the domain first — it can be set with your studio.' }, 400, cors);
      plan = planConnectDomain(domain, null);
    } else if (body.goal === 'email_auth') {
      if (!domain) return json({ error: 'no_domain', message: 'Email protection needs a domain first.' }, 400, cors);
      plan = planEmailAuth(domain);
    } else if (body.goal === 'registrar_care') {
      if (!domain) return json({ error: 'no_domain', message: 'Domain care needs a domain first.' }, 400, cors);
      const reg = registrarFor('manual');
      plan = planRegistrarCare(domain, (a, d) => reg.guide(a, d));
    } else if (body.goal === 'hosting_restore') {
      if (!site.netlify_site_id || !body.deploy_id) return json({ error: 'bad_request', message: 'A previous version to restore is needed.' }, 400, cors);
      plan = planHostingRestore(body.deploy_id, body.deploy_title || 'a previous version');
    } else if (body.goal === 'migration') {
      const c = await svc(`presence_monitor_connections?site_id=eq.${site.id}&status=eq.verified&select=domain,readiness&limit=1`);
      const conn = c.json?.[0];
      if (!conn?.readiness?.pages) return json({ error: 'not_ready', message: 'Run the migration look-over first — it feeds the plan.' }, 409, cors);
      const mp = planMigration(conn.readiness, conn.domain);
      extra = { content_mapping: mp.content_mapping, redirects: mp.redirects, launch_checks: mp.launch_checks, post_launch_qa: mp.post_launch_qa };
      plan = mp;
    } else {
      return json({ error: 'bad_goal', message: 'Plans exist for: connect_domain, email_auth, registrar_care, hosting_restore, migration.' }, 400, cors);
    }
  } catch (e) {
    return json({ error: 'plan_failed', message: (e as Error)?.message?.slice(0, 200) || 'The plan couldn’t be prepared.' }, 502, cors);
  }

  // the rollback reference: the zone as it stands at proposal time
  const prior = domain ? await readZone(domain, now) : null;
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

export async function handleFoundationsPlans(jwt: string, site: SiteRow, cors: Record<string, string>) {
  const r = await asUser(jwt, `presence_infra_plans?site_id=eq.${site.id}&select=${PLAN_SELECT}&order=created_at.desc&limit=20`);
  if (!r.ok) return json({ error: 'read_failed', message: 'We couldn’t open the plans just now.' }, 502, cors);
  return json({ data: r.json ?? [] }, 200, cors);
}

export async function handleFoundationsDecide(req: Request, site: SiteRow, planId: string, principal: Principal, cors: Record<string, string>) {
  let body: { decision?: string } = {};
  try { body = await req.json(); } catch { /* below */ }
  const decision = body?.decision === 'approve' ? 'approved' : body?.decision === 'abandon' ? 'abandoned' : null;
  if (!decision) return json({ error: 'bad_request', message: 'Decide with approve or abandon.' }, 400, cors);
  const w = await svc(`presence_infra_plans?id=eq.${planId}&site_id=eq.${site.id}&status=eq.proposed&select=id,title`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: decision, decided_at: new Date().toISOString() }),
  });
  if (!w.ok || !w.json?.[0]) return json({ error: 'not_found', message: 'That plan isn’t open for a decision.' }, 404, cors);
  await writeChangeEvent({ siteId: site.id, entityType: 'settings', entityId: null, action: 'update', summary: `${decision === 'approved' ? 'Approved' : 'Set aside'} the plan: ${w.json[0].title}`, principal, provenance: 'human', fields: ['infra_plan'] });
  return json({ data: { id: planId, status: decision } }, 200, cors);
}

/** OPERATOR-ONLY (called from admin router): apply an APPROVED plan's
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
  const host = hostFor('netlify');
  const steps = plan.steps as Array<{ what: string; automated: boolean; done: boolean }>;
  const notes: string[] = [];
  for (const s of steps) {
    if (!s.automated) { s.done = true; notes.push(`guided (performed by operator/customer): ${s.what.slice(0, 80)}`); continue; }
    if (plan.kind === 'hosting_restore' && /^Restore deploy/.test(s.what) && site.netlify_site_id) {
      const dep = s.what.match(/deploy ([a-z0-9]+)…/i)?.[1];
      const full = dep ? (await host.deploys(site.netlify_site_id)).deploys.find((d) => d.id.startsWith(dep)) : null;
      if (!full) return json({ error: 'apply_failed', message: 'The deploy to restore wasn’t found in history.' }, 409, cors);
      const r = await host.restore(site.netlify_site_id, full.id);
      if (!r.ok) return json({ error: 'apply_failed', message: `Restore failed: ${r.error || 'unknown'} — the plan stays approved; nothing was half-done.` }, 502, cors);
      s.done = true; notes.push('restored via hosting provider');
    } else {
      // verification-class automated steps: the evidence pipeline is the verifier
      s.done = true; notes.push(`verification scheduled through the observation run: ${s.what.slice(0, 60)}`);
    }
  }
  await svc(`presence_infra_plans?id=eq.${planId}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'applied', steps, applied_at: new Date().toISOString() }),
  });
  await writeChangeEvent({ siteId: site.id, entityType: 'settings', entityId: null, action: 'update', summary: `Applied the plan: ${plan.title}`, principal, provenance: 'human', fields: ['infra_plan'] });
  return json({ data: { id: planId, status: 'applied', notes } }, 200, cors);
}
