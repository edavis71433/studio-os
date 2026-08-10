// ── /connections/* — the connected-platform surface (L4.1, read-only) ───────
// The customer sees "your Google listing", "your reviews", "your appointments" —
// never APIs. Connect (OAuth or a read-only key), reconnect, refresh (an on-
// demand READ — no background jobs), and disconnect (revoke + destroy). Every
// provider flows through the SAME handlers; the registry + auth map is all that
// differs. Nothing is ever written back to a provider.
//   GET  /connections                    — the surface + per-provider state + data
//   GET  /connections/:key               — one provider's single-page profile
//   POST /connections/:key/connect       — start OAuth (returns consent URL) or store an API key
//   POST /connections/:key/callback      — finish OAuth (exchange the code)
//   POST /connections/:key/refresh       — pull fresh data now (on-demand read)
//   POST /connections/:key/disconnect    — revoke + destroy; account + data untouched
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';
import { loadPlan } from '../commerce/enforce.ts';
import { providerByKey } from '../connected/providers.ts';
import { connectableFor, profileOf } from '../connected/inventory.ts';
import { connectionReason } from '../connected/contract.ts';
import type { EditionKey } from '../connected/contract.ts';
import { isOAuth, oauthConfigured, authorizeUrl, exchangeCode, revokeToken, signState, verifyState, refreshTokens } from '../connected/auth.ts';
import { saveTokens, loadTokens, disconnect as storeDisconnect, getConnectionConfig, setConnectionConfig, markStatus } from '../connected/store.ts';
import { readProvider, discoverGa4Properties } from '../connected/adapters.ts';
import { ga4PropertyPath } from '../lib/ga4.ts';
import { encryptionConfigured } from '../connected/crypto.ts';
import { buildWritePlan, writeSpec, writeWorkflowsForProvider } from '../connected/writes.ts';
import type { WriteWorkflow } from '../connected/writes.ts';
import { saveWritePlan, listWritePlans, getWritePlan, decideWritePlan, markWriteOutcome, claimWriteForExecution, releaseWriteClaim, auditWrite } from '../connected/writestore.ts';
import { executeWrite } from '../connected/execute.ts';
import { notifyOwnerOfReviewerDecision } from '../lib/notice.ts';

// ── Owner-facing activation copy ─────────────────────────────────────────────
// "Isn't available on this environment yet" is true and useless. The person
// reading it on a solo studio IS the owner — the only person who can fix it —
// so the 503 names the exact secrets and the exact redirect URI instead of
// hiding the setup from the one human who can do it. Secret names are derived
// the same way connected/auth.ts derives them (CONNECTED_<KEY>_CLIENT_ID /
// _SECRET), so this can never drift from what the code actually reads.
// Authoritative list: docs/presence/ENV-AND-SECRETS.md.
const SITE_URL = (Deno.env.get('SITE_URL') || 'https://davisdigitalstudio.com').replace(/\/$/, '');
// Per-provider extra steps beyond the secrets — spoken HERE because the person
// reading the 503 is the one human who can do them.
const ACTIVATION_EXTRA: Record<string, string> = {
  google_analytics: 'The same Google Cloud app Search Console uses works here — add the https://www.googleapis.com/auth/analytics.readonly scope to its consent screen, and enable the Google Analytics Data API and Google Analytics Admin API on the project.',
};
function activationHelp(key: string, providerName: string): { message: string; missing: string[]; redirect_uri: string; docs: string } {
  const K = key.toUpperCase();
  const missing = [`CONNECTED_${K}_CLIENT_ID`, `CONNECTED_${K}_CLIENT_SECRET`, 'CONNECTION_ENC_KEY'];
  const extra = ACTIVATION_EXTRA[key] ? ` ${ACTIVATION_EXTRA[key]}` : '';
  return {
    message: `${providerName} isn’t switched on yet — it needs its ${providerName} app registered and three Supabase Edge Function secrets set: ${missing.join(', ')}. The app’s redirect URI must be ${SITE_URL}/connections-callback.html.${extra} Nothing is wrong with your account; this is a one-time setup on the Studio side.`,
    missing, redirect_uri: `${SITE_URL}/connections-callback.html`,
    docs: 'docs/presence/ENV-AND-SECRETS.md',
  };
}

