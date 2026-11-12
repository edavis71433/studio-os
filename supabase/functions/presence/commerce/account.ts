// ── L1 · Account creation — service role ────────────────────────────────────
// Creates the auth.users → contacts(auth_user_id) → clients chain that the
// whole ownership model resolves through (my_client_ids()). Every step rolls
// back the one before it on failure, so a half-made account never lingers
// (the lead_convert pattern). Idempotency for the SIGNUP as a whole lives one
// level up (presence_signups) — this module just builds the chain, once.

import { svc } from '../lib/db.ts';
import { TENANT_ID } from '../../_shared/auth.ts';
import { brandEmailShell, EMAIL_BRAND_DEFAULT, type EmailBrand } from '../lib/email_brand.ts';

const SB_URL = Deno.env.get('SUPABASE_URL') || '';
const SB_SERVICE = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const RESEND_KEY = Deno.env.get('RESEND_KEY') || '';
// Resend's address, unless a scratch run points it at a stand-in (scripts/isolation-scratch.sh).
// The free tools read the same name (_shared/tools/email.ts).
const RESEND_URL = Deno.env.get('RESEND_API_URL') || 'https://api.resend.com/emails';
const EMAIL_FROM = Deno.env.get('EMAIL_FROM') || 'Davis Digital Studio <eric@davisdigitalstudio.com>';

