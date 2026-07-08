// ── /crm/* — the Client Relationship Center (Phase C) ────────────────────────
// An operational relationship hub, not a sales CRM. It AGGREGATES existing
// signals (publishes, changes, connected events, moments, approvals) into one
// calm per-client view, plus relationship notes. Reachable through the normal
// site gate; the reviewer boundary already refuses /crm/* (it's the workspace).
// Audience: the studio side (operator + agency) sees internal items; the client
// side (a business owner on their own account) sees only shared items. This uses
// existing principal/agency signals — permission/visibility models unchanged.
//   GET  /crm/profile              — profile + calm health + relationship summary
//   GET  /crm/timeline             — unified activity feed (audience-filtered)
//   GET  /crm/notes                — relationship notes (internal hidden from client side)
//   POST /crm/notes                — add { audience, body }
//   POST /crm/notes/:id/pin        — { pinned }
//   DELETE /crm/notes/:id          — soft-delete
import { json } from '../../_shared/http.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';
import { resolveAgencyMember } from '../agency/auth.ts';
import { loadProfile, loadTimeline, listNotes, addNote, setNotePinned, deleteNote } from '../crm/store.ts';
import { filterTimeline, relationshipSummary, isAudience, cleanNoteBody } from '../crm/contract.ts';

/** The studio side sees internal items; the client side sees only shared. */
async function isStudioSide(jwt: string, principal: Principal): Promise<boolean> {
  if (principal.kind === 'staff' || principal.kind === 'system') return true;
  try { return !!(await resolveAgencyMember(jwt)); } catch { return false; }
}

export async function handleCrmProfile(jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const now = new Date().toISOString();
  const studio = await isStudioSide(jwt, principal);
  const [profile, timeline] = await Promise.all([
    loadProfile(site, now),
    loadTimeline(site, { includeInternalNotes: studio, limit: 60 }),
  ]);
  const visible = filterTimeline(timeline, studio);
  const summary = relationshipSummary(profile, visible[0]?.at ?? null, now);
  return json({ data: { profile, summary, is_studio_view: studio, last_activity_at: visible[0]?.at ?? null } }, 200, cors);
}

export async function handleCrmTimeline(jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const studio = await isStudioSide(jwt, principal);
  const timeline = await loadTimeline(site, { includeInternalNotes: studio, limit: 60 });
  return json({ data: { items: filterTimeline(timeline, studio), is_studio_view: studio } }, 200, cors);
}

export async function handleCrmNotesList(jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const studio = await isStudioSide(jwt, principal);
  const notes = await listNotes(site.id, studio);   // internal notes only for the studio side
  return json({ data: { notes, can_write_internal: studio } }, 200, cors);
}

export async function handleCrmNoteAdd(req: Request, jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const studio = await isStudioSide(jwt, principal);
  let b: any = {}; try { b = await req.json(); } catch { /* */ }
  const audience = isAudience(b?.audience) ? b.audience : 'internal';
  if (audience === 'internal' && !studio) {
    return json({ error: 'forbidden', message: 'Internal notes are for your studio. You can leave a shared note instead.' }, 403, cors);
  }
  const body = cleanNoteBody(b?.body);
  if (!body) return json({ error: 'bad_request', message: 'Write a little something first.' }, 400, cors);
  const res = await addNote(site.id, audience, body, principal.userId || 'user', principal.kind);
  if (!res.ok) return json({ error: 'write_failed', message: 'That didn’t save — please try again.' }, 502, cors);
  return json({ data: { ok: true, id: res.id, message: audience === 'shared' ? 'Shared with the client.' : 'Saved to your studio notes.' } }, 200, cors);
}

export async function handleCrmNotePin(req: Request, jwt: string, site: SiteRow, principal: Principal, noteId: string, cors: Record<string, string>) {
  if (!(await isStudioSide(jwt, principal))) return json({ error: 'forbidden', message: 'Only your studio can pin relationship notes.' }, 403, cors);
  let b: any = {}; try { b = await req.json(); } catch { /* */ }
  const ok = await setNotePinned(site.id, noteId, !!b?.pinned);
  return ok ? json({ data: { ok: true } }, 200, cors) : json({ error: 'not_found', message: 'That note isn’t here.' }, 404, cors);
}

export async function handleCrmNoteDelete(jwt: string, site: SiteRow, principal: Principal, noteId: string, cors: Record<string, string>) {
  if (!(await isStudioSide(jwt, principal))) return json({ error: 'forbidden', message: 'Only your studio can remove relationship notes.' }, 403, cors);
  const ok = await deleteNote(site.id, noteId);
  return ok ? json({ data: { ok: true, message: 'Removed.' } }, 200, cors) : json({ error: 'not_found', message: 'That note isn’t here.' }, 404, cors);
}
