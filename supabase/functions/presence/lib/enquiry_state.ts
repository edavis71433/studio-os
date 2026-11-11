// ── Where a website enquiry stands once it was taken further (bug hunt C5, Nov 10 2026) ──
// An enquiry is marked `converted` when it becomes a deal (POST /sales/deals) or a
// customer (POST /sales/customers). The Inbox used to read "In pipeline — view deal"
// from that status alone, so an enquiry whose deal was later deleted, or one made a
// customer with no deal, showed a link that opened nothing and lost "Make it a deal".
// Now the queue (GET /forms/inbox) says In pipeline only with a live deal, Customer
// when the person became one of the studio's customers, and otherwise treats it as
// seen; and deleting a deal puts its enquiry back in the queue (reopenEnquiry).
import { svc } from './db.ts';
import { pgrstQuoted } from '../commerce/account.ts';
import { UUID_RE } from './uuid.ts';

const rowsOf = (r: { json?: unknown }) => (Array.isArray((r as { json?: unknown }).json) ? (r as { json: unknown[] }).json : []) as any[];

/** Pure: what the Inbox is told about one enquiry. In pipeline only with a deal to
 *  open; a customer only when no deal is live and the person is one. */
export function enquiryState(status: unknown, dealId: string | null, isCustomer: boolean): { converted: boolean; customer: boolean } {
  return { converted: !!dealId, customer: !dealId && status === 'converted' && isCustomer };
}

/** Pure: the status an enquiry goes back to once the deal it became is gone —
 *  Replied when the studio had answered it from the Inbox, else Read. */
export function reopenedStatus(fields: unknown): 'read' | 'replied' {
  const list = fields && typeof fields === 'object' ? (fields as { __studio_replies?: unknown }).__studio_replies : null;
  return Array.isArray(list) && list.some((r) => r && typeof (r as { body?: unknown }).body === 'string') ? 'replied' : 'read';
}

/** Of these email addresses, the ones (lowercased) that belong to one of the studio's
 *  customers: a live contact on the site linked to a client. The customer route keeps
 *  its contact's address lowercased; the enquiry keeps it as the visitor typed it, so
 *  both spellings are asked for. Null when the read failed. */
export async function customerEmails(siteId: string, emails: string[]): Promise<Set<string> | null> {
  const out = new Set<string>();
  const ask = [...new Set(emails.flatMap((e) => { const t = String(e || '').trim(); return t ? [t, t.toLowerCase()] : []; }))];
  if (!ask.length) return out;
  try {
    const r = await svc(`presence_contacts?site_id=eq.${siteId}&deleted_at=is.null&client_id=not.is.null&email=in.(${ask.map(pgrstQuoted).join(',')})&select=email`);
    if (!r.ok) return null;
    for (const c of rowsOf(r)) if (c && c.email) out.add(String(c.email).trim().toLowerCase());
    return out;
  } catch { return null; }
}

/** After a deal is deleted: the website enquiry it came from goes back to the queue
 *  as seen (or Replied), so the Inbox offers "Make it a deal" again — unless another
 *  live deal still carries it, or the person became a customer (then it stays theirs).
 *  Only a `converted` enquiry is touched, and only on this site. Best-effort. */
export async function reopenEnquiry(siteId: string, submissionId: unknown): Promise<boolean> {
  const id = String(submissionId || '');
  if (!UUID_RE.test(id)) return false;
  try {
    const [subQ, liveQ] = await Promise.all([
      svc(`presence_form_submissions?id=eq.${id}&site_id=eq.${siteId}&select=id,status,email,fields&limit=1`),
      svc(`presence_deals?site_id=eq.${siteId}&source_submission_id=eq.${id}&deleted_at=is.null&select=id&limit=1`),
    ]);
    const sub = rowsOf(subQ)[0];
    if (!subQ.ok || !liveQ.ok || !sub || sub.status !== 'converted' || rowsOf(liveQ).length) return false;
    if (sub.email) { const known = await customerEmails(siteId, [String(sub.email)]); if (!known || known.size) return false; }   // a customer's stays theirs; unsure → leave it
    const w = await svc(`presence_form_submissions?id=eq.${id}&site_id=eq.${siteId}&status=eq.converted`, { method: 'PATCH', body: JSON.stringify({ status: reopenedStatus(sub.fields) }) });
    return w.ok;
  } catch { return false; }
}
