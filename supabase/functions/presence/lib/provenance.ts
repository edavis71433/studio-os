// Provenance writer. Every successful mutation writes exactly one change event.
// Written with the SERVICE ROLE — presence_change_events is default-deny +
// append-only (trigger-protected); clients can never write it directly. Contract
// (G1 §14): detail carries changed-field NAMES only, never values.
import { svc } from './db.ts';
import type { Principal } from '../../_shared/auth.ts';

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
  const actorKind = opts.principal.kind === 'staff' ? 'staff' : opts.principal.kind === 'system' ? 'system' : 'client';
  const r = await svc('presence_change_events', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      site_id: opts.siteId,
      entity_type: opts.entityType,
      entity_id: opts.entityId ?? null,
      action: opts.action,
      summary: opts.summary,
      actor_user_id: opts.principal.userId,
      actor_kind: actorKind,
      provenance: opts.provenance ?? 'human',
      detail: opts.fields && opts.fields.length ? { fields: opts.fields } : {},
    }),
  });
  return r.ok;
}
