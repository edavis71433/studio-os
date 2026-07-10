// ── P2-E W6 (M4): terms/privacy acceptance evidence ──────────────────────────
// The authoritative version strings live server-side (env-overridable so a legal
// update bumps the version without a redeploy). recordAcceptance writes one
// append-only evidence row; it is best-effort and NEVER blocks signup — a
// logging failure must not cost a customer their account. Bump these when the
// terms/privacy text materially changes.
import { svc } from '../lib/db.ts';

export const TERMS_VERSION = Deno.env.get('TERMS_VERSION') || '2026-07-01';
export const PRIVACY_VERSION = Deno.env.get('PRIVACY_VERSION') || '2026-07-01';

export interface AcceptanceEvidence {
  clientId: string | null;
  email: string;
  ip?: string;
  userAgent?: string;
  method?: string;   // clickwrap_signup | ...
  context?: string;  // signup | resubscribe | ...
  presentedTermsVersion?: string;   // the version the client actually displayed
}

/** Record a terms/privacy acceptance. Best-effort; returns whether it landed. */
export async function recordAcceptance(ev: AcceptanceEvidence): Promise<boolean> {
  try {
    // Trust the server version as authoritative, but if the client reported a
    // DIFFERENT presented version, record that (it's the stronger evidence of
    // what they actually saw).
    const termsVersion = (ev.presentedTermsVersion && ev.presentedTermsVersion.trim()) || TERMS_VERSION;
    const r = await svc('presence_terms_acceptances', {
      method: 'POST',
      body: JSON.stringify({
        client_id: ev.clientId, email: ev.email || '',
        terms_version: termsVersion, privacy_version: PRIVACY_VERSION,
        accepted_at: new Date().toISOString(),
        ip: (ev.ip || '').slice(0, 100), user_agent: (ev.userAgent || '').slice(0, 400),
        method: ev.method || 'clickwrap_signup', context: ev.context || 'signup',
      }),
    });
    if (!r.ok) console.error(`[terms] could not record acceptance for ${ev.email || ev.clientId} (non-fatal): ${r.status}`);
    return r.ok;
  } catch (e) {
    console.error(`[terms] acceptance write threw (non-fatal): ${String((e as Error)?.message || e)}`);
    return false;
  }
}
