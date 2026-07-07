// ── /marketplace/* (L5.5) — the pack management surface ─────────────────────
// OPERATOR: review packs, prepare/approve/execute/rollback install operations,
// audit history — every state change is an Approved Plan (lib/approved_plan.ts).
// CUSTOMER: sees FEATURES, never packages.
//   GET  /marketplace                       — operator: packs + states + updates
//   POST /marketplace/:key/prepare          — operator: propose an operation {op}
//   POST /marketplace/operations/:id/decide — operator: {approve|abandon}
//   POST /marketplace/operations/:id/execute— operator: run an APPROVED operation
//   POST /marketplace/operations/:id/rollback— operator: prepare the inverse op
//   GET  /marketplace/audit                 — operator: the operation ledger
//   GET  /marketplace/features              — customer: installed features, plain
import { json } from '../../_shared/http.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';
import { registeredPacks, resolvePack, resolveIndustryKey } from '../industry/registry.ts';
import { planMarketplaceOperation, customerFeatures, updateAvailable, MARKETPLACE_OPS } from '../industry/marketplace_ops.ts';
import type { MarketplaceOp } from '../industry/marketplace_ops.ts';
import {
  listInstalls, getInstall, saveOperation, listOperations, getOperation, decideOperation,
  claimOperation, releaseOperationClaim, markOperationOutcome, applyOperation, GLOBAL_SCOPE,
} from '../industry/marketplace_store.ts';

// Operator surface: staff, or system (service-role / cron). Never a client.
const staffOnly = (p: Principal) => p.kind === 'staff' || p.kind === 'system';

/** OPERATOR: every registered pack, its install state, and any update available. */
export async function handleMarketplaceList(principal: Principal, cors: Record<string, string>) {
  if (!staffOnly(principal)) return json({ error: 'forbidden', message: 'The pack marketplace is operator-only.' }, 403, cors);
  const installs = new Map((await listInstalls()).map((i) => [i.pack_key, i]));
  const packs = registeredPacks().map((p) => {
    const inst = installs.get(p.key);
    return {
      key: p.key, label: p.label, family: p.family, version: p.version,
      author: p.marketplace.author, license: p.marketplace.license, minPlatformVersion: p.marketplace.minPlatformVersion,
      state: inst ? inst.state : 'available',
      enabled: inst ? inst.enabled : false,
      update_available: !!inst && updateAvailable(inst.version, p.version),
      extends: p.extends,
    };
  });
  return json({ data: { platform_packs: packs.length, packs } }, 200, cors);
}

/** OPERATOR: propose a marketplace operation as an Approved Plan (validated). */
export async function handleMarketplacePrepare(req: Request, key: string, principal: Principal, cors: Record<string, string>) {
  if (!staffOnly(principal)) return json({ error: 'forbidden', message: 'Operator-only.' }, 403, cors);
  const pack = resolvePack(key);
  if (!pack || pack.key !== key) return json({ error: 'not_found', message: 'No such pack.' }, 404, cors);
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const op = String(body?.op || '') as MarketplaceOp;
  if (!MARKETPLACE_OPS.includes(op)) return json({ error: 'bad_op', message: `Operation must be one of: ${MARKETPLACE_OPS.join(', ')}.` }, 400, cors);
  const installedPacks = (await listInstalls()).map((i) => resolvePack(i.pack_key)).filter((p) => p.key !== 'generic');
  // for install, "installed" set should EXCLUDE this pack so duplicate detection is meaningful
  const others = installedPacks.filter((p) => p.key !== key);
  const plan = planMarketplaceOperation(op, pack, op === 'install' ? others : installedPacks);
  if (plan.blocked.length) return json({ error: 'refused', message: 'This operation can’t proceed.', problems: plan.blocked, data: plan }, 422, cors);
  const row = await saveOperation(plan);
  if (!row) return json({ error: 'write_failed', message: 'The operation didn’t save — nothing changed.' }, 502, cors);
  return json({ data: row }, 200, cors);
}

