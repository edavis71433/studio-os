// ── Renaming the deal stages (sales review item 38, decision 3, Nov 2026) ────
// The six stages stay six and stay in order; the studio may rename the four
// OPEN ones ("New lead" → "Enquiry"). Won and Not a fit keep their names:
// buttons and sentences all over the app say "Mark as not a fit", "the Won
// column", and the lifecycle depends on both. Kept as one reserved JSON row
// (lib/reserved_store.ts); every page and report reads the same names.
import { readReservedJsonOrThrow, RESERVED_NAMES } from './reserved_store.ts';

export const DEFAULT_STAGE_LABEL: Record<string, string> = { lead: 'New lead', qualified: 'Qualified', proposal: 'Proposal sent', contract: 'Agreement out', won: 'Won', lost: 'Not a fit' };
export const RENAMEABLE = ['lead', 'qualified', 'proposal', 'contract'];
export const MAX_STAGE_NAME = 30;

/** Only real renames survive: a renameable key, 1–30 characters, not blank, not
 *  the same as its default, and never the same as another stage's name. */
export function normalizeStageNames(raw: unknown): Record<string, string> {
  const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const out: Record<string, string> = {};
  const taken = new Set(['won', 'not a fit']);
  for (const k of RENAMEABLE) {
    const v = String(r[k] ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_STAGE_NAME);
    if (!v || v.toLowerCase() === DEFAULT_STAGE_LABEL[k].toLowerCase()) continue;
    if (taken.has(v.toLowerCase())) continue;
    out[k] = v;
  }
  // No two stages may read the same once renamed (a rename onto another stage's
  // default included). Final pass (Nov 8, F4): dropping a clashing rename puts
  // that stage's default name back, which can clash with a rename that looked
  // fine a moment ago ({lead:'A', qualified:'A', proposal:'Qualified'} left two
  // "Qualified"s). So: drop every rename that clashes, then check again, until
  // nothing does.
  for (;;) {
    const final = { ...DEFAULT_STAGE_LABEL, ...out };
    const clashing = Object.keys(out).filter((k) => Object.entries(final).some(([k2, l]) => k2 !== k && l.toLowerCase() === out[k].toLowerCase()));
    if (!clashing.length) return out;
    for (const k of clashing) delete out[k];
  }
}
export function stageLabels(custom: Record<string, string> | null | undefined): Record<string, string> {
  return { ...DEFAULT_STAGE_LABEL, ...normalizeStageNames(custom || {}) };
}
/** "Moved to Proposal sent" → "Moved to Quote sent" when that stage was renamed. */
export function renameMovedTo(text: unknown, labels: Record<string, string>): string {
  const t = String(text || '');
  const m = /^Moved to (.+)$/.exec(t);
  if (!m) return t;
  const key = Object.keys(DEFAULT_STAGE_LABEL).find((k) => DEFAULT_STAGE_LABEL[k] === m[1]);
  return key && labels[key] ? 'Moved to ' + labels[key] : t;
}
/** The studio's stage names (defaults when it renamed nothing, or the read fails).
 *  Final pass (Nov 8, batch B): kept per site for STAGE_NAMES_TTL_MS — Pipeline,
 *  the deal page, the record, the reports and Analytics each read them on every
 *  open. A rename forgets them on this server at once (forgetStageLabels); a
 *  failed read is never kept. */
export const STAGE_NAMES_TTL_MS = 60_000;
const keptLabels = new Map<string, { at: number; p: Promise<Record<string, string>> }>();
export function loadStageLabels(siteId: string): Promise<Record<string, string>> {
  const hit = keptLabels.get(siteId);
  if (hit && Date.now() - hit.at < STAGE_NAMES_TTL_MS) return hit.p.catch(() => stageLabels(null));
  const p = readReservedJsonOrThrow(siteId, RESERVED_NAMES.stageNames).then((v) => stageLabels(v as Record<string, string> | null));
  keptLabels.set(siteId, { at: Date.now(), p });
  p.catch(() => { if (keptLabels.get(siteId)?.p === p) keptLabels.delete(siteId); });
  return p.catch(() => stageLabels(null));
}
export function forgetStageLabels(siteId: string): void { keptLabels.delete(siteId); }

// ── The chance each stage closes (sales review item 69, Nov 2026) ─────────────
// Salesforce gives every stage a probability (10, 25, 50, 75; Won 100; Lost 0)
// and adds up value × chance as the "expected" pipeline. Here the four OPEN
// stages carry a percent the studio may change in Settings; Won is always 100
// and Not a fit always 0. Kept as its own reserved row beside the names.
export const DEFAULT_STAGE_CHANCE: Record<string, number> = { lead: 10, qualified: 25, proposal: 50, contract: 75, won: 100, lost: 0 };

/** Only real changes survive: a renameable (open) stage, a whole number 0–100,
 *  not the same as its default. Pure. */
export function normalizeStageChances(raw: unknown): Record<string, number> {
  const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const out: Record<string, number> = {};
  for (const k of RENAMEABLE) {
    const v = r[k];
    if (v === null || v === undefined || v === '') continue;
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < 0 || n > 100 || n === DEFAULT_STAGE_CHANCE[k]) continue;
    out[k] = n;
  }
  return out;
}
/** Every stage's percent: the defaults, the studio's changes, Won 100, Not a fit 0. Pure. */
export function stageChances(custom: Record<string, unknown> | null | undefined): Record<string, number> {
  return { ...DEFAULT_STAGE_CHANCE, ...normalizeStageChances(custom || {}), won: 100, lost: 0 };
}
/** The expected value of the open deals: each one's value times its stage's
 *  percent, in whole cents, per stage and in all. A deal already turned into a
 *  customer is not open. Pure. */
export function expectedValue(deals: Array<{ stage?: unknown; expected_value_cents?: unknown; converted_client_id?: unknown }>, chances: Record<string, number>): { value_cents: number; by_stage: Record<string, number> } {
  const by: Record<string, number> = {};
  for (const k of RENAMEABLE) by[k] = 0;
  for (const d of deals || []) {
    const k = String(d?.stage || '');
    if (!RENAMEABLE.includes(k) || d?.converted_client_id) continue;
    const v = Math.max(0, Number(d?.expected_value_cents) || 0);
    by[k] += Math.round(v * (chances[k] ?? DEFAULT_STAGE_CHANCE[k]) / 100);
  }
  return { value_cents: RENAMEABLE.reduce((a, k) => a + by[k], 0), by_stage: by };
}
const keptChances = new Map<string, { at: number; p: Promise<Record<string, number>> }>();
/** The studio's percents (defaults when it changed nothing, or the read fails); kept like the names. */
export function loadStageChances(siteId: string): Promise<Record<string, number>> {
  const hit = keptChances.get(siteId);
  if (hit && Date.now() - hit.at < STAGE_NAMES_TTL_MS) return hit.p.catch(() => stageChances(null));
  const p = readReservedJsonOrThrow(siteId, RESERVED_NAMES.stageChances).then((v) => stageChances(v as Record<string, unknown> | null));
  keptChances.set(siteId, { at: Date.now(), p });
  p.catch(() => { if (keptChances.get(siteId)?.p === p) keptChances.delete(siteId); });
  return p.catch(() => stageChances(null));
}
export function forgetStageChances(siteId: string): void { keptChances.delete(siteId); }
