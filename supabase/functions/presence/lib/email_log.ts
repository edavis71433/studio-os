// ── The "log this email" address (sales review item 69, Nov 2026) ────────────
// Salesforce's Email to Salesforce: each studio gets a private address such as
// log-1a2b3c…@reply.<domain>. BCC it when you email a client from Gmail or
// Outlook, and the email lands on that client's deal activity and record as
// "You logged an email", matched by the address you sent it to. It rides the
// inbound door item 35 proved; the token in the address is the key, and only
// mail genuinely from the studio's own team (DMARC pass) is logged. Pure.

export const LOG_TOKEN_RE = /^[0-9a-f]{24}$/;
const LOG_LOCAL_RE = /^log-([0-9a-f]{24})$/;

/** A fresh, unguessable token: 12 random bytes as 24 hex characters. */
export function newLogToken(): string {
  const b = new Uint8Array(12); crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
/** The address for a token on the inbound domain ('' when either is missing). */
export function logAddress(token: string, inboundDomain: string): string {
  return LOG_TOKEN_RE.test(token) && inboundDomain ? `log-${token}@${inboundDomain.toLowerCase()}` : '';
}
/** The log token among a message's recipients (header To/Cc, Bcc, or the envelope's
 *  received-for, where a BCC shows up), on OUR inbound domain only. '' when none. */
export function logTokenIn(addresses: unknown[], inboundDomain: string): string {
  const dom = String(inboundDomain || '').trim().toLowerCase();
  if (!dom) return '';
  for (const a of addresses || []) {
    const m = /<([^<>]+)>/.exec(String(a ?? '')); const email = (m ? m[1] : String(a ?? '')).trim().toLowerCase();
    const at = email.lastIndexOf('@');
    if (at <= 0 || email.slice(at + 1) !== dom) continue;
    const t = LOG_LOCAL_RE.exec(email.slice(0, at));
    if (t) return t[1];
  }
  return '';
}
/** What the activity says: the subject on the first line, then what was written. */
export function loggedEmailBody(subject: unknown, text: unknown, max = 2000): string {
  const s = String(subject ?? '').trim(), t = String(text ?? '').trim();
  return (s && t ? `${s}\n\n${t}` : s || t).slice(0, max);
}
