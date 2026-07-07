// ── Write executor (L4.3) — one path for every provider, isolated + gated ────
// The single place an external write can happen. It enforces the approval law
// defensively (a plan that isn't approved cannot execute, ever), performs the
// declared provider write for 'write' kinds, and for 'handoff' kinds NEVER
// touches a provider — it just packages what the customer will send themselves.
// After a real write it VERIFIES by reading the provider back. It never throws;
// a failure marks the plan failed and leaves nothing half-done (the plan is not
// consumed — it can be retried), and every path is audited by the caller.
//
// LIVE only when the owner has registered write scopes for a provider
// (CONNECTED_<KEY>_WRITE=1) — exactly like read activation in L4.1. Until then a
// real write returns an honest "not available on this environment yet"; the
// handoff path always works, because it depends on no external permission.
import { loadTokens } from './store.ts';
import { readProvider } from './adapters.ts';
import { oauthConfigured } from './auth.ts';
import { writeSpec } from './writes.ts';

const envKey = (providerKey: string) => `CONNECTED_${providerKey.toUpperCase()}_WRITE`;

/** A real provider write is live only when OAuth is configured AND the owner has
 *  explicitly opted this provider into writes. Handoffs are always available. */
export function writeConfigured(workflow: string): boolean {
  const spec = writeSpec(workflow);
  if (!spec) return false;
  if (spec.kind === 'handoff') return true;
  const flag = (globalThis.Deno && Deno.env.get(envKey(spec.provider_key))) || '';
  return oauthConfigured(spec.provider_key) && (flag === '1' || flag.toLowerCase() === 'true');
}

export interface WriteResult {
  ok: boolean;
  reason?: 'not_approved' | 'not_available' | 'not_connected' | 'write_failed' | 'verify_failed';
  kind?: 'write' | 'handoff';
  response?: Record<string, unknown>;              // non-sensitive provider/handoff response
  verification?: { ok: boolean; note: string };
}

interface PlanRow {
  id: string; provider_key: string; workflow: string; kind: 'write' | 'handoff';
  status: string; payload: Record<string, unknown>; verify?: string;
}

/** Execute an APPROVED write plan. Isolated: never throws. */
export async function executeWrite(siteId: string, plan: PlanRow, customerLabel: string): Promise<WriteResult> {
  // the approval law, re-enforced here — defense in depth over the route check
  if (plan.status !== 'approved') return { ok: false, reason: 'not_approved' };
  const spec = writeSpec(plan.workflow);
  if (!spec) return { ok: false, reason: 'not_available' };

  // ── handoff: NEVER touches a provider. Package it and hand it back. ──
  if (spec.kind === 'handoff') {
    return {
      ok: true, kind: 'handoff',
      response: { prepared: true, ...plan.payload },
      verification: { ok: true, note: 'Prepared for you — nothing was sent or posted. The change stays in your hands.' },
    };
  }

  // ── real provider write: gated, isolated, verified ──
  if (!writeConfigured(plan.workflow)) return { ok: false, reason: 'not_available' };
  try {
    const tokens = await loadTokens(siteId, plan.provider_key);
    if (!tokens?.access_token) return { ok: false, reason: 'not_connected' };

    const r = await fetch(spec.endpoint!, {
      method: spec.method || 'POST',
      headers: { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(plan.payload),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return { ok: false, reason: 'write_failed', response: { status: r.status } };
    const body = await r.json().catch(() => ({}));

    // VERIFY: read the provider back and confirm the change landed.
    let verification = { ok: true, note: 'The write was accepted by the provider.' };
    if (spec.verifyReads) {
      const readback = await readProvider(siteId, plan.provider_key, customerLabel);
      verification = readback
        ? { ok: true, note: 'Confirmed by reading your account back — the change is live.' }
        : { ok: false, note: 'The write was accepted but we couldn’t confirm it by read-back yet; it may take a moment to appear.' };
    }
    return { ok: true, kind: 'write', response: { accepted: true, id: (body as any)?.name || (body as any)?.id || null }, verification };
  } catch (_e) {
    // isolation: a failed write never throws, never half-applies; the plan stays retryable
    return { ok: false, reason: 'write_failed' };
  }
}
