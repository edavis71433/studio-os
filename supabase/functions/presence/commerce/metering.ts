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
import { PLANS, planByKey, isPlanKey } from './catalog.ts';
import { classifyAgent, generativeAllowance, overCapacity, approachingCapacity, periodOf, hardCeilingUsd } from './capacity.ts';
import { estimateUsageCostUsd } from './pricing.ts';

export interface MeterCtx { siteId: string | null; clientId: string; agent: string; }

// ── HARD cost ceiling — enforced BEFORE a provider call ──────────────────────
export interface CeilingResult { allowed: boolean; reason?: string; ceiling_usd?: number; spent_usd?: number; plan?: PlanKey; }
/** Is this tenant allowed to make another (paid) AI call this period? Reads the
 *  authoritative usage cost + the plan's hard ceiling. Founder / null-ceiling
 *  plans / operator env overrides bypass. Safe across instances: each op atomically
 *  increments the ledger, so sustained calls converge on the ceiling (at most a
 *  small concurrent overshoot). A dismissed NOTICE cannot bypass this. */
export async function checkAiCeiling(clientId: string, now: Date = new Date()): Promise<CeilingResult> {
  try {
    if ((Deno.env.get('AI_CEILING_DISABLED') || '').toLowerCase() === 'true') return { allowed: true };
    const overrides = (Deno.env.get('AI_UNLIMITED_CLIENTS') || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (overrides.includes(clientId)) return { allowed: true };
    const ent = (await svc(`presence_entitlements?client_id=eq.${encodeURIComponent(clientId)}&product=eq.presence&select=plan,founder&limit=1`)).json?.[0] || {};
    if (ent.founder === true) return { allowed: true };                       // founder override (auditable on the entitlement)
    const plan: PlanKey = isPlanKey(ent.plan) ? ent.plan : 'presence';
    let ceiling = hardCeilingUsd(plan);
    if (ceiling == null) return { allowed: true, plan };                       // pooled-by-contract plans have no ceiling
    const mult = Number(Deno.env.get('AI_CEILING_MULT')) || 1;
    ceiling = ceiling * (mult > 0 ? mult : 1);
    const row = (await svc(`presence_ai_usage?client_id=eq.${encodeURIComponent(clientId)}&period=eq.${periodOf(now)}&select=input_tokens,output_tokens,images&limit=1`)).json?.[0] || {};
    const spent = estimateUsageCostUsd([{ input_tokens: row.input_tokens, output_tokens: row.output_tokens, images: row.images }]).total_usd;
    if (spent >= ceiling) { console.warn(`[ai-ceiling] BLOCK client=${clientId} plan=${plan} spent=$${spent} ceiling=$${ceiling}`); return { allowed: false, reason: 'ai_cost_ceiling', ceiling_usd: ceiling, spent_usd: spent, plan }; }
    return { allowed: true, ceiling_usd: ceiling, spent_usd: spent, plan };
  } catch (e) {
    console.error(`[ai-ceiling] check failed for ${clientId}: ${String(e)} — failing OPEN (never wrongly block a paying customer)`);
    return { allowed: true };                                                 // a lookup hiccup must never block a paying customer
  }
}

/** The friendly 429 body when the hard ceiling is reached. */
export function ceilingDenial(cors: Record<string, string>) {
  return { body: { error: 'ai_cost_ceiling', upgrade: true, message: 'You’ve used all of this month’s AI generation on your current plan. It resets next month — or upgrade for more room. Everything you’ve already made is safe, and the manual tools always work.' }, status: 429, cors };
}

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
        p_input_tokens: inTok, p_output_tokens: outTok, p_images: 0,
      }),
    });
  } catch (e) {
    console.error(`[metering] failed to record ${ctx.agent} usage for ${ctx.clientId}: ${String(e)} (non-fatal)`);
  }
}

/** Record IMAGE generation (the cost-bearing Visual Studio op). One generative op
 *  that produced `images` images; both are metered so cost reporting is non-zero. */
export async function recordImageUsage(ctx: MeterCtx, model: string | null, images: number, now: Date = new Date()): Promise<void> {
  if (!images || images < 1) return;
  try {
    await svc('rpc/presence_ai_meter', { method: 'POST',
      body: JSON.stringify({ p_client_id: ctx.clientId, p_site_id: ctx.siteId, p_period: periodOf(now), p_agent: ctx.agent, p_kind: 'generative', p_model: model, p_input_tokens: 0, p_output_tokens: 0, p_images: Math.trunc(images) }) });
  } catch (e) {
    console.error(`[metering] failed to record image usage for ${ctx.clientId}: ${String(e)} (non-fatal)`);
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
    // NOT raiseNotice(): this is deliberately resolution=merge-duplicates — a
    // PATCH-on-conflict that refreshes the copy (the upgrade suggestion can
    // change mid-month) and re-activates the notice while the customer is still
    // over capacity. raiseNotice's ignore-duplicates insert can't express that.
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
