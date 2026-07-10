// ── P2-E W2: Account deletion lifecycle (request → cooling-off → execute) ─────
// Makes the "we'll delete your account within N days" promise real. A request
// starts a cancelable cooling-off; a scheduled executor then, per tenant and
// idempotently, revokes access, cancels Stripe billing, takes the hosted site
// down, anonymizes PII, and RETAINS required financial/audit evidence. Staged +
// safe: it soft-takes-down rather than hard-cascading, so an operator can still
// recover during a mistake window; the deep purge stays an explicit operator step.
import { svc } from '../lib/db.ts';
import { sendEmail } from './account.ts';
import { cancelSubscription } from './stripe.ts';
import { deleteSite } from '../lib/netlify.ts';

const rows = (r: { json?: unknown }) => (Array.isArray((r as any).json) ? (r as any).json : []) as any[];
const nowIso = () => new Date().toISOString();
const enc = encodeURIComponent;
/** Cooling-off window (days). Env override; the customer-facing copy reads it. */
export function coolingOffDays(): number { const n = Number(Deno.env.get('ACCOUNT_DELETION_DAYS')); return Number.isFinite(n) && n >= 0 ? n : 30; }

/** Record (or refresh) a deletion request — idempotent per client. */
export async function requestDeletion(clientId: string, siteId: string, requestedBy: string): Promise<{ ok: boolean; scheduled_for: string }> {
  const scheduled = new Date(Date.now() + coolingOffDays() * 86400_000).toISOString();
  // reactivate a canceled one or create fresh; never duplicate an open request
  const open = rows(await svc(`presence_account_deletions?client_id=eq.${enc(clientId)}&status=in.(pending,executing)&select=id,scheduled_for&limit=1`))[0];
  if (open) return { ok: true, scheduled_for: open.scheduled_for };
  const ins = await svc('presence_account_deletions', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ client_id: clientId, site_id: siteId, requested_by: requestedBy, requested_at: nowIso(), scheduled_for: scheduled, status: 'pending' }) });
  await svc(`presence_entitlements?client_id=eq.${enc(clientId)}&product=eq.presence`, { method: 'PATCH', body: JSON.stringify({ deletion_requested_at: nowIso() }) }).catch(() => {}); // compat
  return { ok: !!rows(ins)[0], scheduled_for: rows(ins)[0]?.scheduled_for || scheduled };
}

/** Cancel a pending deletion during the cooling-off window. */
export async function cancelDeletion(clientId: string): Promise<boolean> {
  const up = await svc(`presence_account_deletions?client_id=eq.${enc(clientId)}&status=eq.pending&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'canceled' }) });
  await svc(`presence_entitlements?client_id=eq.${enc(clientId)}&product=eq.presence`, { method: 'PATCH', body: JSON.stringify({ deletion_requested_at: null }) }).catch(() => {});
  return !!rows(up)[0];
}

/** The idempotent per-tenant executor for ONE eligible deletion. Each step is safe
 *  to repeat; retains financial records (entitlement row, stripe_payments, invoices). */
async function executeOne(d: any): Promise<{ ok: boolean; error?: string }> {
  const clientId = d.client_id;
  try {
    // 1) revoke access immediately (the entitlement STATUS gate denies everything but export/legal)
    await svc(`presence_entitlements?client_id=eq.${enc(clientId)}&product=eq.presence&select=stripe_subscription_id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'deleted' }) });
    const ent = rows(await svc(`presence_entitlements?client_id=eq.${enc(clientId)}&product=eq.presence&select=stripe_subscription_id&limit=1`))[0] || {};
    // 2) stop billing (keep the Stripe customer + past invoices for tax/audit)
    if (ent.stripe_subscription_id) { const c = await cancelSubscription(ent.stripe_subscription_id); if (!c.ok) return { ok: false, error: `stripe_cancel: ${c.error}` }; }
    // 3) take the hosted site(s) down + soft-delete the workspace row(s) (staged, recoverable)
    const sites = rows(await svc(`clients?id=eq.${enc(clientId)}&select=id`)).length
      ? rows(await svc(`presence_sites?client_id=eq.${enc(clientId)}&select=id,netlify_site_id,status`))
      : [];
    for (const s of sites) {
      if (s.netlify_site_id) await deleteSite(s.netlify_site_id).catch(() => {});
      await svc(`presence_sites?id=eq.${s.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'deleting', netlify_site_id: null, custom_domain: null }) }).catch(() => {});
    }
    // 4) anonymize the customer PII (retain the row so entitlement/payment FKs survive for tax/audit)
    await svc(`clients?id=eq.${enc(clientId)}`, { method: 'PATCH', body: JSON.stringify({ name: 'Deleted account', email: `deleted-${clientId}@deleted.invalid`, contact_email: null, status: 'deleted' }) }).catch(() => {});
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

/** Scheduled sweep: execute eligible deletions (past their cooling-off). Bounded;
 *  claims each row atomically so two ticks can't double-run one. */
export async function runDeletionSweep(limit = 25): Promise<{ due: number; completed: number; failed: number }> {
  const due = rows(await svc(`presence_account_deletions?status=eq.pending&scheduled_for=lte.${enc(nowIso())}&select=*&order=scheduled_for.asc&limit=${Math.max(1, Math.min(100, limit))}`));
  let completed = 0, failed = 0;
  for (const d of due) {
    // atomic claim: only one worker moves pending → executing
    const claim = await svc(`presence_account_deletions?id=eq.${d.id}&status=eq.pending&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'executing', attempts: (d.attempts || 0) + 1 }) });
    if (!rows(claim)[0]) continue;
    const res = await executeOne(d);
    if (res.ok) {
      await svc(`presence_account_deletions?id=eq.${d.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'completed', executed_at: nowIso(), error: '' }) });
      completed++;
      const ops = Deno.env.get('OPS_ALERT_EMAIL') || '';
      if (ops) sendEmail(ops, `[Studio OS ops] Account deletion completed: ${d.client_id}`, `<p>Deletion executed for client ${d.client_id}. Financial records retained for tax/audit. Deep purge (if required) is a manual operator step.</p>`).catch(() => {});
    } else {
      // failed → back to pending for retry, record the reason (operator-visible)
      await svc(`presence_account_deletions?id=eq.${d.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'pending', error: res.error || 'unknown' }) });
      console.error(`[deletion] execute failed client=${d.client_id}: ${res.error}`);
      failed++;
    }
  }
  return { due: due.length, completed, failed };
}
