// ── The person who wrote in becomes a contact before the studio emails them ──
// The Inbox's inbound address lands mail only from people on file, so a reply
// from a stranger is dropped. A hand-written reply (routes/commercial.ts) has
// always made the writer a contact first; since sales item 142 (Nov 22 2026
// review) the automatic acknowledgement and the two follow-ups do the same, and
// go out with the Inbox as their reply address, so an answer to any of them lands
// on the enquiry and stops the series. Idempotent and best-effort: a contact that
// exists is left alone, and a failed write never stops the email.
import { svc } from './db.ts';
import { normEmail, emailMatch } from './contact_email.ts';

export async function ensureLeadContact(siteId: string, emailIn: string, name: string, phone: string): Promise<void> {
  // item 110 (K1): kept lower-cased and matched whatever the capitals, the way the database's
  // one-contact-per-email rule matches — Jane@Example.com used to block every later add of her
  const email = normEmail(emailIn);
  if (!email) return;
  const hit = await svc(`presence_contacts?site_id=eq.${siteId}&${emailMatch(email)}&deleted_at=is.null&select=id&limit=1`);
  if (Array.isArray(hit.json) && hit.json.length) return;
  await svc('presence_contacts', { method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ site_id: siteId, name: name || '', email, phone: phone || '' }) }).catch(() => {});
}
