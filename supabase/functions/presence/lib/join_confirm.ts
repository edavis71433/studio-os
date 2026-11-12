// ── "Join our list" counts once the person says yes (builder list item 203) ──
// The box used to add whatever address was typed, and the record said that person had
// agreed. Now joining sends one email to that address, from the business, with a
// "Yes, add me" link; only pressing the button on join.html adds them, with the day
// they said yes. Nothing is kept before that: the link carries the site, the address
// and the page they joined on, signed and good for JOIN_LINK_DAYS. One such email a day
// goes to an address (lib/auto_reply.ts), so the box can't be used to send a stranger
// mail over and over.
import { hmacHex, timingSafeEqual } from '../../_shared/hmac.ts';

export const JOIN_LINK_DAYS = 7;
/** What the box says once the email is on its way (the same whoever typed the address). */
export const JOIN_CHECK_EMAIL = 'Almost there: check your email and press “Yes, add me”.';
/** What join.html says once they pressed it. */
export const JOINED = 'You’re on the list. Thank you!';

const signingKey = () => Deno.env.get('APPROVAL_SECRET') || Deno.env.get('SCHEDULER_SECRET') || '';
// base64url of UTF-8, so an address with accents survives the trip
const b64u = (s: string) => { let bin = ''; for (const x of new TextEncoder().encode(s)) bin += String.fromCharCode(x); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = (s: string) => { try { const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/')); return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))); } catch { return ''; } };

/** The signed "Yes, add me" link's token; empty when no signing key is set. */
export async function joinLinkToken(siteId: string, email: string, page: string, nowSec = Math.floor(Date.now() / 1000), key = signingKey()): Promise<string> {
  if (!key) return '';
  const body = b64u(JSON.stringify({ s: siteId, m: email, p: page, e: nowSec + JOIN_LINK_DAYS * 86400 }));
  return `${body}.${(await hmacHex(key, `join-link|${body}`)).slice(0, 40)}`;
}

/** The site, address and page a token names; 'expired' past its days; null when it isn't one of ours. */
export async function readJoinLinkToken(token: unknown, nowSec = Math.floor(Date.now() / 1000), key = signingKey()): Promise<{ siteId: string; email: string; page: string } | 'expired' | null> {
  const m = /^([A-Za-z0-9_-]{10,1200})\.([0-9a-f]{40})$/.exec(String(token ?? '').trim());
  if (!m || !key || !timingSafeEqual(m[2], (await hmacHex(key, `join-link|${m[1]}`)).slice(0, 40))) return null;
  let p: { s?: unknown; m?: unknown; p?: unknown; e?: unknown };
  try { p = JSON.parse(unb64u(m[1])); } catch { return null; }
  if (!p || typeof p.s !== 'string' || !/^[0-9a-f-]{36}$/.test(p.s) || typeof p.m !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.m) || typeof p.e !== 'number') return null;
  if (p.e < nowSec) return 'expired';
  return { siteId: p.s, email: p.m, page: typeof p.p === 'string' ? p.p : '/' };
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The email's subject. Pure. */
export function joinEmailSubject(business: string): string {
  return business ? `Confirm: join ${business}’s list` : 'Confirm: join the list';
}
/** The email's body: who asked, the one button, and what happens if it wasn't them. Pure. */
export function joinEmailHtml(o: { business: string; email: string; link: string; accent: string }): string {
  const who = o.business || 'this business';
  return `<p>Someone, we hope you, asked to get updates from ${esc(who)} by email at ${esc(o.email)}.</p>` +
    `<p class="cta"><a href="${esc(o.link)}" style="display:inline-block;margin-top:6px;background:${esc(o.accent)};color:#fff;padding:10px 20px;border-radius:999px;text-decoration:none;font-weight:600">Yes, add me</a></p>` +
    `<p style="color:#6b6478;font-size:13px">If it wasn’t you, ignore this email and nothing happens: you won’t be added. The button works for ${JOIN_LINK_DAYS} days.</p>`;
}
