// ── Entitlement sync + reconciliation (single writer of entitlement truth) ───
// applyEntitlementPatch is the ONE place a Stripe-derived patch is written onto
// presence_entitlements (used by the webhook's billing-sync AND the reconciler,
// so there is no second, drifting copy). runBillingReconcile is the safety net:
// webhooks can be missed (Stripe outage, our 500s exhausting retries, a livemode
// filter, a dropped delivery), and without a reconcile a customer could keep
// access after cancelling — or lose it after paying. It re-derives truth from
// Stripe on a schedule and corrects only real drift.
import { svc } from '../lib/db.ts';
import { lifecycleCopy } from './lifecycle.ts';
import { sendEmail } from './account.ts';
import { stripeConfigured, retrieveSubscription } from './stripe.ts';
import { entitlementPatchFromSubscription } from './subscriptions.ts';
import type { EntitlementPatch } from './subscriptions.ts';

const enc = encodeURIComponent;

/** PATCH only the defined keys of a patch onto an existing entitlement row.
 *  Detects lapsed/paused → active reactivation and fires a one-per-month
 *  welcome-back (best-effort, never blocks the billing write). */
export async function applyEntitlementPatch(clientId: string, patch: EntitlementPatch): Promise<boolean> {
  // CP-3: reactivation detection — lapsed/paused → active gets a welcome-back.
  // L4: also read the prior grace_until to ANCHOR the grace clock (below).
  let priorStatus = '', priorGrace: string | null = null;
  try {
    const pr = await svc(`presence_entitlements?client_id=eq.${enc(clientId)}&product=eq.presence&select=status,grace_until&limit=1`);
    priorStatus = String(pr.json?.[0]?.status || '');
    priorGrace = pr.json?.[0]?.grace_until ?? null;
  } catch { /* */ }
  const body: Record<string, unknown> = { status: patch.status };
  const carry: (keyof EntitlementPatch)[] = [
    'plan', 'term', 'founder', 'trial_ends_at', 'stripe_customer_id', 'stripe_subscription_id',
    'current_period_end', 'cancel_at_period_end', 'canceled_at', 'grace_until',
  ];
  for (const k of carry) if (patch[k] !== undefined) body[k] = patch[k] as unknown;
  // L4 — ANCHOR the grace clock to the FIRST past-due event. entitlementPatch-
  // FromSubscription resets grace_until to now+14 on EVERY past_due event, so the
  // 14-day window would slide forward forever and never expire. If we're still in
  // grace (incoming grace_until set) and an earlier anchor exists, keep the
  // earlier one so the window actually ends and enforcement can fire.
  if (patch.grace_until && priorGrace && Date.parse(priorGrace) < Date.parse(patch.grace_until)) {
    body['grace_until'] = priorGrace;
  }
  const r = await svc(`presence_entitlements?client_id=eq.${enc(clientId)}&product=eq.presence`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body),
  });
  const applied = r.ok && Array.isArray(r.json) && r.json.length > 0;
  if (applied && patch.status === 'active' && (priorStatus === 'lapsed' || priorStatus === 'paused')) {
    try {
      const [siteQ, clQ] = await Promise.all([
        svc(`presence_sites?client_id=eq.${enc(clientId)}&select=id&limit=1`),
        svc(`clients?id=eq.${enc(clientId)}&select=email,name&limit=1`),
      ]);
      const copy = lifecycleCopy('welcome_back', String(clQ.json?.[0]?.name || ''));
      // L5 — send-once: the welcome-back EMAIL rides the notice insert. Ask for
      // the inserted row back (ignore-duplicates → empty when it already exists
      // this month) and email ONLY when the notice is newly created. Without this
      // a pause→reactivate→pause→reactivate in one month re-emails every time.
      let freshNotice = false;
      if (siteQ.json?.[0]?.id) {
        const ins = await svc('presence_plan_notices?on_conflict=client_id,kind,period', {
          method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
          body: JSON.stringify({ site_id: siteQ.json[0].id, client_id: clientId, kind: 'welcome_back', period: new Date().toISOString().slice(0, 7), headline: copy.headline, body: copy.body, status: 'active' }),
        });
        freshNotice = ins.ok && Array.isArray(ins.json) && ins.json.length > 0;
      }
      if (freshNotice && clQ.json?.[0]?.email) sendEmail(clQ.json[0].email, copy.subject, copy.html).catch(() => {});
    } catch { /* welcome-back is best-effort, never blocks billing truth */ }
  }
  return applied;
}

// Does the stored entitlement disagree with Stripe truth on a field that matters?
function driftsFrom(stored: any, patch: EntitlementPatch): string[] {
  const diffs: string[] = [];
  const norm = (v: unknown) => (v === undefined || v === null ? null : String(v));
  if (norm(stored.status) !== norm(patch.status)) diffs.push(`status ${stored.status}→${patch.status}`);
  if (patch.plan && norm(stored.plan) !== norm(patch.plan)) diffs.push(`plan ${stored.plan}→${patch.plan}`);
  if (norm(stored.cancel_at_period_end) !== norm(patch.cancel_at_period_end)) diffs.push('cancel_at_period_end');
  // period end can legitimately advance on renewal — treat only a value change as drift
  if (norm(stored.current_period_end) !== norm(patch.current_period_end)) diffs.push('current_period_end');
  return diffs;
}

export interface ReconcileResult { checked: number; corrected: number; errors: number; skipped_no_stripe: boolean }

/** Scheduled reconciliation: for entitlements tied to a live Stripe subscription,
 *  re-derive truth from Stripe and correct real drift. Bounded; best-effort;
 *  never throws. A no-Stripe environment is a clean no-op. */
export async function runBillingReconcile(limit = 40): Promise<ReconcileResult> {
  if (!stripeConfigured()) return { checked: 0, corrected: 0, errors: 0, skipped_no_stripe: true };
  const now = new Date();
  const q = await svc(`presence_entitlements?product=eq.presence&status=in.(active,paused,lapsed)&stripe_subscription_id=not.is.null&select=client_id,status,plan,current_period_end,cancel_at_period_end,stripe_subscription_id&order=updated_at.asc&limit=${Math.max(1, Math.min(100, limit))}`);
  const rows: any[] = Array.isArray(q.json) ? q.json : [];
  let checked = 0, corrected = 0, errors = 0;
  for (const row of rows) {
    const subId = String(row.stripe_subscription_id || '');
    if (!subId) continue;
    checked++;
    try {
      const sub = await retrieveSubscription(subId);
      if (!sub || sub.error || !sub.id) { // a deleted/unreadable sub is not drift we can act on safely
        console.error(`[reconcile] could not read subscription ${subId} for client ${row.client_id} (skipped)`);
        continue;
      }
      const patch = entitlementPatchFromSubscription(sub, now);
      const diffs = driftsFrom(row, patch);
      if (diffs.length) {
        const ok = await applyEntitlementPatch(String(row.client_id), patch);
        if (ok) { corrected++; console.log(`[reconcile] corrected client ${row.client_id} (${subId}): ${diffs.join(', ')}`); }
        else { errors++; console.error(`[reconcile] FAILED to correct client ${row.client_id} (${subId}): ${diffs.join(', ')}`); }
      }
    } catch (e) {
      errors++;
      console.error(`[reconcile] error on client ${row.client_id} (${subId}): ${String((e as Error)?.message || e)}`);
    }
  }
  if (corrected || errors) console.log(`[reconcile] checked ${checked}, corrected ${corrected}, errors ${errors}`);
  return { checked, corrected, errors, skipped_no_stripe: false };
}
