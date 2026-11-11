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
import { addressOf } from './doc_context.ts';

// builder list item 59: the logo, a signed https URL when the studio set one.
// Sales item 78: the business's address on one line, for the footer of the mail it sends.
export interface EmailBrand { name: string; accent: string; accentDark: string; logoUrl?: string | null; address?: string | null }
export const EMAIL_BRAND_DEFAULT: EmailBrand = { name: 'Studio OS', accent: '#5b3fa0', accentDark: '#3a2470' };
/** Who runs the platform, with its postal address: the footer of the platform's own mail, and of a
 *  business's optional mail when the business has no address on file (an email people can unsubscribe
 *  from should carry one). */
export const PLATFORM_POSTAL = 'Davis Digital Studio LLC · Burbank, California';

/** What the footer says beyond the brand (sales items 75 and 78). `unsubscribeUrl` is set only on mail
 *  an unsubscribe really stops, and draws a plain Unsubscribe link; `asBusiness` means the brand's
 *  business is the sender, so the footer is that business's name and address, not the platform's. */
export interface EmailShellOpts { unsubscribeUrl?: string | null; asBusiness?: boolean }

/** The footer's lines, as HTML. Pure. */
export function emailFooterHtml(brand: EmailBrand, opts: EmailShellOpts = {}): string {
  const name = esc(brand.name);
  const unsub = typeof opts.unsubscribeUrl === 'string' && /^https:\/\//.test(opts.unsubscribeUrl) ? opts.unsubscribeUrl : '';
  const lines: string[] = [];
  if (opts.asBusiness && brand.name !== EMAIL_BRAND_DEFAULT.name) {
    const address = String(brand.address || '').trim();
    lines.push(`<strong style="color:#6b6478;font-weight:600">${name}</strong>${address ? ` · ${esc(address)}` : ''}`);
    if (unsub && !address) lines.push(`Sent through ${PLATFORM_POSTAL}`);
  } else {
    lines.push(brand.name === EMAIL_BRAND_DEFAULT.name ? 'Sent by Studio OS.' : `Sent by ${name} on Studio OS.`);
    lines.push(PLATFORM_POSTAL);
  }
  if (unsub) lines.push(`Don’t want these emails? <a href="${esc(unsub)}" style="color:#6b6478;text-decoration:underline">Unsubscribe</a>`);
  return lines.join('<br>');
}

/** Derive an email brand from a stored Brand Kit + the business name. Pure.
 *  Accent is contrast-safe (white text on it stays readable), reusing brand_kit. */
export function brandFromKit(kit: { primary?: string } | null | undefined, businessName?: string | null): EmailBrand {
  const primary = normHex(kit?.primary) || EMAIL_BRAND_DEFAULT.accent;
  const accent = readableOnWhiteText(primary);
  return { name: (businessName || '').trim() || EMAIL_BRAND_DEFAULT.name, accent, accentDark: darken(accent, 0.16) };
}

/** Wrap a body HTML fragment in the branded shell. Pure. Idempotent (a body that's
 *  already a full document is returned untouched, so nothing double-wraps). */
export function brandEmailShell(bodyHtml: string, brand: EmailBrand = EMAIL_BRAND_DEFAULT, opts: EmailShellOpts = {}): string {
  const b = String(bodyHtml || '');
  if (/^\s*<!doctype|<html[\s>]/i.test(b)) return b;
  const name = esc(brand.name);
  // builder list item 59: the studio's logo in place of its name when it set one (the name stays as the alt text)
  const logo = typeof brand.logoUrl === 'string' && /^https:\/\//.test(brand.logoUrl) ? `<img src="${esc(brand.logoUrl)}" alt="${name}" style="display:block;height:40px;width:auto;max-width:220px;border:0">` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>a{color:${brand.accentDark}} .cta a{color:#ffffff!important}</style></head>
<body style="margin:0;padding:0;background:#f4f2ef;-webkit-font-smoothing:antialiased">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ef"><tr><td align="center" style="padding:28px 14px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(27,21,37,.08)">
<tr><td style="height:6px;background:${brand.accent};font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:22px 30px 6px">${logo || `<div style="font-family:'Iowan Old Style',Palatino,Georgia,serif;font-weight:600;font-size:19px;color:${brand.accentDark};letter-spacing:-.01em">${name}</div>`}</td></tr>
<tr><td style="padding:6px 30px 26px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1b1525">${b}</td></tr>
<tr><td style="padding:16px 30px;border-top:1px solid #eee9e0;font-family:-apple-system,'Segoe UI',sans-serif;font-size:12px;line-height:1.5;color:#938ba3">${emailFooterHtml(brand, opts)}</td></tr>
</table></td></tr></table></body></html>`;
}

/** Load the email brand for a site (its Brand Kit + business name + logo), or the
 *  Studio OS default. Used by customer-facing emails so they feel on-brand.
 *  Builder list item 59: the logo is the site's own (Files › Set as logo), signed
 *  for the life of an email by default; a page asks for a shorter `logoTtl`. */
export const EMAIL_LOGO_TTL = 400 * 24 * 60 * 60;   // an email is read for a long time
export async function loadEmailBrand(siteId: string, opts: { logoTtl?: number } = {}): Promise<EmailBrand> {
  try {
    const [s, i, l] = await Promise.all([
      svc(`presence_settings?site_id=eq.${siteId}&select=brand_kit,logo_media_id&limit=1`),
      svc(`presence_identity?site_id=eq.${siteId}&select=business_name&limit=1`),
      // sales item 78: the address on the site's Business details, for the footer of mail the business sends
      svc(`presence_locations?site_id=eq.${siteId}&select=address_line1,address_line2,city,region,postal_code&limit=1`).catch(() => null),
    ]);
    const row = (s.ok && Array.isArray(s.json) && s.json[0]) || null;
    const kit = row?.brand_kit || null;
    const name = (i.ok && Array.isArray(i.json) && i.json[0]?.business_name) || '';
    const brand: EmailBrand = brandFromKit(kit, name);
    const address = addressOf((l?.ok && Array.isArray(l.json) && l.json[0]) || null).split('\n').filter(Boolean).join(', ');
    if (address) brand.address = address;
    const logoId = String(row?.logo_media_id || kit?.logo_media_id || '');
    const logoUrl = logoId ? await studioLogoUrl(siteId, logoId, opts.logoTtl ?? EMAIL_LOGO_TTL) : null;
    return logoUrl ? { ...brand, logoUrl } : brand;
  } catch { return EMAIL_BRAND_DEFAULT; }
}

/** A signed https URL for a site's logo, or null when the file is gone, isn't an
 *  image, or the store won't sign. Best-effort: a brand without a logo is still a brand. */
export async function studioLogoUrl(siteId: string, mediaId: string, expiresIn: number): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/.test(mediaId)) return null;
  try {
    const m = await svc(`presence_media?id=eq.${mediaId}&site_id=eq.${siteId}&deleted_at=is.null&select=storage_path,mime&limit=1`);
    const row = (m.ok && Array.isArray(m.json) && m.json[0]) as { storage_path?: string; mime?: string } | null;
    if (!row?.storage_path || !/^image\//.test(String(row.mime || ''))) return null;
    const { signOriginal } = await import('./media.ts');
    return await signOriginal(row.storage_path, expiresIn);
  } catch { return null; }
}
