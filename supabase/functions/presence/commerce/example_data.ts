// ── Sample data on a new trial (benchmark 12) ───────────────────────────────
// A brand-new studio's first session used to be empty rooms: no customer, no
// deal, no enquiry — nothing to click. On the FIRST provisioning of a site
// (never an existing one) we seed one example of each, plainly named
// "Example: …", so the owner can walk Customers, Pipeline and the Inbox and
// see how the pieces connect. Today shows one card with "Remove example
// data", which deletes exactly these rows and nothing else.
//
// No migration: the rows are marked with what their tables already have —
//   contact     the fixed example email (unique per site, so re-seeding is a no-op)
//   deal        source = 'example'
//   enquiry     fields.example = true, source_page = 'example'
// Every write is service-role and best-effort: a seed that fails never costs
// anyone their account, and a remove that fails says so.
import { svc } from '../lib/db.ts';
import { clearNotice } from '../lib/notice.ts';

export const EXAMPLE_NAME = 'Example: Marlow’s Kitchen';
export const EXAMPLE_PERSON = 'Example: Jo Marlow';
export const EXAMPLE_EMAIL = 'jo@marlows-kitchen.example';   // .example is reserved — never a real inbox
export const EXAMPLE_SOURCE = 'example';
export const EXAMPLE_DEAL_TITLE = 'Example: Website refresh for Marlow’s Kitchen';
export const EXAMPLE_ENQUIRY = 'Hi — we run a small neighbourhood kitchen and our website is years out of date. Could you give us a rough price for a refresh, and how long it would take?';

export interface ExampleCounts { contacts: number; deals: number; enquiries: number }

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const plusDays = (now: Date, n: number) => new Date(now.getTime() + n * 86400_000);

/** The three rows, pure — pinned by tests. `contactId` joins the deal to the contact. */
export function exampleRows(siteId: string, now: Date, contactId: string | null = null) {
  return {
    contact: { site_id: siteId, name: EXAMPLE_PERSON, email: EXAMPLE_EMAIL, phone: '', company: EXAMPLE_NAME, notes: 'An example customer, added so your first look isn’t empty. Remove it from Today whenever you like.' },
    deal: {
      site_id: siteId, contact_id: contactId, title: EXAMPLE_DEAL_TITLE, stage: 'proposal', source: EXAMPLE_SOURCE,
      expected_value_cents: 240000, expected_close: ymd(plusDays(now, 21)),
      next_step: 'Send the proposal', next_step_at: ymd(plusDays(now, 2)),
      notes: 'An example deal so you can see the pipeline with something in it. Remove it from Today whenever you like.',
    },
    submission: {
      site_id: siteId, form_kind: 'quote', name: EXAMPLE_PERSON, email: EXAMPLE_EMAIL, phone: '', message: EXAMPLE_ENQUIRY,
      fields: { example: true }, source_page: EXAMPLE_SOURCE, status: 'new', spam: false, ip_hash: '',
    },
  };
}

/** The example rows this site still holds (0 everywhere = none / removed). */
export async function exampleDataCounts(siteId: string): Promise<ExampleCounts> {
  const [c, d, e] = await Promise.all([
    svc(`presence_contacts?site_id=eq.${siteId}&email=eq.${encodeURIComponent(EXAMPLE_EMAIL)}&deleted_at=is.null&select=id&limit=5`),
    svc(`presence_deals?site_id=eq.${siteId}&source=eq.${EXAMPLE_SOURCE}&deleted_at=is.null&select=id&limit=5`),
    svc(`presence_form_submissions?site_id=eq.${siteId}&fields->>example=eq.true&select=id&limit=5`),
  ]);
  const n = (r: { ok: boolean; json: unknown }) => (r.ok && Array.isArray(r.json)) ? r.json.length : 0;
  return { contacts: n(c), deals: n(d), enquiries: n(e) };
}

/** Seed once. Idempotent: an existing example contact means the seed already
 *  ran (or the owner is mid-way through removing it) — do nothing. Callers
 *  guard the OTHER half of "never for an existing site" by only calling this
 *  when provisioning just CREATED the site row. */
export async function seedExampleData(siteId: string, now = new Date()): Promise<{ seeded: boolean }> {
  const have = await svc(`presence_contacts?site_id=eq.${siteId}&email=eq.${encodeURIComponent(EXAMPLE_EMAIL)}&select=id&limit=1`);
  if (!have.ok || (Array.isArray(have.json) && have.json.length)) return { seeded: false };
  const rows = exampleRows(siteId, now);
  const ct = await svc('presence_contacts', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(rows.contact) });
  if (!ct.ok || !ct.json?.[0]?.id) return { seeded: false };
  const withContact = exampleRows(siteId, now, String(ct.json[0].id));
  await svc('presence_deals', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(withContact.deal) }).catch(() => {});
  await svc('presence_form_submissions', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(withContact.submission) }).catch(() => {});
  return { seeded: true };
}

/** Delete exactly the example rows: the deals marked source=example, the
 *  enquiries marked fields.example, the contact at the example email — all on
 *  THIS site. Hard deletes (they are examples, not history); deal events
 *  cascade with their deal. A lead-followup nudge the cron raised for the
 *  example enquiry is cleared too, so the bell does not keep asking. */
export async function removeExampleData(siteId: string, clientId: string | null): Promise<ExampleCounts> {
  const del = async (path: string) => {
    const r = await svc(path, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
    return (r.ok && Array.isArray(r.json)) ? (r.json as Array<{ id?: string }>) : [];
  };
  const deals = await del(`presence_deals?site_id=eq.${siteId}&source=eq.${EXAMPLE_SOURCE}`);
  const enquiries = await del(`presence_form_submissions?site_id=eq.${siteId}&fields->>example=eq.true`);
  const contacts = await del(`presence_contacts?site_id=eq.${siteId}&email=eq.${encodeURIComponent(EXAMPLE_EMAIL)}`);
  if (clientId) {
    for (const e of enquiries) { if (e.id) await clearNotice(clientId, 'lead_followup', `lead:${e.id}`).catch(() => {}); }
  }
  return { contacts: contacts.length, deals: deals.length, enquiries: enquiries.length };
}
