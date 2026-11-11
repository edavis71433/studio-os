// ── A contact holds more (sales item 89, Nov 2026) ──────────────────────────
// Beside name, email, phone, company and five fields of your own, a contact now
// keeps a job title, a second phone, an address (it goes on invoices and into
// local search work) and tags ("restaurant", "past client", "referral partner")
// that the list can filter by. Migration 0165 adds the columns. These pure
// helpers clean what is typed or imported, so every door (the add form, Edit,
// the record, an import, a merge) stores the same shapes.

export const MAX_TAGS = 12, MAX_TAG = 30;
export const ADDRESS_KEYS = ['street', 'city', 'state', 'zip', 'country'] as const;
export type ContactAddress = Partial<Record<typeof ADDRESS_KEYS[number], string>>;
const ADDRESS_MAX: Record<typeof ADDRESS_KEYS[number], number> = { street: 160, city: 80, state: 60, zip: 20, country: 60 };
/** The new columns, as the routes select and write them. */
export const CONTACT_MORE_COLS = ['job_title', 'phone2', 'address', 'tags'] as const;

const clean = (s: unknown, max: number) => String(s ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** One tag: lower-case words, single spaces, no commas (a comma separates tags). */
export function cleanTag(t: unknown): string {
  return clean(String(t ?? '').replace(/[,;#]/g, ' '), MAX_TAG).toLowerCase();
}

/** Tags from a list, or from text like "restaurant, past client; referral":
 *  cleaned, each once, at most twelve. */
export function normalizeTags(v: unknown): string[] {
  const parts = Array.isArray(v) ? v : String(v ?? '').split(/[,;\n]/);
  const out: string[] = [];
  for (const p of parts) {
    const t = cleanTag(p);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/** An address from its parts ({street, city, state, zip, country}); anything
 *  else is dropped and every part is trimmed and capped. A plain string is kept
 *  as the street line (an imported "12 Elm St, Glendale, CA 91203"). */
export function normalizeAddress(v: unknown): ContactAddress {
  if (typeof v === 'string') { const street = clean(v, ADDRESS_MAX.street); return street ? { street } : {}; }
  const src = v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
  const out: ContactAddress = {};
  for (const k of ADDRESS_KEYS) { const s = clean(src[k], ADDRESS_MAX[k]); if (s) out[k] = s; }
  return out;
}

/** The address on one line: "12 Elm St, Glendale, CA 91203". '' when there is none. */
export function addressLine(v: unknown): string {
  const a = normalizeAddress(v);
  const stateZip = [a.state, a.zip].filter(Boolean).join(' ');
  return [a.street, a.city, stateZip, a.country].filter(Boolean).join(', ');
}

/** The job title and second phone, as typed (trimmed, capped). */
export const cleanJobTitle = (v: unknown) => clean(v, 100);
export const cleanPhone = (v: unknown) => clean(v, 40);

/** The new fields a create or edit asked for, cleaned; a field left out stays out
 *  (an edit that doesn't name the address leaves it as it is). */
export function contactMoreFrom(b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (b.job_title !== undefined) out.job_title = cleanJobTitle(b.job_title);
  if (b.phone2 !== undefined) out.phone2 = cleanPhone(b.phone2);
  if (b.address !== undefined) out.address = normalizeAddress(b.address);
  if (b.tags !== undefined) out.tags = normalizeTags(b.tags);
  return out;
}

/** A phone number as a tap-to-call address: digits and a leading +. '' for none. */
export function telHref(phone: unknown): string {
  const s = String(phone ?? '').trim();
  const d = s.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  return d.replace(/\D/g, '').length >= 3 ? 'tel:' + d : '';
}
