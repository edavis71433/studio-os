// ── A fresh code before the risky actions (builder list item 191, Nov 2026) ─────
// Squarespace emails the owner a one-time code before an invite; Studio OS asked for nothing
// but the sign-in the browser already held, so one stolen session could hand a client's
// site to a stranger (Nov 12 review: file 01 finding 5, file 04 findings 3 and 10). Now four
// actions ask for a fresh code first, whoever does them:
//   invite_coowner   inviting a co-owner, or making someone one
//   transfer         handing a site to someone else (starting it, or the owner agreeing)
//   domain_remove    removing the site's domain
//   close_account    asking for the account to be closed
// Someone with two-step sign-in on types the code from their authenticator app, and
// Supabase Auth checks it (the factor's own challenge and verify, with their sign-in).
// Everyone else is emailed a 6-digit code, kept here only as a keyed hash
// (presence_fresh_codes, migration 0197): it works once, for FRESH_MINUTES, for that one
// action, with FRESH_TRIES tries, and at most FRESH_SENDS are sent in ten minutes.
//
// The code rides in the request's own body (fresh_code), so a page needs no new headers:
// the first try answers 403 fresh_code_needed (and, for email, sends the code); the page's
// sheet (fresh-code.js) asks for it and sends the same request again with it.
import { svc } from './db.ts';
import { json } from '../../_shared/http.ts';
import { authUser, type Principal } from '../../_shared/auth.ts';
import { hmacHex, timingSafeEqual } from '../../_shared/hmac.ts';
import { maskEmail } from '../../_shared/email_infra.ts';
import { rateAllow } from './ratelimit.ts';

export type FreshAction = 'invite_coowner' | 'transfer' | 'domain_remove' | 'close_account';
export const FRESH_MINUTES = 10, FRESH_TRIES = 5, FRESH_SENDS = 3;

/** What each action is, in a sentence, and what its button says once the code is in. Pure. */
export const FRESH_WORDS: Record<FreshAction, { doing: string; go: string }> = {
  invite_coowner: { doing: 'invite a co-owner', go: 'Confirm and send the invite' },
  transfer: { doing: 'hand a site to someone else', go: 'Confirm and hand it over' },
  domain_remove: { doing: 'remove a domain', go: 'Confirm and remove it' },
  close_account: { doing: 'close the account', go: 'Confirm and close the account' },
};

const signingKey = () => Deno.env.get('APPROVAL_SECRET') || Deno.env.get('SCHEDULER_SECRET') || Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const SB_URL = () => Deno.env.get('SUPABASE_URL') || '';
const ANON = () => Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

