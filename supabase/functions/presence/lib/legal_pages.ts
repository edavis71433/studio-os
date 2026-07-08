// ── Generated legal & trust pages (Phase Q / FD-M3) ──────────────────────────
// Every published site gets a Privacy Policy and an Accessibility Statement,
// GENERATED from structured business facts — the owner never writes legal HTML.
// The honest foundation: Studio OS sites emit no cookies, no analytics, no
// tracking, and no third-party embeds (verified — zero-JS templates; maps are
// links), so no consent banner is required; the privacy policy covers the one
// real data flow (the contact form) truthfully. Deterministic: the effective
// date is the snapshot date (the only clock a renderer may read).
//
// Terms of Service are deliberately NOT auto-generated in V1: terms make
// business-specific legal promises (refunds, liability, jurisdiction) that a
// platform must not invent on a customer's behalf. Queued as FD-Q1 (guided,
// owner-approved terms). Both templates render these bodies through their own
// shell, so look-and-feel stays per-template while the words stay one source.
import { esc } from './markdown.ts';
import type { SnapshotContent } from './render_types.ts';

function contactLine(c: SnapshotContent): string {
  const i = c.identity; const l = c.locations?.[0];
  const bits = [
    l ? [l.address_line1, l.city, `${l.region} ${l.postal_code}`].filter(Boolean).join(', ') : '',
    (l?.phone || i.phone || '').trim(),
    i.email,
  ].filter(Boolean).map((x) => esc(String(x)));
  return bits.join(' · ');
}

/** The Privacy Policy body (inside <main>): facts-true, plain words. */
export function privacyBody(c: SnapshotContent, effectiveDate: string, hasForm: boolean): string {
  const name = esc(c.identity.business_name);
  return `<section class="block wrap"><h1>Privacy policy</h1>
<p class="post-meta">Effective ${esc(effectiveDate)}</p>
<h2>Who we are</h2>
<p>This website belongs to ${name}.${contactLine(c) ? ` You can reach us at: ${contactLine(c)}.` : ''}</p>
<h2>What this website collects</h2>
${hasForm
    ? `<p>If you send us a message through the contact form, we receive what you type — your name, an email address or phone number, and your message. We use it for one thing: getting back to you. We don’t sell it, share it for marketing, or add you to lists you didn’t ask for.</p>`
    : `<p>This website has no forms and collects nothing you type.</p>`}
<h2>Cookies and tracking</h2>
<p>This website sets <strong>no cookies</strong> and uses <strong>no analytics or tracking</strong>. There is nothing to consent to, which is why there is no cookie banner.</p>
<h2>Hosting</h2>
<p>The site is served as static pages by our hosting provider, which may keep standard, short-lived server logs (such as IP addresses) for security and reliability.</p>
<h2>Your choices</h2>
<p>If you’ve sent us a message and would like to see, correct, or delete it, contact us using the details above and we’ll take care of it.</p>
</section>`;
}

/** The Accessibility Statement body — promises the TEMPLATE actually keeps. */
export function accessibilityBody(c: SnapshotContent): string {
  const name = esc(c.identity.business_name);
  return `<section class="block wrap"><h1>Accessibility</h1>
<p>${name} wants everyone to be able to use this website. It’s built so that:</p>
<ul style="margin:14px 0 14px 22px">
<li>every page has clear headings and can be navigated by keyboard;</li>
<li>every photograph has a written description;</li>
<li>text keeps readable contrast, and sizes adapt to your device;</li>
<li>the site respects your system’s reduced-motion preference;</li>
<li>links and buttons say what they do.</li>
</ul>
<p>If anything on this site is hard for you to use, please tell us${contactLine(c) ? ` — ${contactLine(c)}` : ''} — and we’ll fix it.</p>
</section>`;
}

/** The footer links every template renders (Privacy · Accessibility). */
export function legalFooterLinks(): string {
  return `<a href="/privacy/">Privacy</a> · <a href="/accessibility/">Accessibility</a>`;
}
