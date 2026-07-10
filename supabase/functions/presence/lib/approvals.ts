// ── Approvals — pure decision logic (Presence CMS Phase 2, P2-D) ─────────────
// One generic approval that references the exact item + version. The version is a
// content_hash (SHA-256), and a decision is only valid from 'pending' AND only
// when the presented hash matches the stored one — the same version-integrity
// idiom as contract signing (lib/sales_lifecycle.ts). Pure (no DB, no network).

export type ApprovalDecision = 'approved' | 'rejected' | 'changes_requested';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'changes_requested' | 'superseded';
export type SubjectType = 'deliverable' | 'task' | 'project' | 'custom';

export function isDecision(x: unknown): x is ApprovalDecision {
  return x === 'approved' || x === 'rejected' || x === 'changes_requested';
}
export function isSubjectType(x: unknown): x is SubjectType {
  return x === 'deliverable' || x === 'task' || x === 'project' || x === 'custom';
}
/** A decision is valid only from 'pending' (idempotent-safe: an already-decided or
 *  superseded approval is refused, so a stale/superseded version can't be decided). */
export function canDecideApproval(current: ApprovalStatus): boolean {
  return current === 'pending';
}

/** SHA-256 hex over the EXACT identity + version marker a reviewer sees, so a
 *  decision binds to that version and can never apply to a changed item. Pure. */
export async function approvalHash(subjectType: string, subjectId: string, versionMarker: string): Promise<string> {
  const material = `${subjectType}:${subjectId}:${versionMarker}`;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
