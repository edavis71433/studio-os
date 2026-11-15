// ── Who acted: the ONE answer to "which kind of hand did this" ───────────────
// Studio audit (Oct 2026) change 2: when an agency operator acts inside a
// client's scope (?client= → x-dds-scope-site, validated by lib/scope.ts), the
// record must say the STUDIO did it — not the client. Before this, every
// non-staff caller was written as 'client', so the client's room later read
// "published by you" for a publish their studio made, and the connections
// audit called an agency member a 'customer'.
//
// Pure. index.ts stamps `principal.scope` once the scope header has been
// authorised; these helpers only READ that flag, so no route ever re-queries
// agency membership to attribute an action. Tests: tests/presence/studio_voice_test.mjs.
import type { Principal } from '../../_shared/auth.ts';
import { UUID_RE } from './uuid.ts';

type Actor = Pick<Principal, 'kind'> & { scope?: Principal['scope'] };

/** The scheduler's hand (builder item 239): what a scheduled publish, a scheduled blog post
 *  and the timed-section sweep sign as. Its sign-in id lands in uuid columns
 *  (presence_publishes.actor, presence_snapshots.created_by,
 *  presence_change_events.actor_user_id), which refused the old name 'scheduler', so every
 *  scheduled publish would have failed with record_failed. The id is the person who scheduled
 *  the work when one is known, so history keeps who set it; otherwise none. The kind stays
 *  'system': nobody pressed anything at that moment. Pure. */
export function schedulerPrincipal(requestId: string, scheduledBy?: unknown): Principal {
  const id = String(scheduledBy ?? '').trim().toLowerCase();
  return { kind: 'system', userId: UUID_RE.test(id) ? id : null, tenantId: null, role: null, email: null, jwt: null, requestId };
}

/** True when an agency member is acting inside a client's scope. Platform
 *  staff are staff wherever they stand, so they are NOT "operators" here. */
export function actsForClient(p: Actor): boolean {
  return p.kind !== 'staff' && !!(p.scope && p.scope.site_id);
}

/** presence_publishes.actor_kind / presence_snapshots.created_by_kind —
 *  'staff' (platform), 'operator' (the client's studio, scoped in), 'client' (the owner). */
export type PublishActorKind = 'staff' | 'operator' | 'client';
export function publishActorKind(p: Actor): PublishActorKind {
  if (p.kind === 'staff') return 'staff';
  if (actsForClient(p)) return 'operator';
  return 'client';
}

/** presence_change_events.actor_kind — the same vocabulary plus 'system' for
 *  cron/scheduler writes (provenance.ts). The publish record takes it too (item 239):
 *  a publish the scheduler fires is 'system', as migration 0133's column note says. */
export type ChangeActorKind = PublishActorKind | 'system';
export function changeActorKind(p: Actor): ChangeActorKind {
  if (p.kind === 'system') return 'system';
  return publishActorKind(p);
}

/** presence_connection_events.actor_kind speaks a two-word vocabulary
 *  (customer | operator | system, migration 0038): the studio — platform staff
 *  OR an agency member scoped into the client — is the 'operator'. */
export type ConnectionActorKind = 'operator' | 'customer';
export function connectionActorKind(p: Actor): ConnectionActorKind {
  return p.kind === 'staff' || actsForClient(p) ? 'operator' : 'customer';
}

/** Did the studio's hand do this (as opposed to the owner's own)? */
export function studioActed(actorKind: string | null | undefined): boolean {
  return actorKind === 'staff' || actorKind === 'operator';
}

/** The room's last-publish fact (routes/room.ts /health): the client reads
 *  "published by your studio" for a staff OR operator publish, "published by
 *  you" for their own, and "published on schedule" for one the scheduler fired
 *  (item 239), whoever set it. */
export function lastPublishDetail(actorKind: string | null | undefined): string {
  if (actorKind === 'system') return 'published on schedule';
  return studioActed(actorKind) ? 'published by your studio' : 'published by you';
}

/** Pre-migration degrade (the 0130/0131 deploy-order idiom): migration 0133
 *  widens the three actor_kind CHECKs to accept 'operator'. Until it is applied
 *  PostgREST answers 23514 (check_violation) naming the constraint; the writer
 *  then falls back to 'staff' — still the studio's hand, so the client's room
 *  stays truthful ("published by your studio") and a scoped publish never 502s
 *  on attribution alone. Only an actor_kind / created_by_kind violation
 *  qualifies; any other failure is reported as before. */
export function actorKindCheckViolation(json: unknown, text: unknown): boolean {
  const j = (json && typeof json === 'object') ? json as Record<string, unknown> : {};
  const hay = `${String(j.message ?? '')} ${String(j.details ?? '')} ${String(text ?? '')}`.toLowerCase();
  const isCheck = String(j.code ?? '') === '23514' || hay.includes('violates check constraint');
  return isCheck && /(actor_kind|created_by_kind)/.test(hay);
}
/** The value to retry with when the database predates 0133. */
export function legacyActorKind<K extends string>(k: K): K | 'staff' {
  return k === 'operator' ? 'staff' : k;
}
