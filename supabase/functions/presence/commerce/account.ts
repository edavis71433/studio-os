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
const EMAIL_FROM = Deno.env.get('EMAIL_FROM') || 'Davis Digital Studio <eric@davisdigitalstudio.com>';

const authHeaders = { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json' };

export function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}
export function passwordProblem(pw: string): string | null {
  if (typeof pw !== 'string' || pw.length < 8) return 'Please choose a password with at least 8 characters.';
  if (pw.length > 200) return 'That password is too long.';
  return null;
}

// Does an account already exist for this email? (their own client record)
export async function findClientByEmail(email: string): Promise<{ id: string; name: string } | null> {
  const e = encodeURIComponent(email.toLowerCase());
  const r = await svc(`clients?or=(email.eq.${e},contact_email.eq.${e})&deleted_at=is.null&select=id,name&limit=1`);
  return (r.ok && Array.isArray(r.json) && r.json.length) ? r.json[0] : null;
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

// A recovery/verify email link the customer can click. Uses Supabase's own
// recover endpoint so the link is a real, signed one that lands on
// set-password.html (the existing flow) — used here as "confirm it's you".
const RESEND_INBOUND_DOMAIN = Deno.env.get('RESEND_INBOUND_DOMAIN') || '';
const PLATFORM_REPLY_TO = Deno.env.get('PLATFORM_REPLY_TO') || 'eric@davisdigitalstudio.com';

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

export async function sendEmail(to: string, subject: string, html: string, brand?: EmailBrand, opts?: { critical?: boolean; siteId?: string; headers?: Record<string, string> }): Promise<boolean> {
  if (!RESEND_KEY) { console.warn('[commerce] RESEND_KEY unset — skipping email'); return false; }
  try {
    // Honor the suppression list at the ONE send point. critical:true =
    // transactional mail (receipts, security, deletion confirmations) — it
    // survives an OPT-OUT (exactly what the unsubscribe page promises) but
    // NEVER a bounce/complaint (dead/hostile address; re-sending only burns
    // the domain). Recipients are MASKED in logs (edge logs are retained).
    const { maySend, maskEmail, unsubscribeUrl } = await import('../routes/email_infra.ts');
    const gate = await maySend(to, opts);
    if (!gate.ok) { console.warn(`[email] suppressed (${gate.reason}) — not sending to ${maskEmail(to)}`); return false; }
    const unsubUrl = await unsubscribeUrl(to);
    // BR-1: every email flows through the ONE branded shell (Studio OS default, or
    // the customer's Brand Kit when the caller passes it). No second email engine.
    const wrapped = brandEmailShell(html, brand || EMAIL_BRAND_DEFAULT);
    // A plain-text alternative improves deliverability (spam-scoring) and serves
    // text-only clients — derived from the body HTML (see htmlToPlainText: cell
    // and block boundaries survive the tag strip, so a table still reads).
    const text = htmlToPlainText(html);
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      // List-Unsubscribe: RFC 8058 one-click HTTPS endpoint (what Gmail/Yahoo
      // bulk-sender rules actually honor) + mailto fallback. The POST lands on
      // /unsubscribe which writes the ONE suppression store this send checks.
      // R1 loop-closure: when the caller is SITE mail (a studio↔customer message,
      // ack, or bridge nudge) AND an inbound domain is configured, the reply-to is
      // that site's inbound address (<siteId>@<domain>) so a customer's REPLY lands
      // back on /email/inbound and onto their conversation. Platform mail
      // (scheduler, deletion, commerce, invites…) never passes siteId and keeps the
      // human platform reply-to. opts.headers are spread AFTER the List-Unsubscribe
      // headers (e.g. the inbound ack's Auto-Submitted:auto-replied).
      body: JSON.stringify({
        from: EMAIL_FROM, to, subject, html: wrapped, text,
        reply_to: (opts?.siteId && RESEND_INBOUND_DOMAIN) ? `${opts.siteId}@${RESEND_INBOUND_DOMAIN}` : PLATFORM_REPLY_TO,
        headers: {
          'List-Unsubscribe': `<${unsubUrl}>, <mailto:support@davisdigitalstudio.com?subject=unsubscribe>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          ...(opts?.headers || {}),
        },
      }),
    });
    // Log failures (mirrors clever-api) so a Resend outage isn't invisible.
    if (!r.ok) { try { const { maskEmail } = await import('../routes/email_infra.ts'); console.error(`[email] Resend ${r.status} to ${maskEmail(to)}: ${(await r.text()).slice(0, 300)}`); } catch { /* */ } }
    return r.ok;
  } catch (e) { console.error(`[email] send threw: ${String((e as Error)?.message || e)}`); return false; }
}
