// ── BR-1 · Brand & Identity — the ONE branded email shell ────────────────────
// Every platform email is wrapped in this shell so the whole experience feels like
// one premium product. It CONSUMES the Brand Kit (the single source of truth) — the
// customer's brand colour + name where we send on their behalf, and a clean Studio
// OS default otherwise. It does NOT add a second email engine: `sendEmail` (the one
// sender) wraps the caller's body HTML with this shell. Email-client-safe: table
// layout + inline styles, no external assets, ~600px, dark-text-on-light.
import { normHex, readableOnWhiteText, darken } from './brand_kit.ts';
import { esc } from './markdown.ts';
import { svc } from './db.ts';

export interface EmailBrand { name: string; accent: string; accentDark: string }
export const EMAIL_BRAND_DEFAULT: EmailBrand = { name: 'Studio OS', accent: '#5b3fa0', accentDark: '#3a2470' };

/** Derive an email brand from a stored Brand Kit + the business name. Pure.
 *  Accent is contrast-safe (white text on it stays readable), reusing brand_kit. */
export function brandFromKit(kit: { primary?: string } | null | undefined, businessName?: string | null): EmailBrand {
  const primary = normHex(kit?.primary) || EMAIL_BRAND_DEFAULT.accent;
  const accent = readableOnWhiteText(primary);
  return { name: (businessName || '').trim() || EMAIL_BRAND_DEFAULT.name, accent, accentDark: darken(accent, 0.16) };
}

/** Wrap a body HTML fragment in the branded shell. Pure. Idempotent (a body that's
 *  already a full document is returned untouched, so nothing double-wraps). */
export function brandEmailShell(bodyHtml: string, brand: EmailBrand = EMAIL_BRAND_DEFAULT): string {
  const b = String(bodyHtml || '');
  if (/^\s*<!doctype|<html[\s>]/i.test(b)) return b;
  const name = esc(brand.name);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>a{color:${brand.accentDark}} .cta a{color:#ffffff!important}</style></head>
<body style="margin:0;padding:0;background:#f4f2ef;-webkit-font-smoothing:antialiased">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ef"><tr><td align="center" style="padding:28px 14px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(27,21,37,.08)">
<tr><td style="height:6px;background:${brand.accent};font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:22px 30px 6px"><div style="font-family:'Iowan Old Style',Palatino,Georgia,serif;font-weight:600;font-size:19px;color:${brand.accentDark};letter-spacing:-.01em">${name}</div></td></tr>
<tr><td style="padding:6px 30px 26px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1b1525">${b}</td></tr>
<tr><td style="padding:16px 30px;border-top:1px solid #eee9e0;font-family:-apple-system,'Segoe UI',sans-serif;font-size:12px;line-height:1.5;color:#938ba3">Sent by ${name} on Studio OS. You’re receiving this because of activity on your account.</td></tr>
</table></td></tr></table></body></html>`;
}

/** Load the email brand for a site (its Brand Kit + business name), or the Studio
 *  OS default. One read; used by customer-facing emails so they feel on-brand. */
export async function loadEmailBrand(siteId: string): Promise<EmailBrand> {
  try {
    const [s, i] = await Promise.all([
      svc(`presence_settings?site_id=eq.${siteId}&select=brand_kit&limit=1`),
      svc(`presence_identity?site_id=eq.${siteId}&select=business_name&limit=1`),
    ]);
    const kit = (s.ok && Array.isArray(s.json) && s.json[0]?.brand_kit) || null;
    const name = (i.ok && Array.isArray(i.json) && i.json[0]?.business_name) || '';
    return brandFromKit(kit, name);
  } catch { return EMAIL_BRAND_DEFAULT; }
}
