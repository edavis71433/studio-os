// ── Contact custom fields (capped, typed, safe) — PURE logic ─────────────────
// A few OPTIONAL owner-defined fields on a contact (e.g. "Referred by",
// "Birthday", "Tier"). The whole point is to stay a no-config-burden feature:
// at most 5 fields, four plain types (text / number / date / select), smart
// defaults, and never a code box. Every value is validated + stored as a clean
// STRING; the UI escapes it again at render (same posture as deal_activity's
// body and lib/forms.ts).
//
// STORAGE (see routes/sales.ts):
//   • field DEFINITIONS are site-level and shared across the site's contacts —
//     kept in the EXISTING reserved-template store (the services-catalog idiom),
//     NO migration.
//   • field VALUES are per-contact — kept in a `presence_contacts.custom` jsonb
//     bag (one small additive migration, deploy-order-tolerant in the routes).
//
// This module is PURE (no network, no clock, no randomness): definition
// normalization (cap, slug unique keys, per-type validation) and value
// validation/coercion. Tested in isolation (tests/presence/contacts_detail_test.mjs).

export type CustomFieldType = 'text' | 'number' | 'date' | 'select';
export const CUSTOM_FIELD_TYPES: readonly CustomFieldType[] = ['text', 'number', 'date', 'select'];
export function isCustomFieldType(t: unknown): t is CustomFieldType {
  return typeof t === 'string' && (CUSTOM_FIELD_TYPES as readonly string[]).includes(t);
}

// Bounded, never unbounded — the guardrail that keeps this from becoming config.
export const MAX_CUSTOM_FIELDS = 5;
const MAX_CHOICES = 20;
const CAP = { label: 60, key: 40, choice: 60, value: 300 } as const;

export interface CustomFieldDef {
  key: string;
  label: string;
  type: CustomFieldType;
  choices?: string[];   // select only
}

const CONTROL = /[\x00-\x08\x0B-\x1F\x7F]/g;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const s = (x: unknown, n: number): string => String(x ?? '').replace(CONTROL, '').replace(/\s+/g, ' ').trim().slice(0, n);
const slug = (x: unknown, n: number): string =>
  String(x ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, n);
const arr = (x: unknown): any[] => (Array.isArray(x) ? x : []);

/** Normalize a raw list of field definitions into a safe, capped, deduped set.
 *  Smart defaults protect "no config burden": a blank-label row is skipped (not
 *  an error), an unknown type falls back to `text`, and a `select` with no
 *  choices degrades to a plain `text` field rather than rejecting the save. */
export function normalizeFieldDefs(raw: unknown): CustomFieldDef[] {
  const out: CustomFieldDef[] = [];
  const seen = new Set<string>();
  for (const item of arr(raw)) {
    if (out.length >= MAX_CUSTOM_FIELDS) break;               // hard cap
    const label = s(item?.label, CAP.label);
    if (!label) continue;                                     // skip empty rows silently
    const type: CustomFieldType = isCustomFieldType(item?.type) ? item.type : 'text';
    let key = slug(item?.key, CAP.key) || slug(label, CAP.key) || `field_${out.length + 1}`;
    while (seen.has(key)) key = `${key}_${out.length}`;
    seen.add(key);
    const def: CustomFieldDef = { key, label, type };
    if (type === 'select') {
      const choices = arr(item?.choices).map((c) => s(c, CAP.choice)).filter(Boolean).slice(0, MAX_CHOICES);
      // a select with no real choices is meaningless — degrade to plain text
      if (choices.length) def.choices = choices; else def.type = 'text';
    }
    out.push(def);
  }
  return out;
}

/** Coerce+validate ONE value against its definition. Returns a clean string, or
 *  '' when the value is empty/invalid (invalid never throws — it just doesn't
 *  store). The UI escapes the returned string again at render. */
export function normalizeFieldValue(def: CustomFieldDef, raw: unknown): string {
  const v = s(raw, CAP.value);
  if (!v) return '';
  switch (def.type) {
    case 'number': {
      const n = Number(v.replace(/[, ]/g, ''));
      return Number.isFinite(n) ? String(n) : '';
    }
    case 'date':
      return ISO_DATE_RE.test(v) ? v : '';
    case 'select':
      return (def.choices || []).includes(v) ? v : '';
    default:
      return v;                                               // text
  }
}

/** Normalize a whole values bag against the current definitions. Drops any key
 *  that isn't a defined field (so a stale/renamed field can't linger) and any
 *  value that fails its type. Returns a clean `{ [key]: string }` for storage. */
export function normalizeFieldValues(defs: CustomFieldDef[], raw: unknown): Record<string, string> {
  const bag = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw as Record<string, unknown> : {};
  const out: Record<string, string> = {};
  for (const def of defs) {
    const clean = normalizeFieldValue(def, bag[def.key]);
    if (clean) out[def.key] = clean;
  }
  return out;
}

/** Merge a partial patch of values into the existing bag (only defined keys),
 *  so a detail-view save that touches one field doesn't wipe the others. An
 *  explicit empty string CLEARS a field. Returns the new stored bag. */
export function applyFieldValues(defs: CustomFieldDef[], existing: unknown, patch: unknown): Record<string, string> {
  const base = normalizeFieldValues(defs, existing);
  const incoming = (patch && typeof patch === 'object' && !Array.isArray(patch)) ? patch as Record<string, unknown> : {};
  const byKey = new Map(defs.map((d) => [d.key, d]));
  for (const [k, v] of Object.entries(incoming)) {
    const def = byKey.get(k);
    if (!def) continue;                                       // ignore unknown keys
    if (v === '' || v == null) { delete base[k]; continue; }  // explicit clear
    const clean = normalizeFieldValue(def, v);
    if (clean) base[k] = clean; else delete base[k];          // invalid → clear (never store junk)
  }
  return base;
}

/** Pair each definition with its current value for display (value '' when unset).
 *  Pure view-model; the caller escapes label + value at render. */
export interface CustomFieldView { key: string; label: string; type: CustomFieldType; choices?: string[]; value: string }
export function viewFieldValues(defs: CustomFieldDef[], values: unknown): CustomFieldView[] {
  const bag = normalizeFieldValues(defs, values);
  return defs.map((d) => ({ key: d.key, label: d.label, type: d.type, choices: d.choices, value: bag[d.key] || '' }));
}