const CATEGORY_LABEL: Record<string, string> = {
  search: 'Being found', local_listing: 'Your listings', analytics: 'Your numbers',
  social: 'Your social', reviews: 'Your reviews', scheduling: 'Your bookings',
  crm: 'Your customers', email_marketing: 'Your email', payments: 'Your sales',
};

export async function handleConnectionsList(site: SiteRow, cors: Record<string, string>) {
  const plan = (await loadPlan(site.client_id)) as EditionKey;
  const items = connectableFor(plan);
  const [connQ, dataQ] = await Promise.all([
    svc(`presence_connections?site_id=eq.${site.id}&select=provider_key,status,health,last_sync_at,connected_at,last_error,config`),
    svc(`presence_connected_data?site_id=eq.${site.id}&select=provider_key,data,fetched_at`),
  ]);
  const states = new Map((connQ.ok && Array.isArray(connQ.json) ? connQ.json : []).map((c: any) => [c.provider_key, c]));
  const dataMap = new Map((dataQ.ok && Array.isArray(dataQ.json) ? dataQ.json : []).map((d: any) => [d.provider_key, d]));

  const groups: Record<string, any[]> = {};
  for (const it of items) {
    const s = states.get(it.key); const d = dataMap.get(it.key);
    const entry = {
      key: it.key, label: it.label, purpose: it.purpose, reads: it.reads, approval: it.approval, availability: it.status,
      // `reason`: the plain-English WHY behind an attention/down badge. Without
      // it the badge is a dead end — the customer can see something is wrong and
      // has only "press Connect again" left. Translated from the internal
      // last_error (connectionReason), never the raw provider text.
      connection: s
        ? { status: s.status, health: s.health, last_sync_at: s.last_sync_at, connected_at: s.connected_at, reason: connectionReason(s.last_error, it.label) }
        : { status: 'disconnected', health: 'unknown', last_sync_at: null, connected_at: null, reason: '' },
      // GA4 only: which property this connection reads (0128 config). The page
      // shows the choice — or, when connected with none chosen, asks for it.
      ...(it.key === 'google_analytics' ? { property: (s?.config?.property_id)
        ? { id: String(s.config.property_id), name: String(s.config.property_name || ''), auto_selected: !!s.config.auto_selected }
        : null } : {}),
      data: d ? { ...d.data, as_of: d.fetched_at } : null, // the customer's own numbers, plain
    };
    const g = CATEGORY_LABEL[it.category] || it.category;
    (groups[g] ||= []).push(entry);
  }
  return json({ data: {
    edition: plan,
    note: 'Connect the services you already use — read-only, always with your approval, and yours to disconnect any time.',
    groups,
  } }, 200, cors);
}

export async function handleConnectionProfile(site: SiteRow, key: string, cors: Record<string, string>) {
  const p = providerByKey(key);
  if (!p) return json({ error: 'not_found', message: 'There’s no such connection.' }, 404, cors);
  return json({ data: profileOf(p) }, 200, cors);
}

