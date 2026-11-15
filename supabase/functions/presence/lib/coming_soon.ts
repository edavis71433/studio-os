// ── Builder list item 158: a Coming soon page, before the first publish ──────
// Before a site's first publish, its address can show something on purpose: the business's
// name, one line, and its phone and email from Business details, in the site's own colour,
// with an optional "join your list" box. It goes up the way Take offline puts its page up
// (the same deploy, the same file set: noindex, robots shut, so search engines leave it out),
// and nothing about the draft changes. The first publish replaces it, so whether it is up is
// read as "put up, and the site has never gone live". Pure: tests read it directly.
import { offlineFileMap } from './offline_page.ts';
import { signupForm, senderTag } from './site_send.ts';

export interface ComingSoon { line: string; phone: boolean; email: boolean; list: boolean; up_at: string | null }
export const COMING_SOON_LINE_MAX = 140;

/** What the sheet sends, made safe: one line of plain words, three switches, when it went up. */
export function normalizeComingSoon(v: unknown): ComingSoon {
  const o = v && typeof v === 'object' ? v as Record<string, unknown> : {};
  return {
    line: String(o.line ?? '').replace(/\s+/g, ' ').trim().slice(0, COMING_SOON_LINE_MAX),
    phone: o.phone !== false,
    email: o.email !== false,
    list: o.list === true,
    up_at: typeof o.up_at === 'string' && !Number.isNaN(Date.parse(o.up_at)) ? o.up_at : null,
  };
}

/** Up means put up and never published since: the first publish replaces it. */
export function comingSoonSince(stored: unknown, published: boolean): string | null {
  return published ? null : normalizeComingSoon(stored).up_at;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const HEX_RE = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;
const ICON_PHONE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2z"/></svg>';
const ICON_MAIL = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>';

export interface ComingSoonPageInput {
  businessName?: string | null;
  accent?: string | null;      // the contrast-safe brand accent (lib/email_brand.ts), as Take offline uses
  line?: string | null;
  phone?: string | null;       // from Business details, shown only when its switch is on
  email?: string | null;
  list?: boolean;
  formEndpoint?: string | null;   // the site's form address: the list box posts there as a "Join our list" box does
  year?: number;
}

/** The whole page: self-contained, no outside files, noindex, readable on a phone. */
export function renderComingSoonPage(input: ComingSoonPageInput = {}): string {
  const name = String(input.businessName || '').trim() || 'This website';
  const accent = HEX_RE.test(String(input.accent || '')) ? String(input.accent) : '#5b3fa0';
  const line = String(input.line || '').trim();
  const phone = String(input.phone || '').trim();
  const email = String(input.email || '').trim();
  const tel = phone.replace(/[^+\d]/g, '');
  const year = input.year || new Date().getUTCFullYear();
  const reach = [
    tel ? `<a class="cs-btn cs-fill" href="tel:${esc(tel)}">${ICON_PHONE}<span>Call ${esc(phone)}</span></a>` : '',
    email ? `<a class="cs-btn cs-out" href="mailto:${esc(email)}">${ICON_MAIL}<span class="cs-wide">${esc(email)}</span><span class="cs-narrow">Email us</span></a>` : '',
  ].filter(Boolean).join('');
  const list = input.list && input.formEndpoint
    ? `<div class="cs-list"><p class="cs-list-h">Hear first when we open</p>${signupForm('cs', input.formEndpoint, 'Tell me')}</div>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(name)} — coming soon</title>
<style>
*{box-sizing:border-box}
html,body{margin:0;min-height:100%}
body{display:flex;flex-direction:column;min-height:100vh;background:#f5f0e8;color:#1b1525;font-family:system-ui,-apple-system,'Segoe UI',sans-serif}
main{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;max-width:640px;margin:0 auto;padding:56px 24px 32px;text-align:center}
.cs-name{display:inline-block;padding:7px 16px;border-radius:999px;background:${accent};color:#fff;font:600 16px/1.3 Palatino,Georgia,serif}
h1{margin:0;color:${accent};font:600 clamp(40px,9vw,64px)/1.05 Palatino,Georgia,serif;letter-spacing:-.01em}
.cs-says{margin:0;color:${accent};font-size:clamp(17px,3.6vw,20px);line-height:1.5}
.cs-reach{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin-top:6px}
.cs-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:0 20px;border-radius:999px;font-size:15px;font-weight:600;text-decoration:none}
.cs-btn svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex:none}
.cs-fill{background:${accent};color:#fff}
.cs-out{border:1.5px solid ${accent};color:${accent};background:transparent}
.cs-narrow{display:none}
.cs-list{width:100%;max-width:420px;margin-top:10px}
.cs-list-h{margin:0 0 8px;font-weight:600}
.nl-form{margin:0}
.nl-row{display:flex;gap:8px}
.nl-row input[type=email]{flex:1;min-width:0;min-height:44px;padding:0 14px;border:1.5px solid #d8cfc2;border-radius:999px;background:#fff;color:#1b1525;font:inherit;font-size:16px}
.nl-row .btn{min-height:44px;padding:0 18px;border:0;border-radius:999px;background:${accent};color:#fff;font:inherit;font-weight:600;cursor:pointer}
.nl-label,.hp{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.nl-consent{margin:10px 0 0;font-size:13px;line-height:1.5;color:#57506a;text-align:left}
footer{padding:20px 24px 28px;text-align:center;color:${accent};font-size:13px}
@media (max-width:560px){
  .cs-reach{flex-direction:column;align-self:stretch}
  .cs-btn{width:100%}
  .cs-wide{display:none}
  .cs-narrow{display:inline}
  .nl-row{flex-direction:column}
}
</style></head>
<body${tel ? ` data-reach-tel="${esc(tel)}"` : ''}${email ? ` data-reach-mail="${esc(email)}"` : ''}>
<!-- presence-coming-soon -->
<main>
<span class="cs-name">${esc(name)}</span>
<h1>Coming soon</h1>
${line ? `<p class="cs-says">${esc(line)}</p>` : ''}
${reach ? `<div class="cs-reach">${reach}</div>` : ''}
${list}
</main>
<footer>&copy; ${year} ${esc(name)}</footer>
${list ? senderTag(String(input.formEndpoint)) : ''}
</body></html>`;
}

/** The files a Coming soon deploy ships: Take offline's set (the page at every path, robots
 *  shut, the security headers plus noindex), so search engines leave it out. */
export function comingSoonFileMap(html: string): Record<string, string> {
  return offlineFileMap(html);
}
