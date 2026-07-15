// ── L1 · Self-serve provisioning — service role, idempotent ─────────────────
// Turns a paid/trial signup into a working workspace with NO operator action.
// Idempotent end to end: rerunning (webhook re-delivery, a resumed signup)
// repairs a partial run and never duplicates — the unique(client_id) guard on
// presence_sites and merge-duplicates on the entitlement do the deduping.
//
// Reuses the same Netlify lib the operator provisioner uses (no second hosting
// path). The two differences from operator provisioning are deliberate:
//   • edition is set explicitly (Monitor sites host NOTHING — no Netlify).
//   • the entitlement carries the plan + billing state (operator sets status only).
// Everything else (site get-or-create, identity seed, status→ready, provenance)
// follows the established shape.

import { svc } from '../lib/db.ts';
import { createSite, getSite, netlifyConfigured } from '../lib/netlify.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import { TENANT_ID } from '../../_shared/auth.ts';
import type { Principal } from '../../_shared/auth.ts';
import { editionFor } from './catalog.ts';
import type { PlanKey } from './catalog.ts';
import type { EntitlementPatch } from './subscriptions.ts';

const SITE_COLS = 'id,client_id,status,last_published_at,template_slug,template_version,custom_domain,netlify_site_id,edition';

export interface ProvisionResult {
  ok: boolean;
  siteId?: string;
  edition?: 'monitor' | 'presence';
  hosted?: boolean;
  netlifyUrl?: string | null;
  error?: string;
}

function systemPrincipal(email: string | null): Principal {
  return { kind: 'system', userId: null, tenantId: TENANT_ID, role: null, email, jwt: null, requestId: 'commerce-provision' };
}

// Apply the entitlement (plan + billing state). Always upserts on
// (client_id, product); only defined patch keys are written so a partial
// patch never nulls a good column.
async function upsertEntitlement(clientId: string, plan: PlanKey, patch: EntitlementPatch): Promise<boolean> {
  const body: Record<string, unknown> = { client_id: clientId, product: 'presence', plan, status: patch.status };
  const carry: (keyof EntitlementPatch)[] = [
    'term', 'founder', 'trial_ends_at', 'stripe_customer_id', 'stripe_subscription_id',
    'current_period_end', 'cancel_at_period_end', 'canceled_at', 'grace_until',
  ];
  for (const k of carry) if (patch[k] !== undefined) body[k] = patch[k] as unknown;
  const r = await svc('presence_entitlements?on_conflict=client_id,product', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify(body),
  });
  return r.ok;
}

export async function provisionForSignup(opts: {
  clientId: string;
  businessName: string;
  plan: PlanKey;
  patch: EntitlementPatch;
  actorEmail?: string | null;
  skipHosting?: boolean;   // an agency's own workspace: full edition, no hosting attach (connect later)
}): Promise<ProvisionResult> {
  const { clientId, plan, patch } = opts;
  const edition = editionFor(plan);
  const needsHosting = edition === 'presence' && !opts.skipHosting;

  // 1) entitlement (plan + billing) — the gate the whole platform reads
  if (!(await upsertEntitlement(clientId, plan, patch))) {
    return { ok: false, error: 'entitlement_failed' };
  }

  // 2) site row get-or-create with edition set
  let site = (await svc(`presence_sites?client_id=eq.${clientId}&select=${SITE_COLS}&limit=1`)).json?.[0];
  let created = false;
  if (site && site.status === 'deleting') return { ok: false, error: 'site_deleting' };
  if (!site) {
    const ins = await svc('presence_sites', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ client_id: clientId, edition, status: 'provisioning' }),
    });
    if (ins.status === 409) {
      site = (await svc(`presence_sites?client_id=eq.${clientId}&select=${SITE_COLS}&limit=1`)).json?.[0];
    } else if (!ins.ok || !ins.json?.[0]) {
      return { ok: false, error: 'site_create_failed' };
    } else { site = ins.json[0]; created = true; }
  }
  if (!site) return { ok: false, error: 'site_create_failed' };

  // keep edition in sync with the plan (an upgrade Monitor→Presence flips it)
  if (site.edition !== edition) {
    await svc(`presence_sites?id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ edition }) });
    site.edition = edition;
  }

  // 3) hosting — Presence editions only; Monitor never hosts anything
  let netlifyUrl: string | null = null;
  if (needsHosting) {
    if (!netlifyConfigured()) return { ok: false, error: 'hosting_unconfigured' };
    const desiredName = `presence-${String(site.id).replace(/-/g, '').slice(0, 12)}`;
    let netlifyId = site.netlify_site_id as string | null;
    if (netlifyId) {
      const found = await getSite(netlifyId);
      if (!found.ok && found.status === 404) netlifyId = null;
      else if (!found.ok) return { ok: false, error: 'hosting_lookup_failed' };
    }
    if (!netlifyId) {
      const made = await createSite(desiredName);
      if (made.ok && made.site) netlifyId = made.site.id;
      else if (made.status === 422) {
        const adopt = await getSite(`${desiredName}.netlify.app`);
        if (adopt.ok && adopt.site) netlifyId = adopt.site.id;
        else return { ok: false, error: 'hosting_name_taken' };
      } else return { ok: false, error: 'hosting_create_failed' };
      await svc(`presence_sites?id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ netlify_site_id: netlifyId }) });
    }
    const verify = await getSite(netlifyId!);
    if (!verify.ok || !verify.site) return { ok: false, error: 'hosting_verify_failed' };
    netlifyUrl = `https://${verify.site.default_domain}`;
  }

  // 4) seed the starter records the room expects (all create-only, idempotent)
  const haveIdentity = await svc(`presence_identity?site_id=eq.${site.id}&select=site_id&limit=1`);
  if (!Array.isArray(haveIdentity.json) || haveIdentity.json.length === 0) {
    await svc('presence_identity', { method: 'POST', body: JSON.stringify({ site_id: site.id, business_name: String(opts.businessName || '').slice(0, 120) }) });
  }
  const haveBrand = await svc(`presence_brand_profile?site_id=eq.${site.id}&select=site_id&limit=1`);
  if (!Array.isArray(haveBrand.json) || haveBrand.json.length === 0) {
    await svc('presence_brand_profile', { method: 'POST', body: JSON.stringify({ site_id: site.id }) });
  }
  const haveFirstRun = await svc(`presence_first_run?site_id=eq.${site.id}&select=site_id&limit=1`);
  if (!Array.isArray(haveFirstRun.json) || haveFirstRun.json.length === 0) {
    await svc('presence_first_run', { method: 'POST', body: JSON.stringify({ site_id: site.id }) });
  }

  // 5) provisioning postcondition: draft/provisioning → ready (never disturb live/paused)
  if (site.status === 'draft' || site.status === 'provisioning') {
    await svc(`presence_sites?id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'ready' }) });
    site.status = 'ready';
  }

  if (created) {
    await writeChangeEvent({
      siteId: site.id, entityType: 'site', entityId: site.id, action: 'create',
      summary: `Provisioned ${edition === 'monitor' ? 'a Monitor workspace' : 'a Presence website'} (self-serve)`,
      principal: systemPrincipal(opts.actorEmail || null), provenance: 'human',
    });
  }

  return { ok: true, siteId: String(site.id), edition, hosted: needsHosting, netlifyUrl };
}
