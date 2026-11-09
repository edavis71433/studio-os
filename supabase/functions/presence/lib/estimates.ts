// ── Estimates, pure (sales review item 47, Nov 2026) ─────────────────────────
// An estimate is a price before anything is agreed. It has the proposal's shape
// — line items from the services list, with the reserved discount/tax element
// (lib/sales_lifecycle.ts) — so the same totals, the same printable document and
// the same editor serve it. What differs is what the client may do, chosen by
// Eric on Nov 8: Approve or Not now (with an optional note) on its own page,
// for 30 days. Approving never moves the deal; the studio turns it into a
// proposal or bills it as an invoice, and nothing goes out until they press Send.
//
// Pure: no I/O and no clock (callers pass the time). routes/estimates.ts does the rest.

export type EstimateStatus = 'draft' | 'sent' | 'approved' | 'declined';
export type EstimateDecision = 'approved' | 'declined';

export const ESTIMATE_TTL_DAYS = 30;
export const ESTIMATE_DEFAULT_TITLE = 'Estimate';

export function isEstimateDecision(d: unknown): d is EstimateDecision {
  return d === 'approved' || d === 'declined';
}
/** Only a sent estimate can be answered, and only once. */
export function canDecideEstimate(status: unknown, decision: unknown): boolean {
  return status === 'sent' && isEstimateDecision(decision);
}
/** An estimate past its 30 days can't be approved (Not now still works). */
export function estimateExpired(e: { expires_at?: unknown } | null | undefined, nowIso: string): boolean {
  return !!(e && e.expires_at && String(e.expires_at) < nowIso);
}
export function estimateExpiresAt(nowMs: number): string {
  return new Date(nowMs + ESTIMATE_TTL_DAYS * 86400_000).toISOString();
}
/** Where it stands, in one word the deal page and the client page both use. */
export function estimateState(e: { status?: unknown; expires_at?: unknown } | null | undefined, nowIso: string): 'draft' | 'open' | 'expired' | 'approved' | 'declined' {
  const s = String(e?.status || 'draft');
  if (s === 'approved' || s === 'declined' || s === 'draft') return s;
  return estimateExpired(e, nowIso) ? 'expired' : 'open';
}
/** The deal history line. Mirrored by hand in pipeline.html's evtLabel. */
export function estimateEventLine(kind: string, d: Record<string, unknown> | null | undefined): string {
  const x = d && typeof d === 'object' ? d : {};
  const total = Number(x.total_cents) > 0 ? ' — $' + (Number(x.total_cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : '';
  if (kind === 'estimate_sent') return `Estimate sent${total}`;
  if (kind === 'estimate_deleted') return 'Draft estimate removed';
  if (kind === 'estimate_decided') return x.decision === 'approved' ? `Estimate approved${total}` : 'They passed on the estimate (Not now)';
  return 'Estimate';
}
