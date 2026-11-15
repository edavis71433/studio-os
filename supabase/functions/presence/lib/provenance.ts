// Provenance writer. Every successful mutation writes exactly one change event.
// Written with the SERVICE ROLE — presence_change_events is default-deny +
// append-only (trigger-protected); clients can never write it directly. Contract
// (G1 §14): detail carries changed-field NAMES only, never values.
import { svc } from './db.ts';
import type { Principal } from '../../_shared/auth.ts';
import { changeActorKind, actorKindCheckViolation, legacyActorKind } from './actor_kind.ts';

// ── What the log takes (builder item 239, migration 0229) ─────────────────────
// The table's checks name every kind and action it accepts; anything else is refused. About 25
// writes were refused that way without a word: a launch's steps, the preview's link, saved
// sections, and the customer, contact and deal lines the sales routes wrote on the studio's own
// site. The first three are the website's own history and are let in. A customer, a contact or a
// deal is no change to a website: each lives in its own record (deal events, connect requests,
// the customer and its service link), so those writes are gone. tests/presence/change_log_kinds_239_test.mjs
// keeps every call's kind and action inside these lists, and these lists equal 0229's checks.
export const CHANGE_ENTITY_TYPES = [
  'identity', 'location', 'offering', 'testimonial', 'faq', 'post', 'media', 'voice', 'redirect', 'settings',
  'publish', 'restore', 'site', 'domain', 'launch', 'preview', 'content_library',
] as const;
export const CHANGE_ACTIONS = ['create', 'update', 'delete', 'hide', 'show', 'reorder', 'publish', 'restore', 'approve', 'reject', 'schedule'] as const;
/** Kept in the log but never a change to the draft: a launch's steps (staged, approved,
 *  scheduled) and the preview's link. They don't count as unpublished changes, don't move the
 *  site's last_change_at (0229's trigger skips them, as it skips publish and restore) and don't
 *  answer "who changed this?" when the editor finds the draft moved. Saved sections do count:
 *  a linked section shows the library's copy, so changing it changes what publishes. */
export const NOT_DRAFT_TYPES = ['launch', 'preview'] as const;
/** The PostgREST filter that reads draft changes only, leaving out `also` as well. Pure. */
export function draftChangesOnly(also: string[] = []): string {
  return `entity_type=not.in.(${[...also, ...NOT_DRAFT_TYPES].join(',')})`;
}

export async function writeChangeEvent(opts: {
  siteId: string;
  entityType: string;   // one of CHANGE_ENTITY_TYPES (checked by the table)
  entityId?: string | null;
  action: string;       // one of CHANGE_ACTIONS
  summary: string;
  principal: Principal;
  provenance?: 'human' | 'ai_approved' | 'import';
  fields?: string[];    // changed field names only
}): Promise<boolean> {
  // audit change 2: 'operator' when an agency member acts inside a client's scope
  const actorKind = changeActorKind(opts.principal);
  const write = (byKind: string) => svc('presence_change_events', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      site_id: opts.siteId,
      entity_type: opts.entityType,
      entity_id: opts.entityId ?? null,
      action: opts.action,
      summary: opts.summary,
      actor_user_id: opts.principal.userId,
      actor_kind: byKind,
      provenance: opts.provenance ?? 'human',
      detail: opts.fields && opts.fields.length ? { fields: opts.fields } : {},
    }),
  }).catch((e) => ({ ok: false, status: 0, json: null, text: String((e as Error)?.message || e) }));
  let r = await write(actorKind);
  // a database that predates migration 0133 rejects 'operator' — record the
  // studio's hand as 'staff' rather than lose the provenance row
  if (!r.ok && actorKind === 'operator' && actorKindCheckViolation(r.json, r.text)) r = await write(legacyActorKind(actorKind));
  // Item 239: a refused write used to vanish. The work it records still stands (the caller has
  // already done it), so nothing is thrown, but the function's log says what was refused and why.
  if (!r.ok) console.error(JSON.stringify(refusedLine(opts, r)));
  return r.ok;
}

/** The log line for a refused write: the kinds and the database's reason, never the summary
 *  (it can name a customer) and never PostgREST's `details`, which repeat the failing row. Pure. */
export function refusedLine(opts: { siteId: string; entityType: string; action: string }, r: { status: number; json: unknown; text: string }) {
  const j = (r.json && typeof r.json === 'object') ? r.json as Record<string, unknown> : null;
  return {
    evt: 'change_event_refused', site_id: opts.siteId, entity_type: opts.entityType, action: opts.action,
    status: r.status, code: j && j.code != null ? String(j.code) : null,
    reason: String(j ? (j.message ?? '') : (r.text ?? '')).slice(0, 200),
  };
}
