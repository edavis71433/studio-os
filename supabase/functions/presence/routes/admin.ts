// ── /admin/* — operator surface (M6) ─────────────────────────────────────────
// Staff-only (enforced in index.ts before dispatch). Operates on ANY site by
// id. Deploy ids and error_text ARE allowed here — this is the operator view;
// raw Netlify responses still never pass through untranslated.
//
// Every mutating action writes exactly one provenance event (M6 §5).
// Publishing actions run the ONE pipeline exported by routes/publish.ts —
// force publish, retry and snapshot-restore are the same path with a staff
// actor, never a second renderer or deploy route.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { estimateUsageCostUsd } from '../commerce/pricing.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import { getTemplate } from '../lib/render.ts';
import { serializeDraft } from '../lib/serializer.ts';
import { validateSnapshot } from '../lib/manifest_validate.ts';
import { canTransition, allowedTransitions, isLifecycleState, PUBLISH_BLOCKED_STATES } from '../lib/lifecycle.ts';
import { runPipeline, handlePublish, CALM } from './publish.ts';
import { runEvidence } from '../evidence/engine.ts';
import { runJudgment } from '../judgment/engine.ts';
import { runRecommendation } from '../recommendation/engine.ts';
import { runMoments } from '../moments/engine.ts';
import {
  netlifyConfigured, createSite, getSite, deleteSite, listDeploys,
  setCustomDomain, sslStatus, provisionSsl, restoreDeploy, deployState,
} from '../lib/netlify.ts';
import { computeReadiness } from './monitor.ts';
import { applyPlan } from './foundations.ts';
import { describeEngine } from '../optimization/engine.ts';
import { computeHealthCenter } from './system.ts';
import { inventory as connInventory, inventorySummary as connInventorySummary } from '../connected/inventory.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';
import type { Snapshot } from '../lib/render_types.ts';

const SB_URL = Deno.env.get('SUPABASE_URL') || '';
const SB_SERVICE = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HOSTNAME_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

const SITE_COLS = 'id,client_id,status,last_published_at,template_slug,template_version,custom_domain,netlify_site_id,edition,created_at,updated_at';

async function loadSite(siteId: string): Promise<SiteRow & { created_at: string; updated_at: string } | null> {
  if (!UUID_RE.test(siteId)) return null;
  const r = await svc(`presence_sites?id=eq.${siteId}&select=${SITE_COLS}&limit=1`);
  return r.json?.[0] ?? null;
}

async function readBody(req: Request): Promise<any> {
  try { return await req.json(); } catch { return null; }
}