/** Six digits, every value equally likely. */
export function newCode(): string {
  const a = new Uint32Array(1);
  do crypto.getRandomValues(a); while (a[0] >= 4_294_000_000);   // a whole number of millions, so no digit is likelier
  return String(a[0] % 1_000_000).padStart(6, '0');
}
/** The code as kept: a hash keyed by the server's secret and the row it belongs to. */
export async function codeHash(id: string, code: string, key = signingKey()): Promise<string> {
  return await hmacHex(key || 'fresh-code', `fresh-code|${id}|${code}`);
}
/** The code a person typed, as six digits, or '' (spaces and dashes are forgiven). Pure. */
export function typedCode(v: unknown): string {
  const d = String(v ?? '').replace(/[\s-]/g, '');
  return /^\d{6}$/.test(d) ? d : '';
}
/** A person's verified authenticator app (Supabase's TOTP factor), or null. Pure. */
export function appFactor(user: { factors?: unknown } | null | undefined): string | null {
  const f = (Array.isArray(user?.factors) ? user!.factors as Array<{ id?: unknown; factor_type?: unknown; status?: unknown }> : [])
    .find((x) => x?.factor_type === 'totp' && x?.status === 'verified');
  return f?.id ? String(f.id) : null;
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** The code's email. Pure. */
export function codeEmail(code: string, action: FreshAction, what: string): { subject: string; html: string } {
  return {
    subject: `${code} is your Studio OS code`,
    html: `<p>Use this code to ${esc(FRESH_WORDS[action].doing)}${what ? `: ${esc(what)}` : ''}.</p>` +
      `<p style="margin:18px 0;font-size:30px;font-weight:700;letter-spacing:8px">${code}</p>` +
      `<p>It works once, for ${FRESH_MINUTES} minutes.</p>` +
      `<p style="color:#6b6478;font-size:13px">Didn’t ask for it? Someone may be signed in as you. Change your password, and tell your studio.</p>`,
  };
}

/** The outside calls; tests swap them. */
export const freshDeps = {
  user: (jwt: string): Promise<{ id?: string; email?: string; factors?: unknown } | null> => authUser(jwt),
  /** Supabase Auth checks an app code with the person's own sign-in: true, false (wrong), or null (couldn't ask). */
  verifyApp: async (jwt: string, factorId: string, code: string): Promise<boolean | null> => {
    try {
      const h = { apikey: ANON(), Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' };
      const ch = await fetch(`${SB_URL()}/auth/v1/factors/${encodeURIComponent(factorId)}/challenge`, { method: 'POST', headers: h, body: '{}' });
      const cj = await ch.json().catch(() => null);
      if (!ch.ok || !cj?.id) return ch.status >= 500 ? null : false;
      const v = await fetch(`${SB_URL()}/auth/v1/factors/${encodeURIComponent(factorId)}/verify`, { method: 'POST', headers: h, body: JSON.stringify({ challenge_id: cj.id, code }) });
      await v.body?.cancel().catch(() => {});
      return v.ok ? true : v.status >= 500 ? null : false;
    } catch { return null; }
  },
  send: async (to: string, subject: string, html: string): Promise<boolean> => {
    const { sendEmail } = await import('../commerce/account.ts');   // lazy: account pulls in the email shell
    return await sendEmail(to, subject, html, undefined, { critical: true });
  },
};

/** How the person confirmed (for the owner's alert), or the answer that asks for a code. */
type Answer = Response | { way: 'app' | 'email' | 'none' };
const refuse = (cors: Record<string, string>, status: number, body: Record<string, unknown>) => json(body, status, { ...cors, 'Cache-Control': 'no-store' });

/** { way } when this request carries a good fresh code for `action` (and the email code is used
 *  up); otherwise the answer that asks for one, sending it by email when that is the way.
 *  `what` names the thing in the email and the sheet ("Alex Kim as Co-owner of Bloom Salon"). */
export async function requireFresh(principal: Principal, body: { fresh_code?: unknown } | null | undefined, action: FreshAction, what: string, cors: Record<string, string>): Promise<Answer> {
  if (principal.kind === 'system') return { way: 'none' };   // the scheduler and the operator's own tools
  const jwt = principal.jwt || '';
  if (!jwt || !principal.userId) return refuse(cors, 401, { error: 'unauthorized', message: 'Please sign in again.' });
  const user = await freshDeps.user(jwt);
  if (!user?.id) return refuse(cors, 401, { error: 'unauthorized', message: 'Please sign in again.' });
  const go = FRESH_WORDS[action].go;
  const code = typedCode(body?.fresh_code);
  const factor = appFactor(user);

  // ── their authenticator app ──
  if (factor) {
    if (!code) return refuse(cors, 403, { error: 'fresh_code_needed', way: 'app', action, what, go, message: 'Type the 6-digit code from your authenticator app.' });
    if (!(await rateAllow(`fresh:try:${user.id}:${action}`, FRESH_TRIES, FRESH_MINUTES * 60))) return refuse(cors, 429, { error: 'fresh_code_tries', way: 'app', action, what, go, message: `Too many tries. Wait ${FRESH_MINUTES} minutes, then use the newest code in your app.` });
    const okApp = await freshDeps.verifyApp(jwt, factor, code);
    if (okApp === null) return refuse(cors, 503, { error: 'fresh_code_unavailable', way: 'app', action, what, go, message: 'We couldn’t check that code just now. Try again in a moment.' });
    return okApp ? { way: 'app' } : refuse(cors, 403, { error: 'fresh_code_wrong', way: 'app', action, what, go, message: 'That code isn’t right. Use the newest one in your app.' });
  }

  // ── an emailed code ──
  const to = String(user.email || principal.email || '').trim().toLowerCase();
  if (!to) return refuse(cors, 409, { error: 'fresh_code_no_email', action, message: 'This sign-in has no email address to send a code to. Ask your studio.' });
  const nowIso = new Date().toISOString();
  if (code) {
    const r = await svc(`presence_fresh_codes?user_id=eq.${user.id}&action=eq.${action}&used_at=is.null&expires_at=gt.${encodeURIComponent(nowIso)}&select=id,code_hash,tries&order=created_at.desc&limit=1`);
    if (!r.ok) return refuse(cors, r.status === 404 ? 503 : 502, { error: 'unavailable', action, message: r.status === 404 ? 'This needs a one-time database update first.' : 'We couldn’t check that code just now. Try again in a moment.' });
    const row = Array.isArray(r.json) ? r.json[0] : null;
    if (!row) return await sendCode(user.id, to, action, what, go, cors, 'fresh_code_expired');
    const tries = Number(row.tries) || 0;
    if (tries >= FRESH_TRIES) return refuse(cors, 429, { error: 'fresh_code_tries', way: 'email', to: maskEmail(to), action, what, go, message: 'Too many tries with that code. Ask for a new one.' });
    if (timingSafeEqual(String(row.code_hash), await codeHash(String(row.id), code))) {
      // used once: the row that was still unused is the one marked, so two sends can't share it
      const used = await svc(`presence_fresh_codes?id=eq.${row.id}&used_at=is.null&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ used_at: nowIso }) });
      if (used.ok && Array.isArray(used.json) && used.json.length) return { way: 'email' };
      return refuse(cors, 403, { error: 'fresh_code_wrong', way: 'email', to: maskEmail(to), action, what, go, message: 'That code was just used. Ask for a new one.' });
    }
    const left = FRESH_TRIES - tries - 1;
    await svc(`presence_fresh_codes?id=eq.${row.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ tries: tries + 1 }) }).catch(() => null);
    return refuse(cors, 403, { error: 'fresh_code_wrong', way: 'email', to: maskEmail(to), action, what, go, tries_left: Math.max(0, left), message: left > 0 ? `That code isn’t right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'That code isn’t right, and that was its last try. Ask for a new one.' });
  }
  return await sendCode(user.id, to, action, what, go, cors, 'fresh_code_needed');
}

/** Make and email a new code, and answer that it's on its way. */
async function sendCode(userId: string, to: string, action: FreshAction, what: string, go: string, cors: Record<string, string>, error: 'fresh_code_needed' | 'fresh_code_expired'): Promise<Response> {
  const masked = maskEmail(to);
  if (!(await rateAllow(`fresh:send:${userId}`, FRESH_SENDS, FRESH_MINUTES * 60))) return refuse(cors, 429, { error: 'fresh_code_sends', way: 'email', to: masked, action, what, go, message: `We’ve sent ${FRESH_SENDS} codes in the last ${FRESH_MINUTES} minutes. Use the newest one, or wait a few minutes.` });
  const id = crypto.randomUUID(), code = newCode();
  const ins = await svc('presence_fresh_codes', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ id, user_id: userId, action, code_hash: await codeHash(id, code), expires_at: new Date(Date.now() + FRESH_MINUTES * 60_000).toISOString() }) });
  if (!ins.ok) return refuse(cors, ins.status === 404 ? 503 : 502, { error: 'unavailable', action, message: ins.status === 404 ? 'This needs a one-time database update first.' : 'We couldn’t make a code just now. Try again in a moment.' });
  const mail = codeEmail(code, action, what);
  if (!(await freshDeps.send(to, mail.subject, mail.html))) return refuse(cors, 503, { error: 'fresh_code_not_sent', way: 'email', to: masked, action, what, go, message: 'We couldn’t send your code just now. Try again in a moment.' });
  return refuse(cors, 403, { error, way: 'email', to: masked, action, what, go, minutes: FRESH_MINUTES, message: error === 'fresh_code_expired' ? `That code has run out. We’ve sent a new one to ${masked}.` : `We emailed a 6-digit code to ${masked}. It works for ${FRESH_MINUTES} minutes.` });
}
