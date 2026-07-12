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
export async function sendEmail(to: string, subject: string, html: string, brand?: EmailBrand): Promise<boolean> {
  if (!RESEND_KEY) { console.warn('[commerce] RESEND_KEY unset — skipping email to', to); return false; }
  try {
    // Honor the suppression list (opt-outs, bounces, complaints) at the ONE send
    // point — continuing to mail a bounced/complained address junks the whole
    // domain's reputation, and mailing an opt-out breaks the promise we printed.
    const { isSuppressed, unsubscribeUrl } = await import('../routes/email_infra.ts');
    if (await isSuppressed(to)) { console.warn(`[email] suppressed — not sending to ${to}`); return false; }
    const unsubUrl = await unsubscribeUrl(to);
    // BR-1: every email flows through the ONE branded shell (Studio OS default, or
    // the customer's Brand Kit when the caller passes it). No second email engine.
    const wrapped = brandEmailShell(html, brand || EMAIL_BRAND_DEFAULT);
    // A plain-text alternative improves deliverability (spam-scoring) and serves
    // text-only clients — derived from the body HTML (tags stripped, entities decoded).
    const text = String(html || '')
      .replace(/<\s*(br|\/p|\/div|\/tr|\/h[1-6])\s*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/\n{3,}/g, '\n\n').trim();
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      // List-Unsubscribe: RFC 8058 one-click HTTPS endpoint (what Gmail/Yahoo
      // bulk-sender rules actually honor) + mailto fallback. The POST lands on
      // /unsubscribe which writes the ONE suppression store this send checks.
      body: JSON.stringify({
        from: EMAIL_FROM, to, subject, html: wrapped, text, reply_to: 'eric@davisdigitalstudio.com',
        headers: {
          'List-Unsubscribe': `<${unsubUrl}>, <mailto:support@davisdigitalstudio.com?subject=unsubscribe>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
    });
    // Log failures (mirrors clever-api) so a Resend outage isn't invisible.
    if (!r.ok) { try { console.error(`[email] Resend ${r.status} to ${to}: ${(await r.text()).slice(0, 300)}`); } catch { /* */ } }
    return r.ok;
  } catch (e) { console.error(`[email] send threw for ${to}: ${String((e as Error)?.message || e)}`); return false; }
}
