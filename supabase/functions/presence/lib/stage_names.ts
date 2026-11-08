// ── Renaming the deal stages (sales review item 38, decision 3, Nov 2026) ────
// The six stages stay six and stay in order; the studio may rename the four
// OPEN ones ("New lead" → "Enquiry"). Won and Not a fit keep their names:
// buttons and sentences all over the app say "Mark as not a fit", "the Won
// column", and the lifecycle depends on both. Kept as one reserved JSON row
// (lib/reserved_store.ts); every page and report reads the same names.
import { readReservedJson, RESERVED_NAMES } from './reserved_store.ts';

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
/** The studio's stage names (defaults when it renamed nothing, or the read fails). */
export async function loadStageLabels(siteId: string): Promise<Record<string, string>> {
  return stageLabels(await readReservedJson(siteId, RESERVED_NAMES.stageNames) as Record<string, string> | null);
}