export async function handleMarketplaceDecide(req: Request, id: string, principal: Principal, cors: Record<string, string>) {
  if (!staffOnly(principal)) return json({ error: 'forbidden', message: 'Operator-only.' }, 403, cors);
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const verb = String(body?.decision || '');
  if (verb !== 'approve' && verb !== 'abandon') return json({ error: 'bad_request', message: 'Decide with approve or abandon.' }, 400, cors);
  const row = await decideOperation(id, verb);
  if (!row) return json({ error: 'not_found', message: 'That operation isn’t open for a decision.' }, 404, cors);
  return json({ data: row }, 200, cors);
}

/** OPERATOR: execute an APPROVED operation — approval enforced + atomic claim. */
export async function handleMarketplaceExecute(id: string, principal: Principal, cors: Record<string, string>) {
  if (!staffOnly(principal)) return json({ error: 'forbidden', message: 'Operator-only.' }, 403, cors);
  const existing = await getOperation(id);
  if (!existing) return json({ error: 'not_found', message: 'No such operation.' }, 404, cors);
  if (existing.status !== 'approved') return json({ error: 'not_approved', message: existing.status === 'executed' ? 'Already done.' : 'Operations run only after approval — a law, not a setting.' }, 409, cors);
  if ((existing.blocked || []).length) return json({ error: 'refused', message: 'This operation failed validation and cannot run.', problems: existing.blocked }, 422, cors);
  const claimed = await claimOperation(id);
  if (!claimed) return json({ error: 'in_progress', message: 'This operation is already being carried out.' }, 409, cors);
  try {
    const applied = await applyOperation(claimed.op, claimed.pack_key, claimed.version);
    // verify by reading the install state back
    const inst = await getInstall(claimed.pack_key);
    const verified = claimed.op === 'remove' ? !inst : (!!inst && inst.state === applied.state);
    const result = { applied: applied.state, verified, note: verified ? 'Confirmed by reading the install state back.' : 'Applied but not yet confirmed.' };
    await markOperationOutcome(id, 'executed', result);
    return json({ data: { id, status: 'executed', op: claimed.op, pack_key: claimed.pack_key, result } }, 200, cors);
  } catch (_e) {
    await releaseOperationClaim(id, { error: 'apply_failed' });
    return json({ error: 'apply_failed', message: 'That didn’t complete, and nothing was half-done — the approval stands and it can be retried.' }, 502, cors);
  }
}

/** OPERATOR: prepare the inverse operation as a NEW proposed plan (reviewed undo). */
export async function handleMarketplaceRollback(id: string, principal: Principal, cors: Record<string, string>) {
  if (!staffOnly(principal)) return json({ error: 'forbidden', message: 'Operator-only.' }, 403, cors);
  const op = await getOperation(id);
  if (!op) return json({ error: 'not_found', message: 'No such operation.' }, 404, cors);
  if (op.status !== 'executed') return json({ error: 'bad_request', message: 'Only a completed operation can be rolled back.' }, 409, cors);
  const pack = resolvePack(op.pack_key);
  const inverseMap: Record<string, MarketplaceOp> = { install: 'remove', enable: 'disable', disable: 'enable', update: 'update', remove: 'install' };
  const inverse = inverseMap[op.op];
  if (!inverse) return json({ data: { reversible: false, explanation: op.rollback } }, 200, cors);
  const installedPacks = (await listInstalls()).map((i) => resolvePack(i.pack_key));
  const plan = planMarketplaceOperation(inverse, pack, installedPacks);
  const row = await saveOperation(plan);
  return json({ data: { rollback_operation: row, note: 'Prepared the undo as a new operation for you to approve — even undoing is reviewed first.' } }, 200, cors);
}

export async function handleMarketplaceAudit(principal: Principal, cors: Record<string, string>) {
  if (!staffOnly(principal)) return json({ error: 'forbidden', message: 'Operator-only.' }, 403, cors);
  return json({ data: await listOperations() }, 200, cors);
}

/** CUSTOMER: the features their pack provides — never packages, never versions. */
export async function handleMarketplaceFeatures(site: SiteRow, cors: Record<string, string>) {
  const key = resolveIndustryKey(site.template_slug);
  const pack = resolvePack(key);
  const { features } = customerFeatures(pack);
  return json({ data: { features, note: 'These come with your kind of business — nothing to install or manage.' } }, 200, cors);
}
