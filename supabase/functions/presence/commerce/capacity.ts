// ── L2 · AI Capacity — PURE ─────────────────────────────────────────────────
// The commercial AI policy as data. No I/O. Two orthogonal ideas:
//
//   ELIGIBILITY  — does this plan include this AI capability at all?
//                  "Drafting" (Writer, Editor) belongs to Presence-and-up;
//                  Monitor is observational only. A HARD entitlement boundary.
//
//   CAPACITY     — has this customer used more generative AI than their plan's
//                  generous monthly envelope? A SOFT limit: it NEVER blocks work
//                  and NEVER shows a number — it only raises one calm notice.
//
// Grounded in constitution Part 5 ("the client never sees a credit"; assistive
// unlimited; generative generous soft caps; sustained use → a plan conversation)
// and the L1.5 audit. Numbers are tunable here — the one place — and are
// deliberately generous: a normal owner never approaches them.

import type { PlanKey } from './catalog.ts';

// The generative envelope per plan (operations/month). null = effectively
// unlimited (Managed's work is done FOR them; Agency/Enterprise are pooled by
// contract). These are proposed defaults — set from real telemetry over time.
interface PlanCapacity { generativeMonthly: number | null; allowsDrafting: boolean; }
const CAPACITY: Record<PlanKey, PlanCapacity> = {
  presence_monitor:  { generativeMonthly: 15,   allowsDrafting: false }, // observational only; no draft-to-publish
  cms_only:          { generativeMonthly: 60,   allowsDrafting: true },  // full website drafting, no Business-OS brains
  business_os_only:  { generativeMonthly: 30,   allowsDrafting: false }, // intelligence only; no website drafting
  presence:          { generativeMonthly: 60,   allowsDrafting: true },
  presence_managed:  { generativeMonthly: null, allowsDrafting: true },  // concierge does the work
  agency:            { generativeMonthly: null, allowsDrafting: true },
  enterprise:        { generativeMonthly: null, allowsDrafting: true },
};

// An agent's operation class. Generative ops are the capacity-bearing ones
// (open-ended content creation on request). Assistive = bounded rework, always
// available. Analysis = findings/guidance, always available.
export type OpClass = 'generative' | 'assistive' | 'analysis';
const AGENT_CLASS: Record<string, OpClass> = {
  writer: 'generative',     // draft-on-request — the archetypal generative op
  coach: 'generative',      // seasonal/opportunity idea generation
  visual: 'generative',     // AI image generation (the most expensive op) — was misclassified as analysis
  editor: 'assistive',      // rework existing copy in voice
  concierge: 'assistive',   // polish an answer
  reviewer: 'analysis',     // consistency findings
  guardian: 'analysis',     // brand findings
};

// ── HARD per-tenant monthly cost ceiling (USD) — a real STOP, not a notice ───
// Enforced BEFORE a provider call (see commerce/metering.ts checkAiCeiling). null
// = no ceiling (Managed/Agency/Enterprise are pooled by contract). Generous —
// a normal owner never approaches it; the soft capacity NOTICE fires far below.
// Tunable here (the one place); env AI_CEILING_MULT scales all, AI_CEILING_DISABLED
// kills the gate, AI_UNLIMITED_CLIENTS exempts specific clients (all in metering.ts).
const HARD_CEILING_USD: Record<PlanKey, number | null> = {
  presence_monitor: 3,
  cms_only: 12,
  business_os_only: 8,
  presence: 12,
  presence_managed: null,
  agency: null,
  enterprise: null,
};
/** The plan's hard monthly AI cost ceiling in USD, or null for unlimited. Pure. */
export function hardCeilingUsd(plan: PlanKey): number | null {
  return HARD_CEILING_USD[plan] ?? null;
}

// The "drafting workflows" that belong to Presence-and-up. Monitor cannot reach
// these — enforced from the entitlement, never by hiding UI.
const DRAFTING_AGENTS = new Set(['writer', 'editor']);

export function classifyAgent(agent: string): OpClass {
  return AGENT_CLASS[agent] || 'analysis';
}

export function isDraftingAgent(agent: string): boolean {
  return DRAFTING_AGENTS.has(agent);
}

export function planAllowsDrafting(plan: PlanKey): boolean {
  return CAPACITY[plan]?.allowsDrafting ?? true;
}

// The generative monthly envelope for a plan (null = unlimited).
export function generativeAllowance(plan: PlanKey): number | null {
  return CAPACITY[plan] ? CAPACITY[plan].generativeMonthly : null;
}

// Is a customer over their plan's generative envelope? Unlimited plans never are.
export function overCapacity(plan: PlanKey, generativeOpsThisPeriod: number): boolean {
  const cap = generativeAllowance(plan);
  if (cap == null) return false;
  return generativeOpsThisPeriod >= cap;
}

// A gentle "approaching" signal (>= 80% of the envelope) — used to time the
// notice a little before the customer actually hits the ceiling, so the message
// reads as "you're approaching" not "you've hit a wall".
export function approachingCapacity(plan: PlanKey, generativeOpsThisPeriod: number): boolean {
  const cap = generativeAllowance(plan);
  if (cap == null) return false;
  return generativeOpsThisPeriod >= Math.floor(cap * 0.8);
}

// The 'YYYY-MM' billing period for a moment in time (UTC). Injected date → pure.
export function periodOf(now: Date): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}