const authHeaders = { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json' };

// Final pass (Nov 8, S1): the old pattern let commas, brackets and quotes
// through, and findClientByEmail puts the address inside a PostgREST either/or
// filter, so "x@y.co,id.not.is.null" matched the first account on the platform.
// A real address never needs those characters; the domain is plain labels.
export function validEmail(email: string): boolean {
  if (typeof email !== 'string' || email.length > 254) return false;
  return /^[^\s@,()"\\;:<>[\]]{1,64}@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.(?:[a-z]{2,}|xn--[a-z0-9-]{2,})$/i.test(email);
}

/** A value made safe inside a PostgREST either/or (or=/and=) or in.() list:
 *  double-quoted, with backslashes and quotes escaped, then URL-encoded. */
export function pgrstQuoted(v: string): string {
  return encodeURIComponent('"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"');
}
export function passwordProblem(pw: string): string | null {
  if (typeof pw !== 'string' || pw.length < 8) return 'Please choose a password with at least 8 characters.';
  if (pw.length > 200) return 'That password is too long.';
  return null;
}

// Does an account already exist for this email? (their own client record)
export async function findClientByEmail(email: string): Promise<{ id: string; name: string } | null> {
  const want = String(email || '').trim().toLowerCase();
  if (!validEmail(want)) return null;
  const e = pgrstQuoted(want);
  const r = await svc(`clients?or=(email.eq.${e},contact_email.eq.${e})&deleted_at=is.null&select=id,name,email,contact_email&limit=5`);
  if (!r.ok || !Array.isArray(r.json)) return null;
  // exact recheck in memory — a filter that ever over-matches can never hand back someone else
  const hit = (r.json as any[]).find((c) => String(c.email || '').toLowerCase() === want || String(c.contact_email || '').toLowerCase() === want);
  return hit ? { id: String(hit.id), name: String(hit.name || '') } : null;
}

// Create the auth user. email_confirm:true so sign-in works immediately
// regardless of the project's dashboard confirmation setting (email
// verification is handled separately + non-blockingly, see verify token).
export async function createAuthUser(email: string, password: string): Promise<{ id: string } | { error: string }> {
  try {
    const r = await fetch(`${SB_URL}/auth/v1/admin/users`, {
      method: 'POST', headers: authHeaders,
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) {
      const msg = String(j?.msg || j?.error_description || j?.error || '').toLowerCase();
      if (msg.includes('already') || msg.includes('registered') || r.status === 422) return { error: 'account_exists' };
      return { error: 'auth_create_failed' };
    }
    if (!j?.id) return { error: 'auth_create_failed' };
    return { id: String(j.id) };
  } catch { return { error: 'auth_create_failed' }; }
}

export async function deleteAuthUser(id: string): Promise<void> {
  try { await fetch(`${SB_URL}/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders }); } catch { /* best-effort rollback */ }
}

// P2-C: a real, signed set-password link for a customer the STUDIO created (they
// never chose a password). Uses the admin generate_link (recovery) so the link is
// GoTrue-signed and lands on set-password.html; we email it ourselves (branded,
// via Resend) rather than relying on the project's auth-email config. Returns the
// action_link or null (caller degrades to a plain welcome).
export async function generateSetPasswordLink(email: string, redirectTo: string): Promise<string | null> {
  try {
    const r = await fetch(`${SB_URL}/auth/v1/admin/generate_link`, {
      method: 'POST', headers: authHeaders,
      body: JSON.stringify({ type: 'recovery', email, redirect_to: redirectTo }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) return null;
    return (j?.action_link || j?.properties?.action_link || null) as string | null;
  } catch { return null; }
}

// Create contacts + clients for a freshly-created auth user. Rolls the contact
// back if the client insert fails; the caller rolls back the auth user if this
// returns an error. Returns the ids on success.
export async function createContactAndClient(
  uid: string, email: string, businessName: string,
): Promise<{ contactId: string; clientId: string } | { error: string }> {
  const name = (businessName || email.split('@')[0] || 'New business').slice(0, 120);
  const contactIns = await svc('contacts', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ name, email, auth_user_id: uid, stage: 'active', tenant_id: TENANT_ID }),
  });
  const contactId = contactIns.json?.[0]?.id;
  if (!contactIns.ok || !contactId) return { error: 'contact_create_failed' };

  const clientIns = await svc('clients', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ name, email, contact_email: email, contact_id: contactId, tenant_id: TENANT_ID, status: 'active' }),
  });
  const clientId = clientIns.json?.[0]?.id;
  if (!clientIns.ok || !clientId) {
    await svc(`contacts?id=eq.${contactId}`, { method: 'DELETE' }); // roll back the contact
    return { error: 'client_create_failed' };
  }
  return { contactId, clientId };
}

// Builder list item 135: a client made with no owner (a studio's "+ New site")
// gets its owner's login later, the same chain createContactAndClient builds:
// auth.users → contacts(auth_user_id) → clients.contact_id, plus the email on
// the client row. Only while the client has no owner, and only for an email
// nobody signs in with yet: an existing account is never attached to someone
// else's site (final pass S1: asked, never taken). Undoes what it made when a
// later step fails.
export type AttachOwnerError = 'account_exists' | 'has_owner' | 'auth_failed' | 'contact_failed';
export async function attachOwnerLogin(clientId: string, email: string, name: string): Promise<{ ok: true; contactId: string } | { ok: false; error: AttachOwnerError }> {
  const want = String(email || '').trim().toLowerCase();
  if (!validEmail(want)) return { ok: false, error: 'auth_failed' };
  if (await findClientByEmail(want)) return { ok: false, error: 'account_exists' };
  const auth = await createAuthUser(want, crypto.randomUUID() + 'Aa1!');
  if (!('id' in auth)) return { ok: false, error: auth.error === 'account_exists' ? 'account_exists' : 'auth_failed' };
  const contactIns = await svc('contacts', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ name: (String(name || '').trim() || want.split('@')[0]).slice(0, 120), email: want, auth_user_id: auth.id, stage: 'active', tenant_id: TENANT_ID }),
  });
  const contactId = contactIns.json?.[0]?.id;
  if (!contactIns.ok || !contactId) { await deleteAuthUser(auth.id); return { ok: false, error: 'contact_failed' }; }
  // still ownerless at the moment of writing, so two invitations at once can't both land
  const w = await svc(`clients?id=eq.${clientId}&email=is.null&contact_id=is.null&select=id`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ email: want, contact_email: want, contact_id: contactId }),
  });
  if (!w.ok || !Array.isArray(w.json) || !w.json.length) {
    await svc(`contacts?id=eq.${contactId}`, { method: 'DELETE' }).catch(() => {});
    await deleteAuthUser(auth.id);
    // 409: another client took this email meanwhile (clients_email_key)
    return { ok: false, error: w.status === 409 ? 'account_exists' : w.ok ? 'has_owner' : 'contact_failed' };
  }
  return { ok: true, contactId: String(contactId) };
}

// A recovery/verify email link the customer can click. Uses Supabase's own
// recover endpoint so the link is a real, signed one that lands on
// set-password.html (the existing flow) — used here as "confirm it's you".
const RESEND_INBOUND_DOMAIN = Deno.env.get('RESEND_INBOUND_DOMAIN') || '';
const PLATFORM_REPLY_TO = Deno.env.get('PLATFORM_REPLY_TO') || 'eric@davisdigitalstudio.com';

// ROADMAP item 72: one plain address — no display name, no list, no spaces.
const PLAIN_ADDRESS = /^[^\s@<>()[\]",;:]+@[^\s@<>()[\]",;:]+\.[^\s@<>()[\]",;:]+$/;
/** The Reply-To a send carries. opts.replyTo wins: mail a site sends its OWN
 *  customers (a booking confirmation, a reminder, a review request) passes the
 *  business owner's email (lib/service_bridge.ts ownerReplyTo), so a salon's
 *  customer who hits Reply reaches the salon, not the platform. It counts only
 *  when it is one plain address and not one of the inbound domain's own: a
 *  badly filled-in identity card must never make Resend refuse a booking
 *  confirmation, and an inbound address is only ever reached through siteId,
 *  which names the site the reply belongs to. Otherwise the rule is the one
 *  this send always had: the site's inbound address for site conversation mail
 *  (opts.siteId), else the platform's human reply-to. Pure; exported for
 *  tests/presence/owner_reply_to_test.mjs. */
export function replyToFor(opts?: { siteId?: string; replyTo?: string }): string {
  const own = String(opts?.replyTo || '').trim();
  const inbound = RESEND_INBOUND_DOMAIN && own.toLowerCase().endsWith(`@${RESEND_INBOUND_DOMAIN.toLowerCase()}`);
  if (own.length <= 254 && PLAIN_ADDRESS.test(own) && !inbound) return own;
  return (opts?.siteId && RESEND_INBOUND_DOMAIN) ? `${opts.siteId}@${RESEND_INBOUND_DOMAIN}` : PLATFORM_REPLY_TO;
}

// ── the text/plain alternative ───────────────────────────────────────────────
// A plain-text part improves deliverability (spam-scoring) and serves text-only
// clients — but only if it READS. Derived from the body HTML, and the structure
// that carries the meaning has to survive the tag strip:
//
//   • cell ends (</td>, </th>) become a real SEPARATOR. Without this every
//     table-based email in this codebase (booking, review, the operator
//     notifications) renders "ProjectWebsite refresh" — the label welded to its
//     value — because the two <td>s are adjacent text once the tags are gone.
//   • block ends (</tr>, </p>, </div>, </li>, </h1-6>, </blockquote>, list and
//     table ends) become a LINE BREAK, so a row is a row and a bullet is a line.
//   • <br>, <br/> and <br /> all break (the old pattern matched only the bare
//     form, so a self-closed <br/> silently glued two lines together).
//
// A row-final separator is dropped rather than left dangling, so "A: B" — not
// "A: B: ". SENTINEL is a control character that cannot occur in email copy, so
// it can't collide with the text it is separating. Exported because the exact
// output is pinned by tests/presence/operational_mail_test.mjs.
//
// "cannot occur in email copy" was a claim about INPUT, not a property of this
// function — so it is now ENFORCED rather than assumed: any SENTINEL already in
// the source is stripped on entry, BEFORE any tag becomes one. Without that, a
// \x01 riding in on a subject line, a filename, a client's message excerpt or a
// pasted-in body survived the tag strip and was rewritten into ": " by the
// between-cells pass — `alpha\x01beta` came out `alpha: beta`, a label/value
// split invented out of nothing. No email body in this codebase can reach it
// today (every one is studio-authored HTML); the guard is here because the next
// caller will interpolate something it did not write, and an invariant a
// function depends on should be one the function establishes, not one it hopes
// its callers keep.
const SENTINEL = '';
export function htmlToPlainText(html: string | null | undefined): string {
  return String(html ?? '')
    .replace(new RegExp(SENTINEL, 'g'), '')                 // the separator is OURS — never the caller's
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(td|th)\s*>/gi, SENTINEL)
    .replace(/<\s*\/\s*(p|div|tr|li|ul|ol|h[1-6]|blockquote|table|thead|tbody|section|article)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    // tighten the horizontal whitespace the source HTML's own indentation leaves
    // around a separator, so the row-final test below sees the newline it needs
    .replace(new RegExp(`[^\\S\\r\\n]*${SENTINEL}[^\\S\\r\\n]*`, 'g'), SENTINEL)
    .replace(new RegExp(`${SENTINEL}+(?=\\n|$)`, 'g'), '')   // last cell of a row → no dangling separator
    .replace(new RegExp(`${SENTINEL}+`, 'g'), ': ')          // between cells → label: value
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Bytes as base64, for an email attachment. Pure. */
export function base64Of(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** The From a send carries (sales item 78). Mail a business sends to its own customers shows that
 *  business's name; the address stays the platform's sending address, so delivery (SPF, DKIM,
 *  DMARC) is unchanged. The name is cleaned for the header: no quotes, angle brackets, line
 *  breaks or "@" (a name must never read as an address), at most 70 characters. Pure; exported
 *  for tests/presence/email_sender_test.mjs. */
export function fromFor(base: string, name?: string | null): string {
  const b = String(base || '').trim();
  const addr = /<([^<>\s]+@[^<>\s]+)>\s*$/.exec(b)?.[1] || (PLAIN_ADDRESS.test(b) ? b : '');
  const clean = String(name || '').replace(/[\u0000-\u001f\u007f@]/g, ' ').replace(/["\\<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 70).trim();
  if (!addr || !clean) return b;
  return `"${clean}" <${addr}>`;
}

/** The name the platform's own mail goes out under (EMAIL_FROM's display name): who a page
 *  names when no studio is known (sales item 92). Pure on the environment. */
export function platformSenderName(): string {
  return /^\s*"?([^"<]+?)"?\s*</.exec(EMAIL_FROM)?.[1]?.trim() || 'Davis Digital Studio';
}

/** Can an unsubscribe stop this send? Sales items 74 and 75: mail that always arrives (critical:
 *  receipts, documents, sign-in links, a business's own alerts, payment reminders) carries no
 *  unsubscribe at all, neither the one-click header nor a link, because an unsubscribe would not
 *  stop it and a button that does nothing invites a spam report, which blocks every email to
 *  that person. Everything else carries both. Pure. */
export function unsubscribable(opts?: { critical?: boolean }): boolean {
  return !opts?.critical;
}

export async function sendEmail(to: string, subject: string, html: string, brand?: EmailBrand, opts?: { critical?: boolean; asBusiness?: boolean; siteId?: string; replyTo?: string; headers?: Record<string, string>; attachments?: Array<{ filename: string; content: Uint8Array }> }): Promise<boolean> {
  if (!RESEND_KEY) { console.warn('[commerce] RESEND_KEY unset — skipping email'); return false; }
  try {
    // Honor the suppression list at the ONE send point. critical:true =
    // transactional mail (receipts, security, deletion confirmations) — it
    // survives an OPT-OUT (exactly what the unsubscribe page promises) but
    // NEVER a bounce/complaint (dead/hostile address; re-sending only burns
    // the domain). Recipients are MASKED in logs (edge logs are retained).
    const { maySend, maskEmail, unsubscribeUrl, unsubscribePageUrl } = await import('../routes/email_infra.ts');
    const gate = await maySend(to, opts);
    if (!gate.ok) { console.warn(`[email] suppressed (${gate.reason}) — not sending to ${maskEmail(to)}`); return false; }
    // Sales items 74 + 75: only mail an unsubscribe stops offers one (see unsubscribable)
    const optional = unsubscribable(opts);
    const unsubUrl = optional ? await unsubscribeUrl(to) : '';
    const pageUrl = optional ? await unsubscribePageUrl(to) : '';
    // Sales item 78: asBusiness = the brand's business is the sender (its name, its footer)
    const asBusiness = !!(opts?.asBusiness && brand && brand.name !== EMAIL_BRAND_DEFAULT.name);
    // BR-1: every email flows through the ONE branded shell (Studio OS default, or
    // the customer's Brand Kit when the caller passes it). No second email engine.
    const wrapped = brandEmailShell(html, brand || EMAIL_BRAND_DEFAULT, { unsubscribeUrl: pageUrl || null, asBusiness });
    // A plain-text alternative improves deliverability (spam-scoring) and serves
    // text-only clients — derived from the body HTML (see htmlToPlainText: cell
    // and block boundaries survive the tag strip, so a table still reads).
    const text = htmlToPlainText(html) + (pageUrl ? `\n\nUnsubscribe: ${pageUrl}` : '');
    const r = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      // List-Unsubscribe: RFC 8058 one-click HTTPS endpoint (what Gmail/Yahoo
      // bulk-sender rules actually honor) + mailto fallback, on mail an unsubscribe
      // stops. The POST lands on /unsubscribe which writes the ONE suppression store
      // this send checks.
      // R1 loop-closure: when the caller is SITE mail (a studio↔customer message,
      // ack, or bridge nudge) AND an inbound domain is configured, the reply-to is
      // that site's inbound address (<siteId>@<domain>) so a customer's REPLY lands
      // back on /email/inbound and onto their conversation. Platform mail
      // (scheduler, deletion, commerce, invites…) never passes siteId and keeps the
      // human platform reply-to. Item 72: opts.replyTo (the business owner's own
      // email) comes before both — see replyToFor. opts.headers are spread AFTER
      // the List-Unsubscribe headers (e.g. the inbound ack's Auto-Submitted:auto-replied).
      body: JSON.stringify({
        from: asBusiness ? fromFor(EMAIL_FROM, brand?.name) : EMAIL_FROM, to, subject, html: wrapped, text,
        reply_to: replyToFor(opts),
        // sales item 82: an invoice, receipt or signed agreement goes with its PDF (Resend takes base64)
        ...(opts?.attachments?.length ? { attachments: opts.attachments.map((a) => ({ filename: a.filename, content: base64Of(a.content) })) } : {}),
        headers: {
          ...(optional ? {
            'List-Unsubscribe': `<${unsubUrl}>, <mailto:support@davisdigitalstudio.com?subject=unsubscribe>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          } : {}),
          ...(opts?.headers || {}),
        },
      }),
    });
    // Log failures (mirrors clever-api) so a Resend outage isn't invisible.
    if (!r.ok) { try { const { maskEmail } = await import('../routes/email_infra.ts'); console.error(`[email] Resend ${r.status} to ${maskEmail(to)}: ${(await r.text()).slice(0, 300)}`); } catch { /* */ } }
    return r.ok;
  } catch (e) { console.error(`[email] send threw: ${String((e as Error)?.message || e)}`); return false; }
}
