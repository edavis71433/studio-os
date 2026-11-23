// ── Revision rounds (sales item 179, Nov 22 2026 review) ─────────────────────
// The studio's own agreement promises two revision rounds and written change orders. A deal
// carries how many rounds of changes it includes (presence_deals.revision_rounds; null means
// they aren't counted). Each time the client presses Request changes in their portal on the
// deal's project (an approval decided 'changes_requested': a website draft, a file or anything
// else put to them), that uses one round. Past the last one the request still reaches the
// studio, and it becomes an estimate marked "Extra work" to price and send; once approved it adds
// a to-do on the project and a draft invoice (routes/estimates.ts). Pure: no I/O, no clock.

export interface Rounds { included: number | null; used: number }

/** A deal's rounds as typed: a whole number from 0 to 20, or nothing (not counted). Pure. */
export function cleanRounds(raw: unknown): { ok: true; value: number | null } | { ok: false } {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: null };
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 20 ? { ok: true, value: n } : { ok: false };
}
/** Rounds used: the client's change requests on the project. Pure. */
export function roundsUsed(approvals: Array<{ status?: unknown }> | null | undefined): number {
  return (approvals || []).filter((a) => a?.status === 'changes_requested').length;
}
/** Which round the request at `n` (1 for the first) is: "Round 1 of 2", or extra work past the
 *  last one. Null when the deal doesn't count rounds. Pure. */
export function roundOf(n: number, included: number | null | undefined): { n: number; of: number; extra: boolean } | null {
  if (included === null || included === undefined || !Number.isFinite(Number(included))) return null;
  const of = Math.trunc(Number(included));
  return { n, of, extra: n > of };
}
/** The studio's one line: "1 of 2 rounds of changes used", with any extra work. '' when not counted. Pure. */
export function roundsLine(r: Rounds | null | undefined): string {
  if (!r || r.included === null || r.included === undefined) return '';
  const inc = Math.trunc(Number(r.included)), used = Math.max(0, Math.trunc(Number(r.used) || 0));
  const extra = Math.max(0, used - inc);
  const more = extra ? `, and ${extra} more asked for as extra work` : '';
  if (inc === 0) return `No rounds of changes are included${extra ? `; ${extra} asked for as extra work` : ''}`;
  return `${Math.min(used, inc)} of ${inc} round${inc === 1 ? '' : 's'} of changes used${more}`;
}
/** What the client reads before asking: "This is round 1 of 2", or that it will be priced first. Pure. */
export function nextRoundWords(r: Rounds | null | undefined): string {
  const x = r ? roundOf(Math.max(0, Math.trunc(Number(r.used) || 0)) + 1, r.included) : null;
  if (!x) return '';
  if (x.extra) return x.of ? `Your ${x.of} included round${x.of === 1 ? ' is' : 's are'} used, so your studio will price these changes before doing them.` : 'Changes aren’t included, so your studio will price them before doing them.';
  return `This is round ${x.n} of ${x.of} included.`;
}
