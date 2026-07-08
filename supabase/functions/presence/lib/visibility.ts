// ── Presence visibility model (A7) — the CRM `client_visible` idea, in Presence ─
// A "surface" has a DEFAULT audience policy; individual items may be shared or
// hidden by an explicit override (presence_item_shares). Owner/staff/developer
// see everything; the client_reviewer (the client portal) sees only what the
// default policy or an explicit share exposes. Internal notes are NEVER visible
// to a reviewer unless explicitly shared. Pure — no I/O.
//
// Preserves the frozen guarantees: this filters READS for the reviewer audience
// only; it never touches approval, audit, or tenant isolation, and the
// business_owner's view is unchanged (zero regression).
import type { SiteRole } from './site_roles.ts';
import { seesFullWorkspace } from './site_roles.ts';

export type Surface =
  | 'business_moments' | 'cms_pages' | 'published' | 'drafts' | 'ai_drafts'
  | 'visual_assets' | 'media' | 'connected' | 'reports' | 'files'
  | 'approvals' | 'comments' | 'messages' | 'internal_notes' | 'knowledge' | 'growth';

// Per-surface default for the CLIENT (reviewer) audience:
//   always   — always visible (the client must see these to participate)
//   shared   — visible by default; can be hidden by an explicit override
//   internal — hidden by default; visible only if explicitly shared
//   never    — never visible unless explicitly shared (internal notes)
export const DEFAULT_POLICY: Record<Surface, 'always' | 'shared' | 'internal' | 'never'> = {
  published: 'always',
  approvals: 'always',
  messages: 'always',
  business_moments: 'shared',
  reports: 'shared',
  media: 'shared',
  connected: 'shared',
  cms_pages: 'shared',
  comments: 'shared',
  growth: 'shared',
  drafts: 'internal',
  ai_drafts: 'internal',
  visual_assets: 'internal',
  files: 'internal',
  knowledge: 'internal',
  internal_notes: 'never',
};

export interface ShareOverride { shared?: boolean } // from presence_item_shares (per item or whole-surface)

/** Can this role see an item on this surface, given an optional explicit share?
 *  Owner/staff/developer: always yes. Reviewer: by policy, overridable. */
export function visibleTo(role: SiteRole, surface: Surface, override?: ShareOverride): boolean {
  if (seesFullWorkspace(role)) return true;                 // owner / staff / developer see all
  const policy = DEFAULT_POLICY[surface] ?? 'internal';
  if (typeof override?.shared === 'boolean') return override.shared;  // explicit share/hide wins
  return policy === 'always' || policy === 'shared';        // default exposure for the reviewer
}

/** Filter a list of items for the reviewer audience. `keyOf` maps an item to its
 *  surface + optional per-item override; owner/staff/developer get the list
 *  unchanged (identity), so existing reads are untouched. */
export function filterForRole<T>(
  role: SiteRole,
  items: T[],
  classify: (item: T) => { surface: Surface; override?: ShareOverride },
): T[] {
  if (seesFullWorkspace(role)) return items;
  return items.filter((it) => { const c = classify(it); return visibleTo(role, c.surface, c.override); });
}

/** Whether a whole surface is reachable at all by the role (for nav/gating). */
export function surfaceVisible(role: SiteRole, surface: Surface): boolean {
  return visibleTo(role, surface);
}