// ═══ 1. PROVISIONING — POST /admin/sites ════════════════════════════════════
// Idempotent end to end: rerunning repairs a partial run and never duplicates.
//   client exists → entitlement upsert → site row get-or-create →
//   Netlify site create-or-adopt (deterministic name) → verify → initial
//   draft (identity seeded from the client) → status 'ready' → provenance.
async function handleProvision(req: Request, principal: Principal, cors: Record<string, string>) {
  const body = await readBody(req);
  const clientId = String(body?.client_id || '');
  if (!UUID_RE.test(clientId)) return json({ error: 'bad_request', message: 'client_id (uuid) is required.' }, 400, cors);
  const templateSlug = String(body?.template_slug || 'restaurant-classic');
  const templateVersion = String(body?.template_version || '1.0.0');
  if (!getTemplate(templateSlug, templateVersion)) {
    return json({ error: 'bad_request', message: `Unknown template ${templateSlug}@${templateVersion}.` }, 400, cors);
  }
  const entStatus = String(body?.entitlement_status || 'active');
  if (!['active', 'paused'].includes(entStatus)) return json({ error: 'bad_request', message: 'entitlement_status must be active or paused.' }, 400, cors);
  if (!netlifyConfigured()) return json({ error: 'hosting_unconfigured', message: 'Hosting is not configured on this environment (NETLIFY_AUTH_TOKEN missing).' }, 502, cors);

  // client must exist
  const cl = await svc(`clients?id=eq.${clientId}&select=id,name&limit=1`);
  const client = cl.json?.[0];
  if (!client) return json({ error: 'not_found', message: 'No client with that id.' }, 404, cors);

  // entitlement upsert (unique client_id+product)
  const ent = await svc('presence_entitlements?on_conflict=client_id,product', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ client_id: clientId, product: 'presence', status: entStatus, actor: principal.userId }),
  });
  if (!ent.ok) return json({ error: 'provision_failed', message: 'Could not set up the Presence entitlement.' }, 502, cors);

  // site row get-or-create (unique client_id = the duplicate guard)
  let site = (await svc(`presence_sites?client_id=eq.${clientId}&select=${SITE_COLS}&limit=1`)).json?.[0];
  let created = false;
  if (site && site.status === 'deleting') {
    return json({ error: 'conflict', message: 'This client’s previous site is being deleted. Wait for deletion to finish before provisioning again.' }, 409, cors);
  }
  if (!site) {
    const ins = await svc('presence_sites', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ client_id: clientId, template_slug: templateSlug, template_version: templateVersion, status: 'provisioning' }),
    });
    if (ins.status === 409) { // lost a race with a concurrent provision — adopt
      site = (await svc(`presence_sites?client_id=eq.${clientId}&select=${SITE_COLS}&limit=1`)).json?.[0];
    } else if (!ins.ok || !ins.json?.[0]) {
      return json({ error: 'provision_failed', message: 'Could not create the site record.' }, 502, cors);
    } else { site = ins.json[0]; created = true; }
  }

  // Netlify site: adopt existing, repair a dangling id, or create fresh —
  // the deterministic name makes reruns converge instead of duplicating
  const desiredName = `presence-${site.id.replace(/-/g, '').slice(0, 12)}`;
  let netlifyId = site.netlify_site_id as string | null;
  if (netlifyId) {
    const found = await getSite(netlifyId);
    if (!found.ok && found.status === 404) netlifyId = null; // deleted on Netlify's side → recreate
    else if (!found.ok) return json({ error: 'provision_failed', message: 'Hosting provider lookup failed — try again in a minute.' }, 502, cors);
  }
  if (!netlifyId) {
    // only a first-time provision walks draft → provisioning; repairing the
    // hosting of an already-ready/live/paused site must never disturb its
    // lifecycle state (the repair is transient, the site's state is not)
    if (site.status === 'draft') {
      await svc(`presence_sites?id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'provisioning' }) });
      site.status = 'provisioning';
    }
    const made = await createSite(desiredName);
    if (made.ok && made.site) netlifyId = made.site.id;
    else if (made.status === 422) {
      // name taken — by our own previous partial run, ideally
      const adopt = await getSite(`${desiredName}.netlify.app`);
      if (adopt.ok && adopt.site) netlifyId = adopt.site.id;
      else return json({ error: 'provision_failed', message: 'The hosting name is taken by another account — contact support.' }, 502, cors);
    } else {
      if (site.status === 'provisioning') { // roll a FIRST-TIME provision back cleanly; repairs keep their state
        await svc(`presence_sites?id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'draft' }) });
      }
      return json({ error: 'provision_failed', message: 'Hosting site creation failed — nothing was left half-made; rerun provisioning.' }, 502, cors);
    }
    await svc(`presence_sites?id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ netlify_site_id: netlifyId }) });
  }

  // verify it exists (the provisioning postcondition)
  const verify = await getSite(netlifyId!);
  if (!verify.ok || !verify.site) return json({ error: 'provision_failed', message: 'Hosting site did not verify after creation — rerun provisioning.' }, 502, cors);

  // initial draft: identity singleton seeded from the client (create-only)
  const haveIdentity = await svc(`presence_identity?site_id=eq.${site.id}&select=site_id&limit=1`);
  if (!Array.isArray(haveIdentity.json) || haveIdentity.json.length === 0) {
    await svc('presence_identity', { method: 'POST', body: JSON.stringify({ site_id: site.id, business_name: String(client.name || '').slice(0, 120) }) });
  }

  // draft/provisioning → ready (never touch live/paused/archived on rerun)
  if (site.status === 'draft' || site.status === 'provisioning') {
    await svc(`presence_sites?id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'ready' }) });
    site.status = 'ready';
  }

  if (created || !site.netlify_site_id) {
    await writeChangeEvent({ siteId: site.id, entityType: 'site', entityId: site.id, action: 'create', summary: 'Provisioned website hosting', principal, provenance: 'human' });
  }

  return json({
    data: {
      site_id: site.id, status: site.status, template: `${site.template_slug}@${site.template_version}`,
      netlify_site_id: netlifyId, netlify_url: `https://${verify.site.default_domain}`,
      already_existed: !created,
    },
  }, created ? 201 : 200, cors);
}

// ═══ 2. LIST / DETAIL ════════════════════════════════════════════════════════
async function handleList(cors: Record<string, string>) {
  const r = await svc(`presence_sites?select=${SITE_COLS},clients(name,email)&order=created_at.desc&limit=200`);
  const rows = Array.isArray(r.json) ? r.json : [];
  return json({
    data: rows.map((s: any) => ({
      id: s.id, client: s.clients?.name ?? null, client_email: s.clients?.email ?? null,
      status: s.status, template: `${s.template_slug}@${s.template_version}`,
      custom_domain: s.custom_domain, netlify_site_id: s.netlify_site_id,
      last_published_at: s.last_published_at, created_at: s.created_at,
    })),
  }, 200, cors);
}

// ═══ 3. DOMAIN OPERATIONS ═════════════════════════════════════════════════════
// DNS is checked via DNS-over-HTTPS (Google resolver): a CNAME to the site's
// netlify.app hostname, or the Netlify apex load-balancer A record.
const NETLIFY_APEX_IPS = new Set(['75.2.60.5']);

