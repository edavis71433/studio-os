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

/** Record (or refresh) a deletion request — idempotent per client. `created` is
 *  true only when a NEW open request was inserted, so the caller can send the
 *  confirmation email once rather than on every (idempotent) re-request. */
export async function requestDeletion(clientId: string, siteId: string, requestedBy: string): Promise<{ ok: boolean; scheduled_for: string; created: boolean }> {
  const scheduled = new Date(Date.now() + coolingOffDays() * 86400_000).toISOString();
  // reactivate a canceled one or create fresh; never duplicate an open request
  const open = rows(await svc(`presence_account_deletions?client_id=eq.${enc(clientId)}&status=in.(pending,executing)&select=id,scheduled_for&limit=1`))[0];
  if (open) return { ok: true, scheduled_for: open.scheduled_for, created: false };
  const ins = await svc('presence_account_deletions', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ client_id: clientId, site_id: siteId, requested_by: requestedBy, requested_at: nowIso(), scheduled_for: scheduled, status: 'pending' }) });
  await svc(`presence_entitlements?client_id=eq.${enc(clientId)}&product=eq.presence`, { method: 'PATCH', body: JSON.stringify({ deletion_requested_at: nowIso() }) }).catch(() => {}); // compat
  return { ok: !!rows(ins)[0], scheduled_for: rows(ins)[0]?.scheduled_for || scheduled, created: !!rows(ins)[0] };
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
    // 1) STOP BILLING FIRST (keep the Stripe customer + past invoices for tax/audit).
    //    Ordering matters: if we revoked access before a failing cancel, a retry
    //    loop would leave the customer locked out AND still billed. Cancelling
    //    first means a cancel failure just retries with access intact.
    const ent = rows(await svc(`presence_entitlements?client_id=eq.${enc(clientId)}&product=eq.presence&select=stripe_subscription_id&limit=1`))[0] || {};
    if (ent.stripe_subscription_id) { const c = await cancelSubscription(ent.stripe_subscription_id); if (!c.ok) return { ok: false, error: `stripe_cancel: ${c.error}` }; }
    // 2) revoke access (the entitlement STATUS gate denies everything but export/legal)
    await svc(`presence_entitlements?client_id=eq.${enc(clientId)}&product=eq.presence`, { method: 'PATCH', body: JSON.stringify({ status: 'deleted' }) });
    // 3) take the hosted site(s) down + soft-delete the workspace row(s) (staged, recoverable)
    const sites = rows(await svc(`clients?id=eq.${enc(clientId)}&select=id`)).length
      ? rows(await svc(`presence_sites?client_id=eq.${enc(clientId)}&select=id,netlify_site_id,status`))
      : [];
    for (const s of sites) {
      if (s.netlify_site_id) await deleteSite(s.netlify_site_id).catch(() => {});
      await svc(`presence_sites?id=eq.${s.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'deleting', netlify_site_id: null, custom_domain: null }) }).catch(() => {});
    }
    // 4) DELETE THE AUTH USER — without this the login (and its email/last-IP
    //    metadata) survived "deletion". Runs BEFORE anonymization: a failure here
    //    retries with the lookup email intact (after anonymizing, the user would
    //    be unfindable and orphaned forever). GoTrue admin API; 404 = already done.
    const before = rows(await svc(`clients?id=eq.${enc(clientId)}&select=email,contact_email&limit=1`))[0] || {};
    for (const em of [before.email].filter((e: string) => e && !e.endsWith('@deleted.invalid'))) {
      try {
        const SB = Deno.env.get('SUPABASE_URL') || '';
        const KEY = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
        const uq = await fetch(`${SB}/auth/v1/admin/users?page=1&per_page=10&filter=${enc(em)}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
        const users = (await uq.json())?.users || [];
        const u = users.find((x: any) => String(x.email || '').toLowerCase() === String(em).toLowerCase());
        if (u?.id) {
          const del = await fetch(`${SB}/auth/v1/admin/users/${u.id}`, { method: 'DELETE', headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
          if (!del.ok && del.status !== 404) return { ok: false, error: `auth_delete: ${del.status}` };
        }
      } catch (e) { return { ok: false, error: `auth_delete: ${String((e as Error)?.message || e)}` }; }
    }
    // 5) anonymize the customer PII (retain the row so entitlement/payment FKs survive for tax/audit)
    await svc(`clients?id=eq.${enc(clientId)}`, { method: 'PATCH', body: JSON.stringify({ name: 'Deleted account', email: `deleted-${clientId}@deleted.invalid`, contact_email: null, status: 'deleted' }) }).catch(() => {});
    // 6) anonymize the CRM traces that carry the person's PII outside the client
    //    row (contacts + signups keyed by email) — retention there has no
    //    business basis once the account is deleted.
    for (const em of [before.email, before.contact_email].filter(Boolean).map((e: string) => e.trim().toLowerCase())) {
      if (em.endsWith('@deleted.invalid')) continue;
      await svc(`contacts?email=eq.${enc(em)}`, { method: 'PATCH', body: JSON.stringify({ name: 'Deleted account', email: `deleted-${clientId}@deleted.invalid`, phone: null, owner_notes: '' }) }).catch(() => {});
      await svc(`presence_signups?email=eq.${enc(em)}`, { method: 'PATCH', body: JSON.stringify({ email: `deleted-${clientId}@deleted.invalid`, business_name: 'Deleted account' }) }).catch(() => {});
    }
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
