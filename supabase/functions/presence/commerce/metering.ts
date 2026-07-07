// ── L2 · AI Metering — service role ─────────────────────────────────────────
// Records every metered AI operation to the internal rollup + event log, and
// raises the single calm capacity notice when a customer consistently outgrows
// their plan. The customer NEVER sees a credit, a token, or a count — only the
// notice, and only when it genuinely helps them.
//
// Fire-and-forget everywhere: metering must never slow or break a customer's AI
// operation. A failed meter write is logged and swallowed.

import { svc } from '../lib/db.ts';
import type { ModelFn } from '../writer/model.ts';
import type { SiteRow } from '../lib/site.ts';
import type { PlanKey } from './catalog.ts';
import { PLANS, planByKey } from './catalog.ts';
import { classifyAgent, generativeAllowance, overCapacity, approachingCapacity, periodOf } from './capacity.ts';

export interface MeterCtx { siteId: string | null; clientId: string; agent: string; }

// Record one metered AI operation (upsert rollup + append event) via the atomic
// SECURITY DEFINER function. Never throws.
export async function recordUsage(ctx: MeterCtx, model: string | null, inTok: number | null, outTok: number | null, now: Date = new Date()): Promise<void> {
  try {
    const kind = classifyAgent(ctx.agent);
    await svc('rpc/presence_ai_meter', {
      method: 'POST',
      body: JSON.stringify({
        p_client_id: ctx.clientId, p_site_id: ctx.siteId, p_period: periodOf(now),
        p_agent: ctx.agent, p_kind: kind, p_model: model,
        p_input_tokens: inTok, p_output_tokens: outTok,
      }),
    });
  } catch (e) {
    console.error(`[metering] failed to record ${ctx.agent} usage for ${ctx.clientId}: ${String(e)} (non-fatal)`);
  }
}

// Wrap an injected ModelFn so every call it makes is metered with real token
// counts. Used where the model is injected (Writer, Editor). The wrapper is
// transparent — it returns the model's result unchanged.
export function meterModel(fn: ModelFn | null, ctx: MeterCtx): ModelFn | null {
  if (!fn) return null;
  return async (system: string, user: string) => {
    const res = await fn(system, user);
    // meter only successful calls that actually spent tokens
    if (res.ok) recordUsage(ctx, res.model || null, res.input_tokens ?? null, res.output_tokens ?? null).catch(() => {});
    return res;
  };
}

// Current-period usage for a client. Returns zeros if no row yet.
export async function usageThisPeriod(clientId: string, now: Date = new Date()): Promise<{ generative: number; assistive: number }> {
  const r = await svc(`presence_ai_usage?client_id=eq.${encodeURIComponent(clientId)}&period=eq.${periodOf(now)}&select=generative_ops,assistive_ops&limit=1`);
  const row = r.ok && Array.isArray(r.json) && r.json.length ? r.json[0] : null;
  return { generative: row?.generative_ops || 0, assistive: row?.assistive_ops || 0 };
}

// The next self-serve rung up from a plan (for the upgrade suggestion), or null.
function nextRungUp(plan: PlanKey): { key: PlanKey; name: string } | null {
  const cur = planByKey(plan);
  if (!cur) return null;
  const up = PLANS.filter((p) => p.selfServe && p.rank > cur.rank).sort((a, b) => a.rank - b.rank)[0];
  return up ? { key: up.key, name: up.name } : null;
}

// After metering a generative op, raise the capacity notice IF the customer has
// consistently outgrown their plan this month. One notice per customer per month
// (unique constraint dedupes). Never blocks; returns whether a notice is active.
// Copy is calm and NUMBER-FREE by law.
export async function raiseCapacityNoticeIfNeeded(site: SiteRow, plan: PlanKey, now: Date = new Date()): Promise<boolean> {
  const cap = generativeAllowance(plan);
  if (cap == null) return false; // unlimited plans never nudge
  const used = (await usageThisPeriod(site.client_id, now)).generative;
  if (!overCapacity(plan, used)) return false; // only when they've actually reached the envelope

  const up = nextRungUp(plan);
  const headline = 'Your business is getting a lot from Studio OS this month';
  const body = up
    ? `You've been using the writing and guidance features heavily — your current plan has handled it well, but you're at the point where ${up.name} would give you more room. There's nothing you need to do; it's here whenever it helps.`
    : `You've been using the writing and guidance features heavily — your current plan has handled it well. If you'd like more capacity, we're happy to talk it through.`;

  try {
    await svc('presence_plan_notices?on_conflict=client_id,kind,period', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ site_id: site.id, client_id: site.client_id, kind: 'capacity', period: periodOf(now), headline, body, status: 'active' }),
    });
    return true;
  } catch (e) {
    console.error(`[metering] failed to raise capacity notice for ${site.client_id}: ${String(e)} (non-fatal)`);
    return false;
  }
}
