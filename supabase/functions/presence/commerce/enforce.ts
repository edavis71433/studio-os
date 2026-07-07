// ── L2 · Plan enforcement for AI — from entitlements, never UI ──────────────
// The drafting workflows (Writer, Editor) belong to Presence-and-up. Monitor is
// observational: it watches an existing site and guides, but Studio OS does not
// draft or publish for it. This gate reads the entitlement plan and refuses at
// the boundary — so hiding a button is never the security control.

import { svc } from '../lib/db.ts';
import { json } from '../../_shared/http.ts';
import { isPlanKey } from './catalog.ts';
import type { PlanKey } from './catalog.ts';
import { planAllowsDrafting } from './capacity.ts';

// The caller's plan. Falls open to 'presence' if somehow unreadable — a paying
// customer must never be wrongly denied by a lookup hiccup (the entitlement
// STATUS gate already ran and passed upstream).
export async function loadPlan(clientId: string): Promise<PlanKey> {
  try {
    const r = await svc(`presence_entitlements?client_id=eq.${encodeURIComponent(clientId)}&product=eq.presence&select=plan&limit=1`);
    const p = r.ok && Array.isArray(r.json) && r.json.length ? r.json[0].plan : null;
    return isPlanKey(p) ? p : 'presence';
  } catch { return 'presence'; }
}

// If the plan cannot draft, return the friendly upgrade 403; otherwise null.
export function draftingDenial(plan: PlanKey, cors: Record<string, string>): Response | null {
  if (planAllowsDrafting(plan)) return null;
  return json({
    error: 'plan_upgrade_required',
    message: 'Drafting is part of Presence. Your Monitor plan watches your existing website and guides you — upgrade to Presence and Studio OS will draft and publish for you.',
    upgrade: true,
  }, 403, cors);
}