async function dnsLookup(name: string, type: 'A' | 'CNAME'): Promise<string[]> {
  try {
    const r = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`, { headers: { Accept: 'application/json' } });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j.Answer) ? j.Answer.map((a: any) => String(a.data || '').replace(/\.$/, '').toLowerCase()) : [];
  } catch { return []; }
}

async function domainStatus(site: { custom_domain: string | null; netlify_site_id: string | null }) {
  if (!site.custom_domain) {
    const nf = site.netlify_site_id ? await getSite(site.netlify_site_id) : { ok: false as const, site: undefined };
    return {
      custom_domain: null, health: 'no_domain',
      message: 'No custom domain attached — the site serves from its netlify.app address.',
      netlify_subdomain: nf.ok && nf.site ? nf.site.default_domain : null,
      dns: null, ssl: null,
    };
  }
  const nf = site.netlify_site_id ? await getSite(site.netlify_site_id) : { ok: false as const, site: undefined };
  const target = nf.ok && nf.site ? nf.site.default_domain.toLowerCase() : null;
  const cnames = await dnsLookup(site.custom_domain, 'CNAME');
  const aRecords = await dnsLookup(site.custom_domain, 'A');
  const dnsOk = (target !== null && cnames.includes(target)) || aRecords.some((ip) => NETLIFY_APEX_IPS.has(ip));
  const ssl = site.netlify_site_id ? await sslStatus(site.netlify_site_id) : { ok: false, state: 'unknown', expires_at: null };
  const sslOk = ssl.state === 'issued' || ssl.state === 'renewed';
  const health = !dnsOk ? 'dns_pending' : !sslOk ? 'ssl_pending' : 'ok';
  const message =
    health === 'ok' ? 'Domain is healthy: DNS points at the site and the certificate is active.'
    : health === 'ssl_pending' ? 'DNS is correct; the HTTPS certificate is still being issued (usually minutes, up to an hour).'
    : `DNS does not point at the site yet. Set a CNAME for ${site.custom_domain} to ${target ?? '<site>.netlify.app'}${aRecords.length ? ` (currently resolves to ${aRecords.join(', ')})` : ' (currently no record found)'}.`;
  return {
    custom_domain: site.custom_domain, health, message,
    netlify_subdomain: target,
    dns: { ok: dnsOk, cname: cnames, a: aRecords, expected_cname: target, expected_apex_ip: [...NETLIFY_APEX_IPS] },
    ssl: { state: ssl.state, expires_at: ssl.expires_at },
  };
}

async function handleDomain(req: Request, method: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  if (method === 'GET') return json({ data: await domainStatus(site) }, 200, cors);
  if (!site.netlify_site_id) return json({ error: 'not_provisioned', message: 'Provision hosting for this site before managing domains.' }, 409, cors);

  if (method === 'POST') {
    const body = await readBody(req);
    const domain = String(body?.domain || '').trim().toLowerCase();
    if (!HOSTNAME_RE.test(domain)) return json({ error: 'bad_request', message: 'That doesn’t look like a valid domain name (e.g. www.restaurant.com).' }, 400, cors);
    const set = await setCustomDomain(site.netlify_site_id, domain);
    if (!set.ok) return json({ error: 'domain_failed', message: 'The hosting provider rejected that domain — it may be attached to another account. Detail (operator): ' + (set.error || 'unknown') }, 502, cors);
    await svc(`presence_sites?id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ custom_domain: domain }) });
    await provisionSsl(site.netlify_site_id); // kick cert issuance; DNS may still be pending — safe to repeat
    await writeChangeEvent({ siteId: site.id, entityType: 'domain', entityId: null, action: 'create', summary: `Attached domain ${domain}`, principal, provenance: 'human' });
    return json({ data: await domainStatus({ custom_domain: domain, netlify_site_id: site.netlify_site_id }) }, 200, cors);
  }

  if (method === 'DELETE') {
    if (!site.custom_domain) return json({ error: 'not_found', message: 'This site has no custom domain to remove.' }, 404, cors);
    const removed = await setCustomDomain(site.netlify_site_id, null);
    if (!removed.ok) return json({ error: 'domain_failed', message: 'Could not detach the domain — try again. Detail (operator): ' + (removed.error || 'unknown') }, 502, cors);
    await svc(`presence_sites?id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ custom_domain: null }) });
    await writeChangeEvent({ siteId: site.id, entityType: 'domain', entityId: null, action: 'delete', summary: `Removed domain ${site.custom_domain}`, principal, provenance: 'human' });
    return json({ data: { ok: true, message: 'Domain removed — the site still serves from its netlify.app address.' } }, 200, cors);
  }
  return null;
}

// ═══ 4. LIFECYCLE — POST /admin/sites/:id/lifecycle ══════════════════════════
async function handleLifecycle(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const body = await readBody(req);
  const to = String(body?.to || '');
  if (!isLifecycleState(to)) return json({ error: 'bad_request', message: `Unknown state "${to}".` }, 400, cors);
  if (!canTransition(site.status, to)) {
    return json({
      error: 'invalid_transition',
      message: `A site can’t go from "${site.status}" to "${to}".`,
      allowed: allowedTransitions(site.status),
    }, 409, cors);
  }

  // side effect: entering 'deleting' removes the hosting site NOW; content,
  // snapshots and history stay in the database (business recovery per PDR)
  if (to === 'deleting' && site.netlify_site_id) {
    const del = await deleteSite(site.netlify_site_id);
    if (!del.ok) return json({ error: 'delete_failed', message: 'Hosting teardown failed — the site was NOT transitioned. Retry. Detail (operator): ' + (del.error || 'unknown') }, 502, cors);
    await svc(`presence_sites?id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ netlify_site_id: null, custom_domain: null }) });
  }

  const upd = await svc(`presence_sites?id=eq.${site.id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: to }) });
  if (!upd.ok) return json({ error: 'update_failed', message: 'Could not update the site state.' }, 502, cors);
  await writeChangeEvent({ siteId: site.id, entityType: 'site', entityId: site.id, action: 'update', summary: `Site status: ${site.status} → ${to}`, principal, provenance: 'human', fields: ['status'] });
  return json({ data: { status: to, previous: site.status } }, 200, cors);
}

// ═══ 5. PUBLISH OPERATIONS ════════════════════════════════════════════════════
async function handleAdminPublishes(site: SiteRow, cors: Record<string, string>) {
  // operator view: full records including error_text + deploy ids
  const r = await svc(`presence_publishes?site_id=eq.${site.id}&select=id,kind,status,change_summary,error_text,netlify_deploy_id,snapshot_id,actor_kind,created_at,completed_at&order=created_at.desc&limit=50`);
  const rows = Array.isArray(r.json) ? r.json : [];
  return json({
    data: rows.map((p: any) => ({
      ...p,
      duration_seconds: p.completed_at ? Math.round((new Date(p.completed_at).getTime() - new Date(p.created_at).getTime()) / 1000) : null,
    })),
  }, 200, cors);
}

async function handleRetry(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  if (PUBLISH_BLOCKED_STATES.includes(site.status)) return json({ error: 'lifecycle_blocked', message: `The site is ${site.status}; reactivate it before publishing.` }, 409, cors);
  const body = await readBody(req);
  let q = `presence_publishes?site_id=eq.${site.id}&status=eq.failed&select=id,kind,snapshot_id,change_summary&order=created_at.desc&limit=1`;
  if (body?.publish_id) {
    if (!UUID_RE.test(String(body.publish_id))) return json({ error: 'bad_request', message: 'publish_id must be a uuid.' }, 400, cors);
    q = `presence_publishes?id=eq.${body.publish_id}&site_id=eq.${site.id}&status=eq.failed&select=id,kind,snapshot_id,change_summary&limit=1`;
  }
  const rec = (await svc(q)).json?.[0];
  if (!rec) return json({ error: 'not_found', message: 'No failed publish to retry for this site.' }, 404, cors);
  if (!rec.snapshot_id) return json({ error: 'not_restorable', message: 'That publish’s snapshot is no longer retained — run a fresh publish instead.' }, 410, cors);
  const s = (await svc(`presence_snapshots?id=eq.${rec.snapshot_id}&select=content,media_manifest,content_contract_version,template_slug,template_version,created_at,dev_customization`)).json?.[0];
  if (!s) return json({ error: 'not_restorable', message: 'That publish’s snapshot is no longer retained — run a fresh publish instead.' }, 410, cors);
  const snapshot: Snapshot = { content: s.content, content_contract_version: s.content_contract_version, template_slug: s.template_slug, template_version: s.template_version, created_at: s.created_at, dev_customization: s.dev_customization ?? null };
  return runPipeline(site, principal, rec.kind === 'restore' ? 'restore' : 'publish',
    { snapshot, snapshotId: rec.snapshot_id, mediaManifest: s.media_manifest || [] },
    `Retry: ${rec.change_summary || 'previous publish'}`, cors);
}

async function handleCancel(site: SiteRow, principal: Principal, cors: Record<string, string>) {
  // only QUEUED publishes cancel — a deploying one is already at the host and
  // will complete or fail atomically (never a partial live site)
  const upd = await svc(`presence_publishes?site_id=eq.${site.id}&status=eq.queued`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'canceled', error_text: `canceled by operator ${principal.email || principal.userId || ''}`.trim(), completed_at: new Date().toISOString() }),
  });
  const rows = Array.isArray(upd.json) ? upd.json : [];
  if (!rows.length) return json({ error: 'nothing_queued', message: 'No queued publish to cancel (a deploy already in progress can’t be canceled — it completes or fails atomically).' }, 409, cors);
  await writeChangeEvent({ siteId: site.id, entityType: 'publish', entityId: rows[0].id, action: 'update', summary: 'Canceled a queued publish (operator)', principal, provenance: 'human', fields: ['status'] });
  return json({ data: { ok: true, canceled: rows.length } }, 200, cors);
}

async function handleRestoreSnapshot(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  if (PUBLISH_BLOCKED_STATES.includes(site.status)) return json({ error: 'lifecycle_blocked', message: `The site is ${site.status}; reactivate it before restoring.` }, 409, cors);
  const body = await readBody(req);
  const snapId = String(body?.snapshot_id || '');
  if (!UUID_RE.test(snapId)) return json({ error: 'bad_request', message: 'snapshot_id (uuid) is required.' }, 400, cors);
  const s = (await svc(`presence_snapshots?id=eq.${snapId}&site_id=eq.${site.id}&select=content,media_manifest,content_contract_version,template_slug,template_version,created_at,dev_customization`)).json?.[0];
  if (!s) return json({ error: 'not_found', message: 'No retained snapshot with that id for this site.' }, 404, cors);
  const snapshot: Snapshot = { content: s.content, content_contract_version: s.content_contract_version, template_slug: s.template_slug, template_version: s.template_version, created_at: s.created_at, dev_customization: s.dev_customization ?? null };
  const when = new Date(s.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return runPipeline(site, principal, 'restore', { snapshot, snapshotId: snapId, mediaManifest: s.media_manifest || [] }, `Operator restored the snapshot from ${when}`, cors);
}

// ═══ 6. MONITORING — GET /admin/sites/:id/health ═════════════════════════════
async function handleHealth(site: SiteRow, cors: Record<string, string>) {
  // hosting: connected = the Netlify site actually answers
  let hosting: any = { connected: false, message: 'No hosting attached — run provisioning.' };
  if (site.netlify_site_id) {
    const nf = await getSite(site.netlify_site_id);
    hosting = nf.ok && nf.site
      ? { connected: true, netlify_site_id: site.netlify_site_id, url: `https://${nf.site.default_domain}`, state: nf.site.state }
      : nf.status === 404
        ? { connected: false, netlify_site_id: site.netlify_site_id, message: 'HOSTING DISCONNECTED: the Netlify site no longer exists. Rerun provisioning to repair.' }
        : { connected: false, netlify_site_id: site.netlify_site_id, message: 'Hosting lookup failed (provider or token issue).' };
  }

  // publishing: last record, last success, in-flight, durations — operator detail
  const pubs = (await svc(`presence_publishes?site_id=eq.${site.id}&select=id,kind,status,error_text,netlify_deploy_id,created_at,completed_at&order=created_at.desc&limit=20`)).json ?? [];
  const last = pubs[0] ?? null;
  const lastSuccess = pubs.find((p: any) => p.status === 'live') ?? null;
  const inFlight = pubs.some((p: any) => p.status === 'queued' || p.status === 'deploying');
  const lastFailed = pubs.find((p: any) => p.status === 'failed') ?? null;
  const dur = (p: any) => (p && p.completed_at ? Math.round((new Date(p.completed_at).getTime() - new Date(p.created_at).getTime()) / 1000) : null);
  let currentDeployState: string | null = null;
  if (lastSuccess?.netlify_deploy_id) currentDeployState = await deployState(lastSuccess.netlify_deploy_id);

  // content: template + contract versions and live draft validation
  const t = getTemplate(site.template_slug, site.template_version);
  let draft: any = { blockers: null, warnings: null };
  if (t) {
    try {
      const { snapshot } = await serializeDraft(site.id, t.manifest, { templateSlug: site.template_slug, templateVersion: site.template_version, now: new Date().toISOString() });
      const v = validateSnapshot(snapshot, t.manifest);
      draft = { blockers: v.blockers.length, warnings: v.warnings.length };
    } catch { draft = { blockers: null, warnings: null, note: 'draft validation unavailable' }; }
  }
  const lastSnap = (await svc(`presence_snapshots?site_id=eq.${site.id}&select=content_contract_version,template_slug,template_version&order=created_at.desc&limit=1`)).json?.[0] ?? null;

  // media: count + MISSING detection (manifest paths whose object is gone)
  const media = (await svc(`presence_media?site_id=eq.${site.id}&deleted_at=is.null&select=id,storage_path&limit=200`)).json ?? [];
  const missing: string[] = [];
  for (const m of media.slice(0, 25)) { // bounded: health stays fast
    const head = await fetch(`${SB_URL}/storage/v1/object/authenticated/presence-media/${m.storage_path}`, {
      method: 'HEAD', headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` },
    });
    if (head.status === 400 || head.status === 404) missing.push(m.storage_path);
  }

  return json({
    data: {
      site: { id: site.id, status: site.status, created_at: (site as any).created_at, updated_at: (site as any).updated_at },
      hosting,
      domain: await domainStatus(site),
      publishing: {
        in_flight: inFlight,
        last_publish: last ? { id: last.id, kind: last.kind, status: last.status, at: last.created_at, duration_seconds: dur(last), deploy_id: last.netlify_deploy_id } : null,
        last_successful_publish: lastSuccess ? { id: lastSuccess.id, at: lastSuccess.created_at, duration_seconds: dur(lastSuccess), deploy_id: lastSuccess.netlify_deploy_id, current_deploy_state: currentDeployState } : null,
        last_error: lastFailed ? { id: lastFailed.id, at: lastFailed.created_at, error_text: lastFailed.error_text } : null,
        last_published_at: site.last_published_at,
      },
      content: {
        template: `${site.template_slug}@${site.template_version}`,
        content_contract_version: lastSnap?.content_contract_version ?? 1,
        last_snapshot_template: lastSnap ? `${lastSnap.template_slug}@${lastSnap.template_version}` : null,
        draft,
      },
      media: { count: media.length, checked: Math.min(media.length, 25), missing },
    },
  }, 200, cors);
}

// ═══ SC-2: scoped-access audit ledger (read) ════════════════════════════════
// Staff-only (proven in index.ts). Read-only view over the operator drill-in
// ledger. Filters: client (site_id), operator (user_id or email substring),
// outcome (allowed|denied), since/until (ISO date), limit. Deliberately NOT a
// dashboard — a plain, filterable, chronological trail for forensics.
async function handleScopedAccessAudit(req: Request, cors: Record<string, string>) {
  const url = new URL(req.url);
  const q = url.searchParams;
  const parts: string[] = ['select=id,operator_user_id,operator_email,agency_id,client_site_id,client_name,route,method,outcome,reason,request_id,ip,user_agent,created_at'];

  const client = q.get('client') || '';
  if (client) { if (!UUID_RE.test(client)) return json({ error: 'bad_request', message: 'client must be a site uuid.' }, 400, cors); parts.push(`client_site_id=eq.${client}`); }

  const operator = q.get('operator') || '';
  if (operator) {
    if (UUID_RE.test(operator)) parts.push(`operator_user_id=eq.${operator}`);
    else parts.push(`operator_email=ilike.*${encodeURIComponent(operator.slice(0, 254))}*`);
  }

  const outcome = q.get('outcome') || '';
  if (outcome) { if (!['allowed', 'denied'].includes(outcome)) return json({ error: 'bad_request', message: 'outcome must be allowed or denied.' }, 400, cors); parts.push(`outcome=eq.${outcome}`); }

  const agency = q.get('agency') || '';
  if (agency) { if (!UUID_RE.test(agency)) return json({ error: 'bad_request', message: 'agency must be a uuid.' }, 400, cors); parts.push(`agency_id=eq.${agency}`); }

  const isIso = (s: string) => /^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(s);
  const since = q.get('since') || '';
  if (since) { if (!isIso(since)) return json({ error: 'bad_request', message: 'since must be an ISO date (YYYY-MM-DD).' }, 400, cors); parts.push(`created_at=gte.${encodeURIComponent(since)}`); }
  const until = q.get('until') || '';
  if (until) { if (!isIso(until)) return json({ error: 'bad_request', message: 'until must be an ISO date (YYYY-MM-DD).' }, 400, cors); parts.push(`created_at=lte.${encodeURIComponent(until)}`); }

  const limit = Math.min(Math.max(parseInt(q.get('limit') || '100', 10) || 100, 1), 500);
  parts.push(`order=created_at.desc`, `limit=${limit}`);

  const r = await svc(`presence_scoped_access_events?${parts.join('&')}`);
  const rows = Array.isArray(r.json) ? r.json : [];
  const denied = rows.filter((x: any) => x.outcome === 'denied').length;
  return json({ data: { count: rows.length, denied, allowed: rows.length - denied, events: rows } }, 200, cors);
}

// ═══ AI cost view (operator-only; governance) ════════════════════════════════
// Turns the metered token rollup (presence_ai_usage) into an estimated dollar
// figure per client + a total, for the current period (?period=YYYY-MM to pick).
// Customers never see this (Law 13); it exists so the owner can watch AI spend.
async function handleAiUsage(req: Request, cors: Record<string, string>) {
  const url = new URL(req.url);
  const period = /^\d{4}-\d{2}$/.test(url.searchParams.get('period') || '') ? url.searchParams.get('period')! : new Date().toISOString().slice(0, 7);
  const r = await svc(`presence_ai_usage?period=eq.${period}&select=client_id,generative_ops,assistive_ops,input_tokens,output_tokens,images,last_at&order=output_tokens.desc.nullslast&limit=1000`);
  const rows = Array.isArray(r.json) ? r.json : [];
  const clients = rows.map((x: any) => ({
    client_id: x.client_id, generative_ops: x.generative_ops || 0, assistive_ops: x.assistive_ops || 0,
    input_tokens: x.input_tokens || 0, output_tokens: x.output_tokens || 0, images: x.images || 0, last_at: x.last_at,
    estimated_usd: estimateUsageCostUsd([{ input_tokens: x.input_tokens, output_tokens: x.output_tokens, images: x.images }]).total_usd,
  }));
  const totals = estimateUsageCostUsd(rows.map((x: any) => ({ input_tokens: x.input_tokens, output_tokens: x.output_tokens, images: x.images })));
  return json({ data: {
    period, client_count: clients.length,
    totals: { generative_ops: rows.reduce((a: number, x: any) => a + (x.generative_ops || 0), 0), assistive_ops: rows.reduce((a: number, x: any) => a + (x.assistive_ops || 0), 0), input_tokens: rows.reduce((a: number, x: any) => a + (x.input_tokens || 0), 0), output_tokens: rows.reduce((a: number, x: any) => a + (x.output_tokens || 0), 0), images: rows.reduce((a: number, x: any) => a + (x.images || 0), 0), ...totals },
    note: 'Text-token + image estimate at listed model prices; verify against the provider’s pricing page. Image spend (text_usd/image_usd) is now included.',
    clients,
  } }, 200, cors);
}

// ═══ ROUTER ═══════════════════════════════════════════════════════════════════
/** Dispatch /admin/* routes. Returns null when no admin route matches.
 *  Caller (index.ts) has already proven principal.kind === 'staff'. */
export async function handleAdmin(req: Request, route: string, method: string, principal: Principal, cors: Record<string, string>): Promise<Response | null> {
  if (route === '/admin/sites' && method === 'POST') return handleProvision(req, principal, cors);
  if (route === '/admin/sites' && method === 'GET') return handleList(cors);

  // ── L3: Optimization Engine coverage — operator introspection. Shows every
  //    optimization area, the providers serving it, and how many observations
  //    it can make. Derived live from the registry + catalog, so it can never
  //    drift from what actually runs.
  if (route === '/admin/optimization' && method === 'GET') return json({ data: describeEngine() }, 200, cors);
  if (route === '/admin/health-center' && method === 'GET') return json({ data: await computeHealthCenter() }, 200, cors); // PT-2C: operator-authed Health Center

  // ── L4.0: Connected Platform inventory — the living, generated-from-registry
  //    profile of every provider (operator introspection; verifies one shared
  //    architecture, no drift).
  if (route === '/admin/connections' && method === 'GET') return json({ data: { summary: connInventorySummary(), providers: connInventory() } }, 200, cors);

  // ── SC-2: scoped-access audit ledger — who (agency operator) reached which
  //    client via drill-in, allowed AND denied. Staff-only accountability trail.
  if (route === '/admin/scoped-access' && method === 'GET') return handleScopedAccessAudit(req, cors);

  // ── AI cost view (operator/governance) — metered token usage → estimated $ ──
  if (route === '/admin/ai-usage' && method === 'GET') return handleAiUsage(req, cors);

  // ── M13: agency provisioning (operator creates the agency + its owner seat) ──
  if (route === '/admin/agencies' && method === 'POST') {
    const b = await readBody(req);
    const name = String(b?.name || '').trim().slice(0, 160);
    const ownerEmail = String(b?.owner_email || '').toLowerCase().trim();
    if (!name || !ownerEmail.includes('@')) return json({ error: 'bad_request', message: 'A name and an owner email are needed.' }, 400, cors);
    const a = await svc('presence_agencies?select=id,name,seat_limit,client_limit,plan', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ name, seat_limit: Number(b?.seat_limit) || 5, client_limit: Number(b?.client_limit) || 25, plan: String(b?.plan || 'agency').slice(0, 40) }),
    });
    if (!a.ok || !a.json?.[0]) return json({ error: 'write_failed', message: 'The agency didn’t save.' }, 502, cors);
    await svc('presence_agency_members', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ agency_id: a.json[0].id, email: ownerEmail, role: 'owner', status: 'active' }),
    });
    return json({ data: a.json[0] }, 200, cors);
  }
  if (route === '/admin/agencies' && method === 'GET') {
    const r = await svc('presence_agencies?select=id,name,plan,status,seat_limit,client_limit,created_at&order=created_at.desc&limit=100');
    return json({ data: r.json ?? [] }, 200, cors);
  }

  // legacy M5 shape: POST /admin/restore-deploy {site_id, deploy_id}
  if (route === '/admin/restore-deploy' && method === 'POST') {
    const body = await readBody(req);
    const siteId = String(body?.site_id || ''); const deployId = String(body?.deploy_id || '');
    if (!siteId || !deployId) return json({ error: 'bad_request', message: 'site_id and deploy_id are required.' }, 400, cors);
    const site = await loadSite(siteId);
    if (!site?.netlify_site_id) return json({ error: 'not_found', message: 'Site not found or not connected to hosting.' }, 404, cors);
    const r = await restoreDeploy(site.netlify_site_id, deployId);
    if (!r.ok) return json({ error: 'restore_failed', message: CALM + ' Detail (operator): ' + (r.error || 'unknown') }, 502, cors);
    await writeChangeEvent({ siteId: site.id, entityType: 'restore', entityId: null, action: 'restore', summary: 'Instant restore of a previous deploy (operator)', principal, provenance: 'human' });
    return json({ data: { ok: true } }, 200, cors);
  }

  const m = route.match(/^\/admin\/sites\/([0-9a-f-]{36})(\/[a-z0-9-]+(?:\/[a-z0-9-]+){0,2})?$/);
  if (!m) return null;
  const site = await loadSite(m[1]);
  if (!site) return json({ error: 'not_found', message: 'No site with that id.' }, 404, cors);
  const sub = m[2] || '';

  if (sub === '' && method === 'GET') return json({ data: site }, 200, cors);
  if (sub === '/health' && method === 'GET') return handleHealth(site, cors);
  if (sub === '/domain') { const r = await handleDomain(req, method, site, principal, cors); if (r) return r; }
  if (sub === '/lifecycle' && method === 'POST') return handleLifecycle(req, site, principal, cors);
  // ── M11: the additive upgrade path — Monitor ⇄ Presence is ONE column flip.
  //    Every site_id-keyed row (evidence, judgments, recommendations, moments,
  //    brand profile, growth, knowledge, concierge) survives untouched.
  if (sub === '/edition' && method === 'POST') {
    const body = await readBody(req);
    const edition = ['monitor', 'presence'].includes(body?.edition) ? body.edition : null;
    if (!edition) return json({ error: 'bad_request', message: 'edition must be monitor or presence.' }, 400, cors);
    const w = await svc(`presence_sites?id=eq.${site.id}&select=id,edition`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ edition }),
    });
    if (!w.ok || !w.json?.[0]) return json({ error: 'write_failed', message: 'The edition change didn’t save.' }, 502, cors);
    await writeChangeEvent({ siteId: site.id, entityType: 'settings', entityId: null, action: 'update', summary: `Edition set to ${edition} (operator)`, principal, provenance: 'human', fields: ['edition'] });
    return json({ data: { id: site.id, edition } }, 200, cors);
  }
  // ── M12: apply an APPROVED Infrastructure Change Plan (approval law enforced inside)
  {
    const pm = sub.match(/^\/plans\/([0-9a-f-]{36})\/apply$/);
    if (pm && method === 'POST') return applyPlan(site, pm[1], principal, cors);
  }
  // ── M11: Migration Readiness — the operator's full-detail view (the client
  //    route speaks sentences; this one carries the working data)
  if (sub === '/migration-readiness' && method === 'GET') {
    const report = await computeReadiness(site);
    if (!report) return json({ error: 'not_ready', message: 'No verified monitor connection to assess.' }, 409, cors);
    return json({ data: report }, 200, cors);
  }
  if (sub === '/deploys' && method === 'GET') {
    if (!site.netlify_site_id) return json({ error: 'not_provisioned', message: 'This site has no hosting attached.' }, 409, cors);
    const d = await listDeploys(site.netlify_site_id, 25);
    if (!d.ok) return json({ error: 'lookup_failed', message: 'Could not read deploy history from the hosting provider.' }, 502, cors);
    return json({ data: d.deploys }, 200, cors);
  }
  if (sub === '/publishes' && method === 'GET') return handleAdminPublishes(site, cors);
  if (sub === '/publish' && method === 'POST') {
    // FORCE PUBLISH: staff actor, the same ONE pipeline (validation included) —
    // works even when the client's entitlement is paused (operator judgment)
    if (PUBLISH_BLOCKED_STATES.includes(site.status)) return json({ error: 'lifecycle_blocked', message: `The site is ${site.status}; reactivate it before publishing.` }, 409, cors);
    return handlePublish(null, site, principal, cors); // M4: operator force-publish — no client idempotency/cooldown (authoritative action)
  }
  if (sub === '/retry' && method === 'POST') return handleRetry(req, site, principal, cors);
  if (sub === '/cancel' && method === 'POST') return handleCancel(site, principal, cors);
  if (sub === '/restore-snapshot' && method === 'POST') return handleRestoreSnapshot(req, site, principal, cors);

  // ── M9.0: the Evidence Engine (observation only; operator surface) ──
  if (sub === '/observe' && method === 'POST') {
    const summary = await runEvidence(site, 'operator');
    return json({ data: summary }, summary.ok ? 200 : 502, cors);
  }
  if (sub === '/evidence' && method === 'GET') {
    const url = new URL(req.url);
    const runId = url.searchParams.get('run_id');
    const category = url.searchParams.get('category');
    let runFilter = runId && /^[0-9a-f-]{36}$/.test(runId) ? runId : null;
    if (!runFilter) {
      // default: the latest finished run — evidence reads as "current state"
      const latest = await svc(`presence_evidence_runs?site_id=eq.${site.id}&finished_at=not.is.null&error_text=is.null&select=id&order=started_at.desc&limit=1`);
      runFilter = latest.json?.[0]?.id ?? null;
      if (!runFilter) return json({ data: { run_id: null, items: [] } }, 200, cors);
    }
    const cat = category && /^[a-z_]+$/.test(category) ? `&category=eq.${category}` : '';
    const items = await svc(`presence_evidence?run_id=eq.${runFilter}${cat}&select=category,type,severity,confidence,source,resource,human,tech,next_action,facts,observed_at,fingerprint&order=severity.asc,category.asc,type.asc&limit=500`);
    return json({ data: { run_id: runFilter, items: items.json ?? [] } }, 200, cors);
  }
  if (sub === '/evidence/runs' && method === 'GET') {
    const runs = await svc(`presence_evidence_runs?site_id=eq.${site.id}&select=id,started_at,finished_at,trigger,item_count,providers,input,error_text&order=started_at.desc&limit=20`);
    return json({ data: runs.json ?? [] }, 200, cors);
  }

  // ── M9.1: the Judgment Engine (deterministic; consumes evidence only) ──
  if (sub === '/judge' && method === 'POST') {
    const summary = await runJudgment(site);
    return json({ data: summary }, summary.ok ? 200 : summary.error === 'no_evidence_run' ? 409 : 502, cors);
  }
  if (sub === '/judgments' && method === 'GET') {
    const url = new URL(req.url);
    const status = url.searchParams.get('status'); // active | suppressed | all (default active)
    const batch = url.searchParams.get('batch_id');
    let batchFilter = batch && /^[0-9a-f-]{36}$/.test(batch) ? batch : null;
    if (!batchFilter) {
      const latest = await svc(`presence_judgments?site_id=eq.${site.id}&select=batch_id&order=created_at.desc&limit=1`);
      batchFilter = latest.json?.[0]?.batch_id ?? null;
      if (!batchFilter) return json({ data: { batch_id: null, judgments: [] } }, 200, cors);
    }
    const statusFilter = status === 'all' ? '' : status === 'suppressed' ? '&status=eq.suppressed' : '&status=eq.active';
    const rows = await svc(`presence_judgments?batch_id=eq.${batchFilter}${statusFilter}&select=judgment_hash,judgment_key,rule,category,priority,severity,confidence,reasoning,business_impact,customer_impact,timing,audience,status,suppression_reason,evidence_ids,evidence_count,first_seen_at,expires_at,created_at&order=priority.asc,rule.asc&limit=200`);
    return json({ data: { batch_id: batchFilter, judgments: rows.json ?? [] } }, 200, cors);
  }

  // ── M9.2: the Recommendation Engine (deterministic; consumes judgments only) ──
  if (sub === '/recommend' && method === 'POST') {
    const summary = await runRecommendation(site);
    return json({ data: summary }, summary.ok ? 200 : summary.error === 'no_judgment_batch' ? 409 : 502, cors);
  }
  if (sub === '/recommendations' && method === 'GET') {
    const url = new URL(req.url);
    const status = url.searchParams.get('status'); // active | suppressed | all (default active)
    const batch = url.searchParams.get('batch_id');
    let batchFilter = batch && /^[0-9a-f-]{36}$/.test(batch) ? batch : null;
    if (!batchFilter) {
      const latest = await svc(`presence_recommendations?site_id=eq.${site.id}&select=batch_id&order=created_at.desc&limit=1`);
      batchFilter = latest.json?.[0]?.batch_id ?? null;
      if (!batchFilter) return json({ data: { batch_id: null, recommendations: [] } }, 200, cors);
    }
    const statusFilter = status === 'all' ? '' : status === 'suppressed' ? '&status=eq.suppressed' : '&status=eq.active';
    const rows = await svc(`presence_recommendations?batch_id=eq.${batchFilter}${statusFilter}&select=recommendation_hash,recommendation_key,rule,category,priority,action,title,description,reason,expected_benefit,value_dimensions,estimated_effort,estimated_risk,undoability,timing,audience,affected_resources,requires_ai,manual_available,approval_required,status,suppression_reason,supporting_judgment_ids,first_seen_at,expires_at,created_at&order=priority.asc,rule.asc&limit=200`);
    return json({ data: { batch_id: batchFilter, recommendations: rows.json ?? [] } }, 200, cors);
  }

  // ── M9.3: the Business Moments Engine (deterministic; consumes recommendations only) ──
  if (sub === '/moments-generate' && method === 'POST') {
    const summary = await runMoments(site);
    return json({ data: summary }, summary.ok ? 200 : summary.error === 'no_recommendation_batch' ? 409 : 502, cors);
  }
  if (sub === '/moments' && method === 'GET') {
    // operator view: full internal fields, latest batch (or all statuses)
    const url = new URL(req.url);
    const status = url.searchParams.get('status');
    const filter = status === 'all' ? '' : `&status=eq.${/^[a-z_]+$/.test(status || '') ? status : 'active'}`;
    const rows = await svc(`presence_moments?site_id=eq.${site.id}${filter}&select=*&order=created_at.desc&limit=60`);
    return json({ data: rows.json ?? [] }, 200, cors);
  }

  return null;
}