export async function handleConnectionConnect(req: Request, site: SiteRow, key: string, principal: Principal, cors: Record<string, string>) {
  const p = providerByKey(key);
  if (!p) return json({ error: 'not_found', message: 'There’s no such connection.' }, 404, cors);
  if (!encryptionConfigured()) {
    return json({ error: 'not_available', message: 'Secure connection storage isn’t switched on yet — set the CONNECTION_ENC_KEY Supabase Edge Function secret (a 44-character base64 key). Until it exists, connections fail closed rather than store anything in the clear.', missing: ['CONNECTION_ENC_KEY'], docs: 'docs/presence/ENV-AND-SECRETS.md' }, 503, cors);
  }

  if (isOAuth(key)) {
    if (!oauthConfigured(key)) {
      const help = activationHelp(key, p.name);
      return json({ error: 'not_available', ...help }, 503, cors);
    }
    const state = await signState(site.id, key);
    const url = authorizeUrl(key, state);
    return json({ data: { mode: 'oauth', authorize_url: url, state, message: `You’ll approve access to ${p.customerLabel} on ${p.name}’s own screen — read-only, and you can disconnect any time.` } }, 200, cors);
  }
  if (p.auth === 'api_key') {
    let body: any = {}; try { body = await req.json(); } catch { /* */ }
    const apiKey = String(body?.api_key || '').trim();
    if (!apiKey) return json({ error: 'bad_request', message: 'Paste your read-only key to connect.' }, 422, cors);
    const ok = await saveTokens(site.id, key, { access_token: apiKey }, p.scopes);
    if (!ok) return json({ error: 'storage', message: 'We couldn’t store that securely — please try again.' }, 502, cors);
    await svc('presence_connection_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ site_id: site.id, provider_key: key, action: 'connect', detail: 'api key connected', actor_kind: principal.kind === 'staff' ? 'operator' : 'customer' }) });
    readProvider(site.id, key, p.customerLabel).catch(() => {}); // an initial read, on-demand
    return json({ data: { mode: 'api_key', connected: true, message: `Connected ${p.customerLabel}.` } }, 200, cors);
  }
  return json({ error: 'not_available', message: `${p.customerLabel} connects a different way that isn’t available yet.` }, 503, cors);
}

export async function handleConnectionCallback(req: Request, site: SiteRow, key: string, principal: Principal, cors: Record<string, string>) {
  const p = providerByKey(key);
  if (!p) return json({ error: 'not_found', message: 'There’s no such connection.' }, 404, cors);
  if (!oauthConfigured(key)) return json({ error: 'not_available', ...activationHelp(key, p.name) }, 503, cors);
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const code = String(body?.code || '');
  if (!code) return json({ error: 'bad_request', message: 'The connection didn’t return a code — please try again.' }, 422, cors);
  // L4.4 hardening: the returned state must verify (site + provider bound, fresh).
  // Refuses replayed, cross-site, or forged callbacks before any code is exchanged.
  const state = String(body?.state || '');
  if (!(await verifyState(state, site.id, key))) {
    // Two honest causes, and the customer can act on either: the consent screen
    // sat open longer than the 10-minute state window, or the connect leg was
    // started for a DIFFERENT client than the one this callback resolved to
    // (the operator-connects-for-a-client case — connections-callback.html sends
    // x-dds-scope-site so the two legs agree).
    return json({ error: 'bad_state', message: 'That connection couldn’t be verified, so nothing was connected. Usually the approval screen was left open too long (there’s a 10-minute window) — start again from the same client’s Connections page and it will go through.' }, 400, cors);
  }
  try {
    const tokens = await exchangeCode(key, code);
    const ok = await saveTokens(site.id, key, tokens, p.scopes);
    if (!ok) return json({ error: 'storage', message: 'We couldn’t store the connection securely — please try again.' }, 502, cors);
    await svc('presence_connection_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ site_id: site.id, provider_key: key, action: 'connect', detail: 'oauth connected', actor_kind: principal.kind === 'staff' ? 'operator' : 'customer' }) });
    readProvider(site.id, key, p.customerLabel).catch(() => {});
    return json({ data: { connected: true, message: `Connected ${p.customerLabel}.` } }, 200, cors);
  } catch (_e) {
    return json({ error: 'connect_failed', message: 'That connection didn’t complete. Nothing changed — please try again.' }, 502, cors);
  }
}

// ── GA4 property selection ───────────────────────────────────────────────────
// One Google account usually holds several GA4 properties; reporting is always
// against exactly one. These two endpoints are the human half of that choice:
// list what the connected account can read (Admin API accountSummaries — shape
// in lib/ga4.ts), and record the pick on the connection (0128 config). Only
// Google Analytics has this shape today; other providers 404 honestly.

/** A live access token for this site's connection, silently refreshed when
 *  expired — the same dance readProvider does, extracted for the two GA4
 *  property endpoints. Null = not connected (or refresh failed). */
async function liveToken(siteId: string, key: string): Promise<string | null> {
  let tokens = await loadTokens(siteId, key);
  if (!tokens?.access_token) return null;
  if (tokens.expires_at && new Date(tokens.expires_at) <= new Date() && tokens.refresh_token && isOAuth(key) && oauthConfigured(key)) {
    try { tokens = await refreshTokens(key, tokens.refresh_token); await saveTokens(siteId, key, tokens, []); }
    catch { return null; }
  }
  return tokens.access_token || null;
}

export async function handleConnectionProperties(site: SiteRow, key: string, cors: Record<string, string>) {
  const p = providerByKey(key);
  if (!p) return json({ error: 'not_found', message: 'There’s no such connection.' }, 404, cors);
  if (key !== 'google_analytics') return json({ error: 'not_found', message: `${p.customerLabel} doesn’t choose a property — there’s nothing to pick here.` }, 404, cors);
  const token = await liveToken(site.id, key);
  if (!token) return json({ error: 'not_connected', message: 'Connect Google Analytics first — then pick which property is this website.' }, 409, cors);
  const found = await discoverGa4Properties(token).catch(() => null);
  if (!found || !found.ok) {
    const status = found && !found.ok ? found.status : 0;
    const msg = status === 403
      ? 'Google answered, but that account isn’t allowed to list Analytics properties — the Analytics Admin API may not be enabled on the app’s Google Cloud project yet.'
      : 'We couldn’t list the properties just now. Nothing changed — try again in a moment.';
    return json({ error: 'read_failed', message: msg }, 502, cors);
  }
  const cfg = await getConnectionConfig(site.id, key);
  const selected = cfg.property_id ? { id: String(cfg.property_id), name: String(cfg.property_name || ''), auto_selected: !!cfg.auto_selected } : null;
  return json({ data: {
    properties: found.properties,
    selected,
    note: found.properties.length === 0
      ? 'That Google account has no Google Analytics property yet — connect the account that owns this website’s Analytics, or create the property first.'
      : 'Pick the property that measures this website. Read-only either way.',
  } }, 200, cors);
}

export async function handleConnectionPropertySelect(req: Request, site: SiteRow, key: string, principal: Principal, cors: Record<string, string>) {
  const p = providerByKey(key);
  if (!p) return json({ error: 'not_found', message: 'There’s no such connection.' }, 404, cors);
  if (key !== 'google_analytics') return json({ error: 'not_found', message: `${p.customerLabel} doesn’t choose a property — there’s nothing to pick here.` }, 404, cors);
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const picked = ga4PropertyPath(body?.property_id);
  if (!picked) return json({ error: 'bad_request', message: 'Pick a property from the list — that didn’t look like one.' }, 422, cors);
  const id = picked.replace(/^properties\//, '');
  const token = await liveToken(site.id, key);
  if (!token) return json({ error: 'not_connected', message: 'Connect Google Analytics first — then pick which property is this website.' }, 409, cors);
  // Verify the pick against what the account can actually read — a typo'd or
  // stale id must fail HERE, not as a silent 404 on every future sync.
  const found = await discoverGa4Properties(token).catch(() => null);
  if (!found || !found.ok) return json({ error: 'read_failed', message: 'We couldn’t confirm that property with Google just now. Nothing changed — try again in a moment.' }, 502, cors);
  const match = found.properties.find((x) => x.id === id);
  if (!match) return json({ error: 'bad_request', message: 'That property isn’t on the connected Google account. Pick one from the list — or reconnect with the account that owns it.' }, 422, cors);
  await setConnectionConfig(site.id, key, { property_id: match.id, property_name: match.name, auto_selected: false });
  await markStatus(site.id, key, 'connected', 'ok', '').catch(() => {});   // clears the "choose a property" attention
  await svc('presence_connection_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ site_id: site.id, provider_key: key, action: 'configure', detail: `property selected: ${match.name} (${match.id})`, actor_kind: principal.kind === 'staff' ? 'operator' : 'customer' }) }).catch(() => {});
  readProvider(site.id, key, p.customerLabel).catch(() => {});   // first read against the chosen property, on-demand
  return json({ data: { selected: { id: match.id, name: match.name }, message: `Reading ${match.name} from here on.` } }, 200, cors);
}

export async function handleConnectionRefresh(site: SiteRow, key: string, cors: Record<string, string>) {
  const p = providerByKey(key);
  if (!p) return json({ error: 'not_found', message: 'There’s no such connection.' }, 404, cors);
  const data = await readProvider(site.id, key, p.customerLabel);
  if (!data) return json({ error: 'read_failed', message: `We couldn’t read from ${p.customerLabel} just now — it may need a quick reconnect.` }, 502, cors);
  return json({ data: { refreshed: true, data } }, 200, cors);
}

export async function handleConnectionDisconnect(site: SiteRow, key: string, principal: Principal, cors: Record<string, string>) {
  const p = providerByKey(key);
  if (!p) return json({ error: 'not_found', message: 'There’s no such connection.' }, 404, cors);
  const tokens = await loadTokens(site.id, key);
  if (tokens?.access_token) revokeToken(key, tokens.access_token).catch(() => {}); // best-effort revoke at the provider
  await storeDisconnect(site.id, key, principal.kind === 'staff' ? 'operator' : 'customer');
  return json({ data: { disconnected: true, message: `Disconnected ${p.customerLabel}. Your account and everything in it are untouched.` } }, 200, cors);
}

// ═══ L4.3 Write-Capable Adapters ════════════════════════════════════════════
// Every external write is a PLAN the customer reviews and approves first. The
// flow is identical for every provider: prepare → decide → execute → (rollback).
// Nothing writes without an explicit recorded approval; handoffs never touch a
// provider at all.
const actorOf = (principal: Principal) => (principal.kind === 'staff' ? 'operator' : 'customer');

/** Prepare a write plan (proposed). Traces to the recommendation it serves. */
export async function handleWritePrepare(req: Request, site: SiteRow, key: string, principal: Principal, cors: Record<string, string>) {
  const p = providerByKey(key);
  if (!p) return json({ error: 'not_found', message: 'There’s no such connection.' }, 404, cors);
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const workflow = String(body?.workflow || '') as WriteWorkflow;
  const spec = writeSpec(workflow);
  if (!spec || spec.provider_key !== key) {
    const available = writeWorkflowsForProvider(key).map((w) => w.workflow);
    return json({ error: 'bad_workflow', message: available.length ? `${p.customerLabel} supports: ${available.join(', ')}.` : `${p.customerLabel} has no write actions — it stays read-only.` }, 400, cors);
  }
  // Capture the current state for reversible writes (e.g. hours) so rollback is real.
  let priorHours: Record<string, string> | undefined;
  if (workflow === 'gbp_hours') {
    const d = await svc(`presence_connected_data?site_id=eq.${site.id}&provider_key=eq.${encodeURIComponent(key)}&select=data&limit=1`);
    priorHours = d.json?.[0]?.data?.hours;
  }
  const plan = buildWritePlan(workflow, p, {
    text: body?.text, subject: body?.subject, hours: body?.hours, priorHours,
    siteUrl: body?.site_url || (site.custom_domain ? `https://${site.custom_domain}` : undefined), when: body?.when,
  });
  const row = await saveWritePlan(site.id, plan, body?.recommendation_hash || null);
  if (!row) return json({ error: 'write_failed', message: 'The plan didn’t save — nothing was changed.' }, 502, cors);
  await auditWrite(site.id, key, 'write_prepare', `prepared: ${plan.title}`, actorOf(principal));
  return json({ data: row }, 200, cors);
}

export async function handleWriteList(site: SiteRow, key: string, cors: Record<string, string>) {
  return json({ data: await listWritePlans(site.id, key) }, 200, cors);
}

/** Approve or abandon a proposed plan — the explicit, recorded decision. */
export async function handleWriteDecide(req: Request, site: SiteRow, key: string, planId: string, principal: Principal, cors: Record<string, string>) {
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const verb = String(body?.decision || '');
  if (verb !== 'approve' && verb !== 'abandon') return json({ error: 'bad_request', message: 'Decide with approve or abandon.' }, 400, cors);
  const row = await decideWritePlan(site.id, planId, verb);
  if (!row) return json({ error: 'not_found', message: 'That plan isn’t open for a decision.' }, 404, cors);
  await auditWrite(site.id, key, verb === 'approve' ? 'write_approve' : 'write_abandon', `${row.status}: ${row.title}`, actorOf(principal));
  await notifyOwnerOfReviewerDecision(site, principal, `${verb === 'approve' ? 'Approved' : 'Passed on'}: ${row.title}`, `write:${planId}`);
  return json({ data: row }, 200, cors);
}

/** Execute an APPROVED plan. The approval law is enforced here AND in the executor. */
export async function handleWriteExecute(site: SiteRow, key: string, planId: string, principal: Principal, cors: Record<string, string>) {
  const p = providerByKey(key);
  if (!p) return json({ error: 'not_found', message: 'There’s no such connection.' }, 404, cors);
  const existing = await getWritePlan(site.id, planId);
  if (!existing) return json({ error: 'not_found', message: 'No such plan.' }, 404, cors);
  if (existing.status !== 'approved') {
    return json({ error: 'not_approved', message: existing.status === 'executed' ? 'This has already been done.' : 'Writes happen only after you approve them — that’s a law, not a setting.' }, 409, cors);
  }
  // L4.4: atomically claim the plan — the ONLY winner proceeds. Concurrent or
  // duplicate execute calls find it already claimed and are refused, so a write
  // can never happen twice. An interrupted claim becomes reclaimable after a
  // staleness window (never wedged).
  const plan = await claimWriteForExecution(site.id, planId);
  if (!plan) return json({ error: 'in_progress', message: 'This is already being carried out — nothing is done twice.' }, 409, cors);

  const result = await executeWrite(site.id, plan, p.customerLabel);
  if (!result.ok) {
    // recoverable, nothing attempted at the provider: release the claim, approval stands
    if (result.reason === 'not_available' || result.reason === 'not_connected') {
      await releaseWriteClaim(planId);
      const msg = result.reason === 'not_available'
        ? `Writing to ${p.customerLabel} isn’t switched on for this environment yet. Your approval is saved.`
        : `${p.customerLabel} needs a quick reconnect before this can run. Your approval is saved.`;
      return json({ error: result.reason, message: msg }, result.reason === 'not_available' ? 503 : 409, cors);
    }
    // attempted but the provider rejected it: record it, release for retry, nothing half-done
    await releaseWriteClaim(planId, result.response ?? null, { ok: false, note: 'The write did not complete; your approval stands and it can be tried again.' });
    await auditWrite(site.id, key, 'write_fail', `failed: ${plan.title}`, actorOf(principal));
    return json({ error: 'write_failed', message: `That didn’t go through, and nothing was half-done — your approval stands and it can be tried again.` }, 502, cors);
  }
  await markWriteOutcome(planId, 'executed', result.response ?? null, result.verification ?? null);
  await auditWrite(site.id, key, 'write_execute', `executed (${result.kind}): ${plan.title}${result.verification ? ` — ${result.verification.note}` : ''}`, actorOf(principal));
  return json({ data: { id: planId, status: 'executed', kind: result.kind, verification: result.verification, response: result.response } }, 200, cors);
}

/** Undo a reversible executed write, or explain honestly when undo is impossible.
 *  Rollback is itself a reviewed write: it prepares the inverse as a new proposed plan. */
export async function handleWriteRollback(site: SiteRow, key: string, planId: string, principal: Principal, cors: Record<string, string>) {
  const p = providerByKey(key);
  if (!p) return json({ error: 'not_found', message: 'There’s no such connection.' }, 404, cors);
  const plan = await getWritePlan(site.id, planId);
  if (!plan) return json({ error: 'not_found', message: 'No such plan.' }, 404, cors);
  if (plan.status !== 'executed') return json({ error: 'bad_request', message: 'Only a completed write can be rolled back.' }, 409, cors);
  if (!plan.reversible) {
    return json({ data: { reversible: false, explanation: plan.rollback } }, 200, cors);
  }
  // Handoffs: nothing was ever sent — the "undo" is simply that.
  if (plan.kind === 'handoff') {
    await auditWrite(site.id, key, 'write_rollback', `rollback (handoff, nothing to undo): ${plan.title}`, actorOf(principal));
    return json({ data: { reversible: true, done: true, explanation: plan.rollback } }, 200, cors);
  }
  // Real writes: prepare the INVERSE as a fresh proposed plan (rollback is reviewed too).
  let inverse = null;
  if (plan.workflow === 'gbp_hours' && plan.prior_state?.hours) {
    inverse = buildWritePlan('gbp_hours', p, { hours: plan.prior_state.hours });
  } else if (plan.workflow === 'gbp_post') {
    // deleting a post is itself a write; prepare it as a reviewable plan
    inverse = buildWritePlan('gbp_post', p, { text: '' });
    inverse.title = 'Remove the post from your Google listing';
    inverse.summary = 'Deletes the post this plan published. Your listing returns to exactly how it was before.';
    inverse.what_changes = ['The post is removed from your Google listing.'];
    (inverse.payload as any).delete_of = planId;
  }
  if (!inverse) return json({ data: { reversible: true, explanation: plan.rollback } }, 200, cors);
  const row = await saveWritePlan(site.id, inverse, null);
  await auditWrite(site.id, key, 'write_rollback', `prepared rollback plan for: ${plan.title}`, actorOf(principal));
  return json({ data: { reversible: true, rollback_plan: row, note: 'Prepared the undo as a plan for you to approve — even undoing is reviewed first.' } }, 200, cors);
}
