// Provenance writer. Every successful mutation writes exactly one change event.
// Written with the SERVICE ROLE — presence_change_events is default-deny +
// append-only (trigger-protected); clients can never write it directly. Contract
// (G1 §14): detail carries changed-field NAMES only, never values.
import { svc } from './db.ts';
import type { Principal } from '../../_shared/auth.ts';
import { changeActorKind, actorKindCheckViolation, legacyActorKind } from './actor_kind.ts';

export async function writeChangeEvent(opts: {
  siteId: string;
  entityType: string;   // 'identity' | 'location' | ... (checked by the DB enum)
  entityId?: string | null;
  action: string;       // 'create' | 'update' | ...
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
  });
  let r = await write(actorKind);
  // a database that predates migration 0133 rejects 'operator' — record the
  // studio's hand as 'staff' rather than lose the provenance row
  if (!r.ok && actorKind === 'operator' && actorKindCheckViolation(r.json, r.text)) r = await write(legacyActorKind(actorKind));
  return r.ok;
}
