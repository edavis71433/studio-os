// ── One contact, cleaned the same way at every door (sales item 122, Nov 2026) ─
// The add form (POST /sales/contacts, one person) and an import's whole file
// (POST /sales/contacts/imports with its rows) turn what was sent into the row
// the contacts table keeps, and into the values an import may write over
// someone already here. One set of rules, so a person imported in one go is
// stored exactly as the same person added by hand.
import { svc } from './db.ts';
import { normalizeFoundVia } from './found_via.ts';
import { contactMoreFrom } from './contact_fields.ts';
import { normalizeFieldDefs, applyFieldValues, type CustomFieldDef } from '../crm/custom_fields.ts';

const clean = (s: unknown, max = 500) => String(s ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, max);
const rows = (r: { json?: unknown }) => (Array.isArray((r as any).json) ? (r as any).json : []) as any[];

// The site's contact custom-field DEFINITIONS (≤5 owner-defined labeled fields)
// ride the reserved-template store as the services catalog does — a single row
// (kind=proposal, this sentinel name) whose `body` holds the definitions JSON.
// Site-scoped, deny-all, function-mediated — NO new migration for definitions.
// (Per-contact VALUES live in presence_contacts.custom, migration 0097.)
export const CONTACT_FIELDS_NAME = '__crm_contact_fields__';
export async function loadContactFieldDefs(siteId: string): Promise<CustomFieldDef[]> {
  const row = rows(await svc(`presence_sales_templates?site_id=eq.${siteId}&kind=eq.proposal&name=eq.${encodeURIComponent(CONTACT_FIELDS_NAME)}&deleted_at=is.null&select=body&limit=1`))[0];
  if (!row || !row.body) return [];
  try { return normalizeFieldDefs(JSON.parse(row.body)); } catch { return []; }
}

/** One person as sent, cleaned. null when it has neither a name nor an email. */
export type ContactIn = { name: string; email: string; phone: string; company: string; notes: string; foundVia: string; more: Record<string, unknown>; custom: Record<string, unknown> | null };
export function contactIn(b: any, defs: CustomFieldDef[]): ContactIn | null {
  const src = b && typeof b === 'object' ? b : {};
  const email = clean(src.email, 160).toLowerCase();
  const name = clean(src.name, 120);
  if (!name && !email) return null;
  // your own fields (item 86: an import can fill them), checked against their definitions
  const custom = src.custom && typeof src.custom === 'object' ? applyFieldValues(defs, {}, src.custom) : null;
  return { name, email, phone: clean(src.phone, 40), company: clean(src.company, 120), notes: clean(src.notes, 2000), foundVia: normalizeFoundVia(src.found_via), more: contactMoreFrom(src), custom };
}
/** The row a new person is inserted as. */
export function newContactRow(siteId: string, c: ContactIn): Record<string, unknown> {
  return { site_id: siteId, name: c.name, email: c.email, phone: c.phone, company: c.company, notes: c.notes, ...(c.foundVia ? { found_via: c.foundVia } : {}), ...c.more, ...(c.custom && Object.keys(c.custom).length ? { custom: c.custom } : {}) };
}
/** What an import that updates may write over someone already here (importChanges decides what changes). */
export function importIncoming(c: ContactIn): Record<string, unknown> {
  return { name: c.name, phone: c.phone, company: c.company, notes: c.notes, found_via: c.foundVia, ...c.more, ...(c.custom ? { custom: c.custom } : {}) };
}
